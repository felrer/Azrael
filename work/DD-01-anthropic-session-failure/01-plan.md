상태: 소스 수정과 helper 34개 검증 완료. native 검증은 cache 경합으로 차단되어 커밋 보류. 빌드·설치 없음.

# Anthropic 세션 응답 실패 분석 및 복구 수정

## 범위와 검증

- 대상: `01a16350-1afa-7830-a324-c8aa164b4dca`, turn `01a16350-2f07-7db2-b7c4-2236aa03a199`.
- 허용 범위: 원인 분석 및 후속 요청에 따른 코드 수정과 검증. 미등록 도구는 실행하지 않고 모델에게 오류로 반환하여 같은 turn을 계속한다. 해당 오류를 일반 오류로 종료하는 경로를 제거한다. 다른 일반 오류 처리, 설치, 제품 빌드, 실제 API 재요청은 범위 밖이다.
- 관측 플랫폼: Windows x64 로컬. 공통 provider 코드의 다른 OS 동작은 검증하지 않았다.
- 성공 기준: 원래 call ID와 짝지어진 실패 결과를 모델에게 반환; 숨겨진/충돌 도구와 hook/handler 비실행; 후속 정상 응답 진행; 정상 호출과 JSON/중복 ID/스트림 종료 검증 보존; private replay 및 이력 대응 유지.
- 공통 helper/native 변경은 Windows에서 scoped 회귀로 검증한다. Linux/macOS도 구현 대상이나 이 호스트에서 실행 검증하지 않는다. 계약 소유자는 `docs/architecture/managed-providers.md`, inventory는 `engine.managed-tool-identities`다.

## 수정 계획과 소유권

- Root: managed/API mapper는 미등록 이름만 reserved `azrael_unavailable_tool` function-call 거부 기록으로 바꾼다. strict 이름 조회 API를 유지하며 일반 실행 도구로 재해석하지 않는다. call ID/유효 JSON 객체 인자를 보존하고 metadata에는 거부 identity의 history alias를 기록한다. 진단, replay, 합성 adapter 검증과 문서/inventory를 수정한다.
- Native 담당: `engine/`의 ToolCatalog는 namespace 예약과 거부 기록을 구분하고 router가 registry 전에 RespondToModel을 반환한다. 기존 tool runtime의 짝지어진 실패 결과와 follow-up을 재사용한다. build_tool_call 오류 분기는 빈 call ID를 쓰므로 사용하지 않는다.
- 검증: helper 정상/미등록/과거 alias/혼합 호출/손상 스트림/metadata replay, native catalog 검증 보존/namespace 예약/비실행 거부/후속 호출. 확정된 source 입력으로 native 실행하며 다른 작업 변경을 보존한다. task 변경만 커밋하고 배포하지 않는다.

## 확인 결과

2026-10-22 20:12:42~20:15:12 KST에 `managed/anthropic/claude-opus-5-5`, reasoning `high`로 실행됐다. turn은 150,870ms 뒤 `last_agent_message: null`, `codex_error_info: other`, `정의되지 않은 오류`로 종료됐다.

직접 실패 요청은 `1466e339-c112-4c66-aa5f-16d72e65ac6e`다. HTTP 200, SSE `message_stop`, `provider_stop_reason: tool_use`, `finish_seen: true`가 기록됐다. 최종 단계는 `error_stage: map`, `error_name: adapter_error`, 오류 코드는 `undeclared_tool`이다. helper 종료 코드 1, 요청 경과 8,449ms, 자동 재시도 없음. 이 종료를 인증, 사용량 제한, 네트워크 단절 또는 무응답 timeout으로 판단할 근거는 없다.

도구 진단은 catalog 28개, history alias 5개, call 1개, `name_match: unknown`, `name_style: other`, `mapping_result: undeclared`, `call_state: rejected`다. 이름은 18바이트이고 raw/parser 이름 SHA-256은 모두 `6539ff5a0016f3dc5898a60dda17b58b006a11d0efcbaa17516a72e44d611a61`이다. `raw_parser_name_equal: true`이므로 진단의 canonicalization 기준에서 parser 이름 변형 증거는 없다. 인자 970바이트, 140개 delta를 받은 뒤 이름 조회에서 거부됐고 JSON 검사는 수행되지 않았다. JSON 문법 오류가 최종 원인이라는 결론은 성립하지 않는다.

실제 도구 이름은 로그가 해시만 보관하므로 확정할 수 없다. 모델의 이름 생성 이유가 지시/과거 문맥 혼동인지, 기대한 도구가 catalog에 빠진 것인지도 확정할 수 없다.

선행 오류는 Bash의 `justification`/`sandbox_permissions` 불일치, Grep의 지원하지 않는 `-o`, 파일 접근 거부, MCP resources 미지원이다. 이후 추가 모델 요청이 완료됐으므로 이를 최종 중단 원인과 동일시하지 않는다. 20:15:03 orphan tool output 복원 경고와 최종 이름 불일치의 인과관계도 미확정이다.

## 실행 버전과 코드 근거

- 실제 spawn 기록의 helper는 `artifacts/build/b13/artifacts/releases/w11aa/providers/opencodex/inference.js`, bundled Bun이다. 창 client version은 `2026.0.11`이다. 설치 문서의 다른 release를 실행 버전으로 간주하지 않았다.
- [build-info.json](../../artifacts/build/b13/artifacts/releases/w11aa/build-info.json)의 `engineSourceRoot`는 `artifacts/build/b13/engine`, target은 `x86_64-pc-windows-msvc`다.
- 실제 helper `inference.js:23159`에서 `acceptedNames`에 후보가 없으면 `undeclared_tool`을 발생시킨다. 현재 소스의 대응 경로는 [inference-mapping.mjs](../../providers/opencodex/inference-mapping.mjs:265)의 `resolveToolName` / `restoreToolCall`이다.
- 실행 receipt가 가리키는 engine의 [native_runtime_errors.rs](../../artifacts/build/b13/engine/codex-rs/core/src/devin/native_runtime_errors.rs:94)는 이 코드를 별도 분류하지 않고 `Unclassified`의 일반 오류 문구로 변환한다. 세션 종료 기록과 일치한다.
- 원본 증거: `~/.azrael-ex/logs_2.sqlite` 해당 thread/request 행과 `~/.azrael-ex/sessions/2026/10/22/rollout-2026-10-22T20-12-38-01a16350-1afa-7830-a324-c8aa164b4dca.jsonl`. 민감한 본문은 별도 복사하지 않았다.

## 수정 결과와 검증

mapper는 `undeclared_tool`만 내부 거부 기록으로 변환한다. 이름의 모호성, JSON 오류, 중복 ID, 잘린 응답은 기존 실패 처리를 유지한다. 네이티브 catalog가 거부 namespace의 선언을 막고, router가 registry 조회 및 hook/handler 실행 전에 모델용 오류를 반환한다. native tool runtime의 call ID 및 success=false 결과 반환 경로를 재사용한다. 포괄적인 일반 오류 fallback은 다른 실패를 위해 유지하며 이번 미등록 도구 경로에서는 도달하지 않는다.

Windows helper source 회귀 16개와 Anthropic adapter/private replay/profile 회귀 18개가 최종 project_tests `run-61016-1464-1792673894374474500`에서 모두 통과했다(각 exit 0). 합성 Anthropic SSE에서 미등록 도구 응답 → 원래 call ID를 포함한 tool_result 전송 → 같은 turn의 다음 text 응답 완료까지 확인했다. manifest `engine.managed-tool-identities` 검증도 exit 0이다. 상세 helper 출력은 해당 project_tests run의 bounded execution evidence에 보존된다.

첫 native 준비는 `artifacts/tasks/DD-01-anthropic-session-failure/runs/20261022T123636807Z-f1487c6a-9a52-42e2-b6e0-963601bb11d4`에 귀속한다. 현재 `engine/`을 재사용 가능한 test-only 소스 복사로 고정했고 전후 inventory는 동일했다. 제품 provenance 검증 및 제품 빌드를 의미하지 않는다. Cargo 캐시는 다른 작업(CY-01)의 PID 62300 소유 lease가 있어 native 실행 전에 차단됐다(exit 1); 실제 Cargo는 시작하지 않았다. 잠금을 변경하지 않았다.

재시도 run `20261022T124035425Z-f772cc06-1d6b-4490-84ff-a884a8ab588d`는 2026-10-22 21:40 KST부터 기존 owner 종료를 기다렸고 22:25 KST에 종료됐다. 기다리는 동안 다른 독립 구현/검증은 없었다. 기존 owner 종료 직후 CJ 작업의 PID 65008이 cache를 확보하여 두 번째 시도도 실제 Cargo 시작 전에 차단됐다(exit 1). source inventory는 계속 동일했다. native.log 및 result.json이 해당 run의 logs/reports에 남아 있다. 두 producer는 모두 종료됐으며 실패 결과를 성공으로 바꾸지 않았다.

분리 cache도 검토했으나 당시 여유 메모리 약 6.5GiB/C: 여유 약 38.7GiB와 다른 native 컴파일을 고려하여 추가 cold compile을 시작하지 않았다. 현재 native 실행 검증은 미완료이고, 필수 검증이 차단되어 task commit도 보류한다. frozen source 및 실패 진단은 공용 cache 사용 가능 후 scoped native 테스트 통과 또는 사용자에 의한 작업 취소 시 재검토한다. 보호된 공용 cache 및 타 작업 producer는 변경하지 않았다. 후속 검증 명령은 `node scripts/check-unavailable-tool-native.cjs <고정된 engine root>`이며 pinned Rust 1.95.0/MSVC, absolute CARGO_TARGET_DIR 및 x86_64-pc-windows-msvc target을 사용한다.

초기 helper plan의 `tree entry disappeared`는 등록 입력 경로를 수정한 뒤 해소됐다. 보호 검사를 우회하거나 실패한 실행을 성공으로 처리하지 않았다. SQLite는 read-only로 열었다. 실제 계정 호출, 사용자 세션/인증 정보/설치 파일 변경은 없으며 실제 설치 환경 검증은 범위 밖이다.

생성한 native run 2개는 producer의 실제 종료 및 실패 상태를 확인한 뒤 project inventory에 등록하고, registered 검토 및 apply에서 모두 `deferred`, `remaining: true`를 확인했다. 약 191MB의 고정 소스와 소규모 실패 로그를 native 재검증까지 보존한다. 재검토 조건은 해당 native 테스트 통과 또는 사용자 작업 취소다. 실행 중인 자체 검증 producer는 남아 있지 않다. 최종 scoped diff whitespace 검사는 exit 0이며, 다른 작업 변경과 Git index는 건드리지 않았다.


