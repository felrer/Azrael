# Conversation History UI

<!-- architecture: {"id":"arch.conversation-history.ui","feature":"conversation-history","layers":["ui","host"]} -->

## Identity and session links

Backend HTTP protocol identifiers keep their upstream names, including `OAI-*` and `x-openai-*`. The `OAI-App-Brand` value remains `codex`; it must not be derived from the display brand.

The host and conversation UI identify the distribution as Azrael. Theme names, embedded VS Code command titles and the Devin model-picker notification also use Azrael. Actual service usage and model names retain their service identity. Local conversation links use `azrael://threads/<UUID>` and the host's VS Code handler receives the translated `/local/<UUID>` route. Original Codex thread links require explicit migration with an existing Azrael session check. Routing and storage ownership are defined by [local session links](../../system/host.md#local-session-links). The session-link injector is registered in the preservation manifest, and prepared assets must report `sessionLinkEdits` before package verification succeeds.

## Conversation and file interactions

The [recent-chat list](README.md#recent-chat-list), [new conversation history and immediate stop](README.md#new-conversation-history-and-immediate-stop) and [conversation branching](../conversation-branching/README.md#conversation-branching) own native request and session semantics. UI filters preserve the native merged ordering, selected chat type/environment and pagination. File-open actions, missing image state and local-file drops follow [chat content handling](../conversation-content/README.md#chat-content-handling); their menu and attachment controls use native components.

## Recent-chat header initialization

The menu mounts at most 50 matching rows initially and automatically adds rows in batches of 50, allowing a browser paint opportunity between batches. This presentation budget does not truncate the fetched metadata or change native sorting and filtering. Reopening or changing the type, environment, search text or search loading state restarts the presentation budget. Exhaustive search still reveals no matches before complete metadata success; ready results then mount in batches. Navigation keys outside editable fields synchronously reveal all rows before native keyboard handling, and scrolling near the current bottom immediately adds the next batch. Keep native row components, focus behavior and actions; CSS containment is not used.

Recent-chat filtering subscribes to the history menu's persisted type and environment atoms through the pinned atom and environment query hooks. Initialize the atom owner when this hook first renders and reuse the upstream task merge hook. Preserve the header's existing local bindings so injected variables cannot shadow hooks already called in the same render. Authenticated header and persisted conversation rendering use the same packaged module graph.

The history menu receives the trigger's existing recent-history query feed; its search hook does not mount another registry/query subscription. The trigger's compiler cache forwards a changed exhaustive-refresh callback even when the cached row array is unchanged, so a host or workspace change cannot retain the old search owner. The menu uses the native loading and retry components while an exhaustive local search is pending or failed, and reveals matching rows only after the complete metadata snapshot is ready. Typing within an active search reuses that snapshot. Clearing or unmounting the menu prevents a late response from replacing its current view. Ordinary progressive loading and search scope are owned by the [recent-chat list](README.md#recent-chat-list); both paths retain native merge ordering, environment/type filters, flag controls, row navigation and keyboard behavior. Progressive/search presentation acceptance is tracked in the [work record](../../../../work/DG-01-chat-history-performance/01-plan.md).
