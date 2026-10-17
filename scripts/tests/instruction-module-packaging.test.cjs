"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { promisify } = require("node:util");
const execFile = promisify(require("node:child_process").execFile);
const { checkInstructionModules, instructionModules } = require("../check-instruction-modules.cjs");
const root = path.resolve(__dirname, "../..");
const sourceAccount = path.join(root, "extensions/azrael-ex");
const sourceModules = path.join(sourceAccount, "node_modules");
const checker = path.join(root, "scripts/check-instruction-modules.cjs");

async function packageDirectory(name, parent) {
  let directory = path.dirname(require.resolve(name, { paths: [parent] }));
  while (true) {
    try {
      const metadata = JSON.parse(await fs.readFile(path.join(directory, "package.json"), "utf8"));
      if (metadata.name === name) return { directory, metadata };
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    const next = path.dirname(directory);
    assert.notEqual(next, directory, `Package metadata missing: ${name}`);
    directory = next;
  }
}

async function fixture(t, { omitDirect, omitTransitive } = {}) {
  const fixtures = path.join(root, "artifacts/verification");
  await fs.mkdir(fixtures, { recursive: true });
  const directory = await fs.mkdtemp(path.join(fixtures, "instruction-module-package-"));
  t.after(async () => {
    const relative = path.relative(fixtures, directory);
    assert(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
    assert(!(await fs.lstat(directory)).isSymbolicLink());
    await fs.rm(directory, { recursive: true });
    await assert.rejects(fs.access(directory), { code: "ENOENT" });
  });
  const account = path.join(directory, "extension/account-ui");
  await fs.mkdir(account, { recursive: true });
  const manifest = JSON.parse(await fs.readFile(path.join(sourceAccount, "package.json"), "utf8"));
  if (omitDirect) delete manifest.dependencies[omitDirect];
  await fs.writeFile(path.join(account, "package.json"), JSON.stringify(manifest));
  const copied = new Set();
  async function dependency(name, parent) {
    if (name === omitTransitive) return;
    const { directory: source, metadata } = await packageDirectory(name, parent);
    if (copied.has(source)) return;
    copied.add(source);
    const relative = path.relative(sourceModules, source);
    assert(relative && !relative.startsWith("..") && !path.isAbsolute(relative), `Production dependency must be installed in source account-ui: ${name}`);
    assert(!(await fs.lstat(source)).isSymbolicLink());
    await fs.cp(source, path.join(account, "node_modules", relative), {
      recursive: true,
      filter: file => !path.relative(source, file).split(path.sep).includes("node_modules"),
    });
    for (const child of Object.keys(metadata.dependencies ?? {})) await dependency(child, source);
  }
  // No hand-maintained extra packages: undeclared runtime dependencies must fail.
  for (const name of Object.keys(manifest.dependencies ?? {})) await dependency(name, sourceAccount);
  for (const name of instructionModules) await fs.copyFile(path.join(root, "scripts", name), path.join(account, name));
  return { directory, account };
}

test("real instruction modules load from the declared packaged production dependency closure", async t => {
  const { account } = await fixture(t);
  assert.deepEqual(checkInstructionModules(account), { modules: instructionModules });
});

for (const [kind, name, options] of [
  ["direct", "yazl", { omitDirect: "yazl" }],
  ["transitive", "buffer-crc32", { omitTransitive: "buffer-crc32" }],
]) {
  test(`missing ${kind} instruction dependency fails despite ancestor and source NODE_PATH copies`, async t => {
    const { directory, account } = await fixture(t, options);
    const { directory: source } = await packageDirectory(name, sourceAccount);
    const ancestorCopy = path.join(directory, "extension/node_modules", name);
    await fs.cp(source, ancestorCopy, { recursive: true });
    const env = { ...process.env, NODE_PATH: sourceModules };
    // Prove a normal resolver can see the deliberately hostile ancestor copy.
    const visible = await execFile(process.execPath, ["-e", `process.stdout.write(require.resolve(${JSON.stringify(name)}))`], { cwd: account, env, windowsHide: true });
    assert(visible.stdout.startsWith(ancestorCopy + path.sep));
    await assert.rejects(execFile(process.execPath, [checker, account], { cwd: root, env, windowsHide: true }), error => {
      assert.notEqual(error.code, 0);
      assert.match(error.stderr, /Packaged instruction dependency escapes account-ui/);
      assert(error.stderr.includes(name));
      return true;
    });
    // With the ancestor removed, source NODE_PATH must not rescue the payload.
    await fs.rm(ancestorCopy, { recursive: true });
    await assert.rejects(execFile(process.execPath, [checker, account], { cwd: root, env, windowsHide: true }), error => {
      assert.match(error.stderr, /Cannot find module|Packaged instruction dependency escapes account-ui/);
      assert(error.stderr.includes(name));
      return true;
    });
  });
}

test("packaging guard rejects relative account-ui roots", () => {
  assert.throws(() => checkInstructionModules("account-ui"), /Absolute account-ui directory required/);
});
