#!/usr/bin/env python3
"""Check the maintained Azrael library or explicitly import a historical source tree.

Uses only Python's standard library. Never modifies the source checkout.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
from urllib.parse import unquote

SOURCE_URL = "https://github.com/felrer/codex-efficient-subagents"
IGNORED_DIRS = {".git", "__pycache__", "node_modules"}
COMPILED = {".pyc", ".pyo"}
ACTIVE_SKILLS = ["design-collaboration", "design-documentation", "development-workflow", "implementation", "project-bootstrap"]
LICENSE = """MIT License

Copyright (c) 2026 felrer

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
"""
README = """# Azrael instruction distribution

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
"""


def info(data):
    return {"size": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def inventory(root):
    included, ignored, excluded = [], [], []
    for folder, dirs, files in os.walk(root):
        for name in sorted(dirs[:]):
            if name in IGNORED_DIRS:
                ignored.append({"path": (Path(folder) / name).relative_to(root).as_posix() + "/",
                                "reason": "Git metadata" if name == ".git" else "dependency or compiled cache"})
                dirs.remove(name)
        for name in sorted(files):
            path = Path(folder) / name
            rel = path.relative_to(root).as_posix()
            if path.is_symlink():
                raise ValueError(f"Unsupported source symlink: {rel}")
            if path.suffix in COMPILED:
                ignored.append({"path": rel, "reason": "compiled Python cache"})
            elif rel.startswith("azrael/"):
                excluded.append({"path": rel, "reason": "legacy Azrael app installer/delivery metadata; not instructions", **info(path.read_bytes())})
            else:
                included.append(rel)
    return sorted(included), sorted(ignored, key=lambda x: x["path"]), sorted(excluded, key=lambda x: x["path"])


def components(paths, legacy=False):
    def component(cid, title, kind, scope, default, mappings):
        return dict(id=cid, title=title, kind=kind, scope=scope, default=default,
                    files=[dict(source=s, target=t) for s, t in mappings])
    result = [component("global-instructions", "Global instructions", "instructions", "home", True,
                        [("instructions/AGENTS.snippet.md", "AGENTS.md")])]
    for path in paths:
        if path.startswith("agents/") and path.endswith(".toml"):
            name = Path(path).stem
            result.append(component("agent-" + name, name, "agent", "home", True, [(path, path)]))
    names = sorted({p.split("/")[1] for p in paths if p.startswith("skills/")})
    if names != (["designing", "planning", "project-bootstrap"] if legacy else ACTIVE_SKILLS):
        raise ValueError(f"Unexpected skill contract: {names}")
    for name in names:
        result.append(component("skill-" + name, name, "skill", "home", True,
                                [(p, p) for p in paths if p.startswith(f"skills/{name}/")]))
    for name in (["work", "app-logging"] if legacy else ["app-logging"]):
        result.append(component("playbook-" + name, name, "playbook", "workspace", False,
                                [(f"skills/project-bootstrap/assets/playbooks/{name}.md", f"docs/playbooks/{name}.md")]))
    config = component("agent-config", "Agent configuration", "config", "home", True,
                       [("config.example.toml", "config.toml")])
    config["configKeys"] = ["enabled", "default_subagent_model", "default_subagent_reasoning_effort", "max_concurrent_threads_per_session"]
    result.append(config)
    return result


def validate(destination, source):
    record = json.loads((destination / "SOURCE.json").read_text(encoding="utf-8"))
    digest = hashlib.sha256(json.dumps(record["files"], sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    assert digest == record["contentSha256"], "source inventory digest mismatch"
    for entry in record["files"]:
        data = (destination / entry["path"]).read_bytes()
        assert info(data) == {k: entry[k] for k in ["size", "sha256"]}, entry["path"]
    actual = sorted(p.relative_to(destination).as_posix() for p in destination.rglob("*") if p.is_file() and p.name != "SOURCE.json")
    assert actual == sorted(e["path"] for e in record["files"]), "unrecorded or missing distribution files"
    paths, ignored, excluded = inventory(source)
    assert paths == sorted(e["source"] for e in record["files"] if "source" in e), "incomplete source coverage"
    assert ignored == record["ignored"] and excluded == record["excluded"], "source exclusions changed"
    for entry in record["files"]:
        if "source" in entry:
            assert info((source / entry["source"]).read_bytes()) == entry["original"], entry["source"]
    environment = json.loads((destination / "azrael-environment.json").read_text(encoding="utf-8"))
    assert environment == dict(schemaVersion=1, instructionVersion="1.0.0", minimumAppVersion="0.4.0", components=components(paths, legacy=True))
    for component in environment["components"]:
        for mapping in component["files"]:
            assert (destination / mapping["source"]).is_file(), mapping
    links = 0
    for path in destination.rglob("*.md"):
        for target in re.findall(r"\[[^\]]*\]\(([^)]+)\)", path.read_text(encoding="utf-8")):
            target = target.strip().strip("<>").split("#", 1)[0]
            if not target or re.match(r"[a-zA-Z][a-zA-Z0-9+.-]*:", target):
                continue
            assert (path.parent / unquote(target)).exists(), f"Missing reference: {path.relative_to(destination)} -> {target}"
            links += 1
    print(f"PASS complete inventory: {len(paths)} copied source files, {len(actual) + 1} distribution files, {len(environment['components'])} components, {links} local document links")
    print(f"PASS source HEAD {record['sourceHead']}; content SHA-256 {record['contentSha256']}; {len(excluded)} explicit exclusions; {len(ignored)} ignored entries")


def validate_maintained(destination):
    historical = json.loads((destination / "SOURCE.json").read_text(encoding="utf-8"))
    digest = hashlib.sha256(json.dumps(historical["files"], sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    if digest != historical["contentSha256"]:
        raise ValueError("Historical source inventory digest mismatch")
    for entry in historical["files"]:
        if entry["path"].startswith("SOURCE-") or entry["path"] == "LICENSE":
            if info((destination / entry["path"]).read_bytes()) != {k: entry[k] for k in ["size", "sha256"]}:
                raise ValueError(f"Historical source document changed: {entry['path']}")
    receipt = json.loads((destination / "SKILLS-SOURCE.json").read_text(encoding="utf-8"))
    if receipt["schemaVersion"] != 1 or receipt["sourceKind"] != "installed-skills":
        raise ValueError("Unsupported installed-skill provenance")
    paths, _, _ = inventory(destination)
    skill_paths = [p for p in paths if p.startswith("skills/")]
    recorded_paths = [entry["path"] for entry in receipt["files"]]
    if len(recorded_paths) != len(set(recorded_paths)) or sorted(recorded_paths) != skill_paths:
        raise ValueError("Incomplete installed-skill inventory")
    for entry in receipt["files"]:
        if info((destination / entry["path"]).read_bytes()) != {k: entry[k] for k in ["size", "sha256"]}:
            raise ValueError(f"Installed-skill bytes changed: {entry['path']}")
    environment = json.loads((destination / "azrael-environment.json").read_text(encoding="utf-8"))
    expected = {c["id"]: c for c in components(paths)}
    actual = {c["id"]: c for c in environment["components"]}
    if len(actual) != len(environment["components"]) or actual != expected:
        raise ValueError("Maintained component mappings differ from the active library")
    for component in environment["components"]:
        for mapping in component["files"]:
            if mapping["source"] not in paths:
                raise ValueError(f"Missing component source: {mapping['source']}")
    links = 0
    for path in destination.rglob("*.md"):
        if path.name.startswith("SOURCE-"):
            continue  # Preserved historical documents describe the original imported layout.
        for target in re.findall(r"\[[^\]]*\]\(([^)]+)\)", path.read_text(encoding="utf-8")):
            target = target.strip().strip("<>").split("#", 1)[0]
            if not target or re.match(r"[a-zA-Z][a-zA-Z0-9+.-]*:", target):
                continue
            if not (path.parent / unquote(target)).exists():
                raise ValueError(f"Missing reference: {path.relative_to(destination)} -> {target}")
            links += 1
    print(f"PASS maintained library: {len(skill_paths)} skill files, {len(actual)} components, {links} local document links; historical provenance digest retained")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, help="Explicit historical Git checkout; omit for maintained-library --check")
    parser.add_argument("--destination", type=Path, default=Path(__file__).resolve().parents[1] / "instructions")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    destination = args.destination.resolve()
    if args.source is None:
        if not args.check:
            parser.error("Import requires an explicitly selected --source; use --check for the maintained library")
        validate_maintained(destination)
        return
    source = args.source.resolve()
    if source == destination or source in destination.parents or destination in source.parents:
        raise ValueError("Source and destination must be separate trees")
    if args.check:
        validate(destination, source)
        return
    if destination.exists() and any(destination.iterdir()):
        record_path = destination / "SOURCE.json"
        if not record_path.is_file():
            raise ValueError("Refusing to overwrite unowned destination")
        old = json.loads(record_path.read_text(encoding="utf-8"))
        for entry in old["files"]:
            if info((destination / entry["path"]).read_bytes()) != {k: entry[k] for k in ["size", "sha256"]}:
                raise ValueError(f"Locally edited destination: {entry['path']}")
        if set(p.relative_to(destination).as_posix() for p in destination.rglob("*") if p.is_file()) != {"SOURCE.json", *(e["path"] for e in old["files"])}:
            raise ValueError("Unmanaged destination files present")
    paths, ignored, excluded = inventory(source)
    outputs, entries = {}, []
    for path in paths:
        target = {"README.md": "SOURCE-README.md", "CHANGELOG.md": "SOURCE-CHANGELOG.md"}.get(path, path)
        original = (source / path).read_bytes()
        data = original
        adaptation = None
        if path == "README.md":
            data = data.replace(b"](azrael/release.json)", f"]({SOURCE_URL}/blob/main/azrael/release.json)".encode())
            data = data.replace(b"](CHANGELOG.md)", b"](SOURCE-CHANGELOG.md)")
            adaptation = "Renamed root README; legacy app metadata link points upstream; source changelog link follows rename. Generic C:\\path examples are retained, not personal paths."
        outputs[target] = data
        entry = dict(path=target, source=path, original=info(original), **info(data))
        if adaptation:
            entry["adaptation"] = adaptation
        entries.append(entry)
    outputs["README.md"] = README.encode()
    outputs["CHANGELOG.md"] = b"# Instruction changelog\n\n## 1.0.0\n\n- Complete Azrael instruction distribution with global guidance, agent roles, three skills and their support resources, examples, and optional workspace playbooks.\n- Versioned component mappings and complete working-tree provenance inventory.\n- Original shared-source history remains in [SOURCE-CHANGELOG.md](SOURCE-CHANGELOG.md).\n"
    if "LICENSE" not in outputs:
        outputs["LICENSE"] = LICENSE.encode()
    environment = dict(schemaVersion=1, instructionVersion="1.0.0", minimumAppVersion="0.4.0", components=components(paths, legacy=True))
    outputs["azrael-environment.json"] = (json.dumps(environment, indent=2) + "\n").encode()
    for path, data in sorted(outputs.items()):
        if not any(e["path"] == path for e in entries):
            entries.append(dict(path=path, generated=True, **info(data)))
    entries.sort(key=lambda e: e["path"])
    digest = hashlib.sha256(json.dumps(entries, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    head = subprocess.check_output(["git", "-C", str(source), "rev-parse", "HEAD"], text=True).strip()
    status = subprocess.check_output(["git", "-C", str(source), "status", "--porcelain=v1", "--untracked-files=all"], text=True).splitlines()
    record = dict(schemaVersion=1, sourceUrl=SOURCE_URL, sourceHead=head, workingTreeStatus=status,
                  contentSha256=digest, files=entries, ignored=ignored, excluded=excluded,
                  inventoryNote="All actual source files are mapped or explicitly excluded. SOURCE.json is provenance metadata and excludes its own recursive hash; the release manifest hashes it.")
    destination.mkdir(parents=True, exist_ok=True)
    for path, data in outputs.items():
        output = destination / path
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(data)
    if 'old' in locals():
        for entry in old["files"]:
            if entry["path"] not in outputs:
                (destination / entry["path"]).unlink()
    write_json(destination / "SOURCE.json", record)
    validate(destination, source)


if __name__ == "__main__":
    main()
