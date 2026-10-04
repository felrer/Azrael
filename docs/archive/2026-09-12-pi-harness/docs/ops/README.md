# Operations

This is the entry point for repeatable operational procedures such as local development, validation, deployment, and incident response.

## Verified local commands

Run from the project root on Windows:

```powershell
npm install
npm run typecheck
npm run test:probes
npm run test:contracts
npm run test:integration -- process-shell
npm test
```

Stage 8–10의 최종 Windows 검증, package audit와 복구 인계는
[Stage 8–10 verification](stage8-10-verification.md)을 따른다.

`azrael-ex/` VS Code extension의 F5 개발, typecheck/unit/Extension Host/visual gate,
VSIX package-audit-new-profile smoke와 artifact cleanup은
[azrael-ex development and verification](azrael-ex-verification.md)을 따른다.
이 절차에는 protocol v2 profile Session Broker, migration 005 writer CAS, 외부 owner read-only open,
36×52 writer power control, Broker 진단과 retained-work 기반 안전 종료 검증이 포함된다. 실제 live
provider 두-window E2E와 credential refresh round-trip E2E는 아직 자동화 범위가 아니다.

## Workspace registry 운영 경로

- `폴더 추가`는 Main의 Electron directory-only dialog를 거쳐 Core registry에 저장한다. Renderer는 path나 trust를 session 생성 명령에 전달하지 않고 Workspace ID만 전달한다.
- 활성 Workspace와 trust는 SQLite migration 005의 `workspaces`/`workspace_state`가 소유한다. 목록 제거는 `registered = 0` tombstone이며 프로젝트 파일, Pi JSONL, session metadata를 삭제하지 않는다.
- session 생성과 catalog discovery는 각각 `SessionManager.create(cwd)`와 `SessionManager.list(cwd)`를 호출한다. 별도 session root 설정이나 앱 자체 경로 계산은 없다.
- Workspace가 사라지거나 접근 거부되면 등록과 cached catalog는 유지된다. 경로를 복구하거나 같은 canonical 폴더를 다시 추가하면 기존 identity와 metadata가 재사용된다.
- 실행 중 Workspace 전환/활성 Workspace 제거는 conflict로 거부된다. 실행을 중지한 뒤 다시 시도한다. idle runtime은 먼저 detach된 후 active selection이 commit된다.

관련 회귀 검증은 다음과 같다.

```powershell
npm run typecheck
npm run test:contracts
npx vitest run tests/integration/migrations.test.ts tests/integration/workspace-store.test.ts tests/integration/workspace-coordinator.test.ts tests/integration/workspace-renderer-state.test.ts tests/integration/pi-default-session-root.test.ts
```

Stage 5/6 변경을 인계하거나 회귀 검증할 때는 다음 범위를 함께 실행한다.

```powershell
npm run typecheck
npm run test:contracts
npm run test:integration -- queue-state-machine host-recovery context-capsules attachments file-access-policy pi-queue-bridge context-renderer
```

위 통합 검증은 queue state/recovery, Pi queue evidence, capsule/shelf, attachment policy,
canonical file access, transferred-context rendering을 확인한다. 테스트는 임시 SQLite와
fake Pi session/fixture를 사용하며 인증된 외부 provider나 실제 모델 네트워크 호출은 하지
않는다.

## Stage 7 compaction/context 운영 경로

Stage 7을 인계하거나 회귀 검증할 때는 다음을 실행한다.

```powershell
npm run typecheck
npm run test:contracts
npm run test:integration
npm run package:win:probe
npm run test:stage7-smoke
```

`test:stage7-smoke`는 현재 packaged executable에서 격리된 user-data/profile을
생성하고 필수 migration 1–4와 이후 migration, `compaction_records`/`context_snapshots`, public Pi entry
idempotency와 reopen을 확인한다. credential이 없는 profile에서 실행하며 Pi Host의
`allowModelNetwork: false`를 사용하므로 provider/model network request나 비용을
발생시키지 않는다. 먼저 `npm run package:win:probe`를 실행해
`out/Pi Harness-win32-x64/Pi Harness.exe`를 현재 source로 재생성해야 한다.

Compaction은 다음 경계를 따른다.

- `manual`/`milestone`은 preview revision을 확인한 뒤 Main이 Pi public
  `AgentSession.compact()`로 전달한다. `threshold`/`overflow-recovery`는 Pi trigger를
  같은 normalized lifecycle에 매핑한다. 실행 중 turn, unresolved tool call 또는 stale
  preview는 conflict로 끝낸다.
- Pi `session_before_compact`가 `compaction.started`를, Pi가 public
  `CompactionEntry`를 append하고 current context를 재구성한 뒤
  `compaction.completed`를 보낸다. Core는 공개 checkpoint/경계/token label만
  `compaction_records`에 idempotent upsert한다.
- reasoning-aware strategy는 R1 public API gate와 같은 provider/model 조건을 만족할
  때만 선택한다. synthetic encrypted reasoning은 provider adapter 입력에서만 opaque하게
  유지되며 event/SQLite/log/snapshot/renderer에는 나타나지 않는다. provider 거절,
  mismatch, malformed checkpoint는 한 번만 `portable-fallback`으로 전환하고 두 경로가
  실패하면 completed entry/context mutation 없이 기존 context를 유지한다.
- `shell.context.snapshot`은 Pi provider total과 Core local component estimate를
  합치되 `exact`/`estimate`/`unavailable` label을 유지한다. `Navigate to
  pre-compaction point`와 `Fork from pre-compaction point`는 Pi tree action이며 기존
  JSONL/compaction entry를 삭제하지 않는다.

### Live provider probe (opt-in only)

R1 자체는 fixed fake Responses adapter로 검증했다. 실제 OpenAI/provider probe는
기본 test/CI/package smoke에 포함하지 않는다. 이를 운영 환경에서 별도로 추가할 때는
명시적 credential, provider/model, 네트워크 승인, 예상 비용/rate limit, temporary
session과 captured payload cleanup을 먼저 정하고 이 문서를 갱신한다. hidden reasoning,
credential과 provider transport payload는 diagnostic bundle이나 durable app DB에
복사하지 않는다.

### 장애 대응과 복구

- migration 004 실패: migration runner가 timestamped backup을 만들고 실패 시 이를
  복원한다. renderer를 유지해야 하는 호출자는 `openDatabaseWithRecovery`의 read-only
  metadata를 표시한다.
- compaction 실패/abort: `compaction.failed`와 `contextPreserved: true`를 표시하고
  자동 재시도하지 않는다. 원인 확인 후 새 preview revision으로 사용자가 다시 요청한다.
- Core projection 실패: Pi JSONL의 public compaction entry는 이미 원본이므로 다음
  `core.compaction.rebuild`/index pass에서 projection을 재구축한다. 동일
  `pi_entry_id`는 중복 card를 만들지 않는다.
- pre-compaction 복원: navigate 또는 fork를 사용한다. 현재 branch와 기존 entry를
  삭제하는 undo/restore 동작으로 취급하지 않는다.

## Stage 5/6 운영 경로

- 실행 중 steer/follow-up은 Main의 `shell.queue.dispatch`를 통해 Core ledger에 먼저 기록한다. `queued` 항목만 수정·재정렬·취소할 수 있고, acceptance 뒤에는 내용이 잠긴다.
- Pi acceptance가 없거나 user entry를 고유하게 확인할 수 없으면 queue를 `uncertain`으로 두고 자동 재전송하지 않는다. 사용자가 recovery card에서 `resend as new item` 또는 `dismiss`를 명시적으로 선택한다.
- abort는 Pi queue를 회수한 후 queued text를 draft로 복원한다. Host crash 뒤 `needs-attention`이 표시되면 JSONL/queue journal을 확인한 뒤에만 후속 조치를 한다.
- file drop은 preload의 opaque token으로 시작해 Main `FileAccessPolicy`에서 canonical path, workspace/external approval, type/size/stat/checksum을 검사한다. workspace 밖은 매 canonical file/directory scope에 대해 명시적으로 승인한다.
- text/image/binary/directory 판정 이유는 128 KiB, 16k estimated-token, 10 MiB image 정책을 기준으로 표시한다. reference drift는 경고 후 재검토하며 파일을 조용히 갱신하지 않는다.
- context shelf 항목은 `shell.context.send`가 prompt에 결합하고 Pi acceptance가 확인된 뒤에만 consumed 처리한다. 전송 실패 시 shelf 항목은 남아 있어 재검토할 수 있다.

Build the Forge x64 Webpack bundle, then exercise its Electron runtime gates:

```powershell
npm run package -- --platform win32 --arch x64
npm run test:bundle-probe
npm run test:stage34-smoke
npm run test:stage56-smoke
npm run package:win:probe
npm run make -- --platform win32 --arch x64
```

Expected artifacts:

```text
out/Pi Harness-win32-x64/Pi Harness.exe
out/Pi Harness-win32-x64/resources/app.asar
out/make/squirrel.windows/x64/Pi Harness-0.1.0 Setup.exe
out/make/squirrel.windows/x64/pi_harness-0.1.0-full.nupkg
```

If `ELECTRON_RUN_AS_NODE=1` exists in the parent environment, the wrapper and probe scripts remove it for their child processes. Do the same before manually launching Electron.

## Pinned packaging runtime

Forge 7.11.2 currently uses `@electron/packager` 18.x. On Node 24/26 its `extract-zip` path can silently exit at `Finalizing package` without creating `out/`; the upstream report also identifies Node 22 as the temporary workaround ([Electron Forge #4282](https://github.com/electron/forge/issues/4282)). The application still uses the workstation's Node 26 development environment, while `scripts/run-forge.mjs` runs only Forge package/make with the exact `node-win-x64@22.23.2` development dependency. Do not replace that wrapper with a direct Forge call until Forge upgrades its packager/extractor and the package probe passes on Node 26.

`npm run package:win:probe` is the packaging acceptance command: it creates the unpacked application, verifies the executable and ASAR, launches the packaged executable with Playwright, confirms the preload handshake, and closes it.

`npm run test:bundle-probe` verifies the packaged utility boundary can import the public Pi SDK and reopen a WAL SQLite database, and that Electron `safeStorage` can round-trip. `npm run test:stage34-smoke` verifies session creation/placeholder resume, Core DB reopen, draft recovery, and reversible archive metadata. `npm run test:stage56-smoke` verifies migrations 002/003, crash uncertainty without automatic resend, recovery persistence, context shelf durability, and the opaque file-drop pipeline without calling a provider. Run `npm run package` first so these commands exercise the current unpacked executable.

`npm run test:stage7-smoke` verifies migration 004, public compaction/context projections,
Pi entry idempotency and reopen. It intentionally does not call a provider.

## Dependency audit note

`npm audit --omit=dev` reports zero production dependency vulnerabilities. The full development tree currently reports advisories in build/test tooling; do not run `npm audit fix --force` because it may replace pinned Electron/Forge/packaging-runtime dependencies with breaking versions.
