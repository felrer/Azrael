# Azrael instruction distribution

Instruction version **1.1.0**, environment schema **1**, minimum Azrael **0.4.0**.
This directory is the complete redistributable instruction library, including
scripts, tests, references, templates, examples and playbook assets.

Azrael packages this entire tree for an `instructions-v1.1.0` release. Downloading
the package preserves the library; selecting components determines which files
are applied. Use Azrael's instruction settings to preview, select and apply them.
Existing unmanaged or edited files require conflict resolution before application.

| Component | Source | Applied target | Default |
| --- | --- | --- | --- |
| Global instructions | `instructions/AGENTS.snippet.md` | `CODEX_HOME/AGENTS.md` | Yes |
| Agent roles | `agents/*.toml` | `CODEX_HOME/agents/*.toml` | Yes |
| Five skills | Entire named `skills/` directories | `CODEX_HOME/skills/` | Yes |
| Agent configuration | `config.example.toml` | Allowed keys in `CODEX_HOME/config.toml` `[agents]` | Yes |
| App logging | Bootstrap playbook asset | Workspace `docs/playbooks/app-logging.md` | No |

The configuration component merges only `enabled`, `default_subagent_model`,
`default_subagent_reasoning_effort` and `max_concurrent_threads_per_session`.
Component definitions and every file mapping are in
[azrael-environment.json](azrael-environment.json). `SOURCE.json` and other
distribution metadata are packaged for provenance, never installed as components.

| Skill | Responsibility |
| --- | --- |
| [development-workflow](skills/development-workflow/SKILL.md) | Complex code work, requirements, decisions, progress and final acceptance |
| [design-collaboration](skills/design-collaboration/SKILL.md) | Unresolved product and system design choices |
| [design-documentation](skills/design-documentation/SKILL.md) | Agreed design in its owning documents |
| [implementation](skills/implementation/SKILL.md) | Execution preparation, implementation, verification and cleanup; direct entry for small changes |
| [project-bootstrap](skills/project-bootstrap/SKILL.md) | Project documentation entry points, skill routing and app logging guidance |

Use these responsibilities as needed within the same work. Keep existing project
Work guidance as local constraints; common execution rules belong to `implementation`.

## Provenance and maintenance

Common agent behavior is maintained in [agent-behavior.md](instructions/agent-behavior.md).
The engine embeds an identical copy at `engine/codex-rs/prompts/templates/agent_behavior.md`;
`scripts/test-common-agent-instructions.cjs` verifies that the copies agree. This behavior
is delivered by the engine to every provider, independently of optional instruction
components and remote model catalogs. Technical tool schemas and provider protocol
reminders remain with their owning adapters.

Maintain shared instructions in this Azrael repository’s `instructions/` directory. `felrer/Azrael` is the active owner; the archived `felrer/codex-efficient-subagents` checkout is historical import evidence and is not an update destination. Preserve source provenance and original notices. Keep `instructions/AGENTS.snippet.md` and `examples/delegation.md` consistent. When changing installed skills, update their maintained copies, `SKILLS-SOURCE.json` and component mappings; preserve unrelated installed configuration.

Global instructions keep always-applicable constraints and conditional entry routes. Detailed UI, build-input, worktree and delegation guidance lives in `skills/implementation/references/`; load only the matching references before that work. Project procedures remain with their project owners.

Imported from [Codex Efficient Subagents](https://github.com/felrer/codex-efficient-subagents),
including the source checkout's uncommitted changes. [SOURCE.json](SOURCE.json)
records the source HEAD, working-tree status, complete copy mapping, original and
copied SHA-256/size, exclusions and adaptations. Source HEAD alone does not identify
these working-tree bytes. [SOURCE-README.md](SOURCE-README.md) retains upstream
guidance; [SOURCE-CHANGELOG.md](SOURCE-CHANGELOG.md) retains upstream history.
The current instruction release history is [CHANGELOG.md](CHANGELOG.md).

The five skill directories are maintained copies of the active installed Azrael
skills. [SKILLS-SOURCE.json](SKILLS-SOURCE.json) records their source-relative paths,
original and copied hashes, sibling-link adaptation and LF normalization for distribution.
`SOURCE.json` and `SOURCE-*` documents retain the original historical import record;
their paths and guidance describe that import rather than the current skill layout.

Layout is preserved except the two source root documents renamed with `SOURCE-`.
Legacy `azrael/` app installers are excluded: app delivery is owned by Azrael,
not this instruction package. The preserved README's legacy release JSON link
points to upstream; its app installer command examples are historical guidance.
No personal Vault files or personal absolute paths are required. Generic sample
paths in the source documentation remain examples. Original notices are preserved;
the user's instruction library is distributed under [MIT](LICENSE).

Validate the maintained library without accessing a personal installation:

```sh
python -B scripts/import-instructions.py --check
```

Maintain changes in Azrael. When updating installed skill copies, update their
support resources, component mappings and `SKILLS-SOURCE.json` together, preserving
the historical `SOURCE-*` records. The importer's explicit `--source` mode is for
historical imports and refuses to overwrite locally maintained changes. The former
shared repository is archived; it is not an active refresh destination.
