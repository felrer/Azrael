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
}

pub(super) struct PendingLogin {
    pub(super) login_id: Uuid,
    pub(super) profile: Arc<AzraelProfileAuth>,
    pub(super) replacement_id: Option<String>,
    pub(super) shutdown_handle: ShutdownHandle,
    pub(super) commit_cancel: CancellationToken,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PersistedState {
    selected_profile_id: Option<String>,
}

impl AzraelAccountRuntime {
    pub(super) fn new(config: &Config) -> Self {
        let root = config.codex_home.join("azrael").to_path_buf();
        let configured_path = std::env::var_os("AZRAEL_EX_ACCOUNT_STATE_FILE").map(PathBuf::from);
        let configured_default_path =
            std::env::var_os("AZRAEL_EX_ACCOUNT_DEFAULT_FILE").map(PathBuf::from);
        let (selection_path, default_selection_path, selected_profile_id) =
            read_window_selection_with_default(
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
                selected_profile_id,
                ..RuntimeState::default()
            }),
        }
    }

    pub(super) async fn has_active_profile(&self) -> bool {
        self.inner.lock().await.active_profile.is_some()
    }

    pub(super) async fn clear_after_native_login(&self) {
        let mut state = self.inner.lock().await;
        state.active_profile = None;
        state.selected_profile_id = None;
        state.pending_profile_id = None;
        state.switch_cancel = None;
        state.last_error = None;
        drop(state);
        let _ = write_selected_states(
            &self.selection_path,
            self.default_selection_path.as_deref(),
            None,
        );
    }

    pub(super) async fn clear_after_external_login(&self) {
        self.clear_after_native_login().await;
    }

    pub(super) async fn clear_after_native_logout(&self) -> io::Result<()> {
        {
            let mut state = self.inner.lock().await;
            state.selected_profile_id = None;
            state.pending_profile_id = None;
            state.switch_cancel = None;
            state.last_error = None;
            state.active_profile = None;
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
    let configured_path = configured_path.filter(|path| path.is_absolute());
    let selection_path = configured_path
        .map(Path::to_path_buf)
        .unwrap_or_else(|| root.join(SELECTED_STATE_FILE));
    let default_selection_path = configured_default_path
        .filter(|path| path.is_absolute())
        .map(Path::to_path_buf);
    let selected = if configured_path.is_some() && selection_path.try_exists().unwrap_or(true) {
        read_selected_state(selection_path.as_path())
    } else if let Some(path) = default_selection_path
        .as_deref()
        .filter(|path| path.try_exists().unwrap_or(true))
    {
        read_selected_state(path)
    } else {
        read_selected_state(&root.join(SELECTED_STATE_FILE))
    };
    (selection_path, default_selection_path, selected)
}

pub(super) fn read_selected_state(path: &Path) -> Option<String> {
    let bytes = std::fs::read(path).ok()?;
    serde_json::from_slice::<PersistedState>(&bytes)
        .ok()?
        .selected_profile_id
}

pub(super) fn write_selected_states(
    selection_path: &Path,
    default_selection_path: Option<&Path>,
    selected_profile_id: Option<String>,
) -> io::Result<()> {
    let selection_result = write_selected_state(selection_path, selected_profile_id.clone());
    let default_result = match default_selection_path {
        Some(path) if path != selection_path => write_selected_state(path, selected_profile_id),
        _ => Ok(()),
    };

    selection_result.and(default_result)
}

pub(super) fn write_selected_state(
    path: &Path,
    selected_profile_id: Option<String>,
) -> io::Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::other("state path has no parent"))?;
    std::fs::create_dir_all(parent)?;
    let temp = path.with_extension(format!("json.tmp-{}", Uuid::new_v4()));
    let bytes = serde_json::to_vec_pretty(&PersistedState {
        selected_profile_id,
    })
    .map_err(io::Error::other)?;
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
