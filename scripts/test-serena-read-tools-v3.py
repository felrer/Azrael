"""Search output contracts; fixtures/logs belong to SERENA_READ_TEST_ROOT."""
import importlib.util
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest

SPEC = importlib.util.spec_from_file_location(
    'serena_read_tools_v3', Path(__file__).with_name('serena-read-tools-v3.py'))
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class Symbol:
    def __init__(self, source, marker, identifier, kind='Function'):
        prefix = source[:source.index(marker)]
        self.line = prefix.count('\n')
        self.column = len(prefix.rsplit('\n', 1)[-1].encode('utf-16-le')) // 2
        self.identifier = identifier
        self.symbol_kind_name = kind
        self.body = 'complete body: ' + identifier

    def get_name_path(self): return self.identifier
    def iter_children(self): return iter(())


class SearchContracts(unittest.TestCase):
    def setUp(self):
        parent = os.environ.get('SERENA_READ_TEST_ROOT')
        if not parent:
            raise RuntimeError('SERENA_READ_TEST_ROOT must identify an owned temporary run')
        self.root = Path(tempfile.mkdtemp(prefix='v3-', dir=parent))
        source = ('/** Fetch account profile. Extra explanation. */\n'
                  'export async function loadAccount(id: string, refresh = false): Promise<string> {\n'
                  '  return "bodyOnlyNeedle";\n}\n'
                  'function saveAccount(account: string): void {}\n'
                  'const projectRows = (rows: number[]) => rows;\n'
                  '/** Straße lookup. More detail. */\n'
                  'function formatAddress(value: string) {}\n'
                  '// nearbySecret\n'
                  'function hidden() {}\n')
        (self.root / 'sample.ts').write_text(source, encoding='utf-8')
        self.symbols = [Symbol(source, 'loadAccount(', 'loadAccount'),
                        Symbol(source, 'saveAccount(', 'saveAccount'),
                        Symbol(source, 'projectRows =', 'projectRows', 'Constant'),
                        Symbol(source, 'formatAddress(', 'formatAddress'),
                        Symbol(source, 'hidden()', 'hidden')]
        self.overviews = 0

        def overview(_):
            self.overviews += 1
            return SimpleNamespace(symbols=self.symbols)

        def find(**args):
            return SimpleNamespace(symbols=[item for item in self.symbols
                if '/' + item.identifier == args['name_path_pattern']])

        self.api = SimpleNamespace(get_symbols_overview=overview, find_symbol=find)
        self.adapter = MODULE.SerenaReadToolsV3(self.api, self.root)

    def search_ids(self, query):
        return [item['id'] for item in self.adapter.find_symbols('sample.ts', query)]

    def test_search_name_signature_and_existing_doc_without_generated_text(self):
        self.assertEqual(self.search_ids('LOADaccount'), ['loadAccount'])
        self.assertEqual(self.search_ids('number[]'), ['projectRows'])
        self.assertEqual(self.search_ids('fetch'), ['loadAccount'])
        self.assertEqual(self.search_ids('STRASSE'), ['formatAddress'])
        self.assertEqual(self.adapter.find_symbols('sample.ts', 'fetch'), [{
            'id': 'loadAccount', 'start_line': 2, 'end_line': 4,
            'signature': 'export async function loadAccount(id: string, refresh = false): Promise<string>',
            'doc': 'Fetch account profile.',
        }])

    def test_multiple_terms_are_and_across_fields_and_preserve_native_order(self):
        self.assertEqual(self.search_ids('  ACCOUNT\tstring\n'), ['loadAccount', 'saveAccount'])
        self.assertEqual(self.search_ids('profile refresh'), ['loadAccount'])
        self.assertEqual(self.search_ids('account number[]'), [])
        self.assertEqual(self.search_ids('account account'), ['loadAccount', 'saveAccount'])

    def test_no_match_body_comments_and_regex_are_not_silently_expanded(self):
        for query in ['missingSymbol', 'bodyOnlyNeedle', 'nearbySecret', 'Extra explanation', '.*']:
            with self.subTest(query=query):
                self.assertEqual(self.search_ids(query), [])

    def test_invalid_query_is_rejected_before_source_lookup(self):
        for query in ['', ' \t\n', None, 42, [], {}]:
            with self.subTest(query=query), self.assertRaisesRegex(ValueError, 'nonempty'):
                self.adapter.find_symbols('../missing.ts', query)
        self.assertEqual(self.overviews, 0)

    def test_search_preserves_batch_read_and_source_path_protections(self):
        ids = self.search_ids('account')
        selected = [{'relative_path': 'sample.ts', 'id': identifier} for identifier in ids]
        result = self.adapter.read_symbols(selected + selected[:1])
        self.assertEqual([item['body'] for item in result['results']],
                         ['complete body: loadAccount', 'complete body: saveAccount'])
        self.assertEqual(result['errors'], [])
        self.assertEqual(result['duplicates'][0]['duplicate_of'], 0)
        (self.root / 'sample.ts').write_text('changed', encoding='utf-8')
        stale = self.adapter.read_symbols(selected)
        self.assertEqual(stale['results'], [])
        self.assertTrue(all('changed' in item['error'].lower() for item in stale['errors']))
        self.assertTrue(all('find_symbols' in item['error'] for item in stale['errors']))
        self.assertTrue(all('list_ids' not in item['error'] for item in stale['errors']))
        with self.assertRaises(ValueError): self.adapter.find_symbols('../sample.ts', 'account')
        with self.assertRaises(ValueError): self.adapter.find_symbols(str(self.root / 'sample.ts'), 'account')

    def test_known_id_body_read_needs_no_search(self):
        result = self.adapter.read_symbols([{'relative_path': 'sample.ts', 'id': 'hidden'}])
        self.assertEqual(result['results'][0]['body'], 'complete body: hidden')
        self.assertEqual(result['errors'], [])
        self.assertEqual(self.overviews, 0)


if __name__ == '__main__':
    unittest.main()
