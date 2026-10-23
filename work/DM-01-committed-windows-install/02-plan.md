상태: 사용자 승인 후 구현 중. 승인된 제품 입력·보존 기준과 실행 순서에 따라 개선·검증·빌드·설치·정리를 진행한다.

# 새 산출물 경계·검사 체계 개편과 구 산출물 정리

## 목표와 기존 결정

새로 생성하는 소스 입력·실행 작업공간·버전 산출물·공유 캐시·관리 기록의 소유 경계를 분리한다. 검사 품질을 유지하면서 선행 실패를 일찍 발견하고, 충분한 성공 증거를 재사용하며, 필요한 항목만 재실행한다. 개편된 절차로 Windows x64 산출물을 만들고 기존 요청의 일반 사용자 설치를 완료한다. 구 산출물은 현재 참조를 해결해 가능한 한 많이 삭제하며, 정확한 보존 근거와 해제 조건이 있는 자료만 남긴다.

이 작업은 중단한 빌드의 후속 개편이다. [이전 실행·중단·시간 통계](01-plan.md)는 실행 증거로 보존한다. 제품 소스 전체 재작성이나 UI 개편은 범위가 아니다.

검토할 제안 기준:

- 제품 기능 입력은 기존 99afefb1688bad28469ebfc445118980f0bd08a6 및 이미 승인된 보완을 유지하고 이번 관리·검사 개편만 추가하는 것을 권장한다. 최신 HEAD의 무관한 기능을 함께 넣으면 검증·지원 범위가 달라진다. 개편 코드의 출처와 제품 기능 기준을 별도로 기록하고 최종 입력을 정확히 고정한다.
- 산출물 생성 이후 일반 사용자 설치까지 기존 목표를 유지한다. 설치 직전 현재 등록·실행 버전과 버전 충돌을 다시 확인한다. 새 버전 값은 충돌 없는 패치 버전으로 확정한다.
- 원본 Codex/audio, 사용자 계정·인증·대화·설정·세션 및 현재 실행 중인 배포를 보존한다. 사용자 창을 강제로 종료하거나 다시 열지 않는다.
- 명시 보존된 외부 av17/av18 Azrael 확장과 대응 빌드도 보존한다. 이들의 Git 객체·런타임 의존 자료는 대체본을 검증하고 읽는 참조를 전환한 경우에만 정리할 수 있다.
- 과거 버전이라는 이유만으로 보존하지 않는다. 현재 사용, 명시 보존, 아직 필요한 진단 또는 유일 복구·출처 근거가 없는 이전 배포와 중복 자료는 삭제 후보로 한다.
- 필수 기능 검사·0개 테스트 차단·전체 제품 출처 감사·정확 패키지 식별·6개 fresh-state 호스트 검증은 유지한다. 검사를 제외한 사실을 통과로 표시하지 않는다.

## 현재 근거와 우선 해결점

이전 요청에서 종료 확인까지 12시간9분이 걸렸다. 계측된 누적 native 보존 검사는3시간36분, 소스 검사는2시간3분, 사전 검사는1시간47분이었다. 이 값은 병렬 구간이 겹치므로 합산하지 않는다. 통과한 소스 검사3회의 경과는18~22분이었다. w12r은19개 기능 범위의33개 native 항목 중17번째에서 실패했다.

확인된 구조:

- root deploy-r2가 작업 로그 루트와 c23b 전체를 보유하고, c23b 내부 버전들도 개별 멤버를 가진다. 입력 작업공간과 그 아래 생성물이 한 삭제 경계로 묶여 있다.
- 실패한 여러 버전은 membership이 미완료이고 producer 종료 근거가 정합되지 않았다. 임시 작업의 inbound execution 참조도 남아 있다.
- 같은 artifacts/v 경로를 과거 검증 기록들이 주장하는 등 재사용 세대의 충돌이 있다.
- 일반 실행 helper는 temporary/logs/reports/outputs만 지원한다. 입력 manifest·작업공간 전달을 별도로 정리해야 한다.
- lifecycle close/release와 native 등록·검토·삭제 API는 이미 있다. 이들을 우회하는 별도 정리기를 만들지 않는다.
- source-preflight-reuse는 동일한 통과 영수증의 완전한 Node 테스트 파일 재사용을 이미 지원한다. source/native/Cargo 캐시도 기존 key/영수증/log hash 검증을 갖는다. 새 저장소를 만들기보다 적용 범위와 호출 연결을 보완한다.
- 변경 영향 선택은 정적 CommonJS/TypeScript import와 명시 owner/cacheInputs를 사용한다. 동적 import·외부 데이터까지 자동으로 완전한 의존성을 증명하지는 않으므로 이 부분은 명시 계약과 무효화 회귀가 필요하다.
- 공통 build-platform은 이미 .inputs와 .work 및 외부 Cargo target을 분리한다. 해당 경계 구현을 재사용하되 Windows 배포는 기존 PowerShell producer가 설치 경로의 소유자다. 새 공통 플랫폼 producer로 전면 전환하는 것은 이번 작업의 전제조건이 아니다.

## 목표 경계

| 구분 | 책임과 위치 원칙 | 참조·정리 원칙 |
|---|---|---|
| 불변 입력 | artifacts/inputs/<input-id> 등에 고정 소스·선택 파일·출처 영수증. 내용과 도구 식별값으로 구별 | 별도 소유 그룹 한 개. 실행과 버전은 소비자로 연결. 입력 아래에 target/dist/tmp/log를 만들지 않음 |
| 실행 | artifacts/tasks/<work>/runs/<run-id> 아래 입력 전달 영수증, temporary/outputs/logs/reports와 필요한 가변 작업 사본 | 입력 payload를 중복 소유하지 않음. 실패·취소 포함 actual 출력과 종료를 정합 |
| 버전 | 기존 운영 표준의 releases/vsix/deployments 경로를 같은 build-id의 버전 그룹으로 연결 | payload·package·독립적으로 읽을 수 있는 필수 검증 증거를 보유. 실행 임시 폴더의 로그에 영구 의존하지 않음 |
| 공유 캐시·도구·고정 fixture | 현재 cache owner와 검증된 target을 유지. 별도 소유·명시 소비자 참조 | 경로 이름 정리를 위해 사용 중 Cargo target을 이동하거나 재컴파일하지 않음. 소유자 경유 검토·정리 |
| 관리 기록 | 삭제 payload 밖의 기존 보호된 registry와 상태 저장 위치 | producer와 native 기록을 지원 API로 연결. 원시 JSON 편집·기록 조작 금지 |

기존 lifecycle의 work/run/version 종류와 참조 API를 우선 재사용한다. 새 schema나 새로운 관리 계층은 실제로 필요한 경우에만 도입한다. Windows 짧은 경로가 필요하면 workspace 안의 검증된 별도 경계를 쓰고 그룹별 세대 식별을 유지한다. 기존 외부 참조와 SQL migration 원본 바이트는 보존한다.

## 실행 순서와 의존 관계

### 1. 중단 상태 정합과 삭제 가능한 자료의 1차 분리

- 현재 작업 소유 프로세스의 중지 증거, 실제 exit, 계획/실제 출력을 기존 close/release로 정합한다. unknown을 성공이나 정상 실패로 바꾸지 않는다.
- 기존 registry를 기준으로 설치·실행·복구·fixture·Git alternates 소비자와 중복 소유 경계를 확인한다. 이미 등록된 payload의 전수 재해시를 반복하지 않는다.
- 새 입력·작업공간에 필요한 용량을 확인한다. 현재 참조가 없는 실패·일회성 산출물은 native review/apply를 통해 먼저 정리할 수 있다. 이전 실행의55.15GiB 정리 수치와 이번 추가 정리를 분리한다.
- 출력: 현재 보호 관계, 해제 가능한 정확한 참조, 경계 변경 대상, 초기 삭제/보류 결과. root가 판단과 통합을 소유한다.

### 2. 새 생성자의 소유·종료 경계 정비

- 기존 input capture/materialization, artifact-run, artifact-lifecycle 및 PowerShell 어댑터를 확장해 명시적인 입력·작업·버전·캐시 context를 전달한다.
- 생성 전에 planned output을 등록하고 부모·자식 중복 경로를 거절한다. 상위 work는 참조로 집계하며 하위 payload를 다시 소유하지 않는다.
- 고정 입력과 필요한 가변 실행 사본을 구분하고, 실제 컴파일 입력과 고정 원본의 동일성을 시작/종료 시 검증한다. build-info와 최종 검증이 삭제될 작업 사본만 출처로 가리키지 않도록 보존 입력과의 연결을 기록한다.
- 성공/실패/사용자 취소에서 actual output·실제 exit·프로세스 종료 근거를 기록한 뒤 해당 execution 참조만 해제한다. 설치·의존·복구 참조는 소비자 소유자가 전환한다.
- 기존 producer schema에 cancelled 값이 없다면 실제 종료 결과와 명시적인 cancellation 사유를 지원 형식으로 남긴다. 확인되지 않은 종료는 unknown으로 보호한다.
- stdout/stderr 완료와 child close를 관측한 후 terminal을 기록한다. Windows 일시 파일 잠금 재시도는 제한된 오류와 시간 안에서만 하고, 상태 기록 실패가 자식 종료 관측을 잃게 하지 않도록 한다.
- 출력: 신규 생성 경계와 종료 helper, 호출자 통합, owning 문서·feature inventory 연결, 회귀 검사. 기존 캐시·경로·출처 보호를 유지한다.

### 3. 검사 선택·순서·재사용 개편

- 긴 실행 전 실제 도구 load, 잠금 파일 의존성, compiler/host 조합, 짧은 소켓 경로, PowerShell 환경, fixture 고정 자료와 새로운 empty-state 세대를 확인한다. 발견 가능한 준비 문제를 뒤의 통합 검사까지 미루지 않는다.
- 영향 받은 동작의 집중 회귀 검사를 먼저 실행하고, 그 결과를 같은 계약의 후속 검사에서 재사용할 수 있게 식별한다.
- 소스 선택기는 owner/의존 관계와 선택 이유를 출력한다. 검증된 매핑이 없는 항목은 보수적 범위를 유지하며 조용히 제외하지 않는다.
- 같은 완전 입력·도구·환경·검사 명령의 성공 결과를 항목 단위로 재사용한다. 다른 입력 사이 재사용은 완전한 의존 범위가 선언되고 변조/변경 회귀 검사로 입증된 항목부터 적용한다. 불명확한 Cargo 항목은 전체 엔진 fingerprint를 계속 사용한다.
- source/native/Cargo result cache와 컴파일 cache의 역할을 구분한다. 실패한 전체 실행에서도 독립 통과 결과를 검증 후 보존하는 기존 기능을 활용한다. failed/unknown 결과는 passing cache가 되지 않는다.
- native 순서는 선언된 의존 관계, 기존 컴파일 조건, 관측 비용, 변경 위험을 반영해 명시한다. 짧고 변경에 직접 관련된 검사를 먼저 하되 package/features/target/profile 의미를 합치거나 바꾸지 않는다.
- source/빌드의 병렬 실행은 실제 자원과 선행 실패 비용을 보고 선택한다. 공유 물리 Cargo target은 실행 소유자 하나를 유지한다. 필수 조건이 갖춰진 작업은 독립적으로 시작한다.
- 실행 전에 항목·실행/재사용 이유·선행조건을 제시하고 실제 시간, 준비/실행/캐시 대기, 재시도 원인을 자동 기록한다. 동일 실패나 동일 입력을 근거 없이 통째로 다시 실행하지 않는다.

### 4. 작은 실제 실행으로 경계와 재사용 검증

- 한 입력으로 성공·의도된 실패·사용자 취소를 각각 검증하고, 실제 프로세스 종료·실행 참조 해제·원시 로그 보존·버전 증거 독립성을 확인한다.
- 동일 입력의 재실행은 영향을 받지 않은 통과 항목을 재사용하고, 제품 파일/검사 코드/도구/환경/fixture가 바뀌면 필요한 항목이 무효화되는지 확인한다.
- 소유 중첩·경로 재사용 세대·외부 hardlink/junction·활성 소비자·불완전 membership·동시 cache recovery·상태 기록 잠금에 대한 차단을 검증한다.
- 작은 파일럿 그룹을 native 등록/검토/일반 삭제하고 실제 부재를 확인한다. fixture나 큰 package를 logs로 옮겨 보존하지 않는다.
- 출력이 준비되면 다음 단계로 넘긴다. 이 단계가 통과하기 전 새 장기 제품 빌드를 시작하지 않는다.

### 5. 고정 입력으로 Windows 산출물 생성·검증·설치

- 개편 코드와 이전 승인 수정을 검토·검증해 task 범위로 커밋하고, 선택한 제품 기준에 필요한 정확한 변경만 포함한 새 입력을 고정한다. 다른 작업의 미커밋 변경은 보존·제외한다.
- 필요한 소스 검사·엔진 기능 검사를 실행/재사용하고 제품을 빌드한다. 전체 source provenance와 정확한 engine/bridge/host/hash 검증을 유지한다.
- 패키지 준비, 계정 검사, 정확한 최종 패키지의 필수6개 fresh-state 호스트 단계를 통과한 뒤 일반 사용자 계정에 설치한다. NoLaunch/reload-required로 현재 창과 사용자 상태를 보존한다.
- 최종 버전은 실행 로그 없이도 필요한 검증 요약·입력/도구 식별·실제 exit·해시를 독립적으로 읽을 수 있게 한다.
- 출력: 설치 영수증, 패키지/엔진 해시, 출처, 실제 검증 범위 및 미검증 사항. 이미 통과한 충분한 증거는 근거 없이 재실행하지 않는다.

### 6. 참조를 전환해 구 산출물을 최대한 정리

- 필요한 fixture/도구가 옛 배포 전체를 참조하면 필요한 완전한 자료를 별도 공유 소유 그룹으로 보존·검증하고 읽는 경로를 전환한다. 외부 설치가 쓰는 Git alternates는 보존 객체의 독립성을 검증한 뒤 이전 object-store 참조를 해제한다.
- 새 버전이 필요로 하는 증거를 최종 버전으로 이전하고, 실행·입력·캐시의 마지막 소비자 참조를 지원 API로 해제한다. 기록만 지워서 삭제 가능하게 만들지 않는다.
- 실패·중단 배포, 중복 소스 사본, 재생성 가능한 미사용 중간 산출물, 과거 VSIX·test profiles·fixtures·구 cache key를 그룹 단위로 native review/apply한다. 독립적으로 준비된 그룹은 묶어서 처리한다.
- 실제 설치/프로세스/보존 소비자가 남은 그룹은 이유와 구체적 해제 조건을 기록한다. 일반 삭제 실패나 도구 불확실성을 우회하지 않는다. occupied lock·System·ACL·사용자 파일은 변경하지 않는다.
- 실제 삭제·남은 경로·참조·registry finalize를 각각 확인한다. 최종 보고는 이번 추가 삭제 그룹 수·논리 bytes·가능하면 볼륨 여유 변화와 보류 사유를 구분한다. hardlink/압축 때문에 논리 bytes를 실제 회수량으로 표시하지 않는다.

## 구현 책임과 병행 범위

root가 데이터/호출 계약·선택 범위·입력 기준·통합·최종 삭제 판단을 소유한다. 계약이 정해진 후 경계 helper/producer와 검사 선택·캐시/스케줄의 변경 범위를 분리해 위임할 수 있다. 각 소유자는 상대 변경을 보존하며 독립적인 파일과 회귀 검사를 담당한다. 레거시 참조 조사는 read-only로 병행하고, 참조 전환·삭제는 생산자 상태와 대체 자료 검증 후 수행한다. 무거운 Cargo 실행은 같은 target에서 중복 시작하지 않는다.

## 검증과 완료 기준

| 성공 기준 | 검증 |
|---|---|
| 신규 입력/run/version/cache가 서로 payload를 중복 소유하지 않음 | 경로 claim 회귀·소규모 실제 producer·native registry 검토 |
| 성공/실패/취소 뒤 실제 종료와 해당 참조가 정합됨 | child tree/exit/durable receipt·다른 소비자 참조 보존·unknown 보호 검사 |
| 잘못된 결과 재사용 없음 | 제품/도구/환경/fixture/검사 변경별 cache 무효화·누락/변조/동시성 회귀 |
| 불필요한 재검사 감소 | 동일 입력 재시도에서 재사용 대상의 실제 미실행 확인, 항목별 실행/재사용 이유와 시간 비교 |
| 필수 검사와 사용자 기능 유지 | inventory의 필수 검사·0개 선택 차단·Windows 회귀·정확 패키지6호스트 및 계정 인수 |
| 설치 완료와 원본 보존 | 일반 프로필 설치 영수증·버전/해시·원본 Codex/audio 및 사용자 상태 보존 |
| 최대한의 구 자료 삭제 | 필요한 자료의 독립 이전/참조 전환·native per-item 결과·실제 부재·보류 이유/해제 조건 |

대상은 Windows x64 로컬 빌드·설치다. 공통 Node 경계·키·선택 정책은 Linux x64/glibc 및 macOS ARM64 의미를 보존하며 플랫폼 계약/경로/권한 회귀를 포함한다. 실제 원격 Linux/macOS native 실행이나 배포는 이번 계획에 포함하지 않는다. Windows 검증을 다른 OS의 native 통과로 보고하지 않는다.

성능은 동일한 입력·도구·기능 범위의 초기 실행과 재실행에서 전체 경과시간 및 재검사 수로 비교한다. 겹치는 시간을 합산해 절감으로 보고하지 않는다. 개선량과 삭제 용량은 실행 전 보장하지 않는다. 단계별 결과와 장기 실행의 확인 시점을 기록하고, 실제 실패 원인을 보완한 영향 범위만 재시도한다.

## 설계·코드 소유자

기존 scripts/artifact-run.cjs, artifact-lifecycle.cjs/.ps1, deploy-azrael.ps1 및 build/prepare/verification 호출자, input capture/freeze helper, test-project.cjs, feature-preservation.cjs, source-test-policy.cjs, source/native/Cargo cache owner와 해당 테스트를 우선 확장한다. 반복 운영은 docs/ops/development.md와 project-maintenance.md, 보존/재사용은 docs/architecture/upstream-preservation.md, 소유권은 docs/architecture/project-maintenance.md 및 artifact-lifecycle playbook에 현재 내용으로 반영한다. 공통 플랫폼 계약과 기능 inventory를 연결한다. 공유 AGENTS/skill library 수정은 이번 범위가 아니다.

구체적인 회귀 소유자는 test-artifact-lifecycle.cjs, test-artifact-run.cjs, test-deploy-azrael.ps1, test-project-selection.cjs, test-feature-preservation-cache.cjs, test-native-verification-cache.cjs, test-cargo-verification-cache.cjs, test-cargo-scheduling.cjs, test-cargo-test-preparation.cjs, test-build-platform.cjs 및 입력 capture/freeze 검사를 우선 사용한다. 실행 취소와 정확한 child tree 중지·참조 해제의 통합 사례를 보완한다.

## 미확정 사실과 중단 조건

- 현재 legacy 그룹의 실제 삭제 가능 수와 물리 회수량은 참조 검토 전 확정할 수 없다.
- 이미 unknown인 과거 실행은 독립적인 종료 증거가 충분한 경우에만 해제하고 결과 자체는 unknown으로 남긴다.
- source/result cache의 교차 입력 재사용 범위는 완전한 의존 계약과 regression 근거를 확보한 항목만 채택한다.
- 원래 기능 입력과 관리 도구 개편을 함께 고정하는 세부 적용 방식은 현재 코드 차이를 확인해 정한다. 이후 기능까지 임의로 포함하지 않는다.
- 사용자 창/계정/명시 보존 범위 변경이나 필수 기능·검증의 축소가 필요하면 그 영향 작업만 별도로 검토한다.


## 구현 진행 기록

- 승인 후 `impl-r1` 실행을 생성 전에 등록했다. 루트: `artifacts/tasks/DM-01-boundary-reform/runs/impl-r1`.
- 이전 deploy-r2는 보존된 전체 프로세스 종료 증거와 실제 native exit 1을 사용해 close했다. 사용자 취소 이유를 유지하고 성공으로 처리하지 않았다. lifecycle revision 5, failed, membership complete.
- artifact-run 집중 검사 exit 0, scheduler 집중 검사 15개 exit 0. 공통 Node 계약의 Windows 실행이며 다른 OS native 합격을 뜻하지 않는다.
- 영수증 통합 검사 첫 시도는 병행 구현 중인 deployment-workspace owner 파일이 아직 없어 실패했다. 파일 준비 후 영향 범위만 재검증한다. 합격 조건 변경은 없다.
- 새 입력은 기존 제품 기준과 정확한 tooling override 목록을 분리한다. 전체 최신 HEAD 기능을 선택하지 않는다.

- 검사 영수증 통합 회귀 재실행: 28/28, 실제 exit 0. 새 순서·이유·명령 불변 확인 포함. source selector 36/36 exit 0.
- 환경 실제 사전 검사 exit 0: 선택 Python SDK import, 자식 PATH의 SDK Python/Python/Cargo 조회. 저장공간 성장 추정은 아직 미확정이므로 저장공간 검사를 전체 합격으로 표시하지 않았다.
- Windows Git 경로 한도로 중첩 Git 메타데이터 이름을 줄였다. 독립 객체 저장소를 사용하며 alternates를 새로 추가하지 않는다. mutable source/control 멤버는 작업공간의 artifacts 하위 버전·캐시와 겹치지 않는다. 구조상 루트 `.git` 전달 파일은 보호 제어 증거로 별도 기록하며 이를 포함해 전체 작업공간을 삭제했다고 보고하지 않는다.

- 첫 DK 5묶음 apply는 삭제 전 차단됐다. root가 review/apply 중 project-maintenance.json에 새 관리 루트를 추가해 토큰이 무효화됐다. 실제 삭제 0건. 설정 고정 후 동일 대상만 새 review하여 재시도한다.

- 실제 메모리 확인: 총 약 32GiB 중 사용 가능 약 6GiB. 새 배포는 Cargo jobs=1, source concurrency=2로 준비한다. 독립 검사와 빌드의 병렬 실행은 이 자원 한도에서만 허용한다. 사용자 프로세스를 종료하지 않는다.
- known-signal 취소는 기존 failure/null 표현을 사용하도록 finish에 실제 signal 입력을 추가했고 집중 검사 exit 0. 신호 없는 취소 표시는 unknown을 유지한다.

- 경계 파일럿 6개를 실제 실행하고 native grouped review/apply했다. success/failure/retry/실제 SIGTERM 4개는 실제 부재 확인 후 finalize했다. 과거 unknown 취소와 stop-proof 누락 2개는 원래 결과를 보존해 defer했다. 증거: impl-r1/reports/pilot-six-cleanup.json, pilot-six-finalize.json.
- 첫 mutable workspace artifacts/workspaces/a는 소켓 사전 검사에서 중단됐고, 수정 적용 입력은 artifacts/workspaces/b의 fresh 세대를 사용한다. 이름은 소유 판정에 사용하지 않고 독립 manifest와 run 식별값으로 묶는다.
- RetainedSourceRoot 패키징 회귀 6/6과 PowerShell AST 검사 실제 exit0. 다른 소스와 복사 중 변경을 거부한다. 배포의 source preflight/native 입력은 mutable 경로로 일치시키고 최종 build-info만 검증된 보존 경로를 기록한다. Windows 필수 lifecycle gate에 PackagingOnly 회귀를 연결했다.
- 실제 Windows 사전 검사에서 신규 fixture/state 소켓이109바이트로107바이트 제한을 넘었다. 8.3 표기도 .NET에서 확장되어 해결되지 않았다. 명시적 VerificationFixtureRoot에서만 상태 하위 이름을 s로 줄이고 기본 state 경로를 유지했다. 실제 guard109거부/105허용·기본 설치·짧은 fixture 설치 3개 회귀 exit0. 제품 컴파일은 시작하지 않았다. 실패 세대의 payload는 검증 증거를 impl-r1/reports/failed-w13a로 보존한 뒤 재검토·삭제하며 새 입력 세대를 만든다.

- 새 mutable 소스에는 무시된 node_modules가 포함되지 않는다. 고정 제품 기준 c23b의 package-lock SHA 일치 확인 후 기존 검증 의존성을 독립 복사하고, 전체 파일·링크 inventory의 복사 전/후 일치 및 TypeScript/node-pty 실제 로딩을 검증한다. mutable extensions 멤버가 이를 소유하며 immutable input에는 넣지 않는다. 지침 테스트의 고정 release assets는 기존 보호 경로를 명시한다.

- 실패 입력/작업 소스 2그룹 24멤버가 native apply에서 모두 deleted·remaining=false로 확인됐고 지원 finalize를 완료했다. 논리 크기 1,299,421,981바이트이며 전체 작업 컨테이너의 보호 Git 전달 파일까지 삭제했다는 뜻은 아니다. 검토/삭제/종료 근거는 impl-r1/reports/failed-generation-*.json에 보존했다.
- native project_build 경계는 실제 10초 후 exit124로 종료해 장기 배포에 사용할 수 없었다. 실패 영수증을 보존하고 해당 일회성 bundle만 제거했다. 장기 실행은 동일 고정 입력 검증을 유지하는 기존 command 세션과 실제 child close 증거로 추적한다. 새 입력 준비 windows-r3를 시작했다.

- windows-r3 입력 준비 실제 exit0. project SHA ddcd1246ec190243e4bc66a35056e8e4ac9a19b4b8395b14b693f254ec4e4aa5. helper 준비 926,538ms, 의존성 독립 복사·세 번 inventory 비교 152,412ms, 최종 immutable/working 검증 통과. 프로세스 생성16:12:17~producer 영수증16:31:06 기준 전체 준비 약18분49초. source-dependencies.json에 13,325파일/1,522디렉터리와 로딩 증거 보존.
- 2026-10-23 16:32 UTC windows-controller-w13b 장기 세션28366 시작. 공유 Cargo owner API exists=false 및 Cargo/rustc/link 프로세스 없음 확인. 기존 PS7/runtime 소비 참조를 지원 API로 windows-r3에 추가했다. 설치 목표2026.0.12이며 NoLaunch/reload-required 계약을 유지한다.

- windows-r3 배포는 cache preflight에서 실제 exit1: 공유 module cache registry에 이미 사라진 artifacts/w31b가 남아 사용을 차단했다. controller 전후 소스 검증 통과, 제품 컴파일 미시작. 원시 registry를 수정하거나 legacy 보호를 해제하지 않았다.
- 16:36 UTC windows-r4 / w13c-99afefb1 재시도는 같은 고정 소스를 재사용하고 기존 공개 인수로 module/Cargo verification/namespace cache owner를 working project로 분리했다. 공유 Cargo compilation target은 유지한다. 초기 캐시 생성 비용과 legacy 복구·입력 재복사의 비용을 비교해 분리를 선택했으며 실제 비용은 실행 결과로 남긴다. fixture는 fresh artifacts/x를 사용한다. primary run의 지속 input 참조를 추가해 catalog 경계 사이에 자동 보호가 전파된다고 가정하지 않는다.

- windows-r4는 fixture 이름 계약(artifacts/v 또는 v- 접두사)에 맞지 않는 x를 지정해 producer 시작 전에 exit1로 끝났다. windows-r5는 사전 환경·의존성 준비 exit0 이후 전체 manifest의 고정 UI 자료가 작업 사본에 없어 exit1이었다. 두 시도 모두 제품 컴파일 전이며 controller의 입력 전후 검증은 통과했다.
- 고정 UI 19,632파일/117디렉터리/링크0을 독립 복사하고 원본 전후·복사본 inventory 일치 및 77기능 manifest 검증을 확인했다(exit0, 약8분15초). 증거 pinned-ui-copy.json.
- 8GiB 여유 공간 기준을 유지하기 위해 새 고정 입력·작업 소스·독립 복사한 UI/의존성과 작업 소유의 PS7 도구 사본에 NTFS 일반 압축을 적용했다. 파일 내용 보존을 전체 입력/소스/UI 해시로 재검증하며, PS7 실행 파일 SHA256은 기존 값과 일치한다. 사용자 원본·System·ACL은 변경하지 않는다. 압축은 물리 저장량 최적화이며 삭제 회수량에 합산하지 않는다. windows-r6/w13e는 검증 및 공간 기준 충족 후 실행한다.
- 압축 후 전체 입력/작업 소스/UI 검증은 17:08:11~17:09:23 UTC, exit0. project SHA와 UI inventory는 기존 값 그대로다. 8GiB 기준 충족, 공유 Cargo owner 미점유 및 cargo/rustc/link 미실행을 확인한 뒤 windows-r6 / w13e controller 세션52430을 시작했다. UI 준비 lifecycle은 실제 leaf 종료 증거로 complete revision2로 닫았고 배포 실행 참조는 유지한다.
