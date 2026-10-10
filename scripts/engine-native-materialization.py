"""Scoped Unix materialization adapter; canonical importer metadata stays unchanged."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import stat


def native_link_permissions(target):
    policy = json.loads(Path(__file__).with_name("azrael-platforms.json").read_text())
    descriptor = next((item for item in policy["platforms"] if item["target"] == target), None)
    if descriptor is None or descriptor["os"] not in ("linux", "darwin"):
        raise ValueError("Native materialization requires a supported Unix target")
    return 0o755 if descriptor["os"] == "darwin" else 0o777


def validate_native(root, receipt, helper, target):
    root = Path(root).resolve()
    link_permissions = native_link_permissions(target)
    # These validate canonical receipt digests, original provenance and reviewed deltas.
    digest = helper.validate_inventory(root, receipt)
    if "localIntegration" in receipt:
        helper.validate_local_integration(root, receipt)
    expected = {}
    for name, entry in receipt["files"].items():
        if entry["kind"] == "missing":
            expected[name] = entry
            continue
        if name == ".gitignore" and receipt.get("distributionAdaptation"):
            adaptation = receipt["distributionAdaptation"]
            expected[helper.PRESERVED_IGNORE] = entry
            expected[name] = {**entry, "sha256": adaptation["adaptedSha256"], "size": adaptation["adaptedSize"]}
        elif name in receipt.get("sourceFixes", {}):
            fix = receipt["sourceFixes"][name]
            expected[name + ".upstream"] = entry
            change = receipt.get("localIntegration", {}).get("adaptedChanges", {}).get(fix["adaptedPath"])
            expected[fix["adaptedPath"]] = change["after"] if change else helper.adapted_source_entry(entry, fix)
        else:
            expected[name] = entry
    original_describe = helper.describe
    observed = {}

    def checked(path, git_mode=None):
        relative = Path(path).relative_to(root).as_posix()
        entry = expected.get(relative)
        actual = original_describe(path, git_mode)
        if entry is None:
            raise ValueError(f"Native materialization descriptor has no canonical owner: {relative}")
        if actual["kind"] == "missing":
            if actual != entry:
                raise ValueError(f"Copied source differs: {relative} (native materialization)")
            observed[relative] = actual
            return actual
        normalized = dict(actual)
        windows_executable = (entry.get("permissions") == 0o777
                              and Path(relative).suffix.lower() in (".cmd", ".bat", ".exe", ".com"))
        if entry["kind"] == "file" and (entry.get("permissions") == 0o666 or windows_executable) and git_mode in ("100644", "100755"):
            native_mode = 0o755 if git_mode == "100755" else 0o644
            if actual["kind"] != "file" or actual["permissions"] != native_mode:
                raise ValueError(f"Native materialization file kind or permissions differ: {relative}")
            normalized["permissions"] = entry["permissions"]
        elif entry["kind"] in ("symlink", "git-symlink-placeholder") and git_mode == "120000":
            canonical_modes = (0o666,) if entry["kind"] == "git-symlink-placeholder" else (0o755, 0o777)
            if entry.get("permissions") not in canonical_modes:
                raise ValueError(f"Canonical Git link permissions have no approved native equivalence: {relative}")
            if actual["kind"] != "symlink" or actual["permissions"] != link_permissions:
                raise ValueError(f"Native materialization Git link kind or permissions differ: {relative}")
            target = os.readlink(path)
            resolved = Path(path).resolve()
            target_bytes = os.fsencode(target)
            if (PurePosixPath(target).is_absolute() or "\\" in target or ":" in target or not resolved.is_relative_to(root) or not resolved.exists()
                    or len(target_bytes) != actual["size"] or hashlib.sha256(target_bytes).hexdigest() != actual["sha256"]):
                raise ValueError(f"Native materialization link escapes or has no contained target: {relative}")
            normalized["kind"] = entry["kind"]
            normalized["permissions"] = entry["permissions"]
        if normalized != entry:
            raise ValueError(f"Copied source differs: {relative} (native materialization)")
        observed[relative] = {**actual, **({"linkText": target} if actual["kind"] == "symlink" else {})}
        return normalized

    # Only this freshly loaded importer instance uses the explicit, checked equivalence.
    helper.describe = checked
    try:
        helper.validate_receipt(root, receipt, allow_build_caches=True)
        # Also check adapted bytes and modes which importer verifies without describe().
        for name, entry in expected.items():
            checked(root / name, entry["gitMode"])
    finally:
        helper.describe = original_describe
    records = []
    for name, entry in sorted(expected.items()):
        records.append({"path": name, **observed[name]})
    for name in sorted(receipt.get("distributionFiles", {})):
        path = root / name
        if not path.is_file() or path.is_symlink() or stat.S_IMODE(path.stat().st_mode) != 0o644:
            raise ValueError(f"Native distribution file kind or permissions differ: {name}")
        records.append({"path": name, **original_describe(path)})
    records.append({"path": "SOURCE.json", **original_describe(root / "SOURCE.json")})
    directories = {root}
    for name in expected:
        for parent in (root / name).parents:
            if not parent.is_relative_to(root):
                break
            if parent.is_dir():
                directories.add(parent)
    records.extend({"path": directory.relative_to(root).as_posix(), "kind": "directory",
                    "permissions": stat.S_IMODE(directory.stat().st_mode)}
                   for directory in sorted(directories))
    return digest, hashlib.sha256(helper.canonical(records)).hexdigest()
