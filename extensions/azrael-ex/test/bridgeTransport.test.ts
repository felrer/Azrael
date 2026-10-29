import assert from "node:assert/strict";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import test from "node:test";
import { BridgeError, BridgeTransport } from "../src/bridgeTransport";

test("a bridge exit rejects an in-flight request instead of replaying it", async () => {
  const fixture = path.join(__dirname, "bridge-fixture.js");
  const transport = new BridgeTransport({ executable: process.execPath, socket: fixture, env: process.env, requestTimeoutMs: 2_000 });
  await transport.start();
  await assert.rejects(transport.request("azrael/account", { action: "remove", profileId: "p1" }), /outcome is uncertain/);
  transport.dispose();
});

test("requests fail immediately while disconnected", async () => {
  const transport = new BridgeTransport({ executable: process.execPath, socket: "unused", env: process.env });
  await assert.rejects(transport.request("azrael/account", { action: "list" }), /disconnected/);
});

test("invalid bridge output terminates the child and emits one disconnect", async () => {
  const events: import("../src/bridgeTransport").BridgeDiagnostic[] = [];
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "azrael-bridge-test-"));
  const pidFile = path.join(directory, "pid");
  const fixture = path.join(__dirname, "bridge-fixture.js");
  const transport = new BridgeTransport({ executable: process.execPath, socket: fixture, env: { ...process.env, FIXTURE_MODE: "invalid", FIXTURE_PID_FILE: pidFile }, onDiagnostic: event => events.push(event) });
  let disconnects = 0;
  transport.on("disconnect", () => disconnects++);
  try {
    await transport.start();
    await assert.rejects(transport.request("azrael/account", { action: "list" }), (error: unknown) => {
      assert.ok(error instanceof BridgeError);
      assert.equal(error.protocolReason, "invalid_json");
      return true;
    });
    const pid = Number(fs.readFileSync(pidFile, "utf8"));
    await waitUntil(() => !isAlive(pid));
    assert.equal(disconnects, 1);
    assert.equal(events.length, 1);
    assert.equal(events[0].protocolReason, "invalid_json");
    assert.doesNotMatch(JSON.stringify(events), /credential|private\.invalid|arbitrary\/private-method/);
  } finally {
    transport.dispose();
    fs.rmSync(directory, { recursive: true });
  }
});

test("a mutation timeout reports uncertain outcome and terminates the bridge", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "azrael-bridge-timeout-"));
  const pidFile = path.join(directory, "pid");
  const fixture = path.join(__dirname, "bridge-fixture.js");
  const transport = new BridgeTransport({ executable: process.execPath, socket: fixture, env: { ...process.env, FIXTURE_MODE: "hang", FIXTURE_PID_FILE: pidFile }, requestTimeoutMs: 20 });
  try {
    await transport.start();
    await assert.rejects(transport.request("azrael/account", { action: "switch", profileId: "a".repeat(32) }), /outcome is uncertain/);
    const pid = Number(fs.readFileSync(pidFile, "utf8"));
    await waitUntil(() => !isAlive(pid));
  } finally {
    transport.dispose();
    fs.rmSync(directory, { recursive: true });
  }
});

function isAlive(pid: number): boolean { try { process.kill(pid, 0); return true; } catch { return false; } }
async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 50; i++) { if (predicate()) return; await new Promise((resolve) => setTimeout(resolve, 10)); }
  assert.fail("child process remained alive");
}

for (const [mode, protocolReason] of [
  ["native-error", undefined],
  ["unsafe-error", "invalid_native_error"],
  ["native-protocol-error", "native_bridge_error"],
  ["invalid-message", "invalid_message"],
  ["invalid-connected", "invalid_connected"],
] as const) {
  test(`${mode} keeps only safe structured native fields before exit`, async () => {
    const events: import("../src/bridgeTransport").BridgeDiagnostic[] = [];
    const transport = new BridgeTransport({ executable: process.execPath, socket: path.join(__dirname, "bridge-fixture.js"), env: { ...process.env, FIXTURE_MODE: mode }, attempt: 3, onDiagnostic: event => events.push(event) });
    try {
      await assert.rejects(transport.start(), (error: unknown) => {
        const failure = error as import("../src/bridgeTransport").BridgeError;
        assert.equal(failure.code, mode === "native-error" ? "permission_denied" : "protocol_error");
        assert.equal(failure.retryable, false);
        assert.equal(failure.protocolReason, protocolReason);
        return true;
      });
      assert.equal(events.length, 1);
      assert.equal(events[0].attempt, 3);
      assert.equal(typeof events[0].childPid, "number");
      assert.ok(events[0].elapsedMs >= 0);
      assert.equal(events[0].protocolReason, protocolReason);
      assert.equal(Object.hasOwn(events[0], "protocolReason"), protocolReason !== undefined);
      assert.doesNotMatch(JSON.stringify(events), /credential|private\.invalid|arbitrary\/private-method/);
    } finally { transport.dispose(); }
  });
}

test("request encoding failures record a safe reason without marking an unsent mutation uncertain", async () => {
  const events: import("../src/bridgeTransport").BridgeDiagnostic[] = [];
  const transport = new BridgeTransport({ executable: process.execPath, socket: path.join(__dirname, "bridge-fixture.js"), env: { ...process.env, FIXTURE_MODE: "hang" }, onDiagnostic: event => events.push(event) });
  try {
    await transport.start();
    const secret = "credential https://private.invalid/token arbitrary/private-method";
    const params = { action: "remove", toJSON() { throw new Error(secret); } };
    await assert.rejects(transport.request("azrael/account", params), (error: unknown) => {
      assert.ok(error instanceof BridgeError);
      assert.equal(error.code, "protocol_error");
      assert.equal(error.retryable, false);
      assert.equal(error.protocolReason, "request_encoding");
      assert.doesNotMatch(error.message, /uncertain|credential|private\.invalid/);
      return true;
    });
    assert.equal(events.length, 1);
    assert.equal(events[0].protocolReason, "request_encoding");
    assert.doesNotMatch(JSON.stringify(events), /credential|private\.invalid|arbitrary\/private-method|azrael\/account|remove/);
  } finally { transport.dispose(); }
});

test("a root resume mutation and parallel read get distinct failures on timeout", async () => {
  const transport = new BridgeTransport({ executable: process.execPath, socket: path.join(__dirname, "bridge-fixture.js"), env: { ...process.env, FIXTURE_MODE: "hang" } });
  try {
    await transport.start();
    const change = transport.request("azrael/rootResume", { action: "cancel" }, 30);
    const read = transport.request("azrael/account", { action: "list" }, 1_000);
    const results = await Promise.allSettled([change, read]);
    assert.equal(results[0].status, "rejected");
    assert.equal(results[1].status, "rejected");
    if (results[0].status === "rejected" && results[1].status === "rejected") {
      assert.match(results[0].reason.message, /outcome is uncertain/);
      assert.equal(results[0].reason.cause.code, "timeout");
      assert.equal(results[1].reason.code, "timeout");
      assert.doesNotMatch(results[1].reason.message, /uncertain/);
    }
  } finally { transport.dispose(); }
});

test("late process events from a disposed child cannot disconnect its replacement", async () => {
  const transport = new BridgeTransport({ executable: process.execPath, socket: path.join(__dirname, "bridge-fixture.js"), env: { ...process.env, FIXTURE_MODE: "hang" } });
  try {
    await transport.start();
    const old = (transport as unknown as { child: import("node:child_process").ChildProcess }).child;
    transport.dispose();
    const next = transport.start();
    old.emit("error", new Error("stale credential"));
    old.emit("close", 1, null);
    await next;
    const read = transport.request("azrael/account", { action: "list" }, 30);
    await assert.rejects(read, (error: unknown) => (error as import("../src/bridgeTransport").BridgeError).code === "timeout");
  } finally { transport.dispose(); }
});

test("business RPC errors reach the caller without entering diagnostics", async () => {
  const diagnostics: import("../src/bridgeTransport").BridgeDiagnostic[] = [];
  const transport = new BridgeTransport({ executable: process.execPath, socket: path.join(__dirname, "bridge-fixture.js"), env: { ...process.env, FIXTURE_MODE: "business-error" }, onDiagnostic: event => diagnostics.push(event) });
  try {
    await transport.start();
    await assert.rejects(transport.request("azrael/account", { action: "switch" }), { message: "Account switch is blocked by an active turn." });
    assert.deepEqual(diagnostics, []);
    assert.ok(!JSON.stringify(diagnostics).includes("active turn"));
  } finally { transport.dispose(); }
});
