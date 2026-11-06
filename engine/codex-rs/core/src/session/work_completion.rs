//! Thread-owned, durable completion signals for work performed outside the agent tree.
use super::Session;
use serde::Deserialize;
use serde::Serialize;
use std::fs::File;
use std::fs::OpenOptions;
use std::fs::TryLockError;
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
    Unknown,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub execution: Option<WorkExecution>,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct WorkExecution {
    pub work_id: String,
    pub thread_id: String,
    pub execution_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct HostTerminal {
    execution: WorkExecution,
    state: WorkCompletionState,
    exit_code: Option<i32>,
    summary: String,
}

/// All clones share one OS lease. A missing receipt never establishes process termination.
#[derive(Clone, Debug)]
pub(crate) struct ExecutionCompletion(Arc<ExecutionCompletionInner>);

#[derive(Debug)]
struct ExecutionCompletionInner {
    execution: WorkExecution,
    terminal_path: PathBuf,
    _lease: File,
    changed: Arc<Notify>,
}

impl ExecutionCompletion {
    pub(crate) fn complete(
        &self,
        state: WorkCompletionState,
        exit_code: Option<i32>,
        summary: &str,
    ) -> anyhow::Result<()> {
        self.0.complete(state, exit_code, summary)
    }
}

impl ExecutionCompletionInner {
    fn complete(
        &self,
        state: WorkCompletionState,
        exit_code: Option<i32>,
        summary: &str,
    ) -> anyhow::Result<()> {
        let receipt = HostTerminal {
            execution: self.execution.clone(),
            state,
            exit_code,
            summary: summary.to_string(),
        };
        validate_host_terminal(&receipt, &self.execution)?;
        publish_terminal(&self.terminal_path, &receipt)?;
        self.changed.notify_waiters();
        Ok(())
    }
}

impl Drop for ExecutionCompletionInner {
    fn drop(&mut self) {
        // The lease remains held until this callback has published the fallback receipt.
        let result = match read_optional::<HostTerminal>(&self.terminal_path) {
            Ok(Some(receipt)) => validate_host_terminal(&receipt, &self.execution),
            Ok(None) => self.complete(WorkCompletionState::Unknown, None, OBSERVATION_LOST),
            Err(error) => Err(error),
        };
        if let Err(error) = result {
            tracing::error!(work_id = %self.execution.work_id, %error, "failed to persist execution completion on drop");
        }
    }
}

const OBSERVATION_LOST: &str =
    "Host execution observation lost; process termination and exit status are unknown";

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

fn read_optional<T: serde::de::DeserializeOwned>(path: &Path) -> anyhow::Result<Option<T>> {
    match read_json(path) {
        Ok(value) => Ok(Some(value)),
        Err(error)
            if error
                .downcast_ref::<std::io::Error>()
                .is_some_and(|e| e.kind() == std::io::ErrorKind::NotFound) =>
        {
            Ok(None)
        }
        Err(error) => Err(error),
    }
}

fn open_lock(path: &Path, create: bool) -> anyhow::Result<File> {
    if let Ok(metadata) = std::fs::symlink_metadata(path) {
        anyhow::ensure!(
            metadata.is_file() && !metadata.file_type().is_symlink(),
            "execution lock must be a regular file"
        );
    }
    Ok(OpenOptions::new()
        .read(true)
        .write(true)
        .create(create)
        .truncate(false)
        .open(path)?)
}

fn publish_terminal(path: &Path, receipt: &HostTerminal) -> anyhow::Result<()> {
    if let Err(error) = publish_once(path, receipt) {
        if !error
            .downcast_ref::<std::io::Error>()
            .is_some_and(|e| e.kind() == std::io::ErrorKind::AlreadyExists)
        {
            return Err(error);
        }
        anyhow::ensure!(
            read_json::<HostTerminal>(path)? == *receipt,
            "execution already has a different terminal result"
        );
    }
    Ok(())
}

fn validate_host_terminal(receipt: &HostTerminal, execution: &WorkExecution) -> anyhow::Result<()> {
    anyhow::ensure!(
        &receipt.execution == execution,
        "host completion identity mismatch"
    );
    anyhow::ensure!(
        receipt.state != WorkCompletionState::Running,
        "host completion requires a terminal state"
    );
    anyhow::ensure!(receipt.summary.len() <= 512, "summary exceeds 512 bytes");
    anyhow::ensure!(
        receipt.state != WorkCompletionState::Unknown || receipt.exit_code.is_none(),
        "unknown completion cannot establish an exit code"
    );
    Ok(())
}

impl WorkCompletionStore {
    #[cfg(test)]
    pub(crate) fn for_test(root: &Path, thread_id: &str) -> Self {
        Self {
            directory: root.join(thread_id),
            thread_id: thread_id.to_string(),
            changed: Arc::new(Notify::new()),
        }
    }

    fn sibling(&self, work_id: &str, suffix: &str) -> PathBuf {
        self.directory.join(format!("{work_id}.{suffix}"))
    }

    fn mutation_lease(&self, work_id: &str) -> anyhow::Result<File> {
        self.paths(work_id)?;
        let lease = open_lock(&self.sibling(work_id, "mutation.lock"), true)?;
        lease
            .try_lock()
            .map_err(|error| anyhow::anyhow!("completion record is busy: {error}"))?;
        Ok(lease)
    }

    pub(crate) fn bind_execution(
        &self,
        work_id: &str,
        execution_id: String,
    ) -> anyhow::Result<ExecutionCompletion> {
        anyhow::ensure!(
            !execution_id.trim().is_empty() && execution_id.len() <= 512,
            "execution ID must contain 1..512 bytes"
        );
        let _mutation = self.mutation_lease(work_id)?;
        let record = self.read(work_id)?;
        anyhow::ensure!(
            record.execution.is_none(),
            "work is already bound to an execution"
        );
        anyhow::ensure!(
            record.state == WorkCompletionState::Running,
            "work is already terminal"
        );
        let lease = open_lock(&self.sibling(work_id, "execution.lock"), true)?;
        lease
            .try_lock()
            .map_err(|error| anyhow::anyhow!("execution lease unavailable: {error}"))?;
        let execution = WorkExecution {
            work_id: work_id.to_string(),
            thread_id: self.thread_id.clone(),
            execution_id,
        };
        let terminal_path = self.sibling(work_id, "host-terminal.json");
        anyhow::ensure!(
            read_optional::<HostTerminal>(&terminal_path)?.is_none(),
            "unexpected host terminal receipt"
        );
        publish_once(&self.sibling(work_id, "execution.json"), &execution)?;
        Ok(ExecutionCompletion(Arc::new(ExecutionCompletionInner {
            execution,
            terminal_path,
            _lease: lease,
            changed: Arc::clone(&self.changed),
        })))
    }

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
                execution: None,
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
                && record.state == WorkCompletionState::Running
                && record.execution.is_none(),
            "completion record identity mismatch"
        );
        if let Some(execution) =
            read_optional::<WorkExecution>(&self.sibling(work_id, "execution.json"))?
        {
            anyhow::ensure!(
                execution.work_id == work_id
                    && execution.thread_id == self.thread_id
                    && !execution.execution_id.trim().is_empty()
                    && execution.execution_id.len() <= 512,
                "execution binding identity mismatch"
            );
            let terminal_path = self.sibling(work_id, "host-terminal.json");
            let mut terminal = read_optional::<HostTerminal>(&terminal_path)?;
            if terminal.is_none() {
                let lease = open_lock(&self.sibling(work_id, "execution.lock"), false)?;
                match lease.try_lock() {
                    Ok(()) => {
                        // Completion may have been published between the first read and lease acquisition.
                        terminal = read_optional::<HostTerminal>(&terminal_path)?;
                        if terminal.is_none() {
                            let lost = HostTerminal {
                                execution: execution.clone(),
                                state: WorkCompletionState::Unknown,
                                exit_code: None,
                                summary: OBSERVATION_LOST.to_string(),
                            };
                            publish_terminal(&terminal_path, &lost)?;
                            terminal = Some(lost);
                            self.changed.notify_waiters();
                        }
                    }
                    Err(TryLockError::WouldBlock) => {}
                    Err(TryLockError::Error(error)) => return Err(error.into()),
                }
            }
            if let Some(terminal) = terminal {
                validate_host_terminal(&terminal, &execution)?;
                record.state = terminal.state;
                record.summary = Some(terminal.summary);
                record.exit_code = terminal.exit_code;
            }
            record.execution = Some(execution);
            return Ok(record);
        }
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
            let _mutation = store.mutation_lease(&signal.work_id)?;
            anyhow::ensure!(
                store.read(&signal.work_id)?.execution.is_none(),
                "host-bound work cannot be finished externally"
            );
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
        matches!(
            signal.state,
            WorkCompletionState::Succeeded
                | WorkCompletionState::Failed
                | WorkCompletionState::Cancelled
        ),
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
