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
from unittest import mock

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

    def current_digest(self):
        return hashlib.sha256((self.destination / "SOURCE.json").read_bytes()).hexdigest()

    def add_module(self, name="new.rs"):
        path = self.destination / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"pub fn reviewed() {}\n")
        self.git(self.repo, "add", "engine/" + name)

    def update(self, expected, digest=None):
        return recorder.record_changes(self.destination, self.baseline, self.digest, expected,
                                       digest or self.current_digest())

    def test_additions_and_update_preserve_original_and_prior_reviews(self):
        self.record()
        prior = self.receipt()
        self.assertEqual(prior["localIntegration"]["schema"], 1)
        self.add_module("nested/new.rs")
        (self.destination / "other.rs").write_bytes(b"second review\n")
        self.update(("nested/new.rs", "other.rs"))
        receipt = self.receipt()
        self.assertEqual(receipt["localIntegration"]["schema"], 2)
        self.assertEqual(receipt["localIntegration"]["originalReceipt"], self.original)
        self.assertEqual(receipt["localIntegration"]["changes"]["edit.rs"], prior["localIntegration"]["changes"]["edit.rs"])
        self.assertIsNone(receipt["localIntegration"]["changes"]["nested/new.rs"]["before"])
        self.assertEqual(receipt["inventoryCount"], self.original["inventoryCount"] + 1)
        importer.validate_receipt(self.destination, receipt)
        (self.destination / "nested/new.rs").write_bytes(b"pub fn reviewed_again() {}\n")
        self.update(("nested/new.rs",))
        importer.validate_receipt(self.destination, self.receipt())
        self.assertIsNone(self.receipt()["localIntegration"]["changes"]["nested/new.rs"]["before"])
        self.add_module("another.rs")
        self.update(("another.rs",))
        importer.validate_receipt(self.destination, self.receipt())

    def test_initial_addition_and_schema1_compatibility(self):
        self.add_module()
        self.record(("edit.rs", "new.rs"))
        receipt = self.receipt()
        importer.validate_receipt(self.destination, receipt)
        receipt["localIntegration"]["schema"] = 1
        with self.assertRaisesRegex(ValueError, "cannot add"):
            importer.validate_receipt(self.destination, receipt)

    def test_reviewed_prompt_addition_preserves_provenance(self):
        name = "codex-rs/prompts/templates/agent_behavior.md"
        self.add_module(name)
        (self.destination / name).write_text("Shared agent behavior.\n", encoding="utf-8")
        self.record(("edit.rs", name))
        receipt = self.receipt()
        self.assertEqual(receipt["localIntegration"]["schema"], 2)
        self.assertEqual(receipt["localIntegration"]["originalReceipt"], self.original)
        self.assertIsNone(receipt["localIntegration"]["changes"][name]["before"])
        importer.validate_receipt(self.destination, receipt)
        (self.destination / name).write_text("Updated shared agent behavior.\n", encoding="utf-8")
        self.update((name,))
        importer.validate_receipt(self.destination, self.receipt())

    def test_reviewed_source_addition_path_scope(self):
        for name in ("new.md", "codex-rs/prompts/agent_behavior.md",
                     "codex-rs/prompts/templates-other/agent_behavior.md",
                     "codex-rs/prompts/templates/agent_behavior.sql"):
            with self.subTest(name=name):
                self.add_module(name)
                with self.assertRaisesRegex(ValueError, "Rust/prompt source"):
                    self.record(("edit.rs", name))
                self.git(self.repo, "rm", "--cached", "engine/" + name)
                (self.destination / name).unlink()

    def test_explicit_adapted_content_update_preserves_fixed_provenance(self):
        path = self.destination / importer.REPLAY_PATH
        fixed = path.read_bytes()
        path.write_bytes(fixed + b"// reviewed inherited content\n")
        with self.assertRaisesRegex(ValueError, "Reviewed adapted delta differs"):
            self.record()
        recorder.record_changes(self.destination, self.baseline, self.digest, ("edit.rs",),
                                expected_adapted_paths=(importer.REPLAY_PATH,))
        receipt = self.receipt()
        self.assertEqual(receipt["localIntegration"]["schema"], 3)
        self.assertEqual(receipt["sourceFixes"], self.original["sourceFixes"])
        self.assertEqual(receipt["files"][importer.REPLAY_PATH], self.original["files"][importer.REPLAY_PATH])
        original_before = receipt["localIntegration"]["adaptedChanges"][importer.REPLAY_PATH]["before"]
        self.assertEqual(original_before["sha256"], hashlib.sha256(fixed).hexdigest())
        importer.validate_receipt(self.destination, receipt)
        path.write_bytes(fixed + b"// second explicit content review\n")
        recorder.record_changes(self.destination, self.baseline, self.digest, (), self.current_digest(),
                                (importer.REPLAY_PATH,))
        self.assertEqual(self.receipt()["localIntegration"]["adaptedChanges"][importer.REPLAY_PATH]["before"], original_before)
        self.add_module()
        self.update(("new.rs",))
        importer.validate_receipt(self.destination, self.receipt())
        path.write_bytes(b"unreviewed subsequent drift\n")
        with self.assertRaisesRegex(ValueError, "Reviewed adapted source differs"):
            importer.validate_receipt(self.destination, self.receipt())

    def test_adapted_only_record_and_metadata_tampering_are_rejected(self):
        (self.destination / "edit.rs").write_bytes(b"original\n")
        path = self.destination / importer.REPLAY_PATH
        path.write_bytes(path.read_bytes() + b"// explicit content delta\n")
        recorder.record_changes(self.destination, self.baseline, self.digest, (),
                                expected_adapted_paths=(importer.REPLAY_PATH,))
        good = self.receipt()
        importer.validate_receipt(self.destination, good)
        self.assertEqual(good["localIntegration"]["changes"], {})
        for mutation in ("before", "after", "mode", "permissions", "path", "schema", "fix"):
            with self.subTest(mutation=mutation):
                bad = copy.deepcopy(good)
                change = bad["localIntegration"]["adaptedChanges"][importer.REPLAY_PATH]
                if mutation in ("before", "after"):
                    change[mutation]["sha256"] = "0" * 64
                elif mutation == "mode":
                    change["after"]["gitMode"] = "100755"
                elif mutation == "permissions":
                    change["after"]["permissions"] += 1
                elif mutation == "path":
                    bad["localIntegration"]["adaptedChanges"]["edit.rs"] = bad["localIntegration"]["adaptedChanges"].pop(importer.REPLAY_PATH)
                elif mutation == "schema":
                    bad["localIntegration"]["schema"] = 2
                else:
                    bad["sourceFixes"][importer.REPLAY_PATH]["adaptedSha256"] = "0" * 64
                with self.assertRaises(ValueError):
                    importer.validate_receipt(self.destination, bad)
        preserved = self.destination / (importer.REPLAY_PATH + ".upstream")
        preserved.write_bytes(preserved.read_bytes() + b"// changed immutable upstream\n")
        with self.assertRaises(ValueError):
            importer.validate_receipt(self.destination, good)

    def test_adapted_paths_are_explicit_unique_and_mode_protected(self):
        path = self.destination / importer.REPLAY_PATH
        path.write_bytes(path.read_bytes() + b"// changed\n")
        for expected in (("edit.rs",), (importer.REPLAY_PATH, importer.REPLAY_PATH), ("migrations/1.sql",)):
            with self.subTest(expected=expected), self.assertRaises(ValueError):
                recorder.record_changes(self.destination, self.baseline, self.digest, ("edit.rs",),
                                        expected_adapted_paths=expected)
        self.git(self.repo, "update-index", "--chmod=+x", "engine/" + importer.REPLAY_PATH)
        with self.assertRaises(ValueError):
            recorder.record_changes(self.destination, self.baseline, self.digest, ("edit.rs",),
                                    expected_adapted_paths=(importer.REPLAY_PATH,))
        self.git(self.repo, "update-index", "--chmod=-x", "engine/" + importer.REPLAY_PATH)
        self.git(self.repo, "update-index", "--chmod=+x", "engine/" + importer.REPLAY_PATH + ".upstream")
        with self.assertRaisesRegex(ValueError, "Unreviewed preserved source"):
            recorder.record_changes(self.destination, self.baseline, self.digest, ("edit.rs",),
                                    expected_adapted_paths=(importer.REPLAY_PATH,))

    def test_update_requires_prior_review_anchor_and_exact_new_delta(self):
        self.record()
        prior_bytes = (self.destination / "SOURCE.json").read_bytes()
        self.add_module()
        (self.destination / "other.rs").write_bytes(b"unreviewed\n")
        for expected, digest in ((("new.rs",), None), (("new.rs", "other.rs", "edit.rs"), None),
                                 (("new.rs", "other.rs"), "0" * 64)):
            with self.subTest(expected=expected, digest=digest), self.assertRaises(ValueError):
                self.update(expected, digest)
            self.assertEqual((self.destination / "SOURCE.json").read_bytes(), prior_bytes)
        self.update(("new.rs", "other.rs"))
        (self.destination / "new.rs").write_bytes(b"stale\n")
        with self.assertRaisesRegex(ValueError, "Copied source differs"):
            importer.validate_receipt(self.destination, self.receipt())

    def test_addition_modes_types_and_untracked_source_are_rejected(self):
        prompt = "codex-rs/prompts/templates/agent_behavior.md"
        for name in ("new.rs", "new.sql", "new.txt", prompt):
            with self.subTest(name=name):
                self.add_module(name)
                if name in ("new.rs", prompt):
                    self.git(self.repo, "update-index", "--chmod=+x", "engine/" + name)
                with self.assertRaises(ValueError):
                    self.record(("edit.rs", name))
                self.git(self.repo, "rm", "--cached", "engine/" + name)
                (self.destination / name).unlink()
        (self.destination / "new.rs").write_bytes(b"untracked\n")
        with self.assertRaisesRegex(ValueError, "Git-tracked"):
            self.record(("edit.rs", "new.rs"))
        (self.destination / "new.rs").unlink()
        (self.destination / prompt).write_bytes(b"untracked prompt\n")
        with self.assertRaisesRegex(ValueError, "Git-tracked"):
            self.record(("edit.rs", prompt))

    def test_update_rejects_sql_modes_and_adaptation_changes(self):
        self.record()
        for name in ("migrations/1.sql", ".gitignore", importer.REPLAY_PATH):
            with self.subTest(name=name):
                path = self.destination / name
                old = path.read_bytes()
                path.write_bytes(b"not reviewed adaptation\n")
                with self.assertRaises(ValueError):
                    self.update((name,))
                path.write_bytes(old)
        (self.destination / "other.rs").write_bytes(b"second review\n")
        self.git(self.repo, "update-index", "--chmod=+x", "engine/other.rs")
        with self.assertRaisesRegex(ValueError, "original mode"):
            self.update(("other.rs",))

    def test_inputs_are_rechecked_before_publishing(self):
        original_validate = importer.validate_receipt
        calls = 0
        def mutate_after_validation(destination, receipt, **kwargs):
            nonlocal calls
            result = original_validate(destination, receipt, **kwargs)
            calls += 1
            if calls == 2:
                self.git(self.repo, "update-index", "--chmod=+x", "engine/edit.rs")
            return result
        with mock.patch.object(importer, "validate_receipt", side_effect=mutate_after_validation):
            with self.assertRaisesRegex(ValueError, "index changed"):
                self.record()
        self.assertEqual(self.receipt(), self.original)

    def test_unchanged_imported_executable_accepts_committed_mode_normalization(self):
        # Model a Windows import whose primary Git tree normalized an upstream executable.
        self.original["files"]["other.rs"]["gitMode"] = "100755"
        self.original["inventorySha256"] = hashlib.sha256(importer.canonical(self.original["files"])).hexdigest()
        for directory in (self.baseline, self.destination):
            (directory / "SOURCE.json").write_text(json.dumps(self.original), encoding="utf-8")
        self.digest = hashlib.sha256((self.baseline / "SOURCE.json").read_bytes()).hexdigest()
        self.assertEqual(self.git(self.repo, "ls-tree", "HEAD", "engine/other.rs").decode().split()[0], "100644")
        self.record()
        self.assertEqual(self.receipt()["files"]["other.rs"]["gitMode"], "100755")
        importer.validate_receipt(self.destination, self.receipt())
        self.add_module()
        # Even matching the upstream mode is an unreviewed change since the primary HEAD.
        self.git(self.repo, "update-index", "--chmod=+x", "engine/other.rs")
        with self.assertRaisesRegex(ValueError, "Unreviewed Git index mode change"):
            self.update(("new.rs",))

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
        with self.assertRaisesRegex(ValueError, "reviewed SHA256"):
            self.record()


if __name__ == "__main__":
    unittest.main()
