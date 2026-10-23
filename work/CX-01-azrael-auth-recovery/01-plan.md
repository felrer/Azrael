상태: 승인된 잔류 엔진 종료 및 네이티브 재시작·계정 RPC 검증 완료. 기존 VS Code 창 Reload Window 후 UI 확인 필요.

## 목표와 범위
Windows 설치본 Azrael 2026.0.10 / u17b의 bridge disconnected (1) 원인을 확인하고 기존 인증·대화·설정을 보존하여 복구 가능성을 판단한다. 비밀 값을 출력하지 않는다. 인증 삭제·일반 Codex 인증 복사·배포·커밋은 수행하지 않는다. 제품 소스 변경이 없어 다른 OS 검증은 이번 로컬 진단 범위 밖이다.

## 확인된 결과
- 설치된 out/azrael-runtime.json, recovery.runtime, 실행 프로세스가 모두 artifacts/build/u17a/artifacts/releases/u17b를 가리킨다. build-info의 실제 소스는 artifacts/n10a/engine이다.
- 네이티브 endpoint discovery 종료 코드 0: 선택된 엔진 hash 및 instance de16d39ce644666ceb4df183cca4b9de8bb8e953909e23aa2bd56beef4eb0546과 현재 PID receipt가 일치한다.
- 브리지 직접 연결 종료 코드 1: 해당 로컬 소켓 연결 거부, Windows os error 10061. 디렉터리 조회에서도 소켓 파일이 없다. 실제 창의 Azrael.log는 약 60초 뒤 os error 2로 프록시가 종료됨을 기록한다.
- PID 45928은 2026-10-18 02:18:26 KST부터 남아 있는 정확한 해당 엔진이다. 부모 PID 42508은 없고 조사 시점 직접 자식 프로세스도 없었다. CPU 누적 약 185,355초. 이 사실만으로 모든 백그라운드 작업 종료를 증명할 수는 없다.
- auth.json은 유효 JSON이며 access/refresh token 모두 존재한다. 마지막 갱신 기록은 2026-10-21T14:51:33.895974900Z이다. 계정 프로필 디렉터리 18개가 존재한다. 토큰 서버 유효성 및 실제 모델 호출은 검증하지 않았다.
- 엔진 stderr 로그는 약 18.4 GB이며 마지막 관찰 시각은 2026-10-22 08:59:47 KST이다. 제한된 마지막 구간에서 MCP secure-store 실패 후 파일 fallback 성공과 없는 thread 관련 경고를 관찰했다. 이것이 이번 접속 실패 원인이라는 증거는 없다. 로그·인증·대화 파일을 수정하거나 삭제하지 않았다.
- azrael.exe login status는 전용 app-server 바이너리에서 지원되지 않아 종료 코드 2. 로그인 실패 증거로 해석하지 않는다.

## 소스와 복구 경로
실제 소스 app-server-daemon/src/azrael.rs:260 부근은 살아 있는 PID와 일치하는 receipt가 있으면 소켓 probe 없이 endpoint를 반환한다. run_azrael_stdio_proxy_with_args는 없는 소켓에 약 60초 재접속한 뒤 실패한다. 따라서 창 reload만으로 남아 있는 프로세스가 복구되지 않을 수 있다.

정상 Windows 종료 경로는 해당 소켓의 /daemon/shutdown을 필요로 한다. 조사된 공개 CLI에는 이 Azrael instance 전용 stop 경로가 없으며 일반 daemon stop 명령은 다른 PID 경로를 사용한다.

권고: 사용자 작업 중단 확인 후 PID·시작 시각·실행 파일·instance를 즉시 재확인하고 PID 45928만 종료한다. PID receipt나 계정/인증/대화/registry를 지우지 않고 정상 Azrael 창 시작 경로를 통해 새 엔진을 실행한다. 이후 소켓 연결·계정 목록 읽기·실제 창 오류 해소를 확인한다. 강제 종료는 실행 중 작업과 미flush 기록을 잃을 수 있어 사용자 확인 후 수행했다.

## 산출물과 남은 검증
제품 코드 변경·빌드·설치·커밋 없음. 일회성 진단 스크립트는 결과 검토 후 제거했다. 비밀 값과 원문 로그는 산출물로 복사하지 않았다. 복구 실행과 계정 RPC 검증은 완료했다. 기존 창은 이미 연결 오류로 종료된 프록시를 보유하므로 사용자가 Reload Window를 실행해야 한다. 실제 창의 오류 해소 및 외부 모델 호출은 아직 미검증이다.

## 승인된 복구와 최종 검증
사용자가 “종료하고 복구 진행”을 승인했다. PID 45928의 실행 파일·instance·시작 시각을 재확인하고 해당 PID만 Stop-Process로 종료했다. 직후 종료 처리 중에는 PID 조회에 남았지만 후속 CIM 조회에서 사라짐을 확인했다. 프로세스 트리나 다른 Codex/VS Code 프로세스는 종료하지 않았다.

정상 시작을 위한 VS Code 새 창 요청은 CLI 종료 코드 0이었으나 기존 프로젝트 창으로 전달되어 새 확장 호스트 시작은 관찰되지 않았다. 설치된 out/azrael-runtime.cjs 및 shared-engine-host.cjs를 재사용해 임시 로컬 window context로 정상 네이티브 stdio 시작 경로를 실행했다. initialize, 브리지 연결, azrael/account list 및 account/read(refreshToken:false)가 모두 성공했다. 진단 Node 명령 실제 종료 코드 0. 새 네이티브 PID receipt는 42440으로 갱신됐다. 진단 연결 종료 뒤 엔진 프로세스가 유지되지 않는 것을 확인했으므로 상시 엔진 실행 또는 기존 창 UI 복구까지 완료했다고 해석하지 않는다.

계정 RPC 결과: 등록 프로필 3개, 현재 계정 있음, 활성 프로필 있음, account type chatgpt, 진행 중 turn 없음. 디스크의 18개 프로필 디렉터리와 RPC가 반환한 등록 프로필 수는 구별한다. 인증 파일은 전후 SHA-256 비교가 동일했다. requiresOpenaiAuth=true는 OpenAI 인증 요구 여부이며 accountPresent=true와 함께 반환되었다. 인증 만료나 서버 측 유효성을 판정하지 않는다.

비밀 값 없는 검증 결과는 recovery-result.json에 보존한다. 일회성 recover.cjs는 검토 후 제거한다. 인증·대화·계정 파일의 수동 편집 및 제품 코드·빌드·설치 변경 없음. 기존 창에서 Ctrl+Shift+P → Developer: Reload Window를 실행하면 검증된 정상 시작 경로를 다시 수행할 수 있다.
