# 프로젝트 관리 운영

상태: `partial`. Windows Rust51(debug/release)·native core8/prompt1, 프로젝트 어댑터·지침·Windows 정리 및 모의 배포 검사를 확인했다. 실제 수용 범위와 한계는 [작업 기록](../../work/BI-01-project-maintenance/01-plan.md)에 기록한다. 실행 중인 설치본의 도구 가용성은 소스 변경과 구분한다.

## 프로젝트 등록

저장소의 `project-maintenance.json`에 `schema_version: 1`, `project_id`, `managed_roots`, `protected_paths`, `bundles`를 둔다. 각 묶음은 `id`, `kind` (`test`, `prepare`, `build`), `purpose` (`one_off`, `retained`), `argv`를 가진다. `cwd`는 프로젝트 기준 상대 경로, `env`는 환경 변수, `depends_on`은 선행 묶음 ID, `inputs`는 명시한 입력 경로다. 현재 설정의 예는 [Azrael 설정](../../project-maintenance.json)을 따른다.

입력 목록은 설정된 범위의 출처다. 전체 프로젝트가 포함됐다는 뜻이나 검사 통과 캐시의 key가 아니다. 기존 runner·보존 목록·출처 검사가 실제 검사 의무와 캐시 재사용을 소유한다. 모델은 호출 전에 선택한 명령의 실제 부작용을 확인한다.

`managed_roots`는 정리를 허용할 수 있는 범위이며 등록만으로 삭제를 허용하지 않는다. 설치본·복구본·다른 작업의 입력은 보호 경로와 항목 참조에 반영한다. 프로젝트 밖의 백업은 소유가 확인된 별도 관리 디렉터리에 설정을 두고 다른 `project_id`로 등록한다. 각 등록 루트의 `managed_roots`는 그 루트 안의 상대 경로이며 루트 자체는 삭제하지 않는다. 한 설정에서 루트를 벗어나는 경로와 원격 환경은 지원하지 않는다.

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

생성 도구나 모델은 생성 근거를 확인한 항목을 `project_inventory`의 `register`로 등록한다. 항목에는 ID·경로·종류·소유자·생성 여부·사용/보호 확인 여부·참조를 명시한다. 확인 가능한 생성 시각·소스·버전·도구/캐시 형식·보존 사유도 함께 기록한다. 알 수 없는 값은 확인되지 않은 상태로 둔다.

기존 네이티브 설치의 백업 후보는 명시한 `deployment.json`에서 다음 명령으로 읽는다.

```powershell
node scripts/project-maintenance.cjs collect --native-install-receipt artifacts/deployments/DEPLOYMENT/deployment.json
```

`DEPLOYMENT`는 실제 소유자가 확인된 경로로 바꾼다. 과거 설치 영수증은 현재 사용·복구 참조를 증명하지 못하므로 수집 결과의 `protection_known`은 `false`다. 이 명령은 등록·삭제를 수행하지 않는다. 디렉터리 크기는 정밀 측정 전까지 미확인이다.

`project_cleanup_review`에서 선택한 항목을 갱신한다.

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

## 작업·버전 묶음 연결과 이전

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

대형 묶음은 한 호출 안에서64KiB이상 파일의 내용 SHA를 파일 ID·변경 버전으로 재사용한다. 작은 파일은 기존 전체 읽기를 유지하며, 다음 관리 호출에는 캐시를 이어 쓰지 않는다. 최적화 전환이나 중단 뒤에는 이미 저장된 삭제 결과를 유지하고 실제 남은 구성원만 다시 검토·적용한다. 완료된 항목을 다시 등록하거나 전체 삭제를 처음부터 반복하지 않는다. 잠금 복구는 해당 작업의 소유 PID와 모든 실제 삭제 child의 종료를 확인한 경우에만 해당 잠금으로 한정한다. `manifest.pending`이 남았거나 실제 결과가 불명확하면 먼저 그 상태를 복구하고 정상 manifest를 임의로 되돌리지 않는다.

소스 계약은 `node --test scripts/test-project-maintenance.cjs scripts/test-common-agent-instructions.cjs`, 지침 무결성은 `python -B scripts/import-instructions.py --check`로 확인한다. native 검사는 `scripts/check-project-maintenance.cjs`가 고정한 엔진 소스와 기존 Cargo 실행/캐시 경계를 사용한다. library·prompts·core 단계를 분리하며, 실제 실행 결과는 작업 기록에 둔다. 전체 앱 생성·설치·원격 검증은 이 명령의 소스 수용에 포함되지 않는다.
