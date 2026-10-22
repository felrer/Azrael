import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import Module from "node:module";
import test, { type TestContext } from "node:test";

const root = path.resolve(__dirname, path.basename(path.dirname(__dirname)) === "dist" ? "../../../.." : "../../..");
const libraryFile = path.join(root, "scripts/instruction-library.cjs");
const { InstructionLibrary } = require(libraryFile);
const skill = (text = "Original") => [{ path: "SKILL.md", encoding: "utf8", content: `---\nname: catalog-review\ndescription: Catalog fixture\n---\n${text}\n` }];

async function fixture(t: TestContext) {
  const parent = process.env.AZRAEL_INSTRUCTION_TEST_ROOT || path.join(root, "artifacts/verification");
  await fs.mkdir(parent, { recursive: true }); const directory = await fs.mkdtemp(path.join(parent, "catalog-flow-"));
  const home = path.join(directory, "home"), libraryRoot = path.join(directory, "library"), project = path.join(directory, "project");
  await fs.mkdir(home); await fs.mkdir(project);
  const values = new Map<string, any>(), calls = { metadata: 0, downloads: 0, auth: 0 };
  const releases = new Map<string, any>();
  const skillStates = new Map<string, boolean>();
  const skillSettings = {
    async list() {
      const installed = [];
      for (const [filename, enabled] of skillStates) {
        try { await fs.access(filename); installed.push({ path: filename, enabled, name: path.basename(path.dirname(filename)) }); }
        catch (error: any) { if (error.code !== "ENOENT") throw error; }
      }
      return installed;
    },
    async set(filename: string, enabled: boolean) { await fs.access(filename); skillStates.set(filename, enabled); return enabled; },
    async setForInstallation(filename: string, enabled: boolean) { assert.ok(path.isAbsolute(filename)); skillStates.set(filename, enabled); },
    dispose() {},
  };
  class Publisher {
    async listOperations() { return []; }
    async checkConnection() { calls.auth++; return { readable: true, writable: true }; }
    async listReleases() { return [...releases.keys()].sort().reverse().map(version => ({ version })); }
    async describeRelease(_: any, version: string) { calls.metadata++; return releases.get(version); }
    async download(_: any, version: string) { calls.downloads++; return releases.get(version); }
  }
  const context: any = { extensionUri: { fsPath: path.join(root, "extensions/azrael-ex") }, extension: { packageJSON: { version: "0.4.0" } },
    globalState: { get: (key: string, fallback: any) => values.get(key) ?? fallback, update: async (key: string, value: any) => { values.set(key, value); } } };
  const api = Module as any, original = api._load;
  const folders = [{ name: "fixture-project", uri: { scheme: "file", fsPath: project } }];
  api._load = function(request: string, ...args: any[]) {
    if (request === "vscode") return { workspace: { workspaceFolders: folders, getConfiguration: () => ({ get: (key: string, fallback: any) => key === "instructions.libraryRoot" ? libraryRoot : fallback }) } };
    if (request === path.join(root, "scripts/instruction-publisher.cjs")) return { InstructionPublisher: Publisher };
    return original.call(this, request, ...args);
  };
  const serviceFile = require.resolve("../src/instructionLibraryService"); delete require.cache[serviceFile];
  const { InstructionLibraryService } = require(serviceFile);
  const createService = () => new InstructionLibraryService(context, { engine: "unused", codexHome: home, skillSettings });
  const library = new InstructionLibrary({ root: libraryRoot, installedRoot: home }), service = createService();
  t.after(async () => { api._load = original; delete require.cache[serviceFile]; const relative = path.relative(parent, directory); assert(relative && !relative.startsWith("..") && !path.isAbsolute(relative)); await fs.rm(directory, { recursive: true }); await assert.rejects(fs.access(directory), { code: "ENOENT" }); });
  return { service, library, createService, home, libraryRoot, directory, project, values, calls, releases, folders, skillStates };
}

test("Playbook history compares in place, preview does not install, project edits stay protected", async t => {
  const f = await fixture(t);
  await f.service.request("libraryCreate", { name: "로깅 지침", kind: "playbook", files: [{ path: "PLAYBOOK.md", encoding: "utf8", content: "# Logging\nOriginal\n" }] });
  let state = await f.service.snapshot(), initial = state.selected!;
  assert.equal(initial.sharing, "local"); assert.equal(initial.documentVersion, "0.1.0");
  await f.service.request("librarySave", { id: initial.id, revision: state.revision, files: initial.files!.map((file: any) => ({ ...file, content: file.content + "Additional guidance\n" })) });
  state = await f.service.snapshot(); const newer = state.selected!;
  assert.equal(newer.documentVersion, "0.1.1"); assert.equal(newer.projectStatus!.state, "missing");
  await f.service.request("libraryCompare", { id: initial.id, fromDigest: initial.digest, toDigest: newer.digest });
  state = await f.service.snapshot(); assert(state.comparison!.files[0].proposed!.includes("Additional guidance"));
  await assert.rejects(fs.access(path.join(f.project, "docs/playbooks")), { code: "ENOENT" });
  await f.service.request("libraryPlanAcquire", { id: initial.id, digest: initial.digest });
  state = await f.service.snapshot(); assert(state.plan!.acquire); assert.equal((await f.library.read(initial.id)).digest, newer.digest);
  await f.service.request("libraryAcquire", { token: state.plan!.token });
  state = await f.service.snapshot(); assert.equal(state.selected!.projectStatus!.state, "different");
  const target = path.join(f.project, "docs/playbooks", initial.id, "PLAYBOOK.md");
  assert((await fs.readFile(target, "utf8")).includes("azrael_playbook_version: 0.1.0"));
  await fs.appendFile(target, "Project-only changes\n");
  await f.service.request("libraryCompare", { id: initial.id, fromDigest: "@installed", toDigest: newer.digest });
  state = await f.service.snapshot(); assert(state.comparison!.files[0].current!.includes("Project-only changes"));
  await f.service.request("libraryPlanAcquire", { id: initial.id, digest: newer.digest }); state = await f.service.snapshot();
  assert(state.plan!.conflicts.length); await assert.rejects(f.service.request("libraryAcquire", { token: state.plan!.token }), /conflict/i);
  assert((await fs.readFile(target, "utf8")).includes("Project-only changes"));
});

test("installed skill preview is read-only and reviewed acquisition registers only on confirmation", async t => {
  const f = await fixture(t), target = path.join(f.home, "skills/catalog-review");
  await fs.mkdir(target, { recursive: true }); await fs.writeFile(path.join(target, "SKILL.md"), skill()[0].content);
  let state = await f.service.snapshot(); const candidate = state.entries.find((entry: any) => entry.sourceKind === "installed" && entry.name === "catalog-review")!;
  assert(candidate.readOnly); assert.equal((await f.library.getState()).entries.length, 0);
  await f.service.request("librarySelect", { id: candidate.catalogId }); state = await f.service.snapshot(); assert(state.selected!.files![0].content.includes("Original"));
  await f.service.request("libraryPlanAcquire", { id: candidate.catalogId }); state = await f.service.snapshot();
  assert.equal((await f.library.getState()).entries.length, 0); assert.equal(state.plan!.conflicts.length, 0);
  await f.service.request("libraryAcquire", { token: state.plan!.token });
  const stored = await f.library.read(candidate.id); assert.equal(stored.installedDigest, candidate.digest);
  assert.equal(await fs.readFile(path.join(target, "SKILL.md"), "utf8"), skill()[0].content);
});

test("remote metadata lists without acquiring, verified previews persist offline, and historical versions install exactly", async t => {
  const f = await fixture(t), source = new InstructionLibrary({ root: path.join(f.directory, "source"), installedRoot: path.join(f.directory, "source-home") });
  const first = await source.create({ name: "catalog-review", kind: "skill", sharing: "public", files: skill("First") });
  const second = await source.save(first.id, { files: skill("Second") }, (await source.getState()).revision);
  for (const [version, resource] of [["0.1.0", first], ["0.2.0", second]] as const) f.releases.set(version, { manifest: { sourceCommit: "a".repeat(40) }, packages: [{ ...resource, current: true }] });
  f.values.set(`azrael.instructionConnections.v1:${f.libraryRoot}`, [{ sharing: "public", repository: "fixture/catalog", branch: "main" }]);
  await f.service.snapshot(); await f.service.request("libraryRemoteRefresh", { sharing: "public" });
  let state = await f.service.snapshot(); const remote = state.entries.find((entry: any) => entry.sourceKind === "remote")!;
  assert.equal(f.calls.downloads, 0); assert.equal((await f.library.getState()).entries.length, 0); assert.equal(remote.versions!.length, 2);
  await f.service.request("librarySelect", { id: remote.catalogId }); state = await f.service.snapshot(); assert(state.selected!.files![0].content.includes("Second"));
  await f.service.request("libraryCompare", { id: remote.catalogId, fromDigest: first.digest, toDigest: second.digest });
  state = await f.service.snapshot(); assert(state.comparison!.files[0].current!.includes("First"));
  const downloads = f.calls.downloads, auth = f.calls.auth, reopened = f.createService();
  await reopened.snapshot(); await reopened.request("librarySelect", { id: remote.catalogId }); state = await reopened.snapshot();
  assert(state.selected!.files![0].content.includes("Second")); assert.equal(f.calls.downloads, downloads); assert.equal(f.calls.auth, auth);
  await reopened.request("libraryPlanAcquire", { id: remote.catalogId, digest: first.digest }); state = await reopened.snapshot();
  assert.equal((await f.library.getState()).entries.length, 0);
  await reopened.request("libraryAcquire", { token: state.plan!.token });
  assert.equal((await f.library.read(first.id)).installedDigest, first.digest);
  assert.ok(f.skillStates.has(path.join(f.home, "skills/catalog-review/SKILL.md")));
  assert((await fs.readFile(path.join(f.home, "skills/catalog-review/SKILL.md"), "utf8")).includes("First"));
});
