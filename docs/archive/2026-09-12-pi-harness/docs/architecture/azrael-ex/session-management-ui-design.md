# azrael-ex Codex형 세션 관리 UI 설계

- 상태: `ready` — 구현 계획과 acceptance의 기준 설계
- 결정일: 2026-09-04
- 적용 대상: azrael-ex VS Code Desktop extension의 chat Webview header
- 상위 설계: [다중 세션 백그라운드 런타임](multi-session-background-runtime-design.md)
- Writer 계약: [세션 Writer 소유권과 전환](session-writer-ownership-design.md)
- UI 계약: [UI/UX 디자인 지침](azrael-ex-ui-ux-design-guidelines.md)

## 1. 결정과 근거 경계

Chat Webview의 우측 상단에 Codex와 같은 정보 구조를 가진 네 개의 control을 다음 순서로 둔다.

```text
session header actions
├─ 1. Session actions ···
├─ 2. Recent sessions ◴ 또는 running ring
├─ 3. Account ⚙
└─ 4. New session ✎
```

사용자가 2026-09-04 대화에 첨부한 다섯 화면을
`codex-light-session-management-001` 방향 기준으로 식별한다. 이 capture는 button 순서, icon의
시각적 무게, floating menu/popover의 위치·간격·grouping, 선택 row와 running ring의 관찰 근거다.
Codex의 source implementation이나 비공개 asset을 복제하지 않으며 azrael-ex의 semantic token,
접근성 계약과 host 보안 경계를 유지한다.

[OpenAI의 공개 Projects and chats 문서](https://learn.chatgpt.com/docs/projects)는 folder/workspace를
local project로 취급하고, 각각 독립 transcript를 가진 chat을 Recent chats에서 다시 선택하며
rename할 수 있다는 제품 의미를 확인한다. 정확한 menu 구성이나 pixel geometry는 공개 문서의
계약이 아니므로 첨부 capture를 시각 기준으로 사용한다.

화면 문구는 기존 azrael-ex의 한국어 UI에 맞춰 번역한다. 메뉴 구조와 동작은 reference를 따르되
한 화면에서 한국어와 영어 action label을 임의로 섞지 않는다.

## 2. 범위와 비범위

이번 범위는 다음 네 control과 이를 뒷받침하는 catalog/auth/deeplink intent다.

- Session actions: `이름 변경`, `복사 > 딥링크 복사`
- Recent sessions: 현재 workspace의 검색 가능한 session 목록, 선택/reveal, live runtime 상태
- Account: 로그인 상태, account label, 비활성 `Codex 설정`과 `키보드 단축키`, 로그인/로그아웃
- New session: 현재 immutable WorkspaceBinding에 새 session 생성·열기

이 문서에서 **현재 프로젝트**는 header를 표시하는 `ChatPanel`에 immutable하게 bind된
`WorkspaceBinding.workspaceId`의 VS Code `WorkspaceFolder`다. Multi-root window 전체나 현재
Extension Host가 알고 있는 모든 workspace를 뜻하지 않는다. Header의 session 목록, 검색 결과,
running count와 새 session 대상은 모두 이 한 `workspaceId`로 제한한다.

다음은 명시적으로 구현하지 않는다.

- Archive와 Share action, archive state 또는 share backend
- `작업 디렉터리 복사`, `Markdown으로 복사`
- Codex settings 화면·command·route
- Keyboard shortcuts 화면·command·route와 azrael-ex 전용 shortcut 편집기
- 외부 사용자에게 접근 권한을 부여하는 public sharing
- VS Code가 완전히 종료된 뒤에도 동작하는 daemon

비범위 item은 disabled placeholder로 남기지 않는다. Archive/Share 및 다른 Copy item은 메뉴에서
아예 제외한다. 단, 사용자가 구성을 확인할 수 있도록 요구한 `Codex 설정`과 `키보드 단축키`만
Account menu에서 disabled 상태로 보인다.

## 3. Header와 floating surface 계약

현재 header의 `새로 고침`과 inert `추가 작업` button을 네-control cluster로 교체한다. 재연결
새로고침은 connection/recovery surface가 소유하며 top-level session control 자리를 사용하지 않는다.

- 각 icon button은 34×34 px 이상의 hit target, 동일한 stroke weight와 4 px 내외의 간격을 쓴다.
- 화면 폭이 좁아도 네 button의 순서를 바꾸지 않는다. Title이 먼저 ellipsis되고 cluster는 유지된다.
- menu/popover는 trigger 아래 우측 정렬, viewport collision padding 8 px, 낮은 elevation과 얇은
  border를 사용한다.
- 한 번에 하나의 floating surface만 열린다. 다른 trigger 선택, 바깥 click 또는 Escape는 현재
  surface 한 단계만 닫는다.
- Session actions와 Account는 기존 `@radix-ui/react-dropdown-menu`를 재사용한다. 검색 input을
  포함하는 Recent sessions는 같은 Radix 계열 `@radix-ui/react-popover`를 추가해 focus와 collision을
  맡기며 임의 positioning/focus trap을 만들지 않는다.
- 모든 icon은 제품 asset 복사가 아닌 azrael-ex 소유 inline SVG로 작성하고 `aria-hidden` 처리한다.
  button에는 한국어 `aria-label`과 tooltip을 둔다.

## 4. 첫 번째 button — Session actions

### 4.1 메뉴 구조

```text
세션 작업
├─ 이름 변경
└─ 복사 ›
   └─ 딥링크 복사
```

Codex capture의 submenu 구조를 유지하기 위해 Copy가 한 item만 가져도 한 단계 submenu를 쓴다.
Archive, Share, working-directory copy와 Markdown copy는 render하지 않는다.

### 4.2 이름 변경

`이름 변경`을 선택하면 현재 title을 선택한 compact rename dialog를 연다. Enter는 저장, Escape는
취소하며 trim 후 1–128 Unicode scalar의 이름만 허용한다. 빈 값, control character와 과도한 길이는
host에서도 다시 거부한다.

이름은 identity가 아니다. `workspaceId + sessionId`와 panel key, deeplink는 바뀌지 않는다.
Webview가 성공을 먼저 확정하지 않고 다음 순서를 지킨다.

```text
Webview session.rename(expectedWriterEpoch, expectedRevision, name)
→ WebviewBridge schema validation
→ Session Broker의 동일 actor/physical lease/current writer 확인
→ session-bound Pi Host가 AgentSession.setSessionName(name) 호출
→ Pi JSONL session_info_changed append 확인
→ Core catalog projection reconcile/ack
→ header, session popover와 TreeView가 같은 revision으로 갱신
```

Pi SDK 0.84.4의 `AgentSession.setSessionName()`을 재사용한다. Core나 Webview는 Pi JSONL을 직접
수정하지 않는다. Observer, stale writer epoch, 외부 owner, uncertain recovery 또는 revision conflict에서는 입력을
보존한 채 오류를 표시하고 자동 재시도하지 않는다.

### 4.3 딥링크 복사

딥링크는 VS Code의 `UriHandler` 형식인
`vscode://azrael-ex-local.azrael-ex/session/open?workspaceId=<opaque>&sessionId=<opaque>`를 쓴다.
Extension Host가 URI를 만들고 `vscode.env.clipboard.writeText()`로 복사한다. Webview의 clipboard나
filesystem path를 사용하지 않는다.

- URI에는 opaque `workspaceId`와 `sessionId`만 포함하고 canonical path, credential, title 또는
  prompt를 넣지 않는다.
- `registerUriHandler`는 scheme/authority, path, 허용 query key, 길이와 identifier 형식을 검증한다.
- 대상 workspace가 현재 window에 없거나 binding이 달라졌으면 자동으로 folder를 추가하거나
  다른 경로에 rebind하지 않고 안전한 오류를 표시한다.
- 존재하는 panel/actor가 있으면 reveal/attach하고, dormant session이면 일반 open 흐름을 쓴다.
- 이 기능은 같은 azrael-ex 설치에서 session을 여는 locator다. 접근 권한이나 transcript를 공유하는
  Share 기능이 아니다.

복사가 성공하면 menu를 닫고 짧은 non-modal 확인을 보여준다. 실패하면 menu 근처 또는 VS Code
error surface에서 재시도 가능한 이유를 표시하며 성공처럼 보이지 않는다.

## 5. 두 번째 button — Recent sessions

### 5.1 Trigger 상태

runtime state가 정확히 `running`인 현재 프로젝트 session이 하나라도 있으면 history/reopen icon 대신
Codex capture와 같은 animated ring을 표시한다. `waiting-slot`, `waiting-permission`, `stopping`,
`uncertain`은 실행 중으로 위장하지 않으며 목록 row에서 각각의 attention/state를 표현한다.

- rest: history/reopen outline icon, `최근 세션 열기`
- running: animated ring, `최근 세션 열기, N개 실행 중`
- reduced motion: 회전하지 않는 segmented ring과 같은 accessible label
- catalog stale/offline: 마지막 목록은 유지하되 trigger tooltip에 `목록 재연결 중`을 덧붙인다.

animation은 CSS가 담당하고 React timer를 만들지 않는다. `aria-live`는 run transition을 한 번만
요약하며 frame이나 progress tick을 announce하지 않는다.

### 5.2 Popover 구성

```text
┌─────────────────────────────────────────┐
│ 🔍 최근 채팅 검색                       │
├─────────────────────────────────────────┤
│ 모든 채팅 ▾                    workspace │
├─────────────────────────────────────────┤
│ session title                 1분  ◌     │
│ selected session             2시간       │
│ …                                       │
└─────────────────────────────────────────┘
```

`모든 채팅`은 1차 release에서 현재 프로젝트의 전체 session을 뜻한다. 다른 `workspaceId`의 session을
합치지 않으며 dropdown affordance는 후속 scope가 생길 때까지 static label로 둔다. Workspace label을
함께 표시해 범위를 알 수 있게 한다.

- Host는 `SessionCatalogService.list(current.workspaceId)` 결과만 Webview snapshot에 포함한다. 전체
  catalog를 보낸 뒤 Webview에서 걸러내는 방식은 다른 프로젝트 metadata 노출과 필터 누락 위험 때문에
  허용하지 않는다.
- 열 때 search input에 focus한다. Search는 이미 현재 프로젝트로 제한된 title projection에서
  case-insensitive substring으로 수행하고 Core query를 keystroke마다 보내지 않는다.
- catalog는 `updatedAt DESC`, 동일 timestamp에서는 `sessionId ASC`로 결정적으로 정렬한다.
- row는 title, 상대 시간, 현재 선택 여부와 runtime/attention 상태를 가진다. `running` row 우측에는
  trigger와 같은 ring을 표시한다.
- 현재 session은 rounded neutral selection surface로 표시하며 color만으로 선택을 표현하지 않는다.
- Arrow Up/Down은 row 이동, Enter는 open/reveal, Escape는 popover를 닫고 trigger로 focus를 돌린다.
- session 선택은 현재 run을 중단하거나 현재 actor를 dispose하지 않는다. 대상 panel을 reveal하거나
  새 panel attachment를 만들고 popover만 닫는다.
- catalog가 비어 있으면 `아직 세션이 없습니다`와 `새 세션` action을 제공한다. 검색 결과가 없을 때는
  query를 지우는 action을 제공한다.
- relative time은 분 단위 경계에서만 갱신하고 visibility가 없는 Webview에서 timer를 돌리지 않는다.
- `runningCount`도 현재 `workspaceId`로 먼저 제한한 뒤 계산한다. 다른 프로젝트에서 실행 중인 session은
  이 trigger와 목록 row에 나타나지 않는다.
- Multi-root window에서 active editor가 다른 folder로 이동해도 열린 panel의 immutable binding과 목록
  범위는 바뀌지 않는다. 다른 프로젝트 목록은 그 프로젝트에 bind된 chat을 열어야 볼 수 있다.
- 프로젝트 binding이 바뀌는 새 panel을 열 때 이전 프로젝트의 last-confirmed rows를 잠시 재사용하지
  않는다. Cache와 stale 상태는 `workspaceId`별로 분리한다.

Popover와 native Sessions TreeView는 별도의 session authority가 아니다. 둘 다
`SessionCatalogService`의 last-confirmed catalog에 `SessionRuntimeManager`의 live projection을 합성한
같은 store를 소비한다. Popover는 빠른 전환의 primary surface이고 TreeView는 workspace-wide
attention과 VS Code-native navigation의 secondary surface다.

## 6. 세 번째 button — Account

gear icon button은 항상 Account menu를 연다. signed-in capture와 같은 grouping을 유지한다.

```text
계정
├─ identity/status row       disabled informational
├─ account/plan row          disabled informational
├─ separator
├─ Codex 설정                disabled
├─ 키보드 단축키             disabled
├─ separator
└─ 로그아웃 또는 ChatGPT로 로그인
```

현재 `AuthViewState`에는 email이 없고 `planLabel`도 optional이며 `AuthCoordinator`가 채우지 않는다.
따라서 이메일이나 Personal plan을 credential/JWT에서 임의 추출하거나 만들어내지 않는다.

- authoritative account label이 있으면 첫 row에 표시한다. 없으면 signed-in 상태에서
  `ChatGPT로 로그인됨`, signed-out에서 `로그인하지 않음`을 표시한다.
- `planLabel`이 있으면 두 번째 row에 표시하고, 없으면 `계정 유형 정보 없음`을 표시한다.
- raw OAuth credential, access/refresh token, account ID는 Webview로 보내지 않는다.
- `Codex 설정`과 `키보드 단축키`는 `disabled` 및 `aria-disabled=true`이고 hover/click/Enter로 command,
  URI 또는 telemetry를 발생시키지 않는다. Tooltip은 `azrael-ex에서 지원하지 않음`이다.
- signed-in/needs-login 상태에는 `로그아웃`, signed-out/error 상태에는 `ChatGPT로 로그인`,
  signing-in 상태에는 진행 label과 `로그인 취소`를 표시한다.
- Logout은 기존 AuthCoordinator의 credential-consumer clear/ack 순서를 그대로 사용하며 running
  session을 성공으로 위장해 종료하지 않는다.

## 7. 네 번째 button — New session

compose icon은 메뉴 없이 현재 workspace에 새 session을 만들고 연다.

```text
click
→ host가 현재 WorkspaceBinding과 trust 재검증
→ create request single-flight/dedupe
→ Core가 logical identity/catalog pending row 생성
→ RuntimeManager.create(workspaceId)
→ Pi Host가 session JSONL 생성·header binding 확인
→ ChatPanel create/reveal 후 attachment
→ catalog ack와 함께 title `새 세션` 확정
```

button은 create가 진행되는 동안 disabled/loading이어서 double-click이 session 둘을 만들지 않는다.
workspace가 없거나 untrusted이면 생성하지 않고 이유와 다음 action을 표시한다. 로그인하지 않은 경우
빈 chat surface를 열 수 있지만 prompt submit은 기존 auth gate가 막는다. Pi runtime/JSONL 생성이
credential을 요구하는 구현이면 catalog row를 durable `pending-create`로 남기지 말고 create를
원자적으로 실패시킨 뒤 로그인 action을 제공한다.

새 session을 여는 동작은 현재 session의 active run, queue, permission 또는 actor를 중단하지 않는다.

## 8. Composer session writer control

현재 panel이 session writer이면 Composer는 기존 원형 submit/stop control을 유지한다. Observer이면 같은
자리에 폭 36px, 높이 52px, 모서리 반경 12px의 세로형 power control을 표시한다. 이 control은 runtime을
켜거나 새 Pi Host를 만드는 일반 전원 버튼이 아니라 현재 UI client로 session writer authority를 전환하는
명시적 action이다.

| 상태 | 표현과 동작 |
| --- | --- |
| `available` | 높은 대비 power glyph; click/Enter/Space로 writer transfer intent 한 번 전송 |
| `transferring` | 동일 geometry와 진행 표시; 중복 입력 차단 |
| `blocked` | 회색 surface/muted glyph; focus 가능, `aria-disabled=true`, 사유 tooltip/설명 제공 |
| transfer 성공 | authoritative writer snapshot 수신 뒤 기존 원형 submit control로 교체 |

`run-active`, `permission-pending`, `queue-pending`, `mutation-in-flight`, `transfer-in-progress`,
`external-owner`, `owner-uncertain`, `recovery-required`, `workspace-untrusted`, `connection-degraded`,
`stale-state`를 안정적인 blocked reason으로 사용한다. 색만으로 상태를 구분하지 않으며 unavailable
상태의 이유를 screen reader와 pointer hover 모두에서 확인할 수 있어야 한다.

Writer transfer는 prompt submit, draft clear 또는 queue mutation이 아니다. Session-scoped durable draft는
observer에서도 보존되고, 전환 성공 뒤 동일 revision으로 이어서 편집한다. 모델이 `running`,
`waiting-slot`, `waiting-permission`이거나 pending queue/mutation/recovery가 있으면 전환하지 않는다.

## 9. Shared state와 typed message 계약

Webview에 전달하는 최소 projection은 다음과 같다.

```text
SessionManagementViewState
  current: { workspaceId, sessionId, title, revision }
  catalog: { workspaceId, revision, stale, sessions[] }
  sessions[]:
    { sessionId, title, updatedAt, runtimeState, surfaceState,
      unreadCount, attentionKind?, writable }
  writerControl:
    { role, writerEpoch, sessionRevision, transferState,
      blockedReason?, blockedLabel? }
  runningCount
  createPending
  account:
    { status, accountLabel?, planLabel?, persistence, message? }
```

추가 Webview intent는 fixed discriminated union으로만 허용한다.

```text
session.rename { requestId, expectedWriterEpoch, expectedRevision, name }
session.deeplink.copy { requestId, sessionId }
session.open { requestId, sessionId }
session.create { requestId }
session.writer.transfer
  { requestId, sessionId, expectedWriterEpoch, expectedSessionRevision }
auth.sign-in | auth.cancel | auth.logout
```

Host는 `session.management.snapshot`과 bounded `session.catalog.changed`를 보낸다. 모든 session intent는
panel에 숨겨진 current ID가 아니라 message의 ID를 host-side attachment/workspace와 대조한다.
Webview가 보낸 workspace path, URI, runtime state 또는 writable flag를 authority로 사용하지 않는다.
Snapshot의 `catalog.workspaceId`는 `current.workspaceId`와 반드시 같아야 하며 Webview reducer는 다른
workspace의 snapshot/delta를 폐기한다. 이는 host-side query 제한을 대체하지 않는 2차 방어다.

## 10. 오류, 접근성, 보안

- Menu/popover/dialog는 WAI-ARIA role, focus return, keyboard navigation과 200% zoom reflow를 검증한다.
- spinner 하나에만 상태를 의존하지 않고 accessible text와 row state를 제공한다.
- running ring은 `prefers-reduced-motion`, forced colors와 high contrast에서 식별 가능해야 한다.
- menu open/close, 검색과 row highlight는 local optimistic UI가 가능하다. Rename/create/open/logout은
  host ack 전에 성공으로 확정하지 않는다.
- catalog reconnect에서는 last-confirmed rows를 지우지 않고 stale로 유지한다.
- session title과 auth message는 text로 render하고 HTML로 삽입하지 않는다.
- 딥링크 처리와 session open은 workspace trust, immutable binding과 catalog identity를 매번 재검증하되
  read-only open 자체는 mutation lease를 요구하지 않는다. Writer transfer와 mutation에서 lease/epoch를 검증한다.
- Account menu와 diagnostics에는 secret 및 raw provider payload를 노출하지 않는다.

## 11. 구현 소유권과 완료 판정

| Owner | 책임 |
| --- | --- |
| `SessionCatalogService`/Core | list, title revision, deterministic sort source, last-confirmed projection |
| Session Broker/`SessionRuntimeManager` | live runtime merge, runningCount, create/open/rename routing, actor와 writer authority 보존 |
| `ChatPanelRegistry`/URI handler | one panel per identity, reveal/attach, validated deeplink open |
| `WebviewBridge`/shared schemas | allowlisted intent와 redacted view snapshot |
| Webview session-management/Composer components | 네 header button, two menus, popover, rename dialog, writer power control, focus/motion |
| `AuthCoordinator` | redacted account view와 login/logout state; credential은 host에 유지 |
| deterministic UI fixture | reference-aligned rest/open/running/signed-out/error 상태와 visual acceptance |

다음이 모두 확인되어야 완료다.

- 네 button이 지정 순서로 표시되고 narrow width/200% zoom에서도 title보다 먼저 잘리지 않는다.
- Session actions에는 Rename과 `Copy > Copy deeplink`만 있고 Archive/Share 및 다른 Copy action이 없다.
- 이름 변경이 Pi JSONL과 Core/header/TreeView projection에 같은 revision으로 수렴한다.
- 딥링크가 path/secret 없이 복사되고 invalid/binding-mismatch URI가 열리지 않는다.
- session A가 background에서 running이면 trigger와 A row에 ring이 보이고 B를 열어도 A가 중단되지 않는다.
- 다른 프로젝트의 dormant/running/attention session은 목록, 검색 결과와 running count 어디에도 나타나지 않는다.
- reduced motion에서 animation 없이 running 의미가 유지된다.
- Account menu의 두 미지원 item은 실제 disabled이며 계정 정보를 추측하거나 token을 노출하지 않는다.
- New session double-click이 session 하나로 수렴하고 기존 run을 중단하지 않는다.
- Observer에서는 36×52px 세로형 power control이 표시되고 idle transfer 성공 후 원형 submit으로 바뀐다.
- Active/queued/permission/recovery/external-owner 상태에서는 power control이 회색 비활성화되며 접근 가능한 사유를 제공한다.
- keyboard-only, axe, canonical viewport screenshot과 reference side-by-side 검토를 통과한다.
