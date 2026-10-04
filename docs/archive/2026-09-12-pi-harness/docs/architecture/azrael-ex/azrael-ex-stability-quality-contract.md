# azrael-ex 안정성 및 품질 계약

- 상태: `ready` — 1차 제품의 규범적 안정성 계약
- 기준일: 2026-09-03
- 최근 개정: 2026-09-04 — profile Session Broker와 session writer 전환 품질 계약 추가
- 적용 대상: VS Code extension host, profile Session Broker, Core child, Pi Host child, Webview와 이들 사이의 protocol
- 상위 설계: [azrael-ex 우선 2단계 전체 설계](azrael-ex-two-phase-system-design.md)
- 동급 UI 계약: [azrael-ex UI/UX 디자인 지침](azrael-ex-ui-ux-design-guidelines.md)
- Writer 계약: [세션 Writer 소유권과 전환](session-writer-ownership-design.md)

안정성은 backend 내부 속성이 아니라 사용자가 보는 UI 동작이다. session이 복구 가능해도 draft가 사라지거나 scroll이 튀거나 전송 상태가 거짓이면 안정적인 제품이 아니다. 이 문서는 데이터 안전, process 격리, 상태 정확성, 반응성 및 복구 경험을 하나의 release contract로 묶는다.

## 1. 품질 우선순위

충돌이 생기면 다음 순서로 판단한다.

1. credential, workspace와 사용자 데이터 보호
2. 외부 side effect의 중복 방지와 상태 진실성
3. session, draft, queue와 transcript 복구 가능성
4. extension host 및 VS Code 작업의 지속성
5. 명확하고 방해가 적은 복구 UX
6. latency와 resource 효율
7. reference visual fidelity와 장식적 polish

UI는 실제 owner가 확인하지 않은 성공을 만들어내지 않는다. 자동 복구는 안전을 증명할 수 있을 때만 편의보다 우선한다.

## 2. 안정성 불변조건

- Pi JSONL만 transcript의 원본이다.
- Webview memory, React state와 DOM은 durable owner가 아니다.
- Pi Host crash가 VS Code extension host crash로 전파되지 않는다.
- Core/Pi Host restart가 열린 source editor, diff와 user draft를 불필요하게 닫지 않는다.
- 실패하거나 취소된 compaction은 성공 transcript marker나 변경된 model context를 남기지 않는다.
- compaction rollback 검증이 실패하면 session은 정상 상태로 가장하지 않고 `uncertain`/read-only가 된다.
- command는 stable id와 correlation id를 가지며 owner acknowledgement 없이 완료가 아니다.
- accepted/delivered/side-effect 여부가 불명확하면 자동 재전송하지 않는다.
- response Fork는 source JSONL과 active leaf를 바꾸지 않으며 accepted command 하나당 target session을
  최대 하나만 publish한다.
- Fork target publish 여부가 불명확하면 새 target을 자동 생성하지 않고 durable operation evidence를
  reconcile한다. 이미 publish된 valid target은 UI open 실패를 이유로 삭제하지 않는다.
- event replay와 reconnect는 같은 logical event를 두 번 적용하지 않는다.
- permission은 요청 당시의 workspace, tool input digest와 policy revision에 묶인다.
- session의 canonical workspace binding은 생성 후 불변이며 active editor 변화로 바뀌지 않는다.
- session cwd, relative file root와 workspace permission scope가 서로 다른 binding을 가리키면 실행하지 않는다.
- stale UI가 permission, queue mutation 또는 undo authority가 되지 않는다.
- panel/session dispose가 extension 전역 login/refresh/logout operation을 임의 취소하지 않는다.
- panel/Webview dispose는 session actor, active run 또는 다른 session을 임의 취소하지 않는다.
- 서로 다른 session의 command, event, permission, cursor와 crash scope가 섞이지 않는다.
- 하나의 Pi JSONL session에는 physical writer/Pi Host가 최대 하나이고 session writer client도 최대 하나다.
- Session open은 writer authority나 mutation lease를 요구하지 않으며 외부 owner가 있어도 안전한 read-only history를 제공한다.
- Active run, pending queue/permission/mutation/recovery 중 writer를 전환하지 않고 stale writer epoch mutation을 durable acceptance 전에 거절한다.
- last confirmed content는 reconnect/loading 동안 화면에서 제거하지 않는다.
- cold open의 ready snapshot은 Pi active branch hydration 뒤에만 발행하며, visible durable entry가
  있으면 정상 empty transcript가 될 수 없다.
- 정상 실패는 진단 가능해야 하며 secret이나 hidden reasoning은 진단 자료에 포함하지 않는다.

ChatGPT OAuth credential은 login 완료 시점뿐 아니라 Pi provider가 자동 refresh하는 모든
회전에 대해 revisioned SecretStorage acknowledgement를 받아야 한다. acknowledgement를 받지
못한 새 token을 durable하다고 표시하거나 평문 저장소에 fallback하지 않는다.

## 3. 권위와 consistency 계약

| 영역 | authoritative owner | UI가 표시할 수 있는 임시 상태 | conflict 원칙 |
| --- | --- | --- | --- |
| transcript | Pi JSONL / Pi SDK | streaming projection | 재scan 후 stable item id로 수렴 |
| session catalog | Core projection | loading/reconnecting | 마지막 확인 목록 유지 |
| workspace binding | Extension host + Core workspace identity | unavailable/revalidating | 현재 VS Code folder membership과 canonical identity가 모두 일치해야 실행 |
| prompt dispatch | Pi Host evidence | queued/sending | 증거 없으면 `uncertain` |
| session writer | Session Broker writer epoch | transferring | expected epoch/session revision 불일치 시 observer snapshot으로 수렴 |
| queue | Core durable store | local edit preview | expected revision 실패 시 입력 보존 |
| draft | Core durable store | unacknowledged local text | 양쪽 revision을 보존해 선택 제공 |
| run/tool | Pi Host event ledger | coalesced progress | replay dedupe 후 settlement 확인 |
| permission | Permission manager | pending choice | digest/revision 불일치 시 stale |
| workspace trust | VS Code | checking | trusted를 낙관하지 않음 |
| credential | VS Code SecretStorage/broker | configured label | value는 Webview에 보내지 않음 |
| file change review | filesystem + operation record | summary projection | VS Code diff에서 현재 상태 재확인 |

각 projection은 최소 `schemaVersion`, `revision`, `generatedAt`, `sourceEpoch`를 가진다. process가 재시작되면 epoch가 바뀌며 이전 epoch의 live event는 적용하지 않는다.

## 4. Lifecycle과 failure isolation

### 4.1 Extension activation

- extension은 관련 command/view/session을 실제로 사용할 때 lazy activate한다.
- activation은 database migration, Pi SDK load와 child warm-up을 동기식으로 기다리지 않는다.
- activation 실패는 OutputChannel과 한 개의 actionable error로 귀결되며 VS Code의 다른 editor를 방해하지 않는다.
- partial registration이 생기면 command는 명시적인 unavailable reason을 반환하고 silent no-op을 하지 않는다.

### 4.2 Child process

- Session Broker, Core와 Pi Host는 역할별 별도 process이며 heartbeat와 exit reason을 관찰한다.
- Broker는 profile당 하나이고 write 가능한 각 session은 독립 Pi Host child와 mutation lease를 가지며 한 child failure는 다른 session run으로 전파되지 않는다.
- child start는 timeout, bounded retry와 cancellation을 가진다.
- 반복 crash는 무한 restart loop로 이어지지 않고 circuit-open 상태와 diagnostics action으로 전환한다.
- active run이 없는 Webview reload는 child restart 원인이 아니다.
- extension deactivation은 해당 client를 detach한다. 다른 client나 active work가 없을 때만 Broker가 in-flight durable write를 bounded drain한 뒤 child를 종료한다.

### 4.3 Webview

- Webview는 typed snapshot + ordered event로 재구성 가능해야 한다.
- cold open/hibernate 복귀/Pi Host 재시작은 exact JSONL header id/cwd 검증과 active branch의
  atomic transcript projection을 마친 뒤에만 runtime을 ready로 표시한다.
- reload/dispose 뒤에도 session과 active run owner는 profile Session Broker에 남는다.
- panel close는 UI consumer만 detach하며 background completion과 attention은 session catalog 및 VS Code notification surface로 전달한다.
- malformed 또는 unknown message는 무시만 하지 않고 redacted diagnostic counter를 남긴다.
- Webview crash는 secret, raw provider payload나 file authority를 잃거나 노출시키지 않는다.
- serialize/restore 실패 시 빈 정상 화면으로 가장하지 않고 recovery surface를 표시한다.

### 4.4 Workspace 변경

- active editor 변화는 새 session folder 선택에만 영향을 주며 열린 session을 rebind하지 않는다.
- binding된 folder가 window에서 제거되면 해당 session의 새 prompt, permission allow와 relative
  file action을 차단한다.
- folder 제거 또는 trust 해제 중 active run의 전달/side effect가 불명확하면 자동 재전송하지
  않고 `uncertain` 또는 `needs-attention`으로 남긴다.
- restore는 persisted `workspaceId + sessionId`를 현재 folder URI, filesystem realpath와 Core
  identity에 다시 대조한다. 불일치하면 새 session을 자동 생성하거나 다른 root에 붙이지 않는다.
- multi-root 선택 취소와 unsupported virtual workspace는 mutation 없는 명시적 failure다.

## 5. Command와 event delivery

### 5.1 Command 상태

```text
created → queued → accepted → delivered → settled
                  ↘ rejected
                  ↘ uncertain
```

- `accepted`는 owner가 command와 idempotency key를 기록했음을 뜻한다.
- `delivered`는 Pi session이 command를 수신했다는 증거가 있을 때만 쓴다.
- `settled`는 run 또는 mutation의 terminal result다.
- transport timeout은 자동으로 `rejected`가 아니다. 증거를 확인할 수 없으면 `uncertain`이다.
- 사용자가 resend할 때 새 command id를 만들되 original uncertain command와 관계를 기록한다.

### 5.2 Event ordering

- event는 session/run/item stream별 monotonic sequence를 가진다.
- gap을 발견하면 이후 event를 무조건 적용하지 않고 snapshot/replay로 보충한다.
- duplicate는 stable event id로 제거한다.
- terminal event 뒤의 late progress는 UI state를 되돌리지 않는다.
- schema를 모르는 event는 current state를 파괴하지 않고 protocol incompatibility로 승격한다.

### 5.3 Backpressure

- token delta와 tool progress는 의미를 잃지 않는 범위에서 coalesce한다.
- terminal result, permission, error와 user-visible boundary event는 drop하지 않는다.
- Webview가 느리면 bounded queue 뒤에 fresh snapshot으로 수렴하며 무제한 memory buffer를 만들지 않는다.
- transcript page와 tool output은 byte/line/item limit 및 truncation marker를 가진다.

## 6. Draft, queue와 composer 내구성

### 6.1 Draft

- draft는 session별이며 debounce 저장과 blur/window close의 bounded flush를 모두 사용한다.
- UI는 owner acknowledgement revision을 받은 뒤에만 `saved`로 간주한다.
- Webview가 종료되어도 마지막 acknowledged revision은 복구된다.
- acknowledgement 전 local text는 재생성 가능한 emergency snapshot으로 보존하되 durable saved와 구분한다.
- 두 window 또는 restore path가 충돌하면 last-write-wins로 숨기지 않고 두 revision을 보존한다.
- IME composition 중인 text를 중간 revision으로 전송하거나 submit하지 않는다.

### 6.2 Queue

- queue item은 stable id, ordinal, kind, expected revision과 dispatch evidence를 가진다.
- reorder/edit/cancel은 compare-and-swap 방식으로 stale mutation을 거절한다.
- abort는 active run, undelivered queue, delivered-but-unsettled item을 분리해 표시한다.
- reconnect 후 pending item을 자동 dispatch하려면 이전에 전달되지 않았다는 durable evidence가 필요하다.

### 6.3 Composer UX

- connection이 끊겨도 draft editor는 계속 입력 가능해야 한다.
- 전송 불가 이유는 send control 가까이에 표시한다.
- send double-click, key repeat와 Webview duplicate message는 같은 command로 dedupe한다.
- submit 실패는 입력을 지우지 않는다.
- 성공적인 acceptance 전에는 composer를 비우지 않거나, 비운 경우 즉시 복원 가능한 local transaction을 유지한다.
- Writer는 기존 원형 submit/stop control을 사용하고 observer는 같은 위치의 36×52px 세로형 power control을 사용한다.
- Writer 전환 불가 control은 회색과 `aria-disabled=true`만이 아니라 접근 가능한 구체적 사유를 제공한다.
- Writer transfer는 draft를 지우거나 prompt를 submit하지 않으며 authoritative epoch snapshot 전에는 UI role 성공을 확정하지 않는다.

## 7. Session, transcript와 scroll 복구

- session을 여는 동안 마지막 확인된 catalog/transcript가 있으면 유지하고 skeleton으로 교체하지 않는다.
- reconnect는 `연결 중`, `복구 확인 중`, `복구됨`, `사용자 판단 필요`를 구분한다.
- snapshot 적용은 stable item id를 기준으로 merge하며 전체 DOM 교체를 피한다.
- session별 마지막 visible item id와 offset, bottom-follow 여부를 보존한다.
- streaming 중 과거를 읽는 사용자를 강제로 bottom으로 이동하지 않는다.
- pagination 앞쪽 삽입, code highlighting, image/tool disclosure로 row 높이가 변해도 anchor를 보정한다.
- unread marker는 사용자가 실제로 본 settlement boundary를 기준으로 이동한다.
- compaction marker가 있어도 이전/이후 transcript의 시간 및 순서 관계를 잃지 않는다.
- compaction marker는 성공한 compaction에만 대응한다. 실패/취소는 transcript row를 추가하지 않고
  pre-attempt visible transcript와 projector snapshot을 유지한다.
- history hydration은 `agent.state.messages`가 아니라 Pi `SessionManager.getBranch()`를 사용해
  compaction 전 visible history와 현재 leaf의 branch 관계를 보존한다.
- historical item id는 durable Pi entry/tool-call identity에서 결정적으로 파생하고 재open 뒤에도
  user-message edit target과 scroll anchor가 같은 logical item을 가리킨다.
- historical assistant response의 Fork target mapping도 Pi active branch에서 결정적으로 복원하며
  Webview reload, Pi Host 재시작과 hibernate 뒤 같은 logical response를 가리킨다.

## 8. Permission과 side-effect 안전성

- permission request는 request id 외에 canonical workspace id, tool category, normalized target, input digest와 expiry를 포함한다.
- UI decision은 현재 pending request와 digest가 일치할 때만 적용한다.
- `allow once`는 단일 tool invocation에만 유효하다.
- session/workspace grant는 policy revision과 명시적 scope를 가진다.
- process 재시작 후 memory-only grant는 복원하지 않는다.
- 외부 write/process/network effect가 발생했는지 모호하면 재실행 대신 inspect/resend 선택을 요구한다.
- undo는 보상 가능한 operation만 제공하며 filesystem 현재 revision이 다르면 자동 덮어쓰지 않는다.

## 9. 사용자에게 보이는 failure model

| 분류 | 화면 동작 | data 동작 | 회복 action |
| --- | --- | --- | --- |
| transient transport | content 유지, reconnect 표시 | command evidence 확인 | 자동 reconnect 후 상태 확인 |
| child crash | run 인접 오류 + global attention 1개 | ledger와 JSONL 재scan | bounded restart |
| validation | 관련 control inline error | mutation 없음 | 수정 후 재시도 |
| stale revision | 사용자 입력과 server 값 모두 보존 | 자동 overwrite 없음 | 비교 후 선택 |
| permission denied | tool row terminal state | grant 생성 안 함 | scope 확인/새 요청 |
| uncertain effect | 강한 warning, 자동 성공/실패 금지 | evidence ledger 보존 | inspect, resend, dismiss |
| protocol mismatch | 기존 content read-only 유지 | migration/compatibility 중단 | update/diagnostics |
| storage corruption | 새 write 중지 | 원본 보존, 복사본에서 검사 | export/rebuild 지원 |
| compaction 실패 | composer inline alert + context control 오류, transcript 불변 | 이전 leaf로 rollback하고 hidden failure entry 저장 | 안내 닫기, 원인 확인 후 재시도 |
| compaction 취소 | polite 취소 status, danger alert 없음 | 이전 leaf로 rollback하고 cancelled entry 저장 | 필요할 때 다시 실행 |
| Fork publish 전 실패 | 해당 응답 footer inline error | source 불변, target 없음 확인 | 같은 응답에서 재시도 |
| Fork publish 여부 불명 | `분기 생성 확인 중`, 중복 action 차단 | operation ledger와 staging/final manifest 대조 | 기존 target 등록 또는 진단 |
| Fork 생성 뒤 open 실패 | 생성 성공과 open 실패를 분리해 표시 | target과 catalog record 유지 | catalog에서 target 열기 |
| fatal security | 위험 기능 즉시 중지 | secret/log redaction 유지 | reload/update/report |

오류가 사라졌을 때 기존 transcript를 다시 fetch하는 동안 화면을 비우지 않는다. recovery action은 idempotent하거나 중복 실행을 막아야 한다.

Compaction rollback은 JSONL truncate나 entry 삭제가 아니라 pre-attempt leaf로 branch한 뒤
`azrael-ex.compaction-failure.v1` custom entry를 append하는 방식이다. 이 entry는 model context와
기본 transcript에서 제외하며 성공 compaction으로 해석하지 않는다. 이미 append된 실패
compaction entry는 abandoned sibling branch의 forensic evidence로 보존한다.

Failure entry에는 allowlisted 오류 코드와 bounded/redacted message만 저장한다. 원문 대화,
생성 중 summary, stack, provider payload, credential, URL/path와 hidden reasoning은 저장하지 않는다.

현재 panel에서 발생한 compaction 실패는 composer 바로 위의 non-modal `role="alert"`로 즉시
announce한다. 정상 rollback이 확인된 안내는 실패 사실, 대화 보존 사실과 정제된 원인을 포함하며
닫을 수 있다. Alert를 닫아도 context 원형 control은 danger 상태와 menu 상세를 유지한다. Rollback
검증 실패는 보존을 주장하지 않고 기존 recovery attention surface와 `uncertain`/read-only 상태를
우선한다. 새 transcript item, 자동 focus, draft 삭제 또는 중복 VS Code notification은 만들지 않는다.

## 10. 초기 품질 budget

아래 수치는 1차 release candidate의 시작 목표다. 실제 측정 환경, fixture와 p95 표본 수를 결과와 함께 기록한다. 기준을 완화하려면 원인, 사용자 영향, 기한이 있는 waiver가 필요하다.

| 항목 | 초기 gate |
| --- | --- |
| activation synchronous work | p95 100 ms 이내에 VS Code event loop에 제어 반환 |
| warm session first meaningful content | p95 1.5 s 이내 |
| cold child start first meaningful state | p95 4 s 이내 또는 단계별 progress 표시 |
| composer keystroke-to-paint | p95 50 ms 이내, IME 포함 |
| accepted stream의 visible update | p95 100 ms 이내, coalescing 허용 |
| command acknowledgement | 정상 local 경로 p95 500 ms 이내 |
| Webview warm restore | p95 3 s 이내에 last confirmed content 표시 |
| user reading 중 scroll shift | anchor item 기준 1 text line 초과 금지 |
| duplicate prompt/tool settlement | 0건 |
| acknowledged draft loss | 0건 |
| credential/hidden payload UI·log 노출 | 0건 |
| OAuth refresh 뒤 persistent revision 불일치 | 0건 |
| uncaught extension-host crash 유발 | 0건 |

성능을 맞추기 위해 상태 정확성이나 accessibility를 희생하지 않는다. budget 미달은 masking spinner가 아니라 profiling 및 workload 축소 대상으로 처리한다.

## 11. Resource 경계

- transcript는 windowed rendering과 bounded cache를 사용한다.
- large message/code/tool output은 전체 DOM을 한 번에 만들지 않는다.
- highlight와 Markdown parse는 stream delta마다 전체 문서를 다시 계산하지 않는다.
- hidden Webview는 불필요한 animation, polling과 layout work를 중지한다.
- child 및 Webview memory는 session 수, transcript 크기, tool output fixture별로 관찰한다.
- log file, database journal, snapshot과 crash diagnostic은 rotation/size limit을 가진다.
- idle child retention은 active run, pending queue와 consumer 존재를 기준으로 결정한다.
- 전역 concurrent run budget과 session별 queue는 별도이며, budget 대기는 session 내부 순서를 바꾸거나 delivered로 표시되지 않는다.
- resident Pi Host, session event replay와 child memory admission은 다중 세션 설계의 hard cap을 따르며 cap 압력은 active run 강제 종료보다 idle hibernation을 우선한다.

정확한 byte 및 process memory 상한은 packaging/runtime 선택 후 구현 계획에서 고정하되 “무제한”을 기본값으로 둘 수 없다.

## 12. Observability와 개인정보

- 모든 command는 redacted correlation id로 extension → Core → Pi Host를 추적할 수 있다.
- metric은 activation, child start, reconnect, snapshot, draft ack, queue conflict, event gap, crash loop와 UI long task를 포함한다.
- log level을 올려도 credential, raw authorization header와 hidden reasoning은 기록하지 않는다.
- prompt/file content는 사용자가 명시적으로 진단 bundle에 포함하지 않는 한 기본 제외한다.
- diagnostics export 전에 포함 항목과 redaction 결과를 사용자에게 보여준다.
- 외부 telemetry 전송은 1차 PoC 기본값이 아니며 별도 동의·보존 정책 설계 없이는 추가하지 않는다.

## 13. Verification matrix

### 13.1 결정적 검사

- command idempotency와 duplicate event property test
- event gap, reordering, replay와 epoch 변경 simulation
- Core/Pi Host/Webview를 각각 임의 종료하는 fault injection
- dispatch 단계별 crash 후 uncertain/resume 판정
- draft revision conflict와 window restore
- permission expiry, digest mismatch와 policy revision 변경
- OAuth login/refresh/logout race, SecretStorage failure와 Pi Host restart
- 여러 panel과 Extension Host instance의 stale credential revision 경쟁
- 기존 user/assistant/thinking/tool/compaction branch fixture의 cold open, hibernate 복귀와 Pi Host
  재시작 history hydration 및 stable item id
- compaction 실패 전/후 model-visible branch content와 model context 동일성, hidden failure entry 영속화,
  post-append 실패 rollback 및 재open 검사
- compaction request 실패 직후 inline alert의 문구·dismiss·focus/draft 보존, context danger 상태와
  transcript item 부재 검사
- 실제 Pi SDK JSONL fixture에서 compaction 이전/이후 assistant entry Fork, 선택 응답 포함 여부,
  source byte/active-leaf 불변성과 target header/parent chain 검사
- Fork의 staging 생성 전·후, atomic publish 후, catalog 등록 후와 acknowledgement 손실 crash injection;
  Extension Host/Pi Host 재시작 및 hibernate 복귀 뒤 target 중복·유실 없음 검사
- historical/live assistant response의 stable Fork action, double-click single-flight, stale epoch/item,
  running/compacting/recovery/untrusted disabled reason과 target panel open 실패 UX 검사
- 서로 다른 session의 동시 run, background panel detach/reattach와 session별 child crash isolation
- 같은 session의 process/VS Code window 간 mutation lease 경쟁과 crash 후 evidence reconcile
- 두 VS Code window가 같은 session을 read-only/open한 상태의 단일 Broker·Pi Host·writer 보장과 idle writer transfer CAS
- active/queued/permission/mutation/recovery/external-owner별 power control 비활성화 및 접근성/visual fixture
- writer transfer response 손실, client disconnect와 stale former-writer submit/rename/permission/queue mutation fencing
- large transcript/tool output의 memory 및 backpressure
- offline/reconnect 중 session catalog와 transcript 유지
- IME, rapid Enter, double-click와 abort race
- scroll anchor, unread marker와 pagination regression
- schema migration 실패와 이전 version compatibility
- single-root/multi-root 선택 우선순위, folder removal, trust revoke와 panel restore 중 workspace binding 불변성
- installed VSIX가 개발 checkout 없이 pinned child runtime과 Pi SDK를 시작하는 isolated probe

### 13.2 사용자 여정 검사

다음 여정은 새 설치, 기존 session, crash-recovery fixture에서 keyboard-only와 pointer로 각각 검증한다.

1. session 생성 → prompt → stream → tool → file review
2. running 중 steer/follow-up → reorder/cancel → settle
3. permission allow-once/deny/stale → 결과 확인
4. draft 작성 중 Webview reload/VS Code restart → 복원
5. prompt dispatch 중 Pi Host crash → uncertain 판단
6. 긴 대화 중 과거 scroll → stream/reconnect → 위치 보존
7. child crash loop → circuit open → diagnostics → 안전 재시작
8. multi-root에서 active folder session 생성 → 다른 editor로 이동 → 기존 session cwd 유지
9. binding folder 제거/restore → 실행 차단 → 같은 canonical identity 확인 후 명시적 재개
10. session A 실행 → tab 닫기 → session B 동시 실행 → A background 완료 → A 재open 및 replay
11. 과거 assistant 응답 Fork → target 자동 open → source/target 독립 prompt → 양쪽 재open
12. compaction 이전 응답 Fork → Extension Host 재시작/hibernate → 같은 target catalog 복구
13. 같은 session을 두 window에서 열기 → observer history 확인 → idle power control 전환 → 이전 writer mutation 거절
14. active/queued/permission/external-owner session 열기 → 실행 오류 없이 history 확인 → 비활성 사유 확인

### 13.3 Release blocker

다음 중 하나라도 재현되면 1차 완료를 선언하지 않는다.

- prompt, tool 또는 외부 side effect 중복 실행
- acknowledged draft, queue 또는 session pointer 손실
- uncertain command의 자동 재전송
- permission scope 확대 또는 stale approval 적용
- session cwd, relative file root 또는 permission workspace가 canonical binding과 불일치
- folder 제거/restore 후 다른 root로 session을 자동 rebind하거나 prompt 실행
- child failure로 VS Code extension host 전체가 반복 종료
- 한 session의 child failure, panel close 또는 session open이 다른 session run을 abort하거나 오염
- 같은 Pi JSONL session에 둘 이상의 write lease 또는 Pi Host가 활성화
- 같은 session writer authority가 두 client에 동시에 부여되거나 이전 writer epoch mutation이 Core/Pi에 도달
- active/queued/permission/recovery 중 writer transfer 성공 또는 transfer 자체가 prompt/draft/queue를 변경
- 외부 owner의 lease 때문에 session history open이 일반 `실행 오류`로 실패하거나 강제 takeover 수행
- observer/blocked 상태에서 세로형 power control, 회색 비활성 표현 또는 접근 가능한 사유가 없음
- reconnect/loading 중 마지막 확인 content 삭제
- visible Pi branch entry가 있는데 ready snapshot을 빈 정상 session으로 발행하거나 history hydration
  오류를 empty-state로 표시
- compaction 실패 뒤 성공 marker가 남거나 pre-attempt context가 달라짐
- 현재 panel의 compaction 실패가 열린 context menu에서만 보여 즉시 인지할 수 없음
- compaction rollback 또는 failure entry 저장을 검증하지 못했는데 session mutation을 계속 허용함
- Fork 뒤 source JSONL bytes/active leaf 변경, 선택 응답 누락 또는 선택 뒤 conversational/compaction
  entry 포함(SDK가 재구성한 유효 label entry는 허용)
- Fork acknowledgement 손실·재시작·hibernate 뒤 같은 command가 target을 중복 생성하거나 이미 publish된
  target이 catalog에서 유실됨
- compaction 이전의 active-branch assistant 응답이 cold open 뒤 Fork 불가능하거나 다른 entry로 분기됨
- Fork target open 실패를 전체 생성 실패로 처리해 valid target을 삭제하거나 숨김
- 읽는 중 강제 scroll-to-bottom 또는 draft focus 탈취
- credential, hidden reasoning 또는 허용되지 않은 file content 노출
- OAuth refresh 성공을 표시했지만 SecretStorage commit이 확인되지 않은 상태
- reference 골든 화면의 주요 clipping, 접근 불가 action 또는 keyboard trap
- crash/recovery 경로에 진단 가능하고 안전한 사용자 action이 없음

## 14. 운영 및 변경 통제

- protocol/schema 변경은 이전 version fixture로 replay compatibility를 확인한다.
- migration은 원본 backup 또는 transactional rollback 없이 destructive change를 수행하지 않는다.
- crash/recovery bug 수정은 해당 fault fixture를 영구 regression으로 남긴다.
- quality budget과 release blocker의 예외는 owner, 이유, 영향, 관찰 방법과 만료일을 기록한다.
- runtime 안정성 gate가 통과하기 전 visual polish가 성공을 가리는 loading/retry layer를 추가하지 않는다.
- 2차 Electron 앱은 동일 command/event/quality fixture를 통과한 뒤 adapter 고유 UI를 검증한다.

## 15. 근거

- [OpenAI Docs — ChatGPT & Codex changelog](https://learn.chatgpt.com/docs/changelog): reconnect 중 기존 thread/project 유지, conversation별 scroll 보존, approval/composer 및 resume 오류 UX 개선 사례
- [OpenAI Docs — Codex App Server](https://learn.chatgpt.com/docs/app-server): thread/turn/item lifecycle, server request와 approval correlation 계약
- [VS Code — Webview API](https://code.visualstudio.com/api/extension-guides/webview): Webview lifecycle, serialization, theme와 security 경계
- [VS Code — Notifications](https://code.visualstudio.com/api/ux-guidelines/notifications): contextual progress, timeout, cancel과 notification 절제 원칙
- [기존 초기 전체 설계](../pi-harness/initial-system-design.md): Pi JSONL, queue, recovery, permission과 security의 역사적 입력
