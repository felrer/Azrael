# azrael-ex UI/UX 디자인 지침

- 상태: `ready` — 1차 제품의 규범적 디자인 계약
- 기준일: 2026-09-03
- 최근 개정: 2026-09-04 — 모델 응답 footer의 새 session Fork action 계약 추가
- 적용 대상: azrael-ex가 소유하는 VS Code Webview, 전용 icon과 상태 표현
- 상위 설계: [azrael-ex 우선 2단계 전체 설계](azrael-ex-two-phase-system-design.md)
- 근거·mapping 설계: [ChatGPT OAuth·Pi·reference-aligned UX 설계](azrael-ex-chatgpt-oauth-pi-reference-design.md)
- 동급 품질 계약: [azrael-ex 안정성 및 품질 계약](azrael-ex-stability-quality-contract.md)

이 문서는 Codex의 공개 계약·공식 제품 문서와 승인된 versioned 화면에서 확인한 특성을 azrael-ex의 화면 구조, 상태, 상호작용과 검증 기준으로 고정한다. 여기서 정한 규칙은 권고가 아니다. 접근성 예외를 제외하고 위반한 화면은 기능이 동작하더라도 완료로 판정하지 않는다.

## 1. 디자인 목표와 적용 경계

### 1.1 목표

azrael-ex의 주 작업면은 승인된 밝은 reference에서 측정한 다음 계약을 충족해야 한다.

- 정보 위계와 화면 밀도
- canvas, surface, border, shadow의 관계
- typography와 Markdown rhythm
- transcript, 작업 결과 card, composer의 geometry
- icon의 크기·굵기·상태 표현
- hover, focus, streaming, loading, error의 반응
- keyboard, screen reader, zoom과 reduced motion 동작

이 방향은 단순히 흰 배경과 둥근 입력창을 뜻하지 않는다. 적은 chrome, 맥락 안의 상태 표시, 점진적 공개, 안정적인 스크롤과 조용한 피드백을 함께 뜻한다.

### 1.2 extension이 소유하지 않는 면

VS Code의 title bar, Activity Bar, Primary Sidebar container, editor tab, QuickPick, notification, diff editor와 status bar chrome은 공개 Extension API가 렌더링한다. 이 영역은 다음 원칙을 따른다.

- unsupported DOM/CSS patch를 사용하지 않는다.
- VS Code 기본 icon과 theme token을 우선 사용한다.
- Activity Bar item은 View Container만 열며 editor Webview를 직접 여는 shortcut으로 쓰지 않는다.
- native surface를 Codex처럼 보이게 만들기 위해 custom fork나 강제 theme 설치를 요구하지 않는다.

정량적인 visual assertion은 extension이 소유하는 Webview 안에서 판정한다. native surface는 의미와 동작의 일관성을 판정한다.

### 1.3 테마 정책

- 기본이자 1차 reference 대상은 승인된 light baseline 한 가지다.
- 일반 light/dark VS Code theme와 무관하게 주 Webview 작업면은 baseline에서 측정한 고정 light palette를 사용한다.
- focus ring, selection, scrollbar와 Webview 외곽 경계는 VS Code host 상태를 함께 반영해 현재 editor와의 관계를 잃지 않는다.
- `vscode-high-contrast`, `vscode-high-contrast-light`, forced colors에서는 정확한 색상 일치보다 식별성과 대비를 우선하는 accessibility variant를 사용한다.
- dark baseline과 사용자 임의 accent 편집은 1차 완료 조건이 아니다.

## 2. 기준 화면과 측정 규칙

### 2.1 최초 골든 레퍼런스

사용자가 2026-09-02 대화에 첨부한 Codex 밝은 테마 화면을 최초 방향 기준 `codex-light-thread-review-composer-001`로 식별한다. 2026-09-04에 첨부한 header/menu/session-list 화면군은 `codex-light-session-management-001`로 식별하며 네 control의 순서, floating surface grouping과 running ring의 방향 기준이다. 둘 다 source implementation이 아니라 C 등급의 시각 관찰 근거다. 공개 App Server/IDE 문서에서 확인한 A·B 등급 interaction contract와 충돌하면 상위 근거를 따른다. 이 화면군에서 고정하는 관찰 특성은 다음과 같다.

- 거의 흰색인 중립 canvas와 매우 미세한 cool-gray 구분
- 좁고 조용한 상단 bar, 얇은 stroke icon, 텍스트 중심 title
- bubble을 남용하지 않는 단일 column transcript
- 넉넉한 문단 간격과 읽기 쉬운 본문 line height
- code/제품명을 낮은 명도의 rounded inline pill로 표시
- link와 핵심 action에만 제한적으로 쓰는 blue accent
- 얇은 border와 낮은 elevation을 가진 작업 결과 card
- card header의 결과 요약, 되돌리기와 검토 action, compact file rows
- 화면 하단에 떠 있는 큰 rounded composer
- composer 내부 하단의 context/permission/model/run 상태와 원형 submit action
- secondary environment switcher를 composer 바깥 하단에 배치
- 중요한 정보는 보이되 상세 정보는 disclosure 뒤에 두는 구조

대화 첨부 이미지는 repository asset이 아니므로 checksum 가능한 영구 기준으로 간주하지 않는다. 구현 착수 시 사용 권한이 확인된 원본 capture를 다음 manifest와 함께 저장해야 정량 비교를 시작할 수 있다.

| 필드 | 계약 |
| --- | --- |
| reference id | 변경되지 않는 논리 ID |
| app/version | 캡처한 Codex App version |
| capture date | 현지 날짜와 timezone |
| OS/display | OS, pixel ratio, scaling, font smoothing |
| viewport | CSS pixel과 physical pixel 크기 |
| theme | light, accent/background/foreground 설정 |
| fonts | UI/code font family와 available fallback |
| fixture | session/event fixture version |
| image | lossless PNG와 SHA-256 |
| masks | cursor, timestamp 등 비결정 영역 |

### 2.2 측정 우선순위

정확한 color, spacing, radius, font size와 shadow는 눈대중으로 정하지 않고 골든 이미지에서 측정한다. 충돌 시 우선순위는 다음과 같다.

1. 데이터 보존, 보안과 명확한 상태
2. keyboard 및 접근성
3. reference와 동일한 geometry 및 typography
4. reference와 동일한 color 및 elevation
5. 장식적 motion

### 2.3 골든 화면군

하나의 정상 화면만 비교하지 않는다. 다음 상태를 동일 fixture와 canonical viewport로 고정한다.

| 화면군 | 필수 상태 |
| --- | --- |
| 시작 | first run, empty workspace, empty session, loading |
| 인증 | signed-out, signing-in, signed-in, needs-login, persistence error |
| 대화 | 짧은 대화, 긴 Markdown, code block, list, link, attachment |
| 실행 | thinking, streaming text, tool queued/running/succeeded/failed |
| 변경 | edited-files summary, collapsed/expanded rows, VS Code diff 진입 |
| 승인 | allow once, session/workspace 범위, deny, expired/stale |
| queue | steer, follow-up, reorder, cancel, revision conflict |
| 복구 | offline, reconnecting, recovered, uncertain, fatal |
| composer | empty, draft saved/saving/conflict, running/stop, validation error, compaction failed/rollback uncertain |
| 접근성 | keyboard focus, 200% zoom, reduced motion, high contrast |

## 3. 시각 시스템

### 3.1 의미 token

component가 직접 hex, font, radius 또는 shadow 값을 소유하지 않는다. 측정값은 아래 의미 token에만 연결한다.

| 범주 | 필수 token 역할 |
| --- | --- |
| canvas | app canvas, transcript canvas, scrim |
| surface | base, raised, subtle, hover, active, selected |
| border | subtle, default, strong, focus |
| text | primary, secondary, tertiary, inverse, link, code |
| status | neutral, info, success, warning, danger, uncertain |
| type | body, body-strong, caption, label, title, code, code-small |
| space | inline, control, row, section, page gutter |
| shape | inline pill, control, card, composer, circular action |
| depth | flat, floating-control, modal-only |
| motion | instant, quick, disclosure, progress |

token은 `primitive → semantic → component alias`의 단방향 참조를 사용한다. 예를 들어 file result의 녹색은 component에 직접 쓰지 않고 `status.success.foreground`를 참조한다. 2차 Electron 앱도 semantic token부터 재사용하며 VS Code 전용 alias는 가져가지 않는다.

### 3.2 색과 명암

- 주요 hierarchy는 배경색 블록보다 여백, type weight와 divider로 만든다.
- 흰색에 가까운 surface 여러 개를 큰 명암차로 구분하지 않는다.
- primary text는 검정이 아니라 장시간 읽기에 맞는 dark neutral로 측정한다.
- blue는 link, focus 또는 명확한 primary action에만 사용한다.
- success/warning/danger 색은 결과 의미가 있을 때만 사용하고 일반 장식에 쓰지 않는다.
- muted text만으로 필수 상태를 전달하지 않는다.
- 카드 shadow는 border를 보조하는 수준으로 제한하며 중첩 카드마다 elevation을 올리지 않는다.

### 3.3 Typography

- UI text와 code text를 분리한다.
- 본문 폭과 line height는 긴 한국어/영문 Markdown을 한 번에 읽기 편한 수준으로 유지한다.
- heading은 크기 변화보다 weight와 상하 여백을 먼저 사용한다.
- path, command, model id, code symbol만 code font를 사용한다.
- inline code pill은 문장 baseline을 깨거나 행 높이를 갑자기 키우지 않는다.
- 사용자가 VS Code의 UI/code font를 바꾼 경우 fallback 가능성을 보장하되 reference capture는 manifest의 고정 font로 판정한다.

### 3.4 공간과 형태

- transcript는 중앙의 편안한 reading column과 responsive gutter를 가진다.
- composer와 result card는 동일한 page rhythm에 맞추되 같은 폭일 필요는 없다.
- card 내부 row는 시각적 표가 아니라 읽을 수 있는 작업 기록처럼 보이게 한다.
- rounded rectangle을 모든 container에 적용하지 않는다. 의미 있는 grouping 또는 floating surface에만 쓴다.
- icon-only control은 일정한 hit target, stroke weight와 tooltip을 가진다.
- 같은 depth에 있는 control은 radius와 border contrast를 공유한다.

### 3.5 Motion

- streaming cursor, disclosure, progress와 composer 상태 전환만 motion을 허용한다.
- layout 이동이 사용자의 읽는 위치를 바꾸면 animation을 사용하지 않는다.
- opacity와 transform 중심으로 짧게 전환하고, 높이 변화는 실제 상태 이해에 필요할 때만 사용한다.
- `prefers-reduced-motion`에서는 decorative transition을 제거하고 상태 변화는 즉시 반영한다.

## 4. 화면 구조 계약

```text
Webview editor surface
├─ quiet session header
│  ├─ navigation/title
│  └─ contextual actions and connection state
├─ scroll viewport
│  ├─ transcript column
│  ├─ attention surface, only when required
│  └─ terminal spacer owned by composer geometry
└─ sticky/floating composer region
   ├─ context and attachment chips
   ├─ autosizing editor
   ├─ validation/status line
   └─ permission · model · run controls · submit/stop
```

- header는 product chrome처럼 크고 무겁게 만들지 않는다.
- transcript만 주 scroll owner다. nested transcript scroll을 만들지 않는다.
- composer는 content를 가리지 않는다. transcript bottom inset은 실제 composer 높이와 동기화한다.
- 새 내용이 생겨도 사용자가 과거를 읽고 있으면 scroll position을 보존한다.
- reading column이 너무 넓어지지 않으며 좁은 editor에서는 card action을 wrap 또는 overflow menu로 이동한다.
- sidebar TreeView는 session 탐색과 attention 요약만 담당하고 chat surface를 축소 복제하지 않는다.

## 5. Component 계약

### 5.1 Session header

- session title이 primary label이며 workspace/model/status는 secondary다.
- 상시 노출 action은 뒤로가기, history/reopen, settings와 compose 계열 중 실제로 지원하는 최소 집합만 둔다.
- azrael-ex chat header 우측 action은 `세션 작업 → 최근 세션 → 계정 → 새 세션` 순서이며 세부 동작은 [Codex형 세션 관리 UI](session-management-ui-design.md)를 따른다.
- icon-only button은 label, tooltip, disabled reason과 focus style을 갖는다.
- 연결 상태가 정상일 때 색 badge를 계속 노출하지 않는다. 이상 상태만 짧은 text와 icon으로 승격한다.

### 5.2 Transcript

- user와 assistant를 과도하게 다른 bubble로 분리하지 않고 author/spacing/content rhythm으로 구분한다.
- Markdown의 heading, paragraph, list, table, quote, code block은 하나의 vertical rhythm을 공유한다.
- long content는 임의로 자르지 않는다. tool output처럼 상한이 필요한 content만 명시적 truncated marker와 원본 열기 action을 제공한다.
- copy, feedback, retry 같은 secondary action은 hover/focus 또는 message footer에서 조용히 나타난다.
- 완료되어 durable하게 확인된 각 visible assistant 응답에는 footer의 `Fork` icon action을 정확히 하나
  둔다. accessible label은 `새 세션으로 분기`이며 pointer hover뿐 아니라 keyboard focus에서도 보인다.
- streaming 중이거나 source session이 running/compacting/editing/recovery/untrusted 상태이면 Fork를
  실행하지 않고 disabled reason을 tooltip과 screen reader text로 제공한다. 과거 응답과 compaction
  이전 응답이라는 이유만으로 action을 숨기거나 disable하지 않는다.
- live streaming 영역은 화면 낭독기에 token 단위로 소음을 만들지 않도록 묶어서 알린다.

### 5.3 Thinking과 tool activity

- thinking과 tool detail은 기본 compact summary로 표시하고 disclosure로 연다.
- queued, running, succeeded, failed, denied, uncertain을 icon·label·색의 조합으로 구분한다.
- spinner만으로 실행 상태를 설명하지 않는다.
- tool row는 command/path/result를 한눈에 읽을 수 있어야 하며 raw event 이름을 사용자에게 노출하지 않는다.
- 실패한 step의 복구 action은 해당 row 가까이에 둔다.

### 5.4 Edited-files summary와 review

첨부 기준 화면의 edit card 구조를 기본 패턴으로 삼는다.

- header에는 변경한 file 수, add/delete 요약과 대표 action을 둔다.
- file row에는 normalized display path와 해당 file의 add/delete 수를 둔다.
- 많은 file은 초기 행을 제한하고 `Show N more files`로 확장한다.
- `Review`는 custom diff를 열지 않고 VS Code diff editor로 연결한다.
- `Undo`는 영향을 받는 file/operation 범위를 확인할 수 있어야 하며 위험한 일괄 되돌리기는 별도 명시적 확인을 거친다.
- path가 길면 중간을 생략하되 hover와 accessible name에 전체 path를 제공한다.

### 5.5 Floating composer

- composer는 화면의 주 action surface이며 항상 가장 안정적인 geometry를 가진다.
- 입력 영역은 content에 따라 자라되 transcript를 모두 밀어내지 않도록 최대 높이 후 내부 scroll로 전환한다.
- placeholder는 도움말을 대신하지 않으며 전송 가능 여부를 색만으로 표현하지 않는다.
- attachment/context chip은 source와 제거 action이 명확해야 한다.
- permission scope, model, thinking과 execution state는 footer의 compact control로 둔다.
- idle의 primary action은 send, running의 primary action은 stop 또는 현재 contract상 허용된 steer다. icon과 accessible label을 함께 갱신한다.
- 현재 panel에서 compaction이 실패하면 composer 바로 위에 같은 reading column 폭의 compact inline
  alert를 표시한다. Transcript row나 floating toast로 만들지 않는다.
- draft 상태는 `saving`, `saved`, `conflict`, `local only`를 구분하되 정상 `saved`를 계속 강조하지 않는다.
- IME composition 중 Enter로 전송하지 않으며 Shift+Enter와 사용자 keybinding을 존중한다.

### 5.6 Permission과 위험 action

- permission 요청은 해당 tool step 가까이의 attention surface에 표시한다.
- 무엇이, 어느 workspace/path/network target에서, 어떤 범위로 허용되는지 먼저 설명한다.
- allow-once를 가장 좁은 기본 선택으로 두고 session/workspace 허용은 범위를 명시한다.
- deny와 close를 같은 의미로 취급하지 않는다.
- 시간이 지난/stale 요청은 decision control을 disable하고 새 상태로 교체한다.
- 반복 승인 억제 선택은 실제 permission policy와 연결될 때만 표시한다.

### 5.7 오류, 재연결과 알림

- 관련 영역에서 해결 가능한 오류는 inline으로 표시한다.
- compaction 실패 alert는 `role="alert"`를 사용하고 `실패 사실 → 대화 보존 여부 → 정제된 원인`
  순서로 쓴다. 정상 rollback이면 닫기 action을 제공하고 focus와 draft를 유지한다.
- alert를 닫아도 context 원형 control의 danger tone과 menu 상세는 다음 compaction 시작/성공까지
  유지한다. Rollback을 검증하지 못한 경우에는 보존을 주장하지 않고 recovery attention surface와
  read-only 상태를 우선한다.
- compaction 실패를 transcript item, 자동 focus와 native notification으로 중복 표현하지 않는다.
- app 전체에 영향을 주는 연결 문제는 한 개의 persistent attention surface로 합친다.
- notification은 백그라운드 완료, 현재 화면 밖의 질문 또는 즉시 조치가 필요한 실패에만 사용한다.
- 같은 원인의 notification을 반복 생성하지 않는다.
- 오류 문구는 `무슨 일이 일어났는지 → 무엇이 보존됐는지 → 다음 action` 순서로 쓴다.
- 자세한 stack/log는 기본 화면에 펼치지 않고 OutputChannel 또는 diagnostics action으로 연결한다.

## 6. 상호작용과 상태 전이

### 6.1 상태가 먼저다

모든 component는 최소한 다음 상태를 설계·fixture·검증한다.

`rest`, `hover`, `focus-visible`, `active`, `disabled`, `loading`, `success`, `warning`, `error`, `stale`.

backend lifecycle을 한 개의 boolean `loading`으로 축약하지 않는다. prompt dispatch는 `queued`, `accepted`, `delivered`, `failed`, `uncertain`을 구분한다. tool은 `queued`, `awaiting-approval`, `running`, `completed`, `failed`, `denied`, `aborted`, `uncertain`을 구분하고 run settlement와 혼합하지 않는다.

### 6.2 Optimistic UI 제한

- text 입력, disclosure와 local selection은 즉시 반영할 수 있다.
- prompt delivery, permission, undo, queue mutation과 durable draft 저장은 owner acknowledgement 전 성공으로 표시하지 않는다.
- optimistic mutation이 거절되면 이전 값을 조용히 덮지 않고 conflict와 사용자의 입력을 보존한다.

### 6.3 Scroll 계약

- 사용자가 bottom vicinity에 있을 때만 새 stream을 따라간다.
- 사용자가 위로 스크롤하면 auto-follow를 중단하고 `최신으로 이동` affordance를 제공한다.
- image/code/tool disclosure 로딩으로 높이가 바뀌어도 현재 anchor item과 offset을 보존한다.
- session 전환 시 session별 scroll anchor를 저장하고 복원한다.
- reconnect, Webview reload와 pagination이 동일 message를 중복 삽입하거나 위치를 초기화하지 않는다.

### 6.4 Keyboard와 focus

- Tab 순서는 화면의 시각 순서와 일치한다.
- 새 message나 stream은 focus를 빼앗지 않는다.
- permission과 fatal error처럼 즉시 판단이 필요한 새 surface도 announce만 하고 자동 focus하지 않는다. 사용자가 shortcut으로 이동한다.
- Escape는 현재 disclosure/menu/modal의 한 단계만 닫으며 draft를 지우지 않는다.
- VS Code 표준 command/keybinding system으로 모든 주요 action에 접근할 수 있다.
- focus ring은 mouse click 때 상시 노출하지 않고 `focus-visible`에 명확히 노출한다.

## 7. 문구와 정보 표현

- UI 언어는 한 화면 안에서 섞지 않는다. code, command, model id와 고유명사만 원문을 유지한다.
- 상태 label은 명사보다 현재 의미가 분명한 짧은 동사를 우선한다.
- `Error`, `Failed`만 표시하지 않고 사용자가 할 수 있는 다음 행동을 제공한다.
- 위험 action button은 `확인` 대신 실제 행위인 `실행 허용`, `다시 보내기`, `변경 되돌리기`를 쓴다.
- 내부 구조인 RPC, reducer, event type, SQLite revision은 진단 화면 밖에서 노출하지 않는다.
- 숫자 요약과 file path는 locale에 따라 의미가 바뀌지 않도록 일관된 표기를 사용한다.

## 8. Responsive, zoom과 접근성

- canonical viewport 외에도 editor 폭 480 CSS px, 200% zoom과 대표 high-DPI scaling에서 기능이 손실되지 않아야 한다.
- 좁은 폭에서는 action을 overflow로 이동하되 primary action과 현재 상태를 숨기지 않는다.
- 200% zoom에서 양방향 page scroll을 요구하지 않는다. 긴 code block만 자체 horizontal scroll을 가질 수 있다.
- text와 interactive control은 WCAG AA 대비를 최소선으로 사용한다.
- hit target은 pointer와 touchpad에서 안정적으로 누를 수 있는 크기를 유지한다.
- icon-only control은 accessible name을 갖고 decorative icon은 accessibility tree에서 제외한다.
- status announcement는 `polite`와 `assertive`를 구분하고 streaming token을 그대로 읽지 않는다.
- high contrast에서는 border, focus와 selection을 system color로 대체할 수 있다.

## 9. 금지 패턴

- 모든 기능을 card나 panel로 분할한 dashboard
- user/assistant/tool을 큰 색상 bubble로 반복 구분
- 같은 상태를 sidebar, header, composer, toast에서 동시에 강조
- 성공 toast의 반복, 끝나지 않는 progress notification
- hover에서만 접근 가능한 필수 action
- spinner만 있고 설명이나 timeout이 없는 대기
- scroll-to-bottom 강제, streaming 중 focus 이동
- raw JSON/event/stack을 기본 transcript에 노출
- 권한 범위를 숨긴 `Allow` button
- CSS에 산재한 임의 color/radius/spacing
- 골든 화면 한 장에만 맞춘 fixed viewport layout
- Codex logo, 비공개 asset 또는 source를 제품 식별에 사용

## 10. 디자인 판정 게이트

### 10.1 자동 판정

- semantic token 외 direct visual literal 검출
- component/state story 또는 fixture 누락 검출
- canonical viewport screenshot diff
- text reflow와 scroll-anchor regression
- keyboard-only smoke와 automated accessibility scan
- reduced-motion/high-contrast/200% zoom capture

pixel diff 하나만으로 pass/fail을 결정하지 않는다. font rasterization과 OS capture noise는 manifest에 기록한 tolerance/mask로 분리하되 geometry, clipping, missing state와 wrong token은 mask하지 않는다.

### 10.2 사람 판정

릴리스 후보는 다음 질문에 모두 답해야 한다.

- 첫 5초 안에 현재 session, 실행 상태와 다음 action을 알 수 있는가?
- 긴 대화를 읽을 때 card chrome보다 content가 먼저 보이는가?
- stream, reconnect, approval과 error가 읽는 위치나 draft를 방해하지 않는가?
- 위험 action의 대상과 범위를 실행 전에 이해할 수 있는가?
- mouse 없이 동일한 결과에 도달할 수 있는가?
- 첨부 reference와 나란히 놓았을 때 공간·type·surface rhythm이 같은 제품군으로 보이는가?

### 10.3 변경 통제

- token 또는 shared component 변경은 영향을 받는 전체 골든 화면군을 재검토한다.
- 참고한 Codex 제품 업데이트를 발견해도 baseline을 자동으로 교체하지 않는다.
- baseline 변경은 이전/새 capture, 변경 이유, 접근성 영향과 2차 Electron 영향까지 기록한다.
- 일시적 CSS 예외는 issue와 만료 조건 없이 허용하지 않는다.

## 11. 근거

- [OpenAI Docs — ChatGPT & Codex changelog](https://learn.chatgpt.com/docs/changelog): Codex의 theme/font 설정, floating composer, approval panel, reconnect 중 content 유지, conversation별 scroll과 오류 안내 개선
- [OpenAI Docs — Codex App Server](https://learn.chatgpt.com/docs/app-server): thread/turn/item, approval correlation과 stream lifecycle
- [OpenAI Docs — Codex IDE extension](https://learn.chatgpt.com/docs/ide): editor context, change review와 same-chat follow-up
- [VS Code — Webview UX](https://code.visualstudio.com/api/ux-guidelines/webviews): Webview 최소 사용, themeability, accessibility와 active-window 원칙
- [VS Code — UX Guidelines](https://code.visualstudio.com/api/ux-guidelines/overview): native container와 item의 역할
- [VS Code — Views](https://code.visualstudio.com/api/ux-guidelines/views): TreeView 우선, view 수와 custom Webview View 제한
- [VS Code — Notifications](https://code.visualstudio.com/api/ux-guidelines/notifications): notification 절제, progress timeout과 contextual feedback
