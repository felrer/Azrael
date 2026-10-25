상태: 승인된 외부 테스트 프로필·연결 빌드의 실제 삭제 및 소유 기록 마감 완료. 확정 구버전 삭제량20,168,314,374 B(약18.78 GiB). 검증·실행 임시 산출물392,266,690 B도 별도 정리 완료. Windows native120개 통과. 작업 커밋 identity는 reports/task-commit.json에 기록하며 보호 근거가 남은 원래 전체 삭제 요청은 일부 보류다.

# 2026.0.11 이하 생성물 정리

## 목표·권한·보호 범위

사용자는 구버전 캐시·빌드·로그 전체 정리로 용량 확보를 요청했다. 외부 av17/av18의2026.0.10 설치본과 연결 빌드, 외부 테스트 프로필 전체의 설정·인증·대화·세션 폐기를 각각 명시적으로 승인했다. 이후 관리 도구 보완·검증 후 계속 정리를 승인했다. u17a의 원래 전체 소비 근거를 복원하지 못하면 캐시 프로젝트 등록을 유지한다.

Windows x64 로컬 작업이다. 공통 Rust 관리 정책의 보호 의미는 지원 플랫폼 전체에서 유지하며 실제 검증을 Linux/macOS 수용으로 확대하지 않는다. 일반 사용자2026.0.12와 사용자 데이터는 삭제 범위 밖이다. 원격 정리·일반 제품 빌드·설치·사용자 프로세스 종료는 수행하지 않았다. 기존 소스·staged 변경을 보존한다.

## 방법과 안전 조건

등록 묶음은 native 등록/review/apply를 사용하고 참조·빈 기록은 canonical lifecycle release/finalize로 정합했다. exact generated 경로의 ReadOnly만 native가 일반화했다. force·ACL/소유권/System 변경·원시 registry 편집·점유 잠금 삭제는 하지 않았다. 실제 item status/remaining과 호출의 terminal을 확인하며 논리 삭제량과 물리 디스크 회수량을 구분한다.

중첩 정리는 기존 retirement 증거·검토 토큰·durable apply를 재사용한다. 같은 소유자의 서로 다른 완결 묶음에 각각 live 항목 하나가 있고 엄격히 중첩될 때만 parent defer/child delete를 허용한다. 양쪽 stale token·참조·보호를 검사하고, 상위 구성/근거/루트도 삭제 직전 재검사한다. 하위 삭제 시 상위 재등록 필요 표시를 남기며 상위는 full 등록과 fresh ordinary review 후 별도로 삭제한다. 일반 중첩 보호를 제거하지 않는다.

## 실제 구버전 삭제 결과

| 대상 | 확인 논리 크기 | 결과 |
| --- | ---: | --- |
| 2026.0.11 r5 실패 실행 로그 | 443274B | deleted/remaining=false, finalize 완료, 원래 실패/exit1 유지 |
| u17a 빌드·연결 실행 자료 | 4773551172B | 두 멤버 deleted/remaining=false, finalize 완료 |
| av17/artifacts/f 전체 테스트 프로필 | 3082290827B | deleted/remaining=false, finalize 완료 |
| u22c 내부 릴리스·빌드 로그·빈 Cargo pending | 898634463B | 세 멤버 deleted/remaining=false, 원래 두 기록 finalize |
| u22c 과거 외부 설치 영수증·복구 registry 사본 | 9650B | 원본 독립 보존 후 generated 배포 폴더 deleted/remaining=false |
| av18/artifacts/f 전체 테스트 프로필 | 3606930455B | nested 처리 후 full 등록·ordinary apply exit0/deleted/remaining=false, 원래 pending 상태 보존한 retirement finalize |
| q 연결 테스트 fixture | 2997330105B | deleted/remaining=false |
| u22c 나머지 source/build snapshot | 4809124428B | 검증 실행기 actual exit0/deleted/remaining=false, q와 함께 원래 complete producer finalize |
| 합계 | 20168314374B, 약18.78GiB | 물리 회수량은 native 미측정 |

먼저 삭제한 u22c 내부 자료는 이후 상위의 새 측정값에서 제외돼 중복 집계하지 않는다. av18 nested child는 실제 삭제됐지만843B는 과거 cached 수치여서 합계에서 제외했다. 상위 full 재측정값3606930455B만 실제 삭제 후 합산했다. 현재 작업이 만든 검증용 산출물의 정리는 구버전 회수량과 별도로 기록한다.

상세 결과는 reports의 r5/u17a/av17 apply, u22c-internal-apply, u22c-deployment-retirement-apply, av18-parent-apply, u22c-final-apply-first, u22c-cli-apply 및 각 finalize JSON이 소유한다. 모든 counted 결과는 aborted=false/remaining=false다. ReadOnly 정상화는 u17a11152개, av17 34개, av18 42개, q34개, u22c34개이며 상세 before/after는 해당 원시 영수증에 보존한다.

## 설치·캐시 소비 정합

- 정확한 외부 extensions-dir/user-data-dir에서 VS Code CLI Azrael 제거 각각 exit0을 확인했다. av18 영수증의 별도 agent-user-data도 같은 extensions-dir을 사용하며 현재 Azrael 등록0을 확인했다. 이후 승인된 외부 f 전체를 native로 삭제했다.
- u22c의 원래 complete canonical consumer catalog, build-metrics, module 소비, q 최종 검사 및 historical hostInstalled=true 설치 영수증을 독립 보존했다. 원래 pending/unknown 실행을 성공으로 바꾸지 않았다. old runtime0, 정확한 outgoing cache 참조 해제, 내부 native 삭제·원래 기록 finalize 후 공유 module owner를 호출했다.
- 첫 module retire는 과거 설치 영수증 보호로 exit1/등록 변경0이었다. 원본과 복구 사본을 보존한 뒤 해당 generated 배포 폴더를 native로 정리했고, 재호출 exit0/status retired/registrationAbsent=true였다. .projects.json 전후 차이는 u22c 하나 제거뿐이다. u17a는 유지한다.

## 검증·공유 소스 통합

- r1: 고정 입력 typecheck0와 목록 컴파일0 이후 타 작업의 catalog lock 충돌로 wrapper1. 기존 binary 직접 검사는105pass/1fail였다. 새 검사에서 상위 재등록 강제가 빠진 점을 찾아 수정했다. 실패를 보존했다.
- r2: Windows x64 Rust stable1.98, locked/offline, typecheck·nonzero listing·execution 각각 exit0. native108/108 및 owner CLI 컴파일/실제 av18 nested→parent 삭제를 확인했다. binary SHA59c47085e97d97e5cbeebb339b8dc91db49863db1916ead9f7ef47319587bbb3. native-verification-r2.json과 native-evidence에 입력/실패/성공 근거를 보존했다.
- 공유 DT-01 lock recovery 변경(e0c448a0)은 별도 소유로 보존했다. 현재 전체 crate와 DT의 실제120개 통과 frozen source, Cargo.toml/lock/config/toolchain 및 utils/process 입력이 정확히 일치함을 확인했다. 해당 Windows actual exit0/typecheck0/listing120/execution0 증거를 재사용하고 integrated-native-evidence에 독립 보존했다. 이120개에는 이번 nested 회귀5개가 포함된다. 중복 컴파일하지 않았다.
- 기능 보존 목록 검증 exit0. 일반 제품 배포 빌드·설치는 없으며 설치된 도구가 새 소스로 갱신됐다고 주장하지 않는다. Linux/macOS 실행은 미검증이다.
- 새 회귀5개는 nested 소유·stale/참조/권한/membership 변경·상위 full 재등록 계약을 지속 보호하므로 유지한다. 작은 selected source/전체 입력 manifest·검증 로그는 원래 실패와 실제 삭제 근거를 독립적으로 검토하기 위한 감사 자료로 유지한다. 전체 source snapshot과 실행기 copy는 소비 종료 후 owner 경유로 정리 중이다.

## 동시 실행·잠금·재시도

q/u22c 첫 apply는 q 삭제 후 외부 프로젝트 관리 설정 변경을 감지해 u22c를 config changed during review로 차단했다. 새 검토 후 첫 재호출도 현재 다른 maintenance sentinel 때문에 시작 전 거절됐다(삭제0). 점유/소유 미확정 파일을 삭제하지 않았다. 검증 CLI helper는 정상 해제를 기다려14:03:23UTC fresh review,14:03:24UTC PID31584로 실제 apply에 진입했고14:25:47UTC actual exit0/deleted/remaining=false를 반환했다. 기존 caller의 실제 terminal을 확인한 뒤에만 재시도했다.

모든 구버전 삭제 호출은 terminal이다. 등록·삭제 완료 감시의10분 timeout은 원래 native 결과로 분류하지 않았다. 독립 루트의 병행은 실제 디스크 사용률1%/대기열0 관측 후 선택했고 같은 루트의 mutation은 직렬화했다. 실행 중 source/payload를 수정하거나 중복 producer를 시작하지 않았다. 부분 삭제·거절·원래 실패와 unknown은 그대로 보존한다. 중간 대기/재측정을 삭제 성능 개선 수치로 주장하지 않는다.

## 일반 사용자 프로필 보존 확인

최종 확인 general-profile-final.json에서 일반 extensions.json의2026.0.12 등록, VS Code settings.json, .azrael-ex/config.toml 세 파일의 해시는 모두 최초 기준과 같다. 중간 확인 general-profile-after-av18.json에서는 config.toml 해시가 달랐으나 최종 확인에서는 원래 해시와 일치했다. 이번 cleanup은 해당 파일을 쓰거나 복원하지 않았으며 중간 변경·복귀 주체/원인은 확인되지 않았다. 사용자 상태 전체 내용을 전수 검증했다는 뜻은 아니다.

## 잔여 보류·재검토 조건

| 대상 | 유지 근거 | 재검토 조건 |
| --- | --- | --- |
| 삭제된 u17a의 module 프로젝트 등록 | parent payload 삭제 전 별도 소비 등록을 놓쳤다. 독립적으로 보존된 원래 전체 내부 소비 목록을 확인하지 못했다. inspect-legacy는 ready-for-proof이나 schema3 proof는 미충족 | 원래 complete consumer index를 독립 근거로 복원하고 정확한 schema3 proof/지원 owner를 통과할 때만 해제 |
| e10 | 원래 generation/usage 보호 미확정, configured managed roots 밖 | 실제 소유·소비와 정식 관리 경계 근거 확인 |
| n10a/w10e 및 구 source/cache 프로젝트 | 기존 latest/설치·공유 소비·원래 catalog 정합 보호 유지 | 원래 owner의 정상 퇴역·replacement/recovery·소비 해제 후 fresh review. 부모 통삭제로 등록 유실을 추가하지 않음 |
| v11 계열 등 원래 link/누락 구성 보호 | 이전 owner/native가 거부했던 원래 구성·링크 관계를 임의 변경하지 않음 | exact 원래 소유·현재 링크/구성 및 지원 등록 근거를 확인한 후 재검토 |
| b12 | 원래 absent/remaining=false, producer source 누락 | 원래 metadata 정합. 이번 용량 집계에서 제외 |

n10a의 과거 w10b/c/d 기록은 현재 catalog에 없어 과거 보고만으로 이번 삭제라고 집계하지 않는다. 잔여 원래 소유의 정합이 완료될 때 작은 helper/요청·상세 증거의 추가 정리도 검토한다. 현재 구버전 payload 정리 근거·감사 자료는 보존한다.

## 현재 후속 작업

검증 snapshot r1/r2는 지원 native 등록·fresh review/apply에서 둘 다 deleted/remaining=false, 실제 exit0으로 정리하고 원래 producer를 finalize했다. 이번 작업이 생성한389,748,693 B는 구버전 회수량과 별도다. work completion09a8de7d-c133-49bd-a4f8-861a3b2f55ce와 helper session54610은 성공 종료했다. 검증 binary를 정리 대상 밖의 소유 run에 SHA 고정 복사했으며 실행 중인 maintenance_owner.exe는 없음을 확인했다.

cleanup run 및 u22c 실행 run의 작은 산출물2,517,997 B도 정상 잠금 해제 후 native 등록·fresh review/apply에서 모두 deleted/remaining=false, aborted=false를 확인하고 canonical finalize했다. small-run-apply.json, small-run-finalize.json 참조. 대기 work completion7da2217f-47aa-4f39-8ba7-743a30a4c82a 및 observer session94527도 실제 성공 종료했다. 작업 helper node 프로세스가 남지 않았음을 확인했다. 이번 검증·실행 임시 산출물의 별도 정리량은 합계392,266,690 B다.

최종 task diff는 소스6개, ops 문서, architecture의 중첩 폐기 문단, feature owner 경로2개, 이 기록의10개 파일로 한정한다. 타 작업 staged4개와 Windows background_command 문단·paths.rs·다른 feature 변경은 포함하지 않는다. 임시 Git index에서 diff --check 및 정확한 파일 목록을 확인하고, 현재120개 통과 소스의 동일성을 재검사한 뒤 task commit을 기록한다. 실제 commit identity는 reports/task-commit.json에 기록한다. 원격 push는 하지 않는다. 원래 잔여 보호 대상은 위 표의 재검토 조건을 유지한다.
