상태: 승인된 문구 변경과 검증 완료. 앱 빌드·설치는 수행하지 않음.

# 완료 플래그 대기 문구 검토

요청은 완료 플래그 대기에서 잘못 표시되는 자식 작업 완료 문구를 검토한 뒤, 사용자가 지정한 “재개 조건 설정됨”으로 변경하는 것이다. 코드·기존 테스트 기대값 수정과 필요한 검증을 수행한다. 전체 앱 빌드·설치는 범위에 포함하지 않는다. 공통 UI 표시 변경이며 실제 검증은 Windows 로컬 Node와 Chrome에서 수행한다. 다른 플랫폼이나 실행 중 배포본은 검증하지 않는다.

## 근거와 결론

`scripts/root-resume-wait.cjs:280`은 canWakeEarly가 true이면 대상 종류와 무관하게 자식 작업 완료 시 조기 재개라는 문구를 붙인다. `engine/codex-rs/protocol/src/root_resume.rs:106`은 agent_tasks 또는 completion_tasks 중 하나라도 있으면 can_wake_early를 true로 전달한다. RootResumeWait 요약에는 대상 종류가 없다. 따라서 완료 플래그만 선택해도 이 문구가 표시된다.

Windows Node에서 state=waiting, waitStartedAtMs=0, resumeAtMs=480000, canWakeEarly=true, agentTasks=[], completionTasks=[flag]를 표시 함수에 넣고 elapsedMs=64000으로 실행했다. 종료 코드 0이며 출력은 제보 이미지의 재개까지 최대 480초 대기 · 현재 64초 대기함 · 자식 작업 완료 시 조기 재개와 일치했다. 대상 배열을 추가해도 현재 함수는 읽지 않는다.

`scripts/test-deferred-turn.cjs:768`도 기존 문구를 기대한다. `extensions/azrael-ex/src/rootResumeView.ts:170`의 관리 화면은 agentTasks/completionTasks로 에이전트 전용·외부 작업 전용·혼합을 이미 구분한다.

## 권고와 검증 범위

사용자가 확정한 “재개 조건 설정됨”으로 표시 문자열과 기존 테스트 기대값을 수정했다. 기존 요약 프로토콜, 조기 재개 조건과 시간 계산 및 관리 화면의 대상 구분을 유지한다. 문서화된 동작 계약과 구조가 같으므로 아키텍처와 기능 보존 목록은 변경하지 않는다. 구현 소유 파일은 scripts/root-resume-wait.cjs와 scripts/test-deferred-turn.cjs다.

성공 조건은 조기 재개 조건이 있을 때 새 문구를 표시하고 시간 전용 및 종료 이력은 기존 문구를 보존하는 것이다. 기존 scripts/test-deferred-turn.cjs와 scripts/verify-deferred-turn-render.mjs를 재사용한다. 자동 재개 엔진이 실패한다는 근거는 없으며 실제 플래그 생성→자동 재개 전체 흐름과 실행 중 설치본의 출처는 별도로 검증하지 않는다. 로그는 artifacts/logs/root-resume-label/ 및 artifacts/logs/root-resume-label-render.log에 저장한다. 검증용 프로필과 fixture는 렌더링 스크립트의 종료 정리로 제거한다.

## 검증 결과

- `node --test scripts/test-deferred-turn.cjs`: 43개 통과, 종료 코드 0. 로그: artifacts/logs/root-resume-label/behavior.log.
- `node scripts/verify-deferred-turn-render.mjs`: Windows Chrome의 기존 native React/CSS fixture에서 밝은/어두운 테마 검사 98개 통과, 종료 코드 0. summary.json과 스크린샷: artifacts/logs/root-resume-label/ui/. 두 테마의 waiting-controls 스크린샷에서 새 문구를 직접 확인했다.
- 에이전트 전용·완료 플래그 전용·혼합·시간 전용 표시 함수 확인: 통과, 종료 코드 0. `git diff --check` 통과.
- 소유 Chrome 종료 후 fixture/profile 정리 성공, 종료 코드 0. artifacts/verification/root-resume-label의 부재를 확인했다. 로그와 소형 이미지 증거는 유지한다.
- 검증 입력의 마지막 변경은 테스트 파일의 수정 줄에 있는 CRLF를 LF로 정리한 것이며 의미나 기대값은 동일하다. 실행 중인 테스트가 로드한 내용과 제품 소스 의미는 같다.
- 다른 작업의 기존 변경은 커밋에 포함하지 않는다. 전체 앱 빌드·설치와 다른 플랫폼 검증은 수행하지 않았다.
