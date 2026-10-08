use super::*;
use codex_login::AzraelProfileAuth;
use codex_login::AzraelProfileStore;
use serde::Deserialize;
use serde::Serialize;
use std::io;
use std::path::Path;
use std::path::PathBuf;
use std::sync::atomic::AtomicU32;
use tokio::sync::OwnedRwLockWriteGuard;
use tokio_util::sync::CancellationToken;

pub(super) const SELECTED_STATE_FILE: &str = "account-state.json";

pub(super) struct AzraelAccountRuntime {
    pub(super) instance_id: String,
    pub(super) selection_path: PathBuf,
    pub(super) default_selection_path: Option<PathBuf>,
    pub(super) store: Arc<AzraelProfileStore>,
    pub(super) revision: AtomicU32,
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
        let (selection_path, default_selection_path, persisted) = read_window_state_with_default(
            &root,
            configured_path.as_deref(),
            configured_default_path.as_deref(),
        );
        Self {
            instance_id: Uuid::new_v4().to_string(),
            store: Arc::new(AzraelProfileStore::new(root.join("accounts"))),
            revision: AtomicU32::new(0),
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
