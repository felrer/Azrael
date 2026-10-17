상태: 원인 조사 완료. 사용자에게 작업 저장 후 모든 VS Code 창의 정상 종료·재실행을 안내한다. 실행 중 창, 계정, 자격 증명, 설치 파일은 변경하지 않았다.

# 2026.0.10 Life-All-In-One 창 로그인 관련 오류 조사

요청과 범위: 사용자가 Life-All-In-One 프로젝트의 VS Code에서 신규 Azrael을 실행한 뒤 발생한 로그인 관련 오류의 원인을 조사한다. Windows 11 Home x64의 실제 설치 호스트와 기존 실행기의 로그·소스 경로를 읽기 전용으로 대조한다. 수정·재설치·로그인 실행·사용자 프로세스 종료는 이번 요청의 실행 범위에 포함하지 않는다. Linux/macOS 결과로 일반화하지 않는다.

확인 결과:

- 해당 프로젝트 기록이 있는 VS Code `20261016T010404/window5`에서 2026-10-17 21:08:46 KST에 2026.0.10이 활성화됐다. `Azrael Recovery.log`의 `recovery.runtime`은 설치된 2026.0.10 호스트와 w10e 엔진·브리지를 선택했음을 확인한다.
- `Azrael.log:3602`는 `A legacy Azrael shared engine is running. Close all Azrael windows once to complete the coordinated engine upgrade, then reopen them.`을 기록한다. 바로 다음 줄에 app-server exit1이 있고, Recovery 로그에는 `config/read` 중 `host.transport_disconnected`가 있다. 신규 엔진의 정상 시작 이전에 종료된 것이다.
- 실제 프로세스 목록에는 w31b(설치 이력상 2026.0.8) 엔진 PID32256과 관련 구버전 엔진·브리지가 남아 있으며, 새 w10e 엔진은 실행 중 목록에 없다. 기존 공용 app-server-control 소켓도 남아 있다. 기존 창을 하나만 새로고침해도 다른 구버전 창의 공유 실행기가 살아 있으면 전환이 완료되지 않는다.
- 코드 `engine/codex-rs/app-server-daemon/src/azrael.rs:201`은 legacy 제어 소켓이 연결 가능하면 protocol2 시작을 거부한다. 저장소의 호환성을 확인하지 않은 구버전과 신버전의 동시 시작을 막는 의도된 최초 전환 가드이며, 이후 호환되는 protocol2 릴리스 간 namespace 공존과 구분한다.
- `extensions/azrael-ex/src/extension.ts:152`는 계정 서비스 연결 실패를 `azrael account management disabled`로 표시한다. `bridgeTransport.ts:49`는 브리지 프로세스 종료를 `bridge disconnected`로 바꾼다. 이 일반 오류 문구만으로 자격 증명 만료를 판단할 수 없다. 이번 실행에서는 신규 엔진 시작 거부가 직접 관찰된 원인이며, 로그인 서버의 인증 거절이나 저장된 로그인 정보 손상은 확인되지 않았다. 정확한 계정 알림 자체는 로그에 저장되지 않아 알림 문구와의 연결은 코드 경로에 근거한 설명이다.
- 같은 창의 16:10 KST `repo_not_accessible` HTTP403은 구버전 2026.0.8에서 원격 저장소 환경 조회 중 발생한 별도 사건이다. 최신 21:08의 로컬 엔진 시작 실패와 혼동하지 않는다. `chatSessionsProvider` 제안 API 등록 실패는 info로 처리되며, 실제 fatal 종료 메시지는 legacy guard이다.

권고: 모든 프로젝트의 작업을 저장하고 모든 VS Code 창을 정상 종료한 뒤 다시 실행한다. 계정 로그아웃·재로그인이나 자격 증명 삭제보다 이 최초 protocol1→2 전환을 먼저 완료해야 한다. 프로세스를 강제 종료하거나 소켓·잠금 파일을 삭제하는 방식은 실행하지 않았다. 완전 종료 후에도 재발하면 그 새 시각의 시작 로그와 실제 잔여 실행기를 대조한다. 제품 개선 후보는 legacy 전환 사유를 계정 연결의 일반 실패 문구와 함께 명확히 노출하는 것이며, 이번 조사는 이를 구현하지 않는다.

검증: 실제 VS Code 호스트 로그, Recovery의 runtime/transport 사건, 현재 실행 파일 경로·PID, legacy 시작 가드 및 계정 서비스 오류 처리 코드를 대조했다. 로그인/모델 요청/재현용 새 앱 실행은 하지 않았다. 이전 배포의 fresh-state 6단계 수용 결과는 legacy 엔진이 없는 조건의 증거로만 재사용하며, 실제 사용자 창의 전환 성공은 아직 미확인이다.

근거 로그: `C:/Users/felre/AppData/Roaming/Code/logs/20261016T010404/window5/exthost/azrael-ex-local.azrael/Azrael.log` 및 같은 폴더의 `Azrael Recovery.log`. 원본 로그는 복사하거나 변경하지 않았으며 자격 증명 저장소·원시 인증 응답은 읽지 않았다. 생성한 대용량 산출물이나 테스트 프로필은 없다.
