//! Thread-owned, durable completion signals for work performed outside the agent tree.
use super::Session;
use serde::Deserialize;
use serde::Serialize;
use std::fs::File;
use std::io::Read;
use std::io::Write;
use std::path::Path;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Notify;

const MAX_FILE_BYTES: u64 = 8192;

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum WorkCompletionState {
    Running,
    Succeeded,
    Failed,
    Cancelled,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct WorkCompletionRecord {
    pub work_id: String,
    pub thread_id: String,
    pub label: String,
    pub created_at_ms: i64,
    pub signal_path: PathBuf,
    pub state: WorkCompletionState,
    pub summary: Option<String>,
    pub exit_code: Option<i32>,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct WorkCompletionSignal {
    pub work_id: String,
    pub state: WorkCompletionState,
    pub summary: Option<String>,
    pub exit_code: Option<i32>,
}

#[derive(Default)]
struct WorkCompletionActivity {
    changed: Arc<Notify>,
}

#[derive(Clone)]
pub(crate) struct WorkCompletionStore {
    directory: PathBuf,
    thread_id: String,
    changed: Arc<Notify>,
}

fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> anyhow::Result<T> {
    let metadata = std::fs::symlink_metadata(path)?;
    anyhow::ensure!(
        metadata.is_file() && !metadata.file_type().is_symlink(),
        "completion records must be regular files"
    );
    anyhow::ensure!(
        metadata.len() <= MAX_FILE_BYTES,
        "completion record exceeds 8192 bytes"
    );
    let mut bytes = Vec::new();
    File::open(path)?
        .take(MAX_FILE_BYTES + 1)
        .read_to_end(&mut bytes)?;
    anyhow::ensure!(
        bytes.len() as u64 <= MAX_FILE_BYTES,
        "completion record exceeds 8192 bytes"
    );
    Ok(serde_json::from_slice(&bytes)?)
}

fn publish_once<T: Serialize>(path: &Path, value: &T) -> anyhow::Result<()> {
    let bytes = serde_json::to_vec(value)?;
    anyhow::ensure!(
        bytes.len() as u64 <= MAX_FILE_BYTES,
        "completion record exceeds 8192 bytes"
    );
    let mut temporary = tempfile::NamedTempFile::new_in(
        path.parent()
            .ok_or_else(|| anyhow::anyhow!("missing completion directory"))?,
    )?;
    temporary.write_all(&bytes)?;
    temporary.as_file().sync_all()?;
    temporary
        .persist_noclobber(path)
        .map_err(|error| error.error)?;
    Ok(())
}

impl WorkCompletionStore {
    fn paths(&self, work_id: &str) -> anyhow::Result<(PathBuf, PathBuf)> {
        let id = uuid::Uuid::parse_str(work_id)?;
        anyhow::ensure!(
            id.to_string() == work_id,
            "work ID must be a canonical UUID"
        );
        let metadata = std::fs::symlink_metadata(&self.directory)?;
        anyhow::ensure!(
            metadata.is_dir() && !metadata.file_type().is_symlink(),
            "completion directory must be a regular directory"
        );
        Ok((
            self.directory.join(format!("{work_id}.json")),
            self.directory.join(format!("{work_id}.signal.json")),
        ))
    }

    pub(crate) async fn create(
        &self,
        label: String,
        now_ms: i64,
    ) -> anyhow::Result<WorkCompletionRecord> {
        let store = self.clone();
        tokio::task::spawn_blocking(move || {
            let label = label.trim().to_string();
            anyhow::ensure!(
                !label.is_empty() && label.len() <= 512,
                "label must contain 1..512 bytes"
            );
            std::fs::create_dir_all(&store.directory)?;
            let work_id = uuid::Uuid::new_v4().to_string();
            let (metadata_path, signal_path) = store.paths(&work_id)?;
            let record = WorkCompletionRecord {
                work_id,
                thread_id: store.thread_id,
                label,
                created_at_ms: now_ms,
                signal_path,
                state: WorkCompletionState::Running,
                summary: None,
                exit_code: None,
            };
            publish_once(&metadata_path, &record)?;
            Ok(record)
        })
        .await?
    }

    pub(crate) async fn status(&self, work_id: String) -> anyhow::Result<WorkCompletionRecord> {
        let store = self.clone();
        tokio::task::spawn_blocking(move || store.read(&work_id)).await?
    }

    fn read(&self, work_id: &str) -> anyhow::Result<WorkCompletionRecord> {
        let (metadata_path, signal_path) = self.paths(work_id)?;
        let mut record: WorkCompletionRecord = read_json(&metadata_path)?;
        anyhow::ensure!(
            record.work_id == work_id
                && record.thread_id == self.thread_id
                && record.signal_path == signal_path
                && record.state == WorkCompletionState::Running,
            "completion record identity mismatch"
        );
        match read_json::<WorkCompletionSignal>(&signal_path) {
            Ok(signal) => {
                validate_signal(&signal, work_id)?;
                record.state = signal.state;
                record.summary = signal.summary;
                record.exit_code = signal.exit_code;
            }
            Err(error)
                if error
                    .downcast_ref::<std::io::Error>()
                    .is_some_and(|e| e.kind() == std::io::ErrorKind::NotFound) => {}
            Err(error) => return Err(error),
        }
        Ok(record)
    }

    pub(crate) async fn finish(
        &self,
        signal: WorkCompletionSignal,
    ) -> anyhow::Result<WorkCompletionRecord> {
        let store = self.clone();
        let result = tokio::task::spawn_blocking(move || {
            validate_signal(&signal, &signal.work_id)?;
            store.read(&signal.work_id)?;
            let (_, path) = store.paths(&signal.work_id)?;
            if let Err(error) = publish_once(&path, &signal) {
                if !error
                    .downcast_ref::<std::io::Error>()
                    .is_some_and(|e| e.kind() == std::io::ErrorKind::AlreadyExists)
                {
                    return Err(error);
                }
                anyhow::ensure!(
                    read_json::<WorkCompletionSignal>(&path)? == signal,
                    "work already has a different terminal result"
                );
            }
            store.read(&signal.work_id)
        })
        .await?;
        if result.is_ok() {
            self.changed.notify_waiters();
        }
        result
    }

    pub(crate) async fn wait_all(
        &self,
        work_ids: &[String],
    ) -> anyhow::Result<Vec<WorkCompletionRecord>> {
        loop {
            // Subscribe before reading sticky state, so completion during registration cannot be lost.
            let changed = self.changed.notified();
            tokio::pin!(changed);
            changed.as_mut().enable();
            let mut records = Vec::new();
            for id in work_ids {
                records.push(self.status(id.clone()).await?);
            }
            if records
                .iter()
                .all(|record| record.state != WorkCompletionState::Running)
            {
                return Ok(records);
            }
            // External producers write files without holding an engine connection. Only the host
            // checks these small signals; waiting makes no model requests or status tool calls.
            tokio::select! {
                _ = changed => {},
                _ = tokio::time::sleep(Duration::from_secs(1)) => {},
            }
        }
    }
}

fn validate_signal(signal: &WorkCompletionSignal, work_id: &str) -> anyhow::Result<()> {
    anyhow::ensure!(
        signal.work_id == work_id,
        "completion signal belongs to another work ID"
    );
    anyhow::ensure!(
        signal.state != WorkCompletionState::Running,
        "finish requires succeeded, failed or cancelled"
    );
    anyhow::ensure!(
        signal
            .summary
            .as_ref()
            .is_none_or(|summary| summary.len() <= 512),
        "summary exceeds 512 bytes"
    );
    Ok(())
}

impl Session {
    pub(crate) async fn work_completion_store(&self) -> WorkCompletionStore {
        let activity = self
            .services
            .thread_extension_data
            .get_or_init(WorkCompletionActivity::default);
        WorkCompletionStore {
            directory: self
                .get_config()
                .await
                .codex_home
                .as_path()
                .join("azrael/work-completions")
                .join(self.thread_id.to_string()),
            thread_id: self.thread_id.to_string(),
            changed: Arc::clone(&activity.changed),
        }
    }
}

#[cfg(test)]
#[path = "work_completion_tests.rs"]
mod tests;
