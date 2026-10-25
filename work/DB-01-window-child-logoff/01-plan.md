상태: 종료 경로 결함 소스 수정·190개 집중 회귀 검사 완료. 검증 산출물은 기존 관리 잠금 복구 후 등록·정리하는 조건으로 보존한다. 제품 빌드·설치·실제 종료는 별도다.

현재 실행 소유 기록: `DB01-root`, group `run:DB01:runtime-fix-20261025-r1`, 계획 경로 `artifacts/tasks/DB-01-window-child-logoff/runs/runtime-fix-20261025-r1/` (temporary, tests.log, tests.stderr.log, receipt.json). 명령은 기존 집중 묶음의 14개 Node 소스 검사이며 실제 Windows 세션 종료는 없다. producer catalog.lock으로 기존 runner는 출력 생성 전 exit 1, 이어 native inventory 등록도 maintenance.lock 점유로 거부되었다. 두 잠금과 기존 registry는 변경하지 않는다. 등록 불가 상태에서 이 작업 기록으로 새 실행 경계·소유를 먼저 기록하고 독립된 Node 소스 검사만 실행한다. 결과와 미등록 산출물을 보존하며 삭제는 두 관리 기능 복구 후 정식 등록·검토를 받을 때까지 보류한다. 파일 잠금 해제나 보호된 산출물 삭제의 우회가 아니다.

동일 owner의 최종 재검사 group `run:DB01:runtime-fix-20261025-r2`는 같은 형식의 새 경로 `artifacts/tasks/DB-01-window-child-logoff/runs/runtime-fix-20261025-r2/`를 사용한다. r1의 188/188 통과(exit 0, 28.53초) 뒤 알려진 timeout·OS errno를 포함한 결과 불명 분류를 보강했으므로 수정된 입력으로 재검사한다. 두 group은 관리 잠금 복구 후 등록·검토하는 조건으로 보존한다.

# Window Use 자식 세션 종료 개선

## 목표·권한·범위
사용자 승인 후 정상 자식 세션은 소유자가 없을 때만 종료하고 비정상 자식 세션은 소유자 유무와 관계없이 종료한다. 기존 로그오프 기능을 재사용한다. Windows x64 로컬 same-user child session 대상이며 Linux/macOS 지원 변경은 없다. 코드·문서·집중 검증은 승인되었으나 제품 빌드·설치·실제 세션 10 로그오프는 이번 구현 승인에 포함하지 않는다. 세션 생성·재사용 정책은 조사와 설명만 하며 변경하지 않는다.

## 결정과 질문
- 현재 후속 요청: 진단한 결함 수정 승인. 공통 runtime Node 경로 계산, 승인 전 실행 파일 확인, 기존 Recovery sink를 이용한 제한된 진단, 실제 설치 설정과 같은 회귀 검사를 추가한다. 정상/비정상·소유권·승인 정책은 유지한다. Windows x64에서 검증하며 공통 Node 경로 계산의 기존 다른 플랫폼 분기는 유지한다.
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

## 설치본 오류 진단과 수정 제안

2026-10-25 Windows x64 로컬 설치본 2026.0.12, 실행 release `artifacts/workspaces/h/artifacts/releases/w13r-99afefb1`을 조사했다. 앞 절의 구현 시점 결과와 현재 설치본 수용 결과는 구분한다.

- 종료 요청의 공개 응답은 약 26초 뒤 `unclassified`였고 이후 자식 세션 10의 생존을 재확인했다. 원래 호출의 내부 예외 stack은 기존 로그에서 확보하지 못했다.
- 설치된 `out/window-child-session.cjs`는 현재 소스와 SHA256이 일치한다. 설치 helper는 manifest의 SHA256 `10a68423d99f399514270c0887d9b7f966f4ffbce4ba803d9fe9c0c335f3a055`와 일치한다.
- 같은 설치 helper의 `--inspect-child-logoff` 읽기 모드는 4.355초에 유효한 응답을 반환하고 4.365초에 종료했다. 현재 child 10은 abnormal/allowed이며, connection이 active/connected가 아니고 authenticated host 상태 조회가 시간 초과했다. 응답 ownerPresent=false는 host 조회 실패와 함께 해석해야 하며 소유자 부재를 독립적으로 검증한 증거가 아니다.
- 설치된 host의 `logoffIsolated` 함수와 실제 `azrael-runtime.json`을 사용하되 승인과 종료 호출을 격리된 대역으로 바꾼 실험에서 `ReferenceError: absolute is not defined`를 재현했다. 승인 지점 도달 1회, 종료 호출 0회다. 실제 설치 설정에는 `nodeExecutable`이 없고 `computerUse.directory`만 있으므로 해당 분기를 실행한다. `absolute`는 `prepareRequest`의 지역 함수여서 `logoffIsolated`에서 보이지 않는다. 원래 호출 stack의 직접 확인과 구분하되, 실제 설치 조건에서 확정적으로 실패하는 결함이다.
- 기존 host 테스트는 `nodeExecutable: process.execPath`를 항상 주입하여 잘못된 fallback 분기를 건너뛴다. `errorPayload`는 분류되지 않은 예외의 원문을 숨기고, 이 경로에는 예외 원인을 보존하는 진단 기록이 없어 공개 오류만으로 단계·원인·미실행 여부를 알 수 없다.
- 메모리 내에서 경로 검사를 유효한 검사로 바꾼 동일 함수 실험은 실제 존재하는 bundled `computer-use/node.exe`를 계산하고 종료 대역까지 도달했다. 실제 로그오프·승인·UAC·제품 파일 변경은 없으며 전체 설치본 수용 증거는 아니다.

권장 수정은 `prepareRequest`와 `logoffIsolated`가 사용하는 공통 runtime Node 경로 resolver를 두고, 승인 카드 이전에 runtime을 확인하는 것이다. `nodeExecutable`이 없으면 검증된 `computerUse.directory`의 bundled Node를 사용하며 임의의 PATH Node로 우회하지 않는다. 실패는 기존 `connection_error`와 안정된 nativeCode, stage, actionExecuted=false로 반환하고 기존 진단 sink에 원인을 보존한다. 설치 설정과 같은 fallback, 직접 nodeExecutable, 잘못된/없는 runtime, 승인 취소, 미실행·불확실 결과 구분을 검증하는 회귀 검사를 추가한다. 이후 새 패키지를 설치·reload하고 관리 도구를 통한 실제 승인·UAC·종료·재조회로 수용 검증해야 한다. 정책과 권한 조건은 그대로 유지한다.

## 결함 수정 결과

- `window-control-host.cjs`가 공통 Node resolver를 사용하고, 읽기 검사·승인 전에 Node와 PowerShell wrapper의 절대 경로·일반 파일 여부를 검사한다. 실제 설치 설정인 computerUse.directory fallback과 명시적인 nodeExecutable을 모두 유지한다. 상태/점유/사용자 승인 정책은 변경하지 않았다.
- 준비 실패의 단계·nativeCode·미실행 여부를 공개 응답에 포함한다. 알 수 없는 내부 오류·OS errno를 분류하며 알려진 timeout/취소 코드는 유지한다. 로그오프 dispatch 이후 terminal evidence가 없으면 결과 불명으로 유지하고 자동 재실행하지 않는다.
- 기존 Azrael Recovery sink의 `window_use.logoff_failed`에 임의 생성 requestId, 단계·안정된 코드·최대 3개 allowlisted cause type·결과만 기록한다. 원문 예외·경로·입력 이유·사용자/세션 식별자는 기록하지 않는다. owning architecture와 운영 진단 문서를 갱신했다.
- 기존 retained host/recovery 검사에 설치 설정 회귀·잘못된 runtime·권한 취소·검사 실패·일반 오류/OS errno/timeout의 결과 불명·로그 민감정보 제외·sink 실패 검증을 보강했다. 이 검사는 실제 제품 계약 재발을 방지하므로 유지하며 새 일회성 테스트 파일은 만들지 않았다. 기존 집중 runner와 bundle 입력에 Recovery 검사를 연결했다.
- 최종 실행은 runtime-fix-20261025-r2의 tests.log/tests.stderr.log/receipt.json이다. Windows x64에서 14개 소스 검사 파일, 190/190 pass, 실패·skip 0, 실제 exit 0, 13.57초(프로세스 외곽 13.96초)이다. 기존 helper는 가상 journal의 읽기 전용 fixture로만 재사용했다. 제품 build/installed-host/UAC/live logoff 수용은 검증하지 않았다.
- 재검사 후 새 테스트 블록의 줄바꿈만 정리했다. LF 정규화한 내용 SHA256이 전후 동일함을 확인했고 `git diff --check` exit 0이다. 코드·테스트 입력을 검사 도중 수정하지 않았다.
- r1/r2의 소유 fixture는 기존 테스트 teardown으로 정리됐고 각 temporary 아래 남은 항목은 빈 목적별 디렉터리다. 로그·receipt와 빈 디렉터리는 전체 group으로 보존한다. 기존 catalog.lock(빈 파일)과 maintenance.lock(pid=72792)은 변경하지 않았다. Native 등록·검토·apply는 잠금 때문에 수행되지 않았으므로 도구상 deferred 처리를 완료했다고 보고하지 않는다. 두 registry의 supported 복구와 lock 해제 뒤 r1/r2를 등록하고, 결과 인계 후 불필요한 전체 group을 검토·삭제한다.
