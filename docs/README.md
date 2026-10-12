# Project Documentation

The project implements an independent Azrael VS Code host around a narrowly modified public engine. The single integrated extension embeds account and usage UI, with native state separate from ordinary Codex. Builds enforce engine source provenance including local changes. The current installed state and open release gates are in [development operations](ops/development.md#current-state); full upstream regression acceptance is not established. Legacy documentation is in the [archive](archive/README.md).

This document is the category-based entry point for project documentation.

| Category | Purpose | Entry document |
| --- | --- | --- |
| `architecture/` | Describes the system structure and major design decisions. | [Architecture](architecture/README.md) |
| `maps/` | Identifies code areas and major entry points. | [Code maps](maps/README.md) |
| `ops/` | Covers development, deployment, and operational procedures. | [Operations](ops/README.md) |
| `playbooks/` | Work principles, verification selection, and closeout. | [Project playbooks](playbooks/README.md) |
| `boards/` | Lightweight programs that help users provide structured requirements and information; program registry and shared creation guidance. | [보드](boards/README.md) |
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
| Create or find a lightweight program for gathering user requirements and information | [보드](boards/README.md). |
| Consult retired designs or previous release evidence | [Archive](archive/README.md); establish current behavior from active code and operational evidence. |

## Document State And Ownership

Distinguish `draft` proposals, `target` intended behavior, `current` verified implementation, and `partial` documents with explicitly separated states. Label state once per document or section, not per sentence. Approval does not establish implementation. Keep verification evidence in the work plan or operational owner and link to it; do not add dated verification notes to design documents. Each durable contract has one owning document; routers link to it. Historical documents are reference material, not evidence of replacement behavior.

문서를 수정할 때는 현재 내용을 직접 갱신한다. 확정된 답을 관련 절에 통합하고 해결된 질문·폐기된 내용·중복을 제거한다. 이력 자체가 문서 목적이 아니면 응답 기록·날짜별 확인 메모·조사나 상세 로그를 덧붙이지 않으며, 현재 이해·실행·검증에 필요한 내용만 유지한다.

## Work Artifacts

- Work directory: work

Use [Work documents](../work/README.md) for session and plan usage. The project-local `work/` directory owns new work plans.

앞으로 작업 계획 문서는 프로젝트 루트의 `work/`에 저장한다. 상대 경로는 프로젝트 루트를 기준으로
해석하며, `docs/work/`나 `docs/implementation/`에 별도의 작업 계획 저장소를 만들지 않는다.

폴더·파일 할당과 작성 절차는 활성화된 `development-workflow` 스킬을 따른다. 이전 외부 작업 기록과
그 기록을 가리키는 링크는 기존 경로에 보존한다. 저장 위치 변경만으로 기존 기록을 이동하지 않는다.

설계·아키텍처·운영 문서는 기존 `docs/` 분류에 유지한다.
