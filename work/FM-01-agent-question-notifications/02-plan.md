상태: 소스 구현·자동 검증 완료. 빌드·설치는 실행하지 않았으며 실제 OS 표시·클릭은 미검증이다.

# 작업 완료 OS 알림

- 요청과 권한: 기존 standalone 질문 알림에 작업 완료 알림을 추가하고 관련 소스 검증을 수행한다. 빌드·설치는 기존과 같이 별도 요청 범위다.
- 범위: Windows/Linux/macOS가 공유하는 Electron 알림 경로. 이번 실제 검증 환경은 Windows x64/Node이며 다른 OS와 실제 OS 표시·물리 클릭은 미검증이다.
- 동작: 엔진 `turn/completed` 이벤트 중 `turn.status === completed`이고 식별 가능한 turn만 완료 알림으로 표시한다. 중단·실패·deferred는 완료로 알리지 않는다. 동일 host/thread/turn 중복 이벤트는 한 번만 알린다. 클릭하면 기존 창 복원·대화 이동을 재사용한다. 다음 turn 시작, 대화 종료, 패널 폐기, 앱 종료는 이전 완료 알림을 정리한다. 질문 알림의 기존 수명은 유지한다.
- 구현: 기존 알림 소유자의 표시 내용과 완료 이벤트 분기를 확장한다. 엔진·프로토콜·의존성·렌더러 UI 변경 없음. root 단독 소유로 문서 → 구현 → 기존 행동 fixture 확장 → 등록 standalone-app-ui-source 검사 → 정리·task commit을 수행한다.
- 성공 기준/검증: 정상 완료 한 번 표시·클릭 이동, 잘못된/비완료 상태 배제, host/thread별 구분, 다음 작업 시작과 종료 시 stale 클릭 차단 및 질문 수명 보존. 기존 테스트 파일에 완료 분기·수명 예외를 보존하는 작은 행동 검사를 추가한다. 이후 공통 알림 리팩터링에서 상태 필터나 중복 키를 생략할 재발 방지가 유지 이유다.
- 정리: 메모리 fixture 사용. 빌드·프로필·백업·별도 raw log 생성 없음. 임시 계획 body는 할당 후 삭제한다. 계획과 최소 검증 결과만 유지한다.

## 결과

- 기존 알림 소유자에 완료 표시 내용, host/thread/turn 중복 키와 정상 완료 필터를 추가했다. 다음 turn 시작은 완료 알림만 정리하며 기존 질문 수명을 보존한다. 기존 앱 메인 프로세스의 창 복원·대화 이동을 그대로 사용한다.
- Windows x64/Node: `node --test apps/azrael-desktop/question-notifications.test.cjs` 실제 7개 실행/7개 통과, exit 0. 정상 완료·중복·클릭 이동·다른 대화 격리·비완료/잘못된 turn 배제·다음 작업 시작 후 stale 클릭 차단 및 기존 질문 수명 검사를 포함한다. Notification은 메모리 fixture이며 실제 OS 표시를 검증하지 않는다.
- 등록 source bundle 최초 호출은 `maintenance.lock` 점유 오류 뒤 `run-42784-5631-1793689125723508300`을 unknown/exit null로 남겼다. 재시도는 unresolved producer guard로 차단되어 중복 실행하지 않았다. 명시적 status와 manifest를 확인하니 step에는 `integrity_before`, `session_id`, `execution_output`이 모두 없다. `ProjectMaintenanceHandler`는 durable before-validation의 `valid:true` 이후에만 ExecCommandHandler를 호출하고, native validation은 그 결과를 `integrity_before`에 저장한 뒤 반환한다. 따라서 이 실행은 before validation을 완료하지 못해 검사 producer/process tree를 시작하지 않은 것으로 확인한다. Windows 현재 프로세스 조사에서도 해당 check/test와 esbuild Node 실행이 없다. 이 증거에 근거해 지원 recover로 producer 보호만 해제하며 원래 unknown/exit null은 유지한다. 잠금이나 registry를 직접 변경하지 않는다.
- 임시 계획 body 삭제 및 실제 부재 확인. `git diff --check` 통과. 별도 disposable 빌드/로그/프로필 없음. 실제 Windows/Linux/macOS OS 배너·물리 클릭 및 설치 앱 적용은 미검증이다.
- 지원 recover 성공: 원래 run은 unknown/exit null을 유지하고 `producer_completed:true`로 보호만 해제했다. 새 run `run-42784-5637-1793689227876267000`은 `standalone-app-ui-source` (`node apps/azrael-desktop/check.cjs`) passed/exit 0/입력 무결성 valid. 7개 알림 행동 검사와 기존 15개 파일 syntax, 메모리 renderer bundle, pinned image adapter 검사를 포함한다. 실행 근거: `tool-call:exec-bb070370-3506-43ee-85f4-a61bfeea6ecc:step-d18697fd5d60b1010f77f2f97f7e0f91a0a261c6b5c5017d9b6a0134e8336467`.
- 기존 `ui.standalone-app` feature와 등록 source bundle이 변경 파일을 이미 소유하므로 별도 등록이나 의존성 변경은 없다. 기존 최소 검증 receipt와 계획 외 정리할 생성물은 남기지 않는다.
