"use strict";
// Selected source checks only. No product packaging, installation, or live accounts.
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { beginArtifactRun, finishArtifactRun } = require("./artifact-run.cjs");
const root = path.resolve(__dirname, "..");
const scope = process.argv[2];
const selections = {
  backend: ["--test", "scripts/tests/instruction-library.test.cjs", "scripts/tests/instruction-playbooks.test.cjs", "scripts/tests/instruction-publisher.test.cjs", "scripts/tests/instruction-catalog.test.cjs"],
  host: ["--test", "scripts/test-instruction-library-host.cjs", "scripts/test-instruction-settings.cjs", "scripts/tests/task-profile-runtime.test.cjs", "scripts/tests/inject-task-profile.test.cjs", "scripts/tests/instruction-module-packaging.test.cjs", "scripts/tests/instruction-package.test.cjs", "scripts/test-namespace-cache-owner.cjs"],
  types: ["extensions/azrael-ex/node_modules/typescript/bin/tsc", "--noEmit", "--project", "extensions/azrael-ex/tsconfig.json"],
};
if (!selections[scope]) throw new Error("Choose backend, host, or types.");
const run = beginArtifactRun(root, { workId: "CM-01", runId: `${scope}-${require("node:crypto").randomUUID().slice(0, 8)}`, owner: "instruction-library-verification" });
const startedAt = new Date().toISOString();
const env = { ...process.env, NODE_TEST_CONTEXT: undefined, TEMP: run.temporary, TMP: run.temporary,
  AZRAEL_CATALOG_TEST_ROOT: path.join(run.temporary, "catalog"),
  INSTRUCTION_PUBLISHER_FIXTURES: path.join(run.temporary, "publisher"),
  AZRAEL_INSTRUCTION_TEST_ROOT: run.temporary,
  AZRAEL_INSTRUCTION_PACKAGING_TEST_ROOT: path.join(run.temporary, "instruction-packaging") };
const result = spawnSync(process.execPath, selections[scope], { cwd: root, env, windowsHide: true, encoding: "utf8", maxBuffer: 24 * 1024 * 1024 });
const log = path.join(run.logs, `${scope}.log`);
fs.writeFileSync(log, result.stdout + result.stderr + (result.error ? String(result.error) : ""));
const exitCode = result.status;
const summary = { scope, startedAt, endedAt: new Date().toISOString(), argv: [process.execPath, ...selections[scope]], exitCode, signal: result.signal, log, runRoot: run.runRoot, reusedValidator: env.AZRAEL_INSTRUCTION_TEST_ENGINE || null };
fs.writeFileSync(path.join(run.reports, "summary.json"), JSON.stringify(summary, null, 2));
finishArtifactRun(run, { exitCode, producerStopped: result.status !== null || !!result.error });
console.log(JSON.stringify(summary));
if (exitCode !== 0) console.error((result.stdout + result.stderr).split(/\r?\n/).filter((line, index, lines) => /not ok|error:|Error:|TS\d{4}/.test(line) || /not ok|error:|Error:/.test(lines[index - 1] || "")).slice(0, 65).join("\n"));
process.exitCode = exitCode ?? 1;
