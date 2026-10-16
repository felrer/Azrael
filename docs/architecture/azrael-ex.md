# azrael-ex host and storage

Status: `current` for the single-extension host, storage and environment contracts below; `partial` where a section says so. The replacement target for the engine and provider layer is [Azrael runtime and providers](azrael-runtime.md). Supported commands and verification scope are owned by [development operations](../ops/development.md).

Related designs: [accounts and usage](accounts.md), [Devin](devin.md), [managed providers](managed-providers.md), [root resume scheduling](root-resume.md), [queued compaction](queued-compaction.md), [reload recovery](reload-recovery.md).

## Product and boundaries

`azrael-ex-local.azrael` is one installed VS Code extension that owns chat, account management and usage. It is installed into the ordinary VS Code profile beside the original `openai.chatgpt` extension, which stays unmodified, may coexist, and is not an activation dependency. The account module is embedded in the host; there is no separately installed companion extension.

The chat UI is a local, hash-pinned copy of the official Codex extension UI, namespaced for Azrael and combined with an Azrael-built integrated engine. The selected UI, engine source and installed release are identified by [source and state](../ops/development.md#source-and-state) and each release's provenance receipts. UI source hashes, transform-rule hashes, the engine source fingerprint and binary hashes are recorded with each prepared host. Native authentication identifiers and upstream network endpoints are preserved.

The host entry point activates the pinned UI host first, then initializes the embedded account module with the same host-local runtime and extension context. The wrapper preserves the host activation result and disposes both modules on shutdown. No module activates or discovers another extension to reach the engine. Commands and panels use `azrael.*`; the profile menu has one **계정 및 사용량** entry dispatching `azrael.usage`. An invalid local runtime produces an explicit unavailable error rather than silently ignoring a menu action.

The Azrael presentation boundary, composer feature surface and fixed/dynamic typography policy are owned by [UI presentation](ui-presentation.md). Candidate icon and typeface comparisons are separate from the installed host state.

The account module must control the same engine instance as the chat UI. It connects through an explicitly enabled management socket alongside the official stdio channel (WebSocket frames over AF_UNIX, including on Windows), using native private-directory checks and the Rust client's current-user, non-elevated peer checks through the `azrael-bridge` binary. The bridge is a companion connection with restricted methods, not a proxy replacing stdio. A second engine controlling only its own account does not satisfy this design.

The [shared-engine candidate](azrael-runtime.md#공용-실행기와-창-수명) is `partial`. Prepared runtime metadata opts into protocol 1 and pins the `azrael` binary SHA-256. The native UI retains its stdio interface through a thin engine connector; that connector and the account bridge register the same window context at the state home's deterministic private endpoint. Window registration includes the actual extension-host PID, session-derived owner ID, workspace storage identity and existing account selection paths. Companion connections do not extend the engine's window lifetime. Host source tests and Windows native lifecycle, context rejoin and final-close interruption checks pass. A single-backend idle memory measurement is recorded in the current work; installed-host acceptance and other operating systems remain unverified. Legacy fixture runtimes without the shared-engine opt-in retain their existing startup contract.

The local extension ID is not entitled to the original extension's proposed VS Code APIs, so `chatSessionsProvider`/`languageModelProxy` declarations and the contributed chat-session entry are omitted; the stable sidebar/Webview/custom-editor surfaces remain. VS Code's global API allowlist and product configuration are never altered. Normal extension preparation and installation do not patch VS Code. The explicitly authorized [Webview drag recovery](#webview-drag-recovery) tool is a separate, reversible host-bundle exception; it does not grant proposed APIs or change startup policy. The Windows host IPC pipe is `azrael-ipc`, separate from `codex-ipc`; randomized temporary paths and native app-server provider keys are preserved. The rules language has its own ID without claiming ordinary `.rules` associations.

Reuse the official General, Configuration, Personalization, Usage/Billing, MCP, Hook, Plugin and Account settings; the account module adds account management and entry points. A settings category counts as verified only after reading, saving, rereading and observing its effect; settings requiring reload or a new thread must say so. Ordinary Codex retains `chatgpt.*` preferences; Azrael owns `azrael.*`.

Provider-specific compaction settings, Azrael settings labels and context pricing presentation follow the [provider context policy](context-policy.md).

The azrael-only host supplies the existing first-run tutorial completion flags and the image-generation announcement dismissal flag on state reads. It does not suppress authentication, permission approvals, errors or settings. A source/patched-hash marker guards this patch; unsupported bundles fail preparation.

## Integrated source state

Status: `partial` — source integration, scoped feature verification and installed releases have separate acceptance boundaries. Current inputs and execution evidence are owned by [development operations](../ops/development.md#source-and-state); a newer checkout does not establish what an existing window runs.

The selected integrated engine root contains the reviewed Azrael changes and its source receipt. Official source ancestry, complete copied bytes and subsequent reviewed local changes are recorded independently of feature acceptance. The historical upstream checkout is a reference input. Pinned pristine UI assets are transformed at preparation time; incomplete or unknown anchors reject the candidate. Existing provider, account, recovery, queue and host contracts remain applicable across updates under [upstream preservation](upstream-preservation.md).

### Integration candidate

Status: `target` for each proposed update until its selected inputs pass acceptance.

A candidate combines a selected official Codex source/UI with the reviewed Azrael integration. Existing behavior contracts, assets, source adaptations and guarded UI anchors are accounted for against that candidate. A source import preserves already integrated bytes and provenance; it does not automatically port missing changes to a new official version or prove functional preservation. The prepared UI is generated through the integrated transformation pipeline; a pristine upstream directory alone is not the product.

Candidate sources and packages have distinct immutable paths. The installed source snapshot and retained releases keep their original provenance until a verified candidate is selected for application. Native endpoint model isolation follows the [provider catalog contract](managed-providers.md#native-endpoint-catalog-isolation).

## Installation and engine freshness

### Package preparation

Preparation writes only to staging and build artifacts; profile inventory, backups and original-extension preservation checks belong to installation. Successful preparation stages can be resumed only when their input fingerprints and completed artifact hashes match. An incomplete transformation is rebuilt in a fresh stage directory. Changed inputs require a new preparation; no partial directory is accepted as a completed host.

JavaScript transformations assemble edits in one pass and cache asset results by source content, the hashes of rules applicable to each asset, and the TypeScript implementation. Path-restricted transforms affect only their declared assets; generic transforms and uncertain dependencies remain shared. No-op keys include the same per-asset dependencies, and unrelated rule edits do not invalidate their shared index. Changed assets have individual cache entries that validate their key and output hash. Unchanged assets share one fingerprinted, hash-validated digest index, avoiding thousands of small cache files; invalid entries are recomputed. Packaging collects its file set once, retains generated VSIX metadata and environment-file protection, and scans changed or new text. The local Windows payload excludes Linux executables. Directory preservation checks continue to hash all file contents, with bounded parallel reading and deterministic aggregation. Stage metrics distinguish transformation, scanning, packaging and profile verification time.

UI asset reading uses four asynchronous reads by default while transformation, cache consumption and writes retain the enumerated file order. Every file is hashed from the bytes actually read; read failures drain pending reads and abort preparation before a completed report or checkpoint is accepted. The reader implementation participates in the transform-rule fingerprint. Detailed metrics separate read latency, decoding, hashing, cache validation, transformation and writing; overlapping read durations are distinguished from wall time.

Preparation builds one uniquely versioned host VSIX containing the pinned UI, the compiled account module and its production dependencies. The internal `azrael-ex.vsix` is a hash-verified packaging input, not an installable product. Installation installs the exact tested host and pins only that host. The account module is an internal payload, not a separately managed extension. Installers manage the current host identity only; other registered extensions and their directories remain unchanged. Original Codex files and registration, unrelated extensions and editor settings are preserved and checked. Extension backup scope is defined below. Running windows are never terminated or force-reloaded; a new host takes effect after **Developer: Reload Window**.

### Development compilation

Status: `current` — development compilation can reuse TypeScript incremental state, while release packaging uses a clean compilation. Development output reconciliation removes emitted JavaScript and source maps for deleted or renamed source/test files; compiled-test execution requires an explicitly completed compilation with unchanged inputs. Tests run in separate Node processes with bounded file concurrency, preserving the ordering of tests within each file. Build metrics record stage duration and actual command exit codes, including failures, without weakening provenance or payload checks.

The default extension test scope covers the integrated host's account, bridge and runtime contracts. The retained standalone chat implementation has a separate test scope; the full scope includes both without dropping cases. Development verification selects the union of tests for changed areas, with shared inputs and unmapped code changes expanding to the current local source scope. Shared extension inputs also select standalone coverage, and selecting both extension scopes compiles once. Namespace source regressions cover synthetic transformation and wrapper lifecycle behavior separately from acceptance of the completed package. Package acceptance still checks transformed payloads, standalone integrated-host activation and coexistence with original Codex. Source results do not replace acceptance of a different package, and final provenance and preservation checks remain mandatory.

### Automated deployment

Status: `current` — the real verification-only flow and isolated installation result/receipt binding are verified; the complete automatic flow has not been applied to the user profile.

A deployment runner composes the existing build, source verification, preparation, six-stage host acceptance and installation owners. Source verification runs concurrently with the build using separate extension outputs; both must succeed before host acceptance. Each run uses its explicit release and package paths, records command exit codes, stage durations and total wall time, and rejects changed source inputs. Acceptance binds its successful six-stage result to the prepared VSIX SHA-256; installation receives that exact package only after the runner rechecks the binding. A verification-only run stops before user-profile installation. Failed child commands block later stages, and cleanup is limited to child processes created by the runner. Existing user windows and state remain under the installer preservation contract.

Deployment input guards and per-asset cache selection are covered by isolated fixture regressions; optimized full deployment duration remains unmeasured. The runner forwards an explicit Rust target directory to its single build and overlaps source verification with that build. Project input fingerprints use bounded parallel content reads and deterministic aggregation, with one baseline shared by the initial, post-build and pre-install guards. Input checks retain tracked, untracked, deleted and initialized submodule content; timestamps never substitute for content hashes. The redundant whole-project guard after preparation is omitted, while package identity checks, final input comparison, engine provenance and profile preservation remain mandatory. Input-check duration and file/byte counts are recorded separately.

The package file set is collected once. Environment-file rejection checks paths for both disk and generated entries before the retained VSCE manifest validation and archive writer, avoiding a second content scan for a filename-only rule. Credential scanning of changed/new text and generated metadata remains mandatory; trusted pristine files, dependency directories and generated binary classifications do not exempt an environment file from rejection.

### Installation recovery

Installation omits extension-directory copies and their backup hashes. Registered current Azrael host paths are validated against package IDs, versions and installed inventory before installation. Unregistered directories remain in place. Receipts explicitly record that directory backups are disabled. Registry and shortcut backups and original-extension preservation checks remain enabled. Recovery uses a retained verified host VSIX and its engine release; keep the current and previous verified release. Session and account data under the Azrael state root are separate from extension installation and are not backed up by this installer.

Each deployable engine bundle carries a provenance receipt: source checkout HEAD, a digest of tracked and nonignored untracked file contents (including deletions), fixed target, relevant Rust build environment, and hashes for the source-built engine and management bridge. The compatible code-mode host is imported from an installed Codex runtime, identified by original absolute path and SHA-256, copied beside the engine and covered by the bundle hash; it is not described as source-built while the upstream Windows `rusty_v8` asset is unavailable. Full builds compare source snapshots before and after compilation; packaging and installation verify the receipt against current sources and all three binaries. Missing provenance or any mismatch requires rebuilding. A new package timestamp never establishes that a reused engine contains current work.

Generated packages, releases, logs and fixtures live under the Git-ignored project `artifacts/`. Each release holds one engine/bridge pair and the internal account package; running release binaries are never overwritten. Account-module builds use a fresh staging copy under `artifacts/build/` so rebuilding never removes native modules loaded by a running host.

## Storage and host runtime

### Local session links

Status: `partial` — source transforms, migration ownership and external URL translation are verified without a build; installed UI and OS click dispatch require a matching package and user protocol registration.

Azrael generates local session links as `azrael://threads/<UUID>`. Link generation, parsing and click handling use the same protocol. The UUID identifies an existing Azrael session; the URL conveys no authority to import ordinary Codex state. A Windows user protocol handler validates the local URL and forwards it to the existing VS Code extension URI handler as `vscode://azrael-ex-local.azrael/local/<UUID>`. The route translation is necessary because the host navigates the supplied path directly. Supported review parameters retain their route meaning; extra path segments and URL fragments are rejected because that handler does not navigate to their targets. Original Codex protocol ownership, non-thread review/plugin URLs, specialized artifact links, remote-host links and internal storage identifiers retain their respective contracts.

Legacy `codex://threads/<UUID>` conversion is an explicit Azrael command. It validates the URL and checks that the session exists in Azrael before copying a canonical link. Unknown sessions fail without importing or opening ordinary Codex data. Existing conversation JSONL is preserved. Normal Azrael routing uses the canonical protocol; legacy handling is limited to this conversion boundary.

Protocol installation records its owner and launch configuration under the current user, refuses another owner's registration, and preserves a recovery receipt. Isolated/custom profile installations do not replace the ordinary profile's handler. No global `codex` registration is claimed.

### Native state

The engine uses an absolute `CODEX_HOME`, defaulting to `~/.azrael-ex`, and the root stays fixed across account switches. Config, logs, caches and user skills resolve there; project config and managed policy retain native precedence. Native storage formats and reviewed Azrael migrations belong to the selected engine. Authentication, account, lock, socket and pipe state are private to Azrael. Ordinary Codex session data is copied only through the explicitly configured [local history import](#local-history-import); that path does not share a writable state root or import credentials.

The host wraps the pinned native implementation with a private process-environment overlay and overrides the native engine resolver; it passes the same runtime to the account module. It never changes user/system environment variables or editor settings. The host runtime registry keys the physical runtime file with case-insensitive normalization on Windows, so loads of the same path with different drive-letter casing receive the identical runtime and process proxy within one extension host; separate extension hosts remain isolated. The private environment canonicalizes Windows `Path`/`PATH` to one `PATH` key before the pinned bundle appends its tool directory.

### Local history import

Status: `partial` — source and disposable importer/supervisor fixtures cover ownership and retry contracts; native execution and installed acceptance remain environment-specific in [Linux operations](../ops/linux.md).

A runtime with `localHistory.sourceHome` enables a one-way import from a separate local Codex home into the Azrael home. The current supervisor uses Linux Python and filesystem facilities; its existence does not establish Windows or macOS import support. A runtime without this configuration performs no import. The source is read-only, source and target homes must remain distinct, and only supported regular rollout files and associated history projections are considered.

Activation records an exclusive attempt marker for the application version before starting the importer. Reloads and concurrent windows do not start another import for that version. Within the attempt, interrupted children retry up to the bounded retry limit; permanent failure retains a failed marker, logs the unavailable import and allows chat activation to continue. A different application version has its own attempt. Import completion precedes the host's native activation; it does not authenticate or copy ordinary Codex credentials.

Existing Azrael thread metadata and continued history win. Refresh is permitted only for importer-owned file generations whose recorded file identity and thread update identity still match, and is suppressed while the target engine is active. Indexed thread identities and rollout UUIDs prevent an unindexed source rollout from overwriting another Azrael projection; ambiguous source UUIDs are skipped. An interrupted import may resume only its recorded file generation. Missing, linked, changed or independently owned destination files cannot be replaced merely because their filename matches.

The importer maintains private ownership/pending-generation metadata and a receipt in the target home. Source/native formats remain the authorities for session interpretation. Receipt existence or a copied JSONL file does not establish installed resume or complete import acceptance.

## Codex environment snapshot

The approved package-owned `node_repl` runtime, Computer Use child isolation and app approval contract are defined in [Computer Use](computer-use.md). That target replaces ordinary Codex's machine-bound Node REPL paths and temporary Computer Use pipe when the integration is enabled; its installed-host acceptance is tracked separately.

Installation takes a one-way snapshot of an allowlisted, machine-bound part of the ordinary Codex environment, selected by `scripts/azrael-codex-environment.json`: marketplaces, plugin/app enablement, selected MCP servers, notify, selected features, shell-environment policy keys and desktop follow-up queue mode. Instructions, agent roles and skills are not part of this snapshot; they belong to the [shared environment](#shared-environment-sync). Azrael's root model, reasoning effort, service tier, model catalog, sandbox/project policy and all credentials remain authoritative. Preparation validates without applying; normal installation applies after package checks and records a separate receipt, so a later VSIX failure does not undo an applied snapshot.

Snapshot preparation parses complete TOML values with Python's standard parser, merges selected values, rewrites managed home references, validates runtime files and hashes, and materializes enabled plugins from an Azrael-local marketplace snapshot. Formatting is canonicalized and comments are not retained. The complete managed file/directory/link state participates in idempotency checks. Concurrent source/destination edits detected during staging reject the commit, and a commit lock serializes writers. Handled errors restore backed-up targets; after process termination or power loss the retained `recovery.json`, previous files and stale lock must be reviewed, because the multi-file operation is not crash-atomic. OAuth-backed MCP/apps copy only declarations and enabled state and remain disconnected until authenticated in Azrael. Missing runtimes, marketplaces, malformed config or failed plugin materialization abort preparation without replacing the current managed environment.

## Shared environment sync

The maintained instruction library and distribution settings are owned by [instruction distribution](instructions.md). This section describes the optional configured Git synchronization path.

Status: `partial` — implemented and locally tested; packaged-host acceptance is outstanding.

A configured Git repository supplies the optional shared-environment synchronization bundle: global `AGENTS.md`, standalone agent roles, personal skills, the `[agents]` config keys, and a playbook library. Its `azrael-environment.json` manifest selects the contents: `environment/` is applied as one bundle, `library/` holds managed but unapplied skills, and `playbooks/` is fetched selectively into a workspace's `docs/playbooks/`. The maintained instruction distribution provides `luna_explorer` and `sol_executor`; it does not install a Devin-specific agent role. Optional generated roles declared by a configured bundle derive their developer instructions from the declared source and must be byte-identical after TOML parsing.

The host exposes `azrael.sharedEnvironment.repository` and `azrael.sharedEnvironment.ref` plus the `azrael.syncSharedEnvironment` and `azrael.fetchSharedPlaybook` commands. Sync is manual; activation never fetches. The packaged `account-ui/sync-shared-environment.cjs` runs with the host's Node runtime and the pinned engine for staged config validation. It keeps a managed checkout at `CODEX_HOME/azrael/shared-environment`, refuses a dirty checkout or mismatched origin, fetches the configured ref, then applies the bundle with the same staged-commit pattern as the Codex snapshot: containment checks, concurrent-change detection, commit lock, timestamped backup with `recovery.json`, and a fingerprint receipt at `azrael/shared-environment/snapshot.json`. Identical fingerprints return `unchanged`; `--mode validate` stages and checks without applying. Applied changes take effect on new threads; running windows and threads are not restarted.

## Recent-chat list

Status: `partial` — packaged and verified in isolated host acceptance; live user-state visual acceptance is outstanding.

The Azrael sidebar's recent-chat list supplies the native server-side `cwd` filter for the file-system roots of the current VS Code workspace; a multi-root workspace returns the union, and a window without an eligible root shows no recent sessions rather than all history. The same request supplies `modelProviders: []`, because the native server treats an omitted or null provider filter as the configured default provider, while an empty array removes the provider restriction; conversations from every provider therefore remain listed after reload. The request preserves the caller's `sourceKinds`, including an omitted or null native default; it does not force an all-source selection. Workspace, archive, source and pagination filters stay in effect, and filtering happens before pagination. Stored sessions are not rewritten, app-server projects are not created, and the experimental `projectId` filter is not used.

The pinned Webview marks only its `recent_threads` request. The extension host, which owns access to workspace folders, removes the marker and supplies `cwd` and `modelProviders` at the common app-server request boundary. Archive checks, collaboration hydration and other unmarked `thread/list` requests are unchanged. Preparation fails closed if the pinned recent-list call shape or the host request boundary changes.

The shared recent-chat discovery policy requests 100 rows on the ordinary refresh path and retains up to 100 hydrated recent rows after expanded discovery. The default discovery limit is 100 for extension/local and cloud hosts; the existing desktop expanded limit of 500, catalog-only/disabled paths, cursor pagination and active/pinned-session retention remain in effect. This source policy is preserved by `ui.recent-chat-filter`; Windows native JavaScript behavior checks do not establish installed-host or native Linux/macOS acceptance.

## New conversation history and immediate stop

New-chat drafts and session creation at first submission follow [the composer contract](ui-presentation.md#session-creation-at-submission). Project-scoped draft persistence is independent of native thread creation and remains preserved by `ui.project-drafts`; `ui.submit-only-thread` owns the shared creation boundary.

Status: `partial` — source-level checks verify that new persistent conversations use paginated history and its native turn-ID-based `thread/revert` edit path. Ephemeral conversations retain their native creation behavior. Existing legacy conversations are outside this change and are not converted or relabeled.

A user stop during submission applies to that submission only. The UI retains the stop intent while the same turn is pending, waits for its admitted identity, and distinguishes an activation race from a confirmed terminal turn. An interrupt acknowledgement alone does not authorize editing: the selected turn must reach a confirmed terminal state. A different later turn, an unavailable connection, or an unresolved deadline cannot be treated as successful cancellation. Start admission and interrupt termination checks each have a 20-second deadline; expiry ends that check without scheduling a later interrupt. Errors remain visible through the native UI boundary.

The version-pinned UI transforms reuse native turn creation, interruption, history projection and edit handlers. Source-level asynchronous fixtures verify the affected paths; installed-host acceptance is separate from those checks.

### Native history projection after revert

Status: `partial`: common thread-store implementation; focused Windows native checks verify derived projection repair independently of installed-host acceptance.

Paginated history projection cursors and rows belong to the concrete immutable rollout ID. A same-thread revert can select a different rollout while retaining earlier segment references; appends to the replacement use its own cursor and preserve the earlier segment projections. An older derived projection version is rebuilt lazily from authoritative rollout data. A same-ID shortened rollout is rebuilt only after validating its complete prefix, and a transaction compares the original cursor before replacing derived rows. Changed cursors, malformed or incomplete shortened data fail without discarding the existing projection. Original rollout files are never rewritten by projection repair.

This native preservation scope is registered with `engine.recovery` and linked to the [focused recovery checks](../ops/development.md#reload-recovery); `ui.paginated-history` retains its separate UI scope.

## Conversation branching

Status: `partial` — pinned source fixtures verify branch selection and UI eligibility; packaged/live-host acceptance is pending.

The pinned UI's completed-response branch action uses the native `thread/fork` boundary for OpenAI, managed and Devin-native conversations, including a completed response in a source whose later turn is still running. Branch eligibility keeps read-only, supported host and canonical-turn checks. Provider selection and continuity follow [conversation branching](managed-providers.md#conversation-branching). The host supplies a guarded, version-pinned UI transform; the original UI snapshot and the running installed extension are preserved.

## Chat content handling

Status: `partial` — source-level checks pass; installed-host behavior is verified separately in operations.

**Image input to providers.** Attached images are sent to a managed or Devin-native provider only when that exact model advertises image input, which is derived from the provider's own capability data rather than a model name or family. A text-only selection rejects image content explicitly instead of dropping it. Requests are bounded: 32 MiB total, 24 MiB per image and at most 100 images, with `png`, `jpeg`, `gif` and `webp` accepted. Remote image URLs are rejected (`remote_image_unsupported`) because only inline local bytes are forwarded. Per-provider capability sourcing is owned by [managed providers](managed-providers.md#catalog-and-picker) and [Devin](devin.md#catalog-and-model-selection).

**Local image, PDF and HTML links.** Status: `partial` — HTML routing and the explicit VS Code menu action are verified in source tests; packaged/live acceptance is pending. The pinned file-link provider keeps its absolute, cwd-relative and workspace-relative path resolution. Local paths with extensions supported by VS Code's media preview (`jpg`, `jpe`, `jpeg`, `png`, `bmp`, `gif`, `ico`, `webp`, `avif`, `svg`) open with the built-in `imagePreview.previewEditor`. On Windows, local PDF and HTML links (`pdf`, `html`, `htm`, case-insensitive extension) open in Google Chrome independently of the Windows default PDF application. The host verifies that the resolved target is a file, locates Chrome in its standard machine-wide or per-user installation paths, and launches it without a shell using an encoded file URL. Missing files, unavailable Chrome and launch failures use the provider's existing failure path. Browser-opened links do not request text line/column selection. The file context menu provides **VS Code에서 열기**, which explicitly selects the VS Code text-document route, including line/column selection, rather than browser or media preview routing. File-manager targets keep OS reveal behavior; other files keep the text-document route with line/column selection. The transform is guarded by a unique pinned source anchor.

**Dragged local files.** Dragging saved files from a VS Code editor tab, VS Code Explorer or Windows File Explorer into the composer adds removable file-reference chips without sending the turn. Only local `file:` URIs are accepted; the existing file-metadata request confirms each path is a file before the existing picked-file flow adds it. The turn receives the path and label, not a snapshot of unsaved editor changes. Images use the existing image attachment path. Duplicates collapse; remote schemes, directories, inaccessible files and ordinary links are rejected.

**External image URL safety.** The host's POST to the exact `https://chatgpt.com/backend-api/ecosystem/url_safe` endpoint uses Node's standard HTTPS client; other requests keep the upstream fetch transport, and configured proxy routes keep the upstream transport instead of silently going direct. The request keeps the host-built authentication headers, uses normal TLS verification, refuses redirects, and bounds duration (15 seconds) and response size (64 KiB). The UI's `safe === true` gate stays authoritative: `safe: false`, transport failure, invalid responses and unavailable checks never authorize rendering. No browser session, cookie import, challenge solver, domain exemption or direct-image fallback exists. Diagnostics carry transport, status, challenge indication and elapsed time, never credentials, cookies, bodies or the image URL. This transport does not establish image safety or guarantee acceptance on every network.

### Webview drag recovery

Status: `partial` — guarded source transformations and Windows isolated native host verification; normal installation and the reported full gray-screen symptom remain separate acceptance scopes.

The composer clears its drag counter, active flag, Shift overlay and portal state at drop/cancellation and when its portal target is removed or replaced. A leave event balances an existing drag counter even if its current transfer types are unavailable. Nested enter/leave ordering remains balanced; attachment parsing, native Shift behavior and ordinary text selection/dragging are preserved. The owning preparation transform is `scripts/inject-local-file-drop.cjs`, with cancellation registration in `scripts/webview-drag-lifecycle.cjs`. This shared UI behavior has Windows execution evidence only.

The desktop host temporarily disables Webview pointer events while dragging. Its drag monitor must restore input on capture-phase drop/dragend, window blur, document hidden and monitor disposal, using its existing `windowDidDragEnd()` method for each monitored view. The separate `scripts/patch-vscode-webview-drag.cjs` tool matches one known monitor structure and refuses unknown, ambiguous or damaged bundles. It defaults to a read-only check; explicit apply and restore require the selected Windows host to be stopped. Apply retains the original bundle and SHA256 receipt; restore refuses a changed host or backup. It changes no account data, extension configuration, product API policy or application version. Host updates require a new compatibility check. Native verification uses a copied host and synthetic text/link/file-reference payloads, rather than claiming actual conversation-card or full gray-screen acceptance.

The `ui.local-file-drop` preservation feature connects the UI and host owners to `scripts/test-webview-drag.cjs`. Host repair is opt-in and independent of the normal build/install pipeline. The application procedure is owned by [Webview drag repair](../ops/webview-drag-repair.md).

## Platform scope

### Windows sandbox launcher

Status: `target` for the integration candidate.

The MXC launcher uses executor-owned `SystemDrive`, `LOCALAPPDATA` and `SystemRoot` to resolve Windows platform directories and initialize the native sandbox. The bounded launcher payload separately records the command's already-filtered environment. The sandboxed command receives that exact environment, including an intentionally empty environment; launcher setup values, transport variables and unrelated parent credentials are excluded. Caller overrides apply to the command environment and cannot select the launcher's platform directories.

Runtime preparation and admission use the selected platform descriptor and explicit local home. Windows x64, glibc Linux x64 and macOS ARM64 contracts, release maturity and environment-specific exclusions are governed by [multi-platform runtime and maintenance](multi-platform.md). The selected release's platform evidence determines native and installed-host acceptance; source support or a result on another OS does not establish it. Remote and unsupported host execution must not mix an engine with another environment's state root. WSL fixture execution and public distribution retain the distinctions in that platform contract.
