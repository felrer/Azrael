상태: 외부 수정 반영 여부 조사와 후속 실행 계획·playbook 개선안 작성을 완료했다. 전체 호환 정리는 아직 미완료다. 아래 이전·삭제·기능 수정과 playbook 개선 적용은 실행 제안 상태이며, 이번 요청에서는 조사와 계획 문서만 작성했다.

# 전체 생성물 관리 호환성 재점검과 남은 이전 계획

## 목적과 현재 권한

2026-10-19(KST) 현재 외부 작업이 BI-01 이후 남은 정리를 끝냈는지 확인하고, 미완료 범위에 대해 기존 정리 playbook에 따른 실행 순서와 시행착오를 반영한 개선안을 제시한다. 이전 [구현·정리 기록](01-plan.md), [삭제 후보 판단](02-cleanup-candidates.md), [시험 이전](03-layout-migration.md)의 성공 범위와 한계를 재사용한다.

사용자의 현재 요청은 상태 확인과 미완료일 때의 계획·개선안 제시다. 조사, 문서 작성과 작업별 로컬 커밋까지 수행한다. 이전 세션의 승인된 정리·보호 원칙은 유지하되, 이번 문서에 제안한 미전환 writer 수정·대규모 이전·삭제를 계획 제시 요청만으로 실행하지 않는다. 앱 빌드·설치·원격 실행·push는 포함하지 않는다. 새 사용자 질문 없이 현재 조사와 계획을 완료할 수 있다.

공통 의미는 Windows x64·glibc Linux x64·macOS ARM64에 적용한다. 이번 조사는 Windows x64 로컬의 소스·등록 기록·제한된 파일 배치 확인이다. 다른 OS의 실행 수용이나 새 제품 패키지 검증은 포함하지 않는다. 지원 범위는 [multi-platform 계약](../../docs/architecture/multi-platform.md)이 소유한다.

## 완료 판단 기준

관리 호환성은 모든 파일을 새 폴더로 옮기는 것과 같지 않다. 기존 경로도 한 소유자, 생성 전 등록, 실제 종료 결과, 구성 완결성, 소비·복구 참조, 검토·정리 경계가 확인되면 동등하게 인정한다. 소스·사용자 상태·지속 도구 입력은 생성물로 재분류하지 않는다.

전체 정리 완료를 선언하려면 다음 항목을 각각 확인해야 한다.

1. 선언한 모든 조사 루트와 제외 범위를 빠짐없이 분류한다. 접근 불가·링크·혼합 자료와 미확정 경로를 숨기지 않는다.
2. 생성물은 work/run·version·shared 중 한 소유 묶음에 속하고, 교차 사용은 실제 소비 참조로 연결된다. producer 기록, native 등록, 개별 cache owner 기록의 역할을 구분한다.
3. 모든 대상 writer가 출력 전에 소유와 경로를 기록하고, 성공·실패·중단 후 실제 경로와 종료 상태를 조정한다. 모든 reader의 전환·보존 관계가 확인된다.
4. 보존할 자료는 검증된 경로와 읽을 수 있는 근거를 가지며, 삭제 대상으로 결정한 모든 구성원은 실제 부재와 metadata 종료까지 확인한다.
5. 알려진 미완료·보류·부분 실패를 현재 보고서에 남긴다. 정당한 소스·현재 설치·복구·활성 공유 데이터는 보존된 채로 완료할 수 있으나, 미확정 생성물을 누락한 상태를 전체 완료라 부르지 않는다.

## 현재 조사 결과

### 외부 후속 작업으로 바뀐 범위

조사 기준 HEAD는 `a775e093`이며 BI-01 완료 커밋 `dd41f7f6` 이후의 관련 history와 현재 working tree를 함께 확인했다. 목록·배치 대조는 2026-10-19 02:36~02:37 KST에 관측했다. 저장소에는 다른 작업의 미커밋 변경이 있으므로 이 조사는 고정 입력 빌드나 원자적 전수 snapshot이 아니다.

| 대상 | 현재 확인한 사실 | 판정 한계 |
| --- | --- | --- |
| 내장 관리 도구 | 실제 `project_inventory list` 호출이 성공했다. 22개 bundle, 245개 항목, 103개 묶음을 pagination 전체로 조회했다. | 이전의 “설치본 도구 가용성 미확인”은 이번 세션의 목록 조회 범위에서 해소됐다. 실행·복구·삭제 전체의 수용 검증은 아니다. |
| 후속 캐시·로그 통합 | `37923232`에서 모듈별 recipe/key, key 내부 raw logs, 버전→companion cache 소비 참조와 coordinated cleanup을 보강했다. | provider 독립 복사 payload에 영구 cache 참조가 없는 것은 현재 설계다. 이를 미전환 갭으로 세지 않는다. |
| 주요 생성기 | build-platform, build-azrael, package-platform-release, deploy의 생성 전 pending과 종료 처리, 배포 검증 근거 승격이 소스에 연결돼 있다. | 한정된 생성기 조사이며 모든 scripts의 호환성을 증명하지 않는다. |
| 등록·이전 정책 | `producer_registry_v1`은 관련 소유·들어오는 소비 참조를 검사하고, Windows 내용 cache는 USN도 버전 판단에 사용하도록 보강됐다. | 정책·소스 변경과 실제 전체 파일 이전은 별개다. |
| 기존 정리 | BI-01의 9버전40경로 삭제와 후속 BS의 cache 정리 근거가 남아 있다. | BS 기록에는 원본과 hardlink된 읽기전용 Git 잔여11곳의 미완료가 명시되어 있고, 현재도 그 이름의 디렉터리들이 있다. 이전 성공을 전체 완료로 확대하지 않는다. |

근거: [관리 설계](../../docs/architecture/project-maintenance.md), [관리 운영](../../docs/ops/project-maintenance.md), `scripts/artifact-lifecycle.cjs:115`, `scripts/package-platform-release.cjs:83`, [BS 관리·정리 기록](../BS-01-windows-build-install/01-plan.md).

### 등록 기록과 실제 배치의 차이

현재 native 목록은 cached logical state다. 245항목 중 deleted151·deferred82·상태 미기록12이며, cached remaining=true94·false151이다. 이 수치를 현재 파일의 전수 존재나 삭제 가능 개수로 해석하지 않는다.

Node producer registry에는 194기록·920구성원이 있다. state는 complete132·pending26·retained26·failed10, membership_complete=false20이다. pending·failed 이름만으로 producer가 아직 실행 중이라고 단정하거나, 반대로 종료됐다고 처리하지 않는다. 구성원이 모두 ENOENT로 확인된 producer 기록도 5개 있어 종료·참조 조정 여부를 후속 검토할 필요가 있다.

다음은 `artifacts/` 바로 아래와 그 한 단계 자식의 이름만 읽어 producer 경로와 대조한 결과다. 전체 하위 파일의 내용·속성·용량 조사는 아니다.

| 루트 | 직접 자식 디렉터리 | 직접 파일 | producer 경로와 겹치는 자식 디렉터리 |
| --- | ---: | ---: | ---: |
| `artifacts/logs` | 705 | 139 | 15 |
| `artifacts/verification` | 108 | 4 | 9 |
| `artifacts/tasks` | 27 | 0 | 20 |
| `artifacts/build` | 13 | 0 | 13 |
| `artifacts/cache` | 4 | 0 | 4 |
| `artifacts/versions` | 2 | 0 | 2 |

“겹침”은 후속 분류의 힌트다. 묶음 완결성이나 호환률을 뜻하지 않으며, Node 목록에 없다는 이유만으로 미관리·삭제 대상으로 분류하지 않는다. 실제로 `artifacts/tasks/refusal-cause`는 Node 대조에 잡히지 않았지만 native에서 run별 logs/reports10항목을 deferred로 관리하고 있었다. cache owner와 중첩 프로젝트의 관리 기록도 함께 대조해야 한다. 프로젝트 별칭 목록이 비어 있어도 명시한 project_root로 현재 관리 도구를 사용할 수 있다.

현재 `managed_roots`는 tasks/versions/shared뿐 아니라 logs/verification/build/deployments/cache/releases/app-releases/vsix와 `engine/codex-rs/target`을 포함한다. 이는 허용 가능한 경계이며 모든 하위 파일의 소유·삭제 승인을 뜻하지 않는다. artifacts 안에도 도구·고정 upstream 입력·미분류 자료와 중첩 checkout이 있으므로 전체 부모를 생성물로 취급하지 않는다.

### 확인된 미완료 경계

- `package-platform-release.cjs:83`의 단독 포장 경로는 입력 release에 대응하는 version 소유자가 없으면 `release:<path>`를 소비 참조 ID로 기록한다. 그 ID의 소유 기록은 생성하지 않는다. 이 fallback 참조만으로 실제 입력을 보호한다고 주장할 수 없다.
- 공통 runner는 기본 출력에서 lifecycle을 연결하지만, 명시적 legacy 출력 경로는 호출자가 같은 소유·종료 계약을 제공해야 한다. 별도 writer의 남은 갭은 아래 우선순위와 함께 추가한다.
- 과거 로그·verification·작업 자료, hardlink Git 잔여, 빈 producer record에 대해 전체 소유·reader·보존 조건 정합성이 아직 입증되지 않았다. 전환된 일부 writer와 정리 성공만으로 이 범위를 완료 처리하지 않는다.

다음은 현재 코드에서 실제 출력을 쓰지만 lifecycle 연결을 확인하지 못한 대표 writer다. 별도 상위 호출자가 귀속을 보장하는지까지 확인한 뒤 수정 범위를 확정한다. 아래6개를 전체 미전환 writer 목록으로 간주하지 않는다.

| 우선 조사·수정할 writer | 실제 출력과 현재 소비 근거 | 다음 인계 |
| --- | --- | --- |
| `scripts/check-auto-review-engine.mjs:15` | fixture·프로필·로그·요약을 쓰며 운영 문서가 검토 경로를 안내한다. | renderer와 함께 같은 작업/run 소유 및 필요한 보존 근거를 연결한다. |
| `scripts/verify-auto-review-render.mjs:9` | fixture·프로필·스크린샷을 쓰며 `docs/ops/development.md:380`에서 안내한다. | browser 종료 확인, fixture와 결과의 같은 수명, 생성 전 소유와 실제 결과를 연결한다. |
| `scripts/verify-ticket-usage-render.mjs:11` | fixture 정리 뒤에도 렌더 결과·로그가 남고 운영 문서에서 소비한다. | 필요한 acceptance 근거와 raw fixture의 소유/보존 관계를 구분한다. |
| `scripts/check-auto-account-switch.mjs:12` | fixture·보고서/요청 증거를 생성하고 운영 문서에 결과 경로가 있다. | 기존 합성 fixture와 실제 계정 상태 경계를 보존하며 등록과 정리를 연결한다. |
| `scripts/check-account-retirement.mjs:18` | fixture·보고서/요청 근거를 쓴다. 직접 소비자는 이번 조사에서 확인하지 못했다. | 소비·진단 필요와 테스트 상태를 먼저 확인하고 출력 전체를 연결한다. |
| `scripts/check-custom-api-helper.mjs:10` | fixture·로그·검사 결과를 쓴다. 직접 소비자는 이번 조사에서 확인하지 못했다. | owner와 결과 reader를 확인하고 성공·실패 경로를 연결한다. |

반면 기본 `test-project.cjs:437`, `check-artifact-lifecycle.cjs:30`, AO renderer의 생성 전 등록·종료 조정은 소스로 확인했다. `check-project-maintenance.cjs` 자체는 결과 파일을 쓰지 않고 기존 Cargo verification/target owner를 사용하므로 새 결과 writer를 중복 추가할 대상이 아니다. 공통 runner의 명시적 legacy 출력은 호출자 전체를 조사한 뒤 정상적으로 소유를 전달하는 경로를 보존한다.

## 권장 실행 계획

기준 절차는 [Artifact lifecycle and migration](../../docs/playbooks/artifact-lifecycle.md)의 Existing-Project Migration 1–7이다. [Build](../../docs/playbooks/build.md)와 [Work](../../docs/playbooks/work.md)의 입력·설치/복구·일반 삭제·커밋 경계를 함께 적용한다. 별도 관리 서비스나 새로운 전용 실행파일을 만들지 않고 기존 Node/PowerShell producer와 native 도구, cache owner를 재사용한다.

| 단계 | 바로 필요한 입력·담당 | 수행과 산출물 | 다음 단계 조건 |
| --- | --- | --- | --- |
| 1. 조사 경계와 실제 소유 통합 | root: 기존 AT/BI/BS 조사, 현재 Node/native/cache 기록 | 전체 대상 루트·제외·링크·중첩 관리 루트·접근 오류를 정하고, 기존 metadata에 변경분만 보강한다. 현재/직전 설치·실행·shortcut·lease와 복구 참조를 실행 시점에 확인한다. | 이름별 전체 분류 목록과 미확정 목록이 있고 누락이 드러나야 한다. 전체 내용을 다시 해시하지 않는다. |
| 2. 소유·경로·reader mapping | root: 1의 경로 목록, 생성 코드·소비자 | current/target 경로, 한 소유자, command/input identity, 생성 전/종료 기록, reader·공유/복구 참조, 이전 상태와 보류 조건을 연결한다. 다중 소유·dangling 참조·빈 기록을 분리한다. | 소유가 확인된 묶음별 dry-run이 가능해야 한다. 미확정 경로는 보호하고 다음 발견 조건을 기록한다. |
| 3. 미래 writer의 누적 차단 | 독립된 writer별 담당: 확정된 소유/참조 계약 | 먼저 미등록 단독 writer와 legacy 호출자를 기존 lifecycle API에 연결한다. packaging 입력의 실제 소유자 연결을 보완한다. output은 기존 경로도 허용하되 생성 전 귀속과 실패 시 상태를 갖추게 한다. | 작은 성공·실패·취소/중단·경로 충돌 검증을 통과한다. 현재 실행 중인 legacy input/output/cache는 고정한다. |
| 4. 작은 비활성 묶음 시험 이전 | root 통합: reader가 알려진 종료 묶음 1개 | 필요할 때만 미사용 목적지로 복사하고 내용 identity·구성·권한을 대조한다. reader 참조를 전환하고 실제 소비 동작을 확인한다. 기존 경로와 복구 mapping을 유지한다. | 원래 reader의 필수 검사가 통과하고 원래 입력으로 복구할 수 있어야 한다. |
| 5. 검토·삭제·metadata 종료 | root 모델 결정: 종료된 소유 묶음, 새 검토 결과 | native로 exact group을 등록/검토하고 전체 live 구성원의 같은 fate를 선택한다. 독립된 묶음은 준비되는 대로 진행하며 동일 store의 변경은 직렬 처리한다. payload→logs/evidence 순서로 일반 삭제하고 실제 부재 후 finalize한다. cache는 기존 owner·lease·마지막 소비자 기준을 쓴다. | actual exit와 각 삭제 결과, 실제 잔여와 참조 해제가 확인돼야 한다. 이미 삭제한 항목은 재등록·재해시하지 않는다. |
| 6. 범위별 확대와 인수 | root: 시험 이전·writer 검증 결과 | 검증된 계약을 같은 성격의 묶음에 적용한다. 정리 결과에 따라 mapping과 보호·보류 목록을 갱신한다. 전체 루트 분류의 누락과 남은 legacy writer를 다시 대조한다. | 아래 인수 기준을 전부 충족해야 전체 완료로 보고한다. |
| 7. playbook 개선과 closeout | root: 각 단계의 실제 실패/재시도·성과 | 아래 개선안을 실제 결과와 대조해 채택·수정·기각한다. 프로젝트 소유 문서에 반영하고, 공통 지침 적용이 별도로 승인되면 유지 원본·활성 사본과 검사를 함께 갱신한다. | 개선의 원인·적용한 규칙·검증·남은 한계를 기록하고, 임시 로그/스크립트는 필요한 근거 승격 후 함께 정리한다. |

단계1·2의 독립 조사와 단계3의 계약이 확정된 writer 수정은 병행할 수 있다. 작은 시험 이전은 해당 mapping만 준비되면 시작한다. 전체 목록의 조사를 기다린다는 이유로 준비된 독립 수정과 검증을 미루지 않는다. 변경 소유권을 파일별로 분리하며 같은 Cargo target이나 동일 native store에 무거운 변경 실행을 중복 시작하지 않는다.

실행·생성 전에 후속 작업의 run 소유와 예상 로그/보고서/fixture 경로를 기록한다. 종료 결과가 없는 producer를 중복 실행하지 않는다. 장기 삭제는 첫 확인 시점과 완료 signal을 정하며 예상 시간을 종료 보장으로 쓰지 않는다.

### 계획에서 제시할 선택과 영향

- **경로 유지와 실제 이전:** 권장안은 기존 경로를 먼저 같은 소유·참조 계약에 연결하고, 독립성과 reader 이득이 있는 경로만 옮기는 것이다. 전면 물리 재배치는 대형 snapshot 재복사·재검증 비용이 크며 원래 독립 입력을 깨뜨릴 수 있다. 요청한 호환성 완료는 동등한 기존 경로를 인정하는 방식으로 진행한다.
- **미등록 package 입력:** 권장안은 확인된 기존 입력 소유자가 있으면 연결하고, 확인된 생성 입력이면 명시적 imported-input 소유/참조로 연결하는 것이다. 출처나 보호를 확인할 수 없으면 명시적으로 미해결 상태를 반환한다. 무조건 legacy 포장을 거절하는 변경은 현재 허용 동작을 바꾸므로 결정 없이 구현하지 않는다.
- **보류 해제:** 과거 실패·최종 exit 부재·오래된 날짜 자체를 영구 보류 근거로 삼지 않는다. 진단·재실행·인계·현재/복구·실제 소비 조건이 끝난 확인된 생성 묶음은 기존 권한 안에서 바로 검토·정리한다. 반대로 미확정 소유와 hardlink 원본의 속성을 편의를 위해 변경하지 않는다.

## 시행착오에 근거한 playbook 개선안

다음은 제안이며 playbook 본문에 아직 적용하지 않았다. 새 실행에서 확인한 결과도 같은 표에 반영하고, 이미 있는 일반 규칙을 복제하지 않고 해당 절을 구체화한다.

| 시행착오·관측 | 제안할 절과 개선 | 적용 후 확인 |
| --- | --- | --- |
| 일부 구현·40경로 삭제 성공을 전체 정리 완료로 오해할 수 있었다. | Acceptance에 정책 도입·실제 도구 가용성·writer/reader 채택·선언 루트 분류·실제 정리의 완료 조건을 분리하고, 완료 문장에 대상·제외·미확정을 붙인다. | 미확정 루트·writer가 있는 보고서는 전체 완료로 표시하지 않는다. |
| Node 목록 밖의 refusal-cause 자료는 native에서 이미 관리하고 있었다. 겹치는 경로 하나로 전체 귀속을 증명할 수도 없다. | Inventory/mapping에 producer/native/cache owner/중첩 관리 루트의 대조와 한 소유자 판정을 넣는다. 별칭·생성 전 기록·native 등록·실제 정리를 별개 상태로 표기한다. | native-only 항목과 동등한 기존 경로를 불필요하게 재등록·복사하지 않으며, 미등록이라는 이유만으로 삭제하지 않는다. |
| BI 대형 비교 apply8.11→3.70초였지만 작은 파일은 개선이 없었고, 실제 남은16경로 apply는 약63분이었다. | Dry-run에 선택 범위의 파일 수·논리 크기·검토/적용 실제 시간을 넣고, 대표 묶음의 실제 비용으로 확대 순서를 정한다. 빠른 metadata 분류와 exact-group 내용 검토를 분리하고 반복 전체 해시를 피한다. | 보호·권한·변경 검사를 유지한 상태에서 전체 경과 시간과 재작업 감소를 측정한다. 작은 실험 단축률을 전체 작업 성과로 쓰지 않는다. |
| 최적화 전환 때 기존24개 삭제 상태를 보존해 남은16개만 재개했다. | Recovery에 durable 결과·실제 잔여·pending 상태를 먼저 조정하고, 소유 producer와 삭제 child 종료 확인 후 필요한 범위만 복구하는 절차를 추가한다. | 삭제 완료 항목의 재작업과 타 작업 잠금 삭제를 막고 unknown 결과를 성공으로 바꾸지 않는다. |
| UI 생성물의 ReadOnly 처리로 일반 삭제가 가능했지만 BS Git 잔여11곳은 원본 hardlink와 속성을 공유했다. | Links/mixed 보호에 hardlink도 포함하고, 생성물의 ReadOnly/Hidden 정상화 전에 원본과 metadata를 공유하는지 확인하도록 한다. 공유 원본에 영향이 있으면 해당 경로를 보류하고 별도 해법을 검토한다. | 원본 Git 파일의 속성·내용·ACL은 유지한다. 일반 삭제 실패를 강제 옵션이나 다른 API로 우회하지 않는다. |
| 삭제·finalize 뒤 임시 collector가 실패해 command exit와 실제 삭제 결과가 어긋난 사례가 있었다. 구성원이 없는 producer 기록5개도 관측했다. | Closeout에 명령 exit·항목별 삭제·실제 부재·참조 해제·producer finalize의 별도 결과와, 빈 기록을 안전하게 조정하는 종료 조건을 명시한다. | reporting 실패를 삭제 실패/성공으로 덮어쓰지 않고 필요한 단계만 재실행한다. |
| 정상적인 다른 작업 기록 추가가 전체 registry identity를 바꾸면 검토를 불필요하게 다시 할 수 있다. 소유자 없는 package 입력 참조도 발견했다. | Mapping에 소비 참조의 실제 대상 존재와 해당 owner/들어오는 참조 범위의 identity를 명시한다. 독립 기록 변화로 무효화하지 않되 새 실제 소비자는 보호한다. | 기존 producer_registry_v1 검사를 재사용하고 dangling 입력·새 소비자 차단 회귀를 확인한다. |

반영 우선 소유자는 프로젝트 [artifact lifecycle playbook](../../docs/playbooks/artifact-lifecycle.md)이다. 내장 API·동작은 architecture/ops가, 공통 자산은 `instructions/skills/project-bootstrap/assets/playbooks/artifact-lifecycle.md`와 implementation reference가 각각 소유한다. 공통 반영 전에는 instruction maintenance guide를 읽고 유지본·활성본 동기화와 기존 검사를 함께 수행해야 한다. 이번 요청은 개선안 제시이므로 공통 지침을 수정하지 않았다.

## 검증·인수와 남은 한계

- 이번 조사의 근거는 실제 native 목록 조회, 로컬 producer JSON 읽기, 제한된 디렉터리·등록 경로 존재 확인, 관련 history와 현재 함수 조사다. 새 테스트·빌드·삭제·실제 이전을 실행하지 않았다. 이전 57개 검사와 후속 BS 검사 결과는 그 당시 입력의 근거로만 재사용하며 현재 전체 소스 통과로 재명명하지 않는다.
- 후속 writer 수정은 기존 lifecycle·runner·packaging·해당 writer 계약 검사를 선택한다. 성공·실패·취소/중단·충돌, 새 소비자, dangling 참조, 부분 삭제/로그 보존과 실제 잔여 경계를 포함한다. `scripts/azrael-feature-contracts.json`의 해당 기능 owner와 필수 검사 연결도 같이 갱신한다. source가 변하지 않은 기존 검사는 반복하지 않는다.
- 한정된 실제 시험 이전은 내용 identity·구성·권한과 실제 reader의 동작을 검증한다. Windows 회귀를 포함하고, 공통 코드 변경의 Linux/macOS 검증 여부를 따로 보고한다. 전체 제품 build/설치가 필요해지면 별도 범위로 판단한다.
- 최종 인수에서는 writer 목록, 조사 루트 분류표, 한 소유자와 참조, 보존/삭제/보류/unknown의 전체 구성, 실제 부재·finalize와 필요한 증거 승격을 대조한다. 소스·사용자 상태·현재/직전 복구·활성 공유 입력이 보존된 것을 확인한다.
- 이번 계획 파일 외의 기존 working 변경과 native/producer 상태는 수정하지 않는다. 조사 담당은 읽기 전용이며 새로운 fixture·target·원시 로그 파일을 만들지 않았다. 계획 입력 임시파일은 할당 후 일반 삭제한다. 문서 링크·UTF-8·diff/whitespace와 작업 분리 커밋을 최종 확인한다.
