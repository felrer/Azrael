상태: 수정·회귀 검증·생성물 정리 완료. 사용자 추가 결정 없음.

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
