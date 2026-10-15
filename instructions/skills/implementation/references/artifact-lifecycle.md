# Work, Version And Shared Artifact Lifecycle

Read this reference when planning generated outputs, adopting artifact ownership, or cleaning work/build evidence. Use the project's artifact-lifecycle playbook for its paths and migration procedure. This contract works with existing commands and records; it does not require a particular program or background scheduler.

## Ownership And Paths

Use configured equivalents of these defaults; work documents remain in their separately configured work directory:

| Scope | Default path | Owns |
| --- | --- | --- |
| Work/run | `artifacts/tasks/<work-id>/runs/<run-id>/{inputs,temporary,outputs,logs,reports}` | Generated snapshots, fixtures, backups, command output and raw execution evidence |
| Version | `artifacts/versions/<product-version+unique-build-id>/{payload,verification}` | Identified deliverables and required release verification |
| Shared | `artifacts/shared/<cache-kind>/<content-key>` | Reusable generated cache entries with explicit consumers |

Each artifact has exactly one owning work/run, version or shared group, regardless of file type. A work group may aggregate its runs; it is not a second owner of their files. Other consumers hold explicit references rather than accumulating copies. Original source and user files stay outside generated ownership. Keep protected management records in a separate bounded location, outside groups subject to recursive deletion; define their owner, size/retention limits and safe compaction conditions.

Before a command, register its group, planned output paths, input/tool identity and active references in the existing management record or work record. Do not wait for successful completion to discover ownership. Record creation and terminal outcomes, including failure, cancellation and unconfirmed exits; reconcile partial outputs and keep unresolved runs protected. Reattempts preserve prior evidence and use distinct run/attempt identities where inputs or outputs change.

## Evidence And Shared Use

Raw logs remain with the work/run that generated them. Before removing task evidence needed by a release, copy or record the required verified evidence into version scope with source identity, content identity and verification outcome; confirm it is independently usable and switch the references. The resulting version evidence is a separate version-owned artifact. A reference to a file about to be deleted is insufficient.

Product version and unique build identity are separate: two builds of the same version must not overwrite each other's payload or verification. Shared cache reuse requires matching content, tool and environment identity. Shared entries own their explicit references; an active, uncertain or last required consumer blocks deletion until its dependency is released or replaced and verified.

## Test Profiles And Application State

- Use an application's profile/path options to isolate test-only state under `artifacts/tasks/<work-id>/runs/<run-id>/temporary/profiles/<app>` or a configured equivalent. Before creation or launch, record the work/run owner, actual resolved paths, whether each path already exists, related process identities, and the full generated bundle: profiles, extension copies, caches, logs and backups. A profile option alone does not prove where all output goes.
- After reruns, diagnosis and handoff no longer need the disposable state, the model chooses cleanup: stop and confirm termination of only the test-owned processes, ordinarily delete the whole generated bundle, then verify actual absence at every recorded path. Review the same cleanup obligation after success, failure and cancellation; do not treat a successful test or exited parent process as proof of cleanup. Preserve necessary acceptance evidence through the lifecycle rules above before removing its raw files.
- If ongoing diagnosis, an active process, uncertain ownership or a deletion failure prevents cleanup, record the actual remaining paths/processes, defer/failure state, reason and condition for release or retry. Do not report cleanup complete. Use the current conversation's decisions within existing authority; this rule adds no resident scheduler, mandatory management program or new test-script creation criterion.
- When a test must use an existing user profile, track the test's additions and modified pre-existing state before mutation. Remove only those additions and restore the recorded modifications after use; never delete the whole existing profile. A real installation and the immediately preceding verified recovery copy retain their separate persistent owner and protection.
- For a physical root outside the selected project's management boundary, use a separately owned, explicitly registered management root or the established owner cleanup procedure, with verified actual paths and scope supported by the chosen tool and current authority. Preserve a tool's refusal to delete outside its selected project root; do not widen deletion scope or switch APIs to bypass it. If supported cleanup cannot be established, leave the state unresolved and report the blocker.

## Review And Group Decisions

After execution, review results and fix/rerun as needed. The model chooses delete or defer for each reviewed group within existing authority, with reason and revisit condition for deferral. Age, passing tests or finishing a run never selects deletion automatically. Test creation criteria and required verification remain unchanged.

Protect the whole selected group if any member is an active input, running output, pending handoff, required release evidence, sole usable recovery copy, user/source file, or has unknown ownership/use. Check all descendants before deleting a work parent. Recheck actual paths, links and references immediately before application. Use ordinary deletion and the generated-file-only attribute rules in [build inputs](build-inputs.md#산출물캐시백업의-보호와-정리).

Record decision, attempted members, actual deleted/retained paths and errors separately from test/build success. Partial deletion leaves the group partial/failed; preserve unattempted evidence and retry only after reconciling actual remaining paths and current protections. An attempted cleanup is not a deleted group.

For adoption into an existing project, use its artifact-lifecycle migration playbook. Bootstrap provides a copy-ready owner; it does not migrate files or create application/runtime scaffolding. Inventory unknown legacy paths separately and resolve producers and consumers before assigning or moving them; never infer generated ownership from a filename alone.
