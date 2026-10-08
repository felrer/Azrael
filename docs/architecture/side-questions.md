# Side questions with /btw

Status: `partial implementation` — source implementation, Node fixtures and rendered panel controls are verified. Rust compilation, installed-host and real-account acceptance are outside the current no-build task.

## User flow and isolation

`/btw <question>` opens a native Side chat panel while the main task continues. `/btw` with no question opens the panel without starting inference. Questions are text-only and use the main task's current model and supported reasoning selection. The panel renders responses, follow-up input, cancellation and tabs through the pinned native components and theme tokens.

Every question starts an independent ephemeral thread from an immutable snapshot of the main task's current model context. Completed tool results and the retained compaction context remain reference material. Existing history normalization supplies an `aborted` placeholder for an unfinished tool call; it does not invent a successful result or alter the source history. Previous side questions and answers provide bounded reference context; they are not new instructions to execute. The current side transcript is copied for display when its underlying ephemeral thread is replaced.

Side questions and answers never enter the main task's transcript, input queue, steering, compaction or automatic summaries. Side threads use ordinary user-fork ownership rather than agent-spawn completion notifications. The panel and its history live in the current UI session. Closing it discards its ephemeral execution and UI state. Main-task execution and files are shared references, not a writable workspace for side questions.

Follow-up questions wait for the side answer to complete or be stopped. Each follow-up takes a fresh main-task snapshot. Closing, stopping and replacing the side conversation affect only its own thread. Startup and submission failures preserve the main draft and do not retry inference automatically. An expired panel's ordinary Side chat recreation action is blocked; the user opens another `/btw` from the main task to retain the tool-free boundary.

## Tool and execution boundary

The `thread/fork` request's `sideQuestion` flag requires `ephemeral: true` and `excludeTurns: true`. It accepts a live source, without stored-history fallback, explicit rollout paths, turn cutoffs or goal continuation. The live snapshot is read under the source's existing synchronization and remains immutable after capture. The response acknowledges `sideQuestion: true`; a client receiving an unacknowledged fork discards it and reports unsupported engine behavior before submitting side inference.

The engine installs an immutable startup tool policy with an empty allowed-tool list. Native, hosted, MCP, dynamic and generated Code Mode tools are omitted and cannot dispatch. Later settings or catalog changes cannot relax this ceiling. Side sessions do not inherit automatic goal execution or run executable hooks. Context inherited from the main task is reference material, even if it contains unfinished plans, requests or approvals. Insufficient evidence produces an explanation of the missing information rather than new exploration.

## Explicit delivery to the main task

The panel's transfer action submits selected text inside the panel, or its latest answer when no text is selected, through the native ordinary follow-up coordinator for the main task. This explicit action is the only path that delivers side content to the main task. Loading, success and failure are visible; a failure does not automatically resend. Main-task admission and steering retain their ordinary semantics.

## Verification boundary

Source fixtures exercise the actual transformed composer and native Side chat wiring with synthetic host state. Rendered native React, buttons and CSS in both themes verify the changed panel controls. Rust integration tests cover live-context isolation and the no-tool ceiling; execution of those tests requires a separate authorized build scope. Source verification does not establish installed-host or provider acceptance.
