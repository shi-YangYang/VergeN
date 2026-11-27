//! SystemConfiguration stores a distinct proxy dictionary on each network service, including offline services.
#[path = "macos/cli.rs"]
mod cli;
#[path = "macos/preferences.rs"]
mod preferences;

use super::Target;
use anyhow::{Context as _, Result, ensure};
use plist::{Dictionary, Value};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::fmt;

#[derive(Clone, PartialEq, Serialize, Deserialize)]
pub(super) struct State(#[serde(with = "wire")] Option<Dictionary>);

impl Eq for State {}

impl fmt::Debug for State {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("macOS proxy configuration")
    }
}

// JSON alone cannot distinguish plist Data/Date from arrays/strings. PAC URLs may also be private;
// the entire value belongs only in the owner's protected receipt, never in an error or log.
mod wire {
    use super::{Deserialize as _, Deserializer, Dictionary, Result, Serialize as _, Serializer, State, Value};

    pub(super) fn serialize<S: Serializer>(state: &Option<Dictionary>, serializer: S) -> Result<S::Ok, S::Error> {
        state
            .as_ref()
            .map(|dict| {
                let mut bytes = Vec::new();
                Value::Dictionary(dict.clone())
                    .to_writer_xml(&mut bytes)
                    .map_err(serde::ser::Error::custom)?;
                String::from_utf8(bytes).map_err(serde::ser::Error::custom)
            })
            .transpose()?
            .serialize(serializer)
    }

    pub(super) fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Option<Dictionary>, D::Error> {
        Option::<String>::deserialize(deserializer)?
            .map(|xml| State::parse(xml.as_bytes()).map_err(serde::de::Error::custom))
            .transpose()
    }
}

impl State {
    fn parse(bytes: &[u8]) -> Result<Dictionary> {
        let value = Value::from_reader_xml(bytes).context("invalid native proxy plist")?;
        fn comparable(value: &Value) -> bool {
            match value {
                Value::Real(n) => !n.is_nan(),
                Value::Dictionary(dict) => dict.values().all(comparable),
                Value::Array(array) => array.iter().all(comparable),
                _ => true,
            }
        }
        ensure!(comparable(&value), "uncomparable native proxy plist");
        value
            .into_dictionary()
            .context("native proxy plist is not a dictionary")
    }

    fn dict(&self) -> Dictionary {
        self.0.clone().unwrap_or_default()
    }
}

const PROTOCOLS: [(&str, &str, &str); 3] = [
    ("HTTPEnable", "HTTPProxy", "HTTPPort"),
    ("HTTPSEnable", "HTTPSProxy", "HTTPSPort"),
    ("SOCKSEnable", "SOCKSProxy", "SOCKSPort"),
];
const PAC_FLAG: &str = "ProxyAutoConfigEnable";
const PAC_URL: &str = "ProxyAutoConfigURLString";
const EXCEPTIONS: &str = "ExceptionsList";

fn num(n: u16) -> Value {
    Value::Integer(n.into())
}

fn put(dict: &mut Dictionary, key: &str, value: Value) {
    dict.insert(key.to_owned(), value);
}

fn strings(list: &str) -> Value {
    Value::Array(if list.is_empty() {
        Vec::new()
    } else {
        list.split(',').map(|s| Value::String(s.to_owned())).collect()
    })
}

fn flag(dict: &Dictionary, key: &str) -> Option<bool> {
    match dict.get(key) {
        None => Some(false),
        Some(Value::Integer(i)) => i.as_unsigned().and_then(|n| (n <= 1).then_some(n == 1)),
        Some(Value::Boolean(b)) => Some(*b),
        _ => None,
    }
}

fn service_result(before: &State, target: Option<&Target>) -> State {
    let mut dict = before.dict();
    let manual = matches!(target, Some(Target::Manual { .. }));
    let (host, port, bypass, url) = match target {
        Some(Target::Manual { host, port, bypass }) => (host.as_str(), *port, bypass.as_str(), ""),
        Some(Target::Pac { url, .. }) => ("", 0, "", url.as_str()),
        None => ("", 0, "", ""),
    };
    for (enable, address, number) in PROTOCOLS {
        put(&mut dict, address, Value::String(host.to_owned()));
        put(&mut dict, number, num(port));
        put(&mut dict, enable, num(u16::from(manual)));
    }
    put(&mut dict, EXCEPTIONS, strings(bypass));
    put(&mut dict, PAC_URL, Value::String(url.to_owned()));
    put(&mut dict, PAC_FLAG, num(u16::from(!url.is_empty())));
    State(Some(dict))
}

// The local writer leaves inactive endpoints intact. The pinned service writer intentionally doesn't.
fn local_result(before: &State, target: &Target) -> State {
    let mut dict = before.dict();
    for (enable, host_key, port_key) in PROTOCOLS {
        if let Target::Manual { host, port, .. } = target {
            put(&mut dict, host_key, Value::String(host.clone()));
            put(&mut dict, port_key, num(*port));
        }
        put(
            &mut dict,
            enable,
            num(u16::from(matches!(target, Target::Manual { .. }))),
        );
    }
    if let Target::Pac { url, .. } = target {
        put(&mut dict, PAC_URL, Value::String(url.clone()));
    }
    put(
        &mut dict,
        PAC_FLAG,
        num(u16::from(matches!(target, Target::Pac { .. }))),
    );
    match target {
        Target::Manual { bypass, .. }
        | Target::Pac {
            bypass: Some(bypass), ..
        } => {
            put(&mut dict, EXCEPTIONS, strings(bypass));
        }
        Target::Pac { bypass: None, .. } => put(&mut dict, EXCEPTIONS, strings("")),
    }
    State(Some(dict))
}

pub(super) fn matches(state: &State, target: &Target) -> bool {
    let dict = state.dict();
    let manual = matches!(target, Target::Manual { .. });
    if flag(&dict, PAC_FLAG) != Some(!manual)
        || !PROTOCOLS
            .iter()
            .all(|(enable, _, _)| flag(&dict, enable) == Some(manual))
    {
        return false;
    }
    let bypass = match target {
        Target::Manual { host, port, bypass } => {
            if !PROTOCOLS.iter().all(|(_, h, p)| {
                dict.get(h).and_then(Value::as_string) == Some(host.as_str())
                    && dict.get(p).and_then(Value::as_unsigned_integer) == Some(u64::from(*port))
            }) {
                return false;
            }
            bypass.as_str()
        }
        Target::Pac { url, bypass } => {
            if dict.get(PAC_URL).and_then(Value::as_string) != Some(url.as_str()) {
                return false;
            }
            bypass.as_deref().unwrap_or("")
        }
    };
    dict.get(EXCEPTIONS).cloned().unwrap_or_else(|| strings("")) == strings(bypass)
}

pub(super) fn matches_after(before: &State, state: &State, target: &Target) -> bool {
    state == &service_result(before, Some(target)) || cli::equivalent(state, &local_result(before, target))
}

pub(super) fn service_cleared(before: &State, after: &State) -> bool {
    after == &service_result(before, None)
}

pub(super) fn service_clear_is_harmless(state: &State) -> bool {
    cli::equivalent(state, &service_result(state, None))
}

pub(super) fn can_resume_apply(before: &State, current: &State, target: &Target) -> bool {
    cli::is_prefix(before, &local_result(before, target), current)
}

pub(super) fn can_resume_restore(current: &State, written: &State, original: &State) -> bool {
    current == written || cli::is_prefix(written, original, current)
}

pub(super) fn restored(current: &State, written: &State, original: &State) -> bool {
    current == original || cli::completed(written, original, current)
}

pub(super) use preferences::{active_scope, read, service_scopes};

pub(super) fn preflight_restore(scope: &str, before: &State) -> Result<()> {
    if preferences::locked()?.is_some() {
        return Ok(());
    }
    cli::preflight(scope, before)
}

pub(super) fn apply(scope: &str, before: &State, target: &Target) -> Result<()> {
    write(scope, before, &local_result(before, target))
}

pub(super) fn restore(scope: &str, expected: &State, original: &State) -> Result<()> {
    write(scope, expected, original)
}

fn write(scope: &str, expected: &State, desired: &State) -> Result<()> {
    if let Some(locked) = preferences::locked()? {
        return locked.compare_and_set(scope, expected, desired);
    }
    cli::write(scope, expected, desired)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn company_proxy() -> State {
        let mut d = Dictionary::new();
        for (i, (enabled, host, port)) in PROTOCOLS.into_iter().enumerate() {
            put(&mut d, enabled, num(u16::from(i != 1)));
            put(&mut d, host, Value::String(format!("proxy-{i}.corp.example")));
            put(&mut d, port, num(4310 + i as u16));
        }
        put(
            &mut d,
            PAC_URL,
            Value::String("https://intranet.example/proxy.pac".into()),
        );
        put(&mut d, PAC_FLAG, num(0));
        put(&mut d, EXCEPTIONS, strings("private.corp.example,*.local"));
        put(&mut d, "FTPPassive", num(1));
        State(Some(d))
    }

    fn target() -> Target {
        Target::Manual {
            host: "127.0.0.1".into(),
            port: 7897,
            bypass: "localhost,*.local".into(),
        }
    }

    #[test]
    fn receipt_preserves_distinct_ports_pac_bypass_and_native_auth_metadata() -> Result<()> {
        let mut d = company_proxy().dict();
        put(&mut d, "HTTPProxyRequiresPassword", num(1));
        put(&mut d, "OpaqueReference", Value::Data(vec![1, 8, 0]));
        let original = State(Some(d));
        let roundtrip: State = serde_json::from_slice(&serde_json::to_vec(&original)?)?;
        assert_eq!(original, roundtrip);
        let applied = service_result(&original, Some(&target()));
        assert!(matches_after(&original, &applied, &target()));
        let stopped = service_result(&applied, None);
        assert!(service_cleared(&applied, &stopped));
        let mut external = stopped.dict();
        put(&mut external, "FTPPassive", num(0));
        assert!(!service_cleared(&applied, &State(Some(external))));
        assert!(!restored(&stopped, &applied, &original));
        Ok(())
    }

    #[test]
    fn interrupted_local_write_is_only_recognized_with_all_unrelated_fields_unchanged() {
        let original = company_proxy();
        let mut partial = original.dict();
        put(&mut partial, "HTTPProxy", Value::String("127.0.0.1".into()));
        put(&mut partial, "HTTPPort", num(7897));
        assert!(can_resume_apply(&original, &State(Some(partial.clone())), &target()));
        put(&mut partial, "ProxyAutoDiscoveryEnable", num(1));
        assert!(!can_resume_apply(&original, &State(Some(partial)), &target()));
    }

    #[test]
    fn dormant_compatibility_requires_disabled_and_matches_the_written_endpoint() {
        let original = State(None);
        let written = local_result(&original, &target());
        let mut direct = written.dict();
        for (enable, _, _) in PROTOCOLS {
            put(&mut direct, enable, num(0));
        }
        direct.remove(EXCEPTIONS);
        assert!(restored(&State(Some(direct.clone())), &written, &original));
        put(&mut direct, "HTTPProxy", Value::String("later.corp.example".into()));
        assert!(!restored(&State(Some(direct.clone())), &written, &original));
        assert!(!restored(&State(Some(direct)), &written, &company_proxy()));
    }

    #[test]
    fn service_pac_and_sidecar_pac_preserve_different_inactive_fields() {
        let original = company_proxy();
        let local = Target::Pac {
            url: "http://127.0.0.1:4567/commands/pac".into(),
            bypass: Some("localhost".into()),
        };
        let through_service = Target::Pac {
            url: "http://127.0.0.1:4567/commands/pac".into(),
            bypass: None,
        };
        let applied = local_result(&original, &local);
        assert!(matches_after(&original, &applied, &local));
        assert!(!matches_after(&original, &applied, &through_service));
        assert!(matches_after(
            &original,
            &service_result(&original, Some(&through_service)),
            &through_service
        ));
    }
}
