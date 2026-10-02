"use strict";

// Persistent regression coverage of the production helper using isolated real tsc builds.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const owner = path.resolve(__dirname, "../extensions/azrael-ex");
const { runBuild, readProject, assertWithin } = require(path.join(owner, "scripts/build-incremental.cjs"));
const ts = require(require.resolve("typescript", { paths: [owner] }));
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "azrael-incremental-regression-"));
const root = path.join(fixture, "project");
let checks = 0;
const skips = [];
function write(relative, content) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}
function check(name, action) {
  action();
  checks++;
  console.log(`PASS ${name}`);
}
function build() { assert.equal(runBuild(root), 0); }
function outputs(relative) {
  return [path.join(root, "dist", relative + ".js"), path.join(root, "dist", relative + ".js.map")];
}
const config = {
  compilerOptions: {
    target: "ES2022", module: "commonjs", rootDir: ".", outDir: "dist",
    incremental: true, tsBuildInfoFile: "dist/.incremental.tsbuildinfo",
    sourceMap: true, strict: true, types: [],
  },
  include: ["src/**/*.ts", "test/**/*.ts"],
};
function setConfig(value) { write("tsconfig.incremental.json", JSON.stringify(value)); }
try {
  setConfig(config);
  write("src/value.ts", "export const value = 1;\n");
  write("src/removed.ts", "export const removed = true;\n");
  write("test/removed.test.ts", "export const tested = true;\n");
  check("initial real compilation", () => {
    build();
    for (const output of outputs("src/value")) assert.ok(fs.existsSync(output));
    assert.ok(fs.existsSync(path.join(root, "dist/.incremental.tsbuildinfo")));
  });
  check("unchanged warm compilation retains outputs and cache", () => {
    const targets = [...outputs("src/value"), path.join(root, "dist/.incremental.tsbuildinfo")];
    const before = targets.map(target => ({ bytes: fs.readFileSync(target), mtime: fs.statSync(target).mtimeMs }));
    build();
    targets.forEach((target, index) => {
      assert.deepEqual(fs.readFileSync(target), before[index].bytes);
      assert.equal(fs.statSync(target).mtimeMs, before[index].mtime);
    });
  });
  check("source edit reaches emitted JavaScript", () => {
    write("src/value.ts", "export const value = 2;\n");
    build();
    assert.match(fs.readFileSync(outputs("src/value")[0], "utf8"), /exports.value = 2/);
  });
  check("deleted source and test JavaScript/maps disappear while assets survive", () => {
    write("dist/assets/keep.js", "asset");
    write("dist/src/keep.json", "{}");
    fs.unlinkSync(path.join(root, "src/removed.ts"));
    fs.unlinkSync(path.join(root, "test/removed.test.ts"));
    build();
    for (const relative of ["src/removed", "test/removed.test"]) {
      for (const output of outputs(relative)) assert.ok(!fs.existsSync(output));
    }
    assert.equal(fs.readFileSync(path.join(root, "dist/assets/keep.js"), "utf8"), "asset");
    assert.equal(fs.readFileSync(path.join(root, "dist/src/keep.json"), "utf8"), "{}");
  });
  check("renamed source and test outputs replace old outputs", () => {
    write("src/old.ts", "export const old = 1;");
    write("test/old.test.ts", "export const old = 1;");
    build();
    fs.renameSync(path.join(root, "src/old.ts"), path.join(root, "src/new.ts"));
    fs.renameSync(path.join(root, "test/old.test.ts"), path.join(root, "test/new.test.ts"));
    build();
    for (const relative of ["src/old", "test/old.test"]) {
      for (const output of outputs(relative)) assert.ok(!fs.existsSync(output));
    }
    for (const relative of ["src/new", "test/new.test"]) {
      for (const output of outputs(relative)) assert.ok(fs.existsSync(output));
    }
  });
  for (const [index, name] of ["JavaScript", "source map"].entries()) {
    check(`missing ${name} is repaired`, () => {
      const output = outputs("src/value")[index];
      const expected = fs.readFileSync(output);
      fs.unlinkSync(output);
      build();
      assert.deepEqual(fs.readFileSync(output), expected);
    });
  }
  check("actual TypeScript failure returns nonzero", () => {
    write("src/value.ts", 'export const value: number = "wrong";');
    assert.notEqual(runBuild(root), 0);
    write("src/value.ts", "export const value = 2;");
    build();
  });
  check("invalid configuration is rejected", () => {
    write("tsconfig.incremental.json", '{ "compilerOptions": { "target": "invalid" } }');
    assert.throws(() => readProject(root));
    setConfig(config);
  });
  check("unowned output paths and cache paths are rejected", () => {
    for (const override of [{ outDir: "../escaped" }, { tsBuildInfoFile: "../escaped.tsbuildinfo" }, { rootDir: "src" }, { incremental: false }]) {
      setConfig({ ...config, compilerOptions: { ...config.compilerOptions, ...override } });
      assert.throws(() => runBuild(root));
    }
    setConfig(config);
    assert.throws(() => assertWithin(path.join(root, "dist"), root));
    assert.throws(() => assertWithin(path.join(root, "dist"), path.join(root, "dist")));
    assert.ok(!fs.existsSync(path.join(fixture, "escaped")));
  });
  for (const relative of ["dist", "dist/src/linked"]) {
    const outside = path.join(fixture, "outside");
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(outside, "sentinel.js"), "preserve");
    const link = path.join(root, relative);
    if (relative === "dist") fs.renameSync(link, path.join(root, "saved-dist"));
    try { fs.symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir"); }
    catch (error) {
      if (relative === "dist") fs.renameSync(path.join(root, "saved-dist"), link);
      if (!["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) throw error;
      skips.push(`${relative}: ${error.code}`);
      continue;
    }
    try {
      if (relative === "dist") {
        check("output-path symlink is rejected", () => {
          assert.throws(() => runBuild(root), /symlink/);
        });
      } else {
        check("cleanup refuses symlink traversal", () => assert.throws(() => runBuild(root), /symlink/));
      }
      assert.equal(fs.readFileSync(path.join(outside, "sentinel.js"), "utf8"), "preserve");
    } finally {
      fs.unlinkSync(link);
      if (relative === "dist") fs.renameSync(path.join(root, "saved-dist"), link);
    }
  }
  console.log(JSON.stringify({ checks, skips, typescript: ts.version }));
} finally {
  // Only this invocation's mkdtemp directory is ever recursively removed.
  assert.equal(path.dirname(fixture), path.resolve(os.tmpdir()));
  assert.ok(path.basename(fixture).startsWith("azrael-incremental-regression-"));
  fs.rmSync(fixture, { recursive: true, force: true });
}
