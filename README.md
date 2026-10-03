# Azrael

Azrael is an independent VS Code extension host with a Codex-based engine,
provider integrations and a versioned instruction library.

Public distribution is **on hold** until redistribution permission for the
existing integrated OpenAI UI and selected external runtimes is established.
The current UI is retained. Local development packages are not public releases.
Azrael-owned code and instructions use [MIT](LICENSE); imported licenses and
notices remain in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

The verified engine source snapshot is in [engine/](engine/), with an exact
inventory and provenance in `engine/SOURCE.json`. The complete instruction
library is in [instructions/](instructions/README.md), including roles, skills,
playbooks, examples and supporting scripts. It has its own semantic version and
GitHub release assets, independent of the app version.

Azrael settings includes **지침 문서** for browsing documents, downloading the
whole instruction package, applying selected components, pinning a version and
rolling back. Live GitHub downloads require the corresponding release to be
published. Existing local edits are reported as conflicts before application.

See [documentation](docs/README.md), [local development and packaging](docs/ops/development.md)
and [instruction release operations](docs/ops/instruction-distribution.md).
