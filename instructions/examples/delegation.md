<a id="위임-예시"></a>
# Delegation Examples

Read the [delegation and integration guidance](../skills/implementation/references/delegation.md) before delegating. Also apply the [lifecycle guidance](../skills/implementation/references/worktrees.md) for worktrees, [input freezing guidance](../skills/implementation/references/build-inputs.md) for builds, and [UI verification guidance](../skills/implementation/references/ui.md) for UI work. Pass the applicable constraints and references to workers.

The paths and symbols below are fictional examples for illustration. Replace them with actual project paths.

<a id="직접-처리할-때"></a>
## When to Handle Work Directly

The parent directly handles looking up one setting, making a short edit to a known file, or summarizing evidence already obtained, because writing a delegation handoff and integrating results would cost more.

For document edits, update the currently valid content in place. Once the user's answer is settled, remove the question and incorporate the answer into requirements or the plan; do not append dated response records or research logs. Keep history only when change history itself is the objective.

For cleanup of registered build groups, pass the existing group IDs and assign one owner to the supported management-tool review/apply flow. For example, ask an investigator to resolve a reported installation-reference gap rather than enumerate and hash the same registered tree again. Keep the model's scope and delete/defer decision explicit, update changed membership through the tool and obtain fresh review, and reconcile actual results before finalization. A slow in-flight call is not a reason to assign a second scan of its targets. See [artifact lifecycle](../skills/implementation/references/artifact-lifecycle.md#review-and-group-decisions).

Delegating builds or reinstalls does not authorize increasing the app version without user instructions. Distinguish new artifact identifiers from the current app version, replace the installation with a verified package of the same version, and preserve the running runtime, rollback copy and user data.

When assigning build error fixes, specify the target platform and existing engine, feature and UI behavior to preserve. Resolve platform-specific errors at that platform's boundary. If behavior changes on other platforms are unavoidable, require the worker to report the impact and alternatives to root and obtain user instructions before applying them. Workers return the reason for each fix, before and after behavior, removal or replacement of existing patches, platform impact, and verified and unverified scope; root reports these to the user at completion. A completion report does not replace prior confirmation of changes outside the authorized scope.

<a id="worktree에서-작업할-때"></a>
## When Working in a Worktree

When assigning a build, freeze the source, scripts, lockfiles and inputs selected at the start, including selected uncommitted changes, and pass that snapshot and its identifiers. Use the same snapshot for packaging, verification and installation; incorporate later changes to the main checkout in the next build. Do not update the inputs or restart a running build to follow concurrent changes. Fixing an error in the frozen inputs starts a new build with new input identifiers.

If a task worktree was created, integrate all changes, including uncommitted changes, into the main checkout (`main` or the repository's existing main branch), resolve conflicts and verify the integrated result. Preserve existing changes. After integration, **always delete** that worktree without exception, and confirm removal of both its Git registration and actual directory. First retain required source provenance records and reusable build caches outside the worktree. Integration and deletion do not authorize commits or publishing.

When delegating, explicitly assign the parent responsibility for confirming final integration and completed deletion. If the user asks for direct work, do not use a separate agent.

<a id="긴-실행과-후속-검증을-연결할-때"></a>
## Connecting Long Executions and Downstream Verification

The following is a fictional build and verification handoff. Confirm actual paths, settings and stage event support before applying it.

```text
Objective: Produce a package for downstream verification from frozen Windows x64 release inputs.
Scope: Own only the designated build and log paths. Do not change existing source or other workers' caches.
Constraints: The downstream consumer is the installation verification owner. Use the frozen source, tools, dependencies and release settings, and hand off the package at a path that remains unchanged while in use after writing is complete. Reuse preliminary check results only when final inputs, environments and scope match.
Done when: Readiness requires package creation, mandatory integrity checks and confirmation of downstream use conditions. Full completion also includes final reporting and assigned cleanup. Package creation does not mean installation verification passed.
Return format: Within the existing role fields, include stage status, fixed package path, hash and input identifiers, satisfied conditions, remaining checks, exit codes and logs. For long executions, briefly report start and end times, reasons for waits and causes of reruns.
```

root prepares the installation verification environment during the build and checks it with a small actual execution. If the current runtime
supports stage events, wait only for the package readiness stage; do not assume ordinary progress messages wake root.
After resuming, confirm actual status and downstream execution conditions. Retain installation verification and final artifact identity checks.
Evaluate effects by total elapsed time; do not sum overlapping build and environment preparation time.

<a id="defer_root-호출-인자"></a>
### Arguments for `defer_root`

When the current tool is supported, wait for the required owner's termination as follows. `resume_after_ms` accepts
1–43,200,000 milliseconds; the example below sets 10 minutes as a fallback resumption time.

```json
{
  "resume_after_ms": 600000,
  "reason": "The research contract must be ready before implementing the caller",
  "wake_on": {
    "agent_paths": ["/root/research"],
    "condition": "all_terminal"
  }
}
```

To specify an absolute time, pass an RFC3339 UTC time (`YYYY-MM-DDTHH:MM:SSZ`) within the next 12 hours
through `resume_at` instead of `resume_after_ms`. Specify only one of these arguments; do not use an argument
named `deadline`. In actual calls, substitute the required owner path and reason for waiting.

<a id="탐색을-맡길-때"></a>
## When Assigning Exploration

The following example assigns independent evidence research to a child while the parent determines implementation scope. Use questions that trace multiple calls and conditions, rather than a one-line lookup.

Prioritize questions blocking the next implementation, and define the initial research scope as a completable unit that establishes the minimum contract needed for downstream execution. In the example below, the first handoff covers the configuration propagation path and defaulting conditions; assign additional research to the same owner as follow-up scope if needed. Continue implementation and verification preparation possible under confirmed contracts, and do not arbitrarily fill unsettled behavior.

Immediately before waiting, record `current prerequisites / independent work to execute immediately / next handoff artifact` in the existing work record as needed. The reason for waiting must identify blocked work and the required artifact. Do not wait after only organizing documents when executable implementation or verification preparation remains, and do not assume ordinary progress reports wake root.

```text
Role: luna_explorer
Objective: Identify how the retry count setting reaches request processing and when defaults apply.
Scope: Read-only research in src/config/ and src/client/.
Constraints: Do not change code, run tests or make design decisions. If dependencies outside scope are needed, report their locations and reasons. Bound the combined output of parallel queries before execution, and retain full Git status and detailed logs in work files. Use directories and -g filters for rg searches on Windows.
References: loadRetryConfig in src/config/retry.ts; sendRequest in src/client/request.ts
Done when: Summarize the path from configuration loading to retry branching, defaulting conditions and unconfirmed parts with evidence.
Return format: STATUS / ANSWER / EVIDENCE / SEARCHED / UNRESOLVED
```

Explicitly set `agent_type="luna_explorer"` on `spawn_agent` and preserve the GPT-6 Luna / xhigh role defaults. Use supported overrides only for a concrete need.

The return example is also fictional.

```text
STATUS: ANSWERED
ANSWER: The value read by loadRetryConfig is passed to sendRequest. Defaults apply only when the setting is unspecified.
EVIDENCE: src/config/retry.ts:loadRetryConfig; src/client/request.ts:sendRequest
SEARCHED: Configuration propagation paths in src/config/ and src/client/
UNRESOLVED: None
```

<a id="구현을-맡길-때"></a>
## When Assigning Implementation

The parent first identifies the conversation's goal, deliverables and permitted actions. Enter through `design-collaboration` when linked user choices require multiple turns of discussion, or `development-workflow` when investigation can produce a plan with an approach and questions. Continue the same work record; `design-documentation` owns agreed enduring design, and `implementation` owns settled implementation, verification and cleanup. Use a short plan for small work, and do not add approval stages through delegation or skill transitions. Workers execute the assigned scope; if design differences or feature reductions are needed, report evidence, alternatives and impact to the parent before the affected implementation. Preserve existing features absent from architecture documentation using code, tests and behavioral evidence.

The parent determines requirements and edit scope from exploration results before handing off. Use `sol_executor` (GPT-6.1 Sol, medium) in both Codex and Azrael. The handling of 0 below is an agreed condition of this example.

```text
Role: sol_executor
Objective: Treat a retry count of 0 as a valid setting in common queue configuration.
Scope: Modify only src/config/retry.ts and tests/retry.test.ts.
Constraints: The required meaning is common to all platforms in the support policy. Apply defaults only for undefined; 0 means no retries. Preserve public function signatures. Do not change OS-specific defaults, storage paths or process code. Record all platforms consuming the common function as regression impact. Preserve other workers' work and existing changes.
References: loadRetryConfig in src/config/retry.ts; tests/retry.test.ts
Done when: The common input/output contract for unspecified, 0 and positive values passes, and report whether platform adapters need additional changes. Distinguish actual OS/CPU, checks and exit codes from unverified scope in other environments. Return discovered OS-specific differences to the parent rather than arbitrarily excluding them.
Return format: STATUS / CHANGED / VALIDATION / UNRESOLVED / ARTIFACTS
```

Optionally add short code snippets, evaluation algorithms, input/output examples or references to existing tests when they help communicate requirements. For example, explain the acceptance criteria above with `undefined → default`, `0 → 0` and `positive number → preserve input value`.

For mixed features, the parent settles the common contract and assigns the worker ownership only of a specific environment's implementation. The following example does not extend acceptance of a Windows backend change to successful native execution on other operating systems.

```text
Role: sol_executor
Objective: Implement the Windows backend for the agreed window capture contract.
Scope: Modify only src/capture/windows.ts and that backend's contract tests.
Constraints: This is a mixed requirement. The parent owns the common approval and response schemas; the worker must not change them. The requested target is user-approved windows on a Windows x64 local interactive desktop. Remote and noninteractive execution and other OS backends are excluded. Record environments consuming the common schema as regression impact, and do not arbitrarily hide differences in permission or desktop conditions. Preserve existing changes and other workers' ownership.
References: src/capture/windows.ts; common approval and response contracts and Windows desktop conditions in docs/capture.md
Done when: Verify the common response contract and native capture and permission behavior on the target Windows environment. Report actual OS/CPU, version, desktop, checks and exit codes, and unverified scope in other environments. Return required changes to other backends or the common contract to the parent.
Return format: STATUS / CHANGED / VALIDATION / UNRESOLVED / ARTIFACTS
```

When delegating UI work, pass the OpenAI style requirement and owning locations of existing pages, setting rows, toggles, buttons and theme tokens to reuse. Completion criteria must include actual rendering in light and dark themes and verification of key interactions. Prioritize a different style if the user requests it.

For a materially different independent objective that warrants delegation, create a fresh child with `fork_turns="none"`. If unsupported, use the smallest supported history scope and disclose the limitation. Send only the delta to the existing owner for corrections and verification of the same objective; do not split coupled work merely because it completed or to refresh context.

Retain detailed execution logs in task-specific files. For successful tests and builds, return executed scope, outcome, actual exit codes and log and artifact paths. On failure, report failing targets, the first causal error and the stack or context needed for diagnosis; read only necessary sections of additional logs.

<a id="설치-후-작은-확인-작업"></a>
## A Small Check After Installation

Replace the exploration example's paths with actual paths in your project and run just one `luna_explorer`. Confirm the selected role and model in the child view, and check that it returned the specified fields and evidence without changing files. If it fails, distinguish and fix role discovery, model access and instruction merging problems. This check is not a token savings experiment.

<a id="부모-판단이-현재-작업을-막을-때"></a>
## When a Parent Decision Blocks Current Work

This example applies when the tools are provided in the current session. Batch related questions and evidence, but do not delay a blocked decision until unrelated work completes.

1. The child reports verification preparation results through `send_message`. Ordinary reports do not guarantee immediate parent resumption.
2. If a decision to replace frozen inputs is needed, the child requests it through `request_parent({request_key: "replace-input-r2", question: "Should verification restart with the corrected inputs?", context: "A required file is missing from the existing inputs.", recommendation: "Freeze the corrected inputs and rerun only affected checks.", blocked_action: "Verification execution using the corrected inputs"})`.
3. Retain the accepted `request_id` and continue authorized independent preparation. When preparation ends and progress requires an answer, use `await_parent_response({request_id})` with the same ID. Do not issue a final or additional wake.
4. The parent checks the authorized scope and answers through `respond_to_request({request_id, status: "resolved", decision: "Freeze the corrected inputs and run only affected checks.", reason: "This is required verification within existing authorization."})`. If user judgment is needed, record `status: "deferred"` with the reason and `retry_condition`.
5. The child proceeds within the explicit answer's scope. Report through final after the entire assignment, verification and cleanup are complete. The engine records wait time; do not add sleeps for logging or repeated polling.

In sessions without these tools, use `send_message` and independent work. When no further progress is possible, end the turn with a `PARTIAL` final stating the completed scope, required decision and resumption conditions. Distinguish source implementation from actual session availability.
