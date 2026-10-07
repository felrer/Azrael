# Project Documentation

The project implements an independent Azrael VS Code host around a narrowly modified public engine. The single integrated extension embeds account and usage UI, with native state separate from ordinary Codex. Builds enforce engine source provenance including local changes. The current installed state and open release gates are in [development operations](ops/development.md#current-state); full upstream regression acceptance is not established. Legacy documentation is in the [archive](archive/README.md).

This document is the category-based entry point for project documentation.

| Category | Purpose | Entry document |
| --- | --- | --- |
| `architecture/` | Describes the system structure and major design decisions. | [Architecture](architecture/README.md) |
| `maps/` | Identifies code areas and major entry points. | [Code maps](maps/README.md) |
| `ops/` | Covers development, deployment, and operational procedures. | [Operations](ops/README.md) |
| `playbooks/` | Work principles, verification selection, and closeout. | [Project playbooks](playbooks/README.md) |
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
| Consult retired designs or previous release evidence | [Archive](archive/README.md); establish current behavior from active code and operational evidence. |

## Document State And Ownership

Distinguish `draft` proposals, `target` intended behavior, `current` verified implementation, and `partial` documents with explicitly separated states. Label state once per document or section, not per sentence. Approval does not establish implementation. Keep verification evidence in the work plan or operational owner and link to it; do not add dated verification notes to design documents. Each durable contract has one owning document; routers link to it. Historical documents are reference material, not evidence of replacement behavior.

## Work Artifacts

- Work directory: G:/내 드라이브/ObsidianVault/PARA/30 Project/pi-harness/Tasks/Task2
- Google Drive account: `felrer02@gmail.com`

Use [Work documents](<G:/내 드라이브/ObsidianVault/PARA/30 Project/pi-harness/Tasks/Task2/README.md>) for session and plan usage. This external owner replaces the default `docs/work/README.md`; no competing local work directory is maintained.

모든 작업 계획 문서는 위 외부 경로에 저장한다. 저장소 내부에는 작업 계획 파일이나
`docs/implementation/` 대체 디렉터리를 만들지 않는다.

경로 확인, 파일 할당 및 작성 절차는 활성화된 `development-workflow` 스킬을 따른다. 외부 경로를 사용할 수
없으면 저장소나 다른 위치로 대체하지 말고 실패 원인을 보고한다.

설계·아키텍처·운영 문서는 기존 `docs/` 분류에 유지한다.
