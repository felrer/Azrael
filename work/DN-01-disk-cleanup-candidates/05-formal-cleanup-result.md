상태: 확인된 673개 경계의 이관·삭제 완료. 나머지 156개는 사유와 재검토 조건을 남겨 보류했다. 전체 후보의 삭제 완료를 뜻하지 않는다.

# 실제 결과

2026-10-24 14:18 KST에 고정 후보 목록과 7개 native apply 영수증을 대조했다. 모두 `aborted:false`, 각 삭제 항목 `status:deleted`, `remaining:false`다. 해당 원래 673개 경계도 존재하지 않는다. 물리 이관한 전용 폴더는 native 삭제 및 supported finalize까지 완료했다.

| 원래 분류 | 삭제 항목 | 삭제 논리 바이트 | 남긴 항목 |
|---|---:|---:|---:|
| 2026.0.10 이하 문자열만 발견된 후보 | 34 | 446,745,516 | 2 |
| 버전 미확정 | 639 | 1,534,524,176 | 153 |
| 문자열 혼재/오류 후보 | 0 | 0 | 1 |
| 합계 | 673 | 1,981,269,692 (약 1.98GB / 1.85GiB) | 156 |

남은 후보는 원래 목록 기준 972,168,721바이트다. 이전 r2의 별도 AV/BZ 두 그룹·세 경로 503,838바이트 삭제는 위 수치에 포함하지 않았다. 상세 경로·분류·삭제 영수증·보류 사유·재검토 조건: [최종 대조 JSON](../../artifacts/tasks/DN-01-disk-cleanup-candidates/runs/grouped-relocation-20261024-r4/reports/final-reconciliation.json). native는 실제 회수 allocation을 측정하지 않아 물리 확보량을 확정할 수 없다.

# 범위와 절차

Windows 로컬 `artifacts/logs`의 legacy custody 후보 829개 경계가 이번 정리 대상이다. `2026.0.10` 이하 문자열만 있는 후보와 버전 미확정 후보를 분리했다. 문자열은 제품 버전 확정 근거가 아니다. 기존 관리·설치·복구 경계 전체를 재귀 삭제하는 범위로 확대하지 않았다.

사용자가 승인한 이관·삭제를 수행하기 위해 `transfer-custody`와 `relocate-custody`를 구현했다. 실제 생성 근거·정확한 소유/소비 참조를 확인한 경계만 인계하고, 같은 볼륨의 ordinary rename으로 새 전용 폴더에 모은 뒤 native 등록 → fresh review → 명시적 apply → 실제 삭제 및 잔여 없음 → finalize를 수행한다. 작은 inactive 로그 복사본으로 reader·SHA·권한·완전성 pilot을 먼저 통과했고 복사본도 native 절차로 제거했다. 복사본은 원본 정리량에 포함하지 않는다.

원래 custody의 불확실성과 과거 명령 실패는 이관 영수증에 유지한다. 일반 `record`의 보호 승격 금지를 유지하며 force 삭제·ACL/소유권 변경·원시 registry 수정은 사용하지 않았다. DM-01의 비로그 입력 195개는 별도 보호 기록에 보존하고 참조를 전환했다. 실행 중인 consumer의 종료·성공을 조작하지 않았다.

# 보존과 남은 확인

소스·설정 등 9,031개 파일은 독립 ZIP으로 보존했다. 압축 크기 128,563,705바이트, 압축 전 543,488,421바이트다. ZIP CRC와 각 member SHA를 독립 reader로 검증했다. 별도 task recipe/patch 153개 442,516바이트도 원본·사본 SHA를 확인해 보존했다. 이 보존본과 보고서가 공간을 사용하므로 삭제된 논리 용량은 실제 확보 공간과 다르다.

`AF-01-resume-install`의 Git 15개는 직접 생성된 fixture임을 확인했지만, 전체 경계의 고유 source/patch 병합과 단독 복구본 여부·후속 실행 종료를 확인하지 못했다. `window-use-stages`에는 별도 owner와 현재 검증·복구 참조가 있다. 인증/DB를 포함한 네 경계는 일부 synthetic fixture 확인만으로 전체를 삭제하지 않는다. 생성 근거가 확인되지 않은 작은 로그도 이름·날짜만으로 확정하지 않았다. 후속 조건은 전체 생성 구성과 종료 증거, 필요한 source/복구 자료 보존, 실제 소비 참조 해제 및 새 review다.

# 검증

- Windows 집중 lifecycle 검사 87/87 통과, 실제 exit 0. 로그: `artifacts/tasks/DN-01-disk-cleanup-candidates/runs/formal-custody-handoff-20261024-r3/reports/lifecycle-tests-relocation-completed-retry.log`.
- 필수 `node scripts/check-artifact-lifecycle.cjs --stage source` exit 0. 실제 하위 명령 `node --test scripts/test-artifact-lifecycle.cjs scripts/test-build-platform.cjs` 및 `node scripts/test-platform-packaging.cjs` 모두 exit 0. 결과: `artifacts/tasks/lifecycle-checks/runs/080d3acc97d040d1a5b0cc7d92315698/results.json`.
- 검증된 최종 source SHA256: lifecycle `f02962c691f7912c45e36787dc66bd67dbaea54b21a097ec54282815838a9ce8`, tests `9dcf09b4599a98775d93d1e26a9947465524615a48a2a8a90af5b353f5baca0e`.
- 공통 Node 계약을 유지하되 실제 검증은 Windows에 한정한다. 제품 빌드·설치, Linux/macOS 수용은 수행하지 않았다.

실행 증거는 `artifacts/tasks/DN-01-disk-cleanup-candidates/runs/formal-custody-handoff-20261024-r3/reports/` 및 `grouped-relocation-20261024-r4/reports/`에 있다. 해당 보고서와 보존본은 원래 이관 영수증·후속 복구에 필요하므로 보존하며, 참조를 독립적인 대체 증거로 전환하고 복구 필요가 해소되면 새 review로 재정리한다.

# 실행 시간과 제한

앞선 개별 80개 경계의 native 처리에 약 한 시간이 걸려, 같은 승인 범위에서 신규 물리 이관 writer를 사용했다. 실행 중인 native 삭제는 끝까지 기다렸고 다음 묶음 전 안전한 참조 경계에서 이전 driver를 중단했다. 이전 완료 observer는 실제 취소로 기록했으며 성공으로 바꾸지 않았다. 작은 pilot 후 구버전 4개·미확정 498개 및 추가 75개를 전용 경계 4개로 이관했다. 추가 미확정 61개의 native 등록/검토는 14:08 KST경 시작했고 구버전 14개를 포함한 최종 삭제는 14:18 KST 이전에 끝났다. 이는 실제 이번 작업의 관찰이며 다른 디스크의 처리 시간 보장이 아니다. 중복 producer나 점유 lock 강제 해제는 없었다.

`git diff --check`와 작업 helper 5개의 `node --check`도 exit 0이다. r3/r4 보고서와 최종 source 검사 run은 native에 등록하고 fresh review 및 명시적 defer를 완료했다. 마지막 보고서 쓰기가 끝난 r4는 변경된 내용을 다시 등록한 후 최종 검토했다. 최종 등록·검토·보존 영수증은 등록된 payload 밖의 [보존 관리 기록](native-results/formal-custody-final-retention.json)에 있다. 원시 보고서·압축본은 커밋 대상에서 제외하며, 구현·검사·관련 문서만 task 단위로 커밋한다.
