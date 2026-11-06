상태: 생성·관리 조사 완료 — Azrael 제품 코드는 변경하지 않았으며, 실제 계정 호환성 검증과 구현 범위 결정이 남아 있다.

# Azrael에서 OpenAI Dot 생성·관리 조사

## 목표, 요청 범위와 전제
- 사용자는 Azrael에서 OpenAI Dot을 생성·관리하고 싶으며, 이번 요청은 기능의 의미와 필요한 구성 요소에 대한 조사다.
- 이전 Codex IDE 연동 조사와 같은 세션을 사용한다. 01-plan.md의 공개 API 미확인 결론은 유지하되, 이번 조사에서 고정 UI 원본의 생성·관리 내부 구현을 추가로 확인했다.
- 허용: 공식 문서, 프로젝트 계약, 보유 UI 원본 읽기 및 조사 기록. 실제 생성·이름 변경·중지·삭제, 계정 연결 변경, 제품 코드·설치 변경은 수행하지 않는다.
- 목표는 OpenAI가 제공하는 실제 Dot이다. 자체 상시 에이전트나 다른 모델로 유사 기능을 만드는 것은 별도 제품 결정이다.

## Dot이 제공하는 기능
- 대화 사이에도 책임을 이어가는 개인 클라우드 에이전트다. 클라우드 컴퓨터·브라우저, 지속적인 작업 맥락과 자체 노트, 선제적 조사, 후속 작업, 사용자 결정 요청을 제공한다.
- Work/Codex 작업과 백그라운드 에이전트에 업무를 나누고 결과를 확인한다. 반복 일정과 지원되는 연결 서비스 이벤트를 사용할 수 있다.
- ChatGPT의 대화·음성 및 지원되는 연락 채널에서 같은 Dot을 만난다. 채널별 대화 표시와 접근 권한은 구분된다.
- 플러그인 연결, 연락 채널 연결, 로컬 컴퓨터 연결은 별개다. 클라우드 작업은 PC를 꺼도 계속될 수 있지만 로컬 단계는 연결된 PC와 실행 중인 ChatGPT 앱이 필요하다.
- 공식 소개는 주 에이전트를 GPT-6 Astra 기반으로 설명한다. Azrael 모델 선택기로 Dot의 주 모델을 바꿀 수 있다는 근거는 없다. Enterprise 문서도 주 Dot과 위임받은 Work/Codex 작업의 모델 통제를 구분한다.

## 공식 생성과 관리 조건
- 공식 생성은 ChatGPT 모바일 앱·데스크톱 앱·데스크톱 웹에서 소개 절차, 이름·외형 선택, 선택적인 플러그인 연결 순서다. 모바일 웹은 지원되지 않는다.
- 2026-10-30 확인 문서: Pro 100/200/500은 18세 이상이며 EEA·영국·스위스 외 지역, Business Premium·Enterprise는 전세계 순차 제공이다. Enterprise는 기본 비활성으로 관리자 허용이 필요하다. 플랜 자격만으로 실제 계정 활성화를 확정할 수 없다.
- 로컬 연결은 선택 사항이다. Dot 프로필 > Computers > Your computer > Allow access이며, 일반 Codex 원격 연결이나 Work Sync와 별도 권한이다. 한 번에 개인 컴퓨터 한 대라는 공식 안내가 있다.
- Activity는 위임 작업과 입력·연결·승인 요청 확인, Scheduled는 반복 일정 관리, 프로필은 이름·외형·채널·컴퓨터 연결 관리에 해당한다.
- Pause는 주 작업 중지다. 위임 작업 중지·반복 일정 취소는 별도다. 삭제는 완료된 외부 변경을 되돌리지 않는다. 별도 생성된 대화·파일까지 모두 지워지는 것으로 표시하면 안 된다.
- Dot 대화는 ChatGPT 사용량 제한에 포함되지 않는다는 안내가 있으나, 위임 Work/Codex 작업은 해당 제품의 제한에 포함된다. 무제한 사용으로 설명하지 않는다.

## 로컬 코드에서 확인한 구현

### 조사 대상의 정확한 범위
- Azrael 준비 스크립트 scripts/prepare-official-ui.ps1의 고정 UI 입력: artifacts/upstream-ui/26.1007.21434.
- 이 원본은 이전 조사에서 살펴본 별도 설치 공식 확장 26.1021.22027과 다르다. 보유 원본 코드의 존재는 현재 실행 중인 Azrael 패키지에서 기능이 활성화됐거나 서버가 요청을 허용한다는 증거가 아니다.
- 원본의 내부 명칭은 orbit / aeon / tbo이며 사용자 표시 명칭은 dot이다. 프로젝트 전용 Dot 관리 서비스나 모델 도구는 이번 조사에서 확인하지 못했다.

### 확인된 내부 서비스 경로
다음은 보유 클라이언트의 호출부에서 관찰한 경로다. 공개 API 또는 안정성·외부 클라이언트 사용 지원 계약으로 확인된 것은 아니며, 요청을 전송하지 않았다.

| 역할 | 코드에서 확인한 경로 |
| --- | --- |
| 생성 | POST /tbo |
| 목록·단일 조회 | GET /tbo, GET /tbo/{tbo_id} |
| 스레드에서 Dot 조회 | GET /tbo/by-thread/{thread_id} |
| 연결 작업 목록 | GET /tbo/{tbo_id}/threads |
| 대표 Dot 조회·선택 | GET /tbo/primary, PUT /tbo/primary |
| 이름·기본 외형 변경 | PATCH /tbo/{tbo_id} |
| 메시징 공간 확보 | POST /tbo/{tbo_id}/messaging-room |
| 초기화 | POST /tbo/{tbo_id}/onboarding/initialize |
| 일시정지·재개 | POST /tbo/{tbo_id}/runtime/pause, POST /tbo/{tbo_id}/runtime/resume |
| 삭제 | DELETE /tbo/{tbo_id} |
| 커스텀 외형 업로드·반영 | POST /cloud-aeons/avatar-snapshots, PATCH /cloud-aeons/{aeon_id} |

### 생성과 실패 처리
- cloud-aeon-onboarding-54f7e9931125.js의 X 함수는 accountId/userId를 캡처하고 사용 가능성을 검사한 뒤 POST /tbo를 호출한다.
- 생성 본문에는 display_name, avatar 또는 avatar_type/avatar_manifest/avatar_url, create_thread, create_additional, should_initialize가 있다. create_additional 호출부와 복수 프로필 목록은 존재하지만 계정별 생성 개수나 권한을 확정하지 않는다.
- 반환되는 id, root_thread_id, messaging_room_id를 연결하고 메시징 공간이 없으면 별도 확보한다. preserveServerConfiguration:true로 클라우드 대화를 재개하며 model과 reasoningEffort를 로컬 값으로 덮어쓰지 않는다.
- rejected, unknown, accepted를 구분한다. 전송 후 연결 단절은 생성 실패로 단정하지 않으며 자동 재시도 대신 서버 상태를 재확인해야 한다. 생성 중 계정이 바뀌면 결과를 새 계정 화면에 귀속시키지 않는다.
- 기존 UI에는 삭제 진행 중 충돌과 복구 처리도 존재한다. 복구 경로는 자동 사용을 제안하지 않으며 의미와 권한 검토가 필요하다.

### 사용 가능성과 인증
- app-initial-c014f9ee4429.js의 x_ 함수 및 C_ 상태는 계정 정보 조회 성공과 accounts[accountId].account.tbo_config.tbo_available === true를 요구한다.
- 로컬 컴퓨터 접근에는 별도의 workspace permission과 기능 검사도 있다. 버튼 노출과 계정 서버 권한은 구분된다.
- out/extension.js는 상대 서비스 경로를 기본 https://chatgpt.com/backend-api에 연결하며, 기존 authProvider의 토큰을 요청에 붙인다. expectedIdentity(accountId,userId) 검사는 전송 시 인증 주체 변경을 거부한다.
- 공개 Platform API 키만으로 같은 Dot을 생성할 수 있다는 근거는 없다. 기존 Codex ChatGPT 인증이 Dot 서버에서 실제 수락되는지는 미검증이다.
- 공유 명령 openOrbit는 availableIn:[electron]이다. 화면 제한 변경만으로 클라우드 대화·권한·기기 연결까지 작동한다는 근거는 없다.

## Azrael에서 필요한 구현 책임 — 제안, 미승인

| 영역 | 필요한 책임 | 재사용 후보와 확인할 간극 |
| --- | --- | --- |
| 계정·자격 | 사용자+워크스페이스별 가용성, 인증 갱신, 계정 전환 중 요청·응답 격리 | accounts.md, accountService.ts, 기존 네이티브 계정 소유자·host authProvider; 실제 Dot 인증 수락 확인 필요 |
| 생성·프로필 관리 | 생성, 목록, 대표 선택, 이름·외형 변경, 확인 후 삭제 | 고정 UI의 onboarding/profile/delete 흐름; VS Code 실행 경로 연결 필요 |
| 상태 동기화 | Dot ID, root thread, messaging room, 활성 스레드, 이벤트·재연결·캐시 무효화 | 기존 클라우드 대화 경로가 Azrael에서 동작하는지 확인 필요 |
| 작업 관리 | Activity, 승인 요청, 위임 작업, 일정, 주 작업 중지와 개별 취소 분리 | 원본 UI 재사용 범위와 host 요청/알림 의존성 확인 필요 |
| 권한·연결 | 플러그인, 연락 채널, 클라우드 컴퓨터, 로컬 컴퓨터를 각각 관리 | 공식 연결 절차 우선; Azrael을 ChatGPT 로컬 실행기로 등록할 수 있는지는 미검증 |
| 유지보수 | 원본 버전 고정, 스키마·상태 회귀 검사, 기능 인벤토리·아키텍처 연결 | namespace-azrael-host.cjs 및 기존 feature preservation 체계 활용 |

- Azrael은 OpenAI 외 여러 제공자 계정을 지원하므로 Dot은 연결된 OpenAI 사용자·워크스페이스에 귀속시켜야 한다. 일반 모델 선택이나 자동 계정 전환으로 다른 Dot을 이어받게 해서는 안 된다.
- 기존 계정·인증 소유자를 사용하고 토큰·쿠키를 Webview나 문서에 복사하지 않는다. 서버의 주 에이전트 모델·승인 규칙·워크스페이스 제한을 보존한다.
- 클라우드 Dot 생성만을 위해 Azrael에 상시 로컬 스케줄러·클라우드 VM을 새로 구현할 필요가 있다는 근거는 없다. OpenAI 서비스가 제공하는 부분과 Azrael 클라이언트가 맡을 부분을 구분한다.

## 추천 단계와 수용 기준
1. 읽기 전용 호환성 확인: 명시적으로 선택한 OpenAI 계정의 가용성·기존 Dot 목록을 기존 인증 소유자를 통해 조회한다. 서버가 Azrael 인증을 수락하는지, 계정 전환이 오귀속을 막는지 확인한다. 제품 구현과 실제 인증된 서비스 요청은 이번 조사에서 수행하지 않았다.
2. 최소 생성·관리: 기본 외형으로 한 개 생성, 기존 Dot 조회·이름 변경·대표 선택·확인 후 삭제를 연결한다. 생성 결과 불명·409/401/403/429·계정 전환 중 응답을 검증한다. 사용자 승인 후 실제 생성 및 정리 범위를 정한다.
3. 대화·활동·중지/재개: 생성 직후 Dot과 상호작용, 재시작 후 복원, 서버 이벤트·요청 확인, 주 작업/위임 작업/일정 제어의 분리를 검증한다. 서버에 생성됐지만 Azrael에서 대화 불가한 상태를 완료로 표시하지 않는다.
4. 확장 관리: 외형·음성·연락 채널·플러그인·일정·기기 연결은 별도 범위로 순차 연결한다. 로컬 실행기 전체를 대체하는 작업은 독립적인 호환성 판단이 필요하다.
- 서버 사용 권한이 없으면 기능 비활성 사유를 표시하고 공식 접근 절차를 안내한다. UI 수정으로 권한을 우회하지 않는다.
- 내부 API 사용의 변경·지원 위험을 수용할지와 첫 제품 범위는 사용자 결정 사항이다. 공식 화면 이동 방식도 대안이지만 Azrael 내부 생성이라는 목표를 충족한 것으로 표시하지 않는다.

## 플랫폼과 검증 한계
- 대상 계약은 Windows x64, glibc Linux x64, Apple Silicon macOS의 공통 계정·클라우드 의미다. 로컬 연결·음성·앱 권한은 플랫폼별 의존성이다. Remote SSH, 컨테이너, WSL 제품 지원은 별도 범위다.
- 실제 조사 환경은 Windows x64이며 정적 원본 분석과 공식 문서 대조만 수행했다. Linux/macOS와 실제 서버·계정·생성·대화·삭제는 검증하지 않았다.
- 구현 시 공통 단위/계약 검사 및 Windows 회귀가 필요하며, Linux/macOS 지원 주장은 각각 호스트 검증 후 확정한다. 테스트는 installed testing 및 implementation 지침으로 선정한다.
- 제품 코드·설정·설치·계정은 변경하지 않았다. 빌드·테스트를 수행하지 않았고 임시 조사 로그·백업·원본 복사본은 생성하지 않았다. 문서 생성 입력 임시 파일은 제거를 확인한다.

## 근거 파일과 공식 자료
- artifacts/upstream-ui/26.1007.21434/webview/assets/cloud-aeon-onboarding-54f7e9931125.js:1 — 생성·계정 고정·결과 불명 처리
- artifacts/upstream-ui/26.1007.21434/webview/assets/app-initial-c014f9ee4429.js:1 — x_, C_, kB, jlt/Nlt/Gb/Plt/Flt/Ilt, Xut, 초기화·음성·프로필 경로
- artifacts/upstream-ui/26.1007.21434/webview/assets/delete-orbit-dialog-54056d197233.js:1 — 삭제 확인 의미
- artifacts/upstream-ui/26.1007.21434/out/extension.js — openOrbit와 fetchHttp/expectedIdentity/authProvider
- scripts/prepare-official-ui.ps1:3 — 고정 UI 경로와 버전
- docs/architecture/accounts.md, docs/architecture/azrael-ex.md, docs/architecture/multi-platform.md — 기존 소유권과 지원 범위
- https://learn.chatgpt.com/docs/dots
- https://learn.chatgpt.com/docs/dots/getting-started
- https://learn.chatgpt.com/docs/dots/tasks-and-memory
- https://learn.chatgpt.com/docs/dots/controls
- https://learn.chatgpt.com/docs/dots/computers-and-apps
- https://learn.chatgpt.com/docs/enterprise/dots-admin-guide
- https://learn.chatgpt.com/docs/enterprise/cloud-local-access