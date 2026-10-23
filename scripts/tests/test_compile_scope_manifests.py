"""Bounded regression checks for approved compile-scope manifest exceptions."""

import copy
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location(
    "workspace_manifests",
    Path(__file__).resolve().parents[2]
    / "engine/.github/scripts/verify_cargo_workspace_manifests.py",
)
policy = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(policy)


class CompileScopePolicyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.internal_packages = policy.workspace_package_names()

    def check_manifest(self, path_key, edit=None):
        path = policy.ROOT / path_key
        manifest = copy.deepcopy(policy.load_manifest(path))
        if edit is not None:
            edit(manifest)
        used = [set() for _ in range(4)]
        with patch.object(policy, "load_manifest", return_value=manifest):
            errors = policy.manifest_errors(path, self.internal_packages, *used)
        return errors, used

    def test_approved_compile_scope_manifests_use_exact_exceptions(self):
        selected_paths = (
            "codex-rs/core/Cargo.toml",
            "codex-rs/app-server/Cargo.toml",
            "codex-rs/app-server-client/Cargo.toml",
            "codex-rs/app-server-daemon/Cargo.toml",
        )
        used = [set() for _ in range(4)]
        for path_key in selected_paths:
            # Existing unrelated dev-dependency policy failures are covered by
            # the full verifier; isolate the approved compile-scope contract.
            errors, actual = self.check_manifest(
                path_key, lambda manifest: manifest.pop("dev-dependencies", None)
            )
            self.assertEqual(errors, [], path_key)
            for aggregate, selected in zip(used, actual):
                aggregate.update(selected)
        failures = {}
        with patch.object(policy, "MANIFEST_FEATURE_EXCEPTIONS", {
            key: policy.MANIFEST_FEATURE_EXCEPTIONS[key] for key in selected_paths
        }):
            policy.add_unused_exception_errors(failures, *used)
        self.assertEqual(failures, {})

    def test_integration_feature_cannot_gain_default_or_product_behavior(self):
        for path_key in ("codex-rs/core/Cargo.toml", "codex-rs/app-server/Cargo.toml"):
            for extra in ({"default": ["integration-tests"]}, {"integration-tests": ["other"]}):
                errors, _ = self.check_manifest(
                    path_key, lambda manifest: manifest["features"].update(extra)
                )
                self.assertTrue(any("limit `[features]`" in error for error in errors))

    def test_daemon_encoding_dependency_stays_exact_and_lifecycle_scoped(self):
        path_key = "codex-rs/app-server-daemon/Cargo.toml"
        manifest = policy.load_manifest(policy.ROOT / path_key)
        self.assertEqual(manifest["features"]["default"], ["lifecycle"])
        self.assertIn("dep:data-encoding", manifest["features"]["lifecycle"])
        self.assertTrue(manifest["dependencies"]["data-encoding"]["optional"])

        def edit(manifest):
            manifest["features"]["lifecycle"].append("dep:unapproved-encoding")
            manifest["dependencies"]["unapproved-encoding"] = {"optional": True}

        errors, _ = self.check_manifest(path_key, edit)
        self.assertTrue(any("limit `[features]`" in error for error in errors))
        self.assertTrue(any("remove `optional = true`" in error for error in errors))

    def test_new_features_and_optional_dependencies_stay_forbidden(self):
        def edit(manifest):
            manifest["features"] = {"unapproved": []}
            manifest["dependencies"]["codex-protocol"]["optional"] = True

        errors, _ = self.check_manifest("codex-rs/exec/Cargo.toml", edit)
        self.assertTrue(any("remove `[features]`" in error for error in errors))
        self.assertTrue(any("remove `optional = true`" in error for error in errors))

    def test_internal_dependency_feature_activation_stays_forbidden(self):
        def edit(manifest):
            manifest["dependencies"]["codex-core"]["features"] = ["integration-tests"]

        errors, _ = self.check_manifest("codex-rs/app-server-client/Cargo.toml", edit)
        self.assertTrue(any("remove `features = [...]`" in error for error in errors))

    def test_default_feature_disable_is_limited_to_client_daemon_edge(self):
        def edit(manifest):
            manifest["dependencies"]["codex-core"]["default-features"] = False

        errors, _ = self.check_manifest("codex-rs/app-server-client/Cargo.toml", edit)
        self.assertTrue(any("remove `default-features = false`" in error for error in errors))

    def test_missing_default_disable_exception_is_stale(self):
        failures = {}
        policy.add_unused_exception_errors(failures, set(), set(), set(), set())
        errors = failures["codex-rs/app-server-client/Cargo.toml"]
        self.assertTrue(any("stale default-feature-disable" in error for error in errors))

    def test_manifest_keys_match_on_windows_and_unix(self):
        self.assertEqual(
            policy.manifest_key(policy.ROOT / "codex-rs/core/Cargo.toml"),
            "codex-rs/core/Cargo.toml",
        )

    def test_bazel_defaults_and_integration_helper_exclusion(self):
        for crate, feature in (("app-server-client", "embedded"), ("app-server-daemon", "lifecycle")):
            build = (policy.CARGO_RS_ROOT / crate / "BUILD.bazel").read_text()
            self.assertIn(f'crate_features = ["{feature}"]', build)
        definitions = (policy.ROOT / "defs.bzl").read_text()
        self.assertIn("integration_test_exclude = []", definitions)
        self.assertIn("exclude = integration_test_exclude", definitions)
        core_build = (policy.CARGO_RS_ROOT / "core/BUILD.bazel").read_text()
        self.assertIn('integration_test_exclude = ["tests/integration_test_setup.rs"]', core_build)
        entrypoints = {
            path.name for path in (policy.CARGO_RS_ROOT / "core/tests").glob("*.rs")
            if path.name != "integration_test_setup.rs"
        }
        self.assertEqual(entrypoints, {
            "all.rs", "mcp_trace_propagation.rs", "responses_headers.rs", "request_user_input_async.rs",
        })


if __name__ == "__main__":
    unittest.main()
