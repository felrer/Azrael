상태: 완료 — 승인된 소스 수정·검증·커밋 및 임시 산출물 정리를 마쳤다. 제품 빌드·설치·실사용 수용은 별도 범위다.

# 프로젝트 실행 계정과 기존 대화 재개

## 목표와 승인 범위
- 실행 계정은 프로젝트별로 관리한다. 같은 프로젝트의 기존 대화는 다음 실행/수동 재개부터 변경 계정을 사용한다. 다른 프로젝트의 선택은 독립적이다.
- 브릿지를 관리 창구로 사용하고 실제 인증/저장/갱신은 기존 native owner를 재사용한다. Azrael 메인 기본 로그인은 프로젝트 선택을 덮어쓰지 않는다.
- 대화 기록, 완료한 도구 결과와 중단 위치를 보존한다. 계정 변경은 자동 재개를 유발하지 않으며 실행 중 계정 전환 admission을 보존한다.
- 사용자 승인: 수정 및 관련 검증/커밋. 전체 제품 빌드, 설치/배포, 실제 계정 변경이나 유료 모델 호출은 이번 범위에 포함하지 않는다.

## 증거와 기존 구조
- 설치된 win016-ez01-paint-r8 엔진은 0.162.0이며 기록된 engineSourceRoot는 artifacts/x/ez01i16short/project/engine이다. 이번 유지보수 대상은 운영 문서가 지정한 primary engine/이다. 설치본 수정은 별도 단계다.
- 기존 두 대화는 같은 workspace의 이전 context에 남고 현재 창의 계정 변경은 다른 context에 저장된다. 이전 profile metadata는 free, 서버 오류는 gpt-6.1-sol model_not_found다.
- installed/source recovery-state.cjs는 동일하며 systemError+failed+모델 오류를 재개 가능한 상태로 분류하지 않는다.

## 작업과 소유
- root: 프로젝트 계정 소유권, 호스트 경로, 엔진 통합, 설계/보존 inventory, 최종 검증 및 커밋.
- model_error_resume: recovery-state.cjs와 기존 관련 테스트의 정확한 모델 오류 후 명시적 재개 허용. 프로젝트 계정 작업과 독립적이다.
- project_auth_boundary: 기존 native 인증/계정 공유 seam의 읽기 전용 증거 조사. 설계 결정과 구현은 root가 소유한다.

## 플랫폼 및 검증
공통 동작: Windows x64, Linux x64, macOS ARM64. 실제 검증은 현재 Windows 환경의 선택한 Node/native 경계다. 다른 OS와 설치된 제품의 live 동작은 별도이며 통과로 주장하지 않는다.
성공 기준: 같은 프로젝트의 창/기존 대화/중단 후 재개 계정 일치, 다른 프로젝트 격리, 메인 인증과 분리, 실행 중 전환/실패 rollback 보존, 모델 오류 재개와 불명확 요청 중복 방지 보존.
기존 check/fixture와 native account switch/공용 실행기 검증을 재사용하며 모든 테스트가 실제 선택되어 종료했는지 확인한다. disposable 산출물은 기존 owner로 정리한다.
## 구현과 검증 진행
- 10:18 KST 첫 native 실행 시작. 기존 호환 Cargo cache win017-ft02를 재사용하고 primary engine/을 불변 입력으로 복사했다. 10:19:40 첫 app-server 검증 시작. default cache의 미확정 이전 소유 기록은 건드리지 않았다.
- 같은 프로젝트의 account runtime/admission과 전환/복구를 공유하고 창별 AuthManager·network policy·ThreadManager는 유지한다. UI/호스트 root 로그인은 자동으로 가져오지 않으며 explicit capture만 기존 자격증명 보존 절차를 사용한다.
- 검토에서 발견한 보완: 새 project selection은 전역 account-state.json을 상속하지 않는다. profile cache 두 read 경로 모두 transport policy를 검사한다. 재인증은 모든 peer manager를 저장된 새 token으로 reload하고 검증한다. 첫 실행이 입력을 고정한 뒤 발견했으므로 보완된 소스는 후속 native 검증 대상이다.
- Windows recovery-state 기존 suite: 345 pass, fail/skip 0, exit 0 (agent 실행). 모델 불가 오류만 명시적 재개로 허용하고 자동 재개/불명확 요청 replay 차단은 유지한다.
- cargo-preflight recipes suite: 16 pass, 1 fail, exit 1. 원인 agent.image-attachments.native의 기존 미등록 recipe로 baseline에도 해당 wrapper가 없다. 이 작업의 project-accounts recipe는 gaps 0, 6개 명시적 native filter로 확인했다. 관련 없는 누락은 이번 변경에 포함하지 않는다.
- 유지하는 작은 검사 이유: 이후 context 생성/인증 factory 간소화나 cache 재사용 수정에서 project admission, root 격리, policy별 핸들 전달을 빠뜨릴 수 있어 기존 경계 검사를 확장한다. 전역 fallback과 모델 오류 분류의 예외도 해당 간소화에서 재발할 수 있어 기존 fixture에 직접 검증을 연결한다.

- 첫 native 세대 결과: app-server config_manager 3, azrael account 17, retirement 1, shared-server 19 = 40 pass / fail·skip 0, 각 cargo exit 0. 고정 소스 SHA-256: 2529216ebd828f1e2e36685d35cf5203834b9b1e300629eda99aac068ef93bad. 첫 컴파일/실행 13분18초, 이후 같은 binary의 선택 검사 실행을 재사용했다.
- 10:35 KST 첫 producer의 정상 종료·참조 0을 확인하고 같은 run/입력 경계를 지원되는 lifecycle 새 세대 project-isolation-reauth-v2로 전환했다. 기존 source identity를 확인한 뒤 변경된 8개 파일만 갱신하고 primary와 동등성 및 불변성을 다시 확인했다. 최종 고정 소스 SHA-256: d2a665e45acedd219515e75924c8823d319d07a36f8d3f6381fd139f50c74b70. 10:37 최종 native 검사 시작; 이전 cache·경로를 그대로 사용해 불필요한 전체 재컴파일을 피한다.
- 프로젝트 경계 fixture는 constructor/runtime/admission 공유, 서로 다른 policy/manager, A→B 후 모든 peer의 다음 auth(), 독립 프로젝트 격리, pending switch 중 attach, 재인증 새 token 전파를 확인한다. 실제 turn·tool history/UI 실행을 증명하는 fixture는 아니며 제품 설치/실사용 수용은 별도다.
- engine.shared-engine manifest 구조/파일 참조 검사 exit 0. 커밋용 runner는 기존 HEAD의 recipe protocol과 구조를 유지해 신규 accounts 6개 호출만 추가했고, 작업 트리의 다른 미커밋 v2 전환·검사 축소 변경을 포함하지 않았다. staged runner의 실제 scope dispatch 6개·recipe 문법·inventory 등록·해시 일치와 CRLF을 보존하는 whitespace 검사를 확인했다.
- 추가 read-only 점검: custom 계정 UI는 azrael/account 관리 경로를 사용한다. 일반 native login/logout API는 기존 명시적 host 인증 흐름으로 유지하며 이번 변경은 그 API를 재설계하지 않는다. 새 project manager는 unmanaged lease를 해제하고 root 인증을 읽지 않는다.
- 재개 수정 커밋: 8ed62f7b (fix: allow explicit resume after ChatGPT model rejection).

- 최종 native 준비 중 login 테스트 filter를 auth::profiles::tests::로 지정한 실수를 확인했다. Cargo 컴파일/실행 exit 0이었으나 실제 실행 0개여서 selected-tests-v2 gate가 실패 처리(exit 1)했다. 통과로 계산하지 않았다. 실제 바이너리 --list에서 auth::manager::profiles::tests:: 19개를 확인해 runner/recipe hash를 수정했다.
- 해당 실패 driver가 gate의 합성 error를 producer 미종료로 오인했으므로, Cargo owner의 실제 synchronous close·exit 0 영수증과 외부 exec session 17263의 exit 1을 확인해 지원되는 closeLifecycle로 정확히 실패 종료했다. 미확정 결과를 성공으로 바꾸거나 PID 부재로 복구하지 않았다.
- 고정 소스 SHA는 동일하며 project-test-filter-v3 세대로 재실행했다. 프로필 검사 19 pass / fail·skip 0, Cargo 및 gate exit 0. 작은 단위의 실패 재실행과 소스 내용 변경 재실행을 구분한다.

- 세 번째 native 세대에서 app-server libtest 컴파일이 E0432로 실패(exit 101)했다. 새 auth fixture가 user_verification_test_support를 crate root로 잘못 참조했다. 실제 test-only user_verification::test_support를 재사용하고 Harness/new/shutdown 및 필요한 3개 필드에만 crate 내부 접근을 허용해 수정했다.
- project-fixture-import-v4: 고정 입력 SHA-256 006d256f2468eb2062dc29c1821555b71356bcc735df4fd65668f04bfd8a9b79. 변경 파일은 test-only fixture 경로/접근성 3개이며 product 동작은 동일하다. profile 19, config 3, state recovery 7, account 18개 검사까지 pass / fail·skip 0, 각각 실제 exit 0. 신규 project_peers_share_selection_and_next_auth_without_sharing_policy 실행 및 pass를 확인했다.
- 검증 중 다른 작업 커밋 c7d67ae5053e04bf48616c86348c3d8301818611이 추가됐다. task delta만 새 HEAD에 다시 적용하고 공유 inventory는 해당 feature 항목만 갱신해 동시 작업을 보존했다. 별도 index의 명시한 22개 파일만 검토했으며 main index나 다른 변경을 되돌리지 않는다.

## 최종 검증 요약
Windows x64, Rust 1.95.0, debug/test debug=0, sequential Cargo --locked --offline --lib -- --test-threads=1. 실제 검사 종료값과 0개 실행 방지 gate를 확인했다.

| crate / filter | pass | fail / ignored | Cargo exit / gate |
| --- | ---: | --- | --- |
| codex-login / auth::manager::profiles::tests:: | 19 | 0 / 0 | 0 / accepted |
| codex-app-server / config_manager::window_context_tests:: | 3 | 0 / 0 | 0 / accepted |
| codex-app-server / account_processor::azrael_state::durable_recovery_tests:: | 7 | 0 / 0 | 0 / accepted |
| codex-app-server / account_processor::azrael::tests:: | 18 | 0 / 0 | 0 / accepted |
| codex-app-server / account_processor::retirement::durable_recovery_tests:: | 1 | 0 / 0 | 0 / accepted |
| codex-app-server / azrael_shared_server::tests:: | 19 | 0 / 0 | 0 / accepted |
| 합계 | 67 | 0 / 0 | wrapper exit 0, producer stopped |

- 최종 frozen source SHA-256: 006d256f2468eb2062dc29c1821555b71356bcc735df4fd65668f04bfd8a9b79. 실행 후 같은 source identity를 재확인했다. 최종 native 실행은 10:53~10:58 KST이며 초기 준비·실패 재실행은 위 기록과 구분한다.
- node --test scripts/test-recovery-state.cjs: 345 pass / fail·skip 0, exit 0. 관련 recipe 집중 검사 2 pass / fail·skip 0, exit 0. 전체 recipe suite의 기존 image-attachments 누락 1건은 수정 범위 밖의 알려진 실패다.
- 실제 계정 변경·유료 모델 호출·설치 제품 실행·전체 제품 빌드/설치는 하지 않았다. Linux x64/macOS ARM64 실행과 실제 중단 대화의 설치본 수동 재개는 미검증이다. 대화/도구 결과 보존 및 자동 재개 차단은 기존 recovery 검사를 유지했다. 신규 native fixture는 인증 연결 경계를 검증하며 실제 turn/history 실행을 대신하지 않는다.
- 임시 run 및 입력은 결과 검토를 마쳐 정리 대상으로 전환한다. 삭제 전에 이번 코드 커밋을 완료해 해당 묶음의 임시 index 사용을 끝낸다. 기존 공유 Cargo cache는 기존 공유 owner/소비자 정책을 유지하며 신규 사설 cache를 만들지 않았다.

## 정리 완료
- 검증 결과·명령·실제 종료값·소스 SHA를 이 작업 기록과 기능 커밋에 독립 보존한 뒤 payload를 삭제했다. 삭제 전에 native registry의 기존 그룹 6페이지를 조회하고 신규 그룹을 등록했으며, 현재 membership/protection/reference 검사에서 두 멤버의 blocker가 없음을 확인했다.
- 실행기: artifacts/versions/maintenance-owner-ff01-reservation-win-x64-20261102/payload/maintenance_owner.exe. 선택 함수와 실제 SHA-256 c0cf7fa34948cceebbd10db45b0b55ecf0f42c7fae79079da673e8d6ce90c680를 재확인했다. registered 모드의 fresh token으로 두 멤버 모두 delete를 지정했다.
- artifacts/verification/fx-3ecc05b2: logical 193,160,238 bytes, native status deleted / remaining false, 실제 경로 부재 확인.
- artifacts/tasks/FX-01-project-account-selection/runs/20261106T011803282Z-1b4912d3-d7ec-44c7-aa62-b7ab2cb640ad: logical 2,908,075 bytes, native status deleted / remaining false, 실제 경로 부재 확인. 임시 Git index/patch, raw 로그, 실패 시도 자료도 이 묶음과 함께 제거됐다.
- apply exit 0. 기존 owner의 lifecycle finalize 결과 finalized, remaining/reference/blocker 모두 0. force 삭제나 ACL·소유권 변경을 하지 않았다. task-owned disposable 잔여물·보류 보관 요청은 없다. 기존 공유 Cargo cache와 관리 영역의 보호된 최소 영수증은 해당 owner 정책을 유지한다. 위 수치는 logical bytes이며 실제 회수 공간 측정은 아니다.
- 정리 종료 기록: 2026-11-06T02:07:05.763969+00:00
