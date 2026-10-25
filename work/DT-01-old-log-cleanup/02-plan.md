상태: 분석 완료 — Windows 로컬 metadata·소스 대조를 완료했다. 잠금 해제·대상 삭제·정책 변경은 수행하지 않았다.

# 잠금·보호 합리성 분석

## 범위와 권한

사용자의 후속 요청은 잠금 합리성 분석이다. 원래 로그 정리 목표를 유지하되 이번에는 읽기 조사와 보고서 작성만 수행한다. 제품 코드·정책·기존 registry 변경과 잠금 해제·삭제는 없다. development-workflow로 같은 세션의 후속 분석을 기록한다. root는 실제 metadata·프로세스를, 두 읽기 담당자는 잠금 구현과 보호·참조 정책을 조사했다.

Windows x64 로컬 checkout에서 숨김·ignored 항목을 포함해 조사했다. 링크를 따라가지 않았고 node_modules, .git/objects, .git/logs 내부와 프로젝트 밖 사용자 상태는 제외했다. 타 OS 실제 검증과 전체 OS handle/byte-range lock/ACL 검사는 수행하지 않았다. 스캔은 원자적 snapshot이 아니며 다른 작업이 상태를 변경할 수 있다.

## 결론과 이전 설명 정정

레거시 잔존 가능성이 높은 lease와 오래된 보호 metadata가 있다. 그러나 .lock 파일의 존재를 현재 활성 잠금으로 세거나 일괄 제거하면 잘못된 결론과 동시 접근 위험이 생긴다.

앞선 응답에서 PID 73132의 생존만으로 잠금의 유효성을 강하게 설명한 부분은 근거가 부족했다. 조사 초기에 maintenance.lock이 없었지만 PID 73132는 살아 있었다. 최종 확인에서는 같은 PID의 새 잠금이 생성됐다. 이전 파일 생성은 13:14:21 UTC, 새 파일 생성은 13:29:25.6118716 UTC이고 수정은 13:29:48.9449801 UTC다. 이전 파일이 그대로 남아 있다는 가설은 맞지 않는다. 현재 새 작업의 구체적 유효성은 별도이며 전체 handle은 검사하지 않았다.

## 메타데이터 결과

- lock/owner 후보 11,353개 중 의존성 고정 파일 2,095개를 실행 잠금에서 제외했다. 남은 후보 수도 활성 잠금 수는 아니다.
- Rust incremental/ 아래 후보 5,119개, .coordination.lock 2,082개가 있다. 파일 존재만으로 실제 handle 상태를 판정할 수 없다.
- lease 디렉터리 owner 844개 중 832개는 fixture 경계다. cargo-owner-tests에 716개, CJ/CL/DM/CR fixture 경계에 116개다. 실제 최상위 공유 cache lease는 12개다. unknown/running 시험 표본을 실제 작업 상태로 집계하면 안 된다.
- native 조회 시점: 371그룹·730항목 중 잔존 255항목. protection_known:false 44개, 참조가 있는 항목 84개, 잔존 구성원이 있는 incomplete 그룹 20개다. 233항목의 deferred는 OS 잠금이 아닌 보류 결정이다. 이 수치들은 서로 중복된다.

## 종류별 합리성

| 종류 | 실제 동작 | 판단 |
| --- | --- | --- |
| maintenance.lock, catalog.lock, .run-claim.lock | 파일의 배타적 생성 sentinel, 정상 종료에서 삭제 | 실행 중 필요. 비정상 종료 잔존·복구 공백 존재. 최초 스캔에는 셋 모두 없었고 최종 확인에는 새 maintenance.lock이 생김 |
| module cache .lock | OpenOrCreate + FileShare.None handle | 파일 잔존은 정상. 공유 cache 전체 빌드·정리 직렬화 범위는 넓음 |
| .coordination.lock, thread writer locks | OS File::lock/try_lock | 충돌 방지 목적 타당. 파일이 남아도 실제 잠금은 해제될 수 있음 |
| auth/OAuth/plugin/manual resume | OS shared/exclusive lock과 guard | 계정·credential·공유 marker 충돌 방지 목적 타당. fixture의 빈 파일은 활성 잠금 증거가 아님 |
| Cargo target owner, cache .leases | token·명령·identity·미확정 결과를 보존하는 durable lease | unknown producer 보호는 타당. 독립 종료 증거와 정식 retirement가 없으면 남도록 설계됨 |
| protected_paths·refs·incomplete/unknown | 삭제 방지 정책과 수명 metadata | 런타임 잠금이 아님. close/release/refresh 누락으로 보류가 지속될 수 있음 |

근거: [native Store](../../engine/codex-rs/project-maintenance/src/storage.rs:40), [lifecycle](../../scripts/artifact-lifecycle.cjs:60), [module cache](../../scripts/build-module-cache.ps1:187), [rollout locks](../../engine/codex-rs/rollout/src/writer_lock.rs:108), [Cargo target owner](../../scripts/cargo-target-owner.cjs:56), [cache recovery](../../scripts/verification-result-cache.cjs:228).

## 우선 확인 대상

### 1. 현행 v2 lease 1개: 현재 영향 우선순위 높음

artifacts/cache/verification-results/cargo-v2/.leases/516cf5eb75c9533d37da85e55947998cc235919704f503eadc7ed664bb614747/owner.json은 2026-10-22 engine.shared-engine.manual-resume 검사다. PID/coordinator 40656과 부모 32084는 현재 snapshot에 없다.

기록된 run artifacts/build/b13/artifacts/logs/deploy-w11aa/engine-preservation/preservation-H0R8RM은 존재한다. receipt.json은 status:running, 시작 2026-10-22T05:27:04.639Z에서 완료되지 않았다. 앞선 7개 검사는 exit 0이나 대상 검사의 최종 결과는 receipt에 없고 해당 stdout도 비어 있다. 중단된 lease 잔존 가능성이 높으며 같은 검사 획득·오래된 cache 정리를 막을 수 있다. PID 부재만으로 자식 전체 종료를 확정하거나 성공으로 고치지 않는다.

### 2. 구형 cargo lease 11개: 레거시 적체

artifacts/cache/verification-results/cargo/.leases/의 owner 11개는 2026-10-17 생성됐고 모두 PID 52716과 token만 기록한다. 현재 해당 PID는 없다. 현행 코드는 cargo-v2를 사용하고 구형 root를 보호 상태로 남긴다([namespace](../../scripts/cargo-verification-cache.cjs:13)). 활성 보호로 볼 근거는 약하지만 새 namespace를 직접 막는다고 단정할 수 없다. 정식 폐기는 원래 소비·producer tree 종료 근거와 exact token/hash가 필요하다.

### 3. 중복 metadata 동기화 누락

run:module-cache-management-r1은 이전 턴 producer revision 3에서 generated/protection을 확인했지만 native는 아직 protection_known:false다. 앞선 refresh가 잠금으로 거절됐다. 실제 파일 잠금이 아니라 관리 계층의 정합성 문제이며 supported refresh와 fresh review 대상이다.

### 4. 넓은 보호와 묶음 경계

work 전체 보호는 계획·근거를 보전하지만 안의 오래된 raw log도 보호한다. CN/CO evidence의 logs와 reports/스크린샷을 한 그룹으로 묶으면 로그만 폐기하는 요청도 전체 보존에 묶인다. 새 작업은 보존 요약과 원시 로그·fixture의 수명 경계를 분리하는 편이 낫다.

## 권고 순서

1. 현행 v2 lease의 정확한 producer/자식 종료 근거를 복구하고 unknown/중단 결과를 보존한 supported retirement를 검토한다.
2. 구형 11개 lease와 namespace의 원래 소비·실행 근거를 대조해 명시적 폐기 계획을 세운다.
3. 44개 미확정 항목·20개 incomplete 그룹을 owner별 close/release/refresh 관점에서 조사한다. metadata 정합성과 삭제 가능 여부는 별도 판단한다.
4. sentinel에 process-start identity·operation token·중단 후 복구 경로를 마련하고 가능하면 OS 잠금과 복구 증거를 분리한다. 타 작업 점유 잠금은 임의 해제하지 않는다.
5. work 보호를 일괄 약화하거나 .lock을 지우기보다 보존 요약과 폐기 가능한 원시 출력을 분리한다.

권고는 분석 결과이며 코드 변경·잠금 해제·삭제 승인으로 해석하지 않는다.

## 증거와 검증 한계

[파일 metadata](reports/lock-metadata.json), [lock 후보](reports/lock-paths.txt), [lease 후보](reports/lease-paths.txt), [공유 lease/프로세스 대조](reports/shared-cache-leases.json), [전체 PID/start snapshot](reports/all-process-identities.json), [실행 엔진 snapshot](reports/process-snapshot.json), [native 보호 요약](reports/native-protection-summary.json).

제품 빌드·테스트·잠금 획득/해제 실험 없이 소스와 현존 상태를 대조했다. 제외 영역·프로젝트 밖 상태와 모든 파일의 현재 OS handle을 검증한 결과는 아니다. 원래 로그 정리는 미완료로 유지한다. 분석 JSON 5개를 재파싱해 모두 성공(exit 0)을 확인했고, 이번 작업이 생성한 임시 metadata helper만 일반 삭제 후 부재를 확인했다. 조사 대상 잠금·로그는 삭제하지 않았다. 상세 JSON과 경로 목록은 후속 진단 근거로 보존한다.

## 보호·참조 감사의 최종 판단

- legacy custody `work:BI-01-legacy-custody:20261019`는 retained/incomplete 구성원 2,406개이며 모두 generated:false·protection_known:false다. 원래 producer/consumer를 확정하지 못해 보관하는 것이므로 단순 나이 기준으로 불필요한 잠금이라 확정할 수 없다.
- DN-01에서 남긴 156경계 중 154개가 위 custody의 정확한 member다. 나머지 두 경계는 BJ-01-shared-engine 및 window-use-stages의 별도 소유와 겹친다. 현재 근거상 보호는 합리적이지만 owner별 정합성 조사 없이 광범위 custody가 계속 유지되는 관리 부담은 있다.
- 구체적으로 확인한 기록들에서 불필요해졌다고 입증된 stale 참조는 발견하지 못했다. 84개 참조 보유 항목 전체가 잘못된 참조라는 뜻도 아니다.
- `work:legacy-log-retirement:old:20261024-1`과 `...:unknown:20261024-1`은 이미 deleted/잔존 0인 이력이다. 현재 파일 삭제를 막는 잠금으로 세지 않는다.
- DN-01 보고서의 보류는 acceptance/recovery 증거와 명시적 재검토 조건을 가진 별도의 hold다. 실제 중복 보호 정보 오류로 확인된 사례는 module-cache-management-r1의 producer/native 불일치다.
- 근거: project-maintenance.json:21–26, scripts/artifact-lifecycle.cjs:109–130/391–477, native registry.rs:348–443 및 groups.rs:254–329/440–467, BI-01 adoption map, DN-01 최종 대조·보존 영수증. 전체 참조의 현재 필요성과 실제 OS handle은 미검증이다.

두 읽기 감사는 완료됐다. source 및 metadata에 근거한 분석 결과이며 수정·해제의 실행 검증은 아니다. 향후 변경 범위는 현재 영향이 있는 v2 lease의 정식 복구, 구형 namespace 폐기, stale native metadata 동기화, sentinel 복구 설계 개선 순으로 결정하는 것을 권고한다.
