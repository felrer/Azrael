상태: 조사 완료·해결 방안 제안. 제품 구현은 하지 않았으며, 다음 단계는 제안 검토 후 구현 범위 확정이다.

# 보호 성능·잠금·복구 후속 조사

사용자 요청은 앞선 실측에서 발견한 문제의 원인 파악과 해결 방안 제시다. 기존 실측 기록은 `01-plan.md`에 보존한다. 제품 코드 수정·빌드·설치·추가 삭제 실험은 승인 범위에 포함하지 않는다. 조사 기록만 작성한다.

대상은 ① 참조 추가·refresh·최초 등록 지연 ② catalog 잠금 경합 ③ 정상 실패 후 남는 예약 ④ Windows 파일 잠금 오류와 stale review token이다. 재현된 안전 차단과 결함을 구별하며 보호·소유·참조·권한·미확인 결과 보존을 약화시키지 않는 방안을 제안한다.

Windows x64 설치물의 기존 관측을 기준으로 공통 Node/Rust 구조와 Windows 전용 처리를 구분한다. 다른 플랫폼 실기와 설치 바이너리로 확인되지 않은 현재 소스의 동작은 별도로 표시한다.

root는 Node 호출 경로, 설치물 출처, 기존 관측의 한계, 전체 해결 순서를 담당한다. 읽기 전용 보조 조사는 native 저장/등록 비용과 잠금/토큰 경로를 맡는다. 모든 조사 결과를 이 문서에 합친다. 제품 코드·지침은 수정하지 않는다.

완료 기준은 관측별 확정 원인과 미확정 가설, 파일·심볼 근거, 최소 수정안과 영향, 단계별 검증 기준, 권장 구현 순서 작성이다. 읽기 전용 계측과 코드 추적으로 이를 확인했으며, 테스트·빌드·제품 변경·추가 삭제 실험은 실행하지 않았다.

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

기존 typed busy와 bounded `wait_for_lock`을 중간 catalog 검사에도 적용한다. lock 시도에서만 경합을 재시도 가능한 유형으로 분류하고, 권한 오류·깨진 상태·일반 payload I/O 오류와 구분한다. Windows error 33을 발생 위치와 무관하게 모두 재시도하도록 만들지 않는다.

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
| 짧은 catalog 경합 | register/refresh/apply의 각 재획득·재검증 지점에서 holder가 deadline 안에 해제하면 정상 진행. deadline 초과 시 정확한 busy와 소유 상태를 보고 |
| pre-intent 오류 | 강제 주입한 첫 intent 전 경합/검증 실패에서 payload 불변, 결과 실패 유지, 안전 회수 가능한 자기 예약만 해제 |
| 미확인 결과 보호 | intent 저장 중단·삭제 결과 유실·source fence 변경·프로세스 종료 불확실성은 예약/복구 증거를 보존 |
| Windows batch 및 개별 apply | 고정 source로 실제 파일에 수행. error 33이면 정확한 경로/단계 확인. batch와 개별 결과 모두 항목별 상태·부재를 검증 |
| 토큰 경계 | root 교체·새 consumer·membership 변화는 차단. 자기 예약과 무관한 진단 metadata 변화는 허용해야 하는 계약 범위 안에서 검증 |
| 최종 성능 | 경합 없는 조건과 경합 조건을 분리해 기존 1 MiB 호출과 비교. 단계별 계측을 먼저 본 뒤 반복 횟수를 늘림. 수치 목표는 병목 분해 후 확정하며 초 단위 개선을 미리 보장하지 않음 |

공통 Node/Rust 변경은 Windows 회귀를 필수로 하고, Linux/macOS의 동일 계약도 해당 native 환경에서 검증한다. Windows lock/file identity 수정은 Windows 전용 수용을 별도로 둔다. 현재 조사에서 다른 플랫폼을 실행한 것은 아니다.

## 완료 상태

root의 Node I/O 계측 및 출처 확인, native 저장 비용과 잠금/토큰 경로의 읽기 전용 조사를 통합했다. 새 raw 로그·프로필·임시 실행 산출물을 만들지 않았으며 문서 할당용 임시 본문은 제거했다. 남은 것은 이 제안 기록과 기존 실측/복구 근거다. 구현·제품 빌드·설치는 수행하지 않았다.
