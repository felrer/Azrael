# azrael-ex 다중 세션 백그라운드 런타임 설계

세션별 Composer draft와 실행 중 prompt/compaction queue의 세부 권위, 상태 전이와 Steer 계약은
[세션 Draft와 Command Queue 설계](session-draft-and-command-queue-design.md)를 따른다.
여러 VS Code window의 read-only open과 UI writer 전환은
[세션 Writer 소유권과 전환 설계](session-writer-ownership-design.md)를 따른다.

- 상태: `ready` — cold/warm transcript 복원 계약을 포함한 기준 설계
- 결정일: 2026-09-03
- 최근 개정: 2026-09-04 — profile Session Broker, read-only open과 session writer 전환 계약 추가
- 적용 대상: azrael-ex VS Code Desktop extension
- 상위 설계: [azrael-ex 우선 2단계 전체 설계](azrael-ex-two-phase-system-design.md)
- 품질 계약: [azrael-ex 안정성 및 품질 계약](azrael-ex-stability-quality-contract.md)
- 세션 UI 계약: [Codex형 세션 관리 UI](session-management-ui-design.md)
- Fork 계약: [모델 응답 지점 새 세션 Fork](model-response-session-fork-design.md)

## 1. 결정과 사용자 결과

azrael-ex는 profile-scoped Session Broker 안에 `workspaceId + sessionId`별 독립 Pi Host child와
session actor를 둔다. `ChatPanel`과 Extension Host는 session runtime owner가 아니라 attach 가능한
client/UI consumer다. 사용자가 다른 session을 열거나 chat tab/window를 닫아도 active run, pending
queue 또는 permission이 있는 session은 Broker가 계속 소유한다.

이 문서에서 **백그라운드**는 session chat Webview나 원래 Extension Host가 사라져도 연결 client 또는
active work가 있는 동안 Broker가 run을 지속한다는 뜻이다. 무기한 OS service는 범위에 포함하지 않는다.
모든 client와 active work가 사라지고 idle grace가 지나면 durable evidence를 기록한 뒤 child와 Broker를
순서 있게 종료한다.

사용자는 다음 결과를 관찰할 수 있어야 한다.

- 현재 workspace의 session 목록에서 기존 session을 열거나 새 session을 만든다.
- session A가 실행 중이어도 session B를 열고 독립적으로 prompt를 실행한다.
- 실행 중인 tab을 닫아도 session A는 `background`로 남고 완료 또는 attention 상태가 목록에 나타난다.
- 같은 session을 다시 열면 새 runtime을 만들지 않고 authoritative snapshot과 event cursor에서 화면을 재구성한다.
- 한 session의 crash, permission 대기 또는 느린 Webview가 다른 session의 실행과 VS Code editor를 중단하지 않는다.

## 2. 구조와 소유권

```text
VS Code Extension Host A ─┐
  AuthCoordinator         ├─ user-scoped named pipe ─┐
  ChatPanel/TreeView      │                          │
VS Code Extension Host B ─┘                          ▼
                                      profile Session Broker
                                      ├─ SessionCatalogService ── Core/SQLite
                                      ├─ SessionRuntimeManager
                                      │  ├─ SessionActor(A) ── Pi Host A
                                      │  └─ SessionActor(B) ── Pi Host B
                                      ├─ session writer authority/epoch
                                      └─ GlobalRunScheduler
```

### 2.1 Extension Host

Extension Host는 VS Code API, Broker client composition, workspace binding 재검증, panel registry,
전역 인증과 notification을 소유한다. Agent loop, Core/Pi Host lifecycle, Pi JSONL write, writer
authority와 SQL query는 직접 소유하지 않는다.

### 2.2 SessionCatalogService와 Core child

Broker가 단독 실행하는 Core는 session catalog, session별 draft/queue, dispatch evidence, recovery와 mutation lease의
authoritative owner다. Catalog는 Pi JSONL에서 rebuild 가능한 SQLite projection이며 마지막으로
확인된 목록을 Core reconnect 동안 유지한다. Pi JSONL을 수정하지 않는다.

### 2.3 SessionRuntimeManager와 SessionActor

`SessionRuntimeManager`는 한 profile Broker 안에서 `workspaceId + sessionId`마다 정확히 하나의
`SessionActor`를 반환한다. 동시 open/restore 요청은 같은 actor로 수렴한다. Actor는 Pi Host
child, heartbeat, lifecycle state, UI consumer 집합과 session event cursor를 소유한다.

최소 application port의 의미는 다음과 같다.

```text
create(workspaceId) -> session identity
openReadOnly(workspaceId, sessionId) -> history + writer control projection
attach(sessionId, consumerId) -> snapshot + cursor + observer/writer subscription
detach(sessionId, consumerId) -> no runtime cancellation
transferWriter(sessionId, expectedWriterEpoch, expectedSessionRevision)
submit(sessionId, writerEpoch, commandId, prompt)
abort(sessionId, reason)
snapshot(sessionId)
hibernate(sessionId)
shutdown()
```

Webview 또는 panel은 이 port를 통해 intent를 제출할 뿐 actor, child handle, Pi SDK object나
canonical path를 받지 않는다.

### 2.4 세션별 Pi Host child

Write 가능한 session 하나는 Broker가 소유하는 Pi Host child 하나에 immutable하게 bind된다. 한 child는 lifetime
중 다른 session으로 `switchSession()`하지 않는다. Session 변경은 다른 actor를 열거나 reveal하는
UI 동작이며 기존 session을 abort하지 않는다.

각 Pi Host는 다음만 소유한다.

- 하나의 Pi `AgentSession`과 JSONL write
- writable runtime 시작/재연결에서 Pi `SessionManager.getBranch()`를 public transcript snapshot으로 바꾸는 history hydration
- 해당 session의 model/thinking/run/tool state
- session-bound permission preflight
- normalized public event stream과 heartbeat
- AuthCoordinator가 broker한 현재 credential revision의 memory projection

Pi Host crash 범위는 해당 session으로 제한한다. Core와 다른 Pi Host는 함께 종료하지 않는다.

## 3. Identity, catalog와 mutation lease

Session identity는 `workspaceId + sessionId`이고 panel title, display name 또는 filesystem path를
identity로 사용하지 않는다. Session 생성 후 canonical workspace binding은 바뀌지 않는다.

Catalog row는 최소 다음 projection을 가진다.

```text
workspaceId, sessionId, displayName, updatedAt
runtimeState: dormant | starting | idle | running | waiting-permission
              | waiting-slot | stopping | crashed | uncertain
surfaceState: foreground | background | closed
queuedCount, unreadCount, attentionKind?, activeRunId?
writerRole: writer | observer
writerEpoch, writerTransferState: hidden | available | transferring | blocked
writerBlockedReason?
```

`foreground/background/closed`는 runtime state가 아니라 UI consumer projection이다. Panel이 없어도
actor가 `running`일 수 있고, panel이 열려 있어도 hibernated session을 표시할 수 있다.

같은 Pi JSONL을 둘 이상의 host가 write하지 못하도록 Core는 physical mutation lease를 atomic하게
관리하고 Broker는 그 위에 UI client의 session writer authority/epoch를 둔다. Lease는 `sessionId`,
`ownerInstanceId`, `hostInstanceId`, acquisition/heartbeat/expiry를 포함한다.

- Broker가 가진 유효 lease는 모든 연결 Extension Host가 하나의 physical writer를 공유하게 한다. UI client는 writer 한 명과 observer들로 나뉜다.
- Broker 밖의 유효 lease가 있으면 history는 read-only로 열고 writer control을 `external-owner`로 비활성화한다. 일반 `실행 오류`로 session open을 막지 않는다.
- actor start가 성공하기 전에 write 가능한 상태로 표시하지 않는다.
- lease expiry만으로 이전 prompt가 전달되지 않았다고 추론하지 않는다.
- crash 뒤 lease를 재획득하기 전에 JSONL과 dispatch evidence를 reconcile한다.
- 이전 side effect가 불명확하면 runtime을 재개해도 command를 자동 재전송하지 않고 `uncertain`으로 남긴다.
- Pi CLI, Electron, legacy extension처럼 비협력 owner의 lease를 강제 회수하지 않는다.

## 4. Lifecycle과 resource policy

Actor의 주요 상태 전이는 다음과 같다.

```text
dormant ── open/submit ──> starting ── lease+handshake ──> idle
   ▲                                                   │
   │                                                   ├─ submit+slot ─> running
   │                                                   └─ submit-no-slot ─> waiting-slot
   │                                                                        │
   └─ hibernate <── idle + no consumer/queue/permission                     │ slot
                         running ── tool gate ─> waiting-permission <────────┘
                            │                    │
                            └──── settled/abort ─┴─> idle

any live state ── child loss ─> crashed ── evidence reconcile ─> idle | uncertain
```

초기 동시 model run budget은 3개다. 설정 범위는 1–8로 제한하고 무제한 값을 허용하지 않는다.
Budget은 전역 `GlobalRunScheduler`가 공정한 FIFO로 배정하되 각 session 내부 queue 순서를 바꾸지
않는다. `waiting-permission`은 이미 시작한 run이므로 slot을 계속 점유한다. 사용자가 abort하거나
terminal settlement가 확인될 때만 slot을 반환한다.

Resident Pi Host hard cap은 기본 6개이고 설정 범위는 3–12다. Cap에 도달하면 active run,
pending permission 또는 unresolved recovery가 없는 least-recently-used idle actor부터 hibernate한다.
열린 panel은 authoritative snapshot을 유지한 채 dormant/reconnecting surface가 될 수 있으며 다음
focus 또는 command에서 다시 attach한다. 안전하게 hibernate할 actor가 없으면 새 cold start는
`waiting-slot`에서 기다리고 기존 active host를 강제 종료하지 않는다.

Panel consumer가 없고 active run, queued item, pending permission, unresolved recovery가 없는 idle
actor는 기본 5분 뒤 hibernate할 수 있다. Hibernate는 Pi Host memory만 해제하며 JSONL, catalog,
draft와 queue를 삭제하지 않는다. Consumer가 있는 idle actor는 시간만으로 hibernate하지 않지만
resident hard cap 압력에서는 위 LRU 규칙의 대상이 될 수 있다.

Session별 in-memory event replay는 2,000개 event 또는 serialized 2 MiB 중 먼저 도달한 값으로
제한하고 초과하면 fresh snapshot으로 수렴한다. Pi Host RSS가 512 MiB를 넘으면 diagnostic을 남기고
idle이면 hibernate 대상으로 승격한다. Live child RSS 합계가 1.5 GiB를 넘으면 새 cold start를
admission하지 않고 먼저 안전한 idle host를 hibernate한다. Active run을 memory threshold만으로
강제 종료하지 않는다.

## 5. 주요 제어 흐름

### 5.1 Session 목록과 열기

```text
Header Recent sessions popover 또는 Sessions TreeView
  → SessionCatalogService.list(workspaceId)
  → user selects sessionId
  → Extension Host revalidates WorkspaceBinding
  → Broker.openReadOnly(workspaceId, sessionId)
  → existing actor snapshot 또는 read-only history hydrator로 JSONL id/cwd/branch 검증
  → mutation lease와 Pi Host를 만들지 않고 authoritative transcript snapshot 구성
  → Broker가 writer role/epoch/transfer 가능 여부를 별도 projection
  → ChatPanel opens or reveals
  → panel attaches and receives snapshot + cursor + WriterControlView
```

두 목록 surface는 현재 `WorkspaceBinding.workspaceId`로 host에서 제한한 같은 last-confirmed Core
catalog와 actor live projection을 소비한다. 다른 프로젝트의 row를 Webview로 보낸 뒤 client-side로
숨기지 않는다. Header popover는
빠른 전환의 primary surface이고 TreeView는 workspace-wide attention의 secondary surface다. 목록
조회와 read-only open은 Pi Host start를 요구하지 않는다. Session을 클릭했을 때 기존 actor가 있으면
재사용하며, dormant session은 writer transfer 또는 최초 mutation acceptance에서만 lazy start한다.
Header ID 또는 cwd가 binding과 다르면 runtime을 열지 않고
catalog diagnostic을 표시한다.

### 5.2 Foreground에서 background로 전환

```text
ChatPanel dispose/close
  → bridge subscription dispose
  → RuntimeManager.detach(sessionId, consumerId)
  → actor keeps child while run/queue/permission/recovery exists
  → catalog surfaceState = background 또는 closed
  → completion/attention event updates TreeView and optional notification
```

Panel dispose는 `abort`, `AgentSession.dispose()` 또는 Pi Host shutdown을 암묵적으로 호출하지 않는다.
명시적인 Stop/Abort action만 active run을 중단한다.

### 5.3 다시 열기와 event replay

Warm reattach, read-only cold open과 writable runtime 복귀는 snapshot의 원본이 다르지만 Webview 계약은 같다.

- **Warm reattach**: 살아 있는 actor가 보유한 authoritative snapshot과 마지막 accepted cursor를
  보낸 뒤 cursor 다음 event만 replay하고 live subscription으로 전환한다.
- **Read-only cold open**: provider/tool/AgentSession을 만들지 않는 history hydrator가 정확한 session
  file의 header id/cwd와 active branch를 검증해 snapshot을 만든다. Physical lease 충돌과 무관하게
  observer attach가 가능하다.
- **Hibernate 복귀/Pi Host 재시작**: writer transfer 또는 mutation에 필요한 새 Pi Host가 같은 검증과
  active branch 전체 projection을 마친 뒤에만 mutation intake를 허용한다.

`RuntimeUiPort.getSnapshot()`은 history-ready barrier를 방어적으로 기다린다. 따라서 durable visible
entry가 있는 session에 `items: []`인 정상 ready snapshot을 먼저 보내지 않는다. 실제로 visible entry가
없는 새 session만 empty-state를 표시할 수 있다. Hydration이 실패하면 panel open 또는 reconnect를
명시적으로 실패시키고 redacted diagnostic을 남기며, 빈 새 session처럼 가장하지 않는다.

Gap, epoch 변경 또는 bounded replay 초과 시에도 같은 cold snapshot builder로 수렴한다. 새 epoch의
snapshot commit 전에는 이전 epoch event를 폐기하며, snapshot commit 이후에 생성된 event만 현재
cursor 뒤에 적용한다. Webview `getState()`는 scroll/disclosure와 emergency draft만 복구하며
session/run authority나 transcript 원본이 아니다.

### 5.4 Pi active branch → transcript snapshot 계약

Pi JSONL과 Pi session format이 transcript의 durable owner로 남는다. Core SQLite에 message body를
복제하지 않으며 Webview state를 복원 원본으로 사용하지 않는다. Broker의 read-only hydrator와 Pi Host hydrator는
`getBranch()`가 반환한 현재 leaf의 ancestor chain만 읽고, 다른 branch의 entry를 현재 대화에 섞지
않는다.

| Pi active-branch entry | Public projection |
| --- | --- |
| user message | `user-message`; Pi entry id의 namespaced SHA-256 opaque token을 기반으로 한 stable item id와 private edit target mapping |
| assistant text/thinking block | content index별 `assistant-message`/`thinking`; terminal status로 복원 |
| assistant tool call + matching tool result | 같은 `toolCallId`의 `command` 또는 `tool`; result/error/exit 상태를 terminal projection으로 결합 |
| result가 없는 historical tool call | 실행 중으로 표시하지 않고 `uncertain`; 자동 실행·재전송 없음 |
| compaction entry | 기존 `compaction` row와 first-kept 경계를 보존 |
| `azrael-ex.compaction-failure.v1` custom entry | transcript row와 model context에서는 제외하고, 최근 실패의 정제된 진단 상태만 복원 |
| model/thinking/session-info/label entry | transcript row가 아니라 inference/title/editability metadata에만 반영 |
| 의미가 없는 hidden/custom entry | 사용자/assistant message로 위장하지 않고 제외; raw payload 없는 bounded diagnostic만 기록 |

Hydrator는 과거 run id가 JSONL에 없다는 이유로 새 live run을 발명하지 않는다. Historical grouping이
필요한 view field는 가장 가까운 durable user entry id의 opaque token에서 파생한 `history:<opaque>` namespace를
사용하며 dispatch/settlement evidence로 해석하지 않는다. Item id는 durable Pi entry id의 namespaced hash,
`toolCallId`, block index로 결정적으로 만들고 동일 branch를 다시 열어도 같아야 한다. 각 durable
visible assistant 응답의 마지막 public item과 Pi assistant entry 사이의 Fork mapping도 같은 batch에서
만들며 Pi Host 밖에는 entry id를 노출하지 않는다.

Projection은 live event와 같은 path/cwd/output redaction, UTF-8 byte limit과 schema validation을
사용한다. Raw canonical path, full provider payload와 hidden reasoning metadata는 snapshot이나
diagnostic을 통과하지 않는다. Batch는 별도 임시 state에서 완성·검증한 뒤 한 번에 commit하며,
중간 `transcript.upsert` flood나 부분 history를 외부 consumer에게 노출하지 않는다. Commit은
`userEntryByItemId`, next item sequence, source epoch와 snapshot revision도 함께 초기화한다.

History hydration은 read/projection 작업이며 prompt, tool, permission, queue 또는 provider request를
발생시키지 않는다. Pi가 복원한 `agent.state.messages`는 다음 model call의 context이고 UI history의
원본으로 사용하지 않는다. Compaction 때문에 context에서 제거된 과거 entry까지 사용자가 볼 수
있도록 UI는 `getBranch()`를 기준으로 한다.

### 5.5 Compaction 실패의 원자성과 rollback

Manual compaction은 idle session과 유효한 mutation lease에서만 시작한다. Pi 호출 직전에
`attemptId`, 시작 시각, 현재 leaf id, active branch entry id digest와 projector revision을
pre-attempt checkpoint로 잡는다. 성공의 commit point는 `session.compact()`가 정상 반환하고 새
compaction entry가 active leaf이며 context rebuild까지 검증된 시점이다.

요약 생성, provider 요청, hook 또는 post-append 후처리 중 어느 단계에서든 호출이 실패하거나
취소되면 다음 순서로 수렴한다.

1. compaction intake를 닫은 상태에서 현재 leaf와 새 entry를 checkpoint와 비교한다.
2. 이전 leaf가 `null`이면 `resetLeaf()`, 아니면 `branch(preAttemptLeafId)`로 active branch를 되돌린다.
3. Pi `appendCustomEntry()`로 `azrael-ex.compaction-failure.v1`을 이전 leaf의 자식으로 append한다.
   이 entry가 새 leaf가 되므로 restart 뒤에도 실패한 compaction branch가 active context로 다시
   선택되지 않는다.
4. `buildSessionContext()`로 agent messages를 재구성하고 pre-attempt context와 같은지 검증한다.
5. projector는 pre-attempt snapshot으로 복원한다. 성공 compaction row나 실패 row를 transcript
   중간에 추가하지 않고, composer 바로 위의 inline alert와 context control의 error 상태로만 알린다.

Failure entry에는 version, attempt id, manual/automatic reason, started/failed timestamp,
allowlisted error code, 2 KiB 이하의 redacted 사용자용 message, pre-attempt leaf id와 rollback 중
발견한 compaction entry id만 저장할 수 있다. 원문 message, 생성 중 summary, stack, credential,
URL/path, provider payload와 hidden reasoning은 저장하지 않는다. 취소는 `cancelled` outcome으로
기록하고 오류를 만들어내지 않는다.

Pi session은 append-only이므로 post-append 실패에서 만들어진 compaction entry를 물리적으로
삭제하거나 JSONL을 truncate하지 않는다. 그 entry는 실패 branch의 forensic evidence로 남지만
active branch, model context와 기본 transcript에서는 제외된다. Failure entry 저장이나 context
재구성이 실패하면 정상 rollback을 주장하지 않고 session을 `uncertain`/read-only로 전환해 다음
mutation을 차단한다.

현재 panel에서 요청한 compaction이 실패하면 Webview는 메뉴를 다시 열도록 요구하지 않고 즉시
composer 위에 `role="alert"`인 non-modal 안내를 표시한다. 정상 rollback을 검증한 경우 문구는
`컨텍스트 압축에 실패했습니다` → `대화는 압축 전 상태로 유지되었습니다` → 정제된 원인 순서로
구성한다. 사용자는 안내를 닫을 수 있으며 draft와 focus는 유지한다. 닫은 뒤에도 context 원형
control은 danger 상태를 유지하고 menu에서 같은 정제된 원인을 확인할 수 있다. 새 compaction을
시작하거나 성공하면 이전 오류 상태를 지운다.

Rollback 자체를 검증하지 못한 경우에는 보존을 주장하지 않고 `복구 상태를 확인하지 못해 세션을
읽기 전용으로 전환했습니다`라고 알린다. 이 상태는 일반 실패 안내보다 session recovery surface가
우선하며 명시적 복구 전 mutation을 허용하지 않는다. 어느 경우도 실패를 transcript item이나
VS Code notification으로 중복 생성하지 않는다.

## 6. Background permission과 attention

Background session의 permission request를 panel 내부 UI에만 의존하지 않는다.

- Core와 actor가 pending request를 session, canonical workspace, normalized input digest, policy revision과 expiry에 묶는다.
- Header Recent sessions popover, Sessions TreeView와 Status Bar에 attention을 표시하고, 선택적 VS Code notification은 session reveal action을 제공한다.
- Panel을 다시 열면 현재 pending request를 authoritative snapshot으로 표시한다.
- Expiry, workspace removal 또는 trust revoke 시 request를 deny/cancel하고 stale UI decision을 거부한다.
- 여러 background request를 modal dialog로 연속 표시하지 않고 session별 attention으로 합친다.

Workspace trust가 해제되거나 bound folder가 사라지면 새 prompt와 permission allow를 차단한다.
진행 중 side effect의 terminal evidence를 얻지 못하면 성공이나 실패로 추측하지 않고 `uncertain`으로
전환한다.

## 7. Auth와 credential fan-out

`AuthCoordinator`는 Extension Host activation당 하나이고 SecretStorage 접근도 그 process에 남는다.
Broker는 compatible client가 제공한 revisioned credential projection만 memory에 받아 Pi Host consumer에
fan-out한다. Credential 원문은 Broker disk와 Core에 저장하지 않는다. Provider refresh는 revisioned
commit/ack를 통과한 뒤 다른 live consumers에 수렴한다.

Panel attach/detach는 login, refresh 또는 logout lifecycle을 소유하지 않는다. Logout은 새 runtime
command intake를 먼저 막고 consumer credential clear acknowledgement 뒤 durable credential을
삭제한다.

## 8. 실패, 복구와 종료

| 실패 | 사용자 상태 | owner 동작 |
| --- | --- | --- |
| Webview reload/crash | reconnecting, last confirmed content 유지 | actor 유지, snapshot/replay로 재attach |
| Panel close | background 또는 closed | active work 유지, consumer만 detach |
| 한 Pi Host crash | 해당 session crashed/uncertain | 다른 host 유지, dispatch evidence와 JSONL reconcile |
| Core unavailable | 마지막 catalog 유지, mutation disabled | 새 lease/queue/draft ack 금지, reconnect |
| Broker 내부 observer | transcript/live 상태 + 세로형 power control | idle이면 writer transfer CAS, 그 외 사유별 비활성화 |
| 외부 lease conflict | 정상 read-only history + 회색 `external-owner` control | 두 번째 Pi Host와 강제 unlock 금지 |
| writer transfer 경쟁/응답 손실 | transferring 후 authoritative snapshot으로 수렴 | 한 epoch CAS만 성공, 추측 submit 금지 |
| permission timeout | denied terminal state | memory-only grant 생성 금지 |
| process restart 중 epoch 변경 | reconnecting | retired epoch event 폐기, fresh snapshot |
| history hydration 실패 | session open/reconnect 오류, empty-state 금지 | JSONL 원본 보존, redacted diagnostic 후 재시도 |
| compaction 실패 | composer inline alert + context control 오류, transcript는 시도 전 상태 유지 | 이전 leaf로 branch, hidden failure entry append, context rebuild; rollback 검증 실패 시 uncertain/read-only |
| compaction 취소 | polite 취소 status, danger alert 없음 | 이전 leaf로 branch, cancelled failure entry append, context rebuild |

VS Code window close 또는 extension deactivation에서는 다음 의미를 지킨다.

1. 해당 Extension Host client의 새 intent를 차단하고 panel subscription을 detach한다.
2. 해당 client의 AuthCoordinator credential projection을 Broker에서 제거한다.
3. 다른 client 또는 active run/queue/permission/recovery가 있으면 Broker, Core와 Pi Host를 유지한다.
4. 아무 client와 active work가 없고 idle grace가 끝난 경우에만 durable write를 drain하고 child를 bounded graceful shutdown한다.
5. 응답하지 않는 child를 강제 종료할 때는 unresolved evidence를 먼저 `uncertain`으로 남긴다.

종료 시 미완료 run을 다음 activation에서 자동 재전송하지 않는다.

## 9. 불변조건

- 하나의 `workspaceId + sessionId`에는 physical Pi Host writer와 mutation lease가 각각 최대 하나다.
- 하나의 session에는 session writer client가 최대 하나이며 다른 attached client는 observer다.
- Read-only open과 observer attach는 physical mutation lease나 Pi Host 생성을 요구하지 않는다.
- Mutation은 current client id, writer epoch와 command/draft revision을 모두 검증한 뒤에만 queue/Core/Pi Host로 전달한다.
- Panel/Webview lifecycle은 runtime cancellation authority가 아니다.
- 한 Pi Host는 lifetime 동안 하나의 immutable session/workspace binding만 사용한다.
- session A의 command, event, permission과 cursor가 session B projection에 적용되지 않는다.
- foreground 여부와 무관하게 accepted command의 settlement 또는 uncertainty를 기록한다.
- 실패하거나 취소된 compaction은 성공 marker를 만들지 않고 active context를 pre-attempt branch로 되돌린다.
- rollback 검증 전에는 새 prompt, edit, compaction 또는 queue dispatch를 허용하지 않는다.
- UI는 Core/Pi Host acknowledgement보다 먼저 `running`, `delivered` 또는 `completed`를 확정하지 않는다.
- child crash나 lease expiry 뒤 side effect가 불명확한 command를 자동 재전송하지 않는다.
- session catalog와 transcript가 reconnect 중이라는 이유로 마지막 확인 내용을 제거하지 않는다.
- visible Pi branch entry가 있는 cold-open session을 정상 empty transcript로 표시하지 않는다.
- historical projection은 provider/tool 실행 없이 동일 active branch에서 결정적으로 재생성된다.
- 새 session Fork는 source actor에서 직렬화하되 source runtime/active leaf를 교체하지 않으며, target은
  별도의 immutable actor와 mutation lease를 가진다.
- credential, raw provider payload, canonical path와 Pi SDK object는 Webview 경계를 넘지 않는다.
- Session 목록 snapshot, 검색과 running count는 현재 panel의 `workspaceId`에 속한 session만 포함한다.

## 10. 선택한 trade-off

한 Pi Host에서 여러 `AgentSession`을 Map으로 관리하는 방식은 process 수를 줄이지만 crash blast
radius, workspace permission 혼합과 SDK lifecycle 결합을 키우므로 채택하지 않는다. Panel Map에
runtime을 계속 보관하는 방식은 UI dispose와 run lifetime의 결합을 제거하지 못하므로 채택하지
않는다. 기존 `switchSession()` 기반 전환은 outgoing response를 abort하므로 동시 실행 경계로
사용하지 않는다.

세션별 child의 memory 비용은 bounded concurrent run budget, idle hibernation과 lazy start로
제어한다. 이 비용은 session isolation, 독립 recovery와 permission 경계의 명확성을 위해 수용한다.

## 11. 완료 판정

다음이 모두 관찰되면 이 설계의 구현을 완료한 것으로 판정한다.

- 서로 다른 두 session이 동시에 run 중이며 양쪽 event와 JSONL이 교차 오염되지 않는다.
- 실행 중인 session tab을 닫고 다른 session에서 작업해도 첫 run이 중단되지 않고 terminal 상태가 기록된다.
- background session을 다시 열면 duplicate runtime 없이 transcript, pending attention과 run 상태가 복원된다.
- Extension Host 재시작 또는 hibernate 뒤 기존 user/assistant/thinking/tool/compaction history가 새 prompt 없이 표시된다.
- 같은 active branch를 반복 cold open해도 stable transcript item id, 순서와 edit target mapping이 유지된다.
- 같은 active branch를 반복 cold open하거나 hibernate에서 복귀해도 각 durable assistant 응답의 Fork
  action이 같은 entry를 가리키며 compaction 이전 응답도 새 session으로 분기할 수 있다.
- JSONL이 손상되거나 projection 한도를 넘으면 정상 empty-state 대신 진단 가능한 open/reconnect 오류가 표시된다.
- compaction 실패 뒤 transcript와 model context가 시도 전 내용으로 유지되고, 재open 뒤에도 failure entry가 성공 marker로 표시되지 않는다.
- 현재 panel의 compaction 실패는 composer 위 inline alert로 즉시 보이고, 닫은 뒤에도 context control에서 정제된 원인을 확인할 수 있다.
- 같은 session을 두 VS Code window에서 열어도 duplicate Pi Host 없이 writer 한 명과 observer가 같은 snapshot/live 상태를 본다.
- idle/dormant에서 power control로 writer가 원자적으로 전환되고 이전 writer epoch의 mutation은 거부된다.
- active/queued/permission/recovery/external-owner에서는 power control이 접근 가능한 이유와 함께 비활성화된다.
- 외부 lease가 있는 기존 session도 일반 `실행 오류` 없이 read-only history를 연다.
- session 하나의 Pi Host crash가 다른 session run과 Extension Host를 중단하지 않는다.
- crash 시 전달 여부가 불명확한 prompt/tool을 자동 재전송하지 않는다.
- concurrency budget, permission timeout, hibernation과 deactivation이 durable queue/recovery 계약을 지킨다.
- resident host/replay/memory admission cap을 넘어 child나 event buffer가 무제한 증가하지 않는다.
- header의 session 목록에서 running indicator를 확인하고 session을 전환해도 기존 run이 중단되지 않는다.
