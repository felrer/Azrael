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

e 전체 캡처: 2026-10-13 05:51:15.183–05:57:55.920 UTC, 400.736초, 실제 종료 0. 24,171개 파일 / 457,745,865바이트, 선택 stream과 안정 사본의 프로젝트 지문 `459d47f3a94552ef984e81ab49d0e05258fbee2e70eb23ff286750029556206a`가 정확히 일치했다. 안정 사본의 전체 inventory 조사에서 ordinary179/adapted0, 신규 파일18개와 SQL additions2개를 확인했다. 추가 `thread_history_migrations/0011_turn_attribution.sql`은 baseline 최대10보다 큰11, 100644 regular/LF 112바이트이며 parent_turn_id/turn_trigger nullable TEXT 열만 추가한다. 원래의 전체 누적 변경 빌드 권한 안에서 0064와 함께 explicit migration path로 기록하도록 root가 결정했다. 기존 SQL 불변 검사는 유지한다. SOURCE 기록은 06:14:14.094–06:23:22.993 UTC, 548.766초, 종료 0으로 완료됐다. 최종 엔진/프로젝트 지문과 전체 선택 경로 비교도 종료 0이며 SOURCE.json 하나만 변경됐다. e-ready는 06:25:24.323 UTC에 성공 발행됐다. 엔진 9,224파일 SHA-256 `4275c594591cf473e373e335448a3573f1fdb5b39fb39847ab65fc3df8186443`, 프로젝트 SHA-256 `34ed00591f28116766f6288d01c89473067ccab129a3bcd8f9b1d4057f42c159`다. 이 준비 통과는 제품 빌드·설치 통과와 구분한다.

r6는 05:51:25.421–06:21:26.316 UTC에 소스 준비 대기 30분 제한으로 종료 1이었다. 실행 stage는 0개여서 native 빌드는 시작하지 않았다. 같은 성공 사본을 재사용하는 현재 producer는 `artifacts/logs/AF-01-resume-install/run-windows-r7.ps1`, work ID `214732f7-051f-45fa-a4af-d1564931faf0`, PID34428다. 대기 제한을 60분으로 조정했고 입력 재생성이나 중복 빌드를 하지 않았다. e-ready의 실제 성공 뒤 외부 입력 확인 → 엔진 지문 대조 → extension lockfile 의존성 준비 → API skill dedup native 검사 → `deploy-azrael.ps1 -FullRegression -VerifyAccountControls -SkipCodexEnvironmentSnapshot` 순서다. 앱 버전은 2026.0.6, 준비 소스는 w14d, 산출물은 그 아래 `artifacts/releases/w14e`와 `artifacts/deployments/deploy-w14e/package`, 실행 로그는 그 아래 `artifacts/logs/deploy-w14e`다. Windows x64 검증이며 Linux/macOS와 실제 Anthropic provider는 미검증이다. 원격 게시나 사용 중인 창 종료/reload를 수행하지 않는다. runner 성공 후에도 root의 설치 바이트 확인·보존·정리·작업 커밋이 남는다. 커밋 검토에서 현재 HEAD `09bb4b35479ce5838132c5094bbfc773f522d9a5`에 AF 제품 동작·native 3개 보강 검사·manifest·출처 tooling이 이미 포함됨을 확인했다. 별도 AF 제품 커밋은 중복 생성하지 않는다. 최신 HEAD의 다른 작업을 보존하며 작업 기록과 실제 설치 결과만 최종 검증 후 검토한다. 준비된 AF-only.patch는 포맷만 다루므로 이번 설치에 적용하지 않는다.

정리 제약: 작은 capture fixture의 junction은 제거됐지만 숨김 `.git`에 대한 ordinary PowerShell 삭제가 거부됐다. 강제 옵션/다른 shell·API 우회 없이 소형 잔여물과 사유를 `selected-source-d-cleanup.json`에 보존한다. 이 경로는 빌드 선택 입력과 사용자 데이터 밖이다. 다른 실패 사본과 검증 fixture는 보호 참조와 실제 삭제 가능 여부를 확인한 뒤 정리한다.

현재 예측은 남은 소스 고정·전체 빌드·패키지 검증에 수십 분 이상이다. 종료 시각은 보장하지 않는다. 최초 확인 경계는 producer 시작 후 30분 또는 실제 종료 event이며, 진행 중 소스와 패키징 입력을 바꾸거나 동일 빌드를 중복 실행하지 않는다.

30분 확인(2026-10-13 06:57–06:58 UTC): r7 producer PID34428 실행 중. 외부 입력 동일성, frozen engine snapshot, npm ci는 모두 실제 종료 0이다. API skill dedup native 검사는 06:40:38 UTC 시작 후 Cargo37728 아래 rustc59360에서 codex_protocol 컴파일 중임을 확인했다. 다른 Cargo 검사도 공유 캐시에 대기하지만 중복 빌드나 입력 변경은 하지 않는다. 아직 native 검사·전체 빌드·설치 통과 근거는 없다. 다음 확인은 30분 또는 실제 종료 event다.

다음 확인(2026-10-13 07:29–07:30 UTC): API skill dedup native 8/8 통과, 실제 종료0, 검사 기간 06:40:38.073–07:11:29.430 UTC(1851.357초). deploy stage는 07:11:29.467 UTC 시작했다. deploy48000 아래 source regression node59196와 build21668이 실행 중이다. 외부 입력·snapshot·npm 준비 결과는 재사용한다. native stdout/stderr와 r7 metrics에 근거를 보존했다. 패키지·설치 결과는 아직 없으며 다음 확인은30분 또는 실제 종료 event다.

r7 실제 종료1: source regression 종료1로 deploy가 동시 build를 종료(exit-1,terminated=true)했다. 배포 시작07:11:31.551 UTC, 경과1661.610초. 설치 단계는 시작하지 않았다. source101파일 중 unique 원인은 vendor reviewed mapping 불일치, legacy UI26.928.31416 누락, extension interaction script 추출오류, 지침 review package 누락이다. vendor delta는 adapters/anthropic.ts 한 파일(기존 commit14da708b의 empty initial arguments 보존/실패분류)이며 다른1135 파일은 기존descriptor와 동일하다. manifest/guard/UPSTREAM 지문을 갱신했고 원래 Windows 정렬 알고리즘이 기존1b0919…를 재현함도 확인했다. vendor guard 검사11통과/1플랫폼skip 종료0, extension build 및 autoAccountSwitch4/4 종료0. Anthropic empty-arguments 집중fixture는 명시적 ./파일 경로로1개통과 종료0이다(첫 Bun 호출은 suffix filter로 이전artifact 사본까지 수집해17module오류; 수정호출결과만 집중검사 근거로 사용).

고정입력 자체의 검증오류 수정이므로 w14d를 수정하지 않고 파생 w14f / 새산출물w14g로 준비한다. four correction files는 artifacts/logs/AF-01-resume-install/r8-corrections.json SHA와 사본으로 고정했다. selected-source-e-project-snapshot의24171 경로를 그대로 복사하고 이4개만 대체하며 기존 엔진/SOURCE identity4275c594…는 동일하게 유지한다. main의 후속 변경은 포함하지 않는다. legacy UI4파일·review package3파일·기존검증엔진참조는 별도 ignored test input으로 검증해 준비한다. 준비 담당 migration_provenance는 no cargo/npm로 복사/지문 검증만 진행하고 root는 실행기를 준비한다.

r8 producer 준비: `run-windows-r8.ps1`, work ID `dcc46b88-4930-42e6-923e-ba3be1a5093a`, PID55120. 파생ready f 실제성공 후 외부입력동일성/엔진snapshot/npmci, 고정된지침소스의 로컬review 생성, extension10개 및 source guard/session/instruction 집중선행검사를 실행하고 FullRegression deploy를 시작한다. 기존review component metadata가 frozen 구성과 달라 재사용을 포기했으며 새source의 build-instruction-release로 테스트fixture만 생성한다. 기존검증w13e 엔진은 instruction validation fixture용으로 hash 고정하며 final engine 출처와 구분한다. API dedup8개는 엔진SHA동일성과 기존exit0를실행기에서확인후재사용한다. legacy UI4파일 pin+사본identity검사는 종료0이며 main의뒤늦은수정을포함하지않는다. 새산출물w14g, 입력w14f, 첫확인은producer30분 또는 실제실패/완료event다.

사용자 추가검토 요청: 이전세션의 원래 user messages를 rollout에서 다시 읽고 original-user-requests.json에 보존했다. 목표는 provider/model별 프롬프트·도구 설정파일, 실제Anthropic의 Claude호환 기본도구, 타provider격리+동일역할 native비노출, 신규Anthropic 모델자동상속, 기존권한/훅/역사보존, 누적변경Windows빌드·사용자프로필설치다. 설정UI와Notebook/Cron/Worktree/Plan, 실제커스텀variant 선택UI는 후속 합의범위다. 현재 구현과일부검증은있지만 전체회귀/패키지/설치는 미달성이다. 실제Anthropic coding smoke도 미검증이다. build_provenance가 고정소스의 requirement→symbols/tests와 구체적gap을 read-only 검토하며 root는 빌드를계속진행한다. test 파일은HEAD의CRLF형식을보존했고 core.whitespace=cr-at-eol diffcheck종료0; 새고정4파일바이트는변경하지않았다.

f-ready 실제성공08:16:22.281 UTC: 파생준비07:56:43.677–08:16:22.281,1178.598초, 종료0. stream/metadata/aggregate792.157초, engine provenance336.671초, project snapshot15.617초. 선택24171경로 중 승인4파일만 변경, 나머지descriptor와엔진provenance전체 e와동일이다. 최종 프로젝트SHA `a7da645e8edbbd4a791e9db570e48a1a8e29aef04cd6e9986d0d2719710855a8`, 엔진SHA `4275c594591cf473e373e335448a3573f1fdb5b39fb39847ab65fc3df8186443` /9224파일. 이후소스동결. r8 producer는이ready를소비해외부입력과집중fixture검증으로이어가며 준비완료를설치통과로해석하지않는다.

목표감사 결과: actual provider기반 resolver/provider→model sparse override/미래Anthropic상속/prompt template와built-in tool IDs는구현됐다. registry는discovery전교체하며 nativebackend feature/permission gate를유지한다. coding6개양방향격리통합test와 controladapter 개별tests는있지만 full10개default도구의통합노출·실행통과를현재근거로주장하지않는다. prompt runtime contract·custom instructions와durableprofilefingerprint/scopedprivate replay도연결돼있다. 최종native/패키지host/설치와실제Anthropiccoding스모크는남아있으므로목표는아직미달성이다. Read media/설정UI/NotebookCronWorktreePlan/variant선택은합의된후속이다. 상세requirement/status/limits는 goal-audit-code.json에보존했다.

r8는08:31:07.223 UTC 집중extensionfixture검사에서종료1이었다. 엔진snapshot/npmci/지침생성/compile는종료0이지만 지침소스version1.1.0과extensiontest고정파일명1.0.0의차이로manifest누락6개가남았다. build/deploy는시작하지않았다. 제품소스는변경하지않고 생성된frozen1.1.0패키지를review1.1.0에준비하고 자체정합검증된기존1.0.0패키지를별도extensionfixture에준비했다. extension집중10/10 종료0(12.410초), source집중44통과/1platformskip 종료0(45.202초), generated1.1.0 archive40파일/10components/26managedtargets+isolatednativevalidator통과를확인했다. 전체입력소스sha는변하지않으므로r8 external/engine/npm과기존API8개검사는그대로재사용한다.

현재actualproducer `run-windows-r9.ps1`, work ID `5fad03ae-7986-47f0-92cd-0a4ba28300b9`, PID42372. 동일w14f프로젝트/엔진input identity와r9-preflight-results를검증후 FullRegression deploy-w14g를실행한다. w14g는앞선r8에서build가시작되지않아산출물경로를재사용하며설치전빌드수용기준은유지한다. root설치바이트검사·공식확장보존·산출물정리·소유변경commit은최종결과뒤에수행한다. 첫확인은실행30분 또는종료event다.

r9 fullsource101파일과extension-all 모두실제종료0(source734.221초/extension14.369초). deployment는08:35:03.771 UTC 시작, 경과1442.444초후build종료1로전체실패했다. releaseCargo의첫원인은 core compact.rs:306 및session/provider_handoff.rs:383의 get_harness_base_instructions 3번째model인자누락(E0061두개). 현재primary에는두정확한fix이미존재함을바이트로확인했다. 고정f에서두호출만치환한r10-corrections SHA를기록하며다른primary변경은읽어반영하지않는다. source는w14h로파생하고SOURCE schema4 cumulative179+기존2SQLdescriptor를보존하며현재receipt대비delta2만기록한다.

현재producer `run-windows-r10.ps1`, workID `4fbfe568-8df3-4267-a0f9-896a7c96a400`, PID29404. 준비h 실제ready후 기존외부receipt의모든경로/바이트를8worker streamcopy+대조한다(새source/hash생략이아닌기존descriptor재사용). native config/Claude tools/provider격리검사를 먼저실행하고 actualreleasebuild/패키지/설치로이어간다. 입력w14h/산출물w14i이며h source자체는아직준비중이다. 필수Rust연결실패를빌드완료나설치완료로보고하지않는다. nextfirstcheck는소스담당20분/실행기30분 또는terminalevent다.

h-ready 성공09:30:37.386 UTC, source준비09:05:53.785–09:30:37.386/1483.551초/종료0. capture607.660초/recorder448.435초/engine269.277초/project129.212초 모두0. 선택24171경로에서2Rust+SOURCE3개만변경, originalReceipt/기존2SQL additions/나머지파일불변. 엔진SHA `4d962d376a33bd2411fca96f13b6c75644730b58f766584cbf8b1cc99d1d534c` /9224파일, 프로젝트SHA `aab43c2a5e7a15c378c92e73878ef71c263e3b7107b24ec04122e61ff9aacdb0`. 이후source동결. r10은atomicready를소비하며현재진행중이고설치검증은아직남아있다.

r10는외부 copy검사에서09:32:20.814 UTC 종료1. Windows .exe 파일의 Python stat mode0777과 Node영수증0666을직접비교한도우미오류며검사 전 source변경/새build는없었다. Node의Windows read/write bit semantics로mode정규화하고실제path·regularfile·링크·streamSHA·사본SHA·전체선택집합검사를유지했다. 이미복사된일치파일만재검증해재사용하며불일치파일은덮어쓰지않고거부한다. 현재producer `run-windows-r11.ps1`, workID `668bc5dd-6a70-4da7-a668-bd2d6347be74`, 입력w14h/산출물w14i. native검사/빌드/설치는actual결과확인전완료로보고하지않는다.

r11 30분 확인: 외부입력 전체 파일 descriptor복사/바이트검증종료0(249.914초), npmci종료0(120.132초). nativeconfig harness10/10 종료0(825.082초): futureAnthropic defaults/provider 격리/sparse overrides/template inheritance/fingerprint/declaring layer/deepmerge/captured-once/missingunreadablepaths. Claude native tools는09:55:47.567 UTC 시작해실제Cargo45656 아래 rustc47368의 app-server-protocol 컴파일을확인했다. 아직tools/native전체패키지설치의통과근거는없다. 다음확인은30분 또는terminalevent.

r11 Claude native test library compile 종료101: Session private import2/PermissionProfile path1/Session claude_file_state initializer1/role claude_tools initializer1/doubleArcStepContext1/temporary enum slice lifetime1, 합7오류가test-only5파일에서나왔다. assertion삭제나필터회피없이현재공유type계약에연결한고정r12 corrections5파일을준비했다. controls.rs는cfg(test)이후만수정하고나머지4개는test파일이다. primary에는관련fix가있지만최근주source를전체복사하지않고h에서정확한수정바이트만고정했다.

파생입력w14j는h의24171경로+고정5test파일+SOURCE만변경한다. configurationcrate및deps/lockfile는불변이라nativeconfig10통과근거를재사용한다. 현재producer `run-windows-r12.ps1`, workID `2f99817e-9ee4-4e89-ab0c-7bae940e241f`, PID34328. ready후descriptor외부copy/npmci/실제Claude native tools검사부터수행하며산출물w14k로Windows빌드·패키지·설치를이어간다. 아직통과한것은config10및source/extension regression이고원래Windows설치목표는미달성이다.

### r12 고정 입력 준비 완료 (2026-10-13 10:40 UTC)
- j 파생 입력 준비: 10:24:42.201–10:40:19.113 UTC, 936.909초, exit 0. 24,171개 선택 경로에서 테스트 5개와 SOURCE.json만 변경; 나머지 바이트 및 config/의존성 동일. 기존 설정 검사 10/10 결과 재사용 범위가 확인됨.
- engine SHA256: 42c2a7c99d1b65c20855cf3df40ad01faefb6ca4cc016d969ce963ff10feb984 (9,224 files). project SHA256: ed1f71f951b8539077ccea197cf7e382a4d99123be9707b0d5e363ecc1989493.
- 준비 근거: artifacts/logs/AF-01-resume-install/selected-source-j-ready.json 및 selected-source-j-verification.json. 준비 완료는 제품 검사 통과를 뜻하지 않음.
- r12 생산자가 준비 신호를 받아 외부 입력 복사·검증을 실행: exit 0, 124.498초. 이후 실제 native 도구 검사 → Windows 빌드·전체 회귀·패키지 검사·사용자 설치. 다음 최초 확인은 30분 후 또는 실제 종료 신호; 최종 설치 바이트 검사와 정리는 root 후속 작업.

### r12 실제 도구 검사와 r13 보강 (2026-10-13 11:11 UTC 이후)
- core 테스트 컴파일 성공(28m50s). 실제 Claude-filter 검사 28개 중 27pass/1fail, exit101. Read/Edit/Write 9개, control 11개, Windows Bash와 PowerShell 인자 계약 검사 통과. 실패는 ripgrep 명시적 include glob이 숨김 파일 제외보다 우선함에도 테스트가 제외를 기대한 assertion. 후속 exact registry 검사와 Windows build/install은 실행 전 중단됨.
- Grep 실행 인자/동작은 유지하고 description에 기본 필터와 glob 우선권을 구분. 테스트는 explicit glob의 숨김 포함 및 기본 검색의 hidden/binary/.ignore 제외를 각각 확인. 실제 rg 동일 인자 사전 검사 exit0: r13-ripgrep-preflight.json. 준비 과정에서 숨김 fixture의 1-based 행 번호 assertion을 1로 바로잡은 후 고정 SHA 99c394d07ffe8414a911533bf47bc7e05e3e6e5f259ce2ac87fe62ddd173f786 사용.
- l은 j에서 해당 1파일+SOURCE만 파생하며 나머지 바이트/config/의존성 동일 검증. r13 producer workId 180328a3-68d4-4d2d-a905-428aa498af0b, PID36172; frozen w14l, release w14m. 준비 신호 후 native 도구 검사 → Windows 전체 빌드·검사·설치. root 최종 설치 바이트 검증·정리·커밋은 후속. 이전 목표 감사 artifact를 실제 27/28 결과와 미완료 범위로 갱신.

### 사용자 버전 증가 요청 반영 (2026-10-13 11:19 UTC 이후)
- 사용자가 앱 버전 1개 증가 후 사용자 프로필 설치를 명시. 승인된 목표를 2026.0.6 유지에서 **2026.0.7 설치**로 갱신. scripts/azrael-app-release.json을 .7로 변경; 확장 개발용 package.json 0.4.0과 엔진 버전은 별도 소유값.
- r13 상태 waiting-selected-source/stages0 및 실제 실행 commandline을 확인. 자식은 conhost 하나뿐인 상태에서 지정 생산자 PID36172 중단, 실제 프로세스 부재 확인; workId 180328a3-68d4-4d2d-a905-428aa498af0b cancelled. build/package/install 실행 없음.
- 기존 immutable l 입력 준비는 계속하고 변형하지 않음. deploy 공식 -HostVersion 2026.0.7 입력을 r14에 명시해 패키지·acceptance·설치 영수증 버전을 일치시킴. 소스 기본 version(.6)과 선택된 build override(.7)를 구분하고 불필요한 재캡처/컴파일 입력 변경을 피함.
- r14 workId 881b83ea-c333-4bbc-9122-4d218b5f02aa, PID41576; frozen w14l, release w14m. 실제 종료 signal을 발행하도록 새 실행 등록. verify-installed.py 기대값 .7 반영. host version transform/checkpoint 검사 3/3 exit0; 로그 r14-host-version-tests.*. 버전 검사는 실제 설치 성공 근거가 아님.

### l 입력 준비 및 r14 인계 완료 (2026-10-13 11:25 UTC)
- l 단일 producer 11:16:16.192–11:25:24.858 UTC, 548.664초 exit0. 중간 사용자 turn interruption은 agent 대화만 중단했고 실제 node producer는 유지됨; 기존 exec session으로 종료 결과 회수, 중복 실행 없음.
- j 24,171경로 동일, claude_search.rs+SOURCE만 변경. Grep description 외 argv/runtime 바이트 동일; config/의존성·원baseline·SQL2 descriptors 동일 검증. latest main의 .7 변경은 캡처하지 않음. source 기본 버전 .6은 고정하고 r14 공식 HostVersion .7 입력으로 패키지 버전 선택.
- engineSHA7832b4199f15d8bd32689a160a7ba275c776d5f9711d2ee0d47513b365cc6b59, 9,224files; projectSHA06daa08151c25854c0965562b6255ef2c9c6175b07a650ed94d146f2bfc266c9. 근거 selected-source-l-ready.json/verifications. 준비 이후 변경 중단.
- r14 actual 종료 신호 또는 30분 최초 확인 경계로 다음 결과 확인; 준비 완료와 실제 제품 검증/설치 성공을 구분.

### r14 실제 도구 검증 통과 (2026-10-13 11:54 UTC)
- native-harness-tools-tests 실제 exit0, 11:27:05.530–11:54:20.562 UTC, 1635.031초. Claude-filter 28/28 통과(파일9/control11/search4/shell3/pricing1), exact provider registry isolation 1/1 통과. 첫 Claude-suite 컴파일 이후 같은 binary registry 실행 추가 build39.26초; 실제29개 테스트 성공. 로그 r14-native-harness-tools-tests.*.
- 11:54:20.582 UTC r14 deployment 시작, 명시 HostVersion2026.0.7. Windows release build + full source/extension regression → package/native host acceptance → 사용자 설치. 다음 결과 확인은 실제 종료 신호 또는 30분 후 최초경계. 실제 설치 bytecheck와 필수정리·작업커밋은 root 후속.

### r14 Windows build 실패 및 의존성 보강 (2026-10-13 12:29 UTC)
- r14 종료 failed exit1, package/install 미실행. release cargo101의 첫 원인: app-server/thread_processor.rs4962/6287 codex_history unresolved E0433. 현재 main에는 workspace dependency와 app-server lock edge가 이미 있음; frozen l만 두 선언 누락. source/extension regression은 모두 exit0(751.464초/17.530초),101 source files. 로그 frozen l/artifacts/logs/deploy-w14m 및 w14m/engine.log.
- root r15-corrections.json: app-server/Cargo.toml에 codex-history workspace dependency 한 줄, Cargo.lock의 codex-app-server dependencies에 codex-history 한 줄. package version·실행 코드·다른 lock section 유지. main은 기존 수정 보존, 덮어쓰기 없음.
- n은 l 24,171경로에서 선언2files+SOURCE만 파생. 전체 config/core 소스와 해당 dependency closures 동일 검증, 작은 cargo metadata --locked --offline --no-deps exit0 및 lock 미변경 확인 후 ready. 통과한 config10/r14tools29 재사용 근거를 기록.
- r15 workId a59627bf-d8d4-4ef2-8e26-be06a97418c4, PID52304; frozen w14n, release w14o; 명시 HostVersion2026.0.7. 준비 후 Windows build+fullregression+패키지/native acceptance+사용자설치. 실제 설치 bytecheck·cleanup·commit 후속 유지. 다음 준비 최초확인20분 또는 실제terminal.

### n 인계 완료와 r15 재빌드 (2026-10-13 12:43 UTC)
- 담당자 model capacity 실패 후에도 기존 n 준비 producer 유지, root 실제 ready/로그 회수. ready12:43:33.417 UTC succeeded exit0. engineSHA780768ff5934b155c916cf1529920935a46da7f09a0728eb7aac4483e41bb7be,9224files; projectSHA212b1d574d27d30fa5ad77f9009bed11933a2ce6b7535a27bccd860cc8461f56.
- 준비 범위 l→n manifest+lock+SOURCE만. 작은 cargo metadata locked/offline/no-deps 및 lock 미변경 근거 n-verification/correction-review에 보존. core1184/config806/config-schema807 package closures full entries 동일, app-server 미포함: native29/config10 재사용 범위 확인.
- r15 externalcopy/npmci exit0,12:45:12.349 UTC deployment 시작. 이번 최초20분 확인에서 실제 엔진 compile 진행 로그 확인; 다음은 30분 후 또는 actual terminal. 2026.0.7 패키지 설치·최종바이트검사·정리는 미완료.

### r15 TUI 형식 연동 보강과 r16 (2026-10-13 13:11 UTC)
- r15 endedfailed exit1, build cargo101. app-server dependency 오류 해결 이후 TUI replay.rs127 destructure/227 Turn initializer의 parent_turn_id 및 turn_trigger 누락 E0027/E0063. 기존값을 두 위치 사이 그대로 전달하는4줄 보강; root pinnedr16-corrections.json. main은 수정파일과 exact동일, 덮어쓰기 없음. config/core/test/lock unchanged.
- r15 fullsource/extension exit0, build26분13.118초 exit1, package/install 미실행. 해당입력 n immutable유지.
- p는 n 24,171경로에서 replay.rs+SOURCE만파생. root r16 workId4019f50a-5ead-48aa-b1f4-1bdc7e853f22; releasew14q, 명시HostVersion2026.0.7. native29/config10 재사용은 p전체bytes 검증을전제로함. 최초준비확인20분 또는실제terminal; 실제설치후바이트검증/정리/commit미완료.

### p 준비 완료 및 r17 실행 (2026-10-13 13:43 UTC)
- r16은 준비 실패 ready를 읽고13:27:41UTC stages0 failedexit1로종료; package/build/install 미실행. p초기gitclone128는누적sharedalternate depth 제한. p디렉터리없음실제확인후 실패로그p-attempt1-*이동보존; primary owningGit객체anchor의원nHEAD존재확인으로 복구. 선택bytecapture는immutable n만,main소스미포함.
- p준비단일정상producer13:31:45–13:43:05UTC679.296초exit0.24171경로동일, replay.rs+SOURCE만변경. core/config/manifest/lockbytes동일; 원baseline/SQL2schema4유지. engineSHA d83bb231efac42919522b8a4cb4a08694903627fb205cb3c0fda22a7b507deab/9224files; projectSHA091e7eaf7b229a18ca0d1f9bba358fc466d2786ef3a6e226e7366ae2913a675c.
- r17새producerworkId0a41f145-b1f2-4657-a0bc-6096323f7d25. 동일고정p입력/releasew14q(기존없음검증)/HostVersion2026.0.7. native29/config10동일입력범위검증결과재사용; Windowsbuild/fullregression/package/nativeacceptance/install후rootbytecheck·cleanup·commit유지. actual종료또는30분최초확인.

### r17 Windows engine build 성공 (2026-10-13 14:43 UTC 확인)
- r17 producer running; w14q/build-metrics.json status success, elapsed2573.086초. cargo engine dev profile33m16초 success(최적화release라고보고하지않음), app-server/TUI/CLI compile완료. packaged-source/window-control-source checks exit0, release-selection success. engine.log/build-metrics 근거.
- 2026.0.7 패키지 준비와 host acceptance 후 설치가 이어지며 아직 설치완료 증거 없음. 종료 actual signal 또는다음30분 경계 확인.

### r17 기능 보존 환경 오류와 사전 복구 (2026-10-13 15:15 UTC 이후)
- engine feature receipt의 source check engine.provider-context.input-budget-helper만 exit1, 첫원인 Bun tests/context-budget.test.ts import zod/v4 missing. 실제productbyteerror아님. 다른nativechecks/preservation producer아직진행; 반복build/동시heavy실행안함.
- frozenp providers/opencodex에서 pinnedBun install --frozen-lockfile --ignore-scripts 실제exit0(7.840초), generated node_modules만준비. 첫경로호출은cwd부정확으로실행안되어결과사용하지않음; 절대tool/logpath 재호출실제성공만근거.
- 동일test-provider-input-budget-helper.cjs 실제exit0(8.134초), finalwire/inferencefreeestimate/usagecorrelation/safeprogresscheckspassed. r18-input-budget-preflight.stdout/stderr.log 보존. native remaining 완료후현재immutablep/성공engineq재사용해 새package단계진행; 결과/소스동일성검증을전제로함. 2026.0.7 설치아직미완료.

### r17 최종 보존 검사 실패 원인 분리 (2026-10-14 KST 재개)
- r17 deployment endedfailed exit1, wall15134.011초(약4시간12분14초; 겹친작업시간합산아님). engine build/source/extension 통과했지만 featurepreservation 실패로 package/install 미실행. actualreceipt preservation-nkpaPa 확인.
- API prompt/skill/core, root-resume, model-harness config/tools, mapping/safeexport, recovery 실제exit0. tools29가패키지단계에서도통과했으며 마지막registry sharedCargoartifactlock대기를포함4080.100초. 다른작업자cache/process중단안함.
- 남은원인: providercontext 입력budget헬퍼 zod/v4 dependency 누락(이미pinnedBuninstall+동일checkexit0로복구); auto-account/accepted-input/Devin fixture estimate requestprotocol 누락(독립담당자fixedpins/actualbuiltengine검사); manualcompaction Rusttest reset_version이일반compaction완료지표가아닌잘못된assertion(현재mainmeaningfulcontextwindow/checkpoint/events검증testonlyfix이식); freshpersistentthread metadata read의emptyrollout(독립read-onlyexplorer원인검토).
- 추가행동은fixture검사/mainexistingtest재사용및boundedproductrace분석만. 제품assertion/권한/프로토콜을완화하지않음; root기존계획/2026.0.7 설치목표유지. 실제패키지설치/bytecheck/cleanup/commit미완료.

### 최종 입력 r18 수정 범위 확정 (2026-10-14 KST)
- fixture4 고정핀과 originalw14p nativecheckdrivers를actualw14q engine(a61c8c99e4c4af807d3820c4dee1d8c46d5662019fbced11ec90d298c27d6a9b)에검증: approvedinput/autoswitch/Devin-native/code-mode/agents5/5 exit0,23:25:08–23:26:09UTC. 실제provider호출없는합성상태.5개fixture 공식cleanup미리보기/삭제exit0+actualabsence, validation-results/evidence 유지.
- manualcompactiontest는 reset_version(Guardian review invalidation counter) 대신 실제oldmessage제거/contextwindow/checkpoint/started+completed 및autooff보존검증. 현재main기존함수와exact, productlogic변경없음. correctedRust실행아직pending.
- freshthread race제품원인확정: ThreadStore read가writerguard없이생성직후빈rollout을관찰. currentmain read_thread.rs의 기존 3줄 sharedlive_writer_lock+deterministicregression107추가줄을verifiedSHA2f07b5fb209df5fe297a1b3526eb69ee0617e143be808659444ad468e82e6535로pin. writerbarrier가flush+SQLiteprojection완료까지읽기직렬화, 강제freshthreadmaterialization/emptyfileerror무시없음. currentmain수정재사용으로primary변경없음. 공통runtimeboundary 변경이며 Windows실제검증만예정, 타OS미검증.
- r18-corrections.json8pins=fixture4+manualtest+readbarrier/test+appversion.7+Grepowningdoc. 원pbeforeSHA/교체afterSHAactual검증. s sourcecapture는p고정24171선택만,primaryGitmetadataanchor외 mainrecapture없음. capture중최종pins확정해followup인계. final8files+SOURCE만 허용.
- r18 producerworkId1ff42153-a8d0-4605-bd60-058fad47ce04/PID45720; frozenw14s/releasew14t/HostVersion.7. generatedproviderdeps frozenlock준비 포함. 작은thread-storebarrier+coreauto_compaction 실제test를먼저실행해재빌드전입력검증; 이후전체Windows build/fullregression/preservation/package/nativehost/install. 변경된ThreadStore의integration은최종검사재실행하므로기존config/tools는historicalevidence표시, 미검증성공근거로사용안함. 최종installbytecheck·cleanup·commitroot후속.

### s 입력 준비 완료 (2026-10-14 08:37 KST)
- capture23:27:26–23:32:43UTC317.616초exit0; finalize23:33:00–23:37:31UTC271.766초exit0. p-onlycapture checkpoint 재사용9.7초검증 후8approvedpins+SOURCE적용,24171경로유지정확9delta. engine descriptor2변경만, configcrate/manifest/lock/원baseline/SQL2schema4동일. marker2026.0.7.
- engineSHA57164434f66880571614c8f2d4d9f8e07dcae3ce0d2b219cd9d2c5a44df4931a/9224files; projectSHA24dd72e85b829770850a7186e89f69b401c542c9d24166a0f7e1744efd151df5. ready/verificationactualsuccess,source준비후변경없음.
- r18 ready인수후외부입력/의존성준비→작은threadstorebarrier+coreauto_compaction실제회귀검사→새engine빌드+전체검증/패키지/사용자설치. ThreadStore product변경이있으므로historicalevidence와최종검증을분리. 다음최초확인30분 또는actualterminal. 설치bytecheck/cleanup/commitroot후속.

### r18 사전 컴파일 오류와 안정된 빌드 경로 (2026-10-14 08:46 KST 이후)
- r18 thread-store-barrier-test compileexit101,377.898초. 첫원인 unrelated기존thread_history_materialization_tests.rs3601 StoredTurnItemsView::Full nonexistent. 실제enum는NotLoaded/Summary두값만; loop에서Full한줄삭제, assert그대로. currentmainalreadyexact일치. r19-corrections.json pinnedafter249e8043acff626cfafb6be2e1cab5a9d06f2b3fcf42f2e800b09ea307592aa0. 아직barriertest실행전컴파일실패,새Windows build/package/install미실행.
- u는s24171paths에서해당1testfile+SOURCE만파생. immutable제품입력각revision보존. Cargo absoluteSourceRoot경로변경의반복compile비용을줄이기위해 artifacts/engine-input-AF01에uengine를exactbyte COPY로 materialize; symlink/junction/worktree아님. SOURCEbyte동일,닫힌pathset/sourcebeforeafter/desthash검증+engine snapshotSHA9224files일치까지ready조건. 복사입력은r19실행중변경금지; 후속수정은실제producerterminal확인후새고정snapshot기준필요delta만허용. 제품sourceu는계속불변.
- r19 workIdc7a9a92c-ca7d-4dab-9985-4be3c7265d06/PID55980. projectRootw14u,releasew14v,SourceRootstableenginecopy,HostVersion2026.0.7. readybuildEngineRoot절대경로및engineSnapshotSHA/fileCountguard추가. 테스트의manifest/Cargo루트와actualbuildSourceRoot동일stable경로. 작은barrier/corecompaction검증→Windowsbuild/fullpreservation/package/사용자설치. 최종 bytecheck/정리/작업commitroot후속.

### u/stable 입력 준비와 r20 인계 (2026-10-14 09:09 KST)
- r19는처음failedready를읽어00:05:30UTC stages0failedexit1; build/package/install미실행. 첫stablecopyprecondition은snapshot9224+SOURCE=9225가정오류. distributionFiles의queue_migrations/.gitattributes가추가되어실제닫힌regular목록9226. 원uSHA재검증후receipt.files+distributionFiles+SOURCE목록을projectengine목록과exactmatch하여복구; 실패로그attempt1보존.
- u/stableactualready00:09:53.318UTCexit0. engineSHA2baaf9b7bb79cf62420e0ef7eb18e6e1e2e8324db48d8ecce93ee67ae61301b9/9224descriptors; projectSHA247ddd0a878547b6a8748ec0823caf7c595353d4d05c039ce670be55d1f7e6c0/24171paths. s→u testfile+SOURCE only. stable regularcopy9226 files49.99초exit0,source/destclosedpathset/streamSHA/destSHA/mode/identity검증;stableengineprovenance108.3초exit0+u엔진snapshot객체전체동일.
- 소스와stable입력ready이후불변,parent소유권반환. r20 workId0b78fcc7-f50c-47a8-89c8-cb9983239472,projectw14u/releasew14v(기존없음확인)/SourceRootartifacts/engine-input-AF01/HostVersion2026.0.7. 기존r19스크립트같은입력재시작,제품입력재생성없음. 회귀검사/빌드/패키지/실제설치후bytecheck·cleanup·commit후속. actualterminal또는30분최초확인.

### r20 기록 잠금 회귀 통과 (2026-10-14 09:20 KST)
- thread-store-barrier-test 실제1/1pass exit0. stage00:13:29.884–00:20:20.776UTC410.892초(compile포함), test실행0.33초.275libtests중정확회귀1개선택. rootstableSourceRoot bytes고정. 원빈rolloutInternal 유지/writer잠금동안readPending/기록flushprojection뒤metadata반환을실제검증.
- core manual-auto-compaction-tests00:20:20.783UTC시작,r20진행중. 성공한sourceguard/외부copy/extensiondeps/providerfrozenset및barrier회귀만현재검증근거. Windowsbuild/package/install미완료. 다음actualterminal/30분확인.

### r20 압축 검증 통과와 빌드 시작 (2026-10-14 09:48 KST)
- manual-auto-compaction-tests 실제8/8pass exit0.00:20:20.783–00:48:01.223UTC1660.440초compile포함,실제test2.42초. autooff manualcompaction/contextwindow/checkpoint/lifecycle 검증, legacy/default/sparse/disabledreasonphase/quota/resume/fork설정체크모두통과. 로그r20-manual-auto-compaction-tests.*.
- deployment00:48:01.249UTC시작: sourcew14u와stableengineSHA2baaf9... 동일입력으로Windows engine build+fullsource/extension+nativepreservation+packagehost6stage+사용자프로필설치. 첫회귀2개검사(1+8) 통과는필수최종패키지검증통과와구분. source/stablefiles변경없음,다른Cargo작업중단하지않음. actualterminal또는다음30분확인 후 bytecheck/cleanup/commit.

### r20 engine compile 성공 (2026-10-14 10:18 KST 확인)
- stable SourceRoot actualcargo devprofile32m12초success. Windowsbuild-metrics중companion npmci/packageexit0,companion package113.302초. 전체build마무리/후속nativepreservation/packagehost/install진행전이라설치완료주장없음.
- 디스크free16.55GB 확인. primarysharedCargotarget가활성입력이므로보존. diagnosticn14a/w14a own target미존재 확인,재생성cachecleaner경계 읽기만수행(삭제없음). snapshot/userstate/release/current-previous 보호 유지. broadignoredcachepathsearch결과없음exit1은검증성공근거로사용안함.
- 다음actualterminal 또는30분경계에서필수보존/호스트검사상태확인,최종설치bytecheck와mandatorycleanuproot후속.

### r20 전체 빌드 및 보존 source 검사 통과 (2026-10-14 10:50 KST 확인)
- w14v build-metrics status success,elapsed4169.569초. enginesource와packaged-source/window-control-source checks 포함완료, runtime release선택성공. Windowsactualbuild성공이며일반사용자설치와별개.
- fullsource/extension regressionactualexit0,101sourcefiles선택,extension24.104초. results.jsonselected-source-scope 보존,unsupportedplatformskip과실제검증환경Windows구분.
- engine-preservation preservation-ImBbIu receipt현재running: modelharnessmapping/managedidentitymapping/inputbudgethelper(8.2초)/safecontextexport(11.104초)exit0. r17 budgetdependency오류가최종동일frozenlock환경에서도해결됨확인. native후속checks/host6stage/installbytecheck/cleanup/commit미완료. actualterminal또는30분확인.

### r20 진행 확인 — 2026-10-14
- 완료 이벤트 대기 기한에서 실제 상태를 확인했다. producer는 실행 중이며, 설치 완료가 아니다.
- Windows 전체 빌드, source/extension 회귀에 이어 engine.api-context prompts/skills/core와 engine.root-resume-reasoning.native가 실제 exit 0으로 통과했다. mapping 2개, input-budget-helper, safe-context-export도 exit 0이다.
- 후속 패키지 검증과 사용자 프로필 설치는 engine preservation의 실제 종료 결과를 기다린다. 현재 고정 입력과 활성 Cargo 캐시는 변경하지 않았다.

### r20 결과와 r21 인계 — 2026-10-14
- r20 deployment는 03:17:38 UTC 준비 시작 후 namespace aggregate 검사에서 exit 1로 종료했다. 전체 deployment 경과 10,008.723초이다. 엔진 기능 보존 18/18, 계정 제어, full source/extension 회귀, Windows 빌드는 모두 실제 exit 0이다.
- deferred-turn의 9개 asset별 기대/실제 변환 횟수는 15+10+1+2+8+3+2+1+1=43이고, 마지막 aggregate만 42였다. root는 frozen u 기반 namespace 파일과 primary의 해당 숫자만 43으로 고쳤다. 핀 r21-corrections.json(before44e0e68b..., after29748916...)을 새 w 프로젝트 입력에 적용한다. 다른 primary 동시 작업 변경은 포함하지 않는다.
- 엔진 소스 지문 2baaf9b7.../9224, codex.exe e4095ba7..., bridge4cdcf5ce..., code-mode-host ec91f7a0...을 보존하여 동일 엔진 재사용 조건을 공식 build 경로에서 확인한다. 기존 전체 검증 근거를 유지하며 namespace 영향 검사, 새 패키지와 fresh host 6단계 및 설치 검증은 다시 실행한다.
- r21 producer PID34708 시작03:41:40 UTC, workId b745863d-1ddd-4c3f-adee-b2bd9694f204. w 입력 준비 이벤트를 기다려 w14x release를 생성·검증·설치한다. 최초 확인은30분, 종료 시점 보장은 없다.
- 통과한 r20 account-controls fixture는 공식 cleaner preview/apply exit0, deleted 상태 및 경로 부재로 정리 완료했다. 증거는 verification-evidence에 보존했다.

### r21 환경 오류와 r22 — 2026-10-14
- w 입력 준비 완료: project9769645ec48ac77736e56c0dfc3bb206081c68dc74934567e70c23f02dfcea43/24171경로, namespace1파일 외 u와 동일. 엔진 snapshot 전체 u/stable과 동일2baaf9b7.../9224. 준비03:39:50–04:03:17UTC/1407.417초 exit0.
- r21 deferred-turn 및 namespace source 검사 exit0. 변경 영향 source36파일/379tests 중378pass, test-edit-stop-integration.cjs:82가 artifacts/verification 상위 디렉터리 없이 mkdtemp를 호출하여 ENOENT1건 실패. 엔진/기능 오류 근거가 아니다. 소스 테스트 실패로 병렬 build가 공식 producer에서 종료되었다(terminated true, exit -1).
- 코드와 w 입력을 다시 고치지 않았다. r22는 등록된 verification 상위 디렉터리를 준비한 뒤 동일 w source로 새release w14y를 생성한다. 기존 w14x 실패 폴더를 덮어쓰지 않는다.
- r22 PID25532 시작04:17:35UTC, workId6a81444f-24e4-4267-b3e8-44ea1f3a54b1. 최초 확인30분 또는 실제 완료 이벤트. 엔진 재사용 검증, namespace 관련 소스 검사, fresh패키지호스트6단계와 설치는 유지한다.

### r22 검증 결과와 r23 호스트 재검증 — 2026-10-14
- r22 source36파일/379tests 전체pass, 엔진 출처·바이너리 재사용 빌드 exit0(596.566초), 후속 engine6checks와 account controls exit0, 패키지 준비exit0(622.250초). 준비VSIX SHA ca87e2f4e9eb65635c88722b4b2988a8e738b7505c3bc745fe9b6e6b6e0d9a60/version2026.0.7.
- host6단계 중 inventory/install/inventory/namespace exit0, standalone CLI exit0이나 runner 결과파일이 없어서 failclosed; coexistence미실행. 설치 전 실패이며 일반 사용자 프로필 설치는 실행하지 않았다.
- 원인미확정: code.cmd/CLI는 ELECTRON_RUN_AS_NODE를 GUI자식에서 제거하므로 해당값을 직접원인으로 단정하지 않는다. 다른 inherited VSCODE_*는 전달될 수 있으나 종료로그 부재로 원인증명은 없다.
- r23은 동일 준비된VSIX와 source/release를 재사용하고 새로운 AF01-host-r23 fixture에서 process환경 VSCODE_* 및 ELECTRON_RUN_AS_NODE 제거, verbose/trace CLI로그와 fresh6단계 검사 실행. 제품/패키지변경없음. PID53712 시작04:55:36UTC, workId8b3e35bc-e9ea-4290-bc8f-438bec20374b, 첫확인15분 또는 종료이벤트.
- 독립적으로 패키지preservation verify, 엔진verify-receipt, 24171경로 source입력fingerprint 재확인을 시작했다. 실제 exit와 output은 r23-* 로그에 보존한다.

### r23 업데이트 잠금 원인과 r24 공식 ZIP 검증 — 2026-10-14
- r23 fresh fixture에서도 standalone runner 결과가 없어 failclosed. verbose same-window 로그는 checkInnoSetupMutex vscode-updating 대기 후30초에 'Code is currently being updated'→Lifecycle kill을 기록했다. 실제 updater14148/child10440은10월13일13:11KST부터실행중; 설치로그끝은 'Installation process succeeded' 후 'Checking whether application is still running...'. root 사용자창을 종료하거나 updater를 kill/cancel하지 않았다.
- 초기ELECTRON_RUN_AS_NODE 가설은근거상철회했다: CLI는GUI자식에서이를제거하고, r23 inherited환경정리 후에도 업데이트mutex가실제실패원인이었다. standalone/nativeactivation이실행됐다고해석하지않는다.
- 같은버전1.140.0/commit07f806f999227108933c2e30515b26eecc1fda74의 공식Windows x64ZIP을 update.code.visualstudio.com에서 별도artifacts/tools 경로로확보했다. Microsoft Authenticode Valid, product.target 없음, package.json/mainImpl.js/cli.js 설치본과실제hash3개일치. 기존설치product수정이나mutex우회없음. 공식ZIP안내 https://code.visualstudio.com/docs/setup/windows 및FAQ확인.
- 공식ZIPCodePath를새 AF01-host-r24 fixture검증에사용하며 준비된동일AzraelVSIX ca87e2f4.../2026.0.7을유지한다. 실제일반프로필설치는기존설치본CLI로실행할예정. 테스트환경을ZIP버전/Windows x64로명시하며 업데이트가완료되지않은일반창의GUI를accepted로보고하지않는다.
- r24 PID43192 시작05:07:41UTC/workId19708421-83dc-4269-8275-edac821d21b1, 최초확인20분/실제완료이벤트. 소스·엔진·패키지preinstall재검증은r23 actualexit0/statuspassed이며 source9769645e.../24171로일치.
- r24 공식ZIP 준비: 다운로드·압축해제·Microsoft서명검사 실제 exit0, currentinstalled와package.json/mainImpl.js/cli.js3개hash일치. archive는 versioned07f806f999/resources/app 배치를사용하며 resources/app 직결경로라는초기예상만정정했다. actualprovenance r24-official-host-provenance.json.
- 이전failed host fixture2개(deploy-w14y,AF01-host-r23)는공식cleaner preview→ordinary Remove-Item에서읽기전용복사된original Linux voice .so 파일 때문에retained. Attributes33(ReadOnly+Archive) 실제확인. 강제삭제/다른API우회없음; 실패증거archived, 제거가능해지는조건은소유readonly속성/접근제약이정상적으로해결되고참조프로세스가없을때다. 다른payload일부는ordinarycleanup으로이미정리됐다. account-controls-w14y는deleted/경로부재로정리완료.


### r24/r25 설치 완료와 빌드·검사 최적화 — 2026-10-14
- r24 동일 최종 VSIX fresh host6단계 모두 actualexit0/passed:true. 검증 환경은 Windows x64/공식 VS Code1.140.0 ZIP이며 기존 설치본과 commit07f806f999...가 같다. 원래 설치본의 GUI 업데이트 잠금은 해소됐다고 주장하지 않는다.
- r25 기존 설치본 CLI로 일반 사용자프로필2026.0.7 설치와 전체 설치파일 동일성 검증 actualexit0. 시작05:15:52UTC/종료05:19:52UTC. Installed:true, ReloadRequired:true, Launched:false. 설치receipt w14w/artifacts/deployments/independent-20261014-141608-114/deployment.json; package SHA ca87e2f4e9eb65635c88722b4b2988a8e738b7505c3bc745fe9b6e6b6e0d9a60. r25-installation-metrics.json, r25-installer-result.json에 보존. 기존 사용자창을 종료·reload하지 않았다.
- 최초 승인된1단계 구현과 Windows 패키지·일반프로필 설치 목표는 달성됐다. native gates를 적용하는10도구 전체 기본통합, 실제유료 Anthropic coding smoke, Linux/macOS 검증은 별도미확인이고 UI/Notebook/Cron/Worktree/Plan/mediaRead는 합의된후속이다. goal-audit-code.json을 실제증거범위로갱신했다.
- 사용자 추가권한: 대기 중 빌드·테스트 시간을 줄일 최적화 및 큰 빌드캐시의 분리·효율적 관리. 공통 build/deploy 의미를 유지하고 Windows에서 검증한다. 새 버전 재빌드와 사용자창 조작은 추가하지 않는다. primary 최적화는 설치된 frozen w 패키지와 독립이다.
- 조사: r20 source101files12m49와build69m31은겹쳐실행됐다. engine preservation78m20 중nativechecks72m56; auto_compaction8tests runtime2.42초 대비compile대기27m40. 캐시audit 논리합계778.849GB/3,769,865files(30reparse제외), 현재primarytarget297.370GB, 과거codex0160target232.482GB. 논리크기는 실제할당·해제량이아니다. 필수범위 삭제 대신 동일입력 검사재실행과 사본별 중복을 줄인다.
- root 책임: scripts/build-azrael.ps1/deploy-azrael.ps1 통합, docs/playbooks/build.md와docs/ops/development.md 계약, 설치수락·실제정리·커밋. estimate_fixtures는build-module-cache.ps1/test만, manual_compact_check는test-deploy만 독점변경. 두담당자입력확정후 독립실행, 무거운Rust빌드없음. 소스/캐시읽기조사는 별도readonly 담당자가완료. 다른작업변경은유지한다.
- FullRegression은 전체검사범위를 선택하고 통과증거 재사용을 유지한다. ForceNativeVerification이 선택된native/Cargo 검사 강제실행을 소유하며 둘을 함께 쓰면 전체 강제실행이다. 출처·현재소스·출력해시·최종패키지동일성·fresh host6단계는 유지한다.
- ModuleCacheProjectRoot는 명시적 절대 owner 경로로 frozen projects의 모듈캐시를 공유한다. 예: primary내 frozenproject 빌드에 -ModuleCacheProjectRoot C:/Users/felre/Desktop/pi-harness-init. 입력역할/순서·상대경로·SHA·도구·OS/architecture로 schema2키를 구성한다. owner lease와 atomic .projects.json이 실행프로젝트를 등록하고 각프로젝트 current/previous 설치toolchain참조를 보호한다. staging은 실행프로젝트만 정리한다. registry손상·missingroot·link·경로이탈은 변경·삭제를 차단한다. 기존 ordinary삭제수정도 이캐시관리범위의 검증된 보존조건으로 통합한다. 기존캐시 자동이동은 하지않는다.
- 검증: optimization-module-cache-tests.log/result.json actualexit0; 사본간hit, 내용/도구/platform/역할변경miss, 출력손상, 다른등록프로젝트의current/previous참조, lease, registry/link/missinginput실패경계통과. optimization-deploy-tests.log/tests-result.json 관련18mock actualexit0; full범위+reuse/선택·전체force/공유경로전달/provenance변경/6host단계실패guard통과. root build/deploy PowerShellparse와CRLF-aware diffcheck exit0. Windows x64/PowerShell7.6.6 검증, 전체mockmatrix·타OS·실제빌드속도차이는미측정이다.
- 실제Rust정리: 공식 clean-engine-caches preview후apply, primarytarget보호/프로세스검사통과. 05:30:04–05:32:28UTC/143.646초, actualexit0. 과거 artifacts/build/codex-0160-rust-target removed/경로부재, current engine/codex-rs/target preserved-protected. C drive freeBytes 6,753,050,624→227,507,019,776; 이는 작업중 측정한 여유공간 순증가이며 과거target단독 해제량이라고 단정하지 않는다. optimization-engine-cache-{preview,apply,metrics}.json 근거.
- r24 호스트fixture증거를 w14w/artifacts/logs/verification-evidence/AF01-host-r24에 archive한 뒤 ordinary삭제시 readonly/access제약으로 일부잔여retained. 성공check-result는 보존됐고 r25metrics는 archived acceptance 경로를 참조한다. mock fixture도 Hidden .git 때문에잔여retained; optimization-deploy-cleanup.json 경로·사유보존. force/attribute변경/API우회없음. 접근·속성이 정상해결되고 실행참조가없을때 다시보통삭제 가능하다.
- release preview는current w14y와engine재사용원본u/w14v를 보호한다. failed w14x는 build-info가 없어 ownership확인전 보존한다. final-release-cleanup-preview.json 대신 owner가요구하는 w14w/artifacts/logs/legacy-release-cleanup/AF01-final-preview.json에보존했다. 재생성가능한 cache와 release/source/UI provenance를 구분했다.
