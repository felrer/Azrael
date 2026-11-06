상태: 승인된 결함 수정·선택 Windows 검증·임시 자료 정리 완료. 실제 Rust361개 및 최종 실행기 Node291개가 통과했다. 과거 실패·취소·차단 결과는 별도 보존하며 새 결과로 고쳐 쓰지 않는다. 제품 빌드·재설치·push는 실행하지 않았다. 동시 변경 분리 문제로 커밋은 보류했다.

# 최근 Codex 업데이트 추가 적용 조사

## 현재 후속 조사와 해결 계획 (2026-11-02 KST)

### 남은 작업 후속 처리

사용자의 “남은 작업 처리”에 따라 기존 task-profile recipe 불일치를 수정한다. 실제 wrapper의8개 일반 호출과1개 exact ignored materializer-reader 호출을 모두 선언하고 마지막 호출의 fixture 환경 준비를 명시한다. 동적 JS writer의 전체 dependency/runtime closure가 result-cache 입력으로 감사되지 않았으므로 이 wrapper만 성공 결과 재사용에서 제외한다. Cargo 컴파일 재사용과 필수 실행은 유지한다. 기존 wrapper를 VM에서 실행해 실제9개 argv·격리·fixture 환경·정상 종료를 recipe와 대조하는 기존 테스트 파일의 작은 사례를 유지한다. 나중에 wrapper에 호출을 추가하면서 매핑/준비를 빠뜨리는 구체적 재발을 막기 위한 검사다.

현재 Cargo helper 세 변형도 검토했다. 검증된 내부 환경 전달·구조화 오류, immutable 종료 근거·독립 claim close, cache claim/close는 source test의 실제 명령·nonzero gate를 유지하며 제품 bundle/Code Mode host를 소비하지 않는다. exact normalized hash를 기존 source-only 감사 목록에 추가했다. 미감사 바이트·실패·unknown·불완전 receipt에서는 기존 보수적 바인딩을 유지한다. 첫 Node 검사37개 중31통과6실패:5건은 Python PATH 부재,1건은 위 감사 목록 미정합이다. 원 실패 로그를 남기고 Python313 경로를 명시해 재검증한다.

범위는 공통 verification tooling이며 실제 실행 환경은 Windows x64다. 제품 빌드·설치·push·다른 작업 SOURCE 일괄 갱신·무관한 staged 변경 편입은 하지 않는다. 산출물 owner는 `run:DO2:remaining-20261102-r1`이며 사용 종료 후 기본 owner로 정리한다. 이전 immutable 검증·정리 영수증은 수정하지 않는다.

후속 검증 완료: recipe·Cargo evidence cache37개와 Cargo 검증 helper56개, 합계93개 actual exit0/실패0/skip0이다. 필수 selected-tests-v2 전체 매핑 검사도 통과했다. helper 첫 실행의 대소문자 path 차이는 실제 canonical `do2` 경로를 사용해 재검증했으며 소스를 우회 수정하지 않았다. [후속 검증 영수증](verification-remaining-20261102.json)에 실패·재검증·현재 입력SHA를 독립 보존했다. 이 작업은 metadata/cache 실행 경계 검증이며 제품 Rust 검사를 다시 실행한 것으로 표시하지 않는다. 이전361개 Rust 검증은 그 고정 입력에만 적용된다. 현재 공유 파일은 앞선 작업 및 다른 세션 변경과 함께 dirty 상태여서 이를 포괄하는 커밋은 계속 보류한다. 사용자 지시 없이 다른 세션의 staged 변경을 함께 커밋하지 않는다.

후속 정리 완료: 현재 기본 FF01 standalone(SHA31cbf0c2…)의 stdin 등록·검토를 통과했다. 첫 apply는 stale review token으로 차단/attempted=false였고 실제 삭제를 시도하지 않았다. 새 review와 fresh token의 apply는 그룹deleted·remaining=false, 실제 경로부재다. 지원 finalize도 finalized/remaining=[]/references=[]/blockers=[]이며 요청 control은 일반 삭제·부재를 확인했다. 167,852 logical bytes를 정리했고 [독립 정리 영수증](cleanup-remaining-20261102.json)에 실패·재검토·실제 결과를 보존했다. 공유 캐시·설치물·다른 작업 자료는 보존했고 이번 후속 작업의 disposable 잔여물은 없다.

### 목표·권한·보존 조건

현재 실행 권한은 사용자의 “문제 해결해주세요”에 따라 이 문서 상단 해결 계획의 구현·검증·정리까지다. root는 환경 전달·진단 요약·선택 실행기/feature 매핑·출처·통합 검증을 소유하고, 독립 agent가 정책/요청 테스트·portable catalog, analytics/MCP fixture, 종료 게시 경계/경합 테스트를 각각 소유한다. 실행기 작은 회귀를 먼저 확인한 뒤 한 고정 입력과 공유 target에서 Rust 검증을 순차 수행한다. 공통 대상 Windows x64/Linux x64/macOS ARM64, 실제 이번 검증 Windows x64, Unix 실제 실행 미검증을 구분한다.

현재 소스 대조에 따른 정정: code_mode_dynamic_tools_tests.rs는 이제 Git 추적 파일이나 SOURCE 등록은 재확인이 필요하다. 실제 요청은 get_harness_base_instructions→compose_harness_instructions에서 runtime+공통 behavior와 custom 지시문을 합성한다. 명시 Some("")는 설정에서 보존하되 최종 요청 전체가 빈 문자열이라는 뜻은 아니다. 테스트는 custom literal 보존·빈 custom wrapper 생략·catalog 지시문 비유출과 공통 harness를 각각 확인하며 이 제품 정책은 바꾸지 않는다. analytics는 workspace 기존 tempfile을 dev-dependency로 재사용해 실패 시 RAII 정리를 보장한다.

산출물은 승인된 **현재 정책을 유지한 테스트 정합성·Windows 행동 검증·Cargo 관리 경계 수정과 검증·정리 결과**다. 기존 네 묶음의 제품 의미와 이전 승인은 유지한다. 제품 빌드·패키징·설치·push·계정 상태 변경은 포함하지 않는다.

기존 실제 실행 증거는 SOURCE50527b72…/sourceSha2565419e72f…의 Windows x64/Rust1.95.0에 한정된다. 이후 동시 변경을 포함한 현 working tree의 통과 증거로 사용하지 않는다. 현재 HEAD 대비 변경 수는 출처 누락 수와 동일하지 않다. 추적된 `core/tests/suite/code_mode_dynamic_tools_tests.rs`의 SOURCE 등록 및 다른 동시 delta를 구분해 새 고정 입력의 출처 정합을 확인한다.

### 원인과 권장 변경

| 문제 | 조사 결과·증거 | 권장 수정·검증 경계 |
| --- | --- | --- |
| 압축 한도1실패 | `models-manager/src/manager_tests.rs:773`은872000 capacity에828400 압축 한도를 기대한다. `protocol/src/context_policy.rs:149`와 [컨텍스트 정책](../../docs/architecture/context-policy.md)은 OpenAI API의272000 가격 경계×95%=258400을 적용한다. 용량과 압축 기준을 혼동한 기대값이다. | 모델 용량872000 검증은 유지하고 압축 기대값을 가격 경계 정책에 맞춘다. 기존 manager case와 `provider_context_policy_defaults_precedence_and_safe_cap`으로 확인한다. |
| 지시문4실패 | `models-manager/src/model_info_tests.rs`의 네 case는 catalog/config template을 `render_model_instructions` 결과로 기대한다. 현재 renderer는 공통 harness 지시문을 반환한다(`prompts/src/model_instructions.rs:35`). 명시 `base_instructions`는 별도 저장되며 세션에서 config→history→renderer 순으로 선택된다(`core/src/session/mod.rs:767`). `Some("")`도 명시 값으로 유지된다. | metadata 저장 검증과 최종 prompt 검증을 분리한다. renderer는 공통 harness 계약을 검증하고, 사용자 명시 지시문·빈 값은 기존 `personality::config_personality_none_preserves_explicit_base_instructions` 등 실제 request case로 보존한다. 직접 관련된 `step_settings_tests::model_resolution_preserves_startup_overrides_and_instruction_provenance`에도 같은 낡은 renderer 기대가 있어 함께 대조한다. 이 추가 case의 실패는 아직 실행 확인하지 않았다. |
| analytics1실패 | `threads_tests.rs:129`의 negative fixture는 TEMP가 Git 밖에 있다고 가정한다. workspace 내부 TEMP에서는 `git-utils/src/info.rs:773`이 조상 .git를 찾아 `Some(false)`를 반환한다. 기록된 실패와 현재 호출 경로가 일치한다. | 임시 자료는 artifacts 안에 유지한다. positive primary/linked fixture를 보존하고 negative 경로에는 검증 불가능한 .git metadata 경계를 명시해 조상 checkout과 독립적인 unknown 사례로 만든다. 기존 workspace의 tempfile/teardown 방법을 재사용해 실패 시에도 정리한다. 실제 Git 분류 의미와 None/false/true assertion을 유지한다. |
| MCP1실패 | `cloud_plugin_tests.rs:547`의 removed turn은 직전 실패 후 즉시 재조회를 기대한다. 새 cooldown은 같은 auth/resource에서30초 동안 이전 성공 catalog를 보존한다. `:618`의 reconnect 조건은 실제 scenario 목록에 없는 두 이름을 사용해 실행되지 않는다. | 같은 scope의 cooldown turn은 discovery0회·이전 catalog 유지로 검증하고, removed/new-account-discovered는 실제 reconnect 및 resource 변경 뒤 회복을 검증한다. provider 호출 수 assertion도 scenario별로 맞춘다. 기존 paused-clock backoff case(`:774`)의30/60/120/240/300초 상한·reset 검증과 실제 lifecycle case를 재사용한다. |
| 원격 모델 통합0개 | `core/tests/suite/remote_models.rs:1`의 Windows 제외가 파일 전체에 적용돼 신규 `failed_catalog_refresh_preserves_tool_search_on_the_next_turn`까지 제외된다. 필터 자체보다 플랫폼 등록 범위의 문제다. | 새503→이전 catalog/다음 turn tool_search 보존 case만 모든 OS에서 등록되는 기존 `models_cache_auth.rs`로 옮긴다. 공통 mandatory filter를 연결하고 Unix의 기존 remote_models 검증도 유지한다. 파일 전체의 플랫폼 gate를 제거하거나0개 성공을 허용하지 않는다. feature inventory의 소스 소유권·체크를 함께 갱신한다. |
| trace wrapper1·종료 게시 | r11/r12는 각각 실제 Cargo0/1통과지만 wrapper1/accepted=false다. 정확한 immutable 종료 증거와 후속 지원 close0은 남아 있다. 현재 lifecycle catalog 획득은 `waitMs`를 전달하지 않아 기본0ms다(`artifact-lifecycle.cjs:123`, `maintenance-lock-owner.cjs:28`). 최초 close 오류의 cause chain은 기존 요약에 없어 두 건 모두 catalog 경합이었다고 확정할 수 없다. | 기존 lease의 최대5000ms 대기를 종료 게시 경계에 명시하고 typed Busy의 안전한 획득 단계만 처리한다. 동일 generation/revision/evidence 및 기존 idempotent close를 사용한다. write 결과 불명·종료 불명·지속 경합은 보호와 wrapper 실패를 유지한다. 원 Cargo exit, source 감사, 게시 단계·원인 code/lock_path/lease context를 기존 run 진단에 제한적으로 보존한 뒤 실제 일시/지속 경합으로 확인한다. 기존 실패 이력을 성공으로 바꾸지 않는다. |
| 실행기 환경 전달 | 선택 runner가 `isolateHostEnvironment:true`를 전달하고 `cargo-verification.cjs:50`은 모든 AZRAEL_/CODEX_를 제거한다. 따라서 `AZRAEL_CARGO_CACHE_PROJECT_ROOT`·RUN_ID·STABLE_SOURCE도 사라진다. host는 CARGO_ 변수라 남고 target/profile은 먼저 argv로 옮겨진다. 기존 격리 회귀는 관리 값 보존을 확인하지 않는다. | 사용자 런타임 환경 격리와 검증된 내부 관리 옵션 전달을 분리한다. 격리 후 선택된 project/run/source/cache 관리 값만 명시적으로 주입하고 실제 자식 환경·소유권 획득을 검증한다. 일반 AZRAEL_/CODEX_ 변수와 계정·socket 환경의 차단은 유지한다. |

지시문·Git fixture 분류는 보존된 실제 실패 요약과 현재 계약/소스 대조에 근거하며, 패치 전 red/green 재현을 수행한 것은 아니다. 실제 사용자 지시가 누락된다는 증거는 현재 없다. 넓은 core 전체의 통과도 확인되지 않았으므로 직접 연결된 호출자 테스트를 포함해 검증해야 한다.

**앞선 결론 보정:** r11/r12의 정확한 최초 finalization 오류를 catalog 경합으로 단정했던 표현은 근거 범위를 넘었다. 종료 게시 실패와 무대기 획득 경계는 확인했지만 최초 오류의 구체적인 종류는 미확인이다. 원문 run은 이전 정리 절차로 이미 삭제됐고, 남은 immutable Cargo 종료 영수증은 동일 cwd/target·실제0·실행시간을 확인한다. 이 자료에도 최초 ownershipErrors는 없다. 후속 재현과 구조화된 원인 기록이 필요한 이유다.

### 구현 순서·입출력·검증

1. **현재 입력과 동시 작업 정합:** 실제 `engine/`와 변경 중인 Cargo/lifecycle 스크립트의 기존 수정을 보존한다. 미추적 파일은 소유 작업에서 추적/완료하도록 조정하거나 필요한 등록 권한을 확인한다. 정확한 변경만 출처에 기록하고 전체 coverage 검사를 통과한 후 최종 입력을 한 번 동결한다. 과거335통과를 새 전체 입력의 영수증으로 전용하지 않는다.
2. **실행기 선행 수정:** managed 환경 전달·종료 진단·bounded lock wait를 기존 Cargo/lifecycle owner에서 보완한다. 새 scheduler·자동 unknown 복구·일반 재시도 framework를 만들지 않는다. 관련 dirty 변경은 이미 존재하므로 현재 구현에 통합하고 다른 작업을 덮어쓰지 않는다. 작은 Node 회귀와 실제 native lease의 짧은 경합 검증을 먼저 통과시켜 긴 Rust 재실행의 조건을 확보한다.
3. **테스트 정합성·플랫폼 공백:** 위7개 실패와 직접 연결된 core 지시문 case를 현행 계약에 맞추고, 공통 catalog503 case를 portable module로 연결한다. 현재 정책·권한 거절 시 cache 무효화·사용자 지시 우선·256 pending 상한·trace parent·cooldown 의미는 유지한다. 문서는 바뀐 실행기 진단/운영 계약과 체크 매핑만 갱신한다.
4. **작은 수정 검증:** manager의 해당5개 case, prompts 공통 지시문 회귀, core 명시 지시문/빈 override 요청, analytics fixture case, MCP lifecycle+paused-clock case, Windows portable catalog case를 선택한다. 이 단계의 실패는 first causal error를 보존해 수정하고,0개·무시·미종료는 통과로 세지 않는다.
5. **네 묶음 통합 수락:** 한 고정 입력·호환 target/profile/features·명시 host identity로 기존6개 선택 suite 및 직접 영향받은 추가 지시문 case를 실행한다. 동일 물리 target은 한 producer가 사용하고 다른 실제 실행은 완료 이벤트를 기다린다. 동시 소스 전환으로 캐시를 계속 교체하지 않도록 실행 순서를 조정한다. Windows 회귀를 필수로 하고, Unix 전용 case는 Linux/macOS의 실제 실행 결과와 Windows 제외를 구분해 기록한다.
6. **실제 종료 경계 수락:** 일시 경합은 Cargo 실행을 반복하지 않고 최종 게시까지 정상 종료해야 한다. 대기 소진·CAS 불일치·write 응답 불명·unknown producer에서는 실패/보호가 유지돼야 한다. 시작 전 work completion과 원 실행 결과를 연결하고 별도 process 종료 관측을 테스트 통과로 해석하지 않는다.
7. **완료:** 실제 argv/자식환경/원 exit/테스트 수/게시 결과/원인 필드를 작은 독립 영수증에 보존하고 작업 산출물은 기존 owner로 정리한다. 새 review token·명시 delete·실제부재·finalize까지 확인한다. 필수 검증 통과·문서·정리 이후 본 작업 변경만 커밋한다. 제품 빌드·설치·push는 별도 범위다.

### 수락 조건과 남은 한계

고정 검증 진행: candidate SOURCE823ede35…/source46e5c7ef…는 exact10delta·9342파일 전체 provenance/coverage actual0이다. 변경된 실행기와 의존성은 별도 scripts 복사본에 고정했고 Node291/291 actual0, 추가 fixture/실행 경계43/43 actual0, selected-upstream recipe 일치1/1 actual0, frozen/primitive 오류 보존6/6 actual0을 확인했다(중복 실행 횟수와 고유 사례 수는 구분). 최종 Rust controller는 work2eafb7fd-8246-4e38-959b-608c7c2a8e3c에 연결했으며 여섯 suite를 같은 frozen source에서 순차 실행한다. `artifacts/tasks/do2/runs/repair-20261102-r1`은 검증·진단에 사용 중으로 아직 삭제하지 않는다.

실제 Rust 첫 실행은 analytics127/127(Cargo0/accepted=true) 후 다음 appserver 호출의 shared cache pending 등록이 catalog acquisition Busy로 미시작 차단되어 controller1이다. 원인은 현재 상세 cause/maintenance_busy/lock_path/acquire 단계로 확인됐으며 최초 trace 두 건과 혼동하지 않는다. 이 추가 준비 경계의 pending claim에만 기존 native withCatalogLock waitMs5000을 적용했다. 잠금은 claim 직후 반환하고 Cargo/출력 생성 중 보유하지 않으며 CAS/write/unknown 재시도는 없다. 실제300ms lease 경합·단일 claim의 기존6개 Node case 확장 검증 actual0. source/환경이 같은 analytics127 결과를 재사용하고, 새 실행기 고정 p2/scripts로 미시작 appserver부터 계속한다.

현재 native 수락: analytics127, app-server20, models-manager62, model-provider8, protocol34, prompts10, core 지시문2 모두 Cargo0/accepted=true다. r2 controller(work410e1d21-a75c-45ec-8649-baf943604357)는 02:53:12Z부터 진행하다 MCP 호출 시작(03:48:48Z) 뒤 executor cancelled/exit1로 종료돼 전체 성공이 아니다. 해당 MCP Cargo 결과는 unknown/null로 보존했다. executor 종료 관측에 더해 전체 Windows process snapshot에서 정확 coordinator/descendant·Cargo/compiler/linker·target 실행 파일 부재를 확인하고, 지원 close로 취소된 cache-owner 실행 실패(null Cargo exit)를 기록한 뒤 exact token/SHA의 recoverTargetOwner로 stale lease만 퇴역했다. recovery receipt의 원 결과도 unknown/null이다. FE01-core-r5가 target을 선점했으므로 r3(work3e8a2b6d-4947-4222-bf4f-4e70fe6c6fe6)는 파일시스템 해제 이벤트를 기다려 MCP·trace부터 재개한다. 통합2suite는 별도 r4로 준비했으며 아직 실행하지 않았다. 이번 변경9개 source와6개 script의 primary/frozen hash는 현재 모두 동일하다.

현재 실행 입력은 기존 accepted source e05346a3…(input:66b9e879d0a15d55e7ebda6c)에 이번 테스트9파일과 analytics tempfile lock dependency만 적용한 독립 candidate로 한정한다. source 원본의 동시 변경을 따라가지 않으며 primary SOURCE를 포괄 갱신하지 않는다. e053→505의8개 유지보수CLI/사용량 delta는 이번 여섯 결함 경로 밖이므로 제외하고, 정리/lease 실행은 실제 기본 FC02 standalone을 그대로 검증해 사용한다. Node도 동시 maintenance-preferences 의존성 추가로 fixture closure 누락을 발견해 복사 목록을 보완했고, 고정 scripts 복사본에서 최종 검증한다. 최초 실패·MAX_PATH/Git filename-too-long 준비 오류와 재시도는 run별 결과에 보존한다.

r3는 target 해제 후 03:59:59Z에 시작해 MCP cloud6·plugin5·skill cache4·core reconnect1, 합계16개를 Cargo0/accepted=true로 확인했다. 다음 trace suite는 04:27:53Z에 시작했지만 pending cache claim의 catalog wait5000ms 소진으로 Cargo 미시작/실제0개/래퍼1이다. 원인 maintenance_busy, lock_path, lifecycle-begin 단계가 보존됐으며 bounded guard를 확대하거나 실패를 통과로 처리하지 않았다. FE01-core-r8의 공유 target clean이 실행 중이므로 r5(work00643721-81e0-4724-b2b8-a7ab09205e95)는 해제 이벤트 후 trace만 실행한다. 성공한16개를 반복하지 않으며 통합2suite는 남아 있다.

r5는 target 해제 뒤 약95초의 full-source 감사 중 FE01의 새 claim이 시작돼 cache unresolved guard에서 Cargo 미시작/래퍼1로 종료됐다. 이는 종료 불명 producer를 우회하지 않는 정상 보호이며 재시작 근거가 아니다. 이후 관측한 정확 target owner는 살아 있는 FE01-core-r8 test다. r6(work21f334a8-2ccf-4831-b6e4-c8b9965adc56)는 출처 감사를 먼저 완료하고 실제 Cargo 직전에 target 부재와 cache의 stopped/known outcome을 파일 이벤트로 기다린다. r7(work2bc718f9-e10b-4dab-94dc-72ac058f5d27)은 통합 입력 감사를 병행 준비하되 r6의 accepted·최종 source 감사 통과 및 target/cache release 후에만 통합 검증을 실행한다. timeout 확대·unknown 복구 자동화·중복 producer는 추가하지 않았다.

r6 trace는 Code Mode71·실제stdio1 모두 Cargo0/accepted=true, wrapper0이며 source/host/scripts 최종 불변을 통과했다. 04:36:36Z–04:49:58Z 실행 뒤 source 감사까지 완료했다. r7의 portable catalog 통합은 실제1개가 실행됐으나 models_cache_auth.rs:435의 첫 tool_search 활성화 assertion에서 실패했다(Cargo101,0통과1실패). Windows 등록 공백은 해소됐지만 행동 수락은 실패이며 기대를 약화하지 않는다. 해당 fixture/config/모델 경로는 기존 정책 담당 agent가 조사하며 고정 candidate는 수정하지 않는다. 독립 r8(workb8116823-870e-40a9-bf11-c0860766f629)은 같은 고정 입력에서 아직 미실행인 personality·skill lifecycle 통합만 진행한다.

portable catalog fixture 원인: 현재 config는 agents를 V2/Disabled로 선택하므로 과거 Collab=true/MultiAgentV2=false 토글만으로 deferred 도구가 생기지 않는다. 기본 V2는 DirectModelOnly이고 tool_search 등록에는 실제 deferred entry가 필요하다. 기존 공통 namespace-budget fixture 패턴을 재사용해 Direct mode·agents_disabled·defer_loading=true 도구1개를 명시했다. 초기 tool_search 및503 이후 catalog·도구·지시문 보존 assertion은 유지했다. root의 좁은 포맷 보완 뒤 pinned rustfmt check0, 최종 primary SHA bae1ced5cebfd25bdb52f59235eb23e03936483bf11e963187c5f5ae8ef335ed. 기존 candidate는 그대로 두고 candidate2/source-prep-r5(work2ab9eb38-39b3-4598-b991-2835ed5ec9c8)에서 새 exact10 입력을 준비한다. 이후 영향받은 catalog 통합을 재검증하며 기존 결과의 입력 세대와 범위를 구분한다.

r8은 명시/빈 override 포함 personality6·skill lifecycle3 모두 실제 Cargo0/accepted=true, wrapper0이며 기존 source 불변이다. candidate2 준비도 actual0/ready(SOURCE60f07449…/source3408677a…)이며 전체 file map 대조에서 candidate1과 다른 payload는 models_cache_auth.rs 단1개다. 나머지 crate/사례의 이전 세대 결과는 그대로 구분해 재사용하고 candidate2 전체 suite를 새로 실행했다고 표시하지 않는다. r9(work70b2e2e5-4a1f-4307-ab19-15930f778bd7)는 수정된 portable catalog exact1개를 재검증한다. CRLF-aware 최종 scoped diff check도0이며 원래 줄바꿈을 보존했다.

최종 선택 수락: r9의 corrected catalog 실제1개도 Cargo0/accepted=true, wrapper0 및 source 감사 통과다. 고유 Rust361개가 통과했고 최종 실행기 Node291개, 추가 fixture guard43개와 selected recipe1개도 actual0이다(겹치는 Node 실행은 합산하지 않는다). [독립 검증 영수증](verification-repair-20261102.json)에 두 고정 source 세대·sole-file delta·argv/실제exit/count·host/scripts identity·이전 실패/취소를 보존했다. 동일한6개 primary script와 fixture 수정 외8개 primary source는 검증 바이트와 일치한다. 전체 run은 해당 immutable 영수증으로 정상 close해 execution 참조를 해제했다.

최종 정리: 기본 FC02 standalone의 첫 등록은 catalog check_available Busy/exit1이었으며 자기 예약이 남지 않았음을 확인한 재등록은 exit0이다. fresh registered review는 blockers=[]·references=[]였고 명시 delete의 실제exit0, 그룹deleted·항목remaining=false·경로부재를 확인했다. 326,279,602 logical bytes의 run(두 candidate·고정 scripts·로그·실패 준비본·임시 control)을 05:14:19Z–05:22:11Z에 삭제했다. 물리 회수량은 도구가 null로 보고해 추정하지 않는다. 지원 finalize는 finalized/remaining=[]/references=[]/blockers=[]이고 work의 일회용 정리 control도 일반 삭제·부재 확인했다. [독립 정리 영수증](cleanup-repair-20261102.json)만 보존하며 새 archive·보존 대기·남은 disposable은 없다. 공유 Cargo target·기존 host·설치물·다른 작업 자료는 삭제하지 않았다.

기존 수락 시 남았던 task-profile-skills.isolation의 stale wrapper mapping은 상단 “남은 작업 후속 처리”에서9개 실제 호출·materializer 환경으로 정합 수정했고 전체 매핑 검사를 통과했다. 동적 fixture의 성공 결과 캐시는 제외해 실행을 보장하며, 현재 검증을 task-profile 제품 전체의 새 native 수락으로 확대하지 않는다. primary SOURCE의 동시 변경 미정합과 공유 script의 혼합 변경 때문에 안전하게 분리한 작업 커밋은 만들지 않았으며 다른 작업 파일·index는 보존했다.

- 기존7개 실패가 승인된 정책을 유지한 수정으로 해소되고, 직접 관련 core 지시문 case 및 실제 사용자 명시/빈 지시문 요청이 통과한다.
- Windows에서 catalog 실패 보존의 실제 core 통합 테스트가1개 이상 실행되며, Unix 기존 검증 범위도 유지된다.
- environment isolation 후 관리 project/run/cache 정보와 명시 host가 올바르게 전달되고 일반 사용자 runtime 변수는 격리된다.
- Cargo0·실제 nonzero passed·source 불변·정상 소유권 종료 게시가 모두 충족돼야 새 실행을 수락한다. 실패한 원 r11/r12의 accepted=false는 유지한다.
- 일시 경합, 지속 경합, 알 수 없는 종료를 구분한 native/Node 검증과 현재 platform별 미검증 항목을 명시한다. 새 실제 실행 증거는 위 두 고정 입력의 Windows x64에 한정되며 Linux/macOS 또는 전체 checkout의 통과로 확대하지 않는다.
- 반복 재컴파일의 세부 원인은 당시 Cargo fingerprint 진단이 없어 미확인이다. 현재 stable-source 준비는 `cargo build`에만 적용되므로 환경 전달 수정만으로 `cargo test` 경로 안정화까지 해결됐다고 주장하지 않는다. 같은 입력/경로에서 재사용을 측정하고, test용 stable-source 확장이 필요하면 영향 범위를 별도로 검토한다. 정리기 전체 성능 최적화는 이번 결함 수정 범위에 포함하지 않는다.

## 요청·권한·범위

2026-10-27 KST 기준 공식 Codex 변경사항을 현재 Azrael 및 이전 선택 이식 작업과 비교한다. 사용자가 권고 개선을 승인했으므로 #55991을 Terra보다 먼저 구현·검증한다. 허용 범위는 아래 네 제품 코드 지점, 기존 회귀 확장·보존 실행기/문서·출처 정합과 필요한 테스트 준비 컴파일·정리·작업 커밋이다. 제품 빌드·패키징·설치·push 및 사용자 state 변경은 포함하지 않는다. 기존 01-plan.md의 구현·검증·보류 결정을 유지하며 이전 작업의 미해결 정리·출처·커밋을 완료 처리하지 않는다.

공통 엔진/호스트의 모델 호환성은 Windows x64, Linux x64, macOS ARM64 공통 검토 대상이다. 실제 조사는 Windows x64에서 정적으로 수행했다. 각 플랫폼의 native/설치 수락, 실계정 모델 제공 여부, 모델 호출 성공은 검증하지 않았다. Window Use는 현재 Windows 전용 정책을 유지한다.

## 기준 및 공식 변경

- 공식 RSS를 Node fetch로 실제 조회했다. 최신 정식 CLI 항목은 0.164.0(2026-10-23)이며 0.165 이상을 이번 피드에서 확인하지 못했다. alpha/main은 조사 범위 밖이다.
- 최신 새 항목은 GPT-6.1 Terra 제공(2026-10-26)이다. 공식 모델 안내의 CLI 최소 요구는 0.159.0이다. 따라서 Terra 사용을 위해 Azrael 기준 0.162.0을 무조건 전면 교체해야 한다는 근거는 없다. Azrael 수정판 및 pinned UI의 실제 호환성은 별도 검증이다.
- engine/SOURCE.json baseTag는 rust-v0.162.0이다. 일반 VS Code 설치 디렉터리는 azrael-ex-local.azrael-2026.0.12이며 .azrael-independent-host.json / .azrael-official-ui.json의 UI sourceVersion은 26.1007.21434다. 저장소 scripts/azrael-app-release.json은 2026.0.13이다. 저장소 버전과 설치 버전, 실행 중 창은 구별한다. 이번에는 실행 중 프로세스/바이너리 정합성까지 확인하지 않았다.
- 이전 01-plan.md의 최종 결과에 핵심 선택 이식 소스와 Windows native 625개 및 source/feature/pipeline 81개 성공이 기록돼 있다. 이는 이전 고정 입력의 결과이며 현재 모든 미커밋 변경 및 설치 패키지의 재검증 결과가 아니다. Linux/macOS native 분기는 미검증이다.

## 추가 적용 판정

| 우선순위 | 항목 | 근거·권고 |
| --- | --- | --- |
| 높음 | Terra 장문 요금·비용 표시 | protocol/src/context_policy.rs의 OpenAI 272K 경계 목록과 core/src/project_usage_rates.json에 gpt-6.1-terra가 없다. 공식 Terra 문서는 입력 272K 초과 시 input/cache 2배, output 1.5배를 명시한다. 현 정책은 Terra 가격을 unknown으로 처리하며 API 경로의 기본 압축이 비용 경계를 피한다고 보장하지 않는다. 정확 ID 규칙·가격표·경계 테스트 보완 권고. 구독 기본 300K 계약과 API 요금 기준은 구별한다. |
| 중간 | Terra fallback·모델 기능 | models-manager/src/model_info.rs:19/111/146에서 기존 Sol/Astra/Luna만 특별 처리한다. Terra는 bundled models.json에도 없다. 서버 metadata가 없으면 일반 fallback 272K·빈 reasoning 목록·기본 modality를 사용한다. 공식 API는 1,050,000 context, 128,000 output, text/image 입력, reasoning none/low/medium/high/xhigh/max 및 Responses tool calling을 명시한다. 이 API 수치를 구독 metadata에 강제하지 말고 원격 metadata 우선·offline fallback·실제 허용 기능을 검증해 보완한다. |
| 중간 | 실계정 목록과 UI 수락 | provider-model-picker.cjs:73은 model/list 전체 페이지를 읽고 models-manager/src/manager.rs:705는 계정 식별을 확인해 원격 catalog를 적용하므로 이름 allowlist 때문에 Terra가 무조건 차단된다고 볼 수 없다. 계정별 모델 refresh, 선택 유지, 이미지·도구 요청, reasoning 및 재개를 확인한다. Astra/Sol 전용 Ultrafast UI/보정 목록에 Terra를 근거 없이 추가하지 않는다. |
| 조건부 | GPT-5.5 은퇴 대응 | 공식 안내는 ChatGPT 로그인 Codex만 10/14 은퇴이며 API key는 제외한다. bundled catalog의 gpt-5.5 잔존만으로 장애라고 볼 수 없다. 정상 원격 목록은 subscription/API-key에서 authoritative 경로를 쓰므로 계정 분리를 보존한다. 저장된 default/agent/task가 실제 5.5를 고르는지 동의된 범위에서 점검하고 안내하는 개선을 권고한다. 사용자 설정 자동 치환이나 API 모델 삭제는 권고하지 않는다. |
| 조건부 | 기존 보류 기능 | Windows NTLM/Negotiate proxy, EMA MCP, remote credential masking, marketplace ownership 및 daemon log cap은 01-plan.md에서 이미 검토·보류했다. 새 필수 누락으로 재분류하지 않는다. 해당 기업망·인증·원격 수요가 생길 때 별도 범위로 진행한다. 로그/정리기는 Azrael instance와 artifact lifecycle에 적응시켜야 한다. |
| 낮음 | 전체 0.164 / TUI·UI 교체 | 핵심 수정의 선택 이식 기록이 있고 신규 정식 CLI는 확인되지 않았다. /presets, inline 명령, Kitty/Sixel 이미지는 터미널 경로라 VS Code UI 도입 필요성과 별개다. 현재 근거로 전체 교체를 우선하지 않는다. |

Terra 비용 보완 시 cache-write TTL도 확인해야 한다. 현재 project_usage_pricing.rs는 OpenAI 단일 write rate를 전제로 하지만 Terra 공식 가격은 30분/12시간 write rate를 구분한다. 관측 usage가 TTL을 제공하지 않으면 비용을 추정할 수 없는 조건을 명시하고 정확한 것처럼 표시하지 않는 기존 원칙을 보존한다.

## 권고 실행 범위와 검증

### #55991 적용 검토 — retained reasoning 중복 계산

**판정: 기준 소스에 미반영돼 있던 #55991을 승인 범위대로 선택 이식했고 Windows focused 102개 검사를 통과했다.** 공식 0.164.0 전체 changelog와 원본 patch를 실제 조회했다. upstream commit은 `07cc649c658be7018b6913299f12f843b24679f8`, 제목은 `Avoid double-counting retained reasoning in token usage (#55991)`이다. 검토 당시 checkout HEAD는 `1b853c6384ee2a327b151f4d9e60cbf2ee2dde01`이며 기존 미커밋 변경을 포함한 파일을 읽었다. 초기 미반영 판정은 제품 장애 재현이 아니라 정적 대조에 근거한다.

원인은 Responses Lite가 `X-Reasoning-Included` 헤더 없이도 retained reasoning을 reported usage에 포함하는 데 있다. `history.rs:985`는 마지막 서버 total_tokens에 tail을 더하고 flag가 false면 과거 encrypted reasoning 추정치까지 더한다. 로컬 recompute도 이미 전체 reasoning을 포함하므로 동일한 가산을 해서는 안 된다. 전체 대화가 두 번 전송되거나 요금이 이중 청구됐다는 수정이 아니다. 앞선 답변의 일반적인 중복 설명은 **Responses Lite의 헤더 없는 usage 및 로컬 재계산**이라는 구체적 조건으로 한정한다.

| 원본 변경·현재 대응 지점 | 검토 당시 Azrael 기준 | 적용 내용 |
| --- | --- | --- |
| `core/src/session/turn.rs::try_run_sampling_request` | 요청별 flag 초기화 없음; 이벤트 override만 있음 | 매 sampling 요청 직전 그 요청의 `step_context.settings.model_info.use_responses_lite`로 설정. retry·tool 후속 요청·모델 전환에도 같은 규칙 적용 |
| `core/src/compact.rs::drain_to_completed` | managed/Devin/native stream 분기 앞 초기화 없음 | 압축 요청마다 해당 `turn_context.model_info().use_responses_lite`로 설정. 기존 성공까지 output buffering 및 실패 이력 보존은 그대로 유지 |
| `core/src/session/mod.rs::recompute_token_usage` | 전체 로컬 추정치를 저장하면서 flag 갱신 없음 | token_info를 저장하는 같은 state lock 안에서 reasoning included=true로 설정 |
| `core/src/tasks/regular.rs` | turn 준비 중 false로 재설정 | 이 일괄 reset을 제거해 로컬 재계산 상태를 다음 요청 전까지 보존. 새 요청의 초기화가 그 요청의 model 의미를 결정 |

`ResponseEvent::ServerReasoningIncluded` 이벤트의 명시적 true/false override는 sampling과 compaction에서 모두 유지한다. `history.rs`의 가산 공식 자체를 삭제하거나 모든 provider를 true로 바꾸면 일반 Responses에서 필요한 reasoning 추정까지 누락될 수 있으므로 권고하지 않는다. 기존 메서드·model metadata·테스트 harness로 구현 가능하며 새 dependency나 DB migration은 필요하지 않다.

영향은 `session/context_window.rs:72`의 active context와 자동 압축 판단에 직접 연결된다. Azrael의 별도 gauge와 가격 색상은 reported/projected **full input** 기준이므로 gauge가 항상 같은 양만큼 줄어든다고 보장할 수 없다. 입력·출력·cache 및 요금 집계의 의미와 구독/API 압축 기본 임계값은 변경하지 않는다.

### 보존 범위·통합 위험

- 공통 Windows x64/Linux x64/macOS ARM64 엔진 변경이며 OS별 분기 추가는 없다. mandatory Windows 회귀를 수행하고 다른 OS에서 실제 실행하지 않은 결과는 미검증으로 남긴다.
- Azrael sampling/compaction에는 managed와 Devin 분기가 있으므로 원본의 단일 `.stream()` 문맥에 patch를 맹목 적용하지 않는다. 각 요청의 metadata로 초기화하고 기존 provider의 false 및 usage semantics를 보존한다. 확인한 Devin catalog mapping은 use_responses_lite=false다. inspected managed/runtime와 Devin protocol에 해당 override 이벤트를 새로 추가하는 작업은 포함하지 않는다.
- `compact.rs`, `session/mod.rs`, `tests/suite/compact.rs`에는 기존 미커밋 변경이 있다. 파일 전체 교체나 branch cherry-pick보다 필요한 hunk만 적응 반영한다. 기존 #53932 buffering, provider별 projected input, 수동/자동 압축 설정·queue·recovery는 보존한다.
- `engine.source-provenance`, `engine.selected-upstream`, `engine.provider-context`의 existing owner/check에 연결한다. 구현 승인 시 `docs/architecture/context-policy.md`와 해당하는 runtime owner의 계산 계약, feature inventory, SOURCE integration receipt를 같은 변경 범위에서 정합한다. 새 UI는 필요하지 않다.

### 구현 순서·검증 수락안

root가 네 production 변경 지점과 기존 tests를 함께 소유한다. 테스트/보존 owner 준비 → 기존 변경을 보존한 hunk 적용 → 고정 입력으로 focused Windows 회귀 → 출처·문서 정합 → task-owned 산출물 정리 순서다. 제품 빌드·패키징·설치·push는 이 검토의 범위가 아니다. 실행 전 implementation/build playbook의 입력 고정·cache/lifecycle owner를 따른다.

검증 선정은 설치된 `testing/SKILL.md`를 적용한다. 새 test 파일이나 별도 mock framework를 만들기보다 기존 compact integration 및 recompute/history lib case를 확장한다. 유지할 회귀의 가치는 조기 압축 오판과 provider 간 accounting 오염을 실제 관측 가능한 토큰/압축 경계에서 지속 검출하는 데 있다. 사용자가 권장 개선을 승인했으므로 아래 범위의 구현과 검증을 진행했다.

1. upstream `auto_compact_accounts_for_encrypted_reasoning` 회귀를 적응한다. Responses Lite=true, header 없음에서 reported 80은 limit 81 미만, 81에서 다음 turn 전에 정확히 한 번 압축하며 요청 trigger sequence `[0,0,0,1,0]`을 검증한다. 기존 explicit header true/이후 없음 case를 전부 없애지 말고 **명시적 non-Lite 회귀**로 보존해 기존 가산 의미를 보호한다.
2. `recompute_token_usage_*` 기존 lib tests를 확장해 retained encrypted reasoning이 있는 history의 재계산 값이 다음 읽기에서 다시 증가하지 않음과 flag=true를 검증한다. turn 시작 후 다음 요청 전 상태 보존도 확인한다.
3. 요청마다 초기화: Lite↔non-Lite 모델/provider 전환, true/false header override, 이전 요청의 flag가 후속 sampling/compaction에 새어 나오지 않음을 확인한다. managed 경로도 global true 가정 없이 보존한다.
4. 기존 `context_manager::history`, `recompute_token_usage`, compaction 실패/성공, manual_compact_records_durable_and_local_token_usage와 per-thread automatic compaction on/off 및 입력 usage 계약을 affected scope로 선택한다. `check-selected-upstream-native.cjs`의 현재 core-integration 필터에는 해당 80/81 회귀가 없고 `check-thread-auto-compaction.cjs`는 `auto_compaction` 필터라 `auto_compact_accounts_*`를 선택하지 않는다. 따라서 이 회귀를 명시적으로 추가해 0 selected/skip을 성공으로 취급하지 않는다.

이전 01-plan.md의 선택 이식 목록에는 #55991이 없으며 기존 Windows 625개 성공 기록도 이 수정의 수락 근거가 아니다. 아래 실행 결과에 실제 종료 코드와 선택·실행된 테스트 수를 기록하고 source 통과와 설치된 제품 수락을 구별한다.

### 실행 상태

- 네 product 지점과 기존 recompute lib 회귀를 수정했다. 기존 non-Lite encrypted-reasoning 회귀 두 case를 명시적으로 유지하고, 80/81 경계 회귀 세 case(Lite 무헤더/Lite true 헤더/일반 Responses true 헤더)를 추가했다. 새 테스트 파일은 만들지 않았다.
- `check-selected-upstream-native.cjs`의 core-lib/core-integration에 명시적 필터를 추가하고 기존 feature의 source owners를 연결했다. feature manifest validation과 실행기 Node syntax actual exit 0. 두 변경 test 파일의 rustfmt check actual exit 0. 전체 product 파일 fmt check는 기존의 다른 변경에서 차이를 보고했으므로 일괄 수정하지 않았다.
- 고정 입력 run `artifacts/tasks/do2/runs/reasoning-r1` (owner `codex-retained-reasoning`, lifecycle `run:do2:reasoning-r1`)을 2026-10-27 04:33:10 UTC에 시작했다. copyTree의 파일별 변경 검사와 전체 inventory로 고정했으며 테스트는 이 payload를 사용한다. 첫 lib-recompute gate는 04:34:15 UTC에 시작했다. 공유 Cargo target은 `engine/codex-rs/target`, Rust 1.95.0이며 관리 owner를 거쳐 순차 실행한다. 결과는 이 run의 reports/results.json 및 logs에 기록한다. 전체 제품 빌드/설치 수락을 뜻하지 않는다.
- 출처 record 시도는 actual exit 1이며 SOURCE 원문은 변경되지 않았다. 기준 receipt에서 달라진 것은 이번 여섯 Rust 파일과 이미 커밋된 `16ac2ff5`의 agent_behavior.md 지침 한 건뿐이다. 원본 baseline `artifacts/inputs/engine-original-import-12a1dbfc`를 별도 조회했다. 실패 원인은 receipt가 이미 선언한 다른 작업의 `shell-command/src/command_safety/is_deletion_command.rs`가 Git untracked 상태여서 mode 검증이 거부한 것이다. 다른 addition의 추적 누락은 없다. 사용자가 해당 파일의 추적 등록과 출처 갱신을 명시적으로 승인했다. 정확한 파일만 git add했고 전후 bytes hash가 같고 index blob은 170d2d59b641cb6a895484bd5169b1862cd0a74f임을 확인했다. 이번 task 커밋에는 포함하지 않는다. 같은 baseline과 일곱 expected-path로 recorder r2를 실행했고 actual exit 0으로 완료했다. 테스트 producer는 별도의 고정 bytes로 완료했고 1차 출처 갱신 실패 기록은 보존한다.

#55991 대조 이후의 구현 후보는 Terra의 metadata fallback, 컨텍스트/장문 가격 정책, 프로젝트 비용표와 해당 회귀다. 전제는 계정 원격 catalog와 metadata 우선순위를 보존하고 공식 API 사양을 구독 능력으로 확대하지 않는 것이다. 공통 Windows 회귀, 272000/272001 가격 경계, API/구독/managed 구분, cache-write TTL unknown, online/offline catalog, reasoning·이미지·tool·resume를 검증한다. UI 변경 시 light/dark rendered checks와 정확 패키지 host 수락을 수행하고 제품 빌드·설치는 별도 승인 범위로 남긴다.

## 근거와 한계

- [공식 변경기록 RSS](https://developers.openai.com/codex/changelog/rss.xml): HTML 페이지가 웹 도구 크기 제한을 초과해 RSS를 메모리에서 읽고 최신 항목과 0.164 요약을 직접 추출했다.
- [공식 모델 안내](https://learn.chatgpt.com/docs/models): Terra 최소 CLI 및 GPT-5.5 인증별 은퇴 조건.
- [Terra API 모델](https://developers.openai.com/api/docs/models/gpt-6.1-terra): capability/context/reasoning/tool/가격 근거.
- [이전 선택 이식 및 검증](01-plan.md): 이미 적용한 영역과 보류 범위의 owning 기록.
- [#55991 원본 코드 patch](https://github.com/openai/codex/pull/55991.patch): 공식 RSS에 연결된 OpenAI 저장소의 원본 코드를 메모리에서 직접 조회했다. 문서 검색과 별개로 구현 차이를 확인한 1차 코드 근거다.

현재 checkout의 관련 함수·목록과 설치 UI metadata를 정적으로 확인하고, 승인 후 고정 입력의 focused native 검증을 완료했다. 제품 빌드·설치·실계정 요청은 하지 않았다. 실행 산출물과 정리 결과는 아래에 기록한다. 이 작업 문서는 요청한 결과물로 유지하며 기존 미커밋 변경은 보존한다.

### 검증 수락 증거 (원문 run 정리 전 독립 요약)

- Windows x64 / Rust 1.95.0 / codex-core, Cargo --locked --offline, 단일 test thread. 고정 입력 identity `0c898a539b1d3b1da32bc30c9e64e3ec6a54ea80f9ac65107b6067023d937d6f`. 2026-10-27 04:33:10–05:02:55 UTC, 약 29분 46초(동시 출처 갱신 시간과 합산하지 않음). 동일 lib/integration 준비를 재사용했고 테스트 재실행은 없었다.
- `lib-recompute`: `cargo test -p codex-core --lib recompute_token_usage --locked --offline -- --test-threads=1`; actual exit 0; passed 2, failed 0, ignored 0.
- `lib-history`: `cargo test -p codex-core --lib context_manager::history::tests:: --locked --offline -- --test-threads=1`; actual exit 0; passed 91, failed 0, ignored 0.
- `integration-boundary`: `cargo test -p codex-core --features integration-tests --test all auto_compact_accounts_for_encrypted_reasoning --locked --offline -- --test-threads=1`; actual exit 0; passed 5, failed 0, ignored 0.
- `integration-local-usage`: `cargo test -p codex-core --features integration-tests --test all manual_compact_records_durable_and_local_token_usage --locked --offline -- --test-threads=1`; actual exit 0; passed 1, failed 0, ignored 0.
- `integration-history-preservation`: `cargo test -p codex-core --features integration-tests --test all compaction_preserves_history_after_restart --locked --offline -- --test-threads=1`; actual exit 0; passed 3, failed 0, ignored 0.
- 총 102 passed / 0 failed / 0 ignored. 타입 검사와 각 nonzero selection gate도 actual exit 0. 최종 controller actual exit 0, producerStopped=true / membership_complete=true; 종료 전 전체 고정 입력 inventory 및 helper identity 재검사 완료.
- Linux/macOS native, 실계정 provider/model 전환, 설치 UI/제품 실행은 검증하지 않았다. 요청별 metadata 초기화 및 true/false 이벤트 override 보존은 코드 대조 근거이며 별도 live 전환 검사를 통과했다는 뜻이 아니다.
- 출처 recorder r2 actual exit 0: 원본 baseline raw receipt `12a1dbfc1725df7d4e87de4e336e0b8dab217aecbe7d26b624d1e264356b00b6`, 갱신 전 `b552b0aa3456ad225480e745bc18d8336faf1948d42754a49ade8e574f4ef1d0`, 갱신 후 `26672ec1590eadac41aa6bd09c4de3346392f50425165be2b473f28f95b363f0`. 원본 baseline/current payload, Git HEAD/index mode, 선언된 일곱 delta를 발행 직전에 재검증했다. 테스트 복사본의 SOURCE 메타데이터는 고정 당시 것이며 수정하지 않았다. 아래 여섯 payload는 고정 입력·현재 checkout·갱신 receipt가 모두 동일하다.

| engine 상대 경로 | SHA256 |
| --- | --- |
| `codex-rs/core/src/compact.rs` | `4ff5dd5b3fb159216208cba424390815e9828d96b02db58055906e79f8214725` |
| `codex-rs/core/src/session/mod.rs` | `845c20406f101827e6baa04f053e37f683a426e85e8ba15f19b35460ab7ba7c3` |
| `codex-rs/core/src/session/tests.rs` | `bf0fdf20039e7aada53961836bea44990205229a18e863e33a44bbd13fcc4e69` |
| `codex-rs/core/src/session/turn.rs` | `6dc477d7d4ef112b64807be9d470f7c708c97578f999cf1917aa811f89f22825` |
| `codex-rs/core/src/tasks/regular.rs` | `5fcd36707d77227efce3c5c752e54b33ff60dbacd263ce47a0d8b0a277c0caf5` |
| `codex-rs/core/tests/suite/compact.rs` | `c0dde8c2fd5501185b7f0ca53ea4021be63e6bcd79b74de63a04163ed9878d38` |

- 커밋 분리 검토: 기존 미커밋 이식과 함께 누적된 SOURCE 변경은 1,791줄이고, 필터 세 곳을 보강한 scripts/check-selected-upstream-native.cjs 자체도 이전 작업의 untracked 파일이다. compact 회귀와 feature manifest에도 이전 작업이 섞여 있다. 전체 파일 커밋은 이전 작업까지 포함하므로 현재 task-only 커밋을 만들지 않는다. 승인한 deletion-command 추적 등록은 index에 보존하고 이번 커밋에 포함하지 않는다.

### 정리 진행 / 미해결 보호

- 설치된 Windows x64 maintenance_owner.exe SHA256 `6ffd3d7e5787439381740a8bb3a32a7f4d4ab0d91beba4ee145c954287a06a96`와 기존 DX-05 version ownership을 확인했다. Cargo 독점 cleanup guard 아래 현재 테스트 프로세스 부재·이번 실행 생성 시각·단일 hardlink를 확인했다.
- 이번 테스트 exe/PDB 네 파일(총 logical 2,403,553,280 bytes)을 새 group do2-native-outputs-r1로 등록했으나 과거 do1-unused-native-outputs-r1과 중복됐다. 과거 여덟 경로 전체를 유지해 현재 내용으로 재등록했고 나머지 app-server/TUI 네 경로는 부재 확인했다. 새 그룹 추가는 root의 정리 선택이었고 중복 보호를 만들었다. 두 그룹 함께 review해도 `overlapping lifecycle member requires its own whole-group decision` / `a lifecycle group member is protected`가 남아 삭제를 실행하지 않았다. 원시 registry 편집·강제 삭제·다른 API 우회는 하지 않았다.
- 두 그룹 전원을 fresh token으로 defer: actual exit 0, 현재 네 파일 remaining=true, 과거 나머지 네 파일 remaining=false. 이것은 사용자 보존 승인을 대신하지 않는다. 독점 cleanup guard는 actual exit 0으로 해제됐다. 사용자가 임시 보존을 승인하지 않고 정리 문제의 계속 조사를 요청했다. 따라서 보존을 승인된 것으로 처리하지 않고 정리 미해결 상태를 유지한다.

| 보존 승인 요청 경로 (checkout 상대) | bytes |
| --- | --- |
| `engine/codex-rs/target/debug/deps/codex_core-ee1b27bb08f71819.exe` | 321040384 |
| `engine/codex-rs/target/debug/deps/codex_core-ee1b27bb08f71819.pdb` | 910495744 |
| `engine/codex-rs/target/debug/deps/all-c71321a47dbe4ed9.exe` | 303104000 |
| `engine/codex-rs/target/debug/deps/all-c71321a47dbe4ed9.pdb` | 868913152 |

### 정리 문제 추가 조사 (사용자 보존 거절 후)

- 고정 입력·원문 로그 run `artifacts/tasks/do2/runs/reasoning-r1`은 native apply actual exit 0 / aborted=false / group deleted / remaining=false / error=null이며 실제 root 부재를 확인했다.
- 후속 producer metadata finalize는 현재 공통 maintenance-lock-owner가 새 maintenance-owner-config를 사용하면서 `artifacts/maintenance/owner-installation.json` 부재 ENOENT로 쓰기 전에 중단됐다. 이들은 이번 작업의 수정 파일이 아니며, 조사 중 동시 변경이 관측돼 이전 버전으로 되돌리거나 설치 영수증을 임의 생성하지 않았다. `artifacts/maintenance/lifecycles/bd55242ee1b3604be36aa30d5751f9b94b4254d7e0c7f0509110eebdc2b6dbdc.json`은 payload 부재를 나타내는 후속 finalize 전까지 보존한다.
- 중복의 추가 원인: review는 다른 group의 겹치는 member에 일괄적으로 whole-group blocker를 추가한다. 두 group을 함께 선택해도 해소되지 않는다. register는 live member의 제거·이동을 거부하며, retire_nested_member는 strict containment와 각 단일 live member를 요구하므로 동일 경로 네 쌍에는 적용되지 않는다. 현재 설치된 inventory/register/review/apply/recover_lock 경로에서 중복을 안전하게 해소할 방법을 확인하지 못했다.
- 권고: 모든 관련 묶음의 전체 멤버·동일 삭제 결정·현재 내용 identity·무참조·무실행을 검증하는 명시적 중복 정리 경로를 정리기에 추가한다. 같은 경로의 실제 파일은 한 번만 삭제하고 두 등록 결과를 사실대로 조정해야 한다. 누락 묶음·상이한 결정·내용 변경·보호·활성 producer는 계속 차단한다. 수정과 회귀검사 및 전용 maintenance_owner 빌드/교체는 기존 #55991 제품 변경 범위를 넘으므로 별도 승인이 필요하다. 공통 잠금 helper의 설치 전제조건도 해당 owner 작업과 정합시켜야 한다.
- 최소 증거를 이 문서에 보존한 뒤 일회성 cleanup 제어 JSON 세 개는 일반 삭제하고 부재 확인했다. 남은 실제 payload는 위 네 exe/PDB이며 사용자 보존 승인이 없으므로 작업 전체 완료로 처리하지 않는다. 기존 index·사용자 및 동시 변경을 보존한다.

## 추가 Codex 패치 11개 현 소스 대조

상태: 정적 대조 완료. 사용자는 직전 답변에 제시된 10개 행(결합 행 두 패치를 풀면 총 11개 PR)의 실제 반영 여부 조사를 요청했다. 제품 코드 수정·빌드·설치·정리기 개선은 이번 조사에서 실행하지 않았다. 이전 정리 과제의 승인 거절·미해결 상태를 유지한다.

기준은 `C:/Users/felre/Desktop/pi-harness-init/engine/`의 실제 working tree이며 조사 시작 HEAD는 `6b9487a444f89338294f0cdba4ec558451e2b06e`다. 설치된/실행 중인 바이너리의 포함 여부를 판정하는 조사는 아니다. Windows x64에서 정적으로 읽었으며 공통 코드의 적용 대상은 Windows x64·Linux x64·macOS ARM64다. 실제 OS 동작·제품 장애 재현·회귀 테스트 통과는 주장하지 않는다.

원본 근거는 [공식 0.164.0 변경 기록](https://developers.openai.com/codex/changelog/#github-release-421457270) 및 각 `https://github.com/openai/codex/pull/<PR>.patch`의 실제 diff다. 변경 기록 HTML은 크기 제한 때문에 열리지 않아 공식 RSS를 메모리로 읽었고, patch 역시 파일로 저장하지 않고 메모리에서 읽었다. 같은 함수명이나 커밋의 존재 여부 대신 변경된 함수의 현재 동작과 필요한 호출 경로를 대조한다. 아래의 미반영은 해당 PR의 핵심 변경이 없다는 뜻이며 그 이전의 모든 기능이 없다는 뜻은 아니다.

### 패치별 대조 결과

| PR | 판정 | 현재 코드 근거·차이 | 적용 의미 |
| --- | --- | --- | --- |
| #55954 | 미반영 | `guardian-context/src/retained_instructions.rs:69`가 `Vec<Budgeted<String>>`를 반환하고 수집 중 `required/optional(Commentary)`를 직접 결정한다. `composition.rs:231`은 `item.retention`을 그대로 사용한다. upstream의 `RetainedInstructionItem`/semantic kind와 composition 단계의 정책 결정으로 분리되지 않았다. | Guardian 검토 컨텍스트 내부 구조 분리. 메인 대화의 #55991 토큰 계산 수정과 별개이며, 기존 user=required/assistant=optional 의미는 이미 있다. |
| #55847 | 미반영 | `analytics/src/reducer.rs:206`의 `turns`는 직접 HashMap으로 축적되며 `MAX_PENDING_TURNS=256`, turn 순서·통합 discard가 없다. `ThreadClosed` 처리(`:2109`)는 tool response/cells/elicitation 일부만 정리한다. `app-server/src/outgoing_message.rs:762`의 analytics 전달 대상에 `ThreadClosed`가 없다. | 미완료 turn 분석 데이터와 연결된 pending 상태 보관을 제한하는 변경. 일부 기존 정상 완료 정리나 MCP elicitation 256 상한은 이 변경을 대신하지 않는다. |
| #55993 | 미반영 | `code-mode/src/remote_session.rs:258`은 delegate를 그대로 전달한다. `connection/driver/delegate_runtime.rs:142`의 spawn은 per-execution W3C trace를 캡처·복구하지 않는다. upstream은 execute 시 snapshot을 잡는 `TracedCellDelegate`로 stdio invoke/notify를 감싼다. | stdio Code Mode 관측성 수정. gRPC callbacks의 기존 W3C parent 복구(`grpc_session/callbacks.rs:126`)와 구분한다. 현재 core의 기본 provider는 `thread_manager.rs:591`의 process-owned provider다. |
| #56022 | 미반영 | `cli/src/main.rs:1051`은 `MultitoolCli::parse()`를 사용한다. `utils/cli/src/config_override.rs:29`는 `global=true`이며 root prepend만 수행한다. upstream의 각 subcommand scope를 재파싱해 누락된 override를 복원하는 경로가 없다. | CLI 여러 수준에서 `-c/--config`를 함께 쓰는 경우. 일반 GUI 설정 API의 값 보존 문제로 확대하지 않는다. |
| #55682 | 미반영(TUI) | `tui/src/chatwidget/slash_dispatch.rs:414`는 기존 분기로 picker를 열고 뒤에 defer한다. `app/event_dispatch.rs:2140`에 `permission_popup_pending` guard가 없고, `permission_discovery.rs:44`는 view를 dismiss만 한다. ModelsLoaded(`:2183`)·named lookup(`named_session_lookup.rs:121`)·권한 profile snapshot의 Embedded 한정(`app/config_persistence.rs:414`)도 수정 전 방식이다. | 터미널 UI 권한 선택 및 세션 상태 묶음이다. Azrael VS Code는 별도 durable queue와 질문/승인 대기 계약을 사용하므로 GUI의 동일 버그 존재 또는 동일 patch 적용 필요성을 뜻하지 않는다. |
| #55958 | 일부 기반만 존재 / 핵심 수정 미반영 | `models-manager/src/manager.rs:614`는 explicit provider의 fetch 오류 종류와 무관하게 catalog·ETag·freshness를 무효화한다. `manager_tests.rs:1109`의 timeout case도 무효화를 기대한다. provider/auth identity scope는 있으나 일시적 네트워크 오류 시 이전 성공 catalog 보존은 없다. `model-provider/src/combined_auth.rs:37`의 gateway login 오류 분류도 upstream과 다르다. | provider/auth 변경·권한 거절 시 무효화와 단순 timeout/일시 오류 시 보존을 구별해야 한다. Azrael의 계정별 authoritative catalog를 유지한 적응이 필요하다. |
| #55957 | 일부 기반만 존재 / 핵심 수정 미반영 | `ext/extension-api/src/contributors/turn_lifecycle.rs:204`에는 step별 catalog refresh hook이 없다. `core/src/session/mcp.rs:364`는 인증 변경 뒤 MCP runtime만 refresh한다. `ext/mcp/src/cloud_plugin.rs:61`, `ext/skills/src/cloud_skill.rs:17`은 turn 시작 discovery와 auth scope를 가지지만 model step 전 catalog를 갱신하지 않는다. | turn 중 인증이 바뀐 뒤 cloud plugin/skill 목록이 같은 turn 안에서 새로 반영되는 변경은 없다. 기존 다음 turn discovery와 구별한다. |
| #55968 | 미반영 | upstream의 auth/resource scope `CatalogRefreshBackoff`와 step refresh 경로가 없고 `ext/skills/src/state.rs:289`의 refresh에는 cooldown이 없다. `ext/mcp/src/cloud_plugin_tests.rs:649`는 turn마다 discovery를 기대한다. | 인증·resource별 실패 재시도 cooldown(30초부터 300초 상한). #55957의 per-step refresh와 함께 검토해야 하며 단순 전역 sleep으로 대체하면 안 된다. |
| #55969 | 미반영 | `core/src/session/turn.rs:2927`/`:3039`는 mailbox 경계에서 종료한다. `client_common.rs:121`의 interrupt는 `oneshot::Sender<()>`이고 `codex-api/src/endpoint/responses_websocket.rs:674`는 `discard_partial_items`를 보낸다. `stream_events_utils.rs:315`는 tool을 즉시 dispatch하며 upstream의 typed Drain와 buffered/cancellable dispatch가 없다. | 표준 Responses WebSocket/Lite의 mailbox preemption에서 완료 item/response ID 보존, partial output 배제, mail 포함 후속 요청을 보장하는 변경이다. managed/Devin helper는 `interrupt: None`이므로 동일 drain을 그대로 붙일 대상이 아니다. |
| #55987 | 미반영 | `codex-api/src/auth.rs:30`에 401 recovery hook이 없다. `exec-server/src/remote.rs:150`/`:233`/`:336`는 headers를 resolve한 뒤 인증 오류를 반환한다. `remote/registration_retry.rs:16`의 재시도는 특정 502/503에 한정된다. `cli/src/exec_server_command.rs:365`는 workload identity에서만 live manager auth를 선택한다. | remote Noise registry 등록·연결·harness-key 검증에서 401 후 새 인증정보로 원 deadline 안에서 한 번 재시도하는 변경이다. 일반 로컬 shell 실행의 인증 갱신과는 다르며 기존 no-replay-on-401 검사를 함께 갱신해야 한다. |
| #56003 | 미반영(관련 사전 보호는 존재) | `network-proxy/src/mitm.rs:430`은 host/request만 hook에 전달하고 `:496`은 원 header 값 검사 없이 교체한다. `mitm_hook.rs:36`/`:245`, `config/src/permissions_toml.rs:350`에는 schemes/ports/placeholder 및 MITM version=2 계약이 없다. duplicate header/query의 아무 matching 값 허용(`mitm_hook.rs:407`), semicolon path 미차단(`authorization_path.rs:10`) 등도 남아 있다. | proxy가 가로채는 MITM 요청의 실제 origin·placeholder·모호한 요청·project policy·secret 취급 보강이다. 기존 exact-host/path 검사와 broker alias 사전 검사는 있으나 이 patch를 대체하지 않는다. 이 proxy를 우회하는 provider transport의 보안 상태로 확대하지 않는다. |

### 종합 판정과 조사 한계

- 11개 PR 중 핵심 변경이 완전히 반영된 것은 없다. #55958/#55957은 identity scope·turn 시작 discovery라는 기반이 있어 일부 기반 존재로 분리했으나, 해당 PR이 고치는 실패 보존·동일 turn 재갱신은 없다. 나머지 9개도 각 patch의 핵심 변경이 미반영이다. #56003의 기존 host/path/broker 검사는 이전 보안 기능이며 신규 origin/placeholder 보호가 구현됐다는 뜻은 아니다.
- 모든 미반영 patch를 즉시 동일 우선순위로 도입해야 한다는 결론은 아니다. 모델 catalog 안정성(#55958), 활성화된 proxy의 자격증명 경계(#56003), 표준 WebSocket mailbox 처리(#55969)는 해당 사용 경로에서 우선 검토할 대상이다. #55957→#55968은 연결된 갱신·실패 제어 묶음이다. #55987은 remote exec 경계, #56022는 CLI 인자 사용, #55682는 TUI 사용 여부를 따져야 한다. #55954는 Guardian 내부 구조 분리이며 main chat token accounting 개선과 혼동하지 않는다.
- root가 5개 PR, 모델/스킬 목록 담당이 3개, transport 담당이 2개, credential 담당이 1개를 원본 patch·현재 함수·필요 caller·관련 테스트 코드로 읽기 전용 대조했고 root가 통합했다. 별도 테스트를 실행하거나 테스트 통과 수치를 재사용해 이번 조사 동작 검증으로 표시하지 않았다. 새 빌드·임시 파일·추가 payload는 만들지 않았다.
- 기존 자동 완료/중단·catalog identity·gRPC trace·broker alias·GUI queue 기능과 신규 PR의 구체적 차이를 구분했다. static 미반영은 현재 설치본에 동일 장애가 재현됐다는 증거나 모든 provider에 같은 영향이 있다는 증거가 아니다. 추가 구현에는 각 기능의 승인 범위와 보존 검증이 필요하다.

### 반영 후보 선별

상태: 승인된 구현 범위. 사용자가 “권장한 4개 묶음을 Azrael에 적절히 반영”하도록 승인했다. 아래 다섯 PR을 현재 구조에 적응하고 필요한 회귀·출처·문서·정리를 수행한다. 제품 빌드·패키징·설치·push와 다른 PR 이식은 포함하지 않는다.

**우선 권고는 5개 PR, 4개 작업 묶음이다.** 현재 구현의 구체적 결함을 보완하고, 위험한 전송/실행 경계 변경을 비교적 좁게 분리할 수 있는 항목을 먼저 선정한다.

| 순서 | 묶음 | 이유·보존 조건 | 구현 시 필요한 최소 검증 |
| --- | --- | --- | --- |
| 1 | #55958 모델 목록 실패 보존 | 일시적 timeout/서비스 오류 때문에 성공한 모델 목록을 잃는 현재 동작을 보완한다. 계정/provider 변경·권한 거절·잘못된 자격증명 시 무효화는 유지한다. | timeout/일시 오류는 목록·ETag·freshness 보존, 명시적 auth/access 거절은 무효화, 계정/provider 전환 시 이전 목록 노출 금지. 기존 timeout 무효화 테스트의 기대 계약도 수정해야 한다. |
| 2 | #55847 분석 데이터 보관 상한 | 장시간 실행 중 완료 이벤트 누락으로 미완료 turn 분석 상태가 계속 남을 수 있는 경로를 제한한다. 실제 대화 이력·사용량 원장·queue 상태를 삭제하는 변경은 포함하지 않는다. | pending turn 256 상한, 오래된 turn과 연결된 pending 분석 상태만 정리, ThreadClosed 전달 및 정리, 정상 완료 분석 이벤트 회귀. |
| 3 | #55993 Code Mode stdio trace | 현재 기본 process-owned Code Mode 경로의 callback trace 귀속을 보완한다. 코드 실행/취소 정책을 바꾸지 않고 W3C snapshot으로 전파해 yield된 exec span의 생명을 불필요하게 늘리지 않는다. | 복수 실행의 callback trace 분리, invoke/notify parent 전달, yield 후 span 종료, 기존 gRPC trace·취소·cell close 동작 보존. |
| 4 | #55957 + #55968 목록 갱신·재시도 제어 | 같은 turn 안의 인증 변경을 plugin/skill 목록에 반영하면서 반복 실패 요청을 제한한다. 두 PR은 하나의 per-step refresh 계약으로 묶는다. | turn 도중 auth scope 변경, plugin/skill 양쪽 갱신, 오래된 in-flight 결과 배제, scope/resource별 30–300초 cooldown과 성공/인증 변경 시 재설정. 기존 Azrael 동적 도구·지시문 투영 경계 보존. |

**추가 선별 대상 2개는 별도 작업으로 분리한다.** 필요성이 낮아서가 아니라 사용 경로와 호환·실행 계약을 먼저 확정해야 하기 때문이다.

- #55969: 표준 Responses WebSocket/Lite의 mailbox 선점 안정성 개선으로 가치가 있다. typed Drain, tool dispatch buffering/cancellation, response-ID/history 및 mail-bearing follow-up까지 연결돼 변경 위험이 크다. managed/Devin의 `interrupt: None` 경로에 전역 적용하지 않는다. 실제 해당 transport 선택 경로를 고정하고, 선점·steering·disconnect·content-filter·partial item·도구 중복 실행 금지를 함께 검증하는 독립 작업을 권고한다.
- #56003: MITM hook/자격증명 주입 기능의 보안 강화로 가치가 있다. 실제 proxy 경로와 사용 중인 MITM 설정·프로젝트 policy를 확인하고 version=2 및 origin/placeholder 규칙의 기존 설정 호환 영향을 정해야 한다. direct provider transport까지 효과가 있다고 표시하지 않는다. trusted origin·port·placeholder·중복 값·경로 모호성·project inheritance·secret 취급의 거부/허용 경계를 모두 보존 검증하는 보안 작업으로 권고한다. 해당 MITM 경로를 사용하는 환경이라면 일반 안정성 개선보다 우선할 수 있다.

**현재 보류 4개:** #55987은 remote exec/Noise registry를 실제 사용하는 경우 재선정한다. #56022는 여러 CLI subcommand 수준의 override를 사용하는 경로가 확인되면 재선정한다. #55682는 TUI 개선이므로 주 사용 경로인 Azrael VS Code UI의 별도 queue 개선으로 옮기지 않는다. #55954는 기존 예산 의미를 유지하는 Guardian 구조 분리로, 관측된 현재 장애나 다른 필수 변경의 의존성이 없으므로 독립 이식 우선순위를 낮춘다.

공통 변경의 의도된 대상은 Windows x64·Linux x64·macOS ARM64이며, 이번 선별은 Windows에서 읽은 소스 대조에 근거한다. 향후 구현 시 Windows 회귀를 포함한 owning check와 각 플랫폼의 검증/미검증 상태를 기록한다. 이 선별 작업에서는 테스트 실행·코드 수정·빌드·설치·임시 산출물 생성이 없었다.

### 네 묶음 구현·통합 진행

- 사용자 승인: 권고한 네 묶음(5개 PR)의 Azrael 적응, 필요한 회귀·출처·문서·정리. 전체 제품 빌드·설치·push 및 다른 PR은 제외한다.
- 소유권: 모델 catalog(6파일), analytics(4파일), stdio trace(4파일), catalog refresh(18파일)를 분리했다. Root는 공통 lockfile·검증 실행기·feature inventory·문서·출처·native 실행·정리·수락을 소유한다. Cargo.lock에는 extension-api의 tokio가 이미 있어 추가 lock 수정은 필요하지 않다. 현재 다른 두 lock 변경은 보존한다.
- Windows source-only: 네 구현의 rustfmt check와 CRLF-aware diff check는 exit 0이다. root가 gateway-login terminal retry 계약을 기존 protocol 오류 회귀에 추가했다. 이 결과는 컴파일·실제 행동 통과를 뜻하지 않는다. 새 회귀는 catalog/credential 경계, pending 상한과 closure, 실제 stdio trace 격리, mid-turn 갱신·cooldown 계약을 계속 보호하므로 보존한다.
- 원래 LF/CRLF를 보존했으며 기존 ext/skills/tools/list.rs·read.rs 변경은 수정하지 않았다. 새 code_mode_tracing은 autotests=false인 core의 명시 test 등록(integration-tests)으로 연결했다.
- 검증 준비: 기존 선택 native runner에 6개 좁은 suite를 추가하고 feature inventory에 소스 소유권·mandatory check를 연결했다. 실제 검증은 Windows x64 예정이며 Linux x64/macOS ARM64는 공통 지원 의도와 구분해 미검증으로 기록한다.
- 자원/실행기 의존: C: 여유 약 3.5GB. 기존 #55991 exe/PDB 4파일의 중복 group 보호와 보존 거절은 미해결이다. 별도 정리기 개선·회귀·전용 실행기 교체의 추가 권한을 요청했고 답변 전 해당 확장은 실행하지 않는다. 동시 OS-lock 작업의 owner-v3는 고정 release 빌드 exit 0이나 nested-retirement 4회귀 실패가 있어 전체 수락/설치로 취급하지 않는다. 잠금·CAS·registry 및 producer writer의 좁은 성공 증거는 확보했지만 테스트 producer를 아직 시작하지 않았다.
- 다음 의존: resource generation 변경 시 같은 인증의 catalog 재사용/늦은 응답 배제 경로를 구현 담당자가 추가 확인한다. 안정 소스 인계와 안전한 출력 소유권·공간이 확보되면 하나의 고정 입력으로 serial guarded Cargo(typecheck→nonzero selection→실행)를 수행한다.

- 통합 보완 완료: 같은 인증에서도 connection/resource generation이 독립 변경됨을 확인했다. skill same-turn 재사용에 resource 일치를 추가했고, plugin은 게시 resource key 및 in-flight 성공·실패 공통 guard를 추가했다. 실제 같은-auth reconnect에서 늦은 결과 배제와 같은-turn 성공 cache 재갱신 회귀를 추가했다. 해당 4파일 rustfmt/diff check exit 0, native 미실행이다.
- Root 정적 검증: 선택 native runner node --check exit 0, feature-preservation.validateManifest exit 0(선택 feature 111 owners/15 checks), protocol error_tests rustfmt check 및 root 변경 diff check exit 0. 기존 Code Mode host pin SHA256 ec91f7a04dcb1a36f0e2ed87885777bf78900c2ea3295e82621c5721fd5d9f41 실제 일치를 재확인했다. 외부 설치본의 고정 복사본이며 source-built host로 표시하지 않는다.
- 출처 선행 조사: 현 SOURCE 이후 delta에는 이번 제품 소스 외 동시 작업의 lease.rs/reservations.rs 및 이미 커밋된 prompt 두 파일이 포함된다. metadata 전용 queue_migrations/.gitattributes는 importer의 별도 distribution 소유다. 이들 동시 변경을 이번 제품 수정이나 통과 결과로 합치지 않는다. 전체 provenance 갱신은 정확한 현 delta와 stable source를 묶어 수행해야 하며 아직 실행하지 않았다. 새 제품/회귀 세 파일만 Git 추적에 등록했으며 기존 승인된 deletion-command index를 보존했다.
- 현재 새 disposable payload/테스트 로그/빌드 출력은 만들지 않았다. native 검증·출처 갱신·작업 커밋 및 기존 네 파일 정리는 미완료이며, 정리기 확장 권한 응답 전 해당 확장을 실행하지 않는다.

### 사용자 archive 지시와 이동 경계

사용자는 정리기 삭제 개선 제안에 대해 삭제 대신 archive 폴더로 이동하도록 지시했다. 기존 네 exe/PDB의 archive 이동 요구를 반영하며, 삭제 개선·전용 실행기 교체 승인을 받은 것으로 해석하지 않는다. 조사 결과 native 그룹 do1-unused-native-outputs-r1/do2-native-outputs-r1의 동일 경로 중복 보호가 남아 있고, producer relocateCustody는 artifacts/logs 아래로만 이동 가능하다. project-maintenance managed_roots에도 archive가 없다. 기존 파일은 그대로 보존했고 이동·설정 변경·빌드·삭제는 실행하지 않았다. implementation의 protected/uncertain material 이동 및 tool boundary 우회 금지에 따라 직접 Move-Item을 사용하지 않는다. 이중 소유 claim을 현재 신원·전체 참조와 함께 묶어 archive로 이전하는 지원 경로의 제한적 보완이 필요하다. 같은 C: archive 이동은 원래 경로를 비워도 가용 공간을 늘리지 않는다. 사용자에게 해당 이동 지원 보완 범위만 확인하며, 네 묶음의 native 검증·출처·커밋은 계속 미완료다.

### 기존 네 native 산출물 삭제 확인 (2026-11-02 KST)

사용자가 archive 이동 지시를 철회하고 미삭제 파일의 삭제 마무리를 요청했다. 현재 네 원본 경로 모두 부재이며 archive 내부에서도 해당 네 파일명이 검색되지 않았다. 별도 ET-01 작업의 28-duplicate-claims-cleanup.json에서 2026-10-30T03:34:33.157Z–03:35:02.083Z 중복 claim 통합 및 일반 삭제 완료를 확인했다: migration review/apply와 delete review/apply 실제 exit 0, status consolidated-and-deleted, 통합 8개 항목 모두 deleted/remaining=false. 현 manifest의 해당 네 항목도 deleted/remaining=false다. 따라서 이 요청에서 새 이동·삭제·실행기 변경은 불필요하여 실행하지 않았다. 근거: ../ET-01-cold-build-cache-audit/28-duplicate-claims-cleanup.json. 앞서 기록한 네 파일의 중복 보호·보존 미승인 문제는 이 증거와 현재 부재 확인으로 해소한다. 이 확인은 네 제품 묶음의 native 검증·출처·커밋 완료를 뜻하지 않는다.

### 네 묶음 native 검증 재개 (2026-11-02 KST)

사용자가 네 묶음의 검증을 요청했다. 현재 mandatory Cargo 계약 selected-tests-v2(실제 cargo test 1회, nonzero passed)를 적용한다. 기존 256 pending/ThreadClosed, catalog identity·인증 거절/일시 실패 보존, stdio trace parent·yield 수명, mid-turn auth/resource refresh·cooldown의 6개 선택 suite를 Windows x64/Rust1.95.0에서 직렬 실행한다. Linux/macOS·제품 빌드·설치·실계정 호출은 이 실행의 수락 범위가 아니다.

초기 run verify-20261102-r1은 다른 작업의 미추적 cli.rs coverage 누락에서 source-readiness exit1로 차단됐으며 Cargo는 시작하지 않았다. 사용자가 해당 파일의 내용 변경 없는 Git 추적 등록 및 정확한 8개 delta의 출처 갱신을 승인했다. source-20261102-r2 recorder는 exit0/새 SOURCE SHA50527b723b4aa0fdf2ed082326f6460d0abb0e8c4286d2745123cf1c16ea92ff다. 종료 기록 catalog 잠금 실패로 controller exit1은 그대로 보존하고, 동기 자식0·controller1의 실제 종료 증거로 지원 closeLifecycle을 사용해 failed 상태를 확정했다. 실패를 성공으로 바꾸지 않았다.

새 deps-20261102-r1은 설치된 Cargo의 registry cache/index와 git을 task-owned temporary/cargo-home에 준비했고 실제 exit0이다. 다른 작업의 pending CargoHome은 쓰지 않았다. native-20261102-r3가 새 source 복사본과 전체 provenance 전후 검증을 소유하며, 준비 deps·기존 hash-bound Code Mode host·호환 shared Cargo target에 execution reference를 둔다. Source/환경/실제 개별 argv·시각·exit·count·원문 로그는 그 run의 reports/logs에 기록한다. 산출물은 결과·진단이 끝나는 즉시 기존 owner review/apply/close/release 절차로 정리한다. 중간 catalog busy는 우회하지 않았고 생성 전 거절된 run을 성공으로 세지 않는다.

검증 입력 고정 보완: r3는 출처 갱신 뒤 다른 작업의 agent_profile 신규2파일 및 관련 소스 변경에서 coverage 검사에 막혀 Cargo 시작 전 exit1로 종료됐다. 새 r4는 SOURCE SHA50527b72…에 선언된 전체 파일과 distribution 파일을 그대로 재구성한다. 현재 바이트가 선언 hash와 다르면 기존 고정 Q source(artifacts/e/artifacts/q/engine)의 일치 바이트를 사용하고 복사 전후 hash 및 전체 importer 검증을 통과해야 한다. 누락 파일을 무시하거나 fingerprint 범위를 줄이지 않는다. 조사 시 달라진22파일 모두 Q에서 정확히 일치했고, 원래 working tree와 Q는 읽기만 한다. 이후 동시 agent-profile 변경 결합 상태는 검증 미포함으로 명시한다.

일회성 종료/출처 준비 r1·r2·r3의 진단이 끝난 뒤 작은 필수 결과만 work의 verification-20261102.json에 보존하고, 원문 run은 installed standalone의 register→review→명시 delete→실제 부재→producer finalize로 정리한다. 이 정리의 작은 요청 JSON은 같은 work 폴더의 .do2-cleanup-20261102-*.json을 task-owned control로 사용하고 호출 종료 뒤 일반 삭제·부재를 확인한다. native r4와 deps 및 기존 host/cache는 실행 중 보호한다.

현재 r4의 전체 고정 입력 검증은 성공(sourceSha256 5419e72f4ea1b4adb1b7c374b36a977e437cf80307a0fb11f5e6633246038a87). 첫 Cargo 호출은 shared cache의 다른 살아 있는 producer 때문에 시작 전 차단됐다. 원래 조정 PID51444의 실제 handle 종료 후 새 core producer PID54336이 같은 target을 사용한다. 16logical CPU/약32GB RAM 중 가용 약5.6GB여서 별도 대형 컴파일을 병행하지 않는다. 다음 실행은 r4 입력을 재사용하고 host explicit target x86_64-pc-windows-msvc로 같은 compilation cache를 사용한다.

준비 run 정리는 r1 등록만 actual0, r2 등록 commit catalog busy→예약보존(actual1)→지원 recover actual0→재등록도 같은 busy(actual1)다. 마지막 정확한 예약/중단 근거를 verification-20261102.json에 보존했다. 실패를 우회하거나 원시 registry를 수정하지 않았으며 다음 잠금 해제 후 지원 복구·등록·검토·삭제를 재개한다. 현 native actual test는 아직0개이고 제품 검증 통과를 주장하지 않는다.

테스트 보존 판단(현재 testing 기준): catalog 오류 처리 통합 시 timeout과 명시401/403을 다시 같은 무효화 분기로 합치는 편집, analytics 새 이벤트 handler에서 공통 bounded turn helper 대신 HashMap entry를 직접 추가하는 누락, stdio delegate 교체 때 W3C snapshot wrapper 연결을 빠뜨리는 누락, plugin/skill cache 단순화 때 auth와 resource generation을 동일시하는 편집이 구체적 재발 경로다. 기존 owning case 확장과 해당 경계의 직접 행동 회귀만 유지하고 별도 새 테스트 계층은 추가하지 않았다. 일반적인 중요성이나 테스트 수 자체를 보존 근거로 삼지 않는다.

실행 r5: native-20261102-r4의 검증된 전체 소스를 읽기 전용 소비하며 r4/deps/host/cache에 execution reference를 둔다. x86_64-pc-windows-msvc를 명시해 기존 host target의 의미·ABI를 유지한다. 실제 selected-tests-v2를 사용하며 첫 catalog-retention 호출부터 시작했다. 시작 출력만으로 native 통과를 세지 않고 results.json의 실제 accepted/count/exit와 최종 source 재검증을 수락한다.

실행 r5의 실제 결과는 models-manager 62개 중 57통과·5실패·0무시, Cargo exit101이다. 새 catalog 실패 보존/권한 거절/identity 회귀는 통과했다. 실패는 long-context 압축 기대값 1개(828400 대 실제258400), model_info의 이전 catalog 지시문 기대값 4개다. 현재 context-policy 문서는 해당 API 가격 경계 기본258400을 명시하며 prompts::render_model_instructions는 catalog와 무관한 공통 Azrael 지시문을 반환한다. 따라서 현재 정책과 기대값의 불일치가 확인되지만 패치 전 독립 실행으로 기존 실패를 재현한 것은 아니다. 실패를 전체 결과에서 제외하거나 기대값을 임의 수정하지 않는다. r5의 전체 입력 사후 검증은 동일 sourceSha256으로 통과했다.

실행 r6은 같은 고정 입력·도구·ABI에서 나머지 6검증군의 12호출을 직렬 실행한다. r5 전체 models-manager 결과는 재사용하며 실패 상태를 유지한다. 행동 테스트 실패는 실제 결과를 보존하고 다음 독립 호출을 진행하되 컴파일·선행조건 실패는 중지한다. 실행 중인 r6 및 source/deps/host/cache의 참조는 보호하며, 종료 후 진단에 필요한 작은 결과를 보존하고 지원 owner로 disposable run 정리를 완료한다. 이후 동시 agent-profile 변경과 결합한 현 working tree는 이 검증의 범위가 아니다.

r6 결과: protocol 오류 분류34통과/exit0, app-server outgoing_message20통과/exit0. model-provider의 파일명 필터 shared_state_tests는 Rust 모듈명과 달라 실제0개(원 Cargo0, selected-tests-v2 거절exit1)였다. maintained runner를 실제 shared_state::tests::로 수정(node --check0)했다. analytics는126통과·1실패/exit101이며 새 bounded/closure 회귀는 통과했다. 실패한 기존 threads::thread_initialized_classifies_validated_linked_worktrees는 root 임시 디렉터리를 저장소 밖(None)으로 기대하나 현재 TEMP가 checkout 안이라 상위 .git를 발견(Some(false))한다. repository_identity→get_git_repo_root가 실제로 조상 .git를 순회함을 확인했다. 결과를 제외하거나 제품 Git 분류를 바꾸지 않는다.

r6의 다음 MCP 시작 및 종료 정리는 catalog 잠금으로 실패했다. 동기 호출4개의 실제 종료와 원 coordinator54216/session27017 exit1·handle 종료를 근거로 지원 closeLifecycle로 failed 상태를 확정했다. r7은 살아 있는 do3 shared producer51768 때문에 실제 Cargo0개/exit1, 사후 전체 출처 동일이다. r8은 해당 process handle 종료 뒤 재개해 model-provider8통과, MCP lib5통과·1실패, plugin_mcp5통과, skill cache4통과다. MCP 실패 cloud_catalog_refreshes_per_turn_and_invalidates_on_auth_change는 same-account-failure 직후 removed turn에서 즉시 재조회를 기대하지만 새30초 cooldown은 이전 성공 catalog를 보존한다. fixture의 reconnect 조건에 실제 turn 목록에 없는 이름 두 개가 들어 있어 회복 분기가 실행되지 않는다. 제품 동작을 바꾸거나 실패를 제외하지 않았으며 해당 fixture 적응이 필요하다. r8의 다음 core 시작은 catalog 잠금으로 거절됐지만 사후 전체 출처 동일, controller1/failed 종료는 정상 기록됐다.

남은 core/trace/integration 재개 전 preflight가 다른 살아 있는 core producer17588을 확인해 생성 전에 거절했다. r9 payload/producer는 아직 생성하지 않았다. 기존 guard를 우회하지 않고 해당 process handle 종료를 기다린다. 이 종료는 다른 작업 테스트의 통과를 뜻하지 않는다.

반복된 잠금 대기 이후 이어서 실행할 작은 task-owned control은 이 work의 `.do2-native-20261102.cjs`다. 이미 정한 다섯 남은 호출·환경·full-source 사후 검증을 그대로 사용하며 새 제품 실행 경로는 만들지 않는다. 각 실행은 별도 artifact run을 먼저 등록한다. 컨트롤 파일은 최종 실행 종료 뒤 일반 삭제·부재를 확인한다.

r9 core same-auth resource 갱신 회귀1통과/exit0, r10 Code Mode lib71통과/exit0다. 각 사후 전체 출처는 동일하다. 다음 호출마다 다른 producer 또는 catalog 등록 writer와 경합해 거절된 결과를 구분했다. shared generation aab0e59f…는 원 coordinator48464의 실제 handle 종료와 immutable Cargo29204 exit0·source 오류 없음·정확한 generation 증거가 있었으나 close 게시만 실패했다. 동일 증거로 지원 closeLifecycle을 실행해 revision90/complete(실제0)로 복구했으며 다른 작업 테스트를 이번 통과로 세지 않았다. r11은 남은 stdio trace·remote models·skill lifecycle3호출만 수행한다. 살아 있는 shared coordinator는 실제 process handle 종료를 기다리고, producer claim 전 catalog acquire 거절만 최대3회 재시도한다. 알 수 없는 상태·lease 없는 unresolved producer·write 후 오류는 그대로 중단하며 잠금/registry를 우회하지 않는다.

### Windows native 검증 결과와 정리

고유 실제 테스트는335통과·7실패·0무시다. models-manager57/5, protocol34/0, analytics126/1, app-server20/0, model-provider8/0, MCP lib5/1, plugin_mcp5/0, skill cache4/0, core reconnect1/0, Code Mode lib71/0, stdio trace1/0, skill lifecycle3/0이다. stdio trace는 r11·r12에서 두 번 실제 Cargo0/1통과했으나 ownership finalization이 실패해 각각 원 wrapper1/accepted=false다. 최초 오류의 구체적인 cause는 보존되지 않았으므로 catalog 경합으로 확정하지 않는다. 각 정확한 generation·원 coordinator/Cargo·immutable 종료 증거로 지원 close를 완료하고 원 래퍼 실패는 보존했다. 단순 행동 재실행으로 관리 오류를 숨기지 않는다.

원격 모델 목록 통합은 core/tests/suite/remote_models.rs의 기존 #![cfg(not(target_os = "windows"))] 때문에 Windows에서0개다. selected-tests-v2가 원Cargo0을 거절했으며 통과나 무시로 세지 않는다. Unix 통합은 미검증이고 기존 플랫폼 gate를 제거하지 않았다. Linux x64/macOS ARM64 및 이후 동시 agent-profile 결합 working tree는 검증 범위가 아니다. 전체 수락은 실패 상태이며, 위7개 기대값/fixture 불일치와 Windows 통합 공백·래퍼 관리 오류를 해결하기 전 제품 검증 완료로 표시하지 않는다. 기대값을 임의 수정하거나 제품 빌드·패키지·설치·push는 실행하지 않았다.

필요한 source/환경/argv/시각/실제exit·count·원 로그SHA·실패 원인은 verification-20261102.json에 독립 보존했다. r7–r13 전체 소스 사후 감사는 모두 동일 sourceSha256이다. 사용 종료한 작은 .do2-native-20261102.cjs와 요청 control은 일반 삭제 및 부재 확인했다. source-r2의 pre-intent 예약들은 원 동기 native/controller의 실제 실패와 정확한 fence/SHA 증거로 recover_reservation 실제0, execution_outcome_changed=false를 보존하며 복구했다. 동시 DO3 정리와 경합한 등록 실패 및 deps의 일시 OS33도 그대로 기록했고, 기존 지원 lock_wait_ms5000을 적용한 후 등록·검토를 다시 통과했다.

정리 완료: stopped·membership_complete·execution references0인 이번 검증14개 run을 standalone3b1f9bf4의 register→registered review→명시 동일 delete→실제부재→finalize로 처리했다. Apply 실제exit0,14그룹 모두deleted,14항목 모두remaining=false, 취소/중단 없음이다. 논리 크기 합계1,876,392,657bytes이며 2026-11-02T00:18:01.399Z–00:50:07.030Z의32분05초 동안 삭제했다. 각 producer finalize도14개 모두finalized/remaining=[]/references=[]/blockers=[]로 실제 부재와 참조 해제를 확인했다. 공유 Cargo target·기존 host·설치물 및 다른 작업 자료는 이 삭제 범위에 포함하지 않았다. 새 archive나 보존 대기는 없다. 검증 자체는335통과·7실패와 위 미검증/관리 오류 때문에 실패 상태를 유지한다. 다음 구현 검토 대상은 MCP cooldown fixture 적응, 기존 정책 기대값·임시 프로젝트 경계 정합성, Windows에서 실행 가능한 원격 모델 통합 회귀와 catalog 경합 종료 영수증 처리다.
