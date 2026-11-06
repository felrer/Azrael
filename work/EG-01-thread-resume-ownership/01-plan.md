상태: 소스 개선·필수 Windows 네이티브 검증·임시 생성물 정리 완료. 다른 작업과 섞인 공유 provenance 때문에 커밋은 보류했다. 현재 설치·실제 스레드 소유권은 변경하지 않았다.

# 2026.0.13 기존 스레드 재개 실패 조사

## 목표와 권한

- 대상: `01a1334d-6a69-7821-a164-da04f3cfa71f`의 재개 실패 원인 규명. 데이터 손상 가설 대신 엔진 소유권과 attach/handoff를 조사한다.
- 허용: 다음 버전의 재발 방지 소스·관련 설계·보존 inventory 갱신, 필요한 격리 테스트와 컴파일, 작업 단위 커밋·생성물 정리.
- 제외: 제품 배포본 생성·설치·게시, 사용자 프로세스 종료, 실제 lease/lock/소유권 해제, 실제 스레드 재개·도구 재실행.
- 관측 환경: Windows x64 로컬 VS Code에서 2026.0.12/2026.0.13 동시 실행. 다른 OS 실행은 미검증이다.
- root가 조사 근거를 이어서 proxy 경로·writer admission 판정·명시적 재시도를 수정한다. 공통 Windows/Linux/macOS 코드이며 Windows x64 네이티브 회귀를 실행한다. 타 OS 실행과 다음 배포본 설치 수용은 구분한다.

## 승인된 구현과 수용 기준

### 현재 수용 결과

- `run:eg01:handoff-r1/r2/r3` 임시 묶음 세 개를 검증된 standalone owner로 등록·검토·삭제하고 실제 경로 부재와 lifecycle finalize를 확인했다. 측정된 논리 크기 합계는 587,693,339 bytes이며 물리 회수량은 미측정이다. 마지막 정리는 2026-10-29 00:09:41 KST에 끝났다. 실제 항목별 결과·보호 검토·종료 코드는 `06-cleanup-acceptance.json`에 보존한다. r2 등록 실패의 두 예약은 정확한 종료 근거로 지원되는 복구 절차를 거쳤으며 원래 실패 결과를 바꾸지 않았다. `04-cleanup.json`, `05-registration-recovery.json`은 그 당시 복구 근거이고 현재 정리 상태는 `06-cleanup-acceptance.json`이 소유한다.
- 사용자의 빌드 금지 요청 이후 추가 컴파일·빌드·패키징·설치는 실행하지 않았다. 기존 공유 Cargo cache는 이번 작업의 일회성 생성물로 주장하지 않고 유지했다. 보존된 작업 문서와 요약 영수증은 구현·수용·예약 복구의 독립 근거다.

- 총 50개 통과: daemon 10, core 10, app-server session handoff 7, thread-engine 5, shared-server 18. 각 범위의 typecheck·0개 방지 selection·실행 actual exit 0. daemon은 소스 바이트가 동일한 r2 증거를 재사용했고 나머지는 r3에서 실행했다. r3는 14:02:46.910Z~14:38:29.489Z, actual exit 0, 2142.579초다. 상세 소스 identity·명령·종료 코드는 `02-verification.json`, `03-acceptance.json`에 보존한다.
- 사전 metadata read 경로 일치, 살아 있는 stale 주소/lease 부재에서의 권위 있는 취득, 명시적 resume 재시도, 실행 중 source 보호·busy 제어권 보존·다른 스레드 격리·미확정 요청 비재실행을 검증했다. 기존 영구 테스트를 확장한 회귀 계약이므로 유지한다.
- scoped whitespace check actual exit 0. daemon source SHA `c0f564cc9e22a1444dfaec7f420b228e06506f5bb6c869245ff668ad8dbcdd54`와 SOURCE의 files/localIntegration 양쪽 기록이 일치한다.
- Linux/macOS 실행과 실제 다음 버전 바이너리·설치 전환은 미검증이며 배포 권한 범위 밖이다. .13 wire/저장 ABI 변경 없이 선택 엔진 proxy에서 처리하므로 구버전 source 수정은 필요 없다. 실제 사용자 스레드와 실행 엔진을 조작하지 않았다.
- 작업 커밋은 보류한다. 시작부터 수정돼 있던 공유 `engine/SOURCE.json`에 다른 작업의 대규모 통합 provenance가 포함되고, architecture에도 동시 작업 변경이 있다. 전체 파일을 함께 커밋하면 다른 작업이 섞이며 SOURCE를 제외하면 변경 소스의 출처가 불완전해지므로, 통합 소유자가 다른 작업과 provenance를 함께 수용한 뒤 커밋해야 한다.

- thread/resume만이 아니라 첫 thread 요청부터 기존 연결 선택을 재사용한다. read로 연결된 source의 자동 handoff는 명시적 resume 이후에만 허용한다.
- 기존 admission lock의 안전한 읽기·비차단 shared lock 관측을 재사용한다. 소유자가 없으면 살아 있는 과거 주소에도 붙지 않고 선택 엔진의 실제 배타 lease 취득으로 진행한다. 파일·프로토콜·저장 ABI를 변경하지 않아 .13→다음 버전에도 적용한다. 오류·점유 상태를 lease 부재로 취급하지 않는다.
- 명시적 resume만 실패 route를 새로 판정한다. 기존 송신·미확정·거부된 변경 요청은 재실행하지 않고, 미응답 callback은 새 transport를 요구한다. handshake 원인은 고정 allowlist 분류로 보존한다.
- 기존 `session_handoff::tests`의 WebSocket·dead locator 사례를 확장해 살아 있는 source/실제 lock 유지/사전 read, 살아 있지만 lease가 없는 source/사전 read/선택 엔진 resume, 명시적 재시도와 미송신 mutation 보호를 검증한다. 재발 위험이 높은 동시성·프로토콜 경계의 영구 회귀이므로 유지한다.
- 보존 feature는 기존 `engine.shared-engine`이며 구현 owner와 필수 `engine.shared-engine.session-handoff` 검사가 이미 연결되어 있다. owning architecture의 선택 세션 버전 전환 항목을 갱신한다.
- 기존 테스트 runner, 표준 File lock API, 원래 소유권 취득·fallback·tombstone·callback 경계를 재사용한다. 새 의존성/새 실행 루프를 추가하지 않는다.

## 확인된 증거

1. 첫 오류는 2026-10-28 22:05:01.870 KST의 `source session attach failed: private session handshake rejected`다. 원본: `%APPDATA%/Code/logs/20261028T151142/window5/exthost/azrael-ex-local.azrael/Azrael.log:483`. 직전 hydration의 `metadata_ready`는 85.6ms, `runtime_resume_started`는 153.8ms다(:487).
2. 발견 레코드 `~/.azrael-ex/azrael-thread-engines-v1/<thread>.engine.json`은 instance `72abfef1…`/engine SHA `8015338b…`를 가리키며 마지막 수정은 2026-10-26 08:30:55 KST다. 파일 자체는 실행 소유권이 아니다.
3. Windows Restart Manager의 조회 전용 API로 정확한 `<thread>.lock` 파일의 사용 프로세스를 조회했다. 반환은 PID 30136 하나이며 2026.0.13 공유 엔진이다. 이전 공유 엔진 PID 25484는 목록에 없었다. API start/register/get-list/end 모두 성공(첫 list는 필요 크기 반환 234, 두 번째는 0). 이 API는 열린 파일 사용자를 보여주므로 그 자체를 byte-range lock 조회라고 표현하지 않는다.
4. 두 엔진에 등록·초기화·attach 없이 `azrael/engine/status`만 조회했다. 이전 PID 25484와 새 PID 30136 모두 ready/protocol 1, 실제 engineIdentity와 descriptor 일치, storageCompatibility는 발견 레코드와 정확히 같다. 조회 명령 actual exit 0. 따라서 현재 관측은 엔진 미기동·저장 호환성 불일치를 지지하지 않는다. 배포 host 설정의 shared protocol 2와 session handoff protocol 1은 별개다.
5. 두 엔진의 영속 window registry에는 같은 스레드 mapping이 있다. 이는 과거 컨텍스트 기록이며 실제 lease의 중복 증거가 아니다.
6. 설치된 .13 build-info의 engine SHA는 `af057294…`다. 원본 입력은 정리됐으나 보존된 `artifacts/app-releases/2026.0.13-ec01-r1/provenance/sources/r3-selected-source.zip`에서 관련 소스를 추출 없이 읽어 현재 코드와 바이트 동일성을 확인했다. `session_handoff.rs` SHA `26a59c723b343bd68dccfb15e6cc4b86e60a4bf7a2e3beed702ba19b8e43eb52`, `azrael_shared_server.rs` SHA `255453a8f799139a658a1df1b1ffd7976c5ec64c06fd9fefed9fcba6ebdb5670`. 이전 .12 receipt의 `artifacts/inputs/dm01-w13r/project/engine`에서도 이 두 파일, `azrael_session_handoff.rs`, `azrael_thread_engines.rs`는 동일하다.
7. 실제 설치된 `.vscode/extensions/azrael-ex-local.azrael-2026.0.13/webview/assets/app-initial-97d3534ad35f.js`의 hydration 경로도 확인했다. `e.readThread(f,{includeTurns:!1,...})`를 먼저 시작하고, `p=await le` 뒤 `metadata_ready`를 표시한 후 runtime resume로 진행한다. 최초 metadata read 실패 경고는 없고 이어지는 resume만 최초 오류로 기록됐다. 현재 파일 핸들 상태와 함께 선행 read의 lease 취득 경로를 뒷받침한다.

## 코드상 원인과 관측의 연결

- `app-server-daemon/src/session_handoff.rs:680`은 **thread/resume에서만** 발견 주소를 조회해 route를 만든다. 아직 route가 없는 `thread/read`는 :793 부근 기본 분기로 선택된 새 엔진에 전송된다.
- `app-server/src/azrael_shared_server.rs:1224`는 method 구분 없이 `params.threadId`가 있는 요청에 :1243의 `thread_engines.acquire(thread)`를 실행한다. 즉 사전 metadata read도 새 엔진의 lease를 취득한다. 해당 파일 핸들은 `azrael_thread_engines.rs`의 실제 try_lock 성공 뒤에만 owned map에 보관된다.
- `published_thread`(:758)는 start/resume/fork/ThreadStarted만 포함하고 read는 포함하지 않는다. read가 lease와 registry mapping을 취득해도 발견 주소는 갱신되지 않는다.
- 이어지는 resume는 낡은 주소로 여전히 살아 있는 이전 엔진에 attach를 요청한다. 이전 엔진은 :1082에서 workspace와 **실제 owned_threads**를 검사하므로 기록만 남고 lease가 없는 스레드는 `session workspace or authoritative lease mismatch`로 거부한다.
- source가 살아 있으나 해당 스레드를 소유하지 않는 경우는 `SourceUnavailable`이 아니다. 현재 fallback은 최초 연결의 경로 부재/connection refused에만 적용되므로 새 엔진이 이미 lease를 갖고 있어도 이 경로로 진행하지 않는다.
- attach 에러는 exchange(:271)에서 구체 사유를 버리고 `private session handshake rejected`로 축약된다. route는 Failed로 보관되며 :682의 contains_key 조건 때문에 같은 transport의 재시도는 다시 attach하지 않는다. 후속 요청은 :782에서 송신 전에 거부된다.

## 결론과 확신 범위

확인된 결함은 **재개 전 읽기가 새 엔진의 lease를 취득하는 경로와, resume만 낡은 발견 주소로 이전 엔진에 붙는 경로의 불일치**, 그리고 실패 route가 UI 재시도로 복구되지 않는 동작이다. 현재 정확한 파일 사용자는 이전 엔진이 아니라 새 엔진이므로 최초의 “이전 엔진 소유” 설명은 발견 기록에 대한 해석으로 정정한다.

최초 내부 거부 응답 원문은 기존 로그에 보존되지 않았다. 실제 최초 guard의 원문까지 직접 관측한 것은 아니지만, metadata 선행 로그·오래된 발견 주소·새 엔진의 파일 핸들·양쪽 호환 상태·동일 배포 소스가 위 순서를 강하게 뒷받침한다. 확인을 위해 실제 attach/resume를 다시 보내거나 기존 소유권을 조작하지 않았다.

## 권고와 검증 범위

### 개선 검증 진행

- r3 30분 확인 시점: core handoff 10개 전부 통과(실행 3.17초), app-server typecheck exit 0(271.988초), app-server libtest 선택용 컴파일 진행 중이다. rustc CPU/메모리 사용을 확인했고 C: 여유 공간은 약 16.5GB다. 새 입력에서 앞선 GatewayLoginRequired 오류는 재현되지 않았다. 전체 수용은 남은 세 app-server 범위 종료 후 판단한다.
- r1/r2 producer를 실제 실패 종료 근거와 함께 정상 close했다. 요약은 `02-verification.json`에 독립 보존했다. 검증한 standalone maintenance owner의 register 요청은 catalog OS lock busy로 거부됐다. 잠금 우회 없이 현재 producer 종료 후 등록·검토·삭제를 재시도한다.

- r2 actual exit 101, 13:48:58.487Z~13:58:25.222Z(566.735초). 변경 daemon 범위는 typecheck/selection/execution 모두 exit 0, 10개 전부 통과(실행 7.08초)했다. 이어지는 core typecheck는 model-provider의 `GatewayLoginRequired` 미발견(E0599)으로 exit 101, 나머지는 실행되지 않았다. 고정 사본과 원본 protocol에 해당 variant가 존재하므로 아직 제품 결함으로 단정하지 않는다.
- Windows 복사된 입력의 LastWriteTime은 원본의 10월 27일 값이고 공유 캐시의 protocol artifact는 10월 28일 값이다. Cargo freshness 오판 가능성을 조사한다. 별도 model-provider 진단은 동일 캐시 owner로 단독 실행하며 로그를 r2에 보존한다. r3는 복사 후 전체 파일 시각을 준비 시점으로 정규화하고 inventory를 확정한 새 사본이다. 원본 코드나 실행 중인 고정 입력은 바꾸지 않는다. 이미 통과한 daemon 계약은 소스 바이트가 동일한 경우 증거를 재사용하고, 나머지 필수 네 범위를 원래 명령/기능 조건으로 실행한다.

- r1은 2026-10-28 13:45:19Z에 actual exit 101로 종료했다(824.863초). daemon 10개 중 신규 stale-live/read/retry 및 실제 websocket 보호 사례를 포함한 9개 통과, 기존 busy attach 사례 1개가 fixture timeout으로 실패했다. 나머지 네 native 범위는 실행되지 않았다. lock 파일이 없는 fixture에서도 상위 제어 디렉터리 검사를 먼저 해 기존 attach 경로에 진입하지 못한 것이 원인이다.
- lock 파일 부재는 기존 attach 검증을 계속하도록 검사 순서를 수정했다. metadata read 후 2.5초 동안 자동 handoff가 발생하지 않는 검증도 기존 websocket 사례에 추가했다. r2 고정 사본을 13:47:20Z에 준비하고 같은 필수 handoff runner를 시작했다. 첫 명령은 PowerShell 인자 인용 오류로 Node parse 단계에서 종료하여 Cargo를 시작하지 않았고, stdin 실행으로 바로잡은 producer 하나만 실행 중이다.
- r2 결과 파일의 실제 child close를 관찰하는 별도 observer를 연결했다(work ID `c1a817be-d0be-42e3-9567-be872f83f953`). 최종 성공 판단은 전체 필수 범위의 실제 종료 코드와 선택·실행 수를 확인한 뒤 내린다.

- `run:eg01:handoff-r1`을 생성 전에 등록하고 `artifacts/tasks/eg01-handoff-r1` 아래 고정 engine 사본·입력 inventory·로그·pending snapshot을 함께 소유한다. 2026-10-28 13:31Z부터 기존 `scripts/check-shared-engine-native.cjs <frozen engine> handoff`를 실행 중이다. 공용 캐시를 새로 만들지 않고 기존 `engine/codex-rs/target`을 지원 Cargo owner로 독점 사용한다. source 변경 이후 생성한 고정 사본은 실행 중 갱신하지 않는다.
- 첫 daemon cfg(test) typecheck actual exit 0(268.739초). 13:42Z 점검에서는 libtest 선택을 위한 `codex-core` 컴파일이 진행 중이며 Cargo/rustc 실제 프로세스·CPU 사용, 여유 약 38GB를 확인했다. 테스트 실행 성공은 아직 미확정이다.
- source provenance recorder actual exit 0. 원래 baseline `12a1dbfc…`, 갱신 전 receipt `58fb6900…`에서 이번 daemon source 하나만 미기록 delta로 확인했고 새 receipt는 `f33c96f8…`다. 기존 다른 작업의 출처 기록은 유지했다. 파일 scoped CRLF-aware diff check actual exit 0.
- native wrapper 실제 close 이후 작성되는 `result.json`만 관측하는 파일 이벤트 observer를 연결했다(work ID `bd4e073c-5508-4ce4-abab-3430551c8393`). 다음 단계는 실제 native 종료 결과 확인 → 필요 실패 수정 → 독립 검증 요약 보존 → owner-based 임시 묶음 정리다. `engine.shared-engine.session-handoff` 필수 범위를 줄이거나 중복 producer를 시작하지 않는다.

- 권고: 읽기/재개가 같은 권위 있는 엔진 판정을 사용하도록 정리하고, 살아 있지만 해당 lease가 없는 source를 명시적으로 구분한다. 발견 기록만으로 소유권을 인정하거나 파일 삭제로 우회하지 않는다.
- 명시적 재연결에서 Failed route를 재평가하되 이미 송신한 변경 요청의 자동 재실행은 금지하고, 내부 거부 사유를 안전하게 보존한다.
- 수정 시 필요한 회귀: 살아 있는 이전 엔진 + 과거 descriptor + 실제 lease 부재 + 선행 thread/read + resume, 실제 이전 writer가 살아 있는 경우의 중복 실행 방지, UI 재시도/재연결 및 다른 세션 유지. 기존 dead-locator fixture는 source endpoint 부재만 다룬다.
- 이번에는 제품 테스트·빌드·수정·설치 없이 기존 로그와 원본 배포 코드 및 Windows 읽기 전용 상태를 대조했다. 임시 plan body는 생성 직후 삭제·부재 확인했으며 다른 임시 파일을 만들지 않았다. 보존물은 이 작업 기록뿐이다.
