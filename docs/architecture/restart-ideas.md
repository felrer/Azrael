# 재시작 설계 아이디어

- 문서 상태: `reference-candidates`
- 대상 방향: Codex 엔진을 사용하는 맞춤형 VS Code extension
- 효력: 아래 항목은 이전 설계에서 다시 검토할 가치가 있는 후보이며, 승인된 상세 설계나 구현으로 확인된 동작이 아니다.

이 문서는 과거 아키텍처를 새 제품에 그대로 이식하지 않는다. 각 아이디어는 Codex 엔진과 VS Code extension API가 실제로 제공하는 계약을 확인한 뒤 채택 여부와 소유 계층을 별도 설계에서 결정한다.

## 후보 아이디어

### 1. Workspace와 session의 불변 binding

**근거.** 실행 도중 workspace가 암묵적으로 바뀌면 파일 접근 범위, 상대 경로, 권한 판단과 복구 대상이 서로 어긋날 수 있다. session 생성 시 확정한 workspace identity를 유지하면 재개와 진단의 기준이 분명해진다.

**Codex 계약 확인 필요.** Codex session이 workspace 또는 `cwd`를 어떤 identity로 저장·복원하는지, multi-root와 remote workspace를 어떻게 표현하는지, 기존 session의 작업 경계를 변경할 수 있는지 확인한다.

참고: [azrael-ex 2단계 설계](../archive/2026-09-12-pi-harness/docs/architecture/azrael-ex/azrael-ex-two-phase-system-design.md), [Workspace 관리 설계](../archive/2026-09-12-pi-harness/docs/architecture/pi-harness/workspace-management-design.md)

### 2. 엔진 transcript와 재구축 가능한 metadata의 분리

**근거.** 대화 원본과 목록·검색·표시용 metadata를 구분하면 UI cache나 index가 손상되어도 엔진 원본을 기준으로 화면을 다시 만들 수 있다. metadata는 원본을 대체하거나 독자적으로 대화 의미를 확정하지 않아야 한다.

**Codex 계약 확인 필요.** transcript의 정식 조회·재개 API, 안정적인 session·message 식별자, pagination과 event 순서, extension이 안전하게 재구축할 수 있는 공개 metadata 범위를 확인한다.

참고: [초기 시스템 설계](../archive/2026-09-12-pi-harness/docs/architecture/pi-harness/initial-system-design.md), [다중 session 런타임 설계](../archive/2026-09-12-pi-harness/docs/architecture/azrael-ex/multi-session-background-runtime-design.md)

### 3. Panel 수명과 run 수명의 분리

**근거.** Webview panel을 닫거나 다시 만드는 UI 동작이 진행 중인 agent run을 뜻하지 않게 중단해서는 안 된다. 다시 연 panel은 현재 snapshot과 이후 event를 받아 같은 run을 이어서 보여주는 편이 복구와 다중 작업에 유리하다.

**Codex 계약 확인 필요.** run이 extension host 또는 panel 수명과 독립적으로 유지되는지, detach·reattach·cancel API와 event cursor 또는 snapshot 복원 수단이 있는지, VS Code 재시작 시 보장 범위를 확인한다.

참고: [다중 session 런타임 설계](../archive/2026-09-12-pi-harness/docs/architecture/azrael-ex/multi-session-background-runtime-design.md)

### 4. 전달 여부가 불명확한 command의 자동 재전송 금지

**근거.** 전송 직후 연결이 끊기면 command가 실행되었는지 알 수 없으며, 자동 재전송은 prompt나 부작용을 중복 실행할 수 있다. 이런 항목은 명시적인 `uncertain` 상태로 남겨 사용자가 transcript와 실행 상태를 확인한 뒤 결정하게 한다.

**Codex 계약 확인 필요.** command idempotency key, acknowledgement 시점, run 조회와 중복 판정 API, reconnect 뒤 확정 가능한 terminal state를 확인한다. 엔진이 정확히 한 번 처리를 보장하지 않는 구간을 식별해야 한다.

참고: [Draft와 command queue 설계](../archive/2026-09-12-pi-harness/docs/architecture/azrael-ex/session-draft-and-command-queue-design.md), [초기 시스템 설계](../archive/2026-09-12-pi-harness/docs/architecture/pi-harness/initial-system-design.md)

### 5. 읽기 권한과 쓰기 권한의 분리

**근거.** 같은 session을 여러 화면이나 window에서 열 때 열람 자체가 submit, stop, approval 같은 변경 권한을 암묵적으로 획득하면 경쟁과 오조작이 생긴다. 현재 작성 주체와 읽기 전용 상태를 UI와 명령 검증에서 명확히 구분할 필요가 있다.

**Codex 계약 확인 필요.** 동시 attach와 mutation의 지원 범위, session별 동시 command 규칙, 권한 전환 또는 fencing에 사용할 revision·lease·capability가 있는지 확인한다. 엔진에 해당 개념이 없다면 extension이 보장할 수 있는 최소 경계를 별도로 정한다.

참고: [Session writer 소유권 설계](../archive/2026-09-12-pi-harness/docs/architecture/azrael-ex/session-writer-ownership-design.md)

### 6. Webview에는 정제된 인증 상태만 전달

**근거.** Webview가 로그인 필요, 진행 중, 사용 가능, 만료, 오류 같은 화면을 표시하는 데 credential 원문은 필요하지 않다. secret과 provider payload를 신뢰 경계 안에 두고 공개 상태와 사용자 action만 전달하면 노출 면적을 줄일 수 있다.

**Codex 계약 확인 필요.** Codex가 제공하는 로그인·로그아웃·refresh 흐름, credential 저장 책임, extension에 공개되는 인증 상태와 오류 형식, 재시작 후 상태 복원 방식을 확인한다. Webview 메시지와 로그에서 제거해야 할 민감 필드도 식별한다.

참고: [ChatGPT OAuth·reference UX 설계](../archive/2026-09-12-pi-harness/docs/architecture/azrael-ex/azrael-ex-chatgpt-oauth-pi-reference-design.md)

### 7. Compaction과 fork에서 원본 보존

**근거.** compaction은 현재 context를 줄이더라도 이전 대화의 검토 가능성을 없애지 않아야 하며, fork는 원본 session을 변경하지 않고 선택 지점에서 새 작업 흐름을 만들어야 한다. 요약, 현재 context, 전체 원본 이력의 차이도 UI에서 구분해야 한다.

**Codex 계약 확인 필요.** compaction 뒤 원본 message 접근 가능성, 요약과 보존 구간의 식별 정보, 특정 message에서 fork하는 공식 API, fork provenance와 원본 불변성, 실행 중 fork 제한을 확인한다.

참고: [Hybrid compaction 설계](../archive/2026-09-12-pi-harness/docs/architecture/pi-harness/hybrid-compaction-design.md), [모델 응답 지점 fork 설계](../archive/2026-09-12-pi-harness/docs/architecture/azrael-ex/model-response-session-fork-design.md)

### 8. 명시적인 UI 상태, scroll 복구와 접근성

**근거.** `loading`, `streaming`, `waiting`, `reconnecting`, `uncertain`, `error`, `completed`처럼 사용자의 다음 행동이 달라지는 상태는 색만으로 표현하지 않고 이름과 동작으로 구분해야 한다. 과거 내용을 읽는 동안 새 event가 도착해도 위치를 보존하고, 재개 시 읽던 위치를 복구하며, keyboard·focus·zoom·고대비·reduced motion을 제품 상태로 다루는 것이 필요하다.

**Codex 계약 확인 필요.** engine event와 run 상태의 전체 목록 및 순서, reconnect 시 누락·중복 가능성, streaming message의 안정적인 anchor 식별자를 확인한다. VS Code Webview의 state serialization, focus 복원, theme와 accessibility API가 제공하는 범위도 함께 검증한다.

참고: [UI/UX 디자인 지침](../archive/2026-09-12-pi-harness/docs/architecture/azrael-ex/azrael-ex-ui-ux-design-guidelines.md), [다중 session 런타임 설계](../archive/2026-09-12-pi-harness/docs/architecture/azrael-ex/multi-session-background-runtime-design.md)

## 다음 설계에서 결정할 사항

각 후보는 Codex 엔진의 공개 계약과 최소 prototype으로 검증한 뒤 `채택`, `수정 채택`, `보류` 중 하나로 판정한다. 채택되는 항목만 새 아키텍처의 권위 문서에 동작, 상태 전이, 저장 소유권, 실패 처리와 수용 기준을 구체화한다.
