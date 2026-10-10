# Project Working Guide

- Review the [documentation guide](docs/README.md) before starting non-trivial work.
- Record detailed designs, code structure, and operational procedures in the appropriate `docs` category rather than at the project root.
- Before substantive work, select applicable [project playbooks](docs/playbooks/README.md). For development work, apply the installed `implementation` skill together with the [Work playbook](docs/playbooks/work.md). Read only matching routes and owner sections.
- Use [Work Artifacts](docs/README.md#work-artifacts) for the configured external work-document owner and active planning conventions.
- Distinguish proposed design from verified implementation using [document-state guidance](docs/README.md#document-state-and-ownership).
- Design Azrael UI in the OpenAI style. Reuse the pinned UI's existing page layouts, settings rows, switches, buttons, spacing and theme tokens; verify the actual rendered page in light and dark themes. Follow [UI presentation](docs/architecture/ui-presentation.md) for the project contract.
- When editing any document, update its current content in place. Integrate confirmed answers into the relevant section; remove resolved questions, superseded text, and duplicates. Do not append response histories, dated confirmation notes, copied investigations, or detailed logs unless that history is itself the document's purpose. Keep only content needed to understand, execute, or verify the current work.

## Instruction Library Ownership

- Maintain shared instructions in this repository's `instructions/` directory. `felrer/Azrael` is the active repository; `felrer/codex-efficient-subagents` is archived.
- The former shared checkout is historical import evidence, not an active maintenance destination. Do not mirror new changes there. Preserve recorded source provenance and original notices.
- Keep related examples in `instructions/examples/delegation.md` consistent when changing `instructions/instructions/AGENTS.snippet.md`.

## Worktree Lifecycle

- If you create a worktree for a task, bring all of its changes back into the primary checkout (`main`, or the repository's existing primary branch) and verify the integrated result before completing the task. Preserve existing changes and resolve conflicts; an uncommitted change still must be integrated.
- After integration, you MUST delete that worktree. This cleanup is mandatory without exception; do not leave task worktrees behind. Verify both removal from Git's worktree registry and removal of the worktree directory. Preserve required source provenance and build caches outside the worktree before removal.
- After integration and verification, follow the [Work playbook's task-level commit policy](docs/playbooks/work.md#작업별-커밋과-완료). Integration and cleanup do not authorize remote push, publishing or deployment.

## Generated artifact cleanup

- Freeze all source, scripts, lockfiles and build inputs at build start, including the selected uncommitted changes. Build, package, verify and install from that immutable snapshot. Changes added afterward belong to the next build; do not refresh the running build from the live checkout or restart it merely because another task changed the checkout. A correction that changes a frozen input starts a new build with a new input identity. Follow the [build playbook](docs/playbooks/build.md) for snapshot and provenance checks.

- After a new release passes verification and installation, clean unused older release directories and VSIX packages in the same task using the [build playbook](docs/playbooks/build.md#업데이트복구정리). Preserve the actual installed runtime, the previous verified rollback release, latest selected release, active task inputs, shortcuts and live process references. Keep compact identity/result receipts; record each retained path's reason and removal condition.
- After verification and handoff, immediately delete completed verification copies, isolated VS Code profiles, copied extensions/plugins/skills and temporary packages. Archive only compact result summaries, exit codes and required receipts in the owning log directory; do not move bulky fixtures into logs.
- Immediately remove unused alternate Rust build/test targets and caches preserved from task worktrees. Reuse the current selected build cache; preserve paths required by running processes, the current/previous installed release or an active task. Record every temporary retention reason and its removal condition.
- Use the existing guarded cleanup scripts in `scripts/` and the [build playbook](docs/playbooks/build.md). Verify absolute path containment and process/installation references before deleting; inspection failures preserve uncertain paths. Never delete source changes or user authentication, conversations and settings as build artifacts.

## Temporary snippets

- When the user mentions `$merge-project-files`, the `merge-project-files` snippet, `프로젝트 파일 병합`, or `프로젝트 병합`, read and follow `G:\내 드라이브\ObsidianVault\PARA\00 Agents\snippets\merge-project-files.md` for that request only.
- Load only the named snippet. If it is missing, say so instead of searching the Vault or guessing its contents.
- A snippet supplies workflow guidance; it does not grant permissions beyond the user's request.
