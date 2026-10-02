# Development

AZ-01 candidate (2026-09-28): the independent Azrael host uses pinned official Codex UI `26.917.62051` and the Azrael `0.157.1` engine with the integrated account module. The current profile-bound build is `artifacts/deployments/ui-26917-profile-v3/azrael-host.vsix` (`azrael-ex-local.azrael@0.5.1790533138658`, SHA-256 `d4119c48420bbe4db3fdd3330d640e5723baeae2d1999d5676bdc0f6eebe9c81`), configured for `C:/Users/felre/.azrael-ex`. Its packaged recovery diagnostics match the tested source byte for byte; namespace, recovery-bridge 7/7, recovery-state 27/27, native crash/restart fixture, and read-only real-profile PrepareOnly passed. The earlier `ui-26917-profile-v1` exact VSIX passed fresh isolated standalone and original Codex coexistence activation (`artifacts/verification/ui-26917-profile-host-v1/check-result.json`). The final v3 standalone launch reached installation and namespace success, but VS Code's own updater held the `vscode-updating` mutex before extension-host activation; rerun standalone/coexistence when that external lock clears (`artifacts/verification/ui-26917-profile-host-v3/blocker.json`). The authenticated online-backup copy rendered official chat UI. OpenAI `gpt-5.6-luna` completed text and a Full Access file tool call; Devin `SWE-2` completed text and a Full Access file tool call; Claude `claude-fable-5-1` remains rate limited (`artifacts/verification/ui-26917-auth-visual-v1/`). Full screen comparison, Claude live text/tool success, final v3 UI activation, historical state migration, and the injected-error matrix remain open AZ-01 release gates. The user authorized installation before those gates and excluded version rollback tests. The v3 candidate is installed in the ordinary profile with reload required (`artifacts/deployments/independent-20260928-091237-424/deployment.json`); active work windows were not reloaded or closed.

Multi-window account correction installed, 2026-09-13: host `0.2.1789299606624`, release `multiwindow_accounts_20260913_v4`, VSIX SHA256 `EE12B084CF2310943E7AABADEB1227F7237D99F04D4856DD9F705BA92B9F0239`. Shared account usage, serialized credential refresh, exclusive destructive operations, old-exclusive-owner startup recovery and session-scoped window selection are implemented. PrepareOnly and installation passed (exit 0); receipt: `artifacts/deployments/independent-20260913-205608-316/deployment.json`. The installed inventory and runtime paths select this exact host and v4 engine/bridge. Original Codex files, settings and unrelated extensions were unchanged; no separate companion is installed. Existing user windows were not restarted: finish work and reload every Azrael window to replace the older exclusive-lease engines.

Validation passed (all exit 0): full `codex-login` 226/226 before the final API-key compatibility delta, final unmanaged-auth scope 11/11, app-server Azrael scope 6/6, entry/lifecycle checks, final native v4 two-engine fixture and all six installed-host fixture stages. Both native engines/bridges used the same synthetic API-key root, and the first remained responsive after the second stopped with auth unchanged. Standalone and Codex coexistence each observed one fulfilled embedded account connection, changes enabled and no error-state events. Original source and fixture hashes matched across all 8,099 files. No real login, model request or thread was created. Evidence: `artifacts/verification/multiwindow-release-v4-20260913/verification.json`, `artifacts/verification/multiwindow-host-20260913-v4/`, and `artifacts/logs/multiwindow-20260913/` plus `artifacts/logs/multiwindow-host-20260913/`. Scoped `just fix` exited 0 with nine warnings; two affected remove-path guard scopes were then made lexical, and final `just fmt` and upstream diff checks exited 0.

The v4 build/package and current-source checks passed with source SHA256 `b19b2d2d139a4bd739d846e43946ec599ef7030261003fec68058957b82436fb`. Its code-mode host is an explicitly recorded external runtime, SHA256 `fdf360c3a02adce2a29272357d61681bdddc2ab9828a5fa615c4528e4384a23e`, not a source-built binary. Exact V1 handshake, disposable session and a trivial JavaScript cell passed; `external-code-mode-host-compatibility.json` records the limited scope. Earlier attempts were rejected when concurrent model-role source edits arrived; the v2 Windows sandbox V8 archive was unpublished (HTTP 404), before external-host provenance was added. Failed releases/preparations were not installed.

Limits: the native fixture initializes the first empty SQLite store before starting the second live engine; exact simultaneous first-time bootstrap exposed an unrelated SQLite initialization race and remains outside this correction. The empty host fixture validates startup and isolation but does not exercise an on-disk selected-profile write; pure state and entry tests cover that path. Full editor restart changes the session ID and may require selecting accounts again. A profile still used by another window cannot be removed or revoked; never bypass its lease. The requested `felrer00@gmail.com` profile remained active at the final read-only check and was not removed; evidence: `artifacts/logs/multiwindow-20260913/live-removal-status-final.json`. Diagnostic fixtures and logs are retained.

Account recovery fix installed, 2026-09-13: host `0.2.1789291759337`, integrated account payload `0.3.0`. Startup bridge connection now waits through bounded recovery before reporting terminal failure; verified identity gates mutations and Devin requests, and interrupted mutations are not replayed. Profile removal reports confirmed busy, missing-file and permission errors without exposing storage details. Cross-process account leases remain enforced.

Validation passed (exit 0): 39 staged TypeScript tests before the final connection-gating changes, then 11 focused service tests after those changes; one native profile lease lifecycle test and one app-server error mapping test; `just fmt`; fresh engine/bridge build and packaging. Logs: `artifacts/logs/bridge-startup-recovery-20260913/` and `artifacts/logs/account_recovery_20260913/`. Fresh-state installed-host acceptance passed all six stages with original Codex disabled and enabled. A further observation of the actual embedded AccountService connection fulfilled once, enabled account changes and emitted no error-state events. Evidence: `artifacts/verification/account-recovery-host-final-20260913/check-result.json` and `startup-connect-observation-case-normalized/host-result.json` in that directory. Fixture account count was zero; no real login, model request or thread was created. The durable harness now uses eager observation and separate editor user data per phase; its static validation passed.

Exact tested VSIX SHA256: `3A4E8907219A06BAA0A10D576ABDAAC0AB0DF3A4F683A50E0B2292D65149B028`. Installation passed (exit 0): `artifacts/deployments/independent-20260913-185155-631/deployment.json`. Original Codex files, editor settings and unrelated extension inventory were preserved; no separate companion is installed. Existing windows were not restarted and require reload. Live removal of the reported profile remains pending: the previously identified `ai-research` engine still held the account at the final process check. Do not bypass its lease; finish work and close that window before removing the profile. Successful user-reported model requests are separate from this account-management recovery acceptance.

Integrated account UI acceptance, 2026-09-13: payload `0.3.0`, host `0.2.1789286006773`. Thirty module tests passed (exit 0). Exact packaged menu callbacks and lifecycle contracts passed; the live-state attempt opened the account/usage panels but engine startup was blocked by an existing user engine's unmanaged-authentication lease. Fresh-state acceptance then passed all six stages (each exit 0): namespace/package, installation/inventory, standalone with original Codex disabled, and coexistence with original Codex active. No companion was installed in either mode. Both pages and the same-engine bridge/account-list connection passed with zero fixture accounts. Only the fixture runtime JSON `codexHome` changed; no code/binary or original Codex files changed, and no credentials were copied. No login, model request or new thread was performed.

Evidence: `artifacts/verification/integrated-accounts-20260913-fresh-state-v2/check-result.json`, `standalone-host-result.json`, `host-result.json`, and `artifacts/logs/integrated_accounts_20260913/`. Tested VSIX SHA256: `658D5A1A69B81B32806D9DE3FF30857DBA09FF49034990E286F7491DD3C1C81D`. Engine/bridge reused from the prior current-source-verified pair; no Rust rebuild was needed. Live user-state concurrency remains outside this acceptance; do not interrupt the user's existing engine to obtain that evidence.

Installed the exact tested host in the ordinary profile, 2026-09-13. Completion receipt: `artifacts/deployments/independent-20260913-172653-640/completion.json` (exit 0); the separate companion is absent and the integrated host is pinned. VS Code CLI normalized unrelated file-URI drive letters from `c:` to `C:`, causing the initial strict check to fail after host installation. The corrected installer accepts only that normalization for intermediate comparison, rejects other changes, and restores exact pre-install unrelated entries. The bounded finalizer completed registration without reinstalling/overwriting the already-installed host, checked installed changed assets against the prepared package, and retained the interrupted receipt. Original Codex file hashes, unrelated registry objects and editor settings were preserved; the existing same-window shortcut was verified. No user process was stopped. Finish current work, fully close existing VS Code windows, and reopen to release old authentication ownership and load the integrated version.

Cleanup limitation: automatic command approval review rejected removal of bulky extension directories in the first failed and aborted fixtures (`blocked by policy`). Those directories remain alongside diagnostics; the successful fresh-state-v2 fixture and current/previous deployment artifacts are retained.

Same-window installation accepted (2026-09-13): original `openai.chatgpt@26.908.40401` is unchanged; installed `azrael-ex-local.azrael@0.2.1789283489935` and companion `azrael-ex-local.azrael-ex@0.2.0` into the ordinary profile (exit 0). All 8,099 original files, original registry metadata, editor settings and unrelated extension inventory were preserved. The desktop azrael shortcut opens normal VS Code. Existing windows were not terminated or reloaded; finish active work, close any former isolated azrael window using the same account, and run **Developer: Reload Window** in the normal window.

The companion was rebuilt and seven focused tests passed (exit 0); the current-source-verified engine/bridge pair was reused. Final host package: `artifacts/deployments/same-window-candidate-2/azrael-host.vsix`; exact-package preparation verification and installation passed (exit 0). Deployment receipt: `artifacts/deployments/independent-20260913-163623-712/deployment.json`; build/install logs: `artifacts/logs/same-window/` and `artifacts/logs/same_window_20260913/`.

Actual same-window acceptance passed (exit 0): original, azrael host and companion activated together; both sidebars opened; independent contributions and the companion account Webview/runtime/bridge connection were verified against three existing accounts. All six harness stage exit codes were 0, and source/fixture original hashes remained unchanged. Evidence: `artifacts/verification/same-window-20260913-163324-756/check-result.json`, `host-result.json`, and `artifacts/logs/same-window-validation/`. Use normal startup with only the test runner as a development extension; the attempted `--extensionTestsPath` mode exposed only built-ins and could not establish installed-host discovery. Neither product host receives proposed-API elevation. No login, model request, new thread or live multiple-account concurrency test was performed. Automatic command policy blocked recursive deletion of stale task packages and bulky test fixtures; they remain under `artifacts/` with the logs.

Historical separate-window installation acceptance (2026-09-13): installed private generation `%LOCALAPPDATA%/azrael-ex/vscode/installations/20260913-142824-614` and selected it with the azrael desktop shortcut (exit 0). Reused the source-verified engine/bridge and companion from `latest_engine_20260913-132915-462`; no new Rust/VSIX build was required. Fixed a Windows C:/c: module-cache split in the host runtime; the staged TypeScript compile and scoped runtime test passed (exit 0). Final targeted installer/restoration/launcher checks passed (exit 0), including failure selection preservation, path refusals, persistent settings, private pins, environment isolation and unknown-patch refusal. Actual installed host activation and bridge/account-list checks passed (exit 0), with no login or model request. Evidence: `artifacts/logs/independent-azrael/` and `artifacts/verification/independent-azrael-host-20260913-143005-291/host-result.json`.

Original ordinary Codex restoration completed (exit 0); backup: `artifacts/deployments/restore-20260913-143033-512`. Final ordinary settings hash and unrelated extension inventory were preserved; the ordinary companion/runtime patch were removed. Existing ordinary windows were not terminated and require a reload after active work finishes, before opening the separate azrael shortcut. The native `~/.azrael-ex` home is retained. This is installation/host acceptance, not a new model-response or multiple-account concurrency acceptance.

Latest reasoning update (2026-09-13): installed `artifacts/releases/reasoning_20260913` and updated the desktop shortcut. Nine focused Devin catalog tests, scoped Clippy, formatting, engine/bridge build and installation passed with exit 0. The package preserves the current workflow companion. No new mock-account or model-request checks were run; the grouped model and native effort UI await user confirmation. Earlier account/host acceptance below remains evidence for its original artifact set.

Status: implemented with validation limits, 2026-09-13. The engine/bridge build, mock account lifecycle, isolated VS Code host, companion tests, launcher checks and final lint/format passed. Live multiple-account cloud/UI acceptance remains unverified, and the full core regression run did not pass.

## Local image links in Azrael chat

Target: chat links to local images open in VS Code's built-in image preview. The
Azrael host transform is owned by `scripts/inject-image-file-open.cjs` and applied
by `scripts/namespace-azrael-host.cjs`. CSV and other text files retain their
current editor and line/column behavior. The original Codex extension remains
unchanged. Run `node --test scripts/test-image-file-open.cjs` for the host
file-opening contract, then use the standard same-window preparation, host
acceptance, and installation procedure below. Confirm one image and one CSV
link in the reloaded Azrael chat before marking live behavior verified.

## External image URL checks

Partial, 2026-09-16: `scripts/url-safety-transport.cjs` replaces only the pinned
host's POST to `/ecosystem/url_safe` with Node standard HTTPS. It retains native
authentication and the existing strict boolean safety gate. It neither imports
browser cookies nor solves challenges nor downloads rejected images. Explicit
VS Code or environment proxy settings retain the upstream transport.

`node --test scripts/test-url-safety-transport.cjs` passed 14 tests, exit 0.
Evidence: `artifacts/logs/url-safety-20260916/test-offline.log`. Live requests using
the runtime helper reached the service for all four images in thread
`01a0aa36-5373-7ea3-8907-e850163e3680`, returning HTTP 200 and boolean verdicts
`false, true, false, true`. See `artifacts/logs/url-safety-20260916/live-runtime.json`.
The real pinned host `gI.fetchHttp` class with the injector applied also reached
the service with HTTP 200 and `safe: true`, exit 0; auth/config adapters were
isolated, so this is not GUI acceptance. Evidence:
`artifacts/logs/url-safety-20260916/live-injected-host.json`.
These results apply to those checks at that time; a false verdict is not a malware
diagnosis, and network/service behavior may change. An earlier live batch timed
out; failure remained closed, and the subsequent complete batch passed. Initial
installed-host/package acceptance is pending.

The existing extension log records `azrael_url_safety_transport` with transport,
HTTP status, challenge flag and elapsed time, or a bounded failure category. Find
it in VS Code's extension-host log folder under `azrael-ex-local.azrael/azrael.log`.
No image URL, request/response body, cookie, token or account identifier is logged.
There is no new debug setting or separate persistent log store. Use the existing
VS Code log retention and redact unrelated session data before sharing a log.
Requests time out after 15 seconds, response bodies are limited to 64 KiB, and
redirects are not followed. Any error or non-true verdict keeps images blocked.
Build and reinstall through the standard same-window procedure; do not patch a
running installed generation or bypass engine provenance verification.

Deployment remains blocked by concurrent engine source changes. Full build and
release packaging of `artifacts/releases/url_safety_20260916_v2` passed, exit 0;
the v1-built companion payload was reused after source comparison, and the engine
and bridge were compiled normally. Host preparation was interrupted at its phase
time limit; the namespace transformation completed but no finished host VSIX or
preparation receipt was produced. Before a fresh preparation attempt, source
provenance had changed again (verification exit 1). No user installation or
window reload was performed. Evidence: `build-v2-dispatch.log`,
`prepare-v2-interruption.txt`, and `prepare-v3-provenance.log` under
`artifacts/logs/url-safety-20260916/`. Rebuild and run fresh isolated host acceptance
after the concurrent engine work stabilizes; neither the partial staging nor
`artifacts/latest.json` constitutes installation acceptance. Offline validation of
the completed staged namespace passed, exit 0 (`staged-namespace-test.log`): the
transport runtime matches source and exactly one host injection is present.
AST-based comparison of the seven relevant `RG`/`$Xt`/`aZt` declarations across
the three source bundles confirmed the original safety policy is unchanged,
exit 0 (`staged-safety-functions.log`). These are staged-asset checks, not an
installed VS Code test.

## Source and state

`upstream/codex` is a Git submodule pinned to `b5bffd3ec4db487e7e3dec59663875b0ef7b72ca`. Preserve its license and instructions. The release manifest uses `0.154.0-alpha.6.2`, but its committed lockfile uses `0.0.0` for 150 workspace packages. The initial `cargo build --locked -p codex-cli --bin codex` exited 101. Resolving the lock updates those local package versions; no external dependency changes were observed.

The normalized baseline source build completed with exit 0 in 15m41s. Building the initial management connection and bridge also passed (exit 0, 2m48s):

```powershell
Set-Location upstream/codex/codex-rs
cargo build --locked -p codex-cli --bin codex -p codex-app-server-client --bin azrael-bridge
```

The checkout's pinned Rust 1.95.0 toolchain and installed MSVC Build Tools were used. Native development artifacts are `codex-rs/target/debug/codex.exe` and `azrael-bridge.exe`. `just`, `dotslash`, `uv` and `cargo-nextest` were installed for upstream checks; Bazelisk 1.28.1/Bazel 9.0.0 were used for `just bazel-lock-update`, which passed without a MODULE lock change. These results predate the final account implementation and do not establish acceptance of a newly built package.

Current scoped checks passed with exit 0: login 179, app-server/client/backend library tests 357, protocol 302, memory write 41 and TUI event routing 6. The app-server group retained one slow and four `LEAK` runner markers; passing assertions do not establish clean subprocess shutdown for every existing test. A native core turn integration test also passed: account switching remains blocked until turn completion, then admission reopens. Final scoped Clippy and formatting passed without source changes.

The full core crate run exited 1: 3,513 passed, 143 failed, five timed out and 77 skipped. Failures include unavailable `test_stdio_server`/`codex-code-mode-host` helpers, code-mode and hook assertions, Windows shell expectations and timeouts. Both admission tests passed in that run. These results do not establish that every failure is unrelated to the combined checkout changes; full regression acceptance remains incomplete. The entire workspace suite was not run.

The account build uses `--target x86_64-pc-windows-msvc` and writes the pair below `target/x86_64-pc-windows-msvc/debug`, preserving an earlier executable still used by the user's login window. Both binaries must be packaged from the same build. The final build passed with exit 0 (`account-engine-build-4.log`).

Run commands from the project root using PowerShell 7. The launcher binds a matching engine and bridge to one fixed `CODEX_HOME` and creates a fresh editor user-data directory under `azrael/vscode-instances/<instance-id>` for each default invocation:

```powershell
./scripts/start-azrael.ps1 -EnginePath '<absolute matching codex.exe>' -BridgePath '<absolute matching azrael-bridge.exe>' -StateRoot '<absolute dedicated state path>' -PrepareOnly
```

The default state path is `~/.azrael-ex`; default engine and bridge paths are the checkout's debug artifacts. Preparation checks the engine version and writes instance settings containing `chatgpt.cliExecutable` and `azrael-ex.bridgeExecutable`. Existing unrelated editor preferences are preserved. A different selected pair is refused unless packaging intentionally passes `-UpdateEnginePair`; that switch may update only a new instance copy and never rewrites the prior base settings file. Even the version check receives the dedicated `CODEX_HOME`, because upstream startup performs temporary helper maintenance before parsing `--version`.

All editor instances share the fixed native state root while using separate VS Code user-data directories and unique short management sockets. Profile authentication homes live below `azrael/accounts`; native per-profile OS leases prevent two processes from refreshing the same credentials concurrently. The launcher restores caller environment variables and does not alter ordinary VS Code settings, global environment, or ordinary Codex state.

The official extension is copied into the dedicated `azrael/vscode-extensions` directory; the installed source remains unchanged and is never packaged. Preparation requires version `26.908.40401`, package SHA-256 `0DBA4A6ADBF9241788E7B0F8D5032F3536E5DF177FBA1D7E0150254ADAC4C1AE`, and webview asset SHA-256 `0D3E38DBAC570FEFA5A0B0ECEC3522308DF74AA7B1FE538E1EA2490489347DD9`. The two view-container titles, two sidebar view names, and the unique webview app-name token change from Codex to azrael. A separately hash-pinned profile-menu asset adds the account-management entry using the existing open-vscode-command route; its own marker supports upgrading previously branded copies. Internal identifiers, URLs and APIs remain official values. A marker pins the branded result and later preparation refuses unknown or modified destinations.

The companion owns account capture, native OAuth start/cancel, reauthentication, removal, manual switching, pending-switch cancellation and per-profile usage display. Authentication stays in native secure storage, never in the Webview. The official sidebar remains the main product surface. Its settings menu provides the complete native General, Configuration, Personalization, Usage/Billing, MCP, Hooks, Plugins and Account settings; the companion adds account-management entry points without replacing those pages.

### Shared environment sync

The shared settings bundle lives in the `azrael-environment` repository (local scaffold `C:/Users/felre/azrael-environment-share`; publish through GitHub Desktop). Set `azrael.sharedEnvironment.repository` and `azrael.sharedEnvironment.ref` in azrael settings, then run `azrael.syncSharedEnvironment`; run `azrael.fetchSharedPlaybook` to copy selected `playbooks/` entries into the workspace `docs/playbooks/`. The sync requires `git` and `python` on the host PATH and uses the user's git credential helper for private remotes. Equivalent CLI:

```powershell
node ./scripts/sync-shared-environment.cjs --repo <url-or-path> --ref main `
  --checkout "$env:USERPROFILE/.azrael-ex/azrael/shared-environment" `
  --state-root "$env:USERPROFILE/.azrael-ex" --engine '<release>/engine/codex.exe' --mode apply
```

Receipts are written to `~/.azrael-ex/azrael/shared-environment/snapshot.json`; failed commits restore `shared-environment-backups/<timestamp>/previous`. A stale `shared-environment.lock` after a process kill must be removed manually after reviewing the backup. Applied instructions, roles and skills take effect on new threads only.

## Repeatable local build and reinstall

Engine freshness: a full build writes `engine/azrael-engine-build.json` with the actual tracked/untracked source digest, HEAD, target, relevant Rust environment and all three binary hashes. The engine and bridge are source-built together. The compatible installed Codex code-mode host is copied into the bundle and recorded separately with its original absolute path and SHA-256; it is not represented as source-built while the upstream Windows `rusty_v8` asset is unavailable. `-CodeModeHostPath` must select an explicit compatible host; discovery by modification time is not used. Its hash is pinned before compilation and rechecked before packaging. `-SkipEngineBuild` accepts only a bundle whose receipt matches current source contents and binaries. Old releases without receipts require a full rebuild. Changes during compilation stop receipt generation; package copying and deployment recheck the receipt. `latest.json` remains a packaging pointer, now accompanied by the source digest; it is not a feature-validation result. Source digest comparison is conservative and includes all nonignored files in the selected source tree, so even non-Rust changes there can require a rebuild.

An intentional source rollback must also select the matching source tree before using a prior receipt-based engine. Normal deployment never bypasses freshness checks to install an older pair. Restoring backed-up installation files is a separate explicit recovery action; do not relabel an old binary as current.

### Same-window independent extension

Current installation, 2026-09-28: OpenAI account usage diagnostics and shared
network-policy correction release `usage_policy_20260928_v1`, integrated host
`0.5.1790586410674`, prepared VSIX SHA-256
`5e4089ab7ba508bcaf63fc648d7896ffc5b3770194dd51e1f2eb19079575e189`.
The engine and bridge were rebuilt from the active 0.157.1 source. Focused
app-server usage-error tests passed 4/4 and the login policy-ownership test
passed 1/1. A read-only live probe against the previous engine reproduced all
four profile usage failures: the standard quota call succeeded before profile
reads and then failed with `application network policy is unavailable`. The same
probe against the new engine returned usage for all four profiles and retained
the standard quota read after them (`artifacts/logs/usage-error-live-20260928/`).
The isolated host inventory, VSIX installation and namespace checks passed;
standalone activation was blocked by VS Code's `vscode-updating` mutex before
the test runner wrote its result (`artifacts/verification/usage-policy-host-20260928/check-result.json`).
The exact prepared VSIX was installed in the user profile with exit 0, and the
original Codex and unrelated extensions remained unchanged. Receipt:
`artifacts/deployments/independent-20260928-182808-547/deployment.json`.
Running windows were not reloaded; reload them after active work to activate
the new host. Installed UI activation remains unverified until that reload.

Previous installation: reasoning-selector release `reasoning_selector_20260928_v1`
with host `0.5.1790576944691`; evidence and limitations are in
`artifacts/deployments/independent-20260928-155347-207/deployment.json`.

Earlier installation, 2026-09-18 (Devin catalog follow-up): release
`devin_catalog_20260918_v1`, host `0.2.1789717006271`, tested/installed VSIX SHA256
`8b155a46aa6b65e3a436c056532e1f371547b47982c08eb3f7e065f2242982dc`.
Fresh engine/bridge; compatible code-mode host and companion payload reused.
Catalog tests (13), actual-engine checks (4), preparation, all six isolated host
stages and installation passed with exit 0. Receipt:
`artifacts/deployments/independent-20260918-165356-571/deployment.json`.
Original Codex, settings and unrelated extensions unchanged; standard environment
snapshot applied. No user window was reloaded. Reload all Azrael windows to
activate. This supersedes the installations below; see
[catalog failure diagnosis](devin-native.md#catalog-unavailable-after-tools-2026-09-18-follow-up)
for evidence and live-acceptance limits.

Earlier installation, 2026-09-18: provider handoff/managed continuation/Devin EOS
repair, release `provider_handoff_20260918_v6`, host `0.2.1789710678043`.
The source-verified v2 engine/bridge and companion were reused, with the final
Devin helper packaged anew. Preparation, runtime bundle checks, all six isolated
host stages, and installation passed (exit 0). The tested/installed VSIX SHA256 is
`23846fb58ce3b929bb9a185006faf7bec7d683284609a4cd8134e42044fb4784`.
Receipt: `artifacts/deployments/independent-20260918-150534-429/deployment.json`.
Acceptance: `artifacts/verification/provider-handoff-host-20260918-v6/check-result.json`.
Original Codex, editor settings and unrelated extensions were unchanged; the
standard environment snapshot was applied. No user window was launched or
reloaded. Use **Developer: Reload Window** after finishing active work.
See [Devin diagnosis and scope](devin-native.md#first-request-eof-reproduced-2026-09-18-follow-up)
for the live reproduction and remaining regression limitations. This supersedes
the earlier installation records below.

Earlier installation, 2026-09-15: recent-chat workspace filter host `0.2.1789395492233`, release `recent_chat_filter_20260914`. The source-verified existing engine bundle was reused; packaging, preparation, focused namespace acceptance, all six fresh-state host-acceptance stages and installation passed with exit 0. The exact installed package retains one guarded Webview `recent_threads` marker and one host-bridge marker-removal/`cwd` injection. Original Codex, editor settings, unrelated extensions and running windows were preserved. Preparation receipt: `artifacts/deployments/independent-20260914-231740-027/deployment.json`; installation receipt: `artifacts/deployments/independent-20260914-233949-114/deployment.json`; host acceptance: `artifacts/verification/recent-chat-filter-20260914-2/check-result.json`. **Developer: Reload Window** activates the installed version; live user-state visual acceptance remains pending. This supersedes the root-resume installation recorded under [Root resume reservations](#root-resume-reservations).

Reinstalled 2026-09-14: release `artifacts/releases/azrael_environment_review_final_20260913`, integrated host version `0.2.1789314820423`. Preparation, fresh-state standalone/same-window acceptance (all six stages), and installation passed with exit 0. The installed package hash matches the tested VSIX; installed runtime selects that release's engine and `C:/Users/felre/.azrael-ex`. The environment snapshot was applied, the shortcut updated, and original Codex files, editor settings and unrelated extensions remained unchanged. Existing windows were not launched, terminated or reloaded; use **Developer: Reload Window** to activate the newly installed version. Installation receipt: `artifacts/deployments/independent-20260914-012126-478/deployment.json`. Acceptance: `artifacts/verification/environment-reinstall-20260914-v2/check-result.json`; logs: `artifacts/logs/environment-reinstall-20260914/`. The first fixture was preserved after the tool execution limit interrupted its parent following standalone success; the detached second attempt completed all checks. This installation supersedes the review-time “not installed” status recorded below.

Multi-window account verification uses `node scripts/check-multiwindow-accounts.mjs <engine> <bridge> <new absolute directory under artifacts/verification> <new short absolute socket directory>`. It starts two engine/bridge pairs against the same disposable native home with synthetic local credentials, checks both account connections, then verifies that stopping one pair leaves the other connected. It does not use user credentials or issue model requests. JSON and stderr evidence remain in the fixture; capture command output separately under `artifacts/logs/`. The shared RPC/process helpers live in `scripts/lib/azrael-rpc-check.mjs` and are also used by the existing management check.

Single-extension integration approved and verified in the fixture on 2026-09-13; see acceptance above. `azrael-ex-local.azrael` embeds account and usage UI. The old `azrael-ex-local.azrael-ex` companion is no longer a required installation. The internal account payload is version 0.3.0+; `azrael-ex.vsix` in a release remains a build input, not an extension to install manually. Existing `~/.azrael-ex` state and the matching engine/bridge pair are preserved.

```powershell
./scripts/build-azrael.ps1 -SkipEngineBuild -EngineDirectory '<source-verified engine directory>'
./scripts/install-azrael.ps1 -ReleaseDirectory '<verified 0.3.0+ account payload release>' -PrepareOnly
./scripts/check-independent-vscode.ps1 -HostVsixPath '<prepared azrael-host.vsix>' -FixtureRoot '<new absolute fixture directory>' -StateRoot '<same fixture directory>/state' -UseFreshState
./scripts/install-azrael.ps1 -ReleaseDirectory '<same verified release>' -PreparedPackageDirectory '<directory containing independent-prepared.json>'
```

Preparation creates a new, uniquely versioned host package containing native chat, account module and its production dependencies. The installer checks the integration marker, payload and host hashes, runtime state paths and current engine provenance. It installs the exact tested host, removes any previous companion registration through VS Code, and pins only the integrated host. Original Codex files/registration, unrelated extensions and editor settings are preserved and checked. Previous azrael installation directories/registry records remain backed up for recovery. No user window is terminated or forcibly reloaded; finish current work and run **Developer: Reload Window** to load the integrated extension. The azrael shortcut continues to open normal VS Code.

Preparation runs `scripts/sync-codex-environment.cjs --mode validate` with `scripts/azrael-codex-environment.json`; `PrepareOnly` does not apply the environment snapshot. Normal installation applies it after package checks, before VSIX installation, and records that separate result in `deployment.json`. Only the approved ordinary Codex instructions, roles, agent defaults, personal skills, plugin/app activation, follow-up queue and supporting runtime paths are selected. Existing Azrael root model, reasoning, model catalog, project/sandbox policy, credentials and session state remain authoritative. Python 3.11+ `tomllib` handles complete TOML values in UTF-8; generated formatting is canonical and comments are not retained. Enabled plugins are materialized from Azrael-local marketplace snapshots. The receipt is `~/.azrael-ex/azrael/codex-environment/snapshot.json`; prior targets and a pre-commit recovery map are retained under `~/.azrael-ex/azrael/codex-environment-backups/`. An unchanged result requires matching source inputs and all managed files/directories/junctions; missing or changed payloads are repaired. Concurrent changes detected before commit cause a retryable failure. Handled errors restore moved targets. After forced termination, inspect `recovery.json`, previous targets and `azrael/codex-environment.lock` before recovery; no automatic stale-lock deletion or crash-atomic guarantee is provided. A later VSIX failure retains the successful environment receipt and its recovery backup. `-SourceCodexHome` is available for an explicit source fixture. `-SkipCodexEnvironmentSnapshot` is only for a test fixture that intentionally excludes this contract.

`devin_swe2_medium` is generated from `sol_executor` on every snapshot, with byte-identical effective developer instructions after TOML parsing and exact model `devin/swe-2-medium`. Trailing Sol role fields are not part of the copied instruction string. The exact variant receives no additional Codex reasoning-effort override. It is explicit-selection only. Validation must distinguish role/config discovery from an actual child request: live spawn additionally requires Devin CLI authentication, the exact model in the runtime catalog, unrestricted execution for the native CLI, and a sibling `codex-code-mode-host.exe` when the selected engine exposes agent tools through code mode. Missing provider state or helper binaries must fail explicitly; do not substitute Sol/OpenAI.

Environment implementation review, 2026-09-13: corrected semantic TOML merging/UTF-8 handling, complete artifact drift detection and repair, source/destination concurrency guards, filesystem-alias boundaries, account-resolved skill links, validation-only preparation, narrow exact-Devin effort handling, and explicit external host selection. Focused snapshot tests passed 9/9, provenance tests 10/10, and four role regressions passed (all exit 0). The disposable fixture confirmed validate without creating state, apply, unchanged, deleted copied-skill repair, and concurrent edit rejection (expected exit 1 with the edit retained). New-engine live child execution passed (exit 0), with exact `devin/swe-2-high` independently present twice in engine logs; disabled-provider execution failed explicitly (expected exit 1). An empty source `brainstorming` description is reported as a warning; LAIO still needs its own authentication. Evidence is under `artifacts/logs/codex-environment-review/`.

Reviewed release: `artifacts/releases/azrael_environment_review_final_20260913`, full engine/bridge build and packaging exit 0, source SHA-256 `b19b2d2d139a4bd739d846e43946ec599ef7030261003fec68058957b82436fb`. Its engine and code-mode host hashes exactly match the live-tested reviewed binaries. The prior verified internal account VSIX and explicit host were reused. The interrupted installation was stopped during review; this release has not been installed, and no new same-window VSIX acceptance is claimed. Superseded preparation was stopped when test-only formatting changed the source fingerprint. Automatic command review blocked recursive cleanup of `artifacts/deployments/environment-review-prepared-20260913`; that unreferenced preparation and review fixtures remain for closeout, not as installed artifacts. The earlier full-core-suite limitations above still apply.

Validation uses one fixture with original Codex and the integrated host, with no companion installed. It first launches with original Codex disabled to prove standalone activation and page routing, then relaunches normally to verify coexistence. Only the test runner is a development extension; neither real host receives proposed-API elevation. Verify native/account activation, both account and usage pages, menu command routing, same-runtime bridge connection and original preservation. No login, model request or new thread is part of this installation lane. Previous two-extension packages and separate-window installations are historical recovery evidence, not acceptance of the integrated path.

If an active user engine owns unmanaged authentication, another test engine using that home exits with `unmanaged authentication is owned by another Codex process`. Preserve the user engine. Record exact-package menu/panel results separately, then use `-UseFreshState` for a fresh fixture-only home and bridge acceptance: change only the installed fixture runtime JSON `codexHome`, preserve before/after records, and keep all code/binaries unchanged. Do not copy credentials or add a product fallback. This establishes isolated engine connectivity, not concurrent access to the user's live authentication state.

### Independent azrael installation

This section describes the historical separate-window installation. The same-window independent extension above is the new default.

Approved 2026-09-13: the default installer now selects a separate azrael installation. Share the VS Code executable only. Keep ordinary VS Code settings/extensions and `.codex` separate from azrael's persistent `%LOCALAPPDATA%/azrael-ex/vscode/user-data`, immutable `installations/<timestamp>/extensions`, and existing `~/.azrael-ex` native state. Existing editor settings in the isolated profile are preserved. Each extension host creates its own private runtime/socket; no caller environment is inherited for Codex home selection.

```powershell
./scripts/install-azrael.ps1 -ReleaseDirectory '<verified release directory>'
```

This installs and opens a separate window, and updates the backed-up `azrael-ex.lnk` desktop shortcut. `-NoLaunch` installs without opening a window. `-PrepareOnly` stages and verifies the host without companion installation, shortcut changes or selecting it as current. Omitting the release reads `artifacts/latest.json`, which still means packaging success only. Installation validates source provenance and artifact hashes. `-Target Existing` is retired. `install-existing-vscode.ps1` remains only for legacy regression fixtures below `artifacts/verification` and refuses ordinary deployment.

When an older azrael generation still owns the persistent editor profile, finish its work and close azrael windows before reopening the updated shortcut. The launcher refuses to forward a new generation to the old process; it never kills that process. Ordinary VS Code may remain open throughout.

After isolated host verification, migrate an earlier ordinary installation with:

```powershell
./scripts/restore-original-codex.ps1 -PrepareOnly
./scripts/restore-original-codex.ps1
```

Restoration checks pinned pristine hashes and every installed patched file against its recorded deployment before any writes. It backs up files and extension registry under `artifacts/deployments/restore-*/`, restores original files, removes azrael-only files and the ordinary companion, and clears the azrael-added update pin. Unknown changes stop restoration. It never changes ordinary `.codex` or editor settings, and never terminates existing windows. Finish active work and reload ordinary VS Code to use restored Codex and release the previous azrael engine/account lease before opening the azrael shortcut. The original backup and restoration backup are retained; a failed partial restoration may be rerun after resolving its reported cause. The backup's `restoration.json` identifies the former companion VSIX and exact source installation for manual recovery.

To return to a prior installed azrael generation, point the desktop shortcut at `launch-installed-azrael.ps1 -ManifestPath '<prior installation.json>'`. Keep current and prior generations/releases while referenced; no recursive cleanup is performed automatically. The fixture `start-azrael.ps1` remains available for protocol/host tests, separate from the persistent user launcher.

### Historical existing VS Code deployment

The following records describe the retired ordinary deployment, not current installation instructions.

Current release, 2026-09-13: `artifacts/releases/latest_engine_20260913-132915-462` was built from current sources without engine reuse and installed successfully (exit 0). Source SHA-256: `2765aaa5de7a92449efa7de5899a701101d4b152593bdc151447d227ac0fd701`. Ten provenance guard tests passed. Actual `model/list` verification passed: SWE-2 exposes medium/high/max in one group, Claude Opus 5 ordinary/Fast expose low/medium/high/xhigh/max, and their exact effort aliases are hidden. Legitimate ungroupable variants remain visible. Evidence: `artifacts/logs/latest_engine_20260913-132915-462/devin-model-groups.log`. Post-install actual ordinary-window bridge acceptance also passed (exit 0): current OpenAI account/three profiles and Devin login verified against the same latest engine instance. Evidence: `artifacts/logs/latest_engine_20260913-132915-462/actual-window-bridge-readonly.json`. Older installation evidence below describes the earlier engine and does not establish source freshness.

Installed 2026-09-13 into the ordinary default profile using release `ordinary_vscode_20260913_130920`. Staged build and 29 tests passed (exit 0). The user requested immediate installation before the ordinary host fixture completed; Subsequent actual ordinary-window connection acceptance passed (exit 0): both installed extensions activated, the expected engine/bridge pair ran under extension host 49404, account list matched the same instance/home with three profiles, and Devin reported logged in. Evidence: `artifacts/logs/ordinary-vscode/actual-window-bridge-readonly.json`. No model request or login mutation was performed. Direct official file application and companion CLI installation succeeded (exit 0), and the installed inventory retained all four prior extensions. This was the former default; the same installer command now selects independent installation:

```powershell
./scripts/install-azrael.ps1 -ReleaseDirectory '<verified release directory>'
```

The retired ordinary target used the default VS Code profile with pinned `openai.chatgpt@26.908.40401` and companion. Its private host runtime is reused in the independent installation. Windows local execution is supported; Remote/WSL Codex execution explicitly fails rather than mixing a Windows engine with a Linux home.

`artifacts/deployments/<timestamp>/` contains the prepared official files, `previous-files/` backup, before-inventory and `deployment.json`. `artifacts/deployments/original-official-26.908.40401/` retains the pristine source required for subsequent updates. The deployment receipt identifies the selected release and state home. Do not delete either the original backup or a currently referenced engine release. Only the nine changed official files are copied into the installed extension; the unchanged 1 GB bundle is not recompressed. The companion uses normal VSIX installation.

The former ordinary deployment required **Developer: Reload Window**; after migration, the normal VS Code shortcut opens original Codex and the azrael shortcut opens the independent installation. The installer never terminates user windows or ongoing work. Installation and a required reload are reported separately.

The former installer backed up `azrael-ex.lnk` and made it open ordinary Code; independent installation replaces that shortcut target. The normal VS Code shortcut is unchanged. By default the installer does not open or replace a workspace.

Historical ordinary recovery used a prior verified ordinary-compatible release; new installations use the independent-generation recovery above. The receipt lists the previous changed files. After closing the relevant VS Code windows, restore those relative paths from `previous-files/`; remove only patch files that did not exist before that deployment. The pristine official backup is retained under `original-official-26.908.40401`. Reinstall the matching prior companion VSIX from its release and reload. Existing isolated releases remain available for explicit fixture use. The installer does not write editor settings or ordinary `.codex` data.
An old release's embedded launcher may predate ordinary-source redirection. Use the current `scripts/start-azrael.ps1` with that accepted engine/bridge pair and `-OfficialExtensionPath artifacts/deployments/original-official-26.908.40401` (absolute path), or package it with the current scripts. Do not run an old source-hash-only launcher against the now-patched ordinary extension.

Verified 2026-09-13: PowerShell parsing, artifact ignore rules, accepted engine/VSIX reuse packaging, direct packager default path, matching manifest hashes and isolated `PrepareOnly` passed with exit 0. Duplicate release names correctly failed with exit 1. Project-local release `artifacts/releases/workflow_candidate_20260913_1141` was reinstalled with exit 0 and selected by the desktop shortcut. Logs are under `artifacts/logs/workflow_candidate_20260913_1141/`. No fresh Rust/npm build was performed for this workflow change; the reused binaries preserve their earlier acceptance scope.

Run these commands in PowerShell 7 from the project root. Prerequisites are the pinned Rust toolchain and MSVC Build Tools, Git, Node/npm, VS Code's `code.cmd`, and the installed official Codex extension version pinned by the launcher. A build performs no tests or cloud requests; choose verification using the [build playbook](../playbooks/build.md).

Companion dependencies and compilation run in a fresh `artifacts/build/<release>/companion/` source copy, excluding existing `node_modules`, `dist` and nested artifacts. This prevents rebuilds from deleting native modules loaded by running extensions or verification helpers. Keep the staging directory while validation uses it; it is disposable after validation and reference checks. The Rust incremental cache remains unchanged.

Build the engine/bridge together and package the companion using its lockfile:

```powershell
./scripts/build-azrael.ps1 -CodeModeHostPath 'C:/absolute/verified-runtime/codex-code-mode-host.exe'
```

The command writes a new `artifacts/releases/<timestamp>/` and updates `artifacts/latest.json` only after packaging succeeds. Logs are in `artifacts/logs/<timestamp>/`; generated VSIX packages are in `artifacts/vsix/<timestamp>/`. Rust defaults to the `upstream/codex/codex-rs/target/` cache and the explicit `x86_64-pc-windows-msvc` target. `-SourceRoot 'C:/absolute/source-checkout'` selects another Codex source checkout for compilation and package provenance checks, leaving `upstream/codex` untouched; that checkout must contain `codex-rs/Cargo.toml`. The current preparation and installation scripts still verify against `upstream/codex`, so an alternate source build is for isolated validation until the independent packaging migration is complete. The whole root `artifacts/` directory is ignored by Git. `latest.json` selects a built package, not a tested or installed one.

For companion-only work, explicitly reuse a previously verified engine pair:

```powershell
$previousRelease = (Get-Content ./artifacts/latest.json -Raw | ConvertFrom-Json).releaseDirectory
./scripts/build-azrael.ps1 -SkipEngineBuild -EngineDirectory (Join-Path $previousRelease 'engine')
```

For launcher/package-only work, also reuse the verified VSIX. This copies existing binaries; it does not build current engine or companion source:

```powershell
./scripts/build-azrael.ps1 -SkipEngineBuild `
  -EngineDirectory (Join-Path $previousRelease 'engine') `
  -CompanionVsixPath (Join-Path $previousRelease 'azrael-ex.vsix')
```

Delegate the chosen verification. A bounded preparation check uses a fresh, project-local state directory and does not install the companion or open VS Code:

```powershell
$candidate = (Get-Content ./artifacts/latest.json -Raw | ConvertFrom-Json).releaseDirectory
$checkRoot = Join-Path (Get-Location).Path ('artifacts/verification/' + [guid]::NewGuid().ToString('N'))
./scripts/install-azrael.ps1 -Target Isolated -ReleaseDirectory $candidate -PrepareOnly -StateRoot $checkRoot
```

After verification, reinstall the selected package and open a new isolated azrael window. This verifies the manifest hashes, installs the companion with `--force`, and selects that release's engine pair. It preserves the current `~/.azrael-ex` state. Add `-UpdateDesktopShortcut` to redirect the existing desktop shortcut (a backup is saved in the release directory):

```powershell
./scripts/install-azrael.ps1 -Target Isolated -ReleaseDirectory $candidate -UpdateDesktopShortcut
```

Subsequent installs can omit `-ReleaseDirectory` to use `latest.json`. Finish active work in the old window, then close it after checking the new window. An old process continues to use its original binaries. To roll back, invoke the same install command with the previous verified release directory. No release is automatically deleted, and no global environment or ordinary VS Code settings are changed. The persistent independent installer supersedes this per-instance fixture workflow.

The lower-level packager remains available for explicit existing inputs; its default output is also a new directory under project `artifacts/releases/`:

```powershell
./scripts/package-azrael.ps1 `
  -EnginePath '<absolute rebuilt codex.exe>' `
  -BridgePath '<absolute rebuilt azrael-bridge.exe>' `
  -CompanionVsixPath '<absolute rebuilt azrael-ex VSIX>'
```

The package contains the fork engine, bridge, companion VSIX, launcher scripts, upstream license/notice files and `build-info.json`. It does not contain the official extension. Run `Launch.ps1` from that directory; it supplies the packaged pair and VSIX and intentionally enables the new-instance engine-pair update path.

Earlier account/Devin releases under `%LOCALAPPDATA%/azrael-ex/releases/` are retained while old windows or rollback references depend on them. New releases belong in the project. Packaged binaries are immutable; a shared development build directory may advance independently. `build-info.json` records their exact hashes. Never replace a running release in place.

For the first launch after updating from the earlier login build, close the old azrael test window first. Its engine predates root-auth ownership protection. Start the packaged launcher, then run **azrael-ex: Manage OpenAI Accounts** from the command palette. Use **Save current account** to retain the existing login as a managed profile, then **Add account** for another login. **Switch** requests a manual change; an active turn must finish first. **사용량** opens the separate quota page; **새로고침** updates usage and **티켓 상세 보기** requests ticket metadata. Missing usage or ticket information is shown as unavailable rather than zero. No account rotation or ticket consumption is automatic.

Chat and the full native settings remain in the **azrael** sidebar. Some official pages may still say Codex. Session JSONL and SQLite files keep the native layout below `~/.azrael-ex`; adding or switching a profile does not select a different session root.

The profile dropdown has **계정 추가·전환** for account management and **사용량** immediately below it for the dedicated usage page, above **azrael settings**. The command palette also exposes **azrael-ex: 사용량**. Account management owns login/switch/removal; usage owns remaining-percentage bars, resets and reset tickets. Codex Spark limits are excluded from usage presentation. Missing values are unavailable, never assumed to be zero. After updating a local menu patch, use **Developer: Reload Window** in the existing azrael window so both the extension host and webview load it. Do not launch an additional instance solely to refresh the menu.

The usage entry upgrades the pinned menu marker to schema 2. A pre-usage schema-1-only launcher cannot reopen that shared patched extension directory. For an engine rollback across this boundary, use the current build wrapper to package the previous verified engine pair with the current companion and launcher; do not run the older launcher directly against the upgraded state.

Devin usage uses the logged-in pinned CLI's `/usage` screen through a bounded PTY with `node-pty` and `@xterm/headless`. It sends no inference prompt and copies no credentials. The dedicated working directory is `~/.azrael-ex/azrael/devin-usage`; the adapter reuses CLI-owned user configuration without reading or copying it. A fresh config override is avoided because it triggers interactive first-run setup even when authenticated. The parser requires the known daily/weekly quota screen; unsupported output shows an error. The page refreshes while visible and retains prior same-account values as stale on failures. A separate web login was approved as an alternative but is not needed for this CLI path. These two production dependencies must be included in the VSIX; verify native PTY loading in the installed VS Code runtime when changing Node/Electron or the dependency version.

The PTY runs in a bounded child of the companion with `ELECTRON_RUN_AS_NODE=1` set only for that child. Its IPC returns quota fields/errors only; terminal/auth text is not logged. The child provides a graceful `/exit` interval, then terminates independently so native handles cannot retain the extension host. Hiding/closing the usage page cancels a pending query.

CLI acceptance on 2026-09-13: the public usage service returned real daily/weekly quota and reset fields in 5.884 seconds, with error null, natural collector exit 0, no remaining handles and no new Devin processes. Evidence: `artifacts/logs/devin-usage/public-refresh-two-enter-final.json`. The CLI's first Enter accepts its slash-command picker; a distinct second Enter submits `/usage`. Waiting for echoed input and checking the fetch state avoids submitting an unfinished command. This evidence covers the pinned CLI path, not arbitrary future CLI formats.

Usage-page package acceptance on 2026-09-13: 28 companion tests passed; fresh menu preparation, schema-1 upgrade and repeated preparation passed. The VSIX contains the quota helper, terminal emulator and Windows x64 PTY native addons. Packaged dependency/helper execution under the installed VS Code Electron-as-Node runtime passed. Candidate `artifacts/releases/usage_page_20260913_1242` reuses the accepted engine pair; no Rust rebuild was required. Acceptance logs are under `artifacts/logs/usage-page/`.

Startup tutorial and image-generation announcement suppression is applied by `prepare-official-ui.ps1` to the azrael-only extension host, guarded by `.azrael-startup-notices.json`. It supplies the existing completion/dismissal values even for fresh editor data. After applying the patch to an existing installation, use **Developer: Reload Window** once; a second azrael instance is unnecessary. Future packages include the preparation change. This does not suppress authentication, permission requests, or runtime errors.

## Reload recovery

The host status bar and **azrael: 실행 상태 및 복구** command expose observed execution state. Select a thread to refresh its native status or interrupt it and resume after the engine confirms idle. A 90-second gap in progress is labelled delayed; it does not automatically terminate long-running work. An unknown prior resume outcome requires checking the conversation history and explicitly choosing a new continuation.

Recovery receipts live in the extension's VS Code workspace state (global state for an empty window), key `azrael.resumeReceipts.v1`, bounded to 64 threads. They contain operation identifiers, parameter hashes, phases and turn identifiers, not prompt/tool contents. Do not clear these receipts to work around an uncertain request: use the recovery command and native history first.

Use **Output → Azrael Recovery** for structured phase, dispatch, unknown-outcome and storage-error events. **Developer: Open Logs Folder** locates the persisted VS Code log files. VS Code owns rotation, retention and access; the feature creates no separate log directory or telemetry sink. Log entries intentionally omit request/response text and raw server error bodies. Share only the relevant thread/operation identifiers and time range after reviewing the selected log.

Validation commands (from the project root):

```powershell
node --test scripts/test-recovery-state.cjs
node --test scripts/test-recovery-bridge.cjs
node scripts/test-recovery-engine.mjs '<selected engine>' '<new absolute fixture directory>'
```

The last command uses a synthetic interrupted rollout and a local stalled HTTP provider, and forcibly stops only its own fixture engine. It never uses a real account or model. The native check, pinned-bundle transform and packaged-host checks retain separate evidence; passing a simulated test does not establish actual window-reload acceptance. Feature design: [Reload and resume recovery](../architecture/reload-recovery.md).

Acceptance on 2026-09-15: 14 state tests, 3 bridge/lifecycle tests, native crash/reload, package contents and all six isolated host stages passed (exit 0). Candidate release: `artifacts/releases/reload_recovery_20260915_v4/`; verified host VSIX: `azrael-host.vsix`, version `0.2.1789454805014`, SHA-256 `60362007C834038BFEDCB63B18CA78E0FCEC54071CB083C4B00DBF1626613EBB`. Engine and bridge were rebuilt from source fingerprint `45cc02409dd8695ff0b584df67f335f47df44f6e681ed6cf7848e388623e30d7`; the recorded code-mode host and account payload were reused. `host-package.json` links native and isolated-host evidence under `artifacts/verification/reload-recovery/`. This candidate was not installed into the user's profile and the working window was not reloaded. Retain the verified package and its acceptance records until installation/rollback handoff; failed attempts remain diagnostic evidence for concurrent source/output contention and the corrected empty-input mismatch.

## Root resume reservations

Timer correction validation (2026-09-15): `node --test scripts/test-deferred-turn.cjs`
passed 7/7 against functions extracted from the pinned native webview. It covers live
defer/drain ordering, absence of completion side effects, resumed-turn isolation, frozen
elapsed time, reload timing, unknown-duration labels and ordinary behavior parity.
Rust protocol (1), app-server-protocol (2), core timing/lifecycle (2), live notification (1),
state migration (10) and final thread-store (244) tests passed with exit 0. One existing
thread-store test passed on retry; the suite reported it as flaky. Schema fixture generation
and matching validation passed using `python app-server-protocol/scripts/write_schema_fixtures.py`;
the `just write-app-server-schema` wrapper still references a missing binary. Packaging-owner
`cargo check` passed after adding exhaustive Deferred handling. Logs are under
`artifacts/logs/root-defer-timer-20260915/` and `artifacts/logs/root_defer_timer_20260915/`.

Fresh engine/bridge release: `artifacts/releases/root_defer_timer_20260915_2`, source SHA256
`c0dab7955e9f3587058f65f7e2ac94f8b073477e6c381bc6a72adfcc3724e02f`.
Build exit 0. The compatible code-mode host and unchanged account UI VSIX were explicitly
reused from `devin_native_20260915_2`; the new package retains its native Devin integration.
Binary hashes are recorded in the release's `build-info.json`. PrepareOnly passed (exit 0)
for `artifacts/deployments/independent-20260915-174004-325/package/`, host version
`0.2.1789461636330`, VSIX SHA256
`ac6f5f2bde2c49e759c6ad42a9de7fb83c96aff65b54746aa1e71d62abd4dee1`.
Fresh-state independent-host acceptance passed all six stages with exit 0; receipt:
`artifacts/verification/root-defer-timer-host-20260915/check-result.json`. The installed
fixture confirms eight deferred UI transformation edits and the frozen/unknown duration
renderers. No login, model request or conversation mutation was used. Actual profile
installation is in progress.

Observed cost review, 2026-09-15: thread `01a09f01-bb95-7e33-8679-b0ce79792c8d`
contains three durable deferrals followed by deadline resumes after 59.898, 59.110 and
59.843 seconds. No root usage or reasoning records occur inside those intervals; child
messages can still arrive. The first response after each resume reused respectively
7,040/84,978, 87,424/88,673 and 100,224/100,664 input tokens. The first low cache hit
does not establish expiry from a one-minute wait. No long-idle experiment or provider-side
cache diagnostics were available. Detailed measured inputs and calculations are in
`artifacts/verification/root-defer-timer-20260915/usage-review.json`.

At the published GPT-6 Astra standard short-context API rates on the review date, those
three responses are approximately USD 0.791220, 0.104714 and 0.110874. These are API-rate
equivalents of locally recorded usage, not invoice amounts or proof of the billed tier;
cache-write counts are used as recorded. Reasoning tokens are included in output tokens,
not added twice. See [API pricing](https://developers.openai.com/api/docs/pricing).

Deferred root does not leave an ongoing model inference to think in the background.
Resumption makes a new request using retained conversation state; provider KV-cache reuse
is separate. A cache miss can increase resume input cost, including cache-write pricing
where applicable. GPT-5.6 and later API documentation describes a minimum 30-minute
eligible cache lifetime after write/reuse, subject to matching prefix and routing; this
does not establish identical behavior or guaranteed hits on the observed Codex backend.
See [prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching).
Ordinary pending sleep/tool waits also need not generate reasoning tokens. Savings come
from avoiding repeated model wakeups and status checks, not elapsed wall time alone.
Prefer selected-child completion with a useful fallback deadline over repeated one-minute
wakeups solely to maintain a cache. Exact net savings require a comparable baseline and
provider billing evidence; neither is available for this sample.

Verified 2026-09-14. In Azrael, open **루트 재개 예약** from the native menu or the command palette (`azrael.rootResume` in the integrated host). The page shows each loaded engine's durable reservations, local due time, selected child turns, reason and any blocked condition. It uses the same management bridge as accounts; visible-page refreshes and countdowns do not call a model.

The root model can call `azrael_agents.defer_root` with exactly one of `resume_after_ms` or a future UTC `resume_at`, a short `reason`, and optional `wake_on: {agent_paths: [...], condition: "all_terminal"}`. Durations are limited to 1 ms through 12 hours. With multiple targets, all captured child turns must terminate for early wake; the deadline can wake first. Ordinary child progress is saved without starting root sampling. The tool is exposed only on the native OpenAI root path.

**지금 재개** and **예약 취소** use the displayed reservation ID/revision. If another event wins the race, refresh the page before another action. Cancelling a reservation or supplying new root input leaves child tasks running. Messages received while parked are saved to the root's native conversation history for subsequent execution and reload.

The engine must be running and the root thread loaded for its timer to execute. Reopening a root after restart restores a waiting reservation; a deadline that already passed is eligible immediately. A crash during preparation or dispatch produces a blocked reservation because a request may already have been submitted. Review that conversation, then use resume or cancel. Account admission failures also appear as blocked conditions. A deferred sampling segment remains incomplete in stored turn history; it is not reported as a completed task.

Acceptance: nine-package Cargo check, five root lifecycle tests, five state tests, one app-server-protocol test, four RPC tests, the existing cold-root recovery test, extension build and seven focused extension tests passed (exit 0). Mock-SSE checks verified zero root requests while parked and exactly one root request after deadline or selected-child completion, with child results saved before that wake. Stable/experimental schema generation and fixture checks passed. The checkout's `just write-app-server-schema` wrapper failed (exit 1) because it names an absent binary; generation used the crate's `schema_fixtures_tests::write_schema_fixtures_from_env` writer with `CODEX_APP_SERVER_SCHEMA_ROOT` and the stable/experimental flags instead. No paid model smoke test was used.

Fresh engine/bridge build and package preparation passed (exit 0): `artifacts/releases/root_resume_20260914_20260914-192013-324`, source SHA256 `6c810e1efd4062b142025b51e7d3735d4b3c6ea2929ff8173b1b7a9dbf6e0384`. The compatible code-mode host was reused from `artifacts/releases/20260914-162109-379/engine/`, with SHA256 `0dd178def204eca52efc690c86bbc2f66cce492b502587b89b12f2fe3bb4bc81`; engine and bridge were newly compiled. Build-info retains all binary and payload hashes. Prepared integrated host `0.2.1789381742581`, VSIX SHA256 `8480CA9457C4742557C6E93C480C14D4CADFEFF81F1F97B59C633CA37E43B02C`, is in `artifacts/deployments/independent-20260914-192830-253/package/`. Fresh-state standalone/same-window acceptance passed all six stages (exit 0), including the reservation webview and read-only list RPC: `artifacts/verification/root-resume-20260914-193827-727/check-result.json`. Logs: `artifacts/logs/root-resume-20260914/`.

Installed the exact prepared package with exit 0; receipt: `artifacts/deployments/independent-20260914-194413-922/deployment.json`, status `installed-reload-required`. Inventory selects `azrael-ex-local.azrael@0.2.1789381742581`, with no separate companion. Original Codex files/registration, unrelated extensions and editor settings were preserved; previous Azrael versions were backed up and the shortcut updated. No user window was launched, terminated or reloaded. Finish current work and use **Developer: Reload Window** to activate the installed feature.

## Baseline native checks

```powershell
node scripts/check-engine.mjs '<absolute codex.exe>' '<new absolute check directory>'
```

The directory must not already exist. This earlier baseline check initializes native stdio, verifies a logged-out account and empty thread list, writes a probe model name to native config, and checks readback and file location. It performs no login or model request. Both installed baseline and the earlier local build passed with exit 0. Those results do not establish the current account implementation or final package.

The earlier narrow management transport check remains available:

```powershell
node scripts/check-management.mjs '<codex.exe>' '<azrael-bridge.exe>' '<new absolute state directory>' '<new short absolute socket path>'
```

The source server enables an additional native socket only when `AZRAEL_EX_MANAGEMENT_SOCKET` is set in stdio mode. It retains stdio-owned lifetime and uses native private-directory/startup-lock handling. The Rust bridge uses the native local client, including Windows current-user/non-elevated peer checks.

The earlier check passed with exit 0 for concurrent logged-out reads, stdio config visibility, bridge close behavior and socket cleanup. It predates the profile RPC and does not replace current account acceptance.

Launcher regression command:

```powershell
./scripts/check-launcher.ps1 -EnginePath '<matching codex.exe>' -TestRoot '<new absolute test directory>'
```

## Current account and host acceptance

After rebuilding, run the native profile/account lifecycle harness against a new state directory and short socket path:

```powershell
node scripts/check-accounts.mjs `
  '<absolute rebuilt codex.exe>' `
  '<absolute rebuilt azrael-bridge.exe>' `
  '<new absolute state directory>' `
  '<new absolute short socket path>'
```

Then run the isolated VS Code host acceptance with the same rebuilt artifact set:

```powershell
./scripts/check-vscode-host.ps1 `
  -EnginePath '<absolute rebuilt codex.exe>' `
  -BridgePath '<absolute rebuilt azrael-bridge.exe>' `
  -CompanionVsixPath '<absolute rebuilt azrael-ex VSIX>' `
  -FixtureRoot '<new absolute external fixture root>'
```

The host harness prepares the branded local copy, installs the companion into the fixture extension directory, launches only an isolated VS Code test window, checks local activation and registered commands, opens the native sidebar and account Webview, and verifies a logged-out same-root/version/instance bridge connection. It passed with exit 0 (`host-result.json`, `host.log`). Both extensions loaded as local UI extensions; the companion supports local UI and Workspace classifications while rejecting remote hosts. No login or model request was performed.

The native account harness passed with exit 0 (`accounts-check-9b38cb81`). It verified two disposable mock profiles, manual switching, identity notifications, bounded 401 credential recovery, no refresh/retry on 429, bridge restrictions, saved thread/config readback after switching and restart, and synthetic credential cleanup. Model requests and reset-credit consumption were both zero. The companion passed 20 tests; its packaged VSIX SHA-256 is `95B9D1B8A8152FE8DA66D84210D11EDCDC2F1826BD10C02E8C810E55BF6E710D`. Native settings are inherited from the pinned official UI; every setting's live cloud behavior was not exercised.

Full task logs and verification artifacts are kept in the external work session linked by the [documentation guide](../README.md#work-artifacts).

## Devin integration

SWE-2 role startup check, 2026-09-17: the exact model
`agents.default_subagent_model = "devin/swe-2-high"` must not be paired with
`agents.default_subagent_reasoning_effort = "high"`. The exact variant already
encodes its effort and advertises no separate reasoning levels; the conflicting
default is rejected before role application. Remove the separate effort setting.
The current role override also clears inherited effort for exact Devin variants.
For this incident, removing the conflicting global default suffices even on the
installed `queue_delivery_20260917_v2`: model selection clears inherited effort
before role application. Start a new conversation or reload the window to load
the corrected defaults; an existing turn retains its configuration snapshot.
The current source also matches `provider_picker_20260917_v1` (provenance exit 0).
A scripted parent using high reasoning successfully spawned a real SWE-2 High
child with no model/effort override; native commands, a follow-up and result return
passed with engine and harness exit 0. Evidence:
`artifacts/verification/swe2-config-fix-20260917/retry/result.json` and
`artifacts/logs/swe2-config-fix-20260917/live-retry.log`. The same real-child check
passed on the installed engine (three successful native commands, engine and
harness exit 0); evidence is `installed-engine/result.json` under the same fixture
and `live-installed-engine.log` under the same log directory. No engine update is
required for this configuration correction.
Current-source role regression tests also passed: 23 tests, exit 0, using
`just test -p codex-core --lib --target x86_64-pc-windows-msvc agent::role::tests::`;
log: `artifacts/logs/swe2-role-verification-20260917/role-tests.log`.
The speculative `PrepareOnly` package generation was cancelled after the
installed-engine check passed; no extension installation was performed for this
fix. Its partial package under
`artifacts/deployments/independent-20260917-115849-424/` is not an install candidate.
The first live run also completed the child work, but its temporary harness failed
during cleanup; the corrected rerun is the acceptance evidence. The temporary
fixture and diagnostic logs may be removed after installation and handoff.

Full-access follow-up, 2026-09-14 (implemented and engine-verified; not installed): incident thread
`01a09ef7-1171-7371-a6e3-3a2d0296a7f0` ran on release
`20260914-162109-379` with Full access and `never`. Its six file reads completed,
but five executions were cancelled by Azrael: two `unsupported_shell_flavor`
and three `unsupported_execution_override` decisions. Devin reported these as
"User skipped this tool call"; this does not establish user cancellation.
The approved replacement automatically selects the unique `allow_once` before
command classification in this mode. The current contract is owned by
[architecture](../architecture/azrael-ex.md#devin-and-mixed-provider-agents).
Release `artifacts/releases/azrael_devin_full_access_20260914_v5` passed engine/
bridge compilation, source provenance and packaging (exit 0). Source SHA-256:
`fb0cc3fa9e21b11e587fb25f1de7614e7b7198237d94a9754f371331c372e7e0`.
The unchanged companion and pinned external code-mode host were reused.
Expanded mock ACP checks and live direct SWE-2 High/grouped SWE-2 Medium checks
passed on that exact release (exit 0 each). Each live model executed one command
with exit 0; native approval requests were zero and `full_access_never` was
observed. Evidence under `artifacts/logs/devin-full-access-20260914/`:
`mock-v5-final.log`, `permission-smoke-v5-final.log`, `live-final/result.json`.
The existing state root-resume tests passed 5/5 (exit 0) after three static
SELECTs were moved to the existing SQLx QueryBuilder pattern to unblock the
build. Other minimal build unblock changes corrected an owned String argument
and two Arc reference arguments in concurrent root-resume work.
Focused Devin core tests also passed 38/38 (exit 0), using
`just test --target x86_64-pc-windows-msvc -p codex-core --lib 'devin::'`;
log: `just-test-codex-core-devin-explicit.log` in the same log root. The full
workspace suite was not run.

Preparation then failed before host generation/installation (exit 1): source
changed again after packaging, including `core/src/session/root_resume_tests.rs`
and `core/src/session/tests.rs`. The deployment provenance check was preserved;
the candidate was not installed. Receipt:
`artifacts/deployments/independent-20260914-181619-938/deployment.json`; failure
log: `artifacts/logs/devin-full-access-20260914/prepare.log`. Rebuild against a
stable source tree, then prepare, validate and install the exact host package.
Existing windows were not terminated or reloaded. Earlier failed build/test
logs are retained for attribution to the concurrent source changes.
A final v6 retry after focused tests passed compiled successfully but again
failed the before/after source check (wrapper exit 1); it was not packaged.
Log: `artifacts/logs/azrael_devin_full_access_20260914_v6/engine-provenance.log`.
Further deployment requires the concurrent source-writing work to stop.

Historical narrower corrections (superseded by the full-access follow-up):

Permission/observation correction verified against
`azrael_devin_recovery_20260914_v2`, 2026-09-14: the incident's Full access + never request was automatically cancelled
by the adapter, not proven to have been manually skipped. The new boundary uses
native exec policy for supported literal PowerShell requests and requires a
unique `allow_once` option. Unsupported syntax/tool kinds are explicit denials;
no global Devin bypass mode is configured. Tool transport `completed` does not
establish that all commands in a compound script succeeded.

Follow-up installed 2026-09-14: align
the displayed Full access + `never` combination with unrestricted one-time Devin
execution. A classifiable request that native policy marks `NeedsApproval` may
select the unique `allow_once` response because this mode intentionally has no
interactive approval path; `Forbidden`, malformed, opaque and unsupported
requests remain denied with their internal reason. Devin-namespace dynamic tool
items remain presentation observations and must not generate app-server dynamic
tool execution requests. Focused formatting and six Rust tests passed with exit
0. Fresh-state standalone/coexistence host validation passed all six stages with
exit 0; no login, model request or user-state mutation was performed. Release
`artifacts/releases/20260914-162109-379`, prepared host
`0.2.1789371507137` (SHA-256
`5b0481bf0839aae7bae0ffc07bca992f97e7cd9c81bdcd8e1041f9d90cb5328c`),
and exact-package installation passed with the original Codex, editor settings
and unrelated extensions unchanged. Installation receipt:
`artifacts/deployments/independent-20260914-170147-462/deployment.json`;
host acceptance:
`artifacts/verification/devin-activity-repair-host-retry-20260914/check-result.json`;
focused logs: `artifacts/logs/devin-activity-repair-20260914/`. The binary-only
installation intentionally used `-SkipCodexEnvironmentSnapshot`; existing Azrael
roles, skills and apps were preserved and not revalidated. No window was opened,
terminated or reloaded. Use **Developer: Reload Window**, then retry both a Devin
command and compact activity expansion; those real-use checks remain pending.

The separate stalled thread `01a09e0b-f5c9-7b30-a66e-5863cf0029ee` hit
`OutputTextDelta without active item` at 12:53:44 KST on the previously installed
engine. Synthetic assistant progress closed the active text item before a later
text chunk. Native tool lifecycle observations now leave text streaming intact.
The mock checker covers text/tool/text interleaving and provider exit while a
native permission request is pending; the latter must fail the turn without an
approval response. These are required acceptance checks for this repair.

The same investigation confirmed an independent Windows host defect: copying
`process.env` dropped case-insensitive `Path` lookup, so the pinned bundle built
`PATH=undefined;<extension-bin>`. The private runtime environment now normalizes
the inherited path key before the bundle runs. Validate the packaged runtime as
well as engine commands; restoring PATH only in a test wrapper masks this defect.

The 2026-09-14 candidate passed live direct SWE-2 High and grouped SWE-2 Medium,
Claude Opus 5 Medium and GPT-5.5 Medium shell/response checks. The subsequent
live Astra parent returned `usageLimitExceeded` before spawning a child. Preserve
that result as an external limit, not a Devin failure. The checker also supports
`--live-work --scripted-parent --child-only`: a localhost Responses fixture sends
the parent collaboration calls while the real Devin child edits, checks and
handles a follow-up. This mode records `parentMode=scripted-responses-fixture`;
it verifies native child dispatch and execution without claiming live Astra
reasoning or changing account authentication. Child completion is read from
native history before follow-up and final response.

Repair acceptance artifacts are under
`artifacts/logs/devin-stream-recovery-20260914/`: core Devin 27 tests, rollout
retention 1 and ACP transport 6 passed; scoped clippy/final formatting and the
mock engine checker exited 0. The ordinary runtime's two tests and TypeScript
compilation passed. `live-child-v1/result.json` records a real SWE-2 High child
completing edit/check and same-child follow-up with three successful execute
observations, four native collaboration receipts and final `value.txt=two`.
The parent is explicitly scripted because of the external Astra quota limit.
The exact prepared host package passed all six standalone/coexistence stages
with both source and fixture originals unchanged; Windows PATH and PowerShell
execution assertions passed in both modes. Host evidence is
`artifacts/verification/devin-stream-recovery-host-v2-20260914/check-result.json`.
The prepared package SHA-256 is
`657b5ff64c00c5645f98e522fca437f17ac3b5d31342c58d4e5dc49f1c04b6e7`.
That exact package was installed successfully as host `0.2.1789364146635`;
the installation receipt is
`artifacts/deployments/independent-20260914-145251-948/deployment.json`.
Final verification exited 0 and records package/runtime/engine hash agreement,
all 21 managed environment items unchanged, and preserved original Codex,
VS Code settings and unrelated extensions in
`artifacts/logs/devin-stream-recovery-20260914/acceptance.json`.
The desktop shortcut was updated, but no user window was relaunched. Run
`Developer: Reload Window` to activate the new host/engine, then retry a stalled
request; interrupted user work was not automatically replayed.
No full workspace test suite was run. The external code-mode host and internal
account UI payload were explicitly reused; the engine/bridge pair was rebuilt
and source provenance verified. The initial build whose source changed during
compilation was rejected, retained for diagnosis and not selected for installation.

Binary-only repair exception to the environment-snapshot workflow above: this
approved repair uses `-SkipCodexEnvironmentSnapshot` for preparation and the
exact-package installation to preserve the already configured Azrael roles,
instructions, skills and apps. It does not refresh or claim to revalidate the
Codex environment snapshot. Verify configuration hashes before/after and retain
the existing snapshot receipt; a requested environment resync remains a separate
operation. User windows are not forcibly reloaded.

Diagnostic owner: the existing Azrael tracing store (`CODEX_HOME/logs_2.sqlite`)
and thread rollouts. Query only the incident time range/native turn ID or
external session ID. New metadata event names are `devin_session_initializing`,
`devin_session_initialized`, `devin_session_loading`/`devin_session_creating`,
`devin_session_ready`, `devin_prompt_started`, `devin_prompt_waiting`,
`devin_prompt_finished`, and `devin_permission_requested`/`waiting`/`decided`.
Tool start/terminal/forced-close records use `tool_call_id`, `status`,
`reason_code` and timing fields. Prompt waiting is sampled at 30-second intervals
without retries or inferred timeout failures. An approval-wait record identifies
the separate native approval wait; cancellation is never approval.

No command, file content, credentials, raw prompt or reasoning is deliberately
added to these diagnostic fields. Native structured tool items contain only
bounded/redacted presentation metadata and failure text, and are retained for
legacy as well as paginated thread inspection. Check actual Devin tool output
and file/test evidence separately before declaring a coding task complete. Do
not copy the Devin database or credentials wholesale for support; preserve the
existing logging retention policy and share only the bounded relevant records.

Status: partial, 2026-09-13. Devin CLI 3000.10.21 was installed and its own browser login, exact SWE-2 model selection/readback, ACP text response and session load were verified. Engine integration acceptance is still in progress.

The verified Windows executable can be started from either Windows PowerShell or PowerShell 7:

```powershell
& "$env:LOCALAPPDATA\azrael-ex\tools\devin\3000.10.21\bin\devin.exe"
```

`$env` alone is not an environment-variable reference. Keep the `:LOCALAPPDATA` portion. Devin owns its credentials; the companion does not copy them into OpenAI authentication state.

The launcher accepts `-DevinExecutable '<absolute devin.exe path>'`. Without that override it uses `AZRAEL_EX_DEVIN_EXECUTABLE`, then the installed CLI at `%LOCALAPPDATA%/azrael-ex/tools/devin/3000.10.21/bin/devin.exe` when present. Its preparation creates a managed model-catalog marker in the dedicated state root. Marker creation, repeated preparation and preservation of an existing custom catalog setting passed local checks. The fork merges Devin variants with the native catalog; exact model keys include `devin/swe-2-medium`, `devin/swe-2-high` and `devin/swe-2-max` when the CLI reports them.

Only variants with a reported positive context limit are exposed. The CLI's `Adaptive` entry currently omits that limit and is excluded; a missing output limit does not exclude an otherwise usable variant. The integration does not invent token limits for these entries.

Reasoning variants are grouped by model and execution tier for the native model/effort picker. Select the base entry, for example **Claude Opus 5 (Devin)**, then choose its effort using the existing selector. **Claude Opus 5 Fast (Devin)** remains separate. Only available efforts are listed. Saved exact variant keys retain their prior execution behavior; select the new grouped entry to start using the effort selector for an existing conversation. Effort changes resolve to the CLI's exact variant ID before execution.

The companion command **azrael-ex: Manage Devin Account** provides separate sign-in, sign-out and model refresh. The pinned official model dropdown caches model queries for five minutes. The account result offers **Reload Window** to refresh that UI cache immediately; account operations do not impersonate an OpenAI login event.

For Astra as the root model and SWE-2 Medium as the default child model, the dedicated state root's `config.toml` supports:

```toml
model = "gpt-6-astra"

[agents]
default_subagent_model = "devin/swe-2-medium"
```

An explicit model in a spawn request takes precedence over this child default. Devin must be enabled and logged in; its exact key is resolved from the CLI catalog even before the picker is opened.

Correction completed, 2026-09-14: the previously installed global Devin-enabled
plaintext schema policy caused an actual OpenAI HTTP 400 for reserved
`collaboration.followup_task`. The same old binary succeeded with the dedicated
`azrael_agents` namespace, and with Devin disabled and the native schema retained
(exit codes 1, 0, 0 respectively). Evidence: `artifacts/logs/collab-contract-20260914/old-native-*`.
The approved replacement contract is owned by [architecture](../architecture/azrael-ex.md):
the Azrael host explicitly selects plaintext tools with `AZRAEL_EX_PLAINTEXT_AGENTS=1`,
independent of Devin discovery. Explicit `features.multi_agent_v2.tool_namespace`
configuration takes precedence. Native reserved schemas remain encrypted; only
the Azrael namespace is plaintext and direct-model-only. New-build contract validation
has passed; installation status is recorded below. Opaque encrypted history is not decrypted locally.

Progress evidence for the correction: `just test` with the repository's local
nextest profile passed 10 focused contract tests and the separately selected
admission regression (exit 0 each). The earlier direct-cargo admission stack
overflow did not recur with the prescribed runner; its log is retained.
`just fmt-check` and `just fmt` passed (exit 0). The first candidate exposed a
second gap: native defaults hid configured role selection. The final candidate
`artifacts/releases/azrael_collab_contract_roles_20260914` defaults to visible
spawn metadata only under the Azrael contract, retaining explicit user choices
and native defaults. Engine/bridge build and packaging passed exit 0; source
SHA-256 is `4c2d57e1857215d536c16a5310bd9be0c80ca0bef1080871937a1f8953ebdf3e`.
Preparation is under `artifacts/deployments/independent-20260914-113015-633`.
The permanent `scripts/check-collaboration-contract.ps1` checker passed (exit 0):
nine live probes covering Astra/Sol/Terra/Luna, explicit native schema, exact
`devin/swe-2-high`, and child lifecycles. App-server raw receipts independently
matched three spawn, two follow-up, one send and one interrupt call/output pairs;
all four child markers were received and the interrupt acted on a running child.
Configured roles were selected without model/effort or metadata-visibility overrides.
Evidence: `artifacts/logs/collab-contract-20260914/final-live-v3/`.
The prepared package's runtime environment also passed an actual Astra request
without config overrides (exit 0, `prepared-runtime-astra.*`). The existing mocked
Devin integration checker passed when retried after live probes became idle
(exit 0, `mock-devin-engine-retry.log`); the concurrent admission rejection is
retained separately. The full Rust suite was not run.
The superseded preparation `independent-20260914-111336-164` was stopped before
installation; only its verified task-owned VSIX packager was stopped. Both
candidate/diagnostic records remain under `artifacts/`; the superseded candidate was not installed.

Final package acceptance and actual reinstall both passed (exit 0). All six
isolated VS Code stages passed, including standalone and original-Codex coexistence:
`artifacts/verification/collab-contract-vsix-20260914/check-result.json`.
Verified and installed VSIX SHA-256:
`1402e8c7fb4210ff3dd0f5e617481d5949dd5d1d4fe1c9c4a1fb3fadcee8a032`.
Installed host version is `0.2.1789353049965`; receipt:
`artifacts/deployments/independent-20260914-115905-335/deployment.json`.
The receipt records `installed-reload-required`, the environment snapshot applied,
and original extension/settings/unrelated extensions unchanged. Installed runtime
selects the final release above and existing `.azrael-ex` home. Previous Azrael
versions and environment backup remain available; the shortcut was updated.
No user window was stopped or reloaded. Apply with `Developer: Reload Window`
after current work, then smoke-test a new Azrael conversation; opaque historical
tool records are not rewritten. Engine and bridge are source-built; the pinned
compatible code-mode host is reused, not claimed source-built.

Repeat live contract validation against a named release (uses existing authenticated
state, makes real model requests, and requires explicit unrestricted Devin execution):

```powershell
./scripts/check-collaboration-contract.ps1 `
  -EnginePath ./artifacts/releases/azrael_collab_contract_roles_20260914/engine/codex.exe `
  -DevinExecutable '<absolute-path-to-devin.exe>' `
  -StateRoot '<existing-azrael-state-root>' `
  -FixtureRoot ./artifacts/verification/collab-contract-live `
  -LogRoot ./artifacts/logs/collab-contract-live `
  -AllowUnrestrictedDevin
```

The pinned picker also reads only its first 100-model page. In managed Devin mode,
the engine returns the full merged list for that exact initial VS Code query.
Other clients and explicit pagination keep native behavior. This exception is
required for SWE-2 variants appearing later in the Devin catalog.

The ACP adapter forwards effective text context, including injected AGENTS and skill instructions, and retains external session identifiers in the dedicated state root. It rejects unsupported non-text input, structured output and restricted execution policies. The native Windows CLI has no OS sandbox, so it requires an unrestricted filesystem/network permission profile. Native Responses compaction is not supported for Devin; an exhausted context requires a new thread. These boundaries must remain visible during integration acceptance.

User-profile installation completed on 2026-09-15 after explicit user authorization: exact verified host 0.2.1789454805014 installed successfully (exit 0), receipt artifacts/deployments/independent-20260915-161519-273/deployment.json, status installed-reload-required. Original Codex and editor settings preservation checks passed. Existing Azrael environment configuration was retained with -SkipCodexEnvironmentSnapshot. No working window was launched, terminated or reloaded; Developer: Reload Window is required to activate this version. This supersedes the candidate's earlier not-installed status.

### Queued context compaction

Implemented and tested at source level, 2026-09-16; not packaged or installed.
The composer queues a typed compaction operation alongside ordinary messages,
using the same cancel/reorder controls. At its execution point, Core reserves an
idle turn and skips known usage strictly below 15%; exactly 15% or unknown usage
runs compaction. A skipped head continues to the next item, including explicit
resume of an interrupted queue. See the [contract](../architecture/queued-compaction.md).

Relevant validation passed (all successful runs exit 0):

- Core admission: 7 tests, including threshold boundaries, missing usage, live
  task preservation, trigger mailbox and recovery reservations.
- Queue extension: all 20 cases covered across the final 18-pass crate run and
  the 2-pass affected-hook rerun. The initial crate run exited 1 because its two
  existing hook fixtures selected the Windows Python alias; only those fixtures
  changed for the targeted rerun. Actual compaction FIFO also passed separately.
- App-server queue API: 12/12 after isolating the inherited management-socket
  environment variable in TestAppServer. Explicit fixture overrides still work.
  The initial run timed out before initialize, waiting on the live host's lock;
  the live app was neither modified nor stopped.
- Host: 12 actual-function tests and the combined namespace/deferred/compaction/
  queue-refresh transformation of all three pinned assets passed.
- TUI queue command: one selected test passed; the crate's test binary compiled.
- Scoped `just fix` for the six changed Rust crates and `just fmt` passed
  (exit 0); Clippy retained existing warnings and made no automatic code fixes.
  Final affected-file whitespace and JavaScript syntax checks also passed.
- Stable and experimental schema regeneration and final Bazel lock update passed.
  The stale `just write-app-server-schema` recipe refers to a missing binary
  (exit 1); generation instead used the existing ignored
  `schema_fixtures_tests::write_schema_fixtures_from_env` through `just test`, with
  `CODEX_APP_SERVER_SCHEMA_ROOT` and `CODEX_APP_SERVER_SCHEMA_EXPERIMENTAL` set.

Protocol suites ran 631 tests: 630 passed, one failed (exit 1). The remaining
`generated_ts_optional_nullable_fields_only_in_params` failure reports the existing
`RootResumeReservation.finalOutputJsonSchema` optional-nullable output; its source
was not changed by this task. All generated schema consistency tests passed.
No complete Rust workspace suite or installed/live UI acceptance is claimed.

Evidence and retained failed attempts are under
`artifacts/logs/compaction-queue-20260916/`. Startup isolation diagnostics include
an existing test binary failing with the inherited socket (exit 101) and passing
when only that variable was removed (exit 0). Queue skip/start diagnostics use
the existing tracing pipeline with IDs/counts, never prompt contents.

### Queue refresh during compaction

Source-level correction verified 2026-09-16; not packaged or installed in this check.
The pinned webview queue adapter previously discarded queue-change notifications
received during an outstanding list request. A snapshot taken before queued input
was consumed could therefore leave the sent message visible. The host transform
in `scripts/inject-queue-refresh.cjs` invalidates that snapshot and repeats the
complete paginated read before publishing. It retains the native queue and error
reporting; no persisted queue schema changes.

`node --test scripts/test-queue-refresh.cjs` passed 6/6 (exit 0), including an
original-adapter reproduction, notification coalescing, pending-item preservation,
pagination, failure retry, disposal and injection guards. Existing compaction
progress checks passed 5/5 (exit 0). Logs are retained under
`artifacts/logs/queue-refresh-20260916/`. These checks execute extracted real host
functions with controlled transport responses; live compaction UI acceptance remains
unverified. The standard host preparation applies and counts the new transform.

### Accepted local queue items and duplicate submission

2026-09-16 follow-up: the installed host directories through version
`0.2.1789549265241` contain neither the queue-refresh nor queued-compaction
transform. The earlier source tests therefore do not establish a fix in the
user's running app. The native queue database had no queue revisions at inspection;
this is consistent with use of the older local queue, not proof of the exact
cause of the screenshot's duplicate. Inspection receipts are in
`artifacts/logs/queue-duplicate-20260916/installed-markers.json`.

The legacy coordinator previously started deletion without awaiting persistence,
then released its send lock. Its cached state could also accept an older storage
snapshot containing an already accepted ID. `scripts/inject-queue-consumption.cjs`
now awaits removal before releasing that lock and retains accepted IDs by thread
for the coordinator's lifetime. Reads, restored snapshots and subsequent writes
exclude those IDs. It only records successful admission; deferred or failed sends
remain queued, and a new ID with identical text remains a separate message.
Disposal clears receipts. This transform protects the legacy backlog while it
drains; new supported-host queues use the existing native queue implementation.

Deletion failures use the existing `Failed to execute queued message` warning
path; a receipt prevents replay in the current coordinator, but this does not
claim crash-safe delivery across failed persistence or a process restart. No live
queue data was modified during diagnosis. Installation and real UI acceptance
remain separate from source validation.

Source validation passed (exit 0): the actual pinned coordinator regression suite
`node --test scripts/test-queue-consumption.cjs` passed 10/10, including original
early-release/stale-snapshot reproductions and accepted-removal persistence
failure. The existing queue-refresh and queued-compaction suites passed 18/18.
Combined namespace/deferred/compaction-progress/queued-compaction/consumption
transforms parsed successfully, and JavaScript syntax checks passed. Logs:
`artifacts/logs/queue-duplicate-20260916/consumption-tests.log`,
`queue-existing-tests.log`, and `combined-host.json` in that directory.
The normal host packager now requires exactly one consumption transform. The
follow-up is installed in the 2026-09-17 version recorded below; an existing
working window requires reload to activate that version.

Build/install follow-up requested on 2026-09-16: the prior engine reuse check
failed because its source fingerprint differed. A fresh engine/bridge build and
release packaging succeeded (exit 0) at
`artifacts/releases/queue_delivery_20260916_v1`, source SHA-256
`1cba62bcb23a7e5e16322367bb60b286f7d6cf3bc3eddf90fd3eccb9d5f47899`.
The existing recorded code-mode host was reused as an external runtime, not
rebuilt from source. Queue source regressions passed 28/28 (exit 0).
PrepareOnly succeeded (exit 0), producing host `0.2.1789564318731` at
`artifacts/deployments/independent-20260916-221127-064/package/azrael-host.vsix`,
SHA-256 `24A8A109E11874F56AB2514A34FB70081C4DE2BFFB666762CD9711C4387C3588`.
Exact-package static checks passed (exit 0): the five queue patch markers occur
once, all three affected assets parse, and the injectors are idempotent. The first
isolated host run exited 1 before activation because the existing VS Code updater
held `vscode-updating`; its CLI returning 0 did not establish host activation.
The original updater and working windows were preserved. A byte-matched copy of
the installed VS Code executable and its versioned runtime was placed under
`artifacts/tools/vscode-queue-validation-645f29cc31` for a standalone fixture retry.
No VS Code program source or updater was patched; copy provenance is recorded in
`artifacts/logs/queue-install-20260916/test-runtime.json`.
The standalone runtime retry passed all six host stages (exit 0), including
standalone activation and coexistence, with original source/fixture unchanged:
`artifacts/verification/queue-delivery-host-20260916-r2/check-result.json`.
Installation was attempted with the exact prepared package but exited 1 before
VSIX installation: concurrent engine edits after the build invalidated source
provenance. Receipt `artifacts/deployments/independent-20260916-223429-616/deployment.json`
records `failed`; no shortcut or user extension was changed. The candidate remains
verified against its recorded source, but cannot be installed under the current
source rule. A stable source tree and new build/preparation are required.
Preparation retained the
existing Azrael environment using `-SkipCodexEnvironmentSnapshot`; no user window
was launched, terminated or reloaded. Build logs are under
`artifacts/logs/queue_delivery_20260916_v1/`; orchestration and test logs are under
`artifacts/logs/queue-install-20260916/`.

After the user confirmed completion of concurrent edits, the 2026-09-17 retry
rebuilt the engine and bridge at `artifacts/releases/queue_delivery_20260917_v2`
(exit 0), source SHA-256
`b76c7a0555a11ff82a1fd37d22eb8d7001beaa880e8c510dfeec176cc414c5b3`.
The recorded external code-mode host was reused. Preparation, queue regressions
(28/28), exact-package checks (five markers, three parsed assets, idempotence),
and all six isolated host stages passed with actual exit 0. Standalone activation
and coexistence passed; original source and fixture remained unchanged. The same
standalone VS Code runtime was reused for validation.
Host `0.2.1789575782295`, VSIX SHA-256
`CBCB820940D506C44808BCE9118262BEA826FE2E9631328BD58267F5400DCA18`,
was installed successfully (exit 0) from
`artifacts/deployments/independent-20260917-012232-494/package/azrael-host.vsix`.
Receipt `artifacts/deployments/independent-20260917-013955-593/deployment.json`
records `installed-reload-required`; the installed manifest matches the version.
Existing Azrael environment was retained with `-SkipCodexEnvironmentSnapshot`;
`-NoLaunch` preserved working windows. Reload is required to activate the update.
Build logs are under `artifacts/logs/queue_delivery_20260917_v2/`, orchestration
and validation logs under `artifacts/logs/queue-install-20260917/`, and isolated
results under `artifacts/verification/queue-delivery-host-20260917-v2/`.

### Idle WebSocket recovery and compaction progress

Source behavior verified on 2026-09-16: cached Responses connections are considered
closed when their command channel closes or their background pump terminates, even
when the stream wrapper remains present. The existing client reconnection path then
clears connection-local continuation state before sending the full next input.
Healthy connections remain reusable. A peer closing after the health check can still
require the existing bounded retry path; this change does not suppress real failures.

The Responses parser forwards `response.compaction.compacting` as internal progress.
Remote v2 compaction reaffirms its existing context-compaction item once per response
attempt, preserving the item ID and original start time. Repeated heartbeats are
coalesced. Completion is emitted only after the completed response is validated and
the compacted history is installed. The pinned host removes only same-turn transient
`willRetry: true` error rows when context-compaction progress starts; terminal errors,
other turns and other items remain intact. Repeated starts preserve the existing
manual/automatic source without consuming a later pending manual request.
No public protocol or stored context
format changes. Host transformation is owned by `scripts/inject-compaction-progress.cjs`.

Focused acceptance passed: cached idle graceful-close/abrupt-EOF recovery, healthy
connection reuse, all 244 `codex-api`/`codex-otel` tests, 11 remote-v2 compaction tests,
and 5 real transformed-host reducer tests. Existing deferred-turn and recovery-bridge
checks passed 7/7 and 3/3. Commands, failure diagnostics and successful reruns are
retained in `artifacts/logs/websocket-recovery-20260916/`. Scoped `just fix` for
`codex-api`, `codex-core`, and `codex-otel`, followed by `just fmt`, passed (exit 0);
existing unrelated Clippy warnings remain.

The broad `codex-core` run was not green: 3,721 tests ran, with 3,561 passed,
142 failed, 18 timed out and 77 skipped (exit 1). This result predates the prewarm
fixture correction: that fixture closed after its warmup and ignored subsequent
stream errors; it now serves and verifies the actual follow-up response, and its
focused rerun passes. Image-budget compaction and deferred-environment WebSocket
failures/timeouts did not reproduce in the isolated serial checks. Manual hook
parity failed before the v2 phase because its `python3` fixture did not create a
log; the local WindowsApps `python3` alias exits unsuccessfully. Native serial
manual-transcript parity passed 1/1. With a task-local `python3.cmd` shim and
child-process-only PATH override to verified Python 3.12.10, both manual-hook and
manual-transcript parity passed 2/2 (exit 0); no global environment was changed.
See `core-parity-transcripts-native.log` and `core-parity-python-shim.log`.
Other failures
include Devin execution-policy and multi-agent contract expectations; they were
not corrected as part of this transport change. See `core-full.log` and
`core-relevant-isolated.log` for exact scope. No full workspace or live long-idle
cloud-session acceptance is claimed.

The frozen final release `artifacts/releases/websocket_recovery_20260916_release`
built and passed source-provenance verification (exit 0), source SHA-256
`e69f3abe44986f53a37dee31aaccb648a917bcaa54d45ff4f184cb1e53f5ad69`.
Preparation passed (exit 0), producing host version `0.2.1789543832937` in
`artifacts/deployments/independent-20260916-163001-730/package/azrael-host.vsix`,
SHA-256 `8274c2240d6aa95d9c5e7043b5803acb21cfa0397f567b0ef547f7b20fb8be82`.
Final packaged compaction reducer checks passed 5/5. The first full host acceptance
stopped at a stale account-panel title assertion (old English title versus the
current source's `계정 및 사용량`); the exact-title expectation was corrected
without changing the package. The host execution harness also still expected
separate legacy account/usage panels; it now verifies the current shared panel
and absence of duplicates. Final fresh-state acceptance passed all six stages
(exit 0), including standalone and original-Codex coexistence activation:
`artifacts/verification/websocket-recovery-final-20260916-r4/check-result.json`.
The original source and fixture remained unchanged. No login, model request,
new thread, or test-object mutation was performed in these checks.

The exact verified package was installed successfully (exit 0) on 2026-09-16;
receipt `artifacts/deployments/independent-20260916-165828-473/deployment.json`,
host version `0.2.1789543832937`, status `installed-reload-required`.
The original Codex extension, editor settings, and unrelated extension inventory
were preserved. Existing Azrael environment configuration was retained using
`-SkipCodexEnvironmentSnapshot`. No working window was launched or reloaded;
run **Developer: Reload Window** to activate the fix.
