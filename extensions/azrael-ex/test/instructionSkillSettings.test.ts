import assert from "node:assert/strict";
import * as path from "node:path";
import test from "node:test";
import { AppServerTransportOptions } from "../src/appServerTransport";
import { InstructionSkillSettings, InstructionSkillTransport } from "../src/instructionSkillSettings";

const cwd = path.resolve("instruction-settings-fixture");
const first = path.join(cwd, "one", "SKILL.md");
const second = path.join(cwd, "two", "SKILL.md");
const runtime = { engine: process.execPath, codexHome: path.join(cwd, "state") };
const skill = (skillPath = first, enabled = true) => ({ path: skillPath, enabled, name: "same-name" });
const listing = (skills: unknown[] = [skill()]) => ({ data: [{ cwd, skills, errors: [] }] });

class FakeTransport implements InstructionSkillTransport {
  starts = 0;
  disposals = 0;
  calls: Array<{ method: string; params: unknown }> = [];
  response: unknown = listing();
  writeResponse: unknown = { effectiveEnabled: false };
  failure?: Error;
  async start(): Promise<unknown> { this.starts++; if (this.failure) throw this.failure; return {}; }
  async request(method: string, params?: unknown): Promise<unknown> {
    this.calls.push({ method, params });
    if (this.failure) throw this.failure;
    return method === "skills/config/write" ? this.writeResponse : this.response;
  }
  dispose(): void { this.disposals++; }
}

test("settings start lazily once and reload native state instead of caching", async () => {
  const transport = new FakeTransport();
  let factories = 0;
  const settings = new InstructionSkillSettings(runtime, cwd, () => { factories++; return transport; });
  try {
    assert.equal(factories, 0);
    assert.deepEqual(await settings.list(), [skill()]);
    transport.response = listing([skill(first, false)]);
    assert.deepEqual(await settings.list(), [skill(first, false)]);
    assert.equal(factories, 1);
    assert.equal(transport.starts, 1);
    assert.deepEqual(transport.calls, Array.from({ length: 2 }, () => ({
      method: "skills/list", params: { cwds: [cwd], forceReload: true },
    })));
  } finally { settings.dispose(); }
  assert.equal(transport.disposals, 1);
});

test("writes select one exact path and return readback state rather than write acknowledgement", async () => {
  const transport = new FakeTransport();
  transport.response = listing([skill(first, true), skill(second, false)]);
  const settings = new InstructionSkillSettings(runtime, cwd, () => transport);
  try {
    assert.equal(await settings.set(first, false), true);
    assert.deepEqual(transport.calls, [
      { method: "skills/config/write", params: { path: first, enabled: false } },
      { method: "skills/list", params: { cwds: [cwd], forceReload: true } },
    ]);
  } finally { settings.dispose(); }
});

test("rejects relative paths, directories and invalid enabled state before starting", async () => {
  let factories = 0;
  const settings = new InstructionSkillSettings(runtime, cwd, () => { factories++; return new FakeTransport(); });
  try {
    for (const candidate of ["SKILL.md", path.dirname(first), path.join(cwd, "README.md"), `${first}\0`]) {
      await assert.rejects(settings.set(candidate, false), /absolute SKILL.md/);
    }
    await assert.rejects(settings.set(first, "false" as unknown as boolean), /boolean/);
    assert.equal(factories, 0);
  } finally { settings.dispose(); }
  assert.throws(() => new InstructionSkillSettings({ ...runtime, engine: "engine" }, cwd), /absolute/);
  assert.throws(() => new InstructionSkillSettings({ ...runtime, codexHome: "state" }, cwd), /absolute/);
  assert.throws(() => new InstructionSkillSettings(runtime, "workspace"), /absolute/);
});

test("validates native list shape, workspace identity, skill identity and loading errors", async () => {
  const transport = new FakeTransport();
  const settings = new InstructionSkillSettings(runtime, cwd, () => transport);
  try {
    const malformed: unknown[] = [
      null, {}, { data: [] }, { data: [listing().data[0], listing().data[0]] },
      { data: [{ cwd: path.dirname(cwd), skills: [], errors: [] }] },
      { data: [{ cwd, skills: [], errors: [{}] }] },
      { data: [{ cwd, skills: [] }] },
      listing([{}]), listing([{ ...skill(), enabled: "yes" }]),
      listing([{ ...skill(), name: " " }]), listing([{ ...skill(), path: "SKILL.md" }]),
      listing([skill(), skill()]),
    ];
    for (const response of malformed) {
      transport.response = response;
      await assert.rejects(settings.list(), /native|Native/);
    }
    transport.response = listing([]);
    assert.deepEqual(await settings.list(), []);
  } finally { settings.dispose(); }
});

test("write response and missing readback are explicit failures without mutation replay", async () => {
  const transport = new FakeTransport();
  const settings = new InstructionSkillSettings(runtime, cwd, () => transport);
  try {
    transport.writeResponse = {};
    await assert.rejects(settings.set(first, false), /write outcome is uncertain/);
    assert.equal(transport.calls.length, 1);
    transport.writeResponse = { effectiveEnabled: false };
    transport.response = listing([skill(second)]);
    await assert.rejects(settings.set(first, false), /absent from effective/);
    assert.deepEqual(transport.calls.map((call) => call.method), ["skills/config/write", "skills/config/write", "skills/list"]);
  } finally { settings.dispose(); }
});

test("path identity follows the host OS without using skill names", async () => {
  const transport = new FakeTransport();
  transport.response = listing([skill(path.join(cwd, "ONE", "SKILL.md"), false)]);
  const settings = new InstructionSkillSettings(runtime, cwd, () => transport);
  try {
    if (process.platform === "win32") assert.equal(await settings.set(first, true), false);
    else await assert.rejects(settings.set(first, true), /absent from effective/);
  } finally { settings.dispose(); }
});

test("installation preparation permits an absent path while ordinary set requires readback", async () => {
  const transport = new FakeTransport();
  transport.response = listing([skill(second)]);
  const settings = new InstructionSkillSettings(runtime, cwd, () => transport);
  try {
    await settings.setForInstallation(first, false);
    assert.deepEqual(transport.calls[0], { method: "skills/config/write", params: { path: first, enabled: false } });
    await assert.rejects(settings.set(first, false), /absent from effective/);
    transport.writeResponse = { effectiveEnabled: true };
    await settings.setForInstallation(first, true);
    transport.response = listing([skill(first, false), skill(second)]);
    await assert.rejects(settings.setForInstallation(first, true), /did not take effect/);
  } finally { settings.dispose(); }
});

test("installation preparation validates paths and native acknowledgement without accepting synthetic state", async () => {
  const transport = new FakeTransport();
  const settings = new InstructionSkillSettings(runtime, cwd, () => transport);
  try {
    await assert.rejects(settings.setForInstallation("SKILL.md", false), /absolute SKILL.md/);
    assert.equal(transport.starts, 0);
    transport.writeResponse = { effectiveEnabled: "false" };
    await assert.rejects(settings.setForInstallation(first, false), /write outcome is uncertain/);
    transport.writeResponse = { effectiveEnabled: true };
    transport.response = listing([]);
    await assert.rejects(settings.setForInstallation(first, false), /did not take effect/);
  } finally { settings.dispose(); }
});

test("local connection preserves selected runtime environment and isolates management/remote state", async () => {
  const env = {
    PATH: "selected-runtime-path", AZRAEL_PROVIDER_BUN: "selected-helper", CODEX_HOME: "other-state",
    AZRAEL_EX_MANAGEMENT_SOCKET: "active-chat", CODEX_REMOTE_TOKEN: "remote-token", AZRAEL_REMOTE_URL: "remote-url",
  };
  let captured: AppServerTransportOptions | undefined;
  const settings = new InstructionSkillSettings({ ...runtime, env }, cwd, (options) => {
    captured = options; return new FakeTransport();
  });
  try {
    await settings.list();
    assert.equal(captured?.executable, runtime.engine);
    assert.equal(captured?.cwd, cwd);
    assert.equal(captured?.env.CODEX_HOME, runtime.codexHome);
    assert.equal(captured?.env.PATH, env.PATH);
    assert.equal(captured?.env.AZRAEL_PROVIDER_BUN, env.AZRAEL_PROVIDER_BUN);
    assert.equal(captured?.env.AZRAEL_EX_MANAGEMENT_SOCKET, undefined);
    assert.equal(captured?.env.CODEX_REMOTE_TOKEN, undefined);
    assert.equal(captured?.env.AZRAEL_REMOTE_URL, undefined);
    assert.equal(captured?.env.CODEX_INTERNAL_APP_SERVER_REMOTE_CONTROL_DISABLED, "1");
    assert.equal(captured?.restartDelayMs, undefined);
    assert.equal(env.AZRAEL_EX_MANAGEMENT_SOCKET, "active-chat");
  } finally { settings.dispose(); }
});

test("native startup and unsupported request failures surface without synthetic state", async () => {
  const transport = new FakeTransport();
  transport.failure = new Error("native engine missing");
  const settings = new InstructionSkillSettings(runtime, cwd, () => transport);
  try {
    await assert.rejects(settings.list(), /native engine missing/);
    assert.equal(transport.disposals, 1);
    transport.failure = undefined;
    await settings.list();
    transport.failure = new Error("Method not found: skills/list");
    await assert.rejects(settings.list(), /Method not found/);
    assert.equal(transport.calls.filter((call) => call.method === "skills/config/write").length, 0);
  } finally { settings.dispose(); }
});

test("disposal is idempotent and queued operations cannot start a process", async () => {
  let factories = 0;
  const settings = new InstructionSkillSettings(runtime, cwd, () => { factories++; return new FakeTransport(); });
  const queued = settings.list();
  settings.dispose();
  settings.dispose();
  await assert.rejects(queued, /disposed/);
  await assert.rejects(settings.list(), /disposed/);
  await assert.rejects(settings.set(first, true), /disposed/);
  assert.equal(factories, 0);
});

test("concurrent writes keep each native write paired with its effective readback", async () => {
  const transport = new FakeTransport();
  let enabled = true;
  transport.request = async (method, params) => {
    transport.calls.push({ method, params });
    if (method === "skills/config/write") {
      enabled = (params as { enabled: boolean }).enabled;
      return { effectiveEnabled: enabled };
    }
    return listing([skill(first, enabled)]);
  };
  const settings = new InstructionSkillSettings(runtime, cwd, () => transport);
  try {
    assert.deepEqual(await Promise.all([settings.set(first, false), settings.set(first, true), settings.list()]),
      [false, true, [skill(first, true)]]);
    assert.deepEqual(transport.calls.map((call) => call.method), [
      "skills/config/write", "skills/list", "skills/config/write", "skills/list", "skills/list",
    ]);
  } finally { settings.dispose(); }
});

test("disposal during initialization closes the owned transport and prevents requests", async () => {
  const transport = new FakeTransport();
  let finishStart!: () => void;
  let observedStart!: () => void;
  const started = new Promise<void>((resolve) => { observedStart = resolve; });
  transport.start = () => { observedStart(); return new Promise<void>((resolve) => { finishStart = resolve; }); };
  const settings = new InstructionSkillSettings(runtime, cwd, () => transport);
  const pending = settings.list();
  await started;
  settings.dispose();
  finishStart();
  await assert.rejects(pending, /disposed/);
  assert.equal(transport.disposals, 1);
  assert.equal(transport.calls.length, 0);
});
