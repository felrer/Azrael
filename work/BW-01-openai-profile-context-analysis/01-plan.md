상태: 소스 구현·관련 Windows 검증·생성물 보존 결정 완료. 작업 변경만 로컬 커밋하며, 실행 중인 앱의 빌드·설치는 별도 범위이다.

# OpenAI 모델 프로필의 컨텍스트 중복 분석

## 요청과 범위
OpenAI 모델 프로필 사용 시 도구 및 지침의 중복 입력과 컨텍스트 낭비 여부를 분석하고, 사용자가 승인한 동일 프로필 지침 중복 방지를 구현한다. 소스 수정·관련 문서·회귀 검증과 로컬 작업 커밋을 수행한다. 제품 전체 빌드·설치·유료 API 호출은 포함하지 않는다.

공통 요청 구성 경로를 대상으로 Windows x64, Linux x64, macOS ARM64의 설계 범위를 구분한다. 실제 조사는 Windows 호스트의 현재 `engine/` 및 provider 소스에서 진행하며 설치된 실행 파일과 실전 요청의 동일성은 별도 확인 없이는 주장하지 않는다.

## 조사 순서와 완료 조건
1. harness profile 선택 및 프롬프트 합성에서 중복 여부를 추적한다.
2. 도구 registry → Code Mode → OpenAI 요청 직렬화를 추적하고 정의·설명·history의 반복을 구분한다.
3. 기존 테스트와 스냅샷으로 근거를 보강하고 원인, 영향, 권장 조치와 미검증 범위를 기록한다.

결론은 확인된 코드 경로와 연결하고, 토큰 수·과금·실행 중 상태에 관한 미확인 수치를 만들지 않는다. 분석 작업이므로 제품의 영구 설계 문서는 변경하지 않는다.

## 수정 전 분석 결과

### 기본 OpenAI 도구를 두 벌 등록하는 근거는 발견되지 않음

- `engine/codex-rs/config/src/harness_profiles.rs::resolve`는 선택 필드를 덮어써 하나의 immutable profile로 해석한다. OpenAI는 기본적으로 `builtin/azrael-default` 도구를 쓰며 Claude 도구 선택은 provider 적합성 검사로 차단한다.
- `engine/codex-rs/prompts/src/model_instructions.rs::compose_harness_instructions`의 기본 OpenAI 분기는 `compose_agent_instructions`로 바로 돌아간다. 별도의 runtime core나 Claude tool environment를 추가하지 않는다. 정확한 공통 접두사가 있는 custom 지침은 다시 덧붙이지 않는다. 임의 위치에 사용자가 복사한 내용까지 의미적으로 중복 제거하지는 않는다.
- 로컬 `models-manager/models.json`의 `gpt-6.1-sol`, `gpt-6-astra`, `gpt-6-luna`는 `code_mode_only`, `use_responses_lite=true`이다. 이는 소스 카탈로그이며 서버가 실제 선택한 동적 모델 정보의 증명은 아니다.
- `core/src/tools/spec_plan.rs::is_hidden_by_code_mode_only`와 `build_model_visible_specs`는 nested 도구의 직접 선언을 제외한다. `code-mode-protocol/src/description.rs::build_exec_tool_description`는 code-mode-only일 때 nested 도구 설명을 exec 설명에 렌더링한다. 일반 CodeMode는 enabled 도구 전체 설명을 렌더링하기 전에 반환한다. direct-only namespace는 exec에서 제외한다.
- `core/src/client.rs`는 Responses Lite에서 `AdditionalTools`를 input에 추가하고 최상위 `tools=None`으로 만든다. 일반 Responses는 최상위 tools를 사용한다. 이 두 경로는 상호 배타적이다.
- `core/src/tools/registry.rs`는 동일 ToolName 중복 등록을 거절하고, `tools/src/code_mode.rs`는 정렬 후 이름 기준 dedup을 수행한다. managed mapper도 duplicate_tool_identity를 거절하고 historical additional_tools를 도구로 재등록하지 않는다.

### 실제 중복 지침 경로: 같은 행동을 쓰는 모델 사이의 전환

`core/src/session/world_state.rs`는 현재 profile의 공통 행동 전체를 `ModelInstructionsState`에 제공한다. `context/world_state/model.rs::render_diff`는 행동 fingerprint 대신 model slug가 바뀌었는지로 판단하며, 바뀌면 `ModelSwitchInstructions`를 developer 메시지로 만든다. `core/src/session/mod.rs::record_step_world_state_if_changed`는 이를 대화에 추가한다. 따라서 동일 기본 profile의 OpenAI 모델 A→B에서도 기존 base 지침과 같은 행동 본문을 다시 넣는다.

`context/instruction_state_projection.rs::replaceable_kind`에는 `model_switch.instructions`가 없어 이 일반 projection이 과거 switch 지침을 최신 하나로 줄이지 않는다. 압축·롤백 등 별도 이력 변화가 없는 동안 전환 지침이 남을 수 있다. `model_switch_instructions.rs`의 wrapper까지 추가된다. 실제 대화의 전환 횟수와 토큰 수는 측정하지 않았다.

현재 공통 행동 파일 `prompts/templates/agent_behavior.md`는 18,430 UTF-16 code units(주로 ASCII), UTF-8 18,436 bytes이다. 이는 문자열 크기이며 토큰 수가 아니다. 기본 설정·update_plan 제거 등 요청별 투영에 따라 실제 본문은 달라질 수 있다.

### 중복과 구분해야 할 컨텍스트 비용

Code Mode의 exec 설명에는 즉시 사용 도구의 설명과 TypeScript 입력 타입, 공통 MCP 타입과 사용 지침이 들어간다. 직접 tool schema를 숨겨도 모델이 도구 사용법을 알아야 하므로 이 비용은 남는다. deferred 전체 목록은 현재 description 함수의 `_deferred_tools` 인자가 렌더링에 사용되지 않으며, discovery 지침으로 처리된다.

`IncrementalTools`는 현재 소스 feature 기본값이 false이다. 켜진 컨텍스트에서는 `TopLevelToolsState`가 바뀐 선언만 내보내고 `turn.rs`가 별도 tools 및 base_instructions를 비운다. 꺼진 경우 매 요청 카탈로그를 다시 전송하지만 이것만으로 한 요청 안에 두 벌이 누적된다는 뜻은 아니다. 카탈로그 변경 시 거대한 exec 설명 자체가 변경되어 재선언될 가능성은 남는다.

OpenAI 공식 문서상 callable function definitions는 입력 토큰과 컨텍스트 한도에 포함된다. prompt caching은 공유 prefix의 계산을 재사용하는 방식이므로 정의 제거 또는 컨텍스트 점유 제거와 구분해야 한다.

## 권장 조치

1. 우선 검토: 모델 식별자 변경과 행동 템플릿 변경을 분리해, 동일 행동이면 model switch에 공통 본문을 재삽입하지 않는다. 행동 변경 시에는 producer-typed 최신 상태 projection으로 제한하는 방안을 검토한다. 도구권한과 model identity 공지는 보존해야 한다.
2. 실제 요청의 구성별 크기·중복 해시를 내용 노출 없이 계측한 뒤 exec 설명, schema와 예제, 즉시 노출 도구 범위를 최적화한다. token savings는 실제 계측 전 수치로 주장하지 않는다.
3. 사용자 custom 행동 템플릿에는 도구 스키마/카탈로그를 복사하지 않도록 한다. 자동 생성 도구 환경과 사용자 명시 지침의 provenance는 보존한다.

동일 프로필의 지침 재삽입 방지는 사용자 요청으로 승인되었다. 도구 설명 축약이나 노출 범위 변경은 이번 구현에 포함하지 않는다.

## 구현 계약과 순서

- 기존 `WorldStateHash`와 section snapshot을 재사용해 실제 렌더링한 행동 지침을 비교한다. 모델 slug가 달라도 지침이 같으면 재삽입하지 않으며, 같은 모델이라도 지침이 달라지면 갱신한다.
- 모델과 지침 hash를 snapshot에 기록한다. 구형 문자열 snapshot은 기존 역직렬화 경계에서 unknown 상태로 읽어 기존 보수적 fallback을 한 번 적용하고 새 snapshot으로 갱신한다. 지침을 출력하지 않은 정상 snapshot도 재시작 후 유효해야 한다.
- 첫 요청에는 저장된 초기 지침의 정확한 행동 접두사를 비교해 동일 행동이면 중복을 만들지 않는다. update_plan 제거와 줄바꿈을 비교 경계에서 일치시키며, retained legacy switch의 행동을 알 수 없는 경우에는 초기 지침만으로 동일하다고 추정하지 않는다.
- producer가 명시한 `model_switch.instructions`는 요청 사본에서 최신 기여만 유지한다. 사용자가 복사한 텍스트, 잘못된 role/provenance와 저장된 원본 대화는 보존한다.
- 구현 소유자는 root이며 core world-state/model 및 instruction projection, 관련 기존 검증 경로, owning architecture와 feature inventory만 수정한다. 다른 진행 중 변경은 보존한다.
- 공통 의미 적용 대상은 Windows x64, Linux x64, macOS ARM64이며 실제 native 검증 환경은 Windows이다. OS 전용 코드·UI·도구권한을 변경하지 않는다.
- 검증은 기존 world-state·instruction projection Rust 검사에 모델 간 동일 지침, 실제 지침 변경, snapshot 복원과 legacy fallback 사례를 추가해 수행한다. 유지되는 회귀 테스트는 이 계약을 보호하므로 보존한다. 컴파일과 실행 결과 및 생성물 정리는 아래 실행 근거에 기록한다.

## 수정 전 분석 검증과 한계

- 소스 호출 경로와 기존 fixture 내용을 교차 확인했다. `prompts/src/model_instructions_tests.rs`의 기본 profile 동일성, `core/src/tools/spec_plan_tests.rs`의 direct-only namespace/exec 분리, `context/world_state/top_level_tools_tests.rs`의 unchanged catalog 무출력, `context/world_state/model_tests.rs`의 slug 변경 시 재렌더링을 확인했다. 이번 작업에서 Rust 테스트 실행이나 새 native 실험은 하지 않았다.
- 기본 config의 model은 `gpt-6.1-sol`이었다. 현재 `codex` 프로세스 경로는 `artifacts/w14w/artifacts/releases/w14y/engine/codex.exe`; 해당 release의 build-info는 source root를 `artifacts/engine-input-AF01`로 기록한다. 그 source 디렉터리는 현재 존재하지 않아 현재 소스와 실행 바이너리의 관련 파일 동일성을 검증하지 못했다. 이 receipt만으로 지금 활성 요청이 현재 checkout과 같다고 주장하지 않는다.
- 실제 API payload, 입력/캐시 토큰, profile별 비교와 실행 중 전체 effective config는 수집하지 않았다. 프로필과 도구 중복의 코드상 경로 분석이며 설치 제품의 발생률·비용 측정은 아니다.
- 조사 환경은 Windows 로컬이다. 경로는 공통 코드이나 Linux/macOS 실행 검증은 하지 않았다.
- 제품 파일은 수정하지 않았다. 할당용 임시 본문 파일은 삭제하고 이 계획/분석 기록만 유지한다.

## 공식 근거

- [OpenAI Function calling — Token Usage](https://developers.openai.com/api/docs/guides/function-calling)
- [OpenAI Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)

## 구현 검증 진행

- 공통 지침/프로필 매핑: `node --test scripts/test-common-agent-instructions.cjs providers/opencodex/tests/harness-mapping.test.mjs` — 9/9 통과, exit 0. 로그: `artifacts/bwd2/evidence/source-mapping.log` (동일 SHA-256으로 보존 위치 전환).
- `rustup run 1.95.0 rustfmt --edition 2024 --config skip_children=true`로 model section과 그 테스트를 정리했다. `node --check scripts/check-model-harness-profiles.cjs`, `git -c core.whitespace=cr-at-eol diff --check`가 exit 0이었다. import 관련 stable rustfmt 경고는 기존 설정의 nightly 옵션에 대한 것이다.
- 첫 입력 고정 `artifacts/bwd1/engine` 이후 최초 요청 중복 사례를 검증 범위에 추가해, 실행 전에 `artifacts/bwd2/engine`으로 새 입력 고정을 시작했다. 첫 snapshot으로 Rust 검사는 실행하지 않았으며 컴파일 재실행은 아니다.
- Windows 검증은 Rust 1.95.0, 기본 test profile, 절대 경로 `engine/codex-rs/target`의 기존 Cargo 캐시를 사용한다. 실행 조건: `RUST_MIN_STACK=33554432`, `INSTA_UPDATE=no`, `--locked --offline --test-threads=1`. 등록된 native context 검사는 world-state, instruction projection, 모델 전환 통합 경로를 순차 실행한다. 제품 배포 빌드나 설치는 수행하지 않는다.
- 내장 `project_tests` run `run-32256-0-1792173381763002000`는 첫 명령이 실행 경계의 10초 제한으로 exit 124가 되어 실패했으며, 후속 두 단계는 실행되지 않았다. `producer_completed=true`와 입력 무결성 valid를 확인했다. 전체 결과를 통과로 보지 않고 `artifacts/bwd2/evidence/maintenance-attempt.json`에 보존했다. 동일 고정 소스로 completion-aware exec 경로에서 world-state 검사를 다시 시작했으며 로그는 `evidence/world-state.log`, 결과는 `evidence/world-state-result.json`이다.
- world-state 재실행 시작: 2026-10-16 17:57:02 UTC. 18:10 UTC checkpoint에서 기본 core 라이브러리를 지나 테스트 라이브러리를 컴파일 중이었다. 같은 검사 producer를 중복 실행하지 않았으며 이후 projection·model-switching 검사는 같은 Cargo 캐시를 순차 재사용한다.
- superseded `artifacts/bwd1`은 생성·소스 검사가 종료되었고 필요한 mapping 로그는 동일 hash로 bwd2에 보존했다. native cleanup review는 `not a managed descendant`로 삭제를 차단했다. 관리 경계를 확장하거나 다른 API로 우회하지 않고 defer 결정을 제출했다. 재검토 조건은 이 정확한 생성물 root를 지원하는 기존 cleanup owner 또는 별도 승인된 관리 경로 이전이 준비되는 것이다. 실제 삭제 완료로 기록하지 않는다.
- 넓은 `context::world_state` 검사: 2026-10-16 18:17:30 UTC 종료, exit 101, 116 통과·3 실패. 변경한 model section 8개는 모두 통과했다. 실패는 `catalog_collaboration_messages_select_mode_variant`의 legacy/catalog 선택 불일치와 permissions의 두 snapshot(축약 문구 대 상세 권한 안내)이며, 각 테스트가 모델 section을 생성하거나 그 코드를 호출하지 않는 것을 확인했다. 이를 수정 전 실행으로 재현했다는 뜻은 아니며 이번 변경과 독립인 검사 실패로 남긴다. 관련 없는 snapshot을 갱신하지 않았다.
- 유지할 새 context 보존 검사는 이 계약의 최소 범위인 `context::world_state::model::tests`, instruction projection, 모델 전환 통합 검사를 선택한다. 추가로 실행한 넓은 검사의 실패 기록은 보존한다. 기존 mandatory config/tools 검사는 변경하지 않는다.
- `instruction_state_projection`: 16/16 통과, exit 0. 로그와 실제 시작·종료 시각: `artifacts/bwd2/evidence/projection.log`, `projection-result.json`. 모델 전환 통합 검사는 동일 고정 입력과 캐시로 이어서 시작했다.
- 첫 official source recorder는 최종 재검사에서 저장소 HEAD/index 변경을 감지해 exit 1로 게시를 거부했다. 원본/current receipt hash는 그대로 확인했고 최신 HEAD 상태에서 같은 6개 소스 delta만으로 재시도했다. 첫 로그와 재시도 로그를 동일 run evidence에 보존한다.
- official recorder 재시도: exit 0. 독립 원본 receipt byte hash `12a1dbfc1725df7d4e87de4e336e0b8dab217aecbe7d26b624d1e264356b00b6`를 anchor로 검증하고, current receipt inventory에는 검토한 6개 Rust 파일만 갱신되었다. `engine/SOURCE.json`은 공식 도구 결과이며 원본 import/canonical hash와 다른 기존 delta는 보존했다. 로그: `source-recorder-02.log`.
- 최소 model section 검사: 동일 Cargo 실행에서 생성된 `codex_core-166df10a124e8927.exe`를 재사용해 `context::world_state::model::tests --test-threads=1`을 직접 실행, 8/8 통과·exit 0. 실행 파일 hash와 시각은 `model-state-result.json`, 출력은 `model-state.log`에 보존한다. 통합 테스트 컴파일과 cache 쓰기를 중복하지 않았다.
- 수정 Rust 파일 6개는 primary와 frozen test 입력의 byte hash가 모두 일치했다(`edited-inputs.json`). Node checker 구문과 feature manifest reference/check contract 검증도 exit 0이었다. SOURCE.json의 사후 provenance 갱신은 테스트한 Rust 바이트를 변경하지 않았다.
- 첫 `suite::model_switching` 전체 실행은 21 통과·3 실패·exit 101이었다(실제 실행 189.83초). 수정한 첫 모델 전환/반복 전환/personality 사례는 통과했다. 남은 실패는 empty-prefix fork에서 custom 지침만을 정확한 전체 base로 기대한 두 사례와, 동일 profile의 모델 전환에도 model_switch 1회를 기대한 한 사례였다. 실제 요청에서 공통 harness 본문과 inherited custom 내용이 함께 제공됨을 확인하고, 각각 정확히 한 번 존재하며 추가 switch가 0개인 계약으로 fork assertion을 갱신했다. 이 후속 보완에서 제품 코드는 변경하지 않았다.
- 첫 통합 결과와 입력은 bwd2에 보존한다. final 통합 재실행은 관리되는 별도 root `artifacts/tasks/bw3` 및 lifecycle `work:BW-01-profile-dedup-run-03`을 생성 전에 등록했다. 새 입력으로 테스트 변경을 검증하고, 변경이 없는 model/unit projection 검사 결과는 해당 소스 hash가 일치할 때만 재사용한다.
- fork 기대값 보완 뒤 official recorder 3차 실행은 검토한 `codex-rs/core/tests/suite/model_switching.rs` 하나의 delta로 exit 0이었다. 로그를 hash 확인 후 final evidence에 복사했다. 두 번째 이후 recorder 실행은 native 검증과 독립적으로 진행했다.
- final 입력: `18550f97be09be2c63c03d057ef47b642782f5524c5309f0c026ad91978c0c4c`, 9,266파일. 이전 입력과 inventory를 비교해 `SOURCE.json`과 integration 테스트 파일만 다르며 library 테스트와 제품 소스는 그대로임을 확인했다(`artifacts/tasks/bw3/evidence/reused-library-results.json`). passing source mapping/model state/projection 및 provenance 기록 6개도 byte hash를 확인해 final run으로 보존 위치를 연결했다(`retained-evidence.json`).
- `artifacts/bwd1`과 `artifacts/bwd2`의 native apply 결과는 모두 deferred·remaining=true였다. 삭제는 수행되지 않았다. bwd1은 superseded 입력이고, bwd2는 실패한 광역 검사/첫 통합 검사의 입력과 진단 로그이다. 관리 경계와 진단 보존 조건이 해소될 때 전체 group을 다시 검토한다. 기존 공유 Cargo 캐시는 계속 사용하므로 이번 삭제 대상이 아니다.
- final `suite::model_switching`: 24/24 통과, exit 0. 시작 2026-10-16 18:32:59 UTC, 종료 18:47:59 UTC; 이 약 15분에는 새 snapshot의 준비 컴파일을 포함하고 실제 테스트 실행은 180.82초이다. 로그: `artifacts/tasks/bw3/evidence/model-switching.log`, 실제 exit/시각: `model-switching-result.json`. overlapping provenance/cleanup 시간을 이 실행 시간에 더해 전체 소요 시간으로 주장하지 않는다.
- final 입력 9,266파일의 hash와 전체 파일 목록이 유지됐고, primary의 수정 Rust 파일 6개 및 `SOURCE.json`도 검증 입력과 일치했다. 관련 검사는 source mapping 9개, model state 8개, instruction projection 16개, model-switching integration 24개로 57개 통과했다. 통합 검사의 첫 3개 실패는 기대값 보완 후 해소되었다. 별도로 실행한 광역 world-state 검사의 권한/협업 모드 3개 실패는 범위 밖 잔여 결과로 남긴다. 요약 receipt: `artifacts/tasks/bw3/evidence/final-verification.json`.
- 검증 환경은 Windows x64/Rust 1.95.0이다. Linux/macOS 실행, 제품 배포 빌드, 설치 실행 파일과의 동일성 및 실전 API의 토큰 절감량은 검증하지 않았다.
- final group의 native review/apply도 deferred·remaining=true로 완료했다. `artifacts/tasks/bw3`은 검증된 입력·로그·receipt의 현재 소유자이며 이 작업 기록이 소비자이다. 다음 설치 후보에 입력/검증 identity와 통과 근거가 독립적으로 보존되거나 동등한 compact evidence로 대체되면 참조를 해제하고 전체 group 삭제를 재검토한다. 세 group 모두 삭제했다고 주장하지 않는다.
- 공유 feature inventory에는 다른 작업의 namespace-cache-owner 변경이 함께 있어, 이번 engine profile owner/context check의 두 hunk만 커밋 대상으로 분리한다. 그 외 기존 작업·공유 Cargo 캐시·설치된 앱을 보존한다.
