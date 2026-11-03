"""Experimental JS/TS-only metadata listing; v1 body/batch contracts are inherited."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import subprocess

_SPEC = importlib.util.spec_from_file_location(
    '_serena_read_tools_v1', Path(__file__).with_name('serena-read-tools.py'))
_V1 = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(_V1)
SerenaReadTools = _V1.SerenaReadTools


class SerenaReadToolsV2(SerenaReadTools):
    def list_ids(self, relative_path: str) -> list[dict]:
        path = self._file(relative_path)
        if path.suffix.lower() not in {'.js', '.jsx', '.cjs', '.mjs', '.ts', '.tsx', '.cts', '.mts'}:
            raise ValueError('Metadata listing supports only experimental JS/TS files')
        name = path.relative_to(self.root).as_posix()
        identity = self._hash(path)
        symbols = self.api.get_symbols_overview(name).symbols
        parsed = subprocess.run(
            ['node', str(Path(__file__).with_name('serena-symbol-metadata.cjs')), str(path)],
            check=True, capture_output=True, text=True, encoding='utf-8', timeout=30,
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        data = json.loads(parsed.stdout)
        positions = {tuple(position) for position in data['callable_positions']}
        metadata = {(item['line'], item['column']): item for item in data['metadata']}
        pending = list(reversed(symbols))
        result = []
        while pending:
            symbol = pending.pop()
            position = (symbol.line, symbol.column)
            if symbol.symbol_kind_name in self._READING_KINDS or position in positions:
                identifier = symbol.get_name_path()
                item = metadata.get(position)
                if item is None or not item.get('signature'):
                    raise ValueError(f'Cannot map native symbol {identifier!r} to JS/TS declaration metadata')
                result.append({'id': identifier, **{key: item[key] for key in
                               ('start_line', 'end_line', 'signature', 'doc') if key in item}})
            pending.extend(reversed(list(symbol.iter_children())))
        ids = [item['id'] for item in result]
        if len(ids) != len(set(ids)):
            raise ValueError('Ambiguous symbol paths returned by provider')
        if self._hash(path) != identity:
            raise ValueError('File changed while listing ids; request list_ids again')
        self._listed[name] = identity
        return result
