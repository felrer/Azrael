상태: 승인된 구버전 정리 재개. 내부 하드링크·검증된 테스트 junction 지원을 수정·검증 중. 외부 av17/av18 확장 및 연결 빌드 u17a/u22c는 사용자 결정에 따라 보존한다.

## 목표와 권한
프로젝트 전체 논리 사용량과 캐시 비중 조사에 이어, 승인된 2026.0.10 이하 로그·산출물과 별도 승인된 세 구 빌드를 안전하게 정리한다. 외부 av17/av18 확장과 연결 빌드 및 필수 의존성은 보존한다. 앱 종료, 제품 빌드·설치·사용자 설정 변경은 수행하지 않는다. 정리에 필요한 Windows 도구의 내부 하드링크·검증된 테스트 junction 지원 수정과 검증은 승인되었다.

## 범위·방법·완료 기준
Windows x64 현재 checkout 내부 전체를 대상으로 한다. 외부 사용자 프로필·전역 Cargo 캐시·원격 저장소는 제외한다. 이전 조사는 등록 경로를 제외해 전체 크기가 아니었다. native 목록의 기존 크기는 참고하고, 새로운 전체 구성비·버전별 크기·긴 경로 누락 해소를 위해 전체 파일 metadata만 한 번 조사한다. 소유·참조 검사를 반복하거나 payload 해시는 읽지 않는다. 재분석 지점은 따라가지 않는다.
앱 버전은 canonical release 설정 및 producer/version 기록으로 판별한다. engine/package 버전 0.162.0/0.4.0과 구분한다. 단일 과거 버전으로 확인된 묶음, 혼합·미분류 항목, 현재 소비자가 있는 항목을 구분한다. 캐시와 과거 버전 제거량의 교집합을 별도 집계해 중복 합산하지 않는다. 실제 할당·하드링크 확인 범위와 오차를 명시한다. Windows 정리 도구 변경은 기존 `tool.project-maintenance` 소유 코드·회귀 및 architecture/project-maintenance.md에 연결하며 앱 런타임은 변경하지 않는다.

## 실행
/root가 소유 분류 입력 준비 → 긴 경로를 지원하는 전체 metadata 집계 → 버전·캐시 비중 및 삭제 가정 검증 → 결과 보고를 수행한다. 입력·도구·로그·결과는 새 조사 run으로 귀속하며 기존 작업의 기록과 대상 payload는 변경하지 않는다.

## 결과와 근거

독립적으로 읽을 수 있는 [전체 보고서](../../artifacts/tasks/DH-01-project-storage-review/runs/full-storage-v1/report.md), [수치 요약](../../artifacts/tasks/DH-01-project-storage-review/runs/full-storage-v1/summary.json), [버전·캐시 분석](../../artifacts/tasks/DH-01-project-storage-review/runs/full-storage-v1/analysis.json)이 결과를 소유한다. 생성 전 `/root` 소유 `run:DH-01-project-storage-review:full-storage-v1`로 이 run의 보고서 경계를 기록했다.

| 구분 | 논리 크기 GiB | 전체 비중 |
| --- | ---: | ---: |
| Rust 컴파일 캐시 | 422.19 | 61.47% |
| 기타 식별 캐시 | 8.39 | 1.22% |
| 설치 의존성 node_modules | 17.23 | 2.51% |
| 나머지 소스·고정 사본·패키지·로그 등 | 238.95 | 34.79% |

큰 경계는 artifacts 394.63 GiB, engine 290.39 GiB다. 위 비율은 경로별 파일 크기 기준이며 하드링크를 한 번만 세는 실할당량 비율은 아니다. 2026.0.10 이하로 확인된 51개 구간의 174.11 GiB에는 캐시 30.44 GiB와 나머지 143.67 GiB가 포함된다. 구버전 제거량과 전체 캐시를 그대로 더하지 않는다. 이를 제거한 뒤에도 논리 512.65 GiB와 캐시 400.14 GiB(잔여의 78.05%)가 남는다. 주 Cargo target 290.21 GiB 및 별도 da1/AK 캐시 101.64 GiB가 큰 후속 검토 대상이며 이번에 삭제하지 않았다.

실제 회수 추정은 파일 데이터 할당 기준 162.37~175.06 GiB다. 1 MiB 이상 파일의 최초 조회에 16 KiB~1 MiB 미만 과거 파일 319,502개의 추가 조회를 결합했고, 선택한 모든 과거 경로가 마지막 링크를 제거하는 경우만 하드링크 회수로 계산했다. 16 KiB 미만 파일의 잔여 할당 상한 12.69 GiB, 디렉터리/MFT metadata와 비원자적 관측 때문에 단일 정확값으로 보장하지 않는다.

버전 미분류 artifacts 150.54 GiB에는 진행 중 da1 검증 61.47 GiB, AK 검증 41.80 GiB, 도구 17.17 GiB, 공용 UI 입력 5.83 GiB 등이 있다. 이를 구버전으로 임의 분류하지 않았다. 일부 미분류 로그·잔여의 실제 앱 버전이 확인되면 과거 합계가 추가될 수 있으므로 174.11 GiB를 모든 구버전의 완전한 확정 총량으로 단정하지 않는다. `v11b`/`v11g`/`v11h`는 2026.0.11이므로 이 cutoff에서는 제외했다. 실제 확인 대상 앱 버전과 engine/companion의 0.162.0/0.4.0을 구분했고, fixture 안의 모의 버전은 부모 작업을 덮어쓰지 않도록 했다.

## 검증과 한계

- 전체 5,649,143 files/604,716 directories, 490.20초, 실제 exit 0. 파일 및 대형 파일 할당 조회 오류 0. 재분석 지점 470개는 따라가지 않았다. 새 조사 run 자체는 측정에서 제외했다.
- 과거 자료 추가 조회 254.10초, 실제 exit 0, 파일/할당 조회 오류 0. 과거 경로의 전후 파일 수 2,754,072개와 논리 크기가 정확히 일치했다. 버전 구간 음수·중복 및 전체 범주 합계 보존 검사도 통과했다. 로그는 run의 scan.log와 refine.log다. 제품 테스트/빌드/설치는 수행하지 않았다.
- Windows 기본 diskusage.exe는 관리자 권한을 요구해 probe exit 1로 실패했다. 권한 상승이나 우회는 시도하지 않았고 정상 권한으로 작동 확인한 Win32 metadata API만 사용했다. 도구 존재를 측정 성공으로 보고하지 않았다.
- 현재 실행 경로 조사에서는 b13(2026.0.11)만 참조되는 것으로 관측됐다. Git alternates·producer 소비 관계는 별도 근거에 보존했다. 이 관측은 실제 삭제 직전의 설치·실행·복구·공유 참조 검사 및 기존 유지보수 잠금의 해소를 대신하지 않는다.
- 원본 코드·로그·설정·사용자 상태를 삭제하지 않았다. 작은 조사 도구와 이 run의 기록만 추가했다. 외부 사용자 프로필·전역 캐시·원격 호스트는 제외했다. 파일 시스템은 계속 변할 수 있어 관측 이후 수치의 고정을 보장하지 않는다.
- 조사 명령은 모두 종료됐지만 lifecycle close 호출은 별도 `artifacts/maintenance/lifecycles/catalog.lock` 점유로 exit 1이었다. 30초의 파일 이벤트 대기 뒤에도 잠금이 남아 있어 강제 해제하지 않았다. native maintenance 잠금과 구분되는 잠금이며 결과 수치에는 영향을 주지 않는다. [마감 차단 기록](../../artifacts/tasks/DH-01-project-storage-review/runs/full-storage-v1/close-blocked.json)에 실제 종료 결과와 pending 수명 기록을 구분했다. 해당 소유자가 잠금을 정상 해제하면 최신 revision으로 수명 기록만 닫으면 되며 재측정은 필요하지 않다.

## 2026-10-23 구버전 전체 삭제 승인 후속

사용자 승인: “좋습니다. 우선 찾은 구버전의 파일들을 전부 삭제해주세요”. 위 분석의 2026.0.10 이하 51개 구간(논리 186,952,000,243 bytes)을 고정 삭제 범위로 사용한다. n10a는 캐시만이 아니라 해당 구버전 묶음 전체가 이제 승인되었다. 2026.0.11, 미분류, 공유 또는 현재 사용 항목은 확대 선택하지 않는다. 구현 스킬의 기존 정리 절차를 적용한다. Windows 로컬 생성물만 대상이며 제품 동작 변경·빌드·배포·사용자 프로세스 종료는 없다.

실행 순서: 현재 native 등록 묶음 검토 → 기존 producer 소유 묶음과 미등록 구간의 보호 상태 확인 → 보호 해소 및 지원 경로가 있는 완전한 묶음만 삭제 → 실제 결과/잔여 확인. 잠금·참조·멤버십 불확실성은 우회하지 않는다.

현재 근거: native 목록 437 items/251 groups를 전부 조회했다. 승인 구간과 겹치는 8개 native 묶음을 registered 모드로 재검토했으며 반환된 현재 항목 9개 모두 보호 사유가 있다. membership source 변경, 소유/사용 보호 미확인, 활성 또는 미확인 참조, native managed roots 밖 경로가 포함된다. approval50 묶음의 범위 밖 임시 경로는 확대 삭제하지 않는다. maintenance.lock은 pid=61016을 기록하며 실제 실행 중인 b13의 azrael.exe와 일치했다. catalog.lock도 남아 있다. 강제 잠금 해제나 임의 레지스트리 편집은 하지 않는다.

### 삭제 시도 결과

- 기존 소유 절차로 새 정리 run을 먼저 등록하려 했으나 catalog.lock의 EEXIST로 실제 exit 1. 새 payload/report 디렉터리는 만들지 않았다.
- native 재검토에서 반환된 9개 항목은 모두 보류 대상으로 판단했다. 각 현재 토큰으로 project_cleanup_apply에 보류 결정과 재검토 조건을 제출했으나 “exclusive maintenance lock unavailable (abandoned locks require explicit recovery): 파일이 있습니다. (os error 80)”로 호출 자체가 거부되었다. 결정 저장 및 삭제가 실행되었다고 취급하지 않는다.
- 기존 소유 catalog의 read-only plan 명령은 실제 exit 0으로 종료했다. stdout 선두 경고 때문에 JSON 소비에 실패했으므로 그 출력으로 삭제 가능 판정을 내리지 않았다. 재귀 payload 조사나 중복 plan 실행은 하지 않았다.
- 이 후속 작업의 파일 삭제는 0, 확보 공간은 0 GiB이다. 174.11 GiB는 승인 대상의 이전 논리 크기이며 실제 확보량이 아니다. 이전 파일 데이터 회수 추정 162.37~175.06 GiB도 실행 결과가 아니다.
- 다음 조건: 잠금 소유 작업의 정상 종료 또는 근거 있는 정식 복구 → producer 소유자의 membership/protection/consumer 참조 정합화 → 최신 native 검토 → 허용된 전체 묶음 삭제 및 잔여 검증. 사용자 삭제 승인은 유지하며 다시 요구하지 않는다. 프로세스 강제 종료, 잠금 파일 강제 삭제, 레지스트리 직접 수정, 보호 우회는 수행하지 않았다.
## 2026-10-23 잠금 해제·삭제 승인 후속 v2

사용자는 구버전의 잠금 해제와 삭제를 명시적으로 승인했다. 기존 51개 구간을 유지하고, 해당 구버전의 오래된 설치·증거 참조 해제는 현재 설치/실행 근거와 revision을 묶어 지원 API로 처리한다. 최신·공유·미분류 자료의 잠금은 이 승인으로 해제하지 않는다. 현재 maintenance.lock/catalog.lock은 외부 정상 작업 후 사라져 별도 해제하지 않았고 pid61016도 종료하지 않았다.

run:DH-01-project-storage-review:retire-old-v2를 pending으로 먼저 등록했다. 전체 프로세스 705개 스냅샷에서 구버전 경로 참조는 0이며 현재 사용자 VS Code 등록 설치는 2026.0.11/b13이다. 전체 producer plan은 기존 custody 묶음 때문에 현재 자료까지 확장되므로 그 확장 범위를 삭제하지 않는다. 독립되고 확인된 구버전 묶음부터 선택한다. 지원 owner 스크립트 실행을 위해 공식 PowerShell7.4.21 portable을 run 안에 임시로 받았고 공식 SHA256과 일치했다. 시스템 설치·PATH 변경 없이 사용 후 삭제한다.

### v2 중간 결과 및 재등록 판단 수정

- owner Apply 실제 exit 1. n9f는 deleted/remaining 없음으로 확인했고 해당 producer metadata도 정상 finalize되었다. 이전 구간 논리 크기 약 3.64 GiB. n10a는 전체 속성 검사 도중 읽기 전용 하드링크 차단으로 payload 삭제 전에 멈췄고 run evidence는 보존했다. fsutil hardlink list(actual exit0)는 문제 파일의 연결 3개 모두 n10a 안에 있음을 보였다. 기존 architecture는 하드링크 속성 변경을 일괄 차단하므로 정책·구현·테스트 변경에 대한 사용자 질문을 남겼고 답변 전에는 우회하지 않는다.
- w31b와 u23 작업은 복사 보존한 원래 terminal/cancellation 증거로 실제 실패 exit1을 유지하며 closeLifecycle 및 명시적 generated/protection 갱신을 완료했다. 추가 owner Apply가 진행 중이며 w31b도 동일한 읽기 전용 하드링크 검사에 막혔다. 미확인 단계의 null exit를 성공으로 고치지 않았다.
- u17a refresh 후 리뷰의 membership source unavailable에는 당시 owner Apply가 점유한 catalog.lock이 영향을 줄 수 있었다. 그런데 소유자가 변경된 것으로 해석해 전체 재등록을 시작한 것은 과도한 재측정이었다. 현재 실행 중인 호출의 실제 결과를 먼저 받으며 중복 등록을 하지 않는다. 또한 재등록 요청은 단일 source 파일을 지정했으나 현재 소스는 기존 producer_registry_v1 형식을 유지하고 flat directory를 요구한다. 런타임 결과를 확인한 뒤 기존 directory source의 refresh/review 경로로 재판단한다. 이 과정을 성공이나 삭제 완료로 보고하지 않는다.

## 재개 실행 범위와 의존성

사용자는 정리 도구 수정·검증 후 잔여 삭제를 승인했다. av17/av18의 확장·설정·인증·대화·세션 및 연결된 u17a/u22c 빌드는 보존한다. 원래 승인한 2026.0.10 이하 51구간과 별도 승인한 v11b/v11g/v11h의 범위를 유지한다. Windows x64 로컬 정리만 실행하며 제품 빌드·설치·프로세스 종료는 하지 않는다.

보존 빌드 u22c의 Git alternates 의존 경로 u21a→u20a→u19c→u19b→u18a-r2도 보존한다. 기존 조사와 현재 다섯 alternates 파일의 일치를 확인했다. 소스 Git 객체를 재배치하거나 기록된 의존성을 끊는 변경은 이번 정리에 포함하지 않는다. 근거: `resume-preserved-dependencies.json`.

/root/safe_cleanup_links는 scripts/artifact-lifecycle.ps1과 scripts/test-clean-verification-artifacts.ps1의 지원 코드·회귀만 소유한다. /root는 설치/실행/producer 참조 확인, 소유 문서, 실제 정리와 통합을 소유한다. 검증 완료 전 실제 새 링크 처리는 시작하지 않는다. 검증 로그·결과의 예정 경로는 기존 run:DH-01-project-storage-review:retire-old-v2 안의 tool-fix-validation/이다. 새 실행·검토 결과는 같은 run의 resume-* 경로에 기록한다. 기존 payload 전체 측정은 재실행하지 않는다.

현재 native grouped 검토는 v11b/v11g/v11h 두 묶음에 blocker가 없음을 반환했다. n9d/n9e는 생성·사용 보호 미확인 및 configured managed roots 밖, iy17a/e10은 managed roots 밖 등의 차단을 반환했다. 반환된 전체 묶음에 삭제/보류 결정을 제출했으나 두 적용 호출 모두 현재 엔진 pid61336의 maintenance.lock 점유로 EEXIST 거부되어 결정 저장·삭제가 실행되지 않았다. 같은 시점 catalog.lock도 OS 공유 검사에서 점유 상태였다. 잠금을 제거하거나 해당 차단을 우회하지 않는다.

실제 링크 처리의 입력은 기존 전체 조사 목록에서 선별한 정확한 79개 junction 경로이며, 현재 readlink 대상과 테스트 생성 코드의 예상 경로를 대조했다. `resume-verified-junctions.json`과 `resume-verify-junctions.cjs`가 이 확인을 보존한다. `resume-clean.ps1`은 기본 설치·av17·av18·shortcut·실행 프로세스와 producer 묶음 보호를 다시 확인한다. 검증 소스가 확정되면 기존 Windows cleanup mandatory check의 전체 commands를 `resume-windows-validation.cjs`로 실행한다.

필수 검증의 첫 실행은 PATH의 Python 누락으로 metrics 15/16 및 exit1이었다. 설치된 Python3.13.15를 자식 PATH에만 추가한 재검사는 metrics exit0이었다. 동시에 native apply와 검증의 metadata 기록이 catalog 잠금 경합을 일으켰으므로 이후 같은 공유 기록을 쓰는 작업은 순차 실행한다. native apply는 4묶음의 보류 결정을 저장했고 v11 두 묶음의 삭제는 stale token으로 attempted:false 차단했다. 검토 후 새 검증 producer 등록이 근거를 바꾸었으므로 검증 종료 후 새 토큰으로 처리한다.

필수 module-cache 회귀에서 기존 `Remove-OldBuildModuleCaches`의 `$Module` string[] 매개변수와 `$module` 지역 변수 충돌을 작은 재현으로 확인했다. 같은 변수로 취급되어 Join-Path ChildPath가 누락된다. 실제 moduleName을 그대로 전달하는 세 곳의 내부 수정만 적용하며 선택·소유·보호·삭제 정책은 유지한다. 첫 metrics 통과는 이 경로를 실행하지 않으므로 재사용하고 변경된 module-cache 전체 회귀부터 이어간다.

2026-10-22 19:15 UTC 검증 경계: metrics, module-cache 본 검사, RegistryOnly, engine-caches는 실제 exit0이다. LegacyRegistryOnly는 다른 작업의 실제 Rust 컴파일을 발견한 보호 규칙 때문에 차단되었으며 규칙을 완화하지 않는다. 배포 모의 verify-only는 기존 45초 제한으로 종료되어 `windows-tail-r1/logs/7.log`에 보존했고, 현재 Windows 정리 회귀가 끝난 뒤 순차 재시도한다. 삭제된 이전 멤버에 filesystem CheckMember를 호출해 연결 로그 삭제가 멈춘 통합 오류를 수정했으며, 후속 회귀 검증 중이다. 수정된 Node lifecycle은 `node-lifecycle-final-3.log`의 21/21, exit0이다. 실제 구버전에 수정 코드를 적용하기 전 필요한 검증을 계속한다. native refresh는 기존 maintenance.lock에 다시 차단되었으며 잠금이나 보호를 우회하지 않았다.

2026-10-22 19:23 UTC: 수정된 소스가 고정되었으며 legacy 52/52, 링크 보호 55/55, Node lifecycle 21/21 모두 exit0이다. Windows build-platform 단위 검사도 exit0이다. 정확한 다섯 후보의 `resume-preview-links-r1.log`는 모든 구성원의 selected를 확인했다. 이어진 `resume-apply-links-r1.log`는 다섯 후보 모두 catalog.lock 획득 전에 차단되었고 파일·속성 변경은 없었다. 배포 모의 재시도도 같은 catalog.lock에 차단되었다. 두 공유 잠금은 19:19 UTC에 새로 생성된 상태다. 다른 작업의 잠금을 제거하거나 도구 경계를 바꾸지 않는다. `resume-wait-locks.cjs`가 정확한 두 잠금 경로의 파일시스템 해제 이벤트를 기다리며, 완료 신호 뒤에 정상 도구 잠금을 다시 획득해 실제 삭제와 남은 검증을 이어간다. 후속 검증·metadata close·임시 도구 삭제·작업 커밋은 아직 완료되지 않았다.

잠금 해제 이벤트를 실제 관측한 뒤 19:24 UTC에 `links-r2`를 시작했다. 10분 점검에서 n10a는 연결된 `artifacts/tasks/windows-2026-0-10`의 미등록 테스트 junction으로 전체 묶음 사전검사 단계에서 차단됐고, w31b 및 연결 run은 deleted로 확인됐다(기존 논리 8,572,361,424 bytes). 원래 79개 링크 목록은 연결된 작업 기록의 링크 61개를 빠뜨렸으므로, 목록의 완전성 판단을 수정한다. 원본 조사 목록에서 version:w10a의 두 구성원 전체에 해당하는 89개 링크를 선택하고 현재 readlink 및 기존 테스트 생성 규칙과 일치함을 확인했다. 별도 `resume-verified-junctions-n10a-r3.json`과 재시도 스크립트를 준비했으며 실행 중인 r2 입력은 변경하지 않았다. 18개 관련 소스 해시도 변경 없음으로 확인했다. r2의 나머지 후보 결과와 실제 종료를 받은 후 정상 소유 잠금으로 n10a를 재시도한다. 미확인 outer terminal 및 미정리 참조 때문에 u17b-fixture/w09a는 close하지 않고 `resume-terminal-deferrals.json`에 재검토 조건을 기록했다.

독립 소스 검사도 병행했다. fail-fast/selection은 최초 52개 중 51개 통과, 임시 결과 파일 rename의 EPERM으로 1개 실패였다. 실패 항목을 포함한 동일 패턴 5개를 새 경로에서 재실행해 모두 exit0으로 확인했으며 코드는 바꾸지 않았다. 최초 EPERM 원인은 확정하지 않았고 로그를 보존한다. Windows 패키징은 26개, 실제 exit0이며 nativeUnixExecution:false이다. 이 독립 검사들의 임시 폴더 네 곳은 소유·실제 종료·프로세스 참조를 확인해 일반 삭제했고 로그/결과는 별도로 남겼다(`resume-source-fixture-cleanup.json`). 20분 경계에서 n9g도 deleted로 확인했다. v11b/g/h는 원본 전체 Git alternates 조사에 inbound consumer가 없고, 선택된 v11b의 현재 연결 내용도 조사 당시와 일치한다(`resume-v11-git-consumer-check.json`); 이는 새 전체 파일시스템 재조사를 뜻하지 않는다.

20:06 UTC: n9h도 deleted이고 u23 전체 묶음은 실행 중이다. project-maintenance 단위 10개도 exit0이며 임시 폴더는 일반 삭제했다. 남은 배포 mock은 지원되는 ArtifactProjectRoot/RunRoot를 사용해 동일 run 안의 짧은 독립 catalog로 실행한다. 원래 45초 제한과 검사는 유지한다. 첫 독립 경로는 Git Filename too long으로 실패했고, 경로 축소 준비 중 두 시도는 소유 경계 사전검사에서 거부되어 payload가 생성되지 않았다. dp6의 verify only는 실제 exit0이며 나머지 두 항목을 진행한다. LegacyRegistryOnly는 실제 cargo/rustc 실행 때문에 여전히 선행조건 차단이다. 공통 adapter가 기존 미커밋 수정과 같은 함수에서 겹치므로 안전한 자동 commit 분리가 불가능하다. 무관한 변경을 포함한 commit은 만들지 않고 소유자 통합 대상으로 남긴다(`resume-commit-scope-decision.json`).

20:18 UTC: links-r2 실제 종료 exit1. n10a의 사전 차단은 유지되며 w31b/n9g/n9h/u23은 각 결과가 deleted다. u23은 전체 10구성원이 없고, 이 중 u23a/b/c는 이번 재개 전부터 없었으므로 새 삭제로 집계하지 않는다. dp6 배포 mock 3개는 모두 exit0, 원래 제한 유지. 결과·실패 진단·필요 metrics 복사본을 남기고 임시 폴더 4개는 일반 삭제했다(`resume-deploy-fixture-cleanup.json`). LegacyRegistryOnly도 실제 idle 시점의 1회 재시도에서 exit0, fixture_remaining=false로 완료했다(`tool-fix-validation/legacy-registry-idle-r1.log`).

native 등록 묶음 6개는 새 review→apply를 파일 쓰기 없이 연속 제출했다(functions cell263). n9d/n9e/iy17a는 새로 지정한 exact managed root 자체 보호에 차단됐고, e10은 그 보호와 protection 미확인으로 보류다. iy17a는 완전한 단일 generated snapshot 선언·무참조·현재 사용 검사에 따라 지원 record API로 flags를 정합화한 revision3이며 이 변경이 root 보호를 해제하지는 않는다. 부모 artifacts/로 관리 범위를 일시 확대하고 정확한 승인 묶음만 삭제한 뒤 복원하는 추가 변경은 사용자 답변 대기 중(질문 01a16551-9b63-7830-8f63-eca7d17abe34). 답변 전에는 변경하지 않는다. 보호 없는 v11b/g/h 및 두 연결 run의 native 실제 적용은 아직 종료 결과를 기다린다. 20:44 경계에서 v11b 경로 부재를 관측했지만, 최종 결과 전에는 완료로 집계하지 않는다.

e10 원래 실패(outer exit1), fixture 실패, companion running/null 불일치는 `resume-e10-evidence/`의 7개 복사본/manifest에 해시 대조해 보존했다. n10a 연결 작업 폴더를 삭제해도 독립 진단이 남는다. R4/e11의 6단계 성공 근거는 오래된 pending acceptance 참조 해제에 사용할 수 있으나, 원래 실패를 성공으로 바꾸지 않는다. e10 삭제는 아직 차단 상태다.

native apply 장기 대기는 읽기 전용 파일 이벤트 observer(pid68516, work7828ed4d-d8bc-42e9-a4db-b489a37f7048)로 전환했다. observer는 native 최종 review/decisions/apply JSON의 완전성을 확인하고 종료하며, cleanup 성공을 보증하지 않는다. 재개 후 cell263 실제 결과·각 항목을 확인한 다음 카탈로그 writer를 넘긴다. 이후 준비된 n10a-r3(89개 정확한 링크), u22a/e11 정리, 첫 실패 validation child 정리, 소스 identity/잔여/보존 경로 검증, 임시 PS 제거, producer close가 남는다. 실행 중인 native의 설정·producer 입력은 바꾸지 않았다.

21:19 UTC: cell263 최종 반환을 직접 확인했다. v11b/g/h와 연결 run 2개 모두 deleted/remaining=false/error=null이며 물리 회수량은 null이다. 원래 논리 9,197,721,873 bytes를 실제 물리 확보량으로 보고하지 않는다. 나머지 4그룹은 deferred다(`resume-native-r2-summary.json`; 전체 감사는 `resume-native-review-apply-r2.json`). observer가 apply.items를 기대했지만 실제 응답은 apply.results여서 완료 신호를 내지 못했다. 결과를 직접 검토한 뒤 정확한 cancel 파일로 observer를 정상 취소했고 work는 cancelled/exit0이다. 경과 시간이나 이 감시 결과로 native 성공을 추정하지 않았다. 감사 속성 11,181건은 각 선택 항목 내부/ReadOnly·Hidden만 해제/System 불변을 확인했고 위반0이다(`resume-native-attribute-audit-check.json`; 하드링크/ACL 재조사 주장은 아님).

관련 소스 18개가 검증 당시와 같음을 확인한 뒤 21:19:40 UTC에 n10a-r3를 시작했다. work78eede83-3c80-47ab-83cd-76243f7273d8, Node wrapper13228, PS child33956. 신호는 실제 child close에서만 발행한다. 다른 catalog writer는 실행하지 않는다. v11 producer finalize용 `resume-finalize-native-r2.ps1`도 준비했지만 n10a 종료 전에는 실행하지 않는다. 추가 관리 범위 승인 질문은 아직 답변이 없다.

21:23:41 UTC: n10a-r3는 exit1/blocked로 실제 종료했다. 전체 사전검사에서 ReadOnly Git 객체의 외부 하드링크를 발견해 속성 정규화/삭제 전에 멈췄다. 정확한 한 파일의 fsutil 목록(exit0)에 n10a/u18a 외에 명시 보존 u17a 및 필수 Git 의존 u18a-r2도 있다(`resume-n10a-preserved-hardlinks.log`). 따라서 현재 보존 결정과 모든 링크가 같은 삭제 그룹 안에 있어야 한다는 승인 조건상 n10a 전체 그룹을 보류한다(`resume-n10a-hardlink-defer.json`). 링크 허용 목록 보완은 성공했지만 외부 보존 링크 보호를 우회하지 않는다. 21:24:12 UTC에 독립 u22a/e11용 ready-r1을 시작했다(work543653c4-5b01-43a5-a1fc-28bb259ca3de, wrapper66068/PS23676). 이 카탈로그 writer 종료 후 v11 finalize/초기 validation child 정리 및 e10의 stale pending-acceptance 참조만 해제하는 준비 스크립트를 실행할 수 있다. e10 실패/companion 불일치와 fixture 보호는 유지한다.

### 재개 작업의 현재 결과

ready-r1은 21:32:58 UTC 실제 exit0이며 u22a/연결 run/e11 모두 deleted다. build/m은 실행 전부터 없던 선언 출력으로 새 삭제량에 넣지 않는다. v11 두 producer는 지원 finalize로 마감했다. 최초 Python PATH 실패 validation도 실제 failure1을 독립 보존한 뒤 일반 삭제/finalize했다. e10의 오래된 pending-acceptance 참조만 현재 revision/보존한 R4 6단계 성공 근거로 지원 release했고 revision3/refs0이다. 원래 실패와 running/null 불일치, protection_unknown 및 fixture는 유지한다. native 등록의 보호 메타데이터도 refresh했다.

새로 삭제한 19개 원본 조사 구간은 각각 성공 삭제 receipt와 현재 부재를 대조했다: 원래51구간 중14개 + 별도 승인 v11구간5개, 이전 논리 47,300,011,503 bytes(44.05 GiB). 원래부터 없던5구간은 제외했다. 실제 물리 디스크 확보량은 측정하지 않았다. 51구간 중 현재 부재19/남음32이며, 남은 원본 논리 크기는140,555,821,753 bytes(130.90 GiB)이다. 각 남은 구간의 보류 근거와 재검토 조건은 `resume-remaining-decisions.json`, 삭제 귀속·보존 검증은 `resume-final-evidence.json`, 상세 크기/원래부터 부재 구분은 `resume-summary-final-r1.json`에 있다. 보존7개 빌드, Git alternates5개 불변, av17/av18 확장2개(version2026.0.10) 존재를 실제 확인했다.

검증 로그15개를 `resume-verification-index.json`에 모았다. Windows 필수10항목과 해당 Node/source 검사는 최종/영향 범위 재시도에서 모두 exit0이다. 18개 소스 해시는 최종에도 검증 당시와 같다. EPERM 최초1회와 초기 환경/시간제한/경로길이/잠금 실패 로그는 그대로 남겼다. 다른 OS 실행이나 설치된 native 엔진의 빌드/교체는 수행하지 않았다. task source와 기존 미커밋 수정이 겹치는 commit 분리 제한은 여전히 유효하므로 commit하지 않는다.

임시 managed roots4개는 추가했던 정확한 줄만 제거했고 다른 JSON 설정 불변을 확인했다. PS5 파일 실행 정책 때문에 정리 스크립트 시작이 거부되어 삭제는 실행되지 않았고, 정책을 바꾸지 않은 대화형 명령에서 같은 경로/활성참조/링크 검사를 거쳐 ordinary Remove-Item으로 PowerShell portable을 제거했다. 실제 exit0/remaining=false다. 강제 삭제, ACL/System/원본 속성 변경, 외부 프로세스 종료는 없었다. 이전에 `blocked by policy`로 거부된 `tool-fix-validation/node-fixtures` 디렉터리는 재시도 없이 보존한다. 실패한 최초 자동 UUID 배포 run은 정확한 별도 소유 상태를 임의 정리하지 않고 진단용으로 남긴다.

현재 원본 목표 전체는 미완료다. n10a는 보존 빌드 공유 링크 때문에, 나머지는 보존·종료/소유/참조 근거 부족 또는 전체 그룹 범위 때문에 보류다. n9d/n9e/iy17a에 필요한 일시 부모 관리 범위 변경은 질문01a16551-9b63-7830-8f63-eca7d17abe34에 실제 답변이 올 때까지 실행하지 않는다. v2 진단/검증은 증거 참조로 보존하며, 후속 실행은 새 run을 사용해 이 결과를 변경하지 않는다.

v2 producer는 실제 자식 종료/도구 결과와 활성 run 참조0을 근거로 stopped/failure, aggregate exit=null로 마감했다(단일 부모 OS exit를 만들지 않음). membership은 완전하며 payload는 이후 변경하지 않았다. 최초 보존 참조의 방향이 반대여서 native review가 blockers0을 반환한 것을 확인하고 수정했다. `registerRequest`의 참조는 소비자가 의존하는 producer를 가리키므로, 별도 `work:DH-01-project-storage-review:retention`이 v2를 소비하도록 선언하고 잘못된 v2 outgoing 참조만 지원 release했다. producer revision4의 실패/null은 유지한다. native refresh 후 실제 검토에 `references active or unknown`, 정확한 retention 소비자 및 그룹 보호가 나타났고 전체 묶음 보류가 저장됐다. retention 작업도 활성 상태로 별도 등록·보류했고 현재 source 내용/소유는 확정됐지만, 논리 작업이 retained라 native cleanup-ready membership은 false다. 두 그룹 모두 삭제하지 않았다.

현재 결과를 확인할 파일:

- [삭제 귀속·보존·소스 검증](../../artifacts/tasks/DH-01-project-storage-review/runs/retire-old-v2/resume-final-evidence.json)
- [통과 검증과 최초 실패의 범위](../../artifacts/tasks/DH-01-project-storage-review/runs/retire-old-v2/resume-verification-index.json)
- [남은32구간의 보류 사유·재검토 조건](../../artifacts/tasks/DH-01-project-storage-review/runs/retire-old-v2/resume-remaining-decisions.json)
- [실제 native 증거 보호 확인](../../artifacts/tasks/DH-01-project-storage-review/retention/native-evidence-protection.json)


### 승인된 세 관리 루트의 정리 재개 (v3)

사용자 답변 01a16551-9b63-7830-8f63-eca7d17abe34로 임시 부모 artifacts 관리 범위를 승인받았다. n9d/n9e/iy17a 세 묶음만 현재 참조와 native 보호를 다시 검토하고 삭제한다. Windows 로컬 x64 구성 변경이며 제품 소스 변경은 없다. 실제 도구 종료 후 자체 설정 변경을 복원한다. v2 증거와 외부 확장/연결 빌드 보존은 유지한다. 실행 증거는 retire-old-v3에 기록하며 기존 검증은 해당 입력이 변경되지 않은 범위에서 재사용한다.


v3 최종 결과: native review/apply 2026-10-23 00:09:51~00:58:04 UTC, 세 묶음 모두 deleted/remaining=false/error=null. 같은 호출 finally에서 관리 설정을 원래 바이트 그대로 복원했다. n9d/n9e/iy17a의 기존 논리 크기 합계는 11,912,944,878 bytes(11.09 GiB)이다. 누적 신규 삭제는 22구간/59,212,956,381 bytes(55.15 GiB)이며 실제 물리 회수량은 측정하지 않았다. 원래 51구간 중 29구간은 remaining-decisions.json의 명시한 근거와 재검토 조건으로 보류한다. 외부 확장 두 개와 보존 빌드 7개, alternates 5개 불변을 확인했다. 속성 감사 1,828건/위반0, 기존 검증 입력18개 불변이며 기존 검증 증거를 재사용했다. 임시 PowerShell 및 zip은 경계·활성 참조·reparse 검사 후 일반 삭제(actual exit0)했다. v3 자체 최종 검증은 루트 계산 오류(exit1)를 수정한 재실행에서 actual exit0이다. PS5 사전 검사 실패와 큰 영수증 저장 요청의64KB 자동 검토 거부도 증거에 남겼다. 적용 완료 신호는 발생했으나 예약은 fallback deadline에 재개되어 실제 도구 결과를 직접 확인했다. 기존 미커밋 수정 중첩으로 task-only commit 보류는 유지한다.

현재 결과와 상세 영수증: artifacts/tasks/DH-01-project-storage-review/runs/retire-old-v3/summary.json, native-review-apply.json, final-validation.json, remaining-decisions.json. 보류된 원본은 이번 승인 범위로 확대하지 않았다.

최종 native 보존 검토/적용: v3 실행 그룹과 retention 작업 그룹을 재등록하고 현재 inbound evidence consumer 보호를 확인했다. 두 그룹 모두 deferred/remaining=true, aborted=false로 실제 반환됐다. v3 payload는 close 이후 변경하지 않는다. 남은29개 결정과 증거는 보존하며 재검토 조건은 remaining-decisions.json에 있다.
