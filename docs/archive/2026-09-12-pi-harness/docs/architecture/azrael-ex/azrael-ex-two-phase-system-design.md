# azrael-ex 우선 2단계 전체 설계

- 상태: `ready` — 구현 계획을 만들 수 있는 기준 설계
- 결정일: 2026-09-02
- Workspace 실행 binding 개정일: 2026-09-03
- ChatGPT OAuth·reference UX 개정일: 2026-09-03
- 1차 프로젝트명: `azrael-ex`
- 2차 프로젝트명: `Pi Harness Workbench`(기존 Electron 앱, 명칭 유지)
- 대상 환경: 1차 Windows VS Code Desktop 우선, 2차 Windows Electron 우선
- 문서 관계: [Pi Harness Workbench 초기 전체 설계](../pi-harness/initial-system-design.md)는 역사적 입력이다. azrael-ex에는 이 문서와 동급 UI·품질 계약에 명시적으로 다시 적은 runtime 의미만 적용되며, Pi Harness의 미기재 기능이나 제품 기본값을 암묵적으로 상속하지 않는다.
- 2차 권위 경계: 이 문서의 2차 Electron 내용은 handoff 입력이며 Pi Harness의 규범적 설계가 아니다. 실제 2차 결정은 `../pi-harness/`에서 다시 승인한다.
- 규범적 품질 계약: [UI/UX 디자인 지침](azrael-ex-ui-ux-design-guidelines.md)과 [안정성 및 품질 계약](azrael-ex-stability-quality-contract.md)은 이 설계의 일부이며 1차 release gate를 구체화한다.
- Workspace 실행 구현 순서는 저장소 외부 계획에서 관리한다.
- 인증·runtime·interaction 기준: [ChatGPT OAuth·Pi·reference-aligned UX 설계](azrael-ex-chatgpt-oauth-pi-reference-design.md)
- 다중 session 실행 기준: [다중 세션 백그라운드 런타임 설계](multi-session-background-runtime-design.md)
- 다중 window writer 기준: [세션 Writer 소유권과 전환 설계](session-writer-ownership-design.md)

## 1. 결정 요약

제품 개발 순서를 다음처럼 확정한다.

1. **1차 — azrael-ex:** VS Code extension에서 Pi 실행, session, stream, tool, permission, abort, queue, crash recovery의 최소 수직 기능을 먼저 안정화한다.
2. 1차의 초기 UI는 기능 검증에 필요한 최소 수준으로 제한한다. 기존 Electron renderer를 옮기거나 기능마다 새 화면을 먼저 만들지 않는다.
3. OpenAI의 공개 App Server 계약, 공식 IDE 문서와 versioned 설치본에서 확인한 동작을 azrael-ex의 interaction/state 계약으로 옮기고, extension 소유 화면은 승인된 밝은 reference의 정보 구조와 시각 rhythm을 따른다.
4. **2차 — Pi Harness Workbench:** 1차에서 안정화된 runtime, protocol, state projection과 UI 계약을 사용해 기존 Electron 앱을 다시 설계한다.
5. 기존 Electron backend와 검증 자산은 재사용 후보이며, 기존 renderer와 layout은 2차 UI의 기준이 아니다.
6. OpenAI 접근은 Pi의 `openai-codex` OAuth provider와 ChatGPT 구독을 사용한다. 1차 제품면은 OpenAI API key 경로를 제공하지 않는다.
7. Pi JSONL은 두 단계 모두에서 transcript 원본이다. UI나 app database가 이를 대체하지 않는다.
8. profile-scoped Session Broker가 session별 독립 Pi Host child와 물리 write lease를 소유한다. 각 ChatPanel은 attach 가능한 UI consumer이며, 동일 session에는 한 시점에 하나의 UI client만 session writer authority를 가진다.

이 순서는 “많은 기능을 가진 낮은 품질의 독립 UI”보다 “기존 IDE의 성숙한 편집 기능 위에서 안정화된 agent vertical slice”를 먼저 제공한다.

## 2. 제품 구조와 단계 경계

```text
1차: azrael-ex
  ├─ 1A. 최소 VS Code extension PoC
  │    └─ 기능·프로세스·복구 계약 검증, 최소 UI
  ├─ 1B. 안정화된 extension 제품면
  │    └─ queue/context/review의 좁은 핵심 흐름
  └─ 1C. Reference-aligned interaction과 visual acceptance
       └─ 검증된 lifecycle·IDE 흐름·화면 상태를 extension 계약으로 완성

2차: Pi Harness Workbench
  ├─ 안정화된 공통 runtime/protocol 재사용
  ├─ Electron adapter와 독립 창 복원
  └─ 검증된 semantic design system을 독립 앱에 확장
```

1A, 1B, 1C는 구현 작업 목록이 아니라 제품 판정 경계다. 구체적인 의존 순서, 파일 변경, 검증 명령은 후속 구현 계획이 소유한다.

### 2.1 1차 완료의 의미

1차 완료는 다음을 모두 뜻한다.

- VS Code 재시작과 Pi Host 재시작을 거쳐 session을 안전하게 이어갈 수 있다.
- stream, tool, queue, permission과 abort의 상태 전이가 중복 없이 관찰된다.
- 전달 여부가 모호한 prompt나 queue item을 자동 재전송하지 않는다.
- extension이 소유한 chat, composer, tool activity, approval, auth, empty/loading/error 화면이 고정된 reference와 semantic/state 계약을 충족한다.
- ChatGPT OAuth credential의 login, refresh, restart와 logout이 VS Code SecretStorage 및 Pi Host 사이에서 안전하게 수렴한다.
- Webview에 credential, raw utility port, Pi SDK 객체 또는 숨은 provider payload가 노출되지 않는다.

### 2.2 2차 시작 조건

2차는 1차의 다음 산출물이 안정된 후 시작한다.

- platform-neutral command/event contract
- Pi Host lifecycle과 crash semantics
- session/draft/queue projection
- permission과 credential broker contract
- reference-derived semantic tokens, component states와 golden reference set

2차는 1차의 불안정한 API를 동시에 재설계하지 않는다. Electron 앱의 독립 가치가 VS Code extension으로 충족되지 않는 사용 흐름에서 확인될 때만 제품 범위를 확장한다.

## 3. 사용자 결과와 성공 조건

### 3.1 의도한 결과

사용자는 VS Code를 떠나지 않고 프로젝트의 Pi session을 만들고, 재개하고, 지시하고, 도구 실행을 검토하고, 실패를 복구할 수 있다. extension은 VS Code가 이미 잘 제공하는 file explorer, editor, diff, diagnostics, terminal, keyboard navigation을 다시 구현하지 않는다.

### 3.2 관찰 가능한 성공 조건

- trusted workspace에서 새 session을 만들고 첫 prompt를 보낼 수 있다.
- 기존 Pi JSONL session을 workspace별로 찾아 이어갈 수 있다.
- 서로 다른 session이 독립 Pi Host에서 동시에 실행되고, tab을 닫거나 다른 session을 열어도 active run은 background에서 계속된다.
- assistant text, thinking 표시, tool start/update/end와 run settlement가 한 번씩 올바른 순서로 나타난다.
- 실행 중 abort 후 draft와 durable state가 일관되게 남는다.
- 위험 tool은 명시적인 승인 전 실행되지 않는다.
- Pi Host가 종료되어도 VS Code extension host와 열린 editor는 유지된다.
- host 복구 후 session을 다시 열 수 있으며 불명확한 명령은 사용자 검토 상태로 남는다.
- active editor, selection, 명시적으로 선택한 file을 context로 보낼 수 있다.
- chat을 닫았다 다시 열어도 Pi JSONL과 durable projection에서 화면이 재구성된다.
- 밝은 배경에서 Codex 스타일의 정보 밀도, surface, composer, message rhythm, tool activity와 상태 표현이 골든 레퍼런스와 일치한다.

## 4. 1차 기능 범위

### 4.1 필수 제품 기능

| 영역 | 1차 계약 |
| --- | --- |
| Workspace | session마다 선택된 workspace folder 하나를 불변 실행 경계로 사용; multi-root window에서는 명시적 결정 규칙으로 folder를 선택 |
| Session | create, list, resume, name, foreground/background/attention 표시, bounded concurrent run |
| Prompt | prompt, mid-turn steer, follow-up queue, abort |
| Stream | text, thinking, tool lifecycle, completion, public error |
| Model | OpenAI model 선택, 모델별 reasoning effort와 Standard/Fast speed 선택, 현재 선택 표시 |
| Permission | tool category별 allow-once/session/workspace/deny |
| Context | active file, selection, 명시적 file mention/attachment |
| Recovery | heartbeat, crash detection, restart, uncertain outcome 표시 |
| Draft | session별 autosave와 VS Code/Webview 재생성 |
| Review | 변경 file 목록과 VS Code diff 열기 |

### 4.2 1차에서 의도적으로 제외하는 기능

- 범용 file explorer, source editor, terminal, Git client 재구현
- 한 session이 여러 workspace root를 하나의 실행·권한 경계로 결합하는 동작
- Remote SSH, Dev Container, WSL과 web extension 지원
- 기존 Goal 전체 UI와 checkpoint 관리
- ContextCapsule의 고급 편집·교차 session 전달 UI
- 상세 compaction inspector와 reasoning 분석 화면
- 독립 Markdown editor
- Obsidian형 문서 workspace
- Electron renderer 이식
- Marketplace 공개, 조직 정책 배포, 자동 업데이트의 production 운영

제외 항목은 protocol을 우회해 임시 UI로 추가하지 않는다. 1차 안정화 이후 2차 또는 별도 설계 수정에서 판정한다.

### 4.3 VS Code workspace 실행 binding

새 Pi session은 VS Code window에서 선택된 정확히 한 `WorkspaceFolder`에 묶인다. 이 binding은
session의 실제 실행 cwd, Pi JSONL workspace identity, project resource 탐색, 상대 file link와
workspace-scoped permission이 공유하는 단일 기준이다. active editor는 **새 session의 folder를
선택하는 신호**일 뿐 기존 session의 cwd를 바꾸는 authority가 아니다.

새 session의 folder는 다음 순서로 결정한다.

1. active text editor가 속한 workspace folder
2. 열린 local workspace folder가 하나뿐이면 그 folder
3. 이 VS Code workspace에서 이전에 선택했고 현재도 열려 있는 folder
4. 둘 이상으로 모호하면 native QuickPick으로 사용자가 선택한 folder

열린 folder가 없거나 사용자가 선택을 취소하면 session을 만들지 않는다. 첫 번째
`workspaceFolders` 항목을 암묵적 fallback으로 사용하지 않는다. 1차는 local `file:` URI만
지원하며 Remote SSH, WSL, Dev Container와 virtual workspace URI는 지원 대상으로 가장하지
않고 명시적인 unsupported 상태를 반환한다.

Extension host가 소유하는 binding은 최소 다음 의미를 가진다.

```text
WorkspaceBinding
  folderUri       VS Code window membership 확인용 identity
  canonicalPath   realpath와 host path 비교 규칙을 적용한 실제 실행 경계
  displayName     UI용 비권위 label
  workspaceId     Core가 소유하는 durable identity
  trusted         현재 VS Code Workspace Trust projection
```

canonical path는 Webview state나 renderer request에서 authority로 받지 않는다. Extension
host가 `WorkspaceFolder.uri.fsPath`를 filesystem realpath로 확인하고 Core 등록 결과와 다시
대조한 뒤 binding을 발급한다. session을 만든 후에는 `workspaceId + sessionId`가 panel/runtime
복원의 기준이며 binding은 불변이다. 다른 folder에서 작업하려면 새 session을 만들거나 해당
workspace에 이미 속한 session을 명시적으로 연다.

multi-root window는 여러 root를 **선택 가능**하지만 한 session이 여러 root를 동시에 실행
경계로 삼지 않는다. 이는 multi-root window 자체를 금지하지 않으면서 permission 범위와 cwd를
명확하게 유지한다.

## 5. VS Code 제품면

### 5.1 Workbench 배치

```text
VS Code Workbench
├─ Activity Bar / Primary Sidebar
│  └─ AZRAEL
│     ├─ Sessions TreeView
│     ├─ Queued prompts TreeView
│     └─ Recovery / attention TreeView
├─ Editor Group
│  ├─ source editors and VS Code diff
│  └─ azrael-ex Chat WebviewPanel
├─ Command Palette / QuickPick
│  ├─ session, model, thinking, context 선택
│  └─ restart, open logs, open diff
└─ Status Bar
   └─ active session, model, run/recovery 상태
```

VS Code가 제공하는 선택·목록·diff 기능은 native API를 사용한다. 긴 transcript, streaming message, tool timeline, composer처럼 맞춤 상호작용이 필요한 면만 Webview로 만든다. 이는 VS Code가 Webview를 필요한 맞춤 기능에 한정하고 theme/accessibility를 지키도록 권고하는 방향과 일치한다.

### 5.2 Chat surface

Chat Webview는 한 editor tab이 한 logical session을 표시한다. 같은 session의 tab을 중복 생성하지 않고 기존 tab을 reveal한다. Webview가 dispose되어도 session runtime 소유권은 즉시 사라지지 않으며 extension host가 active run을 계속 관찰한다.

Chat surface의 최소 영역은 다음과 같다.

- session header: 이름, workspace, model, thinking, connection/run 상태
- transcript: user, assistant, thinking, tool activity, warning/error, compaction marker
- attention lane: permission, uncertain outcome, recovery action
- queued prompts: 순서, steer/follow-up 구분, 취소/재정렬
- floating composer: draft, context chips, 우측 하단의 model/reasoning/speed 캐스케이딩 메뉴, send/steer/stop

### 5.3 Native editor integration

- active editor와 selection은 사용자가 명시적으로 추가할 때만 context가 된다.
- `@` file search는 VS Code workspace file API의 결과를 사용한다.
- tool이 수정한 file은 custom preview가 아니라 VS Code diff editor로 연다.
- diagnostics와 symbol 정보는 extension host가 VS Code API로 수집해 Pi Host에 최소 projection만 전달한다.
- terminal output은 사용자가 선택하거나 명시적으로 연결한 범위만 context에 포함한다.

## 6. Reference-aligned interaction과 visual 계약

동작 근거의 등급과 Codex 공개 lifecycle을 Pi에 매핑하는 규칙은 [ChatGPT OAuth·Pi·reference-aligned UX 설계](azrael-ex-chatgpt-oauth-pi-reference-design.md)를 따른다. 색, typography, 공간, component state와 골든 화면 판정은 [azrael-ex UI/UX 디자인 지침](azrael-ex-ui-ux-design-guidelines.md)을 따른다. 승인된 밝은 테마 화면은 방향 기준으로 등록하되, 구현 시 capture manifest와 checksum을 가진 영구 reference로 고정한다.

### 6.1 목표의 정확한 범위

목표는 **azrael-ex가 소유하는 Webview와 extension 전용 icon/state surface가 선택된 밝은 reference의 정보 구조, 상태 표현, geometry와 typography 계약을 충족하는 것**이다. 구현 완료는 특정 제품과의 외관 동일성이 아니라 versioned evidence에서 도출한 assertion으로 판정한다.

VS Code의 title bar, Activity Bar, Explorer, editor chrome, native dialog와 QuickPick은 extension이 DOM을 제어할 수 없으므로 VS Code native appearance를 유지한다. 이 부분까지 Codex App처럼 바꾸기 위해 unsupported DOM patch, custom VS Code build 또는 theme 강제 설치를 사용하지 않는다.

### 6.2 레퍼런스 고정

OpenAI 공식 문서는 Codex App에서 base theme, accent/background/foreground color와 UI/code font를 조정할 수 있음을 설명하지만 정확한 token 값과 component specification은 공개하지 않는다. 따라서 구현 시작 시 다음 reference manifest를 고정한다.

- 캡처 날짜와 Codex App version
- OS, display scale, viewport size
- base theme: light
- accent/background/foreground 설정
- UI font와 code font
- 각 화면 이미지의 checksum
- 캡처 화면에 포함된 상태 fixture

공식 문서나 기억에서 임의의 hex 값과 spacing을 추정하지 않는다. 사용자가 접근 권한을 가진 Codex App 화면 또는 사용자가 제공한 screenshot을 골든 레퍼런스로 사용한다. Codex 업데이트는 기존 baseline을 자동 변경하지 않으며 명시적인 design baseline 갱신으로만 반영한다.

### 6.3 골든 화면 집합

다음 상태는 각각 독립적인 골든 화면을 가진다.

- empty workspace / empty session
- session list와 active session
- 짧은 user/assistant 대화
- 긴 Markdown, code block, list, link
- thinking collapsed/expanded
- tool queued/running/succeeded/failed
- inline diff summary와 VS Code diff 진입점
- permission request
- queued steer/follow-up
- streaming 중 composer와 stop 상태
- recoverable error, fatal error, offline/reconnecting
- attachment/context chips와 `@` menu
- compacted history marker

### 6.4 시각 언어

정확한 수치는 reference measurement가 결정하지만 구조적 언어는 다음으로 고정한다.

- 밝고 중립적인 canvas와 미세한 warm/gray surface 구분
- 강한 card grid보다 여백과 얇은 divider를 통한 hierarchy
- message bubble 남용 없이 transcript 중심의 수직 흐름
- 낮은 채도의 secondary text와 상태별 제한된 accent
- rounded floating composer와 content-driven height
- tool activity는 compact row/step 형태로 누적하고 세부 출력은 disclosure로 연다.
- code, path, command는 UI text와 구분되는 code font를 사용한다.
- icon은 stroke 기반이며 동일 의미에 여러 icon을 혼용하지 않는다.
- animation은 상태 변화 이해에 필요한 fade/height/progress만 사용한다.

### 6.5 제품 식별과 자산

- 제품명, command prefix, view id, icon, marketplace publisher는 `azrael-ex` 고유 값을 사용한다.
- OpenAI, Codex 명칭이나 로고를 azrael-ex의 제품 식별자로 사용하지 않는다.
- Codex 화면의 private asset, source code, 비공개 font file을 추출하거나 번들하지 않는다.
- 공개/관찰 근거에서는 interaction과 visual property만 추출하며, 제품 출처를 오인시키는 표현이나 자산 재사용을 금지한다.

### 6.6 시각 판정

시각 완료는 주관적인 “비슷함”으로 판정하지 않는다.

- canonical viewport별 screenshot 비교
- component state별 geometry/color/typography diff
- text reflow와 scroll-anchor 회귀
- keyboard focus, contrast, reduced-motion 상태
- OS 100%와 대표 high-DPI scale

동적 text, timestamp, cursor와 animation frame은 deterministic fixture 또는 mask를 사용한다. pixel diff 허용치는 reference capture noise와 font rasterization 차이를 분리해 screen/component별로 기록한다.

## 7. 논리 아키텍처

```text
┌────────────── VS Code window A ──────────────┐  ┌────────────── window B ──────────────┐
│ Chat Webview ⇄ Extension Host Adapter/client │  │ Chat Webview ⇄ Extension Host client │
└──────────────────────┬───────────────────────┘  └─────────────────────┬─────────────────┘
                       └──────────────┬─────────────────────────────────┘
                         versioned user-scoped named-pipe protocol
                                      ▼
                         ┌──────────────────────────┐
                         │ profile Session Broker   │
                         │ MainCoordinator          │
                         │ writer authority + epoch │
                         └────────────┬─────────────┘
                                      │
                         ┌────────────┴────────────┐
                         ▼                         ▼
                  ┌────────────┐          ┌────────────────┐
                  │ Core child │          │ Pi Host/session│
                  └─────┬──────┘          └───────┬────────┘
                        │                         │
                     SQLite                   Pi SDK → JSONL
```

### 7.1 Extension host adapter

VS Code-specific 기능을 소유한다.

- activation/deactivation과 command registration
- `activate()`당 하나의 `ExtensionServices`와 extension 전역 `AuthCoordinator` 구성·주입
- workspace folder 선택, canonical `WorkspaceBinding` 발급과 Workspace Trust projection
- TreeView, WebviewPanel, QuickPick, notification, diff, status bar
- SecretStorage, external browser, file dialog, global storage URI
- Node child process factory와 packaged resource 경로
- Webview CSP, nonce, local resource roots, message validation

Extension host는 agent loop, SQL query, Core/Pi Host lifecycle 또는 session writer authority를 직접 소유하지 않는다.
ChatPanel이나 session별 runtime은 auth service를 생성하지 않으며 sanitized state를 구독하고
auth intent만 전역 coordinator에 전달한다.

### 7.2 Session Broker와 MainCoordinator

profile-scoped Session Broker는 여러 Extension Host client가 공유하는 단일 runtime owner다. 기존
platform-neutral coordinator, `SessionRuntimeManager`와 `SessionActor`를 Broker 내부 서비스로 옮기며,
user-scoped named pipe의 versioned protocol로 attach, snapshot, writer transfer와 mutation을 받는다.

- public command authorization과 routing
- Core/Pi Host request correlation
- queue delivery evidence와 uncertain 판정
- Extension Host `AuthCoordinator`가 보낸 revisioned credential projection과 Pi Host 동기화
- session writer authority, writer epoch, transfer compare-and-swap과 stale-client fencing
- public event allowlist와 redaction
- crash/recovery orchestration

Electron dialog 또는 Electron process API를 직접 import하지 않고 port로 주입받는다.

### 7.3 Core child

- SQLite migration과 durable metadata
- workspace/session catalog projection
- draft, queue, recovery ledger
- session writer authority/epoch의 durable projection과 mutation lease
- attachment/context metadata 중 1차에 필요한 부분
- Pi JSONL의 read-only index/rebuild

### 7.4 Pi Host child

- `@earendil-works/pi-coding-agent` SDK import와 version pin
- AgentSession lifecycle
- model/thinking/auth runtime
- prompt, steer, follow-up, abort
- tool permission bridge
- normalized public stream
- Pi JSONL write ownership

Pi 공식 SDK는 session create/resume, event subscription, tools와 resource loading을 제공하므로 이 기능을 자체 agent runtime으로 다시 구현하지 않는다.

## 8. 프로세스와 런타임

### 8.1 실행 모델

- Webview는 browser sandbox에서 실행하며 Node API가 없다.
- Extension host는 VS Code API, AuthCoordinator와 Broker client를 실행한다.
- profile Session Broker가 Core와 session별 Pi Host를 별도의 Node child process로 실행하고 감독한다.
- Pi Host crash가 Extension host, Webview 또는 Core를 종료하지 않는다.
- 한 Pi Host는 하나의 immutable `workspaceId + sessionId`만 소유하며 session 전환을 위해 기존 runtime을 교체하지 않는다.
- 1차는 Node.js 22.19 이상을 전제한다. resolved executable과 실제 version을 startup gate에서 확인하고 실패 시 실행을 시작하지 않는다.

### 8.2 child process adapter

기존 `UtilityChild` interface를 유지하고 VS Code adapter는 VSIX에 포함해 검증한 Node
executable의 `child_process.fork`를 사용한다. Electron utility process의 `parentPort`와 Node
child의 IPC 차이는 transport adapter가 흡수하며 Coordinator/Core/Pi Host command contract를
분기시키지 않는다. `PATH`에서 우연히 발견된 실행 파일을 조용히 신뢰하지 않고 resolved path와
version을 diagnostics에 기록한다. workspace setting은 executable 선택 authority가 아니다.

Core/Pi Host bundle, native Pi bootstrap, migrations, pinned Node와 Pi SDK production dependency
closure는 VSIX의 명시적 runtime allowlist에 속한다. 설치본은 개발 checkout 또는 상위 package의
`node_modules`에 의존하지 않아야 한다. 지원하지 않는 OS/architecture 또는 손상된 runtime은
extension host crash가 아니라 진단 가능한 startup failure로 끝난다.

### 8.3 lifecycle

- trusted workspace에서 사용자가 session 기능을 처음 요청할 때 Extension Host가 Broker에 연결하거나 lazy start한다.
- Webview close는 host shutdown 조건이 아니다.
- 마지막 session consumer가 사라져도 active run 또는 pending permission이 있으면 host를 유지한다.
- 전역 scheduler는 동시 model run budget을 적용하고, budget을 기다리는 prompt는 session별 durable queue 순서를 유지한다.
- active work가 없는 consumer-less idle host만 retention 정책에 따라 hibernate한다.
- VS Code window close/deactivation은 해당 client만 detach한다. 다른 client나 active work가 있으면 Broker와 child는 유지한다.
- Broker는 연결 client와 active run, pending queue/permission/recovery가 모두 없을 때만 retention 정책에 따라 child를 hibernate하고 종료할 수 있다.
- 강제 종료가 필요한 경우 durable queue/recovery 상태를 먼저 `uncertain` 또는 `needs-attention`으로 남긴다.

## 9. Webview 계약

### 9.1 메시지 경계

Webview와 Extension host 사이에는 임의 command name이나 raw IPC를 허용하지 않는다. message는 version, request id와 discriminated kind를 가진다.

```text
WebviewRequest
  session.open | session.writer.transfer | prompt.send | run.abort | permission.resolve
  queue.cancel | ui.ready | transcript.more

HostEvent
  snapshot | transcript.page | stream.event | permission.request
  queue.changed | writer.changed | process.changed | public.error
```

모든 inbound message는 runtime schema로 검증한다. Webview request는 active session/workspace binding을 host가 다시 확인한다. renderer가 전달한 path, provider id, session id를 authority로 사용하지 않는다.

### 9.2 재생성과 backpressure

- Webview `ui.ready` 이후 host가 authoritative snapshot과 cursor를 전송한다.
- live event에는 `sourceEpoch`와 source stream별 monotonic `sequence`가 있으며 gap 감지 시 해당 authoritative snapshot/page를 다시 요청한다.
- transcript는 page 단위로 불러오고 전체 JSONL을 한 번에 Webview에 전송하지 않는다.
- stream delta가 renderer 속도를 앞서면 text delta를 coalesce하되 lifecycle event 순서는 유지한다.
- VS Code Webview의 `getState`/`setState` 복원 상태는 scroll anchor, disclosure와 emergency draft snapshot만 소유한다. durable session, acknowledged draft나 delivery state를 소유하지 않는다.

## 10. 데이터 소유권

| 데이터 | 원본 | 1차 owner | 복구 원칙 |
| --- | --- | --- | --- |
| transcript/tree | Pi JSONL | Pi Host / Pi SessionManager | SDK와 read-only index로 재구성 |
| session catalog | SQLite projection | Core | JSONL에서 rebuild |
| draft | SQLite | Core | revision conflict 보존 |
| queue/recovery | SQLite ledger | Core + coordinator | 모호한 전달은 uncertain |
| session writer authority | Broker state + SQLite projection | Session Broker | writer epoch CAS와 client liveness로 재구성 |
| provider secret | VS Code SecretStorage | Extension host broker | Webview/SQLite/log 금지 |
| model/session runtime | Pi Host memory + JSONL | Pi Host | session reopen |
| UI transient state | Webview memory | Webview | dispose 시 유실 가능 |
| session UI restore state | VS Code Webview state | Webview | authoritative snapshot과 session ID를 대조한 뒤 scroll/disclosure만 복원 |
| UI preference | VS Code global/workspace state | Extension host | schema versioned |
| golden design references | repository test asset/manifest | design verification | checksum/version 고정 |

### 10.1 1차와 2차 데이터 격리

1차 extension database는 VS Code profile의 azrael-ex 전용 storage 경로를 사용하며 Session Broker만 연다. 기존 Electron app database와 같은 SQLite 파일을 동시에 열지 않는다. Pi JSONL은 canonical session source로 공유할 수 있지만 한 session에 두 runtime이 동시에 mutation lease를 갖지 못한다.

Broker에 연결된 여러 VS Code window는 같은 session을 read-only로 열 수 있으며 idle일 때 session writer를 명시적으로 전환한다. Pi CLI, Electron 또는 구버전 extension처럼 Broker protocol에 참여하지 않는 외부 owner가 mutation lease를 보유하면 history는 계속 읽되 writer 전환 control을 `external-owner` 사유로 비활성화한다. 강제 unlock이나 두 번째 Pi Host 생성은 하지 않는다.

2차 전환 시 metadata는 명시적인 import 또는 공통 service 전환으로 이동한다. 두 app database를 양방향 자동 동기화하지 않는다.

## 11. 핵심 제어 흐름

### 11.1 Session 생성과 열기

```text
User → Open Chat 또는 Sessions TreeView
     → Extension resolves one current VS Code WorkspaceFolder
     → Extension validates local URI, realpath, window membership and trust
     → Core registers/selects canonical workspace and returns workspaceId
     → Broker re-resolves workspaceId instead of trusting a UI path
     → existing session: read-only history projector verifies JSONL id/cwd without Pi Host start
     → new session: Broker acquires physical lease and Pi Host creates the session with canonical cwd
     → Core registers/reconciles workspaceId + sessionId and writer projection
     → Extension opens/reveals the bound Chat Webview
     → Webview receives public workspace label + snapshot/transcript page + writer control state
```

Pi Host가 반환한 workspace path가 요청 binding과 다르면 session을 성공으로 표시하지 않는다.
Pi session 생성은 성공했지만 Core projection 등록을 확인하지 못한 경우 자동으로 새 session을
다시 만들지 않고 `uncertain`으로 남긴다.

### 11.2 Prompt 전송

```text
Composer → typed prompt request
         → Host verifies active workspace/session/draft revision and expected writer epoch
         → Broker fences observers and stale former writers before durable queue acceptance
         → Coordinator renders approved context
         → Pi Host accepts prompt
         → normalized events receive source epoch + per-stream sequence
         → Core records only durable metadata/evidence
         → Webview renders public events
```

UI의 optimistic “전송됨” 표시는 Pi Host acceptance보다 먼저 확정되지 않는다.

### 11.3 Tool permission

```text
Pi Host tool preflight
  → public permission request
  → Coordinator risk/policy evaluation
  → Codex-style inline request + VS Code attention signal
  → user decision
  → Host validates request id/session/expiry
  → Pi Host allow or deny
```

Webview는 decision을 제안할 뿐 권한 상태를 직접 변경하지 않는다.

### 11.4 Crash와 불명확한 전달

Prompt 또는 queue dispatch 중 Pi Host가 종료되면 last accepted/delivered evidence를 확인한다. 전달을 증명할 수 없으면 자동 재시도하지 않고 `uncertain`으로 고정한다. 사용자는 transcript/catalog를 새로 scan한 뒤 resend 또는 dismiss를 선택한다.

## 12. Queue와 composer semantics

- idle에서 기본 submit은 prompt다.
- running에서 submit은 steer, 명시적 follow-up action은 follow-up queue다.
- queued item은 durable revision과 ordinal을 가진다.
- reorder/edit/cancel은 expected revision을 요구한다.
- abort는 Pi run을 중단하고 아직 전달되지 않은 item의 복구 상태를 명확히 분리한다.
- composer draft는 session별이며 autosave acknowledgement 이후에만 persisted 표시를 한다.
- UI는 queued, accepted, delivered, uncertain, failed를 하나의 “sent” 상태로 합치지 않는다.

## 13. Permission, trust와 credential

### 13.1 Workspace Trust

VS Code Workspace Trust를 1차 coarse gate로 사용한다. untrusted workspace에서는 session metadata와 설명 화면만 허용하고 Pi Host start, project resource loading, shell/write tool과 workspace-defined executable setting 사용을 막는다. VS Code 공식 API가 제공하는 `untrustedWorkspaces` capability와 `workspace.isTrusted`를 authoritative signal로 사용한다.

binding된 folder가 현재 window에서 제거되면 새 prompt, tool permission과 relative file action을
막고 `workspace unavailable` 상태로 전환한다. active run을 다른 folder로 옮기거나 자동
재전송하지 않는다. trust가 해제되면 새 command intake를 닫고 pending permission을
deny/cancel한 뒤 process lifecycle 계약에 따라 정리한다. folder가 다시 열려도 persisted
`folderUri`, canonical path와 Core `workspaceId`가 모두 일치하기 전에는 실행을 재개하지 않는다.

### 13.2 Tool-level permission

Workspace Trust가 tool 자동 승인을 의미하지 않는다. read/write/process/network/credential/external-path 범주를 기존 permission manager가 별도로 판정한다. allow-workspace는 canonical workspace identity와 policy revision에 묶인다.

### 13.3 Credential

- 1차 OpenAI 인증은 `openai-codex` + `oauth`로 고정하며 ChatGPT 구독 사용을 전제로 한다.
- API key 입력, 환경 변수 검색과 usage-based billing UI는 1차 제품면에서 제공하지 않는다.
- persistent secret은 `ExtensionContext.secrets`에 저장한다.
- runtime override는 memory에만 남긴다.
- Pi Host에 전달할 때 provider와 session scope를 명시한다.
- auth callback URL은 allowlist, state, loopback port와 expiry를 검증한다.
- Webview에는 configured/unconfigured, provider label과 public error만 전달한다.
- secret, encrypted reasoning, provider request/response, authorization header는 event, SQLite, telemetry, crash report에서 거부한다.

Pi Host의 `CredentialStore.modify`는 Extension host의 revisioned broker에 commit하고
SecretStorage write acknowledgement 뒤에만 새 credential을 durable로 간주한다. 이 규칙은
로그인 결과뿐 아니라 자동 refresh로 회전한 credential에도 적용한다. 상세 protocol과 logout
순서는 인증·runtime 설계가 소유한다.

## 14. 오류와 복구 UX

process failure, event delivery, draft/queue 내구성, scroll 복구, 초기 성능 budget과 release blocker는 [azrael-ex 안정성 및 품질 계약](azrael-ex-stability-quality-contract.md)을 따른다. 기능 성공과 UI 성공은 별도 상태가 아니며, 마지막 확인 content·draft·읽는 위치를 보존하지 못하는 복구는 성공으로 판정하지 않는다.

오류는 다음 사용자 상태로 투영한다.

| 상태 | 의미 | 사용자 동작 |
| --- | --- | --- |
| transient | 재연결/재시작 가능 | retry/restart |
| validation | 입력 또는 stale revision | 수정 후 재시도 |
| permission-denied | trust/policy/user deny | 범위 확인 |
| uncertain | 외부 side effect를 증명할 수 없음 | inspect 후 resend/dismiss |
| fatal | data/protocol/runtime 불일치 | diagnostics와 안전 종료 |

Codex 스타일 UI에서는 오류를 큰 dashboard로 분산하지 않고 관련 message/tool row 근처의 compact inline state와 한 개의 attention surface로 표현한다. 세부 정보는 disclosure와 diagnostics command에서 제공한다.

## 15. 로그와 진단

- VS Code OutputChannel에 redacted structured log를 기록한다.
- request/session correlation id와 process role을 포함한다.
- raw prompt, file content, credential, hidden reasoning은 기본 log에 기록하지 않는다.
- diagnostics snapshot은 package/runtime version, resolved Node path, process state, database schema version, last public error code만 포함한다.
- 사용자가 명시적으로 export하기 전 외부 전송은 없다.

## 16. 성능과 자원 경계

- extension activation만으로 Pi SDK와 SQLite를 즉시 시작하지 않는다.
- transcript는 virtualized/page rendering을 사용한다.
- streaming delta는 animation frame보다 자주 전체 React tree를 갱신하지 않는다.
- tool output, diff와 directory manifest는 byte/line/item 상한을 가진다.
- idle child retention은 active run, pending queue, session consumer 기준으로 결정한다.
- Webview reload가 child process restart를 요구하지 않는다.
- 시각 효과는 `prefers-reduced-motion`과 VS Code reduced-motion 신호를 존중한다.

## 17. 접근성과 키보드

- composer, transcript, tool disclosure, approval, queue는 mouse 없이 조작 가능하다.
- focus order는 header → transcript attention → composer controls 순서를 유지한다.
- streaming이 focus나 screen reader cursor를 강제로 이동시키지 않는다.
- color만으로 상태를 구분하지 않고 icon/text/status를 함께 사용한다.
- semantic heading, list, button과 live region을 사용한다.
- reference visual fidelity가 contrast 또는 VS Code high-contrast mode를 깨면 접근성 variant가 우선한다.

## 18. 호환성과 배포 경계

1차 PoC는 Windows VS Code Desktop의 현재 지원 version과 Node 22.19+를 기준으로 한다. web extension과 remote extension은 Node/Pi/filesystem/process 요구가 달라 별도 설계 없이 enable하지 않는다.

VSIX는 다음을 명시한다.

- minimum VS Code engine
- Node/Pi runtime resolution policy
- untrusted workspace capability
- platform support
- network/auth behavior
- data/secret storage location

Marketplace publication 전까지는 local VSIX 설치와 개발 host가 배포 경계다.

## 19. 2차 Electron 앱을 위한 비규범적 handoff 입력

이 절은 azrael-ex에서 안정화한 자산의 승격 후보를 기록한다. Pi Harness의 범위나 재사용 결정을 직접 확정하지 않으며, 2차 착수 시 [Pi Harness Workbench 설계](../pi-harness/README.md)에서 승인·수정한다.

### 19.1 재사용

2차는 다음을 1차에서 가져온다.

- shared command/event schema
- application coordinator
- Core와 Pi Host child bundles
- session/draft/queue/recovery semantics
- permission/credential port
- normalized view model
- reference-derived light token/component state specification
- deterministic fixtures와 golden reference manifest

### 19.2 재사용하지 않음

- 현재 `src/renderer/app-shell/` layout
- 현재 feature panel 배치와 CSS
- Electron에만 맞춘 preload method 집합의 형태
- VS Code native TreeView/QuickPick/notification adapter
- VS Code Workbench chrome를 전제로 한 화면 배치

### 19.3 2차의 고유 가치

Electron 앱은 다음 요구가 실제로 확인될 때 확장한다.

- VS Code가 설치되지 않은 독립 실행
- 여러 project/session을 IDE window와 독립적으로 장시간 관찰
- VS Code extension surface가 제한하는 multi-pane session orchestration
- 운영·리뷰 전용 화면 또는 non-editor workflow

2차 UI는 기존 화면을 polish하는 방식이 아니라 1차의 design system과 안정화된 view model을 사용해 새로 구성한다.

## 20. 변경과 보존 정책

- 기존 구현과 test는 1차 재사용 판정이 끝날 때까지 삭제하지 않는다.
- Electron 전용 기능은 공통 owner로 위장하지 않고 adapter에 남긴다.
- 공통 contract 변경은 1차와 기존 test fixture에 함께 반영한다.
- Phase 1 database와 기존 Electron database는 자동 merge하지 않는다.
- Pi JSONL mutation은 항상 Pi SDK owner를 통한다.
- 1차 안정화 중 발견한 구조적 결함은 낮은 품질의 UI patch로 감추지 않는다.

## 21. 결정된 대안

| 대안 | 결정 | 이유 |
| --- | --- | --- |
| 기존 Electron UI 계속 확장 | 보류, 2차로 이동 | 기능과 UI 문제를 동시에 디버깅하게 됨 |
| Pi TUI를 terminal에 embed | 제외 | VS Code native integration과 durable app semantics를 제공하지 않음 |
| 공식 pi-web-ui 전면 채택 | 제외 | generic Agent UI이며 현재 coding-agent/runtime contract와 직접 맞지 않음 |
| Pi SDK를 extension host에 in-process 로드 | 제외 | crash와 dependency failure가 extension 전체에 전파됨 |
| Pi RPC CLI를 유일한 backend로 사용 | 제외 | 기존 typed SDK adapter, compaction/permission bridge와 검증 자산 손실 |
| child Pi Host + 기존 coordinator | 채택 | 격리와 기존 안정성 계약을 동시에 유지 |
| 항상 첫 번째 VS Code workspace folder 사용 | 제외 | multi-root에서 active project와 다른 cwd·permission 경계를 고를 수 있음 |
| active editor 변경 때 기존 session cwd 변경 | 제외 | Pi JSONL identity와 실행/permission 경계가 session 도중 변함 |
| session 생성 시 한 folder에 immutable binding | 채택 | 복원 가능한 identity와 최소 permission scope를 함께 유지 |
| 여러 workspace root를 한 session 경계로 합침 | 제외 | 1차 permission, resource와 cwd 계약을 모호하게 만듦 |
| 기존 React renderer를 Webview로 이식 | 제외 | 현재 UI 품질 문제와 기능 복잡도를 그대로 가져옴 |
| 최소 Webview 후 reference-aligned UI | 채택 | 기능 안정성, interaction 근거와 시각 품질의 판정을 분리 |
| VS Code custom fork | 제외 | 배포·보안·업데이트 부담이 extension 범위를 초과 |

## 22. 불변조건

- Pi JSONL이 transcript 원본이다.
- Webview는 authority가 아니다.
- renderer/UI state만으로 durable 성공을 판정하지 않는다.
- 모호한 외부 side effect는 자동 재시도하지 않는다.
- credential과 hidden provider payload는 UI/DB/log에 노출하지 않는다.
- VS Code Workspace Trust와 tool permission을 같은 개념으로 합치지 않는다.
- 한 Pi session은 정확히 한 canonical VS Code workspace binding을 가지며 session 도중 자동 rebind하지 않는다.
- Pi session cwd, project resource root, relative file root와 workspace permission identity는 같은 binding에서 파생한다.
- Webview가 제공한 path와 단순 `workspaceFolders[0]`은 실행 authority가 아니다.
- session을 열어 history를 읽는 동작은 mutation lease, Pi AgentSession 또는 writer authority를 획득하지 않는다.
- 하나의 Pi JSONL session에는 물리 writer와 Pi Host가 최대 하나이며, Broker client 중 session writer authority를 가진 client도 최대 하나다.
- 모든 mutation은 request의 expected writer epoch와 현재 session revision을 함께 검증하고 stale writer의 요청을 Core queue 또는 Pi Host에 전달하지 않는다.
- 1차와 2차 app database에 동시 writer를 허용하지 않는다.
- reference alignment를 위해 VS Code unsupported DOM mutation이나 private Codex asset을 사용하지 않는다.
- 시각적 일치보다 접근성, 보안, 데이터 보존이 우선한다.

## 23. 설계 준비 상태와 열린 항목

### 23.1 상태

`ready`

제품 순서, 1차/2차 경계, process 책임, data ownership, message flow, permission, failure semantics,
UI reference와 품질 gate에 더해 ChatGPT OAuth credential broker, Pi runtime mapping, VS Code
folder 선택, immutable session binding, profile Session Broker, read-only open, session writer 전환,
trust/folder 변경과 설치 runtime 경계가 구현 계획을 만들
수 있을 만큼 결정되었다. Workspace 연동의 의존 순서와
검증/복구 책임은 저장소 외부 구현 계획이 소유한다.

### 23.2 구현 계획이 정할 수 있는 비차단 항목

- extension package layout은 root Electron package와 분리된 `azrael-ex/` 독립 package로 둔다.
- UI bundle과 VSIX 도구는 esbuild와 `@vscode/vsce`로 고정한다.
- 최소 VS Code engine version의 exact value
- Node executable discovery UI 문구
- screenshot runner와 pixel-diff는 같은 계획의 U7에 따라 Playwright로 고정한다.
- reference capture의 실제 PNG/manifest와 화면별 허용 오차 수치
- 1차 design token은 `azrael-ex/src/webview/styles/tokens.css`가 소유하며 2차 승격 시 common package로 분리한다.

### 23.3 사용자 확인이 필요한 향후 제품 선택

다음은 현재 설계를 막지 않지만 범위를 넓힐 때 사용자 결정이 필요하다.

- 1차 이후 Remote SSH/WSL/Dev Container 지원 우선순위
- Goal/ContextCapsule/compaction inspector 중 extension에 먼저 승격할 기능
- 2차 Electron 앱을 실제 배포 제품으로 유지할지 내부 실험으로 둘지
- 참고한 Codex 제품이 업데이트될 때 visual baseline을 재평가할 주기
- Broker protocol에 참여하지 않는 Electron/Pi CLI owner까지 협력형 writer 전환에 포함할지 여부와 해당 protocol

## 24. 근거

- [OpenAI Docs — ChatGPT & Codex changelog](https://learn.chatgpt.com/docs/changelog): Codex App의 project sidebar/thread/review 구조와 base theme, accent/background/foreground, UI/code font 조정 가능 범위
- [OpenAI Docs — Codex authentication](https://learn.chatgpt.com/docs/auth): ChatGPT 구독 로그인과 credential refresh
- [OpenAI Docs — Codex App Server](https://learn.chatgpt.com/docs/app-server): thread/turn/item, approval와 managed ChatGPT login 계약
- [OpenAI Docs — Codex IDE extension](https://learn.chatgpt.com/docs/ide): editor context, change review와 same-chat follow-up
- [VS Code Workspace Trust](https://code.visualstudio.com/api/extension-guides/workspace-trust): untrusted workspace capability와 runtime trust gate
- [VS Code Webview UX](https://code.visualstudio.com/api/ux-guidelines/webviews): Webview 사용 범위, theme와 accessibility 요구
- [Pi SDK](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md): AgentSession, model/auth, tools, resource loader, persistent session과 SDK/RPC 선택 기준
- [기존 초기 전체 설계](../pi-harness/initial-system-design.md): Pi JSONL, queue, context, compaction, recovery와 security의 역사적 입력
