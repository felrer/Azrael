<a id="azrael-개발-작업-playbook"></a>
# Azrael Development Work Playbook

Applicability: Applies to implementation, fixes, refactoring, migration, verification and retirement cleanup in this project.
The installed `implementation` skill owns common investigation, implementation, verification and cleanup principles; this document connects
the Azrael-specific constraints and owning documents to apply alongside it.

<a id="작업-진입과-문서-소유자"></a>
## Work Entry and Document Owners

- Find the current work's document owners in the [project documentation guide](../README.md). [Architecture](../architecture/README.md)
  owns behavior and contracts, [code maps](../maps/README.md) own code entry points,
  and [operational documentation](../ops/README.md) owns execution commands and repeatable procedures.
- Store new work plans in the project-local `work/` specified by [Work Artifacts](../README.md#work-artifacts), and follow
  the session and plan rules in [Work documents](../../work/README.md). Do not create a separate work plan repository.
- Apply the [multi-platform contract](../architecture/multi-platform.md#requirement-applicability) when selecting the current work's platform scope and required acceptance.
- Also select guidance applicable to the current work from the [playbook entry point](README.md).
  Read only the needed owner sections in documents linked by that guidance.

When handling generated inputs, logs, reports, backups and version evidence, also apply [Artifact lifecycle and migration](artifact-lifecycle.md). New-project adoption and migration of existing paths follow that playbook's investigation, mapping, pilot, reference switch, verification and model-directed cleanup sequence; copying documentation alone does not move files.

<a id="azrael-변경과-검증"></a>
## Azrael Changes and Verification

- Use the common entry guidance to identify the conversation's goal, deliverables and allowed actions, then start with `design-collaboration` to discuss linked choices or `development-workflow` to gather questions in a plan. Even small tasks use a proportionately short plan; transitions carry forward the same record and existing authority.
- Compare the relevant architecture with existing code, tests and actual behavior to identify features, constraints and permissions to preserve. Preserve undocumented features too. Have unauthorized design differences or deletion, hiding, disabling or reduced verification intended to avoid errors reviewed as changes before the related implementation. At completion, verify error resolution and preservation of existing features separately.

- Select common checks, platform contract checks, native execution in target environments and host verification according to the actual change and integration risk.
  Check Windows regression for common changes, and distinguish requested targets from actual verification environments, methods and unverified scope in the work record and completion report.
  Do not extend a pass on one OS into acceptance evidence for other environments. Do not create a separate plan or full checks on every OS solely for this assessment.
- Before investigating or modifying engine code, confirm the actual source root through [engine source selection](../maps/README.md#select-the-engine-source).
  For problems in a running distribution, first establish that distribution's relationship to the source.
- UI changes follow the [UI presentation contract](../architecture/ui-presentation.md). Reuse components, layouts and theme tokens
  from the pinned upstream UI, and verify actual rendering and interaction in light and dark themes.
  Do not mark visual verification complete from source inspection alone.
- Apply the [Build and reinstall playbook](build.md) to packaging, installation, updates, rollback and build artifact cleanup.
  Distinguish source changes, packaging success, feature verification and installation state; consult
  [feature checks](../ops/development.md#feature-checks) for checks of the changed area.
- Apply the [App logging and error diagnosis playbook](app-logging.md) to logging changes or work where missing logs make a cause difficult to trace.
  See [native diagnostics](../ops/native-diagnostics.md) for error investigation in the existing app.
- Update current document content according to [document state and ownership](../README.md#document-state-and-ownership).
  Keep this task's execution results in the work record and repeatable procedures in operational documentation.

<a id="기능-변경과-업데이트-보존"></a>
## Feature Changes and Upgrade Preservation

- When adding, changing or retiring a feature, update its owning section in the same task according to [architecture feature maintenance](../architecture/README.md#feature-maintenance).
  Record changed contracts for current behavior, failure and recovery, data and permissions, and applicable environments;
  distinguish document or section implementation state from verification scope. Avoid unnecessary document changes for internal edits that preserve the contract.
- Maintain stable feature IDs, design owner documents, implementation owners and mandatory checks together in the [feature preservation inventory](../../scripts/azrael-feature-contracts.json).
  Make the preservation item connected to each relevant design section discoverable through a document link or feature ID.
  First check whether existing items and checks can be extended.
  For features spanning UI and engine, connect verification coverage for both sides; documentation or source provenance checks do not replace behavior verification.
- For Codex UI and engine updates, compare the candidate against the baseline release's design and preservation inventory under the [upstream preservation contract](../architecture/upstream-preservation.md).
  Check implemented portions and contracts agreed to be retained section by section;
  do not exclude existing implementations from preservation merely because the overall design is `target` or `partial`.
  Distinguish unimplemented goals and drafts from implementation requirements.
- For deletion, reduced scope or exclusion of preservation items or checks, confirm the corresponding design change and approval evidence in the existing task.
  Record evidence in the work record for comparisons without automated checks. Do not complete acceptance of the update candidate until missing, failed or unverified items
  are resolved or addressed through an explicitly decided scope change.
- Perform verification authorized for this task and record results and unverified scope. Distinguish completion of source changes from update candidate acceptance;
  candidate acceptance requires mandatory verification connected to the actually selected UI, engine and package.
  This rule does not add authority to run a full build, installation or deployment.

<a id="테스트-묶음과-생성물-검토"></a>
## Test Groups and Generated Artifact Review

- Distinguish test purposes `one_off`/`retained` and phases `prepare`/`test`/`build`. Follow [project maintenance operations](../ops/project-maintenance.md) for registration and execution. Preserve existing mandatory checks and criteria for adding tests.
- Use one-off groups for failure fixes and reruns too. After reviewing results and required rechecks, safely delete disposable material as soon as its current use ends and verify actual cleanup. Before task completion, obtain explicit user retention approval for every remaining cleanup-scope item under the installed `implementation` skill and [artifact lifecycle](artifact-lifecycle.md). Reasons, review conditions and tool deferral alone are insufficient; keep cleanup unresolved while approval is pending.
- Use management tools in engines that provide the built-in tools. Where tools are unavailable, apply the same principles with existing commands; management functionality does not justify expanding scope to a full app build or installation.

<a id="windows-산출물-삭제"></a>
## Windows Artifact Deletion

- Cleanup follows the protection and retention criteria in the [Build and reinstall playbook](build.md). For registered groups, first use the [management-tool workflow](../ops/project-maintenance.md#registered-group-cleanup) and rely on the checks it implements. For operations outside that coverage, prefer the
  [verification artifact cleanup script](../../scripts/clean-verification-artifacts.ps1) for verification fixtures and the
  [engine cache cleanup script](../../scripts/clean-engine-caches.ps1) for registered engine caches.
  Check target paths and preview results, then apply through an invocation permitted in that environment.
- Delete within one PowerShell session using native `Remove-Item -LiteralPath`.
  Use recursive deletion only after confirming the absolute path is within this task's owned directory and has no references or linked paths
  from running processes or active installations. Do not use wildcards, deletion commands assembled as strings,
  or deletion that passes paths through `cmd /c`, batch commands or another shell.
- Keep complex path calculations and protection checks in existing cleanup scripts; pass only necessary parameters at invocation.
  Establish permission from actual execution results. A particular command form or use of a script does not itself establish permission.
- If policy rejects deletion, inspect the reason and target scope. Use an allowed method when the actual deletion scope can be reduced,
  such as selecting individual files or directories confirmed empty. Do not conceal and retry the same deletion through another shell,
  encoding, separate script or rename. If unresolved, record retained paths, reasons and removal conditions
  in the work record and completion report.
- Do not determine cleanup completion from exit code alone. Check deleted and retained states in the cleanup result and actual absence of target paths.
  Keep small receipts to retain at the owning log location; exclude user authentication, conversations and settings from cleanup targets.

## Worktree lifecycle

- When a task uses a newly created worktree, integrate all of its changes into the primary checkout (`main`, or the repository's existing primary branch), preserve existing work, resolve conflicts, and verify the combined result before task completion. Uncommitted changes must also be integrated.
- You MUST delete the task worktree after integration, without exception. Verify that both its Git worktree registration and its directory are gone. Preserve required provenance and reusable build caches outside the worktree before deleting it.
- These requirements do not authorize commits or publishing; follow the user's existing instructions for those actions.

<a id="작업별-커밋과-완료"></a>
## Task-Level Commits and Completion

- After finishing implementation, required verification and cleanup for each development task, commit that task's changes together.
  Include code, related tests and scripts, and documentation in the same task unit; do not mix changes from different tasks.
- Before committing, inspect the diff and staged content. Preserve existing user changes and other tasks' changes,
  and explicitly stage only files or changed portions belonging to this task. Exclude temporary verification material and build artifacts.
- Commit messages explain the task's purpose and result. Include the commit identifier and verification results in the completion report.
  If mandatory verification failures or problems separating changes prevent a commit, report the reason and remaining work.
- If a worktree was used, integrate changes into the primary checkout and verify them before removing the worktree
  under [Worktree lifecycle](#worktree-lifecycle).
- Task-level commit rules do not authorize remote push, publishing or deployment. Follow separate user instructions for those actions.
