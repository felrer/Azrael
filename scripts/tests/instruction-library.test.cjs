"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const execFile = require("node:util").promisify(require("node:child_process").execFile);
const { InstructionLibrary } = require("../instruction-library.cjs");
const { InstructionStore } = require("../instruction-package.cjs");
const file = (name, content) => ({ path: name, encoding: "utf8", content });
const skill = (name = "example", sharing = "collaborators") => ({ name, kind: "skill", sharing, files: [file("SKILL.md", `---\nname: ${name}\ndescription: A reusable skill\n---\nInstructions\n`), file("references/a.md", "Support reference")] });
async function fixture(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "azrael-library-"));
  t.after(() => fs.rm(base, { recursive: true }));
  const root = path.join(base, "library"), installedRoot = path.join(base, "installed");
  return { base, root, installedRoot, lib: new InstructionLibrary({ root, installedRoot }) };
}
test("import retains originals, binary support and separates save from apply and publish", async t => {
  const { base, installedRoot, lib } = await fixture(t); const source = path.join(base, "original"); await fs.mkdir(source);
  await fs.writeFile(path.join(source, "SKILL.md"), skill().files[0].content);
  const binary = Buffer.from([0, 1, 255, 128]); await fs.writeFile(path.join(source, "image.bin"), binary);
  const entry = await lib.importPath(source); assert.equal(entry.sharing, "collaborators"); assert.equal(entry.installedDigest, null);
  assert.deepEqual(Buffer.from(entry.files.find(f => f.path === "image.bin").content, "base64"), binary);
  assert.equal(await fs.readFile(path.join(source, "SKILL.md"), "utf8"), skill().files[0].content);
  await assert.rejects(fs.stat(installedRoot), { code: "ENOENT" });
  const state = await lib.getState(); const saved = await lib.save(entry.id, { files: [...entry.files, file("notes.md", "edit")] }, state.revision);
  assert.equal(saved.id, entry.id); assert.notEqual(saved.digest, entry.digest); assert.equal(saved.version, 2);
  assert.equal(saved.installedDigest, null); assert.deepEqual(saved.publications, []);
  await assert.rejects(lib.save(entry.id, { name: "other" }, state.revision), /revision conflict/);
});
test("drafts can be saved but invalid packages cannot apply or publish", async t => {
  const { lib } = await fixture(t); const entry = await lib.create({ name: "bad", kind: "skill", sharing: "public", files: [] });
  assert.deepEqual(entry.validationErrors, ["Missing SKILL.md"]);
  await assert.rejects(lib.planApply([entry.id]), /Invalid package/); await assert.rejects(lib.planPublish([entry.id], "public"), /Invalid package/);
  const s = await lib.getState(); await lib.save(entry.id, { files: skill("bad").files }, s.revision); assert.equal((await lib.read(entry.id)).validationErrors.length, 0);
});
test("unsafe paths, case collisions, private exports and overlapping roots rejected", async t => {
  const { base, root, lib } = await fixture(t);
  assert.throws(() => new InstructionLibrary({ root, installedRoot: path.join(root, "skills") }), /Protected roots/);
  for (const name of ["../escape", "a\\b", "CON.txt", "a/../b", "foo. ", "C:/secret"])
    await assert.rejects(lib.create({ name: "safe", kind: "context", files: [file(name, "data")] }), /Unsafe package path/);
  await assert.rejects(lib.create({ name: "safe", kind: "context", files: [file("A.md", "a"), file("a.md", "b")] }), /Case-colliding/);
  await assert.rejects(lib.create({ name: "safe", kind: "context", files: [file("A/x.md", "a"), file("a/y.md", "b")] }), /Case-colliding/);
  await assert.rejects(lib.create({ name: "safe", kind: "context", files: [file("a", "a"), file("a/y.md", "b")] }), /directory collision/);
  const entry = await lib.create({ name: "private", kind: "context", sharing: "public", files: [file(".env", "TOKEN=secret")] });
  await assert.rejects(lib.planPublish([entry.id], "public"), /Private configuration/);
  const encodedSecret = await lib.create({ name: "encoded-secret", kind: "context", sharing: "public", files: [{ path: "support.bin", encoding: "base64", content: Buffer.from("sk-" + "A".repeat(24)).toString("base64") }] });
  await assert.rejects(lib.planPublish([encodedSecret.id], "public"), /Private paths or credentials/);
  const link = path.join(base, "link");
  try { await fs.symlink(base, link, "junction"); } catch(e) { if (["EPERM", "EACCES"].includes(e.code)) { t.diagnostic("Symlink creation unavailable"); return; } throw e; }
  await assert.rejects(lib.importPath(link), /Symlink/);
});
test("tracked maintained instruction roots cannot become personal library storage", async t => {
  const { installedRoot } = await fixture(t);
  const lib = new InstructionLibrary({ root: path.resolve(__dirname, "../../instructions"), installedRoot });
  await assert.rejects(lib.list(), /Tracked library roots/);
});
test("repository-local library storage requires explicit Git exclusion before any write", async t => {
  const { base } = await fixture(t), repository = path.join(base, "repository"); await fs.mkdir(repository);
  await execFile("git", ["init", repository], { windowsHide: true });
  const root = path.join(repository, "library"), lib = new InstructionLibrary({ root, installedRoot: path.join(base, "home") });
  await assert.rejects(lib.create(skill()), /Git-ignored/); await assert.rejects(fs.stat(root), { code: "ENOENT" });
  await fs.writeFile(path.join(repository, ".gitignore"), "/library/\n");
  const entry = await lib.create(skill()); assert.equal((await lib.read(entry.id)).id, entry.id);
});
test("profiles preserve pinned historical content and explicit model overrides", async t => {
  const { lib } = await fixture(t); const context = await lib.create({ name: "rules", kind: "context", files: [file("rules.md", "Original rule")] });
  const profile = await lib.create({ name: "review", kind: "task-profile", files: [], profile: { model: "recommended", provider: "provider", dependencies: [{ id: context.id, digest: context.digest }], instructions: "Review carefully" } });
  const s = await lib.getState(); await lib.save(context.id, { files: [file("rules.md", "Changed rule")] }, s.revision);
  const result = await lib.resolveProfile(profile.id, { model: "explicit", reasoningEffort: "high" });
  assert.equal(result.model, "explicit"); assert.equal(result.provider, "provider"); assert.equal(result.packages.find(e => e.id === context.id).digest, context.digest);
  assert.ok(result.instructions.some(i => i.text === "Original rule")); assert.equal((await lib.read(profile.id)).profile.model, "recommended");
  assert.ok(Object.isFrozen(result.packages[0].files)); assert.ok(result.instructions.some(i => i.loading === "persistent"));
  await assert.rejects(lib.resolveProfile(profile.id, { model: "" }), /model selection/);
});
test("missing, conflicting and unpinned dependencies fail and optional missing refs stay optional", async t => {
  const { lib } = await fixture(t); const missing = crypto.randomUUID(), d = "a".repeat(64);
  const entry = await lib.create({ name: "profile", kind: "task-profile", profile: { model: "model", dependencies: [{ id: missing, digest: d }] } });
  await assert.rejects(lib.resolveProfile(entry.id), /Missing required/);
  const invalid = await lib.create({ name: "unpinned", kind: "task-profile", profile: { model: "model", dependencies: [{ id: missing }] } }); assert.match(invalid.validationErrors[0], /digest/);
  const optional = await lib.create({ name: "optional", kind: "task-profile", profile: { model: "model", dependencies: [{ id: missing, digest: d, optional: true }] } });
  assert.equal((await lib.resolveProfile(optional.id)).packages.length, 1);
  const context = await lib.create({ name: "rules", kind: "context", files: [file("a.md", "one")] });
  let s = await lib.getState(); const updated = await lib.save(context.id, { files: [file("a.md", "two")] }, s.revision);
  const mixed = await lib.create({ name: "mixed", kind: "task-profile", profile: { model: "model", dependencies: [{ id: context.id, digest: context.digest }, { id: context.id, digest: updated.digest }] } });
  await assert.rejects(lib.resolveProfile(mixed.id), /version mismatch/);
  const a = await lib.create({ name: "a", kind: "task-profile", profile: { model: "m", dependencies: [] } });
  const b = await lib.create({ name: "b", kind: "task-profile", profile: { model: "m", dependencies: [{ id: a.id, digest: a.digest }] } });
  s = await lib.getState(); await lib.save(a.id, { profile: { model: "m", dependencies: [{ id: b.id, digest: b.digest }] } }, s.revision);
  await assert.rejects(lib.resolveProfile(a.id), /cycle/);
});
test("verified remote acquisition preserves identity and provenance without applying and refuses local edits", async t => {
  const first = await fixture(t), second = await fixture(t);
  const original = await first.lib.create(skill("remote", "public"));
  const provenance = { repository: "owner/public", version: "v1", commit: "abc" };
  const acquired = await second.lib.importPackage(original, provenance);
  assert.equal(acquired.id, original.id); assert.equal(acquired.digest, original.digest); assert.equal(acquired.installedDigest, null);
  assert.equal(acquired.publications[0].destination, "owner/public"); await assert.rejects(fs.stat(second.installedRoot), { code: "ENOENT" });
  await second.lib.importPackage(original, provenance); assert.equal((await second.lib.list()).length, 1);
  const state = await second.lib.getState(); await second.lib.save(original.id, { name: undefined, files: [...original.files, file("local.md", "local change")] }, state.revision);
  await assert.rejects(second.lib.importPackage(original, provenance), /conflicts with local/);
  const modified = structuredClone(original); modified.files[0].content += "tamper";
  await assert.rejects(second.lib.importPackage(modified, provenance), /integrity/);
});
test("publication carries current heads plus pinned history and remote imports keep historical versions", async t => {
  const { lib } = await fixture(t), destination = await fixture(t);
  const old = await lib.create(skill("historical", "public"));
  const profile = await lib.create({ name: "recipe", kind: "task-profile", sharing: "public", profile: { model: "m", dependencies: [{ id: old.id, digest: old.digest }] } });
  const state = await lib.getState(); const current = await lib.save(old.id, { files: [...old.files, file("new.md", "current")] }, state.revision);
  const plan = await lib.planPublish([current.id, profile.id], "public");
  assert.equal(plan.packages.filter(e => e.id === old.id).length, 2); assert.equal(plan.heads[old.id], current.digest); assert.deepEqual(plan.rootIds, [current.id, profile.id]);
  const provenance = { repository: "owner/repo", version: "v1", commit: "c" };
  await destination.lib.importPackage(old, { ...provenance, current: false });
  await destination.lib.importPackage(current, provenance);
  await destination.lib.importPackage(profile, provenance);
  await destination.lib.importPackage(old, { ...provenance, current: false });
  assert.equal((await destination.lib.read(old.id)).digest, current.digest);
  const resolved = await destination.lib.resolveProfile(profile.id); assert.equal(resolved.packages.find(e => e.id === old.id).digest, old.digest);
  const apply = await destination.lib.planApply([profile.id]); await destination.lib.apply(apply);
  assert.equal((await destination.lib.read(old.id)).installedDigest, old.digest);
  await assert.rejects(fs.stat(path.join(destination.installedRoot, "skills/historical/new.md")), { code: "ENOENT" });
});
test("publication plans are immutable, omit local registry, enforce scopes and retain old publication receipts", async t => {
  const { lib, root } = await fixture(t); const entry = await lib.create(skill("public-skill", "public"));
  const plan = await lib.planPublish([entry.id], "public"); assert.ok(Object.isFrozen(plan)); assert.equal(JSON.stringify(plan).includes(root), false); assert.equal("installedDigest" in plan.packages[0], false);
  const s = await lib.getState(); await lib.save(entry.id, { sharing: "local", files: [...entry.files, file("edit.md", "changed")] }, s.revision);
  await lib.recordPublication(plan, { destination: "owner/public", version: "v1", commit: "commit" });
  const publishedRevision = (await lib.getState()).revision;
  await lib.recordPublication(plan, { destination: "owner/public", version: "v1", commit: "commit" });
  assert.equal((await lib.getState()).revision, publishedRevision, "reconciling the same publication must preserve reviewed revisions");
  assert.equal((await lib.read(entry.id)).publications[0].digest, entry.digest); await assert.rejects(lib.planPublish([entry.id], "public"), /sharing mismatch/);
  const profile = await lib.create({ name: "public-profile", kind: "task-profile", sharing: "public", profile: { model: "m", dependencies: [{ id: entry.id, digest: entry.digest }] } });
  await assert.rejects(lib.planPublish([profile.id], "public"), /sharing mismatch/);
  await assert.rejects(lib.planPublish([entry.id], "local"), /cannot be published/);
  const tampered = structuredClone(plan); tampered.packages[0].name = "tamper"; await assert.rejects(lib.recordPublication(tampered, { destination: "x", version: "v", commit: "c" }), /identity mismatch/);
});
test("apply installs complete skill and roles, preserves unmanaged files and detects external edits", async t => {
  const { lib, installedRoot } = await fixture(t); const entry = await lib.create(skill());
  await fs.mkdir(installedRoot, { recursive: true }); await fs.writeFile(path.join(installedRoot, "AGENTS.md"), "global retained");
  const role = await lib.create({ name: "reviewer", kind: "agent-role", files: [file("review.toml", 'model = "model"\ndeveloper_instructions = "Review"\n')] });
  const plan = await lib.planApply([entry.id, role.id]); assert.deepEqual(plan.conflicts, []); const receipt = await lib.apply(plan); assert.equal(receipt.digest, plan.digest);
  assert.equal(await fs.readFile(path.join(installedRoot, "skills/example/references/a.md"), "utf8"), "Support reference");
  assert.match(await fs.readFile(path.join(installedRoot, "agents/reviewer.toml"), "utf8"), /Review/);
  assert.equal(await fs.readFile(path.join(installedRoot, "AGENTS.md"), "utf8"), "global retained");
  assert.equal((await lib.read(entry.id)).installedDigest, entry.digest); assert.deepEqual((await lib.planApply([entry.id])).diffs, []);
  await fs.writeFile(path.join(installedRoot, "skills/example/SKILL.md"), "external edit");
  const conflict = await lib.planApply([entry.id]); assert.match(conflict.conflicts.join(), /External/); await assert.rejects(lib.apply(conflict), /conflicts/);
});
test("preview rejects newly added external files and duplicate ownership, rename removes old managed files", async t => {
  const { lib, installedRoot } = await fixture(t); const entry = await lib.create(skill()); const plan = await lib.planApply([entry.id]);
  await fs.mkdir(path.join(installedRoot, "skills/example"), { recursive: true }); await fs.writeFile(path.join(installedRoot, "skills/example/SKILL.md"), "external");
  await assert.rejects(lib.apply(plan), /preview changed/); await fs.unlink(path.join(installedRoot, "skills/example/SKILL.md"));
  await lib.apply(await lib.planApply([entry.id]));
  const other = await lib.create(skill()); assert.match((await lib.planApply([entry.id, other.id])).conflicts.join(), /Duplicate destination/);
  const s = await lib.getState(); await lib.save(entry.id, { files: skill("renamed").files, name: "renamed" }, s.revision);
  const rename = await lib.planApply([entry.id]); assert.ok(rename.diffs.some(d => d.path === "skills/example/SKILL.md" && d.content === null)); await lib.apply(rename);
  await assert.rejects(fs.stat(path.join(installedRoot, "skills/example/SKILL.md")), { code: "ENOENT" });
  assert.match(await fs.readFile(path.join(installedRoot, "skills/renamed/SKILL.md"), "utf8"), /renamed/);
});
test("interrupted application recovers backups and refuses external modifications", async t => {
  const { lib, root, installedRoot } = await fixture(t); const entry = await lib.create(skill()); await lib.apply(await lib.planApply([entry.id]));
  const state = JSON.parse(await fs.readFile(path.join(root, "registry.json"), "utf8")); const target = "skills/example/SKILL.md", old = await fs.readFile(path.join(installedRoot, target)); const next = Buffer.from("interrupted edit");
  const hash = b => crypto.createHash("sha256").update(b).digest("hex");
  const journal = { schemaVersion: 1, state, diffs: [{ path: target, beforeDigest: hash(old), afterDigest: hash(next), beforeContent: old.toString("base64"), content: next.toString("base64") }] };
  await fs.writeFile(path.join(root, "journal.json"), JSON.stringify(journal)); await fs.writeFile(path.join(installedRoot, target), next);
  assert.deepEqual(await lib.recover(), { recovered: true }); assert.deepEqual(await fs.readFile(path.join(installedRoot, target)), old);
  await fs.writeFile(path.join(root, "journal.json"), JSON.stringify(journal)); await fs.writeFile(path.join(installedRoot, target), "external");
  await assert.rejects(lib.recover(), /external edit/); assert.equal(await fs.readFile(path.join(installedRoot, target), "utf8"), "external");
  await assert.rejects(lib.create(skill("other")), /requires recovery/);
  journal.diffs[0].beforeContent = Buffer.from("corrupted backup").toString("base64"); await fs.writeFile(path.join(root, "journal.json"), JSON.stringify(journal));
  await assert.rejects(lib.recover(), /backup integrity/);
});
test("distinct personal libraries serialize actual apply through the common destination writer lock", async t => {
  const { lib, base, installedRoot, root } = await fixture(t);
  const second = new InstructionLibrary({ root: path.join(base, "second-library"), installedRoot });
  const firstEntry = await lib.create(skill("first")), secondEntry = await second.create(skill("second"));
  const firstPlan = await lib.planApply([firstEntry.id]), secondPlan = await second.planApply([secondEntry.id]);
  await fs.mkdir(installedRoot, { recursive: true }); await fs.writeFile(path.join(installedRoot, "AGENTS.md"), "unaffected global");
  let signal, release; const entered = new Promise(resolve => { signal = resolve; }), gate = new Promise(resolve => { release = resolve; });
  const original = fs.writeFile;
  fs.writeFile = async function(target, ...args) {
    const result = await original.call(this, target, ...args);
    if (String(target).startsWith(path.join(root, "journal.json."))) { signal(); await gate; }
    return result;
  };
  const firstApply = lib.apply(firstPlan);
  try {
    await Promise.race([entered, firstApply.then(() => { throw new Error("Apply completed before transaction gate"); })]);
    await assert.rejects(second.apply(secondPlan), /writer lock exists/);
    await assert.rejects(fs.stat(path.join(installedRoot, "skills/second/SKILL.md")), { code: "ENOENT" });
    assert.equal(await fs.readFile(path.join(installedRoot, "AGENTS.md"), "utf8"), "unaffected global");
  } finally { release(); fs.writeFile = original; await firstApply; }
  await second.apply(secondPlan);
  assert.match(await fs.readFile(path.join(installedRoot, "skills/first/SKILL.md"), "utf8"), /first/);
  assert.match(await fs.readFile(path.join(installedRoot, "skills/second/SKILL.md"), "utf8"), /second/);
});
test("baseline writer contention and unfinished baseline journals block personal mutations without clearing them", async t => {
  const { lib, installedRoot } = await fixture(t), entry = await lib.create(skill()), plan = await lib.planApply([entry.id]);
  const baseline = new InstructionStore({ stateRoot: installedRoot, appVersion: "0.4.0" });
  const stateRoot = path.join(installedRoot, "azrael/instructions"), lock = path.join(stateRoot, "writer.lock");
  await baseline.locked(async () => {
    const before = await fs.readFile(lock);
    await assert.rejects(lib.apply(plan), /writer lock exists/);
    await assert.rejects(lib.recover(), /writer lock is protected/);
    assert.deepEqual(await fs.readFile(lock), before);
  });
  const journal = path.join(stateRoot, "journal.json"); await fs.writeFile(journal, "baseline recovery evidence");
  await assert.rejects(lib.apply(plan), /Baseline instruction recovery required/);
  await assert.rejects(lib.recover(), /Baseline instruction recovery required/);
  assert.equal(await fs.readFile(journal, "utf8"), "baseline recovery evidence");
  await assert.rejects(fs.stat(path.join(installedRoot, "skills/example/SKILL.md")), { code: "ENOENT" });
  await fs.unlink(journal); await lib.apply(plan);
});
test("recovery clears only this library's dead shared writer and preserves baseline or another library ownership", async t => {
  const { lib, installedRoot, root, base } = await fixture(t); await lib.create(skill());
  const { stdout } = await execFile(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { windowsHide: true }); const pid = Number(stdout);
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  const sharedRoot = path.join(installedRoot, "azrael/instructions"), lock = path.join(sharedRoot, "writer.lock"); await fs.mkdir(sharedRoot, { recursive: true });
  const own = { pid, owner: "instruction-library", libraryRoot: root };
  await fs.writeFile(lock, JSON.stringify(own)); assert.equal((await lib.recoveryState()).sharedWriterOwned, true);
  assert.deepEqual(await lib.recover(), { recovered: false }); await assert.rejects(fs.stat(lock), { code: "ENOENT" });
  for (const marker of [{ pid }, { ...own, libraryRoot: path.join(base, "other-library") }]) {
    const original = JSON.stringify(marker); await fs.writeFile(lock, original);
    await assert.rejects(lib.recover(), /writer lock is protected/); assert.equal(await fs.readFile(lock, "utf8"), original); await fs.unlink(lock);
  }
  await fs.writeFile(lock, JSON.stringify({ ...own, pid: process.pid })); await assert.rejects(lib.recover(), /still active/);
});
test("explicit identical installed adoption retains originals through edit and rename while different unmanaged files conflict", async t => {
  const { lib, installedRoot, root } = await fixture(t);
  const installed = path.join(installedRoot, "skills/adopted"); await fs.mkdir(installed, { recursive: true });
  const source = skill("adopted"); for (const f of source.files) { const target = path.join(installed, f.path); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, f.content); }
  await fs.writeFile(path.join(installed, "unrelated.md"), "unmanaged retained");
  const entry = await lib.importPath(installed); const adoption = await lib.planApply([entry.id]); assert.deepEqual(adoption.conflicts, []); assert.equal(adoption.adoptions.length, 3); assert.deepEqual(adoption.diffs, []);
  await lib.apply(adoption); const receipt = JSON.parse(await fs.readFile(path.join(root, "registry.json"), "utf8")).managed["skills/adopted/SKILL.md"];
  assert.equal(Buffer.from(receipt.original, "base64").toString("utf8"), source.files[0].content); assert.equal(receipt.originalDigest, receipt.sha256);
  let state = await lib.getState(); const edited = await lib.save(entry.id, { files: entry.files.map(f => f.path === "SKILL.md" ? { ...f, content: f.content + "Edited instructions" } : f) }, state.revision);
  await lib.apply(await lib.planApply([entry.id])); assert.match(await fs.readFile(path.join(installed, "SKILL.md"), "utf8"), /Edited instructions/);
  state = await lib.getState(); await lib.save(entry.id, { name: "renamed-adoption", files: edited.files.map(f => f.path === "SKILL.md" ? { ...f, content: f.content.replace("name: adopted", "name: renamed-adoption") } : f) }, state.revision);
  const rename = await lib.planApply([entry.id]); assert(rename.releases.includes("skills/adopted/SKILL.md")); await lib.apply(rename);
  assert.equal(await fs.readFile(path.join(installed, "SKILL.md"), "utf8"), source.files[0].content);
  assert.equal(await fs.readFile(path.join(installed, "unrelated.md"), "utf8"), "unmanaged retained");
  assert.match(await fs.readFile(path.join(installedRoot, "skills/renamed-adoption/SKILL.md"), "utf8"), /Edited instructions/);
  assert.equal(JSON.parse(await fs.readFile(path.join(root, "registry.json"), "utf8")).managed["skills/adopted/SKILL.md"], undefined);
  await fs.writeFile(path.join(installedRoot, "skills/renamed-adoption/other.md"), "different unmanaged content");
  state = await lib.getState(); const current = await lib.read(entry.id); await lib.save(entry.id, { files: [...current.files, file("other.md", "desired content")] }, state.revision);
  const conflict = await lib.planApply([entry.id]); assert.match(conflict.conflicts.join(), /External or unmanaged/); await assert.rejects(lib.apply(conflict), /conflicts/);
});
