# Input Queue execution

<!-- architecture: {"id":"arch.input-queue.execution","feature":"input-queue","layers":["engine"]} -->

Status: `current`, verified in scoped source and host-function tests; live
compaction UI behavior is user-verified. Procedure and verification scope are in
[operations](../../../ops/development.md#queue-and-compaction).

## Queue execution

### Pending Window Use approvals

Source implementation adds a separate durable `pendingApprovalCount`. Pending approval immediately holds automatic queued messages and compaction, independently of the 30-second initial tool wait. Missing or malformed counts fail closed. Questions and approvals can coexist; explicit send-now retains its existing behavior. A late approval uses a typed internal resume, never ordinary user text. Host fixtures, UI rendering and focused native engine integration are verified on Windows x64; installed acceptance and execution on other platforms remain pending.

### Unanswered asynchronous questions

Status: `partial`; implementation and verification are tracked in the
[question lifecycle work record](../../../../work/CL-01-question-withdrawal/01-plan.md)
and [request supersession work record](../../../../work/DC-01-queue-question-wait-diagnosis/02-plan.md).

Each question created by `request_user_input_async` has an engine-owned identity
returned to the model. Questions remain pending until answered through the
question reply path, removed by `withdraw_user_questions`, or superseded by an
accepted ordinary user request. Withdrawal accepts
multiple IDs without requiring a reason; resolution and withdrawal have the same
removal semantics. Repeated withdrawal is idempotent. Unknown IDs and IDs from
another conversation are rejected. Ordinary chat text is not interpreted as an
answer or detected as a question.

An ordinary user request withdraws the unanswered questions that exist when the
engine accepts that input, including when it steers active work or explicitly
starts a queued message. Merely registering a queued message does not withdraw
questions. Question replies preserve the other unanswered questions; scheduled
heartbeats and automatic resume do not establish a new user-request boundary.
Questions created after acceptance remain pending. Accepted answers remain in
history and are not withdrawn. Cancellation uses the existing withdrawn state
and inactive history disclosure, so queue checks and question handling share
one lifecycle.

The accepted-input journal stores the exact IDs superseded by that input before
applying durable withdrawal updates. Recovery and unloaded-thread queue queries
use those saved IDs rather than recomputing a cancellation set from later
questions. The retry digest binds the submitted input and excludes this
host-owned snapshot. A failed or retried input cannot broaden its withdrawal
scope. Existing histories without a supersession snapshot retain their recorded
question state until a new request is accepted or the questions are answered or
explicitly withdrawn.

The question tool description instructs the model to withdraw questions that
become unnecessary during work. There is no extra inference or mandatory question
review at turn completion. Asking does not stop independent work in the active
turn. When the turn becomes idle, pending questions hold automatic queue dispatch,
including queued compaction, without removing or reordering queued items. Removing
the last pending question makes the queue eligible under its other admission
conditions; it does not clear interruption, account-switch or recovery holds.

Queued question replies use the explicit `questionReply` operation kind. The
reply UI supplies this kind; text resembling a reply in ordinary queued input
does not acquire reply authority. This kind survives editing, storage and
reload. During a question hold the earliest queued reply may run ahead of
ordinary input; the relative order of the remaining queue is preserved. Core
validates its target IDs again at acceptance and records only those answers.
Other unanswered questions stay pending. Approval, interruption and recovery
holds still apply. Question replies bypass a pending account-switch hold using
shared account admission; the exclusive commit and failed recovery remain blocked.
Legacy ordinary queue records without reply
provenance remain ordinary; the user can resubmit through the question UI.

Question state is authoritative in the engine and survives reopening and restart.
Question changes and queue admission are ordered so another window or a stale
snapshot cannot dispatch through the hold. Reply and withdrawal races preserve
already accepted user input; a reply to an already withdrawn question cannot
restart work automatically. Withdrawn questions leave an inactive, collapsed
record in conversation history. Queue presentation identifies the pending-question
hold. These semantics are common to Windows x64, Linux x64 and macOS ARM64;
verification in one environment does not establish installed acceptance elsewhere.

Core owns the ledger in `core/src/session/user_questions.rs`. New question
messages receive UUIDs; each question ID retains the native tuple of tool name,
message ID and original question index. Durable `ItemCompleted` updates retain
the original message and turn identity. Withdrawal appends and flushes those
updates before committing the live state. Accepted direct replies record
`answered_async_question_ids` in host-owned history metadata, so replay does not
infer answers from ordinary user text. Loaded and unloaded queue queries expose
`pendingQuestionCount`, and question changes notify queue subscribers. Ordinary
input that leaves question state unchanged sends no question notification and
does not wait on realtime-history recording.

The automatic queue trigger is `queue`; explicit send-now uses `queue_user`.
Both keep Queue input provenance and treat their message content as ordinary
input. Explicit send-now may proceed while questions remain pending. The native
and legacy host coordinators recheck the engine count before automatic dispatch;
missing or invalid state retains the queue. Preservation feature:
`ui.question-withdrawal` for source/UI checks and `engine.question-withdrawal` for native and SDK checks.

Preservation feature: `ui.queued-compaction`; Core admission lives in
`engine/codex-rs/core/src/session/compact_input.rs`, with boundary and admission
tests in `compact_input_tests.rs` and host warning coverage in
`scripts/test-queued-compaction.cjs`.

Automatic compaction uses the [provider context policy](../context-budget/README.md); the queue's manual skip threshold remains independent of the automatic setting.

When a compaction reaches its execution point, Core atomically reserves an idle
turn, respecting pending trigger work, recovery reservations and execution admission.
It then checks the latest context usage: `last_token_usage.total_tokens`. A value
strictly below 80,000 tokens skips compaction; exactly 80,000 runs. The threshold
is independent of model capacity and the automatic compaction setting. Missing or
negative usage cannot establish the threshold and does not cause a skip. This avoids redundant compression when
an earlier queued or automatic operation already reduced the context.

The queue removes an item only after Core accepts it or reports a threshold skip.
A skip creates no synthetic model turn and processing continues to the next item.
Each threshold skip emits a thread-scoped warning. The host displays a native
warning toast explaining that compaction was not executed because context usage
is below 80,000 tokens. This applies both to requests
processed after an active turn and to idle or explicit queue starts. Enqueue
acknowledgement remains distinct from execution; busy admission keeps the request
queued without showing a skip notice. This feedback is implemented in source;
packaging and installed-window acceptance remain separate.
Admission failure retains the item. Execution errors use the existing compact-task
lifecycle and diagnostic paths. Existing direct compaction callers retain their
behavior; the composer routes to the queue.

The queue API adds an explicit operation kind (user input by default), preserving
existing user-message payloads. Queue storage carries either the existing serialized
user input or a typed compaction operation. Start responses distinguish a skipped
operation from an actual turn. The webview displays a compaction label and uses the
existing queue cancellation and ordering controls; compactions cannot be steered as
text into a running turn or edited into ordinary messages. Undo restores the kind.

The patched host enables the native queue using the server's existing queue
capability instead of an experiment flag. Unsupported hosts reject the request
before enqueue. While a persisted local-message backlog from the host's legacy
queue is non-empty, compaction enqueue fails explicitly rather than placing an
invisible native item ahead of local messages; the backlog must finish or be
cancelled first. Legacy messages are neither migrated nor deleted. Supported-host
queues use the native store for both messages and compaction.

The OpenAI account-change admission rules, including automatic queue suspension and explicit send-now, are owned by [account switching](../accounts/README.md#input-during-an-openai-account-change).

## Queue presentation

[Queue UI](ui.md) owns waiting and withdrawal presentation; execution and receipt meaning remain in this contract.
