"""Experimental read-only Serena 2.1 adapter; not connected to Azrael's tool catalog.

The overview adds source-derived metadata; read_symbols resolves explicit selections
and returns complete Serena bodies, never generated summaries in place of source.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import subprocess
from typing import Any


class SerenaReadTools:
    def __init__(self, api: Any, project_root: str | Path, metadata_script: str | Path,
                 typescript_module: str | Path, node: str = "node"):
        self.api = api
        self.root = Path(project_root).resolve()
        self.metadata_script = str(Path(metadata_script).resolve())
        self.typescript_module = str(Path(typescript_module).resolve())
        self.node = node
        self._overview_cache: dict[tuple[str, str, int], dict] = {}
        self._symbols: dict[str, dict] = {}
        self._bodies: dict[tuple[str, str], dict] = {}

    def _file(self, relative_path: str) -> Path:
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

    @staticmethod
    def _range(symbol: Any) -> dict:
        start = symbol.get_body_start_position()
        end = symbol.get_body_end_position()
        if start is None or end is None:
            raise ValueError("Symbol has no source range")
        return {"start": {"line": start.line, "character": start.col},
                "end": {"line": end.line, "character": end.col}}

    def _remember(self, symbol: Any, relative_path: str, identity: str) -> dict:
        source_range = self._range(symbol)
        payload = {"relative_path": relative_path, "source_sha256": identity,
                   "name_path": symbol.get_name_path(), "kind": symbol.symbol_kind_name,
                   "range": source_range}
        stable_id = "s:" + hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()[:16]
        self._symbols[stable_id] = {**payload, "symbol": symbol}
        return {"id": stable_id, **payload}

    @staticmethod
    def _flatten(symbols: list, depth: int):
        for symbol in symbols:
            yield symbol
            if depth > 0:
                yield from SerenaReadTools._flatten(list(symbol.iter_children()), depth - 1)

    def overview(self, relative_path: str, depth: int = 0) -> dict:
        if not isinstance(depth, int) or isinstance(depth, bool) or depth < 0:
            raise ValueError("depth must be a non-negative integer")
        path = self._file(relative_path)
        relative_path = path.relative_to(self.root).as_posix()
        before = self._hash(path)
        cache_key = (relative_path, before, depth)
        if cache_key in self._overview_cache:
            return self._overview_cache[cache_key]
        collection = self.api.get_symbols_overview(relative_path, depth=depth)
        source = path.read_text(encoding="utf-8-sig")
        symbols = list(self._flatten(collection.symbols, depth))
        entries = []
        metadata_input = []
        for symbol in symbols:
            try:
                entry = self._remember(symbol, relative_path, before)
            except ValueError:
                continue
            entries.append(entry)
            metadata_input.append({"name": symbol.name, "kind": symbol.symbol_kind_name,
                                   **entry["range"]})
        env = {**os.environ, "SERENA_TYPESCRIPT_MODULE": self.typescript_module}
        process = subprocess.run([self.node, self.metadata_script],
                                 input=json.dumps({"source": source, "fileName": relative_path,
                                                   "symbols": metadata_input}, ensure_ascii=False),
                                 text=True, encoding="utf-8", capture_output=True,
                                 env=env, timeout=30, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        if process.returncode:
            raise RuntimeError("Metadata parser failed: " + process.stderr[:1000])
        metadata = json.loads(process.stdout)
        if len(metadata) != len(entries):
            raise RuntimeError("Metadata count does not match source symbols")
        if self._hash(path) != before:
            raise ValueError("File changed while building overview; request again")
        for entry, details in zip(entries, metadata, strict=True):
            entry.update(details)
            # A file identity shared by the overview is sufficient for every row.
            entry.pop("relative_path")
            entry.pop("source_sha256")
            source_range = entry.pop("range")
            entry["lines"] = [source_range["start"]["line"] + 1, source_range["end"]["line"] + 1]
            if not entry.get("description"):
                entry.pop("description", None)
                entry.pop("description_source", None)
        detailed, others = [], []
        for entry in entries:
            is_callable = entry["kind"] in {"Function", "Method", "Constructor", "Class", "Interface", "Enum", "Struct"} or "=>" in entry.get("signature", "")
            if is_callable:
                detailed.append(entry)
            else:
                others.append({key: entry[key] for key in ("id", "name_path", "kind", "lines", "signature")})
        result = {"relative_path": relative_path, "source_sha256": before,
                  "line_encoding": "one-based inclusive; bodies remain unabridged",
                  "symbols": detailed, "other_symbols": others}
        self._overview_cache[cache_key] = result
        return result

    def read_symbols(self, selections: list[dict]) -> dict:
        if not isinstance(selections, list) or not selections:
            raise ValueError("Provide one or more explicit symbol selections")
        results, errors, duplicates = [], [], []
        seen: dict[str, int] = {}
        file_identities: dict[str, str] = {}
        for index, selection in enumerate(selections):
            try:
                if not isinstance(selection, dict):
                    raise ValueError("Each selection must be an object")
                if "id" in selection:
                    remembered = self._symbols.get(selection["id"])
                    if remembered is None:
                        raise ValueError("Unknown symbol id; obtain a current overview")
                    entry = {key: value for key, value in remembered.items() if key != "symbol"}
                    entry["id"] = selection["id"]
                    symbol = remembered["symbol"]
                    path = self._file(entry["relative_path"])
                    if self._hash(path) != entry["source_sha256"]:
                        raise ValueError("Stale symbol id: file changed since overview")
                else:
                    relative_path = selection["relative_path"]
                    path = self._file(relative_path)
                    relative_path = path.relative_to(self.root).as_posix()
                    identity = self._hash(path)
                    options = {"name_path_pattern": selection["name_path"],
                               "relative_path": relative_path, "include_body": True}
                    if "kind" in selection:
                        options["include_kinds"] = [selection["kind"]]
                    matches = self.api.find_symbol(**options).symbols
                    if len(matches) != 1:
                        raise ValueError(f"Expected one exact symbol, found {len(matches)}; use an overview id or disambiguated name")
                    symbol = matches[0]
                    entry = self._remember(symbol, relative_path, identity)
                stable_id = entry["id"]
                if stable_id in seen:
                    duplicates.append({"request_index": index, "duplicate_of": seen[stable_id], "id": stable_id})
                    continue
                current_identity = self._hash(path)
                if current_identity != entry["source_sha256"]:
                    raise ValueError("Source changed before symbol read")
                previous = file_identities.get(entry["relative_path"])
                if previous is not None and previous != current_identity:
                    raise ValueError("File changed between selections")
                body = symbol.body
                if body is None:
                    file_key = (entry["relative_path"], current_identity)
                    if file_key not in self._bodies:
                        # One native file lookup prepares all selected bodies, without
                        # exposing unselected source text to the model.
                        collection = self.api.find_symbol(name_path_pattern="", relative_path=entry["relative_path"],
                                                          substring_matching=True, include_body=True)
                        self._bodies[file_key] = {item.get_name_path(): item for item in collection.symbols}
                    prepared = self._bodies[file_key].get(entry["name_path"])
                    body = prepared.body if prepared is not None else None
                if body is None:
                    raise ValueError("Symbol has no readable source body")
                if self._hash(path) != current_identity:
                    raise ValueError("Source changed during symbol read")
                file_identities[entry["relative_path"]] = current_identity
                seen[stable_id] = index
                results.append({"request_index": index, **entry, "body": body})
            except Exception as exc:
                errors.append({"request_index": index, "error": str(exc)})
        # Detect a write after an earlier selection; do not mix versions in a batch.
        changed = {name for name, identity in file_identities.items()
                   if not (self.root / name).is_file() or self._hash(self.root / name) != identity}
        if changed:
            retained = []
            for item in results:
                if item["relative_path"] in changed:
                    errors.append({"request_index": item["request_index"], "error": "File changed during batch; result discarded"})
                else:
                    retained.append(item)
            results = retained
        return {"results": results, "errors": errors, "duplicates": duplicates,
                "files": {name: value for name, value in file_identities.items() if name not in changed}}
