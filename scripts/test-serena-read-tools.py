"""Direct contracts for the experimental adapter; set SERENA_READ_TEST_ROOT to an owned run."""
import importlib.util
import os
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location('serena_read_tools', Path(__file__).with_name('serena-read-tools.py'))
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)

class Symbol:
    def __init__(self, name, body, line=0):
        self.name = name
        self.body = body
        self.symbol_kind_name = 'Function'
        self.line = line
    def get_name_path(self): return self.name
    def get_body_start_position(self): return SimpleNamespace(line=self.line, col=0)
    def get_body_end_position(self): return SimpleNamespace(line=self.line, col=len(self.body))

class BatchContracts(unittest.TestCase):
    def setUp(self):
        parent = os.environ.get('SERENA_READ_TEST_ROOT')
        if not parent: raise RuntimeError('SERENA_READ_TEST_ROOT must identify an owned temporary run')
        self.temp = tempfile.TemporaryDirectory(dir=parent)
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root/'a.js').write_text('function one() {}\nfunction two() {}\n', encoding='utf-8')
        (self.root/'b.js').write_text('function three() {}\n', encoding='utf-8')
        self.symbols = {'one': Symbol('one', 'function one() {}'),
                        'two': Symbol('two', 'function two() {}',1),
                        'three': Symbol('three', 'function three() {}')}
        def find(**args):
            if args['name_path_pattern']=='explode': raise RuntimeError('native lookup failed')
            if args['name_path_pattern']=='ambiguous': return SimpleNamespace(symbols=list(self.symbols.values()))
            return SimpleNamespace(symbols=[self.symbols[args['name_path_pattern']]] if args['name_path_pattern'] in self.symbols else [])
        self.adapter = MODULE.SerenaReadTools(SimpleNamespace(find_symbol=find),self.root,__file__,__file__)

    def test_multiple_files_exact_bodies_deduplicated_with_partial_errors(self):
        selections=[{'relative_path':'a.js','name_path':'one'},
                    {'relative_path':'b.js','name_path':'three'},
                    {'relative_path':'a.js','name_path':'one'},
                    {'relative_path':'a.js','name_path':'absent'},
                    {'relative_path':'a.js','name_path':'explode'}]
        result=self.adapter.read_symbols(selections)
        self.assertEqual([r['body'] for r in result['results']],['function one() {}','function three() {}'])
        self.assertEqual([e['request_index'] for e in result['errors']],[3,4])
        self.assertEqual(result['duplicates'][0]['duplicate_of'],0)
        self.assertEqual(len(result['files']),2)

    def test_stale_identity_and_ambiguous_names_are_not_guessed(self):
        before=self.adapter.read_symbols([{'relative_path':'a.js','name_path':'one'}])['results'][0]
        (self.root/'a.js').write_text('function changed() {}',encoding='utf-8')
        result=self.adapter.read_symbols([{'id':before['id']},{'relative_path':'b.js','name_path':'ambiguous'}])
        self.assertEqual(result['results'],[])
        self.assertIn('Stale',result['errors'][0]['error'])
        self.assertIn('found 3',result['errors'][1]['error'])

    def test_unknown_id_path_escape_and_empty_selection(self):
        result=self.adapter.read_symbols([{'id':'unknown'},{'relative_path':'../escape.js','name_path':'one'}])
        self.assertEqual(len(result['errors']),2)
        with self.assertRaises(ValueError): self.adapter.read_symbols([])

    def test_file_changed_mid_batch_discards_earlier_version(self):
        original=self.adapter.api.find_symbol
        def change(**args):
            if args['name_path_pattern']=='two':
                (self.root/'a.js').write_text('changed',encoding='utf-8')
            return original(**args)
        self.adapter.api.find_symbol=change
        result=self.adapter.read_symbols([{'relative_path':'a.js','name_path':'one'}, {'relative_path':'a.js','name_path':'two'}])
        self.assertEqual(result['results'],[])
        self.assertEqual({e['request_index'] for e in result['errors']},{0,1})

if __name__=='__main__': unittest.main()
