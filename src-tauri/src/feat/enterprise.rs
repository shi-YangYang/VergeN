use crate::config::{Config, IVerge, PrfItem, PrfOption, profiles::profiles_save_file_safe, profiles_append_item_safe};
use crate::core::notify::{Refresh, announce};
use anyhow::{Result, anyhow};
use clash_verge_draft::DraftTransaction;
use clash_verge_logging::{Type, logging};
use serde::{Deserialize, Serialize};
use smartstring::alias::String as SmartString;
use std::time::{SystemTime, UNIX_EPOCH};

const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
/// Refresh the access token this long before its recorded expiry.
const ACCESS_REFRESH_MARGIN_SECS: i64 = 60;
/// Managed subscription auto refresh cadence (minutes).
const MANAGED_UPDATE_INTERVAL_MINUTES: u64 = 1440;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ManagedFlags {
    #[serde(default)]
    pub allow_edit_profiles: bool,
    #[serde(default)]
    pub allow_change_settings: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Announcement {
    pub title: String,
    #[serde(default)]
    pub content: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct EnterpriseSession {
    pub enabled: bool,
    pub authenticated: bool,
    pub username: Option<std::string::String>,
    pub managed: ManagedFlags,
    pub announcement: Option<Announcement>,
    pub subscription_url: Option<std::string::String>,
    pub profile_uid: Option<std::string::String>,
}

#[derive(Debug, Deserialize, Default)]
struct LoginResponse {
    #[serde(default)]
    access_token: std::string::String,
    #[serde(default)]
    refresh_token: std::string::String,
    #[serde(default)]
    expires_in: i64,
}

#[derive(Debug, Deserialize, Default)]
struct ServerError {
    #[serde(default)]
    error: ServerErrorInner,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct DingtalkQrStart {
    #[serde(default)]
    session_id: std::string::String,
    #[serde(default)]
    qr_url: std::string::String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct DingtalkQrPoll {
    #[serde(default)]
    status: std::string::String, // pending | ok | fail | expired
    #[serde(default)]
    username: std::string::String,
    #[serde(default)]
    access_token: std::string::String,
    #[serde(default)]
    refresh_token: std::string::String,
    #[serde(default)]
    expires_in: i64,
    #[serde(default)]
    message: std::string::String,
}

/// Mirrors store.Release on the wire; the ops panel publishes one manifest.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct CompanyRelease {
    #[serde(default)]
    pub version: std::string::String,
    #[serde(default)]
    pub notes: std::string::String,
    #[serde(default)]
    pub url: std::string::String,
    #[serde(default)]
    pub pub_date: i64,
}

#[derive(Debug, Deserialize, Default)]
struct ServerErrorInner {
    code: Option<std::string::String>,
    message: Option<std::string::String>,
}

#[derive(Debug, Deserialize, Default)]
struct BootstrapResponse {
    #[serde(default)]
    subscription_url: std::string::String,
    #[serde(default)]
    managed: ManagedFlags,
    announcement: Option<Announcement>,
}

enum AccessOutcome {
    Access(std::string::String),
    NeedsLogin,
}

fn unix_now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or_default()
}

fn normalize_server(server_url: &str) -> Result<std::string::String> {
    let server = server_url.trim().trim_end_matches('/').to_string();
    if !(server.starts_with("http://") || server.starts_with("https://")) {
        return Err(anyhow!("服务器地址需为 http(s) 链接"));
    }
    if server == "http://" || server == "https://" {
        return Err(anyhow!("服务器地址无效"));
    }
    Ok(server)
}

fn http_client() -> Result<reqwest::Client> {
    Ok(reqwest::Client::builder()
        .use_rustls_tls()
        .timeout(std::time::Duration::from_secs(20))
        .user_agent(format!("vergen-enterprise/{APP_VERSION} ({})", std::env::consts::OS))
        .build()?)
}

fn enabled_field(url: &Option<SmartString>) -> bool {
    url.as_ref().is_some_and(|u| !u.trim().is_empty())
}

fn present(token: &Option<SmartString>) -> bool {
    token.as_ref().is_some_and(|t| !t.trim().is_empty())
}

/// The core must not start on a managed device until the employee has logged in.
pub async fn core_start_allowed() -> bool {
    let data = Config::verge().await.data_arc();
    if !enabled_field(&data.enterprise_server_url) {
        return true;
    }
    present(&data.enterprise_refresh_token)
}

fn session_from(data: &IVerge, authenticated: bool) -> EnterpriseSession {
    let managed = data
        .enterprise_managed_flags
        .as_ref()
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();
    let announcement = data
        .enterprise_announcement
        .as_ref()
        .and_then(|v| serde_json::from_value(v.clone()).ok());
    EnterpriseSession {
        enabled: enabled_field(&data.enterprise_server_url),
        authenticated,
        username: data
            .enterprise_username
            .clone()
            .filter(|u| !u.trim().is_empty())
            .map(|u| u.to_string()),
        managed,
        announcement,
        subscription_url: data
            .enterprise_subscription_url
            .clone()
            .filter(|u| !u.trim().is_empty())
            .map(|u| u.to_string()),
        profile_uid: data
            .enterprise_profile_uid
            .clone()
            .filter(|u| !u.is_empty())
            .map(|u| u.to_string()),
    }
}

pub async fn session() -> EnterpriseSession {
    let data = Config::verge().await.data_arc();
    let authenticated = enabled_field(&data.enterprise_server_url) && present(&data.enterprise_access_token);
    session_from(&data, authenticated)
}

/// Apply a config mutation with write serialization, persist and commit it.
async fn persist_verge_edit(f: impl FnOnce(&mut IVerge)) -> Result<()> {
    let _config_write = Config::try_lock_config_write()?;
    let verge = Config::verge().await;
    let transaction = DraftTransaction::begin(vec![&verge])?;
    verge.edit_draft(f);
    let result: Result<()> = async {
        verge.latest_arc().save_file().await?;
        verge.apply();
        Ok(())
    }
    .await;
    if let Err(error) = result {
        transaction.rollback();
        return Err(error);
    }
    transaction.commit();
    drop(_config_write);
    announce(Refresh::Verge);
    Ok(())
}

async fn clear_tokens() -> Result<()> {
    persist_verge_edit(|d| {
        d.enterprise_access_token = None;
        d.enterprise_refresh_token = None;
        d.enterprise_access_expires_at = None;
    })
    .await
}

async fn store_login(server: &str, username: &str, access: &str, refresh: &str, expires_in: i64) -> Result<()> {
    let expires_at = unix_now() + expires_in.max(30);
    persist_verge_edit(|d| {
        d.enterprise_server_url = Some(server.into());
        d.enterprise_username = Some(username.into());
        d.enterprise_access_token = Some(access.into());
        d.enterprise_refresh_token = Some(refresh.into());
        d.enterprise_access_expires_at = Some(expires_at);
    })
    .await
}

async fn store_tokens_after_refresh(access: &str, refresh: &str, expires_in: i64) -> Result<()> {
    let expires_at = unix_now() + expires_in.max(30);
    persist_verge_edit(|d| {
        d.enterprise_access_token = Some(access.into());
        d.enterprise_refresh_token = Some(refresh.into());
        d.enterprise_access_expires_at = Some(expires_at);
    })
    .await
}

async fn store_bootstrap(server: &str, bootstrap: &BootstrapResponse) -> Result<()> {
    let flags = serde_json::to_value(&bootstrap.managed)?;
    let announcement = match &bootstrap.announcement {
        Some(a) => serde_json::to_value(a)?,
        None => serde_json::Value::Null,
    };
    let subscription = (!bootstrap.subscription_url.trim().is_empty()).then(|| {
        let url: SmartString = bootstrap.subscription_url.trim().into();
        url
    });
    persist_verge_edit(|d| {
        if enabled_field(&d.enterprise_server_url) {
            d.enterprise_server_url = Some(server.into());
        }
        d.enterprise_managed_flags = Some(flags);
        d.enterprise_announcement = Some(announcement);
        d.enterprise_subscription_url = subscription;
    })
    .await
}

fn server_error_message(status: reqwest::StatusCode, body: &str) -> std::string::String {
    let parsed: ServerError = serde_json::from_str(body).unwrap_or_default();
    match (status.as_u16(), parsed.error.code.as_deref()) {
        (401, _) => "用户名或密码错误".to_string(),
        (403, _) => "账号已被停用，请联系管理员".to_string(),
        (429, _) => "尝试次数过多，请稍后再试".to_string(),
        _ => parsed
            .error
            .message
            .filter(|m| !m.is_empty())
            .unwrap_or_else(|| format!("服务器错误 ({status})")),
    }
}

async fn ensure_access(client: &reqwest::Client, server: &str) -> Result<AccessOutcome> {
    let data = Config::verge().await.data_arc();
    let access = data.enterprise_access_token.clone();
    let expires_at = data.enterprise_access_expires_at;
    let now = unix_now();
    let fresh = present(&access) && expires_at.is_none_or(|t| t > now + ACCESS_REFRESH_MARGIN_SECS);
    if fresh {
        return Ok(AccessOutcome::Access(access.unwrap_or_default().to_string()));
    }
    let Some(refresh) = data.enterprise_refresh_token.clone().filter(|t| !t.trim().is_empty()) else {
        return Ok(AccessOutcome::NeedsLogin);
    };
    let response = client
        .post(format!("{server}/api/v1/auth/refresh"))
        .json(&serde_json::json!({ "refresh_token": refresh.trim() }))
        .send()
        .await
        .map_err(|e| anyhow!("无法连接服务器 {server}: {e}"))?;
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if status == reqwest::StatusCode::UNAUTHORIZED {
        logging!(info, Type::Cmd, "enterprise refresh rejected; clearing tokens");
        clear_tokens().await?;
        return Ok(AccessOutcome::NeedsLogin);
    }
    if !status.is_success() {
        // Transient server issues keep the refresh token so devices behind a
        // flaky network recover without a manual re-login.
        return Err(anyhow!("刷新登录失败: {}", server_error_message(status, &body)));
    }
    let parsed: LoginResponse = serde_json::from_str(&body)?;
    if parsed.access_token.is_empty() || parsed.refresh_token.is_empty() {
        return Err(anyhow!("刷新登录失败: 服务器响应无效"));
    }
    store_tokens_after_refresh(&parsed.access_token, &parsed.refresh_token, parsed.expires_in).await?;
    Ok(AccessOutcome::Access(parsed.access_token))
}

async fn bootstrap_fetch(client: &reqwest::Client, server: &str, access: &str) -> Result<BootstrapResponse> {
    let response = client
        .get(format!("{server}/api/v1/client/bootstrap"))
        .bearer_auth(access)
        .send()
        .await
        .map_err(|e| anyhow!("无法连接服务器 {server}: {e}"))?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(anyhow!("获取下发配置失败: {}", server_error_message(status, &body)));
    }
    Ok(response.json::<BootstrapResponse>().await?)
}

/// Ensure a profile item for the managed subscription exists and is activated.
/// Activation failures are logged, not fatal: authentication already succeeded.
pub async fn ensure_managed_profile(subscription_url: &str) -> Result<()> {
    let profiles = Config::profiles().await;
    let existing = profiles.data_arc().items.as_ref().and_then(|items| {
        items
            .iter()
            .find(|it| it.itype.as_deref() == Some("remote") && it.url.as_deref() == Some(subscription_url))
            .and_then(|it| it.uid.clone())
    });
    let uid = match existing {
        Some(uid) => uid,
        None => {
            let name: SmartString = "公司订阅".into();
            let option = PrfOption {
                update_interval: Some(MANAGED_UPDATE_INTERVAL_MINUTES),
                allow_auto_update: Some(true),
                with_proxy: Some(false),
                timeout_seconds: Some(30),
                ..PrfOption::default()
            };
            let mut item = PrfItem::from_url(subscription_url, Some(&name), None, Some(&option)).await?;
            profiles_append_item_safe(&mut item).await?;
            profiles_save_file_safe().await?;
            match item.uid.clone() {
                Some(uid) => uid,
                None => return Err(anyhow!("导入公司订阅失败: 未生成配置 ID")),
            }
        }
    };
    let provisioned = uid.clone();
    persist_verge_edit(|d| d.enterprise_profile_uid = Some(uid.clone())).await?;
    let current = Config::profiles().await.data_arc().current.clone();
    if current.as_ref() != Some(&provisioned) {
        crate::cmd::patch_profiles_config_by_profile_index(provisioned)
            .await
            .map_err(|failure| anyhow!("切换公司订阅失败: {failure}"))?;
    }
    Ok(())
}

pub async fn login(server_url: &str, username: &str, password: &str) -> Result<EnterpriseSession> {
    let server = normalize_server(server_url)?;
    if username.trim().is_empty() || password.is_empty() {
        return Err(anyhow!("请输入账号和密码"));
    }
    let client = http_client()?;
    let response = client
        .post(format!("{server}/api/v1/auth/login"))
        .json(&serde_json::json!({
            "username": username.trim(),
            "password": password,
        }))
        .send()
        .await
        .map_err(|e| anyhow!("无法连接服务器 {server}: {e}"))?;
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(anyhow!("{}", server_error_message(status, &body)));
    }
    let parsed: LoginResponse = serde_json::from_str(&body)?;
    if parsed.access_token.is_empty() || parsed.refresh_token.is_empty() {
        return Err(anyhow!("服务器响应无效"));
    }
    activate_session(&client, &server, parsed, username.trim()).await
}

/// Shared back half of every login path: persist tokens, pull the managed
/// bootstrap and bring the core online.
async fn activate_session(
    client: &reqwest::Client,
    server: &str,
    parsed: LoginResponse,
    username: &str,
) -> Result<EnterpriseSession> {
    store_login(
        server,
        username,
        &parsed.access_token,
        &parsed.refresh_token,
        parsed.expires_in,
    )
    .await?;
    logging!(info, Type::Cmd, "enterprise login ok for {}", username);

    let mut provisioned = false;
    match bootstrap_fetch(client, server, &parsed.access_token).await {
        Ok(bootstrap) => {
            store_bootstrap(server, &bootstrap).await?;
            if !bootstrap.subscription_url.trim().is_empty() {
                match ensure_managed_profile(bootstrap.subscription_url.trim()).await {
                    Ok(_) => provisioned = true,
                    Err(e) => logging!(warn, Type::Cmd, "managed subscription provisioning failed: {e:#}"),
                }
            }
        }
        Err(e) => {
            logging!(warn, Type::Cmd, "bootstrap after login failed: {e:#}");
        }
    }
    if !provisioned {
        // Ops has not configured a subscription yet: bring the core up with
        // the local config so the app stays usable.
        if let Err(e) = crate::core::CoreManager::global().update_config_forced().await {
            logging!(warn, Type::Cmd, "start core without managed subscription: {e:#}");
        }
    }

    let data = Config::verge().await.data_arc();
    Ok(session_from(&data, true))
}

pub async fn dingtalk_qr_start(server_url: &str) -> Result<DingtalkQrStart> {
    let server = normalize_server(server_url)?;
    let client = http_client()?;
    let response = client
        .post(format!("{server}/api/v1/auth/dingtalk/qr/start"))
        .send()
        .await
        .map_err(|e| anyhow!("无法连接服务器 {server}: {e}"))?;
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(anyhow!("{}", server_error_message(status, &body)));
    }
    let parsed: DingtalkQrStart = serde_json::from_str(&body)?;
    if parsed.session_id.is_empty() || parsed.qr_url.is_empty() {
        return Err(anyhow!("服务器响应无效"));
    }
    Ok(parsed)
}

pub async fn dingtalk_qr_poll(server_url: &str, session_id: &str) -> Result<DingtalkQrPoll> {
    let server = normalize_server(server_url)?;
    let client = http_client()?;
    let response = client
        .post(format!("{server}/api/v1/auth/dingtalk/qr/poll"))
        .json(&serde_json::json!({ "session_id": session_id.trim() }))
        .send()
        .await
        .map_err(|e| anyhow!("无法连接服务器 {server}: {e}"))?;
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(anyhow!("{}", server_error_message(status, &body)));
    }
    let mut parsed: DingtalkQrPoll = serde_json::from_str(&body)?;
    if parsed.status == "ok" {
        if parsed.access_token.is_empty() || parsed.refresh_token.is_empty() {
            parsed.status = "expired".into();
            return Ok(parsed);
        }
        let username = parsed.username.clone();
        let token_login = LoginResponse {
            access_token: std::mem::take(&mut parsed.access_token),
            refresh_token: std::mem::take(&mut parsed.refresh_token),
            expires_in: parsed.expires_in,
        };
        activate_session(&client, &server, token_login, username.trim()).await?;
    }
    Ok(parsed)
}

pub async fn dingtalk_qr_cancel(server_url: &str, session_id: &str) -> Result<()> {
    let server = normalize_server(server_url)?;
    let client = http_client()?;
    let _ = client
        .post(format!("{server}/api/v1/auth/dingtalk/qr/cancel"))
        .json(&serde_json::json!({ "session_id": session_id.trim() }))
        .send()
        .await;
    Ok(())
}

pub async fn logout() -> Result<EnterpriseSession> {
    let (server, refresh) = {
        let data = Config::verge().await.data_arc();
        (
            data.enterprise_server_url.clone().filter(|u| !u.trim().is_empty()),
            data.enterprise_refresh_token.clone().filter(|t| !t.trim().is_empty()),
        )
    };
    if let (Some(server), Some(refresh)) = (&server, &refresh)
        && let Ok(client) = http_client()
    {
        // Server-side revocation is best effort; local cleanup always proceeds.
        let endpoint = format!("{}/api/v1/auth/logout", server.trim());
        let _ = client
            .post(endpoint)
            .json(&serde_json::json!({ "refresh_token": refresh.trim() }))
            .send()
            .await;
    }
    clear_tokens().await?;
    logging!(info, Type::Cmd, "enterprise logout");
    let data = Config::verge().await.data_arc();
    Ok(session_from(&data, false))
}

/// Refresh bootstrap data and re-provision the managed subscription.
pub async fn sync() -> Result<EnterpriseSession> {
    let server = {
        let data = Config::verge().await.data_arc();
        data.enterprise_server_url
            .clone()
            .filter(|u| !u.trim().is_empty())
            .ok_or_else(|| anyhow!("enterprise 未配置"))?
    };
    let server = server.to_string();
    let client = http_client()?;
    let access = match ensure_access(&client, &server).await? {
        AccessOutcome::Access(access) => access,
        AccessOutcome::NeedsLogin => {
            let data = Config::verge().await.data_arc();
            return Ok(session_from(&data, false));
        }
    };
    let bootstrap = bootstrap_fetch(&client, &server, &access).await?;
    store_bootstrap(&server, &bootstrap).await?;
    if !bootstrap.subscription_url.trim().is_empty()
        && let Err(e) = ensure_managed_profile(bootstrap.subscription_url.trim()).await
    {
        logging!(warn, Type::Cmd, "managed subscription provisioning failed: {e:#}");
    }
    let data = Config::verge().await.data_arc();
    Ok(session_from(&data, true))
}

pub async fn heartbeat() -> bool {
    match heartbeat_once().await {
        Ok(ok) => ok,
        Err(e) => {
            logging!(debug, Type::Cmd, "enterprise heartbeat failed: {e:#}");
            false
        }
    }
}

/// Poll the company release manifest; None when ops has not published one
/// or the session needs a login.
pub async fn release_check() -> Result<Option<CompanyRelease>> {
    let server = {
        let data = Config::verge().await.data_arc();
        data.enterprise_server_url
            .clone()
            .filter(|u| !u.trim().is_empty())
            .ok_or_else(|| anyhow!("enterprise 未配置"))?
    };
    let client = http_client()?;
    let access = match ensure_access(&client, &server).await? {
        AccessOutcome::Access(access) => access,
        AccessOutcome::NeedsLogin => return Ok(None),
    };
    let response = client
        .get(format!("{server}/api/v1/client/update"))
        .bearer_auth(&access)
        .send()
        .await
        .map_err(|e| anyhow!("无法连接服务器 {server}: {e}"))?;
    let status = response.status();
    if status == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    let body = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(anyhow!("{}", server_error_message(status, &body)));
    }
    let parsed: CompanyRelease = serde_json::from_str(&body)?;
    if parsed.version.trim().is_empty() {
        return Ok(None);
    }
    Ok(Some(parsed))
}

async fn heartbeat_once() -> Result<bool> {
    let data = Config::verge().await.data_arc();
    let Some(server) = data.enterprise_server_url.clone().filter(|u| !u.trim().is_empty()) else {
        return Ok(false);
    };
    let server = server.to_string();
    let client = http_client()?;
    let access = match ensure_access(&client, &server).await? {
        AccessOutcome::Access(access) => access,
        AccessOutcome::NeedsLogin => return Ok(false),
    };
    let response = client
        .post(format!("{server}/api/v1/client/heartbeat"))
        .bearer_auth(access)
        .json(&serde_json::json!({
            "version": APP_VERSION,
            "os": std::env::consts::OS,
            "arch": std::env::consts::ARCH,
        }))
        .send()
        .await?;
    Ok(response.status().is_success())
}
