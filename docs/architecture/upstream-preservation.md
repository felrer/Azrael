# Upstream feature preservation

Status: `partial`. Feature registration, candidate-specific source checks and receipt verification are implemented and checked with source and disposable fixtures. Actual native, package and installed-host acceptance remain separate execution scopes.

Azrael accepts a Codex UI or engine candidate only after its registered behavior contracts pass against that candidate. UI source hashes, unique transformation anchors and engine provenance establish source identity and structural application; behavior checks establish the registered functional scope.

## Ownership and inventory

Architecture sections own agreed behavior under [feature maintenance](README.md#feature-maintenance). The versioned inventory at `scripts/azrael-feature-contracts.json` connects stable feature IDs, UI/engine scope, implementation owners, contract references and mandatory executable checks. Every UI injector in the namespace transformation rules must have an inventory entry. Engine coverage is explicitly registered through existing deterministic native fixtures; it is not inferred from root Git changes. Adding, changing or retiring a customization updates its owning design, inventory and behavior check together.

Official UI assets remain pristine inputs. Version-specific adapters apply Azrael-owned policy at preparation boundaries and reject unknown or duplicate anchors. Engine integration uses the selected source root and existing provenance verification; importing an inventory is not behavioral acceptance.

## Upgrade scope review

An upgrade reviews the existing behavior contracts and inventory against the selected baseline release and candidate. Implemented sections and explicitly retained requirements define preservation scope, including implemented parts of `partial` or `target` documents. Unimplemented targets and draft proposals remain separate implementation requirements. Any removal, reduced check scope or applicability exclusion needs its corresponding design decision and existing task authorization; a missing registration or failing check is an acceptance gap.

This review is a maintenance requirement. The current runner validates registered features and their declared references/checks; it does not discover every behavior from architecture prose or automatically compare the feature inventory with a prior release. Record these coverage and baseline comparisons in the existing work record until executable enforcement is implemented. Source provenance, matching document bytes and passing registered checks do not establish completeness of the behavior inventory.

## Contract index

The registry links below identify registered acceptance scope, not every current product contract. The executable commands and declared source/native levels remain in the [feature inventory](../../scripts/azrael-feature-contracts.json); behavior, applicability and source/package/installed limits remain in the linked owning sections. Cross-layer UI entries may link onward to their host or engine contract.

| Registered contract owner | Preservation feature IDs |
| --- | --- |
| [ui-presentation](ui-presentation.md) | `ui.submit-only-thread`, `ui.session-flags`, `ui.student-design`, `ui.project-drafts`, `ui.file-open-menu`, `ui.image-file-open`, `ui.missing-image`, `ui.local-file-drop`, `ui.composer-draft`, `ui.ui-cleanup`, `ui.pets-cleanup`, `ui.content-fonts`, `ui.thread-branch`, `ui.paginated-history`, `ui.recent-chat-filter`, `ui.session-links`, `ui.input-diagnostics` |
| [managed-providers](managed-providers.md) | `engine.managed-tool-identities`, `ui.provider-model-picker`, `ui.max-reasoning` |
| [task-work-time](task-work-time.md) | `ui.task-work-time` |
| [accounts](accounts.md) | `ui.account-settings`, `ui.account-switch-queue`, `engine.auto-account-switch` |
| [instructions](instructions.md) | `ui.instruction-settings` |
| [reload-recovery](reload-recovery.md) | `ui.recovery`, `ui.fetch-response`, `ui.immediate-stop`, `engine.recovery`, `engine.accepted-input` |
| [computer-use](computer-use.md) | `ui.url-safety-transport`, `ui.computer-use`, `ui.window-control` |
| [auto-review](auto-review.md) | `ui.auto-review` |
| [context-policy](context-policy.md) | `ui.provider-context`, `engine.provider-context` |
| [root-resume](root-resume.md) | `ui.deferred-turn`, `ui.work-segment-folding` |
| [queued-compaction](queued-compaction.md) | `ui.compaction-progress`, `ui.queue-refresh`, `ui.queue-consumption`, `ui.queued-compaction` |
| [side-questions](side-questions.md) | `ui.btw` |
| [devin](devin.md) | `engine.devin-native`, `engine.devin-code-mode`, `engine.devin-agents` |

Additional current contracts have existing verification owners outside this registry. [Host/storage/import](azrael-ex.md), [custom API models](custom-api-models.md), [project usage](project-usage.md), [brand assets](provider-brand-assets.md), [instruction acquisition/application and native state](instructions.md), [platform runtime/distribution](multi-platform.md), [Window Use](window-use.md), [prompt image preparation](prompt-image-preparation.md) and [native diagnostic policy](diagnostic-logging.md) retain their requirements even where a registered UI check covers only part of their behavior. Native queue/root completion semantics and provider catalog, account-lifecycle and quota-window rules likewise require their owning contracts to be reviewed; a broad feature label is not evidence that each native boundary is checked.

Coverage gaps and the selected release comparison belong in the current work plan. New checks or additions to registered scope must execute against the selected candidate with their declared fixture/platform conditions. A documentation audit can connect the contracts and expose those gaps without claiming candidate acceptance.

Managed exact-name and private replay preservation also requires the provider's history fixtures in `providers/opencodex/tests/tool-name-replay.test.ts`; a diagnostics-only check cannot establish replay continuity. Likewise, the manual Sol speed control, suppressed fast-mode recommendation, native instruction-state projection and Linux selected-window backend need checks at their actual behavior and platform boundaries, beyond structural UI adaptation.

## Candidate acceptance and receipts

The preservation runner selects UI, engine or both explicitly. UI checks execute against the selected pristine UI and transformation rules. Engine checks execute against binaries whose receipt matches the selected source. Missing owners, missing mandatory checks, failed checks and input changes during verification prevent a passing receipt.

Receipts bind the registry and check/implementation inputs, UI contents and engine provenance/binary identity for their verified scope. Packaging binds the passing UI receipt to the prepared transformation report and exact VSIX hash. Deployment requires UI and engine acceptance for the actual inputs before installing the candidate. Old results are reusable only when all relevant identities match.

Logs and execution artifacts live under `artifacts/`. Checks use disposable state and deterministic fixtures; live or paid model requests are separate acceptance. A passing receipt names its verified feature IDs and scope. It does not establish full upstream regression acceptance or rendered behavior in an installed user window.

Repeated commands and upgrade procedures are owned by [development](../ops/development.md) and [source distribution](../ops/instruction-distribution.md).

## Pipeline execution and retry

Status: `current` in source and disposable Windows fixtures; full-release performance and installed-host acceptance are separate scopes. Candidate source-only checks run before expensive builds. A failed check prevents scheduling dependent native work; already owned independent commands are collected. A source-only receipt cannot establish engine acceptance: the complete engine receipt still requires every selected source and native check, current provenance and unchanged inputs. Source evidence may be handed to that complete run only when check scope, content identities, execution environment and retained evidence match.

Cargo test wrappers share explicit cache/target/profile inputs while preserving each mandatory test filter. Deterministic Cargo check evidence may reuse the existing guarded evidence store only with complete selected engine source, registry/check/contract inputs, toolchain, environment and log identity. Failures, changed inputs or incomplete evidence cannot pass. Full regression forces native execution. An unchanged build may be reused after verification failure under the existing source and binary provenance contract; final package binding and six host acceptance stages execute for the final candidate.

The selected inventory feature IDs and all mandatory check IDs remain the acceptance scope. `scripts/deploy-azrael.ps1`, `scripts/feature-preservation.cjs` and their source/Cargo runners own ordering, handoff and evidence reuse; [development operations](../ops/development.md#pipeline-verification-and-retry) owns execution and regression procedures.

Execution checkpoints record actual starts and completions, check execution and cache lookup separately. Concurrent check durations are not summed into pipeline wall time.
