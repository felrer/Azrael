# Artifact Lifecycle And Migration Playbook

Applies when a project introduces generated-output ownership, runs tests/builds, preserves release evidence, or reviews generated files for cleanup. Adapt paths and operational links to verified project facts. This playbook defines operating and migration rules; importing it does not move files or implement a management runtime. Common execution and test-creation criteria remain with the installed `implementation` skill.

## Locations And Ownership

Use these defaults or record equivalent configured roots in the project's operational owner. Relative roots resolve from the project root. Work documents use their own configured location and are not generated-output directories.

| Scope | Default | Contents |
| --- | --- | --- |
| Work/run | `artifacts/tasks/<work-id>/runs/<run-id>/` | `inputs/`, `temporary/`, `outputs/`, `logs/`, `reports/` |
| Version | `artifacts/versions/<product-version+unique-build-id>/` | `payload/`, `verification/` |
| Shared | `artifacts/shared/<cache-kind>/<content-key>/` | Reusable generated cache entries |

Every generated artifact has exactly one owning work/run, version or shared group. A work parent aggregates runs for review; it does not duplicate their ownership. This applies to every file type, including raw logs, reports, backups, source snapshots, packages and failed command output. Cross-use is an explicit consumer reference, not indefinite copying. Source and user files remain outside generated ownership.

Keep management manifests, active references and decision/recovery records in a separately bounded protected location outside recursively deleted groups. Record its owner, capacity/retention limits and compaction conditions. Preserve enough identity and result evidence to reconcile partial operations; compact only when active consumers, unresolved operations and recovery needs allow it. Do not let management history become an unlimited artifact archive.

Product versions can repeat across builds. Include a unique build identity in version paths and reject collisions instead of overwriting another build. Cache keys account for relevant content, tools and environment; shared cache entries maintain their own consumer references and last-consumer protection.

## Normal Operations

1. Before commands, register the owning work/run or version, planned output paths, generating command, input/tool identity and active consumer/recovery references. Pass those paths into existing writers. Include auxiliary logs, backups, snapshots and packages; directories created before failure still belong to the registered run.
2. Record creation and terminal execution outcomes, including failure, cancellation and an unconfirmed exit. Reconcile planned versus actual paths. Preserve partial/unconfirmed outputs and their references until their state is resolved. Use distinct identities for changed inputs and attempts that would overwrite needed evidence.
3. Execute the selected test bundles, review outcomes, fix failures and rerun affected checks. Keep test preparation compilation, test execution/results and product build execution/results distinct. Maintain required verification and existing test-creation criteria.
4. Keep raw logs with the generating work/run. Before removing task evidence needed by a release, copy or record the necessary verification into the identified version's `verification/` scope. Preserve source/run identity, content identity, command/environment, actual exit and outcome; verify it is independently readable and switch release references. The retained version evidence has its own owner. A pointer to deleted task logs is insufficient.
5. Review the whole proposed group and explicit references. The model chooses delete or defer within existing authority after results and necessary retries are reviewed. Record the reason and revisit condition for deferral. Run completion, age and success do not select deletion automatically. Do not add repeated user approvals when the current authority already covers the decision.
6. Recheck paths, links, ownership and protections immediately before applying the decision. Any protected or uncertain member protects the entire selected group, including when deleting a work parent containing several runs. Check active inputs/outputs, pending handoffs, required release verification, shared-cache consumers and sole usable backups. Release or replace required references and verify replacements before reconsidering deletion.
7. Use ordinary deletion. Only confirmed generated files selected for deletion may have ReadOnly/Hidden normalized after the protection recheck; record path and before/after attributes. Never alter source/user files, System attributes, ACLs or ownership, force deletion, or bypass a failure through another shell/API. Stop and record uncertainty or failure.
8. Report the decision and actual result separately from test/build success. Distinguish deleted, deferred, blocked, failed and unknown outcomes and list remaining paths. If deletion partially fails, preserve unattempted evidence, mark the group partial/failed, and reconcile remaining members and current references before retry. Do not claim an entire group was deleted because one operation finished.

Shared-cache cleanup uses the same group decision and protection rules. An active, uncertain or last required consumer blocks removal; releasing a reference does not itself authorize automatic deletion. Consider regeneration cost and reuse value when reviewing inactive candidates.

## Test Profiles And Application State

Apply this procedure to tests using a separate application profile, including applications whose profile, extension or cache paths default outside the project. Keep the same end-of-use cleanup obligation for success, failure and cancellation; a failed attempt may retain state for reruns or diagnosis with a recorded reason and release condition.

1. Before creation or launch, use the application's existing profile/path options to select `artifacts/tasks/<work-id>/runs/<run-id>/temporary/profiles/<app>` or the configured equivalent. Register the work/run owner, actual resolved paths and prior existence, related process identities and planned cleanup scope. Include every associated extension copy, cache, log and backup; inspect actual writers rather than assuming the profile path contains all output.
2. Prefer a newly created test-only profile. If a test requires an existing user profile, record its test additions and changes before mutation and plan to remove only those additions and restore changed pre-existing state. Keep real installations and the immediately preceding verified recovery copy under their separate persistent owner; they are not disposable test profiles.
3. If a physical path must remain outside the selected project management root, retain the chosen tool's boundary. Use a separately owned, explicitly registered management root or an established owner cleanup procedure, verifying the actual paths and scope supported by that procedure/tool and existing authority. A refusal to delete outside the selected project root is not permission to extend an allowlist or bypass the boundary through another API. Record unresolved ownership or unsupported cleanup before creating more state.
4. After reruns, diagnosis and handoff finish, the model chooses cleanup of the disposable bundle: stop only the identified test-owned processes, verify they exited, perform ordinary deletion of the full recorded generated bundle, then confirm actual absence at every path. Preserve required acceptance evidence first. Do not infer absence from a command exit or from the parent process ending; do not terminate unrelated user processes.
5. If cleanup is deferred, blocked or fails, retain the actual remaining paths/processes, reason, release/retry condition and truthful incomplete state. Reconcile current processes, ownership and paths before retry. Existing user-profile cleanup restores the recorded changes instead of deleting the profile. The ordinary-deletion, protection and partial-result rules above remain in force.

Use existing checks to distinguish successful/failed/canceled runs, retention for reruns, surviving processes, deletion failure and actual absence. This procedure does not require a resident cleanup service, a particular management program, additional test scripts or renewed approval for already authorized decisions.

## Existing-Project Migration

Run migration as a bounded task under the current plan and authority. Documentation bootstrap alone does not authorize a bulk move. Reuse settled decisions; resolve only conflicts that change the authorized behavior, data or scope.

1. **Inventory the chosen roots completely.** Name boundaries and exclusions before scanning. Identify producers, writer defaults/arguments, readers, release/install/rollback references, active runs and generated-file evidence. Include all file types, links and mixed directories. Record inaccessible or unknown legacy items separately; a filename, age or extension is not proof of ownership. Do not claim a full inventory outside the scanned scope.
2. **Write an ownership and mapping manifest.** For each known item/group record current and proposed paths, its one owner, identity/checksum where relevant, producer, consumers, active/recovery protection and migration status. Keep unknown items unmapped and protected. Detect collisions, path escape/link boundaries and user/source content before planning copies. Reference shared data from other groups instead of assigning it multiple owners.
3. **Plan and dry-run.** Show candidate copies, required writer/reader changes, identity checks, reference switches, verification, recovery steps and deferred items. Protect active inputs, links, user/source files, readonly or otherwise uncertain legacy files and sole recovery copies; investigate instead of treating them as cleanup candidates. For confirmed generated files, any later attribute handling still requires a model deletion decision and the normal-operation checks.
4. **Change future writers first.** Supply work/run/version/shared context and registered output paths before future commands. Keep active legacy runs on their existing paths until they finish; do not move their inputs or caches mid-run. Stop new output accumulating in unmapped locations without breaking existing readers. Changes to application or build code follow their owning implementation task, not a bootstrap side effect.
5. **Pilot a small inactive group.** Copy to an unused destination, verify identities, completeness and required permissions, then switch only its known consumer references. Verify the actual reader/test/build/recovery behavior required for that scope. Preserve the old paths and a recovery mapping until this passes; a copy command's success alone is insufficient. Handle same-version builds with different unique identities and shared caches through their explicit consumer references.
6. **Review and remove old paths.** Only after consumers have switched and required verification has passed may the model choose delete or defer for the old group. Apply ordinary deletion with current protection checks, not a bulk age/name sweep. Record actual remaining paths and errors. Preserve unknown legacy items in a separate report with reason and next discovery condition.
7. **Recover and rerun safely.** If copying, switching or verification fails, stop the affected group, retain both copies and mapping evidence, restore references to the verified old source when needed, and record the failed stage. On rerun, reconcile actual paths and identities against the manifest; reuse verified copies, reject mismatches and never overwrite or delete solely because a previous step was marked complete. Partial deletion follows normal-operation failure rules.

## Acceptance And Closeout

Use the smallest applicable existing checks; documentation adoption does not require a new test harness. Separate documented policy, verified writer/reader adoption and remaining migration work.

| Case | Required evidence |
| --- | --- |
| New empty project | Routers, default/equivalent roots and ownership rules agree; no runtime scaffolding or fabricated historical outputs |
| Existing adoption | Bounded inventory and producer/consumer map; future writers routed; pilot identities, switched references and actual required verification |
| Repeated product version | Distinct build identities preserve both payload and verification; destination collision stops overwrite |
| Shared cache | Matching content/tool/environment identity, one owner, explicit consumers and last-consumer protection |
| Mixed user/generated files | User/source, links and uncertain legacy items remain protected; no filename-based classification or broad parent deletion |
| Failure or active work | Failed/canceled/unconfirmed outputs remain attributable; active references block cleanup; partial results and recovery/rerun evidence are truthful |
| Test-only or existing user profile | Generated bundle and processes recorded before launch; completed use confirms owned-process exit and actual absence, or reports unresolved state; existing user additions removed and modifications restored without deleting the profile |

Retain only necessary verification in version scope before task cleanup. Record deferred groups, unknown legacy paths, failed cleanup and revisit conditions in the current work record. Keep repeatable supported commands in their operational owner and link them here only when they exist.
