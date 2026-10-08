//! Private helper protocol used by the app-server's cancellation-owned monitor.
use crate::ThreadManager;
use crate::managed_account_recovery::helper_paths;
use crate::managed_account_recovery::helper_rpc;
use codex_protocol::error::CodexErr;
use codex_protocol::error::CodexErrorDetails;
use codex_protocol::error::Result;
use serde::Deserialize;
use serde::Serialize;
use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;
use tokio_util::sync::CancellationToken;

static NEXT_BATCH: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

/// Owns bounded replacement tasks so slow authentication cannot delay detection.
pub struct RetirementWorkers {
    tasks: std::collections::HashMap<String, tokio_util::task::AbortOnDropHandle<()>>,
    retry_after: std::collections::HashMap<String, tokio::time::Instant>,
    slots: Arc<tokio::sync::Semaphore>,
}

impl Default for RetirementWorkers {
    fn default() -> Self {
        Self {
            tasks: Default::default(),
            retry_after: Default::default(),
            slots: Arc::new(tokio::sync::Semaphore::new(8)),
        }
    }
}

pub fn is_managed_execution_model(model: &str) -> bool {
    crate::managed_catalog::selection(model).is_ok() || crate::devin::catalog::is_devin(model)
}

pub(crate) fn provider_for_model(model: &str) -> String {
    if let Ok((provider, _)) = crate::managed_catalog::selection(model) {
        provider.to_string()
    } else if crate::devin::catalog::is_devin(model) {
        "devin".to_string()
    } else {
        "openai".to_string()
    }
}

impl crate::session::session::Session {
    pub(crate) fn execution_admission_for_model(
        &self,
        model: &str,
    ) -> Arc<codex_login::AzraelAuthAdmission> {
        if is_managed_execution_model(model) {
            self.managed_auth_admissions
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .entry(provider_for_model(model))
                .or_insert_with(|| Arc::new(codex_login::AzraelAuthAdmission::default()))
                .clone()
        } else {
            self.services.auth_manager.azrael_admission()
        }
    }

    pub(crate) async fn execution_admission(&self) -> Arc<codex_login::AzraelAuthAdmission> {
        self.execution_admission_for_model(&self.current_execution_model().await)
    }

    pub(crate) fn account_is_retired_for_model(&self, model: &str) -> bool {
        self.account_retired
            .load(std::sync::atomic::Ordering::Acquire)
            && self
                .retired_provider
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .as_ref()
                .is_none_or(|provider| *provider == provider_for_model(model))
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ThreadBinding {
    thread_id: String,
    provider_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    account_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    turn_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BindingStatus {
    thread_id: String,
    provider_id: String,
    account_id: Option<String>,
    status: Status,
}

#[derive(Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
enum Status {
    Available,
    Removed,
    Reauth,
    Unbound,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct StatusValue {
    bindings: Vec<BindingStatus>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Destination {
    retired_account_id: String,
    account_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum Response {
    Result {
        id: String,
        value: serde_json::Value,
    },
    Error {
        id: String,
        error: serde_json::Value,
    },
}

fn decode<T: serde::de::DeserializeOwned>(bytes: &[u8], expected_id: &str) -> Result<T> {
    let frames: Vec<_> = bytes
        .split(|byte| *byte == b'\n')
        .filter(|line| !line.iter().all(u8::is_ascii_whitespace))
        .collect();
    if frames.len() != 1 {
        return Err(invalid("invalid account retirement frame count"));
    }
    match serde_json::from_slice::<Response>(frames[0]) {
        Ok(Response::Result { id, value }) if id == expected_id => serde_json::from_value(value)
            .map_err(|_| invalid("invalid account retirement response")),
        Ok(Response::Error { id, error }) if id == expected_id => {
            let _ = error;
            Err(invalid("account retirement status is unavailable"))
        }
        _ => Err(invalid("mismatched account retirement response")),
    }
}

/// A single bounded helper batch covers loaded managed threads, including idle/tool work.
pub async fn poll_threads(
    manager: &Arc<ThreadManager>,
    cancellation: &CancellationToken,
    workers: &mut RetirementWorkers,
) -> Result<()> {
    workers.tasks.retain(|_, task| !task.is_finished());
    let active = &workers.tasks;
    workers.retry_after.retain(|thread, until| {
        *until > tokio::time::Instant::now() || active.contains_key(thread)
    });
    let Some((helper, bun)) = helper_paths()? else {
        return Ok(());
    };
    let mut requests = Vec::new();
    let mut loaded = Vec::new();
    let mut ids = manager.list_thread_ids().await;
    ids.sort_by_key(ToString::to_string);
    for id in ids {
        let Ok(thread) = manager.get_thread(id).await else {
            continue;
        };
        let snapshot = thread.account_execution_context().await;
        let config = thread.config().await;
        let (provider, account) = if crate::managed_catalog::is_managed(&snapshot.model) {
            let (provider, _) = crate::managed_catalog::selection(&snapshot.model)
                .map_err(|_| invalid("invalid retirement provider selection"))?;
            (provider.to_string(), None)
        } else if crate::devin::catalog::is_devin(&snapshot.model) {
            let account = match snapshot.devin_account_id.clone() {
                Some(account) => Some(account),
                None => crate::devin::native_runtime::retirement_binding(
                    &config.codex_home,
                    &id.to_string(),
                )?,
            };
            let Some(account) = account else {
                continue;
            };
            ("devin".to_string(), Some(account))
        } else {
            continue;
        };
        requests.push(ThreadBinding {
            thread_id: id.to_string(),
            provider_id: provider,
            account_id: account,
            turn_id: if snapshot.model.starts_with("managed/") {
                snapshot.turn_id
            } else {
                None
            },
        });
        loaded.push((thread, config, snapshot.model));
    }
    if requests.is_empty() {
        return Ok(());
    }
    // Rotate oversized populations so one tick still starts only one bounded helper.
    if requests.len() > 256 {
        let start =
            NEXT_BATCH.fetch_add(256, std::sync::atomic::Ordering::Relaxed) % requests.len();
        requests.rotate_left(start);
        loaded.rotate_left(start);
        requests.truncate(256);
        loaded.truncate(256);
    }
    let home = &loaded[0].1.codex_home;
    let id = uuid::Uuid::new_v4().to_string();
    let request = serde_json::to_vec(&serde_json::json!({
        "protocol": 1, "id": id, "action": "retirementStatus", "threads": requests,
    }))
    .map_err(|_| invalid("unable to encode retirement status"))?;
    let bytes = helper_rpc(
        home,
        &helper,
        &bun,
        request,
        Duration::from_secs(5),
        cancellation,
    )
    .await?;
    let statuses: StatusValue = decode(&bytes, &id)?;
    if statuses.bindings.len() != requests.len() {
        return Err(invalid("incomplete retirement status batch"));
    }
    let mut seen = HashSet::new();
    for status in &statuses.bindings {
        let Some(index) = requests.iter().position(|request| {
            request.thread_id == status.thread_id && request.provider_id == status.provider_id
        }) else {
            return Err(invalid("unknown retirement status binding"));
        };
        if !seen.insert(index)
            || (requests[index].account_id.is_some()
                && requests[index].account_id != status.account_id)
        {
            return Err(invalid("mismatched retirement status binding"));
        }
        if matches!(status.status, Status::Removed | Status::Reauth)
            && status
                .account_id
                .as_ref()
                .is_none_or(|account| account.is_empty())
        {
            return Err(invalid("retirement status omitted account identity"));
        }
    }
    // Validate the whole batch before performing any mutation.
    let mut interrupted = Vec::new();
    for status in &statuses.bindings {
        if !matches!(status.status, Status::Removed | Status::Reauth) {
            continue;
        }
        let index = requests
            .iter()
            .position(|request| request.thread_id == status.thread_id)
            .unwrap();
        let (thread, _, model) = &loaded[index];
        if thread.record_retired_source(
            &status.provider_id,
            status.account_id.as_deref().unwrap(),
            requests[index].turn_id.as_deref(),
        ) {
            thread.close_account_retirement_admission(model);
            interrupted.push(thread.clone());
        }
    }
    futures::future::join_all(
        interrupted
            .iter()
            .map(|thread| thread.interrupt_retired_work()),
    )
    .await;
    for status in statuses.bindings {
        let index = requests
            .iter()
            .position(|request| request.thread_id == status.thread_id)
            .unwrap();
        let (thread, config, model) = &loaded[index];
        if status.status == Status::Available {
            workers.retry_after.remove(&status.thread_id);
            thread.account_binding_available(model).await;
            continue;
        }
        if status.status == Status::Unbound {
            continue;
        }
        let Some(source) = status.account_id else {
            continue;
        };
        if workers.tasks.contains_key(&status.thread_id)
            || workers.tasks.len() >= 256
            || workers
                .retry_after
                .get(&status.thread_id)
                .is_some_and(|time| *time > tokio::time::Instant::now())
        {
            continue;
        }
        let worker_key = status.thread_id.clone();
        workers.retry_after.insert(
            worker_key.clone(),
            tokio::time::Instant::now() + Duration::from_secs(3),
        );
        let thread = thread.clone();
        let config = config.clone();
        let model = model.clone();
        let turn_id = requests[index].turn_id.clone();
        let helper = helper.clone();
        let bun = bun.clone();
        let cancellation = cancellation.clone();
        let slots = workers.slots.clone();
        let task = tokio::spawn(async move {
            let result: Result<()> = async {
                let _slot = tokio::select! {
                    _ = cancellation.cancelled() => return Ok(()),
                    permit = slots.acquire_owned() => permit.map_err(|_| invalid("retirement worker closed"))?,
                };
        let id = uuid::Uuid::new_v4().to_string();
        let reason = if status.status == Status::Removed {
            "removed"
        } else {
            "revoked"
        };
        let mut frame = serde_json::json!({
            "protocol": 1, "id": id, "action": "retireAccount", "threadId": status.thread_id,
            "providerId": status.provider_id, "expectedAccountId": source, "reason": reason,
        });
        if let Some(turn) = turn_id.as_ref() {
            frame["turnId"] = serde_json::Value::String(turn.clone());
        }
        let bytes = serde_json::to_vec(&frame)
            .map_err(|_| invalid("unable to encode account retirement"))?;
        let response = helper_rpc(
            &config.codex_home,
            &helper,
            &bun,
            bytes,
            Duration::from_secs(20),
            &cancellation,
        )
        .await?;
        let destination: Destination = decode(&response, &id)?;
        if destination.retired_account_id != source
            || destination
                .account_id
                .as_ref()
                .is_some_and(|account| account.is_empty() || *account == source)
        {
            return Err(invalid("invalid account retirement destination"));
        }
        if let Some(destination) = destination.account_id {
            if status.provider_id == "devin" {
                crate::devin::native_runtime::retire_binding(
                    &config.codex_home,
                    &status.thread_id,
                    &source,
                    &destination,
                    &cancellation,
                )
                .await?;
            }
                        if thread.complete_retired_source(&status.provider_id, &source, turn_id.as_deref()) {
                            thread.account_binding_available(&model).await;
                        }
        }
                Ok(())
            }.await;
            if result.is_err() {
                tracing::debug!("managed account retirement replacement could not be validated");
            }
        });
        workers
            .tasks
            .insert(worker_key, tokio_util::task::AbortOnDropHandle::new(task));
    }
    Ok(())
}

fn invalid(message: &str) -> CodexErr {
    CodexErr::new(CodexErrorDetails::InvalidRequest(message.to_string()))
}

pub(crate) async fn devin_source_is_retired(
    home: &std::path::Path,
    thread: &str,
    account: &str,
    cancellation: &CancellationToken,
) -> Result<bool> {
    let (helper, bun) =
        helper_paths()?.ok_or_else(|| invalid("account retirement helper is unavailable"))?;
    let id = uuid::Uuid::new_v4().to_string();
    let request = serde_json::to_vec(&serde_json::json!({
        "protocol": 1, "id": id, "action": "retirementStatus",
        "threads": [{"threadId": thread, "providerId": "devin", "accountId": account}],
    }))
    .map_err(|_| invalid("unable to encode future binding status"))?;
    let bytes = helper_rpc(
        home,
        &helper,
        &bun,
        request,
        Duration::from_secs(5),
        cancellation,
    )
    .await?;
    let value: StatusValue = decode(&bytes, &id)?;
    if value.bindings.len() != 1 {
        return Err(invalid("invalid future binding status"));
    }
    let binding = &value.bindings[0];
    if binding.thread_id != thread
        || binding.provider_id != "devin"
        || binding.account_id.as_deref() != Some(account)
    {
        return Err(invalid("mismatched future binding status"));
    }
    match binding.status {
        Status::Removed | Status::Reauth => Ok(true),
        Status::Available => Ok(false),
        Status::Unbound => Err(invalid("future binding status is unavailable")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct HeldManagedTask {
        started: Arc<tokio::sync::Notify>,
    }

    impl crate::tasks::SessionTask for HeldManagedTask {
        fn kind(&self) -> crate::state::TaskKind {
            crate::state::TaskKind::Regular
        }
        fn span_name(&self) -> &'static str {
            "retirement.held_managed_task"
        }
        async fn run(
            self: Arc<Self>,
            _session: Arc<crate::session::session::Session>,
            _context: Arc<crate::session::turn_context::TurnContext>,
            _input: Vec<crate::session::TurnInput>,
            cancellation: CancellationToken,
        ) -> crate::tasks::SessionTaskResult {
            self.started.notify_one();
            cancellation.cancelled().await;
            Ok(None)
        }
    }

    #[tokio::test]
    async fn active_managed_task_and_new_managed_task_survive_native_no_replacement() {
        let (session, mut context) = crate::session::tests::make_session_and_context().await;
        Arc::make_mut(&mut Arc::make_mut(&mut context.initial_settings).model_info).slug =
            "managed/anthropic/test-model".to_string();
        let session = Arc::new(session);
        let context = Arc::new(context);
        let started = Arc::new(tokio::sync::Notify::new());
        session
            .start_task(
                context.clone(),
                Vec::new(),
                HeldManagedTask {
                    started: started.clone(),
                },
            )
            .await;
        tokio::time::timeout(Duration::from_secs(2), started.notified())
            .await
            .unwrap();
        let native = session.services.auth_manager.azrael_admission();
        let managed = session.execution_admission_for_model(&context.model_info().slug);
        assert!(managed.has_active_work());
        let retirement = native.begin_retirement();
        let guard = retirement
            .try_commit()
            .expect("native retirement never waits for active managed task");
        assert!(
            session
                .active_turn
                .lock()
                .await
                .as_ref()
                .unwrap()
                .task
                .is_some()
        );
        drop(guard);
        drop(retirement);
        assert!(native.requires_recovery());
        session.interrupt_task().await;
        assert!(!managed.has_active_work());
        session
            .start_task(
                context.clone(),
                Vec::new(),
                HeldManagedTask {
                    started: started.clone(),
                },
            )
            .await;
        tokio::time::timeout(Duration::from_secs(2), started.notified())
            .await
            .unwrap();
        assert!(
            managed.has_active_work(),
            "native no-replacement cannot block new managed task"
        );
        assert!(!native.has_active_work());
        session.interrupt_task().await;
    }

    #[tokio::test]
    async fn managed_execution_lease_never_delays_native_retirement_or_uses_failed_native_gate() {
        let (session, _) = crate::session::tests::make_session_and_context().await;
        let native = session.execution_admission_for_model("gpt-5.4");
        let managed = session.execution_admission_for_model("managed/anthropic/test-model");
        let unrelated = managed.enter_task().await;
        let retirement = native.begin_retirement();
        let guard = retirement
            .try_commit()
            .expect("unrelated active managed work cannot hold native switch");
        assert!(native.admit_request().await.is_err());
        assert!(managed.admit_request().await.is_ok());
        assert!(!Arc::ptr_eq(&native, &managed));
        assert!(Arc::ptr_eq(
            &managed,
            &session.execution_admission_for_model("managed/anthropic/another-model")
        ));
        assert!(!Arc::ptr_eq(
            &managed,
            &session.execution_admission_for_model("managed/google/test-model")
        ));
        assert!(
            session
                .execution_admission_for_model("gpt-5.4")
                .admit_request()
                .await
                .is_err()
        );
        assert!(
            session
                .execution_admission_for_model("devin/default")
                .admit_request()
                .await
                .is_ok()
        );
        drop(guard);
        drop(retirement);
        assert!(
            native.admit_request().await.is_err(),
            "no replacement remains blocked"
        );
        assert!(managed.admit_request().await.is_ok());
        unrelated.finish();
    }

    #[tokio::test]
    async fn retirement_gate_tracks_provider_changes_and_keeps_original_provider_stopped() {
        let (session, _) = crate::session::tests::make_session_and_context().await;
        session
            .account_retired
            .store(true, std::sync::atomic::Ordering::Release);
        *session.retired_provider.lock().unwrap() = Some("anthropic".to_string());
        let retired = session.execution_admission_for_model("managed/anthropic/test-model");
        retired.block_new_work();
        assert!(session.account_is_retired_for_model("managed/anthropic/another-model"));
        assert!(!session.account_is_retired_for_model("managed/google/test-model"));
        assert!(
            session
                .execution_admission_for_model("managed/google/test-model")
                .admit_request()
                .await
                .is_ok()
        );
        assert!(retired.admit_queued_request().is_err());
        session
            .services
            .auth_manager
            .azrael_admission()
            .block_new_work();
        assert!(
            session
                .execution_admission_for_model("gpt-5.4")
                .requires_recovery()
        );
    }

    #[test]
    fn retirement_protocol_rejects_missing_duplicate_or_mismatched_frames() {
        assert!(decode::<StatusValue>(b"", "id").is_err());
        assert!(
            decode::<StatusValue>(
                br#"{"type":"result","id":"other","value":{"bindings":[]}}"#,
                "id"
            )
            .is_err()
        );
        assert!(decode::<StatusValue>(b"{}\n{}\n", "id").is_err());
        assert!(decode::<StatusValue>(br#"{"type":"result","id":"id","value":{"bindings":[{"threadId":"t","providerId":"anthropic","accountId":"a","status":"reauth"}]}}"#, "id").is_ok());
    }
}
