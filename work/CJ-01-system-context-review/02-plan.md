# Cargo 준비 재사용과 추천

상태: 구현·검증 완료. 공유 유지보수 잠금으로 임시 산출물 정리, 변경 분리 문제로 커밋을 보류했다. 제품 빌드·설치는 수행하지 않았다.

## 목표와 범위
같은 고정 입력의 타입 검사 완료 근거와 Cargo 캐시에 준비된 테스트 바이너리를 재사용한다. 필터별 nonzero 선택과 실제 실행은 계속 Cargo로 수행해 기존 실행 환경과 러너 설정을 보존한다. 직접 바이너리를 복사·실행하는 별도 경로는 추가하지 않는다. 재사용 권장·주의·재준비 권장과 이유를 제공하며 새로운 승인 장벽은 만들지 않는다. 모델은 자동·새 준비·추천만 모드를 선택할 수 있다. 실패·unknown은 통과 근거로 사용하지 않는다.
공통 대상은 Windows x64·Linux x64·macOS ARM64, 실제 검증은 Windows x64다. 기존 공유 target·프로세스는 변경하지 않는다.

## 구현과 소유
root: 준비 근거 helper, Cargo verification/preservation 연결, owning 문서·feature·cache identity 갱신, 검증·정리.
cargo_owner_observation: Cargo owner 관측 시각·단조 시간 기록과 성공 관측 연결점, 해당 동작 테스트. 파일 준비 완료, 실행 검증 대기.
기존 동결 입력 ID와 소유 run 폴더를 사용한다. 필터는 준비 key에서 제외하고 컴파일 조건·소스·target 식별자를 유지한다. 준비 receipt는 테스트 통과 증거가 아니다. 준비 결과가 부족하면 추천 이유와 함께 기존 경로를 수행한다.

## 검증과 완료
기존 Cargo owner/verification/cache/scheduling/recipe Node 검사를 수행한다. 작은 무의존 Rust crate에서 두 필터가 타입 검사 근거를 재사용하되 각각 실제 실행되는지 확인한다. zero 선택·실패·입력 변경·새 준비·추천만도 검증한다. 엔진 전체 컴파일은 하지 않는다.
생성 fixture/log는 실행 전에 소유 lifecycle을 기록하고 결과 검토 후 native cleanup을 사용한다. 실제 exit·로그·검증 한계를 기록한다. 해당 변경만 분리 가능한 경우 작업 커밋한다.

## 실행 기록
`development-workflow`와 `implementation`을 적용했다. `work:CJ-01:cargo-preparation-v1`이 실행 전 생성물 소유권을 기록한다. 상세 자료는 `artifacts/tasks/CJ-01-cargo-preparation-v1/`에 한정한다. 제품 빌드·설치는 수행하지 않았다.

첫 Node 검사 109개 중 101개 통과, exit 1. 중단된 모의 Cargo 소유권을 재사용하려던 새 fixture 기대값을 수정했다. 기존 프로필 wrapper와 recipe·fixture 기대값의 불일치, 고정된 그룹 수 기대값도 확인했다. 실제 wrapper 명령에 recipe를 맞추고 그룹별 입력 결합 검사는 유지했다. 단순 그룹 개수 단언은 제거했다. 원본 wrapper의 검사 범위를 변경하지 않았다. helper dependency·검토된 hash도 갱신 중이다.

작은 실제 무의존 Rust crate 실행은 exit 0. 첫 시도는 fixture의 상대 import 경로 오류로 Cargo 실행 전 실패했고, 경로 수정 후 실행했다. 기존 경로의 준비된 캐시에서 beta 481ms(타입 검사 146ms·선택 192ms·실행 141ms), 준비 재사용 beta 310ms(선택 134ms·실행 172ms)였다. 단일 예제·실행 순서에 영향을 받는 관측값이며 엔진 빌드 성능 수용 근거가 아니다. 재사용 테스트 실패 exit 101, zero 선택 exit 1, 실패 이후 다른 필터 실행 exit 0, fresh·advice·실제 입력 변경 후 준비를 확인했다. 상세 `real-results.json`과 phase 로그를 검토했다.

후속 확인: 기본 toolchain/외부 Cargo 설정도 준비 근거에 연결되도록, preservation이 이미 측정하는 runtime identity를 전달한다. 별도 전수 검사나 도구 조회를 추가하지 않는다. 이 근거가 없는 standalone 호출은 추천 이유와 함께 기존 준비 경로를 사용한다.

## 최종 구현·검증
소스·컴파일 인자·실행 환경과 기존 측정 runtime identity가 같은 경우 준비 receipt를 사용한다. 필터와 libtest 실행 인자는 준비 key에서 제외한다. 성공 selection을 관측한 뒤 target 소유권을 유지하는 동안 receipt를 저장한다. 저장 실패는 경고로 남기고 실제 테스트 결과는 유지한다. 선택 실패·zero 선택은 준비 근거를 무효화하며 unknown 소유권은 기존 보호를 유지한다. 바이너리 직접 실행이나 별도 전역 캐시는 도입하지 않았다. 자동 재사용·fresh·advice 선택을 제공한다.

Windows x64, Node 26.7.0, 실제 Rust fixture의 Cargo 1.98.0 환경에서 확인했다. Linux/macOS, 엔진 전체 컴파일·실제 제품 빌드·설치는 확인하지 않았다. 기존 Cargo runner·cwd·환경은 그대로 사용한다. fixture의 두 번째 실제 실행에서도 동일 입력 재사용·실패 101·zero 선택 1·fresh·advice·실제 입력 변경 후 재준비를 확인했다. 마지막 관측값은 준비된 캐시의 기존 beta 652ms, 재사용 beta 294ms였다. 병렬 소스 검사와 실행 순서가 섞인 작은 예제의 단일 관측으로 성능 개선률을 확정하지 않는다.

| 실행 범위 | 결과 | 실제 exit | 실행 로그 |
| --- | --- | --- | --- |
| Cargo owner/verification/preparation/cache/scheduling/recipe 전체 | 109/109 통과 | 0 | `logs/source-r2.stdout.log` |
| runtime 결합과 환경 격리·저장 실패 처리 이후 verification/preparation/recipe | 68/68 통과 | 0 | `logs/final.stdout.log` |
| 최종 helper key·source-only audit 관련 cache 재검증 | 4/4 통과 | 0 | `logs/cache-final.stdout.log` |
| preservation·결과 cache 연결 | 36/36 통과 | 0 | `logs/integration.stdout.log` |
| 최종 runtime handoff 이후 preservation | 21/21 통과 | 0 | `logs/integration-final.stdout.log` |
| 작은 실제 Rust fixture, 기대 실패·zero 선택 포함 | 모든 기대 결과 확인 | 0 | `logs/real-final.stdout.log`, `real-results.json` |

위 로그는 중복 실행된 검사 범위를 포함하므로 개수를 합산하지 않는다. 첫 전체 검사는 158.262초, 보존·캐시 연결 검사는 318.380초였다. 서로 겹쳐 실행됐으므로 합계는 전체 작업 시간이 아니다. 준비·선택·실행 시간은 각 명령 로그에 남고, crate별 컴파일·링크·자원 대기는 계측하지 않았다. `git diff --check`의 작업 관련 범위를 통과했다. 정적 검토의 처음 보고에서 `splice(i, 1)`을 잘못 읽은 충돌 주장은 검토자가 철회했으며, 실제 feature-after-filter 동작 검사도 통과했다.

영구 회귀 검사는 준비 재사용·필터별 실제 실행·실패·권장 모드·환경 전달의 계약을 보존하므로 남긴다. 작업 전용 Rust crate·타깃·상세 로그는 검토 후 삭제 대상으로 처리한다. 검증 근거의 독립 요약은 이 계획에 보존한다.

정리 전 상세 근거 SHA-256:

- `real-results.json`: `3a74ce49d8596879da45b9a4c211ea6b1a9ec6674d8987ec5b6bc2cbcad02c76`
- `logs/source-r2.stdout.log`: `760c4544d98a27b05b8c09b24c27a132de4f0f5666e99bd67a2e3421c3262374`
- `logs/final.stdout.log`: `7e116c3ba988b41db7d8df9774a0ef19db18fc73499f9a90032e7808a52a25d8`
- `logs/cache-final.stdout.log`: `e909e3fd53e438d657b80c92bdd18098505a532199bcad1002c74614177b9328`
- `logs/integration.stdout.log`: `00864a227d596bf448c20045970622743c8fc928334a1cf30db6bb340dd4d18a`
- `logs/integration-final.stdout.log`: `84f52d88453c1e34bddd5454fe79e7df69d4d0a41d5e869d9236f3f30d331586`
- `logs/real-final.stderr.log`: `1dd94f93b2f63025e644a02037109b287d5acafa2763f79a5969ee4b795d5941`

모든 실제 실행 세션의 terminal exit를 확인했다. 모의 unknown owner fixture는 실제 Cargo 프로세스를 만들지 않았으며 관련 Node 실행도 종료됐다. 재시도는 첫 fixture import 경로 오류, 기대값·recipe 정합화, runtime identity 전달 보완에 따른 해당 범위 재검증이었다. 공유 Cargo 캐시나 다른 작업의 프로세스는 건드리지 않았다.

커밋: 보류. `azrael-feature-contracts.json`, Cargo recipe·fixture, 운영 문서에 다른 작업의 미커밋 변경이 섞여 있고, 이번 호환성 정합화가 앞선 프로필 wrapper 변경에 의존한다. 변경된 기존 파일을 통째로 stage하지 않았다. 선행 변경이 소유 작업에서 정합화된 뒤 이 작업의 helper·테스트·문서 변경을 분리해 커밋해야 한다. 제품 동작 검증을 생략해서 커밋을 만들지 않았다.

## 남은 정리와 재개 조건
기존 `cargo-preflight-source` 유지보수 bundle의 argv와 입력에 새 준비 helper·회귀 검사를 연결했다. native `project_tests plan`의 실제 argv·cwd·환경·선행조건·guard를 확인했다. plan ID는 `plan-2c83021abf22ad3f87d3befb3acc36596dc174c6e98fb302d10f47ae0fd92c5f`이며, 이 호출은 실행 통과 증거가 아니다. 해당 명령의 검사들은 위 실제 Node 실행 범위로 검증했다.

종료 기록을 추가하는 `closeLifecycle`이 공유 `artifacts/maintenance/lifecycles/catalog.lock`의 EEXIST로 실패했다. 해당 잠금은 관측 시각에 2026-10-22 16:06:25 UTC 생성·0 bytes였고 소유자 정보가 없다. 나이나 내용만으로 중단된 소유자라고 판단하지 않았다. 이어 native inventory 등록도 `exclusive maintenance lock unavailable (abandoned locks require explicit recovery)`로 거절됐다. 삭제 review/apply는 수행하지 않았고, 해당 작업 root의 삭제도 일어나지 않았다. 보호를 우회하거나 잠금 파일을 제거하지 않았다.

`artifacts/tasks/CJ-01-cargo-preparation-v1/`은 지금 유지한다. 재개 조건은 공유 잠금 소유자의 정상 해제 또는 소유 절차에 따른 명시적 복구다. 그때 실제 종료 근거와 이 요약으로 lifecycle을 닫고 완전 membership을 등록한 뒤 native review/apply로 이 run만 정리한다. 독립적으로 읽을 수 있는 검증 요약은 이미 이 계획에 남겼다. 관련 입력이 바뀌지 않았다면 검사를 다시 반복할 필요는 없다. 현재 producer record는 종료로 위조하지 않고 pending 상태를 유지한다.
