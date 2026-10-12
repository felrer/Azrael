## UI Design (All Agents)

- Use OpenAI-style UI design unless the user explicitly requests another style. Before UI work, read `CODEX_HOME/skills/implementation/references/ui.md` and the project UI contract.

## Work Entry and Skills (Parent Only)

- Use the installed `development-workflow` skill to lead complex code changes: requirements, scope, investigation, decisions, progress, and final acceptance. Carry forward confirmed requirements, records, and authorization; clarify consequential unknowns without reopening settled decisions.
- Select `design-collaboration` for unresolved design choices, `design-documentation` for recording agreed design in its owning documents, and `implementation` for execution preparation, implementation, verification, and cleanup. These are cooperating responsibilities, not four mandatory sequential stages. Use existing project design-discussion guidance within the same work; do not invent a second plan, design document, or approval stage.
- Use `implementation` directly for clear, small changes. Reuse existing decisions and execution authority; return only missing consequential decisions to the parent or user as appropriate.
- Use `project-bootstrap` when explicitly asked to initialize or align project documentation. Preserve existing content and routing; it does not scaffold application code or copy common implementation rules into project playbooks.
- Keep all five skills installed together with their supporting resources. Read the selected skill's actual instructions before applying it.

## Platform Scope (All Agents)

- Before implementation, classify each requirement as common across the supported platforms, scoped to named environments, mixed, or unresolved. For scoped or mixed behavior, name relevant OS, CPU, version/ABI, local/remote execution, desktop conditions and exclusions; separate common meaning from platform-specific implementation.
- Carry agreed requirement targets, implementation ownership, regression impact and required verification into the current task record and delegated work. Do not infer scope from the current host or treat untested environments as accepted. Reuse settled decisions and the work skills' existing process for consequential unresolved choices; this check adds no plan or approval stage.

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

- Do not use force-delete options (`Remove-Item -Force`, `rm -f`, `del /f`, etc.) when deleting files or directories. If ordinary deletion fails, investigate the cause; do not add force options or bypass the failure through another shell or API.

## Shared Instruction Maintenance

- Before changing shared instructions, read the active Azrael repository’s `instructions/README.md`. Update its maintained `instructions/` library and related examples; keep active installed copies consistent. Do not mirror updates to the archived Codex Efficient Subagents repository.
