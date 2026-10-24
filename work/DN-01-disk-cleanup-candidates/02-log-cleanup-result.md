이 문서는 r1 분류 시점의 기록이다. 후속 이관·삭제의 현재 결과는 [최종 결과](05-formal-cleanup-result.md)를 따른다.

당시 상태: 로그 분류 완료, 삭제 보류. 실제 삭제 0건·확보 0바이트. 보관 보호의 정식 이관 및 남은 버전/참조 확인이 필요했다.

# 결과

2026-10-24 Windows 로컬에서 `artifacts/logs`의 직계 항목 846개를 소유·버전 근거별로 논리 묶음으로 분류했습니다. 원래 로그 위치를 옮기거나 내용·참조를 수정하지 않았습니다. 기존 관리 묶음 내부는 재스캔하지 않았으며, 소유 미확정 보관 경로를 조사한 부분은 파일 53,075개, 약 2.75GiB, 링크 0개, 조회 오류 0건입니다. JSON/로그의 제한된 구간에 나온 버전 문자열은 후보 근거이며 소유 제품 버전의 확정이 아닙니다. 기존 관리 범위의 크기는 이 수치에서 제외됩니다.

| 분류 | 직계 항목 수 | 추가 조사 논리 용량 | 처리 |
|---|---:|---:|---|
| 2026.0.10 이하 문자열만 발견된 구버전 후보 | 36 | 약 1.08GiB | 전부 legacy custody 보호와 연결되어 보류 |
| 버전 문자열 혼재/오류 가능 | 1 | 약 0.25MiB | 보존. `linux-behavior-audit-20261013`의 자유문장에 `2026.0.504`가 있어 최신 버전으로 확정하지 않음 |
| 제품 버전 미확정 | 795 | 약 1.67GiB | 이름·날짜만으로 삭제하지 않고 보존 |
| 기존 관리 묶음에 포함된 직계 항목 | 14 | 재측정 안 함 | 소유 관리 절차와 기존 참조 보존 |

이 분류는 폴더 이름을 바꾸는 방식이 아니라 경로·소유 그룹·버전 근거·처리 사유를 연결한 인덱스입니다. 원본 경로를 유지하여 문서·설치/검증 reader가 깨지지 않게 했습니다. 상위 경로 안의 별도 관리 하위 묶음은 독립 소유를 그대로 유지했습니다.

주요 구버전 후보: `AF-01-resume-install` 약 655.69MiB, `app-release-2026.0.4` 약 107.72MiB, `linux-context-hotfix-20261012` 약 51.59MiB, `mac-release-2026.0.5` 약 48.02MiB. 첫 폴더에는 감사 보고서가 언급하는 여러 버전도 섞여 있어 전체를 특정 제품 버전에 확정 귀속하지 않았습니다.

# 삭제를 보류한 근거

- 구버전 후보 36개 모두 `work:BI-01-legacy-custody:20261019`의 경로 보호와 연결되어 있습니다. 이 기록의 member는 `generated:false`, `protection_known:false`이며, 관찰만으로 원래 생성 소유를 획득하지 않습니다.
- 현재 `scripts/artifact-lifecycle.cjs`의 supported `record`는 기존 보호 member의 false→true 승격을 `Cannot promote protected lifecycle member`로 거부하도록 구현되어 있습니다. 이번 조사에서 해당 보관 기록을 정확한 새 소유자에게 정식 이관하는 지원 경로는 확인하지 못했습니다. 원시 registry 수정, 중복 그룹 생성, 강제 삭제로 우회하지 않았습니다.
- `input-loss-fix-20261002`는 `work:legacy-input-loss-review`의 `work-with-unique-backups`로 보존되어 있어 단순 구버전 로그로 삭제하지 않았습니다.
- 기존 native 로그 묶음 9개·구성원 12개를 fresh review한 뒤 전부 명시적 defer로 기록했습니다. apply는 `aborted:false`, 모든 그룹 `deferred`, 실제 삭제 없음입니다. 예를 들어 BZ-01은 native 차단 사유가 없더라도 기존 작업 계획이 다음 설치 창 검증의 증거 이관 때까지 보존을 요구합니다. AV-01 역시 대체 UI 검증까지 보존 대상입니다.
- 현재 실행 runtime은 여전히 `artifacts/build/b13/artifacts/releases/w11aa/engine/azrael.exe`입니다. 해당 2026.0.11의 `artifacts/build/b13/artifacts/logs`, 기존 2026.0.10의 `artifacts/n10a/artifacts/logs`, 외부 설치 u22c의 nested logs 존재도 확인했으며 이번 `artifacts/logs` 조사 밖에서 보존했습니다. 모든 디렉터리를 전역 버전 분류했다고 주장하지 않습니다.

적용한 [implementation 정리 규칙](C:/Users/felre/.azrael-ex/skills/implementation/references/artifact-lifecycle.md#review-and-group-decisions)은 다음을 요구합니다: “Protect the whole selected group if any member is an active input, running output, pending handoff, required release evidence, sole usable recovery copy, user/source file, or has unknown ownership/use.” 이 지침은 보호 상태를 우회하는 일괄 삭제를 허용하지 않습니다. 추가 사용자 확인이 필요하다고 해석한 부분은 별도 관리 기능·소유권 이관 절차 보완이며, 현재 요청의 로그 정리 권한을 다시 요구하는 것이 아닙니다.

# 증거와 다음 단계

- [분류 목록 CSV](../../artifacts/tasks/DN-01-disk-cleanup-candidates/runs/log-version-cleanup-20261024-r1/reports/version-groups.csv)
- [경로별 소유·버전 근거 JSON](../../artifacts/tasks/DN-01-disk-cleanup-candidates/runs/log-version-cleanup-20261024-r1/reports/version-groups.json)
- [기존 묶음 fresh review](../../artifacts/tasks/DN-01-disk-cleanup-candidates/runs/log-version-cleanup-20261024-r1/reports/native-review.json), [defer 적용 결과](../../artifacts/tasks/DN-01-disk-cleanup-candidates/runs/log-version-cleanup-20261024-r1/reports/native-decisions.json)
- [범위 메타데이터](../../artifacts/tasks/DN-01-disk-cleanup-candidates/runs/log-version-cleanup-20261024-r1/reports/log-inventory.json), [producer catalog 스냅샷](../../artifacts/tasks/DN-01-disk-cleanup-candidates/runs/log-version-cleanup-20261024-r1/reports/producer-catalog.json)

정리 실행을 이어가려면 구버전 후보의 실제 producer·연결 payload·현재 consumer를 확인하고 legacy custody를 검증된 소유자로 정식 이관해야 합니다. 지원 경로가 필요한 부분은 관리 기능의 별도 보완 범위로 결정해야 합니다. 이후 현행 버전이 요구하는 최소 검증 증거를 이관하고 해당 구버전 묶음 전체를 fresh review/apply합니다. 단순히 보호 플래그를 바꾸거나 원시 registry를 수정하는 작업은 제안하지 않습니다.
