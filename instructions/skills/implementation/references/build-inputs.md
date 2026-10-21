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

- Before expensive execution, compare selected inputs and prior evidence at each component/check owner's declared dependency boundary.
  In the existing work or execution report, record reuse, rebuild or rerun, the exact prior result, and changed inputs or missing evidence.
  Separate product, test and verification-tool changes where the owner supports that distinction; do not invent narrower dependencies
  or treat a failed, unknown or incompletely bound result as passing. Keep the complete frozen-input audit even when component keys are narrower.
- Input selection and verification scope are separate. Default to affected checks plus mandatory acceptance; broaden coverage for dependency
  impact, uncertainty or insufficient evidence. Full coverage does not require re-executing checks with valid reusable evidence.
- Default to the owner's cache reuse; regenerate on invalidation, missing evidence or explicit force. Reuse requires matching declared
  contents, command/filter, OS, CPU, ABI, profile, tools, dependencies and effective environment.
  Select compatible stable source, cache and output paths before execution; a new build identity alone requires neither new paths nor
  recompilation of unchanged components. Keep shared artifacts immutable while consumed and retain their exact identities and prerequisites.
  Check path-induced recompilation and cache ownership before moving work; reuse or wait for an equivalent producer instead of duplicating it.
- Check each expensive consumer's prerequisites as they become available, using small probes through its actual configuration and native paths.
  Start ready independent work without waiting for unrelated probes. After a failure, fix the cause within scope and pass its focused check;
  recheck only changed prerequisites and regenerate affected artifacts and consumers. A frozen-input correction still needs a new build identity.
- Reuse preliminary compilation where practical without making a small diagnostic check expensive for that purpose. Set concurrency from
  actual CPU, memory, disk pressure and shared leases; use [Delegation and integration](delegation.md#connecting-downstream-work-and-reporting-results).
  Final frozen-input, provenance, completed-artifact and exact-package checks remain mandatory; preparation alone is not final acceptance.

<a id="테스트-준비와-제품-빌드의-구분"></a>
## Distinguishing Test Preparation from Product Builds

- Keep test execution plans and results separate from product build execution plans and results. If tests require compilation, record the target inputs,
  settings, actual commands, exit codes and elapsed time as preparation, separately from test execution. Successful test preparation compilation
  or partial checks do not mean the complete product build succeeded. Record overall wall time separately, distinguishing dependency and resource
  waits from execution; overlapping durations must not be added into overall elapsed time. Follow the existing
  [coordination and timing guidance](delegation.md#connecting-downstream-work-and-reporting-results) without creating another reporting system.
- Consult passing evidence before preparing test compilation; prepare missing or affected checks with their exact original settings,
  grouping only compatible work. Keep unaffected prepared artifacts across retries. Apply this through the project's existing commands;
  a separate scheduler is not required. Review one-off verification artifacts after results and required rechecks under the lifecycle rules below.

<a id="산출물캐시백업의-보호와-정리"></a>
## Protection and Cleanup of Artifacts, Caches and Backups

- Before execution, register generated paths, bundles with a single owner and active references, and update them through failures, cancellations and unconfirmed termination.
  Follow [Artifact lifecycle](artifact-lifecycle.md) and the project lifecycle playbook for task/run, version and shared paths, and migration of existing projects.
  For registered bundles, use that reference's management-tool workflow and reuse its evidence; investigate only checks outside the tool's coverage or concrete conflicts and uncertainty.
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
- Immediately before deletion, have the owning tool recheck actual paths, links, management-root boundaries and protection, execution and recovery references within its coverage; resolve uncovered checks without repeating covered ones. Only for generated items the model has chosen to delete,
  whose ownership, creation basis and distinction from originals are confirmed, clear ReadOnly or Hidden attributes if needed, then delete normally.
  Do not change attributes of originals, user files or unconfirmed items. Changing System attributes, ACLs or owners and force deletion are prohibited.
  Do not bypass failures through another shell or API.
- Record paths changed, attribute states before and after, actual normal-deletion results and errors, and remaining paths. If rechecking, attribute changes or deletion fail,
  leave the item deferred or failed and recheck current state before retrying. Do not mark a completed cleanup attempt as completed deletion;
  report build and verification results, the model's cleanup decisions and actual cleanup outcomes separately.
