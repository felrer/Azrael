"""Point an isolated Azrael state copy at its own rollout files.

The live state and the original online snapshot are never valid targets.
"""

import json
import pathlib
import sqlite3
import sys


def within(path: pathlib.Path, parent: pathlib.Path) -> bool:
    return path == parent or parent in path.parents


def main() -> int:
    if len(sys.argv) != 2:
        raise ValueError("pass the isolated state-copy directory")
    root = pathlib.Path(sys.argv[1]).resolve(strict=True)
    verification = (pathlib.Path(__file__).resolve().parent.parent / "artifacts" / "verification").resolve()
    live = (pathlib.Path.home() / ".azrael-ex").resolve()
    codex = (pathlib.Path.home() / ".codex").resolve()
    if not root.is_dir() or not within(root, verification) or within(root, live) or within(root, codex):
        raise ValueError("state path is not an isolated verification copy")
    if root.name != "state" or "migration" not in root.parent.name:
        raise ValueError("state path is not a migration test copy")
    db = root / "state_5.sqlite"
    if not db.is_file():
        raise ValueError("state database is missing")

    with sqlite3.connect(db) as connection:
        rows = connection.execute("SELECT id, rollout_path, source, model_provider FROM threads").fetchall()
        updates = []
        child_samples = []
        for thread_id, raw, source, provider in rows:
            if isinstance(source, str) and source.startswith("{"):
                try:
                    subagent = json.loads(source).get("subagent", {})
                    parent = subagent.get("thread_spawn", {}).get("parent_thread_id")
                except (ValueError, AttributeError):
                    parent = None
                if isinstance(parent, str) and parent:
                    child_samples.append({"id": thread_id, "modelProvider": provider, "parentThreadId": parent})
            if not raw:
                continue
            original = pathlib.Path(raw)
            if not original.is_absolute():
                raise ValueError("relative rollout path in copy")
            try:
                relative = original.relative_to(live)
            except ValueError:
                if within(original, root):
                    relative = original.relative_to(root)
                else:
                    anchor = next(
                        (index for index, part in enumerate(original.parts) if part.lower() in {"sessions", "agents", "archived_sessions"}),
                        None,
                    )
                    if anchor is None:
                        raise ValueError("rollout path has no copied subtree")
                    relative = pathlib.Path(*original.parts[anchor:])
            if not relative.parts or relative.parts[0].lower() not in {"sessions", "agents", "archived_sessions"}:
                raise ValueError("rollout path is outside copied subtrees")
            target = (root / relative).resolve(strict=True)
            if not within(target, root) or not target.is_file():
                raise ValueError("rollout file is missing from copy")
            if str(target) != raw:
                updates.append((str(target), thread_id))
        connection.executemany("UPDATE threads SET rollout_path = ? WHERE id = ?", updates)
        remaining = connection.execute("SELECT COUNT(*) FROM threads WHERE rollout_path IS NOT NULL AND rollout_path != ''").fetchone()[0]
        if remaining != len([row for row in rows if row[1]]):
            raise ValueError("rollout count changed")

    (root / "copy-state-child-samples.json").write_text(json.dumps(child_samples) + "\n", encoding="utf-8")
    receipt = {"schema": 1, "threads": len(rows), "childThreads": len(child_samples), "localized": len(updates), "externalPaths": 0}
    (root / "copy-state-localized.json").write_text(json.dumps(receipt, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(receipt, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, sqlite3.Error, ValueError) as error:
        print(f"copy rollout remap failed: {type(error).__name__}", file=sys.stderr)
        raise SystemExit(1)
