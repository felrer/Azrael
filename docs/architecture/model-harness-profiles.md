# Model harness profiles

Status: `partial`. The approved first implementation adds configuration, request snapshots and native Claude-compatible tools. Compilation, native fixtures and provider payload checks are recorded in the [work plan](../../work/AF-01-model-harness-profiles/01-plan.md). Package installation, live Anthropic acceptance and Linux/macOS execution are separate gates.

## Ownership and selection

Prompt profiles own model behavior templates. Tool profiles own the model-visible tool environment; execution remains in the native Azrael runtime. Harness profiles compose a prompt and tool profile. Provider and model bindings select that composition without copying its definitions. The engine config loader resolves inheritance, captures template file contents and validates references before session admission.

Selection uses actual provider identity and the complete selected model slug. An Anthropic managed model inherits `anthropic-default`, including newly released or unknown model IDs. A Claude model served through OpenRouter or another provider inherits that provider's ordinary Azrael tools. Per-model settings override only specified fields; an explicit provider prompt binding is preserved for other fields. Bundled defaults do not overwrite user files.

`builtin/azrael-default` retains ordinary Azrael behavior and tools. `builtin/anthropic-default` provides adapted shared behavior, while `builtin/claude-lean` offers concise behavior. The Anthropic tool preset is `builtin/claude-code-core`. Prompt selection can change independently of this preset. Provider eligibility is a runtime invariant: Anthropic cannot select the native equivalent preset, and other providers cannot select the Claude preset.

The resolver produces one immutable request profile with its composition ID, prompt/tool IDs and a SHA-256 semantic fingerprint. The fingerprint includes loaded user template content, bundled rendered instructions and tool contract revision. The request's pinned model, registry, system instructions and input-budget projection use this configuration snapshot. A live model switch takes effect in the next captured request. Captured execution is not rebound.

## Configuration

Use `[harness]` in the existing base `config.toml`, project config layers or modern named `<profile>.config.toml` layers. Normal layer merging preserves unrelated entries. These names are independent of legacy `[profiles.*]` tables and the new `[harness.profiles.*]` composition definitions. Relative template paths resolve against their declaring configuration layer.

```toml
[harness]
schemaVersion = 1

[harness.prompt_profiles.team]
extends = "builtin/anthropic-default"
behavior_template_file = "harness/team.md"

[harness.profiles.anthropic-team]
prompt_profile = "team"
tool_profile = "builtin/claude-code-core"

[harness.providers.anthropic]
profile = "anthropic-team"

[harness.models."managed/anthropic/claude-opus-5-5"]
prompt_profile = "builtin/claude-lean"
```

The template replaces model behavior; immutable runtime identity, permissions, declared-tool guidance and explicit user/project instructions retain their independent meaning. Prompt inheritance is single-parent and sparse; a child's template replaces its parent's template. Invalid schemas, missing references, cycles, unavailable/empty templates or incompatible provider/tool selections fail explicitly. Template changes require configuration reload rather than changing a running snapshot.

## Tool and context isolation

The registry applies profile selection before discovery and code-mode planning. Anthropic receives direct function tools. Native equivalents are removed from executable registry entries as well as schemas, search results and nested definitions. Other providers exclude the compatible built-ins. Historical calls and discovered definitions cannot grant current execution authority. MCP/server namespaces remain distinct from reserved built-in names.

| Compatible tool | Native responsibility |
| --- | --- |
| Read | Sandbox-aware executor filesystem; numbered text and accepted read coverage |
| Edit / Write | Native patch approvals, sandbox, diff events and exact-content writes |
| Bash / TaskOutput / TaskStop | Unified execution, cancellation, output bounds and owned process IDs |
| Grep / Glob | Ripgrep through native execution and filesystem metadata access |
| Agent | Native V2 roles, child authority and terminal task wait or background handle |
| Skill | Current skill catalog and native loading/invocation records |
| ToolSearch | Current registry and authoritative native search-output history |
| AskUserQuestion | Native user-input delivery and actual answer wait where available |

The shared runtime contract keeps Azrael identity, permissions, user language, work preservation and evidence requirements. Provider-owned tool guidance names only the compatible surface. User/project instruction files remain preserved with their provenance. The helper performs transport conversion; it never executes tools or decides approvals.

Anthropic's compatible built-ins retain Claude-style wire names. External tools keep stable namespace-aware aliases. The compatible profile forwards native system/developer content without the extra Anthropic XML wrapper or an invented Claude Code app identity. API-native tool-use/result IDs, images and user content retain their representation. Other provider requests retain their existing projection.

## Execution contracts and limits

Read initially supports UTF-8 text/code, 1-based line ranges and bounded numbered output. Existing-file Edit/Write requires accepted coverage of the complete current file; multiple ranges can accumulate coverage. Rejected post-tool hooks do not authorize a write. Edit requires an exact unique old string unless `replace_all` is explicit. Writes preserve CRLF and final-newline state and recheck canonical target and expected preimage after approval. The executor filesystem does not provide atomic compare-and-write; a residual concurrent modification race remains between that recheck and the native write. Individual lines above the declared output bound cannot establish complete read coverage.

Bash uses actual Bash on Unix and installed Git Bash on Windows. Missing Bash fails with actionable setup information. Cwd and owned background jobs persist within a live session, while environment changes do not persist between calls. Session restart does not restore this shell state. Commands replacing the exit trap or using `exec` can prevent cwd capture. Job polling/stopping compares the originating call ID atomically so a reused process ID cannot control an unrelated job.

Grep/Glob retain explicit output and collection bounds; Glob scans at most 10,000 matches, orders scanned paths by modification time and returns up to 2,000. Native collection overflow is reported. Newline-containing file names are outside the current line-oriented search contract. Agent uses native roles and complete model identifiers; shorthand Claude model aliases are not supported. Native question UI limits remain explicit, including single-choice questions. Media Read, NotebookEdit, Cron, Worktree, Plan transitions and a profile settings UI remain follow-up scope.

## Persistence, replay and future extension

Captured profile IDs and fingerprints are durable request-context metadata. Old histories without metadata remain readable. Stored conversations are not rewritten by projection or used as a permission catalog. Private managed reasoning replay requires the matching profile fingerprint; a changed profile drops incompatible private replay while retaining visible history. Handoff, prewarm and compaction use the effective source/request model profile, and final budget estimates use the same helper projection as inference. Prefix baselines distinguish profile fingerprints as well as model/window identity.

Future custom model variants can reference an existing real provider/model plus a prompt or harness profile. Logical variant identity, real remote model identity and profile identity must stay separate; the real provider still controls tool eligibility. Variant catalog/UI, revision pinning and custom tool backends are not added by this first implementation. Built-in revisions and user overlays remain independently maintainable.

## Preservation

Feature ID: `engine.model-harness-profiles`. Owners are config/protocol, prompt rendering, core request/registry/runtime and managed provider projection. Required evidence covers resolver inheritance/isolation/errors, exact file writes and stale reads, Bash/search/process ownership, native discovery and question/agent behavior, provider wire aliases/replay, maintained prompt copies and existing managed context/provider regressions. Requested local targets are Windows x64, Linux x64 and Apple Silicon macOS; actual tested environments remain explicit in the work record.
