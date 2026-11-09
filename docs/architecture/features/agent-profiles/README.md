# Agent Profiles contract

<!-- architecture: {"id":"arch.agent-profiles.contract","feature":"agent-profiles","layers":["ui","host","engine"]} -->

Status: `partial`. The source library, release builder, download/install backend,
service and settings integration are implemented and covered by local tests.
Public release publication and live GitHub acquisition are pending the distribution
hold. Installed native settings acceptance and a portable integrated public package
are separate release gates. See [operations](../../../ops/instruction-distribution.md).

## Selectable instruction packages and task profiles

Status: `partial`. Independent resources, pinned profile resolution, host-side operation review and the native task transport are implemented in source. Windows native isolation tests, rendered library UI, first-turn transport fixtures and the complete pinned UI transformation have been verified. Installed new-panel/first-turn acceptance, live GitHub authentication and acquisition, and installation remain separate gates. The existing application installation has not been changed by this work.

The maintained release currently has ten selectable components: global `AGENTS.md`, two agent roles, five skills, an optional workspace logging playbook and agent configuration. The home components are selected by default in the existing release manifest. These are distribution components, not proof of current remote publication. Engine-owned runtime identity, root coordination, permission enforcement and provider/tool eligibility retain their native delivery and are not selectable instruction resources.

The reusable unit is a versioned package, with a stable identity, kind, content digest, complete support-file inventory and declared dependencies. The kinds are `skill`, `agent-role`, `context` and `task-profile`. A context package groups a coherent guideline, playbook or reference set. The current resolver exposes context Markdown on demand and uses the profile's `instructions` for persistent task guidance; package-level loading choices remain an extension. An agent role includes its task responsibility, instructions and declared model requirements. An import never copies the full source `config.toml`, credentials or machine-specific execution settings.

An individual resource can be browsed and imported independently. A task profile composes references to versioned resources with a provider/model selection, reasoning settings, task instructions, harness composition and optional role requirements. It records a repeatable recipe rather than embedding duplicate copies of every skill. One repository release may contain several packages; the publication archive boundary, reusable package boundary and task activation boundary are distinct.

For example, a repository-review profile can select a review model, a review guideline context, a repository-inspection skill and an explorer role. Import displays the profile and required package versions; the user can inspect that complete set before acquiring it. Importing the explorer role does not itself spawn a child. Profiles declare required resources separately from optional extras; omitting a requirement makes the profile unavailable, rather than silently substituting empty context.

Imported packages enter the user's local library without modifying global `AGENTS.md` or immediately changing a running conversation. A separate Apply operation makes their frozen resources available to the selected new conversation. Save and Publish retain their existing meanings. Library availability, installation destination and activation are separate: user-level storage does not make all imported instructions active in every conversation. Task-profile application does not change global or project defaults, existing conversations or subsequent conversations that did not select that profile.

The existing native named configuration profile can supply model/provider/reasoning settings; the existing [harness profile](../model-harness-profiles/README.md) supplies compatible behavior templates and tool composition. A task profile composes those settings with resource selection and task-context provenance. Source UI and task-resource admission are implemented; final installed-host acceptance remains pending.

Regular task guidelines are additive context with explicit source attribution; they do not wholesale replace global/project `AGENTS.md`. A behavior-template replacement, if a profile declares one, follows the existing harness semantics and is shown explicitly in the application preview. Native runtime instructions and authority retain their independent meaning. The resource resolver must not promise a task has isolated context merely because a list is filtered in the UI: model catalogs, prompt projection, tool discovery and execution admission must agree on the active selection.

The model policy records a recommended model and permits an explicit local override at application, while preserving the shared recipe and recording the effective choice. Required provider/tool compatibility and capabilities are checked after any override. A missing model or login prompts for an explicit compatible selection rather than silently choosing another provider or a more expensive model. A task captures its effective model, resource versions and context digests; later package updates do not mutate that captured task.

Context is classified by loading behavior. Short task goals and rules can enter the task's persistent prompt; complete skill bodies and longer references retain on-demand loading. A profile does not unconditionally inject every support file or the user's conversation history. Preview shows persistent instruction content, available skills/roles, required connections and any local variable bindings. Tokens, account sessions, personal memories, absolute local paths, private workspace files and raw conversation snapshots are excluded from shared profile exports. Local context attachments remain local task bindings unless explicitly made a shareable context package.

Dependencies are pinned to approved versions and content identities. Cycles, missing dependencies, conflicting install names and incompatible harness/provider combinations stop Apply. Publication checks dependencies before emitting even their identifiers: a public profile cannot reference collaborator-only or local-only packages, and a collaborator profile cannot reference local-only packages. The user must change the dependency's publication scope or remove it from the profile. Local profiles may use resources the user can access. Updating a resource or changing its class shows affected profiles and requires explicit profile-version review; published recipes do not silently follow a moving latest dependency.

The source UI has a library with filters for Skills, Agent roles, Context and Task profiles, with common search, sharing class and publication state. Profile composition uses JSON editing; application review lists the effective model, pinned resource inventory and persistent instructions before opening a new conversation. The baseline instruction bundle remains a separately identifiable distribution source; optional resources need no mandatory application install to be browsed or acquired.

Initial verification must distinguish availability from activation: acquiring an unused package does not change ordinary task prompts; selecting a profile activates its approved persistent context and catalogs with native ownership; deselection in a new task removes that profile contribution without removing runtime/project instructions. Also cover dependency version preservation, unavailable models, provider incompatibility, publication scope leaks, local overrides, token budgets and child role availability without automatic delegation. Existing personal-library integrity, source-separated caches, collision handling and recovery requirements still apply.

## Related design owners

- [roles](roles.md)
- [editing](editing.md)
- [ui](ui.md)
