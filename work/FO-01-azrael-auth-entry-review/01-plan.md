상태: 구현 계획의 계정·정책 결정 반영 및 메모리 범위 설명 완료 — 최초 OpenAI 로그인 시 서비스 메인 자동 지정, 진행 중 요청만 시작 계정 유지, 조직 정책 동시 충족으로 확정했다. 사진의 장기 메모리와 모델 기반 세션 압축은 구분한다. 이번 후속은 조사·계획 갱신이며 제품 구현·계정 변경·빌드·설치는 아직 실행하지 않았다.

# Azrael 인증 진입 정리와 독립 OpenAI 서비스 계정 구현 계획

## 목표·권한·근거

[원래 설계 세션](azrael://threads/01a19bd3-d6ca-7d92-9afc-123730c9a3d2)의 마지막 인증 설계 논의를 이어간다. 사용자는 기존 단일 계정 경로의 영향 조사, 미인증 실행, 다른 공급자만 연결한 경우의 부가 기능 처리와 누락 검토를 요청했다. 현재 요청은 그 설계를 구현 계획으로 제시하는 것이다. 설계 합의는 제품 실행 승인과 구분한다.

앱 시작, 채팅 인증, OpenAI 부가 서비스 인증을 분리한다. 계정이 없어도 앱과 설정에 접근하며, 유효한 공급자의 모델만 사용한다. 처음 관리 OpenAI 계정 로그인이 성공하면 앱 전체 서비스 메인으로 자동 지정하고 이후 수동 전환을 제공한다. 다른 공급자 로그인으로 OpenAI 서비스 인증을 대신하지 않는다. 구 root 인증의 자동 채택은 제거하고 공통 OAuth·보안 저장·갱신은 재사용한다.

현재 개발 source는 [개발 운영](../../docs/ops/development.md)의 `engine/` 통합 0.162.0이다. 아래는 2026-11-06 Windows x64에서 수행한 소스 조사이며 설치 바이너리·실계정 수용을 뜻하지 않는다. 기존 회색 화면의 원인이 구 인증이라는 인과 관계는 미확정이다.

## 확정된 계정·정책 결정

사용자가 다음 동작을 선택했다. 기존 결정의 재승인 대상으로 두지 않는다. 중단 후 새 요청에서 이전 계정이 되살아나는 문제의 기존 수정은 별도 보존 조건이다.

| 결정 | 확정 동작 | 영향·보존 조건 |
| --- | --- | --- |
| 메인 계정 최초 지정·해제·삭제 | 처음 관리 OpenAI 계정 로그인이 성공하면 `OpenAI 서비스 메인`으로 자동 지정한다. 이후 계정 화면에서 수동 전환한다. 기존 메인이 있는 상태의 추가 로그인으로 메인을 덮어쓰지 않는다. | 최초 지정과 장애 fallback은 구분한다. 지정 해제·삭제·만료 때 임의의 다른 저장 계정으로 대체하지 않는다. root 자격을 자동 가져오지 않으며 삭제는 기존 retirement 절차를 따른다. |
| 일반 서비스 요청의 계정 전환 경계 | 새 요청은 새 메인으로, 이미 시작된 개별 요청만 시작 시 계정에 고정한다. 이전 결과는 원래 대화의 해당 요청 결과로만 연결하고 새 계정의 목록·캐시에는 반영하지 않는다. 취소·삭제·정책 변경은 기존 중단 규칙을 우선한다. | 계정을 세션 전체에 고정하지 않는다. 완료·실패·취소 후 새 요청은 최신 선택/revision으로 인증을 다시 결정한다. 결과 불명인 이전 mutation은 재실행하지 않되 그 상태를 새 요청의 영구 계정 고정으로 이용하지 않는다. |
| 서로 다른 계정의 조직 정책 | 프로젝트 채팅 정책 owner는 유지한다. OpenAI 서비스·리뷰어 요청은 호출 프로젝트의 적용 권한과 서비스 계정의 해당 조직 제한을 모두 만족해야 한다. 정책 충돌·필수 정책 확인 실패는 관련 기능을 막고 사유를 표시한다. | 메인 계정 변경으로 프로젝트 정책을 교체하거나 완화하지 않는다. 상충하는 provider·residency 요구는 합칠 수 있는 것으로 간주하지 않고 실행 불가로 다룬다. |

아래 1–6이 소스 구현·필수 검증·관련 설계/보존 목록 갱신·작업별 커밋의 계획 범위다. 이번 후속에서는 사용자의 메모리 범위 질문을 먼저 조사하고 위 결정을 반영했다. 7의 제품 패키징·설치, 실제 서비스 호출과 비용 발생은 선택 환경·계정·검증 동작에 대한 권한과 분리한다. 설계 확정과 제품 구현 완료를 혼동하지 않는다.

## 확정된 동작과 보존 범위

- 인증 없이 shell·계정 연결·일반 설정을 연다. 인증 없음, 확인 중, 만료, 관리 연결 실패를 구분하고 무한 빈 화면으로 처리하지 않는다.
- 사용 가능한 연결이 없으면 모델 목록은 비우고 송신·모델/추론 설정을 비활성화한다. 다른 공급자나 명시적 `auth:none` 사용자 API 연결은 자체 계약에 따라 사용할 수 있다.
- 구 root 로그인 진입과 자동 fallback을 정리한다. 기존 root 자격은 보존하며 사용자가 명시적으로 가져올 때만 읽는다. 성공한 이전의 원본 정리는 기존 owner·실패 복구 계약을 따른다. ordinary Codex 자료를 가져오지 않는다.
- 앱 전체 서비스 메인과 프로젝트별 채팅 계정은 독립적이다. 메인 변경은 채팅 provider/model/auth와 진행 중 추론을 바꾸지 않는다. 메인 만료 시 다른 저장 계정으로 자동 전환하지 않는다.
- Apps·ChatGPT 커넥터·해당 cloud plugin과 OpenAI 기반 검색·이미지·URL 안전성 서비스는 서비스 메인을 사용한다. 인증 외에도 구현·모델 도구 연결·구독 자격·정책 조건이 충족되어야 노출한다. 일반 MCP/OAuth·로컬 플러그인·파일 skill은 별도 인증 경계를 유지한다.
- `Approve for me`는 Anthropic 등 다른 공급자 대화도 별도 OpenAI 리뷰어로 처리한다. 메인 미연결·미지정·만료·리뷰어 미준비·정책 제한을 구분해 항목 비활성과 hover/키보드 focus 설명을 제공한다. 기존 선호는 보존하고 실제 제출에서도 검사한다.
- 리뷰어의 OpenAI 데이터 전송·추가 사용량은 기존 세션에서 설명하고 선택한 범위다. 공개 대화·정확한 도구 근거만 보내며 외국 provider의 비공개 reasoning·암호화 checkpoint를 그대로 전송하지 않는다. 거절·파싱 실패·시간초과는 실행 허가가 아니다. 수동 승인은 기존 정책이 허용할 때만 사용한다.
- 자동 장기 memory 추출·통합, 해당 요약의 자동 주입과 전용 memories 도구를 Azrael에서 비활성화한다. 저장된 memory를 삭제하지 않는다. 대화 압축·provider handoff·로컬 `task_memory`는 유지한다.
- 클라우드 조직 config·requirements·residency 수신과 적용은 **유지**한다. 기본 권한·샌드박스·로컬/프로젝트 정책·서버 조직 권한도 보존한다.
- native `AuthManager`, OAuth/device-code의 managed 계정 추가·재인증, keyring, token refresh, usage, 공통 `account/read`·`getAuthStatus`는 유지한다. CLI 로그인·Cloud Tasks·external auth·workload identity 전체 삭제는 범위 밖이다. 현재 미지원 Remote Control을 새로 지원하는 작업도 포함하지 않는다.

## 현재 구현과 재사용할 부분

기존 조사 이후 프로젝트 계정 선택 구현이 추가되었으므로 당시의 “모든 실행이 root로 fallback한다”는 식의 해석을 적용하지 않는다. [프로젝트 계정 계약](../../docs/architecture/accounts.md#project-selection-and-shared-credentials)은 현재 partial이며 설치 수용과 구분한다.

| 경계 | 현재 확인한 사실 | 구현 차이 |
| --- | --- | --- |
| 프로젝트 실행 인증 | `login/src/auth/manager.rs::shared_for_azrael_project`는 미선택 external-auth를 설치해 root 자동 사용을 막는다. 프로젝트별 selection/admission과 context별 정책이 존재한다. | 이 경로를 재사용하고 startup·비프로젝트 host·logout·서비스 소비자의 남은 root 읽기를 각각 조사해 닫는다. 새 계정 체계를 중복 구현하지 않는다. |
| root 인증과 이전 | 같은 파일의 `shared_for_azrael`은 여전히 startup root load를 수행한다. `app-server/src/lib.rs`의 초기 경로에서 사용한다. `account_processor/azrael.rs::azrael_capture_current`는 실행 auth가 없으면 명시적으로 별도 root manager를 열고 이전한다. | 명시적 import 경로를 보존한다. manager 전체 제거 대신 Azrael 실행/서비스 자동 채택과 이전 전용 접근을 분리한다. 실패 시 자격과 admission 상태를 보존한다. |
| 호스트·목록 | `integrated-azrael-entry.cjs`, `accountService.ts`, `provider-model-picker.cjs`와 pinned UI의 로그인 gate·native HTTP 인증 provider가 연결된다. 원격 catalog가 없을 때 bundled fallback도 존재한다. | shell 접근과 기능 readiness를 분리한다. 캐시·기본 모델·복원 대화·queued submit에도 동일 admission을 적용한다. |
| Apps와 plugin | `apps_processor/read.rs`는 processor의 auth와 network policy를 사용한다. `ext/mcp/src/cloud_plugin.rs`는 auth/resource cache key와 generation으로 늦은 discovery 결과를 구분한다. | 인증 owner를 서비스 메인으로 연결하되 프로젝트 권한을 유지한다. 기존 identity/generation/cache 구조를 확장한다. |
| Guardian | `core/src/guardian/reviewer_config.rs`는 부모 provider·catalog에서 리뷰 모델을 고른다. `review_session_setup.rs`는 부모 auth를 내부 리뷰 thread에 전달한다. `inject-auto-review.cjs`는 managed/devin 등을 제외한다. | 모델 선택·인증·catalog·pool 재사용 키·history 투영까지 독립 OpenAI reviewer로 연결한 뒤 UI 제한을 교체한다. 메뉴만 해제하지 않는다. |
| 자동 memory | `memories/write/src/start.rs`와 `ext/memories/src/extension.rs`는 `MemoryTool` gate를 공유한다. 기본값 false만으로 사용자 override를 차단하지 못한다. | Azrael runtime에서 최종 gate를 강제해 writer·주입·도구를 함께 막는다. 공유 CLI 코드를 삭제하거나 압축을 끄지 않는다. |

OAuth·keyring·계정 저장·refresh·MCP cache·Guardian의 기존 구현을 우선 재사용한다. 새로운 인증 라이브러리·provider SDK·전역 토큰 저장소는 필요하다는 근거가 없으므로 도입하지 않는다. managed helper의 일반 구조화 출력 지원 확대도 이번 해법에 필요하지 않다.

## 구현 순서·산출물·의존성

root가 공유 계약·통합·최종 수용을 소유한다. 아래는 기능 단위이며 각 단위의 코드·검증·문서를 함께 커밋한다. 기존 staged/동시 변경을 섞지 않는다. 독립 작업의 병행 여부는 승인 후 실제 소스 ownership과 build/cache 점유를 보고 정하며, 계획 단계에서는 agent나 producer를 시작하지 않는다.

### 1. 계정·기능 상태 계약과 정책 경계

- 기존 account management protocol/store에 서비스 메인 profile 참조와 monotonic revision을 추가한다. ID만 저장하고 비밀은 기존 native 보안 저장소에 둔다.
- 앱 전체는 같은 Azrael state home을 공유하는 로컬 설치의 창·프로젝트·엔진 context 범위로 해석하는 구현안을 제시한다. 프로필 저장소가 다른 별도 state home을 자동 통합하지 않는다. 개인 데이터의 클라우드 동기화는 추가하지 않는다.
- `unconfigured / checking / ready / reauthRequired / unavailable / policyBlocked`에 대응하는 명시 상태·사유를 공통 모델로 만들고 UI와 native 실행 admission이 같은 근거를 사용하게 한다. transport 실패를 logout으로 저장하지 않는다.
- 서비스 capability별 auth·subscription·adapter·policy readiness와 요청의 account/revision binding을 정의한다. 공통 `getAuthStatus`의 뜻을 바꿔 채팅 요청까지 서비스 계정으로 보내지 않는다.
- 위 조직 정책 결정에 따라 project config와 service request policy의 합성 경계를 먼저 구현한다. 설정 기본값과 강제 requirements를 구분하고 결정 불가능한 충돌은 오류로 처리한다.
- 산출물: 프로토콜·저장·상태 전이·정책 계약 및 focused 검증. 2–5의 공통 입력이다. `accounts.md`, `auto-review.md`, 관련 provider/instructions 설계에 target과 current를 분리해 반영한다.

### 2. 미인증 shell·공급자별 실행 admission·구 root 경로 정리

- pinned UI의 기존 로그인 route를 계정 화면 진입으로 정리하고 shell/일반 설정을 항상 렌더링한다. 계정 연결 경로와 관리 연결 오류·재시도를 제공한다.
- `catalog_processor`, model manager, provider picker와 요청 경계에서 유효한 연결만 노출한다. 인증 없는 bundled catalog와 저장된 default model로 새 작업을 시작하지 않는다. 공급자 장애를 정상 빈 목록으로 숨기지 않는다.
- thread 시작·resume·turn·queue·명시적 GPT role와 보조 요청에서 실행 직전 다시 확인한다. 연결 해제 후 stale UI가 보내는 요청도 차단한다. 입력 초안·기존 대화 열람은 보존하고 새 연결 후 자동 재송신하지 않는다.
- 남은 Azrael host/root 자동 인증 소비자를 정리한다. managed 로그인·명시적 import·CLI/external auth의 경계를 보존하고 import 성공/취소/부분 실패를 확인한다.
- 산출물: 무계정/다른 provider-only 실행과 자격 이전의 통합 경로. 1 이후 시작하며 3의 서비스 통합과 변경 파일을 분리한다.
- 기존 [프로젝트 실행 계정·재개 수정](../FX-01-project-account-selection/01-plan.md)을 보존한다. 무료 plan/모델 사용 불가로 A 계정의 턴이 중단된 뒤 프로젝트를 B로 전환하고 같은 기존 대화에 새 메시지 또는 명시적 재개를 보내면 B의 인증을 사용해야 한다. 저장 대화 context·AuthManager·ModelClient·queue의 오래된 snapshot이 A를 되살려서는 안 된다. 서비스 메인은 채팅 계정 선택을 덮어쓰지 않으며 두 회귀를 별도로 검증한다.

### 3. 앱 전체 OpenAI 서비스 메인과 lifecycle

- 기존 계정 및 사용량 화면에 최초 OpenAI 로그인 성공 시 메인 자동 지정, 이후 수동 전환/해제와 readiness를 추가한다. 동시 로그인은 기존 selection/revision owner에서 최초 지정 하나만 commit하며, 이미 선택된 메인을 늦게 완료된 로그인으로 덮어쓰지 않는다. 현재 채팅 계정 배지와 서비스 메인을 구분하되 기존 OpenAI 스타일·테마·접근성을 재사용한다.
- 기존 credential lease·refresh transaction·retirement를 서비스 사용에도 연결한다. 같은 자격의 chat refresh와 service refresh가 충돌하거나 한쪽 logout이 다른 연결을 되살리지 않게 한다.
- 앱 전체 selection 변경을 서로 다른 창·프로젝트·엔진 인스턴스에 revision과 함께 전파하고 오래된 알림·응답을 버린다. 한 프로필의 policy-bound manager를 다른 프로젝트에 그대로 공유하지 않는다.
- 새 요청은 실행 admission에서 최신 선택을 snapshot하고 해당 요청 동안만 identity를 보존한다. 종료 후 binding/lease를 해제하고 다음 요청은 재조회한다. 이전 요청의 401·구독 변경·지연 응답이 새 요청의 선택을 되돌리지 못한다. 401은 같은 계정의 refresh owner만 사용한다. 계정 교체·로그아웃·삭제·회복 실패를 자동 replay나 다른 계정 사용으로 해결하지 않는다. 기존 채팅 quota recovery의 명시적 opt-in 계약은 유지하며 이를 서비스 요청에 묵시 적용하지 않는다.
- 산출물: 인증 핸들·정책·catalog/cache namespace가 결합된 서비스 요청 경계와 계정 UI. 4·5가 소비하며 제품 채팅 계정 자동 전환과 분리한다.

### 4. 독립 OpenAI Guardian

- 메인 계정의 OpenAI catalog로 리뷰 모델을 선택한다. 부모가 Anthropic이면 부모 모델 fallback을 적용하지 않는다. 유효한 reviewer를 고를 수 없으면 비활성 사유를 반환한다.
- 내부 리뷰 thread에 별도 reviewer provider/model/auth와 허용된 정책을 전달한다. pool/reuse key에 서비스 identity·revision·policy·model을 포함해 다른 계정의 reviewer history를 재사용하지 않는다.
- 공개 transcript와 정확한 tool call/result만 투영하고 foreign encrypted checkpoint·reasoning을 제외한다. 기존 안전한 history 투영을 재사용하며, 충분한 근거를 만들 수 없으면 검토 실패로 처리한다. 원본 rollout은 수정하지 않는다.
- schema 검증·거절·timeout·취소·재귀 승인 금지·도구 권한을 보존한다. 시작 계정으로 진행하던 리뷰는 메인 변경으로 재실행하지 않는다. 삭제/철회가 발생한 경우 기존 retirement 중단이 우선한다.
- native 검증이 준비된 뒤 `inject-auto-review.cjs`의 provider 단순 차단과 제출 강제를 readiness 기반으로 교체한다. 항목을 숨기지 않고 비활성 사유를 hover/focus로 보여준다. 저장 선호는 보존하며 정책상 수동 승인도 불가하면 턴을 차단한다.
- 산출물: Anthropic 등 지원 채팅 공급자에서도 OpenAI가 검토하는 경로. 1·3 이후 시작하며 5의 모든 서비스가 끝날 때까지 기다릴 필요는 없다.

### 5. Apps·커넥터·cloud plugin·검색·이미지·URL 안전성 연결

- 서비스별 caller 목록을 완성한다: catalog/list/read, tool 실행, OAuth 연결/해제 UI, host HTTP token/401, plugin/skills discovery, 검색·이미지 extension, URL safety transport. 각각 token을 쓰는 최종 소비자까지 새 service owner를 연결한다.
- 기존 auth/resource generation을 재사용해 메인 변경 시 목록·도구·캐시를 무효화하고 연결을 갱신한다. 이전 도구 ID가 모델 컨텍스트에 남아 있어도 실행 시 identity·정책을 다시 검사한다. 해당 요청 결과만 원래 호출과 짝지으며 새 계정 목록에 섞지 않는다.
- 내장 web/image는 메인 계정 연결만으로 활성화하지 않는다. 실제 executor가 해당 채팅 provider에서 독립 실행 가능한지 확인하고 필요한 기존 adapter 경계를 보완한다. 인증·plan·capability·policy가 모두 성립한 기능만 노출한다. 이것이 추가 backend 개발을 요구하면 해당 차이를 승인받고 관련 부분만 보류한다.
- URL 판정 실패를 safe로 변환하지 않는다. 안전성 서비스가 없으면 원래 링크·설명으로 표시하며 로컬/첨부 이미지 경로는 보존한다.
- 일반 MCP OAuth·로컬 plugin/skill에는 무관한 OpenAI gate를 추가하지 않는다. chat와 service 각각의 조직 제한·network/residency를 유지한다.
- 산출물: 서비스별 준비 상태·인증·실행·cache/갱신 검증. 1·3에 의존한다. 이미지/검색 성공과 Apps 목록 조회 성공을 서로의 증거로 대체하지 않는다.

### 6. 자동 memory 비활성화와 보존 검증

- 사진의 `Enable Azrael memories`는 장기 기억 생성/사용 설정이다. pinned `personalization-settings-8b2df7633ad3.js`의 토글은 memory feature와 `memories.generate_memories`·`memories.use_memories`를 함께 쓴다. 두 번째 토글은 `memories.disable_on_external_context`를 반전해 MCP/검색을 사용한 대화의 기억 생성 허용을 정한다. Delete는 저장 기억 삭제로 별도이며 이번 비활성화에 자동 삭제를 포함하지 않는다.
- 장기 memory 내부에는 모델 기반 추출(phase 1), 통합(phase 2), 저장 요약·지침의 자동 주입과 선택적 전용 읽기 도구가 있다. `memories/write/src/start.rs`, `ext/memories/src/extension.rs`, `config/src/types.rs::MemoriesToml`을 대조했다. 보존 기간·처리량·추출/통합 모델 등 UI에 모두 표시되지 않는 설정도 같은 하위 시스템이다.
- 세션 압축은 별도 모델 작업이다. `core/src/compact.rs`는 managed/Devin/native 모델 stream으로 요약하며 remote compaction도 별도 경로가 있다. provider 전환용 요약도 장기 memory와 다르다. 이들 작업과 task-local `task_memory`는 유지한다. 사진의 스위치를 끈다고 모델을 쓰는 모든 요약 작업이 중단되는 것은 아니다. 실제 설치 프로필의 저장 설정·메모리 데이터는 읽거나 변경하지 않았다.
- Azrael의 최종 feature 설정에서 자동 memory를 차단한다. startup·resume·child·설정 override·장시간 background 작업의 entry와 read injection/tool 등록을 함께 확인한다.
- 기존 memory 저장 자료와 공유 CLI 기능은 유지한다. 진행 중 기존 프로세스를 임의 중단하거나 DB를 정리하지 않는다.
- 산출물: 자동 extraction/consolidation 모델 호출·주입·전용 tool이 없고, 압축·handoff·`task_memory`는 유지된 증거. 인증 서비스 구현과 독립적으로 진행 가능하지만 공통 config 변경 ownership을 먼저 나눈다.

### 7. 통합·선택한 플랫폼 수용·배포

- 빠른 source/contract 검사 후 필요한 native test 준비 compilation을 시작한다. 독립 UI fixture 준비를 병행하되 같은 cache의 중복 대형 build는 피한다.
- 제품 build/설치가 승인되면 [build playbook](../../docs/playbooks/build.md)에 따라 source·UI·engine·bridge·code-mode host 입력을 동결하고 해당 identity로 package·설치 검증을 연결한다. 오래된 엔진은 신규 service capability를 광고하지 않으므로 명시적 미지원으로 표시하고 root 인증 fallback으로 흉내 내지 않는다.
- 실계정 검증은 지정한 계정과 실제 요청 범위로만 진행한다. 패키지 성공·mock 성공·사용자 정상 사용 확인을 서로 대신하지 않는다.
- 생성 산출물은 실행 전에 기존 owner에 등록하고 검토 후 불필요한 자료를 삭제한다. 사용자 확인에 필요한 최소 recovery/check bundle만 경로·크기·목적을 알리고 보존하며, 확인 후 owner 절차로 제거한다. 정상 동작·필수 검증·정리가 끝난 범위만 완료로 보고한다.

## 누락 위험과 수용 기준

| 경계/성공 기준 | 필요한 검증 |
| --- | --- |
| 무계정·관리 엔진 실패에서도 shell·계정/일반 설정 접근 | cold start, 지연·단절·오류 상태의 host/UI fixture와 실제 설치창. 실패를 미인증 성공으로 표시하지 않는지 확인 |
| 모델/실행 admission 일치 | 무계정, OpenAI-only, Anthropic-only, 사용자 API `auth:none`, 양쪽 연결, 만료/로그아웃/재연결, stale catalog/default, queue/resume/child profile. 서버 경계에서 거절되고 입력이 재송신되지 않는지 확인 |
| root 자동 채택 제거와 이전 보존 | root 자격만 존재하는 startup/logout, 명시 import 성공·취소·실패·source retirement 실패, ordinary Codex/CLI 자격 보존. 실제 사용자 자격 대신 격리 fixture 우선 |
| 전역 서비스 메인과 프로젝트 chat 격리 | 두 프로젝트·여러 창·복수 engine instance의 동시 지정, 오래된 응답, 재시작, 같은 계정 refresh 경쟁, 다른 계정으로 교체, 만료·삭제·retirement. chat identity는 그대로 유지 |
| 중단 후 이전 계정 고정 재발 방지 | A의 유료 모델 사용 불가/무료 plan 전환 → 턴 종료 → 프로젝트 B 선택 → 같은 대화의 새 메시지·명시적 재개·queued 실행은 B 사용. 서비스는 별도로 메인 A 요청 실패 → 메인 B 선택 → 새 서비스 요청 B 사용. A의 늦은 완료/401로 B를 덮지 않고 완료한 도구를 replay하지 않음 |
| 정책 보존 | chat/service가 서로 다른 조직, 요구 reviewer/provider 충돌, network·residency 제한, 필수 cloud fetch 실패. service 선택으로 기존 프로젝트 제한이 해제되지 않는지 확인 |
| Guardian 정상·오류 동작 | 별도 OpenAI 계정으로 정상 schema·allow/deny, malformed·timeout·cancel·401·삭제, foreign history·checkpoint, reviewer pool 재사용 차단, 정책상 수동 전환 허용/금지. 모델과 auth 실제 전달 경계까지 확인 |
| Apps/plugin 결과의 identity | 목록뿐 아니라 실제 도구 요청과 401 refresh, 이전 discovery 지연, cache·MCP reconnect, stale tool ID, 연결/해제 mutation 결과 불명. 다른 계정으로 자동 replay하지 않음 |
| 웹·이미지·URL 표시 | 각 executor와 auth route, 구독/기능 미지원 사유, URL safety 실패 시 링크 유지, 로컬 첨부 표시 보존. service readiness와 채팅 provider capability를 따로 확인 |
| 자동 memory만 비활성 | 설정으로 재활성화 시도, startup/resume/child의 추출·통합·주입·도구 없음. 긴 대화 압축과 압축 후 tool 연속성·`task_memory` 실행은 별도 확인 |
| UI 접근성·오류 안내 | light/dark, 키보드 focus·hover 사유, 메인/채팅 계정 식별, 연결 실패 복구, 미인증 모델 설정과 일반 설정의 분리 |

기존 `scripts/test-account-settings.cjs`, `test-provider-model-picker.cjs`, `test-provider-accounts-host.cjs`, `test-auto-review.cjs`, `test-url-safety-transport.cjs`, `check-accounts.mjs`, `check-auto-review-engine.mjs`와 `engine.shared-engine.project-accounts`의 기존 검사를 먼저 확장한다. 변경된 memory gate와 압축은 해당 native owner 검사를 선택한다. 실행 직전 feature inventory와 `project-maintenance.json`의 현재 bundle/필수 검사·입력을 확인하고 plan 결과를 검토한다. 위 파일명은 실행 후보이며 이번에 실행했다는 뜻이 아니다.

영구 검사는 이후 작업에서 재발할 구체 오류—auth owner 전달 누락, 다른 identity의 cache/pool 재사용, UI만 바꾸고 native admission을 누락, pinned UI 갱신 중 gate 누락—를 막는 최소 기존 검사에 연결한다. 일회성 검증용 fixture·raw log는 사용 종료 후 정리하며 단순 test count 목표를 두지 않는다.

## 플랫폼·구현 소유·미검증 범위

의미와 공통 구현 대상은 로컬 Windows x64, glibc Linux x64, macOS ARM64다. credential backend·파일 권한·cross-process lock·IPC는 기존 플랫폼 adapter를 재사용한다. OS/ABI 최소 버전은 [다중 플랫폼 계약](../../docs/architecture/multi-platform.md)과 release gate를 따르고 임의로 확정하지 않는다. Intel Mac·Linux ARM64·musl·WSL 제품 지원·Remote SSH·container는 이번 지원 확장 범위가 아니다.

공통 변경에는 Windows 회귀를 포함한다. 각 대상 OS의 native keyring/refresh/IPC와 실제 host 수용은 그 환경에서 확인해야 한다. 현재 조사 환경만으로 다른 플랫폼 수용을 주장하지 않는다. 한 플랫폼의 설치를 먼저 검증하더라도 다른 플랫폼 공통 계약을 삭제하지 않고 미검증으로 명시한다.

소유 문서는 `accounts.md`의 미인증 shell·project selection·service identity, `auto-review.md`의 별도 reviewer, `managed-providers.md`의 공개 history 투영과 provider capability, `instructions.md` 및 memory owner의 runtime gate다. 실제 변경에 대응하는 `ui.account-settings`, `ui.provider-model-picker`, `ui.auto-review`, `ui.url-safety-transport`, `engine.shared-engine`, `tool.task-memory` 등 기존 feature mapping을 우선 확장한다. 아직 바뀌지 않은 제품을 current로 표시하지 않는다.

음성·녹음·Remote Control 등 모든 잠재 기능의 전수 수용은 이번 조사에서 확정하지 않았다. 구현 첫 caller audit에서 실제 활성화된 OpenAI 인증 소비자가 더 발견되면 위 서비스 분류에 넣고 범위가 바뀌는 부분만 검토한다. 관리 계정 저장만으로 로그인·plan·서비스 성공을 판단하지 않는다.

## 이번 계획 작업의 결과·다음 단계

원 세션의 마지막 확정 사항과 기존 설계 기록을 읽고 현재 프로젝트 인증·명시 import·Apps 인증·Guardian·memory gate 코드를 대조했다. 기존 `01-plan.md`를 현재 계획으로 정리했으며 별도 계획/설계 승인을 중복 생성하지 않는다. 새 임시 파일·실행 fixture·자격 사본·다운로드는 만들지 않았다.

문서 검증은 변경 diff·공백·UTF-8·로컬 참조 경로와 확정 결정/구현 상태의 구분으로 한정한다. 제품 테스트·실제 추론·서비스 요청·build·설치·계정 변경은 실행하지 않았다. 계정·정책 세 결정은 반영됐고 메모리 기능 구분도 조사했다. 실제 구현에서는 위 결정과 기존 계정 재개 수정의 보존 조건을 그대로 이어간다.
