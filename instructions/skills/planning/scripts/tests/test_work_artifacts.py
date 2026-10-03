from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).parents[1] / "work_artifacts.py"
LEGACY_SCRIPT = Path(__file__).parents[1] / "new_task_plan.py"
SPEC = importlib.util.spec_from_file_location("work_artifacts", SCRIPT)
assert SPEC and SPEC.loader
wa = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(wa)


class WorkArtifactsTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name)
        self.project = self.base / "project"
        self.work = self.project / "docs" / "work"
        self.work.mkdir(parents=True)
        (self.work / "README.md").write_text("# Work\n", encoding="utf-8")
        (self.project / "docs" / "README.md").write_text(
            "# Docs\n\n| Category | Entry |\n|---|---|\n"
            "| `work/` | [Work documents](work/README.md) |\n\n"
            "## Work Artifacts\n\n- Work directory: docs/work\n\n"
            "Preserve this prose and [another link](other.md).\n",
            encoding="utf-8",
        )
        (self.project / "AGENTS.md").write_text(
            "Use [work documents](docs/work/README.md). Keep this sentence.\n",
            encoding="utf-8",
        )

    def tearDown(self) -> None:
        self.temp.cleanup()

    def run_cli(self, *args: str, ok: bool = True) -> subprocess.CompletedProcess[str]:
        result = subprocess.run(
            [sys.executable, "-B", str(SCRIPT), *args],
            text=True,
            encoding="utf-8",
            capture_output=True,
            check=False,
        )
        if ok and result.returncode != 0:
            self.fail(result.stderr)
        return result

    def test_resolve_relative_configuration(self) -> None:
        result = self.run_cli("resolve", "--project", str(self.project))
        data = json.loads(result.stdout)
        self.assertEqual(data, {"status": "resolved", "task": str(self.work.resolve())})

    def write_body(self, name: str = "plan.md", body: str = "# Plan\nDetails\n") -> Path:
        source = self.base / name
        source.write_text(body, encoding="utf-8")
        return source

    def new_session(self, title: str, *extra: str) -> dict[str, object]:
        body = self.write_body(f"{title}-{len(list(self.base.glob('*.md')))}.md")
        return json.loads(self.run_cli(
            "new-session", "--project", str(self.project), "--title", title,
            "--plan-file", str(body), *extra,
        ).stdout)

    def test_new_session_always_creates_and_preserves_unicode_body(self) -> None:
        plan_source = self.base / "plan.txt"
        plan_source.write_text("# 계획\n내용 🌱\n", encoding="utf-8")
        first = json.loads(self.run_cli(
            "new-session", "--project", str(self.project), "--title", "same",
            "--plan-file", str(plan_source),
        ).stdout)
        second = json.loads(self.run_cli(
            "new-session", "--project", str(self.project), "--title", "same",
            "--plan-file", str(plan_source),
        ).stdout)
        self.assertEqual(first["code"], "AA-01")
        self.assertEqual(second["code"], "AB-01")
        self.assertNotEqual(first["session"], second["session"])
        self.assertEqual(first["plan_number"], 1)
        self.assertEqual(Path(first["plan"]).read_text(encoding="utf-8"), "# 계획\n내용 🌱\n")

    def test_explicit_category_allocates_numbers_and_occupied_code_fails(self) -> None:
        custom = self.new_session("custom", "--category", "UI")
        continued = self.new_session("continued", "--category", "UI")
        conflict = self.run_cli(
            "new-session", "--project", str(self.project), "--category", "UI",
            "--number", "1", "--title", "custom", "--plan-file", str(self.write_body()), ok=False,
        )
        self.assertEqual(custom["code"], "UI-01")
        self.assertEqual(continued["code"], "UI-02")
        self.assertEqual(conflict.returncode, 1)
        self.assertIn("already used", conflict.stderr)

    def test_number_requires_explicit_category(self) -> None:
        result = self.run_cli(
            "new-session", "--project", str(self.project), "--title", "numbered",
            "--number", "8", "--plan-file", str(self.write_body()), ok=False,
        )
        self.assertEqual(result.returncode, 1)
        self.assertIn("requires an explicit --category", result.stderr)

    def test_new_plan_counts_legacy_briefs_and_ignores_other_files(self) -> None:
        created = self.new_session("history")
        session = Path(created["session"])
        (session / "03-brief.md").write_text("old", encoding="utf-8")
        (session / "99-brief.md").write_text("old", encoding="utf-8")
        (session / "02-notes.md").write_text("other", encoding="utf-8")
        body = self.write_body("followup.md", "후속 내용\n")
        result = json.loads(self.run_cli(
            "new-plan", "--session", str(session.resolve()), "--plan-file", str(body),
        ).stdout)
        self.assertEqual(result["plan_number"], 100)
        self.assertEqual(Path(result["plan"]).name, "100-plan.md")
        self.assertEqual(Path(result["plan"]).read_text(encoding="utf-8"), "후속 내용\n")
        self.assertFalse((session / "02-plan.md").exists())

        plan_only = Path(self.new_session("plan-only")["session"])
        (plan_only / "02-notes.md").write_text("other", encoding="utf-8")
        second = json.loads(self.run_cli(
            "new-plan", "--session", str(plan_only), "--plan-file", str(body),
        ).stdout)
        self.assertEqual(second["plan_number"], 2)

    def test_traversal_and_empty_body_fail_without_partial_output(self) -> None:
        traversal = self.run_cli(
            "new-session", "--project", str(self.project), "--title", "../escape",
            "--plan-file", str(self.write_body()), ok=False,
        )
        empty = self.write_body("empty.md", " \n")
        empty_result = self.run_cli(
            "new-session", "--project", str(self.project), "--title", "empty",
            "--plan-file", str(empty), ok=False,
        )
        self.assertEqual(traversal.returncode, 1)
        self.assertIn("slug", traversal.stderr)
        self.assertIn("is empty", empty_result.stderr)
        self.assertFalse((self.project / "docs" / "escape").exists())
        self.assertEqual([path.name for path in self.work.iterdir() if path.is_dir()], [])

    def test_invalid_new_plan_input_leaves_session_unchanged(self) -> None:
        session = Path(self.new_session("unchanged")["session"])
        empty = self.write_body("empty-followup.md", "\n")
        before = sorted(path.name for path in session.iterdir())
        result = self.run_cli(
            "new-plan", "--session", str(session), "--plan-file", str(empty), ok=False,
        )
        self.assertEqual(result.returncode, 1)
        self.assertIn("is empty", result.stderr)
        self.assertEqual(sorted(path.name for path in session.iterdir()), before)

    def test_archived_identifier_is_reserved(self) -> None:
        archived = self.work / "archive" / "AA-01-old"
        archived.mkdir(parents=True)
        result = self.new_session("new")
        self.assertEqual(result["code"], "AB-01")

    def test_external_configuration_rewrites_only_resolving_links_and_label(self) -> None:
        external = self.base / "external work"
        external.mkdir()
        (external / "README.md").write_text("# External\n", encoding="utf-8")
        result = json.loads(self.run_cli(
            "configure", "--project", str(self.project), "--directory", str(external.resolve()),
        ).stdout)
        docs = (self.project / "docs" / "README.md").read_text(encoding="utf-8")
        agents = (self.project / "AGENTS.md").read_text(encoding="utf-8")
        self.assertEqual(result["status"], "configured")
        self.assertIn(f"- Work directory: {external.resolve().as_posix()}", docs)
        expected_docs_link = wa._relative_link(external / "README.md", self.project / "docs" / "README.md")
        expected_agents_link = wa._relative_link(external / "README.md", self.project / "AGENTS.md")
        expected_label = wa._relative_link(external, self.project / "docs" / "README.md").rstrip("/") + "/"
        self.assertIn(f"[Work documents](<{expected_docs_link}>)", docs)
        self.assertIn(f"`{expected_label}`", docs)
        self.assertIn("[another link](other.md)", docs)
        self.assertIn("Preserve this prose", docs)
        self.assertIn(f"[work documents](<{expected_agents_link}>)", agents)
        self.assertIn("Keep this sentence.", agents)

    def test_configure_relative_directory(self) -> None:
        relocated = self.project / "review" / "work"
        relocated.mkdir(parents=True)
        (relocated / "README.md").write_text("# Relocated\n", encoding="utf-8")
        result = json.loads(self.run_cli(
            "configure", "--project", str(self.project), "--directory", "review/work",
        ).stdout)
        docs = (self.project / "docs" / "README.md").read_text(encoding="utf-8")
        self.assertEqual(result["task"], str(relocated.resolve()))
        self.assertIn("- Work directory: review/work", docs)
        self.assertIn("[Work documents](../review/work/README.md)", docs)

    def test_configure_preserves_single_link_anchor_marker(self) -> None:
        docs_path = self.project / "docs" / "README.md"
        docs_path.write_text(
            docs_path.read_text(encoding="utf-8").replace(
                "[Work documents](work/README.md)",
                "[Work documents](work/README.md#categories-and-tasks)",
            ),
            encoding="utf-8",
        )
        relocated = self.project / "review" / "work"
        relocated.mkdir(parents=True)
        (relocated / "README.md").write_text("# Relocated\n", encoding="utf-8")
        self.run_cli("configure", "--project", str(self.project), "--directory", "review/work")
        docs = docs_path.read_text(encoding="utf-8")
        self.assertIn("[Work documents](../review/work/README.md#categories-and-tasks)", docs)
        self.assertNotIn("##categories-and-tasks", docs)

    def test_old_absolute_session_remains_usable_after_configure(self) -> None:
        session = self.work / "AA-04-history"
        session.mkdir()
        (session / "01-brief.md").write_text("# Historical brief\n", encoding="utf-8")
        new_work = self.base / "new-work"
        new_work.mkdir()
        (new_work / "README.md").write_text("# New\n", encoding="utf-8")
        self.run_cli("configure", "--project", str(self.project), "--directory", str(new_work.resolve()))
        body = self.write_body("body.md", "# Continued plan\n")
        result = json.loads(self.run_cli(
            "new-plan", "--session", str(session.resolve()), "--plan-file", str(body),
        ).stdout)
        self.assertEqual(result["code"], "AA-04")
        self.assertEqual(result["plan_number"], 2)
        self.assertTrue((session / "02-plan.md").is_file())

    def test_legacy_commands_fail_with_guidance_without_mutation(self) -> None:
        before = sorted(path.name for path in self.work.rglob("*"))
        create = self.run_cli(
            "create", "--project", str(self.project), "--title", "legacy", ok=False,
        )
        legacy = subprocess.run(
            [sys.executable, "-B", str(LEGACY_SCRIPT), "--directory", str(self.work)],
            text=True, encoding="utf-8", capture_output=True, check=False,
        )
        self.assertEqual(create.returncode, 1)
        self.assertIn("new-session", create.stderr)
        self.assertEqual(legacy.returncode, 1)
        self.assertIn("new-plan", legacy.stderr)
        self.assertEqual(sorted(path.name for path in self.work.rglob("*")), before)

    def test_concurrent_new_plans_are_unique_or_retry_after_lock(self) -> None:
        session = Path(self.new_session("concurrent")["session"])
        body = self.write_body("concurrent-body.md", "Concurrent plan\n")
        command = [
            sys.executable, "-B", str(SCRIPT), "new-plan",
            "--session", str(session), "--plan-file", str(body),
        ]
        processes = [
            subprocess.Popen(command, text=True, encoding="utf-8", stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            for _ in range(8)
        ]
        results = [process.communicate() + (process.returncode,) for process in processes]
        numbers: list[int] = []
        lock_failures = 0
        for stdout, stderr, returncode in results:
            if returncode == 0:
                numbers.append(json.loads(stdout)["plan_number"])
            else:
                self.assertIn("is locked", stderr)
                lock_failures += 1
        for _ in range(lock_failures):
            retried = json.loads(self.run_cli(
                "new-plan", "--session", str(session), "--plan-file", str(body),
            ).stdout)
            numbers.append(retried["plan_number"])
        self.assertEqual(sorted(numbers), list(range(2, 10)))
        self.assertEqual(len({path.name for path in session.glob("*-plan.md")}), 9)

    def test_missing_duplicate_config_and_lock_fail_clearly(self) -> None:
        docs = self.project / "docs" / "README.md"
        docs.write_text(
            docs.read_text(encoding="utf-8").replace(
                "- Work directory: docs/work", "- Work directory: docs/work\n- Work directory: docs/work"
            ), encoding="utf-8",
        )
        duplicate = self.run_cli("resolve", "--project", str(self.project), ok=False)
        self.assertIn("found 2", duplicate.stderr)
        docs.write_text(docs.read_text(encoding="utf-8").replace("- Work directory: docs/work\n", "", 1), encoding="utf-8")
        (self.work / wa.LOCK_NAME).mkdir()
        locked = self.run_cli(
            "new-session", "--project", str(self.project), "--title", "locked",
            "--plan-file", str(self.write_body()), ok=False,
        )
        self.assertEqual(locked.returncode, 1)
        self.assertIn("is locked", locked.stderr)


if __name__ == "__main__":
    unittest.main()
