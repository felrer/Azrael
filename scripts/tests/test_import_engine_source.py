"""Safety and source-coverage checks for the one-shot portable importer."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "import_engine_source", Path(__file__).resolve().parents[1] / "import-engine-source.py")
importer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(importer)
REPLAY_ORIGINAL = (b"                completed_at,\n                duration_ms,\n            } = turn;\n"
                   b"                            completed_at,\n                            duration_ms,\n                        },\n")


class ImportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.source = Path(self.temp.name) / "source"
        self.destination = Path(self.temp.name) / "engine"
        self.source.mkdir()
        self.git("init", "--quiet")
        self.git("config", "user.name", "Importer fixture")
        self.git("config", "user.email", "fixture@example.invalid")
        self.git("config", "core.autocrlf", "false")
        self.git("remote", "add", "origin", "https://github.com/openai/codex.git")
        (self.source / "LICENSE").write_bytes(b"license\n")
        (self.source / "deleted.txt").write_bytes(b"deleted\n")
        (self.source / ".gitignore").write_text(".ruff_cache/\nunknown/\n")
        self.git("add", ".")
        self.git("commit", "--quiet", "-m", "fixture")
        self.git("tag", "rust-v0.159.3")

    def git(self, *args):
        return subprocess.check_output(["git", "-C", str(self.source), *args], stderr=subprocess.STDOUT)

    def run_import(self, allow_source_advance=False):
        with contextlib.redirect_stdout(io.StringIO()):
            importer.import_source(self.source, self.destination, allow_source_advance=allow_source_advance)

    def test_actual_bytes_deleted_and_untracked_coverage(self):
        (self.source / "deleted.txt").unlink()
        sql = self.source / "codex-rs/state/migrations/new.sql"
        sql.parent.mkdir(parents=True)
        sql.write_bytes(b"SELECT 1;\n")
        cache = self.source / ".ruff_cache"
        cache.mkdir()
        (cache / "ignored").write_text("cache")
        self.run_import()
        record = json.loads((self.destination / "SOURCE.json").read_text())
        self.assertEqual(record["missingTrackedPaths"], ["deleted.txt"])
        self.assertEqual(record["fileCount"], 3)
        self.assertEqual((self.destination / sql.relative_to(self.source)).read_bytes(), b"SELECT 1;\n")
        self.assertFalse((self.destination / ".ruff_cache").exists())
        self.assertEqual(record["files"], importer.snapshot(self.source)["files"])

    def test_nonempty_destination_is_preserved(self):
        self.destination.mkdir()
        sentinel = self.destination / "existing"
        sentinel.write_bytes(b"keep")
        with self.assertRaisesRegex(ValueError, "absent or empty"):
            self.run_import()
        self.assertEqual(sentinel.read_bytes(), b"keep")

    def test_overlap_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "overlap"):
            importer.import_source(self.source, self.source / "engine")

    def test_unknown_ignored_resource_fails_before_copy(self):
        (self.source / "unknown").mkdir()
        (self.source / "unknown/resource").write_bytes(b"required?")
        with self.assertRaisesRegex(ValueError, "Ignored resource"):
            self.run_import()
        self.assertFalse(self.destination.exists())

    def test_submodule_fails_before_copy(self):
        head = self.git("rev-parse", "HEAD").decode().strip()
        self.git("update-index", "--add", "--cacheinfo", f"160000,{head},nested")
        with self.assertRaisesRegex(ValueError, "submodule"):
            self.run_import()

    def test_concurrent_change_has_no_success_manifest(self):
        snapshot = importer.snapshot
        calls = 0

        def change_after_copy(root):
            nonlocal calls
            calls += 1
            if calls == 2:
                (root / "LICENSE").write_bytes(b"changed\n")
            return snapshot(root)

        with patch.object(importer, "snapshot", side_effect=change_after_copy):
            with self.assertRaisesRegex(ValueError, "changed during import"):
                self.run_import()
        self.assertFalse((self.destination / "SOURCE.json").exists())
        self.assertTrue((self.destination / "LICENSE").exists())

    def test_windows_git_symlink_placeholder_metadata(self):
        link = self.source / "link"
        link.write_bytes(b"LICENSE")
        blob = self.git("hash-object", "-w", "link").decode().strip()
        self.git("update-index", "--add", "--cacheinfo", f"120000,{blob},link")
        self.run_import()
        record = json.loads((self.destination / "SOURCE.json").read_text())
        self.assertEqual(record["files"]["link"]["kind"], "git-symlink-placeholder")
        self.assertEqual((self.destination / "link").read_bytes(), b"LICENSE")

    def test_check_catches_latest_source_change(self):
        self.run_import()
        with contextlib.redirect_stdout(io.StringIO()):
            importer.check_source(self.source, self.destination)
        (self.source / "LICENSE").write_bytes(b"updated\n")
        with self.assertRaisesRegex(ValueError, "latest source"):
            importer.check_source(self.source, self.destination)

    def test_check_catches_destination_change(self):
        self.run_import()
        (self.destination / "LICENSE").write_bytes(b"damaged\n")
        with self.assertRaisesRegex(ValueError, "Copied source differs"):
            importer.check_source(self.source, self.destination)

    def test_snapshot_check_permits_only_known_build_cache(self):
        self.run_import()
        cache = self.destination / "codex-rs/target/debug"
        cache.mkdir(parents=True)
        (cache / "output.bin").write_bytes(b"build cache")
        with contextlib.redirect_stdout(io.StringIO()):
            importer.check_source(self.source, self.destination, snapshot_only=True)
        (self.destination / "arbitrary-output.bin").write_bytes(b"not an approved cache")
        with self.assertRaisesRegex(ValueError, "Destination coverage differs"):
            importer.check_source(self.source, self.destination, snapshot_only=True)

    def test_source_advance_keeps_verified_before_inventory(self):
        snapshot = importer.snapshot
        calls = 0

        def change_after_verification(root):
            nonlocal calls
            calls += 1
            if calls == 2:
                (root / "LICENSE").write_bytes(b"advanced\n")
            return snapshot(root)

        with patch.object(importer, "snapshot", side_effect=change_after_verification):
            self.run_import(allow_source_advance=True)
        record = json.loads((self.destination / "SOURCE.json").read_text())
        self.assertTrue(record["sourceAdvancedAfterSnapshot"])
        self.assertEqual(record["sourceAdvanceChangedPaths"], ["LICENSE"])
        self.assertEqual(record["acceptancePolicy"], "immutable-snapshot")
        self.assertEqual((self.destination / "LICENSE").read_bytes(), b"license\n")
        with contextlib.redirect_stdout(io.StringIO()):
            importer.check_source(self.source, self.destination, snapshot_only=True)
        with self.assertRaisesRegex(ValueError, "latest source"):
            importer.check_source(self.source, self.destination)

    def test_source_advance_never_permits_copied_byte_mismatch(self):
        original = importer.shutil.copyfileobj

        def corrupt_copy(reader, writer):
            original(reader, writer)
            writer.write(b"bad")

        with patch.object(importer.shutil, "copyfileobj", side_effect=corrupt_copy):
            with self.assertRaisesRegex(ValueError, "Copied source differs"):
                self.run_import(allow_source_advance=True)
        self.assertFalse((self.destination / "SOURCE.json").exists())

    def test_distribution_ignore_adaptation_publishes_original_ide_files(self):
        original = (self.source / ".gitignore").read_bytes() + b".vscode/\n"
        (self.source / ".gitignore").write_bytes(original)
        ide = self.source / ".vscode"
        ide.mkdir()
        for name in ("extensions.json", "launch.json", "settings.json"):
            (ide / name).write_bytes(b"{}\n")
        self.git("add", "-f", ".vscode")
        self.run_import()
        self.assertEqual((self.source / ".gitignore").read_bytes(), original)
        self.assertEqual((self.destination / ".gitignore.upstream").read_bytes(), original)
        self.assertEqual((self.destination / ".gitignore").read_bytes(), original + importer.IGNORE_SUFFIX)
        subprocess.run(["git", "init", "--quiet", self.temp.name], check=True, capture_output=True)
        names = ["engine/.vscode/" + name for name in ("extensions.json", "launch.json", "settings.json")]
        ignored = subprocess.run(["git", "-C", self.temp.name, "check-ignore", "--no-index", *names], capture_output=True)
        self.assertEqual(ignored.returncode, 1, ignored.stdout)
        with contextlib.redirect_stdout(io.StringIO()):
            importer.check_source(self.source, self.destination, snapshot_only=True)

    def test_distribution_adaptation_tampering_and_unknown_metadata_fail(self):
        self.run_import()
        receipt_path = self.destination / "SOURCE.json"
        original_receipt = receipt_path.read_bytes()
        for mutation, expected in (("path", "adaptation paths"), ("extra", "Unexpected distribution metadata")):
            with self.subTest(mutation=mutation):
                receipt = json.loads(original_receipt)
                if mutation == "path":
                    receipt["distributionAdaptation"]["preservedPath"] = "../outside"
                else:
                    receipt["distributionArbitrary"] = {"arbitrary": {}}
                receipt_path.write_text(json.dumps(receipt))
                with self.assertRaisesRegex(ValueError, expected):
                    importer.check_source(self.source, self.destination, snapshot_only=True)
        receipt_path.write_bytes(original_receipt)
        (self.destination / ".gitignore").write_bytes(b"changed adaptation\n")
        with self.assertRaisesRegex(ValueError, "fixed distribution suffix"):
            importer.check_source(self.source, self.destination, snapshot_only=True)

    def queue_fixture(self):
        migration = self.source / importer.QUEUE_MIGRATION
        migration.parent.mkdir(parents=True)
        migration.write_bytes(b"SELECT 1;\n")
        (self.source / ".gitattributes").write_bytes(b"codex-rs/state/**/*.sql text eol=crlf\n")

    def test_queue_distribution_attributes_preserve_original_lf(self):
        self.queue_fixture()
        original = (self.source / ".gitattributes").read_bytes()
        self.run_import()
        self.assertEqual((self.source / ".gitattributes").read_bytes(), original)
        self.assertEqual((self.destination / ".gitattributes").read_bytes(), original)
        self.assertEqual((self.destination / importer.QUEUE_ATTRIBUTES).read_bytes(), importer.QUEUE_ATTRIBUTE_BYTES)
        self.assertEqual((self.destination / importer.QUEUE_MIGRATION).read_bytes(), b"SELECT 1;\n")
        subprocess.run(["git", "init", "--quiet", self.temp.name], check=True, capture_output=True)
        (Path(self.temp.name) / ".gitattributes").write_bytes(b"engine/** -text\n")
        attrs = subprocess.run(["git", "-C", self.temp.name, "check-attr", "text", "--", "engine/" + importer.QUEUE_MIGRATION], capture_output=True, text=True, check=True)
        self.assertIn("text: unset", attrs.stdout)
        path = "engine/" + importer.QUEUE_MIGRATION
        filtered = subprocess.run(["git", "-C", self.temp.name, "hash-object", "--path=" + path, path], capture_output=True, check=True)
        raw = subprocess.run(["git", "-C", self.temp.name, "hash-object", "--no-filters", path], capture_output=True, check=True)
        self.assertEqual(filtered.stdout, raw.stdout)
        with contextlib.redirect_stdout(io.StringIO()):
            importer.check_source(self.source, self.destination, snapshot_only=True)

    def test_queue_distribution_path_metadata_and_byte_tampering_fail(self):
        self.queue_fixture()
        self.run_import()
        receipt_path = self.destination / "SOURCE.json"
        original_receipt = receipt_path.read_bytes()
        for mutation in ("path", "hash", "missing"):
            with self.subTest(mutation=mutation):
                receipt = json.loads(original_receipt)
                if mutation == "path":
                    receipt["distributionFiles"]["../outside"] = receipt["distributionFiles"].pop(importer.QUEUE_ATTRIBUTES)
                elif mutation == "hash":
                    receipt["distributionFiles"][importer.QUEUE_ATTRIBUTES]["sha256"] = "0" * 64
                else:
                    del receipt["distributionFiles"]
                receipt_path.write_text(json.dumps(receipt))
                expected = "Missing required queue" if mutation == "missing" else "Malformed distribution files"
                with self.assertRaisesRegex(ValueError, expected):
                    importer.check_source(self.source, self.destination, snapshot_only=True)
        receipt_path.write_bytes(original_receipt)
        (self.destination / importer.QUEUE_ATTRIBUTES).write_bytes(b"*.sql text\n")
        with self.assertRaisesRegex(ValueError, "attribute overlay differs"):
            importer.check_source(self.source, self.destination, snapshot_only=True)

    def replay_fixture(self, original=REPLAY_ORIGINAL):
        path = self.source / importer.REPLAY_PATH
        path.parent.mkdir(parents=True)
        path.write_bytes(original)

    def test_replay_compile_fix_preserves_original_and_line_endings(self):
        original = REPLAY_ORIGINAL.replace(b"\n", b"\r\n")
        self.replay_fixture(original)
        self.run_import()
        self.assertEqual((self.source / importer.REPLAY_PATH).read_bytes(), original)
        self.assertEqual((self.destination / importer.PRESERVED_REPLAY).read_bytes(), original)
        fixed = (self.destination / importer.REPLAY_PATH).read_bytes()
        self.assertEqual(fixed, importer.replay_fix_bytes(original))
        self.assertEqual(fixed.count(b"root_resume_wait,"), 2)
        self.assertNotIn(b"\n", fixed.replace(b"\r\n", b""))
        with contextlib.redirect_stdout(io.StringIO()):
            importer.check_source(self.source, self.destination, snapshot_only=True)

    def test_already_corrected_replay_has_no_source_adaptation(self):
        original = importer.replay_fix_bytes(REPLAY_ORIGINAL)
        self.replay_fixture(original)
        self.run_import()
        receipt = json.loads((self.destination / "SOURCE.json").read_text())
        self.assertNotIn("sourceFixes", receipt)
        self.assertFalse((self.destination / importer.PRESERVED_REPLAY).exists())
        self.assertEqual((self.destination / importer.REPLAY_PATH).read_bytes(), original)

    def test_replay_fix_rejects_partial_and_ambiguous_anchors(self):
        fixed = importer.replay_fix_bytes(REPLAY_ORIGINAL)
        partial = fixed.replace(b"                            root_resume_wait,\n", b"")
        for original in (partial, REPLAY_ORIGINAL + REPLAY_ORIGINAL):
            with self.assertRaisesRegex(ValueError, "partial or ambiguous"):
                importer.replay_fix_bytes(original)

    def test_replay_metadata_and_changed_preserved_source_are_rejected(self):
        self.replay_fixture()
        self.run_import()
        receipt_path = self.destination / "SOURCE.json"
        baseline = receipt_path.read_bytes()
        for mutation in ("path", "reason"):
            with self.subTest(mutation=mutation):
                receipt = json.loads(baseline)
                if mutation == "path":
                    receipt["sourceFixes"]["../arbitrary"] = receipt["sourceFixes"].pop(importer.REPLAY_PATH)
                else:
                    receipt["sourceFixes"][importer.REPLAY_PATH]["reason"] = "arbitrary fix"
                receipt_path.write_text(json.dumps(receipt))
                with self.assertRaisesRegex(ValueError, "Malformed source fixes|source-fix metadata differs"):
                    importer.check_source(self.source, self.destination, snapshot_only=True)
        changed = REPLAY_ORIGINAL + b"// unexpected source edit\n"
        (self.destination / importer.PRESERVED_REPLAY).write_bytes(changed)
        (self.destination / importer.REPLAY_PATH).write_bytes(importer.replay_fix_bytes(changed))
        receipt = json.loads(baseline)
        receipt["sourceFixes"] = importer.source_fixes_record(changed)
        receipt_path.write_text(json.dumps(receipt))
        with self.assertRaisesRegex(ValueError, "Copied source differs"):
            importer.check_source(self.source, self.destination, snapshot_only=True)

    def state_fixture(self):
        sources = {
            importer.ROOT_WAIT_OLD: b"ALTER TABLE root_resume_reservations ADD COLUMN wait_started_at_ms INTEGER;\nALTER TABLE root_resume_reservations ADD COLUMN wait_ended_at_ms INTEGER;\n",
            importer.STATE_REPAIR_PATH: b"// original repairs\n#[cfg(test)]\nmod tests;\n",
            importer.STATE_SQLITE_PATH: importer.STATE_SQLITE_OLD.encode(),
            importer.STATE_TESTS_PATH: b"// original migration regressions\n",
        }
        for name, data in sources.items():
            path = self.source / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        return sources

    def test_state_correction_renames_sql_exactly_and_preserves_originals(self):
        sources = self.state_fixture()
        self.run_import()
        receipt = json.loads((self.destination / "SOURCE.json").read_text())
        self.assertEqual(set(receipt["sourceFixes"]), importer.STATE_FIX_PATHS)
        self.assertFalse((self.destination / importer.ROOT_WAIT_OLD).exists())
        self.assertEqual((self.destination / importer.ROOT_WAIT_NEW).read_bytes(), sources[importer.ROOT_WAIT_OLD])
        for name, data in sources.items():
            self.assertEqual((self.source / name).read_bytes(), data)
            self.assertEqual((self.destination / (name + ".upstream")).read_bytes(), data)
        self.assertEqual(receipt["files"], importer.snapshot(self.source)["files"])
        with contextlib.redirect_stdout(io.StringIO()):
            importer.check_source(self.source, self.destination, snapshot_only=True)

    def test_state_correction_rejects_partial_recipe_paths_and_sql_changes(self):
        self.state_fixture()
        self.run_import()
        path = self.destination / "SOURCE.json"
        baseline = path.read_bytes()
        for mutation in ("partial", "path"):
            with self.subTest(mutation=mutation):
                receipt = json.loads(baseline)
                if mutation == "partial":
                    del receipt["sourceFixes"][importer.STATE_SQLITE_PATH]
                else:
                    receipt["sourceFixes"][importer.ROOT_WAIT_OLD]["adaptedPath"] = "../arbitrary.sql"
                path.write_text(json.dumps(receipt))
                with self.assertRaisesRegex(ValueError, "complete fixed migration recipe|source-fix metadata differs"):
                    importer.check_source(self.source, self.destination, snapshot_only=True)
        path.write_bytes(baseline)
        sql = self.destination / importer.ROOT_WAIT_NEW
        sql.write_bytes(sql.read_bytes().replace(b"\n", b"\r\n"))
        with self.assertRaisesRegex(ValueError, "fixed compile correction"):
            importer.check_source(self.source, self.destination, snapshot_only=True)


if __name__ == "__main__":
    unittest.main()
