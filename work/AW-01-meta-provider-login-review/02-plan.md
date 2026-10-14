상태: 완료 — 소스 구현·관련 검증 및 작업별 커밋 정리 완료. live 인증·추론 및 전체 앱 빌드·설치는 미검증.

# Meta 로그인과 managed 모델 경로

## 목표·권한·범위

사용자는 Meta 경로 추가, 모델과 도구 호환성 검토 및 자체 harness 제공 여부 확인을 요청했다. 코드·문서·관련 테스트 구현 및 로컬 검증을 수행한다. 전체 앱 빌드·설치·원격 게시·실제 유료 추론은 요청하지 않았으며 수행하지 않는다.

요구는 혼합이다. Windows x64/Linux x64/macOS ARM64의 공통 로그인·추론·계정 수명 정책을 확장한다. 기존 Keychain 가져오기는 macOS 한정이나 앱은 기존 forceLogin device grant를 사용한다. 실제 검증 환경은 Windows 소스 및 가짜 HTTP/계정 fixture이며 다른 OS와 설치본/live 인증은 별도 미검증 범위다.

## 조사와 구현 계약

Meta ID는 기존 vendor의 meta-muse를 재사용한다. 별도 meta-model API 키 방식과 구분하며 기존 API 연결 기능은 유지한다. 정식 API의 Responses 도구 호출 계약과 내장 Muse 어댑터를 활용하고 Azrael만 도구 실행·권한·기록을 소유한다. Muse Code 자체 실행은 범위 밖이다.

정적 계정 목록·native managed ID 검사·picker 표시를 연결한다. static Muse 키의 SHA-256 identity로 account/thread/turn binding을 유지하고 키 교체·제거·취소를 기존 검증 경로로 처리한다. endpoint는 https://api.meta.ai/v1 및 openai-responses OAuth로 제한한다. 모델 roster와 reasoning metadata는 vendor registry를 재사용하며 음성/이미지 출력 모델을 노출하지 않는다. 도구 streaming의 terminal 검증과 reasoning replay를 검토하여 필요한 연결을 보완한다.

로그인 경로가 존재해도 Meta 실제 인증 성공이나 구독 과금 적용을 보장하지 않는다. 현재 내장 구현의 미검증·과금 안내를 로그인 상호작용에서 알린다. 공식 자료는 https://dev.meta.ai/docs/muse-code 및 https://dev.meta.ai/docs/coding-agents 를 확인했다. Muse Code는 terminal/CI agent이며 muse serve/schema와 @muse-code/sdk를 제공한다.

## 책임·순서·검증

root: 공유 identity/transport 계약, inference와 native managed 등록, 문서·inventory·통합·최종 판단. 읽기 전용 담당자: Muse Responses 도구와 reasoning 재사용 위험 조사. 독립 account 담당자: 확정된 계약에 따라 helper/auto-switch/retirement 및 전용 테스트. 기존 사용자 변경은 보존한다.

선행 조건은 identity 및 transport 계약이다. account·inference 구현은 그 계약을 공유하여 병행한다. fixture 검증은 로그인 전달/지원 목록, endpoint 차단, 모델 목록, text/usage, 함수·custom·namespace 도구, parallel/stream 종료 검증, private reasoning 재사용, account pin/교체/삭제/취소를 확인한다. 기존 관련 provider 회귀도 실행한다. native ID 변경은 등록된 scoped Rust 검사 또는 수행 가능한 최소 컴파일/계약 검사로 확인하며 실행 범위와 한계를 기록한다.

## 완료 기준

계정 목록과 login→catalog→managed inference의 전체 소스 경로가 연결되고 관련 검증이 통과한다. 도구와 harness 검토 근거 및 live 미검증 사항을 보고한다. 기능 소유 문서와 보존 inventory를 갱신하고 작업별 변경만 커밋한다.

## 구현 결과와 검증 기록 (2026-10-14)

기존 Meta device grant 로그인과 static key 저장 경로를 계정 UI/helper에 연결했다. account pin·자동 전환 정책·retirement는 키 digest를 사용하며 원문 키는 모델 목록에 내보내지 않는다. managed catalog와 native 선택·picker는 `meta-muse`를 허용한다. 현재 내장 roster는 `muse-spark-1.3`, `muse-spark-1.3-contributor` 두 모델이다. 최신 공식 문서의 다른 모델은 이 roster에 자동 추가하지 않았다.

Responses 요청·SSE parser를 추가했다. 함수·custom·namespace 도구, client tool search, 병렬 호출, 이미지 입력 및 private encrypted reasoning 재사용을 처리한다. 실행할 도구는 terminal 응답 검증 후 전달하며 incomplete/오류/EOF/잘못된 이름·인수는 차단한다. hosted tool 실행은 지원 범위에 포함하지 않는다. 빈 delta로도 state가 무한히 늘지 않도록 메모리 한계를 적용했다.

Windows fixture 검증 결과는 다음과 같다. 로그는 `artifacts/logs/meta-provider/`에 보존한다.

| 검사 | 결과·종료 코드 | 로그 |
| --- | --- | --- |
| Meta 계정·Responses·추론 통합 | 20 pass, 115 assertions, exit 0 (12.11초) | `meta-final-tests.log` |
| 기존 inference/catalog/reasoning/tool replay 회귀 | 43 pass, 331 assertions, exit 0 | `provider-regressions.log` |
| 모델 picker | 38 pass, exit 0 | `picker-tests.log` |
| feature preservation·계정 host | 28 pass, exit 0 | `preservation-host-tests.log` |
| native 실제 선택 함수 추출·rustc 검사 | 1 test pass, exit 0; 임시 fixture 제거 확인 | `native-selection-final.log` |
| 계정 render·상호작용 | 514 checks, exit 0; 밝은/어두운 테마·두 폭·standalone/embedded, 임시 fixture 제거 확인 | `account-render.log`, `render/` |
| 새 parser·identity 모듈과 parser 테스트 타입 검사 | exit 0 | `meta-new-modules-typecheck.log` |

light 1050px와 dark 420px 스크린샷도 확인했다. 마지막 runtime 검사 이후 parser 테스트의 이벤트 배열 타입 명시만 추가했다. 전체 provider 타입 검사는 기존 catalog/custom-api/vendor 및 JS 선언 관련 오류 때문에 통과하지 않았으며 새 모듈 검사는 별도로 통과했다. 전체 core JSON/catalog 테스트는 의존성 컴파일 중 자원 경쟁이 확인되어 해당 cargo 실행을 중단했다(exit -1, `native-meta-tests.log`). 따라서 좁은 native 함수 검사 결과를 전체 엔진 빌드 통과로 해석하지 않는다. 초기 계정 fixture 모의 config 불완전성 및 테스트 실행 경로 문제는 수정 후 관련 검사를 재실행하여 통과했다. 컴파일과 계정 파일 잠금 작업의 자원 경쟁 이후 무거운 실행은 함께 수행하지 않았다.

실제 Meta 로그인·서버 모델 호출·구독 과금 적용·다른 OS·설치 패키지는 검증하지 않았다. Muse Code 자체 harness 제공은 공식 문서로 확인했으며 이번 구현은 Azrael에서 Meta API를 호출하는 경로다. 기존 vendor, 다른 진행 중인 작업 및 기본 빌드 캐시는 보존한다.
