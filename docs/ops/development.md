# Development

Procedures for building, preparing, verifying and installing the integrated Azrael host. Designs are owned by [architecture](../architecture/README.md); choose the verification scope for a change with the [build playbook](../playbooks/build.md). Results of a specific build or installation belong in its work plan, not here.

## Current state

- **Installed:** the independent Azrael host (`azrael-ex-local.azrael` version `0.5.1791055122471`) in the ordinary VS Code profile, using pinned official UI `26.928.31416` and the provenance-verified Azrael `0.159.3` engine and bridge reused from the approved `engine/` snapshot. The compatible code-mode host is copied from the explicitly pinned official installation. Known Devin and managed-provider exhaustion responses use the native usage-limit classification. Confirmed source quota exhaustion permits provider switching from saved public messages and exact tool results, excludes source reasoning and opaque context, and names the source/destination in the warning. Same-thread, fork and resumed-fork transitions and generic-400/rate-limit negative paths passed isolated native acceptance. The host admits explicit continuation after `usageLimitExceeded` and the exact historical unclassified native `provider_http_400` message, while preserving active-turn attachment, outcome-unknown guards and duplicate-request coalescing. Its native queue adapter retains the enqueue local declaration, and preparation rejects damaged queued-compaction presentation assets. The host produces valid JSON for void send responses and reconciles uncertain delivery against the native user-message identity with bounded history polling, without replaying the send. Accepted steering inputs survive interruption and crashes, and composer submission reconciliation preserves concurrent draft edits. It preserves the LF migration bytes matching existing state and history databases. The model-catalog notification subscription is registered inside the pinned event bus initializer after singleton creation, so Webview module loading does not access an uninitialized event bus. The managed model picker uses the first supported reasoning stage when no valid default or current selection exists, hides reasoning controls for models without stages, and safely formats absent effort labels. The diagnostics package uses a 900-second helper deadline, 915-second shared engine budget and 100-second generation inactivity limit, with temporary content-free transport diagnostics. Current/standalone source regressions, focused provider tests, native context/recovery/accepted-input fixtures and all six isolated host acceptance stages passed. Original Codex `26.930.31730`, unrelated extension registrations and editor settings were preserved during installation. The latest installation record is the newest `artifacts/deployments/independent-*/deployment.json` whose status is `installed-reload-required`; its `releaseDirectory` names the release. A running window keeps its previous host until **Developer: Reload Window**.
- **Computer Use:** the installed host includes its owned Windows Node REPL/Sky payload and app consent owner. Settings → Computer use lists persistent local approvals and supports confirmed revocation. The approval card supports Deny, conversation/always approval and Cancel request. Actual native capture/input/click and recovery, rendered consent/store/revocation, two-window isolation and final-package smoke passed. Read-only process creation is blocked without escalation; the tested ChatGPT/gpt-6.1-sol genuine request failed before tool execution. See the [Computer Use contract](../architecture/computer-use.md) for verified scope and recovery. Keep the installed release directory: runtime paths resolve to its owned payload.
- **Settings package:** the installed host includes the instruction-document settings and provider compaction controls under Personalization. Provider percentages default to 95%, with synchronized slider/input and adjacent save/reset actions. Source tests, six fresh-state provider RPC checks and all six isolated host acceptance stages passed; rendered theme checks and real account 1M admission remain separate.
- **Open AZ-01 release gates:** full screen comparison, Claude live text/tool success, historical state migration and the injected-error matrix. Progress is tracked in the [AZ-01 work plan](<G:/내 드라이브/ObsidianVault/PARA/30 Project/pi-harness/Tasks/Task2/AZ-01-codex-runtime-decoupling/01-plan.md>).
- **Not established:** a fully passing upstream `codex-core` or workspace test suite. Scoped suites pass; the broad core run has known Windows, hook, code-mode, sandbox and timeout failures that are not all attributed. Do not claim whole-suite acceptance.

## Prerequisites

Run commands from the project root in PowerShell 7. Required: the pinned Rust toolchain and MSVC Build Tools, Git, Node/npm, Python 3.11+ (`tomllib`), VS Code's `code.cmd`, and the pristine pinned Codex UI snapshot at `artifacts/upstream-ui/26.928.31416` (or an explicit pristine source at that version). Upstream checks use `just`, `cargo-nextest`, `dotslash` and `uv`; Bazel is under `artifacts/tools/`. Devin native uses an external Node 22.18+; managed providers use the pinned Bun under `artifacts/tools/bun-*`.

## Source and state

- **Engine source:** build and deployment defaults use the imported immutable `engine/` snapshot described by `engine/SOURCE.json`. Ongoing development remains in `artifacts/worktrees/azrael-0.159.3`; importing a selected snapshot does not change that worktree. Preserve detached snapshots referenced by retained releases for their provenance. The `upstream/codex` submodule preserves the legacy `azrael-ex` changes based on `rust-v0.154.0-alpha.6.2`; the older development worktree uses `azrael/runtime-0.157.1`. The installed release may use a detached snapshot when concurrent development changes the default tree. Each release's `build-info.json` records its actual `engineSourceRoot`, and installation verifies the source revision, content fingerprint and binaries against that root.
- **Provider context policy:** the installed host implements provider-specific 95% defaults, pricing-tier gauge state, provider settings and supported OpenAI model capacity up to 1M. Native/pinned-function checks and all six isolated host acceptance stages passed; the exact tested package was installed with original Codex, unrelated extension registrations, editor settings and native configuration preserved. A running window needs **Developer: Reload Window**. Live account 1M and rendered theme checks remain separate. Design: [provider context policy](../architecture/context-policy.md).
- **UI source:** the installed UI and future preparation use the pristine official `26.928.31416` snapshot in `artifacts/upstream-ui/26.928.31416`. The source and preparation scripts are separate from the currently installed UI; source-only validation does not replace packaged-host acceptance or update an installed window.
- **Migration source bytes:** SQLx validates the raw SHA-384 of applied migration SQL. Preserve the existing migration bytes when copying or checking out engine sources; the state `0055_root_resume_reservations.sql` and history `0007_projection_version.sql` require LF, as pinned by the engine source `.gitattributes`. A normalized Git diff can hide a CRLF conversion. Restore the matching source bytes and rebuild rather than rewriting database migration checksums.
- **Native state:** `~/.azrael-ex` holds accounts, sessions, config and logs. It is never build output, is never cleaned by build or install commands, and is preserved across installations.
- **Artifacts:** everything generated lives under the Git-ignored `artifacts/` (`releases/`, `deployments/`, `vsix/`, `logs/`, `verification/`, `build/`, `tools/`). The Rust incremental cache is the source tree's ignored `codex-rs/target/`. `artifacts/latest.json` points to the last successful packaging only; it is not a validation or installation result.

## Build

```powershell
./scripts/build-azrael.ps1 -ReleaseName '<unique name>' `
  -SourceRoot "$PWD/engine" `
  -CodeModeHostPath '<absolute compatible codex-code-mode-host.exe>'
```

A full build compiles the engine and `azrael-bridge` together for `x86_64-pc-windows-msvc`, packages the account module from a fresh `artifacts/build/<release>/companion/` staging copy using its lockfile, and writes `artifacts/releases/<release>/`, `artifacts/vsix/<release>/` and `artifacts/logs/<release>/`. Devin native (`-IncludeDevinNative`) and provider accounts/inference (`-IncludeProviderAccounts`) are included by default. `latest.json` is updated only after packaging succeeds. A build runs no tests and makes no cloud requests.

- **Engine provenance:** the build writes `engine/azrael-engine-build.json` with the source HEAD, a digest of tracked and nonignored untracked file contents (deletions included), target, relevant Rust environment and the engine, bridge and code-mode host hashes. The code-mode host is copied from the explicit `-CodeModeHostPath` and recorded with its original path and hash; discovery by modification time is not used. Because the digest covers every nonignored file, even non-Rust edits in the source tree require a rebuild. If sources change during compilation, the build stops without packaging; rebuild under a new release name once concurrent source edits have stopped.
- **Cache:** a full build can select a dedicated absolute Rust cache with `-EngineTargetDirectory`. This changes compilation storage, not the selected source or provenance; do not select a cache another build is actively using.
- **Reuse:** `-SkipEngineBuild -EngineDirectory '<release>/engine'` reuses an engine bundle only when its receipt matches current sources and binaries; bundles without a receipt require a full build. Add `-CompanionVsixPath '<release>/azrael-ex.vsix'` to also reuse the account package for launcher- or packaging-only work. Reused binaries are never reported as newly built.
- **Failures:** never overwrite a failed release directory; fix the first causal error in its logs and build under a new name. Running releases are never replaced in place.

### Automated build, verification and installation

Status: `current` — the complete automatic flow passed a full engine build, current/standalone source tests, preparation, six-stage host acceptance and installation in the ordinary user profile. Installation success/failure and receipt binding also have isolated fixture coverage. Existing user windows require reload to activate the installed host.

Run the deployment runner from the project root with a new release name and an explicit engine selection:

```powershell
./scripts/deploy-azrael.ps1 -ReleaseName '<unique name>' `
  -SourceRoot '<engine source checkout>' `
  -SkipEngineBuild -EngineDirectory '<verified release>/engine' `
  -OriginalExtensionPath '<installed official Codex directory>' `
  -OriginalAudioPath '<matching installed official audio directory>'
```

For a full engine build, replace `-SkipEngineBuild -EngineDirectory ...` with `-CodeModeHostPath '<compatible codex-code-mode-host.exe>'`. Reusing the internal account package additionally requires `-CompanionVsixPath` and the original build staging `-TypeScriptPath`. The runner passes that explicit TypeScript and sibling pinned VSCE to preparation; it does not choose another release or tool staging by modification time. `-UiSourcePath` defaults to the pinned pristine UI snapshot.

The runner starts the union of current and standalone source tests once, concurrently with the build in its separate account-module staging. Both must succeed before preparation and host acceptance. It then prepares a new package, executes the six acceptance stages with fresh fixture state, rechecks the exact VSIX hash and version, and installs that package. `-VerifyOnly` runs through acceptance without installing in the user profile. Original extension/audio paths must name the currently selected matching versions. `-CodePath`, `-StateRoot`, `-SourceCodexHome`, `-WorkspacePath`, `-ExtensionsDir` and `-UserDataDir` forward their existing owner contracts.

Tracked and nonignored untracked project content, deletions and initialized submodule content are fingerprinted before execution and checked at phase boundaries. Stop source edits during a deployment. Engine provenance is separately verified by the owning build/preparation/installation scripts. A failure blocks subsequent stages; cleanup stops only child processes started by this runner. User windows are not terminated or reloaded. Every release/run/fixture path must be new; retry with a new release name after a failure.

Each run records `artifacts/logs/deploy-<release>/deployment-metrics.json` with actual command exit codes, per-command duration, total wall time, source fingerprint, exact package identity and acceptance result. Separate stdout/stderr logs retain diagnostics. Package staging is `artifacts/deployments/deploy-<release>/package/`, acceptance is `artifacts/verification/deploy-<release>/`, and installation records its exact receipt in `install-result.json` and marks success only after its result and receipt confirm installation of the tested release, package and version. Source/build durations overlap and must not be added to infer total wall time. Keep the current/previous verified release and retained diagnostics under the existing cleanup policy.

`pwsh -NoProfile -File scripts/test-deploy-azrael.ps1` tests the runner with isolated stub owners and real child processes; it never installs in the user's profile. `node scripts/test-project.cjs --area build` includes this regression. Packaged/native/live acceptance remains separately owned.

### Account-module development builds

Run these commands from `extensions/azrael-ex` with the existing lockfile-installed dependencies:

```powershell
npm.cmd run build:incremental
npm.cmd run test:compiled
```

`npm test` and `npm run test:current` combine incremental compilation with the current integrated-host tests. `test:compiled` and `test:current:compiled` run that scope against existing outputs. `npm run test:standalone` checks the retained standalone chat implementation, and `npm run test:all` checks both scopes; their `:compiled` forms omit compilation. The standalone file list is explicit, and newly discovered test files enter the current scope. Tests use four file-level Node workers with process isolation and retain sequential execution inside each file. `npm run test:serial` runs both compiled scopes with one worker for diagnosis. Compile again whenever source, tests, configuration or dependencies change; compiled-test commands do not verify input freshness themselves.

Incremental compilation keeps TypeScript state inside `dist`, reconciles deleted or renamed source/test outputs and repairs missing emitted files. `npm run build` performs a clean compilation; `npm run package -- <absolute VSIX path>` also starts with that clean build. An unchanged build followed by `test:compiled` reuses the compilation. Release packaging retains its clean-build boundary rather than trusting a development cache. Test outputs, build tools and incremental state are excluded from the VSIX.

Release builds record `build-metrics.json` in their existing log directory. Stage names separate compilation/dependency commands, staging, provenance and release/provider work. Records include elapsed time, success/failure and actual command exit codes when a stage executes an external command; failed stages retain their diagnostic logs. Metrics do not replace provenance or payload validation.

From the project root, `node scripts/test-incremental-extension-build.cjs` checks compilation reuse, source edits, stale/missing outputs, asset preservation and output ownership in temporary fixtures using the installed TypeScript. `pwsh -NoProfile -File scripts/test-build-metrics.ps1` (PowerShell 7.4+) checks real command/script failures, exit codes, logs and the release-selection guard in isolated build fixtures. These checks perform no user-profile installation or model calls.

## Prepare, verify and install

```powershell
./scripts/install-azrael.ps1 -ReleaseDirectory '<release>' -PrepareOnly
./scripts/check-independent-vscode.ps1 -HostVsixPath '<prepared azrael-host.vsix>' `
  -FixtureRoot '<new absolute fixture directory>' -StateRoot '<fixture directory>/state' -UseFreshState `
  -TypeScriptPath '<project>/artifacts/build/<release name>/companion/node_modules/typescript/lib/typescript.js'
./scripts/install-azrael.ps1 -ReleaseDirectory '<same release>' -PreparedPackageDirectory '<directory containing independent-prepared.json>'
```

When reusing a companion VSIX, use the TypeScript path from that companion's original build staging directory. When the installed original Codex differs from the pinned UI source, pass its current directories through `-OriginalExtensionPath` and `-OriginalAudioPath`, and pass the pristine preparation source through `-UiSourcePath`. The checker requires matching official Codex/audio versions and verifies the packaged namespace against its actual pinned UI source.

- **Preparation** creates a uniquely versioned host VSIX in `artifacts/deployments/independent-<timestamp>/package/`, applies the pinned UI transforms (namespace, recovery, deferred turn, queue, compaction, provider picker, file-open, file-drop, URL safety), verifies engine provenance and bundle hashes, and validates the Codex environment snapshot without applying it. Preparation does not query or modify the installed VS Code profile. It fails closed if any pinned anchor or expected transform count changes. Source- and rule-addressed asset results are cached under `artifacts/cache/namespace/`; changed rules, TypeScript or asset bytes invalidate entries. Assets requiring no changes use one validated digest index per rules/TypeScript fingerprint; changed assets keep separately validated output entries. Linux executables are omitted from staging and packaging.
- **Local packaging** collects once through pinned VSCE and writes that same validated file set through its pinned yazl dependency. It uses the pinned secret scanner for source, configuration, extensionless files and source maps. Files matching the already hash-verified pristine UI at the same path are trusted by exact SHA-256 comparison. Changed and new text files remain scanned. Generated native binaries and media assets are excluded from text scanning. Every collected disk or generated entry is checked for the exact `.env` filename, matching the pinned rule, including dependency and pristine paths. After that check, VSCE manifest validation runs without repeating its filename rule through a full content scan. Credential checks remain active for changed/new text and generated metadata. Engine provenance, binary hashes and required VSIX entries are checked separately.
- **Host acceptance** runs six stages in one fixture: initial inventory, fixture installation, post-install inventory, namespace contracts, standalone activation with original Codex disabled, and coexistence with original Codex active. It checks native and account activation, account/usage page routing, the same-runtime bridge connection, Windows PATH and PowerShell execution, and that original extension files are unchanged. It performs no login, model request or thread creation. Only the test runner is a development extension; neither host receives proposed-API elevation.
- **Installation** checks the integration marker, payload and host hashes, runtime state paths and current engine provenance, applies the Codex environment snapshot, installs the exact tested VSIX, removes any leftover companion registration, pins the host and updates the desktop shortcut (`-NoLaunch` and `-UpdateDesktopShortcut` are on by default). Original Codex files and registration, unrelated extensions and editor settings are checked for preservation; extension-directory backups and their hash passes are omitted. Registered host/companion paths still must match registry, inventory and package ID/version; invalid or concurrently changed registration stops installation. Unregistered folders remain in place. Receipts record policy `none`, registered directories and skipped folders. Registry and shortcut backups remain enabled. Rollback reinstalls a retained verified host VSIX with its engine release. Session/account data is separate and is not backed up by this installer. The receipt is `deployment.json` beside the package, with status `installed-reload-required`. Windows are never launched, terminated or reloaded; the user reloads after finishing current work.
- **Environment snapshot:** `-SkipCodexEnvironmentSnapshot` preserves the currently configured environment for a binary-only update and does not revalidate it; record configuration hashes before and after when using it. `-SourceCodexHome` selects an explicit source fixture.

Resume a preparation after failure with matching inputs:

```powershell
./scripts/prepare-independent-vscode.ps1 -ReleaseDirectory '<same release>' `
  -OutputDirectory '<same package directory>' -Resume
```

Use the same state, source and environment-snapshot options as the first preparation. Checkpoints verify input fingerprints and completed artifact contents. Incomplete transformations use a fresh stage directory; intact completed namespace or package stages are reused. Changed inputs or damaged completed artifacts require a new output directory. Environment validation is performed again when enabled. Pre-optimization packages have no resume checkpoint.

`preparation-metrics.json` records stage durations and reuse; `.azrael-independent-host.json` records transformation/cache counts; `azrael-host.vsix.metrics.json` records collection, environment-path checking, trust comparison, credential scanning, manifest validation and archive durations. Installation receipts record total and directory-hash durations. Original-extension preservation still hashes every file before and after installation through a shared bounded-concurrency helper; metadata-only caches are not used.

Namespace preparation reads ahead with concurrency four by default. The library's `readConcurrency` option accepts integers from one to eight for scoped comparison; transformation, cache consumption and writes preserve file order. The namespace report separates enumeration, source reads, decoding, source hashes, cache I/O/validation, transformation, output writes and finalization, with a bounded slow-file list. It retains aggregate cache hits/misses and content validation. Summed read latency includes overlapping requests; use `performance.elapsedMs` or `performance.reads.scanElapsedMs` for wall time and `performance.reads.readWaitMs` for ordered-consumer waits. Nested cache/finalization durations and repeated byte counts must not be summed. The library `transformExtension` returns a Promise and its CLI awaits completion or exits nonzero on error. Reader ordering, bounds and failure draining are checked with `node scripts/test-ordered-asset-reader.cjs`; cache and pinned-transform regression use `node scripts/test-namespace-performance.cjs <typescript module> <pinned UI root> [metrics directory]`.

The packaging optimization verification for UI `26.928.31416` / engine `0.159.3` is recorded in `artifacts/logs/packaging-optimization/`: first-cache preparation 478.30 s, cached new preparation 406.76 s, completed preparation resume 51.72 s. All 14,510 asset cache lookups hit on the repeat, with identical transformed asset reports. Repeat and resume measurements overlapped fixture/packaging work, so these are observed machine timings rather than universal speed ratios. The exact cold VSIX passed all six host acceptance stages (`artifacts/verification/packaging-optimized-host/check-result.json`).

Known conditions:

- If VS Code's own updater holds the `vscode-updating` mutex, the standalone stage stops before activation even though the CLI returns 0. Retry when the updater finishes, or point `-CodePath` at a byte-identical portable runtime under `artifacts/tools/`; never patch or stop the updater.
- If a running user engine owns unmanaged authentication, a test engine on the same home exits with `unmanaged authentication is owned by another Codex process`. Keep the user engine and use `-UseFreshState`, which changes only the fixture runtime `codexHome`; never copy credentials or add a product fallback. This verifies isolated connectivity, not concurrent access to live user state.
- Tests that start an app-server must not inherit the host's `AZRAEL_EX_MANAGEMENT_SOCKET`; clear it for the test process.
- Upstream hook fixtures that call `python3` fail with the Windows Store alias; use a task-local `python3.cmd` shim on the child process PATH instead of changing the global environment.
- `just write-app-server-schema` references a missing binary. Regenerate schemas with `just test` on the ignored `schema_fixtures_tests::write_schema_fixtures_from_env` test, setting `CODEX_APP_SERVER_SCHEMA_ROOT` (and `CODEX_APP_SERVER_SCHEMA_EXPERIMENTAL` for the experimental set).

## Rollback and cleanup

Reinstall the previous verified release with the same install command and prepared package; this restores the executable selection, while releases that change state schemas need a separate compatibility review. Keep the currently installed release, the previous verified release and any release still referenced by a running engine or shortcut. Failed builds, fixtures and logs may be removed after diagnosis and handoff. Build and install commands never delete recursively.

## Shared environment sync

The shared bundle lives in the `azrael-environment` repository (local checkout `C:/Users/felre/azrael-environment-share`, published through GitHub Desktop). Set `azrael.sharedEnvironment.repository` and `azrael.sharedEnvironment.ref`, then run **azrael: Sync Shared Environment** (`azrael.syncSharedEnvironment`); `azrael.fetchSharedPlaybook` copies selected `playbooks/` entries into the workspace `docs/playbooks/`. Sync requires `git` and `python` on PATH and uses the user's Git credential helper. Equivalent CLI:

```powershell
node ./scripts/sync-shared-environment.cjs --repo <url-or-path> --ref main `
  --checkout "$env:USERPROFILE/.azrael-ex/azrael/shared-environment" `
  --state-root "$env:USERPROFILE/.azrael-ex" --engine '<release>/engine/codex.exe' --mode apply
```

The receipt is `~/.azrael-ex/azrael/shared-environment/snapshot.json`; a failed commit restores `shared-environment-backups/<timestamp>/previous`. After a killed process, review the backup and remove a stale `shared-environment.lock` manually. Changes apply to new threads only.

The Codex environment snapshot uses `scripts/sync-codex-environment.cjs` with `scripts/azrael-codex-environment.json`; its receipt is `~/.azrael-ex/azrael/codex-environment/snapshot.json`, backups and `recovery.json` are under `codex-environment-backups/`, and its lock is `azrael/codex-environment.lock`. There is no automatic stale-lock deletion or crash-atomic guarantee.

## Message editing and immediate stop

Run `node --test scripts/test-paginated-history.cjs scripts/test-immediate-stop.cjs scripts/test-edit-stop-integration.cjs scripts/test-thread-branch.cjs` from the project root with the pinned pristine UI and installed TypeScript available. These checks execute transformed native functions, asynchronous cancellation fixtures and the asset-cache path without compiling or installing a package. The guarded transforms require one creation and one stop patch in prepared assets.

New persistent conversations use paginated history and `thread/revert` for editing. Existing legacy conversations are not converted by this change. Verify send → immediate stop → edit → resend in a newly prepared host separately; source fixtures do not establish installed behavior.

## Feature checks

Run the checks for the areas a change touches. Each command writes only to the paths it is given; keep logs under `artifacts/logs/<task>/`.

`node scripts/test-project.cjs --area queue --area recovery --log-directory artifacts/logs/<task>` executes the union of queue and recovery source tests with four isolated Node workers. Shared files run once. The individual commands below remain useful for a single area; use the union command when both areas need verification.

The runner accepts repeated `--area` values (`current`, `extension`, `standalone`, `queue`, `recovery`, `ui`, `namespace`, `build`) or repeated `--changed '<project-relative path>'` inputs. `--list` prints the selection without execution. With no selection arguments it reads tracked changes against `HEAD` and nonignored untracked paths. Markdown-only changes select no tests. Shared inputs and unmapped code changes expand to the current local source scope; shared extension inputs also include standalone coverage. Selecting both extension scopes runs one `test:all` command and compiles once. Commands retain stdout/stderr and actual exit codes in a unique directory under the chosen log directory.

The current local source scope discovers root `scripts/test-*.cjs` files importing `node:test`, `scripts/tests/*.test.cjs` and the current extension tests. Build-tool regressions run when that area is selected or its owners change. Engine worktrees are ignored by the project checkout, so use explicit changed paths or their owning verification procedures for engine changes. Engine/provider, preparation and installation acceptance remains separate; automatic source selection does not execute native engine fixtures, login, inference or user-profile installation. For deployment, run the current source scope and the six host acceptance stages against the exact package; standalone implementation changes additionally require its retained scope.

### Host transforms

```powershell
node scripts/test-independent-namespace.cjs '<pristine UI directory>' '<prepared host directory>' '<typescript.js>'
node --test scripts/test-integrated-entry.cjs scripts/test-namespace-source.cjs
node --test scripts/test-image-file-open.cjs scripts/test-pdf-file-open.cjs scripts/test-local-file-drop.cjs scripts/test-url-safety-transport.cjs
node --test scripts/test-deferred-turn.cjs scripts/test-provider-model-picker.cjs
node --test scripts/test-composer-draft.cjs
node --test scripts/test-queue-consumption.cjs scripts/test-send-result-integration.cjs
```

The namespace command validates the completed host's manifests, transformed assets and source-identical integration entry. The separate source command covers wrapper lifecycle/storage/failure fixtures, synthetic transform guards and pinned source compatibility without a prepared host. Keep both scopes for relevant changes; source fixtures do not establish package or live acceptance.

The queue and send-result checks execute the pinned coordinator and composer
together with local storage and transport adapters. They cover failure after
local admission, preparation rejection, uncertain delivery and storage failure.
Set `AZRAEL_PINNED_HOST_ROOT` to the prepared host directory when running
`test-send-result-integration.cjs` to check the packaged assets. A locally saved
input whose dispatch fails stays visible in the queue; use its retry or edit
action for a confirmed failure. Unconfirmed delivery keeps those actions
disabled until native acceptance is established. Reload and exercise this flow
in a user window separately before claiming live acceptance.

After installation, confirm one image link, one PDF link opening in Chrome, and one CSV link in a reloaded chat, and drag one file from each drag source, before treating those behaviors as live-verified.

The URL safety transport logs `azrael_url_safety_transport` (transport, HTTP status, challenge flag, elapsed time or a bounded failure category) to `azrael-ex-local.azrael/azrael.log` in the extension-host log folder; no image URL, body, cookie, token or account ID is logged. A `false` verdict is not a malware diagnosis, and network or service behavior can change.

### Queue and compaction

Provider context policy checks use `node --test scripts/test-provider-context.cjs` for the transformed settings and gauge and `node scripts/test-provider-context-engine.mjs '<absolute engine>' '<new absolute fixture directory>'` for native configuration and policy roundtrips. The native check uses fresh state without login or inference. Design: [provider context policy](../architecture/context-policy.md). Real account 1M admission and live compaction are separate from these fixtures.

```powershell
node --test scripts/test-queue-refresh.cjs scripts/test-queued-compaction.cjs scripts/test-queued-input.cjs scripts/test-queue-consumption.cjs scripts/test-compaction-progress.cjs
```

Engine-side coverage uses the queue extension, app-server queue API and core compaction admission tests through `just test`. Queue skip/start diagnostics use the engine tracing pipeline with IDs and counts only. Design: [queued compaction](../architecture/queued-compaction.md).

### Reload recovery

```powershell
node --test scripts/test-recovery-state.cjs scripts/test-recovery-bridge.cjs scripts/test-fetch-response.cjs scripts/test-queue-consumption.cjs scripts/test-send-result-integration.cjs
node scripts/test-recovery-engine.mjs '<engine>' '<new absolute fixture directory>'
node scripts/test-accepted-input-engine.mjs --engine '<absolute engine>' --output '<new absolute artifacts directory>' --catalog '<source>/codex-rs/models-manager/models.json'
```

Accepted steering inputs are journaled before the engine acknowledges receipt. Interrupt and crash retain pending inputs; an explicit idle resume reconciles them into history without calling the model. Repeated resumes use message IDs to avoid duplicates. The composer clears or restores a submitted draft only while its text and attachments still match the captured snapshot, preserving edits made during asynchronous submission. These paths have automated fixture coverage; keyboard and attachment behavior in a real user window still require manual acceptance after reload.

The engine check uses a synthetic interrupted rollout and a local stalled provider and stops only its own fixture engine; it never uses a real account. Operation in a user window: the status bar and **azrael: 실행 상태 및 복구** show observed thread state and offer refresh and interrupt-then-resume. An unknown prior resume outcome requires reading the conversation and explicitly choosing a new continuation; never clear the `azrael.resumeReceipts.v1` workspace state to work around it. Structured events are in **Output → Azrael Recovery**. Design: [reload recovery](../architecture/reload-recovery.md).

### Root resume reservations

No-build chat verification: `node --test scripts/test-deferred-turn.cjs scripts/test-namespace-source.cjs scripts/test-integrated-entry.cjs` exercises the pinned reducer, source-turn activity projection, per-reservation clock, stale events, history hydration, Codex divider styling and full in-memory host transform pipeline. This does not compile Rust, generate a VSIX, install the host or establish live screen acceptance. Native waiting boundaries are persisted in additive reservation/history migrations; raw migration bytes remain unchanged. The chat uses the optional `rootResumeWait` turn/timeline field and `turn/rootResumeWait/updated` notification.

Engine coverage: root lifecycle, state, app-server-protocol and RPC tests through `just test`, plus mock-SSE checks that the parked root makes no requests and exactly one request after the deadline or selected-child completion. No paid model call is needed. In a user window, **루트 재개 예약** (`azrael.rootResume`) lists reservations; **지금 재개** and **예약 취소** use the displayed ID and revision, so refresh after losing a race. The engine must be running with the root thread loaded for a timer to fire. A reservation blocked by a crash or admission failure needs the conversation reviewed before resume or cancel. Design: [root resume scheduling](../architecture/root-resume.md).

### Accounts

```powershell
node scripts/check-accounts.mjs '<engine>' '<bridge>' '<new state directory>' '<new short socket path>'
node scripts/check-multiwindow-accounts.mjs '<engine>' '<bridge>' '<new directory under artifacts/verification>' '<new short socket directory>'
node scripts/check-management.mjs '<engine>' '<bridge>' '<new state directory>' '<new short socket path>'
node scripts/check-engine.mjs '<engine>' '<new check directory>'
```

These use disposable mock profiles or synthetic local credentials and make no model requests or reset-credit use. The multi-window check starts two engine/bridge pairs on one disposable home and verifies that stopping one leaves the other connected; initialize the first empty SQLite store before starting the second, because simultaneous first-time bootstrap has a separate initialization race. A profile used by another window cannot be removed; finish that work and close its window instead of bypassing the lease. Provider account procedures: [provider accounts](provider-accounts.md).

### Devin collaboration contract

```powershell
./scripts/check-collaboration-contract.ps1 -EnginePath '<release>/engine/codex.exe' `
  -DevinExecutable '<absolute devin.exe>' -StateRoot '<existing azrael state root>' `
  -FixtureRoot ./artifacts/verification/<task> -LogRoot ./artifacts/logs/<task> -AllowUnrestrictedDevin
```

This makes real model requests with existing authentication. It checks the plaintext `azrael_agents` contract across roles, exact Devin variants and child lifecycle (spawn, follow-up, send, interrupt) against app-server receipts. Native Devin inference checks are in [Devin native operations](devin-native.md#validation).

### Configuration pitfalls

- An exact Devin variant such as `agents.default_subagent_model = "devin/swe-2-high"` must not be combined with `agents.default_subagent_reasoning_effort`; the conflict is rejected before role application. Remove the separate effort setting and start a new conversation.
- A Devin child requires Devin authentication, the exact model in the runtime catalog, and a sibling `codex-code-mode-host.exe` when the engine exposes agent tools through code mode. Missing provider state fails explicitly; there is no OpenAI substitution.
