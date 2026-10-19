# Reload and resume recovery

Status: `current`, verified with automated state, bridge, native crash/restart and isolated-host checks; manual reload of a live session is user-verified. Procedure and verification scope are in [operations](../ops/development.md#reload-recovery).

## Renderer startup admission

The host keeps the existing startup error boundary, but measures a 30-second interval without incoming webview traffic or recognized startup progress instead of aborting every startup at 30 seconds. `renderer_entry_evaluated` and `host_services_ready` count as progress; `renderer_ready` disposes the guard. Startup remains bounded by 120 seconds even if traffic continues. Disposal clears pending timers. This avoids replacing an actively initializing renderer with the failure page during a slow cold start, while silent and non-completing startup still fail. User state is preserved.

## Behaviour and ownership

The [shared-engine final-window shutdown](azrael-runtime.md#공용-실행기와-창-수명) candidate is `partial`. Intentional final close persists a per-thread manual-resume guard under `CODEX_HOME/azrael/runtime/manual-resume.json`. The host reads it before automatic recovery, and native queue/root scheduling guards honor it. A missing guard preserves existing crash-recovery behavior; malformed or unreadable guard state blocks automatic submission. Reattaching the original thread while another window keeps its engine alive does not submit a new turn. An accepted explicit user continuation clears that thread's guard; merely opening a window or selecting an account does not. Source fixtures and Windows native final-close interruption, original-context replay and populated-queue restart checks pass. Installed-host acceptance remains pending in the [current work](../../work/BJ-01-build-resource-pressure/01-plan.md).

The integrated host owns recovery presentation and admission for resume requests. The native engine remains the authority for live thread/turn state, thread writer ownership and interruption. Its existing `thread/read` and `thread/resume` normalization marks historical in-progress turns interrupted when no live turn exists; the host does not rewrite rollout files or invent engine state.

Native thread metadata reads share the existing per-thread writer lock with durable rollout writes and SQLite projection. A read waits for an initial write to finish before interpreting an exposed rollout path. An existing empty or malformed rollout without an active write still fails through the strict metadata parser. This common implementation is covered by the thread-store FIFO regression test and the provider-context native check; changed-engine and installed-host acceptance remain separate.

### Interrupted tool history and task failures

Status: `partial` — interrupted-call and unpaired-output recovery are implemented and covered by focused Windows x64 native tests. The isolated two-turn resume check covers an interrupted rollout. [Current unpaired-output verification](../../work/CT-01-orphan-output-recovery/01-plan.md) is separate from installed-host and other-platform acceptance.

An interrupted history can contain a custom or local-shell call without its output. Prompt normalization supplies the existing synthetic `aborted` result with a stable identity, including in debug builds. It operates on the prompt copy and preserves canonical history. The synthetic result indicates missing completion, not proof that an external action never executed; recovery never replays the tool.

Unpaired function, custom-tool and client tool-search outputs are projected as user-role reference messages marked as tool data requiring verification, including in debug builds. The prompt retains readable text and supported media without inventing a call or registering search results as available tools. Encrypted content remains in canonical history with an explicit reference placeholder. Recovery preserves the original history and envelope metadata, supplies stable prompt message identities, and never automatically replays an action or treats the result as proof of completion. Ordinary matched results, named external outputs and server tool-search results retain their existing representation. This common policy applies to Windows x64, Linux x64 and macOS ARM64; installed-host and other-platform acceptance are separate from native Windows checks. Preservation belongs to `engine.recovery`.

The native task execution boundary catches unwinding panics and passes the fixed fatal error `session task panicked` through normal turn failure and cleanup. It does not include the panic payload in the returned error or its diagnostic event. An already requested interruption retains ownership of its terminal event. This boundary covers task execution, not process aborts or failures inside terminal cleanup. A completed failure admits the user's explicit continuation through the host only for the exact native error; notifications alone never retry the task. Existing outcome-unknown receipt guards and live attachment still apply. Preservation belongs to `engine.recovery` and `ui.recovery`.

The host records a bounded resume receipt in VS Code workspace state before dispatch. It records an operation identifier, a hash of request parameters, client message identity when supplied, dispatch state and acknowledged turn identifier, never prompt or tool contents. The write must finish before dispatch. Concurrent identical resume attempts share one promise. A standalone continue request or the native empty-input resume action attaches to an already active turn instead of injecting another continue. Ordinary new instructions retain native steering behaviour.

### Persisted delivery reconciliation

Status: `partial`: host state and bridge regressions verified; installation and user-window acceptance pending.

An inactive thread's unresolved receipt can be reconciled against at most 20 native turns using its saved client message identity. Only an exact user-message identity on a completed, interrupted or failed turn confirms acceptance. The receipt becomes finished and a retry returns that existing turn without sending new input. Missing identity, absent or malformed history, changed connection and failed storage preserve the unresolved guard. Legacy receipts without identity require the existing explicit reviewed recovery action. The error names the Command Palette path `azrael: 실행 상태 및 복구` and its reviewed new-continuation action.

For an idle thread, the native UI's empty-input play action becomes a canonical `continue` text input while preserving its other parameters. The selected engine rejects an empty turn input, so this conversion is performed only after live-state admission; it is never injected into an already active turn.

A `systemError` thread may also admit an explicit continuation when its latest turn is `failed` with error category `other` and an exact known native inference timeout message: legacy helper idle, legacy no-output-frames for 120 seconds, engine request deadline, or helper failure with `provider_headers_timeout`, `provider_stream_idle` or `provider_request_deadline`. These errors have no dedicated protocol category, so admission matches only these engine-generated messages, not arbitrary text containing “timeout”. The same allowlist owns safe diagnostic classification and applies after loading a thread. Failures outside the timeout, usage-exhaustion, rate-limit, provider-rejection and server-error rules remain blocked. Active-turn attachment, persisted outcome-unknown guards and concurrent-request coalescing still apply; there is no automatic retry or tool replay.

### Manual continuation after a server error

Status: `current` in source, verified with host state and pinned bridge regressions; installed-window acceptance requires an updated host and reload.

A `systemError` thread whose latest turn is `failed` admits the user's explicit continuation or existing empty-input play action for structured `serverOverloaded`, `internalServerError` or `flexUnavailable` errors. HTTP connection, response-stream connection/disconnection and exhausted response-attempt categories also qualify when their structured `httpStatusCode` is an integer from 500 through 599. These conditions identify server failures without treating arbitrary network or request errors as server errors.

Historical category `other` failures qualify only for the complete OpenAI stream processing-error message with its request UUID, or the exact native helper failure message with `provider_http_5xx` and its native fatal/unclassified prefix. An HTTP 200 response can carry the OpenAI processing error inside its stream. Generic disconnect text and message lookalikes remain blocked. The shared admission classifier records only `server_overloaded`, `server_processing_error`, `server_unavailable` or `provider_server_error`, without the message or request UUID.

The continuation starts a fresh turn in the same thread using the selected model/account and retained history. Error notifications alone do not start inference. Live turns attach without a second request; loading a thread rechecks native state; duplicate clicks coalesce; unresolved dispatch receipts retain the reviewed-recovery guard. This rule does not add automatic retries or replay completed tool calls.

### Capacity recovery within a user request

Status: `current` in source: focused Windows native state, request, deadline and local termination checks pass; packaging, installed-window, live-service and Linux/macOS acceptance remain unverified.

Native OpenAI Responses sampling shares one capacity recovery budget across a substantive user request's turns and tool continuations. Only structured `ServerOverloaded` failures qualify. The first three additional inference requests wait 1, 5 and 10 seconds after the preceding failed request, respecting a longer server Retry-After deadline. Generic stream retries and transport fallback cannot add capacity attempts to that budget. Remote compaction, quota, authentication and ordinary connection errors retain their existing policies.

After all three attempts fail, the sampling consumer has been dropped and the engine waits up to 10 seconds for the previous local stream mapper to release its provider stream. Confirmed termination permits one connection recreation and one automatic continuation of incomplete sampling. A failed termination check stops with a distinct terminal error that cannot re-arm the capacity timer. WebSocket recreation removes the socket and connection-local continuation cache; HTTP obtains its next transport through the existing fresh route-client factory. Thread, provider, model, account, sticky turn routing, prompt-cache identity, history and completed tool outputs remain owned by their existing services. Cache hits and remote capacity availability are not guaranteed.

A further capacity failure returns control to the existing UI policy: 10, 30, 120 and 300 seconds, automatic maximum four attempts, with manual retry still available. The engine waits any remaining server deadline before handing the terminal error to that UI. It does not return to the short-retry or connection-recreation stages within the same user request.

The request identity comes from durably recorded substantive user input, using its client identity or turn/acceptance-order identity. Capacity retry, parked-root resume, empty play and canonical continuation inputs do not replenish the budget. Hooks must accept and record the input before a new budget is established. The thread-local budget survives sampling reentry and webview remount/reload while the native session stays loaded. Engine restart/unload does not restore this in-memory budget; a continuation with no known request budget uses the existing retry policy. Cancellation interrupts waiting and sampling without refunding consumed attempts. Completed tools and independent agents are not replayed or cancelled by connection recreation.

Preservation feature: `engine.capacity-recovery`. Its native state, deadline, cancellation, request-identity and local transport-termination checks are owned by the focused capacity verification route in [operations](../ops/development.md#reload-recovery).

### Manual continuation after an unclassified provider rejection

Status: `current` for state, pinned bridge and send integration regressions; installed user-window acceptance requires an updated host and reload.

A failed `systemError` turn with category `other` and the exact native message `미분류 오류: native inference helper failed (provider_http_400)` admits an explicit continuation or play action. This supports previously recorded provider rejections without rewriting their history or asserting that the underlying cause was quota exhaustion. Diagnostics classify the outcome as `provider_request_rejected`. The current selected account/model remains engine-owned, and live-turn attachment, unresolved delivery guards and duplicate-request coalescing apply. Automatic retries and tool replay are not authorized by this rule.

### Continuation after usage exhaustion

Status: `current`, verified with host state and bridge regression tests. Installed user-window inference is outside this verification scope.

A `systemError` thread whose latest turn is `failed` with structured error category `usageLimitExceeded` admits a user's explicit continuation, including the play action, after an account switch or a quota reset. The engine uses its current account selection and determines whether inference can proceed; the host does not require account-change evidence or infer available quota. Account updates alone do not dispatch a continuation. Opt-in [automatic quota recovery](accounts.md#automatic-account-switching) is admitted inside a live native sampling turn before it becomes failed; it is separate from this manual continuation and adds no user input. The category is classified as `usage_limit_exceeded` in diagnostics without recording the message. Message text alone cannot admit a usage-limit failure. This rule also applies after loading a thread, with the same active-turn attachment, outcome-unknown receipt guards and concurrent-request coalescing as other continuations.

### Manual continuation after a rate limit

Status: `current` in source, verified with host recovery regressions; installed-window acceptance requires an updated host and reload.

A `systemError` thread whose latest turn is `failed` with structured category `rateLimitExceeded` admits an explicit continuation or play action using the selected account/model, including after a provider change. No provider change or quota-reset evidence is required. The engine determines whether the new request can proceed. Message text alone does not admit a rate-limit failure. Live turns attach without dispatch, unresolved delivery receipts still block a new request, and concurrent continuation requests coalesce. Diagnostics record `rate_limit_exceeded` without provider message text. This rule adds no automatic retry, account switching or tool replay.

After reconnect, resume reads native live state. An acknowledged turn can be reattached by identity. A receipt left dispatching without an acknowledged result is outcome-unknown: no automatic replay. Live work can be reattached without claiming that it was caused by the uncertain request. When the engine is idle and the result remains unknown, the user must inspect the history and explicitly choose a fresh continuation. A protocol error alone is not proof that a mutation never executed. A dedicated account-admission marker emitted before request dispatch confirms rejection and finishes the continuation receipt; generic RPC and transport errors retain the outcome-unknown guard. This account-admission receipt handling is source-verified; installed-host acceptance is pending.

The receipt is a host recovery guard, not a distributed exactly-once tool executor. Other clients remain subject to native writer ownership. Tool replay, daemon lifetime separation and cross-client transaction protocols are outside this change.

## Bounded response preparation

Status: `partial`: common engine implementation; focused Windows native and host checks own source acceptance. Packaged/installed-window acceptance remains separate.

Model-independent context capture, initial context/display-root preparation, world-state construction and the context assembly immediately before sampling each have a 90-second deadline. Cancellation drops the pending preparation future. A deadline ends the turn with the exact terminal error `Fatal error: response preparation exceeded its 90s deadline`; it does not retry input, inference or completed tools. Initial preparation failures preserve accepted input through the existing recording/journal boundary. Inference, compaction, tool execution and human approval/input waits are outside these deadlines.

The host admits an explicit continuation or empty-input play action after this exact native failure with category `other`, while retaining live-turn attachment, duplicate coalescing and unresolved-delivery guards. Error notifications alone never dispatch a new request. Diagnostics use `response_preparation_timeout`; engine tracing records stage, outcome, elapsed time and thread/turn references without payloads. World-state tracing identifies base instructions, subagent context, clock/environment context and the numeric extension contributor being prepared.

Error presentation and telemetry categories follow the [evidence-based error contract](managed-providers.md#evidence-based-error-classification). Recovery actions preserve exact known host/native guards and structured categories; arbitrary incoming RPC messages and keyword matches do not establish a cause. Unmatched action failures display exactly `정의되지 않은 오류`. Delivery receipts, admission, state transitions and original native notifications retain their own contracts.

Preservation belongs to `engine.recovery` and `ui.recovery` in the feature inventory. Deterministic stalled-preparation and continuation checks are described in [recovery operations](../ops/development.md#reload-recovery).

## Visible states and recovery actions

A VS Code status item shows the most recently observed thread state. Its menu lists tracked threads and offers status refresh and interrupt-then-resume. Evidence comes from native notifications: recovery/start acceptance, agent output, tool activity, approval/input wait, completed/interrupted/error, and connection loss. Recovery shows `서버 연결 중 · 세션 확인`; pending engine admission shows `전송 대기 중`. Both use an animated status icon. After acceptance, initial silence shows `응답 대기 중` rather than claiming a new server connection is being established.

RPC acknowledgement is bounded at 20 seconds. A turn with no observable progress for 90 seconds is shown as delayed, not dead; human input waits are exempt. Silence does not automatically cancel model or tool work. Interruption recovery waits for a live idle snapshot before admitting a new continuation; timeout leaves the operation stopped at the recovery boundary. It never kills an extension host or a shared engine.

## Storage, lifetime and observability

Receipts use the extension workspace Memento (global Memento for an empty window), with a versioned key and at most 64 tracked threads. Unresolved receipts are not evicted to admit new work. Storage failure fails resume admission closed. The host logs only operation/thread identifiers, phases and safe error categories through a VS Code log output channel. VS Code owns log rotation and storage access. No conversation or tool payload is logged.

### Input delivery diagnostics

Status: `partial`: native phase logging and host request correlation are included in the integrated host. User-message receipt observation and UI visibility collection are source-verified additions; package acceptance and live-window capture for these additions remain pending.

User input diagnosis connects admission and execution to response delivery without recording conversation contents. The native app-server records input request arrival, serialized handler entry, native input-call return, response enqueue and abnormal handler abandonment. Transport response routing is a DEBUG detail. A handler abandonment record identifies cancellation or panic; it observes that boundary without retrying the mutation or recovering its queue.

The host records the actual wire request reference and response receipt, including late replies discarded after its deadline. It also observes incoming user-message started/completed notifications before UI processing. Native and host use the first 16 lowercase hex digits of SHA-256 over the same wire request ID string. Thread, turn and item references use the same hash format; client message identities use full SHA-256 for acceptance-receipt correlation. Fields are fixed stage/outcome labels, identifiers, connection number, numeric RPC code, elapsed time and counts. Request and response bodies, error text, tool arguments, credentials and environment dumps are excluded.

INFO covers the bounded input stages, WARN covers abandonment and failed delivery, and DEBUG covers all response routing. Records use native tracing and the existing VS Code log output, with their existing storage, rotation and retention limits. Missing records under those limits do not establish non-delivery. Diagnostics do not alter account admission, mutation ordering, timeout handling, response results or replay rules.

The packaging transform locates the pinned bridge methods structurally and refuses changed anchors. A small runtime module wraps the existing request boundary and observes normalized incoming messages; the official source copy stays unchanged. Runtime resources and timers are disposed with the integrated extension.

### UI input visibility diagnostics

Status: `partial`: the pinned-function diagnostic hooks are implemented and source-verified; packaged-host and live-window capture remain pending.

RPC acceptance and visible transcript ownership are separate observations. A local queue receipt can suppress a question before a canonical user message is available. Conversation updates can move one client identity between opening input, a server user message and a steering item; that movement is not input loss. The diagnostic compares those representations around both conversation mutation paths and records when the last representation of a client identity disappears. Queue consumption records whether the conversation already recognizes the accepted identity and whether removal persistence succeeds. Transcript projection separately records opening suppression, because a question can remain in conversation state while the projection hides it.

Records use the existing webview `log-message` transport and Azrael log output. Only UUID identifiers, fixed event labels, representation kinds, counts and suppression booleans are allowed. Text, attachments, serialized conversation state, exception payloads and environment data are excluded. Snapshot limits, repeated-state suppression and an event budget bound work and output; skipped diagnostics are counted. Diagnostic failures never change mutation results or replay input. These observations identify a state or projection boundary; they do not by themselves prove the question is absent from the rendered DOM or durable storage.

## Acceptance

### Parked-root steering and handler failures

Status: `target` for the approved input-delivery fixes.

A steering request whose expected turn matches the parked root reservation may wake that root by starting a new turn. Internal steering submission results distinguish `Started` from `Steered`; both successful cases return the actual owning turn ID through the existing steering response. Capacity admission runs before converting an idle parked-root steer into a start and before superseding its reservation. A mismatched expected turn remains rejected by the existing steering precondition.

Each initialized handler and serialized background job has a panic boundary. Handler unwinding completes before the queue advances, preserving exclusive ordering and shared-read barriers. A failed job is never replayed. Queued work remains available to the queue owner and the queue is removed when drained. An RPC that panics before its response is claimed receives an internal error with `data.requestOutcome = "unknown"` and `data.reason = "handlerPanicked"`; a response already claimed suppresses the fallback error. Panic diagnostics contain fixed labels and request hashes rather than panic payloads.

Host acceptance readback for uncertain start and steer results is owned by [send acknowledgement reconciliation](#send-acknowledgement-reconciliation).

### Accepted input durability

Status: `current`, verified with local journal tests and isolated native normal,
interrupt, warm-resume and crash/restart scenarios. User-window acceptance is
outside this automated scope.

A successful user-input acknowledgement transfers custody to durable native
storage before the response is returned. Input awaiting tool completion carries
its full payload, thread identity, client message identity and acceptance order;
in-memory pending input alone is insufficient custody. Storage failure rejects
admission without claiming acceptance. Retries of the same client message do not
create a second accepted input; a new identity with the same text is independent.

Consumption records the message in ordinary history and retires its pending
receipt only after that history is durable. Recovery reconciles receipts by
identity so a crash between history persistence and receipt retirement cannot
duplicate the message. SQLite and rollout-file writes are separate persistence
boundaries. Interruption, process restart and root handoff preserve unconsumed
accepted input. Explicit thread resume reconciles pending receipts with raw user
history before bounded reconstruction, then records missing inputs through the
existing input hooks. A loaded, idle session performs the same reconciliation on
explicit thread resume, serialized against input admission. Resuming a session
with an active turn leaves its pending input with that turn. If a raw user message
is durable but its message identity or attachment events are incomplete, recovery
repairs those events before retiring the receipt, without adding a second model
input. A blocked hook leaves its receipt pending. This recovery does not sample
the model; execution waits for explicit continuation.

The journal extends the existing local SQLite queue store. Pending records retain
the serialized input and its context; consumed records retain identity and payload
digest for retry reconciliation. Local media uses the protocol's existing input
snapshot operation. Custom and ephemeral thread stores retain their existing
semantics and are outside this local durability contract.

### Session dispatch ordering

Status: `current` in host state and bridge regression tests. Installed
user-window interaction is outside this automated scope.

The host orders `thread/resume`, `turn/start` and `turn/steer` requests per
thread. New input arriving during recovery waits for that recovery attempt to
succeed before reaching the engine; failure completes the waiting request with
the recovery error. Duplicate identical resume
requests share one attempt; distinct user inputs retain independent message
identities and dispatches. Other threads remain independent. Disconnect cancels
work admitted against the old connection generation. Native steering rejection
and the UI's existing state-based start fallback remain authoritative; the host
does not retry an uncertain mutation.

### Composer snapshot ownership

Status: `current`, verified with submission and attachment fixtures executing the
pinned host's transformed functions. Live user-window interaction is outside
this automated scope.

Submission captures the editable draft before asynchronous preparation. Clearing
the composer after message admission or queue registration applies only to that
captured draft. Text, selected files, images, comments and app context entered
while preparation or a response is pending remain in the editor. Acceptance and
failure recovery own the submitted message separately from a newer draft, and
must not restore old text or clear attachments over that draft. The same snapshot
check applies to early message-added callbacks and final queued/sent results.
Normal submission and failure restoration of an unchanged draft retain their
existing behavior. Snapshot checks reuse the pinned host's draft state and
comparison facilities; they do not disable typing during preparation.

### Send acknowledgement reconciliation

Status: `current`, verified with the pinned request client and queue coordinator and the isolated native engine's accepted-response and persisted message identity.

The host emits valid JSON for successful fetch routes with no return value by serializing their result as `null`. A missing start or steer acknowledgement is reconciled with bounded native history polling only when the request has a `clientUserMessageId`: the user-message item's `clientId` must match exactly. The specific internal error with code `-32603`, `data.requestOutcome = "unknown"` and `data.reason = "handlerPanicked"` is also eligible; ordinary native RPC rejection remains an error without readback. Acceptance can precede message-history visibility, so readback waits within a five-second budget and a hard 20-attempt cap instead of treating the first empty snapshot as rejection. Each read loads at most the latest 20 turns. A matching item returns `{ turn }` for start or `{ turnId }` for steer using the actual owning turn, including a newly started wake turn, allowing the queue coordinator to consume that request. No input is replayed. Missing identity, failed readback, changed connection, invalid history or no matching item by the bounded end preserves the original failure; an active thread or equal prompt text is not acceptance evidence.

Execution observations and request delivery outcomes are distinct. A missing acknowledgement does not erase an already observed live or completed turn. Receipts may remain outcome-unknown while the execution state remains observable. The existing log channel correlates the original UI request, client message, internal RPC and acknowledged turn identifiers without storing prompt or tool content.

Fault-injection tests cover duplicate resumes, persisted dispatch without response, restart with live or interrupted work, delayed acknowledgements, stage silence, storage failure, interruption before resume, timeout and usage-limit continuation admission, and preservation of ordinary steering. The pinned bridge transform is parsed and executed in a fixture, and a real engine is crashed and restarted with a synthetic interrupted history and a stalled local provider. Packaging must include the runtime modules. These checks establish the selected engine/host combination, not arbitrary upstream versions or replay of external tool side effects; user-window reload is outside automated acceptance.

## Pending submission and immediate stop

Status: `partial` — scoped asynchronous source fixtures cover target identity and bounded stopping; package and installed-window acceptance remain separate.

A stop requested while a submission is pending remains attached to that submission until its accepted native turn identity is known. It cannot interrupt a later turn or a different thread. Start admission and terminal-state confirmation are bounded separately; acknowledgement of an interrupt is insufficient to enable editing. Unavailable, stale, deferred or unconfirmed targets do not become successful cancellation through a timeout or a later notification. The UI preserves native errors and normal editing eligibility. The shared session contract and deadlines are owned by [new conversation history and immediate stop](azrael-ex.md#new-conversation-history-and-immediate-stop); `ui.immediate-stop` connects its UI boundary to preservation checks.

## Preservation mapping

Registered features: `ui.recovery`, `ui.fetch-response`, `ui.immediate-stop`, `engine.recovery`, `engine.accepted-input`. The [contract index](upstream-preservation.md#contract-index) links to the executable inventory. Each section's stated source, native, package, installed and platform limits determine what that registered scope establishes; broader behavior is reviewed separately.
