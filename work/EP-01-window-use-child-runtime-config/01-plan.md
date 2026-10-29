상태: 설치 경로 연결 소스 수정 완료 · 기존 테스트 20개 통과 · 설치 반영 전.

# Window Use Windows child runtime 설정 누락

## 목표와 권한
Windows x64 로컬 2026.0.13 설치본의 3단계 차단 원인을 해결하도록 설치 경로 연결 코드를 수정한다. 사용자는 검증을 추가하지 않고 경로 연결만 하도록 승인했다. 테스트 및 새 검증 코드를 추가하지 않는다. 실행 중인 배포본은 덮어쓰지 않으며, 제품 빌드·재설치·재시작은 이번 범위에 포함하지 않는다. 기존 세션 확인/오류 시 종료 요청은 관리 도구의 런타임 준비 조건에서 차단되었다. 세션 존재·건강·종료와 3단계 실제 동작은 미검증이다.

## 확인된 원인
- 실행 MCP는 AppData/Local/azrael-ex/releases/2026.0.13/runtime/window-control을 사용한다. 설치 확장은 .vscode/extensions/azrael-ex-local.azrael-2026.0.13이다.
- 설치 runtime-config.json과 확장 out/azrael-runtime.json 모두 windowControl.childSession이 없다. windowControlRelative도 없다.
- 설치 Window Use 전체를 기존 scripts/window-control-runtime.cjs verifyRuntime으로 읽기 전용 검증: exit 0. manifestSha256=5b84b395e130695d9463ceed94368e70a4e065b12c7a96f7321c0833e01e299f, 설치 설정과 일치한다.
- 검증 결과에는 childSession의 executable, sha256, probeScript, logoffScript가 모두 있다. helper hash=2c16243a49ad72d6299528631be3a67458a807b3f4fc3a028e75c69de18b9f57. 파일 손상·누락은 확인되지 않았다.
- scripts/package-app-release.py:199-205는 windowControl을 기본 4개 필드로 재구성하여 childSession을 누락한다.
- scripts/install-app-release.ps1:168-174는 기본 경로만 절대화하고 childSession을 복원하지 않는다.
- scripts/ordinary-runtime.cjs:71-75도 상대 경로 분기에서 childSession을 병합하지 않는다. 현재 설치본은 이 분기를 타지 않는다.
- scripts/window-control-host.cjs:55/152/183은 누락된 설정 때문에 3단계 시작과 로그오프를 세션 검사 전에 거절한다.

## 승인된 최소 수정
패키징 소유자가 기존 manifest의 childSession을 portable 설정에 전달하고 설치 소유자가 기존 Relative-File로 경로를 설치 runtime 아래 절대 경로로 변환한다. executable, sha256, probeScript 및 manifest가 선언한 logoff 기능의 logoffScript를 연결한다. 도우미가 없는 기존 fixture와 logoff 기능이 없는 manifest는 기존 형태를 유지한다. 새 검증, 테스트, 의존성은 추가하지 않는다. 현재 원인에 관계없는 ordinary-runtime.cjs 상대 경로 분기는 수정하지 않는다. 기존 배포 설정 계약의 복원이므로 권한·승인·실제 연결 정책은 변경하지 않는다. owning architecture에 연결 책임을 기록하고 ui.window-control 소유자 목록에 두 스크립트를 연결한다.

## 검증과 후속 권한
Python과 PowerShell 구문 검사는 모두 exit 0. 기존 scripts/tests/test_app_release.py를 변경 없이 실행하여 20개 모두 통과했다(exit 0, 109.287초). Python 3.13과 기존 사용자 설치 PowerShell 7을 사용했다. 테스트는 기존 소유자의 종료 정리와 fixture 부재 확인을 포함한다. 이 suite의 fixture에는 childSession이 없으므로 결과를 새 연결 경로의 실행 증거로 과장하지 않는다. 추가 검증을 하지 말라는 사용자 지시에 따라 helper 포함 fixture나 검증 항목을 만들지 않았다. 이후 제품 빌드·설치 승인이 주어지면 설치된 MCP의 세션 확인 및 승인된 앱 테스트를 이어갈 수 있다. Windows 로컬 검증과 다른 플랫폼 지원을 구분하며 Linux/macOS의 기존 Window Use 비활성 정책은 유지한다.

## 결과와 제한
실행 중인 설치본·설정은 변경하지 않았다. 이 수정으로 Windows admission과 실제 입력 호환성까지 통과한다고 단정할 수 없다. 패키징/설치 파일에 이미 있던 다른 작업의 shared engine 변경과 기존 staging은 보존하며 이번 변경만 분리한다. 테스트 fixture는 기존 테스트 소유자의 종료 정리 절차를 사용한다. 작업 기록을 제외한 임시 파일을 새로 보존하지 않는다.
