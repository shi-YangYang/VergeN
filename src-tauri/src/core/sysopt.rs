use crate::{
    config::{Config, MixedPort},
    core::proxy_recovery::{self, Target},
    utils::server,
};
use anyhow::Result;
use smartstring::alias::String;

#[cfg(target_os = "windows")]
static DEFAULT_BYPASS: &str = "localhost;127.*;192.168.*;10.*;172.16.*;172.17.*;172.18.*;172.19.*;172.20.*;172.21.*;172.22.*;172.23.*;172.24.*;172.25.*;172.26.*;172.27.*;172.28.*;172.29.*;172.30.*;172.31.*;<local>";
#[cfg(target_os = "windows")]
static BYPASS_SEPARATOR: &str = ";";
#[cfg(target_os = "linux")]
static DEFAULT_BYPASS: &str = "localhost,127.0.0.1,192.168.0.0/16,10.0.0.0/8,172.16.0.0/12,::1";
#[cfg(any(target_os = "linux", target_os = "macos"))]
static BYPASS_SEPARATOR: &str = ",";
#[cfg(target_os = "macos")]
static DEFAULT_BYPASS: &str =
    "127.0.0.1,192.168.0.0/16,10.0.0.0/8,172.16.0.0/12,localhost,*.local,*.crashlytics.com,<local>";

fn format_bypass(use_default: bool, custom_bypass: &str) -> String {
    if custom_bypass.is_empty() {
        DEFAULT_BYPASS.into()
    } else if use_default {
        format!("{DEFAULT_BYPASS}{BYPASS_SEPARATOR}{custom_bypass}").into()
    } else {
        custom_bypass.into()
    }
}

pub(super) async fn apply(enforcing: bool) -> Result<()> {
    let verge = Config::verge().await.latest_arc();
    if !verge.enable_system_proxy.unwrap_or_default() {
        return proxy_recovery::release_owned().await;
    }
    let mixed_port = MixedPort::desired().await;
    let bypass = format_bypass(
        verge.use_default_bypass.unwrap_or(true),
        verge.system_proxy_bypass.as_deref().unwrap_or(""),
    );
    let host = verge.proxy_host.as_deref().unwrap_or("127.0.0.1");
    let target = if verge.proxy_auto_config.unwrap_or_default() {
        Target::Pac {
            url: format!("http://{host}:{}/commands/pac", server::embedded_server_port()?),
            bypass: Some(bypass.into()),
        }
    } else {
        Target::Manual {
            host: host.to_owned(),
            port: mixed_port,
            bypass: bypass.into(),
        }
    };
    proxy_recovery::apply_local(target, enforcing).await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn empty_custom_bypass_uses_defaults() {
        assert_eq!(format_bypass(false, ""), DEFAULT_BYPASS);
    }

    #[test]
    fn custom_bypass_can_replace_defaults() {
        assert_eq!(format_bypass(false, "example.com"), "example.com");
    }

    #[test]
    fn default_and_custom_bypass_use_platform_separator() {
        assert_eq!(
            format_bypass(true, "example.com"),
            format!("{DEFAULT_BYPASS}{BYPASS_SEPARATOR}example.com")
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_default_and_custom_bypass_use_semicolon() {
        assert_eq!(
            format_bypass(true, "example.com"),
            format!("{DEFAULT_BYPASS};example.com")
        );
    }
}
