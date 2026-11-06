상태: 개선 구현·Windows 자동 검사·실제 입력 준비 검증 완료. 일회성 산출물 정리 중.

# 고정 입력 준비 축소 검토

## 요청과 범위
새 고정 입력 준비의 중복 읽기와 테스트 반복을 줄이는 권장안을 사용자가 승인했다. 기존 재사용 API와 소비자 계약을 유지하고 같은 실행의 엔진 사전검증을 복사 전 기준으로 재사용한다. 코드·관련 테스트·소유 문서 변경, 필요한 Windows 검사와 산출물 정리를 수행한다. 제품 빌드·설치·기존 실행 재시작은 하지 않는다. 공통 준비 로직이 대상이며 실측·검증 환경은 Windows x64이다. Linux/macOS 성능과 호환성은 검증하지 않았다.

## 실측 근거
artifacts/tasks/EU01-install-014/runs/freeze-resume-ao/reports/deployment-inputs.json의 timings 기준 전체 872.692초. 원본 스냅샷 9.360초, 엔진 사전검증 74.911초, 고정본 Git 준비 77.198초, 고정본 캡처 219.563초, 작업본 Git 준비 17.904초, 작업본 캡처 223.820초, 엔진 고정 검증 179.447초, 최종 전체 목록 17.198초. 명명된 단계 외 약 53.291초는 별도 세분화되지 않았다. 캡처 내부 순수 copy 구간 합계 386.583초이며 경로·파일 정체성 검사도 포함하므로 순수 디스크 전송 시간은 아니다. 고정본 재스냅샷은 기존 캡처 결과를 재사용해 사실상 0초이다.
준비 함수는 테스트를 실행하지 않는다. 같은 실행에 앞서 붙은 read_only_ 네이티브 2개 검사는 이번 수정 확인용으로 198.509초였으며 입력 준비의 상시 절차로 추가할 근거는 없다.

## 남길 과정과 변경 제안
1. 현재 입력·출처와 변경 범위 선택, 실제 소비자에 필요한 도구·fixture 확인, 실행 소유권·경로·참조 확보를 남긴다.
2. 입력 불변이면 reuseDeploymentInputs, 기존 최상위 scripts 파일 교체면 script-delta, 준비된 제품의 패키징이면 preparePackagingWorkspace를 먼저 선택한다. 원본 엔진 수정 등 현재 지원 밖 변경에만 전체 준비를 사용한다. 이번 건은 엔진 소스 수정이 있어 기존 script-delta 적용 대상이 아니었다.
3. 새 전체 준비에서는 고정본과 독립 작업본, 선택된 바이트와 출력의 동일성, 엔진 출처, manifest 및 소유권을 유지한다. 두 사본의 하나를 곧바로 없애면 원본과 실행용 변경 영역의 분리 및 기존 소비자 계약이 바뀐다.
4. 엔진 사전검증 1회와 고정 구간 4회 중, 같은 원본을 다시 읽는 복사 직전 호출을 사전검증 결과로 대체한다(전체 5→4회). 원본 루트를 사전검증 전에 pin하고 직후·고정 검증 전·원본 사후 검증 후 identity를 확인한다. 원본의 사후 확인과 두 사본의 독립 검증을 유지한다. 서로 다른 파일시스템 관측의 해시를 Python 출처 검증에 전달해 신뢰하게 하는 새 캐시 대신 기존 검증 결과의 같은 실행 내 재사용을 선택했다. 캡처와 출처 검증의 나머지 읽기를 합치는 변경은 이번 구현에 포함하지 않는다. 이는 단순한 검사 삭제보다 작은 변경으로 기존 출처 조건을 보존한다.
5. 최초 전체 source snapshot은 주로 Git 준비와 선택 목록에 쓰인다. 최종 캡처는 별도로 선택·검증하므로 최초 단계를 목록 조회로 좁히는 후보지만 실측 상한이 약 9초라 후순위이다.
6. 전체 Git/문서 입력 축소는 downstream 의존성 계약 확인 후 별도 변경으로 제안한다. 현재 테스트가 docs 포함을 명시하고 있어 임의 제외하지 않는다.

## 테스트 유지·축소 제안
- 남김: 추적/미추적/삭제/중첩 입력 반영, 고정 입력 선택 및 캐시 소유자·실행 참조 전달, script-delta/재사용 분기. 이후 빌드 호출부를 수정하며 다시 빠뜨릴 수 있는 설정과 입력이다. 중복 검출은 추가하지 않는다.
- 남김 후보: 경로 최적화로 부모 정체성·링크 확인을 생략하거나 출력 덮어쓰기를 허용하는 편집을 검출하는 최소 사례. 중요성만으로 모든 경계 조합을 영구 유지하지 않는다.
- 축소: test-capture-project-inputs.cjs의 전체 케이스를 smallFileMaxBytes 128KiB/0 두 모드로 반복하는 구조. 모드 독립인 선택·CLI·소유권 사례는 한 번, 모드에 따라 달라지는 읽기·변경 감지 사례만 양쪽 실행한다.
- 제거/일회성 전환 후보: physical root resolves once per parent inspection의 rootCalls==2, chmod 디렉터리 호출 횟수==1, 같은 테스트 파일의 node --check 반복. 권한 보존 등 결과 검사는 별도로 판단한다.
- snapshot 병렬도 1/2/8/16 반복은 성능 변경 시 일회성 확인 후보이며 최소 직렬/병렬 비교 유지 여부를 재발 경로로 결정한다.
- 테스트 제거로 14분 33초의 입력 준비가 직접 단축되지는 않는다. 유지 여부와 전체 소스 검사 비용은 별도이다. 삭제 확정 개수와 절감 시간은 아직 없다.

## 검증과 성공 기준
진행 중인 빌드 입력은 변경하지 않는다. 소유 문서 docs/playbooks/build.md 및 docs/architecture/project-maintenance.md, scripts/azrael-feature-contracts.json과 소비자 계약을 함께 확인한다. 선택된 동일 입력의 산출 바이트·출처·환경·소유권이 보존되는지 최소 기존 사례로 확인하고, 실제 Windows 입력 준비 전체 경과와 각 단계를 비교한다. 다른 플랫폼은 실제 실행 근거 없이 통과로 보고하지 않는다. 재사용 경로는 적용 가능한 변경 범위만 허용하며 재실행 성공 결과와 입력 불변 증거를 혼동하지 않는다.

## 조사한 구현
scripts/deployment-workspace.cjs: prepareDeploymentWorkspace, verifyDeploymentWorkspace, reuseDeploymentInputs, prepareDerivedDeploymentWorkspace.
scripts/capture-project-inputs.cjs: captureProject와 최종 snapshotProject.
scripts/engine-provenance.py: snapshot.
scripts/test-capture-project-inputs.cjs, scripts/test-deployment-input-snapshot.cjs, scripts/test-deployment-workspace.cjs.
## 구현 책임과 진행
Root는 deployment-workspace.cjs의 사전검증 재사용·identity 보강, 운영·설계 문서, 통합 검증·정리·커밋을 담당한다. 독립 테스트 축소는 trim_input_tests 소유자가 test-capture-project-inputs.cjs와 test-deployment-input-snapshot.cjs에서 완료했고 두 파일의 syntax check는 exit 0이다. Root는 test-deployment-workspace.cjs 기존 사례에 동일 바이트 원본 루트 교체 거절을 추가했다. 다음 작업에서 성능 단순화로 root identity 비교를 빼는 구체적인 재발 경로를 막는다. 보존 inventory의 기존 tool.project-maintenance/writers 연결을 유지하며 새 필수 검사 파일은 추가하지 않는다.

Windows 캡처 13개 사례와 snapshot 9개 사례는 verify-a에서 각각 exit 0이다. 초기 작업공간 검사는 새 root-swap fixture의 출처 도구 누락으로 exit 1이었으며 fixture를 고쳤다. 최종 작업공간 검사는 final-a에서 16개 계약 묶음을 통과했고, 외부 observer가 프로세스 41132의 handle을 종료까지 유지하여 실제 exit 0을 확인했다(13:46:56 KST). 출처 도구 bytes가 달라지면 고정된 도구로 복사 전 검증을 새로 수행하는 fallback도 포함한다. 기존 세 검사 소스의 수정 시각은 각각의 실행 전이며 최종 hash는 03-verification.json에 보존한다.

measure-a는 출력이 자기 run 소유 경계와 겹쳐 복사 전에 거절됐다(exit 1). final-a의 controller에는 trackChild 호출 오타가 있었으며 사용자 중단 뒤 최종 영수증과 terminal exit 관측이 유실됐다. 작업공간 child의 exit 0 증거는 독립 보존하고 측정 자체는 unknown/null로 유지한다. 재개 후 실행 코드의 제한된 자식 실행 종류와 현재 전체 프로세스 관측을 대조해 기존 producer tree의 종료를 확인했다. close/recover-cleanup 지원 API로 실행 참조만 해제하고 실제 생성물이 기존 run root에 포함됨을 조정했다. 종료·복구 근거는 05-interrupted-producer-stop.json과 06-cleanup-recovery.json이며 결과를 성공으로 바꾸지 않았다.

중단 직전에 적용된 junction teardown은 재개 후 문법을 확인하고 verify-junction-b에서 13개 사례를 재실행해 exit 0을 확인했다(21:20 KST, 약 20.9초). 기존 verify-a fixture의 의도적 junction 두 개도 기존 test owner의 비재귀 삭제 방식으로 제거하고 대상 파일 해시가 유지됨을 확인했다(04-fixture-link-retirement.json). 검증 시점 이후 네 관련 소스의 hash는 03-verification.json과 일치한다.

완료 영수증을 남기는 수정된 controller의 measure-c는 21:32:56~21:48:10 KST에 exit 0으로 완료됐다(managed work ID 4dadf56d-5ea8-4f7c-8615-17435a2217e5). 고정 입력 재검증과 준비 후 검증을 포함한 전체는 15분14.7초, 준비 자체는 13분5.1초였다. 26,211개 파일/579,309,468 bytes의 project SHA와 엔진 출처가 원본 고정 입력과 일치했고 실행 중 구현 hash도 유지됐다. 제품 빌드·설치는 수행하지 않았다. 독립적으로 읽을 수 있는 완료 영수증은 07-measurement.json에 보존했다.

이전 준비 14분32.7초 대비 관측 차이는 약 1분27.6초다. 출력 경로·fixture catalog·캐시·부하가 달라 이를 순수 코드 개선율로 해석하지 않는다. 불변 사본 캡처는 약 4분27초, 작업 사본 캡처는 약 4분19초로 두 캡처의 비용이 여전히 크다. 검증 도구가 같은 경우 전체 엔진 출처 관측을 5회에서 4회로 줄인 것이 이번 코드 변경의 범위다.

정리는 설치된 maintenance_owner SHA f167e9bdb5c3cd5ea796417ddb7bbd89d9bea1322a369f9de89b5c63bd53cc76으로 수행한다. measure-a와 verify-a의 등록은 완료됐다. final-a 등록의 commit 시점이 measure-c 시작에 따른 catalog 쓰기와 겹쳐 pre-intent reservation이 보존됐다(native registration controller exit 1). 예약 owner PID 39764의 동기 native 호출 종료 근거를 08-reservation-producer-stop.json으로 고정하고, 측정 종료 후 같은 owner의 recover_reservation으로 정확한 SHA/token/fence를 검증해 해제했다(exit 0, reservation_recovered, execution_outcome_changed:false, 예약 실제 부재 확인). 이후 정리는 직렬 수행하며 점유 잠금이나 예약 파일을 수동 삭제하지 않는다.

삭제 전 fresh review·토큰과 실제 결과를 확인한다. 이미 등록된 measure-a/verify-a는 내용이 같으므로 재등록·재해시하지 않는다. 미등록 final-a, verify-junction-b, measure-c만 실제 종료·membership 확인 후 등록한다. 원시 로그와 fixture는 필요한 결과를 본 기록/03-verification.json에 보존한 뒤 owner 절차로 삭제한다. 코드·문서 여러 파일에는 기존 작업의 큰 미커밋 변경이 있고 별도 staged 변경 23개도 존재해, 타 작업을 섞는 커밋은 하지 않는다.

## ?? ? ?? ?? ??
?? ??? primary maintenance owner PID 39916? ?? ???? handle? ??? ????. ? ?? ?? ??(PID 25060)? ?? ?? ?? 09-reservation-producer-stop.json? ???? recover_reservation exit 0?? ????. ?? catalog ?? ???? ??? ? ?? ?????? ??? 02-cleanup.json? ????. ? ? ???? ??? ???? ???? ????. ?? primary catalog ?? helper? ?? ?? ??? ? ?? lock_wait_ms:5000?? ??? ?????. archive ?? root? ?? ??? ????? ???? ???. ??? ? ?? hash? diff check? ?? ??? ????.

## ??
2026-11-01 23:13 KST ?? ??? ???Windows ????? ?? ?????? ????. ?? ??? fresh review? exit 0??? 5? ??? blocker? ???. owner apply? 22:25:46~23:12:52 KST(47? 6?), exit 0, ?? ?? deleted/remaining:false?. ?? ? ?? ??? contained PowerShell worker?? ????? parent ?? ????? ??? ???? ???. 2,996,919,175 bytes? ?? ?? ???? ?? ?????, 5? root? lstat ENOENT? lifecycle.finalize status finalized? ????. ?? ?? ??? bytes? ?????. ?? ??? ?? ?? ??????archive ??? ???? ???. ?? ??/??/?? ???? ? ?? ??? ???.
???? capture 13, snapshot 9, workspace 16 ?? ?? ?? ?? exit 0??, ?? 4? ?? hash? ?? ??? ????. ?? ??? Windows x64?? ?? ?????? ?? ???? ???? ???. ?? unknown/null ??? ???? ??? ???. ?? ??? ??? ????? ? ??? staged ??? ?? ?? ?? ??? ??? ??? index? ????.
