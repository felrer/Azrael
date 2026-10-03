"""Create a complete review archive from the verified imported engine snapshot."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import subprocess
import sys
import zipfile

PROJECT = Path(__file__).resolve().parents[1]


def sha(file):
    with file.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def verify(source):
    subprocess.run([sys.executable, "-B", str(PROJECT / "scripts/import-engine-source.py"),
                    "--destination", str(source), "--check", "--snapshot-only"], check=True)


def inventory(source):
    receipt = json.loads((source / "SOURCE.json").read_text(encoding="utf-8"))
    names = {name for name, entry in receipt["files"].items() if entry["kind"] != "missing"}
    names.add("SOURCE.json")
    names.update(receipt.get("distributionFiles", {}))
    # The only distribution adaptation preserves the original ignore file here.
    if (source / ".gitignore.upstream").is_file():
        names.add(".gitignore.upstream")
    for original, correction in receipt.get("sourceFixes", {}).items():
        names.discard(original)
        names.add(correction["adaptedPath"])
        names.add(correction["preservedPath"])
    result = []
    for name in sorted(names):
        parts = PurePosixPath(name).parts
        if not parts or name.startswith("/") or "\\" in name or any(p in (".", "..") for p in parts):
            raise ValueError("Invalid source inventory path")
        file = source / name
        if file.is_symlink():
            raise ValueError("Source archives require recorded regular-file bytes")
        result.append({"path": name, "size": file.stat().st_size, "sha256": sha(file)})
    return receipt, result


def build(source, output):
    source, output = source.resolve(), output.resolve()
    if output == source or source in output.parents:
        raise ValueError("Output must be outside source")
    manifest_path = output.with_suffix(".manifest.json")
    if output.exists() or manifest_path.exists():
        raise ValueError("Output paths must be new")
    verify(source)
    receipt, files = inventory(source)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("xb") as target:
        with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for entry in files:
                file = source / entry["path"]
                info = zipfile.ZipInfo("engine/" + entry["path"], date_time=(2000, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o100644 << 16
                archive.writestr(info, file.read_bytes())
    verify(source)
    if inventory(source)[1] != files:
        raise ValueError("Source changed while packaging; archive retained as failed output")
    with zipfile.ZipFile(output) as archive:
        if archive.namelist() != ["engine/" + item["path"] for item in files]:
            raise ValueError("Archive inventory mismatch")
        for entry in files:
            content = archive.read("engine/" + entry["path"])
            if len(content) != entry["size"] or hashlib.sha256(content).hexdigest() != entry["sha256"]:
                raise ValueError("Archive content mismatch: " + entry["path"])
    manifest = {"schemaVersion": 1, "kind": "azrael-engine-source",
                "sourceHead": receipt["head"], "snapshotCapturedUtc": receipt["snapshotCapturedUtc"],
                "originalInventorySha256": receipt["inventorySha256"],
                "missingTrackedPaths": receipt["missingTrackedPaths"], "files": files,
                "archive": {"name": output.name, "size": output.stat().st_size, "sha256": sha(output)}}
    with manifest_path.open("x", encoding="utf-8") as stream:
        json.dump(manifest, stream, indent=2)
        stream.write("\n")
    print(json.dumps({"archive": str(output), "manifest": str(manifest_path),
                      "fileCount": len(files), "sha256": manifest["archive"]["sha256"]}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=PROJECT / "engine")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    build(args.source, args.output)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, subprocess.CalledProcessError, zipfile.BadZipFile) as error:
        raise SystemExit(str(error)) from error
