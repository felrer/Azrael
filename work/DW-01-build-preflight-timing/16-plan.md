# 소유권과 잠금의 책임 축소

상태: 초기 primary 참조 그래프 조사와 명명된 설치·workspace 사례의 심층 검증을 마쳤고 만료 참조 4개를 지원 API로 해제했다. 필요한 소비자 보호가 누락된 native 그룹 2개도 갱신했다. 기존 레거시의 archive 정리는 아래 종료·복구·소유권 조건이 미해결이므로 완료가 아니다. 사용자 추가 판단이 필요한 범위는 현재 설치/프로필 변경 또는 복구 가능성 포기이며, 일반 조사·검증과 근거 있는 잔여 참조 해제는 승인된 정리 범위에서 진행한다.

## 레거시 참조의 현재 유효성 검증

### 고정 소스 준비 래퍼 revision 동기화

상태: 현재 checkout의 구현·Windows x64 검증·임시 자료 정리 완료. 사용자는 2026-10-28 조사에서 권장한 공통 갱신 경로·종료 근거 보호·통합 회귀를 승인했다. `freeze-a`는 준비/검증 완료 뒤 caller reference 갱신으로 revision 1→2가 됐으나 래퍼가 1로 close하여 실패했다. 기존 실패/exit 1과 고정 입력은 변경하지 않는다. 공통 Node 동작이며 다른 OS 실행은 구분한다. 제품 빌드·설치·고정 소스 재생성은 범위 밖이다.

root는 artifact-run/deployment-workspace 및 owning architecture/ops, 실행·정리를 소유한다. 독립 테스트 담당자는 기존 두 behavioral suite만 확장한다. 참조 추가 함수는 저장 성공 직후 같은 프로세스의 정확한 작업 handle도 갱신한다. 종료는 catalog lease 안에서 현재 기록과 handle의 revision/identity를 확인하며 최신 기록을 무조건 채택하지 않는다. 관측 보고는 내용 기반 불변 파일로 보존하고 producer는 그 SHA에 묶는다. 기존 `producer.json` 조회 경로는 관측 view로 유지한다. 준비 성공·참조 추가 뒤 중간 실패·진짜 stale 변경·기존 종료 근거 보존·pending 이후 종료를 검증한다. 역할별·scope 참조와 unknown 보호를 유지한다.

독립 수용·종료·정리 근거는 `artifacts/maintenance/evidence/run-revision-20261028-*.json`의 관리 owner `DW-run-revision-20261028`에 귀속한다. 검증 fixture·로그는 충돌 확인 후 `artifacts/tasks/run-revision-20261028-a/`로 사전 선언한다. source/writer의 영향 검사와 실제 Windows catalog/CAS 경계를 확인한 뒤 최소 독립 결과만 남기고 최적화 owner로 disposable root를 정리·부재 확인한다. 현재 EB-01의 활성 실행·고정 사본·캐시는 수정하지 않는다.

검증: Windows x64, Node 26.7.0, 기존 소유자에 execution 참조로 연결한 PowerShell 및 Python으로 source/writers 선택 7개 명령이 모두 실제 exit 0을 기록했고 관련 입력 SHA도 유지됐다. artifact-run 20.267초, 실제 준비 통합 45.203초, check writer 2.133초, renderer writer 32.936초, instruction release ownership 4.003초, lifecycle/build-platform 98.215초(170 pass, Unix 실행 mode 1 skip), platform packaging 24.879초다. 준비 성공과 갱신 뒤 예외의 실패 종료, 실제 stale update·외부 종료 거절, 과거 불변 근거와 committed SHA 보존을 확인했다. 기존 두 suite의 새 사례는 반복되는 revision/증거 계약의 회귀 보호이므로 유지한다. 독립 수용 근거는 `run-revision-20261028-acceptance.json`이다. 최초 close는 공용 OS catalog 잠금 점유로 쓰기 전에 거절됐고, 점유 해제 뒤 같은 revision으로 정상 close하여 실행 참조를 해제했다. 점유된 잠금의 제거·우회는 수행하지 않았다.

정리: 최초 native 등록은 측정 후 catalog 재획득 실패(exit 1)로 registration 예약을 남겼다. 정확한 leaf native PID 86100의 실제 종료 코드, 자식 부재와 변경 없는 OS 잠금 제외 probe를 결합해 지원 `recover_reservation`으로 자기 예약만 복구했다(exit 0, 기존 실행 결과·pending intent 불변). 첫 등록 이후 관리 출력이 disposable 로그를 바꾼 문제는 payload를 고정하고 이후 출력을 control 범위로 옮겨 전체 재등록했다. 이후 일시적인 source 잠금 실패를 stale 입력으로 간주해 guard를 우회하지 않았다. 최종 등록·fresh registered review·apply는 모두 exit 0, blocker 0, `deleted/remaining:false`다. 11,369,657바이트의 임시 root와 자기 active 예약 부재를 확인했고 producer finalize도 완료했다. 삭제 apply 108.474초, 마지막 등록 구간은 정상 점유 대기·15회 순차 시도 포함 173.471초였다. 검증 전체를 재실행하거나 제품을 빌드하지 않았다. 최소 독립 acceptance·예약 복구 proof·cleanup 근거 3개만 같은 evidence prefix에 유지하며 raw fixture·사본·로그·요청 파일은 정리했다. 관리 owner는 위와 같으며 기존 EB-01 자료와 고정 입력은 그대로다. 다음 작업은 현재 checkout의 공통 helper를 사용하고, 이전 frozen workspace·설치 앱에 소급 적용하지 않는다.

### 종료·소유권 해소와 추가 이관 실행

사용자는 남은 소유권·종료 확인 문제를 해결하고 정리 가능한 파일을 archive로 이동하도록 승인했으며, 이어 변경·삭제 권한과 보관·관찰 기록을 별도로 관리하는 방향을 확정했다. 경로 중복을 일괄 차단하는 제안은 철회했다. 실제 생성자의 신규 소유권 충돌과 정당한 관찰 범위의 겹침을 구분하고, 미분류 보관 기록은 삭제 권한 없는 observation으로 명시 전환한다. 사용·복구가 미확정인 경로는 기존 native consumer-reference 프로토콜의 scoped hold로 보호한다. 같은 catalog/OS lease/예약 fence를 유지해 보호 기록을 물리적으로 분산하지 않으며, 현재 standalone의 보호 검사를 우회하지 않는다. 생성자 record/결과/구성은 그대로 두고 명확한 근거와 소비자 제외 확인으로 만족한 hold만 해제한다. 새로운 archive 제품 API, 강제 삭제, 활성 설치/진행 중 EB-01 작업의 취소나 보호 해제는 범위 밖이다. 공통 Node 의미를 유지하고 실제 검증은 Windows x64이며 다른 OS 실기를 주장하지 않는다.

root는 운영·archive mapping·독립 근거·문서·최종 수용을 소유한다. `legacy_custody_reconcile`은 lifecycle helper/observation 보조 구현과 기존 behavioral tests만 담당한다. 기존 읽기 전용 조사자들의 미완료 운영 조사는 사용자 설계 재검토 시 보류했으며, 다시 필요할 때 승인된 같은 범위로 재개한다. 공용 catalog/native 변경은 root가 직렬 실행하고 별도 EB-01 producer/cache와 겹치지 않게 한다. 코드 READY 뒤 기존 source 단계의 lifecycle/build-platform/platform-packaging 및 writer 호출 경로 검사를 실행한다. 보관 기록의 등록·삭제 권한 거절, 실제 owner 보호의 native review/예약 연동, CAS·부분 실패·소비자 제외·다른 hold 보존을 검증한다. 생성자의 실제 실패를 성공으로 승격하지 않는다.

작업의 보호 제어 기록은 `artifacts/maintenance/evidence/legacy-reference-resolution-20261027.json` 및 같은 고유 접두사의 불변 근거, owner `DW-legacy-reference-resolution-20261027`이다. disposable 검증/실행 로그는 충돌 확인 뒤 `artifacts/tasks/legacy-reference-resolution-20261027-a/`에 사전 선언하고, 사용 종료 후 ordinary 정리·실제 부재 확인한다. 이관 대상은 원래 owner를 유지하고 새로운 `archive/legacy-reference-resolution-20261027-a/`에 mapping과 파일시스템 identity를 보존한다. 관리 기록·근거·active reservation은 payload와 분리한다. 내용·권한·link 검사는 기존 owner 검사 범위를 재사용하고 같은 볼륨 ordinary rename 후 source 부재와 identity 보존을 확인한다. 일부 근거가 끝내 확인되지 않으면 정확한 미해결 대상/조건을 남기며 전체 정리 완료라고 보고하지 않는다.

구현 수용: 현재 checkout의 Node helper에 관찰 전용 생성·전환·해소·조회 API를 추가했다. 일반 producer 등록/종료/참조 해제/native 등록/예약/finalize로 관찰을 소유자로 승격하지 못한다. 공통 fixture 복사와 Cargo 검증 identity에도 새 helper를 포함했다. 권한·보호 누락·부분 출판·동시 변경은 반복 방지가 필요한 계약이므로 기존 lifecycle behavioral suite에 회귀를 유지하며 별도 일회성 테스트 소스는 남기지 않는다.

Windows x64 검증: source lifecycle/build-platform 171개 중 170 통과·Unix mode 1개 조건부 제외, platform-packaging, writer 5개 명령, Cargo cache/owner/pipeline 49개 및 실제 Windows RegistryOnly가 모두 실제 exit 0이었다. 앞선 source fixture 1건과 packaging fixture 중복 준비는 기대 계약을 보존하여 수정했다. Python PATH 부재에 따른 writer/cache 실패는 설치된 Python 3.13.15의 tomllib을 확인하고 검사 프로세스에만 경로를 추가해 재실행했다. 실패 시도와 실제 exit는 성공으로 바꾸지 않았다. 최소 독립 영수증은 `artifacts/maintenance/evidence/legacy-reference-resolution-20261027-acceptance.json`이며 원시 로그는 task disposable이다. 다른 OS 실행·앱 내장 엔진·과거 frozen workspace 교체는 검증하거나 수행하지 않았다.

실제 기록 전환: DM revision 2→3의 관찰 범위 483개, BI revision 10→11의 2,694개를 원본 bytes·외부 근거와 고정하여 전환했다. 각각 scoped hold 10개·12개로 기존 불확실성을 보호하며 두 기록 간 중복을 새 생성 소유권으로 취급하지 않는다. BI의 h20 hold 1개만 원래 생성자의 정확한 stopped failure/exit 1과 소비자 부재 근거로 해소하여 revision 12, 나머지 hold 11개를 유지했다. 실제 생성자의 bytes·실패 결과·두 구성원은 불변이다. DM aggregate 소비자는 pending이고 확인한 고정 입력만 h20/z를 제외하므로 미기재·동적 사용까지 배제하지 않았다. DM h20 hold와 나머지 참조를 유지하여 h20/z archive는 미실행이다. 이관 선행조건은 현재 DM 소비자의 완전한 범위별 제외 또는 독립 종료·참조 해제다. 두 API의 물리 작업 결과는 모두 payload 이동/삭제 없음이다. catalog 점유로 시작 전에 거절된 해소/정리 시도는 잠금을 제거하지 않고 정상 점유 종료 후 정확한 요청으로 재개했다.

이번 구현 단계의 임시 자료 정리 완료: 검증용 portable PowerShell·fixture·복제 입력·원시 로그를 포함한 task root 294,557,957 logical bytes를 standalone owner 최초 등록(133.078초) → registered fresh review(blockers 없음) → 명시적 delete apply(149.908초, actual exit 0)로 정리했다. 실제 status deleted/remaining false와 전체 root 부재, 활성 예약 부재 및 producer finalize를 확인했다. 실행기는 확인된 생성물의 ReadOnly/Hidden만 210건 정규화했으며 System/ACL/소유권을 바꾸지 않았다. 임시 요청·원시 관리 출력도 compact proof로 대체한 뒤 일반 삭제했다. 필요한 관리·전환 근거만 위의 보호 owner에 남고 관련 미확정 hold/이관 기록의 compaction 때 재검토한다. 독립 정리 영수증은 `artifacts/maintenance/evidence/legacy-reference-resolution-20261027-cleanup.json`이다. 이 구현 단계는 수용됐으며, 기존 레거시 전체 archive는 별도 잔여 작업이다.

목표는 이전 선별에서 참조 때문에 제외된 항목을 현재 소비자와 대조하여 실제 보호·무효 기록·근거 부족으로 구분하고 정리 가능한 범위를 실행하는 것이다. primary producer/native 참조 전체를 분류하고, 별도 설치/프로필과 module/workspace 등록도 포함한다. 기록의 이름·나이·complete 상태·경로 누락만으로 참조를 해제하지 않는다. 현재 설치본, 유일한 복구/검증 근거와 종료 불명 작업을 보호하며, 삭제 속도·새 archive 제품 API·전체 빌드는 이번 범위가 아니다. 실제 관측은 Windows x64이다.

- root는 전체 참조 그래프, 기존 해제 API, 원본과 독립된 현재 근거, native 정리/이관과 최종 검증을 소유한다. 읽기 전용 `legacy_install_reference_audit`는 명명된 레거시의 실제 설치/프로필 소비자를, `legacy_workspace_reference_audit`는 o/p/q 입력·module 등록·재시도 근거를 조사한다. 두 조사자는 파일이나 공유 관리 상태를 쓰지 않는다.
- 보호된 제어 기록 `artifacts/maintenance/evidence/legacy-reference-audit-20261027.json`은 owner `DW-legacy-reference-audit-20261027`의 참조별 결론·identity·지원 API 결과를 담는다. 임시 실행 요청/스크립트는 같은 고유 접두사로 명시하고 사용 후 ordinary 삭제·부재 확인한다. 필요한 제어 근거만 남기며 관련 미해결 작업/복구/이관 기록의 compaction 시 함께 검토한다. archive 대상은 해당 기존 owner를 유지하며 감사 작업이 목록만으로 인수하지 않는다.
- 선행조건은 소비자·대상·참조의 정확한 identity, 현재 reader/producer와 해제 근거, 관련 owner 절차 확인이다. 지원 API의 owner/revision/evidence 검사를 유지한다. 해제 후 영향 그룹만 protection refresh 및 fresh review하며, 비어 있거나 이관한 원본만 metadata 정리한다. 실제 payload는 기존 승인에 따라 archive로 이동하고, 새 목적지·identity/내용 보존·원본 부재를 검증한다. 전체 payload 재해시나 중복 producer 실행은 하지 않는다.
- 완료 기준은 조사한 참조 전체의 현재 판정, 실행한 해제/이관의 실제 결과와 identity, 활성 설치·복구 보호 유지, 임시 생성물 정리 및 미확정 항목의 구체적 다음 조건이다. 원래 실패/unknown을 성공으로 바꾸거나 누락된 과거 근거를 재구성하지 않는다. 승인된 관찰·소유권 분리 계약은 기존 architecture/ops 소유 문서에 반영한다.

### 2026-10-27 참조 조사·운영 결과

13:21:05.410Z부터 13:38:56.002Z까지의 조사·운영 결과이다. 시작 당시 primary producer 499개, 참조 303개를 구조적으로 분류했다. 순환은 없었고, producer ID에 직접 대응하지 않는 참조 54개는 외부 작업명·문서·과거 handoff도 포함하므로 자동 무효 처리하지 않았다. execution 참조 77개는 소비자에 알려진 stopped 영수증이 없었다. 이는 실제 실행 중이라는 증거도, 종료됐다는 증거도 아니다. 심층 검증은 아래 명명된 사례에 한정하며 모든 참조의 현재 사용을 실증했다고 주장하지 않는다.

| 대상 | 확인한 현재 의미 | 처리·남은 조건 |
| --- | --- | --- |
| `r19-install-final`의 0.11 준비 참조 3개 | 준비만 완료했고 실제 설치는 시작하지 못했다. 이후 ordinary profile 0.12 설치와 독립 검증이 존재한다. | owner/revision/독립 근거 SHA를 묶어 `releaseReferences`로 3개 해제, revision 3→4. 원래 producer/close 결과 불변. r16 중첩 소유권, r13의 다른 소비자, continuation2의 BI/DM custody가 남아 payload 이관은 미실행. |
| `version:w10a`의 “Active requested Windows release build and installation” | 0.10 설치는 당시 실제 성공했으며 현재 ordinary profile은 0.12이다. 과거 진행 중 표식의 목적이 끝났다. | 동일 지원 API로 1개 해제, revision 3→4. 멤버 2개와 producer 상태는 유지했다. 전체 producer 종료·복구 정리 근거와 primary 관리 경계 문제가 남아 `n10a` 전체는 이동하지 않았다. |
| CF approval engine / DC reply-native-2 | 현재 inbound 소비자가 cached native 참조보다 각각 2개·3개 더 많았다. | `refresh_group` 2회 실제 exit 0. 내용 identity/측정 시각·바이트는 유지하고 보호만 갱신했다. fresh registered review 실제 exit 0이며 두 그룹의 참조 차단을 확인했다. |
| `iy17b` | 별도 external profile registry가 0.8을 선택하며 runtime이 해당 경로를 가리킨다. | 유효한 설치 보호이다. ordinary profile 교체로 해제하지 않는다. 그 프로필을 폐기하려면 설치 owner의 별도 처리가 필요하다. |
| `workspaces/o·p·q`, `inputs/dw13-r2·r3·r4` | DW13 revision 14의 execution 참조 6개와 workspace→input 의존성이 있다. q/r8도 p/r7 engine 및 r3 입력을 검증·사용한다. | r2/r3–r5의 정확한 producer-tree 종료와 재시도/복구 인계가 미확정이다. 먼저 상위 소비자를 정리한 뒤 workspace/input, module 등록 순으로 해소해야 한다. module registry의 o/p/q 항목만으로 현재 실행 중이라고 단정하지 않는다. |
| `w14w`, `verification/AK-02-api-context-fix` | BI/DM의 중복 custody이며 실제 생성·종료 근거가 부족하다. | 현재 설치가 다른 곳을 가리키는 사실만으로 이동하지 않았다. 원래 producer와 정확한 멤버를 확인하고 지원 소유권 절차로 중복을 해결해야 한다. |
| DO native 검증 입력·출력 | 별도 진행 중인 제품 보존 작업과 공유 target 소유권 충돌이 존재한다. | 이 감사가 작업 종료나 전체 cache 소유권을 대신 결정하지 않는다. 해당 owner의 보존·generation 정리가 필요하다. |

검증은 운영 API의 실제 결과와 변경 후 record를 확인하는 방식으로 수행했다. r19 해제 준비 첫 호출은 기존 PowerShell JSON의 UTF-8 BOM 때문에 쓰기 전에 실패했으며, 원본 바이트를 보존하고 BOM을 읽기에서 처리한 뒤 실제 성공했다. 제품 코드는 변경하지 않았고 빌드·테스트·설치·프로필 변경은 수행하지 않았다. 이번 파일 이동/삭제 0개, 용량 회수 주장 0이다. 임시 request 파일은 ordinary 삭제 및 부재 확인했다. 필요한 관리 제어 근거 3개는 합계 505,817바이트이며 관련 미해결 참조/이관 기록의 compaction 때 함께 검토한다.

조사 중 별도 `EB-01-latest-windows-profile-install` 작업의 새 producer 4개와 참조 3개가 생성됐다. 이 범위는 변경하지 않았다. 따라서 관측 종료 시 primary는 503개/참조 302개이며, 초기 303개에서 이번 해제 4개와 동시 작업 추가 3개를 분리한다. [상세 감사 기록](../../artifacts/maintenance/evidence/legacy-reference-audit-20261027.json), [0.11 해제 근거](../../artifacts/maintenance/evidence/legacy-reference-audit-20261027-r19-retirement.json), [0.10 표식 해제 근거](../../artifacts/maintenance/evidence/legacy-reference-audit-20261027-w10a-retirement.json)에 정확한 identity·원본 SHA·API 결과·미해결 조건을 보존했다. 초기 그래프의 구조 분류와 명명된 사례 조사는 완료했으나 보호·근거 부족 레거시의 전체 archive 정리는 계속 미해결이다.

## 레거시 전체 선별 및 사용자 확인용 archive 이관

### 사용자 직접 삭제 후 후처리 재개

사용자가 `archive/legacy-20261027-a/`를 직접 삭제했다고 확인하고 같은 위치의 빈 폴더 재생성 및 계속 진행을 요청했다. 빈 폴더를 다시 만들었으며 삭제된 payload, 원래 archive 프로젝트 registry와 raw log는 복원하지 않는다. 설치된 새 standalone과 version 소유의 최소 검증 요약은 별도 경로에 남아 있다. primary의 원래 native PID66492에 묶인 terminal/recovered 영수증으로 92개 source ID를 다시 식별했고, 모든 원본 멤버 부재·해당 활성 예약 부재·inbound 참조 부재를 관측했다. 이 중 native 그룹은 38개이다.

후처리 owner는 `DW-legacy-archive-20261027-a`이다. 보호된 제어 근거 `artifacts/maintenance/evidence/legacy-20261027-user-disposal.json`에 사용자 확인, 정확한 원본 ID/영수증 identity 및 실제 metadata 처리 결과만 기록한다. 같은 디렉터리의 `.request.json`은 이 작업만 쓰는 임시 요청이며 사용 직후 ordinary 삭제·부재 확인한다. 제어 근거는 원본 ledger 폐기와 사용자 직접 삭제 사실을 연결하는 작은 독립 기록으로 관리하며, 관련 미해결 intent/참조가 없고 제어 기록 compaction이 지원될 때 검토한다. payload 삭제 작업을 재실행하지 않고 fresh review가 전 멤버 부재를 확인한 그룹만 지원 apply로 metadata 조정한 후 지원 finalize한다. 새 경로가 나타나거나 보호·identity 불일치가 있으면 해당 후처리를 중단한다.

현재 결과: 후처리 완료. 2026-10-27 12:44:43.660Z–13:10:19.110Z(25분 35.450초, review와 직렬 후처리 포함)에 38개 native 그룹을 `registered` 검토 및 부재 전용 apply로 반영하고 92개 원본 producer record를 지원 finalize로 제거했다. 모든 apply의 실제 exit 0, 항목별 `attempted:false`, `remaining:false` 및 실행 controller 실제 exit 0을 확인했다. 13:10:47.172Z 최종 검증도 실제 exit 0이며, 원본 record 부재·419개 선언 멤버 경로 부재(중첩 경로 포함)·선택된 활성 예약 0·기존 terminal/recovered 영수증 SHA 불변·임시 요청 부재·새 archive 폴더가 비어 있음을 확인했다. 구 standalone의 원본 version 경로/producer record도 없고 새 기본 실행기의 SHA는 설치 identity와 일치한다. [독립 후처리 근거](../../artifacts/maintenance/evidence/legacy-20261027-user-disposal.json)는 421,685바이트이다. 이번 실행은 파일 삭제를 시도하지 않았으며, 원래 이관 작업의 interrupted/unknown 결과를 성공으로 변경하지 않았다. 사용자가 삭제한 archive 프로젝트·raw log·검증 run E는 재생성하지 않는다. 현재 설치본과 version 소유 검증 요약은 유지한다. 기존 활성·보호·미확정 레거시는 이번 부재 후처리 범위 밖이다.

아래 준비·실행 관측은 이번 개선 작업의 경과이며, 현재 후처리 상태는 위 결과를 따른다.

### 예약 해제 반복 검증 개선

실행 중간 근거: 고정 입력 E의 공식 recorder는 11:34:55.059Z–11:38:17.933Z 실제 exit 0, SOURCE SHA `8ccb5ecee8c3b55458f563c697ae5b5d8f536061d5537acac742b26232bcaa63`이다. 실제 standalone 의존 트리와 설치 receipt를 대조한 로컬 소스 30개 중 compiled delta는 `reservations.rs` 한 개뿐이다. E의 독립 Git 준비 최초 실패(long path)는 컴파일 전 실패로 보존하고 해당 임시 저장소의 `core.longpaths`만 설정해 아직 고정 전인 동일 바이트 준비를 마쳤다. v1 library는 PATH의 cargo 발견 실패로 컴파일 시작 전 종료했으며 v2는 PATH만 교정했다. v2 library는 실제 159개 검사 exit 0(281.956초), release exit 0(21.776초)이다. 새 동작 회귀는 unknown/incomplete 예약 보존, 뒤 그룹 source fence 변경 시 부분 완료 보존, terminal 저장 뒤 현재 record/source/evidence/권한/lease 변경 차단을 검증한다. core/prompts와 최종 source-after는 아직 실행 중이며 설치·전체 수용 전이다.

제어된 Windows x64 실제 native `finish_producers` 비교는 11:46:51.934Z–11:53:03.803Z에 끝났고 여덟 subprocess 모두 exit 0, active 예약 0, fixture payload 보존을 확인했다. binary별 각 2회, before/after 순서를 교대했다. 8개 평균 4.659초 → 1.651초(64.56% 감소/2.82배), 24개 평균 82.303초 → 12.312초(85.04% 감소/6.68배)이다. 예약 획득·catalog 반환·물리 이동과 전체 레거시 경과시간의 개선율은 이 수치에 포함하지 않는다. 실행파일 SHA는 `08180d46e0e02b634a2716135adf0c2d01a72e48acda0938ac7e2fb889f78f2d`; 최종 필수 검사 전에는 기본 설치를 전환하지 않는다.

최종 자동 검증은 12:06:33.347Z 실제 exit 0이다. library 159개, core 8개(1,183.915초), prompts 1개(21.337초), 전체 고정 입력 source-after(82.691초)가 통과했다. 비교/빌드/source 검증은 각각 원래 범위를 보존하며 공통 구현의 타 OS 실제 수용을 주장하지 않는다. 종료 전 관측 여유 공간은 5,225,140,224바이트였다. 별도 PowerShell 파일 기반 용량 monitor는 로컬 실행 정책으로 시작 전 exit 1이었고 정책을 바꾸지 않았다. 단계 경계 및 실행 중 수동 용량 관측은 3GiB 이상이었으며, 지속 자동 monitor를 실행했다고 주장하지 않는다. 사용 종료한 monitor/준비/비교/구 이동 스크립트는 ordinary 삭제와 실제 부재를 확인했다.

구 archive 실행기의 전환: 첫 종료 preflight는 CIM의 마이크로초 정밀도와 OS handle creation의 100ns 정밀도 차이(2/4 ticks)를 잡아 종료 전에 거절했다. 정확한 원래 PID/부모/실행파일/전체 정밀도 생성 시각 및 실제 하위 conhost를 handle로 고정한 뒤 12:08:15Z–12:08:16Z에 자체 native PID66492만 중단했다. native 실제 exit -1, 하위 conhost exit0, controller PID66136 자연 종료 exit1 및 observer/tool의 실제 terminal을 확인했다. catalog byte-range OS 잠금 배타성 probe 전후 SHA도 동일했다. 원래 finish는 interrupted/unknown으로 보존한다. 동기 terminal 출판 뒤 남은 active 예약은 정확한 기존 terminal+독립 stopped-tree 근거를 연결해 지원 recover_reservation으로만 복구하며, 기존 영수증이나 manifest intent를 삭제·성공 변환하지 않는다.

원본 92개 예약의 정확한 terminal/recovered 영수증과 active 부재를 확인한 복구 operator는 실제 exit 0이다. 기본 standalone을 `artifacts/versions/maintenance-owner-08180d46-win-x64-dw17-release/payload/maintenance_owner.exe`로 설치했고, 직접·기본 resolver 경유의 실제 native lease smoke가 각각 exit 0이었다. 설치 selector의 4필드와 full deployment 영수증을 혼동한 첫 preflight는 쓰기 전에 exit 1이었으며, 두 영수증 identity 일치를 강제한 뒤 정상 설치했다. 새 version의 installation 참조를 먼저 붙이고 교체 검증 후 기존 참조만 지원 API로 해제했다. 앱 내장 엔진은 바꾸지 않았다. 현재 구 standalone의 archive 이관 및 원래 92개 보관 그룹 등록·metadata 정리, 검증 disposable run 정리가 남아 있다.

입력 준비 수정: primary `engine/SOURCE.json`은 작업 시작 전부터 설치 실행기의 SOURCE와 달랐고, recorder가 관리도구 외 동시 변경을 포함한 40경로 delta를 거절했다. 실패 A는 실제 exit 1이며 receipt를 변경하거나 컴파일하지 않았다. 검증 소스는 설치본 SOURCE SHA `4412f2f69f6669a8193ff7a56caad8d760bdb31368b64a116476fbc35c43cb23`의 선택 바이트를 primary/기존 원본 import/고정 Git HEAD에서 찾아 별도 입력으로 구성한다. B/C/D는 사전 준비에서 각각 missing source/미지원 placeholder 분기를 찾아 exit 1로 종료했고, 불변 입력 receipt나 컴파일을 만들지 않았다. 원래 파일과 index는 변경하지 않았으며 각 실패 run은 실제 결과로 close한다. 기존 workspace b의 `harness-runtime-core.md`는 설치 receipt SHA와 일치하는 바이트만 재사용한다. 설치 당시 `agent_behavior.md` 바이트는 조회한 위치에 없으므로 현재 파일을 전체 workspace 맥락으로 명시적으로 고정하되 standalone 관리 실행기의 compiled closure에는 포함되지 않음을 확인한다. 현재 준비 E는 이 두 reviewed delta(`reservations.rs`, 비컴파일 context `agent_behavior.md`)만 별도 SOURCE에 기록하며 primary SOURCE의 다른 작업 변경은 채택하거나 수정하지 않는다. `optimization-run-e/inputs/.git`은 사본의 mode/출처 기록용 독립 임시 metadata이고 작업 checkout index/HEAD와 무관하며 disposable run에 포함된다.

사용자 승인: 현재 확인한 예약 해제의 전체 재검증 반복을 최적화한다. 공통 Rust 구현의 의미는 Windows x64·Linux x64·macOS ARM64에 공통이며, 이번 실기 검증·별도 실행기 반영 대상은 Windows x64/Rust 1.95.0이다. 앱 전체 빌드·내장 엔진 교체는 하지 않는다. 기존 record/source/evidence SHA·권한·OS lease·실제 존재 검사와 durable terminal 동기 저장은 유지한다.

- root: `reservations.rs` 비테스트 구현, provenance, 입력 고정·컴파일·측정·설치·현재 이관 후처리. child `reservation_release_regressions`: 같은 파일의 기존 test module 안에서만 동작 회귀 보강; 편집 READY를 받았고 source는 고정 후 실행한다.
- 전체 집합 검증은 해제 명령 진입 때 한 번 수행하고, 각 제거 직전에 해당 ID의 OS lease·durable reservation·source fence를 새로 확인한다. lease는 ID별 BTreeMap으로 조회한다. 미확인 outcome은 유지하고 나중 그룹의 손상은 그 그룹을 보존하며 이미 끝난 독립 그룹의 사실을 되돌려 쓰지 않는다.
- 생성물은 기존 별도 archive 프로젝트의 `artifacts/payload/optimization-run-a`에 생성 전 run owner로 선언한다. 기존 `engine/codex-rs/target`을 관리 Cargo lease로 재사용하며 다른 cache의 미확정 owner를 지우거나 우회하지 않는다. 3GB 미만이면 승인된 용량 확보 후 회복되지 않을 때 중단한다.
- worker READY 뒤 정확히 한 소스 경로의 recorder를 실행하고 receipt-selected 전체 engine source를 새 불변 입력으로 고정한다. 먼저 실제 library 회귀와 release 실행기를 검증하고 같은 native lease 경로로 전후 시간을 측정한다. 필수 보존 검사는 해당 계약과 변경 위험에 맞춰 실행하며, 기존 core/prompts의 충분한 증거를 재사용할 수 있는지 별도로 구분한다.
- 현재 장기 이관은 이미 시작된 구 실행기이므로 새 파일 컴파일만으로 빨라지지 않는다. 검증된 후보 준비 전에는 점유 잠금·예약을 변경하지 않는다. 전환이 필요하면 정확한 소유 프로세스·자식 종료 관측과 지원 복구 절차만 사용하고, 이미 이동한 payload는 다시 이동하지 않는다. 정상 완료·중단·실패의 실제 결과를 구분한다.

2026-10-27 실행 관측: 92개 묶음/107개 원본 루트, 일반 파일 232,963개, 논리 크기 11,333,025,069바이트를 `archive/legacy-20261027-a/artifacts/payload/`로 이동하고 이동 전후 식별 정보와 원본 부재를 검증했다. payload 삭제와 물리 여유 공간 확보를 주장하지 않는다. 전체 분류·이동 근거는 해당 archive의 README와 `artifacts/control/`에 있다. 아직 native 예약 해제/보관 등록 및 원본 metadata 조정이 끝나지 않았으므로 전체 작업 완료가 아니다.

장기 의존 단계: 정확한 operator PID 66136(creation UTC 2026-10-27T10:27:20.0187260Z), native PID 66492, 기존 실행 session 70062. 예약 92개 전체를 반복 검증하는 해제 요청이 실행 중이며 11:04 UTC에 활성 예약 90개로 진행을 관측했다. 중복 요청·강제 잠금 삭제 없이 실제 종료를 기다린다. 별도 observer session 77665는 이 정확한 operator의 실제 프로세스 종료/exit를 기다려 work completion `b84ba3ad-5bbe-4e35-a5f9-13eae50f26ed`를 기록한다. 이는 추정 시간 경과를 완료로 바꾸지 않는다. 다음 실행은 operator terminal 확인 후에만 `reconcile-archive.cjs`로 보관 review/defer와 이미 사라진 원본 경로의 metadata 조정, producer finalize를 수행한다. 현재 실행 중인 `move-legacy.cjs`를 다시 실행하지 않는다.

상태: 실행 중. 사용자가 `artifacts/`의 레거시 전체 선별과 archive 이관을 요청했으며 보관본은 사용자가 확인 후 삭제한다. 원본 삭제·새 archive API·관리 allowlist 확대·사용 중 입력 이동은 수행하지 않는다. `engine/codex-rs/target`은 이 단계의 실제 이동 범위 밖이며 관련 참조는 분류에 반영한다.

- 실행 owner: DW-legacy-archive-20261027-a. 신규 보관 경계: `archive/legacy-20261027-a/`; 별도 project-maintenance 설정의 managed root는 `artifacts/payload`, 관찰 보고·요청·이관 명세·최소 근거는 보호된 `artifacts/control`, lifecycle metadata는 `artifacts/maintenance`에 둔다. 이 owner는 보고서 생성자이며 기존 자료의 소유권을 목록만으로 인수하지 않는다.
- 기존 native/producer/cache 기록과 실제 최상위·소유 root를 대조하여 전체 `artifacts/`의 분류를 남긴다. 이전 읽기 전용 크기 조사 결과는 재사용하고 동일 전체 payload 해시를 반복하지 않는다. 미등록·충돌·활성·미확정 자료는 해소 조건을 명시하고 안전한 독립 후보의 이관을 먼저 수행한다.
- native 현재 review와 실제 설치/reader·producer 근거를 확인한 비활성 완전 묶음만 ordinary 동일 볼륨 rename으로 옮긴다. 대상별 원래 owner/identity/참조/근거를 보관하고 신규 관리 경계에 계획 선언 후 이동, identity/내용 보존 및 원래 부재 확인, 완전 재등록·보관 defer, 원래 metadata 조정 순서로 처리한다. 살아 있는 보호·잠금·sole recovery를 우회하지 않는다.
- 이관 명세와 결과는 사용자가 보관 자료를 확인·삭제할 때까지 승인된 근거다. 이동·미이동·차단과 논리 크기/실제 공간 회수를 구별하여 보고한다. 새 임시 파일이나 도구를 만들면 같은 run/control 경계에 두고 사용자 검토에 불필요한 실행 임시물은 종료 때 정리한다.

## 후속 분석: 작업 종료 뒤 용량 증가 방지

상태: 원인 조사와 시스템 개선안 제안. 사용자 확인 이후 백업을 포함한 정리를 수행하는 공통 지침 변경은 반영·검증 완료했으며, 나머지 시스템 변경과 레거시 이관은 이 지침 수정의 실행 범위가 아니다. 누적 `artifacts/`의 archive 이관은 현재 설치·실행·입력·복구 참조와 소유권을 확인한 비활성 생성물에 한정한다. 같은 볼륨의 archive 이동은 용량 확보가 아니다.

### 이번 지침 수정의 실행 범위

- 공통 `implementation/references/artifact-lifecycle.md`에 사용자 확인 대기와 확인 후 정리 절차를 둔다. 불필요한 임시자료는 즉시 삭제하며, 사용자 확인·복구에 필요한 최소 묶음만 정확한 경로/그룹·현재 identity·목적·알려진 용량·해제 조건과 함께 알린다. 백업·롤백 사본·필요한 복제 환경도 포함한다.
- `implementation`의 정리/완료 기준, `build-inputs`의 백업 계약, 전역 AGENTS와 development-workflow의 최종 수용 및 위임 예시를 연결한다. 현재 프로젝트 지침과 새 프로젝트용 bootstrap playbook도 공통 절차를 참조하게 한다.
- 명확한 정상 동작 확인 후 별도 정리 요청 없이 현재 소유권·참조·복구 보호를 다시 확인해 삭제하고 실제 부재를 보고한다. 문제 보고·취소·모호한 확인은 별도로 처리하며, 확인 대기는 작업 전체 완료가 아니다. 이 절차는 최소 확인/복구 묶음의 조건부 대기만 허용하며 무제한 캐시 보존을 허용하지 않는다.
- 설치된 skill junction은 원본 변경을 직접 반영한다. 별도 전역 `C:/Users/felre/.azrael-ex/AGENTS.md`는 필요한 문단만 갱신해 사용자 고유 내용을 보존한다. skill receipt를 실제 bytes에 맞추고 기존 component mapping과 역사적 SOURCE 기록은 보존한다.
- 검증은 instruction library 검사, 설치 경로/bytes 확인, 승인된 절차의 정상 확인·문제 보고·보호 백업·무응답·불필요한 임시자료 사례 검토로 한정한다. 제품 빌드·시스템 정리 강제 기능·기존 레거시 이동은 수행하지 않는다. 실제 미래 대화에서의 Agent 준수나 OS별 삭제 동작을 검증했다고 주장하지 않는다.

검증 결과: 설치된 Python 3.13의 절대 경로로 `scripts/import-instructions.py --check` 실행 전·후 모두 exit 0. 최종 검사는 skill 파일 63개, component 13개, 로컬 문서 링크 91개와 역사적 provenance 보존을 확인했다. PATH의 `python` 호출은 executable 미발견으로 실패했으며 실제 검증 통과로 처리하지 않았다. 수정된 skill 5개의 설치 경로/bytes와 유지 원본이 일치하고 전역 AGENTS 정리 문단도 같은 원본과 일치하는 별도 읽기 검사는 exit 0. `git diff --check`도 exit 0. 새 경로나 component mapping 변경은 없으므로 기존 매핑을 유지했고 SKILLS-SOURCE의 변경 5개만 실제 size/SHA 및 adaptation에 반영했으며 original 기록은 보존했다.

정적 시나리오 검토(실제 모델 대화 실행 증거는 아님): 정상 동작 확인은 알린 묶음의 재검토/참조 해제/삭제로 연결되고, 문제 보고는 필요한 복구 자료 보존과 수정으로 이어진다. 유일한 복구 백업·활성 소비자는 확인 후에도 보호한다. 무응답·자동 검증 성공·무관한 요청은 확인으로 보지 않는다. 확인에 불필요한 임시자료는 대기 없이 정리한다. 설치본·원본·필수 수용 근거는 별도 owner를 유지한다. 이번 지침 편집은 별도 사용자 실행 확인이 필요한 제품 변경이 아니고 임시 파일·복제 환경·백업을 새로 생성하지 않았으므로 확인 대기 묶음은 없다.

기존 staged 변경 10개와 `docs/playbooks/build.md`의 선행 수정, 이 문서의 선행 작업 기록을 보존했다. 공유 index와 겹치는 문서에서 이번 변경만 분리하는 문제 때문에 task commit은 수행하지 않았으며 기존 stage 상태는 변경하지 않았다.

### 확인한 원인

- `scripts/artifact-run.cjs:75`와 `scripts/artifact-lifecycle.cjs:131`의 정상 종료는 producer 결과와 구성 완결을 기록하고 execution 참조를 해제한다. 실제 payload 삭제나 사용자 보존 승인 확인은 이 종료 처리에 포함되지 않는다. 따라서 실행 상태 `complete`와 정리 완료를 같은 의미로 쓰면 잔여물이 가려진다.
- `scripts/cargo-shared-cache.cjs:64`의 종료는 cache producer를 닫지만 캐시 본체를 회수하지 않는다. `scripts/clean-engine-caches.ps1:146`의 일반 열거 대상에는 `artifacts/cache/cargo`가 없다. 공통 캐시와 legacy source-local target이 모두 존재할 수 있다.
- `scripts/deployment-workspace.cjs`는 immutable 입력과 working tree를 각각 만들 수 있다. helper의 finally는 claim을 해제하며 payload 삭제는 하지 않는다. 다만 현재 `deploy-azrael.ps1`은 이 helper를 직접 사용하지 않으므로 모든 배포가 이중 복제를 한다고 일반화하지 않는다. 이전 수동 준비 작업은 실제로 여러 source generation을 만들었다.
- source-local Cargo target fallback과 물리 source 경로 교체는 반복 컴파일의 원인이 될 수 있다. 공통 target 선택은 기존 구현을 재사용할 수 있지만, 그것만으로 Cargo 내부의 오래된 생성물이 회수되는 것은 아니다.
- 현재 native inventory에는 같은 Cargo 파일을 서로 다른 과거 그룹이 소유한 기록과 이미 없는 경로의 기록이 남아 있다. cached logical bytes는 현재 물리 점유량이나 회수 가능한 바이트와 같지 않다.

### 권장 변경 — 미승인 제안

아래 항목은 남은 시스템 개선안이다. 사용자 확인/안내/삭제의 공통 지침 절차는 위 범위대로 반영했지만 runtime 강제, 공통 finalizer, 캐시 예산 기능과 레거시 이관을 구현했다고 의미하지 않는다.

2026-10-27 경로 메타데이터 조사에서 `artifacts/`의 일반 파일 4,885,155개, 논리 크기 313,913,333,893바이트를 관측했다. reparse 항목 613개는 따라가지 않았다. 일부 깊은 fixture 경로는 WinError 3으로 읽지 못했으므로 완전한 총량이나 실제 디스크 할당량으로 취급하지 않는다. 하드링크 중복·압축 영향도 있어 이 값을 회수 가능 용량으로 보고하지 않는다. 큰 경로는 `verification/AK-02-api-context-fix` 44.88GB, `tools` 18.43GB, `workspaces/c` 15.62GB, `workspaces/h` 15.26GB, `w14w` 11.08GB, `cache/cargo` 10.54GB였다. 작업별 상세 이관 가능 여부는 별도 소유·참조 검토가 필요하며, 이번 조사만으로 이동을 승인하지 않는다.

producer 기록을 실제 멤버 존재와 대조하면 complete 246개, pending 70개, retained 25개, failed 135개였다. complete는 삭제 완료가 아니다. 종료·생성·보호 메타데이터와 참조 조건을 만족하는 1차 후보는 103개였으나, 중복/중첩 구성과 외부 설치·복구 참조 및 fresh native 검토 전이므로 최종 이관 가능 개수로 쓰지 않는다.

동일 조사에서 `engine/codex-rs/target`은 일반 파일 490,664개, 논리 크기 481,591,964,690바이트였다. 그중 target-triple 하위 298.90GB, debug 182.47GB였으며 reparse와 읽기 오류는 없었다. 하드링크 중복과 압축을 제거한 물리 할당량 측정은 아니므로 서로 더해 회수 가능 용량으로 보고하지 않는다. `artifacts/` 이관만으로 이 target의 누적은 해소되지 않는다. 읽기 전용 메타데이터 조사는 전체 exit 0, 382.326초였으며 제품 빌드·테스트는 실행하지 않았다. 조사 시점 `archive/`는 빈 디렉터리였고 이전 완료 기록의 archive 경로가 사라진 주체·경위는 확인하지 않았다. 이를 이번 작업의 삭제·공간 회수 성과로 집계하지 않는다.

1. 실행 결과와 정리 결과를 분리한다. 현재 작업의 disposable 구성원은 실제 부재 또는 유효한 사용자 보존 승인에 모두 대응해야 작업 완료로 처리한다. `defer`, `complete`, 사유 문자열만으로 보존을 승인하지 않는다. 이 조건은 관련 작업 범위에 적용하고, 무관한 대화나 다른 작업을 전역 차단하지 않는다.
2. 새 생성물은 기본 task-owned disposable로 선언한다. source 복제본, 독립 Git metadata, 검증 target, exe/PDB, pending snapshot, 테스트 프로필 및 로그를 같은 수명에 포함한다. 공유 캐시·설치본·지속 근거는 사전 합의된 별도 owner와 보존 범위가 있어야 예외로 둔다.

   동일한 물리 경로를 ID만 달리해 여러 작업이 소유하지 않도록 기존 소유 root와 canonical path/generation을 등록 시 대조한다. 공유 target은 cache owner 하나가 소유하고 각 작업은 소비 참조만 가진다. 기존 파일을 새 컴파일이 교체하면 과거 작업의 오래된 내용 identity를 계속 현재 소유로 사용하지 않도록 owner가 generation과 측정 기록을 조정한다. 중첩 폐기·명시적 소유권 이관 등 이미 승인된 예외는 별도 계약을 유지한다.
3. 보존 승인에는 실제 사용자 승인 provenance, 정확한 경로/그룹과 identity, 목적, 적용 상한과 재검토 조건을 연결한다. 모델이 작성한 `approved:true`나 자유 텍스트를 사용자 허락으로 대신하지 않는다. 설치 요청에 포함된 실제 설치물의 보존은 별도 반복 승인하지 않는다.
4. 기존 owner를 연결해 정상·실패·취소 뒤 같은 종료 경로에서 자식 종료 확인 → 최소 근거 인계 → scoped 참조 해제 → 기존 검토/삭제 → 실제 부재 확인을 수행한다. 강제 종료 때는 durable 정리 대기 상태를 남기고 독립 종료 근거로 복구한다. 잠금·소유권·설치 보호는 유지한다.
5. 복제 입력은 실제 consumer가 필요한 최소 물리 generation으로 줄이고, cache 호환성·고정 입력 경계를 유지한다. 실행 중 입력은 바꾸지 않는다. consumer가 끝난 generation은 즉시 회수하며, 재현 근거를 위해 전체 복사본을 영구 보존하기보다 원본 receipt와 재구성 가능한 commit/필요 patch 등 최소 근거를 인계한다.
6. Cargo 캐시는 예외라는 이름으로 무제한 보존하지 않는다. 보존할 캐시 종류·호환 key 수·용량 상한은 사용자와 정하고, 모든 producer가 같은 선택 경계를 사용하게 한다. task-only 출력과 공통 의존성 캐시를 구분하고 실제 owner의 회수 절차로 정리한다. 보존하지 않으면 후속 컴파일 시간이 늘어나는 영향도 함께 제시한다.
7. 유지 지침과 설치 지침을 함께 정리한다. 공통 의미는 `instructions/AGENTS.snippet.md`, implementation/build-inputs 계약에 두고, 프로젝트 지침은 연결과 실제 명령만 소유한다. archive는 삭제나 공간 회수로 집계하지 않는다. 이번 누적분 이관은 별도 사용자 지시이며, 새 정식 archive API는 추가하지 않는다.

### 레거시 이관 기준

- `artifacts/` 전체를 메타데이터 기준으로 조사하고 native/producer/cache 기록과 실제 경로를 대조한다. 큰 자료의 내용을 중복 해시하는 방식으로 시작하지 않는다.
- 비활성·종료 확인·소유 및 생성 근거 확인·소비/설치/복구 참조 해소된 묶음을 archive 후보로 선정한다. 폴더명이나 날짜만으로 삭제·이동하지 않는다.
- 현재 설치본, 실제 작업 입력, upstream/pinned 원본, 관리 기록·잠금 및 불확실한 소유 경로는 일괄 이동 대상에서 제외하고 정확한 해소 조건을 표시한다. 등록 누락 경로를 임의로 새 owner에게 인수시키지 않는다.
- 이관은 기존 수명 관리·별도 archive 관리 경계와 일반 이동 절차를 재사용한다. mapping과 최소 근거를 보존하고 identity/무결성·source 부재·참조 갱신·원래 metadata 조정을 확인한다. 사용자 요청의 이번 보관은 신규 작업의 무제한 캐시 허가가 아니다.

### 구현 전 남은 판단

공유 Cargo 캐시도 무승인 기본 삭제 대상으로 둘지, 사용자 승인한 유한 캐시 예산을 예외로 둘지 정해야 한다. 원칙상 전자를 기본으로 하고, 필요한 종류와 상한을 명시 승인받은 경우에만 보존하는 방향을 권장한다. 실제 플랫폼 지원 의미는 Windows/Linux/macOS 공통이며, 현재 조사한 파일·OS 메타데이터 관측은 Windows x64이다.

## 요구와 실행 권한

사용자가 승인한 개선 1–6을 구현한다. 7번 archive 정식 지원과 삭제 처리량 최적화는 제외한다. 기존 archive와 미확정 과거 자료는 보존한다. 전체 앱 빌드·프로필 설치와 과거 생성물의 일괄 정리는 이번 범위가 아니다.

## 계약과 순서

1. 새 run은 생성 전에 고유 루트와 소유자를 예약한다. 공유 컨테이너를 재귀 소유하지 않는다.
2. 과거 custody는 명시적으로 고정한 구성만 보호한다. 미확정 자료는 보호하고 시간만으로 새 소유자를 인정하지 않는다.
3. producer ledger를 소유권 기준으로 두고 native inventory는 측정·결정의 파생 기록으로 구분한다. Node·PowerShell의 변경도 동일한 native 잠금·쓰기 경계를 통과시킨다.
4. 입력·버전·캐시 참조는 실제 대상과 범위를 지정한다. 실행·설치·복구·증거 참조의 독립 해제는 유지한다.
5. 파일 존재 sentinel을 OS handle 잠금으로 전환한다. 기존 미확정 sentinel은 명시적 복구 없이 인수하지 않는다. 물리 작업은 그룹 예약으로 보호하고 전역 catalog 트랜잭션은 짧게 한다. 모든 writer/reader가 예약을 검증하기 전에는 기존 전역 보호를 해제하지 않는다.
6. 취소 경계와 Windows worker 수명을 연결한다. 잠금 해제와 작업 성공은 구분하며 durable intent, 부분 완료, 미시도와 미확인 결과를 유지한다.

기존 Rust File 잠금, standalone 실행기, lifecycle writer, run 예약과 process helper를 우선 재사용한다. 설치 바이너리는 새 소스와 다르므로 새 기능을 검증·배치하기 전까지 지원을 주장하지 않는다. 기존 public 등록·검토·적용 및 legacy 데이터 보호를 유지한다.

## 책임·환경·검증

Root는 공유 프로토콜·설계·통합·SOURCE.json·최종 수용을 소유한다. 독립된 조사/구현만 명시적으로 위임하며 다른 작업의 변경과 index를 보존한다. 현재 공통 지원 대상 Windows x64, Linux x64, macOS ARM64 의미를 유지하며 실제 실행 검증은 가용한 Windows x64로 구분한다.

작은 문법·계약 검사 후 기존 lifecycle/run/관련 producer 및 native ownership/lock/apply 회귀를 선택한다. OS lock 경합·강제 종료·기존 marker·새 참조와 예약 경합·취소의 실제 프로세스 검증을 포함한다. 최소 3GB 여유 공간, managed Cargo·고정 입력·출처·기존 캐시 잠금 규칙을 지킨다. 무관한 제품 빌드는 실행하지 않는다.

## 생성물과 완료

새 검증 출력은 기존 DW13 상위 claim과 겹치지 않는 고유 run에 생성 전 등록한다. 작은 독립 수용 근거를 기존 작업 기록으로 인계한 뒤 임시 도구·사본·로그를 지원 정리 owner로 정리하고 실제 부재를 확인한다. 과거 archive를 정식 API로 만들지 않는다. 기능·필수 검증·문서·정리가 완료되기 전 완료로 보고하지 않는다.

## 진행

- 후속 범위는 사용자가 확인한 두 작업이다: 남은 점유 잠금 해제와 최초 등록의 전역 잠금 구간 개선. Windows x64 관리 영역의 OS 잠금 7개를 실제 byte-range 획득·해제로 확인했고 모두 비점유, bytes 불변이었다. 활성 예약 0개, `manifest.pending` 및 `.run-claim.lock` 부재를 확인했다. schema 2 영속 잠금 파일과 recovery guard는 삭제하지 않는다.
- 등록 개선의 검증 전 구현: incoming·과거 구성원과 source를 그룹별 durable 예약으로 보호하고 maintenance/catalog 잠금을 풀어 내용 측정을 수행한다. commit은 maintenance → catalog 순서로 재진입하고 CAS 병합·설정·객체 identity·producer fence를 재검증한다. 이전·새 producer source를 모두 묶어 기존 source 변경 기능을 보존한다. 정상 취소·검증 실패는 미저장 상태와 자체 예약만 해제하고, source 변경·commit 실패 등 불확실성은 명시적 복구 대상으로 남긴다. `refresh_group`은 payload를 측정하지 않는 기존 짧은 경로를 유지한다.
- 이 후속 검증은 `run:registration-lock:20261027:a`, owner `DW-16-registration-lock`, `artifacts/tasks/registration-lock-20261027/run-a`로 출력 생성 전에 선언했다. 구현 owner는 root의 registration/lib/registry/groups와 독립 worker의 reservations/storage이며, Windows 실검증 전에는 완료·설치를 주장하지 않는다. 추가한 등록 concurrency·source 변경·취소 테스트는 서로 다른 반복 위험을 검출하므로 유지한다. 기존 앱 전체 빌드와 다른 OS 실행은 이번 범위가 아니다.
- 이전 archive source가 현재 존재하지 않아 최종 v6의 보존된 SOURCE 영수증과 기록된 Git commit `6b9487a444f89338294f0cdba4ec558451e2b06e`으로 고정 입력을 준비한다. 전체 9,328개 source 항목을 비교해 이번 수정 외 32개 차이를 확인했고, 32개 모두 기록 commit의 bytes가 v6 SHA와 정확히 일치한다. 이 고정 사본만 복원하며 primary의 동시 변경·SOURCE·index는 바꾸지 않는다. 첫 준비는 일반 파일로 materialize된 기존 `git-symlink-placeholder`를 아직 지원하지 않아 컴파일 전에 실패했다. 실패 사본은 유지한 채 해당 Git 모드를 보존하는 별도 `source-v2` 입력 identity로 재시도한다.

- 남은 잠금 개선: 구현과 원래 bounded native assignment는 apply의 물리 삭제 중 전역 잠금 해제에 한정되었다. 최초·변경 등록은 `lib.rs`의 명시적 분기대로 측정부터 commit까지 catalog/manifest 잠금을 유지한다. 상위 목표 문구가 이를 구별하지 못했으므로 실제 구현과 남은 전환 목표를 문서에 분리했다. 사용자가 등록 잠금 유지를 별도로 승인했다고 해석하지 않는다. 미등록 incoming 범위의 예약·commit CAS/참조 재검증 없이 이 잠금을 해제하면 소유권 경합이 발생하므로 현재 보호는 유지한다. 등록도 비차단이라고 주장하지 않는다.

- 최종 v6은 maintenance 패키지의 실제 동작 검사 152개와 release 컴파일을 통과했다. release는 23.616초, 최종 고정 입력의 core는 338.912초, prompts는 22.719초이며 모두 실제 exit 0이다. 앞선 v5의 다른 입력/경로·캐시 상태와 조건이 같지 않으므로 이 수치 차이를 최적화 비율로 주장하지 않는다. Windows 실제 terminal/recovered-control 모듈 검사, Node 잠금 및 lifecycle/build-platform 회귀도 exit 0과 입력 불변을 확인했다.
- 설치 실행파일: `artifacts/versions/maintenance-owner-2392b335-win-x64-dw16-v6/payload/maintenance_owner.exe`, SHA `2392b335138bcc586be8cec825d9cf641c5960d0d0518dba8962a70aaa6df2a3`. 최종 SOURCE 영수증 SHA `d7da42d697ef7cc24de5ed938d4fb034e96471c81c7550e5eb4c02016455ec16`. 기본 resolver의 identity와 실제 OS lease smoke를 확인했다. 첫 설치 시도는 공통 deployments 부모 부재로 exit 1이었고, 정확한 사전 선언 상태를 확인해 해당 설치만 재개했다. 이전 v5 후보는 삭제·실제 부재·finalize를 확인했다.
- 설치의 최소 수용·실패 시도 요약은 최종 version의 `verification/`에 승격했다. 이번 run의 root producer는 실제 controller 결과와 종료 근거로 close했다. native 등록·fresh review 후 삭제를 실행했으나 사용자의 archive 전환 요청으로 중단했다. 정확한 native 및 하위 worker handle의 종료를 확인하고, 원본 정수 값을 보존한 요청으로 예약을 명시적으로 복구했다. 삭제 결과와 pending intent는 성공으로 바꾸지 않았다. 공유 warm Cargo cache와 다른 작업의 생성물은 이번 정리 대상이 아니다. 앱 내장 엔진은 교체하지 않았으며 Linux/macOS 실행은 미검증이다.
- 2026-10-27 07:42:52.848Z–07:43:01.138Z: 남은 `artifacts/tasks/ownership-20261027/run-a`를 사용자 지시에 따라 `archive/DW-16-ownership-20261027-interrupted-cleanup`으로 같은 볼륨에서 이동했다. 파일 60,263개, 디렉터리 8,407개, 1,037,289,564바이트이며 파일·볼륨 식별자, 크기, 수정시각, 모드 및 링크 대상의 이동 전후 inventory digest가 일치하고 원본 경로가 없음을 확인했다. 의도적인 테스트 junction 한 개는 원래 절대 대상 값을 그대로 보존하므로 archive는 실행용 fixture가 아니다. 소유자는 DW-16-ownership이며, 사용자의 archive 정리 요청 또는 일반 삭제 재검토 시 해제 여부를 검토한다. 독립 근거는 설치 version의 `verification/root-archive-result.json`, 원본 lifecycle finalize는 `root-archive-source-finalized.json`에 있다. archive는 삭제 완료로 보고하지 않는다. 등록은 697.174초였고, 중단된 삭제 실행은 07:24:47.285Z–07:40:07.421Z, 실제 native exit 4294967295이다.
- primary에는 다른 작업의 기존 stage와 같은 파일의 변경이 섞여 있어 작업 단위 커밋을 안전하게 분리하지 못했다. 기존 index를 보존했다. primary `SOURCE.json`에 무관한 동시 engine 변경을 채택하거나 고정 v6 영수증을 덮어쓰지 않았으며, 전체 primary 출처 수용은 해당 변경의 별도 정리가 필요하다. 이번 native 수용은 기록한 고정 입력에 한정한다.

- Windows 복구 통합 검사의 실제 원인은 종료 exit 0인 native 자식의 프로세스 객체가 외부 handle 때문에 계속 조회되는 경우였다. 두 단계 독립 실행에서도 재현했다. `WaitForSingleObject(0)`로 종료 신호를 확인하도록 Windows PID 거부 조건만 수정하며, 독립 종료 근거·raw SHA·fence·잠금 경계를 유지한다. retained-handle 회귀는 이 반복 결함을 검출하기 위해 유지한다. 수정한 고정 v6 입력으로 native 및 core/prompts 수용을 다시 수행한다.
- v5 core는 실제 exit 0, 06:15:37.852Z–06:37:44.497Z (22분 6.645초), prompts는 실제 exit 0, 06:37:44.550Z–06:40:14.950Z (2분 30.401초)였다. 두 consumer가 종료한 뒤 이전 고정 입력을 보존하고 같은 compiler 경로에 새 물리 generation을 준비해 경로 변경에 따른 중복 컴파일을 줄인다. primary의 동시 변경을 새 입력에 포함하지 않는다. 여유 공간 3GB 중단 조건을 유지한다.

- 2026-10-27: 기존 shared catalog sentinel이 물리 삭제 전체를 보호함을 확인했다. 모든 producer의 그룹 예약 참여가 전역 잠금 축소의 선행 조건이다. 새 source 변경이나 검증 출력은 아직 생성하지 않았다.
- 구현 연결: 기존 `File::try_lock`과 standalone 실행기를 확장하고 Node Worker/stdio로 동기 caller를 연결했다. 새로운 상주 daemon이나 파일 handshake는 두지 않는다. 기본 실행기는 SHA가 고정된 설치 영수증으로 선택하고 검증 중에는 명시한 고정 바이너리를 사용한다.
- 검증 run: `artifacts/tasks/ownership-20261027/run-a`, lifecycle `run:ownership:20261027:a`, owner `DW-16-ownership`. 새 native writer를 컴파일하기 전 bootstrap 예약은 기존 HEAD의 검증된 producer 구현을 메모리에서 읽어 수행했다. 새 source를 예전 설치 바이너리가 지원한다고 간주하지 않았다.
- 첫 native source recorder는 실제 exit 0, 05:19:16Z–05:23:11Z (235.0초), 정확한 12개 source delta만 반영했다. receipt SHA `79501b63dcd50d4a6b00f269bcb25e449621701a7091893c45525d8193ef8a6c`. 설치 PowerShell은 바꾸지 않고 공식 portable 7.4.13을 run 안에 준비해 SHA를 검증하고 실제 version 실행 exit 0을 확인했다. 최종 기능 수용은 아직 아니다.
- 첫 release 컴파일은 실제 exit 0, 37.4초였다. 실제 프로세스의 OS 잠금 경합·종료·CAS와 기본 실행기 identity 검사, run/workspace writer, 패키징, render/check/instruction writer 회귀가 통과했다. 공통 변경의 실행 증거는 Windows x64에 한정한다.
- 회귀 수정: native worker의 시작 신호 뒤 인코딩 재설정이 buffered 입력을 버리는 결함을 수정했다. PowerShell 연동에서는 Rust의 JSON 직렬화 기반 예약 파일 해시와 Node의 문자열 해시가 달라지는 경계 결함을 확인했다. 고정 v3 입력의 native 재검증과 실제 예약 observer 회귀가 완료되기 전 설치·기능 수용을 선언하지 않는다. 이전 실패 영수증은 run의 reports/logs에 보존하고 성공으로 덮어쓰지 않는다.
- fixture 전환: 기존 JS fs.renameSync mock은 native CAS commit을 통과하지 않으므로 실제 native writeRecord 경계로 실패 주입을 옮겼다. management transport mock은 fake engine/bridge만 대체하고 native 잠금 subprocess는 실제 실행한다. 기존 보호·실패·부분 완료 assertion은 유지한다.
- 전송 경계: 새 프로토콜의 임의 1 MiB 한도가 기존 16 MiB producer 레코드를 좁히는 문제를 확인했다. 개별 레코드는 기존 16 MiB를 유지하고 새 프레임·durable 예약은 64 MiB로 제한한다. 중복된 source owner/구성원을 포함한 응답을 catalog 안에서 사전 측정해 한도 초과는 예약 생성 전에 거절한다. 다중 GB JSON이나 자동 chunking은 도입하지 않는다.
- 후속 수용: Node lifecycle/build-platform 통합, Windows legacy release 정리와 verification 정리의 재검증이 실제 exit 0으로 완료됐다. 원본 ledger와 정규화된 참조 객체의 비교 차이는 `{id,revision}`으로 native 원본을 고정하도록 해결했다. 삭제 시작 전 거절은 `blocked`, 물리 삭제 이후 실패는 `partial`로 구분한다.
- 배포 계정 성공 경로는 검증 자체가 완료된 뒤 기존 45초 watchdog이 정리 중 종료시킨 사례를 확인했다. 계정 사례만 90초로 조정한 재검증은 실제 exit 0, 33.791초였다. 시간 초과한 이전 실행은 실패로 보존하며 정리 전 실제 종료 근거를 별도로 확인한다.
- 입력 격리: 현재 checkout에서 다른 작업의 engine 변경 32개가 관찰되어 primary `SOURCE.json`에 합치지 않았다. 기존 고정 snapshot과 별도 Git metadata를 재사용해 이 작업의 정확한 delta만 공식 recorder로 기록했다. v5는 v4 대비 `tests/registry.rs` 기대 결과만 달라 생산 코드가 같은 일곱 통과 suite의 근거를 재사용하고 나머지 suite를 실행한다.
- 최종 native: v4/v5의 동등한 생산 입력으로 151개 동작 검사가 통과했다. v5 release 컴파일 실제 exit 0, 18.867초. source receipt `9f99d82ea305b1db4e901d1f0193de707bfaa19bba25d12030aaa7f74e455b73`, 실행파일 SHA `e6eeee2107eacd5a98ec275e18823e9ed7bfbeb5f6c2b6d4a1fc3b4317633cca`. 현재 후보 version은 pending이며 기본 선택은 아직 전환하지 않았다.
- 실물 정리 수용: primary catalog의 예약 준비가 기존 10초 요청 한도를 넘는 결함을 최초 오류 보존으로 확인했다. OS 획득 대기는 그대로 두고 예약·완료 통신만 60초/75초로 조정했다. 이전 helper의 실제 종료와 OS 배타성 해제, 활성 fence 부재를 독립 확인한 뒤 새 시도를 수행했다. 두 배포 run과 짧은 TMP 4개 경로의 삭제·부재·ledger finalize를 확인했다. 이전 실패·미확인 시도를 성공으로 변경하지 않았다.

- 등록 잠금 후속 검증: 첫 고정 입력은 library 실제 155개 exit 0(315.502초), release exit 0(28.052초), Node OS 잠금/CAS/crash 검사 exit 0이었다. core 준비 중 3GiB 용량 guard가 정확한 owned Cargo와 하위 compiler를 중단했고 handle 종료 및 exit 1을 확인했다. 실패 영수증을 보존하며 통과로 간주하지 않는다. commit에서 이전 custom source catalog가 누락될 수 있는 경계를 수정하고 양쪽 catalog 점유를 관측하는 회귀 검사를 추가했다. 최종 고정 SOURCE SHA는 4412f2f69f6669a8193ff7a56caad8d760bdb31368b64a116476fbc35c43cb23이다.
- 용량 회복은 공유 캐시 삭제 대신 기존 NTFS 압축을 사용했다. Cargo target owner를 확보하고 hardlink가 없는 generated PDB 5개만 압축했으며 모든 내용 SHA·파일 identity·크기를 전후 검증했다. 실제 exit 0, 여유 공간 관측 증가 1,825,849,344바이트(3,226,832,896 → 5,052,682,240). 첫 후보의 hardlink 감지로 압축 전 중단한 exit 1도 보존한다. 이전 source 소비자가 모두 종료한 뒤 두 물리 source generation을 rename하여 동일 compiler 경로를 재사용했다. 최종 입력의 내용은 바꾸지 않았고 source-before/after 전체 검증과 3GiB 실시간 guard를 적용해 재검증 중이다. 아직 기본 실행기는 v6이다.

- 최종 등록 검증은 2026-10-27 08:50:41.603Z–09:11:00.603Z 실제 exit 0이다. library 156개(305.287초), release(22.213초), Node OS 잠금(3.122초), core 8개(700.262초), prompts 1개(97.784초), 전체 입력 전후 검증을 통과했다. 성공 실행의 용량 최솟값은 3,317,153,792바이트이며 capacity stop은 없었다. 최종 실행파일 SHA는 951f20695b17dd8d9206d3fd12997e017294003f0d5ccaeff3a488734b868c36이다. 입력·환경·캐시가 다른 이전 시도와 속도 향상 비율로 비교하지 않는다. Windows x64 실제 검증이며 앱 내장 엔진 및 Linux/macOS 실행 수용을 뜻하지 않는다.

- 최종 별도 실행기 설치: artifacts/versions/maintenance-owner-951f2069-win-x64-dw16-registration/payload/maintenance_owner.exe. 기본 resolver·실제 native lease smoke exit 0과 실행파일 SHA를 확인했고 정확한 이전 설치 참조를 해제했다. Node·PowerShell 기본 관리 경로에 적용되며 앱 내장 엔진 교체는 아니다. 주 관리 잠금 7개의 OS 비점유와 bytes 불변, 활성 예약 0개·pending manifest 부재를 확인했다. 진단 잠금 파일은 삭제하지 않았다.
- 사용자 요청에 따라 이번 임시 묶음은 archive/registration-lock-20261027-completed/artifacts/payload/run-a 로 이관했다. 일반 동일 볼륨 rename 후 파일 27,510개·305,659,745바이트의 dev/ino·크기·mtime·mode·링크 대상 inventory가 같고 원래 경로가 없음을 확인했다. 이전 v6도 같은 archive의 artifacts/payload/maintenance-owner-v6 로 이관했다. 별도 archive 관리 프로젝트에서 두 그룹을 완전 등록·fresh review·명시적 defer했고, 원래 두 producer ledger를 finalize했다. 재검토 조건은 사용자의 archive 정리 요청 시 현재 소유·참조·보호를 확인한 뒤 ordinary 삭제를 검토하는 것이다. 이는 삭제 완료가 아니라 보관 이관이다. task의 빈 상위 폴더도 ordinary rmdir와 실제 부재 확인으로 정리했다. 필요한 설치·검증·실패 시도·이관 근거는 설치 version의 verification/ 에 독립 보존했다.
- 현재 index에 다른 작업 파일들과 이번 변경과 겹치는 reservations.rs의 기존 staged 내용이 남아 있어 작업 단위 커밋을 안전하게 분리하지 못했다. 기존 index를 보존했으며 커밋 미수행이다. primary 전체 SOURCE.json은 무관한 동시 변경을 채택하지 않았고, 별도 고정 입력에 한정한 검증·설치이다.
