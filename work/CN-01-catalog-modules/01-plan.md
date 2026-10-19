상태: 구현·검증·정리 결정 완료 — 기본 다중 선택과 윤곽선 표시로 전환했다. 정상 임시 폴더 네 개를 삭제·finalize했고 보호된 실패 실행 두 건과 검사 증거는 재검토 조건을 정해 보존했다.

# 목록·카드 모듈 시험 보드

## 목표와 권한

GrowKick의 파괴 가능한 오브젝트 분류 UI를 참조해 좌측 폴더·목록 관리 모듈과 카드·필터 검색 모듈을 이 프로젝트 `docs/boards/` 아래 재사용 가능한 형태로 만든다. 두 모듈을 조합한 더미데이터 편집·파일 저장 페이지를 제공하고 사용자가 반복 시험할 수 있게 한다. 구현·로컬 실행·필수 검증·정리·작업별 커밋은 요청 범위다. GrowKick 원본/실제 카탈로그·Studio·클라우드는 읽기 참조 외 변경하지 않는다. Azrael 배포·설치·원격 게시·push는 제외한다.

## 기존 구조와 변경

기존 보드의 Node loopback 서버, BoardStorage 저장·충돌 방지·백업·고정 전달본과 테마 토큰을 재사용한다. 새로운 두 UI 모듈은 문서·선택·필터·편집 이력과 파일 저장을 호출자에게 맡긴다. 합성 더미 12개로 시작한다. Excalidraw/3D 뷰어 의존성은 추가하지 않는다. 설계·API의 지속 소유자는 `docs/boards/catalog/README.md`다.

GrowKick `tools/asset-editor/model.mjs:72`와 `editor.mjs:178`의 폴더 grouping, `model.mjs:92`와 `editor.mjs:170`의 필터·카드 선택 경계를 재사용한다. 원본은 티어와 Amount·그룹 예외·3D 렌더러에 결합돼 있어 UI 책임을 추출하고 테마를 공통 토큰에 맞춘다. 원본 번들 실행 일치·게임 동작 검증은 이번 범위가 아니다.

폴더는 한 단계, 목록은 폴더 또는 루트, 항목은 하나의 목록 또는 미분류에 속한다. 안정 ID를 사용한다. 폴더 삭제는 목록을 루트로, 목록 삭제는 항목을 미분류로 남긴다. 이름/ID/태그 검색과 종류/검토 상태/선택 목록 필터는 AND로 조합하고 선택은 유지한다. 편집 필드는 이름·종류·검토 상태·태그·메모·목록 배정이다. 실행 취소/다시 실행과 수동 저장·폐기 확인·충돌 보존을 제공한다.

## 플랫폼과 검증

공통 의미: 현대 브라우저 및 Node 22+의 로컬 실행. 의도 대상 Windows x64/Linux x64/macOS ARM64. 실제 수용은 현재 Windows x64/Chrome/Node 환경에 한정하며 다른 OS는 미검증으로 남긴다. 기존 보드의 공통 서버 변경에 Windows 저장 회귀 검사를 포함한다.

성공 기준: 폴더/목록의 생성·이름 변경·이동·안전한 삭제, 카드 표시·필터 조합·검색·선택·항목 편집, 수동 저장 후 재열기 복구, 실패/충돌 때 편집본 보존, 두 모듈의 명시적 재사용 API, 실제 밝은/어두운 화면 및 좁은 화면 조작, 더미 데이터와 저장 위치 확인, 필요한 증거 보존과 임시 프로필 정리.

## 담당·선행 조건·산출물

- source explorer: GrowKick `tools/asset-editor` 읽기 조사. 결과는 root의 행동/API 계약과 UI 담당자에게 전달한다. 소스 변경 없음.
- root: 요구사항·공유 데이터 계약·저장 어댑터·서버 통합·검사/실행 준비·문서·최종 검증/정리/커밋.
- `/root/catalog_ui`: `shared/modules/{folder-list.mjs,card-browser.mjs,catalog-widgets.css}`와 `catalog/{index.html,board.js,catalog.css}` 전용. root는 저장/검증과 실제 UI 검사 준비를 병행했다. source 조사 담당은 읽기 전용 결과 인계를 완료했다. 담당 파일 소유권은 겹치지 않는다.

새 생성물은 이 작업의 고유 `artifacts/tasks/<work-id>/runs/<run-id>/`에 생성 전에 producer로 등록한다. 검사 프로필/더미 파일은 `temporary/`, 결과와 화면은 `reports/`·`logs/`에 둔다. 사용자 실행 데이터는 `artifacts/board-data/catalog/`에 별도로 보존한다. 무거운 Azrael 제품 빌드는 하지 않는다.

## 진행·증거

기본 다중 선택 후속 요구: 카드 클릭은 보조 키 없이 해당 ID를 추가/해제하고 나머지 선택을 유지한다. 카드 체크박스를 제거하고 기존 selected 윤곽선과 aria-pressed로 상태를 제공한다. 표시된 카드 일괄 선택 기능은 체크박스 대신 토글 버튼으로 유지한다. root는 card-browser·전용 CSS·소유 README와 기존 브라우저 검사를 수정한다. 키보드 클릭에도 같은 동작을 적용하고 재렌더 뒤 카드 초점을 복원한다. 저장/API/자료 스키마와 플랫폼 범위는 그대로다. 기존 단일 카드 편집 검사는 명시적인 선택 해제 후 카드를 선택하도록 조정하고 실제 기본 다중 클릭·윤곽선·일괄 선택의 숨은 선택 보존·키보드 초점·밝은/어두운 화면을 확인한다.

최종 native `boards-catalog-ui` 실행 `run-45928-1195-1792389951933452300`은 실제 exit 0·입력 무결성 유효·52개 통과다. [결과](../../artifacts/tasks/CN-01-catalog-modules/runs/ui-1792389952549-13bf1059/reports/render-summary.json), [로그](../../artifacts/tasks/CN-01-catalog-modules/runs/ui-1792389952549-13bf1059/logs/command.log). 06:05:53.666–06:05:57.370 UTC. 밝은/어두운 선택 화면을 직접 확인했고 카드 체크박스가 없으며 두 카드 윤곽선이 표시된다. 실제 포인터 클릭·재클릭·필터에 숨은 선택 유지·일괄 선택/해제·키보드 Enter 토글과 초점 복원·기존 편집/저장/복구 경로를 확인했다. 첫 실행 `run-45928-1191-1792389925017367100` / `ui-1792389925582-cf185d66`은 실제 exit 1로 검색 직후 첫 클릭이 사라지는 문제를 찾았다. 검색의 input 뒤 blur change가 같은 값으로 다시 렌더해 mouse down/up 대상이 바뀐 원인이므로 값이 실제로 바뀔 때만 필터 callback을 호출하도록 수정한 뒤 통과했다. 두 실행의 시험 서버와 Chrome은 종료했고 browser exit는 0이다.

정리 재개: 현재 남은 이 작업의 lifecycle 14개를 native 등록/검토했다. 정상 종료한 임시 폴더 네 개(`unit-1792388389368-8c1d01d6`, `ui-1792388453979-5e7b05a3`, `ui-1792388685132-f2cce11a`, `ui-1792389952549-13bf1059`)는 삭제하기로 결정한다. 실패 실행 `ui-1792388395582-d1a343de`, `ui-1792389925582-cf185d66`의 temporary/evidence 네 group은 native가 membership incomplete로 보호하므로 보존한다. 재검토 조건은 실패 producer의 원래 실패 상태를 보존한 종료/구성원 정합성 복구 또는 지원되는 retirement 절차가 준비될 때다. 나머지 검사 evidence 여섯 group은 현재 반복 실사용의 회귀·화면 비교 근거로 보존하며 실사용 수용 종료 또는 최신 근거로 통합할 때 재검토한다. 자동 성공 전환·보호 우회 없이 각 그룹 전체에 같은 delete/defer 결정을 적용한다. 검토/등록에 여러 분이 걸려 기능 검증 이후 정리 대기가 발생했으며 새 제품 검사나 빌드는 추가하지 않았다.

선택 후속 요구: 체크된 카드 본문을 다시 누르면 해당 ID만 선택에서 제거한다. 체크박스·Ctrl/Cmd 다중 선택·필터 선택 보존과 선택하지 않은 카드의 일반 클릭(단일 선택)은 유지한다. root가 card-browser의 클릭 경계만 수정하고 기존 브라우저 검사에 단일/복수 선택의 재클릭 해제·체크박스 해제·어두운 테마 동작을 보강한다. 선택은 화면 상태이며 파일 자료와 저장 스키마를 바꾸지 않는다. 기존 플랫폼 범위를 유지하고 Windows Chrome에서 검증한다.

재클릭 해제 구현 후 `node docs/boards/tests/catalog-verify.mjs ui` 실제 exit 0, Chrome 검사 49개 통과. [결과](../../artifacts/tasks/CN-01-catalog-modules/runs/ui-1792388685132-f2cce11a/reports/render-summary.json), [로그](../../artifacts/tasks/CN-01-catalog-modules/runs/ui-1792388685132-f2cce11a/logs/command.log). 체크·aria-pressed·선택 수·상세 창 동기화, 복수 선택 중 한 카드만 해제, 체크박스 해제와 어두운 테마를 실제 포인터로 확인했다. 중복 선택을 전제로 한 기존 검사 두 곳의 불필요한 재클릭을 제거했다. Chrome 및 시험 서버는 정상 종료했고 실사용 서버가 새 모듈을 HTTP 200으로 제공함을 확인했다. native plan 검토 후 run은 동일 관리 잠금으로 실행 전에 실패해 문서의 직접 launcher를 사용했으며 native 통과로 주장하지 않는다. 이 실행의 두 lifecycle group은 생성 전 등록됐고, 임시 자료는 잠금 해제 후 삭제, 증거는 실사용 진단 종료/대체 시 재검토하기로 결정해 현재 보존한다. 이전 정리·커밋 보류 상태는 유지한다.

실사용 후속 요구: 폴더/목록 행의 점 세 개·위/아래 버튼을 모두 제거한다. 브라우저 기본 HTML drag/drop을 사용해 폴더 순서, 목록 순서와 폴더 배정을 하나의 편집 동작으로 변경한다. 우클릭은 기존 상세 설정 창을 열며 이름·폴더·안전 삭제를 유지한다. Shift+F10/ContextMenu 키와 Alt+위/아래 키를 대체 조작으로 제공한다. 기존 한 단계 폴더·수동 저장·undo/redo 계약과 공통 플랫폼 범위는 유지한다. 변경 소유: root가 folder-list 모듈·해당 CSS·catalog-model 이동 액션·기존 관련 검사·소유 README를 수정한다. 다른 보드 작업의 공통 서버/검사 launcher 변경은 보존한다. 새 라이브러리 대신 기본 drag/drop과 기존 dialog/액션 경계를 재사용한다. 검증은 순서/소속의 원자적 이동·자료 보존 단위 검사, 실제 Chrome 드래그/우클릭/키보드/저장·재열기와 밝은/어두운 화면에 집중한다.

후속 검증은 Windows x64/Chrome/Node 26.7.0에서 완료했다. native `plan`으로 두 묶음의 argv/cwd/env/inputs/guards를 검토했으나 `run`이 같은 배타적 관리 잠금 때문에 실행 전 실패했다. 문서에 제공한 동일 launcher를 직접 실행해 별도 소유 run에 결과를 남겼으며 native 통과 영수증으로 주장하지 않는다.

- `node docs/boards/tests/catalog-verify.mjs unit`: 실제 exit 0, 27개 통과. [결과](../../artifacts/tasks/CN-01-catalog-modules/runs/unit-1792388389368-8c1d01d6/reports/result.json), [로그](../../artifacts/tasks/CN-01-catalog-modules/runs/unit-1792388389368-8c1d01d6/logs/command.log). 폴더/목록의 상대 위치·소속 이동, 잘못된 대상 거부, 원본과 카드 자료 보존을 추가했다.
- `node docs/boards/tests/catalog-verify.mjs ui`: 실제 exit 0, 44개 통과. 최종 05:40:55.065–05:41:00.533 UTC. [결과](../../artifacts/tasks/CN-01-catalog-modules/runs/ui-1792388453979-5e7b05a3/reports/render-summary.json), [로그](../../artifacts/tasks/CN-01-catalog-modules/runs/ui-1792388453979-5e7b05a3/logs/command.log). 실제 CDP mouse로 native drag를 시작하고 그 drag data를 drop까지 전달했다. 폴더/목록 순서, 접힌 폴더/루트로 목록 이동, 우클릭 이름·소속 수정, 키보드 조작, 단일 undo 및 redo, 저장 후 순서 복원을 확인했다. 밝은/어두운 화면을 직접 확인했고 좁은 화면의 overflow·탐색도 통과했다.

첫 후속 UI 실행 `ui-1792388395582-d1a343de`는 기능 조작 37개 뒤 검사 helper의 백업 대기 조건에서 실패했다. 추가 저장으로 기존 백업이 생겨 기존 요소 유무 검사가 너무 일찍 끝난 원인이었다. helper를 새 백업 수 증가와 modal의 처리 종료까지 기다리도록 수정한 뒤 재실행했다. 제품 코드는 이 재실행에서 변경하지 않았다. 모든 시험 Chrome과 시험 서버는 종료했다. 실제 제공 주소의 모듈 HTTP 200, 새 dragstart 포함·기존 행 버튼 없음도 확인했으며 사용자 데이터는 변경하지 않았다.

후속 세 run의 producer 여섯 group은 생성 전에 Node lifecycle로 등록했다. 임시 자료 세 group과 대체된 첫 후속 UI 증거는 삭제 대상으로 결정하되 현재 native lock 때문에 그대로 보존한다. 후속 단위 및 최종 UI 증거는 실사용 피드백 진단 종료 또는 새 근거 대체 시 재검토한다. 이전 미완료 정리와 함께 정상 잠금 해제 후 native 등록/검토/적용·실제 부재 확인·finalize를 완료해야 한다. 새 의존성/제품 빌드/배포/사용자 파일 이동은 없다.

GrowKick 경로는 `C:/Users/felre/Desktop/GrowKick`; 분류 UI 후보는 `tools/asset-editor/index.html`과 `model.mjs`다. 기존 보드 저장 모듈은 codec 확장을 이미 지원한다. 프로젝트의 `project-maintenance.json`에 다른 작업의 미커밋 변경이 있으므로 작업에 필요한 묶음만 분리해 반영한다.

2026-10-19 UTC 04:58:25–05:02:00에 UI 담당자가 구현했고, 05:04:48에 입력 즉시 반영·잘못된 입력 보존·선택 없는 전달 범위 수정을 완료해 검사 입력을 고정했다. root는 저장·검사 준비를 병행했다. 추가 패키지나 제품 빌드 없이 vanilla ESM과 기존 저장 계층을 조합했다. 이 보드는 독립 도구이며 Azrael 엔진 동작을 추가하지 않아 엔진 feature inventory 변경은 없다.

- `boards-catalog-unit`: native `run-45928-1036-1792386244888409900`, 실제 exit 0·입력 무결성 유효, 신규 8개와 기존 보드/스케치 회귀 18개를 합한 26개 통과. [결과](../../artifacts/tasks/CN-01-catalog-modules/runs/unit-1792386245807-e568e0eb/reports/result.json), [로그](../../artifacts/tasks/CN-01-catalog-modules/runs/unit-1792386245807-e568e0eb/logs/command.log).
- `boards-catalog-ui`: native `run-45928-1054-1792386501881371800`, 실제 exit 0·입력 무결성 유효, 최종 실제 Chrome 조작 35개 통과. 05:08:23.050–05:08:25.785 UTC. 첫 검사 후 삭제 보존·목록 순서 검사를 보강해 재실행했다. [화면/결과](../../artifacts/tasks/CN-01-catalog-modules/runs/ui-1792386502416-54118d51/reports/render-summary.json), [로그](../../artifacts/tasks/CN-01-catalog-modules/runs/ui-1792386502416-54118d51/logs/command.log).

검사는 폴더·목록 생성/변경/접기/이동/안전 삭제, 검색·필터 조합·선택 유지, 즉시 입력/오류 보존/저장 차단, 카드 배정·추가·삭제·되돌리기, 한글 저장 후 재열기, 백업 복원, 충돌 때 편집본 보존, 전체/선택 고정 전달본, 저장 위치 오류/전환을 확인했다. 밝은/어두운/좁은 화면도 조작하고 화면을 확인했다. 실제 검증은 Windows x64/Chrome/Node 26.7.0이며 Linux/macOS는 미검증이다. 테스트 Chrome과 각 시험 서버의 실제 종료를 확인했다.

실사용 서버는 `node docs/boards/server.mjs --board catalog --port 4320`로 실행했다. 주소 `http://127.0.0.1:4320/`, 기본 자료 `artifacts/board-data/catalog/`. HTTP 200과 주요 제공 파일 7개의 소스 SHA 일치를 확인했다. 최초 12개 합성 자료로 시작하며 이후 사용자 편집 자료는 보존한다.

초기 검사 세 실행의 여섯 lifecycle group은 정상 잠금 해제 후 재검토했다. 초기 세 temporary group과 중복 첫 UI 증거 group은 관리 도구로 삭제하고 실제 다섯 구성원 경로의 부재와 네 producer record finalize를 확인했다. 초기 단위 및 최종 UI 증거 두 group은 실사용 피드백 진단 종료 또는 새 근거로 대체할 때 재검토하도록 보류했다. 할당기 입력/스테이징 보조 파일 두 개는 일반 삭제 후 부재를 확인했다. 이 정리는 초기 세 실행에 한정하며 별도로 진행한 후속 UI 검사 산출물의 처리를 뜻하지 않는다.

초기 정리 결과는 [디자인 보드 작업의 독립 정리 근거](../../artifacts/tasks/CO-01-design-preview-modules/runs/cleanup-1792389201814-5b4f7900/reports/cleanup.json)에 보존했다. 디자인 보드 담당은 스테이징의 목록·카드 후속 수정과 작업 기록 변경을 확인해 이 작업의 커밋을 실행하지 않았다. `project-maintenance.json`의 다른 작업 변경과 기존 index를 보존한다. 이후 목록·카드 담당이 후속 수정 범위와 검증·정리 근거를 대조해 해당 작업 커밋을 마무리한다.

후속 정리 최종 결과: native apply는 `aborted:false`, 실제 삭제 4항목·보류 18항목으로 끝났다. 정상 temporary 네 group의 삭제 오류는 없고 `remaining:false`였으며 기본 finalize로 실제 부재·참조 없음 확인 후 기록도 정리했다(모두 exit 0). 보류는 evidence 여덟 group과 보호된 실패 temporary 두 group이며 위 재검토 조건을 native에 적용했다. 초기의 잠금 해제 대기와 후속의 보류된 무조건 삭제 결정을 현재 보호 관측에 맞춰 이 결과로 대체한다. 기능 검사 이후 정리 대기는 06:20 UTC에 종료됐으며 새 제품 빌드나 기능 검사 재실행에 따른 대기가 아니다. 실사용 주소가 새 모듈을 HTTP 200으로 제공하고 checkbox 코드가 없으며 기본 다중 선택 동작이 포함됨을 확인했다.

작업 변경 19개를 같은 작업으로 커밋한다. `project-maintenance.json`의 index에는 이 작업의 두 검사 묶음만 분리해 두었으며, working tree의 다른 보드·다른 작업 변경은 보존한다. 보호된 실패 자료의 후속 retirement는 지원 절차가 준비됐을 때 위 재검토 조건을 따라 진행한다. 이 작업은 원격 push·게시·Azrael 빌드·설치를 수행하지 않았다.
