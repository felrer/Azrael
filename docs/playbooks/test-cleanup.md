# Test Cleanup And Consolidation Playbook

State: `current` policy. Applies to an authorized review, consolidation or retirement of existing tests, fixtures and test-only tooling. It does not authorize a suite-wide sweep during ordinary feature work, or turn a documentation/review request into permission to edit tests. Policy adoption is separate from evidence that a suite has been cleaned up.

The installed `implementation` skill owns [verification selection](../../instructions/skills/implementation/SKILL.md#7-verification-and-test-management) and [cleanup/retention](../../instructions/skills/implementation/SKILL.md#8-정리와-문서-반영). This playbook adds decisions for existing test suites; use [Work](work.md#feature-changes-and-upgrade-preservation) for Azrael preservation obligations and [artifact lifecycle](artifact-lifecycle.md) for generated outputs.

## Scope And Evidence

- Name the authorized subsystem or files, the contracts to preserve, their owners and relevant execution environments in the existing work record. A focused cleanup does not expand into unrelated suites. Record the baseline identity and relevant existing results; rerun only where changed inputs, uncertainty or required checks make that necessary.
- Separate maintained test source from disposable runs, logs, profiles and fixtures. A maintained regression test is not generated disposable material because an agent wrote it, it is old, or it has not failed recently. Source changes follow normal review and version control; generated bundles follow their registered owners and cleanup procedures.
- Read the assertions and actual path through the product, not just test names or coverage lines. Identify the plausible defect the test catches, its input domain, boundary, preparation and platform conditions. Use sufficient existing evidence without demanding a new mutation demonstration for every useful test.
- For a redundancy claim, identify the surviving test and show that its assertions detect the same failure at the required boundary and conditions. Similar names, fixtures, outputs or covered lines are insufficient. A helper unit test and a real entry-point test may protect different risks even when they reach the same function.
- Inspect failures and skipped tests before deciding. Distinguish a product defect, obsolete expectation, test defect and environment limitation. Conditional platform skips and flaky failures are evidence to investigate, not automatic removal candidates. Do not activate expensive or externally mutating tests without their execution prerequisites and authority.

## Decide By Protected Value

Zero deletions is a valid result. Weigh distinct recurring defect detection against execution, diagnosis, review and maintenance costs; reduce unnecessary machinery without discarding needed protection. Test count, file count, coverage percentage, age and test-to-product line ratio are signals, not deletion quotas or proof of equivalent protection. Coverage cannot establish assertion quality; unchanged coverage alone does not justify a deletion.

| Decision | Evidence needed |
| --- | --- |
| **Keep** | It independently protects a current contract or credible failure that other checks do not adequately expose. This includes important authorization, financial, concurrency, migration, protocol, packaging and platform behavior, even before a production incident. |
| **Consolidate** | Cases protect the same contract under compatible setup and execution conditions. A surviving parameterized case or coherent workflow preserves meaningful inputs, assertions, isolation and failure diagnosis. Keep distinct failure paths; do not combine unrelated workflows merely to reduce files. |
| **Rewrite or relocate** | The risk remains valid, but assertions are coupled to internals, a mock supplies the claimed result, or the test sits under the wrong owner. Prefer extending an existing case at the actual boundary. Follow the existing admission criteria for any replacement rather than creating another helper and its test family. |
| **Retire an obsolete contract** | The corresponding behavior was deliberately removed or changed within the agreed scope, and callers, compatibility, recovery paths and required preservation checks no longer rely on it. Update the remaining expectation to the agreed contract; do not remove a still-valid guarantee to silence a failure. |
| **Remove a redundant or non-protective test** | A named survivor already detects the same failure, or the assertions have no independent contract value. Establish the reason from the assertion and product path; do not infer it from the test's style alone. |
| **Defer an uncertain decision** | State the concrete missing evidence or owner decision and the condition for reconsideration. Preserve the test while uncertainty remains; a deletion target never overrides it. |

Review candidates include self-comparisons, expected values copied from the implementation, mock echoes, assertion-free coverage probes and tests that only mirror changed source text or inventory counts. These patterns are prompts for investigation, not blanket bans: exact public values, serialized output, security allowlists and generated artifacts may themselves be the contract. An internal call sequence may matter when its order has an observable effect.

## Apply A Bounded Change

1. Record the affected contract, decision, reason and surviving protection in the existing work record or change description. Name only affected cases; create no separate admission form or inventory of every unchanged test. A review-only task ends with findings.
2. Make a coherent change within authorized scope. Remove obsolete test-specific setup, fixtures, exports and runner references only after checking real consumers, including generated, dynamic and external/public uses. Do not change production behavior merely to make test cleanup easier.
3. Preserve [feature inventory](../../scripts/azrael-feature-contracts.json) obligations. An authorized test cleanup does not by itself authorize dropping a mandatory check, supported platform, public contract or success criterion. Resolve any such scope change before the affected removal and update its owning design and check mapping together. Keep otherwise-required checks enabled.
4. Use supported writers for registered bundle and reference changes under [project maintenance operations](../ops/project-maintenance.md). Do not edit generated registries to bypass protection or treat maintained source tests as generated deletion targets. Generated-output deletion also follows [Build and reinstall](build.md); ordinary source edits do not require a product build.

## Verify The Surviving Protection

- Select the smallest relevant owner and integration checks for the actual change, plus required project gates. Confirm the selected tests really ran: an empty match, disabled suite, removed registration or zero-test success is not evidence that the protected behavior passes.
- Verify retained input cases and assertions, and the real runtime or entry-point wiring where it was the original risk. Use a focused controlled fault or red/green check only when needed to resolve a concrete uncertainty about the replacement; require no suite-wide mutation campaign. A one-time successful product run cannot replace needed recurring detection of a rare fault.
- If coverage is already a required gate, keep its agreed command and threshold. Inspect any lost branch or contract protection rather than accepting a global percentage as proof. Do not introduce a coverage tool, blanket rerun or new replacement tests solely to make cleanup look verified.
- Common changes retain Windows regression and required target checks under the [multi-platform contract](../architecture/multi-platform.md#installation-update-and-verification). Report requested targets separately from environments actually checked. Reuse results only while their inputs, environment and coverage of the claim remain sufficient.
- Resolve new failures and unexplained regressions before claiming completion. If a required environment is unavailable, report the gap and preserve the affected protection; lack of access does not establish redundancy. Do not lower correct expectations, gates or product safeguards to produce green results.

## Closeout And Artifact Cleanup

Report affected scope and decisions, named surviving protection, executed commands and actual exit codes, unresolved evidence gaps, and actual removed/remaining paths. Distinguish source retirement from generated-output deletion and a reported finding from an applied change. Report runtime or maintenance savings as measured only when measured; fewer tests alone is not a measured speedup.

Clean task-owned disposable probes and run artifacts after review, diagnosis and required rechecks through [artifact lifecycle](artifact-lifecycle.md#normal-operations). Preserve active/uncertain references and the existing ordinary-deletion, archive and explicit retention-approval rules. A defer record does not authorize retaining cleanup-scope artifacts. Conversely, an unchanged maintained test that remains in the suite is source, not a disposable leftover requiring new retention consent.

Document-only changes to this playbook need document/link and policy-consistency checks, not new tests of the document's wording or structure. Record verification scope and cleanup in the existing work record; follow [task-level commit policy](work.md#task-level-commits-and-completion).
