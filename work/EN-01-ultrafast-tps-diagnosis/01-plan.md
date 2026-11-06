상태: 조사 완료 — 명령 실행 시간의 집계 여부와 설치본의 Ultrafast 전달 경로를 확인했다. 서버 실제 적용 등급은 기존 기록에 없어 미확인이다. 제품 변경은 하지 않았다.

# Ultrafast 및 TPS 원인 조사

## 요청·범위·검증

- 요청: Ultrafast 미지원 여부와 명령 실행 시간이 TPS에 포함되는지 확인한다.
- 허용 범위: 코드, 설치 provenance, 기존 실행 기록 읽기 및 조사 기록 작성. 제품 수정·빌드·설치·추가 추론 벤치마크는 수행하지 않는다.
- 플랫폼: 공통 요청/집계 로직이며 실제 조사 환경은 Windows x64다. Linux/macOS 실행 검증은 하지 않았다.
- root가 집계 경계 → 설치 소스와 요청 전달 → 화면 수치 재계산 → 로그의 확인 한계 순서로 조사했다.
- 성공 기준: 분모 범위, 전달 코드, 서버 확인 여부, 화면 수치와 불확실성을 구분한다. 읽기와 기존 기록 재계산을 사용했으며 제품 변경이 없어 아키텍처 수정·빌드·제품 테스트는 필요 없다.

## 확인 결과

### TPS 의미와 시간 경계

- `engine/codex-rs/core/src/session/turn.rs`는 모델 스트림 호출 직전에 `begin_response_performance`를 시작하고 `ResponseEvent::Completed`에서 완료한다. 응답 종료 뒤 `in_flight` 도구 완료를 기다리는 구간은 이 측정 밖이다.
- `core/src/turn_timing.rs`의 `ResponsePerformanceGuard::complete`는 요청 시작부터 완료 처리까지의 monotonic 경과 시간을 저장한다. 모델 서버 대기·입력 처리·통신·스트림 이벤트 처리 지연이 포함된다. 서버 순수 생성 속도나 첫 토큰 이후 decode TPS를 측정하는 구조가 아니다.
- 일반 명령 실행 및 모델 요청 사이의 공백을 전체 턴 시간으로 더하는 구조는 아니다. 응답 처리와 동시에 진행되는 작업의 간접적인 지연 영향까지 0임을 보증하는 결론은 아니다.
- `scripts/inject-provider-context.cjs`는 모드별 출력 합계 / 요청 시간 합계로 평균을 계산한다. 분별 점은 요청 토큰을 분별 겹침 구간에 배분한 추정값이다.

### 설치본과 전달 경로

- 실행 중인 일반 설치 경로: `C:/Users/felre/AppData/Local/azrael-ex/releases/2026.0.13/runtime/engine/azrael.exe`.
- 해당 파일 SHA256 `af05729487ad2fa94d97eb0abedb795f843130297135546464becb522fb8c40a`가 설치 provenance와 일치한다.
- 설치 provenance가 연결한 `artifacts/app-releases/2026.0.13-ec01-r1/provenance/sources/r3-selected-source.zip`을 추출 없이 읽었다. ZIP SHA256 `01da25bb19bf1a8dbf9a58eff6a94055ba81bff1b3ccac32b6cf001e37201e75`가 보관 derivation과 일치한다.
- 보관 소스의 `engine/codex-rs/protocol/src/openai_models.rs:1008`은 정확한 `gpt-6-astra`와 `gpt-6.1-sol`에서 catalog에 없어도 `ultrafast`를 허용한다.
- 보관 소스의 `core/src/client.rs:1028`은 tier를 요청 body에 유지하고 `:1224`는 Codex backend 라우팅 힌트에 `tier=ultrafast`를 넣는다. Guardian reviewer 요청은 별도 예외로 tier를 제거하지만 조사 대상은 일반 사용자 턴이다.
- 요청 전 선택 등급으로 그래프 mode를 기록한다. 서버 응답 등급을 확인한 표시가 아니다. `codex-api/src/sse/responses.rs:108`의 완료 파싱 구조에도 실제 적용 `service_tier`가 없다.

### 화면과 일치하는 저장 기록

원본: `C:/Users/felre/.azrael-ex/sessions/2026/10/29/rollout-2026-10-29T09-01-06-01a182f8-ea9f-7991-86d1-543ab6bd1a78_01a184f5-d64d-7bb1-bbbd-9e8502acb4c8.jsonl`.

- provider `openai`, 모델 `gpt-6.1-sol`, reasoning effort `medium`.
- 2026-10-29 14:40:13.281 Asia/Seoul snapshot: Standard 16,809 / 611.644초 = 27.4817 TPS, Ultrafast 760 / 31.955초 = 23.7834 TPS. 화면의 27.5 / 23.8과 일치한다.
- Ultrafast 당시 완료 요청은 3개다. 개별 출력/시간은 58토큰/5.729초(10.1 TPS), 244토큰/15.697초(15.5 TPS), 458토큰/10.529초(43.5 TPS). 각각의 입력은 약 22.7만~23만 토큰이었다. 출력 길이·입력 처리·대기 시간 등 조건이 다른 평균이므로 순수 생성 성능 비교 실험이 아니다.
- 다음 snapshot에서는 Ultrafast 1,158 / 48.679초 = 23.7884 TPS로 같은 소수점 한 자리 표시를 유지한다.
- `logs_2.sqlite`를 읽기 전용으로 조회했다. 대상 대화의 14:38~14:43 기록에서 feedback tags에 `service_tier=ultrafast`, `feature.ultrafast_mode=true`가 있다. 이는 설정 증거이며 서버 적용 확인은 아니다. 조회한 기록에서 서버 완료 원문/실제 tier 확인 자료는 발견하지 못했다.

## 결론과 권고

명령 실행 시간을 통째로 분모에 넣어서 유사한 속도로 보인다는 설명은 이 코드 경계와 맞지 않는다. 설치본에 Sol Ultrafast 전달 처리가 누락되었다는 근거도 찾지 못했다. 확인된 문제는 현재 지표가 요청 전체 처리량이며, 선택 등급과 서버 실제 적용 등급을 구별하지 못한다는 관측 한계다. 서버 미적용 여부와 입력 처리/대기/생성 중 어느 항목이 차이를 만든 것인지는 기존 자료로 확정할 수 없다.

추가 수정이 승인되면 요청 tier와 응답 실제 tier를 구분하여 저장하고 TTFT 및 첫 토큰 이후 처리량을 함께 측정하는 것이 우선이다. 동일 모델·입력·출력 조건의 반복 비교는 그 이후 별도 실행 범위를 정한다.

공식 자료: https://developers.openai.com/api/docs/guides/ultrafast-mode 는 Astra/Sol에서 요청 `service_tier=ultrafast`와 WebSocket 사용을 안내한다. https://developers.openai.com/api/reference/typescript/resources/beta 는 응답 tier가 실제 처리 등급이며 요청값과 다를 수 있음을 설명한다. API 지원 문서를 해당 Codex 구독 계정의 이용 자격 증거로 확대하지 않는다.

## 실행·정리

- 코드·ZIP·SQLite·rollout 읽기 및 수치 계산 명령의 실제 종료 코드는 0이었다. 초기 `python` PATH 조회 실패 이후 설치된 Python313 절대 경로를 사용했다. 초기 광범위 로그 출력은 요약 필드로 좁혀 재조회했다.
- 테스트·빌드·설치·추가 모델 요청은 수행하지 않았다. 변경한 파일은 이 조사 기록뿐이다.
- 계획 할당용 임시 본문 파일은 사용 직후 일반 삭제했고 부재를 확인했다. PowerShell 네이티브 파이프의 한글 인코딩 손실은 본문을 UTF-8 patch로 교정했다. 별도 추출물·로그·백업을 만들지 않았다. 원본 대화와 기존 배포 증거는 보존했다.
