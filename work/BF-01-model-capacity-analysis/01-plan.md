상태: 소스 구현·Windows 관련 검증·산출물 정리 완료. 합의한 복구 정책을 소스에 적용했습니다. 전체 앱 빌드·설치·실제 서비스 및 다른 OS 검증은 별도 범위입니다.

# 모델 용량 오류 회피 분석

## 목적·권한·범위

대상은 `azrael://threads/01a1334d-6a69-7821-a164-da04f3cfa71f`입니다. 반복되는 “Selected model is at capacity. Please try a different model.”의 원인을 실제 기록과 코드로 구분하고 운영 회피와 제품 개선 후보를 제시합니다. 허용 범위는 진단, 합의한 복구 정책의 코드·문서 구현, 필요한 테스트용 빌드·검증·정리와 작업별 커밋입니다. 실제 사용자 계정 유료 추론, 모델/계정 변경, 전체 앱 배포본 빌드·설치·게시에는 별도 지시가 필요합니다.

오류 의미와 재시도 정책은 공통 제품 로직입니다. 실제 관측 환경은 Windows 로컬, OpenAI provider, engine 0.162.0, `gpt-6.1-sol`, `high`입니다. 다른 OS, 모델 및 계정의 회피 성공률은 검증하지 않았습니다. 코드 조사 역할 capacity_code는 오류·재시도 경계만 읽고 root는 세션 증거, 설치 출처, 운영 권고와 통합을 소유합니다. 복구 정책의 담당 reload-recovery 문서와 기능 보존 항목을 갱신합니다. 기존 사용자 변경과 다른 작업의 변경은 보존합니다.

## 확인된 결론

해당 실패들은 구조화된 `codexErrorInfo: serverOverloaded`입니다. 계정의 사용량 소진이나 context 초과로 분류된 실패가 아닙니다. 서버 내부 용량 배정 단위, 지역별 혼잡, 계정별 우선순위 또는 high 추론 설정의 인과관계까지는 기록으로 확인할 수 없습니다.

동일 모델 자동 재시도 세 번이 해당 오류 구간에서 모두 실패했습니다. 이미 유한한 대기·재시도가 존재합니다. 현재 선택된 방향은 최초 capacity 오류 이후 1초·5초·10초 대기로 최대 3회 재시도하고, 모두 실패하면 재시도를 중단한 뒤 기존 요청의 종료를 확인하고 대화·작업 상태를 보존한 채 사용자 요청당 연결을 최대 1회 재생성하고 자동 재개하는 복구입니다. 재개 요청도 capacity 오류면 기존 10초·30초·120초·300초 재시도 정책으로 복귀합니다. 모델 전환은 자동 적용 범위에 포함하지 않습니다. 마지막 수동 재시도에서는 생성 및 도구 호출이 다시 진행됐습니다. 일시적 회복은 관측했으나 해당 작업의 최종 완료나 지속적 정상 상태는 확인하지 않았습니다.

## 실제 실패 이력

시간은 2026-10-14 한국 시간입니다. 아래는 턴 종료까지의 경과 시간으로 단일 HTTP 요청 지연이 아닙니다.

| 시작 | 종료 | 시작 경로 | 경과 | 결과 |
| --- | --- | --- | --- | --- |
| 15:28:46 | 15:37:06 | root_resume | 500.226초 | serverOverloaded |
| 15:37:17 | 15:37:23 | capacity_retry_automatic | 5.913초 | serverOverloaded |
| 15:37:54 | 15:38:00 | capacity_retry_automatic | 5.765초 | serverOverloaded |
| 15:40:01 | 15:40:40 | capacity_retry_automatic | 39.047초 | serverOverloaded |
| 15:42:50 | 15:45:38 | capacity_retry_manual | 167.997초 | serverOverloaded |

15:51:16에 시작된 다음 수동 재시도에서는 실제 응답 생성이 진행됐습니다. 세 번의 자동 재시도 시작은 이전 실패 종료 후 약 11초, 31초, 121초였습니다. 이는 해당 구간의 관측값이며 범용 고정 타이머 설정으로 단정하지 않습니다. 5/5 실패 및 자동 3/3 실패는 오류 구간에 한정된 관측이며 전체 모델 실패율이 아닙니다.

## 증거와 진단 의미

- `thread_history_1.sqlite`의 해당 thread_turns에는 serverOverloaded 실패 5개가 있습니다. 대화 rollout에는 error 이벤트가 없으므로 rollout만으로 오류가 없었다고 판단하면 안 됩니다. task_complete 이벤트 또한 성공을 뜻하지 않으며 history의 failed 상태를 함께 읽어야 합니다.
- `logs_2.sqlite`에서 빠르게 실패한 자동 재시도의 HTTP 상태는 200이었습니다. 네트워크 연결 및 HTTP 응답이 성공했어도 이후 모델 오류로 끝날 수 있습니다. HTTP 503만 처리하거나 HTTP 200을 생성 성공으로 집계하면 이 경로를 놓칩니다. 원본 SSE 오류 프레임 전체는 보존된 로그에서 직접 확인하지 못했으므로 원격 세부 원인까지 복원하지 않습니다.
- 해당 세션의 process_uuid는 PID 51552이며 Win32_Process의 실행 경로는 `artifacts/w14w/artifacts/releases/w14y/engine/codex.exe`입니다. 이 릴리스의 build-info.json은 frozen engine source를 `artifacts/engine-input-AF01`로 기록합니다. 다른 구버전 프로세스도 존재하지만 이 세션의 해당 오류를 구버전 실행으로 오인하지 않습니다.
- config.toml은 service_tier를 default로 설정합니다. 실제 모든 응답의 effective tier는 확인하지 않았습니다. API 문서의 유료 Fast/Ultrafast 옵션을 현재 로그인 경로의 사용 가능 옵션으로 단정하지 않습니다.
- 오류가 나기 전/도중 정상 생성의 마지막 입력 집계는 예를 들어 36,104 및 57,386 tokens였고 세션이 보고한 모델 context window는 828,400입니다. 이는 오류 요청 자체의 정밀 입력량이 아니지만 context 초과를 뒷받침하지도 않습니다. 오류 시 0 usage는 입력이 없었다는 뜻으로 해석하지 않습니다.
- direct child thread는 이 세션 전체에 51개(현재 저장된 모델은 Luna 18개, Sol 33개)입니다. 이 숫자는 동시 실행 수가 아닙니다. 같은 최근 구간의 child history에서 failed 턴이 발견되지 않아, 특정 동시 실행량이나 child 실행을 이번 오류의 확정 원인으로 지목할 수 없습니다.
- native 로그는 thread당 1,000행 보존 상한에 도달했고 조사 중 기존 기록이 밀려납니다. 과거 모든 요청의 오류 코드·Retry-After·소요 시간을 완전 복원할 수 없습니다. 원본 DB, 자격 증명 및 대화 본문은 분석 산출물로 복사하지 않습니다. 제한된 구조화 기록만 [evidence.json](evidence.json)에 보관합니다.

## 코드로 확인한 현재 동작

설치된 w14y 엔진의 frozen source에서 조사 대상 오류/재시도 파일은 현재 checkout과 byte-identical인 것으로 확인했습니다. UI는 아래 설치 파일 범위에서 확인했으며 실제 이미 열린 창의 메모리상 bundle까지 확인한 것은 아닙니다.

| 경계 | 현재 동작 | 근거 |
| --- | --- | --- |
| 표시 메시지 | `ServerOverloaded`를 해당 문구로 표시하고 protocol에서는 `serverOverloaded`로 매핑 | `engine/codex-rs/protocol/src/error.rs:151`, `:478` |
| HTTP | HTTP 503 및 JSON `error.code == server_is_overloaded`에서 overload 분류 | `engine/codex-rs/codex-api/src/api_bridge.rs:101` |
| SSE | `response.failed`의 같은 오류 code를 overload로 분류하고 `error.headers`의 Retry-After를 읽음 | `engine/codex-rs/codex-api/src/sse/responses_error.rs:87` |
| 엔진 overload 재시도 | 서버 Retry-After 안내가 있어야 재시도하며 없으면 terminal 처리. 서버 deadline을 그대로 따르고 이 경로에는 로컬 jitter 없음 | `engine/codex-rs/protocol/src/error.rs:397`, `core/src/responses_retry.rs:151` |
| 엔진 일반 재시도 | provider stream_max_retries 기본 5. 일반 retryable 오류는 200ms 기반 exponential backoff 및 ±10% jitter. WebSocket→HTTPS fallback에서 counter가 초기화될 수 있음 | `model-provider-info/src/lib.rs:498`, `async-utils/src/backoff.rs:7`, `core/src/responses_retry.rs:120` |
| UI 턴 재시도 | 연속 empty-input overload 턴에서 10→30→120→300초, 자동 최대 4회. 수동은 즉시. 같은 thread를 이어가며 다른 model/account를 선택하지 않음 | `artifacts/w14w/artifacts/upstream-ui/26.1007.21434/webview/assets/app-initial-c014f9ee4429.js:1`의 `DNi/ONi/CNi/SNi` |
| 계정 복구 | UsageLimitReached/QuotaExceeded/UsageNotIncluded에 한정하며 기존 model slug 보존. ServerOverloaded는 대상 아님 | `engine/codex-rs/core/src/session/turn.rs:1908`, `core/src/session/account_recovery.rs:18` |
| 자동 재시도 중단 UI | checkout에는 patch가 있으나 설치 2026.0.7 asset에서는 해당 marker와 data-azrael-capacity-stop이 둘 다 없음. 현재 사용자에게 이 버튼이 있다고 안내할 수 없음 | `scripts/inject-capacity-retry-stop.cjs:18`, `C:/Users/felre/.vscode/extensions/azrael-ex-local.azrael-2026.0.7/webview/assets/app-initial-c014f9ee4429.js` |

따라서 stream_max_retries 증가만으로 UI countdown을 조정할 수 없습니다. 이번 관측에서 자동 3회 실패는 원래 최대 4회 정책 중 일부이며, “원래 3회 제한”이라고 해석하지 않습니다. 서버 retry hint가 없어 엔진이 실패를 UI로 넘긴 후 UI가 새 턴을 만드는 경우도 있으므로 “엔진 기본 5회가 항상 실제 실행되었다”고 주장하지 않습니다.

HTTP 200 이후 structured overload라는 관측과 위 SSE 분류 코드는 서로 부합하지만 원본 frame의 error.code와 Retry-After 값은 보존되지 않아 직접 확증하지 못했습니다. 같은 모델로 돌아온 15:51 수동 시도는 모델 회복 또는 개별 요청 수용을 보여줄 뿐 서버 혼잡 원인이나 특정 대기 간격의 효능을 입증하지 않습니다.

현재 설치 UI에는 확인된 중단 patch가 없어, 중단 버튼 사용을 즉시 가능한 회피책으로 제시하지 않습니다. 중단 제어의 정상 배포 및 취소 유지 확인을 첫 구현 후보에 포함합니다. 운영상으로는 반복 수동 클릭을 피하고, UI가 허용하는 모델 선택/명시적 다음 턴 재개를 한 번만 실행합니다. 예약 재시도와 모델 변경이 겹치지 않는지 현재 상태를 확인해야 합니다.

## 선택된 복구 방향과 확인할 조건

기존 thread, 모델, 계정, 대화, 완료된 도구 결과 및 agent 상태를 유지하고 모델 연결만 새로 만드는 방향을 선택했습니다. 새 채팅 생성과 다른 provider/모델 자동 전환은 선택된 동작에 포함하지 않습니다. 초기에는 빠른 재시도와 연결 재생성으로 복구를 시도하고, 복구 후에도 capacity 오류가 지속되면 기존 재시도 정책을 사용합니다. 연결 재생성 자체는 사용자 요청당 한 번만 허용합니다.

사용자는 새 채팅에서 길어야 약 10초 지연 후 재개되는 것으로 관측했습니다. 이는 사용자 관측으로 반영하며 이 작업에서 독립적으로 실험하지 않았습니다. 차세대 모델 학습이 서버 용량을 줄였다는 인과관계도 확인되지 않았습니다. 연결 재생성이 새 채팅과 같은 서버 routing/admission 변화를 일으킨다고 가정하지 않습니다.

확정된 복구 순서는 다음과 같습니다. 최초 실패 요청은 재시도 횟수에 포함하지 않으며, 대기 시간은 직전 요청이 capacity 오류로 종료된 시점부터 각각 계산합니다.

1. 최초 capacity 오류 후 1초 대기하고 첫 번째 재시도를 요청합니다.
2. 첫 번째 재시도도 capacity 오류로 끝나면 5초 대기하고 두 번째 재시도를 요청합니다.
3. 두 번째 재시도도 capacity 오류로 끝나면 10초 대기하고 세 번째 재시도를 요청합니다.
4. 세 번째 재시도도 실패하면 초기 capacity 자동 재시도를 정지하고 해당 단계의 timer/예약을 해제합니다. 늦게 도착한 callback과 root resume 등 다른 진입 경로가 종료된 초기 단계의 추가 요청을 제출하지 못하도록 합니다.
5. 마지막 요청의 terminal 상태와 해당 로컬 sampling/stream 작업의 종료를 확인합니다. 화면의 오류 표시나 HTTP 200만으로 종료를 판단하지 않으며, 종료가 불명확하면 연결 재생성을 보류합니다. 원격 생성의 실제 종료 확인 가능 범위는 별도 검증 대상입니다.
6. 종료가 확인된 뒤 기존 thread의 모델 연결을 해당 사용자 요청에서 최대 1회 재생성합니다. 완료된 도구 실행 및 진행 중인 독립 작업은 재실행하거나 취소하지 않습니다. 재생성 시도를 시작할 때 사용 여부를 기록하여 재생성 실패에도 다시 시도하지 않습니다.
7. 연결 재생성이 성공하면 같은 세션의 미완료 작업을 자동으로 한 번 이어갑니다. 이 모델 요청도 capacity 오류로 끝나면 기존 정책의 첫 단계인 10초부터 시작해 30초·120초·300초 순서로 재시도합니다. 기존 자동 최대 4회 및 수동 재시도 동작은 유지합니다. 연결 재생성 자체가 실패하면 기존 오류 처리로 넘기며 추가 연결 재생성을 실행하지 않습니다.

중간 재시도에서 정상 진행이 회복되면 남은 재시도와 연결 재생성을 실행하지 않습니다. 다른 오류로 전환되면 해당 오류의 기존 처리로 넘기며 capacity 재시도를 계속하지 않습니다. 사용자의 명시적 중단은 초기 및 기존 정책의 남은 timer, 연결 재생성과 자동 재개를 모두 차단합니다.

초기 단계의 세 번은 엔진과 UI를 합친 동일 복구 주기의 추가 capacity 추론 요청 예산입니다. 연결 재생성 후 자동 재개와 기존 정책으로 복귀한 후의 시도는 별도 단계로 집계합니다. 엔진 내부 요청 재시도와 UI 새 턴 재시도가 각각 세 번씩 발생해서는 안 됩니다. 서버가 더 긴 Retry-After를 요구하면 해당 요청은 서버가 허용하는 시점 이전에 제출하지 않습니다. 서버 안내가 없는 경우의 기본 대기 합계는 16초이며 요청 처리 시간과 종료 확인·연결 재생성 시간은 별도입니다. 이전의 전체 자동 복구 대기 10초 상한 제안은 이 순차 대기 정책으로 대체합니다.

사용자 요청 identity에 연결 재생성 사용 여부와 복구 단계를 연결합니다. 자동 capacity retry, root resume, 재개 및 같은 작업의 수동 재시도는 새로운 사용자 요청으로 간주해 연결 재생성 한도를 초기화하지 않습니다. 사용자가 새 작업·지시를 제출했을 때만 새 요청의 연결 재생성 기회를 부여합니다. 창 remount/reload가 동일 요청의 사용 여부를 초기화해서도 안 됩니다.

초기 짧은 재시도 → 종료 확인 → 연결 재생성 및 자동 재개 → 기존 재시도 정책의 일방향 전이를 사용합니다. 기존 정책 단계에서 다시 초기 1초·5초·10초 단계나 연결 재생성 단계로 돌아가지 않습니다. 기존 최대 4회에 도달하면 자동 재시도는 멈추고 기존 수동 재개 수단을 남깁니다. 시간 간격만 복원하고 무한 반복 기능을 새로 추가하는 것으로 해석하지 않습니다.

연결 재생성 완료와 실제 모델 요청 재개는 별도 상태와 시도 횟수로 기록합니다. 같은 요청의 초기 재시도 3회 외에 연결 복구 후 자동 재개 요청 1회 및 기존 정책의 최대 4회 자동 재시도가 발생할 수 있습니다. 요청별 처리 시간과 서버 Retry-After 때문에 전체 복구 시간은 고정되지 않습니다. 실제 복구 효과와 캐시·비용 영향은 미검증입니다.

## 연결 재생성의 재사용 경계

`engine/codex-rs/core/src/client.rs:417`의 WebsocketSession.reset은 socket connection, last request/response와 transport continuation cache를 비웁니다. `:610`의 ModelClient.new_session은 turn 단위 객체를 만들지만 cached WebSocket을 가져오므로 이 함수를 다시 호출하는 것만으로 새 연결을 보장하지 않습니다. `:1624`의 websocket_connection은 닫힌 socket이나 연결 조건 변경 시 기존 reset/connect 경로를 재사용할 수 있습니다.

`:2375`의 try_switch_fallback_transport는 WebSocket을 세션 전체에서 끄고 HTTP로 전환하는 동작입니다. 이는 일회 연결 재생성과 다른 계약이므로 그대로 복구 기능이라고 사용할 수 없습니다. 마지막 도구 목록은 client state에서 connection reset 이후에도 보존하도록 되어 있습니다.

실제 오류 구간에는 HTTP 200 응답 경로가 있었으므로 WebSocket reset만 적용해서는 범위를 충족하지 못할 수 있습니다. HTTP는 `client.rs:1232`의 build_api_transport 및 `http-client/src/client_builder.rs:198`에서 route-specific client를 빌드하는 기존 경로를 사용합니다. 해당 요청에서 이미 새 transport client/connection이 사용됐는지와 서버의 turn routing state가 어떤 수명으로 유지되는지를 실제 복구 검증에서 구분해야 합니다. 연결 재생성은 네트워크 정책·인증·계정 소유권을 보존하며 server retry hint와 중복 요청 방지를 우회하지 않습니다.

이 연결 경계를 재사용한 native 복구 코드를 구현하고 관련 Windows 검증을 통과했습니다. 설치된 제품에서의 동작 검증은 아직 수행하지 않았습니다. 구현에서는 active engine/ 소스를 사용하고 frozen 설치본과 구분합니다. Windows fixture 및 관련 모듈 검증을 수행하며 실제 계정 추론은 실행하지 않습니다.

## 연결 복구와 캐시·비용

연결 단위의 previous-response continuation cache와 입력 할인에 쓰이는 prompt KV cache를 구분합니다. 공식 WebSocket 문서상 연결 종료 시 전자는 사라집니다. 현재 Azrael request는 `client.rs:1050` 부근에서 store=false이고 WebsocketSession.reset은 last request/response를 비우므로, 다시 연결한 첫 요청은 previous_response_id 및 incremental input 대신 full context를 보내는 경로가 예상됩니다(`:2077`). 전체 문맥 재전송이 전체 토큰의 prompt cache miss와 같은 의미는 아닙니다.

프롬프트 KV 캐시는 일치하는 입력 prefix를 재사용하는 별도 메커니즘입니다. `client.rs:582`의 prompt_cache_key는 override 또는 세션/부모 identity에서 파생되며 socket identity 자체를 사용하지 않습니다. root의 Responses session-id header도 이 key에서 파생됩니다(`:598`). 따라서 기존 thread/cache key, 모델, 지시문·도구 정의·대화 prefix를 유지한 연결 reset이 모든 프롬프트 cache를 강제 폐기한다고 볼 근거는 없습니다. 서버 캐시 배치/보존/재라우팅 조건 때문에 hit 보장은 할 수 없습니다. API GPT-5.6+ 자동 cache routing과 현재 로그인 기반 ChatGPT 경로의 affinity 동작도 동일한 계약이라고 단정하지 않습니다.

실제 15:51 수동 재시도 이후 기록의 한 응답은 input 57,386 / cached 56,832(99.03%), 15:56의 응답은 input 85,193 / cached 83,328(97.81%)이었습니다. 실패/재개가 항상 cache 전체 miss를 뜻하지 않는 실제 근거입니다. 이는 의도적으로 연결을 reset한 비교 실험이 아니므로 reset 효과의 측정값으로 보고하지 않습니다.

API 과금에서는 previous_response_id로 보낸 입력도 chain 전체의 입력 tokens가 과금 대상이며 cached 여부에 따라 단가가 달라집니다. 따라서 wire에 delta만 보냈다는 사실 자체가 이전 문맥 입력 비용이 0임을 뜻하지 않습니다. 현재 사용자 계정의 실제 청구/구독 usage 산식을 API 가격과 동일하게 환산하지 않습니다. 복구의 추가 비용은 복구 요청 수, cache read/write/uncached 입력, 새 output/reasoning 사용량 및 실제 계정 과금 체계를 함께 봐야 합니다.

복구 설계에서는 연결만 reset하고 세션/cache identity와 입력 prefix를 보존하며 불필요한 재요약·지시문/도구 재정렬을 피하는 것을 권고합니다. 정상 요청과 최초 복구 요청 및 이후 2~3회의 input/cached/cache_write/output usage, 첫 토큰 지연과 전체 복구 시간을 비교해야 실제 비용 영향을 평가할 수 있습니다. live 실험은 아직 미실행입니다.

근거: [Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching), [WebSocket mode](https://developers.openai.com/api/docs/guides/websocket-mode), [Conversation state](https://developers.openai.com/api/docs/guides/conversation-state).

## 구현 범위와 검증 기준

합의한 복구 정책은 native OpenAI Responses sampling의 구조화된 ServerOverloaded 경계에 적용합니다. 기존 HTTP/SSE 오류 분류, 입력 기록, 취소, 샘플링 재진입과 transport 생성 기능을 재사용했습니다. 새 요청은 기록에 성공한 substantive user input의 client identity 또는 turn/acceptance-order로 구분합니다. 자동 capacity retry, root resume, 기본 continue 입력과 heartbeat는 새 한도를 받지 않습니다. 재개 턴에 사용자가 새 steering을 보낸 경우 opening trigger를 그대로 새 입력에 적용하지 않습니다.

초기 추가 시도 3회는 엔진이 1초·5초·10초 순서로 소유하고 generic stream retry와 transport fallback의 추가 횟수를 중첩하지 않습니다. 모두 실패하면 앞선 sampling 소비자와 mapper의 종료 확인 후 연결을 한 번 정리하고 sampling을 이어갑니다. 이후 overload는 서버 deadline을 준수한 뒤 기존 UI의 10초·30초·120초·300초/자동 최대 4회로 넘깁니다. 종료 미확인은 자동 capacity timer가 재시작되지 않는 별도 terminal 오류로 남깁니다. 도구 실행과 선택된 계정·모델, thread 및 prompt cache identity를 보존합니다.

기능 계약은 [reload-recovery](../../docs/architecture/reload-recovery.md#capacity-recovery-within-a-user-request), 보존 항목은 engine.capacity-recovery입니다. 새 정책 상태·입력 identity·deadline·취소·local mapper 종료/timeout 및 기존 정책 handoff를 Windows native 검사로 검증했습니다. 기존 UI stop와 host/bridge continuation·중복 방지 검사는 그대로 재사용했습니다. UI timer나 외형은 변경하지 않았습니다. 다른 OS 및 실제 공급자 혼잡 해소는 검증하지 않았습니다.

## 공식 근거

OpenAI API 문서는 일시 overload와 rate limit/사용량 오류를 구분하고, Retry-After 우선 및 제한된 exponential backoff+jitter를 권고합니다. stream이 시작된 후에는 실패가 이벤트로 도착할 수 있어 출력을 소비한 요청의 무조건 재실행을 피하도록 안내합니다. 복구 문서는 overload가 계속되면 이후 턴의 모델을 바꾸는 방법을 안내합니다. 이 문서들의 API 계약을 로그인 기반 Codex 경로와 동일한 endpoint/계약이라고 가정하지 않습니다.

- [Error codes](https://developers.openai.com/api/docs/guides/error-codes)
- [Rate limits](https://developers.openai.com/api/docs/guides/rate-limits)
- [Errors and recovery](https://developers.openai.com/api/docs/guides/agents-api/errors)
- [Fast mode](https://developers.openai.com/api/docs/guides/fast-mode)

## 검증·남은 제한

초기 진단에서 SQLite를 mode=ro로 읽고 코드·대화·실행 경로를 대조했습니다. 이후 사용자 구현 요청 범위에서 source 수정과 관련 검증을 수행했습니다. Windows host 검사 342개와 최종 native 검사 20개가 모두 통과했습니다. fixed r1의 pure-policy 독립 검사 6개도 통과했으며 이 테스트들은 최종 native 범위에도 포함됩니다. 기존 engine/codex-rs/target cache를 재사용했고 새로운 전체 앱/배포본은 만들지 않았습니다.

실제 모델 probe, 계정·모델 설정 변경, 설치·게시를 수행하지 않았습니다. 회피 정책의 실제 성공률, 연결 재생성 후 실제 cache hit/계정 비용, 다른 모델의 용량, 서버 장애·지역 혼잡 및 effective service tier는 미검증입니다. 원본 과거 SSE frame과 당시 UI 메모리 상태는 미확인입니다. 요청별 예산은 loaded Session에 보관하며 engine restart/unload 뒤 알려진 budget이 없는 단순 continuation은 기존 정책을 사용합니다. 실제 설치본은 이번 소스 변경을 아직 포함하지 않습니다.

## 구현 책임과 실행 조건

root는 요청별 복구 identity와 정책, 공통 계약, 통합·검증·문서·커밋을 소유합니다. read-only capacity_engine_boundary는 native 연결 종료/reset 및 sampling 경계를 조사했고, capacity_policy는 pure-state 모듈과 관련 retry 테스트를 구현했습니다. UI 변경이 필요한지는 native 소유 경계 조사 후 판단하며 기존 OpenAI 형태와 중단 제어를 보존합니다. 핵심 선행 조건은 현재 sampling 요청이 종료된 뒤 동일 session/cache identity로 새 transport를 만들 수 있는 경계와, 후속 자동 재시도가 같은 사용자 요청의 재생성 한도를 유지하는 identity입니다. 실제 서버 용량 확보와 캐시 hit는 검증 성공 조건으로 보장하지 않습니다.

## 구현·검증 중간 결과

공통 native OpenAI Responses sampling에 초기 1/5/10초 재시도와 한 번의 연결 재생성을 구현했습니다. request identity는 durably recorded substantive user input에서 얻고, 같은 thread의 ExtensionData에 보관합니다. sampling 미래와 소비 stream이 반환·drop된 뒤 mapper receipt로 로컬 종료를 확인하며, 10초 내 확인 실패 시 Fatal 오류로 자동 capacity timer를 차단합니다. 같은 request의 다음 overload는 서버 deadline 이후 기존 UI에 넘기므로 기존 10/30/120/300·최대 4회가 그대로 적용됩니다. UI 외형·timer 자체는 변경하지 않았습니다.

고정 r1 입력으로 pure-policy rustc 테스트 6개 통과(exit 0), 기존 host capacity-stop/recovery-state/bridge 테스트 342개 통과(exit 0). 로그는 artifacts/logs/BF-01-capacity/에 보관합니다. native-r1은 공유 Cargo cache lock에서 대기한 뒤 컴파일했으나 HTTP receiver 저장 경로의 &self 변경 불가 E0594로 exit 101; 테스트 실행 전 실패입니다. 해당 호출은 이미 mutable ModelClientSession 소유이므로 HTTP stream 메서드를 &mut self로 고쳤습니다. 추가로 새 user steering이 opening root_resume trigger를 물려받아 quota 갱신을 놓치는 경우를 별도 입력 경계로 구분하고 회귀 테스트를 추가했습니다. 검증 입력은 새 identity로 고정하며 이전 스냅샷을 덮어쓰지 않습니다.

최종 변경 엔진 입력은 frozen r3과 대조해 일치합니다. r2는 복사 중 수정으로 고정 실패했으며 검증에 사용하지 않았습니다. r3 native 검증은 전용 완료 신호 82578055-a989-4185-81e1-0db717ae0079로 실제 종료를 보고하며 로그는 native-r3.log입니다. 공유 cache는 다른 Cargo 작업과 독점 잠금을 공유하므로 중복 compile은 실행하지 않습니다. Native 결과 확인 후 담당 계약 상태 갱신, task-owned snapshot/실행파일 정리, 다른 작업과 분리한 커밋을 진행합니다.

최종 native-r3 검증: exit 0, 20 passed / 0 failed, 테스트 실행 11.69초. 17개는 이번 capacity 상태·입력·시간·취소·연결 검증이며 나머지 3개는 filter에 일치하는 기존 capacity 회귀입니다. core production/library와 테스트 컴파일을 포함한 Windows 결과입니다. 실제 provider inference, 전체 앱/VSIX 빌드·설치와 다른 OS 검증은 미실행입니다. 종료 신호는 succeeded/exit 0이며 실제 명령 exit와 로그를 함께 확인했습니다. Feature manifest validation 및 runner JS syntax, 변경 코드 whitespace 검사 exit 0입니다.

모든 task-owned r1/r2/r3 source snapshot과 pure-policy test 실행파일은 runtime/release 참조가 없음을 확인한 뒤 일반 삭제했고 부재를 확인했습니다. 공유 active Cargo cache와 실행·입력 hash 영수증 및 로그는 보존합니다. r3의 compiler/test 전체 단계는 14분 50초, 테스트 자체는 11.69초였습니다. 중간 실패 r1의 원인과 실패한 r2 freeze 기록은 위에 남겼으며 관련 snapshot을 재사용하지 않았습니다.
