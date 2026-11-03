"""Experimental name-only search with ranges and opt-in compact signatures."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import subprocess

_SPEC = importlib.util.spec_from_file_location(
    '_serena_name_boundary_v5', Path(__file__).with_name('serena-name-search-v4.py'))
_V4 = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(_V4)


class SerenaNameSearchV5(_V4.SerenaNameSearchV4):
    def find_names(self, relative_path: str, query: str, *,
                   include_signature: bool = False) -> list[list[str | int]]:
        """Return [native_id,start,end], appending a callable signature if requested.

        Search remains casefold literal substring of leaf names only. Optional
        signatures omit declaration names/keywords, preserve explicit types and
        defaults, and never infer return types. Data/class rows stay three fields.
        """
        if not isinstance(query, str) or not query.strip():
            raise ValueError('Provide a nonempty declaration-name search query')
        if not isinstance(include_signature, bool):
            raise ValueError('include_signature must be a boolean')
        path = self._boundary._file(relative_path)
        if path.suffix.lower() not in {'.js', '.jsx', '.cjs', '.mjs', '.ts', '.tsx', '.cts', '.mts'}:
            raise ValueError('Name search supports JS/TS source files only')
        identity = self._boundary._hash(path)
        parsed = subprocess.run(
            ['node', str(Path(__file__).with_name('serena-name-metadata-v5.cjs')), str(path)],
            check=True, capture_output=True, text=True, encoding='utf-8', timeout=30,
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        catalog = {(item['line'], item['column']): item for item in json.loads(parsed.stdout)}
        name = path.relative_to(self._boundary.root).as_posix()
        pending = list(reversed(self._api.get_symbols_overview(name).symbols))
        needle = query.strip().casefold()
        result, seen = [], set()
        while pending:
            symbol = pending.pop()
            item = catalog.get((symbol.line, symbol.column))
            if item is not None and needle in item['name'].casefold():
                identifier = symbol.get_name_path()
                if identifier in seen:
                    raise ValueError('Ambiguous symbol paths returned by provider')
                seen.add(identifier)
                row = [identifier, item['start_line'], item['end_line']]
                if include_signature and 'signature' in item:
                    row.append(item['signature'])
                result.append(row)
            pending.extend(reversed(list(symbol.iter_children())))
        if self._boundary._hash(path) != identity:
            raise ValueError('File changed during name search; request find_names again')
        return result
