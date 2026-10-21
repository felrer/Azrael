상태: R01·R02·R05 확정 변경을 원본·내장 사본에 반영했고 관련 source 검사 5개가 통과했다. 공유 출처 기록 불일치로 이번 수정의 출처 갱신·작업 커밋은 대기 상태다. R03·R04는 현행 유지로 확정했고 R05의 병렬 결과 확인·출력 구분도 현행 유지를 확정했다. R06을 이번 응답에서 제시하며 사용자 검토 전이다.

# 모델 시스템 컨텍스트 직역 검토 계획

## 목표와 현재 권한

모델에 제공되는 컨텍스트를 원문에 대응하는 한글 직역으로 조금씩 검토한다. 프로필별 차이와 모든 도구의 설명·입력 계약을 포함하고, 전체 원문을 한 번에 제시하지 않는다. 범위 조사와 계획 작성을 마쳤고, 공통 행동 지침을 6부분으로 나누어 제시한다. R01·R02 변경과 R03·R04 유지가 확정됐다. R05는 검색 문구 수정·60초 대기 제한 삭제·여러 줄 본문 전달·테스트 지침 변경에 이어 제품 표시 문구 규칙 변경도 승인받았고, 나머지는 현행 유지로 확정했다. 현재는 이 마지막 확정 문구를 반영하고 R06을 직역한다. 기존 feature owner 연결을 재사용한다. 제품 빌드·설치는 포함하지 않는다.

사용자가 확정한 사항은 프로필별 검토, 도구 컨텍스트 전수 검토, 부분별 직역과 공통 행동의 6부분 분할, 아래 R01·R02·R05 문구와 적용 권한, R03·R04의 현행 유지다. 한 번에 한 단위를 제시하며 다음은 R06이다. 아래 후속 순서와 분량은 권장안이다.

## R01 확정 문구와 반영 범위

사용자가 승인한 문구를 문장 순서대로 영문 원본에 반영한다. 실제 모델 능률의 개선은 검증하지 않았다.

1. 사용자가 요청한 범위와 기존에 부여된 권한 안에서 작업하세요. 추가 권한이 필요한 작업을 시작하기 전에 해당 권한을 얻으며, 이미 부여된 권한은 이어서 사용하세요. 또한 승인된 계획의 범위에서 수정해야 합니다. 범위를 넘어서는 수정은 추가 권한을 얻은 뒤 수행하고, 작업 이후 보고해야 합니다.
2. 확인이나 허가를 요청할 때는 필요한 이유와 근거가 된 지침·상황을 명확하게 설명하세요. 예를 들어 `SKILL.md`, `AGENTS.md`, 메모리 또는 승인 자동 검토 차단이 근거가 될 수 있습니다. 자동 승인 검토의 거부로 작업을 완료할 수 없다면, 거부된 작업과 제시된 이유를 중간 보고 채널과 최종 채널 모두에서 사용자에게 간결하게 설명하세요.
3. 불명확한 요청에 관한 기존 R01 문단은 삭제한다. 사용자 대화 구간의 질문·대기 지침은 유지한다.
4. 확인이 필요한지는 적용되는 지침과 현재 세션의 승인 내역을 함께 검토해 판단하세요. 승인된 범위 안의 통상적인 구현 선택은 맥락에 따라 스스로 결정하세요. 계획에 미포함된 자의적인 선택은 중간 보고 채널과 최종 채널 모두에서 설명이 필요합니다.

R01의 검증·정리 완료 문장과 감정·출력 위치 강제 문구를 제거했다. 다른 사람에게 메시지를 전송하는 기존 문단은 보존한다. 완료 기준의 후속 공통 작업 지침 통합 여부는 R05 등 해당 구간을 검토할 때 판단한다.

소유 파일은 `instructions/instructions/agent-behavior.md`, `engine/codex-rs/prompts/templates/agent_behavior.md`, `docs/architecture/instructions.md`, feature inventory의 두 owner 추가와 이 작업 기록이다. `engine/SOURCE.json`은 시작 전부터 다른 작업의 변경을 포함한다. original import는 `artifacts/inputs/engine-original-import-12a1dbfc`이며 raw receipt SHA-256은 `12a1dbfc1725df7d4e87de4e336e0b8dab217aecbe7d26b624d1e264356b00b6`이다. 현재 receipt의 originalReceipt와 이 baseline의 깊은 동일성을 확인했다. official recorder는 이번 embedded prompt 한 경로만 허용해 실행했고, 아래의 다른 경로 불일치로 게시를 거부했다. 시작 시 current receipt SHA-256은 `7215945a03237cdfae38bef75181a8ef710b5a17ab1d218d3d3cde536a9fe02a`이다.

범위는 Azrael의 공통 컨텍스트 구성과 환경별 조건부 문구를 함께 다루는 혼합 범위다. 제품 대상 Windows x64·Linux x64·macOS ARM64를 구분하며, 이번 소스 조사는 Windows 작업 공간에서 수행했다. OS별 셸·경로·권한·데스크톱 도구 문구는 별도 차이로 검토한다. 원격 실행에 관한 지침의 존재와 제품의 원격 환경 지원 여부를 혼동하지 않는다. 설치된 앱·실제 provider 요청·타 OS 실행을 이번 조사로 검증했다고 주장하지 않는다.

## R02 확정 문구와 반영 범위

사용자가 제시한 수정안과 직전 응답의 권장 보정 5개를 승인했다. 기존 성격 서술을 말투·분량, 도구·전달, 능동성, 객관성의 네 행동 기준으로 교체했다. 제목은 내용에 맞춰 `Collaboration and communication`으로 바꿨다. 사용자가 삭제한 기술 세부사항·목록 형식·사과 관련 기존 문단은 다시 넣지 않았다.

확정 보정은 다음과 같다. 도구 호출·코드 주석 금지는 진행 보고의 대체 수단에 한정한다. 능동적인 실행과 후속 조치는 승인 범위에 한정하고, 사용자가 예상할 범위 대신 요청·승인 범위를 기준으로 삼는다. 객관성에는 사용자의 믿음 확인보다 기술적 정확성과 진실성을 우선한다는 문장을 포함한다. 핵심 먼저 설명 문장은 하나로 합치고, 하이픈 복합 표현 및 하지 않을 일·유지 사항 등 부가 설명 제한은 불필요한 경우로 한정한다. ASD-STE100은 80% 준수 대신 명료성 원칙을 참고한 짧고 명확한 문장·일관된 용어로 표현하며, 이전 맥락에 없고 이해에 필요한 어려운 개념은 처음 사용할 때 짧게 설명한다. 결과·근거·검증·PR 설명 문단은 유지한다.

원본·내장 사본과 owning architecture의 공통 의사소통 계약을 갱신했다. `engine.model-harness-profiles`의 기존 source owner·검사를 재사용하며 별도 기능·테스트를 추가하지 않는다. R01 prefix와 `# Working with the user` 이후 R03–R06 suffix의 SHA-256을 수정 전후 대조하여 byte 보존을 확인했다. R02 수정 후 전체 prompt는 156행·18,254 bytes, SHA-256 `c950728d9f979294ca85f02a0504eb7b18ff2548875db903883117f12da474e0`이다. 6개 구간의 행 범위는 그대로다. 이번 R02 수정은 공통 behavior를 사용하는 프로필의 문구에 적용되며 별도 lean/custom behavior는 변경하지 않았다. 실제 설치 앱의 갱신이나 모델 능률 개선은 검증하지 않았다.

R02 검증은 Windows x64에서 `project_tests`의 retained `common-instructions` bundle을 plan/run했다. argv는 `node --test scripts/test-common-agent-instructions.cjs`, actual exit 0, 5/5 통과, producer_completed=true, before/after integrity valid다. run ID는 `run-45928-736-1792310877128185600`, bounded 로그는 `tool-call:exec-8467a38f-4fe4-4ea6-baa4-b2112d97afd5:step-665becae8e0662fe5463e94dba290386b0a9ea7a1ccf4ddea24e2f6b44a07026`이다. 사본 일치·비검토 구간 보존 assertion 및 scoped `git diff --check`도 exit 0이다. 첫 assertion 실행은 검증 후 원문 출력에서 Windows cp949의 em dash 인코딩에 실패했으며, stdout을 UTF-8로 지정해 재실행하여 exit 0과 R03 원문을 확보했다. 새 로그·백업·스냅샷·빌드·설치 파일을 만들지 않았고 기존 retained 검사는 보존한다.

## R05 확정 문구와 반영 범위

사용자가 승인한 검색 문구는 “소스 코드와 프로젝트 파일 검색에는 `rg` 또는 `rg --files`를 우선하세요. 검색 대상이나 실행 환경에 더 적합한 도구가 있으면 사용하세요.”다. 이 두 문장을 영문 유지보수 원본·내장 사본에 반영하고, 60초보다 긴 blocking sleep/wait를 피하라는 R05 한 불릿을 삭제했다. 후속 사용자 확정으로 여러 줄 PR·이슈·댓글 본문은 구조화된 인수 우선·gh 본문 파일 또는 표준 입력 전달로 바꾸고, “실제 줄바꿈과 의도적으로 사용한 리터럴 이스케이프를 보존하세요”를 유지했다. 테스트 두 불릿은 “테스트와 검증은 해당 작업에 적용되는 프로젝트 지침과 스킬을 따르세요”로 교체했다. 제품 표시 문구는 아래 확정안을 반영했다. R03의 진행 보고 간격·질문 대기 규칙과 런타임의 별도 대기 지침은 변경하지 않는다. architecture의 검색·본문 전달·제품 문구·검증 연결 계약을 갱신했다. 전체는 154행·17,842 bytes, SHA-256 `c6de8b972e752a9c7a16741b1aa5b7ab3fdd19c7bfa7920f9ffe68de538c71c5`이며, R01–R04와 R06 bytes는 수정 전과 동일하다.

사용자는 병렬 호출 결과 확인과 echo/printf 출력 구분 규칙을 포함한 나머지 항목은 현행 유지로 확정했다. 이 두 문구에 대한 앞선 완화 제안은 적용하지 않는다. 테스트 상세 절은 `implementation` 스킬 7절과 중복되어 위와 같이 적용 지침 연결로 축약했다. 스킬은 조건부 로드되므로 별도 지침이 항상 제공된다고 단정하지 않는다.

제품 표시 문구에 대한 사용자 설명은 “세련된 디자인” 같은 디자인 요구를 실제 화면 텍스트로 옮겨 제품 품질을 해치는 반복 문제다. 사용자는 “제품 화면에는 제품의 기능과 사용자 행동에 맞는 문구를 작성하세요. 디자인 방향과 품질 요구는 제작 기준으로 적용하고, 그 표현 자체를 화면에 넣는 것은 사용자가 표시 문구로 지정한 경우로 한정하세요.”를 확정했고 기존 제품 관련 한 불릿을 이 문구로 교체했다. 사용자가 반복 관찰했다고 보고했으며 이번 작업에서 재현·빈도 실험을 한 것은 아니다. 문구 반영·source 검사 통과와 실제 모델 행동·화면 검수의 효과를 구분한다.

병렬 문구는 `engine/codex-rs/prompts/src/model_instructions.rs`의 `COMMON_PARALLEL_TOOL_GUIDANCE` exact-match API 투영과 연결되어 있다. 후속 승인으로 해당 문구를 바꾸면 API 대체 문구·관련 검증도 함께 대조해야 한다. 현재는 병렬 문구를 수정하지 않았다. ECMAScript Promise.allSettled 명세와 GitHub CLI `gh pr create`의 `--body-file` 공식 문서를 조사했으며 외부 게시·메시지 전송은 수행하지 않았다.

Windows x64에서 retained `common-instructions` bundle을 최신 확정 변경에 대해 plan/run했다. 실행은 `node --test scripts/test-common-agent-instructions.cjs`, actual exit 0, 5/5 통과, producer_completed=true, integrity valid다. run ID는 `run-45928-1312-1792426349201133800`, bounded 로그는 `tool-call:exec-c26d26d1-e010-4d28-a9a7-63b00f658baf:step-5b7314565fd7a026b66169e24b53c408ac63a89e29db4bec7efa49fbd69c55ad`다. 사본 동일성 및 이전 prompt를 역구성한 SHA-256 대조로 이번 제품 표시 문구 한 불릿 외의 변경이 없음을 확인했고, scoped `git diff --check`도 exit 0이다. 별도 테스트·로그·백업·프로필·빌드·설치 산출물을 만들지 않았다. 최신 source preflight에서도 아래 알려진 thread_processor.rs 불일치가 남아 있음을 확인했다.

출처 preflight에서 공유 SOURCE hash는 `eed776104d75625f69b2d79493261eb445678ca7dac6a7253ba2361084fd3a47`로 바뀌었고 originalReceipt는 기존 immutable baseline과 같았다. R01·R02 prompt hash는 이미 공유 receipt에 기록되어 있었다. 이전에 불일치한 네 경로 중 thread-store 세 경로는 현재 기록과 일치했지만 `codex-rs/app-server/src/request_processors/thread_processor.rs`는 기록된 hash `a350c38adab0a2b745c8c1d7545f2f47853971870a91dc59e24858c8f111dc37`와 실제 `948b40bfd165fbcd37f272cfc9ced262b39b35b9ced956b78f35b51a3ccbced8`가 여전히 달랐다. 이는 전체 inventory의 미기록 경로가 이 하나뿐이라는 검증은 아니다. 알려진 선행 불일치가 남아 있으므로 실패할 recorder 전체 실행을 반복하지 않고, 해당 소유 작업에서 정합화한 뒤 이번 prompt 한 경로를 기록하는 순서를 유지한다. 공유 SOURCE를 수정하거나 다른 작업을 stage/commit하지 않는다.

## 범위의 정의와 기준

여기서 검토할 시스템 컨텍스트는 단일 system 문자열보다 넓다. Azrael이 구성하는 기본 지침, developer 지침, AGENTS·환경 등 자동 주입 메시지, 도구 선언, 도구 검색 후 추가되는 정의, 스킬을 읽었을 때 들어오는 지침, 조건부 상태 안내를 포함한다. 원래 메시지 role·내용 종류·producer를 기록하고 전부 system이라고 재분류하지 않는다.

다음 세 층을 연결한다.

1. **원문과 구성 규칙:** 유지보수 원본, 엔진 내장 사본, Rust 상수·템플릿, 확장·도구 정의.
2. **요청에 실제 포함되는 내용:** 프로필·기능 플래그·권한·현재 registry·검색 이력·로드한 스킬에 따른 렌더링과 projection.
3. **전송 표현:** OpenAI Responses/Responses Lite, managed provider, Anthropic 호환 도구, 사용자 API, Devin의 role·이름·스키마 변환과 추가 envelope.

서버·provider가 내부적으로 추가하면서 로컬 원문을 제공하지 않는 내용은 원문 미확보로 표시한다. 저장소에 있는 오래된 모델별 prompt 파일이나 비활성 플러그인 전체를 현재 요청에 포함된 것으로 세지 않는다. 실제 사용자 대화·파일 본문·도구 실행 결과의 임의 데이터는 전부 번역하지 않지만, 그 데이터를 둘러싼 자동 안내·경고·wrapper·입력 형식은 검토한다.

소스 기준은 `docs/ops/development.md`가 선택하는 현재 `engine/`이다. `upstream/codex`와 과거 release snapshot은 현재 기준이 아니다. 조사 시 `core/src/session/world_state.rs`에 기존 미커밋 변경이 있어, 후속 원문 고정 시 작업 공간 bytes와 revision을 함께 기록해야 한다. 다른 작업의 변경은 수정하지 않았다.

## 조사에서 확인한 구성

| 구분 | 확인한 사실 | 원문·구성 소유자 |
| --- | --- | --- |
| 공통 행동 | R01 수정 후 `agent_behavior.md` 156행, UTF-8 18,111 bytes. 권한·대화·서식·도구 작업·스킬·앱·플러그인 지침을 포함 | `engine/codex-rs/prompts/src/model_instructions.rs`, `prompts/templates/agent_behavior.md` |
| 프로필 합성 | 프롬프트 3종·도구 2종. provider의 실제 식별자로 도구 적합성을 판단 | `engine/codex-rs/config/src/harness_profiles.rs`, `prompts/src/model_instructions.rs` |
| 추가 내장 원문 | `prompts/templates/` 아래 Markdown 24개. XML review 종료 템플릿과 Rust 문자열은 이 개수에 별도로 존재 | `engine/codex-rs/prompts/` |
| 초기·상태 변경 주입 | 권한, 협업, 환경, 앱·플러그인, 도구, 역할·협업 정책, 모델 목록, 유지보수, managed 지침 및 확장 contribution | `engine/codex-rs/core/src/session/world_state.rs`, `core/src/context/` |
| 도구 구성 | registry에서 프로필·policy·exposure를 적용하고 직접·Code Mode·deferred 정의를 구성 | `core/src/tools/spec_plan.rs`, `registry.rs`, `router.rs` |
| Code Mode | `exec`·`wait` 안내, helper, MCP 공통 타입, 중첩 도구 설명·TypeScript 선언 | `engine/codex-rs/code-mode-protocol/src/description.rs`, `core/src/tools/code_mode/` |
| 모델별 동적 덮어쓰기 | 일부 도구 설명·스키마, Code Mode 문구, 협업 모드 문구는 모델 catalog override를 받을 수 있음 | `engine/codex-rs/prompts/src/model_messages.rs`, `model_messages/collaboration.rs` |
| 스킬 | 카탈로그 소개·사용법·alias와 선택된 본문은 서로 다른 컨텍스트이며 on-demand 참조를 구분 | `engine/codex-rs/ext/skills/src/{catalog_prompt,host_prompt,render,world_state_catalogs}.rs` |
| 작업 프로필 | persistent 지침, on-demand context, extra skill roots, 역할 파일과 harness binding을 task snapshot으로 합성 | `scripts/task-profile-runtime.cjs`, `scripts/instruction-package.cjs` |
| 요청 투영 | 최신 타입 지침 유지, 동일 스킬 본문 재사용, 모델·provider 전환, API 도구 축약·필터링 등이 요청 사본에 반영 | `core/src/context/instruction_state_projection.rs`, `providers/opencodex/inference-mapping.mjs`, `providers/devin/mapping.mjs` |

유지보수 사본은 `instructions/instructions/agent-behavior.md`와 같은 경로에 있다. 검토 시 원본·내장 사본의 동일성을 확인하고, 같은 내용은 한 번 번역해 여러 출처에 연결한다. 과거 조사 `work/BW-01-openai-profile-context-analysis/01-plan.md`의 코드 경로와 중복 비용 구분을 참고했으며, 그 기록의 수정 전 결론을 현재 동작으로 재사용하지 않는다. 현재 계약은 `docs/architecture/model-harness-profiles.md`와 현재 소스를 기준으로 한다.

사용자 홈의 `C:/Users/felre/.azrael-ex/config.toml`에서는 `[harness]`·legacy named profile·inline instruction override가 발견되지 않았고, 같은 홈의 `*.config.toml`도 없었다. 이는 해당 파일들에 관한 결과이며 프로젝트·managed layer·대화 snapshot의 전체 유효 설정을 증명하지 않는다. 설치 역할 파일 `luna_explorer.toml`, `sol_executor.toml` 두 개를 확인했다. 사용자 설정의 인증정보는 수집하지 않았다.

## 프로필별 검토 행렬

프롬프트 프로필·도구 프로필·조합 프로필·named config profile·작업 프로필·에이전트 역할은 구별해서 기록한다.

| 프롬프트 | Azrael 도구를 쓰는 provider | Anthropic의 Claude 도구 | 검토 포인트 |
| --- | --- | --- | --- |
| `builtin/azrael-default` | 공통 행동. 사용자 행동 템플릿이 없는 기본 분기는 별도 runtime core를 덧붙이지 않음 | runtime core + Claude용으로 이름을 치환한 공통 행동 + Claude 도구 환경 | 기본과 Anthropic용 렌더링의 차이 |
| `builtin/anthropic-default` | runtime core + 공통 행동 | runtime core + Claude용으로 이름을 치환한 공통 행동 + Claude 도구 환경 | 기본 조합 외 선택도 빠뜨리지 않음 |
| `builtin/claude-lean` | runtime core + lean 행동 | runtime core + lean 행동 + Claude 도구 환경 | 짧은 행동의 생략·의무 차이 |
| 사용자 상속·행동 템플릿 | 선언된 행동 템플릿으로 behavior 교체, 별도 runtime 지침 유지 | 같은 교체 규칙과 Claude 도구 환경 유지 | 선언 layer, 상속, custom suffix, 실제 합성 결과 |

위 3×2는 프로필 구성상 검토할 조합이며 도구는 provider 적합성을 지켜야 한다. Anthropic은 `builtin/claude-code-core`, 그 외 provider는 `builtin/azrael-default` 도구를 사용한다. Claude라는 모델명만으로 Claude 도구가 선택되지는 않는다. 도구를 고정한 경우 `azrael-default`와 `anthropic-default`의 Claude 렌더링이 같은 분기를 타므로, 동일 원문은 재번역하지 않고 조합 행을 연결한다.

추가로 provider·model binding 우선순위, config layer와 사용자 템플릿, 작업 프로필의 persistent 지침·참조·역할, root/child와 built-in/configured 역할을 검토한다. 전체 모델명마다 공통 원문을 반복하지 않고 최종 렌더링과 도구 계약이 다른 경우를 구분한다.

## 도구 컨텍스트 전수 검토의 범위

도구 하나의 완료 조건은 이름만 번역하는 것이 아니다. namespace 설명, 전체 도구 설명, 각 parameter의 description·type·required·기본값·enum·제한, 반환·실패·비동기 완료 안내, freeform grammar와 예제, 직접/중첩/검색 노출 경로 및 provider 변환을 함께 확인한다. 식별자와 스키마 값은 원형을 보존한다. 구현에서만 생기는 계약은 원문 직역과 분리한 검토 메모로 기록한다.

아래는 2026-10-18 이번 조사에서 `ALL_TOOLS`로 확인한 **현재 대화의 중첩 카탈로그**다. Azrael 제품 전체에 고정된 숫자도, 한 요청에 모든 전체 스키마가 동시에 들어간다는 뜻도 아니다.

| 그룹 | 항목 수 |
| --- | ---: |
| native nested 도구: 파일·명령·목표·프로젝트 관리·MCP resource 등 | 15 |
| clock | 1 |
| image_gen | 1 |
| azrael_window | 26 |
| node_repl | 3 |
| web | 1 |
| ChatGPT Space | 35 |
| Figma | 48 |
| GitHub | 89 |
| Google Drive | 45 |
| Pets | 11 |
| Plugin Management | 6 |
| Search Service | 1 |
| Topview | 254 |
| Vercel | 235 |
| **합계** | **771** |

앱 도구 소계는 724개다. 카탈로그 `description` 문자열 합은 JavaScript 문자열 길이 기준 1,054,640이며 일부에는 선언·스키마가 함께 들어 있다. 이것은 토큰 수나 실제 요청 크기가 아니다. 여기에 집계되지 않은 직접 노출 `functions.exec`·`functions.wait`·질문 도구, `clock.sleep`, 에이전트 협업·대기·완료 도구 선언도 별도로 목록화해야 한다. 소스에 있으나 현재 꺼진 도구, 다른 프로필 전용 도구, 서버 쪽 hosted 도구와 동적 도구도 포함 여부·노출 조건을 표시한다.

Native 검토 묶음은 다음과 같다.

- 실행·파일·미디어: `exec_command`, `write_stdin`, `apply_patch`, `view_image`, 권한 요청, 셸의 OS별 안내.
- 질문·계획·시간·컨텍스트: 동기/비동기 질문, 계획, 시각·sleep, 남은 컨텍스트·새 window, 환경 대기와 사용자 비동기 안내.
- 협업·대기: spawn·메시지·follow-up·중단·목록·대기·부모 요청 응답·root resume·work completion 및 모델/역할 목록.
- 유지보수: inventory·tests·build·cleanup review/apply의 공통 설명과 action별 차이.
- 확장: goals, skills, memories, history notes, agent message board, web search, image generation 및 MCP·plugin discovery.
- Claude 호환 12종: `Read`, `Edit`, `Write`, `Bash`, `TaskOutput`, `TaskStop`, `Grep`, `Glob`, `Agent`, `Skill`, `ToolSearch`, `AskUserQuestion`.
- 외부 도구: 현재 9개 앱 그룹과 window/node MCP를 서버·기능군·도구별로 전수 확인. 공유 boilerplate를 한 번 검토해도 각 도구의 고유 설명·입력 계약은 모두 확인한다.

원격 도구의 원문은 registry에서 확보하고 기능 실행 없이 검토한다. 검색 결과의 요약 설명만으로 전체 schema 검토를 완료하지 않는다. 현재 제공되지 않은 원문은 미확보로 남긴다. 비활성·미설치 연결은 현재 제공 여부와 구별한 보충 목록에 두며, 번역을 위해 연결·설치·계정 작업을 자동 수행하지 않는다.

## 권장 검토 순서와 분할

| 순서 | 단위 | 내용 | 예상 분할 기준 |
| --- | --- | --- | --- |
| 0 | R00 | 기준 source·profile·catalog와 포함 조건, 요청 role/순서 지도 | 번역 시작 전 원문 identity와 항목별 검토표 확정 |
| 1 | R01–R06 | 공통 행동 | 아래 6개 의미 구간 |
| 2 | P01–P03 및 차이 항목 | runtime core, Anthropic 치환·도구 환경, lean와 사용자 템플릿·6조합 | 서로 다른 고유 본문만 번역하고 모든 조합에 연결 |
| 3 | C 단위 | 권한·sandbox/approval, Default/Plan, persistent, 환경·날짜·OS, AGENTS·managed·task 지침 | 한 정책·한 조건 분기씩 |
| 4 | A 단위 | root/child 역할, 협업 허용 모드, 부모 요청, root coordination, 모델 목록 | 역할·운영 계약별 |
| 5 | T00 단위 | 도구 공통 구조, exec/wait·helper·MCP 타입, 직접/중첩/deferred·ToolSearch | 도구를 읽는 데 필요한 공통 계약부터 |
| 6 | T native·Claude 단위 | 모든 native·확장 도구와 Claude 호환 12종 | 짧은 관련 도구 3–5개, 긴 도구 1개 |
| 7 | T external 단위 | 외부 서버·앱별 전 도구 | 기능군을 나누고 각 도구 고유 설명과 schema 검토 |
| 8 | S 단위 | 스킬 목록·사용법·alias, 앱·플러그인 정책, 로드된 SKILL과 관련 참조, 작업 프로필 resource | catalog와 실제 읽은 본문을 분리 추적 |
| 9 | E 단위 | 모델/provider 전환, projection·제거 안내, compaction·budget·hooks·memory·goal·중단·오류 wrapper | 상태 변화별 전/후에 남는 안내 확인 |
| 10 | G 단위 | Guardian·classifier·review·realtime 등 별도 모델 요청의 지침·도구 | 일반 대화와 요청 수신자를 구분해 검토 |
| 11 | V 단위 | provider별 전송 표현과 최종 누락 검사 | 각 고유 본문·도구·조건을 전수 검토표와 대조 |

공통 행동의 첫 분할은 현재 파일의 행 범위를 따른다. 원문 변경 시 다시 구간을 맞춘다.

| ID | 원문 구간 | 주제 |
| --- | --- | --- |
| R01 | `agent_behavior.md` 1–12행 | 작업 권한과 완료 |
| R02 | 13–46행 | 협업·소통·문체·기술 설명·PR 설명 |
| R03 | 47–70행 | 사용자와 대화·비동기 질문·중간 보고 |
| R04 | 71–99행 | 최종 답변·서식·시각화 |
| R05 | 100–111행 | 작업 도구·검색·병렬 호출·검증 규칙 |
| R06 | 112–154행 | 스킬·앱·플러그인 사용 |

R01·R02·R05는 변경·유지 사항이 확정됐고 승인된 수정을 원본과 내장 사본에 적용했다. R03의 47–70행과 R04의 71–99행은 현행 유지로 확정했다. R06은 이번 응답에서 112–154행을 직역하며 제시만으로 사용자 검토 완료로 처리하지 않는다. 현재 원문 범위와 hash는 위 R05 절을 따르며 원본·내장 사본은 byte 동일하다.

한 번에 한 단위를 제시한다. 원문 약 300–600단어를 기본 상한으로 삼고 조건·규칙이 밀집하면 더 짧게 나눈다. 행 수가 짧아도 긴 문단은 분할하며, 도구 한 개가 길면 설명·parameter·예제 단위로 나누되 조건·예외를 다음 회차에서 누락하지 않게 연결한다. 회차는 확정하지 않는다. 771개를 단순히 5개씩만 나누어도 155묶음이므로 외부 도구까지 10–20회로 끝난다고 약속할 수 없다. 공통 boilerplate의 동일성 대조와 고유 본문 크기별 분할 후 실제 회차를 산정한다.

초기 검토는 공통 행동 → 프로필 차이 → 권한·역할 → 도구 공통 계약 → 전수 도구 순서를 권장한다. 뒤에서 스킬 본문·특수 요청을 마저 다루고 전송 표현의 최종 대조로 닫는다. 이 순서는 이후 검토에서 바꿀 수 있다.

## 매 회차의 제공 형식과 진행 상태

각 단위는 ID, 원문 파일·행 또는 registry 항목, source/hash와 적용 프로필·조건·role을 짧게 표시한다. 이어 원문의 순서·단락·불릿에 맞춘 한글 직역을 제공하고, 원문 대조가 필요한 부분을 병기한다. 요약으로 대체하지 않는다. `must`·`should`·`may`, 금지·예외·부정·수량·시간·기본값과 조건 범위를 유지한다. 코드·tool/parameter 이름·enum·경로·tag·placeholder·grammar는 그대로 둔다.

검토 메모는 직역과 분리한다. 의미 모호함·다른 지침과 충돌·과도한 반복·구현 불일치를 근거와 함께 적고 수정안은 요청된 경우에 별도로 제시한다. 원문의 문제를 번역 중 조용히 고치지 않는다. 이미 한글인 원문은 재번역하지 않고 원문 검토 대상으로 남긴다.

항목별 상태는 `원문 미확보 / 미제시 / 제시함 / 사용자 검토 완료 / 수정 논의 중 / 조건부 비활성`로 구분한다. 제시했다고 사용자 검토 완료로 처리하지 않는다. 반복 본문은 같은 원문 hash의 선행 단위를 참조하되, 실제 포함 횟수·위치·역할과 각 조합·각 도구의 연결은 남긴다. 프로필·도구가 바뀌면 영향을 받은 단위만 다시 확인한다.

## R02 성격 지침 비교 조사

2026-10-18 사용자 요청에 따라 공개 1차 자료와 공식 배포본을 읽기 전용으로 비교했다. 제품 지침 변경이나 모델 호출·성능 실험은 이번 조사에 포함하지 않았다. 아래는 전체 system prompt의 동등한 공개를 뜻하지 않으며 공개 예시·문서·버전이 고정된 배포 문구를 구분한다.

- Codex: [공식 Codex Prompting Guide](https://developers.openai.com/cookbook/examples/gpt-5/codex_prompting_guide)의 Friendly/Pragmatic 구분을 확인했다. Friendly는 공감·협력·팀의 진행을, Pragmatic은 짧고 직접적인 실행 정보와 진행을 강조한다. 로컬 upstream의 `codex-rs/core/templates/personalities/gpt-5.2-codex_{friendly,pragmatic}.md`도 대조했으나 이를 Azrael 현행 원본이나 모든 최신 모델의 실제 payload로 취급하지 않는다.
- Claude Code: [공식 출력 스타일 문서](https://code.claude.com/docs/en/output-styles)에서 Default는 추가 스타일 없이 표준 system prompt를 사용하며, Proactive/Concise/Explanatory/Learning과 custom style을 지원함을 확인했다. active style은 매 요청에 전달된다. 실제 `# Tone and style`과 `# Professional objectivity`는 [공식 npm 2.0.0 배포본](https://registry.npmjs.org/@anthropic-ai/claude-code/-/claude-code-2.0.0.tgz)의 `package/cli.js`를 메모리에서 읽어 확인했다: 간결·직접적 답변, 사용자 믿음의 확인보다 정확성과 진실성, 필요한 반론과 존중하는 정정이다. 조회 당시 latest 2.1.302와 추가 확인한 2.1.118 npm archive에는 cli.js가 없어 이 문구를 현재 버전의 동일 원문으로 단정하지 않는다. 다운로드한 archive는 디스크에 저장하거나 실행·설치하지 않았다.
- Grok Build: [공식 prompt.md](https://github.com/xai-org/grok-build/blob/07e35a3dfeed2f200d319ef6c893b5ea286d9a51/crates/codegen/xai-grok-agent/templates/prompt.md)의 communication 절은 명확한 완전한 문장, 직접·간결한 설명, 사용자 말투·이해도에 맞추기, 답 먼저 제시하기 등 관찰 가능한 작성 행동을 규정한다. 이 공개 base template에는 독립적인 Personality 절이 없다. 별도 provider 내부 지침까지 없다는 결론은 내리지 않는다. 파일 최신 commit은 2026-09-22다.
- Grok 채팅: [공식 Grok 4.1 thinking template](https://github.com/xai-org/grok-prompts/blob/a7c186f5ccac95875c0041aed60398f6ecb6d6c7/grok4p1_thinking_system_turn_prompt_v2.j2)은 도움·진실 추구, flirtatious/playful 금지 및 조건부 custom_personality 삽입을 명시한다. 공개 파일 commit은 2025-11-17이며 현재 서비스 전체의 실전송 원문을 보증하지 않는다. Grok Build와 채팅 제품을 혼합하지 않는다.

사용자는 비교 조사 후 성격 서술을 구체적인 협력·실행·객관성 기준으로 바꾸는 위 R02 수정안을 확정했다. 기존 성격 문단 자체가 능률 하락의 원인이라는 비교 실험 근거는 확보하지 않았다. [Anthropic 공식 프롬프팅 지침](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices)은 원하는 행동을 긍정적으로 지정하는 방식을 권장하지만, 이를 모든 모델에 대한 성능 보장으로 확대하지 않는다.

사용자 검토 기준은 간결·직접·요점 중심, 사용자의 믿음 확인보다 기술적 정확성과 진실성 우선이다. 공감의 강조는 불필요하며 적극적인 협력, 제한 내의 능동적인 문제 해결과 결과 지향을 중시한다. Claude·Grok 관련 내용의 번역 요청 자체는 제품 변경 권한으로 취급하지 않았고, 이후 R02 반영의 명시적 승인을 받았다.

번역 범위는 Grok Build의 `work_policy`·`communication`·`formatting` 전체와 Grok 4.1 채팅의 성격·응답 스타일 문구다. Build 라이선스는 Apache-2.0, 채팅 prompt는 AGPL-3.0이다. Claude 2.0.0의 `package/LICENSE.md`는 Anthropic PBC의 All rights reserved 및 Commercial Terms 적용을 명시한다. 사용자에게서 제공받지 않은 해당 절 전체 번역 대신 Tone and style·Proactiveness·Professional objectivity를 요약하고, 사용자가 원문을 제공하면 전체 변환 가능함을 설명한다. 배포본은 메모리에서만 읽었으며 실행·설치·디스크 저장하지 않았다. PowerShell Python stdout의 cp949가 저작권 기호 출력에서 실패한 첫 조회는 UTF-8 stdout으로 재실행하여 실제 라이선스를 확인했다.

## 이후 원문 확보와 완료 판정

R00에서 이 계획에 연결된 항목별 검토표를 만들고 다음 정보를 고정한다: source revision과 dirty bytes/hash, 설정 layer·실제 provider/model·prompt/tool profile fingerprint, 기능·권한·OS, raw/렌더링/전송 단계, 도구 직접/중첩/deferred 목록 및 발견 후 full schema, 스킬 catalog와 로드한 본문, 외부 catalog 취득 시점. 스냅샷·실행 로그가 필요하면 `artifacts/tasks/<work-id>/runs/<run-id>/`를 쓰고 생성 전에 소유자·출력·소비자를 기록한다. 현재 계획 작성에서는 대형 원문 덤프나 테스트 생성물을 만들지 않았다.

가능한 범위에서 기존 native/helper fixture의 payload와 유지보수 사본 비교를 재사용한다. 현재 소스에 대한 정적 조사, fixture 렌더링, 실제 설치 앱의 요청, 실제 provider 전송은 각각 다른 증거로 남긴다. 전체 유료 모델 호출은 조사·번역의 기본 전제가 아니다. 원격 서버가 제공하지 않는 내부 지침이나 연결이 없는 schema는 검증 완료라고 표시하지 않는다.

이번 계획의 완료 조건은 컨텍스트 생성 소유자 식별, 프로필·도구·조건부/별도 요청 범위 정의, 실제 규모 확인, 읽을 수 있는 첫 분할과 후속 순서 수립이다. 현재 조사로 충족했다. 번역 검토 전체의 완료 조건은 다음과 같다.

1. 모든 고유 원문과 각 도구의 설명·입력 계약이 검토표의 단위에 연결되고 미제시 항목이 없다.
2. 프로필별 조합·역할·권한·OS·동적 전환의 차이가 확인되며, 비활성·미확보 항목을 숨기지 않는다.
3. 실제 제공되는 범위의 원문과 번역을 문장·parameter 단위로 대조해 조건·예외·수치·식별자의 누락이 없다.
4. 도구 발견 전/후와 provider 변환 후에도 검토한 내용의 대응 관계가 남는다.
5. 사용자가 검토 완료한 범위와 수정 논의·원문 미확보 범위를 구분하고, 필요한 수정은 별도 실행 권한과 검증 범위로 다룬다.

R01 변경은 owning architecture의 work intent 절과 기존 `engine.model-harness-profiles` feature owner 목록에 연결했다. 실제 설치본은 엔진 내장 prompt를 사용하므로 이번 source 수정만으로 실행 중인 앱이 갱신되지는 않는다. native 테스트·제품 빌드·설치·실서버 검증은 실행하지 않았다.

범위 조사에서 Markdown 템플릿 24개, 유지보수 원문과 내장 사본 6쌍의 byte 동일성, 참조 소유 파일의 존재를 확인했다. 현재 중첩 카탈로그의 771개 이름은 서로 중복되지 않으며 앱 소계 724개와 그룹 합계를 대조했다.

R01 적용 후 `project_tests`의 `common-instructions` bundle을 plan/run했다. 실행은 `node --test scripts/test-common-agent-instructions.cjs`, Windows x64, 실제 exit 0, 5/5 통과다. run ID는 `run-45928-732-1792305449471693000`이며 앞뒤 declared input integrity는 valid, producer_completed=true다. bounded 로그는 `tool-call:exec-304a44a8-191a-44a0-818b-f4a4ccefca16:step-e89d9f3e2945054ba89720ed111d47edf6d00fa042586a6b1ee90a6d86c8aa0a`에 있다. 이 retained bundle은 변경·삭제하지 않는다. 별도의 task payload·raw 로그 파일이나 테스트용 프로필을 생성하지 않았다.

R01 적용 당시 추가 대조 명령은 exit 0이었다. 156행 전체를 덮는 6개 연속 구간, 두 prompt 사본의 byte 동일성, 당시 수정 전 HEAD와 R02–R06의 완전 동일성, feature owner 연결을 확인했다. R01 적용 시 공통 prompt SHA-256은 `4e1c1e5589de45fd65aaa919d1925f7f25d20ca781ec5f3ad848b599098fdd62`이며 최신 문구·hash는 위 R02 절을 따른다. scoped `git diff --check`는 exit 0이며 source check 통과를 실제 모델 능률·행동 또는 설치 앱 수용 검증으로 확장하지 않는다.

기존 `validateManifest`를 호출한 feature inventory 검증도 exit 0이다. 기존 inventory의 provider handoff·window 관련 다른 hunk 6줄은 그대로 보존하고, 이번 변경 소유권은 공통 prompt owner 2줄로 한정한다.

R02 반영 후 공식 출처 recorder는 native session `99386`, actual exit 1로 종료했다. 최초 원인은 `Reviewed delta differs`이며 이번 expected 경로는 `codex-rs/prompts/templates/agent_behavior.md` 하나다. 실제 delta에는 그 외 `codex-rs/app-server/src/request_processors/thread_processor.rs`, `codex-rs/thread-store/src/local/history_revision.rs`, `codex-rs/thread-store/src/local/mod.rs`, `codex-rs/thread-store/src/store.rs` 네 경로가 더 있었다. R01 때와 동일한 불일치다. 이 파일들의 변경 소유권·검토 권한을 이번 문구 수정으로 확대하지 않으며, recorder가 기록하기 전 종료했으므로 SOURCE를 직접 보정하지 않는다. 원래 shared SOURCE/다른 source 변경과 staging을 보존한다. 이 4개 delta가 해당 작업에서 정합화된 뒤, 최신 current receipt hash로 prompt 한 경로를 다시 기록하고 작업 커밋을 완료한다. 현재는 프로젝트의 작업 단위 커밋 규칙에 따라 source metadata를 임의 분리하지 않고 커밋 대기 사유를 보고한다. 제품 빌드·설치는 이 출처 기록 정합화 이후 별도 권한으로 진행해야 한다.
