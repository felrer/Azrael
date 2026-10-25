# 잠금 복구 및 정리

현재 상태: 소스 구현·Windows 회귀 완료. 운영 lease 복구와 정리는 근거 부족·현재 관리 잠금으로 보류.

- 사용자 승인: 02-plan 권고 순서 실행. 원래 최근 24시간 로그 보존·오래된 로그 정리 목표 유지. 삭제는 실제 소유·종료·소비 근거와 supported 절차를 통과한 것만 수행한다.
- 범위: 공통 sentinel 수명·명시적 복구 API/CLI, JS writer metadata·자기 소유 해제, lease 12개 검토, native/producer stale protection 갱신. 보호 규칙 일괄 완화·임의 PID 종료·설치/제품 빌드/배포·상태 성공 조작은 제외.
- 플랫폼: Windows x64에서 실행·회귀 확인. 코드의 common 보호 의미는 Windows/Linux/macOS 유지. OS별 PID 관측은 구현 경계로 다루며 미검증 OS를 명시한다.
- 설계: 기존 create-new sentinel과 구형 marker를 유지. 신규 owner에 token/PID/시각/작업·가능한 process start 기록. 정상 해제는 자기 identity만 삭제. 복구는 정확한 marker SHA/token·독립 producer-tree 종료 근거·증거 SHA·별도 영수증·현재 live PID veto·pending 거부·권한/링크 검사를 통과해야 한다. 자동 stale 판정 없음. recovery끼리는 stable OS guard로 직렬화.
- 순서/담당: root는 운영 근거·metadata refresh·문서·통합·검증·정리. lease_recovery_evidence는 12 lease의 종료 근거, protection_reconcile은 44항목/20그룹의 안전한 refresh 후보를 읽기 조사. native_lock_recovery는 Rust lock metadata/explicit recovery, js_lock_owners는 JS shared helper/callers/회귀를 독립 구현한다. lib.rs·docs·feature inventory는 root만 수정한다.
- 산출물: 필요한 검증 logs/reports는 artifacts/tasks/DT-01-old-log-cleanup/runs/lock-remediation-20261025-r1 하위에 생성 전 소유를 기록한다. 운영 복구 증거/영수증은 artifacts/maintenance/evidence/DT-01-lock-remediation 하위에 보존한다. 작업 보고서는 이 세션 reports에 둔다. source/payload나 다른 그룹을 이번 소유로 흡수하지 않는다.
- 수용: native/JS live contention 유지, crash marker 명시 복구 및 보호 회귀, metadata 동기화 실제 결과, lease별 실제 delete/defer·잔여, 코드·문서·보존목록 일치, 임시 fixture 정리. task commit은 기존 변경과 안전히 분리할 수 있을 때만 관련 hunk를 포함한다.
- 근거 부족/점유 잠금/미종료 producer는 보류하고 재검토 조건을 기록한다. 일부 운영 보류가 있어도 구현·회귀를 계속한다.

## 결과와 남은 조건

- Rust sentinel owner metadata·자기 identity 해제·명시적 `recover_lock` API/owner CLI와 JS 공용 owner helper를 구현했다. 설치된 도구는 갱신하지 않았다. create-new 충돌·자동 복구 금지·기존 실행 결과 보존을 유지한다.
- Windows x64 Rust 전체 120개 통과, 실제 exit 0. type check·nonzero listing도 각각 exit 0. native 검증 2026-10-25 14:00:09–14:02:45 UTC, 재실행 없이 완료. 고정 소스는 실행 후에도 동일했다. Linux/macOS 실행은 미확인이다.
- JS lifecycle 87개 통과, owner 동작 8개 묶음 및 표준 `node --test` 실행, artifact-run·deployment-workspace 모두 exit 0. feature manifest 검증과 담당 파일 diff 검사 exit 0. 새 테스트는 공용 잠금의 장기 회귀 계약으로 유지한다.
- `run:module-cache-management-r1`의 stale protection metadata를 refresh했다. `protection_known:true`가 반영됐지만 fresh review는 활동 중 catalog writer로 membership 관측을 거부했다. 보류 저장 시도는 기존 maintenance lock으로 실패했다. 도구가 결정을 저장한 것으로 보고하지 않는다.
- v2 lease 1개와 legacy lease 11개는 원래 producer 전체 종료의 독립 근거가 없다. 현재 PID 부재로 해제하지 않았다. CN 4개는 browser 종료 결과만으로 server 전체 종료를 확정하지 않았고, CX 그룹은 구성 불일치의 owner reconciliation이 필요하다. 상세 재검토 조건은 [결정 기록](reports/remediation-decisions.json)에 둔다.
- 이번 운영 삭제는 0개다. 원래 24시간 이전 로그 정리도 완료되지 않았다. 현재 maintenance lock을 우회하지 않는다.
- 이번 검증 producer는 실제 종료 결과로 supported close했다(`complete`, revision 2). compact 독립 검증은 [결과 요약](reports/verification-summary.json)에 보존했다. run 전체의 native 등록·정리 시도는 `exclusive maintenance lock unavailable`로 실패했다. `artifacts/tasks/DT-01-old-log-cleanup/runs/lock-remediation-20261025-r1`의 source 사본·남은 fixture·raw logs는 재현 필요가 없어 삭제 대상이지만 현재 guard 때문에 임시 보존한다. 기존 writer가 정상 종료하고 native 등록·fresh review/apply가 가능해지면 전체 그룹을 삭제하고 실제 부재를 확인한다. 별도 shell 삭제로 우회하지 않았다.
- 일반 경로 확인과 unlink 사이의 비협력 외부 프로세스 변경을 완전히 원자적으로 막는 API는 아니다. 협력 writer의 create-new 규약과 recovery guard를 유지하며 identity/content 변경은 최종 확인에서 거부한다.
