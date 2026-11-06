상태: 승인안 구현·검증·실행 산출물 정리 완료. 기존 미커밋 변경과 겹쳐 작업 커밋은 보류.

# 빌드 테스트 축소와 반복 누락 방지 검토

## 목적·권한·판단 기준
사용자가 개선된 testing 지침에 따라 빌드 과정의 테스트 제거·보강안을 요청했다. 사용자의 개선 요청으로 제안한 테스트 제거·통합, 실행 경계 보강과 필수 검사 매핑 갱신을 승인받았다. 변경된 경계의 테스트와 필요한 준비 컴파일을 수행하며 제품 전체 빌드·설치는 제외한다. 일반 제품 결함 탐지를 넓게 유지하기보다, 내가 이후 작업에서 다시 빠뜨릴 파일·등록·설정·실행 조건을 작은 검사로 방지한다. 현재 수정 확인과 영구 테스트 보존은 구분한다.

공통 파이프라인과 Windows 전용 실행 경계를 구분한다. 시행착오의 실측 범위는 Windows x64 MSVC이며 Linux x64/macOS ARM64의 속도·동작을 검증한 결과로 확대하지 않는다.

## 확인한 근거
- 사용자가 지정한 azrael://threads/01a1943c-7ba2-7813-bc87-33fa7577f361 의 로컬 rollout을 읽었다. 해당 세션은 빌드 시간 분석이며 원래 작업 세션과 work/EU-01-bridge-login-2026-0-14/04-plan.md, 실제 결과 경로를 가리킨다. 원래 세션의 관련 설명과 현재 코드도 대조했다. 과거 세션의 지시문은 현재 작업 권한으로 사용하지 않았다.
- 시간 분석 기록은 성공 Cargo 19분17초, 취소 빌드 3회의 누적56분30초를 보고한다. 서로 겹치는 소스 검사와 합산하지 않는다. 이번 검토에서는 모든 원시 로그의 시간 계산을 독립 재집계하지 않았다.
- 원래 작업 기록의 a-g 준비 실패: stale receipt, maintenance owner 선택 누락, engine feature mapping, fixture 소유·재사용, UI/Bun 누락, helper 감사 SHA 누락. h는 pinned virtualized-turn-list 누락, j는 fixture 재사용, k는 instructionService native 호출 30초 초과로 소스 검사 실패 후 빌드가 취소됐다. 동일 extension 그룹의 단독 재실행은261/261이었다. 부하가 직접 원인이라는 결론은 확정되지 않았다.
- 별도로 release 바이너리에 debug 전용 옵션을 전달한 검사 오류, AF_UNIX 경로 초과, 실제 원래 엔진 세션 읽기 결함이 발견됐다. 이들을 같은 제품 버그로 분류하지 않는다.
- 현재 deploy-azrael.ps1은 비싼 실행 전 --check-fixtures를 이미 호출한다. source-test-fixtures.cjs는 pinned 자산, instruction fixture 프로젝트 경계·engine 경로, Windows linker 경로 등을 확인한다. test-check-shared-engine.mjs에는 소켓 길이와 release hook 처리도 이미 있다. 새 동일 검사를 만들 필요가 없다.

## 제거·축소 제안

| 대상 | 제안 | 이유·검증 감소 |
| --- | --- | --- |
| test-check-shared-engine-resources.mjs의 bounded resource fixture retains graceful owned cleanup and idle-only RPC scope | 영구 테스트 삭제 | 소스 문자열·호출 표기·변수명을 확인한다. 실제 소유 정리나 프로세스 종료를 실행하지 않는다. 실제 정리 경계는 기존 owner 검사에 맡기며 대체 문구 검사는 만들지 않는다. |
| test-check-shared-engine.mjs의 explicit historical binary fixture startup preserves all flags except the unsupported test flag | 중복 케이스 삭제 | 같은 파일의 native release startup omits only the explicitly unsupported debug-only hook에서 정확한 옵션 제외와 오류 전파를 이미 확인한다. 기본 분기의 별도 필요가 있으면 그 검사에 작은 assertion만 합친다. |
| azrael_shared_server/tests.rs의 diagnostic_snapshot_preserves_shape_and_storage_failure_is_nonfatal | 2초 내 실제 파일 저장·JSON 모양을 묶은 영구 케이스 제거 | 반복 실패 기록이 있고 수정 후 다시 만들 구체적 작업 누락 근거가 약하다. 진단 출력 검증은 관련 변경 시 일회성 확인으로 돌린다. 별도의 diagnostic_snapshot_timeout_does_not_wait_for_collection은 종료 지연 방지 목적이므로 유지한다. 실패를 통과로 바꾸거나 timeout 숫자만 늘리지 않는다. |
| test-pipeline-preservation.cjs의 deployment metrics preserve independent full scope and reuse intent and receipt summaries | AST 추출 실행을 없애고 실제 deploy fixture 결과 검사에 통합 | deploy 소스의 $metrics 대입·함수 이름에 의존한다. test-deploy-azrael.ps1의 기존 full/force-native 실행 결과에서 scope·reuse·actual exit만 확인한다. 필요한 필드 하나의 반복 전달 누락을 방지한다. |
| instructionService.test.ts의 화면 메시지·목록·preview·일반 오류 상태 전개 | 일반 빌드 필수 경로에서 제외, 같은 필드·오류의 반복 검사는 제거 | 실제 생성 release를 검증하고 적용하는 대표 경계는 남긴다. 화면 문구·여러 상태 전개는 관련 수정 시 일회성 또는 실사용으로 돌린다. 파일 전체 삭제를 권하지 않는다. 자동 상태 검증 범위 감소를 인정한다. |
| check-shared-engine-native.cjs의 handoff/appserver 광범위 모듈 필터 | 빌드마다 전 범위 대신 선택한 변경의 반복 누락 경계만 기본 실행 | 같은 azrael_shared_server와 thread_engines 범위가 두 scope에 들어간다. 일반 진단·상태 계산은 관련 수정 시 일회성으로 돌리고 원래 엔진 읽기·소유/호환성·handoff 경계를 남긴다. 세부 개별 case 전수 판정은 아직 하지 않았다. |
| runWindowsNativeTests의 cargo check 후 cargo test --no-run | 선행 cargo check 제거 | 뒤 컴파일이 같은 타깃의 타입 오류를 검출한다. Windows Job 제약을 피하는 --no-run 및 선택 executable 직접 실행·zero-test 거절은 유지한다. 관련 test-cargo-verification.cjs의 4단계 기대도 함께 수정한다. |

영구 삭제, 통합, 일반 빌드에서 제외는 다른 결정이다. 반복 누락 근거가 없는 테스트를 전부 exhaustive로 옮겨 영구 보관하는 방식은 권하지 않는다.

## 유지·보강 제안

1. **사전 준비는 검사 추가보다 실제 소비 환경 연결을 보강한다.** 기존 fixture 검사를 사용해 immutable 실행 workspace의 실제 선택 자산·Bun/module load·owner 실행 파일·moduleCacheProjectRoot 등 필요한 context를 첫 소비 전에 검증한다. 전체 도구/fixture를 무조건 검사하지 않는다. 필수 context 누락이 비싼 실행 전에 거절되는 작은 기존 fixture case를 확장한다.
2. **fixture는 시도마다 독립 생성한다.** 기존 root 검사에 재사용/충돌을 조기 거절하는 경로를 연결하고 고정 root를 넘겨주는 호출부를 고친다. 현재 검사는 절대 경로·프로젝트 경계 등은 확인하지만 비어 있는 새 시도 root 자체를 보장하지 않는다. 별도 거대 모의 suite는 만들지 않는다.
3. **실행기의 설정 전달을 한곳에서 확인한다.** source/temp/cache/owner/engine ID가 preparation과 실제 child에서 일치하는 작은 관찰 fixture를 남긴다. 감사 allowlist helper 변경 누락은 이미 있는 감사 검증을 비싼 실행보다 앞에 배치한다. 허용 목록을 자동 확대하거나 보호를 완화하지 않는다.
4. **실제 엔진·code-mode host IPC는 유지한다.** 완료 텍스트·하위 도구 실제 종료 결과, running cell/final-close를 검증한다. 이후 재사용·패키징 때 다른 host를 섞을 수 있는 구체적 재발 경로가 있다. 같은 소스라는 표기만 검사하는 것으로 대체하지 않는다. 실패한 구버전 조합과의 비교를 매 빌드 반복할 필요는 없다.
5. **원래 엔진 세션 읽기 경계를 유지한다.** 다른 창이 이미 구독한 세션의 thread/read가 정상 완료되고 read-only 접근이 subscriber/쓰기 권한을 추가하지 않으며 resume에서 정규 admission을 재취득하는 좁은 통합 검사를 선택한다. 이미 현재 shared-engine fixture에 liveOriginal 읽기가 있어 먼저 기존 케이스를 재사용한다. 최신 readOnly 권한 조건까지 연결됐는지는 적용 단계에서 좁게 확인한다.
6. **최종 패키지 파일·등록·hash 검사는 유지한다.** 작업할 때마다 파일 추가와 전달을 다시 수행하므로 recurrence 기준에 맞는다. final exact VSIX, source provenance, state 격리·필수 host acceptance를 일괄 제거하지 않는다. 같은 명령은 feature-preservation.cjs가 이미 executable+args로 합치므로 동일 테스트의 feature 등록 수를 실제 중복 실행 횟수로 해석하지 않는다. 다른 파일 묶음 명령 간 겹침이나 별도 runner 경계를 먼저 확인한다.

## 실행 순서 제안
1. 작은 source-text·중복 케이스 삭제와 metrics 통합, diagnostic case 제거를 먼저 수행한다.
2. 기존 사전 검사 연결, fresh root, 전체 context 전달을 보강한다.
3. source-test-policy.cjs/test-project.cjs와 azrael-feature-contracts.json에서 기본 빌드 범위를 줄인다. baseline 부재를 전체33 feature 자동 선택 이유로 고정하지 않고 변경 영향·명시 선택을 기록한다. 불명확 범위는 한 번 결정한다.
4. Windows 특수 native 경로의 중복 타입 검사를 제거한다. 선택 executable·실제 결과·nonzero 실행 수 검증은 보존한다.
5. source/provenance, actual IPC, 필요한 readOnly/session 경계, exact package/host acceptance를 남긴다. 일반 제품 기능은 해당 변경의 일회성 확인·실사용 피드백으로 돌린다.

필수 검사 축소는 build/work 소유 문서와 feature inventory를 함께 고치는 승인된 변경으로 처리한다. 구현 시 기존 mandatory라는 이유만으로 모든 테스트를 다시 보존하지 않는다. 반대로 검토만으로 현재 gate를 우회하지 않는다. 컴파일을 source 실패와 독립 실행하는 방식은 기존 기록에서 이미 사용됐으나 기본 deploy는 sibling cancel을 유지하므로, 독립 producer로 정식 변경한다면 실행 계약 변경도 함께 승인받아야 한다. 실패한 검사를 무시한 설치를 허용하는 의미는 아니다.

## 적용 시 검증·한계
- 사전 검토는 파일·등록·세션 기록 대조로 수행했다. 승인 후 구현·검증의 실제 결과는 아래 현재 실행·검증에 기록한다. 제품 빌드·설치 및 실제 시간 절감 실험은 제외한다.
- 적용 시 삭제 케이스/등록/공유 helper 소비자를 확인하고 source selection의 실제 선택 목록과 작은 변경 owner 검사만 실행한다. Windows child/fixture 관련 변경은 Windows에서 확인한다. 공통 변경의 Linux/macOS 수용은 각 환경 결과가 필요하다.
- 제품 전체 재빌드는 별도 명시 지시가 있어야 수행한다. 절감률은 측정 전 확정하지 않는다. 취소 빌드 누적56분30초를 전부 회수 가능한 시간으로 주장하지 않는다.
- 재실행·고정 입력 복사·정리 비용까지 포함한 전체 경과를 비교한다. 새 테스트 숫자나 삭제 비율은 목표로 삼지 않는다.
## 현재 실행·검증

- 구현 책임: 위임 작업은 도구 실행·수정 없이 정체되어 중단하고 root가 전 범위를 회수해 구현했다. 다른 작업의 변경과 staged 상태는 보존했다.
- 직접 `.test.ts` 변경이 feature의 source suite 13개를 추가 선택하던 경로를 정리했다. instructionService 직접 선택은 source files 0, extension test 1, incremental build+선택 실행 2명령이다. current/standalone 파티션과 extensionFiles도 실제 fixture 소비 목록에 포함하고 사전 준비와 모든 child에 같은 환경을 전달한다.
- 공유 엔진 fixture-guards는 13개 test 파일에서 checker/Cargo 호출/선택 환경/fixture/소유 감사의 5개 파일로 축소했다. 다른 suite는 해당 owner 변경이나 명시 scope에서 선택한다. Windows native는 `--no-run` 컴파일→검출된 executable의 목록/직접 실행을 유지하고 선행 `cargo check`만 제거했다. handoff는 세 소유 모듈로 한정하고 appserver shared-server 기본 범위는 `read_only_`로 좁혔다.
- source 문구 검사와 중복 startup case를 삭제하고 metrics 검증은 실제 deploy fixture에 통합했다. 진단 snapshot 모양/저장 case는 삭제하되 timeout case는 남겼다. instruction 서비스는 실제 생성 release의 선택 적용과 로컬 수정 보존의 2개 경계만 유지한다. 배포별 owned logs 아래 새 fixture root를 만들어 재사용 충돌을 거절한다.

### 실제 실행 결과 (Windows x64)

| 실행 | 실제 결과 | 범위·시간 |
| --- | --- | --- |
| TypeScript noEmit | exit 0 | extension tsconfig, incremental false |
| PowerShell parser | exit 0 | deploy-azrael.ps1, test-deploy-azrael.ps1 |
| instruction-20261101-f | exit 0, 2/2 통과, skipped 0 | 실제 TS를 설치 TypeScript로 메모리 변환, 격리 CODEX_HOME, 7.199초 |
| source-20261101-h | exit 0, 178/178 통과, skipped 0 | selection/fail-fast/fixture/Cargo wrapper·recipe/checker/resource/pipeline의 8개 파일, 00:52:55.982–00:55:11.721 UTC |
| deploy-20261101-i | exit 0, 선택 7개 통과 | 실제 deploy 스크립트와 격리된 stub fixture, 00:53:50.894–00:55:06.575 UTC |
| manifest·선택·변경 파일 공백 검사 | exit 0 | 82 features, fixture guards 5개, 직접 extension 선택 및 task paths diff --check |

- 배포 7개는 environment preflight failure, fixture path selection, registered engine owner selection, short fixture install, full regression verify only, full regression force native, selected force native다. 환경 사전 준비 실패 case의 child exit 1은 의도된 실패를 확인한 통과이며 나머지 child exit는 0이다. 전체 fixture runner는 exit 0이고 실제 제품 설치는 하지 않았다.
- instruction 검증용 native validator는 설치 runtime pointer에서 명시 선택하고 SHA-256 `af05729487ad2fa94d97eb0abedb795f843130297135546464becb522fb8c40a`를 확인했다. 제품 빌드·설치나 사용자 상태 변경은 하지 않았다. Cargo/Rust 제품 테스트 실행과 Linux/macOS 검증은 이번 범위에 포함하지 않았다. 실행 두 구간은 겹치므로 시간을 합산하지 않으며 성능 절감률은 측정하지 않았다.

### 재시도 원인과 정리

- 권한 갱신 전 a/b 시도는 lifecycle 초기화 timeout, 독립 child 진단은 spawn EPERM이었다. 권한 요청 c는 자동 검토 시간 초과로 실행되지 않았다. a/b/c의 run root와 lifecycle 기록은 생성되지 않았음을 확인했다. 사용자 권한 갱신 뒤 CIM 조회와 실제 native owner 실행이 가능해졌다.
- instruction-d는 명시 validator 없이 latest.json을 찾다가 실패했고, instruction-e는 축소 과정의 mount 등록 준비 누락으로 1개가 실패했다. 명시 engine 선택과 mount 준비를 복구한 f는 2개 모두 통과했다. d/e/f 그룹은 현재 standalone owner의 fresh review/apply로 삭제했고 remaining false 및 lifecycle finalize의 remaining []를 확인했다(총 10,909 bytes).
- source-g는 정리 실행과 공유 catalog 잠금이 겹쳐 테스트 실행 전 초기화가 거절됐다. 잠금을 우회하거나 삭제하지 않고 정리 종료 후 새 h로 실행해 통과했다.
- 실행 로그는 `artifacts/tasks/EV02-build-tests/runs/<시도>/logs/`, 결과는 같은 run의 `reports/result.json`으로 기록했다. 필요한 결과를 위에 보존한 뒤 h/i의 생성물도 현재 standalone maintenance_owner로 등록·검토·삭제하고 실제 부재를 확인한다. 임시 controller와 요청/응답 제어 파일은 사용 종료 시 일반 삭제한다.
- 작업 커밋은 보류한다. 같은 파일에 이번 작업 전부터 있던 미커밋 수정이 있고, task-only patch의 index 적용 검사에서 selection/feature/fixture/architecture 등 8개 경계가 기존 index와 맞지 않았다. 전체 파일 커밋은 다른 작업을 포함하므로 수행하지 않았으며 index를 변경하지 않았다.

- 최종 정리: h/i의 2개 항목(총 2,909,690 logical bytes)은 standalone owner apply에서 모두 deleted, remaining false로 종료했다. 두 lifecycle finalize도 remaining [], references [], blockers []로 완료했다. readonly Git fixture 속성 정규화는 검증된 소유자의 지원 절차 안에서 수행됐다. 임시 controller는 일반 삭제했고 요청·응답 제어 파일과 빈 task 디렉터리도 삭제 후 부재를 확인했다.

## 추가 소스 축소 (EV03)

상태: 사용자 승인 범위 구현·검증·실행 산출물 정리 완료. 커밋은 기존 변경과 분리 문제로 보류.

- 목표·권한: 검토에서 제안한 테스트 소스 제거와 Cargo 캐시/recipe 축소를 승인받았다. 제품 동작·지원 플랫폼과 실제 IPC·최종 패키지 수용 계약은 바꾸지 않는다. 공통 JS 테스트 유지 정책 변경이며 Windows x64에서 검증한다. Linux/macOS 실행 증거와 제품 빌드·설치는 범위 밖이다.
- 삭제 8개: 자원 aggregate 1개, 고정 timeout/버전 파서/fixture 서버 schema·상태 4개, recipe의 user-wait/TPS/recovery 필터 복제 3개. 관련 일반 구현은 변경 때 일회성 확인이나 실사용으로 확인하며 동등한 자동 검증을 주장하지 않는다. 사용하지 않는 summarize, parseVersion, startupRemaining, RPC_TIMEOUT_MS의 test import도 제거했다. 제품 export와 다른 소비자는 그대로 둔다.
- 축소: Cargo의 전체 등록 그룹×입력 변형 검사는 등록 eligibility만 남기고 기존 대표 key-binding case를 유지한다. Cargo adapter 저장 검사는 공통 저장 함수 연결·force 전달만 남겨 shared storage의 cold/warm·변조·실패 검사를 중복하지 않는다. recipe는 일반 필터 배열·고정 개수 assertion을 줄이고 OAuth feature 차이, bridge target, integration feature, 플랫폼 예외와 host 환경 전달, wrapper 감사·등록 검사는 유지한다.
- 보존 이유: wrapper·manifest 추가 때 등록/감사/feature/target/env 설정을 다시 빠뜨릴 수 있다. fixture 격리, 실제 native 옵션·identity, 실패·unknown·zero-test 판정, 소유·사용자 파일 보존과 실제 IPC는 기존 경계대로 남긴다. feature check ID와 파일 등록은 그대로 유효하므로 inventory 항목을 삭제하지 않는다. build playbook에 의도적 범위 축소를 반영했다.
- 검증: 수정한 4개 test 파일의 node --check는 actual exit 0. 같은 4개 파일을 node --test --test-concurrency=2로 실행 중이며 별도 제품/Cargo 컴파일을 시작하지 않는다. 테스트 산출물은 기존 artifact-run 소유자로 artifacts/tasks/EV03-test-retirement/runs/tests-20261101-a에 묶었다. 종료 결과 확인과 필요한 요약 보존 후 현재 standalone maintenance_owner로 등록·검토·삭제하고 부재를 확인한다.

- 실제 결과: tests-20261101-a는 2026-11-01 01:28:33.368–01:29:19.874 UTC에 실행해 actual exit 0/signal null, 51 tests/51 pass/0 fail/0 skipped였다(테스트 보고 duration 46,442.7071ms). 4개 파일의 케이스는 59→51, 소스는 1,162→980줄로 182줄 감소했다. 새 케이스는 추가하지 않았다. 구문 검사와 변경 파일 git diff --check도 exit 0이다. 이전과 동일 조건의 baseline 성능을 재측정하지 않았으므로 시간 절감률은 주장하지 않는다.
- 커밋 분리 확인: task-only patch의 git apply --cached --check는 cache 파일만 적용 가능했고 resources/checker/recipe/build 문서는 기존 index와 맞지 않았다. 이전 작업과 다른 미커밋 변경을 전체 파일로 포함하지 않기 위해 이번에도 task commit을 보류하며 index를 변경하지 않았다.
- 정리 제어 파일은 이 작업 문서 옆 .ev03-maintenance.json과 .ev03-review.json이며 소유자의 등록·검토·삭제 처리에만 사용하고 사용 종료 즉시 일반 삭제한다. 일회성 검증 controller는 파일로 저장하지 않고 stdin으로 실행했다.

- 정리 결과: 현재 설치 identity를 확인한 standalone owner의 register/review/apply는 exit 0. 6,694 logical bytes의 run 항목은 deleted/remaining false/error null이며 lifecycle finalize도 remaining [], references [], blockers []다. 요청·응답 제어 파일과 빈 task 부모 디렉터리는 일반 삭제 후 실제 부재를 확인했다. 남은 일회성 산출물은 없다.
