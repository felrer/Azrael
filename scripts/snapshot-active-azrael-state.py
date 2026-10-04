"""Copy the migration-relevant Azrael state while its old engine stays open.

Each SQLite database uses the standard-library online backup API. Other files
are accepted only when source and copy hashes agree across the copy interval.
The result is individually consistent, not an atomic cross-database snapshot.
"""

import argparse
import hashlib
import json
import os
import shutil
import sqlite3
import sys
import time
from pathlib import Path


ROOT_FILES = {
    ".credentials.json",
    ".sandbox_migration",
    "AGENTS.md",
    "auth.json",
    "cap_sid",
    "config.toml",
    "installation_id",
    "models_cache.json",
    "session_index.jsonl",
}
STATE_DIRS = (
    "azrael/accounts",
    "azrael/providers",
    "azrael/devin",
    "azrael/devin-usage",
    "sessions",
    "agents",
    "rollout-migrations",
)
SKIP_SUFFIXES = (".sqlite-wal", ".sqlite-shm", ".sqlite-journal")


def digest(path):
    hash_value = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            hash_value.update(block)
    return hash_value.hexdigest()


def copy_stable(source, destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    for attempt in range(5):
        before = digest(source)
        shutil.copyfile(source, destination)
        after = digest(source)
        copied = digest(destination)
        if before == after == copied:
            return destination.stat().st_size
        time.sleep(0.2 * (attempt + 1))
    raise RuntimeError("file changed throughout five copy attempts")


def backup_sqlite(source, destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    origin = sqlite3.connect(source.as_uri() + "?mode=ro", uri=True, timeout=30)
    target = sqlite3.connect(destination, timeout=30)
    try:
        def progress(_status, _remaining, _total):
            if time.monotonic() - started > 600:
                raise TimeoutError("SQLite online backup exceeded ten minutes")

        origin.backup(target, pages=1024, progress=progress, sleep=0.05)
        result = target.execute("PRAGMA quick_check").fetchone()
        if result != ("ok",):
            raise RuntimeError("copied SQLite database failed quick_check")
    finally:
        target.close()
        origin.close()
    return destination.stat().st_size


def descendants(directory):
    for parent, folders, files in os.walk(directory, followlinks=False):
        parent_path = Path(parent)
        for folder in folders:
            if (parent_path / folder).is_symlink():
                raise RuntimeError("state tree contains a directory link")
        for name in files:
            file_path = parent_path / name
            if file_path.is_symlink():
                raise RuntimeError("state tree contains a file link")
            yield file_path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    if not args.source.is_absolute() or not args.destination.is_absolute():
        raise RuntimeError("source and destination must be absolute")
    source = args.source.resolve(strict=True)
    destination = args.destination.resolve(strict=False)
    ordinary = (Path.home() / ".codex").resolve(strict=False)
    if not source.is_dir() or source == ordinary or ordinary in source.parents:
        raise RuntimeError("source must be an Azrael state directory")
    if destination.exists() or source == destination or source in destination.parents or destination in source.parents:
        raise RuntimeError("destination must be new and separate from source")

    database_files = sorted(source.glob("*.sqlite"))
    if not database_files or not (source / "sessions").is_dir():
        raise RuntimeError("source lacks Azrael databases or sessions")
    files = [source / name for name in sorted(ROOT_FILES) if (source / name).is_file()]
    for relative in STATE_DIRS:
        directory = source / relative
        if directory.exists():
            if directory.is_symlink() or not directory.is_dir():
                raise RuntimeError("state directory is not a real directory")
            files.extend(descendants(directory))
    files = [entry for entry in files if not entry.name.endswith(SKIP_SUFFIXES) and entry.suffix != ".sqlite"]
    destination.mkdir(parents=True)
    report = {
        "schema": 1,
        "status": "incomplete",
        "source": str(source),
        "copy": str(destination),
        "atomicAcrossDatabases": False,
        "databases": [],
        "regularFileCount": 0,
        "regularBytes": 0,
        "error": None,
    }
    try:
        for database in database_files:
            size = backup_sqlite(database, destination / database.name)
            report["databases"].append({"name": database.name, "bytes": size, "quickCheck": "ok"})
        for file_path in files:
            size = copy_stable(file_path, destination / file_path.relative_to(source))
            report["regularFileCount"] += 1
            report["regularBytes"] += size
        report["status"] = "individual-files-consistent"
    except Exception as error:
        report["error"] = type(error).__name__
        raise
    finally:
        receipt = destination.parent / (destination.name + ".online-snapshot.json")
        receipt.write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(json.dumps({"status": report["status"], "databases": len(report["databases"]), "regularFileCount": report["regularFileCount"], "receipt": str(receipt), "error": report["error"]}))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        sys.exit(1)
