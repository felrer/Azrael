상태: 1번 개선 완료. 검증 후보의 기본 standalone 전환, 실제 기본 경로 회귀, 이전 설치본·일회용 run 삭제와 finalize 완료.

# 보호 성능·잠금·복구 후속 조사

## 기본 실행기 채택 승인과 검증

사용자가 빌드 개선 검토의 1번 항목 실행을 승인했다. 기존에 검증한 Windows x64 standalone 후보 `f167e9bd…`를 기본 선택으로 채택하는 범위이며, 앱·내장 엔진 재빌드와 아래 별도 apply 프로파일링은 이 전환에 포함하지 않는다. 먼저 후보 override로 캐시 전체 회귀를 실행하고, 통과하면 새 설치 참조를 추가한 뒤 selector와 설치 영수증을 같은 identity로 맞춘다. 실제 기본 경로의 lease와 recovered-marker 회귀를 통과한 후에만 정확한 이전 installation 참조를 해제한다. 남은 소비자·점유·불확실성이 없는 이전 설치본과 일회용 run은 기존 standalone owner의 fresh 심사·삭제·부재 확인·finalize로 정리한다.

실행 묶음은 생성 전 등록한 `artifacts/tasks/EQ-01-protection-timing/runs/default-deploy-r1/`, owner `maintenance-owner-deployment`다. 결과와 최소 독립 검증 근거는 채택 version의 `verification/default-installation-*.json`과 `12-default-owner-deployment.json`에 보존한다. 이 전환은 소스별 전체 빌드 시간 개선율을 새로 측정하는 작업이 아니다.

2026-10-30 검증: 후보의 `test-build-module-cache.ps1` 전체 회귀는 223.141초, 실제 기본 경로의 `-RecoveryOnly`는 27.890초에 각각 exit 0으로 종료했다. 재실행 없이 순서대로 수행했다. 기본 resolver의 실제 SHA와 native lease 획득·해제를 확인했고 selector와 기존에 뒤처져 있던 설치 영수증을 모두 같은 후보로 맞췄다. 새 installation 참조를 먼저 추가하고, 기본 경로 검증을 마친 뒤 정확한 구형 installation 참조만 CAS 해제했다. Windows x64 standalone·Node·PowerShell 기본 선택에 반영됐으며 앱 내장 엔진은 바꾸지 않았다. 아래 과거 승인 대기·설치 미변경 설명은 당시의 조사·계측 상태다. 별도 apply 프로파일링은 계속 독립 범위로 유지한다.

정리 완료: 현재 소비자가 없는 구형 9bc66314 version과 일회용 run을 기존 native owner의 등록·fresh 심사·명시적 apply로 삭제했다. 두 항목 모두 차단 없음, apply exit 0·status deleted·remaining false, 실제 경로 부재와 producer record finalize를 확인했다. logical bytes는 합계 2,194,283이며 물리 회수량은 측정하지 않았다. run 최초 등록 118.373초, 심사 13.089초, apply 86.543초가 들었으므로 관리 목록 처리 지연은 남아 있다. 검증 로그의 필요한 결과와 종료 근거는 설치 version의 `verification/default-installation-test-results.json`, `default-cleanup-provenance.json`, `default-cleanup-final.json`에 독립 보존했다. 점유·잠금·권한 우회와 재빌드는 없었고 이 작업의 일회용 경로는 남지 않았다.

사용자는 앞선 해결안과 5초 암묵적 대기 제거를 포함한 개선·검증을 승인했다. 기존 실측 기록은 `01-plan.md`에 보존한다. 공통 Node/native 유지보수 경로와 해당 회귀 검사를 수정하고, 고정 입력으로 필요한 standalone 컴파일·수용·재측정을 수행한다. 제품 전체 빌드와 앱 설치는 범위 밖이다. 기본 selector와 설치 참조 변경은 배포 승인 검토에서 거절되어 실행하지 않았다. 명시적 배포 승인을 받기 전에는 기존 실행기를 유지한다.

대상은 ① 참조 추가·refresh·최초 등록 지연 ② catalog 잠금 경합 ③ 정상 실패 후 남는 예약 ④ Windows 파일 잠금 오류와 stale review token이다. 재현된 안전 차단과 결함을 구별하며 보호·소유·참조·권한·미확인 결과 보존을 약화시키지 않는 방안을 제안한다.

Windows x64 설치물의 기존 관측을 기준으로 공통 Node/Rust 구조와 Windows 전용 처리를 구분한다. 다른 플랫폼 실기와 설치 바이너리로 확인되지 않은 현재 소스의 동작은 별도로 표시한다.

root는 요구사항·문서·고정 입력·통합 검증·실측·정리를 맡고, Node/native 구현 소유자가 승인 범위의 코드와 기존 회귀 검사를 수정했다. 기존 미커밋 변경은 baseline으로 보존했다.

수용 기준은 기본 즉시 busy·명시적 대기, 보호·CAS·미확인 결과 경계 보존, 안전한 pre-intent 실패 마무리와 진단 개선, 고정 입력 Windows 회귀·실측이다. 최초 등록 지연과 다른 플랫폼 실기 검증은 남은 한계로 구분한다.

## 결론과 근거 수준

파일 자체의 내용 처리만으로 지연을 설명할 수 없다. 확인한 핵심 구조는 **전체 관리 목록의 반복 조회와 경로 검사**, 그 작업을 수행하는 **전역 catalog 잠금의 긴 점유**, **작업 중 잠금 확인과 최초 획득의 대기 정책 차이**, **실패 경로에서 예약 해제까지 도달하지 못하는 흐름**이다.

현재 소스에는 분할 저장·계측·최종 잠금 재획득 대기 등 미커밋 개선도 있다. 이를 별도로 재구현하지 않고 현재 변경을 검증·통합하는 것이 우선이다. 다만 이 소스와 실측에 사용한 설치 실행기의 출처는 같다고 확인되지 않았으므로, 현재 소스의 정적 분석을 설치 바이너리의 정확한 실행 추적으로 표현하지 않는다.

| 현상 | 확인한 원인/조건 | 남은 불확실성 |
| --- | --- | --- |
| 보호 참조 추가 6.75~15.42초 | Node의 동일 lease 안에서 전체 catalog 조회 반복. 새 참조 1개를 추가하는 기존 기록 경로는 `otherOwners`, run-root 충돌 검사, target 검색, observation 보호에서 4회 전체 조회 가능 | 기존 3회 수치 중 단계별 기여율은 기록하지 않았음 |
| refresh 6.30~13.98초 | payload 재해시는 하지 않지만 producer source 전체 관측·재관측은 수행 | 설치 실행기의 단계별 시간 분해 없음 |
| 최초 등록 172.52초 | 현재 소스의 특정 신규 등록 경로는 예약/fence/owner 재검증으로 catalog 진입이 약 22회까지 누적되는 정적 경로. 내용 측정과 저장소 재개 비용도 추가 | 정확한 설치 source와 동적 호출 횟수는 미확인. 172.52초 전체를 한 항목에 귀속하지 않음 |
| catalog busy와 실패 후 예약 잔존 | 최초 잠금 획득과 일부 중간 `check_available`의 재시도 정책이 다름. 예약 생성 후 `?` 반환으로 명시적 해제 단계에 도달하지 않는 경로가 있음 | 불확실한 intent를 보호하는 정상 보존과 회수 가능한 pre-intent 실패를 구분해야 함 |
| Windows `os error 33` | 파일 잠금 실패. 현재 코드의 shared-lock 재검증 경합 경로와 관측이 부합 | 기존 오류에 경로·단계가 없어서 정확한 발생 지점은 확정 불가 |
| stale review token | 적용 직전 재관측 토큰이 기존 승인 토큰과 다를 때 차단하는 안전 검사 | 실제로 달라진 구성요소는 미기록. 자기 예약이 원인이라고 단정할 근거 없음 |

## 추가 읽기 전용 계측

2026-10-30 조사 시점의 실제 프로젝트에서 `catalog()`를 한 번 실행하고 같은 프로세스 안에서 Node `fs` 호출 횟수만 집계했다. 잠금 획득·등록·파일 변경은 하지 않았고 결과는 stdout에만 출력했다.

| 항목 | 관측 |
| --- | ---: |
| lifecycle 기록 | 661개 |
| instrumented catalog 경과 시간 | 1854.9336ms |
| `lstatSync` | 83,397회 |
| 서로 다른 lstat 경로 | 6,534개 |
| `readFileSync` | 661회 |
| `readdirSync` | 1회 |
| lstat 내부 누적 시간 | 약 1158.25ms |
| readFile 내부 누적 시간 | 약 124.52ms |

`C:/Users`, 사용자 홈, Desktop, 프로젝트 루트는 각각 10,054회 검사됐다. 이 관측은 현재 조회 한 번의 중복 비용을 확인한다. 이전 실측 당시에는 기록이 648개였고 계측 오버헤드·동시 작업 조건도 다르므로, 이 수치에 4를 곱해 이전 API 시간을 재현했다고 주장하지 않는다.

### 주요 코드 근거

- Node 전체 조회·경로 검증: `scripts/artifact-lifecycle.cjs:11`의 `checked`, `:30`의 `validate`, `:58`의 `catalog`. 각 member/ref 경로마다 상위 경로를 반복 검사한다.
- 잠금 안의 반복 조회: 같은 파일 `:76`의 `withCatalogLock`, `:219`의 `recordLifecycleUnlocked`, `:228`, `:235`, `:266`; `scripts/artifact-observations.cjs:59`의 `protectOwner`도 catalog를 읽는다.
- native 전체 source 관측: `engine/codex-rs/project-maintenance/src/registry.rs`의 `catalog` 및 `observe`. 현재 구현의 `observe`는 catalog를 두 번 읽고 각 catalog는 파일 변경 감지를 위해 JSON 바이트를 재읽는다. 파싱 캐시가 열거·읽기·경로 검사를 제거하지는 않는다.
- 등록과 refresh: `registration.rs`의 준비→예약→측정→재개→commit, `groups.rs:258`의 `refresh`. refresh는 root observation과 producer 관측을 수행하고 payload 트리 측정을 생략한다.
- 저장: `storage.rs` 및 `partitioned_storage.rs`. 현재 분할 저장은 전체 논리 상태의 읽기·비교를 유지하면서 변경 bucket만 쓴다. `compact_storage`는 오래된 blob을 회수하며 source 반복 조회를 해결하지 않는다.
- 잠금/예약: `registry.rs:118`·`:417`의 `check_available` 사용, `reservations.rs`의 `verify_sources`·`ReservationSet::verify`·예약 release, `lock_recovery.rs`의 typed busy와 `wait_for_lock`. 등록의 재획득 오류, 적용의 항목 전 verify 오류 등은 release 전 반환할 수 있다. 일반 Sentinel drop은 durable 예약 파일을 삭제하지 않는다.
- 토큰: `apply.rs:575`의 적용 직전 토큰 비교, `groups.rs:442`의 그룹 토큰 결합. 현재 producer catalog는 reservations 하위 경로를 제외한다. Windows registered root 관측은 파일 객체 identity·종류·presence를 사용하므로 실제 root 교체/부재 변화도 후보이며, 단순 내용 변경으로만 설명하지 않는다.

라인은 조사 시점 작업 트리 기준이다. 관련 파일에 기존 미커밋 변경이 있어 이후 이동할 수 있다.

## 설치 실행기와 현재 소스의 차이

실측 실행기의 SHA-256은 `9bc66314681460df3d6da3a9dc923eac52411e22d1fb595b08371477ac492a26`이며 기본 selector는 그대로다. 보존된 `verification/source-verification.json`은 frozen source receipt SHA `dcd088f8633f2908af1f05e31fc110c11d7d80a19cc4dc0bdffc553c9b600206`, inventory SHA `27d0db9893c7f27d7f7f0c6bdf874817524abbc0be736a1d09330d1d5213c07d`를 기록한다.

조사 중 현재 `engine/SOURCE.json`의 receipt/inventory는 위 값과 달랐다. `reservations.rs`는 현재 SOURCE의 파일별 선언 hash와 실제 hash도 달랐고, 관련 Node/native 파일의 미커밋 변경을 확인했다. 측정 기록 커밋 `ddf35760`의 SOURCE도 설치 영수증과 달랐다. 원래 입력 경로와 작업 기록이 가리키는 이동 후 `archive/.../native-r2/inputs/engine` 모두 현재 부재였다. 따라서 설치물 source를 현재 코드와 동일하다고 복원·검증하지 못했다.

새로운 수정안은 현재 변경을 소유한 작업과 통합하고, 입력을 고정해 검증한 실행파일을 명시적으로 선택해야 한다. 소스만 수정한 뒤 기존 실행파일로 재측정해서는 개선 여부를 판단할 수 없다.

## 권장 해결 순서

### 1. 단계별 계측과 오류 맥락을 먼저 확보

현재 미커밋 `timing.rs`와 기존 logging 경로를 재사용한다. catalog 열거/읽기/검증 횟수와 시간, payload 측정·해시, 저장소 읽기/저장, 잠금 대기/보유/재획득, 실패 단계와 예약 상태를 구분한다. 계측 출력 실패가 원래 동작 결과를 바꾸지 않아야 한다.

`os error 33`에는 operation·phase·path·그룹·lock 종류를 붙이고, 토큰 오류에는 expected/current의 root observation·source identity·owner revision·reference revision 중 어떤 구성요소가 달라졌는지 기록한다. 전체 producer JSON이나 payload 내용을 로그로 남길 필요는 없다. 실제 변경이 차단됐는지 무관한 변경으로 무효화됐는지 먼저 판별한다.

### 2. Node 반복 조회와 native 반복 관측 비용 축소

- Node는 **동일 catalog lease 안에서 한 번 만든 snapshot과 ID/경로 인덱스**를 재사용한다. observation 추가/갱신 같은 자체 쓰기는 snapshot에 즉시 반영하거나 무효화한다. 새 참조마다 전체 catalog를 다시 읽지 않도록 한다.
- 장기 전역 캐시로 보호 상태를 추측하지 않는다. 경로·객체 확인과 최종 CAS/쓰기 전 검사, 새 consumer 및 source 변경 차단은 보존한다. 상위 경로 검증 중복을 줄일 때도 reparse/root 교체를 놓치지 않도록 객체 handle 또는 적절한 최종 재검증을 사용한다.
- native는 현재의 source fence, catalog lease, 파싱 캐시와 저장 개선을 재사용하고, 같은 보호된 관측 구간 안의 중복 검증 결과를 요청 단위로 전달한다. 관측 사이에 잠금을 놓은 구간은 새 consumer를 확인하는 fence/CAS 검사를 유지한다. 이중 관측을 무조건 삭제하는 방법은 제외한다.
- 보호 메타데이터만 바뀌는 경로는 기존 `refresh_group`을 사용한다. 최초 등록과 membership 변경만 full registration으로 보낸다. 분할 저장·compaction만으로 이 문제가 해결됐다고 수용하지 않는다.

### 3. 잠금 획득·검증 정책 통일

기본은 한 번 시도하고 즉시 busy를 반환한다. dispatch의 `lock_wait_ms`와 lease의 `waitMs`/`--wait-ms`를 0..5000 범위로 명시한 호출만 기다린다. 상위 실행자는 소유 작업의 실제 완료 신호 또는 명시적 대기를 선택하며, 암묵적 5초 재시도와 주기적 명령 재실행을 만들지 않는다. 경합은 기존 error에 `code:maintenance_busy`, `retryable:true`, `lock_path`, `owner`(안전하게 읽지 못하면 null)를 추가한다. 소유 정보는 진단이며 종료·성공 근거가 아니다. Node의 기존 EEXIST 호환성은 유지한다. 정확한 lock 시도에서만 경합을 분류하고 권한·손상·일반 I/O 오류와 구분한다.

기존 maintenance→catalog 및 그룹 lease 순서를 보존하고, 잠금 보유 구간은 필요한 snapshot/commit으로 줄인다. 대기 시간만 무작정 늘리지 않고 취소와 전체 deadline을 유지한다. 현재 미커밋 코드의 최종 lock 재획득 대기와 local/source 검증 분리는 먼저 검증해 재사용한다.

### 4. 알려진 실패만 예약 회수

`abort_before_intent`와 같은 명시적 실패 마무리 경로를 둔다. 정확한 자기 예약 token/source가 유지되고, lock 재획득·보호 재검증·미완료 intent 부재가 확인되며 삭제를 시작하지 않은 실패에만 예약을 해제한다. 이 마무리에서도 source/쓰기 결과가 불확실하면 기존 복구 대상으로 남긴다.

일반 `Drop`에서 모든 예약을 지우거나, exit 1이라는 이유만으로 자동 해제하는 방법은 제외한다. 삭제 시작 후 결과 불명·pending manifest·바뀐 source fence·프로세스 수명 불확실성은 계속 보호한다. 알려진 실패·종료 관측·원래 exit code도 성공으로 바꾸지 않는다.

### 5. 보호·토큰 경계와 개선 실행파일 수용

토큰의 실제 변경 원인을 로그로 구분한 다음, 무관한 catalog/진단 변화에 결합된 부분이 확인될 경우에만 binding 범위를 줄인다. 실제 root·consumer·owner·membership 변화는 계속 거부한다. stale token을 무시하거나 새 토큰으로 자동 삭제하는 변경은 하지 않는다.

현재 소유 작업의 미커밋 변경을 통합한 고정 입력으로 필요한 native 검사와 standalone 수용을 수행하고, 실제 실행파일 identity를 고정해 재측정한다. 설치/selector 변경은 구현 단계에서 명시적으로 범위를 확정한다. 앱 내장 실행기의 별도 반영 여부도 구분한다.

## 제안 검증 기준

기존 `scripts/test-artifact-lifecycle.cjs`, `scripts/test-maintenance-lock-owner.cjs`, native `tests/{contention,registry,groups,lock_recovery}.rs`를 우선 확장한다. 새 테스트 체계를 별도로 만들 필요는 없다.

| 검증 | 수용 조건 |
| --- | --- |
| 단일 참조 추가의 반복 I/O | 동일 lease 내 전체 snapshot의 중복 재조회 제거를 실행 계측으로 확인. 자체 쓰기/consumer 추가/CAS 충돌을 놓치지 않음 |
| 기록 수 증가 | 독립 fixture의 1/100/1000개 기록에서 파일 수·경로 검사·읽기 횟수와 단계 시간을 측정. 시작 전후 설치물/source identity 고정 |
| catalog 경합 | 기본 호출은 즉시 구조화된 busy. 명시적 대기는 deadline 안 해제 시 진행하고 초과 시 busy. 권한/손상 오류는 재시도하지 않음 |
| pre-intent 오류 | 강제 주입한 첫 intent 전 경합/검증 실패에서 payload 불변, 결과 실패 유지, 안전 회수 가능한 자기 예약만 해제 |
| 미확인 결과 보호 | intent 저장 중단·삭제 결과 유실·source fence 변경·프로세스 종료 불확실성은 예약/복구 증거를 보존 |
| Windows batch 및 개별 apply | 고정 source로 실제 파일에 수행. error 33이면 정확한 경로/단계 확인. batch와 개별 결과 모두 항목별 상태·부재를 검증 |
| 토큰 경계 | root 교체·새 consumer·membership 변화는 차단. 자기 예약과 무관한 진단 metadata 변화는 허용해야 하는 계약 범위 안에서 검증 |
| 최종 성능 | 경합 없는 조건과 경합 조건을 분리해 기존 1 MiB 호출과 비교. 단계별 계측을 먼저 본 뒤 반복 횟수를 늘림. 수치 목표는 병목 분해 후 확정하며 초 단위 개선을 미리 보장하지 않음 |

공통 Node/Rust 변경은 Windows 회귀를 필수로 하고, Linux/macOS의 동일 계약도 해당 native 환경에서 검증한다. Windows lock/file identity 수정은 Windows 전용 수용을 별도로 둔다. 현재 조사에서 다른 플랫폼을 실행한 것은 아니다.

## 실행 소유와 산출물 계획

root는 문서·feature inventory·고정 입력/도구 준비·통합 검증·재측정·정리를 맡는다. Node worker는 lifecycle/observation/lease 어댑터와 해당 Node 테스트, native worker는 project-maintenance crate와 해당 테스트를 맡는다. 기존 미커밋 변경은 baseline과 비교해 보존한다. baseline 준비 전에는 worker가 수정하지 않는다. source readiness 후 컴파일 입력을 고정한다.

run `artifacts/tasks/EQ-01-protection-timing/runs/protection-improve-r1/`, owner `protection-improvement`를 생성 전에 기존 artifact-run owner로 pending 등록한다. inputs는 변경 전 baseline·고정 입력, temporary는 검증/컴파일/fixture, logs/reports는 실행 결과를 소유한다. 새 실행기가 Node 테스트의 prerequisite다. 검증 후 필요한 요약/영수증을 보존하고 임시 자료는 owner로 정리한다.

## 진행 상태

Windows x64 소스 검증을 완료했다. native 208개 서로 다른 테스트의 최종 통과 근거를 고정 입력 r3~r6에서 재사용했다. production src는 r3 빌드와 같고 이후 수정은 테스트의 명시적 대기·구조화 오류·Windows 경로 기대값이다. Node lifecycle 205개는 204개 최초 통과와 PATH를 보완한 PowerShell 1개 통과로 확인했다. 실제 lease, nullable owner, 즉시 busy, 명시적 대기와 4개 병렬 등록도 통과했다. 실패 시도의 실제 exit와 timeout은 성공으로 변경하지 않았다.

667개 catalog 단독 조회 중앙값은 2051.55→1170.05ms(약 43% 감소)다. 1 MiB, 100개 기록 fixture의 보호 추가+refresh 3회 중앙값은 2266.12→2201.17ms(약 3% 감소), 1개 기록에서는 283.24→283.53ms로 유의한 개선을 주장하지 않는다. 100개 최초 등록은 32718.25→32459.12ms로 병목이 남았고, 1000개 baseline 최초 등록은 120초 한도를 초과하여 비교가 미완료다. 실제 기본 경합 반환은 42.92/83.51ms, 명시적 대기 후 성공과 4개 병렬 결과 보존을 확인했다. 실측 중 후반에는 독립 회귀 검사를 병행했으므로 수치를 엄격한 무부하 성능 보장으로 해석하지 않는다.

검증 실행파일은 `artifacts/versions/maintenance-owner-eq01-protection-r3-win-x64/payload/maintenance_owner.exe`, SHA-256 `f167e9bdb5c3cd5ea796417ddb7bbd89d9bea1322a369f9de89b5c63bd53cc76`다. 같은 version의 `verification/acceptance.json`에 입력 identity·검사·한계를 보존했다. 기본 selector와 설치 registry를 바꾸는 실행은 승인 검토에서 “구현·검증 승인은 배포 승인이 아니다”라는 사유로 거절되어 실행되지 않았다. 기존 9bc66314 selector와 설치 참조는 그대로다. 앱/내장 엔진은 재빌드하지 않았다.

`tool.project-maintenance`의 기존 feature inventory가 변경한 구현 소유자와 Node/native 검사 경로를 이미 포함하므로 새 feature나 소유자를 추가하지 않았다. 기존 미커밋 변경과 같은 파일에 통합된 소스 변경은 다른 작업을 섞지 않고 커밋할 분리가 아직 확인되지 않아 커밋하지 않았다. 임시 run 904,073,638 logical bytes를 기존 9bc66314 owner의 fresh review/token으로 삭제했고 실제 run 부재와 producer record finalize를 확인했다. 물리 회수량은 측정하지 않았다. 남긴 최소 배포 판단 묶음은 위 version 하나(약 2.36MB)이며, 기본 실행기 전환은 명시적 배포 승인 대기다. 승인하면 전환·설치 참조 검증을 이어서 하고, 전환하지 않기로 결정하면 이 후보의 보존 또는 owner 정리를 결정한다. 검증·정리 영수증은 같은 version의 verification에 보존했다.
## 보호·해제·삭제 비교 계측

현재 설치본 이후 개선 버전을 계측해 달라는 요청에 따라 설치본 `9bc66314`와 검증 후보 `f167e9bd`를 비교한다. 후보의 production source hash가 현재 소스와 일치함을 확인했으므로 native 208개 검증을 재사용하고 재빌드하지 않는다. 설치 selector·앱·소스 구현은 변경하지 않는다.

Windows x64에서 같은 현재 Node 어댑터와 1MiB 파일을 사용한다. 최소 조건은 대상과 참조 소유자 2개 기록이며, 추가로 총 100개 기록의 격리 fixture를 비교한다. 각 조건에서 보호 설정(참조 추가+refresh)·해제(정확한 참조 release+refresh)는 3회씩, 실제 삭제는 fresh review+apply 1회씩 측정한다. 최초 등록은 따로 보고하고 보호 확인 review·종료 근거 파일 작성은 설정/해제 시간에서 제외한다. 보호 중 삭제 차단, 해제 후 차단 없음, 실제 삭제와 파일 부재까지 검증한다. 순서를 조건별로 바꾸고 task-owned 무거운 검사를 병행하지 않는다. 실제 프로젝트 전체 규모나 다른 OS에 수치를 일반화하지 않는다.

산출물은 `artifacts/tasks/EQ-01-protection-timing/runs/protection-delete-measure-r1/`, owner `protection-delete-measurement`에 생성 전에 pending 등록했다. 사용 중 두 binary version에 실행 참조를 둔다. 종료 후 최소 결과·종료 근거만 이 작업 기록에 보존하고, fixture·일회용 스크립트·로그는 기존 owner의 심사·삭제·finalize로 제거한다. 현재 상태: 계측 4개 조건 정상 종료(exit 0), 보호 중 차단·해제 후 실제 삭제·모든 fixture 부재 확인. 최소 결과와 독립 종료 근거는 `10-lifecycle-measurement.json`에 보존했다. 원본 run의 등록·fresh 심사·일반 삭제·finalize를 완료했고 실제 run 및 producer record 부재를 확인했다. 최초 정리 심사에서 source identity 변경 차단이 발생해 지원된 refresh_group으로 동일 소유/구성의 보호 정보를 갱신한 후 재심사했다. 최종 심사는 차단 없음, apply exit 0·status deleted·remaining false였다. 정리 영수증은 `11-measurement-cleanup.json`에 보존했다. 새 임시 자료는 남기지 않았다.
| catalog 기록 | 작업 | 설치본 9bc66314 | 개선 후보 f167e9bd | 표본 |
| --- | --- | ---: | ---: | --- |
| 2개 | 보호 설정(참조+refresh) | 0.302초 | 0.311초 | 3회 중앙값 |
| 2개 | 보호 해제(release+refresh) | 0.335초 | 0.360초 | 3회 중앙값 |
| 2개 | 삭제(review+apply) | 2.046초 | 1.822초 | 1회 |
| 100개 | 보호 설정(참조+refresh) | 2.228초 | 2.058초 | 3회 중앙값 |
| 100개 | 보호 해제(release+refresh) | 1.916초 | 1.841초 | 3회 중앙값 |
| 100개 | 삭제(review+apply) | 17.547초 | 12.771초 | 1회 |

100개 조건의 삭제는 설치본 review 1.742초+apply 15.805초, 후보 review 1.656초+apply 11.115초다. 한 번씩 측정한 차이로 통계적인 개선율이나 다른 규모의 소요 시간을 보장하지 않는다. 최초 등록은 따로 설치본 32.456초, 후보 30.912초이며 위 보호/해제 시간에 포함하지 않았다. 작은 catalog의 보호·해제에서는 후보가 조금 느려 일괄적인 성능 향상을 주장하지 않는다. 두 실행파일 SHA를 실행 전후 확인했고, 설치 selector는 기존 9bc66314 그대로다. 제품 소스·설치·아키텍처 동작은 이번 계측에서 변경하지 않았다.
## apply 세부 계측과 반복 검사 축소

사용자가 apply 내부 세부 계측과 반복 검사 비용 개선 진행을 승인했다. 기준은 검증 후보 f167e9bd이며, 앞선 100개 기록의 review 1.656초·apply 11.115초는 거친 단계 구분이다. root는 고정 입력·빌드·실제 계측·통합·문서·정리를 맡고 기존 native 소유자는 계측과 근거에 따른 native 수정만 맡는다. native 전체와 utils/process 및 workspace 설정을 변경 전 run inputs/baseline-src에 고정했다.

먼저 기존 opt-in maintenance.phase 진단을 확장해 예약 획득/검증, 삭제 전후 안전 관측, intent 저장, 물리 삭제, 결과 저장, 부재 확인, 예약 마무리와 catalog/source 반복 관측 비용을 구분한다. 진단은 반환값·권한 callback·관측 횟수·동기 저장·오류 의미를 바꾸지 않는다. 계측 근거를 얻은 뒤 재사용 가능한 검사만 축소한다. 삭제 범위·권한·참조/consumer 변경 감지, 잠금 해제 후 재검증, intent 직후 재검증, 항목별 durable intent/result, unknown 결과 보호는 유지한다. 외부 review/token 승인 경계를 없애지 않는다.

Windows x64에서 필수 native 경계를 검사하고 고정 실행파일로 같은 1MiB·100개 기록 조건을 다시 비교한다. 공통 Rust 의미는 유지하며 Linux/macOS 실행은 검증 범위 밖이다. 기본 selector·배포·앱 빌드는 이번 승인에 포함하지 않는다. 산출물은 생성 전에 등록한 run `artifacts/tasks/EQ-01-protection-timing/runs/delete-apply-profile-r1/`, owner `delete-apply-improvement`에 귀속한다. 최종 입력/최소 수용 근거는 검증 후보에 보존하고 나머지는 기존 owner로 정리한다. 상태: 고정 입력의 native 212개·release 빌드, 정확한 후보를 사용한 Node lifecycle 205개·lease 검사 모두 exit 0. 입력 hash 유지와 6회 비교의 실제 삭제·부재를 확인했다. 최소 근거를 후보 verification과 12-apply-acceptance.json에 보존했다. 임시 run 796,955,073 logical bytes를 설치된 f167e9bd owner의 fresh review/token으로 삭제했고 exit 0, status deleted, remaining false, 실제 run·producer record 부재와 finalize를 확인했다. 물리 회수량은 측정하지 않았다. 정리 영수증은 13-apply-run-cleanup.json에 보존했다. 다른 작업의 잠금 동안 두 번 즉시 busy로 종료했고 기존 작업 종료 후 재심사했다. registry identity 변경 차단은 지원된 refresh_group으로 갱신한 뒤 해소했다. 점유 잠금과 실패한 검사를 우회하지 않았다.

진단용 후보 e88c9aae의 100개 기록 apply는 9.771초였다. registry.catalog 12회의 총 구간은 8.699초, 실제 삭제는 0.635초, intent/result 저장은 각각 0.043/0.051초였다. registry.observe·reservation.verify_sources 등은 catalog와 중첩되므로 합산하지 않는다. 동작을 바꾸지 않은 진단용 후보와 이전 후보의 단일 실행 시간 차이는 성능 개선으로 해석하지 않는다.

선택한 수정은 catalog 횟수나 안전 재검증을 제거하지 않고 Windows 상위 경로 검사에서 필요한 속성만 매번 조회하는 것이다. GetFileAttributesW의 link 자체 속성 동작은 Microsoft 공식 문서를 확인했다(https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getfileattributesw). 일반 로컬 짧은 경로 외에는 기존 경로로 돌아가며 모든 권한 callback·leaf metadata·fresh bytes·intent/result 저장을 유지한다. 기존 timing 테스트 모듈에 결과 보존 1개, paths 모듈에 Windows 경계 3개 검사를 추가했다. fixture 등록 준비만 native 검증과 병행했고 최종 삭제 비교는 병행 부하 없이 수행한다.

같은 100개 기록·1MiB 조건에서 진단을 끄고 순서를 교차한 각 3회 비교의 review+apply 중앙값은 f167e9bd 14.7195초 → 6a39e9c6 12.3008초(약 16.4% 감소), apply는 12.9455초 → 10.5788초(약 18.3% 감소)였다. 전체 범위는 각각 12.8594–19.1574초와 11.7556–12.6426초다. 기준본 변동이 크므로 이번 표본의 결과이며 다른 규모·OS·부하에 일반화하지 않는다. 안전 검증 단계·횟수와 durable intent/result는 유지했다.

새 검증 후보는 artifacts/versions/maintenance-owner-6a39e9c6-win-x64-eq01-delete-apply/payload/maintenance_owner.exe, SHA-256 6a39e9c6c6002f3eee110a1822403108b803869e586498ae15ce8dda02b39b92다. 이번 작업에서는 설치를 변경하지 않았다. 정리 직전 실제 selector와 revision 14 설치 참조를 재확인하니 별도 승인된 f167e9bd 전환이 반영되어 있었다. 따라서 앞선 9bc66314 현 상태 설명은 과거 기록이며 f167e9bd는 현재 설치물로 보존한다. 새로운 6a39e9c6 후보의 배포는 이번 범위 밖이다.

이번 변경의 새 검증 후보와 최소 근거는 8개 파일, 2,386,159 logical bytes다. 검증된 결과물로 유지하며 기본 설치물은 f167e9bd다. 새 후보를 기본 경로에 반영하려면 별도 설치 승인이 필요하다. Linux/macOS 실행·앱 내장 실행기 반영은 검증하지 않았다. native/Node 검사는 실제 exit 0이며 변경 파일의 diff --check도 통과했다. 기존 작업과 같은 파일에 섞인 미커밋 변경 때문에 타 작업을 포함하지 않는 task-level commit은 만들지 않았다.

## 삭제 직전 중복 확인 제거

사용자가 일반 외부 프로그램의 변경을 고려 대상에서 제외하고, 삭제 직전 예약·참조·경로·권한 재확인을 모두 제거하도록 명시적으로 승인했다. 최초 review/token 심사, apply의 예약 획득·정규화 사전 검사·pre-intent safe_entries와 최초 권한 확인은 유지한다. durable intent 저장 뒤 safe_entries와 reservation.verify를 반복하지 않고 기존 승인된 entries로 삭제한다. 취소, 실제 삭제의 OS 오류·승인 트리·link 처리, 실제 부재/결과 저장과 예약 해제는 유지한다. intent 저장 중 callback이나 외부 변경이 생겨도 그 변경을 별도로 재심사하는 기존 계약은 폐기한다. 등록·심사·참조 보호 전체를 제거하거나 잠금·토큰을 무시하는 변경은 아니다.

공통 Rust 경로 변경이며 Windows x64에서 검증한다. source owner는 apply.rs와 기존 관련 native 테스트를 수정하고 root는 문서·고정 입력·검증·계측·정리를 맡는다. baseline은 검증 후보 6a39e9c6, 설치 f167e9bd와 앱 내장 엔진은 변경하지 않는다. run:EQ-01-protection-timing:delete-precheck-removal-r1에 모든 생성물을 생성 전에 등록했다. 필수 native 전체 검사·정확한 후보의 Node 통합을 수행하고, 동일한 100개 기록·1MiB fixture에서 review+apply를 각 3회 교차 비교한다. 기존 post-intent 재확인 계약만 테스트 기대를 갱신하고 최초 보호·stale token·권한 거부·intent 실패 검사는 보존한다. 상태: apply.rs 및 기존 groups/registry 테스트 수정 완료. 고정 입력에서 native 212개 전체 검사와 검증용 release 빌드 exit 0, 입력 hash 유지 확인. intent 이후 승인 callback 반복을 기대하던 테스트는 반복 없음·durable 삭제로 전환했고, producer fence 변경 검사는 intent 전으로 이동해 payload/예약 보존을 계속 검증한다. 정확한 후보 ef98c385의 Node lifecycle 205개·실제 lease 검사 exit 0, JS 입력 유지 확인. 6개 fixture 준비와 교차 비교 모두 exit 0으로 완료했고 실제 target 삭제·부재를 확인했다. Node 최초 실행은 일회용 출력 요약 스크립트의 정규식 파싱 오류로 제품 검사 전에 exit 1이었으며, 스크립트 수정·node --check 후 새 실행으로 재시도했다.

이번 비교는 catalog 100개 기록, 삭제 대상 1MiB, 다른 99개 기록의 payload는 부재한 동일 격리 조건이며 진단 출력은 껐다. baseline 6a39e9c6와 새 후보 ef98c385를 B1/O1/O2/B2/B3/O3 순서로 각각 3회 측정했다. review+apply 중앙값은 11.4631초 → 9.6650초(약 15.7% 감소), apply 중앙값은 9.9093초 → 8.0867초(약 18.4% 감소)다. review는 1.5540초 → 1.5741초이며 이 구간의 개선을 주장하지 않는다. 전체 범위는 baseline 11.4590–12.0721초, 후보 9.6608–9.9006초다. 최종 계측 중 이 작업의 빌드·검사를 병행하지 않았다. 앞선 다른 시점 표본과 직접 비교하거나 다른 규모·OS의 성능으로 일반화하지 않는다.

새 검증 후보는 artifacts/versions/maintenance-owner-ef98c385-win-x64-eq01-precheck-removal/payload/maintenance_owner.exe, SHA-256 ef98c385803703783a2fda63b182837ed2d47a6a571c48a3137fc71cc922ad84다. verification에 입력·native/build·Node·비교 결과와 대체하는 baseline의 최소 근거를 보존했고, 14-precheck-acceptance.json이 독립 종료·수용 근거다. 설치 selector는 f167e9bd이며 전환하지 않았다. 구현은 승인된 반복 검사를 제거했으므로 intent 이후의 callback 변경을 다시 차단하는 종전 보장을 주장하지 않는다. 나머지 최초 보호·권한·예약·실제 삭제 오류·취소·결과 저장 경계는 보존했다. 상태: 완료 run 최초 등록은 exit 0. 미설치 baseline 후보의 최초 등록은 catalog 재획득 경합으로 exit 1이었으며 pre-intent 예약이 남았다. 실제 동기 child 종료와 managed controller exit 1, 등록 경로의 자식 프로세스 부재, 정확한 예약 owner/hash를 독립 증거 16-registration-stop-proof.json에 고정하고 지원된 recover_reservation으로 복구했다(exit 0, reservation_recovered, execution_outcome_changed=false). 실패 결과를 성공으로 바꾸지 않았다. 완료 run은 재등록하지 않았다. 후보 등록 2차도 다른 작업의 maintenance 잠금 때문에 명시적 5초 대기 후 exit 1과 보존 예약으로 종료했다. 2차 실패도 독립 stop proof에 보존하고, 경합 중인 ET-01 정리 controller 전체의 실제 종료를 기다린 뒤 지원된 예약 복구·등록·fresh 심사·삭제를 이어간다. 점유 잠금을 지우거나 실패한 보호 검사를 우회하지 않는다. 상태: 정리 완료. ET-01 controller 종료 후 2차 보존 예약 복구와 후보 3차 등록을 완료했다. 실제 정리 apply exit 0, 두 항목 status deleted·remaining false였으며 run과 이전 미설치 후보의 실제 경로 부재 및 producer record finalize를 확인했다. 삭제한 합계는 715,871,740 logical bytes이며 물리 회수량은 측정하지 않았다. 17-precheck-cleanup.json에 결과를 보존했다. 10분 확인 시점에는 소유 삭제 apply가 실제 실행 중임을 확인했고 중복 실행 없이 terminal 결과를 기다렸다.

최종 산출물은 새 후보 ef98c385와 최소 독립 검증 근거 10개 파일, 2,356,384 logical bytes다. 임시 run·source/target 복사·일회용 스크립트·fixture와 대체된 미설치 6a39 후보는 남기지 않았다. 설치 f167e9bd 및 관련 참조는 유지했다. 변경한 공통 코어의 Windows x64 검증은 완료했고 Linux/macOS 및 앱 내장 엔진 반영은 미검증이다. 기존 타 작업과 섞인 미커밋 변경을 보존해 task-level commit은 만들지 않았다.

## 같은 catalog 잠금 구간의 snapshot 재사용

사용자가 제안 1번(같은 잠금을 유지하는 동안 한 번 조회)을 승인했다. 기존 CatalogCache의 bytes/JSON 파싱 캐시와 CatalogLock/lease 해제·자체 쓰기 무효화 경로를 확장한다. source별 연속 OS catalog custody 안에서 성공한 파일 목록·기록 snapshot만 재사용하고, 잠금이 없거나 해제·재획득했거나 자체 기록을 변경한 경우 다시 읽는다. owner별 payload·recovery proof 확인은 별도이며 유지한다. 잠금을 무시하는 외부 변경을 snapshot 중간에 감지하는 보장은 이번 승인 전제에서 제외한다. revision 기반 변경분 갱신(2번)·참조 인덱스(3번)·저장 형식 변경·설치 전환은 범위 밖이다.

공통 Rust 코어 동작으로 구현하고 실제 수용은 Windows x64다. source owner는 registry와 최소 Context 설명·잠금 무효화 경계 및 기존 native 테스트를 맡고 root는 고정 입력·검증·전후 계측·문서·정리를 맡는다. baseline은 ef98c385다. 생성 전 run:EQ-01-protection-timing:locked-catalog-snapshot-r1에 입력·cache·fixture·로그·출력을 귀속하고 실행 참조를 등록했다. 필수 crate 전체 검사, 정확한 후보의 Node lifecycle/lease 검사, 동일 100개 기록·1MiB 3회 교차 비교와 opt-in snapshot load 계측을 수행한다. 상태: registry.rs의 source/root별 snapshot 및 custody epoch, lib.rs 설명, reservations.rs의 수동 복구 경계 무효화, 기존 registry/예약 테스트 수정 완료. 자체 쓰기·삭제는 기존 lease의 CatalogCache reset을 재사용했다. held epoch에서 1회 I/O, 서로 다른 source/owner, fresh owner payload/proof 검사, 읽기 실패 재시도, 실제 lease write/remove 무효화와 잠금 재획득 후 새 consumer 감지를 검사한다. 잠금 보유 중 직접 파일을 바꾸던 예약 unit test는 실제 release/reacquire를 사이에 두어 변경 감지를 보존했다. frozen lockfile SHA는 이전 후보와 동일한 7746d56b24dd5f63a6949e76c93ebc071253a22eba9c6c0628cbc96115ed724b다. 8개 비교·진단 fixture 준비 exit 0. 최초 frozen native typeCheck는 check_owner 반환형 E0308과 새 unit test의 owner borrow/move E0505로 exit 101이었고 테스트 선택·실행과 빌드는 진행하지 않았다. 두 오류를 수정한 별도 prepared-r2 입력의 typeCheck·216개 선택/실행과 검증용 release 빌드 모두 exit 0, frozen input hash 유지 확인. 최초 입력·exit 101 실패 로그를 보존했다. 새 실행파일 SHA-256은 eef3ec5aca86bd534469e04a5469d749edcb9bd21a015f1c34e9d092dd319b94다. 정확한 후보의 Node lifecycle 205개 및 실제 lease 검사 exit 0·JS 입력 hash 유지 확인. version lifecycle 등록은 다른 작업의 catalog 잠금 busy로 생성 전에 중단됐으나, 잠금이 비어 있는 것을 확인한 다음 정상 등록했다. 6회 성능 비교와 별도 2회 진단 모두 exit 0, 모든 target 삭제·실제 부재 확인. opt-in registry.catalog_snapshot_load/hit 구간으로 실제 I/O와 재사용 횟수를 구분한다.

같은 격리 100개 기록·1MiB 조건(나머지 payload 부재)에서 진단을 끄고 B1/O1/O2/B2/B3/O3 순서 각 3회 비교했다. review+apply 중앙값은 ef98c385 10.9024초 → eef3ec5a 7.0728초(약 35.1% 감소), apply는 8.9814초 → 5.3400초(약 40.5% 감소)다. review는 1.7840초 → 1.7329초다. 전체 범위는 baseline 9.9002–11.1276초, 후보 6.3772–8.4765초이며 동일 조건에서도 변동이 있다. 이 작업의 다른 무거운 실행은 최종 계측 중 중단했지만 다른 작업의 호스트 부하는 통제하지 않았다. 다른 규모·OS의 보장이나 앞선 시점 표본과의 직접 비교로 해석하지 않는다.

별도 1회씩 진단한 apply의 catalog 호출은 두 버전 모두 9회다. baseline은 매번 실제 조회했고 새 후보는 snapshot_load 5회(누적 3.856초), snapshot_hit 4회(누적 0.006초)였다. registry.catalog 총 구간은 6.867초 → 3.862초, 예약 획득은 1.595초 → 0.049초였다. 중첩 구간은 합산하지 않는다. 새 후보의 물리 삭제는 0.780초, pre-intent 검증은 1.617초, 항목 시작 예약 확인은 0.791초, 예약 해제는 0.748초다. 잠금 밖 관측은 재사용하지 않아 남은 5회 조회를 유지한다. 프로파일은 별도 실행으로 성능 중앙값 표본에 넣지 않았다.

새 후보 artifacts/versions/maintenance-owner-eef3ec5a-win-x64-eq01-catalog-snapshot/payload/maintenance_owner.exe와 독립 verification에 최종 입력·검사·비교·진단·baseline 최소 근거를 보존했다. 18-locked-catalog-acceptance.json이 종료·수용 근거다. 설치 selector f167e9bd와 앱은 변경하지 않았다. 완료 run과 소비 참조 없는 미설치 ef98 후보의 등록·최초 심사는 정상 종료했다. 첫 apply는 native exit 0이지만 두 항목 모두 config changed during review로 blocked·remaining true였으므로 삭제 성공으로 계산하지 않았다. 실제 설정 파일의 갱신 시각과 예약 부재를 확인했고, 기존 등록은 유지한 채 최신 설정으로 fresh review와 apply를 재시도했다. 재시도는 exit 0, 두 항목 status deleted·remaining false였으며 실제 경로 부재와 producer record finalize를 확인했다. 재시도 전후 설정 hash는 같았다. 삭제한 합계는 731,107,258 logical bytes이며 물리 회수량은 측정하지 않았다. 최종 결과는 21-snapshot-cleanup.json에 보존했다. 원래 blocked 결과를 21-snapshot-cleanup-apply-result.json에 보존한다.

최종 상태: 구현·Windows x64 자동 검증·3회 전후 계측·별도 I/O 진단·문서 반영·owner 정리 완료. 새 eef3 후보와 최소 독립 근거 11개 파일, 2,360,563 logical bytes만 검증 산출물로 유지한다. 임시 입력·target·fixture·스크립트·원본 로그와 대체된 ef98 후보는 남기지 않았다. 설치 f167e9bd 및 앱 내장 실행기는 전환하지 않았다. Linux/macOS 실행은 미검증이다. 기존 타 작업과 섞인 미커밋 변경을 보존했고 task-level commit은 만들지 않았다.

## 최신 standalone 후보 준비

2026-11-02 사용자는 기존 실행기와 진행 작업을 유지한 채 현재 소스의 새 standalone 실행파일만 준비하도록 승인했다. selector·설치 영수증·installation 참조 전환은 범위 밖이다. 현재 engine/codex-rs/project-maintenance와 utils/process, workspace package/dependencies/lints/release profile을 격리 workspace에 고정한다. 공통 코어를 포함하되 실제 대상과 수용은 Windows x64이며 앱 전체 빌드·재설치와 Linux/macOS 빌드는 수행하지 않는다.

run:EQ-01-protection-timing:latest-owner-20261102-r1, owner standalone-candidate-preparation에 생성 전 입력·로그·target·fixture·출력을 등록했다. 조회 시 maintenance_owner/Cargo producer는 없었고 별도 target을 사용한다. 현재 selector f167e9bd 및 설치 영수증 raw SHA를 실행 전 고정했다. 필수 typeCheck·nonzero 선택·native 전체 실행, release standalone 빌드와 정확한 후보의 Node lifecycle/lease 및 격리 CLI register/review/apply를 검증한다. 최종 version에 최소 독립 근거와 후보를 보존하고 일회용 run은 기존 설치 owner로 정리한다. 설치본과 후보의 동시 사용·실제 기본 경로 전환은 이후 별도 승인과 작업 종료 확인이 필요하다. 상태: 고정 입력의 native 227개 actual0 및 release standalone 빌드 actual0, frozen hash 유지 확인. 현재 cargo-verification의 selected-tests-v2는 단일 cargo test의 실제 passed227/failed0과 실행 종료0을 수용하며 옛 preflight 3호출을 별도로 실행하지 않는다. source/build 및 toolchain 근거를 새 version에 보존했다. 정확한 후보의 Node lifecycle205·실제 lease 및 격리 CLI register/review/apply 모두 actual0, 실제1MiB target 삭제·부재 확인. Node 입력 불변과 현재 소스/frozen identity 일치, 기존 selector·설치 영수증 raw SHA 동일을 확인했다. 22-latest-owner-preparation.json과 새 version verification에 독립 수용·종료 근거를 보존했고 run을 complete로 닫았다. 일회용 run 최초 등록은 다른 작업의 catalog 잠금과 재획득 경합하여 actual1 및 pre-intent 보존 예약으로 종료했다. 동기 child 실제 종료·stream drain·managed controller exit1, 등록 경로의 자식 producer 부재와 정확한 reservation owner/hash를 23-registration-stop-proof.json에 고정했다. 현재 다른 maintenance owner가 없음을 확인한 뒤 지원된 recover_reservation은 actual0/execution_outcome_changed=false, 재등록718,938,275 logical bytes와 심사도 actual0이었다. 이어진 apply는 Windows OS error33과 catalog 경합으로 pre-intent actual1이었고 보존 예약을 남겼다. publication 전 오류와 동기 child/managed controller 실제 종료를 독립 증거23-apply-stop-proof.json에 고정하고 지원 복구 actual0 뒤 fresh 심사·삭제를 재시도해 완료했다. 최종 apply actual0/status deleted/remaining false, 718,938,275 logical bytes의 run 실제 부재와 producer record finalize를 확인했다. physical 회수량은 측정하지 않았다. 최종 정리 영수증은23-latest-owner-cleanup.json이다. 두 실패를 성공으로 바꾸거나 잠금을 강제로 제거하지 않았다. 실행파일 SHA-256은 3b1f9bf488eac6732a1e9faa908da27b5d9d79d3971f4464ec9b945433ad2627, payload 2,503,680 bytes다. product source는 변경하지 않았다.

최종 상태: 현재 소스 기준 후보 준비·Windows x64 native227·Node205/lease·격리 CLI 수용·임시 run owner 정리 완료. 산출물은 artifacts/versions/maintenance-owner-3b1f9bf4-win-x64-eq01-20261102/의 payload 실행파일과 verification 12개 파일 합계2,541,837 logical bytes다. 실행파일 단독은2,503,680bytes, SHA-256 3b1f9bf488eac6732a1e9faa908da27b5d9d79d3971f4464ec9b945433ad2627다. 실행 전후와 정리 후 기존 selector·설치 영수증 raw SHA 동일 및 후보 SHA 일치 확인. 기존 설치 f167e9bd와 installation 참조는 전환하지 않았다. 기본 경로 전환의 동시성 확인·cache 회귀·실제 기본 경로 수용은 다음 승인 범위다. 제품 소스 변경·앱 빌드·설치·성능 재측정은 없었다. 이번 문서는 기존 작업의 미커밋 기록과 함께 있어 타 작업을 섞는 task commit은 만들지 않았다.

## 기본 standalone 3b1f9bf4 전환

사용자가 검증 완료 후보를 기본 실행기로 변경하도록 명시적으로 승인했다. 기본 selector와 설치 영수증, installation 참조를3b1f9bf4 후보로 전환한다. Windows x64 별도 실행기/Node/PowerShell 범위이며 앱 재빌드·설치는 포함하지 않는다. 사전 조회에서 maintenance_owner 프로세스는 없었고 구형 version의 소비자는 기존 installation과 이번 실행 run뿐이었다. 전환 run:EQ-01-protection-timing:default-owner-20261102-r1, owner standalone-default-transition을 생성 전에 등록하고 구/신 version 실행 참조를 둔다.

후보227native·205Node·CLI 검증은 정확한 SHA로 재사용하고 설치 변경 위험의 추가 수용은 cache 전체 회귀(후보 override), 짧은 maintenance→catalog 배타 구간에서 신규 installation 참조 추가 및 selector/receipt CAS·원자적 파일 교체, 실제 기본 경로 RecoveryOnly·lease 및 CLI 검사로 수행한다. 기본 경로 검증 후만 구형 installation 참조를 정확히 해제한다. 잠금 중에는 다른 실행기 진입이 차단되며 전환 직전/직후 프로세스와 참조를 다시 확인한다. 기존 바이너리를 덮어쓰지 않는다. 완료 후 raw run과 사용 종료한 구형 version은 최신 기본 owner 심사·삭제·finalize로 정리한다. 상태: 전환 전 identity·설치 revision14·기존 설정 raw bytes 고정, cache 회귀 준비.

전환 중간 결과: 첫 cache 전체 검사 actual1은 hardlink target 경로가 marker-recovery를 포함해260자였던 fixture 환경 실패다. product/test 코드는 바꾸지 않고 짧은 소유 run:eq26:d를 사전 등록한 뒤 동일 전체 검사를 재실행하여190.758초 actual0을 확인했다. 원래 실패와 짧은 경로 재실행 근거를 보존했다. maintenance→catalog 잠금 내 다른 owner 부재와 selector/receipt CAS를 확인하고3b1f9bf4 기본 전환 actual0, 설치 revision15에서 구/신 installation 참조를 함께 보존했다. 현재 실제 기본값의 recovery/lease/격리 삭제 검증 중이다.

전환 완료: 실제 기본값(override 없음)의 RecoveryOnly19.201초 actual0, lease actual0, 격리1MiB register/review/apply 모두 actual0 및 status deleted/remaining false/실제 target 부재를 확인했다. 24-default-owner-deployment.json과 새 version의 verification/default-installation-verification.json에 첫 cache 실패·재실행 및 구형 최소 수용 근거를 독립 보존했다. 정확한 구형 installation reference만 지원 API로 해제하여 설치 revision16에는 새 version installation 참조1개만 남았다. main/short run 모두 독립 종료 근거로 complete를 기록하고 execution 참조를 해제했다.

새 기본 owner로 구형 version:maintenance-owner:eq01:protection-r3와 두 검사 run을 등록·fresh 심사·명시적 삭제했다. owner controller actual0, 모든 대상 status deleted/remaining false, 실제 root 부재와3개 producer record finalize/부재를 확인했다. 정리 근거는25-default-owner-cleanup.json이다. 최종 selector/설치 영수증 raw SHA 동일, 실행파일 SHA3b1f9bf488eac6732a1e9faa908da27b5d9d79d3971f4464ec9b945433ad2627 동일, 전환 pending 파일 부재를 확인했다. 운영 문서의 기본 경로와 수용 범위를 갱신했다. 앱 재빌드/설치는 하지 않았다. 현 변경과 이전 작업의 미커밋 기록이 같은 문서에 있어 타 작업을 섞는 task commit은 만들지 않았다. 기본 전환·실제 경로 수용·임시 산출물 정리 완료이며 이번 전환의 잔여 cleanup은 없다.
