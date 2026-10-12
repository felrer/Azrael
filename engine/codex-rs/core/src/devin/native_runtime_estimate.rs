//! One-shot, bounded estimate transport. Never retries as an inference request.
use super::*;

#[derive(Debug, Clone, serde::Deserialize)]
pub(crate) struct InputBudget {
    pub(crate) supported: bool,
    pub(crate) input_tokens: i64,
    pub(crate) scope_sha256: String,
    pub(crate) diagnostics: serde::de::IgnoredAny,
}

fn validate_budget(value: serde_json::Value) -> CodexResult<InputBudget> {
    let budget: InputBudget =
        serde_json::from_value(value).map_err(|_| fatal("native input budget is malformed"))?;
    if !(0..=9_007_199_254_740_991).contains(&budget.input_tokens)
        || budget.scope_sha256.len() != 64
        || !budget
            .scope_sha256
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err(fatal("native input budget is invalid"));
    }
    Ok(budget)
}

pub(crate) async fn run_estimate_helper<G>(
    request: HelperRequest<'_, G>,
) -> CodexResult<Option<InputBudget>> {
    ToolCatalog::from_specs(&request.prompt.tools)?;
    let HelperRequest {
        executable,
        helper,
        codex_home,
        init,
        request,
        request_limit,
        request_id,
        cancellation,
        turn_guard: _turn_guard,
        ..
    } = request;
    let mut command = Command::new(executable);
    command
        .arg(helper)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .env("CODEX_HOME", codex_home)
        .env(
            "OPENCODEX_HOME",
            codex_home.join("azrael/providers/opencodex"),
        );
    for name in HELPER_SCRUBBED_ENV {
        command.env_remove(name);
    }
    #[cfg(windows)]
    command.creation_flags(0x0800_0000);
    // Includes spawn, input delivery, all output and process exit.
    let operation = async {
        let (mut child, stdout) = recovery::start_helper(
            &mut command,
            helper,
            executable,
            &init,
            &request,
            request_limit,
            &request_id,
            &cancellation,
        )
        .await?;
        let result = async {
            let mut reader = BufReader::new(stdout);
            let mut total = 0usize;
            let mut seq = 0u64;
            let mut terminal = None;
            loop {
                let mut bytes = Vec::new();
                let read = (&mut reader)
                    .take((MAX_FRAME_BYTES + 2) as u64)
                    .read_until(b'\n', &mut bytes)
                    .await
                    .map_err(|_| fatal("failed reading native estimate output"))?;
                if read == 0 {
                    break;
                }
                total = total.saturating_add(read);
                if read > MAX_FRAME_BYTES + 1 || total > MAX_OUTPUT_BYTES || !bytes.ends_with(b"\n")
                {
                    return Err(fatal("native estimate output exceeded the hard limit"));
                }
                let frame: serde_json::Value = serde_json::from_slice(&bytes)
                    .map_err(|_| fatal("native estimate returned malformed JSONL"))?;
                if terminal.is_some()
                    || frame["protocol_version"].as_u64() != Some(1)
                    || frame["request_id"].as_str() != Some(request_id.as_str())
                    || frame["seq"].as_u64() != Some(seq)
                {
                    return Err(fatal(
                        "native estimate returned an invalid protocol envelope",
                    ));
                }
                seq = seq
                    .checked_add(1)
                    .ok_or_else(|| fatal("native estimate sequence overflow"))?;
                match frame["type"].as_str() {
                    Some("progress") => {}
                    Some("input_budget") => {
                        terminal = Some(Some(validate_budget(frame["input_budget"].clone())?))
                    }
                    Some("error") => {
                        let code = frame["code"].as_str();
                        if matches!(code, Some("invalid_request" | "unsupported_input_budget")) {
                            terminal = Some(None);
                        } else {
                            return Err(errors::helper_error(code));
                        }
                    }
                    _ => return Err(fatal("native estimate returned an invalid event sequence")),
                }
            }
            let budget =
                terminal.ok_or_else(|| fatal("native estimate ended without a terminal frame"))?;
            let status = child
                .wait()
                .await
                .map_err(|_| fatal("native estimate status unavailable"))?;
            if !status.success() && budget.is_some() {
                return Err(fatal("native estimate exited unsuccessfully"));
            }
            Ok(budget.filter(|budget| budget.supported))
        }
        .await;
        if result.is_err() {
            terminate(&mut child).await;
        }
        result
    };
    tokio::select! {
        biased;
        _ = cancellation.cancelled() => Err(CodexErr::new(CodexErrorDetails::Interrupted)),
        result = tokio::time::timeout(Duration::from_secs(30), operation) =>
            result.map_err(|_| fatal("native estimate exceeded its deadline"))?,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_safe_unclamped_counts_and_scope() {
        let value = serde_json::json!({"supported":true,"input_tokens":2_000_000,
            "scope_sha256":"a".repeat(64),"diagnostics":{"tools":12}});
        assert_eq!(
            validate_budget(value.clone()).unwrap().input_tokens,
            2_000_000
        );
        for count in [
            serde_json::json!(-1),
            serde_json::json!(1.5),
            serde_json::json!(9_007_199_254_740_992u64),
        ] {
            let mut bad = value.clone();
            bad["input_tokens"] = count;
            assert!(validate_budget(bad).is_err());
        }
        let mut bad = value;
        bad["scope_sha256"] = serde_json::json!("A".repeat(64));
        assert!(validate_budget(bad).is_err());
    }
}
