# 프로젝트 관리 운영

상태: `partial`. Windows Rust51(debug/release)·native core8/prompt1, 프로젝트 어댑터·지침·Windows 정리 및 모의 배포 검사를 확인했다. 실제 수용 범위와 한계는 [작업 기록](../../work/BI-01-project-maintenance/01-plan.md)에 기록한다. 실행 중인 설치본의 도구 가용성은 소스 변경과 구분한다.

## 이 체크아웃의 정리 실행기

상태: `current` (Windows x64). 정리에는 `artifacts/versions/maintenance-owner-6f6f874e-win-x64-dx05/payload/maintenance_owner.exe`를 사용한다. 설치·검증 결과는 [작업 기록](../../work/DX-01-cleanup-performance/05-plan.md), 입력·실행파일 identity는 같은 version의 `verification/build.json`에서 확인한다. 이 실행기는 최적화된 실제 `maintenance_owner`이며 benchmark example이 아니다. 실행파일과 최소 검증 영수증은 계속 사용하는 설치물로 관리하고, 교체 또는 사용 종료 시 참조를 해제한 뒤 정리한다.

```powershell
$projectRoot = 'C:/Users/felre/Desktop/pi-harness-init'
$ownerExecutable = "$projectRoot/artifacts/versions/maintenance-owner-6f6f874e-win-x64-dx05/payload/maintenance_owner.exe"
& $ownerExecutable --project-root $projectRoot --request "$projectRoot/정리작업의-요청.json"
```

요청 JSON은 선택 프로젝트 안의 일반 파일로 만들고 해당 작업 묶음에서 관리한다. `operation`은 `inventory`, `register`, `review`, `apply`, `recover_lock`만 지원한다. 먼저 기존 등록 그룹을 조회하고, 현재 소유·참조·보호와 membership을 확인한 뒤 fresh review token으로 명시한 결정을 적용한다. unchanged 그룹은 재등록하지 않으며 `registered` 검증을 기본으로 한다. 실제 항목별 결과와 부재를 확인한다. 점유 잠금 해제나 실패한 보호 검사를 우회하는 용도로 사용하지 않는다.

앱 내장 `project_*`는 엔진에 정적으로 연결되어 있어 이 설치로 교체되지 않는다. 테스트·빌드 실행과 프로젝트 별칭은 기존 내장 도구를 사용한다. 별도 실행기는 OS 권한과 선택 프로젝트 경계를 적용하며, 내장 도구의 turn별 sandbox/grant 검사를 자체적으로 재현하지 않는다. 명령 실행 환경의 실제 권한·승인과 삭제 안전장치를 그대로 지킨다. 다른 OS/CPU용 설치물은 제공하지 않는다.

## 프로젝트 등록

저장소의 `project-maintenance.json`에 `schema_version: 1`, `project_id`, `managed_roots`, `protected_paths`, `bundles`를 둔다. 각 묶음은 `id`, `kind` (`test`, `prepare`, `build`), `purpose` (`one_off`, `retained`), `argv`를 가진다. `cwd`는 프로젝트 기준 상대 경로, `env`는 환경 변수, `depends_on`은 선행 묶음 ID, `inputs`는 명시한 입력 경로다. 현재 설정의 예는 [Azrael 설정](../../project-maintenance.json)을 따른다.

입력 목록은 설정된 범위의 출처다. 전체 프로젝트가 포함됐다는 뜻이나 검사 통과 캐시의 key가 아니다. 기존 runner·보존 목록·출처 검사가 실제 검사 의무와 캐시 재사용을 소유한다. 모델은 호출 전에 선택한 명령의 실제 부작용을 확인한다.

`managed_roots`는 정리를 허용할 수 있는 범위이며 등록만으로 삭제를 허용하지 않는다. 설치본·복구본·다른 작업의 입력은 보호 경로와 항목 참조에 반영한다. 프로젝트 밖의 백업은 소유가 확인된 별도 관리 디렉터리에 설정을 두고 다른 `project_id`로 등록한다. 각 등록 루트의 `managed_roots`는 그 루트 안의 상대 경로이며 루트 자체는 삭제하지 않는다. 한 설정에서 루트를 벗어나는 경로와 원격 환경은 지원하지 않는다.

## 관리 경계 자체의 수명 종료

상태: 소스와 Windows 실행기 검증 완료. 일반 삭제는 `managed_roots` 자체를 보호한다. 관리 경계의 생성물까지 폐기하도록 사용자가 승인한 경우에는 같은 라이브러리의 `maintenance_owner` 실행기로 명시적인 폐기 검토와 적용을 수행한다. 설치된 Azrael 도구의 버전과 별개로 검증한 실행파일을 사용하며, fixture 전용 example을 실물 정리에 사용하지 않는다.

선택한 절대 프로젝트 경계 안에 요청 JSON과 별도 보존 증거를 둔다. 요청의 `operation`은 `review` 또는 `apply`이며 `retire_managed_roots`에는 `owner`, `reason`, `evidence_ref`, 정확한 등록 항목 `ids`를 넣는다. 증거는 삭제 대상 밖에 보존한다. 전체 그룹의 fresh 검토 토큰으로 모든 live 항목에 같은 delete/defer 결정을 지정한다. 폐기 요청을 바꾸거나 생략하면 이전 토큰을 사용할 수 없다.

```powershell
& '<검증한 실행파일의 절대 경로>/maintenance_owner.exe' --project-root 'C:/선택한프로젝트' --request 'C:/선택한프로젝트/retirement-review.json'
& '<같은 실행파일의 절대 경로>/maintenance_owner.exe' --project-root 'C:/선택한프로젝트' --request 'C:/선택한프로젝트/retirement-apply.json'
```

`evidence_ref`는 선택 프로젝트의 `artifacts/maintenance/evidence/` 아래에 있는 1 MiB 이하 일반 파일이다. 현재 읽기 권한과 링크 검사를 통과해야 하며 내용 identity를 검토 토큰에 묶는다. 이 실행기는 선택 경계의 기존 OS 권한을 사용한다. 승격·force·ACL/소유권 변경을 하지 않는다. 거부된 보호를 다른 shell이나 API로 우회하지 않는다. `results`의 실제 status/remaining과 경로 부재를 확인하고 부분 실패를 보존한다. 설정된 경계와 native 이력은 보존되므로 payload 삭제가 별칭 해제나 관리 이력 삭제를 뜻하지 않는다. 별칭이 필요 없으면 실제 결과 확인 뒤 별도의 `unregister_project`로 메타데이터만 해제한다.

## 중첩 소유 항목의 단계적 폐기

검증한 `maintenance_owner`에서만 `retire_nested_member`를 사용한다. 예시는 `{"parent":"PARENT_ID","child":"CHILD_ID","owner":"OWNER","reason":"폐기 근거","evidence_ref":"artifacts/maintenance/evidence/retirement.json"}`다. 같은 소유자의 서로 다른 완결 묶음이며 각각 live 항목이 하나이고 child가 parent의 엄격한 하위여야 한다. 근거 파일은 parent 밖에 보존한다.

review에 양쪽 ID 또는 양쪽 group ID를 명시한다. apply에는 같은 요청과 fresh token을 사용해 parent `defer` 및 child `delete` 두 결정을 제출한다. parent의 `revisit_condition`에는 하위 삭제 후 상위 현재 구성의 전체 재등록·재검토를 명시한다. 상위의 보호·stale 검토도 하위 삭제를 차단한다. 하위의 실제 삭제 결과와 부재를 확인한 뒤 상위를 전체 재등록하고 일반 review/apply로 진행한다. 실패하면 원래 소유와 pending 결과를 보존하며 원시 manifest 수정이나 직접 삭제로 우회하지 않는다.

## 기존 테스트 선택기

다음 명령은 목록과 계획만 출력한다.

```powershell
node scripts/project-maintenance.cjs catalog
node scripts/project-maintenance.cjs plan --area queue
```

어댑터는 `test-project.cjs`의 선택 범위와 명령을 재사용한다. 기본 테스트 실행은 암묵적 제품 빌드를 거부하며 준비 컴파일이 필요한 경우 명시적으로 표시한다. `extension-current`와 `extension-standalone` 묶음은 `extension-prepare`를 선행 단계로 선언하고 컴파일된 검사 runner를 직접 실행한다. `extension-component-build`는 별도 빌드 묶음이다. 기존 필수 회귀를 이 초기 묶음 목록으로 대체하지 않는다.

테스트 결과의 기본 위치는 `artifacts/tasks/<work-id>/runs/<unique-run-id>/`다. `--work-id BI-01-project-maintenance`처럼 작업을 지정하고, 생략하면 `project-tests`로 묶는다. 개별 stdout/stderr는 `logs/`, 실행 중에도 갱신하는 결과는 `reports/results.json`에 둔다. runner가 쓰기 전에 producer를 등록하며, 성공 뒤에도 모델이 전체 run의 삭제 또는 보류를 결정한다. 반환된 `lifecycleId`, `runRoot`, `resultPath`로 묶음과 실제 결과를 찾는다. Producer 기록은 내장 inventory 등록과 별개이므로 아래의 `register` 절차로 검토 대상에 연결한다. 실패나 중단으로 보호된 run은 진단·재실행 필요를 확인하고 상태를 조정한 뒤 정리한다. 명시적 legacy `--log-directory`와 프로그램 방식의 `directory`는 기존 파일 배치를 유지하므로 해당 호출자가 소유/정리 연결을 제공한다. `--list`나 어댑터의 `plan`은 출력 run을 만들지 않는다. 실제 소스 검증 결과는 작업 기록에서 확인한다.

## 내장 도구 호출

도구군이 실제 제공되는 엔진에서 다음 형식으로 호출한다. `project_root`를 생략하면 선택한 로컬 환경의 작업 디렉터리를 사용한다. 별칭 등록 후에는 `project_id`로 등록된 루트를 선택한다. 두 선택자를 함께 지정하지 않는다. 등록된 ID와 실제 설정이 달라지면 등록을 검토한다.

```json
{"action":"list"}
```

위 인자는 `project_inventory`용이다. 별칭 등록·조회·해제도 같은 도구를 사용한다. 등록할 루트의 설정에서 ID를 읽으며, 해제는 파일 삭제 없이 별칭만 제거한다.

```json
{"action":"register_project","project_root":"C:/work/example"}
{"action":"projects"}
{"action":"list","project_id":"example"}
{"action":"unregister_project","project_id":"example"}
```

`example`은 해당 설정의 실제 ID로 바꾼다. `project_tests`의 계획과 실행은 각각 다음과 같다.

```json
{"action":"plan","bundles":["maintenance-adapter","common-instructions"]}
{"action":"run","bundles":["maintenance-adapter","common-instructions"]}
```

빌드는 `project_build`에서 명시한 빌드 묶음만 선택한다. 실행 전 plan을 확인하고, 결과의 실제 exit code·단계·실행 출력과 로그 참조를 확인한다. 성공한 도구 호출을 테스트 통과로 해석하지 않는다. `status`와 `run_id`로 기록을 조회하며 미확인 결과를 성공으로 채우거나 같은 producer를 다시 시작하지 않는다.

엔진 유실로 결과를 관측할 수 없는 실행은 그대로 미확인 상태로 남는다. 해당 producer와 자식 프로세스가 종료되었음을 별도로 확인한 모델은 `project_tests` 또는 `project_build`에서 명시적으로 복구할 수 있다. PID가 보이지 않는다는 사실만으로 종료를 확정하지 않는다. 현재 엔진이 소유한 세션은 이 경로에서 해제할 수 없다. 복구는 재시도 보호만 해제하고 통과·종료 코드를 만들지 않는다.

```json
{"action":"recover","run_id":"RUN_ID","request":{"producer_stopped_verified":true,"reason":"소유 실행과 자식 프로세스의 종료 확인","evidence_ref":"확인 결과를 남긴 로그 경로"}}
```

## 생성물과 백업

검증한 `maintenance_owner` 실행기는 같은 라이브러리의 `inventory`, `register`, `review`, `apply`도 지원한다. 요청은 선택 프로젝트 안의 절대 일반 JSON 파일이어야 하며, 테스트·빌드 실행은 이 소유자 실행기의 지원 범위가 아니다. 새 소스 기능을 실제 정리에 쓰기 전 해당 실행파일의 고정 입력과 native 회귀 결과를 확인한다.

항목의 `verified_junctions` 예시는 `[{"path":"temporary/fixture/link","kind":"junction","target":"C:/선택한프로젝트/실제대상"}]`다. 정확한 소유 생성물만 지정하며 등록이 고정한 identity는 임의로 만들거나 수정하지 않는다. 새 링크·바뀐 대상·부재 경로 재등장은 새 검토가 필요하다. 기존 소유자 등록 요청의 전체 구성원을 유지한다.

생성 도구나 모델은 생성 근거를 확인한 항목을 `project_inventory`의 `register`로 등록한다. 항목에는 ID·경로·종류·소유자·생성 여부·사용/보호 확인 여부·참조를 명시한다. 확인 가능한 생성 시각·소스·버전·도구/캐시 형식·보존 사유도 함께 기록한다. 알 수 없는 값은 확인되지 않은 상태로 둔다.

기존 네이티브 설치의 백업 후보는 명시한 `deployment.json`에서 다음 명령으로 읽는다.

```powershell
node scripts/project-maintenance.cjs collect --native-install-receipt artifacts/deployments/DEPLOYMENT/deployment.json
```

`DEPLOYMENT`는 실제 소유자가 확인된 경로로 바꾼다. 과거 설치 영수증은 현재 사용·복구 참조를 증명하지 못하므로 수집 결과의 `protection_known`은 `false`다. 이 명령은 등록·삭제를 수행하지 않는다. 디렉터리 크기는 정밀 측정 전까지 미확인이다.

`project_cleanup_review`에서 선택한 항목을 갱신한다.

등록된 묶음은 기본 `verification:"registered"`를 사용한다. 등록된 내용 측정을 재사용하며 현재 루트 identity·존재·보호·참조와 membership 근거를 확인하므로 별도 payload 전수 해시는 필요 없다. 내용이나 구성원이 바뀌었다면 생산자가 먼저 등록 정보를 갱신한다. 같은 루트 안에서 신고하지 않은 내용 변경까지 확인해야 할 때에만 검토와 적용 양쪽에 `verification:"full"`을 명시한다. 두 모드의 토큰은 교환할 수 없다. 단독 항목은 전체 검증을 유지한다. 등록 모드도 실제 삭제의 하위 경로 권한·링크·잔여 검사는 수행한다.

```json
{"action":"review","request":{"ids":["temporary-fixture"]}}
```

모델은 결과·사용 관계·용량·재생성 비용과 복구 조건을 보고 `project_cleanup_apply`에 항목별 결정을 제출한다. 토큰은 방금 받은 값이어야 한다.

```json
{"action":"apply","request":{"decisions":[{"id":"temporary-fixture","token":"REVIEW_TOKEN","decision":"defer","reason":"실패 원인 수정 후 재실행 필요","revisit_condition":"수정한 테스트 통과 후 재검토"}]}}
```

목적이 끝났으면 같은 방식으로 `delete`를 선택한다. 기간·예산은 재검토 조건이며 삭제를 예약하지 않는다. 원본, 사용자 상태, 활성 실행과 유일한 복구본을 보존한다. 확인된 생성물의 ReadOnly·Hidden 속성 처리와 일반 삭제의 제한은 [설계 계약](../architecture/project-maintenance.md#정리-결정과-적용)을 따른다. 실제 항목별 결과와 잔여 경로를 확인한다. 실패나 미확인 상태는 완료로 보고하지 않는다.

## 테스트 프로필의 생성과 종료 정리

테스트 프로필의 기본 위치는 `artifacts/tasks/<work-id>/runs/<run-id>/temporary/profiles/<app>/`다. 앱이 지원하는 프로필 경로 옵션으로 지정하고, 프로필·확장 복사본·캐시·로그·백업을 생성 전에 같은 실행 소유로 기록한다. 현재 AO Chromium writer는 같은 run의 `temporary/fixture/chrome-profile`을 사용한다. 이 경로는 기본 배치와 동등한 작업 전용 하위 경로이며 브라우저 종료 후 전체 run의 모델 검토를 기다린다.

실패 수정·재실행·진단·인계가 끝나면 모델이 관련 프로세스 종료를 확인하고 실행 묶음의 삭제를 선택한다. 삭제 결과와 실제 잔여 경로를 확인한 뒤 정리 완료로 기록한다. 보류에는 이유와 해제 조건을 남기고 미정리 상태를 유지한다. 성공·실패·취소 모두 같은 종료 절차를 따른다. 기존 사용자 프로필을 사용해야 하면 추가한 파일과 변경한 파일을 생성 전 상태와 대조해 추가분 삭제·변경분 복원을 수행한다. 실제 설치본과 직전 검증 복구본은 해당 버전의 지속 소유로 인계하며 테스트 임시물로 처리하지 않는다.

물리적으로 프로젝트 밖인 관리 경로는 그 경로를 포함하는 별도 등록 루트와 설정을 사용한다. 설정의 `managed_roots`를 확인된 생성물 하위 경로로 한정하고 현재 설치·복구·사용자 상태·공유 제어 파일을 보호한다. 한 프로젝트의 `..` 경로나 절대 경로로 루트 밖 삭제를 허용하지 않는다. 별도 루트의 설정·관리 기록도 소유와 종료 조건을 명시한다. 기존 cleanup owner가 있는 외부 fixture는 그 절차와 증거를 연결한다. 범위·소유를 확인할 수 없는 외부 경로는 삭제하지 않고 남은 확인 사항으로 보고한다.

기존 프로필 이전은 이름·미등록·오래된 날짜만으로 결정하지 않는다. 실제 배포 소유, 현재 등록·실행·shortcut·복구·소비 참조와 사용자 파일 혼합 여부를 확인하고 검토된 생성물만 선택한다. 공유 `extensions.json`·`.obsolete` 같은 제어 파일 전체를 구버전 묶음으로 삭제하지 않는다. 일반 삭제·허용된 생성물 속성 처리·부분 실패 기록은 [생성물 관리 절차](../playbooks/artifact-lifecycle.md)를 따른다.

<a id="registered-group-cleanup"></a>
## 등록된 묶음 정리

### 관리 sentinel 복구

새 소스의 검증된 `maintenance_owner`는 `operation:"recover_lock"`을 별도 지원한다. 설치된 `project_*` 도구의 `recover`는 실행 수명 복구이며 sentinel 해제와 다르다. 현재 점유 작업의 잠금을 삭제하거나 보호 정책을 우회하는 용도로 사용하지 않는다.

요청은 `lock_kind` (`maintenance`/`catalog`/`run_claim`), 정확한 `expected_lock_sha256`, `expected_token` (구형 marker는 null), `producer_stopped_verified:true`, `reason`, `evidence_ref`, `evidence_sha256`, `receipt_ref`를 가진다. evidence와 미존재 receipt 경로는 선택 프로젝트의 `artifacts/maintenance/evidence/` 안에 둔다. 실행 전에 정확한 producer와 전체 자식 종료를 별도로 확인하고, 원래 unknown/실패 결과를 보존한다. 살아 있는 PID·미확인 조회·pending manifest·변경된 identity는 거부한다. 빈 lock 파일이나 PID 부재만으로 확인을 선언하지 않는다.

기존 owner CLI와 같은 `--project-root ABSOLUTE_ROOT --request ABSOLUTE_IN_ROOT_JSON` 형식을 사용한다. 검증한 source/binary identity를 작업 기록에 고정하고 receipt의 실제 결과와 대상 부재를 확인한다. 부분 실패는 영수증과 현재 경로를 유지한 채 재검토한다. 복구 guard는 OS 잠금용 영속 파일이므로 존재 자체를 stale sentinel로 제거하지 않는다.

등록된 묶음은 `project_inventory`의 현재 기록에서 시작해 `project_cleanup_review`로 검토하고 `project_cleanup_apply`로 명시적인 삭제·보류 결정을 적용한다. 모델은 허용 범위와 결정을 담당하고, 도구가 구현한 identity·구성·소유·참조·권한·보호 검사는 도구에 맡긴다. 동일 검사를 별도 셸 목록, 재귀 해시 또는 두 번째 관리 명세로 반복하지 않는다.

구성이나 참조가 바뀌면 지원되는 등록 동작으로 해당 묶음 정보를 갱신하고 새 검토 토큰을 받는다. 변경 전 삭제 승인은 재사용하지 않는다. 바뀌지 않은 묶음은 다시 등록하지 않는다. 직접 조사는 미등록 경로, 실제 상태와 기록의 충돌, 도구가 보고한 불확실성, registry에 반영되지 않은 설치·실행 참조 등 확인 범위 밖의 구체적 공백으로 한정한다. 도구가 지원하지 않는 동작은 기존 소유자의 절차를 사용하며, 기록이 있다는 이유로 구현되지 않은 확인 능력을 가정하지 않는다.

등록 후 사라진 구성원은 새 검토에서 실제 부재를 표시한다. 이미 없는 구성원도 반환된 항목의 토큰으로 같은 삭제·보류 결정을 제출한다. 삭제 결정에서는 파일 삭제를 시도하지 않고 부재 결과를 기록한다. 전체 갱신 요청에서 빠진 기존 부재 구성원도 이력과 명시적 정리를 위해 같은 묶음에 유지한다. 권한 거부·조회 실패는 부재로 취급하지 않으며 묶음을 보호한다. 검토 후 파일이 사라지거나 다시 나타나 기존 토큰이 무효화되면 새 검토 결과로 재시도한다. pending 복구나 활성 참조는 별도로 해소해야 한다.

느린 호출은 진행 단계를 확인하고 실제 완료를 기다린다. 같은 대상을 다시 스캔하거나 미종료 producer를 중복 실행하지 않는다. 적용 후에는 항목별 실제 결과와 잔여를 확인하고 참조 해제·finalize를 수행한다. 도구가 이미 확인한 부재는 모순이나 미확인 결과가 없는 한 재귀 조사하지 않는다. 등록 모드에서 payload 내부를 재해시하지 않으며, 실제 삭제에 필요한 경로 열거·권한·링크 검사는 계속 수행한다. 이전 설치본은 내부 전수 측정을 계속할 수 있으므로 새 소스의 기능과 현재 실행 중인 도구의 기능을 구분한다.

## 종료·참조 해제와 보호 갱신

새 run writer는 정상 종료와 확인된 실패 종료를 `closeLifecycle`로 기록한다. 결과를 성공으로 고치지 않고 구성 완결과 실행 수명의 종료를 구분하며, 미확인 실행은 보호한다. `scripts/artifact-lifecycle.cjs close --project-root <absolute-root> --id <consumer-id> --request-file <absolute-json>`의 요청은 `owner`, `expected_revision`, `producer_stopped_verified:true`, `outcome` (`success`/`failure`/`unknown`), `exit_code`, `reason`, `evidence_ref`, `evidence_sha256`을 가진다. 요청 파일은 프로젝트 안에 두고 실제 종료 근거와 SHA256을 제출한다. 명시한 execution 참조만 종료와 함께 해제하며 기존 종류 없는 참조는 유지한다.

지속 참조를 해제하려면 같은 CLI의 `release`와 요청 파일에 소유자·revision·`reference_ids`·이유·근거 경로·SHA256을 명시한다. catalog의 각 reference ID를 그대로 사용한다. 설치·복구·증거 인계는 새 참조를 먼저 등록하고 이전 참조를 해제한다. 참조를 푼 뒤 `project_inventory(action:register,request:{refresh_group:{id}})`로 같은 소유·경로·role의 native 보호 상태를 갱신하고 fresh review를 받는다. 내용 identity·크기·측정 시각은 재측정하지 않으며 실제 삭제 전 검사는 유지한다. 오래된 설치본에서 이 request가 지원되지 않으면 기존 전체 재등록 경로를 사용하고 기능이 구현됐다고 가정하지 않는다.

모듈 cache owner는 새 키 선택 직후 이전 미사용 키를 정리한다. 새 빌드 실패 때문에 이전 키를 fallback으로 남기지 않으며 별도의 레거시 정리 요청을 요구하지 않는다. 명시적 보존 수, 실제 설치·다른 소비자·실행 중인 자료와 조회 불확실성은 기존 guard가 보호하고 결과에 사유를 남긴다. 이미 누적된 기존 unknown/pending 기록은 종료 근거 없이 일괄 해제하지 않는다.

## 작업·버전 묶음 연결과 이전

### 확인된 legacy 로그의 보관 이관

일반 `record`는 `generated:false`나 `protection_known:false`를 승격하지 않는다. 생성 근거를 확인한 legacy 로그는 `node scripts/artifact-lifecycle.cjs transfer-custody --project-root <absolute-root> --id <custody-id> --request-file <absolute-json>`로 명시적으로 이관한다. 요청은 보관 `owner`, `expected_revision`, `reason`, `evidence_ref`, `evidence_sha256`, 새 `target:{id,kind:"work",owner,version?}`와 정확한 절대 `paths`를 가진다. source에 선택되지 않은 member가 남는 부분 이관을 지원한다.

증거 JSON은 `schema:1`, `source_id`, `source_revision`, `target_id`, `user_authorized:true`와 경로별 `entries`를 가진다. 각 entry의 `path`, 확인된 `generated:true`, `protection_known:true`, `consumers_released:true`, `producer_stopped_verified:true`, 구체적인 `generation_basis`, `producer_evidence:[{path,sha256}]`를 기록한다. 근거는 원래 생성 스크립트·실행 영수증 등 실제 파일에서 수집하고, 삭제 영역과 registry 밖의 보존 위치로 먼저 이관한다. 승인이나 이관 명령 자체를 원래 생성 근거로 사용하지 않는다. native 소유 기록과 설치·실행·현재 소비 참조는 caller가 먼저 확인하며, 다른 소유와 겹친 부모를 일괄 선택하지 않는다.

writer는 잠금 아래 pending target → source claim 이관·영수증 → 완료 target 순서로 기록한다. 같은 요청의 재개는 가능하지만 다른 증거·소유자·revision·target 변경은 거절한다. target이 이미 삭제·finalize된 뒤 같은 요청을 재실행해도 파일이나 소유를 되살리지 않는다. 이후 새 target의 `register` 요청을 내장 `project_inventory`로 등록하고 fresh `project_cleanup_review` 및 명시적 `project_cleanup_apply`를 수행한다. 이관 성공만으로 삭제됐다고 보고하지 않는다. 파일이 모두 실제로 사라지고 참조가 해제되면 새 target을 finalize한다. 원래 custody의 나머지 member와 미확정 상태는 유지한다.

컨테이너 전체를 주장하는 과거 보관 기록과 확인된 새 생성물이 겹치면 `node scripts/artifact-lifecycle.cjs refine-custody --project-root <absolute-root> --request-file <absolute-json>`를 사용한다. 요청은 `sources:[{id,owner,expected_revision}]`, 정확한 `parent`, 분리할 직접 자식의 절대 `paths`, `target:{id,kind:"work",owner,version?}`, `reason`, `evidence_ref`, `evidence_sha256`를 고정한다. 외부 증거는 `schema:1`, `action:"refine-custody"`, 같은 `sources`/`parent`, `target_id`, `user_authorized:true`, 위와 동일한 생성·종료·소비 해제 근거의 `entries`를 가진다. caller는 현재 producer/native claim과 실제 생성 이력을 먼저 대조한다. native 조상 claim이 별도로 남으면 이 명령만으로 해제되지 않는다.

대상 source는 producer·outbound 참조가 없는 retained/incomplete 기록이어야 하며 정확한 parent member의 role은 `legacy-custody` 또는 `legacy-input`, 두 보호 값은 false여야 한다. source로 향하는 소비 참조가 있으면 요청과 증거 양쪽에 같은 `consumer_exclusions:[{id,owner,expected_revision,reference_ids,paths,reason,evidence_ref,evidence_sha256}]`를 넣는다. 각 consumer owner가 고정 입력을 조사하여 선택 경로를 읽지 않는다고 판단한 외부 근거를 요구하며, 모든 현재 consumer와 해당 source 참조 identity가 정확히 일치해야 한다. consumer 기록·기존 참조는 해제하거나 변경하지 않는다. 새로운 consumer·변경된 revision·증거, target으로 향하는 소비 참조는 차단한다. 선택하지 않은 현재 직접 자식은 같은 미확정 role/보호 값으로 source에 남고, 다른 member·상태도 유지된다. 미선택 자식이 없는 컨테이너, 선택한 트리의 링크, 변경된 파일시스템 identity나 구성은 거절한다. pending target과 source 영수증을 기록하므로 중단 시 원래 요청 파일로만 재개하고 raw registry를 수정하지 않는다. 완료 후 새 target을 native 등록·fresh review/apply로 정리한다. 이 소유권 분리는 삭제 결과와 별도다.

사용자가 최상위 `archive/` 보관을 지정했지만 기본 producer/관리 경계가 이를 지원하지 않으면 primary allowlist를 넓히지 않는다. 확인된 비활성 생성물만 고유 archive 폴더의 별도 관리 프로젝트로 이전하고, 그 안의 payload만 관리 루트로 설정한다. 원래 자료와 전용 archive의 계획·보호를 먼저 기록하고, 기존 owner의 잠금·사용 참조가 해소된 뒤 ordinary 이동과 내용/identity·원래 경로 부재를 검증한다. 이동한 자료는 완전 구성으로 재등록하고 사용자 보관 조건으로 명시적 defer한다. 설정·이동 명세·영수증은 payload 밖의 보호된 제어 자료로 둔다. 중단된 원래 삭제의 실제 결과는 보존하며 archive 성공으로 삭제 성공을 대신 기록하지 않는다.

실제 경로를 묶어 옮길 때는 같은 요청에 신규 절대 `destination_root`를 추가하고 `relocate-custody` CLI를 사용한다. destination은 기존 claim 및 선택 원본과 겹치지 않는 `artifacts/logs/` 아래의 미존재 전용 폴더이며 부모가 존재해야 한다. caller는 native의 현재/과거 claim 충돌도 먼저 확인한다. 현재 실행/소비 경계는 옮기지 않는다. 작은 inactive copy pilot에서 원본을 유지한 채 완전성·내용 SHA·읽기 권한과 실제 reader를 확인한 뒤 적용한다. writer는 pending mapping 및 source/destination의 dev/ino를 보존하고 동일 볼륨 ordinary rename만 사용한다. 재개는 원본/목적지 중 정확히 하나가 존재하고 기록된 identity와 일치해야 한다. mkdir 직후 identity 저장 전 중단이나 교체/충돌은 fail-closed이며 임의 인수·덮어쓰기·삭제로 해결하지 않는다. 성공 후 `register`는 새 폴더 하나를 native member로 투영한다. 새 경계의 fresh review/apply·실제 부재 확인·finalize 전까지 물리 이관과 삭제 결과를 분리해 보고한다.

현재 단독 writer의 기본 결과는 stdout의 `runRoot`/`lifecycleId`와 해당 run의 `reports/producer.json`으로 찾는다. 기존 고정 `artifacts/logs/...` 경로는 과거 실행 근거일 수 있으며 새 실행의 출력 경로로 가정하지 않는다. renderer의 기존 요약·스크린샷 파일명은 run의 `logs/`, native/check의 검증 결과는 `reports/`에 둔다. `check-management` 결과는 `<runRoot>/reports/verification.json`이다. 명시한 pending 부모가 소유하는 deploy/accounts 검사는 기존 부모 내부 결과 경로를 유지한다. instruction CLI JSON의 manifest 부모를 `AZRAEL_INSTRUCTION_RELEASE_ASSETS`로 전달하면 해당 release의 integration reader를 선택할 수 있다. caller가 명시한 외부 출력·실제 auth/state는 기존 소유자를 유지한다.

`maintenance-lifecycle-writers` 묶음은 공용 helper, native/check 및 29개 renderer의 생성 전 소유·고유 경로·충돌·성공/실패/미종료와 작은 instruction packaging fixture를 검사한다. `project_tests plan/run`에 이 ID를 명시하거나 `node scripts/check-artifact-lifecycle.cjs --stage writers`를 사용한다. runner가 검사 fixture와 로그를 먼저 등록하며 실제 browser/host 전체 수용과 live API 검사는 별도다. Windows의 대표 browser6·host12 및 모의 deploy3 수용 결과와 재시도 원인은 [인수 근거](../../work/BI-01-project-maintenance/04-adoption-acceptance.json)에 보존한다.

기존 경로의 [adoption map](../../work/BI-01-project-maintenance/05-adoption-map.json)은 현재 관리 경계별 분류다. 미확정 자료는 `work:BI-01-legacy-custody:20261019`의 non-generated retained/incomplete 보관 기록과 재검토 조건으로 보호한다. 이는 원래 생성 이력의 확인이나 삭제 승인을 뜻하지 않는다. 삭제하려는 정확한 묶음만 native로 측정·검토하고 전체 파일의 반복 해시를 수행하지 않는다. 과거 정리 명령이 관찰한 대상과 원래 producer 소유를 구별하며 현재/복구/활성 참조를 유지한다.

새 프로젝트 도입과 기존 경로의 단계적 이전은 [Artifact lifecycle and migration](../playbooks/artifact-lifecycle.md)을 따른다. playbook을 복사하거나 bootstrap하는 동작은 파일 이동·기존 산출물 삭제를 실행하지 않는다. 현재 Azrael은 producer record로 기존 build/package/deploy 경로를 연결하는 방식을 지원하며, 모든 과거 경로나 공유 캐시가 새 기본 디렉터리로 이전됐다는 뜻은 아니다.

프로젝트 producer는 생성 전에 `scripts/artifact-lifecycle.cjs record` 또는 PowerShell 어댑터로 예상 경로·ID·소유자·pending/incomplete 상태를 등록하고 종료 후 실제 구성과 결과를 조정한다. `catalog`의 CLI 조회는 기본 50개/최대 200개씩 반환한다. 다음 예시의 ID는 실제 등록값으로 바꾼다.

```powershell
node scripts/artifact-lifecycle.cjs catalog --project-root C:/work/example
node scripts/artifact-lifecycle.cjs register --project-root C:/work/example --id version:BUILD_ID
```

두 번째 명령은 **내장 도구에 제출할 요청을 출력**한다. 해당 요청의 `operation`을 제외한 `group`을 `project_inventory`의 `action:register`, `request`에 전달한다. 기존 producer 기록만으로 현재 사용 상태가 확인되지는 않으므로 기본 `protection_known:false` 항목의 소비·설치·복구 보호를 먼저 확인하고 근거에 맞게 등록한다. 이 연결은 `membership_source_format:"producer_registry_v1"`을 함께 보낸다. 내장 기능은 관리 목록을 읽어 해당 소유 기록과 들어오는 소비 참조를 다시 확인한다. 새 소비자·소유 구성 변경은 오래된 결정을 차단하고, 관련 없는 정상 작업 기록은 해당 묶음을 무효화하지 않는다. 잘못된 JSON·권한 거부·읽기 중 변경은 보수적으로 차단한다. 다른 일반 제어 파일/디렉터리는 format을 생략하여 전체 identity 검사를 유지한다.

```json
{"action":"review","request":{"group_ids":["version:BUILD_ID"]}}
```

결과의 전체 live 항목을 확인하고 모두 같은 `delete` 또는 `defer`로 결정한다. 한 항목이라도 보호되면 전체 묶음을 보류한다. 실패한 삭제는 미시도 로그·근거를 보존하고 실제 잔여를 재확인한다. 본체만 없어진 상태를 전체 완료로 보고하지 않는다. 등록된 경로가 실제로 모두 사라지고 소비 참조가 해제된 후에만 다음 명령으로 빈 producer metadata를 조정한다.

```powershell
node scripts/artifact-lifecycle.cjs finalize --project-root C:/work/example --id version:BUILD_ID
```

진단이 끝난 실패·미확인 실행은 필요한 결과를 먼저 독립적으로 보존하고 전체 producer 종료와 실제 구성 범위를 확인한 후 모델이 삭제를 결정한다. native에는 그 근거 파일을 `membership_source`로 둔 완결된 검토 묶음을 제출할 수 있으며 원래 command exit와 상태를 근거에 그대로 보존한다. 실제 삭제 결과·부재·참조 해제를 확인한 다음 Node API `finalize(root,id,{producer_stopped_verified:true,reason,evidence_ref})`로 빈 기록을 조정한다. 증거 파일은 삭제 묶음과 registry 밖에 있어야 한다. 종료 근거가 없거나 실제 파일·소비 참조가 남으면 축약하지 않는다.

legacy release/verification cleaner의 Apply는 미등록 후보를 `lifecycle-membership-unreviewed`로 차단한다. 기존 명세·설치 영수증·현재 실행을 대조해 전체 수명 묶음을 등록한 뒤 기존 보호 검사를 통과해야 한다. 파일명으로 로그를 추측해 삭제하거나 관리 디렉터리 밖의 원본을 묶음에 넣지 않는다. 공유 cache cleaner는 기존 cache owner의 잠금·회수 조건을 계속 적용한다.

`scripts/check-artifact-lifecycle.cjs --stage source`는 lifecycle·build 소스 계약과 작은 포장 fixture를 검사한다. `--stage windows`는 PowerShell 7.4 이상에서 정리 fixture 세 종류와 `verify only`, `account-success`, `build-fail` 모의 배포 사례를 검사한다. 실제 앱 빌드·설치 명령은 실행하지 않는다. 검사 진입점도 실행 전에 `artifacts/tasks/lifecycle-checks/runs/<id>/`를 등록하고 로그와 실제 종료 코드를 같은 실행에 기록한다. 성공·실패 결과를 읽은 모델이 해당 실행 묶음의 삭제/보류를 결정한다. 이 묶음은 설정의 `maintenance-lifecycle-source`, `maintenance-lifecycle-windows`로도 호출할 수 있다.

임시 deploy/account fixture는 별도 run 소유다. 종료를 확인하고 필요한 검증을 버전 근거로 옮긴 뒤 해당 run을 정리한다. 설치본을 보존한다는 이유로 큰 임시 fixture까지 버전에 붙잡아 두지 않는다. 실패·미확인 fixture는 실패 상태와 재검토 조건을 남긴다.

`test-deploy-azrael.ps1`의 모의 검사 출력은 선택한 `ArtifactProjectRoot` 내부의 `artifacts/tasks/deploy-checks/runs/<GUID>/`에 모인다. 모든 모드에서 `temporary/fixtures spaces 한글`, `logs/`, `reports/`를 함께 등록한다. `ChangedOnly`도 같은 구조를 사용하고, 반환한 `LifecycleId`, `RunRoot`, `ResultPath`와 `Reports`로 결과를 찾는다. 요약은 `reports/results.json`, 예외 진단은 `reports/failure.json`이며 기존 `Logs`는 개별 실행 로그 위치다. 성공해도 이 run을 자동 삭제하지 않고 모델이 검토한다.

## 검증 범위와 채택 상태

등록 모드는 대형 묶음에서도 등록된 측정값을 재사용한다. 명시적인 전체 검증에서 Unix는 한 호출 안의 64KiB 이상 파일 SHA를 파일 ID·변경 버전으로 재사용하며 Windows는 USN 기록 합침 때문에 내용을 다시 읽는다. 다음 관리 호출에는 내용 캐시를 이어 쓰지 않는다. 최적화 전환이나 중단 뒤에는 이미 저장된 삭제 결과를 유지하고 실제 남은 구성원만 다시 검토·적용한다. 완료된 항목을 다시 등록하거나 전체 삭제를 처음부터 반복하지 않는다. 잠금 복구는 해당 작업의 소유 PID와 모든 실제 삭제 child의 종료를 확인한 경우에만 해당 잠금으로 한정한다. `manifest.pending`이 남았거나 실제 결과가 불명확하면 먼저 그 상태를 복구하고 정상 manifest를 임의로 되돌리지 않는다.

소스 계약은 `node --test scripts/test-project-maintenance.cjs scripts/test-common-agent-instructions.cjs`, 지침 무결성은 `python -B scripts/import-instructions.py --check`로 확인한다. native 검사는 `scripts/check-project-maintenance.cjs`가 고정한 엔진 소스와 기존 Cargo 실행/캐시 경계를 사용한다. library·prompts·core 단계를 분리하며, 실제 실행 결과는 작업 기록에 둔다. 전체 앱 생성·설치·원격 검증은 이 명령의 소스 수용에 포함되지 않는다.
