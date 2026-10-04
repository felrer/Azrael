import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import Module from "node:module";
import test, { type TestContext } from "node:test";
import type { InstructionAction, InstructionRequest, InstructionUiState } from "../src/instructionProtocol";

const root = path.resolve(__dirname, "../../../..");
const backendFile = path.join(root, "scripts/instruction-package.cjs");
const { InstructionStore } = require(backendFile);

async function fixture(t: TestContext) {
  const assetRoot = process.env.AZRAEL_INSTRUCTION_RELEASE_ASSETS ?? path.join(root, "artifacts/instructions/review-1.0.0");
  const manifestName = "azrael-instructions-1.0.0-manifest.json";
  const manifest = JSON.parse(await fs.readFile(path.join(assetRoot, manifestName), "utf8"));
  const assets = new Map<string, Buffer>();
  for (const name of [manifestName, manifest.archive.name, manifest.documentsAsset.name]) assets.set(name, await fs.readFile(path.join(assetRoot, name)));
  const release = { tag_name: "instructions-v1.0.0", draft: false, prerelease: false, body: "Generated release notes", assets: [...assets.keys()].map(name => ({ name, browser_download_url: `https://github.com/${manifest.repository}/releases/download/instructions-v1.0.0/${name}` })) };
  const verification = path.join(root, "artifacts/verification");
  await fs.mkdir(verification, { recursive: true });
  const dir = await fs.mkdtemp(path.join(verification, "instruction-service-"));
  t.after(async () => {
    assert(dir.startsWith(verification + path.sep));
    await fs.rm(dir, { recursive: true, force: true });
  });
  const home = path.join(dir, "home"), workspace = path.join(dir, "workspace");
  await fs.mkdir(home); await fs.mkdir(workspace);
  const latest = JSON.parse(await fs.readFile(path.join(root, "artifacts/latest.json"), "utf8"));
  const engine = path.join(latest.releaseDirectory, "engine", process.platform === "win32" ? "codex.exe" : "codex");
  await fs.access(engine);
  const control: { repository: string; workspace: string; failure?: string; gate?: Promise<void> } = { repository: manifest.repository, workspace };
  const warnings: string[] = [], requests: string[] = [], options: any[] = [];
  const transport = async (url: string) => {
    requests.push(url);
    if (control.gate) await control.gate;
    if (control.failure) throw new Error(control.failure);
    if (url.startsWith(`https://api.github.com/repos/${manifest.repository}/releases?`)) return Buffer.from(JSON.stringify([release]));
    if (url === `https://api.github.com/repos/${manifest.repository}/releases/tags/instructions-v1.0.0`) return Buffer.from(JSON.stringify(release));
    const name = url.slice(url.lastIndexOf("/") + 1);
    const bytes = assets.get(name);
    if (bytes && release.assets.some(asset => asset.browser_download_url === url)) return bytes;
    throw new Error(`Unexpected offline release URL: ${url}`);
  };
  const api = Module as unknown as { _load(request: string, parent: unknown, isMain: boolean): unknown };
  const original = api._load;
  api._load = function (request, parent, isMain) {
    if (request === "vscode") return { workspace: { get workspaceFolders() { return [{ uri: { scheme: "file", fsPath: control.workspace } }]; }, getConfiguration: () => ({ get: () => control.repository }) } };
    if (request === backendFile) return { InstructionStore: class extends InstructionStore {
      constructor(input: any) { super({ ...input, request: transport }); options.push(input); }
    } };
    return original.call(this, request, parent, isMain);
  };
  const serviceFile = require.resolve("../src/instructionService");
  delete require.cache[serviceFile];
  const { InstructionService } = require(serviceFile) as typeof import("../src/instructionService");
  const { InstructionView } = require("../src/instructionView") as typeof import("../src/instructionView");
  const createService = () => new InstructionService({ extensionUri: { fsPath: path.join(root, "extensions/azrael-ex") }, extension: { packageJSON: { version: "0.4.0" } } } as any, { codexHome: home, engine }, { warn: (message: string) => warnings.push(message) } as any);
  const service = createService();
  // The dynamic backend require happens on each first snapshot, so retain this boundary until teardown.
  t.after(() => { api._load = original; delete require.cache[serviceFile]; });
  t.diagnostic(`Generated assets: ${assetRoot}; native validator: ${engine}; isolated CODEX_HOME only`);
  return { service, createService, InstructionView, control, warnings, options, requests, manifest, home, workspace, engine };
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
  assert.equal(state.selectedVersion, "1.0.0"); assert.equal(state.versions[0].notes, "Generated release notes");
  assert.equal(state.versions[0].compatible, true); assert.equal(state.versions[0].prerelease, false);
  assert.deepEqual(state.components, f.manifest.components);
  assert.equal(state.documents.length, f.manifest.documents.length);
  assert(state.documents.every(document => document.title && document.kind));
  const document = state.documents[0];
  state = await dispatch("preview", { path: document.path });
  assert.equal(state.preview?.path, document.path); assert(state.preview?.text.length);
  assert(sent.at(-1).html.includes("Generated release notes"));
  state = await dispatch("selectVersion", { version: "1.0.0" }); assert.equal(state.preview, undefined);
  state = await dispatch("download", { version: "1.0.0" });
  assert.deepEqual(state.downloadedVersions, ["1.0.0"]); assert.equal(state.currentVersion, null);
  const ids = ["global-instructions"];
  state = await dispatch("apply", { version: "1.0.0", componentIds: ids });
  assert.equal(state.currentVersion, "1.0.0"); assert.deepEqual(state.selectedComponentIds, ids);
  assert.equal(state.error, undefined); assert.deepEqual(state.conflicts, []);
  assert((await fs.readFile(path.join(f.home, "AGENTS.md"), "utf8")).length);
  await assert.rejects(fs.access(path.join(f.home, "agents/luna_explorer.toml")), { code: "ENOENT" });
  assert.deepEqual(f.options[0], { stateRoot: f.home, appVersion: "0.4.0", repository: f.manifest.repository, engine: f.engine, workspaceRoot: f.workspace });
  assert.equal(f.warnings.length, 0);
});

test("pin, unpin, cached rollback and empty selections persist through a fresh adapter", async t => {
  const f = await fixture(t);
  await f.service.request("download", { version: "1.0.0" });
  await f.service.request("apply", { componentIds: ["global-instructions"] });
  assert.equal((await f.service.request("pin", {})).pinnedVersion, "1.0.0");
  assert.equal((await f.service.request("refresh", {})).selectedVersion, "1.0.0");
  assert.equal((await f.service.request("unpin", {})).pinnedVersion, null);
  const before = await fs.readFile(path.join(f.home, "AGENTS.md"));
  const rollback = await f.service.request("rollback", { version: "1.0.0" });
  assert.equal(rollback.error, undefined); assert.deepEqual(rollback.selectedComponentIds, ["global-instructions"]);
  assert.deepEqual(await fs.readFile(path.join(f.home, "AGENTS.md")), before);
  const cleared = await f.service.request("apply", { componentIds: [] });
  assert.equal(cleared.error, undefined); assert.deepEqual(cleared.selectedComponentIds, []);
  await assert.rejects(fs.access(path.join(f.home, "AGENTS.md")), { code: "ENOENT" });
  // Repository changes recreate the backend and reset browsing state without rewriting the applied receipt.
  f.control.repository = "another/Instructions";
  const switched = await f.service.snapshot();
  assert.equal(switched.currentVersion, "1.0.0"); assert.deepEqual(switched.selectedComponentIds, []);
  assert.equal(switched.selectedVersion, null); assert.deepEqual(switched.documents, []);
  assert.match(switched.message ?? "", new RegExp(f.manifest.repository));
});

test("invalid repository and retryable backend failures return error state without changing data", async t => {
  const f = await fixture(t);
  f.control.repository = "invalid repository";
  const invalid = await f.service.snapshot(); assert.match(invalid.error ?? "", /owner\/name/);
  assert.match((await f.service.request("refresh", {})).error ?? "", /owner\/name/);
  assert.equal(f.options.length, 0); assert.equal(f.requests.length, 0);
  f.control.repository = f.manifest.repository;
  f.control.failure = "offline fixture";
  assert.equal((await f.service.request("refresh", {})).error, "offline fixture");
  f.control.failure = undefined;
  assert.equal((await f.service.request("refresh", {})).error, undefined);
  assert.match((await f.service.request("preview", { path: "missing" })).error ?? "", /문서/);
  assert.match((await f.service.request("selectVersion", { version: "../bad" })).error ?? "", /버전/);
  assert.equal((await f.service.snapshot()).currentVersion, null);
  await assert.rejects(fs.access(path.join(f.home, "AGENTS.md")), { code: "ENOENT" });
});

test("changing workspace maps its own selection and preserves retained workspace files and notices", async t => {
  const f = await fixture(t);
  await f.service.request("download", { version: "1.0.0" });
  const ids = ["global-instructions", "playbook-work"];
  const applied = await f.service.request("apply", { componentIds: ids });
  assert.equal(applied.error, undefined); assert.deepEqual(applied.selectedComponentIds, ids);
  const target = path.join(f.workspace, "docs/playbooks/work.md"), original = await fs.readFile(target);
  const secondWorkspace = path.join(f.home, "../workspace-two");
  await fs.mkdir(secondWorkspace);
  f.control.workspace = secondWorkspace;
  const second = await f.service.snapshot();
  assert.deepEqual(second.selectedComponentIds, ["global-instructions"]);
  assert.match(second.message ?? "", /다른 작업공간/); assert.equal(second.selectedVersion, "1.0.0");
  const homeOnly = await f.service.request("apply", { version: "1.0.0", componentIds: ["global-instructions"] });
  assert.equal(homeOnly.error, undefined);
  assert.deepEqual(await fs.readFile(target), original);
  await assert.rejects(fs.access(path.join(secondWorkspace, "docs/playbooks/work.md")), { code: "ENOENT" });
  f.control.workspace = f.workspace;
  const restored = await f.service.snapshot();
  assert.deepEqual(restored.selectedComponentIds, ids);
  assert.equal(restored.message, undefined);
});

test("restarted adapter browses and rolls back verified cached instructions without any network requests", async t => {
  const f = await fixture(t);
  await f.service.request("download", { version: "1.0.0" });
  const installed = await f.service.request("apply", { componentIds: ["global-instructions"] });
  assert.equal(installed.error, undefined);
  const original = await fs.readFile(path.join(f.home, "AGENTS.md"));
  const requestCount = f.requests.length;
  f.control.failure = "offline after restart";
  const restarted = f.createService();
  const state = await restarted.snapshot();
  assert.equal(state.error, undefined); assert.equal(state.currentVersion, "1.0.0");
  assert.equal(state.selectedVersion, "1.0.0"); assert.deepEqual(state.downloadedVersions, ["1.0.0"]);
  assert.equal(state.versions[0].version, "1.0.0"); assert.equal(state.versions[0].compatible, true);
  assert.deepEqual(state.components, f.manifest.components);
  assert.equal(state.documents.length, f.manifest.documents.length);
  assert.deepEqual(state.selectedComponentIds, ["global-instructions"]);
  const preview = await restarted.request("preview", { path: state.documents[0].path });
  assert.equal(preview.error, undefined); assert(preview.preview?.text.length);
  const rollback = await restarted.request("rollback", { version: "1.0.0" });
  assert.equal(rollback.error, undefined); assert.equal(rollback.currentVersion, "1.0.0");
  assert.deepEqual(await fs.readFile(path.join(f.home, "AGENTS.md")), original);
  assert.equal(f.requests.length, requestCount, "restart, preview and rollback must remain entirely offline");
});

test("adapter busy gate and real local conflicts preserve installed file and receipt", async t => {
  const f = await fixture(t);
  let release!: () => void;
  f.control.gate = new Promise<void>(resolve => { release = resolve; });
  const operation = f.service.request("refresh", {});
  const busy = await f.service.request("unpin", {});
  assert.match(busy.error ?? "", /진행 중/);
  release(); f.control.gate = undefined;
  assert.equal((await operation).error, undefined);
  await f.service.request("download", {});
  await f.service.request("apply", { componentIds: ["global-instructions"] });
  const stateFile = path.join(f.home, "azrael/instructions/state.json");
  const receipt = await fs.readFile(stateFile);
  await fs.writeFile(path.join(f.home, "AGENTS.md"), "local edit preserved");
  const result = await f.service.request("apply", { componentIds: ["global-instructions"] });
  assert.equal(result.conflicts.length, 1); assert.equal(result.conflicts[0].current, "local edit preserved");
  assert(result.conflicts[0].proposed?.length); assert.match(result.message ?? "", /수정된 파일/);
  assert.equal(result.currentVersion, "1.0.0");
  assert.deepEqual(await fs.readFile(stateFile), receipt);
  assert.equal(await fs.readFile(path.join(f.home, "AGENTS.md"), "utf8"), "local edit preserved");
  const rollback = await f.service.request("rollback", { version: "1.0.0" });
  assert.match(rollback.error ?? "", /conflict/i);
  assert.deepEqual(await fs.readFile(stateFile), receipt);
});
