"""Prevent future removal of source-state invalidation and binary checks."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))
import test_engine_provenance as fixtures


@unittest.skipUnless(os.name == "nt", "Windows metadata reuse")
class SourceStateTests(unittest.TestCase):
    # Reuse the actual importer/receipt fixture and public provenance validator.
    setUp = fixtures.ImportedEngineProvenanceTests.setUp
    tearDown = fixtures.ImportedEngineProvenanceTests.tearDown
    git = fixtures.ImportedEngineProvenanceTests.git
    provenance = fixtures.ImportedEngineProvenanceTests.provenance
    snapshot_and_record = fixtures.ImportedEngineProvenanceTests.snapshot_and_record

    def prepare(self):
        self.snapshot_and_record()
        spec = importlib.util.spec_from_file_location("state_provenance_fixture", fixtures.PROVENANCE)
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)
        self.state = self.fixture / "source-state.json"
        self.environment = patch.dict(os.environ, self.clean_environment, clear=True)
        self.environment.start()
        self.addCleanup(self.environment.stop)

    def verify(self, generation="first"):
        return self.module.verify(self.source, self.engine, source_state=self.state, source_generation=generation)

    def test_same_generation_reuses_source_but_still_checks_binaries(self):
        self.prepare()
        with patch.object(self.module, "snapshot", wraps=self.module.snapshot) as full:
            expected = self.verify()
            self.assertEqual(self.verify(), expected)
            self.assertEqual(full.call_count, 1)
            (self.engine / "azrael-bridge.exe").write_bytes(b"changed binary")
            with self.assertRaisesRegex(ValueError, "binary mismatch"):
                self.verify()
            self.assertEqual(full.call_count, 1)

    def test_changed_file_with_restored_mtime_is_not_reused(self):
        self.prepare()
        self.verify()
        selected = self.source / "tracked.txt"
        before = selected.stat()
        original = selected.read_bytes()
        selected.write_bytes(b"X" * len(original))
        os.utime(selected, ns=(before.st_atime_ns, before.st_mtime_ns))
        with self.assertRaisesRegex(ValueError, "Copied source differs"):
            self.verify()

    def test_handoff_clone_reuses_observation_and_still_rejects_source_changes(self):
        self.prepare()
        expected = self.verify()
        handoff = self.fixture / "handoff.json"
        consumer = self.fixture / "consumer.json"
        helper = Path(__file__).parents[1] / "engine-source-handoff.cjs"
        common = ["--handoff", str(handoff), "--token", "same-attempt", "--release", str(self.engine)]
        for arguments in (["publish", *common, "--state", str(self.state), "--generation", "first"],
                          ["consume", *common, "--destination", str(consumer)]):
            result = subprocess.run(["node", str(helper), *arguments], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue(json.loads(result.stdout)["usable"])
        original_state = self.state.read_bytes()
        with patch.object(self.module, "snapshot", wraps=self.module.snapshot) as full:
            self.assertEqual(self.module.verify(self.source, self.engine, source_state=consumer, source_generation="first"), expected)
            self.assertEqual(full.call_count, 0)
            (self.source / "tracked.txt").write_bytes(b"changed source")
            with self.assertRaisesRegex(ValueError, "Copied source differs"):
                self.module.verify(self.source, self.engine, source_state=consumer, source_generation="first")
            self.assertEqual(full.call_count, 1)
        self.assertEqual(self.state.read_bytes(), original_state)

    def test_generation_and_corrupt_state_require_full_validation(self):
        self.prepare()
        with patch.object(self.module, "snapshot", wraps=self.module.snapshot) as full:
            self.verify()
            self.verify("next")
            self.assertEqual(full.call_count, 2)
            self.state.write_text("not json")
            self.verify("next")
            self.assertEqual(full.call_count, 3)

    def test_added_input_and_receipt_change_invalidate(self):
        self.prepare()
        self.verify()
        (self.source / "unexpected.txt").write_text("new input")
        with self.assertRaisesRegex(ValueError, "coverage differs"):
            self.verify()
        (self.source / "unexpected.txt").unlink()
        self.verify()
        receipt = self.source / "SOURCE.json"
        value = json.loads(receipt.read_text())
        value["head"] = "f" * 40
        receipt.write_text(json.dumps(value))
        with self.assertRaises(ValueError):
            self.verify()

    def test_identical_root_replacement_requires_full_validation(self):
        self.prepare()
        self.verify()
        original = self.source.with_name("previous-source")
        self.source.rename(original)
        import shutil
        shutil.copytree(original, self.source)
        with patch.object(self.module, "snapshot", wraps=self.module.snapshot) as full:
            self.verify()
            self.assertEqual(full.call_count, 1)

    def test_metadata_uncertainty_keeps_original_full_path(self):
        self.prepare()
        # A Git source is intentionally outside the scoped imported-source fast path.
        with patch.object(self.module, "snapshot", wraps=self.module.snapshot) as full:
            self.module.source_snapshot(self.original, self.module.TARGET, self.state, "first")
            self.module.source_snapshot(self.original, self.module.TARGET, self.state, "first")
            self.assertEqual(full.call_count, 2)

    def test_environment_change_rechecks_and_rejects_old_bundle(self):
        self.prepare()
        self.verify()
        with patch.dict(os.environ, {"RUSTFLAGS": "changed-build-flag"}):
            with patch.object(self.module, "snapshot", wraps=self.module.snapshot) as full:
                with self.assertRaisesRegex(ValueError, "source changed"):
                    self.verify()
                self.assertEqual(full.call_count, 1)

    def test_change_during_full_validation_cannot_publish(self):
        self.prepare()
        original = self.module.snapshot

        def changed(*args):
            value = original(*args)
            (self.source / "tracked.txt").write_text("changed after content check")
            return value

        with patch.object(self.module, "snapshot", side_effect=changed):
            with self.assertRaisesRegex(ValueError, "during full validation"):
                self.verify()
        self.assertFalse(self.state.exists())

    def test_real_package_entrypoint_shares_state_and_keeps_standalone(self):
        import contextlib
        import io
        import zipfile
        cargo = self.original / "codex-rs/Cargo.toml"
        cargo.parent.mkdir()
        cargo.write_text('[workspace.package]\nversion = "0.162.0"\n')
        subprocess.run(["git", "-C", str(self.original), "add", "."], check=True, capture_output=True)
        subprocess.run(["git", "-C", str(self.original), "commit", "-m", "package fixture"], check=True, capture_output=True)
        self.source = self.fixture / "package-source"
        with contextlib.redirect_stdout(io.StringIO()):
            self.importer.import_source(self.original, self.source, allow_source_advance=True)
        self.prepare()
        self.verify()
        vsix = self.fixture / "companion.vsix"
        with zipfile.ZipFile(vsix, "w") as archive:
            archive.writestr("extension/package.json", json.dumps({"publisher": "azrael-ex-local", "name": "azrael-ex", "version": "0.3.0"}))
        import shutil
        pwsh = os.environ.get("AZRAEL_SOURCE_STATE_PWSH") or shutil.which("pwsh")
        if not pwsh:
            self.skipTest("PowerShell 7 required for the packaging entry fixture")
        arguments = [pwsh, "-NoProfile", "-File", str(fixtures.PROJECT_ROOT / "scripts/package-azrael.ps1"),
                     "-EnginePath", str(self.engine / "azrael.exe"), "-BridgePath", str(self.engine / "azrael-bridge.exe"),
                     "-CompanionVsixPath", str(vsix), "-SourceRoot", str(self.source), "-RetainedSourceRoot", str(self.source)]
        environment = self.clean_environment.copy()
        environment["PATH"] = str(Path(sys.executable).parent) + os.pathsep + environment["PATH"]
        result = subprocess.run(arguments + ["-OutputDirectory", str(self.fixture / "cached-package"), "-SourceStatePath", str(self.state), "-SourceGeneration", "first"], env=environment, encoding="utf-8", capture_output=True)
        (self.fixture / "cached-package-console.log").write_text(result.stdout + result.stderr, encoding="utf-8")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(result.stderr.count("source-state: reused"), 4)
        self.assertTrue((self.fixture / "cached-package/build-info.json").is_file())
        result = subprocess.run(arguments + ["-OutputDirectory", str(self.fixture / "standalone-package")], env=environment, encoding="utf-8", capture_output=True)
        (self.fixture / "standalone-package-console.log").write_text(result.stdout + result.stderr, encoding="utf-8")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertNotIn("source-state:", result.stderr)


if __name__ == "__main__":
    unittest.main()
