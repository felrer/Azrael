# azrael-ex ChatGPT OAuth·Pi·reference-aligned UX 설계

- 상태: `ready`
- 결정일: 2026-09-03
- 대상: `azrael-ex/` 1차 VS Code extension
- 상위 설계: [azrael-ex 우선 2단계 전체 설계](azrael-ex-two-phase-system-design.md)
- Runtime/writer 경계: [세션 Writer 소유권과 전환](session-writer-ownership-design.md)
- 구현 계획은 저장소 외부에서 관리한다.

## 1. 결정

azrael-ex의 1차 production 실행 경로는 다음으로 고정한다.

1. agent loop, session, model 호출과 tool 실행은 `@earendil-works/pi-coding-agent`가 소유한다.
2. OpenAI 접근은 Pi의 `openai-codex` provider와 `oauth` 로그인 유형을 사용한다.
3. 사용자는 ChatGPT 계정으로 로그인하며, 이용 가능 범위와 한도는 해당 ChatGPT 구독 및 OpenAI 정책을 따른다.
4. OpenAI API key 입력과 usage-based API 결제 경로는 1차 제품면에서 제공하지 않는다.
5. UI/UX는 Codex의 공개 App Server 계약, OpenAI 공식 IDE 문서와 버전이 고정된 설치본에서 확인한 동작을 azrael-ex의 독립적인 component·상태 계약으로 옮긴다.
6. OpenAI의 제품명, 로고, 비공개 asset, minified bundle 또는 비공개 구현을 azrael-ex에 복사하지 않는다.

즉, Codex binary나 App Server를 azrael-ex runtime으로 감싸는 설계가 아니다. Pi가 실행
runtime이고, Codex에서 확인한 공개/관찰 가능 계약은 azrael-ex가 구현할 interaction model의
검증 근거다.

## 2. 근거의 등급과 변경 통제

Codex 관련 판단은 아래 세 등급으로 기록한다. 낮은 등급의 근거가 높은 등급의 계약을
덮어쓰지 않는다.

| 등급 | 허용 근거 | 설계에 사용할 수 있는 것 |
| --- | --- | --- |
| A — source/protocol verified | OpenAI Codex 공개 repository, App Server schema·공식 문서 | thread/turn/item, stream, approval, account login과 같은 protocol·state machine |
| B — product documented | OpenAI 공식 Codex IDE/auth 문서 | editor context, change review, same-chat follow-up, 구독 로그인과 복구 기대 동작 |
| C — versioned observation | 사용 권한이 있는 설치본의 manifest와 화면 capture | view 배치, control 존재 여부, geometry·spacing·state 표현 |

현재 확인한 기준선은 다음과 같다.

- `codex-cli 0.151.0`
- VS Code extension `openai.chatgpt` version `26.825.51511`
- 설치본 manifest에서 sidebar/secondary sidebar, conversation editor, file/selection 추가,
  `queue|steer|interrupt` 후속 입력, inline/detached review 설정을 확인했다.
- OpenAI는 Codex CLI, SDK와 App Server의 공개 구현을 제공하지만 IDE extension 전체를 공개
  구현으로 명시하지 않는다. 따라서 설치본 bundle은 source-level 설계 권위로 사용하지 않는다.

관찰 결과를 반영할 때 `reference-evidence.json`에 최소 `sourceKind`, URL 또는 local package
identity, version, 확인일, 관찰 항목, capture checksum을 기록한다. 새 Codex release가 기존
azrael-ex baseline을 자동 변경하지 않는다.

## 3. 사용자 결과

처음 실행한 사용자는 API key를 준비하지 않고 다음 흐름을 완료할 수 있어야 한다.

```text
Open Chat
  → ChatGPT로 로그인
  → system browser 또는 device-code 안내
  → 구독 사용 가능 상태 확인
  → workspace에 묶인 Pi session 생성
  → prompt/stream/tool/approval/review
  → VS Code를 재시작해도 session과 로그인 상태 복구
```

인증이 만료되면 Pi가 refresh를 시도하고 새 credential을 안전하게 저장한다. refresh가
실패하면 transcript와 draft를 보존한 채 `needs-login`으로 전환하며 prompt를 자동 재전송하지
않는다.

## 4. 런타임 아키텍처

```text
VS Code Webview
  │ public snapshot / intent (secret 없음)
  ▼
Extension Host
  ├─ ExtensionServices (activate당 1개 composition root)
  │    ├─ AuthCoordinator ── VS Code SecretStorage
  │    └─ Session Broker client
  ├─ ChatPanel / WebviewBridge ── sanitized auth subscription
  ├─ browser, InputBox, notification, diff
  └─ VS Code command / serializer adapters
          │ user-scoped versioned named-pipe protocol
          ▼
      profile Session Broker
          ├─ RuntimeManager / ProcessSupervisor
          ├─ Core child ── durable catalog/draft/queue
          └─ CredentialConsumerRegistry ── Pi Host child
                ├─ ModelRuntime + openai-codex provider
                ├─ AgentSessionRuntime / SessionManager
                └─ credential proxy ── commit/ack ── AuthCoordinator
```

### 4.1 Pi가 소유하는 기능

- ChatGPT OAuth flow 생성과 provider-specific prompt/notice 처리
- OAuth access/refresh credential 해석과 refresh
- OpenAI Codex model catalog 및 model invocation
- agent session, prompt, steer, follow-up, abort와 tool lifecycle
- Pi JSONL 작성과 session resume

azrael-ex는 OAuth endpoint, client id, token exchange나 refresh request를 자체 구현하지 않는다.
Pi public API가 제공하는 `ModelRuntime.login('openai-codex', 'oauth', interaction)`과
`CredentialStore` 계약을 adapter 뒤에서 사용한다.

### 4.2 Extension host가 소유하는 기능

- 로그인/로그아웃 command와 extension 전역 `AuthCoordinator` 단일 인스턴스
- Pi `AuthInteraction`의 prompt/notice를 VS Code native UI로 중계
- 허용된 HTTPS 로그인 URL과 loopback callback만 `vscode.env.openExternal`로 열기
- credential의 persistent owner인 `ExtensionContext.secrets`
- 로그인 취소, timeout, device-code fallback과 사용자에게 보이는 auth state
- credential commit acknowledgement와 Broker를 통한 Pi Host restart bootstrap sync

#### 4.2.1 전역 범위와 composition root

여기서 **extension 전역**은 `activate(context)` 호출 한 번에 정확히 하나의
`ExtensionServices`와 `AuthCoordinator`를 만든다는 뜻이다. `extension.ts`가 composition
root이며 생성한 instance를 command handler, `ChatPanelSerializer`, runtime factory와 모든
panel에 주입한다. `ChatPanel`, `WebviewBridge`, `LiveRuntimeUiPort`와 Pi Host adapter는
`AuthCoordinator`를 생성하거나 소유하지 않는다.

VS Code는 창마다 별도 Extension Host process를 둘 수 있으므로 `AuthCoordinator`를 machine-wide
in-memory singleton이라고 표현하지 않는다. 같은 VS Code profile의 여러 instance는 SecretStorage의 같은
provider record를 볼 수 있으며, 각 `AuthCoordinator`는 Broker의 auth lane과 `writerInstanceId + revision`을 사용해
stale mutation을 거절하고 최신 record를 다시 읽는다. SecretStorage만으로 process 간 strong
lock을 가장하지 않으며 충돌을 감지할 수 없으면 새 credential을 commit하지 않고 재로그인 또는
재시도를 요구한다.

#### 4.2.2 책임과 비책임

`AuthCoordinator`는 다음만 소유한다.

- provider별 sanitized `AuthViewState`와 subscriber fan-out
- provider별 단일-flight login/refresh/logout operation 및 cancellation
- SecretStorage credential read/commit/delete와 revision 검증
- Pi AuthInteraction 중계와 credential consumer 등록·동기화
- activation bootstrap 및 deactivation drain

session catalog, panel lifecycle, agent run, workspace binding과 일반 process supervision은 소유하지
않는다. `AuthCoordinator`는 Broker client port로 revisioned projection/commit acknowledgement만 교환하고
Broker의 `RuntimeManager` 또는 Pi Host를 직접 생성하지 않는다.

#### 4.2.3 공유 동작

- 어느 panel에서 로그인해도 provider별 진행 중 operation 하나를 공유하고 모든 panel이 같은
  sanitized 상태를 받는다.
- panel close/dispose는 로그인, refresh 또는 logout을 취소하지 않는다. 사용자의 명시적 cancel과
  extension deactivation만 operation cancellation authority를 가진다.
- 새 Pi Host consumer는 Broker에 등록되는 즉시 compatible Extension Host가 제공한 최신 acknowledged credential revision을 bootstrap 받는다.
- 어느 Pi Host에서 refresh가 발생해도 `AuthCoordinator`가 provider lane에서 한 번 commit하고
  성공한 revision을 모든 live consumer에 배포한다.
- stale consumer의 commit은 거절하고 최신 credential/revision을 다시 동기화한다.
- logout은 해당 profile의 새 runtime command를 Broker에서 차단하고 모든 consumer의 credential clear ack 뒤 durable
  secret을 삭제한다. clear를 증명하지 못한 consumer는 종료한다.

Deactivation은 `해당 client의 새 auth/runtime intent 차단 → interactive login cancel → 진행 중 credential
commit bounded drain → Broker credential projection/client detach → AuthCoordinator subscriber dispose` 순서다.
다른 client나 active work가 있으면 Broker/Core/Pi Host를 종료하지 않는다. 명시적 logout이 아니므로 정상
deactivation에서는 persistent credential을 삭제하지 않는다.

### 4.3 Webview가 아는 인증 정보

Webview에는 다음 projection만 보낸다.

```text
AuthViewState
  status       signed-out | signing-in | signed-in | needs-login | error
  provider     openai-codex
  mode         chatgpt-subscription
  persistence  persistent | unavailable
  planLabel?   provider가 안전한 public metadata로 준 경우만 표시
  message?     redacted public error
```

access token, refresh token, authorization code, account identifier, login URL, raw provider error는
Webview message, SQLite, Pi JSONL, OutputChannel과 diagnostics bundle에 넣지 않는다.

## 5. OAuth credential commit 계약

현재 Electron Pi Host의 credential store는 process memory이고, 로그인 완료 credential만
Coordinator가 받아 저장한다. 이는 runtime 중 refresh로 회전한 credential을 persistent owner에
반영하기에 충분하지 않다. azrael-ex에서는 Pi Host의 `CredentialStore.modify`를 private
credential broker로 연결한다.

```text
Pi provider refresh/login
  → Pi Host credentialStore.modify(provider, mutation)
  → next credential를 private message로 commit 요청
  → AuthCoordinator가 expectedRevision 확인
  → SecretStorage write 성공
  → revision + acknowledgement
  → Pi Host memory commit
```

- 저장 성공 acknowledgement 전에는 새 credential을 durable하다고 간주하지 않는다.
- `expectedRevision`이 맞지 않으면 현재 credential을 다시 읽어 refresh/login을 재평가한다.
- SecretStorage 실패 시 이전 credential을 보존하고 auth state를 `error` 또는
  `persistence: unavailable`로 표시한다. 자동으로 평문 파일에 fallback하지 않는다.
- logout은 새 prompt를 막고 Pi Host credential을 지운 뒤 SecretStorage를 삭제한다. active
  request 종료가 확인되지 않으면 host를 종료해 token-bearing memory를 제거한다.
- activation 시 SecretStorage credential을 Pi Host에 한 번만 bootstrap하고 이후 회전은
  commit protocol로 동기화한다.

### 5.1 `AuthCoordinator` 최소 port

```text
AuthCoordinator
  getSnapshot(): AuthViewState
  subscribe(listener): Disposable
  signIn(provider = openai-codex): Promise<AuthOutcome>
  cancel(operationId): Promise<void>
  logout(provider = openai-codex): Promise<void>
  registerCredentialConsumer(consumer): Disposable
  dispose(): Promise<void>
```

`signIn`은 동일 provider의 진행 중 promise를 재사용한다. consumer registration과 Webview
subscription은 서로 다른 port이며, Webview listener가 credential payload를 받을 수 있는 type
경로를 만들지 않는다.

## 6. Codex 실행 모델을 Pi에 옮기는 규칙

Codex App Server의 공개 모델을 UI 언어로 사용하되 Pi identity를 버리지 않는다.

| 확인된 Codex 개념 | azrael-ex/Pi 의미 | UI 계약 |
| --- | --- | --- |
| Thread | Pi session + immutable workspace binding | 한 chat panel의 durable 대화 단위 |
| Turn | prompt/steer/follow-up으로 시작한 Pi run | accepted부터 settled까지 실행 단위 |
| Item | normalized Pi message/thinking/tool/permission/change item | stable item id와 ordered transcript row |
| turn/interrupt | Pi abort | active run만 중단; draft/queue는 별도 표시 |
| steer 또는 queued follow-up | Pi steer/follow-up | 설정과 modifier key에 따라 의미를 명시 |
| item approval request/resolution | Pi tool permission request/decision | session/run/item scope를 잃지 않는 inline attention |
| account login state | Pi `openai-codex` credential state | ChatGPT 로그인, 재로그인, 로그아웃 surface |

Codex protocol의 field name을 그대로 Webview wire format에 복사할 필요는 없다. 대신 lifecycle,
correlation과 terminal-state 불변조건을 `NormalizedPiEvent` 및 `TranscriptItemView`에 보존한다.

## 7. Reference-aligned VS Code UX

### 7.1 제품면

- Activity Bar 또는 Secondary Sidebar의 azrael-ex container
- session/history와 attention을 보여 주는 native View
- source editor 옆의 chat WebviewPanel
- active file, selection, 명시적으로 추가한 file을 composer context chip으로 표시
- transcript 안의 streaming text, compact thinking/tool row, inline approval와 file-change summary
- 변경 사항은 VS Code diff에서 검토하고 같은 chat에서 후속 지시
- 실행 중 stop, steer 또는 queue를 구분하는 composer action

구조와 상태는 확인된 Codex 동작에서 가져오지만 command id, product label, icon과 asset은
azrael-ex가 소유한다. 화면의 시각 기준은 별도 [UI/UX 디자인 지침](azrael-ex-ui-ux-design-guidelines.md)의
versioned capture와 semantic token 계약을 따른다.

### 7.2 화면 상태

최소 fixture는 `signed-out`, `signing-in`, `signed-in/empty`, `streaming`, `approval-pending`,
`changes-ready`, `queued-follow-up`, `reconnecting`, `needs-login`, `uncertain`을 포함한다. 인증
상태는 transcript를 지우는 전면 modal로 표현하지 않고 composer 인접 action과 필요한 경우의
attention surface로 표현한다.

### 7.3 명시적으로 제외하는 것

- Codex App Server 또는 Codex CLI를 production backend로 실행
- OpenAI 전용 protocol을 Pi session 원본으로 저장
- Codex/ChatGPT 명칭과 logo를 azrael-ex 제품 식별에 사용
- 설치된 IDE extension의 minified code, stylesheet, image/font asset 재사용
- OpenAI API key 입력, 환경 변수 탐색 또는 usage-based billing UI
- 1차 release에서 Codex cloud task handoff를 구현

## 8. 실패와 복구

| 실패 | 상태와 보존 | 사용자 action |
| --- | --- | --- |
| browser open 실패 | draft/transcript 유지, 로그인 pending 해제 | device code 또는 다시 시도 |
| OAuth 취소/timeout | credential 변경 없음 | 로그인 재시도 |
| 구독/권한 거절 | `needs-login`과 redacted provider message | 계정/구독 확인 후 재로그인 |
| refresh 실패 | active mutation 중지, prompt 자동 재전송 금지 | 다시 로그인 |
| SecretStorage write 실패 | 이전 revision 유지, 평문 fallback 금지 | storage 복구/ephemeral 미지원 안내 |
| Pi Host crash | token은 SecretStorage에 유지, child memory 폐기 | bounded restart 후 credential bootstrap |
| event gap | last confirmed transcript 유지, `uncertain` | snapshot/rescan 후 사용자 판단 |

## 9. 불변조건과 완료 기준

- production ChatPanel은 fixture가 아니라 `LiveRuntimeUiPort`를 사용한다.
- OpenAI 호출은 Pi `openai-codex` provider로만 이루어진다.
- login, refresh, restart와 logout 뒤 credential revision이 SecretStorage와 Pi Host에서 수렴한다.
- 한 Extension Host activation 안에서 `AuthCoordinator`가 하나만 생성되고 panel/session 수명과
  분리된다.
- 여러 panel과 Pi Host가 동일 provider state/revision에 수렴하며 stale writer는 credential을
  덮어쓰지 않는다.
- secret 또는 login URL이 public Webview/protocol/log/diagnostics에 나타나지 않는다.
- thread/turn/item에 대응하는 session/run/item correlation이 replay 뒤에도 유지된다.
- editor context, inline approval, follow-up, change review와 복구 상태가 keyboard로 접근 가능하다.
- reference capture가 없어도 semantic·state contract를 테스트할 수 있고, capture가 있으면
  geometry/typography 회귀를 별도로 판정한다.
- OpenAI 또는 Pi provider 정책이 바뀌면 기능을 가장하지 않고 capability/eligibility failure로
  표시한다.

## 10. 근거

- [OpenAI Codex authentication](https://learn.chatgpt.com/docs/auth): ChatGPT 구독 로그인과 API key 모드, credential cache와 refresh 동작
- [OpenAI Codex App Server](https://learn.chatgpt.com/docs/app-server): rich client용 공개 interface, thread/turn/item lifecycle, approval와 managed ChatGPT login flow
- [OpenAI Codex IDE extension](https://learn.chatgpt.com/docs/ide): 열린 file/selection context, in-place change review, 같은 chat의 후속 작업과 local/cloud 흐름
- [OpenAI Codex open source](https://learn.chatgpt.com/docs/open-source): 공개 구현의 범위
- 설치된 `openai.chatgpt` extension `26.825.51511`의 `package.json`과 README: versioned observation 근거
- 설치된 `@earendil-works/pi-coding-agent` `0.84.4`의 `docs/providers.md`: `openai-codex` ChatGPT subscription OAuth와 자동 refresh
- 현재 코드 `src/pi-host/native-bootstrap.mjs`, `src/main/coordinator.ts`, `src/main/credential-vault/`: 재사용 가능한 Pi auth/runtime 경계와 남은 refresh persistence gap
