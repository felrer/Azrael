# Code Maps

Use the task routes below to choose a code entry point, its contract owner and the relevant verification procedure.

## Select The Engine Source

Before reading or changing engine code, resolve its source root through [Source and state](../ops/development.md#source-and-state). For an existing release, its `build-info.json` records `engineSourceRoot`; use that receipt to identify the source that produced the package. When diagnosing an active window, first establish the running engine/release through [native diagnostics](../ops/devin-native.md#diagnostics); an installed package or a newer source checkout alone does not establish what the window runs.

Entries beginning with `codex-rs/` below are relative to the selected engine source root. Other full paths are relative to the project root; short filenames listed alongside a full path share that entry's directory. `upstream/codex` is an older reference baseline and must be selected explicitly for baseline investigation; it is not the default edit or build target. Keep source locations and runtime versions authoritative in the operational owner rather than inferring them from this map.

## Route By Task

Follow the relevant row from code to contract to verification. A row does not require reading every linked document in full.

| Task signal | Code entry and next read | Contract owner | Verification or operation |
| --- | --- | --- | --- |
| Native inference stalls, retries or returns incomplete calls | `codex-rs/core/src/devin/native_runtime.rs` → `native_runtime_activity.rs`, `native_runtime_recovery.rs`; provider events originate in `providers/devin/helper.mjs` or `providers/opencodex/inference.ts`. | [Shared activity and recovery](../architecture/devin.md#inference-activity-and-bounded-recovery) | [Native validation](../ops/devin-native.md#validation) and [diagnostics](../ops/devin-native.md#diagnostics) |
| Tool catalog/schema rejection or tool/history conversion | `codex-rs/core/src/devin/native_tool_diagnostics.rs`, `native_runtime_tools.rs` → `providers/devin/mapping.mjs` or `providers/opencodex/inference-mapping.mjs`. | [Tool contract](../architecture/devin.md#tool-contract) and [diagnostic scope](../architecture/devin.md#tool-request-diagnostics) | [Native diagnostics](../ops/devin-native.md#diagnostics) |
| Managed provider selection, reasoning or provider handoff | `codex-rs/core/src/managed_catalog.rs`, `managed_runtime.rs` → `providers/opencodex/inference.ts`, `catalog.ts`, `reasoning.ts`; history handoff is in `codex-rs/core/src/session/provider_handoff.rs`. | [Managed providers](../architecture/managed-providers.md) | [Managed validation](../ops/provider-accounts.md#validation) |
| Branch from a completed response in a provider thread | `scripts/inject-thread-branch.cjs`, `thread-branch.cjs` → native `thread/fork`; pinned UI eligibility remains in the local conversation turn/thread assets. | [Conversation branching](../architecture/managed-providers.md#conversation-branching) | `node --test scripts/test-thread-branch.cjs scripts/test-provider-model-picker.cjs` checks source fixtures without a build; packaged/live acceptance is separate. |
| Host activation, UI preparation or package provenance | `scripts/integrated-azrael-entry.cjs`, `prepare-independent-vscode.ps1` → `prepare-official-ui.ps1`, `namespace-azrael-host.cjs`, `build-azrael.ps1`. | [Host and storage](../architecture/azrael-ex.md) | [Build](../ops/development.md#build), [prepare/verify/install](../ops/development.md#prepare-verify-and-install) and [host transforms](../ops/development.md#host-transforms) |
| Account selection, authentication or usage UI | `extensions/azrael-ex/src/accountService.ts`, `providerAccountService.ts` → engine `codex-rs/login/src/auth/` or `providers/opencodex/` for the relevant provider. | [Accounts and usage](../architecture/accounts.md) | [Account checks](../ops/development.md#accounts) and [provider account operations](../ops/provider-accounts.md) |
| Reload recovery or continuation admission | `scripts/azrael-recovery.cjs`, `recovery-state.cjs` → `inject-recovery.cjs` and the native thread state queried by the bridge. | [Reload recovery](../architecture/reload-recovery.md) | [Recovery checks](../ops/development.md#reload-recovery) |
| Queued compaction or root resume scheduling | Queue: `codex-rs/ext/queue/src/service.rs` → `codex-rs/core/src/session/compact_input.rs`; scheduling: `codex-rs/core/src/session/root_resume.rs`. | [Queued compaction](../architecture/queued-compaction.md) and [root resume](../architecture/root-resume.md) | [Queue checks](../ops/development.md#queue-and-compaction) and [reservation checks](../ops/development.md#root-resume-reservations) |

## Entry Inventory

Computer Use runtime staging and verification are owned by `scripts/computer-use-runtime.cjs`; the host app consent store and settings are owned by `scripts/computer-use-approvals.cjs`, with pinned forwarding hooks in `scripts/inject-computer-use.cjs`. Their contract is [Computer Use](../architecture/computer-use.md).

Selected-window Computer Use uses `scripts/window-control-host.cjs` for conversation/UI ownership, `window-control-policy.cjs` for selection and operation checks, `window-control-mcp.cjs` for the model transport, and `window-control-backend.cjs` for its owned native child. `native/window-control/` implements Windows capture and UI Automation; `scripts/window-control-runtime.cjs` verifies the packaged payload. The native engine owns the durable selected-window tool ceiling. Live Windows acceptance remains a separate gate.

| Entry | Role |
| --- | --- |
| `providers/devin/helper.mjs`, `mapping.mjs`, `vendor/` | Minimal pinned Devin inference transport and reversible native tool/history mapping; never executes tools. |
| `codex-rs/core/src/devin/native_runtime*.rs` | Opt-in inference bridge, validated frames, child lifetime, CLI credential reads and runtime/session binding. |
| `scripts/start-devin-native.ps1` | Opt-in CLI/app-server launch with explicit helper, existing native policy and CLI-owned catalog. |
| `scripts/devin-native-host.cjs`, `ordinary-runtime.cjs` | Verify the native release and configure the VS Code host's scoped helper/Node environment without changing other extensions. |
| `scripts/check-devin-native-engine.mjs`, `check-devin-native-agents.mjs` | Isolated native tools, policy, resume and child lifecycle acceptance; deterministic and real-model scopes are separate. |
| `scripts/start-azrael.ps1` | Prepare/launch an isolated VS Code instance with native azrael state and a matching engine/extension pair. |
| `scripts/build-azrael.ps1` | Build or reuse the engine/bridge, explicitly pin a compatible external code-mode host, package the internal account payload and select the last successful package. |
| `engine/SOURCE.json`, `scripts/import-engine-source.py`, `engine-provenance.py`, `build-engine-source-release.py` | Import and verify the selected engine snapshot, preserve recorded distribution adaptations, bind binaries to its content and generate a complete source archive. |
| `instructions/`, `scripts/import-instructions.py`, `build-instruction-release.cjs` | Complete shared instruction library, independent version/component definitions, source mappings and ZIP/manifest/document release assets. |
| `scripts/instruction-package.cjs`, `extensions/azrael-ex/src/instructionService.ts` | GitHub acquisition, integrity/compatibility validation, managed installation receipts, workspace isolation, pinning, rollback and recovery; host adapter for settings requests. |
| `extensions/azrael-ex/src/instructionView.ts`, `scripts/inject-instruction-settings.cjs` | Shared instruction settings renderer, webview lifecycle and pinned integrated settings navigation/bridge. |
| `scripts/build-metrics.ps1` | Record release-build stage timings and command exit codes without replacing causal build errors. |
| `scripts/deploy-azrael.ps1`, `deployment-input-snapshot.cjs` | Single build/test/prepare/acceptance/install flow, explicit Rust cache forwarding, bounded parallel content fingerprints and input-check reports. |
| `extensions/azrael-ex/scripts/build-incremental.cjs` | Reconcile compiler-owned outputs and reuse development TypeScript state; release packaging retains clean compilation. |
| `scripts/install-azrael.ps1`, `install-independent-vscode.ps1` | Install the integrated azrael host and retire the separate companion while preserving original Codex. |
| `scripts/integrated-azrael-entry.cjs` | Activate the version-pinned Codex UI host and embedded Azrael account module in one lifecycle; embedded mode does not register the temporary `azrael.chat` view. |
| `scripts/azrael-recovery.cjs`, `recovery-state.cjs` | Native bridge recovery, visible execution state, persisted continuation receipts and interrupt-before-resume admission. |
| `scripts/inject-recovery.cjs` | Structurally pin request, notification and teardown hooks in the reused host bundle. |
| `scripts/inject-fetch-response.cjs`, `test-fetch-response.cjs` | Serialize void host route results as JSON null at the producer boundary; verify the pinned fetch handler and webview response parser together. |
| `scripts/inject-ui-cleanup.cjs`, `inject-pets-cleanup.cjs` | Azrael composer placeholders, retired add-menu actions, permission presentation and Pets distribution boundaries; registered in namespace preparation with per-asset cache dependencies. |
| `scripts/inject-auto-review.cjs`, `test-auto-review.cjs`, `verify-auto-review-render.mjs`, `check-auto-review-engine.mjs` | OpenAI-only native permission selection and approval nudge, saved preference preservation, and atomic next-turn reviewer restriction in the native request manager. Source, rendered UI and isolated engine checks have separate acceptance scopes. Contract: [Auto-Review](../architecture/auto-review.md). |
| `scripts/create-ui-design-preview.cjs` | Local SVG icon and static-label font comparisons governed by [UI presentation](../architecture/ui-presentation.md). |
| `scripts/content-fonts.cjs`, `inject-content-fonts.cjs` | Verified local Gyeonggi Batang font resources and semantic content/leaf typography; preserve fixed UI typography through namespace CSS/JS preparation and shared account rendering. |
| `scripts/inject-queue-refresh.cjs`, `inject-queued-compaction.cjs`, `test-queued-input.cjs` | Preserve queue-change notifications during list requests; route manual compaction to typed server queue items, preserve enqueue local declarations, and verify ordinary input and app review boundaries. |
| `scripts/inject-queue-consumption.cjs` | Reconcile local submissions against accepted client IDs before locking; await accepted removal and prevent stale snapshots from resurrecting accepted messages. |
| `scripts/provider-model-picker.cjs`, `inject-provider-model-picker.cjs` | Provider sections/search and scope-aware discovery states; consume every model/list page, preserve native selection callbacks, and transform the pinned query/picker assets. |
| `codex-rs/ext/queue/src/service.rs`, `codex-rs/app-server/src/request_processors/thread_queue_processor.rs` | Durable user-input/compaction queue and RPC mapping, including skipped compaction and continued queue dispatch. |
| `codex-rs/core/src/session/compact_input.rs` | Atomic idle compaction admission and execution-time, strictly-below-15% usage check. |
| `scripts/asset-transform-cache.cjs`, `preparation-state.cjs` | Hash-addressed asset transformations and verified preparation checkpoints; namespace and completed VSIX stages can be reused only with matching inputs and intact contents. |
| `scripts/package-local-host.cjs` | Collect once through pinned VSCE, scan new/changed text, preserve `.env` protection and write the same entries with pinned yazl; emits stage metrics. |
| `scripts/extension-backup-plan.ps1` | Validate registered Azrael host/companion directories and identify unregistered folders; installation omits directory backups and leaves unregistered folders in place. |
| `scripts/directory-state.cjs`, `directory-state.ps1` | Shared full-content directory SHA-256 with bounded concurrency and compatible deterministic aggregation for profile preservation checks. |
| `scripts/prepare-official-ui.ps1`, `prepare-independent-vscode.ps1`, `namespace-azrael-host.cjs` | Hash-pin the official Codex UI source, namespace extension-owned references, record UI/engine/transform fingerprints, and prepare a local independent VSIX when packaging is requested. Source-only updates do not produce or install a VSIX. |
| `scripts/ordered-asset-reader.cjs` | Read UI assets with bounded asynchronous read-ahead while retaining transformation order and draining scheduled reads on failure. |
| `scripts/url-safety-transport.cjs`, `inject-url-safety-transport.cjs` | Exact-route HTTPS transport for the existing external-image URL check; native authentication and fail-closed UI policy remain upstream-owned. |
| `scripts/inject-local-file-drop.cjs`, `test-local-file-drop.cjs` | Recognize VS Code editor and Explorer local-file drag formats in the pinned composer, validate paths through existing host metadata, and reuse picked-file references and image attachments. |
| `scripts/inject-image-file-open.cjs`, `pdf-file-open.cjs` | Route resolved image links to VS Code media preview and Windows PDF links to Chrome, retaining text selection and file-manager reveal behavior. |
| `scripts/sync-codex-environment.cjs`, `azrael-codex-environment.json` | Transactionally snapshot the allowlisted ordinary Codex environment into Azrael, generate the Devin SWE-2 Medium role and retain validation/rollback receipts. |
| `scripts/install-isolated-vscode.ps1` | Historical separate-profile installation retained with prior artifacts for recovery. |
| `scripts/launch-installed-azrael.ps1` | Launch the selected isolated installation through the shared VS Code executable. |
| `scripts/restore-original-codex.ps1` | Validate and back up known ordinary patches, then restore pristine Codex and remove the ordinary companion. |
| `scripts/check-isolated-install.ps1` | Targeted installation, restoration, persistent-profile, launch isolation and failure/refusal checks in fixtures. |
| `scripts/install-existing-vscode.ps1` | Legacy host regression fixture only; refuses ordinary profile deployment. |
| `scripts/prepare-ordinary-vscode.ps1`, `ordinary-runtime.cjs` | Shared pinned host preparation and private runtime reused by isolated installation; historical filenames are retained for existing runtime tests. |
| `extensions/azrael-ex/src/usageView.ts`, `accountView.ts` | Unified Codex-styled account/usage page; native OpenAI actions/status remain in a controller without a separate webview. |
| `extensions/azrael-ex/src/providerAccountService.ts`, `providerAccountProtocol.ts` | Private account helper transport, sanitized provider identities, quota batching and account attribution. |
| `providers/opencodex/` | Pinned upstream account selection, login and quota modules behind an isolated private helper. |
| `providers/opencodex/inference.ts`, `inference-config.ts`, `inference-mapping.mjs` | Managed provider request projection, turn/account binding and native history/event conversion; reuses vendored adapters and never executes tools. |
| `providers/opencodex/antigravity.ts` | Google Antigravity account-scoped OAuth snapshot and stable account/project/transport identity for the shared managed inference path. |
| `providers/opencodex/catalog.ts`, `reasoning.ts` | OpenRouter remote discovery, model-specific effort metadata and verified family fallback, compatible model metadata and bounded credential/endpoint-scoped freshness and stale cache; safe catalog states remain separate from model IDs. |
| `codex-rs/core/src/managed_catalog.rs`, `managed_runtime.rs` | Managed model picker, stream routing, fork provider lineage and request-only OpenAI history projection. Shares the bounded native helper transport with Devin. |
| `scripts/check-managed-native-engine.mjs`, `managed-native-api-fixture.mjs` | Isolated engine/helper acceptance against loopback provider wires; switching, tools, restart, fork, compaction, cancellation and OpenAI return. |
| `scripts/provider-accounts-host.cjs` | Provider bundle verification and scoped helper/Bun/state environment. |
| `codex-rs/core/src/session/account_recovery.rs`, `codex-rs/core/src/managed_account_recovery.rs`, `login/src/azrael_quota_recovery.rs`, `app-server/src/request_processors/account_processor/quota_recovery.rs` | Same-turn recovery on confirmed quota exhaustion, task admission, account-owner commits and public-history boundary; source is the active development engine worktree. |
| `providers/opencodex/auto-switch.ts`, `inference.ts::recoverAccount` | Identity-scoped permission and bounded provider binding recovery without default selection rewriting. |
| `extensions/azrael-ex/src/usagePresentation.ts`, `resetCredit.ts` | Remaining quota bars, native ticket rows, exact selected-ticket consumption and persistent retry identity, with Spark exclusion. Render checks: `scripts/verify-ticket-usage-render.mjs`. |
| `extensions/azrael-ex/src/devinUsage.ts` | Bounded CLI-owned quota helper, PTY screen parsing and process cleanup. |
| `scripts/check-launcher.ps1` | Verify path refusal, settings preservation and child/caller environment isolation. |
| `scripts/check-engine.mjs` | Exercise native stdio and dedicated config/state without login or model requests. |
| `scripts/check-management.mjs` | Exercise simultaneous stdio/local bridge access and process/socket lifetime. |
| `codex-rs/app-server/src/lib.rs` | Existing stdio startup plus the opt-in `AZRAEL_EX_MANAGEMENT_SOCKET` acceptor using the same processor. |
| `codex-rs/app-server-client/src/bin/azrael-bridge.rs` | Restricted companion RPC and account events over the native secure local client. |
| `codex-rs/login/src/auth/profiles.rs` | Native secure profile authentication, metadata and process leases. |
| `codex-rs/login/src/auth/azrael_unmanaged.rs` | Shared credential usage leases, exclusive mutation admission and bounded cross-process credential transactions. |
| `codex-rs/app-server/src/request_processors/account_processor/azrael_state.rs` | Engine-local account state and window-scoped selected-account persistence. |
| `codex-rs/login/src/azrael_admission.rs` | Execution leases and cancelable manual account-change admission. |
| `codex-rs/app-server/src/request_processors/account_processor/` | Staged login, account selection, inactive usage and native auth-state propagation. |
| `codex-rs/app-server-protocol/src/protocol/v2/azrael.rs` | Companion request, state, login and usage contracts. |
| `extensions/azrael-ex/src/extension.ts` | Embedded account module activation from injected host runtime, azrael commands and same-engine connection. |
| `extensions/azrael-ex/src/chatSession.ts`, `chatView.ts`, `appServerTransport.ts` | Current native-host chat candidate: per-thread Full access request/readback, provider-independent tool approval replies, and the temporary minimal Webview. The approved Codex UI replacement is not yet implemented. |
| `extensions/azrael-ex/src/accountService.ts` | Bounded management-bridge startup/reconnection, verified engine identity and mutation admission without replay. |
| `extensions/azrael-ex/src/nativeAzrael.ts` | Resolve the integrated host command/settings surface; account activation receives runtime directly. |
| `extensions/azrael-ex/src/accountView.ts` | Account management, QuickPick and usage display. |
| `extensions/azrael-ex/src/usageRefresh.ts` | Bounded refresh, stale-result handling and reset requery. |

See [architecture](../architecture/README.md) for contracts and [operations](../ops/README.md) for commands and verified scope.

Use the [archived code maps](../archive/2026-09-12-pi-harness/docs/maps/README.md) for historical source locations only.

Add a map when the replacement has actual code and stable entry points. Describe the useful reading path, execution role, and relevant architecture and operational owners rather than duplicating their contracts or commands.
