상태: 완료(Windows x64 소스 범위). 최종 provider 요청 기준 입력 예산의 사전 계산·압축 판단 연결·진단 및 범위별 검증을 완료했다. 제품 빌드·설치·실계정 수용은 수행하지 않았다.

# 최종 provider 요청 기준 컨텍스트 예산

## 문제와 목표

현재 엔진은 이력과 지시문을 바이트 기반으로 추정한다. managed helper는 그 이후 이력 투영, 도구 스키마 축약, provider별 메시지·도구·이미지 변환을 수행한다. 따라서 압축 판단에 사용한 입력과 실제 전송 입력의 범위가 다를 수 있다. 목표는 최종 요청 구성에 가까운 입력량을 압축 판단에 반영하고, 실제 보고 사용량으로 추정 오차를 확인하는 것이다. 정확한 tokenizer를 확보하지 않은 로컬 추정은 계속 추정으로 표시한다.

## 현재 설계와 확인한 근거

- 소유 계약: `docs/architecture/context-policy.md`, `docs/architecture/managed-providers.md`, `docs/architecture/devin.md`.
- `engine/codex-rs/core/src/context_manager/history.rs::estimate_token_count_with_base_instructions_and_model_slug`는 모델별 지시문 투영 후 바이트 근사로 계산한다.
- `engine/codex-rs/core/src/session/context_window.rs`는 전체 입력 한도와 `Total`/`BodyAfterPrefix` 압축 범위를 구분한다.
- `providers/opencodex/inference.ts`의 `adapter.buildRequest`에서 provider wire body가 만들어진다. 엔진의 사전 판단보다 늦은 경계이므로 여기에서 사용량을 보고하기만 해서는 사전 압축 판단이 개선되지 않는다.
- helper의 입력 프레임 바이트 한도는 토큰 한도와 별개이며, helper 투영 전에 적용된다.
- 기존 요청 이력 투영, 토큰 추정 유틸리티, 사용량 보고와 압축 실행기를 재사용한다. tokenizer 의존성을 추가하거나 추정 유틸리티를 요청 전체 JSON에 무조건 적용하지 않는다. JSON 키·base64 문자 수는 모델 입력 토큰과 같지 않다.

## 권장 범위와 검토할 결정

권장안은 로컬 추정과 동일 요청 준비 경로를 먼저 도입하는 것이다. 외부 `countTokens` 호출은 초기 범위에서 제외한다. 추가 네트워크 지연과 인증 경로별 지원 차이를 피할 수 있지만, 정확한 사전 토큰 수를 보장하지는 않는다. 공식 계산 API를 쓰는 대안은 계정·endpoint별 지원과 추가 호출 비용을 검증한 별도 확장으로 다룬다.

현재 설계의 차이는 helper 프로토콜에 요청 준비/입력 예산 응답을 추가하고 엔진이 이를 추론 전 압축 판단에 소비한다는 점이다. 기존 압축 실행기와 모델별 기준은 유지한다. Devin은 현재 자동 압축을 지원하지 않으므로 최종 입력 예산 계산과 명시적 한도 오류를 적용하고 새 압축 기능은 추가하지 않는다. 단순 로그 추가를 넘어 엔진/helper의 실행 순서를 바꾸므로, 관련 구현 전에 이 변경을 검토한다.

적용 의미는 OS 공통이다. 구현 목표는 managed providers와 Devin이며, OpenAI 네이티브 경로와 사용자 API 경로의 현재 동작은 보존한다. managed 중 활성화되지 않은 provider는 fixture 검증과 실제 지원을 구분한다. 최초 검증은 Windows x64 로컬 엔진/helper로 수행하고, 다른 OS·CPU와 실제 계정·설치된 앱은 검증 전 수용하지 않는다.

이번 범위에는 오래된 도구 결과 축약, 압축 요약 변경, 캐시 정책 변경, 새 설정 UI, 빌드·설치·배포가 포함되지 않는다.

## 실행 단계와 소유권

1. **입력 구성과 오차 관측.** managed `projectRequest`/adapter와 Devin mapper/serializer에서 지시문, 대화, 도구 정의, 도구 결과, 이미지, provider 오버헤드를 구분한다. 수량·바이트·추정치만 진단에 남기고 본문·이미지·자격증명은 기록하지 않는다. 실제 응답의 정규화된 input tokens와 동일 request ID로 연결한다. 캐시 읽기/쓰기는 provider별 원래 사용량 의미를 정규화한 뒤 총입력에 한 번만 포함한다.
2. **공유 요청 준비 계약.** 엔진 native runtime과 helper에 준비 작업을 추가한다. 준비는 모델 추론이나 도구 실행을 하지 않는다. 최종 메시지·도구 변환을 inference와 공유하고, 응답은 요청 ID와 순서로 검증하며 계정 scope 해시를 반환한다. 계정 continuity는 기존 turn/model/account pinning 계약으로 유지한다. scope 해시를 prompt 전체의 트랜잭션 잠금이나 재사용 키로 쓰지는 않는다. helper가 요청마다 종료되는 현재 구조에서는 사전 계산 helper와 추론 helper가 같은 변환 로직을 각각 실행한다. 준비된 본문을 프로세스 사이에 저장하거나 재사용하지 않으며, 매번 현재 prompt와 계정 바인딩으로 다시 계산한다. 로컬 시작·변환 비용 증가를 검증에 포함한다. 인증 토큰 만료, 취소와 기존 account retirement 검사도 실제 전송 전에 재확인한다. 준비 본문을 대화 이력이나 별도 영구 대화 저장소에 저장하지 않는다.
3. **구성 요소별 로컬 추정.** 모델에 맞는 기존 텍스트 추정을 재사용하되 tokenizer 모델 범위와 재사용 적합성을 검사한다. 한글·코드·JSON fixture를 포함한다. 이미지는 base64 길이 대신 검증된 모델별 이미지 규칙을 사용하고, 규칙을 확인하지 못한 경우 미확인 항목으로 표시하여 기존 보수적 경로로 돌아간다. 추론 전 추정치를 모델 용량으로 잘라 초과 입력을 숨기지 않는다. 입력량과 실제 출력 예약량/추론 예산은 분리하며, 기존 safe input 정책과 출력 예약을 중복 차감하지 않는다.
4. **압축 판단 연결.** 엔진이 준비 결과를 받은 후 현재 모델 정책으로 전체 입력 상한과 자동 압축 범위를 각각 평가한다. `BodyAfterPrefix`는 같은 추정 기준으로 prefix와 전체 입력을 계산한다. 초과하면 기존 압축 실행기로 처리하고 압축된 요청을 다시 준비한다. 반복 압축이 끝없이 이어지지 않도록 횟수를 제한하고, 줄어들지 않는 필수 입력은 명시적 context 오류로 종료한다. 준비 기능 미지원/추정 불가 시 기존 추정 경로를 사용하며 원인을 구분한다. 잘못된 인증·지원하지 않는 입력·취소는 추정 fallback으로 숨기지 않는다. 입력 프레임 초과는 별도 transport 오류로 유지한다.
5. **실제 사용량 기반 보정.** 먼저 오차 분포를 관측하고 provider/model/endpoint별 과소 추정을 확인한다. 충분한 근거가 있는 범위만 보수적 보정에 사용한다. 초기에는 세션 안의 제한된 표본만 사용하고, 모델·endpoint·이미지 경로가 바뀌면 표본을 분리한다. 유효한 실측 표본이 충분하지 않으면 자동 보정 계수를 활성화하지 않고 추정 오차 관측을 유지한다. 표본 부족 또는 추정 사용량을 실제값으로 보고한 응답은 학습에 사용하지 않는다. 임의의 공통 배율·영구 학습 저장소는 도입하지 않는다. 구체적인 여유값은 측정 후 같은 계획에 검토 가능한 근거로 반영한다.
6. **계약과 보존 검사 갱신.** 합의된 설계를 owning architecture에 반영하고 기존 `engine.provider-context` 보존 항목에 helper 준비/토큰 추정과 필수 검사를 연결한다. 구현 단계에서 `implementation` 스킬과 프로젝트 Work playbook을 적용한다. 전체 제품 빌드/설치는 별도 요청 범위다.

선행 관계는 관측 fixture와 준비 계약 확정 → mapper/serializer 준비 재사용 → 엔진 판단 연결 → 통합 검증이다. 단계별 담당 경계와 산출물을 유지하며 별도 계획을 만들지 않는다.

## 검증과 수용 기준

- managed 각 mapper와 Devin에서 준비된 model-facing content와 실제 전송 content가 일치한다. provider 요청 envelope·인증 메타데이터와 모델 입력은 구분한다.
- 현재 도구 정의와 이력의 중복 스키마, namespace, 실패 검색, 한글/영문/코드/JSON, 이미지 포함 요청을 fixture로 확인한다.
- 압축 한도 바로 아래/같음/위, 출력 예약 변경, scope 변경, provider 전환·모델 downshift·resume/fork에서 정책이 올바른 요청 식별자에 적용된다.
- 준비 후 이력/도구/옵션 변경, helper 재시작, 취소, 계정 제거, 오래된 helper, 프레임 초과에서 stale 결과 재사용이나 유실이 없다.
- 실제 입력 보고가 추정치를 대체하고 캐시 토큰이 중복되지 않는다. 미확인 이미지 추정은 정확한 값으로 표시하지 않는다.
- 반복 검색 fixture에서 중복 축약이 사전 예산에 반영된다. 한국어·큰 도구 집합에서 과소 추정/과다 압축과 관측된 잔차를 따로 보고한다. 실측이 없으면 정확도 개선율을 주장하지 않는다.
- 준비와 전송의 로컬 처리 시간/메모리, 준비 재사용 여부를 측정한다. 초기 범위에서 외부 요청 수는 늘지 않는다.
- Windows scoped engine/helper 회귀와 동일 wire fixture 통합 검사를 수행한다. 실제 모델 토큰 정확도와 장기 대화 수용은 별도의 계정 실측 전까지 미검증으로 남긴다.

계획 산출물의 완료 기준은 기존 구조와 설계 차이, 권장 선택, 실패 처리, 실행 순서와 검증 범위를 한 문서로 제시하는 것이다. 위 단계는 최초 계획이며 아래 실행 기록이 현재 구현·검증 범위를 정의한다. 설치된 제품의 수용 완료를 의미하지 않는다.

## 현재 구현과 검증 기록

- root: helper 입력 추정, 실제 wire 비교, 테스트·빌드 입력·설계·보존 목록과 통합. 자식 담당자는 엔진 사전 예산 판단과 진단 sink를 각각 독립 소유하며 재위임하지 않는다.
- `context_diagnostic_sink`: 구조화된 progress 필드의 엄격한 Rust 검증, SQLite 기록과 Python 안전 내보내기.
- `native_budget_admission`: 기존 sampling/compaction 순서에 helper 사전 예산을 연결하고 범위·한도·실패를 검증.
- helper 준비와 실제 wire fixture: Anthropic/Antigravity 3개 검사, exit 0, `artifacts/logs/context-budget-observation/helper-bun.log`.
- Devin 실제 helper estimate와 mapper/progress 회귀: 54개 검사, exit 0, `artifacts/logs/context-budget-observation/observer-node.log`.
- 실제 계정 실측·토큰 정확도·설치된 앱 적용은 아직 검증하지 않았다.

## 최종 수용 결과

- managed 최종 wire body 및 Devin system folding/도구 설명 정제 결과를 사전 예산으로 사용한다. 추론 전 네트워크 호출 없이 요청 ID/순서와 계정 pinning을 검증하며, 준비 결과는 다음 요청에 재사용하지 않는다.
- 최종 Guardian prompt 이후 한도를 평가하고 기존 압축 후 다시 계산한다. 횟수/입력 감소 검사로 반복을 제한하며 Devin은 기존 자동 압축 미지원 오류를 유지한다. 모델/컨텍스트 창별 prefix 기준과 기존 출력 예약 정책을 유지한다.
- 이미지/알 수 없는 content/명시적 구형 helper 미지원은 기존 추정 경로를 사용한다. 인증·취소·잘못된 프레임·30초 준비 timeout은 오류로 처리한다.
- 실제 입력 사용량 잔차는 관측만 한다. 충분한 실측 표본이 없으므로 자동 보정 배율은 활성화하지 않았다.
- 최종 helper 보존 runner exit 0: `artifacts/logs/context-budget-observation/final-preservation-helper.log`. 업데이트된 helper fixture Anthropic/Antigravity 3개, Devin collector/progress 17개 통과. 앞선 mapper 전체 54개 및 managed regression 43개도 exit 0이며 이후 해당 변경의 작은 검사를 재검증했다.
- Rust 실제 source를 가져온 최소 harness: admission/transport 9개 및 strict diagnostics 7개 통과, 각각 exit 0. 이 검사는 Session 등 stub을 쓰므로 완전한 제품 실행의 증거가 아니다.
- 최종 불변 source snapshot에서 `cargo check --offline --locked -p codex-core --lib` exit 0. 최종 8개 engine source 해시가 현재 파일과 일치한다. `artifacts/logs/ab01-native-budget-admission/summary.json`, `core-check-r2.log` 및 source receipt에 기록했다. 잘못된 cwd로 시작한 검사 1회는 중단(exit -1) 후 올바른 workspace cwd에서 통과했다.
- Python SQLite 진단 export 20개 exit 0, `artifacts/logs/context-budget-observation/sink-python.log`. strict Rust 로그와 해시: `sink-rust-final.log`, `sink-source-hashes.json`.
- 전용 snapshot/harness/target는 일반 삭제로 정리하고 제거를 검증했다. 기존 engine cache는 유지했다. feature manifest validation 및 diff check exit 0.
- 실제 CLI source fixture의 준비 시작 시간은 Anthropic 약 2.9초, Antigravity 약 1.7초였다. 새 로컬 프로세스 시작 비용이며 설치본 지연이나 실모델 성능으로 일반화하지 않는다. 메모리 증가량과 장기 대화는 실측하지 않았다.
- 실제 계정 토큰 정확도, 활성 provider 전체 실계정, 압축 end-to-end 설치본, resume/fork·계정 제거의 실앱 흐름, 다른 OS/CPU는 미검증이다. Windows source 검사만 수용한다. 새로 입력된 기능을 설치된 앱에 적용하려면 별도 제품 빌드/설치가 필요하다.

- 스테이징 검사에서 새 Rust 파일 2개의 CRLF가 whitespace로 잡혀 LF로 정규화했다. 의미 변경은 없으며 최종 해시는 `artifacts/logs/ab01-native-budget-admission/final-line-endings.json`에 남겼다. 최종 staged diff check exit 0.
