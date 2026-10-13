# Project Working Guide

- Before changing behavior, interfaces, data contracts, build or verification procedures, or runtime operation, use [the docs router](docs/README.md) to select the relevant owners.
- Before substantive work, select applicable [project playbooks](docs/playbooks/README.md) for work principles, verification, and closeout. Use [work documents](docs/work/README.md) for classified work sessions and task plans.
- Read only the applicable routes and owner sections. A precise file or symbol lookup does not require reading every router or category.
- Interpret follow-ups within the current goal, deliverable and allowed actions. Use `design-collaboration` for linked choices requiring iterative discussion or `development-workflow` to write a plan with questions; keep transitions in one work record and execute with `implementation` under existing authority.
- Use architecture together with code, tests and observed behavior to preserve existing features. Review unapproved design deviations or feature reductions before the affected implementation; missing documentation does not authorize removal.
- Distinguish intended behavior from verified implementation using the [document-state guidance](docs/README.md#document-state-and-ownership). Investigate conflicting current-state claims in code or operational evidence.
- Update the smallest document set that owns a changed contract. Keep detailed designs, code maps, and repeatable procedures with their owning documents rather than in root instructions.
