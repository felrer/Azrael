상태: 소스 수정 및 독립 정책 검증 완료 — 유지보수 잠금으로 임시 파일 정리와 작업 커밋은 보류했다. 빌드·설치는 범위 밖이다.

# Anthropic 초기 컨텍스트와 도구 모드

## 목표·범위·권한

- 최초 요청: 설치본에서 Anthropic 사용 시작부터 약 30만 컨텍스트가 사용되는 원인을 조사한다.
- 추가 승인: Anthropic의 강제 Direct 분기만 제거한다. 사용자 API의 api/ 분기, 검색 정책, 권한, 프로필 선택 및 availability fallback을 보존한다.
- 공통 엔진 정책 변경이다. Windows x64에서 검증하며 Linux/macOS 실행, 실계정 요청, 빌드·설치는 수행하지 않는다.
- root가 코드 수정 → 독립 정책 검사 → diff 검토 → 정리 및 작업 커밋을 수행한다. 기존 사용자 및 staged 변경을 보존한다.

## 조사 근거

- 실행 중인 엔진 6개는 artifacts/workspaces/h/artifacts/releases/w13r-99afefb1/engine/azrael.exe로 일치했다. 운영 문서의 설치 버전은 2026.0.12다.
- release의 build-info.json이 지정한 원본은 artifacts/inputs/dm01-w13r/project/engine이다. 설치본 조사는 고정 원본을 사용했고 수정 대상은 현재 engine/이다.
- 기존 진단 23건에서 도구 정의 781개, 1,113,809 bytes, 로컬 추정 312,687 tokens를 확인했다. 서버 보고 전체 입력은 698,772 및 530,847 tokens 사례가 있다. 추정치 차이를 전부 도구에 귀속할 수는 없다.
- 2026-10-25 14:53:40 KST 생성 세션의 첫 nonzero usage는 14:54:49에 input 496,946, cache write 496,942, output 689였다. 최초 요청의 구성 진단은 보존 로그에 없어 다른 요청과 동일 구성이라고 단정하지 않는다.
- Anthropic usage는 uncached + cache read + cache write를 총 input으로 합친다. 캐시 토큰은 컨텍스트에서 제외되지 않으며 이중 계산 근거는 발견하지 않았다.
- tools/mod.rs::requested_tool_mode는 Anthropic에 Direct를 강제했다. 공통 프로필이라도 provider별 유효 모드가 달라지는 원인이다.
- 모델 catalog의 Anthropic 검색 플래그는 false지만 spec_plan.rs에는 명시적 Claude tool profile의 검색 예외가 있다. Anthropic 전체가 검색 미지원이라는 단정은 부정확하다.
- mapper와 adapter는 받은 도구 전체를 wire로 변환한다. 이번 수정만으로 지연 노출 연결이나 컨텍스트 감소를 보장하지 않는다.

## 변경 및 성공 기준

- Anthropic 판정만 제거하고 모델별 override → CodeModeOnly → CodeMode → Direct의 기존 resolver를 재사용한다.
- effective_tool_mode의 서비스 미가용 fallback 및 사용자 API 강제 Direct를 보존한다.
- docs/architecture/model-harness-profiles.md에 공통 정책과 미검증 경계를 반영한다. 기존 engine.model-harness-profiles feature에 mod.rs owner를 연결한다.
- 실제 제품 함수 두 개를 그대로 추출한 독립 Rust 정책 검사를 수행한다. 가벼운 context/config stand-in을 사용하므로 전체 native 엔진 통합 검사와 구분한다.
- 전체 codex-core 및 설치된 Anthropic Code Mode 수용, 컨텍스트 감소는 미검증이다.

## 검증 생성물 계획

- 소유 run: artifacts/tasks/DR-01/runs/direct-policy-v1/.
- 실행 전 계획 항목: policy.rs, policy.exe, compiler sidecar, compile.log, test.log, result.json. 함수 입력 SHA-256을 기록한다.
- 검토 후 결과를 이 문서에 보존하고 inventory 등록·review·apply로 run을 정리한다. worktree는 사용하지 않는다.

## 공식 참고

- https://platform.claude.com/docs/en/build-with-claude/prompt-caching
- https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool

## 실행 결과와 보류

- `engine/codex-rs/core/src/tools/mod.rs`에서 Anthropic 강제 Direct 조건만 제거했다. 사용자 API 예외, 공통 resolver 및 fallback을 보존했다. owning 문서와 feature owner 연결을 갱신했다.
- Windows x64의 rustc 1.98.0으로 제품 함수 `requested_tool_mode` 및 `effective_tool_mode`를 변경 없이 추출한 fixture를 컴파일하고 실행했다. compiler exit 0, test exit 0, 1개 테스트에서 256조합의 requested/effective 결과를 검증했다.
- 모델: managed Anthropic, OpenRouter의 Claude, OpenAI, 사용자 API. 공통 feature 4조합 × 모델 override 4조합 × 서비스 가용 여부 × fallback 차단 여부를 검사했다.
- 추출 함수 SHA-256: `5dacb0ab86d0891e57c5ae51ddfd70a4d8fed293a615e3a6df3f19b1adac9124`.
- feature owner 연결 확인 exit 0. 기존 Rust 파일 CRLF를 보존했으며 `git -c core.whitespace=cr-at-eol diff --check` exit 0이다. 일반 diff --check는 CRLF의 변경 줄을 trailing whitespace로 판단했다.
- 전체 native 엔진·provider wire·Claude 전용 프로필 통합 검사는 수행하지 않았다. 독립 정책 검증을 실제 도구 실행 및 컨텍스트 감소 검증으로 확대하지 않는다. 현재 설치본은 바뀌지 않았다.
- 임시 run inventory 등록은 `exclusive maintenance lock unavailable (abandoned locks require explicit recovery)` 오류로 차단됐다. 잠금을 변경하거나 직접 삭제로 우회하지 않았다. run의 로그·result.json·fixture/executable 및 compiler sidecar를 보존한다. 정상 잠금 해제 또는 소유자 복구 후 register → review → apply 정리를 재검토한다.
- 정리 완료가 작업 커밋의 선행 조건이므로 커밋은 보류했다. 기존 staged 및 다른 작업 변경을 보존했다. 본 작업 범위는 코드, owning 문서, feature inventory의 단일 owner 추가, 이 작업 기록이다.
