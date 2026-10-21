#!/usr/bin/env python3
"""Cross-platform shell launcher for `just` recipes.

This keeps recipe bodies as normal shell snippets while giving the justfile one
portable placeholder, `{args}`, for forwarding variadic recipe arguments.
"""

from __future__ import annotations

import fnmatch
import json
import os
import shutil
import subprocess
import sys


ARGS_TOKEN = "{args}"
TEST_TARGETS_TOKEN = "{test-targets}"
STDERR_NULL_TOKEN = "{stderr-null}"
POWERSHELL_ARGS = "@($args | Select-Object -Skip 1)"
POWERSHELL_STDERR_NULL = "2>$null; exit $LASTEXITCODE"
SH_ARGS = '"$@"'
SH_STDERR_NULL = "2>/dev/null"


def test_target_flags(recipe_args: list[str]) -> str:
    """Keep explicit target selectors narrow; otherwise retain full regression."""
    selectors = {
        "--lib", "--bin", "--bins", "--test", "--tests", "--example",
        "--examples", "--bench", "--benches", "--all-targets",
    }
    target_options = set()
    for argument in recipe_args:
        if argument == "--":
            break
        option = argument.split("=", 1)[0]
        if option in selectors:
            target_options.add(option)
    if target_options and not target_options & {"--test", "--tests", "--all-targets"}:
        return ""
    metadata = json.loads(subprocess.check_output(
        ["cargo", "metadata", "--no-deps", "--format-version", "1"], text=True,
    ))
    specs, excludes = [], []
    workspace = False
    args = iter(recipe_args)
    for argument in args:
        if argument == "--":
            break
        if argument in {"-p", "--package"}:
            specs.append(next(args, ""))
        elif argument.startswith("--package="):
            specs.append(argument.split("=", 1)[1])
        elif argument.startswith("-p") and len(argument) > 2:
            specs.append(argument[2:])
        elif argument in {"--workspace", "--all"}:
            workspace = True
        elif argument == "--exclude":
            excludes.append(next(args, ""))
        elif argument.startswith("--exclude="):
            excludes.append(argument.split("=", 1)[1])
    packages = [p for p in metadata["packages"] if p["id"] in metadata["workspace_members"]]
    selected = set(metadata["workspace_members"] if workspace else metadata["workspace_default_members"])
    if specs:
        selected = set()
        for spec in specs:
            if any(c in spec for c in "*?["):
                selected.update(p["id"] for p in packages if fnmatch.fnmatchcase(p["name"], spec))
            else:
                selected.add(subprocess.check_output(
                    ["cargo", "pkgid", "--package", spec], text=True,
                ).strip())
    features = [p["name"] + "/integration-tests" for p in packages
                if p["id"] in selected and p["name"] in {"codex-core", "codex-app-server"}
                and not any(fnmatch.fnmatchcase(p["name"], pattern) for pattern in excludes)]
    flags = [] if target_options else ["--tests", "--bins"]
    if features:
        flags.extend(["--features", ",".join(features)])
    return " ".join(flags)


def main() -> int:
    if len(sys.argv) < 2:
        print("just shell adapter expected a recipe command.", file=sys.stderr)
        return 1

    command = sys.argv[1]
    recipe_name = sys.argv[2] if len(sys.argv) > 2 else ""
    recipe_args = sys.argv[3:]

    try:
        if os.name == "nt":
            return run_powershell(command, recipe_name, recipe_args)
        else:
            return run_sh(command, recipe_name, recipe_args)
    except subprocess.CalledProcessError as error:
        return error.returncode


def run_sh(command: str, recipe_name: str, recipe_args: list[str]) -> int:
    if TEST_TARGETS_TOKEN in command:
        command = command.replace(TEST_TARGETS_TOKEN, test_target_flags(recipe_args))
    command = command.replace(ARGS_TOKEN, SH_ARGS)
    command = command.replace(STDERR_NULL_TOKEN, SH_STDERR_NULL)
    os.execvp("sh", ["sh", "-cu", command, recipe_name, *recipe_args])


def run_powershell(command: str, recipe_name: str, recipe_args: list[str]) -> int:
    if TEST_TARGETS_TOKEN in command:
        command = command.replace(TEST_TARGETS_TOKEN, test_target_flags(recipe_args))
    pwsh = shutil.which("pwsh.exe") or shutil.which("pwsh")
    if pwsh is None:
        print(
            "PowerShell ('pwsh') is required for Windows just recipes. "
            "Run 'just install' to install it.",
            file=sys.stderr,
        )
        return 1

    command = command.replace(ARGS_TOKEN, POWERSHELL_ARGS)
    command = command.replace(STDERR_NULL_TOKEN, POWERSHELL_STDERR_NULL)
    return subprocess.run(
        [
            pwsh,
            "-NoLogo",
            "-NoProfile",
            "-CommandWithArgs",
            command,
            recipe_name,
            *recipe_args,
        ],
        check=False,
    ).returncode


if __name__ == "__main__":
    raise SystemExit(main())
