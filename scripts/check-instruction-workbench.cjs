"use strict";
const path = require("node:path");
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const artifacts = require("./artifact-run.cjs");
const root = path.resolve(__dirname, "..");
const run = artifacts.beginArtifactRun(root, { workId: "FA-01-instruction-package-dev-tab", owner: "scripts/check-instruction-workbench.cjs" });
const logfile = path.join(run.logs, "tests.log");
const output = fs.createWriteStream(logfile);
const startedAt = new Date().toISOString();
const child = artifacts.trackArtifactChild(run, spawn(process.execPath, ["--test", "scripts/tests/instruction-workbench.test.cjs", "scripts/tests/instruction-workbench-server.test.cjs", "scripts/tests/instruction-workbench-host.test.cjs", "scripts/tests/instruction-workbench-resources.test.cjs", "scripts/tests/instruction-module-packaging.test.cjs", "scripts/tests/task-profile-runtime.test.cjs", "scripts/tests/role-profile-store.test.cjs", "scripts/tests/role-profile-runtime.test.cjs", "scripts/tests/inject-task-profile.test.cjs"], {
  cwd: root, windowsHide: true, env: { ...process.env, AZRAEL_WORKBENCH_TEST_ROOT: run.temporary, TEMP: run.temporary, TMP: run.temporary, TMPDIR: run.temporary }, stdio: ["ignore", "pipe", "pipe"],
}));
child.stdout.pipe(output, { end: false }); child.stderr.pipe(output, { end: false });
child.on("error", error => { process.stderr.write(error.message + "\n"); });
child.once("close", (code, signal) => {
  output.end(() => {
    const summary = { startedAt, endedAt: new Date().toISOString(), exitCode: code, signal, logfile, runRoot: run.runRoot, lifecycleId: run.lifecycleId };
    fs.writeFileSync(path.join(run.reports, "tests.json"), JSON.stringify(summary, null, 2));
    artifacts.finishArtifactRun(run, { exitCode: code, signal, producerStopped: true, reason: "Owned test runner and tracked Node child completed" });
    process.stdout.write(JSON.stringify(summary) + "\n");
    if (code !== 0) process.stdout.write(fs.readFileSync(logfile, "utf8"));
    process.exitCode = code ?? 1;
  });
});
