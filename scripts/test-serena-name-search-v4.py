"""Name-only contracts. All generated fixtures stay in SERENA_READ_TEST_ROOT."""
import importlib.util
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest

SPEC = importlib.util.spec_from_file_location(
    'serena_name_search_v4', Path(__file__).with_name('serena-name-search-v4.py'))
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class Symbol:
    def __init__(self, source, marker, identifier, children=()):
        prefix = source[:source.index(marker)]
        self.line = prefix.count('\n')
        self.column = len(prefix.rsplit('\n', 1)[-1].encode('utf-16-le')) // 2
        self.identifier = identifier
        self.children = children

    def get_name_path(self): return self.identifier
    def iter_children(self): return iter(self.children)


class NameContracts(unittest.TestCase):
    def setUp(self):
        parent = os.environ.get('SERENA_READ_TEST_ROOT')
        if not parent:
            raise RuntimeError('SERENA_READ_TEST_ROOT must identify an owned temporary run')
        self.root = Path(tempfile.mkdtemp(prefix='v4-', dir=parent))
        self.source = '''import {widthImport} from "external";
interface WidthInterface { widthSignature(): void; }
type WidthType = string;
enum WidthEnum { widthMember }
const widthConfig = {width: 120, widthMethod() {}, arrowWidth: () => 0};
const widthArrow = () => 1;
const widthExpression = function () { return 1; };
const {original: widthAlias} = input;
const [widthItem] = items;
class WidthBox {
  widthField = 1;
  arrowWidthField = () => 1;
  get widthValue() { return 1; }
  unrelated() {
    const widthLocal = 1;
    const arrowWidthLocal = () => 1;
    function nestedWidth() {}
    items.map(() => 1);
  }
}
/** docSecret */
function scopeWidth(widthParam: string): ReturnSecret { return "bodySecret"; }
/* 🌲 */ function unicodeWidth() {}
function Straße() {}
export {widthAlias as widthExportAlias};
'''
        (self.root / 'sample.ts').write_text(self.source, encoding='utf-8')
        rows = [
            ('widthImport}', 'widthImport'),
            ('WidthInterface {', 'WidthInterface'),
            ('widthSignature()', 'WidthInterface/widthSignature'),
            ('WidthType =', 'WidthType'),
            ('WidthEnum {', 'WidthEnum'),
            ('widthMember }', 'WidthEnum/widthMember'),
            ('widthConfig =', 'widthConfig'),
            ('width: 120', 'widthConfig/width'),
            ('widthMethod()', 'widthConfig/widthMethod'),
            ('arrowWidth:', 'widthConfig/arrowWidth'),
            ('widthArrow =', 'widthArrow'),
            ('widthExpression =', 'widthExpression'),
            ('widthAlias}', 'widthAlias'),
            ('widthItem]', 'widthItem'),
            ('WidthBox {', 'WidthBox'),
            ('widthField =', 'WidthBox/widthField'),
            ('arrowWidthField =', 'WidthBox/arrowWidthField'),
            ('widthValue()', 'WidthBox/widthValue'),
            ('unrelated()', 'WidthBox/unrelated'),
            ('widthLocal =', 'WidthBox/unrelated/widthLocal'),
            ('arrowWidthLocal =', 'WidthBox/unrelated/arrowWidthLocal'),
            ('nestedWidth()', 'WidthBox/unrelated/nestedWidth'),
            ('() => 1);', 'WidthBox/unrelated/items.map() callback'),
            ('scopeWidth(', 'scopeWidth'),
            ('widthParam:', 'scopeWidth/widthParam'),
            ('unicodeWidth()', 'unicodeWidth'),
            ('Straße()', 'Straße'),
            ('widthExportAlias}', 'widthExportAlias'),
        ]
        self.symbols = [Symbol(self.source, marker, identifier) for marker, identifier in rows]
        self.calls = 0

        def overview(_):
            self.calls += 1
            return SimpleNamespace(symbols=self.symbols)

        self.api = SimpleNamespace(get_symbols_overview=overview)
        self.adapter = MODULE.SerenaNameSearchV4(self.api, self.root)

    def test_names_only_includes_callables_classes_and_top_level_data(self):
        expected = ['widthConfig', 'widthConfig/widthMethod', 'widthConfig/arrowWidth',
                    'widthArrow', 'widthExpression', 'widthAlias', 'widthItem', 'WidthBox',
                    'WidthBox/arrowWidthField', 'WidthBox/widthValue',
                    'WidthBox/unrelated/arrowWidthLocal', 'WidthBox/unrelated/nestedWidth',
                    'scopeWidth', 'unicodeWidth']
        actual = self.adapter.find_names('sample.ts', 'width')
        self.assertEqual(actual, expected)
        self.assertTrue(all(isinstance(value, str) for value in actual))
        self.assertFalse(hasattr(self.adapter, 'list_ids'))
        self.assertFalse(hasattr(self.adapter, 'read_symbols'))

    def test_casefold_literal_substring_not_parent_or_other_fields(self):
        lower = self.adapter.find_names('sample.ts', 'width')
        self.assertEqual(self.adapter.find_names('sample.ts', 'Width'), lower)
        self.assertEqual(self.adapter.find_names('sample.ts', ' WIDTH '), lower)
        self.assertEqual(self.adapter.find_names('sample.ts', 'STRASSE'), ['Straße'])
        self.assertEqual(self.adapter.find_names('sample.ts', 'box'), ['WidthBox'])
        for query in ['docSecret', 'ReturnSecret', 'bodySecret', 'widthParam',
                      'WidthInterface', 'WidthType', 'WidthEnum',
                      'widthImport', 'widthExportAlias', 'callback',
                      'original', '.*', 'width config']:
            with self.subTest(query=query):
                self.assertEqual(self.adapter.find_names('sample.ts', query), [])

    def test_invalid_queries_and_paths_do_not_request_overview(self):
        for query in ['', ' \t\n', None, 42, [], {}]:
            with self.subTest(query=query), self.assertRaisesRegex(ValueError, 'nonempty'):
                self.adapter.find_names('../missing.ts', query)
        for filename in ['../sample.ts', str(self.root / 'sample.ts'), 'missing.ts', '']:
            with self.subTest(filename=filename), self.assertRaises(ValueError):
                self.adapter.find_names(filename, 'width')
        (self.root / 'sample.txt').write_text(self.source, encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'JS/TS'):
            self.adapter.find_names('sample.txt', 'width')
        self.assertEqual(self.calls, 0)

    def test_native_children_are_traversed_without_parent_query_expansion(self):
        child = Symbol(self.source, 'widthMethod()', 'widthConfig/widthMethod')
        parent = Symbol(self.source, 'widthConfig =', 'widthConfig', [child])
        self.symbols = [parent]
        self.assertEqual(self.adapter.find_names('sample.ts', 'method'), ['widthConfig/widthMethod'])
        self.assertEqual(self.adapter.find_names('sample.ts', 'config'), ['widthConfig'])

    def test_duplicate_native_ids_and_source_changes_are_rejected(self):
        self.symbols = [self.symbols[6], self.symbols[6]]
        with self.assertRaisesRegex(ValueError, 'Ambiguous'):
            self.adapter.find_names('sample.ts', 'config')

        def changing_overview(_):
            (self.root / 'sample.ts').write_text('const changed = 1;', encoding='utf-8')
            return SimpleNamespace(symbols=self.symbols[:1])

        self.api.get_symbols_overview = changing_overview
        with self.assertRaisesRegex(ValueError, 'changed'):
            self.adapter.find_names('sample.ts', 'config')


if __name__ == '__main__':
    unittest.main()
