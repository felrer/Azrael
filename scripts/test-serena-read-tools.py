"""Public contracts for the minimal Serena reader; use an owned temporary run root."""
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
    """Only the provider's name, children, body and source-range surface."""
    def __init__(self, name_path, body, line=0, children=(), kind='Function'):
        self.name_path = name_path
        self.body = body
        self.line = line
        self.column = 0
        self.children = children
        self.symbol_kind_name = kind

    def get_name_path(self): return self.name_path
    def get_body_start_position(self): return SimpleNamespace(line=self.line, col=0)
    def get_body_end_position(self): return SimpleNamespace(line=self.line, col=len(self.body or ''))
    def iter_children(self): return iter(self.children)


class BatchContracts(unittest.TestCase):
    def setUp(self):
        parent = os.environ.get('SERENA_READ_TEST_ROOT')
        if not parent:
            raise RuntimeError('SERENA_READ_TEST_ROOT must identify an owned temporary run')
        self.temp = tempfile.TemporaryDirectory(dir=parent)
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'a.js').write_text('function one() {}\nfunction two() {}\n', encoding='utf-8')
        (self.root / 'b.js').write_text('function three() {}\n', encoding='utf-8')
        child = Symbol('Container/nested', 'nested() { return "nested"; }', 3, kind='Method')
        container = Symbol('Container', 'class Container { nested() { return "nested"; } }', 2, [child], kind='Class')
        self.symbols = {
            'a.js': [Symbol('one', 'function one() {}'), Symbol('two', 'function two() {}', 1), container, child],
            'b.js': [Symbol('three', 'function three() {}'), Symbol('one', 'function one() { return "b"; }', 1)],
        }

        def find(**args):
            pattern = args['name_path_pattern'].lstrip('/')
            if pattern == 'explode':
                raise RuntimeError('native lookup failed')
            if pattern == 'ambiguous':
                return SimpleNamespace(symbols=[Symbol('ambiguous', 'first'), Symbol('ambiguous', 'second')])
            if not pattern:
                raise ValueError('Serena name_path must not be empty')
            symbols = self.symbols[args['relative_path']]
            return SimpleNamespace(symbols=[s for s in symbols if s.get_name_path() == pattern])

        def overview(relative_path, **kwargs):
            return SimpleNamespace(symbols=[s for s in self.symbols[relative_path] if '/' not in s.get_name_path()])

        self.adapter = MODULE.SerenaReadTools(SimpleNamespace(find_symbol=find, get_symbols_overview=overview), self.root)

    @staticmethod
    def selection(relative_path, symbol_id):
        return {'relative_path': relative_path, 'id': symbol_id}

    def test_list_ids_contains_nested_callable_and_type_paths_only(self):
        ids = self.adapter.list_ids('a.js')
        self.assertIsInstance(ids, list)
        self.assertTrue(all(isinstance(value, str) for value in ids))
        self.assertCountEqual(ids, ['one', 'two', 'Container', 'Container/nested'])
        self.assertEqual(self.adapter.list_ids('b.js'), ['three', 'one'])

    def test_list_ids_filters_data_but_traverses_it_to_find_nested_callables(self):
        # A future change to unrestricted traversal must not reintroduce locals
        # or prune nested functions merely because their parent is filtered.
        kept = ['Function', 'Method', 'Constructor', 'Class', 'Interface', 'Struct', 'Enum']
        hidden = ['Variable', 'Constant', 'Property', 'Field', 'EnumMember', 'Module', 'Namespace']
        self.symbols['a.js'] = [Symbol(kind, kind, kind=kind) for kind in kept]
        self.symbols['a.js'] += [Symbol(kind, kind, kind=kind) for kind in hidden]
        parameter = Symbol('Function/input', 'input', kind='Variable')
        nested = Symbol('Function/input/nested', '() => 1', kind='Function')
        parameter.children = [nested]
        self.symbols['a.js'][0].children = [parameter]
        self.assertEqual(self.adapter.list_ids('a.js'), ['Function', 'Function/input/nested', *kept[1:]])
        self.symbols['b.js'] = [Symbol('data', '42', kind='Constant')]
        self.assertEqual(self.adapter.list_ids('b.js'), [])

    def test_js_callable_initializers_survive_data_kinds_without_text_false_positives(self):
        source = ('const text = "() => not a function";\n'
                  'const arrow = async (input) => input;\n'
                  'let expression = function named() { return 1; };\n'
                  'const object = { run: () => 2, data: "function() {}" };\n')
        (self.root / 'a.js').write_text(source, encoding='utf-8')
        self.symbols['a.js'] = [
            Symbol('text', 'text', 0, kind='Constant'),
            Symbol('arrow', 'arrow', 1, kind='Constant'),
            Symbol('expression', 'expression', 2, kind='Variable'),
            Symbol('object', 'object', 3, [Symbol('object/run', 'run', 3, kind='Property'),
                                          Symbol('object/data', 'data', 3, kind='Property')], kind='Constant'),
        ]
        self.symbols['a.js'][1].column = 6
        self.symbols['a.js'][2].column = 4
        self.symbols['a.js'][3].children[0].column = 17
        self.symbols['a.js'][3].children[1].column = 31
        self.assertEqual(self.adapter.list_ids('a.js'), ['arrow', 'expression', 'object/run'])

    def test_known_id_reads_single_complete_body_without_listing(self):
        body = 'function one(input) {\n  // preserve source, including whitespace\n  return input?.value?.trim();\n}\n'
        self.symbols['a.js'][0].body = body
        self.assertEqual(self.adapter.read_symbols([self.selection('a.js', 'one')]), {
            'results': [{'request_index': 0, 'relative_path': 'a.js', 'id': 'one', 'body': body}],
            'errors': [], 'duplicates': [],
        })

    def test_multiple_files_exact_bodies_deduplicated_with_partial_errors(self):
        selections = [self.selection('a.js', 'one'), self.selection('b.js', 'three'),
                      self.selection('a.js', 'one'), self.selection('a.js', 'absent'),
                      self.selection('a.js', 'explode'), self.selection('b.js', 'one')]
        result = self.adapter.read_symbols(selections)
        self.assertEqual(result['results'], [
            {'request_index': 0, 'relative_path': 'a.js', 'id': 'one', 'body': 'function one() {}'},
            {'request_index': 1, 'relative_path': 'b.js', 'id': 'three', 'body': 'function three() {}'},
            {'request_index': 5, 'relative_path': 'b.js', 'id': 'one', 'body': 'function one() { return "b"; }'},
        ])
        self.assertEqual([e['request_index'] for e in result['errors']], [3, 4])
        self.assertTrue(all(e['error'] for e in result['errors']))
        self.assertEqual(result['duplicates'], [
            {'request_index': 2, 'duplicate_of': 0, 'id': 'one', 'relative_path': 'a.js'}])
        self.assertEqual(set(result), {'results', 'errors', 'duplicates'})

    def test_listed_nested_id_reads_the_complete_body(self):
        self.assertIn('Container/nested', self.adapter.list_ids('a.js'))
        result = self.adapter.read_symbols([self.selection('a.js', 'Container/nested')])
        self.assertEqual(result['errors'], [])
        self.assertEqual(result['results'][0]['body'], 'nested() { return "nested"; }')
        self.assertEqual(result['results'][0]['id'], 'Container/nested')

    def test_changed_file_requires_relisting_and_then_reads_current_body(self):
        self.adapter.list_ids('a.js')
        (self.root / 'a.js').write_text('function one() { return "changed"; }', encoding='utf-8')
        self.symbols['a.js'][0].body = 'function one() { return "changed"; }'
        result = self.adapter.read_symbols([self.selection('a.js', 'one')])
        self.assertEqual(result['results'], [])
        self.assertEqual([e['request_index'] for e in result['errors']], [0])
        self.assertRegex(result['errors'][0]['error'].lower(), r'list|stale|changed')
        self.assertIn('one', self.adapter.list_ids('a.js'))
        current = self.adapter.read_symbols([self.selection('a.js', 'one')])
        self.assertEqual(current['errors'], [])
        self.assertEqual(current['results'][0]['body'], 'function one() { return "changed"; }')

    def test_ambiguous_names_missing_ids_and_path_escape_are_errors(self):
        result = self.adapter.read_symbols([
            self.selection('a.js', 'ambiguous'), self.selection('a.js', 'absent'),
            self.selection('../escape.js', 'one'), self.selection(str(self.root / 'a.js'), 'one'),
        ])
        self.assertEqual(result['results'], [])
        self.assertEqual(result['duplicates'], [])
        self.assertEqual([e['request_index'] for e in result['errors']], [0, 1, 2, 3])
        self.assertRegex(result['errors'][0]['error'].lower(), r'ambigu|exact|found|match')
        self.assertTrue(all(e['error'] for e in result['errors']))
        with self.assertRaises(ValueError):
            self.adapter.list_ids('../escape.js')
        with self.assertRaises(ValueError):
            self.adapter.read_symbols([])

    def test_file_changed_mid_batch_discards_earlier_results_for_that_file(self):
        original = self.adapter.api.find_symbol

        def change(**args):
            if args['relative_path'] == 'a.js' and args['name_path_pattern'].lstrip('/') == 'two':
                (self.root / 'a.js').write_text('changed', encoding='utf-8')
            return original(**args)

        self.adapter.api.find_symbol = change
        result = self.adapter.read_symbols([
            self.selection('a.js', 'one'), self.selection('b.js', 'three'),
            self.selection('a.js', 'one'), self.selection('a.js', 'two'),
        ])
        self.assertEqual(result['results'], [
            {'request_index': 1, 'relative_path': 'b.js', 'id': 'three', 'body': 'function three() {}'}])
        self.assertEqual({e['request_index'] for e in result['errors']}, {0, 2, 3})
        self.assertEqual(result['duplicates'], [])


if __name__ == '__main__':
    unittest.main()
