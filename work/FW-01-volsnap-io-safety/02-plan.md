상태: 통합 개선 1~5단계 구현·검증 진행 중. 사용자가 권장 정책을 포함한 개선을 승인했다. 기존 제한 VSS·삭제 시험과 정리는 완료했다. 기본 실행기/앱 설치와 live 저장 형식 이관은 제외한다.

# 잠금·삭제·묶음 처리 통합 개선 계획

## 요청과 결정 범위

목표는 4개를 넘는 세션의 집중 요청을 재시도 폭주 없이 수용하고, 관리 잠금 보유와 중복 검증을 줄이며, 안전 조건 안에서 전체 완료시간을 최소화하는 것이다. Volsnap25를 관측 대상으로 유지하고 Windows bugcheck 재현은 제외한다. 기존 사용자의 실제 삭제 종료 대기 조건과 시험 한도는 유지한다.

사용자가 승인한 산출물은 아래 1~5단계의 소스·호출자·검증 개선이다. 아래 동작은 승인된 목표이며 실제 구현/검증 상태와 구분한다. 실제 기본 실행기/앱 교체와 저장 형식 이관은 6단계에서 검증된 대상과 영향을 제시한 뒤 별도로 승인받는다.

| 결정할 정책 | 권장안과 영향 |
| --- | --- |
| 경합 처리 | Azrael 관리 호출자는 한 번 접수하고 요청 ID로 대기/결과를 추적한다. 충돌 대상 안에서 접수 순서를 지키되 무관한 요청은 앞 요청을 추월할 수 있다. 저수준 CLI의 명시적 즉시 반환 모드는 호환성을 유지한다. |
| 대기열 한도 | 초기 제안은 프로젝트당 대기 256건, 세션당 32건, 기본 대기 기한 10분이다. 중복 합류는 별도 실행으로 계산하지 않는다. 초과는 재시도 가능 상태와 대기 안내를 반환한다. 수치는 검증 후 확정하며 무제한 접수·즉시 재호출은 하지 않는다. |
| 삭제와 사용 요청 순서 | 이미 사용 중인 소비자를 강제 종료하거나 참조를 제거하지 않는다. 삭제가 접수된 후 같은 대상을 새로 사용하는 요청은 삭제 뒤에 대기시켜 기아를 막는다. 삭제 실행 후 대상이 없으면 사용 요청은 대상 부재로 끝난다. 참조 해제·완료 기록은 대기열을 우회해 진행할 수 있어야 한다. |
| 승인 유효성 | 대기 중 대상 identity·소유·구성·보호 등 승인 근거가 바뀌면 재검토 필요로 반환한다. 오래된 token을 자동 갱신해 삭제 권한을 확대하지 않는다. |
| 병렬 삭제 | 기본은 물리 디스크당 1개, 검증을 통과한 경우 최대 2개로 확대한다. 물리 디스크를 식별하지 못하면 공유하는 보수적 한도를 쓴다. 서로 다른 볼륨/VHD가 같은 디스크를 쓸 수 있음을 반영한다. |
| 취소와 장애 | 대기 취소는 해당 요청자의 대기만 취소한다. 실행 이후에는 다음 안전 경계에서 새 삭제를 중단하고 이미 시작한 OS 작업의 실제 종료를 기다린다. unknown은 자동 재실행·예약 해제하지 않는다. |

## 근거와 한계

- 구현 시작 시 기존/동시 변경을 보존할 Git baseline: 설계 `5a71f5f9b4e7c3eea90ddc41a662c2fd2589a544`, `lib.rs` `f779a1d9c672e169f0a79cf345c82da86199d9ff`, `groups.rs` `10e8c1547e30785682119971c3c85f4e242d948a`, `apply.rs` `2e032d07dc0e3ee2447f55bf973ba67947a4576d`. task delta만 분리해 검토·커밋한다.

- 설치본의 기존 80항목 표본은 전체 46.5~50.3초, 관리 잠금 161회/누적 8.35~9.21초, 그룹 예약 46.1~49.8초, 반복 current_review 34.1~36.7초, 물리 삭제 1.66~1.82초였다. 포함 관계인 구간은 합산하지 않는다. 해당 표본에는 실제 대기열 경합이 없으므로 현재 다중 세션 지연의 정량 증거로 쓰지 않는다. 근거: [성능 기록](../FF-01-maintenance-contention-timing/73-ancestor-reservation-performance.json).
- 반복 전체 그룹 검토는 구성원 수에 따라 제곱 수준의 작업을 만들 수 있다. 전역 잠금 밖의 검토라도 그룹 예약을 오래 유지한다. 따라서 관리 잠금만 바꾸어서는 충분하지 않다.
- 기존 개선 커밋 `6f9e8e62`와 258개 Windows 검증은 완료됐지만 기본 설치본 전환은 별도다. 현재 작업 트리와 설계 문서에는 다른 작업의 변경이 있으므로 해당 소유자·고정 입력·검증 범위를 먼저 대조한다.
- [실제 삭제 시험](09-deletion-trial.json)은 설치된 standalone에서 32디렉터리·16,384파일·1GiB 삭제 성공, 새 Volsnap25 0건이다. 다중 세션 동일 대상 시험이나 개선 후보 비교가 아니며 원인 규명·재발 방지의 증거는 아니다.

## 목표 구조와 안전 조건

흐름: 요청 접수/동일 요청 합류 → 충돌 범위별 대기 → 짧은 관리 트랜잭션에서 재검증·예약 → 잠금 밖 측정/삭제 → 짧은 결과 반영 → 완료 통지.

1. **관리 잠금**은 상태 snapshot, 원자적 예약 획득, revision/fence 비교, intent/result commit에 사용한다. payload 해시·전체 디렉터리 탐색·물리 삭제·완료 대기를 이 잠금 안에서 수행하지 않는다. 여러 catalog가 필요하면 기존 정렬된 잠금 순서를 유지한다.
2. **범위 예약**은 파일·하위 트리·묶음의 실제 충돌을 보호한다. 문자열 prefix만 비교하지 않고 정규화 경로·조상 관계·볼륨/파일 identity와 기존 reparse/hardlink 경계를 사용한다. 판단이 불명확하면 병렬 실행을 허용하지 않는다. 검사와 예약 획득은 원자적으로 처리한다.
3. **사용 참조**는 잠금과 분리한다. 참조가 남으면 삭제하지 않는다. 승인된 소비자 갱신·참조 해제와 삭제 admission을 같은 owner 경계에서 조정한다. 이 규칙을 우회하는 외부 앱의 파일 핸들은 OS 실패로 처리하며 완전한 외부 사용 추적을 보장하지 않는다.
4. **묶음**은 소유·보호·정리 단위로 유지한다. 한 구성원의 보호는 전체 묶음을 보호한다. 동시 요청이 같은 묶음의 다른 구성원을 따로 실행하지 않도록 한다. 초기 병렬화는 독립 묶음/요청 사이에 적용하고 묶음 내부 삭제는 순차 실행한다. 보호 의미를 바꾸는 임의 분할은 하지 않는다.
5. **대기열**은 모든 참여 프로세스가 같은 상태를 보도록 native owner가 소유한다. 기존 OS 잠금·예약·반환 알림·내구성 저장을 재사용하고, 별도 상주 서비스 도입은 기본 범위에서 제외한다. 기다리는 동안 관리 잠금·불필요한 실행 슬롯을 점유하지 않는다. 알림은 재확인 신호이며 승인이나 완료 근거가 아니다.
6. **중복 제거**는 프로젝트 identity, 소유 generation, 정확한 대상/구성, operation, verification, 승인 근거가 같은 요청에만 적용한다. 각 요청자의 권한은 별도로 확인한다. 같은 경로라도 다시 생성된 파일은 다른 대상이다. 요청자 연결 종료는 이미 시작한 삭제의 성공/취소로 처리하지 않는다.
7. **내구성**은 삭제 전 intent, 삭제 후 실제 결과를 유지한다. 저장 횟수를 줄이기 위해 이 경계를 생략하지 않는다. 요청 접수·실행권·결과에도 generation/fence를 둬 이중 실행을 차단한다. 재시작 후 대기 요청은 재검증하고, 실행 중이던 요청은 정확한 producer 종료·실제 결과를 확인하기 전 재실행하지 않는다.
8. **공유와 배타 사용**을 구별한다. 허용된 읽기 소비자는 여러 세션이 함께 참조할 수 있지만 구성 변경·삭제는 충돌 범위에서 배타적으로 진행한다. 여러 범위가 필요한 요청은 일부 예약을 쥔 채 나머지를 기다리지 않는다. 공유 catalog와 물리 디스크 예산은 같은 저장소를 사용하는 여러 프로젝트·진입점에도 적용한다.
9. **접수는 삭제 승인과 다르다.** 권한이 없는 요청은 대기열에도 넣지 않는다. 사용 참조 때문에 보호된 대상은 보호 사유를 표시하며, 참조 해제로 승인 근거가 달라지면 필요한 새 검토를 요구한다. 부적격 요청이 신규 사용을 무기한 막지 않도록 대기 기한·취소·재검토 종료 상태를 적용한다.

## 구현 순서·소유 경계·산출물

| 단계 | 작업과 선행 조건 | 주요 소유 범위·산출물 | 다음 단계 조건 |
| --- | --- | --- | --- |
| 1. 기준 확정 | 설치 binary, 선행 커밋, 현재 변경과 호출자를 대조한다. 기존 6병렬 서로 다른 대상 시험과 같은 대상 경합 시험을 구별한다. | root 통합; native/caller 경계표, 고정 비교 입력, 기존 timing을 활용한 단계별 측정 | 재사용할 구현과 누락된 계약 확정 |
| 2. 잠금·반복 작업 축소 | snapshot→잠금 밖 측정→짧은 재검증/CAS로 begin_run/validate_step 및 남은 무거운 구간을 옮긴다. 관련 없는 변경은 필요한 대상만 재검증한다. | `lib.rs`, `planning.rs`, `storage.rs`, `registry.rs`, `groups.rs`, `review_relations.rs`/기존 재사용 모듈; 검토 결과 무효화 조건 | 예약·참조·권한 변경 검출 유지, 반복 전체 그룹 순회 감소 확인 |
| 3. 접수·대기·중복 합류 | 단계1에서 queue/request ID/status/cancel 계약을 먼저 고정한다. 충돌 범위별 순서와 대기 한도, 참조 해제 우회, 재시작 상태를 구현한다. | native owner 및 `reservations.rs`, lock wait/lease, CLI·Node·PowerShell·내장 도구 호출자; 모든 진입점 통합 | 실제 여러 프로세스에서 중복 실행·기아·대기 잠금 점유 없음 |
| 4. 제한 병렬 삭제 | 단계3의 원자적 실행권과 단계2의 단축된 commit 경계를 사용한다. 충돌 없는 요청만 실행하고 공유 디스크 예산을 적용한다. | `apply.rs`, 플랫폼 삭제 어댑터, 공통 scheduler; 안전 경계 취소/상태 통지 | 겹침 차단·독립 진행·부분 실패 및 unknown 보호 검증 |
| 5. 통합 수용 | 고정 baseline/candidate를 같은 fixture와 승인 한도로 비교한다. 별도 고부하 컴파일과 I/O 시험은 겹치지 않는다. | 기존 검증 harness 확장, 최소 독립 결과, 기능별 commit 및 생성물 정리 | 기능·성능·안전 기준 충족과 미검증 플랫폼 명시 |
| 6. 선택적 운영 전환 | 후보 검증 뒤 실행기/앱의 호환 reader·writer와 활성 작업을 확인한다. 필요할 때만 기존 partitioned-v1을 검토한다. | 별도 승인된 설치/이관 계획, 버전 identity, 복구 근거 | 실제 설치본 확인 및 사용자 정상 사용 확인 후 임시 복구물 정리 |

단계3의 호출자 준비와 검증 fixture 준비는 공통 계약이 확정되면 단계2와 독립 진행할 수 있다. 공유 native 파일 변경은 한 소유자씩 맡고 통합은 root가 담당한다. 실제 위임 여부는 작업 크기·충돌 범위에 따라 정한다. 장시간 실행의 시작/종료, 대기 원인과 재실행 이유는 이 기록의 검증 결과에 남긴다.

관리 상태 분할은 이미 구현된 `partitioned-v1`을 재사용 후보로 삼는다. live 저장소 이관은 이번 소스 개선의 전제나 자동 후속 동작이 아니다. legacy의 전체 manifest 저장 비용이 남으면 별도 측정하고, 기존 reader/writer를 함께 전환할 수 있을 때만 이관을 제안한다. 새로운 DB나 저장 엔진부터 도입하지 않는다.

## 수용 기준과 검증

| 검증 대상 | 방법과 통과 조건 |
| --- | --- |
| 동일 대상 집중 | 6~8개 실제 세션/프로세스가 같은 대상에 사용·등록·검토·삭제를 요청한다. 적격 삭제의 물리 실행은 한 번, 중복 요청은 동일 실행 결과 추적, 재생성된 경로에는 이전 승인이 적용되지 않아야 한다. |
| 공정성·병목 | 유한 부하에서 충돌 대상의 순서를 지키고, 뒤의 무관한 요청은 독립 진행한다. 장기 사용/unknown으로 막힌 요청과 스케줄러 기아를 구분한다. 참조 해제가 앞선 삭제 대기 때문에 막히지 않아야 한다. |
| 경로 충돌 | 동일/부모·자식/다른 표기/허용된 링크 경계/교차 묶음 관계를 검사한다. 겹친 삭제와 신규 소비자 admission이 동시에 성공하지 않아야 한다. 비중첩 확인과 예약 사이 경쟁을 강제로 발생시켜 검증한다. |
| 승인·보호 | 대기·측정 도중 새 참조, 구성 변경, 소유 변경, 권한 callback, target 교체를 주입한다. 변경된 승인 근거는 차단하고 unrelated 변경은 불필요한 전체 실패를 만들지 않아야 한다. |
| 취소·장애 | 대기 취소, deadline, 세션 종료, intent 전후 및 결과 저장 시점의 제어된 child 종료를 검사한다. 호스트 크래시를 유도하지 않는다. 부분 결과와 unknown을 유지하고 자동 중복 삭제·강제 예약 해제가 없어야 한다. |
| 성능 | 동일 fixture에서 전체 wall time, 대기 p50/p95/max, 실제 잠금 보유, 예약 시간, review 횟수, commit bytes, CPU/RAM/I/O를 별도 기록한다. 4/32/80/200 구성원으로 크기 증가를 비교한다. 안정 상태에서 구성원마다 전체 그룹을 재검토하는 구조를 제거하고, 느린 payload 실행 중 unrelated 짧은 작업이 완료되어야 한다. 개선율과 단일 요청 회귀를 함께 보고하며 수치 목표는 단계1의 다중 세션 baseline 이후 확정한다. |
| Windows/VSS | 기존 8GiB VHDX·180초 신규 단계 제한·16GiB 쓰기·writer2 한도를 유지한다. 이미 시작한 삭제의 종료는 기다린다. 실제 standalone 후보와 기준본을 비교하고 Volsnap25/다른 VSS 이벤트·shadow 존재·지연·자원 사용을 기록한다. 이벤트가 없다는 사실만으로 예방 효과를 주장하지 않는다. |
| 보존·플랫폼 | 기존 feature inventory의 필수 검사와 영향받은 native/caller 계약을 실행한다. 큐·보호·묶음 의미는 Windows x64/Linux x64/macOS ARM64 공통이며 경로·잠금·삭제·I/O priority는 플랫폼 어댑터가 맡는다. 실제 Windows 회귀를 필수로 하고 다른 플랫폼은 가용 native 환경에서 검증하거나 미검증으로 명시한다. 원격/컨테이너·OS 지원 확대는 포함하지 않는다. |

제품 기능을 변경하기 전 [관리 기능 설계](../../docs/architecture/project-maintenance.md)와 기존 feature inventory의 해당 owner를 갱신한다. 현재 문서의 설치 상태·source 상태 및 중복된 과거 검증 설명은 해당 소유자의 진행 중 변경과 대조하여 정리하고, 다른 작업의 변경을 되돌리지 않는다. 영구 테스트는 향후 수정에서 반복할 수 있는 예약/승인/호출자 누락을 막는 최소 사례만 기존 검사에 연결한다. 부하 자료·빌드 입력·로그는 run별로 등록하고, 최소 근거 이관 후 기존 owner로 삭제·부재를 확인한다.

## 통합 검증 진행

- 고정 baseline은 native 258개 검사 exit0과 4/32/80/200 구성원 표본을 확보했다. 이후 환경 감사에서 기존 측정이 사용자 `CODEX_HOME`을 상속했고 당시 유효 설정을 기록하지 않았음을 확인했다. 따라서 기존 표본은 동일 조건의 인과적 속도 비교 근거로 사용하지 않는다. 기존 요청의 preferences-write는 0회였으나 activity 잠금 파일의 생성 여부는 전후 기록이 없어 확인할 수 없다. 사용자 프로필은 조사·정리 대상으로 확대하지 않는다. 후보 성능은 새 격리 설정에서 비교하고 VSS 검증도 별도로 진행한다.
- candidate2는 native 284개를 통과했지만 실제 8프로세스 시험에서 queue mutex의 일시 Busy를 취소로 오인했다. 물리 삭제는 시작되지 않았다. Busy 관측 실패와 실제 취소를 분리한 candidate3는 동일 대상 8요청을 한 실행에 합쳐 각 구성원을 한 번만 삭제했다. 원래 실패를 성공으로 바꾸지 않는다.
- candidate3 전체 검사는 284통과/1실패였다. 기존 예약 파일 교체 검사에서 Windows의 timestamp·attribute가 같은 새 파일을 놓쳤다. `registered_identity`의 실제 볼륨/파일 ID를 초기·최종 비교하도록 보강한 candidate4는 컴파일 exit0 및 기존 해당 검사 10회 각각 exit0/1passed를 확인했다. 전체 native 수용은 아직 남아 있다.
- candidate4 전체 검사는 285개 실행/284통과/1실패, exit101이었다(2,234.800초). library 121개는 모두 통과했다. 실패는 `refresh_waits_for_os_locks_without_holding_partial_transactions`의 helper가 lock-path 권한 callback 진입 신호를 2초 기다리다 끝난 뒤 sender 오류가 난 사례다. 제품 lock 획득 이전 시험 준비 기한이며 제품 교착이나 일시적 불안정성으로 단정하지 않는다. core 입력 복사와 동시 실행됐으나 지연 원인은 확정하지 않았다. 실패와 입력 불변·실제 종료를 보존하고, core 종료 뒤 같은 바이너리의 단독 사례와 전체 검사를 다시 확인한다. 시험 timeout이나 제품 guard를 완화하지 않았다.
- [실제 경합 결과](11-coordination-scenarios.json)에서 A 실행/B·C 대기, B 취소, 무관한 프로젝트 완료, A의 1회 삭제를 확인했다. C는 원래 token을 유지한 채 `tree entry disappeared`로 차단됐고 물리 삭제를 시작하지 않았다. 문자 그대로 stale-token 오류를 반환한 것으로 표현하지 않는다. 별도 사례에서는 exact CLI와 관측된 conhost의 실제 종료, unknown의 충돌 보호, 증거 없는 복구 거절, 정확한 종료 근거로 중단 상태 복구, 이후 새 승인에서 1회 삭제를 확인했다. 두 시험 run은 기존 owner의 apply exit0·실제 부재·finalize까지 완료했다. 마지막 cleaner state는 native run의 보호된 temporary에 인계했다.
- 전체 앱 호출자 검증 준비 중 untracked 중첩 Git 경로의 끝 구분자 때문에 검증 복사가 실패했다. 필요한 선행 복사 기능과 경로 정규화 수정만 분리한 조합으로 27검사 exit0을 확인하고 `896108eb9c7b789a948b6605c2bb10a7e13094f7`로 커밋했다. 기존 index를 fixture에 상속해 잘못된 index를 만든 첫 시도는 별도 harness 실패로 보존하고, 수정 후 index·원본 불변을 확인했다. unrelated 작업은 이 커밋에서 제외했다.
- source receipt는 정식 recorder로 누적 변경의 출처를 갱신한다. 기존 모델 목록·prompt 바이트는 출처 보존만 수행하며 이번 기능 커밋이나 기능 수용에 포함하지 않는다. core 고정 입력 복사가 길어져 준비된 native 전체 검사를 먼저 실행하도록 재배치했다. core 준비는 유지하되 실제 core 컴파일은 native 검사 종료 후 시작하고, 대량 파일/VSS 시험은 core 종료 후 순차 실행한다.
- core03의 입력 복사는 실제 exit0으로 끝났으며 source는 9,365파일/SHA256 `e7ce7c98dffcdbae78a99725ee11e2bb030b7ea69de7501973d0a8e0abb88b38`로 고정했다. 실제 core 검증은 이 입력·준비된 registry 1,294/Git 8 source와 호환 cache를 사용한다. 고정 입력 준비가 끝났다는 사실은 core 컴파일·검사 통과를 뜻하지 않는다.
- core 첫 wrapper는 고정 복사본의 실행기 설치 기록 부재로 Cargo 시작 전에 exit1이었다. 기존 지원 override로 검증된 FF01 실행기의 절대 경로를 지정한 새 시도에서 실제 Cargo 실행을 확인했다. 제품·설치·가드는 바꾸지 않았다. core 종료 뒤 Node adapter/lifecycle/Windows와 고정 입력 postverify를 먼저 끝내고 다음 native 검사에 넘긴다.
- core 두 번째 시도는 actual exit0/1,884.620초, `project_maintenance` 9통과/0실패/0ignored 및 target lease 부재를 확인했다. 이어진 adapter는 107개 중 104통과/3실패였으며 fixture 부모 경로 누락 1건과 예상 source 선택 목록 불일치 2건을 구분해 진단한다. lifecycle packaging의 고정 UI 4파일 준비 누락도 별도 환경 시도로 보정한다. 원래 실패는 보존하며 미실행·실패를 통과로 세지 않는다.
- 필요한 선행 변경만 함께 포함하라는 사용자 결정에 따라 HEAD `896108eb` 기준의 25파일 독립 unit을 준비했다. 설정·취소 가능한 대기·관계/토큰 helper·등록 재획득/의도 전 예약 정리를 포함하고, 별도 partitioned 저장 형식·중복claim 정책·새 Unix 삭제·다른 pending 복구 기능은 제외했다. 패치 SHA256 `c91cbfde89e1741d90ed508a0118f2ca030aa399a31dd8afba6f17556a76c5dd`, 적용 dry-run/문법 검사 exit0이다. 이 선택 조합의 실제 타입·행동 검증은 아직 하지 않았으므로 커밋하지 않았다. 현재 작업 트리·일반 Git index·실행 중인 고정 입력은 보존한다.
- 이 unit의 native 전용 입력은 HEAD 31파일과 24개 overlay를 사용해 42 source파일로 고정했다. metadata `--no-deps --locked --offline`은 exit0/소스·lock 불변이지만 `resolve:null`이므로 전체 의존성 해결의 증거로 세지 않는다. 실제 core 컴파일이 끝난 뒤 전체 metadata 및 컴파일 준비만 먼저 실행하며, 기한이 있는 행동 검사는 후속 I/O가 끝난 뒤 진행한다.
- 실행물은 native `run:fw03v:native-613162bb`, core `fw03c` 각 고유 시도, 경합 `fw03s` 각 고유 시도, VSS `run:fw03v:fw03vss-ba65a3a5-e67d-435b-a752-f1ef3da1556c`가 소유한다. 실제 결과 이관 후 기존 owner로 정리하며, 현재 사용 중인 입력·실행파일·진단 근거는 보호한다. 설치본은 교체하지 않았다.

- quiet 재검증에서 원래 registry 사례는 같은 바이너리로 exit0/1pass였고, candidate4 전체는 exit0/285pass(211.677초), 마지막 실제8프로세스도 exit0이었다. 8구독자의 동시 running 합류·동일 응답·4개 대상 각각 1회 삭제·실제 부재·status/ack를 확인했다. 원래 exit101은 보존하며 지연 원인을 단정하지 않는다.
- 선택 검사 2곳은 기존 전이 import에 맞지 않는 기대값으로 확인해 그 목록만 고쳤다. 현재 작업 트리의 수정본은 파일 전체 39/39pass였다. HEAD+이번 두 hunk만 구성한 진단 입력은 기존 BTW 기대값 3개 차이로 37/38pass였다. 그 차이는 선행 작업의 별도 수정이므로 추가로 커밋에 포함하지 않는다. 실제 수용 근거인 현재 전체 파일 통과와 이 분리 진단의 실패·컨텍스트 차이를 구분해 보존한다.
- 독립 unit은 의존성 lock의 root edge 두 개만 실행 메타데이터에서 정규화했고 79개 package pin은 그대로 유지했다. 첫 컴파일은 추출 시 selected-return helper 연결 누락으로 실패했다. 원본 실패를 보존하고 한 호출을 기존 구현과 맞춘 unit3는 컴파일 exit0/26.740초, 전체 검사 exit0/208pass(1,337.008초)였다. 실행파일 SHA256은 `3f1d30fe4d3537848dd913add8e9da2208de36c4b116577561a270fd11f72146`이다. composite와 검사 구성이 달라 suite 시간만으로 속도 차이의 원인을 판단하지 않는다. core 정리가 끝난 뒤 baseline/candidate4/unit3의 동일한 4×1KiB fixture·격리 설정·관측 도구로 작은 비교를 먼저 수행한다.
- 독립 unit은 삭제 의도 기록 뒤의 경로 열거·자손 집합·예약 재검증을 유지한다. candidate-v3는 이미 composite에서 사용한 Windows 조상 경로의 fresh `GetFileAttributesW` 조회와 기존 metadata fallback만 추가하며 leaf·FILE_ID 관찰과 이 세 가지 삭제 전 검사를 보존한다. patch SHA256 `f1ba57aa3bfbd8496e8ca5bcf49dd0228befea0fa4167e14685808f5e033547c`, format/dry-run exit0이다. 같은 안전 경계를 보존하는 기존 구현의 재사용으로 이를 최종 검증 대상 unit4로 선택했다. core 정리와 겹칠 수 있는 immutable 준비·컴파일을 먼저 하고 전체 행동·성능 검사는 I/O가 조용해진 뒤 수행한다. 작은 비교는 baseline/candidate4/unit3/unit4 각 한 표본으로 확장하며 실제 속도 개선은 측정 전까지 미확인이다.
- core와 Node/Windows 검증의 최소 독립 근거는 [13-core-verification.json](13-core-verification.json)에 이관했다. 기존 owner로 14그룹·68항목을 actual exit0/remaining=false로 삭제하고 정식 finalize했다. 임시 managed_roots 다섯 항목은 원래 config SHA256 `98f8af5a096f0da394d821710b6f695c071991bc07849cf02f3fbcba5d559b6c`로 복원했다. 큰 정리 I/O 종료 뒤 동일 조건 tiny 비교를 시작했다. `input:839670901ef58c6e3218d7ef`, `input:70a0aeaea849ea63da8491cc`, `run:fw03c:cargo-prep-20261106-01`의 2,884,511,976바이트는 관리 루트 자체 보호와 closed membership API 제한으로 남는다. `artifacts/fw03cw02/.git`, `artifacts/fw03cw03/.git` 각78바이트와 빈 구조 컨테이너도 기존 owner에 retirement 지원이 없어 남는다. 정확한 목록·실패 원인·종료·참조는 13 JSON에 기록했다. 기존 두 파일 질문은 새 전체 잔여 범위의 정식 정리 기능 추가/명시 보존 질문으로 교체했으며 답변 전에는 정리 완료로 보고하지 않는다.
- unit4는 compile actual exit0/25.128초, 입력 SHA256 `dea8b94d3dbfcd90a3c54df9435ad699cdd4b84c9128a86ddd669ee013047ab2`, 실행파일 SHA256 `5cc282cc7f3e22252e953b4ee9fb27d538efb98c7912036358fec930beeced88`로 고정했다. unit3 대비 paths.rs만 다르고 79개 의존성 pin은 동일하다. 전체 행동·실제 경합·성능 검사는 아직 수행하지 않았다. 정식 출처 기록용 복사본은 original SQL 83개의 원본 바이트를 유지하며, checkout 줄바꿈 변환이 발생한 한 파일도 원본과 같은 HEAD raw bytes로 복원했다. primary 소스·출처 기록·정상 Git index는 보존한다.
- 분리한 최종 source의 정식 recorder와 importer `--check --snapshot-only`는 모두 actual exit0이다. SOURCE SHA256 `20c91a39e7ac5b1693bda87690a989ab436baadd88e1f678982957ef75f48f11`, engine Git tree `43e24bb78e722596858fa0d0a936cf5e9cfb393f`다. 출처는 이미 커밋된 HEAD와 이번 선택 unit만 반영하며 기존 primary의 composite receipt는 포함하지 않는다. 623 ordinary/4 신규 SQL delta는 원본 import 대비 누적 출처 목록이며 이번 기능 변경 파일 수가 아니다. 원본 SQL 83개와 비선택 HEAD 파일, primary 소스·정상 index·receipt는 그대로 유지했다.
- 삭제 슬롯과 요청 조정의 실제 공유 경계는 같은 유지관리 설정 home이다. 일반 Azrael 세션은 공통 설정 home을 사용하지만 별도 `CODEX_HOME`/`AZRAEL_STATE_ROOT`를 선택한 실행끼리는 예산을 공유하지 않는다. 물리 디스크 매핑은 미구현이며 현재는 해당 home의 모든 볼륨/VHD를 하나의 보수적 예산으로 묶는다. 시스템 전체·다른 설정 프로필까지 동시성 1을 보장한다고 표현하지 않는다.
- 동일 조건 controlled-tiny1은 harness exit0, 격리 설정·입력 불변·전후 preferences 불변·20개 native actual exit0·4종 실제 삭제를 확인했다. 4×1KiB 한 표본의 register/review/apply native 합계는 baseline3.345초, composite candidate4 7.439초, unit3 11.792초, unit4 11.575초였다. unit4는 baseline 대비3.46배로 목표 수용 불가이며 ancestor 조회 대안의 뚜렷한 개선도 확인되지 않았다. 큰 fixture나 VSS로 부하를 확대하지 않고 기존 timing/count와 관련 source 경계로 원인을 먼저 조사한다. 삭제 전 세 가지 안전 검사를 제거해 수치를 맞추지 않는다.
- core 정리의 증거 연결 점검에서 retained input2의 원래 producer receipt가 이관되지 않은 채 삭제된 것을 확인했다. 13 JSON에 종료·exit·원래 경로/SHA·검증 요약은 있지만 원문/전체 frozen manifest와 영속 참조 전환은 없다. 원문 복구·독립 재검증을 주장하지 않으며, 과거 성공이나 exit를 새로 만들거나 registry를 수동 변경하지 않는다. 이 누락과 기존 API 제한은 13.cleanup.evidenceContinuity에 명시했다. CargoHome의 원래 producer receipt는 보존돼 있다.
- 원인분리 E1(unit5)은 잠금 경로의 nonleaf만 fresh Win32 속성 조회로 바꾼 후보였다. compile exit0/28.886초, 기존 경계9pass였으나 같은 tiny 한 표본은13.565초로 unit4보다 길었다. 개선 근거가 없어 primary 두 hunk를 되돌렸고 실패 후보·근거는 현재 진단 용도로만 보존한다. 전체 suite·부하 확대는 수행하지 않았다.
- baseline/composite의 same-custody catalog snapshot은 목록·record bytes·source 권한·잠금 pathname을 cache hit마다 재관측하지 않는다. 정적 경로상 callback/외부 변경이 epoch를 갱신하지 않으면 최종 source 관측도 같은 snapshot을 받을 수 있고 local GroupReviewFence는 producer source를 보완하지 않는다. 실제 변경 재현은 수행하지 않았지만 freshness 보존이 입증되지 않아 이 캐시를 최종 unit에 그대로 이식하지 않는다. 단순한 baseline 속도만으로 안전 경계를 낮추지 않는다.
- 다음 원인분리 후보는 취소 상태의 읽기 관측 잠금을 mutation용 잠금과 분리한다. 현재 취소 polling도 Sentinel의 진단 metadata rewrite·sync와 여러 identity 관측을 반복한다. 새 관측 타입은 기존 queue.lock의 OS 배타성·권한·raw bytes/identity/schema 검사·release/drop 검증을 유지하면서 create/write/truncate/sync나 owner API를 제공하지 않는다. 취소 주기·Busy 의미·내구성 있는 queue 변경 경로는 그대로 두고 단순 조회의 쓰기만 제거한다. 기존 테스트 모듈에서 immutable metadata·writer 배타·legacy/missing/tamper 차단을 확인할 후보를 준비 중이다.
- 관측 잠금 후보 unit6는 compile actual exit0/198.759초와 변경된 기존 테스트3개 통과를 확인했다. source SHA256 `385b4bcb42dae0dbd3fa96fe2d5157a9c3812e5e1306e2a501d27c0080f191d5`, 실행파일 `3499ea95fe95b0692d91e6e9369c0880e85c7260781bbf314f1a4fd2843664f3`다. 단일 tiny의 native60.223초와 wrapper76.067초, 검토 native152ms/wrapper11.526초 차이로 환경·시작 지연이 섞였음을 확인했으며 그 wall 표본으로 코드 회귀나 개선을 단정하지 않는다.
- 경로 UTF16 길이와 component 수를 맞춘 정방향·역방향 cohort(base→unit4→unit6→unit6→unit4→base)는 actual exit0/6표본 완료, 총128.208초로180초 한도를 지켰다. 30native 종료·실제 삭제·preferences/입력 불변을 확인했다. native 쌍 중앙값은10.041/27.520/10.386초였으나 같은 baseline 두 표본 차이13.133초, unit4 차이31.708초로 시간 변동이 컸다. 단일 best 표본을 고르지 않는다. unit4→unit6 쌍 CPU 중앙값9.547→8.641초, 논리 쓰기 횟수409→316으로 관측됐고 구조상 읽기 query의 metadata 쓰기를 제거했으므로 unit6를 최종 후보로 채택했다. 인과적 wall 속도 개선·최대 처리량은 아직 입증하지 않았다. 최종 단독 전체 package는 actual exit0/208pass/181.890초이며 8프로세스 행동 검사도 actual exit0이다. 같은 실행에 8요청이 합류해 결과가 같았고 4경로를 각각 한 번 삭제한 뒤 부재·status·ack를 확인했다. 총26개 CLI 호출은 모두 exit0이다. 독립 최소 근거는 [native 검증](15-native-verification.json)에 보존했다.
- 최종 candidate-v5의 공식 SOURCE revision2 발행과 snapshot-only 검사는 실제 exit0이다. SOURCE SHA256 `fd830550fba73ee2da4a68f7f7e77f599aba907b35e707f2aad1d14f2d01a271`, engine tree `ef9106fd4a69dd615a980b16add5b4f2034cd1ea`다. 후보 engine25파일 전체가 일치하고 standalone에 실제 포함된 24파일은 unit6 frozen 입력과 원문·hash가 같다. core caller 한 파일은 앞선 core 검증과 같은 bytes 보존 근거로 구별하며 standalone에서 검사했다고 주장하지 않는다. 실패한 E1과 별도 정리 기능의 drainOnly는 이 receipt에 포함하지 않았다.

### 추가 승인: 임시 자료의 정식 소유자 정리

- 사용자가 질문에 명시한 3개 보호 그룹·2개 gitfile·빈 구조 디렉터리에 대해 정식 정리 기능 추가를 승인했다. 단순 보존 승인은 받지 않았으므로 실제 정리 또는 새 보호 결정 전에는 완료하지 않는다. 기본 설치본 교체·앱 설치·push 제외는 유지한다.
- 기존 조사에서 관리 루트 자체 정리 방법을 놓쳤으나, native `retire_managed_roots` review/apply 계약과 exact-item 예외가 있음을 확인했다. 소유자·complete group·정확한 관리 루트·겹침·예약·참조·외부 증거 검사는 그대로 유지한다. 일반 membership 변경이나 보호 우회 대신 이 기존 API를 우선 재사용한다. pinned C0CF의 source/build/254개 선행 검사에 retirement 모듈이 포함된 근거가 있으며, 설치 실행기의 실제 descriptor 지원은 작은 전용 probe로 추가 확인할 예정이다.
- 새 구현이 필요한 `.git` 제어 파일·빈 생성 컨테이너의 종료는 deployment owner의 정확한 bytes/hash/target/소유·종료·참조/현재 identity와 ordinary unlink/rmdir에 한정한 절차로 설계한다. 프로젝트의 일반 `.git`이나 관리 루트 보호를 낮추지 않는다. 유실된 원래 input receipt는 복구·소급 성공 처리하지 않으며 현재 정리 판단의 독립 근거와 구분한다. 현재는 기존 API·CAS·실패/복구 경계 조사 중이고 추가 native/정리 부하는 진행하지 않는다.

### 통합 수용과 남은 실행

- [관리 루트 폐기 결과](17-root-retirement-result.json)는 3그룹·4구성원 2,884,511,976바이트의 실제 삭제·부재·최종화를 확인했다. 현재 설정을 기준으로 임시 관리 루트만 제거하여 다른 작업의 bundle 변경을 보존했다. 입력 원본 receipt 유실은 복구됐다고 주장하지 않고 독립 승인 근거에 그 한계를 유지했다.
- [병렬 수용](14-parallel-admission.json)은 기본 슬롯 1의 상한과 설정 2의 동시 점유, 8개 삭제 요청 및 부재를 확인했다. 동작 이후 controller close는 구형 실행기가 새 preferences 필드를 읽지 못해 exit1이었다. 실제 자식 36개의 종료·close와 동작 통과를 보존하고 별도 상태 루트에서 실패 outcome 그대로 producer를 닫았다. [정리 결과](20-parallel-cleanup.json)는 해당 run의 실제 부재와 참조 해제를 확인한다.
- [32항목 비교](19-performance-comparison.json)는 actual exit0/115.213초, 각 variant 한 표본씩 완료했다. baseline native24.825초, unit6 78.523초였고 group reservation 관측이 큰 비중을 차지했다. 단일 순차 표본과 앞선 cohort의 큰 시간 편차 때문에 인과적 처리량이나 최대 속도를 확정하지 않는다. 80/200으로 자동 확대하지 않았다.
- [별도 cleanup CLI 검증](21-cleanup-native-verification.json)은 full208개·CLI6개 및 실제 읽기8호출 exit0을 확인했다. [선택한 JS 호출 경로 검증](30-main-js-verification.json)은 HEAD 기반 14개 입력과 필요한 선행만 조립한 뒤 두 실제 검사를 exit0으로 확인했다. 결과 수집기의 reporter 형식 오류로 outer exit1인 원래 결과는 보존하고 실제 named1pass와 독립 assessment를 구분했다. 다른 작업의 recovery-state 두 파일 커밋은 그대로 보존하며 검증 입력과 겹치지 않는다. 핵심 기능은 `c7d67ae5053e04bf48616c86348c3d8301818611`로 커밋했다. [커밋 근거](35-main-commit-result.json)는 인덱스 쓰기 모드 오류의 원래 exit1과 인덱스만 재구성한 복구 exit0, 작업 파일·무관한 staged 항목 보존을 구분한다. 정확한 cw02/03 적용, 정리 기능의 선택 JS 입력 검증·별도 commit과 최종 disposable 정리가 남아 있다. VSS 부하와 실제 control 시험은 순차 실행하며 기존 설치본·사용자 설정은 교체하지 않는다.
- [첫 VSS 비교 시도](24-vss-comparison-attempt.json)는 UAC 취소 뒤 승인된 재시도에서 producer record의 fixture 경로가 native 허용 경계 밖이어서 등록 단계에서 실패했다. 삭제는 시작하지 않았고 종료·shadow 제거·detach·기존 VSS 보존은 확인했다. 새 run의 경로를 `artifacts/generated`로 바로잡아 baseline/unit6 각각 작은 실제 등록·검토·삭제16건과 부재를 통과했다. 수정된 run의 관리자 Preflight는 2026-11-06 01:17:17~01:17:29 UTC exit0이었다. Compare는 사전 시험과 본 시험의 raw 로그 이름 충돌로 Baseline/Register에서 exit1이었고 같은 구간 자원 하한 경고도 기록됐다. Review/Apply와 Candidate는 실행하지 않았으며 shadow 제거·detach·기존 VSS 보존과 RecoveryNeeded=false를 확인했다. 실제 native 등록 종료 증거와 자원 시계열을 구분해 조사한 뒤 재실행을 결정한다. 제품 결함이나 Volsnap25 재현으로 해석하지 않는다.
- [수정 시도 근거](29-vss-corrected-attempt.json)는 실제 native 등록 exit0·pipe drain과 기존 tiny 로그를 구분한다. native 원문 출력은 충돌로 저장되지 않아 JSON 검증 완료로 보지 않는다. RAM 최저값은8,578,048,000바이트로8GiB보다11,886,592바이트 낮았다. 이후 새 VSS 전용 run에는 probe를 실행하지 않고 출력 경로90개의 사전 부재·교집합0과 native 시작 전 충돌 거절을 확인했다. RAM 하한이 회복된 뒤에만 실행했다.
- [최종 VSS 비교](32-vss-comparison-result.json)는 2026-11-06 01:35:17~01:36:40 UTC actual exit0이다. baseline/unit6 각각128MiB·2,048개 파일·16개 디렉터리를 실제 등록·검토·삭제했고 총32개 대상 부재를 확인했다. 요청 쓰기는 preflight 포함269,484,032바이트, Volsnap25와 다른 Volsnap 이벤트는0건이었다. shadow 제거·정상 detach·기존 VSS 보존·RecoveryNeeded=false·cleanup 오류0을 확인했다. 등록·검토·삭제 adapter 시간 합은 baseline11.990초/unit6 13.304초로 이 표본에서는 후보가10.96% 느렸다. native 전체 wall은 측정하지 않았다. 한 차례 순차 debug timing-ON 비교이며 release 성능·최대 속도·다른 부하에서의 재발 방지를 보장하지 않는다.

### 정식 제어 파일 폐기의 통합 상태

- Windows 전용 `deployment-control-retirement.cjs`를 기존 deployment owner의 prepare/apply로 연결했다. 정확한 gitfile·원래 생성자 연결·물리 identity·명시된 빈 디렉터리·불변 증거·새 work 소유권과 native reservation을 사용한다. 시작된 worker/native/속성 조회는 실제 종료까지 drain하며 새 opt-in `drainOnly`를 사용한다. 일반 `.git` 보호와 기존 lease 기본 정책은 바꾸지 않는다.
- producer catalog에 더해 ordinary native inventory 전체 metadata 페이지의 완전성·manifest/config identity와 SHA를 확인한 snapshot 뒤 기존 maintenance.lock을 획득하고 같은 snapshot을 CAS로 재검증한다. foreign reservation/pending control 파일과 관련 active input을 거부하며 이 작은 예외의 삭제가 끝날 때까지 상태 잠금을 유지한다. 일반 대량 삭제의 잠금 범위는 넓히지 않는다. 과거 pending/unknown decision은 완전한 item/group/membership 및 명시 path/source/provenance/reference로 대상과 겹침을 판정하고, 해석 불가·모순은 거절한다. 대상과 무관함이 증명된 이력만 허용한다.
- pinned C0CF의 실제 capabilities/inventory는 exit0이지만 `run_status`는 명시적 미지원으로 exit1이었다. inventory summary만으로는 기존102개 실행의 active input 보호를 입증하지 못하므로 실제 root 적용은 차단했다. 기존 공통 읽기 기능을 standalone CLI에 노출하는 최소5hunk를 추가했고 기존 capability/읽기 자동조정 테스트를 확장했다. unit6 main source는 유지하며 이 선행은 추가 정리 기능의 별도 unit7 입력·검증으로 분리한다. 기본 실행기의 설치·설정은 바꾸지 않는다.
- 새 fixture 검사는 cleanup-ready가 되는 happy와 생성자 변조를 복원해 정식 폐기로 끝내는 최소 거절 검사로 제한한다. 의도적 physical/finish 실패를 만드는 미실행 scaffolding은 정리 계약이 없으므로 영구 검사로 채택하지 않는다. 제품의 partial/unknown 보호는 유지하고 기존 실제 native 보호 검증을 재사용하며 새 owner의 해당 fault 실기는 미검증으로 남긴다.
- 기존 Windows mandatory entry에 caller run 아래 `control-retirement` fixture의 `happy` 검사를 연결했다. 해당 선택 목록의 직접 검사는 actual exit0/1pass이며 fixture/native 호출은 없다. [작은 실제 수용](26-control-retirement-acceptance.json)은 실패 fixture의 정식 폐기와 원래 failure/exit1 보존, 새 happy의 actual exit0·실제 부재·최종화를 확인했다. 앞선 PS5 배열 binding 오류와 기능 범위보다 넓은 capability gate 실패는 원래 근거에 보존했다. [정확한 기존 대상 적용](27-control-retirement-result.json)은 무관한 과거 pending decision7개의 전역 차단에서 mutation 전 exit1이었다. 범위를 좁힌 guard의 실제7개·negative20 검사는 통과했으며 cw02/03 실제 재시도는 VSS 종료 뒤 진행한다. partial/unknown fault 실기는 여전히 미검증이다. 유지하는 선택 검사는 이후 Windows 검사 목록 변경에서 새 소유자를 누락하는 반복 실수를 막는다.

- [기존 대상의 최종 시도](33-control-retirement-result.json)는 cw02 준비·계획 게시 후 적용 전역 보호에서 중단됐다. apply worker54368 exit1/close, maintenance native51176 exit0/close/released이며 catalog reservation·실제 삭제는0이다. 과거 0바이트 lifecycle pending2개는 대응 정상 기록과 원 생성자를 찾지 못했고 기존 `recover_lifecycle_pending` 계약으로 처리할 수 없다. 두 파일·게시된 workrecord/intent와 원래 결과를 보존한다. 사용자는 두 제어 파일의 전용 정식 복구를 추가 승인했다. 대상은 `artifacts/maintenance/lifecycles/6fd942fbc36465bc3f72c94032b7ed34d5492a83f896cab9172f1e3a0692ac45.pending`와 같은 디렉터리의 `e1309b15756f35c9f5a5a462d0b675fc306c7b92e21d86d744a1809da7e13ab6.pending`다. 정확한 identity·0바이트/SHA·대응 기록 및 소유 연결 부재를 독점 잠금 아래 검증하는 전용 절차를 구현하며 조건이 불확실하면 보존한다. 현재 지원 writer의 catalog OS lease는 publication 임계구간을 배제할 수 있으나 원래 producer 전체 종료 증거를 대신하지 않는다. 원 계획의 실패 결과를 고치거나 intent를 자동 재사용하지 않고 별도의 명시적 재개 계약을 사용한다.
- [별도 JS 검증](34-cleanup-js-verification.json)의 261자 Windows 속성 조회 실패는 Node 표준 확장 경로 변환을 관측 입력에만 적용해 보정했다. 실패 fixture의 정식 폐기와 원 failure1 보존은 확인했다. [후속 검증](37-cleanup-js-verification.json)은 새 fixture의5개 경로 삭제·native 예약 종료와 release를 확인했으나 마지막 `remove_record`의 native 대기 기한 만료로 unknown이었다. 원 queue는 terminal 자동 ack로 비워져 과거 대기 상대나 초기 I/O 지연을 소급 구별할 수 없다. source recorder와 I/O가 겹쳤다는 사실만 기록하고 원인으로 단정하지 않는다. 나머지 검사는 중단했으며 진단 필드와 오류 이후 최종 release 증거를 보존하는 보정을 준비한다. `36-cleanup-source-receipt.json`의 정식 SOURCE-only 발행 성공과 JS unknown을 구분한다.
- [메타데이터 정리 시도](38-cleanup-metadata-recovery.json)는 native 호출 전에 사전 검사에서 exit1이었다. 완료 예약의 terminal marker와 잠금 진단 metadata도 전부 거절한 조건이 과도했다. 읽기 조사에서 terminal·원 fence·현재 근거의 일치와 활성 예약 JSON 부재를 확인했다. 잠금 파일은 빈 파일이 아니며 그 내용으로 현재 OS 잠금 점유 여부를 단정하지 않는다. 정확한 sidecar와 완료 근거를 허용하되 다음 정식 native 잠금 검사를 유지하는 보정을 준비한다. 원 `37`의 unknown과 물리 삭제 결과는 변경하지 않는다. unit8은 대기 취소·기한 만료·등록 시간·마지막 관측 경합을 제한 크기의 구조 필드로 구분하는 후보이며, 대기 예산·순서·보호 동작은 유지한다. 동결 입력의 컴파일·집중 검사·전체 package 검증을 먼저 수행하고 메타데이터 재시도와 JS 실행은 그 I/O 종료 뒤 진행한다.
- [진단 변경 검증](39-native-diagnostics-verification.json)은 compile exit0, 집중 검사1/1 및 전체 package208/208 exit0이었다. standalone 식별 조회도 exit0이며 unit8 SHA는 `515d0f48efed78cbb8aded3d877417606ff9a169f0367b08c09989c9b5f42446`이다. 새 오류 구조의 실제 검증 경계는 coordination→error_response의 libtest이며 subprocess의 오류 전달은 기존 serialize 경로의 소스 근거와 구분한다. root는 정확한 검증 후보와 일치하는 coordination 변경을 통합하고 lock_recovery에는 해당 응답 분기만 추가해 다른 작업의 복구 변경을 보존했다. 기본 설치본은 변경하지 않았다.
- [메타데이터 재시도](40-cleanup-metadata-recovery.json)는 정확한 unit8로 exit0이었다. 원 fixture를 다시 삭제하지 않고 소유 기록을 최종화했으며 원 caller는 failure/exit1로 닫았다. finalize와 caller close의 native 두 프로세스 모두 exit0·signal null·실제 close를 확인했다. 원 `37`의 unknown과 `38` 실패는 유지한다. 최종 JS 검사를 먼저 순차 실행하고 그 소비 종료 뒤 SOURCE를 발행해 recorder와 native 실행의 I/O 중첩을 피한다.
- [최종 JS 평가](43-cleanup-js-final-assessment.json)는 실제 happy의 삭제·최종화·모든 프로세스 종료와 나머지3개 검사의 exit0을 확인했다. happy를 재실행하지 않고 Windows namespace로 보존된 증거를 읽었다. 원 `42`의 collector exit1과 제품 happy exit0을 구분하며 원 `37`도 유지한다. 과거 pending 복구 구현 경계가 확정될 때까지 SOURCE 발행을 보류해 소스 영수증의 중복 생성을 피한다.

### 추가 승인: 빈 lifecycle publication의 전용 복구 준비

- 사용자는 기존 범위 밖의 정확한 과거 0바이트 pending 두 파일에 대한 정식 복구 추가를 승인했다. 구현 방향 검토까지 진행하며 실제 복구, 새 fixture 실행, blocked33 재준비와 cw02/03 삭제는 root의 별도 실행 인계 전까지 HOLD다. 원래 [33의 실패](33-control-retirement-result.json), 새 workrecord와 intent/result 및 outer caller를 보존한다.
- 승인 대상은 `artifacts/maintenance/lifecycles/6fd942fbc36465bc3f72c94032b7ed34d5492a83f896cab9172f1e3a0692ac45.pending`와 `artifacts/maintenance/lifecycles/e1309b15756f35c9f5a5a462d0b675fc306c7b92e21d86d744a1809da7e13ab6.pending`다. 각각 관측한 OS identity는 dev `3057815611`, ino `281474992442627` / `281474992179715`이며 size0, SHA256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`다. 실제 prepare/apply는 이 값과 정확한 root binding을 재검증하고 다른 identity로 갱신하거나 범위를 늘리지 않는다.
- 재사용 경계: `maintenance-lock-owner.cjs`의 native lease와 `drainOnly`, native `Sentinel`의 exact catalog OS 독점 잠금·identity 검증, 기존 lifecycle catalog의 유효 record 해석, control owner의 Windows 경로·파일 identity·속성 검사와 CreateNew/fsync 영수증, 완전 pagination·manifest/config CAS·활성 run input 검사를 재사용한다. 기존 `recover_lifecycle_pending`은 정상 JSON과 참조 해제 차이·원 writer 종료 증거를 요구하므로 빈 orphan에 호출하거나 계약을 완화하지 않는다. 전역 pending guard, Rust, 설치·설정, primary registry 원문은 변경하지 않는다.
- 현재 native `lease.rs`의 `write_record`는 exact catalog lease를 보유한 `mutate`에서 pending create_new→write_all/sync_all→identity/기존 record CAS 확인→rename→lease.verify를 수행한다. queued admission은 publication 전 lease를 다시 얻는다. 독점 catalog custody는 이 지원 프로토콜의 동시 publication 임계구간을 배제하지만 과거 두 파일의 생성자·실행기 버전·원 process tree 종료를 입증하지 않는다. 새 영수증에는 원 writer를 unknown으로 보존하며 `producer_stopped_verified`나 과거 성공 exit를 만들지 않는다. 비협조 외부 writer까지 원자적으로 통제한다는 보장은 추가하지 않는다.
- 최소 소유 파일 권고는 새 `scripts/lifecycle-empty-publication-recovery.cjs`의 명시적 prepare/apply owner다. 기존 control 본체는 검증된 물리 경로·속성·동기 evidence helper를 주입하는 연결, publication 전 cheap quiescence, 명시적 blocked-plan reprepare만 맡는다. native guard는 현재 단일 대상 capture를 유지하면서 두 정확한 대상의 완전 inventory 연결 검사를 한 번의 동일 snapshot에 적용하는 좁은 내부 재사용 경계만 추가하는 방향을 권고한다. 새 parser·직접 OS lock·별도 native transport·범용 cleanup 우회 API는 만들지 않는다. 기존 control 테스트에 이 owner의 pure 거절 검사와 선택된 tiny fixture 수용을 추가하며 새로운 공통 helper 계층은 필요하지 않다. 아직 제품 소스는 수정하지 않았다.
- 전용 복구 계약: SHA로 고정한 승인 요청에 정확히 두 경로·root·identity·empty SHA·대응 canonical JSON 부재를 결합한다. complete native item/group 및 현재 lifecycle record의 ID digest, member/source/provenance/reference 연결이 없음을 검사하고, 목록 불완전·해석 불가·연결 발견은 거절한다. native 조회는 custody 전에 끝내고 manifest/config fence와 현재 catalog 연결을 maintenance→exact catalog 독점 순서 안에서 재확인한다. foreign reservation, manifest pending과 다른 미승인 pending은 허용하지 않는다. 해당 두 pending만 이 명시적 복구의 대상이며 일반 폐기의 pending 거절 조건은 유지한다.
- 실제 변경 전 caller-owned 보고 경로·감독 생명주기와 출력 전체를 계획한다. 불변 CreateNew+fsync intent에 승인·snapshot·파일 identity와 `supported_publication_critical_section_excluded`를 기록하고, 같은 custody에서 각 파일 identity/0B/SHA와 canonical 부재를 다시 확인한 뒤 ordinary unlink→부재 확인을 수행한다. 별도 CreateNew+fsync final receipt에 실제 경로별 결과와 native release/exit/close를 남긴다. readonly/system/permission 문제를 강제로 풀지 않는다. partial·unknown·동일 intent 재사용은 자동 재시도하지 않으며 원 evidence와 남은 보호를 유지한다.
- blocked33의 명시 재준비는 별도 API로 원 plan/intent/result/journal과 독립33의 SHA·실제 worker54368 exit1/close·maintenance51176 exit0/released·catalog/reservation 미시작·removed[]·정확한 차단 단계를 검증한다. 기존 `work:deployment-control-retirement:30a3d18a-a732-4fd4-ace7-7c9801c56898` revision1/owner/member/root identity를 채택하고 중첩 새 claim은 만들지 않는다. 원 기록을 덮어쓰지 않고 recovery linkage가 있는 새 nonce의 plan/intent/result와 fresh snapshot을 발행한다. 기존 intent 삭제를 통한 replay, 실패→성공 변경, partial/unknown 재개는 이 경로에서 금지한다. cw03은 기존 fresh prepare 절차를 유지한다.
- cheap quiescence는 prepare의 journal/workrecord/plan 게시 전과 비싼 run 조회 전에 수행하고 publication custody 안에서 다시 확인한다. 선행 비잠금 관측을 race-free 보장으로 취급하지 않으며 apply의 maintenance/catalog/reservation 경계 재검사를 유지한다.
- 검증 순서는 pure shape/identity/SHA/연결/불완전 pagination/기존 canonical/재사용 intent 거절→root가 허용한 owned tiny 두 pending의 실제 prepare/apply/absence/정상 release→원33 failure 보존 및 reprepare의 tiny 수용→root 검토 후 정확한 과거 두 파일과 cw02/03 순차 실행이다. 실제 변경이 시작된 unknown/partial fault 실기는 정리·복구 계약 승인 없이 만들지 않는다. 현재 예정 실제 환경은 Windows x64 로컬이고 common 잠금·권한·실패 보호 의미는 유지한다. 다른 OS 수용과 원 writer 종료 증명은 미검증으로 구분한다.

## 이번 계획의 제외 범위

- Windows bugcheck 재현, 기존 C: VSS 정책 변경, 승인된 부하 한도 확대.
- 사용 중인 파일 강제 삭제, ACL/소유권 우회, unknown 작업 자동 성공 처리.
- 기본 설치본/내장 엔진 자동 교체, live 저장소 자동 이관, unrelated 작업 변경 또는 push.
- 모든 환경에서의 최대 속도나 Volsnap25 재발 불가 보장. 측정된 범위에서 안전 조건을 충족하는 가장 빠른 설정을 채택한다.

---

# Volsnap 이벤트 25 제한 재현

## 목표·허용 범위

- 사용자가 지정한 목표는 실제 Windows System 로그의 `Volsnap / Event ID 25` 재현이다. Windows bugcheck·블루스크린 재현 및 GPU/하이퍼바이저 원인 추적은 제외한다.
- 기존 FW-01 소스 개선·258개 검증·커밋 `6f9e8e62`는 완료된 선행 작업이다. 이 재현은 별도 검증이며 이벤트 재현이 곧 Azrael 원인 입증을 뜻하지 않는다.
- 사용자가 현재 PC에서 제한 시험을 승인했다. 물리 디스크를 공유하는 VHDX는 데이터 영역을 분리하지만 호스트 I/O를 격리하지 못한다. 승인된 용량·시간·쓰기량·writer 상한을 자동으로 늘리지 않는다.

## 현재 확인한 사실

- Windows x64 로컬 환경. `vssadmin`, `diskpart`, Storage 모듈의 Get-Disk/Get-Volume/Initialize-Disk/New-Partition/Format-Volume/Mount-DiskImage/Dismount-DiskImage가 있다. `diskshadow`, New-VHD/Get-VM, diskspd 명령은 현재 발견되지 않았다.
- 조회 시 C: 여유 약179.9GB, D: 약1.42GB, E: 약12.17GB. 다른 실사용 디스크는 시험 저장소로 선택하지 않는다.
- 기존 이벤트25는 2026-11-05 18:17:31 KST RecordId44901, 14:01:45 RecordId43687, 11-03 07:20:37 RecordId41123. 과거 이벤트를 새 시험의 성공으로 세지 않는다.
- Win32_ShadowCopy.Create와 Win32_ShadowStorage.Create의 공식 WMI 경로가 있으나 문서의 client 지원 표기와 현재 Windows 환경의 실제 기능은 구분한다. 시험 볼륨에서 생성·조회·삭제를 실제 확인하기 전 부하를 시작하지 않는다.
- 저장소/스크립트 검색에서 해당 VHDX/VSS 재현 harness를 찾지 못했다. 표준 Windows API·Storage cmdlet·WMI를 먼저 재사용하며 드라이버 설치·Driver Verifier·global registry 튜닝은 하지 않는다.

## 현재 PC를 선택할 경우 제안한 상한

- workspace의 task-owned run 아래 최대8GiB 임시 VHDX 하나를 사용한다. 기존 파일 덮어쓰기 없이 새 경로·run ID로 생성하며 정확한 image path→새 disk identity→시험 partition/volume GUID 연결을 확인한다.
- 기존 C: 섀도 복사본/저장소 정책·서비스 설정·MinDiffAreaFileSize는 바꾸지 않는다. 시험 볼륨의 diff area도 시험 볼륨이어야 하며 실제 association을 확인한다. VHD의 차등 저장소는 같은 VHD 볼륨이어야 한다는 플랫폼 제약을 이용해 작은 shadow를 먼저 생성하는 경로도 허용하며, 다른 볼륨으로 배치되면 부하 전에 중단한다.
- 시험 부하는 최대3분, 총 요청 쓰기16GiB 이내, 동시 writer 최대2개로 제한한다. 이는 workload의 상한이며 초기 VHDX/파일 준비 시간과 VSS 호출 대기 시간은 별도로 기록한다.
- 초기 작은 파일·shadow 생성/조회/삭제 preflight를 먼저 수행한다. 그 다음 고정 seed와 명시적 block/queue 조건의 단계를 실행한다. 작은 quota를 채워 이벤트36을 만드는 것을 목표로 하지 않는다.
- 시작 전 C: 여유100GiB 및 가용 RAM8GiB 이상을 확인한다. 부족·관측 실패·외부 볼륨 VSS 이벤트·시험 shadow 손실·사용자 취소가 발생하면 추가 부하를 중지하고 결과를 보존한다. 이 제한은 OS 오류나 host 지연의 부재를 보장하지 않는다.

## 성공·실패 판정

1. 시험 전에 정상 생성되고 조회되는 시험 shadow ID, volume GUID/device mapping, provider, storage association을 기록한다.
2. 시작 EventRecordID 이후의 실제 provider Volsnap/ID25가 시험 volume identity와 일치해야 재현으로 인정한다. XML·RecordID·시각·메시지를 보존한다.
3. 이벤트 전후 shadow 존재·diff area 할당/사용·부하 단계/쓰기량·실제 종료 결과를 함께 기록한다. 정리 과정의 의도적 snapshot 삭제를 재현으로 세지 않는다.
4. ID36·다른 VSS 이벤트·타임아웃·호스트 다른 볼륨의 ID25는 별도로 보고한다. 정해진 한도에서 ID25가 없으면 제한 조건 내 미재현으로 보고하고 자동으로 용량/부하/시간을 늘리지 않는다.
5. 재현되면 같은 조건에서 반복성 및 기존/개선 Azrael 작업과의 인과 검증을 다음 단계로 결정한다. 인위적 일반 I/O 재현만으로 Azrael 결함이나 개선 효과를 확정하지 않는다.

## 소유·복구·정리

- 실행 전 task run에 VHDX·worker·로그·evidence·예정 출력과 active refs를 등록한다. elevated 제어기는 선택 실행 권한 및 요청한 UAC 범위로만 동작한다.
- 원래 디스크 번호나 drive letter만을 근거로 초기화/format하지 않는다. exact new image path에 연결된 RAW disk인지 매 단계 확인하고 식별 불일치·기존 partition이면 중단한다.
- snapshot 정리는 이 run에서 생성한 정확한 ID와 volume 연결만 확인해 수행한다. 기존/다른 작업의 shadow와 설정은 보존한다.
- 작업 전용 writer의 실제 종료를 확인한 뒤 VHDX를 정상 dismount하고 Attached=false를 검증한다. mounted/unknown 파일은 삭제하지 않는다. 최소 결과를 work에 남긴 뒤 기존 owner 절차로 task run을 삭제하고 부재를 확인한다.
- 실패로 필요한 복구 자료가 남으면 실제 경로·크기·보호 사유를 보고하고 implementation의 보존/정리 규칙을 따른다. force delete·ACL 변경·다른 shell로 우회하지 않는다.

## 실행 기록

- 작업 owner `root/fw02-volsnap-reproduction`, run `run:fw02:vss-35233693-59a0-4bc8-8eb4-4e2614e94272`. 생성 전 pending/incomplete로 등록한 경계는 `artifacts/tasks/fw02/runs/vss-35233693-59a0-4bc8-8eb4-4e2614e94272`이며 inputs/temporary/logs/reports/outputs 및 VHDX 전체가 이 소유 범위다.
- root는 관리자 실행·실제 결과·cleanup을 담당한다. bounded executor는 이 run의 일회용 PowerShell/C# 제어기와 구문/컴파일 확인만 담당하며 디스크/VSS 명령은 실행하지 않는다.
- 관리자 읽기 전용 전제 확인 exit0. Win32_ShadowCopy의 Create/Revert 및 Win32_ShadowStorage.Create가 현재 provider에 노출되어 있다. 기존 shadow0개, C→C association 최대39,952,842,752바이트(기존37.2GiB)이며 변경하지 않았다. 이는 실제 시험 shadow 생성 성공을 뜻하지 않는다.
- 단계1은 작고 정상적인 shadow 생성·조회·정확한ID 삭제·detach만 수행한다. 단계2의 workload는 단계1 결과와 VHDX identity가 확인된 뒤 별도로 시작한다. phase1 mutation 최대2GiB 또는30초 뒤 phase2를 실행하되 전체180초/16GiB 한도를 공유한다.

## 실제 결과와 다음 조건

- 독립 근거는 [제한 재현 결과](03-reproduction-result.json)에 보존했다. Windows 11 Home 10.0.26200 x64에서 2026-11-05 19:35:03~19:35:13 KST 사전 점검을 수행했고 실제 프로세스 exit1을 관측했다.
- 첫 실행은 stage 진입 전에 exit1로 끝났다. 당시 유효 PowerShell 정책은 Restricted였으나 최초 stderr가 없어 원인을 확정하지 않는다. 두 번째 실행은 해당 프로세스에만 RemoteSigned를 지정했고 전역 실행 정책은 변경하지 않았다.
- 새 8GiB VHDX 생성·연결·NTFS 포맷·1MiB 파일 기록은 성공했다. `Win32_ShadowStorage.Create`에 시험 볼륨을 원본과 diff volume으로 명시하고 MaxSpace 4GiB를 지정했으나 ReturnValue10(공식 의미: Unknown error)으로 실패했다. 실제 backing file 크기는 100MiB였다.
- shadow 생성은 호출되지 않았고 부하 worker도 시작되지 않았다. 이 결과는 제한 부하에서의 미재현이나 Azrael 개선 효과의 검증이 아니다. 현재 API 경로의 환경 구성 실패이며 다른 경로에서도 VSS 사용이 불가능하다는 증거는 아니다.
- 종료 제어기는 정상 Dismount 후 `Attached=false`, 기존 shadow/association 보존, cleanup 오류0개를 확인했다. 원래 C→C 최대39,952,842,752바이트 설정은 동일했다. 해당 시간대 Application/System 로그의 VSS·Volsnap 관련 추가 진단 이벤트는 없었다.
- 다음 재현에는 시험 볼륨의 shadow 생성·조회·삭제가 먼저 성공하는 환경 또는 검증된 API 경로가 필요하다. 실제 C: 부하·VSS 설정 변경, 용량/시간/쓰기량 상한 확대는 승인 범위에 없으므로 실행하지 않는다. 이 원인을 알아내기 위한 무제한 반복이나 부하 증가는 하지 않는다.
- 일회용 harness는 환경 구성을 위한 시험이며 제품의 지속 테스트로 유지하지 않는다. 최소 결과와 입력 SHA256만 남기고 VHDX·스크립트·컴파일 산출물·raw 로그를 전체 run 소유자 절차로 정리한다.
- 검증된 standalone owner의 등록·검토·명시적 삭제는 모두 exit0이었다. [정리 결과](04-cleanup-result.json)는 전체 run의 `deleted`, `remaining:false`, 오류 없음과 논리 크기105,402,913바이트를 기록한다. lifecycle finalize도 `remaining:[]`, `references:[]`, `blockers:[]`로 완료했다. 물리 회수 바이트는 측정하지 않았다.

## 공식 근거

- [Vssadmin 지원 명령](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/vssadmin)
- [Win32_ShadowCopy.Create](https://learn.microsoft.com/en-us/previous-versions/windows/desktop/vsswmi/create-method-in-class-win32-shadowcopy)
- [Win32_ShadowStorage.Create](https://learn.microsoft.com/en-us/previous-versions/windows/desktop/vsswmi/create-method-in-class-win32-shadowstorage)
- [VSS provider 볼륨 지원 검사](https://learn.microsoft.com/en-us/windows/win32/api/vsprov/nf-vsprov-ivsssoftwaresnapshotprovider-isvolumesupported)
- [VHD와 diff area 동일 볼륨 제약](https://learn.microsoft.com/en-us/windows/win32/api/vsmgmt/nf-vsmgmt-ivssdifferentialsoftwaresnapshotmgmt-adddiffarea)
- [Windows 11의 shadowstorage resize 지원](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/vssadmin-resize-shadowstorage)

## 두 번째 시도

- 새 pending owner 경계는 `run:fw02:vss2-0f21bc14-0bed-407a-b389-094212031d97`, `artifacts/tasks/fw02/runs/vss2-0f21bc14-0bed-407a-b389-094212031d97`다. 이전 실행은 재사용하거나 실패 결과를 덮어쓰지 않는다.
- `ShadowStorage.Create` 및 COM `AddDiffArea`는 문서상 클라이언트 지원이 명시되지 않았다. 이는 첫 Return10의 확정 원인은 아니다. 이번에는 시험 VHD의 작은 파일을 대상으로 `ShadowCopy.Create`를 직접 호출한 뒤 실제 Volume/DiffVolume을 검증하고, 동일 시험 GUID 대상으로만 `vssadmin resize shadowstorage`를 실행해4GiB를 확인한다. ShadowCopy WMI의 문서도 client 지원을 명시하지 않으므로 성공 여부는 실측으로 판단한다.
- 현재 설치된 `vssadmin resize shadowstorage /?`가 정상 출력됐고, Microsoft 문서도 Windows11을 지원 대상으로 명시한다. 명령 존재나 도움말은 실제 resize 성공의 근거로 삼지 않는다. resize로 shadow가 사라지면 preflight 실패이며 부하로 넘어가지 않는다.
- root는 관리자 실행·결과 검토·정리, 기존 harness executor는 이 run의 일회용 제어기 및 compile-only 검증을 담당한다. 8GiB/180초/16GiB/writer2 한도와 C: 여유100GiB/RAM8GiB, 원래 VSS 보존·worker종료·정상 detach·정리 조건은 유지한다.
- vss2 실행은 native 종료 코드 수집 함수의 지역 `$LASTEXITCODE`가 전역 갱신을 가리는 harness 오류로 mount 전에 exit1로 중단됐다. 동기 diskpart는 반환했으나 기록된 exit는 null이며 성공으로 바꾸지 않는다. 정확한 image 조회는 `Attached=false`였다. [실패 근거](05-harness-failure.json)를 보존했다.
- 수정은 새 run `run:fw02:vss3-7e65f579-52c5-4d0e-8cbd-3c91731eb99c`에서만 수행했다. 실제 native helper를 AST로 추출하고 로그만 대체해 child PowerShell exit0/exit7을 실행하여 정상 반환·실패 거절과 실제 종료 코드 수집을 검증했다(exit0). controller SHA256 `faaf617668830594368631293ff8e441e492fdf48a07d7104c03beba7f6f0014`, worker SHA256 `07103b1b6cc5a23d0b8927afb917b4275ded6a6f3a71d6dfbda6df2efb455ddd`로 고정했다.
- vss3 사전 점검은 2026-11-05 19:52:57~19:53:07 KST에 실제 exit0. ShadowCopy.Create Return0, GUID `9e8c561d-dc52-4bc1-8ddb-d9cebde3c738`의 동일 source/diff association, resize exit0 및 MaxSpace4GiB를 확인했다. 반환 shadow ID `{968B8A55-5715-4772-927D-AA029B8371A1}` 삭제 후 부재, image detach, 원래 VSS 보존도 확인했다. 따라서 현재 Windows Home에서 이 직접 생성 경로는 실제 동작한다.
- [제한 부하 결과](06-bounded-trial.json): 19:53:40~19:54:23 KST 단계 실행 exit0. worker 구간38.8086614초에 쓰기예산에 도달했다. worker requested/completed 모두17,178,820,608바이트이며 preflight1MiB를 더한 총량은 정확히16GiB다. 준비 파일은1GiB 두 개이고 이후64KiB 정렬 random overwrite를 writer1→2로 실행했다. 각 writer queue depth1, WriteThrough 및 최종 Flush(true)를 사용했다. 180초는 상한이며 총량이 먼저 소진돼 종료했다.
- 시험 shadow `{8F0E9EBB-C543-403A-8F0E-5BA4BDC74065}`는 생성·관측됐고 의도적 정리 전에 손실되지 않았다. 새 시험-volume Event25=0, 다른 Volsnap 이벤트=0. diff area 최대 관측 사용량2,089,447,424바이트, 할당량2,617,245,696바이트(상한4GiB). 샘플 최소 C여유175,130,497,024바이트, 가용RAM11,320,590,336바이트였다.
- 두 foreground worker Join 성공, exact-ID shadow 삭제 후 부재와 image detach 검증, 기존 VSS 보존, cleanup 오류0개를 확인했다. 시험 종료 시 VHDX 파일 크기는4,366,270,464바이트였다.
- 해석 범위: 한 차례 합성 I/O 시험이다. 쓰기 총량16GiB와 별개로 변경 대상 파일의 합계는2GiB여서 계속 새로운 영역을 수정하는 작업과 차등 저장소 성장 양상이 다르다. Azrael의 실제 기존/개선 binary를 비교하지 않았으므로 인과관계·개선 효과·최대 처리량·향후 재발 불가를 입증하지 않는다. 재현을 위해 자동으로 한도나 실사용 볼륨 변경 범위를 넓히지 않았다.
- [후속 정리 결과](07-followup-cleanup.json): vss2/vss3 등록·fresh review·명시적 삭제 모두 exit0, 두 group `deleted`, 두 member `remaining:false`, 오류 없음. 논리 크기 합계4,370,571,452바이트를 삭제했으며 물리 회수량은 측정하지 않았다. 두 lifecycle finalize도 `remaining:[]`, `references:[]`, `blockers:[]`로 확인했다. 입력 hash는 실행 후에도 동일했다. 별도 상주 harness·제품 코드·설치는 추가하지 않았고, 근거 JSON 및 이 작업 기록만 보존했다.

## 실제 삭제 도구 실험

- 사용자가 다음 단계로 삭제 도구 실험을 요청했다. 현재 실제 정리에 사용하는 Windows x64 standalone `maintenance_owner.exe`(SHA256 `c0cf7fa34948cceebbd10db45b0b55ecf0f42c7fae79079da673e8d6ce90c680`)를 대상으로 한다. FW-01의 미설치 개선 버전이나 앱 내장 도구를 시험했다고 보고하지 않는다. 제품 코드·설치 변경은 포함하지 않는다.
- 새 run은 `run:fw02:delete-vss-d538f667-b5a3-4ed1-a17b-5845936cbecc`이며, outputs/test.vhdx와 입력·로그·보고서·컴파일 임시물 전체를 생성 전에 root/fw02-volsnap-reproduction 소유로 등록했다. 실제 fixture는 새 VHDX의 독립 projectRoot 안에만 생성한다.
- 데이터는64KiB 파일16,384개(1GiB)를512개씩32개 disjoint 디렉터리에 배치한다. VSS 복사본을 만든 뒤 실제 owner의 register/review/apply를 호출한다. 32개 디렉터리를 하나의 완결된 그룹으로 등록하고 fresh token에 대한 명시적 삭제만 실행한다. 임의 PowerShell 재귀 삭제로 대체하지 않는다.
- 기존8GiB VHDX·4GiB 동일 볼륨 diff area·총 요청쓰기16GiB·180초 부하 상한 및 자원/이벤트/복사본/기존VSS 보존 조건을 유지한다. 실제 native 작업의 취소·프로세스 종료 계약을 확인한 뒤 실행한다. 종료가 불확실한 삭제 프로세스를 남긴 채 shadow 삭제나 VHD detach를 하지 않는다.
- root는 native adapter·관리자 실행·통합 검토·정리, harness executor는 VHD/fixture/관측 제어기, deletion reviewer는 설치 기능과 native 요청·종료 계약의 읽기 전용 확인을 담당한다. Controller와 adapter 고정 입력이 준비되면 작은 preflight부터 실행한다.
- 설치 CLI는 취소 callback을 false로 전달하고 Windows worker 응답을 시간 제한 없이 기다린다. `lock_wait_ms:0`은 잠금 대기만 제한한다. 사용자는 180초/관측 실패/사용자 중지 이후 새 단계 금지 및 진행 중 native 종료 대기 조건을 승인했다. 강제 종료를 사용하지 않으며 unknown/active 상태에서는 shadow 삭제·detach를 금지한다.
- Preflight는 2026-11-05 20:32:24~20:32:35 KST에 actual exit0. shadow 생성·동일VHD association·4GiB quota·정확한 shadow 삭제·detach·기존 VSS 보존을 확인했다. Native adapter의 실제 함수로 새 작은 프로젝트의 inventory를 호출해 actual exit0과 프로세스 종료를 확인했다. 실제 삭제는 수행하지 않았다.
- 실행 입력 고정값: controller `96c3e24253b15abc1ffda28b4258532b4c9e603061004c2490224c24e3ed67e1`, fixture `db6c6ede095a98bc3ec65bce1a8f137f114c6f02a39cfe314ce948488dcdba04`, adapter `40bfd1ad86e1dcaf7a26d930e83eb0e22606fdd426815ce72a664c61cf31a195`. 성공 Preflight의 원본 controller `d70124db3f0290e34256da9e980eacbe3d9cea5f3c457d46460fd74d90168c56`도 실행 묶음 안에 보존했다. AST·fixture C# compile-only·native helper exit0/exit7 검증은 모두 exit0이다.
- 첫 Delete 단계는 20:56:29~20:57:31 KST에 exit1로 종료됐다. 파일16,384개/1GiB와 shadow 준비는 성공했으나 native Register가 `missing nonempty provenance_ref`로 exit1을 반환했다. 실제 삭제는 시작하지 않았다. 이는 harness의 group 요청 구성 오류이며 [독립 실패 근거](08-deletion-registration-failure.json)에 원래 실패와 종료·shadow 부재·detach·기존 VSS 보존을 남겼다.
- 새 run `run:fw02:delete-vss2-e82e1c78-88a9-460c-b489-c43406dababf`에서만 요청을 수정했다. Prepare가 fixture 소유·완결 구성을 `fixture-provenance.json`에 기록하고 Register group의 필수 `provenance_ref`가 이를 참조한다. adapter의 실제 phase 본문과 native 실행 함수를 AST에서 추출해32개 디렉터리/각1바이트 파일로 Prepare→Register→Review→Apply를 실행했다. native 호출 모두 exit0, 32개 경로 실제 부재를 확인했다. 이 작은 시험은 요청 계약 검증이며 VSS 부하 결과에 포함하지 않는다.
- 수정 입력: controller `ae63f74905a284e30689463d6a60236823a82bc9db4104862cd25f596cb9e3b1`, adapter `8c44c6455f3763da1cb75058d4c75ec66f1bcb03303c125005c714becc9df868`, fixture는 동일하다. AST와 실제 phase 계약 검증 exit0. 같은 승인 범위의 VSS 사전 점검·삭제를 새 identity로 수행한다.
- [실제 삭제 시험 결과](09-deletion-trial.json): 2026-11-05 21:02:23~21:03:55 KST, 단계 전체92.380초(파일 준비·VSS·호출·관측·정리 포함), actual controller exit0. Register10.216초, Review1.648초, Apply15.793초는 각 adapter의 호출·응답 검증을 포함한 시간이며 순수 디스크 처리시간이나 최대 처리량으로 해석하지 않는다. 총 요청 fixture쓰기1GiB, preflight1MiB이며180초 신규 단계 제한에 도달하지 않았다.
- 네이티브 apply는32개 member 모두 `deleted`, `remaining:false`, 삭제 오류 없음으로 반환했고32개 디렉터리의 실제 부재도 확인했다. 원래 파일 생성·완료 수는16,384개다. 삭제 후21:03:55.168 KST에도 같은 시험 shadow `{A7DD84C2-9CDB-4BEA-84F1-3FA67FA614C5}`가 존재했다. 이후 의도적 정리로만 삭제했다.
- 시험 중 새 Volsnap25=0, 다른 Volsnap 이벤트=0. diff area 최대 관측 사용량38,191,104바이트, 할당량301,989,888바이트(상한4GiB)였다. 가용RAM 최저9,994,719,232바이트, C여유 최저176,271,822,848바이트였다. native/adapter/controller 실제 종료·fixture Join·shadow 부재·정상 detach·기존 VSS 보존을 확인했다.
- 이 결과는 현재 설치된 standalone 삭제 도구의 한 차례 제한 시험이다. 삭제와 동시에 별도 합성 쓰기 부하는 주지 않았으며, FW-01의 미설치 개선 후보와의 비교나 실제 대규모 운영 환경에서의 재발 불가를 입증하지 않는다.
- [삭제 실험 정리 결과](10-deletion-cleanup.json): 실패·성공 실행 두 group을 기존 owner로 fresh review 후 명시적으로 삭제했다. actual exit0, group 모두 `deleted`, member 모두 `remaining:false`, 삭제 오류 없음. 논리 크기 합계2,592,656,035바이트이며 물리 회수량은 측정하지 않았다. 두 lifecycle finalize의 `remaining/references/blockers`는 빈 배열이다. VHDX·일회용 제어기·fixture·probe·raw 로그 등 실행물 전체가 정리됐고, 독립 결과와 작업 기록만 보존했다.
