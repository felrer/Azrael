# Anthropic 기본 프로필 재구성

상태: 소스 구현·Windows 고정 입력 검증·임시 실행물 삭제 완료. 보호된 관리기록 보존 승인 대기로 작업 종료는 보류한다. 승인 범위는 소스 구현이며 설치·배포·실제 계정 호출은 포함하지 않는다.

## 합의된 요구사항

- 기존 `anthropic-default`, `builtin/anthropic-default`, `builtin/claude-code-core`를 제거하고 `anthropic` / `builtin/anthropic`으로 대체한다. 이전 ID는 명시적으로 거부한다.
- 실제 Anthropic provider에만 기본값을 적용한다. 명시적 global/provider/model override 우선순위를 유지한다.
- Azrael 공통 행동 지침과 `builtin/azrael-default` 도구를 사용한다. Claude Code 도구 에뮬레이션과 이름 치환을 제거한다.
- `InstructionFormat` (`native`, `anthropic-xml`)을 prompt profile의 독립 상속 설정으로 둔다. request snapshot과 fingerprint에 포함한다.
- adapter는 인증·API 직렬화·OAuth 도구 escape·streaming을 담당한다. 기존 top-level system/developer XML 배치는 유지한다.
- 이전 OAuth 식별 문장 제거를 유지한다. 역할별 root/subagent 지침은 공통 경로를 사용한다.

## 플랫폼과 실행 범위

공통 변경은 Windows x64, Linux x64, macOS ARM64 지원 계약에 해당한다. 실제 검증 환경은 Windows x64이며 다른 OS 수용을 주장하지 않는다. 제품 빌드·설치·배포는 제외한다.

## 소유권과 통합

- root: 공통 계약, core registry/session/runtime 통합, 문서, feature inventory, provenance, 수용과 정리.
- profile_config_prompts: config resolver/loader 및 prompt composer/tests.
- provider_projection: helper mapping/projection과 wire tests.
- core_regression_tests: 공통 도구와 discovery Rust 테스트.
- retirement_boundaries: 폐기 경계 및 provenance 조사.
- local_addition_retirement: 검토된 local addition만 제거하도록 source recorder와 실제 소유 테스트 확장.

기존·동시 작업 변경은 보존한다. 엔진 입력이 확정된 후 고정 복사본과 명시적 Cargo cache로 config/tools/context 검증을 순차 실행한다.

## 구현 결과

프로필·도구·세션·managed request·Task Profile 검증 경로를 전환했다. Claude 전용 handler 5개와 환경 template 2개를 삭제했다. config와 공통 composer의 provider 전용 분기를 제거했다. owning architecture와 feature inventory를 갱신했다. 이전 프로필 설정은 자동 alias 없이 오류가 된다.

## 검증 근거

각 owner가 아래 실행의 실제 종료 코드 0을 확인했다. 겹치는 재실행은 합산하지 않는다.

| 범위 | 결과 |
| --- | --- |
| provider mapping + XML Node tests | 10 통과 |
| pinned Bun projection/history/images/inference | 36 통과, 397 assertions |
| managed-inference fixture | 2 통과, 72 assertions |
| Task Profile runtime | 15 통과 |
| common instruction equality | 5 통과 |
| reviewed vendor mapping integrity | 1 통과 |
| source recorder retirement contract | 38 통과, 124.160초 |
| 변경 Rust 구문/rustfmt 검사 | 종료 코드 0; 타입 검사 아님 |
| 범위별 git diff whitespace 검사 | 종료 코드 0 |
| Windows native config/prompts | 25 통과, 종료 코드 0 |
| Windows native core lib / integration | 55 / 24 통과, 종료 코드 0; 11개 selector 비영 실행 확인 |
| model-harness preparation recipe 회귀 | 2 통과, 종료 코드 0 |

11월 2일 현재 source 검사를 다시 실행해 mapping/XML/common instructions/Task Profile 합계 32개가 실제 종료 코드 0으로 통과했다. Rust config native는 11개, model instructions 10개, multi-agent instructions 4개가 통과했고 wrapper 종료 코드 0이다(19:20:10–19:30:33 UTC). tools 첫 filter는 컴파일 오류 없이 2개를 실행해 1개 통과·1개 실패, 실제 종료 코드 101이었다(19:30:33–19:48:16 UTC). 실패는 새 테스트가 이전 `collaboration` namespace 상수를 기대했기 때문이며 출력의 실제 실행 catalog는 `azrael_agents`와 공통 native tools였다. 해당 테스트 하나만 현재 공통 `AZRAEL_AGENT_TOOL_NAMESPACE`를 사용하도록 수정했다. 입력 source와 실행 도구 8개가 첫 실행 종료까지 변경되지 않은 것을 확인했다. context는 앞선 tools 실패로 아직 실행하지 않았다.

기존 upstream 전체 typecheck/test:changed/privacy runner는 필요한 tsconfig/scripts가 없어 실행되지 않았다. focused tests를 전체 검증으로 간주하지 않는다. 실제 OAuth 수용과 설치본 반영은 미검증이다.

## 검증 중단과 재개 조건

`record-engine-local-changes.py` 실제 엔진 기록 시도는 종료 코드 1, `Reviewed delta differs`로 종료했다. 이 작업의 23 수정 경로와 6 폐기 경로 외에 analytics/app-server/protocol/tui 등 다수의 미기록 변경이 현재 receipt와 달랐다. SOURCE.json을 갱신하지 않았고 해당 변경을 이 작업으로 승인하지 않았다. Rust 실행용 고정 입력을 확정할 수 없어 Cargo 테스트와 task commit은 보류한다.

11월 2일 재개 시 이 작업의 수정 23개·폐기 6개는 현재 receipt와 일치했다. 그러나 다른 작업이 새 `project-maintenance/src/cli.rs`와 7개 파일을 변경 중이라 live source 전체 검증은 coverage 오류로 종료 코드 1이었다. `engine/SOURCE.json` SHA-256 `e05346a37f3e6b6297b5988539c339fb2188f4508e75046cc8064ade4f9740a5`에 기록된 바이트만 별도 복사했다. 미기록 파일은 제외하고, 변경 중인 7개는 index 또는 기존 Git blob 중 receipt SHA와 정확히 일치하는 바이트로 재현했다. 원본과 receipt는 변경하지 않았다. 기존 provenance validator의 전체 검증을 통과했으며 입력은 9,344개 파일, source SHA-256 `fd6d670d37970763b140b1a7a7ebda297e56b9451796b329ccea8f1ff283f7fe`다.

`run:EM-02-native-3` / `artifacts/tasks/em02/n3/engine`을 고정 입력으로 사용한다. Rust 1.95.0, Windows x64 MSVC, 기존 호환 shared Cargo cache `96c960bf49711cbf6327e0888542e8d56cb0687e31d690b758d6c9becaa3ca24`를 선택했다. 이전 `engine/codex-rs/target`은 현재 없어 새 중복 캐시를 만들지 않았다. config/prompts, native tools/discovery, context/model switching을 순차 실행하고 종료 후 고정 입력을 다시 비교한다.

준비 시 Windows Git symlink placeholder 한 항목을 일반 symlink로 오인해 첫 복사를 중단했다. 바이트는 그대로 유지한 채 importer의 기존 placeholder 계약을 적용해 준비를 마쳤다. 첫 Cargo 시도는 정리 작업과 lifecycle catalog 잠금 경합으로 실행 전에 종료 코드 1이었다. 정리 실행을 멈추고 Cargo를 단독 재시도했다. 테스트와 정리의 공용 catalog 작업은 이후 직렬화한다.

기존 테스트는 향후 프로필 추가 시 실제 provider 기본값·독립 상속·request format 전달을 누락하거나 공통 도구 이름/namespace 권한 경계를 되돌리는 구체적인 재발 경로를 검사한다. recorder 테스트는 삭제 기능 확장 시 원본·SQL·미확인 symlink를 폐기 가능 대상으로 잘못 허용하는 실수를 방지한다. 이번에는 새 테스트 소스 대신 기존 native selector에 multi-agent prompt와 역할 context 테스트를 연결했다.

실패 결과를 독립 terminal evidence로 보존하고 n3 run을 실패 종료한 다음, 같은 물리 경로에 `r3-namespace-fix` generation을 등록했다. 새 테스트 수정의 provenance를 기존 recorder로 기록하기 위해 n3에 별도 Git 메타데이터를 준비한다. 기본 Git add는 Windows MAX_PATH에서 실패해 물리 파일을 바꾸지 않고 해당 임시 저장소에만 `core.longpaths=true`를 적용해 재시도했다. 현재 공용 Cargo target은 다른 작업의 producer가 점유 중이므로 새 compile을 중복 실행하지 않는다. 기록된 source의 새 식별값이 준비되면 기존 cache의 가용성을 다시 확인하고 수정된 tools 및 context와 config를 검증한다. 실제 config loader의 폐기 ID 거부 테스트도 기존 selector에 연결했다.

수정 입력 준비 완료: 별도 Git의 HEAD는 `f022695fdd108b6cd30815fa9ea7302a0811e983`이며 primary task commit이 아니다. Git commit의 파일 재확인이 오래 걸려 종료를 검토했지만 자식 프로세스 guard에서 멈췄고 실제 프로세스를 종료하지 않았다. Git 기록은 정상 완료됐다. 이후 이 임시 저장소에만 자동 GC/maintenance를 비활성화했고 active GC marker가 없음을 확인했다. 기존 recorder가 정확히 테스트 파일 1개의 변경만 기록했으며 전체 provenance 검증과 inventory 생성은 종료 코드 0이다. 새 source SHA-256은 `ebea22441b017a37ca693a1f6c121738831a41d836dfc0c78c62110a1572e468`이다. native r3는 executor 소유 work `e2d52431-76d9-44a3-96f9-35ca25802cc3`로 시작했고, 현재 다른 Cargo owner의 물리 target 반환을 파일 변경 이벤트로 기다린다. 30분 점유 한도를 두며 실제 launch 시 공용 owner guard를 다시 적용한다. 검증용 maintenance runtime은 검증된 3b1f9bf4로 고정하고 n3의 execution 참조로 보호한다. 엔진 바이트, 실행 도구 바이트와 임시 Git HEAD/config를 실행 전후 비교한다. CRLF를 보존한 Rust 파일은 `cr-at-eol`을 포함하는 whitespace 검사로 종료 코드 0을 확인했다.

native r3는 21:08:12–21:08:13 UTC에 Cargo 실행 전 `beginExecution`의 `Lifecycle catalog source changed during catalog observation` guard로 종료 코드 1이었다. 실제 테스트는 실행되지 않았으며 입력·도구·Git metadata의 사후 비교는 모두 일치했다. 공유 캐시의 물리 lease 반환과 producer close 사이의 준비 조건을 분리해, 한쪽만 준비된 상태를 가용성으로 취급하지 않도록 일회성 실행기의 event wait를 보완했다. 공용 cache/guard 소스는 수정하거나 우회하지 않았다. 같은 수정 source를 사용하는 r4를 executor work `62c76cd6-f036-4ad8-813d-753b45a73d50`로 시작했다. 현재 준비 조건은 물리 lease 부재와 명시적으로 종료된 cache producer이며 실제 helper가 다시 권한·참조·revision·동시성 guard를 검사한다.

r4의 수정 source config 검증은 21:20:27–21:26:38 UTC에 25개 모두 통과했고 wrapper 종료 코드 0이었다. 다음 tools는 Cargo 실행 전에 catalog 잠금 `maintenance_busy`로 종료 코드 1이었다. r5는 같은 입력의 config 결과를 재사용하고 tools/context의 각 실제 recipe를 기존 `runCargoTest`로 실행한다. 실제 Cargo를 호출하기 전 `beginExecution`의 특정 잠금/관찰 충돌만 근거와 함께 제한적으로 재시도한다. 테스트 실패·미확인 producer·권한 실패는 자동 재시도하지 않는다. executor work는 `ff21346a-522d-49fd-8d8d-65a534c8394b`다.

추가한 native selector와 reviewed preparation recipe를 일치시키고 wrapper hash를 갱신했다. 해당 model-harness recipe와 기존 integration binding 테스트 2개는 종료 코드 0이다. 전체 recipe suite는 11개 통과·2개 실패였으며 두 실패는 별도 작업의 `check-selected-upstream-native` wrapper hash 변경에서 비롯됐다. 관련 없는 recipe hash를 승인하거나 수정하지 않았다. 이 변경의 역할·폐기 ID·context selector 보존을 기존 recipe 테스트 파일에서 검사한다.

r5는 가용성 확인과 실행 사이 다른 cache producer가 시작돼 Cargo 전 guard에서 종료 코드 1이었다. r6는 해당 전환도 실제 종료 상태까지 기다린 뒤 22:06:30 UTC에 Cargo를 실행했으나 `codex-analytics`의 `Turn.user_wait_timing` E0560 3건으로 종료 코드 101이었다. 고정 source의 `app-server-protocol/src/protocol/v2/thread_data.rs`에는 실제 필드가 있으며, 재사용된 protocol 산출물은 다른 source 실행 후 생성된 것이었다. source bytes 불일치 없이 timestamp 기반 Cargo 재사용이 다른 checkout 결과를 가져온 문제로 판단한다. 실행 시작 시 고정 사본의 Rust/Cargo.toml 수정 시각만 갱신해 재컴파일하게 하고 바이트 inventory는 동일하게 유지한다. 공용 캐시를 삭제하거나 보호 절차를 우회하지 않는다.

r7은 tools/context 11개 selector를 기존 reviewed recipe에서 가져와 한 Cargo 명령의 lib+integration 실행으로 묶었다. `codex-core/integration-tests`를 활성화하고 runtime filter를 OR로 전달한다. 실제 출력에서 각 selector에 해당하는 `... ok`가 1개 이상인지 별도로 확인하므로 한 범위의 통과가 다른 범위의 0개 실행을 가리지 않는다. source/tooling/Git metadata를 전후 비교하며 executor work는 `e7c1f8e2-4de5-4a4b-ac54-7f0f2e80bb18`이다. r5/r6의 실패 결과를 보존하고 실제 종료까지 확인했다.

r7의 두 시도는 Cargo 전 catalog 경쟁으로 종료했고, source inventory를 다시 읽는 동안 다른 작업이 target을 선점했다. 대기 중인 정확한 parent PID20204의 자식이 없고 자기 Cargo producer가 실행되지 않은 경계에서 parent만 취소했다(실제 종료 코드 1). stdout의 Cargo 미시작과 남은 자식 부재를 다시 확인했으며 다른 작업의 producer는 건드리지 않았다. r8은 같은 byte 고정 입력에서 inventory 검사를 대기 전·실행 후에 두고, target 반환 직후 수정 시각 갱신과 실제 owner 호출을 이어가도록 순서를 줄였다. 시작은 22:27:12 UTC, executor work `a4e04b84-7e7b-4c5d-924d-0c59b3c88971`이다. source·공용 owner의 권한/잠금 절차는 그대로다.

최종 r8 실제 Cargo 검증은 22:42:05–23:04:02 UTC에 종료 코드 0으로 완료됐다. core lib 55개와 integration 24개가 모두 통과했고 ignored/failed는 0이다. 11개 selector 모두 실제 통과 이름이 존재한다: tools/discovery/폐기 ID 12개, model context 13개, 역할 context 5개, provider handoff 9개, instruction projection 16개, model switching 24개. 앞선 config/prompts 25개와 합계 native 104개다. 엔진·실행 도구·임시 Git metadata 사후 비교가 모두 일치했다. 독립 근거는 `artifacts/maintenance/evidence/em02-acceptance.json`에 명령·각 selector 통과 이름·실제 exit·입력 identity와 함께 보존했다. 일회성 raw source/log는 이 근거로 인계한 후 삭제한다.

최종 read-only 비교에서 config loader와 model instruction 파일은 live/frozen byte 동일했다. live `harness_profiles.rs`에는 별도 작업의 `with_model_binding`만 추가됐고 Anthropic 기본값·format·상속·fingerprint는 같다. managed frame의 format 변환·request 매핑도 같다. 해당 새 binding 및 다른 동시 변경은 이번 고정 입력의 수용 범위가 아니다. primary task commit은 공유 SOURCE.json/혼합 source 변경을 안전하게 분리할 수 없어 보류한다. 다른 작업의 변경을 이 작업 commit에 포함하지 않았다.

## 산출물 정리

`run:EM-02-native-1` / `artifacts/tasks/em02/n1`은 검증 계획 JSON 436 bytes만 남았다. `run:EM-02-native-2` / `artifacts/tasks/em02/n2`는 실패한 준비와 정리용 script/log다. 두 run은 실제 실패 종료 근거로 close했고 membership을 확정했다. n1의 잠금 경합이 남긴 registration reservation은 정확한 producer의 동기 종료와 실제 실패를 보존한 `recover_reservation`으로 해제했다. n1 등록/보호 refresh는 통과했으며 n2 등록은 잠금 경합으로 종료 코드 1이라 현재 검증 종료 후 재개한다. 실행·정리 최소 근거는 `artifacts/maintenance/evidence/em02-*`에 보존하고 raw run은 owner의 fresh review/apply 후 실제 부재를 확인한다. n3 고정 입력·로그·temp는 현재 검증 소비자가 사용 중이며 종료 후 같은 절차로 삭제한다.

n2 재등록은 종료 코드 0, logical bytes 5,263으로 완료했다. 두 그룹의 fresh registered review는 blockers 없이 통과했다. apply는 OS error 33 및 catalog lock 경합으로 종료 코드 1, pre-intent reservation을 보존했다. 두 실제 root가 남아 있는 것을 확인했으며 삭제 완료로 처리하지 않았다. 정확한 apply producer PID50824의 동기 종료 근거로 예약 복구를 진행하고, 새로운 심사·적용은 공용 owner 경합이 해소된 후 재개한다.

PID50824의 두 reservation 복구는 실제 종료 코드 0이었다. timing을 켠 다음 fresh review는 종료 코드 0, apply는 전체 종료 코드 1이었다. durable native item은 n2 `cleanup_status:deleted` / `remaining:false`, 실제 n2 root 부재였다. 그 다음 n1의 before-item `reservation.verify_sources`가 catalog 읽기 OS error33으로 실패해 n1은 미시도 상태로 남았다. 전체 실패를 삭제 성공으로 바꾸지 않고 이 부분 결과를 유지했다. PID15872의 두 reservation도 실제 종료 코드 0으로 복구했고, 독립 n2 삭제 근거를 보존한 뒤 producer finalize가 `finalized`, remaining/references/blockers 모두 빈 배열을 반환했다. n2 정리는 완료됐으며 n1의 436 bytes와 현재 사용하는 n3는 검증 종료 후 정리한다.

최종 정리에서 n1은 `deleted`/`remaining:false`와 실제 부재를 확인하고 producer finalize를 완료했다. n3는 native 최종 성공 근거로 close했고 execution 참조가 모두 해제됐다. native 등록의 내용 측정은 209,891,054 bytes이며 fresh review의 blockers는 없었다. 현재 owner의 실제 삭제 결과를 기다린다. 독립 수용 근거는 `em02-acceptance.json`, 정리 근거는 `em02-final-cleanup.json`이다.

관리 영역의 불필요해진 요청·결과 24개(57,864 bytes)는 `run:EM-02-controls`로 정확히 등록했다. 심사 결과 `outside configured managed roots` 및 `source, user state or maintenance state protected`로 보호돼 삭제하지 않았다. 기존 snapshot/복구 근거와 구분되는 raw control 묶음이며 보존 승인을 받아야 작업을 닫을 수 있다. native defer 기록은 승인이 아니다. 지원되는 관리 근거 compaction 경로가 제공되고 active/recovery 참조가 없는 조건에서 다시 심사한다. n1 삭제·controls defer의 전체 apply는 후속 OS33으로 실패했으나 manifest의 실제 부분 결과를 유지했다. 정확한 PID51012의 동기 종료와 in-process filesystem 실행 근거로 두 reservation을 복구했으며 각각 종료 코드 0이었다. 해당 stop 증거와 recovered 영수증은 독립 복구 근거로 유지한다.

최종 n3 apply는 종료 코드 0, 항목·그룹 모두 `deleted`, `remaining:false`, 실제 root 부재다. producer finalize도 `finalized`이며 remaining/references/blockers가 모두 없다. n1/n2/n3 전체와 빈 `artifacts/tasks/em02` 컨테이너도 native owner를 통해 삭제했고 실제 부재를 확인했다. 약 210MB의 일회성 source·Git metadata·temp·raw 로그는 남지 않았다. 현재 쓰는 공용 Cargo cache는 별도 owner/다른 소비자의 소유이므로 삭제 대상이 아니다.

마지막 정리 요청 파일을 포함해 controls 그룹을 완전 재등록했다(종료 코드 0). 보존 승인 대상은 **`run:EM-02-controls`, 25개 파일, 66,287 bytes**다. 정확한 `memberPaths`는 `artifacts/maintenance/evidence/em02-final-cleanup.json`의 `protectedControls`에 있다. 별도 최소 수용·종료·복구·finalize 근거는 producer/native recovery 영수증의 보호된 독립 근거로 유지한다. 요청 묶음은 관리 영역의 보호 때문에 남겼으며, 지원되는 관리기록 compaction 경로가 생기고 active/recovery 소비가 없으면 재심사하는 조건으로 사용자에게 보존 승인을 요청한다. 승인 전에는 작업 완료로 처리하지 않는다.
