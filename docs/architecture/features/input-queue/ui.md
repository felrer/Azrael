# Input Queue UI

<!-- architecture: {"id":"arch.input-queue.ui","feature":"input-queue","layers":["ui","host"]} -->

## Queued Context Compaction

Status: `current`, verified in scoped source and host-function tests; live
compaction UI behavior is user-verified. Procedure and verification scope are in
[operations](../../../ops/development.md#queue-and-compaction).

### Queue presentation and legacy backlog

When a turn-start acknowledgement is lost, the host's [send acknowledgement reconciliation](../conversation-recovery/README.md#send-acknowledgement-reconciliation) verifies native acceptance by client message identity and returns the actual accepted turn through the existing success path. The coordinator consumes that message without replaying it. The pinned request client retains its promise through an outcome-unknown delivery notification so this reconciled result can complete the original request.

The pinned webview queue adapter treats a queue-change notification received
during an outstanding list request as invalidating that snapshot and repeats the
complete paginated read before publishing, so a message consumed during the read
does not stay visible. Native queue persistence and error reporting are unchanged.

#### Local acceptance reconciliation

Status: `current` in scoped source and pinned-function tests; build, installation
and live acceptance of this reconciliation are pending.

While the local queue drains, its coordinator checks the native acceptance record
by client message ID before acquiring a send lock or replaying a restored
submission. This includes `pending`, `queued`, `sending` and `outcome-unknown`
metadata and paused messages whose acceptance is established. An unaccepted paused
message retains its pause. Reconciliation removes the accepted ID and wakes the
next queued message without sending a new request for the reconciled item.

Both metadata-bearing submissions and metadata-free legacy messages record
successful acceptance per thread for the coordinator's lifetime and await
persisted removal by ID before releasing their send lock. Reads, restored
snapshots and later writes exclude accepted IDs. Deferred or failed sends stay
queued; a new ID with identical text is a separate message. A persistence failure
uses the existing queue failure diagnostics and retains the in-memory acceptance
receipt. Disposal clears the receipts. After reload, available native acceptance
records establish removal; absent history does not prove that delivery failed.

The native queue adapter retains its app-input confirmation guard. Plain text
with empty app attachments and open-page instructions is ordinary user input.
Unreviewed app messages and model context use the existing review path; local
acceptance reconciliation neither drops their payload nor bypasses confirmation.

#### Locally accepted submission results

Status: `partial`. Queued-result handling is verified in scoped source and
packaged pinned-function integration tests. Immediate pending/sending visibility
and waiting presentation are verified in scoped source tests; packaging and installed user-window
interaction are pending.

Once a follow-up has been persisted and published in the local queue, its
composer submission finishes as `queued` when dispatch fails, is deferred, or
is cancelled before acceptance. The queued item retains its original client
message ID, payload, position and failure or uncertain-delivery state. The
existing queue presentation exposes paused inputs and the existing send-now and
edit actions for confirmed failures. Pending, sending, queued, paused and
outcome-unknown local items are visible immediately, including within the
optimistic send display delay and when their client message ID matches the
optimistic opening input. Local custody remains visible until the queue owner
removes the accepted item; an optimistic display identity alone cannot remove
it from the queue presentation.
Pending and sending rows reuse the queue's reduced-motion-aware spinner and
show `전송 대기 중` as a visible, polite status announcement. This label means
the saved input is awaiting engine acceptance; it does not claim that an OpenAI
connection is being established. Paused and uncertain rows retain their existing
warning presentation and admission controls.
Unconfirmed delivery keeps send-now and edit disabled until acceptance can be
established. Editing moves the queued item into the composer through the queue
owner; submission failure does not also restore a second editable copy.

Failure before local persistence completes remains a submission error and keeps
the composer draft. Explicit send-now failures retain their error result and
the queued item. A queued result means custody of the input, not proof of native
execution. Uncertain delivery requires acceptance reconciliation before another
send. Native accepted-message removal continues to use the rules above.

## Azrael UI presentation

### Withdrawn questions and queue waiting

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
[work record](../../../../work/CL-01-question-withdrawal/01-plan.md).

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
Implementation and verification scope: [question badge work record](../../../../work/DL-01-withdrawn-question-badge-diagnosis/01-plan.md).

Queued messages held by unanswered questions show **사용자 답변 대기 중** through
the existing queue status surface. The queue retains its order, cancellation and
explicit send controls. State and automatic dispatch authority belong to the
[question and queue contract](execution.md#unanswered-asynchronous-questions).
Preservation feature: `ui.question-withdrawal`.
