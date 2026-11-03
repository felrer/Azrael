상태: 영향 검토·합의 동작 설계 완료 — 미인증 일반 설정·공급자별 활성화·기존 자격의 명시적 이전을 확정했다. 제거할 구현 범위의 검토 결과를 제시하며 제품 코드·계정·설정 변경은 아직 수행하지 않았다.

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

## 보존·진행

이 작업 기록 생성용 임시 디렉터리는 context manager로 제거했다. 새 실행 번들·자격 복사·브라우저 프로필·다운로드 없음. 타인·동시 source/index 변경을 보존한다. 모델/성능 재실험은 하지 않는다. 설계 변경은 확정 범위 안에서만 기록하며 구현 권한과 제거할 범위의 합의를 혼동하지 않는다.
