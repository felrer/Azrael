# Azrael UI presentation

## UI change guidance

Design Azrael UI in the OpenAI style. Reuse the pinned UI’s existing native components, page layouts, settings rows, switches, buttons, typography, spacing and semantic theme tokens. Verify the actual rendered page and its interactions in light and dark themes; plain unstyled controls or source-only tests do not establish visual acceptance.

## Withdrawn questions and queue waiting

Question-panel replies carry explicit `questionReply` queue provenance when
queued. Their row does not show a pending-question wait for the answer it
already contains. Remaining ordinary rows still show unanswered-question
holds. Automatic selection may choose the earliest reply behind ordinary rows;
approval and interruption holds remain visible and enforced. Typed replies are
exempt from pending account-switch waiting; ordinary rows retain that status. Text
tags in an ordinary queued message do not change its kind. Restoring a typed
reply also restores its question-panel submission trigger.

Status: `partial`; scoped source and Windows native React/CSS fixtures cover
light/dark rendering and interactions. Full application-provider, package,
installed-host and other-platform acceptance are separate in the
[work record](../../work/CL-01-question-withdrawal/01-plan.md).

An asynchronous question withdrawn by the model becomes a collapsed, inactive
history disclosure labelled **철회된 질문**. Expanding it reveals its original
question text. Remaining questions retain their original identities and source
indexes. The existing question-state reconciler closes a withdrawn selection and
removes its draft; accepted user replies remain in history. Source-item updates
also refresh virtualized question cards whose projected rows remain mounted.

The chat list's **입력 필요** badge uses the same active question identities as
the question panel. Withdrawn questions do not contribute to its pending set.
An update that changes only withdrawal state invalidates the conversation index,
including for an inactive chat. Removing a withdrawn question's draft cannot
recreate the badge. Remaining unanswered questions and approval indicators retain
their existing meaning; an absent draft for an active question still needs input.
Implementation and verification scope: [question badge work record](../../work/DL-01-withdrawn-question-badge-diagnosis/01-plan.md).

Queued messages held by unanswered questions show **사용자 답변 대기 중** through
the existing queue status surface. The queue retains its order, cancellation and
explicit send controls. State and automatic dispatch authority belong to the
[question and queue contract](queued-compaction.md#unanswered-asynchronous-questions).
Preservation feature: `ui.question-withdrawal`.

## Composer and feature surface

Status: `partial` — pinned source transforms, scoped runtime fixtures, packaged host acceptance and actual webview startup are verified; full presentation and theme comparisons remain pending.

The independent Azrael distribution uses the pinned upstream UI as an input to its own guarded preparation transforms. The upstream snapshot and the original Codex extension remain separate product inputs.

The empty composer displays one of `[•ᴗ•]`, `( ˘ᵕ˘)b`, `ʕᵔᴥᵔʔ`, `ʕっ•ᴥ•ʔっ🍯`, `^•ᴗ•^`, `(づ｡◕‿‿◕｡)づ` and `(｡•̀ᴗ-)✧` in every composer mode. The choice is random on first display and stored by native composer session key and execution host in webview local storage, keeping an existing conversation stable across rerenders, mode changes, revisits and webview reloads. Unsent new-chat surfaces use the native draft key until a conversation exists. Storage failure retains the choice in the current webview memory; persistence across reloads requires available storage. This shared presentation behavior applies to all desktop platform targets; installed-host and other-platform acceptance remain separate. Preservation feature: `ui.ui-cleanup`. Its accessible input identity remains available. The add menu offers existing file/folder attachments and supported integration entry points. Goal setting and Plan mode registration, selection handlers and their composer mounts are excluded from the Azrael UI. Sketch registration, selection handlers and composer mounts are preserved, including the slash/mention drawing action and shared composer creation capability. Native engine tools and session protocols retain their own contracts.

The slash command menu excludes Model, Fork chat, Initialize, Reasoning level, Code review, Status and the Ultrafast service-tier option. Their dedicated registrations and mounts are removed, including both code-review variants; the shared service-tier registrar skips Ultrafast while preserving Fast. Composer toolbar model/reasoning and service-tier selectors, status services and the shared underlying services remain available through their separate entry points. This shared presentation policy applies to Windows x64, Linux x64 and macOS ARM64. Preservation feature: `ui.ui-cleanup`.

Pets integration entries, settings and dedicated UI/host paths are excluded from the Azrael distribution. This presentation boundary does not delete personal skills or saved user data. Generic connector and account/avatar behavior keep their existing contracts.

Shared bundle imports retain disabled empty query/state adapters and empty module exports; these perform no Pets RPC, persistence, subscription or selection mutation. Inert preload metadata, shared avatar/render utilities and built-in artwork remain in the pinned bundle graph. Existing thread-goal state and image/sketch attachment rendering keep the handlers required to display and recover persisted conversations.

Full access text uses the same foreground tokens as Request approval in the permission selector and the selected composer control. Only the leading menu icons are tinted: Approve for me mixes the native sky-blue token with gray, and Full access mixes the native orange token with gray (55% accent, 45% description foreground). Permission values, selection behavior and native approvals retain their existing contracts; the display change does not imply that the two modes grant the same authority.

## Sketch on an attached image

Status: `current` in source — guarded transforms and Windows native React/CSS fixtures cover separate scope wrappers, the native composer lazy-loading boundary, drawing and PNG attachment in light/dark themes, cancellation and failure results. [The work plans](../../work/BN-01-image-sketch/02-plan.md) record verification scope and draft replacement/empty-image saving; the full app provider graph, native toast rendering, host uploads, package, installed-host and other-platform acceptance are separate.

The chat image lightbox and composer attachment preview offer a sketch action for the selected image, alongside their existing image-edit actions. It opens the existing sketch editor with that image as its background, keeping drawing coordinates aligned with the displayed image. The editor retains its native drawing tools and exports the full image bounds together with the drawing through the existing composer PNG attachment path, subject to the native export size limits. Saving an edited draft photo replaces that attachment in place, preserving its identity, order and other attachments. Editing a photo from an already sent message creates a draft attachment without changing message history. Canceling preserves the current attachment. Reopening an annotated draft attachment reuses its original background and editable drawing. Photos can be saved before drawing, after erasing all objects and without further changes; ordinary empty sketches retain their native save policy. Missing replacement targets cannot create an unintended duplicate, and failed replacements retain the original attachment for retry. Empty sketch creation, image zoom/pan, download and close retain their existing behavior. Loading errors leave the preview available to retry; export failures retain the drawing and do not submit a partial attachment. The request belongs to its originating composer scope and is canceled when that scope or preview becomes stale. Routing compares the native scope descriptor and resolved provider node, since each component receives its own scope wrapper. Opening shows progress through the existing toast service; absent or unavailable composers, an existing sketch, and loading failures return a terminal result with a user-facing reason. Cancellation closes progress without reporting an error, and a failed or unavailable request keeps the image preview open.

This is shared webview behavior for Windows x64, Linux x64 and macOS ARM64, with the existing image access and composer attachment permissions. It does not create a new host file or network permission. Preservation feature: `ui.image-sketch`.

## Parent decision request activity

Status: `current` in source — guarded transforms and Windows native React/CSS fixtures cover separate request/completion groups in work summaries and standalone conversation activity, light/dark themes, keyboard disclosure and narrow width. [The grouping work record](../../work/CZ-01-parent-request-activity-diagnosis/01-plan.md) owns this scope; [the original work record](../../work/AR-01-root-child-mail-analysis/01-plan.md) owns engine storage/replay evidence. Package, installed-host and other-platform acceptance remain separate.

An immediate child decision request appears in its parent's chat history using the native sub-agent activity row, including existing avatars, child identity, spacing and theme tokens. Its pending label is **판단 요청**. Expanding the row reveals the question, context, recommendation and blocked action. A structured parent response updates that same request's row to **판단 완료**, **판단 보류** or **요청 취소** and exposes its decision, reason and any retry condition. Each request retains its own identity and state even when the child sends multiple requests. Ordinary progress mail retains its existing presentation.

Decision requests and actual child completions add separate activities. Within the existing turn and activity-group boundaries, requests from multiple agents share the native overlapping-avatar request summary, and completions share their own completion summary. Interleaved requests and completions remain in separate groups, ordered by the first occurrence of each kind. The same agent can appear in both. Request details retain every request ID, including multiple requests from one child; replay of the same ID updates its existing entry. Expanding a request group exposes its individual request disclosures. A group with any pending requests says **판단 요청**; otherwise a shared response status uses its corresponding label, and mixed response statuses say **판단 응답**. Individual details always show each request's own state.

The work-summary and standalone conversation presentations preserve the request payload through grouping to rendering. A child becoming idle or waiting for its parent's response does not create completion activity. A saved response updates the associated request inside its existing group, while an actual child completion adds to the separate completion group. User stop does not implicitly answer or cancel a pending request.

The activity is a presentation of the persisted [parent decision request](root-resume.md#parent-decision-requests); it does not complete the child, answer a request, grant approval or create a wake. The original parent turn and stable item ID keep response updates attached to the request through parent resume, history loading and reload. The same shared presentation applies to Windows x64, Linux x64 and macOS ARM64; actual platform and installed-host acceptance remain separate. Preservation feature: `ui.parent-request-activity`.

## File edit summary

Status: `current` in source — native React/CSS rendering and scoped interactions pass on Windows in light/dark themes and at narrow width. Package, installed-host and native Linux/macOS acceptance remain separate; evidence is tracked in [the work plan](../../work/BG-01-compact-file-summary/01-plan.md).

Completed turn diffs use the native resource card with compact vertical padding, a 24px icon surface and a 16px glyph. The edited-file title and total added/removed lines share one row. The header has no Undo/Reapply or View changes buttons or hover subtitle. Multiple-file rows are 32px high and retain native diff opening, modifier-key file opening, file menus and expansion controls. A single-file header retains its accessible native diff-opening trigger. Diff data, host permissions and editor ownership retain their native contracts. This shared presentation applies to Windows x64, Linux x64 and macOS ARM64; package, installed-host and native platform acceptance are separate. Preservation feature: `ui.ui-cleanup`.

## Conversation error messages

Status: `partial` — shared formatter and guarded pinned renderer implementation; verification and installed-host limits are in [the work record](../../work/BU-01-thread-01a144c2-error-analysis/02-plan.md). Preservation feature: `ui.error-presentation`.

The native integrated error selector and standalone conversation view share one evidence-based formatter. Known structured categories use safe fixed messages; exact approved rate details preserve their specific dimension. Unsupported-model and connection details require complete recognized formats, and cannot override a contradictory category. Authentication failure does not imply expired credentials, and a session budget is distinct from provider account usage. Unknown detail, including nested provider JSON, displays exactly `정의되지 않은 오류`.

The exact native Other text `Fatal error: 모델 제공자가 응답을 거부했습니다. (provider_refusal)` identifies an observed provider refusal and displays as `모델 제공자가 응답을 거부했습니다. (provider_refusal)`. Only that exact message/category pair establishes refusal; unprefixed, quoted, modified or contradictory-category text uses the unknown-error rule.

The exact historical helper text `rate limit exceeded: Provider request rate limit reached. Try again later.` also represented ambiguous HTTP 429 responses. Even with its saved `rateLimitExceeded` category, that particular legacy text displays as undefined and does not establish a rate-limit cause in recovery diagnostics. Conversation storage and recovery admission are unchanged.

Existing native error cards, typography, spacing and theme tokens remain in use. The native selector continues to suppress errors while retrying and preserves separately owned policy-error presentation. The formatter changes displayed errors only; conversation storage, tool results, permissions and retry/admission state remain with their owners. This shared presentation applies to Windows x64, Linux x64 and macOS ARM64; source/renderer fixtures do not establish installed acceptance.

## Capacity retry controls

Status: `current` in source — Windows behavior fixtures and native React/CSS rendering pass in light/dark themes. Package, installation and native Linux/macOS acceptance remain unverified.

The latest failed model-capacity response offers **Stop retrying** beside the native retry countdown. Stopping disables automatic retry submissions for that failed turn in the current webview, including remounting its card. It immediately blocks an already scheduled callback before React rerenders. The native **Retry** action remains available for explicit manual submission. A new failed turn retains its own retry policy; other hosts and conversations are unaffected. Reloading the webview restores the native retry policy. The button stops future automatic requests; an already submitted response uses the existing composer Stop control.

Stopping retries does not lock the conversation or disable new composer input. The user can send new instructions or an explicit continuation in the same session after a capacity failure; selected model/account, attachments and history retain native ownership. Structured capacity-failure continuation admission is owned by [manual continuation after a server error](reload-recovery.md#manual-continuation-after-a-server-error). Source acceptance requires both retry-stop and host/bridge input-delivery checks; an older running host still needs an updated package and reload.

Native owner eligibility, ready-state checks, retry admission, collaboration mode and submission-failure handling remain in use. Only the latest failed turn renders retry actions. Controls reuse native outline buttons, spacing and theme tokens across Windows x64, Linux x64 and macOS ARM64. Preservation feature: `ui.capacity-retry-stop`. `scripts/test-capacity-retry-stop.cjs` covers timer/admission behavior and `scripts/verify-capacity-retry-render.mjs` renders native controls with synthetic host/localization services.

## New-chat drafts

Status: `current` in source — pinned host persistence checks on Windows; packaging and installed-window acceptance pending.

Unsent new-chat drafts on the home screen and in new-chat panels are saved separately by the host's workspace project ID. Reopening the same project restores its draft; another project has its own draft. Windows without a project use a separate projectless scope. Existing conversation drafts retain their native conversation identity. This is shared host behavior for Windows, Linux and macOS; native Linux/macOS acceptance is unverified.

The native composer and persisted-record merge remain in use. Initial synchronization, later broadcasts and draft writes resolve the workspace through the provider's `fetchWrapper.extensionFetchHandler.getWorkspaceProject()`; the webview provider does not own that method. Initial synchronization includes other persisted preferences, so this owner boundary also preserves session flag restoration. Initial synchronization and later broadcasts expose only the current project's new-chat entries. Old global new-chat drafts remain stored but are not restored because their project ownership is unknown. Legacy conversation drafts still migrate through the native store. No input is submitted by saving or restoring a draft.

### Submitted draft custody

Status: `current` in source; Windows pinned-function fixtures cover submission and persistence. Installed-window and Linux/macOS acceptance remain separate in [the work record](../../work/CQ-01-sent-draft-restoration-diagnosis/01-plan.md).

After successful submission, the composer discards the saved copy of the submitted draft so revisiting the session restores only unsent work. Selection or attachment changes after the editor clears do not retain the submitted text. Deletion requires the same composer session, unchanged cleared editor text and persisted-text representation, the same retained submission owner, and a saved draft matching that owner's content. A newer typed or saved draft remains protected, including retyping the same text before persistence completes. New attachments and selections remain in place. Failed submissions retain their retry draft; restoring into the visible editor still requires ownership of its complete editable state. These shared webview semantics apply to Windows, Linux and macOS. Preservation feature: `ui.composer-draft`.

### Session creation at submission

Status: `partial` — source creation/admission fixtures and native composer-effect rendering pass on Windows in both themes. Packaging, installed-window resume and native Linux/macOS acceptance remain separate.

Editing or restoring a new-chat draft keeps the project-scoped persisted draft and creates no native session. Text entry, deletion, paste, attachment changes, model changes and navigation retain the existing draft ownership. The shared thread-creation boundary releases unused prewarm input readers without preparing or starting a thread. Local and cloud-prototype composer prewarming use this boundary. A valid first submission uses the native conversation creation and request admission flow, including current model and permission settings, draft custody, failure handling and pending submission identity. Creating the session at submission adds its preparation time to the first send.

Existing conversations, queued requests and submitted pending conversations retain their native list and resume behavior. A blank title or preview does not identify an unsent session. Stored user conversations are preserved; ambiguous existing entries are not automatically hidden or deleted. The preservation inventory connects this boundary through `ui.submit-only-thread`, alongside `ui.project-drafts` and `ui.composer-draft`.

## Team groups and Lead entry

Status: `current` in source — native recent-list and menu interactions verified in light and dark themes on Windows; packaging and installed-host acceptance remain pending. Evidence and runtime scope are tracked in [Team UI work](../../work/AZ-01-team-lead-ui/01-plan.md). The Team runtime and instruction contract is owned by [Team UI and Lead creation](work-orchestration.md#team-ui와-lead-생성).

The recent-chat popup reuses its existing native menu and rows. Team-owned loaded sessions form a collapsible group named from the Lead's title, with `Team` as the fallback. The Lead row has a small `Lead` label beside the existing metadata; flags, activity, timestamps, archive and navigation retain their native behavior. Standalone conversations remain ordinary rows. Groups follow the first member's position in the native filtered order; collapse preference is persisted by host and Team identity. Type, environment, title and flag filters apply before grouping. A group does not imply that every Team member has been loaded. The home recent preview retains its native layout with the same Lead label.

Ordinary activation of the native New chat button retains its existing action. Right-click, the keyboard context-menu action and a stationary long press open a native menu offering **New Lead** (**새 Lead** in Korean). A long press suppresses the following ordinary click. Movement, pointer cancellation and unmount cancel pending gesture timers. Selecting New Lead establishes its pending role intent and invokes the native new-chat action once. Failure is visible and does not become an ordinary chat creation. Existing model, provider, permission and draft ownership remain in their owning services.

Preservation feature: `ui.team-lead`. Light/dark interaction acceptance must cover disclosure persistence, Lead display, member navigation, filters/flags, menu gestures and creation failure. Native first-submission admission and role restoration are separate runtime checks; renderer fixtures do not establish actual model behavior or installed-host acceptance.

`scripts/verify-team-ui-render.mjs` exercises the transformed native recent-menu and merge functions, native row/new-chat components, preference atom and CSS. Host queries, transport and localization are fixture adapters. Its 36 light/dark checks cover both direct Team rendering and the owning recent-list route, including All/Local/Cloud, title and flag filters. Creation transport currently supports the verified local host; other hosts fail explicitly. Native panel-opening failure uses the host's error notification, while draft preparation and submission failures retain their owning UI errors.

## Session flags

Status: `current` in source — native row rendering and interactions verified in light and dark themes; build and installation pending.

Local sessions in the recent-chat menu and the new-chat screen's recent-chat preview have a Flag toggle immediately before the time or native hover actions, with extra spacing before Archive. Unset flags show only an outlined flag, without a button background or tile border, when the row is hovered or contains keyboard focus. The button sits above the native trailing action rail so the whole visible icon receives pointer input, including its right edge. Keyboard focus retains its visible outline. Set flags show a filled red flag even without hover. Clicking again clears the flag; flag actions do not navigate, close the menu or archive the session.

The chat-type dropdown contains a persisted **Flagged only** checkbox item beneath All chats, Cloud chats and Local chats. It combines with the existing type, environment and title-search filters while preserving native ordering. Saved local conversations with a matching host and conversation flag are included, along with the currently open local conversation even when it is unflagged. Its current identity follows the native active-row route, including a pending local thread with that identity. Other cloud and pending items without a saved conversation are excluded. Clearing a flag immediately removes a non-current row from the filtered list; the current row remains visible without acquiring a flag. The preview shares the same flags and updates immediately.

Flags use the native persisted UI preference store, keyed by host and conversation ID. They preserve menu ordering and other hosts' flags. Restoring this store shares the project's draft synchronization path; its native method ownership is covered by `scripts/test-project-drafts.cjs` as well as the flag behavior checks. The button exposes its pressed state and supports keyboard activation. Native time, running indicators and Archive keep their existing behavior.

`scripts/verify-session-flags-render.mjs` exercises the production Flag helper with the pinned native React, preference atom, row components and CSS. Host services and localization are synthetic; installed VS Code and real host persistence remain separate checks.

## Model command drag policy

Status: `partial` — source transforms and Windows native Webview policy checks pass in light and dark themes. Full application, packaged/installed acceptance and Linux/macOS checks remain unverified.

Model command execution cards, their command/output shell blocks and dynamic `functions.exec`, `functions.exec_command` and `functions.write_stdin` results disable mouse text selection and HTML drag starts. This temporary mitigation uses a scoped CSS class plus capture cancellation of `selectstart` and `dragstart`. It does not cancel pointer-down, click, key, wheel or drop events, so the native disclosure, copy controls, focus and scrolling keep their owners. Ordinary conversation text, Markdown code blocks, other tool results and composer attachments retain their current interaction policy. Existing selected text is not globally cleared.

The policy is common to Windows x64, Linux x64 and macOS ARM64. Windows native Webview checks establish the verified environment; packaging and installation are separate. Preservation feature: `ui.command-drag-block`.

## Scroll fades and renderer compatibility

Status: `partial` — source transform and isolated Windows native Webview verification; packaging and installed-host acceptance are separate.

The pinned horizontal and three vertical scroll fade masks preserve their gradients, distances and keyframe stops. Their four `scroll(self x/y)` animations are replaced by a shared frame-coalesced geometry observer that writes the existing fade variables. Layout reads precede style writes; scroll, viewport resize, content changes and newly mounted scrollers refresh the fades. Non-overflowing elements have no fade. Removal and disposal restore only inline values still owned by this observer. Unrelated view timelines remain unchanged.

This common renderer policy avoids a Chromium lifecycle check failure observed on Windows x64, VS Code 1.142.0 / Electron 43.7.7 / Chromium 150.0.7871.250 when text selection, ScrollTimeline and scroll-container visibility changes overlap. The original incident and synthetic native reproduction share the exception location; exact private symbols and the user's original pointer sequence are unavailable. Linux x64 and macOS ARM64 share the implementation but have no native acceptance evidence from this task.

Preservation feature `ui.scroll-fade` owns strict pinned CSS anchors, the serialized runtime, transform cache dependencies and mandatory source checks. `scripts/verify-scroll-timeline-crash-host.cjs` provides separate isolated native crash/control experiments and production-mask measurements/screenshots in light/dark themes. Synthetic Webview acceptance does not establish installed-package acceptance or recovery from every renderer crash.

## Hidden conversation webviews

Status: `partial` — shared source policy and guarded pinned host/composer transforms are implemented; packaged and installed-host acceptance remains pending.

A native conversation editor panel or sidebar that remains hidden continuously for one hour releases its renderer document when its current conversation has no flag. Visibility, including a visible but inactive split editor, preserves the renderer and resets the deadline. Flags use the existing persisted host/conversation identity; the host rechecks them immediately before release. Removing a flag from an overdue hidden conversation permits the next check to release it. Other account, usage and auxiliary views retain their own lifetimes. The policy is common to local Windows x64, Linux x64 and macOS ARM64 hosts; this change's execution evidence is Windows only.

Release preserves the tab and conversation storage. Active work, queued input, resume reservations and pending approvals preserve the renderer itself: native queue dispatch depends on its client ownership. Only a confirmed idle renderer is replaced with an inert page, retaining its native composer attachment/selection state and scroll position. Reopening uses the existing renderer handshake, persisted preferences and conversation route to read current history, rather than replaying old history notifications. A newer persisted draft takes precedence over the captured attachment state. Client coordination and worker-bus registration are renewed with the renderer; release does not dispose the panel, cancel a turn or clear native pending approval requests.

Release requires a fresh successful engine reservation query followed by an acknowledged, serializable composer snapshot from a ready native connection. The existing native manager's resume/start admissions, all local queue records, cached conversations, active runtime summaries, requests, unconfirmed submissions and active goals must show no outstanding work. Missing, loading, malformed or inaccessible state retains the renderer. Checks cover other conversations managed by that renderer as well as its current route. Engine reservations in preparing, waiting, claimed or blocked states retain all conversation webviews in that window conservatively; only resumed/cancelled reservations are terminal for this gate. An engine transport or instance change during the query also rejects release. Host pending approval requests are checked before the query and again synchronously before replacing the document.

A missing composer, an in-flight submission, a transient `blob:` attachment reference or a capture/storage failure defers release. A work-state rejection or failure starts a fresh hidden hour before the next attempt. Visibility and flag changes invalidate an in-flight capture. A deliberate action or approval request arriving after release restores the renderer in the background and delivers the request after its ready handshake, without revealing the tab. Failed restoration keeps the snapshot and pending actions for a later attempt and logs the lifecycle error. Garbage collection and shared renderer caches determine when RAM is actually returned; a specific per-tab saving is not guaranteed.

The preservation feature `ui.webview-idle` connects the host/renderer transforms, lifetime manager, account service reservation gate and mandatory behavior checks. Source fixtures cover timer/flag races, protected/unknown work states, reservation connection races and background approval restoration; actual packaged native composer, live turn/queue/resume/approval continuation and installed-window memory acceptance are separate gates.

## Missing local chat images

Status: `current` in source — native component rendering and interaction verified in light and dark themes; build and installation pending.

When a local image referenced by a chat thumbnail is absent, the thumbnail displays `파일 없음` in its existing bordered tile using native theme tokens. The missing-file tile has no image-opening action. File absence is distinguished from permission, transport and cancellation errors. Loading and available-image behavior retain their existing presentation. A change to the image source, host or conversation clears the previous missing-file identity.

## Fast mode recommendation

Status: `partial` — the guarded source transform is checked; rendered banner suppression and installed-window acceptance remain unverified.

The home-screen Fast mode recommendation card and its personalized savings estimate are disabled through native banner eligibility. Account eligibility does not enable the card. Manual speed selection remains available in the model picker. This behavior is covered by the `ui.ui-cleanup` transformation owner; its existing structural checks do not establish a rendered recommendation-suppression test.

## Astra and Sol response speed

Status: `current` in source — native control rendering and interaction verified; build and installation pending.

For the exact OpenAI models `gpt-6-astra` and `gpt-6.1-sol`, the model picker's lightning button cycles Standard → Fast → Ultrafast → Standard through the existing service-tier selection callback. Fast sends `priority`; Ultrafast sends `ultrafast`; Standard uses the existing explicit standard selection. Account catalogs that omit Ultrafast are supplemented for these exact IDs, and the bundled catalog and native request policy preserve their explicit Ultrafast selection. Ultrafast uses the native purple theme token for the icon and a tinted button background in both light and dark themes. The tooltip identifies the active mode, and the accessible label identifies the next mode. Loading and the native unavailable state disable selection. Other models retain their native speed controls. Server-side account and workspace eligibility still applies; exposing the selection does not establish account access.

Other model slugs retain their existing catalog-based support checks. Source routing tests cover advertised and missing tiers. Live account support remains unverified. The controls and callbacks were exercised using the pinned native React/menu/CSS modules with synthetic host state, including mouse selection and keyboard return to Standard for both models. This source change has not been packaged or installed.

## Identity and session links

Backend HTTP protocol identifiers keep their upstream names, including `OAI-*` and `x-openai-*`. The `OAI-App-Brand` value remains `codex`; it must not be derived from the display brand.

The host and conversation UI identify the distribution as Azrael. Theme names, embedded VS Code command titles and the Devin model-picker notification also use Azrael. Actual service usage and model names retain their service identity. Local conversation links use `azrael://threads/<UUID>` and the host's VS Code handler receives the translated `/local/<UUID>` route. Original Codex thread links require explicit migration with an existing Azrael session check. Routing and storage ownership are defined by [local session links](azrael-ex.md#local-session-links). The session-link injector is registered in the preservation manifest, and prepared assets must report `sessionLinkEdits` before package verification succeeds.

## Conversation and file interactions

The [recent-chat list](azrael-ex.md#recent-chat-list), [new conversation history and immediate stop](azrael-ex.md#new-conversation-history-and-immediate-stop) and [conversation branching](azrael-ex.md#conversation-branching) own native request and session semantics. UI filters preserve the native merged ordering, selected chat type/environment and pagination. File-open actions, missing image state and local-file drops follow [chat content handling](azrael-ex.md#chat-content-handling); their menu and attachment controls use native components.

## Submitted-input diagnostics

Status: `partial` — source fixtures exercise the actual instrumented state, queue and renderer boundaries; installed-host acceptance is separate.

Diagnostics track a submitted input's thread/client identity across parameter input, user message, steering message, queue consumption and render suppression. They distinguish representation changes from complete removal and record whether a queue receipt was accepted and persisted. Suppression reason changes can be observed without changing native render eligibility or submission behavior. Invalid identities and malformed snapshots are skipped; failures in instrumentation cannot replace the native result or error.

Records include bounded identifiers, representation counts, reason flags and history invalidation kind. Message content, attachment paths, model payloads and credentials are excluded. Snapshot scanning, event rate and deduplication state are bounded without background timers. Enablement follows [diagnostic logging](diagnostic-logging.md); the registered owner is `ui.input-diagnostics`.

The same preservation owner includes content-free Webview health diagnostics. The bootstrap reports JavaScript exceptions, unhandled rejections, script/link/image load failures, CSP violations, drag starts/blocked starts/terminal events, visibility and a 10-second heartbeat. The extension host assigns a random `webviewRef`, records HTML generation, startup phases/timeouts, disposal and intentional idle blank/restore boundaries, and validates the renderer's fixed fields before using the existing native logger. UI records are limited to 30/minute plus six reserved heartbeat records and host records to 60/minute per Webview; subsequent records expose lost-record counts. No content, URLs, paths, raw exceptions or stacks are added. A visible Webview with no signal for over 30 seconds is `signal_lost`, explicitly with `rendererExitConfirmed:false`; a host timer gap over 30 seconds is `host_observer_delayed`. Missing drag termination is evidence of an unfinished observed drag, not confirmation of iframe pointer blocking. These diagnostics do not alter input, reload or recover a view. Source fixtures establish the named paths; packaged/live and non-Windows acceptance remain separate. Retrieval and interpretation are owned by [Webview health diagnostics](../ops/webview-health.md).

## Settings module contracts

Azrael settings use the OpenAI native page layout, heading hierarchy, settings rows, switches, buttons, spacing and semantic theme tokens. Reuse the pinned bundle's actual components and verified exports. Rendered light/dark layout and interaction checks are required for presentation acceptance.

Settings injectors import the bridge through the pinned UI `26.1007.21434` export `X9t` (`vm` internally); internal aliases are not module exports. Native ReactDOM root creation uses `XAt`; the separate legacy ReactDOM export does not supply `createRoot`. Settings navigation reuses initialized platform icon assets. Retired Pets registry entries retain an inert `{ visible: false, pending: false }` visibility result so shared navigation never dereferences an undefined result.

Account and usage surfaces, including shadow-root settings panels, inherit the native semantic palette and color scheme with VS Code and light/dark fallbacks. Cards, ticket rows, buttons and switches use theme surfaces. Both standalone and embedded presentations must show readable foregrounds and distinct light/dark backgrounds while preserving native geometry and interaction.

Instruction documents and Design use the native React Intl context for the active app language, including navigation labels, accessible text and page states. Korean language variants select Korean; other languages select English. Changing the app language updates presentation. Student names remain English in either language, while source document content and external diagnostics retain their original text. The standalone instruction surface follows the VS Code display language. Instruction navigation reads “Instruction Documents” in English or “지침 문서” in Korean; the not-implemented notice appears only in the page heading.

## Window Use settings

Status: `target` for unified presentation.

Window Use is the single settings, panel, consent and notification identity for observation, isolated execution, current-window control and whole-desktop control. The page has a product enable switch and describes the four stages, individual app approvals and all-app approval. Observation needs no per-app/window consent when enabled. App grants apply from isolated execution onward, while task-stage requests identify scope, execution location, reason and user impact. The all-app setting is described as skipping app consent rather than authorizing every stage.

Existing grants and disabled scopes survive settings conversion without implicit elevation. Current stage, execution location, pending elevation, user stop and recoverable failures remain visible. Browser tasks use the existing Chrome route. Child-session capability and prerequisite failures are shown from actual evidence; Home support is not assumed. The page, requests and remote-view ownership controls reuse native OpenAI-style components, tokens and accessible keyboard behavior, with light/dark rendered acceptance required. The policy owner is [Window Use](window-use.md#stage-authority-and-recovery).

### Current settings implementation

Status: `partial` — the production settings section passes actual pinned React/component/CSS light/dark rendering and interaction checks, and the exact package passes host acceptance and installation. Full installed VS Code navigation after reload remains separate.

The existing Computer Use page contains separate Computer Use and Window Use sections. Computer Use has an enabled switch, initially on. Window Use has an allow-all switch, initially off, and an always-approved app list with add-from-running-window and remove actions. Settings use the pinned native rows, switches, buttons, spacing and semantic theme tokens. Loading, saving, empty-list and failed-save states are visible; a failed save does not display the proposed value as saved. User actions supersede quiet background reads; late replies cannot replace the acknowledged result. Keyboard interaction and both themes require actual rendered acceptance.

Window Use settings use its separate approval owner. The existing Computer Use approval-management surface remains available. The runtime authorization contract is owned by [Window Use](window-use.md#app-authorization-settings) and [Computer Use](computer-use.md#control-enable-setting).

Window Use consent reuses the native in-conversation elicitation card with the app name, Window Use identity and existing permission scopes. The dedicated Window Use panel presents consent within its own view using semantic theme tokens. Waiting, expiry, denial and cancellation remain visible states; a terminal request cannot retain active approval buttons. Source light/dark rendering and interaction acceptance pass at normal and narrow widths. The exact package passed six isolated host acceptance stages and is installed; real-user consent after reload remains unverified. Its authority and model-visible result contract is owned by [in-app consent](window-use.md#in-app-consent).

## Design settings

Status: `current` in source — custom photo sets and single-photo random preview verified on Windows with host tests and native light/dark rendering; packaging, installed-profile and Linux/macOS acceptance pending.

Presentation acceptance uses the production component and pinned native modules/styles with a synthetic host in light and dark themes. Source tests and browser fixtures do not establish packaged or installed-profile acceptance.

The Design page has a native **Use custom photos for new subagents** settings row. Its switch defaults to off for unset preferences and persists changes through the host-owned photo service. Turning it on affects future authoritative subagent creation events; previous photo assignments and recorded off decisions remain stable when toggling or reopening the page.

The chat and input font row uses the native segmented control to select `OpenAI default` or `Gyeonggi + monospace` together for message text and the composer. Unset and existing preferences default to `gyeonggi-consolas`; `openai` restores the pinned UI's native content, composer and code typography and normal word spacing. The host stores `chatFont` alongside student preferences, serializes changes and broadcasts confirmed snapshots to open webviews. Failed saves retain the previous font and expose the existing retry/error state. Native bridge initialization subscribes even when no settings page or subagent avatar renders, so reopening a chat restores its saved font. Other dynamic labels retain their existing typography.

The host observes `item/completed` notifications for both `subAgentActivity` with `kind: started` (v2 creation) and successful `collabAgentToolCall` with `tool: spawnAgent`. Both paths use the same per-thread saved decision, so duplicate notifications do not redraw a photo. Later activity and history reads do not allocate photos.

The Photo preview section selects the persisted image set through the pinned native dropdown menu and radio items. Its trigger displays the confirmed set name and a chevron; opening the menu lists Students and all imported sets, marks the current selection, and supports native keyboard navigation. The selector is disabled while loading or saving. The section then shows one randomly selected photo and its display name, with a button to draw another. Students is the bundled default set, containing 200 distinct student/costume IDs: the original 100 base portraits and 100 additional portraits (44 base appearances and 56 costume variants). Existing numeric IDs are retained; image replacements use the exact generated PNGs confirmed by the user, with hashes and approval provenance updated together. Unselected image bytes are retained; displayed names distinguish costumes. Roster validation checks nonempty records, unique IDs, complete identity fields, safe filenames and PNG integrity. Selecting a set changes future subagent assignments and the preview; existing assignments, including saved off decisions, remain stable. Each side of the photo box is one third of the native `size-20` box, using the same spacing token; image alternative text also uses the English name. Preview is available while the switch is off and does not change saved preferences or subagent assignments. Loading, save failure and unavailable-photo states remain visible and accessible. Images use bundled assets or copied user assets through local webview resource URLs.

**Add image set** opens a native multi-file chooser and a set-name prompt. PNG, JPEG, WebP and GIF imports allow up to 200 regular raster files, 1 MiB each and 20 MiB total. The host checks format signatures and stores copies beneath extension global storage `subagent-photos/<set-id>/`, so source files can be moved after import. File stems supply display names. Successful import persists metadata and selects the new set. Cancellation and validation/storage failures preserve the previous selection and assignments and clear the busy state. Native dialogs do not hold the mutation queue or expire on the short bridge-response timer. There is no archive extraction or runtime network request.

Snapshots carry all photos so old assignments can still render when another set is selected. Bundled photo IDs remain numeric; imported IDs include their immutable set identity. Existing preferences default to Students while preserving enabled/font values and saved decisions.

## Student avatar initialization

Photo subscriptions authorize the bundled avatar directory and custom storage root at initial subscription, retaining webview options when existing resource roots already cover both. Imports do not add new resource roots. Adding a redundant descendant root reloads the webview and loses the active settings route.

Design preferences use one store per webview. Subscribe in a microtask after the native bridge initializes, or when the first avatar or design settings hook renders, whichever comes first. The pinned UI initializes shared dependencies lazily across cyclic module imports, so the injected module must not call bundle initialization functions during module evaluation. A webview closed before the store is used must also dispose safely.

## Recent-chat header initialization

Recent-chat filtering subscribes to the history menu's persisted type and environment atoms through the pinned atom and environment query hooks. Initialize the atom owner when this hook first renders and reuse the upstream task merge hook. Preserve the header's existing local bindings so injected variables cannot shadow hooks already called in the same render. Authenticated header and persisted conversation rendering use the same packaged module graph.

The history menu uses the native loading and retry components while an exhaustive local search is pending or failed, and reveals matching rows only after the complete metadata snapshot is ready. Typing within an active search reuses that snapshot. Clearing or unmounting the menu prevents a late response from replacing its current view. Ordinary progressive loading and search scope are owned by the [recent-chat list](azrael-ex.md#recent-chat-list); both paths retain native merge ordering, environment/type filters, flag controls, row navigation and keyboard behavior. Progressive/search presentation acceptance is tracked in the [work record](../../work/DG-01-chat-history-performance/01-plan.md).

## Typography boundary

Status: `partial` — dynamic-font preparation and persisted chat-font selection are implemented in source; full installed presentation acceptance is separate.

Dynamic content, including user names, email addresses, chat titles, messages, typed input, model names, account values and durations, uses Gyeonggi Millennium Title Light (경기천년제목 Light) for Korean. On Windows, Latin text/numbers use installed Consolas, falling back to bundled Cascadia Mono when unavailable. Other desktop platforms default to Cascadia Mono even if Consolas is installed. Selection follows the webview OS, independently of package-generation OS. Keep existing font sizes and line heights. A root/body font replacement cannot satisfy this boundary. Preservation feature: `ui.content-fonts`.

Bundle unchanged official Cascadia Mono upright/italic variable WOFF2 files and Gyeonggi Title Light WOFF with source/use-condition notices, Cascadia's OFL license and verified hashes. Retained Batang assets are not selected. Fonts load from local webview assets, without runtime network requests or system-wide installation. Preserve system fallbacks for unsupported characters and emoji. The shared policy applies to chat/composer and standalone or embedded account/usage surfaces; shadow DOM inherits the same platform font variables. Windows Chromium rendering and simulated OS branches are distinct from native Linux/macOS and installed-host acceptance.

Localized visible labels and visible string labels require separate rendering boundaries. Accessibility strings stay strings. Rich text and interpolated values must preserve dynamic spans; applying a font to an entire interpolated message is insufficient. The selected typeface must have a defined local fallback for Korean and Latin text.

In custom typography, Windows dynamic prose, titles, account values and typed input use half-width spaces when Consolas is available. Cascadia Mono uses its natural space width on every platform. A local Consolas font face restricted to U+0020 uses `size-adjust: 50%` with ascent, descent and line-gap overrides that restore Consolas's full Windows vertical metrics. The half-width advance preserves full-height input carets and the model-name baseline, while visible characters retain their original metrics. Model selection keeps the native effort label and arrow layout. When Consolas is unavailable, the normal fallback space is preserved; subtracting `0.5ch` from a fallback face can erase its narrower space glyph. Chat Markdown roots and their paragraph, heading, list-item and table classes require explicit spacing rules because they set the content font without a `.font-content` wrapper; preparation checks the pinned prose CSS anchor. OpenAI mode excludes chat and composer from these custom font, weight and spacing overrides. Character spacing, font sizes and line heights remain unchanged. Code/preformatted text keeps normal spacing for alignment, and nested fixed UI controls reset word spacing. Dynamic account/usage values retain their independent custom typography in either mode, including shadow DOM panels.

### Fixed UI typeface

Status: `target` — fixed UI typeface selection is pending.

Fixed headings, menu labels, button text and instructions require a separate candidate selection and presentation comparison. The dynamic-font implementation does not select a new fixed-label font.

## Icon policy candidates

Status: `draft` — candidate comparison, no selected product style.

Compare a simple line family, an angular geometric family and a soft curved family at actual 16, 20 and 24 pixel sizes. Each family covers add, search, history, settings, new chat, account, permissions and send. Candidate generation is owned by `scripts/create-ui-design-preview.cjs`; its local HTML and individual SVG outputs are review artifacts under `artifacts/visualizations/azrael-ui-identity/`.

The candidate system uses a 24×24 coordinate grid, `currentColor`, consistent strokes within each family and equivalent light/dark shapes. Use 20px for ordinary controls and 16px for supporting icons. Size the interactive target separately from the visible glyph. Avoid vendor emblems for generic account/settings actions. Pair status colors with text or shape. Select one family before integrating product replacements; semantic meaning and small-size legibility determine acceptance.

## Preservation mapping

Registered features: `ui.submit-only-thread`, `ui.session-flags`, `ui.student-design`, `ui.project-drafts`, `ui.file-open-menu`, `ui.image-file-open`, `ui.missing-image`, `ui.local-file-drop`, `ui.composer-draft`, `ui.ui-cleanup`, `ui.pets-cleanup`, `ui.content-fonts`, `ui.command-drag-block`, `ui.scroll-fade`, `ui.thread-branch`, `ui.paginated-history`, `ui.recent-chat-filter`, `ui.session-links`, `ui.input-diagnostics`. The [contract index](upstream-preservation.md#contract-index) links to the executable inventory. Each section's stated source, native, package, installed and platform limits determine what that registered scope establishes; broader behavior is reviewed separately.
