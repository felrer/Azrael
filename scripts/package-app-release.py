#!/usr/bin/env python3
"""Package verified existing Windows binaries; never build or install anything."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import sys
import zipfile


def digest(data):
    return hashlib.sha256(data).hexdigest()


def encoded(value):
    return (json.dumps(value, indent=2, ensure_ascii=False) + "\n").encode("utf-8")


def load(file):
    return json.loads(file.read_text(encoding="utf-8-sig"))


def relative(name):
    if not isinstance(name, str) or "\\" in name or ":" in name:
        raise ValueError(f"Invalid relative path: {name!r}")
    parts = PurePosixPath(name)
    if not name or parts.is_absolute() or any(p in (".", "..") for p in name.split("/")):
        raise ValueError(f"Unsafe relative path: {name!r}")
    return parts


def safe_file(root, name):
    parts = relative(name)
    candidate = root.joinpath(*parts.parts)
    for path in (candidate, *candidate.parents):
        if path.is_symlink() or (path.exists() and getattr(path.stat(), "st_file_attributes", 0) & 0x400):
            raise ValueError(f"Reparse point forbidden: {path}")
    candidate.resolve().relative_to(root.resolve())
    if not candidate.is_file():
        raise ValueError(f"Missing file: {candidate}")
    return candidate


def verified(root, name, expected):
    file = safe_file(root, name)
    if not isinstance(expected, str) or not re.fullmatch(r"[a-fA-F0-9]{64}", expected):
        raise ValueError(f"Invalid hash: {name}")
    if digest(file.read_bytes()) != expected.lower():
        raise ValueError(f"Hash mismatch: {file}")
    return file


def read_zip(source):
    files = {}
    seen = set()
    with zipfile.ZipFile(source) as archive:
        for info in archive.infolist():
            relative(info.filename.rstrip("/") if info.is_dir() else info.filename)
            if info.is_dir():
                continue
            if stat.S_ISLNK(info.external_attr >> 16) or info.filename.casefold() in seen:
                raise ValueError(f"Unsafe or duplicate ZIP entry: {info.filename}")
            seen.add(info.filename.casefold())
            files[info.filename] = archive.read(info)
    return files


def zip_bytes(files):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for name, data in sorted(files.items()):
            archive.writestr(name, data)
    return stream.getvalue()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release-directory", required=True, type=Path)
    parser.add_argument("--host-vsix", required=True, type=Path)
    parser.add_argument("--version", required=True)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--project-root", type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument("--license-directory", type=Path, help="Additional verified license/NOTICE evidence supplied by the release owner")
    args = parser.parse_args()
    if not re.fullmatch(r"(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)", args.version) or any(int(component) > 9007199254740991 for component in args.version.split(".")):
        raise ValueError("Invalid release version")
    root, release, output = args.project_root.absolute(), args.release_directory.absolute(), args.output.absolute()
    if output.exists() and (not output.is_dir() or any(output.iterdir())):
        raise ValueError("Output must be absent or an empty directory")
    for path in (output, *output.parents):
        if path.is_symlink() or getattr(path.stat() if path.exists() else None, "st_file_attributes", 0) & 0x400:
            raise ValueError("Output cannot contain a reparse point")
    build_bytes = safe_file(release, "build-info.json").read_bytes()
    build = json.loads(build_bytes)
    for name, expected in build["sha256"].items():
        verified(release, name, expected)
    source = build["engineProvenance"]["source"]
    fingerprint = source["sourceSha256"]
    if not re.fullmatch(r"[a-fA-F0-9]{64}", fingerprint):
        raise ValueError("Missing engine source fingerprint")
    for name, expected in build["engineProvenance"]["binaries"].items():
        verified(release, "engine/" + name, expected)
    for name in ("codex.exe", "azrael-bridge.exe", "codex-code-mode-host.exe"):
        if name not in build["engineProvenance"]["binaries"]:
            raise ValueError(f"Missing engine provenance: {name}")
    files = {}
    for owner in ("engine", "providers", "computer-use", "window-control", "host"):
        directory = release / owner
        if not directory.is_dir():
            raise ValueError(f"Missing runtime owner: {owner}")
        for current, dirs, names in os.walk(directory, followlinks=False):
            for entry in dirs + names:
                candidate = Path(current) / entry
                if candidate.is_symlink() or getattr(candidate.stat(), "st_file_attributes", 0) & 0x400:
                    raise ValueError(f"Reparse point forbidden: {candidate}")
            for name in names:
                path = Path(current) / name
                rel = path.relative_to(release).as_posix()
                if any(part in (".git", ".cache", "auth.json", "settings.json") for part in path.relative_to(directory).parts):
                    raise ValueError(f"Unexpected state/cache in runtime: {rel}")
                files["runtime/" + rel] = safe_file(release, rel).read_bytes()
    files["runtime/build-info.json"] = build_bytes
    for name in ("devin-native-build.json", "opencodex-accounts-build.json"):
        files["runtime/" + name] = safe_file(release, name).read_bytes()
    devin = json.loads(files["runtime/devin-native-build.json"])
    accounts = json.loads(files["runtime/opencodex-accounts-build.json"])
    allowed_scripts = {"scripts/devin-catalog.json", "scripts/prepare-devin.ps1", "scripts/start-devin-native.ps1"}
    for manifest in (devin, accounts):
        for name, expected in manifest["files"].items():
            file = verified(release, name, expected)
            packaged = "runtime/" + name
            if packaged not in files:
                if name not in allowed_scripts:
                    raise ValueError(f"Unapproved runtime dependency: {name}")
                files[packaged] = file.read_bytes()
    for owner in ("computer-use", "window-control"):
        manifest = json.loads(files[f"runtime/{owner}/manifest.json"])
        for item in manifest["files"]:
            verified(release, owner + "/" + item["path"], item["sha256"])
    node = Path(devin["node"]["path"])
    if not node.is_absolute():
        raise ValueError("External Node path must be absolute")
    node = safe_file(node.parent, node.name)
    files["runtime/node/node.exe"] = node.read_bytes()
    if digest(files["runtime/node/node.exe"]) != devin["node"]["sha256"].lower():
        raise ValueError("External Node hash mismatch")
    # Bind the actual copied snapshot, rather than a previous read of its sources,
    # to every declared inventory before the one intentional manifest rewrite.
    expectations = []
    for name, expected in build["sha256"].items():
        if "runtime/" + name in files:
            expectations.append(("runtime/" + name, expected))
    for name, expected in build["engineProvenance"]["binaries"].items():
        expectations.append(("runtime/engine/" + name, expected))
    for manifest in (devin, accounts):
        for name, expected in manifest["files"].items():
            key = "runtime/" + name
            expectations.append((key, expected))
    for owner in ("computer-use", "window-control"):
        for item in json.loads(files[f"runtime/{owner}/manifest.json"])["files"]:
            expectations.append((f"runtime/{owner}/{item['path']}", item["sha256"]))
    expectations.append(("runtime/node/node.exe", devin["node"]["sha256"]))
    for name, expected in expectations:
        if name not in files or digest(files[name]) != expected.lower():
            raise ValueError(f"Copied runtime snapshot hash mismatch: {name}")
    devin["node"].update(path="node/node.exe", bundled=True)
    files["runtime/devin-native-build.json"] = encoded(devin)
    host_file = safe_file(args.host_vsix.absolute().parent, args.host_vsix.name)
    host_bytes = host_file.read_bytes()
    host = read_zip(io.BytesIO(host_bytes))
    package = json.loads(host["extension/package.json"])
    if package["version"] != args.version:
        raise ValueError("Supplied host version does not match release version")
    runtime_key = "extension/out/azrael-runtime.json"
    config = json.loads(host[runtime_key].decode("utf-8-sig"))
    if config.get("schema") != 1:
        raise ValueError("Unsupported host runtime schema")
    for key, name in (("engine", "codex.exe"), ("bridge", "azrael-bridge.exe")):
        source_file = Path(config[key])
        if digest(safe_file(source_file.parent, source_file.name).read_bytes()) != build["engineProvenance"]["binaries"][name].lower():
            raise ValueError(f"Host {key} does not match selected build")
    portable = {"schema": 1, "engine": "engine/codex.exe", "bridge": "engine/azrael-bridge.exe", "engineVersion": config["engineVersion"], "codexHome": "@STATE@"}
    for key in ("devinNative", "providerAccounts"):
        if key not in config:
            raise ValueError(f"Missing integrated host provider: {key}")
        portable[key] = {"releaseDirectory": "."}
    for key, owner in (("computerUse", "computer-use"), ("windowControl", "window-control")):
        expected = digest(files[f"runtime/{owner}/manifest.json"])
        if config.get(key, {}).get("manifestSha256", "").lower() != expected:
            raise ValueError(f"Host {key} manifest does not match selected build")
        portable[key] = {"directory": owner, "manifestSha256": expected}
    portable["windowControl"].update(executable="window-control/azrael-window-control.exe", mcpScript="window-control/window-control-mcp.cjs")
    host[runtime_key] = encoded(portable)
    files["host-template.vsix"] = zip_bytes(host)
    files["install.ps1"] = safe_file(root, "scripts/install-app-release.ps1").read_bytes()
    for name, target in (("LICENSE", "LICENSE"), ("engine/LICENSE", "licenses/engine-LICENSE"), ("engine/NOTICE", "licenses/engine-NOTICE")):
        files[target] = safe_file(root, name).read_bytes()
    for owner in ("devin", "opencodex"):
        safe_file(release, f"providers/{owner}/LICENSE.opencodex")
    files["licenses/host-LICENSE.md"] = host["extension/LICENSE.md"]
    node_license = node.parent / "LICENSE"
    gaps = ["Computer Use upstream redistribution terms are not recorded in this bundle.", "Bun redistribution notice completeness has not been established.", "Keyring redistribution notice completeness has not been established."]
    if node_license.is_file():
        files["licenses/node-LICENSE"] = safe_file(node.parent, "LICENSE").read_bytes()
    else:
        gaps.append("External Node installation has no adjacent LICENSE file; obtain its matching distribution notice before broader redistribution.")
    if args.license_directory:
        license_root = args.license_directory.absolute()
        for path in sorted(license_root.iterdir()):
            if not path.is_file():
                raise ValueError(f"License input must be a file: {path}")
            files["licenses/" + path.name] = safe_file(license_root, path.name).read_bytes()
        if any("node" in path.name.lower() and "license" in path.name.lower() for path in license_root.iterdir()):
            gaps = [gap for gap in gaps if not gap.startswith("External Node")]
        if any("bun" in path.name.lower() and "license" in path.name.lower() for path in license_root.iterdir()):
            gaps = [gap for gap in gaps if not gap.startswith("Bun")]
    provenance = {"sourceBuild": release.name, "engineSourceSha256": fingerprint, "engineSource": source, "engineIncludesLocalChanges": build.get("engineIncludesLocalChanges"), "originalHostSha256": digest(host_bytes), "licenseEvidenceGaps": gaps, "binaryHashes": build["engineProvenance"]["binaries"]}
    files["provenance.json"] = encoded(provenance)
    files["README.txt"] = (f"Azrael {args.version}, Windows x64\n\nExtract this ZIP and run:\n  powershell -ExecutionPolicy Bypass -File .\\install.ps1\nUse -PrepareOnly to prepare without installing.\n\nOptional per-user environment variables (read at installation):\n  AZRAEL_RELEASES_ROOT: absolute parent directory for versioned installations.\n  AZRAEL_STATE_ROOT: absolute directory for accounts, conversations and settings.\n  AZRAEL_CODE_PATH: VS Code CLI command or path (default: code).\n  AZRAEL_DEVIN_EXECUTABLE: optional absolute path to an existing Devin CLI.\nExample in PowerShell before running install.ps1:\n  $env:AZRAEL_RELEASES_ROOT = Join-Path $env:LOCALAPPDATA 'azrael-ex/releases'\n  $env:AZRAEL_STATE_ROOT = Join-Path $env:USERPROFILE '.azrael-ex'\n\nExplicit -ReleasesRoot, -StateRoot, -CodePath and -DevinExecutable override their environment variables.\n-InstallRoot selects an exact version directory and overrides -ReleasesRoot/AZRAEL_RELEASES_ROOT.\nWithout overrides, runtime uses LOCALAPPDATA/azrael-ex/releases/<version> and state uses USERPROFILE/.azrael-ex.\nResolved paths are saved in the installed configuration; changing variables later requires preparing a new installation.\nVS Code is required for installation; Python and external Node are not required.\nThe installer preserves existing state and does not reload or close windows.\nExisting destination directories are refused. Keep this release directory while the extension is installed.\n\nExisting local binaries are reused; source fingerprint and notices are in provenance.json and licenses/.\nUnresolved redistribution evidence:\n" + "\n".join(gaps) + "\n").encode()
    inventory = [{"path": name, "size": len(data), "sha256": digest(data)} for name, data in sorted(files.items())]
    files["package-manifest.json"] = encoded({"schemaVersion": 1, "product": "Azrael", "releaseVersion": args.version, "hostVersion": package["version"], "files": inventory})
    payload = zip_bytes(files)
    roundtrip = read_zip(io.BytesIO(payload))
    if set(roundtrip) != set(files):
        raise ValueError("ZIP inventory differs from package inventory")
    for item in inventory:
        data = roundtrip[item["path"]]
        if len(data) != item["size"] or digest(data) != item["sha256"]:
            raise ValueError(f"ZIP verification failed: {item['path']}")
    output.mkdir(parents=True, exist_ok=True)
    asset_name = f"Azrael-{args.version}-windows-x64.zip"
    asset = {"name": asset_name, "size": len(payload), "sha256": digest(payload)}
    manifest = {"schemaVersion": 1, "product": "Azrael", "releaseVersion": args.version, "hostVersion": package["version"], "sourceBuild": release.name, "engineSourceSha256": fingerprint, "assets": [asset], "provenance": provenance}
    (output / asset_name).write_bytes(payload)
    (output / "release-manifest.json").write_bytes(encoded(manifest))
    sums = f"{asset['sha256']}  {asset_name}\n{digest(encoded(manifest))}  release-manifest.json\n"
    (output / "SHA256SUMS.txt").write_text(sums, encoding="utf-8")
    print(json.dumps({"zip": str(output / asset_name), "manifest": str(output / "release-manifest.json"), "checksums": str(output / "SHA256SUMS.txt"), "sha256": asset["sha256"], "licenseEvidenceGaps": gaps}))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, OSError, zipfile.BadZipFile) as error:
        print(f"Packaging failed: {error}", file=sys.stderr)
        sys.exit(1)
