"""Run-scoped source reuse using Windows metadata, never a content-proof cache.

Default/unsupported callers still use the original full validator. Metadata is a
change detector for ordinary build inputs, not protection against deliberate
timestamp manipulation or an atomic snapshot of concurrent writes.
"""
import ctypes
from ctypes import wintypes
from functools import cache
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def helper_module():
    spec = importlib.util.spec_from_file_location("source_state_importer", Path(__file__).with_name("import-engine-source.py"))
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    return helper


@cache
def local_ntfs(anchor):
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    drive = kernel.GetDriveTypeW
    drive.argtypes = [wintypes.LPCWSTR]
    drive.restype = wintypes.UINT
    volume = kernel.GetVolumeInformationW
    volume.argtypes = [wintypes.LPCWSTR, wintypes.LPWSTR, wintypes.DWORD, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, wintypes.LPWSTR, wintypes.DWORD]
    volume.restype = wintypes.BOOL
    name = ctypes.create_unicode_buffer(64)
    return drive(anchor) == 3 and bool(volume(anchor, None, 0, None, None, None, name, len(name))) and name.value == "NTFS"


def metadata(root, helper, node):
    """Enumerate complete imported inputs without reading their file contents."""
    if os.name != "nt":
        raise ValueError("Source metadata reuse is currently Windows-only")
    context = helper.validation_root(root)
    if not local_ntfs(context.path.anchor):
        raise ValueError("Source metadata reuse requires a local NTFS volume")
    io_root = helper.filesystem_path(context.path)
    if not (io_root / "SOURCE.json").is_file() or (io_root / ".git").exists():
        raise ValueError("Source metadata reuse requires an imported source")
    command = [node, str(Path(__file__).with_name("engine-source-metadata.cjs"))]
    result = subprocess.run(command, input=json.dumps({"root": str(context.path), "excluded": helper.EXCLUDED}), capture_output=True, encoding="utf-8")
    if result.returncode:
        raise ValueError("Source metadata unavailable: " + result.stderr)
    observation = json.loads(result.stdout)
    if not isinstance(observation.get("inventory"), str) or len(observation["inventory"]) != 64:
        raise ValueError("Malformed metadata observation")
    context.check()
    return {"root": str(context.path), "identity": list(context.identity), "inventory": observation["inventory"]}


def selected_snapshot(root, target, state_file, generation, full_snapshot, environment_keys):
    """Reuse only an observation from this explicit build generation."""
    if not state_file:
        return full_snapshot(root, target)
    node = shutil.which("node")
    if node is None:
        print("source-state: full (Node unavailable)", file=sys.stderr)
        return full_snapshot(root, target)
    helper = helper_module()
    files = ("engine-provenance.py", "engine-source-state.py", "engine-source-metadata.cjs", "import-engine-source.py", "azrael-platforms.json")
    with open(node, "rb") as stream:
        node_sha = hashlib.file_digest(stream, "sha256").hexdigest()
    binding = {"generation": generation, "target": target, "python": sys.version,
               "executable": str(Path(sys.executable).resolve()),
               "node": {"path": node, "sha256": node_sha},
               "tools": {name: hashlib.sha256(Path(__file__).with_name(name).read_bytes()).hexdigest() for name in files},
               "environment": {key: os.environ.get(key, "") for key in environment_keys}}
    state_file = Path(state_file)
    # State is private to a build attempt and written under its existing owner
    # lease. It must not be redirected through a link or into selected sources.
    if not state_file.is_absolute() or ".." in state_file.parts or not generation or state_file.is_relative_to(Path(root).resolve()):
        raise ValueError("Explicit generation and independent absolute source state path required")
    for parent in (state_file, *state_file.parents):
        if parent.is_symlink() or (parent.exists() and getattr(parent.lstat(), "st_file_attributes", 0) & 0x400):
            raise ValueError("Linked source state path")
    state = {"schema": 1, "entries": {}}
    try:
        loaded = json.loads(state_file.read_text(encoding="utf-8"))
        if loaded.get("schema") == 1 and isinstance(loaded.get("entries"), dict):
            state = loaded
    except (OSError, ValueError, TypeError, AttributeError):
        pass
    try:
        before = metadata(root, helper, node)
    except (OSError, ValueError):
        print("source-state: full (metadata unavailable)", file=sys.stderr)
        return full_snapshot(root, target)
    key = digest({"binding": binding, "root": before["root"]})
    entry = state["entries"].get(key)
    if isinstance(entry, dict) and entry.get("metadata") == before and isinstance(entry.get("snapshot"), dict):
        print("source-state: reused (same run and metadata)", file=sys.stderr)
        return entry["snapshot"]
    print("source-state: full (new or changed inputs)", file=sys.stderr)
    result = full_snapshot(root, target)
    try:
        after = metadata(root, helper, node)
    except (OSError, ValueError):
        print("source-state: full result only (metadata unavailable after validation)", file=sys.stderr)
        return result
    if before != after:
        raise ValueError("Source changed during full validation; no reusable observation published")
    # Keep only this generation's observations; the file is not a cross-run cache.
    state["entries"] = {k: v for k, v in state["entries"].items() if isinstance(v, dict) and v.get("generation") == generation}
    state["entries"][key] = {"generation": generation, "metadata": after, "snapshot": result}
    temporary = state_file.with_name(state_file.name + "." + str(os.getpid()) + ".tmp")
    with temporary.open("x", encoding="utf-8") as output:
        json.dump(state, output, sort_keys=True)
    temporary.replace(state_file)
    return result
