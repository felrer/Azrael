# Claude refusal 원인과 정상 응답 복구

상태: refusal 전달 개선과 재시도는 완료했고 정상 프로필의 요청 성공/거부 방지는 미해결이다. 후속 요청의 Claude 프로필 컨텍스트 감사도 완료했다. 고정 입력과 누적 경로는 확인했으나 refusal 인과관계는 미확정이다. 사용자 추가 입력은 필요 없다. 이번 후속 범위는 읽기 전용 코드·기존 기록 조사와 분석 문서이며 제품 수정·모델 재호출·설치는 하지 않는다.

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


## 실행 범위와 공유 계약

사용자가 개선 후 재시도와 남은 문제의 해결 방안을 요청했다. 이번 실행은 제안1의 최소 구현(거부 분류/진단 보존)과 같은 모델·계정의 도구 요청 재시도를 우선한다. 새 세션 조회 기능이나 자동 모델 fallback은 도입하지 않는다. root는 managed observer/translate, 공유 JS diagnostics, 소유 문서/feature inventory, source provenance와 최종 검증/실제 요청을 담당한다. native 통합 owner는 Rust 오류·transport 검증, Python export, 기존 공통 UI formatter/복구의 정확한 메시지 보존과 해당 검사만 담당한다.

공유 계약: 실제 upstream stop_reason=refusal을 provider_refusal로 전달하고 native Fatal/Other의 정확한 문구 `Fatal error: 모델 제공자가 응답을 거부했습니다. (provider_refusal)`로 전달하고 UI에서 고정 prefix를 제거해 표시한다. 최초 InvalidRequest/BadRequest 가정은 실제 native 검사에서 InvalidRequest가 Other로 변환되는 것을 확인하여 폐기했다. protocol 매핑을 한국어 문구로 변경하지 않으며 실제 terminal Fatal 계약과 정확한 Other/message pair를 사용한다. 자동 retry/계정 전환/도구 실행 허용은 바꾸지 않는다. 확인한 wire stop 사유는 provider_stop_reason(허용값 end_turn/tool_use/stop_sequence/max_tokens/pause_turn/refusal/content_filter/unknown), 실제 refusal의 category는 provider_refusal_category(허용값 cyber/bio/frontier_llm/reasoning_extraction/general_harms/unspecified/unknown/missing)로 기존 transport 경로에만 남긴다. 명시적 null은 unspecified, 누락은 missing, 미지원/상충 type은 unknown이며 freeform explanation/원문은 저장하지 않는다. terminal frame이 없으면 기존 provider_eof 실패를 보존한다. 알려지지 않은 오류는 기존 정의되지 않은 오류를 유지한다.

run03 소유: work:BU-01-refusal-cause-run-03, artifacts/tasks/refusal-cause/runs/03/{logs,reports,temporary}. producer별 로그와 JSON 결과를 분리하며 실패/차단도 보존한다. 준비 컴파일과 focused test만 수행하고 전체 distribution build/설치는 하지 않는다. primary engine/가 현재 소유 소스이며 SOURCE 공식 갱신은 root만 한다. Windows 실제 회귀와 동일 계정 live request가 검증 대상이고 다른 OS는 공통 구현 영향만 기록한다. 시작 때 Git 변경은 기존 upstream/뿐이다.


run03 helper 개선과 선행 검증: providerStopEvidence는 구조화된 Anthropic stop_reason과 type/category만 해석하며 자유 설명을 저장하지 않는다. managed observer는 선택 진단과 독립적으로 refusal을 기억하고 실제 message_stop 이후에만 provider_refusal로 종료한다. 버퍼에 완성된 도구 JSON이 있어도 거부/EOF/미완료이면 executable item과 completed를 내보내지 않는 실제 infer mock으로 검증했다. node scripts/check-error-classification.cjs는13 tests/387 assertions/exit0(provider-tests-01.log), 공통 diagnostics16 tests/exit0(shared-diagnostics.log), standalone 준비 컴파일+chat24 tests/exit0(host-build-chat.log)이다. delegated native integration의 Python21/Node329/source chat24도 각각 exit0이며 native-integration-{python,node,chat}.log에 보관했다.

run03 실제 재시도: 2026-10-16T16:08:01.289Z~2026-10-16T16:08:03.052Z UTC. 동일 원래 계정/model/high/current compatible profile/실제 Read,Bash2 schemas/사용자 지정 원문, automatic retry0, tool execution0이다. producer exit0과 별도로 inference는 HTTP429/provider_error_undefined로 실패했다. 새 transport 근거는 provider_error_type=rate_limit_error, provider_error_reason=ambiguous, error_body_state=parsed이며 retry_after와 명확한 subscription rejection 수치는 없었다. refusal SSE나 도구 호출을 받지 않았으므로 이번 실요청의 정상화 또는 refusal 재현 완료로 보고하지 않는다. 소스 hash는 요청 전후 불변이다. reports/probe-01.json과 logs/probe-01.log가 실제 결과를 소유한다.

차단 분석을 위해 inference 재호출 대신 기존 quota helper를 읽기 전용으로 사용했다. 원래 계정 존재와 Anthropic roster1개를 확인해 다른 계정 조회를 피했고 계정 선택/삭제/usage reset은 하지 않았다. 현재 조회는5-hour0%, weekly0%이며 reports/account-quota.json과 logs/account-quota.log에 수치/리셋 시각만 보존했다. 이 시점 조회상 두 사용량 창의 소진 근거는 없지만 그것만으로 속도·동시성·조직/별도 제한을 모두 배제할 수 없다. HTTP429를 '구독 사용량 소진'이라고 바꾸지 않는다. known source feature IDs와 기존 checks가 변경 파일/계약을 이미 소유하므로 runtime transport field를 packaging transform reportFields로 오인해 추가하지 않았다.

렌더 검증은 기존 verify-error-presentation-render.mjs를 재사용하며 AZRAEL_RENDER_RUN_ROOT로 run03을 지정한다. 새 프로필/fixture는 run03/temporary/error-render(사전 부재), 결과는 run03/reports/error-render이다. 현재 Windows free physical 약7.8GiB를 확인했고 기존 Cargo producer와 중복 컴파일 없이 렌더 검사를 시작한다. Cargo가 준비 컴파일 중이며 source recorder도 원본 manifest를 검증 중이다. 각각 별도 terminal exit을 확인한다.

사용량 조회가 성공하고0%를 반환하여 대조 검증1회를 추가한다. run03/probe02는 이전에 성공했던 arithmetic/no-tools/unprofiled 조건을 보존하며 계정/model/high와 변경 소스는 같다. 원래 도구 요청과 동일한 요청이라는 주장은 하지 않는다. 새로운 UUID binding owner를 미리 기록하고, 자동 retry는 없으며 실제 visible 답이4인지 boolean만 저장한다. 이것은 현재 차단 범위를 좁히는 대조군이고 429 유도 실험이나 새 모델/계정 전환이 아니다.

probe02 정상 결과에 따라 추가 비교probe03은 probe01과 동일한 task/tools/instructions/account/model/high에서 기존 unprofiled projection만 선택한다. identity/header 자체를 편집하지 않고 기존 경로를 비교한다. 제품 profile을 비활성화하는 변경이 아니다.

probe03에서 같은task/tools의 기존unprofiled projection이 HTTP200/tool_use/Bash1을 반환해 전역 계정 차단 가설이 약해졌다. 비교probe04는 현재compatible profile의 system/header/identity를 그대로 두고 사용자 정의 도구 이름만 기존 OAuth escaping(custom_Read/custom_Bash)으로 보내는 단일 변인 실험이다. 실행은 첫 tool request 관측까지이며 auth identity를 위장하거나 제품 profile을 비활성화하지 않는다. 명시적인 wire 차이는 보고서에 남긴다.

현재 검증: 첫 native 실행(16:08:44~16:14:56 UTC, exit101)은 InvalidRequest→Other 매핑 때문에 오류 기대값1개가 실패했고 protocol1/core3 검사는 통과했다. 실제 프로토콜을 바꾸지 않고 Fatal/Other 계약으로 수정했으며 -02 native 검사를 고정된 Rust 입력으로 재시작했다. source formatter/recovery330 및 source chat25는 수정 계약으로 exit0이다. SOURCE 공식 recorder도 두 번째 변경을 검증한다. 첫 실패/첫 렌더 결과는 중간 증거로 보존하며 최신 수락 근거와 구분한다.

probe04는 도구 이름만 custom_ 접두사로 변경해도 HTTP429/ambiguous로 실패했다. probe03의 같은 task/tools unprofiled 경로는 HTTP200/tool_use/Bash1까지 성공했다. 도구는 실행하지 않았으므로 전체 작업 수락 기준은 미충족이다. profile 경로의 system projection/공급자 호환 계약 차이가 남지만 어떤 필드가 원인인지 확정되지 않았다. 특정 first-party identity 문자열 추가로 인증·클라이언트 정체성을 위장하는 해결은 적용하지 않는다.

## 개선 결과와 남은 문제

실제 refusal의 식별 손실은 수정했다. 공급자가 HTTP200으로 refusal을 보냈을 때 adapter의 일반 incomplete 처리로 의미가 희석되던 경계를 observer에서 포착하고, managed helper→native terminal Fatal/Other→정확한 UI 문구→진단 export까지 연결했다. 알려지지 않은 이유를 refusal로 추측하지 않으며 freeform 설명을 수집하지 않는다. 이는 공급자의 거부 판단을 바꾸는 수정과 구분한다.

| 실제 재시도 | 고정/변경 조건 | 결과 | 해석 한계 |
| --- | --- | --- | --- |
| probe01 | 원래 계정·모델·high, 사용자 문구, 현재 호환 프로필, Read/Bash | HTTP429, parsed rate_limit_error, ambiguous | refusal 판단이나 tool_use에 도달하지 않음 |
| probe02 | 같은 계정·모델·high, 작은 산술 요청, 기존 unprofiled 경로 | HTTP200, end_turn, 실제 답4 | 일반 계정/모델 호출이 가능함. 실제 작업 정상화 근거는 아님 |
| probe03 | probe01과 같은 문구·도구·지침·계정·모델·high, 기존 unprofiled 경로만 선택 | HTTP200, tool_use, Bash1 | 첫 도구 호출까지 성공. 실행/결과 전달/작업 완료는 검증하지 않음 |
| probe04 | probe01에서 도구 이름만 custom_Read/custom_Bash로 전환 | HTTP429, parsed rate_limit_error, ambiguous | 도구 이름 접두사 하나를 바꾸는 해결은 효과를 확인하지 못함 |

5-hour/weekly 조회는 각각0%였으나 별도 속도/동시성/조직 제한까지 부정하는 근거는 아니다. profile 두 실패는 공급자의 구체적 제한 원인 필드가 없으므로 UI는 정의되지 않은 오류를 유지한다. 현재 비교는 시간에 따른 공급자 상태까지 통제한 실험이 아니므로 profile 차이의 연관성을 시사할 뿐 인과 필드를 확정하지 않는다. 과거 진단 요청의 cyber refusal과 이번 실제 작업의 HTTP429를 같은 원인이라고 결론 내리지 않는다.

다음 해결 우선순위는 공급자가 지원하는 인증·클라이언트 계약 안에서 요청 projection을 정합화하는 것이다. 현재 inference.ts의 compiled.claudeProfile 분기는 adapter가 만든 system을 native systemPrompt로 교체하고 builtin 도구 escaping을 되돌린다. 기존 unprofiled adapter는 identity/system envelope와 도구 catalog를 포함한다. 비교로 남은 차이는 system/envelope/catalog이며, 잘못 중복되거나 상충한 내용이 있는지 읽기 전용 wire 구조 비교로 좁힌 후 확인된 변환 오류만 수정한다. 인증상 허용되지 않은 SDK/first-party identity를 흉내 내거나 profile 전체를 비활성화하는 변경은 적용하지 않았다. 이 인증 경로에서 지원되는 정합한 형식을 확인할 수 없으면 공식 지원 SDK/CLI 통합 또는 API-key 경로가 대안이며, 인증/실행 구조·비용 변화는 별도 설계 선택으로 다룬다.

세션 링크 작업은 기존 thread/read, thread/turns/list, thread/items/list를 재사용하는 범위 제한 읽기 도구가 후속 개선안이다. 링크의 대상과 권한을 검증하고 필요한 목표/진행 상태만 반환하면 모델이 raw rollout/전체 private 상태를 탐색할 필요가 줄어든다. 이것은 작업 전달 개선이며 refusal 해소가 입증된 조치는 아니다. 전체 수락은 지정 프로필에서 같은 요청의 tool_use→실제 유효 도구 실행→결과 전달→end_turn까지 확인해야 한다.

Windows focused native 검사는 16:20:50~16:23:03 UTC(약2분13초)에 protocol1/core errors4/core transport6/helper failure1 모두 exit0이다. 준비 컴파일은 기존 warm cache4 jobs를 재사용했다. 실제 host 준비 컴파일+chat25, source formatter/recovery330, recovery transform32, Python export21, provider13/387 assertions, 공통 diagnostics16, namespace cache7 및 renderer47 검사는 모두 exit0이다. renderer-02의 light/dark 이미지를 직접 확인했다. 첫 native 실행 실패 후 계약 수정으로1회 재실행했고, 이전 provider 검사는 입력 불변이므로 재실행하지 않았다. 전체 앱 빌드/배포/설치와 Linux/macOS 실행은 수행하지 않았다.

SOURCE recorder 두 번째 시도는 reviewed delta에서 transport test 변경을 빠뜨려 거절됐고 세 번째는 실제 native 테스트가 생성한 기존 pending-snap 한 줄 때문에 거절됐다. native producer exit0을 확인하고 해당 생성 부수효과만 원래 HEAD로 복구한 뒤 실제 두 변경 경로를 지정해 공식 recorder를 재실행했다. 원래 baseline/source 소유권 검사를 우회하거나 수동 receipt를 만들지 않았다. 네 binding은 각 producer 종료와 thread identity/path/lock 부재를 확인해 일반 삭제했고 원래 세션 binding은 보존했다. renderer fixture/profile과 빈 temporary 디렉터리도 제거했다. cleanup.json이 실제 부재를 기록한다.

공식 recorder-04 및 최종 source snapshot은 각각 exit0이다. SOURCE receipt SHA256=73ee93b71556294b6152a52ed05fa2657ea10b7a6c930a4c19c91b999a842bd3, sourceSha256=f72486ef238d32d93d1bbbf49235e5a7f7c5da1831c05c96279cf4590d927fa0,9264files이다. 통합 기준 HEAD=00094086이며 이번 작업과 독립적인 Window Use 문서 commit을 보존했다. run03 logs479698bytes/reports305714bytes의 완전한 lifecycle group을 등록·review했고 현재 work 참조 및 미해결 원인 분석 때문에 두 멤버 모두 defer를 적용했다. 동일 소스 release에 독립 검증을 승격하고 profile 원인을 대체 근거로 종결한 뒤 참조를 해제할 때 재검토한다. 임시 상태 삭제와 로그/보고서 보존을 구분한다.

이번 작업의 완료 범위는 오류 식별/진단 전달 개선, 같은 계정·모델 재시도 및 남은 문제의 해결안 제시이다. 정상 호환 프로필의 실제 작업 완료와 공급자 refusal 방지는 미검증/미해결이며 이를 완료로 표시하지 않는다. 변경은 소스에만 반영했고 설치본은 갱신하지 않았다.

## Claude 프로필의 컨텍스트 감사

목표는 Claude용 도구 프로필이 과도하거나 중복된 컨텍스트를 제공하는지 확인하는 것이다. root는 managed projection과 원래 rollout의 수량을 맡고, read-only native 조사 owner는 prompt/registry/history/discovery 경로를 맡는다. 공통 로직은 Windows/Linux/macOS에 해당하고 실제 저장 기록·오프라인 수치는 Windows만 확인했다. 현재 소스와 원래 실행의 설치 일치를 추정하지 않으며 기존 live 비교 결과를 재사용한다. 컨텍스트 초과·요청 비용/부담·공급자의 refusal 원인을 각각 구분한다.

원래 실패 요청은 기존 wire diagnostics 기준 35385 추정 tokens/125192 bytes이고, instructions22160(62.6%),tool_definitions8624(24.4%),conversation4601(13.0%)이다. 도구 결과·호출·추론 및 이미지는0이다. 실제 provider usage가 아니라 heuristic이며 모델 창1M/당시 자동 압축600k 대비 초과 증거는 없다. 작업 시작 전부터 약87%가 지침·도구 정의라는 구성은 확인된다.

원래19개 rollout record의 텍스트를 출력하지 않고 block별 길이·종류·정확한 중복을 조사했다. 기록된 기본 지침18430chars, 스킬 catalog36274chars/85entries, root coordination8817chars, maintenance guidance6175chars, 프로젝트 AGENTS15380chars이다. 120chars 이상 paragraph의 정확한 반복은 없었다. 이는 의미상 반복이나 무관한 안내가 없다는 증명은 아니다. 원래 기본 지침과 실제 송신 시 합성된 기본 지침은 별도이며 wire component22160이 전체 지침량의 기존 근거다.

기존 pinned Bun과 현재 estimateTokens를 쓰는 네트워크 없는 read-only 계산(exit0)에서 기본 지침은5266tokens, 스킬 catalog10364, root coordination2520, maintenance1765로 추정했다. 이 block별 현재 추정은 원래 전체 wire 값과 별도이며 실사용량으로 합산하지 않는다. 스킬 전체 본문85개를 읽은 것이 아니라 목록/설명/경로가 자동 주입됐다. 원래 state.host_skills.body는36231chars로 렌더 전후 길이도 부합한다. 스킬 항목 중 Vercel33개11912chars, Figma16개7630chars로 두 그룹의 목록만19542chars이다. 세션 조회 요청 전에 전체 설치 스킬의 긴 설명을 먼저 제공하는 공통 정책이 주요 고정 부담이다.

현재 코드의 중요한 구성은 다음과 같다.

- config/harness_profiles.rs는 Anthropic 기본 prompt를 builtin/anthropic-default로 선택한다. model_instructions.rs:56의 builtin/claude-lean에서만 lean template을 쓴다. 일반 Anthropic preset은 COMMON_AGENT_INSTRUCTIONS를 도구 이름만 적응해 사용하므로 claude-code-core 선택이 짧은 지침을 뜻하지 않는다. runtime core와 tool environment는 별도로 합성된다. 현재 세 template은1060/1935/1084chars(각303/553/310 추정tokens)이다. 같은 공통/runtime 조건에서 lean 선택은 행동 template 분량을 약4.7k tokens 줄일 가능성이 있지만 catalog/프로젝트 지침/도구 정의는 남는다.
- ext/skills/src/render.rs:126의 기본 metadata budget은 model window의2%이다. 창1M이면20k tokens이며,10k 상한은 명시적으로 skills.max_context_tokens를 설정한 경우에만 적용된다. world_state_catalogs.rs:131에서 모델 창과 설정을 받아 공통 catalog budget을 구성한다. 현재 로컬 config에는 harness override와 skills.max_context_tokens가 없다. 현재 설정 부재를 과거 설정의 증명으로 쓰지는 않는다. render.rs:332 이하에는 설명 축약과 끝내 목록 누락까지 가능한 예산 allocator가 이미 있어 재사용 가능하다.
- inference-mapping.mjs:133/163은 Claude 프로필의 XML wrapper를 생략한다. inference.ts:491은 vendor가 조합한 identity/catalog 안내를 native systemPrompt로 교체한다. 따라서 현재 이 경로는 추가 XML이나 vendor 도구 catalog 안내를 중복으로 늘리지 않는다. projectRequest는 system/developer를 systemPrompt 배열로 이동하고 user/tool 결과와 구분한다.
- tool_search_output은 전체 schema를 매번 복제하지 않고 현 catalog의 이름 참조로 줄이며 additional_tools history는 다시 직렬화하지 않는다. 실제 schema는 현재 tools 배열에서 유지한다. 검색 반복으로 schema 원문이 매 결과마다 중복된다는 주장은 기존 검사와 코드에 맞지 않는다.

실제 비교에서도 현재 호환 프로필 probe01은 system2263chars/도구2개로 HTTP429였고 기존 unprofiled probe03은 더 큰 system3428chars/도구2개로 HTTP200/tool_use였다. 과거 harmless refusal은 도구0개/input156tokens이었다. 따라서 큰 컨텍스트는 개선할 부담이지만 실패·refusal의 필요조건이나 확정 원인으로 결론 내릴 수 없다. 어느 system 내용/형식이 결과 차이와 관련되는지는 여전히 미확정이다.

개선 우선순위 제안은 (1) 고정 지침/스킬 설명/도구 schema를 각각 계측하고 (2) 필수 지침과 스킬 접근성을 보존하면서 스킬 catalog의 독립 예산·짧은 설명을 적용하고 (3) 합의된 작업에는 기존 claude-lean을 선택해 전체 공통 지침을 줄이고 (4) 탐색 도구와 대형 결과의 세션 누적을 관리하는 것이다. 단순히 프로젝트 AGENTS/권한 안내를 삭제하거나 원인 확인 없이 profile을 제거하지 않는다. 낮은 스킬 예산은 목록 누락을 일으킬 수 있으므로 필수5개/명시 호출/재탐색 가능성을 검증해야 한다. 구현 결정과 검증은 별도이며 이번 분석에서 설정을 바꾸지 않았다.

네이티브 조사 결과(읽기 전용 source audit):

- source turn/step 경로에서는 Claude가 incremental tools를 쓰지 않아 composed base를 각 sampling request에 보낸다. 이는 과거 이력에 같은 지침을 매번 append하는 것과 다르다. world-state의 변하지 않은 section은 새 fragment를 만들지 않는다. 변경된 section은 update/replacement 안내를 append하므로 이전 지침 메시지는 compaction 전까지 history에 남을 수 있다. helper가 retained developer 내용을 systemPrompt로 옮기므로 장기 세션에서는 이전 안내도 함께 전송될 여지가 있다. 원래19-record 실패에는 장기 누적 증거가 없다. 근거: core/src/session/step_context.rs:54, session/turn.rs:1676,1774, session/world_state.rs:220, context_manager/history.rs:456, context_manager/updates.rs:30.
- model switch 때 새 profile behavior가 base와 'previously using a different model' 안내에 함께 나타날 수 있는 조건부 중복 경로가 있다. 매 턴 발생하지 않으며 원래 실패 요청에서 발생했다고 확인된 것은 아니다. 근거: core/src/context/world_state/model.rs:46, core/src/session/mod.rs:1577,3561.
- 직접 도구 schema는 profile 적용 후 registry 전체를 포함하고 구체적 수/바이트는 runtime settings에 달려 있다. 원래28개 전체가 Claude preset의 고정 개수라는 뜻은 아니다. compatible builtin12개 이외에 공통 lifecycle/collaboration 등 현재 노출된 registry가 합쳐진다. Claude Agent schema가 전체 모델 roster를 enum으로 포함하는 것은 아니며 별도 conditional model catalog에는1000 rendered bytes cap이 있다. 근거: tools/spec_plan.rs:678,2002, handlers/claude_controls.rs:402, context/world_state/model_catalog.rs:18.
- retained conversation의 call/search에서 발견된 아직 유효한 도구 schema는 identity를 합쳐 유지한다. API 경로의8tools/64KiB active cap을 Claude에 적용하지 않는 것은 현재 명시된 설계다. 원문 schema의 검색 결과별 복제와는 다르지만 distinct tool 수가 늘면 요청당 도구 정의 비용이 증가한다. 전체 request budget/auto compaction은 남아 있어 무한 무제한이라는 표현은 부정확하다. 근거: tools/router.rs:203, docs/architecture/model-harness-profiles.md MCP discovery.
- Read는 기본2000lines/32KiB 출력 제한이다. Bash와 TaskOutput은10000token 요청 상한과 모델 truncation policy를 쓴다. 대형 파일의 여러 range를 읽고 전체 읽기 coverage를 확보하는 동안 결과가 누적될 수 있다. 실제 managed budget 경로는 최종 helper projection을 계측해 auto-compaction 판단에 사용한다. 따라서 'tool schema가 예산에 빠져 있다'는 결론은 맞지 않는다. 근거: handlers/claude_files.rs:36,418; claude_shell.rs:184,254; session/request_budget.rs:42; session/turn.rs:1812. 원래 실패는 tool output0이므로 이 경로가 해당 실패 입력을 키운 것은 아니다.

감사 결론: 짧은 첫 작업에서도 공통 행동·스킬·운영 지침과 직접 도구 정의가 큰 고정 입력을 만든다. 기본 Claude tool preset 자체가 lean prompt를 선택해 주지 않고, 큰 모델 창에 비례한 스킬 예산은 이 고정 비용을 줄여 주지 않는다. 원래 실패에서 정확한 긴 paragraph 복제는 발견하지 못했다. 도구 탐색과 지침 변경의 장기 누적은 추가 개선 대상이지만 이 첫 실패의 입증된 원인은 아니다. XML/catalog 중복 추가, 전 모델 roster enum, tool output 폭증, 창 초과는 이번 증거로 주원인이라고 할 수 없다.

권장 순서: 고정 context component 계측을 기준으로 우선순위를 정하고, 스킬 이름·짧은 routing 설명·온디맨드 원문을 보존하는 독립 절대 예산과 필수 스킬 보존을 검증한다. 다음으로 Claude prompt를 기존 lean 구성에 맞추되 사용자/프로젝트 지침·권한·도구 계약은 유지한다. 공통 coordination/maintenance의 세부 절차는 상시 핵심 계약과 분리하는 설계를 검토한다. 장기 세션에서는 superseded 안내의 의미를 보존하는 최신 상태 투영과 재탐색 가능한 bounded discovered set을 설계한다. 단순 cap 적용은 현재 discovery 계약의 변경이므로 누락·재탐색·실행 권한·replay를 검증해야 한다. 최소 첫 요청이 이미 실패한 기존 비교를 고려하면, 이 최적화와 별개로 provider request system 형식의 호환 문제도 계속 남는다.

이번 감사는 제품/설정 변경0, live inference0, build0이다. 기존 source와 기록을 읽고 pinned Bun의 estimator를 네트워크 없이 실행(exit0)했으며 generated artifact는 만들지 않았다. native owner의 read-only 결과를 재사용했고 분석만 같은 work 문서에 통합했다. 코드 변경이 없어 회귀 검사를 다시 실행하지 않았다. Windows 외 환경과 실제 설치본의 일치는 이번 결과로 주장하지 않는다.
