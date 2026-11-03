"""Experimental JS/TS search returning compact rows and optional signatures."""
from __future__ import annotations

import importlib.util
from pathlib import Path

_SPEC = importlib.util.spec_from_file_location(
    '_serena_read_tools_v2', Path(__file__).with_name('serena-read-tools-v2.py'))
_V2 = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(_V2)


class SerenaReadToolsV3(_V2.SerenaReadToolsV2):
    def find_symbols(self, relative_path: str, query: str, *,
                     include_signature: bool = False) -> list[list[str | int]]:
        """Return [id, start_line, end_line], optionally followed by signature.

        Search every whitespace-separated term in ID, full signature or doc
        prose regardless of include_signature. Terms use Unicode casefold and
        literal substring matching, not regex. Documentation is searched only.
        Body reading and all source/path protections are inherited unchanged.
        """
        if not isinstance(query, str) or not query.strip():
            raise ValueError('Provide a nonempty symbol search query')
        if not isinstance(include_signature, bool):
            raise ValueError('include_signature must be a boolean')
        terms = query.casefold().split()
        try:
            candidates = super().list_ids(relative_path)
        except ValueError as exc:
            raise ValueError(str(exc).replace('list_ids', 'find_symbols')) from exc
        result = []
        for item in candidates:
            if all(any(term in item.get(field, '').casefold()
                       for field in ('id', 'signature', 'doc')) for term in terms):
                row = [item['id'], item['start_line'], item['end_line']]
                if include_signature:
                    row.append(item['signature'])
                result.append(row)
        return result

    def read_symbols(self, selections: list[dict]) -> dict:
        result = super().read_symbols(selections)
        for item in result['errors']:
            item['error'] = item['error'].replace('list_ids', 'find_symbols')
        return result
