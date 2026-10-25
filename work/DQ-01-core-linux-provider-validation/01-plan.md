상태: Window Use Windows 전용 임시 제한 및 소스 회귀 완료 · 핵심 공급자 검증안은 제안 상태. artifact 등록은 maintenance 잠금으로 미완료. 빌드·설치·배포 미수행.

# 핵심 공급자·프로필·Linux 도구 검증

## 목표와 권한
사용자는 세부 UI보다 OpenAI, Anthropic, 사용자 API 모델 요청 전달, 필요한 도구 컨텍스트만 전달, 프로필 적용, Linux 도구 실행을 우선한다. 코드 검토 후 Windows를 제외한 Linux/macOS에서 Window Use 도구를 임시 제공하지 않도록 수정하는 권한을 받았다. 공급자 검증안은 제안 상태이며 실제 모델 호출·배포 권한으로 확대하지 않는다. 공통 의미는 모든 지원 플랫폼에 적용하며 Linux 실행 수용은 glibc Linux x64의 독립 데스크톱 환경에서 별도로 확보한다. Mac ARM64는 사용자 실사용을 활용한다. Windows 회귀는 공통 코드 수정 시 필요하다.

## 확인한 코드와 결론
- 실제 검토 소스는 docs/ops/development.md가 지정한 engine/이다. 실행 중 배포본과 동일하다고 주장하지 않는다. 기존 다수 미커밋 변경을 보존했다.
- engine/codex-rs/config/src/harness_profiles.rs: 기본→전역→공급자→실제 managed 공급자→정확한 모델 순으로 선택. 도구 ID는 Azrael/Claude 두 종류이며 OS별 ID는 없다.
- engine/codex-rs/core/src/tools/spec_plan.rs: 탐색·code-mode 구성 전에 프로필을 적용한다. 셸 Windows 설명은 실행 환경 OS를 반영한다. Claude Bash는 로컬 Unix Bash를 선택한다(handlers/claude_shell.rs). Linux 전체 프로필 복제 근거는 부족하다.
- scripts/window-control-mcp.cjs: toolDefinitions()는 공통 TOOLS 전체에서 스키마를 생성한다. Windows MSIX launch_isolated, logoff_isolated 설명 및 stage 2/3/4 스키마에 OS 조건이 없다. integrated-azrael-entry.cjs는 Linux의 acceptanceVerified Window Control도 활성화한다. 따라서 Linux MCP 활성화 시 Windows 전용 정의가 노출될 수 있다. 설치된 패키지의 실제 노출은 미검증이다.
- tools/src/api_context_policy.rs 및 core/src/tools/spec_plan.rs: 사용자 API 모델은 azrael_window와 node_repl 네임스페이스를 레지스트리에서 제외한다. 이 정책은 OS 선택과 별개이며 기존 제외를 Linux 검증에서 실패로 오인하면 안 된다. 정책 확대는 별도 결정이다.
- scripts/task-profile-runtime.cjs: persistent 컨텍스트는 developer instructions로, on-demand 자료는 스킬·참조로 구성하며 스냅샷과 대화 연결을 보존한다. validateHarness는 명시적 Anthropic toolProfile을 Claude로 제한하지만 엔진은 Anthropic의 Azrael 도구 선택도 허용한다. 실제 영향은 해당 조합 활성화 시 별도 확인해야 한다.
- providers/opencodex/inference-mapping.mjs: 프로필·실제 adapter 일치를 검증한다. tool_search 결과 이력은 별도 투영되며 Claude 경로의 발견 보존 규칙과 사용자 API의 제한을 동일하다고 간주하면 안 된다. 단일 총 토큰 상한 통과로 판단하지 않는다.

## 권고와 열려 있는 결정
확정: Window Use는 당분간 Windows에서만 제공한다. Linux/macOS에서는 호스트 활성화 전에 runtime.windowControl 바인딩을 제거하고, 오래된 설정이 MCP relay를 실행해도 빈 도구 목록과 호출 거부를 반환한다. 백엔드 소스와 사용자 상태는 보존한다. 공통 모델·작업 프로필은 복제하지 않는다. 다른 플랫폼 재활성화는 명시적 범위 결정과 검증 후 수행한다.
공급자 live 검증을 시작할 때 사용할 Linux 환경, 모델·인증 참조, 비용이 드는 요청 범위를 확정해야 한다.

## 최소 검증안과 수용 조건
1. OpenAI·Anthropic·사용자 API 각각에서 같은 사용자 표식 요청→도구 호출→결과 반영 응답을 확인한다. 결정적 로컬 fixture와 실제 공급자 왕복을 구분한다.
2. 검색 전에는 불필요한 전체 MCP 스키마가 없어야 하고 검색 후 필요한 전체 스키마가 현재 호출 가능 도구와 일치해야 한다. 반복 검색 시 중복 증가, 제거 도구 재유입, 과거 설명 반복을 검사한다. 최종 전송 페이로드의 도구명·개수·바이트·항목별 크기를 비교하되 자격증명·개인 프롬프트 원문은 기록하지 않는다.
3. harness 기본/공급자/모델 우선순위 및 작업 프로필 persistent/on-demand 표식, 새 대화와 재개, 비선택 대화 격리를 확인한다. Anthropic 기본 Azrael 및 명시적 Claude 구성을 구분한다.
4. Linux에서는 임시 작업 폴더에서 읽기·검색·수정·셸/PTY·도구 검색→호출을 실제 실행하고 종료 코드와 파일 결과를 확인한다. 공백·한글·대소문자 경로를 포함한다. Window Use는 Linux/macOS에서 임시 제공하지 않으며 도구 노출·호출 차단을 검사한다.
5. 동일 소스·설정·최종 배포 패키지 해시와 검증 환경에 결과를 결합한다. 기존 check-model-harness-profiles.cjs, check-api-context.cjs, 공급자 mapping/search-history 검사와 기능 inventory를 재사용하고 중복 검사를 만들지 않는다.

## 결과와 한계
정적 검토 후 승인된 Window Use 임시 제한만 구현했다. Linux 네이티브 실행, 현재 설치본 프로필 전달, 최종 공급자 전송과 라이브 모델 성공은 아직 확인하지 않았다.

## Window Use 구현과 검증
- 소유 범위: integrated entry 활성화, MCP 도구 제공/호출, 기존 두 회귀 파일, 플랫폼·Window Use 설계/운영 문서, feature inventory의 ui.window-control 항목, 전용 maintenance 검사 bundle.
- 기존 injected hook은 runtime.windowControl을 확인하므로 초기 바인딩 제거를 재사용한다. Windows 활성화는 기존 desktopControl 조건을 보존한다. Linux 엔진 감시·계정 재연결은 계속 활성화한다.
- 검증: Windows에서 `node --test scripts/test-integrated-entry.cjs scripts/test-window-control-mcp.cjs scripts/test-window-control-injection.cjs scripts/test-computer-use-injection.cjs scripts/test-window-control-errors.cjs`를 직접 실행하여 34개 통과, 실패/취소/생략 0, 실제 종료 코드 0을 확인했다. 실행 시간 약 25.7초. Linux/macOS는 VM 모의 플랫폼으로 빈 목록·명시 호출 거부·호스트 비활성화를 확인했다. 실제 네이티브 실행·패키지 설치 수용은 미수행이다.
- 로그: `artifacts/logs/dq-window-use-platform/verification.log`. 기존 wrapper 등 임시 fixture는 통과한 테스트의 finally 경로에서 정리했다. 새 회귀는 기존 retained 테스트 파일에 통합했으며 Windows 전용 임시 정책의 퇴행을 막기 위해 보존한다.
- maintenance 계획 호출은 장시간 응답 지연 후 중단 요청 시 `plan-8fdb63fb2954bffd756b707932b431aff3537f0d482cb8ab279dc1999b04b001`을 반환했다. 테스트 실행 영수증으로 간주하지 않으며 직접 실행 로그와 종료 코드를 근거로 삼는다. 같은 테스트를 중복 실행하지 않았다.
- 로그 group 등록 시 `exclusive maintenance lock unavailable (abandoned locks require explicit recovery)`가 반환됐다. 잠금을 우회·제거하지 않았다. 로그와 아래 작업 커밋의 분리 증거는 보존하며 잠금 소유자 종료/명시적 복구 후 등록을 재검토한다. 검증 내용의 실패가 아닌 artifact 등록 미완료 상태다.
- 커밋 준비: 다른 작업의 기존 staged 파일과 feature inventory 변경을 보존하기 위해 별도 index로 이번 파일 및 ui.window-control 추가분만 커밋한다. `artifacts/logs/dq-window-use-platform/commit.index`, `task.patch`는 작업 분리·index 복원 근거로 보존한다. 관리 잠금 해제 후 등록·보존 필요성을 재검토한다.
