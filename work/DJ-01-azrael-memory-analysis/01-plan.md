상태: 승인된 개선안1(일반 대화의 MCP 지연 실행) 구현·Windows 검증·임시 산출물 정리 완료. 기존 조사·설계 논의에 이어 같은 work에서 implementation을 적용했다. 비활성20분 정책·MCP 사용 후 종료·프로세스 공유·설치는 이번 변경에 포함하지 않는다. 아래 구현 계획과 최신 결과가 초기 조사 계획을 보완한다.

### 승인된 구현 범위와 검증

일반 root 및 기존 subagent의 cached MCP startup을 `LazyWhenCached`로 통일한다. 실제 수정 소스는 primary `engine/`이며 분석에 사용한 frozen w11aa를 편집하지 않는다. cold/expired/incompatible catalog, selected plugin, explicit reconnect, 동적 인증 cache 제외, 권한·도구 visibility·대화별 실행 상태의 기존 경계를 재사용한다. 공통 Windows x64/Linux x64/macOS ARM64 동작 변경이며 이번 native 검증은 Windows x64로 한정한다. 다른 플랫폼·제품 package·설치 상태의 수용은 별도다.

root 소유 변경은 `core/src/session/mcp_runtime.rs`, 기존 `core/tests/suite/mcp_tool_cache.rs`, 최소 owning architecture와 feature inventory/check wrapper다. 기존 통합 검증을 root/subagent 모두로 확장하고 warm10root의 NotStarted, 한 대화 호출 시 다른 root dormant 유지, cold discovery, HTTP required/optional/dynamic headers, 실제 호출/visibility 갱신/중단 복구를 검증한다. codex-mcp 기존 lib 검증도 포함한다. fixture binary 준비 컴파일과 실제 core 통합/mcp lib 검증을 구분한다. 새 cache나 pool·설정은 추가하지 않는다.

공유 Cargo cache는 `engine/codex-rs/target`의 기존 managed owner/lock을 사용하며 다른 활성 producer가 있으면 시작하지 않는다. 로그·snapshot·임시 테스트 상태는 새 run에 귀속하고 종료 후 native maintenance로 delete/defer를 결정한다. 시작 전 현재 활성 cargo/rustc는 관측되지 않았다. 기존 unrelated `.m`·upstream·DM 작업과 동시 진행되는 Cargo recipe/manifest 작업은 보존한다. 작업 완료 후 해당 변경만 commit하며 push·제품 빌드·설치는 수행하지 않는다.

실행 r1(2026-10-23 03:27:07~03:29:01 UTC)은 provenance recorder에서 실제 exit1, producerStopped=true/child closed=true로 끝났으며 Cargo는 시작하지 않았다. primary SOURCE.json의 현재 receipt와 MCP 변경 이외의 기존 HEAD 파일 다수가 이미 불일치했다. 예: turn_timing.rs receipt18801bytes vs HEAD/disk19221bytes, Cargo.lock408857 vs HEAD/disk408875bytes. 이들은 본 작업의 미커밋 변경이 아니다. 기존 변경을 함께 승인·기록하지 않고 SOURCE.json을 보존했다. 최초 산출물 선택 `artifacts/t/...`은 기존 parent lifecycle 소유로 begin 이전에 거부돼 파일 생성이 없었고, 실제 run은 충돌 없는 `artifacts/build/mcp-lazy-r1`로 생성했다.

검증 r2는 현재 Git이 선택한 raw source의 경로별 SHA256을 before/copy/after로 고정한 task-owned 복사본에서 focused tests만 수행한다. SOURCE.json도 그대로 보존하므로 이를 유효한 imported/product 출처 수용이라고 보고하지 않는다. 기존 출처 불일치는 제품 빌드 전 별도 소유자가 정확한 delta를 검토·기록해야 한다. 이는 설치·배포 guard를 우회하지 않으며 제품 컴파일·reuse·package는 이번에 수행하지 않는다. 새 wrapper와 소비 모듈도 복사본/hash로 고정하며, 고정 입력을 수정해야 할 경우 새 run ID를 사용한다.

후속 실행: r2는 wrapper 회귀 fixture가 참조하는 다른 check script를 복사하지 않아 wrapper exit1로 종료됐고 native compile은 없었다. r3는 필요한 check script를 함께 고정하여 wrapper50/50 pass, fixture preparation exit0(244.6초), core type-check exit101(231.8초)였다. 원인은 본 작업이 제거했던 McpDesiredState.session_source를 sibling session/mcp.rs:248,321의 plugin contribution이 사용한다는 E0609 두 건이다. 필드와 두 initializer를 복원했으며 제품 변경은 startup_policy의 기존 분기 교체만 남겼다. 별도 리뷰는 그 sibling field use를 놓쳤으므로 실제 컴파일 결과로 결론을 정정했다. r4는 수정된 새 입력으로 재검증한다. 이전 frozen 입력은 변경하지 않았다.

사용자는 추가 질문에 기존 변경 검토·출처 기록 정합화를 허용했다. metadata 전용 mcp-provenance-r1은 r1이 발견한144경로(기존142+본 작업2)를 검토한다. 기존 경로 대부분은 HEAD bytes와 동일하며, 동시 작업의 manifest 검사 정책 파일 한 곳은 기존 optional data-encoding 의존성 허용 두 줄의 delta만 확인해 별도로 분류한다. 이 코드 파일에 추가 수정은 없으며, 아래의 추가 승인에 따라 검토된 기존 두 줄만 함께 commit한다. recorder의 exact-delta/원본 baseline/현재 receipt anchor/모드/HEAD·index 재확인과 전체 provenance snapshot을 실행하며, 승인 전의 출처 실패를 통과로 바꾸지 않는다. native r4의 고정 입력에는 이후 primary metadata 변경을 반영하지 않는다.

출처 정합화 r1은 전체 coverage 검사에서 기존 receipt에 빠진 추가38경로를 발견해 record exit1로 종료됐다. 따라서 검토 범위는 기존180경로와 MCP2경로의 총182경로다. 실패 후 SOURCE.json은 게시되지 않았다. 당시 native cleanup의 catalog lock과 종료 기록이 경합했으므로, 실제 producer/child 종료 근거로 supported close를 재시도해 실패 상태를 그대로 보존했다. r2는182경로의 정확한 delta로 재실행한다. native r4와 입력을 공유하지 않으며, 두 producer 종료 전에는 추가 cleanup apply를 실행하지 않는다.

최종 검증: feature inventory의 engine.mcp-lazy-startup 항목은 기존 validateManifest로 검사해 exit0이다. native r4의 wrapper50/50 및 fixture preparation, core integration typecheck가 exit0이다. core 통합 테스트는10개를 실제 선택·실행해10pass/0fail/0ignored, 실행40.15초로 통과했다. 일반 root와 subagent의 cached stdio/HTTP 시작, required/optional/dynamic headers, Apps cache 및 thread별 호출 격리를 포함한다. codex-mcp lib도 typecheck와258개 선택·실행이 exit0,258pass/0fail/0ignored(실행4.18초)다. 최종 native driver는2026-10-23 03:43:36~04:13:37 UTC, 약30분이며 준비 컴파일·링크 시간이 포함된다. producerStopped=true와 모든 직접 child closed=true, frozen source/wrapper 최종 hash guard 통과를 확인했다. 별도 metadata 검사는 이 시간과 겹쳤으므로 두 실행 시간을 합산하지 않는다. 테스트 컴파일을 제품 빌드 성공으로 보고하지 않는다.

출처 정합화 r2는2026-10-23 03:53:10~03:59:43 UTC에 record와 전체 snapshot 모두 exit0으로 끝났다. 182경로의 검토를 반영해 SOURCE.json만 갱신했으며, 원본 baseline과 이전 실패 결과를 보존했다. 분류는 기존 commit과 같은179경로, 검토한 동시 manifest 정책1경로, MCP2경로다. source snapshot은9310파일/sourceSha256=3373c7c6167ca48cdcc45079b46246a0030bb4cb7c89d117ced100280d8d05e3이다. native r4에 고정한 MCP2파일의 SHA256도 정합화 대상과 일치한다. 선택된 전체9312파일을 현재 primary와 재비교했을 때도 변경 경로는 SOURCE.json뿐이다. metadata 외의 동시 작업 파일은 이 작업의 commit에 포함하지 않는다.

정리·보존: mcp-lazy-r1~r4와 provenance-r1/r2의6그룹10항목이 native review/apply에서 모두 deleted/remaining=false, supported finalize에서 remaining[]/references[]/blockers[]로 완료됐다. 필요한 결과·명령·출처 검토·실패 로그는 evidence/mcp-*에 독립 보존했다. 논리 파일 크기는 합계330,218,232bytes이며 RAM 절감량이나 실제 디스크 회수량과 구분한다. 최종 감사는 evidence/mcp-lazy-final-cleanup.json, 초기 두 실행은 mcp-lazy-early-cleanup.json이 소유한다. 공유 Cargo cache는 기존 소유자 영역이므로 삭제하지 않았다. check-mcp-lazy-startup 및 wrapper 테스트는 기능 보존용으로 유지한다. work의 재현/정합화/정리 helper와 근거는 source 검증·실패 원인·정리 감사 재현에 필요하므로 보존하며, 동일 계약의 대체 검증이 수용되거나 기능이 폐기되면 재검토한다. Windows source 검증은 설치판 반영이나 Linux/macOS 수용을 의미하지 않으며, 새 RAM 절감량은 측정하지 않았다.

최종 commit 범위: 출처 기록과 commit checkout을 일치시키기 위해 기존 manifest 검사 정책(.github/scripts/verify_cargo_workspace_manifests.py)의 data-encoding 허용 두 줄을 함께 포함할지 별도로 질문했고, 사용자가 허용했다. 검토된 두 줄 외 추가 수정 없이 stage했으며, staged blob의 SHA256=a774049a6e3bb942173b37770b5fdb9da8fb3ef6f8deb131a4a55aac065b37d1이 SOURCE.json과 일치함을 확인했다. 기존 보류 사유는 해소됐다. 기존 test_approved_compile_scope_manifests_use_exact_exceptions도 실제1pass/exit0(테스트15.380초)으로 확인했다. 명령과 입력 SHA는 evidence/mcp-policy-verification.json에 기록하며, 읽기 전용으로 사용한 동시 작업의 테스트 파일은 commit에 포함하지 않는다. 다른 동시 작업 파일도 포함하지 않는다. 최종 diff --check는 원시 로그의 원래 공백을 제외한 source/document/evidence JSON 전체에서 exit0이다. 로그의 원시 출력은 수정하지 않았다.

### 중복·불필요 보유 조사 결과

범위: 사용자의 후속 요청에 따라 누수 추적에서 중복 표현·캐시·미사용 프로세스 보유 조사로 초점을 옮겼다. 누수가 없다고 확정한 것은 아니다. 기존 work와 읽기 전용 진단 권한을 유지했고 제품·사용자 설정·추론·설치는 변경하지 않았다. 대상은 실제 설치2026.0.11 UI와 frozen w11aa Windows x64 소스다. 공통 구조의 개선 후보지만 macOS/Linux 적용·절감량을 검증하지 않았다. context 생성/소유권은 기존 real_history_contract, native 이력 표현은 engine_memory가 읽기 전용으로 조사했고 root는 설치 UI·MCP를 조사하여 통합했다. 추가 빌드·프로필 복사·UI 입력은 없었다.

| 대상 | 확인한 구조 | 판단과 권장 검증 |
|---|---|---|
| 비활성 UI 대화 | 일반 owner 대화는 기본3시간 또는 비활성 후보10개 초과 시 oldest부터 unsubscribe한다. active view/follower/보호 작업은 대상에서 빠진다. passive 비활성 이력을 즉시 비우는 경로도 있다. | 회수 누락으로 단정하지 않는다. 사용자 선호에 따라 약20분의 시간 기반 해제를 우선 검토한다. 바이트 상한은 우선 권장안에서 내린다.3시간은 모든 대화를 무조건 유지한다는 의미가 아니다. |
| 화면 밖 이력 | 설치 UI에1000개 item 초과 시 보호 viewport 앞쪽을500개 수준까지 줄이는 기존 함수가 있다. canonical/paginated/anchor 지원, 하나의 history island, 진행 중 로딩/요청 등 조건과 readActiveHistoryEvictionEnabled===true가 필요하다. | 새 eviction 기능을 중복 구현하지 않는다. 실험 설정의 fallback은 false지만 실제 live flag는 미측정이다. 먼저 현재 경로·flag·보류 조건을 확인한다.1000/500은 일반 byte 상한이나 반드시 달성하는 개수 상한이 아니다. |
| 전체 이력 API 응답 | thread/read(includeTurns=true)는 page들을 하나의 Vec<Turn>으로 모은다. resume는 excludeTurns=false이면 initialTurnsPage 요청과 별개로 full turns도 만들 수 있다. pending listener의 unbounded channel에는 여러 응답이 대기할 수 있다. | 별도 full-response 경로의 중복·transient 비용을 줄이는 후보. 기존 실측 page114MiB/full327~409MiB가 방향을 지지한다. 설치 UI는 useTailHydration=true이고 local resume의 excludeTurns=tail&&!cloud 경로가 이미 있으므로 매번 full-read한다는 주장은 하지 않는다. 실제 fallback/특수 caller 사용량을 계측한다. |
| 프로젝트 context | 각 context가 ConfigManager/AuthManager/ThreadManager/ModelsManager/ModelCatalog와 일부 worker를 따로 만든다. 같은 context 안에서는 Arc를 공유한다. context 개별 retirement는 구현되지 않았다. | byte 기여량 미확정. 살아 있는 thread·예약·callback·재접속 경로를 보존한 lazy 생성/안전한 retirement와 계정·설정이 같은 불변 model/catalog 데이터의 공유를 검토한다. 컨텍스트 전체의 무조건 통합은 하지 않는다. |
| MCP 프로세스 | root는 Eager, subagent는 LazyWhenCached 정책이다. 호환 connection 재사용·도구 catalog cache·binding Arc/Weak 재사용이 이미 있다. 이전 no-tool 실측10root/20MCP는 MCP 없는 경우보다298.3MiB 컸다. | 기존 lazy 기구를 root에서도 안전하게 활용할 범위를 검토한다. 상태 있는 REPL·권한·workspace·승인·nonce를 서로 공유하지 않는다. 재사용할 catalog가 없는 cold start와 selected plugin 예외도 보존한다. |
| 보조 Webview | usageView/rootResumeView는 retainContextWhenHidden=true다. usage는 숨겨지면 polling을 멈추는 기존 처리도 있다. 대화 Webview 해제는 별도1시간 지연과 작업 보호 조건을 쓴다. | 숨은 renderer 보유의 추가 후보지만 RAM 기여량은 미귀속이다. 설정·예약 화면을 대화 화면과 함께 큰 원인으로 합산하지 않는다. |

설치 UI의 근거: 주 asset `app-initial-7a199c66e670.js`는 manager asset `app-initial-97d3534ad35f.js`를 import한다. 후자의 character offsets4688488(TTL108e5/cap10),4690398(inactivity eligibility),4691702(passive history clear),4694995(candidate selection),4697144(unsubscribe 후 history clear),4673528(FCn viewport eviction),4675539(zCn viewport subscription),5025355(experiment callback)에서 확인했다. 주 asset offset813931은 useTailHydration=true, canonicalTurnHistory=true와 experiment3359351081.enabled fallback false를 제공한다. offsets는 해당 설치 asset hash와 함께 해석하며 파일 변경 후 재사용하지 않는다. 실제 플래그를 읽거나 바꾸지 않았다.

판정에서 제외하거나 낮춘 중복 후보:

- DB runtime `StateDbHandle=Arc<StateRuntime>`와 EnvironmentManager, 계정 backend identity/snapshot ordering은 context 간 이미 공유한다. 새 DB 전체가 창마다 RAM에 복제된다는 근거는 없다. ConfigManager fork와 계정 선택은 context별로 구분한다.
- core model history는 `Arc<Vec<ResponseItemEnvelope>>`, resumed rollout은 `Arc<Vec<RolloutItem>>`다. Arc clone 자체는 본문 복제가 아니다. cold reconstruction에서 model context를 따로 만들 때 response item clone이 있고 API 응답이 끝날 때까지 rollout 표현이 함께 살아 있을 수 있지만, 이 경로가 전체 UI 대화 두 벌을 영구 유지하는 것은 아니다. model context는 compaction 이후 선택한 suffix일 수 있다.
- app-server ThreadHistoryBuilder는 terminal turn 뒤 reset한다. TurnSummary의 final agent message clone은 남지만 전체 완료 이력을 계속 캐시하는 구조는 아니다. Guardian의 별도 history는 kind당128items/4MiB 한계가 있다.
- MCP tool cache에는32entry/30분 정책과 Arc 공유가 있다. 다만 각 McpManager가 자체 cache를 생성하며 context 사이 자동 전역 공유까지 보장하지 않는다. binding cache는 Weak이므로 사용하지 않는 binding을 그 cache만으로 붙잡지 않는다. 별도 새 cache를 추가할 이유가 없다.
- 최근5쌍 connector/bridge 합계 중앙값은 약92MiB다. 이들을 합치는 것만으로 공유 엔진 약4GiB를 설명하거나 큰 절감을 보장할 수 없다. rustc 및 새 generic Node 작업은 엔진 heap과 구분한다.

native 증거 위치는 frozen `app-server/src/azrael_shared_server.rs:404,561,763`, `message_processor.rs:362`, `core/src/thread_manager.rs:447,477`, `rollout/src/state_db.rs:29`, `login/src/auth/manager.rs:3024`다. 이력 표현은 `core/src/state/session.rs:74`, `context_manager/history.rs:93,258,539`, `core/src/session/mod.rs:1696,1836`, `history/src/lib.rs:374`; app-server 이력 수명은 `thread_state.rs:97,205,373,557`, full/resume 응답은 `request_processors/thread_processor.rs:3007,3491,4268,4354,4725`, pending 응답 처리는 `request_processors/thread_lifecycle.rs:625`다. bounded Guardian은 `guardian-context/src/history.rs:8,59,131`이다. MCP 정책은 `core/src/session/mcp_runtime.rs:378`, cache/connection/binding은 `codex-mcp/src/{tool_catalog_cache.rs:33,connection_manager.rs:282,635,runtime.rs:437,484,binding.rs:32}`, manager cache 생성은 `core/src/mcp.rs:104,130`이다.

검증: `check-inactive-cache-policy.mjs`는 설치 asset hash와 정확한 candidate-selection method를 추출해 fixture 입력으로7개 조건을 확인했다.10idle/1시간=0해제,11idle/1시간=oldest1,10idle/3시간 초과=10, active view/보호작업/follower=해제0, ephemeral side는 일반10개 cap에서 제외됨을 확인했다. source node --check exit0, 실제 fixture exit0, producerStopped=true/children[]다. 이는 선택 알고리즘의 조건 검증이며 실제 UI 상태·메모리 절감 검증은 아니다. helper는 synthetic protection 결과를 입력하므로 보호 판정 전체를 검증하지 않는다. 근거와 재현 source는 `evidence/inactive-cache-policy-r1/`에 보관했다. native register/review(blockers[])/delete(remaining=false)/finalize(remaining[]/references[]/blockers[])를 완료했으며 audit은 `evidence/inactive-cache-policy-cleanup.json`이다.

추천 순서: (1) 비활성 UI/대화 구독의 시간 기반 해제를 약20분으로 맞추는 방안 검토, (2) root MCP eager-start와 반복 relay 프로세스 비용 축소, (3) context별 code-mode host provider 공유 후보 검증, (4) full-response/queued resume 중복 구성과 대형 command/MCP 결과 본문 lazy fetch, (5) context 생성/retirement 최적화. 기존 viewport eviction의 live 활성 여부·보호 사유는 계측 대상으로 유지한다. 실제 절감률은 변경 전후 동일 입력 비교가 필요하다. 기능·정책 변경의 채택과 구현은 이번 조사와 구분하며 아직 수행하지 않았다.

### 시간 기반 해제와 실행 프로세스 공유의 후속 논의

사용자는 개수·바이트 상한 추가보다, 화면에서 벗어난 일반 비활성 대화의 캐시를 기존 약1시간보다 짧은20분 정도에 해제하는 방안을 선호한다. `design-collaboration`을 적용하되 같은 work와 조사 권한을 이어간다. 이번 발언은 정책 설명과 후보 비교 요청으로 적용했으며 제품 수정·설치 권한으로 확대하지 않는다.

설명의 정정/구분:1시간은 `scripts/webview-idle.cjs:35`의 숨겨진 Webview 전체 renderer 해제 지연이다.3시간/10개는 설치 manager asset의 비활성 history owner 구독 해제 정책이다. 일반 eligible owner가10개 이하면 TTL까지 보유될 수 있지만 active view·followers·작업 등 보호 조건이 별도 있고 passive 즉시 해제 경로도 있다. 따라서10개가 무조건3시간 보유되는 규칙은 아니다. candidate 계산은 `max(0, eligibleOrdinaryCount - cap)`를 해제 대상으로 선택하므로 cap을0으로 바꾸면 TTL을 기다리지 않고 모든 eligible ordinary owner를 바로 해제한다.20분 유예와 cap0 즉시 해제를 같은 정책으로 해석하면 안 된다. 이는 앞서 검증한 설치 method의 수식에서 도출했으며 cap0 별도 실행 테스트는 하지 않았다.

권장안(미적용): '화면에서 벗어나고 작업 보호가 해제된 일반 대화는20분 유예 후 캐시/구독을 해제하고, 다시 열 때 이력과 draft/view state를 복원'을 기준으로 관련 타이머를 일관되게 조정한다.1시간 UI 타이머만 줄이고3시간 구독 타이머를 그대로 두면 양쪽 자원이 함께 회수된다고 보장할 수 없다. 반대로 구독만 해제해도 renderer/host cache가 즉시 비워진다고 보장할 수 없다. 장기 Running/Deferred 작업·승인·queue·draft/선택한 유지 플래그·기타 창의 실제 사용 보호는 보존한다. 전경 창이 아니라는 이유만으로 모든 열린 대화를 비활성으로 바꾸는 제안은 하지 않는다.20분 경과 후 native idle unload는 별도의 기존60초 지연을 추가할 수 있고 allocator 때문에 Private Bytes 전체가 즉시 초기값으로 돌아오는 보장도 없다. 정확한 두 계층 연결과 회수량은 구현 전후 검증 대상이다.

실행 중복 후보의 추가 근거:

1. Window Use relay: 이전2026-10-22T16:05:20Z 실측에서50개/1111.8MiB private였다(`process-summary.json`). 같은 snapshot의 실제 window backend는2개/13.2MiB였다. relay는 `scripts/window-control-mcp.cjs:142`에서 매 요청의 trusted thread ID로 세션의 pipe/nonce를 읽어 기존 backend에 중계한다. 따라서50개 relay를50개의 독립 화면 자동화 backend로 간주하면 안 된다. root eager start를 줄이는 것이 우선이며 relay 프로세스 공유도 후보이다. 다만 현재 stdio loop는 프로세스 input/output 한 쌍을 처리하므로 공유 시 요청 다중화·실패 격리·승인/취소/nonce/thread routing을 보존해야 한다. 현재50개가 전부 미사용이라는 증거는 없고 절감량도 미측정이다.
2. code-mode host: frozen `core/src/thread_manager.rs:587`은 manager마다 새 `ProcessOwnedCodeModeSessionProvider::default()`를 만든다. `app-server/src/message_processor.rs:448,487`은 context마다 manager를 만들고 명시적 provider가 없으면 그 기본값을 유지한다. `code-mode/src/remote_session.rs:35,44,87,105`에서 provider는 OwnedCodeModeHost 하나를 소유하고 여러 독립 SessionInner(`:215,240`)가 그 host Arc를 공유한다. 따라서 기존 provider Arc를 엔진 범위에서 공유하는 구조적 후보가 있다. 최근 r2 마지막 표본에서 code-mode host5개는 모두 동일 엔진 PID61336의 직접 자식이고 private 합계197.87MiB였다.5개 세션을 하나로 합친다는 뜻이 아니며 session별 limits/state/delegate/cancellation을 유지해야 한다. 총197.87MiB가 전부 절감 가능한 프로세스 기본 비용이라는 뜻도 아니다. 공용 host의 오류 영향·설정 호환성·세션 격리 검증은 미실시다.
3. REPL: 이전 같은 snapshot은50개/146.3MiB였고 최근 r2는37개/약106MiB였다. 변수·모듈·파일 핸들을 보유하는 실행 상태이므로 단순 전역 공유/임의 종료 대상이 아니다. 도구 사용 전 생성 지연과 실제 빈 인스턴스 수명은 최적화 후보다.
4. 창별 connector/bridge5쌍은 약92MiB 수준이며 창·연결별 수명/계정 경계가 있다. 현재 근거로 동일 작업을 잘못 중복 실행하는 버그라고 부르지 않는다. 위 relay/code-mode provider 비용에 비해 우선순위를 낮춘다.

이 후속 확인은 설치 source 및 기존 수치 근거를 읽기 전용으로 재사용했다. 새 프로세스 측정·UI 조작·빌드·제품 변경·임시 산출물 생성은 없었다.20분 정책과 process provider 공유는 제안 상태이며 실제 메모리 절감으로 보고하지 않는다.

### 미사용 MCP 프로세스 축소 권장안

사용자는 세션별 미사용 MCP 프로세스를 줄이는 방법을 요청했다. 이 단계는 설계 권고이며 제품 변경·빌드·설정 변경을 수행하지 않는다. 공통 엔진 동작의 개선 후보이고 현재 확인한 소스와 실측 환경은 Windows x64 w11aa다.

우선순위는 기존 `LazyWhenCached`를 일반 root 대화에도 안전하게 적용하는 것이다. 유효하고 해당 세션에 허용된 도구 catalog는 모델에 제공하되, 해당 MCP의 실제 호출 전에는 세션별 프로세스를 생성하지 않는 것을 목표로 한다. frozen `core/src/session/mcp_runtime.rs:379`는 현재 subagent만 lazy/root는 eager로 분기한다. `codex-mcp/src/connection_manager.rs:635`는 기존 catalog에 허용된 model-visible 도구가 있고 selected plugin 예외에 해당하지 않을 때 startup trigger를 보류한다. 같은 파일`:133`의 client()가 trigger를 켠다. `connection_manager/required.rs:17`은 cached readiness가 허용되고 cached tools가 있으면 required 서버도 연결을 기다리지 않는다. `connection_manager.rs:176`은 Catalog readiness뿐 아니라 dormant startup도 허용하므로 required라는 이유만으로 항상 eager라고 단정하지 않는다. 대신 즉시 연결로 오류를 검출하던 시점이 바뀌는 서버는 시작 계약을 검토한다. 실제 도구 호출 이외에 client()를 요청하는 경로도 존재할 수 있으므로 정책 한 줄 변경만으로 모든 미사용 실행이 사라진다고 보장하지 않는다.

캐시가 없거나 만료·설정·계정·workspace 변경으로 재사용할 수 없으면 도구 발견 연결이 필요하다. 발견용 초기화와 실제 세션 실행 상태를 구분하고 호환되는 발견 요청만 합친다. 현재 manager별 cache를 그대로 둔 채 전역 재사용이 된다고 가정하지 않는다. 원격 연결·resource/prompt·notification 등 도구 호출 밖의 기능이 필요한 서버와 selected plugin은 별도 시작 조건을 보존한다. catalog TTL은 실행 프로세스 종료 시각과 별도다.

두 번째는 사용 후 회수다. 일반 비활성 대화20분 정책으로 구독을 해제하고, 다른 subscriber나 Running/Deferred/승인/작업이 없을 때 기존 native unload로 회수하는 경로를 우선 재사용한다. 기존 r9는 마지막 구독 해제 후90초 표본에서 loaded0/MCP0을 확인했지만 UI20분 정책을 연결한 실측은 아니다. 대화는 유지하면서 개별 MCP만 idle 종료하는 기능은 상태 복구가 가능한 서버부터 후속 검토한다. REPL 변수·핸들·진행 중 요청·notification 수신을 임의로 끊지 않는다. 별도 MCP idle 시간을 근거 없이20분으로 일괄 지정하지 않는다.

세 번째는 Window Use처럼 기존 backend에 중계하는 relay의 프로세스 공유다. 단일 stdio loop를 바로 여러 대화가 공유할 수 없으므로 요청 다중화, thread/nonce/계정/workspace/승인/취소 경계, 오류 영향과 병목을 검증해야 한다. 상태 있는 REPL 실행 상태는 대화별로 유지한다. 이 구조 변경은 지연 실행보다 뒤에 둔다.

검증 목표(미실행): 유효한 cache가 준비된10개 일반 대화에서 미사용 eligible MCP 자식이0개인지, 한 대화의 첫 호출만 해당 인스턴스를 시작하는지, 동시 첫 호출이 중복 spawn하지 않는지 확인한다. cold/expired cache·인증/설정 변경·required 오류·selected plugin·resource/notification 요구·REPL 상태·진행 중 호출·취소·재접속과 Windows 회귀를 포함한다. 동일 입력의 프로세스 수/Private Bytes/Working Set 및 첫 호출 지연을 전후 비교한다. 기존 no-tool10root/20MCP의298.3MiB 차이는 우선순위 근거이며 이 변경의 검증된 절감량은 아니다.

### 구독 해제 후 서버 보유와 최신 Codex 문서의 차이

구독 해제 응답은 즉시 전체 대화 runtime을 내렸다는 의미가 아니다. frozen w11aa `thread_lifecycle.rs:56`은 has_subscribers=false와 is_active=false가 모두 된 시각 중 나중 시각+delay를 unload 대상으로 계산한다. Running/Deferred는`:381`에서 다시 보호한다. `core/src/config/mod.rs:3972`의 thread_unload_delay_secs 기본값은60초다. 이는 설정 override가 없는 이 Azrael 빌드의 기본값이며 최신 Codex 전체의 보편값이 아니다. 기존 격리 r9는30초 시점loaded1/MCP2,90초시점loaded0/MCP0을 실측했다. 언로드 후에도 allocator·공유 context/cache 등으로 프로세스 Private Bytes 전부가 즉시 반납되는 것은 보장하지 않는다. 저장된 이력은 디스크에서 유지된다.

2026-10-23 공식 OpenAI Docs를 조회했다. 현재 Codex App Server 문서 https://learn.chatgpt.com/docs/app-server 의 'Unsubscribe from a loaded thread'는 마지막 subscriber가 사라진 뒤 무구독·무활동30분을 보유하고 notLoaded/thread/closed를 내보낸다고 설명한다. 따라서 현재 문서의30분과 frozen Azrael의60초를 구분한다. 최신 Codex changelog에서 '12-hour'/'12 hours'는 확인하지 못했다. 다만 https://developers.openai.com/api/docs/changelog 의2026-10-20 항목과 https://developers.openai.com/api/docs/guides/prompt-caching 는12시간 prompt caching을 설명한다. 이는 OpenAI API 추론 인프라의 공유 prompt prefix 캐시이고 로컬 Azrael app-server의 대화 runtime RAM 수명과 다르다. 사용자가 기억한 변경 기록이 정확히 이 항목인지는 원문 없이 확정하지 않는다.12h는 최소 캐시 수명 옵션이며12시간 뒤 삭제를 보장하는 기한도 아니다.

이번 확인은 source/기존 실측/공식 문서 비교만 수행했다. 설정·제품·실제 대화 구독에는 변경이 없다.

### 다중 VS Code 창 후속 분석 — 2026-10-23

사용자는 일반적으로 서로 다른 프로젝트·대화에서 작업하며, 현재 열린 Threads 창을 그대로 사용해도 된다고 명시했다. 새 프로필 실험과 달리 현재 사용자 창의 표시 상태 비교를 허용한 것으로 적용한다. 기존 작업 종료·새 추론·제품 설정 변경은 포함하지 않는다. 대상은 현재 Windows x64 세션의 `SufThreads - Visual Studio Code` 창이며 선택 시 최소화 상태였다. macOS/Linux 및 원격 UI는 이번 관측 범위가 아니다.

이전 r16은 mock owner/connector가 각각2개지만 모든6개 이력 조회가 peer0을 통과했다. 따라서 바쁜 context 하나와 비어 있는 다른 owner의 비교이며, 서로 다른 실제 프로젝트 창의 부하 분산 실험으로 해석하지 않는다.

읽기 전용 `multi-window-observe-r1`은 실제 exit0으로 완료했다. 공식 VS Code CLI의 status와10초 간격3회 CIM 표본을 사용했다. 자기 측정 프로세스·자식은 제외했고 제목·명령줄·대화 본문을 근거에 저장하지 않았다. VS Code1.143.0/commit2d0b7506a36c1d6db9a466440131a8e01eab2289에서 관측한 중앙값은 다음과 같다.

| 역할 | 표본 내 개수 | Private MiB | Working Set MiB |
|---|---:|---:|---:|
| Azrael 공유 엔진 |1|3830.54|2840.50|
| Azrael connector |4|47.29|186.06|
| Azrael bridge |4|20.16|70.62|
| VS Code workspace window |4|1019.01|762.89|
| VS Code extension host |4|1114.46|710.43|
| 이름 없는 window renderer |6|3397.41|3057.60|
| 기타 Code 프로세스 |12|1224.60|845.86|
| 기타 자식 프로세스 |160/166/169|1998.14|3099.79|

이는 다른 작업이 실행 중인 관측이며1/2/4창 통제 비교가 아니다. 모든 Code renderer/extension host를 Azrael에 귀속하지 않는다. Private Bytes는 프로세스 전용 commit이고 물리 RAM 사용량과 다르며, Working Set 합계는 공유 페이지를 중복 계산할 수 있다. 이후 Window Use 목록에는 Code 창5개가 관측됐으므로 앞선4개 표본과 동일 상태라고 가정하지 않는다. 근거는 `evidence/multi-window-observe-r1/`이다. 해당 임시 run 그룹은 native register/review/delete/finalize를 완료했고 remaining[]/references[]/blockers[]다. 감사 근거는 `evidence/multi-window-cleanup.json`이다.

frozen w11aa 소스 조사에서 확인된 후속 후보:

- `azrael_shared_server.rs:404`의 create_context는 MessageProcessor를 만들고, `message_processor.rs:448`은 각 processor의 ThreadManager를 만든다. 서로 다른 프로젝트 owner가 엔진 프로세스 하나를 사용하더라도 내부 처리 컨텍스트와 manager까지 하나인 것은 아니다. 현재4개 connector의 실제 live context 매핑은 계측하지 않았다.
- 공유 서버의 contexts map은 삽입 경로가 있으나 개별 제거 경로는 확인되지 않았다. 연결 종료는 connection 매핑과 subscriber를 정리하며 context는 유지한다. 어느 창이든 엔진을 유지하면 이전에 만든 context도 엔진 수명까지 남을 수 있다. context 안의 idle thread는 기존60초 정책으로 별도 unload할 수 있다. running/deferred 재접속 보존 계약이 있으므로 context를 무조건 제거하는 변경은 적절하지 않다. 이 소스 경로는 누적 보유 후보이며3.74GiB의 heap 소유 증거가 아니다.
- 저장된 window-owners registry의 owner/context/thread binding 수는 과거 메타데이터를 포함한다. 이를 현재 live context나 loaded thread 수로 보고하지 않는다.
- 설치 VS Code commit의 `mainThreadWebviewPanels.ts:298`은 webview visible을 해당 editor group의 activeEditor로 계산한다. Windows 전경 창 여부와 같지 않다. Azrael `scripts/webview-idle.cjs:47,104`는 view.visible이 false일 때 hidden timer를 사용하며 기본 지연은1시간이다. 따라서 다른 프로젝트 창으로 전환하거나 최소화하는 것만으로 idle 해제가 시작되지 않을 수 있다는 소스 기반 추론이다. 현재 창의 실제 visible 값과 메모리 변화는 미검증이다. 기본 소스: https://raw.githubusercontent.com/microsoft/vscode/2d0b7506a36c1d6db9a466440131a8e01eab2289/src/vs/workbench/api/browser/mainThreadWebviewPanels.ts

현재 창 비교의 선행 조건: Window Use native stage2/app 허용과 최신 상태·관측. prepare_permissions는 `unclassified` 오류를 반환했고 UI 입력은 없었다. 새로 창을 선택한 뒤 request_stage는 `permission_pending`, actionExecuted=false를 반환했다(approvalRequestId `azrael-window-consent-fd70ff05-b80a-44e6-a9aa-a870ea2a9256`). 같은 pending 요청을 반복하지 않는다. 허용 이벤트 후 상태와 제공 stage2 guide를 다시 확인한다. Window Use의 Codex extension 자동화 금지와 기타 mandatory deny는 사용자 창 사용 허용과 별도로 준수한다.

다음 검증은 기존 창의 표시 상태와 RAM 변화 사이의 관계를 좁히는 것이다. 현재 창 사용만으로 전체 창 수를 줄이거나 다른 사용자 작업을 중단하지 않는다. 다중 context의 live 수·loaded root·subscriber·unload 보류 이유·pending event bytes를 연결한 계측은 여전히 필요하며, 제품 계측/최적화 구현은 이번 분석 결과와 구분한다.

권한 후속: 위 카드의 Accepted 이벤트를 받았으나, fresh request_stage는 `state_changed`, `pauseReason=user_stopped`, `recovery=user_resume`, `actionExecuted=false`를 반환했다. 승인 기록만으로 중지 상태를 덮어쓰지 않는다. 창 조작은 명시적 사용자 재개와 host 재검증 전까지 중지한다. 제어 입력·복원·재생된 동작은 없으며 표시 전환의 RAM 효과는 미검증 상태로 유지한다. 사용자의 잘못 전달한 메시지라는 후속 설명은 마지막 메시지에 적용했으며, 기존 분석 범위를 임의로 취소하거나 확대하지 않았다.

### RAM 측정 재개 r2 — 실제 창5개,136초13표본

사용자가 측정 계속을 명시한 뒤 request_stage를 재검증했지만 host는 계속 user_stopped/user_resume/actionExecuted=false를 반환했다. 창 조작을 우회하지 않고 기존 읽기 전용 sampler를 재사용했다. 원본 profile·대화·작업 프로세스는 변경하지 않았다. sampler만 새 run ID/표본 수/간격을 검증하는 환경변수를 지원하도록 바꾸고 CPU 누적 시간·핸들·스레드 수를 추가했다. source node --check exit0, 측정 실제 exit0, producerStopped=true, 모든14개 tracked child exit0/closed=true를 확인했다. 제품 변경과 빌드는 없다.

측정 시각은2026-10-23 11:09:14~11:11:30 KST(02:09:14.290Z~02:11:30.371Z), 실제 구간136.081초다.5개 workspace/extension host,5개 connector/bridge, 공유 엔진1개가13표본 모두 유지됐다. 엔진 PID61336/creation134371670731746020은 전 표본과 이전 r1까지 일치했다.

| 지표 | 시작 | 종료 | 관측 범위 |
|---|---:|---:|---:|
| 엔진 Private MiB |4059.09|4061.61|4057.80~4064.43|
| 엔진 Working Set MiB |2615.25|2651.09|2614.02~2651.09|
| 엔진 핸들 수 |2377|2362|2346~2387|
| 엔진 스레드 수 |287|287|284~287|
| 시스템 free MiB |8641.45|7352.71|7352.71~9392.81|

엔진 private 변화는+2.52MiB(약0.062%)이며 이 짧은 구간에서 지속적 핸들/스레드 누적은 관측되지 않았다. 반면 CPU 누적은93.984초 증가했고 단일 코어 기준69.07%여서 유휴 상태로 취급하지 않는다. 이 결과로 장기 누수를 배제할 수 없다. r1 마지막3831.87MiB에서 r2 마지막4061.61MiB로 약229.73MiB 늘었지만 약51분 사이 창 수·부하·작업이 바뀌었으므로 창 하나의 비용이나 누수율로 환산하지 않는다.

역할별 Private 중앙값: 공유 엔진4060.24MiB, connector67.50MiB, bridge24.83MiB, workspace window1183.64MiB, extension host1408.61MiB, 미귀속 renderer3444.39MiB, 기타 Code1406.52MiB, 기타 자식5274.25MiB다. Code 역할 합계를 Azrael 단독으로 귀속하지 않는다. 각 범주의 서로 다른 시점 중앙값을 모두 더해 특정 시점의 합계로 보고하지 않는다.

기타 자식 중 rustc 합계는125~3191MiB로 변동했고 중앙값2379.96MiB였다. Node 합계는1292.39→1649.96MiB(+357.57MiB), 개수45→46이었다. PID·creation 비교에서 새 generic Node65532가 종료 표본350.75MiB를 사용했다. 부모 PowerShell7844→엔진61336으로 이어진다. 따라서 Node 합계 증가는 기존 단일 Node의 선형 누수 증거가 아니다. readonly 명령 형태 분류는 해당 Node를 Window Use/MCP/typescript/bundler/package manager로 식별하지 못했고 정확한 목적/대화 소유자는 미확정이다. 새 Window Use/MCP Node5232는20.97MiB였다. 측정기 자신과 그 자식은 합계에서 제외했다. 분류 때문에 대화 본문이나 전체 command line을 저장하지 않았다.

이번 결과는 공유 엔진에 약4GiB의 높은 private commit이 유지된다는 점과, 시스템 RAM 변화에 컴파일러·새 작업·Code UI도 관여한다는 점을 분리한다. 엔진 보유량의 원인 후보인 context/thread/history/queue/allocator의 실제 바이트 귀속과, 창 숨김의 효과는 여전히 미검증이다. 우선 최적화 후보는 기존 full-history 경로·대형 항목의 lazy fetch, 안전한 context 수명 관리, MCP lazy start이며 절감량을 보장하지 않는다.

근거는 `evidence/multi-window-observe-r2/{report,result,producer,analysis,node-deltas,node-role-check,manifest}.json`과 고정 sampler source다. native register/review(blockers[])/명시적 delete(remaining=false)/supported finalize(remaining[]/references[]/blockers[])를 완료했다. 임시 run1개/1항목 logical1,133,028bytes만 삭제했고 이는 디스크 크기다. audit은 `evidence/multi-window-observe-r2-cleanup.json`이다. 첫 register 호출은 금지된 operation 필드 때문에 실행 전 거부됐고 이를 제거한 지원 형식으로 성공했다. 첫 apply 준비 코드는 문자열 result를 객체로 취급해 tool 호출 전 실패했으며, JSON parse 후 현재 review token으로 적용했다. 실패를 측정 실패나 제품 실패로 혼동하지 않는다.

실제 재시도 계약(2026-10-23): 작은 fixture r12/r13/r14는 실제 exit0이다. r14는 v3 checkpoint 뒤의 완전한 JSONL tail까지 보존하는 검증을 추가했다. 첫 실제 r11은 v3!==v5 assertion에서 snapshot/native 실행 전 exit1/stopped로 끝났다. v3는 미지원이 아니라 v5 lazy rebuild 대상이다. v5는 checkpoint prefix를 복사하고, 이전 버전은 캡처한 완전한 JSONL EOF까지 복사하며 기존 projection rows/version을 보존한다. 원본은 읽기 전용이다. 소스는 rebuild에서 전체 rollout byte vector와 projection-step vector를 보유함을 보여주며 그 peak는 실측으로 검증한다. 새 profile은 `.m/artifacts/p12`, lifecycle은 `run:DJ-01:real-history-r12`다. 추천 단독 A, 페이지 조회 누적 B, 전체 조회 누적 C의 세 backend 세대로 비교한다. 동일 snapshot은 한 번 만들며 임시 DB의 갱신은 다음 세대로 이어진다. 따라서 B의 stale-index 갱신 비용과 C의 갱신 후 조회 비용을 구분한다. 본문은 영구 근거로 보존하지 않는다.

### 실제 이력의 확인된 결과와 진행 범위

최종 다중 실험 r16은2026-10-23T00:32:10.605Z~00:38:09.586Z(약6분), 실제 exit0이다. 설치 receipt와 일치하는 w11aa/0.162.0 Windows x64 엔진,2개 mock window owner·2개 connector, MCP0, account null을 확인했다. inference·도구 재실행·server request 없이6개를 복원했다. 최종 source snapshot은664turn/56,580items, JSONL1,066,653,489bytes, item JSON224,307,185bytes다. 추천 세션은 이 시점에468turn/38,863items·407.18MiB로 증가했으므로 아래 A의467turn snapshot과 완전히 같은 입력이라고 취급하지 않는다. 각 snapshot의 hash/count/version을 별도로 보존했다.

| r16 단계 | loaded 수 | native tree Private Bytes 중앙값(MiB) | 클라이언트 RSS 중앙값(MiB) |
|---|---:|---:|---:|
| 초기 |0|63.67|62.13|
| 추천 복원 |1|103.61|60.03|
| 1개 전체 항목 page 조회 후 |1|118.52|110.51|
| 2개 복원 후 |2|220.69|85.16|
| 2개 page 조회 후 |2|297.31|143.39|
| 4개 복원·page 조회 후 |4|354.55|178.89|
| 6개 복원·page 조회 후 |6|362.91|168.41|
| loaded6에서 각 이력 전체 조회 후 |6|430.00|179.17|
| 전체 unsubscribe90초 후 |0|360.14|156.91|

연속351표본의 native tree 관측 최대650.43MiB는 첫 추천 세션의 복원 구간이다. 전체 조회 구간 최대는515.00MiB, 클라이언트 RSS 관측 최대529.61MiB다. 표본 자체 질의시간 최대1,379.8ms에250ms 대기가 더해지므로 짧은 peak를 놓칠 수 있다. system free 최소9,978.28MiB로 guard에 걸리지 않았다. 모든 API 실패/거부 집계는 빈 객체다.6개 page/full 조회의 item 수는 모두 snapshot과 일치했다. 기존 v3 두 세션은 실제로 v5로 갱신됐고 item 수는 보존됐다. v3 갱신은 동작했지만 가장 큰 peak는 현재 v5 추천 세션에서 관측됐으므로 구버전 색인을 단일 원인으로 결론 내리지 않는다.

단일 항목 크기 조사에서는 두 번째 세션의 저장된 mcpToolCall 하나가17.59MiB였고 해당 세션에는1MiB 초과 항목8개가 있었다. 세 번째 세션도 최대1.95MiB,1MiB 초과4개였다. 추천 세션은 최대 약79KiB로, 작은 출력이 많이 누적된 다른 유형이다. `limit=100`은 개수 제한이므로 응답 byte 상한을 보장하지 못한다. 이 조사는 멈춘 임시 DB의 SQL aggregate만 사용했고 본문을 보관하지 않았다(`evidence/real-history-r16/item-size-analysis.json`).

| 가설 | 이번 판정 | 근거와 한계 |
|---|---|---|
| 긴 실제 이력을6개 열면 약4GiB가 된다 | 이 조건에서는 재현되지 않음 | 보유363~430MiB, 관측 최대650MiB. 실제 공용 프로필 전체·활성 부하는 다름 |
| 전체 이력 반환은 paging보다 큰 할당을 만든다 | 지지 | A에서 page후114MiB, full후327~409MiB, client도 증가. D의 full 추가분은 이미 확보된 heap의 영향을 받으므로 일반 절감률로 환산하지 않음 |
| 100개 item page면 대형 응답을 피한다 | 충분하지 않음 | 단일 item17.59MiB. 별도 byte budget·본문 lazy fetch 필요 |
| 구버전 색인 재구축이 비용을 만들 수 있다 | 실제 갱신 확인, 전체 peak 원인 미확정 | v3→v5와 counts 보존 확인. 소스는 전체 suffix byte/step vector를 사용. v5 추천 복원 peak의 정확한 소유자는 남은 조사 대상 |
| unsubscribe하면 메모리가 즉시 초기값으로 돌아간다 | 기각 | 정상 loaded0 이후에도 A319MiB/D360MiB. allocator·cache·다른 참조의 구별과 leak 판정은 추가 heap 계측 필요 |
| 반복 full-read마다 메모리가 계속 선형 증가한다 | A의3회로는 지지되지 않음 | 327→409→402MiB. 무한 반복·실제 UI는 미검증 |

우선순위는 다음과 같다. 제품 변경은 이번 요청에 포함하지 않는다.

1. 기존 paginated/tail hydration을 우선 경로로 유지하고 full compatibility/fallback의 실제 호출 조건·응답 bytes를 계측한다. metadata/visible window만 우선 반환하고 전체 Vec<Turn> 구성·직렬화·connector 전달의 중복을 줄인다. A에서 약300MiB 보유량 차이가 있었으나 제품 전체의 절감 보장은 아니다.
2. 큰 command/MCP 결과는 요약·크기·본문 참조를 먼저 보내고 펼칠 때 읽는다. 원본 본문과 재조회 가능성을 보존하며 응답 byte budget·oversize-item descriptor를 검토한다. 저장된 MCP 결과와 실행 중 MCP 프로세스는 서로 다른 비용이다.
3. projection rebuild의 전체 byte/step vector를 bounded processing으로 바꾸는 후보를 검토한다. 기존 atomic projection/checkpoint 계약을 보존해야 하며 단순 부분 commit으로 바꾸면 안 된다. 추천 v5 resume peak는 context·projection·transport 단계별 aggregate 계측으로 먼저 귀속한다.
4. 실사용 공용 엔진에 loaded root/agent 수, context bytes, pending event bytes, subscriber와 unload 보류 이유, SQLite/cache/allocator aggregate를 연결한다. 이번 loaded0 잔류를 무조건 leak으로 부르거나 process working-set trim을 근본 해결로 삼지 않는다. 기존 MCP lazy-start 후보도 이전 실측 근거에 따라 유지한다.

한계: API용 클라이언트는 page를 폐기하고 자신의 GC를 수행하므로 실제 Webview state/DOM/이미지 캐시를 재현하지 않는다. 원본 전체4.4GB projection DB·수천 세션·fork/하위 agent·실행 중 추론·queue backpressure·다중 실제 창은 복사하지 않았다. MCP는 껐고 긴 독립 root만 골랐다. 따라서 실사용 엔진 약4GiB의 원인이나 누수를 확정할 수 없다. Windows 로컬만 검증했다. 장시간 누적과 활성 부하를 다루려면 위 aggregate 관측 및 실제 UI 경로의 후속 비교가 필요하다.

정리 완료: 수치/ID/hash 보고서31개와 driver source를 work/evidence에 독립 보관했다. native register→review(모든 blocker[])→명시적 delete→실제 remaining=false→supported finalize를 완료했다. 새8개 group의11항목, logical2,739,535,005bytes를 삭제했으며 이는 디스크 논리 크기이고 RAM 회수량이 아니다. p11/p12/p16와 테스트 DB/대화 복사본/개인 stderr는 제거됐다. 원본 사용자 profile과 실제 작업 프로세스는 정리 대상이 아니었다. 작은 관리 control evidence와 수치 근거는 감사 목적으로 보관한다. `evidence/real-cleanup-{register,review,apply,finalize}.json`이 실제 결과다. 이전 최초 native-a의 defer는 이번 작업에서 변경하지 않았다.

A 단독 비교는 완료됐다. run real-history-r12 전체는 뒤의 B 초기화에서 exit1이므로 전체 성공으로 기록하지 않는다. A의 정상 종료와 유효한 checkpoint/연속 표본은 독립적으로 보존했다. 추천 복사본은467turn/38,753items, JSONL405.67MiB, SQLite item JSON87.21MiB다. commandExecution12,415개가84,085,230bytes(약92%)이며 사용자 발화 자체는21,210bytes다. 저장된 명령 출력이 주요 이력 payload이지만 이 비율은 heap 소유 비율이 아니다.

| 추천 세션 단계 | native tree Private Bytes 중앙값(MiB) | 클라이언트 RSS 중앙값(MiB) |
|---|---:|---:|
| 초기 |58.74|62.07|
| excludeTurns 복원 |97.70|61.93|
| 최신 turn metadata page |97.70|61.68|
| 전체 항목388page 순차 조회·폐기 |114.45|116.08|
| 전체 이력1회 조회 |326.87|368.75|
| 전체 이력2회 조회 |409.22|349.84|
| 전체 이력3회 조회 |402.22|354.65|
| unsubscribe90초, loaded0 |318.66|128.44|

native tree는 실제 backend와 connector 합계이며 측정 driver·PowerShell·mock host를 제외한다. 같은 시점의 합이 아닌 별도 peak를 합산하지 않는다. 연속 표본에서 복원 구간 최대643.88MiB, 반복 전체 조회 구간 최대552.48MiB, 클라이언트 RSS 최대526.76MiB가 관측됐다. polling은 진짜 최대를 보장하지 않는다. 전체 응답은91,726,461bytes이며 매번467turn/38,753items를 정확히 반환했다. 페이지 조회는96,090,176bytes를388개의 응답으로 나누어 받고 폐기했다. 클라이언트는 checkpoint에서 자신의 GC만 수행한다. 실제 UI의 누적 캐시/DOM 비용을 재현한 수치는 아니다.

전체 조회의 큰 비용은 실측으로 지지된다. frozen thread_processor.rs의 paginated_thread_full_turns는 모든 page를 Vec<Turn>에 모으고 Full item view로 반환한다(3491 부근). 최신 compaction 이후 raw suffix는2.61MiB이며 복원 후 보유량은 낮지만, 복원 순간643.88MiB의 정확한 소유자는 미확정이다. 소스 추적에서 정상 v5/checkpoint==EOF 복원은 suffix context와 metadata를 읽고 전체 JSONL 재독회를 요구하지 않으므로 이 peak를 전체 파일 로드로 단정하지 않는다. 반복2→3회의 보유량은 증가하지 않았지만3회만으로 누수를 배제할 수 없다. loaded0에서도 남는318.66MiB는 allocator 보유·cache·다른 참조를 heap 관측 없이 구분할 수 없다.

다중 비교의 변경: p12 재사용 시 B는 기존 account-state path 소유 충돌로 초기화 실패했다(r12 후반/r13, 모두 stopped, exit1). 창별 고유 경로로 바꾼 r14는 첫 resume가-32600으로 거부됐고 종료 관측 assertion도 실패했다. 원래 report의 producerStopped=false를 보존했으며, 이후 모든 tracked child close와 관측 process generation·profile 경로 관련 프로세스 부재를 재검증해 supported closeLifecycle로 failed/stopped를 기록했다(`evidence/real-r14-stopped.json`). PID 부재만으로 복구하지 않았다. r14의 resume 거부 사유는 미확정이다. r16은 새 p16 snapshot과 단일 backend에서1/2/4/6개 resume→page를 먼저 비교한 후 loaded6 상태에서 각 전체 이력을 조회한다. 별도 C backend 비교는 수행하지 않으며, 이 변화로 재사용 fixture의 상태가 결과에 섞이는 것을 줄인다. 원본·제품·설치는 변경하지 않는다.

# Azrael 메모리 분석

## 요청·권한·플랫폼
- RAM 사용량 증가 원인, 최적화 우선순위, 회귀 위험 및 검증 방법을 분석한다.
- 읽기 조사와 격리 프로필 실측, 작업 전용 검증 driver 작성, 테스트 프로세스 정상 종료·생성물 정리를 수행한다. 실제 사용자 프로필·대화·계정·설정은 변경하지 않는다. 제품 최적화·제품 빌드·실사용 설치·덤프는 제외한다.
- 추가 권한: 사용자가 실제 세션 대화 내역을 임시 프로필에 복사해 여러 개 로드하는 재분석을 명시적으로 요청했다. 원본은 읽기 전용이며 인증·설정·실행 중 작업·예약은 복사하지 않는다. 과거 도구 호출 재실행, 새 추론 및 사용자 작업 종료는 제외한다. 대화 내용 자체를 보고서/콘솔에 출력하지 않고 크기·개수·메모리만 기록한다.
- 공통 구조를 검토하되 실제 관측은 Windows 11 x64 로컬 환경 한정. Linux/macOS 절감 효과는 미검증이다.
- 기존 미커밋 변경을 보존한다. 실행 w11aa의 build-info.json이 선택하는 artifacts/build/b13/engine을 런타임 조사 기준으로 삼는다. 현재 engine/과 구별한다.

## 작업·의존성·산출물
- root: 프로세스 역할·버전·메모리 표본, 호스트/provider 및 파일 기반 관측, 종합 판단.
- engine_memory: frozen engine의 thread/agent/history/queue 수명 읽기 전용 조사. 위 소스 신원 확인 완료 후 시작.
- 종합 판단은 실제 수치와 엔진 코드 조사 결과에 의존한다. 모든 결과는 이 기록에서 통합한다.

## 검증·완료 조건
- Private Bytes와 Working Set을 구분하고 VS Code 전체를 Azrael로 귀속하지 않는다.
- 확인된 보관/복사 구조와 실제 누수 의심을 구분한다. 시간에 따른 표본은 통제된 누수 재현이 아니다.
- 파일/기호 근거, 기대효과의 범위, 우선순위, 보존할 기능, 후속 측정안을 제시한다.
- 제품 동작을 변경하지 않으므로 설계 문서·제품 테스트·빌드·설치는 변경/수행하지 않는다.

## 관측 결과와 한계

실측 환경: Windows 11 Home 10.0.26200 x64, 물리 메모리 31.92 GiB, VS Code 1.143.0. 한국 시간 2026-10-23 01:02:04~01:04:11에 20초 간격 목표로 CIM 표본 7개를 수집했다(질의 시간을 포함한 실제 간격 약 21초). 분석 중인 대화와 다른 작업이 실행 중이므로 통제된 유휴 측정이 아니다.

실행 엔진은 PID 61016, `artifacts/build/b13/artifacts/releases/w11aa/engine/azrael.exe`이며 2026-10-22 19:50:02 KST 시작했다. `build-info.json`은 `artifacts/build/b13/engine`과 engine 0.162.0을 지정한다. 엔진/bridge/code-mode 실행 파일 세 개의 SHA-256은 release receipt와 일치했다. 전체 frozen source를 다시 해시하지는 않았다. 현재 primary `engine/`의 변경을 설치된 동작으로 간주하지 않는다.

| 관측 대상 | 개수 | Private MiB | Working Set MiB | 귀속과 해석 |
| --- | ---: | ---: | ---: | --- |
| 공용 Azrael 엔진 | 1 | 4316.4 | 2664.6 | 직접 확인된 가장 큰 Azrael 프로세스 |
| Window Use MCP | 50 | 1111.8 | 1287.3 | 엔진의 직접 자식. 필요한 작업인지 여부는 미확인 |
| node_repl | 50 | 146.3 | 448.5 | 엔진의 직접 자식. REPL 세션 상태 보존 조건 확인 필요 |
| code-mode host | 6 | 198.0 | 187.7 | 프로세스 수명과 상태 보존 조사 대상 |
| engine connector/기타 stdio 엔진 | 8 | 211.7 | 263.0 | 공용 backend와 구분. 경량 connector 6개 외 다른 stdio 경로 포함 |
| bridge | 6 | 28.8 | 67.5 | 전용 비용이 상대적으로 작음 |
| VS Code renderer 전체 | 18 | 6485.8 | 5263.7 | Azrael 외 편집기·다른 Webview 포함 |
| VS Code utility 전체 | 16 | 2778.1 | 1538.8 | 확장 호스트·watcher·다른 서비스 포함 |

위 표는 `process-summary.json`의 한 시점이다. MCP+REPL 전용 할당은 약 1.23 GiB이며, 앞선 표본에서는 약 1.27 GiB였다. 실제 물리 RAM 회수량이나 종료 가능한 양으로 해석하지 않는다. 같은 release 경로의 다른 Node 프로세스 6개는 581.9 MiB private이지만 역할을 충분히 검증하지 않아 주요 원인으로 귀속하지 않는다. Code.exe 프로세스 전체는 약 10.18 GiB private이며 Azrael 단독 사용량이 아니다. 별도 native 자식 실행 파일까지 포함한 전체 VS Code process tree 합계는 아니다. `code --status`는 6개 workspace 창을 보여주었고 원본 Codex·언어 서버 등도 함께 실행되고 있었다.

Private Bytes는 프로세스 전용 committed memory이며 실제 상주 RAM과 다르다. Working Set은 현재 상주 페이지로 공유 페이지도 포함한다. 따라서 여러 프로세스 Working Set의 합은 물리 RAM의 정확한 순증분이 아니다. 참고: [Microsoft 메모리 지표](https://learn.microsoft.com/en-us/windows/win32/api/psapi/ns-psapi-process_memory_counters_ex).

7개 표본에서 엔진 private은 4193.5→4311.5 MiB(+118.0), Working Set은 2519.1→2657.0 MiB였다. 마지막 약 42초의 private은 거의 일정했다. 스레드는 317→323, handle은 2897→2858이다. 이 자료만으로 누수, 시간당 증가율, 모든 메모리의 소유 객체를 확정할 수 없다. 높은 live state, 일시 복사, 대기 큐, allocator의 재사용용 보관을 구분하려면 후속 계측이 필요하다.

## 호스트와 provider의 코드 근거

### 숨김 Webview 해제는 이미 존재한다

- frozen `scripts/webview-idle.cjs:35`는 기본 1시간의 hidden timeout을 사용한다. `:55`의 native reservation gate와 `:66`의 UI snapshot gate가 실패하면 새 1시간을 시작한다.
- `extensions/azrael-ex/src/accountService.ts:104`는 해당 연결의 예약이 모두 resumed/cancelled일 때만 해제를 허용한다.
- `scripts/webview-idle.cjs:14`~`:29`는 현재 화면 외 cached conversations의 작업·큐·미확인 제출·활성 goal도 검사한다. 하나라도 보호 상태면 해당 renderer를 보존한다.
- 설치된 `out/extension.js`에서 idle transform marker와 release command 존재를 확인했다. 실제 lifecycle 성공 빈도·실패 이유·개별 화면의 절감량은 확인하지 않았다.
- 제안: 기존 기능에 해제 시도/보류 이유·문서 크기 계측을 연결하고, 완전히 유휴인 화면에 한해 압력 기반 대기시간 또는 사용자가 선택하는 짧은 대기시간을 검토한다. 전역 gate를 좁히려면 큐·예약·승인의 실제 소유 관계부터 분리해야 한다. 활성 작업의 화면을 무조건 해제하지 않는다.

### Window Use MCP 중계 계층의 중복 비용

- frozen `scripts/window-control-mcp.cjs:181`의 `createProtocol`은 tool 요청을 thread metadata와 permission metadata로 검증하고 기존 relay로 전달한다. `:206`의 `runProtocol`은 stdio 입력의 생애 동안 프로세스를 유지한다.
- `:142` 부근 relay는 thread별 window session 파일을 읽고 인증된 host IPC로 전달한다. MCP 중계와 실제 Windows control backend는 별개다.
- 50개 프로세스 중 상당수가 미사용/완료 thread 소유라면 lazy start와 안전한 idle teardown의 효과가 클 수 있다. 단순히 50개를 전부 불필요한 프로세스로 간주할 수는 없다.
- 장기 대안은 중계의 공용화지만, transport 인증·thread별 승인·nonce·요청 순서·취소·고장 격리를 재설계해야 한다. 상태가 있는 node_repl의 전역 변수/모듈/자원은 thread 간 공유하면 안 된다.

### provider 요청의 일시 복사

- frozen `providers/opencodex/inference.ts:663`~`:666`은 stdin chunks → Buffer.concat → UTF-8 문자열 → 줄 분리 → JSON.parse 경로를 사용한다.
- `:479`는 adapter가 만든 요청 문자열을 `JSON.parse`하여 wire 객체를 추가로 보유한다. 입력 객체·변환된 메시지·직렬화 요청이 한 turn에서 함께 살아 있을 수 있다.
- `providers/opencodex/inference-mapping.mjs:8`~`:10`에는 8 MiB 텍스트/32 MiB 요청 제한이 존재한다. Rust `core/src/devin/native_runtime.rs:35`~`:60`은 stream capacity 64, frame 8 MiB, provider별 request 한도와 output 한도를 둔다. 무제한이라고 판단하지 않는다.
- 제안: 기존 제한과 요청 단위 helper 수명을 보존하면서 중간 Buffer/문자열의 조기 해제, framing의 증분 파싱, provider별 불필요한 parse/stringify 제거를 검토한다. 효과는 큰 context와 동시 turn의 peak에서 측정해야 하며 엔진의 4 GiB 지속 보유를 이 경로만으로 설명하지 않는다.

## 후속 측정과 수용 조건

1. 현재 loaded window/thread/agent, terminal/active/waiting 상태별 개수와 보유 history bytes, MCP별 PID·last-use·inflight 요청 수를 aggregate로 기록한다. 원문 대화·인증·이미지를 로그에 남기지 않는다.
2. 제품과 같은 frozen package의 isolated state에서 대화 열기→완료→다른 대화로 이동→닫기를 1/10/50회 반복한다. 완료 agent와 MCP/REPL 수, private/working set, 객체/queue bytes, dispose latency를 함께 본다. 실제 사용자 세션을 종료하는 실험은 별도 승인 대상이다.
3. 큰 tool output/이미지/history, 병렬 agent, 느린 UI 소비자·연결 끊김을 분리해 peak와 backlog를 확인한다. 일반 완료·취소·오류·연결 재시도 모두에서 자원 수가 회복되는지 검증한다.
4. 해제 후 다시 열기, 재개, approval, queue, root reservation, 미확인 부작용, account/window 격리 및 REPL 상태를 보존한다. 처리량·첫 응답/재개 p95도 측정해 메모리 절감과 지연을 함께 평가한다.
5. Windows 제품 프로세스 수명/IPC를 필수 회귀로 두고 공통 변경은 Linux x64/macOS ARM64의 native 수명도 각각 검증한다. 현재 보고서에는 다른 OS의 실측 근거가 없다.

통과 목표는 일정한 workload에서 완료/닫힌 thread에 비례해 MCP와 loaded state가 무한 누적되지 않고 안정된 상한에 도달하는 것이다. 정확한 MiB 목표와 절감률은 baseline 실험 후 정한다. 시스템 Working Set 강제 축소, V8 heap 한도 강제 하향, 로그/디스크 캐시 삭제, 주기적 재시작은 상태 보유 원인 분석을 대체하지 않는다.

## 보관과 실행 범위

`memory-samples.json`, `process-summary.json`, `runtime-identity.json`은 이 분석의 근거로 유지한다. 표본 수집과 실행 파일 hash 검사는 exit 0이었다. 제품 코드·설정은 변경하지 않았고 빌드·설치·전체 회귀 테스트·사용자 프로세스 종료·heap dump는 수행하지 않았다. 격리 테스트의 소유 프로세스만 정상 종료하고 생성물은 관리 도구로 정리한다. 계획 생성용 임시 본문은 일반 삭제로 제거했다. 기존 작업의 변경은 보존했다.

## 엔진 조사 결과

대상은 release receipt의 frozen `artifacts/build/b13/engine/codex-rs/`이다. 아래 경로는 이 디렉터리에 상대적이다. 읽기 전용 조사 결과를 재사용했으며 구현·성능 검증 결과와 구분한다.

| 경로와 기호 | 확인된 구조 | 증가 조건과 판단 한계 |
| --- | --- | --- |
| `core/src/thread_manager.rs:417`의 ThreadManagerState.threads, `:2600`의 등록 경로 | `Arc<CodexThread>`를 보관하며 일반 loaded-root 전체 상한은 없음. explicit removal/idle unload/정상 bounded shutdown 경로 존재 | 대화를 많이 로드한 뒤 안전한 해제 조건에 도달하지 않으면 session·history·MCP가 함께 남을 수 있다. 격리 loaded 개수는 측정했으며 실사용 엔진의 loaded 개수는 미측정 |
| `core/src/state/session.rs:68`, `core/src/context_manager/history.rs:91` | 세션별 ContextManager의 response-item vector 보관. compaction/rollback/reset에서 교체/정리하며 이 보관층에 독립 byte/item 상한 없음 | 큰 이력·도구 출력·이미지 등에 비례하는 상태 보유 가능. 기존 tool-output truncation은 존재하므로 모든 출력이 무제한이라고 해석하지 않는다 |
| `core/src/session/mcp_runtime.rs:379`, `codex-mcp/src/connection_manager.rs:635` | 일반 세션 MCP는 Eager, subagent는 LazyWhenCached. cache가 있어도 plugin/가시 tool 조건 등에 따라 즉시 시작할 수 있음 | 일반 대화 로딩 수가 MCP 프로세스 수를 배수로 늘릴 수 있다. 50쌍을 50개 실행 중 agent 또는 50개 방치된 thread로 단정하지 않는다 |
| `core/src/session/handlers.rs:356`, `codex-mcp/src/connection_manager.rs:930` | session shutdown은 prewarm 중지 후 MCP clients shutdown 수행 | cleanup 구현이 없는 것이 아니라, 보유 중 session이 실제로 언제 shutdown/unload되는지가 핵심 |
| `core/src/session/mod.rs:618`, `:2669`, `core/src/codex_thread.rs:851` | thread event 채널은 async_channel::unbounded. send 시 상한 없음. queued_event_count는 존재 | listener가 느리거나 막히면 대형 payload가 적체될 수 있다. 실제 적체/byte 점유는 미측정 |
| `app-server/src/thread_state.rs:129`, `:372` | listener command는 Tokio unbounded channel. active-turn history builder는 완료/defer/teardown 때 reset | active turn·listener 지연에 따른 비용. 완료된 모든 turn을 builder가 영구 보관한다고 볼 근거 없음 |
| `app-server/src/azrael_shared_server.rs:234`, `:388`, `:762` | owner context마다 processor를 map에 보유. connection closure와 context teardown은 다른 수명 | 다른 창이 엔진을 살려두면 이전 owner context가 남을 수 있다. rejoin·계정/승인·작업 routing 보존 목적이 있으므로 즉시 삭제는 위험 |
| `core/src/agent/control/mailbox.rs:15`, `:81` | unloaded agent의 pending mail은 Vec에 쌓이며 explicit shutdown에 정리 | 미소비 메시지가 쌓일 때 증가 가능. 읽지 않은 메시지 삭제는 허용할 수 없음 |

이미 있는 보호 장치: V2 subagent residency는 기본 tree당 resident 3개이고 eligible idle/completed agent만 eviction한다(`core/src/config/mod.rs:257`, `core/src/agent/control/residency.rs:130`). 이 제한은 일반 loaded root 전체를 제한하지 않는다. MCP catalog cache는 32개/30분 TTL이다(`codex-mcp/src/tool_catalog_cache.rs:33`). Guardian review history도 종류별 128항목/4 MiB 제한이 있다(`guardian-context/src/history.rs:25`). 공용 context event/outgoing relay는 capacity 128로 bounded이다(`app-server/src/azrael_shared_server.rs:425`, `:577`). 따라서 모든 cache·채널에 일괄 상한을 새로 넣는 접근은 근거가 약하다.

대기 큐의 일반 원리는 [Tokio 공식 문서](https://docs.rs/tokio/latest/tokio/sync/mpsc/fn.unbounded_channel.html)에서도 확인했다. 다만 Core event 큐는 async_channel이고, Tokio 문서는 app-server command 큐와 일반적인 unbounded 적체 위험을 뒷받침한다. 라이브 적체가 확인된 것은 아니다.

## 권고 우선순위와 영향

| 순서 | 제안 | 기대효과의 근거 | 보존 조건·trade-off |
| --- | --- | --- | --- |
| P0 | loaded root/context/agent 수, history bytes, event backlog bytes, MCP last-use/owner 및 Webview 해제 보류 이유를 먼저 계측 | 4.2 GiB 엔진의 실제 소유 범주와 회수 대상을 좁힌다. 수집 자체가 절감 기능은 아님 | aggregate만 수집. 현재 trace/queued_event_count/기존 Webview lifecycle 진단 재사용. 승인/작업을 변경하지 않음 |
| P1 | 기존 idle-unload를 활용해 완료·미사용 root/context를 안전하게 해제하고 MCP shutdown이 따라오는지 검증. 일반 MCP에도 가능한 범위에서 lazy start 확장 | 엔진 session/history와 약 1.2 GiB MCP+REPL 관측을 함께 줄일 수 있는 구조적 경로 | 저장 완료·진행 turn/child/queue/예약/approval·미확인 부작용·미소비 mail을 검사. REPL 상태가 필요한 세션은 보존. 재진입 지연 증가 가능 |
| P2 | 기존 Webview idle 정책의 설치본 성공/보류 비율부터 측정. 완전 유휴 화면의 압력 기반/짧은 timeout과 대화별 gate 검토 | renderer 전체에 큰 비용이 관측됨. 이미 구현된 lifecycle을 개선할 수 있음 | 18개 renderer 모두가 Azrael은 아님. active 작업·draft/attachment·scroll·queue client ownership·복원 handshake 보존. cold restore 비용 증가 |
| P3 | Core event와 listener command에 byte-aware budget·생산 속도 제어 도입 | unbounded 적체 경로를 제한하고 소비자 지연 때 시스템 안정성 개선 | async_channel/Tokio의 기존 bounded 기능부터 검토. token delta/대체 가능한 상태만 안전하게 합치고 승인·결과·terminal 순서를 유지. 잠금을 보유한 await와 제어 이벤트 교착 회귀 필수 |
| P4 | provider framing/JSON 중간 복사와 큰 이력의 메모리 표현 최적화 | context가 크고 동시 turn이 많을 때 일시 peak 감소 가능 | protocol/capability/tool schema·reasoning replay·image·hash·요청 한도 유지. 전체 엔진 지속 보유의 주원인으로는 아직 입증되지 않음 |

현 단계에서 절감률·고정 RAM 목표는 제시하지 않는다. Window Use MCP 약 1.1 GiB private은 최적화 대상의 현재 보유 비용이며, 그 전체가 회수 가능하다는 뜻은 아니다. 해제 가능한 세션 비율과 재기동 비용에 따라 실제 절감이 달라지므로 isolated 반복 workload로 검증해야 한다.

현재 사용자가 선택할 구현 결정은 요구하지 않는다. 이번 산출물은 분석이며 P0~P4는 후속 구현 제안이다. 전체 cache 삭제, 컴팩션 비율 변경, subagent 최대 수 일괄 축소, 원본 Codex 비활성화는 분석 결과에서 자동 승인되는 조치가 아니다.

## 최종 판단

격리 실측은 대화별 MCP의 선행 시작 비용을 확인했다. 10개 대화에서 MCP 유무에 따른 전체 native process tree Private Bytes 차이는 298.3MiB였다. 반면 MCP 없는 빈 대화 20개와 단일 8MiB/64턴 이력은 각각 86.6MiB, 113.4MiB 수준으로, 실제 공용 엔진의 약4.2GiB를 재현하지 못했다. 정상 idle 대화는 기존 60초 지연 해제 경로를 통해 90초 표본에서 loaded0/MCP0으로 회수됐다. 따라서 새 idle unloader 도입이나 30초 보유를 누수로 단정하는 제안은 철회한다.

우선순위는 MCP의 안전한 lazy start, 실제 엔진의 loaded/subscriber/보류 이유·이력 크기·queue bytes 계측, 기존 paging을 이용한 전체 이력 materialization 축소다. UI 숨김·닫기 절감량, 활성 추론/streaming·느린 consumer의 peak/backlog, maintenance metadata 비용은 미검증이다. 제품 변경 없이 확인한 범위를 넘어 절감률이나 4GiB의 단일 원인을 확정하지 않는다.

## 격리 실측 실행 계획

### 실제 세션 재실측 입력과 순서

사용자가 지정한 `azrael://threads/01a1334d-6a69-7821-a164-da04f3cfa71f`를 우선한다. 사용자 state metadata에서 paginated/openai인 독립 root를 골라 최대6개를 사용한다. fork/history_base/parent가 있는 세션은 이번 묶음에서 제외해 원본 ancestor를 읽는 오류를 피한다. 추천 세션은 사전 관측에서 JSONL 약424MB,465turn/38634items이며 실행 중 증가할 수 있으므로 실제 실험은 별도 SQLite 읽기 transaction의 projection checkpoint 시점으로 고정한다.

root는 `real-history-snapshot.mjs`의 원본 읽기 전용 snapshot과 전체 결과 통합을 소유한다. real_history_contract는 frozen source의 paginated 저장/로드 계약 및 설치 UI caller만 읽는다. real_history_driver는 `real-session-memory-probe.mjs`만 작성하며 root의 준비 완료 확인 전 실행하지 않는다. 후속 native 비교는 snapshot helper의 count/type/hash/path 검증과 driver syntax 검증에 의존한다. root가 생성물 정리를 소유하며 자식은 재위임하지 않는다.

전체 사용자 DB를 복제하지 않는다. 실제 원본은 `DatabaseSync(readOnly:true)`로 열고, 선택한 threads/dynamic tool descriptors와 해당 history projection의4개 테이블만 새 DB로 옮긴다. schema/migration checksum은 보존한다. `thread_history_projection_state`와 turn/items가 같은 SQLite 읽기 transaction에 있으며, raw JSONL은 그 checkpoint byte offset까지의 완전한 prefix로 복사한다. 서로 다른 두 DB와 로그 파일의 단일 원자적 snapshot이라고 주장하지 않는다. 마지막 newline·길이·SHA256·type분포·count를 확인한다. snapshot의 state rollout_path/cwd는 자기 home/workspace로 바꾸고 project/section 소속을 해제한다. account·credential·config·root reservation·실행 작업 상태는 복사하지 않는다. 본문과 이력 모드는 유지한다.

검증은 추천 세션 단독의 metadata/resume/page/full-read·반복 조회·90초 unsubscribe 후 회수, 새 backend에서1/2/4/6개 누적 로드·조회·회수를 비교한다. page 경로와 compatibility 전체 조회를 구분하며 실제 UI caller가 어느 경로인지 별도 확인한다. MCP는 이전 실험으로 비용을 확인했으므로 이번에는 제거해 이력 비용을 분리한다. 최신 원본 이력 복사본은 한 번 만들고 backend만 재시작해 중복 생성비를 줄인다. 제품 최적화와 새 제품 빌드는 하지 않는다.

이번 관측 시작 시 여유 메모리는 약9.76GiB였다. 실제 수GiB 가설을 시험하기 위해 기존 합성 실험의2GiB 상한 대신 소유 native tree4GiB/시스템 여유3GiB/driver RSS2GiB를 중단 기준으로 둔다. 자원 압박 시 소유 연결과 mock host만 정상 종료하며 사용자 프로세스는 종료하지 않는다. endpoint/PID/생성 시각과 descendant 부재를 검증한다. profile은 `.m/artifacts/p11`, lifecycle은 `run:DJ-01:real-history-r11`로 생성 전에 등록한다. 메시지 본문을 콘솔·보고서로 저장하지 않고 수치·식별자·hash만 보존한다. 원본 복사본은 결과 수용 후 관리 도구로 정리한다.

사전 소규모 SQLite4-thread fixture 검사(`check-real-history-snapshot.mjs`, 자체 lifecycle real-snapshot-unit-r11)는 실제 exit0이다. 이 검사는 schema/BLOB migration checksum 복사, 정확한 projection prefix/hash, type/count, 격리 경로와 project/section 해제를 확인했다. 실제 사용자 본문은 이 사전 검사에 사용하지 않았다.

- 입력: 현 실행 릴리스 w11aa의 receipt와 실행 파일. 엔진 소스는 같은 b13 frozen root. 기존 사용자 상태를 복사하지 않는다.
- native_probe owner: 작업 전용 `native-memory-probe.mjs`, lifecycle `run:DJ-01-azrael-memory-analysis:native-r1`, runRoot `artifacts/tasks/DJ-01-azrael-memory-analysis/runs/native-r1`, 짧은 임시 프로필 `artifacts/tasks/mj1` (사전 부재 확인). Windows socket 길이 제한 때문에 프로젝트 안의 짧은 관리 경로를 사용한다.
- root owner: VS Code 격리 프로필 준비, 실제 renderer/extension-host 측정, 결과 통합 및 cleanup. native 측정과 UI 측정은 같은 호스트에서 순차 실행한다. UI 준비만 병행한다.
- native 비교: MCP 없음(0/1/5/10/20 loaded roots), 실제 Window Use MCP+node_repl(0/1/5/10 roots), 합성 이력 크기별 load/read, unsubscribe 후 loaded count와 자식 보유, 마지막 window owner 종료 후 소유 자식 종료. 실제 API·인증·추론 호출은 하지 않는다.
- UI 비교: 같은 패키지의 별도 user-data/extensions/native state에서 화면 0/1/다수, 숨김/닫기, 가능하면 큰 이력과 자연 GC 대기. 기존 원본 user-profile과 비교하지 않고 격리 baseline 내 차이를 측정한다. 실제 제품 경로와 테스트 한정 계측 차이를 명시한다.
- 안전·자원 조건: 테스트 전용 process identity·경로·생성 시각을 추적한다. 시스템 여유 2 GiB 미만 또는 native 테스트 private 합계 2 GiB 초과 시 확대를 중지한다. 활성 사용자의 프로세스는 종료하지 않는다.
- 초기 준비/캐시 비용과 반복 증가를 구분하고 3회 표본의 중앙값·프로세스 수·loaded count를 함께 제시한다. 사용자 작업의 간섭이 있는 호스트이므로 system free 변화만으로 효과를 판단하지 않는다.
- 이벤트 큐 byte 지표가 기존 바이너리에서 노출되지 않으면 미검증으로 남기고, 느린 소비자/연결 단절의 process-level 반응과 직접적인 queue 누수 증명을 구분한다.
- 완료 기준: 가설별 지지/반증/미검증 판정, 추가 최적화 후보, 실제 exit codes·실험 identity·재현 입력·측정 한계 보존, 생성 프로필/확장/캐시/로그 및 테스트 프로세스 정리 결과 확인. 필요한 작은 근거는 work 기록에 남긴 후 전체 generated group을 관리 도구로 검토/정리한다.

### 측정 관리 경계

공용 catalog.lock은 Windows Restart Manager가 실사용 엔진 PID 61016의 열린 파일로 확인했다. 이를 삭제·변경·우회하지 않는다. 최초 native-r1 시도는 등록 전 exit 1이며 테스트 프로세스나 프로필을 생성하지 않았다.

독립 실험의 등록소까지 격리하기 위해 최초 관리 프로젝트 `artifacts/m`을 만들었다. 생성 전 실제 부재와 주 registry의 ancestor/descendant 소유 기록 0개를 확인했다. 주 프로젝트의 registry·잠금·산출물은 수정하지 않는다. 생성한 control config/registry는 이번 실험 소유이며, 실험 프로필·확장·캐시·로그 제거 후 필요한 작은 실행 근거를 work 문서에 보존한다.

테스트 실행 순서는 native a→b→c→VS Code profile이며, 다른 실사용 작업의 CPU·디스크 경쟁 가능성을 결과 한계로 남긴다.

바이너리의 실제 socket basename은 24 hex 자리여서 처음 계산한 20자리보다 4 bytes 길었다. native-a는 111-byte endpoint 사전 검사에서 중단되었으며 connector/backend 미실행이다. 다음 native-a-r2는 관리 루트 직하 홈을 등록하려 했으나 `recordLifecycle`이 `<root>/artifacts/*`만 허용하여 mkdir·native 실행 전에 exit 1로 종료됐다. managed_roots 설정만으로 이 API 제약을 바꿀 수 있다는 앞선 판단을 정정한다.

현재 관리 루트는 프로젝트 안의 `.m`이다. 생성 전 부재와 주 registry의 중첩 소유 기록 0개를 확인했으며 config는 UTF-8 BOM 없이 만들었다. 상태 홈은 허용 경로인 `.m/artifacts/a,b,c`(native), `d,e`(UI)이다. 실제 24자리 basename 기준 endpoint는 102 bytes로 제한(<108)을 충족한다. 새 native run ID는 `native-a-r3/b-r3/c-r3`이다. 이전 실패 기록은 보존·검토 후 함께 정리한다. 공용 helper의 제품 동작은 변경하지 않았다.

UI 실행은 설치 확장의 복사본과 synthetic native history만 사용한다. 복사본에는 측정용 전역 참조, 가짜 인증 응답, built-in provider 지정을 넣고 외부 Devin CLI 계정 조회를 생략한다. 원본 설치는 변경하지 않는다. 기본 정책 실행 후 별도 새 프로필에서만 idle 지연을 1시간→5초로 줄여 기존 해제·복원 기구를 검증한다. 이 가속 실행은 제품 기본 설정에서의 1시간 실측과 구분한다. PID와 생성 시각을 함께 저장하여 종료 확인 때 고아 자식 프로세스도 확인한다.

추가 사전 실행에서 시작 인수에 따른 endpoint identity 불일치(r3), CIM 생성 시각의 100ns→1µs 절삭(r4)을 발견해 드라이버에서 수정했다. 원래 실패 결과는 유지하고 실제 receipt와 프로세스 정체성에 근거해 소유 backend 종료를 확인했다. r5는 Azrael host의 `model_providers` override 금지로 측정 전에 실패했다. frozen `core/src/config/mod.rs:3833`의 호스트 소유 endpoint/auth 정책을 유지한다. 이후 native는 built-in openai, 무인증, no-turn 방식이며 이력은 offline JSONL replay로 전환했다. UI에도 built-in provider만 지정하고 `turn/start`를 차단한다.

r6에서 roots-0→1 smoke는 통과했으나 unsubscribe 후 loaded count=1이 30초 동안 유지됐다. 이 RPC가 root unload를 수행한다는 초기 실험 가정을 정정한다. frozen app-server의 unsubscribe 구현은 connection subscriber만 제거한다. 이후 matrix의 성공 기준은 unsubscribe 후 상태를 실측하는 것이며 loaded=0을 요구하지 않는다. 마지막 소유 window 종료 시 전체 backend·관측 자식 종료 조건은 유지한다. 이 발견을 fixture 실패와 구분하며 heap leak으로 단정하지 않는다.

## 격리 실측 결과 — native 완료, UI 비교 미검증

| 검증한 가설 | 판정 | 범위와 후속 조치 |
| --- | --- | --- |
| 대화마다 MCP가 선행 시작되어 기본 비용이 커진다 | 지지 | 도구 미호출 상태에서도 10개 대화/20개 MCP. 같은 loaded 수의 차이 298.3MiB. lazy start 후보를 우선 검토 |
| 빈 loaded root 개수만으로 공용 엔진 약4.2GiB를 설명한다 | 이번 조건에서 재현 실패 | MCP 없는 20개 root의 총 native tree는86.6MiB. 실제 root·history·활성 상태는 다를 수 있음 |
| unsubscribe 30초 후 MCP 보유는 unload 구현 누락이다 | 기각 | 기존60초 지연 정책 존재.90초 표본 loaded0/MCP0. 정상 idle 조건만 검증 |
| 단일 큰 이력은 수GiB를 지속 보유한다 | 이번 조건에서 재현 실패 | user8MiB/64턴 replay+read 후113.4MiB. 다수 긴 대화·이미지·실시간 추론 미검증 |
| 숨김 UI가 실제로 회수되지 않는다 | 미검증 | fixture 준비 오류 후 수정했지만 유효 비교 전 여유 메모리 guard로 중단 |
| 이벤트 backlog/추론 중 복사/maintenance metadata가 큰 peak를 만든다 | 소스 후보, 미검증 | queue bytes와 작업별 peak 계측이 필요. 엔진4GiB의 확인된 원인으로 보고하지 않음 |

Windows x64에서 실제 w11aa 엔진과 실제 MCP 실행 파일을 사용했다. 수치는 소유 backend·connector·MCP·자식 프로세스의 Private Bytes 합계에 대한 3회 중앙값이며 드라이버·측정 PowerShell·mock window host는 제외한다. Working Set과 V8 heap을 합산하지 않는다. 다른 사용자 작업과 같은 호스트이므로 cold-start와 스케줄링 변동이 남는다. 모든 성공한 native run은 실제 exit 0과 backend/PID·생성시각으로 추적한 자식의 종료를 확인했다.

| loaded 대화 수 | MCP 없음(MiB) | Window Use+REPL / 대화(MiB) | 실제 MCP 프로세스 수 |
| --- | ---: | ---: | ---: |
| 0 | 55.3 | 50.9 | 0 |
| 1 | 61.5 | 91.8 | 2 |
| 5 | 68.5 | 225.5 | 10 |
| 10 | 75.2 | 373.5 | 20 |
| 20 | 86.6 | 미실행 | 미실행 |

r7의 전체 실행 시간은 2026-10-22 16:35:20.823Z~16:39:17.493Z이다. 대화 10개에서 MCP 유무 차이는 약 298.3MiB다. 두 baseline 차이까지 보정한 MCP pair 증분은 약 30.3MiB/대화다. MCP를 호출하지 않고 대화를 불러오기만 해도 발생한 비용이다. 10개 시점에서 Window Use node 226.5MiB, REPL 27.3MiB, backend 83.2MiB, conhost 등 기타 자식 25.5MiB, connector 11.1MiB가 관측됐다. 각 범주의 중앙값은 총합의 중앙값과 정확히 합치지 않을 수 있다.

MCP가 없는 대화 20개 자체는 약 31.3MiB 증분이다. 따라서 **빈 root 수만으로 실사용 4.2GiB 엔진을 재현하지 못했다.** MCP eagerly started session 비용은 실측으로 지지된다. conhost 증분의 생성 원인은 미확인이다. frozen stdio MCP launcher는 이미 `CREATE_NO_WINDOW`를 사용하므로 그 플래그 누락으로 단정하거나 동일 변경을 권하지 않는다.

### 60초 delayed unload 검증과 판단 정정

추가 소스 조사에서 `thread_lifecycle.rs:20-80,374-407,430-492`의 subscriber/activity watch와 `core/src/config/mod.rs:3972-3980`의 기본 60초 지연을 확인했다. Running/Deferred는 보유 대상이다. 앞선 “unsubscribe는 subscriber만 제거한다”는 사실은 맞지만, 이것만으로 후속 runtime unload 경로가 없다고 해석하면 틀린다.

새 r9에서 idle 대화 1개와 실제 MCP 2개, window owner 2개를 유지했다. unsubscribe 직전 loaded1/MCP2/95.0MiB, 30.025초 후 loaded1/MCP2/94.0MiB, 90.020초 후 **loaded0/MCP0/65.6MiB**였다. metadata-only read는 앞 두 지점에서 idle, 마지막에는 thread-not-loaded였다. 두 창 owner를 닫기 전에 unload가 일어났다. 기존 정상 회수 경로가 동작함을 확인했으며, 30초 보유를 누수로 보는 가설은 기각한다. unload 후 baseline56.3MiB까지 즉시 내려오지는 않았지만 잔류 약9.2MiB만으로 allocator leak을 판정하지 않는다. 마지막 owner 종료 후 전체 소유 프로세스가 종료됐다. r9 실행은 16:48:07.566Z~16:50:35.413Z, exit0이다.

### 이력 크기 실측

서로 다른 fresh backend에 offline JSONL 1/2/4/8턴을 각각 불러왔다. 턴당 user128KiB이며 추론·streaming은 수행하지 않았다. native read가 정확한 턴 수와 completed 상태를 반환했음을 확인했다.

| user 이력 | fresh baseline(MiB) | load+read 후(MiB) | read 응답 bytes |
| --- | ---: | ---: | ---: |
| 128KiB | 57.1 | 85.2 | 263,949 |
| 256KiB | 54.2 | 79.4 | 395,572 |
| 512KiB | 53.4 | 82.1 | 658,818 |
| 1MiB | 55.8 | 92.9 | 1,185,317 |
| 8MiB / 64턴 | 54.6 | 113.4 | 8,556,402 |

작은 범위는 cold-profile 변동이 커서 byte당 보유율이나 선형 기울기를 확정하지 않는다. 추가 8MiB/64턴 r10도 exit0으로 통과했다. 본체 backend는 41.11→89.97MiB, 전체 native tree는54.57→113.41MiB이며 authored JSONL은16,863,891bytes다(동일 user text를 response와 event 양쪽에 표현하는 형식). 합산 resume+read는3,789ms이고 별도 RPC별 시간은 계측하지 않았다. 정확한64개 completed turns를 native read로 확인했으며 freeRAM 최소4.22GiB, 마지막 소유 프로세스 identity snapshot은 빈 배열이었다. 실행 시간은17:07:07.270Z~17:08:36.509Z다. 단일 큰 이력의 비용은 확인했지만4GiB를 재현하지 못했고 여러 긴 root로의 선형 외삽은 미검증이다.

r8 네 case의 전체 시간은16:40:13.567Z~16:47:01.511Z이며 모두 exit0이다. 최종8턴 profile에 작은 completed 대화3개를 추가한 UI seed는 native 종료 후 immutable 상태로 인계됐다. 남아 있는 WAL도 DB와 함께 복사한다.

### 추가 최적화 후보의 근거

- MCP lazy start/공유 가능한 정적 catalog 재사용을 우선 검토할 근거가 생겼다. 다만 REPL state, thread별 권한·workspace·승인 격리를 보존해야 하며 process 공유를 일괄 적용하지 않는다.
- root idle unload를 새로 만드는 제안은 제외한다. 이미 있는 60초 기구의 실제 보류 사유, subscriber 수, Running/Deferred 구분을 관측하는 것이 먼저다. 실사용 50쌍이 정당한 활성 소유인지 UI/연결 보유인지 아직 확인하지 않았다.
- full-history read/resume는 원본 history와 별도 API turn vector를 함께 만들 수 있다. paginated thread에는 `excludeTurns`, `initialTurnsPage`, `thread/turns/list`, `thread/items/list`가 이미 있다. 전체 hydration을 줄이는 데 기존 기능부터 활용할 수 있다. legacy paging은 응답을 줄여도 서버가 전체 rollout을 replay할 수 있어 paginated 저장 형식과 구분해야 한다. 이는 소스 기반 후보이며 절감량 실측은 아직 없다.
- Core/App-server 무제한 이벤트 큐, slow consumer, live inference의 JSON/문자열 transient peak와 사용자 상태의 장시간 누수는 이번 native no-turn/replay 실험에서 검증하지 않았다.

원시 sample·provenance·producer 종료 근거는 `evidence/native-*/`에 보존했다. 일시 프로필은 UI/추가 replay 소비가 끝난 뒤 native maintenance 도구로 검토·정리한다. 실패한 준비 시도의 exit1은 성공 실험으로 바꾸지 않는다.

### UI 드라이버 보정 기록

첫 UI 시도는 복사한 DB의 Windows 확장 경로 접두사(`\\?\`) 소유 검사에서 중단됐다. 두 번째는 초기 inspector context 교체 중 `Promise was collected` 오류와 초기화 전 전역 참조 오류였다. 해당 테스트 창은 자기 inspector의 정상 closeWindow 명령으로 닫았고 driver 실제 exit1을 확인했다. 기존 관측 22개 PID·생성 시각과 현재 profile root·자식을 다시 검사해 남은 테스트 프로세스가 없음을 확인한 뒤 supported closeLifecycle로 failure를 유지했다. 처음 검사에 측정 PowerShell 자신의 command line이 포함된 것도 확인해 sampler 자신과 자식을 제외하고 재검증했다.

세 번째는 baseline만 측정하고 대화 DOM 준비를 너무 일찍 검사해 실패했다. 네 번째는 진단용 DOM을 보존해 `paginated rollout path ... does not have a canonical rollout filename`을 확인했다. path 기반 native replay는 synthetic `.000Z` 파일명을 허용했지만 ID 기반 UI resume는 19자리 timestamp를 요구했다. frozen `rollout/src/rollout_file_name.rs:39-55`를 확인하고 **UI 복사본의 파일명과 DB path만** canonical 초 단위 형식으로 고쳤다. 원본 seed는 변경하지 않았다. 모든 실패를 원인과 실제 exit1로 보존하며 UI RAM 결과로 합산하지 않는다.

다섯 번째는 초기 sample에서 freeRAM<2GiB guard로 exit1 종료했고 모든 소유 프로세스가 종료됐다. 당시 사용자 rustc 약2.95GiB 등이 별도로 실행 중이었다. 테스트 창 종료 후 free4.84GiB를 확인해 작은 native r10을 먼저 순차 실행했다. r10 종료 후3.6GiB, cleanup 등록 검증 중 한 시점4.02GiB로 GUI baseline 약1.35GiB와 추가 panel을 안정적으로 감당할 여유가 부족했다. 다음 UI 실행 전 valid `git init --template=` 경계를 만들고 상위 저장소 자동 탐색을 끄도록 드라이버를 고쳤다. 제품/사용자 설정은 변경하지 않는다. resource guard에 중단된 실행을 UI 절감량 비교에 사용하지 않는다.

### UI 검증 종료 조건과 결과 해석

여섯 번째 UI 실행은 `.m` 정리 잠금과 독립적인 관리 루트 `.u`를 사용했다. 실제 `git init --template=`으로 상위 저장소 자동 탐색을 막았으며, 복사본에만 canonical rollout 이름을 적용했다. 실행은 2026-10-22 17:20:27.445Z~17:21:41.325Z, 실제 exit1이었다. 초기 측정에서 system free<2GiB 보호 기준으로 중단돼 유효 sample/stage가 없었다. 정상 closeWindow 후 모든 관측 PID·생성 시각의 프로세스 종료와 `producerStopped=true`, `processesStopped=true`를 확인했다. 근거는 `evidence/ui-default-6/{producer,result}.json`이다.

5·6회가 같은 자원 조건으로 중단됐으므로 현재 호스트에서 추가 GUI 반복은 종료한다. 기존 사용자의 작업은 종료하지 않는다. hide/dispose/restore의 메모리 차이와 5초로 가속한 idle 해제는 미검증으로 남긴다. 앞선 두 실패 실행의 전체 VS Code baseline 약1.35~1.48GiB를 Azrael 단독 비용이나 정상 대화 UI의 비교값으로 사용하지 않는다. 후속 UI 재실측은 별도 작업 부하가 줄어 충분한 여유 메모리가 확보된 환경에서, 같은 두 대화와 실제 DOM 준비·정상 복원 검증을 포함해 수행한다.

### 임시 자료 정리 결정

모든 성공/실패 native 및 UI 실행의 결과·원시 측정·종료 근거를 `evidence/`에 보존했다. 재현용 driver와 근거는 후속 최적화의 비교 기준으로 보관하며, 대체 검증이 확보되거나 분석 근거 보관이 끝나면 재검토한다. UI 후속 실행은 중단했으므로 c88 seed를 포함한 임시 프로필의 downstream 사용을 해제했다. 제품 설치·사용자 프로필·실제 작업 프로세스는 정리 대상이 아니다.

관리 도구의 첫 `.m` 그룹 `run:DJ-01:ui-default` 삭제 결과는 두 member 모두 `deleted`, `remaining=false`다. `artifacts/m`의 `native-a-r2`도 삭제·부재를 확인했다. 반면 최초 `native-a`의 작은 run/profile은 producer membership과 종료 근거가 불충분하여 defer했다. 지원 절차로 정확한 child 종료 근거와 producer close가 수용될 때 재검토한다. 기존 pending 상태는 수정하지 않았다. 나머지 `.m` 및 `.u` 그룹은 등록·review·명시적 결정·실제 삭제 결과를 별도 cleanup audit에 기록한다. 잠금 제거·강제 삭제·관리 도구 우회는 하지 않는다.

사용자의 continue 후 중단된 비동기 셀을 재조회했으나 기존 셀은 사용할 수 없었다. 소유 자식 agent도 남아 있지 않았다. native registry의 현재 결정과 owner catalog를 대조해 `.m`의 native12개 그룹·UI1/2/3, `.u`의UI6가 이미 삭제된 것을 확인했다. 기존 종료 결과를 새 실행 성공으로 바꾸지 않았다. UI1과UI6은 지원 `finalize`가 member 부재·참조 없음·blocker 없음으로 완료됐다. UI6 비동기 completion은 이 실제 근거로 종료 처리했다. 같은 삭제를 반복하지 않았다.

남은 UI4/5는 아직 등록되지 않은 stopped failure record였고, 독립 보관한 producer 근거의 SHA256이 원래 기록과 일치했다. 기존 잠금이 없는 상태에서 root가 두 그룹의 순차 정리를 인수했다. 내용 등록·review·apply 각각의 실제 결과를 `evidence/cleanup-ui45.json`에 즉시 기록한다. 첫 audit 저장의 PowerShell 인용 오류는 native 작업 전에 exit1로 실패했으며, 새 실행은 직접 파일 쓰기로 보정했다. 재현 driver 두 개의 최종 `node --check`는 각각 exit0이다. 근거 JSON55개도 parse 검사를 통과했다.

### 추가 소스 가설: project-maintenance 자체의 metadata peak

### 최종 정리 결과와 추가 관측

최종 native inventory에서 `.m`17개 그룹/34개 항목, `.u`1개 그룹/2개 항목이 모두 `deleted`, `remaining=false`다. 두 control root의 producer catalog도 각각0개다. 이전 `artifacts/m`의 native-a-r2 한 그룹/한 항목 삭제를 합치면19개 그룹/37개 항목을 삭제했다. 초기 native-a 작은 두 항목의 defer는 유지한다. 관리 config·삭제 receipt와 분석 근거·driver는 검토 가능성을 위해 보관하며, 근거 보관이 종료되거나 대체 검증이 수용되면 각 metadata 소유 절차로 재검토한다. 임시 profile payload는 `.m`/`.u`에 남지 않았다. 결과는 `evidence/cleanup-final.json`이 소유하며 이전 중간 audit의 미완료 표시는 당시 상태를 나타낸다.

UI4는 두 항목 실제 삭제 후 finalize 명령의 여분 괄호 때문에 exit1이었다. 구문만 수정한 supported finalize는 exit0/remaining[]/references[]/blockers[]로 끝났고 복구 결과를 해당 audit에 추가했다. UI5는 등록·review·삭제·finalize가 완료됐으며 실제 finalize exit0이다. 실패를 성공으로 덮거나 삭제를 반복하지 않았다. 마지막 UI5 정리 구간은 2026-10-22 19:18:39Z~20:22:18Z다. 등록 종료는20:18:52Z, 실제 삭제와 finalize 종료는20:22:18Z다. 이 시간에는 호스트 경합과 실행 조율 대기가 포함되므로 순수 알고리즘 처리시간으로 해석하지 않는다.

정리 지연 확인용 추가3회 표본(20:21:40~45Z, sampler exit0)에서 현재 도구 엔진 PID61336은 같은 w11aa 경로, private3136.65~3137.65MiB, WS2221.42~2222.16MiB였다. 약4.46초 동안 CPU는약4.86초 증가했고 시스템 여유 메모리는12.9~13.15GiB였다. 이전4.2GiB 관측의 PID61016과는 다른 프로세스이며, profile 삭제에 따른 절감이나 maintenance 단독 메모리 기여량을 입증하지 않는다. 당시 GUI 중단 조건과 현재 호스트 상태도 다르다. 추가 GUI 재실측은 새 통제 실행으로 분리하며, 이번 UI 검증을 성공으로 변경하지 않는다. 원시 근거는 `evidence/cleanup-engine-samples.json`이다.

### Maintenance metadata 후보의 상세 근거

실사용 엔진이 공용 catalog.lock을 가진 사실은 관측했지만 이것만으로 4.2GiB 원인이라고 판단하지 않는다. 별도 좁은 source review에서 아래 후보를 찾았다. 모두 **소스 기반·RAM 기여량 미실측**이다.

1. `project-maintenance/src/paths.rs:574-620,223-239`는 전체 경로 목록과 entry별 JSON record Vec를 만들고 이를 다시 직렬화한 Vec를 만든다. 파일 본문은 64KiB buffer로 streaming하므로 큰 파일 하나를 통째로 읽는 구조는 아니다. Windows에서는 cache guard가 hit 재사용을 하지 않는데도 operation-scoped digest cache에 각 파일을 삽입한다(`:147,214-217`). streaming hash 직렬화와 쓰이지 않는 Windows cache 삽입 제거를 검토할 여지가 있다.
2. `registry.rs:96-143,250-265,307-318`의 observe는 consistency 확인용으로 전체 catalog를 두 번 materialize한다. 개별 JSON record16MiB 제한은 있으나 총 record 수/bytes 제한과는 다르다. 중복 보유를 줄이는 방향을 검토하되 일관성 검증을 보존한다.
3. `storage.rs:14-20,65-86`는 전체 state manifest를 읽고 parse하며 변경 시 전체 pretty-serialized buffer를 만든다. item/group/run/decision 집합은 커질 수 있다. Store는 per-dispatch이고 inventory 응답 자체는 paging되어 있어 영구 heap 보유라고 단정하지 않는다.
4. ungrouped review의 `related_items`와 handler의 전체 `result.to_string()`은 큰 도구 결과를 만들 수 있다(`lib.rs:698-772`, `core/src/tools/handlers/project_maintenance.rs:425`). group member200 제한은 member 내부 파일 수나 related_items 총량 제한이 아니다. paging·상세 결과 파일 참조 같은 후보를 검토할 수 있으나 실제 session-history 보유와 연결되는지는 미검증이다.
