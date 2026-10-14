상태: MCP 검색·지연 노출 구현·검증·정리 완료. 앱 전체 빌드·설치와 live Anthropic 수용은 후속 범위다.

# Claude 도구 컨텍스트 효율 개선 구현계획

## 목표·허용 범위·확정 기준
대상 세션 `01a138f5-ac07-7d43-8843-b6d3693dccb3`에서 확인된 MCP 도구 정의의 초기 일괄 노출을 해결한다. 기존 OpenAI provider 및 Claude Code의 핵심 도구 즉시 제공 + MCP 검색 후 로딩 흐름에 가급적 맞추며 장기 유지보수 경계를 정리한다.

현재 실행 범위는 Claude MCP 검색·지연 노출 수정, 관련 helper 투영, 프로필 보존과 필수 회귀 검증이다. 코드·테스트·소유 문서 수정과 검증용 컴파일은 허용된다. 앱 전체 빌드·설치·유료 추론·계정 변경·원격 게시 권한은 포함하지 않는다. 429 상세 진단 확장과 나머지 컨텍스트 최적화 후보는 후속 범위로 유지한다.

확정된 보존 기준:
- 기존 prompt/tool/harness profile 시스템 자체를 유지한다. 설정 스키마, 구성 ID, provider/model 바인딩, 상속·override, 사용자 template 파일과 prompt 선택을 보존한다.
- `builtin/anthropic-default`, `builtin/claude-lean`, `builtin/claude-code-core`, 일반 `builtin/azrael-default`를 유지한다. 실제 provider identity에 따른 Claude preset eligibility 및 모델별 override를 보존한다.
- Claude 핵심 도구 이름·사용법·executor를 유지한다. Read/Edit/Write의 읽기 확인·정확한 수정, Bash의 cwd/작업 소유권, Grep/Glob, Agent, Skill, AskUserQuestion의 현재 계약을 바꾸지 않는다.
- 핵심 도구를 일괄 deferred로 바꾸지 않는다. 필수 직접 도구 + ToolSearch는 최초 요청에 계속 제공한다. 변경 중심은 MCP 도구의 검색·노출·요청 투영이다.
- native registry, dispatcher, 권한·sandbox·approval, account/thread scope와 원본 대화 저장 형식을 유지한다. 검색 또는 과거 schema가 실행 권한을 새로 부여하지 않는다.
- 별도 검색 서비스나 새 프로필 시스템을 도입하지 않는다. API의 고정 8개 active-set 정책을 Anthropic에 일괄 적용하지 않는다.

## 확정된 구현 결정과 영향
이번 구현은 1~3단계의 도구 노출·요청 구성과 4단계의 프로필 replay 보존 검증을 수행한다. 429 상세 진단 확장은 MCP 흐름 수정과 분리해 후속으로 남긴다. OpenAI wire와 Claude wire를 한 형식으로 통일하지 않고 공통 검색 의미만 재사용한다.

전송 방식은 현재 Claude-compatible ordinary function 경로에서 native 검색 후 선택한 완전한 schema를 보내는 방식을 기본 수정안으로 권장한다. 이미 존재하는 경로를 사용하므로 프로필·reasoning replay 변경 범위를 줄이면서 초기 전송량을 줄일 수 있다. Anthropic 공식 `tool_reference` 방식은 fixture 및 OAuth 호환성을 평가하고, 동일한 프로필/권한 계약과 전송량 목표를 만족할 때 adapter 구현으로 채택할 수 있다. 전체 schema를 매 요청 전송하는 server-side search는 이번 기본안으로 채택하지 않는다.

`tool_reference` 채택으로 전체 catalog 재전송, cache 동작 변화, 검색된 도구의 임의 축출 또는 도구 가용성 변화가 필요하면 영향과 대안을 이 계획에서 검토한 뒤 해당 부분만 결정한다. 단순 프로토콜 구현 선호로 기존 기능을 축소하지 않는다. 고정 신규 도구 개수/byte 한도는 이 계획에서 확정하지 않으며 기존 모델 컨텍스트·전송 상한과 실제 필수 도구 비용을 사용한다. 새 사용자 가시 한도가 필요하면 측정 근거와 함께 제시한다.

자동 재시도·자동 계정 전환 정책 변경, quota UI 개편, 핵심 도구의 설명/사용법 변경, 프로필 설정 UI 추가는 이번 수정안 밖이다. 설치는 정확한 패키지 검증 후 실행 권한을 확인해 진행한다.

## 근거와 실제 상태
- 실패는 2026-10-14 14:49:51~14:49:56 KST, `managed/anthropic/claude-opus-5-5`, 응답 생성 전 HTTP 429였다. 제한 종류나 Retry-After는 보존되지 않았다. 429가 대량 입력 때문인지, RPM/TPM/계정 한도인지 확정하지 않는다.
- 실제 PID 14732는 `artifacts/w14w/artifacts/releases/w14y`를 사용했고 출처는 `artifacts/engine-input-AF01`이다. 해당 입력의 MCP deferred 조건과 Claude ToolSearch 등록 조건이 불일치했다.
- 실제 wire: 도구 587개, 도구 정의 826000 bytes / 추정 235142 tokens, 전체 추정 259170 tokens, body 913984 bytes. 서버 실제 토큰 계수와 구분한다. 당시 UI 잔액과 추론 계정 동일성은 입증하지 않았다.
- 수정 대상은 기본 checkout `engine/`와 `providers/opencodex/`다. frozen release/source는 조사 근거이며 수정하지 않는다. 현재 `managed_catalog.rs::supports_client_tool_search`는 Meta/API를 지원하고 Anthropic은 여전히 제외한다. 초기 조사 이후 추가된 Meta 경로도 보존한다.
- 실패 당시 `tools/spec_plan.rs`는 MCP deferred 노출을 model 검색 지원 플래그로 정하고 Claude 검색 executor에는 별도 profile 조건을 사용했다. 구현은 두 경계를 공통 host 판정으로 연결했다.
- `session/turn.rs::build_prompt`는 Claude harness/API에 `ToolRouter::chat_specs_with_discovered`를 이미 호출한다. Claude `ToolSearch`는 native 검색 envelope를 보존한다. 이 연결을 재구현하지 않는다.
- `chat_specs_with_discovered`는 BoundedApi와 RetainDiscovered 정책을 분리한다. API 8개/64 KiB 제한을 유지하고, Claude는 남아 있는 대화에서 발견한 live schema를 모두 유지한다.
- managed mapper의 검색 이력 투영 및 API의 stricter projection이 이미 있다. 기존 유지·권한 계약에 맞춰 재사용한다.

## 기존 방식과 구현 원칙
OpenAI: 검색 지원 모델에서 native client search를 제공한다. 초기 catalog에는 direct 도구와 검색 도구를 싣고, BM25 검색 결과의 schema를 `tool_search_output.tools`로 로딩한다. Responses Lite/incremental 선언도 별도 유지한다.
Claude Code 공식 current 문서: MCP는 기본 deferred이며 이름·서버 안내를 제공하고 필요할 때 ToolSearch로 로딩한다. 핵심 내장 도구는 upfront다. 10% threshold는 선택 가능한 `auto` 설정이며 current 기본값이 아니다. 사용자 설치 Claude Code의 실제 wire capture는 확인하지 않았다.
Anthropic API: `defer_loading`은 model context 로딩을 늦춘다. server-side 검색은 전체 schema를 계속 전송하며, custom `tool_reference` 검색도 참조 이름에 대응하는 top-level 정의를 요구한다. 전송 byte와 model context token을 별도 지표로 측정한다.

## 적용 환경·소유권
요구사항 분류는 공통: provider/model 도구 선택, native discovery, 요청 투영과 오류 의미는 Windows x64·Linux x64·macOS ARM64 공통 코드다. Bash/파일 executor 등 기존 OS별 구현은 변경하지 않는다. 현재 실행 근거는 Windows 로컬 호스트뿐이다. Linux/macOS 실행 수용을 Windows 통과로 대체하지 않는다.

Root가 공유 계약·소스 변경·통합·최종 판단을 담당한다. 이 계획은 subagent 실행을 요구하지 않는다. 시작 시 변경 파일의 현재 Git 상태를 확인하고 다른 작업/사용자 변경을 보존한다. 기존 엔진 source 선택과 build playbook을 따른다.

계약 소유 문서:
- [Model harness profiles](../../docs/architecture/model-harness-profiles.md): 프로필 선택·isolation·실행·fingerprint/replay 보존.
- [Managed providers](../../docs/architecture/managed-providers.md): 검색 이력·wire alias·전송·진단.
- [Custom API models](../../docs/architecture/custom-api-models.md): API 전용 검색·active catalog 한도 보존.
- [Accounts](../../docs/architecture/accounts.md): confirmed quota recovery 및 계정 scope 보존.
기능 보존 ID `engine.model-harness-profiles`와 기존 managed/context 진단 항목의 owner·필수 검사를 갱신한다. 계획만 작성한 현재는 architecture를 verified/current로 바꾸지 않는다.

## 구현 순서·입력·인계 산출물

### 1. 기존 계약을 보호하는 fixture 준비
입력: 현재 profile resolver·registry·mapper 및 대량 카탈로그 실패 수치.
변경 owner: 기존 `tools/spec_plan_tests.rs`, `router_tests.rs`, `managed_catalog.rs`의 테스트, `providers/opencodex/tests/`.
산출물: 587/1000개 MCP catalog에서 초기 wire 노출, Claude 핵심 도구 목록, 검색→호출→결과의 예상 계약 fixture. 뒤 단계의 회귀 판정에 사용한다.
검색 결과 0개·중복·이름 충돌·제거된 도구·대형 단일 schema·반복 검색 이력도 준비한다. 같은 제품 정책을 fixture에 복제하지 않는다.

### 2. 검색 가능 여부와 노출 정책의 일관성 복구
입력: 1단계 fixture와 기존 profile 선택 결과.
변경 owner: `engine/codex-rs/core/src/managed_catalog.rs`, `tools/spec_plan.rs` 및 필요한 최소 tool-policy owner.
실행: native search executor 제공과 MCP deferred 계산이 동일한 host 판정을 사용하도록 정리한다. catalog의 Responses 검색 지원 metadata는 유지한다. 이 값을 Anthropic에서 켜면 기존 핵심 도구 노출에 영향을 주므로 resolved Claude profile을 host 능력 판정에 사용한다. 공통 판정은 model/provider 및 resolved profile에 기반한다. provider wire 기능과 host 검색 능력을 혼동하지 않는다. 새 프레임워크 대신 기존 경계에 작은 공통 판정 함수를 둔다.
산출물: Claude MCP가 deferred인 registry, 기존 핵심 도구+ToolSearch만 있는 초기 model-visible catalog. OpenAI/API/Meta의 기존 노출과 text-only 모델 가용성은 보존한다.

### 3. 검색된 도구와 이력의 요청 투영 정비
선행 조건: 2단계 registry/노출 계약.
변경 owner: `tools/router.rs`, `session/turn.rs`, `providers/opencodex/inference.ts`, `inference-mapping.mjs` 및 기존 search-history projection owner.
실행: `chat_specs_with_discovered`를 재사용하되 API active-set 제한과 Claude의 검색된 도구 유지 정책을 분리한다. 완전한 현재 schema와 stable namespace alias를 사용하고, 검색 결과와 실제 호출의 identity 및 call/result 순서를 보존한다. 필수 직접 도구를 임의 삭제하지 않는다.
검색 schema를 현재 tools와 history에 불필요하게 중복 전송하지 않도록 wire 사본만 투영한다. 저장된 rollout과 과거 tool 결과는 수정하지 않는다. 프로필·provider·account scope를 넘는 private reasoning은 재사용하지 않는다.
prepareOnly 입력 예산과 실제 infer가 같은 projection을 사용한다. 최종 wire에서 필수/선택/검색 도구 수, schema bytes, 추정 tokens를 구분하고 helper 변환 후 재팽창을 검사한다. 한도 초과 시 전체 catalog 자동 fallback 또는 schema 잘라내기를 하지 않는다.
산출물: 초기 입력 축소와 정상 discovery→call의 provider fixture. native tool_reference 후보는 이 단계의 호환성 검증으로 판단하며 별도 독립 시스템을 만들지 않는다.

### 4. 프로필 replay 검증 및 후속 실패 진단
선행 조건: 최종 wire 구조 확정. 진단 fixture 준비는 앞 단계와 독립적으로 가능하다.
변경 owner: 기존 `inference-errors.ts`, helper progress/transport diagnostics, engine error contract·inspector owner. 기존 app-logging/diagnostic 계약을 읽고 최소 구조 필드만 확장한다.
후속 진단 제안(이번 MCP 구현에는 미적용): HTTP status, allowlisted 제한 종류, 유효한 Retry-After/reset 및 request correlation을 보존한다. 불명확한 429는 unknown으로 남기고 원문/body/token을 로그에 저장하지 않는다. 기존 quota 회복과 retry 규칙을 바꾸지 않는다.
프로필 config/schema/ID는 유지한다. 실제 tool contract 또는 rendered instruction이 변경되면 기존 semantic fingerprint/contract revision 체계로 호환성을 표현한다. fingerprint 문자열의 무조건 동일성을 약속하지 않으며 변경 시 visible history를 유지하고 incompatible private replay만 기존 계약대로 배제한다. 기존 세션·reload·handoff·prewarm·compaction이 같은 immutable request snapshot을 쓰는지 확인한다.
산출물: 안전한 오류 구조 및 profile selection/replay 회귀 증거.

### 5. 통합·패키지 수용·정리
선행 조건: 고정된 통합 입력에서 1~4단계 필수 검사 통과.
변경 owner: 해당 architecture owner·feature inventory·기존 검증 wrapper. 대체된 중복 판정만 정리하며 unrelated refactor를 하지 않는다.
실행: 검증용 source 입력을 고정하고 build playbook의 보호 경로·검사·정리 계약을 따른다. 앱 전체 빌드 및 기존 Windows 패키지 갱신/동일성 검증은 후속 명시적 빌드·설치 범위다. 제품 live OAuth 검증은 실행 권한과 안전한 계정 scope가 확보된 경우 수행한다. 설치·push·배포는 별도 실행 권한 범위에서만 진행한다.
산출물: 실행 scope·exit code·로그 경로·미검증 환경·패키지 동일성·cleanup 근거. 구현 완료 후 해당 변경만 task commit하고 원격 push는 하지 않는다. worktree를 사용한다면 사전 지침에 따라 통합·검증·제거한다.

## 성공 기준과 검증
| 성공 기준 | 검증 방법 |
| --- | --- |
| 프로필 시스템 보존 | resolver inheritance/override/template tests, `check-model-harness-profiles.cjs` config/tools scopes와 provider isolation fixture 재사용 |
| 초기 MCP 전체 schema 미전송 | 587 및 1000개 fixture의 최종 wire에서 core+search만 확인; core 비용과 source 요약 비용을 별도 측정 |
| 검색 후 실제 도구 사용 가능 | 검색 결과 완전한 schema, tool 호출·정확한 결과·다음 model response까지 실제 엔진/mock provider flow 확인 |
| 임의 8개 제한·전역 가용성 축소 방지 | 8개를 넘는 서로 다른 도구를 반복 검색·호출; 새 요청의 policy 차이 및 API 기존 제한 각각 확인 |
| 검색 이력 중복 비용 억제 | 반복 검색 전후 wire catalog/history component 측정; 원본 rollout 불변·call/result ID·namespace 보존 |
| 권한·실행 보존 | removed/denied/hidden 도구, forged 검색 결과, alias 충돌, 핵심 Read/Edit/Bash/Agent/Skill 계약 회귀 |
| 프로필·account/request snapshot 보존 | custom prompt와 claude-lean/default, known/unknown Anthropic 모델, OpenRouter Claude, model switch/reload/handoff/compaction 및 fingerprint mismatch replay fixture |
| 다른 provider 회귀 없음 | OpenAI client search와 Responses Lite/incremental, Devin, managed Meta 및 API context/mapper의 영향받는 기존 검사 |
| 예산 산출과 실제 전송 일치 | 기존 context-budget fixture의 prepareOnly/infer wire 일치 및 oversized complete schema 처리 |
| 진단 정확성 | rate/quota/unknown 429, 유효/잘못된 Retry-After, cancellation 및 secret 미출력 fixture |
| Windows 통합 수용 | frozen source 검사·exact package helper/engine identity·host checks; native Linux/macOS 수용은 별도 실제 결과로 보고 |
| 실제 사용자 오류 개선 | 권한 확보 시 같은 규모 catalog로 live Anthropic 검색·응답 검증; 잔여 429는 구조 진단으로 분류, 성공을 사전 보장하지 않음 |

로그·검증 산출물은 프로젝트 `artifacts/logs/`와 기존 verification owner 아래 task-specific 경로에 둔다. 성공 요약에는 검사 범위·실제 exit code·로그 경로를 기록한다. 소스 fixture 통과와 installed/live 통과를 분리한다.

## 도구 검색 외 컨텍스트 효율 비교
현재 계획은 초기 MCP 전체 schema 노출 결함을 해결하는 범위이며 Claude Code의 컨텍스트 관리 전체를 이식하는 계획은 아니다. 다음 후보는 범위 비교이며 구현 승인이나 자동 범위 확장이 아니다. 기존 프로필 시스템 보존 기준을 모두 유지한다.

| 방식 | Azrael 현재 소스 근거 | 후속 판단 |
| --- | --- | --- |
| MCP 검색·지연 로딩 | native discovery 존재, Anthropic exposure 불일치 | 이번 수정의 최우선 범위 |
| 자동/수동 대화 압축 | native compaction executor 및 provider/model threshold 존재 | 새 기능으로 중복 구현하지 않음; Claude 흐름과 실제 수용 확인 |
| 출력 생성 시 크기 제한 | Claude Read 32 KiB, Bash native truncation policy, Grep/Glob bounds 존재 | 대형 로그·파일을 원문 보관+작은 preview+재조회로 처리하는 일관된 경계는 추가 비교 후보 |
| 오래된 tool result의 단계적 정리 | 이번에 조사한 context/session/state와 Anthropic helper/adapter에서 명시적 clear_tool_uses 경로를 확인하지 못함 | 긴 대화에서 후보. native summary와 별도 의미이며 현재 통합 여부를 추가 확인한 뒤 설계 |
| prompt caching | adapter 기본 short cache, native endpoint top-level 자동 cache 및 explicit breakpoints 존재 | compatible profile이 build 후 system blocks를 재구성하므로 최종 wire breakpoint와 실제 cache hit 안정성을 확인. 캐시 전체가 없다고 주장하지 않음 |
| 지침·skill 지연 로딩/중복 제거 | typed instruction-state projection, selected skill body load/dedup 존재; claude-lean preset 존재 | 보존. 상시 catalog/guide 비용은 별도 측정하고 사용자/project 지침을 자동 삭제하지 않음 |
| thinking block 관리 | scoped private replay 존재; clear_thinking 요청 정책은 해당 adapter에서 확인되지 않음 | 모델별 API default와 OAuth 호환성, reasoning continuity/cache 영향 확인 전 도입하지 않음 |
| programmatic tool calling | Claude preset은 Direct, 다른 경로의 Code Mode 존재 | Anthropic PTC를 새로 도입하면 도구 흐름·실행 경계가 달라짐. 이번 MCP 수정과 분리 |
| subagent context isolation | native Agent/roles와 child 권한 존재 | 독립 context·최종 요약 이점을 유지하되 full-history 상속 비용을 무조건 줄일 수 있다고 가정하지 않음 |

공식 Claude Code 문서는 오래된 tool output을 먼저 정리하고 필요하면 대화를 요약한다고 설명한다. skills on-demand와 subagent 독립 context도 설명한다. Anthropic API에는 context_management의 tool-result/thinking clearing이 있지만 API 기능의 존재를 Azrael OAuth 적용·검증으로 간주하지 않는다.

우선순위 제안: 초기 MCP 대량 전송 수정 → 최종 wire의 검색 이력 중복 및 cache 안정성 검증 → 실제 긴 세션에서 오래된 결과 정리/대형 출력 재조회 정책을 별도 설계. 초기 실패 세션의 대화 비용은 작으므로 후속 최적화를 초기 429 해결의 선행 조건으로 만들지 않는다. 캐시는 반복 처리 비용/지연, 검색·결과 정리는 model context 점유를 줄이므로 지표를 구분한다.

추가 비교 근거:
- https://code.claude.com/docs/en/how-claude-code-works#when-context-fills-up
- https://code.claude.com/docs/en/costs
- https://platform.claude.com/docs/en/agents-and-tools/tool-use/manage-tool-context
- https://platform.claude.com/docs/en/build-with-claude/context-editing
## 현재 검증·남은 사항
검증 결과: helper Node 4개, Bun 46개 회귀 및 최종 검색 이력 5개, 공통 지침/도구 진단 Node 10개, 확장된 input-budget wrapper가 exit 0이다. Windows 네이티브 Claude 도구 32개, 프로필 격리 1개, API 발견 정책 4개, MCP 노출 1개, 프로필 설정 10개가 각각 통과했다. 기존 설치본과 live OAuth의 429 개선은 아직 검증하지 않았다.
최종 수용은 네이티브 discovery→실행, API 기존 제한, profile isolation 및 고정 입력 검사를 포함한다. Claude Code 자체의 실제 wire 동일성은 공식 문서만으로 주장하지 않는다. 장기 개선은 기존 ownership에서 공통 판정을 정리하는 수준으로 제한하며 별도 프로필/검색 시스템을 만들지 않는다.

공식 비교 근거:
- https://developers.openai.com/api/docs/guides/tools-tool-search
- https://code.claude.com/docs/en/mcp#scale-with-mcp-tool-search
- https://code.claude.com/docs/en/agent-sdk/tool-search
- https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool
- https://platform.claude.com/docs/en/api/rate-limits



## 실행 기록

- Root: Rust MCP 노출·검색 조건, router 정책, 프로필 tool revision, native fixture, 소유 문서·feature owner·통합 수용 담당.
- `/root/claude_projection`: helper mapper/inference와 해당 provider fixture만 담당. 587/1000 catalog, 11개 발견 schema, 반복 검색·원본 불변·제거 도구·prepareOnly/실제 wire·최종 OAuth 이름을 검증했다. 재위임·앱 빌드·설치·live API는 수행하지 않았다.
- 초기 native snapshot `artifacts/verification/BD01-native-r1/source`는 Windows 긴 경로로 복사 실패(9239 file input 중 TUI snapshot 이름). 컴파일 전에 실패했으며 다음 입력은 짧은 `artifacts/bd2/engine`으로 생성했다. 입력 수정 때문에 새 식별값을 사용했다.
- native source-r2: 전체 engine 9239 files를 고정. `artifacts/logs/BD01-native/source-r2.json`에 파일별 SHA-256을 보존한다. 원래 engine Cargo cache를 재사용하며 동시 cargo 프로세스가 없는 것을 시작 전에 확인했다.
- 로그: `artifacts/logs/BD01-claude-projection/node-harness-mapping.log`, `bun-targeted.log`, `bun-search-final.log`; native `artifacts/logs/BD01-native/profile-tools-r2.log`. 테스트 범위는 Windows x64/MSVC이며 Linux/macOS, 설치본, 실제 Anthropic은 미검증이다.


### 최종 구현·검증 결과

- MCP 정책과 검색 executor는 동일한 `supports_client_tool_search` host 판정을 사용한다. MCP 단위 노출 정책을 owning helper로 추출해 587/1000 fixture가 실제 제품 판정을 검증하도록 했다. 관리형 catalog metadata는 유지해 핵심 도구의 기존 노출을 보존했다.
- Claude retained discovery와 API bounded discovery를 명시적으로 분리했다. 완전한 live schema, 제거/숨김 도구 제외, 일반 function 결과로 discovery를 위조할 수 없는 기존 경계를 유지했다.
- Claude ToolSearch는 native bounded source 안내를 보존한다. helper의 typed 검색 결과는 현재 catalog 참조로 줄이고 최종 OAuth 도구 이름에 맞춘다. ordinary 출력·원본 history는 유지한다.
- 프로필 구성/ID/선택/상속/사용자 template은 유지하고 Claude tool revision만 v2로 올렸다. private replay는 기존 fingerprint 불일치 배제 규칙을 따른다.
- 기존 feature owner에 router/turn을 연결하고 기존 native profile 검사에 API/MCP 회귀를, 기존 input-budget 검사에 search-history/harness 투영을 추가했다.
- native source-r2 SHA-256: e5405f0256045688ba62541b045f5f3786ddf2707c142158d5ef36f5ccf6cc16. 첫 native compile 13m49s, Claude 32개 실행 15.63s. 시작 2026-10-14 15:55:34 KST. 입력은 immutable source-r2이며 checkout router.rs의 기존 CRLF 복원은 정규화한 소스 동일성 검사로 확인했다. frozen source 파일은 수정하지 않았다.
- 첫 native wrapper는 32개 성공 후 다른 `cargo build --target x86_64-pc-windows-msvc` 작업의 artifact cache 잠금에 대기했다. 다른 빌드에는 개입하지 않고 이번 작업의 대기 Cargo만 종료했다(wrapper exit -1). 소스가 확인된 unit binary를 SHA-256으로 고정하여 같은 남은 필터를 직접 실행했다.
- 직접 실행의 MCP 필터는 기본 test thread stack으로 overflow(exit -1073741571). 기존 runner와 같은 `RUST_MIN_STACK=33554432`로 해당 실패 필터만 다시 실행하여 exit 0(6.74s)을 확인했다. 제품 코드를 바꾸지 않았다. API 4개 및 provider isolation 1개는 최초 direct 실행에서 성공했다. `core-regressions.log`, `mcp-regression-stack.log`, `core-binary-sha256.txt`를 보존한다.
- 프로필 설정은 별도 task cache에서 jobs=2로 실행해 공유 잠금을 피했다. cache 준비 2026-10-14 16:15:37~16:18:18 KST; config compile/검사 16:18:18~16:30:23 KST, 10개 성공(실행 0.04s), wrapper exit 0. clone 준비 비용과 dependency 재컴파일을 실제 시간으로 기록하며 단축 수치를 주장하지 않는다.
- 공통/문서 검증: 로컬 문서 링크 및 feature JSON 유효성, 선택한 staged diff whitespace 검사 exit 0. feature inventory는 이번 owner 두 줄만 staged patch로 분리해 다른 작업의 변경을 보존했다.
- 실제 검증은 Windows x64/MSVC의 소스/native/provider mock 경계다. 앱 전체 패키징·설치·live Anthropic·Linux/macOS는 수행하지 않았다. 429 종류/Retry-After 진단 확장, 캐시 안정성 및 장기 세션 결과 정리는 후속 후보이며 이번 MCP 완료로 이 항목들의 수용을 주장하지 않는다.

- 정리: exit 0. 실패한 `artifacts/verification/BD01-native-r1`, 고정 검증 소스/복사된 unit binary `artifacts/bd2`, 임시 Cargo cache `artifacts/bdcache`의 실제 부재를 확인했다. 삭제 전 절대 경로·프로세스 참조·reparse point를 확인하고 일반 PowerShell Remove-Item을 사용했다. 기존 engine cache와 다른 작업/설치본은 보존했다. 로그·source manifest·binary hash·작업 기록만 남겼다.
- 커밋 범위: 이 작업의 17개 파일/부분 변경만 묶으며 원격 push는 수행하지 않는다. 다른 작업의 feature inventory 및 나머지 미커밋 변경은 보존한다.
