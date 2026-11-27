//! A per-user, write-ahead receipt for OS settings. There is no remote check or running recovery agent.
mod journal;
mod login;
#[cfg(target_os = "linux")]
#[path = "linux.rs"]
mod platform;
#[cfg(target_os = "macos")]
#[path = "macos.rs"]
mod platform;
#[cfg(windows)]
#[path = "windows.rs"]
mod platform;
mod reconcile;

use anyhow::{Context as _, Result, bail, ensure};
use journal::{Entry, Journal, Pending};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::{
    fs::{File, TryLockError},
    io::ErrorKind,
    net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, TcpStream},
    path::PathBuf,
    time::Duration,
};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) enum Target {
    Manual { host: String, port: u16, bypass: String },
    Pac { url: String, bypass: Option<String> },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
enum Intent {
    Enable(Target),
    #[cfg(target_os = "macos")]
    ServiceClear,
}

type NativeJournal = Journal<platform::State>;

// An independent login task must leave a working owner alone, including while its port is being changed.
static OWNER: Mutex<Option<File>> = Mutex::new(None);

fn root() -> Result<PathBuf> {
    Ok(::dirs::data_local_dir()
        .context("no local application data directory")?
        .join(crate::utils::dirs::APP_ID)
        .join("proxy-recovery"))
}

fn claim(store: &NativeJournal) -> Result<()> {
    let mut guard = OWNER.lock();
    if guard.is_none() {
        let file = store.open_owner()?;
        file.try_lock()
            .context("another VergeN instance controls the system proxy")?;
        *guard = Some(file);
    }
    drop(guard);
    Ok(())
}

fn expected(pending: &Pending<platform::State>, current: &platform::State) -> bool {
    match &pending.intent {
        Intent::Enable(target) => platform::matches_after(&pending.before, current, target),
        #[cfg(target_os = "macos")]
        Intent::ServiceClear => platform::service_cleared(&pending.before, current),
    }
}

fn confirmed_or_pending(entry: &Entry<platform::State>, current: &platform::State) -> bool {
    entry.confirmed.as_ref() == Some(current) || entry.pending.as_ref().is_some_and(|p| expected(p, current))
}

fn in_our_transition(entry: &Entry<platform::State>, current: &platform::State) -> bool {
    confirmed_or_pending(entry, current)
        || entry
            .pending
            .as_ref()
            .is_some_and(|p| current != &p.before && interrupted(p, current))
        || entry
            .restoring
            .as_ref()
            .is_some_and(|written| platform::can_resume_restore(current, written, &entry.original))
}

struct Transaction {
    store: NativeJournal,
    scope: String,
}

impl Transaction {
    fn skip_or_check(
        store: &NativeJournal,
        scope: &str,
        before: &platform::State,
        target: &Target,
        enforcing: bool,
    ) -> Result<bool> {
        let prior = store.entries.get(scope);
        let matched = platform::matches(before, target);
        if matched && prior.is_none() {
            return Ok(true);
        }
        let same_owner = prior.is_some_and(|entry| in_our_transition(entry, before));
        if matched && prior.is_some_and(|entry| confirmed_or_pending(entry, before)) {
            claim(store)?;
            return Ok(true);
        }
        if let Some(prior) = prior
            && !same_owner
            && before != &prior.original
            && (!enforcing || prior.pending.is_some() || prior.restoring.is_some())
        {
            bail!("system proxy was changed externally; turn system proxy off and on to take control again");
        }
        Ok(false)
    }

    fn prepare(scope: String, target: Target, enforcing: bool) -> Result<Option<Self>> {
        let mut store = NativeJournal::open(&root()?)?;
        let before = platform::read(&scope)?;
        if Self::skip_or_check(&store, &scope, &before, &target, enforcing)? {
            return Ok(None);
        }
        let prior = store.entries.get(&scope);
        let same_owner = prior.is_some_and(|e| in_our_transition(e, &before));
        #[cfg(target_os = "macos")]
        platform::preflight_restore(&scope, &before)?;
        claim(&store)?;
        login::ensure_login_hook()?;
        let original = prior
            .filter(|_| same_owner)
            .map_or_else(|| before.clone(), |e| e.original.clone());
        let confirmed = prior.filter(|_| same_owner).map(|_| before.clone());
        let endpoint = prior.filter(|_| same_owner).and_then(|e| e.current_endpoint(&before));
        store.entries.insert(
            scope.clone(),
            Entry {
                original,
                confirmed,
                endpoint,
                restoring: None,
                pending: Some(Pending {
                    before,
                    intent: Intent::Enable(target),
                }),
            },
        );
        store.save()?;
        Ok(Some(Self { store, scope }))
    }

    fn finish(mut self, success: bool) -> Result<()> {
        let current = platform::read(&self.scope)?;
        let entry = self
            .store
            .entries
            .get_mut(&self.scope)
            .context("missing proxy receipt")?;
        let pending = entry.pending.as_ref().context("missing pending proxy write")?;
        let partial = interrupted(pending, &current);
        if success && expected(pending, &current) {
            entry.endpoint = pending.intent.endpoint();
            entry.confirmed = Some(current);
            entry.pending = None;
        } else if current == pending.before && !success {
            entry.pending = None;
            if entry.confirmed.is_none() {
                self.store.entries.remove(&self.scope);
            }
        } else if expected(pending, &current) || partial {
            restore_recorded(&mut self.store, &self.scope, current)?;
            self.store.entries.remove(&self.scope);
            save_after_release(&self.store)?;
            ensure!(
                !success,
                "OS reported success on a partially applied proxy; the previous setting was restored"
            );
            return Ok(());
        } else {
            return Err(anyhow::anyhow!(
                "native proxy write did not reach its recorded target; retaining recovery data"
            )
            .context(crate::core::proxy_control::SystemProxyStateUnknown));
        }
        save_after_release(&self.store)
    }
}

pub(super) fn apply<T, Fut: std::future::Future<Output = Result<T>>>(
    target: Target,
    enforcing: bool,
    write: impl FnOnce() -> Fut,
    unchanged: impl FnOnce() -> T,
) -> impl std::future::Future<Output = Result<T>> {
    #[cfg(target_os = "macos")]
    {
        service_clear::around_enable(target, enforcing, write, unchanged)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (target, enforcing, write, unchanged);
        std::future::ready(Err(anyhow::anyhow!("privileged proxy writes are only used on macOS")))
    }
}

fn apply_scope(scope: &str, target: &Target, enforcing: bool) -> Result<bool> {
    let Some(tx) = Transaction::prepare(scope.to_owned(), target.clone(), enforcing)? else {
        return Ok(false);
    };
    let before = &tx.store.entries[scope]
        .pending
        .as_ref()
        .context("missing proxy preparation")?
        .before;
    let result = platform::apply(scope, before, target);
    let receipt = tx.finish(result.is_ok());
    match (result, receipt) {
        (Err(error), Err(cleanup)) => Err(error.context(format!("proxy journal: {cleanup:#}"))),
        (Err(error), _) => Err(error),
        (_, receipt) => receipt.map(|()| true),
    }
}

pub(super) async fn apply_local(target: Target, enforcing: bool) -> Result<()> {
    tokio::task::spawn_blocking(move || {
        #[cfg(target_os = "macos")]
        let scopes = vec![platform::active_scope()?];
        #[cfg(not(target_os = "macos"))]
        let scopes = platform::scopes()?;
        let mut written = Vec::new();
        for scope in scopes {
            match apply_scope(&scope, &target, enforcing) {
                Ok(true) => written.push(scope),
                Ok(false) => (),
                Err(error) => {
                    if !written.is_empty() {
                        let mut store = NativeJournal::open(&root()?)?;
                        let mut rollback_error = None;
                        for previous in &written {
                            if let Err(failed) = reconcile::release_scope(&mut store, previous, false, &NativeSettings)
                            {
                                rollback_error.get_or_insert(failed);
                            }
                        }
                        save_after_release(&store)?;
                        if let Some(failed) = rollback_error {
                            return Err(error.context(format!("proxy rollback: {failed:#}")));
                        }
                    }
                    return Err(error);
                }
            }
        }
        Ok(())
    })
    .await?
}

#[derive(Clone, Debug, Serialize, Deserialize)]
enum Endpoint {
    Loopback { address: IpAddr, port: u16 },
    Localhost(u16),
    Unverified,
}

impl Target {
    fn endpoint(&self) -> Endpoint {
        let (host, port) = match self {
            Self::Manual { host, port, .. } => (host.clone(), *port),
            Self::Pac { url, .. } => {
                let Ok(url) = reqwest::Url::parse(url) else {
                    return Endpoint::Unverified;
                };
                let (Some(host), Some(port)) = (url.host_str(), url.port_or_known_default()) else {
                    return Endpoint::Unverified;
                };
                (host.to_owned(), port)
            }
        };
        if host.eq_ignore_ascii_case("localhost") {
            return Endpoint::Localhost(port);
        }
        let host = host
            .strip_prefix('[')
            .and_then(|s| s.strip_suffix(']'))
            .unwrap_or(&host);
        match host.parse::<IpAddr>() {
            Ok(address) if address.is_loopback() => Endpoint::Loopback { address, port },
            _ => Endpoint::Unverified,
        }
    }
}

impl Intent {
    #[cfg_attr(
        not(target_os = "macos"),
        expect(clippy::unnecessary_wraps, reason = "only macOS service clears have no endpoint")
    )]
    fn endpoint(&self) -> Option<Endpoint> {
        match self {
            Self::Enable(t) => Some(t.endpoint()),
            #[cfg(target_os = "macos")]
            Self::ServiceClear => None,
        }
    }
}

impl Endpoint {
    fn may_be_live(&self) -> bool {
        fn listening(ip: IpAddr, port: u16) -> bool {
            TcpStream::connect_timeout(&SocketAddr::new(ip, port), Duration::from_millis(180)).map_or_else(
                |err| {
                    !matches!(
                        err.kind(),
                        ErrorKind::ConnectionRefused | ErrorKind::AddrNotAvailable | ErrorKind::Unsupported
                    )
                },
                |_| true,
            )
        }
        match self {
            Self::Loopback { address, port } => listening(*address, *port),
            Self::Localhost(port) => {
                listening(Ipv4Addr::LOCALHOST.into(), *port) || listening(Ipv6Addr::LOCALHOST.into(), *port)
            }
            // Never probe a corporate host (or treat a connection failure to it as permission to bypass it).
            Self::Unverified => true,
        }
    }
}

fn interrupted(pending: &Pending<platform::State>, current: &platform::State) -> bool {
    match &pending.intent {
        Intent::Enable(target) => platform::can_resume_apply(&pending.before, current, target),
        #[cfg(target_os = "macos")]
        Intent::ServiceClear => false,
    }
}

impl Entry<platform::State> {
    fn current_endpoint(&self, now: &platform::State) -> Option<Endpoint> {
        if self.confirmed.as_ref() == Some(now) {
            return self.endpoint.clone();
        }
        self.pending.as_ref().and_then(|p| {
            (expected(p, now) || interrupted(p, now))
                .then(|| p.intent.endpoint())
                .flatten()
        })
    }
}

fn save_after_release(store: &NativeJournal) -> Result<()> {
    store.save()?;
    if store.entries.is_empty() {
        OWNER.lock().take();
        login::remove_login_hook()?;
    }
    Ok(())
}

fn is_restored(now: &platform::State, written: &platform::State, original: &platform::State) -> bool {
    #[cfg(target_os = "macos")]
    {
        platform::restored(now, written, original)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = written;
        now == original
    }
}

struct NativeSettings;

impl reconcile::Settings<platform::State> for NativeSettings {
    fn read(&self, scope: &str) -> Result<platform::State> {
        platform::read(scope)
    }
    #[cfg(windows)]
    fn read_for_release(&self, scope: &str) -> Result<Option<platform::State>> {
        platform::read_optional(scope)
    }
    fn write(&self, scope: &str, current: &platform::State, original: &platform::State) -> Result<()> {
        platform::restore(scope, current, original)
    }
    fn prepared(&self, pending: &Pending<platform::State>, current: &platform::State) -> bool {
        expected(pending, current)
    }
    fn prefix(&self, pending: &Pending<platform::State>, current: &platform::State) -> bool {
        interrupted(pending, current)
    }
    fn restoring(&self, current: &platform::State, written: &platform::State, original: &platform::State) -> bool {
        platform::can_resume_restore(current, written, original)
    }
    fn restored(&self, current: &platform::State, written: &platform::State, original: &platform::State) -> bool {
        is_restored(current, written, original)
    }
    fn live(&self, entry: &Entry<platform::State>, current: &platform::State) -> bool {
        entry.current_endpoint(current).is_some_and(|e| e.may_be_live())
    }
}

fn restore_recorded(store: &mut NativeJournal, scope: &str, written: platform::State) -> Result<()> {
    reconcile::restore(store, scope, written, &NativeSettings)
}

fn release(headless: bool) -> Result<()> {
    let path = root()?;
    if !path.exists() {
        return Ok(());
    }
    let Some(mut store) = NativeJournal::acquire(&path, !headless)? else {
        return Ok(());
    };
    let check_listener = headless || OWNER.lock().is_none();
    let _no_active_instance = if headless {
        let file = store.open_owner()?;
        match file.try_lock() {
            Ok(()) => Some(file),
            Err(TryLockError::WouldBlock) => return Ok(()),
            Err(error) => return Err(error.into()),
        }
    } else {
        // Don't release another running instance's receipt, even on normal cleanup.
        claim(&store)?;
        None
    };
    let mut first_error = None;
    for scope in store.recorded_scopes() {
        if let Err(error) = reconcile::release_scope(&mut store, &scope, check_listener, &NativeSettings) {
            first_error.get_or_insert(error);
        }
    }
    save_after_release(&store)?;
    first_error.map_or(Ok(()), Err)
}

pub(crate) fn at_login() -> Result<()> {
    release(true)
}

pub(super) async fn release_owned() -> Result<()> {
    tokio::task::spawn_blocking(|| release(false)).await?
}

#[cfg(target_os = "macos")]
mod service_clear;
#[cfg(target_os = "macos")]
pub(super) use service_clear::around_service_clear;
