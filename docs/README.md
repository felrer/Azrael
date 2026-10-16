# Project Documentation

The project implements an independent Azrael VS Code host around a narrowly modified public engine. The single integrated extension embeds account and usage UI, with native state separate from ordinary Codex. Builds enforce engine source provenance including local changes. The current installed state and open release gates are in [development operations](ops/development.md#current-state); full upstream regression acceptance is not established. Legacy documentation is in the [archive](archive/README.md).

This document is the category-based entry point for project documentation.

| Category | Purpose | Entry document |
| --- | --- | --- |
| `architecture/` | Describes the system structure and major design decisions. | [Architecture](architecture/README.md) |
| `maps/` | Identifies code areas and major entry points. | [Code maps](maps/README.md) |
| `ops/` | Covers development, deployment, and operational procedures. | [Operations](ops/README.md) |
| `playbooks/` | Work principles, verification selection, and closeout. | [Project playbooks](playbooks/README.md) |
| `boards/` | Lightweight programs that help users provide structured requirements and information; program registry and shared creation guidance. | [Boards](boards/README.md) |
| `archive/` | Historical designs and per-release verification records. | [Archive](archive/README.md) |

Add detailed documents to the appropriate category and link them from that category's README.

## Route By Work

These routes are starting points, not a required reading sequence. Read only the owner sections needed for the task; use a direct file or symbol lookup when its location is already known.

| Task | Start with |
| --- | --- |
| Locate an implementation, caller or execution role | [Code maps](maps/README.md#route-by-task), or a direct lookup; resolve the engine source before editing engine code. |
| Understand or change system behavior, boundaries, interfaces or data contracts | [Architecture](architecture/README.md), then the relevant implementation owner. |
| Set up, build, verify, install, operate or recover the app | [Operations](ops/README.md), then the applicable procedure and its environment requirements. |
| Perform or verify substantive work | [Project playbooks](playbooks/README.md), then only the applicable operational owners. |
| Prepare or update a task plan | Relevant design/code owners and [Work Artifacts](#work-artifacts). |
| Create or find a lightweight program for gathering user requirements and information | [Boards](boards/README.md). |
| Consult retired designs or previous release evidence | [Archive](archive/README.md); establish current behavior from active code and operational evidence. |

## Document State And Ownership

Distinguish `draft` proposals, `target` intended behavior, `current` verified implementation, and `partial` documents with explicitly separated states. Label state once per document or section, not per sentence. Approval does not establish implementation. Keep verification evidence in the work plan or operational owner and link to it; do not add dated verification notes to design documents. Each durable contract has one owning document; routers link to it. Historical documents are reference material, not evidence of replacement behavior.

When editing documents, update the current content in place. Integrate settled answers into their owning sections and remove resolved questions, obsolete content and duplication. Unless history is the document's purpose, do not append response records, dated confirmation notes, investigation records or detailed logs; retain only what is needed for current understanding, execution and verification.

## Work Artifacts

- Work directory: work

Use [Work documents](../work/README.md) for session and plan usage. The project-local `work/` directory owns new work plans.

Store new work plans in `work/` at the project root. Resolve relative paths from the project root; do not create a separate work-plan repository under `docs/work/` or `docs/implementation/`.

Follow the active `development-workflow` skill for folder and file allocation and authoring. Preserve earlier external work records and their links at their existing paths. A storage-location change alone does not move existing records.

Keep design, architecture and operational documents in their existing `docs/` categories.
