상태: 다음 정식 빌드의 release 기본화·profile 재사용 검사·재귀 한도·source receipt 반영, 집중 검증과 실험 산출물 정리·코드 커밋 완료. 마지막 임시 Git index 일반 삭제는 실행 정책에 거절돼 deferred로 남긴다. 현재 앱 설치본은 변경하지 않았다.

# 정식 빌드의 release 최적화

## 목표·권한·범위

앞선 격리 실험의 release 빌드 이득이 다음 정식 빌드에 기본 포함되도록 한다. Windows x64 MSVC 정식 producer의 Cargo 명령·산출물 경로를 release로 맞추고 재사용 provenance에서 release 프로필을 요구한다. 공통 플랫폼 producer는 이미 release이므로 같은 receipt 계약을 연결한다. thin azrael entry의 컴파일 재귀 한도256을 제품 소스에 반영한다. 제품 기능·권한·데이터·외부 code-mode host·검증 기준은 유지한다. 이번 권한은 코드·문서·필요 검증·정리·작업 커밋이며 전체 제품 빌드·설치·배포·새 성능 실험을 포함하지 않는다.

## 현황·설계 차이

기존 Cargo release profile(thin LTO/codegen-units4)을 재사용하고 의존성이나 새 프로필을 추가하지 않는다. Windows build-azrael.ps1은 --release 없이 target/debug을 선택한다. portable build-platform.cjs는 이미 --release와 target/release를 사용한다. 현재 engine receipt는 source/env/target/binary를 검증하지만 프로필은 구분하지 않으므로 명시적 profile 기록/요구를 추가한다. 기존 receipt는 일반 설치·진단 검증에는 계속 유효하되 새 정식 producer의 release 재사용에는 허용하지 않는다. 앱 설치본은 바뀌지 않는다.

## 순서·소유·검증

root가 변경과 수용을 소유한다. 기존 dirty source/inventory/doc 및 staged4개 테스트 변경을 보존한다. 현재 입력/원본 receipt를 고정 → Windows recipe·profile provenance·공통 caller와 entry 설정 변경 → 기존 provenance/PowerShell/platform 회귀 검사 → source receipt 갱신/무결성 확인 → 일회성 fixtures/logs 정리 → 이번 delta만 커밋한다. 긴 전체 빌드는 요청 범위가 아니므로 시작하지 않는다. Windows는 실제 PowerShell 및 Python/Node 계약 검증, Linux/macOS는 공통 target fixture 검증으로 한정하고 native acceptance로 확대하지 않는다.

성공 기준: 새 Windows Cargo argv에 --release, 기본 output은 target triple/release, auto/explicit reuse는 release receipt만 통과, portable 기록도 release이며 source/host/binary 검사 유지, recursion limit256 및 source inventory 일치. 실제 제품 release 컴파일/복원 성능의 기존 격리 실험은 재사용하되 현재 전체 source의 신규 제품 빌드 성공으로 주장하지 않는다. 새 테스트는 기존 provenance/recipe 유지 검사에 최소 추가해 프로필 회귀를 보호한다.

## 산출물·보존

임시 경계는 artifacts/tasks/CY-01-session-loading-review/runs/20261025-release-default-r5, owner/group CY-01-release-default-r5다. 실행 전에 pending lifecycle로 선언한다. baseline 사본·receipt 전후 사본·검증 fixtures·raw logs는 이 경계에 한정한다. 결과 요약·명령·실제 exit·변경 분리 근거는 이 plan과 별도 작은 증거 파일에 보존하고, 종료·membership/consumer 확인 후 native review/apply·실제 부재·finalize한다. shared cache·설치본·다른 작업의 산출물은 선택하지 않는다.

## 준비 결과와 현재 제약

Windows argv/output을 release로 통일하고 auto/explicit reuse 및 최종 포장 검증에 --profile release를 연결했다. portable producer도 release receipt를 기록한다. 기존 Python provenance 회귀에 dev/legacy 거부·release 수용·세 binary/source 변조 거부·Unix target 기록을 포함하고, 기존 PowerShell recipe 회귀는 실제 AST 표현식을 평가해 Cargo argv/output/각 profile gate를 검사한다. 유지 검사는 다음 빌드 회귀를 보호하므로 남긴다.

원본 import는 Git ccbcbf93906a72cc7654aa9c57c670d5e2e3831d의 engine/SOURCE.json이며 현 receipt의 originalReceipt와 일치한다. archive 생성 exit0(5.335초). Windows 긴 파일명 때문에 일반 경로 extract 두 차례가 exit1로 끝나 기존 importer.filesystem_path의 확장 경로 IO를 재사용했다. 짧은 추가 경계 artifacts/build/c5를 생성 전에 같은 lifecycle revision2에 포함했다. 원본 root는 o/engine, 격리 source는 p/engine이다. current receipt와 HEAD가 일치하는 별도 작업의 미기록 project-maintenance 4개 파일은 격리 사본에서 HEAD 바이트를 사용하며 실제 파일은 변경하지 않는다. 이번 source receipt 변경에는 azrael.rs만 포함한다.

one_off cy-release-default-r5 bundle plan은 Python3.13 driver, project cwd, 명시한16개 scripts와 driver input, 추가 env/guard 없음으로 검토했다. run은 공용 maintenance.lock(pid73132) 점유 때문에 실행 전 거절됐다. 잠금을 변경하거나 우회하지 않고 단일15분 filesystem event waiter(session24606)를 시작했다. 그동안 독립 source 준비(session98031)와 코드 검토를 진행한다. 새 검증은 full product build가 아니다.

## 검증 결과

- 잠금은13:25:50 UTC 실제 해제됐고 waiter exit0이었다. native run-73132-2543-1792934966009691000은 약10초 도구 실행 경계에서 exit124, producer_completed=true·input integrity valid로 실패했다. 실패를 성공으로 바꾸지 않았고 r5 producer 종료 확인 뒤 동일 입력의 긴 CLI 실행(session81793)을 사용했다.
- Python provenance: 총50개 중46 passed/4 platform-conditional skipped, exit0,182.943초. platform build:12 passed/1 skipped, exit0,6.759초. mandatory root guards:3+4=7 passed, exit0,36.677초. 공통 변경의 Windows 실제 실행이며 Unix target은 fixture 계약 범위다.
- Windows build metrics/recipe:17/17, exit0(session42786). 추가한 AST fixture에서 script root 및 log directory 바인딩 누락으로 실패했던 시도는 별도 보존했고 해당 fixture만 보정했다. 제품 명령을 바꿔 테스트를 통과시키지 않았다. Python/platform/root 결과는 입력이 바뀌지 않아 재사용했다. 유지 테스트는 release argv/output, target-owner·package·feature 보존, auto/explicit reuse 및 package profile gate의 다음 빌드 회귀를 보호한다.
- 원본 archive의 일부 파일이 receipt 이후 변경된 바이트여서 전체 파일을 originalReceipt SHA와 대조하고 일치하는 역사 Git blob으로만 재구성했다. 미포함 root_resume_timing.rs는 생성된 원본 사본에서만 제거했다. source recorder의 앞선 실패는 보존했다. 최종 기존 record-engine-local-changes.py가 exit0(288.396초)으로 전체 원본·격리 source·receipt·Git mode를 검증했다. actual SOURCE.json의 시작 SHA가 그대로인지 재확인 후 새 receipt를 반영했고 file descriptor 변화는 azrael.rs 한 개뿐이다. 별도 작업의 미기록4개 파일은 이번 수용에서 제외되며 전체 현재 checkout의 빌드 성공으로 주장하지 않는다.
- one_off bundle은 검증 뒤 제거하고 project-maintenance.json을 시작 바이트 그대로 복원했다. 새 제품 빌드·설치·배포는 실행하지 않았다. 독립 결과와 실패 근거는12-release-default-evidence.json에 보존한다.

## 변경 분리와 커밋

engine/SOURCE.json·feature inventory·upstream-preservation 문서는 시작부터 다른 작업의 unstaged 변경이 있어 이번 delta만 별도로 구성한다. Git의 별도 index를 .git/index.cy-release-default-r5에 일시 생성해 정상 commit을 실행하고, 성공 뒤 해당 task path만 실제 index의 새 HEAD와 맞춘 후 임시 index를 보통 삭제한다. 기존 staged4개 source-test blob은 전후 동일해야 한다. 다른 작업의 변경을 임시로 unstage하거나 working file을 되돌리지 않는다. 이 작은 Git control file은 build payload가 아니며 commit 종료 직후 부재를 확인한다.

정상 코드 commit 후 task path만 실제 index와 동기화했고 기존 staged4개 blob 일치를 확인했다. 이어 정확한 .git/index.cy-release-default-r5의 kind/경계를 확인하고 Remove-Item -LiteralPath로 보통 삭제하려던 exec_command가 생성 전 `blocked by policy`로 거절됐다. 다른 shell/API·인코딩·이름 변경으로 재시도하지 않았다. 실제 파일 존재를 확인해12의 gitControlCleanup에 deferred·바이트·hash를 기록한다. 같은 파일의 보통 삭제가 실행 정책상 허용되고 Git consumer가 없을 때 재검토한다. 따라서 native 실험 payload 두 경계 정리는 완료됐지만 Git control file 정리는 완료가 아니다.

## 최종 수용·정리

고정 source의 engine-provenance snapshot도 실제 exit0으로 통과했다. installed w13r 엔진 SHA unchanged, immutable13 SHA `7d80d996b4f8ce6b69529b8650909d8cf5c94730e6dcf7926d1792affc9d3ad4`, 기존 staged4개 blob 일치를 확인했다. 세 유지 검사의 기존 결과와 보정 후 Windows17개 결과를 결합해 수용한다. Python4개·Node1개의 조건부 skip은 native 타 플랫폼 검증으로 세지 않는다. 신규 전체 제품 빌드·설치·로그인/UI·Linux/macOS native 수용은 실행하지 않았다.

producer close revision3 이후 native register/review에서 두 member 모두 blockers[]·registered mode·membership 일치·references[]였다. apply의 첫 dispatch는 공용 maintenance.lock 점유로 거절돼 실제 해제 event 뒤 같은 fresh token으로 재개했다. 최종 group deleted·두 member deleted/remaining=false·aborted=false를 확인했다. 삭제 전 논리 크기는 run55,527,728 + source219,822,829 =275,350,557 bytes이며 물리 회수량은 측정하지 않았다. native 도구가 이 소유 generated Git fixture의 ReadOnly/Hidden만 보통 속성으로 정규화한 실제 결과도12에 보존했다. 두 경계의 실제 부재와 CY-01-release-default-r5 finalize(remaining[]/references[]/blockers[])를 exit0으로 확인했다. 일회성 driver·source 사본·archive·raw logs는 모두 삭제됐고 유지 결과는12/13에 독립 보존했다.

최종 확인에서 다른 작업이 scripts/artifact-lifecycle.cjs를 검증 후 수정한 사실을 확인했다. 이번 commit의 HEAD 기반 helper hash는 검증한 `f02962c691f7912c45e36787dc66bd67dbaea54b21a097ec54282815838a9ce8`와 같아 해당 고정 입력 결과를 재사용한다. 새 working hash는 이번 commit에 포함하지 않으며 그 동시 변경까지 수용했다고 주장하지 않는다. 이 파일 외 검사 입력은 그대로다.
