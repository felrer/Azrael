"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
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
