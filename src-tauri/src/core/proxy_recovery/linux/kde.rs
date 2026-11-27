use super::Target;
use anyhow::{Context as _, Result, ensure};
use std::process::Command;

const KEYS: [&str; 6] = [
    "httpProxy",
    "httpsProxy",
    "socksProxy",
    "NoProxyFor",
    "Proxy Config Script",
    "ProxyType",
];
pub(super) type Values = [Option<String>; KEYS.len()];

fn major() -> &'static str {
    match std::env::var("KDE_SESSION_VERSION").as_deref() {
        Ok("6") => "6",
        Ok("5") => "5",
        // Recovery might be running under a different desktop or a minimal login environment.
        _ if std::env::var_os("PATH")
            .is_some_and(|paths| std::env::split_paths(&paths).any(|dir| dir.join("kreadconfig6").is_file())) =>
        {
            "6"
        }
        _ => "5",
    }
}

fn command(reading: bool, key: &str) -> Result<Command> {
    let major = major();
    let name = if reading { "kreadconfig" } else { "kwriteconfig" };
    let file = dirs::config_dir()
        .context("no KDE config directory")?
        .join("kioslaverc");
    let mut command = Command::new(format!("{name}{major}"));
    if std::env::var_os("APPIMAGE").is_some() {
        command.env_remove("LD_LIBRARY_PATH");
    }
    command
        .arg("--file")
        .arg(file)
        .args(["--group", "Proxy Settings", "--key", key]);
    Ok(command)
}

fn read_key(key: &str) -> Result<Option<String>> {
    let read_default = |default: &str| -> Result<String> {
        let out = command(true, key)?.args(["--default", default]).output()?;
        ensure!(out.status.success(), "could not read KDE proxy setting {key}");
        let mut value = String::from_utf8(out.stdout)?;
        ensure!(value.ends_with('\n'), "incomplete KDE proxy setting");
        value.pop();
        Ok(value)
    };
    const MISSING: &str = "vergen-missing-key";
    let first = read_default(MISSING)?;
    if first == MISSING && read_default("vergen-missing-key-2")? != MISSING {
        Ok(None)
    } else {
        Ok(Some(first))
    }
}

pub(super) fn read() -> Result<Values> {
    KEYS.iter()
        .map(|k| read_key(k))
        .collect::<Result<Vec<_>>>()?
        .try_into()
        .map_err(|_| anyhow::anyhow!("incomplete KDE snapshot"))
}

fn target_value(i: usize, target: &Target) -> Option<String> {
    let want = match (KEYS[i], target) {
        ("ProxyType", Target::Manual { .. }) => "1".to_owned(),
        ("ProxyType", Target::Pac { .. }) => "2".to_owned(),
        ("Proxy Config Script", Target::Pac { url, .. }) => url.clone(),
        ("NoProxyFor", Target::Manual { bypass, .. }) => bypass.clone(),
        ("httpProxy" | "httpsProxy" | "socksProxy", Target::Manual { host, port, .. }) => {
            let scheme = if KEYS[i] == "socksProxy" { "socks" } else { "http" };
            let host = if host.contains(':') && !(host.starts_with('[') && host.ends_with(']')) {
                format!("[{host}]")
            } else {
                host.clone()
            };
            format!("{scheme}://{host}:{port}")
        }
        _ => return None,
    };
    Some(want)
}

pub(super) fn matches(before: Option<&Values>, now: &Values, target: &Target) -> bool {
    now.iter().enumerate().all(|(i, seen)| {
        target_value(i, target).map_or_else(
            || before.is_none_or(|old| &old[i] == seen),
            |want| seen.as_ref() == Some(&want),
        )
    })
}

pub(super) fn desired(before: &Values, target: &Target) -> Values {
    std::array::from_fn(|i| target_value(i, target).or_else(|| before[i].clone()))
}

pub(super) fn is_prefix(from: &Values, to: &Values, now: &Values) -> bool {
    let mut state = from.clone();
    if &state == now {
        return true;
    }
    for i in 0..KEYS.len() {
        state[i].clone_from(&to[i]);
        if &state == now {
            return true;
        }
    }
    false
}

pub(super) fn restore(expected: &Values, original: &Values) -> Result<()> {
    ensure!(&read()? == expected, "KDE proxy changed before write");
    for (i, key) in KEYS.iter().enumerate() {
        if expected[i] == original[i] {
            continue;
        }
        ensure!(
            read_key(key)? == expected[i],
            "KDE proxy setting {key} changed during restore"
        );
        let mut command = command(false, key)?;
        command.arg("--notify");
        if let Some(previous) = &original[i] {
            command.args(["--", previous]);
        } else {
            command.arg("--delete");
        }
        ensure!(
            command.output()?.status.success(),
            "could not restore KDE proxy setting {key}"
        );
    }
    Ok(())
}
