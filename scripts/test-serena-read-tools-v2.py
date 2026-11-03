"""Experimental output contracts: prevent body leakage and native-ID/UTF16 drift.

Fixtures/logs belong to the caller's SERENA_READ_TEST_ROOT lifecycle owner.
"""
import importlib.util
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest

SPEC = importlib.util.spec_from_file_location('serena_read_tools_v2', Path(__file__).with_name('serena-read-tools-v2.py'))
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class Symbol:
    def __init__(self, source, marker, identifier, kind='Function', children=()):
        offset = source.index(marker)
        self.line = source[:offset].count('\n')
        self.column = len(source[:offset].rsplit('\n', 1)[-1].encode('utf-16-le')) // 2
        self.identifier = identifier
        self.symbol_kind_name = kind
        self.children = children
        self.body = 'complete native body: ' + identifier

    def get_name_path(self): return self.identifier
    def iter_children(self): return iter(self.children)


class MetadataContracts(unittest.TestCase):
    def setUp(self):
        parent = os.environ.get('SERENA_READ_TEST_ROOT')
        if not parent:
            raise RuntimeError('SERENA_READ_TEST_ROOT must identify an owned temporary run')
        self.root = Path(tempfile.mkdtemp(prefix='v2-', dir=parent))
        self.symbols = []
        self.api = SimpleNamespace(get_symbols_overview=lambda _: SimpleNamespace(symbols=self.symbols),
                                   find_symbol=self.find)
        self.adapter = MODULE.SerenaReadToolsV2(self.api, self.root)

    def find(self, **args):
        pending, found = list(self.symbols), []
        while pending:
            symbol = pending.pop(0)
            if '/' + symbol.identifier == args['name_path_pattern']:
                found.append(symbol)
            pending.extend(symbol.children)
        return SimpleNamespace(symbols=found)

    def fixture(self, source, specs, filename='sample.ts'):
        (self.root / filename).write_bytes(source.encode('utf-8'))
        self.symbols = [Symbol(source, *spec) for spec in specs]
        return self.adapter.list_ids(filename)

    def test_typed_multiline_async_and_defaults_exclude_bodies(self):
        source = ('/** Compute the answer. Extra explanation. */\n'
                  'export async function compute(\n'
                  '  value: number, options = { nested: { count: 1 } }\n'
                  '): Promise<number> {\n  return value + options.nested.count;\n}\n'
                  'const arrow = async (value: number = 3): Promise<number> => value + 987;\n'
                  'let expression = function named(value = { answer: 1 }) { return 456; };\n')
        rows = self.fixture(source, [('compute(', 'compute'), ('arrow =', 'arrow', 'Constant'),
                                    ('expression =', 'expression', 'Variable')])
        self.assertEqual([row['id'] for row in rows], ['compute', 'arrow', 'expression'])
        self.assertEqual(rows[0], {'id': 'compute', 'start_line': 2, 'end_line': 6,
                         'signature': 'export async function compute(\n  value: number, options = { nested: { count: 1 } }\n): Promise<number>',
                         'doc': 'Compute the answer.'})
        self.assertEqual(rows[1]['signature'], 'const arrow = async (value: number = 3): Promise<number> =>')
        self.assertEqual(rows[2]['signature'], 'let expression = function named(value = { answer: 1 })')
        self.assertNotIn('987', str(rows))
        self.assertNotIn('456', str(rows))

    def test_class_constructor_methods_interface_enum_and_native_order(self):
        source = ('export class Example<T> extends Base {\n'
                  '  /** Create an example! More. */\n'
                  '  constructor(public value: T) {}\n'
                  '  protected async run(input: T): Promise<T> { return input; }\n'
                  '  handler = (value: T) => value;\n}\n'
                  'interface Contract { run(input: string): void; }\n'
                  'enum Choice { First, Second }\n')
        specs = [('Example<', 'Example', 'Class'), ('Contract {', 'Contract', 'Interface'),
                 ('Choice {', 'Choice', 'Enum')]
        self.fixture(source, specs)
        self.symbols[0].children = [Symbol(source, 'constructor(', 'Example/constructor', 'Constructor'),
                                    Symbol(source, 'run(input: T)', 'Example/run', 'Method'),
                                    Symbol(source, 'handler =', 'Example/handler', 'Property')]
        self.symbols[1].children = [Symbol(source, 'run(input: string)', 'Contract/run', 'Method')]
        rows = self.adapter.list_ids('sample.ts')
        old = MODULE.SerenaReadTools(self.api, self.root).list_ids('sample.ts')
        self.assertEqual([row['id'] for row in rows], old)
        self.assertEqual([row['signature'] for row in rows], [
            'export class Example<T> extends Base', 'constructor(public value: T)',
            'protected async run(input: T): Promise<T>', 'handler = (value: T) =>',
            'interface Contract', 'run(input: string): void;', 'enum Choice'])
        self.assertEqual(rows[1]['doc'], 'Create an example!')
        self.assertEqual((rows[0]['start_line'], rows[0]['end_line']), (1, 6))
        self.assertTrue(all(set(row) <= {'id', 'start_line', 'end_line', 'signature', 'doc'} for row in rows))

    def test_documentation_uses_attached_prose_first_sentence_only(self):
        cases = [('', None), ('// Nearby arbitrary text.\n', None),
                 ('/** @param value explanation */\n', None),
                 ('/** One sentence */\n', 'One sentence'),
                 ('/** First? Second! */\n', 'First?'),
                 ('/**\n * Multiple lines\n * form a sentence. Then more.\n * @param value input\n */\n',
                  'Multiple lines form a sentence.'),
                 ('/** 첫 설명입니다。 다음 설명。 */\n', '첫 설명입니다。'),
                 ('/** First paragraph\n *\n * Second paragraph.\n */\n', 'First paragraph')]
        for comment, expected in cases:
            with self.subTest(comment=comment):
                rows = self.fixture(comment + 'const documented = (value: number) => value;\n',
                                    [('documented =', 'documented', 'Constant')])
                if expected is None:
                    self.assertNotIn('doc', rows[0])
                else:
                    self.assertEqual(rows[0]['doc'], expected)

    def test_utf16_crlf_inclusive_ranges_filter_data_and_keep_nested(self):
        source = ('const emoji = "😀"; const object = { run: (x = { a: 1 }) => x };\r\n'
                  'function last() {\r\n  return 2;\r\n}\r\n')
        self.fixture(source, [('emoji =', 'emoji', 'Constant'), ('object =', 'object', 'Constant'),
                              ('last()', 'last')])
        self.symbols[1].children = [Symbol(source, 'run:', 'object/run', 'Property')]
        rows = self.adapter.list_ids('sample.ts')
        self.assertEqual([row['id'] for row in rows], ['object/run', 'last'])
        self.assertEqual(rows[0]['signature'], 'run: (x = { a: 1 }) =>')
        self.assertEqual((rows[0]['start_line'], rows[0]['end_line']), (1, 1))
        self.assertEqual((rows[1]['start_line'], rows[1]['end_line']), (2, 4))

    def test_multi_declaration_signature_does_not_leak_sibling_body(self):
        source = '/** Shared declaration doc. More. */\nexport const first = () => 123, second = function () { return 456; };\n'
        rows = self.fixture(source, [('first =', 'first', 'Constant'), ('second =', 'second', 'Constant')])
        self.assertEqual([row['signature'] for row in rows], ['export const first = () =>',
                                                           'export const second = function ()'])
        self.assertTrue(all(row['doc'] == 'Shared declaration doc.' for row in rows))
        self.assertNotIn('123', str(rows))
        self.assertNotIn('456', str(rows))

    def test_native_anonymous_callback_captions_keep_source_only_signatures(self):
        source = ('function accessIssueForChart(issues: Issue[]) {\n'
                  '  return issues.find((issue: Issue) => issue.code === "blocked");\n}\n'
                  'const text = "😀"; rows.map(async (row: Row): Promise<Row> => {\n'
                  '  return row;\n});\n'
                  'rows.filter(function (row: Row): boolean { return row.ready; });\n')
        specs = [('accessIssueForChart(', 'accessIssueForChart'),
                 ('(issue: Issue)', 'accessIssueForChart/issues.find() callback[0]'),
                 ('async (row:', 'rows.map() callback[0]'),
                 ('function (row:', 'rows.filter() callback[0]')]
        rows = self.fixture(source, specs)
        native_ids = MODULE.SerenaReadTools(self.api, self.root).list_ids('sample.ts')
        self.assertEqual([row['id'] for row in rows], native_ids)
        self.assertEqual([row['signature'] for row in rows[1:]], [
            '(issue: Issue) =>', 'async (row: Row): Promise<Row> =>', 'function (row: Row): boolean'])
        self.assertEqual([(row['start_line'], row['end_line']) for row in rows[1:]], [(2, 2), (4, 6), (7, 7)])
        self.assertTrue(all('doc' not in row for row in rows[1:]))
        self.assertTrue(all('callback' not in row['signature'] for row in rows[1:]))

    def test_inherited_body_batch_stale_path_duplicate_and_errors(self):
        self.fixture('function one() {}\n', [('one()', 'one')])
        selections = [{'relative_path': 'sample.ts', 'id': identifier} for identifier in ['one', 'one', 'absent']]
        result = self.adapter.read_symbols(selections)
        self.assertEqual(result['results'][0]['body'], 'complete native body: one')
        self.assertEqual(result['duplicates'][0]['duplicate_of'], 0)
        self.assertEqual(result['errors'][0]['request_index'], 2)
        (self.root / 'sample.ts').write_text('changed', encoding='utf-8')
        self.assertIn('changed', self.adapter.read_symbols(selections)['errors'][0]['error'].lower())
        with self.assertRaises(ValueError): self.adapter.list_ids('../escape.ts')
        with self.assertRaises(ValueError): self.adapter.read_symbols([])
        with self.assertRaises(ValueError): self.adapter.list_ids(str(self.root / 'sample.ts'))

    def test_explicit_join_unsupported_duplicate_and_listing_race_errors(self):
        self.fixture('function one() {}\n', [('one()', 'one')])
        self.symbols[0].column += 1
        with self.assertRaisesRegex(ValueError, 'Cannot map'): self.adapter.list_ids('sample.ts')
        self.symbols[0].column -= 1
        self.symbols.append(self.symbols[0])
        with self.assertRaisesRegex(ValueError, 'Ambiguous'): self.adapter.list_ids('sample.ts')
        (self.root / 'sample.py').write_text('def one(): pass', encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'only experimental JS/TS'): self.adapter.list_ids('sample.py')
        self.symbols.pop()
        original = self.api.get_symbols_overview
        def mutate(name):
            result = original(name)
            with (self.root / name).open('a', encoding='utf-8') as stream:
                stream.write('\n// changed')
            return result
        self.api.get_symbols_overview = mutate
        with self.assertRaisesRegex(ValueError, 'changed'): self.adapter.list_ids('sample.ts')


if __name__ == '__main__':
    unittest.main()
