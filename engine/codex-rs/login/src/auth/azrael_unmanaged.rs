use super::*;
use std::collections::HashMap;
use std::fs::File;
use std::fs::OpenOptions;
use std::io;
use std::sync::OnceLock;
use std::sync::Weak;
use std::time::Duration;
use tokio::sync::OwnedMutexGuard;
use tokio::sync::OwnedSemaphorePermit;

const AUTH_TRANSACTION_WAIT: Duration = Duration::from_secs(30);
const AUTH_TRANSACTION_RETRY: Duration = Duration::from_millis(25);
const AUTH_TRANSACTION_LOCK: &str = "auth-transaction.lock";

static TRANSACTIONS: OnceLock<Mutex<HashMap<PathBuf, Weak<AzraelAuthTransaction>>>> =
    OnceLock::new();

struct UsageState {
    file: Option<File>,
    exclusive_generation: Option<u64>,
    desired: bool,
    generation: u64,
}

pub(super) struct AzraelAuthUsageLease {
    lock_path: PathBuf,
    busy_message: &'static str,
    state: Mutex<UsageState>,
}

pub(super) struct AzraelAuthTransaction {
    lock_path: PathBuf,
    process_gate: Arc<tokio::sync::Mutex<()>>,
}

pub(super) struct AzraelUnmanagedAuthLease {
    usage: Arc<AzraelAuthUsageLease>,
    transaction: Arc<AzraelAuthTransaction>,
}

pub struct AzraelAuthRefreshGuard {
    _process_guard: OwnedMutexGuard<()>,
    _file: File,
}

pub struct AzraelAuthMutationGuard {
    usage: Arc<AzraelAuthUsageLease>,
    generation: u64,
    exclusive_file: Option<File>,
    _transaction: AzraelAuthRefreshGuard,
    _process_permit: Option<OwnedSemaphorePermit>,
}

impl AzraelUnmanagedAuthLease {
    pub(super) fn acquire_shared(codex_home: &Path) -> io::Result<Arc<Self>> {
        std::fs::create_dir_all(codex_home)?;
        let canonical_home = std::fs::canonicalize(codex_home)?;
        let lock_dir = canonical_home.join("azrael");
        std::fs::create_dir_all(&lock_dir)?;
        let usage = AzraelAuthUsageLease::acquire(
            lock_dir.join("unmanaged-auth.lock"),
            "unmanaged authentication is owned by another Codex process",
            /*allow_initial_would_block*/ true,
        )?;
        let transaction = AzraelAuthTransaction::for_home(&canonical_home)?;
        Ok(Arc::new(Self { usage, transaction }))
    }

    pub(super) fn owns(&self) -> bool {
        self.usage.owns()
    }

    pub(super) fn acquire(&self) -> io::Result<()> {
        self.usage.acquire_shared()
    }

    pub(super) fn release(&self) {
        self.usage.release();
    }

    pub(super) fn usage(&self) -> Arc<AzraelAuthUsageLease> {
        Arc::clone(&self.usage)
    }

    pub(super) fn transaction(&self) -> Arc<AzraelAuthTransaction> {
        Arc::clone(&self.transaction)
    }
}

impl AzraelAuthUsageLease {
    pub(super) fn acquire(
        lock_path: PathBuf,
        busy_message: &'static str,
        allow_initial_would_block: bool,
    ) -> io::Result<Arc<Self>> {
        let initial = match try_lock_shared_file(&lock_path, busy_message) {
            Ok(file) => Some(file),
            Err(error)
                if allow_initial_would_block && error.kind() == io::ErrorKind::WouldBlock =>
            {
                None
            }
            Err(error) => return Err(error),
        };
        Ok(Arc::new(Self {
            lock_path,
            busy_message,
            state: Mutex::new(UsageState {
                file: initial,
                exclusive_generation: None,
                desired: true,
                generation: 0,
            }),
        }))
    }

    pub(super) fn owns(&self) -> bool {
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .is_owned()
    }

    pub(super) fn acquire_shared(&self) -> io::Result<()> {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if !state.desired {
            state.desired = true;
            state.generation = state.generation.wrapping_add(1);
        }
        if !state.is_owned() {
            state.file = Some(try_lock_shared_file(&self.lock_path, self.busy_message)?);
        }
        Ok(())
    }

    pub(super) fn release(&self) {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        state.file.take();
        state.exclusive_generation = None;
        if state.desired {
            state.desired = false;
            state.generation = state.generation.wrapping_add(1);
        }
    }

    fn acquire_exclusive(self: &Arc<Self>) -> io::Result<(File, u64)> {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if !state.desired {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "authentication usage lease has been released",
            ));
        }
        state.file.take();
        let generation = state.generation;
        drop(state);

        match try_lock_exclusive_file(&self.lock_path, self.busy_message) {
            Ok(file) => {
                let mut state = self
                    .state
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner);
                if !state.desired || state.generation != generation {
                    drop(state);
                    drop(file);
                    return Err(io::Error::new(
                        io::ErrorKind::PermissionDenied,
                        "authentication usage lease was released during mutation admission",
                    ));
                }
                state.exclusive_generation = Some(generation);
                Ok((file, generation))
            }
            Err(error) => {
                self.reacquire_shared(generation);
                Err(error)
            }
        }
    }

    fn reacquire_shared(&self, generation: u64) {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if !state.desired || state.generation != generation || state.file.is_some() {
            return;
        }
        match try_lock_shared_file(&self.lock_path, self.busy_message) {
            Ok(file) => state.file = Some(file),
            Err(error) => tracing::warn!(
                "failed to reacquire authentication usage lease after mutation: {error}"
            ),
        }
    }

    fn finish_exclusive(&self, generation: u64) {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if state.exclusive_generation == Some(generation) {
            state.exclusive_generation = None;
        }
        if !state.desired || state.generation != generation || state.file.is_some() {
            return;
        }
        match try_lock_shared_file(&self.lock_path, self.busy_message) {
            Ok(file) => state.file = Some(file),
            Err(error) => tracing::warn!(
                "failed to reacquire authentication usage lease after mutation: {error}"
            ),
        }
    }
}

impl AzraelAuthTransaction {
    pub(super) fn for_home(auth_home: &Path) -> io::Result<Arc<Self>> {
        std::fs::create_dir_all(auth_home)?;
        let canonical_home = std::fs::canonicalize(auth_home)?;
        let registry_key = normalized_registry_key(&canonical_home);
        let registry = TRANSACTIONS.get_or_init(|| Mutex::new(HashMap::new()));
        let mut registry = registry
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some(transaction) = registry.get(&registry_key).and_then(Weak::upgrade) {
            return Ok(transaction);
        }
        let lock_dir = canonical_home.join("azrael");
        std::fs::create_dir_all(&lock_dir)?;
        let transaction = Arc::new(Self {
            lock_path: lock_dir.join(AUTH_TRANSACTION_LOCK),
            process_gate: Arc::new(tokio::sync::Mutex::new(())),
        });
        registry.insert(registry_key, Arc::downgrade(&transaction));
        Ok(transaction)
    }

    pub(super) async fn lock(self: &Arc<Self>) -> io::Result<AzraelAuthRefreshGuard> {
        let deadline = tokio::time::Instant::now() + AUTH_TRANSACTION_WAIT;
        let process_guard = tokio::time::timeout(
            AUTH_TRANSACTION_WAIT,
            Arc::clone(&self.process_gate).lock_owned(),
        )
        .await
        .map_err(|_| transaction_timeout_error())?;
        let file = loop {
            match try_lock_exclusive_file(
                &self.lock_path,
                "authentication credential transaction is currently in use",
            ) {
                Ok(file) => break file,
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                    let now = tokio::time::Instant::now();
                    if now >= deadline {
                        return Err(transaction_timeout_error());
                    }
                    tokio::time::sleep(AUTH_TRANSACTION_RETRY.min(deadline - now)).await;
                }
                Err(error) => return Err(error),
            }
        };
        Ok(AzraelAuthRefreshGuard {
            _process_guard: process_guard,
            _file: file,
        })
    }
}

impl AzraelAuthMutationGuard {
    pub(super) async fn acquire(
        usage: Arc<AzraelAuthUsageLease>,
        transaction: Arc<AzraelAuthTransaction>,
        process_permit: OwnedSemaphorePermit,
    ) -> io::Result<Self> {
        Self::acquire_inner(usage, transaction, Some(process_permit)).await
    }

    async fn acquire_inner(
        usage: Arc<AzraelAuthUsageLease>,
        transaction: Arc<AzraelAuthTransaction>,
        process_permit: Option<OwnedSemaphorePermit>,
    ) -> io::Result<Self> {
        let transaction = transaction.lock().await?;
        let (exclusive_file, generation) = usage.acquire_exclusive()?;
        Ok(Self {
            usage,
            generation,
            exclusive_file: Some(exclusive_file),
            _transaction: transaction,
            _process_permit: process_permit,
        })
    }
}

impl Drop for AzraelAuthMutationGuard {
    fn drop(&mut self) {
        self.exclusive_file.take();
        self.usage.finish_exclusive(self.generation);
    }
}

impl UsageState {
    fn is_owned(&self) -> bool {
        self.file.is_some() || self.exclusive_generation.is_some()
    }
}

fn transaction_timeout_error() -> io::Error {
    io::Error::new(
        io::ErrorKind::TimedOut,
        "timed out waiting for the authentication credential transaction",
    )
}

fn try_lock_shared_file(path: &Path, busy_message: &'static str) -> io::Result<File> {
    let file = open_lock_file(path)?;
    file.try_lock_shared()
        .map_err(|error| map_lock_error(error, busy_message))?;
    Ok(file)
}

fn try_lock_exclusive_file(path: &Path, busy_message: &'static str) -> io::Result<File> {
    let file = open_lock_file(path)?;
    file.try_lock()
        .map_err(|error| map_lock_error(error, busy_message))?;
    Ok(file)
}

fn open_lock_file(path: &Path) -> io::Result<File> {
    OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .truncate(false)
        .open(path)
}

fn map_lock_error(error: std::fs::TryLockError, busy_message: &'static str) -> io::Error {
    match error {
        std::fs::TryLockError::WouldBlock => {
            io::Error::new(io::ErrorKind::WouldBlock, busy_message)
        }
        std::fs::TryLockError::Error(error) => error,
    }
}

fn normalized_registry_key(path: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        PathBuf::from(path.to_string_lossy().to_lowercase())
    }
    #[cfg(not(windows))]
    {
        path.to_path_buf()
    }
}

#[cfg(test)]
#[path = "azrael_unmanaged_tests.rs"]
mod tests;
