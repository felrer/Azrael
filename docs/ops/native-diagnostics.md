# Native Azrael diagnostics

The VS Code chat panel reports turn failures with separate messages for authentication, usage and rate limits, connection or stream loss, unsupported requests, and local tool errors. After installing a new VSIX, open a new VS Code window or run **Developer: Reload Window** in the window to test; the already-running extension host retains the prior code until then.

Managed connection diagnostics and guidance have source-test coverage; a matching engine/helper/host release is required for installed use. Accepted transport codes distinguish DNS, TLS, reset, refusal, connection timeout, unreachable network and proxy failures. `provider_headers_failed` means a `TypeError` occurred before response headers were obtained, with no recognized cause; it does not prove the request never reached the server. The guidance asks the user to review existing work and continue in the same session. These error classifications do not add automatic retries.

The native app-server writes tracing records to `~/.azrael-ex/logs_2.sqlite`. Records are retained for 10 days and capped at 10 MiB or 1,000 rows per thread or threadless process partition. Writes are buffered and normally flush within 10 seconds; a sudden process exit can lose the final queued records. This database may contain sensitive request context, so do not attach or paste it to an issue or chat.

The OpenAI account/usage page reports a bounded failure class for each profile refresh: HTTP status, application network-policy denial, connection or proxy failure, timeout, invalid JSON, missing rate-limit snapshots, or credential refresh failure. The UI omits response bodies, URLs, tokens and raw transport errors. A policy-unavailable message means the engine blocked the request before contacting OpenAI; reauthentication does not resolve that condition. A running window must be reloaded after installing a corrected host before its account page uses the new engine.

From the project root, inspect recent error metadata without exposing raw log bodies:

```powershell
python -B scripts/inspect-native-azrael-errors.py --minutes 60 --events 30
```

The command opens SQLite read-only and returns timestamps, severity, module, a hashed thread reference, and broad error categories. Provider rejection events also export a validated `providerError` object containing the original allowlisted code, source (`http_response`/`connect_trailer`), bounded hexadecimal trace ID and recognized reason label when recorded. A mapped status from a Connect trailer is distinct from the original HTTP response status. Unknown message text is withheld and reported as `unrecognized_message`; no raw log body is exported. Field meanings and limits are owned by [Devin native diagnostics](devin-native.md#diagnostics). `truncated: true` means the interval exceeded its 5,000-row scan limit; narrow `--minutes` or raise `--limit` to at most 20,000. Wait at least 10 seconds after a failed turn before inspecting. Record the approximate local time, selected provider/model, and the visible Azrael error to correlate with the report.

Managed provider inference records `devin_native_progress` events in the same SQLite log. For a request ID, `native_inference_progress` shows the current phase, cumulative `bytes_received` and `event_count`, `last_event`, `network_idle_ms` since the last provider bytes, and `event_idle_ms` since the last decoded event. These fields contain counts and fixed labels, not provider text or tool arguments. `native_inference_finished` adds the last helper frame type and elapsed time. Diagnostic progress frames do not reset the engine's 100-second generation inactivity limit. Managed Anthropic uses separate `thinking_wait` liveness telemetry while a thinking block is open: fresh heartbeat evidence permits opaque-thinking waiting without claiming generation, while silence remains bounded by 100 seconds and the independent engine request deadline by 915 seconds. `native_inference_thinking_wait` records the declared open state, heartbeat count/age and generation idle/count; `native_inference_wait_extended` records when the engine accepts that evidence with reason `anthropic_thinking_heartbeat`. These content-free events use the same SQLite sink and retention policy. `inference_output_idle` logs the last progress snapshot before ending that request. Installed use requires a matching engine and helper; source-only verification does not change running windows. Compare the counters across successive progress records to distinguish an active provider stream from a silent one. A zero event count with incoming bytes can also mean incomplete or unrecognized stream data; it does not prove the connection is healthy.

The inspector's `transportDiagnostics` exports allowlisted `connection_error` categories and `connection_error_code` values alongside `error_stage`, `error_name` and `abort_source`. For example, `dns` with `ENOTFOUND` is explicit name-resolution evidence. Absent connection fields mean no accepted cause was recorded; a bare `type_error` does not identify DNS, TLS or a proxy failure. Unknown codes and exception text are withheld.

Managed HTTP failures additionally record closed `provider_error_type`, `provider_error_reason`, and `error_body_state` labels, validated numeric `retry_after_ms`, rate-limit limit/remaining/reset fields, and Anthropic 5-hour/7-day status/reset fields when supplied. Body text, arbitrary headers and unknown provider labels are withheld. See [error classification](../architecture/managed-providers.md#evidence-based-error-classification) for ownership and acceptance status. HTTP 429, `Retry-After`, or Anthropic `rate_limit_error` alone cannot distinguish a request/token limit from a usage/spend limit. A known subtype needs explicit evidence; otherwise the conversation displays exactly `정의되지 않은 오류`. Missing historical fields cannot be reconstructed from this change.

When reproducing, record the exact source/package identity, account equality without account identifiers, model, prompt/context scope, number of network attempts, HTTP status and safe termination metadata. Separate a successful diagnostic run from a successful model response. HTTP 200 followed by `stop_reason: refusal` establishes provider termination, not a rate-limit cause; it does not reproduce an earlier HTTP 429. Source/helper probes do not verify the installed engine or host.

The **Azrael provider accounts** VS Code Output channel records account action start/completion/failure and elapsed time without credential values or failure details. The **Azrael Recovery** Output channel records host version and bounded RPC diagnostics. `host.rpc_error`, `host.rpc_send_failed`, and `host.transport_disconnected` include a hashed request/thread reference, method, elapsed time, numeric RPC code when available, and one broad category (`auth`, `usage_rate_limit`, `timeout`, `connection`, `tool`, `protocol`, or `unknown`). `host.notification_error` records method, code, and category without the notification body. Use the timestamp and request reference to correlate these records with the visible chat error and native SQLite metadata. The host keeps at most 128 pending request references for five minutes and clears them on disconnect; an unanswered request is reported as an unknown outcome, not a proven failed tool action.

VS Code's **Log (Extension Host)** can show extension activation faults. The host still discards app-server stderr content because upstream messages may include secrets; only a capped byte count survives a disconnect. A missing row in `logs_2.sqlite` or the Output channel does not prove that no error occurred. These records improve host/provider error attribution but do not yet satisfy the full AZ-01 injected-failure and safe-resume matrix.

## 상세 진단 켜기/끄기

기본값은 기존 상세 로그를 모두 켜는 것이다. 전체 설정 `AZRAEL_DIAGNOSTICS`와 분야별 덮어쓰기의 의미·보존 범위는 [상세 진단 계약](../architecture/diagnostic-logging.md)에 둔다. 설정은 이를 지원하는 엔진/helper/host 소스가 포함된 배포본에서 적용되며 기존에 설치된 바이너리는 바뀌지 않는다.

VS Code를 시작하는 PowerShell에서 전체 상세 진단을 끄려면:

```powershell
$env:AZRAEL_DIAGNOSTICS = 'off'
```

이 환경을 상속하는 새 VS Code 프로세스로 Azrael을 시작한다. 이미 실행 중인 VS Code에 새 창을 열면 기존 프로세스의 환경을 재사용할 수 있다. 진행 중인 작업을 끝낸 뒤 관련 프로세스를 종료하고 같은 셸에서 새로 시작한다. 환경변수 변경만으로 실행 중인 엔진이나 helper의 환경이 바뀌지는 않는다.

도구 진단만 켜서 조사하려면 전체 설정을 `off`로 둔 채 다음 값을 설정한다:

```powershell
$env:AZRAEL_DIAGNOSTICS_TOOLS = 'on'
```

분야별 변수는 `AZRAEL_DIAGNOSTICS_INFERENCE`, `AZRAEL_DIAGNOSTICS_TOOLS`, `AZRAEL_DIAGNOSTICS_RECOVERY`, `AZRAEL_DIAGNOSTICS_UI_INPUT`, `AZRAEL_DIAGNOSTICS_ACCOUNTS`다. 변수 이름과 값은 다른 OS에서도 같고, POSIX 셸에서는 `export AZRAEL_DIAGNOSTICS=off`처럼 전달한다.

모두 다시 켜려면 전체 설정을 `on`으로 바꾸고 분야별 `off` 덮어쓰기를 해제하거나 `on`으로 바꾼 뒤 재시작한다. 기본값으로 원복하려면 이 여섯 환경변수를 제거한다. 전체 값만 `on`으로 바꿔도 명시적인 분야별 `off`는 유지된다. 이 절차는 기록량과 선택적 계측을 제어하며 기존 로그 파일 삭제·보존 정책을 바꾸지 않는다.

## Root resume timing

Status: `partial` — Windows source tests verify resume phases, native HTTP request correlation, the SQLite sink and safe export. A matching engine and window reload are required for installed sessions; live-server and WebSocket runtime acceptance remain separate.

The native OpenAI root emits `root_resume_timing` events under target `azrael_root_resume` to the existing `logs_2.sqlite` sink. INFO events use the existing level, buffering, retention and size limits above. The same read-only inspector command exports them as category `root_resume_timing` with `rootResumeTiming`. No additional logging level or storage configuration is required.

| Phase | Observed boundary |
| --- | --- |
| `wake_detected` | Dispatcher observes a matching reservation after deadline/dependency/manual wake. |
| `resume_dispatch` | Overall dispatcher entry/return. |
| `execution_admission` | Account execution admission call, including its wait. |
| `submission_gate` | Acquisition of the root submission gate. |
| `history_flush` | Flush of retained rollout before claim. |
| `reservation_claim` | Durable claim transition and its event publication. |
| `turn_context` | Saved-context lookup and resumed turn-context preparation. |
| `turn_start` | Construction and publication of the actual `TurnStarted` event. |
| `model_request` | First resumed sampling-client call path, including request-effort resolution, ending when a stream/error is returned. |
| `model_request_submit` | First non-warmup HTTP/WebSocket transport-method invocation after core request preparation. |

All records carry `thread_id`, `phase`, `outcome`, `wake_reason`, `reservation_id`, `resume_turn_id`, `duration_ms` and `elapsed_ms`. Explicit thread identity keeps timer/dispatcher events in the root's existing per-thread retention partition even without an inherited tracing span. Outcomes are `started`, `completed`, `failed` and `cancelled`; a dropped in-flight phase records cancellation rather than success. `wake_detected` is a completed milestone, and `model_request_submit` is a started milestone; their `duration_ms` is zero. For completed/failed/cancelled phases, duration measures that phase. Cumulative elapsed time starts at observed wake and uses a monotonic clock. Subtract successive boundary elapsed values to identify gaps outside individual phases; stages can overlap with asynchronous task execution. Overall dispatch completion indicates its return, not model generation completion.

Safe export requires recognized labels, strict UUID correlation and unsigned 64-bit timing fields. `reservationRef` and `turnRef` are the first ten SHA-256 characters of those UUIDs; raw IDs and log bodies are excluded. The exporter retains existing time-range and event limits, so increase `--events` within its supported bound or narrow the time range when correlating a complete attempt. Missing stages are unobserved, not zero-duration successes. The first sampling attempt can fail before any transport invocation; a later retry still receives the single first-transport milestone. The first transport marker excludes warmup and is emitted once across retries/follow-ups; it does not establish server receipt, time to first token or network health. Existing rows without these events cannot recover unrecorded phase timings.

Source checks use `python -B -m unittest discover -s scripts/tests -p test_inspect_native_azrael_errors.py -v` and, from frozen `codex-rs/`, `cargo test -p codex-core --lib root_resume_timing --locked --offline -- --test-threads=1`. On Windows use `RUST_MIN_STACK=33554432` for session fixtures and the selected shared engine cache. Coverage includes emitted correlation/outcome fields and a mocked native request after manual resume; installed/live-server acceptance is separate.

## Parent request and response wait evidence

Status: `current` in source with Windows x64 MSVC native fixtures verified. Packaging, installed-host, live-model and other-OS acceptance remain separate. The behavior contract is [Parent decision requests](../architecture/root-resume.md#parent-decision-requests), preserved as feature `engine.parent-requests`.

The engine writes structured events through the existing tracing/SQLite sink, buffering and retention above. Target `codex_core::parent_request` records `request_created`, `parent_request_delivered`, `response_saved`, `response_delivered` and storage/delivery failures. Correlate `request_id`, `parent_thread_id`, `child_thread_id` and `child_task_id` where present. Delivery includes `stopped` and `parked`; response saving includes `status` and wall-clock `request_response_ms`. Failure records identify `error_kind` where supplied. Not every event repeats every identity field; join on the request ID. Diagnostic events do not duplicate question or response bodies.

Target `codex_core::parent_response_wait` records `wait_started`, `wait_checkpoint`, `wait_state_checkpoint`, `wait_ended`, `wait_resume_blocked` and `wait_recovery_blocked`. Normal interval events include `request_id`, `wait_id`, parent/child thread identity, `child_task_id`, monotonic `blocked_wait_ms`, actual blocked-start UTC `blocked_wait_started_at_ms` and `reason`. The durable registration time remains separate as `started_at_ms`; `parked_at_ms` records the first actual park. Explicit `thread_id` fields keep detached timer events in the child thread retention partition. State checkpoints additionally include `request_status`, `delivery_state` and `last_state_changed_at_ms`. Recovery-blocked records carry the request/wait/task IDs and reason, rather than a fabricated duration or successful outcome. `wait_ended` reasons distinguish answered, cancelled wait failures and waits that never reached a successful await boundary; a missing end event is unobserved, not evidence of completion or continued process health.

The engine emits the first checkpoint after 60 seconds and subsequent checkpoints at 300-second intervals. These lightweight timers inspect durable request state and record the active wait without model polling, resending requests or waking the parent again. The timer stops after response/cancellation/interruption or a durably recorded wait failure. Persistence failures keep checkpoints active and emit a visible warning; a failed park or resume is retained as nonterminal suspension pending review. They do not impose a timeout or grant approval. `blocked_wait_ms` measures the current active-engine interval, separately from request creation to response saving. After restart, recovery rotates `wait_id` and records `restored_offline_duration_unknown`; prior measured intervals remain durable, while offline time is unknown and must not be counted as measured active wait. Changed or unproven task/model/provider/authority identity leaves recovery suspended with an explicit reason.

Source checks: `node --test scripts/test-common-agent-instructions.cjs` verifies maintained/embedded guidance equality and provider mapping. The registered native check is `node scripts/check-parent-requests.cjs <absolute frozen engine source root>`; it runs the selected protocol/state/core/prompts `parent_request` and `parent_response_wait` library fixtures with locked offline dependencies, isolated host environment and serial test execution. The actual timer fixture records bounded setup HTTP methods/paths and requires zero additional HTTP during checkpoints; setup connections are distinct from inference. Use the selected engine cache and preserve its verbose output in the current task log. These checks are fixtures, not installed/live delivery acceptance. Parent-request targets are not a dedicated safe-export category in the read-only inspector; inspect local records under the existing data-handling rules and do not share raw request identities or database contents.

## Request input budget evidence

`native_inference_context_diagnostics` records final helper input components and
the normalized reported input usage through the existing SQLite sink. The
read-only inspector exports validated numeric fields as `contextBudgetDiagnostics`
with a hashed `requestRef`; the request's provider/model can be correlated with
existing inference metadata. A matching engine/helper release is required.

The evidence separates instructions, conversation, tool definitions, tool
results, tool calls and reasoning. `text_estimate_tokens` is a local text
approximation, while `image_count` and `image_bytes` describe image transport
content without estimating its tokens. `residual_tokens` is reported full input
minus estimated text, including provider overhead and image input. It is absent
when the provider reports estimated usage. Cache tokens are already part of full
reported input and must not be added again.

Collection and export use `AZRAEL_DIAGNOSTICS_INFERENCE`, the existing log flush,
time-range and event limits, and SQLite retention. No raw request content or
credential values are exported. An older release without this event cannot
recover its unrecorded input composition.

## Tool invocation evidence

Status: `partial` — source tests cover helper/adapter events, native validation and safe export. A matching engine/helper release and window reload are required before a real session contains these fields.

`native_inference_tool_diagnostics` uses the existing SQLite sink and retention limits. The inspector exports it as `toolInvocationDiagnostics`, with a hashed request reference, bounded outcome and validated `tool_diagnostics` fields. Use the existing read-only command above after waiting for the log flush. Tool names, call IDs and arguments are not exported or added by this telemetry. Name hashes support equality comparisons, not recovery of the original name.

For an `undeclared_tool` failure, compare `name_match`, `name_style`, `raw_parser_name_equal` and `mapping_result` with the catalog digest. `history_only`, `current_original` and `current_qualified` distinguish a historical alias or a current tool name from its declared wire alias. `unknown` identifies an unmatched name without asserting why it was produced. An absent raw hash means the raw observation was unavailable or the name exceeded its bound; it does not prove an adapter fault.

For a stall after `tool_call_start`, compare `args_bytes`/`args_delta_count` with `sse_args_bytes`/`sse_args_delta_count`, `args_idle_ms`, `call_elapsed_ms` and existing transport heartbeat counters. Empty deltas increase their separate counts and do not reset the non-empty argument timer. Incoming pings with unchanged argument bytes support a tool-argument generation stall; advancing raw argument bytes with stalled mapper bytes requires adapter/mapping investigation. A missing diagnostics record in an older release cannot resolve that distinction. These observations do not change the 100-second generation inactivity limit or authorize tool replay.

## Window overlay layered API regression

Run the owned desktop regression explicitly from the project root, using the selected Window Control Cargo cache:

```powershell
cargo test --locked --manifest-path native/window-control/Cargo.toml --target-dir artifacts/build/window-control-native/target layered_attributes_refresh_recovers_same_windows -- --ignored --nocapture --test-threads=1
```

The test opens a non-activating owned window, induces real alpha/color-key mode conflicts, and checks the product Overlay thread preserves layer HWNDs, extended styles, target identity, movement/resizing, rendered glow on light/dark backgrounds and the existing foreground. It pumps target messages during worker shutdown and destroys its windows. It reads pixels only inside its owned window and saves no screenshots. Run desktop fixtures serially. The test accepts the scoped API recovery in source; installed-host behavior, general refresh-error reporting and occupancy-duration display require separate verification. See the [visualization contract](../architecture/window-use-visualization.md#layered-api-충돌-복구).
