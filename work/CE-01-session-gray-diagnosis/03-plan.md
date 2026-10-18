상태: 회색 화면 진단 로그 소스 구현·검증·생성물 정리 완료. 설치 반영은 제외.

## 목표와 범위
스크롤·드래그 관련 기존 수정과 별개로, 회색 화면 발생 시 UI 준비 시간 초과, JavaScript 오류, 리소스 로드 실패, CSP 차단, 응답 신호 유실 및 드래그 입력 차단을 구분하는 구조화 로그를 기존 sink에 추가한다. 소스 수정·검증만 허용하며 설치·호스트 파일 변경·전체 빌드는 제외한다. 공통 Windows x64/Linux x64/macOS ARM64 Webview/extension-host 경계이며 Windows source fixture를 실제 검증 대상으로 삼는다. VS Code 공개 extension API에는 renderer process 종료 이벤트가 없으므로 heartbeat 유실을 crash로 단정하지 않고 main/renderer 로그와 Crashpad 증거로 별도 확정한다.

## 설계와 순서
기존 optional-diagnostics 정책, native logger 및 strict injection/asset cache 경로를 재사용한다. root가 소유한다. UI는 임의 내용 대신 고정 오류 종류·수치·boolean과 instance ID만 보내며 host는 다시 검증한다. 준비 phase와 timeout, html 생성 실패, 제한된 heartbeat 및 드래그 종료·pointer 상태를 같은 webviewRef로 연결한다. poll은 저빈도이며 드래그를 조작하거나 새 복구를 수행하지 않는다. host와 UI의 로그 실패·메시지 손실·숨김·event loop 지연을 분리하며 기존 보존/수집 정책을 유지한다.

## 검증 기준
실제 logger 출력 fixture에서 각 실패 분류와 상관관계, 지연/숨김의 오탐 방지, 복구·dispose·타이머 정리, 민감 문자열 제외, 속도 제한과 기록 실패를 검증한다. pinned bootstrap/extension strict transform, 기존 startup guard 및 UI input 진단 회귀를 확인한다. 지속 로그 경로·크래시 판정 한계와 설치 미반영을 문서화한다. 생성 로그는 tool 출력에 보존하고 새 임시 profile/build를 만들지 않는다. 완료 시 task commit한다.

## 구현과 결과
기존 optional-diagnostics.cjs의 native logger·환경 정책과 UI bootstrap 전달 경로를 재사용했다. ui.input-diagnostics 보존 항목에 health runtime, host·idle 소유자와 필수 검사를 연결했다. 각 Webview의 random reference, UTC 시각, 버전·플랫폼·단계와 고정 오류 분류만 기록한다. UI는 일반 이벤트 30/min 및 별도 heartbeat 6/min, host는 60/min으로 제한하고 droppedCount를 남긴다. 종료가 취소된 drag와 실제 진행 drag를 구분하며 기존 guard의 progress로 telemetry를 계산하지 않는다. 의도적인 idle blank/restore도 별도 기록한다. 동작 차단·자동 재로드·복구는 추가하지 않았다.

검증은 Windows x64 Node v26.7.0의 production serializer/monitor/logger contract 및 실제 변환된 initializeWebview·startup guard fixture다. 최종 선택 검사 49/49 통과, actual exit 0, 84.421초다. NODE_OPTIONS=--max-old-space-size=6144를 사용했고 제품 빌드는 없다. JS 실패·CSP·리소스·신호 유실/회복·drag/idle/timeout의 실제 structured output sample, 전체 test output와 source hash는 04-ui-health-verification.json에 보존했다. source model/input 내용과 secret canary가 로그에서 제외됨, logger 실패가 제품 결과를 바꾸지 않음, hide·host timer gap과 크래시 미확정을 검증했다.

초기 maintenance 실행은 actual exit 124이며 통과 receipt가 아니다. 선언 변수 충돌과 이후 fixture가 Webview 대신 recovery bridge class를 선택한 문제를 수정했다. 실제 프로세스 완료(exit 1)를 확인한 뒤 targeted bridge와 최종 전체를 재실행했다. 최종 실행 후 세 JS/test 파일은 줄바꿈만 정규화했고 node --check 및 git diff --check를 통과했다. 최초 plan의 과도한 upstream directory 입력은 중단하고 사용되는 파일만 선언했다. 기존 무관한 작업은 유지했다.

원시 로그는 실행 전 기록한 ce03-ui-health-r1 그룹으로 관리했다. 실행 완료와 관련 node process 부재 확인 후 독립 검증 기록으로 참조를 전환하고 native review/apply로 삭제했다. actual remaining=false, finalize 및 Test-Path false를 확인했다. 기존 실패 receipt를 성공으로 바꾸지 않는다.

전체 설치 Webview에서 native crash를 주입하거나 설치본 로그 수집을 확인하지는 않았다. 공통 의미의 소스 변경이며 Linux/macOS·패키지·현재 설치 수용은 미검증이다. UI_HEALTH 정책과 수집 위치·해석은 docs/ops/webview-health.md가 소유한다.
