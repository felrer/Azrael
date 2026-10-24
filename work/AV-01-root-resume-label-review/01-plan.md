상태: 구현·검증·임시 프로필 정리 완료. 사용자 추가 응답 불필요.

# 재개 대기 조건별 문구

사용자 승인 범위는 조건별 표시 문구 변경과 필요한 소스·UI 검증이다. subagent만 있으면 “하위 에이전트 응답 대기중”, 작업 완료 신호만 있으면 “작업 완료 시 조기 재개”, 둘 다 있으면 “재개 조건 설정됨”, 시간만 있으면 접미사를 표시하지 않는다. 기존 경과초/설정초, 수동 재개, 사진, 종료 이력과 자동 재개 의미를 보존한다. 앱 빌드·설치는 범위 밖이다.

Windows x64, Linux x64, macOS ARM64에 공통인 webview 표시다. 실제 검증은 Windows Node와 headless Chrome의 기존 native React/CSS fixture에서 수행하며 설치본 및 다른 OS 수용을 주장하지 않는다.

기존 RootResumeWait는 canWakeEarly만 제공하고 관리 구독은 agentTasks/completionTasks를 제공한다. 기존 구독을 재사용하여 같은 예약의 같거나 최신 revision에서만 조건을 구분한다. 정보가 아직 없거나 오래되면 일반 문구를 유지한다. 신규 의존성이나 엔진 변경은 필요 없다. root-resume.md와 ui.deferred-turn 소유·검사 캐시 연결을 갱신한다. design-documentation 지침으로 해당 소유 문서에 계약을 반영한다.

루트가 순차 소유한다: helper와 제어 컴포넌트 → 기존 동작 및 렌더링 검사 보강 → Windows 실행 → 결과 검토·정리·작업 커밋. 기능 동작 검사는 세 조건, 정보 미확인/오래된 예약, 시간 전용과 종료 상태를 검사한다. 렌더링은 밝은/어두운 테마와 좁은 화면, 수동 재개 보존을 검사한다.

검증 실행 소유는 AV-01-condition-labels-20261017이다. 생성 전 계획 경로: artifacts/logs/root-resume-condition-labels/{behavior.log,render.log,ui/}, artifacts/verification/root-resume-condition-labels/ (Chrome profile 포함, 기존 경로 없음 확인 후 실행). 생성 명령은 node --test scripts/test-deferred-turn.cjs 및 node scripts/verify-deferred-turn-render.mjs이며 입력은 변경 소스와 pinned UI 26.1007.21434다. fixture는 기존 종료 정리 절차로 브라우저 종료·일반 삭제·부재 확인하고 로그/화면 증거는 이번 수용 근거로 보존하며 후속 대체 검증 때 재검토한다.

실행 시작: 2026-10-17 (KST). 동작 검사와 렌더링은 입력을 고정한 뒤 독립 실행했다. 첫 렌더링은 agent-only 문구 확인 후 fixture의 모듈 내부 store를 전역에서 호출하여 ReferenceError로 종료(코드 1)했다. 제품 코드 오류가 아니며 window.fixtureSetCondition 어댑터를 추가했다. 소유 브라우저 종료와 첫 fixture 제거는 성공했다. 재실행은 artifacts/logs/root-resume-condition-labels/render-2.log, ui-2/ 및 artifacts/verification/root-resume-condition-labels-2/를 사용한다. 동작 검사 입력은 변경하지 않았다.

## 최종 검증과 정리

- Windows `node --test scripts/test-deferred-turn.cjs`: 43/43 통과, 실제 종료 코드 0, 119.65초. 사용자 승인 로그 정리 후의 독립 검증 요약과 원래 렌더 summary SHA-256: [보존 근거](../DN-01-disk-cleanup-candidates/preserved-verification.json).
- Windows Chrome `node scripts/verify-deferred-turn-render.mjs` 재실행: 밝은/어두운 테마 106개 검사 통과, 실제 종료 코드 0. 위 보존 근거에 source SHA-256·검사 목록·결과를 이관했다. 세 조건 문구, 시간 전용, 좁은 화면, 사진·마우스/키보드 수동 재개 및 이력/시간 회귀를 포함한다. 당시 밝은/어두운 waiting-controls와 좁은 화면 이미지를 직접 확인했다. 원시 로그와 이미지는 사용자 승인 정리 대상이다.
- 첫 렌더링의 fixture 오류 수정 때문에 렌더링만 재실행했으며 동작 검사 입력 의미는 동일하다. 최종 변경 중 기존 혼합 줄바꿈 파일의 추가 줄 CRLF를 LF로 정리했으며 실행된 JS 의미·기대값은 변하지 않았다.
- git diff --check 및 기능 목록 JSON 파싱 통과. ui.deferred-turn의 기존 검사 연결에 helper 소유와 캐시 입력을 추가했다.
- 두 실행의 Chrome 종료·fixture/profile 일반 삭제 성공(각 cleanupExitCode 0). artifacts/verification/root-resume-condition-labels 및 root-resume-condition-labels-2 부재를 별도로 확인했다.
- 로그/화면 증거 245161바이트는 AV-01-condition-labels-20261017 관리 그룹으로 관리한다. 사용자가 로그 정리를 승인하여 필요한 독립 요약을 위 보존 근거로 이관했고, 원시 그룹의 삭제·실제 잔여 결과는 [정리 작업](../DN-01-disk-cleanup-candidates/05-formal-cleanup-result.md)에서 확인한다. 새 임시 프로필 잔여 없음. 기존 공용 변환 캐시는 원래 소유 정책을 유지한다.
- 전체 앱 빌드·설치, 실제 설치본, Linux/macOS 검증은 수행하지 않았다. 자동 재개 조건·엔진·프로토콜은 변경하지 않았다.
