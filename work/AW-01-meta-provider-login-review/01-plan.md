상태: 검토 완료 — 사용자 추가 조치 없음.

# Meta provider 로그인 구현 검토

- 요청과 권한: Meta provider 로그인 구현 여부의 정적 코드 검토. 코드 수정, 실제 로그인, 계정 저장소 접근은 범위 밖이다.
- 범위: 공통 provider 인증 경로. Windows 작업공간 소스를 검토했으며 설치본 및 다른 OS의 실행 검증은 수행하지 않았다.
- 검토 순서: Azrael 계정 helper 및 host 호출 경로 → 내장 OpenCodex Meta 로그인 모듈 → 관리형 추론 연결과 기존 테스트 계약.
- 성공 기준: 로그인 구현의 존재와 앱에서의 접근 가능성을 구분하고 근거 및 미검증 범위를 제시한다.

## 결과

Azrael 계정 로그인은 Meta를 지원하지 않는다. `providers/opencodex/helper.ts:85`의 ACCOUNT_PROVIDERS는 anthropic, google-antigravity, devin만 허용한다. 동일 목록으로 availableProviders를 만들며 login 요청에서도 supportedOAuthProvider 검사로 나머지를 거부한다. host `providerAccountService.ts:179`도 availableProviders에 있는 provider만 로그인하도록 검사한다.

내장 vendor에는 meta-muse OAuth 등록과 loginMetaMuse 구현이 있다. 브라우저 device grant, macOS 기존 Keychain credential import, 수동 키 입력 fallback을 포함한다. 다만 vendor 자체 주석은 device grant의 실제 Meta 대상 검증이 수행되지 않았다고 명시한다. meta-model은 별도 API key 방식이다.

`inference-config.ts:1`과 `isManagedOAuthTransport`에도 Meta OAuth 연결은 없다. 따라서 허용 목록 추가만으로 로그인부터 모델 사용까지 완료된다고 볼 수 없다.

## 검증과 제한

정적 호출 경로 및 `providers/opencodex/tests/helper.test.ts`의 지원 provider 목록과 미지원 OAuth 거부 계약을 확인했다. 테스트 실행, 네트워크 인증, 설치본 점검은 수행하지 않았다. 코드와 아키텍처 변경은 없으며 작업 기록만 생성했다.
