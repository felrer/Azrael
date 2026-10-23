"use strict";
// One-off verification owner. Product packaging and installation are deliberately absent.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn, execFileSync } = require("node:child_process");
const { beginArtifactRun, finishArtifactRun, trackArtifactChild } = require("../../scripts/artifact-run.cjs");
const root = path.resolve(__dirname, "../..");
const runId = process.argv[2];
if (!/^mcp-lazy-r[1-9][0-9]*$/.test(runId || "")) throw Error("Fresh mcp-lazy-rN ID required");
const run = beginArtifactRun(root, { workId: "DJ-01", owner: "DJ-01-mcp-lazy", runId,
  paths: { outputs: path.join(root, "artifacts/build", runId) } });
const env = { ...process.env, PATH: `C:/Users/felre/.cargo/bin;${process.env.PATH || process.env.Path || ""}`,
  RUSTUP_TOOLCHAIN: "1.95.0", CARGO_TARGET_DIR: path.join(root, "engine/codex-rs/target"), CARGO_BUILD_JOBS: "2",
  TEMP: run.temporary, TMP: run.temporary, TMPDIR: run.temporary,
  INSTA_UPDATE: "no", INSTA_PENDING_DIR: path.join(run.temporary, "pending"),
  AZRAEL_CARGO_OWNER_TEST_ROOT: path.join(run.temporary, "wrapper-fixtures"),
  AZRAEL_CARGO_RUN_ID: run.lifecycleId };
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const results = [];
async function command(name, executable, args) {
  const startedUtc = new Date().toISOString();
  const out = fs.openSync(path.join(run.logs, `${name}.stdout.log`), "wx");
  const err = fs.openSync(path.join(run.logs, `${name}.stderr.log`), "wx");
  try {
    const child = trackArtifactChild(run, spawn(executable, args, { cwd: root, env, windowsHide: true, stdio: ["ignore", out, err] }));
    const result = await new Promise(resolve => {
      let error;
      child.once("error", e => { error = e.message; });
      child.once("close", (exitCode, signal) => resolve({ name, executable, args, startedUtc,
        finishedUtc: new Date().toISOString(), exitCode, signal, error }));
    });
    results.push(result);
    fs.writeFileSync(path.join(run.reports, "results.json"), JSON.stringify(results, null, 2));
    console.log(JSON.stringify({ name, exitCode: result.exitCode, signal: result.signal }));
    if (result.exitCode !== 0 || result.signal || result.error) throw Error(`${name} failed; inspect run logs`);
  } finally { fs.closeSync(out); fs.closeSync(err); }
}
(async () => {
  let exitCode = 1;
  try {
    console.log(JSON.stringify({ lifecycleId: run.lifecycleId, runRoot: run.runRoot, outputs: run.outputs }));
    // r1 established an unrelated pre-existing receipt/HEAD mismatch. This is
    // raw source test evidence, not imported-source or product provenance acceptance.
    const frozen = path.join(run.outputs, "engine");
    const names = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "engine/"],
      { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }).split("\0").filter(Boolean).map(p => p.slice("engine/".length)).sort();
    const inventory = base => names.map(name => ({ path: name, sha256: sha(path.join(base, name)) }));
    const before = inventory(path.join(root, "engine"));
    fs.writeFileSync(path.join(run.reports, "source-inputs.json"), JSON.stringify({ kind: "raw-tracked-source-tests",
      importedProvenanceAccepted: false, preExistingBlocker: "mcp-lazy-r1/provenance-record",
      repositoryHead: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(), files: before }, null, 2));
    for (const name of names) {
      const source = path.join(root, "engine", name), destination = path.join(frozen, name);
      if (!fs.lstatSync(source).isFile()) throw Error(`Snapshot requires a reviewed regular source: ${name}`);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
      if (sha(source) !== sha(destination)) throw Error(`Snapshot copy mismatch: ${name}`);
    }
    if (JSON.stringify(before) !== JSON.stringify(inventory(path.join(root, "engine"))) ||
        JSON.stringify(before) !== JSON.stringify(inventory(frozen))) throw Error("Source changed while freezing raw test inputs");
    const scriptNames = ["check-mcp-lazy-startup.cjs", "test-mcp-lazy-startup.cjs", "cargo-verification.cjs",
      "cargo-target-owner.cjs", "cargo-test-preparation.cjs", "test-cargo-verification.cjs",
      ...fs.readdirSync(path.join(root, "scripts")).filter(name => /^check-.*\.cjs$/.test(name) && name !== "check-mcp-lazy-startup.cjs")];
    const scriptIdentity = {};
    for (const name of scriptNames) {
      const destination = path.join(run.outputs, "scripts", name);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(path.join(root, "scripts", name), destination, fs.constants.COPYFILE_EXCL);
      scriptIdentity[name] = sha(destination);
    }
    fs.writeFileSync(path.join(run.reports, "scripts.json"), JSON.stringify(scriptIdentity, null, 2));
    await command("wrapper", process.execPath, ["--test", path.join(run.outputs, "scripts/test-mcp-lazy-startup.cjs"),
      path.join(run.outputs, "scripts/test-cargo-verification.cjs")]);
    await command("native", process.execPath, [path.join(run.outputs, "scripts/check-mcp-lazy-startup.cjs"), frozen]);
    if (JSON.stringify(before) !== JSON.stringify(inventory(frozen))) throw Error("Frozen source changed during verification");
    for (const name of scriptNames) if (sha(path.join(run.outputs, "scripts", name)) !== scriptIdentity[name]) throw Error(`Frozen wrapper changed: ${name}`);
    exitCode = 0;
  } catch (error) { console.error(error.stack); }
  finally { finishArtifactRun(run, { exitCode, producerStopped: true }); process.exitCode = exitCode; }
})();
