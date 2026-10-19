import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import Module from "node:module";
import test, { type TestContext } from "node:test";
import type { InstructionRequest } from "../src/instructionProtocol";

const root = [path.resolve(__dirname, "../../.."), path.resolve(__dirname, "../../../..")].find(value => existsSync(path.join(value, "scripts/instruction-library.cjs")))!;
const backendFile = path.join(root, "scripts/instruction-library.cjs");
const publisherFile = path.join(root, "scripts/instruction-publisher.cjs");
const { InstructionLibrary, verifyPlan } = require(backendFile);
const files = (name = "adapter") => [{ path: "SKILL.md", encoding: "utf8" as const, content: `---\nname: ${name}\ndescription: Adapter fixture\n---\nSelected content\n` }];

async function fixture(t: TestContext) {
  const verification = process.env.AZRAEL_INSTRUCTION_TEST_ROOT || path.join(root, "artifacts/verification"); await fs.mkdir(verification, { recursive: true });
  const directory = await fs.mkdtemp(path.join(verification, "instruction-library-service-"));
  const libraryRoot = path.join(directory, "library"), home = path.join(directory, "home");
  const values = new Map<string, any>(), secrets = new Map<string, string>();
  const calls: Array<{ action: string; value?: any }> = [];
  const operations = new Map<string, { plan: any; receipt: any; phase: string }>();
  const controls = { auth: "host-secret", prompted: "prompt-secret", failPublish: false };
  const commands: Array<{ command: string; args: any[] }> = [];
  class Publisher {
    async checkConnection(connection: any) { calls.push({ action: "check", value: connection }); return { readable: true, writable: true }; }
    async listOperations() { return [...operations].map(([id, operation]) => ({ id, phase: operation.phase, repository: operation.receipt.repository, version: operation.receipt.version })); }
    async readOperationPlan(id: string) { calls.push({ action: "read-plan", value: id }); return operations.get(id)!.plan; }
    async readOperationReceipt(id: string) { const operation = operations.get(id)!; if (operation.phase === "prepared") return null; const receipt = operation.receipt; return { ...receipt, destination: receipt.repository }; }
    async publish(plan: any, connection: any, options: any) {
      verifyPlan(plan); calls.push({ action: "upload", value: { plan, connection, options } });
      const id = "publication-1", receipt = { operationId: id, repository: connection.repository, version: options.version, commit: "verified-commit", phase: "published" };
      operations.set(id, { plan, receipt, phase: controls.failPublish ? "source-committed" : "published" });
      if (controls.failPublish) throw Object.assign(new Error("Interrupted release upload"), { operationId: id, phase: "source-committed", commit: receipt.commit });
      return receipt;
    }
    async recover(connection: any, id: string) {
      calls.push({ action: "recover", value: { connection, id } }); const operation = operations.get(id)!; operation.phase = "published"; return operation.receipt;
    }
  }
  const context: any = { extensionUri: { fsPath: path.join(root, "extensions/azrael-ex") }, extension: { packageJSON: { version: "0.4.0" } },
    globalState: { get: (key: string, fallback: any) => values.get(key) ?? fallback, update: async (key: string, value: any) => { values.set(key, value); } },
    secrets: { get: async (key: string) => secrets.get(key), store: async (key: string, value: string) => { secrets.set(key, value); } } };
  const api = Module as unknown as { _load(request: string, parent: unknown, isMain: boolean): unknown }, original = api._load;
  api._load = function (request, parent, isMain) {
    if (request === "vscode") return {
      workspace: { workspaceFolders: [], getConfiguration: () => ({ get: (key: string, fallback: any) => key === "instructions.libraryRoot" ? libraryRoot : fallback }) },
      authentication: { getSession: async () => controls.auth ? { accessToken: controls.auth } : undefined },
      window: { showInputBox: async () => { calls.push({ action: "prompt" }); return controls.prompted; } },
      commands: { executeCommand: async (command: string, ...args: any[]) => { commands.push({ command, args }); } }
    };
    if (request === publisherFile) return { InstructionPublisher: Publisher };
    return original.call(this, request, parent, isMain);
  };
  const serviceFile = require.resolve("../src/instructionLibraryService"); delete require.cache[serviceFile];
  const { InstructionLibraryService } = require(serviceFile) as typeof import("../src/instructionLibraryService");
  const createService = () => new InstructionLibraryService(context, { engine: "unused-offline-engine", codexHome: home });
  const service = createService(), library = new InstructionLibrary({ root: libraryRoot, installedRoot: home });
  const connect = (sharing = "collaborators", repository = "owner/team") => values.set(`azrael.instructionConnections.v1:${libraryRoot}`, [{ sharing, repository, branch: "main" }]);
  const create = async (input: InstructionRequest = {}) => {
    await service.request("libraryCreate", { name: "adapter", kind: "skill", files: files(), ...input }); return (await service.snapshot()).selected!;
  };
  t.after(async () => {
    api._load = original; delete require.cache[serviceFile];
    const relative = path.relative(verification, directory); assert(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
    const stat = await fs.lstat(directory); assert(stat.isDirectory() && !stat.isSymbolicLink());
    await fs.rm(directory, { recursive: true }); await assert.rejects(fs.access(directory), { code: "ENOENT" });
    t.diagnostic("Isolated library/CODEX_HOME fixture removed; no remote or model requests");
  });
  return { service, createService, library, create, connect, home, libraryRoot, values, context, calls, commands, controls, operations };
}

test("host create/save remain local until separately reviewed Apply and Publish; receipts map to UI history", async t => {
  const f = await fixture(t), entry = await f.create(); assert.equal(entry.sharing, "collaborators"); assert.equal(entry.installedDigest, null);
  let state = await f.service.snapshot();
  await f.service.request("librarySave", { id: entry.id, revision: state.revision, files: [...files(), { path: "support.md", encoding: "utf8", content: "support" }, { path: "image.bin", encoding: "base64", content: "AP8=" }] });
  await assert.rejects(fs.stat(f.home), { code: "ENOENT" }); assert.equal(f.calls.length, 0);
  await f.service.request("libraryPlanApply", { id: entry.id }); state = await f.service.snapshot();
  assert(state.plan!.diffs!.every(diff => diff.current === "File absent"));
  assert(state.plan!.diffs!.some(diff => diff.proposed === "support"));
  assert(state.plan!.diffs!.some(diff => diff.proposed === "Binary file (2 bytes)"));
  assert(state.plan!.diffs!.every(diff => !("content" in diff) && !("beforeContent" in diff)));
  await assert.rejects(fs.stat(f.home), { code: "ENOENT" });
  await f.service.request("libraryApply", { token: state.plan!.token });
  assert.equal(await fs.readFile(path.join(f.home, "skills/adapter/support.md"), "utf8"), "support"); assert.equal(f.calls.length, 0);
  f.connect(); await f.service.request("libraryPlanPublish", { id: entry.id, version: "1.0.0" }); state = await f.service.snapshot();
  assert.equal(f.calls.filter(c => c.action === "upload").length, 0);
  await f.service.request("libraryPublish", { token: state.plan!.token });
  state = await f.service.snapshot(); assert.equal(f.calls.filter(c => c.action === "upload").length, 1);
  assert.equal(state.entries[0].publications[0].repository, "owner/team");
  const raw = await f.library.read(entry.id); assert.equal(raw.publications[0].destination, "owner/team");
  const stableRevision = state.revision; assert.equal((await f.service.snapshot()).revision, stableRevision);
  assert.equal(JSON.stringify(state).includes("host-secret"), false);
});
test("host snapshots present safe conflict reasons and expose interrupted Apply recovery state", async t => {
  const f = await fixture(t), entry = await f.create();
  const target = path.join(f.home, "skills/adapter/SKILL.md"); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, "unmanaged external file");
  await f.service.request("libraryPlanApply", { id: entry.id }); let state = await f.service.snapshot();
  assert(state.plan!.conflicts.length > 0); assert(state.plan!.conflicts.every(conflict => typeof conflict.reason === "string" && typeof conflict.target === "string"));
  assert(state.plan!.diffs!.some(diff => diff.current === "unmanaged external file" && diff.proposed!.includes("Selected content")));
  await assert.rejects(f.service.request("libraryApply", { token: state.plan!.token }), /destination conflicts/);
  await fs.unlink(target); await f.service.request("libraryPlanApply", { id: entry.id }); state = await f.service.snapshot(); await f.service.request("libraryApply", { token: state.plan!.token });
  state = await f.service.snapshot(); await f.library.save(entry.id, { files: [{ ...files()[0], content: files()[0].content + "Changed content" }] }, state.revision);
  const plan = await f.library.planApply([entry.id]);
  const registry = JSON.parse(await fs.readFile(path.join(f.libraryRoot, "registry.json"), "utf8"));
  await fs.writeFile(path.join(f.libraryRoot, "journal.json"), JSON.stringify({ schemaVersion: 1, state: registry, diffs: plan.diffs }));
  await fs.writeFile(target, Buffer.from(plan.diffs[0].content, "base64"));
  state = await f.service.snapshot(); assert.equal(state.operation!.phase, "apply-interrupted");
  await f.service.request("libraryRecover", {}); state = await f.service.snapshot(); assert.equal(state.operation, undefined);
  assert.equal(await fs.readFile(target, "utf8"), files()[0].content); await assert.rejects(fs.access(path.join(f.libraryRoot, "journal.json")), { code: "ENOENT" });
});

test("empty overrides retain recommended model; frozen host task command captures CODEX_HOME and changed profile blocks Start", async t => {
  const f = await fixture(t), profile = await f.create({ name: "review", kind: "task-profile", files: [], profile: { model: "recommended", provider: "provider", dependencies: [], instructions: "Review" } });
  await f.service.request("libraryPrepareTask", { id: profile.id }); let state = await f.service.snapshot(); assert.equal(state.plan!.model, "recommended");
  assert.equal((state.plan as any).packages, undefined); await f.service.request("libraryStartTask", { token: state.plan!.token });
  assert.equal(f.commands.length, 1); assert.equal(f.commands[0].command, "azrael.startTaskProfile");
  assert.equal(f.commands[0].args[0].model, "recommended"); assert.equal(f.commands[0].args[1], f.home); assert(Object.isFrozen(f.commands[0].args[0].packages));
  await f.service.request("libraryPrepareTask", { id: profile.id }); state = await f.service.snapshot();
  await f.library.save(profile.id, { profile: { ...profile.profile!, instructions: "Changed" } }, state.revision);
  await assert.rejects(f.service.request("libraryStartTask", { token: state.plan!.token }), /profile changed/i); assert.equal(f.commands.length, 1);
});

test("narrowed current sharing blocks all network before publish and changed repository blocks upload", async t => {
  const f = await fixture(t), entry = await f.create({ sharing: "public" }); f.connect("public", "owner/public");
  await f.service.request("libraryPlanPublish", { id: entry.id, sharing: "public", version: "1.0.0" }); let state = await f.service.snapshot();
  await f.library.save(entry.id, { sharing: "local" }, state.revision);
  await assert.rejects(f.service.request("libraryPublish", { token: state.plan!.token }), /sharing mismatch|sharing changed/i); assert.equal(f.calls.length, 0);
  state = await f.service.snapshot(); await f.library.save(entry.id, { sharing: "public" }, state.revision);
  await f.service.request("libraryPlanPublish", { id: entry.id, sharing: "public", version: "1.0.1" }); state = await f.service.snapshot();
  f.connect("public", "owner/replacement");
  await assert.rejects(f.service.request("libraryPublish", { token: state.plan!.token }), /destination changed/i); assert.equal(f.calls.filter(c => c.action === "upload").length, 0);
});

test("missing SecretStorage rejects credentials and snapshots expose files only for selection", async t => {
  const f = await fixture(t), entry = await f.create(); await f.create({ name: "second", files: files("second") });
  await f.service.request("librarySelect", { id: entry.id }); let state = await f.service.snapshot();
  assert(state.selected!.files!.length); assert(state.entries.every(e => e.files === undefined));
  f.connect(); f.context.secrets = undefined; f.controls.auth = "";
  await f.service.request("libraryPlanPublish", { id: entry.id, sharing: "collaborators", version: "1.0.0" }); state = await f.service.snapshot();
  await assert.rejects(f.service.request("libraryPublish", { token: state.plan!.token }), /credential storage is unavailable/i);
  assert.equal(f.calls.filter(c => ["check", "upload"].includes(c.action)).length, 0);
  assert.equal(JSON.stringify(await f.service.snapshot()).includes("prompt-secret"), false);
});

test("restart recovery reuses approved frozen plan and retains its old digest despite later source changes", async t => {
  const f = await fixture(t), entry = await f.create(); f.connect(); f.controls.failPublish = true;
  await f.service.request("libraryPlanPublish", { id: entry.id, sharing: "collaborators", version: "1.0.0" }); let state = await f.service.snapshot();
  await assert.rejects(f.service.request("libraryPublish", { token: state.plan!.token }), /Interrupted release upload/);
  const approved = f.operations.get("publication-1")!.plan; assert.equal(approved.packages[0].digest, entry.digest);
  state = await f.service.snapshot(); await f.library.save(entry.id, { files: [...files(), { path: "later.md", encoding: "utf8", content: "later source" }] }, state.revision);
  const restarted = f.createService(); state = await restarted.snapshot(); assert.equal(state.operation!.id, "publication-1");
  await restarted.request("libraryRecover", {}); state = await restarted.snapshot();
  assert.equal(f.calls.filter(c => c.action === "upload").length, 1); assert.equal(f.calls.filter(c => c.action === "recover").length, 1);
  assert.notEqual(state.entries[0].digest, entry.digest); assert(state.entries[0].publications.some(p => p.digest === entry.digest && p.repository === "owner/team"));
  assert.equal(f.operations.get("publication-1")!.plan.digest, approved.digest);
  const revision = state.revision; assert.equal((await restarted.snapshot()).revision, revision);
});

test("recovery of an uncommitted publication cannot bypass a later local-only scope", async t => {
  const f = await fixture(t), entry = await f.create(); f.connect();
  const plan = await f.library.planPublish([entry.id], "collaborators");
  f.operations.set("prepared-1", { plan, phase: "prepared", receipt: { repository: "owner/team", version: "1.0.0" } });
  const state = await f.service.snapshot(); assert.equal(state.operation!.id, "prepared-1");
  await f.library.save(entry.id, { sharing: "local" }, state.revision);
  await assert.rejects(f.service.request("libraryRecover", {}), /Sharing changed before the source was committed/);
  assert.equal(f.calls.filter(call => ["check", "upload", "recover"].includes(call.action)).length, 0);
});
