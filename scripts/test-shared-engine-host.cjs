"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), crypto = require("node:crypto");
const { verifyEngine, resolveEngineEndpoint, requiresManualResume, windowContext } = require("./shared-engine-host.cjs");

test("engine bytes must match the preparation receipt", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "azrael-shared-hash-"));
  try {
    const engine = path.join(root, "engine"); fs.writeFileSync(engine, "synthetic native engine");
    const runtime = { engine, sharedEngine: true, sharedEngineProtocol: 2,
      engineSha256: crypto.createHash("sha256").update("synthetic native engine").digest("hex") };
    await verifyEngine(runtime);
    await assert.rejects(verifyEngine({ ...runtime, engineSha256: "0".repeat(64) }), /immutable build receipt/);
    assert.throws(() => windowContext(runtime, { sessionId: "a", hostPid: 1, workspacePath: root,
      accountStateFile: "relative", accountDefaultFile: null }), /absolute/);
  } finally { fs.rmSync(root, { recursive: true }); }
});

test("native endpoint discovery verifies release, isolates discovery context, and caches the descriptor", async () => {
  const runtime = { engine: process.execPath, sharedEngine: true, sharedEngineProtocol: 2,
    engineVersion: "0.162.0", engineSha256: crypto.createHash("sha256").update(fs.readFileSync(process.execPath)).digest("hex"),
    env: { CODEX_HOME: path.join(os.tmpdir(), "selected-azrael-home"), KEEP: "yes",
      AZRAEL_EX_WINDOW_CONTEXT: "stale authority", AZRAEL_EX_MANAGEMENT_SOCKET: "old socket",
      azrael_ex_management_socket: "old lowercase socket" } };
  const descriptor = { schema: 2, instanceId: "a".repeat(64), socketPath: path.join(os.tmpdir(), "native-release", "control.sock"),
    engineVersion: runtime.engineVersion, engineIdentity: runtime.engineSha256 };
  const originalEnvironment = { ...process.env };
  let calls = 0;
  const execFile = (engine, args, options, callback) => {
    calls++;
    assert.equal(engine, runtime.engine);
    assert.deepEqual(args, ["-c", "features.code_mode_host=true", "app-server", "--analytics-default-enabled", "--azrael-engine-endpoint"]);
    assert.equal(options.env.CODEX_HOME, runtime.env.CODEX_HOME);
    assert.equal(options.env.KEEP, "yes");
    assert.equal(options.env.AZRAEL_EX_WINDOW_CONTEXT, undefined);
    assert.equal(options.env.AZRAEL_EX_MANAGEMENT_SOCKET, undefined);
    assert.equal(options.env.azrael_ex_management_socket, undefined);
    assert.equal(options.maxBuffer, 16384);
    assert.equal(options.windowsHide, true);
    callback(null, JSON.stringify(descriptor), "");
    return { kill() {} };
  };
  const [first, second] = await Promise.all([resolveEngineEndpoint(runtime, { execFile }), resolveEngineEndpoint(runtime, { execFile })]);
  assert.equal(first, second);
  assert.deepEqual(first, descriptor);
  assert.equal(calls, 1);
  assert.equal(runtime.socket, descriptor.socketPath);
  assert.equal(runtime.env.AZRAEL_EX_MANAGEMENT_SOCKET, descriptor.socketPath);
  assert.equal(runtime.engineInstanceId, descriptor.instanceId);
  assert.equal(runtime.env.AZRAEL_EX_WINDOW_CONTEXT, "stale authority");
  assert.deepEqual({ ...process.env }, originalEnvironment);

  const makeRuntime = () => ({ ...runtime, socket: undefined, env: { ...runtime.env, AZRAEL_EX_MANAGEMENT_SOCKET: undefined } });
  for (const output of ["{", JSON.stringify({ ...descriptor, schema: 1 }), JSON.stringify({ ...descriptor, instanceId: "BAD" }),
    JSON.stringify({ ...descriptor, socketPath: "relative.sock" }), JSON.stringify({ ...descriptor, engineVersion: "0.0.0" }),
    JSON.stringify({ ...descriptor, engineIdentity: "b".repeat(64) }), " ".repeat(16385)]) {
    const invalid = makeRuntime();
    await assert.rejects(resolveEngineEndpoint(invalid, { execFile(_engine, _args, _options, callback) { callback(null, output, ""); } }),
      /descriptor|discovery failed/);
    assert.equal(invalid.socket, undefined);
    assert.equal(invalid.env.AZRAEL_EX_MANAGEMENT_SOCKET, undefined);
  }
  const failed = makeRuntime();
  await assert.rejects(resolveEngineEndpoint(failed, { execFile(_engine, _args, _options, callback) {
    callback(Object.assign(new Error("nonzero exit"), { code: 9 }), JSON.stringify(descriptor), "error");
  } }), /discovery failed/);
  let killed = false;
  await assert.rejects(resolveEngineEndpoint(makeRuntime(), { timeoutMs: 10,
    execFile() { return { kill() { killed = true; } }; } }), error => /timed out/.test(error.cause?.message));
  assert.equal(killed, true);
  let launched = false;
  await assert.rejects(resolveEngineEndpoint({ ...makeRuntime(), engineSha256: "0".repeat(64) }, {
    execFile() { launched = true; },
  }), /immutable build receipt/);
  assert.equal(launched, false);
  await assert.rejects(resolveEngineEndpoint({ ...makeRuntime(), sharedEngineProtocol: 1 }), /protocol 2/);
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
