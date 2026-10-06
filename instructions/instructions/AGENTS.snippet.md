## Work Entry and Skills (Parent Only)

- Use the installed `planning` skill as the entry point for code changes. Carry forward confirmed requirements and authorization; clarify consequential unknowns before implementation without reopening settled decisions.
- Follow planning through requirements and code-grounded feasibility in one work plan, relevant design updates with `designing`, implementation, and verification. Do not invent a second plan or a design document merely to satisfy a workflow step.
- Use `project-bootstrap` when explicitly asked to initialize or align project documentation. Preserve existing content and routing; it does not scaffold application code.
- Keep the three skills installed together with their supporting resources. Read the selected skill's actual instructions before applying it.

## Document Editing (All Agents)

- Update the document's current content in place. Integrate confirmed answers into the relevant section; remove resolved questions, superseded text, and duplicates. Do not append response histories, dated confirmation notes, copied investigations, or detailed logs unless that history is itself the document's purpose. Keep only content needed to understand, execute, or verify the current work.

## Evidence and Tool Output (All Agents)

- Before implementing new functionality, check existing project code, standard-library or platform features, installed dependencies, and mature libraries for reusable solutions.
- Keep the confidence and scope of conclusions within the available evidence. Do not treat a lack of verification as proof of impossibility, or a tool's presence as proof that it works. When user descriptions, screenshots, or execution results conflict with an existing conclusion, reassess the affected claims and clearly state any corrections and remaining uncertainty.
- Identify the question and owning paths or symbols before reading. If ownership is unknown, locate it first, then read the smallest complete relevant sections and direct dependencies. Complete mandatory instruction reads.
- Parallelize independent operations when useful. Bound the combined returned output before execution and keep it focused on decision-relevant evidence; do not return whole files, broad diffs, or raw logs when precise references suffice. Do not rely on truncation as the primary filter. If output is truncated, retrieve the missing evidence with narrower reads. Save broad Git status output to a task-specific file and return only the relevant paths or counts.
- On Windows, pass directories and `-g` filters to ripgrep instead of wildcard positional paths: use `rg -n 'PATTERN' scripts -g 'inject-*.cjs'`, not `rg -n 'PATTERN' scripts/inject-*.cjs`.
- Reuse sufficient prior evidence. Revisit it when inputs change, coverage is insufficient, conflicting evidence appears, or integration creates a new risk.
- Preserve verbose execution logs in task-specific files. For successful tests and builds, return the executed scope, outcome, actual exit code, and log or artifact paths. For failures, return failing targets, the first causal error, and the stack or context needed to diagnose it; inspect additional log sections only as needed. Omit routine progress and repeated diagnostics from summaries while preserving required evidence and project retention and cleanup rules.

## Worktree Lifecycle (All Agents)

- When a task uses a newly created worktree, integrate all of its changes into the primary checkout (`main`, or the repository's existing primary branch), preserve existing work, resolve conflicts, and verify the combined result before task completion. Uncommitted changes must also be integrated.
- You MUST delete the task worktree after integration, without exception. Verify that both its Git worktree registration and its directory are gone. Preserve required provenance and reusable build caches outside the worktree before deleting it.
- These requirements do not authorize commits or publishing; follow the user's existing instructions for those actions.

## Delegation and Integration (Parent Only)

These rules authorize the parent to delegate suitable independent work. They do not authorize children to delegate.

- Delegate bounded, independent work when parallel progress or isolation materially helps. Handle single lookups and small edits directly when delegation would cost more than completion. A concurrency limit is a ceiling, not a quota.
- Always set `agent_type` explicitly on `spawn_agent`; never rely on the default role, which inherits the parent model and full history and has been observed crashing the inference helper. Use `luna_explorer` (GPT-6.1 Sol, low) for read-only evidence retrieval within named boundaries and `sol_executor` (GPT-6.1 Sol, medium) for settled implementation and validation in Codex and Azrael. Select `devin_swe2_medium` only when explicitly requested by the user. Preserve role-owned model and reasoning defaults; use supported overrides only for a concrete need. Keep requirements, architecture, shared interfaces, authority, and final acceptance with the parent.
- Resolve shared contracts and exclusive write ownership before dispatch. Do not parallelize tasks that depend on an unresolved decision. Tell workers they share the workspace and must preserve existing and concurrent work.
- Use this handoff contract: Objective (one outcome), Scope (read boundary and owned files), Constraints (agreed behavior, interfaces and authority limits), References (exact paths or symbols), Done when (observable completion criteria), Return format (the selected role's fields). Pass decisions and references rather than full conversations or copied documents. State these requirements together in natural language when delegating. When useful for communicating requirements efficiently, optionally include short code snippets, evaluation algorithms, input/output examples, or references to existing tests.
- For a materially different independent objective that warrants delegation, create a fresh child with `fork_turns="none"`. If unsupported, use the smallest supported history scope and disclose the limitation. Reuse the same child for corrections and validation of its objective; send only the delta. Completion alone does not require another child. Do not split coupled unfinished work merely to refresh context.
- Dispatch already-decided independent tasks together. Send dependent instructions only after the required result arrives.
- After delegation, all root status checks are prohibited until the worker reports completion or a blocker. This includes messages, status queries, and indirect checks through files, logs, or processes. Root must perform independent work or wait for completion events. Maintain user-facing progress from already available task state and completion notifications; avoid acknowledgement-only messages.
- Intervene before completion only for changed user requirements, confirmed requirement or contract errors, risk of data loss, or expiry of a predefined time limit. After completion, review the results and consolidate necessary correction requests into one handoff.
- Reuse adequate child evidence without repeating its investigation. Review the combined result and run additional checks only for uncovered requirements or distinct integration risks.
- Maintain a compact current-state record when it helps continuation: decisions, ownership, completed evidence, next action, and unresolved items. Do not accumulate conversation diaries or duplicate logs.
