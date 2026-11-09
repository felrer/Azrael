# Conversation History contract

<!-- architecture: {"id":"arch.conversation-history.contract","feature":"conversation-history","layers":["ui","host","engine"]} -->

Status: `current` for the single-extension host, storage and environment contracts below; `partial` where a section says so. The replacement target for the engine and provider layer is [Azrael runtime and providers](../../system/runtime-target.md). Supported commands and verification scope are owned by [development operations](../../../ops/development.md).

## Recent-chat list

Status: `partial` — packaged and verified in isolated host acceptance; live user-state visual acceptance is outstanding.

The Azrael sidebar's recent-chat list supplies the native server-side `cwd` filter for the file-system roots of the current VS Code workspace; a multi-root workspace returns the union, and a window without an eligible root shows no recent sessions rather than all history. The same request supplies `modelProviders: []`, because the native server treats an omitted or null provider filter as the configured default provider, while an empty array removes the provider restriction; conversations from every provider therefore remain listed after reload. The request preserves the caller's `sourceKinds`, including an omitted or null native default; it does not force an all-source selection. Workspace, archive, source and pagination filters stay in effect, and filtering happens before pagination. Stored sessions are not rewritten, app-server projects are not created, and the experimental `projectId` filter is not used.

The pinned Webview marks only its `recent_threads` request. The extension host, which owns access to workspace folders, removes the marker and supplies `cwd` and `modelProviders` at the common app-server request boundary. Archive checks, collaboration hydration and other unmarked `thread/list` requests are unchanged. Preparation fails closed if the pinned recent-list call shape or the host request boundary changes.

The ordinary recent-chat discovery policy retains its 200-row scope and requests metadata in pages of at most 50. Each page updates the native conversation store before requesting the next page, yielding to the renderer between pages. Prefetch continues without a scroll action. Warm rows remain visible until the refresh has its authoritative final page; a later page failure retains rows already published. The default discovery limit is 200 for extension/local and cloud hosts; the existing desktop expanded limit of 500, catalog-only/disabled paths, cursor pagination and active/pinned-session retention remain in effect.

Status of progressive discovery and exhaustive local search: `partial` — native source behavior and pinned React/CSS light/dark interactions verified on Windows; packaged, installed-host and other-platform acceptance remain separate in the [work record](../../../../work/DG-01-chat-history-performance/01-plan.md). A nonempty history-menu search requests the complete eligible local thread metadata through the native recent-thread boundary, following 50-row pages until the server cursor is exhausted, without the ordinary 200 or expanded 500 limit. Workspace/provider/source/archive and host admission filters remain authoritative. Search loads metadata, not conversation messages, and preserves the native title matching semantics. Cloud-task query ownership is unchanged. The menu shows native loading until all admitted host requests succeed; failure shows native retry rather than partial search results. Changes to the search text reuse the completed full snapshot while the search stays active. Clearing the search restores the ordinary feed, detaches pending completion from the menu and starts a new full scan on the next search. A concurrent capped routine refresh cannot truncate the active search snapshot. Snapshot rows resolve through current manager state so renamed, archived or deleted conversations do not retain stale row state. Repeated cursors fail the scan rather than silently report complete results. This common source policy is preserved by `ui.recent-chat-filter`; source checks do not establish installed-host or native Linux/macOS acceptance.

## New conversation history and immediate stop

New-chat drafts and session creation at first submission follow [the composer contract](../conversation-input/drafts.md#session-creation-at-submission). Project-scoped draft persistence is independent of native thread creation and remains preserved by `ui.project-drafts`; `ui.submit-only-thread` owns the shared creation boundary.

Status: `partial` — source-level checks verify that new persistent conversations use paginated history and its native turn-ID-based `thread/revert` edit path. Ephemeral conversations retain their native creation behavior. Existing legacy conversations are outside this change and are not converted or relabeled.

A user stop during submission applies to that submission only. The UI retains the stop intent while the same turn is pending, waits for its admitted identity, and distinguishes an activation race from a confirmed terminal turn. An interrupt acknowledgement alone does not authorize editing: the selected turn must reach a confirmed terminal state. A different later turn, an unavailable connection, or an unresolved deadline cannot be treated as successful cancellation. Start admission and interrupt termination checks each have a 20-second deadline; expiry ends that check without scheduling a later interrupt. Errors remain visible through the native UI boundary.

The version-pinned UI transforms reuse native turn creation, interruption, history projection and edit handlers. Source-level asynchronous fixtures verify the affected paths; installed-host acceptance is separate from those checks.

### Local paginated resume loading

Status: `partial` — Windows source checks execute the pinned Webview orchestration and paging functions; installed-host and other-platform acceptance are separate.

Local paginated resume starts metadata and workspace preparation early, then loads the body using the successful resume response's history cursors. It does not independently prefetch body pages before resume. This avoids a second initial body read without treating ordinal pagination cursors as immutable history revisions. The conversation's metadata and existing loading surface remain available while resume is pending; a new body preview waits for resume.

The native timeline/page selection, latest-turn-first item budget, item cursor continuation, notification buffering, current-attempt checks and state merge rules remain unchanged. A writer-conflict failure retains the existing read-only history recovery path. This is a UI request-timing policy, not a cross-resume cache or a migration of stored conversations. It is preserved by `ui.paginated-history` through `scripts/inject-paginated-history.cjs` and its pinned-declaration checks.

### Native history projection after revert

Pending accepted-input retirement and restart behavior are owned by [accepted inputs after message editing](../conversation-recovery/README.md#accepted-inputs-after-message-editing). A visible history cut and delivery-journal custody must agree before the edited request is admitted.

Status: `partial`: common thread-store implementation; focused Windows native checks verify derived projection repair independently of installed-host acceptance.

Paginated history projection cursors and rows belong to the concrete immutable rollout ID. A same-thread revert can select a different rollout while retaining earlier segment references; appends to the replacement use its own cursor and preserve the earlier segment projections. An older derived projection version is rebuilt lazily from authoritative rollout data. A same-ID shortened rollout is rebuilt only after validating its complete prefix, and a transaction compares the original cursor before replacing derived rows. Changed cursors, malformed or incomplete shortened data fail without discarding the existing projection. Original rollout files are never rewritten by projection repair.

This native preservation scope is registered with `engine.recovery` and linked to the [focused recovery checks](../../../ops/development.md#reload-recovery); `ui.paginated-history` retains its separate UI scope.

### Cold resume history preparation

Status: `partial`: focused Windows native tests verify request-local history reuse and revision invalidation; installed-host and other-platform execution remain separate. A cold resume may release its metadata and resume locks to load workspace configuration, then retry under the original admission checks. Within that single request it may reuse the prepared history only after resolving the current stored thread again, matching concrete thread identity, rollout path and history mode, and validating a recognized history revision through the owning store. Fresh stored metadata remains authoritative. Changed, missing, unavailable or unsupported revisions use the ordinary history loader. Caller-supplied history retains its existing immutable tool-ceiling checks.

Archive, deletion, alias/path changes, a concurrently loaded runtime and recorder writer ownership retain their existing checks. The reused snapshot carries its revision into native session startup for writer-side validation; this is neither a global history cache nor a change to stored conversations, legacy history mode or pagination. The common storage behavior is preserved by `engine.shared-engine` in the [feature inventory](../../../../scripts/azrael-feature-contracts.json); target environments and native acceptance remain separate under the [platform contract](../../shared/platform.md).

Source behavior for durable session-state restoration: a resumed session loads its complete rollout once and verifies the expected thread identity and absence of parse errors before restoring either asynchronous questions or host approvals. Both consumers use the same request-local items, including state preceding model-context compaction; the bounded model context does not replace this ledger. Accepted-input reconciliation remains authoritative. A missing rollout path uses supplied history; forks retain their question behavior but do not inherit approval receipts or wakeup reservations. The full-history allocation is released before initial-history recording. This changes neither persisted schemas nor permissions. Preservation is connected to `engine.recovery`, `engine.question-withdrawal` and `engine.window-approval`; focused Windows source/native verification, installed-host acceptance and other-platform acceptance remain separate.

## Related design owners

- [ui](ui.md)
