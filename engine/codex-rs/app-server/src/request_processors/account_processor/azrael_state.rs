use super::*;
use codex_login::AzraelProfileAuth;
use codex_login::AzraelProfileStore;
use serde::Deserialize;
use serde::Serialize;
use std::io;
use std::path::Path;
use std::path::PathBuf;
use std::sync::atomic::AtomicU32;
use std::sync::atomic::Ordering;
use tokio::sync::OwnedRwLockWriteGuard;
use tokio_util::sync::CancellationToken;

pub(super) const SELECTED_STATE_FILE: &str = "account-state.json";

/// Identity and snapshot ordering owned by one backend lifetime, shared by its windows.
#[derive(Clone)]
pub(crate) struct AzraelAccountBackendState {
    instance_id: String,
    revision: Arc<AtomicU32>,
}

impl Default for AzraelAccountBackendState {
    fn default() -> Self {
        Self {
            instance_id: Uuid::new_v4().to_string(),
            revision: Arc::new(AtomicU32::new(0)),
        }
    }
}

/// Validated selection files for an execution context sharing a stable Codex home.
#[derive(Clone, Debug)]
pub(crate) struct AzraelAccountStatePaths {
    selection_path: PathBuf,
    default_selection_path: Option<PathBuf>,
}

impl AzraelAccountStatePaths {
    pub(crate) fn new(
        selection_path: PathBuf,
        default_selection_path: Option<PathBuf>,
    ) -> io::Result<Self> {
        if !selection_path.is_absolute()
            || default_selection_path
                .as_deref()
                .is_some_and(|path| !path.is_absolute())
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "account selection files must use absolute paths",
            ));
        }
        Ok(Self {
            selection_path,
            default_selection_path,
        })
    }
}

pub(super) struct AzraelAccountRuntime {
    /// Shared backend identity; owner routing separately isolates account state.
    pub(super) instance_id: String,
    pub(super) selection_path: PathBuf,
    pub(super) default_selection_path: Option<PathBuf>,
    pub(super) store: Arc<AzraelProfileStore>,
    pub(super) revision: Arc<AtomicU32>,
    pub(super) inner: Mutex<RuntimeState>,
}

#[derive(Default)]
pub(super) struct RuntimeState {
    pub(super) active_profile: Option<Arc<AzraelProfileAuth>>,
    pub(super) selected_profile_id: Option<String>,
    pub(super) pending_profile_id: Option<String>,
    pub(super) switch_cancel: Option<CancellationToken>,
    pub(super) login: Option<PendingLogin>,
    pub(super) last_error: Option<String>,
    pub(super) failed_closed_guard: Option<OwnedRwLockWriteGuard<()>>,
    pub(super) requires_recovery: bool,
}

pub(super) struct PendingLogin {
    pub(super) login_id: Uuid,
    pub(super) profile: Arc<AzraelProfileAuth>,
    pub(super) replacement_id: Option<String>,
    pub(super) shutdown_handle: ShutdownHandle,
    pub(super) commit_cancel: CancellationToken,
}

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PersistedState {
    selected_profile_id: Option<String>,
    #[serde(default)]
    requires_recovery: bool,
}

impl AzraelAccountRuntime {
    pub(super) fn new(config: &Config) -> Self {
        let root = config.codex_home.join("azrael").to_path_buf();
        let configured_path = std::env::var_os("AZRAEL_EX_ACCOUNT_STATE_FILE").map(PathBuf::from);
        let configured_default_path =
            std::env::var_os("AZRAEL_EX_ACCOUNT_DEFAULT_FILE").map(PathBuf::from);
        Self::from_paths(
            &root,
            configured_path.as_deref(),
            configured_default_path.as_deref(),
        )
    }

    pub(super) fn new_with_state_paths(config: &Config, paths: AzraelAccountStatePaths) -> Self {
        Self::from_paths(
            &config.codex_home.join("azrael"),
            Some(&paths.selection_path),
            paths.default_selection_path.as_deref(),
        )
    }

    pub(super) fn with_backend_state(mut self, backend: AzraelAccountBackendState) -> Self {
        self.instance_id = backend.instance_id;
        self.revision = backend.revision;
        self
    }

    pub(super) fn next_revision(&self) -> u32 {
        self.revision.fetch_add(1, Ordering::Relaxed)
    }

    fn from_paths(
        root: &Path,
        configured_path: Option<&Path>,
        configured_default_path: Option<&Path>,
    ) -> Self {
        let (selection_path, default_selection_path, persisted) =
            read_window_state_with_default(root, configured_path, configured_default_path);
        let backend = AzraelAccountBackendState::default();
        Self {
            instance_id: backend.instance_id,
            store: Arc::new(AzraelProfileStore::new(root.join("accounts"))),
            revision: backend.revision,
            selection_path,
            default_selection_path,
            inner: Mutex::new(RuntimeState {
                selected_profile_id: persisted.selected_profile_id,
                requires_recovery: persisted.requires_recovery,
                ..RuntimeState::default()
            }),
        }
    }

    pub(super) async fn has_active_profile(&self) -> bool {
        self.inner.lock().await.active_profile.is_some()
    }

    pub(super) fn requires_startup_recovery(&self) -> bool {
        let Ok(state) = self.inner.try_lock() else {
            return true;
        };
        if state.requires_recovery {
            return true;
        }
        state.selected_profile_id.as_ref().is_some_and(|id| {
            !self
                .store
                .status(id)
                .is_ok_and(|status| status == codex_login::AzraelProfileStatus::Available)
                || !self
                    .store
                    .list()
                    .is_ok_and(|profiles| profiles.iter().any(|profile| profile.id == *id))
        })
    }

    pub(super) async fn clear_after_native_login(&self) -> io::Result<()> {
        write_selected_states(
            &self.selection_path,
            self.default_selection_path.as_deref(),
            None,
        )?;
        let mut state = self.inner.lock().await;
        state.active_profile = None;
        state.selected_profile_id = None;
        state.pending_profile_id = None;
        state.switch_cancel = None;
        state.last_error = None;
        state.requires_recovery = false;
        drop(state);
        Ok(())
    }

    pub(super) async fn clear_after_external_login(&self) -> io::Result<()> {
        self.clear_after_native_login().await
    }

    pub(super) async fn clear_after_native_logout(&self) -> io::Result<()> {
        {
            let mut state = self.inner.lock().await;
            state.selected_profile_id = None;
            state.pending_profile_id = None;
            state.switch_cancel = None;
            state.last_error = None;
            state.active_profile = None;
            state.requires_recovery = false;
        }
        write_selected_states(
            &self.selection_path,
            self.default_selection_path.as_deref(),
            None,
        )
    }
}

pub(super) fn read_window_selection_with_default(
    root: &Path,
    configured_path: Option<&Path>,
    configured_default_path: Option<&Path>,
) -> (PathBuf, Option<PathBuf>, Option<String>) {
    let (path, default, state) =
        read_window_state_with_default(root, configured_path, configured_default_path);
    (path, default, state.selected_profile_id)
}

fn read_window_state_with_default(
    root: &Path,
    configured_path: Option<&Path>,
    configured_default_path: Option<&Path>,
) -> (PathBuf, Option<PathBuf>, PersistedState) {
    let configured_path = configured_path.filter(|path| path.is_absolute());
    let selection_path = configured_path
        .map(Path::to_path_buf)
        .unwrap_or_else(|| root.join(SELECTED_STATE_FILE));
    let default_selection_path = configured_default_path
        .filter(|path| path.is_absolute())
        .map(Path::to_path_buf);
    let selected = if configured_path.is_some() && selection_path.try_exists().unwrap_or(true) {
        read_persisted_state(selection_path.as_path())
    } else if let Some(path) = default_selection_path
        .as_deref()
        .filter(|path| path.try_exists().unwrap_or(true))
    {
        read_persisted_state(path)
    } else {
        read_persisted_state(&root.join(SELECTED_STATE_FILE))
    };
    (selection_path, default_selection_path, selected)
}

pub(super) fn read_selected_state(path: &Path) -> Option<String> {
    read_persisted_state(path).selected_profile_id
}

fn read_persisted_state(path: &Path) -> PersistedState {
    let result = std::fs::read(path).and_then(|bytes| {
        let value: serde_json::Value = serde_json::from_slice(&bytes).map_err(io::Error::other)?;
        if value.get("selectedProfileId").is_none() {
            return Err(io::Error::other("account state lacks selected identity"));
        }
        serde_json::from_value::<PersistedState>(value).map_err(io::Error::other)
    });
    let mut state = match result {
        Ok(state) => state,
        Err(error) if error.kind() == io::ErrorKind::NotFound => PersistedState::default(),
        Err(_) => PersistedState {
            requires_recovery: true,
            ..Default::default()
        },
    };
    if state.requires_recovery {
        state.selected_profile_id = None;
    }
    state
}

pub(super) fn write_selected_states(
    selection_path: &Path,
    default_selection_path: Option<&Path>,
    selected_profile_id: Option<String>,
) -> io::Result<()> {
    write_persisted_states(
        selection_path,
        default_selection_path,
        PersistedState {
            selected_profile_id,
            requires_recovery: false,
        },
    )
}

pub(super) fn write_recovery_states(
    selection_path: &Path,
    default_selection_path: Option<&Path>,
) -> io::Result<()> {
    write_persisted_states(
        selection_path,
        default_selection_path,
        PersistedState {
            requires_recovery: true,
            ..Default::default()
        },
    )
}

fn write_persisted_states(
    selection_path: &Path,
    default_selection_path: Option<&Path>,
    state: PersistedState,
) -> io::Result<()> {
    let selection_result = write_persisted_state(selection_path, state.clone());
    let default_result = match default_selection_path {
        Some(path) if path != selection_path => write_persisted_state(path, state),
        _ => Ok(()),
    };

    selection_result.and(default_result)
}

pub(super) fn write_selected_state(
    path: &Path,
    selected_profile_id: Option<String>,
) -> io::Result<()> {
    write_persisted_state(
        path,
        PersistedState {
            selected_profile_id,
            requires_recovery: false,
        },
    )
}

fn write_persisted_state(path: &Path, state: PersistedState) -> io::Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::other("state path has no parent"))?;
    std::fs::create_dir_all(parent)?;
    let temp = path.with_extension(format!("json.tmp-{}", Uuid::new_v4()));
    let bytes = serde_json::to_vec_pretty(&state).map_err(io::Error::other)?;
    std::fs::write(&temp, bytes)?;
    let backup = path.with_extension(format!("json.bak-{}", Uuid::new_v4()));
    if path.exists() {
        std::fs::rename(path, &backup)?;
    }
    if let Err(error) = std::fs::rename(&temp, path) {
        if backup.exists() {
            let _ = std::fs::rename(&backup, path);
        }
        let _ = std::fs::remove_file(&temp);
        return Err(error);
    }
    if backup.exists() {
        std::fs::remove_file(backup)?;
    }
    Ok(())
}

#[cfg(test)]
mod durable_recovery_tests {
    use super::*;

    #[test]
    fn explicit_account_paths_reject_relative_selection_and_default() {
        let root = tempfile::tempdir().unwrap();
        for (selection, default) in [
            (PathBuf::from("window.json"), None),
            (
                root.path().join("window.json"),
                Some(PathBuf::from("default.json")),
            ),
        ] {
            assert_eq!(
                AzraelAccountStatePaths::new(selection, default)
                    .unwrap_err()
                    .kind(),
                io::ErrorKind::InvalidInput,
            );
        }
        assert!(AzraelAccountStatePaths::new(root.path().join("window.json"), None).is_ok());
    }

    #[tokio::test]
    async fn explicit_contexts_keep_window_selections_and_share_stable_profile_home() {
        let home = tempfile::tempdir().unwrap();
        let sessions = tempfile::tempdir().unwrap();
        let config = codex_core::config::ConfigBuilder::default()
            .codex_home(home.path().to_path_buf())
            .build()
            .await
            .unwrap();
        let profile_id = "0123456789abcdef0123456789abcdef";
        let profile_home = home.path().join("azrael/accounts").join(profile_id);
        std::fs::create_dir_all(&profile_home).unwrap();
        let profile = codex_login::AzraelProfileInfo {
            id: profile_id.to_string(),
            email: None,
            workspace_account_id: "synthetic-workspace".to_string(),
            user_id: "synthetic-user".to_string(),
            plan_type: None,
            auto_switch_allowed: false,
        };
        std::fs::write(
            profile_home.join("profile.json"),
            serde_json::to_vec(&profile).unwrap(),
        )
        .unwrap();
        let first_path = sessions.path().join("first.json");
        let second_path = sessions.path().join("second.json");
        let default_path = sessions.path().join("default.json");
        write_selected_states(&default_path, None, Some("default".to_string())).unwrap();
        write_selected_states(&first_path, None, Some("first".to_string())).unwrap();
        let backend = AzraelAccountBackendState::default();
        let context = |path| {
            AzraelAccountRuntime::new_with_state_paths(
                &config,
                AzraelAccountStatePaths::new(path, Some(default_path.clone())).unwrap(),
            )
            .with_backend_state(backend.clone())
        };
        let first = context(first_path.clone());
        let second = context(second_path.clone());
        assert_eq!(first.instance_id, second.instance_id);
        assert_eq!(
            first.inner.lock().await.selected_profile_id.as_deref(),
            Some("first")
        );
        assert_eq!(
            second.inner.lock().await.selected_profile_id.as_deref(),
            Some("default")
        );
        assert_eq!(first.store.list().unwrap(), vec![profile.clone()]);
        assert_eq!(second.store.list().unwrap(), vec![profile]);

        second.clear_after_native_logout().await.unwrap();
        assert_eq!(
            first.inner.lock().await.selected_profile_id.as_deref(),
            Some("first")
        );
        assert_eq!(read_selected_state(&first_path).as_deref(), Some("first"));
        assert!(read_selected_state(&second_path).is_none());
        assert!(read_selected_state(&default_path).is_none());
        assert!(!home.path().join("azrael/account-state.json").exists());
        let restored_first = context(first_path);
        let restored_second = context(second_path);
        assert_eq!(
            restored_first
                .inner
                .lock()
                .await
                .selected_profile_id
                .as_deref(),
            Some("first")
        );
        assert!(
            restored_second
                .inner
                .lock()
                .await
                .selected_profile_id
                .is_none()
        );
    }

    #[tokio::test]
    async fn shared_backend_rejoin_orders_snapshots_across_independent_contexts() {
        let home = tempfile::tempdir().unwrap();
        let config = codex_core::config::ConfigBuilder::default()
            .codex_home(home.path().to_path_buf())
            .build()
            .await
            .unwrap();
        let backend = AzraelAccountBackendState::default();
        let context = |name: &str| {
            AzraelAccountRuntime::new_with_state_paths(
                &config,
                AzraelAccountStatePaths::new(home.path().join(name), None).unwrap(),
            )
        };
        let retained = context("original.json").with_backend_state(backend.clone());
        let newcomer = context("new.json").with_backend_state(backend);
        let independent = context("other-backend.json");
        assert_eq!(retained.instance_id, newcomer.instance_id);
        assert_ne!(retained.instance_id, independent.instance_id);
        assert!(Arc::ptr_eq(&retained.revision, &newcomer.revision));
        assert!(!Arc::ptr_eq(&retained.revision, &independent.revision));

        // A new window can read many snapshots before resuming the retained context.
        let original = retained.next_revision();
        let new_first = newcomer.next_revision();
        let new_last = newcomer.next_revision();
        let rejoined = retained.next_revision();
        assert!(original < new_first && new_first < new_last && new_last < rejoined);
        assert_eq!(independent.next_revision(), 0);
        assert_ne!(retained.selection_path, newcomer.selection_path);
        newcomer.inner.lock().await.selected_profile_id = Some("new-window".to_string());
        assert!(retained.inner.lock().await.selected_profile_id.is_none());
    }

    #[tokio::test]
    async fn explicit_context_keeps_fail_closed_window_state_over_healthy_default() {
        let home = tempfile::tempdir().unwrap();
        let config = codex_core::config::ConfigBuilder::default()
            .codex_home(home.path().to_path_buf())
            .build()
            .await
            .unwrap();
        let window = home.path().join("window.json");
        let default = home.path().join("default.json");
        write_recovery_states(&window, None).unwrap();
        write_selected_states(&default, None, Some("healthy".to_string())).unwrap();
        let runtime = AzraelAccountRuntime::new_with_state_paths(
            &config,
            AzraelAccountStatePaths::new(window, Some(default)).unwrap(),
        );
        assert!(runtime.requires_startup_recovery());
        assert!(runtime.inner.lock().await.selected_profile_id.is_none());
    }

    #[test]
    fn durable_recovery_survives_window_default_and_clears_with_explicit_identity() {
        let root = tempfile::tempdir().unwrap();
        let window = root.path().join("window.json");
        let default = root.path().join("default.json");
        write_recovery_states(&window, Some(&default)).unwrap();
        for path in [&window, &default] {
            let state = read_persisted_state(path);
            assert!(state.requires_recovery);
            assert!(state.selected_profile_id.is_none());
        }
        let (_, _, state) =
            read_window_state_with_default(root.path(), Some(&window), Some(&default));
        assert!(state.requires_recovery);
        write_selected_states(&window, Some(&default), Some("healthy".to_string())).unwrap();
        for path in [&window, &default] {
            let state = read_persisted_state(path);
            assert!(!state.requires_recovery);
            assert_eq!(state.selected_profile_id.as_deref(), Some("healthy"));
        }
    }

    #[test]
    fn durable_recovery_state_accepts_legacy_and_fails_closed_on_bad_state() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("state.json");
        assert!(!read_persisted_state(&path).requires_recovery);
        std::fs::write(&path, br#"{"selectedProfileId":"legacy"}"#).unwrap();
        assert!(!read_persisted_state(&path).requires_recovery);
        for bytes in [
            b"broken".as_slice(),
            b"{}",
            br#"{"selectedProfileId":null,"requiresRecovery":"bad"}"#,
        ] {
            std::fs::write(&path, bytes).unwrap();
            assert!(read_persisted_state(&path).requires_recovery);
        }
        std::fs::remove_file(&path).unwrap();
        std::fs::create_dir(&path).unwrap();
        assert!(read_persisted_state(&path).requires_recovery);
    }
}
