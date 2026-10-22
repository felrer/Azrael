"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { InstructionMigration } = require("../instruction-migration.cjs");
const { canonicalDigest: hash } = require("../instruction-library.cjs");
const file = (name, content) => ({ path: name, content, encoding: "utf8" });
async function fixture(t, legacy = "canonical") {
  assert.ok(process.env.AZRAEL_MIGRATION_TEST_ROOT, "Run with an artifact-owned fixture root");
  const parent = path.resolve(process.env.AZRAEL_MIGRATION_TEST_ROOT);
  await fs.mkdir(parent, { recursive: true });
  const base = await fs.mkdtemp(path.join(parent, "migration-"));
  const installedRoot = path.join(base, "installed"), libraryRoot = path.join(base, "library"), external = path.join(base, "legacy-source");
  await fs.mkdir(path.join(installedRoot, "skills"), { recursive: true });
  await fs.mkdir(external); await fs.mkdir(libraryRoot);
  await fs.writeFile(path.join(external, "SKILL.md"), legacy);
  const target = path.join(installedRoot, "skills", "example");
  await fs.symlink(external, target, process.platform === "win32" ? "junction" : "dir");
  // Fixtures remain in the run group for lifecycle review; never touch real home/Vault.
  return { base, installedRoot, libraryRoot, external, target, migration: new InstructionMigration({ installedRoot, libraryRoot }), entry: { id: crypto.randomUUID(), digest: hash("canonical"), kind: "skill", files: [file("SKILL.md", "canonical")], installedRelativePath: "skills/example/SKILL.md" } };
}
test("replaces a real directory link with canonical regular bytes and preserves external target", async t => {
  const f = await fixture(t); const plan = await f.migration.plan(f.entry);
  assert.deepEqual(plan.conflicts, []); assert.deepEqual(plan.differences, []);
  assert.ok(Object.isFrozen(plan.resource.files[0]));
  const receipt = await f.migration.apply(plan);
  assert.equal(receipt.outcome, "applied"); assert.equal((await fs.lstat(f.target)).isSymbolicLink(), false);
  assert.equal(await fs.readFile(path.join(f.target, "SKILL.md"), "utf8"), "canonical");
  assert.equal(await fs.readFile(path.join(f.external, "SKILL.md"), "utf8"), "canonical");
  assert.equal(JSON.parse(await fs.readFile(receipt.receiptPath)).originalLink.realTarget, await fs.realpath(f.external));
  await assert.rejects(fs.stat(f.migration.control("writer.lock")), { code: "ENOENT" });
});
test("differing complete legacy inventory requires exact preservation acknowledgement", async t => {
  const f = await fixture(t, "local edits"); await fs.mkdir(path.join(f.external, "support")); await fs.writeFile(path.join(f.external, "support", "a.bin"), Buffer.from([0,255,42]));
  const plan = await f.migration.plan(f.entry);
  assert.equal(plan.legacyFiles.length, 2); assert.equal(plan.legacyDigest, hash(plan.legacyFiles));
  await assert.rejects(f.migration.apply(plan), /must first be preserved/);
  await assert.rejects(f.migration.apply(plan, { preservedDigest: hash("wrong") }), /must first be preserved/);
  await f.migration.apply(plan, { preservedDigest: plan.legacyDigest });
  assert.equal(await fs.readFile(path.join(f.external, "SKILL.md"), "utf8"), "local edits");
  assert.deepEqual(await fs.readFile(path.join(f.external, "support", "a.bin")), Buffer.from([0,255,42]));
});
test("rejects tampered plans and stale link identity and target bytes", async t => {
  const f = await fixture(t);
  const plan = await f.migration.plan(f.entry), tampered = JSON.parse(JSON.stringify(plan)); tampered.targetRoot += "-other";
  await assert.rejects(f.migration.apply(tampered), /identity mismatch/);
  await fs.writeFile(path.join(f.external, "SKILL.md"), "changed");
  await assert.rejects(f.migration.apply(plan), /stale/);
  await fs.writeFile(path.join(f.external, "SKILL.md"), "canonical");
  const other = path.join(f.base, "other"); await fs.mkdir(other); await fs.writeFile(path.join(other, "SKILL.md"), "canonical");
  await fs.unlink(f.target); await fs.symlink(other, f.target, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(f.migration.apply(plan), /stale/);
});
test("rejects inner links, file links, regular destinations, traversal and collisions", async t => {
  const f = await fixture(t);
  await fs.symlink(f.libraryRoot, path.join(f.external, "inner"), process.platform === "win32" ? "junction" : "dir");
  assert.match((await f.migration.plan(f.entry)).conflicts.join(" "), /Linked/);
  await fs.unlink(path.join(f.external, "inner"));
  await fs.unlink(f.target); await fs.mkdir(f.target);
  assert.match((await f.migration.plan(f.entry)).conflicts.join(" "), /top-level/);
  await assert.rejects(f.migration.plan({ ...f.entry, installedRelativePath: "skills/../SKILL.md" }), /Unsafe/);
  await assert.rejects(f.migration.plan({ ...f.entry, files: [file("SKILL.md", "a"), file("skill.md", "b")] }), /collid/i);
  await assert.rejects(f.migration.plan({ ...f.entry, files: [file("SKILL.md", "a"), file("../bad", "b")] }), /Unsafe/);
  // A linked file in a regular folder is never an eligible migration root.
  await fs.symlink(f.external, path.join(f.target, "linked-folder"), process.platform === "win32" ? "junction" : "dir");
  assert.match((await f.migration.plan(f.entry)).conflicts.join(" "), /top-level/);
});
test("shared instruction writer lock and existing recovery metadata block mutation", async t => {
  const f = await fixture(t), plan = await f.migration.plan(f.entry);
  await fs.mkdir(path.dirname(f.migration.control("writer.lock")), { recursive: true });
  await fs.writeFile(f.migration.control("writer.lock"), "other writer");
  await assert.rejects(f.migration.apply(plan), { code: "EEXIST" });
  await fs.unlink(f.migration.control("writer.lock"));
  await fs.writeFile(f.migration.control("journal.json"), "{}");
  await assert.rejects(f.migration.apply(plan), /Other instruction recovery/);
  assert.ok((await fs.lstat(f.target)).isSymbolicLink());
});
test("failed replacement restores the original link and keeps stage recovery evidence", async t => {
  const f = await fixture(t), plan = await f.migration.plan(f.entry), rename = fs.rename;
  fs.rename = async (from, to) => { if (to === f.target) throw Error("injected install failure"); return rename(from,to); };
  try { await assert.rejects(f.migration.apply(plan), /injected install failure/); } finally { fs.rename = rename; }
  assert.ok((await fs.lstat(f.target)).isSymbolicLink()); assert.equal(await fs.realpath(f.target), await fs.realpath(f.external));
  assert.equal(await fs.readFile(path.join(f.external, "SKILL.md"), "utf8"), "canonical");
  const controls = await fs.readdir(path.dirname(f.migration.control("writer.lock")));
  const receipt = JSON.parse(await fs.readFile(f.migration.control(controls.find(n => n.startsWith("migration-receipt-")))));
  assert.equal(receipt.outcome, "rolled-back"); assert.ok(receipt.preservedStage);
  assert.equal((await f.migration.recover()).recovered, false);
});
test("interrupted recovery protects unknown modified destination and retains shared lock", async t => {
  const f = await fixture(t), plan = await f.migration.plan(f.entry), rename = fs.rename;
  fs.rename = async (from,to) => {
    const result = await rename(from,to);
    if (to === f.target) { await fs.writeFile(path.join(f.target, "SKILL.md"), "unknown edit"); throw Error("injected interruption"); }
    return result;
  };
  try { await assert.rejects(f.migration.apply(plan), /recovery required.*Unknown modified/); } finally { fs.rename = rename; }
  await assert.rejects(f.migration.recover(), /Unknown modified/);
  assert.equal(await fs.readFile(path.join(f.target, "SKILL.md"), "utf8"), "unknown edit");
  assert.equal(await fs.readFile(path.join(f.external, "SKILL.md"), "utf8"), "canonical");
  assert.ok(await fs.stat(f.migration.control("writer.lock"))); assert.ok(await fs.stat(f.migration.control("migration-journal.json")));
  // An owner can explicitly restore the known canonical bytes, then retry recovery.
  await fs.writeFile(path.join(f.target, "SKILL.md"), "canonical");
  const recovered = await f.migration.recover(); assert.equal(recovered.recovered, true); assert.equal(recovered.receipt.outcome, "rolled-back");
  assert.ok((await fs.lstat(f.target)).isSymbolicLink());
});

for (const phase of ["receipt", "journal cleanup"]) {
  test(`recorded restored link recovers after rollback ${phase} failure`, async t => {
    const f = await fixture(t), plan = await f.migration.plan(f.entry), rename = fs.rename, unlink = fs.unlink;
    fs.rename = async (from, to) => {
      if (to === f.target) throw Error("injected install failure");
      if (phase === "receipt" && path.basename(to).startsWith("migration-receipt-")) throw Error("injected receipt failure");
      return rename(from, to);
    };
    fs.unlink = async name => {
      if (phase === "journal cleanup" && name === f.migration.control("migration-journal.json")) throw Error("injected journal cleanup failure");
      return unlink(name);
    };
    try { await assert.rejects(f.migration.apply(plan), /migration recovery required/); }
    finally { fs.rename = rename; fs.unlink = unlink; }
    const before = await fs.lstat(f.target), journal = JSON.parse(await fs.readFile(f.migration.control("migration-journal.json")));
    assert.deepEqual(journal.restoredLinkIdentity, { dev: before.dev, ino: before.ino, birthtimeMs: before.birthtimeMs });
    const result = await f.migration.recover();
    assert.equal(result.recovered, true); assert.equal(result.receipt.outcome, "rolled-back");
    assert.equal((await fs.lstat(f.target)).ino, before.ino);
    assert.equal(await fs.realpath(f.target), await fs.realpath(f.external));
    assert.equal(await fs.readFile(path.join(f.external, "SKILL.md"), "utf8"), "canonical");
    await assert.rejects(fs.lstat(f.migration.control("migration-journal.json")), { code: "ENOENT" });
    await assert.rejects(fs.lstat(f.migration.control("writer.lock")), { code: "ENOENT" });
  });
}

test("recorded rollback identity never adopts a different replacement link", async t => {
  const f = await fixture(t), plan = await f.migration.plan(f.entry), rename = fs.rename;
  fs.rename = async (from, to) => {
    if (to === f.target) throw Error("injected install failure");
    if (path.basename(to).startsWith("migration-receipt-")) throw Error("injected receipt failure");
    return rename(from, to);
  };
  try { await assert.rejects(f.migration.apply(plan), /migration recovery required/); }
  finally { fs.rename = rename; }
  await fs.rename(f.target, path.join(f.base, "recorded-restored-link"));
  await fs.symlink(f.external, f.target, process.platform === "win32" ? "junction" : "dir");
  const replacement = await fs.lstat(f.target);
  await assert.rejects(f.migration.recover(), /Unknown replacement link is protected/);
  assert.equal((await fs.lstat(f.target)).ino, replacement.ino);
  assert.equal(await fs.realpath(f.target), await fs.realpath(f.external));
  assert.ok(await fs.lstat(f.migration.control("migration-journal.json")));
  assert.ok(await fs.lstat(f.migration.control("writer.lock")));
});
