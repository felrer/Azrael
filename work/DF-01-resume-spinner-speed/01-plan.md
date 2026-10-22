상태: 소스 구현 및 Windows 검증 완료. 빌드·설치는 미실행. 검증 생성물은 관리 잠금 오류로 보존.

재개 대기 중인 세션 목록 로딩 원을 기존의 절반 속도로 회전시킨다. 실행 중 속도와 기존 상태/입력 동작을 보존한다. Windows x64, Linux x64, macOS ARM64 공통 UI이며 실제 검증은 Windows Chrome에서 수행했다.

기존 Gjr → BZ → fkr → native spinner 경로를 재사용한다. 대기 상태를 memo 키에 반영하되 호출자에게 loading 상태를 유지한다. spinner의 as 확장점으로 회전 컨테이너에만 4초 주기를 적용한다. 기본 실행 주기는 실제 CSS에서 확인한 2초다. reduced-motion 동작은 유지한다. 소유 문서는 docs/architecture/root-resume.md, 보존 기능은 ui.deferred-turn이다.

소유자 root. 상태/주기 수정 → 소스 및 light/dark 렌더링 검사 → 생성물 검토 → 작업 변경만 커밋. 추가 사용자 결정 없음. 제품 빌드·설치는 범위 밖이다.

검증:
- node --test scripts/test-deferred-turn.cjs scripts/test-thread-branch.cjs scripts/test-ui-test-transform-fixture.cjs scripts/test-namespace-cache-owner.cjs scripts/test-work-segment-folding.cjs: 67개 통과, exit 0, 약 145초. source.log 보존. 최종 회전 주기 변경은 최종 렌더링으로 검증했다.
- node scripts/verify-team-ui-render.mjs: 최종 실행 exit 0. 팝업/사이드바와 light/dark에서 실제 대기 회전 4초, 실행 복귀 2초, 대기 종료 표시 제거 및 기존 상호작용 통과. render-r4.log에 runRoot 기록. 해당 logs/summary.json과 스크린샷 보존. light sidebar와 dark popup 이미지 직접 확인.
- 최종 JavaScript 문법 및 작업 파일 diff 공백 검사 통과.
- 초기 렌더링 세 번은 적용 위치와 기본 주기 확인 과정에서 실패했고 최종 수정 후 통과했다. 실패 자료는 원인 추적용으로 보존.
- 관리 도구 테스트 계획 호출은 응답 지연으로 중단. 기존 직접 테스트 명령은 실제 exit 0으로 완료. 생성물 등록 시 exclusive maintenance lock unavailable (abandoned locks require explicit recovery) 오류가 발생하여 삭제하지 않았다. 잠금은 변경하지 않았다. 잠금 복구 후 네 렌더링 실행을 등록·검토하고 최종 증거를 보존한 뒤 불필요한 fixture/profile을 정리한다.

대기 절반 속도, 실행 속도 복원, 두 테마/두 목록 일치, 관련 회귀 검증 기준 충족. Linux/macOS 네이티브, 패키지 및 설치 앱 검증은 별도다.
