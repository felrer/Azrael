"""Record explicitly reviewed tracked engine edits against a verified immutable import."""
import argparse
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys

spec = importlib.util.spec_from_file_location("engine_source_import", Path(__file__).with_name("import-engine-source.py"))
importer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(importer)


def record_changes(destination, baseline, baseline_receipt_sha256, expected_paths):
    destination, baseline = importer.canonical_path(destination), importer.canonical_path(baseline)
    if destination == baseline or destination.is_relative_to(baseline) or baseline.is_relative_to(destination):
        raise ValueError("Baseline must be an independent immutable import")
    baseline_path = importer.safe_path(baseline, "SOURCE.json")
    current_path = importer.safe_path(destination, "SOURCE.json")
    if baseline_path.is_symlink() or current_path.is_symlink():
        raise ValueError("Source receipts must be regular files")
    baseline_bytes, current_bytes = baseline_path.read_bytes(), current_path.read_bytes()
    if hashlib.sha256(baseline_bytes).hexdigest() != baseline_receipt_sha256:
        raise ValueError("Baseline receipt does not match the reviewed SHA256")
    original = json.loads(baseline_bytes)
    if "localIntegration" in original:
        raise ValueError("Baseline must be the original import")
    importer.validate_receipt(baseline, original)
    if json.loads(current_bytes) != original:
        raise ValueError("Current receipt must still match the original import")
    expected = set(expected_paths)
    if not expected or len(expected) != len(expected_paths):
        raise ValueError("Expected paths must be explicit and unique")
    for name in expected:
        importer.safe_path(destination, name)
        if name not in original["files"] or name.endswith(".sql"):
            raise ValueError(f"Expected path is absent or protected: {name}")
    root = importer.canonical_path(importer.git(destination, "rev-parse", "--show-toplevel").decode().strip())
    prefix = destination.relative_to(root).as_posix()
    if prefix == ".":
        raise ValueError("Imported source must have a repository source prefix")
    head = importer.git(root, "rev-parse", "HEAD").decode().strip()
    modes = {}
    for item in importer.git(root, "ls-files", "--stage", "-z", "--", prefix).split(b"\0"):
        if not item:
            continue
        metadata, raw = item.split(b"\t", 1)
        mode, _, stage = metadata.decode().split()
        if stage != "0" or mode == "160000":
            raise ValueError("Unmerged source or submodule")
        modes[raw.decode("utf-8")] = mode
    record = copy.deepcopy(original)
    changes = {}
    for name, entry in original["files"].items():
        stored = importer.PRESERVED_IGNORE if name == ".gitignore" and original.get("distributionAdaptation") else name
        if name in original.get("sourceFixes", {}):
            stored = name + ".upstream"
        measured = importer.describe(importer.safe_path(destination, stored), entry["gitMode"])
        if measured != entry:
            if prefix + "/" + name not in modes or modes[prefix + "/" + name] != entry["gitMode"]:
                raise ValueError(f"Local changes must be Git-tracked with original mode: {name}")
            changes[name] = {"before": entry, "after": measured}
            record["files"][name] = measured
    if set(changes) != expected:
        raise ValueError(f"Reviewed delta differs: actual={sorted(changes)}, expected={sorted(expected)}")
    entries = record["files"]
    record["inventorySha256"] = hashlib.sha256(importer.canonical(entries)).hexdigest()
    record["byteCount"] = sum(entry.get("size", 0) for entry in entries.values())
    record["localIntegration"] = {
        "schema": 1, "originalReceipt": original,
        "originalReceiptSha256": hashlib.sha256(importer.canonical(original)).hexdigest(),
        "repositoryHead": head, "sourcePrefix": prefix, "changes": dict(sorted(changes.items())),
    }
    importer.validate_receipt(destination, record, allow_build_caches=True)
    # Recheck all inputs immediately before publishing the measured receipt.
    importer.validate_receipt(baseline, original)
    if (baseline_path.read_bytes() != baseline_bytes or current_path.read_bytes() != current_bytes or
            importer.git(root, "rev-parse", "HEAD").decode().strip() != head):
        raise ValueError("Source receipt or repository HEAD changed during integration")
    importer.validate_receipt(destination, record, allow_build_caches=True)
    with current_path.open("w", encoding="utf-8", newline="\n") as output:
        json.dump(record, output, indent=2, sort_keys=True)
        output.write("\n")
    return {"inventorySha256": record["inventorySha256"], "repositoryHead": head,
            "upstreamHead": original["head"], "sourcePrefix": prefix, "changes": record["localIntegration"]["changes"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--destination", type=Path, required=True)
    parser.add_argument("--baseline", type=Path, required=True)
    parser.add_argument("--baseline-receipt-sha256", required=True)
    parser.add_argument("--expected-path", action="append", required=True)
    args = parser.parse_args()
    print(json.dumps(record_changes(args.destination, args.baseline, args.baseline_receipt_sha256, args.expected_path), indent=2))


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        print(f"Local integration failed: {error}", file=sys.stderr)
        sys.exit(1)
