# 지침 문서 라이브러리 탐색 및 Playbook

상태: 합의 범위 소스 구현·Windows 검증 완료. 사용자 구현 요청은 목록 내 버전 선택·차이 보기와 앞선 라이브러리/Playbook/UI 합의를 포함한다. 제품 전체 빌드·설치·원격 게시는 실행하지 않았다.

## 목표와 합의

지침 문서 페이지 전체 UI/UX를 개편하여 공유 리소스를 검색하고 카드/텍스트 세로 목록에서 탐색한다. 분류는 리소스 종류이며 사용자가 만드는 주제 카테고리가 아니다. OpenAI 스타일과 기존 설정 진입점을 유지한다.

Playbook은 기본 로컬 전용, 프로젝트 경로는 docs/playbooks/로 한다. 문서 앞부분 메타데이터의 ID·버전과 실제 파일 존재를 비교하여 미다운로드/다운로드됨/버전 다름/확인 필요를 표시한다. 같은 버전의 본문 수정은 다운로드 상태를 바꾸지 않지만 덮어쓰기의 로컬 수정 보호는 유지한다. 다운로드와 실제 지침 활성화는 구분한다.

## 시작 시 조사와 보존

- instructionView.ts는 등록된 library.entries의 검색·종류·공유 필터와 목록/원문 편집기를 제공한다. 새 스킬은 표시 이름을 SKILL.md name에 그대로 넣는다. instruction-library.cjs의 engineName은 이를 ASCII 설치 이름으로 검증하므로 한글 이름의 생성 초안이 Invalid installation name이 되는 원인을 확인했다.
- instruction-library.cjs는 skill/agent-role/context/task-profile을 지원한다. _targets는 skill/agent-role만 설치 대상을 만들며 context의 문서 보관·task 참조를 프로젝트 Playbook 다운로드로 간주할 수 없다.
- instructionLibraryService.ts snapshot은 등록된 로컬 entries를 반환한다. libraryRemoteRefresh는 저장소 릴리스 목록, libraryRemoteImport는 선택 릴리스의 패키지 일괄 가져오기다. 가져오기 전 개별 원격 리소스 통합 목록과 설치 위치 자동 탐색은 추가가 필요하다.
- instruction-publisher.cjs의 원격 manifest·ZIP·파일 무결성 검증과 현재 head/dependency 버전 구분을 재사용한다. 탐색이 라이브러리 가져오기/설치를 일으키지 않도록 경계를 분리해야 한다.
- docs/architecture/instructions.md가 배포·라이브러리·UI·권한·충돌·복구의 소유 문서다. 기존 수정은 보존하고 Resource discovery and project Playbooks 구간에 합의한 검색 범위·분류·Playbook 경로와 판정 규칙을 target으로 추가했다. 기존 UI 제안의 주 목록도 스킬 한정에서 종류 선택 리소스 목록으로 맞췄다.

기본 instructions/ 배포와 개인 라이브러리 출처 소유권을 유지한다. 로컬 전용 항목은 모든 원격 게시 입력에서 제외한다. 기존 저장/적용/게시 독립성, 충돌·복구, 지원 파일 전체 관리, 읽기 전용 시스템·플러그인 소유권과 출처별 버전/권한을 보존한다. 미확인 원격 상태는 최신/없음으로 표시하지 않는다.

## UI/UX 제안

기본 화면은 전체 폭 세로 목록이며 카드 보기 전환을 제공한다. 검색·종류 선택을 상단에 두고 출처·공유·설치 상태는 필터 버튼에서 선택한다. 결과 수와 항목의 제목·짧은 설명·종류·출처·버전·대상별 상태를 표시한다. 종류는 스킬/Playbook/에이전트 역할/참고 문서/작업 프로필을 구분하고 기본 지침 묶음은 기존 배포 소유권을 유지하여 연결한다. 내부 context 재사용과 마이그레이션은 보존 조건을 충족한 뒤 정한다. 목록 기본값과 화면 이동은 사용자 합의 후 architecture target에 반영했다.

선택 시 별도의 전체 폭 상세 화면에서 읽기 미리보기, 출처·버전·목적지, 상황별 주 동작을 제공한다. 내 라이브러리 가져오기, Azrael에 설치, 프로젝트에 다운로드, 새 대화 시작의 실제 효과를 설명한다. 편집/지원 파일/게시/긴 digest 등은 상세 관리에서 제공한다. 배포·연결은 별도 관리 영역에 둔다. 목록의 검색·필터·선택·스크롤은 상세에서 돌아올 때 보존한다. 넓은 화면과 좁은 화면 모두 목록→상세 이동을 사용한다.

한글 표시 이름과 설치 이름을 구분하고 유효한 설치 이름 제안과 종류별 유효 템플릿을 제공한다. 오류는 필드 가까이에 한국어/영어로 설명한다. 기존 설치 이름은 표시 이름 변경만으로 바꾸지 않는다. 전체 비어 있음/검색 결과 없음/조회 전/실패/캐시를 구분하고 일부 출처 오류는 다른 목록을 지우지 않는다. 프로젝트 다운로드는 대상을 명시하며 프로젝트 없음·다중 루트에서 첫 폴더를 묵시적으로 선택하지 않는다.

## 확정된 설계 결정

1. 검색 범위는 내 라이브러리 + 기본 제공/설치된 리소스 + 연결 공개/협업 저장소로 확정했다. 연결하지 않은 외부 저장소 검색은 포함하지 않는다. 이 결정은 architecture target에 반영했다.
2. 페이지 진입은 기존 계약대로 로컬과 확인된 캐시를 복원하고 원격 갱신은 명시적으로 수행한다. 검색과 새로고침을 구분하며 원격 목록 조회는 설치나 라이브러리 가져오기를 실행하지 않는다.
3. 개별 Playbook은 0.1.0으로 시작하고 유효한 배포 내용이 변경되어 저장되면 patch 버전을 자동 증가시키는 것으로 확정했다. 동일 내용 저장은 버전을 바꾸지 않으며 프로젝트 사본은 자동 덮어쓰지 않고 버전 차이를 표시한다. 문서/지원 파일 변경과 표시·공유 메타데이터 변경을 구분하고 가져온 문서의 기존 ID/버전을 보존한다. 무효 초안은 기존 저장 규칙을 유지하며 새 다운로드 버전으로 내보내지 않는다. 게시 저장소 릴리스 버전과 구분한다. architecture target에 반영했다.
4. 상세 화면의 대상별 주 버튼→변경 파일/목적지 검토→확인 후 획득·설치 흐름을 확정했다. 라이브러리 보관만 하는 보조 동작도 제공한다. 미리보기에 필요한 검증 캐시와 등록/설치를 구분하며 단계별 실패와 획득/설치 상태는 별도로 유지한다. architecture target에 반영했다.
5. 합의 내용은 design-documentation으로 같은 architecture 소유 구간에 반영한다. 이 기록을 계속 사용하며 구현 여부와 실행 권한을 구분한다.

버전 없는 프로젝트 문서는 확인 필요/충돌로 보호한다. 프로젝트 설치 단위는 `docs/playbooks/<resource-id>/`이며 지원 파일을 함께 관리한다. 개인 라이브러리가 관리하는 설치본은 기존 항목의 상태에 합치고 독립 출처는 별도 항목으로 유지한다. 이름만 같은 항목을 합치지 않는다. 원격과 개인 사본을 모두 한 행으로 합치는 제안은 이번 구현에 포함하지 않았다.

## 플랫폼과 완료 기준

## 실행과 검증 준비

root는 공통 프로토콜·호스트 서비스·원격 캐시·획득 통합·패키징 입력 목록·기능 보존·문서·최종 검증을 소유한다. AGENTS의 bounded delegation 지침에 따라 backend, UI, read-only discovery, remote metadata protocol을 독립 파일 소유자로 나누었다. 각 담당자는 공유 작업을 보존하며 재위임하지 않는다. 백엔드와 원격 프로토콜은 API 계약 확정 후 동시에 구현했고 호스트는 이를 소비한다. 기존 외부 수정은 커밋에서 제외한다.

검증은 scripts/check-instruction-library.cjs의 backend/host/types 묶음으로 실행한다. producer는 시작 전에 artifact-run으로 artifacts/tasks/CM-01-instruction-library-experience/runs/<runId>의 temporary/logs/reports/outputs 소유를 기록한다. TEMP/TMP, catalog, publisher fixture는 이 실행의 temporary 하위로 고정한다. 기존 호스트 fixture도 AZRAEL_INSTRUCTION_TEST_ROOT를 사용한다. 실행 후 실제 종료 코드·요약·로그와 보존/정리 결정을 이 기록에 연결한다. 실제 렌더링은 별도 준비 후 light/dark·좁은 화면·목록 필터/전환/버전 비교/상세 복귀를 확인한다. 전체 제품 빌드나 사용자 설치본 교체는 실행하지 않는다.

로컬 Windows x64, glibc Linux x64, macOS ARM64 공통 동작이다. OS별 경로·대소문자·인증 제공자 차이를 보존한다. Remote SSH/컨테이너와 지원 대상 확대는 별도다. 이번 작업은 Windows x64에서 소스·호스트 fixture·실제 렌더러를 검증했다. Linux/macOS와 설치된 제품·실제 원격 저장소는 검증하지 않았다.

설계 수용은 종류/출처별 검색→목록→미리보기→가져오기/설치/다운로드→상태 재조회와 취소·충돌·편집 흐름이 연결되는 것이다. 구현 후 Windows 회귀, light/dark 실제 렌더링, 한국어/영어·키보드·좁은 화면, 오프라인/일부 출처 실패, 읽기 전용 소스, 중복 ID/이름, 출처별 동일 버전, 프로젝트 전환/다중 루트, 버전 없는 문서와 로컬 수정 보호, 저장/적용/게시 독립성을 검증한다. 다른 OS·실제 설치본·원격 계정 수용은 수행 범위만 별도 기록한다.

## 구현 결과와 검증 (2026-10-19)

리소스 종류별 통합 검색, 기본 텍스트 목록/카드 전환, 별도 상세 읽기 화면, 복귀 시 검색·필터·스크롤·초점 복원, 설치 대상별 검토와 획득을 구현했다. 목록에서 두 버전 또는 실제 설치/프로젝트 파일과 비교하고 선택한 과거 버전을 설치할 수 있다. 설치·기본 제공 출처는 읽기 전용이며 미리보기는 라이브러리 등록을 유발하지 않는다. 연결 저장소는 메타데이터를 먼저 조회하고 검증된 내용만 지연 다운로드·캐시한다. 오프라인 캐시 재열기와 출처별 오류 격리를 확인했다.

Playbook은 로컬 전용·0.1.0으로 시작하고 유효한 본문/지원 파일 변경 시 patch를 증가시킨다. 다운로드 상태는 파일의 ID/버전으로 판단하며 설치는 별도 receipt와 파일 비교로 로컬 수정을 보호한다. 설치한 호스트의 기본 문서는 검증된 기존 baseline 캐시에서도 탐색한다. 카탈로그 모듈은 Windows/portable payload 복사 목록과 격리 로딩 검사에 포함했다.

| 검사 | 결과 및 근거 |
| --- | --- |
| Backend | exit 0, 53 pass / 1 skip (Windows case-insensitive 조건). `artifacts/tasks/CM-01-instruction-library-experience/runs/20261019T002621537Z-5509aa03-d7b9-4d3a-8710-2fa3eddd119c/logs/backend.log`. 00:26:24–00:27:04 UTC. |
| Host + packaging regression | exit 0, 73 pass / 1 skip. `artifacts/tasks/CM-01/runs/host-4c720674/logs/host.log`. 00:33:16–00:34:51 UTC. 과거 버전 설치, 프로젝트 외부 수정 보호, 읽기 전용 설치본, 원격 metadata/lazy cache/offline 재열기를 포함한다. |
| TypeScript | exit 0. `artifacts/tasks/CM-01/runs/types-91c2c6e7/logs/types.log`. 00:33:28–00:33:32 UTC. |
| Render | exit 0, 71 checks, light/dark 1100/420px, 17 screenshots. `artifacts/tasks/CM-01-instruction-library-experience/runs/20261019T003712055Z-ed612182-8ec1-4aa2-9fd3-bbc09b3f92df/reports/summary.json`. 실제 renderer/client와 pinned CSS, host 응답은 fixture. 브라우저 종료 및 임시 profile 제거 확인. 안내문 대비 light 16.11:1 / dark 13.63:1. |
| Feature inventory | 현재 작업 트리 manifest 전체 및 커밋 대상 `ui.instruction-settings`만의 `feature-preservation.validateManifest` exit 0. 다른 작업의 Cargo validator 변경과 HEAD inventory를 섞은 전체 검사는 `engine.shared-engine.appserver` preflight 선언 차이로 실패하므로 이번 기능의 검증과 구분한다. |

기존 `all_changes_20261007_r6/engine/codex.exe`는 baseline fixture의 격리 검증기로만 재사용했다. SHA256 `ebeee44638fe9ec25bc4e7b788ac4fcf6fc99a5f3d401cd155d9f17ecaa16c76`. 현재 소스로 engine을 빌드했다는 의미가 아니다. 테스트는 서로 겹쳐 실행했으며 위 소요 시간을 합산하지 않는다. native maintenance 실행은 10초 경계에서 exit 124로 중단됐고 성공으로 간주하지 않았다. 실제 종료 확인 후 같은 검사를 직접 command 경계로 재실행했다. 초기 실패는 module loader 위치 인덱스, validator 경로, fixture 격리/긴 Windows SQLite 경로, 제거된 workspace 상태 조회와 렌더 fixture 변수/버전 선택 설정이었다. 원인을 수정한 범위만 재검증했고 최종 host/backend/type/render 결과가 이를 대체한다. 마지막 CSS 대비 수정은 renderer로 검증했으며 backend/host를 반복 실행하지 않았다.

실제 GitHub 권한·출시 저장소, 최종 제품 패키지/활성 설치본, Linux/macOS는 미검증이다. 저장소의 최근 30개 release가 현재 원격 탐색 범위이며 연결하지 않은 외부 저장소는 검색하지 않는다. 기존 다른 작업 수정은 보존한다.
