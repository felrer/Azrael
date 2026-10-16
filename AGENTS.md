# Project Working Guide

- Review the [documentation guide](docs/README.md) before starting non-trivial work.
- Record detailed designs, code structure, and operational procedures in the appropriate `docs` category rather than at the project root.
- Before substantive work, select applicable [project playbooks](docs/playbooks/README.md). For development work, apply the installed `implementation` skill together with the [Work playbook](docs/playbooks/work.md). Read only matching routes and owner sections.
- Store new work plans in the project-local `work/` directory configured by [Work Artifacts](docs/README.md#work-artifacts); follow [Work documents](work/README.md) for session and plan usage.
- Apply the global **Platform Scope** rules and Azrael's [multi-platform contract](docs/architecture/multi-platform.md) when selecting scope and verification. That contract owns target support and acceptance status; include Windows regression for common changes.
- Distinguish proposed design from verified implementation using [document-state guidance](docs/README.md#document-state-and-ownership).
- Design Azrael UI in the OpenAI style. Before UI changes, apply [UI presentation](docs/architecture/ui-presentation.md).
- For document changes, follow [document state and ownership](docs/README.md#document-state-and-ownership) and update current content in place.
- When adding, changing or retiring Azrael behavior, update its owning architecture section and connect the preservation scope to implementation owners and mandatory checks through the existing feature inventory. Follow [feature maintenance](docs/architecture/README.md#feature-maintenance) and [upgrade preservation](docs/playbooks/work.md#feature-changes-and-upgrade-preservation); an upstream update must account for existing behavior before acceptance.

## Instruction Library Ownership

- Before changing shared instructions, read [instruction maintenance](instructions/README.md#provenance-and-maintenance) and update the Azrael `instructions/` library and related examples. Keep active installed copies consistent; the archived shared repository is not a maintenance destination.

## Worktree Lifecycle

- Before task worktree work, read [Worktree lifecycle](docs/playbooks/work.md#worktree-lifecycle). Integrate and verify all changes, then delete the worktree before completion. Follow the [task-level commit policy](docs/playbooks/work.md#task-level-commits-and-completion); remote push, publishing and deployment require separate authority.

## Build and artifact cleanup

- Before building, packaging, installing, updating, rolling back or cleaning generated artifacts, apply the [build playbook](docs/playbooks/build.md). It owns immutable inputs, provenance, protected paths, retention and required cleanup.

## Temporary snippets

- When the user mentions `$merge-project-files`, the `merge-project-files` snippet, `프로젝트 파일 병합`, or `프로젝트 병합`, read and follow `G:\내 드라이브\ObsidianVault\PARA\00 Agents\snippets\merge-project-files.md` for that request only.
- Load only the named snippet. If it is missing, say so instead of searching the Vault or guessing its contents.
- A snippet supplies workflow guidance; it does not grant permissions beyond the user's request.
