# Project Working Guide

- Review the [documentation guide](docs/README.md) before starting non-trivial work.
- Record detailed designs, code structure, and operational procedures in the appropriate `docs` category rather than at the project root.
- Before substantive work, select applicable [project playbooks](docs/playbooks/README.md). Read only matching routes and owner sections.
- Use [Work Artifacts](docs/README.md#work-artifacts) for the configured external work-document owner and active planning conventions.
- Distinguish proposed design from verified implementation using [document-state guidance](docs/README.md#document-state-and-ownership).
- When editing any document, update its current content in place. Integrate confirmed answers into the relevant section; remove resolved questions, superseded text, and duplicates. Do not append response histories, dated confirmation notes, copied investigations, or detailed logs unless that history is itself the document's purpose. Keep only content needed to understand, execute, or verify the current work.

## Instruction Library Ownership

- Maintain shared instructions in this repository's `instructions/` directory. `felrer/Azrael` is the active repository; `felrer/codex-efficient-subagents` is archived.
- The former shared checkout is historical import evidence, not an active maintenance destination. Do not mirror new changes there. Preserve recorded source provenance and original notices.
- Keep related examples in `instructions/examples/delegation.md` consistent when changing `instructions/instructions/AGENTS.snippet.md`.

## Temporary snippets

- When the user mentions `$merge-project-files`, the `merge-project-files` snippet, `프로젝트 파일 병합`, or `프로젝트 병합`, read and follow `G:\내 드라이브\ObsidianVault\PARA\00 Agents\snippets\merge-project-files.md` for that request only.
- Load only the named snippet. If it is missing, say so instead of searching the Vault or guessing its contents.
- A snippet supplies workflow guidance; it does not grant permissions beyond the user's request.
