상태: 승인된 정리 미완료. 구 빌드 삭제는 점유된 유지보수 잠금으로 실행 전 차단됐고, `n10a` 캐시는 전체 버전 묶음으로 확장되어 보류했다. 실제 삭제 0, 모든 대상 경로 잔존 확인.

## 목표·권한·범위
현재 프로젝트의 저장공간을 분석하고 절감 후보, 효과, 재생성 비용과 보존 조건을 제시한다. 사용자가 `artifacts/build/v11b`, `v11g`, `v11h` 및 관련 기록의 두 run 묶음과 `artifacts/n10a/engine/codex-rs/target` 캐시를 확인 후 정리하도록 승인했다. 해당 범위의 보호 검토·일반 삭제·결과 확인과 필요한 소유 기록 정합화만 수행한다. `n10a`의 부모 소스·배포본, 다른 캐시, 빌드·설치·제품 설정 변경·사용자 프로세스 종료는 범위 밖이다. Windows x64 로컬 checkout만 대상으로 하며 원격과 사용자 상태는 제외한다. 제품 플랫폼 지원 변경은 없다.

## 방법과 완료 기준
/root가 등록된 산출물의 기존 크기와 보호 검토를 재사용하고, 미등록 경로만 링크를 따라가지 않고 측정한다. 논리 크기와 실제 확보량을 구분한다. 큰 후보별 보존 조건과 재생성 비용을 보고하면 검토 완료다. 기존 작업과 고정 입력은 보존하며 삭제 실행에는 별도 지시가 필요하다. 제품 코드 변경이 없어 제품 테스트 및 아키텍처 수정은 필요하지 않다.

## 측정 결과와 한계

- 미등록 경로 측정: 파일 4,567,008개, 논리 크기 합계 643.63 GiB. 등록 경로 216개와 링크/재분석 지점 460개는 내려가지 않았다. 실행 455.39초, 실제 exit 0. [측정 도구](scan.py), [상세 결과](sizes.json).
- 등록 목록은 항목 436개/묶음 250개를 페이지별로 조회했다. 남아 있다고 기록된 항목의 기존 논리 크기는 40.22 GiB이나, 새 검토에서 `artifacts/build/b12`의 부재를 확인했다. 이 수치를 최신 실측 총량 또는 확보량으로 사용하지 않는다. [등록 목록](registered-snapshot.json), [큰 묶음의 새 보호 검토](registered-review.json).
- 측정 중 C: 여유 공간은 14.54 GiB였다. 현재 작업의 생성·삭제로 계속 변할 수 있다.
- 경로 오류 2,141개는 모두 WinError 3이었다. 긴 경로 표본 3개는 Windows 확장 경로로 읽기에 성공했다. 나머지 오류 경로는 재측정하지 않았으므로 누락분은 알 수 없다. 논리 크기는 하드링크를 경로별로 세며 압축·실제 할당량을 반영하지 않는다. 따라서 미등록 측정과 기존 등록 크기를 합산해 정확한 프로젝트 크기나 회수량으로 제시하지 않는다.
- 실행 중인 `cargo.exe` PID 30012와 `rustc.exe` PID 31908의 선택 인자는 Windows x64 test 프로필 및 `engine/codex-rs/target/x86_64-pc-windows-msvc/debug/deps`를 가리켰다. Azrael/bridge 실행 파일들은 `artifacts/build/b13/artifacts/releases/` 아래를 사용했다. 관측 당시 상태이며 삭제 직전 재확인이 필요하다.

## 절감 후보와 우선순위

아래 크기는 서로 중첩될 수 있으므로 행을 합산하지 않는다. 등록 항목은 기존 측정 크기, 미등록 항목은 이번 관측 크기다.

| 순서 | 대상 | 논리 크기 | 판단과 실행 조건 |
| --- | --- | ---: | --- |
| 1 | `artifacts/build/v11b`, `v11g`, `v11h`와 같은 두 run의 소규모 증거 | 8.57 GiB | 새 등록 모드 검토에서 5개 구성원 모두 blocker 없음. `release-2026-0-11-r2`, `release-2026-0-11-r12` 두 묶음 전체가 후보다. 삭제 승인 후 설치·실행 및 필요한 증거 참조를 확인하고 fresh review 토큰으로 적용한다. 현재 검사만으로 확정 확보량을 보장하지 않는다. |
| 2 | `artifacts/n10a/engine/codex-rs/target` | 29.33 GiB | 구 배포 입력 아래의 별도 Cargo 캐시. 부모 `n10a` 전체는 43.03 GiB이며 과거 runtime/source 참조가 있다. 캐시 재사용·검증·복구 참조 종료와 소유 확인 후 캐시만 정리하는 방안을 권고한다. 삭제하면 다음 관련 컴파일 비용이 증가한다. |
| 3 | `engine/codex-rs/target/debug` | 49.61 GiB | 명시 target 없는 native 캐시로 보인다. 형제인 명시 Windows target 캐시와 빌드 조건이 다를 수 있어 중복 폐기로 확정하지 않는다. 현재 producer 종료 후 실제 소비자와 필요한 target 의미를 확인한다. |
| 보존 | `engine/codex-rs/target` 전체 | 289.82 GiB | 위 49.61 GiB 및 Windows 명시 target 240.21 GiB를 포함한다. 실제 Rust 작업이 사용 중이므로 지금 정리하지 않는다. 작업 종료 뒤 incremental 부분 정리와 전체 cold rebuild의 시간 비용을 비교한다. 이번 측정은 해당 하위 incremental만의 크기를 별도로 집계하지 않았다. |
| 보존 | `artifacts/verification/da1/target-daemon` | 60.55 GiB | DA-01의 진행 중 검증용 별도 캐시다. 공용 캐시 점유를 피하기 위해 별도 생성했다는 작업 근거가 있다. 작업 완료·검증 결과 인계·소비 참조 해제 후 재검토한다. |
| 보존 | `artifacts/verification/AK-02-api-context-fix/target` | 41.09 GiB | AK-01 작업 기록은 구현·재현 검증 중이다. 오래된 경로명만으로 미사용이라고 판단하지 않는다. 소유 작업의 완료·복구 필요 여부 확인 후 재검토한다. |
| 후속 | `artifacts/build`의 미등록 부분 | 101.63 GiB | `v11k` 12.62, `v11f` 8.92, `v11e` 7.75 GiB 등 고정 입력과 중첩 검증 사본이 크다. 실행 중 `b13` 4.88 GiB도 포함하므로 일괄 삭제할 수 없다. 완료/실패 진단이 끝난 묶음부터 소유·참조를 확인하고 정리한다. 1번 등록 사본들은 이 측정에서 제외했다. |
| 후순위 | `artifacts/cache`, `artifacts/tools` | 4.58 / 17.17 GiB | 캐시에는 modules 2.43 GiB가 있고 도구에는 rusty-v8 소스 4.94, clang/LLVM 3.98 GiB 등이 있다. 기존 lease·설치 참조·도구 재사용 조건을 보존한다. 대형 Cargo 캐시와 완료된 작업 사본 정리가 우선이다. |

다른 큰 등록 항목은 아직 실행 후보가 아니다. `u17a` 4.43 GiB에는 u17b 소비 참조, `u22c`와 `q` 합계 8.11 GiB에는 설치/수용 참조가 남아 있다. `n9d`/`n9e` 합계 10.65 GiB에는 사용 보호 미확인 및 관리 루트 밖 차단이 있다. CX 검증 묶음은 producer 구성과 native 등록 구성이 다르다. 관련 소유자가 실제 참조와 구성을 정합화하기 전에는 삭제하지 않는다. `b12`는 이미 없으므로 절감 후보에서 제외한다.

## 권고안과 재발 방지

1. 우선 8.57 GiB의 두 구 run 묶음을 정리 대상으로 선택한다. 이것만으로 장기적인 증가 문제는 해결되지 않는다.
2. 다음으로 `n10a`의 별도 캐시 29.33 GiB와 완료된 고정 입력/검증 사본을 검토한다. 현재 지원되는 원본·설치본 전체를 삭제하는 방식은 선택하지 않는다.
3. 진행 중 컴파일 종료 뒤 주 캐시의 필요한 target/profile 조합과 incremental 보존 범위를 정한다. 캐시 삭제와 재컴파일 시간의 교환을 사용자가 선택해야 한다.
4. 생성 단계에서 호환되는 Cargo 캐시를 공유하고, 별도 캐시는 점유 경합·시간·공간 비용이 정당할 때만 만든다. 완료 시 기존 lifecycle/관리 도구를 통해 검증 사본과 불필요한 캐시를 정리한다. 기간·예산 초과를 자동 삭제 허가로 바꾸지 않는다.
5. 이미 `engine/codex-rs/Cargo.toml`에 `dev-small` 프로필(debug none, strip symbols)이 있다. 일반 dev/test는 이미 line-tables-only다. 추가 축소가 필요한 검사에서 기존 프로필의 적용 가능성을 먼저 실험하되, 디버깅 정보 손실과 별도 프로필 캐시 생성 비용이 있어 일괄 전환은 권고하지 않는다. 이번에는 프로필을 변경하거나 제품 검사를 대체하지 않았다.

기존 `scripts/clean-engine-caches.ps1`, `scripts/clean-legacy-releases.ps1`, module-cache owner, `project_cleanup_review/apply`를 재사용할 수 있다. 단, source snapshot과 임의 경로가 모든 cleaner의 범위에 들어가는 것은 아니다. `.git`은 약 0.46 GiB로 공간 절감 우선순위가 낮으며 Git 복구 이력을 손대는 정리는 권고하지 않는다. 사용자 계정·대화 데이터는 별도 작업 범위다.

## 완료와 다음 결정

분석에 이어 사용자가 1번과 2번의 확인 후 정리를 승인했다. 권한은 그대로 유지되며 같은 대상의 재시도에 새 승인을 요구하지 않는다. 제품 코드·설정·실행 중 입력과 대상 파일은 변경하지 않았다. 원격·타 플랫폼 검증 및 제품 테스트는 수행하지 않았다.

## 승인된 정리의 실행 결과와 재시도 조건

실행 증거: [result.json](../../artifacts/tasks/DH-01-project-storage-review/runs/approved-cleanup-r1/result.json), [최신 구 빌드 묶음 검토](../../artifacts/tasks/DH-01-project-storage-review/runs/approved-cleanup-r1/registered-review.json), [차단 근거](../../artifacts/tasks/DH-01-project-storage-review/runs/approved-cleanup-r1/blocked-attempt.json). 생성 전에 `/root` 소유의 `run:DH-01-project-storage-review:approved-cleanup-r1`로 보고서 경계를 등록했다. 작업은 실패로 종료하고 증거를 보존했으며 성공으로 바꾸지 않았다.

- 구 빌드 두 묶음의 최신 registered 검토는 5개 구성원 모두 blocker 없음이었다. 설치 runtime 설정·확장 등록·사용자 설정에서 선택 경로의 검색 일치는 없었고, 실행 프로세스의 executable/command-line에서도 선택 경로 참조를 관측하지 않았다. 경로 일치가 없다는 결과를 모든 사용 부재의 증명으로 확대하지 않는다.
- `project_cleanup_apply`는 `exclusive maintenance lock unavailable (abandoned locks require explicit recovery): file exists (os error 80)`로 잠금 획득 전에 실패했다. 이 호출의 파일 삭제는 0이다. 잠금에 기록된 PID 61016은 실행 중인 `b13/w11aa`의 Azrael 엔진이었다. 추가 읽기는 파일 공유 위반도 관측했다. 점유 잠금을 삭제하거나 엔진·다른 작업을 종료하지 않았다.
- 최대 5분의 읽기 전용 파일 이벤트 감시 helper를 실행했으나 종료 signal은 오지 않았다. 기한 뒤 정확한 helper PID는 없고 signal/임시 signal도 없었다. helper 종료 코드는 미확인으로 유지했다. 직접 확인한 유지보수 잠금과 소유 엔진은 여전히 존재했다. 완료 신호 기록은 failure/exit null로 남겼으며, 잠금 해제나 삭제 성공으로 해석하지 않는다.
- `n10a`는 native 등록 항목이 없지만 producer catalog의 `version:w10a`가 부모 전체와 `artifacts/tasks/windows-2026-0-10` 증거를 소유한다. 기존 lifecycle plan은 blocker가 없더라도 캐시 한 경로를 전체 버전의 두 root로 확장한다. 캐시만 승인받았으므로 이 확장 삭제는 실행하지 않았다. 캐시 cleaner도 해당 사용자 정의 snapshot 캐시만 퇴역시키는 독립 경계가 확인되지 않아 다른 API로 우회하지 않았다.
- 최종 확인은 구 빌드 3개, 관련 run 기록 2개, `n10a` 캐시가 모두 실제 남아 있음을 확인했다(검사 명령 exit 0). 이번 작업에 귀속되는 회수 공간은 0이다. 다른 작업으로 바뀐 C: 여유 공간을 정리 성과로 계산하지 않는다.

재시도 조건: 구 빌드는 소유 유지보수 작업의 정상 종료와 잠금 해제 후 새 검토·토큰으로 동일 두 묶음만 다시 적용한다. `n10a`는 소유자가 소스·배포·증거 보호를 유지하는 검토된 캐시 단독 소유 경계를 지원한 뒤 해당 캐시만 preview/apply한다. 현재 보호 경계를 넓히거나 기존 묶음 보호를 약화하는 변경은 이번 정리에서 수행하지 않았다.

## 잠금 해소 후 후속 — 2026-10-23

최신 사용자 요청은 구버전의 잠금 해제와 삭제이며 기존 두 run 묶음 삭제 승인도 유지된다. 2026.0.10 이하 51개 구간의 수치와 별도로 이 기존 승인 5개 구성원(약 8.57 GiB)을 처리한다. 현재 실행 중인 Windows9 owner 정리가 catalog.lock을 정상 점유하므로 그 완료 뒤 해당 두 등록 묶음의 최신 참조를 registered 모드로 검토한다. 조회 불가를 내용 변경으로 간주하거나 payload 재해시를 다시 시작하지 않는다. 현재 설치·실행·외부 프로필의 실제 참조가 있으면 해당 그룹 전체를 보류한다.
