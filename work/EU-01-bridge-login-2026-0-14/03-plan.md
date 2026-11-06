상태: 사용자 수정 요청에 따라 구현·검증 중. 배포 빌드·설치는 별도 지시가 없어 수행하지 않는다.

# .14 도구 IPC 장애 분석

## 요청·범위·검증 기준
- 요청: 롤백 전 도구를 사용할 수 없었던 이유 분석. 이전 세션 01a19050-af0d-7153-9a44-9fbdd52b4acf와 현재 복구 상태 비교.
- 허용: 기존 분석에 이어 사용자가 IPC 규격 정합성 수정을 요청했다. 빌드 선택·검증 코드와 관련 문서/테스트를 수정한다. 전체 제품 빌드·설치·사용자 DB 변경은 포함하지 않는다. 테스트가 소유한 프로세스·상태만 기존 소유자 절차로 정리한다.
- 플랫폼: Windows x64 로컬 VS Code에서 관찰. IPC 계약은 공통이나 다른 OS 실행 검증 없음.
- 소유자/순서: root가 실제 실패 → 배포 소스 수신 계약 → host 출처와 실제 해시 → 현재 복구 상태를 대조. 별도 위임 없음.
- 성공 기준: 실제 오류와 코드상 거부 조건 및 구성요소 출처를 연결하고 재시작/롤백 결과와 미검증 범위를 설명한다.

## 결론과 실제 실패
.14 엔진과 외부에서 가져온 code-mode host의 IPC 응답 형식이 맞지 않았다. host 응답의 result_buffered_for_ns를 엔진이 허용하지 않아 functions.exec 결과 수신이 실패했다.

원본 기록: C:/Users/felre/.azrael-ex/sessions/2026/10/31/rollout-2026-10-31T13-56-09-01a19050-af0d-7153-9a44-9fbdd52b4acf.jsonl

2026-10-31 13:56:17, 13:56:19, 13:56:55, 14:42:15, 14:43:21 KST에 다음 오류가 5회 기록됐다.

`failed to read code-mode host message: failed to decode code-mode IPC frame: unknown field result_buffered_for_ns, expected one of cell_id, content_items, error_text, code_mode_host_duration_ns`

마지막 입력은 text("rollback execution transport check"); 로 외부 명령 없이 문자열만 반환한다. 재시작 후에도 같은 오류였다. PowerShell이나 파일 접근 권한이 직접 원인이라는 설명과 맞지 않는다. spawn_agent와 defer_root는 당시 성공했으므로 모든 도구가 불능이었다는 표현은 과도하다. 확인된 장애는 functions.exec/code-mode 응답 경로다. 응답 실패만으로 내부 하위 명령의 미실행이나 부작용 부재를 보장할 수는 없다.

## 코드와 배포 증거
- .14 runtime: C:/Users/felre/.vscode/extensions/azrael-ex-local.azrael-2026.0.14/out/azrael-runtime.json
- .14 bundle: artifacts/e/artifacts/q/artifacts/releases/et1-cold-20261030q/engine
- 해당 build-info.json이 지정하는 engineSourceRoot: artifacts/e/artifacts/i2/project/engine.
- 해당 codex-rs/code-mode-protocol/src/host/payload.rs:322의 WireRuntimeResponse는 serde deny_unknown_fields를 사용한다. Result 허용 필드는 위 오류와 동일하며 result_buffered_for_ns는 없다. 인접 주석은 app-server와 host가 같은 버전이라는 전제를 명시한다.
- 해당 host/codec.rs:127의 serde_json::from_slice 오류가 :130의 failed to decode code-mode IPC frame으로 변환된다.
- .14 azrael-engine-build.json의 host는 external-import다. 출처: C:/Users/felre/.vscode/extensions/openai.chatgpt-26.1021.22027-win32-x64/bin/windows-x86_64/codex-code-mode-host.exe.
- .14 실제 SHA256: engine 444ea298b4d8025400abf9100f3e13464bb00ff72b49a70f3f1022b6e925622f, host 89713bec82069f1fefc70ec6d52fcb96d79cfd5f0d8d831aedde0b2005a39402. 영수증과 일치.
- .13 실제 SHA256: engine af05729487ad2fa94d97eb0abedb795f843130297135546464becb522fb8c40a, host ec91f7a04dcb1a36f0e2ed87885777bf78900c2ea3295e82621c5721fd5d9f41. 영수증과 일치.
- .13 host 영수증 출처는 artifacts/workspaces/h/artifacts/releases/w13r-99afefb1/engine/azrael-code-mode-host.exe로 .14와 다른 바이너리다.
- 현재 실행 중 엔진과 자손 host의 경로는 C:/Users/felre/AppData/Local/azrael-ex/releases/2026.0.13/runtime/engine 아래다. 현재 세션의 functions.exec 및 exec_command 응답 정상.

## 빌드에서 놓친 조건
해당 frozen scripts/build-azrael.ps1:70–75는 외부 host 경로 존재를 검사한다. :122–128은 선택한 파일의 해시 불변·복사·출처 기록을 수행한다. engine-provenance.py verify는 소스와 바이너리 및 외부 host 해시 일치를 검증한다. 파일 신원 검증은 IPC 상호 호환성을 입증하지 않는다. 기존 work/ET-01-cold-build-cache-audit/q-package-engine-identity.json 역시 host 89713bec…의 빌드/패키지 해시 일치를 기록한다.

모든 기존 검증이 누락됐다고 단정하지 않는다. 다만 최종 배포 조합의 실제 functions.exec 응답 수용은 실사용에서 실패했다. 재시작은 같은 패키지 조합을 재실행하므로 해결되지 않았고 롤백은 엔진과 host 조합을 함께 바꿨다.

## 해결 방향과 남은 불확실성
- 같은 프로토콜 소스에서 host를 빌드하거나, 선택 엔진과 실제 호환성이 검증된 외부 host를 고정한다. 공식 확장의 최신 host라는 사실만으로 호환성을 보장할 수 없다.
- .13 host를 .14에 사용하는 것은 아직 검증하지 않은 후보다. 이번 조사에서 파일을 교체하거나 .14를 재실행하지 않았다.
- 수정 시 최종 패키지의 엔진/host 쌍으로 문자열 반환, 하위 도구 호출 및 yield/wait 응답 경로를 확인하는 수용 검증이 필요하다. 모르는 필드를 단순 무시하는 변경만으로 전체 프로토콜 호환성을 보장할 수 없다.
- 세션 연결의 session storage protocols are incompatible는 별도 저장소/세션 연결 오류다. 이번 IPC 원인 확인만으로 세션 호환성 문제까지 해결됐다고 주장하지 않는다.

## 실행·보존
세션 JSONL, frozen 수신 계약, 설치 구성, 양 버전 영수증과 실제 SHA256, 현재 프로세스를 대조했다. 관련 읽기·해시 명령 exit 0. 초기 python 명령은 PATH에서 찾지 못해 exit 1이었고 PowerShell로 기록을 분석했다. 문서 생성은 설치 Python의 절대 경로를 사용한다. 현재 셸 PATH 문제는 이전 IPC 오류와 다르다.

최초 분석에서는 제품 테스트·빌드·수정을 수행하지 않았다. 현재 수정·검증 범위는 아래 승인된 수정 계획을 따른다. 이 문서는 보존할 분석 산출물이다. 기존 세션·로그·릴리스는 변경하지 않았다. 문서 생성용 임시 본문은 일반 삭제하고 부재를 확인한다. 사용자 중단 직전 문서 생성은 결과가 없었으며 재개 후 문서·임시 본문·실행 중 할당 프로세스 부재를 확인한 후 실행했다.

## 승인된 수정과 실행 계획
- 사용자 요청: 응답 규격을 맞추도록 수정. 같은 소스의 host를 Windows 기본 빌드로 선택하고 명시적 외부 host는 실제 IPC 검증 후만 수용한다.
- 소유: build_host_selection은 Windows build/deploy와 기존 build metrics 테스트, root는 기존 shared-engine 통신 검사·회귀 테스트·문서/feature inventory·최종 검증을 소유한다. 읽기 조사자는 host 빌드 사전조건만 확인한다.
- 기존 플랫폼 빌더의 same-source 기본 경로를 재사용한다. Windows의 외부 host 필수 조건을 제거하고 같은 Cargo 입력에서 host를 컴파일한다. source-built/imported 출처와 재사용 규칙을 구분한다.
- 모든 Windows 빌드/재사용에서 기존 shared-engine --extended --code-mode-child 검사를 패키징 전에 실행한다. 실제 문자열+exec_command 완료 응답 검증을 보강하여 IPC decode 오류를 잡는다. 기존 하위 프로세스 생성·종료 검사도 유지한다.
- 검증: 선택/재사용/실패 시 패키징 차단의 기존 테스트 확장, shared-engine source suite, .13 정상 조합과 .14 실패 조합의 격리된 native 비교. 사용자 설정/세션 변경 및 실제 provider 호출 없음.
- 적용 범위: Windows x64 빌드 경로. Linux/macOS 기존 same-source 기본값 유지. 실제 실행 검증은 Windows에서 수행한다.
- 아키텍처와 feature inventory에는 기존 runtime/source provenance 책임 아래 보존 범위 및 필수 검사를 연결한다. 테스트 로그/fixture는 생성 전에 task run 소유권을 기록하고 진단 종료 후 정리한다.


## 현재 구현 및 검증 결과
- Windows build/deploy의 외부 host 필수 선택을 제거했다. 선택 소스에서 host를 빌드하고 source-built provenance를 기록한다. 명시적 외부 입력은 해시 불변성과 실제 IPC 검사를 유지한다.
- 모든 Windows build/reuse는 기존 shared-engine --extended --code-mode-child 검사를 계정 staging/패키징 전에 통과해야 한다. 완료된 문자열과 실제 exec_command 결과를 검증하는 codesmoke를 추가했다. 기존 셀 생성/종료 검사는 유지했다.
- scripts/test-build-metrics 전체 Windows 회귀: 19 passed, 0 failed, exit 0. shared-engine source 회귀(별도 process-tree 파일 출력 검사는 제외): 18 passed, 0 failed, exit 0. feature manifest validate 및 git diff --check exit 0.
- 구 릴리스 비교에서는 새 테스트 전용 plugin-startup flag가 없으므로 명시적 legacyPluginStartup 검사 API를 추가했다. 기본 빌드 검사 인수는 유지하며 자동 fallback은 하지 않는다. 두 엔진 경로 모두 같은 선택을 전달한다.
- 실제 비교 준비에서 unsupported flag, AF_UNIX 경로 길이, 두 번째 엔진 인수 누락을 진단했다. 구 .14의 세션 소유권 거부 문구는 현재 전체 검사 기대값과 달랐다. 이 기대값을 완화하지 않고 별도 codeModeCompatibilityOnly API로 실제 IPC 경계만 비교한다. 전체 build gate는 유지한다.
- 시작 전 실패 시 빈 PID 배열을 PowerShell이 중첩 배열로 해석하던 fixture cleanup 오류도 수정했다. 기존 소유권·경로·PID·일반 삭제 검사를 유지했다. 초기 실패 checker는 부모·시작 시각·명령줄·자식 부재를 확인한 뒤 테스트 프로세스만 종료했고 원본 fixture는 기존 removeOwnedFixture로 삭제했다.
- 사용자 .13 설치·원본 .14 릴리스는 변경하지 않았다. 후보는 task 소유 복사본이며 전체 제품 재빌드·설치는 하지 않았다.
- 같은 소스 host의 Windows 전체 빌드는 matching V8 sandbox assets가 필요하고 아직 실행하지 않았다. Linux/macOS 기존 소스 빌드 기본값은 변경하지 않았다.
- 자동 검증 산출물은 run:EU01-ipc-host:*로 소유권을 기록했다. native owner의 초기 등록이 lifecycle catalog 잠금을 사용하여 비교 admission이 대기했다. 등록 종료 후 비교를 시작했으며 .14 엔진과 기존 host 조합의 실제 IPC 검사는 통과했다. native owner SHA f167e9bdb5c3cd5ea796417ddb7bbd89d9bea1322a369f9de89b5c63bd53cc76를 확인했다. 동일 .14 엔진과 원래 오류 host 조합은 완료 응답 검증에서 거부됐고 최종 turn timeout으로 실패했다. 양쪽 fixture 삭제를 확인했다.

## 정리 상태
- 실제 IPC 비교: .14 엔진 + .13 보존 host는 text/exec_command 완료 응답 통과. 같은 엔진 + 원래 .14 host는 실패. 설치 변경 없음. 독립 수용 증거: ipc-host-acceptance.json.
- 3개 비보호 그룹(metrics-a, native-a/b)은 native owner 삭제·실제 부재·producer finalize까지 확인했다(호출 exit 0). 5개 그룹(native-c/e/f, diagnostic-d, ipc-comparison-g)은 기존 삭제된 CY-01-release-comparison-r3의 artifacts/c3 조상 claim과 충돌하여 보호된다. 과거 producer 기록은 이미 finalize되어 없다. retained/incomplete legacy-custody 전용 refine-custody의 적용 대상이 아니며 원시 registry 편집이나 셸 삭제로 우회하지 않는다.
- 차단된 정확한 경로와 측정 크기는 ipc-host-acceptance.json cleanup.review에 있다. 합계 2,848,939 bytes와 빈 임시 디렉터리 5개. 사용자가 2026-10-31 "승인합니다"로 앞서 제시한 5개 run 그룹과 연결된 빈 임시 폴더 5개의 보존을 명시적으로 승인했다. 지원되는 소유 절차로 조상 claim 충돌을 해결할 수 있게 되면 fresh review 후 그룹 전체를 삭제한다. 보호 우회·다른 경로 삭제 권한은 포함하지 않는다. 구현·검증은 완료했으며 이 승인된 보존 예외를 두고 작업을 완료한다.

## 승인된 프로젝트 세션 연결 수정
- 사용자 승인: 같은 프로젝트의 세션 열기에 창 ID/등록 순서/다른 작업 소유 조건을 적용하지 않는다. 다른 프로젝트 접근 및 엔진 간 중복 실행 lease는 유지한다.
- 선택 소스: docs/ops/development.md의 engine/ (SOURCE.json: integrated rust-v0.162.0). 현재 설치본은 별도이며 이번에는 소스 수정·테스트만 수행한다.
- 구현: Registry는 저장된 세션 컨텍스트를 프로젝트 ID로 검증하여 반환한다. 창 전체 context alias를 변경하지 않고 기존 thread_routes로 세션별 연결·응답·승인·연결 종료를 처리한다.
- 검증: 기존 Registry/rejoin 테스트를 새 계약으로 갱신하고 살아 있는 원창, 이미 작업한 창, 여러 세션/재시작, 다른 프로젝트 거부 및 계정 경로 분리를 확인한다. 기존 native shared-engine 검사도 세션별 연결 의미로 갱신한다. 공통 Windows/Linux/macOS 코드이며 실제 실행 환경은 Windows x64.
- 보존: pending 승인 및 계정/모델/권한은 원래 세션 컨텍스트를 유지하고, 새 창의 기본 계정/다른 세션은 바꾸지 않는다. 기존 IPC 수정과 정리 보존 승인 대기는 유지한다.

### 프로젝트 연결 수정 진행
- Registry의 창 등록 순서·원창 생존·기존 작업 소유 조건 및 alias 전체 이관을 제거했다. 저장된 프로젝트 ID 검증 후 원래 세션 processor를 반환하고 기존 세션별 thread_routes에 연결한다. 원래 계정·모델·권한과 엔진 실행 lease, handoff fence, 승인 응답 라우터는 유지한다.
- 기존 rejoin 테스트를 같은 프로젝트의 살아 있는 원창/이미 작업한 창/원창 종료/저장 후 재시작/companion 기본 컨텍스트 보존/다른 프로젝트 거부로 갱신했다. native checker는 같은 프로젝트의 여러 세션 실행·알림 분리와 중복 inference 방지도 확인하도록 확장했다.
- engine.shared-engine의 기존 implementation owners와 appserver/session-handoff 필수 검사에 변경 소스와 테스트가 이미 연결되어 있다. 기능 ID나 기존 보호 검사를 삭제하지 않았다.
- Node 회귀 21 passed, 0 failed, exit 0; checker 구문 검사 및 변경 파일 diff --check exit 0. 독립 근거는 project-session-acceptance.json.
- 고정된 Rust 입력 9,344개 파일을 기존 copyTree+inventory로 비교했다. Windows Cargo 1.95.0의 관리된 단일 compile/test 경로로 azrael_shared_server::tests와 azrael_thread_engines::tests를 선택했다. 실제 컴파일 진행을 확인했으며 결과 대기 중이다. 소스 고정 뒤 입력은 변경하지 않는다.
- 설치본·기존 릴리스는 변경하지 않았다. Linux/macOS 및 새 바이너리의 실제 UI/IPC 수용은 이번에 실행하지 않았다. 기존 IPC 작업의 보호 충돌 5개 그룹 보존 승인은 여전히 미해결이다.

### 프로젝트 연결 검증 결과
- 최초 Windows 실제 Cargo compile/test는 컴파일 성공 후 17 passed / 1 failed, exit 101이었다. 실패는 기존 diagnostic_snapshot_preserves_shape_and_storage_failure_is_nonfatal의 snapshots.len()==1 기대값에서 실제 0을 받은 경우다. 저장 오류와 2초 시간 제한 중 원인은 확정하지 않았다.
- 고정 입력을 변경하지 않고 재실행했다. 실패 검사 단독 1 passed, shared-server 전체 18 passed, thread-engine lease 5 passed, 모두 exit 0. 최초 실패를 성공으로 덮지 않고 project-session-acceptance.json에 별도 보존한다. 테스트 조건과 제품 시간 제한을 변경하지 않았다.
- Node 21개와 Rust의 서로 다른 23개 회귀가 통과했다. native checker의 새 IPC 시나리오는 소스 구문 검사만 수행했고 새 제품 바이너리 실행·설치는 하지 않았다. Linux/macOS 실행 미검증.
- Node run 삭제·부재·finalize 완료. 고정 Rust 입력 및 두 번의 실행 로그는 필요한 결과를 위 독립 수용 기록에 옮긴 뒤 정리한다.

- 최종 경로 검토에서 세션별 알림·callback ID·연결 종료 및 프로젝트/engine fencing 코드에 추가 결함을 찾지 못했다. 이 부분의 새 IPC 시나리오는 실제 실행하지 않았으므로 코드 검토와 unit 회귀 범위를 구분한다.
- Git index에 다른 작업의 staged 변경 23개 파일이 있으며, checker/아키텍처/작업 기록에는 이전 IPC 작업의 미커밋 변경도 함께 있다. 이번 변경을 섞어 커밋하거나 기존 index를 변경하지 않는다. 독립 task commit은 변경 분리가 끝날 때까지 보류한다.

### 프로젝트 연결 수정 최종 상태
- 세션 연결 소스 수정과 Windows 회귀 검증 완료: Node 21개, Rust shared-server 18개와 thread-engine lease 5개 통과. 최초 진단 테스트의 일시 실패와 변경 없는 재실행 결과는 독립 수용 기록에 보존했다. 최초 실패의 정확한 저장 오류/시간 초과 원인은 확정하지 않았다.
- 이번 작업 run 3개는 verified native owner의 항목별 삭제 결과, 실제 부재, lifecycle finalize를 확인했다. 빈 task namespace도 링크·비어 있음·정확한 경로를 검사한 뒤 일반 비재귀 삭제하고 부재를 확인했다. 이번 작업의 임시 입력·로그·제어 요청은 남지 않았다.
- source hash 최종 일치와 checker 구문/diff 검사를 확인했다. 새 제품 바이너리의 실제 IPC/화면·설치, Linux/macOS 실행은 미검증이다. 배포나 설치는 수행하지 않았다.
- 기존 staged/공유 파일 변경을 보존해 독립 커밋은 보류한다. 이전 IPC 작업에서 보호 충돌로 남은 5개 그룹의 보존 승인은 별도 미해결이며 이번 요청으로 승인됐다고 해석하지 않는다.

## 승인된 세션 실행 소유 잠금 제거
- 사용자 요청: 창이 버전·프로젝트·세션을 관리하는 구조에서 세션 소유 잠금을 제거한다. 공통 데이터의 읽기/쓰기/버전 공존 문제는 별도 범위로 남긴다.
- 공통 소스 engine/의 ThreadEngineLeases를 엔진 메모리의 ThreadEngineSessions로 바꾸고 세션 .lock 및 .engine.json publication을 제거한다. 로컬 실행 목록·종료 및 복구 대상 추적은 유지한다.
- transfer/account 복구 데이터가 사용하는 private control directory의 안전한 초기화는 유지한다. 기존 사용자 홈의 기록/잠금 파일은 직접 변경하거나 삭제하지 않는다. rollout writer/compression 데이터 무결성 제어와 공통 storage admission은 변경하지 않는다.
- daemon의 이전 소유 기록 기반 자동 foreign route가 명시적 버전 이관 진입점도 맡고 있어, 선택 버전 직결과 자동 이관 유지 중 사용자 판단을 요청했다. 이 결정에 의존하는 daemon 구현·검증은 응답 전 진행하지 않는다. 독립 tracker/callsite 구현은 진행한다.
- 플랫폼 공통 Windows/Linux/macOS 대상, 실제 검증은 Windows. 기존 staged 변경과 daemon의 기존 diff를 보존한다. 제품 빌드·설치 없음.

### 소유 잠금 제거 컴포넌트 검증
- ThreadEngineSessions로 tracker/callsite를 연결하고 descriptor publication을 제거했다. 로컬 종료·복구 대상 집계는 유지한다. checker의 세대 간 소유권 거부 검사는 저장된 기록 읽기와 비재개 확인으로 대체했다.
- 첫 고정 입력의 Windows compile 성공, tracker 검사 5 passed / 1 failed, Cargo exit 101. 실패는 테스트가 직접 소유한 legacy 파일 잠금을 유지한 채 다른 handle로 파일을 읽으려 한 Windows OS error 33이다. 실제 track/release 작업은 성공한 뒤였다.
- 테스트는 잠긴 동안 track/release 확인을 유지하고 이후 잠금을 해제한 다음 내용 보존을 검사하도록 수정했다. 새 고정 입력에서 source/track/shared-server 회귀 재실행 중이다. 첫 실패와 실제 결과는 session-lock-removal-acceptance.json에 보존한다.
- 자동 이관 경로 선택은 사용자 응답 대기. 과거 daemon 소유 기록과 잠금 probe를 어떻게 대체할지 결정에 의존하므로 해당 파일은 변경하지 않았다.

### 자동 연결·이관 유지 결정
- 사용자는 잠금 없이 자동 버전 연결·이관 유지를 선택했다. .engine.json은 비권위적 발견 힌트로 남기며 게시 실패로 공식 요청을 거부하지 않는다. 별도 source status 연결에서 세션 추적 여부·peer 신원을 확인한 뒤 실제 attach는 새 연결의 첫 요청으로 보낸다. 종료된 source의 과거 호환성 정보는 선택 엔진 접근을 막지 않는다.
- .lock 실행 소유권은 제거한다. shared storage admission, rollout writer/compression, 프로젝트·peer 검증, busy subscriber/callback 보호와 이관 fencing은 유지한다. 공통 소스 지원 플랫폼은 Windows/Linux/macOS이며 실제 테스트 호스트는 Windows x64다.

### 순차 검증 재시도
- 컴포넌트 r2: Node 21/21, tracker 6/6 통과. shared-server 17/18 통과, 기존 diagnostic snapshot 테스트가 다시 빈 결과를 반환했다. 정확한 저장 오류/시간 초과 원인은 확정하지 않았다.
- 최종 r3: tracker 9/9와 실제 Cargo exit 0을 관측했으나, 독립적으로 시작한 정리 등록이 공통 lifecycle catalog를 장시간 점유해 Cargo/task 소유권 finalization이 실패했다. r3은 실패로 보존한다. 테스트 실행과 관리 작업의 공유 자원을 과소평가했으므로 이후는 순차 실행한다.
- 이전 r1/r2 소스·로그는 native owner의 항목별 삭제/부재/finalize를 확인했다. r3의 관측된 종료 정보는 기존 finishTargetOwner/finishExecution/finishArtifactRun으로 재등록했고 강제 잠금 삭제를 하지 않았다. r4는 r3의 동일한 고정 입력을 참조하여 재컴파일 낭비 없이 필수 handoff 5개 필터와 shared storage 검사를 순차 실행한다.

- r4 순차 검증에서 tracker 9개/shared-server 18개가 통과했다. daemon 신규 테스트 2곳의 unwrap_err가 Windows UnixStream의 Debug 제약으로 컴파일 실패하여 mutable 소스의 테스트 오류 추출만 err().expect로 수정했다. 고정 r3 입력은 변경하지 않는다. r4의 나머지 검증이 끝난 뒤 수정된 daemon 테스트만 새 고정 입력에서 검증하고 불변 제품 구현의 통과 근거는 재사용한다.

### 잠금 제거 최종 검증
- Windows x64: tracker 9, shared-server 18, core handoff 10, appserver handoff 7, daemon session handoff 12, storage 5 통과(총 61); storage 1개는 기존 ignored. Node 소스 검사 21개 통과. 선택된 성공 필터 exit 0, 고정 입력 불변 확인. 최초 fixture/진단 실패, 관리 잠금 충돌, Windows 테스트 컴파일 실패는 별도 시도 결과로 보존한다.
- r5는 r4 대비 daemon 테스트 오류 추출 2곳만 달랐으며 제품 코드 prefix 불변과 전체 입력 hash 비교를 검증했다. 44개 성공 근거는 재사용했다. native 12개는 실제 WebSocket 다중 source/callback/이관, busy 및 legacy status, stale/dead incompatible hint fallback, identity mismatch, live storage rejection을 포함한다.
- 제품 빌드·설치/현재 설치창 UI, Linux/macOS는 실행하지 않았다. 소유 잠금 제거가 저장 형식 호환을 넓히지는 않는다. 실제로 실행 중인 다른 버전의 ABI가 다르면 기존 저장소 보호가 거부할 수 있다.

### 세션 소유 잠금 제거 완료
- 소스 구현·Windows 검증·현재 작업의 임시 산출물 정리 완료. 5개 run은 native owner의 실제 삭제/부재/finalize를 확인했다. 빈 task namespace도 링크·경로·비어 있음을 확인한 뒤 비재귀 삭제했다. 독립 수용 기록은 session-lock-removal-acceptance.json에 남긴다.
- 자동 버전 연결·이관은 유지하며 실행 소유 .lock은 생성/검사하지 않는다. .engine.json은 생존 확인을 거치는 힌트다. 공통 저장소 및 rollout 무결성 보호는 유지한다. 기존 사용자 상태 홈/세션 기록은 직접 삭제하지 않았다.
- 제품 빌드·설치와 설치창 검증은 미수행이다. 기존 혼합 staged/동시 변경을 보존했고 task commit은 변경 분리가 필요해 보류한다. 이전 IPC c3 보호 5개 그룹의 별도 보관 승인 문제는 현재 요청과 분리해 유지한다.

## 기존 사용자 세션 소유 잠금 정리
- 후속 요청으로 실제 상태 홈의 세션 소유 잠금 해제를 승인받았다. Windows 상태 홈 azrael-thread-engines-v1의 정규 UUID/0바이트 .lock만 대상으로 했다. 보호된 파일을 강제 삭제하지 않는다.
- 사용 중 핸들과 양립하지 않는 read/write 공유 예약 및 일반 DeleteOnClose로 비사용 잠금 1,190개 삭제, 실제 부재 확인. 남은 38개는 sharing violation으로 보존했고 다른 실패는 없다. discovery .engine.json 230개는 변경하지 않았다.
- 초기 잠금+위치 기록 동시 삭제 요청은 승인 검토에서 위치 기록이 자동 연결/이관 메타데이터이며 일괄 삭제 권한이 명확하지 않다는 이유로 거부됐다. 메타데이터 삭제를 제외한 더 좁은 잠금 파일 작업만 수행했다.
- Windows Restart Manager의 읽기 전용 조회로 남은 38개 파일의 실제 보유자가 .13 azrael PID 20000(session 1)임을 확인했다. 실행 중 엔진/현재 대화에 영향을 줄 수 있으므로 엔진을 종료하거나 외부 핸들을 강제로 닫지 않았다. 남은 잠금 해제는 해당 엔진의 정상 종료 허용 여부 대기 중이다.
- 증거: existing-session-lock-release.json(정확한 삭제/보존 파일), existing-session-lock-owners.json(실제 보유 프로세스). 공유 storage/rollout 보호와 대화 내용은 변경하지 않았다.
