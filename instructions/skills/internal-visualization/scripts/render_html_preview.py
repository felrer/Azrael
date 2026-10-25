#!/usr/bin/env python3
"""Render standalone HTML to temporary PNG pages and safely clean them up."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile


PREFIX = "internal-visualization-preview-"
MARKER = ".internal-visualization-preview"
MARKER_VALUE = "internal-visualization-preview-v1\n"


def find_executable(names: list[str], candidates: list[Path]) -> Path:
    for name in names:
        resolved = shutil.which(name)
        if resolved:
            return Path(resolved).resolve()
    for candidate in candidates:
        if candidate.is_file():
            return candidate.resolve()
    raise RuntimeError(f"Required renderer executable not found: {', '.join(names)}")


def find_chromium() -> Path:
    candidates: list[Path] = []
    if os.name == "nt":
        for variable in ("PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA"):
            base = os.environ.get(variable)
            if not base:
                continue
            root = Path(base)
            candidates.extend(
                [
                    root / "Google/Chrome/Application/chrome.exe",
                    root / "Microsoft/Edge/Application/msedge.exe",
                ]
            )
    elif sys.platform == "darwin":
        candidates.extend(
            [
                Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
                Path("/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"),
            ]
        )
    return find_executable(
        ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome", "msedge"],
        candidates,
    )


def find_pdftoppm() -> Path:
    candidates: list[Path] = []
    if os.name == "nt":
        local = os.environ.get("LOCALAPPDATA")
        if local:
            candidates.append(Path(local) / "Programs/MiKTeX/miktex/bin/x64/pdftoppm.exe")
    return find_executable(["pdftoppm"], candidates)


def run_checked(command: list[str], timeout: int = 90) -> None:
    result = subprocess.run(
        command,
        check=False,
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip()
        raise RuntimeError(detail or f"Renderer exited with code {result.returncode}")


def render(html_path: Path, dpi: int, wait_ms: int) -> dict[str, object]:
    source = html_path.expanduser().resolve(strict=True)
    if not source.is_file() or source.suffix.lower() not in {".html", ".htm"}:
        raise ValueError("Input must be an existing HTML file")

    preview_dir = Path(tempfile.mkdtemp(prefix=PREFIX)).resolve()
    marker = preview_dir / MARKER
    marker.write_text(MARKER_VALUE, encoding="utf-8")
    pdf_path = preview_dir / "preview.pdf"
    profile_dir = preview_dir / "chromium-profile"

    try:
        chromium = find_chromium()
        run_checked(
            [
                str(chromium),
                "--headless=new",
                "--disable-gpu",
                "--hide-scrollbars",
                "--allow-file-access-from-files",
                "--run-all-compositor-stages-before-draw",
                f"--virtual-time-budget={max(0, wait_ms)}",
                f"--user-data-dir={profile_dir}",
                "--no-pdf-header-footer",
                "--print-to-pdf-no-header",
                f"--print-to-pdf={pdf_path}",
                source.as_uri(),
            ]
        )
        if not pdf_path.is_file() or pdf_path.stat().st_size == 0:
            raise RuntimeError("Renderer did not create a PDF preview")

        pdftoppm = find_pdftoppm()
        image_prefix = preview_dir / "page"
        run_checked([str(pdftoppm), "-png", "-r", str(dpi), str(pdf_path), str(image_prefix)])
        images = sorted(preview_dir.glob("page-*.png"))
        if not images:
            raise RuntimeError("PDF conversion did not create PNG previews")
        shutil.rmtree(profile_dir, ignore_errors=True)
        return {
            "preview_dir": str(preview_dir),
            "source": str(source),
            "images": [str(path) for path in images],
            "temporary": True,
        }
    except Exception:
        safe_cleanup(preview_dir)
        raise


def safe_cleanup(preview_dir: Path) -> dict[str, object]:
    target = preview_dir.expanduser().resolve(strict=True)
    temp_root = Path(tempfile.gettempdir()).resolve(strict=True)
    if target.parent != temp_root or not target.name.startswith(PREFIX):
        raise ValueError("Cleanup target is not a renderer-owned temporary directory")
    marker = target / MARKER
    if not marker.is_file() or marker.read_text(encoding="utf-8") != MARKER_VALUE:
        raise ValueError("Cleanup marker is missing or invalid")
    shutil.rmtree(target)
    return {"removed": str(target), "exists": target.exists()}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    render_parser = subparsers.add_parser("render", help="Create temporary PNG preview pages")
    render_parser.add_argument("html", type=Path)
    render_parser.add_argument("--dpi", type=int, default=120)
    render_parser.add_argument("--wait-ms", type=int, default=1500)

    cleanup_parser = subparsers.add_parser("cleanup", help="Remove a marked temporary preview directory")
    cleanup_parser.add_argument("preview_dir", type=Path)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        if args.command == "render":
            result = render(args.html, args.dpi, args.wait_ms)
        else:
            result = safe_cleanup(args.preview_dir)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except Exception as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
