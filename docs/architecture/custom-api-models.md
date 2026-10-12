# 사용자 API 모델

Status: `partial` — 연결 관리·helper·picker·native subagent의 source 및 로컬 검증을 완료했다. 설치·실서버 수용은 수행하지 않았으며 결과는 지정 작업 계획에서 관리한다.

## 연결 관리와 모델 선택

Azrael의 최초 API 연결 목록은 비어 있다. 연결 주소·이름·모델·인증정보를 제품에 미리 등록하거나 사용자의 다른 프로젝트에서 가져오지 않는다. 사용자가 API 연결 관리에서 주소와 OpenAI 호환 Chat Completions 또는 Responses 규격을 지정한다. 인증 없음, 보호된 운영체제 비밀 저장소의 Bearer 키, 로컬 토큰 파일 참조를 지원한다. 키는 private stdin 또는 helper 내부에서만 다루며 설정 조회·모델 카탈로그·인자·대화 기록·로그에 반환하지 않는다.

연결의 변경되지 않는 ID와 정확한 원격 모델 ID로 `api/<connection-id>/<remote-model-id>`를 구성한다. 원격 ID의 슬래시를 보존한다. 모델 선택기에 기존 provider와 같은 계층의 `API` 그룹을 표시하고 연결 이름·모델 이름으로 서버를 구분한다. 관리 화면은 기존 계정/설정 레이아웃·행·버튼·테마를 재사용한다.

사용자는 모델을 수동 등록하거나 명시적 모델 조회로 발견한다. 모델 조회는 생성 요청을 하지 않는다. 등록 모델의 context·출력 한도·도구 지원·streaming·thinking·병렬 도구 설정은 사용자가 정하며 서버의 광고값과 실제 검증을 구분한다. 도구 지원 선언은 수행 품질 또는 서버의 전체 JSON Schema enforcement를 보증하지 않는다. 연결 변경·삭제·비활성화는 다른 provider의 선택과 인증을 바꾸지 않는다.

## 호출과 subagent

thinking 파라미터는 지원 서버에서 사용자가 전송을 명시적으로 켠 경우에만 포함한다. 기본 요청은 Chat의 `chat_template_kwargs`와 Responses의 `reasoning`을 생략한다. Qwen thinking 비활성 요청은 전송 옵션을 켜고 `enable_thinking`을 끈다. Responses SSE는 completed snapshot에서 텍스트와 완성된 도구 호출을 정규화하므로 화면의 텍스트도 완료 시점에 전달한다.

일반 턴과 subagent는 같은 카탈로그·모델 admission·provider resolver를 사용한다. 부모와 자식은 별도 native thread와 턴 binding을 갖는다. 역할에 고정된 모델이 있으면 기존 역할 우선순위를 유지한다. 연결 모델은 OpenAI 모델로 분류하거나 자동 대체하지 않는다. 모델별 도구 미지원은 native ToolPolicy 상한으로 적용하며 실제 dispatcher에서도 도구 사용을 허용하지 않는다.

## API 도구 컨텍스트

Status: `current` — Windows x64 소스 테스트와 실 API 전송을 검증했다. 설치본 반영 및 다른 OS의 수용은 별개다.

API 모델은 직접 function 호출과 native deferred 검색을 사용한다. Code Mode의 전체 중첩 도구 카탈로그를 freeform 실행 설명에 넣지 않는다. Window Use와 Node REPL namespace 및 해당 MCP 서버는 모델용 registry에서 제외한다. 이 제외는 도구 정의, 검색, dispatcher와 과거 검색 결과의 재노출에 함께 적용되며 일반 provider의 도구 정책을 바꾸지 않는다.

검색 source 요약은 4 KiB로 제한하고 API 검색은 최대 8개 결과와 64 KiB의 완전한 스키마를 반환한다. 현재 요청의 deferred 도구는 최신 검색·실제 호출 순서로 최대 8개를 선택하며, 직접 도구를 포함한 catalog의 직렬화 비용을 64 KiB 예산에 넣는다. 현재 registry가 허용하는 도구만 선택한다. 선택되지 않은 도구는 deferred 상태로 남아 필요하면 다시 검색한다. 필수 직접 도구는 크기 때문에 임의로 삭제하지 않는다. helper가 컴파일한 도구 catalog가 128 KiB를 넘으면 원격 POST 전에 `api_tool_context_limit`으로 실패한다. 이 바이트 예산은 서버 컨텍스트 토큰 한도와 독립적이다.

과거 검색 결과는 API 전송 시 전체 설명·스키마 대신 현재 catalog에 선언한 wire alias 목록으로 투영한다. 스키마는 현재 `tools`에서 전달하며 call/result ID와 원본 대화 저장 내용을 보존한다. 과거 기록의 제거된 도구를 실행 권한으로 취급하거나 알 수 없는 호출 이름을 임의로 복원하지 않는다.

## 요청 컨텍스트 투영

Status: `current` — Windows x64에서 공통 검색 helper·API adapter 및 네이티브 투영·토큰 추정·스킬 회귀 검사를 통과했다. 설치본 반영과 다른 OS 검증은 수행하지 않았다.

native managed/Devin 요청은 과거 검색의 도구 identity를 현재 registry의 호출 정책과 대조한다. 일반 provider는 현재 catalog에 없는 중첩 도구 설명을 최근 8개 identity와 64 KiB의 완전한 스키마 예산 안에서 유지한다. namespace 설명은 최신 정의에 한 번만 포함한다. 제외되거나 예산에서 밀린 스키마는 재검색 안내로 표현하며 Code Mode helper도 같은 기준을 따른다. 검색 이력 자체가 실행 권한을 부여하지 않는다.

API의 로컬 컨텍스트 추정은 완전한 과거 검색 스키마 대신 alias 목록과 안내문 비용을 적용한다. provider가 보고한 토큰 사용량과 미반영된 로컬 tail을 합산할 때와 전체 재계산 모두 같은 축약 정책을 적용한다. 이 추정은 바이트 기반 heuristic이며 실제 tokenizer 값과 구분한다.

교체 가능한 타입 지침은 요청에 최신 상태만 포함한다. 대상은 managed developer 지침, AGENTS.md 지침, app/plugin 사용 지침, 환경 사용 안내와 완전한 host 스킬 목록이다. app/plugin 비활성 상태도 명시적으로 반영한다. 환경 상태 delta, 일반 additive 지침, 사용자 메시지와 권한 지침은 기존 의미를 유지한다. 선택한 스킬 본문은 정규화한 경로별로 마지막에 제공한 본문 해시와 같은 경우 재사용한다. 본문이 바뀌거나 이전 버전으로 돌아오거나 컨텍스트가 초기화되면 다시 제공한다. 원본 기록은 투영으로 변경하지 않는다.

API host 스킬 목록은 도구 registry와 같은 제외 namespace 정책을 사용한다. 명시된 도구 의존성과 확인된 Window Use, Computer Use, Chrome 및 in-app Browser 스킬 이름을 기준으로 제외한다. API 요청은 과거의 타입 있는 스킬 목록·선택 본문에서도 이 알려진 이름을 제외한다. 다른 이름으로 등록한 스킬은 현재 의존성 메타데이터가 있어야 분류할 수 있으며, 과거에 렌더링한 본문에는 그 메타데이터가 포함되지 않는다. 일반 provider의 스킬 목록은 유지한다.

## API 전송과 실행

API helper는 기존 Chat/Responses adapter와 bounded native 프레임 프로토콜을 사용한다. 모든 도구 호출은 완성된 arguments와 terminal 결과 검증 이후에만 native engine으로 전달한다. 실행·권한·승인·도구 결과·대화 기록의 책임은 engine에 있다. 사용자 API 서버에 도구 실행이나 conversation 저장을 요구하지 않는다. 일반 function 호출로 변환 가능한 namespace/custom 도구는 기존 변환을 재사용하며 변환되지 않는 계약은 명시 실패한다.

비스트리밍 JSON 응답과 SSE 스트리밍을 구분한다. 비스트리밍 대기는 token/activity를 만들어내지 않고 고정된 제한시간으로 끝낸다. root와 자식의 요청에 연결별 동시 실행 상한을 적용하고 대기·실행 중 취소를 전달한다. 사용자 API는 자동 추론 재시도나 계정/provider fallback을 하지 않는다. 응답 유실 후 원격 생성이 종료됐는지는 확정하지 않는다.

## Continuity와 실패

도구 응답은 기존 native 검증을 유지한다. 선언된 이름·종류, 중복 call ID, JSON 객체 arguments를 확인하고 실행 시 각 handler의 typed arguments 파싱을 적용한다. 전체 JSON Schema의 properties·required·$ref·strict 제약을 강제하는 새 validator를 추가하지 않는다. 서버의 도구 지원 선언도 이러한 제약 준수를 보증하지 않는다.

한 요청의 연결·endpoint·인증 identity·모델·옵션은 실행 중 고정한다. 새 턴·resume·fork에서 기존 binding과 identity를 대조한다. 제거된 연결이나 변경된 endpoint/auth identity는 명시 실패하며 다른 연결을 대신 쓰지 않는다. 연결의 표시 이름 변경은 identity를 바꾸지 않는다. provider handoff는 연결 ID별로 구분하고 foreign opaque replay를 전달하지 않는다. 이력의 도구 call/result identity를 보존하고 도구를 재실행하지 않는다.

URL의 credential/query secret·부적절한 scheme은 거부하고 HTTPS 검증을 유지한다. 자체 서빙을 위해 사용자가 지정한 HTTP endpoint를 지원하되 인증정보 전송 의미를 설명한다. 인증 요청 redirect를 따르지 않는다. 모델 조회 결과에 포함된 외부 주소를 자동 탐색하지 않는다. HTTP 오류는 안전한 코드로 축약하며 raw 서버 본문을 UI·로그에 전달하지 않는다. 잘린 응답과 불완전한 도구 호출은 완료로 처리하지 않는다.

Qwen 호환 자료는 모델별 수용 시험의 참고이며 제품 preset이 아니다. nonstream·단일 도구·thinking 비활성으로 검증된 서빙은 해당 범위에서 연결한다. streaming 도구·다중 도구·추가 context 경로는 개별 검증을 요구한다. SSH/Tailscale 연결을 자동으로 시작하거나 다른 프로젝트의 터널을 종료하지 않는다.
