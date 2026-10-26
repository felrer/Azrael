상태: 측정·실패 진단·임시 자료 정리 완료. source-tests 실패로 후속 단계 미실행.

# 빌드 다음 단계 source-tests 측정

- 사용자 승인: 이전 단계 측정·최적화를 이어가며 10초보다 짧으면 다음 단계, 아니면 단계와 측정 시간을 보고한다. 기존 2회 순차 측정을 유지한다. 첫 10초 이상 성공 단계는 같은 설정으로 1회 추가 후 중단한다. 실패는 다음 단계를 차단한다.
- 이전 DW-01 기록의 마지막 완료는 engine-source-preflight 2회(293.618/281.836초)다. 다음 source-tests의 실제 변경 기반 범위를 현재 소스로 선택한다. 오래된 삭제된 preflight receipt를 재사용하지 않는다. 이 작업은 source-tests만 검증하며 제품 빌드·설치의 통과 근거로 일반화하지 않는다.
- Windows x64/Node26.7.0, 기본 concurrency4. 실제 CLI와 --args-file transport를 사용한다. source fixture readiness가 10초 미만이면 바로 source-tests로 진행한다.
- 준비 조회에서 Git 기본 maxBuffer를 초과했다. 비추적 archive 생성물 59096개/전체 Git 출력7066583bytes가 원인이다. 표준 .gitignore에 /archive/를 추가하고 비archive 비추적 목록이 정확히 보존되는지 검증한다. 소스 runner 버퍼 우회나 검사 축소는 하지 않는다.
- 소유: root, run:DW-05:source-tests; C:\Users\felre\Desktop\pi-harness-init\artifacts\tasks\dw05-tests와 짧은 TEMP C:\Users\felre\Desktop\pi-harness-init\artifacts\tasks\tw05. 테스트 자체의 producer/lifecycle과 외부 출력은 종료 후 목록 차이로 조정한다. 측정 중 cleanup/catalog writer는 시작하지 않는다.
- 전후 project snapshot 동일성과 실제 CLI exit/result를 확인한다. 첫 점검은60초, 각 명령 최대시간 보장은 없다. 빌드·설치는 시작하지 않는다.
- 정리: 필요한 요약을 본 기록에 남긴 뒤 설치된 최적화 maintenance_owner로 disposable groups를 등록/review/apply하고 실제 부재 및 finalize를 확인한다. 기존 archive는 보존한다. 이번 작업의 archive 보존 예외는 요청되지 않았다. .git/dw05-plan-body.md는 생성 후 일반 삭제한다.
- 완료 후 이번 .gitignore/작업 기록만 task commit하고 기존 source/index를 보존한다.

## 측정 결과

- 사전 조회의 실제 원인은 기본 Git maxBuffer를 넘는 비추적 archive 생성물이었다. `/archive/` 표준 ignore로 비추적 Git 출력이 7,066,583 → 66,676 bytes로 줄었다. ignore 이전 archive 외 파일과 이후 파일 목록은 새 계획 1개를 제외하고 정확히 같다. tracked archive 파일은 없었다. 이는 변경 목록 크기 개선이며 빌드 전체 시간 개선율이 아니다.
- 첫 source fixture 검사: 누락된 기본 Codex runtime 경로 및 `artifacts/latest.json`으로 actual exit 1. 테스트 실행은 시작되지 않았다. 설치본 manifest의 원본 runtime `artifacts/tasks/DU-01-window-use-stages/runs/20261017-skill-r1/inputs/sky074-pristine`에서 transport/executable SHA를 owning 상수와 대조했다. 기존 지원 환경 변수 `AZRAEL_TEST_COMPUTER_USE_RUNTIME`에 이 runtime, `AZRAEL_INSTRUCTION_TEST_ENGINE`에 `artifacts/workspaces/h/artifacts/releases/w13r-99afefb1/engine/azrael.exe`의 절대 경로를 지정했다. 원본 자산·설치물을 변경하지 않았다.
- 두 번째 준비의 source fixture 검사: actual exit 0, 10초 미만이므로 통계 없이 다음 단계로 이동했다. 검사 축소나 가짜 fixture를 사용하지 않았다.
- 대상 `source-tests`, 현재 변경 기반 130개 소스 파일, Node 기본 concurrency 4, 실제 `--args-file` 및 SHA 전달. 전체 CLI UTC 2026-10-26T10:52:24.227Z → 11:06:14.475Z, **830.247764초 (13분 50.248초), actual exit 1/signal=null**.
- source command group은 827,742ms, Node test 자체는 827,673.276ms였다. 전체 CLI 시간과 내부 시간을 합산하지 않는다. 1,945개 중 pass 1,937 / fail 1 / skipped 7 / cancelled 0. source group 실패 때문에 `test-incremental-extension-build`, `extension-build`, `extension-changed`는 runner가 미실행 처리했다. 제품 빌드는 시작하지 않았다.
- 실패: `scripts/test-project-maintenance.cjs:10`의 `Windows maintenance shells use the shared background command policy`. 실제 assertion `scripts/test-project-maintenance.cjs:14`: `AssertionError [ERR_ASSERTION]: powershell.exe`, actual=false/expected=true. 테스트는 paths.rs만 읽지만 최적화된 실제 PowerShell 생성 위치는 windows_delete.rs:37이다. 그 위치의 `codex_utils_process::background_command("powershell.exe")`와 paths.rs:799의 cmd.exe helper 사용을 읽기 확인했다. 이번 측정 중 소스나 테스트는 수정하지 않았다. 이 검사 경로를 갱신하고 관련 회귀 및 source-tests를 다시 통과시켜야 다음 단계로 갈 수 있다.
- 실패한 1회 실행이므로 평균·캐시 개선율을 만들지 않았고 2회차도 수행하지 않았다. source-tests의 성공 표본은 아직 없다. 범위의 coverageStatus는 `requires-separate-checks`이며 전체 제품의 성공으로 일반화하지 않는다.
- 실제 입력 전후 SHA는 `83a48342f99d330aeb7cbe8f82051930c8cee36c8edf26337cb4fe0b542cd188`로 동일했다. Windows x64만 실행했다. run 전후 신규 외부 producer group은 없었다. 첫·5분·10분 점검 외 중복 실행이나 catalog cleanup 병행은 하지 않았다.
- 종료 후 `.git/dw05-terminal.json`에 실제 failure/exit·원인·입력 identity를 임시 보존해 supported close의 근거로 사용한다. `.git/dw05-cleanup-request.json`과 `.git/dw05-cleanup-results.json`은 native owner 호출의 임시 제어 자료이며 결과를 이 문서에 보존한 뒤 일반 삭제한다.

## 정리와 종료

- 외부 producer 추가는 없었다. 외부 runtime/엔진/기존 archive와 기존 extension build 산출물은 생성·수정하지 않았다. 지원 close로 이번 run의 원래 실패 outcome/exit 1을 보존하면서 producer stopped 및 membership_complete=true를 기록했다.
- 첫 native 등록은 migration fixture의 junction으로 거부되었다. 원인 소유 파일 `scripts/tests/instruction-migration.test.cjs:14-20,53,67` 및 recorded-restored-link 회귀와 현재 경로/대상을 확인했다. 소유한 `tw05/migration/migration-*` 안에서만 9개 junction을 발견했으며 대상도 같은 소유 migration 경계 안이었다. 링크를 따라 payload를 스캔하거나 직접 제거하지 않았다.
- `verified_junctions` 선언의 path는 item root 상대 경로여야 한다. 최초 절대 경로 요청은 native parser가 거부했고 삭제는 시작되지 않았다. 실제 계약에 맞는 상대 경로 및 정확한 대상만 지정하여 전체 원래 그룹을 등록·재검토했다. 새로운 identity는 native 도구가 직접 고정했다.
- 설치된 최적화 owner의 SHA를 확인하고 같은 실행기로 register/review/apply했다. 두 item 모두 deleted/remaining=false/error=null/attributes=[]/aborted=false, apply 31.763초였다. `artifacts/tasks/dw05-tests`와 `artifacts/tasks/tw05` 실제 부재를 확인했다. 이번 cleanup 시간은 source-tests 시간에 포함하지 않는다.
- 원래 lifecycle `run:DW-05:source-tests`는 supported finalize에서 finalized/remaining=[]/references=[]/blockers=[]로 마감했다. 물리 회수량은 측정하지 않았다. 일회성 controller·로그·snapshot·fixture·cache를 남기지 않았다. 임시 `.git/dw05-*.json` 및 plan-body도 해당 근거가 해제된 후 일반 삭제·부재 확인한다. 승인받지 않은 보존 예외는 없다.
- scoped diff 검사 exit 0, 원래 Git index 전체 SHA 동일함을 확인했다. 이번 두 파일을 제외한 index 17,506개 항목 digest `8e9907ce4a5c56a97c024b035be5960f49feda2ef28ddbf392283689e02410d9`를 task commit 전후 대조한다. task commit은 `.gitignore` 및 본 결과 기록만 포함한다.
