# 구버전 관련 파일의 삭제 검토 후보

외부 설치 추가 정리 완료: 사용자 후속 승인에 따라 `C:/Users/felre/.vscode/extensions/azrael-ex-local.azrael-2026.0.4`, `.5`와 각각 연결된 `C:/Users/felre/AppData/Local/azrael-ex/releases/2026.0.4`, `.5` 네 경로를 일반 삭제했다. 현재 등록 `.7`, 직전 복구 `.6`, runtime·shortcut·process 참조 및 배포 manifest/installer 소유를 확인했고, 2026-10-15 09:57:27 UTC에 네 경로 모두 실제 부재를 확인했다(실제 exit0). 합계 4,959,791,279 논리 bytes이며 물리 회수량이 아니다. 기존 테스트 흔적은 대부분 의존성 배포 파일이므로 현재본의 vendored 테스트를 별도로 삭제하지 않았다. 공유 `extensions.json`·`.obsolete`와 사용자 설정·인증·대화는 보존했다. 아래 프로젝트 내부 9개 묶음의 검토·삭제 상태와는 별개다.

상태:9버전40경로의 실제 삭제·부재와9producer finalize를2026-10-15T15:28:51.625Z에 완료했다. 기존24결과를 보존하고 최적화본으로남은16개를 재개했으며 actualexit0/abortedfalse였다. Fresh native검토 합계19,612,284,780논리bytes는 실제디스크회수량이아니다. 아래이전metadata수치는당시관측이며최종fresh합계와구분한다.

2026-10-15 12:33:51–12:37:09 +09 전수 metadata 조사(198.49초, 4,823,125files, 오류0)를 재사용하고 프로젝트 내 설치 receipt·선택 포인터·프로세스·캐시 소유 참조를 제한적으로 갱신했다. 파일 hash/dedup·물리 회수 공간은 측정하지 않았다. 다른 사용자 프로필과 새 task tree는 baseline 밖이다.

각 receipt는 당시 hostInstalled=true로 기록됐으나 연결된 release 디렉터리가 현재 없다. package·로그가 남았다는 사실만으로 폐기를 확정하지 않는다. 아래 파일은 같은 버전의 검토 단위이며 version 문자열과 package 이름이 다른 경우도 실제 receipt 연결을 보존했다. 각 묶음은 전체 설치/롤백 참조와 입력·수용 근거를 확인한 뒤 모델이 삭제 또는 보류를 선택한다.

| 버전 | 관측 논리 bytes | 파일 수 | 판단 |
| --- | ---: | ---: | --- |
| `azrael_all_window_settings_20261006_r4` | 1,968,324,024 | 20,519 | 삭제 완료 |
| `codex_01601_all_20261006_r2` | 1,953,009,974 | 20,435 | 삭제 완료 |
| `integrated_latest_20261007_r2` | 1,962,825,131 | 20,499 | 삭제 완료 |
| `main_integrated_20261005_r1` | 1,957,465,153 | 20,436 | 삭제 완료 |
| `settings_all_20261005_r2` | 1,953,009,416 | 20,433 | 삭제 완료 |
| `turn_render_fix_20261006_r1` | 1,966,857,403 | 20,475 | 삭제 완료 |
| `use_control_settings_20261007_r2` | 1,967,039,268 | 20,508 | 삭제 완료 |
| `window_approval_20261007_r3` | 1,962,682,797 | 20,484 | 삭제 완료 |
| `window_overlay_20261007_r1` | 3,920,582,347 | 40,945 | 삭제 완료 |

## azrael_all_window_settings_20261006_r4

- 설치 receipt: `artifacts/deployments/independent-20261006-193231-841`
- package: `artifacts/deployments/deploy-azrael_all_window_settings_20261006_r4/package`
- 원시 로그: `artifacts/logs/azrael_all_window_settings_20261006_r4`, `artifacts/logs/deploy-azrael_all_window_settings_20261006_r4`
- 입력 보고서: `artifacts/logs/deploy-azrael_all_window_settings_20261006_r4/inputs-initial.json`
- 수용 근거: `artifacts/logs/verification-evidence/deploy-azrael_all_window_settings_20261006_r4/check-result.json`
- 미확인: referenced release directory. 원본 source snapshot의 정확한 경로·보존 상태를 별도로 확인한다.

## codex_01601_all_20261006_r2

- 설치 receipt: `artifacts/deployments/independent-20261006-161803-253`
- package: `artifacts/deployments/codex_01601_all_20261006_r3/package`
- 원시 로그: `artifacts/logs/codex_01601_all_20261006_r2`, `artifacts/logs/deploy-codex_01601_all_20261006_r2`
- 입력 보고서: 연결 미확인
- 수용 근거: 연결 미확인
- 미확인: referenced release directory; input metrics/report; acceptance reference; deploy log root unmeasured/absent. 원본 source snapshot의 정확한 경로·보존 상태를 별도로 확인한다.

## integrated_latest_20261007_r2

- 설치 receipt: `artifacts/deployments/independent-20261007-230631-133`
- package: `artifacts/deployments/manual-integrated_latest_20261007_r3/package`
- 원시 로그: `artifacts/logs/integrated_latest_20261007_r2`, `artifacts/logs/deploy-integrated_latest_20261007_r2`
- 입력 보고서: `artifacts/logs/deploy-integrated_latest_20261007_r2/inputs-initial.json`
- 수용 근거: 연결 미확인
- 미확인: referenced release directory; acceptance reference. 원본 source snapshot의 정확한 경로·보존 상태를 별도로 확인한다.

## main_integrated_20261005_r1

- 설치 receipt: `artifacts/deployments/independent-20261005-144926-264`
- package: `artifacts/deployments/header_startup_fixed_20261005_r2/package`
- 원시 로그: `artifacts/logs/main_integrated_20261005_r1`, `artifacts/logs/deploy-main_integrated_20261005_r1`
- 입력 보고서: `artifacts/logs/deploy-main_integrated_20261005_r1/inputs-initial.json`
- 수용 근거: 연결 미확인
- 미확인: referenced release directory; acceptance reference. 원본 source snapshot의 정확한 경로·보존 상태를 별도로 확인한다.

## settings_all_20261005_r2

- 설치 receipt: `artifacts/deployments/independent-20261005-181219-087`
- package: `artifacts/deployments/settings_startup_fixed_20261005_r6/package`
- 원시 로그: `artifacts/logs/settings_all_20261005_r2`, `artifacts/logs/deploy-settings_all_20261005_r2`
- 입력 보고서: 연결 미확인
- 수용 근거: 연결 미확인
- 미확인: referenced release directory; input metrics/report; acceptance reference; deploy log root unmeasured/absent. 원본 source snapshot의 정확한 경로·보존 상태를 별도로 확인한다.

## turn_render_fix_20261006_r1

- 설치 receipt: `artifacts/deployments/independent-20261006-224325-009`
- package: `artifacts/deployments/deploy-turn_render_fix_20261006_r1/package`
- 원시 로그: `artifacts/logs/turn_render_fix_20261006_r1`, `artifacts/logs/deploy-turn_render_fix_20261006_r1`
- 입력 보고서: `artifacts/logs/deploy-turn_render_fix_20261006_r1/inputs-initial.json`
- 수용 근거: `artifacts/logs/verification-evidence/deploy-turn_render_fix_20261006_r1/check-result.json`
- 미확인: referenced release directory. 원본 source snapshot의 정확한 경로·보존 상태를 별도로 확인한다.

## use_control_settings_20261007_r2

- 설치 receipt: `artifacts/deployments/independent-20261007-021553-916`
- package: `artifacts/deployments/deploy-use_control_settings_20261007_r2/package`
- 원시 로그: `artifacts/logs/use_control_settings_20261007_r2`, `artifacts/logs/deploy-use_control_settings_20261007_r2`
- 입력 보고서: `artifacts/logs/deploy-use_control_settings_20261007_r2/inputs-initial.json`
- 수용 근거: `artifacts/logs/verification-evidence/deploy-use_control_settings_20261007_r2/check-result.json`
- 미확인: referenced release directory. 원본 source snapshot의 정확한 경로·보존 상태를 별도로 확인한다.

## window_approval_20261007_r3

- 설치 receipt: `artifacts/deployments/independent-20261007-180433-608`
- package: `artifacts/deployments/manual-window_approval_20261007_r3_continue/package`
- 원시 로그: `artifacts/logs/window_approval_20261007_r3`, `artifacts/logs/deploy-window_approval_20261007_r3`
- 입력 보고서: `artifacts/logs/deploy-window_approval_20261007_r3/inputs-initial.json`
- 수용 근거: 연결 미확인
- 미확인: referenced release directory; acceptance reference. 원본 source snapshot의 정확한 경로·보존 상태를 별도로 확인한다.

## window_overlay_20261007_r1

- 설치 receipt: `artifacts/deployments/independent-20261007-152601-220`, `artifacts/deployments/independent-20261007-180228-802`
- package: `artifacts/deployments/deploy-window_overlay_20261007_r1/package`, `artifacts/deployments/manual-deferred_timer_hotfix_20261007_r5/package`
- 원시 로그: `artifacts/logs/window_overlay_20261007_r1`, `artifacts/logs/deploy-window_overlay_20261007_r1`
- 입력 보고서: `artifacts/logs/deploy-window_overlay_20261007_r1/inputs-initial.json`
- 수용 근거: `artifacts/logs/verification-evidence/deploy-window_overlay_20261007_r1/check-result.json`
- 미확인: referenced release directory. 원본 source snapshot의 정확한 경로·보존 상태를 별도로 확인한다.

## 보호 및 조사 한계

현재 설치 receipt는 `artifacts/w14w/artifacts/deployments/independent-20261014-141608-114/deployment.json`, 상태 installed-reload-required/hostInstalled=true다. 연결 release w14y는 baseline969,341,326bytes/499files이며 조사 시31개프로세스가참조했다. 현재/직전복구·latest선택·활성실행·공유cache소유를 먼저보호한다.

- `artifacts/w14w/artifacts/releases/w14y`
- `artifacts/w14w/artifacts/deployments/deploy-w14y/package`
- `artifacts/releases/all_changes_20261007_r6`
- `artifacts/releases/latest_20261008_r2`
- `artifacts/releases/window_observation_recovery_20261008_r1`
- `artifacts/logs/AF-01-resume-install`
- `artifacts/engine-input-AF01`
- `artifacts/source-snapshots/win06-integrated-r2`
- `artifacts/w14u/artifacts/releases/w14v`
- `artifacts/cache/modules/.projects.json`
- `engine/codex-rs/target`
- `artifacts/rt6/artifacts/releases/resume_timer_reconciliation_20261008_r7`
- `artifacts/w6a/artifacts/releases/w06-all-20261011-r5`
- `artifacts/wb1/artifacts/releases/windows_all_20261011_r3`
- `artifacts/w15a`
- `artifacts/w16a`
- `artifacts/w17a`
- `artifacts/w18a`
- `artifacts/w21a`
- `artifacts/w24a`
- `artifacts/w25a`
- `artifacts/w26a`
- `artifacts/w27a`
- `artifacts/w29a`

`artifacts/latest.json`의 isolated 선택, 현재 acceptance fixture/cleanup receipt, 새 migration/pilot/검증 run도 목적과 참조가 끝나기 전 보호한다. acceptance receipt와 실제 원본 경로가 일부 불일치하므로 tie-out 전 삭제하지 않는다. 캐시 target baseline448,576,264,109논리bytes/725,553files는 기존 cache owner가 관리하며 후보 용량에 더하지 않았다.

미측정 로그는 `artifacts/logs/deploy-codex_01601_all_20261006_r2`, `artifacts/logs/deploy-settings_all_20261005_r2`다. 그룹별 합계만 보존했으며 경로별byte분할을 새로 측정한 것이 아니다. 입력 보고서의 약341–345MB 값은 실제 input snapshot의 현재 존재나 물리 사용량이 아니다. 과거 관측치와 현재 보호 근거를 구분하고, 삭제 직전에 범위를 확정하여 다시 측정한다. 원시 scan의 필요한 근거는 이 문서에 보존했으며 원시 scan 파일이 삭제돼도 이 후보·한계는 유지된다.

## 추가 확인과 모델 결정 — 2026-10-15 08:10 UTC

사용자가 지금 삭제 가능한 후보를 삭제하도록 승인했다. 명시된 일반 VS Code 프로필에는 현재 Azrael 2026.0.7과 OpenAI 26.1007.21434의 실제 디렉터리·manifest가 있다. 현재 receipt가 기록한 직전 2026.0.6도 entrypoint·marker 및 참조한 w13b asset과 함께 존재한다. 2026.0.6을 이번에 다시 실행하지는 않았다. w14v는 25개 build-info 파일이 있고 포인터가 선택하지만 bounded 위치에 acceptance receipt가 없어 별도로 계속 보호한다. 현재 w14y의 실제 원 수용 결과는 `artifacts/w14w/artifacts/verification/AF01-host-r24/check-result.json`이며 passed=true, r25는 installed·byte verification exit0이다. 이전에 살핀 repository-root/log 대체 경로는 이 원 수용 결과의 경로가 아니었다.

후보의 과거 0.5.x 등록 디렉터리와 release 경로 9개는 없고 현재 latest가 선택하지 않는다. 08:07 프로세스 snapshot에서 후보 package 실행파일 참조도 없었다. 아홉 shortcut 백업은 현재 Desktop shortcut과 1,609bytes 및 SHA-256이 같고, 과거 registry 백업은 없는 0.5.x의 등록만 담으며 확장 디렉터리 사본은 없다. 과거 버전마다 package가 유일하다는 사실과 현재 필요한 유일한 복구본을 구분했다. 현재·직전 실제 복구 자료를 보존하면서 오래된 9그룹의 프로젝트 생성물을 삭제하기로 모델이 선택했다.

package만 지우고 형제 파일을 남기지 않도록 서로 다른 deployment parent 10개를 확인했다. 아홉 parent는 package/만 있으며 codex parent에는 state/도 있다. 해당 state는 config.toml의 model_catalog_json 키와 외부 현재 catalog와 SHA가 같은 catalog 두 파일(516,700bytes)이고 외부 원본은 유지한다. Native 등록은 이 10개 parent, receipt, 로그, 수용 근거를 해당 버전의 한 묶음으로 연결한다. 부재한 로그 두 경로는 부재 사실로 보존한다.

공유 입력과 실제 복구 경로는 삭제 묶음에서 제외한다.

- `engine`
- `artifacts/source-snapshots/window_overlay_engine_20261007/engine`
- `artifacts/upstream-ui/26.930.61225`
- `artifacts/upstream-ui/26.930.31730`
- `artifacts/build/codex0160-account-font-union-20261005-b`
- `artifacts/w14w/artifacts/deployments/independent-20261014-141608-114`
- `artifacts/w14w/artifacts/latest.json`
- `artifacts/w14u/artifacts/deployments/deploy-w14v`
- `artifacts/w14u/artifacts/latest.json`
- `artifacts/w13b/artifacts/deployments/deploy-w13e/package/stage-fc36b15b37ba4c59818227a0f1359a48/staging/openai.chatgpt-26.1007.21434-win32-x64/webview/assets/azrael-students`

외부 사용자 프로필·Desktop shortcut·외부 상태는 조회만 했으며 삭제하지 않는다. 정리 상태와 실제 잔여는 native 결과 수용 후 갱신한다. 기계가 읽을 최신 후보·보호·소속은 `artifacts/maintenance/BI-01-cleanup-candidates.json`에 유지한다.

09:14:13UTC 삭제 직전 참조 재확인: 지정프로필의 현재 등록은Azrael2026.0.7/OpenAI26.1007.21434,현재receipt의직전복구는완전한.6이다. AF01-host-r24 passed=true,현재/직전latest는w14y/w14v,루트별도latest는codex r15로 후보와 다르다. 후보10timestamp0.5경로는전부부재/미등록,528프로세스의지정21경로명령줄/실행경로스냅샷에서후보package/release/codexstate참조없음. 새로외부프로필2026.0.5완전디렉터리(미등록)를확인했으나timestamp후보와다르며외부원본이므로보호한다. w13b학생asset/current/previous실존재확인. 전체프로필/파일시스템전수조사결론이아닌지정경로의시점증거이며추가차단사유없음. 읽기전용검토자가결과만반환했고root가이현재work문서에승격했다.

## 현재 프로젝트 추가 조사와 정리

기존 AT-01의 2026-10-15 metadata 집계와 이번 lifecycle 71개 목록을 재사용했다. 현재 유지되는 다른 작업의 source/render evidence, retained session-stall/TPS와 BJ 공유엔진 수용 기록은 완료 label만으로 삭제하지 않는다. 패키징 준비본 rtp/rtp11/rtp12/rtp13 및 로그내부 대형 복사본3곳은 소유/reader/종료·복구 참조를 별도로 확인 중이다. 조사 범위는 Windows 로컬 프로젝트 생성물이며 engine 공유 Cargo cache·실제 소스·설치/복구본을 포함한 일괄 삭제가 아니다.

`artifacts/cache-scope-test-{9BTbYl,if5yD1,PomBCC,TZBz9u}` 네 폴더는 `scripts/test-asset-transform-cache.cjs:25`의 동적 fixture root와 하위 cache 구조가 일치한다. 같은 스크립트 26~30행이 원래 테스트 종료 시 제거하도록 소유한다. 경로·원본/관리 경계·실제 process 및 test producer 부재, 모든 하위 link/보호속성·파일종류를 재확인하고 해당 기존 fixture owner 절차의 PowerShell 일반 삭제를 사용했다. 네 경로 모두 실제 부재, 실행 exit0, producer record4개 finalized. 합계11,535,409논리 bytes/74files이며 실제 회수공간과 다르다. 이 구 경로는 현 native managed_roots 밖이므로 native apply를 호출하거나 루트 허용 범위를 변경하지 않았다.

`artifacts/cache-scope-test-V9zgLP`의 link는 생성 스크립트244~279행의 테스트 junction이고, 대상도 같은 fixture 내부 `link-target`임을 확인했다. `user-file.txt="preserve"`, `keep.txt="linked content"`도 생성 코드의 시험자료와 일치했다. exact junction만 비재귀 일반 삭제한 뒤 대상 파일이 그대로임을 확인하고, 링크가 없어진 전체 fixture를 기존 lifecycle cleanup adapter로 삭제했다(exit0, status=deleted/remaining=false, producer finalized). 35files/18,255,267논리 bytes이며 원래 metadata의 junction 경유 중복14bytes를 제외했다. 이로써 다섯 동적 fixture 모두 실제 부재다(합계29,790,676논리 bytes/109files). 원본 테스트 source와 제품 cache는 유지한다.

### 추가 대형 묶음의 모델 삭제 결정

`rtp`, `rtp11`, `rtp12`, `rtp13` 네 패키징 출력은 각각0.5.1791446551880/0.5.1791488220799/0.5.1791491963456/0.5.1791509017388이다. 각 preparation complete/passed와 unique VSIX를 확인했다. 현재 .7/직전 .6과 다른 출력이며 deployment/release 및 work/docs/scripts reader 검색에서 현재 소비자·latest/복구 선택을 발견하지 못했다. rtp11/12의 stateRoot는 skipSnapshot=true인 생성 입력 provenance다. 원본 rt6 r7/r11/r12 release·pristine UI·사용자 .azrael-ex는 유지한다. 과거 companion key가 사라져 exact 재생성은 보장되지 않지만 이 네 구출력을 현재 복구/수용에 보존해야 할 근거는 없다. 모델은 네 출력 전체와 rtp의 실패 deployment parent를 같은 소유 묶음으로 삭제 선택한다. 네 출력의 과거 합계7,814,688,660bytes는 오래된 논리 크기이며 실제 삭제 전 다시 측정한다.

rtp VSIX의 기록 SHA-256(새 hash 측정 아님)은 순서대로 `d1222422209145263170e5819ca944727c4c78b42d47502618fa25207bd6f22a`, `b8cecd6ab2d78695bbd008c29fd3c00387cac49554b3b96ce7ef17c07e8a7ca3`, `b515c45705e4faf6a7700be066c8f48ad771d9039d168dd191e4bc45aca739e1`, `5ea948cd8c2464f72c74afe120af8cf27b0e727cf0b430a9a3cbc7ee02b7adae`다. `independent-20261008-180909-813`은 hostInstalled=false/status=failed, Window Control runtime 검증 오류로 설치 전에 종료했다. 현재 남은 parent 구성은 deployment.json 한 파일뿐이고 registryBackup=null/previousOwnExtensionDirectories=[]다. 구 package와 이 불필요 receipt의 수명을 함께 끝내며 해당 실패 결과는 이 단락으로 보존한다.

UI pipeline benchmark는 `artifacts/logs/ui-pipeline-optimization` 전체를 한 종료 작업으로 묶는다. validation과 namespace-optimization의 script/cache/cold/warm/read-failure fixture 및 보고서를 함께 정리한다. 원본 UI 26.928.31416은 유지한다. 검증 commands의 ordered-reader/namespace-performance/full-tree/reportChecks 모두 exit0. 전체 source14,510files/362,832,478bytes, TypeScript5.9.3/SHA `3ae902c92cc44dace175c0e69e13a4b0899f6983c6121d76b9ab8dd5795e7675`. cold4=69,014.100ms/warm1=9,636.243ms/warm4=8,044.120ms, readFailure scheduled4/completed4/noCompletionReport=true, extraChecks/sourceHashOncePerAsset/sameRulesAcrossAllRuns=true와 exit0. 보존된 baseline output digest `660eb1e27f9882a4471afe38ff2f64e90fe7afad1ee56456d774bd1cae5314b8`는14,510files/362,769,766bytes이며 behaviorReportsEqual/metadataBytesEqual=true. 입력 copy/hash시간은 transform시간에서 제외되고 warm순서가 고정된 단일쌍이며 RSS는 peak가 아닌 endpoint다. 현재 전체 앱 속도 개선으로 일반화하지 않는다. namespace-performance-GMwH4G와 profile/baseline-warm 원래 fixture는 현재 부재다. 결과 근거를 여기에 독립 승격했으므로 모델은 이 종료 benchmark 묶음의 삭제를 선택한다.

나머지 `codex-stable-source-update/ui-full-source-v1`은 root integration review 종료·현재/복구 연결을 확인한 후 handoff4.3KB/source-hash435bytes 및 필요시 per-file provenance를 승격하는 조건으로 보류한다. `codex-0160-integration`은 accepted-input storage source c160_9와 연결된 입력/patch/download/native prerequisite 혼합이며 TLS follow-up이 pending/0tests다. 부모 전체는 보류하고 각 run/선행 다운로드의 대체 사본과 진단 종료를 확인한 뒤 재검토한다. 이름이 log라는 이유로 원본·필수 입력까지 삭제하지 않는다.

대형 보존 경계 재확인: `artifacts/verification/AK-02-api-context-fix/target`의 과거약44.1GB는 `work/AK-01-heretic2-api-validation/02-plan.md`가 여전히 구현/재현 검증 중이고 generation4 입력·독립 native build를 준비한 전용 cache다. 현재 작업의 불필요 후보로 삭제하지 않으며 해당 작업의 실제 종료·재현/후속검사 필요 및 cache owner 해제를 확인한 뒤 검토한다. 기존 엔진 공유target과 active w14w/w13b 등도 보존한다.

추가5묶음 실제삭제 완료: 2026-10-15T10:49:31.3478889Z~2026-10-15T10:51:23.6524641Z, adapter 실행 exit0,5groups모두deleted/6paths실제부재/producer5records finalized, errors없음. 새측정9,174,531,437논리bytes/125,577files이며 실제디스크회수량이 아니다. rt6원본·pristine UI·current/previous·인증/대화/설정은 보존했다. 실패deployment record와 namespace/validation raw근거도 출력본과 함께 삭제해 고립 로그를 남기지 않았다. 다섯 cache fixture29,790,676bytes를 포함한 이번 프로젝트 추가정리는9,204,322,113논리bytes다. 판정·실제결과·실행범위를 구분하며 source UI integration/TLS 혼합자료2곳은 retained/incomplete로 남긴다.

### 공개 배포 자산의 명시적 보존

설치본 .7/직전 .6과 공개 앱의 플랫폼별 release version은 같은 선택자가 아니다. 로컬 docs/ops/app-release.md와 각 assets manifest의 version을 대조한 아래 네 폴더는 published asset/검증·복구 소유를 유지한다. 새 네 producer record를 version:legacy-published-app:<version>:<platform>, owner=legacy-app-release-retention, state=retained/membership_complete=false로 연결했다. 이번에는 Native inventory에 파괴적 정리 대상으로 제출하거나 archive 본체를 다시 해시하지 않았다. 전체 형제 로그·공유 입력 소속이 미완결이므로 불확실한 버전 부모 삭제도 차단한다.

| 경로 | 버전/환경 | 보존 목적과 재검토 조건 |
| --- | --- | --- |
| artifacts/app-releases/2026.0.5 | 2026.0.5 Windows x64 | 로컬 문서가 지정한 현재 공개 Windows 자산·manifest·checksum과 preparation receipt. 후속 공개본/복구 선택 및 이 자산의 보존 목적 종료를 확인한 뒤 검토 |
| artifacts/app-releases/2026.0.5-darwin-arm64 | 2026.0.5 macOS ARM64 | 공개 Mac 자산·검증·설치/signing 근거. 대체 공개본과 복구·배포 archive 유지 조건을 확인한 뒤 검토 |
| artifacts/app-releases/2026.0.5-linux-x64 | 2026.0.5 Linux x64 | Linux 전체 수용 선행본. scoped hotfix .6이 전체 수용을 대체하지 않으므로 계속 보존 |
| artifacts/app-releases/2026.0.6-linux-x64 | 2026.0.6 Linux x64 | 공개 context hotfix immutable 자산. 후속 공개본 및 한정 수용/복구 요구가 해제된 뒤 검토 |

이는 로컬 기록과 manifest의 일치를 확인한 보존 결정이며 원격 GitHub 현황·새 설치·다른 OS 재검증을 수행했다는 뜻은 아니다. scripts/azrael-app-release.json의 현재 작업 버전은 .8이지만 이 설정값만으로 기존 공개본의 보존 조건이 끝났다고 판단하지 않는다. 나머지 오래된 app-releases 부모도 자동 삭제하지 않고 개별 publication/retention 근거 확인을 남긴다.

### 추가 로그4곳의 분류와 종료된 mock 실행

제한 read-only 조사에서 durable-active-account는 host 통과 외 engine 실패/선택12pass가 혼합되고 전체 exit가 없다. host fixture 476,917,362bytes는 producer/최종 진단·고정입력 종료를 확인할 때까지 같은 작업과 보존한다. session-completion-20261005는 host-recovery의 patch mismatch/UI baseline gaps와 346,324,342bytes corrected log, companion-recovery/baseline-backup 5,494,266bytes를 보존한다. input-loss-fix-20261002의 format-lint/backup 네 snapshot은8,837files byte-restore 근거가 있으나 실제 백업/대체본 확인이 미완결이다. worktree-integration-20261005의 source ZIP과 .159.3/il2/sd/stall-diag delta는 각각592/78/300/291개 변경분의 대체 복구본을 확인하기 전 보존한다. 모든 크기는 앞선 AT metadata의 비원자적 논리값이고 새 측정/회수량이 아니다.

각 미결 범위는 work:legacy-{durable-account,input-loss,worktree-integration,session-completion}-review retained/incomplete로 등록했다. Session은 독립 완료 run9개와 소유를 중복하지 않도록 나머지 top-level 자료, 실패·부분run2곳 및 공유 진단 로그6파일만 보존 멤버로 기록한다. 보류 해제는 engine/TLS/patch·인계 진단 종료, 고정 입력 및 실제 현재·복구 reader 해제와 대체 백업 검증이다. 이름이 log라는 이유로 백업/필수 입력을 지우지 않는다.

Session의 finish-changed-mock에는 독립 UUID run11개가 있으며 9개 results.json에서 총87case 모두 passed=true, child exit0/1의 예상 성공·실패 단언이 기록됐다. producer 전체 exit는 원래 receipt에 없으므로 null/미확인으로 보존하고 현재 코드 통과로 재사용하지 않는다. 나머지6e041d5394554dc1bf3465e5ea4f584c는 source argv 불일치 실패, b7594eb591ca45c0ab98d51124746ca8는 final report가 없어 보류한다. 후속 writer는 새 deploy-checks run으로 이전해 새 실행이 과거 폴더를 다시 쓰지 않는다. 2026-10-15T11:24:17.1953124Z의481process 지정9경로 조회에서 실행파일/명령줄 참조를 찾지 못했다. 기존 구버전40경로와 비중첩이다. 이9개는 각각 별도 실행·합성 fixture만 가진 정리 후보로 fresh native 검토 중이다.

| 독립 완료 run | 과거 통과 case 수 | results.json SHA-256 |
| --- | ---: | --- |
| 0bb89fe9f5424405894b88e7def3c59b | 10 | 5156e99c72b4a99a746e444fc6036c2a0b88e2098d542016c7a6dc62364d0b9b |
| 369702c5cda747d3b11d8f795b143d30 | 9 | 16c5f27fc603e80ab9e5baf1ad4b8a1405e1106f56ca6a052d5f995c321bf91c |
| 3e3cdb5e84884875a8926ec8f9745f37 | 10 | e113f3bdd38777b519a7c81bc8f56dee8e8c8739dbba2bc493f8b40291c2ac6c |
| 793c0101050b457284dd6dfaf60d07bc | 10 | 98f2ed12e663233a99fea13b14b6e5c80f9910fb9b7eda782d8b95efff5b1c8c |
| 8e8baa5f035e4f67874d9941afc3c3ba | 10 | 47e11b7111afc15d63d851ac38f4b11fca1e64c748d2e37d6ba4abdd724b513e |
| 9eee1e8f64d84baa801e42716b38be0b | 9 | 6b95584634cc839133e9cef002d0f4d94817fe65844b3a1de8455af016712d18 |
| cfd05b305c00415489950e80ab011407 | 9 | 7d062966e7f3b75782602b1b5efa34e4f979c45b62269ca798d8572b12f2bcc8 |
| e69898a36ce347618ecc57f5afe20988 | 10 | 669f45c3595c71e5e5fd45b77131ff8565e83b00726dc4a3107f0976a55dff3f |
| ed8862dbbf0d4a939d33f8bef6899a4a | 10 | b31bb0c4fb06f7eea28837a1dc449cb9b41d3e3e5eb99e75dda0ccd4fc9d348c |

완결9run의 fresh native register64.848초/review31.072초는 실제exit0,9항목/blockers없음/합계11,692,799논리bytes였다. 필요한 결과를 위 표에 승격했으므로 모델은 독립9run 전체delete를 선택했다. 실제 적용은 현재 실행 중인 구버전40경로 apply의 동일store 잠금 뒤에 직렬 수행하고, 적용 직전 참조/identity를 다시 확인한다. 삭제 완료/부재/finalize는 아직 보고하지 않는다.

### 사용자 기준 완화 후 추가 실제 정리

사용자는 보존할 조건이 없어 보이는 묶음을 추가 증명 때문에 오래 보류하지 말고 바로 삭제하도록 지시했다. 과거 final exit 부재만으로 테스트 복사본을 계속 보존하던 결정을 수정했다. Root가 UI handoff의 source port/delegated acceptance 완료와 원본 UI 보존, 직접 reader 부재를 검토해 임시 root-review를 종료했다. `codex-stable-source-update/ui-full-source-v1`의 19,382files/1,416,326,240논리bytes와 `durable-active-account`의 8,429files/477,012,653논리bytes를 삭제했고 실제 부재와 두 lifecycle finalized를 확인했다. 합계1,893,338,893논리bytes이며 물리 회수량이 아니다. UI handoff/provenance/작은 검사 로그와 pristine UI는 유지한다. Durable host passed=true와 engine의 혼합 결과·전체exit 미확인 한계는01-plan.md에 승격했다.

12:04:56UTC UI 일반 삭제는 ReadOnly 때문에 부분 실패했다. playbook의 확인된 생성물 속성 정상화 절차로26개 파일의 ReadOnly/Hidden만 변경하고 같은 PowerShell adapter로 재개하여 삭제/finalize했다. 이후 결과 배열 기록 오류가 있었지만 payload와 lifecycle record의 실제 부재를 별도로 확인했고, 수집 코드를 고쳐 다음 묶음을 실행했다. Durable은12:06:05.019~12:06:12.270UTC deleted/remaining=false/finalized, 최종 script exit0. force/System/ACL/소유권 변경은 없다.

추가 공개 archive .0–.3 감사에서는 ZIP4개가 선행 AT-01 정리로 이미 부재임을 확인했다. 원격 exact GitHub tag4개의 공개 metadata는 local 기록 size/digest와 일치하지만 새 payload 검증/복구 수용은 아니다. 작은 manifest/checksum/receipt의 기존 보존 결정을 유지하며 이 이미 끝난 삭제의 크기를 이번 결과에 가산하지 않는다.

추가 임시프로필4곳 `artifacts/fixtures/{opencodex-helper-bundle-final2,opencodex-helper-smoke,opencodex-home-reject,provider-release-check-probe-20260916}`도 reader/프로세스 참조가 없고 테스트 fixture 소유 경계가 명확해 즉시 정리했다. 12:07:18.843~12:07:29.577UTC ordinary삭제, 네 경로 모두 실제부재/producer finalized/최종exit0. 두 곳은 빈 디렉터리, 나머지4files/3,333논리bytes다. 실제 사용자 홈을 건드리지 않고 fixture 내부의 인증 사본/시험자료 잔여만 제거했다.

종료된 최적화 로그 추가정리: `legacy-build-test-optimization-baseline`, `legacy-build-test-optimization-plan`, `legacy-build-test-optimization-validation`, `build-test-reduction` 네 부모와 `test-reduction`의 native 제외6항목(legacy-cleanup/removal/selection/두 cargo-cache 로그/final-summary)을 같은 소유 묶음으로 삭제했다. 2026-10-15T12:30:39.1649336Z~12:30:53.1939374Z, actualexit0/568,317논리bytes/126files/10paths전부부재/producer finalized. 현재 reader가 있는 `test-reduction/native`는 그대로 존재한다. 과거 final-summary(commit84c8abe6)의 검증 범위·실제미수행과 legacy cleanup의 결과/캐시보존은01-plan.md에 승격했다. 원시 보고서와 일회runner를 남기거나 과거 삭제1.98GB를 이번 용량에 중복 가산하지 않는다.

완결 mock9run은 native apply640.487초/actualexit0,9항목 모두deleted/remaining=false,실제9경로부재와producer finalized를 확인했다. fresh검토의11,692,799논리bytes를 완료값으로 반영한다. 자체deploy-writer검증 묶음도14:12:28.662~14:12:33.441UTC 기존owner adapter로 ordinary삭제/부재/finalize했다(899,796논리bytes/453files/exit0). 합성.git의Hidden은확인된테스트생성물에한해정상화했고path·전후속성receipt를남겼다. 남은주요삭제는구버전16경로이며,사용자가요청한성능개선검증후기존24삭제기록을유지해재개한다.

최종 구버전 정리: 9그룹40경로전부부재,9producer finalized. 재개apply3,798.669초/actualexit0/16results deleted·remainingfalse, 완료2026-10-15T15:28:51.625Z. 일회성 검증/전환시간을 제외한 실제재개apply시간이며 기존전체입력과동등비교한속도개선율은미측정이다. 모든프로젝트파일을삭제가능으로판정한것은아니며 위명확한소스·진단/복구/활성참조는보존한다.
