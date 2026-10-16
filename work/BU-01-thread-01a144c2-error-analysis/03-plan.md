# Claude refusal 원인과 정상 응답 복구

상태: 진단 요청의 refusal/cyber는 재현·분리했다. 사용자가 지정한 세션 이어가기 문구+도구 catalog로 실제 호출했으나 HTTP429로 refusal 검증이 막혔다. 제품 수정 완료로 보고하지 않는다. 02-plan의 오류 분류 변경은 b7a03ee1로 완료했고 이번 후속 목표는 정상적인 요청이 refusal로 끝나는 원인을 좁혀 수정하는 것이다.

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

사용자에게 실제 작업에서 refusal이 기록된 세션 링크를 요청했다. 최초 주신 세션의 실패는 HTTP429이며 refusal이 저장된 사건은 root의 진단 probe이므로, 실제 작업을 고치려면 해당 실패 요청을 구분해야 한다. 답변 전까지 결과를 제품 수정 완료로 보고하지 않는다.

## 정리와 보관

실행 종료 report, UUID/path/thread_id, lock 부재를 대조해 이 run의 임시 binding4개를 일반 삭제했고 모두 부재를 확인했다. 원래 binding/계정은 유지했다. temporary의 probe script4개는 검토 가능한 진단 근거로 reports/probe-scripts로 옮겼다. 고정 report 경로를 쓰는 원본 증거이므로 재실행하지 않는다. temporary plan-body와 빈 temporary directory는 일반 삭제했다. reports/cleanup.json이 실제 결과를 기록한다. logs/reports는 이 분석 소비가 끝나거나 후속 실제 refusal 사례로 대체될 때 재검토한다. 코드 변경이 없어 제품 회귀 검사/빌드/설치를 새로 수행하지 않았다.


## 도구 사용 조건의 추가 재현

사용자는 `"azrael://threads/01a12f03-0fcf-7550-adac-0df5148b0cf2" 이 세션의 작업 목표를 파악하고 작업을 이어서 진행해주세요`를 보내 모델의 도구 사용을 유도하도록 요청했다. 별도 제품 개발 요청으로 전환하지 않고 refusal 원인 조사 안에서 이 문구를 그대로 사용한다. run02는 같은 계정/model/high, 현재 compatible profile, 실제 Read/Bash tool schema를 전달한다. 첫 응답의 도구 호출과 stop_details를 관측하며 명령을 자동 실행하지 않는다. 필요한 경우 실제 읽기만 검증된 범위에서 수행한다. 첫 요청에는 자동 retry/모델 변경 없이 60초 deadline을 적용한다. 429면 refusal 검증 불가로 기록하고 제한을 재현하려는 반복 호출은 하지 않는다.

산출물 소유는 work:BU-01-refusal-cause-run-02, 경로는 artifacts/tasks/refusal-cause/runs/02/{logs,reports,temporary}이다. 임시 새 UUID fork binding은 사전 owner record를 만들고 종료 후 검증하여 일반 삭제한다. 이 run의 JSON 보고서와 진단 script는 후속 원인 분석에 필요하므로 logs/reports에 보관한다. 진행 전 발견한 docs/architecture/window-use.md 변경과 기존 upstream/은 다른 작업의 것으로 보존한다.


run02 결과: 2026-10-16T15:46:59.938Z~2026-10-16T15:47:00.974Z UTC, producer exit0, 실제 inference failed/provider_error_undefined, HTTP429, networkRequests1, toolCalls0/output0, SSE event0. 원래 binding 계정 일치와 source hashes 불변을 확인했다. tool catalog는 현재 compatible Read/Bash 2개이며 tool_choice를 강제하지 않았다. 원래 28개 catalog나 전체 세션 입력을 동일하게 재현한 것은 아니다. 모델의 실제 첫 도구 호출 이전 HTTP 단계에서 실패했으므로 이번 시도로 refusal 발생/해결 여부를 판단할 수 없다. 반복 호출로 429를 재현하는 실험은 하지 않았다.

run02 진단 근거: artifacts/tasks/refusal-cause/runs/02/reports/probe-01.json, reports/probe-01.ts(실행 입력 근거, 고정 경로이므로 재실행 금지), logs/probe-01.log. 다음 검증은 공급자가 이 계정의 요청을 수락할 때 동일한 사용자 문구와 도구 조건으로 실제 tool_use/거부 category를 확인하는 것이다. 현재 HTTP 응답 단계의 차단을 제품 프롬프트 결함으로 추정하여 수정하지 않는다. 코드 변경이 없으므로 제품 회귀 검사/빌드를 실행하지 않았다.

run02 정리: 종료 후 owner/thread/path/lock 검증을 거쳐 새 임시 binding과 빈 temporary directory를 일반 삭제했다. reports/cleanup.json에서 두 경로 부재와 원래 binding 보존을 확인했다. 로그·보고서·실행 입력 script는 work:BU-01-refusal-cause-run-02로 등록하고 후속 수락된 요청이 이 차단 근거를 대체할 때 재검토하도록 defer했다.
