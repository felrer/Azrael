# Devin native inference

Procedures for running, verifying and diagnosing native Devin inference. The contract is owned by [Devin architecture](../architecture/devin.md).

## Verified scope

- **Real-model:** SWE-2 High shell/patch tool calls through the bundled launcher and code-mode, native restart/resume, and tool/result replay through the helper. A real SWE-2 child spawned by a scripted parent completed native commands and a follow-up.
- **Deterministic fixtures:** native policy approval/denial, workspace boundaries, same-name namespace dispatch, MCP, malformed or truncated helper output, catalog refresh failure during a tool turn, cancellation, parent/child lifecycle, and diagnostic lifecycle records.
- **User-reported:** MCP connectivity from the installed host.
- **Not established:** every MCP server, real-model delegation quality, the VS Code approval UI, other SWE-2 variants or Devin models beyond mapping tests, full-duration watchdog timing, and whole-suite regression.

## Prerequisites and selection

- The matching `codex.exe`/`azrael-bridge.exe` pair and the pinned compatible `codex-code-mode-host.exe` from one release.
- Node 22.18 or newer with built-in TypeScript stripping; Node is external and its path, version and hash are recorded in the release's `devin-native-build.json`. No npm installation is needed.
- An existing Devin CLI login (credentials stay in `%APPDATA%/devin/credentials.toml`) or a managed Devin account, and the selected model in the account's catalog.
- A dedicated Azrael state directory given as an absolute path; the launcher refuses ordinary `.codex` state.

`AZRAEL_DEVIN_NATIVE_HELPER` selects native inference. The installed host sets it for its own child environment only when the release carries a native manifest. A thread keeps the runtime it started with; never rename or remove ACP checkpoints to bypass that guard. Changing model, account or cwd requires a new thread because the continuation binding is enforced.

## Build and run

`scripts/build-azrael.ps1` includes Devin native by default (`-IncludeDevinNative:$false` opts out). The release adds a `providers/devin` snapshot, the launcher, a catalog marker and `devin-native-build.json` with helper and launcher hashes, the upstream revision and the Node runtime identity. Build with the normal [build procedure](development.md#build).

CLI or app-server use without VS Code:

```powershell
& ./scripts/start-devin-native.ps1 `
  -EngineDirectory 'C:/absolute/release/engine' `
  -HelperPath 'C:/absolute/release/providers/devin/helper.mjs' `
  -StateRoot 'C:/absolute/native-devin-state' `
  -WorkspacePath 'C:/absolute/workspace' `
  -CodeMode
```

Omit `-CodeMode` to keep the state's existing setting. `-ResumeThreadId '<id>'` resumes in the CLI; `-AppServer` starts a stdio client using `thread/resume`. `-NodePath` and `-DevinExecutable` select nondefault executables. The launcher enables plaintext `azrael_agents`, disables provider-hosted web search, sets `TMP`/`TEMP` to `StateRoot/tmp/devin-native`, and restores the caller environment on exit. Approval policy and sandbox come from the state or client; the launcher never grants full access.

On Windows, Codex downgrades legacy `workspace-write` to `read-only` when the Windows sandbox is disabled. For workspace writes, enable the native sandbox in the state's `config.toml` (`[windows]` with `sandbox = "unelevated"`). Keep the dedicated temporary root: the shared user Temp directory delays sandbox setup.

In VS Code, a newly installed host takes effect after **Developer: Reload Window**; start a new Devin thread. To check MCP, ask a new thread to identify the `laio` tools and run a read-only query, then confirm the native MCP tool event rather than the model's claim.

## Validation

```powershell
node --test providers/devin/tests/mapping.test.mjs
node --test scripts/test-devin-native-host.cjs
node scripts/check-devin-native-engine.mjs <codex.exe> <fresh-run-directory>
node scripts/check-devin-native-engine.mjs <codex.exe> <fresh-run-directory> --code-mode
node scripts/check-devin-native-agents.mjs <codex.exe>
node scripts/check-prepared-devin-native-host.cjs <independent-prepared.json> <release> <state-root>
node scripts/check-devin-native-engine.mjs <codex.exe> <fresh-run-directory> --live --code-mode --launcher
```

The first six use deterministic peers and synthetic credentials. `--live` makes paid requests with the existing CLI credential: it creates one marker file with `apply_patch`, reads it with `exec_command`, restarts the engine and asks for the saved result without new tools; `--launcher` also exercises the launch script and real CLI catalog. Results are JSON files in the run directory that distinguish deterministic from real inference. Rust coverage: `just test -p codex-core devin::` (native runtime, catalog, ACP).

Engine unit tests that read the catalog must run without the live `AZRAEL_DEVIN_NATIVE_HELPER` environment, which changes the tool catalog under test.

## Limits

- Text appears per request after the helper finishes, not token by token.
- Images, audio, structured output, hosted web search and foreign encrypted payloads fail explicitly; context overflow fails instead of compacting.
- Credential rotation, account/model/cwd changes and signed full-history forks cannot reuse a continuation; start a new thread.
- The vendored transport is a pinned unofficial Connect-RPC adapter; provider changes can require a reviewed transport update. Notices and local modifications are in [`UPSTREAM.md`](../../providers/devin/UPSTREAM.md).
- Native rollout and SQLite are the only history; failed-turn tool results are never deleted or replayed.

## Diagnostics

Keep the default filter `RUST_LOG=error,devin_native_progress=info` (set by the host and launcher only when no filter exists). If `RUST_LOG` is set explicitly, append `devin_native_progress=info` instead of replacing it; global DEBUG/TRACE is unnecessary.

| Engine event | Meaning |
| --- | --- |
| `native_inference_started` | Thread/turn/request correlation; engine PID/path; helper and runtime paths. |
| `native_tool_catalog` / `native_tool_schema` | Native Devin request-scoped catalog and per-tool sizes/hashes, bounded structural schema inspection and omission counts. Requires an engine containing tool-request diagnostics; managed OpenCodex requests do not emit these records. |
| `native_helper_spawned` / `native_helper_spawn_failed` | Child PID and input sizes, or launch failure. |
| `native_input_delivered` / `native_input_failed` | Whether both input frames reached the helper. |
| `native_inference_progress` | Phase, first-activity timing, network and event silence, stdout backlog and counters. Counters exclude the frame carrying the snapshot; missing first-byte/first-event fields mean that activity has not occurred yet. |
| `native_inference_transport` | Temporary typed boundary snapshot: network read and adapter wait, SSE/ping counts, partial-frame bytes, provider-declared block state, abort/error origin and hashed response metadata. Requires the matching helper and engine diagnostic contract. |
| `native_inference_helper_failed` | Allowlisted transport category, numeric HTTP status, original provider code, error source, validated trace ID and recognized reason. |
| `native_inference_finished` | Final outcome, elapsed time, frame/output counts and child exit code. |
| `native_inference_attempt_finished` / `native_inference_recovery_finished` | Logical request ID, attempt number, retry scheduling/exhaustion and final recovery outcome. Requires an engine containing activity/recovery support. |

Records go to the engine tracing sink (`~/.azrael-ex/logs_2.sqlite`) and the active window's extension log, `%APPDATA%/Code/logs/<session>/window*/exthost/azrael-ex-local.azrael/azrael.log` (**Developer: Open Logs Folder**). The **Azrael Recovery** output channel emits `recovery.runtime` (loaded host version and configured engine/release paths), `recovery.turn_terminal` and `recovery.admission`; `droppedDiagnostics` reports earlier log-write failures. Existing retention applies; no separate log is created.

To diagnose one failure:

1. Record the UTC time, thread/turn ID, request ID and the visible error.
2. Confirm the active runtime. `recovery.runtime` is configuration evidence only; compare it with the engine path and PID in `native_inference_started`. An installation marked `installed-reload-required` is not active until the window is reloaded.
3. Follow the request through spawn, input delivery, phase changes, ten-second progress and the terminal record. Phase and first-byte/first-event timing distinguish waiting for headers, no network bytes, and bytes without usable events; backlog and frame counters distinguish helper activity from stdout delivery. Timeout codes name the boundary: `provider_headers_timeout`, `provider_stream_idle`, `provider_request_deadline`, or the engine watchdog. For a provider rejection, inspect `provider_error_code`, `provider_error_source`, `provider_trace_id` and `provider_reason` on `native_inference_helper_failed`. `connect_trailer` means `http_status` is mapped from the RPC error, while `http_response` means it is the response status line. A mapped 400 can represent `invalid_argument`, `failed_precondition` or `out_of_range`; it does not establish which field was rejected.
4. For a failed continuation, correlate `recovery.turn_terminal` and `recovery.admission` by thread/turn ID.

The read-only inspector (`python -B scripts/inspect-native-azrael-errors.py --minutes 60 --events 30`) exports these validated fields as `providerError` (`code`, `source`, `traceId`, `reason`). Reasons are fixed labels for recognized complete message templates: `internal_error`, `context_limit`, `invalid_thinking_signature`, `missing_tool_result`, `missing_tool_use`, `usage_limit`, `rate_limit` and `invalid_request`. `message_missing` means no message was supplied; `unrecognized_message` means a message was supplied but its text was withheld. The reason records the provider's statement, not a verified root cause. Unknown codes become `unknown`; malformed trace IDs are omitted. Arbitrary provider text can quote credentials or request content and is never persisted by this path. Older records without these fields remain readable; discarded historical details cannot be recovered. The helper bundle and engine both need this contract, so an installed host uses it only after building/installing the updated release and reloading its window.

Tool-request records compare the engine's helper-input catalogs across failures and successes. Schema checks are observational keyword-shape checks, not full JSON Schema validation or provider acceptance checks. The inspector includes INFO-level catalog/schema records as `toolDiagnostics` and exports validated hashes, sizes and counts; it withholds labels and arbitrary text. `requestRef` is a hashed request identifier shared with provider failures, while `threadRef` groups records by thread. Native logs carry the corresponding request ID. Records use the existing sink and retention, and require building/installing an updated engine and reloading the window before they can appear in live state.

The inspector exports INFO-level inactivity and attempt/recovery outcomes as `inferenceDiagnostics`, including decoded-event counts, event/network silence, safe last-event labels, attempt number and whether a retry was used. Regular running progress is omitted from that export. A heartbeat can increase received bytes while decoded-event counts remain fixed; inspect both counters before attributing a timeout to a disconnected helper. Each attempt retains the logical request ID and is distinguished by its attempt number. The [shared native activity/recovery contract](../architecture/devin.md#inference-activity-and-bounded-recovery) defines watchdog and automatic retry behavior; source changes take effect only after an updated engine is installed and its window reloaded.

An engine timeout before any progress still has a terminal record, and missing telemetry does not prove provider inactivity. Unknown failures stay unknown. Share only these structural records for the affected time and request, with local usernames redacted. Never export full rollouts, authentication files, environment, response bodies, raw stderr or exception messages, and never copy the Devin database or credentials.

### Temporary stall investigation

Status: `current` for matching helper/engine source, focused mock validation and the installed diagnostics package. Running windows require reload to use the update; server-side causes remain unverified.

Query a bounded period with `python -B scripts/inspect-native-azrael-errors.py --minutes 60 --events 200`. `transportDiagnostics` exports revalidated snapshot fields and shares `requestRef` with failure records. Compare successive snapshots and the terminal snapshot; a missing field means unobserved, not zero or success. Snapshots are emitted on the existing ten-second cadence and terminal path. The temporary code uses the existing sink, filter and retention.

| Observation | Supported interpretation |
| --- | --- |
| `read_state=pending`, rising `read_wait_ms`, fixed chunk count | The client's outstanding body read has received no next chunk; the blocked remote hop is unknown. |
| Rising heartbeat count with fixed generated-event count | Connection maintenance reached the client without new generated content. |
| Rising chunks or `sse_pending_bytes`, fixed complete SSE count | Raw data arrived but a complete parsed SSE frame has not arrived. |
| Complete non-heartbeat SSE frames advance while parser event count is fixed | Inspect adapter parsing/iterator wait; upstream frames reached the observer. |
| Open `thinking`/`redacted_thinking` block | The provider declared thinking state; current server computation is not established. |
| Parser events advance but output frames do not, or stdout backlog rises | Inspect helper mapping and stdout delivery; buffering may be intentional until completion. |
| `abort_source=deadline` with timeout/abort and stage | The local request deadline ended work at the recorded boundary. |

Response request-ID/server/via values are hashed. Hashes compare response identities and routing metadata across client records; they cannot substitute for provider-side telemetry or identify the raw remote infrastructure. Exact attribution to server computation, provider queueing or a particular intermediary requires provider/server logs.

The removal boundary is the helper stall diagnostic module and hooks, optional Rust transport validation/log event, inspector transport extraction and their focused diagnostic tests. Remove the shared dependency from release staging and provenance inventories at the same time. Keep the 900-second helper limit, 915-second shared engine budget, 100-second generation inactivity and local deadline error classification.

## Legacy ACP path

Existing ACP threads open only through the ACP runtime. Start the CLI directly with `& "$env:LOCALAPPDATA\azrael-ex\tools\devin\<version>\bin\devin.exe"` (keep the `:LOCALAPPDATA` part). ACP requires an unrestricted permission profile because the Windows CLI has no OS sandbox, rejects non-text input and structured output, and does not support native compaction. Its diagnostic events (`devin_session_*`, `devin_prompt_*`, `devin_permission_*`, tool records with `tool_call_id`, `status`, `reason_code`) are in `logs_2.sqlite`; query by time range and native turn ID or external session ID.
