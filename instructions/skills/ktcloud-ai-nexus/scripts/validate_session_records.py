"""Validate that canonical session records contain no ephemeral connection data."""

from __future__ import annotations

import re
import sys
import os
from pathlib import Path


FORBIDDEN_FILE_SUFFIXES = {".key", ".log", ".ps1"}
FORBIDDEN_TEXT_PATTERNS = {
    "proxy endpoint": re.compile(r"proxy\d+\.ainexus\.ktcloud\.com", re.IGNORECASE),
    "direct ssh key": re.compile(r"(?:ssh|scp)\s+[^\n]*\s-i\s+", re.IGNORECASE),
    "fixed container key path": re.compile(r"(?:id_container|id_[0-9a-f]{32})", re.IGNORECASE),
    "stored host field": re.compile(r"^\s*(?:[-*]\s*)?(?:\|\s*)?(?:SSH\s+)?(?:호스트|HostName)\s*(?:\||:|=)", re.MULTILINE | re.IGNORECASE),
    "stored port field": re.compile(r"^\s*(?:[-*]\s*)?(?:\|\s*)?(?:SSH\s+)?(?:포트|Port)\s*(?:\||:|=)", re.MULTILINE | re.IGNORECASE),
    "legacy sensitive command": re.compile(r"admin\s+keypair\s+info", re.IGNORECASE),
}


def validate(root: Path) -> list[str]:
    violations: list[str] = []
    if not root.is_dir():
        return [f"session record root does not exist: {root}"]
    for path in root.rglob("*"):
        if path.is_symlink() or not path.is_file():
            continue
        relative = path.relative_to(root)
        if path.suffix.casefold() in FORBIDDEN_FILE_SUFFIXES:
            violations.append(f"forbidden session attachment: {relative}")
            continue
        if path.suffix.casefold() != ".md":
            continue
        text = path.read_text(encoding="utf-8")
        for label, pattern in FORBIDDEN_TEXT_PATTERNS.items():
            if pattern.search(text):
                violations.append(f"{relative}: {label}")
    return violations


def resolve_state_root() -> Path:
    if "AZRAEL_KTCLOUD_STATE_ROOT" in os.environ:
        chosen = Path(os.environ["AZRAEL_KTCLOUD_STATE_ROOT"])
        if not os.environ["AZRAEL_KTCLOUD_STATE_ROOT"] or not chosen.is_absolute() or not chosen.is_dir():
            raise ValueError("AZRAEL_KTCLOUD_STATE_ROOT must name an available absolute directory; no fallback is used.")
        return chosen.resolve()
    skill_root = Path(__file__).resolve().parent.parent
    instructions = skill_root.parent.parent
    if skill_root.parent.name == "skills" and instructions.name == "instructions" and (instructions / "azrael-environment.json").is_file():
        return instructions / ".private" / "ktcloud-ai-nexus" / "state"
    azrael_home = Path(os.environ.get("CODEX_HOME") or Path.home() / ".azrael-ex")
    if not azrael_home.is_absolute():
        raise ValueError("CODEX_HOME must be absolute.")
    return azrael_home / "azrael" / "skills" / "ktcloud-ai-nexus" / "state"


def main() -> int:
    try:
        root = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else resolve_state_root() / "sessions"
    except ValueError as error:
        print(str(error), file=sys.stderr)
        return 1
    violations = validate(root)
    if violations:
        for violation in violations:
            print(violation, file=sys.stderr)
        return 1
    print("Session records contain no persisted ephemeral connection data.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
