"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { test } = require("node:test");
const state = require("./preparation-state.cjs");
const zipToolFiles = ["companion/package-lock.json", "companion/node_modules/azrael-yazl/package.json",
  "companion/node_modules/azrael-yazl/index.js",
  "companion/node_modules/azrael-yazl/node_modules/buffer-crc32/package.json",
  "companion/node_modules/azrael-yazl/node_modules/buffer-crc32/index.js"];

function fixture(t) {
  const fixtureParent = path.resolve(process.env.AZRAEL_PREPARATION_STATE_TEST_ROOT || os.tmpdir());
  fs.mkdirSync(fixtureParent, { recursive: true });
  const root = fs.mkdtempSync(path.join(fixtureParent, "azrael-preparation-test-"));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), fixtureParent);
    assert.ok(path.basename(root).startsWith("azrael-preparation-test-"));
    fs.rmSync(root, { recursive: true });
    assert.equal(fs.existsSync(root), false);
  });
  const config = Object.fromEntries(["release", "source", "stateRoot", "sourceCodexHome", "toolDirectory"].map(name => [name, path.join(root, name)]));
  config.skipSnapshot = true;
  for (const directory of Object.values(config).filter(value => typeof value === "string")) fs.mkdirSync(directory);
  const write = (file, contents) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
  };
  write(path.join(config.source, "nested", "host.js"), "original");
  write(path.join(config.release, "engine.exe"), "engine");
  const build = { sha256: { "engine.exe": crypto.createHash("sha256").update("engine").digest("hex") } };
  write(path.join(config.release, "build-info.json"), JSON.stringify(build));
  for (const name of ["typescript/lib/typescript.js", "@vscode/vsce/out/package.js", "@vscode/vsce/out/secretLint.js"]) {
    write(path.join(config.toolDirectory, "companion/node_modules", name), "fixture tool");
  }
  for (const name of zipToolFiles) write(path.join(config.toolDirectory, name), "fixture ZIP tool");
  write(path.join(config.toolDirectory, "companion/node_modules/azrael-yazl/package.json"), JSON.stringify({name:"azrael-yazl",version:"1.0.0",main:"index.js"}));
  write(path.join(config.toolDirectory, "companion/node_modules/azrael-yazl/node_modules/buffer-crc32/package.json"), JSON.stringify({name:"buffer-crc32",version:"0.2.13",main:"index.js"}));
  const output = path.join(root, "output");
  fs.mkdirSync(output);
  return { root, config, output, write };
}
function failedConsumerFixture(t, exitCode = null) {
  const { root, write } = fixture(t), lifecycle = require("./artifact-lifecycle.cjs"), consumers = require("./module-cache-consumers.cjs");
  const command = require("./maintenance-owner-config.cjs").resolveMaintenanceCommand(path.resolve(__dirname, ".."));
  const inheritedOwner = process.env.AZRAEL_MAINTENANCE_OWNER, inheritedWait = process.env.AZRAEL_MAINTENANCE_LOCK_WAIT_MS;
  process.env.AZRAEL_MAINTENANCE_OWNER = command.executable;
  process.env.AZRAEL_MAINTENANCE_LOCK_WAIT_MS = String(command.maxLockWaitMs ?? 5000);
  t.after(() => {
    if (inheritedOwner === undefined) delete process.env.AZRAEL_MAINTENANCE_OWNER; else process.env.AZRAEL_MAINTENANCE_OWNER = inheritedOwner;
    if (inheritedWait === undefined) delete process.env.AZRAEL_MAINTENANCE_LOCK_WAIT_MS; else process.env.AZRAEL_MAINTENANCE_LOCK_WAIT_MS = inheritedWait;
  });
  const owner = path.join(root, "module-cache-owner"), project = path.join(owner, "artifacts", "a");
  const key = "f".repeat(64), versionId = "version:retirement-fixture";
  const release = path.join(project, "artifacts/releases/retirement-fixture");
  const deployLogs = path.join(project, "artifacts/logs/deploy-retirement-fixture");
  const evidence = path.join(project, "artifacts/maintenance/evidence/source-stop.json");
  const lock = path.join(owner, "artifacts/cache/modules/.lock");
  fs.mkdirSync(path.dirname(release), { recursive: true });
  fs.mkdirSync(deployLogs, { recursive: true });
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  if (process.platform === "win32") fs.writeFileSync(lock, ""); // The .NET owner normally leaves an empty lock.
  else require("./maintenance-lock-owner.cjs").acquire(lock, { operation: "fixture.module-cache", waitMs: 0 }).release();
  write(path.join(owner, "project-maintenance.json"), JSON.stringify({ schema_version: 1, project_id: "failed-consumer-fixture", managed_roots: ["artifacts"], bundles: [] }));
  const sourceEvidence = { schema: 1, action: "fixture-source-terminal", producer_stopped_verified: true, children_closed: true };
  write(evidence, JSON.stringify(sourceEvidence));
  const sourceReference = { id: `run:module-cache:companion:${key}`, reason: "companion-tool", kind: "dependency" };
  const retainedReference = { id: "version:runtime-consumer", reason: "installed runtime", kind: "installation" };
  const members = [
    { path: release, role: "release", generated: true, protection_known: true },
    { path: path.join(project, "artifacts/logs/retirement-fixture"), role: "build-logs", generated: true, protection_known: true },
    { path: deployLogs, role: "deploy-logs", generated: true, protection_known: true },
  ];
  const source = lifecycle.recordLifecycle(project, { id: versionId, kind: "version", owner: "azrael-release", version: "retirement-fixture",
    state: "pending", membership_complete: false, members, references: [sourceReference, retainedReference] });
  const proxy = consumers.attach(owner, project, versionId, "companion", key);
  const closed = lifecycle.closeLifecycle(project, versionId, { owner: source.owner, expected_revision: source.revision,
    producer_stopped_verified: true, outcome: "failure", exit_code: exitCode, reason: "Fixture stopped failed producer",
    evidence_ref: evidence, evidence_sha256: crypto.createHash("sha256").update(fs.readFileSync(evidence)).digest("hex") });
  return { root, owner, project, release, deployLogs, evidence, lock, key, versionId, sourceReference, retainedReference,
    source: closed, proxy, lifecycle, consumers, write };
}
function startPowerShellLock(pathname, script) {
  const child = spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
    { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  child.stdin.write(pathname + "\n");
  child.stdin.on("error", error => { if (error.code !== "EPIPE") child.emit("error", error); });
  let buffered = "", stderr = "";
  const lines = [];
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", chunk => {
    buffered += chunk;
    for (;;) {
      const index = buffered.indexOf("\n");
      if (index < 0) break;
      lines.push(buffered.slice(0, index).trim()); buffered = buffered.slice(index + 1);
    }
  });
  child.stderr.on("data", chunk => { stderr += chunk; });
  const nextLine = async () => {
    while (!lines.length) {
      if (child.exitCode !== null) throw new Error(`PowerShell lease probe exited ${child.exitCode}: ${stderr}`);
      await new Promise((resolve, reject) => {
        const onLine = () => { cleanup(); resolve(); };
        const onExit = code => { cleanup(); reject(new Error(`PowerShell lease probe exited ${code}: ${stderr}`)); };
        const cleanup = () => { child.stdout.off("data", onData); child.off("exit", onExit); };
        const onData = () => { if (lines.length) onLine(); };
        child.stdout.on("data", onData); child.once("exit", onExit);
      });
    }
    return lines.shift();
  };
  const close = async () => {
    if (child.exitCode === null) { child.stdin.write("release\n"); child.stdin.end(); }
    if (child.exitCode === null) await new Promise(resolve => child.once("close", resolve));
    return { exitCode: child.exitCode, stderr };
  };
  return { child, nextLine, close, get stderr() { return stderr; } };
}
function retireFailedProxyFixture(f, beforeFinalize = () => {}) {
  const { owner, lifecycle, proxy } = f;
  const command = require("./maintenance-owner-config.cjs").resolveMaintenanceCommand(owner);
  const invoke = request => {
    const result = require("node:child_process").spawnSync(command.executable,
      [...command.args, "--project-root", owner, "--request", "-"], { input: JSON.stringify({ ...request, lock_wait_ms: command.maxLockWaitMs }), encoding: "utf8", windowsHide: true });
    assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.equal(result.status, 0, result.stderr || result.stdout);
    return JSON.parse(result.stdout);
  };
  const registered = invoke(lifecycle.registerRequest(owner, proxy.id));
  const nativeReview = invoke({ operation: "review", group_ids: [proxy.id], verification: "registered" });
  assert.equal(nativeReview.items.length, 1); assert.deepEqual(nativeReview.items[0].blockers, []);
  const nativeApply = invoke({ operation: "apply", verification: "registered", decisions: nativeReview.items.map(item =>
    ({ id: item.id, token: item.token, decision: "delete", reason: "Retire the generated fixture consumer after exact source freeze." })) });
  assert.equal(nativeApply.results.length, 1);
  assert.equal(nativeApply.results[0].status, "deleted"); assert.equal(nativeApply.results[0].remaining, false);
  assert.equal(fs.existsSync(path.dirname(proxy.bindingPath)), false);
  const terminal = path.join(path.dirname(f.evidence), "proxy-native-terminal.json");
  f.write(terminal, JSON.stringify({ registered, nativeReview, nativeApply }));
  const hash = crypto.createHash("sha256").update(fs.readFileSync(terminal)).digest("hex");
  beforeFinalize(terminal, hash);
  assert.equal(lifecycle.finalize(owner, proxy.id).status, "finalized");
  return { terminal, hash };
}

test("unchanged preparation resumes and absent stages are explicit", async t => {
  const { config, output } = fixture(t);
  const initial = await state.initialize(output, config, false);
  assert.deepEqual(await state.initialize(output, config, true), initial);
  assert.deepEqual(await state.load(output, "namespace"), { found: false });
  assert.deepEqual(await state.load(output, "complete"), { found: false });
});

// Packaging policy objects may cross PowerShell/JSON boundaries with different key order.
test("preparation checkpoint ignores object order but preserves arrays and stored integrity", async t => {
  const { config, output, write } = fixture(t);
  config.sourceTestPolicy = { changedPaths: ["a", "b"], exhaustive: false };
  const initial = await state.initialize(output, config, false);
  const reordered = { ...config, sourceTestPolicy: { exhaustive: false, changedPaths: ["a", "b"] } };
  assert.deepEqual(await state.initialize(output, reordered, true), initial);
  await assert.rejects(state.initialize(output, { ...config, sourceTestPolicy: { changedPaths: ["b", "a"], exhaustive: false } }, true), /Preparation inputs changed/);
  const file = path.join(output, "preparation-state.json");
  const legacy = { ...initial, inputSha256: crypto.createHash("sha256").update(JSON.stringify(initial.inputs)).digest("hex") };
  write(file, JSON.stringify(legacy));
  assert.deepEqual(await state.initialize(output, reordered, true), legacy);
  legacy.inputs.config.skipSnapshot = false;
  write(file, JSON.stringify(legacy));
  await assert.rejects(state.initialize(output, config, true), /Preparation inputs changed/);
});

// Attempt-local observations must not enter semantic checkpoint configuration.
test("UI observation forwarding preserves checkpoint identity across fresh Resume attempts", async t => {
  const { config, output } = fixture(t);
  const context = { statePath: path.join(output, "ui-source-state.json"), generation: "initial" };
  const initial = await state.initialize(output, config, false, context);
  assert.deepEqual(initial.inputs.source, await require('./directory-state.cjs').getDirectoryState(config.source));
  const next = { ...context, generation: "resume" };
  assert.deepEqual(await state.initialize(output, config, true, next), initial);
  if (process.platform === 'win32') assert.equal(JSON.parse(fs.readFileSync(context.statePath, 'utf8')).disposition, 'full');
  assert.equal(initial.inputs.config.uiSourceObservation, undefined);
});

test("resume refuses changed source content even at the same size and timestamp", async t => {
  const { config, output } = fixture(t);
  await state.initialize(output, config, false);
  const file = path.join(config.source, "nested", "host.js");
  const stat = fs.statSync(file);
  fs.writeFileSync(file, "modified");
  fs.utimesSync(file, stat.atime, stat.mtime);
  await assert.rejects(state.initialize(output, config, true), /Preparation inputs changed/);
});

test("resume refuses configuration, build receipt, bundle and tool changes", async t => {
  const { config, output } = fixture(t);
  await state.initialize(output, config, false);
  await assert.rejects(state.initialize(output, { ...config, skipSnapshot: false }, true), /Preparation inputs changed/);
  const buildFile = path.join(config.release, "build-info.json");
  const originalBuild = fs.readFileSync(buildFile);
  fs.appendFileSync(buildFile, "\n");
  await assert.rejects(state.initialize(output, config, true), /Preparation inputs changed/);
  fs.writeFileSync(buildFile, originalBuild);
  fs.writeFileSync(path.join(config.release, "engine.exe"), "broken");
  await assert.rejects(state.initialize(output, config, true), /Release hash mismatch/);
  fs.writeFileSync(path.join(config.release, "engine.exe"), "engine");
  fs.writeFileSync(path.join(config.toolDirectory, "companion/node_modules/@vscode/vsce/out/package.js"), "changed tool");
  await assert.rejects(state.initialize(output, config, true), /Preparation inputs changed/);
});

// Updating packaging dependencies must invalidate resumes even if VSCE is unchanged.
test("resume binds the ZIP writer, CRC implementation and dependency lock", async t => {
  const { config, output } = fixture(t);
  const initial = await state.initialize(output, config, false);
  for (const name of zipToolFiles) {
    assert.ok(initial.inputs.tools[name], name);
    const file = path.join(config.toolDirectory, name);
    const original = fs.readFileSync(file);
    fs.writeFileSync(file, name.endsWith("/package.json") ? JSON.stringify({...JSON.parse(original),version:"changed"}) : "changed ZIP tool");
    await assert.rejects(state.initialize(output, config, true), /Preparation inputs changed/, name);
    fs.unlinkSync(file);
    await assert.rejects(state.initialize(output, config, true), error => ["ENOENT", "MODULE_NOT_FOUND"].includes(error.code), name);
    fs.writeFileSync(file, original);
  }
  assert.deepEqual(await state.initialize(output, config, true), initial);
});

test("ZIP fingerprints follow nested package exports before a hoisted CRC decoy", async t => {
  const { config, output, write } = fixture(t);
  const nested = path.join(config.toolDirectory, "companion/node_modules/azrael-yazl/node_modules/buffer-crc32");
  write(path.join(nested, "package.json"), JSON.stringify({name:"buffer-crc32",version:"1.0.0",main:"dist/index.cjs",exports:{".":"./dist/index.cjs"}}));
  write(path.join(nested, "dist/index.cjs"), "selected nested CRC");
  fs.unlinkSync(path.join(nested, "index.js"));
  const hoisted = path.join(config.toolDirectory, "companion/node_modules/buffer-crc32");
  write(path.join(hoisted, "package.json"), JSON.stringify({name:"buffer-crc32",version:"0.2.13",main:"index.js"}));
  write(path.join(hoisted, "index.js"), "wrong hoisted CRC");
  const initial = await state.initialize(output, config, false);
  const entry = "companion/node_modules/azrael-yazl/node_modules/buffer-crc32/dist/index.cjs";
  assert.equal(initial.inputs.tools[entry], crypto.createHash("sha256").update("selected nested CRC").digest("hex"));
  assert.equal(initial.inputs.tools["companion/node_modules/buffer-crc32/index.js"], undefined);
  fs.writeFileSync(path.join(nested, "dist/index.cjs"), "changed selected CRC");
  await assert.rejects(state.initialize(output, config, true), /Preparation inputs changed/);
});

test("ZIP fingerprints support a genuinely hoisted CRC dependency", async t => {
  const { config, output, write } = fixture(t);
  const nested = path.join(config.toolDirectory, "companion/node_modules/azrael-yazl/node_modules/buffer-crc32");
  fs.rmSync(nested, {recursive:true});
  const hoisted = path.join(config.toolDirectory, "companion/node_modules/buffer-crc32");
  write(path.join(hoisted, "package.json"), JSON.stringify({name:"buffer-crc32",version:"0.2.13",main:"index.js"}));
  write(path.join(hoisted, "index.js"), "hoisted CRC");
  const initial = await state.initialize(output, config, false);
  assert.equal(initial.inputs.tools["companion/node_modules/buffer-crc32/index.js"], crypto.createHash("sha256").update("hoisted CRC").digest("hex"));
  assert.deepEqual(await state.initialize(output, config, true), initial);
});

test("ZIP dependency resolution rejects missing and physically outside pinned tools", async t => {
  const { root, config, output, write } = fixture(t);
  fs.rmSync(path.join(config.toolDirectory, "companion/node_modules/azrael-yazl/node_modules/buffer-crc32"), {recursive:true});
  await assert.rejects(state.initialize(output, config, false), /Cannot find module|outside the pinned tool directory/);
  const outside = path.join(root, "node_modules/buffer-crc32");
  write(path.join(outside, "package.json"), JSON.stringify({name:"buffer-crc32",version:"0.2.13",main:"index.js"}));
  write(path.join(outside, "index.js"), "outside CRC");
  await assert.rejects(state.initialize(output, config, false), /outside the pinned tool directory/);
});

test("resume refuses a changed transform rule fingerprint", async t => {
  const { config, output } = fixture(t);
  await state.initialize(output, config, false);
  const transformer = require("./namespace-azrael-host.cjs");
  const original = transformer.getTransformRules;
  // Change the dependency's returned fingerprint without editing shared source files.
  transformer.getTransformRules = () => ({ ...original(), "namespace-azrael-host.cjs": "changed" });
  try {
    await assert.rejects(state.initialize(output, config, true), /Preparation inputs changed/);
  } finally { transformer.getTransformRules = original; }
});

test("namespace checkpoint reloads data and refuses damaged host contents", async t => {
  const { config, output, root, write } = fixture(t);
  await state.initialize(output, config, false);
  const host = path.join(root, "host");
  const file = path.join(host, "extension.js");
  write(file, "original");
  const data = { prepared: { OfficialExtension: host }, hostVersion: "0.5.123" };
  await state.save(output, "namespace", data);
  assert.deepEqual(await state.load(output, "namespace"), { found: true, data });
  const stat = fs.statSync(file);
  fs.writeFileSync(file, "modified");
  fs.utimesSync(file, stat.atime, stat.mtime);
  await assert.rejects(state.load(output, "namespace"), /Completed namespace stage changed/);
  fs.writeFileSync(file, "original");
  fs.unlinkSync(file);
  await assert.rejects(state.load(output, "namespace"), /Completed namespace stage changed/);
});

test("complete checkpoint reloads data and refuses archive or receipt corruption", async t => {
  const { config, output, write } = fixture(t);
  await state.initialize(output, config, false);
  const archive = path.join(output, "host.vsix");
  const receipt = path.join(output, "independent-prepared.json");
  write(archive, "archive");
  write(receipt, JSON.stringify({ HostVsix: archive }));
  const data = { HostVsix: archive };
  await state.save(output, "complete", data);
  assert.deepEqual(await state.load(output, "complete"), { found: true, data });
  fs.writeFileSync(archive, "damaged");
  await assert.rejects(state.load(output, "complete"), /Completed package changed/);
  fs.writeFileSync(archive, "archive");
  fs.writeFileSync(receipt, "{corrupt");
  await assert.rejects(state.load(output, "complete"), /Completed package changed/);
  fs.writeFileSync(path.join(output, "preparation-state.json"), "{corrupt");
  await assert.rejects(state.load(output, "complete"), SyntaxError);
});

test("completed preparation releases only its exact tool dependency and preserves runtime consumers", async t => {
  const { root, config, output, write } = fixture(t);
  const lifecycle = require("./artifact-lifecycle.cjs");
  const key = "a".repeat(64), other = "b".repeat(64);
  config.release = path.join(root, "artifacts/releases/prepared");
  config.toolDirectory = path.join(root, "artifacts/cache/modules/companion", key);
  fs.mkdirSync(config.release, { recursive: true });
  write(path.join(config.release, "build-info.json"), "{}");
  const data = { HostVsix: path.join(output, "host.vsix"), ReleaseDirectory: config.release };
  write(data.HostVsix, "archive");
  write(path.join(output, "independent-prepared.json"), JSON.stringify(data));
  write(path.join(output, "preparation-state.json"), JSON.stringify({ inputs: { config }, stages: {} }));
  const tool = `run:module-cache:companion:${key}`;
  const record = lifecycle.recordLifecycle(root, { id: "version:prepared", kind: "version", owner: "azrael-release",
    state: "pending", membership_complete: false,
    members: [{ path: config.release, role: "release", generated: true, protection_known: true }],
    references: [{ id: tool, reason: "companion-tool", kind: "dependency" },
      { id: tool, reason: "installed runtime", kind: "installation" },
      { id: `run:module-cache:companion:${other}`, reason: "companion-tool", kind: "dependency" }],
  });
  await assert.rejects(state.releaseTools(output, root), /Completed package required/);
  assert.deepEqual(lifecycle.catalog(root).find(value => value.id === record.id).references, record.references);
  await state.save(output, "complete", data);
  fs.writeFileSync(data.HostVsix, "damaged");
  await assert.rejects(state.releaseTools(output, root), /Completed package changed/);
  fs.writeFileSync(data.HostVsix, "archive");
  assert.deepEqual(await state.releaseTools(output, root), { released: 1 });
  const remaining = lifecycle.catalog(root).find(value => value.id === record.id).references;
  assert.deepEqual(remaining, record.references.filter(reference => reference.kind === "installation" || reference.id !== tool));
  assert.deepEqual(await state.releaseTools(output, root), { released: 0 });
});

for (const outcome of [null, "failure", "unknown"]) test(`shared companion consumers release exact preparation tools with outcome ${outcome}`, async t => {
  const { root, config, write } = fixture(t);
  const lifecycle = require("./artifact-lifecycle.cjs");
  const consumers = require("./module-cache-consumers.cjs");
  const owner = path.join(root, "owner"), project = path.join(owner, "project"), key = "c".repeat(64);
  fs.mkdirSync(owner); fs.mkdirSync(project);
  const output = path.join(project, "output");
  fs.mkdirSync(output);
  config.release = path.join(project, "artifacts/releases/shared");
  config.toolDirectory = path.join(owner, "artifacts/cache/modules/companion", key);
  if (outcome !== "failure") write(path.join(config.release, "build-info.json"), JSON.stringify({ moduleBuild: { cacheOwner: owner } }));
  const reference = { id: `run:module-cache:companion:${key}`, reason: "companion-tool", kind: "dependency" };
  const source = lifecycle.recordLifecycle(project, { id: "version:shared", kind: "version", owner: "azrael-release",
    state: "pending", membership_complete: false,
    members: [{ path: config.release, role: "release", generated: true, protection_known: true }],
    references: [reference, { ...reference, kind: "installation", reason: "runtime" },
      { id: "version:engine", kind: "recovery", reason: "engine recovery" }] });
  assert.throws(() => consumers.attach(owner, project, source.id, "companion", "../bad"), /Invalid exact/);
  assert.throws(() => consumers.attach(owner, project, source.id, "providers", key), /Invalid exact/);
  const proxy = consumers.attach(owner, project, source.id, "companion", key);
  assert.deepEqual(consumers.attach(owner, project, source.id, "companion", key), proxy);
  assert.equal(consumers.listConsumers(owner, project)[0].references.length, 1);
  if (outcome === "failure") {
    assert.equal(fs.existsSync(config.release), false);
    assert.equal(JSON.parse(fs.readFileSync(proxy.bindingPath)).release.kind, "planned");
    const sha256 = {};
    for (const name of ["engine/azrael.exe", "engine/azrael-bridge.exe", "engine/azrael-code-mode-host.exe", "azrael-ex.vsix"]) {
      write(path.join(config.release, name), name);
      sha256[name] = crypto.createHash("sha256").update(name).digest("hex");
    }
    write(path.join(config.release, "build-info.json"), JSON.stringify({ product: "azrael-ex", sha256, moduleBuild: { cacheOwner: owner } }));
    const sealed = consumers.seal(owner, project, source.id, "companion", key);
    assert.deepEqual(consumers.seal(owner, project, source.id, "companion", key), sealed);
  }
  const proxyRoot = path.dirname(proxy.bindingPath);
  assert.ok(lifecycle.planCleanup(owner, { paths: [proxyRoot] }).groups[0].blockers.includes("lifecycle-state:pending"));
  assert.equal(lifecycle.registerRequest(owner, proxy.id).group.membership_complete, false);
  // Exercise the actual cache target's inbound reference projection.
  fs.mkdirSync(config.toolDirectory, { recursive: true });
  const cache = lifecycle.recordLifecycle(owner, { id: reference.id, owner: "module-cache", kind: "run",
    state: "complete", membership_complete: true,
    members: [{ path: config.toolDirectory, role: "module-cache", generated: true, protection_known: true }] });
  // Listing the owner never depends on the consumer workspace remaining present.
  const moved = project + "-moved";
  fs.renameSync(project, moved);
  assert.equal(consumers.listConsumers(owner)[0].references.length, 1);
  assert.equal(consumers.listConsumers(owner, project)[0].references.length, 1);
  assert.ok(lifecycle.planCleanup(owner, { paths: [config.toolDirectory] }).groups.find(group => group.id === cache.id).blockers.includes(`active-reference:${proxy.id}`));
  assert.ok(lifecycle.registerRequest(owner, cache.id).group.members[0].references.some(value => value.startsWith(proxy.id + ":")));
  fs.renameSync(moved, project);
  const data = { HostVsix: path.join(output, "shared.vsix"), ReleaseDirectory: config.release };
  write(data.HostVsix, "shared archive");
  write(path.join(output, "independent-prepared.json"), JSON.stringify(data));
  write(path.join(output, "preparation-state.json"), JSON.stringify({ inputs: { config }, stages: {} }));
  await assert.rejects(state.releaseTools(output, project), /Completed package required/);
  await assert.rejects(state.releaseTools(output, project, { cacheInvalidation: { evidence_ref: path.join(project, "missing.json"), evidence_sha256: "0".repeat(64) } }), /Completed package required/);
  await state.save(output, "complete", data);
  const checkpoint = path.join(output, "preparation-state.json");
  const hash = () => crypto.createHash("sha256").update(fs.readFileSync(checkpoint)).digest("hex");
  assert.throws(() => consumers.release(owner, project, source.id, "companion", key, checkpoint, hash()), /Source dependency must be released first/);
  const bindingBytes = fs.readFileSync(proxy.bindingPath), binding = JSON.parse(bindingBytes);
  write(proxy.bindingPath, JSON.stringify({ ...binding, key: "d".repeat(64) }));
  assert.throws(() => consumers.listConsumers(owner), /Consumer binding mismatch/);
  fs.writeFileSync(proxy.bindingPath, bindingBytes);
  let options;
  let closed;
  if (outcome) {
    const terminal = path.join(project, "terminal.json");
    write(terminal, "fixture terminal producer evidence");
    closed = lifecycle.closeLifecycle(project, source.id, { owner: source.owner, expected_revision: source.revision,
      producer_stopped_verified: true, outcome, exit_code: outcome === "failure" ? 7 : null,
      reason: "Fixture terminal outcome", evidence_ref: terminal,
      evidence_sha256: crypto.createHash("sha256").update(fs.readFileSync(terminal)).digest("hex") });
    await assert.rejects(state.releaseTools(output, project), /Failed or unresolved/);
    const authority = path.join(project, "cache-invalidation.json");
    const document = { schema: 1, action: "invalidate-preparation-tool-cache", user_authorized: true,
      project, release_id: source.id, release: config.release, cache_owner: owner,
      tool_directory: config.toolDirectory, checkpoint_sha256: hash(), reason: "User requested all regenerable caches" };
    write(authority, JSON.stringify(document));
    for (const changed of [{ user_authorized: false }, { release_id: "version:other" }, { cache_owner: project }, { tool_directory: config.toolDirectory + "-other" }]) {
      write(authority, JSON.stringify({ ...document, ...changed }));
      const wrong = { cacheInvalidation: { evidence_ref: authority, evidence_sha256: crypto.createHash("sha256").update(fs.readFileSync(authority)).digest("hex") } };
      await assert.rejects(state.releaseTools(output, project, wrong), /Exact user-authorized/);
    }
    write(authority, JSON.stringify(document));
    const authoritySha = crypto.createHash("sha256").update(fs.readFileSync(authority)).digest("hex");
    options = { cacheInvalidation: { evidence_ref: authority, evidence_sha256: authoritySha } };
    await assert.rejects(state.releaseTools(output, project, { cacheInvalidation: { ...options.cacheInvalidation, evidence_sha256: "0".repeat(64) } }), /SHA256/);
    write(authority, JSON.stringify({ ...document, tool_directory: config.toolDirectory + "-other" }));
    await assert.rejects(state.releaseTools(output, project, options), /SHA256/);
    write(authority, JSON.stringify(document));
    write(data.HostVsix, "tampered");
    await assert.rejects(state.releaseTools(output, project, options), /Completed package changed/);
    write(data.HostVsix, "shared archive");
    assert.deepEqual(lifecycle.catalog(project).find(record => record.id === source.id).references, closed.references);
  }
  // Simulate a source release followed by process loss before the proxy release.
  const originalRelease = consumers.release;
  consumers.release = () => { throw new Error("Simulated interruption after source release"); };
  try { await assert.rejects(state.releaseTools(output, project, options), /Simulated interruption/); }
  finally { consumers.release = originalRelease; }
  assert.deepEqual(await state.releaseTools(output, project, options), { released: 0 });
  assert.equal(consumers.listConsumers(owner)[0].references.length, 0);
  assert.deepEqual(lifecycle.planCleanup(owner, { paths: [proxyRoot] }).groups[0].blockers, []);
  assert.equal(lifecycle.registerRequest(owner, proxy.id).group.membership_complete, true);
  assert.deepEqual(lifecycle.planCleanup(owner, { paths: [config.toolDirectory] }).groups.find(group => group.id === cache.id).blockers, []);
  assert.equal(lifecycle.catalog(project)[0].references[0].kind, "installation");
  assert.deepEqual(await state.releaseTools(output, project, options), { released: 0 });
  const proof = path.join(path.dirname(proxy.bindingPath), "release.json");
  assert.ok(fs.existsSync(proof));
  if (outcome) {
    const retained = lifecycle.catalog(project).find(record => record.id === source.id);
    assert.equal(retained.state, closed.state);
    assert.deepEqual(retained.producer, closed.producer);
    assert.deepEqual(retained.references, closed.references.filter(ref => ref.reason !== "companion-tool"));
    assert.ok(retained.release_receipt.reason.includes(options.cacheInvalidation.evidence_sha256));
    assert.equal(JSON.parse(fs.readFileSync(proof)).invalidation.evidence_sha256, options.cacheInvalidation.evidence_sha256);
  } else assert.throws(() => consumers.attach(owner, project, source.id, "companion", key), /Exact source companion-tool dependency required/);
});

test("shared consumer reads hold the owner catalog lease across binding observations", t => {
  const { root, write } = fixture(t), lifecycle = require("./artifact-lifecycle.cjs"), consumers = require("./module-cache-consumers.cjs");
  const { spawnSync } = require("node:child_process");
  const owner = path.join(root, "owner"), project = path.join(owner, "project"), key = "c".repeat(64);
  fs.mkdirSync(project, { recursive: true });
  const reference = { id: `run:module-cache:companion:${key}`, reason: "companion-tool", kind: "dependency" };
  const source = lifecycle.recordLifecycle(project, { id: "version:shared", kind: "version", owner: "azrael-release",
    state: "pending", membership_complete: false,
    members: [{ path: path.join(project, "artifacts/releases/shared"), role: "release", generated: true, protection_known: true }], references: [reference] });
  const proxy = consumers.attach(owner, project, source.id, "companion", key);
  const writerSource = `const l=require(process.argv[1]),p=require("node:path"),assert=require("node:assert/strict"),root=process.argv[2];
    try { l.withCatalogLock(root,()=>l.recordLifecycle(root,{id:process.argv[3],owner:"fixture-writer",kind:"run",state:"complete",membership_complete:true,
      members:[{path:p.join(root,"artifacts",process.argv[3].slice(4)),role:"output",generated:true,protection_known:true}]}),{waitMs:0});
      assert.equal(process.argv[4],"write");process.stdout.write("written");
    } catch(error) { if(process.argv[4]!=="blocked"||error.code!=="EEXIST")throw error;process.stdout.write("blocked"); }`;
  const writer = (id, mode) => {
    const result = spawnSync(process.execPath, ["-e", writerSource, require.resolve("./artifact-lifecycle.cjs"), owner, id, mode], { encoding: "utf8", windowsHide: true });
    assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, mode === "blocked" ? "blocked" : "written");
  };
  const catalog = lifecycle.catalog;
  for (const [name, inspect] of [["list", () => assert.equal(consumers.listConsumers(owner, project).length, 1)],
    ["has", () => assert.equal(consumers.hasConsumer(owner, project, source.id, "companion", key), true)]]) {
    let observations = 0;
    lifecycle.catalog = selected => {
      const result = catalog(selected);
      if (selected === owner) { observations++; writer(`run:writer-${name}`, "blocked"); }
      return result;
    };
    try { inspect(); assert.ok(observations >= 2, "Actual catalog and binding reads must both execute"); }
    finally { lifecycle.catalog = catalog; }
    writer(`run:writer-${name}`, "write");
  }
  const bindingBytes = fs.readFileSync(proxy.bindingPath);
  try { write(proxy.bindingPath, JSON.stringify({ ...JSON.parse(bindingBytes), key: "d".repeat(64) })); assert.throws(() => consumers.listConsumers(owner), /Consumer binding mismatch/); }
  finally { fs.writeFileSync(proxy.bindingPath, bindingBytes); }
  const recordPath = lifecycle.registryPath(owner, proxy.id), recordBytes = fs.readFileSync(recordPath);
  const readFile = fs.readFileSync;
  let changed = false;
  fs.readFileSync = (filename, ...args) => {
    const result = readFile(filename, ...args);
    if (filename === recordPath && !changed) { changed = true; fs.appendFileSync(recordPath, " "); }
    return result;
  };
  try { assert.throws(() => consumers.listConsumers(owner), /Lifecycle catalog source changed during catalog observation/); }
  finally { fs.readFileSync = readFile; fs.writeFileSync(recordPath, recordBytes); }
  assert.equal(consumers.listConsumers(owner, project).length, 1);
});

test("planned release consumers protect absent packaging and require an immutable physical seal", t => {
  const { root, write } = fixture(t), lifecycle = require("./artifact-lifecycle.cjs"), consumers = require("./module-cache-consumers.cjs");
  const owner = path.join(root, "owner"), project = path.join(owner, "project"), release = path.join(project, "artifacts/releases/planned");
  fs.mkdirSync(path.dirname(release), { recursive: true });
  const key = "e".repeat(64), reference = { id: `run:module-cache:companion:${key}`, reason: "companion-tool", kind: "dependency" };
  const source = lifecycle.recordLifecycle(project, { id: "version:planned", kind: "version", owner: "azrael-release",
    state: "pending", membership_complete: false, members: [{ path: release, role: "release", generated: true, protection_known: true }], references: [reference] });
  const proxy = consumers.attach(owner, project, source.id, "companion", key), proxyRoot = path.dirname(proxy.bindingPath);
  const bindingBytes = fs.readFileSync(proxy.bindingPath), sealPath = path.join(proxyRoot, "release-identity.json");
  assert.equal(fs.existsSync(release), false);
  assert.equal(consumers.hasConsumer(owner, project, source.id, "companion", key), true);
  assert.ok(lifecycle.planCleanup(owner, { paths: [proxyRoot] }).groups[0].blockers.includes("lifecycle-state:pending"));
  assert.throws(() => consumers.seal(owner, project, source.id, "companion", key), /ENOENT/);
  const ancestor = path.dirname(release), replaced = ancestor + "-original";
  fs.renameSync(ancestor, replaced); fs.mkdirSync(ancestor);
  assert.throws(() => consumers.attach(owner, project, source.id, "companion", key), /ancestor or path changed/);
  fs.rmdirSync(ancestor); fs.renameSync(replaced, ancestor);
  fs.mkdirSync(release);
  assert.deepEqual(consumers.attach(owner, project, source.id, "companion", key), proxy);
  assert.deepEqual(fs.readFileSync(proxy.bindingPath), bindingBytes);
  assert.equal(fs.existsSync(sealPath), false);
  assert.throws(() => consumers.seal(owner, project, source.id, "companion", key), /ENOENT/);
  const sha256 = {};
  for (const name of ["engine/azrael.exe", "engine/azrael-bridge.exe", "engine/azrael-code-mode-host.exe", "azrael-ex.vsix"]) {
    write(path.join(release, name), name);
    sha256[name] = crypto.createHash("sha256").update(name).digest("hex");
  }
  write(path.join(release, "build-info.json"), JSON.stringify({ product: "azrael-ex", sha256 }));
  write(path.join(release, "azrael-ex.vsix"), "incomplete");
  assert.throws(() => consumers.seal(owner, project, source.id, "companion", key), /Packaged release changed/);
  write(path.join(release, "azrael-ex.vsix"), "azrael-ex.vsix");
  // An unsealed package must keep its owner proxy and cannot release its hold.
  const checkpoint = path.join(project, "checkpoint.json");
  write(checkpoint, JSON.stringify({ inputs: { config: { release } }, stages: {} }));
  assert.throws(() => consumers.release(owner, project, source.id, "companion", key, checkpoint,
    crypto.createHash("sha256").update(fs.readFileSync(checkpoint)).digest("hex")), /ENOENT/);
  assert.equal(consumers.listConsumers(owner, project)[0].references.length, 1);
  const sealed = consumers.seal(owner, project, source.id, "companion", key);
  assert.deepEqual(consumers.seal(owner, project, source.id, "companion", key), sealed);
  write(proxy.bindingPath, Buffer.concat([bindingBytes, Buffer.from("\n")]));
  assert.throws(() => consumers.release(owner, project, source.id, "companion", key, checkpoint,
    crypto.createHash("sha256").update(fs.readFileSync(checkpoint)).digest("hex")), /Sealed release identity changed/);
  fs.writeFileSync(proxy.bindingPath, bindingBytes);
  fs.renameSync(release, release + "-original"); fs.mkdirSync(release);
  assert.throws(() => consumers.seal(owner, project, source.id, "companion", key), /ENOENT|Conflicting immutable|identity changed/);
  assert.throws(() => consumers.release(owner, project, source.id, "companion", key, checkpoint,
    crypto.createHash("sha256").update(fs.readFileSync(checkpoint)).digest("hex")), /Sealed release identity changed/);
});

test("failed unsealed consumer retirement freezes the exact source and reuses the exclusive cache lease", async t => {
  if (process.platform !== "win32") { t.skip("Windows FileShare.None interoperability is Windows-specific"); return; }
  const f = failedConsumerFixture(t), { owner, project, versionId, key, lock, lifecycle, consumers, proxy } = f;
  const proxyRoot = path.dirname(proxy.bindingPath), sourceRefId = lifecycle.referenceIdentity(f.sourceReference);
  const sourceBefore = lifecycle.catalog(project).find(record => record.id === versionId);
  const proxyBefore = lifecycle.catalog(owner).find(record => record.id === proxy.id);
  const lockBefore = fs.statSync(lock, { bigint: true });
  const sourceEvidenceNames = fs.readdirSync(path.dirname(f.evidence)).sort();
  const heldByDotNet = startPowerShellLock(lock, String.raw`$ErrorActionPreference='Stop'; $p=[Console]::In.ReadLine(); $s=[IO.File]::Open($p,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None); [Console]::Out.WriteLine('HELD'); [Console]::Out.Flush(); $null=[Console]::In.ReadLine(); $s.Dispose(); [Console]::Out.WriteLine('RELEASED'); [Console]::Out.Flush()`);
  try {
    assert.equal(await heldByDotNet.nextLine(), "HELD");
    assert.throws(() => consumers.reviewFailedRetirement(owner, project, versionId, "companion", key), error =>
      ["EEXIST", "EBUSY", "EACCES"].includes(error.code) || /lock\.acquire:.*\(os error 32\)/s.test(error.message));
    assert.deepEqual(lifecycle.catalog(project).find(record => record.id === versionId), sourceBefore);
    assert.deepEqual(lifecycle.catalog(owner).find(record => record.id === proxy.id), proxyBefore);
    assert.deepEqual(fs.readdirSync(path.dirname(f.evidence)).sort(), sourceEvidenceNames);
    assert.equal(fs.existsSync(path.join(proxyRoot, "release-identity.json")), false);
  } finally {
    const ended = await heldByDotNet.close();
    assert.equal(ended.exitCode, 0, ended.stderr);
  }

  const reviewed = consumers.reviewFailedRetirement(owner, project, versionId, "companion", key);
  assert.equal(reviewed.status, "review");
  assert.equal(reviewed.snapshot.checkpoint.presence, "absent");
  assert.equal(reviewed.module_cache_lease_release.process_exit_code, 0);
  assert.equal(reviewed.module_cache_lease_release.process_close_observed, true);
  assert.equal(fs.existsSync(reviewed.snapshot.checkpoint.path), false);
  assert.equal(fs.existsSync(path.join(proxyRoot, "release-identity.json")), false);
  assert.equal(fs.existsSync(path.join(proxyRoot, "release.json")), false);

  let attemptedDuringApply;
  const originalWithCatalogLock = lifecycle.withCatalogLock;
  let delayed = false;
  lifecycle.withCatalogLock = (...args) => {
    if (!delayed) {
      delayed = true;
      attemptedDuringApply = startPowerShellLock(lock, String.raw`$ErrorActionPreference='Stop'; $p=[Console]::In.ReadLine(); try { $s=[IO.File]::Open($p,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None); [Console]::Out.WriteLine('OPENED'); $s.Dispose() } catch { [Console]::Out.WriteLine('BLOCKED') }; [Console]::Out.Flush()`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1200);
    }
    return originalWithCatalogLock(...args);
  };
  let retired;
  try { retired = consumers.applyFailedRetirement(owner, project, versionId, "companion", key, reviewed.review_token); }
  finally { lifecycle.withCatalogLock = originalWithCatalogLock; }
  assert.equal(await attemptedDuringApply.nextLine(), "BLOCKED", attemptedDuringApply.stderr);
  assert.equal((await attemptedDuringApply.close()).exitCode, 0);
  assert.equal(retired.status, "recovered");
  assert.equal(retired.module_cache_lease_release.process_exit_code, 0);
  assert.equal(retired.module_cache_lease_release.process_close_observed, true);
  const source = lifecycle.catalog(project).find(record => record.id === versionId);
  const consumer = lifecycle.catalog(owner).find(record => record.id === proxy.id);
  assert.equal(source.state, "failed");
  assert.equal(source.producer.status, "stopped");
  assert.equal(source.producer.outcome, "failure");
  assert.equal(source.producer.exit_code, null);
  assert.equal(source.failed_consumer_retirement.consumer_id, proxy.id);
  assert.equal(source.references.some(reference => lifecycle.referenceIdentity(reference) === sourceRefId), false);
  assert.ok(source.references.some(reference => reference.reason === "installed runtime"));
  assert.equal(consumer.state, "pending");
  assert.equal(consumer.producer, undefined);
  assert.equal(consumer.membership_complete, true);
  assert.deepEqual(consumer.references, []);
  assert.ok(consumer.cleanup_recovery.consumer_retirement);
  assert.deepEqual(lifecycle.planCleanup(owner, { paths: [proxyRoot] }).groups[0].blockers, []);
  assert.throws(() => consumers.attach(owner, project, versionId, "companion", key), /Frozen failed consumer source/);
  assert.throws(() => consumers.seal(owner, project, versionId, "companion", key), /Frozen failed consumer source/);
  assert.throws(() => lifecycle.recordLifecycle(project, { id: source.id, kind: source.kind, owner: source.owner, version: source.version,
    expected_revision: source.revision, generation: "replacement-generation", state: "pending", membership_complete: false,
    members: source.members, references: source.references }), /retirement freeze/);
  assert.throws(() => lifecycle.recordLifecycle(project, { id: source.id, kind: source.kind, owner: source.owner, version: source.version,
    expected_revision: source.revision, state: source.state, membership_complete: true, members: source.members,
    references: [...source.references, { id: "version:new-cache-consumer", reason: "new cache use", kind: "dependency" }] }), /retirement freeze/);

  const releaseEvidence = path.join(project, "artifacts/maintenance/evidence/release-other-reference.json");
  f.write(releaseEvidence, "explicit unrelated reference release");
  const releasedOther = lifecycle.releaseReferences(project, source.id, { owner: source.owner, expected_revision: source.revision,
    reference_ids: [lifecycle.referenceIdentity(f.retainedReference)], reason: "Release only the unrelated runtime hold",
    evidence_ref: releaseEvidence, evidence_sha256: crypto.createHash("sha256").update(fs.readFileSync(releaseEvidence)).digest("hex") });
  assert.equal(releasedOther.state, "failed");
  assert.equal(releasedOther.producer.exit_code, null);
  assert.ok(releasedOther.failed_consumer_retirement);

  const reopenedByDotNet = startPowerShellLock(lock, String.raw`$ErrorActionPreference='Stop'; $p=[Console]::In.ReadLine(); try { $s=[IO.File]::Open($p,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None); [Console]::Out.WriteLine('OPENED'); $s.Dispose() } catch { [Console]::Out.WriteLine('BLOCKED') }; [Console]::Out.Flush()`);
  assert.equal(await reopenedByDotNet.nextLine(), "OPENED", reopenedByDotNet.stderr);
  assert.equal((await reopenedByDotNet.close()).exitCode, 0);
  const finalReview = consumers.reviewFailedRetirement(owner, project, versionId, "companion", key);
  assert.equal(finalReview.status, "recovered");
  assert.equal(finalReview.module_cache_lease_release.process_exit_code, 0);
  const lockAfter = fs.statSync(lock, { bigint: true });
  assert.equal(lockAfter.dev, lockBefore.dev);
  assert.equal(lockAfter.ino, lockBefore.ino);
  assert.equal(lockAfter.birthtimeNs, lockBefore.birthtimeNs);
});

test("Windows module cache lease rejects EOF, malformed release and unexpected process loss", { timeout: 90000 }, async t => {
  if (process.platform !== "win32") { t.skip("Windows FileShare.None provider"); return; }
  const { root, write } = fixture(t), lock = path.join(root, "module.lock"); write(lock, "");
  const provider = require("./module-cache-dotnet-lease.cjs"), before = fs.statSync(lock, { bigint: true });
  const { Worker, MessageChannel } = require("node:worker_threads");
  for (const operation of ["eof", "invalid-release", "terminate"]) {
    const { port1, port2 } = new MessageChannel(), token = crypto.randomBytes(32).toString("hex");
    const worker = new Worker(require.resolve("./module-cache-dotnet-lease.cjs"), { workerData: { kind: "module-cache-dotnet", filename: lock, token,
      executable: path.join(process.env.SystemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe"),
      signal: new Int32Array(new SharedArrayBuffer(4)), port: port2 }, transferList: [port2] });
    const packets = [], terminal = new Promise((resolve, reject) => {
      worker.once("error", reject);
      port1.on("message", packet => {
        packets.push(packet);
        if (packet.type === "ready") {
          port1.postMessage({ operation, sequence: 2, token });
        }
        if (packet.type === "closed") resolve(packet);
      });
    });
    const closed = await terminal;
    const ready = packets.find(packet => packet.type === "ready");
    assert.equal(ready?.token, token); assert.equal(ready.pid, ready.process_pid);
    assert.notEqual(closed.process_exit_code, 0);
    assert.equal(packets.some(packet => packet.type === "released"), false);
    if (operation !== "terminate") assert.ok(packets.some(packet => packet.type === "error"));
    port1.close(); await worker.terminate();
    const lease = provider.acquire(lock); lease.assertHeld();
    assert.throws(() => fs.renameSync(lock, lock + "-replaced"));
    const release = lease.release();
    assert.equal(release.process_exit_code, 0); assert.equal(release.process_close_observed, true);
    const after = fs.statSync(lock, { bigint: true });
    for (const key of ["dev", "ino", "birthtimeNs", "size"]) assert.equal(after[key], before[key]);
    assert.equal(fs.readFileSync(lock).length, 0);
  }
});

test("failed consumer retirement rejects stale package and source evidence before creating receipts", t => {
  const f = failedConsumerFixture(t, 7), { consumers, lifecycle, owner, project, versionId, key, proxy, write } = f;
  const review = () => consumers.reviewFailedRetirement(owner, project, versionId, "companion", key);
  const apply = token => consumers.applyFailedRetirement(owner, project, versionId, "companion", key, token);
  const reviewed = review(), evidenceDirectory = path.dirname(f.evidence);
  const names = fs.readdirSync(evidenceDirectory).sort();
  const checkpoint = path.join(f.deployLogs, "pipeline-state.json");
  const checkpointDocument = { schema: 1, identity: { project, releaseName: "retirement-fixture", platform: "windows-x64" },
    stages: { "build.package": [{ id: "fixture", status: "running", exitCode: null }] } };
  write(checkpoint, JSON.stringify(checkpointDocument));
  assert.throws(review, /running producer/);
  checkpointDocument.stages["build.package"][0] = { id: "fixture", status: "succeeded", exitCode: 0 };
  write(checkpoint, JSON.stringify(checkpointDocument));
  assert.throws(review, /Completed source package/);
  fs.unlinkSync(checkpoint);
  const originalEvidence = fs.readFileSync(f.evidence);
  fs.appendFileSync(f.evidence, " changed");
  assert.throws(review, /producer stop evidence/);
  fs.writeFileSync(f.evidence, originalEvidence);
  const seal = path.join(path.dirname(proxy.bindingPath), "release-identity.json");
  write(seal, "unexpected seal"); assert.throws(review, /requires absent path/); fs.unlinkSync(seal);
  const source = lifecycle.catalog(project).find(record => record.id === versionId);
  lifecycle.recordLifecycle(project, { ...source, expected_revision: source.revision });
  assert.throws(() => apply(reviewed.review_token), /review is stale/);
  assert.deepEqual(fs.readdirSync(evidenceDirectory).sort(), names);
  assert.equal(lifecycle.catalog(project).find(record => record.id === versionId).failed_consumer_retirement, undefined);
  assert.equal(lifecycle.catalog(owner).find(record => record.id === proxy.id).references.length, 1);
});

test("failed consumer retirement retries only its exact source freeze and proxy release", t => {
  const f = failedConsumerFixture(t, 7), { consumers, lifecycle, owner, project, versionId, key, proxy } = f;
  const reviewed = consumers.reviewFailedRetirement(owner, project, versionId, "companion", key);
  const apply = () => consumers.applyFailedRetirement(owner, project, versionId, "companion", key, reviewed.review_token);
  const release = lifecycle.releaseReferences;
  lifecycle.releaseReferences = () => { throw new Error("Fixture interrupted after source freeze"); };
  try { assert.throws(apply, /interrupted after source freeze/); }
  finally { lifecycle.releaseReferences = release; }
  const frozen = lifecycle.catalog(project).find(record => record.id === versionId);
  assert.equal(frozen.producer.exit_code, 7);
  assert.equal(frozen.release_receipt, undefined);
  assert.ok(frozen.failed_consumer_retirement);
  assert.equal(lifecycle.catalog(owner).find(record => record.id === proxy.id).references.length, 1);
  assert.equal(consumers.reviewFailedRetirement(owner, project, versionId, "companion", key).status, "source-frozen");
  const recover = lifecycle.recoverCleanup;
  lifecycle.recoverCleanup = () => { throw new Error("Fixture interrupted after proxy release"); };
  try { assert.throws(apply, /interrupted after proxy release/); }
  finally { lifecycle.recoverCleanup = recover; }
  assert.equal(consumers.reviewFailedRetirement(owner, project, versionId, "companion", key).status, "proxy-reference-released");
  assert.equal(apply().status, "recovered");
  assert.equal(apply().idempotent, true);
  const source = lifecycle.catalog(project).find(record => record.id === versionId);
  assert.deepEqual(source.producer, frozen.producer);
  assert.equal(source.release_receipt, undefined);
  assert.equal(lifecycle.catalog(owner).find(record => record.id === proxy.id).producer, undefined);
  const sourceBeforeCleanup = lifecycle.catalog(project).find(record => record.id === versionId);
  const proxyRoot = path.dirname(proxy.bindingPath);
  assert.ok(lifecycle.planCleanup(project, { paths: [f.deployLogs] }).groups.find(group => group.id === versionId).blockers.includes(`active-reference:${versionId}`));
  const { terminal, hash } = retireFailedProxyFixture(f, (terminal, hash) => {
    assert.deepEqual(lifecycle.catalog(project).find(record => record.id === versionId), sourceBeforeCleanup);
    assert.throws(() => consumers.completeFailedRetirement(owner, project, versionId, "companion", key, reviewed.review_token, terminal, hash), /canonically finalized/);
  });
  const complete = () => consumers.completeFailedRetirement(owner, project, versionId, "companion", key, reviewed.review_token, terminal, hash);
  assert.equal(complete().status, "completed");
  assert.equal(complete().idempotent, true);
  const finalSource = lifecycle.catalog(project).find(record => record.id === versionId);
  assert.deepEqual(finalSource.producer, sourceBeforeCleanup.producer);
  assert.ok(finalSource.failed_consumer_completion);
  assert.equal(finalSource.references.some(reference => reference.reason.startsWith("failed-consumer-retirement:")), false);
  assert.equal(lifecycle.catalog(owner).some(record => record.id === proxy.id), false);
  f.write(proxy.bindingPath, "reappeared binding");
  assert.throws(complete, /requires absent path/);
  // Historical receipt parsing is independent of operational reappearance checks.
  assert.ok(lifecycle.catalog(project).find(record => record.id === versionId).failed_consumer_completion);
});

for (const timing of ["before", "after"]) test(`failed consumer retirement reports lease loss ${timing} each metadata CAS without inventing success`, { timeout: 120000 }, t => {
  if (process.platform !== "win32") { t.skip("Windows FileShare.None provider"); return; }
  const f = failedConsumerFixture(t, timing === "before" ? null : 7), { consumers, lifecycle, owner, project, versionId, key, proxy } = f;
  const provider = require("./module-cache-dotnet-lease.cjs"), acquire = provider.acquire;
  let held;
  provider.acquire = (...args) => { held = acquire(...args); return held; };
  try {
    const reviewed = consumers.reviewFailedRetirement(owner, project, versionId, "companion", key);
    const apply = () => consumers.applyFailedRetirement(owner, project, versionId, "companion", key, reviewed.review_token);
    const fault = (method, action) => {
      const original = lifecycle[method]; let injected = false;
      lifecycle[method] = (...args) => {
        const kill = () => { injected = true; process.kill(held.owner.pid); };
        if (timing === "before") kill();
        const value = original(...args);
        if (timing === "after") kill();
        return value;
      };
      try { assert.throws(action); assert.equal(injected, true); }
      finally { lifecycle[method] = original; }
      const source = lifecycle.catalog(project).find(record => record.id === versionId);
      assert.equal(source.state, "failed"); assert.deepEqual(source.producer, f.source.producer);
      assert.equal(source.release_receipt, undefined);
      if (!source.failed_consumer_completion) assert.ok(source.references.some(reference => reference.reason.startsWith("failed-consumer-retirement:")));
    };
    fault("retireFailedConsumerReference", apply);
    assert.equal(lifecycle.catalog(owner).find(record => record.id === proxy.id).references.length, 1);
    fault("releaseReferences", apply);
    assert.equal(lifecycle.catalog(owner).find(record => record.id === proxy.id).references.length, 0);
    assert.equal(lifecycle.catalog(owner).find(record => record.id === proxy.id).cleanup_recovery, undefined);
    fault("recoverCleanup", apply);
    assert.ok(lifecycle.catalog(owner).find(record => record.id === proxy.id).cleanup_recovery.consumer_retirement);
    assert.equal(apply().idempotent, true);
    const { terminal, hash } = retireFailedProxyFixture(f);
    const complete = () => consumers.completeFailedRetirement(owner, project, versionId, "companion", key, reviewed.review_token, terminal, hash);
    fault("completeFailedConsumerRetirement", complete);
    assert.ok(lifecycle.catalog(project).find(record => record.id === versionId).failed_consumer_completion);
    assert.equal(complete().idempotent, true);
  } finally { provider.acquire = acquire; }
});

test("legacy nested p/q preparation binds an explicit ancestor cache owner without inventing proxies", async t => {
  const { root: owner, config: initial, write } = fixture(t);
  const lifecycle = require("./artifact-lifecycle.cjs"), consumers = require("./module-cache-consumers.cjs");
  const key = "e".repeat(64), toolDirectory = path.join(owner, "artifacts/cache/modules/companion", key);
  write(path.join(toolDirectory, "owner.json"), JSON.stringify({ schema: 1, module: "companion", key }));
  lifecycle.recordLifecycle(owner, { id: `run:module-cache:companion:${key}`, owner: "module-build-cache", kind: "run",
    state: "complete", membership_complete: true,
    members: [{ path: toolDirectory, role: "cache-entry", generated: true, protection_known: true }] });
  for (const [name, outcome, withProxy] of [["p", "failure", false], ["q", "unknown", false], ["r", "failure", true]]) {
    const project = path.join(owner, "snapshots", name), output = path.join(project, "output");
    const config = { ...initial, release: path.join(project, "artifacts/releases", name), toolDirectory };
    write(path.join(config.release, "build-info.json"), "{}"); // Genuine legacy omission of moduleBuild.cacheOwner.
    const data = { HostVsix: path.join(output, "host.vsix"), ReleaseDirectory: config.release };
    write(data.HostVsix, "self-contained fixture package");
    write(path.join(output, "independent-prepared.json"), JSON.stringify(data));
    const checkpoint = path.join(output, "preparation-state.json");
    write(checkpoint, JSON.stringify({ inputs: { config }, stages: {} }));
    const tool = { id: `run:module-cache:companion:${key}`, reason: "companion-tool", kind: "dependency" };
    const source = lifecycle.recordLifecycle(project, { id: `version:${name}`, kind: "version", owner: "azrael-release",
      state: "pending", membership_complete: false,
      members: [{ path: config.release, role: "release", generated: true, protection_known: true }],
      references: [tool, { ...tool, reason: "installed runtime", kind: "installation" },
        { id: "version:engine", reason: "engine recovery", kind: "recovery" }] });
    const proxy = withProxy ? consumers.attach(owner, project, source.id, "companion", key) : null;
    const terminal = path.join(project, "terminal.json");write(terminal, "fixture terminal");
    const hash = filename => crypto.createHash("sha256").update(fs.readFileSync(filename)).digest("hex");
    const closed = lifecycle.closeLifecycle(project, source.id, { owner: source.owner, expected_revision: source.revision,
      producer_stopped_verified: true, outcome, exit_code: outcome === "failure" ? 7 : null,
      reason: "Fixture legacy terminal", evidence_ref: terminal, evidence_sha256: hash(terminal) });
    await state.save(output, "complete", data);
    await assert.rejects(state.releaseTools(output, project), /Failed or unresolved/);
    const authorityPath = path.join(project, "invalidation.json");
    const authority = { schema: 1, action: "invalidate-preparation-tool-cache", user_authorized: true,
      project, release_id: source.id, release: config.release, cache_owner: owner, tool_directory: toolDirectory,
      checkpoint_sha256: hash(checkpoint), reason: "User requested all regenerable build caches" };
    write(authorityPath, JSON.stringify(authority));
    const options = { cacheInvalidation: { evidence_ref: authorityPath, evidence_sha256: hash(authorityPath) } };
    const marker = path.join(toolDirectory, "owner.json"), markerBytes = fs.readFileSync(marker);
    write(marker, JSON.stringify({ schema: 1, module: "providers", key }));
    await assert.rejects(state.releaseTools(output, project, options), /Matching legacy tool cache/);
    assert.deepEqual(lifecycle.catalog(project).find(record => record.id === source.id).references, closed.references);
    fs.writeFileSync(marker, markerBytes);
    const result = await state.releaseTools(output, project, options);
    assert.deepEqual(result, { released: 1, legacySourceOnly: !withProxy, cacheOwner: owner, authority: options.cacheInvalidation });
    const retained = lifecycle.catalog(project).find(record => record.id === source.id);
    assert.equal(retained.state, closed.state);assert.deepEqual(retained.producer, closed.producer);
    assert.deepEqual(retained.references, closed.references.filter(reference => reference.reason !== "companion-tool"));
    assert.ok(retained.release_receipt.reason.includes(hash(authorityPath)));
    assert.equal(consumers.listConsumers(owner, project).length, withProxy ? 1 : 0);
    if (proxy) assert.equal(consumers.listConsumers(owner, project)[0].references.length, 0);
    else assert.equal(lifecycle.catalog(owner).some(record => record.owner === "module-cache-consumer" && record.version === source.id), false);
    assert.equal((await state.releaseTools(output, project, options)).released, 0);
  }
});
