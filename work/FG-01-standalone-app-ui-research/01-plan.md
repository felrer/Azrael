상태: Windows x64 독립 앱 구현 중 · 기존 채팅 기록/대화/이미지 UI 재사용, 텍스트·터미널 패널만 신규 구현.

# Azrael 독립 앱: 상용 하네스 UI 조사와 구현 방향

## 목적과 권한

기존 Azrael 엔진에 VS Code extension이 아닌 자체 앱을 연결한다. 현재 확장의 스타일, 입력란(composer), 대화 렌더러를 재사용한다. 사용자는 간결한 대화 화면, 상태가 보이는 기존 채팅 기록, 필요할 때 여는 상세 패널 구성을 승인했고 텍스트 뷰어와 터미널 구현을 요청했다. 이 범위의 앱·UI 구현과 필요한 검증은 허용된다. 제품 배포본 생성·설치, 엔진 재구축, 실제 계정·대화 데이터 이동은 별도 요청이 없다.

이 문서는 같은 작업의 조사·합의·구현·검증을 관리한다. 승인된 범위는 아래와 같으며 상용 제품의 다른 기능은 구현 범위가 아니다. 제품의 기존 권한·큐·질문·계정·복구 의미는 보존한다.

## 승인된 UI 범위

- 중앙의 기존 대화 렌더러·composer와 스타일을 재사용한다.
- 세션 목록은 이미 있는 **채팅 기록**을 재사용하고 독립 앱의 탐색에 맞게 연결한다. 별도의 세션 목록·상태 저장소를 만들지 않는다.
- 상세 패널에 `.txt`, `.md`, 코드 등 텍스트 문서를 여는 읽기 전용 뷰어와 직접 입력 가능한 터미널을 구현한다. Markdown은 텍스트 문서로 읽으며 실행·편집 기능을 추가하지 않는다.
- 이미지 뷰어는 기존 Codex 구현을 그대로 재사용한다. 별도 이미지 뷰어를 만들지 않는다.
- 신규 diff/PR 검토, 결과물 관리, 브라우저, 자유 도킹·분리 창, 전체 IDE, 새 예약·원격 인계 UI 등 나머지 추가 제안은 보류한다. 기존 기능을 삭제한다는 의미는 아니다.
- 첫 연결·검증은 실제 호스트와 기존 실행기의 동작으로 확인한다. 독립 앱에서 기존 UI가 실행된다는 것을 정적 코드만으로 주장하지 않는다.

## 먼저 결정할 사항

1. **화면 중심은 확정:** 기존 채팅 기록 + 중앙 대화/composer + 선택형 텍스트/터미널 상세 패널. 이미지 표시·조작은 기존 Codex UI로 연결한다.
2. **최초 플랫폼 확정:** Windows x64부터 구현·실행 검증한다. Linux x64와 macOS ARM64는 공통 구조를 보존하면서 후속 수용을 진행한다. 기존 확장 지원 범위는 변경하지 않는다.
3. **확장과의 공존:** 전환 중 같은 엔진·대화를 두 표면에서 사용하는지, 독립 앱에서 시작한 작업만 우선 다룰지 결정해야 한다. 대화 공유, UI 초안 공유, 실행 중인 작업 소유권은 별개의 계약이다. 자동 이관이나 임의의 별도 상태 홈 생성을 가정하지 않는다.
4. **창 닫기와 백그라운드 실행:** 마지막 창을 닫아도 계속 실행하는 UX가 필요한지 정해야 한다. 현재 런타임 수명 계약을 확인하기 전에는 앱 종료 후 작업 지속을 약속할 수 없다.

## 조사 범위와 증거 수준

### 구현 소유와 준비 산출물

root는 Electron main/preload/실행·검증 통합, 파일 서비스, 문서와 최종 수용을 소유한다. 별도 구현 owner는 `renderer/detail-panel.mjs`, `.css`와 `vscode-host.cjs`를 각각 맡는다. 조사 owner는 소스 수정 없이 UI host seam과 엔진 proxy를 확인했다. 사용자 승인 없는 기능 추가·엔진 변경·설치는 하지 않는다.

Electron은 기존 Chromium UI와 Node host 서비스를 재사용하기 위한 구현 선택이다. 새 UI를 다시 그리지 않고 기존 준비된 host bundle을 읽어 연결하는 호환 계층을 먼저 검증한다. `AppServerTransport`는 valid window context와 dedicated Azrael entry를 주면 기존 native shared proxy를 사용한다. 계정 management-only bridge를 채팅용으로 전용하지 않는다.

의존성은 `apps/azrael-desktop/node_modules`에 설치하며 소스 앱의 실제 실행·검증 소비자가 있는 개발 runtime이다. 원본 `extensions/azrael-ex/node_modules`와 설치된 Azrael 경로는 수정하지 않는다. 설치 준비 로그의 소유자는 이 작업(root)이고 경로는 `artifacts/logs/standalone-app-ui/dependency-install.log`다. 임시 검증 상태와 renderer bundle은 후속 실행 전 해당 run에 귀속시키고 필요 종료 후 기존 owner로 정리한다. 배포용 패키지 생성은 선택하지 않았다.

조사 기준일은 2026-11-02(Asia/Seoul)다. 공식 문서와 공식 제품 공개 화면을 사용했다. 검색 요약과 실제 열린 문서가 다르면 열린 문서를 기준으로 삼았다. 유료 앱에 로그인하거나 제품을 설치해 사용성·성능·요금제별 가용성을 검증하지 않았다. 기능 표는 공식 설명의 확인이며 모든 클라이언트·OS에서 동일하게 동작한다는 뜻이 아니다.

공개 화면의 시각 확인은 Browser로 Devin 공식 문서의 제품 스크린샷과 Antigravity 공식 문서의 앱 미리보기에 한정했다. Antigravity 미리보기는 제품 설치본의 실행 증거가 아니다. Cursor 공개 글은 열렸으나 동영상 일부가 검게 표시되고 직접 이미지 URL은 브라우저에서 차단되어 세밀한 시각 평가 근거로 사용하지 않았다. Claude·Codex·Warp는 공식 UI 설명을 기준으로 비교했다. 스크린샷 파일이나 설치·빌드 산출물은 생성하지 않았다.

## 상용 제품 비교

아래의 'Azrael 적용'은 제품 설명으로부터 도출한 설계 제안이다. 각 제품의 기능을 전부 추가하자는 뜻은 아니다.

| 제품 / 표면 | 확인한 UI 구성과 기능 | Azrael 적용 제안 | 초기 도입 부담 |
| --- | --- | --- | --- |
| **Codex / ChatGPT desktop의 Codex** | 프로젝트와 병렬 채팅, 파일·브라우저 작업. 코드 검토는 별도 pane에서 범위를 바꾸고 줄 단위 피드백을 제공한다. Git 변경과 마지막 턴 변경을 구분하고 worktree로 병렬 작업을 격리한다. | 기존 OpenAI 스타일과 채팅을 기준점으로 삼는다. 프로젝트·대화 탐색, 별도 결과 검토, 실행 위치 표시를 우선한다. | 기존 표현 재사용은 유리하다. Git 제어와 worktree 수명은 별도 구현·검증이 필요하다. |
| **Claude Code desktop** | chat·diff·browser·terminal·file·plan·tasks·subagent pane. 세션 옆 카드에 실행 위치, 변경, 실행 중 항목, context를 표시한다. pane 재배치·크기 조절·분리 창, 대화 상세도 전환, diff 줄 피드백을 제공한다. | 필요한 순간에 여는 보조 패널, 실행 세션 요약, 상세 로그 접기를 참고한다. | 패널 탭은 중간. 자유 도킹·분리 창은 큰 별도 범위다. |
| **Cursor Agents Window** | 여러 저장소·실행 환경의 에이전트를 한 작업 공간에서 관리한다. 새 diff 보기, 파일 검색·열기, 병렬 작업과 로컬·클라우드 인계, worktree가 있다. | 프로젝트별 세션 탐색과 작업 결과를 함께 배치한다. 전체 IDE 기능과 세션 관리 UI를 분리해 계획한다. | 탐색·상태 표시는 중간. IDE/LSP와 환경 인계는 크다. |
| **Google Antigravity App** | 현재 공식 문서는 IDE와 독립된 desktop command center를 설명한다. 시각 sidebar·review pane에서 계획, diff, 기록 영상, interactive HTML 결과물을 다룬다. | 결과물을 채팅 메시지에만 가두지 않고 다시 열 수 있는 검토 영역으로 연결한다. | 결과 목록·기존 파일 미리보기는 중간. HTML 실행 격리·브라우저 제어는 별도다. |
| **Warp** | 세로 탭에 cwd·branch·agent 상태·diff·읽지 않은 활동을 표시한다. 관리 표면은 실행 상태, 출발점, 사용자, 부모·자식 관계, 사용량과 세션 상세를 연결한다. | '입력 필요'와 오류를 대화를 열기 전에 찾게 한다. 세션 행은 간결하게 하고 상세 정보는 펼친다. | 상태 투영은 중간. 새로운 집계·원격 운영 서비스는 별도다. |
| **Devin** | 대화와 작업 환경을 나란히 두고 Progress·Shell·Code·Browser를 연결한다. 작업 단계에서 상세 로그로 이동하고, 사용자가 개입·인계할 수 있다. Side Chat은 본 작업과 분리된다. | 채팅의 도구·작업 항목을 클릭하면 관련 실행·파일·화면이 오른쪽에 열리게 한다. | 항목 연결은 중간. interactive IDE·desktop takeover·side chat은 독립 기능이다. |

비교 근거: [Codex 앱](https://learn.chatgpt.com/docs/app), [Codex 코드 검토](https://learn.chatgpt.com/docs/code-review), [Codex worktrees](https://learn.chatgpt.com/docs/environments/git-worktrees), [Claude desktop](https://code.claude.com/docs/en/desktop), [Cursor Agents Window](https://cursor.com/docs/agent/agents-window), [Antigravity 개요](https://antigravity.google/docs/overview?app=antigravity), [Antigravity artifacts](https://antigravity.google/docs/artifacts/), [Warp 세로 탭](https://docs.warp.dev/terminal/windows/vertical-tabs/), [Warp 실행 관리](https://docs.warp.dev/platform/managing-cloud-agents/), [Devin Session Tools](https://docs.devin.ai/work-with-devin/devin-session-tools).

### 제품별로 특히 참고할 부분

- **OpenAI:** 기본 시각 언어와 프로젝트·대화·검토의 분리. 현재 공식 경로는 Codex 기능을 ChatGPT desktop 문서 안에서 설명하므로 과거 Codex 앱 화면과 현재 기능을 혼동하지 않는다. Git 전체 변경을 '이 에이전트가 만든 변경'으로 표시해서는 안 된다.
- **Claude:** 채팅 옆 요약 카드와 상황에 따라 추가되는 pane. 도구를 모두 처음부터 노출하지 않아도 복잡한 작업을 다룰 수 있다는 참고 사례다. 문서에 레이아웃 버전 조건과 이전 레이아웃이 함께 있으므로 특정 설치본의 모습으로 단정하지 않는다.
- **Cursor:** 세션 관리와 결과 검토의 연결. 패널 확장 시 떠 있는 입력 막대로 작업을 이어가는 후속 사례는 [full-screen tabs](https://cursor.com/changelog/3-4)에 있다. Azrael에서 입력란을 복제할 근거는 아니며 한 composer의 소유권을 보존하는 방식으로 검토한다.
- **Antigravity:** 계획·보고서·화면 증거를 지속적인 결과물로 취급하는 방식. 기존 Agent Manager/IDE 글을 현재 독립 App의 기능 범위로 그대로 옮기지 않는다.
- **Warp:** 상태가 보이는 탐색 행과 부모·자식 실행의 구분. 특히 부모의 종료가 자식 전체 완료를 의미하지 않는다는 점은 Azrael의 현재 실행 의미와 함께 보존할 가치가 있다.
- **Devin:** 진행 단계와 실제 명령·파일·브라우저 화면의 연결. 공개 스크린샷에서 채팅·입력란 옆에 Shell 및 Command History를 둔 구성을 확인했다. 수동 인계와 단순 미리보기는 서로 다른 기능으로 계획해야 한다.

이 문단의 근거는 위 공식 문서와 [Cursor full-screen tabs](https://cursor.com/changelog/3-4)다. 색상 수치·모서리·애니메이션 시간 등을 실제 제품에서 측정한 것은 아니다.

## 조사에서 도출한 UI 원칙

다음은 Azrael에 대한 제안이다.

1. **탐색·대화·검토를 구분한다.** 탐색 행은 작업을 찾고, 대화는 지시·답변을 주고받고, 검토 영역은 결과를 자세히 보는 역할이다.
2. **기본 화면의 정보량을 줄이고 세부 내용은 펼친다.** 실행 요약·실패 원인은 바로 보이고 장문의 도구 로그는 필요할 때 연다. 현재 Azrael의 도구·승인·질문 표현을 먼저 보존한다.
3. **필요한 행동을 탐색 단계에서 알린다.** 질문 응답 필요, 승인 필요, 실행 실패, 연결 끊김을 구분한다. 색뿐 아니라 텍스트와 접근 가능한 이름을 사용한다.
4. **결과를 다시 찾을 수 있게 한다.** 관련 세션·메시지·파일·실행 ID와 연결된 결과 목록을 둔다. HTML이나 문서를 열 수 있다는 것과 실행 권한을 준다는 것은 별개다.
5. **실행 환경과 데이터의 주인을 보이게 한다.** 프로젝트, 실제 경로, 실행 host, 선택 모델·provider·권한을 기존 계약에 맞게 표시한다. 계정의 비밀값은 renderer 상태로 복제하지 않는다.
6. **작업 전환이 중단·재실행을 일으키지 않게 한다.** 패널 닫기, 대화 전환, 창 종료, 명시적 작업 중단은 서로 다른 사건으로 취급한다.
7. **현재 시각 언어를 확장한다.** 기존 semantic theme token, 글꼴 역할, 메뉴·설정 행·버튼·간격을 공통 기준으로 삼는다. 새 shell의 전역 CSS reset이 기존 composer·대화에 스며들지 않게 한다.
8. **코딩 전용 기능을 조건부로 노출한다.** Git 저장소라면 변경 검토를 보여주고, 문서·조사 작업이라면 결과물과 파일을 앞세우는 구성을 검토한다. 새 자동 모드 전환을 합의 없이 추가하지 않는다.

## Azrael의 현재 재사용 경계

### 확인한 구조

- 현재 제품은 hash로 고정한 공식 Codex extension bundle을 Azrael용 준비·변환 과정을 거쳐 VS Code Webview에서 실행한다. 고정 입력 식별과 변환은 [prepare-official-ui.ps1](../../scripts/prepare-official-ui.ps1), [namespace-azrael-host.cjs](../../scripts/namespace-azrael-host.cjs)가 소유한다.
- [extension.ts](../../extensions/azrael-ex/src/extension.ts)의 `ChatSession`/`ChatView`는 임시 최소 채팅 분기다. 통합 pinned UI에서 이것을 현재 제품의 대화 렌더러로 사용한다고 볼 수 없다. [코드 맵](../../docs/maps/README.md)과 [runtime](../../docs/architecture/azrael-runtime.md)을 함께 봐야 한다.
- [chatView.ts](../../extensions/azrael-ex/src/chatView.ts)는 VS Code Webview provider, `acquireVsCodeApi()`, VS Code CSS 변수에 의존한다. 현재 통합 UI가 독립적인 React composer/chat 컴포넌트 패키지로 이미 분리돼 있다는 증거는 확인하지 못했다.
- [appServerTransport.ts](../../extensions/azrael-ex/src/appServerTransport.ts)는 stdio app-server 자식을 시작한다. 이 클래스를 사용했다는 사실만으로 기존 공유 실행기에 접속하거나 확장과 같은 창 참여자로 등록되는 것은 아니다.
- [Azrael host 계약](../../docs/architecture/azrael-ex.md)은 계정 management socket과 공식 채팅 경로를 구분한다. [공유 runtime](../../docs/architecture/azrael-runtime.md)은 실행기 신원, 상태 홈, ABI, 창 등록·해제, 마지막 host 종료를 다룬다.
- 엔진의 대화·계정 상태와 VS Code/Webview 쪽 UI 상태·새 채팅 초안은 저장 위치와 수명이 다르다. 엔진을 재사용해도 UI 초안이 자동 공유되는 것은 아니다.

### 재사용 분류

| 영역 | 현재 판단 | 구현 계획에서 먼저 확인할 것 |
| --- | --- | --- |
| 기존 스타일·semantic token·typography | 재사용 기준으로 적합 | 새 shell과 기존 UI의 CSS 범위, light/dark, 폰트 리소스 |
| pinned composer·대화·도구·질문·승인 UI | bundle 단위 재사용 후보 | VS Code 밖에서 bootstrap·provider graph·portal·저장소·메시지 bridge를 연결할 수 있는 범위 |
| 기존 Azrael UI 변환과 기능별 검사 | 보존·조사 입력으로 재사용 | 새 entry에서 실제 같은 코드·변환이 적용되는지, 기존 검사 중 호스트 전용 구간 |
| 계정·사용량·프로필 설정 | 기존 의미와 표현을 재사용 | VS Code 명령·URI·dialog·저장소를 새 host에 연결하는 seam |
| `ChatSession`/`ChatView` 최소 후보 | 일부 RPC 흐름의 참고 자료 | 제품 전체 기능·승인 정책을 대표하지 않음. 그대로 대체하지 않음 |
| 앱 창·탐색·결과 탭·설정 진입점 | 신규 UI 후보 | 기존 입력·대화 상태를 재소유하지 않는 통합 경계 |
| 엔진 attach·창 수명·재연결 | host 통합 작업 | 실제 현재 protocol/connector, 다른 host와 동시 사용, 중복 실행 방지 |

**결론:** 엔진을 새로 만드는 작업은 필요하다고 확인되지 않았다. 다만 'UI만 옮기면 바로 연결된다'는 것도 아직 확인되지 않았다. 가장 먼저 할 기술 검증은 기존 UI를 새 앱 host에서 실행하고 같은 엔진에 안전하게 연결하는 경계를 확인하는 것이다.

근거 구간: `prepare-official-ui.ps1:12–19,145–153`, `namespace-azrael-host.cjs:638–681`, `extension.ts:79–94`, `chatView.ts:5–26,48–54`, `appServerTransport.ts:61–93`, `chatSession.ts:78–115,192–225`, `azrael-runtime.md:38–58,128–132`, `azrael-ex.md:23–27,109–117`.

문서상 `azrael-ex.md`의 protocol 1 candidate와 `azrael-runtime.md`의 protocol 2 계약이 달라 실제 배포·소스 기준을 확인해야 한다. 임시 `ChatSession`의 Full access 고정 및 일부 승인 자동 응답을 새 앱의 기본 정책으로 복제하지 않는다. 상세 minified bundle 전체 의존성 및 설치본 동작은 이번 조사에서 검증하지 않았다.

## 확정한 화면과 책임

상단에는 작업 폴더, 파일 열기, 터미널 진입점을 둔다. 본문은 기존 채팅 UI이며 채팅 기록·composer·메뉴·설정의 기존 상태와 흐름을 재사용한다. 오른쪽 상세 패널은 파일 또는 터미널을 선택할 때 열리고, 좁은 창에서는 본문 영역을 사용한다. 닫으면 대화로 돌아오며 터미널은 유지된다. 문서 내용은 읽기 전용이다.

Electron main은 기존 prepared extension lifecycle과 호스트 API 연결을 담당한다. 채팅 renderer에는 기존 acquireVsCodeApi 경계를 제공한다. 별도 shell renderer에는 파일 읽기와 터미널 IPC만 노출한다. 기존 이미지 preview component를 앱 안에서 재사용하며 새 이미지 뷰어를 만들지 않는다. 대화·실행·질문·승인·큐의 상태 소유자는 엔진과 기존 UI에 남는다.

## 구현 순서와 수용

| 단계 | 입력과 책임 | 완료 기준 |
| --- | --- | --- |
| 기존 UI 호스팅 | root: prepared bundle, runtime identity, Windows x64 | VS Code 없이 실제 기존 로그인/대화 UI 부팅; 기존 채팅 기록 진입 확인 |
| 상세 패널 | panel owner: 파일·터미널 renderer / root: OS·엔진 서비스 | 텍스트 문자 그대로 표시·오류·line focus; 터미널 입력/출력·resize·숨김 유지·명시 종료 |
| 이미지 재사용 | root: 기존 Codex image overlay와 local resource URI | 기존 이미지 확대/닫기 표시; 대체 viewer 없음 |
| 통합 확인 | root: 실제 renderer, 독립 시험 상태·기존 native engine | light/dark·좁은 창·엔진 종료·공통 Windows 회귀 확인, 원본 설치본 수정 없음 |
| 문서·정리 | root: owning architecture, feature inventory, task artifacts | 구현/미검증 구분, 지원 owner로 disposable 정리, 작업별 commit |

새 diff/PR·결과물 브라우저·필터·알림·도킹·IDE 기능은 이번 구현에서 보류한다. 배포 패키지·설치·실계정 이관·실제 유료 모델 호출은 이번 실행에 포함하지 않는다. 실제 로그인 callback과 설치 수용은 별도 증거 없이 완료라고 하지 않는다.

## 검증 상태와 남은 작업

공식 제품 6종 조사와 기존 bundle/host 경계 조사는 완료했다. 사용자가 확정한 UI 범위와 Windows x64 우선순위에 따라 Electron source 앱을 구현했다. 최종 run26은 양쪽 테마에서 기존 입력란의 실제 draft 입력·삭제, 정상 빈 채팅 기록, dialog, literal text, 실제 PTY 입력/출력·resize·숨김 유지·종료, 기존 image overlay, 좁은 panel을 통과했다. Electron 실제 exit0이고 private native PID/start와 shutdown receipt 및 현재 tree 부재로 종료도 별도 확인했다. 캡처의 실제 light/dark 표시를 검토했으며 독립된 [acceptance.json](acceptance.json)에 결과와 신원을 보존했다.

마지막 시험 자료의 지원 owner 정리까지 완료했고 사용자가 보호된 run7/8/9/16과 시험 엔진의 지정 범위 보존·대기를 승인했다. 4개 lifecycle의 owner/revision, 8개 root와 살아 있는 PID31176 신원을 재확인했으며 해제 조건은 유지한다. 이 보존 예외를 포함해 구현·검증·정리 요구를 충족했다. 실제 검증 환경은 Windows x64이며 Linux/macOS, 실계정 로그인·이관·기존 채팅 데이터, 실제 유료 모델 호출, Windows setup wizard 및 배포 설치는 미검증이다. 각 run은 artifacts/tasks/standalone-app-ui/runs 아래 owner 기록으로 식별한다. 초기 짧은 temporary payload는 artifacts/dt-<unique>, 이후는 관리 루트 artifacts/dt/<unique>에 귀속된다. exact producer tree 종료 증거가 확보되기 전에는 삭제하지 않는다. 초기 실패와 정정 근거는 아래에 구분한다.

### 실행 증거와 정리 경계

| run 시작(UTC) | 실제 결과 | 확인 및 후속 조치 |
| --- | --- | --- |
| 08:20:02 | Electron exit 1 | 긴 시험 home의 SUN_LEN 오류. 준비 전 native 종료·transport 실패·host 정상 종료와 현재 process snapshot으로 종료 확인 |
| 08:25:11 | Electron exit 1 | 기존 로그인 표시; 계정 없는 fixture와 숨긴 창 capture 실패. root close, desktop-stopped, 신원 일치 native shutdown receipt와 현재 snapshot으로 종료 확인 |
| 08:27:19 | Electron exit 1 | APIkey fixture가 공유 모드의 ChatGPT 인증 정책으로 필터됨; 이전과 같은 종료 증거 확인 |
| 08:29:38 | Electron raw exit -1 (runner 표시 4294967295) | main 응답 없음. 정상 창 닫기가 종료시키지 못해 exact root 신원 확인 후 종료. 자식 종료 중 AccessDenied의 PID·원인은 미확인. root close, 사전 트리, native 신원 일치 shutdown receipt, 현재 snapshot을 함께 확인; 성공으로 바꾸지 않음 |
| 09:03:20 / 09:05:44 | dark/light scoped suite exit 0 | 파일 literal 표시, 실제 PTY 출력·resize·숨김 유지·종료, 기존 image overlay 열기·닫기, 좁은 panel. 캡처 검토에서 login 뒤 숨긴 composer가 DOM 검사에 잡힌 것을 발견하여 대화 화면 수용은 미통과로 정정 |

위 초기 네 run은 종료를 별도로 검증해 lifecycle을 failed로 닫았다. 재사용할 준비물이 없고 필수 실패/정정 근거는 이 문서와 owner 제어 기록에 남겼으므로 disposable 시험 profile·renderer·raw log·이미지 묶음을 정리한다. 외부 짧은 경로의 생성/사용 보호는 이 작업의 최초 생성과 실제 소비 종료를 확인하여 같은 owner의 지원 API로 명시했다. 초기 dt-* exact 관리 루트는 해당 묶음 삭제 후 설정에서 제거한다.

영구 source 검사는 pinned UI 업데이트에서 provider anchor를 빠뜨리는 반복 위험을 막기 위해 유지한다. 일반 decode fixture와 watcher probe는 일회성으로 실행했고 별도 테스트 파일을 남기지 않았다. watcher 실제 Windows 생성·변경·삭제, UTF-8/UTF-16·binary/error 및 파일 read 검사는 exit 0이었다. native 이미지 overlay의 scope 오류와 terminal notification API signature 오류는 실제 통합에서 찾아 수정했다.

후속 통합에서는 terminal 연결의 기본 시작 인자가 기존 host discovery와 달랐던 점을 수정했다. 앱을 에이전트 PTY에서 시작하면 호출자의 창·계정 선택 환경이 상속되므로, 새 앱이 자신의 창을 등록하기 전에 네 가지 scoped 환경을 제거한다. 시험 계정은 이 격리 이후 기존 captureCurrent API로 등록하고, production 시작에서는 capture를 수행하지 않는다. 입력·선택 dialog와 안전한 경로 복사 IPC도 연결했다.

가상 계정의 engine account/read 성공만으로 실제 대화 수용을 판단하지 않는다. 원래 host의 추가 HTTP 경로는 engine chatgpt_base_url과 별개여서 가상 토큰으로 실제 서비스에 요청하고 401을 받았으며, 이 과정에서 잠깐 보인 composer가 다시 로그인 화면으로 전환됐다. 실제 사용자 자격 증명을 시험에 사용하거나 모델 턴을 제출하지 않았다. fixture의 전체 요청 격리와 안정된 입력란·채팅 기록 가시성 확인이 남았다. 초기 disposable root는 일반 root guard를 우회하지 않고, 같은 owner가 제공하는 retire_managed_roots 절차로 폐기한다.

후속 source 준비에서 원래 azrael.apiEndpoint=localhost 선택과 기존 host fixture의 accounts/settings/models 응답을 재사용했다. Windows의 TCP 제외 범위 7955–8054에 고정 8000이 포함돼 IPv4/IPv6 bind 모두 EACCES였다. OS 예약을 변경하지 않고 시험 HTTP 전송 경계에서 localhost:8000을 생성한 loopback 임시 포트로 전달하며 외부 fetch를 거부한다. 원래 renderer의 theme seam인 body data-vscode-theme-kind와 vscode-* class, 누락된 dropdown 색상 토큰도 연결했다. 수정한 13 source syntax 및 pinned image guard는 exit 0, shell JS/CSS의 메모리 bundle 검사는 exit 0(디스크 출력 없음), 임시 loopback bind 준비 검사도 exit 0이었다. 실제 통합 재실행은 이전 run 정리의 owner 구간이 끝난 뒤 진행한다.

초기 정리 owner의 실제 결과는 [cleanup-early-result.json](cleanup-early-result.json)에 보존했다. 첫 네 group의 전체 root와 run12의 run-root까지 총 8개 root(논리 크기 287,024,829B)를 삭제하고 부재를 확인했으며, 첫 네 group만 finalize했다. 나중 다섯 group 중 9개 member(320,442,817B)는 적용 도중 group token 변경으로 보호 거부되어 남았다. native exit 0을 전부 삭제 성공으로 세지 않는다. run7/8/9의 6개 root(3,715,421B)는 helper tree 종료 근거가 부족해 보존 중이다. 동일 거부를 반복하거나 shell로 우회하지 않고 token 계산 경계를 조사한다. 이 잔존은 정리 완료 또는 사용자 보존 승인으로 간주하지 않는다.

다음 dark 통합 실행의 제어 프로세스는 공용 lifecycle catalog 잠금에서 대기했다. 09:58 UTC의 CIM 조회에 Electron이 잡히지 않아 시작 전으로 설명했으나, 후속 desktop log의 09:58:31 활성화 기록과 대조하여 그 판단을 정정한다. 앱 시작과 제어 프로세스 등록 대기가 겹친 상태였다. 별도 source bundle의 project_tests plan은 명령·입력·환경 검토를 마쳤지만 run은 maintenance_busy로 실행 전에 거부됐다. 기존 source 직접 검사 통과와 이 관리 실행 미실행을 구분한다. 같은 producer를 중복 시작하지 않는다.

이 실행(09:56 run)은 이후 Electron을 시작했으나 90초 watchdog에서 실제 SIGTERM/null로 종료됐고 수용 result는 생성하지 못했다. 같은 제어 프로세스가 trackArtifactChild의 catalog 잠금을 동기 대기하는 동안 loopback HTTP도 응답하지 못할 수 있는 fixture 구조를 찾아, HTTP 서버를 Node Worker로 분리했다. 부모가 동기 subprocess를 기다리는 동안에도 Worker가 실제 accounts/check 요청을 처리하는 일회성 probe가 exit 0, Worker 종료도 exit 0이었다(산출물 없음). 이 준비 검사가 전체 앱 통합 통과를 뜻하지 않는다. 14개 source syntax·메모리 JS/CSS bundle·pinned image adaptation 검사도 exit 0이었다. 이전 실행의 전체 종료 여부를 확인하기 전에는 같은 producer를 중복 시작하지 않는다.

토큰 거부는 native guard의 정상 중단이다. group token에는 다른 member·전역 run 상태·config/preference·retirement descriptor 및 증거 identity도 포함되므로 선택 root의 요약 identity가 같다는 것만으로 tool 결함을 단정하지 않는다. 정확한 변경 입력은 초기 compact 결과만으로 확정하지 못했다. 재개 시 불변 descriptor/증거로 group별 fresh review와 즉시 apply를 수행하며, 계속 달라지면 각 입력을 보존하고 중단한다.

후속 실행에서는 HTTP Worker 격리, 기존 empty history 응답, 실제 draft 입력·삭제 및 dark/light canvas 색상을 확인했다. 10:47 UTC의 양쪽 테마 실행은 terminal 출력 대기와 host 종료 대기에서 실패했으며 Electron 실제 결과는 watchdog에 의한 null/SIGTERM이다. renderer와 PTY 크기를 따로 바꾸던 시험을 실제 창 resize로 교체하고, fixture shell은 사용자 profile을 실행하지 않으며, 실패 시에도 session을 종료하도록 보완했다. 원래 stdio proxy가 EOF 전에 close를 기다리던 종료 순서도 수정했다. 이 수정 뒤 source syntax 15개·메모리 bundle·pinned image guard exit 0이며 실제 통합 재검증은 별도다.

실제 사용자 VS Code 창 문맥을 상속했던 run16 및 helper 종료 근거가 부족한 run7/8/9는 보호한다. 정확한 root·알려진 크기·해제 조건은 [retention-scope.json](retention-scope.json)에 있으며 사용자 보존 승인 대기 중이다. run16의 살아 있는 daemon이나 실제 VS Code 창을 강제 종료하지 않는다. 수정 후 새 앱은 inherited window/management/account selection 환경을 제거한다.

11:05 UTC run23(`artifacts/dt/64b30308`)은 UI 검사 전 terminal transport initialize 15초 timeout으로 실패했다. Electron은 종료 대기 뒤 watchdog SIGTERM/null로 끝났고, runner의 최종 기록 시 다른 FH-01 작업의 사라진 ancestor를 관측한 catalog ENOENT가 발생했다. 기존 producer.json의 exit 1은 초기 tracker 보고이므로 최종 exit 증거로 재사용하지 않는다. 별도 read-only 조사에서 native PID18120/start134380912257048985와 shutdown receipt 일치, owners 비어 있음, root39496·setup52664·primary20636·terminal16012·bridge helpers의 현재 부재와 exact temp-root process 부재를 함께 확인해 producer 종료를 확인했다. fixture setup 연결은 새 창 연결 준비 전까지 유지하고 terminal 초기화 제한은 기존 setup과 같은 60초로 맞췄다. 종료 단계 로그와 catalog 실패와 독립된 electron-close.json 기록을 추가했다. 실제 수용 재실행은 이 소스와 공용 catalog 정리 구간 종료 후 진행한다.

이전 실패 실행 정리는 [cleanup-later-result.json](cleanup-later-result.json)과 [cleanup-ui-prior-result.json](cleanup-ui-prior-result.json)의 지원 owner 결과로 확인했다. 첫 정리와 후속 정리를 합쳐 36개 root, 등록 논리 크기 1,034,122,667B가 삭제됐으며 실제 부재와 group finalize를 확인했다. 이는 디스크 물리 회수량 추정이 아니다. run16 및 run7/8/9는 보존 승인 대기 범위 그대로이며 run23은 별도 정리 대상이다. 기존 실패/null 결과를 성공으로 바꾸지 않았다.

11:21 UTC run24(`artifacts/dt/56034715`)은 양쪽 테마에서 기존 composer 실제 입력·삭제, 빈 history, dialog, text/image/narrow 검사를 통과했으나 terminal 출력과 정상 종료는 실패했다. `electron-close.json`의 실제 결과는 root35028, null/SIGTERM이다. terminalFailure에는 준비된 PowerShell prompt와 빈 Enter 뒤 prompt만 남아 있어 CDP Input.insertText의 xterm 입력 미전달이 확인됐다. 실제 문자 key event로 교체한다. 종료 로그는 storage까지 진행했지만 native proxy close 대기에서 멈췄다. native window lease는 host PID 종료 후 해제되므로 host 안에서 그 proxy 종료를 기다리던 순환을 제거한다. 실제 native55148/start134380921362074694의 shutdown receipt 및 root/helpers/tree/current exact-temp process 부재로 종료를 따로 확인했다. Light 캡처의 white canvas와 dark foreground 혼용도 수용 실패로 기록하고 누적 inserted CSS 교체를 수정한다.

수정된 source의 관리 실행 `run-42784-5209-1793618878534149900`은 `standalone-app-ui-source` 실제 exit0, 입력 무결성 valid, status passed였다. 범위는 15개 syntax·메모리 renderer bundle·pinned image provider adaptation이다. 앞선 maintenance_busy 시도와 구분한다. 이후 UI source를 바꾸면 영향받는 검사를 재실행한다.

run23/24의 지원 owner 정리도 [cleanup-ui-watchdog-result.json](cleanup-ui-watchdog-result.json)으로 확인했다. 추가 4개 root, 등록 논리 크기 70,914,129B 삭제·부재·finalize, native register/review/apply 6회 exit0이며 실패/null/SIGTERM을 유지했다. 전체 삭제는 40개 root, 등록 논리 크기 1,105,036,796B이다. 보호 승인 대기 4groups는 그대로다.

테마 추가 조사는 pinned `LR`/`R4e`/`z4e`가 body `data-vscode-theme-kind`를 MutationObserver로 구독하고 `RBa`가 html `data-theme`와 내부 palette를 갱신함을 확인했다. 별도 palette나 강제 observer를 만들지 않고 기존 seam을 유지하며, 호스트 inserted CSS를 key로 제거·교체한다. root theme와 실제 foreground 밝기·canvas를 함께 검사한다. 최종 통합에서는 xterm의 실제 문자 key event와 Enter를 사용한다. host 종료 뒤 lease 해제를 기다리는 native proxy를 host 내부에서 기다리지 않고, 정상 EOF 및 storage dispose 후 host를 종료한 다음 외부 stop 증거를 확인한다.

최종 테마 수정은 초기 HTML과 삽입 CSS의 중복 선언을 하나의 `azrael-desktop-theme` style 요소로 합쳐 textContent를 갱신하는 방식이다. run25는 PTY와 정상 종료를 통과했지만 light foreground 실패로 exit1이었으며 성공으로 세지 않는다. 최종 run26은 11:39:31 UTC run 시작부터 11:40:18 UTC Electron 정상 close까지 약47초였고, dark/light 각각7checks·errors[]·exit0이었다. 최종 source 관리 실행 `run-42784-5236-1793619559637823800`도 실제 exit0·input integrity valid·passed이며 그 이후 실행 소스 변경은 없다. 현재 문서만 검증 결과에 맞춰 갱신한다.

최종 [cleanup-ui-final-result.json](cleanup-ui-final-result.json)은 run25/26의 4개 root, 등록 논리 크기 72,907,636B 삭제·부재·finalize를 기록한다. register/review/apply 6회 exit0, readonly 최종 확인 exit0이며 당시 acceptance SHA는 불변이었다. 별도 사전 capabilities 호출의 인자 오류 exit1과 교정된 positional 호출 exit0도 구분해 보존했다. 전체 44개 root, 등록 논리 크기 1,177,944,432B 삭제를 확인했고 4개 보호 group만 남겼다. 보호 scope의 당시 알려진 합계는 69,729,125B와 측정 불가 active socket이며 정확한 경로·해제 조건과 사용자 승인은 retention-scope.json에 있다. 승인 이후 acceptance의 상태 문구만 갱신했고 실행 결과·소스는 바꾸지 않았다. 일반 동작 확인을 새 완료 조건으로 추가하지 않는다. 다른 작업의 staged 변경을 보존하며 이번 소스·문서·검증 연결만 별도 index에서 분리해 작업 커밋한다. 유지할 정리 영수증은 실제 종료 코드·삭제 경로·부재·finalize·외부 증거 identity를 남기는 요약으로 정리하고 중복 요청·만료된 토큰은 제외했다. 원본 임시 사본과 Git index는 별도 소유 run으로 귀속해 커밋 확인 후 정리한다.
# 비호환 엔진 시작 안내 구현

공통 호스트 회귀는 직접 실행한 6개 기존 파일, 377tests/377pass/0fail, 실제 exit0으로 확인했다. 새 admission 거부·재시도·취소와 초기 모듈 로드 차단은 이 실행에 포함된다. 앞선 관리 실행 `run-42784-5288-1793624433802466100`은 입력 무결성 valid지만 10.2초 뒤 실제 exit124로 실패했으며 성공으로 취급하지 않는다. 직접 재실행은 약53.8초였고 관련 소스 입력은 그동안 불변이었다. Native storage는 6pass/0fail/1ignored helper, 실제 exit0이며 실제 `azrael` 진입점 cargo check도 exit0이다. [네이티브 검증 근거](startup-native-acceptance.json)는 명령·불변 입력·대상 및 검증 한계를 소유한다. 실제 native 대화상자 입력은 관리형 window stage2 권한 도구 오류로 승인되지 않았고 우회하지 않는다.

데스크톱 source checker의 실제 재실행은 15개 syntax·메모리 renderer bundle·pinned image adaptation 통과, exit0이었다. 이전 출력 관측을 놓친 호출의 성공은 추정하지 않고 해당 node PID43496 종료 후 재실행한 session44138의 terminal 결과를 사용했다. 실패한 관리 source 실행이 남긴 정확한 disposable fixture `C:/Users/felre/.azrael-ex/tmp/devin-native/azrael-preparation-test-UBk9Dc`는 생성 시각·합성 cache owner·35files/17095B·무링크·실행 참조 부재를 확인한 뒤 기존 test fixture의 일반 삭제 절차로 제거하고 실제 부재를 확인했다. 강제 옵션과 등록된 보호 우회는 사용하지 않았다.

실제 Electron45.2.1 Windows native 안내창은 light 및 dark 요청 상태에서 관찰했다. headline·detail·다시 시도·닫기가 읽히며 Windows native 대화상자는 dark 요청에도 OS 기본 밝은 색상으로 표시됐다. 프로그램 취소 응답은 양쪽 상태에서 `userNotified`와 미연결 socket을 유지했고 최종 fixture exit0이었다. 직접 버튼 클릭과 실제 VS Code API 화면은 미검증이다. [UI 근거](startup-dialog-acceptance.json)는 시도별 실패와 최종 결과, 권한 도구 오류 및 owner 정리를 구분한다.

UI 검증 3runs는 owner 삭제·부재·finalize를 완료했다. Native 검증 snapshot 이후 커밋 index 소비가 끝나면 같은 owner가 native run과 짧은 frozen source를 정리하며, 최종 완료·실패 여부는 별도 [정리 영수증](../../artifacts/maintenance/evidence/engine-startup-conflict-cleanup-20261102.json)이 소유한다. 현재 설치본·사용자 홈 데이터와 기존 shared Cargo cache는 이 disposable 정리 범위가 아니다. 이전에 사용자가 승인한 4개 보호 group의 범위·해제 조건은 변경하지 않는다. 설치·완성 실행 파일의 endpoint 조회·실제 VS Code 화면·Linux/macOS는 이번 수용으로 주장하지 않는다.

변경 owner의 보존 검증에 필요해 기존 standalone 항목의 directory owner를 실제 renderer 파일로 교정하고, 빈 reportFields는 재사용하는 준비된 image-open 경로의 기존 `imageFileOpenEdits`와 연결했다. 검사기를 완화하거나 새 변환 성공을 가정하지 않는다. 전역 manifest 검사는 그 뒤 별도 기존 `tool.project-maintenance`의 invalid owners/area에서 실패하므로 전체 통과로 표시하지 않는다. 이번 변경 범위인 `engine.shared-engine`, `ui.standalone-app`의 동일 validator 검사와 실제 소스 검증은 구분한다. 해당 미관련 항목은 수정하지 않는다.

사용자의 구현 승인 범위는 VS Code와 데스크톱 공통의 시작 전 호환성 확인, 명확한 안내, 시작 중단과 명시적 재시도다. 기존 엔진·창·작업 종료, 인증 정보 변경, 프로젝트 식별자 수정 및 설치는 포함하지 않는다. 의미는 공통 플랫폼에 적용하며 이번 실제 검증 대상은 Windows x64다.

기존 native storage manifest/lease 검사를 재사용한다. endpoint 조회는 `storageAdmission: compatible|incompatible`를 추가하며 기타 권한·손상·잠금 오류를 호환으로 취급하지 않는다. 조회에 필요한 control 파일만 기존 소유 절차로 열고 계정·설정·DB는 초기화하지 않는다. 창 proxy도 동일 lease를 연결 동안 유지해 daemon 시작 전 경합에서 비호환 엔진이 진입하지 못하게 한다. 실제 daemon의 최종 검사는 보존한다. 기존 lease에는 엔진 버전이 없으므로 UI는 추정하지 않고 `버전 정보 없음`을 표시한다.

호스트는 계정·채팅 모듈 로드 전에 결과를 확인하고 공통 native 오류 대화상자를 표시한다. 재시도는 명시적 버튼에만 반응하며 매번 native 검사를 새로 한다. 취소하면 해당 시작만 중단한다. 호환성 조회를 지원하지 않는 구형 엔진도 명확한 릴리스 정렬 안내와 함께 중단한다. 데스크톱은 이미 표시한 오류를 중복 표시하지 않고 앱을 종료한다.

실행 소유: root는 공통 호스트·데스크톱 경계·문서·최종 통합, native owner는 `main.rs`, storage typed conflict 및 export와 격리 native 검증을 담당한다. Cargo는 native owner만 실행한다. 검증은 기존 shared-engine/integrated-entry 검사 확장, Windows native storage 검사와 실제 CLI 경로 typecheck, 양쪽 호스트 오류 대화상자/재시도 표시 확인을 사용한다. 설치본·실계정 및 Linux/macOS 실기는 별도다. 재발 가능한 누락은 준비된 호스트와 native endpoint 계약을 함께 변경하지 않거나 native/account 모듈을 admission 이전에 로드하는 수정이므로 기존 최소 테스트를 확장해 보존한다.
