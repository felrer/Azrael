import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { AccountService } from "../src/accountService";

test("startup retries a transient bridge failure without publishing a terminal error", async () => {
  await withFixture(async ({ options, attempts }) => {
    const service = new AccountService({ ...options("first-failure"), reconnectDelaysMs: [5] });
    const errors: string[] = [];
    service.on("errorState", (error: string) => errors.push(error));
    try {
      const connection = service.connect();
      assert.equal(service.connect(), connection);
      const state = await connection;
      assert.equal(state.instanceId, "fixture-instance");
      assert.equal(attempts(), 2);
      assert.deepEqual(errors, []);
      assert.equal(service.error, undefined);
      assert.equal(service.changesEnabled, true);
    } finally {
      service.dispose();
    }
  });
});

test("accepts the release's newer engine version without changing account code", async () => {
  await withFixture(async ({ options }) => {
    const fixtureOptions = options("service");
    fixtureOptions.expectedServerVersion = "0.157.1";
    fixtureOptions.env.FIXTURE_SERVER_VERSION = "0.157.1";
    const service = new AccountService(fixtureOptions);
    try {
      await service.connect();
      assert.equal(service.changesEnabled, true);
    } finally {
      service.dispose();
    }
  });
});

test("an early valid account notification is ignored until initial identity verification completes", async () => {
  await withFixture(async ({ options }) => {
    const service = new AccountService({ ...options("early-notification"), reconnectDelaysMs: [] });
    const errors: string[] = [];
    service.on("errorState", (error: string) => errors.push(error));
    try {
      const state = await service.connect();
      assert.equal(state.instanceId, "fixture-instance");
      assert.deepEqual(errors, []);
      assert.equal(service.changesEnabled, true);
    } finally {
      service.dispose();
    }
  });
});

test("a later successful connection clears a prior terminal error", async () => {
  await withFixture(async ({ options, attempts }) => {
    const fixtureOptions = options("always-fail");
    const service = new AccountService({ ...fixtureOptions, reconnectDelaysMs: [] });
    const errors: string[] = [];
    service.on("errorState", (error: string) => errors.push(error));
    try {
      await assert.rejects(service.connect(), /bridge disconnected/);
      assert.match(service.error ?? "", /bridge disconnected/);
      fixtureOptions.env.FIXTURE_MODE = "service";
      await service.connect();
      assert.equal(attempts(), 2);
      assert.equal(service.error, undefined);
      assert.equal(service.changesEnabled, true);
      assert.equal(errors.length, 1);
    } finally {
      service.dispose();
    }
  });
});

test("startup publishes and rejects only after transient retries are exhausted", async () => {
  await withFixture(async ({ options, attempts }) => {
    const service = new AccountService({ ...options("always-fail"), reconnectDelaysMs: [5, 5] });
    const errors: string[] = [];
    service.on("errorState", (error: string) => errors.push(error));
    try {
      await assert.rejects(service.connect(), /bridge disconnected/);
      assert.equal(attempts(), 3);
      assert.equal(errors.length, 1);
      assert.match(errors[0], /bridge disconnected/);
    } finally {
      service.dispose();
    }
  });
});

test("dispose cancels a pending startup retry", async () => {
  await withFixture(async ({ options, attempts }) => {
    const service = new AccountService({ ...options("always-fail"), reconnectDelaysMs: [150] });
    const errors: string[] = [];
    service.on("errorState", (error: string) => errors.push(error));
    const connection = service.connect();
    await waitUntil(() => attempts() === 1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    service.dispose();
    await assert.rejects(connection, /disposed/);
    await new Promise((resolve) => setTimeout(resolve, 170));
    assert.equal(attempts(), 1);
    assert.deepEqual(errors, []);
  });
});

for (const [mode, expected] of [
  ["identity-mismatch", /CODEX_HOME does not match/],
  ["state-home-mismatch", /Account state belongs to a different CODEX_HOME/],
  ["version-mismatch", /Unsupported engine version/]
] as const) {
  test(`${mode} fails closed without retrying`, async () => {
    await withFixture(async ({ options, attempts }) => {
      const service = new AccountService({ ...options(mode), reconnectDelaysMs: [5, 5] });
      const errors: string[] = [];
      service.on("errorState", (error: string) => errors.push(error));
      try {
        await assert.rejects(service.connect(), expected);
        assert.equal(attempts(), 1);
        assert.equal(errors.length, 1);
      } finally {
        service.dispose();
      }
    });
  });
}

test("a reconnected bridge from another engine instance fails closed without retrying", async () => {
  await withFixture(async ({ options, attempts }) => {
    const service = new AccountService({ ...options("instance-mismatch"), reconnectDelaysMs: [5, 5] });
    const errors: string[] = [];
    service.on("errorState", (error: string) => errors.push(error));
    try {
      await service.connect();
      await assert.rejects(service.call({ action: "switch", profileId: "a".repeat(32) }), /outcome is uncertain/);
      await waitUntil(() => errors.length === 1);
      assert.equal(attempts(), 2);
      assert.match(errors[0], /different engine instance/);
      assert.equal(service.changesEnabled, false);
    } finally {
      service.dispose();
    }
  });
});

test("an owned engine restart re-verifies the new instance without replaying mutations", async () => {
  await withFixture(async ({ options, requestLog }) => {
    const service = new AccountService({ ...options("instance-mismatch"), reconnectDelaysMs: [5, 5] });
    const errors: string[] = [];
    service.on("errorState", (error: string) => errors.push(error));
    try {
      await service.connect();
      await assert.rejects(service.call({ action: "switch", profileId: "a".repeat(32) }), /outcome is uncertain/);
      await waitUntil(() => errors.length === 1);
      const state = await service.reconnectAfterEngineRestart();
      assert.equal(state.instanceId, "other-instance");
      assert.equal(service.changesEnabled, true);
      assert.equal(requestLog().filter(request => request.endsWith(":switch")).length, 1);
    } finally { service.dispose(); }
  });
});

test("explicit refresh shares initial identity verification and preserves a healthy bridge", async () => {
  await withFixture(async ({ options, attempts, requestLog }) => {
    const service = new AccountService({ ...options("service"), reconnectDelaysMs: [] });
    try {
      const connecting = service.connect();
      const refresh = service.refresh(true);
      const [connected, refreshed] = await Promise.all([connecting, refresh]);
      assert.equal(refreshed, connected);
      assert.equal(attempts(), 1);
      assert.deepEqual(requestLog(), ["1:list"]);
      await service.refresh(true);
      assert.equal(attempts(), 1);
      assert.deepEqual(requestLog(), ["1:list", "1:list"]);
      assert.equal(service.changesEnabled, true);
    } finally { service.dispose(); }
  });
});

test("only explicit refresh recovers a terminal protocol disconnect and concurrent refreshes share recovery", async () => {
  await withFixture(async ({ options, attempts, requestLog }) => {
    const service = new AccountService({ ...options("protocol-disconnect"), reconnectDelaysMs: [5, 5] });
    try {
      await service.connect();
      await assert.rejects(service.call({ action: "switch", profileId: "a".repeat(32) }), /outcome is uncertain/);
      assert.equal(service.changesEnabled, false);
      await assert.rejects(service.refresh(), /bridge is disconnected/);
      assert.equal(attempts(), 1);
      assert.deepEqual(requestLog(), ["1:list", "1:switch"]);
      const [first, second] = await Promise.all([service.refresh(true), service.refresh(true)]);
      assert.equal(first, second);
      assert.equal(first.instanceId, "fixture-instance");
      assert.equal(attempts(), 2);
      assert.equal(service.error, undefined);
      assert.equal(service.changesEnabled, true);
      assert.deepEqual(requestLog(), ["1:list", "1:switch", "2:list"]);
      await service.refresh();
      assert.equal(attempts(), 2);
      assert.deepEqual(requestLog(), ["1:list", "1:switch", "2:list", "2:list"]);
    } finally { service.dispose(); }
  });
});

test("explicit refresh after protocol disconnect rejects another engine instance without replaying the mutation", async () => {
  await withFixture(async ({ options, attempts, requestLog }) => {
    const service = new AccountService({ ...options("protocol-instance-mismatch"), reconnectDelaysMs: [5, 5] });
    try {
      await service.connect();
      await assert.rejects(service.call({ action: "switch", profileId: "a".repeat(32) }), /outcome is uncertain/);
      await assert.rejects(service.refresh(true), /different engine instance/);
      assert.equal(attempts(), 2);
      assert.equal(service.state?.instanceId, "fixture-instance");
      assert.equal(service.changesEnabled, false);
      await assert.rejects(service.refresh(), /bridge is disconnected/);
      await assert.rejects(service.call({ action: "switch", profileId: "a".repeat(32) }), /bridge is disconnected/);
      assert.deepEqual(requestLog(), ["1:list", "1:switch", "2:list"]);
    } finally { service.dispose(); }
  });
});

test("an established disconnect reconnects without replaying a mutation", async () => {
  await withFixture(async ({ options, attempts, requestLog }) => {
    const service = new AccountService({ ...options("mutation-disconnect"), reconnectDelaysMs: [5, 5] });
    const errors: string[] = [];
    service.on("errorState", (error: string) => errors.push(error));
    try {
      await service.connect();
      await assert.rejects(service.call({ action: "switch", profileId: "a".repeat(32) }), /outcome is uncertain/);
      await waitUntil(() => requestLog().filter((request) => request.endsWith(":list")).length === 2 && service.changesEnabled);
      const requests = requestLog();
      assert.equal(requests.filter((request) => request.endsWith(":switch")).length, 1);
      assert.equal(requests.filter((request) => request.endsWith(":list")).length, 2);
      assert.deepEqual(errors, []);
    } finally {
      service.dispose();
    }
  });
});

test("Devin RPC is blocked while a reconnect is awaiting identity verification", async () => {
  await withFixture(async ({ options, requestLog }) => {
    const service = new AccountService({ ...options("delayed-reconnect"), reconnectDelaysMs: [5, 5] });
    try {
      await service.connect();
      await assert.rejects(service.call({ action: "switch", profileId: "a".repeat(32) }), /outcome is uncertain/);
      await waitUntil(() => requestLog().filter((request) => request.endsWith(":list")).length === 2);
      await assert.rejects(service.devin("login"), /connection has not been verified/);
      assert.equal(requestLog().filter((request) => request.endsWith(":login")).length, 0);
      await waitUntil(() => service.changesEnabled);
    } finally {
      service.dispose();
    }
  });
});

async function withFixture(
  run: (fixture: {
    options(mode: string): { executable: string; socket: string; codexHome: string; expectedServerVersion: string; env: NodeJS.ProcessEnv };
    attempts(): number;
    requestLog(): string[];
  }) => Promise<void>
): Promise<void> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "azrael-account-service-"));
  const attemptFile = path.join(directory, "attempts");
  const logFile = path.join(directory, "requests.log");
  const codexHome = path.join(directory, "home");
  const socket = path.join(__dirname, "account-service-fixture.js");
  try {
    await run({
      options: (mode) => ({
        executable: process.execPath,
        socket,
        codexHome,
        expectedServerVersion: "0.154.0-alpha.6.2",
        env: {
          ...process.env,
          FIXTURE_MODE: mode,
          FIXTURE_ATTEMPT_FILE: attemptFile,
          FIXTURE_REQUEST_LOG: logFile,
          FIXTURE_CODEX_HOME: codexHome
        }
      }),
      attempts: () => fs.existsSync(attemptFile) ? Number(fs.readFileSync(attemptFile, "utf8")) : 0,
      requestLog: () => fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8").trim().split(/\r?\n/).filter(Boolean) : []
    });
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("condition was not reached");
}

test("reservation snapshots from an earlier connection cannot replace recovered state", async () => {
  const service = new AccountService({ executable: "unused", socket: "unused", codexHome: "unused", expectedServerVersion: "unused", env: {} });
  let resolveOld!: (value: unknown) => void;
  const old = { request: () => new Promise(resolve => { resolveOld = resolve; }), dispose() {} };
  const fresh = { request: async () => ({ reservations: [] }), dispose() {} };
  Object.assign(service, { transport: old, transportVerified: true, instanceId: "fixture" });
  try {
    const pending = service.rootResume({ action: "list" });
    Object.assign(service, { transport: fresh });
    await service.rootResume({ action: "list" });
    resolveOld({ reservations: [] });
    await assert.rejects(pending, /connection changed/);
    assert.deepEqual(service.rootResumeReservations, []);
  } finally { service.dispose(); }
});

test("out-of-order reservation reads preserve the latest successful snapshot", async () => {
  const service = new AccountService({ executable: "unused", socket: "unused", codexHome: "unused", expectedServerVersion: "unused", env: {} });
  const replies: Array<(value: unknown) => void> = [];
  const transport = { request: () => new Promise(resolve => { replies.push(resolve); }), dispose() {} };
  Object.assign(service, { transport, transportVerified: true, instanceId: "fixture" });
  const reservation = {
    id: "stale", rootThreadId: "root", originatingTurnId: "turn", rootTurnId: "turn", callId: "call", resumeTurnId: "resume",
    resumeAtMs: 10, createdAtMs: 1, updatedAtMs: 1, revision: 1, state: "waiting", agentTasks: [], reason: "fixture", wakeReason: null, lastError: null
  };
  let updates = 0; service.on("rootResume", () => updates++);
  try {
    const older = service.rootResume({ action: "list" });
    const newer = service.rootResume({ action: "list" });
    replies[1]({ reservations: [] }); await newer;
    replies[0]({ reservations: [reservation] }); await older;
    assert.deepEqual(service.rootResumeReservations, []);
    assert.equal(updates, 1);
  } finally { service.dispose(); }
});

test("engine readiness gates bridge spawn inside the startup deadline", async () => {
  await withFixture(async ({ options, attempts }) => {
    let ready!: () => void;
    let signal: AbortSignal | undefined;
    const gate = new Promise<void>(resolve => { ready = resolve; });
    const service = new AccountService({ ...options("service"), startupTimeoutMs: 2_000, waitForEngineReady: async (remaining, cancellation) => { assert.ok(remaining <= 2_000); signal = cancellation; await gate; } });
    try {
      const connection = service.connect();
      await new Promise(resolve => setTimeout(resolve, 30));
      assert.equal(attempts(), 0);
      assert.equal(service.changesEnabled, false);
      assert.equal(signal?.aborted, false);
      ready();
      await connection;
      assert.equal(attempts(), 1);
    } finally { service.dispose(); }
  });
});

test("readiness deadline and disposal cancel without spawning a bridge", async () => {
  await withFixture(async ({ options, attempts }) => {
    for (const dispose of [false, true]) {
      let signal: AbortSignal | undefined;
      const service = new AccountService({ ...options("service"), startupTimeoutMs: 40, waitForEngineReady: async (_remaining, cancellation) => { signal = cancellation; await new Promise(() => undefined); } });
      const connection = service.connect();
      if (dispose) { await new Promise(resolve => setTimeout(resolve, 5)); service.dispose(); }
      await assert.rejects(connection, dispose ? /disposed/ : /timed out/);
      assert.equal(signal?.aborted, true);
      assert.equal(attempts(), 0);
      service.dispose();
    }
  });
});

for (const mode of ["permission-denied", "protocol-error"]) {
  test(`${mode} stops retries even when native marks it retryable`, async () => {
    await withFixture(async ({ options, attempts }) => {
      const service = new AccountService({ ...options(mode), reconnectDelaysMs: [1, 1] });
      try { await assert.rejects(service.connect()); assert.equal(attempts(), 1); assert.equal(service.changesEnabled, false); }
      finally { service.dispose(); }
    });
  });
}

test("the single deadline includes the initial account identity query", async () => {
  await withFixture(async ({ options, attempts, requestLog }) => {
    const service = new AccountService({ ...options("delayed-list"), startupTimeoutMs: 1500, reconnectDelaysMs: [1, 1] });
    const started = performance.now();
    try {
      await assert.rejects(service.connect(), /timed out/);
      assert.ok(performance.now() - started < 2500);
      assert.equal(attempts(), 1);
      assert.deepEqual(requestLog(), ["1:list"]);
      assert.equal(service.changesEnabled, false);
    } finally { service.dispose(); }
  });
});

test("production retries continue beyond three delays until startup succeeds", async () => {
  await withFixture(async ({ options, attempts }) => {
    const service = new AccountService({ ...options("four-failures"), startupTimeoutMs: 16_000 });
    try { await service.connect(); assert.equal(attempts(), 5); assert.equal(service.changesEnabled, true); }
    finally { service.dispose(); }
  });
});
