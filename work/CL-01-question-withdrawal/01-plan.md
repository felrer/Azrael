상태: 구현 및 관련 검증 완료. 전체 스키마 검사 4건은 기존 기준 불일치로 실패하며, 설치·배포·타 플랫폼 검증과 태스크 커밋은 수행하지 않았습니다.

# 질문 철회와 큐 보류

## 목표·권한·범위
질문 도구가 만든 미응답 질문이 있으면 턴 종료 후 큐 자동 전송을 보류한다. 모델은 불필요해진 질문을 ID로 철회한다. 해소와 철회는 구분하지 않는다. 질문 도구 설명에 철회 지침 한 문장만 추가하며 종료 시 추가 추론은 없다. 질문 ID·상태 저장, 답변과 철회 경쟁 보호, 재시작 복원, 철회된 질문의 비활성 접힌 기록을 포함한다. 일반 문장 질문 판별은 제외한다.
구현·관련 검증·문서·태스크 커밋은 승인되었다. 전체 제품 빌드·설치·배포는 제외한다. Windows x64/Linux x64/macOS ARM64 공통 의미이며 실제 수행 검증 환경은 구분해 기록한다.

## 소유권과 순서
루트: 공유 계약, UI·호스트 통합, 문서와 최종 수용. 읽기 전용 조사 담당: 엔진 저장·답변·큐 경계. 기존 수정은 보존한다.
기존 경로 조사 → 질문 ID/답변/철회 계약 → 엔진과 UI 구현 → 관련 테스트·밝은/어두운 테마 상호작용 → diff 검토·산출물 정리·커밋.

## 보존과 검증
기존 중단, 계정 전환, 압축 순서, 입력 승인·중복 방지 계약을 보존한다. 남은 질문 보류, 마지막 철회 후 진행, 부분 철회 보류, 답변 후 재개, 재시작 복원, 중복 철회, 답변/철회 경쟁, 기존 보류 유지가 필수 사례다.
새 로그·테스트 산출물·캐시는 실행 전 경로와 소유자를 지정한다. 결과, 실제 종료 코드, 로그 경로, 플랫폼별 미검증 범위, 정리 판단을 이 기록에서 유지한다.

## 구현 경계와 진행
- 기존 화면의 질문 ID `JSON.stringify(["request_user_input_async", sourceItemId, index])`와 답변 envelope를 재사용한다. 일부 철회 후에도 원래 index를 유지한다.
- 엔진 담당: 질문 payload, 저장/재생, 질문 도구·철회 도구, 답변 승인, 큐 admission과 `pendingQuestionCount`. UI 담당: 질문 상태·접힌 기록, 실제 native JSX/React/CSS 렌더 검증. 루트: 큐 화면·legacy 자동 전송 guard, namespace/보존 인벤토리/검증 통합.
- 자동 전송만 질문 대기로 보류한다. 명시적 send-now는 기존 사용자 권한을 보존하고 질문 답변으로 간주하지 않는다. 엔진은 `queue_user`로 이 경로를 구분한다.
- 표준 라이브러리·기존 rollout/질문 UI/큐 owner를 확장하며 새 외부 의존성은 추가하지 않는다.

## 검증 근거
- Windows 큐 source 6건: maintenance run `run-45928-778-1792337882437553400`, 실제 exit 0. 직전 실행은 10초 제한(exit 124)으로 완료 증거가 부족했으며 AST 재사용으로 중복 파싱을 줄인 뒤 새 실행이 통과했다.
- legacy 큐/승인 보존 33건: 실제 exit 0, `artifacts/logs/question-withdrawal/source-1/queue-rerun.log`. 첫 실행에서 새 fixture의 비동기 초기화 누락 두 건을 수정했다. 마지막 질문 제거 후 재개, 조회 실패 시 보존, 명시적 send-now를 실제 coordinator로 확인했다.
- 화면: `artifacts/logs/question-withdrawal/evidence/summary.json`, 실제 exit 0, 밝은/어두운 테마 20건. 실제 질문 철회 boundary와 native 큐 상태 JSX fragment, keyboard disclosure, 부분 철회 ID 보존, 좁은 폭을 확인했다. 전체 앱 provider graph, 설치 앱, Linux/macOS 수용은 별도다.
- 산출물 소유: `run:CL-01-question-withdrawal:source-1`과 `run:CL-01-question-withdrawal:render-1`. 렌더 fixture/profile은 담당 Chrome PID 39228 exit 0 확인 후 정리 심사를 위해 보존 중이다. 로그는 최종 검증 근거로 보존한다.
- 엔진 원어민 검증은 구현 안정화 후 고정된 입력과 단일 Cargo cache owner로 수행한다. 현재 환경 여유 메모리 약 4 GiB를 확인했으며 병렬 컴파일을 늘리지 않는다.


- Namespace/queue/input/compaction source integration: 52 tests, exit 0 (`source-1/integration.log`). Five pinned assets passed the full transform pipeline and syntax checks, exit 0 (`source-1/transforms.log`). Queue/recovery test selection passed after updating its expected owner count (`source-1/selection-rerun.log`).
- Native run native-1: frozen source SHA256 `ddf26a6e7c9296ecbf8fc6a5d68fd148c76a51b1c96bd1951827aa35b0d002e8`; started 2026-10-18T15:54:38Z, exit 101. First cause: ts-rs rejects optional bool derivation at protocol/src/items.rs:141. Log: `artifacts/tasks/CL-01-question-withdrawal/runs/native-1/logs/native.log`. No tests passed in this run. Correct the type annotation before a fresh immutable run.

- Native-2 began 2026-10-18T15:59:05Z after fixing optional TS generation and commit-after-flush withdrawal. Final review found queued reply-shaped text still passed through direct-reply validation; the engine owner corrected that boundary and added explicit/automatic queue cases for native-3. Native-2 inputs remain immutable and use the single physical Cargo cache.
- Final source selection: 31 tests, exit 0 (`source-1/selection-final.log`). Feature preservation: 18 tests, exit 0 (`source-1/preservation.log`).
- Source provenance refresh uses the official recorder with a task-owned temporary Git index. The preexisting agent_behavior.md delta is measured explicitly without modifying its content; the real Git index remains unchanged. Existing SOURCE.json and documentation/config changes belong partly to prior work, so final staging must not include those changes indiscriminately.

- Final review fixes for native-3: Queue-origin text bypasses reply-envelope validation; new question messages use UUIDs so reused provider call IDs cannot alias question identities. Existing persisted IDs replay unchanged. The misplaced HasLegacyEvent import in a macro-contained test fixture was restored to its owning test; rustfmt parsing alone did not detect that macro-body error.
- First source-recorder attempt failed without changing SOURCE.json: four existing committed paths (thread_processor.rs and three thread-store files) also differed from the previous receipt. Their Git status is clean. The retry explicitly records these preexisting receipt drifts along with the task delta; it does not change their source.
- Source logs and independent UI evidence were reviewed and deferred with concrete replacement conditions. Disposable renderer/profile paths were deleted and verified absent. Native runs remain retained until final verification and lifecycle review.

- Official source recorder accepted all 46 explicit deltas, exit 0 (`native-3/logs/source-recorder-accepted.log`). Six were preexisting receipt debt: the existing prompt change, four clean committed source deltas, and clean committed resume_history_reuse_tests.rs. No source was modified for that debt. Final SOURCE raw SHA256: `9c40ec9d0ca52e5f61588838c7c15bd494fccb1a63b1d2bc72e5d19f8c81d4f1`; inventory SHA256: `be139a66c041ee7821e30be3718c2d0baae079f8fe0f5b4820d1b14035cab385`. The real Git index stayed unchanged.
- Scoped task diff check passed, exit 0 (`native-3/logs/diff-check.log`, CRLF treated as EOL).

- Native-2 ended 2026-10-18T16:21:16Z with actual exit 101 after root interrupted its exact owned rustc descendant (PID 16408 under verified native-2 producer). Its inputs were superseded and still contained the confirmed misplaced test import; no test result from this run is accepted. Cargo/helper reported failure and released the cache. Follow-up process inspection found no old rustc/link processes; only the new Cargo process remained.
- Native-3 started 2026-10-18T16:21:30Z from final immutable source. It owns the same physical Cargo cache exclusively. Native-3 source was frozen before the SOURCE-only provenance refresh; compiled Rust inputs remain the final versions.

- Generated-contract review found direct scope beyond Rust: optional withdrawn in stable TS/JSON and Python SDK, pendingQuestionCount in experimental QueueListResponse, and trusted reply metadata/Queue provenance in internal rollout schema. The Python generated model forbids unknown fields, so the new field needs a matching client definition. Ordinary app-server export APIs reuse old precomputed bundles; generation must use the Rust test implementation.
- Schema owner prepares scratch stable/experimental generation under lifecycle `run:CL-01-question-withdrawal:schemas-1`, using the immutable native-3 protocol test executable only after linked/executable readiness is verified. Existing SDK Python 3.10.21 venv and codegen dependencies are available; no dependency installation is required. Unexpected unrelated schema drift must be reviewed before copying outputs.
- Native-1/native-2 artifacts were reviewed and deferred successfully, preserving failure/interruption evidence until accepted replacement receipts are retained.

- Native-3 async-question library stage finished 2026-10-18T16:50:20Z, exit 0: core 10, protocol wire 1, app-server-protocol history 1; app-server filter matched 0. Queue service and integration stages remain pending. Protocol test executable SHA256 `344325c4ba76753c9c928ffe89c3c0dc79e00ff7ee61855675124030f4d64803` was linked, listed successfully and handed to the schema owner for direct scratch generation without Cargo/cache mutation.

- Fresh stable/experimental generation both exited 0 but exposed preexisting unrelated schema drift (ParentRequest/Response, root-resume, ContextPolicy and other contracts). Scope decision: preserve unrelated artifacts; apply only generated withdrawn/trusted-reply/queue fields and verify their fresh-generator equality plus preservation of unrelated existing nodes. Whole-fixture equality cannot be claimed. Generated optional Python bool may default to None (JSON has no default), so the SDK check accepts omitted None/False while requiring omitted wire field and explicit true.

- Generated artifacts finalized: 25 files, JSON72 approved nodes match fresh generation, 2444 unrelated bundle entries preserved. Exact hashes: `schemas-1/logs/final-manifest.json`; unrelated baseline drift: `schemas-1/logs/raw-baseline-drift.diff`. SDK check4 and scoped diff passed, exit0. Schema lifecycle reviewed and deferred until baseline drift reconciliation plus replacement verification.
- Official source recorder accepted exactly25 generated deltas, exit0 (`native-4/logs/source-recorder.log`), inventory SHA256 `adf62062201d18d755ebe7ec36ff70f0fd4d4969d9a183c40271f81cccedc836`. Feature preservation rerun18 passed, exit0 (`native-4/logs/preservation.log`). Native-4 snapshot freezes the final generated/source provenance for protocol fixtures and SDK validation after native-3 releases the cache.

- Final frozen engine SHA256 `41fdab995339d9516f1db32d40919a53551752b8529f22f7b9f8cb78bf34f248`; SOURCE raw SHA256 `787bca486ae428cc1cf54f72b971b43cc8054ceced2f9d34063d47a10d34d56f`. Frozen SDK driver exited0 and passed4 checks against the selected frozen generated module (`native-4/logs/sdk.log`). `native-4/logs/reuse-proof.json` confirms all Rust/Cargo inputs match native-3, with only25 generated files and SOURCE metadata changed; all25 final generated hashes match the schema-owner manifest.

- Native-3 queue stage ended 2026-10-18T17:07:59Z, exit101:25/26 passed including new partial/last withdrawal case. Existing queued_compaction_executes_between_user_messages fixture supplied20k tokens below the80k compaction threshold while expecting a compact request. Only its usage was corrected to80k; all3 request/order assertions remain. This remains below automatic compaction threshold. Native-5 records and freezes that one fixture change.
- Regression selector correction: old helper filters session::*_tests matched0 cases; these are not accepted verification. Primary helper now uses session::*::tests. Actual compiled native-3 unit checks: accepted-input11pass, compaction5pass, turn-input20pass/1fail. steering_does_not_wait_for_realtime_history exposed a real ordinary-input regression: unchanged question state still sent a notification waiting for realtime_history. Owner proposes notification only when answering changes ledger state, preserving the existing5s assertion; source mutation waits for current snapshot safety.

- Production regression fixed only in user_questions.rs: answer_content now returns whether answered-set entries were newly inserted; acceptance notifies only on true. No ordinary-input notification/recording wait. Existing lock test and5s assertion unchanged. Source owner rustfmt/diff check exit0.
- Native-5 recorder+freeze completed0 for the numeric fixture only; it is superseded by native-6. Native-3 tool integration compilation was interrupted after validating exact owned rustc23892?Cargo56344?rustup27328?node9540 ancestry, with no child producers. Cargo/helper ended101 and released the cache. It had confirmed superseded production inputs; no integration result is claimed.
- Native-6 final source recorder+freeze completed0. Engine SHA256 `dd9b1ed42a98e8a5733f070e974038bacb360565f3cd52fb9ce0d641a0b5045e`. Combined test preparation started2026-10-18T17:23:06Z under a single Cargo owner, selecting core/protocol/app-server-protocol/queue libs plus core all and queue_service test targets. Compiled artifact discovery and nonzero test selection are required before executing every filter. Final SDK4checks already passed0. App-server native-3 compilation remains the unchanged app-server-owner evidence; final core-only fix changes no public signature.

- Native-3/4/5 lifecycle reviews were applied as defer successfully; immutable inputs and failure/provenance/SDK evidence remain until accepted release replacement proof. Source3 all9270 frozen input hashes matched after termination. Native-6 source proof confirms only private question-state notification, queue fixture usage and SOURCE differ from native-4; all25 generated hashes remain exact. Final SOURCE raw SHA256 `d9e78be2b81804a6098b7af9be98d1411a066b043365c30e00361c2a0f98f1a3`. Scoped83-path diff check passed0; staged Git diff remains empty.
- Task commit is withheld under Work task-completion exception: existing SOURCE.json and shared configuration/docs were already dirty and the accepted cumulative source receipt also contains unrelated preexisting provenance debt. Committing the whole receipt would mix other work; no partial task commit or unrelated source staging is performed. This remains an integration limitation, not permission to discard existing work.

- Final native-6 combined compilation exit0; functional Windows checks104 passed (core10, wire1, history1, queue26, tool29, accepted11, compact5, turn21). Full schema fixture stage exit101:4failed/1ignored, wrapper exit1. Final SDK4 and selection31 passed0. UI fixture20 passed0; no installed application or other-OS acceptance claimed.
- Schema diagnosis exit0: all approved fields match fresh generation; stable internal RolloutLine has exactly11 unrelated baseline differences, and stripping only approved fields reproduces the original baseline. Full fixture failures remain recorded, with no unrelated schema rewrite. Evidence: native-6/logs/internal-schema-diagnosis.json and verification-summary.json.
- Post-test proof exit0: all9270 frozen and primary engine inputs plus6 tool hashes match the final receipt. No further source mutation or redundant test rerun is required. Native-6 producer ended2026-10-18T17:59:42Z; final lifecycle registration/review retains reproducible inputs and evidence.

- Final native-6 lifecycle registration, review and defer completed successfully; remaining=true preserves immutable inputs and diagnostic evidence until an accepted release reconciles the schema baseline and retains recoverable replacement verification. Disposable renderer/profile paths were removed earlier. No task worktree or task commit was created.
