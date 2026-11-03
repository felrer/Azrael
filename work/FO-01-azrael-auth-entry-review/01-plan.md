상태: 영향 조사 완료·부가 기능 설계 진행 중 — 미인증 shell·공급자별 활성화·기존 자격의 명시적 이전, OpenAI 미연결 시 Approve for me 비활성 및 사유 안내, 자동 memory 비활성 및 대화 압축 보존, 부가 서비스용 메인 OpenAI 계정과 Anthropic 대화도 해당 계정으로 검토하는 방향은 합의됐다. 클라우드 조직 정책 제거 범위는 제안이다. 제품 코드·계정·설정 변경은 수행하지 않았다.

# Azrael 인증 진입 경로 정리와 미인증 실행

## 목표·권한

기존 인증 구현의 존재·다중 계정과의 관계·제거 영향을 확인한다. Azrael은 인증 없이 실행 가능해야 한다. 미연결 상태의 모델 목록은 비우고 모델·추론 설정과 채팅은 사용할 연결이 준비된 뒤 활성화한다. 계정 연결·일반 환경설정은 미인증에도 허용하며 OpenAI 없이 다른 공급자·사용자 API 연결만 유효해도 해당 모델을 사용할 수 있다.

현재는 영향 검토·설계 단계다. 자격·계정·설정 변경, 로그인·로그아웃, 인증 경로 제거·빌드·설치·실제 추론은 수행하지 않는다. 직전 회색 화면의 원인이 구 인증이라고 가정하지 않는다.

## 범위·소유

개발 source는 docs/ops/development.md가 지정한 engine/의 통합0.162.0이다. 현재 설치 바이너리와 완전히 동일하다는 의미가 아니다. 동작의 의미는 지원 대상 Windows x64·Linux x64·macOS ARM64 공통으로 검토하며 실제 조사는 Windows x64 호스트에서 수행한다. 설치·다른 OS·live 인증 검증은 별도다.

root는 UI·호스트·모델 목록과 설계 결정을, auth_path_inventory는 native/managed 인증과 직접 호출자의 읽기 조사를 맡는다. 원문 자격·계정 상태 접근과 추가 위임은 금지했다. 독립 조사를 병행하며 각각 코드 근거만 전달한다.

## 현재 확인된 구조

| 구성 | 확인된 역할 | 제거 검토 |
| --- | --- | --- |
| Native AuthManager·OAuth·보안 저장·refresh·ExternalAuth | 관리 프로필도 재사용하는 공통 인증 기반 | 통째 제거 대상 아님 |
| 기존 root 단일 계정의 독립 로그인·자동 채택 경로 | root home의 native 인증과 managed profile 선택을 함께 지원 | managed 계정 유지 전제로 별도 진입·fallback 정리 제안 |
| Azrael 관리 프로필 | profile별 auth home·선택·전환·사용량·재인증 | 유지 |
| native account/read·getAuthStatus | 현재 실행 인증 조회와 호스트 인증 요청 공급 | 이름만 보고 legacy로 제거하면 안 됨 |
| 기존 UI 로그인 route gate | OpenAI authMethod/requiresAuth가 앱 본문 진입 결정 | 미인증 shell 접근과 기능별 readiness로 변경 필요 |
| 계정 관리 UI | 별도 계정 추가·전환·재인증, 현재 root 인증 capture 진입 | 통합 진입점으로 활용 가능 |
| MCP OAuth·기타 provider/API 인증 | 별개 서비스 연결에 필요한 인증 | 일괄 삭제·OpenAI 로그인으로 묶지 않음 |

엔진은 인증 없는 AuthManager와 initialize를 지원한다. 조사한 thread/start·turn/start 요청 처리에 전 공급자의 공통 로그인 차단이 있는 구조는 아니며, 후속 provider 실행에서 실패할 수 있다. 앱 전체 차단 해제와 실행 가능한 모델별 admission은 구분해야 한다.

## root 조사 근거

- scripts/integrated-azrael-entry.cjs:123–168: runtime/engine 검증 후 native host와 계정 모듈을 활성화한다. 이 wrapper 자체에는 사용자 로그인 필수 검사 없음. host-private selection/default paths를 두 모듈에 전달한다.
- extensions/azrael-ex/src/extension.ts:194 부근: service.connect 실패는 관리 기능 오류로 보고한다. 계정 추가 화면과 일반 shell 활성화의 연결 상태 처리를 검토할 경계다.
- extensions/azrael-ex/src/accountService.ts:44–79: management connection/instance 검증과 변경 가능 여부를 별도 상태로 관리한다. transport failure를 미인증 상태와 동일시하면 안 된다.
- 고정 upstream UI artifacts/upstream-ui/26.1007.21434/webview/assets/app-initial-7a199c66e670.js의 Mgn은 account와 requiresOpenaiAuth를 authMethod/requiresAuth로 변환한다. Ski는 로딩 중 빈 fragment, authMethod 없음+requiresAuth일 때 /login redirect, 그 외 본문 route를 반환한다. minified 원본을 변경하지 않고 해당 함수만 좁게 읽었다.
- 고정 upstream host out/extension.js의 fQ/U6e 인증 제공자는 getAuthStatus(includeToken:true)로 토큰을 얻고 account/updated 때 갱신한다. HTTP wrapper sF가 이를 사용하고401에 refreshToken:true를 요청한다. UI 진입 gate와 공통 인증 공급자는 다른 책임이다.
- scripts/inject-account-settings.cjs:3–8은 기존 설정 usage route에 통합 계정 모듈을 연결한다. provider-model-picker.cjs:59–101은 model/list를 페이지 조회하며 account/updated 때 재조회한다(166 부근). 이 캐시도 연결 변경·로그아웃 뒤 권한 없는 모델이 남지 않도록 확인해야 한다.
- app-server/src/request_processors/catalog_processor.rs:178–233은 Gateway 특화 인증 확인 뒤 model/list를 수행한다. models-manager/src/manager.rs:450–476에는 현재 identity의 원격 목록이 없을 때 bundled fallback 경로가 있다. OpenAI 미인증의 목록을 확실히 비우려면 해당 provider의 readiness에 따른 목록 노출을 다뤄야 한다.
- extensions/azrael-ex/src/accountView.ts:62–67과 usageView.ts:638에는 기존 captureCurrent·계정 추가·switch·재인증 진입이 있다. 기존 root 사용자 자료를 옮길 수 있는지 engine 쪽 의미를 추가 확인한다.
- docs/architecture/custom-api-models.md:7은 인증 없는 사용자 API 연결도 지원한다. 따라서 ‘사용 가능한 연결’은 OpenAI 로그인 여부와 다르고 auth:none으로 명시 구성한 연결을 임의 삭제·차단하지 않아야 한다.

## 합의된 동작 방향

- 계정 없음·미인증이어도 Azrael shell·계정 연결·일반 환경설정은 열린다.
- 사용 가능한 모델이 없으면 모델 목록은 빈 상태이고 송신·모델/추론 설정은 비활성화한다. 계정 연결 경로는 항상 접근 가능해야 한다.
- 유효한 다른 공급자·사용자 API만 있어도 해당 모델을 노출한다. OpenAI 인증이 전체 사용의 필수 조건이 되지 않는다.
- 설정·자격 변경이 다른 창·공급자의 정상 인증을 취소하지 않도록 현 소유 경계를 보존한다.
- 인증 없음·확인 중·재인증 필요·엔진 연결 실패를 구분한다. 연결 실패나401을 회색 화면·무한 빈 fragment의 성공 상태로 처리하지 않는다.

## 기존 root 인증의 구체 동작

engine 조사 owner의 추가 근거:

- app-server/src/lib.rs:443–450과 login/src/auth/manager.rs:3034–3079: Azrael 관리 모드의 shared_for_azrael은 root home 인증을 먼저 읽는다. azrael.rs:104–166의 startup restore는 선택 프로필이 없으면 바로 반환하므로 root ChatGPT 인증이 실행 인증으로 남을 수 있다. 정상 managed switch는 root 저장 자격을 삭제하지 않는다.
- account_processor/azrael.rs:169–229·349–363과 login/src/auth/profiles.rs:229–257: captureCurrent는 현재 native ChatGPT 인증을 새 profile home의 보안 저장으로 복사·확인하고 retire_root_auth:true로 전환하며 root logout을 수행한다. 일반 switch와 다른 명시적 이전 절차다.
- account_processor.rs:1367–1458: 활성 profile logout 후 external auth를 지우고 root manager reload를 수행하므로 보존된 root 인증이 다시 나타날 수 있다. 따라서 logout RPC 전체를 지울 것이 아니라 관리 계정 logout·명시적 미선택 상태를 보존하면서 root fallback을 막아야 한다. 이 경로가 이번 회색 화면을 유발했다는 의미는 아니다.
- account_processor.rs:782–839·863–883의 native ChatGPT browser/device-code login은 root home을 대상으로 한다. azrael_login.rs:13–55·142–183의 managed login/reauth는 별도 profile/staging home에서 같은 native OAuth 기반을 쓴다.
- account_processor.rs:1508–1594의 account/read·getAuthStatus와 profiles.rs:552–599의 resolve/refresh는 공통 활성 인증 접점이다. 기존 RPC 이름만으로 제거할 수 없다.
- 추가 연결 기능은 account_processor/azrael.rs:551–677 및 account_processor.rs:406–467의 cloud config/residency·plugin/skills 캐시·MCP runtime 갱신과 usage 인증 갱신에 이어진다. MCP OAuth 자체는 다른 자격·서비스이므로 제거 대상이 아니다.
- API-key·Bedrock·experimental chatgptAuthTokens 같은 native variants가 같은 RPC에 존재한다(account_processor.rs:470–779·1222–1277). 이번 GUI 진입 정리와 이름만으로 함께 삭제하지 않는다. CLI·자동화·외부 인증 공급의 지원 범위는 보존하고 실제 영향이 있으면 별도 범위 결정이 필요하다.

위 내용은 source-only 조사다. shared_for_azrael의 환경변수 API 키 로딩은 false로 전달되므로 단순히 OPENAI_API_KEY가 모든 GUI 인증의 원인이라고 추정하지 않는다. profile 복원 실패 중 일시 오류·실제 inference 단계의 provider 인증 실패 전체는 실행 검증하지 않았다.

## 제거 범위 제안 — 미확정

다중 계정은 유지하고 독립 root 로그인 UI/자동 fallback만 정리하는 방향을 우선 검토한다. 선택된 계정의 native AuthManager·OAuth/refresh·keyring·현재 계정 조회·호스트 인증 공급자는 유지한다. getAuthStatus라는 기존 RPC를 삭제하는 것과 구 단일 계정 로그인 진입을 제거하는 것은 다르다.

기존 자격을 자동 삭제하거나 ordinary Codex 자격을 가져오지 않는다. 기존 root 저장 인증은 보존하고 사용자가 명시적으로 가져온다. 성공적인 이전 후 기존 root 자격 정리는 existing capture의 소유자·검증·실패 보존 계약을 유지한다. 실행 시작 시 root 인증 자동 채택을 막으면 현재 captureCurrent가 읽는 활성 auth가 사라질 수 있으므로, 명시적 이전용 안전한 읽기와 실행 인증의 분리가 필요하다. 합의된 동작은 [accounts.md](../../docs/architecture/accounts.md#authentication-independent-shell-and-provider-readiness)의 target 섹션에 반영했다. 기존 current 절차는 설치·구현으로 검증되기 전까지 target과 구분한다.

## 구현 범위 제안·검증 조건

1. 제거 제안: Azrael GUI의 독립 root 브라우저/device-code 로그인 진입·전체 앱을 막는 구 로그인 route gate·root 인증의 자동 실행 fallback. managed 계정 추가·재인증과 공통 native 인증은 유지한다. native RPC 전부 삭제·CLI 로그인·사용자 API·외부 token 주입 제거는 제안 범위에 포함하지 않는다.
2. 수정 제안: 기존 계정 서비스와 provider catalog를 재사용해 shell 활성화와 provider별 모델/채팅 admission을 분리한다. 관리 계정 logout 뒤 root 인증이 되살아나지 않게 하고 미인증 모델 목록과 UI 캐시·저장된 모델 선택을 일관되게 처리한다. 인증 오류를 정상 빈 목록과 구분한다.
3. 이전: 기존 root 정보는 명시적 가져오기 전까지 사용하지 않고 보존한다. 현재 계정 저장 기능을 실행 인증 자동 채택에 의존하지 않도록 분리해 재사용할 수 있는지 구현 준비에서 확인한다. 기존 사용자에게 한 번 관리 계정 연결 또는 가져오기가 필요할 수 있다.
4. 보존: selected account의 token 조회/401 refresh, OAuth·keyring, usage, cloud config·residency·plugin/skills·MCP 갱신, 공급자별 인증, 기존 계정 전환·작업 admission·retirement와 다중 창 격리. managed-profile logout의 자격 revoke/lifetime 의미는 별도 무단 변경하지 않는다.
5. 검증할 시나리오: 자격 없는 cold start·연결 확인 실패에도 shell 접근, 계정 추가/일반 설정 접근, 미인증 모델 목록/송신/추론 설정 비활성, 다른 provider/API-only 및 auth:none 연결, 인증 후 재조회, 만료/로그아웃 뒤 stale catalog/default model 차단, 명시적 이전 성공/취소/실패 보존, 창별·provider별 격리, 기존 인증 갱신/관련 서비스 보존. 구현에 해당하는 source/native/UI/정확한 패키지 확인과 Windows 회귀를 선택해야 하며 다른 OS의 실제 수용을 가장하지 않는다.

현재 코드를 바꾸거나 위 테스트를 실행하지 않았다. 검토 결과 제안하는 제거 경계와 공통 기반 보존을 사용자에게 설명한 후 구현 범위를 확정해야 한다. 인증 없이 앱을 열려면 requiresOpenaiAuth를 무조건 false로 만드는 식으로 실제 provider 인증/네트워크 보안을 완화해서는 안 된다.

## 추가 조사 — Anthropic 등 provider-only 기능 의존성

사용자가 `Approve for me`를 예로 들어 기존 root 인증 제거 뒤 다른 공급자만 연결한 경우의 기능 영향을 추가 요청했다. 이 절은 source-only 영향 조사와 해결안이며, 공급자 지원 확대·서비스 계정 연결·코드 변경 승인으로 해석하지 않는다. 구 단일 계정의 자동 채택을 끄는 것과 관리 OpenAI 프로필·공통 인증을 없애는 것은 다른 작업이다.

### 확인된 사례와 해법 제안

| 기능 | 확인된 조건·영향 | 해결안 — 제안 |
| --- | --- | --- |
| Approve for me / Guardian | 현재 UI는 managed/·devin/ 모델과 비OpenAI provider를 제외하고, 저장 선호는 보존하며 제출의 유효 리뷰어를 user로 제한한다. 이는 기존 미지원이다. Guardian은 부모 설정·유효 인증과 provider 리뷰 모델을 사용하며, 별도 OpenAI 계정을 추가했다는 사실만으로 그 계정을 쓰지는 않는다. | 지정한 메인 OpenAI 계정과 별도 OpenAI 리뷰어 모델로 다른 공급자 대화도 검토하도록 연결한다. 미연결·만료·준비 미완료에는 비활성 및 사유를 표시한다. 실패를 승인으로 처리하지 않는다. |
| 구조화 JSON 출력이 필요한 보조 작업 | managed_runtime dispatch는 prompt.output_schema 또는 final_output_json_schema가 있으면 helper 호출 전에 명시적으로 거부한다. 따라서 모델 로그인 정상 여부만으로 해당 작업을 활성화하면 실패한다. | 선택된 해법은 Guardian을 별도 OpenAI 경로로 보내고 자동 memory를 비활성화하는 것이다. 이를 위해 managed schema 지원 확대까지 수행하지 않는다. 향후 그 지원을 추가할 경우 엔진·요청 protocol·helper·adapter·결과 검증 모두가 필요하다. |
| 자동 memory 추출·통합 | 일반 managed 채팅과 다른 호출 경로다. Phase 1은 config.model_provider로 만든 ModelClient를 직접 사용하고 strict output schema가 필수다. managed slug는 이 client에서 거부된다. override가 없으면 provider 기본 추출·통합 모델은 각각 gpt-5.6-luna·gpt-5.6-terra다. | Azrael에서는 이 자동 memory 기능을 비활성화한다. 대화 압축 및 별도 로컬 task_memory 기능은 유지한다. 상세 비활성 경계는 아래 합의·미결 설계 절이 소유한다. |
| Apps·ChatGPT 커넥터·hosted cloud plugins | Apps는 ChatGPT/Codex backend 인증이 있어야 켜진다. 사용자가 구성한 일반 MCP는 해당 MCP의 인증 경로가 별도다. | 관리 OpenAI 프로필을 이 서비스의 명시적 인증으로 연결하거나, 별도로 지원되는 직접 MCP/OAuth 연결을 사용한다. Anthropic 토큰을 OpenAI 서비스에 보내지 않는다. 로컬·일반 MCP·파일 기반 skill/plugin은 이 서비스와 구분해 보존한다. |
| 내장 웹 검색 | 내장 executor는 OpenAI/actor 인증 또는 standalone search 지원 provider 조건과 현재 provider의 API auth를 사용한다. 채팅 모델에 도구를 붙일 수 있다는 사실만으로 검색 backend가 생기지 않는다. | 검색 구현을 서비스별 capability로 판단하고 지원되는 검색 adapter/MCP를 연결한다. 기존 내장 서비스를 사용할 경우 그 서비스의 유효 인증을 명시한다. namespace·결과·출처·권한 계약까지 확인해야 한다. |
| 내장 이미지 생성 | app-server가 확장을 등록하지만 core의 노출 조건에는 provider image_generation capability·image modality·OpenAI actor/backend 인증·일부 plan 제한이 있다. 이미지 입력 지원은 이미지 생성 지원과 다르다. | 이미지 생성 backend와 채팅 provider를 분리해 검증된 서비스/API/MCP 연결을 사용한다. 필요한 서비스 인증이 없으면 해당 기능의 이유를 표시한다. Anthropic의 이미지 이해 기능만으로 생성 지원을 선언하지 않는다. |
| 외부 이미지 URL의 인라인 표시 | 현재 URL safety 판정은 ChatGPT backend의 /ecosystem/url_safe 호출이며 호스트 HTTP 인증 공급자와 연결된다. 미인증 시 판정 실패 가능성이 있다. | 독립된 동등 안전성 판정 adapter를 검토하거나 해당 서비스 인증을 명시한다. 판정 불가를 safe:true로 바꾸지 않는다. 판정이 없을 때 인라인 렌더링 대신 링크/설명 표시를 유지하는 경로를 구분한다. |
| Cloud Tasks·Remote Control | Cloud Tasks CLI는 독립 AuthManager로 ChatGPT 인증을 요구한다. 일반 Remote Control도 ChatGPT backend+account ID를 요구하지만 Azrael window context는 현재 handle이 없어 이미 미지원이다. | 앱 fallback 제거와 CLI 자격 삭제를 구분한다. CLI는 이번 제거 범위 밖이며 root 자료는 명시 이전 전 보존한다. 원격 기능을 제공하려면 별도 서비스 인증/실행 adapter가 필요하다. 현재 미지원 기능을 제거 회귀로 집계하지 않는다. |
| 클라우드 조직 설정·요구사항·residency | 적격 ChatGPT Business/Education/Enterprise 인증으로 cloud config를 가져오는 경로가 있다. Anthropic-only가 그 조직 identity를 대체하지 않는다. | 해당 cloud policy의 계정 scope와 로컬·프로젝트 정책을 구분한다. 인증 오류 시 기존 필수 정책을 조용히 해제하지 않고 정책 소유자의 동작을 유지한다. 다른 계정의 캐시를 적용하지 않는다. |
| 하위 agent·일반 코드 Review·Plan | 기본 child model/provider는 부모를 상속하며 Review는 review_model이 없으면 부모 모델, Plan 기본 preset은 model override가 없다. 명시 role/task profile은 다른 모델을 지정할 수 있다. | 기본 상속을 보존하고 명시된 GPT profile을 실행할 때 필요한 공급자 연결을 사전에 확인한다. 연결이 없다고 다른 계정·모델로 자동 대체하지 않는다. 일반 코드 Review와 Guardian 승인은 구분한다. |

### 구조화 출력의 직접 부족점

`engine/codex-rs/core/src/managed_runtime.rs:245`는 `managed providers do not support output schemas`로 요청을 거부한다. Devin native_runtime.rs:189에도 별도 제한이 있다. Guardian core review_session.rs:760–776 및 ext/guardian-reviewer/src/settings.rs:70–107은 final output schema를 설정하므로 메뉴 제한만 풀어서는 동작하지 않는다.

추가로 `providers/opencodex/inference.ts:221–273`의 projectRequest는 parsed.options에 reasoning·parallel 설정만 넣고 textFormat/schema를 연결하지 않는다. vendor Anthropic adapter의 json_schema→output_config.format 변환(anthropic.ts:998–1009)은 존재하지만 현재 projection에서 해당 입력이 만들어지지 않는다. Claude model-info의 structured_outputs:false도 확인했다. 따라서 native gate 제거만으로도 지원이 완성되지 않는다. app-server의 실제 contributor 등록은 extensions.rs:96의 guardian-v2이며 core/guardian은 그 host/runtime 경계다.

일반 코드 Review의 tasks/review.rs:138은 final_output_json_schema를 None으로 두고 후속 텍스트 파서를 사용한다. 모든 review 기능이 같은 schema 제한을 받는다고 일반화하지 않는다.

### 선택 계정 대신 root 자격을 다시 읽는 경로

Apps 목록의 일부 threadless 경로는 현재 선택된 AuthManager를 전달받지 않고 `AuthManager::shared_from_config`로 새 관리자를 만든다(core/src/connectors.rs:118–132·207–252). apps_processor.rs:199–218 및 plugins.rs:1788–1804가 이 함수를 호출한다. shared_from_config→shared_from_auth_config는 별도 manager를 생성해 config의 인증 저장을 읽는다(login/src/auth/manager.rs:3027·3083 부근). 앱 최초 생성 지점만 바꾸면 이 소비자가 예전 root 인증을 계속 읽거나, 관리 계정의 인증을 놓칠 위험이 있다. 실제 설치에서 계정 누출이 재현됐다는 의미는 아니다.

해결안은 GUI 내부 기능이 명시적으로 선택된 창/서비스 인증 owner를 전달받도록 묶고 root 저장 자격의 조회는 명시적 이전 기능에 한정하는 것이다. CLI·외부 인증의 기존 계약까지 일괄 제거하지 않는다. Apps/도구 cache identity·갱신·401 recovery도 같은 owner에 연결해야 한다.

### 기타 근거·검증 한계

- Guardian: scripts/inject-auto-review.cjs:11–23의 UI/제출 게이트, core/src/guardian/reviewer_config.rs:84–125와 review_session_setup.rs:127–162의 모델·인증 상속. 필수 schema 오류·timeout에서 작업을 자동 허용하지 않는 기존 계약을 보존한다.
- Apps: features/src/lib.rs:571의 apps_enabled_for_auth, codex-mcp/src/mcp/mod.rs:344의 host_owned_codex_apps_enabled, connection_manager/startup.rs:22–33의 서버별 명시 ChatGPT auth 선택. cloud plugin은 ext/mcp/src/cloud_plugin.rs에서 별도 auth cache key를 사용한다.
- 검색·이미지: ext/web-search/src/extension.rs:41–54와 tool.rs:103–116, ext/image-generation/src/extension.rs:41–51·88–112, core/src/tools/spec_plan.rs:840–879. app-server/src/extensions.rs:96–103에서 실제 확장 등록을 확인했다. 설치 계정으로 호출하지 않았다.
- URL safety: scripts/url-safety-transport.cjs의 endpoint/헤더 보존과 고정 UI app-initial-c014f9ee4429.js의 apr 함수, 고정 host out/extension.js의 sF HTTP 인증 consumer를 좁게 확인했다. backend는 안전 판정 service이며 임의 허용으로 대체하지 않는다.
- cloud config: cloud-config/src/service.rs:52–60·199–224, app-server/config_manager.rs:178–225. Remote Control: app-server-transport/remote_control/auth.rs:28–44·98–142 및 azrael_shared_server.rs:515–518. Cloud Tasks CLI: cloud-tasks/src/util.rs:79–130.
- child/profile/Plan/Review: core/src/agent/child_config.rs:155–180·220–264, role_profile.rs:69–102, tasks/review.rs:99–138, models-manager/src/collaboration_mode_presets.rs:6–22. 사용자별 실제 profile 값은 읽지 않았다.

- 자동 memory: memories/write/src/phase1.rs:161–170·310–314, runtime.rs:325–380의 direct ModelClient 경로, core/src/client.rs:2349–2354의 managed slug 거부, model-provider/src/provider.rs:97–101·138–146의 기본 모델, phase2.rs:344–351 및 runtime.rs:415–438의 내부 thread를 대조했다. 일반 채팅은 core/src/session/turn.rs:2818–2830에서 managed_runtime으로 분기하므로 config.model_provider만으로 같은 라우팅이라고 추론하지 않는다. task_memory handler는 로컬 dispatch다. 실제 사용자 override·인증 설정은 읽지 않았다.
- 압축: core/src/compact.rs:279–287과 compact_remote_v2.rs:389–411에는 provider 기반 분기가 있다. 모든 managed provider의 실제 압축 성공을 확인한 근거는 아니며 일반 채팅 성공으로 압축 성공을 대신 판정하지 않는다. 모델별 긴 대화·압축 후 도구 연속성은 구현 단계의 회귀 항목이다.

음성/녹음 UI 등 고정 bundle 안의 추가 구성 요소는 코드 존재만으로 Azrael에서 실제 제공된다고 판단하지 않았다. 이번 표는 확인된 의존 사례이며 전 기능 완전 감사 또는 실제 공급자 수용 검증이 아니다.

### 통합 해법·수용 조건 제안

창을 여는 상태, 채팅 모델 연결, 부가 서비스 인증을 별개로 판정한다. 기능의 사용 가능 여부는 실제 adapter·모델 capability·해당 서비스 인증·정책 조건을 함께 사용하며 ‘아무 provider나 로그인됨’ 또는 전역 OpenAI 로그인 여부만으로 결정하지 않는다. 이는 사용자가 합의한 공급자별 활성화를 구체화하는 제안이며 새 서비스 계정 선택 UI나 Anthropic Guardian 지원의 구현 승인은 아니다.

1. GUI의 root 자격 재조회 소비자까지 현재 창의 인증 owner를 전달하고, root 자격은 명시적 이전에서만 읽는다. CLI 등 범위 밖 소비자는 별도로 보존한다.
2. provider로 옮길 수 있는 기능은 해당 모델의 일반 추론·구조화 출력·보조 thread를 검증된 경로로 연결한다. 지원하지 않는 capability를 true로 표시하거나 다른 계정·모델로 조용히 대체하지 않는다.
3. OpenAI 서비스 자체가 필요한 기능은 명시적으로 선택된 관리 OpenAI 서비스 계정 또는 검증된 대체 API/MCP 연결을 사용한다. 서비스 계정이 없으면 그 기능의 제한 이유만 표시하며 일반 채팅·설정·shell은 유지한다.
4. 확인 시나리오는 무계정, Anthropic-only, OpenAI-only, 양쪽 연결, 선택 서비스 계정 로그아웃·만료·401, 명시적 GPT role/보조 모델, window별 cache 격리다. Guardian 정상 schema·잘못된 schema·timeout·거부 및 필수 정책, memory 추출·통합, Apps 조회/인증 갱신, 검색·이미지·URL 판정과 긴 대화 압축을 각각 검사한다. 지원 전 수동 승인 전환이 허용되는 범위는 기존 정책을 따른다.

이번 변경은 조사 기록만 추가했다. 제품 코드·계정·설정 변경, 실계정 요청, 모델/성능 실험 및 build는 실행하지 않았다. 문서 diff·공백·UTF-8 검사로 기록을 검토하며 source-only 결론과 미검증 설치·타 OS 수용을 구분한다.

## 부가 기능의 합의·미결 설계

현재 설계 논의의 후속이다. 확정된 기능 제한·계정 선택·리뷰어 경계는 설계에 반영하며 클라우드 정책 제거 제안을 제품 구현 승인으로 확대하지 않는다. 동작 의미는 공통 desktop 대상이며 Windows source를 조사했다.

### 합의된 기능 제한

- `Approve for me`: 사용할 메인 OpenAI 계정이 없으면 메뉴 항목을 숨기지 않고 비활성화한다. hover 및 키보드 focus로 구체 사유를 제공한다. 미연결은 ‘OpenAI 계정을 연결해야 사용할 수 있습니다’, 메인 미지정은 메인 계정 선택 필요, 만료는 재인증 필요, 리뷰어 모델·설정 미준비·정책 제한은 해당 실제 이유를 구분한다. 기존 선호를 지우지 않으며 실제 턴 제출에도 같은 유효성 검사를 적용한다. Anthropic 등 다른 공급자 대화도 메인 OpenAI 계정으로 검토한다. 현재 managed 대화에 Guardian을 붙이는 것만으로는 동작하지 않으므로 독립 OpenAI 리뷰어 연결은 필요한 구현 범위다.
- 자동 memory: 대화 압축과 다른 장기 기억 추출·통합 기능을 Azrael에서 비활성화한다. 추출·통합 background 모델 호출, 해당 memory 요약의 자동 주입과 전용 memories 도구를 같은 기능 경계로 비활성화하는 방향이다. 기존 저장 자료를 삭제하는 작업은 포함하지 않는다. 일반 대화 압축, task-local `task_memory`, 작업 기록·요약은 유지한다.
- 재사용 근거: features/src/lib.rs:1230 부근의 MemoryTool(`memories`) 기본값은 false지만 기본값만으로 설정 재활성화를 막지는 않는다. memories/write/src/start.rs:24–40은 같은 feature gate에서 추출·통합 시작을 차단하고, ext/memories/src/extension.rs:48은 read-path 주입·전용 도구의 enablement를 판단한다. Azrael runtime 경계에서 해당 기능이 켜지지 않게 하는 구현을 선택할 수 있으며 공유 CLI 구현 삭제는 필요하지 않다. 실제 비활성 및 압축 보존 검증은 아직 하지 않았다.

### 부가 서비스 계정과 리뷰어 — 합의된 방향

Apps·ChatGPT 커넥터·OpenAI 기반 검색/이미지 등 부가 서비스는 지정된 OpenAI 서비스용 메인 계정 하나를 사용하며 채팅 공급자 선택과 분리한다. 기존 관리 프로필·인증 갱신 owner를 재사용할 수 있으나 서비스 계정 인증 owner는 채팅의 현재 인증과 분리한다. 메인 계정 변경이 진행 중 채팅의 provider/model/auth를 덮어쓰면 안 된다. 서비스용 메인 지정은 기존 root 단일 계정 자동 채택을 복원하는 것이 아니며 관리 프로필의 명시적인 선택이다.

기존 기능의 다중 계정 저장·명시적 서비스 계정 전환은 유지할 수 있다. 서비스 계정 변경 시 도구 목록·계정별 cache·진행 중 서비스 요청·401 갱신도 같은 계정 owner에 묶어야 하며 기존 캐시 재사용으로 다른 계정의 결과를 노출하지 않는다. 미연결·만료·삭제된 서비스 계정은 관련 기능만 제한하고 다른 provider 채팅·일반 MCP·로컬 플러그인·설정은 유지한다. 저장된 계정이 있다는 것만으로 로그인·구독 자격·기능 사용 가능을 판단하지 않는다. 계정 만료 시 다른 저장 계정으로 임의 대체하지 않는다.

`Approve for me`는 Anthropic 등 다른 공급자 대화도 메인 OpenAI 계정으로 검토한다. 부모 인증 상속과 별도로 OpenAI reviewer model/provider/auth와 구조화 응답 검증을 연결한다. 따라서 managed helper의 schema 미지원을 해제해 Anthropic으로 검토를 보내는 작업은 이 목적에 필요하지 않다. 검토 근거가 OpenAI에 전송되고 OpenAI 사용량이 발생한다는 설명을 포함해 이 방향이 선택됐다. 리뷰어의 도구·읽기 권한·승인 판단·timeout/실패 시 미실행 계약은 보존한다. 진행 중 리뷰 요청은 시작 때의 계정에 귀속되며 계정 교체로 재실행하지 않는다. 새 리뷰는 새 계정의 readiness를 검사한다.

### 클라우드 조직 정책 — 제거 범위 제안

권장 범위는 Azrael GUI/runtime의 클라우드 조직 config·requirements 수신과 적용을 제거하는 것이다. startup loader 설치, 계정 전환 시 loader 재등록, identity-bound cloud cache의 적용과 cloud-origin residency 요구를 함께 다뤄야 한다. 기존 계정 인증·로컬/프로젝트/관리자 제공 권한 및 샌드박스 정책의 평가기는 보존하며 OpenAI 서비스 서버가 강제하는 조직 권한은 클라이언트 변경으로 해제되지 않는다. 공유 crate·CLI 전체의 조직 정책 코드 삭제까지 확대하지 않는다.

근거: cloud-config/src/service.rs:199–224의 시작 시 인증·cache/fetch 경로, app-server/src/config_manager.rs:178–225의 loader 교체·clear 함수, request_processors/account_processor/azrael.rs:657–677의 계정 변경 후 loader 재연결을 확인했다. clear 함수가 있다는 사실만으로 모든 cloud 적용 지점이 제거된다고 단정하지 않는다. 실제 구현 전 최초 loader 생성·config merge·기존 cloud 데이터 잔존 적용을 대조해야 한다. 개인용 Azrael에서 조직 관리 기능을 제공하지 않는 제품 범위 변경으로 명시하며 구현 승인은 미확정이다.

이번 후속도 설계 기록 변경만 수행했다. 제품·계정·설정·저장 memory 변경 및 모델 호출·빌드·설치 없음. 클라우드 정책은 이 절의 Azrael 수신·적용 제거 범위를 권장하며 사용자 판단이 남아 있다. 서비스 메인 지정의 앱/창 범위와 최초 선택·삭제 시 UX는 실행 설계에서 확정해야 하며 현재 native 활성 계정과 같다고 가정하지 않는다.

## 보존·진행

이 작업 기록 생성용 임시 디렉터리는 context manager로 제거했다. 새 실행 번들·자격 복사·브라우저 프로필·다운로드 없음. 타인·동시 source/index 변경을 보존한다. 모델/성능 재실험은 하지 않는다. 설계 변경은 확정 범위 안에서만 기록하며 구현 권한과 제거할 범위의 합의를 혼동하지 않는다.
