# Model harness profiles

Status: `partial`. Profile reconstruction is implemented in source; request projection and native verification evidence belongs to the [work plan](../../work/EM-01-anthropic-oauth-identity-removal/02-plan.md). Installed-host, live OAuth and non-Windows acceptance are separate gates.

## Ownership and selection

Prompt profiles own behavior composition and instruction representation. Tool profiles own the model-visible executable catalog. Harness profiles compose them; actual tools, approvals, sandbox enforcement and conversation persistence remain owned by the native Azrael runtime.

Actual Anthropic provider routes default to the `anthropic` harness profile, composing `builtin/anthropic` instructions and `builtin/azrael-default` tools. Other providers default to `azrael-default`. Direct Anthropic identity and managed/azrael-managed `managed/anthropic/<opaque-model>` routes select the same default, including future models. A Claude model name behind another provider does not select Anthropic behavior. Explicit global, transport-provider, actual-provider and exact-model bindings apply afterward in that order; sparse overrides replace only specified fields.

`builtin/azrael-default` and `builtin/anthropic` share the same runtime core and common behavior source. Anthropic chooses `anthropic-xml` instruction representation; Azrael chooses `native`. The optional `builtin/claude-lean` remains a concise behavior template using ordinary shared tools. Custom behavior replacement preserves runtime authority and user/project instruction provenance.

The retired `anthropic-default`, `builtin/anthropic-default` and `builtin/claude-code-core` identifiers have no compatibility alias. Configuration referencing them fails explicitly and must select the new profile. Bundled defaults do not overwrite user configuration files or stored conversations.

Common behavior separates neutral follow-up questions and new information from established errors or omissions: compare existing content before correcting it, and do not infer authorization for additional work from a needed correction. The bundled model-catalog template follows the same rule. This instruction contract does not establish live-model compliance.

## Configuration

Use `[harness]` in the existing configuration layers. Existing relative-template path anchoring, cycle detection, reserved-ID checks and fail-closed validation remain authoritative.

```toml
[harness]
schemaVersion = 1

[harness.providers.anthropic]
profile = "anthropic"

[harness.prompt_profiles.team]
extends = "builtin/anthropic"
behavior_template_file = "harness/team.md"
# Inherits anthropic-xml; an explicit override may choose native.
instruction_format = "anthropic-xml"

[harness.profiles.anthropic-team]
prompt_profile = "team"
tool_profile = "builtin/azrael-default"
```

Prompt inheritance is single-parent. `instruction_format` is optional and inherits independently of the behavior template; valid values are `native` and `anthropic-xml`. The resolved request snapshot and semantic fingerprint include this format and loaded behavior content. Changing only format changes the fingerprint, preventing incompatible private replay reuse. Configuration reload applies changes to later captured requests, never to an in-flight request.

## Tool and context isolation

All profiles use the Azrael common tool catalog, including `exec_command`, `apply_patch`, current MCP tools and native collaboration tools such as `spawn_agent` when enabled. Model capability, tool mode, source omissions, permissions, exposure/discovery and session-role rules remain authoritative. Prompt choice does not rename tools or grant unavailable capabilities.

Claude Code-style Read/Edit/Write/Bash/Agent/Skill/ToolSearch/AskUserQuestion/TaskOutput/TaskStop wrappers are not registered. Native names, schemas and execution semantics remain consistent across providers. Native root instructions and role guidance refer to the shared collaboration tools without Claude-specific substitutions.

The `legacy_codex_tools` namespace groups `create_goal`, `get_goal`, `update_goal`, `request_user_input` and `sleep` as search-only model tools. Their detailed definitions are excluded from the initial model catalog and nested Code Mode declarations; discovery retains their input schemas and existing execution permissions, goal lifecycle, question-mode restrictions and cancellation behavior. Namespace guidance is brief. `clock.curr_time`, asynchronous user questions and `update_plan` retain their own exposure policies. This common contract applies to local Windows x64, glibc Linux x64 and macOS ARM64; source verification and installed acceptance remain distinct.

The helper creates stable namespace-aware wire aliases for all tools and restores calls through the current request catalog. Unknown, ambiguous, undeclared or malformed calls cannot acquire execution authority. The Anthropic adapter handles `input_schema`, `tool_use`, `tool_result`, OAuth transport-name escaping, streaming and credentials; it does not choose a tool environment or a prompt profile. Tool definitions, history and choice names use the same transport mapping without profile-specific prefix removal.

## Instruction representation

The captured `instruction_format` controls request projection independently of provider-name and tool-profile checks. `native` preserves text without added XML sections. `anthropic-xml` adds common/runtime/user/task/result origin sections with CDATA escaping, without promoting user or tool content to system authority. Current managed projection collects native system/developer content into the top-level system prompt and preserves order among those instruction blocks. Inline system placement is outside this contract.

No OAuth Claude Code or Claude Agent SDK identity sentence is added. Native instructions, user/project provenance, current caching boundaries, images and call/result identities retain their existing meaning. Formatting changes only a request copy and contributes to its budget/fingerprint; stored history is not rewritten. The helper never executes tools or grants approvals.

## Execution contracts and limits

The native runtime owns filesystem access, edits, process control, MCP discovery, skills, questions and collaboration. Provider conversion does not emulate another application's user-visible tool contracts. Anthropic follows common direct/code-mode availability rules and common discovery policy. Source request fixtures do not establish live model proficiency, installed-host compatibility or lower context use.

## Persistence, replay and future extension

Captured profile IDs and fingerprints are durable request-context metadata. Old histories without metadata remain readable. Stored conversations are not rewritten by projection or used as a permission catalog. Private managed reasoning replay requires the matching profile fingerprint; a changed profile drops incompatible private replay while retaining visible history. Handoff, prewarm and compaction use the effective source/request model profile, and final budget estimates use the same helper projection as inference. Prefix baselines distinguish profile fingerprints as well as model/window identity.

Behavior refresh compares the rendered instruction content independently of model identity. Switching models with identical behavior on the same effective provider does not repeat the common instructions. For snapshotless initial instructions, the comparison normalizes CRLF to LF and removes only the exact leading harness runtime block plus its following newline from both inputs before checking whether the initial behavior starts with the current behavior. Raw and runtime-wrapped copies therefore match while explicit custom suffixes remain preserved; changed behavior and nonleading or custom prefixes retain their existing meaning. A provider change refreshes the behavior even when the profile and instruction content match, including full context reconstruction during provider handoff. Provider identity uses the existing handoff resolver, including individual API connections and the native provider fallback. Changed behavior still refreshes, including a profile change on the same model. The world-state snapshot records model identity, effective provider and the instruction hash even when no refresh is emitted; earlier snapshots without a known provider refresh once conservatively and advance to the current snapshot. Producer-typed model-switch instructions keep only their latest contribution in a prompt copy. Recorded history, untyped content, user/project instructions and actual tool authority remain intact. Source and native verification scope are recorded in the [context analysis and fix](../../work/BW-01-openai-profile-context-analysis/01-plan.md); installed acceptance is separate.

Future custom model variants can reference an existing real provider/model plus a prompt or harness profile. Logical variant identity, real remote model identity and profile identity must stay separate; the real provider still controls tool eligibility. Variant catalog/UI, revision pinning and custom tool backends are not added by this first implementation. Built-in revisions and user overlays remain independently maintainable.

## Preservation

Feature ID: `engine.model-harness-profiles`. Config selection/inheritance/error checks, shared prompt composition, request format/fingerprint, common executable tools, root role isolation, provider handoff, namespace alias/replay and instruction-source checks preserve this contract. Claude-specific wrapper checks are retired with the removed surface; shared native execution and discovery remain covered by their existing owners. Requested targets are Windows x64, Linux x64 and Apple Silicon macOS; actual executed environments and acceptance limits are recorded in the work plan.
