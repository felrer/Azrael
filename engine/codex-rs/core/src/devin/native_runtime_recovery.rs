use super::*;

pub(super) enum AttemptOutcome {
    Completed,
    InferenceIdle {
        last_event: &'static str,
        inactivity: Duration,
    },
}

pub(super) async fn start_helper(
    command: &mut Command,
    helper: &Path,
    executable: &Path,
    init: &[u8],
    request: &[u8],
    request_id: &str,
    cancellation: &CancellationToken,
) -> CodexResult<(Child, tokio::process::ChildStdout)> {
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            tracing::warn!(target: "devin_native_progress", event = "native_helper_spawn_failed",
                %request_id, helper = %helper.display(), runtime = %executable.display(),
                io_kind = ?error.kind(), raw_os_error = ?error.raw_os_error(),
                init_bytes = init.len(), request_bytes = request.len());
            return Err(fatal("failed to start native inference helper"));
        }
    };
    tracing::info!(target: "devin_native_progress", event = "native_helper_spawned", %request_id,
        child_pid = child.id().unwrap_or(0), helper = %helper.display(),
        runtime = %executable.display(),
        init_bytes = init.len(), request_bytes = request.len());
    let mut stdin = match child.stdin.take() {
        Some(stdin) => stdin,
        None => {
            let status = terminate(&mut child).await;
            tracing::warn!(target: "devin_native_progress", event = "native_input_failed",
                %request_id, reason = "stdin_unavailable",
                child_exit_code = status.and_then(|status| status.code()).unwrap_or(-1));
            return Err(fatal("native inference helper stdin unavailable"));
        }
    };
    if init.len() + request.len() > MAX_FRAME_BYTES {
        tracing::warn!(target: "devin_native_progress", event = "native_input_failed",
            %request_id, reason = "request_too_large",
            init_bytes = init.len(), request_bytes = request.len());
        return Err(invalid("native inference request exceeded the hard limit"));
    }
    tokio::select! {
        biased;
        _ = cancellation.cancelled() => {
            let status = terminate(&mut child).await;
            tracing::info!(target: "devin_native_progress", event = "native_input_failed",
                %request_id, reason = "cancelled",
                child_exit_code = status.and_then(|status| status.code()).unwrap_or(-1));
            return Err(CodexErr::new(CodexErrorDetails::Interrupted));
        }
        result = tokio::time::timeout(Duration::from_secs(10), async {
            stdin.write_all(&init).await?;
            stdin.write_all(&request).await?;
            stdin.shutdown().await
        }) => {
            match result {
                Ok(Ok(())) => {
                    tracing::info!(target: "devin_native_progress", event = "native_input_delivered",
                        %request_id, init_bytes = init.len(), request_bytes = request.len());
                }
                Ok(Err(error)) => {
                    let status = terminate(&mut child).await;
                    tracing::warn!(target: "devin_native_progress", event = "native_input_failed",
                        %request_id, reason = "request_write_failed",
                        io_kind = ?error.kind(), raw_os_error = ?error.raw_os_error(),
                        child_exit_code = status.and_then(|status| status.code()).unwrap_or(-1));
                    return Err(fatal("failed to send native inference request"));
                }
                Err(_) => {
                    let status = terminate(&mut child).await;
                    tracing::warn!(target: "devin_native_progress", event = "native_input_failed",
                        %request_id, reason = "request_pipe_timeout",
                        child_exit_code = status.and_then(|status| status.code()).unwrap_or(-1));
                    return Err(fatal("native inference request pipe timed out"));
                }
            }
        }
    }
    let stdout = match child.stdout.take() {
        Some(stdout) => stdout,
        None => {
            let status = terminate(&mut child).await;
            tracing::warn!(target: "devin_native_progress", event = "native_input_failed",
                %request_id, reason = "stdout_unavailable",
                child_exit_code = status.and_then(|status| status.code()).unwrap_or(-1));
            return Err(fatal("native inference helper stdout unavailable"));
        }
    };
    Ok((child, stdout))
}

#[tracing::instrument(name = "native_inference_recovery", skip_all, parent = &parent_span,
    fields(request_id = %request_id))]
pub(super) async fn recover(
    mut command: Command,
    helper: std::path::PathBuf,
    executable: std::path::PathBuf,
    init: Vec<u8>,
    request: Vec<u8>,
    prompt: Prompt,
    request_id: String,
    cancellation: CancellationToken,
    dropped: CancellationToken,
    tx: &mpsc::Sender<CodexResult<ResponseEvent>>,
    parent_span: tracing::Span,
    policy: TimingPolicy,
    started: tokio::time::Instant,
    child: Child,
    stdout: tokio::process::ChildStdout,
    historical_call_ids: HashSet<String>,
) {
    let mut attempt = 1;

    let mut process = (child, stdout);
    let result = loop {
        let result = consume(
            process.0,
            process.1,
            ConsumeContext {
                policy,
                started,
                request_id: &request_id,
                tools: ToolCatalog::from_specs(&prompt.tools).expect("validated tool catalog"),
                call_ids: historical_call_ids.clone(),
                tx,
                cancellation: &cancellation,
                dropped: &dropped,
                parent_span: parent_span.clone(),
            },
        )
        .await;
        let outcome = match result {
            Ok(AttemptOutcome::Completed) => "completed",
            Ok(AttemptOutcome::InferenceIdle { .. }) if attempt == 1 => "retry_scheduled",
            Ok(AttemptOutcome::InferenceIdle { .. }) => "retry_exhausted",
            Err(_) => "failed",
        };
        tracing::info!(target: "devin_native_progress", event = "native_inference_attempt_finished", %request_id, attempt, outcome);
        match result {
            Ok(AttemptOutcome::InferenceIdle {
                last_event,
                inactivity,
            }) if attempt == 2 => {
                break Err(fatal(format!(
                    "native inference idle: last_event={last_event}, inactivity_ms={}, retry=exhausted (2 attempts)",
                    inactivity.as_millis()
                )));
            }
            Ok(AttemptOutcome::InferenceIdle { .. }) => {
                let retry = tokio::select! {
                    biased;
                    _ = cancellation.cancelled() => false,
                    _ = dropped.cancelled() => false,
                    _ = tokio::time::sleep_until(started + policy.deadline) => { break Err(fatal("native inference request exceeded its deadline")); },
                    _ = tokio::time::sleep(policy.backoff) => true,
                };
                if !retry {
                    break Err(CodexErr::new(CodexErrorDetails::Interrupted));
                }
                attempt += 1;

                let restart = tokio::select! {
                    biased;
                    _ = cancellation.cancelled() => Err(CodexErr::new(CodexErrorDetails::Interrupted)),
                    _ = dropped.cancelled() => Err(CodexErr::new(CodexErrorDetails::Interrupted)),
                    _ = tokio::time::sleep_until(started + policy.deadline) => Err(fatal("native inference request exceeded its deadline")),
                    result = recovery::start_helper(&mut command, &helper, &executable, &init, &request, &request_id, &cancellation) => result,
                };
                match restart {
                    Ok(child) => process = child,
                    Err(error) => break Err(error),
                }
            }
            Ok(AttemptOutcome::Completed) => break Ok(()),
            Err(error) => break Err(error),
        }
    };
    tracing::info!(target: "devin_native_progress", event = "native_inference_recovery_finished", %request_id, attempt, retry_used = attempt > 1, outcome = if result.is_ok() { "completed" } else { "failed" });
    if let Err(error) = result {
        // Preserve an immediately deliverable terminal error even after cancellation.
        // A full queue must never retain the turn guard beyond its logical budget.
        if let Err(mpsc::error::TrySendError::Full(event)) = tx.try_send(Err(error)) {
            tokio::select! {
                biased;
                _ = cancellation.cancelled() => {},
                _ = dropped.cancelled() => {},
                _ = tokio::time::sleep_until(started + policy.deadline) => {},
                _ = tx.send(event) => {},
            }
        }
    }
}
