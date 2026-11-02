상태: #54654/#58404 구현·Windows 자동 검증·정리 완료. 이 문서와 관련 소스·테스트·출처·최소 검증 근거를 한 작업 커밋으로 기록한다. 사용자 요청에 따라 보존 예외 없이 작업 소유 실행 묶음 17개를 모두 삭제·finalize하고 실제 경로 부재를 확인했다. 제품 빌드·설치·push는 제외한다.

## 현재 결과

- #54654: 동적 도구의 병렬 실행 opt-in과 Promise.all 동시 대기·역순 응답 회귀를 반영했다.
- #58404: 성공한 usage가 덮는 raw history 경계를 추적한다. 실패·usage 누락 응답은 경계를 전진시키지 않으며, 로컬 재계산은 보존 이력 전체를 덮는다. 원본 index를 유지하는 projection으로 경계 이후의 미계상 입력·reasoning·도구 결과를 계산한다.
- Windows x64/Rust 1.95.0 선택 검사 124개 passed/0 failed, 7회 Cargo 종료 코드와 controller 종료 코드 모두 0. 재계산 2, 이력 95, projection 16, usage 누락 reasoning 4, 기존 encrypted reasoning 5, 로컬 usage 1, 동적 도구 병렬 호출 1이다. 실행 전후 입력 및 외부 Code Mode fixture 해시가 일치했다. Linux/macOS와 설치본은 검증하지 않았다.
- 다른 작업의 미커밋 변경을 보존하고, HEAD82537debf9d907fca912befa0a379c738747f006에 승인된 hunk만 적용한 task tree f2e66decbebcd6764691a872f722865b8b4b6202를 독립 동결해 검증했다. 동시 agent_profile 호출과 shared_state 필터 변경은 후보에서 제외했다.
- 최종 입력 sourceSHA9753d593fa588fc7de7e43dbddab556e5fa7344a838160552cef6073ab56b410, receiptSHA9b97aa7a37769dc318acdce41bd41b1a4fb3b1f71b1f478480c89d3bc0dc2098. 세부 결과는 [verification-03.json](verification-03.json), 불변 종료·입력 증거는 [verification-stop-09.json](verification-stop-09.json)에 있다.
- 작업 소유 실행 묶음 17개를 모두 실제 삭제·finalize했다(native-r1~r8, tests-r1/r2/r3/r7/r8/r9/r10, fixture-lease-r1, edit-baseline-r1). fixture 소비 종료와 외부 host의 execution 참조 해제를 확인했다. OS33 및 실제 잠금 경합으로 중간 실패·정확한 예약 복구가 있었으며 실패를 성공으로 바꾸거나 잠금을 우회하지 않았다. 다른 작업에서 설치·수용한 새 기본 owner480e125e…를 프로젝트 운영 지침·설치 영수증·실제 바이너리·기본 경로 검증 기록과 대조한 뒤 마지막 두 묶음에 사용했다. 마지막 등록·심사·삭제의 실제 종료 코드는 모두0이다. [최종 정리 근거](cleanup-final-03.json)와 [독립 종료 근거](cleanup-stop-21.json)를 유지한다. 보존 예외는 없다. 공유 Cargo 캐시·do1 Code Mode host·기존 원본 입력은 이 작업의 삭제 대상이 아니다.

# Codex 선택 이식 기준 및 후속 PR

## 목표·권한·검증 범위
2026-11-02 KST 최초 조사에서 마지막 개선과 컨텍스트 계산/병렬 실행 PR 반영 여부를 확인했고, 이후 사용자가 미반영 #54654/#58404의 적용을 승인했다. 기존 01/02-plan.md 및 다른 미커밋 변경을 보존한다. 공통 엔진(Windows x64/Linux x64/macOS ARM64)의 변경이며 실제 검증은 Windows x64다. 문서의 runtime 병렬 실행 계약과 context 경계 설명, 보존 inventory 및 선택 검사 실행기를 함께 갱신한다.

## 최초 조사 결과 — 이식 전 상태
- 기반은 rust-v0.162.0이며 이후 개별 PR을 선택 이식했다. 마지막 날짜 이후 모든 PR이 빠졌거나 이전 모든 PR이 포함됐다고 볼 수 없다.
- #55991: retained reasoning 중복 계산 수정. upstream merge 2026-10-22 06:23 KST. 로컬 10월27일 13:33–14:02 KST Windows 102개 passed/0 failed, child/controller exit 0 기록은 02-plan.md에 있다. 현재 compact.rs Lite 초기화와 session/mod.rs recompute included=true도 존재한다. 마지막으로 명확한 날짜와 행동 검증이 확인된 컨텍스트 수정은 10월27일이다. 설치본/실행 중 창 포함 여부는 이번에 확인하지 않았다.
- #52245: 읽기 도구 병렬화. 현재 ext/skills/src/tools/read.rs/list.rs opt-in=true와 cloud_skill_reads_run_in_parallel 회귀 존재. 01-plan.md의 10월25일 실제 overlap 검사 통과 기록. 일반 shell 동시 명령 상한 변경은 아니다.
- #54654: 동적 도구 병렬화. upstream merge 10월17일 01:29 KST. DynamicToolHandler에 opt-in이 없고 ToolExecutor 기본 false라 미반영. 원본 patch는 opt-in 및 Promise.all 동시 대기/역순 응답 회귀를 추가한다. #55991보다 오래돼도 검토에서 제외하면 안 된다.
- #56006: upstream 10월22일 07:48 KST. shell overlap 테스트 개선이며 제품 동시 실행 확대는 아니다.
- #58404: usage가 없는 응답의 컨텍스트 추정 수정. upstream 10월31일 03:12 KST. 현재 history.rs에 upstream last_server_reported_usage_item_count/last_model_output_item_count 경계 추적이 없고 last usage + projected tail 계산을 사용한다. 실패/usage 누락 응답의 누적 reasoning 과소 계산 수정은 미반영이며 #55991과 별개 후속 우선 후보다. 의존성 전체 감사와 행동 재현은 아직 하지 않았다.
- #57819: upstream 10월29일 05:12 KST. 최대 8개 플러그인 로딩 병렬화 후보. 모델 명령 병렬화와 별개이며 현 반영 여부 전체 대조는 하지 않았다.
- 02-plan.md의 #55958/#55847/#55993/#55957/#55968 네 묶음은 소스 반영/정적 검사 이후 native 검증·출처·커밋 미완료 상태다. 이를 전체 반영 완료로 해석하지 않는다.

## 최초 권고와 후속 승인
이후 목록은 로컬 10월27일 대신 upstream #55991 merge인 10월22일 KST를 기준으로 찾고, 이전 미반영 #54654와 네 묶음 미완료 검증을 예외로 유지하도록 권고했다. 사용자의 후속 요청에 따라 #54654와 #58404를 이식·검증했다. 다른 PR의 추가 이식은 이번 범위에 포함하지 않는다.

## 근거·한계
최초 조사는 공식 GitHub API(gh api)의 PR body/merged_at/files patch와 당시 소스 및 기존 작업 기록을 대조했다. 10월21일 이후 merged PR 검색은 503개이며 전수 반영 감사는 아니다. 최초 조사의 과거 테스트 근거와 이후 이 작업에서 수행한 124개 검증을 구분한다. 아래 실행 기록은 중간 실패도 보존하며 현재 상태는 문서 상단의 결과를 따른다.

- https://github.com/openai/codex/pull/55991
- https://github.com/openai/codex/pull/52245
- https://github.com/openai/codex/pull/54654
- https://github.com/openai/codex/pull/56006
- https://github.com/openai/codex/pull/58404
- https://github.com/openai/codex/pull/57819
- [이전 컨텍스트 수정과 네 묶음](02-plan.md)
- [이전 선택 이식](01-plan.md)

## 승인된 실행
- #54654는 sol_executor가 handler와 Code Mode 동적 요청 회귀만 소유한다. Root는 #58404, 공유 실행기/보존 inventory/문서/출처/통합/검증/정리를 소유한다. 자식 재위임은 금지한다. 별도 read-only explorer는 검증 owner 호출 경로를 확인한다.
- #58404의 현 baseline은 TokenUsageContext/SpendingOnly 신형 API가 없다. 불필요한 선행 PR은 들여오지 않고 현 usage 기록 API에 request input raw-item count를 전달한다. 실패/usage 누락 응답은 경계를 전진시키지 않으며 로컬 재계산은 전체 covered boundary를 설치한다. 누적 비용 원장은 유지한다.
- provider별 projection은 원본 이력 index를 보존한 투영 helper로 이어서, 중복 제거/선택 skill/API projection 뒤에도 usage boundary의 의미를 보존한다. 원본 history를 바꾸거나 단순 projected-vector offset으로 계산하지 않는다.
- 검증: 기존 context history/recompute/provider-projection 회귀 + upstream unreported reasoning compaction 4조건 + 기존 encrypted reasoning 경계 + 동적 도구 Promise.all 동시 대기/역순 반환. 공통 3플랫폼 대상이며 실제 실행은 Windows x64, Linux/macOS는 미검증으로 구분한다. 새 상시 회귀는 차후 upstream 갱신/handler 재작성에서 opt-in 또는 request boundary/projection 연결을 누락하는 구체적 반복 가능성을 방지하는 최소 사례로 유지한다.
- 현재 checkout의 기존 미커밋 상태·index를 보존한다. 기록할 입력 동결/테스트 run은 artifacts/tasks/do3/runs/ 아래 신규 고유 owner로 만들고, 기존 공유 Cargo cache는 owner 절차로 재사용한다. 결과를 본 기록에 독립 보존한 뒤 일회성 복사본·로그·준비 출력은 owner 심사/일반 삭제로 정리한다.

## 실행 중간 근거
- #54654 구현 인계 완료: handler opt-in + 기존 Code Mode suite 연결 + 원본 115행 동시 대기/역순 응답 회귀. 원본 PR 내용 대조 및 CRLF-aware diff check exit0.
- #58404는 raw usage boundary, 초기 입력/empty response 입력 수, recompute boundary, remote compaction 모델별 tail, 원본 index 보존 projection으로 적응했다. 기존 history 회귀를 확장하고 원본 unreported reasoning compact 4조건을 추가했다. Cargo 전 대상 11파일 rustfmt exit0, 독립 정적 검토 대상6파일 rustfmt exit0. 구 메서드 caller 누락1건을 검토에서 찾아 수정했다.
- edit-baseline-r1은 수정 전 15파일을 복사했으나 종료 기록에서 catalog OS-lock 경합이 발생해 실제 controller exit1이다. 원본 preimage는 작업 분리·복구에 사용 중이며 현재 잠금/종료 상태를 지원 owner로 재확인한 후 close/review/delete한다. native lock worker15296의 종료 관측 불확실성도 보존한다.
- primary SOURCE는 조사 당시50527b72...였으며, 두 PR 외 동시 변경이 다수 있고 agent_profile Rust2파일이 미추적이다. 이들을 primary index에 임의 등록하거나 receipt에 전역 기록하지 않는다. native-r1은 current engine의 guarded copy 및 독립 disposable Git metadata로 전체 선택 바이트를 기록한다. 이는 기존 동시 코드를 수정하는 작업이 아니며, 출처는 테스트 복사본에만 기록한다. 개별 기능의 검증 범위를 unrelated 동시 변경으로 확대하지 않는다.
- source freeze 시작 UTC2026-11-01T19:41:54.625Z. 현재 입력 blob 생성 단계다. 고정한 입력 이후의 checkout 변경은 이 run에 섞지 않는다. EM02의 Rust1.95 Windows codex-core lib producer가 호환 target을 소유 중이라 Cargo는 시작하지 않았다.

- native-r1은 입력 blob 등록에서 Git의 Windows 긴 경로 미설정으로 실제 exit1. Cargo 미시작. native-r2는 같은 선택 소스에서 receipt에 선언된9348개 경로만 독립 복사하고 Git longpaths를 명시했다. SOURCE recorder 및 snapshot 검증 actual exit0, fixed source SHA e8299e384e2525ba29d1d4f1a337cdf5a47c431111cb5370c62c38d0c35a1842, fileCount9346, source receipt a597e5f556afa766bf9c3b9b9aecd91a92df4ecb0db7183b1ebf5b8aebb5508e. 원본 SOURCE/index에는 다른 작업 파일을 등록하지 않았다.
- tests-r1 최초 등록 시도는 catalog lock busy로 실제 controller exit1, runRoot 부재·Cargo 미시작. 별도 completion8a18eefd의 실패를 유지한다. 새 controller a0671bcb는 정확한 catalog lease leaf PID의 실제 종료를 기다린 후 권한/잠금 guard를 그대로 재시도하며, 부분 등록·같은 stale owner·다른 오류는 재시도하지 않는다. 이어 공유 Cargo target의 lease 부재 및 producer stopped/known 결과를 event로 확인한 뒤만 테스트한다.
- 입력 준비 중 formatter가 건드린 동시 변경의 모듈 순서/표현식/빈 줄은 원래 preimage로 복원했다. root의 변경 구간은14파일 모두 기존 미커밋 구간과 겹치지 않아 작업별 커밋 분리가 가능하다는 정적 mapping을 확인했다. 이 검사는 커밋이나 컴파일 성공을 뜻하지 않는다.

- tests-r1 controller도 shared cache generation 등록의 catalog 경합에서 actual exit1로 끝나 Cargo는 시작하지 않았다. 정확한 실패와 별도 native lease leaf 종료 근거로 지원 closeLifecycle을 사용해 failed 상태를 확정했다. 다른 작업의 producer나 lock을 변경하지 않았다.
- tests-r2 임시 실행기에서만 기존 native acquire API의 허용 범위인 최대5초 대기를 기본으로 전달한다. 보호·CAS·기본 실행파일·공유 코드·설치 설정은 변경하지 않았다. 실제 Cargo target key96c960bf...의 기존 producer 종료를 OS/file event로 기다리며 같은 물리 캐시의 중복 컴파일은 시작하지 않는다.
- 사용 종료된 native-r1/tests-r1은 검증된 standalone3b1f9bf4...로 inventory/register/review/apply/finalize 정리를 진행한다. 첫 inventory는 요청 limit500이 지원 상한200을 넘어 actual exit1, 변경·삭제 없음. 다음 호출은 limit200과 실제 pagination을 사용하며 이전 오류를 보존한다. 원문 요청/응답은 현재 helper 소유 edit-baseline-r1 안에만 두고, 필수 결과를 verification-03.json에 보존한 뒤 함께 정리한다.

- tests-r2는 최초 readiness 후 source snapshot 검증 사이에 다른 DO2 producer가 cache를 재획득해 beginExecution에서 actual exit1로 차단됐다. Cargo 미시작이다. tests-r3는 snapshot을 먼저 검증하고 각 실제 호출 직전에 readiness를 다시 확인한다. beginExecution의 정확한 미시작 경합 오류만 다른 owner의 실제 종료 event 후 재시도한다. 다른 오류나 unknown producer는 계속 보호한다. 현재96c960bf...는 DO2 native-r6의 실제 app-server lib producer가 사용 중이며 abandoned로 판정하지 않았다.
- cleanup-r2는 native register에서 catalog 경합과 pre-intent reservation retained로 actual exit1이다. apply/delete는 실행하지 않았다. 정리 감시자 exit4는 exit code 관측 실패이며 실제 정리 결과의 exit1과 구분한다. 지원 recover_reservation의 정확한 식별·종료 근거·필드를 별도 read-only owner가 확인 중이다. 전체 작업은 검증·정리·커밋 미완료다.

- tests-r1 정리 예약은 reservation-stop-03.json의 정확한 fence/종료 증거로 recover_reservation exit0, execution_outcome_changed=false로 해제했다. cleanup-r3은 지원된 5초 catalog 대기 후 register에서 exit1로 끝났고 삭제는 실행하지 않았다. producer-stop-03.json에 두 수동 close의 실제 종료 사실을 독립 보존했다. 기존 close가 mutable verification-03.json을 가리켜 과거 hash와 현재 내용이 달라진 사실도 기록하며 과거 결과를 재작성하지 않는다.
- 작업 전용 private index 후보55007e101365ffeebfca2556f3c7fac403568d87는 HEAD82537debf9d907fca912befa0a379c738747f006에 task hunk만 매핑했다. 원본 CRLF/혼합 줄바꿈과 JSON inline 형식을 보존하고 CRLF-aware diff check exit0. 아직 커밋하지 않았다. 최종 결과/정리 증거는 검증 뒤 갱신한다.
- tests-r3 managed work137f944f-0c10-43a4-b4ed-84a067bc819f / exec94455는 source snapshot 후 UTC20:17부터 공유 target96c960bf...의 기존 DO2 producer 종료를 기다린다. 이 결과가 실제 Cargo 시작 및 이후 소스 정리/최종 커밋의 선행조건이다. 대기 중 소스나 캐시 보호를 변경하지 않는다.
- tests-r3은 UTC20:24에 실제 Cargo를 시작해20:36:43에 exit101로 종료했다. 테스트 실행0개. 동결 시점의 동시 agent_profile.rs에서 windows_sys 의존성 및 validate_turn_account 함수가 누락된 컴파일 오류3개다. 현재 checkout의 해당 모듈은 이후에도 변경되고 있어 임의 수정/가져오기를 하지 않는다. 승인된 두 PR hunk만 HEAD82537de...에 적용한 정확한 Git tree55007e...를 별도 검증하며, 동시 작업 전체의 통합 검증과 구분한다.
- native-r3의 Git archive는 완성됐으나 Python 기본 압축 해제의 Windows MAX_PATH 초과로 exit1, Cargo 미시작이다. native-r4는 동일 archive SHA6a68cb604c2d518b39e479b64d80725e85ea1046e5f9c3a555a004418cff7639를 Windows namespace 경로로 해제하고 독립 출처를 기록한다. 입력 사용 중인 native-r3은 execution 참조로 보호한다.
- cleanup-r4는 결과/종료 증거를 cleanup-stop-03.json에 독립 보존한 다섯 superseded stopped run(native-r1/r2, tests-r1/r2/r3)을 검증된 standalone owner로 심사한다. native-r4 및 그 archive 입력인 native-r3, 작업 분리 preimage는 대상에서 제외한다. 정리 완료는 실제 결과와 부재 확인 후 기록한다.
- native-r4의 중복 Git hash-object는 8분간 약407개 객체만 기록한 실측을 확인했다. 동일 객체는 task Git tree에 이미 존재한다. 정확한 owned leaf49688/parent4348 및 자식 부재를 확인한 뒤 일반 Stop-Process로 종료했다. 준비 controller는 실제 exit1, Cargo 미시작이다. native-r5는 같은 archive를 해제하고 Git alternates/read-tree로 기존 불변 객체를 참조한다. 다른 producer를 중단하거나 공유 cache/설정을 바꾸지 않았다.
- native-r5는 SQL 줄바꿈 차이, native-r6는 기존 HEAD의 명세 누락 Rust4파일에 대해 출처 검사가 실패해 각 exit1/Cargo 미시작이다. native-r7은 기존 receipt와 정확한 해시가 일치하도록 SQL 줄바꿈만 복원하고 누락 source4파일을 포함해 recorder/snapshot exit0으로 완료했다. sourceSHA4058d7ddaf4c83e7c43324ed3cb36245204d37710ea8db9d4316f8f04a14d5e3, receiptSHA6e278c55ff0ea9b5ce80fbb57d11edda3af9f11bcf1da474ebbb1248b99c9158, fileCount9333. SOURCE Git blob4c4bcaba94cbe52de1c17040913bc736886fc8cd를 보존했다.
- tests-r7 exec94169/workab5eca4f-fc0e-4e69-8821-40d7e415e4d0는 위 고정 입력으로 Windows 선택 회귀를 실행한다. UTC21:04:33 시점에는 기존 DO2 native-r8 cloud_cache_tests가 target96c960bf...를 사용해 종료 event를 기다렸다. 현재 HEAD는82537de...로 유지되고 있다.
- native-r2의 cleanup-r4 등록 예약은 reservation-stop-04.json의 정확한 fence 및 실제 종료 근거로 recover_reservation exit0, execution_outcome_changed=false/pending_intents_changed=false로 해제됐다. cleanup-r5는 이미 등록된 native-r1/tests-r1만 fresh registered review/apply 후 실제 부재와 finalize를 확인한다. 나머지 묶음의 재측정 등록은 현재 검증 완료 후 진행해 catalog 경합을 줄인다.
- tests-r7은 UTC21:08–21:20 실제 Cargo 후 exit101, 테스트0개다. 원인은 task hunk 매핑에 섞인 동시 agent_profile 호출1줄이었다. Root의 분리 오류를 인정하고 전체 code diff를 감사해 이 호출과 별개 shared_state 필터 수정1줄을 후보에서 제외했다. 현재 workspace의 다른 작업 변경은 보존한다. 수정 후보는 b2c272724a537099e30f35da659572ccbff4fbb1이며 새 assertion/메서드 호출의 서식만 함께 정리했다. native-r8은 이 후보를 별도 고정하며 기존 테스트 입력을 수정하지 않는다.
- cleanup-r5 apply는 OS33으로 exit1. read-only 검토에서 manifest4715의 두 항목 present/remaining 및 cleanup_status null, decisions 없음, manifest.pending/예약JSON 없음이 확인돼 영속 intent/삭제 전 중단으로 판정했다. 실제 잠금 파일/소유자는 로그로 특정하지 못했다. 예약 복구는 필요 없고 강제 삭제/잠금 우회는 하지 않는다. 다음 시도는 fresh review/token 및 기존 opt-in timing 진단을 사용한다.
- native-r8 recorder/snapshot 및 준비 controller exit0. sourceSHA730eb28213902aa11830a16519dc59714de13fa89396d346e22edbe42d0b4004, receiptSHAfd27c0e428c5c26e21dae743ab0a7d81ce4f8ab4d6c63ae404ebfb530e5da16a, fileCount9333, SOURCE Git blob640df259a9f6abc09858205a11085b7148c42cb6. tests-r8 exec90689/workfff8287f-8e2e-4bfe-a7f6-8c5a8dd9d853는 source 검증 뒤 UTC21:46:22에 공유 cache 등록을 마치고 spawn-attempted로 전환했다. 관측 work359ddb2f...의 exit0은 이 단계 관측의 성공이며 테스트 성공이 아니다.
- cleanup-r6의 native review/apply는 exit0으로 native-r1/tests-r1을 삭제했다. 보조 helper가 finalize에 상대 evidence_ref를 넘겨 exit1이었고, 이후 절대 경로로 지원 finalize를 호출해 두 record finalized 및 실제 root 부재를 확인했다. 결과는 verification-03.json에 독립 보존했다.
- cleanup-stopped helper는 cleanup-stop-05.json의 실제 종료 증거를 가진 native-r2~r7 및 tests-r2/r3/r7만 대상으로 등록/registered review/apply/finalize한다. work4e4badbf-403d-48ae-a574-5ad3a38f50a5. 활성 native-r8/tests-r8, edit-baseline-r1, 공유 cache와 외부 Code Mode host는 제외한다. 테스트의 초기 catalog 등록 이후 시작해 경합을 줄인다.
- tests-r8: history95개가 실제 exit0/preflight accepted=true로 통과했다(UTC21:46–22:03). projection16개도 실제 Cargo0/실패0이지만 Cargo ownership finalization 오류로 wrapper1/preflight accepted=false다. 이전 승인된95개와 구분한다. 해당 cache 세대의 불변 terminal evidence에는 실제0이 보존됐고 이후 현재 generation이 진행돼 다른 producer를 close/recover하지 않았다. tests-r9(exec92655/work1b932a58...)는 같은 native-r8 소스로 projection부터 남은6개 검증 묶음만 실행한다. 이력95개를 중복 실행하거나 입력을 바꾸지 않는다.
- 기존 Code Mode host의 실행 참조가 누락되지 않도록 fixture-lease-r1이 do1의 code-mode-host-r1 revision2를 execution 참조한다. guard 준비 controller(exec17961)는 exit0, 실제 소비가 끝날 때까지 guard lifecycle은 pending이며 테스트 결과를 뜻하지 않는다. 소비가 끝나면 별도 실제 종료 근거로 close/release하고 이 작업 소유 guard만 삭제한다. do1 fixture 자체는 이 작업의 삭제 대상이 아니다.
- cleanup-stopped-1793569815479는 native-r2/r3/r4/r5 등록 성공 후 native-r6 등록의 catalog wait5초 초과로 actual1 종료했다. native-r6 예약 JSON은 없으며 apply 단계에는 도달하지 않았다. prefix4그룹은 cleanup-r7(work32100983...)의 fresh registered review/apply로 독립 정리한다. 나머지 native-r6/r7 및 tests-r2/r3/r7은 별도 helper에 배정했다. 경로가 겹치지 않고 native catalog/예약 guards는 유지한다. 두 helper 결과는 작업 소유의 서로 다른 summary 파일에 쓰고 root가 합쳐 결과 덮어쓰기를 막는다.
- 나머지5그룹 등록은 tests-r9의 짧은 lib 검증 두 묶음이 끝나고 첫 integration cache 등록이 완료된 단계에서 시작한다. 관측 work94079f3a...는 이 단계 또는 앞선 실패 파일만 알리며 테스트 통과를 뜻하지 않는다. metadata 마감 경합으로 반복되는 wrapper 실패를 줄이고, 긴 integration 컴파일 중 독립 파일 정리를 진행하려는 순서다. 기존 guards/5초 대기 상한은 바꾸지 않는다.

- tests-r9 ended1: projection16 accepted; recompute1 pass/1 fail because stale assertion added pre-recompute tail290 to complete total1310. Corrected assertion verifies total1310 and zero remaining tail. New task tree f2e66decbebcd6764691a872f722865b8b4b6202. Reuse native-r8 physical root only under a new lifecycle generation after checking consumers; update sole test file and provenance, then rerun all seven selected checks.
- cleanup-r7 native57384 ended1 after deleting native-r5 and recording deleted status; r2/r3/r4 remain. Recover four exact retained reservations using terminal native call plus Windows job-object worker teardown proof; preserve committed r5 result and rerun only remaining groups.

- Generation2 native-r8 preparation exit0: sourceSHA9753d593fa588fc7de7e43dbddab556e5fa7344a838160552cef6073ab56b410, receiptSHA9b97aa7a37769dc318acdce41bd41b1a4fb3b1f71b1f478480c89d3bc0dc2098, SOURCE blob61338b3ac48712ebb4589e030bb2fa0834caeed5. tests-r10 work70339511-aac8-427d-91af-472ac466fa31 waits existing EM02 shared Cargo producer after source checks.
- cleanup-r8 stopped at review because two registration source identities changed; no apply. cleanup-old-r9 refreshed unchanged groups using supported refresh_group and registered remaining groups, all eight exits0. Native49412 apply ended1 in catalog snapshot OS33 before first intent; supported abort released all reservations, no do3 reservation remains. Read-only owner investigates repeated lock source before another attempt. native-r5 was independently finalized after its prior saved deletion and recovery.

- cleanup-single-r10 native register/review/apply each exit0 but structured apply aborted/blocked and native-r2 remained, so wrapper correctly ended1. Failure is catalog snapshot OS33 followed by observation persistence maintenance_busy; raw dispatch0 is not deletion. No more unchanged retries during concurrent cache use. Keep protections; retry normal owner after verification/resource activity ends, or request explicit scoped retention if still blocked.

- tests-r10 all7 selected checks accepted, actual Cargo exits0,124 passed/0 failed; before/after source snapshots equal and Code Mode fixture unchanged. Controller exit0. Verification-stop-09.json preserves final input and fixture proof. cleanup-single-r11 after Cargo release deleted/finalized all8 older native/test groups and verified roots absent; controller0. Final cleanup closes fixture custody then deletes tests-r8/r9/r10, native-r8 and fixture-lease-r1; edit-baseline is last after essential evidence retained.

- ???? ??6? ??? ??? ???? ?? ?? ??? ????? ????. ?? ?? DO2 cleanup native29832/controller6972? ?? ??? ????. check_available? shared OS lock ?? observe_bounded? ?? ?? bytes? ???. ?? exclusive holder? ??? ?? wait ?? raw OS33? ? ? ??? ?? ???? ?? ?? ??? leaf? ??? ?? ???. final-r14? ? ??? ?? controller? ????? ???? ?? ?? event ??? ?? ????????? ????. ?? ??? ???????? ???? ???.

- final-r14 waited observed DO2 controller exit but tests-r8 registration still failed1; that one controller was not a sufficient sole-cause explanation. Passive Windows Restart Manager diagnostic compiled with installed C# compiler (no restart/shutdown API), normal register PID30484 succeeded0 with no error event. PowerShell-file policy block was preserved; execution policy was not changed. final-r15 deleted/finalized tests-r8, then tests-r9 register hit explicit maintenance_busy and no reservation. Passive resource query then identified live maintenance_owner44360 using both lock files; EH/FC cleanup operations were independently observed. final-r16 waits actual resource-user process exit before each normal operation and retries failed registration only with no retained reservation/no published group and an observed resource-owner event. No locks or foreign processes are removed or altered.
