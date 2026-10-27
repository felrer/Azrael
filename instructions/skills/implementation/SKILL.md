---
name: implementation
description: Carry forward the plan, design, and execution authority established at work entry to implement, modify, refactor, migrate, verify, and clean up code. Common work-entry guidance, design-collaboration, and development-workflow own interpretation and entry routing for new work.
---

# Implementation

This skill owns execution rules for carrying agreed goals and design through code changes, verification, and cleanup. Follow the project's owning documents for project-specific commands, environments, and deployment procedures.

Carry forward the plan, design, success criteria, and execution authority established through either work-entry route. A short plan is sufficient for small work; do not add an approval wait when authority and review matters are already settled. Do not recreate a shared-understanding document or new plan; record execution results in the same work record. Selecting or reading a specialized skill does not expand the current phase, scope, or authority. Using a skill does not mean creating a separate session or subagent.

Resolve important open questions about goals or scope within the ongoing work. Use `development-workflow` to coordinate complex work, `design-collaboration` for design choices, and `design-documentation` to document agreed design. Do not reconfirm settled matters or delegated judgment, and continue authorized work that does not depend on unresolved choices.

<a id="1-적용-범위와-시작점"></a>

## 1. Scope and starting point

- Check project guidance, the current work's plan, and success criteria. Here, a plan means the approved work document or agreed conversation record used by the project; do not create a separate document just for this skill.
- Identify affected execution environments and owners of features, data, and documents, and read only the guidance and sections needed for the work. Recheck existing evidence when relevant inputs change or a concrete information gap arises.
- Apply **Platform Scope** in `CODEX_HOME/AGENTS.md` and the project's support contract; check the current plan's targets and required verification before execution.
- Project planning guidance owns plan creation and agreement. Follow the owning documents for detailed documentation, testing, and deployment procedures and exact commands.

<a id="작업별-상세-지침"></a>

## Detailed guidance by task

Read only references applicable to the current work before execution. When delegating, pass applicable constraints and required references to the worker; do not assume the worker knows the parent's loading history.

- UI changes: [UI reuse and rendering verification](references/ui.md), project UI contract.
- Builds, packaging, build verification, installation, and generated artifact/backup cleanup: [Immutable build inputs and artifact management](references/build-inputs.md), project build playbook.
- Paths, ownership, retention, and handoff for task, version, and shared artifacts: [Artifact lifecycle](references/artifact-lifecycle.md), project artifact lifecycle playbook.
- Test-only application profiles and their extension/cache/log/backup bundle: [Test-profile cleanup](references/artifact-lifecycle.md#test-profiles-and-application-state).
- Creating, using, integrating, and cleaning up task worktrees: [Worktree lifecycle](references/worktrees.md).
- Parent delegation and integration: [Delegation and integration](references/delegation.md).

<a id="2-작업-범위와-판단-기준"></a>

## 2. Work scope and decision criteria

- Implement against approved goals, success criteria, and constraints. Do not arbitrarily add features, settings, compatibility layers, or structures for future expansion that the goal does not need.
- Use investigation to settle facts discoverable from code, configuration, and execution evidence, and internal implementation choices. Resolve choices changing user-visible results or agreed scope, and work requiring new execution authority, separately from existing agreements.
- Plan readiness and execution authority are separate. Do not request existing approval again; perform data changes, deployments, and similar work within existing authority and project procedures.
- If an unapproved architecture difference or out-of-scope change is required, stop affected implementation, add new evidence, alternatives, and impacts to the same plan, and have only the change reviewed. Do not request approval again for settled decisions; continue independent approved work. Update owning design documents to match the agreed result.
- Judge minimal change by responsibility structure and maintenance cost that meet requirements, rather than edited line count. Cleanup of code made unnecessary by the change is within the work scope.
- Preserve responsibility for common policy and product logic and for platform-specific behavior. If effects on other environments are discovered, update targets, regression impact, and verification scope in the same record. Do not arbitrarily reduce support or change authority beyond the agreement. Reuse settled decisions and execution authority.
- Distinguish documented target state from actual implementation state. Do not treat lack of verification as evidence of impossibility or safety.

<a id="3-기존-구현-조사와-재사용"></a>

## 3. Investigate and reuse existing implementation

Before working, check architecture status and relevant behavior, constraints, and authority against code, tests, and actual behavior. Undocumented features also require preservation; missing documentation or a draft proposal does not authorize deletion. Treat feature deletion, hiding, disabling, or lowering verification criteria to avoid errors as scope changes requiring review before related implementation. Distinguish internal code replacement and cleanup that preserve behavior from functional reduction. Do not retrospectively change architecture to justify the result of a fix.

- Before changing code, inspect actual call paths, read/write boundaries, data contracts, and related tests. If ownership is unclear, first locate paths and declarations, then read the needed functions and contracts.
- First check existing project implementation, standard-library and platform features, and installed dependencies. Check mature reusable alternatives when needed, and choose the smallest change that meets current requirements.
- Add new implementation or dependencies only for concrete requirements existing alternatives cannot meet. For important replacements, briefly record considered candidates, decisions to reuse, extend, or exclude them, and remaining gaps in the plan.
- Do not duplicate product logic in test fixtures or execution tools. Do not create a separate product execution path or unnecessary abstraction layer for verification convenience.

- Identify affected owners and dependency order as far as execution requires. Define what each verification checks and which result means success, without turning command and file lists into a user approval checklist.

<a id="4-구현과-파일-구조-관리"></a>

## 4. Implementation and file structure management

- Place changes within existing responsibility boundaries and group related code, tests, and execution scripts with the owning feature or module. Prefer existing project structure and naming conventions.
- For long-running work, plan locations for code, tests, scripts, documents, and temporary artifacts, and include them in cleanup by phase. Prevent duplicate implementations, temporary files, and obsolete files from accumulating; do not create empty directories or layers solely for anticipated expansion.
- Before executing commands, register planned output paths and an owner in one of the task/run, version, or shared groups. Logs, backups, snapshots, and packages follow the same lifecycle; record execution and protection status for partial outputs of failed, canceled, or termination-unconfirmed runs too.
- When moving files, update imports, document references, and test, build, and execution paths together. Put temporary artifacts in designated project locations and clean them up when their retention purpose ends.
- Preserve existing user changes and changes from other work. Respect assigned file and responsibility ownership, and include changed contracts and integration impacts in results.

<a id="5-레거시-호환과-데이터-전환"></a>

## 5. Legacy compatibility and data transition

- Implement or retain compatibility with legacy data formats or older servers only for targets and scope specified in the approved plan. Do not arbitrarily add or retain unplanned compatibility branches, fallbacks, or dual reads/writes.
- If legacy data compatibility is not specified, migrate existing data to the latest supported schema targeted by the change, and use only that schema in normal execution paths. Confine interpretation of old data to the transition boundary. Data migration does not imply support for communication with older servers.
- If implementation reveals an unplanned compatibility requirement, check its evidence and impact and incorporate it into the approved plan before implementing it. Give temporary compatibility and migration code exit conditions and a cleanup point.
- Distinguish data preservation from ongoing compatibility. Define the targets for judging transition completion and data-preservation verification; follow project data-protection and deployment procedures for actual application. A migration default does not authorize changes to production data.
- Distinguish data transition from irreversible removal, and identify stop conditions and recovery procedure owners before external application.

<a id="6-앱-로그와-오류-진단"></a>

## 6. App logs and error diagnosis

- If a changed path fails, check whether existing logs can locate the failure and its cause. If insufficient, make the smallest necessary improvements within existing goals and authority. Resolve improvements changing collected data, retention policy, cost, or agreed scope as decisions with evidence and impact before proceeding; do not add separate approval merely because an improvement concerns internal diagnosis.
- For initial implementation of a new app, additions or changes to logging itself, or diagnosis hindered by insufficient logs, also apply project app logging and error diagnosis guidance if available. Without such guidance, establish and address the actual diagnostic gap and necessary scope; do not expand unrelated work just to create guidance.

<a id="7-검증과-테스트-관리"></a>

## 7. Verification and test management

Check separately that the targeted failure is fixed and that existing features, constraints, and authority are preserved. Apply the [testing skill](../testing/SKILL.md) for common test selection, admission, assertions, execution evidence, consolidation and retirement. Project guidance owns mandatory checks and concrete commands; section 8 owns disposable artifact cleanup and retention approval.

- Verify the assigned scope and report shared-resource constraints or needed scope changes to root.
- For document, UI, data and experimental changes, use the relevant project verification guidance. Do not generalize beyond the verified scope or arbitrarily lower success criteria because verification fails.
- Keep this task's verification evidence in the existing work record and repeatable procedures in operational documents. Update only status labels in design documents, linking evidence when needed; do not accumulate per-run results, hashes or dates there.
- When experiments guide implementation direction, distinguish final success criteria from intermediate metrics and first check whether evaluation or parsing errors make the results uninterpretable. Define the initial comparison and next actions for each result; do not repeat long runs without evidence.

<a id="8-정리와-문서-반영"></a>

## 8. Cleanup and documentation

### Mandatory cleanup and retention approval

- Cleanup is a completion requirement. As soon as task-owned disposable material is no longer needed for current execution, result review, diagnosis or handoff, delete it safely and verify actual absence in the same task. This applies after success, failure and cancellation, including temporary profiles, extensions, source/build copies, one-off tests/scripts, caches without remaining consumers, backups and unnecessary raw logs. Do not wait for a separate cleanup request.
- When changed behavior awaits the user's normal-operation check, follow [User confirmation and cleanup](references/artifact-lifecycle.md#user-confirmation-and-cleanup). Keep only the explicitly listed minimum check/recovery bundle, including necessary backups; announce its paths/groups, purpose, known size and deletion after confirmation. This bounded wait is authorized by that procedure, but remains **awaiting user confirmation**, with cleanup pending. Delete other disposable material immediately. On clear confirmation, resume safe cleanup without another cleanup request; on a reported problem, preserve needed recovery material and continue correction. Do not invent a user-confirmation gate for tasks that do not need one.
- If ordinary deletion fails, move eligible task-owned disposable material to the project's `archive/<unique-work-or-run-id>/` rather than leave it in its working location. This instruction is standing user authorization for that archive retention; do not ask again for the same eligible material. Verify ownership, released references, stopped producers and permission to move first. Never move active, protected or uncertain material, bypass a lock or a tool/policy boundary, or change ACLs/ownership to enable the move. Use supported owner migration procedures where applicable, preserve required evidence and update references/records. Verify resolved source/destination boundaries, use a fresh destination without overwriting existing content, record exact paths, deletion failure, owner and a concrete review/release condition, and verify content integrity and actual absence at the source. Report the result as archived, not deleted. Review for ordinary deletion when the failure is resolved or the user requests archive cleanup. If movement also fails or is unsafe/forbidden, preserve the remaining material and follow the retention-approval rule below.
- If any cleanup-scope item will remain outside the bounded user-confirmation wait or standing archive authorization above, obtain the user's explicit retention approval before closing the task. Give the exact paths/groups, purpose, known size when available, reason deletion is deferred or blocked, and a concrete release/review condition. A recorded reason, a possible future use, a failed deletion, uncertain process termination or a management-tool defer decision is not approval. Reuse prior explicit approval only while its named scope and conditions still hold; silence is not approval.
- While approval is pending, preserve protected or uncertain material and report cleanup as unresolved; do not claim task completion. User approval permits only the stated retention, never force deletion, lock bypass, changes to source/user files or ignoring live consumers. After retention approval, record its scope and conditions with the actual remaining paths; report completion with that exception only after any required normal-operation confirmation is resolved and other completion criteria pass. When the approved condition ends, review and clean up or obtain renewed approval for changed retention.
- Agreed deliverables, maintained source/user data and explicitly agreed persistent evidence or cache ownership are not disposable merely because a task touched them. Do not reclassify temporary fixtures, large copies or raw logs as deliverables, caches or evidence to avoid cleanup or retention approval. Preserve only necessary acceptance evidence under the agreed owner before deleting its disposable source bundle.

- Perform planned cleanup of legacy code, tests, and execution scripts. Check replaced models, branches, settings, and their dedicated fixtures too, and remove what can safely be removed in the same task.
- Before deleting, check current callers and dependencies in data transition, deployment, and recovery paths. Do not retain old code or tests merely because they exist; state current need and removal conditions for retained items.
- For artifacts, caches, and backups, use available management tools' current group records and review results for the checks they implement; investigate concrete gaps rather than duplicate their scans. Follow the [artifact lifecycle](references/artifact-lifecycle.md#review-and-group-decisions) workflow for updates, review, explicit group decisions and outcome reconciliation. For uncertain or retained cleanup-scope items, apply the retention-approval requirement above. Distinguish verification/build success, cleanup decisions and actual cleanup completion. Follow the build reference for detailed protection and attribute-handling criteria.
- If behavior, data contracts, responsibility boundaries, or execution procedures change, update only the minimum owning documents. Do not add unnecessary document edits when only implementation details change and documented contracts hold.
- Update current document content directly, handling necessary content and references when moving or consolidating. Follow project documentation guidance for detailed editing, retention, and deletion criteria. Integrate settled answers into relevant sections and remove resolved questions, discarded content, and duplication. Unless history is the document's purpose, do not append response records, dated confirmation notes, investigations, or detailed logs; retain only what current understanding, execution, and verification require.
- Do not widen scope into repository-wide cleanup unrelated to the change.

<a id="9-실행-결과와-완료"></a>

## 9. Execution results and completion

- Report whole-task completion only after success criteria, required user confirmation, mandatory verification and documentation updates pass, and cleanup is actually complete or remaining items have valid scoped retention authorization under section 8. An announced user-confirmation wait is an interim state, not whole-task completion; distinguish it from implementation/automated-verification success. Pending approval or an unexplained leftover keeps the task incomplete. Report archived items separately from deleted items and do not count same-volume archival as reclaimed space.
- Review final changes together to confirm the approved scope is fully covered and unrelated changes are absent.
- Briefly report results, verification scope, and success or failure. For execution verification, retain actual exit codes and needed log/artifact locations, and distinguish unconfirmed matters, remaining work, and reasons and removal conditions for temporarily retained items.
- If follow-up work remains, pass on the current plan, owning documents, sufficient verification evidence, and unresolved matters. Follow applicable project guidance and authorized scope for commits, deployment, and artifact retention.
