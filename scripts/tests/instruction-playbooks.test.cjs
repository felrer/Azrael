"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { InstructionLibrary, PlaybookStore, preparePlaybook, canonicalDigest } = require("../instruction-library.cjs");
const file = (name, content) => ({ path: name, encoding: "utf8", content });
const playbook = (body = "# Review\nRead the code.\n") => ({ name: "Review", kind: "playbook", files: [file("PLAYBOOK.md", body), file("references/example.txt", "support")] });
async function fixture(t) {
  const parent = path.resolve(process.env.AZRAEL_INSTRUCTION_TEST_ROOT || os.tmpdir());
  await fs.mkdir(parent, { recursive: true });
  const base = await fs.mkdtemp(path.join(parent, "azrael-playbooks-"));
  t.after(() => fs.rm(base, { recursive: true }));
  const workspace = path.join(base, "project"), stateRoot = path.join(base, "project-state"); await fs.mkdir(workspace);
  return { base, workspace, stateRoot, lib: new InstructionLibrary({ root: path.join(base, "library"), installedRoot: path.join(base, "installed") }), store: new PlaybookStore({ stateRoot }) };
}
async function save(lib, entry, changes) { return lib.save(entry.id, changes, (await lib.getState()).revision); }
const seal = body => ({ ...body, digest: canonicalDigest(body) });

test("read-only Playbook preparation is deterministic, validates and leaves the source untouched", () => {
  const source = { ...playbook(), id: crypto.randomUUID() }, original = JSON.stringify(source);
  const prepared = preparePlaybook(source);
  assert.equal(prepared.id, source.id); assert.equal(prepared.documentVersion, "0.1.0"); assert.equal(prepared.version, 1); assert.equal(prepared.sharing, "local");
  assert.deepEqual(prepared.validationErrors, []); assert.deepEqual(preparePlaybook(source), prepared); assert.equal(JSON.stringify(source), original);
  assert.deepEqual(preparePlaybook(prepared), prepared);
  assert.throws(() => preparePlaybook({ ...source, files: [] }), /Invalid Playbook/);
  assert.throws(() => preparePlaybook({ ...source, version: 0 }), /resource version/);
});

test("Playbook metadata, patch versions, drafts and immutable readable histories", async t => {
  const { lib } = await fixture(t); const original = await lib.create(playbook());
  assert.equal(original.sharing, "local"); assert.equal(original.documentVersion, "0.1.0");
  assert.match(original.files[0].content, new RegExp(`azrael_playbook_id: ${original.id}`));
  const unchanged = await save(lib, original, { files: original.files }); assert.equal(unchanged.digest, original.digest);
  const displayed = await save(lib, original, { name: "Display name", sharing: "public" }); assert.equal(displayed.documentVersion, "0.1.0");
  const changed = await save(lib, original, { files: displayed.files.map(f => f.path === "references/example.txt" ? file(f.path, "changed support") : f) });
  assert.equal(changed.documentVersion, "0.1.1"); assert.match(changed.files[0].content, /azrael_playbook_version: 0\.1\.1/);
  const invalid = await save(lib, original, { files: [] }); assert.ok(invalid.validationErrors.length); assert.equal(invalid.documentVersion, "0.1.1");
  assert.ok(!(await lib.listVersions(original.id)).some(v => v.digest === invalid.digest));
  await assert.rejects(lib.readVersion(original.id, invalid.digest), /Invalid package version/);
  const restored = await save(lib, original, { files: changed.files }); assert.equal(restored.documentVersion, "0.1.1");
  const next = await save(lib, original, { files: playbook("# Different\n").files }); assert.equal(next.documentVersion, "0.1.2");
  assert.equal((await lib.readVersion(original.id, original.digest)).files[0].content, original.files[0].content);
  const versions = await lib.listVersions(original.id); assert.equal(versions[0].digest, next.digest);
});

test("local Playbook imports preserve document identity/version and support inventory", async t => {
  const { base, lib } = await fixture(t), source = path.join(base, "source"); await fs.mkdir(source);
  const id = crypto.randomUUID(); await fs.writeFile(path.join(source, "guide.md"), `---\nazrael_playbook_id: ${id}\nazrael_playbook_version: 2.4.9\n---\n# Imported\n`);
  const entry = await lib.importPath(source, { kind: "playbook" }); assert.equal(entry.id, id); assert.equal(entry.documentVersion, "2.4.9");
  const changed = await save(lib, entry, { files: [file("guide.md", "# Edit\n")] }); assert.equal(changed.documentVersion, "2.4.10");
  await assert.rejects(lib.importPath(source, { kind: "playbook" }), /identity already exists/);
});

test("historical installation selects exact pinned content and Playbooks activate on demand", async t => {
  const { lib, base } = await fixture(t);
  const skill = await lib.create({ name: "sample", kind: "skill", files: [file("SKILL.md", "---\nname: sample\ndescription: Example\n---\nOriginal\n")] });
  await save(lib, skill, { files: [file("SKILL.md", "---\nname: sample\ndescription: Example\n---\nLatest\n")] });
  const plan = await lib.planApply([skill.id], { digests: { [skill.id]: skill.digest } }); assert.equal(plan.entries[0].digest, skill.digest);
  await lib.apply(plan); assert.match(await fs.readFile(path.join(base, "installed/skills/sample/SKILL.md"), "utf8"), /Original/);
  const book = await lib.create(playbook());
  const profile = await lib.create({ name: "review", kind: "task-profile", profile: { model: "explicit", dependencies: [{ id: book.id, digest: book.digest }] } });
  assert.ok((await lib.resolveProfile(profile.id)).instructions.some(i => i.id === book.id && i.loading === "on-demand"));
});

test("staged acquisition previews leave the library empty and confirmation registers pinned provenance", async t => {
  const source = await fixture(t), target = await fixture(t);
  const skill = await source.lib.create({ name: "staged", kind: "skill", sharing: "public", files: [file("SKILL.md", "---\nname: staged\ndescription: Example\n---\nDownloaded\n")] });
  const provenance = { repository: "owner/catalog", version: "v1", commit: "commit" };
  const plan = await target.lib.planApply([skill.id], { resources: [skill], provenance });
  assert.deepEqual(await target.lib.list(), []); await assert.rejects(fs.stat(path.join(target.base, "library/packages")), { code: "ENOENT" });
  await target.lib.apply(plan); const installed = await target.lib.read(skill.id);
  assert.equal(installed.installedDigest, skill.digest); assert.equal(installed.publications[0].destination, provenance.repository);
  const newer = await save(source.lib, skill, { files: [file("SKILL.md", "---\nname: staged\ndescription: Example\n---\nNewer\n")] });
  const next = await target.lib.planApply([skill.id], { resources: [newer], provenance }); await target.lib.apply(next);
  assert.equal((await target.lib.read(skill.id)).digest, skill.digest); assert.equal((await target.lib.read(skill.id)).installedDigest, newer.digest);
  await assert.rejects(target.lib.planApply([skill.id], { resources: [{ ...newer, files: [] }] }), /Invalid.*staged/);
});

test("project download freezes a full support-file unit, metadata status and protected updates", async t => {
  const { lib, store, workspace } = await fixture(t); const original = await lib.create(playbook());
  assert.equal((await store.status(original, workspace)).state, "missing");
  const plan = await store.plan(original, workspace); assert.ok(Object.isFrozen(plan.resource.files)); assert.deepEqual(plan.conflicts, []);
  await store.apply(plan); assert.equal((await store.status(original, workspace)).state, "downloaded");
  assert.deepEqual(await store.readProject(original, workspace), original.files);
  const updated = await save(lib, original, { files: playbook("# Updated\n").files }); assert.equal((await store.status(updated, workspace)).state, "different");
  const main = path.join(workspace, "docs/playbooks", original.id, "PLAYBOOK.md");
  const oldText = await fs.readFile(main, "utf8"); await fs.writeFile(main, oldText + "External edit\n");
  assert.equal((await store.status(original, workspace)).state, "downloaded");
  const conflict = await store.plan(updated, workspace); assert.ok(conflict.conflicts.length); await assert.rejects(store.apply(conflict), /conflicts/);
  await fs.writeFile(main, oldText); const valid = await store.plan(updated, workspace); await store.apply(valid);
  assert.equal((await store.status(updated, workspace)).state, "downloaded");
  const preview = await store.plan(original, workspace); await fs.writeFile(main, (await fs.readFile(main, "utf8")) + "Late edit\n");
  await assert.rejects(store.apply(preview), /preview changed|external edit/); assert.match(await fs.readFile(main, "utf8"), /Late edit/);
});

test("identical unmanaged adoption needs its reviewed plan; differing and extra unmanaged files conflict", async t => {
  const { lib, store, workspace } = await fixture(t); const entry = await lib.create(playbook());
  const dest = path.join(workspace, "docs/playbooks", entry.id); await fs.mkdir(path.join(dest, "references"), { recursive: true });
  for (const f of entry.files) await fs.writeFile(path.join(dest, f.path), f.content);
  const plan = await store.plan(entry, workspace); assert.equal(plan.adoptions.length, 2); assert.equal(plan.diffs.length, 0);
  await store.apply(plan);
  await fs.writeFile(path.join(dest, "extra.txt"), "unmanaged"); assert.ok((await store.plan(entry, workspace)).conflicts.length);
  await fs.unlink(path.join(dest, "extra.txt"));
  const next = await save(lib, entry, { files: [file("PLAYBOOK.md", "# New\n")] }); const update = await store.plan(next, workspace);
  assert.ok(update.diffs.some(d => d.path === "references/example.txt" && d.content === null)); await store.apply(update);
  await assert.rejects(fs.stat(path.join(dest, "references/example.txt")), { code: "ENOENT" });
});

test("project aliases, tampered snapshots, symlinks and cross-workspace plans fail safely", async t => {
  const { lib, store, workspace, base } = await fixture(t); const entry = await lib.create(playbook());
  const plan = await store.plan(entry, workspace);
  await assert.rejects(store.apply({ ...plan, workspaceRoot: base }), /identity mismatch/);
  await assert.rejects(store.plan({ ...entry, files: [file("PLAYBOOK.md", "altered")] }, workspace), /verified Playbook/);
  const dest = path.join(workspace, "docs/playbooks", entry.id); await fs.mkdir(dest, { recursive: true }); await fs.writeFile(path.join(dest, "playbook.md"), "alias");
  const alias = await store.plan(entry, workspace); assert.ok(alias.conflicts.length); await assert.rejects(store.apply(alias), /conflicts/);
  await fs.unlink(path.join(dest, "playbook.md")); const external = path.join(base, "external"); await fs.mkdir(external);
  try { await fs.symlink(external, path.join(dest, "references"), "junction"); } catch(e) { if (["EPERM", "EACCES"].includes(e.code)) { t.diagnostic("Symlink creation unavailable"); return; } throw e; }
  await assert.rejects(store.plan(entry, workspace), /Symlink/);
});

test("interrupted project journal restores only owned writes and preserves external edits", async t => {
  const { lib, store, workspace } = await fixture(t); const entry = await lib.create(playbook()), plan = await store.plan(entry, workspace);
  const before = await store._state(workspace), after = JSON.parse(JSON.stringify(before)); after.revision++;
  after.managed[entry.id] = { digest: entry.digest, documentVersion: entry.documentVersion, files: plan.files.map(f => ({ path: f.path, digest: crypto.createHash("sha256").update(f.content).digest("hex") })) };
  const journal = seal({ schemaVersion: 1, plan, before, after }); const journalPath = store._control(workspace, "journal.json"); await fs.mkdir(path.dirname(journalPath), { recursive: true });
  const target = path.join(plan.destination, plan.diffs[0].path); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, Buffer.from(plan.diffs[0].content, "base64"));
  await fs.writeFile(journalPath, JSON.stringify(journal));
  await assert.rejects(store.apply(plan), /requires recovery/); assert.deepEqual(await store.recover(workspace), { recovered: true });
  await assert.rejects(fs.stat(target), { code: "ENOENT" });
  await fs.writeFile(target, "external"); await fs.writeFile(journalPath, JSON.stringify(journal));
  await assert.rejects(store.recover(workspace), /external edit/); assert.equal(await fs.readFile(target, "utf8"), "external"); assert.ok(await fs.stat(journalPath));
});

test("shared workspace writer lock protects active writers and distinct projects remain independent", async t => {
  const { lib, store, workspace, stateRoot, base } = await fixture(t); const entry = await lib.create(playbook());
  const lock = store._control(workspace, "writer.lock"); await fs.mkdir(path.dirname(lock), { recursive: true });
  await fs.writeFile(lock, JSON.stringify({ owner: "playbook-store", workspaceRoot: workspace, pid: process.pid }));
  const other = new PlaybookStore({ stateRoot }); await assert.rejects(other.apply(await other.plan(entry, workspace)), /writer is locked/); await assert.rejects(other.recover(workspace), /still active/);
  const second = path.join(base, "second-project"); await fs.mkdir(second); await other.apply(await other.plan(entry, second));
  assert.equal((await other.status(entry, second)).state, "downloaded");
});

test("project write failure rolls back earlier writes and keeps the original receipt", async t => {
  const { lib, store, workspace } = await fixture(t); const original = await lib.create(playbook()); await store.apply(await store.plan(original, workspace));
  const updated = await save(lib, original, { files: [file("PLAYBOOK.md", "# Updated\n"), file("references/example.txt", "new support")] });
  const plan = await store.plan(updated, workspace), rename = fs.rename; let failed = false;
  fs.rename = async (source, target) => { if (!failed && target === path.join(plan.destination, "references/example.txt")) { failed = true; throw new Error("Injected project write failure"); } return rename(source, target); };
  try { await assert.rejects(store.apply(plan), /Injected project write failure/); } finally { fs.rename = rename; }
  assert.ok(failed); assert.deepEqual(await store.readProject(original, workspace), original.files); assert.equal((await store.status(original, workspace)).state, "downloaded");
  await assert.rejects(fs.stat(store._control(workspace, "journal.json")), { code: "ENOENT" });
});
