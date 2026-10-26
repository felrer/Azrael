import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import Module from "node:module";
import test, { after, type TestContext } from "node:test";
import type { InstructionAction, InstructionRequest, InstructionUiState, InstructionUiText } from "../src/instructionProtocol";

const uiText = (value: InstructionUiText | readonly InstructionUiText[] | undefined, locale: "en" | "ko" = "ko"): string =>
  Array.isArray(value) ? value.map(entry => uiText(entry, locale)).join(" ") : typeof value === "string" ? value : value ? (value as { en: string; ko: string })[locale] : "";

const root = path.resolve(__dirname, path.basename(path.dirname(__dirname)) === "dist" ? "../../../.." : "../../..");
const backendFile = path.join(root, "scripts/instruction-package.cjs");
const { InstructionStore } = require(backendFile);

const { createCurrentInstructionRelease } = require(path.join(root, "scripts/current-instruction-test-release.cjs"));
let currentRelease: Promise<{ directory: string; assets: Map<string, Buffer>; manifest: any; version: string; appVersion: string }> | undefined;

async function releaseFixture() {
  const parent = process.env.AZRAEL_INSTRUCTION_TEST_ROOT;
  assert(parent && path.isAbsolute(parent), "AZRAEL_INSTRUCTION_TEST_ROOT must be an explicit absolute owned parent");
  await fs.mkdir(parent, { recursive: true });
  return currentRelease ??= createCurrentInstructionRelease({ projectRoot: root, parent });
}

after(async () => {
  if (!currentRelease) return;
  // The helper removes incomplete output itself if preparation fails.
  const prepared = await currentRelease.catch(() => undefined);
  if (!prepared) return;
  const parent = process.env.AZRAEL_INSTRUCTION_TEST_ROOT!;
  const relative = path.relative(parent, prepared.directory);
  assert(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
  const stat = await fs.lstat(prepared.directory);
  assert(stat.isDirectory() && !stat.isSymbolicLink());
  await fs.rm(prepared.directory, { recursive: true });
  await assert.rejects(fs.access(prepared.directory), { code: "ENOENT" });
});

async function fixture(t: TestContext) {
  const { directory: assetRoot, assets, manifest, version, appVersion } = await releaseFixture();
  const tag = `instructions-v${version}`;
  const release = { tag_name: tag, draft: false, prerelease: false, body: "Generated release notes", assets: [...assets.keys()].map(name => ({ name, browser_download_url: `https://github.com/${manifest.repository}/releases/download/${tag}/${name}` })) };
  const verification = process.env.AZRAEL_INSTRUCTION_TEST_ROOT!;
  await fs.mkdir(verification, { recursive: true });
  const dir = await fs.mkdtemp(path.join(verification, "instruction-service-"));
  t.after(async () => {
    const relative = path.relative(verification, dir);
    assert(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
    const stat = await fs.lstat(dir);
    assert(stat.isDirectory() && !stat.isSymbolicLink());
    await fs.rm(dir, { recursive: true });
    await assert.rejects(fs.access(dir), { code: "ENOENT" });
  });
  const home = path.join(dir, "home"), workspace = path.join(dir, "workspace");
  await fs.mkdir(home); await fs.mkdir(workspace);
  const engine = process.env.AZRAEL_INSTRUCTION_TEST_ENGINE ?? path.join(
    JSON.parse(await fs.readFile(path.join(root, "artifacts/latest.json"), "utf8")).releaseDirectory,
    "engine", process.platform === "win32" ? "codex.exe" : "codex");
  assert(path.isAbsolute(engine), "Instruction fixture engine must be explicitly absolute");
  await fs.access(engine);
  const control: { repository: string; workspace: string; failure?: string; gate?: Promise<void> } = { repository: manifest.repository, workspace };
  const warnings: string[] = [], requests: string[] = [], options: any[] = [];
  const transport = async (url: string) => {
    requests.push(url);
    if (control.gate) await control.gate;
    if (control.failure) throw new Error(control.failure);
    if (url.startsWith(`https://api.github.com/repos/${manifest.repository}/releases?`)) return Buffer.from(JSON.stringify([release]));
    if (url === `https://api.github.com/repos/${manifest.repository}/releases/tags/${tag}`) return Buffer.from(JSON.stringify(release));
    const name = url.slice(url.lastIndexOf("/") + 1);
    const bytes = assets.get(name);
    if (bytes && release.assets.some(asset => asset.browser_download_url === url)) return bytes;
    throw new Error(`Unexpected offline release URL: ${url}`);
  };
  const api = Module as unknown as { _load(request: string, parent: unknown, isMain: boolean): unknown };
  const original = api._load;
  api._load = function (request, parent, isMain) {
    // Native catalog transport has its own adapter tests. These release tests use
    // the real engine only for strict staged configuration validation.
    if (request === "./instructionSkillSettings") return { InstructionSkillSettings: class {
      async list() { return []; }
      async set(_path: string, enabled: boolean) { return enabled; }
      async setForInstallation() {}
      dispose() {}
    } };
    if (request === "vscode") return { workspace: { get workspaceFolders() { return [{ uri: { scheme: "file", fsPath: control.workspace } }]; }, getConfiguration: () => ({ get: (key: string, fallback: unknown) => key === "instructions.repository" ? control.repository : fallback }) } };
    if (request === backendFile) return { InstructionStore: class extends InstructionStore {
      constructor(input: any) { super({ ...input, request: transport }); options.push(input); }
    } };
    return original.call(this, request, parent, isMain);
  };
  const serviceFile = require.resolve("../src/instructionService");
  delete require.cache[serviceFile];
  const { InstructionService } = require(serviceFile) as typeof import("../src/instructionService");
  const { InstructionView } = require("../src/instructionView") as typeof import("../src/instructionView");
  const createService = () => new InstructionService({ extensionUri: { fsPath: path.join(root, "extensions/azrael-ex") }, extension: { packageJSON: { version: appVersion } } } as any, { codexHome: home, engine }, { warn: (message: string) => warnings.push(message) } as any);
  const service = createService();
  // The dynamic backend require happens on each first snapshot, so retain this boundary until teardown.
  t.after(() => { api._load = original; delete require.cache[serviceFile]; });
  t.diagnostic(`Generated assets: ${assetRoot}; native validator: ${engine}; isolated CODEX_HOME only`);
  return { service, createService, InstructionView, control, warnings, options, requests, manifest, version, appVersion, home, workspace, engine };
}

test("real host adapter maps generated release, preview, download and selected application through the view", async t => {
  const f = await fixture(t);
  const sent: any[] = [];
  const view = new f.InstructionView(f.service);
  t.after(() => view.dispose());
  const webview = { postMessage: async (message: unknown) => { sent.push(message); return true; } } as any;
  let id = 0;
  const dispatch = async (action: InstructionAction | "mount", message: InstructionRequest = {}) => {
    await view.handleEmbedded(webview, { type: "azrael-instructions", clientId: "real-service", requestId: String(++id), action, message });
    assert.equal(sent.at(-1).clientId, "real-service");
    assert.equal(sent.at(-1).requestId, String(id));
    return f.service.snapshot();
  };
  let state = await dispatch("mount");
  assert.equal(state.repository, f.manifest.repository); assert.equal(state.currentVersion, null);
  assert.deepEqual(state.downloadedVersions, []); assert.deepEqual(state.conflicts, []);
  state = await dispatch("refresh");
  assert.match(sent.at(-1).html, /Available instruction versions have been checked\./);
  assert.equal(state.selectedVersion, f.version); assert.equal(state.versions[0].notes, "Generated release notes");
  assert.equal(state.versions[0].compatible, true); assert.equal(state.versions[0].prerelease, false);
  assert.deepEqual(state.components, f.manifest.components);
  assert.equal(state.documents.length, f.manifest.documents.length);
  assert(state.documents.every(document => document.title && document.kind));
  const document = state.documents[0];
  state = await dispatch("preview", { path: document.path });
  assert.equal(state.preview?.path, document.path); assert(state.preview?.text.length);
  assert(sent.at(-1).html.includes("Generated release notes"));
  state = await dispatch("selectVersion", { version: f.version }); assert.equal(state.preview, undefined);
  state = await dispatch("download", { version: f.version });
  assert.deepEqual(state.downloadedVersions, [f.version]); assert.equal(state.currentVersion, null);
  const ids = ["global-instructions"];
  state = await dispatch("apply", { version: f.version, componentIds: ids });
  assert.equal(state.currentVersion, f.version, JSON.stringify({ error: state.error, warnings: f.warnings })); assert.deepEqual(state.selectedComponentIds, ids);
  assert.equal(state.error, undefined); assert.deepEqual(state.conflicts, []);
  assert((await fs.readFile(path.join(f.home, "AGENTS.md"), "utf8")).length);
  await assert.rejects(fs.access(path.join(f.home, "agents/luna_explorer.toml")), { code: "ENOENT" });
  assert.deepEqual(f.options[0], { stateRoot: f.home, appVersion: f.appVersion, repository: f.manifest.repository, engine: f.engine, workspaceRoot: f.workspace });
  assert.equal(f.warnings.length, 0);
});

test("invalid repository and retryable backend failures return error state without changing data", async t => {
  const f = await fixture(t);
  f.control.repository = "invalid repository";
  const invalid = await f.service.snapshot(); assert.match(uiText(invalid.error), /owner\/name/);
  assert.match(uiText((await f.service.request("refresh", {})).error), /owner\/name/);
  assert.equal(uiText(invalid.error, "en"), "Set the GitHub repository in owner/name format.");
  assert.equal(f.options.length, 0); assert.equal(f.requests.length, 0);
  f.control.repository = f.manifest.repository;
  f.control.failure = "offline fixture";
  assert.equal((await f.service.request("refresh", {})).error, "offline fixture");
  f.control.failure = undefined;
  assert.equal((await f.service.request("refresh", {})).error, undefined);
  assert.match(uiText((await f.service.request("preview", { path: "missing" })).error), /문서/);
  assert.match(uiText((await f.service.request("selectVersion", { version: "../bad" })).error), /버전/);
  assert.equal((await f.service.snapshot()).currentVersion, null);
  await assert.rejects(fs.access(path.join(f.home, "AGENTS.md")), { code: "ENOENT" });
});

test("changing workspace maps its own selection and preserves retained workspace files and notices", async t => {
  const f = await fixture(t);
  const downloaded = await f.service.request("download", { version: f.version });
  assert.equal(downloaded.error, undefined, `Prerequisite download failed: ${uiText(downloaded.error, "en")}; ${f.warnings.join("; ")}`);
  assert.equal(downloaded.selectedVersion, f.version);
  const workspaceComponent = f.manifest.components.find((component: any) => component.scope === "workspace" && component.files?.length);
  assert(workspaceComponent, "Current release must include a mapped workspace component");
  const workspaceTarget = workspaceComponent.files[0].target;
  const ids = ["global-instructions", workspaceComponent.id];
  const applied = await f.service.request("apply", { componentIds: ids });
  assert.equal(applied.error, undefined); assert.deepEqual(applied.selectedComponentIds, ids);
  const target = path.join(f.workspace, workspaceTarget), original = await fs.readFile(target);
  const secondWorkspace = path.join(f.home, "../workspace-two");
  await fs.mkdir(secondWorkspace);
  f.control.workspace = secondWorkspace;
  const second = await f.service.snapshot();
  assert.deepEqual(second.selectedComponentIds, ["global-instructions"]);
  assert.match(uiText(second.message), /다른 작업공간/); assert.equal(second.selectedVersion, f.version);
  const homeOnly = await f.service.request("apply", { version: f.version, componentIds: ["global-instructions"] });
  assert.equal(homeOnly.error, undefined);
  assert.deepEqual(await fs.readFile(target), original);
  await assert.rejects(fs.access(path.join(secondWorkspace, workspaceTarget)), { code: "ENOENT" });
  f.control.workspace = f.workspace;
  const restored = await f.service.snapshot();
  assert.deepEqual(restored.selectedComponentIds, ids);
  assert.equal(restored.message, undefined);
});

test("personal library failure preserves baseline version, cache and actions and remains visible until recovery", async t => {
  const f = await fixture(t);
  assert.equal((await f.service.request("download", { version: f.version })).error, undefined);
  assert.equal((await f.service.request("apply", { version: f.version, componentIds: ["global-instructions"] })).error, undefined);
  assert.equal((await f.service.request("pin", { version: f.version })).error, undefined);
  const restarted = f.createService();
  const library = (restarted as any).personalLibrary;
  const snapshot = library.snapshot.bind(library);
  library.snapshot = async () => { throw new Error("Cannot find module 'yazl'"); };
  const before = f.requests.length;
  const state = await restarted.snapshot();
  assert.equal(f.requests.length, before, "opening cached settings stays offline even on library failure");
  assert.equal(state.currentVersion, f.version); assert.equal(state.pinnedVersion, f.version);
  assert.equal(state.selectedVersion, f.version); assert.deepEqual(state.downloadedVersions, [f.version]);
  assert.deepEqual(state.selectedComponentIds, ["global-instructions"]);
  assert(state.documents.length); assert(state.components.length); assert.equal(state.library, undefined);
  assert.match(uiText(state.error, "en"), /Personal resource library: Cannot find module 'yazl'/);
  assert.match(uiText(state.error, "ko"), /개인 리소스 라이브러리/);
  assert(f.warnings.some(message => message.includes("instruction library snapshot failed")));
  const unpinned = await restarted.request("unpin", {});
  assert.equal(unpinned.currentVersion, f.version); assert.equal(unpinned.pinnedVersion, null);
  assert.match(uiText(unpinned.error), /yazl/);
  const refreshed = await restarted.request("refresh", {});
  assert.equal(refreshed.currentVersion, f.version); assert(refreshed.versions.length);
  assert.match(uiText(refreshed.error), /yazl/);
  library.snapshot = snapshot;
  const recovered = await restarted.snapshot();
  assert.equal(recovered.error, undefined); assert(recovered.library);
  assert.equal(recovered.currentVersion, f.version);
});

test("restarted adapter browses and rolls back verified cached instructions without any network requests", async t => {
  const f = await fixture(t);
  await f.service.request("download", { version: f.version });
  const installed = await f.service.request("apply", { componentIds: ["global-instructions"] });
  assert.equal(installed.error, undefined);
  const original = await fs.readFile(path.join(f.home, "AGENTS.md"));
  const requestCount = f.requests.length;
  f.control.failure = "offline after restart";
  const restarted = f.createService();
  const state = await restarted.snapshot();
  assert.equal(state.error, undefined); assert.equal(state.currentVersion, f.version);
  assert.equal(state.selectedVersion, f.version); assert.deepEqual(state.downloadedVersions, [f.version]);
  assert.deepEqual(state.versions[0].notes, { en: "This instruction package is downloaded locally.", ko: "로컬에 다운로드된 지침 패키지입니다." });
  assert.equal(state.versions[0].version, f.version); assert.equal(state.versions[0].compatible, true);
  assert.deepEqual(state.components, f.manifest.components);
  assert.equal(state.documents.length, f.manifest.documents.length);
  assert.deepEqual(state.selectedComponentIds, ["global-instructions"]);
  const preview = await restarted.request("preview", { path: state.documents[0].path });
  assert.equal(preview.error, undefined); assert(preview.preview?.text.length);
  const rollback = await restarted.request("rollback", { version: f.version });
  assert.equal(rollback.error, undefined); assert.equal(rollback.currentVersion, f.version);
  assert.deepEqual(await fs.readFile(path.join(f.home, "AGENTS.md")), original);
  assert.equal(f.requests.length, requestCount, "restart, preview and rollback must remain entirely offline");
  // Repository changes reset browsing while preserving the applied receipt.
  f.control.failure = undefined;
  f.control.repository = "another/Instructions";
  const switched = await restarted.snapshot();
  assert.equal(switched.currentVersion, f.version);
  assert.deepEqual(switched.selectedComponentIds, ["global-instructions"]);
  assert.equal(switched.selectedVersion, null); assert.deepEqual(switched.documents, []);
  assert.match(uiText(switched.message), new RegExp(f.manifest.repository));
  assert.deepEqual(await fs.readFile(path.join(f.home, "AGENTS.md")), original);
});

test("adapter busy gate and real local conflicts preserve installed file and receipt", async t => {
  const f = await fixture(t);
  let release!: () => void;
  f.control.gate = new Promise<void>(resolve => { release = resolve; });
  const operation = f.service.request("refresh", {});
  const busy = await f.service.request("unpin", {});
  assert.match(uiText(busy.error), /진행 중/);
  release(); f.control.gate = undefined;
  assert.equal((await operation).error, undefined);
  await f.service.request("download", {});
  await f.service.request("apply", { componentIds: ["global-instructions"] });
  const stateFile = path.join(f.home, "azrael/instructions/state.json");
  const receipt = await fs.readFile(stateFile);
  await fs.writeFile(path.join(f.home, "AGENTS.md"), "local edit preserved");
  const result = await f.service.request("apply", { componentIds: ["global-instructions"] });
  assert.equal(result.conflicts.length, 1); assert.equal(result.conflicts[0].current, "local edit preserved");
  assert(result.conflicts[0].proposed?.length); assert.match(uiText(result.message), /수정된 파일/);
  assert.equal(result.currentVersion, f.version);
  assert.deepEqual(await fs.readFile(stateFile), receipt);
  assert.equal(await fs.readFile(path.join(f.home, "AGENTS.md"), "utf8"), "local edit preserved");
  const rollback = await f.service.request("rollback", { version: f.version });
  assert.match(uiText(rollback.error), /conflict/i);
  assert.deepEqual(await fs.readFile(stateFile), receipt);
});
