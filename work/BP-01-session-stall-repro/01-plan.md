상태: 권장 개선 구현과 Windows x64 검증 통과. 새 테스트 프로필·엔진 번들·입력02 정리 완료. 설치·실 사용자 데이터 수정은 범위 밖이다. 기존 조사 프로필과 입력01은 아래 정리 제한으로 남아 있다. 작업 범위만 분리해 커밋한다.

# 목표와 권한
세션 01a13abe-1c9a-77c0-9663-5bb413752cb6의 격리 재현에서 확인한 누락된 도구 결과 복구와 턴 panic 종료 처리를 개선한다. 사용자의 권장안 실행 지시로 제품 코드·회귀 테스트·소유 문서 수정을 진행한다. 전체 제품 빌드·설치·실 사용자 데이터 변경은 범위 밖이다. 필요한 native 검증용 컴파일은 수행한다.

# 범위와 방법
공통 엔진 준비 경로를 조사하되 실제 실행은 Windows x64 로컬 w14y 배포본이다. 다른 OS 수용은 주장하지 않는다. 원본 rollout SHA-256을 기록하고 복사본을 격리 CODEX_HOME·workspace·TEMP에서 사용한다. 자격 증명을 복사하지 않는다. 루프백 Responses 서버로 요청 도달을 관찰하고 도구 호출을 반환하지 않는다.
원본 그대로와 좁힌 입력의 대조 재현 근거를 재사용한다. root는 panic boundary·호스트 명시 재개·문서·통합 검증, normalize_recovery 담당은 normalize.rs와 history_tests.rs만 소유한다. 두 구현이 준비되면 불변 입력을 생성해 공용 Cargo cache를 사용하는 검증을 직렬 실행한다. 새 실험도 test-owned 엔진만 종료한다.

# 산출물과 정리
artifacts/verification/session-stall-20261015: 테스트 스크립트, 프로필, DB, 임시 작업 공간 및 원본 복사본. 실행 전 manifest에 절대경로·존재 여부·바이너리 hash·소유 프로세스를 기록한다.
artifacts/logs/session-stall-20261015: 내용 없는 단계 로그·결과·입력 hash와 compact 진단. 재현 후 복제 프로필과 실행 부산물을 일반 삭제하고 부재 확인. 재현 도구·compact 결과만 필요한 근거로 보존한다.

# 성공 기준
격리 프로필의 실제 native resume/start에서 정체 또는 정상 완료를 관찰하고 모델 요청 도달·턴 종료·deadline을 구분한다. 원인 확정과 가설을 분리하며 복구/제품 수정안의 영향과 검증을 제시한다. 원본 입력을 변경하지 않고 테스트 소유 프로세스 종료·프로필 정리를 확인한다.

# 개선 구현과 검증
- 결과 없는 custom/local-shell 호출은 내용 없는 고정 warning 후 기존 deterministic synthetic `aborted` 출력으로 prompt 복사본만 정상화한다. 원본 이력과 orphan-output 불변 조건을 유지한다.
- task future 생성·실행을 unwind 경계로 감싸고, panic을 payload 없는 `Fatal error: session task panicked`로 기존 종료 경로에 전달한다. 취소가 이미 요청된 경우 중단 소유자가 terminal을 확정한다. 정상 종료 경로에서 처리하는 계정 lease·active task·done notify를 보존한다.
- 호스트는 이 정확한 native 오류에 한해 사용자 명시 재개를 허용한다. 오류 알림만으로 재시도하지 않으며 live attach, 결과 불명 receipt와 중복 요청 보호를 유지한다.
- normalize_recovery 담당은 두 normalize 소유 파일을 변경하고 scoped rustfmt/diff-check exit0으로 인계했다. root는 panic boundary와 독립 `tasks/panic_tests.rs`, 호스트·문서·등록을 소유한다. 지원 의미는 공통이며 실제 이번 검증은 Windows x64이다.
- 호스트 첫 검사에서 `terminalErrors` 배열 맨 앞 추가가 기존 인덱스 기반 fixture 선택을 이동시켜 실패했다. 새 항목을 끝으로 이동해 fixture 의미를 복구했다. r2 `recovery-host-tests-r2.log` 357/357 pass, 실제 exit0. 정확한 native panic 문자열, 유사 문자열 거부, 명시 재개·중복 요청·기존 receipt 보호를 검사한다.
- feature 등록 첫 검사는 fixture 없는 Cargo wrapper에 fixture용 nativeCacheInputs를 적용해 실패했다. 해당 옵트인 cache 설정을 제거했고 두 소유 feature manifest 검증 exit0이다. feature-preservation 도구 회귀 13/13 pass, exit0(`fix-feature-tests.log`).
- native 고정 입력 `artifacts/verification/BP-01-recovery-fix-input01/engine`, 10,788파일, filesystem inventory SHA-256 `1f802178cb47a51be0072c6d50fdbddb0440aa6ec5425aaf059db3987a7ffa45`; 전체 영수증 `fix-input01.json`. 생성 뒤 내용을 갱신하지 않는다. build-info provenance의 배포 수용과 구분되는 test-only input이다.
- `verify-fix.ps1`은 Rust1.95/Windows x64 MSVC, primary Cargo cache, jobs2, incremental0, RUST_MIN_STACK33554432로 `check-task-recovery-native.cjs`를 실행한다. 첫 실행은 완료됐으며 `fix-native01.log`와 terminal result JSON이 실제 결과를 소유한다. 전체 앱 빌드·설치나 실제 모델 호출은 없다.

- input01 native 검사 2026-10-15T10:43:55Z~11:01:57Z, wrapper exit0이나 잘못된 namespace의 첫 두 필터가 0개를 선택해 전체 통과로 인정하지 않았다. 실제 실행된 task panic 2개와 기존 tasks 11개는 통과했다. 같은 libtest 실행 파일에 올바른 이름으로 직접 실행한 누락 output 검사 4개는 pass/exit0이다.
- 신규 prompt/raw-history 검사는 기존 user metadata 변환을 기대값에 빠뜨려 exit101이었다. 제품 구현 변경 없이 기대값에 `unknown_content_metadata()`를 반영했다. 영구 checker는 실제 `context_manager::history::tests` 경로와 양수 테스트 개수 검사를 사용한다.
- 수정 검사 입력02는 input01 복사본에 해당 테스트 파일 수정만 반영했다. SHA-256 `0a8b93c00b9592def49707b5de49bc87d7eba671c3b1d82885eb872f720e21e6`, 10,788파일. `verify-fix02.ps1`, `fix-native02.log` 및 terminal result가 결과를 소유한다. input01은 갱신하지 않았다.
- native 후 테스트 엔진/bridge만 입력02에서 빌드하고 pinned code-mode host를 재사용한다. `reproduce-fixed.py`는 수정하지 않은 원본 rollout 복사본의 연속 두 입력, 두 모델 요청에서 같은 과거 call과 synthetic `aborted` 출력 각 1개, 원본 hash 불변, panic 부재를 검사한다. 실제 계정·설치 host 검증은 포함하지 않는다.

- input02 native 실행 11:07:53Z~11:22:10Z, 실제 exit0. 결과 누락 4개, prompt/raw-history 1개, task panic/중단 2개, 기존 task lifecycle 11개로 총 18/18 통과했다. 0-test 거부와 양수 선택 수용은 `checker-contract-result.json`에 별도 fixture 검증했다.
- 테스트 엔진/bridge 빌드 11:22:11Z~11:33:18Z, exit0. 엔진 SHA-256 `4a65400c3d5568fb102c1abfd567294e6ebe6e24c5a592b655ef55596e6f8c3c`, bridge `e2bc80ec9d84fc74a136182ecc2e8e25069c133e0a0dd0d4849a69cfdf2431c1`. code-mode host는 기존 w14y의 `ec91f7a04dcb1a36f0e2ed87885777bf78900c2ea3295e82621c5721fd5d9f41`을 재사용했으며 새로 빌드하지 않았다. 전체 앱 패키징·설치는 하지 않았다.
- `fixed-raw`: 수정하지 않은 원본 rollout 복사본이 첫 입력 8.406초에 완료됐고 같은 세션 두 번째 입력도 완료됐다. 모델 요청 두 건 모두 과거 대상 call과 synthetic `aborted` output 각 1개를 포함했다. 원본 hash 불변, native panic 없음, engine exit0 및 runner exit0. 루프백 모델이 도구를 반환하지 않으며 도구 재실행은 없었다. 실제 계정·설치 VS Code UI를 통과했다고 주장하지 않는다.
- native 완료 이벤트 다음 테스트 빌드를 즉시 시작한 pipeline은 11:12:59Z~11:33:35Z, exit0이다. 앞선 native 실행과 시간을 합산하지 않는다. 실제 결과는 `fix-native02-result.json`, `fix-fixture-build02-result.json`, `fixed-raw-result.json`, `fix-pipeline02-result.json`에 보존한다.

- 빌드 후 입력02 inventory를 다시 계산해 시작 hash와 동일함을 확인했다. primary의 normalize/history-tests/task boundary/panic-tests 네 파일도 해당 입력과 byte 단위로 동일했다(`fix-acceptance-summary.json`).
- 테스트 엔진 PID40540은 종료됐고, 프로젝트 정리 도구의 preview→apply로 runtime02·bundle02·input02를 각각 삭제했다. 세 apply 결과 모두 `completed`/`deleted`, 실제 경로 부재와 lifecycle finalization을 확인했다(`fix-cleanup-final.json`). 최초 runtime preview는 호출한 상위 셸의 literal 경로를 활성 참조로 판정해 보존했으므로, 종료 후 helper 파일 호출로 재검토했고 보호 검사를 생략하지 않았다. 별도 Cargo cache는 만들지 않고 기존 primary cache를 재사용했다.
- 기존 조사 profile root는 앞선 자동 승인 거부 상태로 남겨 두었다. 입력01은 이 조사 로그 root와 같은 lifecycle 그룹에 등록돼 증거 보존과 결합돼 있으며, 이번 새 그룹 삭제에 포함하지 않았다. 이 둘은 정리 미완료다. 원본이나 사용자 실행 프로세스를 변경하지 않고, 기존 정리 거부를 다른 API로 우회하지 않았다. 실제 남은 위치는 `artifacts/verification/session-stall-20261015`와 `artifacts/verification/BP-01-recovery-fix-input01`이다. 기존 그룹의 보호/소유권과 자동 승인 거부를 재검토한 후 제거할 조건으로 기록한다.
- 소유 범위 CRLF-aware whitespace 검사 exit0(`final-whitespace.log`). 설치 host 및 실제 서비스 호출·다른 OS는 미검증이다. 현재 실행 앱에 대한 적용 완료를 의미하지 않는다.

# 재현 결과와 원인
- 실제 엔진: `artifacts/w14w/artifacts/releases/w14y/engine/codex.exe`, SHA-256 `e4095ba70929660382285518bb45b89fdaf347fbfb357fd7a19e2296b60780f2`. 배포 영수증의 소스는 `artifacts/engine-input-AF01`이다.
- 원본 rollout 6,840줄, SHA-256 `070c3cf12040bb6779e8f971db578ab743e6e5a6d3efe7c910d637c05418f3d6`. 모든 완료 실행에서 동일 hash를 확인했다. 실제 계정은 복사하지 않고 테스트용 가짜 API key와 루프백 Responses만 사용했다. stdio native 프로필 재현이며 VS Code UI/실제 서비스 테스트는 아니다.
- 원본 6,825줄의 `custom_tool_call` 이름 `exec`, ID `call_0a46c7ac7d984bd78f9f4f296b019718`에 대응하는 결과가 없다. 파일 전체의 custom call/output 대조에서 누락은 이 한 건이다. 호출이 실제로 어디까지 실행됐는지는 이번 증거로 확정하지 않는다.
- `core/src/context_manager/normalize.rs::ensure_call_outputs_present`가 이 누락을 발견해 `error_or_panic`을 먼저 호출한다. `core/src/util.rs`는 `debug_assertions`가 켜지면 panic하며, 실제 배포 바이너리에서도 `core\\src\\util.rs:83:9` panic을 관찰했다. 뒤에 있는 synthetic `aborted` 결과 생성 코드까지 도달하지 못한다.
- `core/src/tasks/mod.rs`의 spawn된 task는 `.run(...).await` 뒤에만 `on_task_finished`와 `done.notify_waiters()`를 호출한다. 해당 task future에 panic 경계가 없어 unwind가 이 종료 처리를 건너뛴다. `sampling_context`의 timeout도 error 반환이 아닌 panic을 terminal 상태로 변환하지 않는다. 따라서 무한 대기보다는 작업 panic 뒤 실행 중 표시가 남는 장애로 설명된다. 과거 DB의 inProgress 잔여 상태는 이번 직접 원인으로 확인되지 않았다.

| 실험 | 입력과 차이 | 관찰 | 실제 종료 |
| --- | --- | --- | --- |
| copied-db-v2 | 원본 rollout + 해당 세션 DB 행 | resume idle, sampling_context에서 동일 panic, 110.094초 동안 Responses 요청 0·turn/completed 없음. interrupt 후 종료 | runner 0 / engine 0 |
| control | 동일 엔진과 가짜 계정, 최소 이력 | 6.954초에 Responses 1건·turn completed | runner 0 / engine 0 |
| healed | DB 없이 원본 이력, 누락 한 건에만 복사본 synthetic `aborted` 결과 추가 | 8.625초에 Responses 1건·turn completed, 실제 도구 재실행 없음 | runner 0 / engine 0 |
| raw-confirm | DB 없이 원본 이력 그대로 | 동일 호출 ID panic 확인, 12.312초에서 진단 종료, Responses 0·turn/completed 없음 | runner 0 / engine 0 |

핵심 비교는 DB 없는 raw-confirm과 healed이다. 세션 ID·모델·엔진·가짜 계정·격리 workspace 방식은 동일하며, 누락된 호출 결과의 보충 여부가 정상 완료를 바꾼다. 원본 이력이 무응답의 원인이라는 가설이 재현되고, 원본 DB 손상 없이도 발생함을 확인했다.

# 제안 해결안
1. **정상적인 중단 이력 복구:** `ensure_call_outputs_present`에서 결과 없는 과거 custom/local-shell 호출을 recoverable 상태로 처리하고, 모델 요청용 복사본에만 deterministic ID의 synthetic 중단 결과를 만든다. 현재 함수의 보충 동작을 재사용하되 crash로 가능한 입력을 panic 조건으로 두지 않는다. 실제 도구 성공이나 미실행을 추정하지 않으며 자동 도구 재실행도 하지 않는다. 원본 rollout은 보존한다.
2. **턴 lifecycle 보장:** task spawn 경계에서 panic unwind를 잡아 task 소유 자원 정리와 terminal failed 알림을 보장한다. panic payload 대신 고정 오류 분류만 사용자/진단에 노출한다. 이미 실행된 도구는 재전송하지 않는다. 시작·중단·panic의 경합에서 terminal 상태가 한 번만 확정되도록 기존 소유권 계약을 유지한다.
3. **이 세션의 복구:** 수정 엔진으로 기존 이력을 읽어 정상화하는 방식을 우선 권장한다. 긴급 복구가 필요하면 원본 백업·writer 종료/독점 확인 후 파생 복사본의 누락 호출을 결과 불명/중단으로 보정해 별도 세션으로 재개하는 절차를 검토한다. 실험의 `aborted`는 이력 정상화 기법의 검증이며 실제 도구 미실행의 증거가 아니다. 이번에는 실제 세션이나 DB를 수정하지 않았다.
4. **필수 검증:** debug assertions가 켜진 조건에서 custom/local-shell 결과 누락·반복 resume·도구 재실행 0·원본 불변을 검증한다. 별도 injected task panic에서 failed terminal과 이후 사용자 입력 성공을 검증한다. 동일 배포본의 Windows native 재현에 더해 설치 host 표시/전송 수용을 확인하며, 공통 수정은 다른 OS의 검증 전 수용 완료로 보고하지 않는다.

# 실행과 증거·정리
- 조사/실험 시각은 manifest/result의 UTC epoch에 보존했다. copied-db-v2 10:24:23Z~10:26:14Z, control 10:26:02Z~10:26:09Z, healed 10:28:16Z~10:28:25Z, raw-confirm 10:28:51Z~10:29:03Z. 겹친 시간을 합산하지 않는다.
- 증거: `artifacts/logs/session-stall-20261015/{copied-db-v2,control,healed,raw-confirm}-{manifest,result}.json`, 각 stderr.log 및 `reproduce.py`. 내용 없는 결과 요약과 입력 hash를 보존한다. task-specific 도구는 해당 원인 수정 후 회귀 테스트로 옮기거나 삭제할 조건으로 보존한다.
- 초기 copied-db는 built-in openai provider override가 금지되어 설정 단계에서 실패했다(runner 0 / engine 0, result.failure). 기존 `openai_base_url`와 테스트용 가짜 auth.json을 재사용해 수정했고 제품 코드는 바꾸지 않았다.
- raw-rollout 추가 실험은 C: 공간 소진으로 result 저장이 실패했다(runner 1 / engine 0). 이 실행은 원인 판단 근거에서 제외했다. 이후 이번 프로필의 일반 파일을 일부 삭제해 공간을 확보하고 raw-confirm으로 대조했다.
- 모든 테스트 엔진의 실제 종료와 현재 프로세스 목록에서 해당 PID 부재를 확인했다. 실제 사용자 엔진은 종료·재시작하지 않았다.
- copied-db 프로필은 일반 삭제 후 부재 확인. control의 대부분과 copied-db-v2 원본 복사 파일을 일반 삭제했다. Git 임시 clone의 ReadOnly pack 파일은 일반 삭제 실패했다. 테스트 파일 속성 변경과 재귀 삭제를 묶은 명령, 이후 테스트 profile root 전체의 일반 재귀 삭제 명령이 자동 승인 검토에서 거부됐다. 상세 사유는 제공되지 않아 다른 API로 우회하지 않았다.
- 남은 테스트 복제 데이터·임시 파일의 실제 목록/크기와 원본 최종 hash는 `artifacts/logs/session-stall-20261015/cleanup-result.json`에 기록했다. 정리는 미완료이며 실제 디렉터리를 성공적으로 제거하기 전 완료로 취급하지 않는다. 이 정리 상태는 최초 조사 단계의 결과다. 이후 사용자의 권장 개선 지시로 제품 구현·architecture/feature inventory 수정 권한은 확정됐으며, 설치와 원본 복구는 계속 범위 밖이다.
