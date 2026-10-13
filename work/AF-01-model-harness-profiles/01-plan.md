상태: Windows x64 빌드·사용자 프로필 설치 진행 중. 원래 세션의 마지막 요청으로 지금까지의 전체 변경사항을 포함한 앱 빌드와 로컬 설치가 승인됐다. 원격 게시와 버전 증가는 범위 밖이다.

# 모델별 하네스 프로필과 Claude Code 도구 호환

## 목표·산출물·현재 권한

Azrael에서 모델별로 모델이 받는 컨텍스트와 도구 구성을 설정할 수 있게 하고, Anthropic provider 모델에는 Claude Code와 유사한 코딩 환경을 기본 제공한다. 산출물은 승인된 1차 범위의 코드, 설정 예시, 소유 설계와 검증 결과, 그리고 누적 변경을 반영한 Windows x64 패키지와 일반 VS Code 사용자 프로필 설치 영수증이다. 구현·테스트·작업 커밋·전체 Windows 빌드와 로컬 설치는 승인됐다. 설치 전 필수 검증과 현재·직전 런타임 보존을 수행한다.

확정한 범위:

- Claude Code 실행기를 연결하는 방식이 아니라 Azrael 네이티브 엔진에 호환 프로필을 추가한다.
- 설정 파일을 먼저 제공한다. 새 설정 화면은 후속 작업이다.
- 1차는 Read/Edit/Write/Grep/Glob/Bash, 에이전트·스킬·MCP 탐색·사용자 질문이다. NotebookEdit, Cron, Worktree, Plan 전환 도구는 후속이다.
- Anthropic provider의 모델은 신규 호환 도구로 대체한 프로필을 기본 사용한다. 동일 역할의 기존 OpenAI/Codex 도구는 목록·검색·code mode 내부 정의와 관련 사용 안내에서 제외해 중복 컨텍스트를 줄인다.
- 다른 provider는 신규 호환 도구를 도구 목록·검색·code mode 내부 목록에서 볼 수 없고 새 호출도 실행할 수 없다. 다른 provider에서 제공하는 Claude 모델도 이 기본 적용 대상이 아니다.
- Azrael 세션, 권한·승인, 협업, 계정, 제공자 전환, 압축과 복구 기능을 보존한다.

## 검토할 선택과 추천

1. Windows Git Bash가 없는 환경의 처리: 기존 Git Bash를 탐색하고 없으면 Bash의 미지원 사유와 설정 경로를 알리는 방식을 추천한다. PowerShell을 Bash라는 이름으로 실행하면 문법·종료 코드·경로 계약이 달라진다. Bash를 배포에 포함하는 방안은 용량·업데이트·실행 파일 관리가 추가되므로 별도 환경 결정이 필요하다. 현재 조사 PC에는 C:/Program Files/Git/bin/bash.exe가 존재하지만 실제 Bash 호환 실행 검증은 아직 하지 않았다.
2. Read의 매체 범위: 첫 완료 기준은 소스코드·일반 텍스트 파일 읽기다. 이미지·PDF·노트북 읽기는 기존 매체 기능·디코더를 확인한 뒤 별도 지원 상태를 밝히는 안을 추천한다. pages 인자·시각적 읽기를 설명에 넣는다면 실제 처리가 검증돼야 하며, 이 범위를 빼고 전체 Read가 동일하다고 보고하지 않는다. NotebookEdit는 확정된 후속 범위다.
3. 새 모델의 자동 분기: Anthropic provider 기본 프로필은 모든 신규 모델에도 적용한다. 확인된 모델 ID·명시적 family metadata와 fixture는 legacy/lean 최적화 예외에만 사용하고, 미확인 모델은 provider 기본 프로필을 상속하며 미검증 상태를 밝히는 안을 추천한다. 새 모델의 기본 적용과 해당 모델의 호환 검증을 구분한다.

위 추천은 사용자의 권장 설계 구현 승인으로 1차 구현 기준에 포함한다. 다른 provider의 신규 도구 비노출은 사용자 요구이므로 프로필 설정으로 우회할 수 있는 선택지가 아니다.

## 현재 설계 대비 차이와 근거

현재 소스는 주 체크아웃 engine/의 통합 Codex 0.162.0이다. docs/ops/development.md의 Source and state가 소스 선택을 소유한다. 이 작업의 조사는 Windows 체크아웃의 소스이며, 현재 설치본의 모든 요청을 관찰한 것은 아니다.

- prompts/src/model_instructions.rs의 render_model_instructions는 ModelInfo를 무시하고 공통 agent_behavior를 반환한다. session/mod.rs의 get_prompt_base_instructions도 요청 복사본을 공통 지침으로 갱신한다. 함수 하나만 바꾸면 나중에 다시 공통 지침으로 덮일 수 있다.
- core/src/session/step_settings.rs의 ResolvedStepSettings와 step_context.rs의 StepContext가 모델과 해당 요청의 ToolRouter를 포착한다. turn 전체만 고정하면 실행 중 모델 선택 변경과 어긋날 수 있으므로 이 요청 단위 경계를 재사용한다.
- tools/spec_plan.rs가 네이티브 실행·노출·검색 도구 구성을 소유한다. code mode 도구 정의, MCP 검색과 discovered-tool 기록도 이 실제 registry에서 파생돼야 한다.
- providers/opencodex/inference-mapping.mjs는 현재 도구를 az_<identity hash> 이름으로 바꾼다. ToolSpec에 Read라고 쓰는 것만으로 모델이 Read라는 이름을 받지는 않는다.
- Anthropic XML 포맷은 common_instructions/runtime_instructions/current_task/tool_result 등으로 내용에 CDATA 래핑을 추가한다. 이 정책과 Claude Code 호환 컨텍스트 표현을 분리해야 한다.
- inference.ts의 reasoning/replay는 provider/model/thread/account/turn과 호출 ID·인자 digest를 검증한다. 프로필 변경도 replay 호환성 조건에 포함해야 한다.
- tools/hook_names.rs는 apply_patch에 Edit/Write, spawn_agent에 Agent라는 hook matcher alias를 이미 지원한다. matcher 이름과 실제 hook payload 이름은 별개다.
- unified_exec, apply_patch, ExecutorFileSystem와 환경별 sandbox, skills 확장, MCP/ToolSearch, multi-agent V2, user-input handler를 재사용한다. core의 현재 tools/handlers 경로에서는 직접 사용할 Read/Grep/Glob 파일 handler를 찾지 못했으며, 없다고 일반화하지 않고 구현 준비에서 executor 및 ext 경계를 더 확인한다.
- codex-file-search는 ignore 기반 파일 탐색을 제공하지만 그 옵션·정렬·glob 의미가 Claude Code Glob과 같다고 가정하지 않는다. Grep의 ripgrep 실행은 인자를 직접 전달하고 승인·취소·출력 제한을 네이티브 경계로 연결한다.
- instructions/instructions/agent-behavior.md에는 functions.exec와 Promise.allSettled, functions.request_user_input_async 이름이 들어간다. 호환 프로필이 이 도구들을 노출하지 않을 때 관련 안내도 동일한 프로필에서 렌더링해야 한다.

선행 실험은 Claude Code Windows 2.1.289의 -p 요청을 loopback 모의 Anthropic API로 캡처했다. Sonnet 4.5는 시스템 문자열 27,457자와 26개 도구, Opus 5.5는 5,904자와 22개 도구였다. 프로젝트 지침과 스킬 설명은 전달됐고 미사용 스킬 본문은 전달되지 않았다. Read 결과는 줄 번호와 호출 ID가 붙은 tool_result로 다음 요청에 전달됐다. 도구 설명에서 Read-before-Edit/Write, 정밀 문자열 매칭, Bash cwd·백그라운드 동작을 확인했지만 해당 동작 전체를 실행 검증한 것은 아니다.

근거: C:/Users/felre/.azrael-ex/tmp/devin-native/azrael-claude-analysis-m9dysdi0/provenance.json, comparison-summary.json, sonnet-project-requests.json, opus-project-requests.json, read-roundtrip-requests.json. 모의 usage·cost는 실제 토큰 사용량이나 성능·과금 자료가 아니다. 기준 fixture는 버전·실행 모드·OS·설정을 고정하며 최신/대화형 Claude Code 전체로 확대하지 않는다.

## 제안 구조

### 요청 단위 프로필

하나의 ResolvedHarnessProfile이 컨텍스트 템플릿, 도구 preset, 설명 variant, wire-name map, 결과 formatter, 컨텍스트 표현, 프로필 revision과 의미 fingerprint를 소유한다. 실제 provider ID와 선택 모델 ID를 먼저 확정하고, 요청의 모델·도구·지침이 같은 snapshot을 소비한다.

구성 층:

1. RuntimeCore: Azrael 정체성, 실제 환경, 권한·승인·도구 ceiling, 프로젝트/사용자 지침의 출처와 우선순위, 현재 작업, 보존해야 할 실행 계약.
2. ModelBehavior: 모델별 행동 템플릿과 설명 variant. Claude legacy/lean을 독립적인 Azrael 호환 지침으로 유지한다. Claude Code의 앱 정체성이나 인증·과금 메타데이터는 이 층의 구성요소가 아니다.
3. ToolEnvironment: 해당 모델에 실제로 노출되는 도구 이름, 스키마와 결과, 활성 에이전트·스킬·MCP 안내. 존재하지 않는 도구를 권장하는 문자열을 넣지 않는다.
4. UserOverrides: 사용자 템플릿·추가 지침·허용되는 기존 도구 활성/비활성 설정. RuntimeCore의 실행 권한을 바꾸는 기능과 구분한다.

기존 상세 공통 지침에 모델별 지침을 계속 덧붙이면 legacy/lean의 길이 차이가 사라지므로, 공통 의미와 도구별 안내를 소유한 source에서 분리해 렌더링한다. 기존 사용자 언어·응답 선호·지속성·작업 보존 계약이 축소되지 않았는지 항목별 비교한다. 전역 설치 스킬/AGENTS 지침은 자동 삭제하거나 약화하지 않는다.

### 장기 유지보수: 정의와 연결 규칙의 분리

다음 구조는 장기 확장을 위한 추천 설계다. 커스텀 모델의 실제 기능 구현 범위를 이번 1차에 자동으로 추가하지 않으며, 프로필 resolver가 이 확장을 수용하도록 경계를 마련한다.

- PromptProfile: 모델 행동 템플릿·설명 길이·컨텍스트 표현을 소유한다. 공통 runtime·권한·출처와 사용자/프로젝트 지침은 독립 경계에서 합성한다.
- ToolProfile: 도구 묶음, 대체 그룹, schema/result formatter·wire 이름을 소유한다. tool execution backend·sandbox·approvals는 native runtime을 재사용한다.
- HarnessProfile: PromptProfile과 ToolProfile을 연결하는 재사용 가능한 환경 구성이다. 프롬프트만 수정해도 도구 구현이 복제되지 않는다.
- Provider/ModelBinding: 어느 프로필을 사용할지 선택한다. 프로필 정의와 새 모델 catalog 항목을 일대일로 결합하지 않는다.
- ModelVariant: 향후 커스텀 모델은 기존 provider/원격 모델과 prompt/harness profile을 조합한 로컬 선택 항목으로 표현하는 안을 추천한다. 가중치나 원격 모델 ID를 바꾸는 기능과 구분한다.

번들 기본 프로필과 사용자 정의/override의 저장 위치를 분리한다. 앱 업데이트가 사용자 수정을 덮어쓰지 않게 한다. 사용자 프로필의 extends는 명시된 필드만 교체하고 나머지는 원본을 상속한다. 번들 업데이트를 함께 받고 싶은 프로필은 상속하고, 동일 구성을 재현해야 하는 경우 profile revision을 pin하는 기능은 후속 확장으로 설계한다. 잘못된 상속·삭제된 부모·지원하지 않는 schema version은 명시적으로 실패한다.

provider별 실제 runtime ID, 정확한 remote model ID, logical variant ID, profile ID와 revision을 별도로 유지한다. 같은 원격 모델을 쓰는 여러 variant를 catalog 중복이라고 합치지 않는다. 원격 요청에는 실제 remote model ID를 보내고 선택 UI/history·diagnostics에는 variant와 실제 모델 identity를 구분해 기록한다. variant를 다른 provider로 rebind하더라도 tool eligibility는 새 실제 provider로 재검사한다.

### 설정 파일과 새 모델 상속

기존 config.toml의 layer loading/profile inheritance·스키마 검증·설정 갱신을 재사용한다. 아래 키는 제안 스키마이며 현재 제품에서 동작하는 설정이 아니다. 도구 묶음의 Anthropic 전용 제한은 이 설정보다 상위 runtime 규칙이다.

```toml
[harness]
default_profile = "azrael-default"

[harness.prompt_profiles.anthropic-team]
extends = "builtin/anthropic-default"
behavior_template_file = "harness/anthropic-team.md"

[harness.profiles.anthropic-team]
prompt_profile = "anthropic-team"
tool_profile = "builtin/claude-code-core"

[harness.providers.anthropic]
profile = "anthropic-team"

[harness.models."managed/anthropic/claude-opus-5-5"]
prompt_profile = "builtin/claude-lean"

[harness.prompt_profiles.review]
extends = "anthropic-team"
behavior_template_file = "harness/review.md"

[harness.variants.claude-review]
base_model = "managed/anthropic/claude-opus-5-5"
prompt_profile = "review"
```

variant 부분은 향후 기능의 제안 예시다. provider 프로필을 수정하면 그 provider 기본값을 참조하는 기존/신규 모델이 수정된 지침을 받는다. 정확 모델/variant override가 있는 필드는 유지되고 없는 필드는 계속 상속한다. 모델 최적화 프로필도 provider 기본 지침을 부모로 삼아 수정된 provider 공통 지침을 놓치지 않도록 한다. 템플릿의 교체·추가 의미는 schema에서 명시하고 암묵적 전체 복사를 피한다.

추천 해석 순서: 공통 기본 → 번들 provider 기본 → 사용자 provider 설정 → 검증된 family 특성의 희소한 기본값 → 정확 모델 override → 선택 variant override. family/모델 기본값은 사용자 provider override와 충돌하는 필드를 덮어쓰지 않는다. 사용자 의도를 우선하는 명시적 layer provenance를 함께 저장하며, 지정되지 않은 필드만 상속한다. 컨텍스트 데이터나 사용자 입력 메시지로 이 선택 순서를 바꾸지 않는다.

Anthropic의 번들 provider 기본은 Claude 호환 프로필이며 다른 provider의 기본은 기존 Azrael 프로필이다. 새 Anthropic 모델은 exact model 항목이 없어도 provider 기본을 받으므로 등록 누락으로 기존 OpenAI 도구 목록으로 돌아가지 않는다. 새 모델 자동 적용은 최적화·호환 수용을 증명하지 않는다. 실제 도구 지원이 없는 모델에는 schema를 강제하지 않고 명시적 capability 불일치를 알린다. 다른 provider의 Claude 모델이나 API wire protocol만 같은 모델은 Anthropic eligibility를 얻지 않는다.

미검증 모델의 존재만으로 사용자 지침이나 provider default를 무시하지 않는다. exact model 매핑은 필요한 예외와 검증된 최적화에 사용하고 모든 모델의 필수 등록 목록으로 만들지 않는다. 명시 설정 오류를 조용히 다른 profile로 대체하지 않는다.

프로필 상속 순환·중복·존재하지 않는 preset/도구·읽을 수 없는 템플릿·잘못된 스키마·다른 provider의 Claude 전용 도구 선택을 명시적 설정 오류로 처리한다. 모델별 수정은 형제 항목을 보존한다. 상대 템플릿 경로는 선언된 설정 파일의 위치를 기준으로 해석한다. 템플릿 변경도 fingerprint에 반영하고 읽기 권한·실패 조건을 유지한다.

### 유지보수와 업데이트 계약

프로필 schema version, 프로필 내용 revision, 도구 동작 계약 version을 구분한다. compatible template 수정과 도구 parser 의미 변경을 같은 종류의 업데이트로 처리하지 않는다. 실행 중 요청·background task는 기존 snapshot을 유지하고 다음 허용된 경계에서 새 profile을 적용한다. 구성의 revision/fingerprint는 요청, registry, 검색 캐시, budget, 결과 해석과 replay까지 함께 소비한다.

공유 execution runtime, profile catalog/resolver, context composer, provider transport adapter의 변경 책임을 분리한다. 프로필 catalog에는 검증된 capability·prompt variant·제외 그룹을 data로 둔다. 새 모델 때문에 helper, registry와 prompts에 각각 같은 이름 분기문을 추가하지 않는다. 특수 모델 동작이 필요하면 하나의 resolver와 해당 adapter 계약에 모으고 fixture를 함께 갱신한다.

검사는 provider 기본, 정확 모델 예외, 미등록 신규 모델, variant, 환경 capability의 조합을 대표하는 resolver contract tests와 실제 tool behavior tests로 나눈다. 모든 prompt를 복사한 snapshot이 아니라 출처·profile 선택·동등 역할 중복 제거·wire schema/result·호출 권한을 확인한다. 호환 fixture의 원본 version/OS/mode/config는 고정한다. 제안된 variant·pinning·설정 UI는 각 범위를 확정하기 전 current 구현으로 표시하지 않는다.

### Provider 전용 도구 격리

신규 호환 도구의 eligibility는 Anthropic adapter라는 이름이나 모델 이름이 아니라 엔진의 실제 inference provider ID로 결정한다. 기본 적용 대상은 현재 Anthropic provider이고 다른 provider는 실행 가능한 신규 도구를 받지 않는다.

registry 생성부터 모델 가시 목록, 검색 인덱스, ALL_TOOLS, code mode nested definitions, 캐시, 동적 발견 결과와 dispatcher까지 같은 eligibility를 사용한다. 목록에서만 숨기고 dispatcher는 열어두는 구현은 금지한다. MCP가 Read라는 이름을 사용하더라도 builtin과 외부 도구의 identity를 혼동하지 않는다.

Anthropic 기본 프로필은 신규 direct 도구를 최상위로 노출하며 동일 역할의 기존 exec_command/write_stdin/apply_patch 및 해당 중첩 코딩 도구·설명·발견 schema의 노출을 대체한다. 내부 실행 backend는 재사용한다. tool role/대체 그룹별로 native 또는 Claude-compatible 한 인터페이스 묶음을 선택하고 단순 이름 denylist를 중복 유지하지 않는다. Bash·PowerShell처럼 다른 shell 의미를 갖는 도구나 Edit·Write처럼 같은 묶음의 별도 기능은 계약상 구분한다. 현재 응답이 실행 가능한 도구 목록과 도구 안내·검색 결과가 같은 선택을 사용해야 한다. 과거 완료 기록을 지우는 것으로 컨텍스트를 줄이지 않으며 과거 검색에 포함된 제거된 schema는 기존 history projection에서 현재 규칙에 맞게 축약한다. Azrael 고유 협업·root resume·work completion·컴퓨터/윈도 도구와 사용자가 연결한 MCP는 기존 권한/기능 설정에 따라 보존하고 별도 명확한 이름으로 노출한다. 다른 provider의 기존 도구 목록을 이 작업 때문에 삭제·교체하지 않는다.

### 도구 호환 계약

| 도구 | 1차 계약 | 재사용과 추가 작업 |
| --- | --- | --- |
| Read | 절대 파일 경로, offset/limit, 번호+tab 텍스트, 빈/누락/디렉터리 오류, 결과 수락 후 읽기 상태 기록 | ExecutorFileSystem의 환경·sandbox 접근, 제한/취소. 매체별 지원은 별도 상태 |
| Edit | file_path/old_string/new_string/replace_all, 이전 Read 필요, unique exact match, 읽은 후 변경된 파일 거부, 편집 결과와 diff | 네이티브 patch 승인·UI diff·파일 쓰기 경계, 파일 revision 추적 추가 |
| Write | 새 파일 작성, 기존 파일 덮어쓰기는 이전 Read 필요, 내용 보존과 결과/diff | 네이티브 write/patch 경계, 파일 revision·승인 후 재검사 |
| Grep | pattern/path/glob/type/output mode/context/head limit의 지원 계약과 순서·truncation | rg 또는 검증된 라이브러리, 실제 OS 실행·ignore·encoding 옵션 대조 |
| Glob | pattern/path, ignore·숨김 파일·정렬·출력 제한을 기준 fixture와 대조 | codex-file-search/ignore와 executor 파일 시스템을 조사 후 재사용 |
| Bash | Bash 문법·cwd 지속·환경 비지속·foreground timeout·background ID/출력/종료 이벤트 | unified_exec/process manager와 실제 Bash backend. PowerShell은 별도 도구 identity |
| Agent | prompt/type/model/effort/foreground-background 등 지원 필드, 독립/fork 입력, 결과 통지·취소 | multi-agent V2, child provider별 새 프로필, 역할/도구 ceiling 재사용 |
| SendMessage/ListAgents/TaskStop | 전달 대상, 재개·취소 의미와 결과, 기존 협업 기능 보존 | V2 메시지·목록·중단 handler. 동일 이름이 다른 lifetime을 뜻하지 않도록 계약 대조 |
| Skill | 이름/args, 선택된 본문만 주입, plugin/scoped identity와 실패 | 기존 skill discovery/extension. 실행·fork/frontmatter 차이는 지원표로 구분 |
| ToolSearch/MCP resources | 이름 충돌 없는 발견, 발견된 schema의 다음 요청 활성화, provider별 catalog | 기존 MCP/ToolSearch, protocol tool_reference 가능 여부는 wire adapter 경계 |
| AskUserQuestion | 질문/선택지/자유입력·pending 응답·취소 처리 | 기존 user-input bridge. settings UI 후속과 질문 UI 재사용은 별개 |

Claude Code 설명은 실제 제공 기능에 맞게 작성한다. core 텍스트 도구 완료를 전체 Claude Code API/플러그인/매체 지원 완료로 보고하지 않는다. 웹 검색·fetch는 기존 연결 backend의 실제 가용성을 따르며 새 외부 검색 서비스를 자동 도입하지 않는다.

읽기 상태는 파일 경로 문자열만으로 판단하지 않는다. 환경과 canonical path, 읽은 파일 revision/content fingerprint, 읽기 수락 시점과 tool result를 연결한다. 같은 파일의 aliases·symlink·대소문자·동시 수정·권한 대기 뒤 변경을 검증한다. 선형 변경을 검증하고 승인된 diff와 실행되는 내용이 달라지지 않도록 네이티브 쓰기 경계를 사용한다. 부분 Read와 성공한 Edit/Write 뒤 읽기 상태 갱신은 기준 동작을 실제 실험으로 확정한다.

### 컨텍스트·이름·결과 투영

호환 프로필의 wire 이름은 Read/Edit 등 실제 호환 이름이다. 내부 identity와 실행 handler는 안정적인 고유 ID로 유지한다. 현재 hash alias 정책을 profile-owned wire map으로 확장하고 신규 호환 builtin만 예약 이름을 받는다. 기존 provider의 hash 정책은 유지한다. MCP 충돌 이름은 deterministic prefix로 분리한다.

Anthropic 호환 프로필은 system/runtime guidance, 사용자/프로젝트 지침, 환경·에이전트·스킬 reminder의 배치를 기준 fixture에 맞게 조립한다. native developer 지침을 단순히 user reminder로 내려 권한이 바뀌지 않도록 출처와 필수 의미를 보존한다. XML CDATA 정책과 호환 reminder 정책은 명시적 독립 선택으로 두고 중복 래핑하지 않는다. 이 선택이 instruction authority를 만든다고 해석하지 않는다.

전용 파일 결과는 Claude-like 번호 텍스트이고 shell 결과는 출력·종료 코드·background 참조로 정규화한다. 외부 provider 결과 formatter는 기존 formatter를 유지한다. function_call/tool_result ID, 오류 표시, 이미지 block 순서와 공개 기록이 유지돼야 한다. 도구 description에 정의한 인자와 wire schema와 실제 parser가 동일해야 한다.

### 모델·프로필 전환과 기록

- 설정 파일 갱신은 다음 허용된 설정 활성화 경계에서 적용하며 이미 sampling/실행 중인 요청은 캡처한 프로필과 ToolRouter를 유지한다.
- 실행 중 명시적 모델 변경이나 기존 복구 정책의 모델 변경이 새 step을 만들면 그 step의 provider/model로 프로필을 다시 resolve한다. 응답 call은 원래 요청의 registry와 profile로 해석하며 새 도구로 잘못 실행하지 않는다.
- 과거 완료 call/result는 공개 기록으로 보존한다. 과거 identity를 기록에 표현하는 것과 현재 도구를 등록·호출 허용하는 것을 분리한다. 다른 provider로 전환했을 때 과거 도구를 검색/호출 가능한 도구로 되살리지 않는다.
- provider/model/account/thread/turn 외에 profile revision/semantic fingerprint와 wire mapping 호환성을 private replay 조건에 포함한다. 부적합 private replay는 기존 공개 history/handoff 경로로 넘기고 stale signed thinking을 그대로 변형·재사용하지 않는다.
- resume/fork/compaction은 공개 작업 내용과 사용자의 명시 설정을 보존한다. 기존 도구 호출/결과 ID와 의미를 임의로 재작성하지 않는다.
- child는 parent의 설정 규칙을 상속하되 자신의 provider/model로 resolve한다. Anthropic child만 신규 도구를 받는다. background 실행은 원래 environment/권한·프로필 lifetime을 유지한다.
- 압축, 토큰/입력 예산, startup prewarm, provider handoff, diagnostics도 실제 선택 프로필의 텍스트와 schema를 소비한다. compose 경로 하나만 고쳐 요청·예산·warmup이 서로 다른 지침을 쓰지 않게 한다.

## 플랫폼 적용과 보존

요청 대상은 제품의 로컬 Windows x64, glibc Linux x64, Apple Silicon macOS다. 프로필 schema·선택·격리·역할·기록·컨텍스트 구성은 공통 요구이고, Bash/PowerShell, 경로·encoding·파일 revision·프로세스 종료는 공통 의미와 OS 구현이 섞인 요구다. Remote SSH/컨테이너 등 기존 별도 대상은 이 작업으로 지원을 확대했다고 보고하지 않는다.

이번 조사는 Windows 소스와 이전 Windows loopback 실험이다. 이 기능의 Linux/macOS 실행·설치 수용은 미검증이다. 기존 제품의 플랫폼 지원 범위는 docs/architecture/multi-platform.md와 해당 운영 evidence를 따른다.

보존 기준:

- 비-Anthropic의 기존 도구 집합·컨텍스트 의미·hash 이름과 호출 결과.
- 공통 권한/승인/Guardian, hooks, 플랫폼별 sandbox와 executor 경계.
- 계정·quota 복구, 제공자 전환, public/private history 분리, call/result 연결.
- 혼합 모델·역할·root resume/work completion·background 생명주기.
- 저장된 사용자 지침·AGENTS·스킬·MCP·컴퓨터/윈도 기능의 기존 적용 범위.
- 기존 설정 layer/profile 동작과 모델별 항목·형제 설정.

## 구현 순서와 소유권

| 단계 | 선행 조건 | 변경 소유자와 산출물 | 후속 사용·완료 조건 |
| --- | --- | --- | --- |
| 1. 계약/기준 고정 | 범위·provider 격리 확정, 환경 선택 검토 | root: 설계 owner·호환 matrix·정규화 fixture·지원 상태·필수 검사 | 프로필 schema/도구 구현의 공통 계약 고정 |
| 2. profile resolver | 1 | config crate + core config + prompts + ResolvedStepSettings: 검증된 설정/모델 선택/profile fingerprint | 요청 조립과 tool plan이 동일 snapshot 사용 |
| 3. 핵심 도구 | 1, 필요한 config 계약 | tools handlers/runtimes + executor 경계: 파일/검색/shell/협업/skill/input adapters | 실제 parser/result/state/approval 단위 검증 |
| 4. 요청/검색/기록 통합 | 2와 각 준비된 3 | managed_runtime/native protocol + inference-mapping/inference + tool registry/search/code mode | Anthropic 명시 이름·컨텍스트, 다른 provider 완전 비노출, replay/handoff 검증 |
| 5. native·platform 수용 | 4의 입력 고정 | 정확한 engine/helper/package와 platform별 검증 evidence | Windows 회귀 + 대상 Unix shell/fs 검증 + 실제 Anthropic 모델 coding smoke |
| 6. 문서/보존/정리 | 해당 구현·필수 검사 통과 | architecture·ops·feature inventory·계획·필요한 instruction installed copies | 동작 검증과 기존 기능 보존 각각 확인 |

계획 검토 단계에서는 위 코드 단계들을 실행하지 않는다. 구현이 허용되면 긴 Rust 빌드 전에 resolver/parser/helper 검사로 재실행 가능성이 높은 오류를 줄인다. 독립적인 adapter 구현과 config 작업은 공유 계약을 고정한 뒤 분리할 수 있다. 동일 cache의 무거운 빌드를 중복 실행하지 않는다. frozen build input, exact package provenance, 필수 acceptance와 산출물 정리는 build playbook을 따른다.

설계 owner 제안은 docs/architecture/model-harness-profiles.md의 독립 프로필 계약과 기존 managed-providers/context-policy/instructions 문서의 연결이다. 새 문서는 소유권상 필요한 계약이 확정될 때 생성하며 계획만으로 기존 current 계약을 교체하지 않는다. docs/architecture/README.md와 maps/README.md에서 라우팅한다. scripts/azrael-feature-contracts.json에 engine.model-harness-profiles, engine.anthropic-compatible-tools, engine.harness-provider-isolation 등의 안정 ID와 실제 owner·필수 executable check를 등록한다. 기존 engine.managed-tool-identities와 engine.provider-context 검사는 보존한다.

## 성공 기준과 검증

1. Provider별 기본값: 동일 모델 표시명이라도 provider ID에 따라 Anthropic만 새 도구를 받는다. engine registry, native helper wire, 검색, code mode, child, resume, fallback 경로에서 검사한다.
2. 양방향 비노출/비실행: 다른 provider의 top-level/nested/search/discovered schema에 신규 도구 이름·설명이 없으며 hallucinated 신규 call도 거부한다. Anthropic에는 동일 역할의 기존 native/OpenAI 도구 schema·설명·실행 안내가 없다. 역할 대체 그룹의 현재 catalog와 history schema projection을 검사하고, 과거 history가 현재 권한을 부여하지 않는 회귀를 포함한다.
3. 모델별 프로필: provider/global/exact model의 필드별 우선순위, 미등록 새 Anthropic 모델의 provider 상속, 수정된 provider 지침의 전파와 명시 override 보존, custom template, 상속/오류/형제 보존, legacy/lean 선택과 metadata 불확실성을 확인한다. 향후 variant는 실제 remote model/provider와 logical identity의 분리·도구 eligibility를 검증한다.
4. 요청 일관성: base/context/catalog/result/예산/warmup이 같은 profile fingerprint를 사용한다. 설정 변경·모델 변경·계정 복구 중 들어온 응답도 originating registry로 처리한다.
5. 파일 의미: offset/limit·번호·큰 파일/empty/missing/encoding, 미독 Edit/Write, unique/replace_all, stale revision, CRLF/LF·Unicode·symlink·별칭·권한 거부·승인 뒤 변경·취소를 실제 fixture에서 확인한다.
6. 검색/shell: ignore/glob/context/truncation/exitcode, shell cwd persistence/env nonpersistence, frontend timeout/background 종료·취소·재개·세션 복구·실제 OS 경로를 확인한다. synthetic 종료 이벤트와 실제 process 실행 수용을 구분한다.
7. 에이전트/스킬/MCP/질문: 신규 direct interfaces의 지원 schema와 실제 동작, 다른 provider child 비노출, 지연 schema의 다음 요청 활성화, 질문 pending/취소, 불필요한 skill 본문 비주입을 확인한다.
8. 요청 호환 fixture: 같은 OS·버전·모드·작업·설정의 Claude Code 기준과 Azrael payload를 의미별로 대조한다. 앱 identity·필수 runtime contract 차이는 명시하고 Read/Edit/Bash와 역할·schema·result 차이를 분류한다. snapshot 문자열만 같다고 동작 통과로 보지 않는다.
9. 실제 coding smoke: 사용자가 허용한 실제 Anthropic 모델에서 검색→읽기→편집→테스트→완료와 중단/재개를 수행한다. Sonnet/Opus 계열 각각의 실제 가용 모델을 고정한다. 계획 검토는 실서버 호출 권한으로 해석하지 않는다.
10. 보존 회귀: 비-Anthropic 도구/프롬프트, provider switching/replay/compaction, approvals/hooks, 계정 복구·협업·질문·MCP가 기존 계약을 유지한다. 변경 owner의 기존 source/engine/native tests를 재사용하고 구체적인 공백만 추가한다.
11. 패키지/플랫폼: exact binary/helper/config fixture/provenance와 실제 설치본의 프로필 적용을 확인한다. Windows 통과를 Unix 통과로 보고하지 않는다. settings UI는 후속이라 새 화면 검사는 이번 완료 조건에 넣지 않는다.

## 현재 검토 결과와 남은 한계

아키텍처상 구현 경계는 존재한다. 단순 프롬프트 교체나 도구 이름 alias만으로는 요구가 충족되지 않는다. resolver + native compatible handlers + wire/context/result projection + provider isolation + history/replay가 하나의 일관된 작업이다.

제품 코드와 provider 변환·네이티브 어댑터 구현은 primary checkout에 반영됐다. 이전 세션의 설정 테스트 7개, provider 요청 검사, 지침 원본·내장 사본 검사 통과 근거를 보존한다. `artifacts/logs/AF-01/native-03-compile.log`에는 통합 컴파일 오류가 있어 패키지나 설치 완료 근거로 사용할 수 없다. 해당 연결부를 수정하고 고정 입력으로 Windows 검증·빌드·설치를 이어간다. 실제 Anthropic 모델 요청과 Linux/macOS 수용은 미검증이며 별도로 남긴다.

## 구현 배정과 기록

시작: 2026-10-13T12:05:51 (Windows 호스트). primary checkout에서 기존 변경을 보존한다.

- profile_config: config schema·상속·resolver, root가 요청 snapshot 소비.
- claude_files: Read/Edit/Write 및 정확한 사전 내용 확인을 위한 native patch 확장.
- claude_shell_search: Bash/jobs/Grep/Glob 및 native shell 선택 경계.
- claude_controls: Agent/Skill/ToolSearch/AskUserQuestion native adapters.
- provider_projection: Anthropic wire 이름·컨텍스트·private replay.
- root: registry 양방향 격리, request/budget/history 통합, 문서·전체 변경 통합·필수 검증·커밋.

무거운 Cargo 검사는 root가 공유 target 캐시에서 직렬 실행한다. provider fixture 검사는 독립 실행한다. 기존 dirty baseline은 artifacts/logs/AF-01/baseline에 보존하며 작업 종료 시 변경 분리 뒤 정리한다.

## 재개 실행

원본 세션: `azrael://threads/01a12dd6-9c7e-78a3-8dd1-912b8b10809a`. 마지막 승인: 전체 누적 변경을 반영한 Windows 빌드 및 사용자 프로필 설치. 현재 앱 버전을 유지하며 이후 들어오는 변경을 따라 고정 입력을 갱신하지 않는다.

선행 조건: native-03에서 확인된 중복 필드·반환 타입·borrow·PartialEq·test-only registry getter 오류 수정, engine 출처 receipt와 신규 파일 추적 확인, 전체 프로젝트 소스·외부 빌드 입력 고정. root는 통합 수정·고정 입력·Windows 전체 빌드·6단계 exact-package acceptance·설치·정리를 소유한다. read-only `build_provenance`는 원본 import baseline/receipt 및 freeze 경로를 확인하고, `harness_checks`는 별도 로그에서 provider 검사와 native test 필터를 확인한다. 이 두 작업은 Cargo 캐시를 점유하지 않는다.

다른 세션의 `root_resume` Cargo 검사가 primary `engine/codex-rs/target`을 사용한 동안 출처·패키징 준비와 독립 helper 검사를 먼저 진행했다. 해당 Cargo 프로세스 종료 확인 뒤 같은 캐시에서 root 검사를 시작했다. 원본 검사에서 발견된 연결부 수정은 제품 계약을 바꾸지 않으며 수정 후 새 고정 입력 식별값으로 검증한다.

재개 검증 입력: `artifacts/n14a/engine`, 9,222개 파일, 입력 SHA-256 `f14afef9e3984b27ea451890fba80bb92d6c9a879738d8ec9e48128b6a703811`. 이는 연결부 컴파일 오류 확인용 입력이며 이후 보강된 테스트와 출처 tooling은 최종 빌드 입력에 포함한다. 공유 캐시의 앞선 Cargo 작업이 종료된 뒤 `cargo check -p codex-core --lib --locked --offline`, `CARGO_BUILD_JOBS=1`, `RUST_MIN_STACK=33554432`로 실행해 실제 종료 코드 0으로 통과했다(11m 28s). 로그·결과: `artifacts/logs/AF-01-resume-native/n14a-check.log`, `n14a-check-result.json`. 최종 패키지 또는 native test 통과와는 구분한다.

Helper: `node --test providers/opencodex/tests/harness-mapping.test.mjs` 2/2, pinned Bun 1.4.2 `test tests/harness-projection.test.ts` 6/6(56 assertions), 실제 종료 코드 각각 0. 로그 `artifacts/logs/AF-01-resume-helper/`. 성공한 Read 수락 후 Edit/Write 및 승인 대기 중 외부 변경 거부의 native 테스트 3개를 기존 fixture에 추가했고, 파일 포맷·diff 검사는 종료 0이다. native 실행은 최종 고정 입력에서 확인한다.

빌드 준비 수정: 기존 feature manifest의 cargo 직접 실행은 검사 실행기의 node/python 계약과 충돌했다. `scripts/check-model-harness-profiles.cjs`에서 정확한 frozen engine과 locked/offline 옵션을 사용하도록 연결했고, 기존 core Claude 어댑터 검사에 양방향 provider 격리 검사도 연결했다. wrapper 문법·manifest 유효성 검사 종료 0. 엔진 `session.rs`/`world_state.rs` 줄바꿈은 HEAD 형식을 유지해 의미 없는 전체 파일 변경을 제거했다. 제품 정책 변경은 없다.

신규 `0064_root_resume_reasoning_settings.sql`은 전체 변경 설치 요청에 포함된다. 기존 SQL 바이트 변경 금지를 유지하면서 명시적 `--expected-migration-path`와 immutable addition descriptor를 가진 receipt schema4로 새 마이그레이션만 기록하도록 tooling을 보강했다. 직접 SQL ordinary path 허용·기존 migration checksum 변경·feature 제외로 우회하지 않는다. 집중 테스트 28개, recorder/importer/provenance 통합 검사 107개(Windows의 POSIX 전용 4개 skip)가 실제 종료 0이다. 로그 `artifacts/logs/AF-01-resume-provenance/`. `engine/.gitattributes`에 0064만 LF로 고정하는 규칙을 추가했다.

출처 원본 baseline은 `artifacts/source-snapshots/win06-integrated-r2`, raw receipt SHA-256 `12a1dbfc1725df7d4e87de4e336e0b8dab217aecbe7d26b624d1e264356b00b6`이며 canonical original hash는 `028f02a89b108c40b56c857f13ddc481608be2508336b0941318c2c3d5271c21`이다. pre-AF baseline은 이미 localIntegration이 있으므로 original import로 쓰지 않는다. 첫 기록 시도는 distribution overlay인 queue_migrations/.gitattributes를 ordinary 목록에 잘못 포함해 종료 1로 거부됐으며 SOURCE는 변경되지 않았다. Git dirty 여부뿐 아니라 전체 receipt inventory의 실제 바이트와 허용되는 추가 파일을 기준으로 정확한 변경 목록을 다시 확인한다.

현재 소스 준비 경로는 `artifacts/w14d`다. `w14a`의 외부 입력은 실제 성공 signal과 source/destination inventory 동일성 검사로 준비 완료했다(work ID `43f64695-bfbe-4a41-8a02-c263a8265661`). 이 입력을 새 사본에 복사하고 다시 동일성을 확인한다. code-mode host SHA-256 `ec91f7a04dcb1a36f0e2ed87885777bf78900c2ea3295e82621c5721fd5d9f41`, 원 출처 `artifacts/w13a/artifacts/external/codex-code-mode-host.exe`이며 source build가 아닌 external import다. UI 26.1007.21434, Computer Use runtime/plugin, Bun 1.4.2도 같은 입력이다. config/editor settings/extension registry의 설치 전 hash와 공식 확장 파일 지문을 로그 owner에 저장했으며 credential 본문은 기록하지 않았다. 현재 설치와 직전 롤백본은 보호한다.

준비 과정: r2 출처 기록은 다른 세션의 새 ordinary 변경으로 exact delta가 달라 종료 1이었다. SOURCE는 변경되지 않았다. w14b/w14c의 기존 freeze는 각각 exec의 event processor 테스트, app-server thread protocol의 동시 편집을 포착해 종료 1로 중단했으며 빌드는 시작하지 않았다. w14c 기간은 05:28:32.302–05:31:37.034 UTC, 184.719초다. 전체 주 체크아웃을 복사 뒤 다시 읽는 방식 대신 task artifact `capture-selected-project.cjs`에서 같은 읽기 stream으로 해시와 사본을 생성하도록 준비했다. 파일 자체의 읽기 전후 크기·시간·정체성, 경계와 링크를 검사한다. 파일을 선택한 뒤의 주 체크아웃 수정은 다음 빌드에 속한다. 이 선택은 각 파일을 읽은 구간의 입력이며 원자적인 전역 시점이라고 주장하지 않는다. fixture의 stream/copy/aggregate 일치, 읽기 중 변경 거부, 후속 편집 제외, tracked/untracked nested repository, junction 거부 검사는 실제 종료 0이다. 처음 적용 시 untracked upstream을 Gitlink로 제한한 오류를 수정했고, 소스 파일 0개였던 w14d metadata를 e 실행에서 재사용했다. 실패 ready/log는 덮어쓰지 않았다.

e 전체 캡처: 2026-10-13 05:51:15.183–05:57:55.920 UTC, 400.736초, 실제 종료 0. 24,171개 파일 / 457,745,865바이트, 선택 stream과 안정 사본의 프로젝트 지문 `459d47f3a94552ef984e81ab49d0e05258fbee2e70eb23ff286750029556206a`가 정확히 일치했다. 안정 사본의 전체 inventory 조사에서 ordinary179/adapted0, 신규 파일18개와 SQL additions2개를 확인했다. 추가 `thread_history_migrations/0011_turn_attribution.sql`은 baseline 최대10보다 큰11, 100644 regular/LF 112바이트이며 parent_turn_id/turn_trigger nullable TEXT 열만 추가한다. 원래의 전체 누적 변경 빌드 권한 안에서 0064와 함께 explicit migration path로 기록하도록 root가 결정했다. 기존 SQL 불변 검사는 유지한다. 현재 SOURCE 기록 및 최종 엔진/프로젝트 지문은 담당자가 확인 중이며 ready 전까지 제품 빌드 완료로 취급하지 않는다.

현재 실행 producer: `artifacts/logs/AF-01-resume-install/run-windows-r6.ps1`, work ID `d8176d81-0a17-47f3-aad3-41c7f7b3ba7a`. e-ready의 실제 성공 뒤 외부 입력 확인 → 엔진 지문 대조 → extension lockfile 의존성 준비 → API skill dedup native 검사 → `deploy-azrael.ps1 -FullRegression -VerifyAccountControls -SkipCodexEnvironmentSnapshot` 순서다. 앱 버전은 2026.0.6, 준비 소스는 w14d, 산출물은 그 아래 `artifacts/releases/w14e`와 `artifacts/deployments/deploy-w14e/package`, 실행 로그는 그 아래 `artifacts/logs/deploy-w14e`다. Windows x64 검증이며 Linux/macOS와 실제 Anthropic provider는 미검증이다. 원격 게시나 사용 중인 창 종료/reload를 수행하지 않는다. runner 성공 후에도 root의 설치 바이트 확인·보존·정리·작업 커밋이 남는다. AF 커밋은 캡처한 AF 변경만 별도 임시 index/patch로 준비하며 root-resume/turn attribution/API projection 등 다른 작업을 포함하지 않는다.

정리 제약: 작은 capture fixture의 junction은 제거됐지만 숨김 `.git`에 대한 ordinary PowerShell 삭제가 거부됐다. 강제 옵션/다른 shell·API 우회 없이 소형 잔여물과 사유를 `selected-source-d-cleanup.json`에 보존한다. 이 경로는 빌드 선택 입력과 사용자 데이터 밖이다. 다른 실패 사본과 검증 fixture는 보호 참조와 실제 삭제 가능 여부를 확인한 뒤 정리한다.

현재 예측은 남은 소스 고정·전체 빌드·패키지 검증에 수십 분 이상이다. 종료 시각은 보장하지 않는다. 최초 확인 경계는 producer 시작 후 30분 또는 실제 종료 event이며, 진행 중 소스와 패키징 입력을 바꾸거나 동일 빌드를 중복 실행하지 않는다.
