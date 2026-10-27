상태: 구현 가능성 검토 완료. 코드 수정·빌드·설치 없음. 실제 충돌 엔진의 버전과 인계 capability 확인이 남았다.

# 버전 변경 후 기존 세션 전환 재검토

## 목표·권한
사용자가 제공한 `This conversation is open in another Azrael engine` 화면을 근거로 새 엔진 전환 가능성을 검토한다. 이번 권한은 조사와 검토이며 구현·설치·프로세스 종료는 포함하지 않는다. 기존 결정은 [01-plan.md](01-plan.md), 기존 검증은 [02-verification.json](02-verification.json)을 따른다.

## 근거와 판단
- 기본 개발 소스는 운영 문서에 지정된 `engine/`이다. `app-server/src/azrael_thread_engines.rs::acquire`의 실제 파일 잠금 충돌 문구가 화면과 일치한다. 잠금 파일 존재만으로 소유권을 판단하지 않는다.
- 현재 소스에는 `app-server-daemon/src/session_handoff.rs`의 foreign `thread/resume` 연결과 `azrael/session/handoff`, `app-server/src/azrael_shared_server.rs`의 안전 경계·복원 기록·세션별 lease 반환이 이미 구현돼 있다. 새 전환 체계를 처음부터 만들 필요는 없다.
- 기존 기록은 고정 r5 입력의 Windows focused native 50개 통과를 보존한다. 실제 설치 VS Code 두 버전·두 프로젝트 전환과 Linux/macOS 실행은 미검증이다. 이번에는 코드와 기록만 읽었고 테스트를 재실행하지 않았다.
- 최근 설치본 `2026.0.12`의 runtime `artifacts/workspaces/h/artifacts/releases/w13r-99afefb1/build-info.json`이 가리키는 `artifacts/inputs/dm01-w13r/project/engine`에도 인계 경로가 존재한다. 해당 session_handoff.rs SHA256은 `26a59c723b343bd68dccfb15e6cc4b86e60a4bf7a2e3beed702ba19b8e43eb52`이다. 화면을 낸 실제 실행 프로세스의 신원·기능은 미확인이다.

## 추천과 한계
구현 가능하며 주요 기능은 이미 구현돼 있다. 유휴 세션은 안전 조건 확인 후 이관하고 실행 중에는 원래 엔진에서 계속 진행하다 안전 경계에서 이관하는 기존 설계를 유지한다. 다른 세션·프로젝트를 함께 종료하거나 잠금을 강제로 해제하지 않는다. 계정·모델·권한·큐·질문·승인을 보존하고 복원 불가능한 설정을 기본값으로 바꾸지 않는다.

양쪽 엔진의 인계 protocol과 저장 ABI가 호환돼야 한다. 기존 합의는 앞으로 protocol을 지원하는 버전 사이에 적용하며 미지원 구버전 소급 지원은 제외했다. 미지원 엔진이 소유한 세션은 그 엔진의 정상 종료와 기록 저장 후 새 엔진에서 재개하는 최초 전환 절차가 필요하다. 실행 중 작업의 무중단 이전을 보장할 수 없다.

현재 설치본에 기능이 없다고 단정할 수 없다. 다음 단계는 실제 원래 엔진과 새 창 엔진의 instance/version/실행 파일 신원, sessionHandoff capability, 저장 호환성, 발견 기록 확인이다. 이번 화면의 정확한 원인은 이 확인 전까지 미확정이다.

## 범위와 후속 검증
공통 대상은 Windows x64, Linux x64, macOS ARM64 로컬 실행이다. 이번 검토는 Windows에서 코드·영수증만 확인했다. Remote SSH·컨테이너는 별도다.

후속 실행 승인 후 실제 버전 쌍을 고정해 유휴 재개·실행 중 재연결·안전 시점 이관·다른 프로젝트 유지·동시 구독자·응답 유실·미지원 protocol/저장 비호환 거부를 검증한다. 공통 코드 수정 시 Windows 회귀를 포함하고 다른 플랫폼은 실제 검증 환경별로 구분한다. 변경 필요성은 진단 결과로 결정한다.