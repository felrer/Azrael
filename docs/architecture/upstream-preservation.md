# Upstream feature preservation

Status: `partial`. Feature registration, candidate-specific source checks and receipt verification are implemented and checked with source and disposable fixtures. Actual native, package and installed-host acceptance remain separate execution scopes.

Azrael accepts a Codex UI or engine candidate only after its registered behavior contracts pass against that candidate. UI source hashes, unique transformation anchors and engine provenance establish source identity and structural application; behavior checks establish the registered functional scope.

## Ownership and inventory

A versioned feature inventory owns stable feature IDs, UI/engine scope, implementation owners, contract references and mandatory executable checks. Every UI injector in the namespace transformation rules must have an inventory entry. Engine coverage is explicitly registered through existing deterministic native fixtures; it is not inferred from root Git changes. Adding or retiring a customization updates its inventory and behavior check together.

Official UI assets remain pristine inputs. Version-specific adapters apply Azrael-owned policy at preparation boundaries and reject unknown or duplicate anchors. Engine integration uses the selected source root and existing provenance verification; importing an inventory is not behavioral acceptance.

## Candidate acceptance and receipts

The preservation runner selects UI, engine or both explicitly. UI checks execute against the selected pristine UI and transformation rules. Engine checks execute against binaries whose receipt matches the selected source. Missing owners, missing mandatory checks, failed checks and input changes during verification prevent a passing receipt.

Receipts bind the registry and check/implementation inputs, UI contents and engine provenance/binary identity for their verified scope. Packaging binds the passing UI receipt to the prepared transformation report and exact VSIX hash. Deployment requires UI and engine acceptance for the actual inputs before installing the candidate. Old results are reusable only when all relevant identities match.

Logs and execution artifacts live under `artifacts/`. Checks use disposable state and deterministic fixtures; live or paid model requests are separate acceptance. A passing receipt names its verified feature IDs and scope. It does not establish full upstream regression acceptance or rendered behavior in an installed user window.

Repeated commands and upgrade procedures are owned by [development](../ops/development.md) and [source distribution](../ops/instruction-distribution.md).
