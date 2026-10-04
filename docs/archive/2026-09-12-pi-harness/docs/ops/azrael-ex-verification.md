# azrael-ex development, verification, and recovery

이 문서는 `azrael-ex/`의 protocol v2 profile Session Broker, pinned Node child, Core SQLite,
session별 Pi Host, writer 전환과 프로젝트별 세션 UI를 검증하고 장애를 분류하는 절차다.
아래 명령은 별도 표기가 없으면 프로젝트 루트
`pi-harness-init/`에서 실행한다.

## 저장 위치와 런타임 전제

| 데이터/실행물 | 실제 위치 | 소유권 |
| --- | --- | --- |
| Broker endpoint | Windows `\\.\pipe\azrael-ex-<profile-scope-hash>`; election pipe는 `-election` suffix | profile-scoped Broker leader; 실제 hash/pipe명은 진단 bundle에 기록하지 않음 |
| Broker state | `<globalStorageUri>/broker-state.json` | Broker의 non-secret JSON state projection |
| Core DB | `<globalStorageUri>/azrael-core.sqlite`와 SQLite WAL/SHM | Broker-owned Core child; catalog/physical lease/writer authority, draft, queue projection |
| Pi sessions | 새 session은 `<globalStorageUri>/sessions/<opaque-workspace-session-key>/*.jsonl`; 기존 `<sessionId>` directory는 제자리 호환 | session별 Pi Host의 Pi SDK |
| Host catalog cache | VS Code `globalState`, key `azrael-ex.session.catalog.v1` | `SessionCatalogService` |
| Workspace binding | VS Code state의 `WorkspaceStateCatalog`; Broker에는 revisioned projection만 전달 | Extension Host |
| Pinned child Node | installed extension의 `dist/runtime/node.exe` | `node-win-x64@22.23.2` package asset |
| Child entry | `dist/children/session-broker-child.js`, `core-child.js`, `pi-host-child.js` | Extension Host가 Broker를 발견/기동하고 Broker가 Core/Pi Host를 감독 |

`globalStorageUri`의 절대 경로는 VS Code profile과 extension host 환경에 따라 달라진다.
경로를 추측하지 말고 실행 중 extension context 또는 진단으로 확인한다. JSONL과 SQLite를
실행 중 직접 편집하지 않는다. Core DB는 WAL, foreign keys, 5초 busy timeout,
`BEGIN IMMEDIATE` transaction을 사용한다.

Fork 생성 중에는 `<globalStorageUri>/sessions/.fork-staging/<source-process-key>/<command-id>/`에
bounded manifest와 target JSONL이 놓일 수 있다. 정상 흐름은 `prepared` manifest → detached SDK clone →
검증 → opaque target directory로 atomic publish → catalog/Core 등록 → manifest 제거 → settle 순서다.
source JSONL은 이 과정에서 수정되지 않아야 한다. final target은 panel open 또는 acknowledgement 실패를
이유로 삭제하지 않는다.

Core DB의 `session_fork_operations`와 `session_fork_journal`을 진단할 때는 command/state/revision,
target session id, digest와 error code만 확인한다. `prepared`, `creating`, `published`, `registered`는
activation recovery 대상이다. `reconciling`은 manifest/후보가 모호하므로 자동 clone 또는 cleanup을
실행하지 않는 보존 상태이며, `failed-safe`는 publish된 target이 없다고 증명된 경우에만 사용한다.
staging/final manifest를 수동으로 옮기거나 삭제하기 전에 Extension Host와 Pi Host를 종료하고 Core
ledger와 후보 개수를 함께 보존한다.

background는 panel 또는 한 Extension Host가 닫혀도 profile Broker가 다른 client나 retained work를
소유하는 동안 actor/Pi Host가 계속될 수 있다는 뜻이다. 마지막 client가 끊겼더라도 active/queued/
permission/recovery work가 있으면 즉시 종료하지 않는다. retained work가 없고 기본 30초 idle grace가
지나면 Broker가 `SessionRuntimeManager.shutdown()`을 기다려 Pi Hosts와 Core를 안전하게 종료한 뒤
named pipe를 닫고 끝난다. 영구 OS service/daemon은 아니다. 다음 Broker 시작에는 Core에 아직
`queued`인 never-delivered prompt/compact만 재개하며 `delivered` 또는 진행 중 turn은 uncertain으로
남기고 자동 재전송하지 않는다.

Named-pipe scope에는 Broker protocol generation이 포함된다. Protocol update 중에는 이전 Broker가 retained
work를 끝낼 수 있고 새 Broker는 별도 compatibility lane에서 시작한다. 두 generation은 같은 Core physical
lease를 관찰하므로 새 generation은 이전 owner가 보유한 session을 read-only로 열며 lease를 훔치거나 lock을
삭제하지 않는다. 같은 protocol generation의 extension update는 동일 Broker를 계속 공유한다.

## 설치와 build

```powershell
npm --prefix azrael-ex ci
npm --prefix azrael-ex run build
```

`build`는 extension, Webview, Pi ESM runtime, OpenAI Codex OAuth bundle, Session Broker child,
Core child, Pi Host child, process probe child를 만들고 pinned `node.exe`, `001-initial.sql`,
`002-prompt-queue.sql`, `003-session-fork-operations.sql`,
`004-session-drafts-command-queue.sql`, `005-session-writer-authority.sql`을 `dist/`에 복사한다.
production build는 먼저 `dist/`를 지워 stale
artifact가 VSIX에 남지 않게 한다.

F5 개발은 VS Code에서 `azrael-ex/`를 열고 **Run azrael-ex**를 사용한다. Extension
Development Host에서 **azrael-ex: Open Chat**을 실행한다. fixture는 설정
`azrael-ex.development=true`일 때 **Open UI Fixture**로만 연다.

## 자동 검증 순서

빠른 정적/단위 gate:

```powershell
npm --prefix azrael-ex run typecheck
npm --prefix azrael-ex run test:unit
```

Fork의 실제 Pi SDK branch semantics와 crash/reconcile fixture는 integration gate로 분리한다.

```powershell
npm --prefix azrael-ex run test:integration
```

Pi bundle과 packaged child bootstrap probe:

```powershell
npm --prefix azrael-ex run build
npm --prefix azrael-ex run test:bundle
npm --prefix azrael-ex run test:children
```

`test:children`은 `scripts/probe-child-runtime.mjs`를 실행한다. 먼저 packaged Broker의 protocol v2
hello/status, fixture `session.attach`/`session.call`/detach와 shutdown을 확인한다. 이어 임시 directory에서
packaged pinned Node로 fresh Core를 띄워 migration 005 writer table, draft save/get과 prompt/compact FIFO
command를 확인한다.
별도의 001–003 migration directory로 legacy DB와 prompt row를 만든 뒤 전체 migration directory로
재시작하여 원 command identity, payload digest/text, state와 ordinal이 보존되는지도 확인한다.
그 뒤 첫 Pi Host의 실제 session JSONL에
`probe-user`/`probe-assistant`를 미리 기록한다. bootstrap 직후 첫 `getSnapshot`이 stable item ID,
본문과 user editability를 복원하는지, history-only bootstrap이 fixture bytes를 바꾸지 않는지 확인한다.
그 뒤 서로 다른 두 Pi Host의 identity가 섞이지 않는 snapshot RPC와 graceful shutdown을 확인한다.
credential/provider model call은 하지 않는다.

Extension Host와 visual gate:

```powershell
npm --prefix azrael-ex run test:extension
npm --prefix azrael-ex run test:visual
```

`test:extension`은 build, Pi bundle probe, Broker/Core/Pi child probe를 다시 수행한 뒤 VS Code 1.134.0의
격리 user-data/extensions profile에서 activation과 extension journey를 검사한다.
`test:visual`은 Playwright fixture screenshot과 accessibility gate다. observer의 36×52 px power control,
available/blocked/transferring, zoom과 forced-colors도 검사한다. 실제 provider 호출, 두 live VS Code
window 사이의 writer 전환 또는 실제 background model run을 증명하지 않는다.

Command execution과 연속 command group은 running/completed/failed 상태와 transcript bottom-follow
여부에 관계없이 기본 접힘이어야 한다. 사용자가 summary를 눌렀을 때만 detail/output을 표시하고,
streaming output이나 status revision이 도착해도 사용자가 선택한 open/closed 상태를 바꾸지 않는다.
좁은 viewport에서 긴 단일 command/output을 펼쳐도 transcript viewport에는 가로 overflow가 생기지
않아야 하며, 줄바꿈하지 않는 내용의 가로 스크롤은 command/output `<pre>` 내부에만 남아야 한다.

한 번에 기본 자동 suite를 실행하려면:

```powershell
npm --prefix azrael-ex test
```

이는 typecheck + unit + extension이며 visual과 VSIX package/audit/smoke는 포함하지 않는다.

## 세션/child targeted unit gate

```powershell
npm --prefix azrael-ex exec -- vitest run `
  tests/unit/broker-transport.test.ts `
  tests/unit/broker-session-router.test.ts `
  tests/unit/core-client-writer.test.ts `
  tests/unit/read-only-session-history-port.test.ts `
  tests/unit/session-host-read-only.test.ts `
  tests/unit/chat-panel-writer-integration.test.ts `
  tests/unit/session-history-hydrator.test.ts `
  tests/unit/live-runtime.test.ts `
  tests/unit/node-child-supervisor.test.ts `
  tests/unit/core-client-store.test.ts `
  tests/unit/core-client-transport.test.ts `
  tests/unit/core-client-queue.test.ts `
  tests/unit/pi-host.test.ts `
  tests/unit/session-runtime-manager.test.ts `
  tests/unit/session-catalog.test.ts `
  tests/unit/session-management-controller.test.ts `
  tests/unit/session-management-reducer.test.ts `
  tests/unit/session-tree.test.ts `
  tests/unit/session-uri-handler.test.ts `
  tests/unit/webview-bridge-session-management.test.ts `
  tests/unit/composer.test.tsx `
  tests/unit/recovery-controls.test.tsx
```

세션 chrome component gate:

```powershell
npm --prefix azrael-ex exec -- vitest run `
  tests/unit/session-management-header.test.tsx `
  tests/unit/session-actions-menu.test.tsx `
  tests/unit/recent-sessions-popover.test.tsx
```

이 gate는 persisted active-branch hydration의 stable projection/atomic failure, cold bootstrap barrier,
warm snapshot, append-only compaction rollback과 hidden failure metadata, rollback-failed mutation fence,
durable queue/journal state machine, lease reconcile, Core runtime projection restore, Pi Host restart
rehydrate, interrupted mutation uncertainty, workspace별 catalog 격리, recovery intent, TreeView/URI
validation과 Webview reducer를 검사한다. 테스트를 실제 실행하지 않은 인계에서는
이 목록을 통과 결과로 기록하지 않는다. 이 gate는 protocol v2 framing/leader election/client binding,
migration 005 backfill/CAS, read-only history, stale former-writer fence와 power control을 포함한다.
통과하더라도 live provider가 ambiguous request를 처리했는지 판정하는 의미론적 evidence, 실제 두
VS Code window 왕복 또는 multi-app writer exclusion을 증명하지 않는다.

## 수동 Extension 확인

trusted local workspace에서 다음을 확인한다.

1. 서로 다른 session 두 개를 열고 각각 prompt를 시작한다. 설정된
   `azrael-ex.maxConcurrentRuns` 한도 안에서 독립 actor가 실행되고 초과 run은
   `waiting-slot`인지 확인한다.
2. 한 panel을 닫아도 그 session의 run이 중단되지 않고 TreeView/다른 panel의 project 목록에
   background 상태가 반영되는지 확인한다. VS Code 자체는 종료하지 않는다.
3. multi-root에서 project A panel의 최근 세션/search/running ring에 project B session이
   순간적으로도 나타나지 않는지 확인한다. active editor를 B로 바꿔도 열린 A panel scope는
   A로 유지되어야 한다.
4. 이름 변경 뒤 Pi JSONL에 session name entry가 append되고 header, Webview, TreeView title이
   수렴하는지 확인한다. stale revision 또는 lease 상실 상태에서는 write가 거부되어야 한다.
5. Copy deeplink 결과가 opaque ID 두 개만 포함하는지 확인하고, 같은 window에서 open한다.
   workspace 미존재/untrusted/catalog 불일치 link는 경고 후 거부되어야 한다.
6. account menu의 Codex settings와 keyboard shortcuts는 disabled이고 side effect가 없어야 한다.
   Archive/Share 메뉴는 없어야 한다.
7. 새 세션 버튼을 빠르게 두 번 눌러 durable catalog row가 하나만 생기는지 확인한다.
8. idle Pi Host를 강제 종료할 수 있는 개발 환경에서는 supervisor가 새 instance를 띄운 뒤
   immutable bootstrap, 최신 credential/workspace state와 snapshot을 복구하는지 확인한다.
   recovery 중 read는 완료 뒤 재시도되지만 interrupted mutation은 uncertain이며 같은 prompt가
   자동 재전송되지 않아야 한다.
9. 재시작 뒤 recovery banner가 `required`일 때만 **복구 상태 확인**이 활성화되는지 확인한다.
   composer와 actor의 새 mutation이 차단되어야 한다. explicit reconcile은 현재 actor/runtime를
   먼저 shutdown/fence하고 child가 stopped 또는 circuit-open이며 Core evidence가 안전할 때만
   dormant/writable로 수렴해야 한다. evidence가 부족하면 blocked/read-only를 유지한다.
10. provider 호출 없이 검증할 별도 persisted-history session을 만든다. Pi가 만든 정상 JSONL에
    user/assistant message를 남기고 Extension Host를 reload한 뒤 그 session을 연다. 첫 화면부터
    기존 user/assistant 순서와 내용이 보이고, 새 prompt를 보내기 전에는 JSONL bytes/entry 수가
    바뀌지 않는지 확인한다. compaction 이전 user message는 편집 불가, 최신 성공 compaction 이후
    user message만 편집 가능이어야 한다. malformed parent chain을 쓰는 개발 fixture에서는 빈 정상
    transcript 대신 bootstrap 오류가 나야 한다.
11. 수동 compaction 성공 시 separator가 한 번만 생기고 reload 뒤 같은 item identity/순서로
    복원되는지 확인한다. 개발 double로 compaction이 entry를 append한 뒤 실패하게 만들면 기존
    transcript와 agent context가 복원되고, active branch에는 실패한 compaction이 없지만 전체
    append-only entry 목록에는 남아 있어야 한다. active branch 마지막에는
    `azrael-ex.compaction-failure.v1` custom entry가 append되고 이 entry 자체는 transcript row로
    보이면 안 된다. 실패 시도마다 이 custom entry가 정확히 한 건만 생기며, 오류 detail에는
    path/URL/token 원문이 없어야 한다.
12. 개발 double로 rollback context digest 검증을 실패시킨다. UI 결과가
    `code=compaction-rollback-failed`, `outcome=rollback-failed` 의미를 유지하고 보존 성공을 주장하지
    않는지 확인한다. 같은 proxy에서 `getSnapshot`, `getInferenceState`, `getContextState`는 읽을 수
    있지만 submit/edit/compaction/rename 등 새 mutation은 거부되어야 한다. session은 uncertain
    recovery-required/read-only로 전이하고, 명시적 recovery evidence 없이는 writable로 돌아오지
    않아야 한다.
13. compaction request가 pending인 상태에서 Pi Host child를 중단한다. replacement child의 read
    snapshot은 복구될 수 있지만 session은 `compaction-interrupted` uncertainty로 fence되어야 하고,
    submit/edit/compaction/rename이 explicit reconciliation 전까지 거부되어야 한다.
14. session A/B 입력란에 서로 다른 draft를 작성하고 전환, panel reload, Extension Host reload를
    차례로 수행한다. 각 draft가 섞이지 않고 복원되는지 확인한다. submit을 거부하거나 Core
    acknowledgement 전에 실패시켰을 때 입력이 지워지면 안 된다.
15. active run 중 prompt 두 건과 `Compact context` 한 건을 순서대로 보낸다. 세 item이 Composer 위에
    FIFO로 표시되고, 앞 command의 terminal evidence 전에는 다음 Pi side effect가 시작되지 않으며,
    panel을 닫아도 자동 dispatch가 계속되는지 확인한다.
16. queued prompt에는 Steer, 삭제, overflow의 Edit message가 보이고 queued compact에는 Steer와
    삭제만 보이는지 확인한다. `Turn off queuing`, compact Edit message와 reorder UI는 없어야 한다.
    삭제 item은 실행되지 않고, Edit message 성공은 원문을 Composer로 복원하고 focus해야 한다.
    nonempty/stale draft 충돌에서는 queue card와 현재 draft가 모두 남아야 한다.
17. Prompt Steer가 active run을 abort하지 않고 native steer로 전달되는지 확인한다. Compact Steer는
    active run stop의 terminal/idle 확인 전 compact를 claim하지 않고, 확인 뒤 최신 context revision으로
    한 번만 compaction을 실행해야 한다. abort 실패/timeout이면 compact item은 queued로 유지한다.
18. 같은 profile의 VS Code window 두 개에서 같은 session을 연다. 두 panel 모두 history가 보이고
    하나만 writer인지 확인한다. idle observer의 36×52 px power control로 전환한 뒤 이전 writer의
    stale epoch mutation이 Core/Pi 전에 거절되는지 확인한다.
19. active run, queued command, pending permission/mutation, recovery 또는 external physical owner가 있는
    session은 power control이 회색/`aria-disabled=true`이고 구체적 사유를 읽을 수 있어야 한다.
    external owner 상태에서도 기존 JSONL history는 열리되 Pi Host 생성과 강제 unlock은 없어야 한다.
20. 한 window를 닫아도 다른 window/retained work가 유지되는지 확인한다. 마지막 client와 retained work가
    사라진 뒤 idle grace가 지나면 Broker, Pi Hosts와 Core가 bounded shutdown되고 다음 연결에서 새
    Broker epoch로 정상 기동하는지 확인한다.

실제 ChatGPT/provider 호출은 quota를 사용할 수 있으므로 사용자 opt-in과 로그인 상태가 있을
때만 수행한다. 기록에는 opaque workspace/session ID와 상태 전이만 남기고 prompt, response,
credential, 전체 canonical path를 복사하지 않는다.

## VSIX package, audit, smoke

```powershell
npm --prefix azrael-ex run package:vsix
npm --prefix azrael-ex run audit:vsix
npm --prefix azrael-ex run smoke:vsix
```

- `package:vsix`: clean production build, Pi bundle probe와 child probe 후 Windows x64 대상
  `azrael-ex/dist/azrael-ex.vsix` 생성.
- `audit:vsix`: release allowlist 밖 entry와 source/tests/node_modules/map/config/fixture를 차단하고
  extension/Webview/Pi runtime, Broker/Core/Pi Host child, pinned `node.exe`, migration 001–005와 icon 포함을 검사.
- `smoke:vsix`: VS Code 1.134.0의 임시 profile에 설치/list한 뒤 설치된 Pi runtime probe와
  Core/Pi Host child probe를 실행하고 임시 profile을 제거.

smoke는 설치본 Broker protocol v2 handshake/fixture attach, fresh/legacy-upgrade Core draft/queue RPC,
Pi Host bootstrap/RPC와 두 Pi Host identity 격리까지만 검사한다. packaged Webview
조작, 실제 model run, panel을 닫은 뒤 background completion, 강제 crash 뒤 transport rehydrate는
수동/단위 gate다.

기존 기본 VS Code profile에 승인 build를 갱신할 때:

```powershell
code --install-extension "C:\Users\felre\Desktop\pi-harness-init\azrael-ex\dist\azrael-ex.vsix" --force
code --list-extensions --show-versions | Select-String '^azrael-ex-local\.azrael-ex@'
```

열린 창에는 **Developer: Reload Window**가 필요하다. 자동 reload로 편집 상태를 방해하지
않는다. 다른 profile/Insiders를 대상으로 했다면 install과 list 양쪽에 같은 대상 옵션을 쓴다.

## lease와 crash 진단

정상 기본값:

- Broker client heartbeat: 5초, timeout: 15초
- Core/Pi Host heartbeat: 5초
- supervisor heartbeat timeout: 15초
- startup timeout: 10초, graceful shutdown timeout: 5초
- restart circuit: 60초 창 안 3회 실패 후 `circuit-open`
- mutation lease TTL: 60초, renew: 20초
- actor replay: 2,000 events 또는 2 MiB
- idle hibernate: 5분; resident host 기본 6, 범위 3–12
- concurrent run 기본 3, 범위 1–8
- Pi Host RSS 512 MiB 이상 diagnostic; 관측 live RSS 합계 1.5 GiB 이상에서 새 cold start 거부

진단 순서:

1. Output channel의 `[broker]`에서 protocol version, 연결/기동 여부와 client count를 먼저 확인한다.
   pipe name, client id, credential과 local path는 redaction되어야 한다. 이어 `[child]` line에서
   process key, timeout/restart/circuit 사유를 확인한다.
   prompt/output/path/credential을 로그에 덧붙이지 않는다.
2. process key가 `core`인지 `piHost:<opaque hash>`인지 구분한다. 동일 key의 새 instance가
   생기면 이전 instance event는 supervisor가 무시한다.
3. Core DB의 `mutation_leases`를 read-only로 확인할 때 owner/host/revision/expiry와
   `reconcile_required`만 기록한다. 실행 중 DB를 수정해 flag나 owner를 강제로 지우지 않는다.
4. Pi JSONL은 header의 `id`, `cwd`와 마지막 public entry만 read-only로 비교한다. credential,
   tool secret, prompt/response 원문은 diagnostic bundle에 넣지 않는다.
5. lease renew 실패 후 proxy는 write를 막는다. current-session `queue.list`만 queued prompt content를
   반환하고 catalog/recovery에는 count/metadata만 노출되는지 확인한다. `queue.recovery.list`는 redacted 상태를 순수 조회하며
   row를 변경하지 않는다. activation과 explicit recovery의 `queue.recovery.prepare`만 expired 또는
   reconcile-required lease에 delivery-owned prompt를 uncertain으로 전이한다. 이후 Core queue/lease
   projection과 supervisor process state를 읽는다. uncertain command가 없고 old state가 live process
   evidence를 요구하지 않으며 child가 stopped일 때만 자동 lease reconcile한다.
6. delivered command나 live-process-required old state는 recovery-required/read-only로 유지한다.
   actor는 새 mutation을 거부하고 composer도 send를 비활성화한다.
   UI reconcile은 revisioned intent일 뿐 outcome/evidence를 받지 않는다. host가 child stopped를
   확인하기 전에 현재 actor/runtime를 shutdown하여 child를 fence한다. uncertain command를
   `aborted`로 종결하고 `safe-to-acquire` digest를 Core에 기록할 수 있을 때만 dormant/writable로
   전환한다.
7. circuit-open 또는 `uncertain`/`crashed`를 자동 성공으로 판정하지 않는다. generic queue의 queued row 중
   `safeToReplay=true`만 재개하며 delivered/ambiguous mutation을 repeated retry하지 않는다.
8. idle child restart는 cached bootstrap/credential/workspace state를 재전송하고 fresh snapshot으로
   교체한다. 새 child의 `bootstrap.ack`는 persisted active branch hydration이 끝난 뒤에만 온다.
   이 과정에서 active non-read command ID가 잡히면 `host-crash` uncertainty journal을 남긴다.
   read request만 recovery와 fresh snapshot 완료 뒤 재시도된다.
9. enqueue/claim/settle/cancel의 retryable Core 오류는 동일 identity/revision command로 한 번 재시도되어
   commit/ack gap을 닫는다. journal row가 중복되거나 Pi mutation이 두 번 시작되면 안 된다.
   `mark-uncertain`은 원 delivery owner/host가 아니면 lease conflict로 거부되어야 한다.
10. `session_writer_authority`는 read-only로 확인한다. `writer_client_id`, `writer_epoch`,
    `session_revision`을 수동 변경하지 않는다. 같은 expected epoch/revision의 경쟁 transfer는 하나만
    성공하고 losing client는 최신 observer/`stale-state` view로 수렴해야 한다.
11. Broker protocol mismatch는 기존 Broker를 교체하거나 endpoint를 강탈하지 않고 client handshake를
    거부한다. 반복 재기동으로 우회하지 말고 설치본 extension/Broker version을 맞춘 뒤 window를 reload한다.

Core DB migration checksum mismatch나 open 실패에는 현재 자동 backup/restore 또는 read-only
fallback이 없다. DB/WAL/SHM을 보존하고 오류를 인계한 뒤 수정 전 별도 백업과 복구 계획을 세운다.

## 구현된 recovery 경계와 남은 제한

- migration 004의 revisioned `session_drafts`, generic `session_command_queue`와 append-only journal은
  prompt/compact의 enqueue → claim/delivered → settle/cancel/uncertain을 지속한다. migration 002의
  `prompt_queue`와 journal은 upgrade compatibility copy로 삭제하지 않는다. recovery 응답은 prompt
  text를 redaction하고 current-session UI list와 lease-protected claim만 필요한 text를 반환한다.
  `queue.recovery.list`는 순수 조회이고
  `queue.recovery.prepare`만 expired/reconcile delivery를 uncertain으로 materialize한다.
- migration 005의 `session_writer_authority`는 기존 session을 writer 미할당으로 backfill하고
  writer client/epoch/session revision CAS를 보존한다. session open 자체는 writer를 자동 취득하지 않는다.
- exact enqueue/claim/settle/cancel은 commit/ack gap의 동일-command retry를 허용하고,
  `mark-uncertain`은 delivery owner/host fence를 적용한다.
- draft save는 workspace/session identity와 expected revision CAS를 사용한다. submit acceptance는 queue
  insert와 draft clear를, Edit message는 queued prompt cancel과 draft restore를 각각 Core 한 transaction에서
  commit한다. stale/nonempty draft 충돌에서는 어느 쪽도 부분 적용하지 않는다.
- prompt와 compact는 같은 FIFO ledger를 사용하지만 Steer semantics가 다르다. Prompt Steer는 active
  Pi run의 native steer이며, Compact Steer는 active run abort settlement와 actor idle 뒤 최신 context로
  기존 compaction transaction을 실행한다.
- Core `runtime_projection`은 lease 아래 갱신되고 activation 때
  `SessionManagementStore.restorePersisted()`와 `SessionRuntimeManager.restore()`로 복원된다.
  이전 process가 필요했던 상태는 process가 없으면 uncertain으로 강등된다.
- recovery banner/controller는 redacted `required/reconciling/blocked`와 revision만 Webview에
  제공한다. recovery-required actor와 composer는 새 mutation을 차단한다. explicit reconcile은
  현재 child를 먼저 fence한다. raw lease owner, prompt, evidence digest와 outcome 선택은 host 밖으로
  나가지 않는다.
- restart-aware Pi Host transport는 idle crash 후 bootstrap, 최신 credential/workspace state와
  snapshot을 복구한다. interrupted mutation은 자동 재실행하지 않는다.
- `PiSessionHistoryHydrator`는 selected active branch만 읽어 stable transcript/edit mapping을 복원한다.
  `LiveRuntimeUiPort.initialize()`와 `PiHostRpcServer.initializeRuntime()`이 bootstrap acknowledgement
  앞에 history-ready barrier를 둔다. malformed/oversized projection은 bootstrap을 실패시키며 빈
  성공 snapshot으로 대체하지 않는다. warm `getSnapshot()`은 같은 projector를 재사용한다.
- manual compaction rollback은 append-only다. 실패 전 append된 compaction은 전체 log에 남지만
  이전 leaf로 branch한 active transcript에서는 숨겨지고, versioned custom failure entry 역시 UI row가
  아니라 bounded/redacted recovery metadata로만 사용된다. rollback 검증 실패는 typed
  `compaction-rollback-failed` uncertainty와 proxy mutation fence를 만들며 read RPC만 유지한다.

남은 제한은 다음과 같다.

- transcript의 기존 `edit-and-continue`는 queued prompt의 Edit message와 별도 branch mutation이며,
  이미 delivered/settled된 command를 Composer로 되돌리는 기능이 아니다.
- evidence reconcile은 Core queue/lease와 supervisor의 stopped state를 사용한다. Pi JSONL이나
  provider 측을 의미론적으로 조회해 delivered prompt의 실제 처리 여부를 증명하지 않는다.
- OS 전체 memory pressure와 아직 heartbeat가 없는 child까지 포함하는 정밀 memory budget은 없다.
- 다른 앱/Pi CLI와 공유하는 cross-app mutation lease는 아니다.
- 감지된 외부 owner에 대한 협력형 takeover나 강제 unlock은 없다.
- 실제 live provider를 사용하는 두-window E2E는 자동화되지 않았다.
- Broker에서 갱신된 OAuth credential이 Extension Host SecretStorage로 돌아오는 credential refresh
  round-trip E2E는 자동화되지 않았다. 현재 자동 테스트는 revision CAS와 in-memory projection 경계다.
- 영구 daemon/provider-side background continuation은 아니다.

따라서 durable queue, supervisor restart와 bounded replay가 있어도 ambiguous delivered prompt의
exactly-once 완료, provider-side crash-safe continuation 또는 cross-app single writer를 보장한다고
보고하지 않는다.

## cleanup

```powershell
npm --prefix azrael-ex run clean
```

`clean`은 `dist/`, `test-results/`, `playwright-report/`를 제거한다. source-controlled visual
baseline, `node_modules/`, `.vscode-test/`는 제거하지 않는다. Pi session JSONL, Core DB,
VS Code profile/global storage는 이 명령의 대상이 아니다.
