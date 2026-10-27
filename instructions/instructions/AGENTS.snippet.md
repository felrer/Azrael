## UI Design (All Agents)

- Use OpenAI-style UI design unless the user explicitly requests another style. Before UI work, read `CODEX_HOME/skills/implementation/references/ui.md` and the project UI contract.

## Work Entry and Skills (Parent Only)

- Before selecting a skill, identify the current goal, requested deliverable, allowed actions, settled decisions and open questions from the conversation and existing work record. Preserve this context across turns; interpret follow-ups within it. A mention of a skill or a needed change does not authorize execution. Clarify only when an unresolved interpretation changes scope or authority.
- Choose one of two work-entry routes: `design-collaboration` when linked user choices need iterative discussion, or `development-workflow` when investigation can produce a work plan with questions and recommendations. Technical size alone does not choose the route. Keep transitions in the same work record, carry prior decisions and authority forward, and do not restart approval because the skill changes.
- Select `design-collaboration` for unresolved design choices, `design-documentation` for recording agreed design in its owning documents, and `implementation` for execution preparation, implementation, verification, and cleanup. These are cooperating responsibilities, not four mandatory sequential stages. Use existing project design-discussion guidance within the same work; do not invent a second plan, design document, or approval stage.
- Use `implementation` to execute the agreed plan within existing authority. Small work uses a proportionate short plan without an extra approval wait when no review is needed. Specialized skills support the current task; selecting or reading them does not change its phase, scope or authority.
- Use `project-bootstrap` when explicitly asked to initialize or align project documentation. Preserve existing content and routing; it does not scaffold application code or copy common implementation rules into project playbooks.
- Keep all six core skills installed together with their supporting resources. Read the selected skill's actual instructions before applying it.

## Testing (All Agents)

- For selecting, writing, running, reviewing, consolidating or retiring tests, apply `CODEX_HOME/skills/testing/SKILL.md` together with project-specific verification requirements.

## Platform Scope (All Agents)

- Before choosing implementation scope, classify requirements as common across the project's supported or intended platforms, scoped to named environments, mixed, or unresolved. For scoped or mixed behavior, name relevant OS, CPU, version/ABI, local/remote execution, desktop conditions, exclusions and user-visible differences; separate common meaning from platform-specific implementation.
- Keep requested targets, implementation ownership, regression impact and actually verified environments distinct in the current record and delegated work. Do not infer scope from the current host; keep intended support separate from verified support. Investigate facts and reuse settled decisions. Resolve consequential open changes to support, behavior or authority with recommendations and impacts through the existing work process; this adds no plan or approval stage.

## Build Inputs (All Agents)

- Before building, packaging, verifying a build or installing it, read `CODEX_HOME/skills/implementation/references/build-inputs.md` and the applicable project build playbook.

## Document Editing (All Agents)

- Update current document content in place. For document changes, apply the installed `implementation` skill’s document guidance and the project documentation owner.

## Evidence and Tool Output (All Agents)

- Before implementing new functionality, check existing project code, standard-library or platform features, installed dependencies, and mature libraries for reusable solutions.
- Keep the confidence and scope of conclusions within the available evidence. Do not treat a lack of verification as proof of impossibility, or a tool's presence as proof that it works. When user descriptions, screenshots, or execution results conflict with an existing conclusion, reassess the affected claims and clearly state any corrections and remaining uncertainty.
- Identify the question and owning paths or symbols before reading. If ownership is unknown, locate it first, then read the smallest complete relevant sections and direct dependencies. Complete mandatory instruction reads.
- Parallelize independent operations when useful. Bound the combined returned output before execution and keep it focused on decision-relevant evidence; do not return whole files, broad diffs, or raw logs when precise references suffice. Do not rely on truncation as the primary filter. If output is truncated, retrieve the missing evidence with narrower reads. Save broad Git status output to a task-specific file and return only the relevant paths or counts.
- On Windows, pass directories and `-g` filters to ripgrep instead of wildcard positional paths: use `rg -n 'PATTERN' scripts -g 'inject-*.cjs'`, not `rg -n 'PATTERN' scripts/inject-*.cjs`.
- Reuse sufficient prior evidence. Revisit it when inputs change, coverage is insufficient, conflicting evidence appears, or integration creates a new risk.
- Preserve verbose execution logs in task-specific files. For successful tests and builds, return the executed scope, outcome, actual exit code, and log or artifact paths. For failures, return failing targets, the first causal error, and the stack or context needed to diagnose it; inspect additional log sections only as needed. Omit routine progress and repeated diagnostics from summaries while preserving required evidence and project retention and cleanup rules.

## Worktree Lifecycle (All Agents)

- Before creating or using a task worktree, read `CODEX_HOME/skills/implementation/references/worktrees.md`. Integrate and verify all changes, then delete the worktree and verify removal before completion.

## Delegation and Integration (Parent Only)

- Delegate bounded independent work when useful. Before dispatch, read `CODEX_HOME/skills/implementation/references/delegation.md`; the parent owns shared contracts, integration and final acceptance. Children are not authorized to delegate.

## File Deletion (All Agents)

- Delete task-owned disposable material as soon as its current use ends, after success, failure or cancellation, and verify actual removal. When user verification is needed, follow `CODEX_HOME/skills/implementation/references/artifact-lifecycle.md#user-confirmation-and-cleanup`: announce only the necessary check/recovery bundle, including backups, with exact paths/groups, purpose, known size and deletion after the user confirms normal operation. Keep the task awaiting user confirmation with cleanup pending; on confirmation, recheck protections and finish cleanup without another cleanup request. Other leftovers require explicit user retention approval before task completion; a reason or defer decision alone is insufficient. Preserve protected/uncertain items and reuse unchanged explicit approval. `CODEX_HOME/skills/implementation/SKILL.md` owns completion and archive exceptions.
- If ordinary deletion of confirmed task-owned disposable material fails, move it safely to the project's `archive/<unique-work-or-run-id>/` and verify integrity and source absence. This is standing authorization for that archive retention; no repeated approval is needed. Record exact paths, failure reason, owner and review/release condition; report archival separately from deletion. Preserve active/protected/uncertain items and all lock, permission and tool boundaries. If movement is unsafe, forbidden or fails, keep cleanup unresolved and request retention approval. Follow the installed `implementation` archive procedure.
- Do not use force-delete options (`Remove-Item -Force`, `rm -f`, `del /f`, etc.) when deleting files or directories. If ordinary deletion fails, investigate the cause; do not add force options or bypass the failure through another shell or API.

## Shared Instruction Maintenance

- Before changing shared instructions, read the active Azrael repository’s `instructions/README.md`. Update its maintained `instructions/` library and related examples; keep active installed copies consistent. Do not mirror updates to the archived Codex Efficient Subagents repository.
