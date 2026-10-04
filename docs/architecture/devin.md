# Devin and mixed-provider agents

Status: `current` for native Devin inference with Codex tools and sessions, catalog and agent selection. Real-model scope, deterministic scope and remaining limits are recorded in [Devin native operations](../ops/devin-native.md). The legacy ACP path is retained only for existing ACP threads.

## Catalog and model selection

The official chat model dropdown is the selection surface. The engine merges the native OpenAI catalog with the authenticated Devin account's model variants. Each Devin selection has a collision-free provider-qualified key (for example `devin/swe-2-medium`) and a display name suffixed with `(Devin)`. The `swe` family alias is never used for pinned SWE-2 execution. Variants keep their provider's actual capabilities; Astra metadata is not a Devin template. Variants without a reported context limit are excluded from discovery and direct selection; an omitted output limit does not exclude a variant. No fabricated model UID or capability is sent to Devin.

Reasoning variants of the same model and execution tier appear as one visible model with native supported/default reasoning metadata; the existing effort selector chooses the exact catalog variant at execution time. General and Fast remain separate, as do Priority and context-size variants. Only unambiguous catalog effort labels are grouped; unknown or composite variants stay exact selections. Unsupported effort choices fail explicitly. Saved exact variant keys remain resolvable. For model-only role overrides, only an ungrouped Devin selection clears inherited reasoning effort, because its exact variant already fixes it; native OpenAI and grouped Devin roles keep inherited effort, and an explicitly configured role effort takes precedence. An exact variant must not be paired with a separate `default_subagent_reasoning_effort`; that conflict is rejected before role application.

A configured catalog path lets the pinned UI show custom models; the engine owns the merged catalog and keeps native OpenAI online refresh active. The pinned `codex_vscode` picker requests 100 models without following pagination, so with Devin enabled and the managed catalog marker present its first visible-model query returns the full merged catalog. Other clients, smaller explicit page sizes, hidden-model queries and cursor requests keep native pagination.

A failed online catalog refresh keeps the last valid in-memory catalog and the persisted snapshot `azrael/devin/models.json`; failed offline reads keep valid in-memory metadata. Successful refreshes, including an empty catalog, are authoritative. The refresh warning states that the previous snapshot is in use, and absence of any valid snapshot still fails resolution. Retention grants no authentication or entitlement: credential, account, exact-variant and provider checks remain mandatory. Login, refresh and logout update the same engine's registry and model list. An unavailable or unknown Devin selection, including a saved selection after logout, fails explicitly and never reaches the OpenAI endpoint.

**Image input capability.** Each selection's input modalities come from the provider's own `ClientModelConfig.supports_images`, resolved through the native helper's capability lookup and persisted separately as `azrael/devin/capabilities.json`. A model advertises `text` and `image` only when that verified capability is present; anything unverified stays text-only, and no modality is inferred from a name, family or suffix. A grouped model exposes image input only when **every** selectable member is verified, so an effort choice can never silently land on a text-only variant. The capability snapshot is ignored unless the native transport is enabled, so legacy ACP threads remain text-only.

The model key resolves to provider, exact model, runtime and authentication owner at thread creation, turn overrides, child creation and resume. Root and child selections are independent: an Astra root can spawn a SWE-2 child without changing the root account or provider. The existing subagent lifecycle owns progress, follow-up input, waiting, interruption and completion.

## Native inference

Devin produces text, reasoning and tool calls only. The Codex engine owns tool registration, call validation, execution, permission decisions, result delivery, conversation storage and resume. Code-mode, the plaintext `azrael_agents` tools, account isolation and native rollout are shared with other providers.

`providers/devin/helper.mjs` and a minimal pinned TypeScript transport run as a per-request child process under an external Node 22.18+ runtime using built-in TypeScript stripping; there is no npm dependency, Bun or HTTP server. The transport uses Devin's cloud Connect-RPC `GetChatMessage` (an unofficial, pinned adapter derived from opencodex `9f7397ed1582d95c6c1fcf4ae9951213b3fa2d19`). Namespace/custom/history conversion is the local `mapping.mjs`. Ported files, licenses and original/local SHA-256 are owned by `providers/devin/UPSTREAM.md`. The engine side is `core/src/devin/native_runtime*.rs` behind the common `runtime::stream` boundary.

```mermaid
sequenceDiagram
    participant C as Codex session and turn loop
    participant A as Devin helper
    participant D as Devin inference service
    participant T as Codex tool and permission executor
    C->>A: canonical history + effective tools + exact model
    A->>D: provider request
    D-->>A: text, tool calls, termination
    A-->>C: canonical events, call IDs, arguments
    C->>T: validate declaration, arguments, permission; execute
    T-->>C: canonical tool result
    C->>C: persist native history
    C->>A: next inference with tool results
```

The helper has no shell, file, MCP or subagent execution capability and no permission policy. It uses dedicated stdin/stdout for versioned frames (`protocol_version`, `request_id`, native thread/turn IDs, exact model, canonical messages/tools/results, supported reasoning options; responses carry the request ID, sequence number, kind and payload) and routes stderr to the engine's diagnostic sink. No port or resident server is opened. Each concurrent request and child session uses its own helper and cancellation token; the engine cleans up on cancellation, termination and parent exit. Limits: 8 MiB per input and frame, 16 MiB total response, 64 KiB credential file, 10 seconds for input delivery. Exceeding a limit fails explicitly and never truncates silently.

The engine resolves the selected model from its persisted catalog before starting each helper, and the helper skips the transport's redundant catalog preflight; standalone transport callers keep preflight. Server inference errors stay authoritative. Every 10 seconds and at termination the helper emits a content-free progress frame (phase preflight/headers/stream, elapsed time, network idle time, byte and decoded-event counts, last event kind). Progress frames never become history or tools. Provider headers are capped at 300 seconds and Devin body silence at 120 seconds; the helper's absolute request budget is 900 seconds and the engine's independent deadline 915 seconds. Timeout errors (`provider_headers_timeout`, `provider_stream_idle`, `provider_request_deadline`) identify the boundary.

### Inference activity and bounded recovery

Status: `current` for source, focused mock and packaged-host validation. The installed diagnostics update applies to running windows after reload.

The engine's 100-second inactivity watchdog observes validated output frames and fresh decoded provider events reported by progress telemetry. A strictly increasing event count with a recent event age proves activity even when reasoning and tool arguments remain buffered. The engine accounts for reported event age rather than treating receipt of a delayed report as fresh generation. Network bytes, heartbeat frames and repeated or regressing event counters do not extend inactivity. One independent 915-second engine deadline covers both attempts and their retry delay, even during continuous generation; a replacement helper receives only the remaining engine budget.

An engine-watchdog inactivity failure before any buffered response is published may retry the identical inference once. The failed helper is terminated before replacement; discarded partial calls and text never enter history or execute. Retries retain the same provider, model, account, request identity and request input, keep cancellation and consumer-drop handling, and are distinguished by attempt number in diagnostics. Helper-reported failures, protocol errors, authentication, quota, invalid requests, absolute deadlines and uncertain or published outcomes do not authorize recovery. A second engine inactivity failure ends the request with its last safe event kind, inactivity duration and retry outcome. Output publication and terminal delivery also observe cancellation, consumer drop and the shared deadline, so a full consumer queue cannot retain the turn indefinitely; interruption after publication never retries. This policy prevents duplicate tool execution while bounding additional inference cost and waiting time.

Untrusted provider output is validated before becoming native calls; helper output alone grants no execution. The engine verifies the call declaration, kind, ID, argument completeness and current-turn ownership. The helper produces text deltas, but the engine forwards accumulated events only after a valid terminal, EOF and successful helper exit, so text appears per request rather than token by token, and incomplete output never executes tools. Each request settles its terminal state once; late deltas or duplicate completions cannot revert a stored terminal. A valid, error-free Connect EndStreamResponse terminates visible text or a validated tool call even without a protobuf finish-reason field; explicit finish reasons are authoritative, a finish field is applied only after all content in its frame, and missing/malformed/error trailers, trailing bytes, cancellation, empty or reasoning-only responses and incomplete tool arguments fail.

### Temporary stall investigation

Status: `current` for source, focused mock and packaged-host validation; the installed diagnostics update applies to running windows after reload. Helper requests have a 900-second absolute limit; the engine shares a 915-second logical budget across attempts and delivery, and generation inactivity is 100 seconds. Network heartbeats and diagnostic frames do not count as generation activity.

Temporary boundary instrumentation records pending network reads and their age, received chunk counts, complete SSE frames and heartbeat counts, incomplete-frame byte counts, provider-declared thinking/tool block state, adapter iterator waiting and decoded-event counts, response status and hashed response correlation metadata, and safe abort/error origin. The optional `progress.transport` object is strictly typed before recording as `native_inference_transport` in the existing sink. Periodic and terminal snapshots contain only bounded numbers, allowlisted labels and hashes, never source content or raw headers.

These observations can distinguish client-visible network silence, heartbeat-only streams, partial frames, adapter delay and helper stdout backlog. A thinking block reports the provider's declared state; it does not prove current server computation. A silent network read does not identify which remote hop is blocked. Server-side attribution requires provider telemetry. Removal is a coordinated deletion of the helper diagnostic module/hooks, optional transport protocol/log event, inspector extraction and their diagnostic tests; timing and error-classification fixes remain.


## Tool contract

1. Each request fixes the native effective tool list as the only catalog. Canonical identity is namespace, local name and kind (`function`/`custom`); the request builds collision-free wire aliases with a reverse map. Dispatch never guesses by stripping namespaces or suffixes.
2. Supported schemas are preserved. Namespace flattening, JSON schema conversion, freeform wrappers and code-mode helper conversion are applied only when needed and preserve tool kind and meaning. Distinct identities are never merged, and unsupported tools are never silently dropped.
3. Exposed tools (`functions.exec`, nested shell/patch, MCP, `azrael_agents`) reach the native dispatcher exactly once, including helper-style calls. Command strings are never executed by the helper.
4. Encrypted schemas are never presented as plaintext. When a core tool cannot be provided, the request fails as unsupported before inference.
5. Streaming arguments are never executed. Completed calls are validated against registered tool, kind, schema and call ID before `ToolCallRuntime`/`ToolRouter`. Unknown names, ambiguous aliases, invalid JSON, duplicate IDs and conflicting completions end with an error and no execution.
6. Results are stored as native result items and returned with the same call ID. On replay, consecutive assistant text, reasoning with signatures and tool calls form one assistant message, split by user/system/agent messages and tool results; call/result order and IDs are preserved. Tool failures reach the model as error results; conversion and protocol failures fail the turn. Requests and tools are never retried automatically when execution state is uncertain.

Provider-hosted web search is not implemented and is excluded from the Devin tool catalog without changing OpenAI settings. Image input follows the per-model capability contract above: images reach the provider only for a verified image-capable selection, and a text-only selection rejects them explicitly rather than dropping them. Audio, structured output and foreign encrypted payloads fail explicitly. Context overflow fails clearly instead of dropping content, and native compaction is not available for Devin threads.

## Permissions and authentication

The only permission authority is the turn's effective approval policy, sandbox, exec policy and per-tool native constraints, shown in the existing permission UI. Full access, workspace-limited, read-only and approval combinations behave exactly as for native OpenAI turns. `never` means no approval prompt; it does not bypass the sandbox or explicit prohibitions. Denial, disconnected approval UI, cancellation and policy violations end natively; no new tool starts after cancellation, and executed file changes are never reported as reverted. Model transport networking is separate from shell network permissions; Full access is never forced.

Credentials come either from the Devin CLI (`%APPDATA%/devin/credentials.toml`, key and server) or from a managed Devin account in the provider account store. They travel in a separate initialization message over the private pipe, never in argv, rollouts or logs; authentication and transport override environment variables are removed from the helper. The CLI keeps login, refresh and logout. Account-change admission and active execution leases keep their native owners.

## Storage and resume

Native thread ID, rollout JSONL, SQLite index and native tool results are the conversation record; the helper keeps no conversation database or resume checkpoint. The provider receives explicit context built from native history with roles, order and call IDs preserved; tool results are never replaced by text summaries.

Devin reasoning signatures are kept in the native Reasoning item's `encrypted_content` as `azrael-devin-v1:` plus a base64 JSON envelope. The envelope is not encryption; it binds the opaque provider signature to model, thread and credential scope. Signatures from another model, thread or credential scope, or OpenAI opaque values, are never reused.

`CODEX_HOME/azrael/devin/sessions/<thread>.runtime.json` atomically binds runtime kind, exact model, canonical cwd and credential fingerprint (managed threads also pin their account ID). The fingerprint is a continuity check, not proof of authentication. After a key rotation, account change or cwd change the existing binding cannot resume; a new native thread is required. `fork_turns=none` children start as independent threads. Signed full-history forks are not supported. Provider changes within a thread follow the [managed-provider handoff](managed-providers.md#history-projection-and-provider-handoff).

After a process restart the native session can read earlier file-changing calls and results and continue; completed tools are never re-executed. A crash with an uncertain tool outcome is preserved as interrupted/unknown with a verifiable recovery path and no automatic execution. Disk write failures are never reported as saved.

## Host connection

New releases include native Devin by default. Host preparation recognizes the native release manifest, verifies helper files and the recorded Node runtime, and records the release in `out/azrael-runtime.json`. The host's `out/devin-native-host.cjs` configures only the host's scoped child environment: it clears ambient native selection, then sets the recorded helper and Node paths and a state-local temporary directory. A missing or changed native bundle fails preparation or start; it never falls back to ACP. Existing Azrael MCP configuration and OAuth storage are reused. A new host takes effect after the user reloads the window.

## Legacy ACP threads

Threads created with the earlier ACP path keep their runtime marker and are opened only through that path; they are never converted to native tool history, and ACP is never an automatic fallback. Continuing such a conversation natively means a new native thread with explicitly copied, transferable context; past ACP observation items never become executable calls.

In the ACP path the official Devin CLI runs its own tools. The adapter sets the exact model through session configuration and verifies readback before prompting, and maps text, tool progress, permissions, cancellation and errors to native events. Tool observations are correlated by session, turn and `toolCallId` and recorded as presentation-only DynamicToolCall items that never enter provider context or execute. Permission requests are correlated with bounded transient tool input; conflicting, stale, replayed or cross-session input cannot authorize execution. With Full access and approval policy `never`, the adapter selects the server's unique `allow_once` option after validating session, call identity and correlation, without command classification. Under interactive policies, literal PowerShell `execute` requests go through the native exec-policy evaluator (`Skip` grants once, `Forbidden` denies, `NeedsApproval` waits for the native approval UI); unsupported semantics are denied. Restricted permission profiles are unsupported because the Windows CLI has no OS sandbox. External session identifiers live in a provider-owned sidecar under `CODEX_HOME/azrael/devin`. Effective instructions, AGENTS content and skill references are forwarded as bounded text.

## Collaboration tool contract

Collaboration transport is an explicit tool contract, never inferred from Devin availability. Native `collaboration` tools keep their encrypted schemas. The Azrael host selects the separate plaintext `azrael_agents` contract with `AZRAEL_EX_PLAINTEXT_AGENTS=1`; an explicit `features.multi_agent_v2.tool_namespace` setting takes precedence. The selection is resolved into thread config and shared by tool registration, instructions and dispatch. Under this contract spawn role/model metadata is visible by default so configured roles can be selected; an explicit `hide_spawn_agent_metadata` still wins. Azrael's tools reuse the native lifecycle and queues but are direct-model-only and never advertised as encrypted native reserved functions. Message arguments keep their actual plaintext/encrypted provenance; an encrypted task cannot be relabeled as plaintext or silently dropped for a Devin recipient. Logs redact plaintext arguments. Provider availability never changes schemas or substitutes another model.

## Diagnostics

Engine records use the `devin_native_progress` tracing target and the existing engine sink; their events and log locations are described in [Devin native operations](../ops/devin-native.md#diagnostics). They correlate thread, turn and request IDs with the actual engine/helper/runtime paths and process IDs, phases, activity counters, allowlisted transport failure codes, numeric HTTP status and final outcome. Prompts, generated text, tool arguments, credentials, provider URLs, arbitrary exception messages and raw stderr are never included. Helper stdout is wire-only; debug output mixed into frames is a protocol failure. Progress telemetry supplies the bounded activity evidence defined above; writing or exporting diagnostic records grants no execution and does not change completion gating.

### Tool request diagnostics

Status: `current` for the engine source and captured tracing tests; installed releases require a rebuilt engine.

Before serializing a native Devin helper request, the engine records the ordered tool catalog's SHA-256, serialized size and tool count in the existing tracing sink. This catalog logging is connected to the Devin request entry point; managed OpenCodex requests share activity/recovery handling but do not emit these catalog/schema records. Bounded per-tool records identify the tool's kind, namespace/name, schema and description sizes/hashes, and observational schema-structure issues. Request ID and the existing thread/turn span connect these records to inference starts and provider failures. Unsafe identity labels and arbitrary schema property names are represented by hashes; descriptions, schema literals, arguments and credentials are excluded.

The structure checker inspects supported keyword shapes within depth, node and issue budgets. It does not establish full JSON Schema validity or provider acceptance and does not block or rewrite requests. Log and traversal limits report omissions rather than implying complete inspection. Hashes describe the engine's helper-input catalog; transport transformations and the provider's internal schema interpretation remain separate boundaries.

### Provider rejection evidence

Status: `current` for the helper/engine contract, focused usage classification/helper tests and synthetic SQLite persistence; installed windows require the matching updated bundle and reload.

Usage exhaustion uses the native OpenAI `UsageLimitReached` / `UsageLimitExceeded` error path and its existing UI. Classification requires an explicit usage code or a complete recognized exhaustion/reset message inside a denial response. For usage messages, `failed_precondition` is also a supported denial envelope; that code alone does not establish exhaustion. Message matching accepts an optional trace or cloud trace suffix, excludes quoted/negated mentions, and keeps request rate limits separate. Provider reset times are not inferred.

Provider failures preserve an optional `provider_error_source` (`http_response` or `connect_trailer`), the original allowlisted `provider_error_code`, a validated hexadecimal `provider_trace_id` of 16–64 characters, and a fixed `provider_reason` in `native_inference_helper_failed`. The transport derives these fields from the original denial before enriching a user-facing exception. Both helper and engine validate the fields before persistence; unknown codes become `unknown`, and malformed trace IDs are omitted. These fields do not change error classification, retries or the user-facing error.

Reasons represent complete recognized provider message templates: internal error, context limit, invalid thinking signature, missing tool result/use, usage limit, rate limit or invalid request. An absent message is `message_missing`; an unrecognized message is `unrecognized_message`. Arbitrary message text and response bodies are discarded because they can quote authenticated request content. A recognized reason describes what the provider reported; it is not independent proof of the underlying cause. A Connect trailer's status is mapped from its RPC code and is not the original HTTP response status. Evidence uses existing SQLite retention and is available only for failures recorded by this implementation; previous discarded messages cannot be recovered.
