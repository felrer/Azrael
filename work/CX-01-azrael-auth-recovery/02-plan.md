상태: 소스 구현·Windows 검증·산출물 보존 처리 완료. 제품 설치 수용은 별도 범위다.

## 목표와 범위
VS Code 업데이트 이후 Azrael 공유 엔진이 정상 종료·재시작하지 않은 이유를 기존 증거와 설치본 소스에 대조하고 시작·종료 수명 관리를 개선한다. 사용자는 제시한 해결안 1(시작 판정·복구), 2(종료 전체 예산·진단 분리)의 구현을 요청했다. 소스·설계·필수 테스트 변경과 검증용 컴파일은 승인 범위이며 제품 배포 빌드·설치·실제 사용자 프로세스 종료는 범위 밖이다. 복구 전후 사건 증거는 01-plan.md를 참조한다.

## 실행 계획과 책임

공통 Windows x64/Linux x64 glibc/macOS ARM64 동작을 수정하고 Windows에서 우선 검증한다. root는 상태 조회 프로토콜·종료 감시·snapshot 병행·설계·통합·수용을 소유한다. startup_recovery 작업자는 daemon의 준비 상태 probe·프로세스 신원에 결합한 shutdown receipt·기존 종료 경로 재사용과 단위 검사를 소유한다. verification_route 탐색자는 검사 선택만 읽었다. 작업자는 추가 위임하지 않는다.

공유 계약: private 미등록 연결의 `azrael/engine/status`가 schema/state/enginePid/instanceId/engineVersion/engineIdentity를 반환하며 lease·계정·작업을 변경하지 않는다. shutdown receipt는 해당 instance와 native process 생성 신원에 결합한다. 자연 종료 예산35초를 기다리고 살아 있는 동일 stopping 프로세스만 기존 PID 종료 경로로 정리한다. 실제 ready 응답·신원 불명·단순 probe 실패는 강제 복구 대상이 아니다. 진단 snapshot3초와 필수 정리는 병행하며 마지막 창 종료 결정부터 바깥 join까지35초 절대 예산을 둔다. 관리형 프로세스의 독립 OS 스레드가 정체 시 exit124를 집행한다. 정상 완료는 남은 진단 blocking 작업 때문에 runtime teardown에서 기다리지 않는다.

시작/종료 소스가 모두 준비되면 불변 입력을 고정하고 기존 Cargo cache를 단일 producer로 사용한다. 먼저 std 전용 watchdog subprocess 및 source guards를 검사하고, appserver/manual/bridge native 검사와 필요한 실제 프로세스 fixture를 이어간다. source 수정·테스트 준비 컴파일·실제 설치 수용은 각각 구별한다. 기존 계정·대화·수동 재개·PID 재사용 보호와 동시 시작 배제 검사를 유지한다. 산출물은 artifacts/tasks/CX-01-azrael-auth-recovery 아래 단일 run 소유로 기록하고 정리/보류를 결정한다.

## 결론
엔진이 완전히 종료된 뒤 재실행되지 않은 상황이 아니다. VS Code 업데이트가 마지막 창 종료를 유발했고 엔진은 종료 절차에 들어갔으나, 스냅샷 시작 후 종료 완료가 관찰되지 않은 채 PID가 남았다. 종료 절차에서 listener를 먼저 취소해 접속 소켓은 사라졌다. 다음 시작 요청은 PID와 실행 파일 receipt가 살아 있다는 이유로 그 endpoint를 재사용했고, 새 엔진을 만들지 않아 실패했다. 인증 유실 원인은 아니다.

## 증거 타임라인 (2026-10-22 KST)
| 시각 | 관찰 |
| --- | --- |
| 08:59:41.373 | 이전 VS Code main.log가 update#setState restarting 기록 |
| 08:59:41.780–42.245 | 이전 확장 host들이 exit code 0으로 종료 |
| 08:59:45 | 네이티브 SQLite에 last_window 사유, shutdown begin 기록. contexts=23, connections=0 |
| 08:59:45 | trees_signalled, trees=90 및 snapshot_begin 기록 |
| 09:00:13.627 | 업데이트 후 window3 Azrael.log가 app-server 프록시 시작 기록 |
| 09:01:18.178 | 프록시가 os error 2 / code 1로 종료 |
| 복구 전 조사 | 10월18일 시작된 동일 PID45928은 살아 있으나 endpoint socket 없음. 브리지 연결은 os10061로 거절됨 |
| 승인된 복구 후 | PID45928 종료 뒤 정상 native 시작·initialize·브리지·계정 RPC 성공. 인증 파일 hash 동일 |

SQLite 조회는 ts>=2026-10-21T23:59:35Z, target=codex_app_server::azrael_shared_server 조건으로 수행했다. 해당 프로세스의 관찰된 단계는 begin → trees_signalled → snapshot_begin이며 snapshot_checked, complete, shutdown timeout/failure는 관찰되지 않았다. 버퍼 유실 가능성이 있으므로 마지막 기록만으로 정확한 정지 명령을 확정하지 않는다. 23개는 보유 컨텍스트, 90개는 종료 시 수집한 작업 트리 handle 수이며 현재 실행 중인 작업 90개라는 뜻은 아니다.

## 장애 당시 코드에서 확인한 구조
- docs/architecture/azrael-runtime.md의 공용 실행기 계약은 엔진 수명을 최초 확장 host 부모와 분리한다. 따라서 VS Code 부모가 종료됐다는 사실만으로 공유 엔진 종료를 보장하지 않는다.
- 실제 설치 소스 artifacts/n10a/engine/codex-rs/app-server/src/azrael_shared_server.rs:243,522 부근은 host 신원을 주기적으로 확인하고 마지막 창이 사라진 뒤 3초 grace 후 종료한다. 이번 로그는 이 경로 진입을 확인한다.
- 같은 파일 :790에서 shutdown.cancel을 호출한 뒤 :799에서 snapshot_begin을 기록한다. app-server-transport/src/transport/unix_socket.rs:139,461 부근의 acceptor 종료/guard drop이 socket을 제거한다. 이 때문에 살아 있는 종료 중 PID와 없는 socket 조합이 가능하다.
- snapshot_begin부터 snapshot_checked 사이(:798–821)는 각 컨텍스트의 snapshot 수집과 JSON 직렬화·파일 write/sync_all/persist를 함께 포함한다. :319–329의 저장은 동기 작업이다. snapshot 수집은 thread_processor.rs:1316–1352의 순차 thread 상태·config·interrupted-turn 조회를 포함하며 전체 대화 이력을 읽는 구현은 아니다.
- final_drain에는 35초 Tokio timeout(:951)이 있지만 동기 작업은 polling 중간에 강제 중단할 수 없다. 초기 fencing/일부 저장과 바깥 lib.rs:1441–1471의 router·telemetry·acceptor join도 전체 종료 예산으로 묶여 있지 않다. 따라서 35초 제한이 전체 프로세스 종료 보장은 아니다.
- app-server-daemon/src/azrael.rs:263–275는 PID 생존과 실행 파일/receipt 일치만으로 endpoint를 반환한다. socket probe는 그 아래의 새 시작 분기에만 있다. run_azrael_stdio_proxy_with_args:476–495는 실패한 endpoint에 최대60초 재접속한 뒤 종료하고 새 backend로 교체하지 않는다.
- 계정 브리지는 connectWithRetries의 1/2/4초 재시도만 수행하며 daemon을 새로 시작하지 않는다. UI의 bridge disconnected(1)는 이 결과이며 원인을 인증 오류로 분류할 근거가 아니다.

## 확정과 미확정
확정: 업데이트 시각, 이전 host 정상 exit, 마지막 창 종료 감지, snapshot_begin까지의 종료 진행, 소켓 상실+잔류 PID, PID 기반 재사용으로 재시작 누락, 잔류 PID 제거 후 정상 시작 가능.

미확정: 스냅샷 수집 lock, 동기 직렬화/파일 저장/fsync, executor starvation 또는 이후 기록 유실 중 정확히 어느 지점이 종료를 막았는지. 관찰된 로그18.4GB 및 누적CPU만으로 이번 snapshot hang 원인을 단정할 수 없다. VS Code API 비호환이나 인증 삭제가 직접 원인이라는 증거도 없다.

## 수정 설계
1. 종료 준비·snapshot·drain·바깥 join을 포괄하는 종료 예산과 단계별 진행 증거를 마련한다. snapshot collect/persist/sync/replace 구간의 count·elapsed·bytes·고정 error kind를 분리 기록해 정지 지점을 식별한다. 비밀 값·thread 원문은 기록하지 않는다.
2. 시작 시 PID 생존과 접속 가능한 엔진을 구분한다. 종료 중이거나 endpoint가 응답하지 않는 소유 프로세스는 bounded wait 및 안전한 해당 instance 정리 경로로 처리하고, 기존 프로세스가 실제 종료되기 전 중복 엔진을 시작하지 않는다. 인증·대화·registry 보존과 미확정 RPC 재실행 금지를 유지한다.
3. Windows에서 마지막 host 종료/업데이트 재연결 중 snapshot 지연 및 닫힌 listener를 주입하고, socket 삭제뿐 아니라 전체 PID 종료·소유 child 종료·다음 창 정상 시작까지 검증한다.

### 상세 원인과 수정 설계

장애 조사는 기존 사건 기록과 설치본 frozen source를 대조했다. 사건 관찰은 Windows x64 로컬 설치본에 한정된다. 종료·시작 판정은 공통 동작이고, IPC·프로세스 신원·종료 수단은 OS별 구현이다. 구현은 공통 수명 관리 수정과 Windows 우선 검증으로 진행하며 다른 OS에서 같은 사건이나 수정 효과를 검증한 것은 아니다. 현재 허용 범위는 위 실행 계획을 따른다.

**진단 snapshot이 필수 정리의 앞을 막는다.** 현재 `request_processors/thread_processor.rs:1386`의 주석은 snapshot을 진단 메타데이터로 정의하며, 실제 대화·큐·예약 저장의 소유자는 retained tree handle이라고 명시한다. frozen source의 같은 함수(:1316)도 같다. 그런데 snapshot 수집·동기 저장을 끝내야 connection/startup drain 및 tree wait로 진행한다. 따라서 진단 작업 지연이 필수 정리의 관찰·완료를 막는 구조다. 대화 저장 자체를 생략해도 된다는 의미는 아니다.

**비동기 lock 대기만으로 장기 잔류를 설명할 수는 없다.** 수집은 thread 목록 → thread 조회 → config snapshot → interrupted turn 순서다. `core/src/session/daemon_recovery.rs:26`은 active-turn 비동기 mutex를 기다린다. 이것은 조사 후보이지 이번 deadlock 증거는 아니다. executor가 정상적으로 polling하는 비동기 대기라면 기존 35초 timeout이 작동해야 한다. 동기 직렬화·write·sync_all·persist, executor 진행 정체, 이후 로그 유실/다른 대기를 구별해야 한다. 원래 PID가 이미 종료됐으므로 정확한 대기 함수 확정에는 다음 재현의 stack/단계 증거가 필요하다.

**기존 Forced 종료 경로는 있다.** `lib.rs:1071`은 shared server 오류를 `AppServerExit::Forced`로 바꾸고 :1445는 바깥 join을 건너뛴다. `main.rs:301`은 Forced에서 runtime teardown 대신 `process::exit(0)`을 호출한다. 그 경로 도달 전의 동기 정체와 전체 예산 밖 대기를 해결해야 한다. exit code 0만으로 저장 성공을 판정하면 안 된다.

권장 구현 순서는 다음과 같다.

1. `app-server-daemon/src/azrael.rs:263`의 살아 있는 PID 분기도 private peer·등록 검증을 유지한 실제 연결 준비 상태를 확인한다. `starting / ready / stopping / failed` 의미를 구분하고 stopping은 재사용하지 않는다. 정상 시작 지연은 제한 시간 동안 재확인한다. 단 한 번의 probe 실패를 자동 종료 근거로 삼지 않는다. 시작 잠금 아래 instance·receipt·실행 파일·PID 시작 시각을 재확인한 종료 중 잔류 소유 엔진만 정리하고, 신원·상태가 불확실하면 진단과 수동 복구 경로를 제공한다. 기존 엔진 및 소유 worker 종료 확인 후 새 엔진을 시작한다.
2. `backend/pid.rs:263`의 `stop_with_grace`를 재사용·보강한다. 이 함수에는 PID 시작 시각 검증, Windows shutdown RPC, grace 후 원래 process handle 종료와 종료 관찰이 있다. :161은 explicit launch argv의 `--listen`에서 해당 instance의 shutdown socket을 선택한다. 새 범용 kill 명령보다 이 경로가 적합하다. 다만 모든 소유 child 종료까지 보장하는 증거는 아니므로 tree 정리와 결합하고 operation/PID lock 획득 순서도 확인한다.
3. 마지막 창 종료 결정부터 fencing·저장·drain·바깥 join까지 하나의 절대 종료 예산으로 관리한다. 진단 snapshot은 별도 소예산으로 실패·누락을 기록하고 필수 tree/worker 정리를 계속한다. canonical history·queue·reservation 저장과 진단 snapshot 성공 여부를 구별한다. 동기 I/O를 `spawn_blocking`으로 옮기는 것만으로는 실제 중단이 보장되지 않는다. 독립 OS thread 또는 외부 감시자가 예산 초과를 감지하고 기존 Forced 경로 및 소유 프로세스 정리를 집행하는 방안을 권장한다. 저장 실패와 미확정 도구 결과는 복구 상태로 남긴다.
4. 기존 tracing에 collect/config/active-turn/persist/sync/replace와 tree cleanup·바깥 join별 시작·완료·elapsed·count·bytes·고정 error kind를 기록한다. instance와 프로세스 시작 신원을 연결한다. 종료 결정과 예산 초과 증거를 정체된 async executor에만 의존시키지 않는다. 비밀 값·대화 원문은 제외한다. 18.4GB 로그의 용량 관리는 별도 문제이며 이번 정체의 확정 원인이 아니다.

재연결 재시도는 공식 RPC를 보내기 전 시작 구간에 한정한다. 이미 보낸 RPC를 재전송하거나 turn·큐·예약을 자동 재개하지 않는다. 재시도 시간 증가나 PID/receipt 삭제만으로 새 엔진을 시작하는 조치는 소유권·종료 문제를 해결하지 못한다.

### 수용 기준

| 시나리오 | 필수 관찰 |
| --- | --- |
| 살아 있는 PID + 정상 endpoint | 기존 엔진 재사용, 중복 시작 없음 |
| 정상 시작 지연·동시 다중 창 시작 | 제한 시간 내 등록 연결, 엔진 하나만 시작 |
| stopping PID + 사라진 listener + 즉시 새 창 | 기존 엔진·소유 child 종료 확인 후 새 엔진 연결 |
| snapshot 비동기 lock 지연·동기 persist/sync 정체 | 진단 누락 기록, 전체 종료 예산 집행, 필수 정리 상태 보존 |
| router/telemetry/acceptor join 정체 | 전체 예산 초과 관찰 및 실제 PID 종료 |
| PID 재사용·receipt 불일치·신원 불명 | 다른 프로세스 종료와 엔진 중복 실행 방지 |
| 실제 VS Code 업데이트 후 재연결 | initialize·계정 RPC 정상, 인증·대화 보존, 중단 작업 자동 재실행 없음 |

Windows native 및 실제 설치본 host 확인을 우선한다. 공통 코드 변경에는 지원 대상 Linux x64/glibc·macOS ARM64의 해당 IPC/수명 회귀도 필요하다. `scripts/check-shared-engine-native.cjs`의 appserver/manual/bridge 검사와 feature inventory의 필수 검사를 유지하고 위 failure injection을 추가한다. 기존 정상 종료 통과 기록은 이번 정체 조건을 검증한 증거가 아니다.

## 구현·검증 현황

소스 구현을 완료했다. private 읽기 전용 readiness 응답과 PID/instance/버전/hash 검증, native 생성 신원에 결합한 shutdown receipt, 자연 종료35초 대기와 PID reservation 아래 기존 stop 경로를 연결했다. 준비 확인 직후 종료되는 등록 경합은 공식 RPC 전송 전에만 다시 ensure한다. 잠금 대기와 초기 ensure·등록 재시도는 시작 예산60초를 따른다. 인증·대화 저장 경로와 공식 RPC 재전송 정책을 변경하지 않았다.

관리형 엔진에는 독립 OS 스레드 watchdog을 추가했다. 종료 결정부터 바깥 join까지 절대35초를 집행하고 OS watchdog 만료는 exit124다. 기존 async Forced 경로의 exit0은 저장 성공을 의미하지 않는다. 정상 관리형 종료는 필수 join 뒤 진단 blocking 작업을 기다리는 runtime teardown을 건너뛴다. 진단 snapshot 수집·저장은 최대3초이며 필수 tree 정리와 병행한다.

| 검사 | 결과 | 실제 exit | 로그(run 아래) |
| --- | --- | --- | --- |
| std 전용 watchdog 선행 검사 | 3개 통과, 실제 child exit124 | 0 | logs/watchdog-test.log |
| host/source 검사 | 36개 통과 | 0 | logs/shared-source.log |
| 보존 source 검사 | 최초475개 중471 통과·4 실패; 수정 후 관련70개 통과, 변경 없는 통과 결과 재사용 | 최초1, 재검사0 | logs/preservation-source.log, logs/runner-source-r2.log |
| manifest policy | 8개 통과 | 0 | logs/manifest-policy.log |
| Windows native appserver | 93개 통과, 기존 ignored2 유지 | 0 | logs/native-final-appserver.log |
| Windows native manual-resume | 7개 통과 | 0 | logs/native-final-manual.log |
| Windows native bridge | 1개 통과 | 0 | logs/native-final-bridge.log |
| Windows native startup-performance | 13개 통과 | 0 | logs/native-final-startup.log |
| 실제 프로세스 fixture | 격리된 실제 프로세스 검사24개 통과, 임시 프로필 제거 확인 | 준비·실행 모두0 | logs/fixture-compile.log, logs/process-fixture.log, reports/process-fixture/verification.json |

최종 native114개는 새 검사15개를 포함한다. watchdog subprocess는 호출 스레드가 정지해도 실제 PID가 exit124로 끝남을 확인한다. snapshot pending 수집 제한과 저장 실패의 nonfatal 처리를 검사했다. 실제 운영 fsync 정체·바깥 join 정체를 전체 설치 환경에서 재현한 것은 아니다.

실제 fixture는 동시 창의 단일 엔진·준비 상태 확인·관리 bridge·창별 격리·세대별 수명·실행 중 작업 재연결·마지막 창 종료·소유 exec child와 code-mode host 종료·수동 재개 표시·재시작 후 큐의 자동 실행 억제를 확인했다. 최종 status=passed, fixtureRemoved=true이며 artifacts/cx22r 부재를 추가 확인했다. 실제 managed account 선택, 계정 revision 연속성, populated root-resume reservation 재시작 억제는 이 fixture의 미검증 범위다.

### 고정 입력·재실행·한계

최종 입력은 artifacts/verification/cx22b, 전체 SHA256 a3fb9d46b6a952e609eae940718c4ed2fb68341131ebf82dda500f571ced1722이며 reports/final-inputs-r2.json에 기록했다. 소비 전에 후보의 기존 inventory를 확인하고 server 경로 변환 파일 한 개만 갱신한 뒤 재고정했다. 실행 중 입력은 수정하지 않았다. Rust1.95.0, Windows x64 MSVC, 기본 test profile과 단일 engine/codex-rs/target cache를 사용했다.

실행 후 전체 고정 입력이 동일하고 수정한 엔진 소스10개가 현재 작업 파일과 일치함을 확인했다(reports/input-closeout.json). 병행 작업이 공용 feature inventory에 확장 호스트 owner10개와 bridge 검증 분리를 추가한 것은 보존하며 이번 커밋에서 분리한다. 공용 파일은 frozen cx22b의 이번 변경만 부분 staging했다. 현재 공용 runner 호환 검사71개와 manifest policy8개도 exit0이다(logs/runner-integration-final.log, logs/manifest-policy-final.log). native·프로세스 검증의 신원은 변하지 않은 frozen 입력에 결합한다.

처음 source 검사4개 실패는 새 filter 두 묶음과 reviewed wrapper hash/recipe·검사 수 기대가 어긋난 것이었다. 필수 목록을 유지하고 기대를 함께 수정했다. 최초 frozen cx22a의 native wrapper는 server 타입 검사에서 AbsolutePathBuf/PathBuf 불일치(E0308)로 exit101이었다. 명시적 to_path_buf 변환 후 최종 cx22b에서 전체 네 묶음을 재검사했다. 최초 입력 SHA256은 0c5dd107e0d7f0f8ea03e1674c60a0cab1e1e1e1413d40798d3704cf2cb74aeb, 근거는 reports/project-inputs.json이다. 초기 capture helper는 destination Git metadata가 없어 ENOENT(exit1)였고 공식 freezeProject로 전환해 고정했다.

최종 native 실행은 2026-10-22T01:09:34Z→02:09:22Z(약59분48초)이며 reports/native-final-outcomes.json에 각 묶음 시작·완료·exit를 남겼다. appserver 약23분33초, manual 약25분17초의 대부분은 서로 다른 source/feature 조합의 테스트 준비 컴파일이었다. 같은 Cargo target을 쓰는 producer를 중복 실행하지 않았다.

engine-provenance.py snapshot은 SOURCE.json에 이미 반영되지 않은 schema/host-approval 등의 파일과 이번 새 파일을 발견해 exit1로 차단했다. imported inventory를 임의로 바꾸거나 제품 출처 통과를 주장하지 않는다. focused 검사는 원시 소스 bytes를 별도 고정했으며 제품 build/reuse 전에는 해당 inventory 정합화가 필요하다. 실제 제품 release/build/install, 운영 사용자 프로세스 종료, 실제 VS Code 업데이트 재현, Linux/macOS 실행 검증은 이번 Windows source 검증의 범위가 아니다.

### 실제 fixture와 산출물

실제 fixture 준비는 최종 frozen source의 azrael/bridge 두 바이너리만 대상으로 한다. 기존 code-mode 보조 실행 파일을 test helper로 별도 고정했다(SHA256 ec91f7a04dcb1a36f0e2ed87885777bf78900c2ea3295e82621c5721fd5d9f41, reports/code-host-input.json). 이 helper는 이번에 소스 빌드하거나 제품 출처를 수용한 결과가 아니다. fixture는 짧은 사전 등록 경계 artifacts/cx22r와 합성 loopback provider를 사용한다.

산출물 소유 run은 artifacts/tasks/CX-01-azrael-auth-recovery/runs/shutdown-r1이다. lifecycle id run:CX-01:shutdown-r1의 멤버는 해당 run, cx22a, cx22b, cx22r 네 경계다. native·fixture producer의 실제 종료와 소유 child 종료·프로필 제거 증거를 확인해 producer=stopped/success, exit0, membership_complete=true로 닫았다(reports/execution-closeout.json).

현재 native 관리 API는 처음부터 부재한 멤버를 등록하지 못해 이미 제거된 cx22r에서 tree entry disappeared로 첫 등록이 실패했고, unknown lifecycle group 조회로 등록이 남지 않았음을 확인했다. 제거된 프로필을 다시 만들지 않고 현존하는 세 경계를 native 불완전 그룹으로 보호 등록했다. producer 원본의 네 멤버·제거 증거는 그대로 보존한다. native review의 incomplete/membership mismatch 보호를 유지한 채 세 live 멤버와 그룹 모두 defer, remaining=true로 적용한 실제 결과를 확인했다.

재검토 조건은 지원 API로 제거된 역사 멤버의 기록을 정합화하고, imported inventory를 정합화한 다음 Windows 패키지에 동등한 독립 검증 증거를 보존한 뒤 소비 참조를 해제하는 것이다. 이 조건 전까지 정확한 고정 입력·로그·보고서를 보존한다. 검증용 프로필은 제거됐고 실제 운영 사용자 프로필과 프로세스는 변경하지 않았다.

## 장애 조사 증거의 범위

장애 조사 당시 read-only SQLite/고정 메타데이터 조회 및 source 비교 명령은 exit0이었다. 구현 전 engine의 azrael_shared_server.rs는 설치본 frozen source와 SHA-256이 같고, ensure_azrael_started_with_args 함수112줄도 동일했다. 이 비교로 구현 전 체크아웃에도 같은 종료·시작 판정 결함이 있음을 확인했다. 수정 소스의 검증은 위 결과를 따른다.

장애 당시 조사에서는 root가 업데이트/확장 로그와 시작·재연결 경로를, bridge_cause 탐색자가 종료·listener·snapshot 소스를 확인했다. 원문 로그·인증을 산출물에 복사하지 않았다.
