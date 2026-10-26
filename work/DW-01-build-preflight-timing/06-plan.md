상태: 승인된 초기 캐시 정리 잠금 통합·네 가지 테스트 축소, 최종 회귀와 생성물 정리 완료. 전체 실행 시간 단축은 이번 비교에서 확인되지 않았다. 추가 사용자 결정 없음.

# 캐시 회귀 테스트의 반복 해시와 프로세스 실행 최적화

- 승인: 사용자 선택 3번(반복 해시·Node 실행 감소) 개선 및 불필요한 코드·중복 검증·생성물 정리. 기존 2회 비교 원칙을 유지한다. 전체 앱 빌드나 설치, 검사 생략은 제외한다.
- 범위: 공통 Node cache regression fixture인 scripts/test-feature-preservation-cache.cjs. 생산 feature-preservation의 실제 입력·실행·캐시 guard는 바꾸지 않는다. 실제 검증은 로컬 Windows x64/Node26.7.0이며 Linux/macOS 실행은 미검증이다.
- 방식: 기존 setupV2의 작은 TypeScript package 구성을 공통 fixture helper로 재사용한다. 캐시 의미만 검증하는 경우 injected execute가 call/hook/로그/result를 유지하도록 하며, 실제 Node 실행·stdout/stderr·실패 exit·복사 runtime 실행을 검증하는 명시적 통합 사례는 유지한다. 불필요한 실제 compiler copy·child start를 없애되 실행 중 변이, compiler entry/형제 파일, 환경·runner·contract 변이, lease/실패/오염 evidence 계약을 보존한다.
- 순서/소유: root가 변경 전 전체 cache fixture 파일을 같은 설정으로 2회 순차 실행·입력 hash와 상태를 확인한다. 소유 worker는 이 결과까지 source를 쓰지 않는다. 이후 worker가 해당 테스트 파일만 수정하고 root가 owning 문서·검증·정리를 통합한다. 컴파일/다른 무거운 검사를 동시에 돌리지 않는다.
- 기존 scripts/test-project-maintenance.cjs에는 동시 owner의 11줄 변경이 있어 건드리지 않는다. 이전 source-tests 실패 수정이나 원래 130개 전체 source gate 통과는 이번 수용 범위와 구분한다.
- 검증: before/after 같은 Node invocation 및 환경으로 cache fixture 각2회, 실제 test count/pass/fail/skip와 로그 보존. 관련 feature-preservation 기존 파일 전체도 실행하여 fresh mutation/real invocation 계약을 확인한다. 영향 없는 앱 빌드/제품 provenance/native Cargo는 반복하지 않는다.
- 생성 전 run:DW-06:cache-fixtures, artifacts/tasks/dw06-cache 및 짧은 TEMP artifacts/tasks/tw06를 선언했다. root가 producer 종료·membership을 조정하고 설치한 최적화 maintenance_owner로 등록/review/apply·부재/finalize를 확인한다. 이번 archive 보존 예외는 없다. 필요한 정량 근거는 본 기록에 보존하고 모든 disposable fixture/cache/source/log를 삭제한다. .git/dw06-*.json 및 plan body는 임시 제어 자료로 쓰고 일반 삭제한다.
- 변경 전 첫 점검60초, 이후5분. 완료·실패 신호를 기다리며 중복 실행하지 않는다. 작업 끝에는 이번 파일/문서만 task commit하고 기존 index와 동시 작업을 보존한다.

## 수행 근거

- 변경 전 동일 파일 2회: 231.6458225초, 249.4411732초, 평균 240.54349785초. 각각 19개 통과, 실패/skip/cancel 0, 실제 exit 0. 측정 중 선택 입력은 바뀌지 않았다.
- 변경 전 실행 구간: 2026-10-26T11:20:48.386Z~11:28:49.485Z. 완료 신호 이후 root 자동 재개가 fallback 시각까지 늦어져 약17분의 조정 대기가 추가되었다. 이 지연은 테스트 측정 시간에 포함하지 않는다.
- 소유 worker는 변경 전 완료 후 scripts/test-feature-preservation-cache.cjs만 수정했다. 기존 작은 TypeScript fixture를 공통 helper로 추출하고 전체 설치 compiler 반복 해시/복사를 대체했다. 캐시 전용 사례는 주입 실행기를 사용하며 복사 Node 실행, 실제 exit7/복구 exit0, stdout/stderr 검증은 유지·보강했다. 기존 테스트 사례와 무효화/변이 assertions는 보존했다.
- root가 범위 diff를 검토한 뒤 변경 후 동일 명령의 2회 순차 실행을 시작했다. 생산 동작이나 cache identity 정책 변경이 없어 architecture 계약 변경은 없다.

## 측정·수용 결과

Windows x64, Node v26.7.0에서 같은 명령 `node --test --test-reporter=spec scripts/test-feature-preservation-cache.cjs`를 순차 실행했다. 같은 짧은 TEMP root 아래 phase별 새 fixture를 만들었고, 다른 무거운 검사를 병행하지 않았다. 각 실행의 단조 시계 wall time이며 컴파일·root 대기·정리 시간은 포함하지 않는다.

| 구분 | 1회 | 2회 | 평균 |
| --- | ---: | ---: | ---: |
| 변경 전 | 231.6458225초 | 249.4411732초 | 240.54349785초 |
| 변경 후 | 166.7758571초 | 167.5609474초 | 167.16840225초 |

- 평균 73.3750956초(30.5038782%) 감소, 약1.439배. 이 수치는 캐시 테스트 파일 전체에 한정하며 130개 전체 source gate나 앱 빌드 개선율이 아니다.
- 변경 후 실행 구간: 2026-10-26T11:49:00.308Z~11:54:34.651Z. 변경 전후 각2회 모두 19 tests /19 pass /0 fail /0 skipped /0 cancelled, 실제 exit0, signal/error 없음. 각 측정 중 선택 입력 불변을 확인했다. before/after 선택 dependency closure의 차이는 수정한 테스트 파일 하나뿐이었다.
- 관련 전체 회귀 `node --test --test-reporter=spec scripts/test-feature-preservation.cjs`: 23 tests /23 pass /0 fail /0 skipped /0 cancelled, 실제 exit0, 24.0035852초(2026-10-26T11:54:38.127Z~11:55:02.133Z). 선택 입력 불변을 확인했다.
- 선택 입력 digest: before `b27b382bfe7aa1df0ec7a4dbd41674b3d459b3d24b27bcf0690e5987286a4bb8`; after `17b8705c0f0bed8df4bb69cd55c93ad5f3ef89c8cb3fa5b23fd1025d77ad183c`; related `e2910c8f887f888d5c42373996572d9739c0d4a97447aae57ad5e1456d3bea63`.
- 기존 19개 캐시 테스트는 모두 현재 무효화·실패·변이 계약을 보호하므로 삭제하지 않았다. 설치 compiler 의존·큰 복사본·중복 fixture 작성·캐시 전용 자식 실행을 제거했다. 실제 프로세스 검증은 유지했다. 지속 회귀 파일 외에 측정용 controller·로그·fixture·캐시는 남기지 않는다.
- 원시 근거는 `artifacts/tasks/dw06-cache/{inputs,reports,logs}`에서 검토했다. 필요한 결과를 이 기록에 옮겼으며 원시 묶음은 정리 대상이다. Linux/macOS 실행, 전체 source gate, 제품 빌드·설치는 이번에 수행하지 않았다. 이전 전체 source gate 실패 해결을 이번 통과로 주장하지 않는다.

## 정리·인수

- 성공한 producer의 실제 종료를 확인하고 lifecycle을 close했다. 설치된 `maintenance-owner-6f6f874e-win-x64-dx05`의 실행파일 SHA256 `6ffd3d7e5787439381740a8bb3a32a7f4d4ab0d91beba4ee145c954287a06a96`을 확인한 뒤 inventory→소유 그룹 등록→registered review→fresh token apply를 수행했다. 완결 구성원2개, 참조/보호 blocker 없음.
- `artifacts/tasks/dw06-cache`와 `artifacts/tasks/tw06` 삭제 실제 exit0, 30.9575013초. 두 결과 모두 deleted/remaining:false/error:null, aborted:false. 두 경로의 실제 부재와 lifecycle finalize(finalized, remaining/references/blockers 모두 빈 배열), registry 파일 부재를 확인했다. `.git/dw06-*` 임시 제어 파일도 일반 삭제 후 부재를 확인했다. 이번 생성물의 보존·archive 예외는 없다.
- `node --check`와 최종 범위 `git diff --check` exit0. 측정 전후 기존 전체 index SHA256 `c1791f8cb7539c159bdc1b3ef2960244b84588a09c519058bd97e993ca9cbc72`가 같았다. 이번 source/기록 두 파일만 task commit 대상으로 삼고 기존 동시 변경과 staged 항목을 보존한다.

## 추가 개선 가능성: 분석만 수행

- 요청 범위: 167.17초 이후 추가 개선 후보 분석. 코드 수정·전체 테스트 재실행·제품 빌드 없이 호출 경로와 읽기 전용 소규모 측정으로 확인했다. 생성 파일·로그·fixture는 없다. 공통 Node 동작을 대상으로 하되 측정 환경은 앞과 같은 Windows x64이다.
- Node 실행파일은 103,173,960바이트이다. 현재 `fileHash`와 같은 readFile+SHA256을 5회 측정하면 219.94~242.88ms, 메모리에 미리 읽은 같은 bytes의 SHA256만 계산하면 177.98~191.48ms였다. 두 실험은 별개이며 정확한 차감 분석은 아니다. 실제 해시 계산 자체의 비용도 크므로 스트림 전환이나 읽기 최적화만으로 큰 감소를 보장할 수 없다. 공통 runner 3개 파일의 getDirectoryState는 5회 중 1.76~4.95ms였다. 전체 167.17초에서 차지하는 비율은 새 프로파일을 실행하지 않아 미확인이다.
- 우선 후보: `verification-result-cache.cjs`에서 최초 obsolete/removed prune가 lifecycle 잠금을 별도로 획득하고, 각 begin과 close도 obsolete 정리를 반복한다. 초기 두 정리를 같은 transaction으로 합치고 같은 보호 구간의 중복 directory/owner 관측을 줄일 여지가 있다. 다른 프로세스의 변경과 마지막 lease 해제 후 정리를 놓치지 않아야 한다. 기존 contention·abandoned owner·release 실패·안전한 삭제 계약을 유지하는 회귀가 필요하다. 개선율은 미측정이다.
- 다음 후보: `sourceExecutionIdentity`와 `sourceCacheRuntime`가 source phase의 같은 검증 경계에서 각각 Node를 해시한다. 하나의 검증 시점에 필요한 공통 Node 관측/선언 파일 상태를 공유할 수 있는지 검토할 수 있다. 다음 check의 publish와 최종 gate에서는 새 관측을 수행해야 한다. 프로세스 수명 전체의 메모이제이션이나 mtime/size만으로 내용 동일성을 가정하는 방식은 현재 계약과 맞지 않는다. 앞선 cache fixture는 기본 all phase이므로 이 개선의 전체 파일 효과는 별도 확인해야 한다.
- 테스트 전용 후보: rename 재시도·영수증 게시 등 한 기능만 확인하는 사례에도 동일한 5-feature setup이 쓰인다. 해당 사례만 최소 manifest로 줄이고, 선택 무효화/실패 후 독립 통과 evidence/동시 lease 검사는 복수 feature를 유지하는 방법이 있다. 불필요한 준비를 줄이는 후보이며 검사 자체 삭제를 뜻하지 않는다. 개선율은 미측정이다.
- 우선순위는 캐시 정리 transaction 중복 축소, 검증 시점별 공통 관측 공유, 단일 목적 fixture 최소화이다. 실제 개선율 판단에는 항목별 계측과 같은 범위의 2회 비교가 필요하며, 167.17초 전체가 제거 가능한 비용이라고 주장하지 않는다. 이번에는 제품 정책·검사 범위·architecture 계약을 변경하지 않았다.

### 테스트 축소의 구체 후보

- schema2 aggregate 변이 사례는 gate9회, 별도 actual compiler 변이 사례는 gate7회이다. 공통 cold/hit 통합 검증을 유지하고 각 변이 뒤의 추가 warm 재실행3회+2회를 직접적인 새 key/게시 evidence 검증으로 대체하면 해당 두 사례 합계16회를11회로 줄일 후보가 된다. 변이별 재사용 보장을 대체 검증 없이 삭제해도 된다는 결론은 아니며, 실제 시간 절감은 미측정이다.
- 손상 로그의 low-level miss 처리는 `test-verification-result-cache.cjs`에도 있다. cache gate 통합 사례는 malformed receipt로 miss→실제 재실행을 대표 검증하고, 로그 손상의 여러 변형은 owner 단위 테스트에 맡기는 통합 후보가 있다. 기존 복사 로그 독립성과 입력 변이 검증은 별도 계약이라 유지해야 한다.
- schema1 실패/복구에서 실제 Node의 exit7/exit0 및 stdout/stderr를 검증한다. schema2의 같은 실제 child 실행2회는 주입 결과로 대체하고 schema2 runtime 변이와 이전 독립 통과 evidence 보존 검증을 유지할 후보가 있다. 전체 gate 횟수는 그대로이고 child 시작 비용만 감소한다.
- manifest shape 검증과 receipt rename 정책 사례는 전체 5-feature fixture 대신 해당 계약에 필요한 최소 manifest/파일만 준비할 후보이다. malformed schema/fields 각각의 거부, 고정 checkpoint bytes 재시도, 이후 checkpoint 게시 검증은 유지해야 한다.
- package binding과 verifyReceipt, 실행 중 변이와 cache hit 이후 변이, 동일 compiler root와 별도 compiler root는 서로 다른 경로를 검증하므로 제목이나 유사 assertion만으로 삭제하지 않는다. 분석은 기존 세 파일의 해당 사례를 읽어 수행했고 제품/테스트 코드·생성물 변경과 새 성능 측정은 없다.

## 승인된 후속 구현

- 범위: 초기 obsolete/removed cache 정리 두 작업을 동일 lifecycle 잠금으로 통합하고 source/native/Cargo 초기 호출에 연결한다. 기존 개별 API, begin/close의 정리, 마지막 lease 해제 후 정리, 외부/미확인 소유 보호, 안전한 삭제와 현재 검증 시점은 유지한다. runtime 해시 정책 변경은 제외한다.
- 새 `prune(options)`는 active check IDs를 검증하고 기존 잠금 하나 안에서 두 정리를 순서대로 수행한다. 각 작업의 오류를 defer하며 잠금을 안전하게 해제한다. 기존 개별 API는 유지한다. 생산 동작의 허용 범위나 캐시 보호 의미가 바뀌지 않아 architecture 계약 수정은 필요하지 않다. 현재 다른 owner가 수정 중인 upstream-preservation 문서는 건드리지 않는다.
- 테스트 축소: schema2 중간 warm gate5회는 새 key·실제 owner hit·로그 digest 검증으로 대체한다. 통합 손상 로그 변형은 owner 테스트에 맡기고 malformed receipt의 재실행 경로·복사 로그 독립성을 유지한다. schema2 child 실패/복구2회는 주입 결과로 대체하고 schema1 실제 stdout/stderr/exit 검증을 유지한다. manifest/rename 사례는 필요한 최소 fixture를 사용한다. 다중 feature 선택·독립 통과·동시 lease·실행 중/재사용 이후 변이는 유지한다.
- 소유: cache fixture worker는 test-feature-preservation-cache.cjs만, prune worker는 verification-result-cache.cjs와 source/native/Cargo 호출자4개 파일만 수정한다. root는 combined prune의 behavioral 회귀, 통합 검토·측정·정리·task commit을 소유한다. root가 요구한 API와 보존 의미는 확정됐으며 병렬 구현 가능하다. children 추가 위임과 앱 빌드/설치는 하지 않는다.
- 변경 전 기준 재사용: 현재 전체 선택 dependency closure digest가 직전 after의 `17b8705c0f0bed8df4bb69cd55c93ad5f3ef89c8cb3fa5b23fd1025d77ad183c`와 정확히 같고 Windows x64/Node26.7.0도 같다. 직전2회 166.7758571/167.5609474초(평균167.16840225초)를 기준으로 재사용한다. 이번 after는 동일 명령·동등한 짧은 project-local TEMP 설정으로2회 순차 실행하며 별도 시점 비교임을 표시한다.
- 생성 전 선언: run:DW-06:cache-reduction2, owner DW-06; artifacts/tasks/dw06-reduce-20261026에 입력·보고서·로그·controller, artifacts/tasks/twr6에 fixture·TEMP를 둔다. 모든 producer의 actual 종료 후 설치된 최적화 owner로 등록/review/apply/finalize·실제 부재를 확인한다. 이번에도 archive/보존 예외는 없다. 작은 .git/dw06r-* 제어 파일은 사용 직후 일반 삭제한다.
- 검증: changed 파일 syntax/diff, combined prune의 실제 obsolete+removed 정리/한 잠금/활성 보호/미확인 잠금/단계별 오류·release 회귀, 전체 storage owner·cache fixture·preservation·native/Cargo cache 관련 회귀를 선택한다. 후속 source 안정 시 cache fixture부터 장시간2회 측정하고 다른 무거운 검사는 순차 실행한다. 실제 exit/로그/count·입력 불변을 확인한다. 실제 환경은 Windows x64이며 Linux/macOS 실행과 전체130파일 gate는 미검증으로 남긴다.

### 후속 구현·검증 상태

- 초기 source/native/Cargo 정리 쌍을 공통 prune로 연결했다. 기존 개별 API와 마지막 pruneRemovedChecks, begin/close는 유지했다. 정리 실패 후에도 다음 작업 전에 동일 lease 소유를 다시 확인한다.
- 캐시 테스트 전체 gate 실행7회와 schema2 실제 child2회를 제거했다. 중간 warm5회는 실제 storage hit와 게시/복사 로그 digest 검사로 대체했고, 손상 receipt의 정확한 fresh 호출을 보강했다. 최소 fixture는 가진 feature 영역으로 검증 범위를 설정한다. 기존 19개 사례와 중요한 실행/변이 경계는 유지한다.
- 첫 after 시도는 225.7374943초, 실제 exit1, 18pass/1fail였다. 축소 rename fixture의 area가 all로 남아 engine이 없는데 전체 영역을 요구한 설정 오류였다. 제품의 mandatory area 검사를 유지하고 fixture 영역만 수정했다. 실패 결과를 reports/after.json에 별도 보존하고 속도 비교에서 제외한다. 수정 후 rename3개 집중 검사 exit0(3.6226978초), 3pass/0fail. 새 input identity와 after-v2 경로로 전체2회 검증을 시작했다. 기존 failed 입력/로그는 덮어쓰지 않았다.
- storage owner의 기존 지속 회귀에 combined prune의 네 가지 행동 검사를 추가했다: 동일 소유로 두 정리 수행/남길 증거 재사용, 활성 lease와 마지막 해제 정리, 각 scan 오류의 독립성과 재시도, invalid IDs 및 미확인 lifecycle 보호. 새 공통 API의 동시성·실패 계약을 계속 보호하므로 이 네 사례는 유지하며 측정용 임시 검사는 정리한다.

### 후속 측정 결과

- 수정 후 전체 cache fixture2회 모두 실제 exit0, 각19pass/0fail/0skipped/0cancelled, 실행 중 선택 입력 불변. 174.7817367초(12:15:15.681Z~12:18:10.464Z), 171.4133339초(12:18:10.470Z~12:21:01.883Z), 평균173.0975353초. 날짜는 위와 같은2026-10-26 UTC이다. 선택 입력 digest `21ffb1471d840b2ca900f7dc81e23d2699e06d814f5005b9daf86306c18d0875`.
- 지난 동일 입력 기준 평균167.16840225초보다5.92913305초(+3.54680249%) 길었다. 별도 시점의2회 비교에서 전체 시간 단축은 확인되지 않았다. 첫 실패 실행225.7374943초는 제외했다. 전체 gate7회·실제 child2회와 초기 정리 lease 획득2회→1회 감소는 구현/행동 회귀로 확인했지만 시간 개선율로 대체하지 않는다.
- storage 전체33개(actual exit0,52.2531575초), preservation 전체23개(actual exit0,26.3506659초), native 전체18개(actual exit0,359.040361초)가 통과했다. source 입력은 각 실행 중 불변이었다.
- 성능 비교 종료 후 native와 Cargo 회귀는 독립 fixture/캐시를 사용하고 CPU약20%, 여유 메모리약5.6GiB를 확인하여 병행했다. 이 시간은 합산해 총 경과 시간으로 보고하지 않는다. Cargo 첫 시도는 기본PATH에서 기존 Python을 찾지 못해 actual exit1(128.4320205초)이었다. Python3.12.10과 isolated tomllib 실행을 확인하고 Cargo child 환경에만 해당 설치 경로를 추가해 cargo-v2로 재실행했다. 제품 코드·사용자 PATH는 변경하지 않았고 원시 실패 결과는 별도 보존했다.
- Cargo 첫 시도는20개 중15pass/5fail였고, 환경 수정 후 cargo-v2는20pass/0fail/0skipped/0cancelled, actual exit0,103.3073358초였다. 실제 Cargo 빌드·명령 그룹 실행은 하지 않았으며 cache owner/키/게이트 fixture 회귀이다. 캐시 파일19개 테스트2회, storage33개, preservation23개, native18개, Cargo20개가 최종 통과했다. 각 실제 명령과 outcome/input digest는 run의 reports/logs에서 검토했고 필요한 결과를 본 기록에 보존했다.
- 생성물 원시 보고서에는 최초 cache after(exit1)와 Cargo(exit1)를 실패 그대로 남겼고 최종 통과 시도는 별도 이름으로 기록했다. 모든 동기 자식 종료와 두 worker의 final을 확인해 작업 lifecycle을 close했다. 기존 native inventory를 전체 페이지로 조회해 새 두 root와 충돌하는 등록 항목이 없음을 확인한 뒤 완결 그룹으로 등록했다. 이 원시 묶음은 최종 검토 후 삭제한다.

### 후속 정리·인수 완료

- 고정 SHA256으로 확인한 기존 최적화 maintenance_owner를 사용했다. 두 구성원을 registered review에서 blocker/참조 없음으로 확인하고 fresh token으로 동일 delete 결정을 적용했다. actual exit0,29.1705465초, aborted:false, 구성원 모두 deleted/remaining:false/error:null이었다.
- `artifacts/tasks/dw06-reduce-20261026`과 `artifacts/tasks/twr6`의 실제 부재를 확인했다. lifecycle은 finalized, remaining/references/blockers 모두 빈 배열이고 registry 파일도 없다. `.git/dw06r-*` 제어 파일9개를 일반 삭제하고 부재를 확인했다. 최초 실패 자료를 포함한 이번 fixture/cache/source 복사/controller/원시 로그를 남기지 않았고 보존·archive 예외도 없다.
- 관련 source6개 syntax와 최종 범위 diff 검사 exit0. task commit 직전 기존 전체 index SHA256이 시작 때의 `3228487c3dddf372d80714d63dffdda5e6b3a78574d5ce8d4d1d2a835eec33b7`와 같았다. source6개와 이 기록만 task commit하며 다른 owner의 architecture 문서와 기존 변경은 보존한다. 제품 빌드/설치 및 다른 OS 실행, 전체130파일 gate는 수행하지 않았다.
