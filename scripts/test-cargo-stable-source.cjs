"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const stable = require("./cargo-stable-source.cjs");
const owner = require("./cargo-target-owner.cjs");
const project = path.resolve(__dirname, "..");
const run = process.env.AZRAEL_STABLE_CARGO_TEST_ROOT ? null : require("./artifact-run.cjs").beginArtifactRun(project, { workId: "cargo-stable-tests", owner: "cargo-stable-tests", runId: require("node:crypto").randomBytes(6).toString("hex") });
// beginArtifactRun closes on process exit with Node's actual suite exit code.
// Expose that default owner so a caller can verify its close and clean it up.
if (run) process.stderr.write(`[cargo-stable-test-run] ${JSON.stringify({ lifecycleId: run.lifecycleId, runRoot: run.runRoot })}\n`);
const base = process.env.AZRAEL_STABLE_CARGO_TEST_ROOT || run.temporary;
fs.mkdirSync(base, { recursive: true });
const python = process.env.AZRAEL_PYTHON || (process.platform === "win32" ? "python" : "python3");
function execute(command, args, options = {}) {
  const result = spawnSync(command, args, { env: process.env, encoding: "utf8", windowsHide: true, ...options });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result;
}
function assertLinkerPath(targetDirectory) {
  if (process.platform !== "win32") return;
  // MSVC's output file handling has a separate limit from native source IO
  // and CreateProcess cwd. Check the tiny fixture's hashed executable path.
  const output = path.join(targetDirectory, "debug/deps/stable_probe-0000000000000000.exe");
  assert.ok(output.length < 260, `Windows linker fixture output path requires fewer than 260 characters; planned ${output.length}: ${output}`);
}
function bootstrapFixtureMaintenance(destinationRoot) {
  const sourceRoot = path.resolve(__dirname, ".."), config = require("./maintenance-owner-config.cjs");
  const selected = config.resolveMaintenanceCommand(sourceRoot);
  if (!selected.args.length && !process.env.AZRAEL_MAINTENANCE_OWNER) {
    const relative = "artifacts/maintenance/owner-installation.json";
    const pin = JSON.parse(fs.readFileSync(path.join(sourceRoot, relative), "utf8"));
    const versionRoot = path.dirname(path.dirname(pin.executable));
    const executable = path.join(destinationRoot, "m.exe");
    assert.ok(process.platform !== "win32" || executable.length < 260, "Fixture executable must fit Windows launch paths");
    assert.equal(fs.existsSync(executable), false, "Fresh fixture executable required");
    require("./freeze-platform-inputs.cjs").copyTree(path.join(sourceRoot, pin.executable), executable);
    const files = [relative, ...["performance.json", "native-acceptance.json"].map(name => path.join(versionRoot, "verification", name)).filter(name => fs.existsSync(path.join(sourceRoot, name)))];
    for (const name of files) {
      const target = path.join(destinationRoot, name);
      assert.equal(fs.existsSync(target), false, "Fresh standalone fixture metadata required");
      require("./freeze-platform-inputs.cjs").copyTree(path.join(sourceRoot, name), target);
    }
    fs.writeFileSync(path.join(destinationRoot, relative), JSON.stringify({ ...pin, executable: "m.exe" }, null, 2) + "\n");
  }
  const actual = config.resolveMaintenanceCommand(destinationRoot);
  assert.deepEqual(actual.args, selected.args);
  assert.equal(actual.maxLockWaitMs, selected.maxLockWaitMs, "Fixture must preserve the installed queue capability");
  return actual;
}
function fixture({ pathDependency = false } = {}) {
  const root = fs.mkdtempSync(path.join(base, "case-")), repository = path.join(root, "repo"), sourceRoot = path.join(root, "engine");
  fs.mkdirSync(path.join(repository, "codex-rs/src"), { recursive: true });
  fs.writeFileSync(path.join(repository, "LICENSE"), "fixture\n");
  fs.writeFileSync(path.join(repository, ".gitignore"), "\n");
  fs.writeFileSync(path.join(repository, "codex-rs/Cargo.toml"), '[package]\nname="stable-probe"\nversion="0.1.0"\nedition="2021"\n[workspace]\n');
  fs.writeFileSync(path.join(repository, "codex-rs/Cargo.lock"), 'version = 4\n[[package]]\nname = "stable-probe"\nversion = "0.1.0"\n');
  fs.writeFileSync(path.join(repository, "codex-rs/src/main.rs"), 'fn main() { println!("probe"); }\n');
  if (pathDependency) {
    fs.mkdirSync(path.join(repository, "codex-rs/leaf/src"), { recursive: true });
    fs.appendFileSync(path.join(repository, "codex-rs/Cargo.toml"), '[dependencies]\nstable-leaf = { path = "leaf" }\n');
    fs.writeFileSync(path.join(repository, "codex-rs/leaf/Cargo.toml"), '[package]\nname="stable-leaf"\nversion="0.1.0"\nedition="2021"\n');
    fs.writeFileSync(path.join(repository, "codex-rs/leaf/src/lib.rs"), 'pub fn value() -> u8 { 1 }\n');
    fs.writeFileSync(path.join(repository, "codex-rs/src/main.rs"), 'fn main() { println!("{}", stable_leaf::value()); }\n');
    fs.writeFileSync(path.join(repository, "codex-rs/Cargo.lock"), 'version = 4\n[[package]]\nname="stable-probe"\nversion="0.1.0"\ndependencies=["stable-leaf"]\n[[package]]\nname="stable-leaf"\nversion="0.1.0"\n');
  }
  const git = args => execute("git", ["-C", repository, ...args]);
  git(["init", "--quiet"]); git(["config", "user.name", "Fixture"]); git(["config", "user.email", "fixture@example.invalid"]); git(["config", "core.autocrlf", "false"]);
  git(["remote", "add", "origin", "https://github.com/openai/codex.git"]); git(["add", "."]); git(["commit", "--quiet", "-m", "fixture"]); git(["tag", "rust-v0.159.3"]);
  execute(python, ["-B", path.join(__dirname, "import-engine-source.py"), "--source", repository, "--destination", sourceRoot]);
  const targetDirectory = path.join(root, "cache/target"), env = { ...process.env, CARGO_TARGET_DIR: targetDirectory };
  delete env.AZRAEL_CARGO_CACHE_PROJECT_ROOT; delete env.INSTA_PENDING_DIR;
  const lease = owner.acquireTargetOwner({ command: "cargo", args: ["build"], cwd: path.join(sourceRoot, "codex-rs"), env });
  let valid = true;
  const options = { sourceRoot, cacheDirectory: path.dirname(targetDirectory), target: "x86_64-pc-windows-msvc", args: ["build"], env,
    assertLease() { if (!valid || !fs.existsSync(lease.ownerPath)) throw Error("lease conflict"); } };
  return { root, repository, sourceRoot, env, lease, options, invalidate() { valid = false; }, close() { owner.finishTargetOwner(lease, { status: 0 }); } };
}
test("actual imported source sync preserves unchanged files, handles app edits/add/remove and binds original provenance", () => {
  const f = fixture();
  try {
    const first = stable.prepareStableSource(f.options); assert.equal(first.diagnostic.mode, "stable");
    const main = path.join(first.cwd, "src/main.rs"), before = fs.statSync(main, { bigint: true });
    const again = stable.prepareStableSource(f.options); assert.equal(again.diagnostic.changed, 0); assert.equal(again.diagnostic.added, 0);
    assert.equal(fs.statSync(main, { bigint: true }).mtimeNs, before.mtimeNs);
    // A new imported receipt is selected; old compilation source stays stable.
    fs.writeFileSync(path.join(f.repository, "codex-rs/src/main.rs"), 'fn main() { println!("edited"); }\n');
    fs.writeFileSync(path.join(f.repository, "extra.rs"), "added\n");
    const secondRoot = path.join(f.root, "engine-second");
    execute(python, ["-B", path.join(__dirname, "import-engine-source.py"), "--source", f.repository, "--destination", secondRoot]);
    const edited = stable.prepareStableSource({ ...f.options, sourceRoot: secondRoot }); assert.equal(edited.diagnostic.mode, "stable"); assert.ok(edited.diagnostic.changed >= 2); assert.ok(edited.diagnostic.added >= 1);
    const back = stable.prepareStableSource(f.options); assert.ok(back.diagnostic.removed >= 1); assert.equal(fs.existsSync(path.join(back.cwd, "../extra.rs")), false);
    back.verify();
    fs.writeFileSync(main, "tampered"); assert.throws(back.verify, /source changed/);
    assert.throws(() => stable.prepareStableSource(f.options), /ownership\/content changed/);
  } finally { f.close(); }
});
test("changed build scripts, custom build entries, external paths and configuration keep original cwd", () => {
  const f = fixture();
  try {
    const initial = stable.inventory(f.sourceRoot, true);
    for (const name of ["codex-rs/new/build.rs", "codex-rs/.cargo/config.toml"]) {
      const source = structuredClone(initial); source.files[name] = { sha256: "unreviewed" };
      assert.match(stable.supported({ ...f.options, destination: path.join(f.root, "cache/source/engine"), source }), /unreviewed/);
    }
    for (const extra of ['\nbuild="custom.rs"\n', '\n[dependencies]\nexternal={path="../../external"}\n']) {
      const file = path.join(f.sourceRoot, "codex-rs/Cargo.toml"), bytes = fs.readFileSync(file);
      // TOML path/build guard precedes SOURCE validation, so unsupported context
      // retains original execution even if its provenance needs later auditing.
      fs.writeFileSync(file, extra.includes('build=') ? bytes.toString().replace('[workspace]', 'build="custom.rs"\n[workspace]') : bytes + extra);
      const prepared = stable.prepareStableSource(f.options); assert.equal(prepared.cwd, undefined); assert.equal(prepared.diagnostic.mode, "frozen");
      fs.writeFileSync(file, bytes);
    }
  } finally { f.close(); }
});
test("tampering, hardlinks, links, lease conflicts and preparation failures cannot overwrite owned source", () => {
  const f = fixture();
  try {
    const prepared = stable.prepareStableSource(f.options);
    const sourceMain = path.join(f.sourceRoot, "codex-rs/src/main.rs"), link = path.join(f.sourceRoot, "hardlink");
    fs.linkSync(sourceMain, link); assert.throws(() => stable.inventory(f.sourceRoot, true), /Unsafe/); fs.unlinkSync(link);
    const directoryLink = path.join(f.root, "linked-source"); fs.symlinkSync(f.sourceRoot, directoryLink, process.platform === "win32" ? "junction" : "dir");
    assert.throws(() => stable.inventory(directoryLink, true), /Linked/);
    if (process.platform === "win32") fs.rmdirSync(directoryLink); else fs.unlinkSync(directoryLink);
    const moved = path.join(f.root, "replaced"); fs.renameSync(path.join(prepared.cwd, "src"), moved); fs.mkdirSync(path.join(prepared.cwd, "src")); fs.copyFileSync(path.join(moved, "main.rs"), path.join(prepared.cwd, "src/main.rs"));
    assert.throws(prepared.verify, /source changed/);
    f.invalidate(); assert.throws(() => stable.prepareStableSource(f.options), /lease conflict/);
  } finally { f.close(); }
});
test("preparation failure launches no Cargo; post-Cargo mutation preserves actual exit and blocks success publication", context => {
  const f = fixture(); f.close();
  const cache = require("./cargo-shared-cache.cjs"), lifecycle = require("./artifact-lifecycle.cjs");
  const scripts = path.join(f.root, "scripts"); fs.mkdirSync(scripts);
  for (const name of ["cargo-target-owner.cjs", "build-resource-admission.cjs", "cargo-stable-source.cjs", "cargo-shared-cache.cjs", "artifact-lifecycle.cjs", "artifact-observations.cjs", "maintenance-lock-owner.cjs", "maintenance-preferences.cjs", "maintenance-lock-worker.cjs", "maintenance-owner-config.cjs", "engine-provenance.py", "import-engine-source.py", "engine-native-materialization.py", "azrael-platforms.json"]) fs.copyFileSync(path.join(__dirname, name), path.join(scripts, name));
  bootstrapFixtureMaintenance(f.root);
  const managedOwner = require(path.join(scripts, "cargo-target-owner.cjs"));
  const env = { ...f.env, AZRAEL_CARGO_CACHE_PROJECT_ROOT: f.root, AZRAEL_CARGO_CACHE_SCOPE: "stable-source-verification", AZRAEL_CARGO_STABLE_SOURCE: "1" };
  const selection = cache.selectCache({ projectRoot: f.root, sourceRoot: f.sourceRoot, env }); env.CARGO_TARGET_DIR = selection.targetDirectory;
  assertLinkerPath(selection.targetDirectory);
  const targetIdentity = process.platform === "win32" ? selection.targetDirectory.toLowerCase() : selection.targetDirectory;
  const pendingHash = require("node:crypto").createHash("sha256").update(targetIdentity).digest("hex");
  env.INSTA_PENDING_DIR = path.join(f.root, "artifacts/verification/cargo-pending", pendingHash);
  const spec = { command: "cargo", args: ["build", "--offline", "--locked"], cwd: path.join(f.sourceRoot, "codex-rs"), selectedSourceRoot: f.sourceRoot, env, windowsHide: true, encoding: "utf8" };
  const main = path.join(f.sourceRoot, "codex-rs/src/main.rs"), before = fs.readFileSync(main);
  fs.writeFileSync(main, "invalid SOURCE bytes");
  let published = 0;
  const preparation = managedOwner.runManagedCargoSync(spec, { onSuccess() { published++; } });
  assert.equal(preparation.status, null); assert.match(preparation.error.message, /SOURCE validation/); assert.equal(published, 0);
  assert.equal(fs.existsSync(path.join(selection.targetDirectory, ".azrael-cargo-owner")), false);
  assert.equal(fs.existsSync(path.join(selection.directory, "source/engine")), false);
  fs.writeFileSync(main, before);
  const cp = require("node:child_process"), spawn = cp.spawnSync;
  context.mock.method(cp, "spawnSync", (command, args, options) => {
    const result = spawn(command, args, options);
    if (command === "cargo" && args[0] === "build" && result.status === 0) fs.appendFileSync(path.join(options.cwd, "src/main.rs"), "// concurrent writer\n");
    return result;
  });
  const changed = managedOwner.runManagedCargoSync(spec, { onSuccess() { published++; } });
  assert.equal(changed.status, 0, changed.stderr); assert.match(changed.error.message, /source changed/); assert.equal(published, 0);
  assert.equal(fs.existsSync(path.join(selection.targetDirectory, ".azrael-cargo-owner")), false);
  const record = lifecycle.catalog(f.root).find(row => row.id === selection.lifecycleId);
  assert.equal(record.state, "failed"); assert.equal(record.producer.exit_code, null);
  const evidence = JSON.parse(fs.readFileSync(record.producer.evidence_ref, "utf8"));
  assert.equal(evidence.exitCode, 0); assert.match(evidence.sourceVerificationError, /source changed/);
  const pending = lifecycle.catalog(f.root).find(row => row.id === `shared:cargo-pending:${pendingHash}`);
  assert.equal(pending.state, "failed"); assert.equal(pending.producer.exit_code, null);
});
test("real offline managed Cargo preserves locked path dependencies and reports Fresh on second build", () => {
  const f = fixture({ pathDependency: true }); f.close();
  const env = { ...f.env, AZRAEL_CARGO_CACHE_PROJECT_ROOT: f.root, AZRAEL_CARGO_CACHE_SCOPE: "stable-source-verification", AZRAEL_CARGO_STABLE_SOURCE: "1" };
  const selection = require("./cargo-shared-cache.cjs").selectCache({ projectRoot: f.root, sourceRoot: f.sourceRoot, env });
  env.CARGO_TARGET_DIR = selection.targetDirectory;
  assertLinkerPath(selection.targetDirectory);
  const spec = { command: "cargo", args: ["build", "--offline", "--locked", "--verbose"], cwd: path.join(f.sourceRoot, "codex-rs"), selectedSourceRoot: f.sourceRoot, env, windowsHide: true, encoding: "utf8" };
  const first = owner.runManagedCargoSync(spec); assert.equal(first.error, undefined, first.error?.message); assert.equal(first.status, 0, first.stderr);
  const second = owner.runManagedCargoSync(spec); assert.equal(second.error, undefined, second.error?.message); assert.equal(second.status, 0, second.stderr); assert.match(second.stderr, /Fresh stable-probe/);
  const manifest = JSON.parse(fs.readFileSync(path.join(selection.directory, "source/owned.json"), "utf8"));
  assert.equal(manifest.originalProvenance.sourceSha256, stable.provenance(f.sourceRoot, selection.identity.target, env).sourceSha256);
});
test("generic managed invocations preserve caller cwd even with release opt-in present", () => {
  const cwd = fs.mkdtempSync(path.join(base, "cwd-"));
  const env = { ...process.env, CARGO_TARGET_DIR: path.join(cwd, "target"), AZRAEL_CARGO_STABLE_SOURCE: "1" };
  delete env.AZRAEL_CARGO_CACHE_PROJECT_ROOT; delete env.INSTA_PENDING_DIR;
  const result = owner.runManagedCargoSync({ command: process.execPath, args: ["-e", "process.stdout.write(process.cwd())"], cwd, env, encoding: "utf8", windowsHide: true });
  assert.equal(result.error, undefined); assert.equal(result.status, 0); assert.equal(result.stdout, cwd); assert.equal(fs.existsSync(path.join(cwd, "source")), false);
});
