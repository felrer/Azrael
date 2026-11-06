"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { test } = require("node:test");
const state = require("./preparation-state.cjs");
const zipToolFiles = ["companion/package-lock.json", "companion/node_modules/azrael-yazl/package.json",
  "companion/node_modules/azrael-yazl/index.js",
  "companion/node_modules/azrael-yazl/node_modules/buffer-crc32/package.json",
  "companion/node_modules/azrael-yazl/node_modules/buffer-crc32/index.js"];

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "azrael-preparation-test-"));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
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
  const output = path.join(root, "output");
  fs.mkdirSync(output);
  return { root, config, output, write };
}

test("unchanged preparation resumes and absent stages are explicit", async t => {
  const { config, output } = fixture(t);
  const initial = await state.initialize(output, config, false);
  assert.deepEqual(await state.initialize(output, config, true), initial);
  assert.deepEqual(await state.load(output, "namespace"), { found: false });
  assert.deepEqual(await state.load(output, "complete"), { found: false });
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
    fs.writeFileSync(file, "changed ZIP tool");
    await assert.rejects(state.initialize(output, config, true), /Preparation inputs changed/, name);
    fs.unlinkSync(file);
    await assert.rejects(state.initialize(output, config, true), { code: "ENOENT" }, name);
    fs.writeFileSync(file, original);
  }
  assert.deepEqual(await state.initialize(output, config, true), initial);
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
