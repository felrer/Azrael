# Queued Context Compaction

Status: `current`, verified in scoped source and host-function tests; live
compaction UI behavior is user-verified. Procedure and verification scope are in
[operations](../ops/development.md#queue-and-compaction).

Manual compaction from the chat composer enters the durable server queue alongside
user messages. Items execute in queue order without interrupting the current turn.
An idle thread may immediately consume the head. Compaction is a distinct operation,
never a prompt instructing the model to compress its context. The existing queue
owns persistence, cancellation, reordering, cross-window notifications and pause
after interruption. Repeated requests remain individually cancelable items.

Automatic compaction uses the [provider context policy](context-policy.md); the queue's manual skip threshold remains independent of the automatic setting.

When a compaction reaches its execution point, Core atomically reserves an idle
turn, respecting pending trigger work, recovery reservations and execution admission.
It then checks the latest context usage: `last_token_usage.total_tokens` divided by
`model_context_window`. A strictly lower than 15% raw ratio skips compaction; exactly
15% runs. Missing, negative or otherwise invalid usage/window data cannot establish
the threshold and does not cause a skip. This avoids redundant compression when
an earlier queued or automatic operation already reduced the context.

The queue removes an item only after Core accepts it or reports a threshold skip.
A skip creates no synthetic model turn and processing continues to the next item.
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

The OpenAI account-change admission rules, including automatic queue suspension and explicit send-now, are owned by [account switching](accounts.md#input-during-an-openai-account-change).

## Queue presentation and legacy backlog

When a turn-start acknowledgement is lost, the host's [send acknowledgement reconciliation](reload-recovery.md#send-acknowledgement-reconciliation) verifies native acceptance by client message identity and returns the actual accepted turn through the existing success path. The coordinator consumes that message without replaying it. The pinned request client retains its promise through an outcome-unknown delivery notification so this reconciled result can complete the original request.

The pinned webview queue adapter treats a queue-change notification received
during an outstanding list request as invalidating that snapshot and repeats the
complete paginated read before publishing, so a message consumed during the read
does not stay visible. Native queue persistence and error reporting are unchanged.

### Local acceptance reconciliation

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

### Locally accepted submission results

Status: `current` in scoped source and packaged pinned-function integration tests.
Installed user-window interaction is outside this automated scope.

Once a follow-up has been persisted and published in the local queue, its
composer submission finishes as `queued` when dispatch fails, is deferred, or
is cancelled before acceptance. The queued item retains its original client
message ID, payload, position and failure or uncertain-delivery state. The
existing queue presentation exposes paused inputs and the existing send-now and
edit actions for confirmed failures. Queued, paused and outcome-unknown items
are visible immediately, including within the optimistic send display delay.
Unconfirmed delivery keeps send-now and edit disabled until acceptance can be
established. Editing moves the queued item into the composer through the queue
owner; submission failure does not also restore a second editable copy.

Failure before local persistence completes remains a submission error and keeps
the composer draft. Explicit send-now failures retain their error result and
the queued item. A queued result means custody of the input, not proof of native
execution. Uncertain delivery requires acceptance reconciliation before another
send. Native accepted-message removal continues to use the rules above.

## Compaction progress

The Responses parser forwards `response.compaction.compacting` as internal
progress. Remote v2 compaction reaffirms its context-compaction item once per
response attempt, keeping the item ID and original start time; repeated
heartbeats are coalesced. Completion is emitted only after the completed response
is validated and the compacted history installed. When compaction progress
starts, the host removes only same-turn transient `willRetry: true` error rows;
terminal errors, other turns and other items stay. Repeated starts keep the
existing manual/automatic source without consuming a later pending manual request.
No public protocol or stored context format changes.

A cached Responses WebSocket connection counts as closed when its command channel
closes or its background pump terminates, even if the stream wrapper still exists;
the client then reconnects, clearing connection-local continuation state and
sending the full next input. Healthy connections are reused. A peer closing after
the health check still goes through the existing bounded retry path.

Verification must cover message/compaction ordering, cancellation and reordering,
fresh usage at execution, below/equal/above threshold, absent usage, busy admission,
restart persistence, skipped-head continuation, queue refresh races and host routing.
Runtime installation and real compaction UI acceptance are separate from source and
controlled-transport verification.
