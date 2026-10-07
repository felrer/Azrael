"""Source-only identity contract checks; deliberately does not build the engine."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

PROJECT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("import_engine_source", PROJECT / "scripts/import-engine-source.py")
importer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(importer)


class HarnessIdentityTests(unittest.TestCase):
    def test_all_known_intros_have_bounded_reproducible_replacements(self):
        for intro in importer.CODEX_IDENTITY_INTROS:
            for newline in (b"\n", b"\r\n"):
                with self.subTest(intro=intro, newline=newline):
                    original = intro.encode() + newline + b"Use Codex API and GPT-6 model names." + newline
                    path = "codex-rs/models-manager/prompt.md"
                    _, adapted, _ = importer.known_source_fix(path, original)
                    self.assertEqual(adapted, importer.AZRAEL_IDENTITY.encode() + newline + b"Use Codex API and GPT-6 model names." + newline)

    def test_catalog_keeps_model_metadata_and_nonidentity_instructions(self):
        path = "codex-rs/models-manager/models.json"
        original = (PROJECT / "engine" / (path + ".upstream")).read_bytes()
        before = json.loads(original)
        after = json.loads(importer.known_source_fix(path, original)[1])
        self.assertEqual(before.keys(), after.keys())
        for old, new in zip(before["models"], after["models"], strict=True):
            self.assertEqual(old.keys(), new.keys())
            for key in old:
                if key == "service_tiers" and old["slug"] == "gpt-6-astra":
                    self.assertEqual(new[key], old[key] + [{"id": "ultrafast", "name": "Ultrafast", "description": "Ultrafast processing"}])
                elif key != "model_messages":
                    self.assertEqual(old[key], new[key])
            old_messages = old["model_messages"].copy()
            template = old_messages["instructions_template"]
            for intro in importer.CODEX_IDENTITY_INTROS:
                template = template.replace(intro, importer.AZRAEL_IDENTITY)
            old_messages["instructions_template"] = template
            self.assertEqual(old_messages, new["model_messages"])
            self.assertTrue(template.startswith(importer.AZRAEL_IDENTITY))

    def test_catalog_tier_recipe_rejects_missing_duplicate_and_changed_anchors(self):
        path = "codex-rs/models-manager/models.json"
        original = (PROJECT / "engine" / (path + ".upstream")).read_bytes()
        for changed in (
            original.replace(b'"slug": "gpt-6-astra"', b'"slug": "missing"', 1),
            original.replace(b'"slug": "gpt-6.1-sol"', b'"slug": "gpt-6-astra"', 1),
            original.replace(b'"description": "2x speed, increased usage"', b'"description": "changed"', 1),
        ):
            with self.subTest(changed=changed[:80]):
                with self.assertRaisesRegex(ValueError, "Ultrafast catalog"):
                    importer.known_source_fix(path, changed)

    def test_session_normalizes_request_copy_before_existing_provider_cleanup(self):
        source = (PROJECT / "engine" / importer.IDENTITY_SESSION_PATH).read_text(encoding="utf-8")
        start = source.index("pub(crate) async fn get_prompt_base_instructions")
        end = source.index("// Merges connector IDs", start)
        method = source[start:end]
        self.assertIn(importer.IDENTITY_SESSION_NEW, method)
        self.assertLess(method.index("with_azrael_harness_identity"), method.index("without_update_plan_instructions"))
        self.assertNotIn("Model {", method[:method.index("with_azrael_harness_identity")])
        self.assertNotIn("session_configuration.base_instructions =", method)

    def test_fixed_recipe_checks_preserved_bytes_and_rejects_tampering(self):
        path = "codex-rs/models-manager/prompt.md"
        original = importer.CODEX_IDENTITY_INTROS[-1].encode() + b"\n"
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / path
            source.parent.mkdir(parents=True)
            source.write_bytes(original)
            files = {path: importer.describe(source, "100644")}
            fixes = importer.apply_identity_source_fixes(root, files)
            self.assertEqual((root / (path + ".upstream")).read_bytes(), original)
            importer.verify_destination(root, files, source_fixes=fixes)
            source.write_bytes(source.read_bytes() + b"tampered")
            with self.assertRaisesRegex(ValueError, "Adapted source differs"):
                importer.verify_destination(root, files, source_fixes=fixes)

    def test_receipt_preserves_original_inventory_and_reproduces_all_identity_adaptations(self):
        root = PROJECT / "engine"
        receipt = json.loads((root / "SOURCE.json").read_text(encoding="utf-8"))
        self.assertEqual(importer.hashlib.sha256(importer.canonical(receipt["files"])).hexdigest(), receipt["inventorySha256"])
        for path in importer.IDENTITY_FIX_PATHS | importer.ULTRAFAST_FIX_PATHS:
            with self.subTest(path=path):
                fix = receipt["sourceFixes"][path]
                original = root / fix["preservedPath"]
                self.assertEqual(importer.describe(original, receipt["files"][path]["gitMode"]), receipt["files"][path])
                self.assertEqual(importer.source_fixes_record(original.read_bytes(), path)[path], fix)
                self.assertEqual((root / fix["adaptedPath"]).read_bytes(), importer.known_source_fix(path, original.read_bytes())[1])

    def test_ultrafast_routing_recipes_reject_changed_anchors_and_active_tampering(self):
        for path in importer.ULTRAFAST_FIX_PATHS:
            original = (PROJECT / "engine" / (path + ".upstream")).read_bytes()
            anchor = importer.ULTRAFAST_SOURCE_RECIPES[path][0][0].encode()
            with self.subTest(path=path):
                with self.assertRaisesRegex(ValueError, "Ultrafast routing source anchor"):
                    importer.known_source_fix(path, original.replace(anchor, b"changed", 1))
                with tempfile.TemporaryDirectory() as temporary:
                    root = Path(temporary)
                    source = root / path
                    source.parent.mkdir(parents=True)
                    source.write_bytes(original)
                    files = {path: importer.describe(source, "100644")}
                    fixes = importer.apply_identity_source_fixes(root, files)
                    importer.verify_destination(root, files, source_fixes=fixes)
                    source.write_bytes(source.read_bytes() + b"tampered")
                    with self.assertRaisesRegex(ValueError, "Adapted source differs"):
                        importer.verify_destination(root, files, source_fixes=fixes)

    def test_active_templates_remove_exact_old_identity(self):
        for path in importer.IDENTITY_TEMPLATE_PATHS:
            text = (PROJECT / "engine" / path).read_text(encoding="utf-8")
            with self.subTest(path=path):
                self.assertNotIn(importer.CODEX_IDENTITY_INTROS[0], text)
                self.assertIn(importer.AZRAEL_IDENTITY, text)


if __name__ == "__main__":
    unittest.main()
