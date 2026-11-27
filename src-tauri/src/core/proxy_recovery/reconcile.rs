use super::journal::{Entry, Journal, Pending};
use anyhow::{Context as _, Result, bail, ensure};
use serde::{Serialize, de::DeserializeOwned};

pub(super) trait Settings<S> {
    fn read(&self, scope: &str) -> Result<S>;
    fn read_for_release(&self, scope: &str) -> Result<Option<S>> {
        self.read(scope).map(Some)
    }
    fn write(&self, scope: &str, current: &S, original: &S) -> Result<()>;
    fn prepared(&self, pending: &Pending<S>, current: &S) -> bool;
    fn prefix(&self, pending: &Pending<S>, current: &S) -> bool;
    fn restoring(&self, current: &S, written: &S, original: &S) -> bool;
    fn restored(&self, current: &S, written: &S, original: &S) -> bool;
    fn live(&self, entry: &Entry<S>, current: &S) -> bool;
}

pub(super) fn restore<S: Clone + Eq + Serialize + DeserializeOwned>(
    store: &mut Journal<S>,
    scope: &str,
    written: S,
    io: &impl Settings<S>,
) -> Result<()> {
    let entry = store.entries.get_mut(scope).context("missing restore receipt")?;
    entry.restoring = Some(written.clone());
    let original = entry.original.clone();
    store.save()?;
    let current = io.read(scope)?;
    if !io.restored(&current, &written, &original) {
        ensure!(
            io.restoring(&current, &written, &original),
            "proxy changed while restoring"
        );
        io.write(scope, &current, &original)?;
        ensure!(
            io.restored(&io.read(scope)?, &written, &original),
            "native proxy restore was not confirmed"
        );
    }
    Ok(())
}

pub(super) fn release_scope<S: Clone + Eq + Serialize + DeserializeOwned>(
    store: &mut Journal<S>,
    scope: &str,
    check_listener: bool,
    io: &impl Settings<S>,
) -> Result<()> {
    let Some(entry) = store.entries.get(scope) else {
        return Ok(());
    };
    // A deleted RAS phonebook entry must not be recreated by replaying its receipt.
    let Some(current) = io.read_for_release(scope)? else {
        store.entries.remove(scope);
        return Ok(());
    };
    if current != entry.original && check_listener && io.live(entry, &current) {
        return Ok(());
    }
    if let Some(written) = entry.restoring.clone() {
        if io.restoring(&current, &written, &entry.original) {
            restore(store, scope, written, io)?;
        }
    } else if current != entry.original {
        match (&entry.confirmed, &entry.pending) {
            (Some(last), _) if last == &current => restore(store, scope, current, io)?,
            (_, Some(p)) if io.prepared(p, &current) || io.prefix(p, &current) => restore(store, scope, current, io)?,
            (_, Some(p)) if current != p.before => {
                bail!("proxy changed during an interrupted write; settings are untouched and the receipt is retained")
            }
            _ => (),
        }
    }
    store.entries.remove(scope);
    Ok(())
}

#[cfg(test)]
mod tests;
