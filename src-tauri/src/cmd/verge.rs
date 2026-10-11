use super::{CmdResult, proxy_aware_error};
use crate::{
    cmd::StringifyErr as _,
    config::IVerge,
    core::notification::{self, FailedOperation},
    feat,
};
use clash_verge_draft::SharedDraft;

/// 获取Verge配置
#[tauri::command]
pub async fn get_verge_config() -> CmdResult<SharedDraft<IVerge>> {
    feat::fetch_verge_config().await.stringify_err()
}

/// Settings fields that employees may not touch when the ops panel has
/// locked client settings.
const MANAGED_LOCKED_FIELDS: [&str; 2] = ["verge_mixed_port", "enable_external_controller"];

/// 修改Verge配置
#[tauri::command]
pub async fn patch_verge_config(payload: IVerge) -> CmdResult {
    if let Err(message) = guard_managed_verge_patch(&payload).await {
        return Err(crate::cmd::coded_error("MANAGED_SETTING_LOCKED", message));
    }
    let operation = system_proxy_operation(&payload);
    let result = match operation {
        Some(operation) => notification::asking_for(operation, Box::pin(feat::patch_verge(&payload, false))).await,
        None => feat::patch_verge(&payload, false).await,
    };
    result.map_err(|error| proxy_aware_error(&error).asking_for(operation))
}

/// Returns an error when the patch touches fields locked by the managed
/// policy (allow_change_settings=false).
async fn guard_managed_verge_patch(payload: &IVerge) -> Result<(), String> {
    use serde::Serialize as _;
    let Some(policy) = crate::feat::enterprise::managed_policy().await else {
        return Ok(());
    };
    if policy.allow_change_settings {
        return Ok(());
    }
    let serialized = serde_json::to_value(payload)
        .map(|value| value)
        .unwrap_or(serde_json::Value::Null);
    let touched: Vec<&str> = MANAGED_LOCKED_FIELDS
        .iter()
        .filter(|field| {
            matches!(
                serialized.get(*field),
                Some(serde_json::Value::Null) | None // absent means untouched
            ) == false
        })
        .copied()
        .collect();
    if touched.is_empty() {
        return Ok(());
    }
    Err("该设置项由公司统一管理".to_string())
}

/// Extract a system proxy operation from a Verge patch.
const fn system_proxy_operation(payload: &IVerge) -> Option<FailedOperation> {
    match payload.enable_system_proxy {
        Some(true) => Some(FailedOperation::SystemProxyEnable),
        Some(false) => Some(FailedOperation::SystemProxyDisable),
        None => None,
    }
}
