#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path


PLACEHOLDER = "__DOCENTO_REPORT_DATA__"
SKILL_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_TEMPLATE = SKILL_ROOT / "assets" / "docento-benchmark" / "template.html"


def _validate(data: object) -> dict[str, object]:
    if not isinstance(data, dict):
        raise ValueError("report input must be a JSON object")
    required = ("title", "model", "run", "models", "metrics")
    missing = [key for key in required if key not in data]
    if missing:
        raise ValueError(f"report input is missing required fields: {', '.join(missing)}")
    if not isinstance(data["models"], list) or not data["models"]:
        raise ValueError("models must be a non-empty array")
    if not isinstance(data["metrics"], list) or not data["metrics"]:
        raise ValueError("metrics must be a non-empty array")
    model_ids = {
        row.get("id") for row in data["models"]
        if isinstance(row, dict) and isinstance(row.get("id"), str)
    }
    if len(model_ids) != len(data["models"]):
        raise ValueError("every model must have a unique string id")
    focus_count = sum(bool(row.get("focus")) for row in data["models"] if isinstance(row, dict))
    if focus_count > 1:
        raise ValueError("at most one model may set focus=true")
    for metric in data["metrics"]:
        if not isinstance(metric, dict) or not isinstance(metric.get("values"), dict):
            raise ValueError("every metric must contain a values object")
        unknown = set(metric["values"]) - model_ids
        if unknown:
            raise ValueError(f"metric {metric.get('id')!r} references unknown models: {sorted(unknown)}")
    return data


def render(input_path: Path, output_path: Path, template_path: Path = DEFAULT_TEMPLATE) -> None:
    data = _validate(json.loads(input_path.read_text(encoding="utf-8")))
    template = template_path.read_text(encoding="utf-8")
    if template.count(PLACEHOLDER) != 1:
        raise ValueError(f"template must contain exactly one {PLACEHOLDER} placeholder")
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(template.replace(PLACEHOLDER, payload), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Render a standalone DOCENTO benchmark HTML report")
    parser.add_argument("input", type=Path, help="normalized report JSON")
    parser.add_argument("output", type=Path, help="destination HTML")
    parser.add_argument("--template", type=Path, default=DEFAULT_TEMPLATE)
    args = parser.parse_args()
    render(args.input, args.output, args.template)


if __name__ == "__main__":
    main()
