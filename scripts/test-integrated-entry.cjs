"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

// Source lifecycle regression; completed packages separately verify exact entry bytes.
const wrapperPath = path.join(__dirname, "integrated-azrael-entry.cjs");
const wrapper = fs.readFileSync(wrapperPath, "utf8");

test("integrated entry preserves activation, account storage migration and failure cleanup", async () => {
  const inheritedWindowContext = process.env.AZRAEL_EX_WINDOW_CONTEXT;
  const wrapperTestRoot = fs.mkdtempSync(path.join(os.tmpdir(), "azrael-wrapper-test-"));
  let wrapperFixtureIndex = 0;

  function wrapperFixture({ accountActivationError, sessionId = "11111111-1111-4111-8111-111111111111",
    fallbackUuid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", windowControl, desktopControl = true, remoteName,
    hostPlatform = "win32", localHistory, historyError, sharedEngine = false, endpointError,
    runtimeReady, runtimeError } = {}) {
    const fixtureRoot = path.join(wrapperTestRoot, `fixture-${++wrapperFixtureIndex}`);
    const events = [];
    const recovery = { listener: undefined, disposed: false };
    const context = {
      extension: { packageJSON: { version: "2026.0.6" } },
      marker: "shared-context",
      subscriptions: [],
      storageUri: { scheme: "file", fsPath: path.join(fixtureRoot, "workspace-storage") },
      globalStorageUri: { scheme: "file", fsPath: path.join(fixtureRoot, "global-storage") },
    };
    const runtimeEnvironment = { EXISTING_VALUE: "preserved", CODEX_HOME: path.join(fixtureRoot, "state") };
    const engine = path.join(fixtureRoot, "engine-fixture");
    if (sharedEngine) { fs.mkdirSync(fixtureRoot, { recursive: true }); fs.writeFileSync(engine, "synthetic engine"); }
    const runtime = { marker: "shared-runtime", windowControl, localHistory, env: runtimeEnvironment,
      sharedEngine, sharedEngineProtocol: 2, engine, engineVersion: "0.162.0", codexHome: path.join(fixtureRoot, "state"),
      engineSha256: crypto.createHash("sha256").update("synthetic engine").digest("hex") };
    const nativeApi = { marker: "native-api" };
    const nativeExtension = {
      async activate(value) {
        if (sharedEngine) {
          assert.equal(runtime.socket, path.join(fixtureRoot, "native-release", "control.sock"));
          assert.equal(runtime.env.AZRAEL_EX_MANAGEMENT_SOCKET, runtime.socket);
          assert.ok(runtime.env.AZRAEL_EX_WINDOW_CONTEXT);
        }
        events.push(["native.activate", value, runtime.env.AZRAEL_EX_ACCOUNT_STATE_FILE,
          runtime.env.AZRAEL_EX_ACCOUNT_DEFAULT_FILE,
          fs.existsSync(runtime.env.AZRAEL_EX_ACCOUNT_DEFAULT_FILE)
            ? fs.readFileSync(runtime.env.AZRAEL_EX_ACCOUNT_DEFAULT_FILE, "utf8") : undefined]);
        return nativeApi;
      },
      async deactivate() { events.push(["native.deactivate"]); },
    };
    const accountUi = {
      async activate(receivedContext, receivedRuntime) {
        events.push(["account.activate", receivedContext, receivedRuntime]);
        if (accountActivationError) throw accountActivationError;
      },
      async deactivate() { events.push(["account.deactivate"]); },
      async reconnectAfterEngineRestart() { events.push(["account.reconnect"]); },
    };
    const module = { exports: {} };
    let runtimeValidated = false;
    const loads = [];
    vm.runInNewContext(wrapper, {
      module,
      exports: module.exports,
      AggregateError,
      Promise,
      process: { platform: hostPlatform, pid: process.pid },
      require(request) {
        if (request === "node:path") return path;
        if (request === "node:crypto") return { createHash: crypto.createHash, randomUUID: () => fallbackUuid };
        if (request === "node:fs/promises") return fs.promises;
        if (request === "vscode") return { env: { sessionId, remoteName }, ProgressLocation: { Window: 10 }, window: {
          createOutputChannel() { return { appendLine(value) { events.push(["history.output", value]); } }; },
          withProgress(_options, task) { return task(); },
        } };
        if (request === "./out/local-history-host.cjs") return { async sync(receivedRuntime, _output, options) {
          assert.equal(receivedRuntime, runtime);
          assert.equal(options.appVersion, context.extension.packageJSON.version);
          events.push(["history.sync"]);
          if (historyError) throw historyError;
          return { imported: 1 };
        } };
        if (request === "./out/extension.js" || request === "./account-ui/dist/src/extension.js") {
          assert.equal(runtimeValidated, true, "native modules require completed runtime validation");
          if (sharedEngine) assert.ok(runtime.socket, "native modules require the shared endpoint");
          loads.push(request);
          return request === "./out/extension.js" ? nativeExtension : accountUi;
        }
        if (request === "./out/platform-runtime.cjs") return { validateRuntimePlatform: () => ({ desktopControl }) };
        if (request === "./out/azrael-runtime.cjs") return { async initialize() {
          await runtimeReady;
          if (runtimeError) throw runtimeError;
          runtimeValidated = true;
          return runtime;
        } };
        if (request === "./out/shared-engine-host.cjs") {
          const shared = require("./shared-engine-host.cjs");
          return { ...shared, resolveEngineEndpoint: receivedRuntime => shared.resolveEngineEndpoint(receivedRuntime, {
            execFile(_engine, _args, options, callback) {
              events.push(["endpoint.resolve"]);
              assert.equal(options.env.AZRAEL_EX_WINDOW_CONTEXT, undefined);
              assert.equal(receivedRuntime.env.AZRAEL_EX_ACCOUNT_STATE_FILE, undefined);
              callback(endpointError, JSON.stringify({ schema: 2, instanceId: "a".repeat(64),
                socketPath: path.join(fixtureRoot, "native-release", "control.sock"),
                engineVersion: runtime.engineVersion, engineIdentity: runtime.engineSha256 }), "");
            },
          }) };
        }
        if (request === "./out/azrael-recovery.cjs") return { initialize: () => ({ dispose() {} }) };
        if (request === "./out/linux-native-supervision.cjs") return { onRestart(listener) {
          recovery.listener = listener;
          return { dispose() { recovery.listener = undefined; recovery.disposed = true; } };
        } };
        if (request === "./out/window-control-host.cjs") return { initialize: (receivedContext, receivedVscode, receivedRuntime) => {
          events.push(["window.initialize"]);
          assert.equal(receivedContext, context);
          assert.equal(receivedRuntime, runtime);
          assert.equal(receivedVscode.env.sessionId, sessionId);
          return { dispose() {} };
        } };
        throw new Error(`wrapper required unexpected module ${request}`);
      },
    }, { filename: wrapperPath });
    assert.deepEqual(loads, [], "loading the entry must not load native modules");
    return { api: module.exports, events, context, runtime, nativeApi, recovery, loads };
  }

  function writeOldAccountState(root, scope, contents, modified) {
    const filename = path.join(root, scope, "azrael-account-state.json");
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, contents, "utf8");
    fs.utimesSync(filename, modified, modified);
    return filename;
  }

  async function testWrapperLifecycle() {
    let releaseRuntime;
    const gated = wrapperFixture({ runtimeReady: new Promise(resolve => { releaseRuntime = resolve; }) });
    const activation = gated.api.activate(gated.context);
    await Promise.resolve();
    assert.deepEqual(gated.loads, []);
    assert.deepEqual(gated.events, []);
    releaseRuntime();
    await activation;
    assert.equal(gated.loads.length, 2);
    assert.equal(gated.events[0][0], "native.activate");
    await gated.api.deactivate();
    const invalidRuntime = wrapperFixture({ runtimeError: new Error("runtime integrity failure") });
    await assert.rejects(invalidRuntime.api.activate(invalidRuntime.context), /runtime integrity failure/);
    assert.deepEqual(invalidRuntime.loads, []);
    assert.deepEqual(invalidRuntime.events, []);
    const unavailableEndpoint = wrapperFixture({ sharedEngine: true, endpointError: new Error("discovery failed") });
    await assert.rejects(unavailableEndpoint.api.activate(unavailableEndpoint.context), /endpoint discovery failed/);
    assert.deepEqual(unavailableEndpoint.events.map(event => event[0]), ["endpoint.resolve"]);
    assert.deepEqual(unavailableEndpoint.loads, []);
    assert.equal(unavailableEndpoint.runtime.env.AZRAEL_EX_ACCOUNT_STATE_FILE, undefined);
    assert.equal(fs.existsSync(unavailableEndpoint.context.globalStorageUri.fsPath), false);
    const sharedA = wrapperFixture({ sharedEngine: true, sessionId: "window-A" });
    const sharedB = wrapperFixture({ sharedEngine: true, sessionId: "window-B" });
    sharedB.context.storageUri = sharedA.context.storageUri;
    await sharedA.api.activate(sharedA.context); await sharedB.api.activate(sharedB.context);
    assert.equal(sharedA.events[0][0], "endpoint.resolve");
    assert.equal(sharedA.events[1][0], "native.activate");
    const a = JSON.parse(sharedA.runtime.env.AZRAEL_EX_WINDOW_CONTEXT);
    const b = JSON.parse(sharedB.runtime.env.AZRAEL_EX_WINDOW_CONTEXT);
    assert.notEqual(a.ownerId, b.ownerId); assert.equal(a.workspaceId, b.workspaceId);
    assert.equal(a.hostPid, process.pid); assert.equal(a.engineIdentity, sharedA.runtime.engineSha256);
    assert.equal(a.role, "window"); assert.equal(a.schema, 1);
    assert.notEqual(a.accountStateFile, b.accountStateFile);
    assert.equal(a.accountDefaultFile, b.accountDefaultFile);
    assert.equal(process.env.AZRAEL_EX_WINDOW_CONTEXT, inheritedWindowContext);
    await sharedA.api.deactivate(); await sharedB.api.deactivate();
    const reopened = wrapperFixture({ sharedEngine: true, sessionId: "window-A-reopened" });
    reopened.context.storageUri = sharedA.context.storageUri;
    await reopened.api.activate(reopened.context);
    const reopenedContext = JSON.parse(reopened.runtime.env.AZRAEL_EX_WINDOW_CONTEXT);
    assert.notEqual(reopenedContext.ownerId, a.ownerId);
    assert.equal(reopenedContext.workspaceId, a.workspaceId);
    await reopened.api.deactivate();
    for (const historyError of [undefined, new Error("private path and content must not be logged")]) {
      const importing = wrapperFixture({ localHistory: { sourceHome: "/fixture/source" }, historyError, hostPlatform: "linux", desktopControl: false });
      assert.equal(await importing.api.activate(importing.context), importing.nativeApi);
      assert.equal(importing.events[0][0], "history.sync");
      assert.ok(importing.events.some(event => event[0] === "native.activate"));
      assert.ok(importing.events.some(event => event[0] === "account.activate"));
      assert.equal(importing.events.filter(event => event[0] === "history.output").length, historyError ? 1 : 0);
      assert.equal(JSON.stringify(importing.events).includes("private path and content"), false);
      await importing.api.deactivate();
    }
    const originalProcessEnvironment = process.env.AZRAEL_EX_ACCOUNT_STATE_FILE;
    const originalDefaultEnvironment = process.env.AZRAEL_EX_ACCOUNT_DEFAULT_FILE;
    for (const windowControl of [undefined, null]) {
      const disabled = wrapperFixture({ windowControl });
      await disabled.api.activate(disabled.context);
      assert.equal(disabled.events.some(event => event[0] === "window.initialize"), false);
      await disabled.api.deactivate();
    }
    const unix = wrapperFixture({ windowControl: {}, desktopControl: false });
    await unix.api.activate(unix.context);
    assert.equal(unix.events.some(event => event[0] === "window.initialize"), false);
    await unix.api.deactivate();
    const verifiedLinux = wrapperFixture({ windowControl: { acceptanceVerified: true }, desktopControl: false, hostPlatform: "linux" });
    await verifiedLinux.api.activate(verifiedLinux.context);
    assert.equal(verifiedLinux.events.some(event => event[0] === "window.initialize"), false,
      "Linux Window Use must remain disabled even with a previously verified runtime");
    assert.equal(verifiedLinux.runtime.windowControl, undefined);
    verifiedLinux.recovery.listener();
    assert.equal(verifiedLinux.events.filter(event => event[0] === "account.reconnect").length, 1);
    await verifiedLinux.api.deactivate();
    assert.equal(verifiedLinux.recovery.disposed, true);
    assert.equal(verifiedLinux.recovery.listener, undefined);
    for (const hostPlatform of ["linux", "darwin"]) {
      const unavailable = wrapperFixture({ windowControl: { acceptanceVerified: true }, desktopControl: true, hostPlatform });
      await unavailable.api.activate(unavailable.context);
      assert.equal(unavailable.events.some(event => event[0] === "window.initialize"), false,
        "non-Windows hosts must not offer Window Use even with stale desktop capabilities");
      assert.equal(unavailable.runtime.windowControl, undefined);
      await unavailable.api.deactivate();
    }
    const desktop = wrapperFixture({ windowControl: {} });
    await desktop.api.activate(desktop.context);
    assert.equal(desktop.events.some(event => event[0] === "window.initialize"), true);
    await desktop.api.deactivate();
    const success = wrapperFixture();
    assert.equal(await success.api.activate(success.context), success.nativeApi,
      "integration wrapper did not preserve the native activation API");
    const successSessionScope = crypto.createHash("sha256")
      .update("11111111-1111-4111-8111-111111111111", "utf8").digest("hex");
    const workspaceStateFile = path.join(success.context.storageUri.fsPath, "window",
      successSessionScope, "azrael-account-state.json");
    const workspaceDefaultFile = path.join(success.context.storageUri.fsPath, "default",
      "azrael-account-state.json");
    assert.deepEqual(success.events.slice(0, 2), [
      ["native.activate", success.context, workspaceStateFile, workspaceDefaultFile, undefined],
      ["account.activate", success.context, success.runtime],
    ], "integration wrapper activation order or injected instances differed");
    assert.equal(success.runtime.env.AZRAEL_EX_ACCOUNT_STATE_FILE, workspaceStateFile,
      "workspace account selection did not use extension workspace storage");
    assert.equal(success.runtime.env.AZRAEL_EX_ACCOUNT_DEFAULT_FILE, workspaceDefaultFile,
      "workspace account default did not use stable extension workspace storage");
    assert.equal(success.runtime.env.EXISTING_VALUE, "preserved", "wrapper replaced the host runtime environment");
    assert.equal(process.env.AZRAEL_EX_ACCOUNT_STATE_FILE, originalProcessEnvironment,
      "wrapper changed the ordinary process environment");
    assert.equal(process.env.AZRAEL_EX_ACCOUNT_DEFAULT_FILE, originalDefaultEnvironment,
      "wrapper changed the ordinary process default environment");

    const otherWorkspace = wrapperFixture();
    otherWorkspace.context.storageUri = { scheme: "file", fsPath: path.resolve("other-workspace-storage") };
    await otherWorkspace.api.activate(otherWorkspace.context);
    assert.notEqual(otherWorkspace.runtime.env.AZRAEL_EX_ACCOUNT_STATE_FILE,
      success.runtime.env.AZRAEL_EX_ACCOUNT_STATE_FILE, "different workspaces shared account selection state");
    assert.notEqual(otherWorkspace.runtime.env.AZRAEL_EX_ACCOUNT_DEFAULT_FILE,
      success.runtime.env.AZRAEL_EX_ACCOUNT_DEFAULT_FILE, "different workspaces shared the durable account default");

    const duplicateWorkspace = wrapperFixture({ sessionId: "22222222-2222-4222-8222-222222222222" });
    duplicateWorkspace.context.storageUri = success.context.storageUri;
    await duplicateWorkspace.api.activate(duplicateWorkspace.context);
    assert.notEqual(duplicateWorkspace.runtime.env.AZRAEL_EX_ACCOUNT_STATE_FILE,
      success.runtime.env.AZRAEL_EX_ACCOUNT_STATE_FILE, "duplicate workspace windows shared account selection state");
    assert.equal(duplicateWorkspace.runtime.env.AZRAEL_EX_ACCOUNT_DEFAULT_FILE,
      success.runtime.env.AZRAEL_EX_ACCOUNT_DEFAULT_FILE,
      "different sessions for one workspace did not share the durable account default");
    const reloadedWorkspace = wrapperFixture();
    reloadedWorkspace.context.storageUri = success.context.storageUri;
    await reloadedWorkspace.api.activate(reloadedWorkspace.context);
    assert.equal(reloadedWorkspace.runtime.env.AZRAEL_EX_ACCOUNT_STATE_FILE,
      success.runtime.env.AZRAEL_EX_ACCOUNT_STATE_FILE, "stable VS Code session ID changed account selection scope");
    assert.equal(reloadedWorkspace.runtime.env.AZRAEL_EX_ACCOUNT_DEFAULT_FILE, workspaceDefaultFile,
      "reloaded workspace did not retain its durable account default path");

    const emptyWindow = wrapperFixture({ sessionId: "33333333-3333-4333-8333-333333333333" });
    emptyWindow.context.storageUri = undefined;
    await emptyWindow.api.activate(emptyWindow.context);
    const emptyWindowSessionScope = crypto.createHash("sha256")
      .update("33333333-3333-4333-8333-333333333333", "utf8").digest("hex");
    const emptyWindowStateFile = path.join(emptyWindow.context.globalStorageUri.fsPath, "empty-window",
      emptyWindowSessionScope, "azrael-account-state.json");
    assert.equal(emptyWindow.runtime.env.AZRAEL_EX_ACCOUNT_STATE_FILE, emptyWindowStateFile,
      "empty window account selection did not use its session-specific global-storage scope");
    const emptyWindowDefaultFile = path.join(emptyWindow.context.globalStorageUri.fsPath,
      "empty-window-default", "azrael-account-state.json");
    assert.equal(emptyWindow.runtime.env.AZRAEL_EX_ACCOUNT_DEFAULT_FILE, emptyWindowDefaultFile,
      "empty window account default did not use stable global storage");
    assert.notEqual(emptyWindow.runtime.env.AZRAEL_EX_ACCOUNT_STATE_FILE,
      success.runtime.env.AZRAEL_EX_ACCOUNT_STATE_FILE, "empty window shared workspace account selection state");
    const otherEmptyWindow = wrapperFixture({ sessionId: "44444444-4444-4444-8444-444444444444" });
    otherEmptyWindow.context.storageUri = undefined;
    await otherEmptyWindow.api.activate(otherEmptyWindow.context);
    assert.notEqual(otherEmptyWindow.runtime.env.AZRAEL_EX_ACCOUNT_STATE_FILE,
      emptyWindow.runtime.env.AZRAEL_EX_ACCOUNT_STATE_FILE, "different empty windows shared account selection state");
    const sharedEmptyWindow = wrapperFixture({ sessionId: "66666666-6666-4666-8666-666666666666" });
    sharedEmptyWindow.context.storageUri = undefined;
    sharedEmptyWindow.context.globalStorageUri = emptyWindow.context.globalStorageUri;
    await sharedEmptyWindow.api.activate(sharedEmptyWindow.context);
    assert.equal(sharedEmptyWindow.runtime.env.AZRAEL_EX_ACCOUNT_DEFAULT_FILE,
      emptyWindow.runtime.env.AZRAEL_EX_ACCOUNT_DEFAULT_FILE,
      "empty-window sessions using one global storage did not share the durable account default");

    const unavailableSession = wrapperFixture({ sessionId: null,
      fallbackUuid: "55555555-5555-4555-8555-555555555555" });
    unavailableSession.context.storageUri = undefined;
    await unavailableSession.api.activate(unavailableSession.context);
    assert.equal(unavailableSession.runtime.env.AZRAEL_EX_ACCOUNT_STATE_FILE,
      path.join(unavailableSession.context.globalStorageUri.fsPath, "empty-window",
        "55555555-5555-4555-8555-555555555555", "azrael-account-state.json"),
    "unavailable VS Code session ID did not use the per-window fallback UUID");

    for (const scope of ["workspace", "global"]) {
      const local = wrapperFixture();
      const field = scope === "workspace" ? "storageUri" : "globalStorageUri";
      if (scope === "global") local.context.storageUri = undefined;
      local.context[field] = { ...local.context[field], scheme: "vscode-userdata", authority: "" };
      await local.api.activate(local.context);
      assert(local.runtime.env.AZRAEL_EX_ACCOUNT_STATE_FILE.startsWith(local.context[field].fsPath + path.sep),
        "local VS Code user data must keep its selected storage path");
      await local.api.deactivate();
    }
    const remote = wrapperFixture({ remoteName: "ssh-remote" });
    remote.context.storageUri = { ...remote.context.storageUri, scheme: "vscode-userdata", authority: "" };
    await assert.rejects(remote.api.activate(remote.context), /absolute file/);
    assert.equal(remote.events.length, 0, "remote user data reached native activation");

    for (const [label, invalidContext] of [
      ["non-file workspace storage", { ...success.context, storageUri: { scheme: "untitled", fsPath: "ignored" } }],
      ["relative workspace storage", { ...success.context, storageUri: { scheme: "file", fsPath: "relative" } }],
      ["non-file global storage", { ...success.context, storageUri: undefined,
        globalStorageUri: { scheme: "vscode-userdata", fsPath: "ignored" } }],
      ["authority-bearing user data", { ...success.context,
        storageUri: { scheme: "vscode-userdata", authority: "remote", fsPath: path.resolve("storage") } }],
      ["relative user data", { ...success.context,
        storageUri: { scheme: "vscode-userdata", authority: "", fsPath: "relative" } }],
    ]) {
      const invalid = wrapperFixture();
      await assert.rejects(invalid.api.activate(invalidContext), /absolute file|absolute file-system/,
        `${label} was accepted for account selection state`);
      assert.equal(invalid.events.length, 0, `${label} reached native activation`);
    }
    const opaqueSessionId = "window/../opaque:session?with=path\\characters";
    const opaqueSession = wrapperFixture({ sessionId: opaqueSessionId });
    opaqueSession.context.storageUri = success.context.storageUri;
    await opaqueSession.api.activate(opaqueSession.context);
    const opaqueScope = crypto.createHash("sha256").update(opaqueSessionId, "utf8").digest("hex");
    assert.equal(opaqueSession.runtime.env.AZRAEL_EX_ACCOUNT_STATE_FILE,
      path.join(opaqueSession.context.storageUri.fsPath, "window", opaqueScope, "azrael-account-state.json"),
      "opaque VS Code session ID was not safely hashed into the account selection scope");

    const newestMigration = wrapperFixture();
    const migrationRoot = newestMigration.context.storageUri.fsPath;
    writeOldAccountState(path.join(migrationRoot, "window"), "older",
      JSON.stringify({ selectedProfileId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }), new Date("2026-01-01T00:00:00Z"));
    writeOldAccountState(path.join(migrationRoot, "window"), "newer",
      JSON.stringify({ selectedProfileId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", ignored: "remove-me" }),
      new Date("2026-01-02T00:00:00Z"));
    await newestMigration.api.activate(newestMigration.context);
    const migratedDefaultFile = path.join(migrationRoot, "default", "azrael-account-state.json");
    assert.deepEqual(JSON.parse(fs.readFileSync(migratedDefaultFile, "utf8")),
      { selectedProfileId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
      "newest valid old workspace session was not sanitized into the durable default");
    assert.equal(newestMigration.events[0][4],
      '{"selectedProfileId":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}\n',
      "workspace default migration did not finish before native activation");

    const invalidSkip = wrapperFixture();
    const invalidSkipRoot = invalidSkip.context.storageUri.fsPath;
    writeOldAccountState(path.join(invalidSkipRoot, "window"), "valid",
      JSON.stringify({ selectedProfileId: "cccccccccccccccccccccccccccccccc" }),
      new Date("2026-01-01T00:00:00Z"));
    writeOldAccountState(path.join(invalidSkipRoot, "window"), "invalid-shape",
      JSON.stringify({ selectedProfileId: "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC" }),
      new Date("2026-01-03T00:00:00Z"));
    writeOldAccountState(path.join(invalidSkipRoot, "window"), "unreadable-json", "{not-json",
      new Date("2026-01-02T00:00:00Z"));
    await invalidSkip.api.activate(invalidSkip.context);
    assert.deepEqual(JSON.parse(fs.readFileSync(invalidSkip.runtime.env.AZRAEL_EX_ACCOUNT_DEFAULT_FILE, "utf8")),
      { selectedProfileId: "cccccccccccccccccccccccccccccccc" },
      "invalid newer old sessions were not skipped during default migration");

    const existingDefault = wrapperFixture();
    const preservedText = '{"selectedProfileId":null,"existing":"preserve exactly"}\n';
    const existingDefaultFile = path.join(existingDefault.context.storageUri.fsPath, "default",
      "azrael-account-state.json");
    fs.mkdirSync(path.dirname(existingDefaultFile), { recursive: true });
    fs.writeFileSync(existingDefaultFile, preservedText, "utf8");
    writeOldAccountState(path.join(existingDefault.context.storageUri.fsPath, "window"), "newest",
      JSON.stringify({ selectedProfileId: "dddddddddddddddddddddddddddddddd" }),
      new Date("2026-01-04T00:00:00Z"));
    await existingDefault.api.activate(existingDefault.context);
    assert.equal(fs.readFileSync(existingDefaultFile, "utf8"), preservedText,
      "existing durable default with explicit null was overwritten");

    const emptyMigration = wrapperFixture();
    emptyMigration.context.storageUri = undefined;
    writeOldAccountState(path.join(emptyMigration.context.globalStorageUri.fsPath, "empty-window"), "old-empty",
      JSON.stringify({ selectedProfileId: null, ignored: true }), new Date("2026-01-05T00:00:00Z"));
    await emptyMigration.api.activate(emptyMigration.context);
    assert.deepEqual(JSON.parse(fs.readFileSync(emptyMigration.runtime.env.AZRAEL_EX_ACCOUNT_DEFAULT_FILE, "utf8")),
      { selectedProfileId: null }, "empty-window old session did not migrate to its durable default");

    await success.api.deactivate();
    assert(success.events.some(([event]) => event === "account.deactivate"), "wrapper did not dispose account UI");
    assert(success.events.some(([event]) => event === "native.deactivate"), "wrapper did not dispose native extension");

    const activationError = new Error("account activation failed");
    const failure = wrapperFixture({ accountActivationError: activationError });
    await assert.rejects(failure.api.activate(failure.context), (error) => error === activationError);
    assert(failure.events.some(([event]) => event === "account.deactivate"),
      "wrapper did not clean up account UI after account activation failure");
    assert(failure.events.some(([event]) => event === "native.deactivate"),
      "wrapper did not clean up native extension after account activation failure");
    assert.equal(process.env.AZRAEL_EX_ACCOUNT_STATE_FILE, originalProcessEnvironment,
      "wrapper changed the ordinary process environment during lifecycle checks");
    assert.equal(process.env.AZRAEL_EX_ACCOUNT_DEFAULT_FILE, originalDefaultEnvironment,
      "wrapper changed the ordinary process default environment during lifecycle checks");
  }
  try {
    await testWrapperLifecycle();
  } finally {
    assert.equal(path.dirname(path.resolve(wrapperTestRoot)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(wrapperTestRoot).startsWith("azrael-wrapper-test-"));
    fs.rmSync(wrapperTestRoot, { recursive: true });
  }
});
