상태: 구현 중 — GUI 도구의 패키지 밖 정책 import 오류를 수정하고 기존 권한 검사를 보존한다.

# Sky 정책 모듈 패키지 경계 복구

사용자는 GrowKick의 동기화·저장을 막는 GUI 도구 오류 수정을 요청했다. 재개 대상은 기존 두 Studio이며 Chrome·Window Use 대체 입력 매크로를 사용하지 않는다. GUI 복구 뒤 기존 GrowKick 작업 기록의 동기화·저장 절차로 돌아간다.

원인은 computer-use-runtime.cjs가 Sky 내부 정책 모듈을 런타임 루트로 재수출하도록 생성하여 Node REPL의 node_modules 경계를 벗어나는 것이다. 권한의 단일 AsyncLocalStorage 소유자는 보존하고 배치만 반대로 한다. 패키지 내부에 실제 정책을 두고 루트 서비스 정책은 이를 재수출한다. 기존 manifest owner1 검증은 유지하고 새 producer는 owner2를 기록한다. 사용자 데이터·설정·동작 권한을 변경하지 않는다.

Windows x64 로컬 Node REPL과 Sky0.7.4가 직접 대상이다. 패키지 import 경계와 정책 의미는 공통이나 실제 GUI 검증은 Windows만 수행한다. macOS/Linux 제어 지원을 확대하지 않는다.

루트가 scripts/computer-use-runtime.cjs, 관련 두 기존 테스트, architecture/computer-use의 소유자 설명과 필요한 기능 인벤토리를 담당한다. 먼저 작은 원인 재현·정책 회귀 검사, 그다음 새 독립 Computer Use 구성과 실제 Node REPL import를 검증한다. 전체 엔진·앱 빌드나 실행 중 배포본 덮어쓰기는 하지 않는다. 설정 적용은 기존 환경 동기화 소유자 및 지원되는 MCP 재로딩 경로를 조사해 수행한다. 필요한 앱 권한은 기존 정책 그대로 판정한다.

성공 기준: 패키지 경계 안의 import; 서비스와 transport가 같은 정책 인스턴스 사용; 취소·거절·권한 세대·turn 전환 검사가 유지됨; manifest 변조/기존 버전/재배치 검사; 실제 도구 import와 Windows 관찰. 입력이 필요한 Roblox 작업은 이 수정을 인수한 뒤 기존 절차로 진행한다.

산출물은 이 작업이 artifacts/tasks/sky-policy-package-boundary/의 로그·분석·격리 실행을 소유한다. 새 독립 런타임은 인수 후 실제 사용 또는 복구 참조가 있는 동안 보존하며 임시 검사물은 종료 확인과 검토 후 일반 삭제한다. 기존 설치와 직전 복구본·다른 사용자 변경을 보존한다. 새 브랜치·원격 배포는 없다.

## 검증 및 인계 상태 (2026-10-18)

최초 패키지 경계 수정 뒤 새로고침으로 일반 @oai/sky import 성공을 확인했다. 실제 창 조회는 Trusted NodeRepl metadata is required 오류로 중단됐다. 원인은 공식 Node REPL 실행 파일에 포함된 createPrivilegedNodeReplBridge가 Object.freeze(Object.create(nodeRepl, ...))를 반환하여 requestMeta가 부모의 불변 getter로 제공되는 점이다. 기존 검사는 자신의 속성만 확인했다.

동결된 객체 사슬에서 가장 가까운 불변 getter를 찾도록 수정했다. 변경 가능한 자식/부모와 가려진 데이터 속성은 거부하며 매 호출마다 현재 turn을 읽는다. 기존 권한·설정 세대·취소·거절 검사는 유지했다. 5개 소스 검사 파일의 15개 테스트가 실제 exit 0으로 통과했다. source-tests.json과 source-tests.log에 결과를 보존했다. 최초 project_tests 실행의 exit 124는 통과 영수증으로 취급하지 않는다.

runtime-metadata-fixed를 별도로 생성하여 manifest 검증을 통과했다. 기존 런타임은 수정하지 않았다. 환경 소유자의 selectedConfig를 재사용해 node_repl 및 azrael_window 경로만 새 런타임으로 연결하고 나머지 설정 의미가 동일함을 확인했다. config-application-metadata.json과 staged-runtime-metadata-fixed.json에 경로와 해시를 남겼다.

실행 중인 MCP 서비스는 이미 로드한 코드를 유지한다. 관리 브리지는 config/mcpServer/reload를 허용하지 않아 새로고침이 한 번 더 필요하다. 브리지 제한을 우회하거나 프로세스를 종료하지 않았다. 새로고침 뒤 일반 import와 실제 창 조회를 재검증해야 전체 GUI 복구를 인수할 수 있다. GrowKick 동기화와 저장 및 최종 커밋은 해당 검증 뒤 수행한다. 활성 런타임과 진단 자료는 현재 참조가 있어 보존한다.
