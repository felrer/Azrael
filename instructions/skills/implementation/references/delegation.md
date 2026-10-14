# Delegation and Integration (Parent Only)

Azrael의 작업 배정·실행 순서·대기·개입은 root 공통 지침을 따른다. 이 문서는 역할과 handoff의 구체적 계약을 소유하며, 위임 모드나 실행 권한을 확대하지 않는다. 자식의 재위임 권한을 부여하지 않는다.

- Always set `agent_type` explicitly on `spawn_agent`; never rely on the default role, which inherits the parent model and full history and has been observed crashing the inference helper. Use `luna_explorer` (GPT-6 Luna, xhigh) for read-only evidence retrieval within named boundaries and `sol_executor` (GPT-6.1 Sol, medium) for settled implementation and validation in Codex and Azrael. Preserve role-owned model and reasoning defaults; use supported overrides only for a concrete need. Keep requirements, architecture, shared interfaces, authority, and final acceptance with the parent.
- Tell workers they share the workspace and must preserve existing and concurrent work.
- Include agreed platform applicability and exclusions, implementation ownership, regression impact and required verification in each relevant handoff. Keep requested targets separate from actually tested environments; return consequential unresolved scope changes to the parent.
- Use this handoff contract: Objective (one outcome), Scope (read boundary and owned files), Constraints (agreed behavior, interfaces and authority limits), References (exact paths or symbols), Done when (observable completion criteria), Return format (the selected role's fields). Pass decisions and references rather than full conversations or copied documents. State these requirements together in natural language when delegating. When useful for communicating requirements efficiently, optionally include short code snippets, evaluation algorithms, input/output examples, or references to existing tests.
- For a materially different independent objective that warrants delegation, create a fresh child with `fork_turns="none"`. If unsupported, use the smallest supported history scope and disclose the limitation. Reuse the same child for corrections and validation of its objective; send only the delta. Completion alone does not require another child. Do not split coupled unfinished work merely to refresh context.

## 조사 질문의 우선순위와 첫 인계

- 조사 요청에는 다음 구현을 막는 질문의 우선순위를 지정한다. 첫 조사 범위는 후속 실행에 필요한
  최소 계약을 확인하는 데 맞추고, 근거·확정된 조건·남은 불확실성을 인계한다.
- API 형식뿐 아니라 다음 구현에 필요한 동작 의미까지 확인한다. 미확정 계약에 의존하는 부분만 보류하고,
  확정된 계약으로 수행 가능한 작업과 구분한다. 미확정 동작을 임의의 기본값이나 빈 구현으로 채우지 않는다.
- 추가 조사는 필요한 경우 같은 담당자에게 후속 범위로 전달한다. 첫 범위를 완료 가능한 단위로 나눠
  일반 중간 보고만으로 대기 중인 root가 재개된다고 가정하지 않는다. 작은 질문마다 새 에이전트를 만들지 않는다.

## 후속 작업 연결과 결과 보고

- 비용이 큰 작업을 전달할 때는 후속 소비자, 필요한 산출물·설정·환경·경로, 준비 완료 조건과
  최종 완료 조건을 handoff에 포함한다. 기존 역할의 반환 필드 안에서 필요한 정보만 전달한다.
- 전체 작업 완료와 산출물 준비 완료를 구분한다. 준비 완료 보고에는 사용 중 변경되지 않는 산출물의
  경로·식별 정보, 충족한 후속 실행 조건, 남은 검사를 포함한다. 경로 생성이나 일부 파일 출력은 준비 완료가 아니다.
- 최종 결과 없이 준비할 수 있는 검증 환경은 기존 권한 안에서 병렬로 준비하고, 작은 실제 실행으로 확인한다.
  환경 준비 통과와 최종 제품 검증 통과를 구분하며, fixture 준비가 실제 사용자 계정·외부 서비스 변경 권한을 뜻하지 않는다.
- 일반 진행·준비 완료 메시지가 대기 중인 root를 깨운다고 가정하지 않는다. 현재 런타임이 단계별 완료 이벤트를
  지원하면 실제 완료된 단계에 별도 식별 정보를 사용하고, root는 다음 작업에 필요한 단계만 대기 대상으로 선택한다.
  all_terminal 조건에 관련 없는 대상을 넣지 않는다. 전체 작업을 조기 완료 처리하거나 반복 조회로 이벤트를 대체하지 않는다.
  source 구현만으로 현재 런타임·provider에서 사용할 수 있다고 판단하지 않으며, 재개 후 결과 상태를 확인한다.
- 긴 실행이나 여러 담당자가 연결되는 작업은 시작·종료 시각, 의존성·자원 대기 사유, 재실행 여부와 원인을
  기존 로그·작업 기록에 간결하게 보고한다. 성과는 전체 경과 시간으로 평가하고, 겹치는 실행 시간을 합산하지 않는다.
  예상 단축과 실제 측정된 단축을 구분한다. 작은 수정에는 상세 일정표나 별도 시간 관리 문서를 요구하지 않는다.

## 부모 결정 요청과 응답

- 부모가 자식에게 보내는 후속 지시·질문·수정 요청도 현재 확인된 관련 사항을 한 번에 묶어 전달한다. 실행 중인 자식에게 작은 요청을 수시로 보내지 않으며, 현재 작업을 막는 결정이나 확인된 오류의 전달은 지연하지 않는다.
- 현재 확인된 관련 질문·근거·추천안을 의미 있는 작업 경계에서 묶는다. 아직 생기지 않은 질문이나 관련 없는 작업을 기다리느라 현재 막힌 결정 요청을 늦추지 않는다.
- 실제 세션에 제공된 경우 부모 판단·조정은 `request_parent`로 요청하고 반환한 `request_id`를 유지한다. 접수·재개 예정은 답변 보장이 아니다. 영향받는 작업만 보류하고 독립 작업을 계속하며, 더 진행할 작업이 없으면 같은 요청의 `await_parent_response`를 사용한다. 이는 할당 완료나 새 요청이 아니다.
- 부모는 `respond_to_request`로 요청별 `resolved`·`cancelled`·`deferred` 상태, 결정과 이유를 기록한다. 보류에는 `retry_condition`을 명시한다. 일반 메시지가 구조화된 응답을 대신하지 않는다. 재대기 전에 pending 요청을 처리하여 자기 답변을 기다리는 자식의 완료만 기다리는 순환을 막는다.
- 무응답·독립 작업 완료·시간 경과·checkpoint는 승인이나 새 요청의 근거가 아니다. 불확실한 재시도는 동일 `request_key`를 사용하며, 대기 측정·checkpoint는 엔진이 자동 기록한다. 로그용 sleep·반복 조회·중복 wake를 추가하지 않는다. 사용자 stop/cancel을 보존한다.
- 새 도구가 제공되지 않으면 `send_message`로 결정을 요청하고 독립 작업을 진행한다. 더 진행할 수 없으면 `PARTIAL` final에 완료 범위·필요한 결정·다음 실행 조건을 명시한다. 일반 메시지의 즉시 부모 재개를 보장하지 않으며 미완료 할당을 DONE으로 표시하지 않는다.
