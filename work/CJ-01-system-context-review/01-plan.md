상태: 승인된 공통 행동 본문과 기존 Azrael 기본 프로필 변경을 구현했고, 모든 제공자의 기본값·선택 가능성·실제 도구 호출을 Windows x64에서 검증했다. 프로필 선택·상속·사용자 템플릿 대체 기능을 유지하고 Anthropic 자동 분기와 Azrael 도구 거부 검사를 삭제했다. 제품 빌드·설치는 수행하지 않았다. 임시 검증 자료 정리는 완료했으며, 다른 작업의 엔진 출처 불일치로 SOURCE 갱신과 작업 커밋은 아직 수행하지 않았다.

# 모델 시스템 컨텍스트 직역 검토 계획

## 현재 구현·검증 실행

공통 변경 대상은 Windows x64·Linux x64·macOS ARM64이며 실제 실행 호스트는 Windows x64다. 기존 합성·선택·registry 구현을 재사용하고 새로운 프로필 체계나 의존성을 추가하지 않는다. 승인된 본문 원본/내장 사본, 기본 합성·API 선두 투영·저장된 공통 본문 중복 처리, resolver의 자동 분기와 거부 검사, 관련 fixture와 owning 문서를 같은 작업으로 변경한다.

검증 시작 전에 `artifacts/verification/cj-default-r1/`을 이번 작업 소유 run으로 등록한다. `engine/` 고정 입력, runner, 임시 fixture·pending 출력과 상세 로그가 이 run에 속한다. Cargo는 기존 `engine/codex-rs/target/` 캐시를 한 producer씩 사용하고 제품 빌드와 구분한다. 원본 prompt/config/registry 테스트와 관리 provider 변환 fixture를 우선하며, native 도구 smoke는 실제 patch → 파일 내용 변경 → 명령으로 읽기 → 결과 반환을 확인한다. 프로필 전환·전체 provider 행렬은 추가하지 않는다. 새 smoke는 정상 동작과 기본값 변경을 보호하는 계약 검사로 유지하며, run 전용 스크립트·고정 입력·로그는 필요한 재검증과 검토 후 정리 여부를 결정한다. 기존 다른 작업의 수정과 SOURCE 출처 불일치는 흡수하지 않는다.

소스 검사: `node --test scripts/test-common-agent-instructions.cjs providers/opencodex/tests/harness-mapping.test.mjs` 10/10, actual exit 0 (`logs/source-r3.stdout.log`). 새 transport fixture의 과거 호출 ID 재사용과 Anthropic XML 결과 wrapper 기대값을 수정한 후 통과했다. 본문 최종 표현 조정 이후 사본 검사를 다시 수행한다. `git diff --check`는 byte-exact CRLF 파일을 보존하는 `core.whitespace=blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol` 설정에서 통과했다.

2026-10-22 10:21 UTC native 첫 시도는 다른 작업 `CY-01-resume-profile-r1-instrumentation`이 같은 Cargo target을 점유해 시작 전 거부됐다(actual exit 1, `logs/native.stderr.log`). 해당 producer를 종료하거나 lease를 변경하지 않는다. 캐시 해제 filesystem event를 기다린 뒤 검증을 실행한다. 최초 고정 입력은 `inputs.json`의 SHA-256 `4f0e0b075948cbbd947f2e32394cf43d2785f5d9d390363ef6c720bac1a10399`이며, native 실행 전 본문 최종 표현·Rust 서식 조정을 별도 `engine-r2`/`inputs-r2.json`으로 고정한다. 처음 고정 입력은 덮어쓰지 않는다.

출처 선행조건: 공유 `engine/SOURCE.json` hash는 `eed776104d75625f69b2d79493261eb445678ca7dac6a7253ba2361084fd3a47`이다. 이번 작업 외 `codex-rs/app-server-client/src/bin/azrael-bridge.rs`와 `codex-rs/ext/skills/src/host_roots_tests.rs`가 receipt와 여전히 불일치한다. 이를 임의로 수록하지 않으며, 정확한 이번 delta만 수록해야 하는 official source recorder와 최종 commit의 제약으로 남긴다. 고정 입력의 native 시험은 제품 출처/설치 수용을 대신하지 않는다.

최종 고정 입력은 `engine-r3`/`inputs-r3.json` SHA-256 `ae1e759601aa796619eee46e40936269c0078ebc01e689906c46e55ae0ef24b7`이다. 변경한 Rust·공통 template 6개는 실제 소스와 일치한다. 최종 본문 source 검사는 `logs/source-final-r2.stdout.log`에서 10/10 actual exit 0, 검사 선택 범위는 `logs/compile-scope.stdout.log`에서 7/7 actual exit 0이다. native 실행은 exec session `60969`, 완료 신호 `39bb2769-08f5-4b9a-96fd-8212056abb52`로 관측한다. 10:32 UTC 첫 대기 점검에서 공용 target의 기존 coordinator `48612`와 그 rustup child `36220`이 실제 실행 중임을 확인했으며 강제 종료·lease 회수는 하지 않았다. filesystem event로 캐시가 해제되면 이번 native 검증이 시작된다. 결과를 실제 확인하기 전까지 native 통과·작업 완료로 간주하지 않는다.

10:47 UTC 수동 재개에서 완료 신호는 running이었다. exec session도 실행 중이고 stdout에는 캐시 해제 대기만 기록돼 있었다. 기존 owner token이 동일하며 coordinator `48612` → rustup `36220` → cargo `69508`이 실제 실행 중임을 한 번 점검했다. 이번 native 검사는 아직 시작하지 않았고, 다른 producer의 중복 실행·강제 종료 없이 같은 완료 신호를 기다린다.

10:52 UTC 재개에서는 원래 실행 세션이 사라지고 Cargo lease만 남았다. 기존에 관측한 정확한 node → rustup → cargo 트리의 잔여 자식, 전체 compiler/linker 프로세스, 두 run에 연결된 node producer가 모두 없음을 현재 process enumeration으로 확인했다. 단순 PID 부재만 사용하지 않았으며 `recovery-evidence.json`에 근거를 보존했다. `inspectTargetOwner`/`recoverTargetOwner`의 token·owner hash·evidence hash 검사를 통과해 lease를 복구했고, 원래 결과는 unknown/exitCode null로 유지됐다(`cargo-recovery.json`). 이전 대기 실행 완료 신호는 failed/exitCode null로 종료 처리했다.

새 native 실행은 동일한 `engine-r3` 고정 입력을 사용한다. exec session `85687`, 완료 신호 `62bafe24-5e81-4d45-bfaa-4722e636b58b`, `logs/native-r3.stdout.log`/`logs/native-r3.stderr.log`를 사용하고 Cargo jobs는 2로 제한했다. 이 실행은 제품 빌드가 아닌 승인된 검증용 compilation/test다.

해당 시도의 `codex-prompts` test-profile 타입 검사(`cargo check -p codex-prompts --lib --tests --locked --offline --target x86_64-pc-windows-msvc --profile test`)는 actual exit 0, 415412 ms로 통과했다. 다음 libtest 선택 단계 직전 다른 CY build가 새 token `b2a46263-1045-4102-b4e6-a205753cfa2b`로 target을 재점유해 helper가 명령 시작을 거부했다. 테스트 실행 결과는 없고 이 시도는 exit 1이다. 코드 오류로 분류하지 않는다.

다음 시도는 같은 고정 입력과 Cargo jobs 2를 유지하고, 오직 시작 전 캐시 소유 충돌에서만 filesystem event를 기다려 해당 check를 계속한다. 이미 끝난 명령의 결과는 보존하고 실행 중 producer를 중복 시작하지 않는다. 실제 컴파일/테스트 오류는 재시도하지 않고 그대로 종료한다. task-only 실행기만 조정했으며 공통 Cargo helper나 제품 동작은 바꾸지 않았다. 완료 신호는 `5a878be2-3c25-4546-9176-886c514822ff`, 상세 로그는 `logs/native-r4.stdout.log`/`logs/native-r4.stderr.log`이다.

11:23 UTC 예정 점검: 이 시도도 `codex-prompts` test-profile 타입 검사를 actual exit 0(213032 ms)으로 완료했다. 11:19:31 UTC부터 libtest 선택을 위한 `cargo test` 단계가 이번 producer `63708`의 target lease에서 실행 중이다. 완료한 test 결과는 아직 없으며, 추가 build를 중복 실행하지 않는다.

11:44 UTC 예정 점검: `codex-prompts`의 `model_instructions` 7개가 11:25:39 UTC에 actual exit 0으로 통과했다. `codex-config`의 `harness` 10개가 11:34:44 UTC에 actual exit 0으로 통과했다. 두 검사 모두 nonzero 선택과 사전 타입 검사를 거쳤다. 이제 `codex-core`의 기본 tool registry와 실제 patch/read/command smoke를 위한 타입 검사가 진행 중이다. 통과 결과는 `results.json`과 `logs/native-r4.stdout.log`에 보존하며, 완료된 두 검사를 반복하지 않는다.

첫 core 사전 타입 검사는 actual exit 101로 종료됐다. 원인은 이번에 바꾼 두 테스트 fixture가 `HarnessProfiles::from_templates` 비공개 함수를 호출한 E0624 두 건이다. 공개 async `HarnessProfiles::load`와 기존 test filesystem을 사용하도록 fixture를 수정했다. 제품 코드와 이미 통과한 prompt/config 입력은 바뀌지 않았다. 두 core fixture만 새 `engine-r4`/`inputs-r4.json`에 반영하고 기본 registry·실제 patch/read/command·명시적 Claude discovery 세 검사만 다시 수행한다. 완료 신호는 `6a70f743-5e27-4f7d-b2d9-1790fdbeefa4`, 결과는 `results-core-r5.json`, 로그는 `logs/native-r5.stdout.log`와 `logs/native-r5.stderr.log`다. 이전 실패와 통과 결과는 덮어쓰지 않는다.

12:04 UTC 예정 점검: 새 고정 입력 `engine-r4` SHA-256은 `c9ea0526147c121406e15aaf2060303fe0b65aa57d82db99fc677789d68558f6`이다. 수정된 core test-profile 사전 타입 검사는 actual exit 0, 489318 ms로 통과했다. 실행 세션 `76242`는 진행 중이며 아직 최종 core test 결과가 없다. 완료한 prompt/config 검사는 반복하지 않았다.

12:30 UTC 예정 점검: core 바이너리 준비 후 `azrael_defaults_and_explicit_claude_profile_select_executable_tools` 1개가 actual exit 0으로 통과했다(테스트 실행 5.35초). 기본 Anthropic/native 구성과 명시적 Claude 구성의 registry를 확인했다. 실제 patch/read/command와 Claude discovery 검사는 같은 runner에서 이어서 진행 중이다.

첫 core registry 결과 이후 12:26 UTC부터 다른 CY 작업이 공용 target을 점유했다. 13:22 UTC 점검에서도 coordinator `62300`의 `session_restore_` libtest 준비 lease가 유지되고 있어 이번 runner는 시작 전 충돌만 기록하고 filesystem event를 기다린다. 통과한 검사를 반복하거나 경쟁 producer를 종료하지 않는다. 이 지연은 제품 오류나 도구 호출 실패 결과가 아니다.

13:55 UTC 실제 `anthropic_azrael_tools_patch_read_and_execute` 1개가 actual exit 0으로 통과했다(실행 1.45초). native router의 apply_patch로 fixture를 변경하고 exec_command로 변경 marker를 읽어 파일 bytes와 반환 결과를 확인했다. provider API의 유료 호출이나 설치 앱 수용은 수행하지 않았다. 이후 마지막 명시적 Claude discovery 검사는 다른 작업의 공용 target 재점유로 시작 전 이벤트 대기 중이다.

## 최종 검증 근거와 종료

2026-10-22 14:42:21 UTC 마지막 core 검사가 actual exit 0으로 종료됐고, exec session `76242`와 완료 신호 `6a70f743-5e27-4f7d-b2d9-1790fdbeefa4`의 실제 성공 종료를 확인했다. 원래 E0624 두 건은 공개 async loader로 수정 후 재검증했다. 이전 exit 101·캐시 충돌·미확인 중단 기록을 성공으로 바꾸지 않는다. `engine-r4`와 현재 변경 소스 중 5개는 SHA-256이 일치한다. `router_tests.rs`에는 다른 작업의 unavailable-tool 검사 2개가 선두에 추가돼 전체 hash는 달라졌지만 이번 작업의 fixture·smoke 범위는 그대로임을 snapshot 대조 diff로 확인했다. 공통 본문 원본/내장 사본 동일성, CRLF를 보존한 scoped diff check exit 0도 확인했다. 고정 입력의 통과와 이후 다른 작업을 포함한 전체 checkout 검증을 구분한다.

| 검사 범위 | 실제 결과 | 입력/근거 |
| --- | --- | --- |
| common instructions + provider harness mapping | 10/10, exit 0 | `source-final-r2.stdout.log` |
| compile scope selection | 7/7, exit 0 | `compile-scope.stdout.log` |
| codex-prompts `model_instructions` | 7/7, exit 0 | `engine-r3`; runtime → common 합성, API 투영, 사용자 suffix·템플릿 교체 |
| codex-config `harness` | 10/10, exit 0 | `engine-r3`; 모든 provider 기본값, 명시적 override·상속·오류 |
| core `azrael_defaults_and_explicit_claude_profile_select_executable_tools` | 1/1, exit 0 | `engine-r4`; native 기본값과 명시적 Claude registry |
| core `anthropic_azrael_tools_patch_read_and_execute` | 1/1, exit 0 | `engine-r4`; 실제 patch·파일 bytes·명령 읽기·결과 반환 |
| core `claude_tool_search_loads_and_dispatches_a_deferred_tool` | 1/1, exit 0 | `engine-r4`; 명시적 Claude 검색·지연 도구 호출·반환, 실행 1.67초 |

원본 결과 JSON은 run의 `results.json`(prompt/config 성공과 첫 core 실패를 그대로 포함), `results-core-r5.json`(core 세 성공)이며, 각 native 검사는 사전 타입 검사와 nonzero 테스트 선택을 확인했다. 위 표와 고정 입력 SHA를 이 작업 기록에 독립적으로 보존한 뒤 재현용 snapshot·run 전용 실행기·raw 로그는 정리한다. 새 retained smoke와 합성/설정/transport 검사는 승인한 기본값·실행 계약을 보호하므로 소스에 유지한다. 일회용 검증 스크립트는 제품 테스트로 남기지 않는다.

실제 검증은 Windows x64에 한정한다. Linux x64·macOS ARM64·유료 live provider API·현재 설치 앱은 검증하지 않았고, 본문 지침의 모델 준수 효과까지 입증한 것은 아니다. native 시도는 10:21–14:42 UTC에 걸쳤으며 캐시 경합 대기와 다른 source snapshot 사용에 따른 재컴파일이 포함된다. 겹친 실행 시간을 합산해 총 시간으로 보고하지 않는다.

마지막 source preflight에서도 `engine/SOURCE.json` SHA-256 `eed776104d75625f69b2d79493261eb445678ca7dac6a7253ba2361084fd3a47`와 다른 작업 소유 두 파일의 불일치가 유지됐다. 위에 기록한 실제/receipt hash는 변하지 않았다. 정확한 이번 delta만 기록해야 하는 official recorder의 선행조건이 충족되지 않아 SOURCE를 임의로 고치거나 타 작업을 흡수하지 않는다. 작업 커밋도 이 출처 정합화 이후 남은 단계다.

정리 결과: producer close revision 3에서 실제 종료·구성 완결·참조 없음으로 등록한 `run:CJ-01:default-r1`을 native review했다. blocker가 없었으며 exact item `666559dc00ab463de22fe2e0ea9a8f63af4e7e560a2cbf9aa52fe1ddc92c57c1`에 delete를 적용했다. `attempt-61016-1480-1792681127798`은 `aborted:false`, group/item `deleted`, error null, `remaining:false`를 반환했다. 등록 logical bytes는 777625661이며 physical reclaimed bytes는 도구가 측정하지 않았다. `artifacts/verification/cj-default-r1/` 전체의 snapshot·run 전용 스크립트·raw 로그를 삭제했다. 위 표는 삭제된 로그를 다시 열어야 이해되는 링크가 아니라 독립적인 최종 결과 기록이다. active warm Cargo target이나 다른 작업 자료는 삭제 범위에 포함하지 않았다.

producer lifecycle finalize도 `finalized`, remaining/references/blockers 모두 빈 배열로 완료됐다. 최종 source preflight의 receipt hash와 위 두 타 작업 파일 불일치는 그대로다. mandatory 출처 갱신 및 작업 커밋을 완료했다고 주장하지 않으며, 정합화 후 이번 변경만 기록·커밋하는 작업이 남아 있다.

## 후속 Cargo 점유 비용 조사

사용자 요청은 여러 작업이 캐시를 점유한 동안 무엇에 시간을 썼는지 기존 로그로 조사하는 것이다. 이번 후속 조사는 읽기·통계와 이 기록 갱신에 한정한다. 제품 코드·캐시·작업 스케줄링을 변경하거나 새 Cargo 실행을 시작하지 않았다. Windows x64의 2026-10-20 및 10-22 UTC 기록을 표본으로 사용한다. 실제 KST 날짜는 10-20~10-23이며 모든 작업·플랫폼의 전수 통계가 아니다.

`DA`·`DC`·`DD`·`CX`·`CU`의 지정된 native log 32개를 읽었다. 조회 중 생성된 `DC/native-8`은 완료 결과가 없어 제외했다. 로그의 `[cargo-owner]` token 158개는 모두 고유하며 누적 `[cargo-preflight]`는 phase/start/args로 중복 제거했다. flat preflight 형식 중 duration이 없는 기록과 파싱되지 않은 CX marker 한 건은 단계 시간에 넣지 않았다. `DD` 두 로그는 시작 전 guard 거부였고 실제 Cargo 준비 시간은 없다. 원래 `CY` raw log는 작업 정리로 삭제됐으므로 `work/CY-01-session-loading-review/04-native-verification.json`의 종료·사전 검사·직접 바이너리 실행 근거를 별도 사용했다.

| 작업 | 완료 Cargo 준비 명령 수 | Cargo `Finished` 준비 시간 누적 | libtest 본문 시간 누적 |
| --- | ---: | ---: | ---: |
| DA reload/handoff, 별도 `target-daemon` | 42 | 10157.34초 | 35.32초 |
| DC queue/question wait | 15 | 3895.10초 | 76.58초 |
| CX auth/shutdown | 88 | 4742.84초 | 49.09초 |
| CU OAuth, default·preserve-order 포함 | 6 | 644.19초 | 112.34초 |
| 합계 | 151 | 19439.47초(5시간 23분 59초) | 273.33초(4분 33초) |

이 표는 Cargo가 `Finished`로 보고한 완료 준비 구간과 libtest가 보고한 본문 실행 시간을 합친 명령 누적치다. 작업 간 겹친 시간을 포함하므로 전체 wall time이나 정확한 캐시 lease 점유 총시간으로 해석하지 않는다. 큐 대기 시간은 합산하지 않았다. 실패로 `Finished`가 없는 7개 컴파일 명령은 준비 합계에서 제외됐으며, 별도 측정된 4개 실패 typeCheck만 1875.269초(31분 15초)다. 54개 libtest 결과 그룹의 525회 실행(재실행·동일 테스트 중복 포함), 본문 실패 4건/3그룹을 포함한다. 성공한 고유 테스트 수로 재분류하지 않는다. 준비 시간은 기록된 테스트 본문 합계의 약 71.1배이며, 위 151개 명령의 준비 시간과 preflight 단계 합은 겹치므로 다시 더하지 않는다.

구체적인 반복 비용과 재사용 근거:

- CY는 `cargoPreflight`의 고유 typeCheck 1615799ms, selection 1862793ms, 합 57분 59초였다. 이 selection은 테스트 선택용 바이너리 준비를 포함한다. 이후 고정된 동일 바이너리로 8개 필터를 nonzero 선택·실행한 전체 구간은 13:28:10.042–13:29:22.894 UTC, 72.852초였고 64회/61개 고유 테스트가 통과했다. 직접 바이너리 실행은 원래 Cargo wrapper의 cache-conflict exit 1을 성공으로 바꾼 근거가 아니다.
- DC/native-7의 codex-core 첫 typeCheck+selection은 547663+834470=1382133ms(23분 2초), 같은 입력의 compact 필터는 11331+5624=16955ms, turn 필터는 5362+5965=11327ms였다. 따라서 필터 분할만으로 항상 전체 재컴파일이 발생한다고 단정하지 않는다. 변경된 입력과 준비 결과 재사용 여부가 큰 차이를 만든다.
- DA에는 별도 target에서도 codex-core selection 2047671ms(34분 8초), 이후 source 세대에서 878078ms가 기록됐다. 단순 캐시 분리만으로 준비 비용이 사라지지 않는다. source 세대·package/features가 바뀐 비용과 회피 가능한 반복을 구분해야 한다. CU의 default/preserve-order는 의도된 feature 차이이므로 두 빌드를 곧바로 낭비로 분류하지 않는다.
- DA/native-r2의 E0624는 `core/src/tools/router_tests.rs:330`의 이번 CJ 비공개 `HarnessProfiles::from_templates` 호출이었다. CJ에서 만든 fixture 오류가 다른 작업의 고정 입력에도 포함돼 검증 비용을 전파했다. DA에는 별도 E0507 및 E0616 실패도 있다.
- DC/native-6의 E0599 이후 `native-7/reports/cache-invalidation.json`은 선택 소스에 해당 variant가 있으나 Cargo가 없다고 보고해, 파일 bytes를 바꾸지 않고 mtime을 갱신해 dependency freshness를 다시 계산했다고 기록한다. 이것만으로 Cargo 내부 원인을 확정하지 않으며, 추가 빌드 재시도 전에 입력/산출물 신선도를 진단할 필요가 있다는 근거로 사용한다.

보존된 원본은 `artifacts/verification/da1/logs/native-*.log`, `artifacts/tasks/DC-01-queue-question-wait-diagnosis/runs/native-{5,6,7}/logs/`, `artifacts/tasks/CX-01-azrael-auth-recovery/runs/shutdown-r1/logs/native*.log`, `artifacts/tasks/CU-01-laio-oauth-store-review/native-{1,2}/out/oauth*.log`다. 해당 작업들의 이후 정리는 각 소유자가 결정한다.

개선 우선순위는 입력·공개 API/동시 변경의 준비 상태 확인으로 실패 전파 줄이기, 정확히 같은 source/features/target/toolchain의 준비 바이너리와 타입 검사 근거 재사용, 변경 입력의 재컴파일 사유·범위를 확인한 뒤 필요 범위만 재준비하기다. 기존 nonzero 선택·실행과 필수 검사를 생략하자는 제안은 아니다. 조사한 main/DA target에는 crate별 Cargo timing report가 없고, `Finished`만으로 컴파일·코드 생성·링크·CPU·디스크 비용을 분리할 수 없다. 다음 실행부터 명령 종료 시각, 입력 식별자, crate별 준비 시간과 재컴파일 이유를 작은 구조화 요약으로 보존하면 판단 근거가 개선된다. 아직 이러한 실행기 변경은 수행하지 않았다.

## 목표와 현재 권한

모델에 제공되는 컨텍스트를 원문에 대응하는 한글 직역으로 조금씩 검토한다. 프로필별 차이와 모든 도구의 설명·입력 계약을 포함하고, 전체 원문을 한 번에 제시하지 않는다. 범위 조사와 계획 작성을 마쳤고, 공통 행동 지침을 6부분으로 나누어 제시한다. R01·R02 변경과 R03·R04 유지가 확정됐다. R05는 검색 문구 수정·60초 대기 제한 삭제·여러 줄 본문 전달·테스트 지침 변경에 이어 제품 표시 문구 규칙 변경도 승인받았고, 나머지는 현행 유지로 확정했다. R06은 사용자 지정 세 문구를 수정하고 전체 직역본을 다시 제시한다. 기존 feature owner 연결을 재사용한다. 제품 빌드·설치는 포함하지 않는다.

사용자가 확정한 사항은 프로필별 검토, 도구 컨텍스트 전수 검토, 부분별 직역과 공통 행동의 6부분 분할, 아래 R01·R02·R05·R06 문구와 적용 권한, R03·R04의 현행 유지다. 한 번에 한 단위를 제시하며 현재는 수정된 R06을 다시 제시한다. 아래 후속 순서와 분량은 권장안이다.

## R01 확정 문구와 반영 범위

사용자가 승인한 문구를 문장 순서대로 영문 원본에 반영한다. 실제 모델 능률의 개선은 검증하지 않았다.

1. 사용자가 요청한 범위와 기존에 부여된 권한 안에서 작업하세요. 추가 권한이 필요한 작업을 시작하기 전에 해당 권한을 얻으며, 이미 부여된 권한은 이어서 사용하세요. 또한 승인된 계획의 범위에서 수정해야 합니다. 범위를 넘어서는 수정은 추가 권한을 얻은 뒤 수행하고, 작업 이후 보고해야 합니다.
2. 확인이나 허가를 요청할 때는 필요한 이유와 근거가 된 지침·상황을 명확하게 설명하세요. 예를 들어 `SKILL.md`, `AGENTS.md`, 메모리 또는 승인 자동 검토 차단이 근거가 될 수 있습니다. 자동 승인 검토의 거부로 작업을 완료할 수 없다면, 거부된 작업과 제시된 이유를 중간 보고 채널과 최종 채널 모두에서 사용자에게 간결하게 설명하세요.
3. 불명확한 요청에 관한 기존 R01 문단은 삭제한다. 사용자 대화 구간의 질문·대기 지침은 유지한다.
4. 확인이 필요한지는 적용되는 지침과 현재 세션의 승인 내역을 함께 검토해 판단하세요. 승인된 범위 안의 통상적인 구현 선택은 맥락에 따라 스스로 결정하세요. 계획에 미포함된 자의적인 선택은 중간 보고 채널과 최종 채널 모두에서 설명이 필요합니다.

R01의 검증·정리 완료 문장과 감정·출력 위치 강제 문구를 제거했다. 다른 사람에게 메시지를 전송하는 기존 문단은 보존한다. 완료 기준의 후속 공통 작업 지침 통합 여부는 R05 등 해당 구간을 검토할 때 판단한다.

소유 파일은 `instructions/instructions/agent-behavior.md`, `engine/codex-rs/prompts/templates/agent_behavior.md`, `docs/architecture/instructions.md`, feature inventory의 두 owner 추가와 이 작업 기록이다. `engine/SOURCE.json`은 시작 전부터 다른 작업의 변경을 포함한다. original import는 `artifacts/inputs/engine-original-import-12a1dbfc`이며 raw receipt SHA-256은 `12a1dbfc1725df7d4e87de4e336e0b8dab217aecbe7d26b624d1e264356b00b6`이다. 현재 receipt의 originalReceipt와 이 baseline의 깊은 동일성을 확인했다. official recorder는 이번 embedded prompt 한 경로만 허용해 실행했고, 아래의 다른 경로 불일치로 게시를 거부했다. 시작 시 current receipt SHA-256은 `7215945a03237cdfae38bef75181a8ef710b5a17ab1d218d3d3cde536a9fe02a`이다.

범위는 Azrael의 공통 컨텍스트 구성과 환경별 조건부 문구를 함께 다루는 혼합 범위다. 제품 대상 Windows x64·Linux x64·macOS ARM64를 구분하며, 이번 소스 조사는 Windows 작업 공간에서 수행했다. OS별 셸·경로·권한·데스크톱 도구 문구는 별도 차이로 검토한다. 원격 실행에 관한 지침의 존재와 제품의 원격 환경 지원 여부를 혼동하지 않는다. 설치된 앱·실제 provider 요청·타 OS 실행을 이번 조사로 검증했다고 주장하지 않는다.

## R02 확정 문구와 반영 범위

사용자가 제시한 수정안과 직전 응답의 권장 보정 5개를 승인했다. 기존 성격 서술을 말투·분량, 도구·전달, 능동성, 객관성의 네 행동 기준으로 교체했다. 제목은 내용에 맞춰 `Collaboration and communication`으로 바꿨다. 사용자가 삭제한 기술 세부사항·목록 형식·사과 관련 기존 문단은 다시 넣지 않았다.

확정 보정은 다음과 같다. 도구 호출·코드 주석 금지는 진행 보고의 대체 수단에 한정한다. 능동적인 실행과 후속 조치는 승인 범위에 한정하고, 사용자가 예상할 범위 대신 요청·승인 범위를 기준으로 삼는다. 객관성에는 사용자의 믿음 확인보다 기술적 정확성과 진실성을 우선한다는 문장을 포함한다. 핵심 먼저 설명 문장은 하나로 합치고, 하이픈 복합 표현 및 하지 않을 일·유지 사항 등 부가 설명 제한은 불필요한 경우로 한정한다. ASD-STE100은 80% 준수 대신 명료성 원칙을 참고한 짧고 명확한 문장·일관된 용어로 표현하며, 이전 맥락에 없고 이해에 필요한 어려운 개념은 처음 사용할 때 짧게 설명한다. 결과·근거·검증·PR 설명 문단은 유지한다.

원본·내장 사본과 owning architecture의 공통 의사소통 계약을 갱신했다. `engine.model-harness-profiles`의 기존 source owner·검사를 재사용하며 별도 기능·테스트를 추가하지 않는다. R01 prefix와 `# Working with the user` 이후 R03–R06 suffix의 SHA-256을 수정 전후 대조하여 byte 보존을 확인했다. R02 수정 후 전체 prompt는 156행·18,254 bytes, SHA-256 `c950728d9f979294ca85f02a0504eb7b18ff2548875db903883117f12da474e0`이다. 6개 구간의 행 범위는 그대로다. 이번 R02 수정은 공통 behavior를 사용하는 프로필의 문구에 적용되며 별도 lean/custom behavior는 변경하지 않았다. 실제 설치 앱의 갱신이나 모델 능률 개선은 검증하지 않았다.

R02 검증은 Windows x64에서 `project_tests`의 retained `common-instructions` bundle을 plan/run했다. argv는 `node --test scripts/test-common-agent-instructions.cjs`, actual exit 0, 5/5 통과, producer_completed=true, before/after integrity valid다. run ID는 `run-45928-736-1792310877128185600`, bounded 로그는 `tool-call:exec-8467a38f-4fe4-4ea6-baa4-b2112d97afd5:step-665becae8e0662fe5463e94dba290386b0a9ea7a1ccf4ddea24e2f6b44a07026`이다. 사본 일치·비검토 구간 보존 assertion 및 scoped `git diff --check`도 exit 0이다. 첫 assertion 실행은 검증 후 원문 출력에서 Windows cp949의 em dash 인코딩에 실패했으며, stdout을 UTF-8로 지정해 재실행하여 exit 0과 R03 원문을 확보했다. 새 로그·백업·스냅샷·빌드·설치 파일을 만들지 않았고 기존 retained 검사는 보존한다.

## R05 확정 문구와 반영 범위

사용자가 승인한 검색 문구는 “소스 코드와 프로젝트 파일 검색에는 `rg` 또는 `rg --files`를 우선하세요. 검색 대상이나 실행 환경에 더 적합한 도구가 있으면 사용하세요.”다. 이 두 문장을 영문 유지보수 원본·내장 사본에 반영하고, 60초보다 긴 blocking sleep/wait를 피하라는 R05 한 불릿을 삭제했다. 후속 사용자 확정으로 여러 줄 PR·이슈·댓글 본문은 구조화된 인수 우선·gh 본문 파일 또는 표준 입력 전달로 바꾸고, “실제 줄바꿈과 의도적으로 사용한 리터럴 이스케이프를 보존하세요”를 유지했다. 테스트 두 불릿은 “테스트와 검증은 해당 작업에 적용되는 프로젝트 지침과 스킬을 따르세요”로 교체했다. 제품 표시 문구는 아래 확정안을 반영했다. R03의 진행 보고 간격·질문 대기 규칙과 런타임의 별도 대기 지침은 변경하지 않는다. architecture의 검색·본문 전달·제품 문구·검증 연결 계약을 갱신했다. 전체는 154행·17,842 bytes, SHA-256 `c6de8b972e752a9c7a16741b1aa5b7ab3fdd19c7bfa7920f9ffe68de538c71c5`이며, R01–R04와 R06 bytes는 수정 전과 동일하다.

사용자는 병렬 호출 결과 확인과 echo/printf 출력 구분 규칙을 포함한 나머지 항목은 현행 유지로 확정했다. 이 두 문구에 대한 앞선 완화 제안은 적용하지 않는다. 테스트 상세 절은 `implementation` 스킬 7절과 중복되어 위와 같이 적용 지침 연결로 축약했다. 스킬은 조건부 로드되므로 별도 지침이 항상 제공된다고 단정하지 않는다.

제품 표시 문구에 대한 사용자 설명은 “세련된 디자인” 같은 디자인 요구를 실제 화면 텍스트로 옮겨 제품 품질을 해치는 반복 문제다. 사용자는 “제품 화면에는 제품의 기능과 사용자 행동에 맞는 문구를 작성하세요. 디자인 방향과 품질 요구는 제작 기준으로 적용하고, 그 표현 자체를 화면에 넣는 것은 사용자가 표시 문구로 지정한 경우로 한정하세요.”를 확정했고 기존 제품 관련 한 불릿을 이 문구로 교체했다. 사용자가 반복 관찰했다고 보고했으며 이번 작업에서 재현·빈도 실험을 한 것은 아니다. 문구 반영·source 검사 통과와 실제 모델 행동·화면 검수의 효과를 구분한다.

병렬 문구는 `engine/codex-rs/prompts/src/model_instructions.rs`의 `COMMON_PARALLEL_TOOL_GUIDANCE` exact-match API 투영과 연결되어 있다. 후속 승인으로 해당 문구를 바꾸면 API 대체 문구·관련 검증도 함께 대조해야 한다. 현재는 병렬 문구를 수정하지 않았다. ECMAScript Promise.allSettled 명세와 GitHub CLI `gh pr create`의 `--body-file` 공식 문서를 조사했으며 외부 게시·메시지 전송은 수행하지 않았다.

Windows x64에서 retained `common-instructions` bundle을 최신 확정 변경에 대해 plan/run했다. 실행은 `node --test scripts/test-common-agent-instructions.cjs`, actual exit 0, 5/5 통과, producer_completed=true, integrity valid다. run ID는 `run-45928-1312-1792426349201133800`, bounded 로그는 `tool-call:exec-c26d26d1-e010-4d28-a9a7-63b00f658baf:step-5b7314565fd7a026b66169e24b53c408ac63a89e29db4bec7efa49fbd69c55ad`다. 사본 동일성 및 이전 prompt를 역구성한 SHA-256 대조로 이번 제품 표시 문구 한 불릿 외의 변경이 없음을 확인했고, scoped `git diff --check`도 exit 0이다. 별도 테스트·로그·백업·프로필·빌드·설치 산출물을 만들지 않았다. 최신 source preflight에서도 아래 알려진 thread_processor.rs 불일치가 남아 있음을 확인했다.

출처 preflight에서 공유 SOURCE hash는 `eed776104d75625f69b2d79493261eb445678ca7dac6a7253ba2361084fd3a47`로 바뀌었고 originalReceipt는 기존 immutable baseline과 같았다. R01·R02 prompt hash는 이미 공유 receipt에 기록되어 있었다. 이전에 불일치한 네 경로 중 thread-store 세 경로는 현재 기록과 일치했지만 `codex-rs/app-server/src/request_processors/thread_processor.rs`는 기록된 hash `a350c38adab0a2b745c8c1d7545f2f47853971870a91dc59e24858c8f111dc37`와 실제 `948b40bfd165fbcd37f272cfc9ced262b39b35b9ced956b78f35b51a3ccbced8`가 여전히 달랐다. 이는 전체 inventory의 미기록 경로가 이 하나뿐이라는 검증은 아니다. 알려진 선행 불일치가 남아 있으므로 실패할 recorder 전체 실행을 반복하지 않고, 해당 소유 작업에서 정합화한 뒤 이번 prompt 한 경로를 기록하는 순서를 유지한다. 공유 SOURCE를 수정하거나 다른 작업을 stage/commit하지 않는다.

## R06 확정 변경과 검증

사용자는 키워드·피상적 관련성만으로 스킬을 사용하지 말라는 문장과 가능한 재독 회피 문장을 삭제하고, 스킬을 끝내 찾지 못하면 문제를 짧게 알리고 최선의 대안으로 계속 진행하도록 바꾸는 것을 승인했다. 누락된 파일의 다른 위치 검색은 유지한다. 원본·내장 사본의 해당 세 문장과 owning architecture만 갱신하며 앱·플러그인 및 별도 조건부 카탈로그 문구는 유지한다. 조건부 카탈로그의 강제 사용·누락 처리·패키지 접근과 공통 지침 사이의 차이는 후속 검토 대상이다.

공통 플랫폼 문구 변경이며 Windows x64에서 source 검사를 수행했다. `common-instructions` retained bundle을 plan/run했고 `node --test scripts/test-common-agent-instructions.cjs` actual exit 0, 5/5 통과, producer_completed=true, integrity valid다. run ID는 `run-12672-1396-1792651142725213000`, bounded 로그는 `tool-call:exec-1a6aa1da-9352-476e-be42-e0ba0558db26:step-81b88b9d58516ef91dfada1c52a0d66b00c3e52bf5c2c8ef04649a5e393f36a8`다. 사본 byte 동일성 및 HEAD에서 지정 세 문장만 치환한 결과와의 동일성을 확인했고 scoped `git diff --check`도 exit 0이다. 전체 154행·17,654 bytes, SHA-256 `d650b869760c7a71cdedc803fc6a9d296fafc777c939418273bd3b07af764cb7`다. 실제 대화에서의 스킬 선택 효과나 설치 앱은 검증하지 않았다. 새 테스트·로그·백업·빌드 산출물을 만들지 않았고 기존 retained 검사는 보존한다.

현재 source receipt SHA-256은 `eed776104d75625f69b2d79493261eb445678ca7dac6a7253ba2361084fd3a47`다. 이번 preflight에서 다른 작업이 변경한 `codex-rs/app-server-client/src/bin/azrael-bridge.rs`와 `codex-rs/ext/skills/src/host_roots_tests.rs`의 실제 hash가 receipt와 다름을 확인했다. 전체 inventory의 불일치가 이 둘뿐이라는 의미는 아니다. 이전 thread_processor 불일치 기록은 이전 실행 근거이며 이번 확인 대상으로 재사용하지 않았다. 출처 갱신은 소유 작업의 정합화 이후 수행하고 공유 receipt나 타 작업을 stage/commit하지 않는다. 이번 범위의 작업 커밋은 그 선행조건을 기다린다.

## 전체 제공자·모델 공통화 검토안

사용자는 P03과 R01–R06의 중복·조건 차이를 정리한 공통 행동 본문 방향에 동의하고 원문·사용자안·권장안을 대조해 병합 문구를 선택했다. 현재는 문구 확정 작업이며 행동 파일·합성 코드·도구 설정의 실행 권한으로 확대하지 않는다. 구성 방향은 P01 → 통합 공통 행동으로, P03을 별도로 반복 주입하지 않는다. 아래 선택이 앞선 병합 권장안보다 우선하며, 사용자가 제외한 P03 고유 규칙을 임의로 추가하지 않는다.

- 1번은 “사려 깊고 솔직한 협력자로 작업하세요. 명확하고 간결하며 문장들이 이어지는 산문으로 핵심을 먼저 말하세요. 능동태와 직접적인 진술을 우선하세요.”를 채택한다. 기존 추상적 성격 문구 제거 결정은 이 명시적 선택으로 변경됐다.
- 2번은 “불필요한 서두·맺음말·작업 설명의 반복을 줄이세요.”만 남긴다. 대응하는 제목·요약 표현·전문 용어·어려운 개념 설명 문장은 사용자 삭제 범위에 맞춰 정리한다.
- 3번은 사용자 진행·언어·결과 보고 문단에 코드 식별자·명령어·경로·필수 인용문의 원래 언어 유지 및 영어 도구 설명이 응답 언어를 바꾸지 않는 예외를 보존한다. 변경 보고 문장은 3번에만 둔다.
- 4번은 사용자안을 유지한다. 특히 “사용자가 중간에 작업을 요청하면 필요한 실행과 후속 조치를 수행하세요.”에 권장했던 “이미 승인된 범위 안에서”를 추가하지 않는다. 같은 문단의 기존 권한·계획 범위 규칙과 P01은 유지된다.
- 5번은 “통상적인 기술 선택은 스스로 결정하세요. 사용자의 판단이 필요한 중요한 선택은 일찍 확인하세요. 답을 기다리는 동안 그 답에 의존하지 않는 유용한 작업을 계속하세요.”를 채택한다.
- 6번은 새 메시지 처리에 명시적 작업 취소·대체 예외를 보존하고, 압축 후 가정은 승인 범위와 요구사항을 바꾸지 않는 범위로 한정하는 권장안을 채택한다.
- 7·8·10번은 앞서 제시한 사용자 문구를 기준으로 두며 추가 수정 요청은 없다. 7번 스킬 누락 시 대안 진행, 8번 채널·질문 도구, 10번 검색·병렬 실행을 유지한다.
- 9번은 사용자가 승인한 작업에서 스킬·플러그인 지침에 따라 메시지를 보냈다면 이름·링크를 최종 보고하는 권장안을 채택하고, 권한 경계 설명은 확인·허가 요청의 이유·근거 문장으로 합친다.
- 11번은 아래 사용자 확정 문구를 채택한다. 권장안에 있던 기존 회귀 테스트·필수 검사 보존 문장을 이 문단에 다시 넣지 않는다. 이 문구 확정만으로 기존 테스트 삭제를 실행하지 않는다.
- 12번은 셸 인용·이스케이프에 관한 기존 사용자 문구 유지 권장안을 채택한다.
- 13번은 앞선 요청에서 상세 로그 보관 문장 추가와 규약 연결 확장을 선택했다. 로그는 R05의 검증 문단 뒤에 두는 제안이며, 테스트·검증·커밋·정리·빌드 입력·플랫폼에 관한 프로젝트·스킬 연결은 한 번만 배치한다. 그 밖의 P03 고유 문장은 추가하지 않는다.

11번 확정 문구: “테스트와 검증은 해당 작업에 적용되는 프로젝트 지침과 스킬을 따르세요. 새로 작성한 작업 전용 테스트는 기본적으로 일회용으로 두고, 필요한 검증·재검증과 결과 검토가 끝난 뒤 즉시 삭제하세요. 작업 전용 테스트를 남겨야 한다면 이유를 밝히고 남기는 테스트들을 사용자에게 요약해서 보고하세요. 테스트의 존재·개수·문구·구조만 확인하고 제품 동작이나 필수 계약을 검증하지 않는 메타 테스트를 작성하지 마세요.”

사용자는 기존 Azrael 기본 프로필에 P01과 병합한 공통 행동을 적용하고 이를 모든 provider/model의 기본값으로 사용하기를 원한다. 별도 프로필을 강제로 같은 합성 경로로 통일하지 않고, 사용자가 명시적으로 프로필을 바꾸면 그 선택을 적용한다. 사용자 정의 템플릿의 기존 대체 의미도 유지한다. 현재는 계획이며 실제 구현·설치 및 모든 제공자의 호환 검증을 완료한 상태가 아니다.

기본 Azrael 분기는 기존 `compose_agent_instructions` 결과를 반환하고 테스트도 기존 합성과의 동일성을 검증한다. P01을 이 분기에 포함할 수 없다는 기술적 근거는 없으며 당시 정확한 작성 동기는 확인하지 못했다. 현재 Anthropic의 Azrael 도구 지정은 resolver에서 거부된다. 전체 통일은 config 수정만으로 되지 않으며 resolver·registry·검색·code mode·provider 변환을 함께 검토해야 한다. 실제 Anthropic 도구 호출 호환성은 미검증이다.

P03과 공통 행동의 중복·조건 차이는 위 확정 문구로 정리해 Azrael 기본 행동에 반영한다. 실제 모델 능률에 미칠 영향은 미검증이다. Azrael 기본 프로필에 P01을 추가하므로 API 문구 투영과 saved custom 중복 제거를 함께 맞춰야 한다. 다른 프로필의 고유 동작과 사용자 템플릿의 기존 대체 의미는 유지하는 것으로 확정했다. 현재 Windows x64에서 정적 소스만 조사했으며 코드 실행 수용은 구현 뒤 기본 도구 동작 확인으로 구분한다.

## 공통 행동·프로필·도구 변경 구현 계획

### 목표와 실행 경계

현재 사용자 요청은 실제 변경 계획의 정정이다. 기존 `builtin/azrael-default` 프롬프트를 P01 → 통합 공통 행동으로 수정하고, 명시적 선택이 없으면 모든 provider/model이 Azrael 기본 프롬프트·도구를 사용하도록 한다. P03 단독·Anthropic 호환·사용자 정의 프로필은 선택 가능하게 유지하고, 사용자가 선택했을 때 해당 프로필의 합성을 적용한다. 프로필 전환은 기존 설정 재로딩·요청 스냅샷 경계에 따르며 실행 중 요청을 바꾸지 않는다. Guardian·classifier 등의 특수 목적 요청은 임의로 교체하지 않는다. 제품 대상은 Windows x64·Linux x64·macOS ARM64의 공통 로직이며 실제 검증 환경은 Windows다. 제품 빌드·설치·외부 게시를 이 계획 정정만으로 실행하지 않는다.

### 변경 소유 범위와 순서

1. `instructions/instructions/agent-behavior.md`에 확정된 1–13번을 기존 대응 문장 교체 방식으로 반영하고 `engine/codex-rs/prompts/templates/agent_behavior.md`를 동일하게 갱신한다. P01은 별도 원본·사본 한 쌍으로 유지한다. R에서 발췌하지 않은 지침을 삭제하지 않고, 제외된 P03 고유 규칙을 추가하지 않는다. 4번 사용자안과 11번의 “즉시 삭제” 및 기존 회귀 보존 문장 미삽입 결정을 보존한다.
2. `prompts/src/model_instructions.rs`의 기존 Azrael 기본 분기에 P01과 갱신된 공통 본문을 포함한다. 다른 프롬프트·도구 프로필의 합성과 명시적 사용자 템플릿 대체 기능은 유지한다. API 병렬 문구 투영과 saved custom의 harness-owned 접두부 갱신을 기본 프로필의 새 구조에 맞추되 사용자 본문을 전역 치환하거나 임의 제거하지 않는다.
3. `config/src/harness_profiles.rs`에서 Anthropic 자동 프로필 선택 분기와 Anthropic의 Azrael 도구 선택을 거부하는 검사를 삭제한다. 선택 순서는 Azrael 기본값 → 설정된 전역 기본 프로필 → 제공자별 명시 설정 → 모델별 명시 설정으로 유지한다. 작업 프로필의 명시적 선택도 기존 계약에 따른다. 내장 프로필 ID나 사용자 정의 프로필을 폐지하거나 동일 내용으로 강제하지 않는다.
4. `core/src/tools/spec_plan.rs`, `tools/router.rs`, `session/step_context.rs`, `session/turn.rs`와 managed provider mapping을 함께 대조한다. Azrael의 직접·중첩·deferred 도구가 선언·검색·실행에서 같은 선택을 사용하게 하고 과거 Claude 도구 검색 결과가 현재 도구 실행 권한으로 쓰이지 않게 한다. 실제 도구 capability, MCP namespace, 샌드박스·승인·작업/프로세스 소유권은 유지한다. Anthropic wire 변환·도구 이름 복원·결과 전달은 Azrael 도구에서 검증한다.
5. 기본 프로필 변경이 기존 snapshot·지침 비교·API 투영을 깨지 않게 필요한 연결만 수정한다. 기존 모델/provider 전환·재개·압축 전체를 대상으로 새 전수 검증을 추가하지 않는다. 요청 실행 중에는 캡처한 입력을 바꾸지 않는다.
6. owning `docs/architecture/model-harness-profiles.md`, `docs/architecture/instructions.md`와 `engine.model-harness-profiles`의 구현 owner·필수 검사 연결을 갱신한다. feature inventory의 다른 작업 변경은 보존한다. 공식 source recorder에 이번 소유 변경만 반영하고 작업 단위 커밋한다. 타 작업의 출처 불일치를 임의로 흡수하지 않는다.

### 프로필 선택과 템플릿 처리

기존 `behavior_template_file`의 행동 본문 대체 의미, 프로필 상속 및 명시적 override를 유지한다. 공통 본문을 모든 프로필에 강제로 추가하거나 사용자 템플릿을 추가 전용으로 바꾸는 이전 제안은 폐기한다. 모든 제공자에 적용한다는 의미는 기본 선택의 통일이며 사용자의 후속 선택을 차단하는 강제 정책이 아니다. 전환은 기존 설정과 다음 유효 요청 스냅샷에 반영한다.

### 검증과 완료 기준

- 먼저 기존 source 검사와 provider mapping fixture로 공통 문구 사본·정상 입력·도구 call/result 왕복·미선언 호출 거부를 확인한다. 원문 개수·테스트 이름만 보는 메타 테스트를 새로 작성하지 않고 실제 합성 결과·registry 선택·호출 결과를 검증한다.
- 기존 필수 검사 중 변경된 계약에 해당하는 검사를 새 목표에 맞게 갱신한다. 실제 오류를 숨기는 검사 삭제나 빈 필터 통과로 대체하지 않는다. 사용자 지정 추가 검증은 기본 동작 확인으로 한정하고 새 전수 행렬·장시간 광범위 회귀 검사를 추가하지 않는다.
- 기본값 해석과 다른 프로필의 명시적 선택이 가능한지 작은 범위로 확인한다. Anthropic의 Azrael 파일 읽기·패치·명령 실행과 결과 반환을 로컬 전송 fixture 및 가능한 native 경로에서 확인한다. 도구 호출 → 실행 → 결과 반환 성공을 수용 기준으로 하며 모든 오류·모델·provider 조합의 무결함을 보장하지 않는다. live 유료 모델 호출과 설치 앱 수용은 별도 범위다.
- 장시간 native 검사 전에는 작은 source/mapping 검사로 재실행 원인을 줄이고 입력·캐시 소유·필수 provenance 조건을 고정한다. 공유 producer가 실행 중이면 중복 실행하지 않는다. 로그·출력은 실행 전에 작업 소유 위치를 정한다.
- 새 작업 전용 검사는 필요한 재검증·결과 검토가 끝난 뒤 즉시 정리하고, 보존 시 이유·검사 목록을 보고한다. 기존 필수 검사와 제품 계약을 검증하는 검사는 작업 전용이라는 이름만으로 삭제하지 않는다. 실패·활성 producer·복구 참조 등 native 보호가 있는 산출물은 실제 종료·참조 해제·검토 결과를 거쳐 정리한다.
- 결과 보고에는 실제 변경·실행한 범위·exit code·로그 경로·미검증 provider/OS·source metadata/commit 상태를 분리한다. 모델의 실제 승인 해석과 테스트 삭제 정책 준수는 문구 검사만으로 검증됐다고 하지 않는다.

## 범위의 정의와 기준

여기서 검토할 시스템 컨텍스트는 단일 system 문자열보다 넓다. Azrael이 구성하는 기본 지침, developer 지침, AGENTS·환경 등 자동 주입 메시지, 도구 선언, 도구 검색 후 추가되는 정의, 스킬을 읽었을 때 들어오는 지침, 조건부 상태 안내를 포함한다. 원래 메시지 role·내용 종류·producer를 기록하고 전부 system이라고 재분류하지 않는다.

다음 세 층을 연결한다.

1. **원문과 구성 규칙:** 유지보수 원본, 엔진 내장 사본, Rust 상수·템플릿, 확장·도구 정의.
2. **요청에 실제 포함되는 내용:** 프로필·기능 플래그·권한·현재 registry·검색 이력·로드한 스킬에 따른 렌더링과 projection.
3. **전송 표현:** OpenAI Responses/Responses Lite, managed provider, Anthropic 호환 도구, 사용자 API, Devin의 role·이름·스키마 변환과 추가 envelope.

서버·provider가 내부적으로 추가하면서 로컬 원문을 제공하지 않는 내용은 원문 미확보로 표시한다. 저장소에 있는 오래된 모델별 prompt 파일이나 비활성 플러그인 전체를 현재 요청에 포함된 것으로 세지 않는다. 실제 사용자 대화·파일 본문·도구 실행 결과의 임의 데이터는 전부 번역하지 않지만, 그 데이터를 둘러싼 자동 안내·경고·wrapper·입력 형식은 검토한다.

소스 기준은 `docs/ops/development.md`가 선택하는 현재 `engine/`이다. `upstream/codex`와 과거 release snapshot은 현재 기준이 아니다. 조사 시 `core/src/session/world_state.rs`에 기존 미커밋 변경이 있어, 후속 원문 고정 시 작업 공간 bytes와 revision을 함께 기록해야 한다. 다른 작업의 변경은 수정하지 않았다.

## 조사에서 확인한 구성

| 구분 | 확인한 사실 | 원문·구성 소유자 |
| --- | --- | --- |
| 공통 행동 | R01 수정 후 `agent_behavior.md` 156행, UTF-8 18,111 bytes. 권한·대화·서식·도구 작업·스킬·앱·플러그인 지침을 포함 | `engine/codex-rs/prompts/src/model_instructions.rs`, `prompts/templates/agent_behavior.md` |
| 프로필 합성 | 프롬프트 3종·도구 2종. provider의 실제 식별자로 도구 적합성을 판단 | `engine/codex-rs/config/src/harness_profiles.rs`, `prompts/src/model_instructions.rs` |
| 추가 내장 원문 | `prompts/templates/` 아래 Markdown 24개. XML review 종료 템플릿과 Rust 문자열은 이 개수에 별도로 존재 | `engine/codex-rs/prompts/` |
| 초기·상태 변경 주입 | 권한, 협업, 환경, 앱·플러그인, 도구, 역할·협업 정책, 모델 목록, 유지보수, managed 지침 및 확장 contribution | `engine/codex-rs/core/src/session/world_state.rs`, `core/src/context/` |
| 도구 구성 | registry에서 프로필·policy·exposure를 적용하고 직접·Code Mode·deferred 정의를 구성 | `core/src/tools/spec_plan.rs`, `registry.rs`, `router.rs` |
| Code Mode | `exec`·`wait` 안내, helper, MCP 공통 타입, 중첩 도구 설명·TypeScript 선언 | `engine/codex-rs/code-mode-protocol/src/description.rs`, `core/src/tools/code_mode/` |
| 모델별 동적 덮어쓰기 | 일부 도구 설명·스키마, Code Mode 문구, 협업 모드 문구는 모델 catalog override를 받을 수 있음 | `engine/codex-rs/prompts/src/model_messages.rs`, `model_messages/collaboration.rs` |
| 스킬 | 카탈로그 소개·사용법·alias와 선택된 본문은 서로 다른 컨텍스트이며 on-demand 참조를 구분 | `engine/codex-rs/ext/skills/src/{catalog_prompt,host_prompt,render,world_state_catalogs}.rs` |
| 작업 프로필 | persistent 지침, on-demand context, extra skill roots, 역할 파일과 harness binding을 task snapshot으로 합성 | `scripts/task-profile-runtime.cjs`, `scripts/instruction-package.cjs` |
| 요청 투영 | 최신 타입 지침 유지, 동일 스킬 본문 재사용, 모델·provider 전환, API 도구 축약·필터링 등이 요청 사본에 반영 | `core/src/context/instruction_state_projection.rs`, `providers/opencodex/inference-mapping.mjs`, `providers/devin/mapping.mjs` |

유지보수 사본은 `instructions/instructions/agent-behavior.md`와 같은 경로에 있다. 검토 시 원본·내장 사본의 동일성을 확인하고, 같은 내용은 한 번 번역해 여러 출처에 연결한다. 과거 조사 `work/BW-01-openai-profile-context-analysis/01-plan.md`의 코드 경로와 중복 비용 구분을 참고했으며, 그 기록의 수정 전 결론을 현재 동작으로 재사용하지 않는다. 현재 계약은 `docs/architecture/model-harness-profiles.md`와 현재 소스를 기준으로 한다.

사용자 홈의 `C:/Users/felre/.azrael-ex/config.toml`에서는 `[harness]`·legacy named profile·inline instruction override가 발견되지 않았고, 같은 홈의 `*.config.toml`도 없었다. 이는 해당 파일들에 관한 결과이며 프로젝트·managed layer·대화 snapshot의 전체 유효 설정을 증명하지 않는다. 설치 역할 파일 `luna_explorer.toml`, `sol_executor.toml` 두 개를 확인했다. 사용자 설정의 인증정보는 수집하지 않았다.

## 프로필별 검토 행렬

프롬프트 프로필·도구 프로필·조합 프로필·named config profile·작업 프로필·에이전트 역할은 구별해서 기록한다.

| 프롬프트 | Azrael 도구를 쓰는 provider | Anthropic의 Claude 도구 | 검토 포인트 |
| --- | --- | --- | --- |
| `builtin/azrael-default` | 공통 행동. 사용자 행동 템플릿이 없는 기본 분기는 별도 runtime core를 덧붙이지 않음 | runtime core + Claude용으로 이름을 치환한 공통 행동 + Claude 도구 환경 | 기본과 Anthropic용 렌더링의 차이 |
| `builtin/anthropic-default` | runtime core + 공통 행동 | runtime core + Claude용으로 이름을 치환한 공통 행동 + Claude 도구 환경 | 기본 조합 외 선택도 빠뜨리지 않음 |
| `builtin/claude-lean` | runtime core + lean 행동 | runtime core + lean 행동 + Claude 도구 환경 | 짧은 행동의 생략·의무 차이 |
| 사용자 상속·행동 템플릿 | 선언된 행동 템플릿으로 behavior 교체, 별도 runtime 지침 유지 | 같은 교체 규칙과 Claude 도구 환경 유지 | 선언 layer, 상속, custom suffix, 실제 합성 결과 |

위 3×2는 프로필 구성상 검토할 조합이며 도구는 provider 적합성을 지켜야 한다. Anthropic은 `builtin/claude-code-core`, 그 외 provider는 `builtin/azrael-default` 도구를 사용한다. Claude라는 모델명만으로 Claude 도구가 선택되지는 않는다. 도구를 고정한 경우 `azrael-default`와 `anthropic-default`의 Claude 렌더링이 같은 분기를 타므로, 동일 원문은 재번역하지 않고 조합 행을 연결한다.

추가로 provider·model binding 우선순위, config layer와 사용자 템플릿, 작업 프로필의 persistent 지침·참조·역할, root/child와 built-in/configured 역할을 검토한다. 전체 모델명마다 공통 원문을 반복하지 않고 최종 렌더링과 도구 계약이 다른 경우를 구분한다.

## 도구 컨텍스트 전수 검토의 범위

도구 하나의 완료 조건은 이름만 번역하는 것이 아니다. namespace 설명, 전체 도구 설명, 각 parameter의 description·type·required·기본값·enum·제한, 반환·실패·비동기 완료 안내, freeform grammar와 예제, 직접/중첩/검색 노출 경로 및 provider 변환을 함께 확인한다. 식별자와 스키마 값은 원형을 보존한다. 구현에서만 생기는 계약은 원문 직역과 분리한 검토 메모로 기록한다.

아래는 2026-10-18 이번 조사에서 `ALL_TOOLS`로 확인한 **현재 대화의 중첩 카탈로그**다. Azrael 제품 전체에 고정된 숫자도, 한 요청에 모든 전체 스키마가 동시에 들어간다는 뜻도 아니다.

| 그룹 | 항목 수 |
| --- | ---: |
| native nested 도구: 파일·명령·목표·프로젝트 관리·MCP resource 등 | 15 |
| clock | 1 |
| image_gen | 1 |
| azrael_window | 26 |
| node_repl | 3 |
| web | 1 |
| ChatGPT Space | 35 |
| Figma | 48 |
| GitHub | 89 |
| Google Drive | 45 |
| Pets | 11 |
| Plugin Management | 6 |
| Search Service | 1 |
| Topview | 254 |
| Vercel | 235 |
| **합계** | **771** |

앱 도구 소계는 724개다. 카탈로그 `description` 문자열 합은 JavaScript 문자열 길이 기준 1,054,640이며 일부에는 선언·스키마가 함께 들어 있다. 이것은 토큰 수나 실제 요청 크기가 아니다. 여기에 집계되지 않은 직접 노출 `functions.exec`·`functions.wait`·질문 도구, `clock.sleep`, 에이전트 협업·대기·완료 도구 선언도 별도로 목록화해야 한다. 소스에 있으나 현재 꺼진 도구, 다른 프로필 전용 도구, 서버 쪽 hosted 도구와 동적 도구도 포함 여부·노출 조건을 표시한다.

Native 검토 묶음은 다음과 같다.

- 실행·파일·미디어: `exec_command`, `write_stdin`, `apply_patch`, `view_image`, 권한 요청, 셸의 OS별 안내.
- 질문·계획·시간·컨텍스트: 동기/비동기 질문, 계획, 시각·sleep, 남은 컨텍스트·새 window, 환경 대기와 사용자 비동기 안내.
- 협업·대기: spawn·메시지·follow-up·중단·목록·대기·부모 요청 응답·root resume·work completion 및 모델/역할 목록.
- 유지보수: inventory·tests·build·cleanup review/apply의 공통 설명과 action별 차이.
- 확장: goals, skills, memories, history notes, agent message board, web search, image generation 및 MCP·plugin discovery.
- Claude 호환 12종: `Read`, `Edit`, `Write`, `Bash`, `TaskOutput`, `TaskStop`, `Grep`, `Glob`, `Agent`, `Skill`, `ToolSearch`, `AskUserQuestion`.
- 외부 도구: 현재 9개 앱 그룹과 window/node MCP를 서버·기능군·도구별로 전수 확인. 공유 boilerplate를 한 번 검토해도 각 도구의 고유 설명·입력 계약은 모두 확인한다.

원격 도구의 원문은 registry에서 확보하고 기능 실행 없이 검토한다. 검색 결과의 요약 설명만으로 전체 schema 검토를 완료하지 않는다. 현재 제공되지 않은 원문은 미확보로 남긴다. 비활성·미설치 연결은 현재 제공 여부와 구별한 보충 목록에 두며, 번역을 위해 연결·설치·계정 작업을 자동 수행하지 않는다.

## 권장 검토 순서와 분할

| 순서 | 단위 | 내용 | 예상 분할 기준 |
| --- | --- | --- | --- |
| 0 | R00 | 기준 source·profile·catalog와 포함 조건, 요청 role/순서 지도 | 번역 시작 전 원문 identity와 항목별 검토표 확정 |
| 1 | R01–R06 | 공통 행동 | 아래 6개 의미 구간 |
| 2 | P01–P03 및 차이 항목 | runtime core, Anthropic 치환·도구 환경, lean와 사용자 템플릿·6조합 | 서로 다른 고유 본문만 번역하고 모든 조합에 연결 |
| 3 | C 단위 | 권한·sandbox/approval, Default/Plan, persistent, 환경·날짜·OS, AGENTS·managed·task 지침 | 한 정책·한 조건 분기씩 |
| 4 | A 단위 | root/child 역할, 협업 허용 모드, 부모 요청, root coordination, 모델 목록 | 역할·운영 계약별 |
| 5 | T00 단위 | 도구 공통 구조, exec/wait·helper·MCP 타입, 직접/중첩/deferred·ToolSearch | 도구를 읽는 데 필요한 공통 계약부터 |
| 6 | T native·Claude 단위 | 모든 native·확장 도구와 Claude 호환 12종 | 짧은 관련 도구 3–5개, 긴 도구 1개 |
| 7 | T external 단위 | 외부 서버·앱별 전 도구 | 기능군을 나누고 각 도구 고유 설명과 schema 검토 |
| 8 | S 단위 | 스킬 목록·사용법·alias, 앱·플러그인 정책, 로드된 SKILL과 관련 참조, 작업 프로필 resource | catalog와 실제 읽은 본문을 분리 추적 |
| 9 | E 단위 | 모델/provider 전환, projection·제거 안내, compaction·budget·hooks·memory·goal·중단·오류 wrapper | 상태 변화별 전/후에 남는 안내 확인 |
| 10 | G 단위 | Guardian·classifier·review·realtime 등 별도 모델 요청의 지침·도구 | 일반 대화와 요청 수신자를 구분해 검토 |
| 11 | V 단위 | provider별 전송 표현과 최종 누락 검사 | 각 고유 본문·도구·조건을 전수 검토표와 대조 |

공통 행동의 첫 분할은 현재 파일의 행 범위를 따른다. 원문 변경 시 다시 구간을 맞춘다.

| ID | 원문 구간 | 주제 |
| --- | --- | --- |
| R01 | `agent_behavior.md` 1–12행 | 작업 권한과 완료 |
| R02 | 13–46행 | 협업·소통·문체·기술 설명·PR 설명 |
| R03 | 47–70행 | 사용자와 대화·비동기 질문·중간 보고 |
| R04 | 71–99행 | 최종 답변·서식·시각화 |
| R05 | 100–111행 | 작업 도구·검색·병렬 호출·검증 규칙 |
| R06 | 112–154행 | 스킬·앱·플러그인 사용 |

R01·R02·R05는 변경·유지 사항이 확정됐고 승인된 수정을 원본과 내장 사본에 적용했다. R03의 47–70행과 R04의 71–99행은 현행 유지로 확정했다. R06은 승인된 세 문구를 수정한 뒤 112–154행을 다시 직역하며, 재제시만으로 나머지 검토 완료를 추정하지 않는다. 현재 원문 범위와 hash는 위 R06 절을 따르며 원본·내장 사본은 byte 동일하다.

한 번에 한 단위를 제시한다. 원문 약 300–600단어를 기본 상한으로 삼고 조건·규칙이 밀집하면 더 짧게 나눈다. 행 수가 짧아도 긴 문단은 분할하며, 도구 한 개가 길면 설명·parameter·예제 단위로 나누되 조건·예외를 다음 회차에서 누락하지 않게 연결한다. 회차는 확정하지 않는다. 771개를 단순히 5개씩만 나누어도 155묶음이므로 외부 도구까지 10–20회로 끝난다고 약속할 수 없다. 공통 boilerplate의 동일성 대조와 고유 본문 크기별 분할 후 실제 회차를 산정한다.

초기 검토는 공통 행동 → 프로필 차이 → 권한·역할 → 도구 공통 계약 → 전수 도구 순서를 권장한다. 뒤에서 스킬 본문·특수 요청을 마저 다루고 전송 표현의 최종 대조로 닫는다. 이 순서는 이후 검토에서 바꿀 수 있다.

## 매 회차의 제공 형식과 진행 상태

각 단위는 ID, 원문 파일·행 또는 registry 항목, source/hash와 적용 프로필·조건·role을 짧게 표시한다. 이어 원문의 순서·단락·불릿에 맞춘 한글 직역을 제공하고, 원문 대조가 필요한 부분을 병기한다. 요약으로 대체하지 않는다. `must`·`should`·`may`, 금지·예외·부정·수량·시간·기본값과 조건 범위를 유지한다. 코드·tool/parameter 이름·enum·경로·tag·placeholder·grammar는 그대로 둔다.

검토 메모는 직역과 분리한다. 의미 모호함·다른 지침과 충돌·과도한 반복·구현 불일치를 근거와 함께 적고 수정안은 요청된 경우에 별도로 제시한다. 원문의 문제를 번역 중 조용히 고치지 않는다. 이미 한글인 원문은 재번역하지 않고 원문 검토 대상으로 남긴다.

항목별 상태는 `원문 미확보 / 미제시 / 제시함 / 사용자 검토 완료 / 수정 논의 중 / 조건부 비활성`로 구분한다. 제시했다고 사용자 검토 완료로 처리하지 않는다. 반복 본문은 같은 원문 hash의 선행 단위를 참조하되, 실제 포함 횟수·위치·역할과 각 조합·각 도구의 연결은 남긴다. 프로필·도구가 바뀌면 영향을 받은 단위만 다시 확인한다.

## R02 성격 지침 비교 조사

2026-10-18 사용자 요청에 따라 공개 1차 자료와 공식 배포본을 읽기 전용으로 비교했다. 제품 지침 변경이나 모델 호출·성능 실험은 이번 조사에 포함하지 않았다. 아래는 전체 system prompt의 동등한 공개를 뜻하지 않으며 공개 예시·문서·버전이 고정된 배포 문구를 구분한다.

- Codex: [공식 Codex Prompting Guide](https://developers.openai.com/cookbook/examples/gpt-5/codex_prompting_guide)의 Friendly/Pragmatic 구분을 확인했다. Friendly는 공감·협력·팀의 진행을, Pragmatic은 짧고 직접적인 실행 정보와 진행을 강조한다. 로컬 upstream의 `codex-rs/core/templates/personalities/gpt-5.2-codex_{friendly,pragmatic}.md`도 대조했으나 이를 Azrael 현행 원본이나 모든 최신 모델의 실제 payload로 취급하지 않는다.
- Claude Code: [공식 출력 스타일 문서](https://code.claude.com/docs/en/output-styles)에서 Default는 추가 스타일 없이 표준 system prompt를 사용하며, Proactive/Concise/Explanatory/Learning과 custom style을 지원함을 확인했다. active style은 매 요청에 전달된다. 실제 `# Tone and style`과 `# Professional objectivity`는 [공식 npm 2.0.0 배포본](https://registry.npmjs.org/@anthropic-ai/claude-code/-/claude-code-2.0.0.tgz)의 `package/cli.js`를 메모리에서 읽어 확인했다: 간결·직접적 답변, 사용자 믿음의 확인보다 정확성과 진실성, 필요한 반론과 존중하는 정정이다. 조회 당시 latest 2.1.302와 추가 확인한 2.1.118 npm archive에는 cli.js가 없어 이 문구를 현재 버전의 동일 원문으로 단정하지 않는다. 다운로드한 archive는 디스크에 저장하거나 실행·설치하지 않았다.
- Grok Build: [공식 prompt.md](https://github.com/xai-org/grok-build/blob/07e35a3dfeed2f200d319ef6c893b5ea286d9a51/crates/codegen/xai-grok-agent/templates/prompt.md)의 communication 절은 명확한 완전한 문장, 직접·간결한 설명, 사용자 말투·이해도에 맞추기, 답 먼저 제시하기 등 관찰 가능한 작성 행동을 규정한다. 이 공개 base template에는 독립적인 Personality 절이 없다. 별도 provider 내부 지침까지 없다는 결론은 내리지 않는다. 파일 최신 commit은 2026-09-22다.
- Grok 채팅: [공식 Grok 4.1 thinking template](https://github.com/xai-org/grok-prompts/blob/a7c186f5ccac95875c0041aed60398f6ecb6d6c7/grok4p1_thinking_system_turn_prompt_v2.j2)은 도움·진실 추구, flirtatious/playful 금지 및 조건부 custom_personality 삽입을 명시한다. 공개 파일 commit은 2025-11-17이며 현재 서비스 전체의 실전송 원문을 보증하지 않는다. Grok Build와 채팅 제품을 혼합하지 않는다.

사용자는 비교 조사 후 성격 서술을 구체적인 협력·실행·객관성 기준으로 바꾸는 위 R02 수정안을 확정했다. 기존 성격 문단 자체가 능률 하락의 원인이라는 비교 실험 근거는 확보하지 않았다. [Anthropic 공식 프롬프팅 지침](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices)은 원하는 행동을 긍정적으로 지정하는 방식을 권장하지만, 이를 모든 모델에 대한 성능 보장으로 확대하지 않는다.

사용자 검토 기준은 간결·직접·요점 중심, 사용자의 믿음 확인보다 기술적 정확성과 진실성 우선이다. 공감의 강조는 불필요하며 적극적인 협력, 제한 내의 능동적인 문제 해결과 결과 지향을 중시한다. Claude·Grok 관련 내용의 번역 요청 자체는 제품 변경 권한으로 취급하지 않았고, 이후 R02 반영의 명시적 승인을 받았다.

번역 범위는 Grok Build의 `work_policy`·`communication`·`formatting` 전체와 Grok 4.1 채팅의 성격·응답 스타일 문구다. Build 라이선스는 Apache-2.0, 채팅 prompt는 AGPL-3.0이다. Claude 2.0.0의 `package/LICENSE.md`는 Anthropic PBC의 All rights reserved 및 Commercial Terms 적용을 명시한다. 사용자에게서 제공받지 않은 해당 절 전체 번역 대신 Tone and style·Proactiveness·Professional objectivity를 요약하고, 사용자가 원문을 제공하면 전체 변환 가능함을 설명한다. 배포본은 메모리에서만 읽었으며 실행·설치·디스크 저장하지 않았다. PowerShell Python stdout의 cp949가 저작권 기호 출력에서 실패한 첫 조회는 UTF-8 stdout으로 재실행하여 실제 라이선스를 확인했다.

## 이후 원문 확보와 완료 판정

R00에서 이 계획에 연결된 항목별 검토표를 만들고 다음 정보를 고정한다: source revision과 dirty bytes/hash, 설정 layer·실제 provider/model·prompt/tool profile fingerprint, 기능·권한·OS, raw/렌더링/전송 단계, 도구 직접/중첩/deferred 목록 및 발견 후 full schema, 스킬 catalog와 로드한 본문, 외부 catalog 취득 시점. 스냅샷·실행 로그가 필요하면 `artifacts/tasks/<work-id>/runs/<run-id>/`를 쓰고 생성 전에 소유자·출력·소비자를 기록한다. 현재 계획 작성에서는 대형 원문 덤프나 테스트 생성물을 만들지 않았다.

가능한 범위에서 기존 native/helper fixture의 payload와 유지보수 사본 비교를 재사용한다. 현재 소스에 대한 정적 조사, fixture 렌더링, 실제 설치 앱의 요청, 실제 provider 전송은 각각 다른 증거로 남긴다. 전체 유료 모델 호출은 조사·번역의 기본 전제가 아니다. 원격 서버가 제공하지 않는 내부 지침이나 연결이 없는 schema는 검증 완료라고 표시하지 않는다.

이번 계획의 완료 조건은 컨텍스트 생성 소유자 식별, 프로필·도구·조건부/별도 요청 범위 정의, 실제 규모 확인, 읽을 수 있는 첫 분할과 후속 순서 수립이다. 현재 조사로 충족했다. 번역 검토 전체의 완료 조건은 다음과 같다.

1. 모든 고유 원문과 각 도구의 설명·입력 계약이 검토표의 단위에 연결되고 미제시 항목이 없다.
2. 프로필별 조합·역할·권한·OS·동적 전환의 차이가 확인되며, 비활성·미확보 항목을 숨기지 않는다.
3. 실제 제공되는 범위의 원문과 번역을 문장·parameter 단위로 대조해 조건·예외·수치·식별자의 누락이 없다.
4. 도구 발견 전/후와 provider 변환 후에도 검토한 내용의 대응 관계가 남는다.
5. 사용자가 검토 완료한 범위와 수정 논의·원문 미확보 범위를 구분하고, 필요한 수정은 별도 실행 권한과 검증 범위로 다룬다.

R01 변경은 owning architecture의 work intent 절과 기존 `engine.model-harness-profiles` feature owner 목록에 연결했다. 실제 설치본은 엔진 내장 prompt를 사용하므로 이번 source 수정만으로 실행 중인 앱이 갱신되지는 않는다. native 테스트·제품 빌드·설치·실서버 검증은 실행하지 않았다.

범위 조사에서 Markdown 템플릿 24개, 유지보수 원문과 내장 사본 6쌍의 byte 동일성, 참조 소유 파일의 존재를 확인했다. 현재 중첩 카탈로그의 771개 이름은 서로 중복되지 않으며 앱 소계 724개와 그룹 합계를 대조했다.

R01 적용 후 `project_tests`의 `common-instructions` bundle을 plan/run했다. 실행은 `node --test scripts/test-common-agent-instructions.cjs`, Windows x64, 실제 exit 0, 5/5 통과다. run ID는 `run-45928-732-1792305449471693000`이며 앞뒤 declared input integrity는 valid, producer_completed=true다. bounded 로그는 `tool-call:exec-304a44a8-191a-44a0-818b-f4a4ccefca16:step-e89d9f3e2945054ba89720ed111d47edf6d00fa042586a6b1ee90a6d86c8aa0a`에 있다. 이 retained bundle은 변경·삭제하지 않는다. 별도의 task payload·raw 로그 파일이나 테스트용 프로필을 생성하지 않았다.

R01 적용 당시 추가 대조 명령은 exit 0이었다. 156행 전체를 덮는 6개 연속 구간, 두 prompt 사본의 byte 동일성, 당시 수정 전 HEAD와 R02–R06의 완전 동일성, feature owner 연결을 확인했다. R01 적용 시 공통 prompt SHA-256은 `4e1c1e5589de45fd65aaa919d1925f7f25d20ca781ec5f3ad848b599098fdd62`이며 최신 문구·hash는 위 R02 절을 따른다. scoped `git diff --check`는 exit 0이며 source check 통과를 실제 모델 능률·행동 또는 설치 앱 수용 검증으로 확장하지 않는다.

기존 `validateManifest`를 호출한 feature inventory 검증도 exit 0이다. 기존 inventory의 provider handoff·window 관련 다른 hunk 6줄은 그대로 보존하고, 이번 변경 소유권은 공통 prompt owner 2줄로 한정한다.

R02 반영 후 공식 출처 recorder는 native session `99386`, actual exit 1로 종료했다. 최초 원인은 `Reviewed delta differs`이며 이번 expected 경로는 `codex-rs/prompts/templates/agent_behavior.md` 하나다. 실제 delta에는 그 외 `codex-rs/app-server/src/request_processors/thread_processor.rs`, `codex-rs/thread-store/src/local/history_revision.rs`, `codex-rs/thread-store/src/local/mod.rs`, `codex-rs/thread-store/src/store.rs` 네 경로가 더 있었다. R01 때와 동일한 불일치다. 이 파일들의 변경 소유권·검토 권한을 이번 문구 수정으로 확대하지 않으며, recorder가 기록하기 전 종료했으므로 SOURCE를 직접 보정하지 않는다. 원래 shared SOURCE/다른 source 변경과 staging을 보존한다. 이 4개 delta가 해당 작업에서 정합화된 뒤, 최신 current receipt hash로 prompt 한 경로를 다시 기록하고 작업 커밋을 완료한다. 현재는 프로젝트의 작업 단위 커밋 규칙에 따라 source metadata를 임의 분리하지 않고 커밋 대기 사유를 보고한다. 제품 빌드·설치는 이 출처 기록 정합화 이후 별도 권한으로 진행해야 한다.
