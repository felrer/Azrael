use super::AuthManager;
use super::AzraelProfileAuth;
use super::AzraelProfileInfo;
use super::AzraelProfileStatus;
use super::AzraelProfileStore;
use super::CodexAuth;
use crate::token_data::parse_jwt_expiration;
use chrono::Utc;
use codex_utils_path::write_atomically;
use serde::Deserialize;
use serde::Serialize;
use std::fs::File;
use std::fs::OpenOptions;
use std::io;
use std::path::Path;
use std::path::PathBuf;
use std::sync::Arc;

/// The independent account selection used by background services, without credentials.
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AzraelServiceAccountSelection {
    pub revision: u64,
    pub profile_id: Option<String>,
    pub initialized: bool,
}

pub struct AzraelServiceAccountStore {
    root: PathBuf,
}

/// Keeps the selected profile's usage lease alive for one service request.
pub struct AzraelServiceAccountBinding {
    pub selection: AzraelServiceAccountSelection,
    pub profile: Arc<AzraelProfileAuth>,
}

impl PartialEq for AzraelServiceAccountBinding {
    fn eq(&self, other: &Self) -> bool {
        self.selection == other.selection && Arc::ptr_eq(&self.profile, &other.profile)
    }
}

impl Eq for AzraelServiceAccountBinding {}

impl std::fmt::Debug for AzraelServiceAccountBinding {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("AzraelServiceAccountBinding")
            .field("profile_id", &self.selection.profile_id)
            .field("revision", &self.selection.revision)
            .finish_non_exhaustive()
    }
}

impl AzraelServiceAccountBinding {
    pub fn manager(&self) -> Arc<AuthManager> {
        self.profile.manager()
    }
}

impl AzraelServiceAccountStore {
    pub fn new(codex_home: &Path) -> Self {
        Self {
            root: codex_home.join("azrael"),
        }
    }

    /// Reads the latest selection under the same stable lock used by writers.
    pub fn snapshot(&self) -> io::Result<AzraelServiceAccountSelection> {
        let _lock = self.lock()?;
        self.read()
    }

    /// Reads only the selected profile's metadata, without loading credentials.
    /// Keep the selection lock through lookup so catalog availability cannot
    /// report an account that was replaced while its metadata was being read.
    pub fn selected_profile_info(&self) -> io::Result<Option<AzraelProfileInfo>> {
        let _lock = self.lock()?;
        let Some(id) = self.read()?.profile_id else {
            return Ok(None);
        };
        let store = AzraelProfileStore::new(self.root.join("accounts"));
        Ok(store.list()?.into_iter().find(|profile| profile.id == id))
    }

    /// Resolves fresh credentials for one request. A selection change during the
    /// asynchronous authentication check requires a new pre-dispatch resolution.
    pub async fn resolve(&self, template: &AuthManager) -> io::Result<AzraelServiceAccountBinding> {
        let store = AzraelProfileStore::new(self.root.join("accounts"));
        self.resolve_with_store(template, &store).await
    }

    pub(crate) async fn resolve_with_store(
        &self,
        template: &AuthManager,
        store: &AzraelProfileStore,
    ) -> io::Result<AzraelServiceAccountBinding> {
        let selection = self.snapshot()?;
        let id = selection.profile_id.as_deref().ok_or_else(|| {
            io::Error::new(io::ErrorKind::NotFound, "service account is not selected")
        })?;
        let profile = store.open(id, template).await.map_err(profile_read_error)?;
        ensure_available(&profile)?;
        let manager = profile.manager();
        let auth = manager.auth().await.ok_or_else(auth_not_ready)?;
        if !matches!(auth, CodexAuth::Chatgpt(_)) {
            return Err(auth_not_ready());
        }
        let info = profile.info().map_err(profile_read_error)?;
        if auth.get_account_id().as_deref() != Some(info.workspace_account_id.as_str())
            || auth.get_chatgpt_user_id().as_deref() != Some(info.user_id.as_str())
            || info.workspace_account_id.is_empty()
            || info.user_id.is_empty()
        {
            return Err(auth_not_ready());
        }
        let tokens = auth.get_token_data().map_err(|_| auth_not_ready())?;
        if tokens.access_token.is_empty()
            || parse_jwt_expiration(&tokens.access_token)
                .map_err(|_| auth_not_ready())?
                .is_some_and(|expires_at| expires_at <= Utc::now())
        {
            return Err(auth_not_ready());
        }
        ensure_available(&profile)?;
        if self.snapshot()? != selection {
            return Err(io::Error::new(
                io::ErrorKind::WouldBlock,
                "service account selection changed before dispatch",
            ));
        }
        Ok(AzraelServiceAccountBinding { selection, profile })
    }

    /// Explicit selection (including an explicit unset) permanently initializes the store.
    /// The caller owns profile validation; this store never opens credentials.
    pub fn select(&self, profile_id: Option<String>) -> io::Result<AzraelServiceAccountSelection> {
        self.update(|selection| {
            selection.profile_id = profile_id;
            true
        })
    }

    /// Only the first completed login may establish the initial selection.
    pub fn initialize_after_login(
        &self,
        profile_id: &str,
    ) -> io::Result<AzraelServiceAccountSelection> {
        self.update(|selection| {
            if selection.initialized {
                return false;
            }
            selection.profile_id = Some(profile_id.to_owned());
            true
        })
    }

    /// Removing the selected profile leaves services unassigned, without a fallback.
    pub fn clear_if_selected(&self, profile_id: &str) -> io::Result<AzraelServiceAccountSelection> {
        self.update(|selection| {
            if selection.profile_id.as_deref() != Some(profile_id) {
                return false;
            }
            selection.profile_id = None;
            true
        })
    }

    fn lock(&self) -> io::Result<File> {
        std::fs::create_dir_all(&self.root)?;
        // This file is never renamed or removed: replacing the data file cannot split
        // the cross-process lock into separate generations.
        let file = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(self.root.join("service-account.lock"))?;
        file.lock()?;
        Ok(file)
    }

    fn read(&self) -> io::Result<AzraelServiceAccountSelection> {
        let bytes = match std::fs::read(self.root.join("service-account.json")) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                return Ok(AzraelServiceAccountSelection::default());
            }
            Err(error) => return Err(error),
        };
        serde_json::from_slice(&bytes).map_err(|error| {
            io::Error::new(
                io::ErrorKind::InvalidData,
                format!("invalid service account selection: {error}"),
            )
        })
    }

    fn update(
        &self,
        change: impl FnOnce(&mut AzraelServiceAccountSelection) -> bool,
    ) -> io::Result<AzraelServiceAccountSelection> {
        let _lock = self.lock()?;
        let mut selection = self.read()?;
        if change(&mut selection) {
            selection.revision = selection
                .revision
                .checked_add(1)
                .ok_or_else(|| io::Error::other("service account selection revision overflow"))?;
            selection.initialized = true;
            let contents = serde_json::to_string_pretty(&selection).map_err(io::Error::other)?;
            write_atomically(&self.root.join("service-account.json"), &contents)?;
        }
        Ok(selection)
    }
}

fn auth_not_ready() -> io::Error {
    io::Error::new(
        io::ErrorKind::PermissionDenied,
        "service account authentication is unavailable; sign in again",
    )
}

fn profile_read_error(error: io::Error) -> io::Error {
    io::Error::new(error.kind(), "service account profile could not be opened")
}

fn ensure_available(profile: &AzraelProfileAuth) -> io::Result<()> {
    match profile.status().map_err(profile_read_error)? {
        AzraelProfileStatus::Available => Ok(()),
        AzraelProfileStatus::Removed => Err(io::Error::new(
            io::ErrorKind::NotFound,
            "service account profile was removed",
        )),
        AzraelProfileStatus::ReauthenticationRequired => Err(auth_not_ready()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selection_transitions_keep_manual_unset_and_removal_sticky() {
        let home = tempfile::tempdir().unwrap();
        let store = AzraelServiceAccountStore::new(home.path());
        assert_eq!(
            store.snapshot().unwrap(),
            AzraelServiceAccountSelection::default()
        );
        let first = store.initialize_after_login("first").unwrap();
        assert_eq!(first.profile_id.as_deref(), Some("first"));
        assert!(first.initialized);
        assert_eq!(first.revision, 1);
        assert_eq!(store.initialize_after_login("second").unwrap(), first);
        assert_eq!(store.clear_if_selected("second").unwrap(), first);

        let selected = store.select(Some("second".to_owned())).unwrap();
        assert_eq!(selected.revision, 2);
        assert_eq!(store.clear_if_selected("first").unwrap(), selected);
        let cleared = store.clear_if_selected("second").unwrap();
        assert_eq!(cleared.profile_id, None);
        assert!(cleared.initialized);
        assert_eq!(cleared.revision, 3);
        assert_eq!(store.initialize_after_login("third").unwrap(), cleared);

        let empty_home = tempfile::tempdir().unwrap();
        let empty = AzraelServiceAccountStore::new(empty_home.path());
        let unset = empty.select(None).unwrap();
        assert_eq!(unset.revision, 1);
        assert!(unset.initialized);
        assert_eq!(empty.initialize_after_login("later").unwrap(), unset);
        assert_eq!(
            AzraelServiceAccountStore::new(empty_home.path())
                .snapshot()
                .unwrap(),
            unset
        );
    }

    #[test]
    fn malformed_and_unreadable_state_is_preserved() {
        let home = tempfile::tempdir().unwrap();
        let store = AzraelServiceAccountStore::new(home.path());
        store.snapshot().unwrap();
        let path = home.path().join("azrael/service-account.json");
        for contents in [
            "broken",
            "{}",
            r#"{"revision":1,"initialized":true,"profileId":null,"unknown":0}"#,
        ] {
            std::fs::write(&path, contents).unwrap();
            assert_eq!(
                store.snapshot().unwrap_err().kind(),
                io::ErrorKind::InvalidData
            );
            assert!(store.select(None).is_err());
            assert!(store.initialize_after_login("first").is_err());
            assert!(store.clear_if_selected("first").is_err());
            assert_eq!(std::fs::read_to_string(&path).unwrap(), contents);
        }
        std::fs::remove_file(&path).unwrap();
        std::fs::create_dir(&path).unwrap();
        assert!(store.snapshot().is_err());
        assert!(store.select(None).is_err());
        assert!(path.is_dir());
    }

    #[test]
    fn revision_overflow_does_not_replace_selection() {
        let home = tempfile::tempdir().unwrap();
        let store = AzraelServiceAccountStore::new(home.path());
        store.snapshot().unwrap();
        let path = home.path().join("azrael/service-account.json");
        let state = AzraelServiceAccountSelection {
            revision: u64::MAX,
            profile_id: Some("existing".to_owned()),
            initialized: true,
        };
        std::fs::write(&path, serde_json::to_vec(&state).unwrap()).unwrap();
        assert!(store.select(None).is_err());
        assert!(store.clear_if_selected("existing").is_err());
        assert_eq!(store.initialize_after_login("later").unwrap(), state);
        assert_eq!(store.snapshot().unwrap(), state);
    }

    // These cases guard likely future simplifications: replacing initialized with
    // profile_id.is_none(), resetting corrupt state, or locking the replaced JSON.
    #[test]
    fn concurrent_initialization_uses_one_cross_process_winner() {
        const CHILD_HOME: &str = "AZRAEL_SERVICE_ACCOUNT_TEST_CHILD_HOME";
        const CHILD_PROFILE: &str = "AZRAEL_SERVICE_ACCOUNT_TEST_CHILD_PROFILE";
        if let Some(home) = std::env::var_os(CHILD_HOME) {
            let profile = std::env::var(CHILD_PROFILE).unwrap();
            AzraelServiceAccountStore::new(Path::new(&home))
                .initialize_after_login(&profile)
                .unwrap();
            return;
        }
        let home = tempfile::tempdir().unwrap();
        let test_name = concat!(
            module_path!(),
            "::concurrent_initialization_uses_one_cross_process_winner"
        );
        // libtest names omit the crate prefix included by module_path!().
        let test_name = test_name.split_once("::").unwrap().1;
        let mut children = Vec::new();
        for profile in ["first", "second", "third"] {
            children.push(
                std::process::Command::new(std::env::current_exe().unwrap())
                    .args(["--exact", test_name, "--nocapture"])
                    .env(CHILD_HOME, home.path())
                    .env(CHILD_PROFILE, profile)
                    .spawn()
                    .unwrap(),
            );
        }
        for child in &mut children {
            assert!(child.wait().unwrap().success());
        }
        let snapshot = AzraelServiceAccountStore::new(home.path())
            .snapshot()
            .unwrap();
        assert_eq!(snapshot.revision, 1);
        assert!(snapshot.initialized);
        assert!(matches!(
            snapshot.profile_id.as_deref(),
            Some("first" | "second" | "third")
        ));
    }
}
