"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const { test } = require("node:test");
const { spawnSync } = require("node:child_process");
const { textScanFiles, untrustedTextFiles, writeVsix } = require("./package-local-host.cjs");

const source = fs.readFileSync(path.join(__dirname, "package-local-host.cjs"), "utf8");
const pinnedCli = path.resolve(__dirname, "../artifacts/build/pdf_chrome_20261001_v2/companion/node_modules/@vscode/vsce/vsce");
const pinnedRequire = require("node:module").createRequire(pinnedCli);

async function archiveEntries(filename) {
  const yauzl = pinnedRequire("yauzl");
  return new Promise((resolve, reject) => {
    yauzl.open(filename, { lazyEntries: true }, (error, zip) => {
      if (error) return reject(error);
      const entries = [];
      zip.on("error", reject);
      zip.on("end", () => resolve(entries));
      zip.on("entry", entry => {
        zip.openReadStream(entry, (error, stream) => {
          if (error) return reject(error);
          const chunks = [];
          stream.on("error", reject);
          stream.on("data", chunk => chunks.push(chunk));
          stream.on("end", () => {
            entries.push({ name: entry.fileName, contents: Buffer.concat(chunks).toString("base64"),
              mode: entry.externalFileAttributes >>> 16, mtime: entry.getLastModDate().getTime(),
              compression: entry.compressionMethod });
            zip.readEntry();
          });
        });
      });
      zip.readEntry();
    });
  });
}

test("pinned yazl writer preserves buffers, files, modes, output replacement and reproducible ordering/mtime", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "package-writer-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const previousEpoch = process.env.SOURCE_DATE_EPOCH;
  t.after(() => previousEpoch === undefined ? delete process.env.SOURCE_DATE_EPOCH : process.env.SOURCE_DATE_EPOCH = previousEpoch);
  process.env.SOURCE_DATE_EPOCH = "1700000000";
  const disk = path.join(root, "disk");
  fs.writeFileSync(disk, "local file bytes");
  const files = [
    { path: "z-buffer", contents: Buffer.from([0, 255, 128]), mode: 0o100755 },
    { path: "b-local", localPath: disk, mode: 0o100640 },
    { path: "a-text", contents: "utf8 한글", mode: 0o100644 },
  ];
  const output = path.join(root, "test.vsix");
  fs.writeFileSync(output, "previous package");
  await writeVsix(files, output, pinnedRequire("yazl"));
  const entries = await archiveEntries(output);
  assert.deepEqual(entries.map(entry => entry.name), ["a-text", "b-local", "z-buffer"]);
  assert.deepEqual(entries.map(entry => entry.mode), [0o100644, 0o100640, 0o100755]);
  assert.deepEqual(entries.map(entry => entry.contents), [Buffer.from("utf8 한글").toString("base64"),
    Buffer.from("local file bytes").toString("base64"), Buffer.from([0, 255, 128]).toString("base64")]);
  for (const entry of entries) assert.equal(entry.mtime, 1700000000000);
  const first = fs.readFileSync(output);
  await writeVsix(files, output, pinnedRequire("yazl"));
  assert.deepEqual(fs.readFileSync(output), first);
  delete process.env.SOURCE_DATE_EPOCH;
  const unsorted = files.slice().reverse();
  await writeVsix(unsorted, output, pinnedRequire("yazl"));
  assert.deepEqual((await archiveEntries(output)).map(entry => entry.name), unsorted.map(file => file.path));
  const missing = [{ path: "missing", localPath: path.join(root, "missing") }];
  await assert.rejects(writeVsix(missing, path.join(root, "missing.vsix"), pinnedRequire("yazl")), { code: "ENOENT" });
  await assert.rejects(writeVsix(files, root, pinnedRequire("yazl")));
});

function extensionFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "package-real-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cwd = path.join(root, "extension");
  fs.mkdirSync(cwd);
  fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({ name: "fixture-host", publisher: "fixture",
    version: "1.0.0", engines: { vscode: "^1.90.0" }, description: "Packaging fixture", license: "MIT",
    main: "main.js", activationEvents: ["onStartupFinished"] }));
  fs.writeFileSync(path.join(cwd, "main.js"), 'exports.activate = () => {};\n');
  fs.writeFileSync(path.join(cwd, "README.md"), "# Packaging fixture\n");
  fs.writeFileSync(path.join(cwd, "LICENSE"), "MIT\n");
  fs.writeFileSync(path.join(cwd, ".vscodeignore"), "");
  return { root, cwd };
}

test("minimal real fixture matches pinned VSCE CLI archive entries and metadata", async t => {
  const { root, cwd } = extensionFixture(t);
  const output = path.join(root, "optimized.vsix");
  const baseline = path.join(root, "baseline.vsix");
  const options = { cwd, encoding: "utf8", windowsHide: true,
    env: { ...process.env, SOURCE_DATE_EPOCH: "1700000000" }, timeout: 60000 };
  const optimized = spawnSync(process.execPath, [path.join(__dirname, "package-local-host.cjs"), pinnedCli, output], options);
  assert.equal(optimized.status, 0, `${optimized.error || ""}\n${optimized.stdout}\n${optimized.stderr}`);
  const original = spawnSync(process.execPath, [pinnedCli, "package", "--no-dependencies", "--no-rewrite-relative-links",
    "--allow-missing-repository", "--allow-package-all-secrets", "--out", baseline], options);
  assert.equal(original.status, 0, `${original.error || ""}\n${original.stdout}\n${original.stderr}`);
  assert.deepEqual(await archiveEntries(output), await archiveEntries(baseline));
});

test("real .env and credential fixtures fail with nonzero status and no secret body in logs", async t => {
  const { root, cwd } = extensionFixture(t);
  const output = path.join(root, "blocked.vsix");
  fs.writeFileSync(path.join(cwd, ".env"), "EXAMPLE=local-only\n");
  const run = () => spawnSync(process.execPath, [path.join(__dirname, "package-local-host.cjs"), pinnedCli, output],
    { cwd, encoding: "utf8", windowsHide: true, timeout: 60000 });
  const env = run();
  assert.equal(env.status, 1);
  assert.ok(!fs.existsSync(output));
  // Verify pinned validation itself refuses .env even when credential scanning is allowed.
  const baseline = spawnSync(process.execPath, [pinnedCli, "package", "--no-dependencies", "--no-rewrite-relative-links",
    "--allow-missing-repository", "--allow-package-all-secrets", "--out", output],
    { cwd, encoding: "utf8", windowsHide: true, timeout: 60000 });
  assert.equal(baseline.status, 1, `${baseline.error || ""}\n${baseline.stdout}\n${baseline.stderr}`);
  assert.ok(!fs.existsSync(output));
  fs.unlinkSync(path.join(cwd, ".env"));
  // Use a synthetic npm token recognized by the pinned VSCE scanner's enabled rules.
  const credential = "npm_" + "0123456789abcdefghijklmnopqrstuvwxyz";
  fs.writeFileSync(path.join(cwd, "main.js"), `const credential = "${credential}";\n`);
  const secret = run();
  assert.equal(secret.status, 1);
  assert.ok(!fs.existsSync(output));
  assert.ok(!`${secret.stdout}${secret.stderr}`.includes(credential));
  assert.match(secret.stderr, /Host package preparation or secret check failed/);
});

function fixture(t, { diskOk = true, memoryOk = true, validationError } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "package-unit-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cwd = path.resolve("prepared-host");
  const cli = path.resolve("pinned-vsce", "vsce");
  const manifest = { name: "host" };
  const files = [
    { path: "extension/.env", localPath: path.join(cwd, ".env") },
    { path: "extension/out/main.js", localPath: path.join(cwd, "out/main.js") },
    { path: "extension/bin/engine.exe", localPath: path.join(cwd, "bin/engine.exe") },
    { path: "extension/package.json", contents: '{"name":"host"}' },
    { path: "extension.vsixmanifest", contents: Buffer.from("<manifest />") },
  ];
  const calls = { files: [], text: [], collect: [], archive: [], validation: [] };
  const module = { exports: {} };
  const mockRequire = name => {
    if (name.startsWith("node:")) return require(name);
    if (name === "pinned-yazl") return { ZipFile: class extends EventEmitter {
      constructor() { super(); this.outputStream = new PassThrough(); }
      addFile(...args) { calls.archive.push(["file", ...args]); }
      addBuffer(...args) { calls.archive.push(["buffer", ...args]); }
      end() { this.outputStream.end("archive fixture"); }
    } };
    if (name === path.join(path.dirname(cli), "out/package.js")) return {
      async readManifest(dir) { calls.manifest = dir; return manifest; },
      async collect(value, options) { calls.collect.push([value, options]); return files; },
      async printAndValidatePackagedFiles(...args) {
        calls.validation.push(args);
        if (validationError) throw validationError;
      },
    };
    if (name === path.join(path.dirname(cli), "out/secretLint.js")) return {
      async lintFiles(...args) { calls.files.push(args); return { ok: diskOk, results: [{ message: { text: "sensitive diagnostic" } }] }; },
      async lintText(...args) { calls.text.push(args); return { ok: memoryOk, results: [{ message: { text: "sensitive diagnostic" } }] }; },
    };
    throw new Error(`Unexpected module: ${name}`);
  };
  mockRequire.resolve = (name, options) => {
    assert.equal(name, "yazl");
    assert.equal(options.paths[0], path.dirname(cli));
    return "pinned-yazl";
  };
  vm.runInNewContext(source, {
    module, require: mockRequire, Buffer,
    process: { cwd: () => cwd, env: {} },
  });
  const output = path.join(root, "host.vsix");
  return { run: () => module.exports.packageLocalHost(cli, output), calls, cwd, cli, manifest, files, output };
}

test("text selection preserves extensionless configuration, .env, source maps and text sources", () => {
  const names = [".env", ".env.production", "config", "LICENSE", "src/main.ts", "out/main.js.map", "README.md"];
  const files = names.map(localPath => ({ localPath }));
  assert.deepEqual(textScanFiles(files), files);
});

test("text selection excludes generated native/media assets and existing node_modules paths", () => {
  const extensions = "exe dll pdb node so dylib wasm woff woff2 ttf otf png jpg jpeg gif svg webp avif ico mp3 mp4 webm zip gz br".split(" ");
  const files = extensions.map(extension => ({ localPath: `bin/asset.${extension.toUpperCase()}` }));
  files.push({ localPath: "account-ui/node_modules/dep/index.js" });
  files.push({ localPath: "C:\\host\\node_modules\\dep\\index.js" });
  files.push({ path: "extension/package.json", contents: "{}" });
  assert.deepEqual(textScanFiles(files), []);
});

test("collect once, scan, validate and archive the exact collected entries with pinned options", async t => {
  const f = fixture(t);
  assert.equal(await f.run(), 0);
  assert.equal(f.calls.manifest, f.cwd);
  assert.equal(f.calls.collect.length, 1);
  assert.equal(f.calls.collect[0][0], f.manifest);
  assert.deepEqual({ ...f.calls.collect[0][1] }, {
    cwd: f.cwd, dependencies: false, allowMissingRepository: true, rewriteRelativeLinks: false,
    packagePath: f.output, allowPackageAllSecrets: true,
  });
  assert.deepEqual(Array.from(f.calls.files[0][0]), [path.join(f.cwd, ".env"), path.join(f.cwd, "out/main.js")]);
  assert.deepEqual(f.calls.files[0].slice(1), [true, true]);
  assert.deepEqual(f.calls.text, [
    ['{"name":"host"}', "extension/package.json", true, true],
    ["<manifest />", "extension.vsixmanifest", true, true],
  ]);
  assert.equal(f.calls.validation[0][0], f.files);
  assert.equal(f.calls.validation[0][1], f.cwd);
  assert.equal(f.calls.validation[0][2], f.manifest);
  assert.equal(f.calls.validation[0][3], f.calls.collect[0][1]);
  assert.equal(f.calls.validation[0][3].allowPackageEnvFile, undefined);
  assert.deepEqual(f.calls.archive.map(call => call[2]), f.files.map(file => file.path));
  assert.equal(f.calls.archive[0][1], f.files[0].localPath);
  assert.equal(f.calls.archive.at(-1)[1], f.files.at(-1).contents);
  const metrics = JSON.parse(fs.readFileSync(`${f.output}.metrics.json`, "utf8"));
  assert.equal(metrics.success, true);
  assert.equal(metrics.outputBytes, fs.statSync(f.output).size);
  assert.equal(metrics.counts.collected, f.files.length);
  for (const stage of ["collect", "trustedComparison", "scan", "validationEnvGuard", "archive", "total"])
    assert.ok(metrics.timingsMs[stage] >= 0, stage);
});

test("detected on-disk secret blocks packaging without exposing diagnostic", async t => {
  const f = fixture(t, { diskOk: false });
  await assert.rejects(f.run(), { message: "Host package secret check failed." });
  assert.equal(f.calls.archive.length, 0);
  assert.equal(f.calls.validation.length, 0);
});

test("detected in-memory secret blocks packaging without exposing diagnostic", async t => {
  const f = fixture(t, { memoryOk: false });
  await assert.rejects(f.run(), { message: "Host package secret check failed." });
  assert.equal(f.calls.archive.length, 0);
});

test("validation failure blocks writer and records failed stage", async t => {
  const f = fixture(t, { validationError: new Error("env guard rejected") });
  await assert.rejects(f.run(), /env guard rejected/);
  assert.equal(f.calls.archive.length, 0);
  const metrics = JSON.parse(fs.readFileSync(`${f.output}.metrics.json`, "utf8"));
  assert.equal(metrics.success, false);
  assert.ok(metrics.timingsMs.validationEnvGuard >= 0);
});

async function pristineFixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "package-local-host-"));
  const host = path.join(root, "host");
  const pristine = path.join(root, "pristine");
  const outside = path.join(root, "outside");
  for (const directory of [host, pristine, outside]) fs.mkdirSync(directory);
  function write(directory, relative, contents) {
    const target = path.join(directory, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
    return { localPath: target };
  }
  try {
    await run({ root, host, pristine, outside, write });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("only exact corresponding SHA256-identical files inherit pristine trust", async () => {
  await pristineFixture(async ({ host, pristine, write }) => {
    const unchanged = write(host, "webview/main.js", "official bytes");
    write(pristine, "webview/main.js", "official bytes");
    const changed = write(host, "webview/changed.js", "local changes");
    write(pristine, "webview/changed.js", "official bytes");
    const added = write(host, "config", "new configuration");
    // Equal bytes at a different relative path do not confer trust.
    write(pristine, "other/config", "new configuration");
    const env = write(host, ".env", "official environment contents");
    write(pristine, ".env", "official environment contents");
    const files = [unchanged, changed, added, env];
    assert.deepEqual(await untrustedTextFiles(files, host, pristine), [changed, added, env]);
    assert.deepEqual(await untrustedTextFiles(files, host), files);
  });
});

test("outside-host traversal cannot inherit trust from a corresponding outside file", async () => {
  await pristineFixture(async ({ host, pristine, outside, write }) => {
    const file = write(outside, "main.js", "same bytes");
    file.localPath = path.join(host, "..", "outside", "main.js");
    assert.deepEqual(await untrustedTextFiles([file], host, pristine), [file]);
  });
});

test("symlinks escaping either root cannot inherit pristine trust", async () => {
  await pristineFixture(async ({ host, pristine, outside, write }) => {
    write(outside, "main.js", "same bytes");
    write(host, "trusted-escape/main.js", "same bytes");
    write(pristine, "host-escape/main.js", "same bytes");
    const linkType = process.platform === "win32" ? "junction" : "dir";
    fs.symlinkSync(outside, path.join(pristine, "trusted-escape"), linkType);
    fs.symlinkSync(outside, path.join(host, "host-escape"), linkType);
    const files = [
      { localPath: path.join(host, "trusted-escape/main.js") },
      { localPath: path.join(host, "host-escape/main.js") },
    ];
    assert.deepEqual(await untrustedTextFiles(files, host, pristine), files);
  });
});
