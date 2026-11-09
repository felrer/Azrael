# Agent Profiles roles

<!-- architecture: {"id":"arch.agent-profiles.roles","feature":"agent-profiles","layers":["host","engine"]} -->

Status: `partial`. The source library, release builder, download/install backend,
service and settings integration are implemented and covered by local tests.
Public release publication and live GitHub acquisition are pending the distribution
hold. Installed native settings acceptance and a portable integrated public package
are separate release gates. See [operations](../../../ops/instruction-distribution.md).

## Role profiles for Team and Direct

Status: `partial`. Source implements the unified profile store/editor, trusted host creation, native policy admission and instruction isolation, and approval projection. Windows JavaScript/host tests, TypeScript checks and rendered UI cover the unified library and resource snapshot transport. The new native resource-selection and inherited-model changes have syntax checks only; native compilation, generated schema updates, installed-host acceptance and other-platform execution remain separate gates. Prior native policy/fork/coordination checks do not establish acceptance of these new paths. Session creation, saved configurations, change timing and approval routing are owned by [Team and Direct](../work-orchestration/README.md#team-and-direct).

Agent profiles and role profiles use one canonical library, one profile list and the same composer. A profile has a stable ID, a display name, an optional circular raster image and one or more allowed roles (`lead`, `root`, `subagent`). Model/provider/reasoning overrides are optional; omission inherits the caller's effective settings. The same profile can carry ordered instructions, selected skills and selected MCP servers and can be selected for ordinary project requests, Team or Direct. Packages are resource/template sources rather than a second activation unit. Builtin profiles remain read-only and are duplicated before editing.

The canonical owner is `RoleProfileStore`; the workbench reads and replaces its profile library with a revision compare-and-swap. Project activation metadata stays in the workbench, independently of saved Team/Direct references and captured session copies. Initial migration preserves profile IDs and the original legacy file, then uses `workbench-repository-state.json` for workbench metadata without another writable profile library. Concurrent revisions and attempts to remove profiles referenced by saved Team/Direct configurations fail explicitly. Invalid drafts may be saved but cannot be applied; an active project's last valid snapshot is retained.

Direct common settings select one Root-compatible profile and zero or more Subagent-compatible profiles from the unified library. Team assignments likewise require each selected profile to allow its assigned role. Saved Direct settings are captured when creating a session; existing sessions keep their captured role configuration. Project activation remains separate: ordinary requests may capture the project's active Root profile, while Team and fixed child-role requests do not compose a project profile on top. Native thread metadata supplies this distinction, independently of caller-provided request fields. Removing `root` from an active project profile saves the draft and retains the last valid applied Root snapshot without invalidating that profile's permitted Team roles. Existing manually selected thread models remain unless an explicit profile model overrides that request.

Roles preserve the existing Team responsibilities and tool authority. Profiles supply the model, reasoning and additional role-specific instructions; they do not grant execution permission or redefine who may approve an operation. Allowed roles describe where a profile can be used, not an additional runtime role.

| Builtin profile | Allowed role | Instruction source |
| --- | --- | --- |
| Lead default | `lead` | Existing Lead guidance |
| Azrael default | `root` | Existing root guidance |
| `sol_executor` | `subagent` | Existing bounded implementation and validation guidance |
| `luna_explorer` | `subagent` | Existing bounded read-only exploration guidance |

Existing named subagent configurations become profiles in this system. The model, reasoning and instructions of the two builtin worker profiles retain their existing meaning; neither worker becomes a root profile. The root default reuses the existing root instructions without changing the worker profiles' delegation limits.

Creation tools select an allowed profile by ID and apply its explicit model/reasoning overrides, instructions and pinned resource selection together. Profiles using the same model remain distinct choices. Tool discovery and execution admission must use the same allowed set; an arbitrary model override, legacy agent type or omitted profile selection must not bypass the profile restriction. A profile without a model override deliberately inherits the effective caller model while retaining its own identity and resources. Missing or role-incompatible profiles and unavailable or incompatible explicit model selections fail instead of choosing another profile or model.

Child sessions receive their own role and profile instructions. Parent-specific role/profile guidance is not inherited as active child instructions, including on full-history forks. Common runtime/project instructions and explicitly handed-off task context retain their existing authority. Sharing conversation history does not grant the parent's role, tools or approval authority to the child.

Users may explicitly change a created session's model and reasoning using the existing controls, subject to existing compatibility and permission checks. The effective selection is saved with that session and restored on resume; it does not rewrite the profile, its instructions, other sessions or the allowed child-profile set. Child creation continues to apply the selected child's profile rather than inheriting the parent's locally changed model or reasoning.

The local store owns `CODEX_HOME/azrael/role-profiles/state.json`; attached Teams keep their native policy copies directly under `CODEX_HOME/azrael/role-profiles/teams/`. Team policy JSON is limited to 4 MiB of encoded UTF-8 and must remain a canonical regular file in that directory. Native session metadata persists the captured role policy. Child admission reloads only the Team copy's profiles and allowed sets, preserving the active caller's identity, common instructions and session settings. Missing, malformed or incompatible copies fail explicitly. Legacy sessions without a captured role policy retain their existing spawning behavior.

The preservation inventory links `ui.role-profiles` and `engine.role-profiles` to role-profile store/runtime/approval checks and native admission, fork-isolation and root-authority checks. Existing `ui.instruction-settings` and `engine.task-profile-skills` keep their package and skill contracts; their evidence alone does not establish role-profile acceptance.

### Optional task-memory role fragments

`task-memory-root` and `task-memory-subagent` are optional baseline instruction components in the existing profile composer. Each pins the maintained common task-memory rules followed by the role-specific fragment; native role and tool/filesystem authority remain independent of this selection. Existing profiles and conversations are not automatically changed. The [task-memory contract](../task-memory/README.md#프로필-조립) owns recording, work binding and explicit context handoff; the existing resource snapshot and role isolation paths own application.
