# Claude refusal 원인과 정상 응답 복구

상태: 확보된 refusal과 처리 경로의 원인 분석 및 해결 방안 정리 완료. 공급자 내부 판정과 실제 작업의 정상화는 미검증이며, 아래 변경안은 제안이다. 기존 오류 분류 변경은 b7a03ee1로 완료했다.

사용자 결정: 429 재현은 필요 없다. `stop_reason: refusal` 없이 정상 응답을 받는 것이 성공 기준이다. refusal을 성공으로 바꾸거나 숨기는 것은 성공이 아니다. 기존 계정과 모델을 보존하며 변경의 근거를 확보한다.

범위: 공통 managed Anthropic 요청/응답 계약(Windows x64, Linux x64, macOS ARM64 공통 의미). 실제 검증은 Windows. source 변경과 필요한 작은 검사/실제 호출을 수행할 권한이 있으며 전체 배포 build/설치는 별도 범위다. 사용자 기존 upstream/은 보존한다.

진행: root는 안전한 실제 응답의 stop_details와 원인 범주 및 현재 구현을 조사하고, read-only refusal_request_contract agent는 요청 projection/auth/header와 기존 검사 근거를 확인한다. 별도 모델 전환, 계정 교체, 인증 위장 또는 요청 내용의 안전 장치 회피는 도입하지 않는다. 원인을 확인한 뒤 해당 소유 코드와 최소 회귀 검사를 수정한다.

검증: 기존 실패 근거는 최소 harmless prompt, HTTP200, input156/output0, refusal이다. 이전 probe는 원래 35k 맥락 재현이 아니다. 새 실제 호출은 동일 계정 binding의 임시 fork를 사용하고 단일 호출/60초 deadline/재시도 및 auto-switch 없음으로 제한한다. 원문·credential은 기록하지 않고 stop_reason, allowlisted stop_details category, usage, 구조 및 source identity만 보존한다. 성공에는 실제 end_turn/유효 출력과 관련 회귀 검사 exit0이 필요하다.

산출물 소유: work:BU-01-refusal-cause-run-01. artifacts/tasks/refusal-cause/runs/01/logs, reports는 진단 근거로 보존한다. temporary의 probe script 및 새 UUID binding은 생성 전 소유를 기록하고 producer 종료와 실제 경로/내용을 검증한 뒤 일반 삭제한다. 관리 근거는 본 문서와 reports에 보존하고 최종 등록/검토한다. 기존 error-specificity run의 자료는 수정하지 않는다.


## 확인된 원인과 한계

앞선 작업의 원문 probe를 이 작업 세션 rollout의 도구 입력에서 복원했다. 지침은 `This is a diagnostic probe. Reply with exactly AZRAEL_ERROR_PROBE_OK. Do not call tools.`, 사용자 입력은 `Reply with exactly AZRAEL_ERROR_PROBE_OK.`였다. 이 문구는 제품 코드에 없고 root가 만든 일회성 진단 요청에만 있었다. 같은 문자열을 현재 동일 계정/model/high에 다시 보내자 HTTP200, input156/output0, `stop_reason: refusal`, `stop_details.type: refusal`, `category: cyber`를 수신했다. 설명 원문은 보관하지 않고 존재와 길이206만 기록했다. 이 benign 요청에 공급자 cyber 분류가 걸린 것은 확인됐지만, 어떤 단어나 내부 규칙이 결정했는지까지 알 수 없다. 모든 요청에 적용되는 인증 실패라는 기존 가능성은 이 비교로 뒷받침되지 않는다.

동일 source/account/model/high의 산술 질문(`What is 2 + 2? Give only the number.`)은 HTTP200, end_turn, stop_details null, input134/output15(그중 thinking12), visible output1자로 성공했다. 실제 출력 문자는 저장하지 않았으므로 정답 4인지 독립 재검증했다는 주장은 하지 않는다. 이것은 최소 일반 요청이 정상 종료함을 보이며 전체 app/원래 작업 수락을 뜻하지 않는다.

세 번째 호출은 원래 세션의 저장된 base/developer/user 맥락과 compatible profile을 사용하고 도구 catalog/실행은 제외했다. 네 번째는 현재 compatible profile에 짧은 정상 TypeScript 덧셈 함수 작업을 사용했다. 두 호출 모두 HTTP429로 끝났고 refusal의 유무나 profile별 정상 동작을 검증하지 못했다. 429를 유도하거나 제한 원인을 추가 실험하지 않았으며 이후 호출을 중단했다. 이 둘의 결과를 정상 동작 검증이나 최초 429의 동일 재현으로 취급하지 않는다.

## 실행 근거와 다음 조건

모든 실제 호출은 새 UUID fork binding, 원래 계정 일치 확인, 모델 claude-opus-5-5/high, network request1, 자동 전환/재시도0, deadline60초로 제한했다. producer 실행 자체는 모두 exit0으로 JSON 진단 기록을 완료했다. 추론 결과는 아래와 같이 별개다. source hash가 네 시도 전후 모두 같았고 제품 소스나 설치 파일을 수정하지 않았다.

| 시도 | 시작~종료 UTC (2026-10-16) | 추론 결과 | 근거 |
| --- | --- | --- | --- |
| 01 | 2026-10-16T15:13:31.087Z~2026-10-16T15:13:34.077Z | HTTP200/end_turn, nonempty output | reports/probe-01.json, logs/probe-01.log |
| 02 | 2026-10-16T15:14:23.155Z~2026-10-16T15:14:25.475Z | HTTP200/refusal, explicit cyber | reports/probe-02.json, logs/probe-02.log |
| 03 | 2026-10-16T15:15:42.861Z~2026-10-16T15:15:43.817Z | HTTP429, refusal 검증 불가 | reports/probe-03.json, logs/probe-03.log |
| 04 | 2026-10-16T15:15:57.125Z~2026-10-16T15:15:58.294Z | HTTP429, refusal 검증 불가 | reports/probe-04.json, logs/probe-04.log |

시간의 정확한 값은 각 report가 소유한다. 초기 실패 원인을 재현하는 요청의 의미는 정상 작업 대신 diagnostic marker였으므로 제품 지침을 임의로 바꾸는 근거로 쓰지 않는다. refusal을 end_turn으로 바꾸거나, 공급자 안전 장치에 맞춰 identity/header를 위장하거나, 모델을 자동 교체하는 변경은 하지 않았다. 429 재현은 사용자 목표가 아니며 추가 시도를 하지 않는다.

공식 근거: https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback 에서는 refusal이 HTTP200으로 올 수 있으며 stop_details.category와 explanation이 사유를 나타낸다고 설명한다. cyber에는 정상 보안 업무의 false positive도 가능하다고 명시한다. 이 문서 설명 자체를 해당 계정의 내부 결정 근거로 단정하지 않는다. https://code.claude.com/docs/en/legal-and-compliance 의 현재 인증 계약도 확인했지만 이번 successful call/refusal 비교만으로 인증 계약이 해당 refusal의 원인이라고 결론 내릴 수 없다.

read-only agent refusal_request_contract는 OAuth pin/headers와 compatible system projection의 소유를 확인했다. 현재 compiled.claudeProfile 분기는 vendored system 대신 native system을 보내도록 의도됐고 기존 offline fixture가 보존한다. 이 경로의 실제 성공은 이번 제한 때문에 확인하지 못했다. marker 문구는 providers/opencodex, instructions, engine/codex-rs와 관련 architecture 문서에서 발견되지 않았다.

사용자가 실제 실패를 유도할 요청으로 이전 세션의 목표를 파악하고 이어서 진행하라는 문구를 지정했다. 최초 링크의 기록된 실패는 HTTP429이며, 공급자 cyber refusal의 직접 근거는 root의 진단 probe이다. 지정된 문구의 도구 조건 재현 결과와 이 직접 근거의 범위를 구분한다.

## 정리와 보관

실행 종료 report, UUID/path/thread_id, lock 부재를 대조해 이 run의 임시 binding4개를 일반 삭제했고 모두 부재를 확인했다. 원래 binding/계정은 유지했다. temporary의 probe script4개는 검토 가능한 진단 근거로 reports/probe-scripts로 옮겼다. 고정 report 경로를 쓰는 원본 증거이므로 재실행하지 않는다. temporary plan-body와 빈 temporary directory는 일반 삭제했다. reports/cleanup.json이 실제 결과를 기록한다. logs/reports는 이 분석 소비가 끝나거나 후속 실제 refusal 사례로 대체될 때 재검토한다. 코드 변경이 없어 제품 회귀 검사/빌드/설치를 새로 수행하지 않았다.


## 도구 사용 조건의 추가 재현

사용자는 `"azrael://threads/01a12f03-0fcf-7550-adac-0df5148b0cf2" 이 세션의 작업 목표를 파악하고 작업을 이어서 진행해주세요`를 보내 모델의 도구 사용을 유도하도록 요청했다. 별도 제품 개발 요청으로 전환하지 않고 refusal 원인 조사 안에서 이 문구를 그대로 사용한다. run02는 같은 계정/model/high, 현재 compatible profile, 실제 Read/Bash tool schema를 전달한다. 첫 응답의 도구 호출과 stop_details를 관측하며 명령을 자동 실행하지 않는다. 필요한 경우 실제 읽기만 검증된 범위에서 수행한다. 첫 요청에는 자동 retry/모델 변경 없이 60초 deadline을 적용한다. 429면 refusal 검증 불가로 기록하고 제한을 재현하려는 반복 호출은 하지 않는다.

산출물 소유는 work:BU-01-refusal-cause-run-02, 경로는 artifacts/tasks/refusal-cause/runs/02/{logs,reports,temporary}이다. 임시 새 UUID fork binding은 사전 owner record를 만들고 종료 후 검증하여 일반 삭제한다. 이 run의 JSON 보고서와 진단 script는 후속 원인 분석에 필요하므로 logs/reports에 보관한다. 진행 전 발견한 docs/architecture/window-use.md 변경과 기존 upstream/은 다른 작업의 것으로 보존한다.


run02 결과: 2026-10-16T15:46:59.938Z~2026-10-16T15:47:00.974Z UTC, producer exit0, 실제 inference failed/provider_error_undefined, HTTP429, networkRequests1, toolCalls0/output0, SSE event0. 원래 binding 계정 일치와 source hashes 불변을 확인했다. tool catalog는 현재 compatible Read/Bash 2개이며 tool_choice를 강제하지 않았다. 원래 28개 catalog나 전체 세션 입력을 동일하게 재현한 것은 아니다. 모델의 실제 첫 도구 호출 이전 HTTP 단계에서 실패했으므로 이번 시도로 refusal 발생/해결 여부를 판단할 수 없다. 반복 호출로 429를 재현하는 실험은 하지 않았다.

run02 진단 근거: artifacts/tasks/refusal-cause/runs/02/reports/probe-01.json, reports/probe-01.ts(실행 입력 근거, 고정 경로이므로 재실행 금지), logs/probe-01.log. 다음 검증은 공급자가 이 계정의 요청을 수락할 때 동일한 사용자 문구와 도구 조건으로 실제 tool_use/거부 category를 확인하는 것이다. 현재 HTTP 응답 단계의 차단을 제품 프롬프트 결함으로 추정하여 수정하지 않는다. 코드 변경이 없으므로 제품 회귀 검사/빌드를 실행하지 않았다.

run02 정리: 종료 후 owner/thread/path/lock 검증을 거쳐 새 임시 binding과 빈 temporary directory를 일반 삭제했다. reports/cleanup.json에서 두 경로 부재와 원래 binding 보존을 확인했다. 로그·보고서·실행 입력 script는 work:BU-01-refusal-cause-run-02로 등록하고 후속 수락된 요청이 이 차단 근거를 대체할 때 재검토하도록 defer했다.


## 원인 분석과 권고 변경안

현재 요청 범위는 문제 원인 분석과 해결 방안 제시다. 추가 제품 변경·외부 계정 변경·공급자 메시지 전송 없이 기존 live evidence, 현재 소스, 공식 API 계약을 대조했다. 이번 턴에는 inference를 추가 호출하지 않았다.

확정 가능한 직접 원인: run01/probe02에서 공급자가 HTTP200 스트림의 message_delta에 stop_reason=refusal, stop_details.type=refusal, category=cyber를 전송했다. 출력은0이고 tool catalog도0이다. 그러므로 로컬 도구 실행 오류는 그 실패의 원인이 아니며 도구 사용은 refusal 발생의 필수 조건이 아니다. cyber는 공급자가 붙인 분류이고, 악성 작업이 실제 존재했다는 로컬 판정은 아니다. diagnostic 요청 내용은 해가 없는 고정 문자열 반환이며 false positive 가능성을 강하게 시사한다. 다만 본문 explanation은 존재/길이만 보존했고 공급자 내부 판정 근거는 없다. '특정 marker 자체가 원인'이라는 앞선 설명은 증거보다 강했다. 시스템 지침과 사용자 입력이 함께 바뀐 비교이므로 어느 부분이 촉발했는지는 미확정이다.

확정된 앱의 진단 결함: vendor/src/adapters/anthropic.ts:1237의 message_delta 처리는 usage와 stop_reason만 취하고 stop_details를 버린다. message_stop 경로(1086 emitDone)는 refusal stopReason을 전달하지만, EOF 보완 분기(1289)는 refusal/content_filter를 content_filter로 합친다. inference.ts:330은 허용한 네 종료 사유 외의 모든 값을 provider_incomplete로 합친다. observeAnthropic(:358)도 stop_details를 보존하지 않는다. 결과적으로 공급자 refusal, 출력 예산 초과, 기타 미완료를 구별할 근거가 상위 경로에 남지 않는다. 이 진단 결함은 최초 공급자 refusal을 발생시키지는 않지만 원인별 해결을 방해한다.

미확정 요소: 사용자가 지정한 세션 이어가기 문구+도구 조건은 run02에서 HTTP429로 스트림 시작 전 종료됐다. 그 작업의 refusal 범주가 cyber인지, tool definition/전체 지침/이전 맥락/호출 결과 중 어느 부분이 관련되는지 검증되지 않았다. 같은 계정/model/high의 간단 요청은 성공했으므로 항상 발생하는 인증 실패라는 결론도 성립하지 않는다. compatible profile의 system override는 의도된 기존 계약이며 실패 원인이라는 근거 없이 identity/header를 바꾸지 않는다.

권고 순서:

1. 공급자 거부의 구조화된 전달을 먼저 보완한다. 실제 stop_reason=refusal일 때만 provider_refusal로 구별하고 원래 stop_reason과 allowlisted stop_details.category를 진단으로 보존한다. EOF 분기에서도 의미를 동일하게 유지한다. null/미지원 category는 그대로 미정으로 남기고 미확인 오류는 '정의되지 않은 오류'로 처리한다. freeform explanation을 오류 분류 규칙으로 파싱하거나 원문 요청을 로그로 남기지 않는다. 이 변경은 진단 개선이며 정상 응답 보장과 구분한다. 영향 소유자는 vendor adapter/types, managed inference observer/translate, native error transport/diagnostic export 및 UI의 명확한 refusal 표시다.

2. 실제 실패 요청에서 정상화할 입력 경계를 결정한다. 동일한 사용자 문구, 계정, 모델, reasoning과 인증 경로를 고정하고 user/task only → 실제 Read/Bash schema 추가 → 현재 native 지침 → 실제 이전 맥락의 단계별 차이를 비교한다. 한 번에 한 요소를 바꾸고 HTTP200인 비교만 refusal의 인과 근거로 사용한다. 사용자가 제공한 조건을 우선 재현한다. 도구 호출 전 실패와 tool_result 다음 실패를 구분한다. 거부된 정상 요청에서 불필요한 과거 시스템/진단 내용을 새 지침으로 중복 주입하는 투영 오류가 확인되면 그 소유 경계만 고친다. 정책·권한 지침을 숨기거나 무작정 제거하는 축소는 제안하지 않는다. 수락 기준은 실제 tool_use → 유효 도구 입력/실행 → 결과 전달 → end_turn의 정상 완료다.

3. 세션 이어가기의 실행 경로는 기존 thread/read API 재사용을 우선 검토한다. 현재 app-server-protocol/src/protocol/common.rs:858에 thread/read, protocol/v2/thread.rs:1728에 ThreadReadParams, app-server/src/request_processors/thread_processor.rs:865에 thread_read가 있다. paginated thread는 metadata 조회 후 기존 thread/turns/list와 thread/items/list로 필요한 범위만 읽는 계약을 따른다. UI 링크 탐색 경로와 모델의 세션 조회는 별도 책임이다. 권한 있는 같은 Azrael 세션만 검증한 뒤 구조화된 대화/작업 상태를 읽기 전용으로 제공하면, 모델이 전체 private 상태 디렉터리를 Bash로 탐색하고 raw rollout 내부 제어/진단 기록을 작업 지침으로 읽게 할 필요가 줄어든다. 원래 링크 형식과 사용자 내용은 보존한다. 이것은 재사용 가능한 흐름 개선안이며 cyber 거부의 원인으로 입증되거나 해소가 검증된 변경은 아니다. 도구 노출/권한/전달 범위 설계가 필요하다.

4. 정상 요청의 공급자 false positive가 유지되면 공급자가 제공하는 대응을 선택한다. 공식 refusals-and-fallback 문서는 server-side fallbacks=default + server-side-fallback-2026-07-01을 설명한다. 다만 현재 OAuth 경로의 지원은 확인되지 않았고 현재 parser는 fallback content block을 허용하지 않는다. 따라서 beta header 한 줄 추가로 완료할 수 없으며 원래 model 고정 계약, 실제 응답 model/replay 범위, fallback block, iterations billing, 부분 출력 폐기/도구 미실행을 함께 설계해야 한다. 모델 변경이 허용되지 않으면 대체 없이 공급자에 false positive 조정을 요청하는 경로가 남는다. 이는 정상 요청을 전달하기 위한 공식 선택지이며 모든 refusal을 없애는 보장은 아니다. 외부 문의는 사용자가 지시하기 전 전송하지 않는다.

제안 검증은 거부/정상/end_turn/tool_use/max_tokens/알 수 없는 종료, 실제 terminal 유무, 알려진/미지원/null category 및 부분 tool input 후 refusal에서 도구 실행0을 확인하는 focused 검사와 실제 사용자 요청의 정상 왕복을 포함한다. 공통 계약은 Windows/Linux/macOS에 적용하되 실제 live 근거는 Windows에 한정한다. 새로운 코드나 배포 수락을 주장하지 않는다.

공식 계약 근거: https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback (HTTP200 refusal과 stop_details, cyber false positives, 공식 fallback과 model/usage/부분 출력 의미). 이 문서의 일반 설명을 공급자의 비공개 내부 결정 근거로 취급하지 않는다. 현재 비교와 코드 조사만으로 근거가 부족한 '프롬프트 크기 때문에 refusal', 'tool 이름이 원인', 'OAuth 식별 문자열 복원이 해결' 같은 가설은 채택하지 않는다.
