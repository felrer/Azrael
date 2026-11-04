상태: 분석 완료. 설치 2026.0.13 UI/host와 현재 engine 소스의 최적화 후보·보존 조건을 정리했다. 구현은 하지 않았다.

# 서버 요청 경로 최적화 분석

목표: 앞선 5회 실측과 2026.0.13 설치 코드, 현재 engine 소스로 전송 지연 절감 가능성을 평가한다. 허용 범위는 읽기 전용 조사와 분석 문서이며 코드 수정·실추론·빌드·설치 제외.

공통 경로 분석이며 실제 실측 환경은 Windows x64만이다. native 상태/공용 실행기 공유, 적은 표본, frozen release source 부재라는 기존 한계를 유지한다. 현재 구조에 이미 있는 캐시·연결 재사용을 먼저 확인한다.

부모는 설치 UI/host의 생성·첫 전송 경로를 조사했고, 읽기 전용 transport_feasibility 담당은 현재 engine transport/preparation을 독립 조사했다. 두 조사는 병행했으며 최종 문서 통합만 engine 결과를 기다렸다. 추가 실험·빌드 재실행은 없었다. 새 대화 사전 생성 금지 및 계정/권한/도구/지침의 최신 상태 보존은 현행 계약이다.

## 판단과 실측의 의미

최적화는 가능하다. 우선순위는 사용자 클릭 이후 첫 모델 요청을 막는 준비 작업의 중복과 직렬 대기다. 다만 기존 5회 표본으로 절감 초수나 간헐 장애의 원인을 확정하지 않는다. `turn/start`, `config/read`, `azrael/account`는 UI/host/native 사이 RPC이며 모두 원격 모델 서버에 보내는 HTTP 요청인 것은 아니다. 앞선 `turn/start` 시각은 host 메서드 진입이고 wire 전송 시각은 아니다.

새 대화의 클릭→host turn/start 2.593~2.846초를 전부 없앤다는 비현실적 가정에서도 전체 6.646~7.547초 대비 해당 구간만의 절감 상한은 약 34~43%다. 실제로는 세션 생성·권한·계정 admission이 남는다. 후속 요청은 이미 240~241ms로 준비된 표본도 있어 매번 1초 이상을 줄일 수 있다고 주장할 수 없다. native 준비 이후 2.472~3.959초는 추가 로컬 처리·연결·네트워크·서버 대기를 분리하지 못했다.

## 설치 2026.0.13에서 확인한 경로

설치된 `webview/assets/app-initial-97d3534ad35f.js`, `app-initial-7a199c66e670.js`, `out/extension.js`를 읽어 아래 동작의 존재를 대조했다. 설치 파일을 수정하거나 실행하지 않았다.

1. `fkn`은 기본 personality 읽기 → 계정 guard → `createConversation` → thread 초기화/부가 callback → 첫 턴 환경 준비 → 첫 턴 추가 context → 계정 guard → `executeTurnStart`를 순서대로 기다린다. 모든 callback이 불필요하다는 뜻은 아니며 의존성별 분류가 필요하다.
2. `SDn`은 request parameters → shell environment → dynamic tools → developer instructions를 순서대로 조립한다. instructions는 tool/thread/worktree 기능 플래그에 의존하므로 도구와 지침을 무조건 병렬로 만들면 안 된다. shell 환경과 도구 읽기의 독립 부분을 먼저 실행하고 결과 조립만 정해진 순서로 유지하는 후보는 있다.
3. `createConversation`은 이미 `Conversation created`에 `inputsDurationMs`, `preparationDurationMs`, `requestPreparationDurationMs`, `requestDurationMs`, `initializationDurationMs`를 기록한다. 최초 계획의 계측 제안은 이 로그를 먼저 재사용하는 것으로 구체화한다. shell/tool/instruction의 `markPreparation` hook도 공통 builder에 있으나 모든 생성 경로가 hook을 전달하는지는 별도다.
4. [계정 전환 guard](../../scripts/inject-account-switch-queue.cjs)는 새 대화 생성과 첫 턴 전에 account list를 조회하고, presentation/ordinary submission도 자체 조회한다. 동일 전송 안에서 revision이 같은 상태를 공유하고 마지막 native admission을 유지하는 방향을 검토할 수 있다. 500ms sleep은 실제 전환 대기/구조화된 전송 전 거부의 재대기에만 적용되며 모든 정상 요청의 고정 지연이 아니다.
5. [모델 목록](../../scripts/provider-model-picker.cjs)은 이미 host별 pending promise와 성공 결과를 공유한다. 그러나 [주입 코드](../../scripts/inject-provider-model-picker.cjs)는 모든 성공한 thread/start에서 `sessionCreated`를 호출하고 force refresh를 건다. 새 대화 직후 측정된 model/list와 일치하는 코드 경로다. 계정/공급자 catalog revision이 바뀌지 않은 경우 매번 전체 목록을 무효화할 필요가 있는지 우선 검토한다. 이것이 첫 턴을 직접 막는지와 단순 병행 부하인지는 추가 계측이 필요하다.
6. [Task profile](../../scripts/inject-task-profile.cjs)의 runtime 부재 확인은 persisted atom을 읽지만 설치본의 `readPersistedAtomState` 자체는 `globalState.get`과 object 복사다. 이를 디스크 전체 검사나 확인된 병목으로 부르지 않는다. runtime이 존재하면 [registry/snapshot](../../scripts/task-profile-runtime.cjs)을 읽고 선택된 task에서만 config/catalog를 확인한다. association fast path나 request-local 재사용은 낮은 우선순위 후보이며 cross-window 수정과 immutable snapshot 검증을 보존해야 한다.
7. [복구 정상 전송](../../scripts/recovery-state.cjs)은 thread별 직렬화·진행 중 resume 대기를 거쳐 직접 `turn/start`를 보낸다. 매번 thread/read/전체 기록 복구를 수행하는 구조가 아니므로 정상 전송 최적화 명목으로 복구 보호를 제거할 근거가 없다.

## 보존할 의미와 최적화 후보

| 순위 | 후보 | 효과가 날 수 있는 지점 | 보존 조건 |
| --- | --- | --- | --- |
| 1 | 전송 단위의 config/account preparation snapshot 및 진행 중 조회 공유 | 동일 cwd/host에서 반복되는 IPC·읽기·파싱 | host/window/cwd/account·설정 generation별 분리, 변경 시 즉시 폐기, 마지막 native admission 유지 |
| 1 | 독립 shell/tool/config 준비의 선행 실행 | 순차 await의 합을 독립 작업의 최대 시간에 가깝게 감소 | 지침의 도구 플래그 의존성, 취소/실패/timeout/ownership 보존 |
| 1 | 매 thread/start 모델 catalog force refresh 재검토 | 새 대화 직후 discovery·재렌더·공유 자원 경합 | 계정/공급자 변경·명시적 새로고침·가용성 변화 반영 |
| 2 | UI 목록·Git 표시·제목 등 첫 요청 비필수 작업을 admission 이후로 이동 | 첫 턴 전 callback 중 사용자 요청 의미와 무관한 부분 | 첫 턴 필수 Git/context, project·Lead/Task 소속과 지침 저장은 기다림 |
| 2 | native 초기 context 기록과 순수 skill/plugin 준비의 겹침 | 첫 턴 553~624ms, 후속 244~277ms의 일부 후보 | 기존 첫-step 재사용 유지, 설치/사용자 prompt/telemetry 부작용은 성공한 context 기록 이후, 실패·취소 순서 보존 |
| 3 | 실제 prewarm/reuse hit율과 연결 수립 대기 최적화 | 현재 미분리된 준비 이후 구간 | 이미 있는 재사용·예열 경로의 효과부터 측정, 인증·라우팅·turn 경계 유지 |

장기 TTL만 두는 전역 config/account 캐시는 부적절하다. 읽기 전용 준비도 현행 composer 계약에서 전송 전에 금지한 범위를 함부로 활성화하지 않는다. [session creation at submission](../../docs/architecture/ui-presentation.md#session-creation-at-submission)과 [submit-only transform](../../scripts/inject-submit-only-thread.cjs)은 입력 중 native session 준비·생성을 의도적으로 막고 있다. 우선 현재 클릭 이후 경로 안에서 최적화하고, 사전 준비/연결 예열이 이 계약과 충돌하는 경우 별도 동작 변경으로 검토해야 한다.

## 현재 engine 소스에서 이미 있는 최적화

이 절은 `engine/SOURCE.json`이 가리키는 현재 소스 조사 결과다. 기존 배포 영수증의 frozen source 경로가 부재하므로 설치 바이너리의 동일 구현·활성 상태를 증명한 것으로 취급하지 않는다. 조사 담당의 근거를 통합했으며 같은 소스를 중복 탐색하거나 실행 검증을 반복하지 않았다.

- [client.rs](../../engine/codex-rs/core/src/client.rs:283)의 `ModelClientSession`은 한 turn 안에서 Responses WebSocket을 재사용한다. 같은 설정과 정확한 이전 input prefix가 맞으면 전체 history 재전송 대신 증분 요청을 사용한다. 인증 소유자·공급자/revision·응답 header·연결 상태가 바뀌면 재사용 상태를 초기화한다. sticky routing과 continuation 상태는 turn 경계에 속한다.
- [startup_prewarm.rs](../../engine/codex-rs/core/src/session/startup_prewarm.rs:208)는 세션 시작 때 background Base prewarm을 예약하고 WebSocket preconnect와 도구 capture를 겹친 뒤 `generate=false` warmup을 수행한다. [codex_thread.rs](../../engine/codex-rs/core/src/codex_thread.rs:329)는 이미 존재하는 idle thread의 `prewarm_with_history` 경로를 제공한다. 이는 입력 중 새 thread를 만드는 UI precreation과 다르다. 후속 turn 뒤 host가 이 경로를 호출하는지, 설치본의 hit율이 어떤지는 이번 조사에서 확정하지 않았다.
- [turn.rs](../../engine/codex-rs/core/src/session/turn.rs:261)의 첫 captured step은 initial context와 첫 sampling에 재사용된다. capture 내부에는 AGENTS 갱신/도구 준비 및 MCP 갱신/도구 추천의 병렬 처리도 있다. world-state baseline 이후에는 변경을 기록한다. 따라서 앞선 측정에서 여러 world_state 이벤트가 보였다는 이유만으로 같은 전체 문맥을 불필요하게 두 번 만든다고 결론 내리지 않는다.
- 추가 후보는 initial-context 기록 동안 독립적인 순수 skill/plugin 준비를 겹치는 것이다. [turn.rs](../../engine/codex-rs/core/src/session/turn.rs:460)의 순서와 실패 시 부작용을 보존해야 하며 실제 절감량은 미측정이다.
- 연결 수립 병목이 확인되면 기존 idle-thread 예열이나 최종 metadata 확정 후의 preconnect 활용을 먼저 검토한다. turn 간 connection-only pool 확장은 더 큰 변경이며 인증·header·공급자와 turn별 라우팅/continuation을 분리해야 한다. turn-scoped client 전체를 그대로 다음 turn에 넘기는 방안은 권고하지 않는다. 서버의 turn 간 socket 사용 가능성과 실제 효과도 검증 전이다.

## 계측에서 보완할 경계

기존 [response_preparation](../../engine/codex-rs/core/src/session/response_preparation.rs:10), [client transport telemetry](../../engine/codex-rs/core/src/client.rs:2514), [turn timing](../../engine/codex-rs/core/src/turn_timing.rs:269), [Responses WebSocket](../../engine/codex-rs/codex-api/src/endpoint/responses_websocket.rs:666)에 준비 단계·연결/request·frame 대기·TTFT 관련 계측이 있다. 이 이벤트가 존재한다는 사실은 기존 설치 환경의 SQLite에 모두 남아 있고 같은 request로 연결된다는 뜻은 아니다. WebSocket request duration은 send를, 완료 시 TTFT는 첫 output item을 기준으로 하므로 사용자 화면 첫 text delta와 그대로 동일시하지 않는다.

우선 기존 host 생성 로그를 재사용하고, content-free correlation으로 `click → 준비 완료 → 실제 socket send → 첫 의미 있는 wire event → 첫 text delta → DOM`을 연결한다. account/config generation, 연결 재사용·prewarm hit, 단계별 byte/count만 추가하고 prompt·credential·response body는 기록하지 않는 것이 적합하다. 이렇게 해야 2.47~3.96초의 어느 부분을 Azrael이 줄일 수 있는지 확정할 수 있다.

## 검증 계획과 권고 순서

이 작업은 분석만 하므로 구현 테스트·빌드·재설치·실추론은 실행하지 않았다. 기존 실측을 재사용하고 설치 코드와 현행 소스의 차이를 명시한다. 다음 구현은 (1) 기존 생성 단계 로그 + 일반 요청 wire-submit/첫-event 경계 연결, (2) 한 번에 한 계층의 최적화, (3) 같은 sol medium/tier/계정/입력 조건의 전후 비교 순서가 적합하다. 새 대화·warm follow-up·긴 대화·재접속·계정 전환을 분리하고 p50/p95는 충분한 표본에서만 판단한다.

보존 검증에는 submit-only/draft, 계정 전환·질문 응답 예외·큐, 설정/권한 변경·취소·unknown delivery, task/Lead 첫 턴 지침, 도구 catalog 갱신을 포함한다. 공통 코드 변경은 Windows 회귀가 필요하고 Linux/macOS 지원 의미는 유지하되 실제 검증 여부는 별도로 기록한다. 모델/effort 변경이나 지침·도구 삭제는 이번 요청 경로 최적화의 동일 조건 비교에 포함하지 않는다.

## 결론과 산출물

권고는 기존 계측 재사용과 경계 연결을 먼저 준비하면서, 설치본에서 확인된 UI/host 중복 조회·catalog 무효화·독립 준비 병렬화를 우선 구현 후보로 삼는 것이다. native 순수 준비 병렬화는 다음 순위이며, transport pool 확장은 실제 handshake/reuse miss가 의미 있는 비중일 때 착수한다. 소스 존재만으로 최적화 효과를 주장하지 않고 동일 조건의 실제 요청에서 첫 답변 시간과 보존 동작을 함께 확인해야 한다.

분석 산출물은 이 문서 하나다. 일회용 실행 프로필·로그·빌드·측정 스크립트는 만들지 않았다. 계획 할당용 임시 본문은 즉시 삭제했다. 제품 코드·설치·사용자 설정·계정은 변경하지 않았다. 개발 착수 권한은 아직 요청되지 않았다.
