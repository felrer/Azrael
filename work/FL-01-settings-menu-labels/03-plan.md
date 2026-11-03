상태: 소스 통합 수정 및 대상 검증 완료. 앱 설치는 수행하지 않음.

# Design와 Workbench 연결 기준 정합성 수정

- 승인: 현재 Presets의 AzraelWorkbenchSettings에 Design 주입 연결 기준을 맞춘다.
- scripts/inject-student-design.cjs의 단일 anchor 및 그 교체 결과를 현재 컴포넌트로 변경한다. 기존 단일 일치 안전 검사, 화면 기능, 경로 및 레이아웃은 유지한다.
- 공통 JS 통합 변경이다. Windows에서 기존 locale/navigation, 전체 namespace pipeline, native settings import와 설정 상태 테스트를 검증한다. macOS/Linux 및 설치된 앱은 별도 미검증이다.
- 기존 tests를 재사용하며 새 테스트나 의존성을 추가하지 않는다. 계약 변경이 없으므로 architecture 문서 변경은 불필요하다.
- 선행 01/02 계획의 메뉴 이름·MCP 통합 수정과 동시 작업 변경을 보존한다.

## 검증

node --test scripts/test-instruction-settings.cjs scripts/test-student-design.cjs scripts/test-use-settings-ui.cjs: 38/38 passed, actual exit 0, 26.48s. Previously failing native navigation, complete production transform pipeline and native imports all pass. No product build, installation or live light/dark verification was performed. This source integration fix changes no rendered component or layout; earlier presentation acceptance remains separate.

## 정리와 커밋

새 일회성 파일/빌드/브라우저 산출물 없음. 이 기록은 유지할 작업 문서다. 이 작업의 단일 source 변경과 이 계획만 작업 단위 커밋 대상으로 삼으며 다른 staged 변경은 보존한다.
