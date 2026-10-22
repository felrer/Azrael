상태: 소스 구현·Windows focused 검증·전용 산출물 정리 완료. 실제 설치 창과 다른 OS 수용은 미검증이며 전체 제품 빌드·설치는 수행하지 않았다.

# 새 버전 창에서 연 세션의 안전한 버전 전환

## 목표·권한·범위
앞으로 전환 protocol을 지원하는 새 버전들 사이에서, 새 버전 VS Code 창으로 연 세션만 전환 대상으로 지정한다. 실행 중에는 원래 엔진에 연결하고 안전한 시점에 최신 엔진으로 이관한다. 다른 세션·프로젝트의 실행·계정·승인을 유지한다. 2026.0.10/.11 등 기존 배포 버전 지원과 최초 적용을 위한 우회 구현은 범위 밖이다. 제품 코드·소유 설계·관련 검증 변경은 승인되었으며, 검증에 필요한 focused compilation만 수행한다. 전체 배포 빌드·설치·외부 공개는 포함하지 않는다.

공통 동작은 Windows x64, Linux x64, macOS ARM64 로컬 엔진에 해당한다. Windows x64에서 고정한 r5 입력의 focused native 검증을 수행했다. 다른 OS 실행과 Remote SSH·컨테이너는 검증하지 않았다. 기존 CY 세션 성능 조사와 다른 버전 혼재/소유권 문제다.

## 확정된 사용자 요구
- 전역 엔진 일괄 전환을 하지 않는다.
- 새 버전 창에서 명시적으로 연 세션의 원래 소유 컨텍스트만 전환 대상으로 한다. 같은 프로젝트의 다른 세션을 일괄 이관하지 않는다.
- 다른 프로젝트가 사용하는 구버전 엔진은 계속 실행한다.
- 프로젝트 경로 일치만으로 다른 창의 작업·승인을 가져오지 않는다.
- 임의 시점 Reload를 허용한다. 종료 직전 hook에 의존하지 않고 평상시 저장한 소유 관계와 재접속 시 엔진 확인을 사용한다.
- 실행 중 작업은 원래 엔진에서 유지하고 안전한 시점에 이관한다. 그동안 UI 버전과 대상 세션의 실제 엔진 버전이 다를 수 있다.
- 이미 배포된 버전에 전환 기능을 소급 지원하지 않는다. 앞으로의 버전들이 공통 전환 protocol을 제공하도록 설계한다.

## 조사 근거
- 배포 b13/w11aa/build-info.json은 artifacts/build/b13/engine을 원본으로 기록한다. 이전 분석에서 그 소스 azrael_thread_engines.rs:72~117의 잠금 충돌 오류와 사용자 화면 문구가 일치함을 확인했다. 실제 충돌 소유 PID·전체 타임라인은 미확인이다.
- 현재 개발 원본은 engine/이다. azrael_shared_server.rs의 SavedRegistry는 owners와 thread→context를 기록하고 Owner는 workspaceId, 창 계정 경로, context를 가진다. registry는 instance별로 격리된다.
- scripts/shared-engine-host.cjs:94 windowContext는 VS Code storage 경로의 digest를 workspaceId로, sessionId의 digest를 ownerId로 사용한다. 실제 프로젝트 cwd만으로 식별하지 않는다. 단일 폴더·multi-root·빈 창 차이를 유지해야 한다. Reload 전후 sessionId 연속성은 실행 확인이 필요하다.
- Registry::select_thread는 같은 엔진에서 기존 창이 사라진 뒤 새 창이 같은 workspace의 원래 processor context에 재결합하는 기능이다. 기존 context에 live 창이 있거나 새 context에 이미 작업이 있으면 거부한다. 모든 companion/UI alias를 같이 옮긴다. tests.rs의 fresh_same_workspace_rejoin_moves_all_aliases 등이 이를 검사하지만 이번에 실행하지는 않았다.
- 다른 엔진끼리는 이 registry를 공유하지 않는다. Registration::validate와 shared-engine-host의 descriptor 검사는 버전과 실행 파일 hash의 정확한 일치를 요구한다. 저장 ABI가 같다는 것만으로 새 UI·bridge와 구엔진의 RPC 호환을 증명할 수 없다.
- 통합 activation은 하나의 runtime socket/windowContext를 채팅·계정 경로에 제공한다. 대화 resume만 우회하면 companion·계정·승인 연결이 어긋날 수 있다.
- ThreadEngineLeases는 process-lifetime 파일 잠금이고 대화별 반환 API가 없다. 현재 registry에는 다른 엔진으로 context를 내보내는 transaction이 없다.
- ThreadManager::request_agent_tree_shutdown은 같은 local runtime의 세션을 fencing하고 종료를 기다리는 재사용 지점이다. 주석상 top-level load/resume 직렬화는 호출자가 추가해야 한다. shutdown은 실행 중 모델 스트림·도구 프로세스의 무중단 이동 기능이 아니다.
- 마지막 창이 사라진 엔진은 RECONNECT_GRACE 3초 후 종료 판단을 한다. Reload 동안 작업을 유지하려면 다른 창 유무에 의존하지 않는, 명시적인 시간 제한 전환 연결을 설계해야 한다. 무기한 생존으로 바꾸지 않는다.

## 추천 구현
### 1. 대상 컨텍스트 식별과 전환 기록
창 등록·세션 소유권 확정·변경 때 instanceId·workspaceId·원래 context/owner·세션 ID를 지속적으로 저장한다. 새 버전 창에서 세션을 열면 그 세션에 한정된 전환 요청을 만들고 workspace 저장소와 원래 소유 관계를 대조한다. Reload 직전 저장이나 명시적 Reload 감지에 의존하지 않는다. 디스크 registry만 보고 권한을 취득하지 않고 private peer 검증과 원래 엔진의 확인을 거친다. 같은 workspace의 다른 live 창과 충돌하면 자동 취득하지 않는다. 하위 agent는 기존 local runtime 소유 관계로 포함하고 cwd 검색으로 수집하지 않는다.

### 2. 실행 중 작업은 해당 context에 재연결
다른 세션·프로젝트는 건드리지 않고 대상 세션의 채팅·계정·승인·알림을 원래 processor context에 연결한다. exact version/hash 검증을 단순 삭제하지 않고 엔진 신원·저장 ABI·전환 protocol/RPC capability를 검증한다. 새 버전들에 이 계약을 함께 도입한다. 현재 activation은 창 단위 runtime 하나를 사용하므로 세션별 라우팅 또는 연결 분리 설계가 필요하다. context 전체 alias 이동을 그대로 적용해 다른 세션까지 옮기지 않는다. 후보 엔진을 찾는 것이 그 엔진 사용 권한은 아니다.

### 3. 새 엔진으로의 이관
대상 세션의 현재 작업과 연결된 실행 자원이 안전해지는 경계를 기다린다. 이관 경계에서는 해당 세션의 신규 실행·resume과 큐·예약 admission을 fencing한다. 큐·예약은 삭제하지 않고 저장해 새 엔진이 이어받는다. 저장과 대상 writer 종료가 확인된 뒤 해당 thread lease만 반환한다. 새 엔진이 lease 취득과 세션 컨텍스트 연결·revision 검증을 완료해야 연결을 확정한다. 결과 불명·저장 실패·동시 요청은 중복 실행을 막고 재조회한다. 다른 세션의 writer·lease나 엔진 프로세스를 종료하지 않는다. 하위 agent와 자원을 공유한다면 안전 판정에 그 관계를 포함하되 이관 대상 확대를 임의로 수행하지 않는다. 모델 요청·도구를 다른 프로세스로 실행 중 이동시키지 않는다.

### 4. 앞으로의 버전 간 계약
전환 protocol을 도입한 버전들 사이의 호환 capability·저장 ABI·엔진 신원을 확인한다. 같은 protocol 범위에서도 기능·저장 형식이 호환되지 않으면 자동 이관을 강행하지 않는다. 기존 2026.0.10/.11의 endpoint 지원 조사나 호환 우회는 수행하지 않는다.

## 합의된 동작과 실행 경계
새 버전 창에서 연 세션만 원래 엔진의 실행에 연결하고 안전한 시점에 최신 엔진으로 이관한다. 다른 세션·프로젝트는 유지한다. 미래 버전 간 계약이 대상이며 기존 배포 버전 지원은 제외한다. 세션별 stdio proxy 라우팅과 private session attach/handoff를 사용하고 context 전체 alias 이동을 재사용하지 않는다. 같은 세션의 다른 구독자가 있으면 이관을 기다린다. 대기 입력·예약이 남은 상태를 안전하게 이관할 수 없으면 삭제하거나 강제로 중단하지 않고 원래 엔진에서 유지한다. 이는 새 엔진에서 새 turn을 재실행하는 기능이 아니다.

## 변경 소유자와 순서
1. `session_proxy`는 app-server-daemon의 stdio proxy와 session_handoff를 소유한다. thread/resume으로 선택한 세션만 원래 엔진으로 연결하고 callback ID를 엔진별로 구분한다. 일반 management bridge는 선택한 엔진을 유지한다.
2. `core_handoff`는 core/protocol의 submission gate, 안전 상태 확인, 취소 없는 admission seal과 writer 종료를 소유한다. false는 실행을 유지하는 Busy이며 true는 저장·종료가 확인된 상태다.
3. `server_handoff`는 app-server의 private attach/handoff, 세션별 구독·RPC fence, 설정 snapshot과 target 복원, durable transfer receipt를 소유한다. 1/2의 계약을 연결하되 다른 세션의 컨텍스트를 옮기지 않는다.
4. 부모는 thread lease의 소유 엔진 descriptor·선택적 반환, 설계 문서·feature inventory·검증 wrapper, frozen input·검증 실행·통합 수용을 소유한다. descriptor는 발견용이며 실제 파일 잠금과 인증된 peer가 소유권을 결정한다.

기존 checkout의 병행 변경을 보존한다. 설치·실제 사용자 상태·외부 서비스는 변경하지 않는다. source 입출력은 범위별로 고정하고 native compilation은 관련 owner의 준비 완료 뒤 시작한다. 기존 `engine/codex-rs/target` cache는 다른 검증 producer가 점유 중이므로 중복 Cargo를 시작하지 않는다.

## 수용 기준·검증
- 지원하는 이전/최신 버전 엔진이 공존할 때 A 프로젝트의 세션 하나를 새 버전 창에서 열면 그 세션만 연결·이관하고 A의 다른 세션과 B 프로젝트의 instance/context/turn·계정·이벤트를 유지한다.
- 같은 프로젝트 두 live 창, 다른 workspace, multi-root와 빈 창, reload 전후 ownerId 변화, companion 동시 연결을 구분.
- 진행 중 추론·도구·승인·자식·큐·예약 각각의 상태 보존과 새 turn/도구 중복 실행 없음.
- 마지막 창의 느린 Reload, 동시 Reload, 원래 엔진 종료·충돌, 저장 실패, 응답 유실과 이관 중 crash를 검증.
- 미래 버전 사이의 호환·비호환 UI/bridge/engine, 저장 ABI 및 전환 capability 불일치 처리를 각각 검증. 기존 배포 버전과의 전환은 수용 대상이 아니다.
- 기존 host/registry fixture와 native 다중 엔진 검증을 확장하고 Windows 실제 VS Code 두 프로젝트 acceptance를 수행한다. Linux/macOS 공통 코드 적용과 실제 수용은 별도 보고한다.

## 실행과 검증 근거
- 구현은 사용자 승인 뒤 시작했으며, 일시 중단 때 제품 코드는 변경하지 않은 상태로 조사자 두 명을 중단했다. `continue` 지시 후 원래 범위로 재개했다. 현재 source 단계는 구현 중이며 product/installed acceptance는 아직 없다.
- 2026-10-22 20:07 KST 기준 proxy·core의 초기 source가 준비되었고 서버 설정 복원·통합과 검증 준비가 진행 중이다. Cargo cache는 세션 성능 실험의 producer가 점유하고 있어 공유 cache에서 별도 producer를 시작하지 않았다. 재실행은 아직 없다.
- 단일 소유 검증 묶음은 `DA-01-session-handoff-r1`, 실제 경로는 `artifacts/verification/da1/`이다. snapshot·격리 temporary·로그·보고서를 생성 전에 같은 lifecycle로 등록했다.
- `node --test scripts/test-shared-engine-host.cjs scripts/test-integrated-entry.cjs scripts/test-recovery-state.cjs`: 331 passed, 0 failed, exit 0. 로그는 `artifacts/verification/da1/logs/host-source.log`이며 약 15초 소요했다. 새 native 경로와 실제 VS Code 전환을 검증한 결과는 아니다.
- Cargo preflight/feature inventory source 회귀가 진행 중이다. 새 proxy/core/server native 검사와 최종 생성물 정리·잔여 환경 수용은 아직 남아 있다.

- 검증 갱신: 새 handoff recipe 테스트는 exit 0 (1 passed)이며 `artifacts/verification/da1/logs/handoff-recipes.log`에 보관했다. Cargo/toolchain 준비 확인은 source의 pinned Cargo 1.95.0으로 성공했다.
- Cargo preflight/verification/feature-preservation 묶음 재실행은 exit 1 (72 passed, 4 failed)이다. 로그는 `artifacts/verification/da1/logs/verification-contracts-r2.log`. 남은 4개는 기존 model-harness wrapper/recipe/test 기대값 불일치이며 이번 shared-engine 변경과 별도다. 전체 검증 통과로 간주하지 않는다.
- 네이티브 입력 r1은 10,830 files, SHA256 `ddb033fdb7410c943c16e72681ad57eea912f7eb72cbaae172e86fe8aea80504`이다. 서버 복원 오류 격리와 콜백 소유권 테스트를 반영한 r2는 같은 파일 수이며 SHA256 `81e22e12a2183a18f8ed6492d4f9bc7cbf7056100c615d3aebd2b1525144d770`이다. r2는 검증한 r1과 서버 소유 3개 파일의 변경분으로 구성했다. 각 inventory는 `artifacts/verification/da1/reports/engine-r{1,2}.json`에 보관한다.
- daemon 라우터는 별도 `artifacts/verification/da1/target-daemon`에서 Windows x64, pinned Cargo 1.95.0, locked/offline, jobs=2로 native 검증 중이다. 공용 target은 다른 작업의 검증이 연속 사용 중이다. 코어 시도는 소유권 경합으로 Cargo 시작 전에 exit 1로 차단됐으며 `logs/core-native-r1.log`에 기록했다. 다른 producer를 중단하거나 잠금을 제거하지 않았다. 전체 배포 빌드는 수행하지 않는다.
- 추가 source 검증 `shared-engine verification|shared guidance` 2개는 exit 0이며 `logs/handoff-selection.log`에 기록했다. 실제 VS Code 다중 창 수용과 Linux/macOS 실행 검증은 아직 없다.
- 첫 daemon native 타입 검사는 2026-10-22 11:19:22 UTC에 시작해 987,151ms 후 exit 101로 종료했다. 첫 원인은 `core/src/tasks/mod.rs:308`의 비공개 `Session.state` 직접 접근(E0616)이며 실제 테스트는 실행되지 않았다. 코어 소유자가 같은 잠금 순서를 유지하는 Session 내부 메서드로 수정했다. 라우터가 transport를 통해 코어 전체에 의존하므로 예상보다 첫 컴파일 범위가 컸다.
- r2는 실행 전에 준비 상태를 철회하고 코어 수정·live subscriber 권한 보호·busy 재접속을 반영했다. 종전 r2는 사용되지 않았으며 해당 inventory는 `engine-r2-unconsumed.json`에 보존했다. 실행용 최종 SHA256은 `af19e5efdbadf595ed44ff15d37c5854be325a68d509816b76a7abaa2debe130`이다. 이후 입력을 변경하지 않고 코어·daemon·서버 타입 검사를 먼저 실행하고, 모두 통과한 뒤 선택 테스트를 실행한다.
- 소스 검증 묶음 재확인 r3도 exit 1 (72 passed, 기존 4 failed)이었다. 실패 범위는 r2와 동일한 model-harness recipe/기대값 불일치다. `logs/verification-contracts-r3.log`에 보존했다.
- r2 코어 타입 검사는 기존 프로필 테스트 두 곳의 private `HarnessProfiles::from_templates` 호출(E0624)로 exit 101이었다. 현재 checkout에는 이 두 테스트가 공개 `HarnessProfiles::load` API를 사용하도록 이미 수정돼 있어, 제품 코드를 추가로 바꾸지 않고 해당 두 파일을 실행 전 r3에 반영했다. daemon 테스트 타입 검사는 exit 0이다. 서버 타입 검사 종료를 기다리며, r2 오류 때문에 r2 실제 테스트 단계는 진행하지 않는다.
- 동시 attach와 후속 원래 창의 resume 경합은 세션별 scope claim으로 직렬화했다. 다른 세션은 차단하지 않는다. 이를 포함한 최종 r3는 10,830 files, SHA256 `0dc73f3ec36e551fcecea98e54827cf2bffbb646be9d4a9a72f640da9e360638`이다. 미사용 r3 초기 inventory는 `engine-r3-unconsumed.json`, 실행용 inventory는 `engine-r3.json`에 둔다.
- r2 최종 결과는 core 타입 검사 exit 101(기존 테스트 private API), daemon 타입 검사 exit 0, app-server 타입 검사 exit 101(새 코드의 private `environment` import)이다. 실제 테스트는 실행하지 않았다. 공개 경로 `codex_protocol::protocol`로 수정한 후 r3 실행용 최종 SHA256은 `68dabcee8407cc9534bc8dc4dbcb612510b9bb398d00043f02fef583c36c1412`이다. r3 코어 테스트 타입 검사는 exit 0으로 통과했다.
- 기존 loaded-thread resume는 유휴 상태에서 UI 설정이 다르면 일반 Shutdown으로 재생성할 수 있다. source scope의 resume는 threadId·excludeTurns·initialTurnsPage만 남겨 이 경로를 막는다. target snapshot은 원래 Computer Use ceiling도 명시한다. 이 서버 소유 3개 파일을 반영한 r4는 10,830 files, SHA256 `f86c56eab11ed9eea75ba17a2cac104f2c2086a1e9f2ce6a9c7745d380e40e39`이며 아직 실행하지 않았다. source·모델 기본값에 의한 원래 작업 취소를 허용하지 않는다.
- 실행 세션 `36194`의 r3 native 종료 관찰과 첫 원인 정리는 기존 `core_handoff` 소유자에게 넘겼다. 새 Cargo를 시작하거나 입력을 수정하지 않는다. root의 다음 작업은 실제 종료 결과를 확인한 뒤 같은 전용 cache에서 `native-server-r4.cjs`를 실행하는 것이다. 아직 build/install·실제 VS Code 수용·생성물 정리·작업 커밋은 하지 않았다.

- r3 terminal exit101: core/daemon typechecks passed; server E0507 on borrowed reasoning_effort fixed with clone. Child could not access root exec session36194; root observed its actual termination.
- r4 frozen input revised before first execution: SHA256 `8b7c4e473d8565fbc6a6efff9ae7897a381d39b82625132a15324c707279dcd1`. All3 package typechecks passed. Core9/10 passed; idle fixture had no retained ThreadManager. Corrected only test fixture to retain actual managed thread and check the causal writer error. First core code generation took34m06s; tests5.42s. Remaining proxy/server40 tests passed.
- Final r5:10,830 files, SHA256 `ffdd313635c820528e8862bccafc0390cb5b9b63f8369ca13809881ec66e4685`. Only corrected core fixture differs from r4. All3 typechecks passed; core10, proxy10, snapshot7, leases5 passed. Shared-server17/18 passed on first run; existing diagnostic snapshot test returned0 snapshots instead of1. Exact storage-vs-timeout branch was not observed. Same immutable input, no source changes, full mandatory preflight: shared-server18/18 passed on retry(exit0,0.17s). Failure remains recorded.
- Source contract suite:71/76 passed(exit1). Existing model-harness wrapper/hash/count expectations account for4 failures; concurrently changed task-recovery expected4 calls vs actual8 accounts for1. Own handoff recipe passed. These unrelated gates were not weakened or edited.
- Independent evidence, commands, exit codes, source identity and limitations are preserved in [02-verification.json](02-verification.json) before generated artifact cleanup. Other tasks changed the checkout during frozen verification; receipts bind r5, not unrelated later changes. Installed VS Code two-project acceptance and Linux/macOS execution remain unverified. Product build/install/publish was not performed.

- Owned artifact cleanup completed: native registered review had no blockers; native apply returned group/item deleted and remaining=false. Independent absence check passed; producer metadata finalized. The66,002,326,676 logical-byte dedicated group is removed. Physical reclaimed-byte count was not supplied. Current-source handoff recipe test passed(exit0); scoped CRLF-aware whitespace and wrapper syntax checks passed. See [03-cleanup.json](03-cleanup.json). Earlier raw-log paths are historical; canonical retained evidence is02-verification.json.
