"""Parse Cargo TOML with Python 3.11+; unknown external inputs disable reuse."""
import sys

if sys.version_info < (3, 11):
    raise SystemExit("Cargo config evidence requires Python 3.11 or newer")

import hashlib
import json
import pathlib
import re
import tomllib


def scalar(value):
    return type(value) in (bool, int) or (
        isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9_.+-]*", value)
    )


def target(value):
    return isinstance(value, str) and re.fullmatch(
        r"[A-Za-z0-9_]+(?:-[A-Za-z0-9_.]+)+", value
    ) and not value.lower().endswith(".json")


def flags(value):
    # Linker options are deliberately enumerated, never a general slash/path allowance.
    if not isinstance(value, list) or any(not isinstance(v, str) for v in value):
        return False
    index = 0
    while index < len(value):
        option = value[index]
        index += 1
        if option == "-C":
            if index == len(value):
                return False
            option = value[index]
            index += 1
        elif option.startswith("-C"):
            option = option[2:]
        else:
            return False
        if option in ("target-feature=+crt-static", "link-arg=/arm64hazardfree"):
            continue
        if not re.fullmatch(r"link-arg=(?:/STACK:[1-9][0-9]*|-Wl,--stack,[1-9][0-9]*)", option):
            return False
    return True


def validate(config):
    settings = {
        "build": {"jobs", "target", "incremental"},
        "term": {"verbose", "quiet", "color"},
        "net": {"offline", "git-fetch-with-cli", "retry"},
        "http": {"timeout", "multiplexing", "check-revoke", "low-speed-limit"},
    }
    profile_keys = {"opt-level", "debug", "strip", "debug-assertions", "overflow-checks",
                    "lto", "panic", "incremental", "codegen-units", "rpath", "inherits"}
    for section, values in config.items():
        if not isinstance(values, dict):
            return False
        if section == "target":
            for name, options in values.items():
                if not (target(name) or re.fullmatch(r'cfg\([A-Za-z0-9_ ,="\x27().+-]+\)', name)):
                    return False
                if not isinstance(options, dict) or any(key != "rustflags" or not flags(v) for key, v in options.items()):
                    return False
        elif section == "env":
            for name, options in values.items():
                if name != "MALLOC_CONF" or not isinstance(options, dict):
                    return False
                if set(options) - {"value", "force", "relative"} or options.get("value") != "thp:always":
                    return False
                if "force" in options and type(options["force"]) is not bool:
                    return False
                if "relative" in options and (type(options["relative"]) is not bool or options["relative"]):
                    return False
        elif section == "profile":
            for name, options in values.items():
                if not re.fullmatch(r"[A-Za-z0-9_-]+", name) or not isinstance(options, dict):
                    return False
                if any(key not in profile_keys or not scalar(v) for key, v in options.items()):
                    return False
        elif section in settings:
            for key, value in values.items():
                if section == "build" and key == "rustflags":
                    if not flags(value):
                        return False
                elif section == "term" and key == "progress":
                    if not isinstance(value, dict) or any(k not in {"when", "width"} or not scalar(v) for k, v in value.items()):
                        return False
                elif key not in settings[section] or not scalar(value):
                    return False
                elif section == "build" and key == "target" and not target(value):
                    return False
        else:
            return False
    return True


if sys.argv[1:] == ["--identity"]:
    # Isolated mode prevents PYTHONPATH/site customizations; bind stdlib parser bytes too.
    directory = pathlib.Path(tomllib.__file__).parent
    print(json.dumps({"version": sys.version, "executable": sys.executable,
                      "tomllib": {str(p): hashlib.sha256(p.read_bytes()).hexdigest()
                                  for p in sorted(directory.glob("*.py"))}}))
else:
    try:
        config = tomllib.loads(sys.stdin.buffer.read().decode("utf-8"))
        if not validate(config):
            raise ValueError("unresolved external inputs or unsupported syntax")
    except (ValueError, UnicodeError) as error:
        raise SystemExit(f"Cargo config has unresolved external inputs or unsupported syntax: {error}")
    print("self-contained")
