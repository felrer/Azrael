"""Bind the deployable engine bundle to source contents and binary hashes."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess

RECEIPT = "azrael-engine-build.json"
TARGET = "x86_64-pc-windows-msvc"
BINARY_NAMES = ("codex.exe", "azrael-bridge.exe", "codex-code-mode-host.exe")


def sha(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def snapshot(root):
    def git(*args):
        return subprocess.check_output(["git", "-C", str(root), *args])
    paths = sorted(set(git("ls-files", "--cached", "--others", "--exclude-standard", "-z").split(b"\0")) - {b""})
    digest = hashlib.sha256()
    for raw in paths:
        file = root / os.fsdecode(raw)
        content = sha(file) if file.is_file() else "missing"
        digest.update(raw + b"\0" + content.encode() + b"\0")
    return {
        "schema": 1, "head": git("rev-parse", "HEAD").decode().strip(),
        "sourceSha256": digest.hexdigest(), "fileCount": len(paths), "target": TARGET,
        "buildEnvironment": {key: os.environ.get(key, "") for key in
                             ("RUSTFLAGS", "CARGO_ENCODED_RUSTFLAGS", "RUSTC_WRAPPER", "RUSTUP_TOOLCHAIN")},
    }


def verify(root, directory):
    receipt = directory / RECEIPT
    if not receipt.is_file():
        raise ValueError("Engine has no source provenance. Rebuild with build-azrael.ps1.")
    record = json.loads(receipt.read_text(encoding="utf-8-sig"))
    if record.get("source") != snapshot(root):
        raise ValueError("Engine source changed since this pair was built. Run a full engine build.")
    for name in BINARY_NAMES:
        if record.get("binaries", {}).get(name) != sha(directory / name):
            raise ValueError(f"Engine provenance binary mismatch: {name}")
    external_host = record.get("externalRuntimes", {}).get("codeModeHost", {})
    if external_host.get("sha256") != record.get("binaries", {}).get("codex-code-mode-host.exe"):
        raise ValueError("Engine provenance external code-mode host mismatch")
    return record


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("snapshot", "record", "verify"))
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--file", type=Path)
    parser.add_argument("--engine-dir", type=Path)
    parser.add_argument("--code-mode-host-source", type=Path)
    args = parser.parse_args()
    if args.action == "snapshot":
        value = snapshot(args.root)
        args.file.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
    elif args.action == "record":
        before = json.loads(args.file.read_text(encoding="utf-8-sig"))
        if before != snapshot(args.root):
            raise ValueError("Source changed during engine build. Do not package this pair; rebuild.")
        if args.code_mode_host_source is None or not args.code_mode_host_source.is_file():
            raise ValueError("Record requires an existing --code-mode-host-source")
        host_hash = sha(args.code_mode_host_source)
        if host_hash != sha(args.engine_dir / "codex-code-mode-host.exe"):
            raise ValueError("Copied code-mode host differs from its external source")
        value = {
            "source": before,
            "binaries": {name: sha(args.engine_dir / name) for name in BINARY_NAMES},
            "externalRuntimes": {
                "codeModeHost": {
                    "sourcePath": str(args.code_mode_host_source.resolve()),
                    "sha256": host_hash,
                }
            },
        }
        destination = args.engine_dir / RECEIPT
        temporary = destination.with_suffix(".tmp")
        temporary.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
        temporary.replace(destination)
    else:
        value = verify(args.root, args.engine_dir)
    print(json.dumps(value))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        raise SystemExit(str(error)) from error
