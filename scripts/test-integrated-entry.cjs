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
  const wrapperTestRoot = fs.mkdtempSync(path.join(os.tmpdir(), "azrael-wrapper-test-"));
  let wrapperFixtureIndex = 0;

  function wrapperFixture({ accountActivationError, sessionId = "11111111-1111-4111-8111-111111111111",
    fallbackUuid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } = {}) {
    const fixtureRoot = path.join(wrapperTestRoot, `fixture-${++wrapperFixtureIndex}`);
    const events = [];
    const context = {
      marker: "shared-context",
      storageUri: { scheme: "file", fsPath: path.join(fixtureRoot, "workspace-storage") },
      globalStorageUri: { scheme: "file", fsPath: path.join(fixtureRoot, "global-storage") },
    };
    const runtimeEnvironment = { EXISTING_VALUE: "preserved" };
    const runtime = Object.freeze({ marker: "shared-runtime", env: runtimeEnvironment });
    const nativeApi = { marker: "native-api" };
    const nativeExtension = {
      async activate(value) {
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
    };
    const module = { exports: {} };
    vm.runInNewContext(wrapper, {
      module,
      exports: module.exports,
      AggregateError,
      Promise,
      require(request) {
        if (request === "node:path") return path;
        if (request === "node:crypto") return { createHash: crypto.createHash, randomUUID: () => fallbackUuid };
        if (request === "node:fs/promises") return fs.promises;
        if (request === "vscode") return { env: { sessionId } };
        if (request === "./out/extension.js") return nativeExtension;
        if (request === "./account-ui/dist/src/extension.js") return accountUi;
        if (request === "./out/azrael-runtime.cjs") return { runtime };
        if (request === "./out/azrael-recovery.cjs") return { initialize: () => ({ dispose() {} }) };
        if (request === "./out/window-control-host.cjs") return { initialize: (receivedContext, receivedVscode, receivedRuntime) => {
          assert.equal(receivedContext, context);
          assert.equal(receivedRuntime, runtime);
          assert.equal(receivedVscode.env.sessionId, sessionId);
          return { dispose() {} };
        } };
        throw new Error(`wrapper required unexpected module ${request}`);
      },
    }, { filename: wrapperPath });
    return { api: module.exports, events, context, runtime, nativeApi };
  }

  function writeOldAccountState(root, scope, contents, modified) {
    const filename = path.join(root, scope, "azrael-account-state.json");
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, contents, "utf8");
    fs.utimesSync(filename, modified, modified);
    return filename;
  }

  async function testWrapperLifecycle() {
    const originalProcessEnvironment = process.env.AZRAEL_EX_ACCOUNT_STATE_FILE;
    const originalDefaultEnvironment = process.env.AZRAEL_EX_ACCOUNT_DEFAULT_FILE;
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

    for (const [label, invalidContext] of [
      ["non-file workspace storage", { ...success.context, storageUri: { scheme: "untitled", fsPath: "ignored" } }],
      ["relative workspace storage", { ...success.context, storageUri: { scheme: "file", fsPath: "relative" } }],
      ["non-file global storage", { ...success.context, storageUri: undefined,
        globalStorageUri: { scheme: "vscode-userdata", fsPath: "ignored" } }],
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
