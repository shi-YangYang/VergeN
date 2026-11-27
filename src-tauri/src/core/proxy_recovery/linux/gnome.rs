use super::Target;
use anyhow::{Context as _, Result, ensure};
use gio::{
    Settings, SettingsBackend, SettingsSchemaSource,
    glib::{ToVariant as _, Variant},
    prelude::*,
};
use serde::{Deserialize, Serialize};

const SCHEMA: &str = "org.gnome.system.proxy";
const KEYS: [(&str, &str); 9] = [
    ("http", "host"),
    ("http", "port"),
    ("https", "host"),
    ("https", "port"),
    ("socks", "host"),
    ("socks", "port"),
    ("", "ignore-hosts"),
    ("", "autoconfig-url"),
    ("", "mode"),
];

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct Value {
    effective: String,
    user: Option<String>,
}

pub(super) type Values = [Value; KEYS.len()];

pub(super) fn root(optional: bool) -> Result<Option<Settings>> {
    let schema = SettingsSchemaSource::default().and_then(|source| source.lookup(SCHEMA, true));
    let backend = SettingsBackend::default();
    let kind = backend.type_();
    let persistent = !matches!(kind.name(), "GMemorySettingsBackend" | "GNullSettingsBackend");
    if optional && (!persistent || schema.is_none()) {
        return Ok(None);
    }
    ensure!(persistent, "GNOME proxy settings are not persistent");
    Ok(Some(Settings::new_full(
        &schema.context("missing GNOME proxy schema")?,
        Some(&backend),
        None,
    )))
}

fn each_key(root: &Settings, mut f: impl FnMut(usize, &Settings, &str) -> Result<()>) -> Result<()> {
    let children = root.list_children();
    for (index, (child, key)) in KEYS.iter().copied().enumerate() {
        let settings = if child.is_empty() {
            root.clone()
        } else {
            ensure!(
                children.iter().any(|name| name.as_str() == child),
                "missing GNOME proxy schema child {child}"
            );
            root.child(child)
        };
        ensure!(
            settings.settings_schema().is_some_and(|s| s.has_key(key)),
            "missing GNOME proxy key {key}"
        );
        f(index, &settings, key)?;
    }
    Ok(())
}

pub(super) fn read(root: &Settings) -> Result<Values> {
    let mut values = Vec::with_capacity(KEYS.len());
    each_key(root, |_, settings, key| {
        values.push(Value {
            effective: settings.value(key).print(false).to_string(),
            user: settings.user_value(key).map(|v| v.print(false).to_string()),
        });
        Ok(())
    })?;
    values
        .try_into()
        .map_err(|_| anyhow::anyhow!("incomplete GNOME snapshot"))
}

fn target_value(index: usize, target: &Target) -> Option<String> {
    let value = match (KEYS[index].1, target) {
        ("host", Target::Manual { host, .. }) => host.to_variant(),
        ("port", Target::Manual { port, .. }) => i32::from(*port).to_variant(),
        ("ignore-hosts", Target::Manual { bypass, .. }) => {
            let entries: Vec<_> = bypass.split(',').map(|s| s.trim().trim_matches(['\'', '"'])).collect();
            entries.to_variant()
        }
        ("autoconfig-url", Target::Pac { url, .. }) => url.to_variant(),
        ("mode", Target::Pac { .. }) => "auto".to_variant(),
        ("mode", Target::Manual { .. }) => "manual".to_variant(),
        _ => return None,
    };
    Some(value.print(false).to_string())
}

pub(super) fn matches(before: Option<&Values>, now: &Values, target: &Target) -> bool {
    now.iter().enumerate().all(|(index, seen)| {
        target_value(index, target).map_or_else(
            || before.is_none_or(|old| old[index] == *seen),
            |value| seen.effective == value,
        )
    })
}

pub(super) fn desired(before: &Values, target: &Target) -> Values {
    std::array::from_fn(|i| {
        if let Some(value) = target_value(i, target)
            && before[i].effective != value
        {
            Value {
                user: Some(value.clone()),
                effective: value,
            }
        } else {
            before[i].clone()
        }
    })
}

pub(super) fn restore(root: &Settings, expected: &Values, original: &Values) -> Result<()> {
    ensure!(&read(root)? == expected, "GNOME proxy settings changed before restore");
    // Children inherit the parent's delayed backend. Restore all nine keys as one GSettings transaction.
    root.delay();
    each_key(root, |i, settings, key| {
        if expected[i] != original[i] {
            ensure!(settings.is_writable(key), "GNOME proxy key {key} is managed");
            if let Some(text) = &original[i].user {
                let current = settings.value(key);
                let value = Variant::parse(Some(current.type_()), text)?;
                settings.set_value(key, &value)?;
            } else {
                settings.reset(key);
            }
        }
        Ok(())
    })?;
    root.apply();
    Settings::sync();
    Ok(())
}
