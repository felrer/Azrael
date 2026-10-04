# azrael-ex code map

이 문서는 `azrael-ex/`의 현재 구현을 기준으로 profile-scoped Session Broker, 세션별 Pi Host,
동시 실행, 프로젝트별 세션 목록과 Codex형 세션 관리 UI의 소유권을 기록한다. Pi JSONL은 계속
Pi SDK가 쓰는 원본이며 Core SQLite는 세션별 draft, 사용자 command queue, writer authority와
조회·상태 projection의 권위자다.
VS Code Webview state의 draft는 emergency 복구 후보일 뿐 영속 원본이 아니다.

## 런타임과 저장소 경계

- VS Code profile/global storage scope마다 version 2 Broker endpoint와 election endpoint가 하나씩
  결정된다. Windows에서는 user identity, canonical global storage path와 extension id를 hash한
  named pipe를 사용한다.
- 각 Extension Host는 `BrokerClient`, VS Code UI/API, `AuthCoordinator`와 `SecretCredentialStore`만
  소유한다. 별도 pinned Node `session-broker-child.js`가 `SessionHostServices`, `SessionRuntimeManager`,
  `GlobalRunScheduler`, Core supervisor와 모든 Pi Host supervisor를 소유한다.
- Broker 내부 Core는 pinned Node child 하나(`core`)로, writable live session은
  `piHost:<sha256(workspaceId, sessionId)>` child 하나로 실행된다. child executable은
  VSIX에 포함된 `dist/runtime/node.exe`다.
- 세션 identity는 항상 `workspaceId + sessionId`다. 열린 `ChatPanel`은 생성 시 받은
  `WorkspaceBinding`을 바꾸지 않으며 multi-root의 active editor 변경으로 다른 프로젝트
  목록에 자동 전환되지 않는다.
- Core DB는 `<globalStorageUri>/azrael-core.sqlite`다. `session_drafts`,
  `session_command_queue`, `session_writer_authority`의 identity도 `workspaceId + sessionId`로 고정된다.
  새 Pi session directory는 프로젝트와 session identity를 함께 hash한
  `<globalStorageUri>/sessions/<opaque-workspace-session-key>`이고,
  기존 설치의 `<sessionId>` directory가 있으면 제자리에서 계속 사용한다. Core는 Pi JSONL을 쓰지 않는다.
- panel 또는 Extension Host를 닫으면 해당 Broker attachment/client만 detach한다. 다른 client나
  retained work가 있으면 Broker와 actor/Pi Host는 유지된다. client가 없고 active/queued/permission/
  recovery work도 없는 상태가 idle grace를 지나면 Broker가 runtime manager, Pi Hosts와 Core를 순서대로
  종료한다. 영구 OS service는 아니다.

## 구현 소유권

| 영역 | 주요 경로 | 현재 책임 |
| --- | --- | --- |
| Activation/commands | `azrael-ex/src/extension/extension.ts` | Open/New/Open Session, TreeView, URI handler, auth command 등록과 deactivate 시 Broker client detach |
| Broker discovery/transport | `azrael-ex/src/extension/broker/scope.ts`, `BrokerLauncher.ts`, `BrokerClient.ts`, `BrokerServer.ts`, `FramedJsonSocket.ts`, `src/shared/broker-protocol.ts` | profile endpoint/election, protocol v2 hello/heartbeat, 1 MiB frame·4 MiB queue bound, request correlation, incompatible client 거부와 redacted diagnostics |
| Broker child/composition | `azrael-ex/src/children/session-broker-entry.ts`, `src/extension/broker/BrokerSessionHost.ts`, `BrokerSessionRouter.ts` | profile leader, attachment-client binding, allowlisted session RPC, retained-work 판단, Core/actor/scheduler/Pi Host 소유와 bounded safe shutdown |
| Extension projection | `azrael-ex/src/extension/services/ExtensionServices.ts`, `BrokerSessionServices.ts` | VS Code workspace/catalog/auth projection, Broker attach/manage, credential revision sync, panel별 `BrokerRuntimeUiPort` 조립 |
| Broker runtime proxy | `azrael-ex/src/extension/broker/BrokerRuntimeUiPort.ts` | Broker-owned actor를 `RuntimeUiPort`로 투영하고 session event/writer event 구독, writer transfer RPC, detach |
| Runtime composition | `azrael-ex/src/extension/services/SessionHostServices.ts` | Broker 안에서 Core/Pi Host supervisor, catalog/store/runtime manager, lease와 credential consumer 연결 |
| Pinned child lifecycle | `azrael-ex/src/extension/process/NodeChildSupervisor.ts`, `NodeChildProcessLauncher.ts` | ready/heartbeat/request timeout, stale instance fencing, graceful shutdown, 60초 안 3회 재시작 뒤 circuit-open |
| Core child/protocol | `azrael-ex/src/children/core-entry.ts`, `src/extension/core/` | allowlisted catalog/lease/runtime/draft/queue/recovery/writer 명령, writer epoch+session revision CAS, atomic submit-clear/Edit-to-draft, SQLite migration/checksum, WAL transaction |
| Core schema | `azrael-ex/migrations/001-initial.sql`–`005-session-writer-authority.sql` | session/runtime/physical lease projection, revisioned draft와 queue journal, nullable writer client 및 monotonic `writer_epoch`/`session_revision`; 기존 catalog row는 writer 미할당으로 backfill |
| Pi Host child | `azrael-ex/src/children/pi-host-entry.ts`, `src/extension/runtime/pi-host/` | immutable bootstrap, child-owned `LiveRuntimeUiPort`, credential sync/clear, allowlisted runtime RPC, command ID 중복 실행 방지, event/heartbeat |
| Parent Pi proxy | `azrael-ex/src/extension/runtime/PiHostRuntimeUiPort.ts`, `runtime/pi-host/transport.ts` | typed request/response, bootstrap/credential/workspace state 기억, idle child restart rehydrate와 snapshot 교체, interrupted mutation uncertainty 전달 |
| Actor/writer manager | `azrael-ex/src/extension/runtime/SessionRuntimeManager.ts`, `SessionActor.ts`, `WriterAuthority.ts`, `RuntimeAttachment.ts`, `GlobalRunScheduler.ts` | Broker 내 session actor 단일화, durable intake/FIFO pump, writer CAS와 mutation admission fence, transfer blocker, Core lifecycle, bounded replay |
| Read-only history | `azrael-ex/src/extension/runtime/ReadOnlySessionHistoryPort.ts`, `PiSessionHistoryHydrator.ts` | external physical owner/recovery 상태에서도 Pi AgentSession/Pi Host/lease 없이 기존 JSONL branch를 읽고 모든 mutation을 fail-closed |
| Pi runtime | `azrael-ex/src/extension/runtime/LiveRuntimeUiPort.ts` | Pi SessionManager/AgentSession, history-ready barrier, transcript projection, prompt/stop/permission/compaction transaction/inference/edit/rename; JSONL writer는 이 child 안에만 존재 |
| Persisted history projection | `azrael-ex/src/extension/runtime/PiSessionHistoryHydrator.ts`, `PiTranscriptProjector.ts` | 선택된 active branch를 read-only로 검증하고 message/tool/compaction을 stable item identity로 projection; edit mapping, compaction 이전 edit 차단, 미완료 tool uncertainty와 숨은 compaction failure metadata 복원 |
| JSONL catalog | `azrael-ex/src/extension/sessions/SessionCatalogService.ts` | session root를 bounded read-only scan하고 header `id/cwd`, tail name/first user text/updated time를 프로젝트 binding에 매핑; `globalState` cache/stale 표시 |
| UI state join | `azrael-ex/src/extension/sessions/SessionManagementStore.ts` | JSONL catalog, Core의 persisted runtime projection과 live actor projection 결합, workspace별 revision/subscription, 다른 workspace row 거부 |
| Panel authority/recovery | `azrael-ex/src/extension/sessions/SessionManagementController.ts`, `src/webview/recovery/ConnectionBanner.tsx` | immutable project scope, host-side filtering, mutation 검증, redacted recovery state와 explicit revisioned reconcile intent; Webview는 outcome/evidence를 선택하지 않음 |
| Native session list | `azrael-ex/src/extension/sessions/SessionsTreeProvider.ts` | 현재 선택된 한 `WorkspaceBinding`의 session만 표시하고 runtime/attention icon과 open command 제공 |
| Deep link | `azrael-ex/src/extension/sessions/SessionUriHandler.ts` | `vscode://azrael-ex-local.azrael-ex/session/open?...`의 exact route/query/opaque ID, trust, binding, catalog membership 재검증 |
| Host↔Webview | `azrael-ex/src/extension/chat/ChatPanel.ts`, `bridge/WebviewBridge.ts`, `src/shared/messages.ts` | project-bound controller, draft/queue/writer snapshot, `session.writer.transfer`와 authoritative `writer.changed`, correlated result 전달 |
| Composer/queue UI | `azrael-ex/src/webview/app/ChatApp.tsx`, `src/webview/composer/Composer.tsx`, `src/webview/styles/components.css`, `src/webview/queue/` | writer는 submit/stop, observer는 36×52 px radius 12 power control; available/transferring/blocked 접근성 상태, FIFO queue actions |
| Session chrome | `azrael-ex/src/webview/session-management/`, `src/webview/app/ChatApp.tsx` | Rename/Copy deeplink, 검색 가능한 최근 세션, queued count/running ring, 계정 메뉴, 새 세션 버튼; Archive/Share 미제공, Codex settings/shortcut 비활성화 |
| Transcript/terminal UI | `azrael-ex/src/webview/transcript/`, `src/webview/terminal/` | ordered transcript와 command group/item disclosure; 실행 상태나 bottom-follow와 무관하게 기본 접힘이며 사용자 toggle만 detail/output을 연다. 긴 command/output은 transcript 폭을 늘리지 않고 detail 내부에서 가로 스크롤한다 |
| Build/package | `azrael-ex/esbuild.mjs`, `.vscodeignore`, `scripts/` | extension/Webview/Pi runtime/Broker/Core/Pi Host/probe bundle, pinned Node와 migration 001–005 복사, VSIX audit/smoke |

## 프로세스와 이벤트 흐름

```text
VS Code command / URI / Tree row
  -> WorkspaceResolver + WorkspaceStateCatalog
  -> ExtensionServices.openSession(workspaceId, sessionId)
  -> ChatPanel (immutable WorkspaceBinding)
       -> BrokerSessionServices.attach()
       -> BrokerRuntimeUiPort
       -> protocol v2 session.attach over profile named pipe
       -> Session Broker / BrokerSessionRouter
            -> SessionHostServices / SessionRuntimeManager.openAuthenticated()
            -> one SessionActor + RuntimeAttachment per workspace/session
            -> safe read-only history port when physical lease is external/recovery-required
            `-> writable path only:
                 -> Core physical lease.acquire
                 -> NodeChildSupervisor -> pinned node.exe -> Pi Host
                 -> PiHostRuntimeUiPort bootstrap/credential/workspace sync
                 -> child LiveRuntimeUiPort -> Pi AgentSession -> JSONL

Broker actor event -> protocol v2 session.event -> BrokerRuntimeUiPort
                   -> ChatPanel/WebviewBridge -> current-project view state

Core writer projection -> WriterAuthority
  -> writer.changed -> BrokerSessionRouter -> protocol v2 writer.changed
  -> BrokerRuntimeUiPort -> SessionManagementController -> Webview

observer power click
  -> session.writer.transfer(expectedWriterEpoch, expectedSessionRevision)
  -> WebviewBridge -> BrokerRuntimeUiPort.transferWriter()
  -> SessionActor/WriterAuthority -> Core writer.transfer CAS
  -> authoritative writer.changed; response만으로 writer UI를 확정하지 않음

writer mutation
  -> Broker attachment의 authenticated clientId + cached writerEpoch
  -> WriterAuthority local check + Core writer.assert
  -> 통과한 요청만 durable Core queue 또는 Pi Host로 전달

Pi event -> Pi Host private protocol -> supervisor event -> PiHostRuntimeUiPort
         -> SessionActor bounded replay/state -> attached Webview + catalog runtime projection

Composer draft change
  -> local reducer + session-identified emergency Webview state
  -> debounced Core draft.save(expectedRevision)
  -> blur/detach/deactivate bounded flush

prompt/compact intake(commandId)
  -> Core queue.submit-and-clear-draft 또는 queue.command.enqueue [queued + journal]
  -> durable acknowledgement [started | queued]
  -> session actor FIFO pump + global run slot
  -> Core queue.claim under lease [delivered + journal]
  -> prompt: Pi submitWithCommandId / compact: latest context revision으로 compactContext
  -> terminal evidence -> Core queue.settle -> 다음 head pump

queued prompt Steer
  -> queued revision claim -> active run의 Pi AgentSession.steer(text)
  -> active run terminal evidence에서 settle

queued compact Steer
  -> 새 intake 잠금 -> active run stop/terminal/idle 확인
  -> 최신 context revision 조회 -> queued compact claim/dispatch

queued prompt Edit message
  -> Core queue.edit-to-draft(expected command/draft revisions)
  -> command cancelled + draft 저장을 한 transaction으로 commit -> Composer focus

activation
  -> queue.recovery.prepare가 expired/reconcile delivery만 uncertain으로 전이
  -> queue.recovery.list로 redacted queue 상태를 순수 조회
  -> Core catalog/runtime recovery read
  -> process-required old projection은 uncertain으로 복원
  -> never-delivered queued prompt/compact만 session FIFO pump로 재개
  -> delivered/ambiguous command는 uncertain, 자동 재전송 금지

Pi Host cold bootstrap
  -> LiveRuntimeUiPort.initialize()
  -> ensureHistoryReady() -> SessionManager.list/open|create -> getBranch()
  -> hydratePiSessionHistory()가 격리된 PiTranscriptProjector와 snapshot을 원자적으로 생성
  -> PiHostRpcServer.initializeRuntime()이 성공한 뒤에만 subscribe/heartbeat/bootstrap.ack
  -> 첫 getSnapshot은 이미 복원된 persisted transcript를 반환

same child warm snapshot
  -> getSnapshot() -> 완료된 history barrier와 현재 projector를 재사용
  -> live event는 동일 projector에 증분 반영; JSONL을 매 read마다 다시 scan하지 않음

idle Pi Host unexpected restart
  -> supervisor stale-instance fence + restart
  -> cached immutable bootstrap 재전송; 새 child가 persisted active branch를 cold hydrate
  -> latest credential + workspace state 재전송
  -> fresh getSnapshot -> snapshot.replace
  -> read request는 recovery 완료 뒤 재시도; interrupted mutation은 uncertain

panel dispose -> session.detach -> 해당 attachment만 detach
Extension Host deactivate -> 모든 local attachment detach + BrokerClient close
다른 client/retained work 존재 -> Broker/actor/Pi Host 유지
client 없음 + retained work 없음 + 30초 idle grace -> actor/runtime shutdown -> Pi Hosts fence/exit
  -> physical lease release -> Core shutdown -> named pipe close -> Broker exit
```

기본 동시 run 수는 3(설정 범위 1–8), resident host 수는 6(범위 3–12)이다. replay는
actor별 2,000 events 또는 2 MiB까지만 보존한다. cursor가 이 창보다 오래되면 reset이
필요하다는 신호를 내며 JSONL 자체를 replay buffer로 복제하지 않는다.
각 Pi Host heartbeat의 RSS가 512 MiB를 넘으면 진단을 기록하고, 관측 중인 live child RSS 합계가
1.5 GiB 이상이면 새 cold start를 거부한다. 이미 실행 중인 child는 이 기준만으로 종료하지 않는다.

history hydration은 `hydratePiSessionHistory()`가 branch의 연속 parent chain, 고유하고 bounded한
entry ID, timestamp, message/tool 관계와 최종 `TranscriptSnapshot` schema를 모두 통과한 뒤에만
새 projector를 commit한다. 따라서 malformed/oversized history는 정상 빈 transcript로 위장되지 않고
Pi Host bootstrap 자체가 실패한다. assistant content 순서는 원래 content index를 item identity에
포함해 보존하며, 결과가 없는 durable tool call은 `uncertain`으로 닫는다. 이 경로는 provider, tool,
`AgentSession`을 만들지 않고 선택된 branch와 projection만 읽는다.

## 세션 목록과 UI 데이터 규칙

- catalog scan은 Pi JSONL의 header와 최대 1 MiB tail만 읽으며 전체 transcript를 Webview에
  보내지 않는다. 기본 global read 한도는 64 MiB다.
- host는 `SessionManagementStore.snapshot(binding.workspaceId)`만 controller에 제공한다.
  Webview가 전체 catalog를 받은 뒤 client-side filter하는 구조가 아니다.
- 정렬은 `updatedAt DESC`, 동률이면 `sessionId ASC`다. running ring과 `runningCount`는
  현재 workspace에서 정확히 `runtimeState === 'running'`인 session만 센다.
- Rename은 1–128자 검증 뒤 Pi `setSessionName()`을 먼저 호출하고, 활성 lease와 revision을
  확인해 Core 및 host catalog를 갱신한다. title은 identity가 아니다.
- deeplink에는 opaque `workspaceId`, `sessionId`만 들어가며 path/title/prompt/credential은
  포함하지 않는다. URI open은 현재 window에 해당 binding이 있고 trusted이며 catalog에
  session이 있을 때만 허용한다.
- account label/plan은 auth가 제공한 값만 쓴다. 알 수 없는 email/plan을 credential에서
  추론하지 않는다.
- session catalog에는 content 없이 queued count만 합성한다. Prompt text가 포함된 `queue.list`는
  현재 panel의 정확한 workspace/session binding으로만 조회하며 다른 session event는 Webview에서 거부한다.
- Prompt queue item은 Steer, 삭제, Edit message를 제공한다. Compact item은 Steer와 삭제만 제공하며
  reorder와 `Turn off queuing`은 protocol/UI/settings에 없다.
- writer인 panel만 draft/submit/stop/inference/compaction/permission/rename/queue mutation을 수행한다.
  observer는 Composer 입력을 read-only로 두고 원형 submit 대신 36×52 px 세로형 power control을 본다.
- transfer는 actor가 idle/dormant이고 pending queue, permission, mutation, recovery가 없으며 physical
  lease가 안전할 때만 `available`이다. `transferring`과 `blocked`는 회색이며 `aria-disabled=true`,
  `aria-describedby`와 구체적 blocked label을 함께 제공한다.
- external physical owner가 감지되면 Pi Host나 두 번째 writer를 만들지 않는다. 기존 JSONL history는
  `ReadOnlySessionHistoryPort`로 표시하고 power control은 `external-owner`로 비활성화한다. 강제 unlock은 없다.
- migration 005는 기존 catalog session을 `writer_client_id=NULL`, epoch/revision 0으로 backfill한다.
  writer 전환 성공마다 epoch와 session revision을 함께 증가시키며, 이전 writer의 stale mutation은
  Core/Pi side effect 전에 거절한다.

## crash, durable queue와 recovery 안전 규칙

`NodeChildSupervisor`는 instance ID가 다른 늦은 event를 버리고 timeout/error child를
`SIGKILL`로 fence한 뒤 bounded restart한다. idle crash에서는 restart-aware transport가
bootstrap, 최신 credential/workspace state를 되살리고 fresh snapshot을 발행한다. 진행 중인
mutation이 있었다면 같은 recovery를 성공한 command settlement로 간주하지 않는다.

- lease TTL은 60초, renew는 20초다. renew 실패 시 해당 parent proxy는 즉시 write를
  fail-closed 한다.
- prompt와 compact intent는 Pi 호출 전에 Core `session_command_queue`에 저장되고
  claim/settle/cancel/uncertain 전이가 append-only journal에 남는다. current-session UI list만 queued
  prompt text를 반환하며 recovery/list projection은 content를 redaction한다. 실제 delivery payload는
  lease로 보호된 `queue.claim`에만 반환한다. `queue.recovery.list`는 상태를 바꾸지 않는 순수 redacted 조회이며,
  activation과 explicit recovery가 호출하는 `queue.recovery.prepare`만 expired/reconcile delivery를
  uncertain으로 전이한다. activation에서 `queued + safeToReplay`만 자동 재개한다.
- enqueue/claim/settle/cancel은 exact identity와 expected revision으로 idempotent하며 parent는 retryable
  commit/ack gap에서 같은 Core command를 한 번 재시도한다. `queue.mark-uncertain`은 기록된
  delivery owner/host와 요청 owner/host가 일치할 때만 허용한다.
- 이전 activation에서 `delivered`였던 submit은 `activation-recovery` uncertain으로 바뀐다.
  transport/host crash의 interrupted mutation도 uncertain이며 자동 재전송하지 않는다.
- queued prompt의 Edit message는 command cancel과 draft restore를 한 transaction에서 수행한다.
  nonempty/stale draft 또는 claim과의 CAS 경쟁에서는 queue item과 기존 draft를 모두 보존한다.
- Prompt Steer는 active run의 native `AgentSession.steer()`를 사용한다. Compact Steer만 현재 run을
  stop한 뒤 terminal/idle을 확인하고 최신 context revision으로 compaction을 시작한다.
- manual compaction은 `LiveRuntimeUiPort.compactContext()`가 pre-attempt leaf/context/branch digest와
  `PiTranscriptProjector.createCheckpoint()`를 잡은 뒤 실행한다. 성공은 새 compaction entry가 active
  branch에 실제 append된 경우에만 projector checkpoint를 commit한다. 실패/취소는 JSONL entry를
  삭제하거나 덮어쓰지 않고 `SessionManager.branch(preAttemptLeafId)`로 이전 branch를 다시 선택한 뒤
  `azrael-ex.compaction-failure.v1` custom entry를 append한다. 실패한 compaction entry는 append-only
  log에는 남아도 active branch와 transcript에서는 보이지 않는다. custom failure entry도 transcript
  item으로 노출하지 않고, schema를 통과한 bounded/redacted metadata만 재시작 뒤 context 오류로 복원한다.
- branch digest, rebuilt context digest 또는 projector checkpoint 복원을 검증하지 못하면
  `CompactionTransactionError(code='compaction-rollback-failed', outcome='rollback-failed')`로 승격한다.
  `PiHostRpcServer`와 protocol은 이 typed 결과를 보존하고, `PiHostRuntimeUiPort.mutationFence`는 이후
  mutation을 거부하되 `getSnapshot`/`getInferenceState`/`getContextState` read는 허용한다.
  `SessionHostServices.onUncertain`은 writable을 false로 만들고 `SessionRuntimeManager.fenceForRecovery()`를
  호출하므로 이를 rolled-back이나 writable 성공으로 보고하면 안 된다.
- compaction 도중 child transport가 중단된 경우에도 `PiHostRuntimeUiPort`가 pending method를 확인해
  `compaction-interrupted` mutation fence를 즉시 세운다. `SessionActor`의 direct-mutation barrier는
  compact/inference/rename과 submit/edit run이 겹치지 않게 하고, recovery fence는 진행 중 mutation,
  child 종료와 uncertain projection 저장까지 기다린다.
- actor runtime projection은 활성 lease 아래 `runtime.update`로 Core에 저장되고 activation 때
  store와 actor로 복원된다. 살아 있는 process가 필요했던 old state는 process가 없으므로
  uncertain으로 강등한다.
- 만료 lease 또는 uncertain command/session은 recovery projection에서 read-only로 보인다.
  recovery-required actor는 새 mutation을 거부하고 Webview composer도 send를 비활성화한다.
  UI의 revisioned **복구 상태 확인** intent는 outcome/evidence를 받지 않으며 host가 Core queue/lease와
  해당 Pi Host의 process evidence를 확인한다. explicit reconcile은 먼저 actor/runtime를 shutdown해
  현재 child를 fence하고 `stopped` 또는 `circuit-open`을 확인한다. uncertain command는 `aborted`로
  명시적으로 종결하고 `safe-to-acquire` evidence digest가 만들어질 때만 lease를 풀고 dormant로
  복원한다. 증거가 부족하거나 child가 남아 있으면 blocked를 유지한다.
- 자동 lease reconcile은 uncertain command가 없고 old runtime state가 live process evidence를
  요구하지 않으며 해당 child가 stopped인 경우에만 수행한다.
- 이 recovery는 Core dispatch/lease와 supervisor evidence를 다루며 Pi JSONL을 의미론적으로
  분석해 provider가 요청을 처리했는지 증명하지 않는다. 따라서 ambiguous delivered prompt는
  exactly-once 완료로 판정하거나 재전송하지 않는다.
- 현재 RSS admission은 heartbeat로 관측된 resident만 합산하는 보수적 cold-start gate이며 OS 전체
  memory pressure나 heartbeat 전 child를 측정하지 않는다.
- lease는 profile Broker가 띄운 Core DB coordination이다. 같은 profile의 VS Code window는 Broker를
  공유하지만 다른 앱/Pi CLI가 이 protocol과 Core lease에 참여한다고 간주하면 안 된다. 감지된 외부
  lease는 read-only/`external-owner`로 처리할 뿐 협력형 takeover를 제공하지 않는다.
- background 실행은 profile Broker child 생존 범위다. 모든 client가 닫혀도 retained work가 있으면
  즉시 종료하지 않지만, 영구 daemon/provider-side continuation은 아니다. 다음 Broker 시작에는
  never-delivered queued submit만 안전 경로로 재개하며 이미 전달됐거나 실행 중이던 turn은 재개하지 않는다.
- transcript의 기존 `edit-and-continue`는 queued prompt의 Edit message와 별도 기능이다. 전자는
  durable user message branch mutation이고, 후자는 아직 delivered되지 않은 queue item을 Core draft로 되돌린다.

실행·패키지·진단 절차는 [azrael-ex verification](../ops/azrael-ex-verification.md)을 따른다.

## 모델 응답 지점 새 세션 Fork

Fork의 public 진입점은 `src/webview/transcript/AssistantMessageActions.tsx`와
`src/shared/messages.ts`의 `session.fork.create`다. Webview는 `sourceEpoch`와 public
`itemId`만 전달하며 Pi entry id나 session 경로를 알지 못한다. 요청은
`WebviewBridge` → `SessionManagementController.forkAtResponse()` →
`ExtensionServices.forkSession()` → `SessionHostServices.forkAtResponse()` 순서로 이동한다.

`PiSessionHistoryHydrator`는 active branch를 복원하면서 마지막 visible assistant text item만
`forkEntryByItemId`에 연결한다. `LiveRuntimeUiPort`는 live `message_end` 직후가 아니라 Pi JSONL에
durable assistant entry가 실제 append된 뒤 같은 stable item identity로 Fork 가능 상태를 확정한다.
따라서 active branch에 남아 있는 한 최신 compaction 이전 응답도 cold open과 child restart 뒤 같은
Fork 지점을 유지한다.

실제 복제는 `LiveRuntimeUiPort.forkAtResponse()`가 active manager와 별개의 detached
`SessionManager`를 열어 `createBranchedSession()`을 호출한다. command별 staging manifest와 source
불변성/target prefix 검증을 거친 뒤 directory 전체를 동일 sessions root 안의
`sessionStorageIdentity.processKey(workspaceId, targetSessionId)` 위치로 rename한다.
`reconcileFork()`는 manifest와 이미 publish된 target 증거만 읽으며 같은 command를 다시 clone하지 않는다.

Core의 `003-session-fork-operations.sql`은 Fork operation과 append-only journal을 저장한다.
`fork.begin`, revision-CAS `fork.advance`, `fork.recovery.list`, `fork.resolve`가
`prepared → creating → published → registered → settled` 전이를 소유하며, 모호한 증거는
`reconciling`, publish가 없다고 증명된 경우만 `failed-safe`로 둔다. Core에는 message, public item,
Pi entry 또는 canonical path 원문을 저장하지 않는다.

target이 publish되면 `SessionCatalogService.reconcileSession()`이 legacy directory와 opaque
process-key directory를 모두 검증하고 기존 title/session-info 규칙으로 한 건을 등록한다. Core 등록과
manifest cleanup, operation settle 뒤에만 target panel을 연다. panel open 실패는 target을 삭제하지 않고
`created-open-failed`로 source panel에 알린다. source mutation은 기존 `SessionActor.mutate()`를 사용해
submit/edit/compact/다른 Fork와 직렬화하며 global model run slot을 소비하지 않는다.
