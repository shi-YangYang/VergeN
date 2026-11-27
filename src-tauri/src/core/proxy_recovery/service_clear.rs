//! The pinned helper writes the *active* macOS network service. Its scope can change while
//! an authenticated RPC is waiting, including the unconditional clear in StartClash/StopClash.
use super::*;
use std::{collections::BTreeMap, future::Future};

struct Transition {
    store: NativeJournal,
    previous: BTreeMap<String, Option<Entry<platform::State>>>,
    scopes: Vec<String>,
    intent: Intent,
}

/// Start/stop is not bound to the currently active UUID; the privileged service resolves it inside the RPC.
fn protected_destinations<S>(
    scopes: Vec<String>,
    read: impl Fn(&str) -> Result<S>,
    harmless: impl Fn(&S) -> bool,
    preflight: impl Fn(&str, &S) -> Result<()>,
) -> Result<BTreeMap<String, S>> {
    let mut candidates = BTreeMap::new();
    for scope in scopes {
        let before = read(&scope)?;
        if !harmless(&before) {
            preflight(&scope, &before)?;
        }
        candidates.insert(scope, before);
    }
    Ok(candidates)
}

impl Transition {
    fn prepare(intent: Intent, enforcing: bool) -> Result<Option<Self>> {
        let mut store = NativeJournal::open(&root()?)?;
        let mut previous = BTreeMap::new();
        let active = match &intent {
            Intent::ServiceClear => None,
            Intent::Enable(target) => {
                let scope = platform::active_scope()?;
                let before = platform::read(&scope)?;
                if Transaction::skip_or_check(&store, &scope, &before, target, enforcing)? {
                    return Ok(None);
                }

                Some(scope)
            }
        };
        let scopes = platform::service_scopes()?;
        if let (Intent::Enable(_), Some(scope)) = (&intent, &active) {
            ensure!(
                scopes.contains(scope),
                "active network service changed before proxy preparation"
            );
        }
        let candidates = protected_destinations(
            scopes,
            platform::read,
            |before| matches!(intent, Intent::ServiceClear) && platform::service_clear_is_harmless(before),
            platform::preflight_restore,
        )?;
        if matches!(intent, Intent::Enable(_)) {
            claim(&store)?;
        }
        // Refuse to dispatch if preflight itself straddled a settings or service-list change.
        let mut scopes = platform::service_scopes()?;
        scopes.sort();
        ensure!(
            candidates.keys().eq(scopes.iter()),
            "network service list changed before proxy write"
        );
        for (scope, before) in candidates {
            ensure!(
                platform::read(&scope)? == before,
                "network proxy changed during preflight"
            );
            if matches!(intent, Intent::ServiceClear) && platform::service_clear_is_harmless(&before) {
                continue;
            }
            let prior = store.entries.get(&scope);
            let ours = prior.filter(|entry| in_our_transition(entry, &before));
            let next = Entry {
                original: ours.map_or_else(|| before.clone(), |e| e.original.clone()),
                confirmed: ours.map(|_| before.clone()),
                endpoint: ours.and_then(|e| e.current_endpoint(&before)),
                pending: Some(Pending {
                    before,
                    intent: intent.clone(),
                }),
                restoring: None,
            };
            previous.insert(scope.clone(), store.entries.insert(scope, next));
        }
        if !previous.is_empty() {
            login::ensure_login_hook()?;
            store.save()?;
        }
        Ok(Some(Self {
            store,
            previous,
            scopes,
            intent,
        }))
    }

    fn finish(mut self, ipc_failed: bool) -> Result<()> {
        let mut first_error = platform::service_scopes()
            .and_then(|after| {
                ensure!(
                    after.iter().all(|key| self.scopes.contains(key)),
                    "a new macOS network service appeared during proxy IPC; its previous settings are unknown"
                );
                Ok(())
            })
            .err();
        let mut confirmed = false;
        for (scope, previous) in self.previous {
            let result = (|| -> Result<()> {
                let current = platform::read(&scope)?;
                let entry = self
                    .store
                    .entries
                    .get_mut(&scope)
                    .context("missing service transition receipt")?;
                let pending = entry.pending.as_ref().context("missing service transition")?;
                if current == pending.before {
                    if ipc_failed {
                        // A timed out command may still write after the caller stops waiting.
                        return Ok(());
                    }
                    if let Intent::Enable(target) = &self.intent
                        && platform::matches(&current, target)
                    {
                        confirmed = true;
                    }
                    if let Some(previous) = previous {
                        self.store.entries.insert(scope.clone(), previous);
                    } else {
                        self.store.entries.remove(&scope);
                    }
                } else if let Intent::Enable(target) = &self.intent
                    && platform::matches_after(&pending.before, &current, target)
                {
                    if ipc_failed {
                        return Ok(());
                    }
                    confirmed = true;
                    entry.endpoint = Some(target.endpoint());
                    entry.confirmed = Some(current);
                    entry.pending = None;
                } else if platform::service_cleared(&pending.before, &current) {
                    restore_recorded(&mut self.store, &scope, current)?;
                    self.store.entries.remove(&scope);
                } else {
                    if matches!(self.intent, Intent::Enable(_)) {
                        bail!("proxy changed during a service write; retaining its receipt");
                    }
                    // The helper's single native clear cannot generate this configuration.
                    self.store.entries.remove(&scope);
                }
                Ok(())
            })();
            if let Err(error) = result {
                first_error.get_or_insert(error);
            }
        }
        save_after_release(&self.store)?;
        if let Some(error) = first_error {
            return Err(error);
        }
        if matches!(self.intent, Intent::Enable(_)) && !ipc_failed {
            ensure!(confirmed, "the service proxy write was not confirmed");
        }
        Ok(())
    }
}

pub(in crate::core) async fn around_service_clear<
    T,
    E: Into<anyhow::Error>,
    F: Future<Output = std::result::Result<T, E>>,
>(
    operation: impl FnOnce() -> F,
) -> Result<T> {
    let tx = tokio::task::spawn_blocking(|| Transition::prepare(Intent::ServiceClear, false))
        .await??
        .context("missing service clear transition")?;
    let result = operation().await.map_err(Into::into);
    let uncertain = result.is_err();
    if let Err(error) = tokio::task::spawn_blocking(move || tx.finish(uncertain)).await? {
        // Don't discard a committed owner proof or claim a stopped core is still running.
        clash_verge_logging::logging!(
            error,
            clash_verge_logging::Type::Core,
            "retained proxy receipt after service transition: {error:#}"
        );
    }
    result
}

pub(super) async fn around_enable<T, F: Future<Output = Result<T>>>(
    target: Target,
    enforcing: bool,
    write: impl FnOnce() -> F,
    unchanged: impl FnOnce() -> T,
) -> Result<T> {
    let tx = tokio::task::spawn_blocking(move || Transition::prepare(Intent::Enable(target), enforcing)).await??;
    let Some(tx) = tx else {
        return Ok(unchanged());
    };
    let result = write().await;
    let failed = result.is_err();
    let finish = tokio::task::spawn_blocking(move || tx.finish(failed)).await?;
    match (result, finish) {
        (Err(error), Err(cleanup)) => Err(error.context(format!("proxy journal: {cleanup:#}"))),
        (Err(error), _) => Err(error),
        (Ok(value), Ok(())) => Ok(value),
        (_, Err(error)) => Err(error),
    }
}

#[cfg(test)]
mod tests {
    use super::protected_destinations;
    use anyhow::{Result, bail, ensure};

    #[test]
    fn taking_over_or_starting_offline_preflights_every_possible_helper_destination() -> Result<()> {
        // Ethernet can become active inside StartClash even when Wi-Fi was active (or nothing was).
        let networks = || vec!["Wi-Fi".to_owned(), "Ethernet".to_owned()];
        let read = |name: &str| Ok(name == "Ethernet");
        let preflight = |name: &str, _: &bool| {
            ensure!(name != "Ethernet", "managed corporate PAC");
            Ok(())
        };
        assert!(protected_destinations(networks(), read, |active| !active, preflight).is_err());
        assert!(protected_destinations(networks(), read, |_| false, preflight).is_err());
        let direct = protected_destinations(
            networks(),
            |_| Ok(false),
            |active| !active,
            |_, _| bail!("unexpected proxy permission check"),
        )?;
        ensure!(direct.len() == 2);
        Ok(())
    }
}
