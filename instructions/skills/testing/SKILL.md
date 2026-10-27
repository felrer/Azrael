---
name: testing
description: Select, write, run, review, consolidate and retire tests using minimum sufficient evidence and ongoing contract value. Use for test decisions during implementation or authorized maintenance of existing test suites.
---

# Testing

## Scope And Ownership

- Own test selection, admission, assertions, execution evidence, consolidation and retirement within the agreed task. Use the existing work record; create no separate testing plan or approval stage. A review request does not authorize edits or execution, and ordinary feature work does not authorize a broad suite cleanup.

- The work-entry and implementation skills retain scope, authority, overall acceptance and artifact cleanup. Project playbooks retain mandatory checks, commands, supported platforms and build/package procedures. Apply their constraints; this skill does not waive them or grant deletion authority.

## Select The Minimum Sufficient Evidence

- Name the changed contract, a meaningful failure and the boundary and conditions where it must be detected. Separate proof of the current fix from ongoing regression protection. Inspect existing checks before generating tests; reuse sufficient tests unchanged. Zero new test files, cases or assertions is a valid outcome.

- Choose the smallest checks that cover the claim, plus required project gates. Select by behavior and risk rather than a fixed test pyramid. Manual verification, static analysis or a disposable probe may suffice for a bounded claim; they do not replace needed recurring detection of rare or critical faults.

- Prefer the actual entry point, backend or persistence boundary when that is the risk, in an authorized environment; production access is not required. If real execution is unavailable, report the gap. Do not construct a large mock suite as substitute proof of an unexercised integration.

- Test count, coverage percentage and test-to-product size ratios are diagnostic signals, not creation, retention or deletion quotas. Preserve already-required thresholds and checks. Critical authorization, financial, concurrency, migration, protocol, packaging and platform risks may justify proactive protection without a prior incident.

## Admit And Write Durable Tests

- Add a retained test only for an identified gap with distinct recurring defect-detection value that justifies execution, diagnosis, review and maintenance costs. First consider extending an existing case. State the reason briefly in the existing work record or change description; require no admission form or additional approval ritual.

- A bug fix does not automatically need a new test file, and a successful one-off probe does not automatically become a permanent test. Retain a probe only when it meets the same ongoing-value criterion. Follow implementation's cleanup and retention rules for disposable material.

- Derive expected results from the agreed contract, independently of the implementation being checked. Assert observable behavior at the relevant boundary. Avoid self-comparisons, mock echoes and checks of source wording, internal call sequences, snapshots or inventory counts unless those details are themselves a required contract.

- Preserve exact values, ordering or serialization when public, security, financial or protocol behavior depends on them. Do not weaken valid expectations to avoid brittleness. Growing mock or helper machinery is a reason to reconsider the boundary, fixture or probe, not to generate another family of helper tests.

## Execute And Reuse Evidence

- Check prerequisites before expensive execution. Reuse prior results only when input identity, environment, provenance and coverage of the claim remain sufficient; rerun affected checks for changed inputs, conflicting evidence, uncertainty or required gates. Test preparation may compile dependencies; it does not authorize a separate product build.

- Confirm that selected tests actually ran and inspect their actual exit codes and terminal results. An empty match, zero-test success, skipped target, pending session or successful tool dispatch is not a passing behavioral check. Investigate failures as product, expectation, test or environment problems before choosing a correction.

- Use a focused controlled fault or red/green check when it resolves a concrete uncertainty about whether an assertion detects the defect. Require no blanket mutation campaign or ceremonial reproof of useful existing tests. Instruction or skill wording checks do not prove changed agent behavior; verify relevant conversations before claiming that effect.

- Keep intended support and actual verification separate. Preserve required platform regressions, and do not extrapolate a host result to another OS, CPU, ABI or local/remote environment. Report unavailable required environments as gaps rather than weakening the contract.

## Maintain, Consolidate And Retire

- Judge existing tests by the current contract and distinct protection relative to lifecycle cost. Keep, consolidate, rewrite or relocate, retire an obsolete contract, remove redundant or non-protective tests, or defer an uncertain decision. A name, age, recent failure or similar coverage does not settle that decision.

- For claimed redundancy, name the surviving check and establish equivalent defect detection at the required inputs, boundary and execution conditions. Consolidation must preserve meaningful cases, assertions, isolation and diagnosis. A one-time successful run is insufficient evidence of equivalent recurring protection.

- Retire a contract only when its removal or replacement is within agreed scope and callers, compatibility, recovery and mandatory checks no longer require it. Do not restore obsolete behavior merely for an old test or delete a valid contract to silence a failure. Preserve uncertain protection and state the evidence or owner decision needed to reconsider it.

- Remove test-only helpers, fixtures and registrations only after checking their actual consumers. Verify that surviving checks remain connected and execute meaningful cases. Maintained test source follows source-change authority; disposable run outputs follow their artifact owners. Do not treat retained source as generated cleanup material.

## Report And Close

- Record the affected contract, selected evidence, any retained-test or retirement reason, actual executed scope and exit codes, surviving protection, checked environments and gaps in the existing work record. Link detailed logs when needed. Distinguish proposed findings from applied changes and measured savings from expected savings.

- Review results, diagnose failures and perform required rechecks before releasing disposable probes or evidence. Then use the existing cleanup owner and retention rules, verifying actual removal. Passing tests alone never authorize deleting protected material. Overall completion remains with the existing work owner.
