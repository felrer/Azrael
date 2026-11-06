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

test("generated release applies only the selected component through the real host adapter", async t => {
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
  await dispatch("mount");
  await dispatch("refresh");
  let state = await dispatch("selectVersion", { version: f.version });
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
