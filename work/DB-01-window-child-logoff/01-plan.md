상태: 구현·집중 검증 완료. 유지보수 잠금으로 산출물 등록·정리 보류. 상태·연결 검증 실패만 비정상으로 처리하며 단순 점유 거부는 정상으로 유지한다.

# Window Use 자식 세션 종료 개선

## 목표·권한·범위
사용자 승인 후 정상 자식 세션은 소유자가 없을 때만 종료하고 비정상 자식 세션은 소유자 유무와 관계없이 종료한다. 기존 로그오프 기능을 재사용한다. Windows x64 로컬 same-user child session 대상이며 Linux/macOS 지원 변경은 없다. 코드·문서·집중 검증은 승인되었으나 제품 빌드·설치·실제 세션 10 로그오프는 이번 구현 승인에 포함하지 않는다. 세션 생성·재사용 정책은 조사와 설명만 하며 변경하지 않는다.

## 결정과 질문
- 확정: 정상 세션은 owner 없음 조건, 비정상은 owner 무관, 사용자 승인 필수.
- 확정: 상태·연결 검증 실패만 비정상이다. 사용 중이라는 이유만으로 비정상으로 지정할 수 없다.
- 사용자가 요청한 간소화에 맞춰 부모의 정확한 자식 세션 확인과 승인 후 재확인만 유지하고, 과거 worker·완전한 리소스 등록을 종료의 필수 조건으로 요구하지 않는 방향이다.
- 진입점은 target ID 없는 logoff_isolated(reason)이다. 기존 Azrael 비동기 승인 카드를 재사용해 exact snapshot과 일회성 operation ID에 승인을 묶고, 단계/앱 승인만으로 종료하지 않는다.

## 현재 구조와 증거
- 설치 2026.0.11/w11aa의 host와 release 파일에 자동 recoverConnection이 있다.
- 대상 미지정 request_stage(3)는 child session 10의 복구를 시도했으나 child_recovery_blocked, Recovery child inventory or identity could not be verified로 실패했다. 세션 손상 자체는 미확정이다.
- request-window-child-logoff.ps1은 등록 ResourceId와 완전한 worker identity를 요구한다. native --logoff-child 역시 원래 worker 생존을 요구하므로 미등록·고장 세션 종료에 바로 적용하기 어렵다.
- native 전역 mutex Global/Azrael.ChildOwner는 동일 SID/parent의 연결 소유 경계다.
- window-control-host.cjs의 turn/completed는 invalidateUI를 통해 isolation.release를 요청한다. 입력 소유권과 Windows 세션 수명은 분리된다. safeRelease 성공 시 warm 유지하고 owner=null로 전환한다. release 실패는 호출 지점에서 catch되어 정상 반환 증거가 부족할 수 있다.
- 기본 warm idle은 15분이며 미저장·unknown·unrelated app 등은 자동 종료를 보류한다.
- Windows는 동시에 하나의 active/connected child session만 지원한다. 대화마다 생성해도 병렬 격리는 해결되지 않는다. 생성/종료 속도와 메모리 실측은 없다. 사용자 profile/cache/data는 로그오프 후 보존된다.

## 접근·소유·검증
root가 native 종료 정책, wrapper/host/tool 진입점, 테스트와 문서를 순서대로 통합한다. 기존 무관한 미커밋 변경을 보존한다. 비정상 정의에 의존하지 않는 코드 경로 조사와 검증 준비부터 진행한다. 새 라이브러리 없이 기존 WTS/관리자 broker 및 보통 권한의 파일 정리 경로를 재사용한다.

수용 기준은 정상+owner 거부, 정상+무소유 승인 후 종료, 비정상+owner 승인 후 종료, 승인 취소, 부모/다른 자식/교체된 세션 거부, 종료 성공과 파일 정리 실패 분리이다. 기존 source/manager/resource/native fixture를 변경 범위에 맞춰 실행한다. 실제 UAC와 설치 host 검증은 제품 검증과 구분한다. 종료 시점에 실행 중인 다른 대화는 기존 targets/observations를 재사용하지 않아야 한다.

## 자료
설계 owner: docs/architecture/window-use.md. 구현 owner: scripts/window-child-session.cjs, scripts/window-control-host.cjs, scripts/window-control-policy.cjs, scripts/window-control-mcp.cjs, scripts/request-window-child-logoff.ps1, native/windows-child-session/ChildSession.cs. 기존 feature ui.window-control을 확장한다.
## 구현과 검증 진행
- root: host/tool/policy, 기존 PowerShell wrapper의 CurrentChild 경로, manager/controller의 종료 후 메모리 상태 무효화, 집중 테스트와 runner, feature ui.window-control·설계 문서를 연결했다.
- /root/native_logoff: ChildSession.cs의 읽기 검사·승인된 종료 모드, status rendezvous, 정상 무소유/비정상 점유 정책과 동시 진입 잠금, self-test 31개를 구현했다. Windows x64 최종 snapshot native-r2/verified csc exit 0, self-test exit 0. 원래 registered logoff 경로는 유지한다.
- native-r1은 컴파일러가 forward-slash 절대 소스 경로를 잘못 해석한 CS1504, exit 1이다. native-r2의 backslash 경로와 변경된 source snapshot으로 수정 후 통과했다. 중간 r2 snapshot은 최종 검토 보강 후 다시 컴파일했다.
- 관리 도구 run-61016-1420-1792668087219523300은 약 10초 one_shot 실행 제한에 걸려 exit 124로 실패했다. native handler의 one_shot 실행 경로를 확인했고 원래 결과를 유지했다. 그 이전 실패인 tool count(28→29)와 wrapper plan-before-payload 검사를 보정했다.
- 동일 runner의 최종 실행은 `artifacts/tasks/DB-01-window-child-logoff/runs/20261022T113409807Z-e23da1f6-0361-4a12-9a8b-ccbe5dac5fa8/`이다. 실제 exit 0, 151/151 통과, 실패·skip 0이다. Windows x64 helper fixture를 포함한다. 원본 결과와 producer 종료 증거는 reports/summary.json·producer.json, logs/tests.log에 있다.
- 승인 문구에 실제 상태·입력 소유자와 이번 요청만 승인한다는 설명을 표시한다. 최종 실제 native React/parser/CSS 렌더 검사는 `artifacts/tasks/verify-window-native-approval-render/runs/20261022T113419977Z-064be87f-5883-4aa2-8737-0a56037a3e8a/`이며 light/dark × 900/360, 99개 검사 통과, exit 0, browser 종료 확인이다. 좁은 dark 화면을 직접 확인했다. 설치 VS Code 수용 검증은 아니다.
- 재실행 원인은 fixture 경로 제한, Python PATH, helper journal fixture 환경, runtime registry 블록 밖 export였다. 수정 후 최종 전체 집중 검사를 통과했다. 실제 실행 시작·종료와 종료 코드는 각 run의 producer 기록에 보존했다. 원래 실패/중단 결과를 성공으로 바꾸지 않았다.
- 산출물 등록 도구는 `artifacts/maintenance/maintenance.lock` 점유로 거부되었다. 잠금 owner PID 61016은 실행 중인 managed Azrael 엔진이다. 잠금이나 registry를 우회 수정하지 않았으며 정리 적용은 실행하지 않았다. 정확한 group 목록·재개 조건은 cleanup-deferred.json에 있다. 중단된 첫 run은 pending 상태를 유지한다. 잠금 해제 후 supported registration/review/apply로 불필요 fixture를 정리해야 한다.
- 소스/테스트 변경으로 실제 설치 2026.0.11은 바뀌지 않는다. 제품 빌드·설치·실제 세션 로그오프/UAC는 실행하지 않는다.
- `git diff --check`는 변경 범위에서 exit 0이다. 공용 잠금으로 필수 산출물 정리가 끝나지 않아 task commit은 아직 생성하지 않았다. 무관한 기존 변경을 보존했다.
