# 모델 응답 지점 새 세션 Fork 설계

- 상태: `ready` — 구현 방향 확정
- 결정일: 2026-09-04
- 적용 대상: azrael-ex VS Code Desktop extension
- 상위 설계: [azrael-ex 우선 2단계 전체 설계](azrael-ex-two-phase-system-design.md)
- 런타임 설계: [다중 세션 백그라운드 런타임](multi-session-background-runtime-design.md)
- 품질 계약: [azrael-ex 안정성 및 품질 계약](azrael-ex-stability-quality-contract.md)
- UI 계약: [azrael-ex UI/UX 디자인 지침](azrael-ex-ui-ux-design-guidelines.md)

## 1. 결정과 사용자 결과

완료되어 Pi JSONL에 기록된 각 모델 응답 아래에 `Fork` action을 제공한다. 사용자가 action을
실행하면 원본 session의 active branch 시작부터 선택한 모델 응답까지를 그대로 보존한 새 session을
만들고 즉시 연다. 원본 session의 active leaf, 파일 내용과 실행 상태는 바꾸지 않는다.

Fork는 과거 branch를 탐색하거나 원본 branch로 돌아가는 기능이 아니다. 새 session을 만든 뒤에는
기존 session과 새 session이 서로 독립적인 flat session으로 보인다. Pi header의 `parentSession`은
복구와 provenance에만 사용하며 Webview에 branch tree 또는 back-to-branch UI를 만들지 않는다.

이 기능은 다음 사용자 결과를 보장한다.

- 현재 응답뿐 아니라 cold open으로 복원한 과거 모델 응답에서도 새 session을 만들 수 있다.
- 선택한 응답이 최신 compaction보다 앞에 있어도 Fork할 수 있다.
- VS Code/Extension Host/Pi Host 재시작과 idle hibernate 뒤에도 같은 응답의 Fork action과 target이 유지된다.
- 성공 뒤 새 session을 자동으로 열지 못하더라도 생성된 session은 catalog에서 다시 열 수 있다.
- double-click, acknowledgement 손실 또는 crash recovery가 같은 Fork를 두 번 만들지 않는다.

## 2. 범위와 용어

### 2.1 Fork 지점

Fork 지점은 active branch에 있는 durable Pi `message` entry 중 role이 `assistant`이고 사용자에게
모델 응답으로 렌더링되는 entry다. streaming delta, 임시 projector item과 아직 JSONL에서 확인되지
않은 응답은 Fork 지점이 아니다.

하나의 assistant entry가 text/thinking/tool-call block 여러 개로 나뉘어도 Fork action은 한 번만
표시한다. 일반 응답에서는 마지막 visible assistant text block 아래에 둔다. text 없이 tool call만
포함한 중간 assistant entry는 사용자에게 하나의 독립 답변으로 취급하지 않으므로 action을 만들지
않는다. 이후의 durable visible assistant 응답이 Fork 지점이 된다.

### 2.2 새 session의 내용

새 session은 root부터 선택한 assistant entry까지의 parent chain과 그 chain에 붙은 유효 label을
복사한다. 선택한 응답을 포함하고 그 뒤의 user/tool/assistant/compaction entry는 포함하지 않는다.
draft, Webview disclosure/scroll, pending queue, permission, run state와 UI-only 오류는 복사하지 않는다.

복사한 transcript를 수정하거나 새 prompt를 자동 제출하지 않는다. title은 복사된 durable
`session_info` 또는 첫 user message에서 기존 catalog 규칙으로 계산하며 Fork를 이유로 hidden
message나 title entry를 덧붙이지 않는다.

### 2.3 명시적 비범위

- 원본 session 안에서 branch를 전환하는 tree/navigation UI
- 새 session에서 원본 branch로 돌아가는 action
- sibling branch 목록, merge 또는 rebase
- Fork 전에 prompt를 수정하는 draft 화면
- 실행 중이거나 durable entry가 없는 partial response의 Fork

기존 user-message edit-and-continue는 같은 session의 Pi branch를 바꾸는 별도 기능으로 유지한다.
이번 기능의 성공 경로와 복구 ledger를 공유하지 않는다.

## 3. Pi SDK 재사용 결정과 compaction 검토

현재 고정된 `@earendil-works/pi-coding-agent` 0.84.4의
`SessionManager.createBranchedSession(leafId)`는 지정 entry의 root-to-leaf chain으로 새 JSONL을
만들고 새 session id, 같은 cwd와 원본 파일을 가리키는 `parentSession` header를 기록한다. 따라서
새 파일 형식을 만들거나 transcript를 직접 직렬화하지 않고 이 primitive를 재사용한다.

`AgentSessionRuntime.fork(entryId, { position: 'at' })`는 내부적으로 같은 primitive를 사용하지만
현재 runtime을 새 session으로 교체한다. azrael-ex의 `workspaceId + sessionId` immutable actor binding과
원본 session 보존 조건에 맞지 않으므로 직접 호출하지 않는다. 원본 파일을 별도의 detached
`SessionManager`로 열고 `createBranchedSession(selectedAssistantEntryId)`만 호출한다. active source
manager에도 이 메서드를 호출하지 않는다. 메서드가 manager 자신의 session identity와 file state를
새 target으로 변경하기 때문이다.

Compaction과의 관계는 다음과 같이 확정한다.

| 선택 지점 | 새 session에 포함되는 내용 | 지원 여부 |
| --- | --- | --- |
| 최신 compaction 이전의 assistant 응답 | root부터 선택 응답까지. 뒤에 생긴 compaction과 이후 entry는 제외 | 지원 |
| compaction 이후의 assistant 응답 | 해당 compaction을 포함한 active ancestor chain부터 선택 응답까지 | 지원 |
| 현재 active branch에 없는 abandoned sibling | 화면에 Fork action을 노출하지 않음 | 비범위 |

Pi의 `getBranch(leafId)`는 compaction이 model context에서 오래된 message를 줄였는지와 관계없이 JSONL
parent chain을 읽는다. azrael-ex history hydration도 `agent.state.messages`가 아니라 현재 active
`SessionManager.getBranch()`에서 Fork mapping을 복원하므로 compaction 이전 응답을 선택할 수 있다.
이 결론은 SDK 고정 버전에 대한 실제 JSONL integration test로 release마다 유지한다.

## 4. 소유권과 신뢰 경계

```text
Webview Fork action
  -> Extension controller: session/epoch/item 검증, single-flight
  -> Core: durable fork operation과 idempotency 소유
  -> source SessionActor: 같은 session mutation과 직렬화
  -> source Pi Host: private item-to-entry mapping, detached clone, atomic publish
  -> SessionCatalogService: target 발견/등록
  -> ExtensionServices: target ChatPanel open/reveal
```

- Pi JSONL은 복사되는 transcript의 유일한 원본이다.
- Core SQLite는 Fork operation의 상태와 idempotency만 소유하며 message body를 저장하지 않는다.
- Pi Host만 Pi entry id와 canonical session path를 다룬다.
- Webview는 `sourceEpoch`, public `itemId`, `requestId`만 보내며 Pi entry id나 filesystem path를 받지 않는다.
- target은 source의 canonical workspace binding과 cwd를 그대로 상속한다. 다른 workspace로 Fork하는
  옵션은 없다.
- Fork는 source actor의 모델 실행 budget을 소비하지 않지만 submit/edit/compact/Fork와 동시에
  source JSONL을 관찰하거나 변경하지 않도록 actor의 session-operation lane에서 직렬화한다.

## 5. Public projection과 action 상태

History hydrator는 user edit mapping과 함께 `forkEntryByItemId`를 원자적으로 만든다. public item id는
durable assistant entry id를 namespaced SHA-256 opaque token으로 바꾼 뒤 content index와 결합해 결정적으로
파생한다. raw entry id는 private map에만 남는다. 선택된 public item은 해당
assistant entry의 마지막 Fork 가능한 visible block이며, mapping은 Pi Host 안에만 남는다.

Live projection은 `message_end`만으로 Fork 가능 상태를 확정하지 않는다. 종료된 assistant message가
active branch의 durable entry와 상관관계가 확인된 뒤에 stable item id/mapping을 commit한다. 확인 전
임시 streaming item에는 action을 표시하지 않는다. cold hydration과 live settlement가 같은 item id와
한 개의 action으로 수렴해야 한다.

public transcript item에는 entry id 대신 다음 최소 상태만 포함한다.

- `forkAvailable: true`: durable entry와 현재 active branch membership이 확인됨
- `forkState: idle | pending`: 동일 action의 재실행 방지와 progress 표시

Fork action은 hover/focus/message footer에서 `Fork` icon과 `새 세션으로 분기` accessible label로
노출한다. source가 running/compacting/editing/Fork 중이거나 recovery/read-only/untrusted 상태이면
action은 disabled되고 이유를 tooltip 및 screen reader text로 제공한다. 과거 응답이라는 이유만으로
disable하지 않는다.

## 6. Command와 durable operation 계약

Webview command는 `session.fork.create { requestId, sourceEpoch, itemId }`다. Extension은 현재 열린
workspace/session, epoch와 item을 다시 확인하고 내부 stable `commandId`를 발급한다. Pi Host 호출은
`forkAtResponse(expectedEpoch, itemId, commandId)`이며 성공 결과는 `targetSessionId`만 반환한다.

Core에는 `(workspaceId, sourceSessionId, commandId)`가 유일한 `session_fork_operation`을 저장한다.
같은 command id가 다른 요청에 재사용되는 것을 막기 위해 `sourceEpoch + itemId`의 digest와 target
session id/evidence digest만 보존하고 raw Pi entry id나 message body는 저장하지 않는다. 상태는 다음
단방향 흐름을 따른다.

```text
prepared -> creating -> published -> registered -> settled
                    \-> failed-safe
          published/registered acknowledgement 불명 -> reconciling
```

- `failed-safe`는 target publish가 없음을 확인한 경우에만 사용하며 같은 command를 안전하게 재시도할 수 있다.
- `reconciling`은 자동으로 새 Fork를 만들지 않는다. 기존 target evidence를 찾아 등록하거나 사용자에게
  진단 가능한 보류 상태를 보여준다.
- source session은 Fork 결과가 불명확하다는 이유만으로 transcript `uncertain`/read-only가 되지 않는다.
  source 파일은 변경되지 않기 때문이다. 불확실성은 해당 Fork operation에만 귀속한다.
- 한 source session에는 동시에 하나의 Fork operation만 실행한다. 같은 request/double-click은 기존
  operation 결과를 반환한다.

## 7. 파일 생성, 원자적 publish와 복구

target session id는 Pi primitive가 생성하므로 먼저 알 수 없다. source Pi Host는 최종 session 폴더에
직접 쓰지 않고 `sessions` root 아래 command-id 기반 staging directory에서 detached manager로 Fork를
만든다. 생성 뒤 다음을 검증한다.

1. source header/session id/cwd와 선택 entry의 active-branch membership이 요청 시점과 같다.
2. target id는 source와 다르고 target header의 cwd와 `parentSession`은 source를 정확히 가리킨다.
3. target branch는 source root부터 선택 assistant entry까지와 동일하고, SDK가 재구성한 label 외에는
   선택 뒤 conversational/compaction entry가 없다.
4. source JSONL byte digest와 active leaf가 작업 전후에 같다.

검증된 target directory는 같은 `sessions` root 안에서
`processKey(workspaceId, targetSessionId)` 최종 위치로 atomic rename한다. source/target/staging의
resolved path가 root 안에 있는지 확인하며 기존 final directory를 덮어쓰지 않는다.

staging directory와 `prepared` manifest를 먼저 durable하게 만든 뒤 SDK clone을 시작한다. manifest는
transcript가 아닌 bounded operation metadata로, `commandId`, source/target session id, target filename과
publish 단계, source file/leaf/선택 prefix digest만 가지며 prompt/message/path/raw entry id를 저장하지
않는다. target id가 생기면 unique temp-file replace로 manifest를 원자적으로 갱신한다. directory와 함께
이동하므로 다음 crash window를 복구할 수 있다.

- JSONL 생성 전 crash: target 없음으로 확정하고 `failed-safe`
- staging JSONL 생성 뒤 crash: manifest/유일 JSONL을 검증한 뒤 publish 재개
- publish 뒤 Core acknowledgement 전 crash: final directory의 manifest로 같은 target을 발견해 등록
- catalog 등록 뒤 panel open 실패: target을 유지하고 catalog에서 다시 열도록 안내
- manifest 또는 target이 둘 이상이어서 동일성을 증명할 수 없음: 자동 생성/삭제 없이 `reconciling`

target catalog와 Core 등록이 끝나 `registered`가 durable해진 뒤 manifest를 제거하고, 그 다음 Core를
`settled`로 전이한다. cleanup 도중 crash나 실패가 나면 operation은 nonterminal `registered`에 남아 다음
recovery가 같은 cleanup을 idempotent하게 재시도한다. 시작되지 않은 staging은 target 부재가 검증된
경우에만 정리한다. 이미 publish된 valid target JSONL은 UI open 실패나 cancellation을 이유로 삭제하지
않는다.

Idle hibernate는 unsettled Fork가 있으면 source Pi Host를 종료하지 않는다. Extension Host deactivation은
해당 Broker client만 detach하고, Broker shutdown 조건이 충족될 때 ledger를 먼저 flush한 뒤 bounded graceful
shutdown을 수행한다. 다음 Broker recovery의 catalog scan보다 먼저
미완료 Fork operation을 reconcile하여 생성된 target을 누락하거나 복제하지 않는다.

## 8. 사용자에게 보이는 결과와 실패

성공하면 action progress를 끝내고 새 target ChatPanel을 연다. source panel/history는 그대로 남는다.
target open만 실패하면 `새 세션은 생성되었습니다`와 catalog에서 여는 action을 제공하며 전체 작업을
실패로 가장하지 않는다.

검증 오류, stale item, active run과 trust revoke처럼 publish 전 실패는 해당 응답 footer에 짧은 오류를
표시하고 재시도를 허용한다. publish 여부가 불명확하면 `분기 생성 확인 중`으로 표시하고 자동 재실행을
막는다. global toast는 background recovery처럼 현재 panel에 local surface가 없을 때만 사용한다.

## 9. 불변조건

- Fork 성공 전후 source JSONL bytes와 active leaf는 같다.
- target JSONL은 선택 assistant entry를 포함하고 그 뒤 entry를 포함하지 않는다.
- 하나의 accepted command id는 target session을 최대 하나만 만든다.
- target이 publish된 뒤에는 panel open 실패나 acknowledgement 손실로 삭제하지 않는다.
- source와 target은 각각 별도의 immutable `workspaceId + sessionId` actor/lease를 가진다.
- cold open, hibernate 복귀와 child restart 뒤 같은 response item이 같은 Pi entry를 가리킨다.
- compaction 이전 response도 active JSONL branch에 남아 있으면 Fork 가능하다.
- Webview와 Core DB에 raw Pi entry id, canonical session path 또는 message body를 복제하지 않는다.
- Fork 때문에 branch-return/tree navigation UI를 추가하지 않는다.

## 10. 완료 판정

다음이 모두 관찰되어야 구현 완료다.

- 새 session과 과거 session의 각 durable visible assistant 응답에 action이 정확히 하나 나타난다.
- 선택 응답을 포함한 target이 열리고 source는 byte-for-byte 및 active leaf 기준으로 변하지 않는다.
- compaction 이전/이후 응답 양쪽에서 기대한 chain으로 Fork된다.
- source/target을 각각 재open해 독립 prompt를 실행해도 서로의 JSONL과 event가 오염되지 않는다.
- Webview reload, Pi Host crash, Extension Host restart와 idle hibernate의 각 crash window에서 target이
  유실되거나 중복 생성되지 않는다.
- stale/double-click/untrusted/running/recovery 상태가 잘못된 Fork를 만들지 않고 접근 가능한 이유를 표시한다.
- target panel open 실패 뒤에도 catalog에서 생성된 session을 발견하고 열 수 있다.
- 기존 edit-and-continue, session reopen, compaction rollback과 background run 계약이 회귀하지 않는다.
