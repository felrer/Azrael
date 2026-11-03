"""Experimental JS/TS declaration-name search; no listing or body-read API."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import subprocess

_SPEC = importlib.util.spec_from_file_location(
    '_serena_file_boundary_v4', Path(__file__).with_name('serena-read-tools.py'))
_BOUNDARY = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(_BOUNDARY)


class SerenaNameSearchV4:
    def __init__(self, api, project_root: str | Path):
        self._boundary = _BOUNDARY.SerenaReadTools(api, project_root)
        self._api = api

    def find_names(self, relative_path: str, query: str) -> list[str]:
        """Search declaration leaf names by case-insensitive literal substring.

        Returns native scoped IDs only. Parameters, data members, ordinary local
        variables, generated callback names and type-only declarations are excluded.
        """
        if not isinstance(query, str) or not query.strip():
            raise ValueError('Provide a nonempty declaration-name search query')
        path = self._boundary._file(relative_path)
        if path.suffix.lower() not in {'.js', '.jsx', '.cjs', '.mjs', '.ts', '.tsx', '.cts', '.mts'}:
            raise ValueError('Name search supports JS/TS source files only')
        identity = self._boundary._hash(path)
        parsed = subprocess.run(
            ['node', str(Path(__file__).with_name('serena-name-positions-v4.cjs')), str(path)],
            check=True, capture_output=True, text=True, encoding='utf-8', timeout=30,
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        names = {(item['line'], item['column']): item['name']
                 for item in json.loads(parsed.stdout)}
        name = path.relative_to(self._boundary.root).as_posix()
        pending = list(reversed(self._api.get_symbols_overview(name).symbols))
        needle = query.strip().casefold()
        result = []
        while pending:
            symbol = pending.pop()
            leaf = names.get((symbol.line, symbol.column))
            if leaf is not None and needle in leaf.casefold():
                result.append(symbol.get_name_path())
            pending.extend(reversed(list(symbol.iter_children())))
        if len(result) != len(set(result)):
            raise ValueError('Ambiguous symbol paths returned by provider')
        if self._boundary._hash(path) != identity:
            raise ValueError('File changed during name search; request find_names again')
        return result
