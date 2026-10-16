상태: 정적 분석 완료. 프로필·개별 도구·Window Use 측정과 권고를 정리했습니다. 실제 provider 요청/token/성능 측정은 후속 범위입니다.

# 도구 프로필·개별 도구 컨텍스트 분석

요청은 도구 프로필별 모델 컨텍스트 양의 적절성 평가와 개별 도구 검토이며 Window Use를 우선합니다. 허용 범위는 읽기, 안전한 정적 측정과 분석 기록 작성입니다. 코드·설정·설치·데스크톱 제어 변경은 포함하지 않습니다.

공통 범위: 프로필 선택, 직접/지연 노출, 스키마·설명·검색 이력·도구 출력. 환경 한정 범위: Windows Window Use. 실제 조사 환경은 Windows이며 타 플랫폼 실행이나 설치본의 실제 wire 요청은 검증하지 않습니다. 소스는 docs/ops/development.md가 지정하는 engine/이며 upstream은 제외합니다.

Root는 프로필 비교와 최종 판단을 담당합니다. 독립 읽기 조사 두 건은 Window Use 스키마/출력 경계와 프로필별 노출/누적 경계를 담당합니다. 담당자 결과를 통합하여 이 문서에 수치, 근거, 우선순위, 미검증 범위를 기록합니다. 기존 작업 변경은 보존합니다.

성공 기준: 실제 프로필을 식별하고 초기·발견 후·실행 후 컨텍스트를 구분하며, Window Use의 개별 도구 크기를 안전하게 측정하고 불필요한 중복과 필요한 권한 계약을 구분합니다. 문자/직렬화 바이트를 정확한 토큰으로 표현하지 않습니다. 성능·정확도 개선은 권고이며 검증 완료로 보고하지 않습니다.

## 초기 확인 결과

현재 소스의 도구 프로필은 `builtin/azrael-default`와 `builtin/claude-code-core`입니다. `builtin/claude-lean`은 프롬프트 프로필이므로 도구 스키마 축소 효과와 분리해야 합니다. 직접 호출·코드 모드·검색 후 노출·selected-window 제한은 프로필 이름과 별개의 실행 조건입니다.

검색 가능한 도구가 많다는 사실만으로 매 요청에 전부 전달된다고 판단할 수 없습니다. 현재 세션 ALL_TOOLS 메타데이터의 Apps 539개 합계는 814,779문자이며, 이는 검색 가능한 카탈로그의 문자열 합계입니다. 초기 프롬프트·실제 wire 크기 또는 토큰 수가 아닙니다. 문자열은 설명과 TypeScript 호출 선언을 포함합니다. 측정 원본은 [session-metadata.json](session-metadata.json)에 있습니다.

| 경계 | 확인된 소스 사실 | 판단 |
| --- | --- | --- |
| 지연 namespace 안내 | `core/src/context/world_state/tools.rs:25`의 전체 4 KiB, 설명 250문자 | 기존 제한은 합리적 출발점. 완전한 스키마와 실행 결과에 적용되는 총예산은 아님 |
| ToolSearch 소스 안내 | `core/src/tools/handlers/tool_search_spec.rs:8`의 Include 512 KiB, IncludeLimited 4 KiB, Omit 없음 | 일반 Include 경로의 큰 허용량은 우선 검토. `spec_plan.rs:1736`에서 world-state 활성화 시 Omit, api/면 Limited, 나머지는 Include |
| 사용자 API 발견 도구 | `core/src/tools/router.rs:208`의 8개·직렬화 카탈로그 64 KiB | bounded 정책의 제한. 직접 도구는 필수이며 기본 카탈로그가 큰 경우 조용히 삭제하지 않음 |
| Claude 발견 도구 | `core/src/tools/router.rs:237`의 retained history 발견 도구 유지 | 장기 세션 누적 가능. 일반 컨텍스트 예산이 있다고 발견 스키마 비용이 작다는 뜻은 아님 |

## 개별 도구의 초기 평가

| 도구 | 확인 내용 | 권고 |
| --- | --- | --- |
| Claude Read | 기본 2,000줄·32 KiB 출력(`claude_files.rs:36`, `:428`); Edit/Write는 현재 파일 전체의 승인된 읽기 범위 요구(`:200`) | 읽기 기본 범위를 검토하되 전체 읽기 요구가 기능 계약임을 보존. 범위만 줄여서는 수정 작업 총 컨텍스트가 줄지 않을 수 있음 |
| Claude Grep | 기본 200줄, 최대 2,000줄(`claude_search.rs:162`) | 기본값은 비교적 제한적. 좁은 검색과 필요한 문맥 중심으로 유지 |
| Claude Glob | 10,000개 스캔, 2,000개 결과(`claude_search.rs:15`) | 큰 프로젝트에서는 요약·페이지 조회 검토. 정렬 완전성과 truncation 표시는 보존 |
| Claude Bash/TaskOutput | native 호출에 10,000 max_output_tokens 설정(`claude_shell.rs:221`, `:314`) | 초기 출력은 줄이고 로그 파일·필요 부분 조회를 결합하는 방안 검토 |
| exec_command / write_stdin | 현재 세션 설명+선언 각각 2,851/1,150문자 | 플랫폼·승인·세션 의미를 보존하면서 긴 공통 설명이 실제로 중복되는지 wire 기준 확인 |
| web.run | 현재 세션 설명+선언 10,479문자 | 규칙 본문과 스키마 비용 분리 검토. 검색 가능한 Apps search_service도 별도 9,297문자이나 동시 전송 여부는 미확인 |
| imagegen | 현재 세션 설명+선언 2,492문자 | 긴 운용 안내를 공통 지침과 도구 고유 제약으로 분리하되 참조 이미지·투명 배경·출력 규칙 보존 |
| 외부 Apps | 가장 큰 메타데이터는 Pages edit_page 14,090, read_page 12,654, Topview TikTok 10,720문자 | 개별 카탈로그 크기 검토 후보. 실제 발견 후 전송 및 결과 크기는 별도 측정 필요 |

정확한 provider tokenizer·실제 요청 payload·이미지 토큰·cache hit·응답 지연은 측정하지 않았습니다. 문자 수를 임의 비율로 토큰 수로 바꾸지 않습니다. 기본 프로필 전체가 적정하다고 승인하거나 특정 절감률을 확정할 근거는 아직 없습니다.

## 프로필별 최종 판단

| 선택/모드 | 초기 컨텍스트 | 발견·실행 뒤 컨텍스트 | 적정성 판단 |
| --- | --- | --- | --- |
| Azrael + Direct | 직접 노출 도구와 검색 안내 | MCP는 검색 여부에 따라 완전한 스키마 추가 | 검색이 꺼지면 MCP가 직접 노출될 수 있어 설정별 측정 필요 |
| Azrael + CodeMode | exec에 중첩 도구 선언, 직접 노출 정의도 유지 가능 | 출력과 검색 결과 누적 | 같은 도구의 직접 정의와 exec 선언이 겹치는 비용을 검토 |
| Azrael + CodeModeOnly | 중첩 가능한 도구를 직접 목록에서 제외 | 필요한 도구 검색·실행 | 중복을 줄일 가능성이 있으나 실제 도구 가용성·호환성 조건 확인 필요 |
| Claude core + Direct | 호환 도구와 ToolSearch; Anthropic은 Direct 강제 | retained conversation에서 발견한 완전한 스키마 유지 | 초기보다 장기 세션의 카탈로그 증가가 핵심 위험 |
| api/ + Direct | Direct 강제, 소스 안내 4 KiB 또는 생략 | 발견 결과/활성 집합 8개·64 KiB 제한 | 상대적으로 명확한 제한이 있으나 직접 도구와 출력 비용은 별도 |
| selected-window 제한 | Window Use 전용 소유 서버·namespace로 제한 | 관찰·매크로·이미지 출력 | 독립 프로필이 아닌 권한 제한. 도구 수가 적어도 출력은 클 수 있음 |

근거: `engine/codex-rs/core/src/tools/mod.rs:75`, `tools/spec_plan.rs:677`, `tools/spec_plan.rs:1950`, `tools/router.rs:203`, `tools/handlers/tool_search.rs:237`, `mcp_tool_exposure.rs:84`. Claude라는 모델 이름만으로 Claude 프로필이 선택되지 않습니다. 실제 provider identity와 해석된 profile을 기준으로 비교해야 합니다.

CodeMode의 직접+중첩 정의는 모드의 특성이지 모든 실행에서 발생하는 이중 전송의 확인은 아닙니다. Helper는 Claude 검색 이력의 스키마 본문을 live catalog alias로 바꿉니다(`providers/opencodex/inference-mapping.mjs:199`); 따라서 검색 이력에 매번 스키마가 그대로 반복된다고 결론 내리면 안 됩니다. live catalog 유지 비용은 남습니다.

## Window Use 개별 측정

원본 MCP는 20개 도구를 정의하지만 `ui_operation`은 app-only로 모델에 숨깁니다. 아래는 모델 목록의 19개입니다. 원본 설명·스키마는 ASCII UTF-8 바이트이며, 세션 메타데이터 문자 수에는 TypeScript 호출 선언이 포함됩니다. 열을 서로 더해서 실제 wire 크기로 표현하지 않습니다.

| 도구 | 원본 설명 B | JSON 스키마 B | 세션 메타데이터 문자 |
| --- | ---: | ---: | ---: |
| list_windows | 225 | 76 | 354 |
| select_window | 273 | 120 | 425 |
| inspect | 266 | 186 | 472 |
| capture | 402 | 186 | 608 |
| status | 477 | 176 | 683 |
| restore_window | 299 | 186 | 512 |
| invoke | 401 | 278 | 652 |
| set_value | 404 | 330 | 675 |
| toggle | 401 | 278 | 652 |
| select | 401 | 278 | 652 |
| expand | 401 | 278 | 652 |
| collapse | 403 | 278 | 656 |
| scroll | 401 | 505 | 704 |
| press_key | 155 | 414 | 556 |
| resize | 401 | 326 | 647 |
| run_size_macro | 409 | 224 | 641 |
| list_task_macros | 124 | 76 | 257 |
| save_task_macro | 238 | 3,601 | 978 |
| run_task_macro | 559 | 3,934 | 745 |
| 합계 | 6,640 | 11,730 | 11,521 |

측정은 exported `toolDefinitions()`만 호출했으며 실제 도구 실행과 화면 접근은 하지 않았습니다. Root 재확인 명령 `node -e`는 exit 0으로 19개 및 위 합계를 확인했습니다. 소유자: `scripts/window-control-mcp.cjs:50`. 현재 session string은 원본 설명보다 호출 선언 4,881문자만큼 큽니다. 이 메타데이터 전체가 초기 prompt에 삽입된다는 뜻은 아닙니다.

`save_task_macro`+`run_task_macro`의 스키마가 7,535 B로 전체의 64.2%입니다. 거의 같은 selector/action/condition 정의를 각각 포함합니다. invoke/toggle/select/expand/collapse의 스키마도 각 278 B로 같고, 복구·이전 element 폐기·입력 재실행 금지·사용자 resume 안내가 여러 설명에서 반복됩니다. `list_task_macros`는 정의 전체를 반환하는 경로가 있어 목록 조회에서도 큰 응답이 가능합니다(`window-control-mcp.cjs:140`).

Window Use는 이미 host 결과를 허용 필드로 투영하고 암호 element의 value를 제외합니다(`window-control-mcp.cjs:130`). 원시 host 객체를 전부 보내는 구현은 아닙니다. 다만 모델 응답 투영 경계에는 별도의 총 문자/바이트 예산이 보이지 않습니다. 최대 2,048 UIA element·깊이 128, element name/automationId/value 각각 65,536 B 제한(`native/window-control/src/uia.rs:42`, `:146`), 이미지 한 변 16,384 px·총 32 Mi pixels(`capture.rs:226`)는 안전 상한이지 일상적인 모델 컨텍스트 예산으로는 큽니다. PNG는 텍스트 JSON에 base64를 반복하는 대신 별도 image block으로 전송합니다(`window-control-mcp.cjs:145`). 이미지 모델 비용은 해상도·detail·provider에 따라 별도 확인해야 합니다.

저장 매크로는 최대 100개·1 MiB, 각 정의는 최대 32 steps와 32 parameters를 허용합니다. 실행 결과는 step 상태와 final observation을 포함할 수 있습니다. 이 저장/프로토콜 한계는 매 요청 출력량에 대한 보장은 아닙니다. 정확한 element identity·fresh observation·occupancy·app grant·pause/restore 상태·복구 계약은 줄이기 전에 반드시 보존해야 합니다. 권한은 설명 문장만이 아니라 host/backend에서 계속 강제해야 합니다.

## 권고 우선순위와 영향

1. Window Use 관찰/목록 출력에 독립 예산을 설계합니다. `inspect`는 현재 작업에 필요한 element를 우선하고 하위 범위 조회를 제공하며, 잘렸는지 명시합니다. `list_task_macros`는 id/name/steps 수/revision을 기본으로 반환하고 상세 정의를 요청할 때만 제공합니다. 이미지는 관찰에 필요한 크기로 줄이는 방안을 비교합니다. 단, selector 탐색·매크로의 완전한 tree 요구·세밀한 문자 식별을 손상시키지 않도록 행동 정확도를 검증해야 합니다.
2. Claude 발견 카탈로그의 장기 증가를 계측합니다. 같은 작업의 여러 검색 후 활성 스키마 크기와 token 비용을 측정하고, 필요하면 작업 관련 활성 집합·재검색 정책을 설계합니다. 단순히 API의 8개 상한을 복사하면 필요한 호출 가용성이 바뀝니다.
3. ToolSearch의 일반 Include 512 KiB 허용 경로를 낮추거나 기존 world-state 요약을 이용하는 방안을 검토합니다. 이름·가용성을 보존하고 관련 서비스가 검색 가능한지 확인해야 합니다. 실제 listing이 작거나 Omit 경로라면 효과는 작습니다.
4. Window Use 반복 prose를 짧은 공통 안내와 개별 action 차이로 나눕니다. 선택·권한·freshness·복구 정보를 모델이 실제로 보는 위치에 유지합니다. 매크로 스키마는 저장/실행 형태를 재설계하거나 지원되는 공유 정의 기능을 검토합니다. `$ref`가 실제 provider와 code-mode 선언에 유지되는지 확인 없이 적용하지 않습니다. 저장 macroId 실행 경로가 이미 있으므로 재사용하되 inline definition 기능을 임의 제거하지 않습니다.
5. shell/Read/검색의 초기 출력량을 조정할지 검토합니다. 짧은 결과·파일 로그·부분 조회를 결합하되 Claude의 전체 읽기 승인 계약과 완전한 검색/정렬 요구를 보존합니다. 출력 제한만 낮추면 추가 호출과 총 지연이 증가할 수 있습니다.

권고는 구현 승인이 아닙니다. 이번 작업에서는 코드·설정·권한·설치본을 변경하지 않았습니다. 분석 기록과 측정 메타데이터만 작성했습니다.

## 검증 범위와 다음 계측

완료: primary `engine/` 소스 경계 조사, 프로필/모드/발견 정책 구분, 주요 native 도구의 출력 제한 확인, Window Use 19개 원본 크기의 안전한 정적 측정(exit 0), 현재 세션 메타데이터 목록 측정. 데스크톱 제어·사용자 window 관찰·외부 서비스 호출·빌드·설치는 수행하지 않았습니다.

미검증: 현재 설치된 엔진의 resolved feature/profile/mode, provider에 전송된 정확한 payload, tokenizer와 이미지 token, prompt cache 적용, 시간/비용, 출력 축소 뒤 행동 정확도. 외부 Apps는 카탈로그의 개별 크기까지 검토했으며 각 서비스의 실제 응답 내용·기능별 실행은 검증하지 않았습니다.

후속 계측은 동일 model/provider/feature/권한/작업을 고정하여 초기 요청, 1회/여러 도구 발견 후, Window Use 관찰 후를 비교하는 것이 적절합니다. system instructions, 직접 스키마, exec 중첩 선언, namespace 요약, 검색 이력, 도구 결과, 이미지를 분리해 bytes·정확 token·cached/uncached usage·응답 지연과 작업 성공률을 기록합니다. 정보량 감소와 행동 정확도 유지가 함께 확인돼야 축소안을 수용할 수 있습니다.

