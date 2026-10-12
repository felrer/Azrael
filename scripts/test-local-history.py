"""Small history fixtures verify ownership, incremental refresh, and projection keys."""
import contextlib
import hashlib
import importlib.util
import io
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('sync_history', Path(__file__).with_name('sync-local-history.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class HistoryImport(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.source, self.target, self.templates = [self.root/n for n in ('original', 'azrael', 'templates')]
        for p in (self.source, self.target, self.templates):
            p.mkdir()
        self.id = '11111111-1111-4111-8111-111111111111'
        self.projection = '22222222-2222-4222-8222-222222222222'
        self.rollout = self.source/'sessions'/f'rollout-{self.projection}.jsonl'
        self.rollout.parent.mkdir()
        self.rollout.write_text('{"fixture":true}\n')
        for root in (self.templates, self.source):
            with sqlite3.connect(root/'state_5.sqlite') as db:
                db.execute('CREATE TABLE threads (id TEXT PRIMARY KEY, rollout_path TEXT, updated_at_ms INTEGER, title TEXT)')
            with sqlite3.connect(root/'thread_history_1.sqlite') as db:
                for table in module.HISTORY_TABLES:
                    extra = ', next_rollout_byte_offset INTEGER' if table.endswith('state') else ', item_json TEXT'
                    if root == self.templates and table.endswith('state'):
                        extra += ', projection_version INTEGER NOT NULL DEFAULT 0'
                    db.execute(f'CREATE TABLE {table} (thread_id TEXT PRIMARY KEY{extra})')
        with sqlite3.connect(self.source/'state_5.sqlite') as db:
            db.execute('INSERT INTO threads VALUES (?,?,?,?)', (self.id, str(self.rollout), 1, 'Local fixture'))
        with sqlite3.connect(self.source/'thread_history_1.sqlite') as db:
            for table in module.HISTORY_TABLES:
                db.execute(f'INSERT INTO {table} VALUES (?,?)', (self.projection, self.rollout.stat().st_size if table.endswith('state') else '{"fixture":true}'))

    def tearDown(self):
        self.tmp.cleanup()

    def run_import(self):
        with contextlib.redirect_stdout(io.StringIO()):
            return module.run(self.source, self.target, self.templates)

    def source_hashes(self):
        return {p.relative_to(self.source).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
                for p in self.source.rglob('*') if p.is_file()}

    def test_full_import_and_no_source_writes(self):
        before = self.source_hashes()
        self.assertEqual(self.run_import()['imported'], 1)
        self.assertEqual(before, self.source_hashes())
        with sqlite3.connect(self.target/'state_5.sqlite') as db:
            p, title = db.execute('SELECT rollout_path,title FROM threads').fetchone()
        self.assertEqual(title, 'Local fixture')
        self.assertEqual(Path(p).read_bytes(), self.rollout.read_bytes())
        self.assertNotEqual(Path(p).stat().st_ino, self.rollout.stat().st_ino)
        with sqlite3.connect(self.target/'thread_history_1.sqlite') as db:
            self.assertEqual(db.execute('SELECT thread_id,projection_version FROM thread_history_projection_state').fetchone(), (self.projection, 0))
        self.assertEqual(self.run_import()['imported'], 0)

    def test_refresh_and_preserve_azrael_continuation(self):
        self.run_import()
        self.rollout.write_text(self.rollout.read_text()+'{"next":true}\n')
        with sqlite3.connect(self.source/'state_5.sqlite') as db:
            db.execute('UPDATE threads SET updated_at_ms=2,title="Changed original"')
        self.assertEqual(self.run_import()['refreshed'], 1)
        destination = self.target/self.rollout.relative_to(self.source)
        destination.write_text(destination.read_text()+'{"azrael":true}\n')
        before = destination.read_bytes()
        self.rollout.write_text(self.rollout.read_text()+'{"later":true}\n')
        self.assertEqual(self.run_import()['refreshed'], 0)
        self.assertEqual(destination.read_bytes(), before)

    def test_existing_azrael_metadata_and_history_win(self):
        self.run_import()
        with sqlite3.connect(self.target/'state_5.sqlite') as db:
            db.execute('UPDATE threads SET updated_at_ms=99,title="Azrael title"')
        with sqlite3.connect(self.target/'thread_history_1.sqlite') as db:
            db.execute('UPDATE thread_items SET item_json="azrael-owned"')
        with sqlite3.connect(self.source/'state_5.sqlite') as db:
            db.execute('UPDATE threads SET updated_at_ms=3,title="Original new"')
        self.assertEqual(self.run_import()['refreshed'], 0)
        with sqlite3.connect(self.target/'thread_history_1.sqlite') as db:
            self.assertEqual(db.execute('SELECT item_json FROM thread_items').fetchone()[0], 'azrael-owned')

    def test_unindexed_rollouts_and_separate_homes(self):
        orphan = self.source/'sessions'/'rollout-33333333-3333-4333-8333-333333333333.jsonl'
        orphan.write_text('{"unindexed":true}\n')
        self.assertEqual(self.run_import()['unindexedRollouts'], 1)
        self.assertEqual((self.target/orphan.relative_to(self.source)).read_bytes(), orphan.read_bytes())
        with self.assertRaises(ValueError):
            module.run(self.source, self.source, self.templates)

    def test_orphan_with_indexed_uuid_preserves_azrael_projection(self):
        self.run_import()
        with sqlite3.connect(self.target/'state_5.sqlite') as db:
            db.execute('UPDATE threads SET updated_at_ms=99,title="Azrael continuation"')
        with sqlite3.connect(self.target/'thread_history_1.sqlite') as db:
            db.execute('UPDATE thread_items SET item_json="azrael-owned"')
        orphan = self.source/'archived_sessions'/self.rollout.name
        orphan.parent.mkdir()
        orphan.write_bytes(self.rollout.read_bytes())
        self.assertEqual(self.run_import().get('unindexedRollouts', 0), 0)
        self.assertEqual(len(list(self.target.rglob(self.rollout.name))), 1)
        with sqlite3.connect(self.target/'thread_history_1.sqlite') as db:
            self.assertEqual(db.execute('SELECT item_json FROM thread_items').fetchone()[0], 'azrael-owned')

    def test_ambiguous_orphan_uuid_is_not_copied(self):
        identity = '33333333-3333-4333-8333-333333333333'
        for subtree in ('sessions', 'archived_sessions'):
            orphan = self.source/subtree/f'rollout-{identity}.jsonl'
            orphan.parent.mkdir(exist_ok=True)
            orphan.write_text('{"orphan":true}\n')
        self.assertEqual(self.run_import().get('unindexedRollouts', 0), 0)
        self.assertEqual(len(list(self.target.rglob(f'*{identity}.jsonl'))), 0)

    def test_orphan_with_existing_target_uuid_is_not_copied(self):
        identity = '33333333-3333-4333-8333-333333333333'
        existing = self.target/'sessions'/f'rollout-{identity}.jsonl'
        existing.parent.mkdir()
        existing.write_text('{"azrael":true}\n')
        orphan = self.source/'archived_sessions'/existing.name
        orphan.parent.mkdir()
        orphan.write_text('{"source":true}\n')
        self.assertEqual(self.run_import().get('unindexedRollouts', 0), 0)
        self.assertEqual(existing.read_text(), '{"azrael":true}\n')
        self.assertEqual(len(list(self.target.rglob(existing.name))), 1)

    def test_interrupted_orphan_can_retry_its_recorded_file(self):
        self.run_import()
        identity = '33333333-3333-4333-8333-333333333333'
        orphan = self.source/'sessions'/f'rollout-{identity}.jsonl'
        orphan.write_text('{"orphan":true}\n')
        with patch.object(module, 'merge', side_effect=sqlite3.OperationalError('fixture interruption')):
            with self.assertRaises(sqlite3.OperationalError):
                self.run_import()
        self.assertEqual(self.run_import()['unindexedRollouts'], 1)
        self.assertEqual(len(list(self.target.rglob(orphan.name))), 1)

    def test_interrupted_refresh_recovers_after_file_replacement(self):
        self.run_import()
        self.rollout.write_text(self.rollout.read_text()+'{"new":true}\n')
        real_merge = module.merge
        def fail_after_copy(db, table, where='1'):
            if table == 'thread_items':
                raise sqlite3.OperationalError('fixture interruption')
            return real_merge(db, table, where)
        with patch.object(module, 'merge', fail_after_copy), self.assertRaises(sqlite3.OperationalError):
            self.run_import()
        self.assertEqual(self.run_import()['refreshed'], 1)
        destination = self.target/self.rollout.relative_to(self.source)
        self.assertEqual(destination.read_bytes(), self.rollout.read_bytes())

    def interrupt_initial_import(self):
        real_merge = module.merge
        def fail_after_copy(db, table, where='1'):
            if table == 'thread_items':
                raise sqlite3.OperationalError('fixture interruption')
            return real_merge(db, table, where)
        with patch.object(module, 'merge', fail_after_copy), self.assertRaises(sqlite3.OperationalError):
            self.run_import()
        destination = self.target/self.rollout.relative_to(self.source)
        with sqlite3.connect(self.target/'state_5.sqlite') as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM threads').fetchone()[0], 0)
            self.assertEqual(db.execute('SELECT target_size,target_mtime FROM azrael_local_history_pending WHERE id=?',
                                        (self.id,)).fetchone(),
                             (destination.stat().st_size, destination.stat().st_mtime_ns))
        return destination

    def assert_preserved_without_import(self, destination):
        before, source_before = destination.read_bytes(), self.source_hashes()
        result = self.run_import()
        self.assertEqual((result['imported'], result['refreshed'], result['preserved']), (0, 0, 1))
        self.assertEqual(destination.read_bytes(), before)
        self.assertEqual(self.source_hashes(), source_before)
        with sqlite3.connect(self.target/'state_5.sqlite') as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM threads WHERE id=?', (self.id,)).fetchone()[0], 0)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM azrael_local_history_imports WHERE id=?',
                                        (self.id,)).fetchone()[0], 0)
        with sqlite3.connect(self.target/'thread_history_1.sqlite') as db:
            for table in module.HISTORY_TABLES:
                self.assertEqual(db.execute(f'SELECT COUNT(*) FROM {table} WHERE thread_id IN (?,?)',
                                            (self.id, self.projection)).fetchone()[0], 0)

    def test_interrupted_initial_import_recovers_owned_generation(self):
        before = self.source_hashes()
        destination = self.interrupt_initial_import()
        self.assertEqual(self.run_import()['imported'], 1)
        self.assertEqual(destination.read_bytes(), self.rollout.read_bytes())
        self.assertEqual(self.source_hashes(), before)
        with sqlite3.connect(self.target/'state_5.sqlite') as db:
            self.assertEqual(db.execute('SELECT id FROM threads').fetchone()[0], self.id)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM azrael_local_history_pending').fetchone()[0], 0)
        with sqlite3.connect(self.target/'thread_history_1.sqlite') as db:
            self.assertEqual(db.execute('SELECT thread_id FROM thread_items').fetchone()[0], self.projection)

    def test_preexisting_regular_rollout_without_row_is_preserved(self):
        destination = self.target/self.rollout.relative_to(self.source)
        destination.parent.mkdir()
        destination.write_text('{"azrael":true}\n')
        self.assert_preserved_without_import(destination)

    def test_interrupted_initial_import_preserves_changed_size(self):
        destination = self.interrupt_initial_import()
        original = destination.stat()
        destination.write_text(destination.read_text()+'{"azrael":true}\n')
        os.utime(destination, ns=(original.st_atime_ns, original.st_mtime_ns))
        self.assert_preserved_without_import(destination)

    def test_interrupted_initial_import_preserves_changed_mtime(self):
        destination = self.interrupt_initial_import()
        original = destination.stat()
        destination.write_bytes(b'x'*original.st_size)
        os.utime(destination, ns=(original.st_atime_ns, original.st_mtime_ns+1_000_000_000))
        self.assert_preserved_without_import(destination)

    def test_two_interruptions_preserve_all_pending_file_generations(self):
        self.run_import()
        self.rollout.write_text(self.rollout.read_text()+'{"first":true}\n')
        real_merge = module.merge
        def fail_after_copy(db, table, where='1'):
            if table == 'thread_items':
                raise sqlite3.OperationalError('first interruption')
            return real_merge(db, table, where)
        with patch.object(module, 'merge', fail_after_copy), self.assertRaises(sqlite3.OperationalError):
            self.run_import()
        self.rollout.write_text(self.rollout.read_text()+'{"second":true}\n')
        replace = Path.replace
        def fail_before_replace(path, destination):
            if path.name.startswith('rollout-'):
                raise OSError('second interruption')
            return replace(path, destination)
        with patch.object(Path, 'replace', fail_before_replace), self.assertRaises(OSError):
            self.run_import()
        self.assertEqual(self.run_import()['refreshed'], 1)
        self.assertEqual((self.target/self.rollout.relative_to(self.source)).read_bytes(), self.rollout.read_bytes())


if __name__ == '__main__':
    unittest.main()
