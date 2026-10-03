# Azrael instruction distribution

Instruction version **1.0.0**, environment schema **1**, minimum Azrael **0.4.0**.
This directory is the complete redistributable instruction library, including
scripts, tests, references, templates, examples and playbook assets.

Azrael packages this entire tree for an `instructions-v1.0.0` release. Downloading
the package preserves the library; selecting components determines which files
are applied. Use Azrael's instruction settings to preview, select and apply them.
Existing unmanaged or edited files require conflict resolution before application.

| Component | Source | Applied target | Default |
| --- | --- | --- | --- |
| Global instructions | `instructions/AGENTS.snippet.md` | `CODEX_HOME/AGENTS.md` | Yes |
| Agent roles | `agents/*.toml` | `CODEX_HOME/agents/*.toml` | Yes |
| Three skills | Entire named `skills/` directories | `CODEX_HOME/skills/` | Yes |
| Agent configuration | `config.example.toml` | Allowed keys in `CODEX_HOME/config.toml` `[agents]` | Yes |
| Work / app logging | Bootstrap playbook assets | Workspace `docs/playbooks/work.md`, `app-logging.md` | No |

The configuration component merges only `enabled`, `default_subagent_model`,
`default_subagent_reasoning_effort` and `max_concurrent_threads_per_session`.
Component definitions and every file mapping are in
[azrael-environment.json](azrael-environment.json). `SOURCE.json` and other
distribution metadata are packaged for provenance, never installed as components.

## Provenance and maintenance

Imported from [Codex Efficient Subagents](https://github.com/felrer/codex-efficient-subagents),
including the source checkout's uncommitted changes. [SOURCE.json](SOURCE.json)
records the source HEAD, working-tree status, complete copy mapping, original and
copied SHA-256/size, exclusions and adaptations. Source HEAD alone does not identify
these working-tree bytes. [SOURCE-README.md](SOURCE-README.md) retains upstream
guidance; [SOURCE-CHANGELOG.md](SOURCE-CHANGELOG.md) retains upstream history.
The current instruction release history is [CHANGELOG.md](CHANGELOG.md).

Layout is preserved except the two source root documents renamed with `SOURCE-`.
Legacy `azrael/` app installers are excluded: app delivery is owned by Azrael,
not this instruction package. The preserved README's legacy release JSON link
points to upstream; its app installer command examples are historical guidance.
No personal Vault files or personal absolute paths are required. Generic sample
paths in the source documentation remain examples. Original notices are preserved;
the user's instruction library is distributed under [MIT](LICENSE).

To refresh from an explicitly chosen local shared checkout, run from the project:

```sh
python -B scripts/import-instructions.py --source SHARED_CHECKOUT
python -B scripts/import-instructions.py --source SHARED_CHECKOUT --check
```

Import refuses to overwrite a destination without its provenance record, or a
destination whose recorded files have local edits. Review upstream changes before
refreshing; do not automatically overwrite locally maintained adaptations.
