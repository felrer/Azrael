상태: 소스 수정·격리 Windows 검증·정리 완료. 실제 설치본 적용은 미수행.

목표와 권한: 플래그가 Reload Window, 재시작과 버전 변경에도 복원되도록 수정하고, Codex 세션 가져오기 충돌 가능성을 검토한다. 사용자 요청에 따라 격리 프로필에서 재현과 수정 검증을 수행한다. 개인 상태·다른 세션 프로세스·실제 설치본은 변경하지 않는다.

범위: 저장·초안 복원은 공통 제품 동작이다. 실제 검증 환경은 Windows x64, 공식 VS Code 1.140.0, Azrael 2026.0.6 패키지 사본과 기존 w13e 엔진이다. Linux/macOS 검증과 실제 릴리스 업그레이드 수용은 미수행. 버전 모의검증은 동일 확장 ID와 프로필에서 사본 manifest만 2026.0.7로 바꾼다.

원인: 프로젝트 초안 주입 코드가 WebviewProvider에 없는 `this.getWorkspaceProject()`를 호출했다. 실제 소유자는 `this.fetchWrapper.extensionFetchHandler.getWorkspaceProject()`이다. 이 오류가 초기 persisted-atom 동기화 전체를 중단하여 디스크에 남은 플래그를 화면에 복원하지 못했다. 실제 격리 호스트에서 TypeError와 저장값을 함께 확인했다.

변경: `scripts/inject-project-drafts.cjs`의 초기 동기화·브로드캐스트·초안 쓰기 3개 경로를 실제 소유자로 연결하고 주입 marker를 v2로 갱신했다. `scripts/test-project-drafts.cjs` fixture도 실제 객체 구조를 사용하며 호스트 재생성 시 플래그·필터·초안과 다른 호스트의 플래그 보존을 검사한다. UI 설계의 소유자 경계와 `ui.session-flags`의 보존 owner/check를 갱신했다. 저장 스키마나 세션 ID는 변경하지 않는다.

가져오기 검토: `scripts/local-history-host.cjs`와 `sync-local-history.py`는 세션 파일/DB를 가져오며 ID를 보존하고 VS Code UI preference store를 수정하지 않는다. 검증한 Windows 2026.0.6 패키지에서는 localHistory가 비활성이다. 현재 증상의 재현 원인은 초안 복원 오류이며 Linux importer와 동시 세션의 모든 상황을 검증한 것은 아니다.

검증 준비 문제와 수정: 이전 시도는 ELECTRON_RUN_AS_NODE만 제거했고 renderer 초기화에 실패했다. 후속 실제 로그에서 설치 VS Code updater의 `vscode-updating` mutex와 exit 1을 확인했다. 사용자 updater에 개입하지 않고 별도 공식 VS Code ZIP, 독립 user-data/extensions/state, 동적 CDP/inspector 포트와 정리한 자식 환경으로 실제 renderer/extension host를 시작했다. 다른 세션의 renderer 테스트가 플래그 손실의 원인이라는 근거는 확인되지 않았다.

격리 검증: 개인 인증 대신 fixture에만 합성 인증 응답을 고정했다. 실제 생산 플래그 버튼과 native 호스트 저장·동기화는 그대로 실행했다. 합성 세션 2개를 실제 버튼으로 flag → native store에 true 2개 확인 → 수정 전 호출로 Reload 후 UI false 2개, store true 2개 및 TypeError 확인 → 수정 호출로 Reload 후 재클릭 없이 UI true 2개 확인. 하나 해제 → VS Code 완전 종료(exit 0)·재실행 후 false/true 유지. 사본 manifest 2026.0.7로 변경·재시작 후 false/true와 실제 host version 확인. 라이트/다크 화면도 실제 캡처로 확인했다. 추론 요청은 전송하지 않았다. 각 성공 CDP 명령 exit 0, exceptionDetails 없는 결과를 확인했다.

소스 검증: `node --test --test-concurrency=1 scripts/test-project-drafts.cjs scripts/test-session-flags.cjs`, 10 passed / 0 failed, exit 0, 약 11.34초. 무관한 cache suite를 포함한 최초 광범위 시도는 자원 경합 중 결과 없이 중단했고 해당 작업의 프로세스만 종료했다. 다른 세션 테스트는 유지했다. 제품 소스는 통과 이후 변경하지 않았으며 inventory의 필수 검사는 통과한 두 suite와 동일하다.

증거: `artifacts/logs/flags-retry-1791871101590/`에 입력 해시, 초기 updater 오류, baseline-reload-ui.json / baseline-reload-storage.json, fixed-reload-ui.json, restart-ui.json, version-restart-ui.json / version-host.json, targeted-tests.log, light.png / dark.png 및 소형 재현 driver를 보존했다. 기존 실패 증거는 `artifacts/logs/flags-reload-1791869401496/`에 유지한다.

실행 시간: 후속 fixture 준비 시작 2026-10-13T05:58:21.590Z, 완료 2026-10-13T07:41:11Z. 긴 준비 지연은 updater mutex, 합성 인증 fixture 조정 및 기존 테스트 자원 경합이었다. 입력은 사본에만 고정했고 재시도와 수정 전/후 비교를 구분했다.

정리: 격리 창을 정상 종료하고 fixture 참조 프로세스가 없음을 확인했다. 일반 삭제가 합성 상태에서 내려받은 플러그인의 .git 객체 3개 read-only 속성으로 실패했으므로 해당 fixture의 객체 속성만 해제하고 일반 삭제를 재시도했다. 삭제 exit 0과 fixture 경로 부재를 cleanup.json으로 확인했다. 공식 ZIP, VSIX 등 다른 작업의 원본은 유지했다.

남은 적용: 전체 배포 빌드와 실제 설치는 수행하지 않았다. build playbook은 일반 수정·검증 요청을 전체 빌드 지시로 해석하지 않도록 규정한다. 설치본에서의 사용자 상태 복원과 실제 릴리스 업그레이드 검증은 빌드·설치 지시 후 진행한다.
