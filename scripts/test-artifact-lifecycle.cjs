"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const lifecycle = require("./artifact-lifecycle.cjs");
const repo = path.resolve(__dirname, "..");
function fixture(t) {
  const parent = process.env.AZRAEL_LIFECYCLE_FIXTURE_ROOT
    ? path.resolve(process.env.AZRAEL_LIFECYCLE_FIXTURE_ROOT) : path.join(repo, "artifacts/verification");
  if (process.env.AZRAEL_LIFECYCLE_FIXTURE_ROOT) assert.ok(parent.startsWith(path.join(repo, "artifacts/tasks") + path.sep));
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, "artifact-lifecycle-"));
  t.after(() => {
    assert.ok(path.resolve(root).startsWith(path.resolve(parent) + path.sep));
    function removeKnown(directory) {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const name = path.join(directory, entry.name);
        if (entry.isDirectory() && !fs.lstatSync(name).isSymbolicLink()) removeKnown(name);
        else fs.unlinkSync(name);
      }
      fs.rmdirSync(directory);
    }
    removeKnown(root);
    assert.equal(fs.existsSync(root), false);
  });
  const at = relative => path.join(root, "artifacts", relative);
  const record = (id, members, extra = {}) => lifecycle.recordLifecycle(root, { id, kind: "version", owner: "fixture-producer", version: "1.0", state: "complete", membership_complete: true, members: members.map(([name, role]) => ({ path: at(name), role })), ...extra });
  return { root, at, record };
}

test("failed producer retains its whole pending identity and append-only membership", t => {
  const { root, at, record } = fixture(t);
  const before = record("release-one", [["releases/one", "release"], ["releases/one.inputs", "inputs"], ["logs/one", "logs"]], { state: "pending", membership_complete: false });
  fs.mkdirSync(at("releases/one.inputs"), { recursive: true });
  const failed = record("release-one", [["releases/one.work", "work"]], { state: "failed", membership_complete: false, expected_revision: before.revision });
  assert.equal(failed.members.length, 4);
  const plan = lifecycle.planCleanup(root, { paths: [at("releases/one.inputs/partial")] });
  assert.equal(plan.groups.length, 1); assert.equal(plan.groups[0].members.length, 4);
  assert.ok(plan.groups[0].blockers.includes("lifecycle-state:failed"));
  assert.ok(plan.groups[0].blockers.includes("incomplete-membership"));
  assert.throws(() => record("release-one", [["logs/old", "logs"]], { expected_revision: before.revision }), /Stale/);
  assert.throws(() => record("release-one", [["logs/other", "logs"]], { owner: "other-producer" }), /Conflicting/);
  assert.throws(() => record("release-one", [["logs/other", "logs"]], { version: "2.0" }), /Conflicting/);
});

test("build producer records all planned members before first output creation fails", async t => {
  const { root, at } = fixture(t);
  fs.mkdirSync(at("logs/multi-platform"), { recursive: true });
  fs.writeFileSync(at("logs/multi-platform/build"), "directory collision prevents any process execution");
  fs.mkdirSync(at("cache/cargo"), { recursive: true });
  const output = at("releases/failed-start");
  await assert.rejects(require("./build-platform.cjs").build({ "project-root": root, output,
    "ui-root": at("ui"), bun: at("bun"), "target-directory": at("cache/cargo"), "code-mode-host": at("host") }), /EEXIST|ENOTDIR/);
  const [record] = lifecycle.catalog(root);
  assert.equal(record.id, "version:failed-start"); assert.equal(record.owner, "azrael-release");
  assert.equal(record.state, "failed"); assert.equal(record.membership_complete, false);
  assert.deepEqual(record.members.map(member => member.role), ["release", "inputs", "work", "logs"]);
  assert.equal(fs.existsSync(output), false);
});

test("selection expands all sibling outputs and native projection keeps disjoint roots", t => {
  const { root, at, record } = fixture(t);
  record("release-two", [["releases/two", "release"], ["releases/two/prepared-host", "prepared"], ["releases/two.inputs", "inputs"], ["logs/two", "logs"]]);
  const plan = lifecycle.planCleanup(root, { paths: [at("releases/two/prepared-host/template.vsix")] });
  assert.equal(plan.groups.length, 1); assert.equal(plan.groups[0].members.length, 3);
  assert.deepEqual(plan.groups[0].blockers, []);
  assert.equal(lifecycle.catalog(root)[0].members.length, 4);
  const request = lifecycle.registerRequest(root, "release-two");
  assert.equal(request.operation, "register"); assert.equal(request.group.members.length, 3);
  assert.ok(request.group.members.every(member => member.generated && !member.protection_known && member.provenance_ref === request.group.provenance_ref));
  assert.deepEqual(request.group.members.map(member => member.id), lifecycle.registerRequest(root, "release-two").group.members.map(member => member.id));
});

test("shared member protection, report destinations and active consumers protect whole groups", t => {
  const { root, at, record } = fixture(t);
  record("a", [["releases/a", "release"], ["shared/key", "cache"]]);
  record("b", [["releases/b", "release"], ["shared/key", "cache"]]);
  let plan = lifecycle.planCleanup(root, { paths: [at("releases/a")], protectedPaths: [at("releases/b/current")] });
  assert.deepEqual(plan.groups.map(group => group.id).sort(), ["a", "b"]);
  assert.ok(plan.groups.every(group => group.blockers.length));
  plan = lifecycle.planCleanup(root, { paths: [at("shared/key")], reportPath: at("releases/a/cleanup.json") });
  assert.ok(plan.groups.find(group => group.id === "a").blockers.includes("report-inside-member"));
  record("consumer", [["verification/consumer", "run"]], { kind: "run", state: "pending", references: [{ id: "a", reason: "active cache consumer" }] });
  plan = lifecycle.planCleanup(root, { paths: [at("releases/a")] });
  assert.ok(plan.groups.find(group => group.id === "a").blockers.includes("active-reference:consumer"));
});

test("native projection protects dependencies from inbound consumers without protecting consumers from outbound dependencies", t => {
  const { root, at, record } = fixture(t);
  record("release", [["releases/main", "release"]]);
  record("package", [["packages/main", "package"]], { kind: "run", references: [{ id: "release", reason: "packaging-input" }] });
  const packagePlan = lifecycle.planCleanup(root, { paths: [at("packages/main")] });
  assert.deepEqual(packagePlan.groups[0].blockers, []);
  const packageRequest = lifecycle.registerRequest(root, "package");
  assert.ok(packageRequest.group.members.every(member => member.references.length === 0));
  assert.equal(packageRequest.group.membership_source, path.join(root, "artifacts/maintenance/lifecycles"));
  const releaseRequest = lifecycle.registerRequest(root, "release");
  assert.ok(releaseRequest.group.members.every(member => member.references.includes("package:packaging-input")));
  assert.ok(lifecycle.planCleanup(root, { paths: [at("releases/main")] }).groups[0].blockers.includes("active-reference:package"));
  record("pending", [["outputs/pending", "output"]], { kind: "run", state: "pending", membership_complete: true });
  assert.equal(lifecycle.registerRequest(root, "pending").group.membership_complete, false);
});

test("native projection marks logs and reports for evidence-last deletion ordering", t => {
  const { root, record } = fixture(t);
  record("ordered", [["releases/ordered", "release"], ["snapshots/ordered", "inputs"], ["logs/ordered", "logs"], ["reports/ordered", "reports"], ["verification/ordered", "evidence"]]);
  const members = lifecycle.registerRequest(root, "ordered").group.members;
  assert.deepEqual(Object.fromEntries(members.map(member => [member.role, member.lifecycle_role])), {
    release: "artifact", inputs: "snapshot", logs: "log", reports: "evidence", evidence: "evidence",
  });
});

test("native projection declares producer registry semantics without changing its source directory", t => {
  const { root, record } = fixture(t);
  record("semantic-source", [["releases/semantic-source", "release"]]);
  const { group } = lifecycle.registerRequest(root, "semantic-source");
  assert.equal(group.membership_source_format, "producer_registry_v1");
  assert.equal(group.membership_source, path.join(root, "artifacts/maintenance/lifecycles"));
  assert.equal(group.provenance_ref, lifecycle.registryPath(root, "semantic-source"));
  assert.ok(group.members.every(member => member.references.length === 0));
});

test("legacy candidates retain their own cleaner boundary and report conflicts are explicit", t => {
  const { root, at } = fixture(t);
  const plan = lifecycle.planCleanup(root, { paths: [at("releases/old-backup")], reportPath: at("releases/old-backup/report.json") });
  assert.deepEqual(plan.groups, []);
  assert.deepEqual(plan.standalone, [{ path: at("releases/old-backup"), registered: false }]);
  assert.equal(plan.blockers.length, 1);
});

test("source, management, traversal and linked paths cannot become lifecycle ownership", t => {
  const { root, at, record } = fixture(t);
  for (const member of [path.join(root, "engine/codex-rs/core"), at("maintenance"), at("maintenance/lifecycles/x"), path.join(root, ".git"), at("releases/.azrael-ex")]) {
    assert.throws(() => record("unsafe", [], { members: [{ path: member, role: "release" }] }), /Source or management|outside/);
  }
  assert.throws(() => record("unsafe", [], { members: [{ path: at("releases") + path.sep + ".." + path.sep + "maintenance", role: "release" }] }), /traversal/);
  fs.mkdirSync(at("verification"), { recursive: true });
  const link = at("verification/link");
  fs.symlinkSync(path.join(repo, "scripts"), link, process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => record("linked", [["verification/link/file", "inputs"]]), /Linked/);
});

test("finalization removes only own registry after every recorded member is actually absent", t => {
  const { root, at, record } = fixture(t);
  record("finished", [["outputs/finished", "output"]]);
  fs.mkdirSync(at("outputs"), { recursive: true }); fs.writeFileSync(at("outputs/finished"), "retained");
  const registry = lifecycle.registryPath(root, "finished");
  assert.equal(lifecycle.finalize(root, "finished").status, "retained");
  assert.ok(fs.existsSync(registry));
  fs.unlinkSync(at("outputs/finished"));
  assert.equal(lifecycle.finalize(root, "finished").status, "finalized");
  assert.equal(fs.existsSync(registry), false);
  record("pending", [["outputs/not-created-yet", "output"]], { state: "pending", membership_complete: false });
  const pending = lifecycle.finalize(root, "pending");
  assert.equal(pending.status, "retained"); assert.ok(pending.blockers.includes("lifecycle-state:pending"));
  record("shared", [["shared/item", "cache"]]);
  record("referrer", [["outputs/referrer", "output"]], { references: [{ id: "shared", reason: "still in use" }] });
  assert.equal(lifecycle.finalize(root, "shared").status, "retained");
  assert.equal(lifecycle.main(["catalog", "--project-root", root, "--limit", "1"]).groups.length, 1);
});

test("CLI cache consumers protect the last shared key until payload and logs are both gone", t => {
  const { root, at, record } = fixture(t);
  record("module-key", [["cache/modules/companion/key", "cache-entry"]], { kind: "run" });
  for (const id of ["version-one", "version-two"]) {
    lifecycle.main(["record", "--project-root", root, "--id", id, "--kind", "version",
      "--owner", "fixture-producer", "--state", "complete", "--membership-complete", "true",
      "--member", `release=${at(`releases/${id}`)}`, "--member", `build-logs=${at(`logs/${id}`)}`,
      "--reference", "module-key=companion-tool"]);
    fs.mkdirSync(at(`releases/${id}`), { recursive: true });
    fs.mkdirSync(at(`logs/${id}`), { recursive: true });
  }
  const groups = lifecycle.main(["catalog", "--project-root", root, "--limit", "200"]).groups;
  assert.deepEqual(groups.find(group => group.id === "version-one").references,
    [{ id: "module-key", reason: "companion-tool" }]);
  assert.equal(lifecycle.registerRequest(root, "module-key").group.members[0].references.length, 2);
  fs.rmdirSync(at("releases/version-one"));
  assert.equal(lifecycle.finalize(root, "version-one").status, "retained");
  fs.rmdirSync(at("logs/version-one"));
  assert.equal(lifecycle.finalize(root, "version-one").status, "finalized");
  let blockers = lifecycle.planCleanup(root, { paths: [at("cache/modules/companion/key")] }).groups[0].blockers;
  assert.deepEqual(blockers, ["active-reference:version-two"]);
  fs.rmdirSync(at("releases/version-two")); fs.rmdirSync(at("logs/version-two"));
  assert.equal(lifecycle.finalize(root, "version-two").status, "finalized");
  blockers = lifecycle.planCleanup(root, { paths: [at("cache/modules/companion/key")] }).groups[0].blockers;
  assert.deepEqual(blockers, []);
  for (const invalid of ["module-key", "=reason", "module-key="]) {
    assert.throws(() => lifecycle.main(["record", "--project-root", root, "--reference", invalid]), /Expected lifecycle-id=reason/);
  }
});

test("Windows lifecycle acceptance includes module management and keeps metric fixtures in the registered run", () => {
  const { commands } = require("./check-artifact-lifecycle.cjs");
  const run = path.join(repo, "artifacts/tasks/lifecycle-checks/runs/command-fixture");
  const selected = commands("windows", "win32", repo, run);
  const metrics = selected.find(([, args]) => args.includes("scripts/test-build-metrics.ps1"));
  assert.ok(metrics);
  assert.equal(metrics[1][metrics[1].indexOf("-OutputDirectory") + 1], path.join(run, "temporary/metrics"));
  assert.ok(selected.some(([, args]) => args.includes("scripts/test-build-module-cache.ps1")));
});
