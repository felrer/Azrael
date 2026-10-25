use crate::{AccessMode, Auth, State, paths};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

pub(crate) struct Store<'a> {
    pub state: State,
    root: PathBuf,
    directory: PathBuf,
    handle: Option<crate::lock_recovery::Sentinel<'a>>,
}
impl<'a> Store<'a> {
    pub fn open(root: &Path, auth: Auth<'a>, mutate: bool) -> Result<Self, String> {
        let directory = root.join("artifacts/maintenance");
        if !mutate {
            let manifest = directory.join("manifest.json");
            paths::check(root, &manifest, auth)?;
            let state = match fs::read(&manifest) {
                Ok(bytes) => serde_json::from_slice(&bytes).map_err(|e| e.to_string())?,
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => State::default(),
                Err(e) => return Err(e.to_string()),
            };
            return Ok(Self {
                state,
                root: root.to_owned(),
                directory,
                handle: None,
            });
        }
        for p in [root.join("artifacts"), directory.clone()] {
            paths::check(root, &p, auth)?;
            if !p.exists() {
                auth(p.parent().ok_or("missing state parent")?, AccessMode::Write)?;
                auth(&p, AccessMode::Write)?;
                fs::create_dir(&p).map_err(|e| e.to_string())?;
            }
        }
        let lock = directory.join("maintenance.lock");
        let handle = crate::lock_recovery::Sentinel::acquire(root, &lock, "maintenance", auth)?;
        let manifest = directory.join("manifest.json");
        // Once acquired, errors release only our own lock through Drop.
        let mut store = Self {
            state: State::default(),
            root: root.to_owned(),
            directory,
            handle: Some(handle),
        };
        paths::check(root, &manifest, auth)?;
        if manifest.exists() {
            store.state = serde_json::from_slice(&fs::read(manifest).map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
        }
        Ok(store)
    }
    pub fn save(&mut self, auth: Auth<'_>) -> Result<(), String> {
        if self.handle.is_none() {
            return Err("read-only state cannot be saved".into());
        }
        self.state.revision += 1;
        let manifest = self.directory.join("manifest.json");
        let temporary = self.directory.join("manifest.pending");
        paths::check(&self.root, &manifest, auth)?;
        paths::check(&self.root, &temporary, auth)?;
        for p in [&self.directory, &manifest, &temporary] {
            auth(p, AccessMode::Write)?;
        }
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|e| format!("state pending file requires recovery: {e}"))?;
        file.write_all(&serde_json::to_vec_pretty(&self.state).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        drop(file);
        fs::rename(temporary, manifest).map_err(|e| e.to_string())?;
        Ok(())
    }
    pub fn authorize_save(&self, auth: Auth<'_>) -> Result<(), String> {
        for path in [
            &self.directory,
            self.directory.join("manifest.json").as_path(),
            self.directory.join("manifest.pending").as_path(),
        ] {
            paths::check(&self.root, path, auth)?;
            auth(path, AccessMode::Write)?;
        }
        Ok(())
    }
}
