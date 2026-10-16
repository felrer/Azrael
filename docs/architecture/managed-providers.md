# Managed providers and provider switching

Status: `partial`. Managed inference, catalog/picker, reasoning selectors and provider handoff are implemented and verified with deterministic engine fixtures; live inference is verified only for the models named in [provider account operations](../ops/provider-accounts.md). Live visual picker behavior is user-verified. Per-provider reasoning rules below marked *target* apply to providers added later.

## Managed inference

사용자가 직접 등록하는 Chat Completions·Responses 연결과 `API` 모델 그룹의 별도 계약은 [사용자 API 모델](custom-api-models.md)이 소유한다. 해당 연결은 기존 managed OAuth 계정과 독립적인 identity를 사용한다.

Google AI Studio (`google`), xAI public API (`xai`), OpenRouter (`openrouter`), Google Antigravity (`google-antigravity`) and Anthropic subscription OAuth use the isolated opencodex account store and vendored provider adapters. Model keys are `managed/<provider>/<remote-model-id>`; the suffix stays opaque, including OpenRouter slashes. Authentication management stays in the account helper. A private Bun inference helper performs transport and representation conversion only; Codex remains the sole tool executor, permission authority and conversation writer. No management HTTP server exists.

The native request stream boundary supplies the effective model, instructions, ResponseItem history and ToolSpec catalog. The bounded native helper protocol shared with [Devin](devin.md#native-inference) is reused: versioned init/request frames, ordered output frames, exact request IDs, complete validated tool calls and one terminal result. Its [inference activity and bounded recovery](devin.md#inference-activity-and-bounded-recovery) contract also owns inactivity handling for managed streams. Anthropic native input frames have a 16 MiB combined init/request budget, including JSONL delimiters; other providers retain 8 MiB. The same provider limit applies during request serialization, initial helper delivery and retries. Output frame and aggregate-output bounds are separate. This is a transport byte budget, independent of token-based automatic compaction. Credentials travel only in private pipes or are resolved inside the helper, never in argv, model catalogs, rollouts or diagnostics. Release hashes cover the helper and its reachable vendored dependencies; a missing or modified configured helper fails closed. Runtime availability, account registration and successful inference are distinct states.

Google Antigravity is a separate provider from Google AI Studio. It uses the connected OAuth account, and the vendored Cloud Code Assist adapter owns request construction and stream parsing. Each thread pins the selected OAuth account and endpoint identity; token refresh uses the account-scoped refresh path without changing global selection, normal token rotation keeps the binding, and a missing or revoked pinned account fails explicitly. Image-output models are excluded from its catalog.

## Meta Muse inference

Status: `partial` — the shared source route uses synthetic account and Responses fixtures; live Meta authentication/inference, release packaging and installed-host acceptance remain separate.

`meta-muse` connects the existing Muse Code device login and manual credential fallback to `managed/meta-muse/<model-id>`. Authentication stores the static Model API key in the isolated provider store. The key's digest binds each thread and turn; changing the selected account affects new bindings, while key replacement, revocation and removal invalidate the affected binding. Requests accept only the canonical `https://api.meta.ai/v1` Responses OAuth transport and its registry-owned API-version header. The account's separate OAuth token is not an inference bearer.

The vendored text-output Muse Spark roster is extended by Azrael's `managedMetaRegistry` with `muse-wonder-1.0`. Discovery and pinned inference share this metadata: Wonder has a 1,048,576-token context window, text/image input and `minimal`, `low`, `medium`, `high`, `xhigh`, `max` reasoning efforts sent without aliasing. The existing default and Spark metadata remain unchanged. Model discovery uses this roster without minting credentials or sending a model turn. Muse Wonder Full is Muse Code subscription-only and is not a Model API selection; Wonder Contributor is not exposed. Audio/video/PDF inputs and image-output models are outside this Azrael route. Additional models require updating the owning metadata and validating their transport contract. See Meta's [models](https://dev.meta.ai/docs/models) and [reasoning](https://dev.meta.ai/docs/reasoning) contracts.

The vendored Responses builder owns endpoint and parameter normalization. Azrael lowers function, custom-string, namespace and client tool-search definitions to its existing request-scoped function aliases, each within Meta's 64-character name limit. Responses streams preserve text and reasoning progress; tool calls are buffered and validated against the completed response before native execution. Parallel calls, complete JSON arguments, declared tool identity, cancellation, incomplete responses and missing terminals retain the shared mapper's failure guarantees. Hosted provider tools are outside this client-tool route.

Native encrypted reasoning items are kept in scoped private envelopes and replayed only through matching provider/model/thread/account/turn/harness and exact tool-call identity/argument validation. The Azrael envelope is never sent as provider ciphertext. Responses requests are stateless with `store:false`; history, tool execution and permissions remain Azrael-owned. This route uses Model API rather than running Meta's independent Muse Code harness. The existing device grant is experimental, and login displays the unverified subscription/billing scope before starting it. Preservation feature: `engine.meta-provider` in the [feature inventory](../../scripts/azrael-feature-contracts.json).

## Tool search history projection

Status: `partial` — source projection is verified with Windows mapper and provider
wire fixtures; installed behavior requires a matching helper release.

Managed and Devin helpers project search history on the request copy. Definitions
already provided by the current wire catalog become callable aliases. For other
identities, including Code Mode helpers, the latest completed search retains its
full schema and earlier occurrences refer to that result. Namespace and tool kind
remain distinct. Failed and empty results, call IDs and ordering are preserved.
History never adds a callable tool or bypasses native permissions; nested calls
follow current Code Mode instructions. Stored conversations remain unchanged.

The resolved Claude-compatible profile projects typed search results to current
catalog references, with no repeated schemas or namespace descriptions. Reference
names match the adapter's final OAuth tool names; ordinary tool-result text is
preserved. Its discovered catalog follows the [profile discovery contract](model-harness-profiles.md#mcp-discovery).
User API requests retain their stricter current-catalog-only projection and bounded
discovered catalog. OpenAI retains native `tool_search_output` semantics. See the
[Devin tool contract](devin.md#tool-contract).

Managed and user API mapper responses accept exact current wire aliases, original names and `namespace.name`. All candidate forms resolve through a request-local index; multiple identities fail with `ambiguous_tool_name`, including collisions between different name forms. No case, whitespace, prefix or partial-match repair occurs. Historical definitions and other providers' catalogs cannot grant a callable tool. Model-facing external aliases remain SHA-256-based names; the Anthropic compatible profile keeps Claude-style built-in wire names. Native executable items retain the original name and namespace. The [profile contract](model-harness-profiles.md) owns this exception. Private replay records store the resolved wire name and the digest of the actual validated arguments.

Private `reasoning_details` replay is verified only for nonempty arrays. Empty arrays carry no replay payload and do not require unrelated recorded calls to exist in public history. Nonempty records retain per-envelope call metadata and validate call presence, resolved tool identity and argument digest; failures distinguish `reasoning_scope_mismatch_call_missing`, `reasoning_scope_mismatch_tool_name` and `reasoning_scope_mismatch_arguments`. Direct envelope origin mismatches use `reasoning_scope_mismatch_origin`; ordinary request projection continues to exclude foreign private state. Existing public history is never rewritten and argument mismatches are never repaired by changing saved digests.

## Anthropic tool input streaming

Status: `partial` — implemented in source; installation requires a matching helper release.

Managed Anthropic requests enable `eager_input_streaming: true` on user-defined tools at the owned request projection boundary after the vendored adapter builds the request. This includes namespaced functions, client tool search and custom tools represented as an `input` JSON string. OAuth headers, wire aliases and input schemas remain adapter-owned. Other provider requests retain their existing projection.

The option avoids server buffering of a large parameter until its generation completes. Fragments remain incomplete input: the adapter and mapper must assemble and validate the full JSON/object/custom wrapper, and the engine must accept a valid terminal response before native tool execution. Invalid JSON, truncated parameters, missing termination, cancellation and size limits remain failures. The 100-second generation inactivity limit, one bounded retry and absolute deadline remain unchanged; pings do not count as generated tool input. See [Anthropic fine-grained tool streaming](https://platform.claude.com/docs/en/agents-and-tools/tool-use/fine-grained-tool-streaming).

At a completed Anthropic tool block, zero bytes of streamed arguments preserve the explicit initial `input` object, including `{}` for a call with no arguments. Nonempty fragments are authoritative; missing initial input and partial or whitespace-only JSON are rejected. The mapper rejects an empty object for a function or client search with declared required fields, and custom tools retain their required `input` wrapper. JSON parsing failures use `tool_arguments_invalid_json`; empty arguments missing required fields use `tool_arguments_missing_required`. These validation failures never emit an executable call or a completed response, and generic fallback classification must not replace their codes with `provider_failure`. EOF and cancellation do not repair an unfinished block.

## Tool invocation diagnostics

Status: `partial` — focused Windows helper, adapter and native protocol tests cover the source implementation. Installed use requires a matching engine/helper release.

Managed helper progress optionally carries `tool_diagnostics`. It records a stable wire-alias catalog digest, current/history alias counts, bounded hashes of raw and parsed tool names, their match classification, argument byte/delta counts, call age and time since non-empty arguments. Anthropic raw SSE argument counters are separate from mapper counters so the evidence can distinguish missing provider input from adapter/mapping loss. Buffered call evidence is bounded to 64 entries; oversized names are classified without hashing. Mapping outcomes distinguish undeclared names, duplicate IDs, invalid JSON/object/custom wrappers and disabled parallel calls. Raw names, call IDs, arguments and request content are excluded.

The native runtime validates the optional object's fixed fields, enums, SHA-256 strings and safe integer counts, then records `native_inference_tool_diagnostics` in the existing SQLite tracing sink. Legacy progress without the object remains accepted. These records do not count as generated output, extend tool-argument waiting, retry requests or change tool execution. See [Native diagnostics](../ops/native-diagnostics.md) for safe export and interpretation.

## Connection failure evidence and guidance

Status: `partial` — helper and host source tests cover the classification and safe messages; native protocol acceptance requires a matching engine build. Installed windows require an updated release.

Managed inference inspects at most four objects in a cycle-safe exception cause chain and accepts only enumerated transport codes. DNS, TLS, connection reset/refusal, connection timeout, unreachable network and proxy failures become `provider_connection_<category>`. The transport snapshot carries only `connection_error` and `connection_error_code`; arbitrary exception messages, stacks, addresses and unknown codes are discarded. A header-stage `TypeError` without an accepted cause becomes `provider_headers_failed`, which identifies the observed stage without asserting a network cause or whether the server received the request. Confirmed HTTP/provider errors and local deadline outcomes remain authoritative.

The engine and native chat host explain the recognized cause, or explicitly state that the cause is unknown, and advise reviewing existing work before requesting continuation in the same session. These outcomes remain terminal and do not enable automatic retries, account switching or tool replay. Diagnostic lookup procedures are in [Native diagnostics](../ops/native-diagnostics.md).

## Provider instruction adjustments

### Common agent behavior and multi-agent runtime

Status: `partial` — common source behavior is verified by focused Windows engine and provider-request tests; installed-host acceptance requires a matching engine.

Azrael owns the shared behavior in `instructions/instructions/agent-behavior.md`, embedded
in the engine prompt library. Ordinary profiles use that behavior; Anthropic profiles adapt or replace model behavior while preserving the independent runtime core, user-language progress and final responses. The [model harness profile contract](model-harness-profiles.md) owns provider/model prompt and tool selection. Remote catalog
templates and policy messages do not replace the common behavior. Permissions, approval
guidance, collaboration modes, multi-agent roles and modes, persistence, recovery and
Guardian policy use the common bundled messages and runtime configuration. Model catalog
technical tool descriptions and parameter schemas remain available; capability selection,
reasoning, tool representation and provider wire requirements stay at their existing boundaries.

Request composition refreshes saved model-owned behavior without rewriting conversation
history. Explicit custom instructions are preserved as additions to common behavior.
Incremental context refreshes changed behavior in an existing context window. Agent-enabled
threads select V2 for every provider, including resumed and forked V1 threads; explicit
`agents.enabled=false` disables agents. Provider/model catalog values and legacy feature
flags do not select a different multi-agent version. Internal review and Guardian reviewer
sessions explicitly disable agents so they cannot start nested multi-agent work.

### Anthropic XML prompt format

Status: `partial` — request formatting is verified with Windows mapping and Anthropic HTTP mocks; installed-host acceptance requires a matching helper bundle.

Legacy/unprofiled requests routed to the Anthropic adapter label text with XML sections following
the [Anthropic prompt guidance](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices#structure-prompts-with-xml-tags).
The common behavior remains provider-independent. `<common_instructions>` contains the
base instructions and `<runtime_instructions>` contains runtime system/developer guidance.
The latest user message is `<current_task>` and earlier user messages are `<user_input>`;
inter-agent messages use `<agent_message>`. This classification labels message origin and
recency, without extracting or rewriting the task from the user's text.

Text inside tool results uses `<tool_result>`. The Anthropic API's `tool_use`/`tool_result`
blocks and call IDs still bind calls to their results. Images remain native content blocks;
each accompanying text part is labeled separately in its existing order. Assistant output
and private thinking replay keep their existing representation. XML never promotes user or
tool content to system authority, and does not itself establish a security boundary.

Section contents use CDATA, splitting embedded `]]>` terminators to preserve the original
text. Formatting happens on the request copy before the existing size validation. The actual
configured adapter selects this format; model names do not select it. Other adapters retain
their existing format, including Claude models served through a different provider protocol.
The adapter-owned OAuth system prefix remains outside these sections. Compatible profile conversion preserves that existing prefix and appends Azrael native system/developer blocks in their original order, without the vendor's escaped-tool catalog reminders or application-identity rewrites. It retains the adapter's final explicit system cache boundary on the final native block, together with automatic, tool and message caching. Exact compatible built-in names and escaped external names remain owned by the profile projection; headers and authentication are unchanged. Live OAuth acceptance remains separate from installed-host acceptance. Conversation files
and the maintained common behavior source are unchanged by request formatting.

### Harness identity

Status: `partial` — common prompt and request-copy contracts are verified by focused Windows engine tests; installed windows require a matching engine.

The common native request boundary identifies the workspace application and agent harness as Azrael: `You are working in Azrael, the application and agent harness for this workspace.` The common behavior source uses this introduction. Request composition refreshes saved model-owned instructions and preserves custom instructions as additions, so resumed sessions receive the Azrael description without rewriting their stored conversation. Actual model/provider identities, authentication identifiers and tool/API names remain separate from harness branding. Provider helpers forward the resulting instructions rather than inventing their own application identity.

### Provider reminders

Status: `current` for source and offline adapter request verification; installed-host behavior requires a matching helper bundle.

The Google adapter adds a short reminder to keep intermediate progress concise, with the final answer length governed by the task. This reminder does not prescribe internal reasoning or task persistence. The adapter leaves mathematical notation to the session instructions and client renderer. The pinned UI contains a remarkMath/KaTeX rendering path; support for every delimiter is not established by source inspection.

Provider tool reminders identify the current wire tool catalog and distinguish top-level calls from nested Code Mode helpers. Patch guidance states the required input markers directly. Tool execution, permissions and approvals remain owned by the native runtime.

## Usage exhaustion

Status: `current` for focused HTTP/SSE classifier tests and Antigravity/Anthropic inference mocks; installed windows require an updated helper bundle and reload.

The shared managed transport classifies HTTP and streamed exhaustion for Google AI Studio, Google Antigravity, xAI, OpenRouter and Anthropic into the native `provider_usage_limit` → `UsageLimitReached` / `UsageLimitExceeded` path. The active allowlist in `inference-config.ts` admits Antigravity and Anthropic; classification support does not activate other providers. Explicit quota codes and complete recognized exhaustion statements qualify. Generic resource-exhaustion text, HTTP 402/429 and Retry-After alone do not establish exhausted usage or its cause. OpenRouter's explicit in-flight-budget metadata identifies concurrency admission. Anthropic's rejected five-hour/seven-day window headers and documented `enforced_spend_limit_reached` detail identify their usage boundary. Reset times are recorded only from validated headers, never inferred. Error bodies remain bounded and reduced to fixed protocol codes; raw messages and credentials do not cross the helper boundary.

## Evidence-based error classification

Status: `partial` — shared source implementation; Windows fixture and live-request evidence, packaging and platform limits are recorded in [the work record](../../work/BU-01-thread-01a144c2-error-analysis/02-plan.md). Preservation feature: `engine.error-classification`.

Model and conversation errors assert only an established category. Existing structured categories and exact recognized messages retain their meaning; unrecognized errors display exactly `정의되지 않은 오류`. Arbitrary message keywords, quoted or negated mentions, generic statuses and unknown codes cannot borrow the meaning of a known error. Native `Unclassified` retains internal detail for debugging while its display and prefixed error events use the fixed unknown message. This does not change interruption, retry, account-switch admission or tool execution policy.

For rate errors, recognized complete statements distinguish request count, input/output/combined token throughput, concurrency and acceleration. General known rate evidence remains general. HTTP 429 alone is undefined. Anthropic's `rate_limit_error` can also describe spend limits, so that type alone does not establish request throttling. Recognized usage codes, subscription rejection headers and structured spend-cap detail take precedence over ambiguous rate labels. Unknown new response types remain undefined until a supported rule is established.

Anthropic's [error reference](https://platform.claude.com/docs/en/api/errors) and [rate-limit reference](https://platform.claude.com/docs/en/api/rate-limits) are the primary references for the supported rate/spend distinction and numeric limit headers. Record actual response evidence before assigning a subtype.

A structured Anthropic `stop_reason: refusal` is a terminal `provider_refusal`, distinct from output truncation and unknown incomplete reasons. The managed SSE observer preserves this decision before adapter normalization, even when optional diagnostics are off. A real terminal frame remains required; missing termination still fails as EOF. Refused output cannot release buffered native tool calls. Native handling uses terminal Fatal/Other with the exact message `Fatal error: 모델 제공자가 응답을 거부했습니다. (provider_refusal)`; the UI removes that fixed prefix only for this exact message/category pair. Refusal does not authorize automatic retry, account switching or tool execution. Closed `provider_stop_reason` and `provider_refusal_category` labels retain the provider's decision without interpreting its explanation; explicit null, missing and unsupported categories remain distinguishable. This handling improves evidence and error identity; it does not suppress provider refusals.

The helper reuses the existing transport progress channel and SQLite sink. It exports only closed provider-type/reason/body-inspection labels, a bounded numeric Retry-After, validated rate limit/remaining/reset fields and subscription-window status/reset fields. The native transport validator and read-only exporter enforce the same field boundaries. Raw response text, credentials and account identifiers are excluded. Optional diagnostics do not change classification or recovery. The common policy applies to Windows x64, Linux x64 and macOS ARM64; installed releases need matching engine/helper/UI inputs.

## Claude Code Mode tools

Status: `current` for the model policy. Anthropic managed models enable `node_repl` in model execution metadata for catalog entries, retained models and model-metadata fallback. Other providers keep their existing policy. Native tool execution, permissions and approval remain authoritative; enabling the model flag does not establish availability or acceptance by the connected Code Mode service. Live Claude Code Mode execution requires separate verification.

## Catalog and picker

Context capacity, provider-specific automatic compaction and pricing tiers follow the [provider context policy](context-policy.md). Catalog capacity is distinct from safe input and compaction thresholds.

The model picker groups selectable models by inference provider (OpenAI, Devin, OpenRouter and other connected providers) in expandable sections with counts. One search matches display names and opaque model IDs across sections. Identical display names in different providers stay distinguishable. Provider-grouped lists omit the Default/recommended item. The existing default/current selection, keyboard navigation and Devin variant/effort contracts remain authoritative. All `model/list` pages are consumed before a catalog is treated as complete.

Each host reuses its complete in-memory catalog when menus reopen or queries refetch. A successful new session triggers one refresh, concurrent requests are shared, and a session created during discovery schedules its refresh after that discovery completes; manual refresh remains available. Initial loading without a cache still discovers. A failed refresh keeps the last complete catalog and shows the existing error/retry state.

Managed discovery uses the existing provider discovery and parsing facilities and exposes compatible text/tool models without manual model-ID entries. Discovery never performs inference and credentials stay in the helper. A bounded, identity-scoped last-good cache may serve during transient failure and is labelled stale; removal or credential/endpoint changes cannot resurrect another identity's catalog. Loading, empty results and refresh failure have visible states and a retry action. An account's chat badge describes runtime support, not catalog completeness or successful inference.

Catalog membership is checked at selection admission, not again between tool results and continuation within an admitted turn; helper account/model/credential checks remain active. A successful empty catalog removes entries for future selection.

Anthropic's catalog uses the Claude Models API with the account-scoped token and client headers used for inference. Only an explicit refresh requests the remote roster; the pinned UI triggers one after a successful `thread/start`, while ordinary reads and continuations use the account-scoped last-good cache. Refresh consumes bounded pages and keeps the previous roster on failure. A successful response replaces the visible roster, including removals; the native catalog privately retains metadata for removed models so active and resumed threads keep their model, while the picker hides them. The provider may still reject a model that is no longer callable.

**Image input capability.** A managed catalog entry may declare input modalities; an entry that omits them is text-only. Only `["text"]` and `["text","image"]` are accepted, and any other value fails the catalog closed rather than degrading to a guess. For Anthropic the declaration comes from the Models API `capabilities.image_input.supported` flag, so image input is advertised only where the provider confirms it. No modality is inferred from a model name, family or suffix, and a model whose capability is absent or unverified stays text-only.

### Native endpoint catalog isolation

Status: `target` for the Codex 0.160.0 integration candidate; managed and Devin catalog behavior above remains applicable.

A native provider with an explicit `model_catalog_url` owns its model roster. Its manager starts without bundled model entries, resolves metadata by the exact catalog ID, and never merges bundled models into that roster. A successful empty response is authoritative. A failed refresh invalidates the same-identity native roster, ETag and persistent cache for future selections; an invalidated cache cannot become fresh through a provider-specific TTL. Responses from an earlier authentication or request identity are discarded. Explicit refreshes are serialized without retaining an ETag guard while entering the refresh lock.

The manager composition is native, then Devin, then managed. The endpoint policy belongs to the native manager; each outer manager retains its own discovery, identity and failure rules. Authentication-change refresh calls reach the native implementation through both wrappers. Static `model_catalog_json` retains its construction priority, and ordinary OpenAI discovery keeps its existing policy. Empty-selection rejection applies to the final chosen model after default selection, so an empty native roster does not reject a valid managed or Devin model.

The last-complete UI retention rule above covers managed discovery failures. Explicit native endpoint failures expose the invalidated native roster, while other provider sections keep their own catalog state. Catalog updates govern future selection admission; existing managed continuation and private retained-model metadata follow the continuity contract below.

## Reasoning controls

Each provider exposes one logical picker row per base model and uses the existing Codex reasoning slider for that model's verified selectable stages. The catalog carries stage/default metadata to the native model manager, and the selected stage reaches the provider as its supported wire effort or as an exact variant model ID. Refreshes may change choices for new selections, but an admitted thread/turn keeps its model, stage, upstream mapping and account. The picker preserves a supported current selection or valid declared default; otherwise it selects the first supported stage in catalog order. Missing or invalid metadata never invents Medium or another stage. Models without selectable stages have no reasoning slider and selection clears the previous model's effort. Labels for absent or unrecognized efforts remain safe to render.

- **OpenRouter:** valid API stages take precedence over verified exact model/family fallback rules. GLM 5.3, GLM 5.3 Flash and their batch variants use Low / High / Max, default Max, with mandatory reasoning (no disable choice). Explicit empty or invalid metadata does not manufacture support; gateway null stages expand to their supported values. The native host keeps an absent default as the internal `automatic` marker; the picker selects the first supported stage when available and the helper omits effort when no stage is selected, so the marker never reaches OpenRouter. Only declared choices are sent as exact `reasoning.effort` values, including `max`; mandatory reasoning forbids `none`. Discovery snapshots use schema 2. No token-budget, reasoning-visibility or pro-mode UI exists.
- **Anthropic:** `capabilities.effort` from each Models API entry is the authoritative set of supported Low / Medium / High / X-High / Max stages when the adapter recognizes the model's effort wire; an unknown family is not exposed solely because the API lists stages. Without capabilities, only exact ladders implemented by the adapter apply. Older models whose effort capability is false may use an exact adapter-backed thinking-budget mapping; adaptive models with explicit unsupported effort get no fallback ladder. Claude Opus 5.5 and Haiku 5.5 default to Medium; Sonnet 5.5 defaults to High. Sonnet 5.5 and Haiku 5.5 have exact fallback ladders of Low / Medium / High / X-High / Max and use adaptive thinking with `output_config.effort`, following the [Anthropic effort contract](https://platform.claude.com/docs/en/build-with-claude/effort). Cached metadata includes the stage list, and a removed model keeps its last metadata for existing threads.
- **Google Antigravity:** the adapter's exact per-model effort ladders apply. Gemini models keep the effort-to-wire-model mapping, and Claude models under this provider keep their thinking-level mapping. A model with no declared ladder has no slider; an unspecified default selects the first supported stage when available.
- **Target for new providers:** prefer per-model stages returned by the provider, otherwise use only an exact model/variant mapping supported by the adapter. When upstream exposes separate IDs per stage, group them only after verifying they share the base model and non-reasoning capabilities, and keep a stage-to-upstream-ID table instead of deriving IDs from suffixes. Each addition verifies catalog, picker/default, wire mapping, refresh/removal and resumed-thread behavior. Existing Devin variants follow their own [grouping rules](devin.md#catalog-and-model-selection).

## Turn selection and continuity

One native conversation can move between managed providers and the native OpenAI and Devin paths. Selection applies at the next turn boundary; an active inference, its tool calls and results, approval wait and retries keep their turn's provider, model and account. A failed selection leaves the prior selection usable. The UI distinguishes the next-turn model from the running turn's model. Legacy Devin ACP conversations keep their runtime boundary.

Each inference turn has a non-secret binding of provider, model, account identity and endpoint/credential continuity identity, written atomically before inference. A conversation keeps its account per provider, so A→B→A returns to the same account rather than the current global selection. Missing or replaced credentials fail explicitly, and no key-pool rotation or automatic provider fallback overrides the pinned choice. The explicit opt-in [automatic quota recovery](accounts.md#automatic-account-switching) contract may atomically rebind a confirmed exhausted account within the same provider between requests, with account-scoped private replay excluded. Native turn metadata owns model history; the auxiliary binding holds no duplicate conversation. Resume and fork preserve binding lineage and next-turn selection. Existing markers remain readable; preserving data does not imply ACP compatibility.

## Conversation branching

Status: `partial` — source fixtures verify fork selection, setup and native UI eligibility; engine-backed and packaged/live-host acceptance is pending.

Branching from a completed response creates an independent native thread through that canonical turn, including its public messages and tool call/result identities. The source may have an active later turn; branching does not interrupt it or change its history. An in-progress response is not itself a branch point. Read-only and unsupported-host restrictions remain in effect.

The child inherits the source's next-turn model and provider, rather than the global default or the model of the last retained turn. Supported reasoning effort is carried with that selection; unsupported effort is cleared to the model's default. The user can change providers through the ordinary picker after branching. Only provider account pins belonging to retained history are inherited through the native fork lineage; a provider newly selected for the child follows ordinary account selection. Missing or replaced pinned credentials fail explicitly without account rotation or provider fallback.

Fork and subsequent setup share the selected model. Inherited goal continuation is deferred so the child starts its new work after the user sends a turn, with complete collaboration settings carrying the chosen model and nullable effort. A setup failure after thread creation retains the accepted child ID and reports the failure without automatically creating another fork. The child keeps the existing cwd and permission inheritance; conversation branching does not isolate shared files or create a Git branch or worktree.

## History projection and provider handoff

Native rollout history is authoritative and is never rewritten. Request projection preserves public messages and exact tool call/result identities while filtering provider-private replay material by its originating provider, model, account and replay validity. Foreign encrypted reasoning is never sent as if it belonged to the target, and returning to a provider does not by itself revalidate old opaque state. Unsupported history or inputs fail explicitly instead of losing content. The target context budget and native compaction behavior are checked without silently truncating history.

History carries text and image items. Images are not stripped before inference; the native per-model modality projection decides whether a given target accepts them, so a text-only target rejects image history explicitly instead of silently discarding it. Audio and image-generation items are still rejected outright. Capability metadata stays conservative for any modality or replay contract that is not yet verified.

A provider change runs a handoff at the next turn boundary, before target inference or target compaction, when earlier model output or an opaque compaction checkpoint must be carried over. The original provider/model produces a bounded plain-text summary with no tools. Managed sources use their per-thread account binding; native sources use the currently selected native account, because historical native account identity is not stored in rollout context. The handoff never switches accounts. Only a completed, nonempty summary becomes a native plaintext compaction checkpoint appended to history. A fresh thread, a same-provider model change, or a failed first request with only public input needs no summary. The producer of an existing opaque checkpoint is recovered from native rollout provenance (through the local rollout parser, which also reads paginated threads); the last attempted model may only be a failed switch and is not assumed to be the producer.

The summary request is incremental and input-bounded. The latest checkpoint in live history (an opaque compaction item or a plaintext summary) is the baseline; only the uncompacted tail after it is sent, newest items first, within a fixed byte budget. Tail items that do not fit are projected through the public filter (bounded user-visible text) so earlier context still informs the summary. Without a prior checkpoint, the first real user message is kept as the original objective. A prior plaintext checkpoint is carried ahead of the new segment summary without being re-summarized; an opaque checkpoint cannot be carried and is represented by the new summary. If the returned summary exceeds the byte cap, the handoff retries once with the public-only scope, then truncates at a line boundary with an explicit marker instead of failing.

If the source provider rejects the summary for exhausted usage or quota, the handoff instead persists normalized public messages and supported exact tool call/result pairs through the native checkpoint mechanism, excluding every source reasoning item (including its signature), opaque compaction and encrypted tool arguments. A visible warning names the exhausted source and destination provider and explains that the saved public conversation is being used. This applies to resumed and forked threads as well as a provider change in the original thread. The target can summarize this public context through its normal compaction path without another source-provider request. Usage exhaustion requires an explicitly classified quota error; a generic HTTP 400/429, rate limit, authentication or connection failure does not trigger this fallback. Tools are never replayed, source accounts never switched, and encrypted source state never sent to the target. Cancellation and unrelated errors leave history intact and do not authorize dropping context. Summary calls use a separate request/turn identity so they cannot overwrite the target inference binding. Handoff state lives in ordinary native history; there is no second conversation store.
