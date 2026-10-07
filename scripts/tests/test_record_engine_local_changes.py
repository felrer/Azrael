"""Local integration must retain import provenance and accept only reviewed bytes."""
import contextlib
import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("recorder", Path(__file__).resolve().parents[1] / "record-engine-local-changes.py")
recorder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recorder)
importer = recorder.importer


class RecorderTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.source, self.baseline, self.repo = root / "source", root / "baseline", root / "repo"
        self.destination = self.repo / "engine"
        self.source.mkdir()
        self.repo.mkdir()
        for repo in (self.source, self.repo):
            self.git(repo, "init", "--quiet")
            self.git(repo, "config", "user.name", "Fixture")
            self.git(repo, "config", "user.email", "fixture@example.invalid")
            self.git(repo, "config", "core.autocrlf", "false")
        self.git(self.source, "remote", "add", "origin", "https://github.com/openai/codex.git")
        for name, data in {".gitignore": b"target/\n", "LICENSE": b"legal\n", "edit.rs": b"original\n", "other.rs": b"untouched\n", "migrations/1.sql": b"SELECT 1;\n", importer.REPLAY_PATH: b"                completed_at,\n                duration_ms,\n            } = turn;\n                            completed_at,\n                            duration_ms,\n                        },\n"}.items():
            path = self.source / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        self.git(self.source, "add", ".")
        self.git(self.source, "commit", "--quiet", "-m", "original")
        self.git(self.source, "tag", "rust-v0.159.3")
        with contextlib.redirect_stdout(io.StringIO()):
            importer.import_source(self.source, self.baseline)
        shutil.copytree(self.baseline, self.destination)
        self.git(self.repo, "add", ".")
        self.git(self.repo, "commit", "--quiet", "-m", "import")
        self.digest = hashlib.sha256((self.baseline / "SOURCE.json").read_bytes()).hexdigest()
        self.original = json.loads((self.baseline / "SOURCE.json").read_bytes())
        (self.destination / "edit.rs").write_bytes(b"reviewed\n")

    def git(self, root, *args):
        return subprocess.check_output(["git", "-C", str(root), *args], stderr=subprocess.STDOUT)

    def record(self, expected=("edit.rs",), digest=None):
        return recorder.record_changes(self.destination, self.baseline, digest or self.digest, expected)

    def receipt(self):
        return json.loads((self.destination / "SOURCE.json").read_bytes())

    def test_records_exact_delta_and_preserves_adaptations(self):
        result = self.record()
        receipt = self.receipt()
        self.assertEqual(receipt["localIntegration"]["originalReceipt"], self.original)
        self.assertEqual(receipt["head"], self.original["head"])
        self.assertEqual(result["repositoryHead"], self.git(self.repo, "rev-parse", "HEAD").decode().strip())
        self.assertEqual(result["sourcePrefix"], "engine")
        self.assertEqual(set(result["changes"]), {"edit.rs"})
        self.assertEqual(receipt["sourceFixes"], self.original["sourceFixes"])
        self.assertEqual(receipt["distributionAdaptation"], self.original["distributionAdaptation"])
        importer.validate_receipt(self.destination, receipt)

    def test_rejects_receipt_hash_delta_path_and_original_metadata_tampering(self):
        self.record()
        good = self.receipt()
        for mutation in ("hash", "path", "delta", "prefix", "original", "original-rehashed", "provenance", "adaptation"):
            with self.subTest(mutation=mutation):
                bad = copy.deepcopy(good)
                if mutation == "hash":
                    bad["files"]["edit.rs"]["sha256"] = "0" * 64
                elif mutation == "path":
                    bad["localIntegration"]["changes"]["../escape.rs"] = bad["localIntegration"]["changes"].pop("edit.rs")
                elif mutation == "delta":
                    bad["localIntegration"]["changes"]["edit.rs"]["after"]["sha256"] = "0" * 64
                elif mutation == "prefix":
                    bad["localIntegration"]["sourcePrefix"] = "../escape"
                elif mutation == "original":
                    bad["localIntegration"]["originalReceipt"]["head"] = "0" * 40
                elif mutation == "original-rehashed":
                    bad["localIntegration"]["originalReceipt"]["head"] = "0" * 40
                    bad["localIntegration"]["originalReceiptSha256"] = hashlib.sha256(importer.canonical(bad["localIntegration"]["originalReceipt"])).hexdigest()
                elif mutation == "provenance":
                    bad["head"] = "0" * 40
                else:
                    bad["sourceFixes"] = {}
                with self.assertRaises(ValueError):
                    importer.validate_receipt(self.destination, bad)

    def test_later_edit_and_adapted_source_change_fail(self):
        self.record()
        (self.destination / "edit.rs").write_bytes(b"later\n")
        with self.assertRaisesRegex(ValueError, "Copied source differs"):
            importer.validate_receipt(self.destination, self.receipt())
        (self.destination / "edit.rs").write_bytes(b"reviewed\n")
        (self.destination / importer.REPLAY_PATH).write_bytes(b"tampered adaptation\n")
        with self.assertRaisesRegex(ValueError, "Adapted source differs"):
            importer.validate_receipt(self.destination, self.receipt())

    def test_additional_missing_untracked_and_sql_changes_fail(self):
        for mode in ("additional", "missing", "untracked", "sql", "cache"):
            with self.subTest(mode=mode):
                path = self.destination / {"additional": "other.rs", "missing": "other.rs", "untracked": "extra.rs", "sql": "migrations/1.sql", "cache": "unknown-cache/data"}[mode]
                old = path.read_bytes() if path.exists() else None
                path.parent.mkdir(parents=True, exist_ok=True)
                if mode == "missing":
                    path.unlink()
                else:
                    path.write_bytes(b"unreviewed\n")
                with self.assertRaises(ValueError):
                    self.record(expected=("edit.rs", "migrations/1.sql") if mode == "sql" else ("edit.rs",))
                if old is None:
                    path.unlink()
                    if mode == "cache":
                        path.parent.rmdir()
                else:
                    path.write_bytes(old)
        self.git(self.repo, "rm", "--cached", "engine/edit.rs")
        with self.assertRaisesRegex(ValueError, "Git-tracked"):
            self.record()

    def test_immutable_baseline_and_anchor_are_required(self):
        with self.assertRaisesRegex(ValueError, "reviewed SHA256"):
            self.record(digest="0" * 64)
        (self.baseline / "other.rs").write_bytes(b"changed baseline\n")
        with self.assertRaisesRegex(ValueError, "Copied source differs"):
            self.record()

    def test_upstream_release_integration_remains_bound_to_original_inventory(self):
        original = copy.deepcopy(self.original)
        original["upstreamIntegration"] = {
            "schema": 1, "baseTag": original["baseTag"], "baseCommit": original["head"],
            "targetTag": "rust-v0.160.0", "targetCommit": "1" * 40,
            "upstreamDeltaSha256": "2" * 64, "integratedInventorySha256": original["inventorySha256"],
        }
        for directory in (self.baseline, self.destination):
            (directory / "SOURCE.json").write_text(json.dumps(original), encoding="utf-8")
        self.digest = hashlib.sha256((self.baseline / "SOURCE.json").read_bytes()).hexdigest()
        self.record()
        receipt = self.receipt()
        self.assertEqual(receipt["upstreamIntegration"], original["upstreamIntegration"])
        self.assertNotEqual(receipt["inventorySha256"], original["inventorySha256"])
        importer.validate_receipt(self.destination, receipt)
        receipt["localIntegration"]["originalReceipt"]["upstreamIntegration"]["integratedInventorySha256"] = "0" * 64
        receipt["localIntegration"]["originalReceiptSha256"] = hashlib.sha256(importer.canonical(receipt["localIntegration"]["originalReceipt"])).hexdigest()
        with self.assertRaisesRegex(ValueError, "Upstream integration inventory"):
            importer.validate_receipt(self.destination, receipt)

    def test_original_receipt_remains_strict_and_rerecord_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "Copied source differs"):
            importer.validate_receipt(self.destination, self.original)
        self.record()
        with self.assertRaisesRegex(ValueError, "still match"):
            self.record()


if __name__ == "__main__":
    unittest.main()
