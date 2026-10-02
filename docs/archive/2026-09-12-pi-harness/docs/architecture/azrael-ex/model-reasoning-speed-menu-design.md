# azrael-ex 모델·Reasoning·Speed 캐스케이딩 메뉴 설계

상태: `implemented`

## 1. 목적과 결정

Composer 우측 하단의 정적 `ChatGPT subscription` 텍스트를 현재 실행 설정을 보여 주는
버튼으로 바꾼다. 버튼을 누르면 1차 메뉴가 열리고, `Model`, `Reasoning`, `Speed` 행을
선택하면 인접한 2차 메뉴가 열리는 캐스케이딩 메뉴를 사용한다.

이 제품면은 OpenAI의 ChatGPT 구독을 사용하는 Pi `openai-codex` provider만 지원한다.
provider 선택 UI와 provider-neutral 추상화는 만들지 않는다. 모델 목록, 현재 모델과
reasoning capability는 설치된 Pi runtime의 공개 model catalog와 `AgentSession`을 권위로
사용한다.

OpenAI의 현재 Responses API는 `reasoning.effort`와 요청 처리 tier를 서로 독립된 설정으로
제공한다. 설치된 Pi SDK도 모델별 지원 thinking level 조회, session의 model/thinking 변경과
OpenAI Codex request의 `serviceTier` 전달 경계를 이미 제공한다. azrael-ex는 이 기능을
Webview에서 다시 구현하지 않고 host-owned 설정 계약으로 연결한다.

## 2. 성공 조건

- 로그인한 사용자는 Composer 우측 하단 한 지점에서 현재 모델, reasoning effort와 speed를
  확인하고 변경할 수 있다.
- `Model`을 바꾸면 선택한 모델이 실제 지원하는 reasoning 목록이 즉시 다시 결정된다.
- 모델이 지원하지 않는 effort는 선택할 수 없고, 기존 effort가 새 모델에서 유효하지 않으면
  Pi가 정규화한 실제 값이 UI에 반영된다.
- `Reasoning`과 `Speed`는 독립적으로 바꿀 수 있으며 다음 prompt부터 함께 적용된다.
- 선택 완료, 실패, session 복원 뒤 UI는 Webview 추측값이 아니라 host snapshot의 실제 설정을
  표시한다.
- 키보드, screen reader, 200% zoom, 좁은 editor group과 high-contrast mode에서도 같은 기능을
  사용할 수 있다.

## 3. 제품 범위

포함:

- ChatGPT OAuth로 이용 가능한 `openai-codex` 모델 목록
- 모델별 reasoning effort 선택
- `Standard`와 `Fast` speed 선택
- session별 선택 복원과 현재 설정 표시

제외:

- 다른 provider 선택과 범용 provider 설정 schema
- OpenAI API key 또는 usage-based billing UI
- 임의 model ID 직접 입력
- reasoning mode/pro mode, verbosity와 그 밖의 provider request option
- price, quota 또는 Fast 이용 가능성을 앱이 추정해 보장하는 표시

## 4. Composer 상호작용

### 4.1 Trigger

기존 모델 label 자리에 `model · reasoning · speed`를 한 줄로 축약한 button을 둔다. 예시는
`GPT-5.6 · High · Standard`이다. 좁은 폭에서는 model 이름을 먼저 말줄임하며 accessible name에는
세 값을 모두 유지한다. 로그인 전에는 `모델 설정 필요`, catalog를 불러오는 동안에는
`모델 설정 불러오는 중`을 표시한다.

버튼은 `aria-haspopup="menu"`, 열린 상태와 연결된 메뉴 ID를 노출한다. click, `Enter`,
`Space`, `ArrowUp` 또는 `ArrowDown`으로 1차 메뉴를 연다.

### 4.2 1차 메뉴

1차 메뉴에는 다음 세 행만 둔다.

| 행 | 보조 값 | 동작 |
| --- | --- | --- |
| Model | 현재 model label | 모델 2차 메뉴 열기 |
| Reasoning | 현재 effort | 선택된 모델의 effort 2차 메뉴 열기 |
| Speed | `Standard` 또는 `Fast` | speed 2차 메뉴 열기 |

각 행은 trailing chevron으로 하위 메뉴가 있음을 표시한다. 한 번에 하나의 2차 메뉴만 열린다.
pointer hover는 하위 메뉴를 미리 열 수 있지만 click과 키보드 동작이 항상 동일한 결과를 만든다.

### 4.3 2차 메뉴

- Model: host가 반환한 로그인 계정의 `openai-codex` 모델만 표시하고 현재 모델에 check를 둔다.
- Reasoning: 선택 모델에 대해 Pi `getSupportedThinkingLevels(model)`이 반환한 순서와 값만
  표시한다. Pi의 `off`는 사용자에게 OpenAI 용어인 `None`으로 표시하되 wire/runtime 값은
  변환 없이 구분한다.
- Speed: `Standard`와 `Fast`를 표시한다. `Standard`는 provider 기본 처리 tier를 사용하고,
  `Fast`는 host request boundary에서 OpenAI priority/fast tier로 전달한다.

선택은 host acknowledgement가 성공한 뒤 check와 trigger label에 commit한다. 처리 중에는 해당
행에 busy 상태를 표시하고 중복 선택을 막는다. 모델 선택 acknowledgement에는 최종 model과
정규화된 reasoning effort가 함께 포함되어 두 UI가 원자적으로 갱신된다.

### 4.4 배치와 닫힘

1차 메뉴는 trigger 위쪽에 붙인다. 2차 메뉴는 기본적으로 1차 메뉴 옆에 배치하되, Composer가
오른쪽 경계에 있으므로 사용 가능한 안쪽 방향을 우선한다. viewport/editor group 경계를 넘으면
반대 방향 또는 위쪽으로 재배치한다. 좁은 폭에서는 2차 level을 같은 popover 안의 forward/back
화면으로 보여 주되 정보 구조와 keyboard level은 유지한다.

외부 click, `Escape`, submit, session 변경, panel visibility 상실 때 전체 메뉴를 닫는다.
`Escape`는 2차 메뉴에서 먼저 1차 메뉴로 돌아가고, 다시 누르면 trigger로 focus를 복원한다.
좌우 화살표는 level 이동, 상하 화살표는 같은 level 항목 이동, `Home`/`End`는 첫/마지막 항목으로
이동한다.

### 4.5 실행 중 상태

활성 run 중에도 trigger를 열어 현재 설정은 확인할 수 있다. 그러나 model, reasoning과 speed
변경은 모두 비활성화하고 `현재 응답이 끝난 뒤 변경할 수 있습니다`를 메뉴 상태 설명으로
제공한다. 한 run 안의 tool turn 사이에 설정이 바뀌어 요청 조건이 섞이는 동작은 허용하지 않는다.

## 5. 상태와 권위 경계

Webview에 노출하는 최소 view model은 다음 의미를 가진다.

```text
InferenceCatalogView
  models[]
    modelId
    label

SessionInferenceConfigView
  revision
  modelId
  modelLabel
  reasoningEffort
  supportedReasoning[]
  speed                 standard | fast
  mutable               현재 session이 idle이고 실행 가능한지 여부
```

`providerId`, credential, provider request payload와 raw Pi model 객체는 Webview 계약에 포함하지
않는다. Host는 모든 model lookup을 고정된 `openai-codex` namespace 안에서 수행한다. Webview는
catalog에 없는 model ID, 지원 목록에 없는 effort, 알려지지 않은 speed를 요청할 수 없다.

변경 요청은 `expectedRevision`과 변경할 필드만 포함한다. Host는 session identity, idle 상태,
catalog membership과 capability를 다시 검증하고 성공한 최종 snapshot을 반환한다. stale revision,
실행 중 변경과 유효하지 않은 조합은 side effect 없이 거부한다.

## 6. 소유권과 지속성

- 모델 catalog와 인증 가능 여부: 전역 `ModelRuntime`
- 현재 model과 reasoning effort: Pi `AgentSession`; model/thinking change는 Pi session JSONL이
  복원 가능한 원본이다.
- speed: Extension host의 session-scoped preference. Webview state가 원본이 되지 않는다.
- 메뉴 open level, active item과 임시 focus: Webview transient state

새 session은 로그인 계정의 첫 usable model, Pi가 정규화한 `medium`, `Standard`로 시작한다.
기존 session은 Pi가 복원한 model/reasoning과 host에 저장된 speed를 사용한다. 저장된 model이
catalog에서 사라졌거나 인증상 사용할 수 없으면 자동으로 조용히 바꾸지 않고 복구 가능한
`model unavailable` 상태를 보여 주며 사용자가 새 모델을 고르게 한다. 저장된 Fast가 더 이상
적용되지 않으면 Standard로 fallback한 사실을 한 번 알리고 authoritative snapshot을 갱신한다.

## 7. 제어 흐름

```text
ChatGPT sign-in / session restore
  -> Host: refresh openai-codex availability
  -> Host: resolve AgentSession model + supported reasoning + session speed
  -> snapshot
  -> Webview trigger/menu render

User selects Model
  -> Webview request(modelId, expectedRevision)
  -> Host validates openai-codex catalog + idle session
  -> AgentSession.setModel(model)
  -> Pi clamps/restores supported thinking level
  -> Host returns one authoritative config snapshot
  -> Webview commits Model and Reasoning together

User submits prompt
  -> AgentSession owns selected model and thinking level
  -> Host-owned request option boundary maps speed
       standard -> provider default (service tier omitted)
       fast     -> priority/fast service tier
  -> Pi openai-codex adapter sends request
```

Speed mapping은 OpenAI provider request 직전에만 적용한다. transcript, JSONL, Webview message,
log 또는 credential storage에 provider request body를 복제하지 않는다.

## 8. 실패 동작

| 실패 | 사용자 표면 | 상태 원칙 |
| --- | --- | --- |
| 로그인 전/catalog 없음 | 모델 설정 필요 및 로그인 action | 이전 모델을 usable로 가장하지 않음 |
| catalog refresh 실패 | 기존 snapshot을 read-only로 표시하고 재시도 제공 | 임의 정적 모델 목록으로 대체하지 않음 |
| 모델/effort가 stale | 메뉴 유지, 최신 snapshot 재요청 안내 | host state를 변경하지 않음 |
| run 중 변경 | 항목 비활성 및 설명 | 다음 provider turn에 몰래 적용하지 않음 |
| Fast가 account/model에서 거부됨 | prompt 실패 원인을 공개 오류로 표시하고 Standard 전환 action 제공 | 자동 재전송하지 않음 |
| host acknowledgement 유실 | connection 상태를 uncertain으로 표시하고 snapshot refresh | Webview optimistic 값을 원본으로 삼지 않음 |

Fast 요청이 실패했을 때 같은 prompt를 Standard로 자동 재시도하면 중복 실행 여부가 불명확해질 수
있으므로 금지한다.

## 9. 접근성과 시각 계약

- trigger, 1차 행과 2차 선택 항목은 실제 button/menu semantic을 사용한다.
- 선택 상태는 check icon과 text/ARIA state를 함께 사용하고 색만으로 구분하지 않는다.
- submenu가 열려도 Composer textarea의 draft, selection과 scroll은 보존한다.
- popup은 기존 밝은 surface, 얇은 border, shadow, radius와 type scale token을 재사용한다.
- high contrast에서는 system color와 visible focus ring을 우선한다.
- menu 전환 animation은 reduced-motion에서 제거한다.
- canonical visual fixture는 기본 메뉴, 각 submenu, 좁은 폭 inward placement, running-disabled,
  catalog error 상태를 포함한다.

## 10. 주요 선택과 기각한 대안

- 세 개의 inline select 대신 캐스케이딩 메뉴를 선택했다. Composer의 낮은 시각 밀도를 유지하면서
  모델 목록 길이와 모델별 reasoning 목록을 수용하기 위해서다.
- Model 선택 뒤 별도 modal을 여는 방식은 draft 맥락과 Composer focus를 끊으므로 사용하지 않는다.
- provider를 view model에 일반화하지 않는다. 현재 제품 범위가 OpenAI 전용이고 불필요한 provider
  분기가 보안·검증 면을 넓히기 때문이다.
- 고정 reasoning 목록을 Webview에 두지 않는다. 모델별 지원 차이와 SDK catalog 갱신을 따라가기
  위해 Pi capability를 권위로 사용한다.
- Fast를 별도 “fast model”로 만들지 않는다. 모델 identity와 처리 tier는 서로 다른 설정이며
  설치된 Pi adapter도 request option으로 tier를 전달한다.

## 11. 계획 단계에서 해결 가능한 비차단 항목

- 메뉴 primitive를 기존 component 폴더 안에서 분리하는 정확한 파일 경계
- session speed preference의 storage key와 schema version 이름
- visual fixture의 정확한 viewport 수치와 snapshot 이름

이 항목은 제품 동작이나 권위 경계를 바꾸지 않으므로 구현 계획에서 정할 수 있다.

## 12. 구현 결과

- host/Webview 경계는 `shared/inference.ts`의 제한된 snapshot/change schema로 구현했다.
- `ModelCatalogRefreshCoordinator`가 확장 전용 cache를 매 활성화 복원하고, 로그인 상태에서 확장
  버전별 최초 성공 시에만 `openai-codex` 원격 catalog를 강제 갱신한다.
- Pi `AgentSession`이 model/reasoning의 원본이며, Speed만 `workspaceState`의 session별 preference로
  저장한다. Fast는 기존 payload hook 뒤에서 OpenAI Codex 요청의 `service_tier`만 합성한다.
- Composer에는 Radix 기반의 keyboard/focus-aware 2단계 메뉴를 배치했다. 실행 중에는 메뉴를
  열어 값을 확인할 수 있지만 선택 항목은 비활성화된다.
- typecheck, unit, production build, Pi bundle probe, Extension Host와 Playwright visual/axe 검증을
  통과했다. 실제 ChatGPT 계정별 Fast 허용 여부와 usage가 발생하는 prompt 확인은 release 수동
  검증으로 남긴다.
