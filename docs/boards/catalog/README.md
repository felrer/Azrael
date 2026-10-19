# 목록·카드 시험 보드

상태: `partial` — Windows Chrome에서 폴더·목록 관리와 카드·필터 검색 모듈의 더미 편집·파일 저장·복구를 확인했다. Linux/macOS는 미검증이다.
GrowKick의 `tools/asset-editor` 분류 화면에서 폴더 표시, 카드 필터와 선택을 분리하는 동작을 재사용한다.
게임 전용 티어·수치·3D 뷰어와 원본 파일 연결은 포함하지 않는다.

프로젝트 루트에서 Node.js 22 이상으로 실행하고 표시된 주소를 연다. 패키지 설치와 번들 빌드는 필요 없다.

```powershell
node docs/boards/server.mjs --board catalog --port 4320
```

기본 주소는 `http://127.0.0.1:4320/`다. 터미널에서 Ctrl+C로 종료한다.

좌측에서 폴더와 목록을 추가·접고, 행을 드래그해 순서를 바꾼다. 가로선이 삽입 위치를 표시한다.
목록을 폴더 이름 위에 놓으면 그 폴더로, 폴더 밖 목록 영역에 놓으면 루트로 이동한다.
행을 우클릭하면 상세 설정에서 이름·소속 폴더 변경과 삭제를 할 수 있다.
키보드는 행에 초점을 두고 Shift+F10 또는 메뉴 키로 설정을 열고 Alt+위/아래로 같은 그룹 안에서 순서를 바꾼다.
폴더는 한 단계이며 목록을 묶는다. 행에는 별도 설정·위/아래 버튼을 두지 않는다.
폴더 삭제는 그 목록을 루트에 남기고, 목록 삭제는 항목을 미분류로 남긴다.
전체·미분류·선택 목록의 카드를 이름/ID/태그 검색과 종류·검토 상태 필터로 좁힌다.
필터는 AND로 조합하며 필터 변경이 선택이나 자료를 삭제하지 않는다.
카드를 누르면 기존 선택에 추가하고, 선택된 카드를 다시 누르면 해당 카드만 선택 해제한다.
체크박스와 보조 키 없이 기본 다중 선택하며 선택된 카드는 윤곽선으로 표시한다.
상단 버튼으로 표시된 카드 전체를 선택하거나 해제할 수 있으며 필터에 숨겨진 선택은 유지한다.
항목의 목록 배정·이름·종류·검토 상태·태그·메모를 바꾸고 수동 **저장**한다.
저장 전에는 편집본이며 재열기·백업 복원·저장 위치 변경 시 편집본 폐기를 확인한다.
유효하지 않은 이름·태그·메모는 카드별 입력으로 보존하고 오류를 표시하며, 수정 전까지 파일 저장을 차단한다.
기존 저장 모듈의 버전 충돌·백업·복구·고정 전달본 계약을 그대로 사용한다.
전달한 `result.md` 경로를 대화에 보내면 저장된 선택 항목과 이 보드의 해석 지침을 함께 읽을 수 있다.

기본 자료는 `artifacts/board-data/catalog/`, 저장 위치 설정은 `artifacts/board-storage/catalog.json`에 둔다.
첫 자료는 더미 항목으로 시작하며 기존 저장 자료를 자동으로 덮어쓰지 않는다.
설정에서 파일 위치와 백업을 확인한다. 저장 위치 변경은 해당 폴더의 자료를 열며 기존 파일을 이동하지 않는다.
입력은 최대 폴더 50개·목록 100개·항목 2000개, 전체 JSON 1.5 MiB다.
오류는 화면의 메시지와 requestId로 데이터 폴더의 `board.log`에서 추적한다.
로그의 필드·2 MiB 제한은 [공통 계약](../README.md)을 따른다.

## 두 모듈의 사용 계약

두 모듈은 `shared/modules/`의 vanilla ESM과 `catalog-widgets.css`를 사용한다.
먼저 `/shared/board.css`의 공통 테마 토큰을 적용하고 각 모듈을 다른 DOM 컨테이너에 마운트한다.
각 모듈은 `update(props)`와 `destroy()`를 반환하며 API 호출·파일 저장을 수행하지 않는다.

`mountFolderList(root, {onNavigate, onAction})`는 `update({document, scope})`를 받는다.
`scope`는 `all`, `unassigned`, 또는 목록 ID이며 탐색은 `onNavigate(scope)`로 전달한다.
생성·이름 변경·폴더 배정·접기·순서 변경·삭제는 `onAction(action)`으로 호출자에게 전달한다.
드래그는 `{type:'folder.move', id, beforeId}` 또는 `{type:'list.move', id, folderId, beforeId}`를 전달한다.
`beforeId:null`은 해당 그룹의 끝이며 목록의 `folderId:null`은 루트다. 한 번의 액션이 순서와 소속을 함께 바꾼다.
키보드 정렬은 기존 `{type:'folder.move'|'list.move', id, direction:-1|1}`을 사용한다.

`mountCardBrowser(root, {onSelect, onFilterChange})`는 `update({items, lists, selectedIds, filters})`를 받는다.
`filters`는 `{query, kind, status, scope}`이며 kind/status의 `all`은 제한 없음이다.
`onSelect(ids)`와 `onFilterChange(filters)`로 선택·검색 상태를 호출자에게 돌려준다.
`filterCards(items, filters)`는 화면과 동일한 필터 조합을 순수 함수로 제공한다.

호출자는 문서·선택·필터·되돌리기 이력·저장을 소유한다. `board.js`가 조합 예제다.
편집은 공유 `catalog-model.mjs`의 `applyCatalogAction`으로 검증하고 저장 계층은 같은 모델을 검증한다.
문서는 ID로 폴더·목록·항목을 연결하며 이름 변경이 연결을 바꾸지 않는다.
이 페이지의 작은 더미 미리보기는 실제 GrowKick 자산을 읽지 않는다.

반복 검사는 프로젝트 관리 도구에서 `boards-catalog-unit`, `boards-catalog-ui` 묶음을 선택한다.
직접 실행하는 동일한 검사 진입점은 다음과 같다. 화면 검사는 Chrome이 필요하며 `BOARD_CHROME_PATH`로 실행 파일을 지정할 수 있다.

```powershell
node docs/boards/tests/catalog-verify.mjs unit
node docs/boards/tests/catalog-verify.mjs ui
```

각 실행은 `artifacts/tasks/CN-01-catalog-modules/runs/<run-id>/`에 소유를 먼저 등록한다.
`temporary/`의 시험 자료·Chrome 프로필은 실행 종료 후 관리 도구의 검토·결정으로 정리하고,
검사 결과와 화면은 필요한 수용 근거로 보존한다. 사용자 자료는 시험 정리 대상에 포함하지 않는다.
검사 범위와 현재 근거는 [작업 기록](../../../work/CN-01-catalog-modules/01-plan.md)을 따른다.

의도 대상은 Windows x64·Linux x64·macOS ARM64의 로컬 Node/현대 브라우저이며 실제 검증 범위는 작업 기록에 둔다.
Azrael 호스트 내장·원격 공유·GrowKick 적용은 별도 작업이다.
