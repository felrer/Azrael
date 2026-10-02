import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { buildHostRuntime } from "../src/hostRuntime";

function fixture(): { directory: string; config: Record<string, unknown>; write(): void; dispose(): void } {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "azrael-standalone-runtime-"));
  const engine = path.join(directory, "codex.exe");
  const bridge = path.join(directory, "azrael-bridge.exe");
  fs.writeFileSync(engine, "engine");
  fs.writeFileSync(bridge, "bridge");
  const config: Record<string, unknown> = { schema: 2, engine, bridge, codexHome: path.join(directory, "azrael-state"), engineVersion: "0.157.1" };
  return {
    directory,
    config,
    write() { fs.writeFileSync(path.join(directory, "azrael-runtime.json"), JSON.stringify(config)); },
    dispose() { fs.rmSync(directory, { recursive: true, force: true }); },
  };
}

test("standalone runtime isolates identity and parent environment", () => {
  const f = fixture();
  try {
    const helper = path.join(f.directory, "devin-helper.mjs");
    const providerHelper = path.join(f.directory, "provider-helper.js");
    const inferenceHelper = path.join(f.directory, "provider-inference.js");
    const providerBun = path.join(f.directory, "bun.exe");
    fs.writeFileSync(helper, "helper");
    for (const candidate of [providerHelper, inferenceHelper, providerBun]) fs.writeFileSync(candidate, "helper");
    f.config.helpers = { devinNativeHelper: helper, providerAccountsHelper: providerHelper, providerInferenceHelper: inferenceHelper, providerBun };
    f.write();
    const inherited: NodeJS.ProcessEnv = {
      OPENAI_API_KEY: "secret-openai", CODEX_API_KEY: "secret-codex", ANTHROPIC_API_KEY: "secret-anthropic",
      OTHER_API_KEY: "secret-other", OPENAI_BASE_URL: "https://wrong.invalid", CODEX_BASE_URL: "https://wrong.invalid",
      AZURE_OPENAI_ENDPOINT: "https://wrong.invalid", AZRAEL_DEVIN_NATIVE_HELPER: "ambient-helper",
      CODEX_HOME: "ambient-home", AZRAEL_EX_MANAGEMENT_SOCKET: "ambient-socket", OPENCODEX_HOME: "ambient-opencodex",
      PATH: "C:\\Windows\\System32", OTHER_SETTING: "retained",
    };
    const snapshot = { ...inherited };
    const runtime = buildHostRuntime(f.directory, inherited);
    assert.equal(runtime.engine, f.config.engine);
    assert.equal(runtime.bridge, f.config.bridge);
    assert.equal(runtime.codexHome, f.config.codexHome);
    assert.equal(runtime.engineVersion, f.config.engineVersion);
    assert.equal(runtime.env.CODEX_HOME, f.config.codexHome);
    assert.equal(runtime.env.AZRAEL_EX_MANAGEMENT_SOCKET, runtime.socket);
    assert.equal(runtime.env.AZRAEL_DEVIN_NATIVE_HELPER, helper);
    assert.equal(runtime.env.AZRAEL_PROVIDER_ACCOUNTS_HELPER, providerHelper);
    assert.equal(runtime.env.AZRAEL_PROVIDER_INFERENCE_HELPER, inferenceHelper);
    assert.equal(runtime.env.AZRAEL_PROVIDER_BUN, providerBun);
    assert.equal(runtime.env.OPENCODEX_HOME, path.join(f.config.codexHome as string, "azrael", "providers", "opencodex"));
    assert.equal(runtime.env.OTHER_SETTING, "retained");
    for (const key of ["OPENAI_API_KEY", "CODEX_API_KEY", "ANTHROPIC_API_KEY", "OTHER_API_KEY", "OPENAI_BASE_URL", "CODEX_BASE_URL", "AZURE_OPENAI_ENDPOINT"]) {
      assert.equal(runtime.env[key], undefined, key);
    }
    assert.deepEqual(inherited, snapshot);
  } finally { f.dispose(); }
});

test("standalone runtime requires schema, files, and valid engine version", () => {
  const f = fixture();
  try {
    f.write();
    f.config.schema = 1;
    f.write();
    assert.throws(() => buildHostRuntime(f.directory), /Unsupported azrael runtime configuration/);
    f.config.schema = 2;
    f.config.engineVersion = "0.01.1";
    f.write();
    assert.throws(() => buildHostRuntime(f.directory), /Invalid azrael engine version/);
    f.config.engineVersion = "0.157.1";
    f.config.bridge = path.join(f.directory, "missing.exe");
    f.write();
    assert.throws(() => buildHostRuntime(f.directory), /Missing azrael bridge file/);
    f.config.bridge = path.join(f.directory, "azrael-bridge.exe");
    f.config.helpers = { nodeExecutable: path.join(f.directory, "missing-node.exe") };
    f.write();
    assert.throws(() => buildHostRuntime(f.directory), /Missing azrael nodeExecutable file/);
  } finally { f.dispose(); }
});

test("standalone runtime rejects ordinary Codex state and gives each host a private socket", () => {
  const f = fixture();
  try {
    f.config.codexHome = path.join(os.homedir(), ".codex", "azrael-test");
    f.write();
    assert.throws(() => buildHostRuntime(f.directory), /requires its own state home/);
    f.config.codexHome = path.join(f.directory, "state");
    f.write();
    const first = buildHostRuntime(f.directory, {});
    const second = buildHostRuntime(f.directory, {});
    assert.notEqual(first.socket, second.socket);
    assert.ok(path.isAbsolute(first.socket));
    assert.equal(first.env.AZRAEL_EX_MANAGEMENT_SOCKET, first.socket);
    assert.equal(second.env.AZRAEL_EX_MANAGEMENT_SOCKET, second.socket);
  } finally { f.dispose(); }
});

test("Windows PATH spelling is canonical in the child environment", { skip: process.platform !== "win32" }, () => {
  const f = fixture();
  try {
    f.write();
    const runtime = buildHostRuntime(f.directory, { Path: "C:\\Windows", PATH: "C:\\Other" });
    assert.deepEqual(Object.keys(runtime.env).filter(key => key.toUpperCase() === "PATH"), ["PATH"]);
    assert.equal(runtime.env.PATH, "C:\\Windows");
  } finally { f.dispose(); }
});
