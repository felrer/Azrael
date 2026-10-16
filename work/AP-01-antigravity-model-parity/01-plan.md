상태: 분석 및 명령어 모델 목록 조회 완료 — 현재 선택 계정의 CCA 응답에 Opus/Sonnet 5.5 없음. 실모델 추론은 실행하지 않았습니다.

# Antigravity 모델 동등 제공 분석

## 목표와 권한
2026-10-13 기준 Google Antigravity의 Opus 5.5 제공 여부를 공식 자료로 확인하고 Azrael의 기존 경로와 비교한다. 허용 범위는 자료·소스 조사와 분석 기록, 후속 요청으로 승인된 기존 연결 계정의 명령어 모델 목록 조회이다. 구현, 설치, 로그인, 유료 추론은 수행하지 않는다. 미결 질문 때문에 분석을 보류할 필요는 없다.

## 범위
모델 목록·추론 강도·요청 변환은 플랫폼 공통 의미이며 Windows/Linux/macOS용 공통 helper에 영향을 준다. 이번 증거는 Windows 호스트의 소스 정적 조사와 공식 웹 문서이다. 플랫폼별 실행 및 설치본 동작은 검증하지 않았다. 제품 동작을 변경하지 않으므로 architecture 소유 문서는 갱신하지 않는다.

## 확인된 사실
- [Google 공식 모델 문서](https://www.antigravity.google/docs/models/)는 Opus 5.5와 Sonnet 5.5를 Pro 정식 유료 구독 및 Ultra에 제공한다고 명시한다. Free/Plus는 제외하며 Pro trial도 제외한다. Claude 4.6 및 GPT-OSS는 2026-11-02 제거 예정이다.
- [Enterprise 공식 문서](https://www.antigravity.google/docs/enterprise)는 관리자 활성화 및 토큰 과금과 low/medium/high/max의 CLI 식별자를 명시한다. CLI 식별자가 개인 OAuth CCA wire ID와 같다고 단정할 수 없다.
- `providers/opencodex/inference-config.ts`는 Antigravity를 활성 managed provider로 허용한다. `antigravity.ts`는 계정별 OAuth/project snapshot과 thread binding을 재사용한다.
- `inference.ts:525` 이후 Antigravity 목록은 `provider.models`를 소비한다. 기본 `vendor/src/providers/antigravity-models.ts:284`에는 Sonnet/Opus 4.6이 있고 5.5가 없다. 사용자 지정 목록이 있다면 기본값과 다를 수 있다.
- vendored `oauth/index.ts::buildModelsRequest`, `providers/antigravity-models.ts::parseAntigravityAvailableModels` 및 `registerAntigravityDiscoveredWireModels`, `codex/catalog/provider-fetch.ts`에 CCA 원격 조회/파싱/매핑 코드가 있다. Azrael managed 목록 분기는 이 원격 조회 경로를 호출하지 않는다.
- 기존 effort는 모델별 정확한 ladder에 의존한다. discovery collapse는 low/medium/high를 중심으로 구현되며 기존 Claude 요청은 thinkingLevel로 매핑한다. 5.5의 Max를 기존 경로가 그대로 보존한다고 주장할 수 없다.
- `docs/ops/provider-accounts.md`의 기존 live 증거는 Gemini 3.8의 text/tool 및 native turn이고 Claude effort는 모의 검증이다. 이것이 Opus 5.5 실제 성공을 입증하지 않는다.

## 결론과 추천
기존 OAuth/helper/Google adapter/native tool executor를 확장하는 방식이 타당하다. 모델 제공 가능성은 높지만 계정별 권한, CCA 응답의 실제 ID와 effort wire, 유료 호출 성공은 미검증이다. 같은 모델 목록과 추론 강도를 맞추는 것과 Antigravity의 프롬프트·컨텍스트·배경 모델·성능까지 동일하게 만드는 것은 별도 범위다.

구현을 요청받으면 계정별 원격 모델 조회를 기존 bounded parsing으로 연결하고, 실제 발견된 5.5 wire ID와 정확한 effort/default/context/modalities를 반영하는 방식을 추천한다. 알려진 구형 모델을 무조건 노출하는 고정 목록만의 갱신은 지속적인 동등 제공에 부족하다. 인증 오류/권한 없음/할당량 소진은 구별하고 계정·project별 cache를 격리한다. 기존 thread/account pinning과 tool authority를 보존한다.

## 후속 작업과 검증 조건
1. root가 CCA metadata와 계정별 권한 및 wire 의미를 확인한다. 입력은 기존 계정 binding, 산출물은 정제된 모델·tier 계약이다. 유료 추론은 별도 실행 권한을 필요로 한다.
2. 계약 확인 후 공통 helper의 discovery·reasoning 및 adapter를 수정하고 소유 architecture/feature inventory를 함께 갱신한다.
3. 모의 목록/effort/권한·stale cache/멀티턴 tool·서명/restart/fork 회귀를 검사한다. 이후 권한 있는 계정으로 5.5 text와 tool round trip 및 effort를 실제 검증한다.
4. 패키징·설치를 요청받은 범위에서 matching helper/engine/UI artifact와 설치본 picker/native turn을 확인한다. 공통 변경의 Windows 회귀 및 요청된 다른 플랫폼 검증을 구별한다.

이번 분석의 수용 조건인 공식 제공 사실, 기본 목록 차이, 재사용 경로, 구현 범위와 미검증 조건 식별은 완료했다. 테스트·빌드·실모델 추론은 실행하지 않았다.

## 명령어 모델 목록 조회 결과
기존 Bun 1.4.2로 일회성 TypeScript 조회 스크립트를 실행했다. `OPENCODEX_HOME`을 Azrael 계정 저장소에 한정하고 기존 `resolveAntigravityAccount`와 `buildModelsRequest`를 사용해 현재 선택 계정/project로 `POST /v1internal:fetchAvailableModels`를 호출했다. 토큰은 기존 계정 경로로 처리했으며 계정 선택·설정을 변경하지 않았다. 응답에서 모델 ID와 표시 이름만 보존했다.

실제 프로세스 exit 0, HTTP 200, `models` 항목 22개. Opus 5.5와 Sonnet 5.5는 없었고 `claude-opus-4-6-thinking`, `claude-sonnet-4-6`이 반환됐다. 정제된 증거: [live-model-list.json](live-model-list.json). 일회성 스크립트는 실행 후 삭제했다.

이 결과는 현재 선택 계정/project 및 기존 CCA endpoint에 한정된다. 공식 Antigravity 전체 제공 여부나 다른 endpoint에서의 제공 부재를 뜻하지 않는다. 구독 권한/배포 차이/요청 경로 원인은 미확인이다. 현재 경로에 원격 discovery만 연결하면 바로 5.5가 나온다는 판단은 근거가 없으며, 실제 Antigravity 계정 조건과 요청 경로 비교가 필요하다.
