상태: 버전별 공유 엔진 공존 소스 구현·Windows x64 검증·임시 산출물 정리 완료. 이번 최초 전환은 전체 VS Code 창을 함께 적용하고 이후 버전부터 공존한다. 제품 전체 빌드·설치·실행 중 창 종료는 이 구현 단계에서 실행하지 않는다.

# 2026.0.9 시작 실패 진단

사용자 요청은 스크린샷의 빈 로딩 화면과 `azrael account management disabled: bridge disconnect...` 원인 분석이다. Windows 11 x64 일반 VS Code 사용자 프로필만 관찰했다. Linux/macOS로 결론을 확대하지 않는다.

## 확인된 원인

일반 프로필 확장 등록은 2026.0.9이고 설치 runtime은 n9h/w09h-r2를 선택한다. window5의 Azrael.log:1945 스택이 실제 2026.0.9 확장 로드를 확인한다. 2026-10-17 12:20:14.387 KST, Azrael.log:1953에서 다른 바이너리 또는 시작 설정의 기존 공유 엔진이 실행 중이라 전환을 거부했다. 1954에서 새 app-server가 exit1로 종료했으며 이후 stdin destroyed/process not available이 반복된다.

기존 공유 daemon PID32256은 w31b(2026.0.8) 경로를 사용한다. 다른 기존 창들의 connector/bridge도 w31b를 사용한다. 새 n9h 엔진은 조사 시 실행 목록에 없었다. 이전 azrael.exe SHA c607a510dde1d114feff206369a93d7d4132cae7068f90b4b211d29cb97e73a4, 신규 SHA18d01e31d46b1ec6df6f32d2cfbd43327f5c145b0cee7b78a3245c89bfe78f7a로 실제 다르다.

app-server-daemon/src/azrael.rs:169는 실행 파일 identity와 endpoint/native argv receipt가 모두 일치해야 기존 daemon을 재사용한다. 하나의 상태 홈에 서로 다른 엔진이 붙어 계정/대화 상태를 공유하지 못하게 하는 보호 동작이다. bridgeTransport.ts:49는 bridge 종료를 일반 disconnected 오류로 표시하고 stderr는 버리므로 화면 메시지가 근본 원인을 설명하지 못한다. 채팅과 계정 연결 모두 공유 엔진 시작 거부의 영향을 받는다.

## 영향과 검증 공백

패키지 손상·계정 데이터 손실을 입증하는 증거는 없다. 새 상태의 여섯 host 단계 통과는 기존 w31b daemon이 살아 있는 실제 프로필에서의 버전 전환 수용을 증명하지 않는다. 기존 안내인 한 창 Developer: Reload Window만으로는 다른 창이 유지하는 daemon을 교체하지 못한다. 기존 설치 안내를 정정해야 한다. chatSessionsProvider proposal 경고도 있으나 info로 처리되며 직접적인 종료 원인은 위 identity 거부 로그다.

## 권장 조치

작업을 저장하고 모든 Azrael 사용 창의 작업을 끝낸 뒤, 관련 창을 정상 종료하고 새 버전으로 다시 열어야 한다. 일반적인 VS Code 전체 종료 후 재실행이 가장 명확하지만 사용자 수행 사항이다. 상태 파일/소켓 삭제나 강제 kill로 우회하지 않는다. 사용 중인 대화가 있어 지금 재시작을 강행하지 않는다.

제품 개선 제안은 기존 엔진과 새 엔진의 불일치를 설치/활성화 시 미리 표시하고, 단순 로딩 화면 대신 모든 Azrael 창의 정상 재시작 필요 안내를 제공하는 것이다. 기존 daemon이 살아 있는 업그레이드 시나리오를 검증에 추가한다. 자동 전환·종료나 코드 수정은 이번 분석 요청으로 실행하지 않는다.

## 근거

C:/Users/felre/AppData/Roaming/Code/logs/20261016T010404/window5/exthost/azrael-ex-local.azrael/Azrael.log:1953
engine/codex-rs/app-server-daemon/src/azrael.rs:169
extensions/azrael-ex/src/bridgeTransport.ts:49


## 후속 검토: 창이 선택한 버전별 엔진 공존

사용자는 구현이 아닌 가능성 검토를 요청했다. 현재 공통 계약은 OS 사용자+상태 홈당 하나의 실행기다. 변경안은 OS 사용자+정규화된 상태 홈+불변 실행 파일/빌드 identity+시작 설정+프로토콜 호환 단위로 공용 실행기를 나누는 것이다. 같은 릴리스의 여러 창은 기존처럼 공유하고, 다른 릴리스는 별도 실행기에 연결하는 안을 권장한다. 표시 버전 문자열만으로 구분하면 같은 2026.0.9의 다른 빌드가 충돌하므로 실제 identity가 필요하다. UI와 bridge도 창이 로드한 릴리스에 고정한다. 현재 executable identity는 내용과 canonical path digest를 함께 포함한다(managed_install.rs:198).

필수 변경은 (1) daemon socket/PID/시작 lock/receipt/log를 instance별 경로로 분리, (2) azrael_shared_server.rs:497의 단일 window-owners.json과 context 종료를 instance별로 분리, (3) 홈 전체의 대화 실행 소유권·재개·정리 admission은 프로세스 간 조정, (4) 공통 계정/설정/DB migration 및 이전 버전 reader/writer 호환 admission, (5) 마지막 창 종료가 해당 실행기 소유 작업에만 적용되도록 확인, (6) Window Use 실제 입력·공용 자원 및 유지 중 릴리스의 삭제 방지다. Windows 짧은 socket 경로/사용자 peer검증, Unix 권한/peer검증은 유지해야 한다. 구현 의미는 공통이며 Windows x64부터 검증하고 Linux/macOS 수용은 별도다.

재사용 근거: rollout/src/writer_lock.rs:21/44는 홈 기준 thread별 cross-process file try_lock을 사용한다. login/src/auth/azrael_unmanaged.rs:259는 cross-process credential transaction을 가진다. core/src/azrael_manual_resume.rs:60은 파일 read/modify/replace lock을 가진다. state/src/runtime/root_resume.rs는 revision+state 조건부 update를 사용한다. 이 장치의 존재가 임의 버전 공존 검증을 의미하지 않는다. state/src/sqlite.rs의 여러 DB와 migrations는 홈 공통이고 자동 초기화되므로 SQLite 파일 잠금만으로 schema/semantic 호환성을 보장할 수 없다. 홈 전체 window-owners는 instance 분리와 별개로 thread engine 소유권 조회가 필요하다. 다른 엔진이 실행 중인 대화는 자동 중복 resume하지 않고 해당 소유 엔진으로 연결하거나 명시적으로 대기시킨다. 실행 중 작업을 새 버전으로 자동 이동시키지 않는다.

옵션 비교: 창마다 독립 엔진은 가능하지만 창 수만큼 기본 엔진 비용과 관리 부담이 증가하고 공유 상태 문제는 남는다. 릴리스별 공유 엔진은 현재 메모리 절약 구조를 유지하면서 업그레이드 공존을 지원한다. CODEX_HOME 전체를 버전별 복제하는 방법은 계정/기록/설정이 갈라지고 병합 문제가 생겨 기본안으로 권장하지 않는다. 장기적으로 호환이 끊기는 저장소에는 데이터 서비스나 별도 상태 홈과 명시적 마이그레이션이 필요할 수 있으나 현재 코드로 필요 범위를 확정하지 않는다.

기존 2026.0.8을 무수정으로 남긴 첫 전환은 별도 수용 대상이다. 신버전에 instance namespace만 추가해도 이전 버전은 홈 전체 기록을 계속 쓰므로 이미 설치된 구버전과의 무조건적 공존을 보장하지 않는다. 현재 데이터 형식과 소유권 경계의 좁은 호환 실험 후 지원 범위를 정해야 한다.

필수 향후 검증: 서로 다른 릴리스+같은 홈 두 창 동시 시작; 같은 릴리스 두 창의 엔진 공유; 동일 대화 동시 입력 거부/올바른 소유 엔진 재연결; 버전별 마지막 창 종료/강제 종료·복구; 계정 갱신·삭제/설정 변경의 일관성; 예약 중복 실행 방지; migration 불일치 차단; Window Use 입력 권한과 전역 자원 충돌; 사용 중 구버전 패키지 보존. 이번 검토에서는 실제 공존 실행이나 사용자 상태 변경을 하지 않았다.


## 승인된 구현 및 검증 범위

사용자가 권장 구조 수정을 승인했다. 첫 protocol2 배포는 모든 창을 함께 전환하므로 protocol1 기존 2026.0.8과의 무수정 공존은 요구하지 않는다. 이후에는 릴리스/설정별 엔진을 분리한다. 실제 앱 전체 빌드와 설치는 별도 요청 시 기존 빌드 절차로 진행하며 현재 작업은 소스 구현과 필요한 테스트 컴파일이다. 상태 홈과 계정/대화 데이터를 복제하지 않는다. 보호 gate를 제거하지 않는다.

root는 공유 계약·통합·문서·source provenance·immutable native test 입력과 Cargo target owner·최종 수용을 담당한다. host owner는 protocol2 descriptor discovery와 activation ordering, native namespace owner는 실제 engine/config fingerprint와 daemon/registry scope 및 대화 cross-process lease, storage owner는 임베디드 migration+비SQL storage ABI manifest와 호환 lease를 담당한다. 별도 read-only owner가 예약/큐 소유 경계를 확인한다. 후속 작업의 전제는 native descriptor API와 startup 설정 정규화이며 이 계약을 먼저 고정했다. 공통 OS 의미, 실제 Windows x64 검증, 다른 OS 미검증을 구분한다.

호환 정책은 참여 중인 protocol2 daemon의 embedded migration manifest와 명시 non-SQL ABI가 동일할 때 동시 허용하는 보수적 gate다. 기존 SQLite ignore_missing 정책은 변경하지 않으며 모든 과거/미래 schema의 양방향 호환을 주장하지 않는다. 다른 manifest가 활성 상태면 config/DB 초기화 이전에 거부하고, 활성 엔진이 없을 때는 기존 native migration 검증으로 전환한다. 기존 protocol1 live endpoint는 최초 coordinated upgrade 안내로 거부한다.

검증은 (1) protocol2 host source fixtures, (2) daemon endpoint/configpartition/storagelease filesystem unit tests, (3) 공유 server/thread admission tests, (4) 같은 홈+다른 실제 실행 파일 generation의 동시 native 엔진/계정 read-only handshake/대화 중복 admission/한쪽종료다른쪽유지 fixture로 한다. 실제 모델 요청·계정 로그인·사용자창 강제종료 없이 task-owned 새 상태만 사용한다. 기존 공유 엔진 native 생명주기·컨텍스트 재연결·마지막창 종료 필수 gate를 보존한다. source-only 캐시 조회나 컴파일 성공을 native 실행 통과로 승격하지 않는다.


## 통합 검증 진행

호스트 discovery/activation/검증기 source 검사 27개가 exit0으로 통과했다 (`artifacts/tasks/release-engine-coexistence/host-r1/integrated-source-r3.log`). 추가 fixture guard 54개 중 기존 테스트가 일반 native 필터를 6개로 고정해 둔 한 항목이 실패했다. 새 공존 필터 4개를 포함한 10개를 확인하고 필터별 포함 여부도 검사하도록 수정했다. 영향받는 cargo guard 재실행은 exit0 (`cargo-guards-r5.log`), 나머지 guard는 원래 실행에서 통과했다. 복구/준비 상태 검사도 exit0 (`recovery-preparation-r6.log`). Native 실행 통과를 뜻하지 않는다.

최초 source recorder dispatch는 사용자 중단 후 terminal evidence를 잃었고 receipt는 변경되지 않았다. 원래 producer가 없고 출력/receipt가 그대로임을 확인한 뒤 새 실행을 시작했다. 기존 실행의 exit code는 unknown으로 보존한다. 새 실행은 2026-10-17 13:04:48 KST 시작했으며 원본·현재 import 전체의 반복 검증을 수행 중이다. 복사 준비는 13:10:09–13:13:03 KST였고, 파일별 source/copy/source 해시 대조 후 SOURCE.json을 제외한 engine과 검증 scripts를 고정했다. 최종 source receipt를 검증한 후에만 이 복사본에서 컴파일한다. 이후 primary 수정은 해당 복사본에 반영하지 않는다.

Native 대상은 같은 Windows x64 host의 task-owned 새 상태 홈이며 Cargo jobs=1과 기존 target owner를 사용한다. 먼저 실제 CLI/bridge/code-mode host를 테스트 준비용으로 컴파일하고 공유 엔진 appserver·manual-resume 필수 필터와 기존 extended 생명주기/관리 bridge 검사에 새 세대 공존 검사를 연결한다. 결과와 실제 exit는 `native-r1/native-results.json`, 상세 stdout/stderr와 fixture 검증 결과는 같은 run 아래에 보관한다. 테스트 준비 컴파일은 배포 빌드·설치가 아니다.


원본 기록 재시도는 exit0, 13:04:48–13:17:50 KST(13분 2초), 고정 복사본 provenance는 exit0, 13:18:18–13:20:42 KST(2분 24초)였다. 고정 SOURCE SHA256은 bf2459272481ce30aca30b95e84540d664181ebc40a48144b64973096178c1f0이다. 최초 native 테스트 준비 컴파일은 13:20:42–13:42:38 KST(21분 56초), exit101로 종료했다. V8 v150.4.0의 Windows prebuilt archive 다운로드 실패가 직접 원인이다. root가 기존 Windows 빌드의 external code-mode host 입력을 재사용하지 않고 불필요하게 host 소스 컴파일을 추가한 준비 오류였다. 새 테스트를 줄이거나 코드를 우회하지 않고 기존 scripts/build-azrael.ps1의 host 외부 입력 방식으로 수정했다.

재시도 native-r2는 같은 고정 소스와 기존 Cargo cache를 사용한다. 이미 설치 수용된 w09h-r2의 azrael-code-mode-host.exe를 원래 provenance와 SHA ec91f7a04dcb1a36f0e2ed87885777bf78900c2ea3295e82621c5721fd5d9f41에 대조하고 run 소유 복사본으로 고정했다. 변경한 엔진·bridge만 컴파일하며 실제 code-mode child 검증은 그대로 실행한다. r2는 r1의 고정 입력을 소비하므로 두 lifecycle을 연결했고, 완료 전에는 소스 복사본을 정리하지 않는다. r1 실패와 exit101은 보존한다.


Source 검사 수용 범위는 중복을 제외해 414개다: 초기 통합 27개, fixture guard 54개(실패한 한 항목을 포함한 cargo guard 34개는 수정 후 재통과), 복구/준비 상태 333개. 첫 통합 native fixture를 실행하기 전에 검증기의 ROOT가 고정 scripts 위치 기준임도 확인했다. 현재 r2 runner가 설정한 외부 결과 경로는 그 containment 검사에서 거부되므로, 컴파일·unit 결과는 재사용하고 실제 통합 실행은 고정 입력 루트 아래 artifacts 소유 결과 경로에서 별도로 수행해야 한다. 이미 실행 중인 runner 입력은 바꾸지 않는다. 이 경로 수정은 제품 코드나 검증 범위의 변경이 아니다.


r2 컴파일은 13:44:09–14:01:24 KST, exit101이었다. 새 storage lease의 anyhow 오류를 app-server의 IoResult로 바로 `?` 처리한 root 통합 오류(E0277)를 발견했다. 기존 함수와 같은 std::io::Error::other 변환을 적용하고 storage의 불필요한 Write import도 제거했다. r1/r2 모든 producer 종료 후 이전 수정 파일과 SOURCE bytes를 r3/prior-input에 남기고 동일 compiler 경로를 새로운 입력 revision native-r3로 넘겼다. 변경 전 실행 입력을 성공으로 덮어쓰지 않는다. source 기록 갱신은 새 실행으로 진행한다. 최종 provenance 전에 수행한 진단용 엔진·bridge 컴파일은 14:03:15–14:06:00 KST, exit0이었다. 이 결과는 최종 수용이 아니며 갱신된 고정 입력의 provenance 이후 실제 최종 명령과 모든 필수 테스트를 다시 실행한다. 테스트 harness 컴파일은 source 기록과 독립적으로 먼저 준비하며, 최종 실행은 그 producer의 실제 종료까지 기다린다.

남은 protocol1 참조 조사에서 공통 패키지 생성기 build-platform.cjs의 runtime manifest와 resource 측정 fixture가 구형 protocol/PID 경로를 사용함을 발견했다. runtime protocol은 2로, resource fixture는 같은 시작 args의 native endpoint discovery와 scoped PID/receipt로 변경했다. build-platform의 기존 artifact lifecycle와 project-maintenance 동작은 바꾸지 않고 manifest의 해당 값 한 곳만 변경했다. 관련 platform/resource source 검사는 exit0 (`host-r1/platform-resource-r8.log`, 최종 resource 재검사 `resource-final-r9.log`)이다. source provenance의 root/escape 보호 네 검사도 exit0 (`provenance-root-guards-r7.log`). 최종 Windows 실행에는 기존 shared-only resource fixture도 포함해 수정한 경로를 실제 확인한다. 다른 OS의 실제 실행 수용은 여전히 미검증이다.

Window Use occupancy는 릴리스별 daemon registry가 아니라 OS 사용자 공통 .azrael-ex/window-use/occupancy 기록을 사용하며 advisory 모델이다. 생성물 자원 관리도 별도 admission.lock을 사용한다. 이 작업에서 해당 경로·입력 정책을 변경하지 않으며, 사용자 앱에 실제 입력을 보내는 범용 다중 엔진 충돌 시험을 수행했다고 주장하지 않는다.


r3 수정 source 기록은 14:02:59–14:06:40 KST exit0, 수정 고정 복사본 provenance는 14:06:41–14:07:54 KST exit0이었다. SOURCE SHA는 652a3dd4194651db7064fdb1442dad568c54706592532f75471293057f3370ca, 최종 engine 입력 inventory SHA는 48591bc7cdddd504c27ad4bd0bebd9e36cdef3aae1f0416e93d3466afc78e449이다.

테스트 harness 준비는 14:07:25–15:05:18 KST, 7대상 모두 exit0이었다. core libtest 18분6초, app-server libtest 15분56초, CLI libtest 2분20초, daemon libtest 10분27초, PTY 14초, install-context 3초, queue service 10분46초였다. 대상마다 dev dependency/feature 구성이 달라 core와 관련 라이브러리가 다시 컴파일됐다. jobs1로 같은 cache owner를 순차 사용했으며 이 구간은 직렬 벽시간 약57분53초다. 추가 고정-input 확인 뒤 최종 engine/bridge 명령은 15:05:18–15:05:47 KST exit0, 필수 appserver native gate 15:05:47–15:07:24 exit0, manual-resume gate 15:07:24–15:07:54 exit0이었다. 준비용 컴파일 통과와 실제 선택 테스트 실행 통과를 구분한다.

추가 resource fixture는 15:07:54–15:08:04 exit1: 실제 native scope가 쓰는 azrael.pid/azrael.stderr.log를 검사기가 daemon.pid/daemon.stderr.log로 가정한 오류였다. scope id는 실제 생성된 디렉터리와 일치했다. 두 thread 시작은 성공했고 PID를 못 찾아 종료 대기 전에 정리를 시도하면서 아직 남은 socket reparse 경계에 의해 안전하게 정리가 중지됐다. 실제 receipt와 executable SHA, native argv, PID·시작 신원을 확인한 뒤 모든 소유 프로세스 종료 및 reparse 해제를 확인하고 기존 receipted cleanup을 재실행해 임시 root br-af693259를 삭제했다. `cleanup-recovery.json`에 실제 성공을 남겼다. 강제 삭제나 reparse 우회는 하지 않았다.

검사기만 실제 파일명으로 수정하고 source guard를 재통과했다 (`native-receipt-names-r10.log`, `fixture-final-r11.log`). r4는 이미 통과한 r3 engine source·스크립트 inventory와 native gate/바이너리 identity를 확인해 재사용하며, 새로 고정한 검사기에서 resource와 extended 공존 fixture를 실행한다. 모든 실패 실행의 실제 exit와 원인은 유지한다. 이 수정으로 native engine 소스를 다시 빌드하거나 이미 통과한 테스트를 중복 실행하지 않는다.


## 최종 수용 근거

2026-10-17 Windows 11 x64에서 r4 resource 검사는 15:11:41–15:12:03 KST exit0, extended 공존 검사는 15:12:03–15:13:11 KST exit0이었다. 최종 wrapper 종료는 15:13:12 KST exit0이다. 실행 전 r3의 engine·script inventory가 기록된 고정 입력과 동일함을 확인했고, 실행 전후 세 바이너리 및 선택된 r4 검사기 SHA가 일치했다. 공존 fixture 26개 검사가 통과했고 두 fixture 모두 소유 프로세스 종료와 상태 폴더 삭제를 확인했다.

확인한 새 계약은 동일 릴리스의 여러 창이 한 detached daemon을 공유함, 같은 홈의 별도 실제 canonical release 경로가 별도 살아 있는 daemon을 선택함, 계정·설정의 read-only 관리 bridge 연속성, 다른 엔진의 같은 대화 resume 거부, 첫 세대의 마지막 창 종료가 두 번째 세대를 유지함, 두 번째 세대도 자신의 마지막 실제 host 뒤 독립 종료함이다. 실제 분리 경로의 두 실행 파일은 같은 bytes의 task-owned 복사본이다. 서로 다른 파일 SHA 및 시작 설정 partition은 native 단위 검사로 별도 확인했다. 두 다른 제품 버전을 실제 설치한 시험으로 확대하지 않는다.

기존 회귀에서는 transport reload/실제 host 죽음 뒤 실행·대화 소유권과 승인 replay, 다른 창의 승인 응답 거부, 실제 matching code-mode host와 nonce로 식별한 exec 자식의 마지막 창 종료, 열린 관리 bridge가 daemon을 유지하지 않음, manual-resume marker 및 채워진 queue의 재시작 후 자동 실행 억제와 명시 입력 재개를 확인했다. 실제 관리 계정 선택과 채워진 root-resume reservation의 재시작 억제는 이 fixture에서 미검증이며, 실제 사용자 인증을 변경하지 않았다. Linux/macOS 실행·실제 사용자 창·Window Use 입력의 다중 엔진 동시성 시험 및 제품 전체 설치는 수행하지 않았다. root-resume/queue의 기존 writer lock 및 loaded-thread 경계는 앞선 코드 검토와 선택 native gate 근거로 보존한다.

최종 테스트 바이너리 identity(배포 산출물 아님):

- azrael.exe: c285b4182f0f9a5d4911bd8d41aea7c2a5d5d80c66e5a5cede8c8bc14b30e2ab
- azrael-bridge.exe: 4e5addaf23e94466339408f827e83f99a1d97eb2b8a1678ea85a7cf0989eb7c3
- 외부 code-mode host: ec91f7a04dcb1a36f0e2ed87885777bf78900c2ea3295e82621c5721fd5d9f41

실패한 source dispatch는 unknown, V8 준비/오류 타입 컴파일은 exit101, PID 이름을 잘못 가정한 resource 검사는 exit1로 이 문서에 유지한다. 최종 성공으로 이전 실패를 바꾸지 않았다. 임시 바이너리·입력 복사본·실패/성공 profile·원시 로그는 이 독립 수용 기록과 소스/기존 유지 테스트로 필요한 근거를 보존했으므로 run 소유권·참조·프로세스 경계 확인 후 정리한다. 기존 primary Cargo cache는 여러 작업이 공유하는 재생성 cache이므로 이번 task payload로 삭제하지 않는다. 사용자 설치본·바로 이전 복구 릴리스·계정/대화 홈은 보존한다.


## 정리 및 변경 분리

host-r1, native-r1~r4의 5개 전체 lifecycle에 대해 현재 토큰으로 삭제를 명시 결정했다. native 그룹의 payload를 로그/증거보다 먼저 삭제하도록 disjoint 최상위 항목으로 등록했고, 모든 항목에서 실제 deleted/remaining=false를 확인했다. 비어 있는 소유 폴더도 일반 rmdir로 제거했으며, 완료된 producer metadata는 소비자부터 역순으로 finalize했다. 강제 삭제·권한/소유권 변경·속성 강제 우회 없이 완료됐고 native 보고의 attributeChanges는 0이었다. artifacts/tasks/release-engine-coexistence, artifacts/ec1~ec4/ec4r 및 이전 br-af693259 임시 profile의 실제 부재를 확인했다. 위에 기록된 raw log 경로들은 이 정리로 제거됐으며, 재검증 절차와 필수 검사는 소스에 유지한다. shared primary Cargo cache와 source 기록에 필요한 기존 원본 import baseline은 공유 소비자가 있으므로 유지한다.

최종 작업 단위에는 이번 소유 코드·테스트·owner 문서·feature engine.shared-engine 변경과 이 기록만 포함한다. engine/SOURCE.json과 scripts/azrael-feature-contracts.json은 HEAD에서 이번 소유 부분만 반영한 index projection을 만들었고, SOURCE localIntegration의 정합성과 소유 engine 11개 파일의 실제 staged Git bytes/SHA를 확인했다. 별도 BW-01의 5개 engine 변경 및 model-harness 문서/검사/기록은 그대로 working tree에 남기며 포함하지 않는다. 실행 검증 입력에는 당시 선택된 해당 working bytes가 포함됐고 그 전체 고정 SHA는 위에 기록했으며, 분리된 commit 자체를 별도 pristine 빌드했다고 주장하지 않는다. 제품 버전·설치 등록·실행 중인 기존 사용자 창을 변경하지 않았다.
