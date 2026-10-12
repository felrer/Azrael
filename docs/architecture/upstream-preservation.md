# Upstream feature preservation

Status: `partial`. Feature registration, candidate-specific source checks and receipt verification are implemented and checked with source and disposable fixtures. Actual native, package and installed-host acceptance remain separate execution scopes.

Azrael accepts a Codex UI or engine candidate only after its registered behavior contracts pass against that candidate. UI source hashes, unique transformation anchors and engine provenance establish source identity and structural application; behavior checks establish the registered functional scope.

## Ownership and inventory

Architecture sections own agreed behavior under [feature maintenance](README.md#feature-maintenance). The versioned inventory at `scripts/azrael-feature-contracts.json` connects stable feature IDs, UI/engine scope, implementation owners, contract references and mandatory executable checks. Every UI injector in the namespace transformation rules must have an inventory entry. Engine coverage is explicitly registered through existing deterministic native fixtures; it is not inferred from root Git changes. Adding, changing or retiring a customization updates its owning design, inventory and behavior check together.

Official UI assets remain pristine inputs. Version-specific adapters apply Azrael-owned policy at preparation boundaries and reject unknown or duplicate anchors. Engine integration uses the selected source root and existing provenance verification; importing an inventory is not behavioral acceptance.

## Upgrade scope review

An upgrade reviews the existing behavior contracts and inventory against the selected baseline release and candidate. Implemented sections and explicitly retained requirements define preservation scope, including implemented parts of `partial` or `target` documents. Unimplemented targets and draft proposals remain separate implementation requirements. Any removal, reduced check scope or applicability exclusion needs its corresponding design decision and existing task authorization; a missing registration or failing check is an acceptance gap.

This review is a maintenance requirement. The current runner validates registered features and their declared references/checks; it does not discover every behavior from architecture prose or automatically compare the feature inventory with a prior release. Record these coverage and baseline comparisons in the existing work record until executable enforcement is implemented. Source provenance, matching document bytes and passing registered checks do not establish completeness of the behavior inventory.

## Candidate acceptance and receipts

The preservation runner selects UI, engine or both explicitly. UI checks execute against the selected pristine UI and transformation rules. Engine checks execute against binaries whose receipt matches the selected source. Missing owners, missing mandatory checks, failed checks and input changes during verification prevent a passing receipt.

Receipts bind the registry and check/implementation inputs, UI contents and engine provenance/binary identity for their verified scope. Packaging binds the passing UI receipt to the prepared transformation report and exact VSIX hash. Deployment requires UI and engine acceptance for the actual inputs before installing the candidate. Old results are reusable only when all relevant identities match.

Logs and execution artifacts live under `artifacts/`. Checks use disposable state and deterministic fixtures; live or paid model requests are separate acceptance. A passing receipt names its verified feature IDs and scope. It does not establish full upstream regression acceptance or rendered behavior in an installed user window.

Repeated commands and upgrade procedures are owned by [development](../ops/development.md) and [source distribution](../ops/instruction-distribution.md).
