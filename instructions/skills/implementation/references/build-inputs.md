# Build Inputs (All Agents)

- At build start, freeze the selected source, scripts, lockfiles and other inputs, including selected uncommitted changes. Use that immutable snapshot through packaging, verification and installation. Exclude changes added afterward until the next build; do not refresh or restart a running build to follow concurrent checkout edits. A correction to a frozen input requires a new build identity.

- Keep the current app version unless the user explicitly instructs a version change, and replace the existing installation with a verified new build of that same version. A request to build, modify or reinstall does not itself authorize a version increment. Assign new identifiers to build inputs and artifacts, keeping them distinct from the app version. Preserve the running runtime, the immediately preceding rollback copy and user data. Apply the service's separate authorization and immutability rules to remote publishing.

<a id="빌드-오류-수정의-범위와-변경-보고"></a>
## Scope of Build Error Fixes and Change Reporting

- Before fixing a build, packaging or installation error, identify its cause and the ownership boundary of the proposed fix. Do not arbitrarily remove, relax or replace existing engine policies, features, permissions, settings, data handling, UI design or existing patches to make a build succeed. For choices that change agreed behavior, check existing authorization and obtain user confirmation before applying changes outside that scope. A completion report does not replace prior confirmation.
- When the objective is to resolve an error in a specific platform build, limit the fix to that OS, CPU, ABI, build configuration or platform adapter boundary, preserving existing engine, feature and UI behavior on other platforms. If common code must change, obtain evidence that other platforms retain their behavior and perform relevant regression verification. If behavior changes on other platforms are unavoidable, explain the impact and alternatives before the change and obtain separate user instructions; do not arbitrarily include them in a build error fix. Lack of verification is not evidence of no impact.
- Record the purpose, cause, changed files and settings, and applicable platforms of build-related fixes in the same work record. At completion, explain each change to engine systems, features, permissions, data and UI design as before → after, and report its reason, whether existing patches were removed or replaced, effects on other platforms, actual verification environments and unverified scope. Include unintended effects and the results of reversions or corrective work. If only compilation or packaging changed, state that product behavior did not change, without inferring this solely from build success.

<a id="후속-소비자와-산출물-재사용"></a>
## Downstream Consumers and Artifact Reuse

- Before expensive execution, select the smallest relevant checks likely to expose failures at the changed boundary.
  Check the actual target OS, CPU, ABI and build configuration, required tools and native dependency paths, input recording,
  and downstream prerequisites. A check using a different configuration or native path does not verify the intended path.
- Distinguish the inputs included in the frozen snapshot from verification scope. Including all selected changes does not itself require
  full verification. Choose and record full or focused verification from regression risk, existing compatible passing evidence and mandatory
  acceptance checks; broaden it when changes, failures or evidence gaps warrant it, within the authorized build scope.
- Check reuse compatibility before choosing caches and output paths. Identical source does not establish compatibility when OS, CPU, ABI,
  debug/release settings, tools, dependencies, runtime environments or verification scope differ. Check locking and recompilation effects
  of cache or path changes. Set concurrency from available memory, CPU, disk capacity and contention, and cache ownership or leases;
  coordinate shared work through [Delegation and integration](delegation.md#connecting-downstream-work-and-reporting-results).
  Reuse or wait for the same compatible expensive compilation instead of launching duplicate work.
- Where practical, arrange preliminary runs so the final work can reuse them, without making reuse mandatory.
  Do not make a small check expensive to prepare for reuse; weigh additional execution cost against early error detection.
- After a failure, diagnose the cause, fix it within scope and pass the focused check before repeating expensive downstream work.
  A frozen-input correction requires a new build identity. Regenerate only affected artifacts and downstream checks according to their dependencies;
  reuse sufficient compatible passing evidence after confirming inputs, environments, provenance, verification scope and project reuse conditions.
  Final immutable-input, provenance, completed-artifact and exact-package identity checks remain mandatory; preparation or diagnostic results
  do not establish that the final product passed.
- Artifacts handed to downstream work must remain unchanged while in use and have fixed identifying information.
  Do not hand off a directory still receiving output as a completed artifact. State downstream prerequisites and remaining checks.

<a id="테스트-준비와-제품-빌드의-구분"></a>
## Distinguishing Test Preparation from Product Builds

- Keep test execution plans and results separate from product build execution plans and results. If tests require compilation, record the target inputs,
  settings, actual commands, exit codes and elapsed time as preparation, separately from test execution. Successful test preparation compilation
  or partial checks do not mean the complete product build succeeded. Record overall wall time separately, distinguishing dependency and resource
  waits from execution; overlapping durations must not be added into overall elapsed time. Follow the existing
  [coordination and timing guidance](delegation.md#connecting-downstream-work-and-reporting-results) without creating another reporting system.
- Group tests with matching purposes, inputs and preparation conditions, and reuse prepared artifacts after checking the reuse conditions above.
  After changes, rerun affected preparation and checks. After fixing failures and completing revalidation, the model decides whether to delete or retain one-off verification artifacts.
  Apply this principle through existing project commands and tools as well; it does not require a particular management program or resident scheduler.

<a id="산출물캐시백업의-보호와-정리"></a>
## Protection and Cleanup of Artifacts, Caches and Backups

- Before execution, register generated paths, bundles with a single owner and active references, and update them through failures, cancellations and unconfirmed termination.
  Follow [Artifact lifecycle](artifact-lifecycle.md) and the project lifecycle playbook for task/run, version and shared paths, and migration of existing projects.
  Keep raw logs in their generating run; before removing a task, retain required release verification at version scope with provenance and content identity.
  Review obsolete run bundles, logs and consumer registry records under those same ownership and active-reference guards;
  compact management records only through their lifecycle owner's rules, preserving active references and required evidence.
- The model's decision to delete or retain applies to the entire bundle. Protect a bundle if any member is protected or uncertain,
  and check active and last required consumers of shared caches. After partial deletion, retain the basis for items not attempted and check actual remnants and references before retrying.
- Manage backups created during work alongside artifacts and caches, while distinguishing them from originals and user files. Check each item's ownership, management root,
  creation basis, inputs, provenance and current consumers. Do not infer eligibility for deletion from names, age or successful verification alone.
- Protect running work, frozen inputs, prepared artifacts awaiting handoff, active caches and valid recovery copies. Preserve copies with identical content
  when another active consumer uses them. Leave unconfirmed ownership, usage or recovery status as uncertainty and defer deletion.
- Within existing authorization, the model chooses deletion or retention for each bundle. For retention, record the reason and review conditions;
  do not delete automatically merely because execution occurred or a period expired, or require renewed user approval every time. Do not expand the scope to repository-wide cleanup.
- Immediately before deletion, recheck actual paths, links, management-root boundaries and protection, execution and recovery references. Only for generated items the model has chosen to delete,
  whose ownership, creation basis and distinction from originals are confirmed, clear ReadOnly or Hidden attributes if needed, then delete normally.
  Do not change attributes of originals, user files or unconfirmed items. Changing System attributes, ACLs or owners and force deletion are prohibited.
  Do not bypass failures through another shell or API.
- Record paths changed, attribute states before and after, actual normal-deletion results and errors, and remaining paths. If rechecking, attribute changes or deletion fail,
  leave the item deferred or failed and recheck current state before retrying. Do not mark a completed cleanup attempt as completed deletion;
  report build and verification results, the model's cleanup decisions and actual cleanup outcomes separately.
