import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import Module from "node:module";
import test, { type TestContext } from "node:test";

const root = path.resolve(__dirname, path.basename(path.dirname(__dirname)) === "dist" ? "../../../.." : "../../..");
const { InstructionLibrary } = require(path.join(root, "scripts/instruction-library.cjs"));
const skill = (name = "official", text = "Original") => [
  { path: "SKILL.md", encoding: "utf8", content: `---\nname: ${name}\ndescription: Management fixture\n---\n${text}\n` },
  { path: "references/support.md", encoding: "utf8", content: "Complete support material\n" },
];

async function fixture(t: TestContext, configuredLibrary = true) {
  const parent = process.env.AZRAEL_INSTRUCTION_TEST_ROOT;
  assert.ok(parent, "Parent must assign AZRAEL_INSTRUCTION_TEST_ROOT before running fixture tests");
  await fs.mkdir(parent, { recursive: true });
  const directory = await fs.mkdtemp(path.join(parent, "instruction-management-"));
  const home = path.join(directory, "home"), project = path.join(directory, "project");
  const libraryRoot = configuredLibrary ? path.join(directory, "library") : `${home}-instruction-library`;
  await fs.mkdir(home); await fs.mkdir(project);
  const values = new Map<string, any>();
  const calls = { checked: [] as string[], refresh: [] as string[], published: [] as string[], settings: [] as Array<{ path: string; enabled: boolean; installing: boolean }>, commands: [] as string[] };
  const releases = new Map<string, any>();
  const inclusion = new Map<string, boolean>();
  const settings = {
    async list() {
      const result: Array<{ path: string; name: string; enabled: boolean }> = [];
      for (const [filename, enabled] of inclusion) {
        try { await fs.access(filename); result.push({ path: filename, name: path.basename(path.dirname(filename)), enabled }); }
        catch (error: any) { if (error.code !== "ENOENT") throw error; }
      }
      return result;
    },
    async set(filename: string, enabled: boolean) {
      assert.ok(path.isAbsolute(filename)); await fs.access(filename);
      calls.settings.push({ path: filename, enabled, installing: false }); inclusion.set(filename, enabled); return enabled;
    },
    async setForInstallation(filename: string, enabled: boolean) {
      assert.ok(path.isAbsolute(filename));
      calls.settings.push({ path: filename, enabled, installing: true }); inclusion.set(filename, enabled);
    },
    dispose() {},
  };
  class Publisher {
    async listOperations() { return []; }
    async checkConnection(connection: any) { calls.checked.push(connection.repository); return { readable: true, writable: true }; }
    async listReleases(connection: any) { calls.refresh.push(connection.repository); return releases.has(connection.repository) ? [{ version: "1.0.0" }] : []; }
    async describeRelease(connection: any) { return releases.get(connection.repository); }
    async download(connection: any) { return releases.get(connection.repository); }
    async publish(_: any, connection: any, options: any) {
      calls.published.push(connection.repository);
      return { operationId: "fixture-publication", repository: connection.repository, version: options.version, commit: "a".repeat(40), phase: "published" };
    }
  }
  const folders = [{ name: "authoring", uri: { scheme: "file", fsPath: project } }];
  const context: any = {
    extensionUri: { fsPath: path.join(root, "extensions/azrael-ex") }, extension: { packageJSON: { version: "0.4.0" } }, subscriptions: [],
    globalState: { get: (key: string, fallback: any) => values.get(key) ?? fallback, update: async (key: string, value: any) => { values.set(key, value); } },
    secrets: { get: async () => "fixture-token" },
  };
  const api = Module as any, original = api._load;
  api._load = function(request: string, ...args: any[]) {
    if (request === "vscode") return {
      workspace: { workspaceFolders: folders, getConfiguration: () => ({ get: (key: string, fallback: any) => key === "instructions.libraryRoot" && configuredLibrary ? libraryRoot : fallback }) },
      authentication: { getSession: async () => ({ accessToken: "fixture-token" }) },
      window: { showInputBox: async () => { throw new Error("Unexpected interactive prompt"); } },
      commands: { executeCommand: async (name: string) => { calls.commands.push(name); } },
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
  async function official() {
    const source = path.join(project, "instructions");
    for (const file of skill()) {
      const target = path.join(source, "skills/official", file.path);
      await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, file.content);
    }
    await fs.writeFile(path.join(source, "azrael-environment.json"), JSON.stringify({ instructionVersion: "1.0.0", components: [
      { id: "skill-official", kind: "skill", scope: "home", files: skill().map(file => ({ source: `skills/official/${file.path}`, target: `skills/official/${file.path}` })) },
    ] }));
  }
  return { service, library, home, project, libraryRoot, directory, values, calls, releases, inclusion, official };
}

test("release is default despite an open authoring workspace; project source requires explicit valid selection", async t => {
  const f = await fixture(t, false);
  let state = await f.service.snapshot();
  assert.equal(state.sourceMode, "release"); assert.equal(state.entries.some((entry: any) => entry.sourceKind === "builtin"), false);
  await assert.rejects(f.service.request("librarySetSource", { sourceMode: "project", sourceProject: f.project }), /authoring project/i);
  await f.official();
  state = await f.service.snapshot();
  assert.equal(state.entries.some((entry: any) => entry.sourceKind === "builtin"), false);
  await f.service.request("librarySetSource", { sourceMode: "project", sourceProject: f.project });
  state = await f.service.snapshot();
  assert.equal(state.sourceMode, "project"); assert.equal(state.sourceProject, f.project);
  assert.ok(state.entries.some((entry: any) => entry.sourceKind === "builtin" && entry.name === "official"));
  await f.service.request("libraryCreate", { name: "local", kind: "skill", sharing: "local", files: skill("local") });
  assert.equal((await f.library.getState()).entries.length, 1);
  await fs.access(f.libraryRoot);
  await f.service.request("librarySetSource", { sourceMode: "release" });
  assert.equal((await f.service.snapshot()).entries.some((entry: any) => entry.sourceKind === "builtin"), false);
});

test("same-sharing repository connections refresh and publish independently; ambiguity rejects", async t => {
  const f = await fixture(t);
  const resource = await f.library.create({ name: "publishable", kind: "skill", sharing: "public", files: skill("publishable") });
  for (const repository of ["fixture/one", "fixture/two"]) {
    f.releases.set(repository, { manifest: { repository, sourceCommit: "a".repeat(40) }, packages: [{ ...resource, current: true }] });
    await f.service.request("libraryConnect", { sharing: "public", repository });
  }
  await f.service.snapshot();
  await assert.rejects(f.service.request("libraryRemoteRefresh", { sharing: "public" }), /exactly one/i);
  for (const repository of ["fixture/one", "fixture/two"]) await f.service.request("libraryRemoteRefresh", { sharing: "public", repository });
  let state = await f.service.snapshot();
  assert.equal(state.connections.length, 2);
  assert.deepEqual(new Set(state.entries.filter((entry: any) => entry.sourceKind === "remote").map((entry: any) => entry.sourceLabel)), new Set(["fixture/one", "fixture/two"]));
  assert.deepEqual(f.calls.refresh, ["fixture/one", "fixture/two"]);
  await assert.rejects(f.service.request("libraryPlanPublish", { id: resource.id, sharing: "public", version: "1.0.0" }), /exactly one/i);
  await f.service.request("libraryPlanPublish", { id: resource.id, sharing: "public", repository: "fixture/two", version: "1.0.0" });
  state = await f.service.snapshot(); assert.match(state.plan!.summary.en, /fixture\/two/);
  await f.service.request("libraryPublish", { token: state.plan!.token });
  assert.deepEqual(f.calls.published, ["fixture/two"]);
});

test("personal derivative has separate identity, provenance, disabled first install and path-only inclusion", async t => {
  const f = await fixture(t);
  await f.official();
  const originalPath = path.join(f.home, "skills/official/SKILL.md");
  await fs.mkdir(path.dirname(originalPath), { recursive: true }); await fs.writeFile(originalPath, skill()[0].content);
  f.inclusion.set(originalPath, true);
  await f.service.request("librarySetSource", { sourceMode: "project", sourceProject: f.project });
  let state = await f.service.snapshot(); const original = state.entries.find((entry: any) => entry.sourceKind === "builtin")!;
  await f.service.request("libraryImport", { id: original.catalogId, installationName: "official-personal" });
  state = await f.service.snapshot(); const personal = state.selected!;
  assert.notEqual(personal.id, original.id); assert.equal(personal.name, "official-personal");
  assert.equal(personal.provenance!.resourceId, original.id); assert.equal(personal.provenance!.digest, original.digest);
  assert.equal(personal.provenance!.repository, "felrer/azrael");
  assert.match(personal.files!.find((file: any) => file.path === "SKILL.md")!.content, /^name: official-personal$/m);
  assert.ok(personal.files!.some((file: any) => file.path === "references/support.md"));
  await f.service.request("libraryPlanApply", { id: personal.id }); state = await f.service.snapshot();
  await f.service.request("libraryApply", { token: state.plan!.token });
  const personalPath = path.join(f.home, "skills/official-personal/SKILL.md");
  assert.deepEqual(f.calls.settings, [{ path: personalPath, enabled: false, installing: true }]);
  state = await f.service.snapshot();
  const installed = state.entries.find((entry: any) => entry.id === personal.id)!;
  assert.equal(installed.canToggleSkill, true); assert.equal(installed.skillEnabled, false);
  assert.equal(state.entries.find((entry: any) => entry.catalogId === original.catalogId)!.skillEnabled, true);
  await f.service.request("librarySetSkillEnabled", { id: personal.id, enabled: true });
  assert.deepEqual(f.calls.settings.at(-1), { path: personalPath, enabled: true, installing: false });
  assert.equal(f.inclusion.get(originalPath), true);
  assert.equal(await fs.readFile(originalPath, "utf8"), skill()[0].content);
  const refreshed = await f.service.snapshot();
  assert.equal(refreshed.entries.find((entry: any) => entry.catalogId === original.catalogId)!.digest, original.digest);
});

test("source deletion keeps installed ownership and rejects stale tokens and read-only originals", async t => {
  const f = await fixture(t);
  const entry = await f.library.create({ name: "delete-personal", kind: "skill", sharing: "local", files: skill("delete-personal") });
  await f.service.request("libraryPlanApply", { id: entry.id });
  await f.service.request("libraryApply", { token: (await f.service.snapshot()).plan!.token });
  await f.service.snapshot();
  await f.service.request("libraryPlanDelete", { id: entry.id }); const old = (await f.service.snapshot()).plan!.token;
  await f.service.request("libraryPlanDelete", { id: entry.id }); let state = await f.service.snapshot();
  await assert.rejects(f.service.request("libraryDelete", { token: old }), /fresh operation plan/i);
  await f.library.save(entry.id, { files: skill("delete-personal", "Concurrent edit") }, (await f.library.getState()).revision);
  await assert.rejects(f.service.request("libraryDelete", { token: state.plan!.token }), /changed|stale|revision/i);
  await f.service.snapshot(); await f.service.request("libraryPlanDelete", { id: entry.id }); state = await f.service.snapshot();
  await f.service.request("libraryDelete", { token: state.plan!.token });
  const backend = await f.library.getState();
  assert.equal(backend.detachedEntries[0].id, entry.id); assert.equal(backend.detachedEntries[0].installedDigest, entry.digest);
  assert.equal(backend.managed["skills/delete-personal/SKILL.md"].id, entry.id);
  assert.equal(await fs.readFile(path.join(f.home, "skills/delete-personal/SKILL.md"), "utf8"), skill("delete-personal")[0].content);
  await f.official(); await f.service.request("librarySetSource", { sourceMode: "project", sourceProject: f.project });
  const original = (await f.service.snapshot()).entries.find((resource: any) => resource.sourceKind === "builtin")!;
  await assert.rejects(f.service.request("libraryPlanDelete", { id: original.catalogId }), /personal authoring resource/i);
});

test("required excluded skills block task-profile preparation", async t => {
  const f = await fixture(t);
  const dependency = await f.library.create({ name: "required", kind: "skill", sharing: "local", files: skill("required") });
  await f.library.apply(await f.library.planApply([dependency.id]));
  const installedPath = path.join(f.home, "skills/required/SKILL.md"); f.inclusion.set(installedPath, false);
  const profile = await f.library.create({ name: "review", kind: "task-profile", sharing: "local", profile: { model: "fixture-model", dependencies: [{ id: dependency.id, digest: dependency.digest }] } });
  await f.service.snapshot();
  await assert.rejects(f.service.request("libraryPrepareTask", { id: profile.id }), /requires an excluded skill/i);
  f.inclusion.set(installedPath, true);
  await f.service.request("libraryPrepareTask", { id: profile.id });
  const token = (await f.service.snapshot()).plan!.token;
  f.inclusion.set(installedPath, false);
  await assert.rejects(f.service.request("libraryStartTask", { token }), /requires an excluded skill/i);
  assert.deepEqual(f.calls.commands, []); assert.equal(f.inclusion.get(installedPath), false);
});
