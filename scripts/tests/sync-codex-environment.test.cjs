"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const {
  assertManagedTarget,
  assertUnchanged,
  enabledPlugins,
  generatedRole,
  instructionBody,
  parseToml,
  pathState,
  selectedConfig,
  stringifyToml,
} = require("../sync-codex-environment.cjs");

const manifest = {
  config: {
    rootKeys: ["notify"],
    tables: ["plugins.*"],
    tableKeys: {
      agents: ["enabled", "default_subagent_model"],
      features: ["js_repl"],
      desktop: ["followUpQueueMode"],
    },
    protectedRootKeys: ["model", "model_reasoning_effort", "model_catalog_json"],
  },
};

test("selected config preserves Azrael owners and replaces only managed Codex fields", () => {
  const source = `model = "ordinary"\nnotify = ["C:\\\\tool.exe", "turn-ended"]\n\n[agents]\nenabled = true\ndefault_subagent_model = "sol"\n\n[plugins."browser@bundle"]\nenabled = true\n\n[features]\njs_repl = false\n\n[desktop]\nfollowUpQueueMode = "steer"\n\n[projects.'ordinary']\ntrust_level = "trusted"\n`;
  const destination = `model_catalog_json = "C:/state/catalog.json"\nmodel = "devin/root"\nmodel_reasoning_effort = "high"\n\n[windows]\nsandbox = "unelevated"\n\n[features]\nold = true\n\n[desktop]\nfollowUpQueueMode = "queue"\n\n[projects.'azrael']\ntrust_level = "trusted"\n`;
  const merged = parseToml(selectedConfig(source, destination, manifest, [["C:\\Users\\person\\.codex", "C:\\Users\\person\\.azrael-ex"]]));

  assert.equal(merged.model, "devin/root");
  assert.equal(merged.model_reasoning_effort, "high");
  assert.equal(merged.model_catalog_json, "C:/state/catalog.json");
  assert.deepEqual(merged.projects, { azrael: { trust_level: "trusted" } });
  assert.deepEqual(merged.windows, { sandbox: "unelevated" });
  assert.deepEqual(merged.agents, { enabled: true, default_subagent_model: "sol" });
  assert.deepEqual(merged.features, { old: true, js_repl: false });
  assert.deepEqual(merged.desktop, { followUpQueueMode: "steer" });
  assert.deepEqual(merged.notify, ["C:\\tool.exe", "turn-ended"]);
});

test("a managed root key does not delete an unselected nested key with the same name", () => {
  const source = `notify = ["tool.exe"]\n[agents]\nenabled = true\ndefault_subagent_model = "sol"\n[features]\njs_repl = false\n[desktop]\nfollowUpQueueMode = "steer"\n`;
  const destination = `model_catalog_json = "catalog.json"\nmodel = "root"\nmodel_reasoning_effort = "low"\n[projects.'x']\ntrust_level = "trusted"\nnotify = ["old.exe"]\n`;
  const merged = parseToml(selectedConfig(source, destination, manifest, []));

  assert.deepEqual(merged.notify, ["tool.exe"]);
  assert.deepEqual(merged.projects.x, { trust_level: "trusted", notify: ["old.exe"] });
});

test("multiline managed and protected values are compared and merged semantically", () => {
  const source = `notify = [\n  """C:\\\\tools\\\\notify.exe""",\n  """turn\nended""",\n]\n[agents]\nenabled = true\ndefault_subagent_model = "sol"\n[features]\njs_repl = false\n[desktop]\nfollowUpQueueMode = "steer"\n`;
  const destination = `model = """\ndevin/root"""\nmodel_reasoning_effort = "high"\nmodel_catalog_json = """\nC:/state/catalog.json"""\n`;
  const expectedProtected = parseToml(destination);
  const merged = parseToml(selectedConfig(source, destination, manifest, []));

  assert.deepEqual(merged.notify, ["C:\\tools\\notify.exe", "turn\nended"]);
  for (const key of manifest.config.protectedRootKeys) assert.equal(merged[key], expectedProtected[key]);
});

test("TOML parse and serialization round-trip apostrophes, backslashes, and dollar literals", () => {
  const input = `notify = ['''C:\\Users\\O'Brien\\$tools\\notify.ps1''', '$HOME ${"${value}"}']\n[labels]\nmessage = '''don't expand $PATH or C:\\temp'''\n`;
  const parsed = parseToml(input);
  const reparsed = parseToml(stringifyToml(parsed));

  assert.deepEqual(reparsed, parsed);
  assert.deepEqual(reparsed.notify, ["C:\\Users\\O'Brien\\$tools\\notify.ps1", "$HOME ${value}"]);
  assert.equal(reparsed.labels.message, "don't expand $PATH or C:\\temp");
});

test("TOML parse and serialization round-trip Hangul and emoji paths and values", () => {
  const input = `notify = ["C:/사용자/개발자/도구/알림-🚀.exe", "완료 ✅"]\n[projects."C:/작업/피-하네스-🧪"]\ntrust_level = "신뢰함 🔐"\n`;
  const parsed = parseToml(input);
  const reparsed = parseToml(stringifyToml(parsed));

  assert.deepEqual(reparsed, parsed);
  assert.deepEqual(reparsed.notify, ["C:/사용자/개발자/도구/알림-🚀.exe", "완료 ✅"]);
  assert.equal(reparsed.projects["C:/작업/피-하네스-🧪"].trust_level, "신뢰함 🔐");
});

test("generated Devin role reuses only the effective Sol developer instructions", () => {
  const source = `name = "sol_executor"\ndescription = "Sol"\nmodel = "gpt-sol"\nmodel_reasoning_effort = "medium"\n\ndeveloper_instructions = """\nLine one.\nLine two.\n"""\ntrailing_role_field = "must not leak"\n[role_metadata]\nowner = "sol-only"\n`;
  const generated = generatedRole(source, {
    name: "devin_swe2_medium",
    description: "Devin",
    model: "devin/swe-2-medium",
  });
  const parsed = parseToml(generated);

  assert.deepEqual(Object.keys(parsed).sort(), ["description", "developer_instructions", "model", "name"]);
  assert.equal(parsed.name, "devin_swe2_medium");
  assert.equal(parsed.model, "devin/swe-2-medium");
  assert.equal(instructionBody(generated), instructionBody(source));
});

test("artifact state detects changed and deleted paths", (t) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "codex-environment-state-"));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const changed = path.join(temporary, "changed.txt");
  const deleted = path.join(temporary, "deleted.txt");
  fs.writeFileSync(changed, "before");
  fs.writeFileSync(deleted, "present");
  const changedBefore = pathState(changed);
  const deletedBefore = pathState(deleted);

  assert.doesNotThrow(() => assertUnchanged(new Map([[changed, changedBefore], [deleted, deletedBefore]])));
  fs.writeFileSync(changed, "after");
  assert.throws(() => assertUnchanged(new Map([[changed, changedBefore]])), /Concurrent change detected/);
  fs.rmSync(deleted);
  assert.throws(() => assertUnchanged(new Map([[deleted, deletedBefore]])), /Concurrent change detected/);
});

test("managed targets reject an ordinary-state junction in their parent path", (t) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "codex-environment-target-"));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const stateRoot = path.join(temporary, "azrael-state");
  const ordinaryState = path.join(temporary, "ordinary-codex-state");
  const alias = path.join(stateRoot, "ordinary-state-alias");
  fs.mkdirSync(stateRoot);
  fs.mkdirSync(ordinaryState);
  fs.symlinkSync(ordinaryState, alias, process.platform === "win32" ? "junction" : "dir");

  assert.throws(
    () => assertManagedTarget(path.join(alias, "config.toml"), stateRoot),
    /Managed target parent escapes Azrael state/,
  );
  assert.doesNotThrow(() => assertManagedTarget(path.join(stateRoot, "config.toml"), stateRoot));
});

test("only enabled plugin selectors are materialized", () => {
  const config = `[plugins."one@bundle"]\nenabled = true\n\n[plugins."two@bundle"]\nenabled = false\n`;
  assert.deepEqual(enabledPlugins(config), ["one@bundle"]);
});

test("owned Computer Use replaces transport and external environment while preserving native owners", () => {
  const source = stringifyToml({
    notify: ["notify.exe"], agents: { enabled: true, default_subagent_model: "sol" },
    features: { js_repl: false }, desktop: { followUpQueueMode: "steer" },
    mcp_servers: { node_repl: {
      command: "missing-external.exe", args: ["external"], env_vars: ["AZRAEL_EX_MANAGEMENT_SOCKET"],
      startup_timeout_sec: 40, tool_timeout_sec: 60, enabled_tools: ["js"], disabled_tools: ["other"],
      env: { SKY_CUA_NATIVE_PIPE_DIRECTORY: "external-pipe", SKY_CUA_NATIVE_PIPE_TOKEN: "token",
        AZRAEL_EX_MANAGEMENT_SOCKET: "socket", NODE_REPL_NODE_PATH: "missing-node.exe", CODEX_HOME: "ordinary-codex-home", EXTERNAL: "value" },
    } },
  });
  const destination = stringifyToml({ model: "native-model", model_reasoning_effort: "high", model_catalog_json: "catalog.json",
    windows: { sandbox: "unelevated" }, projects: { local: { trust_level: "trusted" } },
    features: { native: true }, mcp_servers: { user: { command: "user.exe" }, node_repl: { env_vars: ["OLD"] } },
  });
  const ownedManifest = structuredClone(manifest);
  ownedManifest.config.tables.push("mcp_servers.node_repl", "mcp_servers.node_repl.env");
  const runtime = { directory: path.resolve("owned-runtime"), home: path.resolve("owned-home"), engine: path.resolve("owned-engine.exe") };
  const config = parseToml(selectedConfig(source, destination, ownedManifest, [], runtime));
  const server = config.mcp_servers.node_repl;
  assert.equal(server.command, path.join(runtime.directory, "node_repl.exe"));
  assert.deepEqual(server.env, {
    NODE_REPL_NODE_PATH: path.join(runtime.directory, "node.exe"),
    NODE_REPL_NODE_MODULE_DIRS: path.join(runtime.directory, "node_modules"),
    NODE_REPL_TRUSTED_CODE_PATHS: [runtime.directory, runtime.home].join(";"),
    NODE_REPL_TRUSTED_SERVICES: JSON.stringify({ sky: "@oai/sky/service" }), CODEX_CLI_PATH: runtime.engine, CODEX_HOME: runtime.home,
  });
  assert.equal(server.env_vars, undefined);
  assert.equal(server.args, undefined);
  assert.equal(server.startup_timeout_sec, 40);
  assert.equal(server.tool_timeout_sec, 60);
  assert.deepEqual(server.enabled_tools, ["js"]);
  assert.deepEqual(server.disabled_tools, ["other"]);
  assert.deepEqual(config.mcp_servers.user, { command: "user.exe" });
  assert.deepEqual(config.features, { native: true, js_repl: true });
  assert.deepEqual(config.windows, { sandbox: "unelevated" });
  assert.deepEqual(config.projects, { local: { trust_level: "trusted" } });
  for (const key of manifest.config.protectedRootKeys) assert.equal(config[key], parseToml(destination)[key]);
});

test("owned Computer Use supplies js_repl even when ordinary Codex lacks it", () => {
  const source = `notify = ["notify.exe"]\n[agents]\nenabled = true\ndefault_subagent_model = "sol"\n[desktop]\nfollowUpQueueMode = "steer"\n`;
  const result = parseToml(selectedConfig(source, "", manifest, [], { directory: "runtime", home: "state", engine: "engine.exe" }));
  assert.equal(result.features.js_repl, true);
});

test("owned Computer Use preserves browser and Chrome configuration with home path rewriting", () => {
  const sourceHome = path.resolve("ordinary-home"), finalHome = path.resolve("final-home"), stageHome = path.resolve("stage-home");
  const runtime = path.resolve("owned-runtime"), externalModules = path.resolve("external-runtime/node_modules");
  const browser = path.join(sourceHome, "plugins/browser/scripts/browser-service.mjs");
  const source = stringifyToml({ notify: ["notify.exe"], agents: { enabled: true, default_subagent_model: "sol" }, desktop: { followUpQueueMode: "steer" },
    mcp_servers: { node_repl: { env: {
      NODE_REPL_TRUSTED_SERVICES: JSON.stringify({ browser, sky: "external-sky" }),
      NODE_REPL_NODE_MODULE_DIRS: externalModules, NODE_REPL_TRUSTED_CODE_PATHS: [sourceHome, externalModules].join(";"),
      BROWSER_USE_AVAILABLE_BACKENDS: "chrome,iab", BROWSER_USE_TINYSKY_ENABLED: "1",
      BROWSER_USE_CODEX_APP_VERSION: "fixture", NODE_REPL_INSTRUCTIONS_USE_CASE_BROWSER: "browser instructions",
      NODE_REPL_INSTRUCTIONS_USE_CASE_CHROME: "chrome instructions", SKY_CUA_NATIVE_PIPE_DIRECTORY: "external", AZRAEL_EX_MANAGEMENT_SOCKET: "external",
    } } },
  });
  for (const home of [stageHome, finalHome]) {
    const config = parseToml(selectedConfig(source, "", manifest, [[sourceHome, home]], { directory: runtime, home, engine: "engine.exe" }));
    const env = config.mcp_servers.node_repl.env;
    assert.deepEqual(JSON.parse(env.NODE_REPL_TRUSTED_SERVICES), { browser: path.join(home, "plugins/browser/scripts/browser-service.mjs"), sky: "@oai/sky/service" });
    assert.equal(env.NODE_REPL_NODE_MODULE_DIRS, path.join(runtime, "node_modules"));
    assert.equal(env.CODEX_HOME, home);
    assert.equal(env.NODE_REPL_TRUSTED_CODE_PATHS, [runtime, home].join(";"));
    assert.equal(env.BROWSER_USE_AVAILABLE_BACKENDS, "chrome,iab");
    assert.equal(env.BROWSER_USE_TINYSKY_ENABLED, "1");
    assert.equal(env.BROWSER_USE_CODEX_APP_VERSION, "fixture");
    assert.equal(env.NODE_REPL_INSTRUCTIONS_USE_CASE_BROWSER, "browser instructions");
    assert.equal(env.NODE_REPL_INSTRUCTIONS_USE_CASE_CHROME, "chrome instructions");
    assert.equal(env.SKY_CUA_NATIVE_PIPE_DIRECTORY, undefined);
    assert.equal(env.AZRAEL_EX_MANAGEMENT_SOCKET, undefined);
  }
});

test("owned snapshot transaction installs instructions, repairs drift, and rejects invalid payloads", {
  skip: !process.env.AZRAEL_CONFIG_TEST_ENGINE && "Set AZRAEL_CONFIG_TEST_ENGINE to a verified engine for isolated transaction acceptance",
}, () => {
  const root = path.resolve("artifacts/verification/computer-use-integration/config-transaction-fixture", `run-${Date.now()}`);
  const source = path.join(root, "ordinary"), state = path.join(root, "azrael"), runtime = path.join(root, "runtime");
  const fixtureManifest = { schema: 1, config: { rootKeys: ["notify"], tables: ["mcp_servers.node_repl", "mcp_servers.node_repl.env"], tableKeys: { features: ["js_repl"] }, protectedRootKeys: ["model", "model_reasoning_effort"] }, agentRoles: [], generatedAgentRoles: [], personalSkills: [], copyGlobalInstructions: false };
  const files = {
    "node_repl.exe": "fixture repl", "node.exe": "fixture node",
    "node_modules/@oai/sky/package.json": JSON.stringify({ name: "@oai/sky", version: "1.0.0" }),
    "node_modules/@oai/sky/bin/windows/codex-computer-use.exe": "fixture helper",
    "skills/computer-use/SKILL.md": "---\nname: computer-use\ndescription: fixture\n---\nRead [guidance](../../docs/guidance.md).\n",
    "docs/guidance.md": "fixture guidance", "docs/api.md": "fixture api", "docs/confirmations.md": "fixture confirmations",
  };
  for (const [relative, contents] of Object.entries(files)) {
    const target = path.join(runtime, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
  }
  const runtimeManifest = { schema: 1, packages: [{ name: "@oai/sky", version: "1.0.0", path: "node_modules/@oai/sky" }], files: Object.entries(files).map(([relative, contents]) => ({ path: relative, source: "synthetic fixture", sha256: crypto.createHash("sha256").update(contents).digest("hex"), bytes: Buffer.byteLength(contents) })) };
  const runtimeManifestPath = path.join(runtime, "manifest.json");
  fs.writeFileSync(runtimeManifestPath, JSON.stringify(runtimeManifest));
  fs.mkdirSync(source, { recursive: true });
  fs.mkdirSync(path.join(state, "skills", "computer-use"), { recursive: true });
  fs.mkdirSync(path.join(state, "skills", "user-skill"), { recursive: true });
  fs.writeFileSync(path.join(state, "skills", "computer-use", "SKILL.md"), "previous skill");
  fs.writeFileSync(path.join(state, "skills", "user-skill", "SKILL.md"), "user skill");
  fs.writeFileSync(path.join(state, "config.toml"), 'model = "native-model"\nmodel_reasoning_effort = "high"\n[windows]\nsandbox = "unelevated"\n');
  const browserService = path.join(root, "browser-service.mjs");
  fs.writeFileSync(browserService, "export function handleRpc() {}\n");
  fs.writeFileSync(path.join(source, "config.toml"), stringifyToml({ notify: [process.execPath], mcp_servers: { node_repl: { command: "missing-external.exe", env_vars: ["AZRAEL_EX_MANAGEMENT_SOCKET"], env: {
    NODE_REPL_NODE_PATH: "missing-external-node.exe", NODE_REPL_TRUSTED_SERVICES: JSON.stringify({ browser: browserService, sky: "external-sky" }),
    BROWSER_USE_AVAILABLE_BACKENDS: "chrome,iab", NODE_REPL_INSTRUCTIONS_USE_CASE_BROWSER: "browser instructions", NODE_REPL_INSTRUCTIONS_USE_CASE_CHROME: "chrome instructions",
  } } } }));
  const manifestPath = path.join(root, "snapshot-manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(fixtureManifest));
  const ordinaryBefore = pathState(source);
  const args = [path.resolve(__dirname, "../sync-codex-environment.cjs"), "--source-home", source, "--state-root", state, "--engine", process.env.AZRAEL_CONFIG_TEST_ENGINE, "--manifest", manifestPath, "--computer-use-directory", runtime];
  let sequence = 0;
  function sync(mode, expectedExit = 0) {
    const result = spawnSync(process.execPath, [...args, "--mode", mode], { encoding: "utf8", windowsHide: true });
    fs.writeFileSync(path.join(root, `${++sequence}-${mode}.log`), `${result.stdout}\n${result.stderr}\nexit=${result.status}\n`);
    assert.equal(result.status, expectedExit, result.stderr);
    return expectedExit === 0 ? JSON.parse(result.stdout) : result.stderr;
  }
  const before = pathState(state);
  assert.equal(sync("validate").status, "validated");
  assert.deepEqual(pathState(state), before);
  const applied = sync("apply");
  assert.equal(applied.status, "applied");
  assert.equal(fs.readFileSync(path.join(applied.backup, "previous/skills/computer-use/SKILL.md"), "utf8"), "previous skill");
  assert.equal(fs.readFileSync(path.join(state, "skills/computer-use/SKILL.md"), "utf8"), files["skills/computer-use/SKILL.md"].replaceAll("../../docs", "./docs"));
  for (const name of ["guidance", "api", "confirmations"]) assert.equal(fs.readFileSync(path.join(state, "skills/computer-use/docs", `${name}.md`), "utf8"), files[`docs/${name}.md`]);
  assert.equal(fs.readFileSync(path.join(state, "skills/user-skill/SKILL.md"), "utf8"), "user skill");
  const config = parseToml(fs.readFileSync(path.join(state, "config.toml"), "utf8"));
  assert.equal(config.mcp_servers.node_repl.env.CODEX_CLI_PATH, path.resolve(process.env.AZRAEL_CONFIG_TEST_ENGINE));
  assert.equal(config.mcp_servers.node_repl.env.CODEX_HOME, state);
  assert.equal(config.mcp_servers.node_repl.env_vars, undefined);
  assert.equal(JSON.parse(config.mcp_servers.node_repl.env.NODE_REPL_TRUSTED_SERVICES).browser, browserService);
  assert.equal(config.mcp_servers.node_repl.env.NODE_REPL_INSTRUCTIONS_USE_CASE_CHROME, "chrome instructions");
  assert.equal(config.model, "native-model");
  assert.equal(sync("apply").status, "unchanged");
  fs.writeFileSync(path.join(state, "skills/computer-use/docs/api.md"), "drift");
  assert.equal(sync("apply").status, "applied");
  const committed = pathState(state);
  fs.rmSync(runtimeManifestPath);
  assert.match(sync("apply", 1), /manifest.json/);
  assert.deepEqual(pathState(state), committed);
  fs.writeFileSync(runtimeManifestPath, JSON.stringify({ ...runtimeManifest, schema: 99 }));
  assert.match(sync("apply", 1), /Invalid Computer Use manifest/);
  assert.deepEqual(pathState(state), committed);
  fs.writeFileSync(runtimeManifestPath, JSON.stringify(runtimeManifest));
  fs.writeFileSync(path.join(runtime, "node.exe"), "tampered node");
  assert.match(sync("apply", 1), /Runtime hash mismatch: node.exe/);
  assert.deepEqual(pathState(state), committed);
  assert.deepEqual(pathState(source), ordinaryBefore);
});
