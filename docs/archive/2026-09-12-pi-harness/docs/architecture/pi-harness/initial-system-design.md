# Pi Harness Workbench 초기 전체 설계

- 상태: `phase-2-baseline` — [azrael-ex 우선 2단계 전체 설계](../azrael-ex/azrael-ex-two-phase-system-design.md)에 따라 Electron 앱의 2차 참조 설계로 재분류
- 현재 제품 순서: 1차 `azrael-ex` VS Code extension 안정화와 verified-reference interaction/visual acceptance, 2차 이 Electron Workbench 재설계
- 결정일: 2026-09-01
- 범위 수정: 2026-09-02 — Obsidian 수준 문서 워크스페이스, 내장 Git UI, 설정 이식 제거
- 설계 수정: 2026-09-02 — provider-aware hybrid compaction과 portable fallback 확정
- 대상: Windows 우선 로컬 데스크톱 앱, macOS/Linux 이식 가능한 구조
- 근거 목표: 원본 `pi-harness 개발 목표.md`는 현재 repository에 보존되어 있지 않다. 이 문서 19절의 추적성 표를 내부 요구사항 기준으로 사용한다.

## 1. 결정 요약

Pi Harness Workbench는 **Pi를 포크한 터미널 앱이 아니라, Pi 공개 SDK를 격리된 실행 호스트에서 사용하는 로컬 우선 데스크톱 워크벤치**로 만든다.

초기 기준선은 다음과 같다.

1. UI는 Electron, React, TypeScript로 구성한다.
2. Pi는 `@earendil-works/pi-coding-agent`의 공개 SDK를 버전 고정해 사용한다. Pi 내부 소스나 비공개 심볼에는 의존하지 않는다.
3. Pi 런타임은 Electron 메인/렌더러가 아닌 별도 utility process에서 실행한다. 동시에 실행 중인 세션마다 독립 호스트를 둔다.
4. Pi JSONL 세션은 대화의 원본이다. 앱은 세션을 직접 재작성하지 않고 Pi의 세션 API로 fork, tree navigation, compaction, import를 수행한다.
5. 세션 목록, 목표, 영속 대기열, 컨텍스트 캡슐, UI 상태는 앱의 로컬 SQLite 저장소가 소유한다. 세션 검색 인덱스는 원본에서 재생성할 수 있게 분리한다.
6. 과거 질문의 수정과 삭제는 기본적으로 append-only 역사 위의 **새 branch와 가역적 archive**로 구현한다. 원본을 조용히 덮어쓰지 않는다.
7. 다른 세션의 일부 컨텍스트는 사용자가 범위를 고르고 미리 본 뒤 provenance가 포함된 `ContextCapsule`로 대상 세션에 전달한다.
8. compaction은 숨은 내부 동작이 아니라 타임라인의 1급 이벤트로 표시한다. Pi의 범위 계산과 최근 원문 보존은 재사용하되, summary는 장기 작업용 structured checkpoint로 생성한다. OpenAI Responses 호환 경로는 암호화 reasoning을 같은 provider/model의 context로만 재사용하고, 그 밖의 경우 portable summary로 fallback한다.
9. queue는 UI에 보이는 영속 ledger가 소유한다. 전달 여부가 모호한 항목은 자동 재전송하지 않고 `uncertain`으로 표시한다.
10. 문서 기능은 단일 Markdown 파일의 lossless source 편집과 안전한 rendered preview까지만 제공한다. 수정 가능한 rich rendered editing은 round-trip gate를 통과하기 전에는 제공하지 않는다. Obsidian형 workspace와 내장 Git UI는 만들지 않는다.
11. 설정은 현재 기기의 local scope로만 관리한다. 다른 기기로의 export/import나 자동 동기화는 제공하지 않으며 API key와 OAuth token은 OS 보호 저장소에만 둔다.

## 2. 의도한 결과와 성공 조건

### 2.1 의도한 결과

사용자가 프로젝트별 작업을 잃거나 헷갈리지 않고, 대화를 자유롭게 분기·재사용하며, agent 실행 상태와 컨텍스트 변화를 이해할 수 있는 개발 워크벤치를 제공한다.

### 2.2 관찰 가능한 성공 조건

- 동일한 Pi 세션이 목록에 중복 노출되지 않고 프로젝트, 상태, 이름, 최근 사용 시각으로 찾을 수 있다.
- 임의의 과거 user turn에서 새 branch 또는 새 session을 만들고 편집된 질문으로 다시 시작할 수 있다.
- 한 세션의 선택한 message/file/diff만 다른 세션에 전달하고, 대상 세션에서 출처와 token 예상량을 확인할 수 있다.
- 사용자는 자동·수동 compaction의 발생 시점, 요약 결과, 포함/보존 범위와 복원 방법을 확인할 수 있다.
- 실행 중 추가한 steer/follow-up을 목록에서 보고, 아직 전달되지 않은 항목을 수정·재정렬·취소할 수 있다.
- 앱이나 Pi host가 비정상 종료되어도 session, composer draft, queue ledger, goal 상태가 복구되며 모호한 tool 실행을 자동 반복하지 않는다.
- 파일을 drag/drop하거나 선택해서 context에 추가할 수 있고, 대형·binary 파일은 무조건 본문에 inline되지 않는다.
- snippet, Pi prompt template, skill을 한 catalog에서 검색하고 scope를 구분해 사용할 수 있다.
- Markdown 파일은 lossless source view에서 편집하고 안전한 rendered preview로 전환할 수 있다.

## 3. 범위와 비범위

### 3.1 초기 제품 범위

- project/workspace와 session catalog
- 다중 session tab 및 split/dock 가능한 chat surface
- Pi stream, tool call, model/thinking, queue, compaction UI
- session tree, fork, clone, resume, archive
- ContextCapsule 기반 부분 컨텍스트 이동
- goal과 checkpoint 관리
- 단일 파일 중심의 Markdown source 편집/rendered preview
- Pi skill, prompt template, extension/package catalog

### 3.2 명시적 비범위

- VS Code 전체 대체를 목표로 한 LSP, debugger, extension marketplace 호환
- Obsidian식 wiki link, backlink, Canvas, property, embed, plugin runtime
- 내장 Git status/diff/staging/commit/branch UI
- 설정·resource·layout의 기기 간 export/import 또는 자동 동기화
- 실시간 다중 기기 동기화나 동시 편집 서버
- 원격 cloud agent orchestration
- session 일부를 흔적 없이 지우는 secure erase
- 사용자가 검토하지 않은 third-party Pi package의 자동 설치

비범위 기능을 나중에 넣을 수 있도록 renderer와 core/agent host 사이에는 UI 독립적인 protocol을 둔다.

## 4. 아키텍처 방향 결정

### 4.1 검토한 방향

| 방향 | 장점 | 한계 | 판정 |
| --- | --- | --- | --- |
| Pi TUI extension만 개발 | 가장 빠르고 Pi 기본 기능을 그대로 재사용 | drag/drop, session 이동, 자유로운 chat layout 요구를 충족하기 어려움 | 제외 |
| VS Code extension + Pi RPC | editor와 terminal을 재사용 | webview와 VS Code workbench 제약 때문에 app 전체 session UX를 소유하기 어려움 | 보조 integration 후보 |
| Tauri/web shell + Node sidecar | 작은 shell과 web UI | Pi가 Node/TypeScript 기반이므로 별도 Node sidecar packaging과 Rust bridge를 항상 유지해야 함 | 제외 |
| Electron workbench + 격리 Pi host | Pi와 동일한 TypeScript 생태계, UI 완전 소유, utility process 격리, 배포 단순화 | memory와 배포 크기가 큼 | **선정** |

### 4.2 Pi 포크 대신 adapter를 선택한 이유

Pi는 이미 SDK에서 session lifecycle, tree navigation, fork, compaction, queue, streaming event, resource loader를 제공한다. 이 기능을 다시 만들면 호환성과 복구 위험이 커진다. 따라서 Pi의 공개 기능은 재사용하고, 제품 차별점인 GUI, metadata, transfer, goal, durability, recovery를 바깥 계층이 소유한다.

Pi package 변경에 대비해 모든 Pi 호출은 `PiAdapter` 뒤에 둔다. adapter contract는 Pi RPC의 command/event 의미와 가깝게 유지해 필요하면 SDK host를 CLI RPC host로 교체할 수 있게 한다.

## 5. 시스템 구조

```text
┌──────────────────────── Electron application ────────────────────────┐
│                                                                      │
│  ┌───────────────┐    typed bridge    ┌───────────────────────────┐ │
│  │ Renderer      │◀──────────────────▶│ Main Coordinator          │ │
│  │ React UI      │                    │ window, IPC policy, vault  │ │
│  └───────────────┘                    └─────────────┬─────────────┘ │
│                                                    │                │
│                         ┌──────────────────────────┼─────────────┐  │
│                         ▼                          ▼             ▼  │
│                  ┌──────────────┐        ┌──────────────┐   ┌────┐ │
│                  │ Core Service │        │ Pi Host A    │ … │ B  │ │
│                  │ store/index  │        │ active run   │   │    │ │
│                  │ files/index  │        │ Pi SDK       │   │    │ │
│                  └──────┬───────┘        └──────┬───────┘   └────┘ │
└─────────────────────────┼───────────────────────┼───────────────────┘
                          │                       │
                SQLite / workspace files    Pi JSONL / model APIs /
                                           tools / Pi resources
```

### 5.1 Renderer

책임:

- chat, session tree/catalog, context shelf, queue, goal, Markdown view
- optimistic UI가 아니라 command acknowledgement와 normalized event를 기준으로 상태 반영
- session별 composer draft와 선택 상태 표시

금지:

- Node integration, 임의 filesystem 접근, shell 실행, secret 접근
- raw IPC channel 노출
- remote HTML이나 script를 privileged renderer에서 실행

### 5.2 Main Coordinator

책임:

- window와 application lifecycle
- preload의 좁은 typed API와 sender 검증
- Core Service와 Pi Host 생성·종료·heartbeat 감시
- OS file dialog, notification, safe external URL 처리
- OS 보호 저장소를 사용하는 credential vault
- permission prompt의 최종 사용자 승인 전달

Main Coordinator는 agent loop와 indexing처럼 오래 걸리거나 crash-prone한 작업을 직접 수행하지 않는다.

### 5.3 Core Service

하나의 격리 utility process가 다음을 소유한다.

- app metadata SQLite와 migration
- session file discovery, parsing, de-duplication, search projection
- queue ledger, goal journal, ContextCapsule, draft, layout metadata
- drag/drop과 file reference를 위한 workspace file index

Core Service API는 domain command/query만 노출하고 raw filesystem, SQL, shell을 renderer에 노출하지 않는다.

### 5.4 Pi Host

실제로 응답을 생성 중인 session마다 별도 utility process를 둔다. 열린 tab이 모두 process를 점유하지는 않으며, idle session은 JSONL과 projection만으로 표시한다.

Pi Host 책임:

- `AgentSessionRuntime` 생성과 session 교체
- session 교체 후 event subscription과 extension binding 재설정
- prompt/steer/follow-up/abort, model/thinking, fork/navigation/compaction 수행
- Pi compaction preparation을 사용하는 app-owned summary 전략 선택, checkpoint validation과 portable fallback
- Pi event를 application event envelope로 정규화
- permission gate와 application compatibility extension 적용
- heartbeat, structured diagnostic, graceful shutdown

한 Pi Host의 crash는 다른 session과 app window를 종료시키지 않는다.

## 6. 핵심 protocol

모든 process 간 message는 versioned envelope를 사용한다.

```ts
type Envelope<T> = {
  protocolVersion: number;
  messageId: string;
  causationId?: string;
  workspaceId?: string;
  sessionId?: string;
  sequence?: number;
  payload: T;
};
```

원칙:

- command마다 고유 `messageId`가 있고 한 번의 accepted/rejected 응답을 돌려준다.
- stream event는 Pi Host별 단조 증가 `sequence`를 가진다.
- gap이 감지되면 renderer는 추측하지 않고 snapshot query로 재동기화한다.
- 공개 Pi type을 renderer까지 전파하지 않는다. `PiAdapter`가 stable application type으로 변환한다.
- unknown event는 기록하고 무시할 수 있어야 하며 전체 app을 crash시키지 않는다.

주요 Agent command:

- `openSession`, `newSession`, `switchSession`, `forkSession`, `navigateTree`
- `submitPrompt`, `enqueueSteer`, `enqueueFollowUp`, `cancelQueued`, `abortRun`
- `compact`, `setCompactionPolicy`, `setModel`, `setThinkingLevel`
- `grantToolPermission`, `denyToolPermission`, `shutdownHost`

주요 event:

- run/turn/message/tool lifecycle
- queue accepted/delivered/cancelled
- compaction started/completed/failed와 manual/threshold/milestone/overflow-recovery cause
- session replaced/tree changed
- permission requested/resolved
- host heartbeat/crashed/recovered

## 7. 데이터 소유권과 저장 모델

### 7.1 원본 구분

| 데이터 | 원본 | 쓰기 주체 | 복구 방식 |
| --- | --- | --- | --- |
| 대화와 branch/compaction history | Pi JSONL | Pi SessionManager만 | JSONL 재개방 및 tree 재생성 |
| project source/Markdown | workspace filesystem | 사용자, agent tool, Markdown view | 사용자 백업 또는 외부 version control |
| goal, queue, capsule, archive, UI metadata | app SQLite | Core Service | transaction journal과 DB backup |
| session search | SQLite projection | indexer | 원본에서 재생성 |
| 설정·resource 선언 | local scoped config와 Pi resource directory | config service | schema validation과 기본값 복구 |
| API key/OAuth token | OS 보호 credential vault | Main Coordinator | provider 재로그인 |

### 7.2 불변식

- app은 Pi JSONL line을 in-place 수정하거나 순서를 바꾸지 않는다.
- session history action은 append, fork, navigation, archive로 표현한다.
- SQLite transaction commit 이전의 domain event는 UI에 committed로 표시하지 않는다.
- projection 손상은 원본 손상을 의미하지 않는다.
- secret은 일반 설정, diagnostic bundle, log, context capsule에 포함하지 않는다.
- path는 canonical/real path와 platform case rule을 적용한 내부 identity로 비교한다.

### 7.3 Session identity와 중복 제거

- logical session identity는 Pi session header의 UUID다.
- filesystem path는 replica identity이며 logical identity가 아니다.
- 동일 UUID와 동일 content checksum인 복사본은 목록에서 하나로 묶는다.
- 동일 UUID지만 내용이 갈라진 복사본은 덮어쓰지 않고 `replica conflict`로 표시한다.
- session row는 project/workspace, display name, parent session, active leaf, updated time, pin/archive/tag, run state를 보유한다.
- project filter는 현재 경로 문자열만 비교하지 않고 workspace identity를 사용한다.

이 모델로 여러 root를 scan하거나 laptop에서 session file을 복사해도 단순 중복 목록이 생기지 않는다.

## 8. Session과 대화 조작

### 8.1 Fork와 과거 질문 수정

과거 user turn의 `Edit and continue`는 다음 의미를 갖는다.

1. 선택 entry의 부모까지 active path를 정한다.
2. Pi fork API로 새 session 또는 현재 tree의 새 branch를 만든다.
3. 기존 질문 text를 composer draft로 복사한다.
4. 사용자가 수정해 전송하면 새 user entry로 append한다.

원 질문과 이후 대화는 사라지지 않으며 source branch로 돌아갈 수 있다.

### 8.2 삭제 의미

기본 `Delete branch`는 선택 지점부터의 branch를 session catalog/tree 기본 보기에서 archive한다. active context에서 제거하려면 부모 지점에서 새 branch를 시작한다.

- archive는 가역적이다.
- 한 질문만 지우고 그 질문에 의존한 assistant/tool 결과를 그대로 이어 붙이지 않는다.
- 이후 결과 중 필요한 내용은 ContextCapsule로 새 branch에 선택 이관한다.
- 개인정보용 영구 삭제는 별도 secure erase 기능으로 분리하며 초기 범위에 포함하지 않는다.

UI에서는 `목록에서 숨김`, `현재 context에서 제외`, `영구 삭제`를 하나의 모호한 Delete로 합치지 않는다.

### 8.3 Session catalog

catalog는 project별 group과 전역 search를 함께 제공한다. 기본 정렬은 pinned, running, recently updated이며 다음을 한 row에서 구분한다.

- session display name과 자동 요약 title
- workspace와 branch/parent 관계
- running/idle/crashed/needs-attention
- active goal과 queue count
- model, context usage, last activity
- archived/replica conflict 표시

## 9. ContextCapsule: 부분 컨텍스트 이동

### 9.1 계약

```ts
type ContextCapsule = {
  capsuleId: string;
  mode: "snapshot" | "reference";
  sources: Array<SessionRangeSource | FileSource | DiffSource | NoteSource>;
  renderedMarkdown: string;
  provenance: Array<{ sourceId: string; label: string; capturedAt: string }>;
  checksum: string;
  tokenEstimate: number;
};
```

- 기본 mode는 재현 가능한 `snapshot`이다.
- file은 사용자가 원하면 `reference`로 두어 전송 직전에 다시 읽을 수 있다.
- message range, 개별 tool result, file, diff, 사용자가 쓴 note를 섞을 수 있다.
- capsule editor는 실제로 model에 전달될 rendered form과 token estimate를 보여준다.
- 출처 session과 entry ID, file path, capture 시점은 UI provenance로 남긴다.
- target session에는 다음 user prompt에 부착하거나 독립 context message로 추가한다.
- adapter는 capsule을 명시적 경계와 source label이 있는 model-visible block으로 변환하며 system instruction처럼 위장하지 않는다.

### 9.2 Drag/drop

- workspace file drop은 path reference를 만든다.
- 외부 path는 한 번의 scope 승인을 요구한다.
- image는 Pi image content로 보낼 수 있다.
- text는 size와 token estimate를 보고 inline 또는 reference를 선택한다.
- directory와 대형/binary 파일은 자동 inline하지 않고 manifest와 lazy read 권한만 제공한다.
- 원본 file을 app attachment 폴더로 암묵적으로 이동하지 않는다.

## 10. Context와 compaction 투명성

상세 전략, 불변식, checkpoint schema와 fallback 계약은 [Provider-aware hybrid compaction 설계](hybrid-compaction-design.md)를 따른다.

### 10.1 Context inspector

각 session에 다음을 표시한다.

- model context window와 현재 추정 usage
- system/context file, active messages, compaction summary, capsule, attachment의 구성
- 항목별 가능하면 추정 token과 provenance
- auto-compaction threshold 및 response reserve

SDK가 정확한 항목별 token을 제공하지 않는 경우 `estimate`로 명확히 표시하고 provider가 보고한 전체 usage와 섞지 않는다.

### 10.2 Hybrid compaction

Pi SDK가 계산한 오래된 연속 prefix와 최근 원문 tail 경계를 그대로 사용한다. app-owned hidden extension은 prefix의 summary 생성만 다음 중 하나로 교체한다.

- `openai-reasoning-aware`: 같은 OpenAI Responses provider/호환 model에서 원래 message 순서와 encrypted reasoning item을 model context로 재전달해 structured checkpoint를 생성한다.
- `portable`: provider-neutral model-visible conversation과 이전 checkpoint로 같은 schema의 summary를 생성한다.
- `portable-fallback`: capability 불일치, provider/model 변경, API 거절 또는 result 검증 실패 시 선택한다.

어느 경로도 hidden reasoning을 복호화하거나 UI/DB/log에 노출하지 않는다. OpenAI native compaction endpoint도 사용하지 않는다. summary 생성은 자체 prompt를 사용한 일반 model 요청이며, 검증된 visible checkpoint만 Pi `CompactionEntry`와 이후 context에 남긴다.

### 10.3 Compaction record

각 compaction은 timeline event와 별도 record를 남긴다.

- 원인: manual, threshold, milestone, overflow recovery
- source boundary와 first kept entry
- custom instruction
- 선택된 strategy, fallback reason, 생성된 checkpoint와 공개 details
- tokens before/after 또는 unavailable 표시
- 사용 model과 발생 시각
- pre-compaction tree로 이동하거나 fork하는 복원 action

Pi의 compaction은 lossy context projection이지만 JSONL 전체 history는 보존된다. UI는 `요약을 취소하면 원문이 복원된다`고 오해시키지 않고, history 지점으로 이동하거나 branch를 만드는 실제 동작을 설명한다.

reasoning-aware 전략은 Pi가 선택한 연속 prefix 안의 완결된 response/tool 관계 전체를 사용한다. reasoning item을 임의로 떼어내거나 순서를 재조립하지 않으며, 공개 Pi API로 안전한 provider request port를 만들 수 없으면 해당 전략을 비활성화하고 portable 경로만 제공한다.

## 11. 영속 Queue

### 11.1 QueueItem

```ts
type QueueItem = {
  queueItemId: string;
  sessionId: string;
  kind: "steer" | "followUp";
  markdown: string;
  attachmentRefs: string[];
  ordinal: number;
  status:
    | "queued"
    | "dispatching"
    | "accepted"
    | "delivered"
    | "cancelled"
    | "failed"
    | "uncertain";
};
```

### 11.2 상태 규칙

- `queued`만 수정·재정렬할 수 있다.
- dispatch 전에 SQLite에 먼저 기록한다.
- Pi가 prompt를 accepted 했다는 acknowledgement 후 `accepted`가 된다.
- 대응 user entry가 session에 관찰되면 `delivered`가 된다.
- process가 dispatch와 관찰 사이에 죽어 전달을 증명할 수 없으면 `uncertain`이다.
- `uncertain`은 자동 재전송하지 않는다. 사용자가 session entry를 비교해 resend 또는 dismiss한다.
- abort는 queue를 먼저 회수한 뒤 run을 중단해 draft로 복원한다.

Pi compatibility extension은 가능한 경우 `queueItemId`를 생성된 user entry metadata와 연계한다. 공개 SDK가 이 metadata를 보존하지 않는 버전에서는 adapter가 보수적으로 `uncertain`을 사용한다.

## 12. Goal 모델

Goal은 slash command의 일회성 prompt가 아니라 session 밖의 durable domain object다.

```ts
type Goal = {
  goalId: string;
  workspaceId: string;
  title: string;
  objective: string;
  successConditions: string[];
  constraints: string[];
  status: "draft" | "active" | "paused" | "blocked" | "achieved" | "abandoned";
  linkedSessionIds: string[];
  checkpoints: GoalCheckpoint[];
  revision: number;
};
```

규칙:

- 한 session에는 동시에 하나의 active goal만 연결한다.
- 한 goal은 fork를 포함한 여러 session에 연결할 수 있다.
- session 시작/goal revision 변경 시 objective, success condition, constraints만 담은 짧은 goal capsule을 agent에 전달한다.
- 전체 checkpoint journal을 매 turn context에 반복 삽입하지 않는다.
- agent는 checkpoint와 status 변경을 제안할 수 있지만 `achieved` 확정은 기본적으로 사용자 확인을 요구한다.
- blocker, evidence, artifact link는 append-only checkpoint로 남는다.
- goal 진행률은 임의 percent보다 충족된 success condition과 열린 blocker로 표시한다.

## 13. Resource catalog

다음을 하나의 catalog에서 다루되 원래 의미는 유지한다.

- snippet: 사용자가 즉시 삽입하는 Markdown 조각
- Pi prompt template: 변수를 확장해 prompt가 되는 Markdown
- skill: 필요할 때 agent가 읽는 `SKILL.md` capability
- extension/package: code를 실행하는 고권한 resource
- theme와 keybinding

각 항목은 built-in, user, workspace, project scope와 source path/version/trust를 표시한다. 같은 이름은 scope precedence로 resolve하되 shadowed source를 UI에서 볼 수 있게 한다.

설정과 resource는 현재 기기의 local scope에서만 관리한다. export/import, 기기 간 path mapping, 자동 동기화 protocol은 두지 않는다.

## 14. 단순 Markdown 보기와 입력

- Markdown의 canonical data는 항상 plain text file이다.
- 한 번에 한 파일을 열어 lossless source view와 읽기 전용 rendered preview 사이를 전환한다.
- rich rendered editing은 Markdown round-trip 무손실 gate를 통과한 성숙한 editor component가 확인되기 전까지 비활성화한다. 자체 rich-text engine은 만들지 않는다.
- `Clear formatting`은 selection의 Markdown presentation marker만 제거하고 text와 code/data를 임의 변환하지 않는다.
- file tree, document tab/split, outline, wiki link, backlink, local document search는 제공하지 않는다.
- save 전에 external modification을 감지하면 overwrite하지 않고 source view에서 충돌을 알린다.
- agent edit event와 document buffer가 충돌하면 자동으로 한쪽을 덮어쓰지 않는다.

코드 파일 편집, LSP, debugger는 외부 editor에 맡긴다.

## 15. 제거된 기능 경계

- Git 상태, diff, staging, commit, branch UI를 제공하지 않는다. Git 작업은 외부 도구나 agent tool 사용 범위에 맡긴다.
- Obsidian 수준의 문서 탐색과 지식 관리 기능을 제공하지 않는다. 남는 문서 기능은 14절의 단일 Markdown 보기뿐이다.
- 설정과 resource를 다른 기기로 이전·공유·동기화하는 기능을 제공하지 않는다.

## 16. 권한과 보안 경계

### 16.1 Renderer 보안

- `nodeIntegration: false`, `contextIsolation: true`, renderer sandbox 사용
- restrictive Content Security Policy와 packaged local content 사용
- preload는 command별 좁은 method만 노출
- IPC sender, payload schema, workspace/session ownership 검증
- untrusted Markdown HTML은 sanitize하고 script/event handler를 실행하지 않음

### 16.2 Agent 권한

- tool call은 read, write, execute, network, external-path 범주로 정규화한다.
- permission rule은 deny > session allow > workspace allow > ask 순으로 평가한다.
- 범위 밖 path, destructive command, credential 접근은 기본 ask/deny다.
- permission decision과 실제 tool result를 audit event로 남긴다.
- third-party Pi extension/package는 agent host 안에서도 사용자 계정 권한으로 arbitrary code를 실행할 수 있다. 따라서 source/version/trust 검토 없이는 활성화하지 않는다.

### 16.3 Credential

- Pi `ModelRuntime`에는 application credential-store adapter를 주입한다.
- 저장 값은 Electron `safeStorage`의 비동기 OS 암호화 API로 보호한다.
- renderer와 일반 설정 파일에는 secret value를 전달하지 않는다.
- diagnostic/logging 계층은 key/token pattern을 redact한다.
- OS 암호화 backend가 안전하지 않은 platform에서는 credential 저장을 거부하거나 명시적인 경고와 ephemeral mode를 사용한다.

## 17. 실패와 복구 동작

### 17.1 Renderer crash 또는 화면 오류

- composer draft, open tab, selection, scroll anchor는 session별로 debounce 저장한다.
- React error boundary는 실패한 pane만 격리하고 전체 app reload를 강제하지 않는다.
- renderer reload 후 Core Service snapshot과 event cursor로 다시 동기화한다.

### 17.2 Pi Host crash

- heartbeat 손실 시 session을 `crashed`로 표시한다.
- 마지막 committed Pi JSONL과 queue ledger를 다시 읽는다.
- read-only/tool-free 상태 복원은 자동으로 할 수 있다.
- write, shell, network tool이 실행 중이었던 경우 `needs-attention` recovery card를 표시한다.
- side effect가 있었는지 증명할 수 없는 tool이나 prompt를 자동 재시도하지 않는다.

### 17.3 Core Service 또는 DB 문제

- SQLite transaction과 WAL을 사용하고 migration 전에 backup을 만든다.
- search/session projection 손상은 원본에서 재구축한다.
- goal/queue/capsule journal 손상은 마지막 정상 backup을 열고 손상 범위를 diagnostic으로 표시한다.
- migration 실패 시 이전 schema DB로 rollback하고 app을 read-only recovery mode로 연다.

### 17.4 Pi upgrade 문제

- Pi version은 lockfile에 고정한다.
- adapter는 public SDK contract만 사용한다.
- upgrade 시 session fixture, fork/tree, queue, compaction, auth, event normalization compatibility를 통과하기 전 새 version을 활성화하지 않는다.
- session format version이 낯선 경우 직접 migration하지 않고 해당 Pi version의 importer 또는 read-only mode를 사용한다.

## 18. 주요 사용자 흐름

### 18.1 Prompt 전송

1. renderer가 draft, capsule, attachment, delivery kind를 command로 보낸다.
2. Core Service가 queue ledger/outbound record를 commit한다.
3. Main Coordinator가 session의 Pi Host와 permission 상태를 확인한다.
4. Pi Host가 Pi SDK에 prompt/steer/follow-up을 전달한다.
5. accepted acknowledgement와 stream event가 sequence와 함께 돌아온다.
6. user entry가 JSONL에서 관찰되면 queue item이 delivered가 된다.

### 18.2 부분 컨텍스트 이동

1. source session timeline/tree에서 message와 tool result를 다중 선택한다.
2. ContextCapsule editor가 provenance, rendered text, token estimate를 보여준다.
3. 사용자가 snapshot/reference와 target session을 정한다.
4. capsule은 target의 context shelf에 놓이고 다음 prompt에 명시적으로 부착된다.
5. target timeline에서 source로 이동할 수 있는 provenance card를 표시한다.

### 18.3 오래된 질문 수정

1. user turn의 `Edit and continue`를 선택한다.
2. fork 범위와 새 session/현재 tree branch를 preview한다.
3. Pi fork 후 원 text가 draft로 복사된다.
4. 수정본을 보내면 새 branch가 되며 원 branch는 그대로 남는다.

### 18.4 Hybrid compaction

1. 사용자 요청, Pi threshold/overflow 또는 안정된 milestone이 compaction을 시작한다.
2. Pi가 source prefix, 최근 원문 tail, 이전 summary와 `firstKeptEntryId`를 계산한다.
3. Pi Host가 provider/model capability를 확인해 reasoning-aware 또는 portable 전략을 선택한다.
4. 자체 prompt로 `CheckpointV1`을 생성하고 schema와 source boundary를 검증한다.
5. 성공하면 Pi가 compaction entry를 append하고 checkpoint + 최근 원문 tail로 current context를 재구성한다.
6. Core Service가 공개 metadata를 projection하고 UI가 strategy, 범위, token label과 navigate/fork action을 표시한다.
7. 두 전략이 모두 실패하거나 abort되면 기존 context와 JSONL을 성공 상태로 변경하지 않는다.

## 19. 목표 문서 추적성

| 기록된 불편 | 설계 대응 |
| --- | --- |
| chat fork 불가 | session tree + fork/edit-and-continue |
| compaction 동작 불투명 | provider-aware structured checkpoint + Context inspector + CompactionRecord + navigate/fork action |
| session 목록 중복/이어가기 어려움 | header UUID 기반 de-dup catalog + stable workspace/session identity |
| 일부 context 이동 불가 | selection UI + ContextCapsule + provenance |
| queue bug | durable queue ledger + explicit state + uncertain recovery |
| `/goal` 미흡 | durable Goal/Checkpoint domain model |
| 파일 drag context 불가 | scoped drag/drop + inline/reference policy |
| 이전 질문 삭제 불가 | branch archive와 parent fork, 별도 secure erase 의미 |
| 오래된 질문 수정 불가 | edit-and-continue fork flow |
| Markdown 입력 formatting 제거 불편 | plain Markdown source + selection clear-formatting |
| snippet 기본 없음 | unified Resource catalog의 snippet/prompt template |
| 화면 이탈 후 restart | renderer/host 격리, pane error boundary, persisted drafts, recovery |
| Markdown을 Obsidian처럼 보기 | 단일 파일 lossless source 편집 + 안전한 rendered preview |
| Codex chat 이동 불편 | dock/split 가능한 session tab surface |

## 20. 수용한 trade-off

- Electron의 memory/배포 크기를 감수하고 Pi와 같은 TypeScript/Node runtime, utility process, 완전한 UI 소유권을 얻는다.
- Pi JSONL을 직접 고치지 않는 대신 과거 변경은 branch와 archive 의미로 제공한다.
- 정확히 한 번 실행을 거짓으로 약속하지 않고, crash 경계에서 증명 불가능한 항목을 `uncertain`으로 드러낸다.
- OpenAI native compaction에 결합하지 않고 검토 가능한 checkpoint를 사용한다. reasoning-aware 경로가 공개 API 경계에서 안전하지 않으면 품질 이득보다 portable fallback을 우선한다.
- 범용 IDE를 만들지 않고 chat/session/context/goal과 단일 Markdown 보기에 집중한다.
- 내장 Git UI, 설정 이식, Obsidian형 지식 관리 기능을 제외해 Core Service와 renderer의 책임을 줄인다.

## 21. 다음 논의에서 바꿀 수 있는 제품 기본값

아래는 현재 설계에서 기본값을 결정했으므로 구현 계획을 막지는 않는다. 다만 사용자의 의도가 다르면 관련 범위를 설계 단계에서 수정해야 한다.

1. **삭제 정책**: 현재는 archive + branch가 기본이고 secure erase는 제외했다. 개인정보나 기밀 대화의 부분 영구 삭제가 초기 필수인지 확인이 필요하다.
2. **Goal 종료 권한**: 현재는 agent가 달성을 제안하고 사용자가 확정한다. terminal status까지 agent가 자동 변경해 장기 실행해야 하는지 확인이 필요하다.
3. **플랫폼 순서**: 현재는 Windows 품질을 먼저 보장하고 macOS/Linux를 구조적으로 지원한다. 첫 배포부터 macOS 동등 지원이 필요한지 확인이 필요하다.

## 22. 설계 준비 상태

핵심 구조, 소유권, process 경계, session/context/queue/goal 계약, 실패 동작, permission 경계는 구현 계획을 만들기에 충분하다. 위 기본값 중 하나를 바꾸면 해당 영역만 설계 revision을 추가한 뒤 계획으로 넘어간다.

## 23. 근거 자료

2026-09-02 기준 공식 자료와 설치된 Pi SDK를 근거로 했다.

- [Pi coding-agent README](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/README.md)
- [Pi SDK](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)
- [Pi RPC mode](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md)
- [Pi session format](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/session-format.md)
- [Pi compaction](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/compaction.md)
- [Provider-aware hybrid compaction 상세 설계](hybrid-compaction-design.md)
- [OpenAI latest model guide](https://developers.openai.com/api/docs/guides/latest-model)
- [OpenAI Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create)
- [Pi packages](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md)
- [Electron process model](https://www.electronjs.org/docs/latest/tutorial/process-model)
- [Electron security](https://www.electronjs.org/docs/latest/tutorial/security)
- [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)
- [VS Code webview API restrictions](https://code.visualstudio.com/api/extension-capabilities/overview)
