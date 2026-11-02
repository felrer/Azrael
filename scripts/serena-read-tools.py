"""Minimal read-only Serena adapter; not registered in Azrael's tool catalog.

list_ids(file) returns native symbol paths only. read_symbols accepts those paths
directly and returns complete selected source bodies. File hashes stay internal.
"""
from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any


class SerenaReadTools:
    def __init__(self, api: Any, project_root: str | Path):
        self.api = api
        self.root = Path(project_root).resolve()
        if not self.root.is_dir():
            raise ValueError("An existing project directory is required")
        self._listed: dict[str, str] = {}

    def _file(self, relative_path: str) -> Path:
        if not isinstance(relative_path, str) or not relative_path:
            raise ValueError("A contained project-relative file path is required")
        requested = Path(relative_path)
        if requested.is_absolute() or ".." in requested.parts:
            raise ValueError("A contained project-relative file path is required")
        path = (self.root / requested).resolve()
        if not path.is_relative_to(self.root) or not path.is_file():
            raise ValueError("File is missing or outside project")
        return path

    @staticmethod
    def _hash(path: Path) -> str:
        return hashlib.sha256(path.read_bytes()).hexdigest()

    def list_ids(self, relative_path: str) -> list[str]:
        """List every native symbol path in one file, without descriptions or depth."""
        path = self._file(relative_path)
        name = path.relative_to(self.root).as_posix()
        identity = self._hash(path)
        symbols = self.api.get_symbols_overview(name).symbols
        pending = list(reversed(symbols))
        ids = []
        while pending:
            symbol = pending.pop()
            ids.append(symbol.get_name_path())
            pending.extend(reversed(list(symbol.iter_children())))
        if len(ids) != len(set(ids)):
            raise ValueError("Ambiguous symbol paths returned by provider")
        if self._hash(path) != identity:
            raise ValueError("File changed while listing ids; request list_ids again")
        self._listed[name] = identity
        return ids

    def read_symbols(self, selections: list[dict]) -> dict:
        """Read one or many {relative_path, id} selections, even without listing first."""
        if not isinstance(selections, list) or not selections:
            raise ValueError("Provide one or more explicit symbol selections")
        results, errors, duplicates = [], [], []
        seen: dict[tuple[str, str], int] = {}
        identities: dict[str, str] = {}
        for index, selection in enumerate(selections):
            try:
                if not isinstance(selection, dict) or set(selection) != {"relative_path", "id"}:
                    raise ValueError("Each selection requires only relative_path and id")
                identifier = selection["id"]
                if not isinstance(identifier, str) or not identifier or identifier.startswith("/"):
                    raise ValueError("id must be a nonempty native symbol path from list_ids")
                path = self._file(selection["relative_path"])
                name = path.relative_to(self.root).as_posix()
                identity = self._hash(path)
                if name in self._listed and self._listed[name] != identity:
                    raise ValueError("File changed since list_ids; request list_ids again")
                if name in identities and identities[name] != identity:
                    raise ValueError("File changed between selections")
                key = (name, identifier)
                if key in seen:
                    duplicates.append({"request_index": index, "duplicate_of": seen[key],
                                       "relative_path": name, "id": identifier})
                    continue
                # Serena's leading slash matches the entire path rather than a suffix.
                symbols = self.api.find_symbol(name_path_pattern="/" + identifier,
                                               relative_path=name, include_body=True).symbols
                matches = [symbol for symbol in symbols if symbol.get_name_path() == identifier]
                if len(matches) != 1:
                    raise ValueError(f"Expected one exact symbol, found {len(matches)}; use a listed id")
                body = matches[0].body
                if body is None:
                    raise ValueError("Symbol has no readable source body")
                if self._hash(path) != identity:
                    raise ValueError("Source changed during symbol read")
                identities[name] = identity
                seen[key] = index
                results.append({"request_index": index, "relative_path": name,
                                "id": identifier, "body": body})
            except Exception as exc:
                errors.append({"request_index": index, "error": str(exc)})
        changed = set()
        for name, identity in identities.items():
            try:
                if self._hash(self._file(name)) != identity:
                    changed.add(name)
            except (OSError, ValueError):
                changed.add(name)
        if changed:
            for items in (results, duplicates):
                discarded = [item for item in items if item["relative_path"] in changed]
                errors.extend({"request_index": item["request_index"],
                               "error": "File changed during batch; result discarded"} for item in discarded)
                items[:] = [item for item in items if item["relative_path"] not in changed]
        errors.sort(key=lambda item: item["request_index"])
        return {"results": results, "errors": errors, "duplicates": duplicates}
