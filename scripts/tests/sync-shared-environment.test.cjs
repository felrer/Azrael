"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { spawnSync } = require("node:child_process");
const { main } = require("../sync-shared-environment.cjs");
const { parseToml, pathState } = require("../sync-codex-environment.cjs");

function fixture(t, changeManifest = () => {}) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "shared-environment-test-"));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const repo = path.join(temporary, "repo");
  const checkout = path.join(temporary, "checkout");
  const stateRoot = path.join(temporary, "state");
  fs.mkdirSync(repo);
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd: repo, encoding: "utf8", windowsHide: true });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
  };
  const write = (name, contents) => {
    const target = path.join(repo, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
  };
  const manifest = {
    schema: 1,
    config: { rootKeys: [], tables: ["agents"], protectedRootKeys: ["model", "model_reasoning_effort"] },
    agentRoles: ["sol_executor", "luna_explorer"],
    generatedAgentRoles: [{ name: "devin_swe2_medium", source: "sol_executor", description: "Devin", model: "devin/swe-2-medium" }],
    skills: ["demo"],
  };
  changeManifest(manifest);
  write(".gitattributes", "* text eol=lf\n");
  write("azrael-environment.json", JSON.stringify(manifest));
  write("environment/config.toml", 'model = "source"\n[agents]\nenabled = true\ndefault_subagent_model = "sol"\n');
  write("environment/AGENTS.md", "# Shared instructions\n");
  write("environment/agents/sol_executor.toml", 'name = "sol_executor"\nmodel = "sol"\ndeveloper_instructions = "Preserve assigned scope."\n');
  write("environment/agents/luna_explorer.toml", 'name = "luna_explorer"\nmodel = "luna"\ndeveloper_instructions = "Explore narrowly."\n');
  write("environment/skills/demo/SKILL.md", "---\nname: demo\ndescription: Demo skill\n---\nInstructions\n");
  git("init", "-b", "main");
  git("config", "core.autocrlf", "false");
  git("add", ".");
  git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "fixture");
  const engineChecks = [];
  const invoke = (mode = "apply", checkEngine = (engine, home) => engineChecks.push(home)) => main([
    "--repo", repo, "--checkout", checkout, "--state-root", stateRoot,
    "--engine", process.execPath, "--mode", mode,
  ], { checkEngine });
  return { repo, checkout, stateRoot, invoke, engineChecks };
}

test("full apply stages roles and skills, validates both homes, and is idempotent", (t) => {
  const f = fixture(t);
  const result = f.invoke();
  assert.equal(result.status, "applied");
  assert.equal(fs.readFileSync(path.join(f.stateRoot, "AGENTS.md"), "utf8"), "# Shared instructions\n");
  assert.equal(parseToml(fs.readFileSync(path.join(f.stateRoot, "config.toml"), "utf8")).agents.enabled, true);
  for (const name of ["sol_executor", "luna_explorer", "devin_swe2_medium"]) {
    assert.ok(fs.existsSync(path.join(f.stateRoot, "agents", name + ".toml")));
  }
  assert.ok(fs.existsSync(path.join(f.stateRoot, "skills", "demo", "SKILL.md")));
  const generated = parseToml(fs.readFileSync(path.join(f.stateRoot, "agents", "devin_swe2_medium.toml"), "utf8"));
  assert.equal(generated.developer_instructions, "Preserve assigned scope.");
  const receipt = JSON.parse(fs.readFileSync(result.receipt, "utf8"));
  assert.equal(receipt.fingerprint, result.fingerprint);
  assert.ok(receipt.roleHashes.devin_swe2_medium);
  assert.ok(receipt.skillHashes.demo);
  assert.ok(fs.existsSync(path.join(result.backup, "recovery.json")));
  assert.equal(f.engineChecks.length, 2);
  assert.equal(f.engineChecks[1], f.stateRoot);
  const before = pathState(result.receipt);
  assert.equal(f.invoke().status, "unchanged");
  assert.deepEqual(pathState(result.receipt), before);
  assert.equal(f.engineChecks.length, 3);
});

test("validate updates checkout and leaves an absent state root untouched", (t) => {
  const f = fixture(t);
  assert.equal(f.invoke("validate").status, "validated");
  assert.equal(fs.existsSync(f.stateRoot), false);
  assert.ok(fs.existsSync(path.join(f.checkout, "azrael-environment.json")));
  assert.equal(f.engineChecks.length, 1);
});

test("destination protected and unselected keys survive while agents are replaced", (t) => {
  const f = fixture(t);
  fs.mkdirSync(f.stateRoot);
  fs.writeFileSync(path.join(f.stateRoot, "config.toml"),
    'model = "root"\nmodel_reasoning_effort = "high"\n[windows]\nsandbox = "unelevated"\n[agents]\nenabled = false\nold = true\n');
  f.invoke();
  const config = parseToml(fs.readFileSync(path.join(f.stateRoot, "config.toml"), "utf8"));
  assert.equal(config.model, "root");
  assert.equal(config.model_reasoning_effort, "high");
  assert.deepEqual(config.windows, { sandbox: "unelevated" });
  assert.deepEqual(config.agents, { enabled: true, default_subagent_model: "sol" });
});

test("local checkout modifications abort without overwriting them", (t) => {
  const f = fixture(t);
  f.invoke("validate");
  const instructions = path.join(f.checkout, "environment", "AGENTS.md");
  fs.writeFileSync(instructions, "Local work");
  assert.throws(() => f.invoke(), /local changes/);
  assert.equal(fs.readFileSync(instructions, "utf8"), "Local work");
  assert.equal(fs.existsSync(f.stateRoot), false);
});

test("bad skill names fail before staging or state writes", (t) => {
  const f = fixture(t, (manifest) => { manifest.skills = ["../escape"]; });
  assert.throws(() => f.invoke(), /Invalid managed name/);
  assert.equal(fs.existsSync(f.stateRoot), false);
});

test("committed engine failure restores previous managed contents and removes lock", (t) => {
  const f = fixture(t);
  const result = f.invoke();
  fs.writeFileSync(path.join(f.stateRoot, "AGENTS.md"), "Prior destination");
  const before = pathState(f.stateRoot);
  assert.throws(() => f.invoke("apply", (engine, home) => {
    if (home === f.stateRoot) throw new Error("committed validation failed");
  }), /committed validation failed/);
  assert.equal(fs.readFileSync(path.join(f.stateRoot, "AGENTS.md"), "utf8"), "Prior destination");
  assert.equal(JSON.parse(fs.readFileSync(result.receipt, "utf8")).fingerprint, result.fingerprint);
  assert.equal(fs.existsSync(path.join(f.stateRoot, "azrael", "shared-environment.lock")), false);
  // Recovery records are intentionally retained; managed files themselves are restored.
  assert.ok(before.exists);
});

test("modified managed skills are repaired even with a matching receipt fingerprint", (t) => {
  const f = fixture(t);
  f.invoke();
  fs.writeFileSync(path.join(f.stateRoot, "skills", "demo", "extra.txt"), "drift");
  assert.equal(f.invoke().status, "applied");
  assert.equal(fs.existsSync(path.join(f.stateRoot, "skills", "demo", "extra.txt")), false);
});

test("source or destination changes during staged validation abort before commit", (t) => {
  const f = fixture(t);
  assert.throws(() => f.invoke("apply", () => {
    fs.writeFileSync(path.join(f.checkout, "environment", "AGENTS.md"), "Concurrent source");
  }), /Concurrent change detected/);
  assert.equal(fs.existsSync(f.stateRoot), false);
});
