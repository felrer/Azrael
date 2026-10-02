# Queued Context Compaction

State: current source implementation, verified in scoped tests on 2026-09-16.
Core admission, queue ordering/storage, API operations and actual host-function
fixtures passed their relevant checks. This does not establish installed or live
UI behavior; validation scope and the unrelated protocol-suite failure are recorded
in [operations](../ops/development.md#queued-context-compaction).

Manual compaction from the chat composer enters the durable server queue alongside
user messages. Items execute in queue order without interrupting the current turn.
An idle thread may immediately consume the head. Compaction is a distinct operation,
never a prompt instructing the model to compress its context. The existing queue
owns persistence, cancellation, reordering, cross-window notifications and pause
after interruption. Repeated requests remain individually cancelable items.

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
before enqueue. A previously persisted legacy local-message backlog must first
finish or be cancelled: until it is empty, compaction enqueue fails explicitly
rather than placing an invisible native item ahead of local messages. No legacy
messages are migrated or deleted by this change. This transitional restriction
ends when that existing backlog drains; new supported-host queues use the native
store for both messages and compaction.

Verification must cover message/compaction ordering, cancellation and reordering,
fresh usage at execution, below/equal/above threshold, absent usage, busy admission,
restart persistence, skipped-head continuation, queue refresh races and host routing.
Runtime installation and real compaction UI acceptance are separate from source and
controlled-transport verification.
