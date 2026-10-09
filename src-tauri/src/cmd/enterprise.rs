use super::CmdResult;
use crate::feat::enterprise;
use crate::feat::enterprise::EnterpriseSession;

#[tauri::command]
pub async fn get_enterprise_session() -> CmdResult<EnterpriseSession> {
    Ok(enterprise::session().await)
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
