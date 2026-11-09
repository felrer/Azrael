# azrael-ex host and storage

<!-- architecture: {"id":"arch.system.host","feature":null,"layers":["host","engine"]} -->

Status: `current` for the single-extension host, storage and environment contracts below; `partial` where a section says so. The replacement target for the engine and provider layer is [Azrael runtime and providers](runtime-target.md). Supported commands and verification scope are owned by [development operations](../../ops/development.md).

Related designs: [accounts and usage](../features/accounts/README.md), [Devin](../features/devin-inference/README.md), [managed providers](../features/managed-providers/README.md), [root resume scheduling](../features/root-resume/README.md), [queued compaction](../features/queued-compaction/README.md), [reload recovery](../features/conversation-recovery/README.md).

## Product and boundaries

`azrael-ex-local.azrael` is one installed VS Code extension that owns chat, account management and usage. It is installed into the ordinary VS Code profile beside the original `openai.chatgpt` extension, which stays unmodified, may coexist, and is not an activation dependency. The account module is embedded in the host; there is no separately installed companion extension.

The chat UI is a local, hash-pinned copy of the official Codex extension UI, namespaced for Azrael and combined with an Azrael-built integrated engine. The selected UI, engine source and installed release are identified by [source and state](../../ops/development.md#source-and-state) and each release's provenance receipts. UI source hashes, transform-rule hashes, the engine source fingerprint and binary hashes are recorded with each prepared host. Native authentication identifiers and upstream network endpoints are preserved.

The host entry point activates the pinned UI host first, then initializes the embedded account module with the same host-local runtime and extension context. The wrapper preserves the host activation result and disposes both modules on shutdown. No module activates or discovers another extension to reach the engine. Commands and panels use `azrael.*`; the profile menu has one **계정 및 사용량** entry dispatching `azrael.usage`. An invalid local runtime produces an explicit unavailable error rather than silently ignoring a menu action.

### Runtime preparation

Status: `partial`: source-level worker and lifecycle fixtures verify asynchronous activation preparation; installed-host and other-platform execution remain separate. The integrated entry prepares its runtime in a Node worker before loading the pinned host and account modules. The worker uses the same platform, file-integrity, executable, isolated-state and provider validators as direct synchronous consumers. It publishes the completed runtime only after receiving a result and observing successful worker termination. Validation failure or termination without a result fails activation; pending preparation cannot expose a partially configured environment. Concurrent preparation within the same physical runtime module shares one promise, including Windows path aliases. A failed preparation may be retried, with all validators rerun.

The extension host retains its own process environment. Only the pinned host receives the prepared environment proxy. Shared-engine hash and native endpoint validation still finish before module activation; per-process identity checks and lifecycle-lock validation retain their existing authority. This common host contract applies to the supported local desktop targets in the [platform contract](../shared/platform.md) and is preserved under feature `engine.shared-engine` in the [feature inventory](../../../scripts/azrael-feature-contracts.json). Worker offloading reduces blocking of the extension-host event loop; it does not establish a shorter total startup time or installed-host acceptance.

The Azrael presentation boundary, composer feature surface and fixed/dynamic typography policy are owned by [UI presentation](../shared/ui-principles.md). Candidate icon and typeface comparisons are separate from the installed host state.

The account module must control the same engine instance as the chat UI. It connects through an explicitly enabled management socket alongside the official stdio channel (WebSocket frames over AF_UNIX, including on Windows), using native private-directory checks and the Rust client's current-user, non-elevated peer checks through the `azrael-bridge` binary. The bridge is a companion connection with restricted methods, not a proxy replacing stdio. A second engine controlling only its own account does not satisfy this design.

The [shared-engine candidate](runtime-target.md#공용-실행기와-창-수명) is `partial`. Prepared runtime metadata opts into protocol 1 and pins the `azrael` binary SHA-256. The native UI retains its stdio interface through a thin engine connector; that connector and the account bridge register the same window context at the state home's deterministic private endpoint. Window registration includes the actual extension-host PID, session-derived owner ID, workspace storage identity and existing account selection paths. Companion connections do not extend the engine's window lifetime. Host source tests and Windows native lifecycle, context rejoin and final-close interruption checks pass. A single-backend idle memory measurement is recorded in the current work; installed-host acceptance and other operating systems remain unverified. Legacy fixture runtimes without the shared-engine opt-in retain their existing startup contract.

The local extension ID is not entitled to the original extension's proposed VS Code APIs, so `chatSessionsProvider`/`languageModelProxy` declarations and the contributed chat-session entry are omitted; the stable sidebar/Webview/custom-editor surfaces remain. VS Code's global API allowlist and product configuration are never altered. Normal extension preparation and installation do not patch VS Code. The explicitly authorized [Webview drag recovery](../features/conversation-content/README.md#webview-drag-recovery) tool is a separate, reversible host-bundle exception; it does not grant proposed APIs or change startup policy. The Windows host IPC pipe is `azrael-ipc`, separate from `codex-ipc`; randomized temporary paths and native app-server provider keys are preserved. The rules language has its own ID without claiming ordinary `.rules` associations.

Reuse the official General, Configuration, Personalization, Usage/Billing, MCP, Hook, Plugin and Account settings; the account module adds account management and entry points. A settings category counts as verified only after reading, saving, rereading and observing its effect; settings requiring reload or a new thread must say so. Ordinary Codex retains `chatgpt.*` preferences; Azrael owns `azrael.*`.

### MCP startup and cached catalogs

Status: `current` source behavior, verified by focused Windows x64 tests in the [memory work record](../../../work/DJ-01-azrael-memory-analysis/01-plan.md). Linux x64 and macOS ARM64 native acceptance is pending; packaging and installed-host acceptance remain separate. Preservation ID: `engine.mcp-lazy-startup` in the [feature inventory](../../../scripts/azrael-feature-contracts.json).

Ordinary conversations and subagents use the existing `LazyWhenCached` startup policy. A compatible cached catalog can advertise permitted tools without starting that conversation's MCP server. The first operation requiring a live client starts its own server; live permissions and tool visibility are checked before execution. Execution state, credentials and approvals remain scoped to the existing thread/runtime boundaries. This common policy applies to Windows x64, Linux x64 and macOS ARM64; native verification on one platform does not accept the others.

Cold or unusable catalogs, selected plugin servers, explicit reconnect and existing dynamic-authentication cache exclusions retain their startup behavior. Required servers may accept a valid dormant catalog through existing readiness rules; a deferred connection failure is delivered when a live client is requested. Cache expiration and identity changes retain existing invalidation rules. Catalog caching does not share process execution state and does not add an idle shutdown timer. Conversation unload, REPL state lifetime and relay process sharing are unchanged.

Provider-specific compaction settings, Azrael settings labels and context pricing presentation follow the [provider context policy](../features/context-budget/README.md).

The azrael-only host supplies the existing first-run tutorial completion flags and the image-generation announcement dismissal flag on state reads. It does not suppress authentication, permission approvals, errors or settings. A source/patched-hash marker guards this patch; unsupported bundles fail preparation.

## Integrated source state

Status: `partial` — source integration, scoped feature verification and installed releases have separate acceptance boundaries. Current inputs and execution evidence are owned by [development operations](../../ops/development.md#source-and-state); a newer checkout does not establish what an existing window runs.

The selected integrated engine root contains the reviewed Azrael changes and its source receipt. Official source ancestry, complete copied bytes and subsequent reviewed local changes are recorded independently of feature acceptance. The historical upstream checkout is a reference input. Pinned pristine UI assets are transformed at preparation time; incomplete or unknown anchors reject the candidate. Existing provider, account, recovery, queue and host contracts remain applicable across updates under [upstream preservation](../shared/feature-preservation.md).

### Integration candidate

Status: `target` for each proposed update until its selected inputs pass acceptance.

A candidate combines a selected official Codex source/UI with the reviewed Azrael integration. Existing behavior contracts, assets, source adaptations and guarded UI anchors are accounted for against that candidate. A source import preserves already integrated bytes and provenance; it does not automatically port missing changes to a new official version or prove functional preservation. The prepared UI is generated through the integrated transformation pipeline; a pristine upstream directory alone is not the product.

Candidate sources and packages have distinct immutable paths. The installed source snapshot and retained releases keep their original provenance until a verified candidate is selected for application. Native endpoint model isolation follows the [provider catalog contract](../features/managed-providers/README.md#native-endpoint-catalog-isolation).

## Storage and host runtime

### Persistent UI atoms

Status: `partial` — source implementation uses the host's built-in Node SQLite; installed migration and normal-operation acceptance require a matching package and reloaded windows. Feature `host.persisted-atoms` owns preservation checks.

`scripts/persisted-atoms.cjs` stores UI atoms as individual JSON rows in `globalStorageUri/atoms-v1/persisted-atoms.sqlite`. MCP tool caches, prompt history, drafts and preferences retain their existing keys and JSON shapes. Small preference writes do not rewrite the MCP cache or other unchanged rows. Other extension Memento entries retain their existing owner and storage.

Before native activation, one transaction imports the existing `persisted-atom-state` and commits a schema marker. Only a successful import permits removal of the legacy Memento entry. A failed legacy removal preserves both copies and retries removal at the next activation without importing stale data again. The marker survives reset, so old legacy snapshots cannot resurrect reset atoms. Migration failure preserves the source and stops activation; database corruption is reported rather than silently resetting user state. All old windows must reload with the matching host; mixed-version concurrent writers are not a supported migration mode.

Atom updates are collected for 10ms and applied in arrival order in a SQLite transaction. Every returned save promise waits for commit; a failed batch rolls back and rejects its callers. Equal values cause no row write; direct-value no-ops also skip UI notification. Conditional record no-ops still return authoritative state to reconcile optimistic views. Record updates retain the pinned native merge and nullish legacy fallback semantics; SQLite serializes transactions across windows. Reads flush pending local updates, reset shares the ordered queue, and deactivation drains accepted updates. Busy admission retries asynchronously for at most five seconds instead of blocking the host on a lock. SQLite WAL and full synchronization own durable commit and crash recovery. Pending, unacknowledged changes can be lost on forced termination, as with other asynchronous saves.

The pinned host transform preserves project draft filtering, normal atom messages and reset notifications. Entry snapshots are read lazily for listeners, avoiding construction of the entire state on each small save. `Azrael State` emits cumulative numeric transaction/update/skip/byte/failure/duration counters at most once per minute while saving, plus shutdown; atom values, prompts and cache contents are excluded. Actual process crash causes remain outside this storage contract.

### Local session links

Status: `partial` — source transforms, migration ownership and external URL translation are verified without a build; installed UI and OS click dispatch require a matching package and user protocol registration.

Azrael generates local session links as `azrael://threads/<UUID>`. Link generation, parsing and click handling use the same protocol. The UUID identifies an existing Azrael session; the URL conveys no authority to import ordinary Codex state. A Windows user protocol handler validates the local URL and forwards it to the existing VS Code extension URI handler as `vscode://azrael-ex-local.azrael/local/<UUID>`. The route translation is necessary because the host navigates the supplied path directly. Supported review parameters retain their route meaning; extra path segments and URL fragments are rejected because that handler does not navigate to their targets. Original Codex protocol ownership, non-thread review/plugin URLs, specialized artifact links, remote-host links and internal storage identifiers retain their respective contracts.

Legacy `codex://threads/<UUID>` conversion is an explicit Azrael command. It validates the URL and checks that the session exists in Azrael before copying a canonical link. Unknown sessions fail without importing or opening ordinary Codex data. Existing conversation JSONL is preserved. Normal Azrael routing uses the canonical protocol; legacy handling is limited to this conversion boundary.

Protocol installation records its owner and launch configuration under the current user, refuses another owner's registration, and preserves a recovery receipt. Isolated/custom profile installations do not replace the ordinary profile's handler. No global `codex` registration is claimed.

### Native state

The engine uses an absolute `CODEX_HOME`, defaulting to `~/.azrael-ex`, and the root stays fixed across account switches. Config, logs, caches and user skills resolve there; project config and managed policy retain native precedence. Native storage formats and reviewed Azrael migrations belong to the selected engine. Authentication, account, lock, socket and pipe state are private to Azrael. Ordinary Codex session data is copied only through the explicitly configured [local history import](#local-history-import); that path does not share a writable state root or import credentials.

The host wraps the pinned native implementation with a private process-environment overlay and overrides the native engine resolver; it passes the same runtime to the account module. It never changes user/system environment variables or editor settings. The host runtime registry keys the physical runtime file with case-insensitive normalization on Windows, so loads of the same path with different drive-letter casing receive the identical runtime and process proxy within one extension host; separate extension hosts remain isolated. The private environment canonicalizes Windows `Path`/`PATH` to one `PATH` key before the pinned bundle appends its tool directory.

### Local history import

Status: `partial` — source and disposable importer/supervisor fixtures cover ownership and retry contracts; native execution and installed acceptance remain environment-specific in [Linux operations](../../ops/linux.md).

A runtime with `localHistory.sourceHome` enables a one-way import from a separate local Codex home into the Azrael home. The current supervisor uses Linux Python and filesystem facilities; its existence does not establish Windows or macOS import support. A runtime without this configuration performs no import. The source is read-only, source and target homes must remain distinct, and only supported regular rollout files and associated history projections are considered.

Activation records an exclusive attempt marker for the application version before starting the importer. Reloads and concurrent windows do not start another import for that version. Within the attempt, interrupted children retry up to the bounded retry limit; permanent failure retains a failed marker, logs the unavailable import and allows chat activation to continue. A different application version has its own attempt. Import completion precedes the host's native activation; it does not authenticate or copy ordinary Codex credentials.

Existing Azrael thread metadata and continued history win. Refresh is permitted only for importer-owned file generations whose recorded file identity and thread update identity still match, and is suppressed while the target engine is active. Indexed thread identities and rollout UUIDs prevent an unindexed source rollout from overwriting another Azrael projection; ambiguous source UUIDs are skipped. An interrupted import may resume only its recorded file generation. Missing, linked, changed or independently owned destination files cannot be replaced merely because their filename matches.

The importer maintains private ownership/pending-generation metadata and a receipt in the target home. Source/native formats remain the authorities for session interpretation. Receipt existence or a copied JSONL file does not establish installed resume or complete import acceptance.

## Platform scope

### Windows sandbox launcher

Status: `target` for the integration candidate.

The MXC launcher uses executor-owned `SystemDrive`, `LOCALAPPDATA` and `SystemRoot` to resolve Windows platform directories and initialize the native sandbox. The bounded launcher payload separately records the command's already-filtered environment. The sandboxed command receives that exact environment, including an intentionally empty environment; launcher setup values, transport variables and unrelated parent credentials are excluded. Caller overrides apply to the command environment and cannot select the launcher's platform directories.

Runtime preparation and admission use the selected platform descriptor and explicit local home. Windows x64, glibc Linux x64 and macOS ARM64 contracts, release maturity and environment-specific exclusions are governed by [multi-platform runtime and maintenance](../shared/platform.md). The selected release's platform evidence determines native and installed-host acceptance; source support or a result on another OS does not establish it. Remote and unsupported host execution must not mix an engine with another environment's state root. WSL fixture execution and public distribution retain the distinctions in that platform contract.

## Related design owners

- [Installation recovery](../shared/platform.md)
- [Shared environment sync](../features/instruction-management/environment.md)
- [Cold resume history preparation](../features/conversation-history/README.md)
- [Conversation branching](../features/conversation-branching/README.md)
- [Webview drag recovery](../features/conversation-content/README.md)
