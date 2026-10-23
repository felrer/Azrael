"use strict";
// User-authorized metadata reconciliation; never edits engine implementation files.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn, execFileSync } = require("node:child_process");
const { beginArtifactRun, finishArtifactRun, trackArtifactChild } = require("../../scripts/artifact-run.cjs");
const root = path.resolve(__dirname, "../..");
const runId = process.argv[2];
if (!/^mcp-provenance-r[1-9][0-9]*$/.test(runId || "")) throw Error("Fresh mcp-provenance-rN ID required");
const run = beginArtifactRun(root, { workId: "DJ-01", owner: "DJ-01-mcp-lazy", runId });
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const git = (...args) => execFileSync("git", args, { cwd: root, maxBuffer: 16 * 1024 * 1024 });
const python = "C:/Users/felre/AppData/Local/Programs/Python/Python313/python.exe";
const env = { ...process.env, TEMP: run.temporary, TMP: run.temporary, TMPDIR: run.temporary };
async function command(name, args) {
  const startedUtc = new Date().toISOString();
  const out = fs.openSync(path.join(run.logs, `${name}.stdout.log`), "wx");
  const err = fs.openSync(path.join(run.logs, `${name}.stderr.log`), "wx");
  try {
    const child = trackArtifactChild(run, spawn(python, ["-B", ...args], { cwd: root, env, windowsHide: true, stdio: ["ignore", out, err] }));
    const result = await new Promise(resolve => {
      let error;
      child.once("error", e => { error = e.message; });
      child.once("close", (exitCode, signal) => resolve({ name, startedUtc, finishedUtc: new Date().toISOString(), exitCode, signal, error }));
    });
    fs.appendFileSync(path.join(run.reports, "commands.jsonl"), JSON.stringify(result) + "\n");
    console.log(JSON.stringify(result));
    if (result.exitCode !== 0 || result.signal || result.error) throw Error(`${name} failed; inspect logs`);
  } finally { fs.closeSync(out); fs.closeSync(err); }
}
(async () => {
  let exitCode = 1;
  try {
    const receiptBytes = fs.readFileSync(path.join(root, "engine/SOURCE.json"));
    const receipt = JSON.parse(receiptBytes);
    const causal = fs.readFileSync(path.join(__dirname, "evidence/mcp-lazy-r1/provenance-record.stderr.log"), "utf8");
    const paths = [...causal.match(/actual=\[(.*?)\], expected=/)[1].matchAll(/'([^']+)'/g)].map(match => match[1]);
    if (paths.length !== 144 || new Set(paths).size !== 144) throw Error("Reviewed initial 144-path delta required");
    const coverageError = path.join(root, "artifacts/tasks/DJ-01/runs/mcp-provenance-r1/logs/record.stderr.log");
    if (fs.existsSync(coverageError)) {
      const extra = fs.readFileSync(coverageError, "utf8").match(/Destination coverage differs: extra=\[(.*?)\], missing=\[\]/);
      if (extra) paths.push(...[...extra[1].matchAll(/'([^']+)'/g)].map(match => match[1]));
    }
    if (![144, 182].includes(paths.length) || new Set(paths).size !== paths.length) throw Error("Unexpected coverage delta");
    const own = new Set(["codex-rs/core/src/session/mcp_runtime.rs", "codex-rs/core/tests/suite/mcp_tool_cache.rs"]);
    const concurrentPolicy = ".github/scripts/verify_cargo_workspace_manifests.py";
    const review = paths.map(name => {
      const current = fs.readFileSync(path.join(root, "engine", name));
      const head = git("show", `HEAD:engine/${name}`);
      if (!own.has(name) && name !== concurrentPolicy && sha(current) !== sha(head)) throw Error(`Unreviewed uncommitted delta: ${name}`);
      if (name === concurrentPolicy && sha(current) !== sha(head)) {
        const expected = head.toString().replace('            "dep:sha2",', '            "dep:sha2",\r\n            "dep:data-encoding",')
          .replace('        "sha2", "anyhow",', '        "sha2", "data-encoding", "anyhow",');
        if (expected.replace(/\r\n/g, "\n") !== current.toString().replace(/\r\n/g, "\n")) throw Error("Unexpected concurrent manifest policy delta");
      }
      return { path: name, recorded: receipt.files[name] ?? null, currentSha256: sha(current), headSha256: sha(head),
        classification: own.has(name) ? "MCP implementation" : sha(current) === sha(head) ? "existing committed integration" : "reviewed concurrent manifest policy" };
    });
    fs.writeFileSync(path.join(run.reports, "review.json"), JSON.stringify({ userAuthorization: "2026-10-23 existing changes review and provenance metadata reconciliation",
      repositoryHead: git("rev-parse", "HEAD").toString().trim(), currentReceiptSha256: sha(receiptBytes), paths: review }, null, 2));
    await command("record", ["scripts/record-engine-local-changes.py", "--destination", path.join(root, "engine"),
      "--baseline", path.join(root, "artifacts/inputs/engine-original-import-12a1dbfc"),
      "--baseline-receipt-sha256", "12a1dbfc1725df7d4e87de4e336e0b8dab217aecbe7d26b624d1e264356b00b6",
      "--current-receipt-sha256", sha(receiptBytes), ...paths.flatMap(name => ["--expected-path", name])]);
    await command("snapshot", ["scripts/engine-provenance.py", "snapshot", "--root", path.join(root, "engine"), "--file", path.join(run.reports, "source.json")]);
    exitCode = 0;
  } catch (error) { console.error(error.stack); }
  finally { finishArtifactRun(run, { exitCode, producerStopped: true }); process.exitCode = exitCode; }
})();
