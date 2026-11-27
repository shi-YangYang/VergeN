use crate::utils::dirs::APP_ID;
use anyhow::{Context as _, Result, ensure};
use std::{io, path::Path};

pub(super) const RECOVER_FLAG: &str = "--recover-proxy";

fn hook_name() -> String {
    format!("{APP_ID}.proxy-recovery")
}

#[cfg(unix)]
fn hook_path() -> Result<std::path::PathBuf> {
    #[cfg(target_os = "macos")]
    let path = dirs::home_dir()
        .context("missing home directory")?
        .join("Library/LaunchAgents")
        .join(format!("{}.plist", hook_name()));
    #[cfg(target_os = "linux")]
    let path = dirs::config_dir()
        .context("missing XDG configuration directory")?
        .join("autostart")
        .join(format!("{}.desktop", hook_name()));
    Ok(path)
}

pub(super) fn ensure_login_hook() -> Result<()> {
    let executable = std::env::current_exe()?;
    register(dunce::simplified(&executable))
}

fn executable_path(executable: &Path) -> Result<&str> {
    ensure!(
        executable.is_absolute(),
        "the recovery executable path must be absolute"
    );
    let value = executable
        .to_str()
        .context("the recovery executable path is not Unicode")?;
    ensure!(
        !value.chars().any(char::is_control),
        "control character in recovery executable path"
    );
    Ok(value)
}

#[cfg(unix)]
fn register(executable: &Path) -> Result<()> {
    use std::{fs, io::Write as _};
    let path = hook_path()?;
    let parent = path.parent().context("invalid login hook path")?;
    let command = executable_path(executable)?;
    #[cfg(target_os = "macos")]
    let bytes = launch_agent(command)?;
    #[cfg(target_os = "linux")]
    let bytes = desktop_entry(command)?.into_bytes();
    match fs::read(&path) {
        Ok(existing) if existing == bytes => return Ok(()),
        #[cfg(target_os = "linux")]
        Ok(existing)
            if String::from_utf8_lossy(&existing).lines().any(|line| {
                line.trim().eq_ignore_ascii_case("Hidden=true")
                    || line.trim().eq_ignore_ascii_case("X-GNOME-Autostart-enabled=false")
            }) =>
        {
            anyhow::bail!("proxy recovery is disabled in session startup settings")
        }
        Ok(_) => {}
        Err(e) if e.kind() == io::ErrorKind::NotFound => {}
        Err(e) => return Err(e.into()),
    }
    fs::create_dir_all(parent)?;
    let mut file = tempfile::NamedTempFile::new_in(parent)?;
    file.write_all(&bytes)?;
    file.as_file().sync_all()?;
    file.persist(&path)?;
    fs::File::open(parent)?.sync_all()?;
    Ok(())
}

#[cfg(target_os = "macos")]
fn launch_agent(executable: &str) -> Result<Vec<u8>> {
    #[derive(serde::Serialize)]
    #[serde(rename_all = "PascalCase")]
    struct Agent<'a> {
        label: String,
        associated_bundle_identifiers: [&'a str; 1],
        program_arguments: [&'a str; 2],
        run_at_load: bool,
    }
    let mut bytes = Vec::new();
    plist::to_writer_xml(
        &mut bytes,
        &Agent {
            label: hook_name(),
            associated_bundle_identifiers: [APP_ID],
            program_arguments: [executable, RECOVER_FLAG],
            run_at_load: true,
        },
    )?;
    Ok(bytes)
}

#[cfg(any(target_os = "linux", test))]
fn desktop_entry(executable: &str) -> Result<String> {
    ensure!(
        !executable.contains('='),
        "XDG Exec does not support '=' in an executable path"
    );
    // Exec quoting is decoded after the desktop-entry string's own escaping.
    let mut quoted = String::new();
    for ch in executable.chars() {
        match ch {
            '\\' | '"' | '`' | '$' => {
                quoted.push('\\');
                quoted.push(ch);
            }
            '%' => quoted.push_str("%%"),
            _ => quoted.push(ch),
        }
    }
    let quoted = quoted.replace('\\', "\\\\");
    Ok(format!(
        "[Desktop Entry]\nType=Application\nName=VergeN Proxy Recovery\nName[zh_CN]=VergeN 系统代理恢复\nExec=\"{quoted}\" {RECOVER_FLAG}\nTerminal=false\nStartupNotify=false\n"
    ))
}

#[cfg(target_os = "windows")]
const RUN: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";

#[cfg(target_os = "windows")]
fn register(executable: &Path) -> Result<()> {
    use winreg::{RegKey, enums::HKEY_CURRENT_USER};
    let exe = executable_path(executable)?;
    let command = format!(r#""{exe}" {RECOVER_FLAG}"#);
    ensure!(
        !exe.contains('"') && command.encode_utf16().count() <= 260,
        "unsupported recovery executable path for a Windows login item"
    );
    let (key, _) = RegKey::predef(HKEY_CURRENT_USER).create_subkey(RUN)?;
    let name = hook_name();
    if key.get_value::<String, _>(&name).is_ok_and(|saved| saved == command) {
        return Ok(());
    }
    key.set_value(name, &command)?;
    // The login item must survive power loss before the first OS proxy write.
    let status = unsafe { windows_sys::Win32::System::Registry::RegFlushKey(key.raw_handle()) };
    if status != 0 {
        return Err(io::Error::from_raw_os_error(status as i32).into());
    }
    Ok(())
}

pub(super) fn remove_login_hook() -> Result<()> {
    #[cfg(unix)]
    let removed = std::fs::remove_file(hook_path()?);
    #[cfg(target_os = "windows")]
    let removed = {
        use winreg::{
            RegKey,
            enums::{HKEY_CURRENT_USER, KEY_SET_VALUE},
        };
        RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey_with_flags(RUN, KEY_SET_VALUE)
            .and_then(|key| key.delete_value(hook_name()))
    };
    match removed {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.into()),
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn xdg_login_runs_the_quoted_executable_once_without_a_terminal() -> anyhow::Result<()> {
        let entry = super::desktop_entry("/opt/Team VPN/100%/V$ergeN")?;
        assert!(
            entry
                .lines()
                .any(|s| s == r#"Exec="/opt/Team VPN/100%%/V\\$ergeN" --recover-proxy"#)
        );
        assert!(entry.lines().any(|s| s == "Terminal=false"));
        Ok(())
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn launch_agent_passes_one_argument_without_keep_alive() -> anyhow::Result<()> {
        let executable = "/Applications/Company & VPN.app/Contents/MacOS/vergen";
        let bytes = super::launch_agent(executable)?;
        let agent: plist::Dictionary = plist::from_bytes(&bytes)?;
        let args = agent["ProgramArguments"]
            .as_array()
            .and_then(|a| a.first().zip(a.get(1)));
        assert_eq!(
            args.map(|(bin, arg)| (bin.as_string(), arg.as_string())),
            Some((Some(executable), Some(super::RECOVER_FLAG)))
        );
        assert_eq!(agent["RunAtLoad"].as_boolean(), Some(true));
        assert!(!agent.contains_key("KeepAlive"));
        Ok(())
    }
}
