# Project Working Guide

- Review the [documentation guide](docs/README.md) before starting non-trivial work.
- Record detailed designs, code structure, and operational procedures in the appropriate `docs` category rather than at the project root.
- Before substantive work, select applicable [project playbooks](docs/playbooks/README.md). For development work, apply the installed `implementation` skill together with the [Work playbook](docs/playbooks/work.md). Read only matching routes and owner sections.
- Use [Work Artifacts](docs/README.md#work-artifacts) for the configured external work-document owner and active planning conventions.
- Classify each requirement as common to the supported platforms, scoped to named environments, mixed, or unresolved before choosing implementation scope. For scoped or mixed behavior, name relevant OS, CPU, version/ABI, local/remote execution, desktop conditions and exclusions; separate common meaning from platform-specific implementation.
- Keep requested targets, code ownership, regression impact and actually tested environments distinct in the current task record. An unspecified platform does not imply current-host-only scope. Reuse settled decisions; resolve consequential changes to support, behavior or permissions within the same work, with a recommendation and its impact.
- Reuse common product logic and handle platform behavior at its owning boundary. Select verification for the actual change and integration risk, including Windows regression for common changes. Follow the [multi-platform contract](docs/architecture/multi-platform.md); current verified support remains Windows only until target environments pass verification. Do not report untested environments as accepted.
- Distinguish proposed design from verified implementation using [document-state guidance](docs/README.md#document-state-and-ownership).
- Design Azrael UI in the OpenAI style. Before UI changes, apply [UI presentation](docs/architecture/ui-presentation.md).
- For document changes, follow [document state and ownership](docs/README.md#document-state-and-ownership) and update current content in place.

## Instruction Library Ownership

- Before changing shared instructions, read [instruction maintenance](instructions/README.md#provenance-and-maintenance) and update the Azrael `instructions/` library and related examples. Keep active installed copies consistent; the archived shared repository is not a maintenance destination.

## Worktree Lifecycle

- Before task worktree work, read [Worktree lifecycle](docs/playbooks/work.md#worktree-lifecycle). Integrate and verify all changes, then delete the worktree before completion. Follow the [task-level commit policy](docs/playbooks/work.md#작업별-커밋과-완료); remote push, publishing and deployment require separate authority.

## Build and artifact cleanup

- Before building, packaging, installing, updating, rolling back or cleaning generated artifacts, apply the [build playbook](docs/playbooks/build.md). It owns immutable inputs, provenance, protected paths, retention and required cleanup.

## Temporary snippets

- When the user mentions `$merge-project-files`, the `merge-project-files` snippet, `프로젝트 파일 병합`, or `프로젝트 병합`, read and follow `G:\내 드라이브\ObsidianVault\PARA\00 Agents\snippets\merge-project-files.md` for that request only.
- Load only the named snippet. If it is missing, say so instead of searching the Vault or guessing its contents.
- A snippet supplies workflow guidance; it does not grant permissions beyond the user's request.
