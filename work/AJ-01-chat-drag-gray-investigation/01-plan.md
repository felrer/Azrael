상태: 재현된 드롭 후 입력 차단의 소스 수정·격리 반복 검증·원복·정리 완료. 회색 화면 전체와 실제 명령어 카드, 현재 설치 적용은 미검증/별도 범위다.

# 채팅 드래그 후 회색 화면 조사

## 목표와 권한

사용자는 명령어 영역을 드래그하고 드롭한 뒤 채팅 본문이 회색이 되는 문제의 원인 조사와, 격리 프로필에서 드래그 재현 및 오류 발견 시 해결 방안 제시를 요청했다. 후속 요청은 같은 원리로 발생할 수 있는 다른 오류의 조사다. 테스트 환경 준비·조작·정리와 관련 소스 검증은 승인된 범위다. 후속 요청에서 사용자가 코드 수정과 반복 검증을 승인했다. 추가 질의에는 VS Code 제품 파일 변경 제한의 예외로 호스트 수정 도구 제공까지 허용하고 상세 변경 보고를 요청했다. 기존 사용자 설치 적용은 별도 범위로 유지한다.

대상은 공통 UI 이벤트와 Windows VS Code 호스트 경계의 혼합이다. 실제 검증은 Windows 로컬 데스크톱에서만 수행했다. root가 조사·재현·해결 방안 판단을 담당했다. 성공 기준은 장애를 재현하거나 재현 한계를 명확히 하고, 확인된 오류의 원인과 수정 방향을 근거로 제시하는 것이다.

## 확인한 소스 경계

- 설치된 확장은 `C:/Users/felre/.vscode/extensions/azrael-ex-local.azrael-2026.0.6`이고 실행 엔진 경로는 `artifacts/w13b/artifacts/releases/w13e/engine/codex.exe`다. 등록된 버전만으로 기존 모든 창의 활성 버전을 단정하지 않는다.
- 설치 UI의 `webview/assets/app-initial-c014f9ee4429.js`에 있는 `SFi` 드롭 핸들러는 첫 단계에서 카운터·드래그 활성·Shift 표시·포털 대상을 해제한다. 관련 로컬 변환 소유자는 `scripts/inject-local-file-drop.cjs`다.
- VS Code 1.140.0의 `07f806f999/resources/app/out/vs/workbench/workbench.desktop.main.js` Webview 구현은 드래그 중 `_startBlockingIframeDragEvents()`로 iframe `pointerEvents=none`을 설정하고 `_stopBlockingIframeDragEvents()`에서 `auto`로 복원한다. `sle` 모니터는 `dragend` 또는 버튼을 놓은 `mousemove` 및 Shift 드래그에서 복원한다. 해당 모니터에는 `drop`·`blur` 복원 리스너가 없다.
- VS Code Webview preload의 내부 drop 핸들러는 `preventDefault()`를 호출한다. 링크 드롭의 기본 페이지 이동을 곧바로 원인으로 단정할 수 없다.
- 기존 사용자 VS Code 로그 `C:/Users/felre/AppData/Roaming/Code/logs/20261011T055937/window*/renderer.log` 6개와 `main.log`를 관련 오류 키워드로 제한해 확인했다. 관련 충돌·GPU·응답 없음 기록은 찾지 못했다. 폰트 리소스 오류는 일부 있었으나 이번 현상과 연결되는 근거는 없다. 로그 부재는 오류 부재의 증명이 아니다.
- 기존 Window Use 읽기 전용 캡처는 `native-error`, `actionExecuted=false`로 실패했다. 이전 사용자 창은 조작하지 않았다.

## 격리 환경과 실제 검증 범위

`artifacts/verification/chat-drag-repro-20261013` 아래에 프로필·확장 사본·CODEX_HOME을 분리했다. 실제 계정·대화는 복사하지 않았다. 모델 추론이나 시험 명령어 실행은 수행하지 않았다. 초기 프로세스 준비에서 VS Code 실행 환경 상속을 제거했으며, VS Code 1.140.0 새 창 실행은 `vscode-updating` mutex에 막혔다. 사용자 설치·업데이트·기존 창을 건드리지 않고 기존 portable VS Code 1.138.0으로 진행했다. 호스트 버전 차이가 있으므로 1.140.0 동일 재현·수용은 주장하지 않는다.

합성 인증 표시와 합성 명령어 턴은 native `thread/resume`에서 1개 턴으로 읽혔다. 하지만 설치 UI는 로그인 안내를 계속 표시했다. 실제 명령어 카드 렌더링을 완료하지 못해, 같은 설치 Webview 내부에 시험용 `<pre>` 명령어 텍스트·파일 링크를 삽입하여 VS Code modal editor 경계를 검증했다. 시험용 DOM과 인증 상태는 테스트 전용이며 제품 코드를 수정하지 않았다.

실행 기록: 테스트 호스트 시작 UTC `2026-10-13T04:27:22.364Z`, 검증 종료 UTC `2026-10-13T04:53:37.509814+00:00`. 준비 실패 후 환경 정리와 portable 호스트 전환을 거쳐 재실행했다. 같은 프로필에 여러 무거운 작업을 병렬로 실행하지 않았다.

## 재현된 오류

최초 Chromium 마우스 입력 실험에서 선택한 명령어 텍스트를 Webview 내부에 드롭하면 내부 `drop`·`dragend`가 전달되고 입력 차단이 복원됐다. 제목줄에 드롭하면 호스트가 `dragenter/dragover/drop`를 받지만 내부 종료 이벤트가 전달되지 않아 두 Webview가 `pointer-events: none`으로 남았다. DOM과 `visibility: visible`은 유지됐고 회색 본문 전체·렌더러 예외는 재현되지 않았다.

증거는 `artifacts/logs/chat-drag-repro-20261013/drag-results.json`, `selected-code-title-after.png`다. 후속 위치 비교는 일부 시행에서 drag 이벤트가 생성되지 않아 정상 동작의 근거로 사용하지 않는다. `matrix2`~`matrix5` 원시 결과는 시행 한계 확인용으로 보존했다. 텍스트·코드블록·파일 링크 전체 회귀 통과를 주장하지 않는다.

## 해결 방안의 비교 실험

제목줄에 Chromium `Input.dispatchDragEvent`로 합성 텍스트의 native `dragEnter/dragOver/drop`를 전달했다. 기록된 이벤트는 `isTrusted: true`다. 기존 상태에서는 드롭 후 두 iframe 모두 `none`으로 남았다. 테스트 페이지에만 붙인 capture-phase `drop` 리스너에서 iframe 입력 상태를 복원한 비교군은 모두 `auto`가 됐다. 이 리스너는 실험 종료 전 제거했다.

명령은 `node artifacts/logs/chat-drag-repro-20261013/guard-test.cjs`, 실제 종료 코드는 0이다. 증거는 `host-guard-result.json`이다. 이는 수정 방향의 실험이며 제품 구현·패키지·실제 명령어 카드 검증을 대체하지 않는다.

권고는 VS Code 소유 드래그 모니터의 종료 조건에 `drop`을 포함하고 기존 `windowDidDragEnd()` 복원 경로를 호출하는 것이다. `blur`·취소 경계도 필요성을 검토한다. 여러 Webview의 차단 상태를 함께 복원하며 파일 첨부·텍스트 선택·Shift 동작을 보존해야 한다. Webview 내부에만 리스너를 추가하는 방안은 호스트가 입력을 차단한 뒤 제목줄로 향하는 이벤트를 처리하지 못하므로 충분하지 않다. 후속 승인으로 명시적·가역적 호스트 복원 도구의 예외를 정했다. normal 빌드·설치 파이프라인은 호스트를 자동 변경하지 않는다.

## 유사 원리의 추가 조사

Windows VS Code 1.140.0 설치 호스트의 `sle` 모니터와 Azrael 2026.0.6 설치 UI의 `SFi` 함수를 그대로 추출하여 이벤트·React 상태 경계만 대체한 검증을 수행했다. root 단독으로 실행했으며 별도 호스트 실행이나 제품 수정은 필요하지 않았다. 소스 조각 SHA256, 실행 시각과 각 상태는 `artifacts/logs/chat-drag-repro-20261013/related-state-results.json`에 보존했다. 명령은 `node artifacts/logs/chat-drag-repro-20261013/related-state-test.cjs`, 종료 코드 0이다. native UI 재현이 아니라 실제 함수의 조건 검증이다.

| 조건 | 확인 결과와 범위 | 권고 |
| --- | --- | --- |
| 명령어 외의 드래그가 호스트 창을 통과하고 외부 영역에 드롭됨 | 모니터는 전송 형식 검사 없이 dragover에서 차단한다. drop만 전달되면 등록된 두 대상 모두 none으로 남는다. 기존 제목줄 native 재현과 같은 원리다. 파일·링크 각각의 실제 입력 재현은 추가로 하지 않았다. | 형식별 특례 대신 호스트 drop 종료 경로에서 기존 복원 호출 |
| dragover 후 종료 이벤트가 빠지고 창이 포커스를 잃음 | blur 자체는 해당 모니터에 복원 경로가 없어 none 유지. 정상 dragend 또는 buttons=0 mousemove가 오면 복원됨도 확인했다. 따라서 모든 창 전환·Esc 취소가 실패한다는 뜻은 아니다. | 취소·포커스·가시성 경계를 포함한 수명 관리. 진행 중 외부 드래그를 오판하지 않도록 후속 native 검증 필요 |
| 인식된 dragenter 뒤 인식되지 않는 dataTransfer로 dragleave 전달 | SFi의 leave는 전송 형식 게이트를 다시 통과해야 카운터를 감소시킨다. 조건 검증에서 counter=1, active=true, Shift 표시=true 유지. 일반 recognized leave는 정상 초기화됐다. 실제 Chromium이 해당 조건을 만드는 빈도는 미검증이다. | 종료 판단을 진입 때 확립한 세션 상태와 영역 이탈 여부에 연결. 하위 요소 간 이동을 보존하고 취소 시 일괄 초기화 |
| 같은 composer가 살아 있는 동안 포털 드롭 대상의 리스너가 제거·교체됨 | cleanup은 리스너만 제거한다. 함수 검증에서 counter·active·Shift 표시가 유지됐다. 전체 composer unmount는 React 상태를 소멸시키므로 별개이며 실제 포털 교체 흐름은 미재현이다. | 대상 교체 시 세션 상태와 표시 대상의 정합성 확보. reset effect가 기존 의존성에 의해 정상 드래그 도중 실행되지 않도록 설계 |

호스트의 `new sle` 호출은 Webview editor, sidebar Webview view, notebook Webview에 존재한다. 따라서 동일한 종료 이벤트 누락의 영향 범위는 Azrael 명령어 블록 하나에 한정되지 않는다. 각각의 제품 화면에서 native 재현한 결과로 확대하지 않는다. composer의 Xa/Za, Qa/$a, yee는 로컬 React state/ref이고 inspected owner에서는 SFi 외의 setter/reset 경로를 찾지 못했다. 드롭 표시 컴포넌트는 해당 상태를 사용하지만 그 색·범위가 사용자 사진 전체와 같다는 근거는 없다.

`scripts/webview-idle.cjs`와 `scripts/inject-webview-idle.cjs`의 수명 처리는 숨김 상태가 기본 1시간 지속된 뒤 snapshot 조건을 만족해야 본문을 비운다. 드롭 즉시 비우는 경로는 확인되지 않았으므로 현재 즉시 회색 화면의 원인으로 연결하지 않는다. 이 검토는 idle 기능 전체의 결함 없음 인증이 아니다. 로컬 파일 첨부 변환도 SFi의 drop 초기화 이후 실행되므로 전송 해석 실패 자체가 이 상태 잔류를 일으킨다는 근거는 없다.

우선순위는 호스트 종료 복원을 먼저 정하고, composer의 취소·이탈·포털 교체 종료 처리를 함께 검증하는 것이다. 필수 후속 검증은 실제 명령어 카드, 파일·링크·외부 앱 드래그, 창 밖 드롭·창 전환·Esc, 여러 Webview, 중첩 영역 이동, Shift 및 포털 대상 교체다. 새로 조사한 가능성이 회색 화면을 실제로 만든다고 확정하지 않는다.

## 승인된 구현과 인계 범위

사용자 승인: 격리 프로필에서 재현과 코드 수정을 반복하여 해결하고, 수정 내역을 상세 보고한다. 프로젝트 호스트 파일 변경 금지 계약의 예외는 별도 질의에 사용자가 “호스트 수정 도구까지 허용하되 작업 끝난 후 무엇을 수정했는지 상세히 보고해주세요”라고 승인했다. 기존 설치·사용자 창은 이번 적용 대상이 아니다. 공유 UI 의미와 Windows 호스트 적용 도구의 혼합이며 다른 OS의 실행 수용을 주장하지 않는다.

소유 변경은 `scripts/inject-local-file-drop.cjs`, `scripts/webview-drag-lifecycle.cjs`, `scripts/patch-vscode-webview-drag.cjs`, `scripts/test-webview-drag.cjs`, `docs/architecture/azrael-ex.md`, `docs/ops/webview-drag-repair.md`, `ui.local-file-drop` 보존 항목이다. 기존 다른 작업의 파일과 같은 JSON 안의 다른 기능 변경은 보존한다. 도구는 기존 host windowDidDragEnd 복원을 재사용하고, composer는 기존 reset·첨부 경로를 유지한다. 전체 빌드·패키지·현재 설치 변경 없이 JavaScript 변환과 native 경계만 검증한다.

순서는 기존 오류 재현 → 호스트 종료 복원 적용 → 동일 native 드래그·버튼 클릭 비교 → 새 프로필 반복 → 원복 동일성 확인이다. composer 수정은 이 순서와 독립적으로 소스 회귀 검사를 수행했다. native 입력은 실제 Chromium trusted drag 이벤트이며 내용은 synthetic이다. 원래 명령어 카드 전체와 사진의 회색 화면 전체를 재현했다고 확대하지 않는다.

첫 native 비교는 plain text, HTML, 링크, CodeFiles 파일 참조 4종 모두 기존 pointer none 및 버튼 clicks=0을 확인했다. 수정 호스트는 4종 모두 auto로 복원되고 바로 누른 실제 버튼의 clicks가 증가했다. Shift drop은 baseline과 수정군 모두 내부 drop surface에 전달됐다. 반복 시행 도구의 iframe 준비 레이스와 초기 inspector Promise collected 오류가 발견되어 준비 조건을 수정했으며, 그 시행은 통과 근거에서 제외한다. 시험 host 종료가 늦거나 초기 inspector가 유효하지 않은 시행은 별도 로그로 보존하고 해당 격리 host만 정상 quit 경로로 종료한다.

소스 검증 명령 `node --test scripts/test-webview-drag.cjs scripts/test-local-file-drop.cjs` 종료 코드 0, 12/12 통과. 로그는 `artifacts/logs/chat-drag-repro-20261013/fix-source-tests.log`. 두 Windows 호스트 소스 1.138.0·1.140.0에서 monitor 변환의 유일성 및 반복 무변경도 확인했다. native 검증 최종 명령 `node artifacts/logs/chat-drag-fix-20261013/native-test.cjs --resume` 종료 코드 0. 수정 호스트 두 번의 성공 실행에서 텍스트·HTML·링크·CodeFiles 8건 모두 pointer auto와 실제 버튼 clicks 증가를 확인했다. 이전 bootstrap 실패 시행은 최종 native-results.json에 보존하며 통과 수에 포함하지 않는다. 원복 SHA256은 `1a1255489cf3708d8acb91ac84d95dcd9290747b1942fc20e27842dfe963a1b1`로 원본과 일치한다. 성공 실행 시간은 UTC `2026-10-13T05:27:41.724Z`~`2026-10-13T05:41:49.811Z`이며 실패 분석·준비 조건 보완 때문에 재실행했다. native 증거·적용 영수증·원복 결과는 `artifacts/logs/chat-drag-fix-20261013`에 보존한다. 현재 설치의 Webview bundle은 읽기만 했다.

## 결론과 남은 확인

재현된 드롭 후 Webview 입력 차단은 호스트 종료 복원으로 수정했고 두 native 실행에서 반복 확인했다. composer의 전송 형식 변경 leave·포털 교체·취소 상태도 소스 회귀 검사를 통과했다. 파일 첨부 처리와 Shift 경로는 기존 소유자를 보존했다. 호스트 수정 도구는 사용자 승인에 따른 독립 opt-in 도구이며 normal 설치 파이프라인에는 연결하지 않는다.

수정된 Windows 1.138.0 격리 호스트 화면에는 VS Code 설치 무결성 경고가 실제 표시됐다. 제품 구성·체크섬을 바꿔 경고를 숨기지 않는다. 따라서 도구를 일반 확장 업데이트와 같은 수준으로 받아들이지 않으며, upstream 호스트 수정이 장기 경로다. 이 제약은 운영 문서와 최종 보고에 포함한다.

사용자 사진의 회색 본문 전체, 실제 명령어 카드, Windows VS Code 1.140.0 native 및 다른 OS는 해결·수용을 확정하지 않는다. 현재 사용자 설치본 적용·전체 빌드·패키징·배포는 수행하지 않았다. 공유 보존 JSON의 다른 기능 수정과 사용자 스테이징은 이번 커밋에 포함하지 않는다.

## 정리와 증거 보존

테스트 VS Code는 종료 코드 0으로 종료됐다. 격리 상태 삭제는 native 테스트 엔진이 만든 임시 플러그인 Git clone의 읽기 전용 파일·숨김 디렉터리에 막혔다. 생성 경로를 확인하고 같은 PowerShell에서 임시 속성을 정상화한 뒤 일반 `Remove-Item -Recurse`로 정리했고 경로 제거를 확인했다. 강제 삭제 옵션이나 다른 삭제 API를 사용하지 않는다. 정리 결과는 `artifacts/logs/chat-drag-repro-20261013/cleanup.json`이 소유하며, 증거·테스트 스크립트는 같은 로그 폴더에 보존한다.

추가 수정 검증 fixture `artifacts/verification/chat-drag-fix-20261013`는 host 원복 및 성공 프로세스 exit 0 후 정리했다. cleanup preview 첫 호출은 자체 명령행의 절대 fixture 경로를 active reference로 인식하여 보존했다. root 변수를 통해 호출하는 정상 경로로 다시 미리보기했고 selected 확인 후 기존 cleanup 스크립트를 적용했다. 종료 코드 0과 실제 경로 부재를 확인했다. 결과는 `artifacts/logs/chat-drag-fix-20261013/cleanup-final.json`, 요약은 `summary.json`이다. 기존 portable 호스트·현재 설치본·사용자 설정과 대화는 정리 대상이 아니다.
