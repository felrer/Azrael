"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const lifecycle = require("../../scripts/artifact-lifecycle.cjs");
const root = path.resolve(__dirname, "../..");
const [action, runId] = process.argv.slice(2);
assert(/^mcp-(?:lazy|provenance)-r[1-9][0-9]*$/.test(runId || ""));
const id = `run:DJ-01:${runId}`;
if (action === "request") {
  const record = lifecycle.catalog(root).find(record => record.id === id);
  assert.equal(record.owner, "DJ-01-mcp-lazy");
  assert.equal(record.producer.status, "stopped");
  assert.notEqual(record.producer.outcome, "unknown");
  const runRoot = path.join(root, "artifacts/tasks/DJ-01/runs", runId);
  const outputRoot = path.join(root, "artifacts/build", runId);
  const producer = JSON.parse(fs.readFileSync(path.join(runRoot, "reports/producer.json"), "utf8"));
  assert.equal(producer.producerStopped, true);
  assert(producer.children.every(child => child.closed));
  const retained = path.join(__dirname, "evidence", runId);
  fs.mkdirSync(retained, { recursive: true });
  for (const name of ["producer.json", "results.json", "scripts.json", "review.json", "commands.jsonl", "source.json"]) {
    const source = path.join(runRoot, "reports", name);
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(retained, name), fs.constants.COPYFILE_EXCL);
  }
  for (const name of ["provenance-record.stderr.log", "wrapper.stdout.log", "wrapper.stderr.log", "native.stdout.log", "native.stderr.log", "record.stderr.log", "snapshot.stderr.log"]) {
    const source = path.join(runRoot, "logs", name);
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(retained, name), fs.constants.COPYFILE_EXCL);
  }
  const inputs = path.join(runRoot, "reports/source-inputs.json");
  if (fs.existsSync(inputs)) {
    const raw = fs.readFileSync(inputs), parsed = JSON.parse(raw);
    fs.writeFileSync(path.join(retained, "source-summary.json"), JSON.stringify({ kind: parsed.kind,
      importedProvenanceAccepted: parsed.importedProvenanceAccepted, repositoryHead: parsed.repositoryHead,
      completeInputManifestSha256: crypto.createHash("sha256").update(raw).digest("hex"), fileCount: parsed.files.length,
      changedInputs: parsed.files.filter(file => ["codex-rs/core/src/session/mcp_runtime.rs", "codex-rs/core/tests/suite/mcp_tool_cache.rs"].includes(file.path)) }, null, 2));
  }
  // The external output was planned and created by beginArtifactRun. Its flags
  // were unspecified, never protected=false; reconcile only that exact owned root.
  if (runId.startsWith("mcp-lazy-")) {
    const outputs = record.members.find(member => member.role === "outputs");
    assert.equal(outputs.path, outputRoot);
    assert.notEqual(outputs.generated, false);
    assert.notEqual(outputs.protection_known, false);
    lifecycle.recordLifecycle(root, { ...record, expected_revision: record.revision,
      members: record.members.map(member => member.role === "outputs"
        ? { ...member, generated: true, protection_known: true } : member) });
  }
  const request = lifecycle.registerRequest(root, id);
  delete request.operation;
  console.log(JSON.stringify(request));
} else if (action === "finalize") console.log(JSON.stringify(lifecycle.finalize(root, id)));
else throw Error("Explicit request or finalize required");
