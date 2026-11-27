use super::{Endpoint, Intent};
use anyhow::{Context as _, Result, ensure};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use std::{
    collections::BTreeMap,
    fs::{self, File, OpenOptions},
    io::{ErrorKind, Write as _},
    path::{Path, PathBuf},
};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub(super) struct Pending<S> {
    pub(super) before: S,
    pub(super) intent: Intent,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub(super) struct Entry<S> {
    pub(super) original: S,
    pub(super) confirmed: Option<S>,
    pub(super) pending: Option<Pending<S>>,
    pub(super) endpoint: Option<Endpoint>,
    pub(super) restoring: Option<S>,
}

#[derive(Serialize, Deserialize)]
struct Receipt<'a, S: Clone> {
    version: u8,
    entries: std::borrow::Cow<'a, BTreeMap<String, Entry<S>>>,
}

pub(super) struct Journal<S> {
    pub(super) entries: BTreeMap<String, Entry<S>>,
    directory: PathBuf,
    _transaction_lock: File,
}

fn open_lock(path: &Path) -> Result<File> {
    let mut options = OpenOptions::new();
    options.read(true).write(true).create(true).truncate(false);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt as _;
        options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
    }
    Ok(options.open(path)?)
}

impl<S: Clone + Serialize + DeserializeOwned> Journal<S> {
    // Recovery can remove entries as it handles them; iterate only the scopes in the initial receipt.
    pub(super) fn recorded_scopes(&self) -> Vec<String> {
        self.entries.keys().cloned().collect()
    }

    pub(super) fn open(directory: &Path) -> Result<Self> {
        Self::acquire(directory, true)?.context("could not lock proxy receipt")
    }

    pub(super) fn acquire(directory: &Path, wait: bool) -> Result<Option<Self>> {
        let mut builder = fs::DirBuilder::new();
        builder.recursive(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt as _;
            builder.mode(0o700);
        }
        builder.create(directory)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt as _;
            let meta = fs::symlink_metadata(directory)?;
            ensure!(
                meta.is_dir() && meta.uid() == unsafe { libc::geteuid() } && meta.mode() & 0o077 == 0,
                "proxy receipt directory is not private"
            );
        }
        let transaction_lock = open_lock(&directory.join("write.lock"))?;
        if wait {
            transaction_lock.lock()?;
        } else {
            match transaction_lock.try_lock() {
                Ok(()) => (),
                Err(fs::TryLockError::WouldBlock) => return Ok(None),
                Err(error) => return Err(error.into()),
            }
        }
        let entries = match File::open(directory.join("lease.json")) {
            Ok(file) => {
                let receipt: Receipt<'_, S> =
                    serde_json::from_reader(file).context("invalid proxy recovery receipt")?;
                ensure!(receipt.version == 1, "unsupported proxy recovery receipt version");
                receipt.entries.into_owned()
            }
            Err(e) if e.kind() == ErrorKind::NotFound => BTreeMap::new(),
            Err(e) => return Err(e.into()),
        };
        Ok(Some(Self {
            entries,
            directory: directory.to_owned(),
            _transaction_lock: transaction_lock,
        }))
    }

    pub(super) fn open_owner(&self) -> Result<File> {
        open_lock(&self.directory.join("owner.lock"))
    }

    pub(super) fn save(&self) -> Result<()> {
        let path = self.directory.join("lease.json");
        if self.entries.is_empty() {
            if let Err(error) = fs::remove_file(&path)
                && error.kind() != ErrorKind::NotFound
            {
                return Err(error.into());
            }
        } else {
            let mut tmp = tempfile::NamedTempFile::new_in(&self.directory)?;
            serde_json::to_writer(
                &mut tmp,
                &Receipt {
                    version: 1,
                    entries: std::borrow::Cow::Borrowed(&self.entries),
                },
            )?;
            tmp.flush()?;
            tmp.as_file().sync_all()?;
            tmp.persist(&path)?;
        }
        #[cfg(unix)]
        File::open(&self.directory)?.sync_all()?;
        Ok(())
    }
}
