//! Unprivileged fallback for macOS administrators: Apple's networksetup applies one operation at a time.
use super::{EXCEPTIONS, PAC_FLAG, PAC_URL, PROTOCOLS, State, flag, num, preferences, put, read};
use anyhow::{Context as _, Result, ensure};
use plist::{Dictionary, Value};
use std::process::Command;

const COMMANDS: [(&str, &str); 3] = [
    ("-setwebproxy", "-setwebproxystate"),
    ("-setsecurewebproxy", "-setsecurewebproxystate"),
    ("-setsocksfirewallproxy", "-setsocksfirewallproxystate"),
];

fn normalized(state: &State) -> Dictionary {
    let mut d = state.dict();
    for (enable, host, port) in PROTOCOLS {
        if flag(&d, enable) == Some(false) {
            d.remove(enable);
        }
        if d.get(host).and_then(Value::as_string) == Some("") {
            d.remove(host);
        }
        if d.get(port).and_then(Value::as_signed_integer) == Some(0) {
            d.remove(port);
        }
    }
    if flag(&d, PAC_FLAG) == Some(false) {
        d.remove(PAC_FLAG);
    }
    if d.get(PAC_URL).and_then(Value::as_string) == Some("") {
        d.remove(PAC_URL);
    }
    if d.get(EXCEPTIONS).and_then(Value::as_array).is_some_and(Vec::is_empty) {
        d.remove(EXCEPTIONS);
    }
    d
}

pub(super) fn equivalent(a: &State, b: &State) -> bool {
    normalized(a) == normalized(b)
}

fn has_credentials(dict: &Dictionary) -> bool {
    dict.iter().any(|(key, value)| {
        let name = key.to_ascii_lowercase();
        (name.contains("auth") || name.contains("user") || name.contains("password"))
            && value.as_boolean() != Some(false)
            && value.as_signed_integer() != Some(0)
            && value.as_string() != Some("")
    })
}

fn representable(dict: &Dictionary) -> Result<()> {
    // Changing an authenticated endpoint with networksetup can discard its Keychain association.
    ensure!(
        !has_credentials(dict),
        "this macOS proxy needs authorized native restoration"
    );
    for (enable, host, port) in PROTOCOLS {
        let enabled = flag(dict, enable).context("unrecognized macOS proxy flag")?;
        let host = dict
            .get(host)
            .map(Value::as_string)
            .unwrap_or(Some(""))
            .context("invalid proxy host")?;
        let port = dict
            .get(port)
            .map(|v| v.as_unsigned_integer().and_then(|p| u16::try_from(p).ok()))
            .unwrap_or(Some(0))
            .context("invalid proxy port")?;
        ensure!(
            host.is_empty() == (port == 0) && (!enabled || port != 0),
            "incomplete macOS proxy needs native restoration"
        );
        ensure!(
            !host.contains(['\0', '@']),
            "opaque macOS proxy host needs native restoration"
        );
    }
    let url = dict
        .get(PAC_URL)
        .map(Value::as_string)
        .unwrap_or(Some(""))
        .context("invalid PAC URL")?;
    ensure!(
        !flag(dict, PAC_FLAG).context("unrecognized PAC switch")? || !url.is_empty(),
        "empty active PAC needs native restoration"
    );
    ensure!(!url.contains(['\0', '@']), "opaque PAC URL needs native restoration");
    if let Some(values) = dict.get(EXCEPTIONS) {
        ensure!(
            values.as_array().is_some_and(|v| v.iter().all(|s| s
                .as_string()
                .is_some_and(|s| !s.contains('\0') && !s.eq_ignore_ascii_case("Empty")))),
            "unsupported proxy bypass list"
        );
    }
    Ok(())
}

pub(super) fn preflight(scope: &str, state: &State) -> Result<()> {
    preferences::networksetup_name(scope)?;
    let groups = Command::new("/usr/bin/id").arg("-Gn").output()?;
    ensure!(
        groups.status.success() && groups.stdout.split(u8::is_ascii_whitespace).any(|g| g == b"admin"),
        "macOS policy does not grant this account silent permission to restore network proxies"
    );
    representable(&state.dict())
}

struct Step {
    op: &'static str,
    args: Vec<String>,
    after: State,
}

fn step(steps: &mut Vec<Step>, op: &'static str, args: Vec<String>, d: &mut Dictionary, values: &[(&str, Value)]) {
    for (key, value) in values {
        put(d, key, value.clone());
    }
    steps.push(Step {
        op,
        args,
        after: State(Some(d.clone())),
    });
}

fn switch(steps: &mut Vec<Step>, d: &mut Dictionary, enable: &str, op: &'static str, on: bool) {
    if flag(d, enable) != Some(on) {
        step(
            steps,
            op,
            vec![if on { "on" } else { "off" }.to_owned()],
            d,
            &[(enable, num(u16::from(on)))],
        );
    }
}

// networksetup has no "delete dormant proxy address" primitive. Preserve every original nonempty
// address, and only tolerate an inert leftover if it is exactly the address in our write receipt.
fn allowed_dormant(from: &State, want: &State, now: &State) -> bool {
    let original = normalized(want);
    let written = normalized(from);
    let mut current = normalized(now);
    for (enable, host, port) in PROTOCOLS {
        if flag(&original, enable) == Some(false)
            && flag(&current, enable) == Some(false)
            && !original.contains_key(host)
            && !original.contains_key(port)
            && current.get(host) == written.get(host)
            && current.get(port) == written.get(port)
        {
            current.remove(host);
            current.remove(port);
        }
    }
    if flag(&original, PAC_FLAG) == Some(false)
        && flag(&current, PAC_FLAG) == Some(false)
        && !original.contains_key(PAC_URL)
        && current.get(PAC_URL) == written.get(PAC_URL)
    {
        current.remove(PAC_URL);
    }
    original == current
}

pub(super) fn completed(from: &State, want: &State, now: &State) -> bool {
    allowed_dormant(from, want, now)
}

fn steps(from: &State, want: &State) -> Result<Vec<Step>> {
    let mut result = Vec::new();
    let mut working = from.dict();
    let target = want.dict();
    representable(&working)?;
    representable(&target)?;

    // Remove a mode we no longer own before enabling its replacement.
    if flag(&target, PAC_FLAG) == Some(false) {
        switch(&mut result, &mut working, PAC_FLAG, "-setautoproxystate", false);
    }
    for ((enable, host_key, port_key), (configure, toggle)) in PROTOCOLS.into_iter().zip(COMMANDS) {
        if let Some(host) = target
            .get(host_key)
            .and_then(Value::as_string)
            .filter(|s| !s.is_empty())
        {
            let port = target
                .get(port_key)
                .and_then(Value::as_unsigned_integer)
                .context("invalid proxy port")?;
            if working.get(host_key) != target.get(host_key) || working.get(port_key) != target.get(port_key) {
                step(
                    &mut result,
                    configure,
                    vec![host.to_owned(), port.to_string()],
                    &mut working,
                    &[
                        (host_key, Value::String(host.to_owned())),
                        (port_key, num(u16::try_from(port)?)),
                        (enable, num(1)),
                    ],
                );
            }
        }
        switch(
            &mut result,
            &mut working,
            enable,
            toggle,
            flag(&target, enable) == Some(true),
        );
    }
    if let Some(url) = target.get(PAC_URL).and_then(Value::as_string).filter(|s| !s.is_empty())
        && working.get(PAC_URL) != target.get(PAC_URL)
    {
        step(
            &mut result,
            "-setautoproxyurl",
            vec![url.to_owned()],
            &mut working,
            &[(PAC_URL, Value::String(url.to_owned())), (PAC_FLAG, num(1))],
        );
    }
    switch(
        &mut result,
        &mut working,
        PAC_FLAG,
        "-setautoproxystate",
        flag(&target, PAC_FLAG) == Some(true),
    );
    let empty = Value::Array(Vec::new());
    if working.get(EXCEPTIONS).unwrap_or(&empty) != target.get(EXCEPTIONS).unwrap_or(&empty) {
        let list = target.get(EXCEPTIONS).unwrap_or(&empty);
        let mut domains = list
            .as_array()
            .context("invalid bypass list")?
            .iter()
            .map(|v| v.as_string().map(str::to_owned).context("invalid bypass entry"))
            .collect::<Result<Vec<_>>>()?;
        if domains.is_empty() {
            domains.push("Empty".to_owned());
        }
        step(
            &mut result,
            "-setproxybypassdomains",
            domains,
            &mut working,
            &[(EXCEPTIONS, list.clone())],
        );
    }
    ensure!(
        allowed_dormant(from, want, &State(Some(working))),
        "macOS configuration cannot be represented without a native writer"
    );
    Ok(result)
}

pub(super) fn is_prefix(before: &State, desired: &State, current: &State) -> bool {
    steps(before, desired).is_ok_and(|steps| steps.iter().any(|step| equivalent(current, &step.after)))
}

pub(super) fn write(scope: &str, expected: &State, desired: &State) -> Result<()> {
    preflight(scope, desired)?;
    let mut observed = read(scope)?;
    ensure!(&observed == expected, "macOS proxy ownership changed");
    let name = preferences::networksetup_name(scope)?;
    for change in steps(expected, desired)? {
        ensure!(
            preferences::networksetup_name(scope)? == name && read(scope)? == observed,
            "macOS proxy ownership changed mid-write"
        );
        let result = Command::new("/usr/sbin/networksetup")
            .args([change.op, &name])
            .args(change.args)
            .output()?;
        observed = read(scope)?;
        // A successful process exit alone is not evidence of a successful preferences write.
        ensure!(
            result.status.success() && equivalent(&observed, &change.after),
            "macOS did not confirm networksetup operation {}",
            change.op
        );
    }
    ensure!(
        allowed_dormant(expected, desired, &read(scope)?),
        "macOS proxy restoration was not confirmed"
    );
    Ok(())
}
