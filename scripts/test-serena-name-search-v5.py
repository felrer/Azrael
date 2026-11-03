"""Ranges and optional compact signatures, using the v4 selection fixture."""
import importlib.util
from pathlib import Path
import unittest


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


V4_TEST = load('v4_name_contracts', 'test-serena-name-search-v4.py')
V5 = load('v5_name_search', 'serena-name-search-v5.py')


class SearchV5Contracts(V4_TEST.NameContracts):
    def setUp(self):
        super().setUp()
        self.adapter = V5.SerenaNameSearchV5(self.api, self.root)

    def test_names_only_includes_callables_classes_and_top_level_data(self):
        expected = [
            ['widthConfig', 5, 5], ['widthConfig/widthMethod', 5, 5],
            ['widthConfig/arrowWidth', 5, 5], ['widthArrow', 6, 6],
            ['widthExpression', 7, 7], ['widthAlias', 8, 8], ['widthItem', 9, 9],
            ['WidthBox', 10, 20], ['WidthBox/arrowWidthField', 12, 12],
            ['WidthBox/widthValue', 13, 13],
            ['WidthBox/unrelated/arrowWidthLocal', 16, 16],
            ['WidthBox/unrelated/nestedWidth', 17, 17],
            ['scopeWidth', 22, 22], ['unicodeWidth', 23, 23],
        ]
        self.assertEqual(self.adapter.find_names('sample.ts', 'width'), expected)
        self.assertEqual(self.adapter.find_names('sample.ts', 'width', include_signature=False), expected)
        detailed = self.adapter.find_names('sample.ts', 'width', include_signature=True)
        self.assertEqual([row[:3] for row in detailed], expected)
        self.assertEqual(detailed[0], expected[0])
        self.assertEqual(detailed[7], expected[7])
        self.assertEqual(detailed[12][-1], '(widthParam: string): ReturnSecret')
        self.assertFalse(hasattr(self.adapter, 'list_ids'))
        self.assertFalse(hasattr(self.adapter, 'read_symbols'))

    def test_casefold_literal_substring_not_parent_or_other_fields(self):
        lower = self.adapter.find_names('sample.ts', 'width')
        self.assertEqual(self.adapter.find_names('sample.ts', 'Width'), lower)
        self.assertEqual(self.adapter.find_names('sample.ts', ' WIDTH '), lower)
        self.assertEqual(self.adapter.find_names('sample.ts', 'STRASSE'), [['Straße', 24, 24]])
        self.assertEqual(self.adapter.find_names('sample.ts', 'box'), [['WidthBox', 10, 20]])
        for query in ['docSecret', 'ReturnSecret', 'bodySecret', 'widthParam',
                      'WidthInterface', 'WidthType', 'WidthEnum', 'widthImport',
                      'widthExportAlias', 'callback', 'original', '.*', 'width config']:
            for include in [False, True]:
                with self.subTest(query=query, include=include):
                    self.assertEqual(self.adapter.find_names(
                        'sample.ts', query, include_signature=include), [])

    def test_native_children_are_traversed_without_parent_query_expansion(self):
        child = V4_TEST.Symbol(self.source, 'widthMethod()', 'widthConfig/widthMethod')
        self.symbols = [V4_TEST.Symbol(self.source, 'widthConfig =', 'widthConfig', [child])]
        self.assertEqual(self.adapter.find_names('sample.ts', 'method'),
                         [['widthConfig/widthMethod', 5, 5]])
        self.assertEqual(self.adapter.find_names('sample.ts', 'config'), [['widthConfig', 5, 5]])

    def test_invalid_signature_option_is_rejected_before_source_lookup(self):
        for value in [None, 0, 1, 'true', [], {}]:
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, 'boolean'):
                self.adapter.find_names('../missing.ts', 'width', include_signature=value)
        self.assertEqual(self.calls, 0)

    def test_signatures_preserve_types_defaults_and_callable_modifiers(self):
        source = '''export async function loadAccount<T extends Record<string, unknown>>(
  id: string, options = {label: "a  b", token: "loadAccount"}, ...rest: T[]
): Promise<T> { throw new Error("bodySecret"); }
const inferAccount = (value = 1) => value;
const genericArrow = async <T,>(value: T): Promise<T> => value;
class AccountBox {
  static async readAccount(id: string): Promise<string> { return id; }
  get accountName(): string { return "name"; }
  set accountName(value: string) {}
  *accountItems(): Generator<string> { yield "x"; }
}
'''
        (self.root / 'signatures.ts').write_text(source, encoding='utf-8')
        pairs = [('loadAccount<', 'loadAccount'), ('inferAccount =', 'inferAccount'),
                 ('genericArrow =', 'genericArrow'), ('AccountBox {', 'AccountBox'),
                 ('readAccount(', 'AccountBox/readAccount'),
                 ('accountName():', 'AccountBox/accountName.get'),
                 ('accountName(value:', 'AccountBox/accountName.set'),
                 ('accountItems()', 'AccountBox/accountItems')]
        self.symbols = [V4_TEST.Symbol(source, marker, identifier) for marker, identifier in pairs]
        detail = self.adapter.find_names('signatures.ts', 'Account', include_signature=True)
        by_id = {row[0]:row for row in detail}
        signature = by_id['loadAccount'][3]
        self.assertTrue(signature.startswith('async <T extends Record<string, unknown>>(id: string,'))
        self.assertTrue(signature.endswith('...rest: T[]): Promise<T>'))
        self.assertIn('"a  b"', signature)
        self.assertIn('"loadAccount"', signature)
        self.assertNotIn('function loadAccount', signature)
        self.assertNotIn('bodySecret', signature)
        self.assertEqual(by_id['loadAccount'][:3], ['loadAccount', 1, 3])
        self.assertEqual(by_id['inferAccount'][3], '(value = 1)')
        self.assertEqual(by_id['AccountBox'], ['AccountBox', 6, 11])
        self.assertEqual(by_id['AccountBox/readAccount'][3], 'static async (id: string): Promise<string>')
        self.assertEqual(by_id['AccountBox/accountName.get'][3], 'get (): string')
        self.assertEqual(by_id['AccountBox/accountName.set'][3], 'set (value: string)')
        self.assertEqual(by_id['AccountBox/accountItems'][3], '*(): Generator<string>')
        arrow = self.adapter.find_names('signatures.ts', 'genericArrow', include_signature=True)
        self.assertEqual(arrow, [['genericArrow', 5, 5, 'async <T>(value: T): Promise<T>']])

    def test_multi_declaration_ranges_do_not_absorb_neighbor_declarations(self):
        source = 'const first = (value: number): number => value,\n  second = (text: string) => text;\n'
        (self.root / 'multi.ts').write_text(source, encoding='utf-8')
        self.symbols = [V4_TEST.Symbol(source, 'first =', 'first'),
                        V4_TEST.Symbol(source, 'second =', 'second')]
        self.assertEqual(self.adapter.find_names('multi.ts', 'first', include_signature=True),
                         [['first', 1, 1, '(value: number): number']])
        self.assertEqual(self.adapter.find_names('multi.ts', 'second', include_signature=True),
                         [['second', 2, 2, '(text: string)']])


if __name__ == '__main__':
    unittest.main()
