use super::*;
use crate::core::proxy_recovery::{Intent, Target};
use std::cell::Cell;

const SCOPE: &str = "employee-network";
const COMPANY_PAC: u8 = 1;
const PARTIAL: u8 = 2;
const OURS: u8 = 3;
const OTHER: u8 = 4;

struct Fake {
    value: Cell<u8>,
    writes: Cell<usize>,
    fail_first: Cell<bool>,
    live: Cell<bool>,
}

impl Fake {
    fn new(value: u8) -> Self {
        Self {
            value: Cell::new(value),
            writes: Cell::new(0),
            fail_first: Cell::new(false),
            live: Cell::new(false),
        }
    }
}
impl Settings<u8> for Fake {
    fn read(&self, _: &str) -> Result<u8> {
        Ok(self.value.get())
    }
    fn write(&self, _: &str, current: &u8, original: &u8) -> Result<()> {
        ensure!(self.value.get() == *current, "lost ownership");
        self.writes.set(self.writes.get() + 1);
        if self.fail_first.replace(false) {
            self.value.set(PARTIAL);
            bail!("simulated failure during native restore");
        }
        self.value.set(*original);
        Ok(())
    }
    fn prepared(&self, _: &Pending<u8>, current: &u8) -> bool {
        *current == OURS
    }
    fn prefix(&self, _: &Pending<u8>, current: &u8) -> bool {
        *current == PARTIAL
    }
    fn restoring(&self, current: &u8, written: &u8, _: &u8) -> bool {
        current == written || *current == PARTIAL
    }
    fn restored(&self, current: &u8, _: &u8, orig: &u8) -> bool {
        current == orig
    }
    fn live(&self, _: &Entry<u8>, _: &u8) -> bool {
        self.live.get()
    }
}

fn receipt(before: u8, pending: bool) -> Entry<u8> {
    Entry {
        original: before,
        restoring: None,
        endpoint: None,
        confirmed: (!pending).then_some(OURS),
        pending: pending.then(|| Pending {
            before,
            intent: Intent::Enable(Target::Manual {
                host: "127.0.0.1".into(),
                port: 7897,
                bypass: "localhost".into(),
            }),
        }),
    }
}

#[test]
fn interrupted_takeover_and_interrupted_restore_recover_after_reopening_the_receipt() -> Result<()> {
    let dir = tempfile::tempdir()?;
    let path = dir.path().join("receipt");
    let mut original = Journal::open(&path)?;
    original.entries.insert(SCOPE.into(), receipt(COMPANY_PAC, true));
    original.save()?;
    // The OS accepted the takeover but the writer never got to persist its post-write receipt.
    drop(original);
    let os = Fake::new(OURS);
    os.fail_first.set(true);
    let mut login = Journal::open(&path)?;
    assert!(release_scope(&mut login, SCOPE, true, &os).is_err());
    assert_eq!(os.value.get(), PARTIAL);
    drop(login);
    let mut next_login = Journal::open(&path)?;
    assert_eq!(next_login.entries[SCOPE].restoring, Some(OURS));
    release_scope(&mut next_login, SCOPE, true, &os)?;
    next_login.save()?;
    assert_eq!(os.value.get(), COMPANY_PAC);
    release_scope(&mut next_login, SCOPE, true, &os)?;
    assert_eq!(os.writes.get(), 2);
    assert!(!path.join("lease.json").exists());
    Ok(())
}

#[test]
fn no_receipt_live_listener_and_foreign_replacement_are_left_alone() -> Result<()> {
    let dir = tempfile::tempdir()?;
    let mut store = Journal::open(&dir.path().join("receipt"))?;
    let os = Fake::new(OTHER);
    release_scope(&mut store, SCOPE, true, &os)?;
    assert_eq!(os.writes.get(), 0);
    store.entries.insert(SCOPE.into(), receipt(COMPANY_PAC, false));
    os.value.set(OURS);
    os.live.set(true);
    release_scope(&mut store, SCOPE, true, &os)?;
    assert!(store.entries.contains_key(SCOPE));
    os.value.set(OTHER);
    os.live.set(false);
    release_scope(&mut store, SCOPE, true, &os)?;
    assert_eq!(os.value.get(), OTHER);
    assert_eq!(os.writes.get(), 0);
    assert!(store.entries.is_empty());
    Ok(())
}

#[test]
fn known_partial_write_is_rolled_back_but_ambiguous_pending_state_is_retained() -> Result<()> {
    let dir = tempfile::tempdir()?;
    let mut store = Journal::open(&dir.path().join("receipt"))?;
    let os = Fake::new(OTHER);
    store.entries.insert(SCOPE.into(), receipt(COMPANY_PAC, true));
    assert!(release_scope(&mut store, SCOPE, true, &os).is_err());
    assert!(store.entries.contains_key(SCOPE));
    assert_eq!(os.value.get(), OTHER);
    os.value.set(PARTIAL);
    release_scope(&mut store, SCOPE, true, &os)?;
    assert_eq!(os.value.get(), COMPANY_PAC);
    Ok(())
}

#[test]
fn login_checks_never_block_behind_another_process_or_steal_its_owner_lock() -> Result<()> {
    let dir = tempfile::tempdir()?;
    let path = dir.path().join("receipt");
    let writer = Journal::<u8>::open(&path)?;
    assert!(Journal::<u8>::acquire(&path, false)?.is_none());
    let owner = writer.open_owner()?;
    owner.lock()?;
    drop(writer);
    let login = Journal::<u8>::open(&path)?;
    assert!(matches!(
        login.open_owner()?.try_lock(),
        Err(std::fs::TryLockError::WouldBlock)
    ));
    Ok(())
}

#[test]
fn changing_one_routing_store_does_not_abandon_other_stores_after_a_restart() -> Result<()> {
    use std::{cell::RefCell, collections::BTreeMap};
    struct Independent(RefCell<BTreeMap<&'static str, u8>>);
    impl Settings<u8> for Independent {
        fn read(&self, scope: &str) -> Result<u8> {
            self.0.borrow().get(scope).copied().context("missing store")
        }
        fn read_for_release(&self, scope: &str) -> Result<Option<u8>> {
            Ok(self.0.borrow().get(scope).copied())
        }
        fn write(&self, scope: &str, seen: &u8, old: &u8) -> Result<()> {
            let mut values = self.0.borrow_mut();
            let value = values.get_mut(scope).context("missing store")?;
            ensure!(value == seen);
            *value = *old;
            Ok(())
        }
        fn prepared(&self, _: &Pending<u8>, s: &u8) -> bool {
            *s == OURS
        }
        fn prefix(&self, _: &Pending<u8>, s: &u8) -> bool {
            *s == PARTIAL
        }
        fn restoring(&self, s: &u8, w: &u8, o: &u8) -> bool {
            s == w || s == o
        }
        fn restored(&self, s: &u8, _: &u8, o: &u8) -> bool {
            s == o
        }
        fn live(&self, _: &Entry<u8>, _: &u8) -> bool {
            false
        }
    }
    let dir = tempfile::tempdir()?;
    let path = dir.path().join("receipt");
    let mut store = Journal::open(&path)?;
    for key in [
        "wininet:lan",
        "wininet:ras:removed",
        "wininet:ras:switched",
        "GTK",
        "KDE",
    ] {
        store.entries.insert(key.into(), receipt(COMPANY_PAC, false));
    }
    store.save()?;
    let live = Independent(RefCell::new(BTreeMap::from([
        ("wininet:lan", OURS),
        ("wininet:ras:switched", OTHER),
        ("wininet:ras:new", OURS),
        ("GTK", OURS),
        ("KDE", OTHER),
    ])));
    // An interrupted cleanup must not make a later inventory the new source of ownership.
    release_scope(&mut store, "GTK", true, &live)?;
    drop(store);
    let mut next = Journal::<u8>::open(&path)?;
    for key in next.recorded_scopes() {
        release_scope(&mut next, &key, true, &live)?;
    }
    next.save()?;
    assert!(next.entries.is_empty());
    assert_eq!(
        *live.0.borrow(),
        BTreeMap::from([
            ("wininet:lan", COMPANY_PAC),
            ("wininet:ras:switched", OTHER),
            ("wininet:ras:new", OURS),
            ("GTK", COMPANY_PAC),
            ("KDE", OTHER),
        ])
    );
    Ok(())
}
