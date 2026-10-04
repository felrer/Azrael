#!/usr/bin/env python3
"""Deprecated legacy plan allocator retained for non-mutating guidance."""

from __future__ import annotations

import argparse


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--directory",
        required=True,
        help="Legacy argument accepted only to provide migration guidance.",
    )
    parser.parse_args()
    parser.exit(
        1,
        "new_task_plan: deprecated and no files were created; use "
        "work_artifacts.py new-session or new-plan\n",
    )


if __name__ == "__main__":
    raise SystemExit(main())
