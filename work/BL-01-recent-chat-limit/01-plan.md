상태: 소스 구현·검증 완료 — 사용자 추가 응답 불필요. 실행 중인 앱 적용은 전체 빌드·설치 지시 후 가능.

최근 채팅 기본 조회를 50개에서 100개로 늘린다. 사용자 요청으로 소스 수정·검증·작업 커밋이 승인됨. 전체 빌드·설치·게시 요청은 없음.

공통 요구: Windows x64, Linux x64, macOS ARM64의 공유 UI 조회 정책 변경. 검증은 Windows에서 pinned native JavaScript 경로를 실행한다. 타 OS 네이티브 및 설치본 검증은 별도.

기존 guarded recent-chat injector를 확장하여 기본 요청·fallback·hydrated row cap·확장 분기 기준을 100으로 맞춘다. 기존 cursor pagination, 500개 확장 정책, catalog/disabled, workspace/provider/archive/source filters와 화면 컴포넌트를 보존한다. 새 의존성 불필요. cache asset mapping 및 기존 보존 검사를 갱신한다.

root가 관련 injector, 등록 검사, 소유 계약 및 작업 기록을 순차 수정하고 native refresh method 실행으로 100개·pagination·500개 확장·disabled 경로를 검증한다. 기존 변경은 별도 보존하며 이번 변경만 커밋한다.

검증: Windows에서 pinned native `runRecentConversationRefresh` 및 discovery policy를 실행했다. 기본 100개, 37개씩 돌아오는 페이지의 cursor 누적, 확장 500개/최근 hydrated 100개, disabled 및 필터 순서를 확인했다. UI 모양·컴포넌트 변경 없음; 실제 설치 화면·타 OS 네이티브 검증 없음.

`node scripts/test-feature-preservation.cjs --recent-chat-check`: 종료 0, `artifacts/logs/recent-chat-limit/behavior.log`. 내부 recent-chat 검사 2개 통과.
`node --test scripts/test-namespace-source.cjs scripts/test-namespace-cache-owner.cjs`: 10개 통과, 종료 0, `artifacts/logs/recent-chat-limit/integration.log`. workspace/provider request 계약 및 cache cold/warm 동일성을 확인했다. 테스트 자체의 fixture 정리 완료.
이번 작업 파일의 `git diff --check` 통과. 전체 저장소 검사는 기존 다른 변경의 whitespace 문제로 실패했으며 해당 변경은 보존한다. 공유 namespace/feature inventory는 이번 변경 부분만 별도 stage한다. 전체 빌드·설치·게시 및 사용자 대화 데이터 변경 없음.
