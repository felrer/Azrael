"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { promisify } = require("node:util");
const execFile = promisify(require("node:child_process").execFile);
const root = path.resolve(__dirname, "../..");

test("instruction modules load from the packaged account-ui dependency layout", async t => {
  const fixtures = path.join(root, "artifacts/verification");
  await fs.mkdir(fixtures, { recursive: true });
  const fixture = await fs.mkdtemp(path.join(fixtures, "instruction-module-package-"));
  t.after(async () => {
    const relative = path.relative(fixtures, fixture);
    assert(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
    assert(!(await fs.lstat(fixture)).isSymbolicLink());
    await fs.rm(fixture, { recursive: true });
    await assert.rejects(fs.access(fixture), { code: "ENOENT" });
  });
  const account = path.join(fixture, "extension/account-ui");
  await fs.mkdir(account, { recursive: true });
  const copied = new Set();
  async function dependency(name) {
    if (copied.has(name)) return;
    copied.add(name);
    const source = path.join(root, "extensions/azrael-ex/node_modules", name);
    const metadata = JSON.parse(await fs.readFile(path.join(source, "package.json"), "utf8"));
    assert(!(await fs.lstat(source)).isSymbolicLink());
    await fs.cp(source, path.join(account, "node_modules", name), { recursive: true });
    for (const name of Object.keys(metadata.dependencies ?? {})) await dependency(name);
  }
  for (const name of ["smol-toml", "semver", "yazl", "yauzl"]) await dependency(name);
  for (const name of ["instruction-library.cjs", "instruction-publisher.cjs", "task-profile-runtime.cjs"]) await fs.copyFile(path.join(root, "scripts", name), path.join(account, name));
  const code = `
    const path=require('node:path');
    const {InstructionLibrary}=require('./instruction-library.cjs');
    const {InstructionPublisher}=require('./instruction-publisher.cjs');
    const {TaskProfileRuntime}=require('./task-profile-runtime.cjs');
    const base=${JSON.stringify(fixture)};
    new InstructionLibrary({root:path.join(base,'library'),installedRoot:path.join(base,'home')});
    new InstructionPublisher({stateRoot:path.join(base,'operations')});
    new TaskProfileRuntime({codexHome:path.join(base,'home'),request:async()=>{throw Error('No network allowed')}});
    process.stdout.write('Packaged instruction modules loaded');
  `;
  const result = await execFile(process.execPath, ["-e", code], { cwd: account, windowsHide: true, env: { ...process.env, NODE_PATH: "" } });
  assert.equal(result.stdout, "Packaged instruction modules loaded");
});
