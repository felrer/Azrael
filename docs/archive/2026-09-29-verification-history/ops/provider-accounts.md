# Unified accounts and usage

Status: implemented, automatically verified and installed, 2026-09-16; window reload
is required. Deployment evidence is recorded below. Live login, provider usage accuracy, chat and
VS Code UI verification are left to the user.

This deployment status refers to account management. The managed-inference
extension described below is a separately validated source change and has not
been installed by this task.

## One page

`azrael.manageAccounts`, `azrael.usage` and `azrael.devinAccount` open the same
Codex-styled account/usage page. OpenAI cards keep native account capture, login,
reauthentication, removal, pending-switch cancellation and rate-limit/reset
ticket details. The status-bar QuickPick remains an OpenAI shortcut.

Managed provider cards show selected account, authentication state, quota source
and observation time. Provider account selection is manual. An account whose
provider has no native chat adapter is explicitly marked as disconnected from
chat; registering it does not add that adapter. API keys are entered through a
password input, not an HTML form. OAuth login uses the upstream provider flow.
Canceling a login terminates this operation's helper, not the user's other apps.

OpenAI switches the current engine after active work becomes idle. Managed Devin
selection applies to new native threads; existing managed threads retain their
account ID. Legacy Devin threads keep their original CLI credential source.
Google/xAI/OpenRouter native inference likewise pins the selected account when a
thread first uses that provider. Changing the global selection affects new
bindings; switching models/providers within an existing thread preserves its
provider-specific account pins and takes effect at the next turn boundary.
The first managed account initializes that provider's managed default; adding
further accounts preserves the existing managed selection atomically. The CLI
card remains a separate credential source, not a mirrored managed account.
Fingerprint checks still reject a changed key/server, even after reauthentication
of the same account. Missing or revoked pinned accounts never fall back to the
currently selected account. Account removal affects future credential resolution;
it does not revoke unrelated remote sessions.

## Storage and runtime

OpenAI authentication remains in the native profile/keyring owner. Additional
provider accounts use original opencodex modules pinned to
`9f7397ed1582d95c6c1fcf4ae9951213b3fa2d19`, executed by pinned Bun `1.4.2`.
The private stdio helper is packaged with the release and selected through the
host's scoped environment. No opencodex management HTTP server is started.

`OPENCODEX_HOME` is explicitly fixed to
`CODEX_HOME/azrael/providers/opencodex`. Upstream owns its `auth.json`, config/API
key pools, atomic mutations and file protection. This is permission-hardened
upstream storage, not the native OpenAI encrypted keyring. Existing standalone
opencodex and ordinary Codex stores are not copied or synchronized automatically.
Do not include this directory in public diagnostics or remove it as build output.

The host manifest checks the helper/runtime and packaged dependencies. A changed
or missing configured bundle fails explicitly. Historical releases without the
provider manifest keep their previous behavior and clear ambient provider helper
selection. Existing `~/.azrael-ex` state remains outside build artifacts.

## Usage semantics

Quota queries use each requested account without changing selection. The extension
coalesces account queries into a provider batch, limits simultaneous quota helper
processes to two, and backs off failed batches. Results are keyed by provider and
account; outdated account-list responses are discarded. The UI retains a previous
successful observation on failure and labels it as old data.

Remaining credits, currency, percentages and reset times keep their source units.
Unsupported, failed and unmeasured are distinct from zero and unlimited. Request
token counters are not account quota. The original CLI Devin `/usage` observation
is shown only on the CLI account card. The pinned upstream does not provide
managed Devin per-account quota, so those cards explicitly show unsupported.

### OpenRouter discovery and usage

Implemented and package-verified, 2026-09-17; local installation is recorded
separately below. Open a new chat and expand the
OpenRouter section in the model picker. Search matches model names and IDs
across provider groups. The selected account supplies that provider's next new
thread binding; selecting a model does not rotate accounts. The account badge
"채팅 연결 설정됨" describes configured runtime support, not successful inference.

The picker consumes all model-list pages, including pages after hidden Devin
aliases. OpenRouter discovery includes models whose returned metadata supports
text input, text output and tools. The ordinary catalog cache is fresh for five
minutes; the picker refresh button requests a fresh lookup. Transient failures
may display a clearly marked previous roster for up to 24 hours. Authentication
failure, an authoritative empty roster or changed identity cannot reuse old
callable IDs. Key add/select/remove invalidates the provider's discovery cache.
Cache data lives under `OPENCODEX_HOME/catalog/openrouter.json`; it contains
model metadata and an identity fingerprint, not the API key. Do not copy it
between accounts to diagnose availability.

Reasoning UI follow-up (2026-09-17): source implemented and scoped-tested; this
is not an installed-release claim. The existing effort popover/slider uses model-specific
OpenRouter API stages and defaults, with verified GLM 5.3/Flash/batch fallback
when stages are missing. Those four variants use Low / High / Max, default Max,
and mandatory reasoning. Unsupported/off stages are not offered. No explicit
default uses Automatic and omits reasoning configuration upstream; the native
host's internal automatic marker never becomes an OpenRouter effort.
Discovery snapshots are now schema 2; prior schema 1 snapshots are rediscovered.
Menu reopening reuses the host's complete in-memory result; successful new-thread
creation refreshes once and the manual refresh button remains available.
The Default/recommended model item is removed from provider-grouped lists.

Validation: from providers/opencodex, the pinned local Bun binary ran
`test --timeout 30000 tests/catalog.test.ts tests/reasoning.test.ts tests/inference.test.ts`
(37 passed, exit 0). `node --test scripts/test-provider-model-picker.cjs` verified
24 pinned-transform/runtime cases (exit 0). From upstream/codex/codex-rs,
`cargo test -p codex-core managed_catalog` passed 14 cases including the durable
10-model helper-normalized fixture (exit 0). Scoped Rust formatting and the
inference bundle build passed (exit 0). Logs: artifacts/verification/openrouter-reasoning/
helper-tests-final.log, picker-tests-final.log, cargo-test-managed-catalog-v2.log,
rustfmt-check-final.log and helper-build-final.log. The Rust formatting correction
changed only the new effort-order predicate layout after the successful tests.
No full workspace acceptance, engine/bridge/VSIX release build, reinstall, live
visual acceptance or paid inference is established by these source checks.


OpenRouter key information shows returned lifetime/day/week/month spend in USD.
An unset per-key cap is labeled "키별 지출 한도 미설정"; it does not mean unlimited
account funds. Zero remains a numeric cap. Remaining cap and account balance
are different quantities; the UI does not infer one from the other or subtract
lifetime spend from a resettable cap. Real request errors remain visible.

Implementation verification (2026-09-17): isolated provider tests passed 39/39;
account presentation/service tests passed 25/25; transformed picker tests passed
19/19. Rust core/models-manager checks passed 98/98, model-list checks 5/5,
protocol/schema checks 5/5, and the final catalog semaphore check 6/6. Formatting
passed. A read-only core Clippy run remained blocked by 30 existing denied
lints, beginning at `runtime_tool_permissions.rs:156`; it reported no new
managed-catalog diagnostics. The full Rust workspace suite was not run.
Logs and structured results live under
`artifacts/logs/provider-model-picker/` and
`artifacts/verification/provider-model-picker-backend/`.

Release `provider_picker_20260917_v1` built successfully (engine and bridge from
source; code-mode host reused from `provider_list_20260917`). Its packaged account
checker passed with synthetic credentials (exit 0). Packaged native acceptance
passed 21 checks (exit 0), including 151 discovered fixture models, complete
pagination, one discovery per explicit refresh, ten tool turns, model/provider
transitions, restart/resume, fork, compaction/recall, and cancellation. These are
loopback synthetic-provider checks, not live paid-provider inference.
Its refresh-count diagnostic identified the existing app-server startup
worker (`models_refresh_worker.rs`): its immediate forced refresh can overlap a
picker request, so the checker must await startup completion before counting a
requested refresh. No product cache change was needed. The initial checker failed
to isolate model discovery because pinned HTTP bypassed its global fetch seam;
it stopped before inference. Subsequent checks explicitly inject the existing
catalog fetch seam and reject Node HTTP/socket transports. Do not count the
initial external GET as isolated validation or live inference acceptance.

The exact host VSIX `independent-20260917-115805-813/package/azrael-host.vsix`
passed all six isolated host stages (exit 0): inventory, fixture installation,
post-install inventory, namespace contracts, standalone activation and coexistence
with original Codex. Host version is `0.2.1789613920476`, SHA-256
`8d94d9575cf564bd3be8ba1d57eabd5d6194a80974713a98021c7ca72e4190c4`.
All 8,099 original extension files remained unchanged. Prepared-host and fixture
checks do not prove manual visual behavior in the user's existing window.
Evidence: `artifacts/verification/provider-picker-host-v1/check-result.json`,
`artifacts/verification/provider-picker-release-native-v5/result.json`, and
`artifacts/logs/provider-model-picker/{release-accounts-v2,release-native-v5,host-validation-v1}.log`.

Installed that verified host into the normal extension directory, exit 0, with
receipt `artifacts/deployments/independent-20260917-122059-431/deployment.json`
(`installed-reload-required`). Original Codex files and VS Code settings were
unchanged. `-SkipCodexEnvironmentSnapshot` preserved the ongoing account/config
work; no window was launched or reloaded. Run **Developer: Reload Window** after
finishing current work, then open a new chat and choose a model under OpenRouter.
Use the picker's refresh action if discovery is still pending. The source and
all three runtime hashes matched the release before installation; the temporary
diagnostic's line-ending-only drift was restored without bypassing provenance.

Model discovery uses read-only metadata requests and does not invoke inference.
Catalog failures log the provider and closed error code in the existing native
engine log, without credential or upstream response content. The model-list
response carries `providerCatalogs` independently from selectable models.

## Diagnostics and verification

### Google Antigravity

Source integration implemented, 2026-09-17. Google Antigravity uses the OAuth account
already stored by the account page; Google AI Studio API keys remain separate.
The shared managed helper now resolves an account-scoped token/project snapshot
and supports Cloud Code Assist envelopes. Catalog entries use the vendored
configured model catalog and exclude image-output models. A chat-support badge
describes configured runtime/account readiness, not a successful model request.

Live read-only diagnosis returned HTTP 200 from `fetchAvailableModels` with
seven models, including six text candidates and one image model (exit 0;
`artifacts/verification/google-antigravity/live-catalog.log`). Three actual
`gemini-3.8-flash` helper requests then completed with HTTP 200: plain text,
one harmless echo function call, and the exact function result replay followed
by the expected final answer. The probe binding was removed; no other account
state was cleaned. Evidence: `artifacts/verification/google-antigravity/live/results.json`
(exit 0). This covers actual provider/helper tool mapping and signature replay;
it does not establish full native-engine live execution or rendered UI behavior.

Scoped native catalog and picker checks passed (16 Rust and 25 Node tests,
exit 0; `managed-catalog-tests.log` and `picker-tests.log` under
`artifacts/verification/google-antigravity/`). The helper's scoped OAuth,
inference, catalog, reasoning and account suites passed 60 tests / 385 assertions
(exit 0; `scoped-tests-final.log`). This includes token rotation, pinned-account
selection/fork, project or identity changes, missing/reauth accounts, CCA text,
tool/signature replay and failure handling. The initial test exposed internal
wire aliases in the picker; the corrected roster uses configured models or the
vendored picker list rather than model-keyed hint maps.

An actual-state, network-denied source check returned Google Antigravity status
`ready`, six models and account `inferenceConnected: true` (exit 0;
`live/readiness-results.json`). The six entries are Gemini 3.8 Flash, Gemini 3.7
Flash, Gemini 3.1 Pro, Claude Sonnet 4.6, Claude Opus 4.6 Thinking and GPT-OSS 120B
Medium. Only Gemini 3.8 Flash has live inference evidence from this task.
Packaging and installation are tracked separately below when complete.

Release `google_antigravity_20260917_v1` built its engine and bridge from source
and reused the explicitly pinned compatible external code-mode host. Build,
packaged account acceptance, 21 packaged native managed checks and host
preparation passed (exit 0). Initial host acceptance stopped before activation
because its namespace test still required the upstream setting count: the
integrated account manifest already contributes `azrael.sharedEnvironment.repository`
and `azrael.sharedEnvironment.ref`. The test now verifies the exact renamed
upstream setting set plus those two settings and their types/defaults. This
test-only correction does not change the prepared package. Final fresh-state
host acceptance passed all six stages, including standalone/coexistence activation,
with original files preserved (exit 0; `host-final/check-result.json`). Build and artifact hashes:
`artifacts/verification/google-antigravity/package-report.json`.

The packaged engine subsequently completed a real `gemini-3.8-flash` native
turn at low effort, with one exact harmless client dynamic echo and the expected
final answer (script and engine exit 0; `live/native-smoke-results.json`). The
thread was ephemeral and read-only; probe bindings were removed. This verifies
native tool dispatch/result replay, not OS shell or rendered UI interactions.
The harness disabled MCP/apps/plugins for this process, so this does not assert
every external connector's availability. Two pre-inference harness failures
(quoted MCP override keys and inherited management socket collision) were
corrected without changing the package or user settings.

Installed the exact accepted host `0.2.1789633890195` from
`artifacts/deployments/independent-20260917-173052-913/package/azrael-host.vsix`
(SHA256 `ffd28171e4cec956ac83412923595d399aff68ee8759793ffe4ee97a5260f444`)
with environment synchronization skipped, exit 0. Receipt:
`artifacts/deployments/independent-20260917-175632-336/deployment.json`;
log: `artifacts/logs/google-antigravity-package/install.log`. Existing windows
were not restarted. **Developer: Reload Window** applies the installed version;
then open a new chat and expand **Google Antigravity** in the model picker.
Live rendered UI interaction and the other five models remain unverified.

### Managed inference development

The managed-inference extension is implemented in source (2026-09-16), with
deterministic native-engine acceptance. Its contract is
[managed inference and switching](../architecture/azrael-ex.md#managed-inference-and-provider-switching).
Provider bundle schema 2 adds a hashed `inferenceHelper`; host preparation sets
`AZRAEL_PROVIDER_INFERENCE_HELPER` alongside the existing pinned Bun/account
helper environment. Schema 1 historical releases retain accounts-only behavior
and clear any ambient inference helper. A missing or modified schema 2 helper
fails bundle verification. The account badge means the runtime offers model
selection; it does not certify a successful live inference request.

The implementation reuses the pinned Google and OpenAI-chat adapters. Replay
validation includes [Google thought signatures](https://ai.google.dev/gemini-api/docs/generate-content/thought-signatures)
and [OpenRouter reasoning details](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens).
The original native history is preserved; provider-private metadata is projected
only to its valid origin. Representative live-model acceptance remains separate
from synthetic provider fixtures.

Managed engine acceptance (`artifacts/verification/provider-native-20260916-232205`,
19 checks, exit 0) verifies all six directed Google/xAI/OpenRouter transitions in one thread,
A→B→A, dynamic tools, restart/resume, fork, compaction with earlier-result recall,
partial-stream cancellation, and credential exclusion. It also verifies native
OpenAI→managed→OpenAI and Devin→managed→Devin with public tool history preserved,
foreign private metadata excluded from transport, and the Devin account/scope
unchanged. Logs: `artifacts/logs/provider-native-inference/engine-acceptance-10.log`.
The imported code-mode host with the rebuilt engine separately passed eight
deterministic checks (`devin-code-mode-acceptance.log`, exit 0).

Core regression verification completed on 2026-09-17 with 3,736 of 3,743 distinct
targets passing across the clean package run and focused environment repairs;
this is not a fully passing package run. Seven remain unresolved: two MCP
exclusion timeouts, three Windows sandbox staging sharing violations, one
sandbox CLI timeout and one restricted-environment PowerShell startup failure.
The inherited-host run stalled during test termination and has no final exit.
Exact commands, exits and failure evidence are retained in
`artifacts/logs/provider-native-inference/environment-validation.md`. The new
managed selection, turn boundary, binding and catalog regression tests passed.
Workspace-wide tests were not run because the required approval was not received.

Packaging completed on 2026-09-17: `artifacts/releases/provider_native_20260917_v1`
contains the source-verified engine/bridge, imported code-mode host and schema 2
provider bundle. Full build, packaged account/catalog check and isolated
`PrepareOnly` each exited 0. Preparation receipt:
`artifacts/deployments/independent-20260917-003122-650/deployment.json`.
The prepared host VSIX is `package/azrael-host.vsix` beside that receipt,
version `0.2.1789572714697`; its SHA-256 is
`c83acf90fcb860056b281ef15311d0441422328346943c157acb7f8c4babdb92`.
All release hashes are recorded in
`artifacts/logs/provider-native-inference/final-release-hashes.json`.
Preparation intentionally skipped personal Codex environment synchronization;
it did not install or launch the extension. Original settings and extension
inventory were unchanged. Rust lint/fix, formatting and diff checking exited 0;
behavioral tests were not rerun after formatting, following upstream guidance.

The VS Code **Azrael provider accounts** log output records request ID, action,
start/completion/failure and elapsed time. Raw provider errors, stderr, credentials,
login URLs and response bodies are not forwarded into that log. VS Code owns log
rotation/retention. For reports, supply version, timestamp, action and the bounded
matching request records; do not attach account storage or full session history.

Account tests use fake helper peers or original upstream functions with fresh
isolated fixture state. Native inference acceptance additionally exercises the
engine, helper, and tools against synthetic HTTP fixtures. The passing managed
run uses an explicit fetch guard because the vendored provider router canonicalizes
provider URLs. Earlier diagnostic runs reached canonical Google/OpenAI endpoints
with synthetic keys and received HTTP 400/401; those runs were not network isolated.
No real-account inference acceptance or VS Code window activation was performed.
Package inspection and installation do not establish
real-provider correctness. Reload and real-use confirmation remain user steps.

The retained original account controller owns actions/status only; it no longer
creates a separate account webview. The CLI Devin quota helper remains necessary
until an account-scoped replacement is implemented and verified. Existing ACP
session records and prior installed packages are retained for recovery.

## Automated acceptance — 2026-09-16

| Scope | Result |
| --- | --- |
| Extension `npm test` | 67 passed, exit 0 |
| Original-module helper fixtures | 8 passed, exit 0 |
| Provider/Devin host runtime checks | 22 passed, exit 0 |
| Rust `just test -p codex-core devin::native_runtime::tests` | 13 passed, exit 0 |
| Rust `just fmt` | exit 0 |
| Rust `just fix -p codex-core`, then `just fmt` | exit 0; two automatic fixes; unrelated existing warnings remain |
| Fresh engine, bridge and companion build | exit 0 |

Source-test logs are under `artifacts/logs/unified-accounts-20260916`; build logs
are under `artifacts/logs/unified_accounts_20260916`. The release is
`artifacts/releases/unified_accounts_20260916`. Engine and bridge are newly built
from source fingerprint `c7a5984cff5ebf5b30019e0d8b3efe36ced4ac0f8b42c10810fe5a80330fe7d2`.
The code-mode host alone is reused from `root_defer_timer_20260915_3`, with its
path and SHA-256 recorded in `build-info.json`.

The first release passed its exact-release helper check (17 manifest files,
selected/exact dummy-account credentials, exit 0). Its preparation was correctly
blocked before installation when Rust lint modified two expressions after that
build. The `_2` build subsequently detected a concurrent modification to
`codex-api/src/endpoint/responses_websocket.rs` and stopped packaging. The `_3`
build failed with exit 101 while concurrent compaction changes had references to
`ResponseEvent::CompactionProgress` without a matching compiled definition
(`core/src/session/turn.rs:2415`, `core/src/turn_timing.rs:406`). Those changes are
outside the account feature and have been preserved. See
`artifacts/logs/unified_accounts_20260916_3/engine.log`.

The later integrated release `artifacts/releases/devin_native_replay_20260916`
includes these account changes and the [native replay repair](devin-native.md).
It passed the 17-file provider manifest/selected/exact-account smoke check and
prepared-host namespace/runtime/VSIX checks (all exit 0). All 333 account UI
files in the VSIX matched staging. Engine/bridge/companion are fresh; only the
code-mode host is reused from `websocket_recovery_20260916_release`. Current
acceptance logs are under `artifacts/logs/devin-native-repair-20260916` and the
prepared receipt is `artifacts/deployments/independent-20260916-180035-252/deployment.json`.
Installed as host `0.2.1789549265241`, exit 0, without launching/reloading VS Code.
Receipt: `artifacts/deployments/independent-20260916-181325-921/deployment.json`
(`installed-reload-required`). Installed payload/manifest and preinstallation
config preservation checks passed. Reload is user-owned. This record does not
establish live provider correctness.

## Provider handoff and continuation repair (2026-09-18)

Implemented the [provider handoff contract](../architecture/azrael-ex.md#history-projection-and-capability-checks).
Provider changes request a bounded, tool-free plaintext summary from the source
model. Only completed summaries become native checkpoints. Confirmed source quota
failures instead persist normalized public messages and supported tool pairs,
omitting encrypted context and warning about missing earlier detail. Cancellation
and unrelated errors preserve history. Original rollout records are retained.
Local provenance reads use the existing rollout parser because the legacy
`LiveThread.load_history` API rejects paginated threads.

Thread `01a0b28f-6eeb-7f32-8bf6-cbac5d76f3d0` completed 12 Google tool cycles before
`managed model is unavailable`. Continuations had rechecked the mutable discovery
snapshot between tool results and inference. The recorded evidence does not
identify whether the historical snapshot omitted the entry or was removed after
a refresh failure. Both paths are addressed: discovery gates admission rather
than each continuation, and failed refreshes retain last-good entries as stale.
The helper still enforces model/account/credential bindings.

Fresh engine and bridge build/package: `artifacts/releases/provider_handoff_20260918_v2`,
exit 0. The code-mode host is reused from `google_antigravity_20260917_v1`;
its SHA-256 and all output hashes are in `build-info.json`. No installation or
window reload was performed. The obsolete v1 PrepareOnly process was stopped
after v1 failed the paginated-provenance acceptance; its incomplete staging is
not an accepted installation package.

Validation logs: `artifacts/logs/provider-handoff-20260918/`.

- Focused Rust checks: 41 passed, exit 0 (`core-focused-final.log`). These cover
  unchanged projection/provenance helpers, managed catalog/runtime and Devin
  protocol paths; the later paginated read correction is covered by integration.
- Devin Node tests: 34 passed, exit 0 (`devin-tests-final.log`), including same-frame
  finish ordering, rejection of later content/duplicate finish and incomplete EOF.
- Actual engine integration: 29 checks passed, exit 0 (`integration-v3.log`;
  `artifacts/verification/provider-handoff-20260918-v3/result.json`). Covers all six
  directed managed transitions, native OpenAI/Devin boundaries, opaque source
  summary, native and managed quota fallback, mid-tool catalog loss/refresh failure,
  restart, fork, compaction, summary cancellation/retry and no tool replay.
- The tested engine equals the packaged v2 engine byte-for-byte. The tested v1
  managed helper and v2 helper differ only in generated build-path comments;
  exact normalized comparison is recorded in `verified-bundle-equivalence.json`.
- Whole core regression before the paginated correction: 3,760 tests run,
  3,558 passed (3 flaky), 184 failed, 18 timed out, 77 skipped; exit 1
  (`core-all.log`). Failures include namespace/code-mode expectation mismatches,
  missing Windows hook files and timeouts. They were not all independently
  established as baseline failures. Do not claim whole-core/workspace acceptance.
- Formatting and scoped Clippy fix completed with exit 0; no full workspace
  test was run. No live model request was performed.

The validation above records the initial v2 candidate. A subsequent single live
structural capture reproduced the first-request Devin `provider_eof` mechanism:
successful Connect EOS without a protobuf finish field. The separate transport
correction now passes 47 Devin tests; see the
[follow-up diagnosis](devin-native.md#first-request-eof-reproduced-2026-09-18-follow-up).
Post-patch live model acceptance remains pending.
