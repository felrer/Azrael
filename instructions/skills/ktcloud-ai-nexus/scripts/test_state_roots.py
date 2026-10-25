"""Artifact-free regression coverage for private record root selection."""

import os
import unittest
from pathlib import Path
from unittest.mock import patch

import validate_session_records as records


class StateRootTests(unittest.TestCase):
    def test_repository_root_keeps_records_private(self):
        with patch.dict(os.environ, {}, clear=True):
            root = records.resolve_state_root()
        self.assertEqual(root, Path(__file__).resolve().parents[3] / ".private" / "ktcloud-ai-nexus" / "state")

    def test_explicit_available_root(self):
        chosen = Path(__file__).resolve().parent
        with patch.dict(os.environ, {"AZRAEL_KTCLOUD_STATE_ROOT": str(chosen)}, clear=True):
            self.assertEqual(records.resolve_state_root(), chosen)

    def test_invalid_explicit_root_never_falls_back(self):
        for value in ("", "relative-root"):
            with self.subTest(value=value), patch.dict(os.environ, {"AZRAEL_KTCLOUD_STATE_ROOT": value}, clear=True):
                with self.assertRaises(ValueError):
                    records.resolve_state_root()
        with patch.dict(os.environ, {"AZRAEL_KTCLOUD_STATE_ROOT": str(Path.home() / "missing-records")}, clear=True), patch.object(Path, "is_dir", return_value=False):
            with self.assertRaises(ValueError):
                records.resolve_state_root()

    def test_installed_root_uses_isolated_home(self):
        code_file = Path.home() / "installed" / "ktcloud-ai-nexus" / "scripts" / "validate_session_records.py"
        chosen_home = Path.home() / "isolated-azrael"
        with patch.object(records, "__file__", str(code_file)), patch.dict(os.environ, {"CODEX_HOME": str(chosen_home)}, clear=True):
            self.assertEqual(records.resolve_state_root(), chosen_home / "azrael" / "skills" / "ktcloud-ai-nexus" / "state")

    def test_relative_codex_home_is_rejected(self):
        code_file = Path.home() / "installed" / "ktcloud-ai-nexus" / "scripts" / "validate_session_records.py"
        with patch.object(records, "__file__", str(code_file)), patch.dict(os.environ, {"CODEX_HOME": "relative-home"}, clear=True):
            with self.assertRaises(ValueError):
                records.resolve_state_root()


if __name__ == "__main__":
    unittest.main()
