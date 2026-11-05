상태: 통합 개선 계획 제안(draft), 구현 승인 대기. 기존 제한 VSS·삭제 시험과 정리는 완료했다. 이번 변경은 계획 문서에 한정하며 코드 변경·추가 부하 시험·설치·저장 형식 이관은 실행하지 않는다.

# 잠금·삭제·묶음 처리 통합 개선 계획

## 요청과 결정 범위

목표는 4개를 넘는 세션의 집중 요청을 재시도 폭주 없이 수용하고, 관리 잠금 보유와 중복 검증을 줄이며, 안전 조건 안에서 전체 완료시간을 최소화하는 것이다. Volsnap25를 관측 대상으로 유지하고 Windows bugcheck 재현은 제외한다. 기존 사용자의 실제 삭제 종료 대기 조건과 시험 한도는 유지한다.

사용자가 이번에 요청한 산출물은 전체 계획이다. 아래 동작은 제안이며 구현된 기능으로 간주하지 않는다. 승인 시 1~5단계의 소스·호출자·검증 개선을 수행하는 것을 권장한다. 실제 기본 실행기/앱 교체와 저장 형식 이관은 6단계에서 검증된 대상과 영향을 제시한 뒤 별도로 승인받는다.

| 결정할 정책 | 권장안과 영향 |
| --- | --- |
| 경합 처리 | Azrael 관리 호출자는 한 번 접수하고 요청 ID로 대기/결과를 추적한다. 충돌 대상 안에서 접수 순서를 지키되 무관한 요청은 앞 요청을 추월할 수 있다. 저수준 CLI의 명시적 즉시 반환 모드는 호환성을 유지한다. |
| 대기열 한도 | 초기 제안은 프로젝트당 대기 256건, 세션당 32건, 기본 대기 기한 10분이다. 중복 합류는 별도 실행으로 계산하지 않는다. 초과는 재시도 가능 상태와 대기 안내를 반환한다. 수치는 검증 후 확정하며 무제한 접수·즉시 재호출은 하지 않는다. |
| 삭제와 사용 요청 순서 | 이미 사용 중인 소비자를 강제 종료하거나 참조를 제거하지 않는다. 삭제가 접수된 후 같은 대상을 새로 사용하는 요청은 삭제 뒤에 대기시켜 기아를 막는다. 삭제 실행 후 대상이 없으면 사용 요청은 대상 부재로 끝난다. 참조 해제·완료 기록은 대기열을 우회해 진행할 수 있어야 한다. |
| 승인 유효성 | 대기 중 대상 identity·소유·구성·보호 등 승인 근거가 바뀌면 재검토 필요로 반환한다. 오래된 token을 자동 갱신해 삭제 권한을 확대하지 않는다. |
| 병렬 삭제 | 기본은 물리 디스크당 1개, 검증을 통과한 경우 최대 2개로 확대한다. 물리 디스크를 식별하지 못하면 공유하는 보수적 한도를 쓴다. 서로 다른 볼륨/VHD가 같은 디스크를 쓸 수 있음을 반영한다. |
| 취소와 장애 | 대기 취소는 해당 요청자의 대기만 취소한다. 실행 이후에는 다음 안전 경계에서 새 삭제를 중단하고 이미 시작한 OS 작업의 실제 종료를 기다린다. unknown은 자동 재실행·예약 해제하지 않는다. |

## 근거와 한계

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
