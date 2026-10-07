# Root resume scheduling

Status: `current`. Scheduling semantics are verified with fake-clock and mock-provider fixtures; see [development operations](../ops/development.md#root-resume-reservations) for the procedure and verification scope.

## Behavior

Azrael lets the root defer its current task while its subagents keep executing. The root-only `azrael_agents.defer_root` control tool accepts exactly one of `resume_after_ms` (1 through 43,200,000) or a future UTC `resume_at`, a short reason, and optional `wake_on.agent_paths` with `condition: all_terminal`. The root resumes when the deadline arrives or all selected child tasks terminate, whichever comes first. Child success, failure and interruption are terminal; ordinary progress and unrelated mail are saved without waking the root. Targets are captured with their thread and current task/turn identities, so completion of an older task cannot satisfy a newer reservation. A reservation without targets is timed only. The tool is exposed only on providers with a verified native tool transport (currently the native OpenAI root path).

Scheduling persists a reservation and its originating tool-call identity before parking. The turn driver handles deferral explicitly: it makes no model request to acknowledge the schedule and does not report task completion. Root runtime, mailbox, thread identity and conversation remain available; subagents are neither interrupted nor recreated. The existing sleep and suspend-and-shutdown contracts are separate. Deferral happens at a completed tool boundary, and incompatible parallel control calls are rejected. Model instructions direct the root to defer at a dependency boundary instead of repeatedly polling agents or processes, and periodic-progress guidance is suspended while the root is parked.

## Reservation state

The engine owns at most one active reservation per root. Its durable record holds reservation ID, root thread ID, originating turn and tool-call IDs, task lineage, deterministic resume turn ID, due/created/updated times, selected child task identities, revision, state and optional wake/error details. States are preparing, waiting, claimed, resumed, cancelled and blocked. A preparing record is armed only after its matching tool result is persisted; failed persistence leaves normal root execution available. Revision-checked transitions and the normal single-writer thread admission prevent concurrent local starts from the timer, child completion and user actions. Exactly-once external submission across a crash is not promised: a crash during preparation or dispatch produces a blocked reservation.

New user input supersedes the reservation and is handled promptly. Resume-now and cancel act on a reservation ID and expected revision; cancelling affects only the reservation and leaves subagent work running. Matching terminal results are collected from native agent state and mailbox, not synthesized as a user message. Resume keeps task lineage and passes normal model, provider, account and permission admission without silently choosing another account; admission or recovery failure leaves a visible blocked reservation instead of a polling loop.

Timers run inside the engine on the existing async clock. Reservations are reconciled when their root thread is loaded after an engine restart, and deadlines that passed while the engine was down become eligible then. There is no always-on service and no execution while the engine is stopped. Recovery never discards accepted input, and explicit user cancellation or stop survives restart and prevents stale wakeups.

### Stopping a parked execution

Status: `target`; Rust execution verification and installed-host acceptance are pending.

A manual stop or explicit reservation cancellation first persists cancellation, stops its timer, and then emits a canonical interruption for the parked segment. The execution status becomes interrupted even though there is no active inference task to abort. Repeated stops emit no duplicate terminal event; children and recorded tool results remain available. Cancellation storage failure cannot publish a successful interruption. The terminal duration stays frozen at the defer boundary. An interrupted idle thread without subscribers can use normal unload and release its writer ownership.

## Deferred turn timing

A deferred execution segment stops its elapsed-time counter at the durable defer boundary, both live and after history reload; only the resumed segment advances. The engine publishes `turn/deferred` with a `deferred` turn status and the measured duration, leaving `completedAt` unset. The host freezes that segment and labels it as waiting to resume, without completion, interruption, unread-completion or automation-completion side effects. An unknown historical duration is shown as waiting without inventing a time.

The engine owns the boundary and duration. It captures the first durable waiting boundary once and reuses that measurement when a parked segment is cancelled or interrupted. A versioned derived-history checkpoint lets the existing rebuild path reproject an older loaded thread lazily while canonical records are kept. Reset and rebuild commit together after source parsing, keep the previous cache on source failure, and recheck the observed version so a concurrent rebuild is not deleted. No eager replay of all threads is performed.

## User interface

The integrated extension shows pending reservations, local resume times, selected child conditions, reason and blocked conditions on the **루트 재개 예약** page (`azrael.rootResume`), with resume-now and cancel actions. Countdowns and refreshes use engine events and ordinary UI timers, never model requests. The management bridge exposes the bounded `azrael/rootResume` list/resume/cancel contract; mutations carry reservation ID and revision.

### Chat work and waiting durations

Status: `partial`. Native timing source regressions, actual module-bound deferred/wait notifications, native activity projection and light/dark work-divider rendering are verified. The corrected UI package passed all six isolated host acceptance stages and is installed; existing user windows require reload and live confirmation. This UI package reuses the existing verified engine binaries and does not establish acceptance of newer native cancellation/timing changes.

Chat retains a fixed work duration for each deferred turn and measures resumed work from the new turn's start. A reservation's waiting divider shows its planned duration and elapsed waiting seconds; selected-child wake conditions use a maximum planned duration because children may finish early. Only the currently waiting reservation advances. Resume, cancellation, interruption and blocked admission freeze its elapsed duration and display the corresponding outcome. Completed work leaves every preceding segment frozen, including after history reload.

Waiting is keyed by reservation ID and its originating/resume turn identities. Authoritative waiting start and actual end timestamps survive reload; the scheduled deadline is not an actual end timestamp. Unknown historical waiting times remain explicitly unavailable rather than inferred from the work duration. Stale or duplicate notifications cannot reopen a finished waiting segment. A late active snapshot for a deferred turn preserves its deferred status and measured work duration, including during resume hydration; resumed work belongs to a new turn. The chat reuses the existing Codex work divider, secondary text styles and lifecycle-managed interval hook. Local UI ticks do not make model requests or replace native scheduling.

The reservation stores its first waiting timestamp and freezes the end on its first transition from waiting to claimed, cancelled or blocked. A claim marks the beginning of resume processing, so later admission retries retain that same elapsed waiting duration. The optional `Turn.rootResumeWait` carries reservation identity, revision, both nullable timestamps, deadline, state and whether selected children can wake it early. `turn/rootResumeWait/updated` changes this metadata without completing the deferred turn. Durable history and paginated turn/timeline metadata retain the same field. Segment presentation respects the source turn's deferred or terminal boundary instead of restoring an active work timer.

## Cost characteristics

A parked root holds no ongoing inference. Resuming makes a new request from retained conversation state, and provider prompt-cache reuse is independent of the reservation, so a cache miss can raise the input cost of the first resumed request. Savings come from avoiding repeated model wakeups and status checks, not from elapsed wall time. Prefer waking on selected child completion with a useful fallback deadline over short repeated timed wakeups intended only to keep a cache warm.
