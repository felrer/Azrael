상태: 소스 수용 완료 · Windows 범위 검증 통과. 제품 빌드·설치·배포 미수행.

# 현재 응답 TPS

## 목표·확정 범위·권한
사용자가 현재 응답의 평균 TPS 구현을 요청했다. 표시는 컨텍스트 게이지의 기존 hover/키보드 툴팁이다. 현재 응답은 native 턴 하나(그 안의 모델·도구 왕복 포함)이며 다음 턴에서 초기화한다. 현재 응답에 속한 완료 모델 요청의 출력 토큰 합 / 같은 요청 시간 합 × 1000으로 계산한다. 요청 대기·입력 처리·전송은 포함하며 요청 밖 도구·사용자·자동 재개 대기는 제외한다. 추론 토큰을 출력에 다시 더하지 않는다. 하위 에이전트는 각 대화에서 독립 측정한다.
실시간 정확한 토큰 수가 없는 모델에서도 완료된 모델 호출마다 평균을 갱신한다. 첫 관측 전에는 측정 대기, 과거 미계측 기록은 측정값 없음, 일부 미계측은 부분 표시한다. hover가 계측을 시작하지 않고 모델 호출도 만들지 않는다. 응답 중에는 그 턴에서 완료된 호출까지의 값이며 전체 대화 누적값을 섞지 않는다.
제품 전체 빌드·설치·배포는 이번 요청에 포함하지 않는다. 필요한 테스트 컴파일·격리 UI 렌더와 작업 커밋은 프로젝트 지침 범위에서 수행한다.

## 분별 변화 그래프
사용자가 같은 툴팁에 그래프를 추가하고 추정값을 구분하도록 승인했다. 완료된 각 모델 요청의 출력 토큰을 요청 시간과 분 경계의 겹침에 비례 배분한다. 분별 TPS의 분모도 해당 분의 측정된 요청 구간 합이다. 모든 그래프 점에 추정 표시, 도구-only 분은 빈 구간, 실제 0출력은 0점으로 구분한다. 각 분의 표시는 응답 시작 후 1분째부터 번호를 매긴다. 단일 점도 표시한다. 최근 120분 범위를 넘는 관측은 그래프에서만 제거하고 truncation을 표시하며 전체 평균 분자/분모는 유지한다. 새 턴에서 둘 다 초기화한다. 이 그래프는 실시간 decode 속도를 복원한 값이 아니다.

## 구현·책임·선행 조건
root: 공통 protocol의 ResponsePerformance, 턴별 누적/요청 시간 guard, native 완료·실패·취소 경계, TokenUsageInfo와 ThreadTokenUsage 전달·replay, owning contract와 feature inventory, 통합 검증·커밋.
UI 담당 response_tps_ui: 기존 scripts/inject-provider-context.cjs 및 behavior/render tests. 확정 wire 계약 {turnId,outputTokens,requestDurationMs,completedRequests,unmeasuredRequests}를 받아 한 행·접근성·측정 상태 표시. 공유 소스 보존, 재위임·제품 빌드·설치 제외. 엔진 컴파일과 무관하게 UI fixture 검증 가능.
입력 경로는 docs/ops/development.md에서 지정한 engine/. 기존 Instant·turn timing·usage event·롤아웃 저장/알림·native React/CSS를 재사용한다. tokenizer와 새 의존성은 추가하지 않는다. 수집은 요청당 최대 120개 분 bucket 갱신·snapshot이며 토큰마다 추가 작업·polling은 없다.

## 검증·성공 기준
- protocol: 가중 평균의 분자/분모, 0출력·누락·음수·0시간, JSON 왕복.
- core: 요청 시간만 누적, 새 턴 초기화, guard 중복 완료 무시와 취소 부분 관측, 실제 완료 경로 usage 추정 제외, replay와 다음 턴 attribution.
- UI: wire 전달, 현재 턴 대기/측정/부분/누락, 잘못된 수치, 기존 컨텍스트 비율·가격·자동압축/수동압축 동작, 밝음/어두움·좁은 화면·키보드 렌더.
- 성능: 고정 관측의 계측/비계측 비교를 사용하고 실제 모델 변동과 분리한다. 측정 수치와 정적 복잡도 분석을 구분한다.
- 공통 기능 대상은 로컬 Windows x64·Linux x64 glibc·macOS ARM64. 이번 실행 호스트는 Windows이며 다른 플랫폼과 패키지/설치·실모델 수용을 추정하지 않는다. 원격·컨테이너는 제외한다.

## 실행·산출물 소유권
작업 시작: 2026-10-15(Asia/Seoul). 기존 사용자 수정과 staged 변경이 많으므로 task diff만 분리해 커밋한다.
엔진 테스트 run r1: artifacts/tasks/BO-01-session-tps/runs/r1/ 아래 inputs/engine(고정 소스), logs/, reports/를 root가 소유한다. Cargo 중간 산출물은 기존 engine/codex-rs/target 공유 캐시를 재사용하며 신규 별도 캐시는 만들지 않는다. 입력 복사와 도구 식별/해시를 기록한 뒤 원본 수정과 독립적으로 검증한다. 종료 후 입력 snapshot은 소비 종료·경로 경계 확인 후 일반 삭제하고 결과 로그/receipt는 구현 수용 근거로 보존한다.
UI group: artifacts/logs/session-tps 및 artifacts/verification/session-tps를 UI 담당자가 소유한다. 임시 Chrome profile은 종료 확인 후 기존 cleanup 도구로 삭제, screenshot·summary는 리뷰 근거로 보존한다. 자세한 결과와 종료 코드는 완료 후 이 절을 갱신한다.

## 검증 진행
- r1 고정 평균-only 입력: codex-protocol response_performance 2개 테스트, exit 0. 테스트 준비 컴파일 2분 38초. 로그 runs/r1/logs/protocol.log. 사용자 그래프 승인으로 확장된 입력은 r2에서 검증하며 r1을 최종 그래프 수용 근거로 쓰지 않는다.
- UI 평균-only: behavior 21개와 native render 47개 통과. 그래프 추가 뒤 해당 behavior/render를 재검증한다. 초기 테스트 fixture 누락 및 cleanup 등록 누락을 수정했으며 최종 지표와 구분한다.
- r2는 최종 graph-aware 입력의 새 고정 snapshot이다. 경로 artifacts/tasks/BO-01-session-tps/runs/r2/ 아래 logs/reports를 root가 소유한다. inputs는 검증과 schema handoff 종료 뒤 삭제 대상으로 검토한다. 기존 Rust 공유 cache 외 추가 cache 없음.

- r3 입력 group은 artifacts/tasks/BO-01-session-tps/runs/r3/이며 root가 소유한다. r2 후 소스 검토에서 모델 정책 테스트의 새 optional 필드 초기화와 app-server-protocol 테스트의 역직렬화 타입 표기를 보완했다. 공통 실행 의미 변경은 없으며 r2 core 검증 입력과 관련 실행 코드는 동일하다. r3에서 protocol/appserver 테스트와 schema 생성·정합성, 비용 probe를 수행한다. logs/reports 및 별도 outputs/schema는 해당 group이 소유한다. schema는 새 출력 경로에 생성하고 실제 변경 파일만 primary owning schema에 반영한다. 검증 결과 로그는 보존, inputs와 schema 임시 출력은 필수 handoff 종료 후 일반 삭제한다.
- 그래프 UI 최종: behavior 22/22 exit 0, native React/CSS 57 checks exit 0. 밝음/어두움·1000/360 폭·키보드와 기존 switch/action/pricing 보존. root도 dark 360 screenshot을 직접 확인했다. 로그 artifacts/logs/session-tps/provider-context-graph-tests.log 및 native-render-graph/summary.json. 임시 browser/profile 제거 검증 완료. Evidence 8개 screenshot은 lifecycle group session-tps-ui-evidence로 보존한다.

## 커밋 분리 준비
기존 실제 Git index의 사용자 staged 변경은 유지한다. task/r3/temporary/task-index는 HEAD를 기반으로 이 작업 파일과 feature inventory의 새 engine.response-tps 블록만 담는 대체 index로 사용한다. 원래 index와 inventory staged bytes는 commit 준비 group의 보호 자료로 보관한다. 최종 diff 검토·검증 뒤 작업 커밋을 만들고 실제 index에는 이 작업의 새 HEAD 상태만 반영하되 inventory에는 기존 사용자 staged 내용+동일 task 블록을 유지한다. HEAD/index 동시 변경 감지 시 중단해 재검토한다. 임시 index/backup은 복원·확인 종료 후 일반 삭제한다.

## 성능 점검
실제 production tooltip 함수와 가벼운 JSX factory를 사용한 격리 구성 probe(React commit/layout·DOM·엔진·저장·추론 제외, 동시 Cargo 실행)를 수행했다. 최대 120점에서 반복 숫자 포맷 비용을 확인해 그래프당 Intl.NumberFormat 하나를 재사용하고 native useMemo를 snapshot/locale로 묶었다. 최적화 후 같은 probe의 5회×200회 중앙값은 기존 HEAD 0.176ms, 1점 0.307ms, 새 120점 0.457ms, 기존 memo graph 재사용 0.215ms였다. 이 수치는 해당 구성 단계의 관측이며 전체 앱의 지연·CPU 증가율로 일반화하지 않는다. 보고서 runs/r3/reports/ui-composition-cost{,-optimized}.json. UI source22개 테스트는 memo dependency·locale·snapshot 교체와 timer 미생성을 검증한다. 최종 native rerender의 진단·재실행 결과는 아래 검증 기록을 따른다.

## 디스크 부족 복구와 재검증
r2 core 첫 컴파일은 최종 test harness codegen 중 C: 공간 부족(LLVM output I/O, exit 101)으로 실패했다. 제품 오류로 판정하지 않는다. 종료와 소유 범위를 확인한 뒤 r1 임시 inputs와 이번 컴파일에서 생성된 codex_core incremental 2개만 일반 삭제했다. 공유 dependency 결과는 재사용한다. 삭제 receipt는 r2/reports/task-incremental-cleanup.json에 보존한다.
r2 core 재시도는 같은 고정 입력과 test filter를 사용한다. 작업 임시 Rust compiler wrapper는 codex_core의 --test harness만 incremental 저장을 끄고 debug info를 0으로 낮춘다. 테스트·lint·제품 의미와 dependency 설정은 유지하며 별도 캐시는 만들지 않는다. 재시도 원인은 환경 공간 부족이다. wrapper와 임시 입력은 종료 뒤 정리한다.
UI 최종 진단 rerender는 57개 검사와 browser exception 없음까지 통과했지만 결과 저장/cleanup이 디스크 부족으로 exit 1이었다. 공간 확보 후 기존 lifecycle cleanup을 복구해 exit 0과 profile 부재를 확인했다. artifacts/logs/session-tps/native-render-memo-diagnostic/{recovery-summary.json,cleanup-recovery-result.json}에 검사와 환경 실패를 구분해 보존한다. behavior 22/22 exit 0. 이전 성능 절의 browser error 진단은 종료되었다.
- r2 core 재시도: exit 0, turn_timing::tests 15/15. 첫 실패 뒤 재시도 컴파일 5분 51초. 로그 runs/r2/logs/core-retry.log. 같은 harness의 저장 기록/token notification/turn-start baseline 회귀 각 1개도 exit 0. 실행 파일 codex_core-2efe74163159d4e6.exe; 결과 로그는 r2/logs에 보존한다.
- r2 core runtime/aggregation/timing-test 입력과 현재 소스의 SHA256 동일성 5개 확인, runs/r2/reports/core-reuse-identity.json. r3의 appserver 테스트 타입 표기와 models-manager fixture 초기화는 이 실행 의미/테스트 소스를 변경하지 않는다.
- feature preservation manifest 63개 참조/계약 검증 exit 0. Native check wrapper와 수정 소스의 whitespace/syntax 검사 exit 0.

동시 작업 조정: primary tasks/mod.rs에 별도 panic-unwind 변경이 추가되었다. 이 변경을 보존하고 task commit에는 검증된 r2의 TPS 알림 한 줄만 사용한다. 해당 동시 변경까지 core 테스트가 통과했다고 주장하지 않는다. 실제 Git index의 별도 project-maintenance 문서 3개도 staged 상태가 갱신되어 새 상태를 보존한다. task 소유 경로의 기존 staged 변경은 추가되지 않았다.

- r3 protocol graph-aware 집계 테스트 4/4 exit 0(비용 probe는 별도 ignored 테스트), runs/r3/logs/protocol.log. 비용 probe도 exit 0: 최대 120점 aggregate 갱신+JSON 직렬화 debug test profile 5회×10,000회에서 관측당 463–547µs, 중앙값 490µs. 동시 appserver 컴파일 중 측정이며 실제 앱 전체 지연/추론 TPS와는 다르다. 로그 runs/r3/logs/engine-cost-probe.log.
- 최종 UI 재실행은 변경 없는 소스로 전체 명령 exit 0, 57/57, browserErrors=[], lifecycle cleanup과 profile 부재 확인. artifacts/logs/session-tps/native-render-clean-final/{summary.json,cleanup-result.json} 및 .log. behavior 22개 결과를 재사용한다. 이전 ENOSPC 실행의 환경 실패 기록도 유지한다.
- native protocol의 기존 schema 생성기를 재사용해 새 wire 타입의 TS/JSON/precomputed exports를 생성한다. 기존 Python SDK generator와 설치된 환경도 재사용해 파생 타입을 임시 출력에서 생성하고 실제 task 변경만 반영한다. 새로운 dependency나 SDK 실행 기능은 추가하지 않는다.

## 최종 수용 범위
- r3 app-server-protocol: 새 필드의 기록 왕복·wire 변환 및 과거 필드 없는 기록 읽기 1/1, exit 0. 컴파일 5분 7초, runs/r3/logs/appserver.log. 엔진의 scoped native unit/regression 총 23개 통과이며 비용 probe 1개는 별도 실행이다.
- native stable/experimental schema generator 각각 exit 0. 기존 소스와 파생 파일 사이에 TPS 외 기능의 미반영 차이가 있어 전체 생성 결과로 덮어쓰지 않았다. 실제 생성 결과에서 TPS 정의 2개와 전달 필드만 추출하고 TS 4개, JSON 4개, precomputed 2개에 반영했다. 새 정의/필드가 native 결과와 같고 기존 다른 내용은 보존됨을 확인했다. 전체 schema fixture와 현재 모든 소스가 일치한다고 주장하지 않는다. 보고서 runs/r3/reports/schema-{preservation,handoff}.json.
- Python SDK도 기존 생성기에 baseline drift가 있어 새 클래스 2개와 ThreadTokenUsage 필드만 실제 생성 결과에서 반영했다. 과거 optional 값 없음과 새 그래프 wire 왕복 모델 검증 exit 0. 설치된 환경의 ruff 실행 경로를 보완한 뒤 generator exit 0, 신규 dependency 없음. reports/sdk-handoff.json 및 logs/sdk-{generate-retry,preserved-generate,preservation}.log. 전체 SDK 재생성 일치 검증은 범위 밖이다.
- 최종 UI behavior 22개와 native render 57개 통과, 키보드·밝음/어두움·좁은 화면·기존 압축 동작 보존. 모델 호출·token별 처리·polling을 추가하지 않았다. UI 구성/engine aggregate+JSON의 격리 비용은 앞의 성능 절 범위에 한정한다. 전체 앱 응답 TPS의 증가/감소율은 측정하지 않았다.
- 검증 환경은 로컬 Windows x64. Linux/macOS, 변경 엔진의 실제 RPC·실모델 계측, 패키징/설치/배포는 미검증이다. 현재 설치본의 화면이 이번 소스를 사용한다고 주장하지 않는다.
- r2 inputs/temporary는 소비 종료 뒤 일반 삭제와 부재 확인 완료. r3 inputs/outputs는 최종 handoff 해시 확인 뒤 정리한다. 로그·receipt·비용 보고서·화면은 리뷰 근거로 보존한다. Git 분리 자료는 커밋과 실제 index 보존 검증이 끝난 뒤 정리한다.

최종 정리: r3 inputs/outputs도 handoff 종료 후 일반 삭제하고 부재를 확인했다(reports/input-output-cleanup.json). 필요한 변환 harness와 검증 로그/receipt는 reports/logs에 보존한다. 제품 설치 경로와 다른 작업의 cache/산출물은 정리 대상으로 삼지 않았다.
