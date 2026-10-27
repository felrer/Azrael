상태: 승인된 여섯 항목의 코드 반영과 발견된 이식 누락 수정은 완료했다. PowerShell 경로와 관리 잠금 선행 조건이 해소돼 최종 입력 고정·필수 재검증을 재개했다. 출처 정합성 갱신·정리·커밋은 아직 미완료다. 저장 공간·기업용 MCP 인증·원격 credential masking은 제외했다. 제품 빌드·설치는 별도 범위다.

# Codex 최신 릴리스와 Azrael 적용 버전 비교

## 요청과 범위

- 요청: 최신 Codex와 현재 Azrael의 차이 조사에 이어, 대화 압축·세션 복구·명령 실행·권한 보안·도구 인증·저장 공간의 선택 반영을 검토한다. Windows 프록시 인증과 터미널 UI 개선은 이번 선택 범위에서 제외한다.
- 허용 작업: 압축 실패 이력 보존, 압축 이력 재개·설정/권한 복원, 명령 종료/최종 출력 보존, 네트워크 및 OS별 보안, 읽기 도구 병렬화, Code Mode 중단 기본 활성화의 구현과 필요한 테스트 준비 컴파일·검증·출처 갱신·작업 정리·작업 단위 커밋. 저장 공간, 기업용 MCP, 원격 credential masking과 신규 async background compaction은 제외한다. 제품 배포 빌드·패키징·설치·push는 요청하지 않았다.
- 대상: 공개 Rust CLI/app-server 엔진. 데스크톱 앱, VS Code UI, 모델 이름은 별도 버전 체계다.
- 플랫폼: 엔진 공통 변경과 OS별 변경을 구분한다. 설치 식별은 현재 Windows x64 일반 VS Code 프로필에 한정한다. Linux/macOS 설치 및 실행 중 각 창의 로드 버전은 확인하지 않았다.
- 완료 기준: 최신 공식 릴리스와 Azrael 식별을 바탕으로 선택 여섯 영역의 upstream patch/현재 구현/의존성/보존 조건/권고와 검증 한계를 제시한다. 소스 검토 완료와 실행 검증은 구분한다.
- root가 판단·통합·공유 manifest/lock·출처·검증·최종 수락을 소유한다. 독립 구현 소유자는 (1) 압축/rollout lookup, (2) 설정/권한 복원, (3) exec-output, (4) network/OS security, (5) read-tool/Code Mode이다. 각 소유자는 자신의 코드·기존 테스트와 owning design만 수정하고 Cargo cache를 사용하는 실행은 root가 순서를 정한다. 기존 미커밋 Cargo.lock·SOURCE.json·feature inventory 등은 보존하며 이 작업 변경만 통합한다.

## 확인된 버전

2026-10-24 KST 공식 변경 기록 RSS 기준 최신 정식 CLI 항목은 0.164.0(2026-10-23)이다. 중간 릴리스는 0.162.1(10-09), 0.163.0(10-15)이다. alpha/개발 브랜치 최신 여부는 조사하지 않았다.

| 구분 | 확인값 |
| --- | --- |
| 일반 VS Code 설치 확장 | `C:/Users/felre/.vscode/extensions/azrael-ex-local.azrael-2026.0.11` |
| 설치 runtime 설정의 엔진 | `0.162.0` |
| 설치 엔진 경로 | `artifacts/build/b13/artifacts/releases/w11aa/engine/azrael.exe` |
| 설치 build-info의 engineBaseCommit | `980211bf54cbd57880c0c71bfe15ad2a425ac235` |
| 설치 build-info | `engineIncludesLocalChanges=true`, 생성 `2026-10-22T14:12:48.4036382+09:00` |
| 설치 엔진 sourceSha256 | `b092f9ddbc007afa11cb476270dfaba8588b16155320ff94bcc5ecfd08ae0efd` |
| 설치 엔진 target | `x86_64-pc-windows-msvc` |
| 설치 UI 원본 | `26.1007.21434` |
| 현재 engine Cargo workspace version | `0.162.0` (`engine/codex-rs/Cargo.toml:165`) |
| 현재 SOURCE.json의 baseTag | `rust-v0.162.0` |
| originalReceipt upstreamIntegration | base/target 모두 `c1382380de69521303b416720a52f42d51af6248` / `rust-v0.162.0` |

현재 SOURCE.json은 위 engineBaseCommit과 같은 head, localIntegration.repositoryHead `3dbcd525fa33e40949041fcbc916f5634c8a9d61`, localIntegration changes 500개 파일을 기록한다. 이는 설치 바이너리와 현재 checkout의 바이트 동일성을 의미하지 않는다.

`upstream/codex`는 역사 보존용 checkout이며 현재 제품 입력 식별자로 사용하지 않는다. `docs/ops/development.md`의 설치 설명은 2026.0.10이지만 실제 설치 파일은 2026.0.11이다. 이번 조사에서는 해당 문서를 수정하지 않았다.

## 주요 차이와 영향

| 버전 | 공식 변경 | Azrael에 대한 검토 영향 |
| --- | --- | --- |
| 0.162.1 | 여러 줄 비동기 질문의 TUI 충돌, daemon feature 기본값 차이로 인한 시작 실패 수정 | 터미널 UI와 native daemon 영향을 구분 |
| 0.163.0 | 응답 중 지시 변경, Code Mode 중단 시 내부 도구도 취소, 읽기 도구 병렬 실행 확대 | 기존 steering·취소·병렬화와 중복/차이 대조 |
| 0.163.0 | 저장된 권한·네트워크 승인 복원, DNS 전 권한 검사, 중복 Host 헤더 차단 | 재개 및 보안 경계 우선 검토 |
| 0.163.0 | 자식의 열린 출력 파이프로 인한 로컬 명령 종료 지연, 원격 명령의 늦은 출력 유실 수정 | 실행 완료 판정과 최종 출력 수집 회귀 필요 |
| 0.163.0 | `/config`, `/daemon`, 키맵 개선, eligible 계정 Daybreak 기본 활성화 | CLI UX가 Azrael UI에 자동 노출된다고 볼 수 없음 |
| 0.163.0 | patched zsh backend 제거, Linux/macOS 배포 심볼 제거 | Unix 실행·설정·패키징 별도 회귀 |
| 0.164.0 | 압축 실패 시 부분 요약의 히스토리 잔류, background compaction panic 수정 | 대화 보존·압축 복구 우선 검토 |
| 0.164.0 | 압축된 저장 이력 검색·재개, 스레드 설정 복원 수정 | 기존 Azrael reload/recovery 계약과 결합 검토 |
| 0.164.0 | Windows HTTPS/WebSocket 프록시 Negotiate/NTLM 인증 | Windows 기업망에 해당하는 조건부 효과 |
| 0.164.0 | enterprise MCP 인증, remote Bash/Zsh credential masking 강화 | provider 인증·실행 경계 및 계정 자격 조건 검토 |
| 0.164.0 | 대기 권한 선택 전 queued prompt 실행 보류 | Azrael queue/approval 계약 보존 |
| 0.164.0 | macOS 대소문자 경로 및 교체 가능한 실행파일 symlink sandbox 검사 강화 | 플랫폼별 보안 회귀 필요 |
| 0.164.0 | 미사용 설치·marketplace checkout 정리와 daemon 로그 상한, JS runtime 안전성 개선 | Azrael artifact lifecycle·설치 보존·캐시 소유권 대조 |
| 0.164.0 | `/presets`, inline model/permissions, 터미널 이미지, Bedrock 설정 개선 | 터미널 UX와 공통 엔진 기능 구분 |

## 해석과 권고

현재 제품은 순정 0.162.0이 아니라 그 기반의 Azrael 수정판이다. `tools/parallel.rs`는 parallel 지원 도구에 read lock, 나머지 도구에 write lock을 사용한다. `reload-recovery.md`는 native steering과 복구를, `queued-compaction.md`는 승인·질문 대기와 압축 큐를 이미 기술한다. 따라서 upstream에 새로 기록된 기능이 Azrael에 모두 없다고 단정할 수 없다. 유사 기능의 존재도 upstream 수정이 불필요하다는 증거는 아니다. 개별 patch 포함 여부는 추가 대조가 필요하다.

권고: 선택 영역은 **필요한 수정의 선택 이식**으로 진행할 가치가 있다. 압축 이력 보존·압축 이력 재개·설정/권한 복원·명령 종료/출력 보존·네트워크 보안·OS별 sandbox 검사·안전한 읽기 병렬화를 우선 후보로 한다. Code Mode 중단 기본값과 marketplace/log 관리는 Azrael 경계에 맞춰 검증·수정한 뒤 반영한다. 기업용 MCP와 원격 credential masking은 신규 연결/프로토콜 도입을 포함하므로 별도 기능 단위로 검토한다. 0.164.0 전체 교체나 upstream 정리기 일괄 도입은 이번 권고가 아니다. 아래 권고는 구현 승인이 아니며 구현 시 기존 feature inventory의 필수 검사를 유지한다.

## 선택 반영 판정표

| 영역 | 현재 구현과 차이 | 권고 |
| --- | --- | --- |
| 압축 | 스트림 중 부분 요약 즉시 저장; async background compaction은 검색한 Core 범위에 없음 | #53932 우선 반영, #55581 직접 반영 대상 없음 |
| 세션 복구 | 압축 rename race 미처리; 일부 설정과 이름 있는 권한 profile만 복원 | #54008, #55923 및 #53150→#53419/#53424를 의존 묶음으로 반영 |
| 명령 실행 | exec-server local/remote drain 구분 없음, exit 시 unread output과 무관하게 session 제거 | #52652→#53331→#53622의 최종 동작을 결합 반영 |
| 권한 보안 | DNS/credential alias/Host 사전 검사 및 OS별 보호의 구체적 차이 | #51650/#52661/#53506 우선, macOS #54273·Linux #55384는 native 검증과 함께 반영 |
| 읽기 도구 | 병렬 scheduler는 있지만 해당 handler의 opt-in이 없음 | #52245를 도구 allowlist 단위로 반영 |
| Code Mode 중단 | 구현·회귀 test 존재, 기본값 off | #51835는 취소·중첩 호출 검증 후 기본값 변경 후보 |
| 기업용 MCP | 설정·로그인 기반은 있지만 live EMA connection/status는 명시적 unsupported | #55334→#55859→#56001 별도 기능 묶음 권고. 기존 일반 OAuth 수정으로 축소하지 않음 |
| 원격 credential masking | 로컬 broker 존재, remote 경계에서는 비활성/거부 | #54309→#54432→#56049 별도 원격 기능 묶음. 새 원격 지원을 이번에 임의 추가하지 않음 |
| 설치본 정리 | upstream pruner 소유 root와 Azrael side-by-side release owner가 다름 | #53827/#55149 직접 도입 우선순위 낮음; Azrael 정리 owner 유지 |
| marketplace 임시 checkout | staging은 있지만 producer lock 및 stale sweep 없음 | #55689 잠금·ownership 개선은 적응 반영, #55690의 기간만에 의한 삭제는 그대로 도입하지 않음 |
| daemon 로그 | 크기 제한 후보는 유용하나 upstream log path 선택이 instance owner와 다름 | #55856의 상한 개념은 적응 반영; per-instance 경로·진단/출처·손실 정책 해결 전 직접 이식 보류 |

Windows 프록시 인증, 터미널 UI 새 기능, V8 업그레이드는 사용자가 고른 여섯 영역의 직접 반영 목록에 넣지 않았다. #55682는 TUI 권한 선택 hold의 인접 경계로 검토했으며 Azrael VS Code 큐 기능의 결함으로 확대하지 않는다.

## 선택 반영 검토 — 대화 압축과 세션 복구

- **#53932 반영 권고**: 현재 `core/src/compact.rs:785`의 `drain_to_completed`는 non-post-turn `OutputItemDone`을 즉시 기록한다(`:845` 부근). upstream은 completed까지 buffer한 뒤 persist한다. raw output notification 순서는 보존한다. 기존 성공 테스트 `manual_compact_emits_context_compaction_items`와 실패 테스트만으로 부분 요약 뒤 실패를 막는 계약을 입증하지 못한다. `manual_compact_non_context_failure_retries_then_emits_task_error`는 ignored다. 추가 fixture는 summary item 후 failed/incomplete를 발생시키고 live/persisted history 원본 보존 및 retry 입력을 확인해야 한다.
- **#55581 직접 반영 대상 없음**: closed/empty oneshot receiver를 처리하는 async background compaction 수정이다. 검색한 `core/src`, `core/tests`에 해당 async/background compaction 구현이 없다. 이 기능을 함께 들여오는 것은 별도 범위다. 이전 비교표의 background panic 개선을 현재 Azrael에 바로 필요한 수정으로 해석하면 안 된다.
- **#54008 반영 권고**: `thread-store/src/local/read_thread.rs:205::resolve_requested_rollout_path`는 logical rollout path를 한 번 resolve한 뒤 canonicalize한다. `tui/src/lib.rs:827::lookup_latest_session_target_with_app_server`는 logical `.jsonl`의 exists만 검사한다. upstream은 압축된 rollout 선택과 압축 rename 중 race를 다룬다. 현재 `rollout_compress_tests.rs:24`의 압축 테스트는 이후 resume를 검증하지 않는다. app-server logical path 읽기/재개와 압축 중 resolve, TUI latest picker를 구분해 검증한다.
- **#55923 적응 반영 권고**: `persisted_resume_settings.rs:14`, `thread_processor.rs:4234/:4695`는 owned cwd/workspace roots, approval policy, reviewer, named permission profile 등을 복원한다. saved service tier, reasoning summary, personality 및 resume/revert 비교용 effective tier snapshot은 차이가 있다. Azrael provider/계정·속도 정책에 원본 OpenAI tier를 잘못 적용하지 않게 해야 한다. cold resume/revert, explicit override 우선, foreign/stale ownerless snapshot의 격리를 검증한다.
- **#53150→#53419 및 #53424 적응 반영 권고**: 현재는 이름 있는 profile ID만 복원하고 이름 없는 saved base profile을 config/proxy 초기화 전에 복원하지 않는다. upstream #53419는 #53150의 session-level 복원을 config loading으로 옮기고 불허 saved grant를 제거한다. 초기 patch만 넣지 말고 최종 우선순위와 proxy 초기화 시점을 유지한다. 현재 `thread_resume.rs:1765`에는 current-config fallback을 기대하는 테스트가 있어 **재개 시 설정 선택 동작의 의도적 변경**으로 기록해야 한다. saved filesystem/network 정책, current override, managed restriction, 전체 액세스 계약을 함께 검사한다. #53424는 Linux network-proxy 회귀로 Windows/Mac 증거를 대신하지 않는다.
- **#55682 조건부/낮은 우선순위**: 현재 TUI `/permissions`는 app event를 보낸 뒤 `defer_input_until_settings_applied`를 호출하지만 popup이 이미 열린 경우만 보류한다(`slash_dispatch.rs:414`, `input_flow.rs:119`, `event_dispatch.rs:2140/:3073`). upstream은 async 메뉴 열기 전 queued prompt dispatch race를 막는다. `queued-compaction.md:40`의 native `pendingApprovalCount`와 다른 문제다. 엔진/TUI도 유지한다면 해당 patch/test를 포함하되, pinned VS Code UI에 같은 race가 있다고 가정하거나 새 TUI UX 이식을 시작하지 않는다.

## 선택 반영 검토 — 도구와 인증

### 읽기 병렬화와 중단 기본값

- **#52245 반영 권고**: `tools/src/tool_executor.rs:122`의 기본 parallel opt-in은 false이고 `core/src/tools/registry.rs:530`, `router.rs:400`이 이를 소비한다. 기존 scheduler의 존재만으로 읽기 handler들이 병렬이라고 판단할 수 없다. 대상 handler에 opt-in을 추가하고 upstream `cloud_skill_reads_run_in_parallel`을 가져온다. 시간·메모리·이력·skill 등 명시된 안전 read만 허용하고 goal create/update나 쓰기/상태 전이까지 확장하지 않는다. catalog/read 충돌, 취소, 결과 귀속·순서 및 실제 read overlap을 검증한다.
- **#51835 검증 후 기본값 반영 후보**: `features/src/lib.rs:1153`은 `CodeModeInterrupt`를 under-development/off로 둔다. `core/src/tasks/mod.rs:1032`에 실제 cell interrupt 경로, `core/tests/suite/code_mode.rs:5985`에 explicit enable regression이 있다. 새 구현을 추가하는 작업이 아니라 stable/default-on 전환이다. 중첩 도구 종료, 실행 중 후속 지시, 이미 끝난 cell, 반복 interrupt, provider 공통 취소를 검사한다. Devin code-mode feature 보존과 연결한다. #51812 자체의 전체 변경은 이번 담당 검토에 포함하지 않았으므로 즉시 steering 구현 전체가 최신과 같다고 주장하지 않는다.

### 기업용 MCP(EMA)

**기능 단위로 별도 반영 권고**: #55334가 live runtime prerequisite, #55859가 grant 선택·거부 후 재인증·retry/status 보강, #56001이 confidential-client 인증을 추가한다. 기업 계정 사용 수요가 없다면 안정성 수정과 분리해 보류할 수 있다. 코드가 있다고 계정 자격·서버 호환성을 보장하지 않는다.

- 현재 `codex-mcp/src/rmcp_client.rs:1197`은 EMA 연결을 명시적으로 거부하고 `codex-mcp/src/mcp/auth.rs:257`은 status Unsupported다. 설정·login·`rmcp-client/src/ema_auth.rs`의 public-client ID-JAG 교환만 있는 상태다. 따라서 단순 후속 bugfix가 아니라 새로운 실제 연결 경로를 활성화하는 작업이다.
- `config/src/mcp_ema.rs`의 IdP config는 issuer/client ID만 가지며 `:210`에서 EMA와 oauth.client_secret 조합을 거부한다. `ema_auth_policy.rs::validate_ema_public_client_auth`도 public-client method none을 요구한다. 일반 OAuth의 redacted client_secret field가 EMA confidential support를 뜻하지 않는다.
- 사전 설계/검증: account-scoped grant 및 secure storage owner, token refresh/거부 재인증/계정 전환, IdP/resource secret 분리, metadata auth-method 검증, secrets redaction, 실패 status와 retry upper bound, 기존 일반 OAuth의 호환성. 현재 계정 문서는 일반 MCP OAuth identity를 설명하지만 EMA 연결 lifecycle은 아직 owning contract가 없다. 반영 승인 시 먼저 이 경계를 같은 작업 안에서 문서화해야 한다.

### 원격 credential masking

**별도 원격 기능 도입으로 보류 권고**: #54309(Bash built-in broker) → #54432(Zsh snapshots) → #56049(custom provider/capability 전달)로 함께 검토한다. 현재 지원 범위를 넓히지 않는 안정성 작업과 묶어서 자동 활성화하지 않는다.

- 현재 `core/src/tools/runtimes/unified_exec.rs:293`은 `!environment_is_remote`에서만 broker를 허용한다. `network-proxy/src/remote_config.rs:63`은 masking/provider 필드가 없고 credential brokerage를 거부한다. `exec-server-protocol/src/protocol.rs`의 capabilities에도 masking/custom-provider negotiation이 없다.
- remote execution/proxy launch와 shell snapshot은 존재하나 executor-side credential snapshot helper는 없다. 기반 기능의 존재와 remote credential masking의 부재를 구분한다.
- Bash/Zsh patch 설명은 Linux/macOS 대상이며 Windows remote 지원 증거가 아니다. 반영 시 executor capability fallback, dummy↔real credential mapping 격리, rotating credential lifetime, env override, snapshot 복원, 로그/요청 redaction, custom provider transport를 검증한다. 실행기의 credential 보유 권한과 신규 지원 환경은 별도 결정이 필요하다.

## 선택 반영 검토 — 저장 공간

### 설치본 정리

**#53827/#55149의 직접 도입 우선순위는 낮다.** #53827은 `packages/app-server-daemon`와 `.migration-current` guard, selection history 및 current/previous/running identity로 managed release를 정리한다. #55149는 shell installer의 standalone release 정리다. 현재 `prepare_install.rs:340`에는 이 selection-history/pruning 경로가 없다.

Azrael은 `Daemon::for_azrael_instance`의 `app-server-daemon/engines/<id>` 및 별도 side-by-side runtime release owner를 쓴다(`lib.rs:446/:459`, `scripts/install-platform-release.cjs:169`). upstream pruner는 Azrael per-instance state를 순회하지 않으며, Azrael runtime release root의 정리 해법으로 그대로 쓸 수 없다. 반대로 이를 읽는 범위를 Azrael runtime까지 임의 확장하지 않는다. #55149 shell route는 musl Linux x64/ARM64와 macOS x64/ARM64이며 Windows나 현 glibc Linux 제품 경로의 공통 해법이 아니다. 현 artifact lifecycle/native review/apply 소유자를 유지한다.

### Marketplace staging

**#55689 잠금·ownership 기반 부분은 적응 반영 권고**: `core-plugins/src/installed_marketplaces.rs:12`, `marketplace_add.rs:156`, `marketplace_upgrade.rs:257`에 이미 `.tmp/marketplaces/.staging`이 있지만 cross-process ownership lock과 stale sweep이 없다. add 경로는 `TempDir::keep()`도 사용한다. upstream은 lock-owned staging과 4-directory cleanup batch 및 path-utils helper를 추가한다.

**#55690의 legacy 기간 삭제는 그대로 도입하지 않는다.** upstream은 add 24시간, upgrade 10분의 age rule을 쓴다. 이는 Azrael의 producer tree 종료·소유권·참조·진단/복구 보존 근거를 대체하지 못한다. 새 producer는 complete membership/ownership·실제 종료를 정합하고 기존 관리 경로를 이용하는 방향이 적합하다. legacy producer 근거가 없으면 유지하고 재검토 조건을 남긴다. lock contention, live slow checkout, stale failed checkout, symlink/containment, batch 상한, retry 후 registry 정합을 검증해야 한다. 이번에 어떤 checkout도 삭제하지 않았다.

### Daemon 로그 상한

**#55856은 경로·보존 정책을 수정한 뒤 적응 반영 권고**: upstream은 live log 1MiB cap와 256KiB tail, bounded queue/drop 정책 및 tracing-appender dependency를 도입한다. 로그 증가 억제 가치는 있으나 수치와 손실 정책을 그대로 확정하지 않는다.

현재 `azrael.rs:241`의 launcher는 managed-daemon과 Unix socket을 사용하므로 upstream CLI hook 조건과 겹친다. upstream `maintain_stderr_log()`는 base `Daemon::from_environment()?.pid_file`에서 path를 얻지만 Azrael은 instance별 azrael.pid/stderr를 쓴다. 따라서 그대로 가져오면 instance별 log 분리가 깨지거나 base log를 잘못 관리할 가능성이 있다. 이는 source path에 근거한 통합 위험이며 실제 설치 실행 재현은 아니다.

경로를 instance owner에서 명시적으로 전달하고 증거로 참조된 log의 immutable copy/hash를 보존해야 한다. dropped-record 표식, stalled writer·oversized record, rotation/prune race, instance 동시 실행, tail 보존, Windows file sharing 및 Unix 권한, retained release 진단 참조를 검사한다. cap/tail/drop 허용 여부는 운영 선택으로 반영 승인 전에 정한다.

## 후속 실행 순서와 수락 조건

1. **안정성·보안 묶음**: #53932, #54008, #55923, 권한 복원 chain, exec-output chain, network chain과 OS별 sandbox 수정. 각 patch의 최종 동작·tests·callers를 함께 비교하고 필요한 helper/manifest/lock 변경만 포함한다. patch가 그대로 적용된다고 확인한 것은 아니다.
2. **도구·저장 관리 적응 묶음**: #52245 safe-read opt-in, 검증 후 CodeModeInterrupt 기본값, marketplace producer ownership, per-instance log cap. 저장 관리의 삭제 authority와 진단 evidence retention은 기존 owner에 연결한다.
3. **별도 기능 묶음**: 기업용 MCP runtime/confidential client 및 remote masking. 대상 계정/서버/OS/원격 실행 권한·수요를 확정한 뒤 구현 범위를 정한다. 현재 상태에서 feature flag만 켜서 지원한다고 표시하지 않는다.

보존 연결: `engine.recovery`, `engine.provider-context`, `ui.recovery`, `ui.queued-compaction`, `ui.queue-consumption`, `engine.devin-code-mode`, `engine.shared-engine`, `tool.project-maintenance`의 관련 mandatory checks를 유지/확장한다. 현 inventory에 개별 network/EMA 동작이 충분히 연결되지 않으면 기존 인접 owner에 tests를 연결하거나 필요한 새 feature 항목을 승인된 구현에서 추가한다. 소스 검사만으로 native 또는 packaged/installed 수락을 대신하지 않는다.

작은 검증부터 관련 native suite, 요구 플랫폼 native 검증, 정확 패키지/호스트 수락 순서로 진행한다. 공통 변경에는 Windows 회귀가 필요하고 macOS alias/Seatbelt 및 Linux bwrap/network test는 실제 해당 OS에서 수행한다. 기존 CI matrix가 있다는 사실은 이번 검증이 통과했다는 뜻이 아니다. 전체 build·설치·정리 실행은 아직 승인되지 않았다.

담당별 조사 완료 결과를 통합했다. patch는 메모리에서 읽었으며 source tree·사용자 state·설치·registry에 쓰지 않았다. 빌드/테스트/성능 실측/cherry-pick 적용 검증은 미수행이다. 실행 결정을 돕는 검토 deliverable만 완료했다.

## 선택 반영 검토 — 명령 실행과 권한 보안

판정은 현재 `engine/` 소스에 대한 정적 대조다. 이전 설치 버전 식별과 현재 소스 검토를 구분한다. 조사 시 checkout HEAD는 `2bf028aa36929d5bb50159f79917b4c35ae096b4`이며 기존 미커밋 변경이 있다. 다른 작업의 변경은 보존한다. 아래 위험은 수정 전 코드 경로의 차이이며 실제 사용자 환경에서 재현된 장애·보안 사고를 뜻하지 않는다.

### 명령 종료와 최종 출력

반영 권고: **#52652 → #53331 → #53622의 최종 결합 동작을 하나의 후보로 검토**한다. 중간 patch의 취소 처리를 단독 적용하면 원격 출력 보존에 관한 후속 수정과 어긋날 수 있다.

- 현재 `core/src/unified_exec/process.rs:415`의 `from_exec_server_started`에는 local/remote `OutputDrainPolicy` 인자가 없다. `process_manager.rs:1311`의 공통 entry는 remote 또는 local shell snapshot을 exec-server로 보내지만 둘 다 같은 생성 함수를 호출한다(`:1358`). #52652는 local에만 종료 후 bounded drain, remote에는 output closure 대기를 적용한다. upstream regression은 `shell_snapshot_v2_returns_before_inherited_output_closes`와 exit 이후 출력 이벤트 시나리오다.
- 현재 `process_manager.rs:598`는 시작 때 살아 있는 프로세스만 저장하고, `refresh_process_state:1130`는 exit를 확인하면 unread/open output 여부와 무관하게 store에서 제거한다. #53331은 수집 완료·취소·종료 뒤 watcher 해제를 추가하고 #53622는 원격 세션을 출력 수집까지 유지하며 exit와 stdin-write 경쟁 및 background final read를 정리한다.
- 적용 범위: local exec-server/shell snapshot은 실제 활성 경로에서 효과가 있다. 원격 경로 보완은 코드 무결성·기존 경로 보존 범위이며 Remote SSH·컨테이너 등의 신규 제품 지원을 승인하거나 주장하지 않는다. 직접 local PTY 경로의 기존 종료 동작도 유지해야 한다.
- 검증 후보: exit 7과 foreground output 보존, 자식의 열린 pipe가 foreground 완료를 막지 않음, remote pushed/recovered exit 후 late output 보존, initial collection 취소·deadline·명시 종료, `write_stdin`의 exit 경쟁, `ExecCommandEnd` 단일 발행과 background terminal 정리. Unix fixture의 통과를 Windows 증거로 쓰지 말고 Windows 명령 자식/파이프 fixture와 공통 회귀를 연결한다. 실제 종료 코드와 출력 스트림 완료를 별개로 판정한다.

### 네트워크 권한·credential alias

반영 권고: **#51650, #52661, #53506**. 각각의 수정과 tests/callers를 포함해 선택 이식한다.

- #51650: 현재 `network-proxy/src/runtime.rs:701`은 hostname DNS/IP 검사를 allowlist 최종 판정보다 먼저 수행한다(`:768`, `:779`). `network_policy.rs:363`의 승인 경로는 승인 뒤 baseline을 다시 검사하지 않는다. upstream은 승인 전 DNS를 막고 승인 뒤 explicit deny·private/local 제한을 재검사한다. macOS `sandboxing/src/seatbelt.rs:340`에는 local binding과 proxy port가 있으면 외부 `*:53` outbound를 허용하는 경로도 남아 있다. 이 Seatbelt 수정은 macOS native 검증 대상이다.
- #52661: 현재 `runtime.rs:952`의 MITM hook 평가는 host/request만 받고 credential destination을 받지 않는다. `http_proxy.rs:949`는 plaintext forwarding credential을 직접 치환한다. upstream은 원래 dummy credential에 hook을 먼저 적용하고 provider alias/URL-prefix destination을 검사한 뒤 실제 credential을 주입한다. broker registry/provider/destination 및 HTTP/MITM callers를 같이 바꿔야 한다.
- #53506: 현재 `http_proxy.rs:186` CONNECT와 `:555` plain entry에 중복 Host header 사전 거부가 없다. upstream은 값이 같아도 여러 Host header면 정책 평가·forward·Unix socket routing 전에 400을 반환한다. 기존 absolute URI/Host mismatch 검사는 이 조건의 대체가 아니다.
- 검증 후보: 승인 전 DNS 호출 0, 승인 뒤 private address/explicit deny 유지, approved CONNECT 안의 재검사, alias credential의 hook 우회 거부와 무관 credential 허용, 동일/상이 Host의 origin/absolute/CONNECT 요청 모두 upstream 연결 전 거부, 정상 단일 Host 보존.
- 보존: `docs/architecture/azrael-runtime.md:73`의 전체 액세스(`never` + `danger-full-access`) 의미와 managed policy 우선순위를 바꾸지 않는다. 강화된 sandbox가 의도적으로 선택된 권한을 무효화하도록 임의 확장하지 않는다. 승인·MCP 정보 입력·외부 로그인은 서로 다른 절차다.

### OS별 filesystem/실행파일 검사

- **#54273 반영 권고(macOS)**: 현재 `protocol/src/permissions/local_aliases.rs:104`는 system alias를 정규화해 matcher에 전달하지만 protected metadata의 ASCII case alias와 filesystem case sensitivity를 검사하지 않는다. upstream은 `.GIT` 및 workspace root의 case alias를 실제 filesystem 성질에 따라 재검사하고 explicit grant·더 좁은 제한의 우선순위를 보존한다. macOS 전용 libc dependency/lock과 tests를 포함해야 한다. case-sensitive/insensitive, missing dir, root alias, explicit grant/narrow deny, direct/shell-intercepted apply_patch를 실제 Mac에서 검증한다.
- **#55384 반영 권고(Linux sandbox/bwrap)**: 현재 `sandboxing/src/bwrap.rs:209`는 `canonicalize`한 target부터 검사해 lookup symlink/parent alias의 교체 가능성을 놓치는 차이가 있다. upstream은 원래 lookup path, parent alias, canonical target을 모두 검사하고 sticky-directory ownership을 처리한다. PATH relative entry와 colon-containing cwd도 다룬다. writable symlink→read-only target, symlink search dir→writable root, sticky dir, read-only carveout 및 정상 system bwrap을 Linux에서 검증한다. Windows/macOS에 bwrap 사용을 추가하는 변경이 아니다.

위 upstream patch 8건은 OpenAI GitHub patch endpoint에서 HTTP 200으로 실제 조회했다. 수정 commit은 #52652 `89c8759d8c497b30629a2d67a51c163aa9ed3c44`, #53331 `7e9c061ceb388c67097acac069d6b7f8a60e5011`, #53622 `b043762f9e3eb65dd5164ff5880f139bc6d084c7`, #51650 `37eaae6eeb71c3bd3d165f52515086db8f5e7dee`, #52661 `65b82cdf96f9d305494bc8c6c8d2404d37709030`, #53506 `12cca49c81c8aa6a37a5cc4e39964ee3b70f9458`, #54273 `3bae578af33e43268e7bc2d6d5d0266f704bb554`, #55384 `b8f880bc38b885bcca81cdfb50dae0ed18d7c3b4`다. 제품 지원 설명은 공식 OpenAI 변경 기록, 구현 비교는 해당 OpenAI 소스 patch를 근거로 한다. patch는 메모리에서 읽었으며 checkout/fetch/apply/빌드는 수행하지 않았다.

## 구현 및 검증 진행

- 다섯 구현 담당의 소스 변경과 정적 확인을 통합했다. 승인 범위의 회귀 테스트는 향후 업스트림 갱신에서도 보존할 계약이므로 유지한다. 임시 실행 도우미와 고정 소스는 검증 종료 후 수명주기 검토 대상이다.
- Windows x64(Windows `10.0.26200`, Node `v26.7.0`) 검증 준비 `r1`: 출처 기록과 고정 소스 무결성 검사 exit 0. 기준 원본은 실제 존재하는 `artifacts/inputs/engine-original-import-12a1dbfc`를 사용했다. 입력과 로그는 `artifacts/tasks/do1/runs/r1`에 보존한다.
- 검증 입력 sourceSha256: `91091d2e3b2890b15f9645984edc2f92cc2b838996c895b043ddcaaf1abadf8a`. Rust 1.95.0, Python 3.13, 기존 `engine/codex-rs/target` 캐시를 사용한다. 테스트용 컴파일과 제품 배포 빌드는 구분한다.
- `node --test scripts/test-cargo-verification.cjs`: exit 0, 49 passed / 0 failed / 0 skipped. 검증 실행 가드의 기존 회귀 검사이며 제품 동작 검증은 아니다.
- `network-r1`: `codex-network-proxy --lib`, exit 0, 322 passed / 0 failed / 0 ignored. 컴파일 포함 01:26:48–01:31:10 UTC, 실제 테스트 7.18초. 로그 `artifacts/tasks/do1/runs/network-r1/logs`.
- `source-checks-r1`: 보존 실행기 및 단계 인계 검사 30 passed / 0 failed / 0 skipped, exit 0. 로그 `artifacts/tasks/do1/runs/source-checks-r1/logs`. 공통 엔진의 실제 테스트 `core-lib-r1`을 이어서 실행한다. Cargo 캐시는 한 실행만 사용하며 중복 컴파일을 시작하지 않는다.
- `core-lib-r1`: exit 0, unified exec 63개와 저장 권한 config 2개 모두 통과(65 passed / 0 failed / 0 ignored). 컴파일 포함 01:31:19–01:51:07 UTC, 실제 테스트 약 28.85초. 로그 `artifacts/tasks/do1/runs/core-lib-r1/logs`. Windows inherited-output 회귀를 포함한다. 재실행 없이 다음 통합 검사로 인계했다.
- Code Mode 통합 검사에 필요한 호스트는 기존 공식 확장 `openai.chatgpt-26.1007.21434-win32-x64`의 파일을 `code-mode-host-r1/inputs`에 고정 복사했다. SHA256 `ec91f7a04dcb1a36f0e2ed87885777bf78900c2ea3295e82621c5721fd5d9f41`. 새 소스 빌드가 아니며 호환성은 `core-integration-r2`의 실제 검사 대상이다. 보존 검사도 실행 호스트 디렉터리를 명시적으로 받는다.
- `core-integration-r1`은 필수 `integration-tests` 기능 누락으로 준비 타입 검사에서 exit 101(약 3.9초)로 종료됐다. 제품 테스트는 실행되지 않았다. core/app-server의 `--test all` 실행에 manifest의 필수 기능을 추가했고, 동일 엔진 입력으로 `core-integration-r2`를 시작했다. 실패 로그는 `artifacts/tasks/do1/runs/core-integration-r1/logs`에 유지한다.
- `core-integration-r2`: 타입 검사와 3개 테스트 선택은 exit 0. 실제 첫 필터의 3개 압축 실패 회귀는 exit 101, 0 passed / 3 failed(5.89초), 전체 01:52:30–02:00:16 UTC. 실패 위치는 재시작 전 실패 직후의 `TokenUsageInfo` 전체 비교였다. 기존 압축 시작이 의도적으로 갱신하는 performance/history 및 prompt 추정치만 달랐고, durable total/last usage와 window는 같았다. 담당자가 영구 필드의 정확한 비교와 재시작 후 total/last 비교로 수정했으며, 이력·partial output 배제·알림·재시도 검사는 유지했다. 제품 코드는 수정하지 않았다. 뒤의 Code Mode/병렬 검사까지 실행됐다고 해석하지 않는다.
- `r2` 소스 준비는 exit 0으로 완료됐다. 이후 전체 파일 줄바꿈 차이가 생긴 네 Rust 파일을 기존 CRLF로 복구했다(논리적 텍스트 동일성 확인). 불필요한 수천 줄 diff를 제거한 최종 입력 준비 `r3`을 진행한다. 원본 `r1`/`r2` 고정 소스는 변경하지 않았다. whole-engine fingerprint 계약에 따라 최종 입력의 native 검사를 새로 수행하며 이전 통과는 이전 입력의 근거로 구분한다.
- Linux readiness 추가 확인: 배포본의 `ubuntu` 계정과 표준 cargo/rustup/nvm/mise 경로에서도 사용 가능한 Rust/Node를 확인하지 못했다. 시스템 설치나 다른 사용자의 도구 전수 검색은 수행하지 않았다. WSL 프로세스 확인은 Linux desktop acceptance를 의미하지 않는다.
- 최종 입력 `r3` 준비 exit 0, sourceSha256 `aecc5fa81b1240165a9024587c91a9f1b380f67844e951a80f5341ae5c3fd8e8`. 고정 소스 `artifacts/tasks/do1/runs/r3/inputs/engine`, 임시 경로 `artifacts/verification/do1-r3`. `core-integration-r3`을 native session `2942`로 시작했고 실제 종료 시 work completion `2a533104-44a6-4dd7-8963-806789878a41`에 신호를 쓰도록 연결했다. 입력과 호스트 해시는 실행 중 유지한다. 다음 Rust 검사는 이 실행의 종료 및 캐시 소유권 해제 후 시작한다.
- 관리 잠금 해소 후 `source-checks-r1`, `network-r1`, `core-lib-r1` 등록·검토·defer 적용을 완료했다. 세 그룹 모두 실제 `deferred`, 경로는 남아 있다. 최종 소스 검증과 비교에 필요한 근거이며, 최종 검사 종료와 독립 증거 보존 후 폐기 여부를 다시 검토한다. 삭제 완료로 표시하지 않는다.
- 산출물 관리 도구: `source-checks-r1` 그룹 등록은 완료했다. 이후 `network-r1` 등록은 다른 실행기의 `maintenance.lock`으로 거부됐다. 잠금 소유 프로세스 73132의 생존을 확인했고 잠금을 변경하지 않았다. 테스트 성공과 정리 완료는 별개이며 잠금 해소 후 나머지 등록·검토를 수행한다.
- WSL `ktcloud-ubuntu-24.04`의 Linux x64 실행은 확인했으나 기본 PATH 및 표준 cargo 설치 경로에 Rust/Node가 없다. 이는 전체 시스템에 도구가 없다는 전수 조사 결과가 아니며 Linux 검증 완료를 의미하지 않는다. macOS checkout 경로는 사용자 확인 대기 중이다.

### 추가 검증 기록 (2026-10-25 02:28 UTC)

- `core-integration-r3`는 실제 child/controller exit 101, compaction 0 passed / 3 failed로 종료했다. 로그: `artifacts/tasks/do1/runs/core-integration-r3/logs`. 실패 직후 원래 사용량 보존 검사는 통과했으며, 재시작 전 성공 follow-up이 명시적 zero usage를 기록하므로 resumed last usage를 그 응답 전 값과 비교하던 fixture가 틀렸다. 성공 follow-up 직후 snapshot과 비교하도록 수정했고 CRLF, rustfmt, whitespace 검사 exit 0이다. 제품 코드는 변경하지 않았다.
- 수정된 live source를 동결하기 전에 기존 고정 `r3`에서 알려진 실패 필터만 제외한 나머지 core 통합 검사를 진단한다. `core-integration-diagnostic-r3`는 합격 증빙을 대체하지 않으며, 나머지 독립 필터를 모두 실행하고 개별 실패를 기록한다. Cargo target 소유자는 이 실행 하나이다. 이후 최종 고정 입력에서 전체 필수 검사를 수행한다.

- `core-integration-diagnostic-r3`: 종료 코드 0, 나머지 27개 전부 통과(수동 압축 2, 원격 출력 수집 23, 읽기 병렬 실행 1, Code Mode 중단 1). 02:27:41–02:30:57 UTC. 로그 `artifacts/tasks/do1/runs/core-integration-diagnostic-r3/logs`. 설치된 Code Mode host 복사본과 해당 중단 검사 간 호환성도 확인했다. 압축 복구 3개는 의도적으로 제외했으므로 전체 수락 결과로 사용하지 않는다.
- 최종 입력 준비 `r4`와 source contract 검사 `source-checks-r4`를 시작했다. 이후 `final-batch-r4`가 core integration → app-server lib/integration → protocol → sandbox → thread-store → network → core lib → tui를 공유 Cargo cache에서 순차 실행한다. completion identity `dfa37d66-21a4-40f1-b950-cbaeaeb8f146`; 각 실제 child 종료와 로그를 기록하고 실패 시 후속 실행을 멈춘다. macOS/Linux native 검증은 여전히 미확인이다.

- `source-checks-r4` 실제 exit 0, 79 passed / 0 failed / 0 skipped. 원시 로그는 `artifacts/tasks/do1/runs/source-checks-r4/logs`에 보존했다.
- `r4` 준비는 02:35 UTC 무렵 exit 1: `Copied source differs: codex-rs/project-maintenance/src/groups.rs`. producer close/failure와 complete membership을 기록했으며 최종 batch는 시작하지 않고 completion을 cancelled 처리했다. 다른 작업의 project-maintenance 변경이 복사 중 유입된 것으로 확인했다(apply/groups/lib/registry 및 새 absent_adoption test). 해당 변경을 보존하며 다른 작업 종료 확인 전 새 freeze는 보류한다. 향후 준비 도우미도 다른 작업의 untracked engine 파일을 자동 stage하지 않고 중단하도록 제한했다.
- 기존 immutable `r3`로 `app-server-lib-diagnostic-r3`를 시작했다(session 39257, completion `751a959d-2bf7-4fbb-bfd0-24778fe9efcb`). 전체 수락을 대체하지 않는 사전 호환성 검사이며, 이 실행이 공유 Cargo cache의 유일한 소유자다. 최종 freeze 재시도는 소스 변경 안정화와 해당 소유자의 untracked 입력 정리 후 진행한다.

- `app-server-lib-diagnostic-r3`: 02:35:47–02:50:13 UTC, actual child/controller exit 0. Saved resume settings 4개와 selected/effective service tier mismatch 1개, 총 5개 통과. 컴파일 포함 약 14분26초이며 재실행은 없었다. 로그 `artifacts/tasks/do1/runs/app-server-lib-diagnostic-r3/logs`. 기존 r3 입력에 한정한 증거이며 final input 수락과 구분한다.
- 공개 API integration `app-server-diagnostic-r3`를 동일 r3로 시작했다. 완료 신호 `b392fd6b-d18a-4a1c-9bcc-adab48a390f4`; 이 실행만 Cargo cache를 사용한다. 최종 소스 안정화에 관한 사용자 답변은 아직 없으며, 다른 작업의 untracked 입력을 stage하거나 변경하지 않는다.

- 02:51 UTC 확인: 다른 작업에서 project-maintenance의 maintenance_owner/root_retirement도 수정하고 verified_junctions 테스트를 추가했다. HEAD도 `e8983f504e304c71a5d1c8d7fe5fe240cf47de47`로 이동했으나 해당 commit은 설치 정리 기록 문서 2개만 포함한다. 우리 구현은 여전히 미커밋이며, 이전 입력 증거의 HEAD/소스 identity를 변경하지 않는다. concurrent 작업 종료를 가정하지 않는다.
- 실패한 `r4` 생성물의 삭제 준비를 위해 lifecycle register request를 만들었으나 native `project_inventory register`가 `exclusive maintenance lock unavailable`로 거부했다. 우회 삭제나 잠금 조작 없이 경로를 보존한다. 소스 실패 진단과 actual exit 1은 이 기록 및 r4 failure/producer report에 남아 있다. `source-checks-r4`는 등록·검토 후 explicit defer를 적용했고 실제 remaining=true다.

- `app-server-diagnostic-r3`: 02:50:44–02:58:44 UTC, child/controller exit 101. 타입 검사와 68개 선택은 exit 0, 실행은 63 passed / 5 failed. 실패 로그는 `artifacts/tasks/do1/runs/app-server-diagnostic-r3/logs`. 담당자는 upstream 최초 설정 checkpoint의 reference_context_item 조건이 Azrael의 이른 문맥 초기화 순서와 맞지 않아 owned 최초 설정이 저장되지 않는 문제를 확인했다. 승인된 일회 저장 계약에 맞춰 session/mod.rs를 수정한다. personality는 기존 Azrael harness prompt 동작을 유지하면서 owned snapshot을 검증하고, cached instruction source fixture는 독립 프로젝트 경계를 만든다.
- `app-server-rest-diagnostic-r3`는 알려진 실패 thread_resume 필터를 제외한 revert/settings-update/compressed-rollout을 독립 진단한다. completion `687cb4ec-0b13-4ee9-92f2-9c8f974c0958`, native session `11646`. 최종 합격 판정을 대신하지 않는다.

- 재개 담당자의 수정 완료: `session/mod.rs`는 initial pending을 설정 저장 permit 안에서 검사하고 `persist_rollout_items` 성공 후에만 해제한다. 실패/취소 후 pending을 유지하며, append 성공이 불명확한 경우 idempotent owned snapshot이 재기록될 수 있다. 기존 flush/accepted-user 저장 경계는 유지한다. 상태 회귀 검사 `initial_settings_remain_pending_until_persistence_succeeds`를 영구 native core-lib 검사에 연결했다. personality는 wire prompt header 대신 실제 owned snapshot의 Friendly/None 복원을 검증한다. cached instruction fixture는 workspace 안에 `git init --quiet`로 독립 경계를 만들었다. 담당자 정적 검사 exit 0, native 재검증은 미실행이다.
- 03:03 UTC에도 다른 작업의 project-maintenance 새 `hardlink_normalization.rs`가 추가되는 등 입력이 변하고 있다. 사용자 답변이나 해당 입력 소유자의 정리가 없어 final freeze 재시도는 보류한다. 수정된 native wrapper를 포함한 source contract 회귀를 `source-checks-r5`로 다시 실행한다.

### 현재 인계 상태 (2026-10-25 03:06 UTC)

- `app-server-rest-diagnostic-r3`: 03:01:05–03:03:24 UTC, 실제 child/controller exit 0, revert 7 + settings update 12 + compressed rollout 1 = 20개 전부 통과. completion도 succeeded/exit 0으로 확인했다. 로그 `artifacts/tasks/do1/runs/app-server-rest-diagnostic-r3/logs`.
- `source-checks-r5`: 실제 exit 1, 81개 중 80 passed / 1 failed / 0 skipped. 동시 작업에서 추가한 deployment metrics 검사가 `spawnSync pwsh ENOENT`로 실패했다. PATH, 표준 PowerShell 7/7-preview 설치, WinGet Links와 artifacts/tools의 이름 일치 디렉터리에서는 실행 파일을 확인하지 못했다. 전체 호스트에 없다고 단정하지 않는다. `deploy-azrael.ps1`은 PowerShell 7.4를 요구하므로 Windows PowerShell 5.1로 우회하지 않았다. 실패 로그 `artifacts/tasks/do1/runs/source-checks-r5/logs`.
- root native wrapper Node syntax와 scoped whitespace 검사는 exit 0. 현재 실행 중인 이 작업의 검사는 없다. 이식 수정 후 압축 복구 3개, 재개 실패 5개 및 새 pending 상태 회귀는 아직 실제 재실행하지 못했다. protocol/sandbox/thread-store/tui native 검사도 미수행이며 Linux/macOS native도 미확인이다. 이전 r1/r3의 통과 수치를 수정된 전체 입력의 합격으로 간주하지 않는다.
- 재개 조건: 동시 project-maintenance 작업 소유자가 새 파일을 정리하고 소스 수정을 마치면, 그 상태를 확인해 새 immutable 입력을 준비한다. PowerShell 7.4 실행 경로를 확보한 뒤 필수 source/native 범위를 최종 입력에서 검사하고, 실패 수정·재검증 → 공유 receipt/lock/inventory의 이 작업 변경 분리 → 산출물 등록·검토·삭제 또는 구체적 defer → staged diff 확인 → 작업 단위 commit 순서로 마무리한다. 다른 작업 변경은 stage/수정하지 않는다. 현재 index에는 기존 이 작업의 신규 Rust 4개만 staged 상태다.
- 실패 원인 비교와 최종 재실행에 필요한 이전 입력·원시 로그·임시 실행 도우미는 유지한다. 관리 잠금 때문에 r4 native 등록·정리는 아직 불가했다. 임시 도우미와 중복 snapshot은 진단·재검증 후 수명주기 검토를 다시 거쳐 정리하며, 영구 회귀 검사는 선택 이식 동작을 업그레이드 시 보존하기 위해 유지한다. 필수 검증 및 정리 미완료로 commit하지 않았다. 제품 빌드·설치·배포·push는 수행하지 않았다.

### PowerShell 경로 직접 조사 후속 결과

- 사용자 지시에 따라 설치 등록과 실행 별칭을 추가 조사했다. `Get-AppxPackage Microsoft.PowerShell`에서 Microsoft Store 패키지를 발견했다. 실행 파일은 `C:/Program Files/WindowsApps/Microsoft.PowerShell_7.6.7.0_x64__8wekyb3d8bbwe/pwsh.exe`이며, `-NoLogo -NoProfile -NonInteractive -Command '$PSVersionTable.PSVersion.ToString()'` 실제 실행 exit 0, 출력 `7.6.7`을 확인했다. `C:/Users/felre/AppData/Local/Microsoft/WindowsApps/pwsh.exe` 별칭도 존재한다. PATH의 `where pwsh.exe` 실패는 설치 부재를 의미하지 않는다. PowerShell 실행 경로 확보는 해결됐다.
- 기존 검사 계약의 `AZRAEL_TEST_PWSH`를 해당 절대 경로로 이 실행에만 설정하고 `source-checks-r6`를 시도했다. `beginArtifactRun`에서 `artifacts/maintenance/lifecycles/catalog.lock` EEXIST, 실제 exit 1로 중단됐다. 검사 프로세스는 시작하지 않았고 새 결과를 합격으로 간주하지 않는다. 잠금 내용은 비어 있고 소유자를 확인하지 못했으므로 삭제·우회하지 않았다. PATH/설치/검사 코드는 변경하지 않았다.
- 후속 조사 시 HEAD는 `10d41b44`이며 project-maintenance는 `src/paths.rs`만 dirty로 보였다. 이는 해당 작업 종료의 증명이 아니므로 최종 소스 고정 가능 여부와 잠금 해소를 확인한 뒤 나머지 승인 작업을 재개한다. 앞서 PowerShell 경로를 사용자에게 요청했던 선행 조건은 더 이상 남아 있지 않다.

### PATH 확인 및 검증 재개 요청

- 사용자 지시로 사용자 PATH를 확인했다. `%LOCALAPPDATA%/Microsoft/WindowsApps`가 이미 등록돼 있어 중복 추가하지 않았다. 이 디렉터리의 `pwsh.exe` 별칭도 실제 실행 가능하다. 현재 검증 child 환경의 PATH에 해당 경로를 적용한 뒤 `Get-Command pwsh`와 `pwsh -NoLogo -NoProfile -NonInteractive ...`가 실제 7.6.7을 반환했다(exit 0). 영구 PATH 수정은 필요하지 않았다. 다음 실행에도 사용자 PATH 별칭을 전달한다.
- 잠금의 실제 소유자는 `maintenance_owner-release.exe` PID 72792, 시작 UTC `2026-10-25T04:53:25.5123415Z`다. 다른 DM-01-cache-retirement 작업의 old-copy apply 실행이며 실제 삭제 PowerShell child 48632도 살아 있다. 현재 잠금은 방치된 파일이라고 간주하지 않고 삭제·중단하지 않는다.
- 정확한 프로세스 handle과 시작 시간을 고정한 관찰 전용 대기자를 실행했다. 완료 신호 `77903bef-b8a0-41db-b2f9-fe046627809a`. 대기자 성공은 해당 프로세스 종료 관찰만 뜻하며 cleanup 성공·모든 child 종료·잠금 해제를 뜻하지 않는다. 종료 후 실제 잠금과 소스 상태를 확인하고 source-checks 및 새 immutable native 검증을 재개한다. native wrapper syntax 검사 exit 0.

- PowerShell 대기 파일 실행은 호스트 실행 정책에 의해 exit 1로 거부됐다. 정책은 변경하지 않았고 해당 완료 신호도 failed로 종결했다. 대신 Python 표준 ctypes로 OpenProcess/GetProcessTimes/QueryFullProcessImageName/WaitForSingleObject를 사용해 정확한 PID·생성 FILETIME·실행 파일 이름을 확인한 프로세스 핸들에 대기한다. 새 완료 신호 `02b2929a-40c5-495a-816a-b7a06679754f`; 단순 PID 부재를 종료 증거로 취급하지 않는다. 사용하지 못한 대기용 ps1은 일반 삭제했다.

- 06:11 UTC 첫 대기 확인 시점: waiter 완료 신호는 running이다. 원래 생성 시각과 일치하는 PID 72792 및 삭제 child 48632가 살아 있고 두 잠금도 존재한다. child 누적 user/kernel CPU 시간은 약 3422초(1333.47/2088.36초)로 관찰했다. 종료·성공·잠금 해제를 추정하지 않는다. 잠금 소유자의 종료 신호를 계속 기다리며, elapsed time 자체로 강제 해제하거나 새 producer를 시작하지 않는다.

- 06:41 UTC 두 번째 확인: 동일 owner/child와 두 잠금이 남아 있고 waiter는 running이다. 삭제 child 누적 CPU는 약 5192초로 이전 확인보다 약 1770초 증가했다. 프로세스가 종료된 상태는 아니며, 정리 결과나 완료 예정 시간은 아직 확인하지 못했다. 다음 확인 간격은 60분으로 늘리되 실제 종료 신호가 오면 즉시 재개한다. 프로젝트 관리 잠금을 우회하는 별도 검증 경로는 만들지 않는다.

- 07:08 UTC exact-handle waiter 종료 exit 0과 completion succeeded를 확인했다. 실제 두 잠금은 모두 사라졌고 이전 삭제 child/owner 직계 child도 조회되지 않았다. 이는 다른 정리 작업의 성공 결과를 대신하지 않으며, 이 작업의 검사 등록 선행 조건만 해소한다. HEAD는 `1fb084290f6793523810e044cf05a21dbbf4fb60`, 다른 task의 project-maintenance 변경은 기존 `src/paths.rs`만 dirty다. 현재 소스를 고정하는 `r5` 준비와, 실제 PATH 별칭을 전달하는 `source-checks-r7`를 시작했다. 기록된 검증 입력은 준비 완료 전까지 이전 r3을 계속 가리킨다.

- `source-checks-r7`: 실제 exit 0, 81 passed / 0 failed / 0 skipped, 약 79.6초. PATH 별칭으로 찾은 PowerShell 7.6.7을 사용했고 이전 deployment metrics 실패도 해소됐다. 로그 `artifacts/tasks/do1/runs/source-checks-r7/logs`.
- WSL readiness 재확인: `ktcloud-ubuntu-24.04`의 현재 PATH에서도 node/cargo/rustc는 발견되지 않고 python3만 `/usr/bin/python3`에 있다. 전체 설치 부재를 단정하거나 시스템 도구를 새로 설치하지 않았다. macOS는 기존 SSH skill이 요구하는 명시적 프로젝트 경로가 미확정이므로 홈 탐색·임의 checkout 선택을 하지 않았다. Windows와 별도로 남은 native 검증 범위다.

- `r5` 준비 actual exit 1: source-record의 reviewed delta가 오래된 receipt 이후 다른 작업에서 커밋된 변경을 포함하지 못했다. 준비 도우미를 `receipt.localIntegration.repositoryHead`부터의 git diff와 현재 파일 해시 비교로 수정했다. 이 비교에서 미등록된 committed project-maintenance 회귀 3개도 발견돼, 새 receipt에 tracked baseline으로 반영할 대상에 포함했다. 기존 소스 코드는 변경하지 않는다. 사용자 untracked 입력 자동 stage 금지는 유지한다.
- `r5` 종료 시 새 관리 작업(PID 73132 azrael.exe)이 catalog.lock을 보유해 closeLifecycle가 실패했다. 기존 r5 `reports/producer.json`에는 실제 exit 1/producerStopped=true/children=[]가 남아 있다. 이 근거로 supported closeLifecycle를 재시도하기 전 새 source producer를 만들지 않는다.
- 새 소유자는 장기 실행 앱이므로 앱 종료를 기다리지 않고 두 잠금 파일 삭제 이벤트를 관찰한다. `fs.watch` 대기자 completion `40da3489-569a-4ddb-9fba-363126a91898`; 성공은 두 잠금이 동시에 없음을 확인한 순간의 resource readiness일 뿐 외부 작업 성공이나 잠금 예약을 뜻하지 않는다. 그 뒤에도 실제 관리 호출의 동시성 guard를 유지한다.

- 두 잠금의 부재 이벤트 확인 후 `r5`를 원래 producer 보고서 해시와 실제 실패 exit 1로 supported closeLifecycle를 통해 종결했다(state=failed, producer=stopped). 실패를 성공으로 변경하지 않았다. 변경 목록을 보완한 새 준비 `r6`를 native session `11884`로 시작했다. 준비 완료 시에만 해당 source identity를 native 검증 입력으로 선택한다.

- `r6` source 준비 실제 exit 0, source identity `0a8f5299d4adfd065d18866959d3171b66acdd0a9fcfd7210ac6527edda970ac`, 고정 경로 `artifacts/tasks/do1/runs/r6/inputs/engine`. 새 native batch 최초 등록은 catalog.lock EEXIST로 exit 1, 검사 미시작이므로 completion `739b88ca-1cf8-4be7-83cc-496854a60c57`를 failed 처리했다.
- 반복 잠금 재획득을 처리하도록 이 작업의 임시 helper에만 event 기반 등록 대기를 추가했다. beginArtifactRun이 정확히 catalog.lock 또는 .run-claim.lock EEXIST로 거부되고 run root가 아직 만들어지지 않은 경우에만 파일 삭제 이벤트 후 원래 등록을 다시 시도한다. 다른 오류나 부분 등록은 재시도하지 않는다. 공용 관리 코드/잠금 규칙/제품 저장 방식은 수정하지 않는다. helper syntax 검사 exit 0.
- `final-batch-r6` 재시도 controller native session `68655`, completion `51ad58f8-e297-4063-9931-6f24881c0d48`. 등록 완료 전에는 Cargo child를 시작하지 않으며 nine suites를 순차 실행하고 첫 실패에 멈춘다. 시작 시 catalog.lock 해제 이벤트 대기를 확인했다. 입력과 고정 runtime host는 실행 동안 바꾸지 않는다.

- 07:54 UTC native controller 첫 확인: completion running, catalog.lock이 남아 있고 final-batch 로그 디렉터리는 아직 생성되지 않았다. 즉 Cargo 검사는 아직 시작되지 않은 등록 대기 상태다. 고정 r6을 바꾸거나 검사 producer를 중복 시작하지 않는다. 다음 fallback 확인은 60분으로 늘리며 파일 해제 이벤트로 controller가 실제 실행을 시작하고 terminal 신호로 root를 깨우도록 유지한다.

- 07:55 UTC 잠금 소유자 변경 확인: 현재 `maintenance.lock`은 DM-01의 `maintenance_owner-fast.exe` PID 64632(07:20:44 시작), 삭제 child 50436(07:27:27 시작)가 보유한다. parent/child 모두 조회되며 child 누적 CPU는 약 1634초다. 이전 앱 PID 73132의 동일 작업이 계속된다고 단정하지 않는다. 현재 active 정리 호출의 잠금을 보존한다.

- r6 core native가 08:16:09–08:36:55 UTC 실제 실행됐다. 30개(압축 실패/재시작 3, 수동 압축 2, 원격 output 23, 읽기 병렬 1, Code Mode 중단 1) 전부 통과, native child/wrapper exit 0. 로그 `artifacts/tasks/do1/runs/core-integration-final-r6/logs`, source identity는 r6과 일치한다. 최초 compile/typecheck/selection을 포함해 약 20분46초였다.
- 이후 controller가 lifecycle close 중 catalog.lock EEXIST로 actual exit 1이 됐다. 원래 전체 controller와 해당 run은 실제 실패 exit 1로 종결했으며, native child exit 0 기록은 별도로 보존했다. 원래 batch는 다른 8개 suite를 시작하지 못했다. 완료 신호가 없던 `51ad58f8-e297-4063-9931-6f24881c0d48`는 실제 terminal session evidence로 failed 처리했다.
- 임시 helper의 finish 경계에도 정확한 catalog.lock EEXIST에 한해 event 기반 대기를 적용했다. 원래 native child 결과를 변경하지 않는다. controller 실제 process exit에 completion 신호를 연결했다. native source/runtime 입력은 변경하지 않았고 helper syntax 검사 exit 0이다.
- 남은 8개 suite를 `final-batch-r6-remaining`으로 실행한다. completion `87326efe-72fb-422c-a72e-5e20ebb6677a`; core는 같은 source/runtime의 실제 exit 0 보고서를 검증해 재사용하고 그 evidence run에 dependency 참조를 둔다. 이전 controller 실패를 성공으로 바꾸거나 이미 통과한 30개를 불필요하게 재컴파일하지 않는다.

- native가 실행되는 동안 소비되지 않는 준비 r2/r4/r5의 정리를 위해 producer registry에서 정확한 grouped register request를 만들었다. 첫 native 등록 호출이 다시 active maintenance.lock으로 거부돼 실제 등록·review·삭제는 하지 않았다. 원래 source/runtime/cache 등 실행 중 소비 입력은 건드리지 않았다. 세 준비 run의 원래 상태와 경로를 보존하고 잠금 해제 후 동일 절차를 재개한다.
- 공유 파일 commit 분리 준비: Cargo.lock에는 이 작업 libc edge와 기존 다른 작업 codex-utils-process edge가 함께 있다. feature inventory에는 기존 engine.model-harness-profiles/ui.instruction-settings/tool.project-maintenance 변경과 이 작업 engine.selected-upstream이 함께 있다. SOURCE.json도 전체 입력 receipt이므로 unrelated payload를 stage하지 않는 분리·정합성 검토가 필요하다. native 결과 확인 전에는 광범위 stage/commit을 하지 않는다.

- 09:50 UTC fallback 확인: r6 app-server-lib 실제 native/controller exit 0, 5개 전부 통과. native 시작 09:00:26, 종료 09:17:53(약 17분27초, compile 포함). 이후 catalog finalization 대기는 09:39:18에 해소됐고 다음 app-server integration이 시작됐다. 대기 중 중복 Cargo를 시작하지 않았다. 현재 completion은 running이며 전체 8개 통과로 간주하지 않는다. 로그 `artifacts/tasks/do1/runs/app-server-lib-final-r6-remaining/logs`.

- `app-server-final-r6-remaining`: 09:39:24–09:52:52 UTC, actual native/controller exit 101. thread_resume 68개 전부 통과해 앞선 설정 저장/fixture 수정이 실제 검증됐다. 다음 thread_revert는 5 passed / 2 failed. 두 실패는 initialize 요청 뒤 응답 로그가 없고, 하나는 명시적 deadline elapsed, 다른 하나는 wiremock drop expected3/got0 panic이 원래 오류를 가렸다. 테스트 이름은 interrupts_active_turn_and_keeps_thread_loaded, preserves_fork_cutoff_after_cold_resume. settings-update/compressed 및 뒤 6개 library suite는 이 controller에서 실행하지 못했다. 전체 batch exit 1은 그대로 유지한다.
- 소스 변경 없이 같은 r6/env로 app-server 나머지 3개 필터를 재실행한다. run `app-server-rest-final-r6-retry`, completion `10fd0bad-4d73-45c0-b293-1d6e0ceeefaa`. native한 번에 하나를 유지한다. 기존 담당자는 초기화/timeout 경로만 읽기 전용 조사하며 소스 수정 권한은 이번 후속 조사에 없다. 단순 timeout 증가나 제품 설정 변경으로 실패를 숨기지 않는다.

- `app-server-rest-final-r6-retry`: 09:55:09–09:57:11 UTC, 실제 native/controller exit 0, revert 7 + settings-update 12 + compressed rollout 1 = 20개 모두 통과. 소스·환경·제한 시간을 바꾸지 않은 한 차례 재실행이다. 앞선 초기화 실패의 원인은 확정하지 않았으며 최초 실패 기록은 보존한다. 같은 r6의 thread_resume 68개 및 app-server lib 5개 성공 증거와 함께 API 검증 범위를 충족한다.
- 남은 protocol/sandbox/thread-store/network/core-lib/tui 6개를 `final-batch-r6-libraries`로 순차 실행한다. session `42272`, completion `70a6ab80-3fa6-4e93-b9c5-5e801b5df88c`. 기존 성공한 core/API 범위는 source identity와 실제 실행 exit 0 증거를 확인해 재사용한다. 시작 전 임시 제어 JSON의 BOM 오류 및 재사용 로그 파서의 잘못된 stdout 위치를 수정했다. 두 시도 모두 native 실행 전 실패했으며 해당 completion은 실패 상태를 유지한다. 제품 소스·고정 r6는 변경하지 않았다.
- 쓰지 않은 r2/r4/r5 준비 산출물의 native 등록을 다시 시도했으나 maintenance lock guard가 거부했다. 삭제·강제 해제·보호 우회는 하지 않았으며 정리는 미완료다.
- 10:32 UTC 확인 시점: protocol 49, sandbox 59, thread-store 2, network 322, core-lib 66개가 실제 native/controller exit 0으로 통과했다. 로그·결과는 각각 `artifacts/tasks/do1/runs/{suite}-final-r6-libraries/`에 있다. 마지막 tui suite가 시작됐으며 아직 결과가 없으므로 전체 성공으로 기록하지 않는다. 이 시점의 r2 native 등록은 잠금 guard를 통과해 실행 중이며 실제 반환 전 정리 성공을 추정하지 않는다.
- 미사용 준비 `run:do1:r2` 보존 결과: prepare-verification.cjs r2 actual exit 0 / signal null / producerStopped true / children [] / membership_complete true. native 검사는 이 입력을 사용하지 않았고 consumer가 없다. 외부 지정 임시 경로 `artifacts/verification/do1-r2`의 생애주기 선언에 generated/protection_known 표기가 빠져 최초 검토가 삭제를 막았다. 사전에 이 작업이 생성한 명시적 임시 경로, native 측정 0 bytes, 종료된 producer와 무참조 상태를 확인한 뒤 supported recordLifecycle API로 미기재 표기를 보완했다(revision 3). refresh_group 후 두 멤버 모두 blockers []인 현재 토큰으로 delete를 요청했다. 대상은 191852659 bytes의 r2 준비와 빈 임시 경로이며 실제 삭제 결과는 아직 확인 전이다. 제품 storage 코드와 다른 작업의 자료는 변경하지 않았다.
- r2 native apply 결과: group status deleted, 두 멤버 모두 deletion.status deleted / remaining false / error null. 물리 회수 바이트 수는 도구가 제공하지 않아 추정하지 않는다.
- r6 마지막 tui 검사는 10:30:15–10:37:01 UTC actual exit 101, E0063으로 실행 전 타입 검사 실패. owned_transcript_input_tests.rs의 Turn 하나에 root_resume_wait, caption_replay.rs의 Turn 둘에 parent_turn_id/turn_trigger가 빠져 있었다. 현재 소스도 동일해 None 5줄을 추가했다. 제품 동작은 바꾸지 않았다. rustfmt 1.95.0 및 기존 CRLF bytes 보존, diff --check(cr-at-eol) exit 0. 이 두 prerequisite fixture 소유 경로와 실제 세 테스트를 selected-upstream 보존 범위에 포함했다.
- r6는 621개 native 검사가 통과했지만 tui 필수 검사 실패 및 소스 변경으로 최종 수락 입력이 아니다. `r7` 고정 입력 준비를 session 37094로 시작한다. 전체 엔진 identity 계약에 따라 새 입력에서 다시 검증하며 r6 receipt를 새 소스의 성공으로 전용하지 않는다. 먼저 수정된 tui 타입 검사/실행으로 재실행 위험을 줄인 다음 나머지 필수 범위를 수행한다.
- 커밋 분리 읽기 전용 검토: SOURCE recorder는 실제 전체 destination bytes를 측정하며 expected-path는 포함 필터가 아니다. 현재 HEAD의 maintenance manifest에는 이미 codex-utils-process가 들어 있고 lock 누락만 pre-existing dirty라 libc 줄만 커밋한 후보는 --locked 불일치 위험이 있다. SOURCE 부분 hunk 수작업 분리나 전체 사용자 변경 commit을 진행하지 않았다. 현재 결합 source receipt와 task-only commit identity의 분리는 미해결이다.
- `source-checks-r8`: actual exit 0, 81 tests / 81 pass / 0 fail / 0 cancelled / 0 skipped, 78011ms. Node의 spec reporter 형식으로 출력돼 임시 요약 정규식 배열은 비었지만 stdout 원문 마지막 통계와 실제 exit를 직접 확인했다. 로그 `artifacts/tasks/do1/runs/source-checks-r8/logs`. native register/review/apply defer 완료, 최종 native 수락과 독립 결과 보존 후 재검토한다. r2는 실제 멤버 부재와 무참조 상태를 supported finalize로 대조한 뒤 lifecycle 메타데이터도 정리했다.
- `r7` 준비 actual exit 0. source identity `820d4b107b9d986820e5bddd25b08e890fdb7fb867a39667aff86f0826a13d5a`, 고정 root `artifacts/tasks/do1/runs/r7/inputs/engine`. 먼저 `tui-prerequisite-r7`를 session 82736 / completion `67f18f0b-e18b-4fa4-8cd9-8c559047dc06`으로 시작했다. 명령은 필수 타입 검사·선택·실행 gate와 실제 4개 선택 필터를 사용한다. 이 native producer만 공유 Cargo cache를 사용한다.
- 미사용 r4/r5 보존 진단: 둘 다 state failed / producer stopped / outcome failure / actual exit 1 / references []였다. r4는 source-snapshot이 `Copied source differs: codex-rs/project-maintenance/src/groups.rs`로 거부했다(producer evidence SHA256 0cbed5831a6e72552b7bb694b6b70d8f2860ca7f88a69cc5d69fe4f87365b183). r5는 source-record의 reviewed delta가 receipt 이후 커밋된 apply.rs/bin/maintenance_owner.rs/groups.rs/lib.rs/registry.rs/tests/root_retirement.rs 등을 빠뜨려 거부했다(producer SHA256 68cf02564714641295f5ac5af584dd7d368778e6602be23f9e5755002c6924cf). r6/r7에서 receipt HEAD 기준 delta 비교로 해결했으며 두 실패 입력을 native 수락에 사용하지 않았다. r2와 같은 명시적 owned temporary 경로의 미기재 보호 속성은 supported recordLifecycle로 보완했다. r4 group native register/review 후 두 멤버 blockers []를 확인해 삭제를 결정한다. 기존 실패 결과는 성공으로 바꾸지 않는다.
- r4 실제 apply는 maintenance lock guard가 실행 전 거부해 삭제하지 못했다. r4/r5 payload는 남아 있고 정리는 보류다. TUI 선행 검사 완료 후 남은 native 묶음을 시작하고, 이후 잠금 조건이 허용할 때 현재 상태를 다시 검토한다.
- 11:09 UTC TUI 선행 검사 확인: 필수 typeCheck 실제 exit 0(10:49:54 시작, 408202ms)으로 기존 E0063 필드 누락이 해소됐다. 이후 selection/test executable 준비 단계는 아직 결과를 내지 않았다. completion running이며 전체 4개 테스트 통과로 보지 않는다. maintenance.lock은 PID 73132를 표시해 r4/r5 cleanup을 재시도하지 않았다. 파일 guard 해제나 프로세스 종료를 추정하지 않는다.
- `tui-prerequisite-r7`: 10:49:54–11:12:42 UTC, native/controller exit 0, 고정 r7 identity 일치, 필수 typecheck/선택/실행 후 4개 모두 통과. source 변경 없이 `final-batch-r7`의 전체 9개 suite를 native session 55548 / completion `1879037b-9ab7-45b1-a2d9-1ad9b6d8610e`으로 시작했다. 최초 core-integration 시작을 확인했으며 이 producer만 공유 Cargo cache를 사용한다. 최종 TUI 재실행은 같은 입력·설정에서 전체 묶음의 끝에 수행한다.
- r4 current native review blockers []를 재확인한 뒤 apply delete가 완료됐다. group status deleted, 두 멤버 remaining false / error null이며 supported finalize도 remaining [] / references [] / blockers []로 완료했다. 이어 r5 native register는 다른 maintenance lock guard가 거부해 실제 등록·삭제하지 못했다. r5 실패 진단과 payload는 보존하고 다음 자원 경계에서 재검토한다.
- `final-batch-r7` actual exit 1: core-integration 30개 actual exit 0(11:23:16–11:37:51), app-server-lib 5개 actual exit 0(동일 r7), app-server selection/build exit 101로 API 실행 전 중단됐다. 첫 원인은 link.exe LNK1201(azrael.pdb 쓰기 실패)이고 뒤의 zero-tests guard는 빌드 실패로 선택 목록이 없어서 발생한 2차 오류다. C: 여유 공간은 1308147712 bytes였다. 제품 소스와 검증 설정은 바꾸지 않는다.
- 공간 복구 결정: Cargo 로그가 정확한 실행 경로를 입증하고 성공 보고서·생성 시각·단일 hardlink·현재 무실행을 확인한 네 테스트 exe/PDB 쌍만 retirement 대상으로 등록했다. stem은 `codex_core-ee1b27bb08f71819`(r6 core-lib66), `all-c71321a47dbe4ed9`(r7 core30), `codex_app_server-ab0fa3885fa06f43`(r7 lib5), `codex_tui-128ff604062e1c7e`(r7 TUI4). 총 logical bytes 5249758720이며 실제 물리 회수량을 뜻하지 않는다. 성공 보고서·원문 로그·소스는 cache 외부에 보존한다. 기존 cargo-target-owner API로 PID13992가 독점 cleanup guard를 획득했고 다른 Cargo와 충돌을 막는다. 공유 라이브러리·다른 owner 산출물·실패한 현재 링크 파일은 대상에서 제외한다. native group `do1-unused-native-outputs-r1`의 8멤버 현재 review blockers []를 확인했다.
- 이후 같은 r7의 core30/lib5/TUI4 성공 보고서를 재사용하고 나머지 API/protocol/sandbox/thread-store/network/core-lib 6개만 실행한다. 임시 batch helper의 after-verified 모드는 세 결과의 정확한 sourceIdentity/suite/exit0/실제 통과 통계를 검사한다. 새 소스 동등성 예외나 gate 생략이 아니며 삭제한 테스트 실행 파일을 다시 만들지 않는다.
- `do1-unused-native-outputs-r1` native apply: 8개 모두 status deleted / remaining false / error null, group deleted. 실제 결과를 확인한 뒤 독점 cleanup guard를 해제했고 guard actual exit 0 / completion succeeded를 확인했다. 이후 C: 사용 가능 공간은 6532415488 bytes로 관측했다(다른 동시 작업까지 분리한 물리 회수량이라고 주장하지 않는다). `final-batch-r7-verified-rest`를 completion `e81ec601-e77f-4bf2-b04a-d59b4d3c504e`으로 시작해 동일 r7의 남은 6개 suite를 수행한다.
- 남은 r7 batch native session 78819의 API 시작을 확인했다. r5는 재등록/현재 검토 blockers []/apply delete를 완료했고 두 멤버 remaining false / error null, supported finalize remaining [] / references [] / blockers []로 종료했다. 따라서 미사용 준비 r2/r4/r5의 정리는 완료됐다.
- 공유 target의 패키지 해시 경로는 후속 Cargo가 재생성할 수 있다. 최종 native 종료 후 retirement 대상 8개 정확 경로의 재생성 여부를 대조하고, 재생성됐다면 현재 producer provenance로 full 재등록·검토하여 그룹 측정/보호 상태를 맞춘다. 과거 deleted 기록이나 registered 검증을 새 payload 부재의 증거로 재사용하지 않는다. helper/control/manifest는 이 재대조와 최종 검사 종료까지 유지한다.

## 최종 소스 반영·검증 결과 (2026-10-25)

- 승인된 선택 backport를 소스에 반영했다. 저장 공간 방식, 기업용 MCP 인증, 원격 credential masking, 새 비동기 background compaction은 포함하지 않았다. 제품 전체 0.164 업그레이드나 버전 변경이 아니며 제품 빌드·패키징·설치·push는 실행하지 않았다.
- PowerShell 7.6.7 실제 실행 exit 0. 사용자 PATH에 WindowsApps가 이미 등록돼 있어 영구 중복 항목을 추가하지 않았고, 이를 누락한 검사 프로세스 PATH에 반영했다.
- 최종 고정 엔진 `r7` identity `820d4b107b9d986820e5bddd25b08e890fdb7fb867a39667aff86f0826a13d5a`. 구현 소유 엔진 파일 71개는 현재 작업 파일과 r7의 bytes/hash가 모두 일치한다(missing [] / changed []). SOURCE 원문을 포함하는 전체 엔진 identity와 검사 설정을 유지해 결과를 재사용했다.

| Windows x64 실제 검증 범위 | 통과 수 | 실제 종료 |
| --- | ---: | --- |
| core integration: 압축 실패·수동 압축·원격 exec 출력·읽기 병렬·Code Mode interrupt | 30 | 0 |
| app-server lib 설정 snapshot | 5 | 0 |
| app-server resume/revert/settings/compressed rollout | 88 | 0 |
| protocol permissions | 49 | 0 |
| sandbox lib (Windows에서 선택되는 검사) | 59 | 0 |
| thread-store 압축 경로 | 2 | 0 |
| network-proxy lib | 322 | 0 |
| core lib exec/permissions/최초 설정 저장 | 66 | 0 |
| TUI fork 및 수정한 fixture 회귀 | 4 | 0 |
| **Native 합계** | **625** | **모두 0** |
| 최종 source/feature/pipeline/Cargo 보존 계약 | 81 | 0 |

- 원문 증거: `artifacts/tasks/do1/runs/final-batch-r7-verified-rest/reports/result.json`과 그 결과가 가리키는 동일 r7 core/lib/TUI 성공 보고서, `{suite}-final-r7-verified-rest/logs`. 남은 6개 native는 12:01:54–12:23:07 UTC에 수행됐다. 이전 링크 실패·초기화 실패 controller 결과는 실패 상태 그대로 보존했으며 성공으로 변경하지 않았다.
- `source-checks-r9` actual exit 0, 81 tests / 81 pass / 0 fail / 0 cancelled / 0 skipped, 29178ms. 로그 `artifacts/tasks/do1/runs/source-checks-r9/logs`. 추가 설치나 실제 provider 요청 없이 실행했다.
- 재현 환경과 runtime pin은 `final-batch-r7-verified-rest/reports/verification-input.json`, `runtime-host-input.json`에 보존했다. Code Mode host는 설치된 공식 extension의 고정 복사본이며 SHA256 `ec91f7a04dcb1a36f0e2ed87885777bf78900c2ea3295e82621c5721fd5d9f41`이다. 선택된 interrupt 실제 검사는 통과했지만 source-built host나 전체 제품 호환성 수락을 뜻하지 않는다.

### 정리와 보존

- 미사용 준비 r2/r4/r5는 native review/apply로 실제 삭제했고 supported finalize로 멤버 부재·무참조를 확인했다. 원인은 위 기록에 독립적으로 보존했다.
- 디스크 부족을 해결하기 위해 소유권과 실제 실행 증거가 있는 exe/PDB 8개만 등록·검토·삭제했다. 후속 core-lib 실행이 두 경로를 재생성한 것을 확인해 최종 r7 producer 증거로 full 재등록·검토한 뒤 그 두 파일도 삭제했다. 최종 그룹 8개 모두 remaining false이고 독점 Cargo cleanup guard의 actual exit 0과 해제를 확인했다. 다른 owner의 캐시와 공유 라이브러리는 삭제하지 않았다.
- 모든 task helper producer 종료를 확인한 뒤 일회 실행 helper·waiter·제어 JSON을 일반 삭제했다. work 폴더에는 이 기록과 native 그룹의 보호된 소유권/멤버십 증거 `native-output-retirement.json`만 남겼다. 이 JSON은 삭제된 그룹의 감사·소유권 증거이므로 유지한다.
- 새 Rust 회귀와 `check-selected-upstream-native.cjs`는 선택 backport의 제품 동작·업그레이드 보존 계약에 포함돼 유지한다. 임시 존재/문구 검사가 아니다.
- 최종 로그·r7 고정 입력·runtime pin, 과거 실패 진단과 혼재 provenance 검토에 필요한 입력은 보존한다. 재검토 조건은 task-only provenance/커밋 분리 해결과 해당 증거 검토 완료이며, 그때 현재 참조·보호·멤버십을 새로 검토한다. 추가 의존성 edge 보강과 최종 두 evidence 그룹의 native 재등록은 다른 작업의 catalog/maintenance lock guard가 거부해 수행되지 않았다. 기존 producer 기록과 원문 결과는 보존했으며 registry를 직접 편집하거나 guard를 우회하지 않았다.

### 남은 제한과 커밋

- Linux bwrap/DNS 통합 및 macOS Seatbelt/alias의 native OS 분기는 검증하지 않았다. WSL readiness와 Windows 검사로 해당 OS 수락을 주장하지 않는다. macOS의 명시적 checkout 경로도 미확정이다.
- 작업별 커밋은 보류했다. 사전 유지보수 의존성 `codex-utils-process`의 lock 보완 1줄과 이번 protocol `libc` 1줄이 Cargo.lock에 혼재하고, SOURCE는 사전 사용자 변경을 포함한 전체 실제 bytes를 측정한다. 현재 HEAD의 maintenance manifest에는 이미 해당 의존성이 있어 기존 줄을 제외한 후보의 --locked 일치도 별도 검증이 필요하다. 지원 recorder에는 index-only 포함 필터가 없으며 임의 receipt hunk 분리나 사용자 변경 전체 stage는 하지 않았다. 타 owner의 baseline 통합 또는 별도 task-only 후보 측정·검증 후 커밋해야 한다.
- 구현 소스·보존 계약·문서는 작업 공간에 남아 있다. provenance를 위한 새 Rust 파일 4개의 기존 task staging은 유지했고, 사전 사용자 변경과 다른 작업의 commit/index를 덮어쓰지 않았다.

## 초기 조사 단계의 근거와 검증 한계

- 선택 검토의 upstream 1차 소스: [압축 #53932](https://github.com/openai/codex/pull/53932.patch), [background #55581](https://github.com/openai/codex/pull/55581.patch), [압축 이력 재개 #54008](https://github.com/openai/codex/pull/54008.patch), [설정 복원 #55923](https://github.com/openai/codex/pull/55923.patch), [권한 #53150](https://github.com/openai/codex/pull/53150.patch), [config 복원 #53419](https://github.com/openai/codex/pull/53419.patch), [network 회귀 #53424](https://github.com/openai/codex/pull/53424.patch), [TUI permission hold #55682](https://github.com/openai/codex/pull/55682.patch).
- 도구·인증 1차 소스: [읽기 병렬화 #52245](https://github.com/openai/codex/pull/52245.patch), [Code Mode interrupt 기본값 #51835](https://github.com/openai/codex/pull/51835.patch), [EMA runtime #55334](https://github.com/openai/codex/pull/55334.patch), [grant/retry #55859](https://github.com/openai/codex/pull/55859.patch), [confidential OAuth #56001](https://github.com/openai/codex/pull/56001.patch), [remote Bash #54309](https://github.com/openai/codex/pull/54309.patch), [remote Zsh #54432](https://github.com/openai/codex/pull/54432.patch), [remote providers #56049](https://github.com/openai/codex/pull/56049.patch).
- 저장 공간 1차 소스: [managed release #53827](https://github.com/openai/codex/pull/53827.patch), [standalone install #55149](https://github.com/openai/codex/pull/55149.patch), [marketplace staging #55689](https://github.com/openai/codex/pull/55689.patch), [legacy staging #55690](https://github.com/openai/codex/pull/55690.patch), [log bound #55856](https://github.com/openai/codex/pull/55856.patch). 저장 공간 담당은 patch endpoint rate limit 이후 같은 OpenAI PR API의 patch 응답으로 필요한 hunk를 확인했다.
- 명령·보안 1차 소스: [local drain #52652](https://github.com/openai/codex/pull/52652.patch), [watcher cleanup #53331](https://github.com/openai/codex/pull/53331.patch), [remote final output #53622](https://github.com/openai/codex/pull/53622.patch), [DNS #51650](https://github.com/openai/codex/pull/51650.patch), [credential alias #52661](https://github.com/openai/codex/pull/52661.patch), [Host header #53506](https://github.com/openai/codex/pull/53506.patch), [macOS metadata #54273](https://github.com/openai/codex/pull/54273.patch), [bwrap lookup #55384](https://github.com/openai/codex/pull/55384.patch).
- 공식 RSS 실제 HTTP 200 조회: https://developers.openai.com/codex/changelog/rss.xml → https://learn.chatgpt.com/docs/changelog/rss.xml . XML의 CLI 항목과 릴리스 요약을 파싱했다.
- 0.164.0: https://developers.openai.com/codex/changelog/#github-release-421457270
- 0.163.0: https://developers.openai.com/codex/changelog/#github-release-414286110
- 0.162.1: https://developers.openai.com/codex/changelog/#github-release-408271623
- 전체 changelog HTML은 web 도구의 4MB 제한으로 열리지 않아 공식 RSS를 조회했다. PowerShell redirect 오류는 Node fetch로 해결했다.
- 설치 `.azrael-official-ui.json`, `out/azrael-runtime.json`, runtime `build-info.json`과 현재 engine source receipt를 대조했다. 최종 메타데이터 조회 및 RSS 파싱 exit 0.
- 바이너리 재해시·실행·빌드·회귀 테스트는 수행하지 않았다. 최신 upstream과 Azrael 전체 diff 또는 cherry-pick 포함 여부의 전수 감사도 수행하지 않았다.
- receipt가 가리키는 과거 원본 경로는 현재 존재하지 않는다. 기록된 출처를 직접 재현 검증했다고 주장하지 않는다.
- 제품 코드·설치·기존 작업은 변경하지 않았다. 조사 기록만 보존한다. 할당용 임시 본문은 ordinary unlink로 제거했다. 최초 본문의 PowerShell 파이프 인코딩 손실을 확인하고 본 문서를 UTF-8 직접 쓰기로 보정했다.
