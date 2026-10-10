use super::CmdResult;
use crate::core::updater::DownloadEvent;
use crate::feat::enterprise;
use crate::feat::enterprise::{CompanyRelease, DingtalkQrPoll, DingtalkQrStart, EnterpriseSession};

#[tauri::command]
pub async fn get_enterprise_session() -> CmdResult<EnterpriseSession> {
    Ok(enterprise::session().await)
}

#[tauri::command]
pub async fn enterprise_release_current() -> CmdResult<Option<CompanyRelease>> {
    enterprise::release_check()
        .await
        .map_err(|error| super::coded_error("ENTERPRISE_RELEASE_CHECK_FAILED", error))
}

/// Runs the full company auto-update flow; returns false when nothing to
/// update. The app restarts itself after a successful install.
#[tauri::command]
pub async fn enterprise_updater_install(
    app: tauri::AppHandle,
    on_event: tauri::ipc::Channel<DownloadEvent>,
) -> CmdResult<bool> {
    let mut first_chunk = true;
    enterprise::updater_autoinstall(app, move |chunk, total| {
        if first_chunk {
            first_chunk = false;
            let _ = on_event.send(DownloadEvent::Started { content_length: total });
        }
        let _ = on_event.send(DownloadEvent::Progress {
            chunk_length: chunk as usize,
        });
    })
    .await
    .map_err(|error| super::coded_error("ENTERPRISE_UPDATER_FAILED", error))
}

#[tauri::command]
pub async fn enterprise_login(
    server_url: std::string::String,
    username: std::string::String,
    password: std::string::String,
) -> CmdResult<EnterpriseSession> {
    enterprise::login(&server_url, &username, &password)
        .await
        .map_err(|error| super::coded_error("ENTERPRISE_LOGIN_FAILED", error))
}

#[tauri::command]
pub async fn enterprise_dingtalk_qr_start(server_url: std::string::String) -> CmdResult<DingtalkQrStart> {
    enterprise::dingtalk_qr_start(&server_url)
        .await
        .map_err(|error| super::coded_error("ENTERPRISE_QR_START_FAILED", error))
}

#[tauri::command]
pub async fn enterprise_dingtalk_qr_poll(
    server_url: std::string::String,
    session_id: std::string::String,
) -> CmdResult<DingtalkQrPoll> {
    enterprise::dingtalk_qr_poll(&server_url, &session_id)
        .await
        .map_err(|error| super::coded_error("ENTERPRISE_QR_POLL_FAILED", error))
}

#[tauri::command]
pub async fn enterprise_dingtalk_qr_cancel(
    server_url: std::string::String,
    session_id: std::string::String,
) -> CmdResult<()> {
    enterprise::dingtalk_qr_cancel(&server_url, &session_id)
        .await
        .map_err(|error| super::coded_error("ENTERPRISE_QR_CANCEL_FAILED", error))
}

#[tauri::command]
pub async fn enterprise_logout() -> CmdResult<EnterpriseSession> {
    enterprise::logout()
        .await
        .map_err(|error| super::coded_error("ENTERPRISE_LOGOUT_FAILED", error))
}

#[tauri::command]
pub async fn enterprise_sync() -> CmdResult<EnterpriseSession> {
    enterprise::sync()
        .await
        .map_err(|error| super::coded_error("ENTERPRISE_SYNC_FAILED", error))
}

#[tauri::command]
pub async fn enterprise_heartbeat() -> CmdResult<bool> {
    Ok(enterprise::heartbeat().await)
}
