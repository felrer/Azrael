---
name: testing
description: Select verification for the current change, write and run one-off or retained tests, and retain tests that prevent your recurring work mistakes. Use for test decisions during implementation or authorized test maintenance.
---

# Testing

## Scope And Ownership

Own verification selection, test writing and execution, and retention, consolidation and removal decisions within the agreed task. Use the existing work record; create no separate testing plan or approval stage.

The work-entry skills and `implementation` own task scope, execution authority, overall acceptance and artifact cleanup. Project guidance owns mandatory checks, commands, supported platforms and build/package procedures. Change mandatory requirements through their owning documents and agreed authority.

A review request alone does not authorize edits or test execution. Ordinary feature work does not authorize unrelated suite-wide cleanup.

## Select The Minimum Sufficient Evidence

Name what this change must verify and the relevant boundary and conditions. **Verification of this change and permanent retention of its checks are separate decisions.**

Inspect existing checks and results before creating a new check. Reuse sufficient checks unchanged. Zero new test files, cases or assertions is a valid outcome.

If existing evidence is insufficient, select the smallest method that resolves the gap. Manual verification, static analysis, a one-off test or a short probe may suffice. Not every change needs a one-off test.

For ordinary product defects, prioritize a fast build and the user's real-use feedback after minimal verification of the change. Do not accumulate automated tests for broad defect detection. State what is left to real use, and do not report that verification as complete before it happens.

Test count, coverage percentage and test-to-product size ratios inform decisions; they are not creation, retention or deletion quotas.

<a id="admit-and-write-durable-tests"></a>

## Decide Which Tests To Retain

**The primary purpose of tests you retain is to prevent omissions or incorrect changes you may repeat in future work.** Ask:

> After fixing this code, what could I do in a later task that would recreate this mistake?

"This feature is important", "this found a meaningful bug", "it might break someday" and "regression protection" are not sufficient reasons for permanent retention. This does not mean skipping one-off verification needed for the current fix.

Distinguish what remains after the fix:

- **A step you must repeat during future work:** build inputs, packaged files, registrations, configuration forwarding or related callers must be handled again in later work. If the workflow leaves a concrete opportunity for you to repeat the omission, retain a small direct check. Do not add another test if the existing build or tooling already detects it.
- **An implementation or design error removed by the fix:** correct the condition, calculation, state transition or responsibility boundary and verify the change. If the corrected structure leaves no concrete recurrence path, do not retain a permanent test.
- **An error you could recreate through a specific later edit:** for example, simplifying away a compatibility branch or required exception. Identify that edit and retain only the smallest check that detects it. The label "implementation error" alone does not settle retention.

Apply the same criterion to new tests, existing tests and promotion of one-off checks. Weigh the mistake prevented against execution, diagnosis, review and maintenance costs. First consider whether an existing check suffices or an existing case can be extended.

State the retention reason briefly in the existing work record or change description. Require no admission form or additional approval ritual.

## Common Writing And Execution Rules

These rules apply to both one-off and retained tests.

### Write Checks

Derive expected results from agreed requirements independently of the implementation being checked. Assert observable behavior at the relevant boundary.

Avoid self-comparisons, mock echoes and checks of source wording, internal call sequences, snapshots or inventory counts unless those details are themselves required behavior.

Preserve exact values, ordering or serialization when public behavior, security, financial operations or protocols depend on them. Do not weaken valid expectations to avoid brittleness.

When the actual entry point, backend or persistence boundary is the subject of verification, exercise it in an authorized environment. If real execution is unavailable, report the gap. Do not construct a large mock suite to prove an unexercised integration.

Growing mock or helper machinery is a reason to reconsider the boundary, fixture or method.

<a id="execute-and-reuse-evidence"></a>

### Execute And Reuse Results

Check prerequisites before expensive execution. Reuse existing results when input identity, environment, provenance and coverage remain sufficient. Rerun affected checks for relevant input changes, conflicting evidence, concrete uncertainty or mandatory execution requirements.

Distinguish compilation needed to prepare tests from a separate product build. The former does not authorize the latter.

Confirm that selected tests actually ran and inspect their terminal results. An empty match, zero-test success, skipped target, pending session or successful tool dispatch is not a passing behavioral check.

Identify whether a failure comes from the product, expectation, test or environment before choosing a correction.

Use a focused controlled fault or red/green check only when it resolves a concrete uncertainty about whether the check detects the defect. Require no blanket mutation campaign or ceremonial reproof.

Instruction wording checks do not prove changed work behavior. Verify relevant conversations before claiming that effect.

Keep intended platform support and actual verification separate. Do not extrapolate a pass to another OS, CPU, ABI or local/remote environment.

<a id="maintain-consolidate-and-retire"></a>

## Maintain Tests And End Their Use

### Existing Tests

Within authorized test-maintenance scope, apply the same retention criterion to keep, consolidate or remove tests. Remove tests that do not meet it after any needed one-off verification, or move their verification to real use.

When consolidating tests while claiming equivalent protection, name the surviving check and establish equivalent detection at the relevant inputs, boundary and execution conditions.

When deliberately reducing automated coverage under agreed criteria, report the reduction and selected verification method. Do not require an equivalent automated replacement or call real-use feedback equivalent recurring detection.

Distinguish test removal from retiring product behavior. A feature may remain while its automated test is removed. Retiring the product requirement itself needs the corresponding change authority and checks of callers, compatibility, recovery and mandatory requirements.

Do not restore obsolete behavior merely for an old test or delete a valid product requirement to silence a failure.

### One-Off Tests

Clean up one-off tests and probes after reviewing their results and completing necessary rechecks. Success or discovery of a meaningful bug does not automatically promote them to retained tests.

Continued retention must meet the same recurrence criterion above.

### Execution Artifacts And Shared Resources

Retaining test source and retaining its logs, temporary fixtures or reports are separate decisions. Execution artifacts follow their existing artifact owner's cleanup procedure.

Before removing test-only helpers, fixtures or registrations, check their actual consumers. Verify that surviving checks remain connected and execute the needed cases.

Material needed for active execution, diagnosis, recovery or user confirmation follows `implementation`'s existing retention and cleanup procedures. Do not delete maintained test source as if it were generated disposable output.

## Report And Close

Record briefly in the existing work record:

- The behavior checked, actual executed scope and results including exit codes, and environments.
- Retained tests and the concrete mistakes you could repeat.
- Automated coverage removed or reduced, and what moved to one-off verification or real use.
- Unverified items and cleanup status.

Record replacement checks only when they actually exist. Distinguish proposed findings from applied changes and expected savings from measured savings.

Review results and complete needed failure diagnosis and rechecks, then clean up unnecessary material through its existing owner and verify actual removal. Passing tests alone do not authorize deleting protected material. Overall completion remains with the existing work owner.
