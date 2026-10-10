"""Bind the deployable engine bundle to source contents and binary hashes."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess

RECEIPT = "azrael-engine-build.json"
TARGET = "x86_64-pc-windows-msvc"
BINARY_NAMES = ("codex.exe", "azrael-bridge.exe", "codex-code-mode-host.exe")
BUILD_ENVIRONMENT_KEYS = (
    "RUSTFLAGS", "CARGO_ENCODED_RUSTFLAGS", "RUSTC_WRAPPER", "RUSTUP_TOOLCHAIN",
    "V8_FROM_SOURCE", "V8_FORCE_DEBUG", "RUSTY_V8_ARCHIVE", "RUSTY_V8_MIRROR",
    "RUSTY_V8_SRC_BINDING_PATH", "GN", "GN_ARGS", "EXTRA_GN_ARGS", "NINJA",
    "CLANG_BASE_PATH", "PYTHON", "LIBCLANG_PATH",
)


def sha(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def binary_names(target=TARGET):
    policy = json.loads(Path(__file__).with_name("azrael-platforms.json").read_text())
    entry = next((item for item in policy["platforms"] if item["target"] == target), None)
    if entry is None:
        raise ValueError(f"Unsupported engine target: {target}")
    return tuple(name + entry["executableSuffix"] for name in ("codex", "azrael-bridge", "codex-code-mode-host"))


def snapshot(root, target=TARGET):
    binary_names(target)
    root = Path(root).resolve()
    imported_receipt = root / "SOURCE.json"
    if imported_receipt.exists() or imported_receipt.is_symlink():
        if imported_receipt.is_symlink():
            raise ValueError("Imported source receipt must be a regular file")
        helper_path = Path(__file__).with_name("import-engine-source.py")
        spec = importlib.util.spec_from_file_location("engine_source_import", helper_path)
        helper = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(helper)
        receipt_bytes = imported_receipt.read_bytes()
        receipt = json.loads(receipt_bytes)
        root = root.resolve()
        materialization = {}
        if os.name == "posix" and target != TARGET:
            adapter_spec = importlib.util.spec_from_file_location(
                "engine_native_materialization", Path(__file__).with_name("engine-native-materialization.py"))
            adapter = importlib.util.module_from_spec(adapter_spec)
            adapter_spec.loader.exec_module(adapter)
            inventory_digest, native_hash = adapter.validate_native(root, receipt, helper, target)
            materialization = {"nativeMaterializationSha256": native_hash, "nativeMaterializationPolicy": "git-unix-v1"}
        else:
            inventory_digest = helper.validate_receipt(root, receipt, allow_build_caches=True)
        digest = hashlib.sha256()
        for name, entry in sorted(receipt["files"].items()):
            content = entry.get("sha256", "missing")
            digest.update(name.encode("utf-8") + b"\0" + content.encode() + b"\0")
        if imported_receipt.read_bytes() != receipt_bytes:
            raise ValueError("Imported source receipt changed during provenance verification")
        return {
            "schema": 2, "sourceKind": "imported-snapshot", "head": receipt["head"],
            "importedInventorySha256": inventory_digest,
            "importedReceiptSha256": hashlib.sha256(receipt_bytes).hexdigest(),
            "distributionAdaptationSha256": hashlib.sha256(helper.canonical(receipt.get("distributionAdaptation", {}))).hexdigest(),
            "distributionFilesSha256": hashlib.sha256(helper.canonical(receipt.get("distributionFiles", {}))).hexdigest(),
            "sourceFixesSha256": hashlib.sha256(helper.canonical(receipt.get("sourceFixes", {}))).hexdigest(),
            "sourceSha256": digest.hexdigest(), "fileCount": len(receipt["files"]), "target": target,
            **materialization,
            "buildEnvironment": {key: os.environ.get(key, "") for key in BUILD_ENVIRONMENT_KEYS},
        }
    def git(*args):
        return subprocess.check_output(["git", "-C", str(root), *args])
    try:
        git_root = Path(git("rev-parse", "--show-toplevel").decode().strip()).resolve()
    except subprocess.CalledProcessError as error:
        raise ValueError("Engine source root has no imported receipt and is not a Git worktree root") from error
    if git_root != root:
        raise ValueError("Engine source root has no imported receipt and is not a Git worktree root")
    paths = sorted(set(git("ls-files", "--cached", "--others", "--exclude-standard", "-z").split(b"\0")) - {b""})
    digest = hashlib.sha256()
    for raw in paths:
        file = root / os.fsdecode(raw)
        content = sha(file) if file.is_file() else "missing"
        digest.update(raw + b"\0" + content.encode() + b"\0")
    return {
        "schema": 1, "head": git("rev-parse", "HEAD").decode().strip(),
        "sourceSha256": digest.hexdigest(), "fileCount": len(paths), "target": target,
        "buildEnvironment": {key: os.environ.get(key, "") for key in BUILD_ENVIRONMENT_KEYS},
    }


def verify(root, directory, target=TARGET):
    names = binary_names(target)
    receipt = directory / RECEIPT
    if not receipt.is_file():
        raise ValueError("Engine has no source provenance. Rebuild with build-azrael.ps1.")
    record = json.loads(receipt.read_text(encoding="utf-8-sig"))
    if record.get("source") != snapshot(root, target):
        raise ValueError("Engine source changed since this pair was built. Run a full engine build.")
    if set(record.get("binaries", {})) != set(names):
        raise ValueError("Engine provenance binary identities differ from target")
    for name in names:
        if record.get("binaries", {}).get(name) != sha(directory / name):
            raise ValueError(f"Engine provenance binary mismatch: {name}")
    host = record.get("externalRuntimes", {}).get("codeModeHost", {})
    if host.get("sha256") != record.get("binaries", {}).get(names[2]):
        raise ValueError("Engine provenance external code-mode host mismatch")
    if host.get("kind", "external-import") not in ("external-import", "source-built"):
        raise ValueError("Invalid code-mode host provenance kind")
    if host.get("kind") == "source-built" and host.get("sourceSha256") != record["source"]["sourceSha256"]:
        raise ValueError("Source-built code-mode host source mismatch")
    return record


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("snapshot", "record", "verify"))
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--file", type=Path)
    parser.add_argument("--engine-dir", type=Path)
    parser.add_argument("--code-mode-host-source", type=Path)
    parser.add_argument("--target", default=TARGET)
    parser.add_argument("--code-mode-host-built", action="store_true")
    parser.add_argument("--code-mode-host-original", type=Path)
    parser.add_argument("--code-mode-host-original-sha256")
    args = parser.parse_args()
    names = binary_names(args.target)
    if args.action == "snapshot":
        value = snapshot(args.root, args.target)
        args.file.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
    elif args.action == "record":
        before = json.loads(args.file.read_text(encoding="utf-8-sig"))
        if before != snapshot(args.root, args.target):
            raise ValueError("Source changed during engine build. Do not package this pair; rebuild.")
        host_hash = sha(args.engine_dir / names[2])
        if args.code_mode_host_built:
            if args.code_mode_host_source or args.code_mode_host_original or args.code_mode_host_original_sha256:
                raise ValueError("Source-built host cannot also be an external import")
            host = {"kind": "source-built", "sha256": host_hash, "sourceSha256": before["sourceSha256"]}
        else:
            if args.code_mode_host_source is None or not args.code_mode_host_source.is_file():
                raise ValueError("Record requires an existing --code-mode-host-source")
            if host_hash != sha(args.code_mode_host_source):
                raise ValueError("Copied code-mode host differs from its external source")
            original = args.code_mode_host_original or args.code_mode_host_source
            original_hash = args.code_mode_host_original_sha256 or sha(original)
            if original_hash != host_hash:
                raise ValueError("Original code-mode host differs from frozen import")
            host = {"kind": "external-import", "sourcePath": str(original.resolve()), "sha256": host_hash}
        value = {
            "source": before,
            "binaries": {name: sha(args.engine_dir / name) for name in names},
            "externalRuntimes": {"codeModeHost": host},
        }
        destination = args.engine_dir / RECEIPT
        temporary = destination.with_suffix(".tmp")
        temporary.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
        temporary.replace(destination)
    else:
        value = verify(args.root, args.engine_dir, args.target)
    print(json.dumps(value))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        raise SystemExit(str(error)) from error
