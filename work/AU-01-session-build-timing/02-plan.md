상태: 구현·관련 Windows fixture 검증 완료. 전체 배포본 빌드·사용자 설치 및 단축률 측정은 이번 실행에 포함하지 않았다.

# 빌드·회귀·기능 보존 검사 파이프라인 최적화

## 목표와 요청 범위

사용자는 앞선 세션의 통계를 근거로 파이프라인 최적화 계획을 요청했다. 이번 산출물은 조사 근거, 우선순위, 구현 소유 범위, 검증 및 수용 기준을 갖춘 제안이다. 기존 통계는 [보고서](report.md)를 재사용한다. 제품 빌드 파이프라인과 관련 검증 구현은 승인됐다. 실제 사용자 설치는 별도 요청 범위다.

필수 검사·기능 범위, 고정 입력·출처, 최종 패키지 동일성, 설치 전 호스트 검증 6단계를 보존한다. 빠른 실패 판정, 중복 컴파일 감소, 영향받지 않은 결과 재사용, 안전한 재개를 통해 최초 성공 및 재시도의 전체 경과 시간을 줄인다.

플랫폼 분류: 혼합. 실행 순서·영수증·계측은 공통 로직이며 Windows x64/MSVC 로컬 실행을 첫 실측 대상으로 한다. Cargo target/profile, 실행 환경, 프로세스 종료 및 fixture는 플랫폼 경계에서 처리한다. macOS ARM64·Linux x64의 기존 경로와 계약을 보존하되 실기기 미검증을 수용으로 보고하지 않는다. 원격 실행, 신규 플랫폼 지원, 사용자 앱 기능 변경은 제외한다.

## 검토할 제안과 추천

1. 우선 1~3단계(계측·빠른 실패·컴파일 경로 정리)를 구현하고 재시도 비용을 측정하는 것을 추천한다. 기존 검증 범위를 바꾸지 않고 효과를 확인할 수 있다.
2. 그다음 동일 입력 재개 및 Cargo 검사 결과 재사용을 추가하는 것을 추천한다. 현재 재사용 계약은 세 바이너리 실행 검사에 한정되므로 이 확대는 별도 설계 변경이다. 컴파일 산출물 재사용과 테스트 통과 결과 재사용을 구분한다.
3. `-FullRegression`은 전체 필수 검사와 네이티브 강제 실행을 그대로 유지한다. 일반 반복 실행의 적용 범위를 임의로 줄이거나 해당 옵션을 끄는 방식으로 최적화하지 않는다. 동일 실행의 중단 후 재개 정책은 명시적으로 구분하고, 강제 재실행 시 기존 통과 증거를 무효화하는 규칙도 유지한다.
4. 최초 구현에서는 무거운 Cargo 작업을 같은 캐시에 병렬 실행하지 않는 것을 추천한다. 별도 캐시·추가 컴파일러 캐시 도입은 실제 잠금 대기·자원 지표가 병목임을 확인한 뒤 검토한다.

## 조사 근거

- 지난 세션의 파이프라인 5개 관측 구간 합계는 3시간 56분 39초다. 실패·중단·진행 중 구간을 포함하며 성공 실행 1회의 기준 시간이 아니다.
- 마지막 Windows 빌드는 42분 53초, 그중 Cargo dev 컴파일 33분 16초였다. 이후 기록된 기능 보존 검사 7개 누적 시간이 53분 36초였다. 병렬 시간을 합산해 전체 경과 시간으로 해석하지 않는다.
- `scripts/deploy-azrael.ps1:168` 부근은 source-tests와 build를 이미 병렬 실행한다. 이후 engine-preservation을 시작·대기한 뒤 prepare 및 acceptance로 진행한다. 새 병렬 처리 전체를 처음부터 만들 필요가 없다.
- `scripts/feature-preservation.cjs`는 같은 실행 명령을 묶고 소스 검사에 제한된 병렬 실행을 적용하며 native는 순차 실행한다. `runGroup`이 exitCode!=0을 기록한 뒤 바로 실패를 전달하지 않으므로 소스 실패 후에도 native 작업을 계속한다. 통과 receipt 검증은 마지막에 실패한다.
- `scripts/test-project.cjs`는 명령 그룹을 순서대로 실행하고 extension-build 실패에만 즉시 중단한다. 다른 선행 검사 실패 후 무관한 다음 그룹을 실행하는 정책을 조사·정리할 필요가 있다.
- 빌드 모듈 및 바이너리 재사용은 이미 존재한다. 보존 검사 native cache는 provider-context/recovery/accepted-input의 세 바이너리 검사에 한정된다. API context/model harness 등의 Cargo 검사에는 같은 결과 재사용이 등록되지 않았다. `-FullRegression`은 native 재사용을 끈다.
- `build-azrael.ps1`은 Cargo build에 explicit Windows target을 사용한다. Cargo 검사 wrapper들은 cargo test --lib를 host target으로 실행한다. 캐시 루트가 같아도 target/profile/feature/rustflags 및 고정 소스 경로 변화가 컴파일 재사용을 줄일 수 있다. 이번 세션의 실행기는 CARGO_TARGET_DIR을 명시적으로 설정했다. 경로 불일치를 입증한 것으로 표현하지 않는다.
- 마지막 input-budget-helper 실패 원인은 검증 환경의 zod/v4 누락이었고 환경 준비 후 통과했다. 필수 검증 의존성을 큰 빌드 전에 확인할 수 있다.

기존 계약: [보존](../../docs/architecture/upstream-preservation.md), [네이티브 재사용](../../docs/ops/development.md#native-verification-result-reuse), [빌드 playbook](../../docs/playbooks/build.md), [플랫폼](../../docs/architecture/multi-platform.md).

## 단계별 계획

### 1. 실행 시간과 재사용 판정의 계측

소유: scripts/deploy-azrael.ps1, scripts/build-metrics.ps1, scripts/feature-preservation.cjs 및 기존 검사 wrapper.

기존 metrics/receipt 구조를 확장해 시작·실제 종료·종료 코드, 의존성 대기, 컴파일·검사 실행, cache hit/miss 및 이유, 입력 식별값, 중단·재개·재실행 사유를 기록한다. 종료되지 않은 실행도 마지막 checkpoint로 복원할 수 있게 한다. Cargo 자체 로그·timings와 기존 명령 기록을 먼저 활용하고 새로운 측정 시스템은 만들지 않는다. 기록 누락 때문에 진행 중 검사를 실패 또는 완료로 판단하지 않는다.

출력: 같은 입력·환경별 최초 실행, 무변경 반복, 환경 실패 후 재개, 소스 수정 후 재실행을 비교하는 metrics. 후속 2~5단계가 이를 기준으로 효과를 평가한다.

### 2. 빠른 검사와 환경 준비를 앞에 배치

소유: scripts/deploy-azrael.ps1, scripts/test-project.cjs, scripts/feature-preservation.cjs, scripts/test-provider-input-budget-helper.cjs 및 해당 의존성 준비 경계.

최종 바이너리가 필요 없는 필수 소스 검사와 Bun/Node/TypeScript/ripgrep 및 필요한 패키지 해석 확인을 큰 컴파일 전 실행한다. 의존성은 선택된 lockfile에 따라 준비하고 제품 소스를 바꾸지 않는다. 사전 환경 확인 자체는 필수 동작 검사 통과 증거를 대신하지 않는다.

소스 검사 실패 시 새 native/빌드 작업을 시작하지 않는다. 이미 실행 중인 병렬 작업의 결과는 회수하며, 종료가 필요한 경우 현재 실행이 소유한 자식만 다룬다. 공유 캐시의 다른 작업이나 사용자 프로세스를 종료하지 않는다. 기본 배포 경로는 빠른 실패 판정을 적용하고 전체 실패 수집 진단 모드는 명시적으로 구분하는 것을 제안한다.

앞당긴 소스 검사는 같은 고정 입력과 검사 환경이면 후속 preservation이 검증된 실행 증거를 인계받게 한다. 동일 테스트를 단순히 앞뒤 두 번 실행하지 않는다. registry의 필수 feature/check 범위와 최종 identity 검증은 계속 수행한다.

### 3. Cargo 컴파일과 실제 검사 실행을 정리

소유: scripts/check-api-context.cjs, scripts/check-model-harness-profiles.cjs, 기타 Cargo wrapper, deploy/build의 환경 전달 경계.

target triple·toolchain·profile·feature flags·RUSTFLAGS·CARGO_TARGET_DIR을 하나의 실행 입력으로 정규화하고 wrapper에 전달한다. 공통 환경과 플랫폼 차이를 명시하며 Windows target을 공통 코드에 새로 고정하지 않는다. build와 test의 산출물이 다를 수 있으므로 동일 캐시를 쓴다는 이유만으로 같은 바이너리로 취급하지 않는다.

같은 crate/feature 집합의 테스트는 가능한 경우 한 번 컴파일한 뒤 필요한 filter를 각각 실행한다. 모든 기존 테스트 이름·범위·실패 결과를 유지한다. Cargo 기존 incremental과 test --no-run 등 설치된 기능을 먼저 평가하며, no-run이 오히려 전체 시간을 늘리면 적용하지 않는다. 고정 소스가 실행 중 바뀌거나 고정 경로를 다른 입력으로 덮어쓰는 방식은 사용하지 않는다.

### 4. 동일 입력 재개와 필요한 결과 재사용

소유: scripts/deploy-azrael.ps1, scripts/feature-preservation.cjs, scripts/verification-result-cache.cjs, scripts/native-verification-cache.cjs, feature inventory와 해당 계약 문서.

동일 입력에서 환경 또는 검사 실패가 발생하면 성공한 빌드·독립 검사 결과를 보존하고 실패 검사 및 영향을 받는 후속 단계만 다시 실행한다. 입력·환경·검사 지문이 바뀌면 해당 의존 결과를 무효화한다. 이전 source/engine receipt를 재검증한 뒤 새 최종 패키지에 연결하며 최종 패키지·호스트 검증·설치 동일성 확인은 생략하지 않는다.

Cargo 검사 결과 재사용은 우선 엔진 전체 고정 소스 지문, Cargo.lock, toolchain/target/profile/features/환경, wrapper·검사·fixture 입력, registry·contract 및 보존 로그 해시가 모두 일치하는 보수적 key로 도입한다. 시험 실행만으로 실제 binary 검사를 대체하지 않는다. 의존성 폐쇄 범위를 입증하기 전에는 crate의 일부 파일만 비교하는 key로 좁히지 않는다. 실패·손상·입력 변조·불확실한 환경은 재사용하지 않는다.

임의 경로의 예전 result나 Git HEAD만으로 통과를 인정하지 않는다. cache와 resume evidence는 범위·입력·로그·실행 상태를 명시하며 동시 접근과 보존·정리는 기존 lease/cleanup 기능을 확장한다.

### 5. 준비 작업의 병렬 실행과 최종 수용

선행 조건: 1단계 실제 시간과 2~4단계 실행·재사용 계약이 준비돼야 한다.

최종 engine 검사와 독립적인 패키지 입력/호스트 fixture 준비는 확인된 의존 관계에 따라 앞당긴다. 최종 바이너리 및 패키지를 요구하는 단계는 해당 산출물 식별값이 확정된 뒤 실행한다. 같은 Cargo 캐시를 쓰는 무거운 컴파일은 한 번에 하나 실행한다. 추가 병렬화는 CPU·메모리·디스크와 잠금 대기를 측정해 선택한다.

원본 engine과 bridge 및 code-mode-host 동일성, UI·engine passing receipts, 정확한 VSIX와 fresh fixture를 사용하는 호스트 6단계, 설치 바이트·버전 확인, 실패 및 성공 산출물의 필수 정리를 마지막 수용에 유지한다.

## 구현 순서와 인계

root가 계약·통합·최종 판단을 소유한다. 독립 소유 범위인 Cargo wrapper 정규화와 소스 검사 runner 개선을 담당자에게 배정했다. root는 배포·보존 검사 계약, cache/resume 통합과 문서를 소유한다. 계측과 빠른 실패를 먼저 적용하고 관련 fixture로 검증한다. 정규화된 Cargo 입력이 준비되면 compile 재사용을 확인한다. 이후 결과 재사용·재개를 구현하고, 마지막으로 실제 critical path에 맞는 병렬 준비를 적용한다. 여러 단계에서 같은 파일을 수정하므로 수정·통합 순서를 유지한다.

구현 전 owning architecture·ops와 inventory에서 바뀌는 의미를 합의된 설계로 반영한다. 기존 통계 보고서는 고정된 과거 기록으로 보존하고 최적화 실측은 이 계획에 연결한다.

## 검증·수용 기준

- 필수 feature/check 범위와 FullRegression의 강제 실행 의미가 전후 동일하고, 설치 전 호스트 6단계 및 패키지 동일성 검사를 유지한다.
- 소스 실패·의존성 누락을 주입한 fixture에서 이후 native/전체 빌드가 새로 시작되지 않는다. 병렬 작업 종료·결과 인계와 cleanup 오류도 확인한다.
- 동일 입력 재개에서는 통과한 빌드·검사의 불필요한 재실행이 없고, 소스·lockfile·toolchain·환경·fixture·로그 변조 시 필요한 결과가 무효화된다. failed check와 미완료 receipt는 cache hit가 될 수 없다.
- existing test-feature-preservation.cjs, test-feature-preservation-cache.cjs, test-native-verification-cache.cjs, test-preservation-integration.cjs, test-project-selection.cjs, build-metrics 및 deployment 관련 fixture를 변경 범위에 맞춰 실행한다. 실제 Cargo filter 목록과 완료된 검사 목록도 대조한다.
- 계획 승인 후 허용된 동일 입력의 Windows 실행에서 기존 방식과 개선 방식의 전체 경과 시간을 비교한다. 비싼 baseline을 반복 생성하지 않고 충분한 기존 결과를 재사용한다. cold/warm cache, target/profile, CPU·RAM·다른 작업 점유를 기록한다.
- 성능 목표(보장 수치 아님): 무변경 반복 또는 동일 입력의 실패 후 재개에서 전체 경과 시간 20% 이상 감소를 초기 판단 기준으로 제안한다. 기존 3:56:39 누적 실패 시간을 baseline으로 사용하지 않는다. 첫 성공·cold 실행 개선은 별도 측정하며 효과 없는 변경은 채택하지 않는다.
- 공통 코드 변경은 Windows 회귀 및 플랫폼 계약 fixture를 확인한다. macOS/Linux의 실제 네이티브·호스트 수용은 실행 가능한 대상과 별도 허용 범위가 준비될 때 수행하고, 그 전에는 미검증으로 보고한다.

## 권한과 현재 검증 상태

권장 계획의 구현과 관련 fixture 검증을 수행한다. 전체 배포본 성능 비교·사용자 설치·사용자 프로세스 제어는 실행하지 않는다. 전체 앱/배포본 빌드는 build playbook에서 명시적 지시를 요구하므로, 실행 단계에서는 필요한 성능 비교의 전체 빌드 범위를 함께 제시한다. 실제 설치는 별도 요청이 있을 때만 수행한다.

실행 입력: 다른 세션의 엔진·문서·manifest 변경이 존재함을 확인했고 해당 변경은 보존한다. 기존 공통 runner/cache를 재사용하며 새 외부 라이브러리를 도입하지 않는다. Cargo compile 산출물은 existing incremental로 재사용하고 각 필수 filter는 실행한다.

## 구현 결과와 검증 기록

2026-10-14 구현: 배포본 빌드 전에 검증 의존성 준비와 engine source gate를 수행하고, 통과한 source receipt는 입력·환경·실행 파일·로그 해시를 확인하여 complete engine 검사에 인계한다. source receipt 자체는 최종 수용 증거가 아니다. source runner는 기본적으로 첫 실패에서 멈추며 명시적인 `--collect-failures`만 독립 실패 수집을 허용한다. 확장 빌드 실패 뒤 확장 테스트는 실행하지 않는다.

기존 Cargo wrapper 5개, scope 10개, filter 호출 16개의 필수 목록을 유지하고 target/profile/env 구성을 공통 helper로 정리했다. `--no-run` 선행 호출을 추가하지 않았으며 Cargo incremental을 재사용한다. Cargo 검사 성공 증거는 동일 source/provenance·검사·환경·toolchain·외부 Cargo 설정·로그일 때만 재사용한다. 해석 불가능한 설정은 재사용을 끄고 검사를 실행한다. 전체 실행이 실패해도 입력이 유지된 독립 Cargo 성공 결과만 남길 수 있으며 실패한 receipt는 통과 처리하지 않는다. `FullRegression`은 native 재사용을 강제로 끈다.

engine preservation과 패키지 준비는 독립 실행하고 둘 다 통과해야 acceptance로 진행한다. 계정 제어 검사가 요청된 경로는 기존 선행 조건을 유지한다. 최종 패키지 바인딩·설치 직전 재검사·호스트 6단계는 그대로 유지했다. build/deploy/검사 기록에 UTC 시작·종료, 경과 시간, 종료 코드, 실행/재사용/차단 상태를 남긴다. 경과 시간에는 병렬 실행 시간을 중복 합산하지 않는다.

Windows 검증 증거는 `artifacts/logs/AU-01-pipeline/`에 보존한다. Node 통합 112개 중 111개가 통과했고 새 검사 자동 발견에 따른 예상 목록 1개를 수정한 뒤 `selection-final.log`의 선택 검증 26개가 모두 통과했다(종료 코드 0). `native-cache-final.log` 18개, `build-metrics-tests-final.log` 16개도 종료 코드 0으로 통과했다. 별도 fixture에서 source receipt 인계·변조 거부, 조기 실패, Cargo warm reuse·강제 실행·설정 무효화, 실제 Git 입력 변경, prepare/preservation 실행 겹침을 확인했다. 실패한 중간 실행 로그는 최종 통과 증거와 구분한다.

전체 앱 빌드·사용자 설치·실제 native 성능 비교는 실행하지 않았다. 20% 단축은 제안 목표이며 측정 결과가 아니다. macOS/Linux 실기기 수용도 미검증이다. 다음 성능 측정에서는 동일 고정 입력의 첫 성공과 실패 후 재시도를 각각 비교하고 cold/warm cache, target/profile, 실행 자원 및 전체 경과 시간을 기록해야 한다.

배포 전체 회귀 62개가 종료 코드 0으로 통과했다(`deploy-regression.log`). 실행 겹침을 강제하는 별도 `parallel prepare` fixture도 1개 통과했다(`deploy-overlap.log`). 전체 회귀 결과와 계측 60개는 `artifacts/logs/deployment-optimization/tests-deploy-dd55e61db8554f778ba1107219408137/`에 남겼다. 나머지 2개는 잘못된 target 입력을 계측 초기화 전에 거부하는 사례다. 이번 작업의 배포 fixture 3개 묶음과 build-metrics 내부 복제 project 2개를 삭제하고 제거를 확인했다. fixture Git의 숨김·읽기 전용 속성을 확인하고 해당 메타데이터만 해제한 뒤 일반 삭제했다. 정리 근거는 `fixture-cleanup.json`에 보존하며 기존 다른 작업의 fixture는 유지했다.
