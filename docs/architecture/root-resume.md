# Root resume scheduling

Status: `current`. Scheduling semantics are verified with fake-clock and mock-provider fixtures; see [development operations](../ops/development.md#root-resume-reservations) for the procedure and verification scope.

## Behavior

Azrael lets the root defer its current task while its subagents keep executing. The root-only `azrael_agents.defer_root` control tool accepts exactly one of `resume_after_ms` (1 through 43,200,000) or a future UTC `resume_at`, a short reason, and optional `wake_on.agent_paths` with `condition: all_terminal`. The root resumes when the deadline arrives or all selected child tasks terminate, whichever comes first. Child success, failure and interruption are terminal; ordinary progress and unrelated mail are saved without waking the root. Targets are captured with their thread and current task/turn identities, so completion of an older task cannot satisfy a newer reservation. A reservation without targets is timed only. The tool is exposed only on providers with a verified native tool transport (currently the native OpenAI root path).

Scheduling persists a reservation and its originating tool-call identity before parking. The turn driver handles deferral explicitly: it makes no model request to acknowledge the schedule and does not report task completion. Root runtime, mailbox, thread identity and conversation remain available; subagents are neither interrupted nor recreated. The existing sleep and suspend-and-shutdown contracts are separate. Deferral happens at a completed tool boundary, and incompatible parallel control calls are rejected. Model instructions direct the root to defer at a dependency boundary instead of repeatedly polling agents or processes, and periodic-progress guidance is suspended while the root is parked.

## Reservation state

The engine owns at most one active reservation per root. Its durable record holds reservation ID, root thread ID, originating turn and tool-call IDs, task lineage, deterministic resume turn ID, due/created/updated times, selected child task identities, revision, state and optional wake/error details. States are preparing, waiting, claimed, resumed, cancelled and blocked. A preparing record is armed only after its matching tool result is persisted; failed persistence leaves normal root execution available. Revision-checked transitions and the normal single-writer thread admission prevent concurrent local starts from the timer, child completion and user actions. Exactly-once external submission across a crash is not promised: a crash during preparation or dispatch produces a blocked reservation.

New user input supersedes the reservation and is handled promptly. Resume-now and cancel act on a reservation ID and expected revision; cancelling affects only the reservation and leaves subagent work running. Matching terminal results are collected from native agent state and mailbox, not synthesized as a user message. Resume keeps task lineage and passes normal model, provider, account and permission admission without silently choosing another account; admission or recovery failure leaves a visible blocked reservation instead of a polling loop.

### Cancelling an unloaded root

Status: `current` in source — Windows native cancellation and conversation reload regressions pass; packaging, installation and process-restart acceptance remain separate.

Reservation cancellation accepts loaded and unloaded roots through the same ID and expected-revision contract. Loaded roots use the session's existing cancellation boundary. An unloaded root's reservation transitions durably to cancelled and leaves the active reservation list, without loading the conversation, arming an overdue timer or starting inference. Loading the root later cannot resume a cancelled reservation. Concurrent cancellation, claim and thread loading preserve revision checks and authoritative storage state; stale requests require refresh. Conversation history and child work are retained. Cancellation requires the manager's reservation storage to be available; manual resume retains its loaded-root admission contract.

Timers run inside the engine on the existing async clock. Reservations are reconciled when their root thread is loaded after an engine restart, and deadlines that passed while the engine was down become eligible then. There is no always-on service and no execution while the engine is stopped. Recovery never discards accepted input, and explicit user cancellation or stop survives restart and prevents stale wakeups.

### Stopping a parked execution

Status: `target`; Rust execution verification and installed-host acceptance are pending.

A manual stop or explicit reservation cancellation first persists cancellation, stops its timer, and then emits a canonical interruption for the parked segment. The execution status becomes interrupted even though there is no active inference task to abort. Repeated stops emit no duplicate terminal event; children and recorded tool results remain available. Cancellation storage failure cannot publish a successful interruption. The terminal duration stays frozen at the defer boundary. An interrupted idle thread without subscribers can use normal unload and release its writer ownership.

## Deferred turn timing

A deferred execution segment stops its elapsed-time counter at the durable defer boundary, both live and after history reload; only the resumed segment advances. The engine publishes `turn/deferred` with a `deferred` turn status and the measured duration, leaving `completedAt` unset. The host freezes that segment and labels it as waiting to resume, without completion, interruption, unread-completion or automation-completion side effects. An unknown historical duration is shown as waiting without inventing a time.

The engine owns the boundary and duration. It captures the first durable waiting boundary once and reuses that measurement when a parked segment is cancelled or interrupted. A versioned derived-history checkpoint lets the existing rebuild path reproject an older loaded thread lazily while canonical records are kept. Reset and rebuild commit together after source parsing, keep the previous cache on source failure, and recheck the observed version so a concurrent rebuild is not deleted. No eager replay of all threads is performed.

## User interface

The integrated extension shows pending reservations, local resume times, selected child conditions, reason and blocked conditions on the **루트 재개 예약** page (`azrael.rootResume`), with resume-now and cancel actions. Countdowns and refreshes use engine events and ordinary UI timers, never model requests. The management bridge exposes the bounded `azrael/rootResume` list/resume/cancel contract; mutations carry reservation ID and revision.

### Waiting agents and manual resume

Status: `current` in source — native Windows light/dark rendering and resume interactions verified at normal and 360px widths; packaging, installation and other platform acceptance remain separate.

While a reservation is waiting, its chat divider shows the selected child agents after the waiting duration when selected-child completion can wake the root. It reuses each child's existing assigned photo and avatar fallback, with adjacent avatars overlapping by one third of their width. Accessible names identify the selected agents. Timed-only reservations have no agent group.

The same row places a native **재개** action at the right edge. It resumes the displayed reservation through the existing reservation-ID and revision-checked management contract. A pending request prevents repeated submission; failures remain visible, and an automatic resume or stale-revision result reconciles authoritative state. Ended reservations have no active resume action. Manual resume keeps the selected children running and passes the engine's normal admission checks.

### Chat work and waiting durations

Status: `current` for the verified reused engine and pinned UI. Exact isolated package r12 (`0.5.1791491963456`) passed 89 selected regressions, all six archive-runtime host checks and actual subagent/scheduled-resume verification with a waiting-time Reload Window. The old work boundary remained frozen and the restored wait changed to its ended state; its displayed 179 seconds stayed fixed while resumed work continued. Actual light/dark rendering and existing wait disclosure interactions passed. These UI changes reuse the existing verified engine binaries and do not establish acceptance of newer native cancellation/timing changes. Evidence: `artifacts/logs/resume-timer-deploy-20261008/`.

Chat retains a fixed work duration for each deferred turn and measures resumed work from the new turn's start. A reservation's waiting divider shows its planned duration and elapsed waiting seconds; selected-child wake conditions use a maximum planned duration because children may finish early. Only the currently waiting reservation advances. Resume, cancellation, interruption and blocked admission freeze its elapsed duration and display the corresponding outcome. Completed work leaves every preceding segment frozen, including after history reload.

Waiting is keyed by reservation ID and its originating/resume turn identities. Authoritative waiting start and actual end timestamps survive reload; the scheduled deadline is not an actual end timestamp. Unknown historical waiting times remain explicitly unavailable rather than inferred from the work duration. Stale or duplicate notifications cannot reopen a finished waiting segment. A late active snapshot for a deferred turn preserves its deferred status and measured work duration, including during resume hydration; resumed work belongs to a new turn. The chat reuses the existing Codex work divider, secondary text styles and lifecycle-managed interval hook. Local UI ticks do not make model requests or replace native scheduling.

The reservation stores its first waiting timestamp and freezes the end on its first transition from waiting to claimed, cancelled or blocked. A claim marks the beginning of resume processing, so later admission retries retain that same elapsed waiting duration. The optional `Turn.rootResumeWait` carries reservation identity, revision, both nullable timestamps, deadline, state and whether selected children can wake it early. `turn/rootResumeWait/updated` changes this metadata without completing the deferred turn. Durable history and paginated turn/timeline metadata retain the same field. Segment presentation respects the source turn's deferred or terminal boundary instead of restoring an active work timer.

The extension-host and renderer notification admission tables must both enable `turn/deferred` and `turn/rootResumeWait/updated`. Renderer ingress rejects unrecognized methods before calling the notification manager, so reducer-only verification does not establish delivery. Packaging and regression checks cover both tables and the renderer's actual imported admission predicate. An asynchronously deferred lifecycle response also returns the native routing receipt immediately; the line dispatcher must be able to continue delivering later notifications while window registration completes.

Historical rows subscribe to the native full turn-details selector and include that value in their materialization cache dependency. A wait update can change only reservation metadata while the turn ID, status and item IDs remain identical. Subscribing to those three values alone leaves a restored row displaying its old wait object even when the canonical store and metadata query already contain the ended wait. The regression executes the native row cache across waiting, claimed and resumed states with those three values unchanged.

### Reconciliation of a missing defer notification

Status: `current` for canonical/legacy history reconciliation and restored row invalidation. The native full turn-details subscription covers wait-only changes with unchanged status, ID and items. Waiting-time reload verification confirms that the canonical resumed update reaches the restored row and freezes the old wait while the new turn continues. Current installed package and verification scope are owned by [development operations](../ops/development.md#current-state).

An originating turn with a waiting, claimed or resumed reservation has stopped working even if its local status still says `inProgress`. Cancellation or blocked admission establishes this boundary only when the reservation has a recorded waiting start; a reservation cancelled during preparation does not stop unrelated active work. Presentation freezes the originating work segment immediately. Its work duration remains unavailable until the engine supplies the measured value; waiting timestamps are not used to estimate work duration.

The host reconciles the exact conversation, originating turn and reservation through the existing native turn metadata query and history merge path. Concurrent queries for the same originating turn are shared. Reservation updates and a new resume turn provide reconciliation opportunities without model calls, periodic requests or automatic task execution. A missing local turn retains its reservation boundary until authoritative metadata or normal history loading can apply it. Late snapshots cannot reactivate a reconciled deferred turn, and terminal interruption or completion remains authoritative.

A new native manager loses its in-memory reconciliation journal. Restoration must seed that journal from authoritative paginated turn metadata rather than assume deferred notifications will be replayed. A new turn with an older locally active turn is another reconciliation opportunity; the query must identify the originating turn through its persisted reservation metadata and leave the new turn active. These queries run at lifecycle boundaries, share concurrent work and have a finite page budget.

The new-turn opportunity also covers deferred origins whose reservation is still waiting or claimed, or whose measured duration is unavailable. A query already in flight may contain a pre-resume waiting snapshot. One trailing reconciliation pass is retained after that query settles if the exact older origin remains unresolved; duplicate start notifications share the same opportunity. Ended reservations with measured work and terminal turns require no additional pass.

If both origin wait metadata and its deferred event are absent from durable history, the existing active-reservation list cannot reconstruct an ended reservation. Recovery of that storage failure requires a separate authoritative reservation-read contract covering ended states; inference from neighboring turns or a scheduled deadline does not establish a work boundary.

Reconciliation records correlation IDs, reservation revision, outcome and page count through the existing host logger. Lookup or metadata failure leaves the previous work clock frozen with an unavailable duration and keeps the resumed turn independent. A newer matching wait end can update a completed or interrupted turn's waiting divider while retaining its work status and measured duration. Reconciliation does not generate completion notifications or completion side effects.

### Work segment folding

Status: `current` in the source transformation and verified native activity/disclosure rendering for UI 26.1007.21434. Full turn-page and installed-window acceptance remain separate; the installed package identity is owned by development operations.

A closed activity segment or a deferred work segment with renderable activity can be collapsed before a final answer starts. It uses the native work header, disclosure button, chevron and keyboard behavior. Its initial contents stay expanded; an explicit native collapse preference takes precedence. Normal active turns retain their existing expansion policy. Empty groups, a standalone context compaction, full transcript views and intro-only presentations retain the native exclusions.

An unfinished approval, user-input question, server elicitation or permission request excludes the affected segment from the new folding eligibility, preserving its existing request presentation. Running child activity retains the native automatic-collapse protection while allowing manual folding of its parked parent's work.

Collapse state belongs to the existing native conversation and segment search key. A resumed turn or another closed segment has independent state. Wait updates, history hydration and late child activity keep the original segment's key and its manual preference. Session switching within the same application scope retains that preference; a new scope uses the native initial policy. Folding does not add persistent preferences across application restarts.

Work and waiting measurements remain owned by the turn and reservation contracts. Folding changes neither their identities nor their status or duration. Work headers and reservation waiting/resume dividers remain visible when the activity contents are collapsed, so the reservation's state can be checked without expanding the work.

## Cost characteristics

A parked root holds no ongoing inference. Resuming makes a new request from retained conversation state, and provider prompt-cache reuse is independent of the reservation, so a cache miss can raise the input cost of the first resumed request. Savings come from avoiding repeated model wakeups and status checks, not from elapsed wall time. Prefer waking on selected child completion with a useful fallback deadline over short repeated timed wakeups intended only to keep a cache warm.
