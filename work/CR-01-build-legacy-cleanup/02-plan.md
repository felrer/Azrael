상태: 구현 및 설치 준비 중. 사용자가 개선 구현과 사용자 프로필 설치 시도까지 승인했다. bridge/host 구현과 Windows의 관련 TypeScript 검사는 완료했으며, native 검사 연결과 새 고정 입력의 출처 검증을 준비한다.

## 목표와 현재 범위

사용자는 `azrael://threads/01a160fe-8d59-7a51-99f2-9acb5797c797`의 분석을 근거로 bridge 개선 구현과 설치 시도를 지시했다. 기존 전체 변경 반영 범위에 현재 통합 소스, 연결한 세션의 시작·종료 개선 및 이번 bridge 개선을 포함해 앱 버전 `2026.0.11`의 새 입력·릴리스 식별자로 빌드한다. 이전 고정 입력은 수정하지 않고, 새 입력을 고정한 뒤 발견되는 변경은 이번 빌드에 추가하지 않는다.

공통 대상은 Windows x64, Linux x64/glibc, macOS ARM64의 로컬 host다. 현재 장애 관찰은 Windows x64에 한정된다. 원격 실행 지원 확대, 인증·대화 삭제, 사용자 프로세스 종료는 포함하지 않는다.

## 기존 분석과의 관계

연결한 세션의 [시작·종료 수명 관리 작업](../CX-01-azrael-auth-recovery/02-plan.md)은 살아 있는 stopping PID의 잘못된 재사용, 준비 상태 확인, 전체 종료 예산과 진단 snapshot 분리를 수정·검증 중이다. 해당 파일과 native 수명 관리 구현은 그 작업이 소유한다. 이 작업은 엔진 시작·종료 경로를 중복 구현하지 않는다.

현재 w11w 수용 검사에서는 단독 실행 성공, Codex 동시 실행의 bridge 연결 실패가 확인됐다. 서버 준비보다 연결 실패가 먼저 기록됐지만, 각 연결 시도와 이전 daemon 종료 시각이 없어 동일 원인이라고 확정할 수 없다. 증거는 `artifacts/tasks/CR-01-build-legacy-cleanup/runs/release-2026-0-11-r19/reports/host-short-path-r5` 아래에 있다.

## 코드에서 확인한 개선 지점

- `extensions/azrael-ex/src/bridgeTransport.ts`는 native stderr를 모두 버리고 종료 원인을 exit code로 축약한다. 시작 단계·실제 native 실패를 연결해 진단할 수 없다.
- 같은 파일의 연결 대기 제한은 15초다. native 등록 연결은 `AZRAEL_STARTUP_TIMEOUT` 60초와 bridge 바깥 여유 5초를 사용한다. 확장이 native 연결 완료보다 먼저 bridge를 종료할 수 있다. 각 시도에 제한 시간을 다시 부여하는 구조도 전체 시작 시간을 불명확하게 만든다.
- `accountService.ts`는 연결을 단일 promise로 합치고 1/2/4초 재시도를 수행한다. 기존 `reconnectAfterEngineRestart` 경로도 있다. 이 구조를 재사용하되 엔진 소유자의 준비 상태와 연결해야 한다.
- 요청 timeout에는 일부 계정 변경의 결과 미확정을 알리지만, bridge 종료 시 pending 요청을 동일한 일반 오류로 거절한다. 변경 요청의 전송 여부와 결과 미확정을 구별할 정보가 부족하다.

## 권장 변경

1. **실패 원인 전달을 먼저 보강한다.** native bridge가 단계와 안정된 오류 코드, 재시도 가능 여부를 구조화해 전달하고 확장이 이를 보존한다. 기존 로깅 경로를 재사용한다. stderr 원문 전체 저장 대신 허용된 필드만 사용하고 크기를 제한한다. 자격증명·RPC 원문은 기록하지 않는다.
2. **준비 상태와 전체 연결 예산을 맞춘다.** 기존 엔진 소유자의 준비 완료 신호와 검증된 재시작 통지를 재사용한다. 정상 시작 중에는 제한된 시간 동안 기다리고, 신원·권한·프로토콜 오류는 즉시 구별해 보고한다. native 등록과 확장 대기는 하나의 시작 시도 예산에 맞춰 취소한다. bridge에 별도 엔진 시작·종료 책임이나 무거운 lifecycle 의존성을 추가하지 않는다.
3. **재연결과 변경 요청의 결과를 구별한다.** 기존 단일 연결 시도를 유지하고, 공식 RPC 전 연결만 안전하게 재시도한다. 전송한 변경 요청이 끊기면 결과 미확정으로 남기고 재접속 후 상태 조회로 확인한다. 계정 변경·turn·큐·예약 RPC를 자동 재전송하지 않는다. 새 instance 수용은 기존 검증된 supervisor 재시작 경로를 통해서만 한다.
4. **실패 조건을 작은 검사로 먼저 확인한다.** 지연된 준비 완료, stopping→새 엔진 전환, 동시 창, 신원 불일치, 전송 도중 단절과 구조화 오류를 기존 bridge/account/host 테스트에 추가한다. 관련 검사와 native 연결 검사를 통과한 뒤 실제 단독·Codex 동시 실행을 확인한다. 변경 없는 빌드·검사 결과와 캐시는 재사용한다.

## 소유권과 검증

host 후보 소유 파일은 `bridgeTransport.ts`, `accountService.ts`, 연결 통합이 필요한 경우 `extension.ts`와 기존 supervisor다. native 구조화 오류 후보는 `engine/codex-rs/app-server-client/src/bin/azrael-bridge.rs`다. 시작·종료 관리 변경과 공용 상태 프로토콜은 연결한 세션의 소유자와 조정하며 임의 변경하지 않는다.

기존 `extensions/azrael-ex/test/bridgeTransport.test.ts`, `accountService.test.ts`, `appServerTransport.test.ts`를 확장하고, 원격 전용 bridge의 native 연결 검사와 기존 신원·private socket 보호를 유지한다. Windows에서 실제 실패·보존을 먼저 확인하고 다른 플랫폼 실행 여부는 별도로 보고한다. 공통 계약 변경 시 accounts/runtime 설계와 feature inventory도 같은 구현 범위에서 갱신한다.

수용 기준은 실제 native 실패 단계가 비밀 정보 없이 남고, 정상 지연 중 확장이 먼저 연결을 끊지 않으며, 중복 엔진·중복 변경 요청 없이 재연결하고, 최종 실제 host 검사가 통과하는 것이다. 제안과 구현·패키지·설치 완료는 구별한다.

## 실행 현황과 다음 소비 조건

- host 담당은 네 TypeScript 구현 파일과 기존 테스트/fixture를 수정했다. 연결 시도 전체에 70초를 부여하고 native 대기는 남은 시간 안에서 최대 65초다. standalone 준비 신호는 실제 `initialize`/`initialized` handshake를 관찰한다. integrated endpoint descriptor는 준비 신호로 간주하지 않으며 native의 등록·초기화 완료를 기다린다. 계정/bridge 26개, 최종 bridge 8개, 준비/활성화 8개 검사는 각각 exit 0이다. 집계는 중복 실행을 포함하므로 합산해 고유 테스트 수로 보고하지 않는다.
- native 담당은 비밀 정보 없는 `azrael/bridgeError`와 고정 stderr 메시지를 구현했다. 기존 `remote::tests::` 필터에 가려진 새 binary `terminal_` 검사를 실행 경로와 사전 검사 recipe에 추가한다. Cargo 검증은 별도 CX 세션의 공유 target 생산자가 실제 종료하고 소유권을 해제한 뒤 실행한다.
- root는 accounts 설계와 feature inventory, 통합 판단, 입력 선택 및 설치 수용을 소유한다. 배포 준비 담당은 기존 capture/출처 기록/배포 도구를 호출하는 실행 가능한 driver만 작성한다. 준비 작업은 Cargo 소유권과 독립적으로 진행한다.
- 현재 SOURCE 기록 이후의 106개 기존 파일 변경과 30개 추가는 현재 통합 코드(프로토콜·승인·큐·묶음 관리·OAuth·빌드 범위), CX 수명 관리 및 bridge 변경이다. 새 고정 복사본에서 기존 recorder로 정확한 전체 변경 목록을 기록하고 import 감사와 engine provenance snapshot을 통과해야 제품 빌드를 시작한다. 기존 SOURCE 기록이나 이전 통과를 새 입력의 검증으로 취급하지 않는다.
- 등록된 실행 그룹은 `run:CR-01:bridge-improvement-r1`이다. 보고서와 복사한 검사 소스는 `artifacts/tasks/CR-01-build-legacy-cleanup/runs/bridge-improvement-r1` 아래에 둔다. 새 snapshot/배포/짧은 host fixture는 생성 전에 별도 소속을 등록한다. 완료 시 소비 참조를 해제하고 삭제 또는 구체적인 재검토 조건을 기록한다.

TypeScript 검사에서 복사한 fixture의 media와 `NODE_PATH` 준비 누락으로 초기 실행이 실패했으나 실제 의존성을 준비한 뒤 통과했다. 이 실행은 제품 빌드나 실제 host 수용을 대신하지 않는다. 새 native 소스로 제품을 만들고 관련·필수 검사, 계정 probe와 여섯 host 단계가 통과한 뒤 동일 패키지의 일반 사용자 프로필 설치를 시도한다. 외부 cache와 사용자 프로세스 종료는 사용하지 않는다.

## 고정 입력과 배포 실행

첫 `b12` 입력 복사는 untracked 중첩 저장소 `upstream/codex`의 독립 Git metadata를 준비하지 못해 마지막 index 단계에서 exit 1로 종료했다. 제품 컴파일은 시작되지 않았고 강제 종료도 수행하지 않았다. 같은 선택 목록을 사용한 중첩 저장소 준비와 Git root/commit 사전 확인을 추가하고 작은 실제 probe를 exit 0으로 확인한 뒤 새 `b13`으로 재시도했다. `b13` 복사는 24,590개 파일·476,211,082바이트, 365.814초이며 목록 62.646초·복사 196.945초·Git 97.335초·최종 해시 8.875초다. 후속 SOURCE 기록·import 감사·provenance 감사·배포 PowerShell parse가 모두 exit 0이다.

최종 고정 입력은 `artifacts/build/b13`, SHA256 `050b6fcc040e714acf35bdea133e25a01d62bc8a346f69f19047206da9aa5285`이다. 릴리스 `w11x`/앱 `2026.0.11`, 실제 변경 검사 범위 33개 경로와 짧은 host fixture `h21/z`(socket 103바이트)를 선택했다. 전체 회귀 검사는 선택하지 않았다. 실행 binding SHA256은 `72efae6fcd47491fdf66c78d8aa502793271e2dae4151531dc145953bc45d999`, launcher SHA256은 `d51764cb1d8cd712c7e12f4619441009a8687360da5ab8e48792e1bb37796f15`다. 고정 후의 변경은 이 입력에 포함하지 않는다.

배포 실행 work ID는 `d99b5ae0-3f27-4e0a-a240-f299bdf2e14b`, 원래 native 실행 session은 `77836`이다. bridge native 사전 검사→Windows PTY→기존 배포 본문(제품·관련/필수 검사·계정 probe·여섯 host 단계·일반 프로필 설치) 순서로 실행하며 실제 terminal 신호와 설치 receipt를 확인한다. 시작 전 공유 Cargo lease 부재를 확인했다. 보고서는 실행 그룹의 `reports/release/b13`에 보존한다.

실패한 `b12` 그룹은 실제 실패 종료와 구성 완결을 기록하고 사용 참조를 해제했다. 현재 설치된 관리 도구의 review는 여전히 `producer owner membership is not complete`로 보호한다. 명시적 보류 적용도 다른 살아 있는 engine PID 12672의 `artifacts/maintenance/maintenance.lock` 때문에 거절됐다. 보호를 우회하거나 lock을 제거하지 않았다. 새 관리 runtime의 실패 종료 처리로 갱신하고 lock 소유 작업이 끝난 뒤 fresh review로 삭제/보류를 적용해야 한다. 관련 등록·실패 종료 근거는 실행 그룹 보고서에 있다.

`w11x` 사전 검사는 bridge library 1개와 terminal binary 3개, Windows PTY 9개가 모두 exit 0이다. 첫 library 형 검사 17분 8초와 테스트 실행 파일 제작 12분 50초가 대부분을 차지했다. 한정된 cache 조사에서 현재 workspace `CARGO_HOME`과 CX 검사의 사용자 `.cargo` registry 경로 차이, 형 검사/실행 파일 프로필 및 lib/bin feature 구성 차이를 확인했다. 정확한 전체 dirty chain은 추적하지 않았으며 현재 실행은 workspace cache를 유지한다.

`w11x` 제품 배포는 외부 host fixture 등록 경계 오류로 컴파일 전에 exit 1이었다. R19에서 검증한 외부 adapter의 primary fixture 소유 경로를 재사용했고 실제 잘못된 루트의 거절/올바른 parent 소유권 확인을 작게 검증했다. 최초 완료 publisher가 신호에 허용되지 않는 필드를 포함한 오류도 확인했다. 실제 native session exit 1을 관찰한 뒤 원래 신호를 보고서에 보존하고 네 허용 필드로 정규화했다. 후속 publisher는 네 필드만 기록하며 실패 경로 검사를 통과했다.

`w11y`는 같은 고정 입력과 통과 사전 검사 근거를 재사용했으며, TypeScript 의존성을 호환하는 기존 immutable tree에서 준비했다. source hash는 전후 동일하다. 제품 컴파일 전 `verification-dependencies`에서 고정 복사본의 Bun 실행 파일 누락을 발견해 exit 1로 종료했다. 기존 source-selected dependency owner의 실제 `prepare`/`identity`를 통과시키고 새 `w11z`/`h23`으로 이어간다. 실패한 이전 version/fixture 기록은 실제 결과로 종료하고 사용이 끝난 실행 참조를 해제했다. 없는 fixture는 finalize했으며 실패 진단 로그는 유지한다.

엔진 제품 컴파일은 JS 도구 준비와 독립적으로 시작했다. work ID `148de6af-c5a1-4063-bfa7-9eaf7eaeda5b`, native session `40417`; 기존 `cargo-target-owner.cjs build --locked --no-default-features --target x86_64-pc-windows-msvc -p codex-app-server --bin azrael -p codex-app-server-client --bin azrael-bridge`와 같은 workspace cache/환경을 사용한다. 정식 builder는 이후 동일 결과를 사용하며 출처 기록·번들 제작·필수 검증·설치를 계속 수행한다. 이 컴파일의 실제 종료 전에는 같은 target에서 다른 Cargo나 전체 배포를 시작하지 않는다.

2026-10-22 03:40 UTC 확인: 제품 컴파일은 03:31:32 UTC에 시작했으며 아직 실행 중이다. 로그에는 의존 패키지 컴파일 진행이 보이고 오류 종료 신호는 없다. 병행한 R3 도구 준비는 Bun 1.4.2, provider 의존성의 실제 `pipeline.prepare`/`identity`, TypeScript 변환, Python SDK import 및 fixture 소유 경계 검사를 통과했다. 고정 소스 hash는 그대로다. 다음 배포는 `w11z`/`h23`, binding SHA256 `a676b6bcb89423beda74d88caad0fdde802293419f757118d0c743e0fc014bdd`, launcher SHA256 `b5484f10ec89711d5dabef75489ba08a41c7f1dbdaafdadd0b0e4150f91b40e2`를 사용한다. 남은 선행 조건은 제품 컴파일의 실제 성공과 Cargo lease 해제이며, 이후 필수 제품·계정·host 검사와 사용자 프로필 설치를 이어간다.

제품 Cargo 컴파일은 04:00:25.705 UTC에 exit 0으로 끝났다(03:31:32.471 시작, 28분 53.234초). 실제 native session 종료 0과 target lease 부재를 확인한 뒤, 준비된 R3 전체 배포를 시작했다. 새 work ID는 `f9b03fd1-4614-494e-b94b-4e7955c5887b`, native session `99990`이다. 제품 컴파일 성공과 최종 패키지/host/설치 수용 결과는 구별하며, 후자는 이 배포의 실제 종료 및 설치 receipt를 확인해야 한다.

R3는 환경·의존성·출처 사전 검사(exit 0)를 통과한 뒤 source-tests exit 1로 종료했다(전체 705.164초, source command 417.162초). 네 실패는 `test-namespace-cache-owner.cjs`와 `test-webview-idle.cjs`가 고정 복사본 안에서 찾는 `artifacts/upstream-ui/26.1007.21434` 파일 누락이며, 새 bridge 실패가 아니다. 테스트가 사용하는 고정 UI 입력을 ignored 영역에 소유 등록 후 준비하고, 해당 두 파일을 실제 검증한 뒤 새 `w11aa`/`h24` 배포로 이어간다. 소스 입력과 성공한 제품 컴파일 결과는 유지한다.

R3 종료 시 취소된 `changed-test-type-preparation`은 `Kill(true)` 후 `WaitForExit`와 양쪽 stream drain을 마친 기록(exit -1, terminated true)이 있다. 실제 부모 native session exit 1 및 현재 CIM의 정확한 coordinator/자식·Cargo/rustc/link 부재를 함께 확인했다. 이 근거로 전용 `recoverTargetOwner`를 사용해 해당 lease만 해제했으며 원래 Cargo 결과는 unknown/null로 보존했다. `r3-producer-closure.json`, `r3-cargo-recovery.json`, `r3-lifecycle-closure.json`에 근거가 있다. 실패 version은 failure/1로 종료하고 사용이 끝난 temporary/fixture 참조를 해제했으며, 실제로 없는 h23/account fixture 등록은 finalize했다.

R4 준비는 정확한 UI 입력의 소유 등록과 hardlink 준비 후 `node --test scripts/test-namespace-cache-owner.cjs scripts/test-webview-idle.cjs` 23/23, exit 0을 확인했다. 첫 한정 probe에서 발견한 별도 `app-initial` asset도 포함해 검사했고, 최종 소스 해시는 그대로다. `w11aa`/`h24`, binding SHA256 `62b49eb5225f9df4d3e1c35595a3f30f854b9459b71eabf8a99386e588eaa586`, launcher SHA256 `a02622d9d073ef7bff170349b93b13b4c6f88d300c056cfd14b27d3e45ce9207`를 검토하고 실행했다. work ID `a7cd964d-2831-4d7f-8935-d63667802e0f`, native session `60736`이며, 실제 최종 검증·설치 결과는 아직 대기 중이다.

R4는 04:18:08 UTC에 시작했다. 출처 사전 검사는 208.024초, 변경 범위 소스 테스트는 414.362초로 각각 exit 0이다. 병행한 Rust 테스트 타입 준비는 13개 recipe 전부 exit 0, 2,695.774초(44분 55.774초), 05:06:42 UTC에 끝났다. 첫 11개 완료 후 큐 통합 테스트를 위한 별도 구성 준비가 남았으며, 제품 컴파일과 다른 테스트 타입 구성의 비용이다. 이후 정식 build 단계로 진입했다. 겹친 실행 시간은 합산 총시간으로 취급하지 않는다.

R4의 정식 build도 exit 0, 427.394초로 05:14:00 UTC에 완료했다. 이어진 prepare가 0.903초 만에 `TypeScriptPath must name companion/node_modules/typescript/lib/typescript.js in a build staging directory`로 실패했고, 병행 시작한 engine-preservation은 취소(-1, 0.972초)됐다. CLI에 primary 확장의 TypeScript를 명시한 운영 입력 오류이며, 정상 경로는 새 build-info의 `moduleBuild.typeScriptPath`다. 해당 prepare 경계 코드 그대로의 검사도 exit 0을 확인했다. 완료된 source/type/build를 반복하지 않고 원래 `w11aa` 결과물과 소스를 고정해 나머지를 재개한다.

정확한 원래 config/환경으로 최종 engine-preservation을 다시 시작했다(work `b851bdbd-db2d-471e-8531-8d687604d808`, native session `34201`, `reports/native-resume-*`). 독립적인 prepare도 build-info의 staging TypeScript 경로만 고쳐 병행했다(work `7d7ace05-c7d5-46b7-a532-76e530feeea3`, native session `91385`, `reports/prepare-resume-*`). 원래 prepare가 남긴 package는 경로·실제 경로·일반 디렉터리·빈 내용 확인 후 `rmdirSync` 일반 삭제하고 부재를 확인했다. 가짜 resume checkpoint는 만들지 않았다. 두 실제 성공과 native receipt 검증 이후 계정 probe·여섯 host 검사·일반 사용자 프로필 설치를 이어간다.

중복 fixture 소유 등록을 피하기 위해 원래 h24/account ID를 유지했다. R4에서 해당 단계가 시작되지 않았고 출력도 없음을 확인해 failure/1로 종료한 뒤 기존 lifecycle의 새 generation `w11aa-cont1`을 등록했다. primary `run:verification:w11aa` revision 7과 selected `run:account-controls:w11aa` revision 4는 pending/incomplete 상태다. 원래 실패 근거는 `r4-fixture-continuation.json`에 보존했고 version 기록의 실패 결과는 아직 변경하지 않았다.

첫 별도 native 재개는 22초 만에 개별 검사 없이 `Source preflight input identity is stale`로 종료했다. sourceInputs를 좁혀 비교한 결과 다른 필드는 모두 같고 `executionEnvironment`만 달랐다. 재개 launcher가 원래 PowerShell 경계와 environment-preflight의 검증된 환경 patch를 재현하지 않은 원인이다. 원래 PS7 경계와 저장된 patch를 사용하도록 운영 launcher를 고쳤으며, 무거운 검사 전에 `sourceExecutionIdentity`로 expected/actual `02550002aff8d46c8771dd0573aa202c2d094a1ce67ffb3f080f07e793693a73` 일치를 실제 확인했다(`native-environment-match-r2.json`). 새 native work는 `0cf23512-0b7c-4983-83b6-7f452182e81f`, native session `8992`, 보고서 prefix는 `native-resume-r2`다.

병행 prepare는 05:24:49.849 UTC에 exit 0으로 끝났고 native session `91385`도 exit 0으로 관찰했다. 실제 설치 패키지는 원래 `w11aa` package 경로이며 Codex 환경 snapshot은 validated/applied false다. 계정·host·설치용 continuation은 원래 source/type/build의 실제 성공, 각 로그 hash, 모든 build-info payload SHA, prepared package SHA, native의 실제 통과 receipt를 검증한 뒤 남은 단계를 수행하도록 준비했다. 아직 최종 native와 host/설치 수용은 완료되지 않았다.

## 승인된 검사 묶음 정리

사용자는 검사별 조건·비용·책임 항목을 늘리는 방식을 거절하고 기능 묶음 단위의 유지·삭제를 지시했다. 기본 엔진 검사 강제 선택, 전체 Rust 테스트 사전 타입 검사 단계 및 사용이 끝난 배포 재시도 작업물을 영구 삭제하도록 승인했다. 구현 범위는 현재 체크아웃의 배포 선택기·전용 준비 단계·이를 강제하던 테스트와 관련 문서다. 실행 중인 b13 고정 입력과 그 소비 자료는 변경하지 않는다. 공통 동작 변경이며 실제 회귀 확인은 Windows에서 수행한다.

기존 feature inventory를 재사용해 shared-engine 수명 관리, bridge, startup/history 성능, manual resume을 분리했다. 기본 선택은 변경된 기능 묶음이고 명시적인 `EngineFeatureId` 선택을 허용한다. 미등록 native 변경을 모든 엔진 검사로 확대하는 fallback도 제거하며 미해결 범위로 알린다. 별도의 검사별 관리 장부는 만들지 않는다. Cargo 결과 캐시가 계속 사용하는 공용 recipe는 유지하고 bulk planner·준비 실행 API와 전용 테스트만 제거한다. 단일 작업자가 배포/준비 코드와 테스트를 소유하며 root는 inventory·문서·생성물 정리·통합 검증을 소유한다.

실패한 b12 등록 묶음의 현재 삭제 검토를 `project_cleanup_review` registered 모드로 요청했다. 기존 등록 정보를 재사용하며 별도의 전수 조사/재등록은 하지 않았다. 도구 응답과 실제 삭제 결과가 아직 필요하다. 활성 root 실행 묶음 및 w11aa가 소비하는 출처·통과 기록·패키지는 해당 소비가 끝난 뒤 전체 묶음으로 정리한다.

### 검사 묶음 정리와 b12 삭제 (2026-10-22)

고정 baseline·광범위 fallback 및 전체 Rust 사전 타입 준비 단계를 제거하고 planner/preparation 전용 테스트 13개를 삭제했다. 기존 inventory에서 bridge, 시작 성능, 수동 재개를 분리했다. 실제 selector에서 각각 독립 선택되고 문서 변경은 빈 선택임을 확인했다(exit 0).
Windows 검증: preflight/recipe 19개, 배포 fixture 10개, Cargo cache gate 19개, preservation 8개 통과. Python PATH 누락 실패는 설치된 Python313 경로를 지정한 재실행에서 해결했다. 증거는 reports/pipeline-simplification 아래에 있다. Linux/macOS는 미검증이다.

b12는 이전 엔진이 실패 종료 기록을 인식하지 못해 보류됐다. 사용자 재지시에 따라 기존 artifact-lifecycle 소유자 정리 절차로 종료/참조 없음을 확인했다. 첫 일반 삭제는 숨김 .git 디렉터리에서 실패했고, Directory|Hidden 속성을 확인해 Hidden만 해제한 후 삭제했다. exit 0, status deleted, remaining [], lifecycle finalized 및 실제 경로 부재를 확인했다. 476,240,055 bytes 묶음 정리 완료. 실패 기록은 capture-b12-terminal.json에 보존했다. 삭제 증거는 cleanup-b12-owner-final.json과 속성 기록이다.

### 검사 범위 재시작

사용자가 이전 검사를 중단하고 새 범위로 재시작하도록 지시했다. 기존 r2 세션8992는 사라지고 receipt만 running이었다. 전체 CIM 목록에서 coordinator/children, runner/proxy, b13 명령, compiler/linker, target 검사 실행파일 부재를 확인했다. native-r2-interruption-evidence.json을 근거로 정확한 stale lease를 복구했고 결과 unknown/null은 유지했다. work completion은 cancelled 처리했다.
기존 R4 changedPaths를 새 selector에 적용한 결과 engine.bridge, engine.shared-engine, engine.task-profile-skills가 선택됐다. 시작 성능/수동 재개/고정 baseline은 제외했다. b13 제품 입력은 그대로 유지하고 별도로 고정한 현재 manifest를 API runner에 전달했다. native-only phase를 지원하지 않아 선택된 묶음의 source+native 검사를 실행한다. account 및 6개 host gate는 유지한다.
재시작 work: da315cc0-46b5-4abe-b19c-fda39f1d94cb, session95291, reports/release/b13/native-restart.

### 생성 묶음의 숨김 .git 정리 보완

엔진에는 ReadOnly/Hidden 처리가 있지만 artifact-lifecycle.ps1 기본 경로에는 없었다. 사용자가 영구 수정을 승인했다. Windows 생성/보호 확인된 묶음에 속성 정규화를 적용하고 경로별 전후 값을 기록한다. System/reparse 및 원본 속성을 바꿀 수 있는 하드링크 정규화는 차단한다. 속성 변경이 필요 없는 하드링크는 일반 삭제를 허용한다. 기존 tool.project-maintenance owner/check 연결을 재사용한다. 변경은 primary checkout에 한정하며 실행 중인 b13에는 추가하지 않는다.

최종 검증: PowerShell 7 cleanup suite 44개 통과, exit 0, 57.119초. 숨김 .git/읽기 전용 하위 파일 삭제, 속성 변경이 필요한 하드링크 거부, 정상 하드링크 삭제 후 원본 보존, 보호 항목/연결 경로 거부를 확인했다. fixture는 suite 종료 시 정리됐다. 로그: reports/pipeline-simplification/attribute-cleanup-hardlink-tests.log.

### 축소 검사 완료 및 설치 전 재시도

세 기능 묶음 native-restart success/exit0. 새 대화 세션의 CODEX_SESSION_ID/THREAD_ID를 원래 값으로 복원해 기존 환경 해시 일치를 확인했다. 계정 검사와 native receipt 검증 exit0. Host standalone은 h24/z 소켓 경로109bytes로 SUN_LEN 오류. 제품 재빌드 없이 짧은 artifacts/h25/z fixture에서 같은 패키지의6개 host stage 재시도 중. 실패 기록은 보존하고 설치는 아직 수행하지 않았다.

### 승인된 소켓 내부 경로 단축

사용자 승인: app-server-control→ipc, 파일명은96비트를 보존하는 소문자Base32 20자리, .sock 유지. 프로젝트 디렉터리명 변경은 보류한다. 공통 Windows/Linux/macOS 소스 변경이며 실제 검증 환경은 따로 기록한다. 현재 b13 패키지와 실행중 host 검사 입력을 수정하지 않는다. Rust 구현/관련 테스트 담당 short_socket_paths, root는 호스트 경로 사전검사·feature inventory·소유 문서 및 통합 검증 담당.

소켓 경로 변경 검증: 실제 인코딩 함수 추출 Rust test1/1 exit0, Cargo locked/offline metadata exit0, rustfmt exit0. Windows 사전검사5개 exit0(영문/한글107허용108거부 및 생성전 거부). 기존96비트와 전체ID 유지, 예시109→90bytes 확인. 전체 crate 컴파일·새 엔진 시작·Linux/macOS 실행은 미검증이며 후속 빌드에서 확인한다. 임시 Rust 실행파일·라이브러리·하네스는 일반 삭제 후 부재 확인했다.

### 사용자 프로필 설치 완료

2026-10-22 17:46:37 KST, 기존 고정 b13/w11aa의 2026.0.11 설치가 완료됐다. 계정 검사 exit0, 짧은 fixture h25에서 host6단계 exit0, 설치 receipt installed-reload-required/hostInstalled=true/version2026.0.11 확인. VS Code를 강제 종료하거나 재실행하지 않았으며 재시작이 필요하다. 설치증거 reports/release/b13/install-final/verified.json. 완료signal의 불필요한 completedUtc필드로 관찰이 거부되어 terminal원본을 보존하고 signal4필드 형식을 바로잡았다. 신규 소켓 경로 변경커밋 e2baf9a3은 이 기존패키지에 미포함.

h24/h25 검사결과는 reports/host-fixture-retirement.json에 독립적으로 보존하고 실행프로세스 부재를 확인했다. 두 producer의 실제 성공/실패 종료 상태를 기록하고 종료된 root소비참조를 해제한 뒤 기존 소유자 정리 절차로 일반 삭제 중이다.

호스트 임시 묶음 h24/h25 정리 완료: 기존 소유자 정리 절차 exit0, 두 그룹 deleted/finalized 및 실제 경로 부재 확인. 결과 reports/host-fixture-cleanup.json. 설치 및 검증 증거는 root 작업 보고서에 보존했다.
