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
| Five core skills | Entire named core `skills/` directories | `CODEX_HOME/skills/` | Yes |
| Visualization and ktcloud skills | Their named `skills/` directories | `CODEX_HOME/skills/` | No |
| Agent configuration | `config.example.toml` | Allowed keys in `CODEX_HOME/config.toml` `[agents]` | Yes |
| App logging | Bootstrap playbook asset | Workspace `docs/playbooks/app-logging.md` | No |

The configuration component merges only `enabled`, `default_subagent_model`,
`default_subagent_reasoning_effort` and `max_concurrent_threads_per_session`.
Component definitions and every file mapping are in
[azrael-environment.json](azrael-environment.json). `SOURCE.json` and other
distribution metadata are packaged for provenance, never installed as components.

| Skill | Responsibility |
| --- | --- |
| [development-workflow](skills/development-workflow/SKILL.md) | Work entry through investigation and one plan with questions; execution coordination and final acceptance |
| [design-collaboration](skills/design-collaboration/SKILL.md) | Work entry through iterative discussion of linked user choices |
| [design-documentation](skills/design-documentation/SKILL.md) | Agreed design in its owning documents |
| [implementation](skills/implementation/SKILL.md) | Execute the agreed plan and authority through implementation, verification and cleanup |
| [project-bootstrap](skills/project-bootstrap/SKILL.md) | Project documentation entry points, skill routing and app logging guidance |
| [internal-visualization](skills/internal-visualization/SKILL.md) | Standalone analytical charts, interactive reports and local exports (optional) |
| [ktcloud-ai-nexus](skills/ktcloud-ai-nexus/SKILL.md) | Account-scoped cloud session operations and separate private records (optional) |

Use these responsibilities as needed within the same work. Keep existing project
Work guidance as local constraints; common execution rules belong to `implementation`.

## Provenance and maintenance

Common agent behavior is maintained in [agent-behavior.md](instructions/agent-behavior.md).
The engine embeds an identical copy at `engine/codex-rs/prompts/templates/agent_behavior.md`;
`scripts/test-common-agent-instructions.cjs` verifies that the copies agree. This behavior
is delivered by ordinary engine profiles independently of optional instruction components and remote model catalogs. Provider/model profiles compose the maintained `harness-runtime-core.md`, `claude-tool-environment.md` and `claude-lean-behavior.md` with behavior overrides; their embedded copies are checked by the same test. Runtime authority and user/project provenance remain independent of custom templates. See [model harness profiles](../docs/architecture/model-harness-profiles.md). Capability-scoped parent communication is maintained in [parent-request-guidance.md](instructions/parent-request-guidance.md) and embedded identically in `engine/codex-rs/prompts/templates/parent-request-guidance.md`. Its typed developer fragment is rebuilt from actual parent identity and enabled tools independently of optional AGENTS and configurable role hints; the same equality test protects the copy. Capability-scoped project maintenance is maintained in [project-maintenance-guidance.md](instructions/project-maintenance-guidance.md) and embedded identically in `engine/codex-rs/prompts/templates/project-maintenance-guidance.md`. Actual native tool exposure controls this fragment, including withdrawal. Generic skill principles remain independent of this feature. Technical tool schemas and provider protocol
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

The seven public skill directories are maintained Azrael sources.
[SKILLS-SOURCE.json](SKILLS-SOURCE.json) records their source-relative paths,
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

## Local-only skills and operational records

`instructions/.private/` is a checkout-local personal area. Git tracking, the
instruction release archive, its document index and its manifest exclude this
entire directory. Personal data must not be placed in public `skills/` trees:
an optional component or an unchecked install option does not make its files
private. Existing tracked files must never be moved into this area as a substitute
for removing their publication history.

The current personal SSH skill lives at `.private/skills/liam-mac-mini-ssh` and is
activated only in this user's local installation. It is not a public component.
ktcloud source and scripts live in `skills/ktcloud-ai-nexus`; local session records
live separately in `.private/ktcloud-ai-nexus/state`. Distributed installations use
the isolated Azrael state directory described by that skill. Credential and login
stores remain machine-local and are not copied into either source tree.

The retired `brainstorming` placeholder and `obsidian-skill-manager` are not
distributed skills. Removing their activation links does not delete archived
Vault originals. Skill authoring and GitHub acquisition use the available
`skill-creator` and `skill-installer` workflows; Azrael's instruction settings own
resource browsing and installation.

Validate the maintained library without accessing a personal installation:

```sh
python -B scripts/import-instructions.py --check
```

Maintain changes in Azrael. When updating installed skill copies, update their
support resources, component mappings and `SKILLS-SOURCE.json` together, preserving
the historical `SOURCE-*` records. The importer's explicit `--source` mode is for
historical imports and refuses to overwrite locally maintained changes. The former
shared repository is archived; it is not an active refresh destination.
