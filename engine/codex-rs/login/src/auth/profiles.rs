use super::*;
use rand::RngCore;
use serde::Serialize;
use std::collections::HashMap;
use std::fmt::Write as _;
use std::fs::OpenOptions;
use std::io;
use std::io::Write as _;
use std::sync::Weak;

const PROFILE_METADATA: &str = "profile.json";
const PROFILE_LEASE: &str = "profile.lock";

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct AzraelProfileInfo {
    pub id: String,
    pub email: Option<String>,
    pub workspace_account_id: String,
    pub user_id: String,
    pub plan_type: Option<String>,
}

pub struct AzraelProfileStore {
    root: PathBuf,
    cache: Mutex<HashMap<String, Weak<AzraelProfileAuth>>>,
    credentials_mode: AuthCredentialsStoreMode,
}

pub struct AzraelProfileAuth {
    id: String,
    auth_home: PathBuf,
    manager: Arc<AuthManager>,
    credentials_mode: AuthCredentialsStoreMode,
    _lease: Arc<AzraelAuthUsageLease>,
}

#[derive(Debug)]
struct ProfileRefreshError(RefreshTokenError);

impl std::fmt::Display for ProfileRefreshError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("profile authentication refresh failed")
    }
}

impl std::error::Error for ProfileRefreshError {}

impl AzraelProfileStore {
    pub fn new(root: PathBuf) -> Self {
        Self::with_credentials_mode(root, AuthCredentialsStoreMode::Keyring)
    }

    fn with_credentials_mode(root: PathBuf, credentials_mode: AuthCredentialsStoreMode) -> Self {
        Self {
            root,
            cache: Mutex::new(HashMap::new()),
            credentials_mode,
        }
    }

    #[cfg(test)]
    fn new_ephemeral(root: PathBuf) -> Self {
        Self::with_credentials_mode(root, AuthCredentialsStoreMode::Ephemeral)
    }

    pub async fn create(&self, template: &AuthManager) -> io::Result<Arc<AzraelProfileAuth>> {
        std::fs::create_dir_all(&self.root)?;
        for _ in 0..32 {
            let id = random_id();
            let auth_home = self.root.join(&id);
            match std::fs::create_dir(&auth_home) {
                Ok(()) => return self.open_pending(id, auth_home, template).await,
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(error),
            }
        }
        Err(io::Error::new(
            io::ErrorKind::AlreadyExists,
            "could not allocate a unique authentication profile",
        ))
    }

    pub async fn open(
        &self,
        id: &str,
        template: &AuthManager,
    ) -> io::Result<Arc<AzraelProfileAuth>> {
        validate_id(id)?;
        if let Some(profile) = self.cached(id) {
            return Ok(profile);
        }
        let auth_home = self.root.join(id);
        let info = read_info(&auth_home.join(PROFILE_METADATA))?;
        if info.id != id {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "authentication profile metadata has a mismatched id",
            ));
        }
        self.open_pending(id.to_string(), auth_home, template).await
    }

    pub fn list(&self) -> io::Result<Vec<AzraelProfileInfo>> {
        if !self.root.exists() {
            return Ok(Vec::new());
        }
        let mut profiles = Vec::new();
        for entry in std::fs::read_dir(&self.root)? {
            let entry = entry?;
            if !entry.file_type()?.is_dir() {
                continue;
            }
            let Some(id) = entry.file_name().to_str().map(str::to_owned) else {
                continue;
            };
            if validate_id(&id).is_err() {
                continue;
            }
            let metadata = entry.path().join(PROFILE_METADATA);
            if metadata.is_file() {
                let info = read_info(&metadata)?;
                if info.id != id {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidData,
                        "authentication profile metadata has a mismatched id",
                    ));
                }
                profiles.push(info);
            }
        }
        profiles.sort_by(|left, right| left.id.cmp(&right.id));
        Ok(profiles)
    }

    pub async fn capture_current(
        &self,
        template: &AuthManager,
    ) -> io::Result<Arc<AzraelProfileAuth>> {
        template.reload().await;
        let snapshot = require_native_chatgpt(template.auth_cached())?
            .get_current_auth_json()
            .ok_or_else(|| {
                io::Error::new(
                    io::ErrorKind::InvalidData,
                    "managed authentication state is unavailable",
                )
            })?;
        let profile = self.create(template).await?;
        if let Err(error) = save_auth(
            profile.auth_home(),
            &snapshot,
            profile.credentials_mode,
            AuthKeyringBackendKind::default(),
        ) {
            let _ = self.discard_pending(&profile);
            return Err(error);
        }
        profile.manager.reload().await;
        if let Err(error) = profile.finalize().await {
            let _ = self.discard_pending(&profile);
            return Err(error);
        }
        Ok(profile)
    }

    pub async fn remove(&self, id: &str) -> io::Result<()> {
        validate_id(id)?;
        if self.cached(id).is_some() {
            return Err(io::Error::new(
                io::ErrorKind::WouldBlock,
                "authentication profile is currently in use",
            ));
        }
        let auth_home = self.root.join(id);
        let metadata = auth_home.join(PROFILE_METADATA);
        if !metadata.is_file() {
            return Err(io::Error::new(
                io::ErrorKind::NotFound,
                "authentication profile does not exist",
            ));
        }
        let lease = acquire_lease(&auth_home)?;
        let transaction = AzraelAuthTransaction::for_home(&auth_home)?;
        let _mutation_guard =
            AzraelAuthMutationGuard::acquire_without_process_semaphore(lease, transaction).await?;
        logout(
            &auth_home,
            self.credentials_mode,
            AuthKeyringBackendKind::default(),
        )?;
        std::fs::remove_file(metadata)?;
        Ok(())
    }

    async fn open_pending(
        &self,
        id: String,
        auth_home: PathBuf,
        template: &AuthManager,
    ) -> io::Result<Arc<AzraelProfileAuth>> {
        let lease = acquire_lease(&auth_home)?;
        if let Some(profile) = self.cached(&id) {
            return Ok(profile);
        }
        let manager = Arc::new(
            profile_manager(
                template,
                auth_home.clone(),
                self.credentials_mode,
                Arc::clone(&lease),
            )
            .await?,
        );
        let profile = Arc::new(AzraelProfileAuth {
            id: id.clone(),
            auth_home,
            manager,
            credentials_mode: self.credentials_mode,
            _lease: lease,
        });
        self.cache
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .insert(id, Arc::downgrade(&profile));
        Ok(profile)
    }

    fn cached(&self, id: &str) -> Option<Arc<AzraelProfileAuth>> {
        let mut cache = self
            .cache
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let profile = cache.get(id).and_then(Weak::upgrade);
        if profile.is_none() {
            cache.remove(id);
        }
        profile
    }

    /// Removes credentials and metadata for a caller-owned staging profile without revocation.
    /// Any login server writing this profile must be stopped before calling this method.
    pub fn discard_pending(&self, profile: &Arc<AzraelProfileAuth>) -> io::Result<()> {
        logout(
            profile.auth_home(),
            profile.credentials_mode,
            AuthKeyringBackendKind::default(),
        )?;
        let metadata = profile.auth_home().join(PROFILE_METADATA);
        match std::fs::remove_file(metadata) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error),
        }
    }
}

impl AzraelProfileAuth {
    pub fn id(&self) -> &str {
        &self.id
    }

    pub fn auth_home(&self) -> &Path {
        &self.auth_home
    }

    pub fn manager(&self) -> Arc<AuthManager> {
        Arc::clone(&self.manager)
    }

    pub async fn finalize(&self) -> io::Result<AzraelProfileInfo> {
        self.manager.reload().await;
        let auth = require_native_chatgpt(self.manager.auth().await)?;
        let workspace_account_id = auth.get_account_id().ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::InvalidData,
                "profile workspace identity is missing",
            )
        })?;
        let user_id = auth.get_chatgpt_user_id().ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::InvalidData,
                "profile user identity is missing",
            )
        })?;
        let plan_type = auth
            .get_current_token_data()
            .and_then(|tokens| tokens.id_token.get_chatgpt_plan_type_raw());
        let info = AzraelProfileInfo {
            id: self.id.clone(),
            email: auth.get_account_email(),
            workspace_account_id,
            user_id,
            plan_type,
        };
        write_info_atomically(&self.auth_home.join(PROFILE_METADATA), &info)?;
        Ok(info)
    }

    pub fn info(&self) -> io::Result<AzraelProfileInfo> {
        let info = read_info(&self.auth_home.join(PROFILE_METADATA))?;
        if info.id != self.id {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "authentication profile metadata has a mismatched id",
            ));
        }
        Ok(info)
    }

    /// Persists an observed backend plan without treating an old ID-token claim as current.
    pub fn update_observed_plan(&self, auth: &CodexAuth, plan_type: &str) -> io::Result<()> {
        let mut info = self.info()?;
        if auth.get_account_id().as_deref() != Some(info.workspace_account_id.as_str())
            || auth.get_chatgpt_user_id().as_deref() != Some(info.user_id.as_str())
        {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "plan observation belongs to a different account",
            ));
        }
        if info.plan_type.as_deref() != Some(plan_type) {
            info.plan_type = Some(plan_type.to_string());
            write_info_atomically(&self.auth_home.join(PROFILE_METADATA), &info)?;
        }
        Ok(())
    }

    pub async fn replace_from(&self, staged: &AzraelProfileAuth) -> io::Result<AzraelProfileInfo> {
        let target = self.info()?;
        let staged_auth = require_native_chatgpt(staged.manager.auth().await)?;
        if staged_auth.get_account_id().as_deref() != Some(target.workspace_account_id.as_str())
            || staged_auth.get_chatgpt_user_id().as_deref() != Some(target.user_id.as_str())
        {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "replacement authentication belongs to a different account",
            ));
        }
        let snapshot = staged_auth.get_current_auth_json().ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::InvalidData,
                "managed authentication state is unavailable",
            )
        })?;
        let refresh_guard = self.manager.refresh_lock.acquire().await.map_err(|_| {
            io::Error::other("authentication profile refresh coordination is unavailable")
        })?;
        let transaction_guard = self
            .manager
            .lock_azrael_unmanaged_refresh()
            .await?
            .ok_or_else(|| io::Error::other("authentication profile transaction is unavailable"))?;
        save_auth(
            &self.auth_home,
            &snapshot,
            self.credentials_mode,
            AuthKeyringBackendKind::default(),
        )?;
        self.manager.reload().await;
        drop(transaction_guard);
        drop(refresh_guard);
        self.finalize().await
    }

    pub async fn clear_credentials(&self) -> io::Result<()> {
        let _mutation_guard = self
            .manager
            .lock_azrael_unmanaged_mutation()
            .await?
            .ok_or_else(|| io::Error::other("authentication profile mutation is unavailable"))?;
        self.manager.logout().await?;
        Ok(())
    }

    pub async fn logout_with_revoke(&self) -> io::Result<bool> {
        let _mutation_guard = self
            .manager
            .lock_azrael_unmanaged_mutation()
            .await?
            .ok_or_else(|| io::Error::other("authentication profile mutation is unavailable"))?;
        self.manager.logout_with_revoke().await
    }
}

impl ExternalAuth for AzraelProfileAuth {
    fn resolve(&self) -> ExternalAuthFuture<'_, CodexAuth> {
        Box::pin(async move { require_native_chatgpt(self.manager.auth().await) })
    }

    fn refresh(&self, _context: ExternalAuthRefreshContext) -> ExternalAuthFuture<'_, CodexAuth> {
        Box::pin(async move {
            self.manager
                .refresh_token()
                .await
                .map_err(|error| io::Error::other(ProfileRefreshError(error)))?;
            require_native_chatgpt(self.manager.auth().await)
        })
    }

    fn classify_error(&self, error: io::Error) -> RefreshTokenError {
        if !matches!(error.get_ref(), Some(inner) if inner.is::<ProfileRefreshError>()) {
            return RefreshTokenError::Transient(error);
        }
        match error.into_inner() {
            Some(inner) => match inner.downcast::<ProfileRefreshError>() {
                Ok(profile_error) => profile_error.0,
                Err(inner) => RefreshTokenError::Transient(io::Error::other(inner)),
            },
            None => RefreshTokenError::Transient(io::Error::other(
                "profile refresh error classification failed",
            )),
        }
    }
}

async fn profile_manager(
    template: &AuthManager,
    auth_home: PathBuf,
    credentials_mode: AuthCredentialsStoreMode,
    usage: Arc<AzraelAuthUsageLease>,
) -> io::Result<AuthManager> {
    let forced_chatgpt_workspace_id = template
        .forced_chatgpt_workspace_id
        .read()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .clone();
    let transaction = AzraelAuthTransaction::for_home(&auth_home)?;
    let mut manager = AuthManager::new_from_auth_config_and_auth(
        AuthConfig {
            codex_home: auth_home,
            auth_credentials_store_mode: credentials_mode,
            keyring_backend_kind: AuthKeyringBackendKind::default(),
            forced_login_method: template.forced_login_method,
            chatgpt_base_url: template.chatgpt_base_url.clone(),
            forced_chatgpt_workspace_id,
            managed_auth_policy: template.managed_auth_policy.clone(),
            auth_route_config: template.auth_route_config.clone(),
        },
        false,
        None,
    );
    // Profiles have their own credential owner, but the template owns publication of
    // the application policy shared by all profiles.
    manager.invalidates_shared_network_policy = false;
    manager.azrael_auth_usage = Some(usage);
    manager.azrael_auth_transaction = Some(transaction);
    manager.reload().await;
    Ok(manager)
}

fn require_native_chatgpt(auth: Option<CodexAuth>) -> io::Result<CodexAuth> {
    match auth {
        Some(auth @ CodexAuth::Chatgpt(_)) => Ok(auth),
        Some(_) => Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "authentication profile requires managed ChatGPT authentication",
        )),
        None => Err(io::Error::new(
            io::ErrorKind::NotFound,
            "authentication profile is unavailable",
        )),
    }
}

fn validate_id(id: &str) -> io::Result<()> {
    if id.len() == 32
        && id
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        Ok(())
    } else {
        Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "authentication profile id must be 32 lowercase hexadecimal characters",
        ))
    }
}

fn random_id() -> String {
    let mut bytes = [0_u8; 16];
    rand::rng().fill_bytes(&mut bytes);
    let mut id = String::with_capacity(32);
    for byte in bytes {
        let _ = write!(&mut id, "{byte:02x}");
    }
    id
}

fn acquire_lease(auth_home: &Path) -> io::Result<Arc<AzraelAuthUsageLease>> {
    AzraelAuthUsageLease::acquire(
        auth_home.join(PROFILE_LEASE),
        "authentication profile is currently in use",
        /*allow_initial_would_block*/ false,
    )
}

fn read_info(path: &Path) -> io::Result<AzraelProfileInfo> {
    let bytes = std::fs::read(path)?;
    serde_json::from_slice(&bytes).map_err(|error| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            format!("invalid authentication profile metadata: {error}"),
        )
    })
}

fn write_info_atomically(path: &Path, info: &AzraelProfileInfo) -> io::Result<()> {
    let suffix = random_id();
    let temp = path.with_extension(format!("json.tmp-{suffix}"));
    let backup = path.with_extension(format!("json.bak-{suffix}"));
    let result = (|| {
        let bytes = serde_json::to_vec_pretty(info).map_err(io::Error::other)?;
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temp)?;
        file.write_all(&bytes)?;
        file.sync_all()?;
        if path.exists() {
            std::fs::rename(path, &backup)?;
        }
        if let Err(error) = std::fs::rename(&temp, path) {
            if backup.exists() {
                let _ = std::fs::rename(&backup, path);
            }
            return Err(error);
        }
        if backup.exists() {
            let _ = std::fs::remove_file(&backup);
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temp);
    }
    result
}

#[cfg(test)]
#[path = "profiles_tests.rs"]
mod tests;
