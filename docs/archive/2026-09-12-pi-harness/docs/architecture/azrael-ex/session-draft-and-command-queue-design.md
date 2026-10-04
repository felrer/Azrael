# azrael-ex 세션 Draft와 Command Queue 설계

- 상태: `ready` — migration 004 기반 구현에 session writer fencing을 추가하는 개편 기준
- 결정일: 2026-09-04
- 적용 대상: azrael-ex VS Code Desktop extension의 세션별 Composer, queued command surface와 Pi Host dispatch
- 상위 설계: [2단계 전체 설계](azrael-ex-two-phase-system-design.md), [다중 세션 백그라운드 런타임](multi-session-background-runtime-design.md)
- 품질 계약: [안정성 및 품질 계약](azrael-ex-stability-quality-contract.md)
- Writer 계약: [세션 Writer 소유권과 전환](session-writer-ownership-design.md)

## 1. 결정 요약

azrael-ex는 Composer draft와 아직 Pi에 전달되지 않은 command를 `workspaceId + sessionId`별로
Core SQLite에 저장한다. 실행 중 새 사용자 요청과 `Compact context` intent는 session의 durable
FIFO queue에 들어가며, 현재 실행이 terminal 상태가 된 뒤 자동으로 하나씩 전달된다.

Queued prompt에는 `Steer`, `삭제`, overflow menu의 `Edit message`를 제공한다. Queued compaction에는
`Steer`와 `삭제`만 제공한다. `Turn off queuing`은 UI, Webview protocol, host command와 설정에 만들지
않는다.

이 설계에서 queue의 원본은 Pi SDK의 in-memory follow-up queue가 아니라 Core ledger다. Pi SDK에는
개별 queued item identity, compare-and-swap revision, 한 항목 삭제와 draft 복귀 계약이 없기 때문이다.
Core에서 claim된 항목만 Pi Host로 전달한다.

## 2. 의도한 사용자 결과와 완료 조건

사용자는 다음 동작을 관찰할 수 있어야 한다.

- session A 입력란에 작성한 내용을 그대로 둔 채 session B로 이동하고, A를 다시 열면 A의 draft가 보인다.
- panel reload, idle hibernate와 Extension Host 재시작 뒤에도 마지막으로 확인된 session draft가 복원된다.
- session이 실행 중일 때 Enter로 요청을 보내면 입력란이 비워지고 Composer 위에 queued prompt가 나타난다.
- 현재 실행이 끝나면 같은 session의 첫 queued command가 자동으로 시작되며 FIFO 순서가 바뀌지 않는다.
- queued prompt의 `Steer`는 현재 실행을 안전한 중간 경계에서 조정하고 해당 prompt를 우선 전달한다.
- queued prompt의 `Edit message`는 queue에서 항목을 제거하고 내용을 같은 session의 입력란으로 되돌린다.
- queued command의 `삭제`는 아직 전달되지 않은 항목만 취소한다.
- 실행 중 요청한 compaction도 queue에 나타나고, 현재 실행 뒤 자동 실행되거나 `Steer`로 즉시 전환된다.
- 다른 session의 draft, queue content, command 상태가 현재 panel에 순간적으로도 노출되지 않는다.
- 전달 여부가 불명확한 command는 자동 재전송되지 않고 기존 recovery surface로 승격된다.
- Observer가 session을 열어도 durable draft는 보존되며 writer 전환만으로 전송되거나 비워지지 않는다.

## 3. 범위와 비범위

### 3.1 범위

- session별 revisioned draft 저장과 복원
- `prompt`와 `compact-context` 두 command kind의 durable FIFO queue
- prompt의 Steer, Edit message와 삭제
- compaction의 Steer와 삭제
- idle 전환 뒤 자동 dispatch
- queued/delivered/uncertain command의 crash-safe evidence
- 현재 session으로 제한된 queue projection과 접근성 있는 queued item surface

### 3.2 비범위

- `Turn off queuing` 설정 또는 action
- queue reorder와 drag-and-drop
- queued compaction instruction 편집
- 이미 Pi에 전달된 command의 Edit message 또는 삭제
- Pi SDK 내부 queue를 사용자-visible queue 원본으로 사용
- VS Code/Extension Host 종료 뒤 계속 실행되는 daemon
- provider가 ambiguous request를 실제 처리했는지 원격으로 판정하는 exactly-once 보장

## 4. 권위와 책임 경계

| 데이터 또는 동작 | 권위 owner | 책임 |
| --- | --- | --- |
| acknowledged draft | Core SQLite | session identity, revision, content와 갱신 시각 저장 |
| acknowledgement 전 draft | Webview emergency state | 마지막 local 입력을 짧게 보존하되 durable saved로 표시하지 않음 |
| queued command와 순서 | Core SQLite | stable command ID, kind, ordinal, revision과 lifecycle evidence |
| session 실행 상태와 dispatch admission | Broker `SessionActor` | active run 단일화, writer epoch fencing, idle 감지, FIFO pump와 global slot 연동 |
| prompt/steer/abort/compact side effect | session별 Pi Host | Pi `AgentSession` 호출과 public event projection |
| queue UI projection | Broker + Extension Host | 현재 immutable WorkspaceBinding/session/client role로 제한·검증 |
| transcript | Pi JSONL | queued item을 durable user message로 위장하지 않음 |

Webview는 queue 상태를 직접 확정하지 않는다. Extension Host와 Broker는 Webview가 보낸 session identity를
authority로 사용하지 않고 panel의 immutable binding, authenticated client id와 writer epoch를 다시 적용한다. Core와 Pi Host의 acknowledgement
전에 항목을 `delivered`, `settled` 또는 `cancelled`로 표시하지 않는다.

## 5. Draft 계약

### 저장과 전송의 순서

Webview는 전송을 요청하면 예약된 draft 저장을 취소하고, 이미 진행 중인 저장의 성공 응답을 기다린 뒤 갱신된 revision으로 command를 제출한다. 전송 대기 및 처리 중에는 추가 draft 저장을 시작하지 않는다. 선행 저장 실패 또는 observer 전환 시 아직 제출하지 않은 요청은 취소하며 입력은 유지한다. 사용자가 전송 이후 새로 작성한 내용은 전송 응답으로 지우지 않고, 응답 이후 저장을 재개한다. Core의 revision 검사와 command acceptance 계약은 유지한다.

### 5.1 identity와 복원

Draft key는 `(workspace_id, session_id)`다. session ID 하나만으로 다른 workspace의 draft를 찾지 않는다.
Draft record는 최소한 다음 값을 가진다.

```text
SessionDraft
  workspaceId
  sessionId
  markdown
  revision
  updatedAt
```

Panel attach의 첫 authoritative snapshot은 Core draft를 transcript snapshot의 `draft`에 합성한다.
Webview `getState()`의 emergency draft는 저장된 `workspaceId + sessionId`가 panel meta identity와 모두
일치할 때만 사용할 수 있다. Core에서 더 최신 acknowledgement를 받으면 emergency copy보다 Core를
우선한다.

### 5.2 저장과 충돌

- Webview는 입력 중 local state와 emergency state를 즉시 갱신한다.
- Core 저장은 debounce하고 blur/panel detach/deactivation에서 bounded flush한다.
- 저장 요청은 `expectedRevision` compare-and-swap을 사용한다.
- Observer는 acknowledged session draft를 읽고 보존할 수 있지만 current writer epoch 없이 durable draft를 변경하지 못한다.
- 성공 acknowledgement 뒤에만 UI가 해당 revision을 durable saved로 간주한다.
- revision conflict에서는 current draft와 attempted draft를 모두 보존하고 last-write-wins로 덮지 않는다.
- IME composition 중간 값은 submit하지 않으며, composition 종료 뒤 정상 draft 저장 흐름에 합류한다.

Prompt 또는 queue acceptance에 성공하면 같은 transaction boundary에서 acknowledged draft를 빈 값으로
전환한다. Acceptance 전 실패하거나 Webview acknowledgement가 오지 않으면 local transaction이 원문을
복원할 수 있어야 한다.

## 6. Durable command model

Queue item의 public 의미는 다음과 같다.

```text
QueuedCommand
  commandId
  workspaceId
  sessionId
  kind: prompt | compact-context
  ordinal
  revision
  state: queued | delivered | settled | cancelled | uncertain
  promptText?: string
  activeRunId?: string
  createdAt
  updatedAt
```

`promptText`는 `kind=prompt`에서만 존재한다. Recovery/catalog projection에는 prompt text를 포함하지
않는다. 현재 session의 queue surface를 위한 별도 host query만 queued prompt text를 반환할 수 있다.
`compact-context`는 enqueue 당시의 context revision을 실행 권위로 저장하지 않는다. 실행 사이에 현재
run이 context를 바꾸므로 dispatch 시점의 최신 context revision과 mutable 상태를 다시 읽는다.

Session별 ordinal은 queued item에서만 연속적인 FIFO 의미를 가진다. 동일 ordinal 경쟁은 Core transaction과
stable secondary key로 결정하며 Webview 정렬을 authority로 사용하지 않는다.

## 7. 상태 전이

```text
created
  └─ Core commit ─> queued
       ├─ idle auto-dispatch ─> delivered ─> settled
       ├─ Steer ──────────────> delivered ─> settled
       ├─ 삭제 ───────────────> cancelled
       └─ Edit message ───────> cancelled + draft committed

delivered ── evidence gap / child loss ─> uncertain
```

허용 규칙은 다음과 같다.

- `Steer`, `삭제`, `Edit message`는 expected revision이 일치하는 `queued` 항목에만 적용한다.
- `Edit message`는 prompt에만 허용한다.
- delivered 이후 content와 kind는 잠기며 수정·삭제할 수 없다.
- 사용자에게는 cancelled 항목을 즉시 숨기되 ledger와 append-only journal은 유지한다.
- uncertain original은 자동으로 queued로 되돌리지 않는다.

## 8. 제어 흐름

### 8.1 Composer submit

```text
Webview composer.submit(text, draftRevision, expectedWriterEpoch)
  → host와 Broker가 panel binding/auth/recovery/current writer epoch 검증
  → stale former writer와 observer request를 Core transaction 전에 거절
  → Core가 command + empty draft를 transaction으로 commit
  → host가 disposition(started | queued) acknowledgement
  → Webview가 입력란을 비우고 queue projection 적용
  → SessionActor가 idle이면 pump, running이면 queued 유지
```

`composer.submit` request result는 전체 model run의 완료를 기다리지 않고 durable acceptance 결과를
반환한다. 이후 progress와 settlement는 transcript/runtime/queue event가 전달한다. Double-click과 key
repeat는 같은 Webview request/command correlation에서 중복 command를 만들지 않는다.

### 8.2 자동 dispatch

SessionActor는 active run이 없고 recovery fence, permission, direct mutation과 compaction이 없을 때만
첫 queued command를 pump한다. GlobalRunScheduler slot을 얻기 전에는 `delivered`로 전환하지 않는다.

```text
actor idle
  → Core에서 session FIFO head 확인
  → global run slot 확보
  → Core claim/delivery owner 기록
  → Pi Host side effect
  → terminal evidence로 settle 또는 uncertain
  → actor idle이면 다음 head 반복
```

한 session에서 동시에 둘 이상의 queue pump가 동작하지 않는다. Panel attach/detach는 pump를 시작하거나
취소하는 authority가 아니다.

### 8.3 Prompt Steer

Prompt `Steer`는 Pi SDK의 `AgentSession.steer(text)` 의미를 사용한다. 이는 현재 assistant turn의 tool
호출이 안전한 경계에 도달한 뒤 다음 LLM call보다 먼저 steering message를 전달한다. 별도의 hard abort와
새 prompt를 조합해 Steer로 위장하지 않는다.

Host는 queued row를 먼저 active run에 claim하고 delivery owner/run evidence를 기록한 뒤 Pi Host에
stable command ID와 text를 보낸다. Pi acknowledgement가 불명확하면 original을 uncertain으로 두고
자동 재전송하지 않는다. Steer된 prompt는 별도 새 session run으로 표시하지 않고 현재 active run과
연결된 command로 settle한다.

### 8.4 Edit message

`Edit message`는 queue item을 직접 in-place 편집하지 않는다.

```text
queue.edit-to-draft(commandRevision, draftRevision)
  → queued prompt와 current draft revision 검증
  → 한 Core transaction에서 queue item cancelled + draft=promptText
  → acknowledgement 후 queue card 제거, Composer hydrate/focus
```

현재 draft가 사용자가 본 revision 이후 바뀌었거나 비어 있지 않다면 작업 전체를 conflict로 거부한다.
Queue item과 current draft를 모두 그대로 유지해 silent overwrite를 방지한다.

### 8.5 삭제

삭제는 `queued → cancelled` CAS 전이다. 물리 row 또는 journal을 삭제하지 않는다. 동일 command의 늦은
auto-dispatch가 발생하지 않도록 cancel과 claim은 Core transaction에서 경쟁하며 한쪽만 성공한다.

### 8.6 Compaction enqueue와 Steer

실행 중 Context menu의 `Compact context`는 disabled가 아니라 `compact-context` command를 enqueue한다.
Idle에서는 같은 command model을 거쳐 바로 dispatch할 수 있다. 따라서 direct compact와 queued compact가
서로 다른 recovery 규칙을 갖지 않는다.

Queued compaction의 `Steer`는 text steering과 의미가 다르다. Pi에는 compaction steering API가 없으므로
다음 계약을 사용한다.

```text
queued compaction Steer
  → 새 prompt/queue intake를 잠금
  → active run abort 요청
  → terminal abort와 actor idle 확인
  → 최신 context state/revision 재조회
  → queued compaction claim
  → 기존 append-only compaction transaction 실행
```

Abort가 확인되기 전에는 compaction을 claim하지 않는다. Abort 뒤 claim 전에 host가 종료되면 item은 아직
queued이므로 안전하게 재개할 수 있다. Claim 뒤 compaction settlement가 불명확하면 기존
`compaction-interrupted` recovery fence와 uncertain 규칙을 적용한다.

## 9. Public interface 경계

Webview request는 최소한 다음 intent를 구분한다.

```text
composer.submit
draft.update
context.compact
queue.steer
queue.cancel
queue.edit-to-draft
```

모든 mutation intent는 `expectedWriterEpoch`와 기존 expected draft/command revision을 함께 가진다.

Host event는 bootstrap snapshot과 revisioned change를 제공한다.

```text
draft.snapshot | draft.changed
queue.snapshot | queue.changed
request.result
```

Queue snapshot은 현재 panel의 `workspaceId + sessionId` 한 건으로 host에서 제한한다. 전체 workspace queue를
Webview로 보내 client-side filter하지 않는다. `queuedCount`만 필요한 Recent sessions/TreeView에는 content
없는 projection을 사용한다.

Pi Host protocol은 prompt Steer와 compaction Steer에 필요한 session-bound method를 추가하되, queue list,
draft body, ordinal과 cancelled ledger는 Pi Host에 복제하지 않는다.

## 10. 실패와 복구

| 실패 지점 | 상태와 동작 |
| --- | --- |
| draft Core save 전 Webview reload | identity가 일치하는 emergency draft를 표시하고 Core revision과 reconcile |
| command Core commit 실패 | Composer 원문 유지, queued card 생성 안 함 |
| commit 성공/ack 손실 | refresh에서 같은 command/draft revision을 회수하며 duplicate enqueue 금지 |
| queued item delete/edit와 claim 경쟁 | CAS 승자만 적용, 패자는 최신 snapshot을 다시 표시 |
| Pi 전달 전 child failure | queued 유지; delivery evidence가 없을 때만 safe replay |
| Pi acknowledgement 불명 | uncertain/read-only, 자동 재전송 금지 |
| active run abort 실패 | compact Steer를 queued로 유지하고 오류 표시 |
| compact claim 뒤 child failure | compaction-interrupted recovery fence |
| Core unavailable | local draft 입력은 허용, queue mutation과 성공 표시는 차단 |
| observer 또는 stale writer mutation | Core queue/draft를 변경하지 않고 최신 writer snapshot 반환; local 입력 보존 |
| writer transfer와 submit 경쟁 | 같은 actor mailbox에서 epoch CAS를 먼저 직렬화하며 한쪽만 유효 |

Webview가 queue event gap 또는 revision 역행을 발견하면 부분 이벤트를 추측해 적용하지 않고 현재 session의
fresh queue snapshot으로 수렴한다. Reconnect 중에도 마지막 confirmed queued card와 draft를 빈 화면으로
교체하지 않는다.

## 11. 보안과 개인정보

- Prompt text는 현재 bound session의 queue/draft API와 lease-protected Pi claim에만 반환한다.
- Recent sessions, TreeView, recovery list, diagnostics와 log에는 prompt/draft 원문을 넣지 않는다.
- 다른 workspace/session의 queue row를 Webview로 보낸 뒤 숨기는 구조를 금지한다.
- command ID, revision, kind, 상태와 digest는 진단할 수 있지만 credential, provider payload, canonical path와
  hidden reasoning은 queue metadata에 저장하지 않는다.
- queue action은 workspace trust, binding availability, physical mutation lease, current writer epoch와 recovery fence를 다시 검증한다.

## 12. 선택한 trade-off

- **Core-owned queue를 선택한다.** Pi `followUp()`은 자동 실행에는 편리하지만 개별 item identity와 삭제,
  Edit message, crash evidence를 제공하지 않으므로 enqueue 시점의 owner로 사용하지 않는다.
- **cancelled row를 보존한다.** 사용자에게는 삭제처럼 보이지만 crash 분석과 claim 경쟁 증거를 위해 ledger를
  물리 삭제하지 않는다.
- **Edit message는 atomic move다.** queue와 draft를 따로 갱신하면 content가 중복되거나 유실될 수 있다.
- **Compaction은 generic command queue에 참여한다.** 별도 boolean `compactAfterRun`은 순서, 삭제, recovery와
  여러 intent를 표현하지 못한다.
- **Prompt Steer와 compact Steer의 내부 동작을 구분한다.** 동일 label은 사용자 결과가 “현재 작업보다 우선”임을
  나타내지만 Pi side effect는 각각 native steer와 abort-then-compact다.

## 13. 불변조건

- Draft와 queue identity는 항상 `workspaceId + sessionId`다.
- Session writer가 바뀌어도 session-scoped draft와 queue identity/revision은 바뀌거나 소비되지 않는다.
- Current writer epoch가 아닌 client mutation은 durable queue acceptance와 Pi dispatch 전에 거부한다.
- 한 session에는 active model run과 queue pump가 각각 최대 하나다.
- queued FIFO head보다 뒤 항목을 auto-dispatch하지 않는다.
- Core claim 전에 Pi prompt, steer 또는 compact side effect를 시작하지 않는다.
- delivered/uncertain 항목을 Edit message 또는 삭제로 queued 상태처럼 변경하지 않는다.
- submit acceptance 실패 시 Composer 원문을 잃지 않는다.
- queued item은 Pi JSONL transcript message가 아니며 실제 Pi acceptance 전 user message로 렌더링하지 않는다.
- compaction은 dispatch 시점의 최신 context revision으로 검증한다.
- Prompt Steer는 native Pi steer이고, compact Steer는 abort settlement 뒤 compact다.
- Panel close, session 전환과 Webview reload가 run 또는 queue를 암묵적으로 취소하지 않는다.
- ambiguous delivered command는 자동 재전송하지 않는다.
- `Turn off queuing`은 어떤 제품면에도 존재하지 않는다.

## 14. 완료 판정

이 설계는 다음이 모두 검증될 때 구현 완료로 판정한다.

- session A/B draft가 전환, panel reload, hibernate와 Extension Host restart를 지나 독립 복원된다.
- 실행 중 prompt 두 개와 compact 하나를 enqueue하면 표시 순서와 자동 실행 순서가 동일하다.
- Prompt Steer, prompt 삭제, Edit message와 compact Steer/삭제가 허용 상태에서만 보이고 동작한다.
- Edit message conflict에서 기존 draft와 queued prompt가 모두 보존된다.
- submit/compact double action과 claim/cancel 경쟁이 Pi side effect 중복을 만들지 않는다.
- queued command는 safe restart 뒤 재개되고 delivered/ambiguous command는 uncertain으로 남는다.
- session B Webview, catalog, TreeView와 diagnostic에 session A의 draft/prompt text가 노출되지 않는다.
- Composer와 Context menu에 `Turn off queuing` action이 없다.
- keyboard-only와 screen reader에서 queue order, kind, 상태와 action을 식별할 수 있다.

구현 계획을 막는 미결정 사항은 없다.
