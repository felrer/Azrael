"""Contract tests for engine source and binary provenance receipts."""

from __future__ import annotations

import json
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


if __name__ == "__main__":
    unittest.main()
