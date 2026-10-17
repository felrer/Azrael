상태: 소스 수정·검증·임시 프로필 정리 완료. 제품 빌드·설치와 설치 창 검증은 별도 단계다.

# 재개 대기 세션의 두 목록 진행 표시

## 목표와 권한
최근 채팅 팝업과 사이드바 채팅 목록에서 재개 조건을 기다리는 세션에도 기존 로딩 표시가 나타나야 한다. 사용자가 제안한 수정의 구현을 승인했다. 실제 목록 상태 생성과 관련 검사·문서를 수정하고 검증·정리 후 작업 단위로 커밋한다.

공통 webview 동작으로 Windows x64, Linux x64, macOS ARM64에 적용되는 제안이다. 실제 검증은 Windows, 설치된 2026.0.8의 JavaScript 함수와 pinned React/CSS를 사용하는 독립 Chrome 렌더 범위다. 사용 중인 VS Code 창의 live notification 경로와 Linux/macOS는 검증하지 않았다.

## 확정한 원인
설치된 `C:/Users/felre/.vscode/extensions/azrael-ex-local.azrael-2026.0.8/webview/assets/`에 대기 표시 transform은 존재한다. 그러나 서로 다른 자료구조 사이에서 대기 값을 잘못 읽는다.

실제 목록 상태 생성 경로는 `Xbn.getListState → getListSummary → vQ → F_n`이다. `vQ`가 생성하는 목록 요약에는 `isRootResumePending`이 없다. `scripts/inject-deferred-turn.cjs`는 이 필드를 별도 메타데이터 생성 함수인 `Pbn`에 추가하고, 목록 상태 함수 `F_n`에서는 `t.isRootResumePending`으로 읽는다. 여기서 `t`는 `Pbn` 결과가 아니라 `vQ` 결과다.

따라서 전체 대화가 이미 로드되어 최신 턴이 deferred/waiting이어도 목록 상태의 `isRootResumePending`은 undefined다. native `Gjr` 행은 idle 상태를 이 값이 참일 때만 loading으로 바꾸므로 두 목록 모두 로딩이 빠진다. 대화 미로드 여부나 별도 예약 구독 부재를 주원인으로 본 앞선 가설은 이 재현으로 대체한다.

## 기존 검사가 놓친 이유
`test-deferred-turn.cjs`의 첫 검사는 `Pbn` 결과를 `F_n`의 두 번째 인수로 전달한다. 실제 호출에서는 `vQ` 결과를 받으므로 테스트에서만 대기 값이 존재한다. `verify-session-flags-render.mjs`는 이 값을 fixture에서 직접 주입한다. 아이콘 렌더는 검사하지만 실제 producer에서 값이 빠지는 결함은 검사하지 않는다.

## 재현과 수정안 비교
초기 진단 명령은 `node work/BZ-01-resume-list-indicators/reproduce.cjs projection-and-render-03`, 실제 exit code **0**이었다. 일회성 진단 소스는 실제 producer를 검사하는 영구 회귀 검사로 대체해 정리한다.

설치본에서 실제 getListSummary/getListState/vQ/F_n, 최신 턴 selector와 대기 helper를 추출해 실행했다. 합성 대화의 최신 턴은 deferred/waiting이다. 실제 producer의 대기 값은 undefined, 기존 테스트처럼 Pbn을 넣으면 true였다.

메모리 내에서만 F_n의 계산을 `isRootResumePending:azraelIsRootResumePending(a)`로 바꿨다. a는 F_n이 이미 구한 최신 턴이다. 수정안은 waiting/claimed에서 true, cancelled와 completed 턴에서 false였다. `isResponseInProgress`와 `isConversationInProgress`는 false를 유지했다.

이 결과를 native 팝업 메뉴와 사이드바 preview에 전달해 실제 React/CSS로 렌더했다. Windows Chrome light/dark 모두 현재 코드의 두 목록에는 spin이 없었다. 수정안은 waiting/claimed에서 두 목록에 spin이 생기고 cancelled/completed에서 사라졌다. 렌더 확인 20개와 브라우저 오류 없음 1개가 통과했다. 헤더는 별도 판정이므로 목록 행과 구분했다.

증거:
- [설치본 producer 결과와 입력 SHA-256](../../artifacts/tasks/BZ-01-resume-list-indicators/runs/projection-and-render-03/projection.json)
- [렌더 결과·exit·브라우저 종료·정리](../../artifacts/tasks/BZ-01-resume-list-indicators/runs/projection-and-render-03/render/summary.json)
- [현재 코드 light](../../artifacts/tasks/BZ-01-resume-list-indicators/runs/projection-and-render-03/render/light-nativeWaiting.png), [수정안 light](../../artifacts/tasks/BZ-01-resume-list-indicators/runs/projection-and-render-03/render/light-candidateWaiting.png), [수정안 dark](../../artifacts/tasks/BZ-01-resume-list-indicators/runs/projection-and-render-03/render/dark-candidateWaiting.png)

렌더는 pinned native 함수/CSS와 대체 host/query 훅을 사용하는 독립 fixture다. 실제 엔진 예약 생성이나 모델 호출은 없었고 사용자의 세션·예약을 변경하지 않았다. 설치 창 전체의 E2E 재현으로 표현하지 않는다.

## 구현 결과
1. `inject-deferred-turn.cjs`의 F_n transform에서 없는 summary 필드를 읽는 대신, 이미 확보한 최신 턴과 기존 helper로 직접 계산한다. 두 목록은 기존 공통 listState를 소비한다. 별도 예약 저장소나 polling은 추가하지 않았다.
2. `deferred-list-state-fixture.cjs`가 실제 getListState → vQ → F_n 경로와 native 최신 턴 selector를 추출한다. `test-deferred-turn.cjs`는 legacy/canonical 기록, waiting→claimed→resumed/cancelled/blocked, 종료 턴과 새 실행 턴, 동일 turn ID 및 캐시된 summary를 재사용하는 상태 변경을 검사한다. runtime admission은 fixture에서 false로 공급하므로 엔진 실행 수용 검사로 확대하지 않는다.
3. `verify-session-flags-render.mjs`는 실제 producer 결과를 두 목록에 전달한다. 두 테마에서 대기/claimed의 spin, resumed/cancelled/blocked/completed의 해제와 기존 플래그·보관·이동 동작을 검사했다. live 알림과 reload의 설치 창 수용은 별도이며 빌드·설치 요청 시 패키지 절차를 적용한다.

Pbn/Fbn의 변경 감지, deferred 턴의 시간 동결과 입력 동작을 보존한다. 기존 `docs/architecture/root-resume.md`의 Recent-chat waiting indicators 계약을 유지하고 실제 producer 경계와 수용 범위를 명시했다. feature inventory의 ui.deferred-turn 소유자와 해당 helper를 읽는 두 cached source check의 입력을 갱신했다.

## 최종 검증
- `node --test scripts/test-deferred-turn.cjs`: 44개 통과, exit 0, 177초. 전체 UI transform 경로가 포함되어 실행 시간을 지배했다.
- `node --test scripts/test-ui-test-transform-fixture.cjs scripts/test-namespace-cache-owner.cjs`: 10개 통과, exit 0.
- `node scripts/verify-session-flags-render.mjs`: 렌더 assertion 81개 통과, Chrome exit 0. 자동 정리의 보고서 경로가 lifecycle member 내부라 명령 전체는 exit 1이었다. 보고서 경계 충돌을 확인한 뒤 소유 프로세스 참조 0개와 실제 종료를 확인하고 일반 PowerShell 삭제로 fixture 부재를 검증했다. 이 후속 정리는 exit 0이며 원래 명령의 exit 1은 덮어쓰지 않았다.
- [명령·범위·exit·소스 SHA-256](../../artifacts/tasks/BZ-01-resume-list-indicators/runs/implementation-01/verification.json), [source 로그](../../artifacts/tasks/BZ-01-resume-list-indicators/runs/implementation-01/source.log), [렌더 결과와 스크린샷 목록](../../artifacts/logs/BZ-01-implementation-01/summary.json).

기존 사용 중인 창의 예약과 대화, 설치 파일을 변경하지 않았다. 제품 빌드·설치와 Windows live event/reload, Linux/macOS 수용은 이번 검증에 포함하지 않았다.

## 실행·정리 기록
첫 진단은 VM 의존 함수 eQ 누락으로 exit 1, 두 번째는 메뉴의 edge-fade까지 스피너로 센 측정 오류로 exit 1이었다. 세 번째는 spin 애니메이션만 검사해 exit 0으로 종료했다. 진단 재시도 원인은 제품 오류와 구분한다.

진단 Chrome 두 실행과 구현 검증 Chrome은 모두 exit 0이다. 실제 프로세스 목록에서 임시 profile 참조가 없음을 확인하고 일반 PowerShell 삭제로 각 경로의 부재를 확인했다. native maintenance review/apply에서 실패한 진단 01/02 그룹을 삭제하고 경로 부재와 producer metadata 정리까지 확인했다. 일회성 진단 스크립트는 영구 회귀 검사로 대체해 삭제했다. 진단 03 그룹(약 128 KB)과 구현 검증 그룹(약 259 KB)은 native review/apply에서 defer했다. 다음 패키지의 설치 창 알림/reload 수용 증거가 확보되면 필요한 증거를 해당 버전으로 이관한 뒤 이 작업 그룹을 삭제 검토한다. 사용자 파일이나 제품 설치본은 정리 대상에 포함하지 않았다.
