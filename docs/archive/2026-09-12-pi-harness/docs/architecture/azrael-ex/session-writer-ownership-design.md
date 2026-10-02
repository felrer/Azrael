# azrael-ex 세션 writer 소유권과 전환 설계

- 상태: `ready`
- 결정일: 2026-09-04
- 적용 대상: 기존 `azrael-ex/` VS Code Desktop extension
- 상위 설계: [다중 세션 백그라운드 런타임](multi-session-background-runtime-design.md)
- UI 계약: [Codex형 세션 관리 UI](session-management-ui-design.md)
- 품질 계약: [안정성 및 품질 계약](azrael-ex-stability-quality-contract.md)

## 1. 선택한 방향

별도 대체 제품을 만들지 않는다. 현재 `azrael-ex`의 Core, `SessionRuntimeManager`, `SessionActor`,
Pi Host, durable queue와 Webview composer를 확장해 여러 VS Code window가 같은 Pi session을 안전하게
열람하고 session writer 권한을 전환할 수 있게 한다.

다음 두 writer를 구분한다.

- **physical writer**: Pi `AgentSession`과 session JSONL writer를 소유하는 하나의 Pi Host. Profile-scoped
  Session Broker가 lifecycle과 mutation lease를 관리한다.
- **session writer**: 해당 session에 submit, steer, interrupt, compaction, permission response 같은 mutation
  intent를 보낼 수 있는 하나의 UI client. 사용자가 idle session에서 전환할 수 있다.

Writer 전환은 Pi Host나 JSONL writer를 복제·교체하는 기능이 아니다. 동일 Broker가 유지하는 physical
writer에 명령을 보낼 UI authority만 원자적으로 변경한다.

## 2. 사용자 결과

- 다른 window가 session writer여도 session 목록, transcript와 live 상태를 정상적으로 연다.
- Session을 선택하는 동작은 mutation lease 또는 session writer를 암묵적으로 획득하지 않는다.
- 현재 window가 writer이면 기존 원형 submit/stop control을 사용한다.
- 현재 window가 observer이면 submit 위치에 원형 제어권 control을 표시한다.
- Session이 안전하게 idle이면 제어권 control로 현재 window가 writer authority를 가져온다.
- 모델 실행, permission/approval 대기, queued dispatch, mutation, recovery 또는 외부 physical owner 때문에
  전환할 수 없으면 control이 회색으로 비활성화되고 이유를 표시한다.
- Writer 전환은 prompt를 전송하거나 durable draft를 소비하지 않는다.

## 3. Runtime topology

```text
VS Code window A / Extension Host ─┐
VS Code window B / Extension Host ─┼─ authenticated user-scoped named pipe
VS Code window C / Extension Host ─┘                 │
                                                     ▼
                                      azrael-ex Session Broker
                                      ├─ Core child / SQLite
                                      ├─ SessionRuntimeManager
                                      ├─ serialized SessionActor registry
                                      ├─ session writer authority + epoch
                                      ├─ durable command queue/recovery
                                      └─ session별 Pi Host child
                                             └─ Pi AgentSession + JSONL writer
```

Broker scope는 Windows user identity와 canonical azrael-ex storage/profile identity의 조합이다. Extension
Host는 기존 Broker endpoint를 먼저 발견하고 없을 때만 OS mutex leader election을 거쳐 Broker를 시작한다.
Lock file만으로 owner 생존을 판정하지 않는다.

Broker는 parent window와 분리된 process lifetime을 가지되 무기한 OS service는 아니다. 연결된 client,
active run, pending permission, queued command 또는 recovery 작업이 하나라도 있으면 유지한다. 모든 항목이
없고 idle grace가 지나면 Core/Pi Host를 순서 있게 종료하고 named pipe와 mutex를 해제한다.

## 4. 기존 owner의 재배치

| 기존 owner | 개편 뒤 책임 |
| --- | --- |
| `ExtensionServices` | VS Code command/panel/workspace/auth integration과 Broker client composition |
| `SessionHostServices` | VS Code 의존 부분과 Broker runtime 부분을 분리; 후자는 Broker process가 소유 |
| `CoreService`/`CoreStore` | Broker가 단독 lifecycle을 소유하고 catalog/draft/queue/lease 권위를 유지 |
| `SessionRuntimeManager`/`SessionActor` | Broker 안에서 profile 전체 client의 session actor를 단일화 |
| `NodeChildSupervisor` | Broker가 Core와 Pi Host child를 감시하도록 확장 |
| `RuntimeAttachment` | panel-local attachment가 아니라 Broker client subscription proxy로 전환 |
| `AuthCoordinator`/SecretStorage | Extension Host에 유지; Broker에 revisioned credential projection만 전달 |
| `ChatPanel`/`WebviewBridge` | observer/writer projection과 writer transfer intent를 전달 |

Pi SDK, `LiveRuntimeUiPort`, transcript projector, durable queue, compaction/Fork 의미론은 그대로 유지한다.
App Server로 backend를 교체하거나 별도 transcript database를 추가하지 않는다.

## 5. Read-only open

Session open은 다음 순서다.

1. Host가 current `WorkspaceBinding`과 catalog membership을 재검증한다.
2. Broker가 existing actor와 read-only history projection을 조회한다.
3. Existing actor가 있으면 authoritative snapshot과 event cursor에 observer로 attach한다.
4. Actor가 없거나 physical mutation lease를 얻을 수 없으면 provider/tool을 시작하지 않는 read-only history
   hydrator로 Pi active branch를 projection한다.
5. Writer acquisition이 가능한지 별도 `WriterControlView`로 표시한다.

Open 경로는 새 Pi Host writer를 요구하지 않는다. Transcript history를 읽는 동작과 `AgentSession`/JSONL
writer 생성은 분리한다. Header id/cwd, active branch chain, entry bound와 stable item identity 검증은 기존
`PiSessionHistoryHydrator` 계약을 재사용한다.

## 6. Session writer authority

Broker의 session actor는 다음 projection을 가진다.

```text
workspaceId, sessionId
runtimeState, activeRunId?, queuedCount, pendingPermission?
physicalLease: available | owned | external | uncertain
sessionWriterClientId?: opaque client id
writerEpoch: monotonic integer
writerTransferState: stable | transferring | blocked
sessionRevision: monotonic integer
```

불변조건은 다음과 같다.

- 한 `workspaceId + sessionId`의 physical Pi Host writer는 최대 하나다.
- 한 session의 session writer client는 0개 또는 1개다.
- 모든 mutation intent는 current client identity, writer epoch와 command/draft revision을 포함한다.
- Writer epoch가 바뀐 뒤 이전 writer의 mutation은 Core queue accept 또는 Pi Host dispatch 전에 거절한다.
- 같은 session의 mutation, permission response와 writer transfer는 같은 actor mailbox에서 직렬화한다.
- Session writer가 없어도 active run과 이미 accepted된 durable queue의 settlement는 Broker가 계속 소유한다.

Session writer authority는 Core의 physical mutation lease와 분리한다. Physical lease는 Broker/Pi Host가 JSONL
write를 할 수 있는지 나타내며, writer authority는 어느 UI client가 새 mutation을 제출할 수 있는지를 나타낸다.

## 7. Writer 전환

Writer transfer intent는 `workspaceId`, `sessionId`, `expectedWriterEpoch`, `expectedSessionRevision`을 포함한다.
Extension Host가 authenticated client id와 immutable panel binding을 붙이고 Broker actor가 다음 조건을 다시
확인한다.

- 요청 client가 현재 session writer가 아니다.
- Broker/Core/Pi Host coordination이 healthy다.
- Workspace Trust와 immutable workspace binding이 유효하다.
- runtime state가 정확히 `dormant` 또는 `idle`이다.
- `queuedCount`가 0이고 active run, waiting slot, permission, compaction, Fork, rename, steer, abort가 없다.
- delivery uncertainty, recovery fence 또는 다른 transfer가 진행 중이지 않다.
- Physical mutation lease를 Broker가 보유했거나 안전하게 획득할 수 있다.
- 외부 Pi/구버전 Extension Host owner가 살아 있거나 생존 여부가 불명확하지 않다.
- expected epoch와 revision이 최신이다.

성공 시 writer epoch를 증가시키고 요청 client를 session writer로 지정한다. 모든 subscriber에 같은
authoritative snapshot을 fanout하고 이전 writer는 observer가 된다. Core의 session-scoped durable draft는
그대로 유지되어 새 writer가 같은 revision에서 이어서 편집할 수 있지만 자동 전송하지 않는다.

동일 epoch의 동시 요청은 하나의 CAS만 성공한다. 패자는 최신 observer snapshot을 받으며 session이나
transcript를 failed로 만들지 않는다.

## 8. Writer control UI

`WriterControlView`는 다음 의미를 가진다.

```text
role: writer | observer
writerEpoch, sessionRevision
transferState: hidden | available | transferring | blocked
blockedReason?, blockedLabel?
```

Writer가 아닌 session에서는 기존 원형 submit control 위치를 다음 원형 제어권 control로 교체한다.

- visual box: submit/stop과 공유하는 지름 28 CSS px의 원형 버튼
- icon: 중앙의 세로선 하나를 SVG로 표시. Submit은 위를 향한 둥근 삼각형 SVG, stop은 원 지름의 약 1/3 크기인 둥근 사각형 SVG를 사용하며 stop 주위 spinner는 표시하지 않는다.
- `available`: 어두운 원형 배경과 흰색 아이콘. 강제 색상 모드에서는 시스템 색상을 사용한다.
- `transferring`: 같은 외형과 progress indicator, 중복 click 금지
- `blocked`: 회색 surface와 muted foreground
- 성공 뒤 authoritative writer snapshot을 받은 경우에만 기존 원형 submit control로 변경

Blocked control은 색에만 의존하지 않는다. Keyboard focus와 `aria-disabled=true`를 유지하고
`aria-label`/`aria-describedby` 또는 동등 tooltip으로 이유를 제공한다.

| Reason | 사용자 의미 |
| --- | --- |
| `run-active` | 모델 또는 tool 작업 중 |
| `permission-pending` | 사용자 결정 대기 중 |
| `queue-pending` | 전달 예정 command가 존재함 |
| `mutation-in-flight` | compaction/Fork/rename/steer/abort 진행 중 |
| `transfer-in-progress` | 다른 client의 writer 전환 처리 중 |
| `external-owner` | Broker 밖의 physical writer가 session을 사용 중 |
| `owner-uncertain` | 이전 owner의 생존 또는 delivery 결과 불명확 |
| `recovery-required` | session recovery fence가 필요함 |
| `workspace-untrusted` | Workspace Trust 또는 binding 불충족 |
| `connection-degraded` | Broker/Core/Pi Host coordination 불가 |
| `stale-state` | UI의 epoch/revision이 최신 상태와 다름 |

## 9. Credential과 permission

VS Code SecretStorage access는 Extension Host에 남긴다. Broker는 connected client 중 compatible auth
projection을 제공하는 host에서 revisioned credential을 받고 Pi Host consumer에 전달한다. Credential
원문은 Broker disk, Core SQLite, pipe endpoint metadata와 Webview에 저장하지 않는다.

Session writer는 permission 또는 Workspace Trust를 대체하지 않는다. Writer transfer 성공 뒤에도 submit,
permission response와 tool mutation마다 trust, binding, current writer epoch와 permission request identity를
다시 검증한다. Active permission request 중 writer transfer는 허용하지 않는다.

## 10. Crash, update와 외부 owner

- Extension Host/Webview disconnect는 active run을 중단하지 않는다. Active 상태에서는 writer를 다른 client로
  넘기지 않고 terminal 뒤 unassigned 또는 eligible 상태로 만든다.
- Writer transfer response 전 disconnect는 성공으로 추정하지 않는다. Reconnect snapshot의 writer epoch로
  결과를 재조정한다.
- Compatible extension update/reload는 기존 Broker에 reconnect하고 새 Core/Pi Host writer를 만들지 않는다.
- Broker protocol이 incompatible하면 기존 Broker를 quiesce한다. Active/queued/permission/recovery가 모두
  끝나기 전 강제 교체하지 않는다.
- Broker 밖의 Pi CLI, Electron app 또는 legacy Extension Host가 physical writer이면 read-only open은
  유지하지만 제어권 control을 `external-owner`로 비활성화한다.
- Lock file 삭제, process kill 또는 expiry 단독 판정으로 physical lease를 훔치지 않는다.

## 11. 선택한 trade-off

- 기존 actor, Core queue/lease와 Pi Host를 Broker로 승격하는 비용을 수용한다. 별도 extension이나 App Server
  backend를 추가하는 것보다 기존 session, UI와 test 자산을 보존한다.
- Broker는 window lifecycle보다 길 수 있지만 무기한 service는 아니다. Profile 전체 writer 단일성과 active
  work 보존을 위해 필요한 최소 process lifetime이다.
- Observer마다 별도 draft를 만들지 않고 기존 session-scoped Core draft를 유지한다. Writer 전환 뒤 작업을
  자연스럽게 이어가며 draft 권위가 둘로 갈라지는 것을 막는다.
- 비협력 외부 owner를 자동 takeover하지 않는다. 즉시 실행 편의보다 JSONL과 side effect 안전성을 우선한다.

## 12. 완료 판정

- 같은 session을 두 VS Code window에서 열면 하나의 writer와 하나의 observer가 같은 history/live 상태를 본다.
- Session open은 두 번째 Pi Host writer를 만들거나 `실행 오류`로 실패하지 않는다.
- Idle/dormant session의 제어권 control로 writer가 한 번만 전환되고 이전 epoch mutation은 dispatch되지 않는다.
- Active/queued/permission/recovery/external-owner 상태에서는 control이 회색 비활성화되고 접근 가능한 이유가 있다.
- Writer 전환만으로 prompt가 전송되거나 durable draft가 소비되지 않는다.
- Extension reload/update와 Broker reconnect 뒤 Pi Host physical writer가 중복되지 않는다.
- Broker crash 또는 ambiguous transfer 뒤 자동 mutation replay가 없다.
