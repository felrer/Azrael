import assert from "node:assert/strict";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import test from "node:test";
import { BridgeTransport } from "../src/bridgeTransport";

test("a bridge exit rejects an in-flight request instead of replaying it", async () => {
  const fixture = path.join(__dirname, "bridge-fixture.js");
  const transport = new BridgeTransport({ executable: process.execPath, socket: fixture, env: process.env, requestTimeoutMs: 2_000 });
  await transport.start();
  await assert.rejects(transport.request("azrael/account", { action: "remove", profileId: "p1" }), /bridge disconnected/);
  transport.dispose();
});

test("requests fail immediately while disconnected", async () => {
  const transport = new BridgeTransport({ executable: process.execPath, socket: "unused", env: process.env });
  await assert.rejects(transport.request("azrael/account", { action: "list" }), /disconnected/);
});

test("invalid bridge output terminates the child and emits one disconnect", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "azrael-bridge-test-"));
  const pidFile = path.join(directory, "pid");
  const fixture = path.join(__dirname, "bridge-fixture.js");
  const transport = new BridgeTransport({ executable: process.execPath, socket: fixture, env: { ...process.env, FIXTURE_MODE: "invalid", FIXTURE_PID_FILE: pidFile } });
  let disconnects = 0;
  transport.on("disconnect", () => disconnects++);
  try {
    await transport.start();
    await assert.rejects(transport.request("azrael/account", { action: "list" }), /invalid JSON/);
    const pid = Number(fs.readFileSync(pidFile, "utf8"));
    await waitUntil(() => !isAlive(pid));
    assert.equal(disconnects, 1);
  } finally {
    transport.dispose();
    fs.rmSync(directory, { recursive: true, force: true });
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
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function isAlive(pid: number): boolean { try { process.kill(pid, 0); return true; } catch { return false; } }
async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 50; i++) { if (predicate()) return; await new Promise((resolve) => setTimeout(resolve, 10)); }
  assert.fail("child process remained alive");
}
