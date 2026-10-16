"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { createSettingsOwner, stageEnabled } = require("./use-control-settings.cjs");
function fixture(run) { const home = fs.mkdtempSync(path.join(os.tmpdir(), "use-settings-")); try { run(home); } finally { fs.rmSync(home, { recursive: true }); } }
test("settings defaults, strict validation, revision CAS and exclusive writes", () => fixture(home => {
  const a = createSettingsOwner(home), b = createSettingsOwner(home), initial = a.getSettings();
  assert.deepEqual(initial, { schema: 2, revision: 0, windowUseEnabled: true, stage1Enabled: true, stage2Enabled: true, stage3Enabled: false, stage4Enabled: true, windowUseAllowAll: false, computerUseGeneration: 0, windowUseGeneration: 0 });
  assert.equal(a.assertComputerUseEnabled(), undefined);
  const next = a.updateSettings({ stage4Enabled: false }, 0);
  assert.equal(next.computerUseGeneration, 1); assert.equal(b.getSettings().stage4Enabled, false);
  assert.throws(() => b.updateSettings({ windowUseAllowAll: true }, 0), { code: "REVISION_CONFLICT" });
  assert.throws(() => b.assertComputerUseEnabled(), /disabled/);
  const unchanged = b.updateSettings({ stage4Enabled: false }, 1); assert.equal(unchanged.revision, 2); assert.equal(unchanged.computerUseGeneration, 1);
  const changed = a.updateSettings({ stage4Enabled: true, windowUseAllowAll: true }, 2); assert.equal(changed.windowUseGeneration, 2); assert.equal(changed.computerUseGeneration, 2);
  assert.throws(() => a.updateSettings({ revision: 0 }, 3)); assert.throws(() => a.updateSettings({ stage4Enabled: 1 }, 3));
  const file = path.join(home, "azrael/computer-use/use-settings.json");
  fs.writeFileSync(file + ".lock", ""); assert.throws(() => a.updateSettings({}, 3), { code: "EEXIST" }); fs.unlinkSync(file + ".lock");
  for (const bad of ["corrupt", JSON.stringify({ ...changed, extra: true }), JSON.stringify({ ...changed, revision: -1 }), " ".repeat(16385)]) { fs.writeFileSync(file, bad); assert.throws(() => a.getSettings()); assert.throws(() => a.assertComputerUseEnabled()); assert.throws(() => a.updateSettings({}, 3)); }
  fs.unlinkSync(file); fs.mkdirSync(file); assert.throws(() => a.getSettings());
}));
test("separate processes cannot both commit the same expected revision", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "use-settings-cas-"));
  try {
    const { spawn } = require("node:child_process");
    const modulePath = path.join(__dirname, "use-control-settings.cjs");
    const code = `const owner = require(process.argv[1]).createSettingsOwner(process.argv[2]); try { owner.updateSettings({windowUseAllowAll:true}, 0); process.exit(0); } catch(e) { if(['REVISION_CONFLICT','EEXIST'].includes(e.code)) process.exit(2); console.error(e); process.exit(3); }`;
    const results = await Promise.all([1, 2].map(() => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["-e", code, modulePath, home], { stdio: ["ignore", "ignore", "pipe"] });
      let errors = ""; child.stderr.on("data", data => errors += data); child.on("error", reject); child.on("close", exit => resolve({ exit, errors }));
    })));
    assert.deepEqual(results.map(r => r.exit).sort(), [0, 2], JSON.stringify(results));
    assert.equal(createSettingsOwner(home).getSettings().revision, 1);
  } finally { fs.rmSync(home, { recursive: true }); }
});

test("schema1 migration preserves disabled desktop, revisions, generations and all-app setting", () => fixture(home => {
  const file = path.join(home, "azrael/computer-use/use-settings.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (const enabled of [false, true]) {
    fs.writeFileSync(file, JSON.stringify({ schema: 1, revision: 7, computerUseEnabled: enabled, windowUseAllowAll: true, computerUseGeneration: 5, windowUseGeneration: 3 }));
    const owner = createSettingsOwner(home), state = owner.getSettings();
    assert.equal(state.schema, 2); assert.equal(state.stage4Enabled, enabled); assert.equal(state.stage3Enabled, false);
    assert.equal(state.windowUseEnabled, true); assert.equal(state.stage1Enabled, true); assert.equal(state.stage2Enabled, true);
    assert.equal(state.revision, 7); assert.equal(state.windowUseGeneration, 3); assert.equal(state.computerUseGeneration, 5); assert.equal(state.windowUseAllowAll, true);
    assert.equal(Object.hasOwn(state, "computerUseEnabled"), false);
    owner.updateSettings({ stage3Enabled: true }, 7);
    assert.equal(JSON.parse(fs.readFileSync(file)).schema, 2);
  }
}));
test("independent stage switches and master override preserve stored values and revoke generations", () => fixture(home => {
  const owner = createSettingsOwner(home);
  for (let mask = 0; mask < 16; mask++) {
    const patch = Object.fromEntries([1,2,3,4].map(stage => [`stage${stage}Enabled`, Boolean(mask & (1 << (stage-1)))]));
    for (const master of [true, false]) {
      const before = owner.getSettings(), state = owner.updateSettings({ ...patch, windowUseEnabled: master }, before.revision);
      const changed = Object.keys(patch).some(key => before[key] !== patch[key]) || before.windowUseEnabled !== master;
      assert.equal(state.windowUseGeneration, before.windowUseGeneration + Number(changed));
      assert.equal(state.computerUseGeneration, before.computerUseGeneration + Number(before.windowUseEnabled !== master || before.stage4Enabled !== patch.stage4Enabled));
      for (let stage=1; stage<=4; stage++) {
        assert.equal(state[`stage${stage}Enabled`], patch[`stage${stage}Enabled`]);
        assert.equal(stageEnabled(state, stage), master && patch[`stage${stage}Enabled`]);
        if (stageEnabled(state, stage)) owner.assertStageEnabled(stage); else assert.throws(() => owner.assertStageEnabled(stage), /disabled/);
      }
      if (stageEnabled(state, 4)) owner.assertComputerUseEnabled(); else assert.throws(() => owner.assertComputerUseEnabled(), /disabled/);
    }
  }
  for (const invalid of [0,5,"2",null]) assert.throws(() => owner.assertStageEnabled(invalid), /Invalid/);
  assert.throws(() => owner.updateSettings({ computerUseEnabled: true }, owner.getSettings().revision), /Invalid/);
}));
