"""Contract tests for engine source and binary provenance receipts."""

from __future__ import annotations

import json
import contextlib
import importlib.util
import io
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


PROJECT_ROOT = Path(__file__).resolve().parents[2]
PROVENANCE = PROJECT_ROOT / "scripts" / "engine-provenance.py"
FIXTURE_ROOT = PROJECT_ROOT / "artifacts" / "verification"
BUILD_ENVIRONMENT_KEYS = (
    "RUSTFLAGS",
    "CARGO_ENCODED_RUSTFLAGS",
    "RUSTC_WRAPPER",
    "RUSTUP_TOOLCHAIN",
)


class EngineProvenanceTests(unittest.TestCase):
    def setUp(self) -> None:
        FIXTURE_ROOT.mkdir(parents=True, exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(
            prefix="engine-provenance-", dir=FIXTURE_ROOT
        )
        self.fixture = Path(self.temporary.name)
        self.source = self.fixture / "source"
        self.engine = self.fixture / "engine"
        self.source.mkdir()
        self.engine.mkdir()

        self.git("init", "--quiet")
        self.git("config", "user.email", "provenance-test@example.invalid")
        self.git("config", "user.name", "Provenance Test")
        (self.source / ".gitignore").write_text("ignored.txt\n", encoding="utf-8")
        (self.source / "tracked.txt").write_text("tracked source\n", encoding="utf-8")
        self.git("add", ".gitignore", "tracked.txt")
        self.git("commit", "--quiet", "-m", "fixture baseline")
        (self.source / "untracked.txt").write_text("untracked source\n", encoding="utf-8")
        (self.engine / "codex.exe").write_bytes(b"codex fixture\x00")
        (self.engine / "azrael-bridge.exe").write_bytes(b"bridge fixture\x00")
        (self.engine / "codex-code-mode-host.exe").write_bytes(b"code mode fixture\x00")

        self.snapshot_file = self.fixture / "source-before.json"
        self.clean_environment = os.environ.copy()
        for key in BUILD_ENVIRONMENT_KEYS:
            self.clean_environment.pop(key, None)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def git(self, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["git", "-C", str(self.source), *args],
            check=True,
            capture_output=True,
            text=True,
        )

    def provenance(
        self, action: str, *, env: dict[str, str] | None = None
    ) -> subprocess.CompletedProcess[str]:
        arguments = [
            "python",
            "-B",
            str(PROVENANCE),
            action,
            "--root",
            str(self.source),
        ]
        if action in ("snapshot", "record"):
            arguments.extend(("--file", str(self.snapshot_file)))
        if action in ("record", "verify"):
            arguments.extend(("--engine-dir", str(self.engine)))
        if action == "record":
            arguments.extend(
                ("--code-mode-host-source", str(self.engine / "codex-code-mode-host.exe"))
            )
        return subprocess.run(
            arguments,
            check=False,
            capture_output=True,
            text=True,
            env=env or self.clean_environment,
        )

    def snapshot_and_record(self) -> None:
        snapshot = self.provenance("snapshot")
        self.assertEqual(snapshot.returncode, 0, snapshot.stderr)
        record = self.provenance("record")
        self.assertEqual(record.returncode, 0, record.stderr)

    def assert_verify_rejected(self, expected: str) -> None:
        result = self.provenance("verify")
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertIn(expected, result.stderr)

    def test_unchanged_source_and_binaries_are_accepted(self) -> None:
        self.snapshot_and_record()

        result = self.provenance("verify")

        self.assertEqual(result.returncode, 0, result.stderr)
        receipt = json.loads(result.stdout)
        self.assertEqual(receipt["source"]["fileCount"], 3)
        self.assertEqual(
            set(receipt["binaries"]),
            {"codex.exe", "azrael-bridge.exe", "codex-code-mode-host.exe"},
        )
        self.assertEqual(
            receipt["externalRuntimes"]["codeModeHost"]["sha256"],
            receipt["binaries"]["codex-code-mode-host.exe"],
        )

    def test_tracked_edit_is_rejected(self) -> None:
        self.snapshot_and_record()
        (self.source / "tracked.txt").write_text("edited\n", encoding="utf-8")

        self.assert_verify_rejected("source changed")

    def test_untracked_nonignored_addition_is_rejected(self) -> None:
        self.snapshot_and_record()
        (self.source / "new-source.txt").write_text("new\n", encoding="utf-8")

        self.assert_verify_rejected("source changed")

    def test_tracked_deletion_is_rejected(self) -> None:
        self.snapshot_and_record()
        (self.source / "tracked.txt").unlink()

        self.assert_verify_rejected("source changed")

    def test_build_environment_change_is_rejected(self) -> None:
        self.snapshot_and_record()
        changed_environment = self.clean_environment.copy()
        changed_environment["RUSTFLAGS"] = "-Ctarget-cpu=native"

        result = self.provenance("verify", env=changed_environment)

        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertIn("source changed", result.stderr)

    def test_binary_mismatch_is_rejected(self) -> None:
        self.snapshot_and_record()
        (self.engine / "azrael-bridge.exe").write_bytes(b"different bridge")

        self.assert_verify_rejected("binary mismatch: azrael-bridge.exe")

    def test_missing_receipt_is_rejected(self) -> None:
        self.assert_verify_rejected("no source provenance")

    def test_source_change_during_build_is_rejected(self) -> None:
        snapshot = self.provenance("snapshot")
        self.assertEqual(snapshot.returncode, 0, snapshot.stderr)
        (self.source / "untracked.txt").write_text("changed mid-build\n", encoding="utf-8")

        record = self.provenance("record")

        self.assertNotEqual(record.returncode, 0, record.stdout)
        self.assertIn("Source changed during engine build", record.stderr)
        self.assertFalse((self.engine / "azrael-engine-build.json").exists())

    def test_head_change_is_rejected(self) -> None:
        self.snapshot_and_record()
        (self.source / "tracked.txt").write_text("new commit\n", encoding="utf-8")
        self.git("add", "tracked.txt")
        self.git("commit", "--quiet", "-m", "advance head")

        self.assert_verify_rejected("source changed")

    def test_ignored_addition_does_not_change_provenance(self) -> None:
        self.snapshot_and_record()
        (self.source / "ignored.txt").write_text("build output\n", encoding="utf-8")

        result = self.provenance("verify")

        self.assertEqual(result.returncode, 0, result.stderr)


class ImportedEngineProvenanceTests(unittest.TestCase):
    git = EngineProvenanceTests.git
    provenance = EngineProvenanceTests.provenance
    snapshot_and_record = EngineProvenanceTests.snapshot_and_record
    assert_verify_rejected = EngineProvenanceTests.assert_verify_rejected
    tearDown = EngineProvenanceTests.tearDown

    def setUp(self):
        EngineProvenanceTests.setUp(self)
        self.git("remote", "add", "origin", "https://github.com/openai/codex.git")
        (self.source / "deleted.txt").write_bytes(b"inherited deletion\n")
        self.git("add", "deleted.txt")
        self.git("commit", "--quiet", "-m", "deleted fixture")
        self.git("tag", "rust-v0.159.3")
        (self.source / "deleted.txt").unlink()
        spec = importlib.util.spec_from_file_location(
            "import_engine_fixture", PROJECT_ROOT / "scripts/import-engine-source.py")
        helper = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(helper)
        self.importer = helper
        self.original = self.source
        self.imported = self.fixture / "imported"
        with contextlib.redirect_stdout(io.StringIO()):
            helper.import_source(self.original, self.imported, allow_source_advance=True)
        self.source = self.imported

    def test_imported_source_uses_original_head_and_distinct_schema(self):
        self.snapshot_and_record()
        result = self.provenance("verify")
        self.assertEqual(result.returncode, 0, result.stderr)
        source = json.loads(result.stdout)["source"]
        receipt = json.loads((self.source / "SOURCE.json").read_text())
        self.assertEqual(source["schema"], 2)
        self.assertEqual(source["head"], receipt["head"])
        self.assertEqual(source["importedInventorySha256"], receipt["inventorySha256"])
        self.assertEqual(source["fileCount"], 4)

    def test_parent_git_changes_do_not_affect_imported_fingerprint(self):
        def parent_git(*args):
            subprocess.run(["git", "-C", str(self.fixture), *args], check=True, capture_output=True)
        parent_git("init", "--quiet")
        parent_git("config", "user.name", "Parent fixture")
        parent_git("config", "user.email", "parent@example.invalid")
        (self.fixture / "parent.txt").write_bytes(b"parent\n")
        parent_git("add", "parent.txt")
        parent_git("commit", "--quiet", "-m", "parent baseline")
        self.snapshot_and_record()
        (self.fixture / "parent.txt").write_bytes(b"parent advanced\n")
        parent_git("add", "parent.txt")
        parent_git("commit", "--quiet", "-m", "advance parent")
        result = self.provenance("verify")
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_imported_source_edit_is_rejected(self):
        self.snapshot_and_record()
        (self.source / "tracked.txt").write_bytes(b"changed\n")
        self.assert_verify_rejected("Copied source differs")

    def test_imported_source_deletion_is_rejected(self):
        self.snapshot_and_record()
        (self.source / "tracked.txt").unlink()
        self.assert_verify_rejected("Destination coverage differs")

    def test_imported_source_addition_even_if_ignored_is_rejected(self):
        self.snapshot_and_record()
        (self.source / "ignored.txt").write_bytes(b"unapproved ignored content\n")
        self.assert_verify_rejected("Destination coverage differs")

    def test_recorded_missing_path_reappearance_is_rejected(self):
        self.snapshot_and_record()
        (self.source / "deleted.txt").write_bytes(b"resurrected\n")
        self.assert_verify_rejected("Destination coverage differs")

    def test_known_target_cache_is_permitted(self):
        self.snapshot_and_record()
        target = self.source / "codex-rs/target/debug"
        target.mkdir(parents=True)
        (target / "build-cache.bin").write_bytes(b"build output\n")
        result = self.provenance("verify")
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_receipt_malformed_schema_digest_and_escape_are_rejected(self):
        path = self.source / "SOURCE.json"
        original = path.read_bytes()
        for mutation, expected in (("schema", "schema"), ("digest", "digest"), ("path", "Unsafe source path")):
            with self.subTest(mutation=mutation):
                receipt = json.loads(original)
                if mutation == "schema":
                    receipt["schema"] = 99
                elif mutation == "digest":
                    receipt["inventorySha256"] = "0" * 64
                else:
                    receipt["files"]["../outside.txt"] = receipt["files"]["tracked.txt"]
                path.write_text(json.dumps(receipt))
                result = self.provenance("snapshot")
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(expected, result.stderr)
        path.write_bytes(original)

    def test_receipt_metadata_change_invalidates_existing_build(self):
        self.snapshot_and_record()
        path = self.source / "SOURCE.json"
        receipt = json.loads(path.read_text())
        receipt["snapshotCapturedUtc"] = "changed"
        path.write_text(json.dumps(receipt))
        self.assert_verify_rejected("source changed")

    def test_preserved_original_ignore_edit_invalidates_imported_source(self):
        self.snapshot_and_record()
        (self.source / ".gitignore.upstream").write_bytes(b"changed original\n")
        self.assert_verify_rejected("Distribution adaptation metadata differs")

    def test_distribution_ignore_edit_invalidates_imported_source(self):
        self.snapshot_and_record()
        (self.source / ".gitignore").write_bytes(b"changed distribution\n")
        self.assert_verify_rejected("fixed distribution suffix")

    def queue_import(self):
        migration = self.original / self.importer.QUEUE_MIGRATION
        migration.parent.mkdir(parents=True)
        migration.write_bytes(b"SELECT 1;\n")
        imported = self.fixture / "with-queue"
        with contextlib.redirect_stdout(io.StringIO()):
            self.importer.import_source(self.original, imported, allow_source_advance=True)
        self.source = imported

    def test_distribution_attribute_overlay_is_bound_and_tampering_rejected(self):
        self.queue_import()
        self.snapshot_and_record()
        result = self.provenance("verify")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("distributionFilesSha256", json.loads(result.stdout)["source"])
        (self.source / self.importer.QUEUE_ATTRIBUTES).write_bytes(b"*.sql text\n")
        self.assert_verify_rejected("attribute overlay differs")

    def test_distribution_attribute_metadata_tampering_is_rejected(self):
        self.queue_import()
        self.snapshot_and_record()
        path = self.source / "SOURCE.json"
        receipt = json.loads(path.read_text())
        receipt["distributionFiles"][self.importer.QUEUE_ATTRIBUTES]["size"] += 1
        path.write_text(json.dumps(receipt))
        self.assert_verify_rejected("Malformed distribution files")

    def test_replay_source_fix_is_bound_and_changed_adapted_bytes_fail(self):
        original = (b"                completed_at,\n                duration_ms,\n            } = turn;\n"
                    b"                            completed_at,\n                            duration_ms,\n                        },\n")
        replay = self.original / self.importer.REPLAY_PATH
        replay.parent.mkdir(parents=True)
        replay.write_bytes(original)
        imported = self.fixture / "with-replay"
        with contextlib.redirect_stdout(io.StringIO()):
            self.importer.import_source(self.original, imported, allow_source_advance=True)
        self.source = imported
        self.snapshot_and_record()
        result = self.provenance("verify")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("sourceFixesSha256", json.loads(result.stdout)["source"])
        (self.source / self.importer.REPLAY_PATH).write_bytes(b"arbitrary correction\n")
        self.assert_verify_rejected("fixed compile correction")

    def test_missing_receipt_does_not_fall_back_to_parent_git(self):
        (self.source / "SOURCE.json").unlink()
        result = self.provenance("snapshot")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("not a Git worktree root", result.stderr)


if __name__ == "__main__":
    unittest.main()
