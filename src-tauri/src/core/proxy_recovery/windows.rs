//! The WinINet setter also writes every RAS entry. Their original settings need not match the LAN's.
use super::Target;
use anyhow::{Context as _, Result, ensure};
use serde::{Deserialize, Serialize};
use std::{io, mem::size_of, ptr};
use windows::core::PCWSTR;
use windows_sys::Win32::{
    Foundation::GlobalFree,
    NetworkManagement::Rras::{ERROR_BUFFER_TOO_SMALL, RASENTRYNAMEW, RasEnumEntriesW},
    Networking::WinInet::{
        INTERNET_OPTION_PER_CONNECTION_OPTION, INTERNET_OPTION_PROXY_SETTINGS_CHANGED, INTERNET_OPTION_REFRESH,
        INTERNET_PER_CONN_AUTOCONFIG_URL, INTERNET_PER_CONN_FLAGS, INTERNET_PER_CONN_FLAGS_UI,
        INTERNET_PER_CONN_OPTION_LISTW, INTERNET_PER_CONN_OPTIONW, INTERNET_PER_CONN_OPTIONW_0,
        INTERNET_PER_CONN_PROXY_BYPASS, INTERNET_PER_CONN_PROXY_SERVER, InternetQueryOptionW, InternetSetOptionW,
        PROXY_TYPE_AUTO_DETECT, PROXY_TYPE_AUTO_PROXY_URL, PROXY_TYPE_DIRECT, PROXY_TYPE_PROXY,
    },
};
use winreg::{
    RegKey,
    enums::{HKEY_LOCAL_MACHINE, KEY_QUERY_VALUE},
};

const LAN: &str = "wininet:lan";
const RAS: &str = "wininet:ras:";
type Wide = Vec<u16>;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub(super) struct State {
    flags: u32,
    server: Wide,
    bypass: Wide,
    pac: Wide,
}

fn check_user_policy() -> Result<()> {
    let policy = RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey_with_flags(
            r"SOFTWARE\Policies\Microsoft\Windows\CurrentVersion\Internet Settings",
            KEY_QUERY_VALUE,
        )
        .and_then(|key| key.get_value::<u32, _>("ProxySettingsPerUser"));
    match policy {
        Ok(1) => {}
        Ok(_) => anyhow::bail!("WinINet proxy is managed machine-wide"),
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(error).context("read WinINet proxy scope policy"),
    }
    Ok(())
}

fn ras_names() -> Result<Vec<String>> {
    let mut entries = Vec::<RASENTRYNAMEW>::new();
    let mut count = 0;
    let mut bytes = 0;
    loop {
        let buffer = if let Some(first) = entries.first_mut() {
            first.dwSize = size_of::<RASENTRYNAMEW>() as u32;
            entries.as_mut_ptr()
        } else {
            ptr::null_mut()
        };
        // The first call obtains the size. Retry only if the phonebook actually grew.
        let code = unsafe { RasEnumEntriesW(ptr::null(), ptr::null(), buffer, &mut bytes, &mut count) };
        if code == 0 {
            break;
        }
        if code != ERROR_BUFFER_TOO_SMALL {
            return Err(io::Error::from_raw_os_error(code as i32)).context("enumerate WinINet phonebook entries");
        }
        let needed = (bytes as usize).div_ceil(size_of::<RASENTRYNAMEW>());
        ensure!(needed > entries.len(), "invalid RAS phonebook buffer size");
        entries.try_reserve(needed - entries.len())?;
        entries.resize(needed, RASENTRYNAMEW::default());
    }
    ensure!(count as usize <= entries.len(), "invalid RAS phonebook entry count");
    entries
        .iter()
        .take(count as usize)
        .map(|entry| {
            let end = entry
                .szEntryName
                .iter()
                .position(|&ch| ch == 0)
                .context("unterminated RAS name")?;
            ensure!(end > 0, "empty RAS name");
            Ok(String::from_utf16(&entry.szEntryName[..end])?)
        })
        .collect()
}

fn option(id: u32) -> INTERNET_PER_CONN_OPTIONW {
    INTERNET_PER_CONN_OPTIONW {
        dwOption: id,
        ..Default::default()
    }
}

fn option_list(name: &str, opts: &mut [INTERNET_PER_CONN_OPTIONW]) -> (Wide, INTERNET_PER_CONN_OPTION_LISTW) {
    let mut name: Wide = name.encode_utf16().chain([0]).collect();
    let list = INTERNET_PER_CONN_OPTION_LISTW {
        dwSize: size_of::<INTERNET_PER_CONN_OPTION_LISTW>() as u32,
        pszConnection: if name.len() == 1 {
            ptr::null_mut()
        } else {
            name.as_mut_ptr()
        },
        dwOptionCount: opts.len() as u32,
        dwOptionError: 0,
        pOptions: opts.as_mut_ptr(),
    };
    (name, list)
}

fn query(name: &str) -> Result<State> {
    let mut opts = [
        option(INTERNET_PER_CONN_FLAGS_UI),
        option(INTERNET_PER_CONN_PROXY_SERVER),
        option(INTERNET_PER_CONN_PROXY_BYPASS),
        option(INTERNET_PER_CONN_AUTOCONFIG_URL),
    ];
    let (_name, mut list) = option_list(name, &mut opts);
    let mut bytes = list.dwSize;
    let ok = unsafe {
        InternetQueryOptionW(
            ptr::null(),
            INTERNET_OPTION_PER_CONNECTION_OPTION,
            (&raw mut list).cast(),
            &mut bytes,
        )
    };
    let result = if ok == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    };
    // WinINet allocates a GlobalFree-owned wide string for each requested string option.
    let [server, bypass, pac] = [1, 2, 3].map(|idx| unsafe {
        let p = opts[idx].Value.pszValue;
        if p.is_null() {
            return Vec::new();
        }
        let value = if result.is_ok() {
            PCWSTR::from_raw(p).as_wide().to_vec()
        } else {
            Vec::new()
        };
        GlobalFree(p.cast());
        value
    });
    result.context("read WinINet proxy configuration")?;
    Ok(State {
        flags: unsafe { opts[0].Value.dwValue },
        server,
        bypass,
        pac,
    })
}

fn scope_names(names: impl IntoIterator<Item = String>) -> Vec<String> {
    std::iter::once(LAN.to_owned())
        .chain(names.into_iter().map(|n| format!("{RAS}{n}")))
        .collect()
}

pub(super) fn scopes() -> Result<Vec<String>> {
    check_user_policy()?;
    Ok(scope_names(ras_names()?))
}

fn connection_name(scope: &str) -> Result<Option<&str>> {
    check_user_policy()?;
    if scope == LAN {
        return Ok(Some(""));
    }
    let name = scope
        .strip_prefix(RAS)
        .filter(|s| !s.is_empty() && !s.contains('\0'))
        .context("invalid WinINet connection scope")?;
    Ok(ras_names()?.iter().any(|n| n == name).then_some(name))
}

pub(super) fn read_optional(scope: &str) -> Result<Option<State>> {
    connection_name(scope)?.map(query).transpose()
}

pub(super) fn read(scope: &str) -> Result<State> {
    read_optional(scope)?.context("WinINet connection no longer exists")
}

pub(super) fn matches(state: &State, target: &Target) -> bool {
    match target {
        Target::Manual { host, port, bypass } => {
            state.flags == PROXY_TYPE_DIRECT | PROXY_TYPE_PROXY
                && state.server.iter().copied().eq(format!("{host}:{port}").encode_utf16())
                && state.bypass.iter().copied().eq(bypass.encode_utf16())
        }
        Target::Pac { url, .. } => {
            state.flags == PROXY_TYPE_DIRECT | PROXY_TYPE_AUTO_PROXY_URL | PROXY_TYPE_AUTO_DETECT
                && state.pac.iter().copied().eq(url.encode_utf16())
        }
    }
}

pub(super) fn matches_after(before: &State, state: &State, target: &Target) -> bool {
    matches(state, target)
        && match target {
            Target::Manual { .. } => before.pac == state.pac,
            Target::Pac { .. } => before.server == state.server && before.bypass == state.bypass,
        }
}

pub(super) fn can_resume_apply(before: &State, current: &State, target: &Target) -> bool {
    // One WinINet option list commits a single connection.
    current == before || matches_after(before, current, target)
}

pub(super) fn can_resume_restore(current: &State, written: &State, original: &State) -> bool {
    current == written || current == original
}

fn set_option(id: u32, ptr: *const std::ffi::c_void, size: u32) -> Result<()> {
    let ok = unsafe { InternetSetOptionW(ptr::null(), id, ptr, size) };
    if ok == 0 {
        return Err(io::Error::last_os_error()).context("write WinINet proxy configuration");
    }
    Ok(())
}

fn write(name: &str, connection: &State) -> Result<()> {
    let mut opts = [
        option(INTERNET_PER_CONN_FLAGS),
        option(INTERNET_PER_CONN_PROXY_SERVER),
        option(INTERNET_PER_CONN_PROXY_BYPASS),
        option(INTERNET_PER_CONN_AUTOCONFIG_URL),
    ];
    // FLAGS_UI is for reading; Microsoft requires FLAGS when restoring the user's selection.
    opts[0].Value = INTERNET_PER_CONN_OPTIONW_0 {
        dwValue: connection.flags,
    };
    let mut strings = [&connection.server, &connection.bypass, &connection.pac]
        .map(|s| s.iter().copied().chain([0]).collect::<Wide>());
    for (opt, string) in opts[1..].iter_mut().zip(&mut strings) {
        opt.Value = INTERNET_PER_CONN_OPTIONW_0 {
            pszValue: string.as_mut_ptr(),
        };
    }
    let (_name, list) = option_list(name, &mut opts);
    set_option(
        INTERNET_OPTION_PER_CONNECTION_OPTION,
        (&raw const list).cast(),
        list.dwSize,
    )
}

pub(super) fn restore(scope: &str, expected: &State, original: &State) -> Result<()> {
    let name = connection_name(scope)?.context("WinINet connection no longer exists")?;
    ensure!(query(name)? == *expected, "WinINet connection changed before write");
    write(name, original)?;
    set_option(INTERNET_OPTION_PROXY_SETTINGS_CHANGED, ptr::null(), 0)?;
    set_option(INTERNET_OPTION_REFRESH, ptr::null(), 0)?;
    ensure!(&read(scope)? == original, "WinINet write did not take effect");
    Ok(())
}

fn desired(before: &State, target: &Target) -> State {
    let mut state = before.clone();
    match target {
        Target::Manual { host, port, bypass } => {
            state.flags = PROXY_TYPE_DIRECT | PROXY_TYPE_PROXY;
            state.server = format!("{host}:{port}").encode_utf16().collect();
            state.bypass = bypass.encode_utf16().collect();
        }
        Target::Pac { url, .. } => {
            state.flags = PROXY_TYPE_DIRECT | PROXY_TYPE_AUTO_PROXY_URL | PROXY_TYPE_AUTO_DETECT;
            state.pac = url.encode_utf16().collect();
        }
    }
    state
}

pub(super) fn apply(scope: &str, before: &State, target: &Target) -> Result<()> {
    restore(scope, before, &desired(before, target))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adding_or_removing_ras_never_renames_or_replaces_the_lan_scope() {
        assert_eq!(scope_names(["office".into()]), [LAN, "wininet:ras:office"]);
        assert_eq!(
            scope_names(["new".into(), "office".into()]),
            [LAN, "wininet:ras:new", "wininet:ras:office"]
        );
        assert_eq!(scope_names([]), [LAN]);
    }

    #[test]
    fn pac_does_not_acquire_someone_elses_dormant_per_protocol_settings() {
        let before = State {
            flags: PROXY_TYPE_PROXY | PROXY_TYPE_DIRECT,
            server: "http=corp:80;https=secure:443".encode_utf16().collect(),
            bypass: vec![],
            pac: vec![],
        };
        let target = Target::Pac {
            url: "http://127.0.0.1:5000/commands/pac".into(),
            bypass: None,
        };
        let mut written = desired(&before, &target);
        assert!(matches_after(&before, &written, &target));
        written.server = "new:8080".encode_utf16().collect();
        assert!(!can_resume_apply(&before, &written, &target));
    }
}
