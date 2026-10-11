import assert from "node:assert/strict";
import * as path from "node:path";
import test from "node:test";
import { AppServerTransport } from "../src/appServerTransport";

function transport(mode = "normal", options: { requestTimeoutMs?: number; maxLineBytes?: number } = {}): AppServerTransport {
  return new AppServerTransport({
    executable: process.execPath,
    args: [path.join(__dirname, "appServer-fixture.js")],
    cwd: __dirname,
    env: { ...process.env, FIXTURE_MODE: mode },
    clientInfo: { name: "azrael", version: "0.1.0" },
    ...options
  });
}

function event(target: AppServerTransport, name: string): Promise<unknown[]> {
  return new Promise((resolve) => target.once(name, (...args: unknown[]) => resolve(args)));
}

test("initializes once, exchanges requests and notifications, and exposes process state", async () => {
  const server = transport();
  try {
    const ready = event(server, "notification");
    assert.deepEqual(await server.start(), { userAgent: "fixture" });
    assert.deepEqual(await ready, ["fixture/ready", { initialized: true }]);
    assert.equal(server.isConnected, true);
    assert.ok(server.pid && server.pid > 0);
    await assert.rejects(server.start(), /cannot be started again/);
    const notice = event(server, "notification");
    assert.deepEqual(await server.request("fixture/roundtrip", { hello: "world" }), { received: { hello: "world" }, requestCount: 1 });
    assert.deepEqual(await notice, ["fixture/event", { ok: true }]);
    const notified = event(server, "notification");
    server.notify("fixture/notification", { x: 1 });
    assert.deepEqual(await notified, ["fixture/notified", { x: 1 }]);
  } finally { server.dispose(); }
  assert.equal(server.isConnected, false);
  assert.equal(server.pid, undefined);
});

test("server requests require one explicit response or error", async () => {
  const server = transport();
  try {
    await server.start();
    const incoming = event(server, "serverRequest");
    server.notify("fixture/serverRequest");
    assert.deepEqual(await incoming, ["approval-1", "item/commandExecution/requestApproval", { command: "echo fixture" }]);
    const reply = event(server, "notification");
    server.respond("approval-1", { decision: "decline" });
    assert.deepEqual(await reply, ["fixture/replied", { result: { decision: "decline" } }]);
    assert.throws(() => server.respond("approval-1", {}), /already answered/);
    const next = event(server, "serverRequest");
    server.notify("fixture/serverRequest");
    await next;
    const error = event(server, "notification");
    server.respondError("approval-1", -32000, "declined");
    assert.deepEqual(await error, ["fixture/replied", { error: { code: -32000, message: "declined" } }]);
  } finally { server.dispose(); }
});

test("disconnect and timeout reject pending mutations without replay", async () => {
  for (const mode of ["disconnect", "normal"] as const) {
    // Process startup can be delayed by the concurrent Rust build; the
    // mutation's explicit timeout below is the behavior under test.
    const server = transport(mode, { requestTimeoutMs: 10_000 });
    try {
      await server.start();
      const disconnected = mode === "disconnect" ? event(server, "disconnect") : undefined;
      await assert.rejects(server.request("fixture/mutate", { irreversible: true }, mode === "disconnect" ? 1000 : 30), mode === "disconnect" ? /disconnected/ : /outcome is uncertain/);
      if (disconnected) await disconnected;
      if (mode === "disconnect") await assert.rejects(server.request("fixture/roundtrip"), /disconnected/);
      else assert.deepEqual(await server.request("fixture/count"), { mutationCount: 1 });
    } finally { server.dispose(); }
  }
});

test("malformed and oversized lines disconnect without retaining raw output", async () => {
  for (const [mode, expected] of [["invalid", /invalid JSON/], ["oversized", /line exceeded limit/]] as const) {
    const server = transport(mode, { maxLineBytes: 256 });
    try {
      await server.start();
      await assert.rejects(server.request("fixture/mutate", { secret: "do-not-log" }), expected);
      assert.equal(server.isConnected, false);
      assert.ok(!server.diagnosticSummary.join(" ").includes("do-not-log"));
    } finally { server.dispose(); }
  }
});

test("supervised app-server restarts after SIGKILL and performs a new handshake", async () => {
  const server = new AppServerTransport({
    executable: process.execPath, args: [path.join(__dirname, "appServer-fixture.js")],
    cwd: __dirname, env: { ...process.env, FIXTURE_MODE: "normal" },
    clientInfo: { name: "azrael", version: "0.1.0" }, restartDelayMs: 10,
  });
  try {
    await server.start();
    const firstPid = server.pid!;
    const oldChild = (server as any).child;
    const originalWrite = oldChild.stdin.write.bind(oldChild.stdin);
    let delayedWriteError: ((error: Error) => void) | undefined;
    oldChild.stdin.write = (data: string, callback: (error: Error) => void) => {
      delayedWriteError = callback;
      return originalWrite(data, () => {});
    };
    server.notify("fixture/notification");
    const reconnected = event(server, "reconnect");
    process.kill(firstPid, "SIGKILL");
    await reconnected;
    assert.notEqual(server.pid, firstPid);
    assert.equal(server.isConnected, true);
    assert.ok(delayedWriteError);
    delayedWriteError(new Error("late write error from terminated child"));
    assert.equal(server.isConnected, true, "old write callback cannot disconnect the new child");
    assert.deepEqual(await server.request("fixture/roundtrip", { recovered: true }),
      { received: { recovered: true }, requestCount: 1 });
    const disconnected = event(server, "disconnect");
    process.kill(server.pid!, "SIGKILL");
    await disconnected;
    server.dispose();
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(server.pid, undefined, "disposal cancels the pending restart");
  } finally { server.dispose(); }
});
