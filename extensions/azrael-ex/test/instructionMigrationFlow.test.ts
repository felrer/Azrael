import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import Module from "node:module";
import test, { type TestContext } from "node:test";

const root = path.resolve(__dirname, path.basename(path.dirname(__dirname)) === "dist" ? "../../../.." : "../../..");
const { InstructionLibrary } = require(path.join(root, "scripts/instruction-library.cjs"));
const canonical = "---\nname: official\ndescription: Canonical fixture\n---\nCanonical instructions\n";
const legacy = "---\r\nname: official\r\ndescription: Personal legacy fixture\r\n---\r\nPreserve my original instructions: 한글.\r\n";
const support = Buffer.from("Legacy support changes\r\n", "utf8");
const binary = Buffer.from([0, 255, 17, 42]);

async function fixture(t: TestContext) {
  const parent = process.env.AZRAEL_INSTRUCTION_TEST_ROOT;
  assert.ok(parent, "Parent must assign AZRAEL_INSTRUCTION_TEST_ROOT before running fixture tests");
  await fs.mkdir(parent, { recursive: true });
  const directory = await fs.mkdtemp(path.join(parent, "instruction-migration-flow-"));
  const home = path.join(directory, "home"), project = path.join(directory, "project"), libraryRoot = path.join(directory, "library");
  const external = path.join(directory, "external-original");
  const linkedRoot = path.join(home, "skills/official"), logicalMain = path.join(linkedRoot, "SKILL.md"), externalMain = path.join(external, "SKILL.md");
  await fs.mkdir(home); await fs.mkdir(project);
  const values = new Map<string, any>(), inclusion = new Map<string, boolean>();
  const calls = { installing: [] as Array<{ path: string; enabled: boolean; linkedBefore: boolean }>, setting: [] as Array<{ path: string; enabled: boolean }> };
  const settings = {
    async list() {
      const entries: Array<{ path: string; name: string; enabled: boolean }> = [];
      for (const [filename, enabled] of inclusion) {
        try { await fs.access(filename); entries.push({ path: filename, name: "official", enabled }); }
        catch (error: any) { if (error.code !== "ENOENT") throw error; }
      }
      return entries;
    },
    async set(filename: string, enabled: boolean) {
      assert.ok(path.isAbsolute(filename)); await fs.access(filename);
      calls.setting.push({ path: filename, enabled }); inclusion.set(filename, enabled); return enabled;
    },
    async setForInstallation(filename: string, enabled: boolean) {
      assert.ok(path.isAbsolute(filename));
      let linkedBefore = false;
      try { linkedBefore = (await fs.lstat(path.dirname(filename))).isSymbolicLink(); }
      catch (error: any) { if (error.code !== "ENOENT") throw error; }
      calls.installing.push({ path: filename, enabled, linkedBefore }); inclusion.set(filename, enabled);
    },
    dispose() {},
  };
  class Publisher { async listOperations() { return []; } }
  const context: any = {
    extensionUri: { fsPath: path.join(root, "extensions/azrael-ex") }, extension: { packageJSON: { version: "0.4.0" } }, subscriptions: [],
    globalState: { get: (key: string, fallback: any) => values.get(key) ?? fallback, update: async (key: string, value: any) => { values.set(key, value); } },
  };
  const api = Module as any, original = api._load;
  api._load = function(request: string, ...args: any[]) {
    if (request === "vscode") return {
      workspace: {
        workspaceFolders: [{ name: "authoring", uri: { scheme: "file", fsPath: project } }],
        getConfiguration: () => ({ get: (key: string, fallback: any) => key === "instructions.libraryRoot" ? libraryRoot : fallback }),
      },
      window: { showInputBox: async () => { throw new Error("Unexpected migration prompt"); } },
    };
    if (request === path.join(root, "scripts/instruction-publisher.cjs")) return { InstructionPublisher: Publisher };
    return original.call(this, request, ...args);
  };
  const serviceFile = require.resolve("../src/instructionLibraryService"); delete require.cache[serviceFile];
  const { InstructionLibraryService } = require(serviceFile);
  const service = new InstructionLibraryService(context, { engine: "unused", codexHome: home, skillSettings: settings });
  const library = new InstructionLibrary({ root: libraryRoot, installedRoot: home });
  t.after(async () => {
    api._load = original; delete require.cache[serviceFile]; settings.dispose();
    const relative = path.relative(path.resolve(parent), directory);
    assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
    await fs.rm(directory, { recursive: true });
    await assert.rejects(fs.access(directory), { code: "ENOENT" });
  });
  const source = path.join(project, "instructions");
  await fs.mkdir(path.join(source, "skills/official/references"), { recursive: true });
  await fs.writeFile(path.join(source, "skills/official/SKILL.md"), canonical);
  await fs.writeFile(path.join(source, "skills/official/references/support.md"), "Canonical support\n");
  await fs.writeFile(path.join(source, "azrael-environment.json"), JSON.stringify({ instructionVersion: "1.0.0", components: [
    { id: "skill-official", kind: "skill", scope: "home", files: ["SKILL.md", "references/support.md"].map(file => ({ source: `skills/official/${file}`, target: `skills/official/${file}` })) },
  ] }));
  await service.request("librarySetSource", { sourceMode: "project", sourceProject: project });
  async function junction() {
    await fs.mkdir(path.join(home, "skills"), { recursive: true });
    await fs.mkdir(path.join(external, "references"), { recursive: true });
    await fs.writeFile(externalMain, legacy); await fs.writeFile(path.join(external, "references/support.md"), support);
    await fs.writeFile(path.join(external, "legacy.bin"), binary);
    await fs.symlink(external, linkedRoot, "junction");
    inclusion.set(await fs.realpath(externalMain), false);
  }
  return { service, library, home, directory, external, externalMain, linkedRoot, logicalMain, inclusion, calls, junction };
}

async function assertExternalUnchanged(external: string) {
  assert.equal(await fs.readFile(path.join(external, "SKILL.md"), "utf8"), legacy);
  assert.deepEqual(await fs.readFile(path.join(external, "references/support.md")), support);
  assert.deepEqual(await fs.readFile(path.join(external, "legacy.bin")), binary);
  assert.deepEqual((await fs.readdir(external)).sort(), ["SKILL.md", "legacy.bin", "references"]);
}

test("Windows junction migration preserves legacy bytes and realpath-native disabled state", { skip: process.platform !== "win32" }, async t => {
  const f = await fixture(t); await f.junction();
  let state = await f.service.snapshot();
  const original = state.entries.find((entry: any) => entry.sourceKind === "builtin")!;
  assert.equal(original.canMigrate, true); assert.equal(original.canToggleSkill, true); assert.equal(original.skillEnabled, false);
  assert.equal((await f.library.getState()).entries.length, 0);
  await f.service.request("libraryPlanMigrate", { id: original.catalogId }); state = await f.service.snapshot();
  assert.equal(state.plan!.kind, "migrate"); assert.deepEqual(state.plan!.conflicts, []);
  assert.ok(state.plan!.diffs!.some((diff: any) => diff.path === "references/support.md"));
  assert.equal((await fs.lstat(f.linkedRoot)).isSymbolicLink(), true);
  await assertExternalUnchanged(f.external);
  await f.service.request("libraryMigrate", { token: state.plan!.token });
  assert.equal((await fs.lstat(f.linkedRoot)).isSymbolicLink(), false);
  assert.equal(await fs.readFile(f.logicalMain, "utf8"), canonical);
  assert.equal(await fs.readFile(path.join(f.linkedRoot, "references/support.md"), "utf8"), "Canonical support\n");
  await assert.rejects(fs.access(path.join(f.linkedRoot, "legacy.bin")), { code: "ENOENT" });
  await assertExternalUnchanged(f.external);
  const backend = await f.library.getState(); assert.equal(backend.entries.length, 1);
  const preserved = await f.library.read(backend.entries[0].id);
  assert.equal(preserved.ownership, "personal"); assert.equal(preserved.provenance.resourceId, original.id);
  assert.equal(preserved.provenance.digest, original.digest);
  assert.match(preserved.name, /^official-legacy-[a-f0-9]{8}$/);
  assert.match(preserved.files.find((file: any) => file.path === "SKILL.md").content, new RegExp(`^name: ${preserved.name}\\r?$`, "m"));
  const raw = preserved.files.find((file: any) => /^migration-original-[a-f0-9]{8}\.md$/.test(file.path));
  assert.ok(raw); assert.deepEqual(Buffer.from(raw.content, raw.encoding), Buffer.from(legacy));
  for (const [name, bytes] of [["references/support.md", support], ["legacy.bin", binary]] as const) {
    const file = preserved.files.find((item: any) => item.path === name);
    assert.ok(file); assert.deepEqual(Buffer.from(file.content, file.encoding), bytes);
  }
  assert.deepEqual(f.calls.installing, [{ path: f.logicalMain, enabled: false, linkedBefore: true }]);
  assert.equal(f.inclusion.get(f.logicalMain), false);
  state = await f.service.snapshot();
  const migrated = state.entries.find((entry: any) => entry.catalogId === original.catalogId)!;
  assert.equal(migrated.canMigrate, false); assert.equal(migrated.skillEnabled, false); assert.equal(migrated.canToggleSkill, true);
  assert.equal(state.plan, undefined);
});

test("Windows junction migration rejects an inclusion change after review without touching either source", { skip: process.platform !== "win32" }, async t => {
  const f = await fixture(t); await f.junction();
  const original = (await f.service.snapshot()).entries.find((entry: any) => entry.sourceKind === "builtin")!;
  await f.service.request("libraryPlanMigrate", { id: original.catalogId });
  const token = (await f.service.snapshot()).plan!.token;
  f.inclusion.set(await fs.realpath(f.externalMain), true);
  await assert.rejects(f.service.request("libraryMigrate", { token }), /inclusion changed.*review migration/i);
  assert.equal((await fs.lstat(f.linkedRoot)).isSymbolicLink(), true);
  assert.equal(await fs.realpath(f.logicalMain), await fs.realpath(f.externalMain));
  assert.equal((await f.library.getState()).entries.length, 0);
  assert.deepEqual(f.calls.installing, []);
  await assertExternalUnchanged(f.external);
});

test("default source deletion leaves installed provenance and publication receipts browseable", async t => {
  const f = await fixture(t);
  const provenance = { sourceKind: "builtin", repository: "fixture/source", resourceId: "11111111-1111-5111-8111-111111111111", digest: "a".repeat(64), versionLabel: "1.0.0" };
  const entry = await f.library.create({ name: "retained-personal", kind: "skill", sharing: "public", provenance, files: [
    { path: "SKILL.md", encoding: "utf8", content: "---\nname: retained-personal\ndescription: Retained installed version\n---\nKeep this installation.\n" },
  ] });
  await f.library.apply(await f.library.planApply([entry.id]));
  const publication = await f.library.planPublish([entry.id], "public");
  await f.library.recordPublication(publication, { destination: "fixture/publication", version: "2.0.0", commit: "b".repeat(40) });
  await f.service.snapshot(); await f.service.request("libraryPlanDelete", { id: entry.id });
  await f.service.request("libraryDelete", { token: (await f.service.snapshot()).plan!.token });
  const backend = await f.library.getState(), detached = backend.detachedEntries.find((item: any) => item.id === entry.id);
  assert.equal(detached.sourceDeleted, true); assert.equal(detached.installedDigest, entry.digest);
  assert.deepEqual(detached.provenance, provenance);
  assert.equal(backend.managed["skills/retained-personal/SKILL.md"].id, entry.id);
  const installed = (await f.service.snapshot()).entries.find((item: any) => item.sourceKind === "installed" && item.name === "retained-personal")!;
  assert.ok(installed); assert.equal(installed.readOnly, true); assert.deepEqual(installed.provenance, provenance);
  assert.equal(installed.publications[0].repository, "fixture/publication"); assert.equal(installed.publications[0].digest, entry.digest);
  await f.service.request("librarySelect", { id: installed.catalogId });
  assert.equal((await f.service.snapshot()).selected!.files![0].content, entry.files[0].content);
  await assert.rejects(f.service.request("libraryPlanDelete", { id: installed.catalogId }), /personal authoring resource/i);
});
