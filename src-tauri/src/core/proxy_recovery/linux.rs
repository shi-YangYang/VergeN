//! Plasma and GTK can use different proxies. Each backend has its own receipt and CAS.
use super::Target;
use anyhow::{Context as _, Result, bail, ensure};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[path = "linux/gnome.rs"]
mod gnome;
#[path = "linux/kde.rs"]
mod kde;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(super) enum State {
    Gnome(Box<gnome::Values>),
    Kde(kde::Values),
}

#[derive(PartialEq, Eq, Serialize, Deserialize)]
enum Scope {
    Gnome {
        config: PathBuf,
        profile: Option<String>,
        backend: Option<String>,
    },
    Kde {
        config: PathBuf,
    },
}

impl Scope {
    fn gnome() -> Result<Self> {
        Ok(Self::Gnome {
            config: dirs::config_dir().context("missing user configuration directory")?,
            profile: std::env::var("DCONF_PROFILE").ok(),
            backend: std::env::var("GSETTINGS_BACKEND").ok(),
        })
    }
    fn kde() -> Result<Self> {
        Ok(Self::Kde {
            config: dirs::config_dir().context("missing user configuration directory")?,
        })
    }

    fn current(key: &str) -> Result<Self> {
        let saved = serde_json::from_str(key)?;
        let actual = match saved {
            Self::Gnome { .. } => Self::gnome()?,
            Self::Kde { .. } => Self::kde()?,
        };
        ensure!(saved == actual, "Linux proxy belongs to another settings profile");
        Ok(actual)
    }
}

pub(super) fn scopes() -> Result<Vec<String>> {
    let plasma = std::env::var("XDG_CURRENT_DESKTOP")
        .unwrap_or_default()
        .split(':')
        .any(|s| s.eq_ignore_ascii_case("KDE"));
    let mut scopes = Vec::new();
    if gnome::root(plasma)?.is_some() {
        scopes.push(serde_json::to_string(&Scope::gnome()?)?);
    }
    if plasma {
        scopes.push(serde_json::to_string(&Scope::kde()?)?);
    }
    ensure!(!scopes.is_empty(), "no supported desktop proxy settings");
    Ok(scopes)
}

pub(super) fn read(scope: &str) -> Result<State> {
    match Scope::current(scope)? {
        Scope::Gnome { .. } => Ok(State::Gnome(Box::new(gnome::read(&gnome_root()?)?))),
        Scope::Kde { .. } => Ok(State::Kde(kde::read()?)),
    }
}

fn gnome_root() -> Result<gio::Settings> {
    gnome::root(false)?.context("GNOME proxy settings are unavailable")
}

pub(super) fn matches(state: &State, target: &Target) -> bool {
    match state {
        State::Gnome(v) => gnome::matches(None, v, target),
        State::Kde(v) => kde::matches(None, v, target),
    }
}

pub(super) fn matches_after(before: &State, current: &State, target: &Target) -> bool {
    match (before, current) {
        (State::Gnome(old), State::Gnome(now)) => gnome::matches(Some(old), now, target),
        (State::Kde(old), State::Kde(now)) => kde::matches(Some(old), now, target),
        _ => false,
    }
}

pub(super) fn can_resume_apply(before: &State, current: &State, target: &Target) -> bool {
    match (before, current) {
        (State::Kde(old), State::Kde(now)) => kde::is_prefix(old, &kde::desired(old, target), now),
        // GSettings commits the keys in one delayed transaction.
        _ => before == current || matches_after(before, current, target),
    }
}

pub(super) fn can_resume_restore(current: &State, written: &State, original: &State) -> bool {
    match (current, written, original) {
        (State::Kde(now), State::Kde(ours), State::Kde(old)) => kde::is_prefix(ours, old, now),
        _ => current == written || current == original,
    }
}

pub(super) fn restore(scope: &str, expected: &State, original: &State) -> Result<()> {
    match (Scope::current(scope)?, expected, original) {
        (Scope::Gnome { .. }, State::Gnome(seen), State::Gnome(old)) => gnome::restore(&gnome_root()?, seen, old)?,
        (Scope::Kde { .. }, State::Kde(seen), State::Kde(old)) => kde::restore(seen, old)?,
        _ => bail!("proxy receipt does not match the Linux settings backend"),
    }
    ensure!(&read(scope)? == original, "Linux proxy write did not take effect");
    Ok(())
}

pub(super) fn apply(scope: &str, before: &State, target: &Target) -> Result<()> {
    let desired = match before {
        State::Gnome(old) => State::Gnome(Box::new(gnome::desired(old, target))),
        State::Kde(old) => State::Kde(kde::desired(old, target)),
    };
    restore(scope, before, &desired)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plasma_pac_takeover_only_claims_its_backend_and_an_exact_prefix() {
        let mut old_values: kde::Values = Default::default();
        old_values[5] = Some("1".into());
        let old = State::Kde(old_values.clone());
        let target = Target::Pac {
            url: "http://127.0.0.1:33211/commands/pac".into(),
            bypass: None,
        };
        let after = kde::desired(&old_values, &target);
        let mut now = old_values;
        now[4].clone_from(&after[4]);
        assert!(can_resume_apply(&old, &State::Kde(now.clone()), &target));
        now[0] = Some("http://different.invalid:80".into());
        assert!(!can_resume_apply(&old, &State::Kde(now), &target));
        assert!(matches_after(&old, &State::Kde(after), &target));
        assert_ne!(
            serde_json::to_string(&Scope::Kde {
                config: "/fixture".into()
            })
            .ok(),
            serde_json::to_string(&Scope::Gnome {
                config: "/fixture".into(),
                profile: None,
                backend: None
            })
            .ok()
        );
    }
}
