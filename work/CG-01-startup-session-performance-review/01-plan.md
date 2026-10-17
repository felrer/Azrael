상태: 1·2번 최적화 소스 구현·427개 테스트·산출물 보존 검토 완료. 사용자 추가 입력은 필요하지 않다. 전체 앱 빌드·설치 및 실사용 지연 개선 측정은 미수행이다.

## 목표·권한·범위
검토한 1번 세션 복원 이력 재사용과 2번 초기 실행 검증 개선을 구현한다. 소스·관련 검증·설계 문서 및 작업별 커밋이 범위이며 제품 전체 빌드·설치·재시작·실사용 세션 재개는 포함하지 않는다. 공통 host/engine 로직의 로컬 Windows x64 검증을 수행하며 Linux x64/glibc 및 macOS ARM64 회귀 영향과 실제 미검증 환경을 구분한다. 3번 legacy 이력 index/checkpoint 확장은 이번 범위에 포함하지 않는다.

## 조사와 완료 기준
구현 소스는 `engine/`와 `scripts/`이며 설치 snapshot은 변경하지 않는다. resume_history_reuse는 app-server cold resume와 thread-store revision 검증 경계를 소유하고 startup_async_validation은 ordinary runtime 및 integrated entry의 비동기 준비·관련 테스트를 소유한다. root는 공유 계약·문서·feature inventory·동결 검증 입력·검증·통합·커밋을 소유한다. 두 구현은 독립적으로 진행하며, 각 소유자가 변경을 고정하면 해당 검증을 시작한다. 공유 엔진·계정 격리·pagination·복구·무결성 검증을 보존한다.

수용 기준은 (1) 같은 요청의 config 재시도에서 thread/path/mode/revision을 재확인한 이력만 재사용하고 변경·불명·실패 시 새로 읽기, (2) 기존 hash/platform/state 격리를 유지하면서 큰 동기 검증을 worker로 옮기고 완료 전 native host 실행 방지, (3) 동시 초기화 합치기와 오류·worker 종료 처리, (4) 영향받은 Windows native/source 테스트, 문서·보존 매핑 및 산출물 정리, (5) 이번 범위만 커밋이다. 실사용 지연 절감 수치는 별도 동일 패키지 설치 벤치마크 전에는 주장하지 않는다.

## 설치·소스 근거
- 현재 로그의 host는 `2026.0.10`, release는 `artifacts/n10a/artifacts/releases/w10e`, build-info의 engineSourceRoot는 `artifacts/n10a/engine`이다. `recovery.runtime`은 설정 근거이며 PID별 실행 파일 전수 검증은 하지 않았다.
- 설치 `integrated-azrael-entry.cjs`, `out/shared-engine-host.cjs`, `out/devin-native-host.cjs`, `out/provider-accounts-host.cjs`와 현재 `scripts/` 대응 파일 SHA256이 일치한다.
- `app-server-daemon/src/azrael.rs`, `app-server/src/main.rs`, `app-server/src/azrael_shared_server.rs`는 현재 engine/과 해당 설치 source snapshot SHA256이 일치한다. 전체 소스 동등성 주장은 하지 않는다.
- 기존 사용자·동시 작업의 수정 사항을 보존한다. architecture와 feature inventory는 이번 구현의 보존 경계를 반영하고 기존 수정 hunk는 커밋에 섞지 않는다.

## 기존 로그에서 확인한 시간
근거 루트: `C:/Users/felre/AppData/Roaming/Code/logs/20261017T230155/`. 모든 시각은 KST다. `window*/exthost/azrael-ex-local.azrael/Azrael.log`의 기존 성능 span을 읽었다. 통제된 벤치마크나 p95 자료는 아니다.

| 관측 | 값 | 해석·한계 |
| --- | --- | --- |
| renderer `app routes mounted after` | 3,571~12,082 ms | renderer가 정의한 시작점부터의 초기화 시간. VS Code 전체 실행 시간 및 채팅 입력 가능 시각과 다르다. |
| foreground cold `thread_navigation` | 8건, 2,056.1~12,045.3 ms | 처음 표시하는 세션의 복원과 표시 비용. 서로 다른 세션·창 조건이다. |
| foreground hot `thread_navigation` | 14건, 288.1~727 ms | 기존 화면 유지·캐시 경로가 실제 동작한다. 보존 여부만으로 모든 차이를 설명하지 않는다. |
| foreground `thread_hydration` | 9건, 931.6~11,365.5 ms | 런타임 재개와 이력 준비를 포함한다. |
| window1 23:21:36.597, 146행 | resume 9,646.6 ms / hydration 11,365.5 ms | `runtime_resume_finished` 10,570.4 - `runtime_resume_started` 923.8. `history_ready` 11,332.1. 이어 navigation 12,045.3 ms(147행). |
| window4 23:19:39.919, 95행 | resume 3,927.8 ms / hydration 4,956.3 ms | `history_ready` 4,933.4. 이어 navigation 5,571.5 ms(96행). |
| window4 23:21:47.581, 201행 | resume 106.1 ms / hydration 931.6 ms | history_ready 903.7, navigation 2,056.1 ms(202행). 런타임 재개가 항상 느린 것은 아니다. |
| app-server spawn→initialize | 예: window1 10.675초, 재시작 뒤 3.138초 | 서로 다른 상태에서의 관측. 초기화 내부 단계별 시간은 미분리다. |

window3의 약 19분 navigation은 `timingQuality=backgrounded`, background 1,128,288 ms여서 체감 대기의 비교에서 제외했다. 각 구간은 겹칠 수 있으므로 합쳐 전체 지연이나 예상 절감량으로 계산하지 않는다.

## 초기 실행 경로와 재사용 기능
1. `scripts/integrated-azrael-entry.cjs:7`에서 native host와 account module을 최상위 require하고 runtime을 읽는다.
2. runtime 생성(`scripts/ordinary-runtime.cjs:62`)은 Devin·provider bundle을 동기식으로 검증한다. `devin-native-host.cjs:9`, `provider-accounts-host.cjs:13`은 파일 전체를 `readFileSync` 후 해시한다. 설치 manifest상 Devin 34개 파일 약 0.8 MiB와 Node 98.4 MiB, provider 34개 파일 약 89 MiB를 검증한다.
3. activate는 `verifyEngine` → `resolveEngineEndpoint` → 계정 기본값 이관 → recovery 초기화 → native activate → account activate 순서다(`integrated-azrael-entry.cjs:121`). 설치에는 localHistory 설정이 없어 자동 import는 이 환경의 원인으로 지목하지 않는다. account activate 함수 본체에 장시간 네트워크 응답 await는 확인되지 않았다.
4. 엔진은 약 278.2 MiB. host `verifyEngine`은 streaming SHA256이며 Map으로 동일 host 프로세스 내 promise를 재사용한다. `resolveEngineEndpoint`도 WeakMap으로 중복 실행을 합친다. 같은 함수의 두 호출을 두 번 해시한다고 해석하지 않는다.
5. 별도 discovery 프로세스와 stdio proxy/native daemon 검증은 각각 실제 실행 파일을 해시한다. `app-server-daemon/src/azrael.rs:136`, `:207`, `:257`은 endpoint 결정 및 lifecycle lock 전후 identity 확인을 수행한다. 프로세스 경계와 파일 교체 경쟁을 막는 계약이므로 일괄 삭제 대상이 아니다.
6. `Cargo.toml`의 `[profile.dev.package.sha2] opt-level=3`은 설치 snapshot에도 이미 있다. 이를 새 최적화로 다시 제안하지 않는다.

## 제한된 읽기 전용 실험
설치 helper validator의 `readBundle`과 streaming 엔진 SHA256을 각 1회 실행했다. 사용자 상태에 쓰거나 provider helper를 시작하지 않았다. filesystem cache·동시 부하를 통제하지 않은 보조 근거다.

| 실행 | 결과 | 실제 exit |
| --- | --- | --- |
| 설치 Devin `readBundle(release,true)` | 547 ms | Node 0 |
| 설치 provider `readBundle(release,true)` | 383 ms | Node 0 |
| 엔진 streaming SHA256 | 668 ms, receipt 일치 | Node 0 |
| 엔진 `-c features.code_mode_host=true app-server --analytics-default-enabled --azrael-engine-endpoint` | 1,265 ms, identity 일치, stderr 0 bytes | child 0, Node 0 |

마지막 명령은 source contract상 config/auth/state 생성이나 daemon 시작 없는 endpoint discovery다. 실제 실행 상태 재개·추론은 하지 않았다. 출력은 도구 실행 기록과 본 문서에 보존하며 별도 임시 로그/생성물은 없다. 위 시간을 실제 활성화 시간이나 보장 절감량으로 사용하지 않는다.

## 권장 방향과 검증 계획
- 최우선 후보는 cold resume의 이력 준비 중복 제거다. 조사상 설정 로딩 후 재시도 경로에서 이미 읽은 history를 다시 읽을 수 있다. thread/rollout identity 및 revision 재확인을 유지한 snapshot 재사용이 필요하며, 구체적인 소유 함수·테스트 근거는 아래 세션 조사에 정리한다.
- 초기화 단계별 기존 span 확장으로 require/동기 검증, host SHA, endpoint, daemon lock/연결, renderer mount·최초 입력 가능 시각을 분리한다. 본문·토큰·계정 비밀은 기록하지 않는다.
- 기존 Node 표준 비동기 I/O 또는 worker_threads로 큰 파일 검증의 extension host 정지를 줄이고, 같은 물리 파일·기대 hash의 중복 작업을 해당 수명 내에서 합치는 방안을 검토한다. 프로세스 간 신뢰 전달 및 lock 전후 재검증은 별도 설계가 필요하다. 비동기화만으로 총 CPU·disk 비용이 사라지지는 않는다.
- UI shell을 먼저 표시하고 검증 완료까지 실행/계정 동작을 준비 중으로 유지하는 선택지는 체감 개선 후보이나, 사용자에게 보이는 동작 변경이다. 실제 구현 전 실패 처리와 준비 상태 표시를 결정한다.
- 세션 화면 보존 캐시가 이미 작동하므로 단순 전역 캐시 확대를 우선하지 않는다. 메모리 증가, 기존 renderer 충돌 진단과의 관계는 아직 미확정이다.
- 후속 검증은 단일 창/여러 창, backend 정지/실행 중, 첫 로드/재방문, 작은/큰 rollout을 나눠 동일 입력에서 foreground navigation·최초 입력 가능 시간 및 메모리를 비교한다. 설치와 다른 mutable source의 결과를 혼용하지 않는다.
- 공통 변경은 Windows x64 회귀와 해당 native/host 보존 체크를 포함하고 Linux x64/glibc·macOS ARM64의 실제 검증 여부를 별도 기록한다. 기존 integrity 실패·경로 탈출 거절·다중 창 격리·복구·이력 편집/분기·queue/root resume를 보존한다.

## 세션 복원 상세 근거
읽기 전용 조사자는 핵심 10개 파일의 현재 engine/과 설치 snapshot SHA256 일치를 확인했다. 대상은 thread processor/lifecycle, thread manager, session/session+mod, startup prewarm, rollout recorder 및 local thread-store model-context/read-thread/history-read다. source receipt 관계와 범위가 확인된 근거이며 실제 컴파일 provenance 전수 재검증은 아니다.

### 우선 개선: 설정 로딩 재시도 사이의 이력 재사용
`engine/codex-rs/app-server/src/request_processors/thread_processor.rs:560`의 바깥 반복문은 cold inner를 재호출한다. `:3761`, `:3859`에서 저장 이력을 로드한 뒤 `:4095`에서 cwd config 로드를 위해 잠금을 놓고 `Continue`를 반환한다. 재호출 시 cold probe와 이력 로드를 다시 거친다.

따라서 legacy는 전체 rollout parse를 두 번, paginated는 모델 문맥 reverse scan을 두 번 수행할 수 있다. 실제 지연 사례의 세부 이력 모드를 계측하지 않아 이것이 각각 몇 ms를 차지했는지는 미확인이다. `:4110` 주석의 archive/delete/alias 동시 변경 재확인 목적은 유지해야 한다. 권장안은 prepared history에 concrete thread/rollout identity, path, history revision을 결부하고 재검증이 성공했을 때만 재사용하는 것이다. 단순히 재시도나 두 번째 확인을 삭제하면 안 된다.

### 큰 이력의 비용과 기존 pagination
- legacy `rollout/src/recorder.rs:1122`는 non-empty rollout line을 전부 읽어 decode한다. `thread-store/src/local/model_context.rs:28`의 paginated loader는 rollout lineage를 뒤에서부터 유효 compaction checkpoint까지 읽는다. checkpoint가 없으면 처음까지 읽을 수 있다(`:158`, `model_context_tests.rs:341`).
- cold resume는 `ThreadManager::resume_thread_with_history` → `Session::spawn` 및 이력 재구성이 끝나야 응답한다. 저장 token-usage replay는 있지만 새 tokenizer 실행이나 모델 생성이 이 구간에서 일어난다는 근거는 없다.
- `thread_processor.rs:4753`의 paginated full-turn 응답은 모든 turn page와 full items를 순회하는 호환 경로다. 반면 paginated turns/items list는 `thread-store/src/local/thread_history/read.rs:105`의 bounded page를 사용한다. legacy turns/list는 매 요청 전체 rollout에서 turn을 재구성하는 비용이 남는다.
- w10e staged pinned UI `webview/assets/app-initial-97d3534ad35f.js:2047`의 요청은 `excludeTurns:F&&!D`다. 로컬 tail hydration(F)이 켜진 paginated 지원 경로는 resume에서 turns를 제외하고 이후 timeline/cursor 요청으로 불러온다. 5-turn full initial page는 legacy/비지원 호환 분기다. 동일 요청 조각은 pristine 26.1007.21434에도 있다.
- 당시 F의 runtime 값, 각 세션의 historyMode는 기존 로그에서 확정하지 않았다. 따라서 전체 turns 호환 경로는 조건부 후보이며 현재 UI가 언제나 전체 이력을 전송한다고 판단하지 않는다. 기존 세션의 historyMode 일괄 변경·이력 삭제·페이지 수 축소는 권장안에 포함하지 않는다.
- 선택적 후속 후보는 legacy 이력에 검증된 checkpoint/index 경로를 도입하는 것이다. rollback·compaction·편집·분기 의미를 보존해야 하므로 중복 읽기 제거보다 범위와 위험이 크다.

### startup 준비와 이미 비동기인 작업
`core/src/session/session.rs:1113`, `:1265`, `:1576`, `:2033`에서 auth/MCP projection, environment resolve, AGENTS/plugin-skill warmup 및 history reconstruction이 startup에 포함된다. required MCP validation은 `mcp_runtime.rs:137`에서 await한다. 이들은 실행 의미를 유지하는 준비이므로 기능 생략을 최적화로 취급하지 않는다. 해당 단계의 실제 소요시간은 추가 계측 대상이다.

`core/src/session/startup_prewarm.rs:209`의 websocket/auth prewarm은 이미 spawned task이므로 이를 새로 background 전환할 최적화로 제안하지 않는다. 독립적인 resume cursor 1-row 조회 두 개를 병렬화하는 후보도 있으나 전체 rollout 중복 읽기보다 기대 우선순위가 낮다.

## 구현 설계·선택·수용 기준
1. 기존 UI span·설치 validator의 읽기 전용 측정과 동일 이력 loader 재호출 경로를 기준 근거로 사용했다. 추가 telemetry 및 실사용 설치 전후 벤치마크는 수행하지 않았으며 체감 시간 절감량은 미확인이다.
2. cold resume의 검증된 history snapshot을 같은 요청의 설정 재시도에서 재사용한다. 정상 cold/반복 resume뿐 아니라 config await 중 archive/delete/aliased resume/revert 경쟁에서 stale snapshot이 쓰이지 않아야 한다. 기존 native 이력·pagination·동시 변경 계약을 보존하고 변경 revision 및 source identity fallback을 검증했다.
3. 초기 실행의 동일 동기 validator를 worker에서 재사용하고 동일 물리 runtime 모듈의 동시 초기화를 합친다. SHA256·manifest·경로 격리·변조 실패를 보존한다. UI shell 선표시·provider별 지연 로드·검증 생략은 도입하지 않는다.
4. 큰 legacy 이력의 checkpoint/index 확장과 호환 경로 변경은 이번 범위 밖이다.

선택 권고는 이력 삭제나 무제한 화면 캐시 확대 없이 1~3단계를 먼저 진행하는 것이다. 메모리 부담과 보존 계약 변경을 줄이는 대신, 이력 크기에 비례하는 모든 비용을 한 번에 없애지는 않는다. 개선 목표 수치는 통제된 기준 측정 후 정하며 현재 표본으로 절감률을 보장하지 않는다.

재사용할 검증 소유자는 app-server `thread_read.rs:1215`의 resume page 및 `thread_resume.rs:2810`의 metadata/deprecation, thread-store model-context checkpoint/fallback 및 turn/item page, core history reconstruction 테스트다. host는 `scripts/test-shared-engine-host.cjs`, `test-devin-native-host.cjs`, `test-provider-accounts-host.cjs`, UI는 `test-paginated-history.cjs`와 변경된 pinned request 경계 체크를 선택한다. 실사용 설치 검증은 동일 frozen package로 별도 수행해야 한다.

## 수행·정리와 한계
조사·문서 작성과 자식 읽기 전용 조사만 수행했다. 제품 tests/build/install, 창 조작·재시작·실사용 thread resume, provider 요청, DB 변경·이력 정리는 하지 않았다. 생성된 파일은 본 계획뿐이다. 계획 할당용 임시 본문은 일반 삭제했다. 초기 python PATH 탐색은 실패했으며 설치된 Python312 절대 경로로 문서 도구를 실행해 생성 성공을 확인했다. 측정 명령은 최종 실제 exit 0을 확인했다.

소스 조사와 기존 로그의 원인은 연관 후보이며 인과·비율을 모두 증명한 profiler 자료는 아니다. 위 읽기 전용 실행 근거는 검토 단계의 결과이며, 구현 이후 검증 결과는 아래에서 구분한다.

## 구현·검증 기록
아직 완료되지 않은 검사와 실사용 성능은 통과로 간주하지 않는다. 전체 제품 빌드·설치 없이 필요한 테스트 컴파일을 수행하며 실행 로그와 snapshot은 작업 소유 산출물로 등록한다. 각 실행의 실제 exit와 원본 로그 경로를 기록한다.

- 구현: cold resume는 concrete id/path/mode가 같은 request-local history에 대해 store의 opaque revision 검증이 성공한 경우만 재사용한다. metadata·running probe를 계속 수행하며 오류·미지원·변경 revision은 원래 loader로 돌아간다. 기존 LocalWriter의 잠금 아래 revision 재확인까지 유지됨을 별도 읽기 전용 검토로 확인했다.
- 구현: integrated entry는 Node worker의 동일 runtime validator 완료와 exit 0 이후에 native/account module을 로드한다. 기존 sync runtime/process 소비자와 Windows alias registry, process env 격리를 보존한다. worker 실패·무결과 종료·초기화 중 getter·동시 초기화와 재시도를 검증한다.
- host source: 2026-10-17 23:53:03~23:53:32 KST, 63 tests pass, exit 0. `artifacts/tasks/CG-01-startup-session-performance-review/runs/implementation-01/logs/host-source.log`, 요약 `reports/host-source.json`.
- host preservation: 23:56:37~2026-10-18 00:01:06 KST, recovery/preparation-state/feature-preservation 351 tests pass, exit 0. 동일 run의 `logs/host-preservation.log`, `reports/host-preservation.json`.
- 첫 project_tests 실행 `run-51008-636-1792248736106872300`은 10초 후 실제 exit 124, producer_completed=true로 종료됐다. 통과로 간주하지 않고 완료가 확인된 뒤 native exec 세션의 동일 Node scope로 재실행했다. 실제 재실행 63개 결과는 위와 같다. 임시로 추가한 bundle 항목은 제거했으며 동시 작업의 `source-scroll-fade` bundle은 보존했다.
- 네이티브 입력은 23:54:34~23:56:34 KST에 `inputs/engine`으로 복사·동결했다. 10,530개 파일, SHA256 `bda7cf45bc09b332fba980dbd7add363ea2efd90d7ffac64ccb87ad0046a8ac4`. 현재 checkout의 다른 작업은 이 실행에 반영하지 않는다. guard와 snapshot 파일 읽기가 IO를 사용했으며 이를 제품 지연으로 해석하지 않는다.
- 네이티브 테스트는 Rust 1.95.0 / Windows x64 target / 기존 `engine/codex-rs/target` cache / managed Cargo owner / jobs 4로 실행했다. 2026-10-17 23:57:19~2026-10-18 00:30:54 KST, 전체 종료 0, 입력 전후 일치. store revision 1개, 기존 model-context 8개, app-server reuse 4개가 통과했다. 세 Cargo 실행의 실제 종료도 모두 0이다. `logs/native.log`, `reports/native.json` 및 `reports/final-summary.json`에 근거를 보존했다. `INSTA_UPDATE=no`, pending 출력은 run의 `temporary/cargo-pending`으로 고정했다. 컴파일과 테스트는 제품 전체 빌드가 아니다.
- 네이티브 단계는 source guard를 포함해 33분 35초였다. 첫 store 테스트 컴파일 15분 55초, 같은 crate 두 번째 필터 38.55초, app-server 테스트 컴파일 13분 35초를 기록했다. 별도 source 테스트와 일부 실행은 겹치므로 이들을 합산해 전체 작업 시간으로 보고하지 않는다. 제품 처리 성능과도 구분한다. 테스트 컴파일 실패나 소스 수정으로 인한 native rerun은 없었다.
- 테스트한 소유 엔진 파일 5개가 현재 checkout과 SHA256 일치함을 확인했다. 총 source 63 + preservation 351 + native 13 = 427개 통과다. 설치 앱의 UI/추론·실제 지연 감소 및 Linux/macOS native 실행은 미검증이다.
- run producer `CG-01-implementation-01`은 실행 전 planned output을 기록했고 종료 후 complete/membership_complete로 조정했다. 첫 built-in inventory 등록 호출은 장시간 측정 대기로 중단됐으며 후속 review는 unknown group을 반환했다. 종료 후 새 등록을 완료해 group `CG-01-implementation-01`, member `CG-01-implementation-01-files`의 실제 존재·소유·189,656,165 bytes를 확인했다. source snapshot과 원본 로그를 같은 그룹으로 보존한다. Cargo cache는 기존 공유 cache를 재사용했으며 대체 cache·제품 패키지는 만들지 않았다.
- 종료 후 `project_cleanup_review`에서 현재 identity와 그룹 전체를 확인하고 `project_cleanup_apply`의 명시적 defer 결정을 적용했다. 실제 결과는 group_status=deferred, remaining=true다. 동일 변경의 패키지/설치 host acceptance가 통과하고 독립적으로 읽을 수 있는 검증 근거가 보존되면 전체 run을 다시 검토해 삭제 여부를 결정한다. 현재 실행·직전 릴리스·사용자 상태는 정리 대상이 아니며 이 작업에서 파일 강제 삭제는 하지 않았다.
- 완료 신호 관찰자는 실제 native 보고서의 exit=0과 unchanged=true를 확인한 뒤 성공 신호를 기록했고 프로세스 종료 0을 확인했다. 최초 관찰자 생성 명령의 quoting 오류는 검증 실행과 분리해 실패로 기록했고 새 실행 ID로 바로잡았다. 테스트 결과를 시간 경과만으로 성공 처리하지 않았다.
- 최종 수용은 소스 및 Windows의 해당 native/source 계약까지다. 실제 실행 중인 2026.0.10 설치본은 변경하지 않았다. 본 작업 커밋은 이번 14개 파일과 feature inventory의 소유한 두 hunk만 포함하며, provider/world-state·Window Use·ScrollTimeline 등 동시 작업의 변경을 섞지 않는다.
