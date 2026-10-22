상태: 측정·분석·격리 산출물 정리 완료. 제품 최적화·설치는 수행하지 않았다.

# 세션 로딩 성능 검토

사용자가 지정한 `azrael://threads/01a1334d-6a69-7821-a164-da04f3cfa71f`의 초기 복원을 격리 프로필에서 실험하고 단계별 시간과 최적화 여지를 분석했다. 상태 복제, 별도 소스 계측과 실험용 엔진 컴파일까지 요청 범위로 수행했다. 제품 코드 변경·배포·설치는 후속 범위다.

대상은 Windows x64 로컬 네이티브 엔진이다. 복원 로직은 공통 코드지만 Linux x64·macOS ARM64 성능 및 VS Code UI 실제 렌더링은 검증하지 않았다. 책임은 부모가 최종 통합·해석·정리를 맡았다. 두 읽기 전용 조사, fixture 준비, 계측 소스 준비는 각각 분담했고, 이후 부모가 고정 입력 컴파일과 측정을 마쳤다.

## 결과

초기 복원 지연을 재현했다. 가장 큰 구간은 기록·질문·승인 상태 복원이다. 질문 복원과 승인 복원이 같은 전체 JSONL을 각각 읽고 파싱한다. 기존 파서를 별도로 실행한 결과 한 번에 15.7~17.8초가 걸려, 중복 전체 읽기가 우선 개선 대상이라는 근거가 강하다. 다만 각 복원 함수의 시간을 직접 분리 계측하지 않았으므로 30~35초 전부를 이 두 호출에 확정 배정하지 않는다.

| RPC 단계 | 설치 엔진, 새 프로필 | 계측 엔진, 새 프로필 | 기록 먼저 조회 후 계측 엔진 |
|---|---:|---:|---:|
| initialize | 499.65ms | 496.86ms | 479.06ms |
| metadata | 161.46ms | 226.21ms | 183.84ms |
| 복원 전 최근 turn 5개 | — | — | 245.02ms |
| 복원 전 item 5개 | — | — | 5.29ms |
| cold resume | 36,676.74ms | 36,636.71ms | 42,901.59ms |
| warm resume | 26.31ms | 29.14ms | 29.77ms |
| 복원 후 최근 turn 5개 | 25.16ms | 39.60ms | 9.73ms |
| 복원 후 item 5개 | 3.87ms | 4.19ms | 4.27ms |

cold는 새 프로세스·새 프로필의 첫 runtime 복원이며 OS 파일 캐시를 비운 측정은 아니다. warm은 같은 프로세스에서 같은 스레드 재복원이다. 설치 엔진과 계측 엔진의 36.6초 결과는 한 쌍의 관측이며 통계적 동등성을 증명하지 않는다.

세 실행 모두 runner exit 0, engine exit 0, serverRequests 0, turn/started 0, owned survivors 0, 최근 turn/item 각 5개, 정규화한 cwd 일치였다. 모든 복원 요청은 `excludeTurns:true`였다. 전체 기록 호환 응답의 N+1 조회는 이 결과의 원인이 아니다.

## 단계별 계측

중첩 구간을 더하지 않는다. 다음 표의 상위·하위 구간은 포함 관계다. 각 scope의 순차 phase 합과 total의 차이는 최대 약 0.005ms였고 열린 채 끝난 scope는 없었다. 로그의 종료 이벤트 자체는 성공을 뜻하지 않으며 RPC 결과와 실제 exit 0을 별도 확인했다.

| 구간 | 일반 계측 | 기록 선조회 계측 |
|---|---:|---:|
| resume 함수 전체 | 36,647.00ms | 42,911.70ms |
| 첫 시도: metadata/config 재해결 | 144.33ms | 132.89ms |
| 다음 시도: session spawn 전체 | 36,406.12ms | 42,698.40ms |
| └ core spawn | 31,335.68ms | 37,143.54ms |
| 　 └ model list/default | 847.35ms | 916.90ms |
| 　 └ Session::new | 30,480.36ms | 35,324.43ms |
| 　 　 └ persistence/DB/auth/MCP 병렬 join | 13.71ms | 25.20ms |
| 　 　 └ runtime setup | 474.58ms | 510.22ms |
| 　 　 └ MCP runtime install | 3.62ms | 3.01ms |
| 　 　 └ history restore/readiness | 29,987.22ms | 34,785.01ms |
| writer resume 전체 | 7.24ms | 15.85ms |
| response hydration | 20.60ms | 18.44ms |
| initial page 준비 | 36.58ms | 28.76ms |

일반 계측의 admission lock 0.086ms, config 재해결 0.211ms, client attach 1.506ms, writer persist 3.537ms, listener attach 11.968ms, response assembly 0.126ms, send API 경계 0.854ms였다. config 재시도 중 모델 문맥을 가져오는 구간은 첫 시도 123.818ms, 다음 시도 1.512ms였다.

일반 계측의 session spawn에서 core spawn을 제외한 약 5.07초, 선조회 실행의 약 5.55초는 ThreadManager 준비·마무리 등으로 더 분리되지 않았다. 정확한 원인은 미확정이다. 모델 목록 준비 약 0.85~0.92초도 남아 있다. 병렬 join 수치로 개별 auth/MCP future의 비용을 판단할 수 없으며, history readiness에 배경 prewarm 관련 작업도 포함되므로 MCP가 전혀 기여하지 않는다고 단정하지 않는다.

모델 문맥 reverse scan은 두 실행의 개별 관측에서 106.6~174.7ms였다. seed에는 compaction 127개가 있고 마지막 유효 경계는 byte 358,161,838 / record 133,340이며 replacement_history와 window_number가 있다. 이 경계를 포함한 suffix는 1,815,636 bytes다. 360MB 전체 모델 문맥 스캔이 주원인이라는 가설은 지지되지 않는다.

## 전체 기록 파서 비교 실험

실험용 엔진 빌드에서 생성된 실제 `codex_rollout::RolloutRecorder::load_rollout_items`를 작은 Rust 프로그램에서 직접 호출했다. 파서를 재구현하지 않았다. 같은 seed를 순차로 두 번 읽고, 반환 벡터 해제도 따로 측정했다.

| 호출 | 읽기·파싱 | 결과 해제 | items | parse errors |
|---|---:|---:|---:|---:|
| 1 | 15,666.47ms | 177.36ms | 133,999 | 0 |
| 2 | 17,828.65ms | 152.25ms | 133,999 | 0 |

두 호출 모두 thread id가 있었고 입력 해시는 전후 동일했다. 프로그램 exit 0, stderr 0 bytes, 전체 wall time 35,081ms였다. 이 별도 측정은 실제 복원 안의 각 호출 시간을 대체하지 않는다. 두 파싱 시간 합 33.50초가 readiness의 29.99~34.79초와 비슷한 규모라는 보조 근거다.

호출 근거:

- [질문 복원](../../engine/codex-rs/core/src/session/user_questions.rs:176): 초기 bounded history로 만든 상태를 전체 rollout 읽기 결과로 다시 구성하고 thread id 및 parse errors를 검증한다. 수락된 사용자 입력 receipt도 조정한다.
- [승인 복원](../../engine/codex-rs/core/src/session/host_approvals.rs:273): Resumed일 때 전체 rollout을 다시 읽고 동일한 검증 후 승인 상태를 구성한다.
- [기존 파서](../../engine/codex-rs/rollout/src/recorder.rs:1122): 전체 행을 순회하며 JSON과 typed rollout item을 파싱한다.
- [세션 초기화](../../engine/codex-rs/core/src/session/session.rs:2037): 두 복원을 순서대로 기다리는 history readiness 구간이다.

## 최적화 우선순위와 보존 조건

1. **한 복원 안에서 검증한 전체 기록 읽기를 공유한다.** 질문·승인 복원에 같은 스냅샷을 전달하고 thread id, 파싱 오류, pending input receipt 조정, 승인 ledger/재개 의미를 그대로 보존한다. 한 번의 파싱에 해당하는 수십 초 중 일부를 없앨 가능성이 높다. 이 데이터에서 약 15~18초 규모의 중복 비용이 관측됐지만 실제 절감량은 구현 후 A/B 측정해야 한다. 두 전체 파싱을 병렬화하는 방안은 메모리·CPU를 두 배 사용하므로 우선안으로 삼지 않는다.
2. **질문·승인 상태의 증분 projection을 검토한다.** 기존 SQLite/thread-store와 revision/watermark를 재사용하고 로그 append 및 상태 반영의 일관성, compaction 전의 미해결 질문/승인, 손상 감지·복구 조건을 정의한다. 장기적으로 전체 스캔을 줄일 수 있지만 일관성과 복구 설계가 필요하다. 모델 문맥의 bounded history만 대신 넘기면 compaction 이전의 상태를 잃을 수 있으므로 단순 치환하지 않는다.
3. **최근 기록 표시와 runtime 준비를 분리한다.** `thread/read(includeTurns:false)`, `thread/turns/list`, `thread/items/list`를 재사용한다. 복원 전 turn/item 조회 합은 250.30ms, initialize와 metadata를 합치면 RPC 단계 합 약 913ms였다. 엔진 생성·dispatch·UI 렌더링을 포함한 실제 화면 표시 시간은 아니다. UI가 먼저 읽기 전용 기록을 보여주되, 입력 가능 여부와 실행 준비 상태를 구분하고 live 이벤트와 조회 결과를 합쳐야 한다.
4. **20초 제한 이후의 복원 상태를 다시 맞춘다.** 늦은 성공을 현재 연결·요청 세대와 대조해 상태를 재조회한다. 오래된 응답이 새 탐색/계정/연결 상태를 덮지 않아야 하며 turn·도구 요청을 자동 재실행하지 않는다. 제한 연장만으로 복원 비용은 줄지 않는다.

첫 구현 후보는 1번이다. 실제 사용자 체감 개선을 병행하려면 3번의 화면 동작을 합의해야 한다. 이번 작업에서는 구현하지 않았다.

## 실제 환경과 격리 조건

- 실행 host 2026.0.11, 배포 `artifacts/build/b13/artifacts/releases/w11aa`, source `artifacts/build/b13/engine`.
- 원본 JSONL 359,977,474 bytes, 133,999 records, 저장 turn 414개. projection version 5가 조사 시점 전체 byte까지 따라잡았다. 이 상태가 과거 실제 복원 시점 상태까지 증명하지는 않는다.
- 고정 seed 218 files / 4,573,546,738 bytes. history DB online backup 4,189,274,112 bytes, quick_check 통과. DB와 파일 간 하나의 atomic snapshot은 아니다. 대상의 fork/parent metadata는 없었다.
- 독립 `CODEX_HOME`, seed의 절대 rollout 경로를 각 복사본으로 변경했다. 예약·큐·goal·accepted input 자동 실행은 복사본에서 중립화했다. 모든 native profile credential 13개를 제거하고 유효한 signed-out 선택 상태와 file credential storage를 사용했다.
- 명시 MCP 3개(node_repl, laio, azrael_window)는 비활성화했다. implicit codex_apps는 시작 후 실패 알림이 있어 “MCP 전체 없음”으로 해석하지 않는다. 실제 로그인 프로필과 다른 조건이다.
- 모델/도구 요청이나 turn/start·steer를 보내지 않았다. 실제 VS Code 프로필, 설치 엔진, 제품 소스는 수정하지 않았다. 별도 live writer가 실험 전부터 원본을 갱신하고 있어 원본 전체 해시 전후 불변은 성립하지 않는다. 격리 보장은 경로 localization·실행 차단·RPC 관측으로 확인하고 성능 입력의 동일성은 고정 seed로 판단했다.
- 계측 실행 전에 자체 컴파일은 종료했다. 다른 작업의 Cargo 프로세스가 있었고 마지막 실행 후 rustc도 관측했다. 유휴 머신·성능 분산·OS 캐시 제거 조건을 주장하지 않는다.

## 운영 로그와 표시 경로 근거

원본 `C:/Users/felre/AppData/Roaming/Code/logs/20261022T085947/window4/exthost/azrael-ex-local.azrael/Azrael Recovery.log` 13~29행: 18:37:10.645 요청, 20초 제한 초과, 18:37:53.463 성공(`elapsedMs=42817`, `ignored_after_timeout`). 이어진 warm 복원 34ms, metadata 10ms, turns/list 34ms였다. 저장 이름이 스크린샷과 일치한다.

설치 webview `app-initial-97d3534ad35f.js`의 `yOn`은 uncached local paginated 기록 조회를 runtime resume 이후에 시작한다. [recovery state](../../scripts/recovery-state.cjs:310)는 resume 후 refresh까지 기다리며 snapshot은 metadata와 turn 요약을 직렬 조회한다. [recovery RPC](../../scripts/azrael-recovery.cjs:291)의 기본 제한은 20초이며 늦은 응답은 버려진다.

`excludeTurns=false` 호환 경로에는 전체 turn 및 개별 item 조회 비용이 추가될 수 있으나 실제 과거 UI flag는 로그에 없어 이번 사례에 배정하지 않는다. 스크린샷의 “Loading model...”은 모델/추론 선택기 준비 표시이며 transcript 단계명은 아니다.

## 재현 입력·명령·실행 결과 보존

독립적으로 읽을 수 있는 [측정 근거](02-measurement-evidence.json)에 RPC·phase 원자료 요약, 입력 identity, 실행 결과 및 종료 검증을 함께 보존했다.

원시 로그·복제 DB·프로필·소스·실행 파일은 lifecycle `CY-01-resume-profile-r1`에 속한다. 다음 요약은 이 문서만으로 읽을 수 있도록 보존했다. 삭제 뒤 아래 임시 경로는 재사용 가능한 파일 링크가 아니라 실행 당시 위치다.

| 항목 | SHA-256 |
|---|---|
| seed manifest | a716c4d6f5537129c3e8380a1627fea14679347837cae27f0b1224579128a490 |
| 대상 rollout | 83e0383c5e3f0a76a8f35f328e5a72bac9455791efbe1c09876e984c0c4dca10 |
| 설치 엔진 | 39ce6b6e7afefef44bc2eae790412078dfdfdda0486aad4d52efe41c87c5caf5 |
| 계측 전 9,304파일 source inventory | 37cf5035d1856f9559ba30f8085822a1be5fcf95e89b6fcb8714c4af980a0023 |
| 계측 고정 source inventory | e70d4b79d2eec440af3c9641154c6133dc3db10458fd21738b936f9c0701fba1 |
| 계측 엔진 | 17d6fc53b222428075c4140e66ffdaa12ca3fd74a0169c758a1a3a24611ac978 |
| 측정 RPC runner | 908c83653ece575fb2613b8d756f95dd145e58c699b011bb15e57526aa359b7e |
| 파서 실험 프로그램 | 572e96b32af248c0074e87b8ecfbe43f09e821dde3e9cecb39f6e0ef9c0954ac |

계측은 복사본의 thread_processor.rs, session/mod.rs, session/session.rs, local/live_writer.rs, local/model_context.rs 다섯 파일에만 추가했다. 기존 tracing logger의 `azrael_resume_probe` target, 고정 phase/scope, 단조 시계 microseconds를 썼다. start, boundary_reached, scope_exit_unclassified 이벤트로 순차 phase를 계산했다. 사용자 본문·인증값·요청 식별자는 추가하지 않았다. scope 종료는 성공 판정과 분리했다.

실행 당시 run root: `artifacts/tasks/CY-01-session-loading-review/runs/20261022-resume-profile-r1`.

- native 빌드 준비: MSVC18 Community vcvars64, Rust1.95.0, Windows MSVC x64 dev profile, static CRT, stack 8MiB. 설치 b13 source 복사본, 공유 Cargo cache는 기존 owner 사용. 첫 컴파일은 실행 관리 terminal receipt를 잃어 unknown/interrupted로 남겼다. 이를 성공으로 바꾸지 않았다. 당시 producer 종료를 별도 확인했고 stale cache recovery는 적용하지 않았다.
- attempt2 `temporary/instrumentation/build-resume.cjs`: 10:55:57.243Z 시작, cache 대기 후 11:00:55.355Z 획득, 11:16:08.905Z 종료. 총 1,211,657ms(대기 약 298초 포함), 실제 exit 0, 입력 전후 고정 해시 동일. 다른 작업을 중단하지 않았다.
- 측정 명령: `node temporary/analysis/run-experiments.cjs`. 내부에서 `node temporary/fixture-tools/run.cjs --engine <binary> --seed <seed-v7> --profile <new-profile> --report <report> --probe-log <probe>`를 순차 실행했다. 세 번째는 `--history-first true`. timeout 240초. parent 명령 exit 0.
- 결과 위치: `reports/measurements/{baseline4,instrumented1,historyfirst1}.json`, `execution.json`, `*-phases.json`, `logs/measurements/*-probe.jsonl`.
- 앞선 baseline3은 자체 컴파일과 겹쳐 cold 55,817.51ms였다. 성공·exit 0이지만 주 비교에서 제외했다. baseline1은 initialize 전 exit 1(59B stderr 미분류), baseline2는 잘못된 빈 account-state로 RPC -32603 즉시 실패했다. 해당 fixture 조건을 수정했으며 두 실패는 성능 결과가 아니다.
- 파서 프로그램은 동일 빌드의 rollout rlib `9c2f357e1263227f`, 정확히 일치하는 tokio rlib `6aa38fc2a9f9535b`를 링크했다. 라이브러리 SHA-256은 각각 `ed83b58962222098e50ca48676964562cf35930067eac179d670189fd1d6c76c`, `04970995da20015e09a28ea88ebace72b8dfc5fb70fe0a47882656505e1c3c7a`. 컴파일 전후 동일. 최초 링크는 windows.0.48.5.lib 탐색 경로 누락으로 exit 1, 설치된 Windows crate lib 경로를 명시한 재시도는 exit 0(10,463ms). shared cache에는 쓰지 않았다.
- 파서 실행 `node temporary/analysis/run-parser.cjs`: 11:28:59.585Z~11:29:34.666Z, exit 0. seed 전후 rollout hash 동일.
- 종료 확인: 11:30:26.122Z, 이전 기록의 PID+CreationDate 19개를 현재 프로세스와 대조하여 일치 0. task run 경로를 가진 node/python/bun/azrael/cargo/rustc/link/cl/lld-link 프로세스 0. 각 runner의 child tree 종료 결과도 survivors 0. 중단된 첫 빌드나 부모 종료만으로 자식 종료를 추정하지 않았다.

## 정리와 후속 검증

실험의 성공·실패·unknown 결과는 위에 각각 보존했다. 필요한 수치·해석·입력 identity를 작업 기록에 옮긴 뒤 lifecycle owner로 생산자를 닫았다. Native group 최초 등록은 논리 크기 34,588,648,538 bytes를 측정했고, 검토의 blockers와 참조는 모두 비어 있었다. 같은 group의 유일한 member에 명시적으로 delete를 적용했다. 결과는 aborted=false, group status=deleted, item status=deleted, remaining=false, error=null이었다. 실제 run root 부재와 owner finalize의 finalized/remaining=[]/references=[]도 확인했다. 생성물 4개 경로의 Hidden/ReadOnly 속성만 도구가 정규화했으며 force 삭제나 ACL 변경은 사용하지 않았다. 물리 회수 용량은 측정하지 않았다. 공유 Cargo cache, 원본 세션과 설치 배포는 삭제 범위가 아니다.

측정 근거 JSON(약 26KB)과 이 분석 문서만 후속 최적화 판단에 필요한 작업 기록으로 보존한다. 임시 DB·프로필·복제 소스·계측 실행 파일·raw log는 남기지 않았다. 문서의 상대 링크 10개와 근거 JSON 파싱을 확인했고 whitespace 검사도 통과했다.

후속 구현은 동일 데이터/플래그에서 cold/warm, 첫 기록 표시, 입력 준비와 RPC 시간을 비교해야 한다. 질문·승인 대기, 수락 입력 receipt, 예약·큐·goal, compaction 전후, 손상 기록의 거부, live 이벤트 병합, 연결 변경·취소·20초 이후 성공/실패를 보존 검증한다. 공통 변경에는 Windows 회귀를 포함하고 Linux/macOS 실행 검증 범위도 별도 표시한다.

관련 소유 문서: [세션과 기록](../../docs/architecture/azrael-ex.md), [플랫폼](../../docs/architecture/multi-platform.md), [진단](../../docs/ops/native-diagnostics.md).
