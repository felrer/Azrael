# Development

Procedures for building, preparing, verifying and installing the integrated Azrael host. Designs are owned by [architecture](../architecture/README.md); choose the verification scope for a change with the [build playbook](../playbooks/build.md). Results of a specific build or installation belong in its work plan, not here.

## Current state

- **Installed:** the ordinary VS Code profile has Azrael host `0.5.1791593725316`, engine `0.162.0` and pinned UI `26.1007.21434`. The verified package is `artifacts/isolated/codex-latest-execution-20261009-r7/artifacts/deployments/deploy-codex_latest_20261010_r15_isolated/package/azrael-host.vsix` (SHA-256 `267a3b8713bad0c880a6b67a5938cda0696643da3dcf1ef1b6dc6a804a1af1e3`); its runtime uses the r15 release in that execution directory and state root `C:/Users/felre/.azrael-ex`. All seven native checks and six isolated host acceptance stages passed. Host acceptance used the authenticated VS Code 1.140.0 archive because the installed VS Code updater held its startup mutex; the original updater and working windows were preserved. Installation did not launch or reload a window; Reload Window activates the new host. Original Codex/audio registrations, original extension directory and editor settings were verified preserved. Authentication, configuration and conversation files were not independently fingerprinted before and after installation, and no migration was requested. Evidence: `artifacts/logs/codex-latest-20261009/deploy-final-review/r15-installed-review.json` and `artifacts/logs/codex-latest-20261009/host-activation/archive-check-result.json`. Preserve the actual r15 runtime/package, previous verified timer r12 rollback and any live process, protocol or launcher references; the Window Use launcher still references r7. Retention and cleanup evidence is owned by `artifacts/logs/codex-latest-20261009/cleanup-plan`.
- **Computer Use:** the installed host includes its owned Windows Node REPL/Sky payload and app consent owner. Settings → Computer use lists persistent local approvals and supports confirmed revocation. The approval card supports Deny, conversation/always approval and Cancel request. Actual native capture/input/click and recovery, rendered consent/store/revocation, two-window isolation and final-package smoke passed. Read-only process creation is blocked without escalation; the tested ChatGPT/gpt-6.1-sol genuine request failed before tool execution. See the [Computer Use contract](../architecture/computer-use.md) for verified scope and recovery. Keep the installed release directory: runtime paths resolve to its owned payload.
- **Settings package:** `Azrael 설정` opens the existing native settings panel through its owned command; routing tests and packaged activation pass. The Computer Use page has a managed Computer Use enable switch and separate Window Use allow-all/app approvals. The production section passes native component interactions in both themes; full installed navigation after reload remains separate. The installed host also includes the instruction-document settings and provider compaction controls under Personalization. Provider percentages default to 95%, with synchronized slider/input and adjacent save/reset actions. Source tests, six fresh-state provider RPC checks and all six isolated host acceptance stages passed; provider rendered theme checks and real account 1M admission remain separate.
- **Open AZ-01 release gates:** full screen comparison, Claude live text/tool success, historical state migration and the injected-error matrix. Progress is tracked in the [AZ-01 work plan](<G:/내 드라이브/ObsidianVault/PARA/30 Project/pi-harness/Tasks/Task2/AZ-01-codex-runtime-decoupling/01-plan.md>).
- **Not established:** a fully passing upstream `codex-core` or workspace test suite. Scoped suites pass; the broad core run has known Windows, hook, code-mode, sandbox and timeout failures that are not all attributed. Do not claim whole-suite acceptance.

## Prerequisites

Run commands from the project root in PowerShell 7. Required: the pinned Rust toolchain and MSVC Build Tools, Git, Node/npm, Python 3.11+ (`tomllib`), VS Code's `code.cmd`, and the pristine pinned Codex UI snapshot at `artifacts/upstream-ui/26.1007.21434` (or an explicit pristine source at that version). Upstream checks use `just`, `cargo-nextest`, `dotslash` and `uv`; Bazel is under `artifacts/tools/`. Devin native uses an external Node 22.18+; managed providers use the pinned Bun under `artifacts/tools/bun-*`.

## Source and state

- **Engine source:** the primary checkout's `engine/` holds integrated `0.162.0` source at Git revision `a299dc56ffeba6e2b84284cd3a869a4be4c8379a` (the combined repository candidate includes separately committed work), described by `engine/SOURCE.json`; build and deployment defaults select this directory. The integrated Git bytes include Azrael adaptations and descend from official `rust-v0.162.0`; the importer verifies ancestry and inventory without reapplying older source transformations. Preserve immutable snapshots referenced by retained releases for their provenance. The `upstream/codex` submodule preserves the historical `azrael-ex` Git history. Task worktrees must bring all changes back into the primary checkout and be removed after integration and verification; reusable caches live outside them. Each release's `build-info.json` records its actual `engineSourceRoot`, and installation verifies the source revision, content fingerprint and binaries against that root. Each build freezes its selected source and inputs at start; later checkout edits belong to a later build. A changed frozen snapshot invalidates its receipt. The installed r15 binaries are bound to the immutable `43964513` task source, rather than this combined repository source.
- **Provider context policy:** the installed host implements provider-specific 95% defaults, pricing-tier gauge state, provider settings and supported OpenAI model capacity up to 1M. Native/pinned-function checks and all six isolated host acceptance stages passed; the exact tested package was installed with original Codex, unrelated extension registrations, editor settings and native configuration preserved. A running window needs **Developer: Reload Window**. Live account 1M and rendered theme checks remain separate. Design: [provider context policy](../architecture/context-policy.md).
- **UI source:** current source transforms target pinned UI `26.1007.21434`; preparation reads its pristine official snapshot in `artifacts/upstream-ui/26.1007.21434`. The installed r15 host uses this pinned UI after packaged-host acceptance and installation. Source and rendered-fixture validation do not replace packaged-host acceptance or update an installed window.
- **Migration source bytes:** SQLx validates the raw SHA-384 of applied migration SQL. Preserve the existing migration bytes when copying or checking out engine sources; the state `0055_root_resume_reservations.sql` and history `0007_projection_version.sql` require LF, as pinned by the engine source `.gitattributes`. A normalized Git diff can hide a CRLF conversion. Restore the matching source bytes and rebuild rather than rewriting database migration checksums.
- **Native state:** `~/.azrael-ex` holds accounts, sessions, config and logs. It is never build output, is never cleaned by build or install commands, and is preserved across installations.
- **Artifacts:** everything generated lives under the Git-ignored `artifacts/` (`releases/`, `deployments/`, `vsix/`, `logs/`, `verification/`, `build/`, `tools/`). The Rust incremental cache is the source tree's ignored `codex-rs/target/`. `artifacts/latest.json` points to the last successful packaging only; it is not a validation or installation result.

### Git maintenance and build caches

Build caches must remain outside Git's object database. The root ignore rules cover `target/`, `target-*/`, `.cache/`, `.sccache/`, `.turbo/`, `.parcel-cache/` and `.pnpm-store/` in addition to `artifacts/`. Keep an explicit `-EngineTargetDirectory` outside the checkout or inside an ignored directory; verify a representative child with `git check-ignore -v -- <cache-path>`. Do not force-add cache files.

For this development checkout, automatic maintenance is disabled with `git config --local maintenance.auto false`. This local setting is not carried by a clone. Git's geometric repack includes loose objects even when they are no longer referenced, so ignore rules do not protect cache objects already written to `.git/objects`. Avoid manual geometric repacking until existing cache objects have been assessed. Any removal of existing objects needs a separate recovery-aware cleanup; disabling automatic maintenance preserves them and the build caches on disk.

## Build

### Integrated engine source inventory

Status: `current` in source — explicit local integration recording and strict validation pass recorder and importer tests. Release acceptance remains separate.

Imported engine provenance preserves the original upstream receipt and its fixed distribution/source adaptations. Reviewed local edits require a separate integration record containing the repository revision, source prefix and exact before/after inventory entries. The recorder validates the immutable imported baseline, current tracked source bytes and the explicitly expected delta paths before updating the primary receipt. Ordinary new `.rs` files must be explicitly reviewed and Git-tracked with mode `100644`; localIntegration schema 2 records these additions with `before: null`. Schema 1 remains valid for inventories without additions. Changed source must retain its original inventory Git mode. Unchanged imported files preserve upstream inventory modes even when the primary repository committed a Windows mode normalization; their index modes must match repository HEAD. Previously reviewed additions absent from HEAD retain their receipt mode. Migration SQL changes, removed inventory paths, unreviewed index mode changes, altered adaptation metadata or preserved upstream bytes, unexpected deltas and malformed integration metadata fail validation. Subsequent source edits invalidate the new receipt and prevent packaging or binary reuse. Original upstream identity and the repository integration revision remain distinct.

Use `python -B scripts/record-engine-local-changes.py --destination <primary-engine> --baseline <independent-immutable-import> --baseline-receipt-sha256 <reviewed-original-receipt-hash> --expected-path <relative-source-path>` with one `--expected-path` for each reviewed edit or addition. Paths are relative to the engine root. Initial recording requires the current receipt to match the original import. For subsequent recording, keep the same original immutable baseline and add `--current-receipt-sha256 <reviewed-current-SOURCE.json-byte-hash>`; compute this anchor before recording and after reviewing the prior receipt. List only the new delta since that prior receipt, including previously reviewed files whose bytes changed again. The recorder requires that exact delta, retains cumulative original-to-current changes and original provenance, and rechecks source bytes, receipts, repository HEAD and Git index before publication. A repeated operation with no new delta fails. Stage each changed or added source path when it is not already tracked; staging the receipt is unnecessary for recording. Verify the result with `engine-provenance.py snapshot` before building. Preserve the immutable baseline while current or previous releases reference it.

For explicitly reviewed content changes to a fixed Rust adaptation, add one `--expected-adapted-path <adapted-rust-path>` per new adapted delta instead of listing that path under `--expected-path`. Schema 3 retains the immutable `sourceFixes` recipe, original receipt and `.upstream` inventory, and records cumulative `adaptedChanges` separately: `before` describes the original fixed transform and `after` describes reviewed current content. Validation regenerates the fixed transform from preserved upstream bytes and checks recorded content, original Git mode and permissions. Unlisted adapted drift fails, including content already committed to HEAD. Adapted-only updates may omit `--expected-path`; the exact new adapted delta and reviewed current receipt hash are still required. Recording inherited committed bytes establishes their provenance, independently of feature behavior acceptance. Schemas 1 and 2 retain their fixed-adaptation validation.

When importing a reviewed Git integration that already contains Azrael adaptations, use `python -B scripts/import-engine-source.py --source <integrated-git-checkout> --destination <fresh-immutable-snapshot> --upstream-tag <official-release-tag> --preserve-source-fixes`. This mode requires the pinned official release commit to be an ancestor of the source HEAD before copying. Its `sourceFixPolicy: integrated-git-bytes` inventory preserves those tracked bytes without replaying the older fixed source recipes; ordinary distribution overlays, complete content hashes, source/tag race checks and validation still apply. Preserve the original receipts and immutable snapshots while retained releases reference them. Subsequent primary-source changes require the same explicit local-integration recording described above. Source import validates provenance; it does not establish feature or release acceptance.

### UI source verification result reuse

The preservation runner reuses passing results for explicitly declared UI source checks: URL safety transport, image file open, max reasoning, recent chat filter and missing image. `cacheInputs` in `scripts/azrael-feature-contracts.json` declares each check's repository dependencies. Other source checks and installed-host acceptance continue to execute. Native reuse has a separate contract below.

Each key binds the check command and arguments, owning contracts and dependencies, pristine UI contents, Node executable/version/platform, complete selected TypeScript runtime and effective child environment digest. The runner retains its complete project input checks before and after verification and the package binding checks. Only successful, unchanged runs publish results. Receipts record executed/reused counts and keys; validated cached stdout/stderr are copied into the current run's evidence directory.

`artifacts/cache/verification-results/` keeps one key per check. When inputs change, the old key is removed before the replacement check executes, including when that check later fails. Removed check entries and obsolete cache schemas are collected automatically. Leases protect active readers and writers; uncertain paths and abandoned leases are retained with a reason, and caching is bypassed when unavailable. This cache contains verification evidence, not release binaries or user state. Use `reuseSourceChecks: false` in the runner configuration to force execution.

### Native verification result reuse

Status: `current` in source — native reuse, forced-failure invalidation, shared storage, existing source reuse and deployment gate fixtures pass targeted checks. Evidence: `artifacts/logs/test-reduction/native/`. These fixture checks do not establish a full build, installed-host acceptance or production build-time savings.

`nativeCacheInputs` explicitly declares repository dependencies for provider-context, recovery and accepted-input native probes. Only engine checks using Node and a fresh fixture may opt in. Their passing evidence is stored separately under `artifacts/cache/verification-results/native/`, using the shared evidence hash validation, per-check leases and guarded cleanup. Other native probes always execute.

A native key binds the command template and arguments, check declarations, owners and contract documents, declared helper dependencies, runner/cache implementations, all three engine/bridge/code-mode-host binary contents, model catalog, Node identity, OS release/version/architecture and effective child environment digest. Fresh fixture names and copied release locations do not invalidate otherwise identical inputs. Missing or uncertain runtime inputs bypass caching; failed, corrupt or drifting runs cannot publish passing evidence. Native binary and catalog hashing is shared across the selected probes within one run.

Every run still verifies current source provenance and the complete project input identity before and after checks. Package binding and installation-time identity checks remain mandatory. Reuse copies validated logs into the new run and records `executionStatus`, `executionReason`, cache keys and native executed/reused counts. `timings` separates before/after identity work, child check execution, cache input hashing and lookup from total elapsed time; summed concurrent child time is not wall time.

Set `reuseNativeChecks: false` in the preservation configuration to force native execution. Deployment's `-FullRegression` sets this flag automatically. A forced check revokes an existing pass for that input key under its lease before execution; only a complete passing, unchanged run may publish fresh evidence. Actual installation still requires all six isolated host acceptance stages against the exact final package. Local build/package generation and installed-host acceptance remain distinct operations.

### Module reuse and automatic cache cleanup

Status: `current` — cache contracts, legacy/new deployment tool routing and repeated real release builds pass. The first build took 306 seconds; the unchanged repeat took 94 seconds and reused engine, companion, providers and Window Control. Evidence: `artifacts/logs/modular-build-cache/` and `artifacts/logs/module_cache_20261005_{b,c}/`.

The optional provider-only configuration (explicit account VSIX, Devin excluded) also passed initial/repeat builds, including provider cache reuse without a pre-existing release provider directory. Final acceptance is recorded in `artifacts/logs/modular-build-cache/final-acceptance.json`.

`build-azrael.ps1` builds a complete release while reusing unchanged modules. Engine reuse requires the existing source/binary provenance check and the selected code-mode host hash. Account extension and provider modules use source, lockfile and tool fingerprints plus complete output inventories and hashes. Window Control reuses its recorded executable only when source, build settings and executable hash match. `-RebuildModule companion` forces a selected module; supported names are `engine`, `companion`, `providers`, and `window-control`. Explicit `-SkipEngineBuild` and `-CompanionVsixPath` remain supported.

Managed companion/provider entries live under `artifacts/cache/modules/<module>/<fingerprint>/`. One exclusive build lease prevents concurrent mutation or collection; preparation holds a read lease while using cached TypeScript/vsce. `build-info.json` records module reuse and the TypeScript path, which deployment passes into preparation. Cache corruption or source changes during compilation prevent reuse; failed builds cannot publish a cache receipt.

After a companion/provider module successfully publishes its verified cache receipt, collection immediately removes previous unused entries for that module. The default `-KeepModuleCaches 0` retains only selected, running or installed-tool entries; an explicit positive count retains the configured newest complete entries. Failed publication of a new key leaves previous-key entries intact. Explicit forced or corrupt same-key rebuilds retain their existing replacement behavior. Current build entries, live process references, and tool paths required by the current and previous installed releases are protected. Known legacy companion staging uses the same retention and protection checks. Opencodex-only legacy staging is also discovered, but only its reproducible `node_modules` is collected; source, provenance and notices remain. The engine cleaner also discovers known alternate Cargo target directories and nested worktree-preserved targets; it deletes unused alternate/test/preserved caches even without a version marker. The selected current build target, the reusable primary engine target, explicitly protected paths and live process references are retained. Process-inspection failures preserve candidates. Unknown ownership, inspection failure and linked paths preserve data. `-SkipCacheCleanup` disables collection for a build. Reports live with that build's logs.

The same publication step collects unused known legacy staging, and the final build sweep retries deferred collection. Module and staging cleanup reports accumulate throughout the build rather than overwriting the immediate results.

Namespace asset caching atomically publishes a replacement before deleting older transformed entries for the same asset path, including a transformed-to-no-op replacement. Unrelated entries and old no-op indexes are pruned after the complete namespace scan. Writer leases serialize publication and collection; busy or abandoned leases, linked paths and failed publication preserve previous entries and report deferred cleanup in `cacheCleanup`. A later transformation failure does not restore entries already replaced successfully. Ordinary no-op hints remain batched to avoid rewriting the index for every asset.

Cache collection covers reproducible caches. Successful deployment separately archives compact verification results under `artifacts/logs/verification-evidence/` and immediately removes its completed fixture with `scripts/clean-verification-artifacts.ps1`. Inspect unused fixtures with `./scripts/clean-verification-artifacts.ps1`; add `-Apply` to remove candidates after evidence archival. Use `-IncludeDiagnosedFixtures` only for inactive failed/unknown fixtures whose diagnosis and handoff are complete; this explicit opt-in archives a cleanup receipt even when a success result is absent. For one completed fixture, pass its absolute `-FixtureRoot`. Explicit `-ProtectedPaths`, live process references and retained installed receipts protect in-use paths. Failed fixtures must be removed in the same task after diagnosis and handoff; record a concrete reason and removal condition for any temporary retention. Releases, source snapshots, Git data and user authentication/conversation/settings remain outside automatic collection. Cache collection warnings do not turn a successfully packaged release into a failed build.


```powershell
./scripts/build-azrael.ps1 -ReleaseName '<unique name>' `
  -SourceRoot "$PWD/engine" `
  -CodeModeHostPath '<absolute compatible codex-code-mode-host.exe>'
```

A full build compiles the engine and `azrael-bridge` together for `x86_64-pc-windows-msvc` when reuse checks fail or an engine rebuild is requested. It packages changed account sources from a fresh managed cache staging copy using their lockfile, then writes `artifacts/releases/<release>/`, `artifacts/vsix/<release>/` and `artifacts/logs/<release>/`. Devin native (`-IncludeDevinNative`) and provider accounts/inference (`-IncludeProviderAccounts`) are included by default. `latest.json` is updated only after packaging succeeds. A build runs no tests and makes no cloud requests.

- **Engine provenance:** the build writes `engine/azrael-engine-build.json` with the source HEAD, a digest of tracked and nonignored untracked file contents (deletions included), target, relevant Rust environment and the engine, bridge and code-mode host hashes. The code-mode host is copied from the explicit `-CodeModeHostPath` and recorded with its original path and hash; discovery by modification time is not used. Because the digest covers every nonignored file, even non-Rust edits in the source tree require a rebuild. If sources change during compilation, the build stops without packaging; rebuild under a new release name once concurrent source edits have stopped.
- **Cache:** a full build can select a dedicated absolute Rust cache with `-EngineTargetDirectory`. `-WindowControlTargetDirectory` selects a separate Window Use native cache and forwards its logs into the release log directory. These options change compilation storage, not the selected source or provenance; do not select a cache another build is actively using.
- **Reuse:** `-SkipEngineBuild -EngineDirectory '<release>/engine'` reuses an engine bundle only when its receipt matches current sources and binaries; bundles without a receipt require a full build. Add `-CompanionVsixPath '<release>/azrael-ex.vsix'` to also reuse the account package for launcher- or packaging-only work. Reused binaries are never reported as newly built.
- **Failures:** never overwrite a failed release directory; fix the first causal error in its logs and build under a new name. Running releases are never replaced in place.

### Automated build, verification and installation

Status: `current` — the complete automatic flow passed a full engine build, current/standalone source tests, preparation, six-stage host acceptance and installation in the ordinary user profile. Installation success/failure and receipt binding also have isolated fixture coverage. Existing user windows require reload to activate the installed host.

Run the deployment runner from the project root with a new release name and an explicit engine selection:

```powershell
./scripts/deploy-azrael.ps1 -ReleaseName '<unique name>' `
  -SourceRoot '<engine source checkout>' `
  -EngineTargetDirectory '<absolute shared Rust cache>' `
  -CodeModeHostPath '<compatible codex-code-mode-host.exe>' `
  -OriginalExtensionPath '<installed official Codex directory>' `
  -OriginalAudioPath '<matching installed official audio directory>'
```

A full deployment invokes the engine build once and runs source tests in parallel; do not precede it with a separate full build. Add `-VerifyAccountControls` when a release changes automatic account permissions or timer actions. After build and source checks, this runs the actual release engine and bridge with disposable synthetic accounts before preparation. It requires a passed report for the exact binaries and zero model/reset-credit consumption requests; failures block packaging acceptance and installation. `-EngineTargetDirectory` forwards the explicit absolute Rust cache path to that build. For an unchanged recorded engine bundle, replace the cache/host arguments with `-SkipEngineBuild -EngineDirectory '<verified release>/engine'`; a target-directory override is rejected in reuse mode. Reusing the internal account package additionally requires `-CompanionVsixPath` and the original build staging `-TypeScriptPath`. The runner passes that explicit TypeScript and sibling pinned VSCE to preparation; it does not choose another release or tool staging by modification time. `-UiSourcePath` defaults to the pinned pristine UI snapshot.

By default, the runner selects tests for changed source owners and runs them once alongside the build. It validates the provider-context, recovery and accepted-input engine contracts; preparation validates the complete UI registry and transform report without repeating UI behavioral suites. Add `-FullRegression` to run the current/standalone union and all registered engine/UI regression checks. Selected checks and the build must succeed before host acceptance. It then prepares a new package, executes the six acceptance stages with fresh fixture state, rechecks the exact VSIX hash and version, and installs that package. `-VerifyOnly` runs through acceptance without installing in the user profile. Add `-SkipCodexEnvironmentSnapshot` for a binary-only update that preserves the current Azrael configuration; the runner forwards it to both preparation and installation. Original extension/audio paths must name the currently selected matching versions. `-CodePath`, `-StateRoot`, `-SourceCodexHome`, `-WorkspacePath`, `-ExtensionsDir` and `-UserDataDir` forward their existing owner contracts.

Tracked and nonignored untracked project content, deletions and initialized submodule content are hashed in bounded parallel reads before execution, after the build and immediately before installation (or verification-only completion). All three checks compare actual contents against the same baseline. The redundant whole-project pass after preparation is omitted; exact package identity is still checked before and after acceptance. Stop source edits during a deployment. Engine provenance is separately verified by the owning build/preparation/installation scripts. A failure blocks subsequent stages; cleanup stops only child processes started by this runner. User windows are not terminated or reloaded. Every release/run/fixture path must be new; retry with a new release name after a failure.

Each run records `artifacts/logs/deploy-<release>/deployment-metrics.json` with actual command exit codes, per-command duration, total wall time, `inputChecks` with phase/duration/file count/bytes/content digest and report path, explicit Rust cache selection, source fingerprint, exact package identity and acceptance result. Separate stdout/stderr logs retain diagnostics. Package staging is `artifacts/deployments/deploy-<release>/package/`, acceptance is `artifacts/verification/deploy-<release>/`, and installation records its exact receipt in `install-result.json` and marks success only after its result and receipt confirm installation of the tested release, package and version. Source/build durations overlap and must not be added to infer total wall time. Keep the current/previous verified release and retained diagnostics under the existing cleanup policy.

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
- Full `0.160.0` workspace tests on Windows MSVC also build `codex-voice-host`, which needs GStreamer 1.28 runtime/development libraries and `pkg-config`. Use the [official Windows SDK](https://gstreamer.freedesktop.org/download/download.html) in a fresh ignored tools directory. Its `/portable=1 /CURRENTUSER /TYPE=devel /DIR=<sdk> /VERYSILENT /NORESTART` mode avoids environment and installation registration. Verify the official checksum before execution, then prepend `<sdk>/bin` to the test process PATH and set its `PKG_CONFIG_PATH` to `<sdk>/lib/pkgconfig`. Check GLib, GObject, GStreamer, app and audio module versions before rerunning the unchanged full suite; prerequisite checks alone do not establish a test pass.
- Upstream hook fixtures that call `python3` fail with the Windows Store alias; use a task-local `python3.cmd` shim on the child process PATH instead of changing the global environment.
- `just write-app-server-schema` references a missing binary. Regenerate schemas with `just test` on the ignored `schema_fixtures_tests::write_schema_fixtures_from_env` test, setting `CODEX_APP_SERVER_SCHEMA_ROOT` (and `CODEX_APP_SERVER_SCHEMA_EXPERIMENTAL` for the experimental set).

## Computer Use desktop and window protection

- Selected-window mode is a candidate implementation, not part of the verified installed state above. Validate source contracts and prepared payloads first. Actual behind-window capture, UI Automation, minimized restoration and DIP size macros require an isolated Windows VM or dedicated test session, including before/after cursor, foreground-window and existing-window identities. Do not use the active user desktop to establish this acceptance. Ordinary-profile installation of this mode waits for that gate; a successful compile or mock test does not satisfy it.
- Prefer source, protocol and isolated fixture checks. Physical capture/input tests stay suspended after a reported disappearing pointer or user window until the relevant boundary is understood. Do not reproduce an incident on the user's active desktop. A recovered pointer is left alone; do not change system cursor settings or run cursor restoration commands without a specific user request.
- Before an authorized physical test, record the selected fixture window identity, existing user Code process identities (PID, creation time and executable) and cursor visibility using read-only platform diagnostics. Record the same state after normal completion and cleanup. Stop immediately for missing cursor/window state, unexpected focus or user input; do not repeatedly activate windows. Unknown baseline or failed verification prevents further physical input.
- Launch Code fixtures with a unique user-data directory, extensions directory, workspace and debug port. A port, window title, process name or PID alone does not prove ownership. Before closing through CDP, verify the listening process belongs to that fixture profile and launch, and require exactly one matching fixture workbench. Never close, minimize, reload or relaunch the ordinary project window as test cleanup.
- Prefer graceful turn interruption and normal fixture shutdown. Before each forced termination, recheck the live PID, creation time, executable and fixture-specific command line against the captured launch record. For descendants, verify the live parent chain to that same root and each child's identity. Exclude baseline user processes. If ownership cannot be proven, leave the process running and report it; do not use broad `Code.exe` filters, stale PID lists or an unchecked process tree.
- Retain launch identities, closure/termination commands and selection predicates, before/after state and actual exit codes with the task artifacts. A successful extension-file or settings preservation check does not prove that a running window or the cursor survived. Historical Computer Use evidence lacks those checks, so the reported pointer/window incident remains unresolved.

## UI question disappearance capture

The UI input diagnostic transform targets the three pinned initial assets and uses the existing `log-message` route to the **Azrael** log output. After a package containing the transform is accepted and installed, an existing window must reload before its webview can emit the records. Source tests or a prepared package alone do not activate capture in user windows.

For a disappearance, retain the session link and approximate KST time, then search that window's `Azrael.log` for `[azrael-ui-input]` and correlate with `Azrael Recovery.log`. Conversation mutation records distinguish removal of the last client identity from movement between opening input, server user items and steering items. Queue records describe acceptance visibility and removal persistence; projection records describe opening suppression. Records exclude question contents. Repeated states and event budgets can suppress records, so inspect dropped counts and do not interpret missing logs as proof that a boundary was not reached.

`python scripts/inspect-input-delivery.py --thread <UUID> --host-log '<exact window>/Azrael Recovery.log' --ui-log '<exact window>/Azrael.log' --minutes 60` combines retained native, host and UI metadata. The exporter hashes UI UUIDs to match host references, admits fixed fields only and opens the native log database read-only. `host.user_message_received` confirms arrival at the host boundary, not successful UI rendering.

When comparing receipts with `thread_history_1.sqlite`, use the active rollout lineage. The filename suffix of a reverted rollout is its projection key; the stable session UUID can identify a prior rollout. A checkpoint from the stable UUID must not be compared with the new file's length as if they belonged to one source.

## Rollback and cleanup

Reinstall the previous verified release with the same install command and prepared package; this restores the executable selection, while releases that change state schemas need a separate compatibility review. Keep the currently installed release, the previous verified release and any release still referenced by a running engine or shortcut. Failed builds and fixtures may be removed after diagnosis and handoff, preserving required compact evidence. Release collection is separate from module-cache and verification-fixture collection.

### Legacy release cleanup

After verifying and installing a new version, complete release cleanup in the same task. `scripts/clean-legacy-releases.ps1` previews owned immediate children of `artifacts/releases/` and `artifacts/vsix/`; apply the reviewed selection after confirming actual installation references. Preserve the actual registered extension's runtime paths, current/previous installed release receipts, latest selected release, shortcuts, live processes and active task inputs. Add active task paths or additional profile references using `-ProtectedPaths`; use `-ExtensionsDirectory` for a different VS Code extension registry. A recent directory name or `latest.json` alone does not prove installation.

```powershell
./scripts/clean-legacy-releases.ps1 -ProjectRoot "$PWD"
./scripts/clean-legacy-releases.ps1 -ProjectRoot "$PWD" -Apply
```

Each run writes a uniquely named receipt under `artifacts/logs/legacy-release-cleanup/`; an explicit `-ReportPath` must stay under that owner and must not replace required earlier evidence. Inspect the returned `status`, `errors` and candidate reasons; a zero shell exit code does not accept a `blocked` report. The cleaner checks ownership, absolute containment, nested links and fresh process references before removal, then verifies absence. Unknown ownership or failed inspection preserves the path with its reason; record the condition for future removal. Keep compact package/release identity receipts and exit/result summaries in the log owner, without copying binaries there. Source snapshots, deployment evidence, isolated workspaces, user settings, authentication and conversations are outside this cleaner's scope. Separate installation roots such as `%LOCALAPPDATA%/azrael-ex/releases` require their own ownership/reference verification. Never delete a rollback release based on a failed or unconfirmed replacement installation.

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

The runner accepts repeated `--area` values (`current`, `extension`, `standalone`, `queue`, `recovery`, `ui`, `namespace`, `build`, `settings`, `accounts`, `window-control`, `build-cache`) or repeated `--changed '<project-relative path>'` inputs. The twelve areas retain the eight broad scopes and add four smaller scopes:

| Area | Selected contracts |
| --- | --- |
| `settings` | Instruction/account settings transforms, student design/avatar assets, Pets cleanup, and the three instruction/design extension tests |
| `accounts` | Account/provider UI, account switching, and account/usage/credit extension tests |
| `window-control` | Window/computer-use transforms and approved argument-free host/backend/policy fixtures; live native desktop acceptance remains separate |
| `build-cache` | Module cache, incremental compilation, asset cache/retention and ordered asset reader; deployment mocks are excluded |

Use `node scripts/test-project.cjs --area settings --list` to review a scope, or select several areas to execute their union. Shared tests run once, including overlaps between `ui`, `build` and `build-cache`. Settings/account extension selections share one `build:incremental` preparation and execute only their selected compiled test files. Adding `standalone` retains its five tests in that same run; broad `extension`/`current` scopes retain their existing full partition contracts. Compilation still checks the extension project for shared type errors.

For the smallest source delta, use `node scripts/test-project.cjs --changed-only --changed '<project-relative path>'`. It selects affected CommonJS/TypeScript dependency owners without expanding a whole area. The namespace composition boundary uses declared feature owners to avoid selecting unrelated UI checks. Known dynamic inputs have explicit owners, and student-avatar assets select their roster/copy contract. New, deleted and unmapped inputs require a separate coverage review; operational tests retain their required argument context and optional benchmarks remain excluded. Arbitrary computed imports need an explicit owner mapping.

`coverageStatus: requires-separate-checks` means selected source results alone do not accept the changed scope. Complete the reported owning checks or review before deployment. The CLI exit code describes executed source tests; it does not accept separate native, preparation, installed-host or coverage-review requirements. Without `--changed-only`, shared inputs and unmapped code changes conservatively expand to the current scope, and shared extension inputs also include standalone coverage. With no selection arguments the runner reads tracked changes against `HEAD` and nonignored untracked paths. Markdown-only changes select no tests. `--list` is read-only. Commands retain stdout/stderr and actual exit codes in a unique directory under `--log-directory`.

The current local source scope discovers root `scripts/test-*.cjs` files importing `node:test`, `scripts/tests/*.test.cjs` and the current extension tests. Build-tool regressions run when that area is selected or its owners change. Deployment defaults to Git's changed paths; `-ChangedPath @('scripts/changed-owner.cjs', ...)` selects an explicit delta when earlier unchanged inputs already have sufficient passing evidence. Record the selected paths and reused evidence; this option cannot be combined with `-FullRegression`. Engine/provider, preparation and installation acceptance remains separate; automatic source selection does not execute native engine fixtures, login, inference or user-profile installation. For deployment, run the relevant source scope and the six host acceptance stages against the exact package; standalone implementation changes additionally require its retained scope. Engine snapshot imports require an explicit `--source`; `--check --snapshot-only` verifies the primary `engine/` inventory without an old worktree dependency.

### Host transforms

#### Local session link protocol

The normal-profile installer registers `azrael://threads/<UUID>` under `HKCU\Software\Classes\azrael` with the owner `azrael-ex-local.azrael`. Its deployment receipt records `sessionProtocol.receiptPath`; that configuration pins the URL parser hash and VS Code executable. Custom extension directories and isolated user-data profiles skip registration. No build or source test registers the protocol. Existing `codex` ownership is preserved.

The external launcher reuses VS Code's bundled Node runtime for URL validation and forwards the parsed `/local/<UUID>` route to the Azrael extension. Run `pwsh -NoProfile -File scripts/test-session-protocol.ps1` for command quoting, PowerShell syntax, parser handoff and recovery tests without changing the real registry or launching the editor. This does not establish OS click dispatch or installed-host navigation.

To restore or remove the current Azrael registration, dot-source `scripts/session-protocol.ps1` and call `Restore-AzraelSessionProtocol -ReceiptPath '<recorded sessionProtocol.receiptPath>'`. It requires unchanged ownership and the current receipt; an update restores the previous registration, while a first registration removes only the owned `azrael` key. Preserve the current and previous referenced receipt directories, parser payloads and launch scripts with their deployment packages.

Use the Azrael legacy-link conversion command for an old `codex://threads/<UUID>` link. Conversion validates Azrael session ownership and copies a canonical link; it does not edit conversation records or claim ordinary Codex links.

#### Namespace validation

Run `node --test scripts/test-content-fonts.cjs scripts/test-asset-transform-cache.cjs` for dynamic-content typography, local webfont resource hashes/copying, generated source and stylesheet cache dependencies. Regular/Bold Gyeonggi Batang fonts are bundled from the official webfont archive; Consolas resolves locally. Font/source provenance is in `extensions/azrael-ex/media/fonts/provenance.json`. A source check does not update an installed window.

Run `node --test scripts/test-ui-cleanup.cjs scripts/test-pets-cleanup.cjs scripts/test-asset-transform-cache.cjs` for composer action retirement, placeholder and permission presentation, Pets inventory/host boundaries and their cache dependencies. The checks use the pinned pristine UI and installed TypeScript. Candidate design review uses `node scripts/create-ui-design-preview.cjs`, producing local HTML and SVG under `artifacts/visualizations/azrael-ui-identity/`; it does not select or install an icon family or typeface. Source checks and candidate renders do not establish acceptance in an installed host.

Auto-Review source validation uses `node --test scripts/test-auto-review.cjs scripts/test-asset-transform-cache.cjs` for shared availability, managed/config restrictions, native selection and next-turn submission payloads, preference preservation and preparation cache ownership. `node scripts/verify-auto-review-render.mjs` checks production-transformed pinned native components in light/dark themes and retains results under `artifacts/logs/auto-review-20261007/ui/`; its host hooks are synthetic. This scope is separate from provider reviewer execution, package acceptance and installed navigation; see the [Auto-Review contract](../architecture/auto-review.md).

`node scripts/check-auto-review-engine.mjs` verifies the latest release's engine receipt and current source provenance, then runs isolated public app-server RPCs against a loopback OpenAI Responses fixture. It covers allow, deny, malformed review, routine work, `never`, and explicit manual reviewer selection without live credentials or paid inference. The explicitly scoped `--binary-only` mode pins `use_control_settings_20261007_r2`, verifies all three binary receipt hashes and retains the current-source comparison result. A passing binary-only run accepts only that existing binary's public API; it does not accept changed engine sources, a new package, real account inference or managed organization requirements. After diagnosis and result retention, remove `artifacts/verification/auto-review-20261007-openai` with `scripts/clean-verification-artifacts.ps1 -Apply -IncludeDiagnosedFixtures -FixtureRoot '<absolute fixture path>'`. Retain summaries under `artifacts/logs/auto-review-20261007/openai/`.

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

Manual request isolation uses `node --test scripts/test-provider-context.cjs scripts/test-queued-compaction.cjs scripts/test-queued-input.cjs scripts/test-composer-draft.cjs scripts/test-namespace-source.cjs`. It covers ID-only card requests, active-conversation cache invalidation, inline command custody, raw `/compact` interception, preserved drafts/attachments, duplicate requests and retry. `node scripts/verify-context-compaction-render.mjs` renders the transformed native card/button with pinned React/CSS in light/dark themes and exercises mouse/keyboard actions with synthetic host state; compact evidence is retained under `artifacts/logs/context-compaction/ui/`, and guarded cleanup removes the owned browser fixture/profile. These source checks do not build, install or establish installed-window acceptance.

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

Deferred recovery uses the existing host logger event `azrael_deferred_recovery` with the structured event field `deferred_recovery`. Correlate conversation, turn and reservation IDs with outcomes such as `query_resolved`, `metadata_unavailable`, `metadata_missing`, `query_failed`, `reservation_mismatch` and `applied`. IDs follow the existing sensitive-field policy; metadata pages, conversation content and exception text are not recorded. A query failure leaves the originating clock frozen with an unavailable work duration. A later reservation event can retry; there is no periodic metadata query. Missing local turns apply their pending boundary when normal history loading broadcasts a snapshot.

No-build chat verification: `node --test scripts/test-deferred-turn.cjs scripts/test-namespace-source.cjs scripts/test-integrated-entry.cjs` exercises the pinned reducer with its imported converter, canonical/legacy history lookup, native `turn/started`, authoritative metadata pagination, pending history recovery, terminal-state preservation, per-reservation clocks and the in-memory host transform pipeline. `node scripts/verify-deferred-turn-render.mjs` renders the production React work divider and clock with native CSS in light/dark themes using module-bound notifications, native history lookup and activity projection. It covers missed defer notifications, unavailable work duration, later measured duration and wait-end recovery, an independent resumed turn, delayed history loading and reload. Synthetic host state and an advanced clock are used. Set `AZRAEL_DEFERRED_RENDER_LOG_DIR` to a task-owned log directory when retaining results; the default is `artifacts/logs/resume-timer-fix-20261008/ui/`. The owned browser profile and fixture are removed after verification. These source checks do not compile Rust, generate a VSIX, install the host or establish installed-window acceptance. Native waiting boundaries are persisted in additive reservation/history migrations; raw migration bytes remain unchanged.

Work-segment folding verification: `node --test scripts/test-work-segment-folding.cjs` exercises the current pinned turn source after deferred presentation, including stopped/active eligibility, pending-input exclusions, exact-once transformation guards, namespace accounting and cache/feature registration. `node scripts/verify-work-segment-folding-render.mjs` mounts the native activity body, item partitioner and disclosure with pinned styles in light/dark themes. Verify click, Enter and Space, independent segment preferences through resume/history updates, fixed work duration and a visible waiting/resume divider while collapsed. Pending-request safety is checked through production eligibility; fixture controls do not establish native approval/question-card action acceptance. The harness owns its browser profile and removes it after verification. These checks cover source and native activity rendering; the full turn page, package generation and installed-window acceptance require separate verification.

Engine coverage: root lifecycle, state, app-server-protocol and RPC tests through `just test`, plus mock-SSE checks that the parked root makes no requests and exactly one request after the deadline or selected-child completion. No paid model call is needed. In a user window, **루트 재개 예약** (`azrael.rootResume`) lists reservations; **지금 재개** and **예약 취소** use the displayed ID and revision, so refresh after losing a race. The engine must be running with the root thread loaded for a timer to fire. A reservation blocked by a crash or admission failure needs the conversation reviewed before resume or cancel. Design: [root resume scheduling](../architecture/root-resume.md).

### Accounts

For account-page ticket and automatic-action changes, run `npm run build:incremental` in `extensions/azrael-ex`, then `node --test dist/test/resetCredit.test.js dist/test/usageTicketView.test.js dist/test/usagePresentation.test.js dist/test/usageTimerView.test.js` there and `node --test scripts/test-account-settings.cjs` from the project root. `node scripts/verify-ticket-usage-render.mjs` exercises actual compiled account markup, standalone handlers and embedded shadow-root handlers with synthetic account/usage services. It covers light/dark themes, desktop/narrow widths, disclosure loading, per-ticket two-click selection, retry identity and native row/button theme tokens. Screenshots, compact results and exit receipts are retained under `artifacts/logs/ticket-ui-20261007/validation/`; the owned browser and fixture are removed after verification. This accepts the source/UI path, not installed extension navigation or live ticket consumption.

```powershell
node scripts/check-accounts.mjs '<engine>' '<bridge>' '<new state directory>' '<new short socket path>'
node scripts/check-accounts.mjs '<engine>' '<bridge>' '<new state directory>' '<new short socket path>' --account-controls-only
node scripts/check-multiwindow-accounts.mjs '<engine>' '<bridge>' '<new directory under artifacts/verification>' '<new short socket directory>'
node scripts/check-management.mjs '<engine>' '<bridge>' '<new state directory>' '<new short socket path>'
node scripts/check-engine.mjs '<engine>' '<new check directory>'
```

These use disposable mock profiles or synthetic local credentials and make no model requests or reset-credit use. The `--account-controls-only` route requires the real management bridge and verifies paid timer defaults, automatic-switch/timer enable-disable responses, invalid-profile refusal, and settings across engine restarts. Its `verification.json` is retained in the requested fixture state directory. The multi-window check starts two engine/bridge pairs on one disposable home and verifies that stopping one leaves the other connected; initialize the first empty SQLite store before starting the second, because simultaneous first-time bootstrap has a separate initialization race. A profile used by another window cannot be removed; finish that work and close its window instead of bypassing the lease. Provider account procedures: [provider accounts](provider-accounts.md).

Automatic account switching uses a separate local inference fixture:

```powershell
node scripts/check-auto-account-switch.mjs '<absolute engine>' '<new absolute directory under artifacts/verification>'
node scripts/check-accounts.mjs '<engine>' '<bridge>' '<new state directory>' '<new short socket path>' --auto-switch-only
```

The fixture uses synthetic managed-provider accounts and no remote model service. It verifies same-turn quota recovery after an executed tool, exact tool-result preservation, one effect, unchanged user-message count, private-reasoning removal, bounded candidate exhaustion, generic HTTP/rate errors and cancellation. Reports and request evidence are retained under `artifacts/logs/auto-account-switch/<fixture directory name>/`. This establishes native managed-provider recovery, not live account quota behavior or installed UI acceptance. Permission defaults, identity binding and OpenAI admission are covered separately by source tests. Design: [automatic account switching](../architecture/accounts.md#automatic-account-switching).

The optional `--auto-switch-only` account route sends local loopback inference requests with synthetic ChatGPT profiles. It uses disposable ordinary app-server mode because Azrael host mode prohibits endpoint overrides; the bridge argument is retained for the existing command interface but is not used in this mode. It checks native account notifications, bearer ownership, same-turn recovery, permission restart persistence, disabled/generic-429 refusal and failed durable selection. It does not establish the installed host/bridge boundary. Both fixtures preserve real account state and clean up their synthetic credentials.

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
