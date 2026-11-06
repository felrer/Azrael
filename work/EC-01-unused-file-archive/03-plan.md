상태: 승인된 개선 구현·검증 중. 준비 실패 처리, 실행 시각과 오래된 기록의 조사 목록, 기존 캐시의 근거 기반 정리를 진행한다. 전체 앱 빌드·설치는 제외한다.

# Cargo 준비 실패의 미확인 소유 기록 방지와 기존 캐시 정리

## 목표와 권한

Cargo 실행 전 준비 실패가 `unknown` 또는 미종료 `pending/running`으로 남는 경로를 없애고, 기존 엔진 캐시의 미확인 기록을 근거로 분류한 후 사용하지 않는 자료를 소유자 절차로 삭제한다. 사용자가 구현·검증과 근거 기반 정리를 승인했다. 이전 archive/수동 삭제 작업의 완료 상태는 유지한다.

추천: 실행되지 않은 실패와 실행 후 종료 불확실성을 분리한다. 실제 종료를 모르는 실행의 `unknown`까지 없애기 위해 성공·실패를 추정하지 않는다. 목표는 불필요한 unknown 발생 방지, 기존 항목별 사실 확정, 확인된 불용 자료와 불필요한 빈 관리 기록 정리다.

플랫폼: 상태 의미는 Windows/Linux/macOS 공통인 Node Cargo 래퍼 범위다. 이번 실물 조사는 Windows x64 로컬 체크아웃에 한정한다. 프로세스 트리 확인과 파일 잠금은 플랫폼별 구현·검증을 구분한다. 전체 앱 빌드·설치나 독립 native 실행기 교체는 이 계획에 포함하지 않는다.

## 확인된 원인과 경계

| 위치 | 현재 동작 | 문제와 변경 방향 |
| --- | --- | --- |
| `scripts/cargo-target-owner.cjs:215–220` | shared begin 이후 target lease 획득이 try 밖에서 실행됨 | lease 충돌·획득 실패 시 이 호출이 만든 shared generation이 종료되지 않음. 해당 호출의 generation만 종료하며 기존 target 소유자는 건드리지 않는다. |
| `scripts/cargo-shared-cache.cjs:58–63` | lifecycle 등록 뒤 mkdir·identity marker 쓰기 | 뒤의 쓰기가 실패하면 selection 반환 전 미종료 기록이 남을 수 있음. claim 이후 초기화 실패도 내부에서 정리 가능한 handle/증거를 보존한다. |
| `scripts/cargo-target-owner.cjs:220–231` | recordPending·pending mkdir와 spawnSync를 같은 catch로 처리 | Cargo 호출 전 예외도 `{status:null,error}`가 되어 일반 예외는 unknown으로 분류됨. 명시적 실행 단계로 사전 실패를 확정한다. |
| `scripts/cargo-target-owner.cjs:75–95` | ENOENT/EACCES이고 pid가 없을 때만 not-started, 나머지는 unknown | 사전 준비 실패와 spawn 호출 후 불확실성을 분리한다. pid 없음만으로 미실행을 추정하지 않는다. |
| `scripts/cargo-shared-cache.cjs:65–74` | result.error/signal/null status면 무조건 반환 | target lease에서 not-started로 처리된 실행 파일 부재도 shared lifecycle은 남는다. 확정된 미실행 종료 증거를 shared owner에도 전달한다. |
| `scripts/cargo-target-owner.cjs:64–72,237–238` | lease mkdir 후 owner 쓰기 실패, target 종료 처리 실패에 대한 후속 경로가 없음 | 자신이 만든 예약의 부분 초기화와 각 종료 단계의 실패를 구별하고, identity/token을 확인한 재시도 가능한 복구 근거를 남긴다. |

현재 pending evidence와 shared cache evidence는 같은 target/key 파일명에 덮어쓴다 (`recordPending`, `finishExecution`). 세대별 불변 종료 증거가 필요하다. 실제 Cargo 종료 결과, 관측/영수증 쓰기 실패, 소유권 해제 결과를 별도로 보존한다.

기존 재사용: `closeLifecycle`은 확인된 실패를 `failure`, `exit_code:null`로 기록할 수 있다. 새 가짜 Cargo exit code나 성공 판정은 필요 없다. 기존 revision/catalog lock, target token/physical identity 검사, `recoverTargetOwner`, native review/apply 경계를 유지한다. close 호출 자체가 실패하면 해당 상태를 숨기거나 JSON을 직접 수정하지 않는다.

`scripts/artifact-lifecycle.cjs`에는 이미 사용자/다른 작업의 변경이 있다. 구현 시 현재 변경을 보존하고 API 확장이 꼭 필요한지 먼저 판단한다.

## 현재 실물 조사 결과 (2026-10-28)

primary `catalog()`와 알려진 소유 경로만 읽었다. 전체 cache payload 재귀 스캔·재해시, 복구·삭제는 하지 않았다.

- `shared:cargo-target:96c960bf49711cbf6327e0888542e8d56cb0687e31d690b758d6c9becaa3ca24`: 경로 존재, pending/revision 5, membership incomplete, producer 종료 기록 없음. 최종 갱신 UTC 2026-10-26 22:47:30.953 (KST 10월 27일 07:47:30.953).
  - `target/.azrael-cargo-owner/owner.json`: running, token `e4552786-9a6c-48fc-8f79-bf354ec30928`, coordinatorPid 44152, producerPid null, 시작 UTC 22:47:30.988. `cargo check -p codex-core --lib --locked --offline --target x86_64-pc-windows-msvc --tests --profile test`, cwd `artifacts/workspaces/q/engine/codex-rs`.
  - owner SHA256 `b66d06849591fcb16a85e66bf43ec0b5d27c675304bc9935854d05490fb64b9e`. 조회 시 PID 44152는 반환되지 않았다. PID 부재와 producerPid null은 전체 자식 종료나 Cargo 미실행의 증거가 아니다. 이 항목의 실제 원인이 준비 실패인지 아직 확정하지 않았다.
- `shared:cargo-pending:dec40d0d0e18389b84045c74dedceb9d2df79e1c1f9890b88fdee4fd1e21895f`: 경로 존재, pending/revision 21, membership incomplete, 종료 기록 없음. 최종 갱신 UTC 2026-10-23 01:47:17.820. target와 원래 실행의 연결·종료 근거 확인 필요.
- `shared:cargo-target:e6800e57b513189b18e235159d5808a618fd56e99b4e3ae13f0b16d4075f1388`: success/complete지만 payload는 없음. 재삭제가 아니라 참조·관리 상태 사후 정합 대상이다.
- 추가 연결 후보: `work:workspace-cargo-cache-2026-0-11` pending이나 member `artifacts/cache/c`는 없음. `work:engine-check-retirement-r1`, `work:CJ-01:cargo-preparation-v1`도 pending이고 경로 존재. 공유 캐시와 동일 소유라고 추정하지 않고 소비/중첩 관계를 조사한다.

위 항목은 literal unknown만 검색해서는 발견되지 않는다. `pending + producer 미종료`, `running owner`, incomplete membership, 끊긴 참조도 포함해야 한다. cleaner의 `preserved-unknown`은 엔진 버전 판별 불가를 뜻할 수도 있어 실행 unknown과 별도 분류한다. 날짜는 기록 갱신 시각이며 실패·삭제 시각으로 단정하지 않는다. 현재 목록은 primary Cargo 관련 등록부의 초기 조사이며 전체 엔진 캐시 분류 완료를 뜻하지 않는다.

## 구현·정리 순서

1. **경계 확정과 목록화**: primary native group/cache producer/target lease와 실제 경로의 합집합을 메타데이터로 대조한다. `artifacts/cache/cargo`, 등록된 기존 Cargo targets, pending outputs, 연결된 작업·동결 snapshot의 owner만 조사한다. 전역 `.cargo`·사용자 설정·원본 소스는 삭제 범위에서 제외한다. 각 항목의 원인, 최근 기록, 생성자, 소비자, 실제 존재, 종료 근거, 삭제 가능 여부와 필요한 추가 근거를 표로 만든다. 기존 정리·EC-01 근거를 재사용한다.
2. **writer 수정**: 검사 가능한 인자/경로 조건은 claim 전에 확인한다. claim 이후에는 shared/target/pending handle과 generation을 추적한다. `preparing → spawn-attempted → observed-terminal`을 구별하고, spawn 미호출이 확실한 준비 실패만 not-started/failure(null exit)로 닫는다. spawn 호출 뒤 timeout/signal/종료 불명은 보호한다. 실패 경로에서도 각 owner의 종료 결과를 별도 기록하고 원래 오류를 가리지 않는다. 영수증은 세대별 불변 경로에 배타적으로 게시하고 정확한 revision으로 재시도한다. finally만 추가하여 무조건 lease를 제거하는 방식은 쓰지 않는다.
3. **검증**: 아래 실패 주입과 기존 정상/불확실 실행 보호를 검증한다. 실제 Cargo 컴파일 없이 작은 자식 프로세스/격리된 소유 fixture로 대부분 검증하고, 필요한 최소 실제 wrapper 검증만 선택한다. test 선택·작성·정리는 testing/implementation 스킬을 적용한다.
4. **기존 항목 복구**: 실제 원래 실행 로그, 동결 snapshot, 종료/복구 영수증, 설치·실행 참조를 대조한다. 준비 실패를 확정하면 그 근거로 failure/null을 기록한다. 실제 실행 여부·종료가 불확실하면 정확한 producer tree 종료 근거를 확보하여 기존 owner 복구를 사용하고 과거 unknown 결과는 보존한다. shared close가 unknown 상태의 정리를 계속 차단한다면 기존 API가 허용하는지 확인하고, 원결과와 별개의 검증된 종료·정리 eligibility를 표현하는 제한된 API 변경을 먼저 설계한다. 성공·실패로 강제 승격하지 않는다.
5. **검토 후 삭제와 사후 처리**: owner 근거가 완결된 전체 그룹을 refresh/register하고 native review의 새 token으로 delete한다. 공유 소비자·설치·실행 보호를 재검사한다. 실제 미존재, per-item 결과, 참조 해제, producer/native finalization을 각각 확인한다. 이미 없는 자료는 실제 부재와 참조를 근거로 정합한다. 일반 삭제가 실패하면 원인을 조사하고 기존 archive 예외 절차에 해당할 때만 적용한다. occupied lock 제거·강제 삭제·raw registry 수정은 하지 않는다.

## 성공 기준과 검증

| 기준 | 검증 방법 |
| --- | --- |
| 실행 전 실패에 불필요한 unknown/running claim이 없음 | shared claim 뒤 mkdir/marker 실패, lease 충돌/owner 쓰기 실패, recordPending 실패, pending mkdir 실패 각각 주입. spawn 호출 0회 및 자신의 claim만 종료되는지 확인 |
| 실행 파일 부재가 shared/pending에 미종료로 남지 않음 | ENOENT/EACCES 미실행 결과와 shared·target·pending 종료 상태를 함께 검증 |
| 실제 종료 불명은 안전하게 보호 | spawn 내부 throw·signal·timeout·null status, 다른 token/revision, 살아 있는 다른 소유자에 대해 삭제/성공 승격 없음 |
| 종료 기록 실패를 복구 가능 | evidence 게시/close/lease unlink 실패 주입, 원래 Cargo status 유지, 불변 근거와 재시도 일관성 확인 |
| 기존 기능 보존 | 기존 `test-cargo-target-owner.cjs`, `test-cargo-shared-cache.cjs`, Cargo verification/preparation와 lifecycle 관련 선택 회귀. compilation key·physical alias·pending source 경계·관측 오류 분리 유지 |
| 기존 캐시 분류와 정리 완료 | 경계 내 모든 항목별 근거·가능 여부를 기록. 삭제한 그룹 실제 부재와 관리 정합, 보호 항목의 정확한 미확정 조건 명시. 단순 defer로 원인 조사를 대체하지 않음 |

실제 강제 종료/전원 상실·저장장치 오류 후에도 unknown이 절대 없다는 보장은 할 수 없다. 그런 경우에는 명확한 복구 작업과 근거를 남겨 미해결 상태가 방치되지 않도록 한다. Windows x64 검증과 공통 소스 계약 회귀는 필수이며 Linux/macOS 미실행은 별도 미검증으로 보고한다.

## 문서와 검토 결정

구현 전 기존 `docs/architecture/project-maintenance.md`의 종료·보호 계약과 `docs/ops/development.md` Cargo owner 절차를 승인된 동작에 맞춰 갱신하고 feature inventory의 기존 보존 ID에 검증을 연결한다. 이번 조사에서는 해당 계약을 변경하지 않았다.

승인 범위: 위 안전 경계를 유지하면서 writer 수정, 최소 검증, 기존 엔진 캐시별 원인 조사·검증된 복구·불용 그룹 삭제를 진행한다. 실행·진행 시각을 기록하고 명시한 경과 시간으로 조사 대상을 식별하되 시간만으로 삭제하거나 자동 실행 일정을 추가하지 않는다. 실제 unknown 복구를 위한 새 native/API 변경이나 실행기 빌드가 필요하면 영향과 범위를 제시하고 해당 추가 작업을 확인받는다.

분담: root는 Cargo target/shared writer와 통합·수용을 맡는다. `cargo_age_inspector`는 읽기 전용 조사 CLI와 그 검증 소스, `cargo_prestart_tests`는 기존 실패 회귀 검증, `cargo_legacy_audit`는 기존 캐시 종료 근거의 읽기 전용 조사를 맡는다. 공유 catalog를 변경하는 실행·정리는 root만 직렬 수행한다. 2026-10-28 작업 시작; 검증 전까지 제품 빌드는 실행하지 않는다.

## 실행 기록

- 검증 출력 소유: `run:EC-01-unused-file-archive:cargo-prestart-r1`, owner `/root`, 경로 `artifacts/tasks/EC-01-unused-file-archive/runs/cargo-prestart-r1`. Cargo owner/shared/audit/verification/preparation의 Node 검증 5개 파일을 선택했다. 영구 회귀 사례는 준비 실패·종료 근거 불변성·미확인 실행 보호·시간 기반 조사라는 반복 계약을 검증하므로 기존 사례 확장과 작은 audit 검증 파일로 유지한다. fixture와 원시 로그는 결과 검토 뒤 삭제한다.
- 최초 등록 대기 중 동시 실행 중인 동결 프로젝트 `artifacts/workspaces/r`의 feature-preservation 소스 검증을 확인했다. 다른 작업은 중단하지 않고 같은 검증을 중복 실행하지 않았다. 등록 완료 후 선택 검증을 시작했다. 이 관측만으로 지연 원인을 잠금으로 확정하지 않는다.
- r1: Node 검증 93개 중 90 통과, 실제 exit 1. 고정 800ms 소유 기간을 쓰는 기존 경합 사례와 복사 fixture의 standalone 경로 누락 2건을 확인했다. 경합은 release marker로 동기화하고, 복사 fixture는 검증된 설치 실행기를 명시적으로 선택하도록 수정했다. spawn에서 던진 ENOENT/EACCES와 실제 반환된 미실행 오류를 구분하는 회귀도 추가했다.
- r2: 수정된 5개 파일과 scheduling/Cargo evidence cache/feature-preservation 회귀를 확장 실행 중이다. 새 owner/shared helper는 reviewed source-only 해시 목록과 달라 캐시가 보수적인 전체 입력 경로로 전환되며 기존 동등성 사례가 실패한 것을 확인했다. 모든 gate와 런타임 helper 내용 binding을 유지하면서 검토된 helper 해시를 갱신하고 영향 사례를 재검증할 예정이다.

### 기존 미종료 자료의 조사 한계와 보존 범위

- 공유 캐시 `artifacts/cache/cargo/96c960bf49711cbf6327e0888542e8d56cb0687e31d690b758d6c9becaa3ca24`의 e455 소유 기록은 여전히 running이며 terminal/exit 근거가 없다. 조사한 q/루트 로그·task·CR/CJ 기록에서 token/signature/PID/명령에 맞는 종료 근거를 찾지 못했다. 시작보다 이전인 Windows 마지막 부팅(2026-10-16 KST)은 종료 증거가 아니다. 현재 전체 논리·물리 용량은 측정하지 않았다.
- pending 출력 `artifacts/verification/cargo-pending/dec40d0d0e18389b84045c74dedceb9d2df79e1c1f9890b88fdee4fd1e21895f`은 primary `engine/codex-rs/target`의 physical identity SHA와 일치한다. 현재 target 디렉터리는 존재하지만 lease는 없다. 기존 고정 terminal 증거는 다른 token의 이전 성공 실행이므로 현재 pending generation의 종료 근거로 사용할 수 없다. 전체 용량은 측정하지 않았다.
- 두 producer 기록의 등록 참조는 비어 있지만 이것만으로 외부 소비가 없다고 판단하지 않는다. `work:workspace-cargo-cache-2026-0-11`, `work:engine-check-retirement-r1`, `work:CJ-01:cargo-preparation-v1`과의 소유/소비 관계도 입증되지 않았다. 원본·기존 보호 기록은 변경하지 않았다.
- 보존 목적은 정확한 종료 근거 없는 삭제 방지다. 다음 Windows 재부팅 이후 이전 실행의 종료를 입증하고, 현재 소비·설치·경로 identity를 재검토한 뒤 해제 가능성을 판단하는 것을 추천한다. 재부팅은 실행하지 않는다. 현재 API에서 stopped/unknown은 여전히 정리를 차단하므로, 과거 결과와 별도의 검증된 정리 자격을 표현하는 복구 API 설계·구현은 추가 범위 확인을 요청했다. 그 답변 전에는 기존 기록의 결과·보호를 변경하지 않는다.

### ?? ?? ?? ?? (2026-10-28)

- r2? ?? exit 1, 147? ? 141? ????. ??? helper ?? ??? 1?? Python PATH ?? 5?? ????. ?? ?? ??? ?? helper ??? source-only ?? ??? ???? ?? helper ?? binding? Cargo ?? gate? ????.
- r3? ?? Windows x64 ???? 8? Node ?? ??, 147? ?? ??, ?? child exit 0/signal null/error null, 78,942.57ms??. child ???? Python312 PATH? ???? ?? Python ?? exit 0? ?? ????. Cargo ?? ?????? ?? ???. Linux/macOS? ?????.
- ?? ??? `cargo-prestart-r3/reports/verification.json`? ?????, disposable r1/r2/r3 ??? `cargo_test_cleanup` ???? ?? ?? ??? standalone?? ?? ????. root? ?? ?? ? catalog? ???? ???. ?? ?? ??? `10-cargo-test-cleanup.json`? ????.
- ?? ?? ? ??? ??? ?? ??? ?? ??????? ???. ?? unknown ?? API ?? ? ??? ?? ???? ?? ??? ??? ??? ????. ???? ???? ???.

### ??? ?? API ??

???? ?? ? ??? ?? Windows ??? ? ???? ???? ?? ?? API ?????? ????. ???? ???? ???. common Node/native ??? ???? ?? ??? Windows x64? ????.

`recoverCleanup`/`recover-cleanup`? ?? pending/unknown ???producer?exit? ??? ?? ?? `cleanup_recovery` ??? ????. ??? owner/revision/generation/member identity, ?? generated/protection_known=true, ?? producer-tree ??? ?? ??? ???? SHA ?? JSON??? ?? ??? ????. ??? ?? ???? registry ?? ??? ?? ?? ?????? ?? ????. ?? ?? ??? ?? ???? ?? ?? ?? API? ????. ?? ??? ?? ??? ???.

?? `closeLifecycle`/native producer registry ??? lease?catalog lock? ?????. ?? close unknown ??, ??? failure? ???, custody ?? API? ?? ?? ??? ???? ??? ??? ???? ???? ???. root? Node API??????, `unknown_cleanup_native`? registry native ?????, ?? `cargo_prestart_tests`? lifecycle API ??? ????. ?? cleanup ???? r1/r2/r3?? ?? ??? ???. native source? ??? ? ?? standalone ?? ?? ???? ???? ?? ?? ???? ??? ????.

- ?? ?? r1/r2/r3 ??? native apply exit0/aborted:false, ?? item deleted/remaining:false, ?? ?? ??? producer finalize? ????. ?? ?? ???10-cargo-test-cleanup.json. ?? ?? ??? ?? exit1? ?? ?? ??? ?? recover_reservation? ????? ?? ?? ??? ???? ???.
- ?? API Node r1:242tests/238pass/3fail/1skip, ??exit1. ??? ? own-reference fixture? ??? dependency, runner? writer ???? ??, child PATH? pwsh ????. fixture? ??? installed WindowsApps pwsh7.6.9 ???? exit0? ????. root? r1 ???? ???? ?? Cargo fixture ??? ??? ?? ?? ?? ????? ??? ????. r2? ?? fixture? ?? run??? ???? writer? ???? ??? ??????.
- ?? ?? shared Cargo key96c960? unresolved??? ????? ???. native ??? ?? run?? explicit target? ??lease? ?? tmp/pending? ?? run? ??. ??? ~/.cargo? offline dependency/toolchain ????? ????? ??????? ???.

- ???? `artifacts/verification/cargo-owner-tests/`? config-override-GLr6TL, pending-Kvzt80, prepare-owner-yju6P8, shared-owner-kN27rj, signature-UtcGoq 5? ??? ?? ?? ?? ?? ? ????? ????? ?? ????. ??5??/2451???/12???????? ????. ???????? ???? ??, ?? ?? ? ?? identity??????? ?? ????. ???35? ?? fixture? ????.
- native ?? ???? registry.rs ? preexisting shell-command/bash.rs ? command_safety/is_deletion_command.rs? ??? delta? ????. root? ??? diff? ???? ???? ?? ? ?? inventory?? ????? ????. shell ?? ??? ??????? ?? native maintenance ?? ??? ???. ?? ?? ?? ?? ? SOURCE ?? identity? ????? ?? ???? task commit? ??? ???.

### ??? ??5? fixture ?? ?? ??

???? ?5? ??? fixture? archive? ????? ?? ????. ?? primary catalog531? ???? ??? owner/???? ??? ?? scripts/docs? ?? ?? ??? ???. ?? snapshot?5? rootidentity? ???? ???Cargo lease? ?? nested sharedcache? preparing not-started/failure ????. ??/??? ?? ?? ?? ??? ?? ??? ??? ????.

`archive/EC-01-unattributed-fixtures-20261028-r1/<????>`?? ordinary Move-Item ??exit0. ??5?? ?? ??,5??2451??? SHA256???ID?size/mtime??? ?? ??. shared-owner?11? ???? container? PowerShell ?? ???? ?ID? ???? ?????ID? ??13-fixture-archive.json? ????(??tree atomicrename??? ???? ???). ?? ?? ?????? ?? ????? ??? historicalbytes? ??? ????13mapping?? ????. ??5? ??? ?? ??? ? ??? ?? archive ???? ????. ??invocation ?? ????? ????.

???fileopen guard? legacyPowerShell5 ??? ??? ??shell override ?????2? ????? ????? ???? ???. ??PowerShell7.6.9? ?? ???? ??FileAccess.Read/FileShare.Delete guard?SHA??? ??? ? ????. native?? generated:false/protection_known:false? archivecustody? ???? fresh review/defer? ????, ?? ?? ??? ?? ????? ??? ??? ?? ??? ????.

- ?5? archive custody ???fresh review?defer ?? ??exit0??5? remaining:true/group deferred? ????. ???5????archive5????13provenance SHA?????????? ????.14-fixture-archive-native.json? ?? ????? ????13? registrationpending ??? ??? ????? ????. generated/protection_known? false? ?? generation/useunknown?refs?????????? ??? ????. ??? ????? ???? ???.


### Cleanup direction and interruption (2026-10-28)

User explicitly replaced remaining deletion with archival, then authorized immediate termination of the active deletion. Root verified native PID83104 and its exact deletion child PID86008 plus console PID91568, retained process handles, and stopped the reviewed tree without force-delete operations. All three handles signaled termination; only native exit -1 was observable, child exits remain null. Evidence: `15-cleanup-interruption.json`. The interrupted apply is not success; previously deleted items remain deleted. New deletion is prohibited for remaining cleanup material. Current reservations must be recovered through supported exact-owner recovery before guarded same-volume archival to `archive/EC-01-cleanup-interrupted-20261028-r1/`. Historical producer outcomes remain unchanged.

Native immutable build passed 176/176 tests with gate exits0. Root actual standalone CLI acceptance passed pending/no-terminal and stopped/unknown cases, with refusal before recovery and after proof mutation, fresh explicit deletion of only the two test fixture payloads, absence and finalize. Evidence in native-r2 `reports/integration-result.json` and `reports/root-cli-acceptance.json`; default installation remains pending. Native-r2 temporary outputs will also be archived after installation handoff and verified close under the new user direction.

### Final acceptance and installation

- 중단된 정리 대상 59개 중 8개는 중단 전에 삭제됐고, 남은 51개는 `archive/EC-01-cleanup-interrupted-20261028-r1/`로 이동했다. 모든 원본 부재와 이동 전후 dev/ino 일치, 예약 6개 지원 복구, 원래 producer 기록 6개 지원 finalize를 확인했다. 삭제를 재개하지 않았다. 불변 이동 근거는 `16-interrupted-cleanup-archive.json`, 현재 native 보관 결과는 `17-interrupted-archive-native.json`이다.
- native-r2 controller 실제 exit 0, 지원 종료 결과 stopped/success/exit 0, complete membership 및 빈 references를 확인했다. Node 회귀검증은 241개 중 240 통과·Windows의 Unix mode 검사 1개 skip이며, 별도 writer 검증도 exit 0이다. 이 r2의 외부 wrapper는 당시 catalog 경합 때문에 exit 1로 종료한 사실을 `12-node-r2-terminal.json`에 유지했다.
- 새 기본 standalone은 `artifacts/versions/maintenance-owner-9bc66314-win-x64-ec01-unknown-recovery/payload/maintenance_owner.exe`이다. SHA256은 `9bc66314681460df3d6da3a9dc923eac52411e22d1fb595b08371477ac492a26`, 크기는 2,087,936바이트다. 검증 영수증은 같은 version의 `verification/`에 독립 복사했다. selector 변경 후 기본 resolver identity와 실제 native lease 획득·해제 exit 0을 확인했으며, installation revision 12에서 이전 version 참조를 지원 해제했다. 근거는 `18-unknown-recovery-installation.json`이다.
- Windows x64에서 검증했으며 Linux/macOS는 미검증이다. 앱 전체나 내장 엔진은 빌드·설치하지 않았다. 영구 회귀 테스트는 사전 준비 실패, 관측 결과와 bookkeeping 실패 구분, 증거 변조·참조 변경 차단이라는 지속 계약을 검증하므로 유지한다. 별도 task commit은 기존 동시 변경과 provenance 의존성을 섞지 않기 위해 만들지 않았다.
- 최종 handoff 후 native-r2와 이전 standalone version 두 원본을 `archive/EC-01-final-handoff-20261028-r1/native-r2` 및 `old-version`으로 이동했다. fresh review blocker 0, 동일볼륨 rename 전후 dev/ino 일치, 원본 부재 및 지원 finalize를 확인했다. 합계 논리 크기 873,855,928바이트이며 archive 이동은 공간 회수로 보고하지 않는다. 새 설치물은 이동하지 않았고 native 등록에서 installation 참조에 의한 보호를 확인했다. 근거는 불변 `19-final-handoff-archive.json`과 실제 결과 `19-final-handoff-results.json`이다.
- 마지막 두 archive root는 동일 payload 재측정을 피하기 위해 native 신규 등록을 생략하고 불변 work19에 소유·사용자 보존 지시·경로 매핑·이동 결과를 기록했다. 원본 native 이력은 보존하며, 두 보관물의 향후 정리는 정식 신규 등록과 심사 전까지 허용하지 않는다. 이전 5개 및 51개 archive custody 등록은 유지한다.
- 정리 예외는 사용자 지정 archive 보관물이다. 기존 `96c960…` 공유 cache와 `dec40d…` pending 출력은 재부팅 전까지 보존했고, 아래 종료 검증 후 사용자 지시대로 archive로 이동했다. 새 구현의 설치 자체를 종료 근거로 사용하지 않았다. task-owned 실행·검증·이전 설치물 중 이번 정리 대상으로 남겨 둔 원본 경로는 없다.

### 재부팅 후 unknown 두 경로 archive 완료

- 사용자가 재부팅 후 이동을 요청했다. Windows 현재 boot는 `2026-10-28T05:55:33.500Z`(KST 14:55)로, 두 정확한 원래 generation보다 이후다. 현재 Cargo/compiler 프로세스, inbound consumer, 중첩 소유 claim 및 active cleanup reservation이 없음을 확인했다. 이 근거는 경과 시간이나 PID 부재만으로 종료를 추정한 것이 아니다.
- `recoverTargetOwner`로 cache의 정확한 token/SHA에 묶인 오래된 물리 lease를 지원 해제하고 unknown/null 결과를 보존했다. `recoverCleanup`으로 두 pending 기록의 과거 producer/state/generation을 유지하며 정리 가능성만 검증했다. API 결과는 `20-recovery-results.json`, 독립 boot·membership 근거는 `20-reboot-evidence.json`과 `20-reboot-membership.json`이다.
- metadata-only 검사에서 cache 17,673개 파일·3,246개 디렉터리·논리 크기 10,555,078,718바이트(lease retirement 전), pending 빈 디렉터리 1개를 확인했다. 링크·특수 파일은 없었으며 hardlink 파일 814개는 속성이나 내용을 변경하지 않았다. cache identity SHA와 root key가 일치한다. payload 해시는 재계산하지 않았다.
- native inventory에 현재 두 producer group은 없었다. 동일 cache 경로의 DW14 과거 삭제 기록은 현재 root가 생성되기 전에 종료한 다른 소유 generation임을 deletion attempt timestamp와 root birthtime으로 확인하고 그대로 보존했다. 기존 검증된 archive owner 절차와 supported `planCleanup`을 사용했으며 native registry JSON이나 경로 guard를 변경하지 않았다.
- `archive/EC-01-post-reboot-unknown-20261028-r1/cargo-cache-96c960bf49711cbf6327e0888542e8d56cb0687e31d690b758d6c9becaa3ca24` 및 `cargo-pending-dec40d0d0e18389b84045c74dedceb9d2df79e1c1f9890b88fdee4fd1e21895f`로 같은 볼륨에서 root rename했다. 두 원본 부재 및 dev/ino/birthtime 동일, 지원 source finalize와 registry 부재를 실제 exit 0으로 확인했다. 이동 근거는 불변 `20-reboot-archive-result.json`, 종료 정리는 `20-reboot-finalization.json`이다. archive는 사용자 지정 보존이며 향후 정리 전 정식 등록·심사가 필요하다.
- 이번 작업은 두 named root만 대상으로 했다. 별도 배포의 `engine/codex-rs/target` lease는 두 root와 다른 generation/출력 경로이므로 변경하지 않았다. 삭제·빌드·앱 재설치 없이 완료했다.
