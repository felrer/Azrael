"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const project = require("./test-project.cjs");
const adapter = require("./project-maintenance.cjs");
const root = path.resolve(__dirname, "..");

test("source selectors preserve grouped commands, files, reasons and separate gates", () => {
  for (const area of ["queue", "recovery", "namespace", "window-control", "build-cache"]) {
    const options = project.parseArgs(["--area", area, "--test-concurrency", "2"]);
    const existing = project.select(options);
    const plan = adapter.planSelection(options);
    for (const field of ["files", "areas", "reasons", "separateChecks", "coverageStatus"]) assert.deepEqual(plan[field], existing[field]);
    assert.deepEqual(plan.commands.map(({ phase, checkIds, dependsOn, ...command }) => command), existing.commands);
    assert.ok(plan.commands.every(command => command.phase === "test" && command.checkIds.length));
  }
  const options = project.parseArgs(["--changed-only", "--changed", "scripts/not-owned.fixture"]);
  assert.deepEqual(adapter.planSelection(options).separateChecks, project.select(options).separateChecks);
});

test("extension compilation is a distinct prepare step and test-only execution requires acknowledgement", () => {
  for (const area of ["extension", "standalone", "current"]) {
    const plan = adapter.planSelection(project.parseArgs(["--area", area]));
    const prepares = plan.commands.filter(command => command.phase === "prepare");
    assert.equal(prepares.length, 1);
    assert.deepEqual(prepares[0].args, ["scripts/build-incremental.cjs"]);
    assert.throws(() => adapter.assertTestPlan(plan), /Explicit extension prepare/);
    assert.throws(() => adapter.assertTestPlan(plan, { prepared: true }), /unsupported without trusted owner evidence/);
    const explicit = adapter.assertTestPlan(plan, { allowPrepare: true });
    assert.ok(explicit.commands.every(command => command.executable !== "npm"));
    assert.equal(explicit.commands.filter(command => command.phase === "prepare").length, 1);
    const extension = explicit.commands.find(command => command.phase === "test" && command.cwd.endsWith(path.join("extensions", "azrael-ex")));
    assert.deepEqual(extension.args, ["scripts/run-tests.cjs", area === "standalone" ? "standalone" : "current"]);
    assert.deepEqual(extension.dependsOn, ["extension-build"]);
  }
  assert.throws(() => adapter.assertTestPlan({ commands: [{ phase: "build" }] }), /product build/);
  assert.throws(() => adapter.assertTestPlan({ commands: [{ phase: "test", executable: "npm", args: ["run", "test:current"] }] }), /Hidden/);
});

test("caller preparation claims cannot bypass owner validation", async () => {
  const source = adapter.planSelection(project.parseArgs(["--area", "queue"]));
  let invoked = false;
  await assert.rejects(adapter.executeTests(source, { prepared: true, runCommand: async () => { invoked = true; return { status: "passed", exitCode: 0 }; } }), /unsupported without trusted owner evidence/);
  assert.equal(invoked, false);
  assert.throws(() => adapter.assertTestPlan(source, { prepared: true, allowPrepare: true }), /unsupported without trusted owner evidence/);
  await assert.rejects(adapter.main(["plan", "--area", "queue", "--prepared"]), /unsupported without trusted owner evidence/);
  await assert.rejects(adapter.main(["test", "--area", "queue", "--prepared"]), /unsupported without trusted owner evidence/);
});

test("native catalog keeps component build receipts separate and explicit test prerequisites", () => {
  const catalog = adapter.catalog();
  const prepare = catalog.bundles.find(bundle => bundle.id === "extension-prepare");
  const build = catalog.bundles.find(bundle => bundle.id === "extension-component-build");
  assert.equal(prepare.phase, "prepare"); assert.equal(build.phase, "build");
  assert.deepEqual(build.argv, prepare.argv);
  for (const id of ["extension-current", "extension-standalone"]) {
    const bundle = catalog.bundles.find(bundle => bundle.id === id);
    assert.deepEqual(bundle.depends_on, [prepare.id]);
    assert.equal(bundle.argv[1], "scripts/run-tests.cjs");
  }
  assert.ok(catalog.bundles.find(bundle => bundle.id === "source-queue").checkIds.length >= 6);
});

test("native configuration admits Cargo target descendants while excluding source owners", () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, "project-maintenance.json"), "utf8"));
  // Inspect configuration only: the native library enforces managed-root equality,
  // identity, live protection and filesystem checks before registering/deleting.
  const target = "engine/codex-rs/target";
  assert.ok(config.managed_roots.includes(target));
  const descendant = `${target}/debug/deps/fixture-only`;
  assert.ok(config.managed_roots.some(managed => descendant.startsWith(`${managed}/`)));
  assert.ok(!config.protected_paths.some(protectedPath => descendant === protectedPath || descendant.startsWith(`${protectedPath}/`)));
  for (const source of ["engine/codex-rs/core/src/lib.rs", "engine/codex-rs/Cargo.toml", "engine/codex-rs/Cargo.lock", "engine/codex-rs/project-maintenance/src/lib.rs"]) {
    assert.ok(!config.managed_roots.some(managed => source === managed || source.startsWith(`${managed}/`)), source);
  }
  assert.ok(!config.managed_roots.includes("engine"));
  assert.ok(!config.managed_roots.includes("engine/codex-rs"));
});

test("failed explicit preparation blocks dependent tests even when collecting failures", async () => {
  const directory = path.join(root, "artifacts/logs/project-maintenance", `adapter-contract-${process.pid}-${Date.now()}`);
  const plan = adapter.planSelection(project.parseArgs(["--area", "extension"]));
  const invoked = [];
  try {
    const result = await adapter.executeTests(plan, { allowPrepare: true, collectFailures: true, directory,
      runCommand: async command => { invoked.push(command.name); return { status: "failed", exitCode: 7 }; } });
    assert.deepEqual(invoked, ["extension-build"]);
    assert.equal(result.exitCode, 7);
    assert.equal(result.results[1].status, "blocked");
    const receipt = JSON.parse(fs.readFileSync(result.resultPath));
    assert.equal(receipt.results[0].phase, "prepare");
    assert.equal(receipt.results[0].exitCode, 7);
    assert.equal(receipt.results[1].phase, "test");
  } finally {
    // Only the two known runner checkpoint filenames, then the empty directory.
    for (const name of ["results.json", "results.json.tmp"]) if (fs.existsSync(path.join(directory, name))) fs.unlinkSync(path.join(directory, name));
    if (fs.existsSync(directory)) fs.rmdirSync(directory);
  }
});

test("default adapter output exposes the managed run and preserves failure protection", async () => {
  const lifecycle = require("./artifact-lifecycle.cjs");
  fs.mkdirSync(path.join(root, "artifacts/verification"), { recursive: true });
  const fixture = fs.mkdtempSync(path.join(root, "artifacts/verification/maintenance-run-layout-"));
  try {
    const plan = { commands: [{ name: "source", executable: process.execPath, args: [], cwd: fixture,
      files: [], phase: "test", checkIds: ["fixture"], dependsOn: [] }],
      coverageStatus: "selected-source-scope", separateChecks: [] };
    for (const exitCode of [0, 7]) {
      const result = await adapter.executeTests(plan, { workId: "adapter-fixture",
        runCommand: async () => ({ status: exitCode === 0 ? "passed" : "failed", exitCode }) }, fixture);
      assert.equal(result.exitCode, exitCode);
      assert.equal(path.relative(fixture, result.runRoot).split(path.sep).slice(0, 4).join("/"), "artifacts/tasks/adapter-fixture/runs");
      assert.equal(result.resultPath, path.join(result.runRoot, "reports/results.json"));
      assert.equal(result.logDirectory, path.join(result.runRoot, "logs"));
      const record = lifecycle.catalog(fixture).find(item => item.id === result.lifecycleId);
      assert.equal(record.state, exitCode === 0 ? "complete" : "failed");
      assert.equal(record.membership_complete, exitCode === 0);
      const registration = lifecycle.registerRequest(fixture, result.lifecycleId);
      assert.equal(registration.group.id, result.lifecycleId);
      assert.equal(registration.group.members.length, 1);
      assert.ok(registration.group.members.every(member => member.path === result.runRoot));
    }
  } finally { fs.rmSync(fixture, { recursive: true }); }
});

test("receipt collection preserves provenance and unknown protection without scanning directories", () => {
  fs.mkdirSync(path.join(root, "artifacts/verification"), { recursive: true });
  const fixture = fs.mkdtempSync(path.join(root, "artifacts/verification/maintenance-adapter 한글-"));
  const backup = path.join(fixture, "saved-extension");
  const manifest = path.join(fixture, "deployment.json");
  fs.mkdirSync(backup);
  const receipt = { schema: 1, generatedAt: "2026-10-15T00:00:00Z", previousOwnExtensions: [{ backup, source: "original", version: "1.2.3" }] };
  const collect = () => adapter.collectRegistrationCandidates([{ owner: "install-native-vscode", manifest }]);
  try {
    fs.writeFileSync(manifest, JSON.stringify(receipt));
    const [candidate] = collect();
    assert.equal(candidate.protection_known, false);
    assert.equal(candidate.logical_bytes, null);
    assert.equal(candidate.version, "1.2.3");
    assert.equal(candidate.created_at, receipt.generatedAt);
    assert.match(candidate.provenance.sha256, /^[a-f0-9]{64}$/);
    assert.ok(candidate.references.every(reference => typeof reference === "string"));
    assert.equal(candidate.references[0], `recovery-receipt:${path.relative(root, manifest).replace(/\\/g, "/")}`);
    delete receipt.generatedAt; delete receipt.previousOwnExtensions[0].version;
    fs.writeFileSync(manifest, JSON.stringify(receipt));
    assert.equal(collect()[0].version, null); assert.equal(collect()[0].created_at, null);
    receipt.previousOwnExtensions[0].backup = path.join(root, "artifacts/verification");
    fs.writeFileSync(manifest, JSON.stringify(receipt));
    assert.throws(collect, /outside receipt/);
    assert.throws(() => adapter.confined(root, "artifacts/../instructions"), /Unsafe/);
    assert.throws(() => adapter.confined(root, "instructions/AGENTS.md"), /outside/);
    assert.throws(() => adapter.collectRegistrationCandidates([{ owner: "guessed-backup", manifest }]), /Unknown receipt/);
  } finally { fs.unlinkSync(manifest); fs.rmdirSync(backup); fs.rmdirSync(fixture); }
});

test("registration and log paths refuse directory links", () => {
  fs.mkdirSync(path.join(root, "artifacts/verification"), { recursive: true });
  const fixture = fs.mkdtempSync(path.join(root, "artifacts/verification/maintenance-link-"));
  const link = path.join(fixture, "link");
  try {
    fs.symlinkSync(path.join(root, "scripts"), link, process.platform === "win32" ? "junction" : "dir");
    assert.throws(() => adapter.confined(root, path.join(link, "project-maintenance.cjs")), /Linked path/);
  } finally {
    if (fs.existsSync(link)) fs.unlinkSync(link);
    fs.rmdirSync(fixture);
  }
});
