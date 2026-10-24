# Legacy 로그 보관 이관 및 삭제

2026-10-24 사용자 요청: 보관 소유를 이관한 뒤 구버전 및 버전 미확정 로그를 삭제한다. 기존 승인 범위 안에서 수행하며 force 삭제, ACL/소유권 변경, 원시 registry 편집은 사용하지 않는다. Windows 로컬 작업이다. 공통 Node helper 의미는 유지하되 실제 검증은 Windows에 한정한다.

## 구현 및 검증

- `scripts/artifact-lifecycle.cjs`에 별도 `transfer-custody` writer를 추가했다. 일반 `record`의 보호된 생성 소유 승격 금지는 유지한다. 원래 claim과 상태/실행 기록을 영수증에 보존하고 pending target → source claim 이관 → complete target 순서로 기록한다. 완료 상태는 소유 판정 완료이며 과거 테스트 성공을 뜻하지 않는다.
- exact source owner/revision, 생성 증거 SHA256, 경로별 승인/소비 해제/정지 근거를 요구한다. 다른 owner·소비 참조·부분 부모 선택·링크·source 보관 경계 안의 증거를 거부한다. 반복 및 중단 복구를 시험했다.
- 집중 검사: `node --test scripts/test-artifact-lifecycle.cjs`, 실제 exit0, 49/49 통과. 로그: `artifacts/tasks/DN-01-disk-cleanup-candidates/runs/formal-custody-handoff-20261024-r3/reports/lifecycle-tests-link-guards.log`.
- 필수 owner 검사: `node scripts/check-artifact-lifecycle.cjs --stage source`, 실제 exit0. lifecycle/build-platform 및 platform-packaging 명령 모두 exit0. 근거 run: `run:lifecycle-check:77491b83-f2ad-4efd-b8ad-e1692ce4881f`, `artifacts/tasks/lifecycle-checks/runs/77491b83f2ad4efdb8ade1692ce4881f/logs/{0,1}.log`.
- 기존 feature inventory의 `tool.project-maintenance.lifecycle-source`가 변경된 helper/tests를 소유하고 필수 검사를 실행한다. 제품 빌드/설치 또는 다른 OS의 검증 결과로 확대하지 않는다.

## 소비 입력 보호

최초 pilot 이관은 `run:DM-01-boundary-reform:impl-r1`의 광범위한 legacy dependency로 거부됐다. 고정 fixture 설정과 r15 검증 설정을 확인하고, consumer owner `/root`가 모든 비로그 legacy claim 195개를 별도 retained/incomplete 입력 보관 기록 `work:DM-01:preserved-nonlog-input-custody:20261024`에 보존했다. 생성 소유 미확정 보호는 그대로 두었다. consumer에 새 dependency를 먼저 연결한 뒤 exact revision/reference ID와 독립 증거로 기존 광범위 참조만 해제했다. 실행 참조·검증 상태·producer 종료 결과는 바꾸지 않았다.

근거: r3 `reports/consumer-input-custody.json`, `consumer-input-custody-result.json`. 기존 source의 비로그 claim도 그대로 남는다. 현재 프로세스 592개와 설치 host manifest 두 개에서 후보 경로 참조는 발견되지 않았다. 이는 해당 시점의 executable/command 및 manifest 검사이며 모든 OS handle의 부재를 주장하지 않는다. native 도구가 실제 삭제 경계와 현재 관리 참조를 다시 검사한다.

## 실행

- pilot `app-release-2026.0.4`: 당시 writer, build/installation/completion receipt를 삭제 경계 밖에 보존했다. 이관 → native 최초 등록 → review(blocker 없음) → apply → finalize 모두 완료했다. native 결과 `deleted`, `remaining:false`, 오류 없음, attributes 변경 없음. 논리 크기 112,949,596바이트. 물리 회수 바이트는 native 도구가 보고하지 않았다.
- 후속: 코드 파일과 민감 상태/DB 경계가 없는 로그 593개를 구버전 15개와 버전 미확정 578개로 나누고, 최대 80경계씩 순서대로 이관/등록/review/apply한다. 각 묶음의 실제 결과는 r3 `reports/*-native-apply.json`에 남긴다. 미완료나 차단은 삭제 성공으로 집계하지 않는다.
- 전체 후보 중 152개는 생성 근거/별도 소유/원본·복구 경계 등의 추가 확인이 필요하다. 생성 흔적이 있는 후보라도 인증·DB 등 경계 12개와 코드가 섞인 묶음은 추가 판정 대상으로 두었다.

이 작업은 경로의 물리적 이동을 하지 않고 보관 소유만 이관한다. 원본 evidence·현재 입력 보호와 삭제 영수증은 r3 run 소유로 보존한다. 상세 결과와 완료 시각은 실제 terminal 응답 뒤 갱신한다.

2026-10-24 13:04 KST경: pilot과 구버전15경계가 모두 삭제/부재 확인됐다(합계168,362,482바이트, 앞선 r2 삭제량은 별도). 버전 미확정 첫80경계의 apply가 응답 대기 중이다. 계속 실행 중인 orchestrator는 `functions.exec` cell80이며 다음 그룹을 순서대로 처리한다. 중복 실행하지 않는다. native receipt 완료 감시자는 세션91858, work completion `11eaea95-13d8-4751-a574-cde576dff893`이다. `bulk-outcomes.json` 및 모든 apply/finalize의 실제 terminal 결과가 일치해야 성공 signal을 쓴다. 시간 경과만으로 완료하지 않는다. 감시자 시작 전에는 성공 signal이 없었다. fallback에서는 cell80과 실제 receipt 결과를 확인하고 실패/미확정이면 dependent 실행을 보류한다.

별도 준비한 코드 포함 릴리스4묶음은154,028,668바이트다. 작업용 recipe/patch153파일442,516바이트를 r3 `reports/preserved-task-recipes/`에 보존했고 `code-cohort-preparation.json`에 원본/보존 해시를 기록했다. 현재 bulk가 끝난 후 source revision과 참조를 재확인하여 별도 이관/등록/review/apply한다. 아직 이4묶음을 삭제 완료로 집계하지 않는다.

## 실행 방식 조정: 물리적 묶음 이관

13:20 KST 예약 checkpoint에서 첫 unknown80경계 중46부재/34존재였다. 이는 metadata-only 1회 확인이며 native terminal 성공을 대체하지 않는다(`slow-apply-checkpoint-1.json`). 기존 경계별 native 처리 비용 때문에 남은 동일 승인 후보를 새 전용 경계에 같은 볼륨 rename으로 묶는 방식을 준비한다. 실제 파일 경로 변경은 이 실행 조정에서 새로 선택한 구현 방법이다. 대상 자료·삭제 권한·보호 판정은 확대하지 않는다. 현재 native group의 입력/경로는 변경하지 않고 완료를 기다린다.

기존 lifecycle 절차와 Node filesystem 기능을 검토했으나 지원되는 물리 보관 이관 writer는 없었다. 별도 `relocate-custody`를 기존 검증과 결합한다. 새 destination의 pending intent를 생성 전에 기록하고 원래 root dev/ino 및 mapping을 보존한다. 동일 volume의 ordinary rename 전후 identity를 확인하며, 모든 이동이 확인될 때까지 source claims를 유지한다. 실패/충돌/링크/미확정 결과는 pending으로 보호하고 임의 덮어쓰기·삭제하지 않는다. mkdir 후 destination identity 기록 이전 중단은 자동 인수 근거가 없어 fail-closed로 남긴다. 실제 삭제는 새 complete 경계를 native 최초 등록/review/apply한 뒤에만 수행한다.

작은 inactive 로그의 copy pilot을 먼저 수행한다. 원래 경로를 유지하고 새 pending 경계에 exclusive copy를 만든 뒤 내용 SHA·독립 reader·읽기 권한·완전성을 확인한다. pilot의 새 복사본도 native 도구로만 정리한다. 이 결과가 확인된 뒤 bulk rename을 수행한다.

현재 native 호출이 catalog.lock을 점유한다. 첫 r4 record는 EEXIST로 무변경 종료됐고 lock은 제거/수정하지 않았다. 실제 이관 준비 reader의 source dependency를 lock 해제 이벤트에 지원 writer로 등록하는 watcher를 시작했다(session61056/work559bb70f-0105-4197-b17c-00c1acfa6700). 이 참조는 이미 독립 target인 현재 group을 방해하지 않고, 이전 driver의 다음 transfer를 안전한 경계에서 차단한다. 이전 driver의 실제 종료와 현재 group의 native 결과를 확인한 뒤 정확한 owner/revision/증거로 준비 dependency를 해제하고 새 절차를 진행한다. 기존9그룹 완료 observer는 원래 계획이 실제 종료한 뒤 취소하며 성공으로 바꾸지 않는다.

물리 이관 및 완료 재시도 보호 집중 검사는 최종87/87통과, 실제exit0이다. 로그 `r3/reports/lifecycle-tests-relocation-completed-retry.log`. SHA256: lifecycle `f02962c691f7912c45e36787dc66bd67dbaea54b21a097ec54282815838a9ce8`, tests `9dcf09b4599a98775d93d1e26a9947465524615a48a2a8a90af5b353f5baca0e`. 완료 target도 목적지/자식 교체·추가·부재·하위 링크를 재확인하며 교체된 자료를 재등록하지 않는다.

## 완료 기록

위 실행 단계 기록의 최종 상태는 [최종 결과](05-formal-cleanup-result.md)를 따른다. 필수 source owner 검사 `080d3acc-97d0-40d1-a5b0-cc7d92315698`의 두 하위 명령 모두 실제 exit0이다. 기존 driver cell80은 다음 transfer 전에 소비 참조 거부로 종료됐고, watcher61056은 실제 exit0으로 준비 참조를 등록했다. 원래 observer91858은 정확한 소유 프로세스 종료 후 취소 결과로 기록했다. 준비 참조는 독립 증거·정확한 revision으로 해제했다. 점유 lock은 변경하지 않았다.

작은 copy pilot의 원본을 유지한 채 내용/reader/권한 검증을 통과하고 신규 사본을 native 삭제했다. 이후 구버전4개154,028,668바이트와 미확정498개619,022,466바이트를 각각 신규 전용 폴더에 ordinary rename으로 이관한 뒤 native 삭제·finalize했다. 추가75개는 source/config9,031파일을 검증된 ZIP128,563,705바이트로 보존한 후 구버전14개124,354,366바이트와 미확정61개876,823,905바이트로 나눠 같은 절차를 완료했다. 원본 삭제는 이전 pilot/old15/unknown80을 포함해 총673경계1,981,269,692바이트이며, 새 copy pilot 바이트와 r2의 삭제는 중복 집계하지 않았다. r3/r4 보고서·보존본은 인계/복구 증거로 보존하며 native 등록·review/defer로 관리한다.
