# Delegation and Integration (Parent Only)

Azrael의 작업 배정·실행 순서·대기·개입은 root 공통 지침을 따른다. 이 문서는 역할과 handoff의 구체적 계약을 소유하며, 위임 모드나 실행 권한을 확대하지 않는다. 자식의 재위임 권한을 부여하지 않는다.

- Always set `agent_type` explicitly on `spawn_agent`; never rely on the default role, which inherits the parent model and full history and has been observed crashing the inference helper. Use `luna_explorer` (GPT-6 Luna, xhigh) for read-only evidence retrieval within named boundaries and `sol_executor` (GPT-6.1 Sol, medium) for settled implementation and validation in Codex and Azrael. Select `devin_swe2_medium` only when explicitly requested by the user. Preserve role-owned model and reasoning defaults; use supported overrides only for a concrete need. Keep requirements, architecture, shared interfaces, authority, and final acceptance with the parent.
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
