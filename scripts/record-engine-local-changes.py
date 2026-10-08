"""Record explicitly reviewed tracked engine deltas against a verified immutable import."""
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


def record_changes(destination, baseline, baseline_receipt_sha256, expected_paths, current_receipt_sha256=None,
                   expected_adapted_paths=()):
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
    current = json.loads(current_bytes)
    if "localIntegration" in current:
        if hashlib.sha256(current_bytes).hexdigest() != current_receipt_sha256:
            raise ValueError("Current receipt must match the reviewed SHA256 for an update")
        importer.validate_inventory(destination, current)
        importer.validate_local_integration(destination, current)
        if current["localIntegration"]["originalReceipt"] != original:
            raise ValueError("Current receipt original import differs from baseline")
    elif current != original:
        raise ValueError("Current receipt must still match the original import")
    elif current_receipt_sha256 is not None and hashlib.sha256(current_bytes).hexdigest() != current_receipt_sha256:
        raise ValueError("Current receipt must match the reviewed SHA256")
    expected = set(expected_paths)
    expected_adapted = set(expected_adapted_paths)
    if (not expected and not expected_adapted) or len(expected) != len(expected_paths) or len(expected_adapted) != len(expected_adapted_paths) or expected & expected_adapted:
        raise ValueError("Expected paths must be explicit and unique")
    fixes = {fix["adaptedPath"]: (name, fix) for name, fix in original.get("sourceFixes", {}).items()}
    for name in expected_adapted:
        importer.safe_path(destination, name)
        if name not in fixes or not name.endswith(".rs"):
            raise ValueError(f"Expected adapted path is not fixed Rust source: {name}")
    for name in expected:
        importer.safe_path(destination, name)
        if name.endswith(".sql") or (name not in current["files"] and not name.endswith(".rs")):
            raise ValueError(f"Expected path is not ordinary Rust source or is protected: {name}")
    root = importer.canonical_path(importer.git(destination, "rev-parse", "--show-toplevel").decode().strip())
    prefix = destination.relative_to(root).as_posix()
    if prefix == ".":
        raise ValueError("Imported source must have a repository source prefix")
    if "localIntegration" in current and current["localIntegration"]["sourcePrefix"] != prefix:
        raise ValueError("Current receipt source prefix differs from repository")
    head = importer.git(root, "rev-parse", "HEAD").decode().strip()
    head_modes = {}
    for item in importer.git(root, "ls-tree", "-r", "-z", head, "--", prefix).split(b"\0"):
        if item:
            metadata, raw = item.split(b"\t", 1)
            head_modes[raw.decode("utf-8")] = metadata.decode().split()[0]
    modes = {}
    index = importer.git(root, "ls-files", "--stage", "-z", "--", prefix)
    for item in index.split(b"\0"):
        if not item:
            continue
        metadata, raw = item.split(b"\t", 1)
        mode, _, stage = metadata.decode().split()
        if stage != "0" or mode == "160000":
            raise ValueError("Unmerged source or submodule")
        modes[raw.decode("utf-8")] = mode
    record = copy.deepcopy(current)
    changes = {}
    for name in sorted(set(current["files"]) | expected):
        entry = current["files"].get(name)
        stored = importer.PRESERVED_IGNORE if name == ".gitignore" and original.get("distributionAdaptation") else name
        if name in original.get("sourceFixes", {}):
            stored = name + ".upstream"
        if stored != name and modes.get(prefix + "/" + stored) != head_modes.get(prefix + "/" + stored):
            raise ValueError(f"Unreviewed preserved source Git index mode change: {stored}")
        mode = entry["gitMode"] if entry else modes.get(prefix + "/" + name)
        measured = importer.describe(importer.safe_path(destination, stored), mode)
        repository_path = prefix + "/" + name
        if measured != entry or name in expected:
            if repository_path not in modes or modes[repository_path] != mode:
                raise ValueError(f"Local changes must be Git-tracked with original mode: {name}")
        elif modes.get(repository_path) != head_modes.get(
                repository_path, entry["gitMode"] if name not in original["files"] else None):
            raise ValueError(f"Unreviewed Git index mode change since repository HEAD: {name}")
        if measured != entry:
            changes[name] = {"before": entry, "after": measured}
            record["files"][name] = measured
    if set(changes) != expected:
        raise ValueError(f"Reviewed delta differs: actual={sorted(changes)}, expected={sorted(expected)}")
    prior_adapted = current.get("localIntegration", {}).get("adaptedChanges", {})
    adapted_changes, adapted_delta = {}, set()
    for name, (original_name, fix) in sorted(fixes.items()):
        if not name.endswith(".rs"):
            continue
        before = importer.adapted_source_entry(original["files"][original_name], fix)
        prior = prior_adapted.get(name, {}).get("after", before)
        measured = importer.describe(importer.safe_path(destination, name), before["gitMode"])
        if measured != prior or name in expected_adapted:
            if modes.get(prefix + "/" + name) != before["gitMode"]:
                raise ValueError(f"Adapted changes must be Git-tracked with original mode: {name}")
        if measured != prior:
            adapted_delta.add(name)
        if measured != before:
            adapted_changes[name] = {"before": before, "after": measured}
    if adapted_delta != expected_adapted:
        raise ValueError(f"Reviewed adapted delta differs: actual={sorted(adapted_delta)}, expected={sorted(expected_adapted)}")
    entries = record["files"]
    missing = [name for name, entry in entries.items() if entry["kind"] == "missing"]
    record.update(missingTrackedPaths=missing, fileCount=len(entries) - len(missing), inventoryCount=len(entries))
    record["inventorySha256"] = hashlib.sha256(importer.canonical(entries)).hexdigest()
    record["byteCount"] = sum(entry.get("size", 0) for entry in entries.values())
    record["localIntegration"] = {
        "schema": 3 if adapted_changes else (2 if set(entries) != set(original["files"]) else 1), "originalReceipt": original,
        "originalReceiptSha256": hashlib.sha256(importer.canonical(original)).hexdigest(),
        "repositoryHead": head, "sourcePrefix": prefix,
        "changes": {name: {"before": original["files"].get(name), "after": entries[name]}
                    for name in sorted(entries) if original["files"].get(name) != entries[name]},
    }
    if adapted_changes:
        record["localIntegration"]["adaptedChanges"] = adapted_changes
    importer.validate_receipt(destination, record, allow_build_caches=True)
    # Recheck all inputs immediately before publishing the measured receipt.
    importer.validate_receipt(baseline, original)
    if (baseline_path.read_bytes() != baseline_bytes or current_path.read_bytes() != current_bytes or
            importer.git(root, "rev-parse", "HEAD").decode().strip() != head or
            importer.git(root, "ls-files", "--stage", "-z", "--", prefix) != index):
        raise ValueError("Source receipt, repository HEAD or index changed during integration")
    importer.validate_receipt(destination, record, allow_build_caches=True)
    with current_path.open("w", encoding="utf-8", newline="\n") as output:
        json.dump(record, output, indent=2, sort_keys=True)
        output.write("\n")
    return {"inventorySha256": record["inventorySha256"], "repositoryHead": head,
            "upstreamHead": original["head"], "sourcePrefix": prefix, "changes": record["localIntegration"]["changes"],
            "adaptedChanges": adapted_changes}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--destination", type=Path, required=True)
    parser.add_argument("--baseline", type=Path, required=True)
    parser.add_argument("--baseline-receipt-sha256", required=True)
    parser.add_argument("--current-receipt-sha256", help="Reviewed current receipt hash; required when updating localIntegration")
    parser.add_argument("--expected-path", action="append", default=[])
    parser.add_argument("--expected-adapted-path", action="append", default=[], help="Explicit new content delta in fixed Rust adaptation")
    args = parser.parse_args()
    print(json.dumps(record_changes(args.destination, args.baseline, args.baseline_receipt_sha256, args.expected_path,
                                   args.current_receipt_sha256, args.expected_adapted_path), indent=2))


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        print(f"Local integration failed: {error}", file=sys.stderr)
        sys.exit(1)
