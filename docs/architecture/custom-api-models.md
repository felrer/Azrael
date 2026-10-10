# 사용자 API 모델

Status: `partial` — 연결 관리·helper·picker·native subagent의 source 및 로컬 검증을 완료했다. 설치·실서버 수용은 수행하지 않았으며 결과는 지정 작업 계획에서 관리한다.

## 연결 관리와 모델 선택

Azrael의 최초 API 연결 목록은 비어 있다. 연결 주소·이름·모델·인증정보를 제품에 미리 등록하거나 사용자의 다른 프로젝트에서 가져오지 않는다. 사용자가 API 연결 관리에서 주소와 OpenAI 호환 Chat Completions 또는 Responses 규격을 지정한다. 인증 없음, 보호된 운영체제 비밀 저장소의 Bearer 키, 로컬 토큰 파일 참조를 지원한다. 키는 private stdin 또는 helper 내부에서만 다루며 설정 조회·모델 카탈로그·인자·대화 기록·로그에 반환하지 않는다.

연결의 변경되지 않는 ID와 정확한 원격 모델 ID로 `api/<connection-id>/<remote-model-id>`를 구성한다. 원격 ID의 슬래시를 보존한다. 모델 선택기에 기존 provider와 같은 계층의 `API` 그룹을 표시하고 연결 이름·모델 이름으로 서버를 구분한다. 관리 화면은 기존 계정/설정 레이아웃·행·버튼·테마를 재사용한다.

사용자는 모델을 수동 등록하거나 명시적 모델 조회로 발견한다. 모델 조회는 생성 요청을 하지 않는다. 등록 모델의 context·출력 한도·도구 지원·streaming·thinking·병렬 도구 설정은 사용자가 정하며 서버의 광고값과 실제 검증을 구분한다. 도구 지원 선언은 수행 품질 또는 서버의 전체 JSON Schema enforcement를 보증하지 않는다. 연결 변경·삭제·비활성화는 다른 provider의 선택과 인증을 바꾸지 않는다.

## 호출과 subagent

thinking 파라미터는 지원 서버에서 사용자가 전송을 명시적으로 켠 경우에만 포함한다. 기본 요청은 Chat의 `chat_template_kwargs`와 Responses의 `reasoning`을 생략한다. Qwen thinking 비활성 요청은 전송 옵션을 켜고 `enable_thinking`을 끈다. Responses SSE는 completed snapshot에서 텍스트와 완성된 도구 호출을 정규화하므로 화면의 텍스트도 완료 시점에 전달한다.

일반 턴과 subagent는 같은 카탈로그·모델 admission·provider resolver를 사용한다. 부모와 자식은 별도 native thread와 턴 binding을 갖는다. 역할에 고정된 모델이 있으면 기존 역할 우선순위를 유지한다. 연결 모델은 OpenAI 모델로 분류하거나 자동 대체하지 않는다. 모델별 도구 미지원은 native ToolPolicy 상한으로 적용하며 실제 dispatcher에서도 도구 사용을 허용하지 않는다.

API helper는 기존 Chat/Responses adapter와 bounded native 프레임 프로토콜을 사용한다. 모든 도구 호출은 완성된 arguments와 terminal 결과 검증 이후에만 native engine으로 전달한다. 실행·권한·승인·도구 결과·대화 기록의 책임은 engine에 있다. 사용자 API 서버에 도구 실행이나 conversation 저장을 요구하지 않는다. 일반 function 호출로 변환 가능한 namespace/custom 도구는 기존 변환을 재사용하며 변환되지 않는 계약은 명시 실패한다.

비스트리밍 JSON 응답과 SSE 스트리밍을 구분한다. 비스트리밍 대기는 token/activity를 만들어내지 않고 고정된 제한시간으로 끝낸다. root와 자식의 요청에 연결별 동시 실행 상한을 적용하고 대기·실행 중 취소를 전달한다. 사용자 API는 자동 추론 재시도나 계정/provider fallback을 하지 않는다. 응답 유실 후 원격 생성이 종료됐는지는 확정하지 않는다.

## Continuity와 실패

도구 응답은 기존 native 검증을 유지한다. 선언된 이름·종류, 중복 call ID, JSON 객체 arguments를 확인하고 실행 시 각 handler의 typed arguments 파싱을 적용한다. 전체 JSON Schema의 properties·required·$ref·strict 제약을 강제하는 새 validator를 추가하지 않는다. 서버의 도구 지원 선언도 이러한 제약 준수를 보증하지 않는다.

한 요청의 연결·endpoint·인증 identity·모델·옵션은 실행 중 고정한다. 새 턴·resume·fork에서 기존 binding과 identity를 대조한다. 제거된 연결이나 변경된 endpoint/auth identity는 명시 실패하며 다른 연결을 대신 쓰지 않는다. 연결의 표시 이름 변경은 identity를 바꾸지 않는다. provider handoff는 연결 ID별로 구분하고 foreign opaque replay를 전달하지 않는다. 이력의 도구 call/result identity를 보존하고 도구를 재실행하지 않는다.

URL의 credential/query secret·부적절한 scheme은 거부하고 HTTPS 검증을 유지한다. 자체 서빙을 위해 사용자가 지정한 HTTP endpoint를 지원하되 인증정보 전송 의미를 설명한다. 인증 요청 redirect를 따르지 않는다. 모델 조회 결과에 포함된 외부 주소를 자동 탐색하지 않는다. HTTP 오류는 안전한 코드로 축약하며 raw 서버 본문을 UI·로그에 전달하지 않는다. 잘린 응답과 불완전한 도구 호출은 완료로 처리하지 않는다.

Qwen 호환 자료는 모델별 수용 시험의 참고이며 제품 preset이 아니다. nonstream·단일 도구·thinking 비활성으로 검증된 서빙은 해당 범위에서 연결한다. streaming 도구·다중 도구·추가 context 경로는 개별 검증을 요구한다. SSH/Tailscale 연결을 자동으로 시작하거나 다른 프로젝트의 터널을 종료하지 않는다.
