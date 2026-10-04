# Provider-aware hybrid compaction 설계

- 설계 상태: `accepted`
- 구현 상태: `completed` (2026-09-02 baseline)
- 결정일: 2026-09-02
- 상위 설계: [초기 전체 설계](initial-system-design.md)
- 구현 단계는 저장소 외부 계획에서 관리한다.

## 1. 결정

Pi가 이미 소유한 **압축 범위 계산, 최근 원문 보존, split-turn 처리, JSONL 기록과 context 재구성**은 그대로 사용한다. 앱은 Pi의 `session_before_compact` hook에서 summary 생성 전략만 교체한다.

summary 생성은 두 경로를 가진다.

1. `openai-reasoning-aware`: OpenAI Responses 계열의 같은 provider와 호환 model을 사용하는 경우, 압축 대상의 연속된 과거 prefix를 원래 message 순서와 response/tool 관계를 유지한 채 일반 Responses 요청에 전달한다. 암호화된 reasoning item은 복호화하거나 표시하지 않고 model context로만 다시 전달한다.
2. `portable`: 그 밖의 provider, model 변경, reasoning payload 부재, API 거절 또는 검증 실패에서는 Pi가 model-visible conversation으로 직렬화한 내용을 구조화된 checkpoint로 요약한다.

두 경로의 결과는 모두 사람이 읽을 수 있는 `CheckpointV1`이다. 성공한 checkpoint를 Pi의 정상 `CompactionEntry`로 저장하고, Pi는 그 checkpoint와 압축하지 않은 최근 원문 tail로 다음 context를 구성한다.

이 기능은 OpenAI의 native compaction endpoint를 호출하지 않는다. 자체 prompt를 사용하는 일반 model 요청이며, provider가 반환한 새 hidden reasoning item도 checkpoint나 앱 저장소의 일부로 삼지 않는다.

## 2. 목표와 비목표

### 2.1 목표

- 장기 작업의 목표, 제약, 결정, 증거, 실패 이력과 다음 행동을 일반 대화 요약보다 안정적으로 보존한다.
- OpenAI reasoning-aware 경로에서는 이미 존재하는 암호화 reasoning item을 같은 provider/model의 입력 context로 재사용한다.
- 사용자가 압축 범위, 남은 원문 tail, 선택된 전략, fallback과 복원 지점을 확인할 수 있게 한다.
- provider 기능이 없거나 실패해도 portable 경로로 같은 Pi session을 계속 사용할 수 있게 한다.
- Pi JSONL을 유일한 대화 원본으로 유지하고 앱 DB는 재구축 가능한 projection만 소유한다.

### 2.2 비목표

- hidden chain-of-thought를 복호화, 추출, 표시, 검색 또는 SQLite에 복제하지 않는다.
- reasoning item 하나만 임의로 떼어 다른 대화 순서에 삽입하지 않는다.
- OpenAI native compaction item이나 서버 저장 conversation에 의존하지 않는다.
- Pi의 cut-point, recent-tail, split-turn 또는 session format을 다시 구현하지 않는다.
- 서로 다른 provider나 비호환 model 사이에서 암호화 reasoning payload의 이식성을 보장하지 않는다.

## 3. 재사용 근거와 gap

설치된 `@earendil-works/pi-coding-agent` 0.84.4는 다음을 이미 제공한다.

- context pressure를 `contextTokens > contextWindow - reserveTokens`로 판단한다.
- 기본 `reserveTokens=16384`, `keepRecentTokens=20000` 정책과 오래된 연속 prefix/최근 원문 tail 분리를 제공한다.
- tool result에서 자르지 않고 split turn을 보정하며 이전 summary를 다음 summary에 병합한다.
- `CompactionEntry`에 summary, `firstKeptEntryId`, usage와 details를 남긴다.
- `session_before_compact` extension이 custom compaction 결과를 반환할 수 있다.
- OpenAI Responses adapter가 `store:false`, `reasoning.encrypted_content` 포함 요청과 `thinkingSignature` 재전달을 지원한다.

남은 gap은 Pi의 일반 compaction serializer가 model-visible thinking text만 직렬화하고 encrypted `thinkingSignature`는 summary 요청에 보존하지 않는다는 점이다. 앱은 Pi의 구간 계산을 재사용하되 reasoning-aware 전략에서만 원래 Pi message object의 구조를 보존해 provider adapter에 전달해야 한다.

Pi의 중첩 의존성인 `pi-coding-agent/node_modules/@earendil-works/pi-ai`를 앱이 직접 import하지 않는다. 공개 Pi 런타임만으로 좁은 provider request port를 만들 수 있는지는 구현 전 risk gate에서 증명한다. 증명하지 못하면 reasoning-aware 경로를 활성화하지 않고 portable 전략을 제품 기본값으로 유지한다.

## 4. 구성 요소와 소유권

```text
Pi pressure/manual trigger
          │
          ▼
Pi CompactionPreparation ── source prefix / recent raw tail / previous summary
          │
          ▼
app-owned CompactionCoordinator (hidden trusted extension)
          │
          ├─ capability OK ─► openai-reasoning-aware generator
          │                         │
          └─ otherwise ─────► portable generator
                                    │
                          CheckpointV1 validator
                                    │
                                    ▼
                      Pi CompactionEntry + raw tail
                                    │
                   normalized event / SQLite projection / UI
```

| 구성 요소 | 책임 | 소유자 |
| --- | --- | --- |
| Pi compaction preparation | threshold, cut point, branch entries, previous summary, recent tail | Pi SDK |
| `CompactionCoordinator` | trigger metadata, strategy 선택, abort/failure 조정 | Pi Host |
| provider request port | 현재 provider/model로 tool-free summary 요청 | Pi Host adapter |
| reasoning-aware generator | 원래 message 순서와 reasoning/tool 관계를 보존한 checkpoint 요청 | Pi Host |
| portable generator | provider-neutral serialized context의 checkpoint 요청 | Pi Host |
| checkpoint validator | schema, size, 필수 section, source boundary 검증과 1회 repair | Pi Host |
| `CompactionRecord` projection | 공개 metadata, summary, 상태와 idempotency | Core Service |
| context/compaction UI | context 구성, 전략, fallback, 범위, navigate/fork 표시 | Renderer |

extension은 기존 `pi-harness-permission`과 나란히 app-owned hidden/trusted factory로 등록한다. third-party extension discovery를 다시 활성화하지 않는다.

## 5. 압축 단위와 불변식

reasoning-aware 전략도 선택된 reasoning item만 따로 압축하지 않는다. Pi가 계산한 **연속된 과거 prefix 전체**가 summary request의 source다. 일부 reasoning item을 활용한다는 것은 그 prefix 안에 포함된 완결된 assistant response를 원래 위치에서 함께 전달한다는 뜻이다.

다음 불변식을 지킨다.

- source는 branch의 연속된 prefix이며 `firstKeptEntryId` 이전이다.
- assistant reasoning, assistant output, function/tool call과 대응 result의 순서를 바꾸거나 고아 item을 만들지 않는다.
- unresolved tool call 또는 실행 중인 turn에서는 milestone/manual compaction을 시작하지 않는다.
- reasoning-aware 전략은 같은 provider/API 계열과 compatible model에서만 사용한다.
- raw `thinkingSignature`와 provider transport payload는 Pi Host/원본 JSONL 경계를 벗어나지 않는다.
- raw payload는 application event, log, diagnostic bundle, SQLite, context snapshot, capsule, renderer에 포함하지 않는다.
- 검증된 checkpoint가 생기기 전에는 Pi context나 JSONL에 성공한 compaction을 append하지 않는다.
- checkpoint text가 app 수준의 canonical compacted state다. summary 요청이 새로 생성한 hidden reasoning은 버린다.
- 현재 model context, Pi JSONL 전체 history, 앱의 `CompactionRecord` projection을 서로 다른 것으로 표시한다.

## 6. Checkpoint 계약

```ts
type CheckpointV1 = {
  schemaVersion: 1;
  objective: string;
  successConditions: string[];
  constraints: string[];
  completed: Array<{ work: string; evidence: string[] }>;
  currentWork: string[];
  decisions: Array<{
    decision: string;
    rationale: string;
    status: "active" | "superseded" | "uncertain";
  }>;
  failedAttempts: Array<{ attempt: string; result: string; doNotRepeat?: string }>;
  artifacts: Array<{
    kind: "file" | "command" | "test" | "identifier" | "other";
    value: string;
    state?: string;
  }>;
  blockers: string[];
  uncertainties: string[];
  nextActions: string[];
  criticalContext: string[];
};
```

필드에 해당 정보가 없으면 빈 배열을 사용한다. 사실과 추론을 구분하고, 완료 주장은 evidence를 요구한다. prompt는 서술을 아름답게 줄이는 것보다 정확한 작업 상태, 변경된 artifact, 검증 결과, 실패와 다음 행동을 보존하도록 지시한다.

Pi `CompactionEntry.details`에는 다음 공개 metadata만 추가한다.

```ts
type HybridCompactionDetails = {
  schemaVersion: 1;
  strategy: "openai-reasoning-aware" | "portable" | "portable-fallback";
  checkpoint: CheckpointV1;
  source: { startEntryId?: string; endEntryId?: string; firstKeptEntryId: string };
  provider?: string;
  model?: string;
  previousCheckpointUsed: boolean;
  fallbackReason?: string;
};
```

`CompactionRecord`는 Pi entry ID, cause, source/kept boundary, strategy, checkpoint, token 측정값과 시각을 projection한다. hidden provider payload는 저장하지 않는다.

## 7. Trigger와 정책

| cause | 시작 주체 | 의미 |
| --- | --- | --- |
| `manual` | 사용자 | preview 후 명시적으로 실행 |
| `threshold` | Pi | context pressure가 policy를 넘음 |
| `milestone` | 앱 | 안정된 작업 경계에서 app이 manual compaction을 요청하고 별도 cause metadata를 남김 |
| `overflow-recovery` | Pi | overflow 이후 compact하고 한 번 재시도 |

초기값은 Pi의 `reserveTokens`와 `keepRecentTokens`를 유지한다. 앱은 이 값과 auto-compaction on/off를 표시하고 저장하되 Pi SDK의 계산을 복제하지 않는다. milestone은 완료된 test/build 또는 사용자가 확정한 checkpoint처럼 안정된 경계에서만 제안하며 자동 실행은 초기 범위 밖이다.

## 8. Strategy 선택과 fallback

`openai-reasoning-aware`는 다음을 모두 만족할 때만 선택한다.

- 현재 route가 encrypted reasoning replay를 지원하는 OpenAI Responses 계열이다.
- 압축 source의 reasoning signature가 현재 provider/model에서 재사용 가능하다.
- source가 완결된 message/response/tool 관계를 유지한다.
- 공개 Pi API 기반 provider request port가 risk gate를 통과했다.

summary 요청은 현재 system goal과 checkpoint instruction, 이전 checkpoint, 선택된 source prefix를 입력으로 받고 tool을 허용하지 않는다. 서버 저장에 기대지 않으며 `store:false`를 유지한다.

다음 경우 `portable-fallback`으로 전환한다.

- provider/model 변경 또는 capability 미지원
- signature 누락/불일치 또는 provider 요청 거절
- reasoning-aware result가 schema validation에 실패하고 1회 repair도 실패
- 공개 API 경계로 안전하게 요청을 구성할 수 없음

fallback reason은 공개 코드로 기록한다. provider payload나 secret을 오류 메시지에 복사하지 않는다. portable 경로도 실패하면 기존 context를 그대로 두고 compaction을 failed/aborted로 끝낸다.

## 9. 실패, 복구와 보안

- summary 생성과 validation은 side-effect 없는 준비 단계다.
- abort 또는 실패는 completed Pi entry를 만들지 않는다. 앱에는 실패 attempt만 기록할 수 있다.
- overflow recovery 재시도는 원 prompt의 별도 신규 queue item으로 집계하지 않는다.
- 동일 Pi compaction entry의 Core projection은 idempotent upsert한다.
- projection 손상 시 Pi JSONL의 공개 compaction entry에서 재구축한다. app-only preview/cause/fallback metadata는 복구 불가하면 `unavailable`로 표시한다.
- reasoning-aware 기능을 끄거나 provider가 바뀌어도 기존 checkpoint는 portable text로 계속 사용한다.
- diagnostic test는 signature와 credential의 부재를 검증하고 원문 값을 snapshot에 넣지 않는다.

## 10. 사용자 표시

Compaction card와 inspector는 다음을 구분해 표시한다.

- cause와 strategy, fallback reason
- 압축된 source range와 남은 raw tail boundary
- checkpoint의 공개 section
- before/after token이 exact, estimate, unavailable 중 무엇인지
- provider/model과 발생 시각
- `Navigate to pre-compaction point`, `Fork from pre-compaction point`

`Restore` 또는 `undo summary`라고 부르지 않는다. navigate/fork는 전체 JSONL history의 과거 지점 또는 새 branch를 여는 동작이며 현재 branch의 compaction entry를 삭제하지 않는다.

## 11. 수용 기준

- manual, threshold, milestone, overflow-recovery가 같은 coordinator와 record contract를 사용한다.
- OpenAI capability fixture에서 encrypted reasoning item이 provider adapter 입력까지 보존되지만 event/DB/UI에는 나타나지 않는다.
- model/provider mismatch, malformed result와 API rejection은 portable fallback 또는 무변경 실패로 끝난다.
- checkpoint는 필수 작업 상태와 evidence를 보존하고 schema 검증을 통과한다.
- Pi가 계산한 first-kept boundary와 최근 원문 tail이 바뀌지 않는다.
- restart/reindex 후 completed record가 중복되지 않고 pre-compaction navigate/fork가 동작한다.
- reasoning-aware 경로가 비활성화되어도 portable compaction으로 장기 작업을 계속할 수 있다.

## 12. 수용한 trade-off

- opaque native compaction item 대신 검토·이식 가능한 visible checkpoint를 canonical state로 사용한다.
- encrypted reasoning 재사용의 잠재적 품질 이득을 얻는 대신 같은 provider/model 제약과 별도 capability 검증을 수용한다.
- reasoning-aware 경로를 위해 Pi 내부 의존성에 결합하지 않고, 공개 API가 부족하면 portable 기능만 출시한다.
- 원문 일부를 삭제하는 압축이 아니라 current context projection만 줄이므로 JSONL 저장량은 줄지 않는다.

## 13. 근거 자료

- [Pi compaction](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/compaction.md)
- [Pi SDK](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)
- [OpenAI latest model guide — persisted reasoning and manual history management](https://developers.openai.com/api/docs/guides/latest-model)
- [OpenAI Responses API reference](https://developers.openai.com/api/reference/resources/responses/methods/create)
