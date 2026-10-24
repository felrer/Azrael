이 문서는 r2 실행 시점의 기록이다. 후속 정식 이관·삭제의 현재 결과는 [최종 결과](05-formal-cleanup-result.md)를 따른다.

당시 상태: 부분 실행 완료. 사용자 승인에 따라 두 로그 묶음을 삭제했습니다. 구버전·버전 미확정 후보 829개 경계는 관리 도구의 일반 보호 승격 거부로 남아 있었습니다.

# 허용 범위와 결과

사용자가 구버전 후보 및 버전 미확정 로그의 보관 해제와 삭제를 명시적으로 승인했습니다. 이 승인으로 이전의 모델 보존 판단을 재검토했으며, 같은 삭제 승인을 다시 요구하지 않았습니다. 현재 설치 2026.0.11 runtime, 인증·대화·설정, 다른 프로젝트와 일반 캐시는 이번 변경 범위가 아닙니다.

| 묶음 | 실제 처리 | 등록 논리 bytes |
|---|---|---:|
| `AV-01-condition-labels-20261017` | `artifacts/logs/root-resume-condition-labels` 삭제, remaining:false | 245161 |
| `run:BZ-01:implementation-01` | `artifacts/logs/BZ-01-implementation-01` 및 연계 `artifacts/tasks/BZ-01-resume-list-indicators/runs/implementation-01` 삭제, 두 항목 remaining:false | 258677 |
| 합계 | 두 그룹·세 경로 실제 삭제 | 503838 (약 0.48MiB) |

native apply는 aborted:false, 두 그룹 최종 status:deleted, 세 항목 모두 deletion.status:deleted/error:null/remaining:false를 반환했습니다. physical_bytes_reclaimed는 null이므로 실제 디스크 확보량을 측정했다고 주장하지 않습니다. 속성 변경 목록은 모두 비어 있습니다. BZ producer는 실제 부재·참조 없음 확인 후 supported finalize가 exit 0/status:finalized로 종료했습니다. AV 그룹은 producer catalog 기록이 없는 native 소유 그룹이므로 별도 producer finalize는 하지 않았습니다.

필요한 검증 결과·입력 SHA·원래 실패한 명령의 exit 상태를 [독립 보존 근거](preserved-verification.json)에 먼저 이관했습니다. AV/BZ 소유 작업 문서의 참조도 이 파일로 전환했습니다. 실제 프로세스 조회에서 세 경로를 참조하는 프로세스가 없음을 확인한 뒤 fresh review에 차단 사유가 없는 그룹만 삭제했습니다. 새 테스트 실행이나 제품 수용을 주장하지 않습니다. 문서 `git diff --check` exit 0이며 기존 LF/CRLF 경고만 있었습니다.

# 구버전·미확정 대량 삭제가 중단된 이유

`work:BI-01-legacy-custody:20261019`의 정확한 `app-release-2026.0.4` member에 대해 기존 `recordLifecycle` 경로로 generated/protection_known 해제를 실제 요청했습니다. 사용자의 승인은 명확하지만 도구가 `Cannot promote protected lifecycle member generated`로 거부했습니다. 해당 명령 exit 1, 전후 revision 모두 2로 보관 기록은 변경되지 않았습니다.

이 보관 기록은 단순 보존 참조뿐 아니라 원래 생성 소유와 사용 여부가 미확정이라는 `generated:false/protection_known:false` 상태를 담고 있습니다. 현재 API의 일반 reference release는 이 소유 구분을 바꾸지 않으며, register/refresh도 기존 protected producer member를 확인된 생성 소유로 승격하는 기능이 아닙니다. 이미 거부된 보호를 원시 registry JSON 수정, 다른 API, 중복 그룹 등록, 강제 삭제로 우회하지 않았습니다. 거부 후 같은 변경을 다른 경로로 재시도하지 않았습니다.

이 보호와 연결된 구버전/버전 미확정/문자열 오류 후보는 829개 경계이며 이번 관찰 시 모두 존재합니다. 과거 내용 조사에서 합계 약 2.75GiB였지만 이번에는 크기·내용을 다시 전수 측정하지 않았습니다. 보호를 거부한 공유 원인이 해소되지 않았으므로 각 경로에 같은 승격 요청을 반복하지 않았습니다. 나머지 세 미확정 컨테이너는 `question-withdrawal`, `session-completion-20261005`, `verification-cleanup`이며 그 안의 별도 소유 묶음/정리 증거를 재귀 일괄 삭제하지 않았습니다. 원본·백업·활성 입력의 확인을 생략하지 않습니다.

후속 조건은 **사용자 승인 추가가 아니라**, 확인된 생성 산출물의 근거와 실제 소비 상태를 반영해 보관 기록을 정식 소유 그룹으로 이관하는 지원 경로입니다. 이번 실행 범위에서는 그 경로가 확인되지 않았습니다. 이 관리 기능의 보완은 제품 코드·보호 계약을 변경하는 별도 구현 범위로 검토해야 합니다. 단순 보호 플래그 덮어쓰기를 해결책으로 취급하지 않습니다.

이 보호 유지 판단은 [artifact lifecycle](C:/Users/felre/.azrael-ex/skills/implementation/references/artifact-lifecycle.md#review-and-group-decisions)의 “Do not bypass a conflict by force deletion, editing raw manifests or fabricating missing historical records.” 및 실제 도구 거부를 따른 것입니다.

# 실행 근거

실행 기록: `artifacts/tasks/DN-01-disk-cleanup-candidates/runs/approved-log-retirement-20261024-r2/reports/`.

- [보호 해제 요청의 실제 거부 결과](../../artifacts/tasks/DN-01-disk-cleanup-candidates/runs/approved-log-retirement-20261024-r2/reports/custody-release-attempt.json)
- [삭제 직전 native review](../../artifacts/tasks/DN-01-disk-cleanup-candidates/runs/approved-log-retirement-20261024-r2/reports/delete-known-review.json)
- [실제 삭제 결과](../../artifacts/tasks/DN-01-disk-cleanup-candidates/runs/approved-log-retirement-20261024-r2/reports/delete-known-result.json)
- [잔여 경계·처리 결과](../../artifacts/tasks/DN-01-disk-cleanup-candidates/runs/approved-log-retirement-20261024-r2/reports/final-result.json)

실행은 2026-10-24 11:42 KST경 시작했고 native 삭제 호출은 약 2분 소요됐습니다. 같은 삭제 producer를 재실행하지 않았습니다. 새 보고서 묶음은 잔여 보호 진단·후속 삭제의 인계 증거로 보존하며, 보호 이관과 구버전 삭제가 해결되고 최종 결과를 work 문서로 이관하면 제거를 재검토합니다.
