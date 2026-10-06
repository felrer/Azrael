"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { createSettingsOwner } = require("./use-control-settings.cjs");
function fixture(run) { const home = fs.mkdtempSync(path.join(os.tmpdir(), "use-settings-")); try { run(home); } finally { fs.rmSync(home, { recursive: true, force: true }); } }
test("settings defaults, strict validation, revision CAS and exclusive writes", () => fixture(home => {
  const a = createSettingsOwner(home), b = createSettingsOwner(home), initial = a.getSettings();
  assert.deepEqual(initial, { schema: 1, revision: 0, computerUseEnabled: true, windowUseAllowAll: false, computerUseGeneration: 0, windowUseGeneration: 0 });
  assert.equal(a.assertComputerUseEnabled(), undefined);
  const next = a.updateSettings({ computerUseEnabled: false }, 0);
  assert.equal(next.computerUseGeneration, 1); assert.equal(b.getSettings().computerUseEnabled, false);
  assert.throws(() => b.updateSettings({ windowUseAllowAll: true }, 0), { code: "REVISION_CONFLICT" });
  assert.throws(() => b.assertComputerUseEnabled(), /disabled/);
  const unchanged = b.updateSettings({ computerUseEnabled: false }, 1); assert.equal(unchanged.revision, 2); assert.equal(unchanged.computerUseGeneration, 1);
  const changed = a.updateSettings({ computerUseEnabled: true, windowUseAllowAll: true }, 2); assert.equal(changed.windowUseGeneration, 1); assert.equal(changed.computerUseGeneration, 2);
  assert.throws(() => a.updateSettings({ revision: 0 }, 3)); assert.throws(() => a.updateSettings({ computerUseEnabled: 1 }, 3));
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
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});
