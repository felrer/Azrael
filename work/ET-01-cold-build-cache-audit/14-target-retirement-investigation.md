# 공용 Cargo target 초기화 차단 근거

상태: 조사 완료, 삭제 미실행. 사용자 초기화 승인은 유지한다. 지원 API의 신규 범위 결정과 과거 producer 종료 근거가 남아 있다.

- 조사자는 읽기 전용 `legacy_target_owner`다. 전체 native inventory 644개 그룹/1,385개 항목에서 target 전체 항목은 없고 아래 12개 하위 항목만 확인했다. 기존 두 그룹의 review는 중복과 그룹 보호로 차단됐다. 같은 inventory/review를 재사용했다.
- `do1-unused-native-outputs-r1` 소유자는 `DO-01-codex-version-comparison`, 완결/deferred다. `do2-native-outputs-r1` 소유자는 `codex-retained-reasoning`, 완결/deferred다. 직접 참조와 이들 ID/그룹의 inbound 참조는 inventory에서 발견되지 않았다. 이것만으로 producer 종료나 전체 target의 무사용을 증명하지 않는다.
- 공통으로 실제 남은 경로는 `engine/codex-rs/target/debug/deps/` 아래 `all-c71321a47dbe4ed9.exe`, 같은 `.pdb`, `codex_core-ee1b27bb08f71819.exe`, 같은 `.pdb`다. do1 ID는 `do1-unused-native-` + 파일명, do2 ID는 `do2-` + 파일명이다. do1의 추가 absent 항목은 `codex_app_server-ab0fa3885fa06f43.exe/.pdb`, `codex_tui-128ff604062e1c7e.exe/.pdb`다.
- 차단 문구: `overlapping lifecycle member requires its own whole-group decision`, `a lifecycle group member is protected`.
- `engine/codex-rs/project-maintenance/src/retirement.rs:103`의 managed-root retirement는 이미 존재하는 완결 그룹의 exact managed-root 항목과 같은 owner를 요구하며 다른 등록 항목/원본의 겹침을 거부한다. target root를 새로 등록해도 기존 하위 등록이 차단한다.
- `src/nested_retirement.rs:53`은 같은 owner·서로 다른 그룹·엄격한 포함 관계·그룹당 live 항목 하나를 요구한다. 현재 같은 경로/다른 owner에는 적용되지 않는다. `src/groups.rs:148`의 재등록은 측정/존재를 갱신할 수 있으나 중복 주장을 제거하지 않는다. producer_registry_v1 전용 refresh도 두 과거 generic 그룹에 적용되지 않는다. 지원 unregister/finalize API는 확인하지 못했다.
- 실행한 standalone SHA는 설치 기록과 같은 `f167e9bdb5c3cd5ea796417ddb7bbd89d9bea1322a369f9de89b5c63bd53cc76`다. candidate의 retirement/groups/registration/nested-retirement 및 관련 시험 소스는 현재와 일치하지만 lib.rs/apply.rs는 다르다. 현재 전체 소스와 설치 binary의 동등성은 주장하지 않는다.
- 과거 Cargo PID22140/부모43248은 snapshot에서 부재이나, 79개 native run ledger의 최신 기록은 2026-10-29 05:55:21 UTC로 해당 10월30일 실행과 매칭되지 않았다. 정확한 target·소유 run·종료 코드는 확인하지 못했다. PID 부재로 종료를 확정하지 않는다.
- 필요한 새 절차의 조건: 모든 관련 owner/group의 명시적 결정을 원자적으로 기록하고, 현재 membership·참조·보호·producer 상태와 물리 경로 identity를 재확인해야 한다. 등록 JSON 편집, 강제 삭제, 겹침/보호 검사 우회는 제외한다. 상세 근거는 조사자의 최종 보고 및 위 owning symbols다.
