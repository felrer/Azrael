"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const [sourceRoot, ...extra] = process.argv.slice(2);
if (!sourceRoot || !path.isAbsolute(sourceRoot) || extra.length) {
  throw Error("Usage: check-question-withdrawal-sdk.cjs <absolute frozen engine source root>");
}
const modulePath = path.join(sourceRoot, "sdk/python/src/openai_codex/generated/v2_all.py");
if (!fs.statSync(modulePath).isFile()) throw Error("Selected source has no generated Python SDK models");
const python = process.env.AZRAEL_PYTHON_SDK || path.resolve(__dirname, "../engine/sdk/python/.venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
if (!path.isAbsolute(python) || !fs.existsSync(python)) throw Error("Set AZRAEL_PYTHON_SDK to an installed SDK Python interpreter");
const code = String.raw`
import json, pathlib, sys
from pydantic import ValidationError
selected = pathlib.Path(sys.argv[1]).resolve()
sys.path.insert(0, str(selected / "sdk/python/src"))
from openai_codex.generated import v2_all
assert pathlib.Path(v2_all.__file__).resolve() == selected / "sdk/python/src/openai_codex/generated/v2_all.py"
question = v2_all.AsyncUserInputQuestion
legacy = question.model_validate({"title": "Continue?", "options": None})
assert legacy.withdrawn is None or legacy.withdrawn is False
assert "withdrawn" not in legacy.model_dump(exclude_unset=True)
withdrawn = question.model_validate({"title": "Continue?", "options": ["Continue"], "withdrawn": True})
assert withdrawn.withdrawn is True
assert withdrawn.model_dump(by_alias=True)["withdrawn"] is True
try:
    question.model_validate({"title": "Continue?", "unexpected": True})
except ValidationError:
    pass
else:
    raise AssertionError("question models must continue rejecting unrelated fields")
print(json.dumps({"python": sys.version.split()[0], "module": v2_all.__file__, "checks": 4, "passed": True}))
`;
const result = spawnSync(python, ["-B", "-c", code, sourceRoot], { stdio: "inherit", windowsHide: true });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
