상태: 소스 구현·대상 검증 통과 — 전체 화면 및 설치 반영은 미검증.

# 중복 MCP servers 설정 메뉴 통합

## 승인 범위와 보존

MCP servers의 관리 기능을 포함하고 Add/Browse directory가 있는 Plugins만 주 관리 메뉴로 남긴다. 기존 MCP 설정, 서버, 권한, 연결 상태와 나머지 메뉴는 유지한다. 이전 Presets/Window use 이름 변경도 유지한다.

공통 UI 변경이며 Windows에서 검사했다. macOS/Linux 실환경 검증은 하지 않았다. native Plugins capability가 없을 때는 기능 상실을 막기 위해 기존 MCP 접근을 유지한다. 새로운 제품 capability나 서버 실행 권한을 추가하지 않는다.

## 구현

- 실제 MCP 페이지는 Plugins 컴포넌트에 manageOnly:true를 전달하는 래퍼다.
- native Plugins availability를 이미 추적하는 section filter에서 중복 MCP 메뉴를 제외한다.
- 이전 MCP URL은 full Plugins 컴포넌트를 렌더링하는 별칭으로 유지한다.
- 기존 inject-instruction-settings.cjs 경계와 namespace pipeline의 asset 목록을 재사용한다. 관련 계약은 docs/architecture/ui-presentation.md, preservation은 ui.instruction-settings이다.
- 실제 native filter와 old-route renderer를 실행하는 테스트를 기존 파일에 추가했다. 메뉴 정리나 upstream 갱신 시 MCP 접근/Plugins 추가 액션을 누락할 수 있으므로 이 작은 검사는 유지한다.

## 검증

- node --test scripts/test-instruction-settings.cjs scripts/test-use-settings-ui.cjs: 16개 통과, 실제 exit 0.
- namespace-azrael-host.cjs transformAsset으로 실제 visibility asset와 legacy MCP settings asset을 각각 변환했다. 두 파일 모두 변경 적용 및 TypeScript JavaScript parseDiagnostics 0, 실제 exit 0.
- Plugins capability 양쪽 상태, 다른 메뉴 보존, 재주입 idempotence, old route에서 manageOnly가 없는 전체 Plugins 호출을 검증했다.
- 앞선 01-plan.md의 기존 Design anchor 불일치는 이 변경 범위에서 해결하지 않았다. 이 결과를 전체 native 화면 검증이나 앱 설치 완료로 확대하지 않는다.
- 실제 light/dark 화면 검증, 패키징·설치·작업 커밋은 보류 상태다. 기존 필수 통합 검사 실패와 다수의 unrelated staged/working 변경이 남아 있다.
- 이번 작업의 일회성 파일, 빌드·브라우저 산출물은 없다. 이 문서는 유지할 작업 기록이다.

## 다음 단계

기존 Design 통합 오류를 해결한 뒤 최종 native 화면과 설치 반영을 확인한다.
