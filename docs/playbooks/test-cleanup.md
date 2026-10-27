# Test Cleanup And Consolidation Playbook

State: `current` project procedure for applying the [testing skill](../../instructions/skills/testing/SKILL.md) to an authorized review, consolidation or retirement of Azrael tests, fixtures and test-only tooling. Policy adoption is separate from evidence that a suite has been cleaned up.

The testing skill owns common [scope and authority](../../instructions/skills/testing/SKILL.md#scope-and-ownership), [test decisions](../../instructions/skills/testing/SKILL.md#maintain-consolidate-and-retire), [execution evidence](../../instructions/skills/testing/SKILL.md#execute-and-reuse-evidence) and [reporting](../../instructions/skills/testing/SKILL.md#report-and-close). Use those common criteria directly; this playbook adds Azrael mappings and procedures. The installed `implementation` skill owns [overall verification](../../instructions/skills/implementation/SKILL.md#7-verification-and-test-management) and [cleanup/retention](../../instructions/skills/implementation/SKILL.md#8-정리와-문서-반영).

## Scope And Preservation Mapping

- Use the existing work record to connect the affected subsystem and contracts to their architecture owners, implementation owners and mandatory checks in the [feature inventory](../../scripts/azrael-feature-contracts.json). Apply [Work preservation](work.md#feature-changes-and-upgrade-preservation) when a proposed retirement changes that mapping; test maintenance does not itself retire a feature or mandatory gate.
- Identify the runner and registration owner for affected source tests. [Source test operations](../ops/development.md#source-test-scope) and `scripts/source-test-policy.cjs` own Azrael's conditional source selection; engine checks use their registered functional bundles. Preserve the applicable selection and platform conditions when mapping a survivor.
- Maintained source changes use normal review and version control. Generated groups, disposable runs and logs use [project maintenance operations](../ops/project-maintenance.md) and [artifact lifecycle](artifact-lifecycle.md). Do not submit maintained source tests as generated deletion targets.

## Apply The Decision

1. Apply testing's maintenance criteria to the affected cases and record the decision and surviving protection in the existing work record or change description. A review-only task reports findings; source edits use the task's existing execution authority.
2. Update the affected source, fixture/helper consumers, runner registrations and preservation mappings together through their actual owners. Follow [feature maintenance](../architecture/README.md#feature-maintenance) for an agreed contract change, including its mandatory checks.
3. Use supported writers for registered bundle and reference changes under [project maintenance operations](../ops/project-maintenance.md). Generated-output deletion also follows [Build and reinstall](build.md); ordinary source edits do not require a product build.

## Verify And Close

- Select concrete source, engine and integration checks through [Work](work.md#feature-changes-and-upgrade-preservation), [source test operations](../ops/development.md#source-test-scope) and [Build preflight](build.md#build-preflight-and-artifact-dependencies). Apply testing's execution and reuse criteria to their results. Keep the existing Cargo prerequisite helper and bundle contract.
- Select required target and Windows regression checks through the [multi-platform contract](../architecture/multi-platform.md#installation-update-and-verification). Use the exact-package and host stages in Build when the task includes their acceptance; source maintenance alone does not select a distribution build or installation.
- Follow testing's closeout reporting, distinguishing applied source retirement from generated-output deletion. Reconcile actual generated-group outcomes through [artifact lifecycle](artifact-lifecycle.md#normal-operations) and the existing cleanup owner. Keep task-level commits under [Work](work.md#task-level-commits-and-completion).
