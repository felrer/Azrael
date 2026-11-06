# 관리 기능 개인 설정

상태: 구현 진행 중. 사용자 승인: 전체 구현, Azrael 설정의 개인 맞춤 설정에 배치.

## 합의와 범위

- 묶음·관리 잠금·삭제를 개별 설정한다. 기존 사용자를 위해 미설정 기본값은 켬이며 사용자가 처음부터 끌 수 있다.
- 잠금을 끄면 새 관리 작업을 차단하고 실행 중 작업은 종료·반환 경로를 유지한다. 종료 미확인 보호·다른 세션 잠금은 강제로 해제하지 않는다.
- 잠금이 꺼지면 묶음·삭제도 실효적으로 중지한다. 묶음이 꺼지면 묶음 기반 삭제도 중지한다. 요청값을 보존해 다시 켤 때 선택을 복원한다.
- 다시 켜기는 현재 보호를 새로 획득한다. 과거 잠금을 복원하거나 보류 삭제를 자동 실행하지 않는다.
- 공통 의미는 Windows x64, Linux x64, macOS ARM64에 적용. 이번 호스트 검증은 Windows x64이며 다른 OS 및 설치본 검증은 별도로 표시한다.
- 관리 기능을 끄는 설정은 일반 명령 실행 권한을 바꾸지 않는다. 관리된 빌드·테스트/생성자 기능은 지원 중지 상태를 명확히 반환하며 일반 실행은 기존 도구로 가능하다.

## 실행과 소유자

Root: native 설정 저장·CAS·동시 실행 배출, CLI/도구/생성자 경계, 문서·기능 보존 연결·통합 수용.
UI 담당: 개인 맞춤 UI·임베디드 브리지·설정 실행기 어댑터와 관련 좁은 검증. 공유 코드 변경 보존.
선행 조건: native CLI preferences read/write 계약과 유효 설정/상태 의미. UI/host와 native는 이 고정 계약으로 병렬 구현한다.

## 재사용과 검증

기존 maintenance_owner 설치 식별·native OS 잠금·생성자 close/release·임베디드 설정 브리지·native UI 컴포넌트를 확장한다. 새 외부 의존성은 추가하지 않는다.
검증: 설정 CAS/의존성/꺼진 상태의 신규 작업 거부/실행 중 배출과 반환/재활성화 및 보류 삭제 비자동 실행, native CLI 및 실제 host 전달, light/dark 렌더·상호작용. 기존 Windows 관리 검증과 변경된 UI owner 검증을 유지한다.
전체 앱 재설치 권한은 이번 기능 구현에 포함되지 않는다. 소스·검증과 실제 설치 상태를 구분한다.
생성 검증 자료는 이 작업 소유 run 아래 두고 종료 후 정리한다. 필수 수용 근거만 이 작업 문서에 남긴다.

## 구현 및 검증 진행

- 개인 맞춤 설정의 native Card/Row/Switch, 임베디드 host 전달 및 capability 검사 구현. UI 검증: source 3/3, TypeScript noEmit actual0, native React/CSS 렌더·상호작용 11개 actual0(밝음/어둠·키보드·CAS·저장 실패·종료 대기·좁은 한국어). 독립 근거 `ui-acceptance.json`.
- native 설정 CAS·의존성·shared activity 배출·재활성화 검사, CLI/lease·생성자 진입 차단과 기존 결과 reconciliation 구현. 최종 동결 입력에서 Windows235 passed/0 failed, tests/build actual0. 설정 revision을 검토 토큰에 연결해 off/on 전 승인 토큰 재사용도 차단했다. 43개 소스 identity가 동결·빌드·CLI 검증 후 동일하고 선택 dependency tuple79개는 원본1475개의 부분집합이다. 실제 host→후보 실행기 통합7개 actual0으로 CAS·배출·기존 lease 반환·reconcile 제한·신규 lock/run 미생성·재활성화·구 토큰 거절·새 심사 명시 삭제와 부재를 확인했다. 독립 근거 `native-acceptance.json`.
- UI 검증 자료 등록이 측정 시간제한과 catalog 재획득 경합으로 중단되어 정확한 예약의 supported recover_reservation을 수행했다. 실행 결과를 성공으로 바꾸지 않았고 삭제 전 보호를 유지했다. UI 정리 owner가 catalog를 독점 사용하는 동안 다른 팀 등록은 기다린다.
- core 검증 preflight actual1: SOURCE.json coverage extra4(`core/src/session/agent_profile.rs`, `core/tests/suite/code_mode_dynamic_tools_tests.rs`, 이번 `project-maintenance/src/preferences.rs`, `protocol/src/agent_profile.rs`). 추가 read-only 측정 actual0에서 기존 기록 경로90개의 내용 불일치를 확인했다. 다른 작업을 포함한 출처 갱신 권한을 사용자에게 요청했고 승인 전 SOURCE를 변경하지 않는다. core Cargo는 실행하지 않았다.
- `core-r1`은 Python PATH 호출 ENOENT로 actual1·stopped/failure로 닫혔으며 이후 절대 Python 경로 preflight로 위 실제 출처 문제를 확인했다. `native-r1`은 격리 Cargo lock 준비 실패 actual101, r2에서는 격리 manifest의 미사용 patch를 제외해 실제 dependency tuple을 원본의 부분집합으로 유지한 후 통과했다. 실패 결과는 보존하며 정리 대상이다.
- JS source 검증은 초기207중206 pass와 PowerShell PATH 누락1건(actual1)을 확인했다. source-r2에서 확인된 PowerShell7 경로를 정상화한 환경으로 해당1건을 다시 실행해1/1 pass actual0. 두 실행 사이 관련12개 script hash는 동일하며 원래 실패를 성공으로 고치지 않았다. artifact-run16개 동작 묶음 actual0. 독립 근거 `source-acceptance.json`.
- native-r3의 최초 CLI 검사 actual1은 검사기가 기존 producer 경로를 재사용해 올바른 중복 소유권 검사가 먼저 거부한 harness 오류다. 고유 경로를 사용하는 별도 cli-r1 actual0 결과로 보완했다. r3의 실패 producer 상태와 native tests/build0을 구분한다.
- read-only 통합 검토에서 새 결함은 확정되지 않았다. UI는 runtime 상태 루트를 명시하고 preferences capability가 없는 owner를 거절한다. 일반 resolver 자체는 구형 owner도 지원하므로 UI 밖의 혼합 구버전 실행기·기존 세션에 설정 강제를 보장하지 않는다. 이번 작업은 기존 실행기·앱을 교체하지 않았다.
- scoped diff --check actual1은 기존 `spec_plan.rs` 끝의 추가 빈 줄(작업의 변경 위치 밖)이다. 기존 광범위 수정/스테이징을 보존했으며 SOURCE 불일치와 core 필수 검증 미실행 때문에 task commit도 아직 수행하지 않는다.
- 테스트 격리 보완: native 하위 CLI 네 호출이 사용자 설정을 상속하므로, 사용자가 기능을 끈 상태의 테스트 독립성을 위해 `tests/registry.rs` 두 곳과 `root_retirement.rs`, `duplicate_claims.rs` 각 한 곳에 fixture-local `AZRAEL_STATE_ROOT`를 명시했다. 해당 세 exact case를 부모 설정 꺼짐으로 재검증해3/3 pass·각 actual0을 확인했다. 부모 설정은 바뀌지 않았고 부모 activity lock도 생성되지 않았다. 제품 구현 소스는 기존235/CLI7 수용 이후 바꾸지 않았으며 기존 기준과 달라진 소스는 승인된 이 세 테스트 파일뿐이다. 새 테스트 호출을 추가할 때 설정 전달을 빠뜨릴 수 있어 기존 테스트에서 이 경계를 유지한다. 독립 근거 `isolation-acceptance.json`.
- native 출력 다섯 그룹의 등록·첫 심사는 성공했으나 apply가101.7초 후 실제 exit1(`maintenance_busy`,catalog/check_available,owner:null)로 부분 종료했다. r3 경로만 부재, 나머지 네 경로는 남아 있다. 이 시점의 점유 주체는 확정하지 못했다. 이후 root의 일회성 CIM 관측에서 native owner와 모든 실행파일 종류의 `--lease`+`lifecycles` 일치 프로세스는 없었으나, 이를 과거 종료 증거나 강제 복구 권한으로 쓰지 않는다. 최신 owner 심사로 부분 상태를 재확인한 뒤 이어가며 최초 실패를 보존한다.
- 위 부분 정리는 완료했다. 실제 fc02 입력에 기록된 Windows worker/entrypoint identity와 현재 소스가 같음을 확인하고, 정상 native exit1 및 non-inherited kill-on-close Job의 동기 종료 계약을 exact PID/token/SHA/fence와 함께 독립 proof로 보존했다. supported recover_reservation 다섯 건은 outcome/intents를 변경하지 않았으며, r1은 supported refresh 후 fresh registered review를 통과했다. 재시도 apply actual0에서 남은 네 item이 deleted/remaining:false였고 최종 다섯 경로 모두 부재·lifecycle finalized를 확인했다. 논리 크기947,094,356bytes를 삭제했으며 실제 물리 회수량으로 주장하지 않는다. 불변 원본 수용/복구 proof와 `native-cleanup.json`은 payload 밖에 보존한다.

## 남은 수용 조건

- 검증 산출물 정리 완료. native/core 다섯 run947,094,356bytes와 isolation-r1 384,730,028bytes를 supported owner로 삭제·실제 부재·finalize 확인했다(합계1,331,824,384 logical bytes). source-r1/r2 및 UI 세 run도 각각 owner 삭제·부재·finalize를 확인했다. task-only helper 세 개와 빈 `artifacts/tasks/FE01` 컨테이너는 제거·부재 확인했다. 필수 독립 수용·참조된 불변 복구/정리 proof만 이 작업 문서 폴더에 남으며 payload·Cargo target·후보 binary는 남지 않는다. 실제 사용자 홈의 activity control inode는 삭제하지 않았다.
- 사용자가 기존 다른 작업을 포함한 현재 변경 목록 확인 및 SOURCE 출처 갱신을 승인했다. 다른 작업의 코드는 그대로 보존하며, 명시적 delta 목록과 현재/원본 receipt identity를 확인한 supported recorder로 갱신한 뒤 core 필수 native 검사·통합 수용을 이어간다. 앱 패키지·설치·기본 실행기 교체는 수행하지 않았다.
- 혼합된 기존 수정·index를 보존하고 있어 검증 및 변경 분리 조건을 충족하기 전 task commit을 하지 않는다.

현재 전달 상태: 소스 구현·Windows 개별 수용·기존 생성물 정리 완료. 승인된 출처 갱신과 core 통합 수용을 진행 중이며 실제 앱 반영/커밋은 미완료다. 이전 검증은 일치하는 입력·범위에서 재사용한다.

## 승인된 출처 갱신 및 core 검증 재개

- 사용자 승인에 따라 기존93개 경로 내용 변경과 신규4개, 총97개 명시적 경로를 검토했다. 삭제·SQL migration·별도 adaptation 변경은 없다. 기존90개 대비 증가3개는 위 테스트 격리 파일이다. 다른 작업 코드의 정확성 수용이 아니라 현재 byte 출처의 측정 기록이며 제품 코드를 수정하지 않았다.
- 원본 기준 receipt `12a1dbfc1725df7d4e87de4e336e0b8dab217aecbe7d26b624d1e264356b00b6`를 검증한 supported recorder actual0. 현재 receipt는 `50527b723b4aa0fdf2ed082326f6460d0abb0e8c4286d2745123cf1c16ea92ff`에서 `609b326c1f2e67fee9f4e998ac2e9bc693c6dd9ae28fc5954eb48f14c3d15076`으로 갱신했다. 새 `preferences.rs`만100644로 스테이징했으며 다른 index entry 불변을 확인했다.
- `core-r2` 측정·기준 검증 actual0. `core-r3`은 전체 Git index 읽기의 기본1MiB 버퍼 부족(`ENOBUFS`)으로 recorder 이전에 실패했고 source/index를 변경하지 않았다. 충분한64MiB 읽기 버퍼로 준비한 새 `core-r4`에서 recorder 및 세 번 provenance 검사 actual0, 동일한 live-before/frozen/live-after 결과를 얻었다.
- 검증용 full engine 동결:9,347files, source SHA `f001a9a4af4fa5742a6486e86a99cd66bbd75a2e45903909f72ce598c95e14aa`. Rust/cargo1.95.0과 기존96c 호환 cache identity를 확인했다. 다른 관리된 검사가 같은 cache를 연속 점유하고 있어 실행은 release event와 supported owner admission을 기다린다. 다른 owner의 잠금을 제거하거나 중복 compile하지 않는다.
- task commit 검토: `cli.rs`는 HEAD에 없는 기존 다른 작업의 staged 신규278줄에 이번 기능이 의존한다. 이를 포함하거나 기존 index를 재작성하지 않고 이 작업만의 검증된 독립 commit을 만들기 어려워 기존 변경을 보존한다. 출처 기록 갱신 승인을 다른 작업 코드 commit 승인으로 확대하지 않는다.
- core-r5는 release event 후 정상 owner admission으로 필수 검사를 실행했지만 wrapper/Cargo101, executed0으로 끝났다. 고정 소스의 `codex_protocol::agent_profile` export/file은 존재하는데 공유 `.d` 여덟 개가 이를 누락하고 protocol compile도 없어서 오래된 workspace 산출물 재사용 정황을 확인했다. 고정 입력의 post-provenance는 동일·정상이며 제품 코드는 수정하지 않았다.
- 교정 범위: 승인된97경로 중96개를17 workspace package에 매핑했다(Cargo.lock은 workspace-global). 기존 owner 경계 안에서 그17 package의 dev/test 산출물만 Cargo clean으로 갱신하고 release·registry 의존성 캐시는 보존한다. 필수 재검사는 core의 reachable 변경 package13개의 해당 frozen 경로 실제 compile 증거, nonzero passing tests, provenance 불변까지 요구한다. 기존 Cargo101/zero-tests를 성공으로 바꾸지 않으며 다른 owner가 끼거나 freshness를 입증하지 못하면 수용하지 않는다.
- cache admission 교정: 물리 lease 반환과 shared producer 기록 종료 사이의 전환 및 catalog 경합을 확인했다. core-r6/r7은 clean/test spawn 이전에 각각 shared unresolved producer/typed lifecycle-begin Busy로 중단됐으며, 정확한 no-spawn·controller 종료 근거를 보존하고 실패1·stopped로 닫았다. 새 core-r8은 두 상태가 모두 준비됐을 때만 normal atomic admission을 시도하고, proven pre-mutation acquisition Busy만 같은 preparing run에서 event 기반 재대기한다. 다른 세션의 live owner는 복구·중단·잠금 삭제하지 않았다.
- core-r8의 managed Cargo clean17개(`--profile dev`) actual0·no signal/ownership error. Cargo 보고19,710files/28.0GiB이며 release·registry dependency cache를 선택하지 않았다. 사이에 다른 물리 owner가 관측되지 않은 상태에서 동일 고정 입력으로 필수 core wrapper를 재시작했다. 테스트 수용 결과는 아직 미확정이다.
- 재검사 core-r8 결과:421,815ms 후 Cargo101, executed0, selected-tests-v2 미수용. 이번에는 protocol을 포함한12/13 reachable 변경 package가 올바른 동결 경로에서 실제 compile됐고, 이전 stale module 누락은 사라졌다. 새 원인은 다른 작업의 `core/src/session/agent_profile.rs`138–139의 production `windows_sys` 의존성 누락과76의 `Cow<str>`/`String` branch 타입 불일치다. mcp-extension은 core 실패로 compile 단계에 도달하지 못했다. post-provenance는 동일·정상이다.
- 현재 live 소스에도 같은 오류가 남음을 root가 확인했다. 최소 수정안은 managed provider `.0.into_owned()` 변환과 이미 존재하는 Windows windows-sys 항목을 target dev-dependencies에서 target dependencies로 이동하는 두 파일 범위이며 새 버전/의존성 도입은 필요하지 않다. 사용자가 승인한 것은 metadata 갱신이므로 이 코드 수정에 대한 별도 답변을 요청했고 승인 전에는 수정하지 않는다.
- 독립 근거 `core-verification.json`에97경로/receipt transition/frozen identity/clean0/두 Cargo101·zero-tests/실제 compile 및 원인 오류를 보존했다. 해당 근거 SHA `c79f9061d003586c4bf06f97656fee99949f86a89530790020dd408e91cddbab`는 정리 후에도 동일하다. 다음 코드 수정이 승인되면 새 입력을 동결한다.
- core-r2~r8 일곱 임시 run은 supported owner의 두 apply 모두 actual0으로 삭제했다. 모든 item/group이 deleted·remaining:false·error:null이고 실제 일곱 경로 부재 및 producer finalize를 확인했다. 제거한 논리 크기는201,241,046bytes이며 물리 회수량은 측정하지 않았다. 빈 FE01 컨테이너와 task helper도 제거했고 catalog를 반환했다. 공유96c target·원본 baseline·SOURCE·다른 작업 index는 보존했다. 정리 중 정상 종료한 catalog Busy 실패와 재시도 결과는 별도 `core-cleanup.json`에 보존한다. 현재 임시 정리 잔여물은 없으며 두 파일 최소 수정 승인과 필수 core 재검증은 대기 중이다.
