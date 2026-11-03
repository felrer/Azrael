"""Experimental JS/TS symbol search; only matched v2 metadata is returned."""
from __future__ import annotations

import importlib.util
from pathlib import Path

_SPEC = importlib.util.spec_from_file_location(
    '_serena_read_tools_v2', Path(__file__).with_name('serena-read-tools-v2.py'))
_V2 = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(_V2)


class SerenaReadToolsV3(_V2.SerenaReadToolsV2):
    def find_symbols(self, relative_path: str, query: str) -> list[dict]:
        """Match every whitespace-separated term in ID, signature or doc prose.

        Terms use Unicode casefold and literal substring matching, not regex.
        Body reading and all source/path protections are inherited unchanged.
        """
        if not isinstance(query, str) or not query.strip():
            raise ValueError('Provide a nonempty symbol search query')
        terms = query.casefold().split()
        try:
            candidates = super().list_ids(relative_path)
        except ValueError as exc:
            raise ValueError(str(exc).replace('list_ids', 'find_symbols')) from exc
        return [item for item in candidates
                if all(any(term in item.get(field, '').casefold()
                           for field in ('id', 'signature', 'doc')) for term in terms)]

    def read_symbols(self, selections: list[dict]) -> dict:
        result = super().read_symbols(selections)
        for item in result['errors']:
            item['error'] = item['error'].replace('list_ids', 'find_symbols')
        return result
