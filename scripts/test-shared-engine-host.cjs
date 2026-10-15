"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), crypto = require("node:crypto");
const { verifyEngine, requiresManualResume, windowContext } = require("./shared-engine-host.cjs");

test("engine bytes must match the preparation receipt", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "azrael-shared-hash-"));
  try {
    const engine = path.join(root, "engine"); fs.writeFileSync(engine, "synthetic native engine");
    const runtime = { engine, sharedEngine: true, sharedEngineProtocol: 1,
      engineSha256: crypto.createHash("sha256").update("synthetic native engine").digest("hex") };
    await verifyEngine(runtime);
    await assert.rejects(verifyEngine({ ...runtime, engineSha256: "0".repeat(64) }), /immutable build receipt/);
    assert.throws(() => windowContext(runtime, { sessionId: "a", hostPid: 1, workspacePath: root,
      accountStateFile: "relative", accountDefaultFile: null }), /absolute/);
  } finally { fs.rmSync(root, { recursive: true }); }
});

test("manual-resume marker is read-only, scoped by home, and fail-closed", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "azrael-shared-manual-"));
  try {
    const id = "11111111-1111-4111-8111-111111111111";
    const file = path.join(root, "azrael/runtime/manual-resume.json");
    assert.equal(requiresManualResume(root, id), false);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const bytes = JSON.stringify({ schema: 1, threads: [id] }); fs.writeFileSync(file, bytes);
    assert.equal(requiresManualResume(root, id), true);
    assert.equal(requiresManualResume(path.join(root, "other-home"), id), false);
    assert.equal(fs.readFileSync(file, "utf8"), bytes);
    for (const malformed of ["{", '{"schema":2,"threads":[]}', '{"schema":1,"threads":["invalid"]}']) {
      fs.writeFileSync(file, malformed); assert.equal(requiresManualResume(root, id), true);
    }
    fs.unlinkSync(file); fs.mkdirSync(file); assert.equal(requiresManualResume(root, id), true);
  } finally { fs.rmSync(root, { recursive: true }); }
});
