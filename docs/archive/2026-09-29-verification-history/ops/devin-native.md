# Devin native inference

Status: **current implementation with bounded automated host verification**, 2026-09-15. The SWE-2 High adapter uses Codex tools,
permissions, rollout and resume. It is separate from the existing Devin ACP
execution path. See the [architecture contract](../architecture/azrael-ex.md#devin-inference-with-native-codex-tools-and-sessions).

## Prerequisites and selection

- Windows, the matching freshly built `codex.exe` / `azrael-bridge.exe` pair and
  the pinned compatible `codex-code-mode-host.exe`.
- Node 22.18 or newer with built-in TypeScript stripping; Node 26.7.0 is the
  tested runtime. No npm installation is required for the helper.
- Existing Devin CLI login and `swe-2-high` availability. The launcher reads the
  authenticated CLI model catalog. Authentication remains CLI-owned; it reads
  `%APPDATA%/devin/credentials.toml` privately and does not create a new login store.
- A dedicated Azrael state directory and absolute paths. Ordinary `.codex`
  state is refused by the launcher. Existing native threads bind to their model,
  working directory and credential fingerprint.

`AZRAEL_DEVIN_NATIVE_HELPER` selects native inference for Devin. Without that
opt-in, existing ACP execution remains selected. A thread cannot silently switch
between these runtimes. Use a fresh native thread for the experiment; do not
rename or remove old ACP checkpoints to bypass the guard.

## Build and run

`scripts/build-azrael.ps1` includes Devin native by default (`-IncludeDevinNative:$false`
is the explicit legacy-package opt-out). It extends the normal recorded engine
build with a `providers/devin` snapshot, launcher, catalog marker and
`devin-native-build.json`. Pass the compatible external host and, when reusing the
unchanged account UI, its existing companion VSIX using the normal
[build procedure](development.md#repeatable-local-build-and-reinstall).
The additional manifest records helper/launcher hashes, upstream revision and
the selected external Node executable's version/path/hash. Node is not bundled.
`azrael-engine-build.json` remains the engine/bridge/host provenance owner.

From the repository, use PowerShell 7 and substitute absolute paths:

```powershell
& ./scripts/start-devin-native.ps1 `
  -EngineDirectory 'C:/absolute/release/engine' `
  -HelperPath 'C:/absolute/release/providers/devin/helper.mjs' `
  -StateRoot 'C:/absolute/native-devin-state' `
  -WorkspacePath 'C:/absolute/workspace' `
  -CodeMode
```

The bundled `scripts/start-devin-native.ps1` defaults to the helper in its own
release. Omit `-CodeMode` to retain the selected state's existing code-mode
setting. Add `-ResumeThreadId '<native-thread-id>'` to resume in the CLI, or
`-AppServer` for a stdio client using `thread/resume`. Use `-NodePath` and
`-DevinExecutable` to select nondefault installed executables.

The launcher enables plaintext `azrael_agents` v2 and disables provider-hosted
web search, which this adapter does not implement. Approval policy and sandbox
come from the native state/client; the launcher does not grant full access.
It restores the caller's environment after exit. Installing or updating the
VS Code extension is a separate operation; this entry point is CLI/app-server.
The launcher sets `TMP`/`TEMP` to `StateRoot/tmp/devin-native`, then restores
their previous values on exit. Temporary files remain in that dedicated state.

On Windows, Codex intentionally downgrades legacy `workspace-write` to
`read-only` when its Windows sandbox is disabled. To use workspace writes,
configure the existing native Windows sandbox in the dedicated state's
`config.toml` (the restricted-token backend uses `[windows]` with
`sandbox = "unelevated"`). The adapter preserves that platform decision;
the verification harness selects this backend explicitly for boundary checks.

## VS Code host connection

Implemented extension wiring, 2026-09-15: host preparation recognizes the
native release manifest, verifies helper files and the recorded Node runtime,
and records `devinNative.releaseDirectory` in `out/azrael-runtime.json`.
The host loads `out/devin-native-host.cjs` to configure only its scoped child
process environment. It clears ambient native selection first, then sets the
recorded helper/Node paths and state-local temporary directory. A missing or
changed native bundle fails explicitly. Historical releases without the native
manifest retain ACP; newly built releases include native by default.

Existing Azrael MCP configuration and OAuth storage remain in the same state
home. No MCP re-registration or ordinary Codex configuration copy is needed.
The native provider tool catalog excludes unsupported provider-hosted web
search without changing OpenAI or ACP behavior or the user's global search
setting. Code-mode and collaboration feature preferences remain under their
existing settings owners; native inference also supports direct function tools.

A newly installed host takes effect after **Developer: Reload Window**. Start a
new Devin SWE-2 High thread. Existing ACP threads retain their runtime binding;
they are not converted to native history. Keep the prior package or the
explicit ACP launch path for old sessions.

Per the user's instruction, this change is validated with automated script
checks and package inspection. Real model/MCP calls and VS Code UI/activation
checks are left to the user. After reloading, check a new SWE-2 High thread with
an instruction to identify the `laio` tools and perform a read-only query. Do
not treat a model's textual claim as proof; inspect the native MCP tool event.

### Host package checks, 2026-09-15

Release: `artifacts/releases/devin_native_host_20260915`; host version
`0.2.1789462926381`. Engine and bridge were freshly built together; the pinned
external code-mode host and unchanged companion account payload were reused.
Build/package and PrepareOnly exited `0`.

Installation exited `0` and selected that same tested VSIX:
[deployment receipt](../../artifacts/deployments/independent-20260915-181457-823/deployment.json).
The installer recorded `installed-reload-required`, preserved the original Codex
extension, editor settings and unrelated extension inventory, and did not launch
or reload a window. Existing MCP/OAuth state was retained without a Codex
environment snapshot. On 2026-09-16 the user confirmed that MCP connected after
this handoff. This is user-reported real-use evidence for MCP connectivity;
the agent did not rerun live calls, and it does not establish account-switching,
quota accuracy or every tool's behavior.

| Automated scope | Result / evidence |
| --- | --- |
| Native bundle integrity, legacy selection and scoped environment | 15 passed, exit `0`: [log](../../artifacts/logs/devin-native-host-20260915/test-devin-native-host.log) |
| Native Devin hosted-search exclusion; OpenAI and ACP preservation | 1 passed, exit `0`: [log](../../artifacts/logs/devin-native-host-20260915/native-host-web-targeted-test.log) |
| Exact packaged host namespace contract | Passed, exit `0`: [log](../../artifacts/logs/devin-native-host-20260915/final-test-independent-namespace.log) |
| Prepared runtime helper/Node/state/temp and caller environment | Passed, exit `0`: [result](../../artifacts/logs/devin-native-host-20260915/prepared-runtime-result.json) |
| VSIX native module/config bytes match staging | Passed, exit `0`: [result](../../artifacts/logs/devin-native-host-20260915/prepared-vsix-bytes.json) |
| Installed runtime bytes/config and existing state preservation | Passed, exit `0`: [result](../../artifacts/logs/devin-native-host-20260915/installed-file-checks.json) |

Repeat the pure runtime checks with explicit prepared receipt, release and state paths:

```powershell
node --test scripts/test-devin-native-host.cjs
node scripts/check-prepared-devin-native-host.cjs <independent-prepared.json> <release> <state-root>
```

PowerShell parsing, Node syntax and `just fmt` passed. The broader core test run
was stopped when validation scope was narrowed (exit `1` from interruption;
1,897 tests had passed, no observed test failure). It is not a full-suite pass.
These results do not establish live MCP or VS Code activation behavior.

## Validation

The reusable checks use dedicated artifact state and work directories. Their
JSON results distinguish deterministic model peers from real Devin inference:

```powershell
node --test providers/devin/tests/mapping.test.mjs
node scripts/check-devin-native-engine.mjs <codex.exe> <fresh-run-directory>
node scripts/check-devin-native-engine.mjs <codex.exe> <fresh-run-directory> --code-mode
node scripts/check-devin-native-agents.mjs <codex.exe>
node scripts/check-devin-native-engine.mjs <codex.exe> <fresh-run-directory> --live --code-mode --launcher
```

`--live` makes paid inference requests using the existing CLI credential. The
bounded task creates one marker file with `apply_patch`, reads it with
`exec_command`, restarts the engine and asks for the saved result without new
tools. `--launcher` additionally exercises the launch script and real CLI
catalog. Deterministic checks cover native policy denial/approval, workspace
boundaries, same-name namespace dispatch, MCP, malformed termination and
cancellation. The separate agents check proves a `fork_turns=none` Devin child,
its native tool calls, parent completion receipt and independent saved histories.

The first live native attempt exposed an empty-text start-frame mismatch,
fixed by preserving the native `output_text` start shape. The first workspace
fixture omitted Windows sandbox activation and correctly received read-only
denials; it is retained as diagnostic evidence, not an adapter regression.
With the sandbox enabled, shared user Temp also caused a setup-stage delay
before the filesystem helper spawned. Changing only the temporary roots to an
isolated directory resolved direct and code-mode tests. The wrapper applies
inheritable ACLs to these roots; the precise Windows security API cost was not
measured. The launcher now uses a dedicated temporary root.

### Initial CLI PoC package and results (historical)

The final opt-in bundle is
[`artifacts/releases/devin_native_20260915_2`](../../artifacts/releases/devin_native_20260915_2).
Its engine/bridge were built together from the recorded local source. The second
package reuses that exact verified pair and pinned external code-mode host,
adding the launcher Temp isolation. The unchanged companion VSIX is reused;
Node remains external. Both packaging commands exited `0`. Provider/launcher
integrity checks covered 16 files plus Node, with no mismatch.

| Scope | Result / evidence |
| --- | --- |
| Helper tool/history mapping | 21 passed, exit `0`: [log](../../artifacts/logs/devin-native-20260915/helper-tests-final.log) |
| Rust native bridge | 9 passed, exit `0`: [log](../../artifacts/logs/devin-native-20260915/native-runtime-tests.log) |
| Existing Devin runtime regression | 8 passed, exit `0`: [log](../../artifacts/logs/devin-native-20260915/devin-runtime-tests.log) |
| Direct native tools / policy / MCP / namespaces / cancel | 10 checks passed, exit `0`: [result](../../artifacts/verification/devin-native-20260915/workspace-isolated-temp/result.json) |
| Code-mode / native policy / cancel | 8 checks passed, exit `0`: [result](../../artifacts/verification/devin-native-20260915/final-code-mode-3/result.json) |
| Parent/child native lifecycle + production history mapping | 4 checks passed, exit `0`: [result](../../artifacts/verification/devin-native-20260915/final-agents/result.json) |
| Real Devin through final bundled launcher + code-mode + restart | Passed, exit `0`: [result](../../artifacts/verification/devin-native-20260915/final-live-launcher-2/result.json) |

`just fix -p codex-core` and `just fmt` exited `0`. Existing lint warnings remain;
the full upstream test suite was not run. The combined
[acceptance record](../../artifacts/verification/devin-native-20260915/acceptance.json)
binds these scopes to the same engine hash, and
[final integrity evidence](../../artifacts/verification/devin-native-20260915/package-integrity-final.json)
covers the launcher/helper bundle. Earlier real direct and code-mode results
are retained under `native-live-2` and `native-live-code-mode-1`.
That initial CLI PoC did not install an extension, migrate existing sessions or
change accounts. Diagnostic failures are retained with the successful evidence for
handoff; they are not selected as passing runs.

## Current limits

### 2026-09-16 reported regression — automated repair acceptance

The user reported the explicit `swe-2-high` gate after selecting medium, and
`provider_http_400` after a high-model response executed two commands. Native
history confirms both commands returned exit 0 before the failed continuation.
The installed `websocket_recovery_20260916_release` helper and mapping matched
the source being investigated. The local mapper split assistant text, signed
reasoning and individual calls into separate provider messages; the pinned
upstream mapper groups them into one assistant message. This is a confirmed
conversion divergence, but the server's reason for this particular HTTP 400
has not been verified. The repair and synthetic wire-level acceptance are
tracked in external session `AM-01-devin-native-tools-session/04-brief.md`.
Live login/model/MCP/UI testing remains user-owned.

Source repair acceptance: mapping tests 28 passed (exit 0), including byte-for-byte
comparison with the original transport encoder and explicit combined assistant
thinking/signature/tool-call field assertions. Native runtime tests 13 passed.
The combined native/catalog run initially exited 1 because its catalog test
inherited the live native-helper environment and expected disabled shell tools;
the separate catalog-only child process with helper environment removed passed
all 9 tests (exit 0). No product expectations were weakened. `just fmt` exited 0
with no additional file changes. Logs are in
`artifacts/logs/devin-native-repair-20260916`. The fresh release
`artifacts/releases/devin_native_replay_20260916` passed 10 deterministic engine
checks (exit 0), including native tools, restart/resume, permission decisions,
MCP fixture, namespace dispatch, truncated-helper rejection and cancellation.
Prepared host checks passed (exit 0): native/provider runtime paths and isolation,
namespace transformation, and all 338 selected stage/VSIX files including the
333 account UI files. Host `0.2.1789549265241` was installed with exit 0 and
`-NoLaunch`; receipt:
`artifacts/deployments/independent-20260916-181325-921/deployment.json`
(`installed-reload-required`). Installed files matched all 338 checked payload
files; `package.json` differed only by VS Code's installer `__metadata`.
`installed-file-acceptance.json` records this semantic manifest check. Ordinary
Codex extension contents and both preinstallation config hashes were preserved.
Config hashes had changed externally during the earlier build interval; those
changes were retained, not reverted to the initial observation. Reload the
window to activate; live confirmation remains user-owned. Use a new native
thread when changing models, because model/account/cwd continuation binding
remains enforced. Historical failed-turn tool results were not deleted or replayed.

### Remaining limits

- Native requests now use the catalog-resolved model UID without a separate
  high-only or SWE-2-name allowlist. This removes the UI/execution mismatch;
  availability still depends on the provider account and model. Additional
  models have scripted mapping coverage, not live acceptance. Text and native
  tool call/results are supported.
  Images, audio, structured output, hosted web search and foreign encrypted
  payloads fail explicitly. Existing Devin compaction restrictions remain.
- Events are delivered after the helper finishes successfully. This prevents
  execution after trailing protocol errors, but text is currently displayed in
  batches rather than token by token.
- Devin reasoning signatures stay in native rollout using a scoped opaque
  envelope. It is base64 metadata, not a new encryption mechanism. Credential
  rotation, account/model/cwd changes and signed full-history forks cannot
  silently reuse that continuation; start a fresh native thread.
- MCP, approvals and child lifecycle acceptance use deterministic model peers.
  Real-model acceptance proves shell/patch and native resume; it does not prove
  every MCP server, real-model delegation quality or VS Code approval UI.
- The vendored transport is a pinned unofficial Connect-RPC adapter. Provider
  changes can require a deliberately reviewed transport update. Original MIT
  notices and exact local modifications are recorded in
  [`UPSTREAM.md`](../../providers/devin/UPSTREAM.md).

Keep native rollout/SQLite as the history authority. Provider runtime markers
contain only binding metadata; helper processes own neither tools nor a second
conversation database. Do not diagnose failures by exporting credentials or raw
provider responses. Keep task logs and result summaries under `artifacts/`.

### 2026-09-18 failure classification and repair

The supplied thread `01a0b28f-6eeb-7f32-8bf6-cbac5d76f3d0` starts with
GPT-6 Astra (Devin) ending in `provider_eof`, without a first token. This is
separate from the older SWE-2 `unsupported_history_item` reproduction involving
an opaque native compaction checkpoint. A new session alone does not resolve an
incomplete provider stream.

The Connect decoder now defers a finish field until all content/tool/signature
fields in the same protobuf frame have been processed. Duplicate finish fields,
content in later frames after finish, and incomplete streams remain errors.
Five new decoder fixtures and all 34 Devin tests pass (exit 0), recorded in
`artifacts/logs/provider-handoff-20260918/devin-tests-final.log`.
The helper reports only sanitized event count, last event kind and unsupported
history kind; raw provider content and credentials are not diagnostic output.
This ordering fix addresses reproduced `event_after_finish`. The subsequent
first-request `provider_eof` diagnosis and separate correction are recorded below.

Cross-provider encrypted checkpoints use the source-model plaintext handoff
specified in [the architecture](../architecture/azrael-ex.md#history-projection-and-capability-checks).
This does not relax same-provider model/account/cwd continuation checks above.
Build, integration and installation acceptance are recorded separately.

### First-request EOF reproduced (2026-09-18 follow-up)

After the user's continuation, one bounded, tool-free diagnostic used the exact
variant from the supplied thread (`gpt-6-astra-low`, corresponding to the UI group
and low effort). A preliminary attempt used the UI group ID and was rejected by
catalog admission before any inference; it is not a second inference call.
The actual request returned HTTP 200, one text event, two usage events, five
protobuf data frames and an error-free compressed Connect EOS trailer. No frame
contained protobuf finish field 5. The existing native mapper consequently
reported `provider_eof`, despite the provider's successful transport termination.
Only field numbers/types/lengths and event counts were retained:
`artifacts/logs/provider-handoff-20260918/first-turn-structure.json`.
No response text or credentials were written to diagnostic artifacts.

The transport now recognizes validated successful Connect termination as a
finish when visible text or tool calls exist and no explicit finish was provided.
This follows the [Connect EndStreamResponse contract](https://connectrpc.com/docs/protocol/#error-and-endstreamresponse):
success omits the error property, and an empty object is a valid successful
trailer. Explicit incomplete reasons are not overridden. Missing/malformed/error
trailers, bytes after EOS, cancellation and invalid tool argument JSON remain
failures. Empty and reasoning-only finish-less responses do not become success.

All 47 Devin tests pass, exit 0 (`devin-eos-final2-tests.log`), covering termination,
strict protobuf validation, reserved envelope flags, unknown/ERROR finish reasons,
legacy group skipping, empty tool finishes, and prompt cancellation of an open
locked response reader. Independent read-only review found no remaining blocker
in the active transport/mapper path. No second live inference was
used to verify the patched adapter; the corrected behavior is fixture-verified.
Release `provider_handoff_20260918_v6` packaged and installed successfully (exit 0),
using the source-verified v2 engine/bridge and companion payload. Bundle hashes
and changed adapter source bytes match. PrepareOnly, prepared Devin runtime checks,
and all six fresh-state standalone/coexistence host stages passed (exit 0).
Host `0.2.1789710678043`, VSIX SHA256
`23846fb58ce3b929bb9a185006faf7bec7d683284609a4cd8134e42044fb4784`,
is the exact package tested and installed. Acceptance:
`artifacts/verification/provider-handoff-host-20260918-v6/check-result.json`.
Installation receipt:
`artifacts/deployments/independent-20260918-150534-429/deployment.json`.
Original Codex files, editor settings and unrelated extensions were unchanged.
The standard environment snapshot was applied. No user window was launched,
terminated or reloaded; **Developer: Reload Window** activates the installed host.
Earlier v3-v5 helper candidates were superseded without installation.
The earlier whole-core failures remain unresolved; this is scoped acceptance,
not a claim of full upstream regression or post-patch live-provider acceptance.

### Detailed fatal-error diagnosis (2026-09-19)

Status: source instrumentation verified offline. Installation and active-window
evidence remain separate; see the deployment record below when available.

Helper source validation: 70 offline tests passed (exit 0), including real
helper subprocesses with synthetic success, stream-timeout and HTTP 503 peers.
These verify frame order, structural telemetry and credential/message exclusion;
they do not establish live-provider behavior or an installed runtime. Log:
`artifacts/logs/fatal-diagnostics-20260919/helper-tests.log`.
Host source validation: 49 host/recovery tests passed (exit 0), including
admission/terminal correlation, secret exclusion and a failing log sink that
does not prevent dispatch. Log:
`artifacts/logs/fatal-diagnostics-20260919/host-tests.log`.
Native Rust source validation: `cargo test -p codex-core devin::native_runtime`
passed 20 tests (exit 0), including real subprocess failures for malformed JSONL,
EOF without completion, nonzero exit, cancellation, spawn/write failure and
diagnostic sanitization. `cargo check -p codex-core` also passed before the final
diagnostic-only refinement; the focused tests were rerun afterward. Final log:
`artifacts/logs/fatal-diagnostics-20260919/native-tests.log`.

Fresh engine/bridge build: `fatal_diagnostics_20260919_v1`, exit 0. The existing
verified companion payload and external code-mode host were reused; engine and
bridge were rebuilt with source provenance. Offline engine acceptance passed
11/11 checks (exit 0). All 17 fixture requests produced correlated lifecycle
records: 15 completed, one cancelled and one EOF without terminal. Evidence:
`artifacts/verification/fatal-diagnostics-engine-20260919/diagnostics-evidence.json`.
Host preparation produced version `0.2.1789811824655` and receipt
`artifacts/deployments/independent-20260919-185630-919/deployment.json` (`prepared`).
VSIX SHA256: `A4BFE39F1C4ADD1E9C1B5656B1A58DD11D892B0D1F7E2CB1E5ED9B906E046847`.
The interrupted caller's preparation exit code was not retained; the preparation
receipt and package/hash verification establish completion. Host acceptance and
normal-profile installation are recorded separately below.

Deployment acceptance: all six fresh-state host stages and the prepared Devin
runtime check passed (exit 0). Evidence:
`artifacts/verification/fatal-diagnostics-host-20260919/check-result.json` and
`artifacts/logs/fatal-diagnostics-20260919/prepared-devin-native-host.log`.
Installation of this exact package passed (exit 0), receipt
`artifacts/deployments/independent-20260919-203138-017/deployment.json`, status
`installed-reload-required`. Installed recovery files match source; runtime
configuration selects `fatal_diagnostics_20260919_v1`. Original Codex, settings
and unrelated extensions were preserved. No user window was launched or
reloaded. Finish active work, then **Developer: Reload Window** in each Azrael
window to activate the diagnostic build. Post-reload live-provider behavior is
not yet verified. Installed evidence:
`artifacts/logs/fatal-diagnostics-20260919/installed-evidence.json`.

| Engine event | Diagnostic purpose |
| --- | --- |
| `native_inference_started` | Thread/turn/request correlation and actual engine PID/path, helper/runtime paths. |
| `native_helper_spawned` / `native_helper_spawn_failed` | Whether the child was created; child PID and input sizes, or launch failure. |
| `native_input_delivered` / `native_input_failed` | Whether both input frames reached the helper; pipe failure boundary. |
| `native_inference_progress` | Phase and first-activity timing, network/event silence, output backlog and counters. |
| `native_inference_helper_failed` | Allowlisted helper/transport category and numeric HTTP status. |
| `native_inference_finished` | Stable final outcome, elapsed time, frame/output counts and child exit code. |

Progress counters exclude the frame carrying the snapshot; engine counters
describe received frames. `stdout_buffered_bytes` samples the live queue rather
than the queue at the last write. Missing optional first-byte/first-event fields
mean that the corresponding activity has not yet been observed.

First establish the active runtime. The Azrael Recovery output channel emits
`recovery.runtime` with the loaded host version, host module and configured
engine/release paths. This is configuration evidence, not proof that an already
running engine was replaced. Compare the engine's own request lifecycle record
(engine path/PID, helper/runtime paths) with it. Installation receipts marked
`installed-reload-required` require **Developer: Reload Window** after active
work is finished. Do not stop user processes to activate diagnostics.

Keep the default `error,devin_native_progress=info` filter. If an explicit
`RUST_LOG` exists, append `devin_native_progress=info` instead of replacing it;
enabling global DEBUG/TRACE is unnecessary. Engine records use the existing
engine tracing sink (including `~/.azrael-ex/logs_2.sqlite` where configured)
and the active VS Code Azrael extension log. Recovery records use the existing
**Azrael Recovery** log output channel. VS Code logs remain under
`%APPDATA%/Code/logs/<session>/window*/exthost/`; use **Developer: Open Logs
Folder** to locate the active window. Existing engine/VS Code log retention and
rotation apply; this feature creates no separate unbounded production log.

For one failure, retain the UTC time, thread/turn ID, request ID and active
runtime identity. Follow that request through spawn/input delivery, phase
changes, ten-second progress snapshots and terminal/child-exit outcome. The
phase duration and first-byte/first-event timing distinguish waiting for
headers, no network bytes, and bytes arriving without usable model events.
Output queue size/backpressure and frame/byte counters distinguish helper
activity from stdout delivery. An engine timeout before any progress must still
have a terminal record; absence of telemetry alone does not prove provider
inactivity. Provider error categories are allowlisted and HTTP status is numeric;
unknown failures remain explicitly unknown rather than guessed from text.

For a failed continuation, correlate `recovery.turn_terminal` and
`recovery.admission` by thread/turn ID. Admission logs show attached, admitted
or blocked and a stable reason, including an unrecognized terminal state or
unresolved previous dispatch. RPC results/timeouts carry a separate host request
ID, duration/budget and numeric RPC error code. These logs do not change the
existing recovery policy. `droppedDiagnostics` reports earlier host log write
failures when the sink recovers; log failure does not stop the request.

Export only these structural records for the affected time/thread/request.
Never copy full rollout, authentication files, environment, response bodies,
raw stderr or arbitrary exception messages into diagnostic reports. Local
runtime paths and correlation IDs are intentional diagnostic fields; redact
local usernames before sharing outside the workstation. Keep task exports in
`artifacts/logs/<task>/` through investigation and acceptance, then remove them
under the existing work-artifact cleanup rules. No external upload is automatic.

### Progress and catalog ownership refactor (2026-09-18)

Source changes are verified in release `devin_progress_20260919_v2`, installed on
2026-09-19 as host `0.2.1789786756677` (existing windows require reload).
Native model resolution remains engine-owned;
the short-lived native helper skips a redundant `GetCascadeModelConfigs` call.
Standalone transport callers retain catalog preflight. Neither cached catalog
acceptance nor the bypass overrides a server-side inference failure.

The helper reports structural progress every 10 seconds and at termination.
The engine logs `native_inference_started` with request/thread/model correlation
and `native_inference_progress` with phase, elapsed/idle milliseconds, byte/event
counts and an enumerated last event. No provider text, reasoning, tool arguments,
credentials or response bodies belong in these records. Use the existing engine
log sink and its retention; no independent production log file is created.
For VS Code diagnostics, filter the active window's Azrael extension log under
`%APPDATA%/Code/logs/<session>/window*/exthost/azrael-ex-local.azrael/azrael.log`
by these event names and request ID, and export only the structural records.
Native host and launcher default to `RUST_LOG=error,devin_native_progress=info`
only when no explicit filter is set. An existing filter is preserved; append
`devin_native_progress=info` to it to enable these content-free records, and
restore the prior filter to revert. Inspect the active engine sink if the host
does not forward INFO records; lack of a forwarded record does not establish
absence of provider activity.

`provider_headers_timeout`, `provider_stream_idle`, and
`provider_request_deadline` distinguish the provider boundaries. The engine's
helper watchdog is 120 seconds without protocol frames and its absolute request
deadline is 315 seconds; progress does not extend the absolute limit. Tool
execution remains gated on valid completion and successful helper exit.
No concurrency serialization or session-ID reuse change is included.

Pre-refactor live comparison evidence is in
`artifacts/logs/swe2-specific-tools-20260918/concurrency-result.json`: all three
SWE-2 High requests succeeded, with 76.2 seconds of semantic silence in one
parallel request. This does not reproduce or prove the historical 120-second
failure's provider-side cause. Refactor validation logs are under
`artifacts/logs/devin-progress-refactor-20260918`; retain them through acceptance.

Validation, 2026-09-19: provider tests 57/57, host tests 16/16, native Rust
tests 17/17; real SWE-2 High helper tool/result replay (two calls); engine
catalog-refresh checks 5/5 and native lifecycle/permissions checks 11/11 passed.
The engine checks verify progress reaches the log sink, incomplete output does
not execute tools, cancellation, native MCP, and restart/resume. Release
`devin_progress_20260919_v2` built with fresh engine/bridge and source provenance;
compatible code-mode host and companion payload were reused. The v1 build was
rejected by source-change detection and was not packaged. Full-duration 120/300/315-second watchdog tests
and historical production failure reproduction are not claimed by this scope.

Installation, 2026-09-19: preparation, all six fresh-state host acceptance stages,
and installation passed (exit 0). Exact tested package:
`artifacts/deployments/independent-20260919-115733-008/package/azrael-host.vsix`.
Acceptance: `artifacts/verification/devin-progress-install-20260919/host-result.json`
and `standalone-host-result.json`. Installation receipt:
`artifacts/deployments/independent-20260919-121511-079/deployment.json`, status
`installed-reload-required`. Registry selects host `0.2.1789786756677`.
Original Codex, editor settings and unrelated extensions passed installer
preservation checks. No user window was launched, terminated or reloaded.
Finish active work and use **Developer: Reload Window** to activate this release.

### Catalog unavailable after tools (2026-09-18 follow-up)

Thread `01a0b340-a2e9-7421-9282-816f174f2ff2` returned its last tool result
at `06:49:50.248Z`, then failed model resolution at `06:49:50.354Z` with
`unable to resolve Devin model: Devin model catalog unavailable`. This is
separate from the prior Connect EOS correction. The model was the grouped
SWE-2 selection with a 262000-token context. The incident logs do not record
the underlying file-read error or a contemporaneous refresh failure. Earlier
CLI timeout/exit-1 warnings demonstrate possible failure modes only; the
unrelated omission of `adaptive` for missing context metadata is not causal proof.

The previous catalog refresh handler cleared memory and deleted
`azrael/devin/models.json` on any failure, while native inference rereads that
snapshot after tool results. A deterministic check against installed v6
reproduces the exact error by failing discovery before tool delivery
(`artifacts/logs/devin-catalog-20260918/before-engine.log`, exit 1).
The correction retains last-good memory and disk on refresh failure and retains
memory on failed offline reads. Successful empty results remain authoritative;
no cache means resolution still fails. Account/credential and exact model
validation are unchanged. The refresh warning states that the prior catalog is
retained. This changes error recovery, not model entitlement.

Scoped catalog tests passed: 13/13, exit 0, `catalog-tests.log` under the same
log directory; `just fmt` passed. Fresh engine/bridge release
`devin_catalog_20260918_v1` built successfully (exit 0), reusing the compatible
code-mode host and companion payload. Actual-engine acceptance passes all four
checks (exit 0, `after-engine.log`): CLI exit-1 and malformed catalog during a
tool turn, native patch/shell completion, process restart/resume without replay,
and successful empty online refresh. The same failure boundary fails on the old
v6 engine. Reproduction and validation use synthetic credentials and make no
live model calls. PrepareOnly, prepared Devin runtime checks, all six isolated
host stages and installation passed (exit 0). Installed host `0.2.1789717006271`
uses the exact tested VSIX, SHA256
`8b155a46aa6b65e3a436c056532e1f371547b47982c08eb3f7e065f2242982dc`.
Receipt: `artifacts/deployments/independent-20260918-165356-571/deployment.json`.
Host checks: `artifacts/verification/devin-catalog-host-20260918/check-result.json`.
Original Codex files, editor settings and unrelated extensions were verified
unchanged; the standard environment snapshot was applied. No user window was
launched, stopped or reloaded. Reload all Azrael windows before continuing the
affected thread: an old engine still running can retain the old cache-deletion
behavior. User-thread live continuation remains unverified. Prior whole-core
failures were not rerun or relabeled as passing; this is scoped acceptance.
