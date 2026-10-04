#!/usr/bin/env python3
"""Configure and safely create work-artifact sessions and plans."""

from __future__ import annotations

import argparse
import json
import os
import re
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import unquote


SETTING_RE = re.compile(r"^(?P<prefix>\s*-\s*Work directory:\s*)(?P<value>\S.*?)(?P<end>\s*)$")
HEADING_RE = re.compile(r"^##\s+Work Artifacts\s*$", re.IGNORECASE)
TASK_RE = re.compile(r"^(?P<category>[A-Z]{2})-(?P<number>0[1-9]|[1-9][0-9])-(?P<title>[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*)$")
TITLE_RE = re.compile(r"^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$")
LINK_RE = re.compile(r"(?<!!)\[(?P<label>[^\]]+)\]\((?P<target>[^)]+)\)")
LOCK_NAME = ".work-artifacts.lock"
PLAN_RE = re.compile(r"^(?P<number>[0-9]+)-plan\.md$")
LEGACY_BRIEF_RE = re.compile(r"^(?P<number>[0-9]+)-brief\.md$")


class ArtifactError(ValueError):
    pass


def project_root(value: str) -> Path:
    root = Path(value).expanduser().resolve(strict=True)
    if not root.is_dir():
        raise ArtifactError(f"project root is not a directory: {root}")
    return root


def _read(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except UnicodeDecodeError as error:
        raise ArtifactError(f"file is not UTF-8: {path}") from error


def _setting_matches(text: str) -> list[re.Match[str]]:
    lines = text.splitlines(keepends=False)
    in_section = False
    matches: list[re.Match[str]] = []
    for line in lines:
        if re.match(r"^##\s+", line):
            in_section = bool(HEADING_RE.fullmatch(line.strip()))
            continue
        if in_section:
            match = SETTING_RE.fullmatch(line)
            if match:
                matches.append(match)
    return matches


def resolve_work_directory(root: Path) -> tuple[Path, str]:
    router = root / "docs" / "README.md"
    if not router.is_file():
        raise ArtifactError(f"missing project documentation router: {router}")
    matches = _setting_matches(_read(router))
    if len(matches) != 1:
        raise ArtifactError(
            "expected exactly one Work directory setting under ## Work Artifacts "
            f"in {router}; found {len(matches)}"
        )
    raw = matches[0].group("value").strip()
    configured = Path(raw).expanduser()
    work = configured if configured.is_absolute() else root / configured
    work = work.resolve(strict=True)
    if not work.is_dir() or not (work / "README.md").is_file():
        raise ArtifactError(f"configured work directory must contain README.md: {work}")
    return work, raw


def _task_dirs(work: Path) -> list[tuple[Path, re.Match[str]]]:
    found: list[tuple[Path, re.Match[str]]] = []
    for path in work.rglob("*"):
        if path.is_dir() and (match := TASK_RE.fullmatch(path.name)):
            found.append((path.resolve(), match))
    return found


def _next_category(dirs: list[tuple[Path, re.Match[str]]]) -> str:
    occupied = {match.group("category") for _, match in dirs}
    for first in range(ord("A"), ord("Z") + 1):
        for second in range(ord("A"), ord("Z") + 1):
            candidate = chr(first) + chr(second)
            if candidate not in occupied:
                return candidate
    raise ArtifactError("no unused sequential category remains from AA through ZZ")


def _body(path_value: str | None, label: str) -> str | None:
    if path_value is None:
        return None
    path = Path(path_value).expanduser().resolve(strict=True)
    if not path.is_file():
        raise ArtifactError(f"{label} body is not a file: {path}")
    body = _read(path)
    if not body.strip():
        raise ArtifactError(f"{label} body file is empty: {path}")
    return body


@contextmanager
def work_lock(work: Path):
    lock = work / LOCK_NAME
    try:
        lock.mkdir()
    except FileExistsError as error:
        raise ArtifactError(f"work artifact directory is locked: {lock}") from error
    try:
        yield
    finally:
        try:
            lock.rmdir()
        except FileNotFoundError:
            pass


def _session_path(value: str) -> tuple[Path, re.Match[str]]:
    candidate = Path(value).expanduser()
    if not candidate.is_absolute():
        raise ArtifactError("--session must be an absolute path")
    session = candidate.resolve(strict=True)
    if not session.is_dir():
        raise ArtifactError(f"session directory does not exist: {session}")
    match = TASK_RE.fullmatch(session.name)
    if match is None:
        raise ArtifactError(f"session directory has an invalid name: {session.name}")
    if not (session.parent / "README.md").is_file():
        raise ArtifactError(f"session parent must contain README.md: {session.parent}")
    return session, match


def _write_exclusive(path: Path, body: str) -> None:
    created = False
    try:
        with path.open("x", encoding="utf-8", newline="") as stream:
            created = True
            stream.write(body)
    except BaseException:
        if created:
            try:
                path.unlink()
            except OSError:
                pass
        raise


def new_session(
    root: Path,
    *,
    category: str | None,
    title: str,
    number: int | None,
    plan_file: str,
) -> dict[str, object]:
    work, _ = resolve_work_directory(root)
    plan_body = _body(plan_file, "plan")
    assert plan_body is not None
    if category is not None and not re.fullmatch(r"[A-Z]{2}", category):
        raise ArtifactError("--category must contain exactly two uppercase letters")
    if not TITLE_RE.fullmatch(title):
        raise ArtifactError("--title must be a nonempty hyphenated alphanumeric slug")
    if number is not None and category is None:
        raise ArtifactError("--number requires an explicit --category")
    if number is not None and not 1 <= number <= 99:
        raise ArtifactError("--number must be between 1 and 99")

    with work_lock(work):
        dirs = _task_dirs(work)
        chosen_category = category or _next_category(dirs)
        occupied: dict[int, list[Path]] = {}
        for path, match in dirs:
            if match.group("category") == chosen_category:
                occupied.setdefault(int(match.group("number")), []).append(path)
        chosen = number if number is not None else (
            1 if category is None else next(
                (candidate for candidate in range(1, 100) if candidate not in occupied), None
            )
        )
        if chosen is None:
            raise ArtifactError(f"category {chosen_category} has no unused session numbers")
        if chosen in occupied:
            raise ArtifactError(
                f"session code {chosen_category}-{chosen:02d} is already used by {occupied[chosen][0].name}"
            )
        code = f"{chosen_category}-{chosen:02d}"
        session = work / f"{code}-{title}"
        session.mkdir()
        plan = session / "01-plan.md"
        try:
            _write_exclusive(plan, plan_body)
        except BaseException:
            try:
                session.rmdir()
            except OSError:
                pass
            raise
        return {
            "code": code,
            "status": "created",
            "session": str(session.resolve()),
            "plan_number": 1,
            "plan": str(plan.resolve()),
        }


def new_plan(session_value: str, plan_file: str) -> dict[str, object]:
    plan_body = _body(plan_file, "plan")
    assert plan_body is not None
    session, match = _session_path(session_value)
    with work_lock(session.parent):
        numbers = [
            int(plan_match.group("number"))
            for path in session.iterdir()
            if path.is_file()
            if (plan_match := PLAN_RE.fullmatch(path.name) or LEGACY_BRIEF_RE.fullmatch(path.name)) is not None
        ]
        plan_number = max(numbers, default=0) + 1
        plan = session / f"{plan_number:02d}-plan.md"
        _write_exclusive(plan, plan_body)
        return {
            "code": f"{match.group('category')}-{match.group('number')}",
            "status": "created",
            "session": str(session),
            "plan_number": plan_number,
            "plan": str(plan.resolve()),
        }


def _relative_link(target: Path, containing_file: Path) -> str:
    try:
        value = os.path.relpath(target, containing_file.parent)
    except ValueError:
        value = str(target)
    return value.replace("\\", "/")


def _markdown_target(value: str) -> str:
    return f"<{value}>" if any(character.isspace() for character in value) else value


def _link_destination(target: str, containing_file: Path) -> tuple[Path, str] | None:
    raw = target.strip()
    if raw.startswith("<") and raw.endswith(">"):
        raw = raw[1:-1]
    path_part, marker, suffix = raw.partition("#")
    if not path_part or re.match(r"^[A-Za-z][A-Za-z0-9+.-]*://", path_part):
        return None
    decoded = unquote(path_part)
    path = Path(decoded)
    resolved = (path if path.is_absolute() else containing_file.parent / path).resolve()
    return resolved, (suffix if marker else "")


def _rewrite_links(text: str, containing_file: Path, old_readme: Path, new_readme: Path) -> str:
    def replace(match: re.Match[str]) -> str:
        destination = _link_destination(match.group("target"), containing_file)
        if destination is None or destination[0] != old_readme:
            return match.group(0)
        target = _relative_link(new_readme, containing_file)
        if destination[1]:
            target += "#" + destination[1]
        return f"[{match.group('label')}]({_markdown_target(target)})"
    return LINK_RE.sub(replace, text)


def configure(root: Path, directory_value: str) -> dict[str, str]:
    old_work, _ = resolve_work_directory(root)
    candidate = Path(directory_value).expanduser()
    new_work = (candidate if candidate.is_absolute() else root / candidate).resolve(strict=True)
    if not new_work.is_dir() or not (new_work / "README.md").is_file():
        raise ArtifactError(f"new work directory must already contain README.md: {new_work}")

    docs = root / "docs" / "README.md"
    agents = root / "AGENTS.md"
    if not agents.is_file():
        raise ArtifactError(f"missing root AGENTS.md: {agents}")
    docs_text = _read(docs)
    agents_text = _read(agents)
    old_readme, new_readme = old_work / "README.md", new_work / "README.md"

    stored = str(new_work) if candidate.is_absolute() else os.path.relpath(new_work, root)
    stored = stored.replace("\\", "/")
    setting_count = 0
    in_section = False
    out: list[str] = []
    for line in docs_text.splitlines(keepends=True):
        bare = line.rstrip("\r\n")
        ending = line[len(bare):]
        if re.match(r"^##\s+", bare):
            in_section = bool(HEADING_RE.fullmatch(bare.strip()))
        match = SETTING_RE.fullmatch(bare) if in_section else None
        if match:
            line = f"{match.group('prefix')}{stored}{ending}"
            setting_count += 1
        out.append(line)
    if setting_count != 1:
        raise ArtifactError("Work directory setting changed during configuration")
    docs_updated = "".join(out)
    docs_updated = _rewrite_links(docs_updated, docs, old_readme, new_readme)
    agents_updated = _rewrite_links(agents_text, agents, old_readme, new_readme)

    old_label = _relative_link(old_work, docs).rstrip("/") + "/"
    new_label = _relative_link(new_work, docs).rstrip("/") + "/"
    docs_updated = re.sub(
        rf"(?m)^(?P<prefix>\|\s*)`{re.escape(old_label)}`(?P<suffix>\s*\|)",
        lambda m: f"{m.group('prefix')}`{new_label}`{m.group('suffix')}",
        docs_updated,
    )

    docs.write_text(docs_updated, encoding="utf-8", newline="")
    agents.write_text(agents_updated, encoding="utf-8", newline="")
    return {"status": "configured", "task": str(new_work)}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    resolve = sub.add_parser("resolve")
    resolve.add_argument("--project", required=True)
    session = sub.add_parser("new-session")
    session.add_argument("--project", required=True)
    session.add_argument("--title", required=True)
    session.add_argument("--category")
    session.add_argument("--number", type=int)
    session.add_argument("--plan-file", required=True)
    plan = sub.add_parser("new-plan")
    plan.add_argument("--session", required=True)
    plan.add_argument("--plan-file", required=True)
    create = sub.add_parser("create", help="deprecated; use new-session or new-plan")
    create.add_argument("--project")
    create.add_argument("--task")
    create.add_argument("--category")
    create.add_argument("--title")
    create.add_argument("--number")
    create.add_argument("--plan-file")
    config = sub.add_parser("configure")
    config.add_argument("--project", required=True)
    config.add_argument("--directory", required=True)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        if args.command == "create":
            raise ArtifactError(
                "the create command is deprecated; use new-session to start a session "
                "or new-plan to add a plan"
            )
        if args.command == "new-plan":
            result = new_plan(args.session, args.plan_file)
        else:
            root = project_root(args.project)
        if args.command == "resolve":
            work, _ = resolve_work_directory(root)
            result = {"status": "resolved", "task": str(work)}
        elif args.command == "configure":
            result = configure(root, args.directory)
        elif args.command == "new-session":
            result = new_session(
                root, category=args.category, title=args.title, number=args.number,
                plan_file=args.plan_file,
            )
    except (ArtifactError, OSError) as error:
        parser.exit(1, f"work_artifacts: {error}\n")
    print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
