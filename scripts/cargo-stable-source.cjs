"use strict";

// The shared cache owns this entire payload. Callers must hold its physical
// target lease from preparation until verification after Cargo returns.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const digest = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const excluded = new Set([".ruff_cache", "codex-rs/target", "scripts/.venv", "sdk/python/.ruff_cache", "sdk/python/.venv", "sdk/python/__pycache__", "sdk/python/src/openai_codex/generated/__pycache__"]);
// Reviewed in-tree/env/target-only build inputs. Unknown bytes use frozen cwd.
const reviewed = {
  "codex-rs/build-info/build.rs": "1c83341a2b674e920f7d4892ea311c04b9d33f6da0ca9dd9043c1591386d9bdc",
  "codex-rs/bwrap/build.rs": "bf73d9f189163b40bf6c11c83b44bd5ca6f1bdf8af04ff20ab15a1a5fc80ae00",
  "codex-rs/cli/build.rs": "bc69207061b7be1d1193810c627198fd8fe479714d91391ff3ab226434f8e4a0",
  "codex-rs/code-mode-protocol/build.rs": "a8120bde41c0d7dc2573e5b2186dee26e806c498e285139fc9d992a78f45ad6d",
  "codex-rs/linux-sandbox/build.rs": "11f8385d21fcf3fe85959068e4cd19933e505ddaf24e71c35e6498eb434df87b",
  "codex-rs/skills/build.rs": "7f0ac2f5b15585c4e119aa5a651db8860163266ed3857b6b857557dc4f62431d",
  "codex-rs/state/build.rs": "472be6f12791a7938cc3625e97643d50d2f4bb58746e1558a352f14626df8f6d",
  "codex-rs/windows-sandbox-rs/build.rs": "ba915c63edc91606f9088c90b8b6ce9be72e612e5c6aa7f5f9493e56cb4fe48b",
};

function stat(file, directory = false) {
  const s = fs.lstatSync(file, { bigint: true });
  if (s.isSymbolicLink() || (directory ? !s.isDirectory() : !s.isFile() || s.nlink !== 1n)) throw Error(`Unsafe stable source identity: ${file}`);
  return { dev: String(s.dev), ino: String(s.ino), birth: String(s.birthtimeNs), mode: String(s.mode), ...(directory ? {} : { size: String(s.size), mtime: String(s.mtimeNs), ctime: String(s.ctimeNs) }) };
}
function plain(file) {
  for (let p = path.resolve(file); ; p = path.dirname(p)) {
    if (fs.existsSync(p) && fs.lstatSync(p).isSymbolicLink()) throw Error(`Linked stable source path: ${p}`);
    if (p === path.dirname(p)) break;
  }
  return path.resolve(file);
}
function inventory(root, ignoreCaches = false) {
  plain(root);
  const files = {}, directories = {};
  function walk(relative) {
    const directory = path.join(root, relative);
    directories[relative] = stat(directory, true);
    for (const name of fs.readdirSync(directory).sort()) {
      const rel = relative ? `${relative}/${name}` : name;
      if (ignoreCaches && excluded.has(rel)) continue;
      const file = path.join(root, rel), s = fs.lstatSync(file);
      if (s.isDirectory() && !s.isSymbolicLink()) walk(rel);
      else {
        const before = stat(file), bytes = fs.readFileSync(file), after = stat(file);
        if (!same(before, after)) throw Error(`Concurrent source write: ${file}`);
        files[rel] = { sha256: digest(bytes), identity: before };
      }
    }
    if (!same(stat(directory, true), directories[relative])) throw Error(`Source directory replaced: ${directory}`);
  }
  walk("");
  return { files, directories };
}
function provenance(root, target, env) {
  const expression = "import importlib.util,json,sys; s=importlib.util.spec_from_file_location('stable_engine',sys.argv[1]); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); print(json.dumps(m.snapshot(sys.argv[2],sys.argv[3]),sort_keys=True))";
  const result = require("node:child_process").spawnSync(env.AZRAEL_PYTHON || (process.platform === "win32" ? "python" : "python3"), ["-B", "-c", expression, path.toNamespacedPath(path.join(__dirname, "engine-provenance.py")), path.toNamespacedPath(root), target], { env, windowsHide: true, encoding: "utf8" });
  if (result.status !== 0 || result.error || result.signal) throw Error(`Stable source full SOURCE validation failed: ${result.error?.message || result.stderr || result.signal}`);
  return JSON.parse(result.stdout);
}
function ancestorContext(root) {
  const result = [];
  for (let directory = path.dirname(root); ; directory = path.dirname(directory)) {
    for (const name of [".cargo/config", ".cargo/config.toml", "rust-toolchain", "rust-toolchain.toml"]) {
      const file = path.join(directory, name);
      if (fs.existsSync(file)) result.push([plain(file), digest(fs.readFileSync(file)), stat(file)]);
    }
    if (directory === path.dirname(directory)) break;
  }
  return result;
}
function supported({ sourceRoot, destination, args, env, source }) {
  if (!source.files["SOURCE.json"] || source.files[".git"] || source.directories[".git"]) return "imported engine without Git metadata required";
  if (args.some(a => /^(?:--manifest-path|--config)(?:=|$)/.test(a))) return "path-sensitive Cargo argument";
  const searchPath = Object.entries(env).find(([name]) => name.toLowerCase() === "path")?.[1];
  if (!searchPath || searchPath.split(path.delimiter).some(entry => !entry || !path.isAbsolute(entry))) return "relative or empty executable PATH entry";
  // Relative paths in arbitrary environment variables cannot be rebased safely.
  for (const [key, value] of Object.entries(env)) {
    if (/^(?:RUSTC|RUSTC_WRAPPER|RUSTC_WORKSPACE_WRAPPER|RUSTUP_TOOLCHAIN|CARGO_HOME|RUSTUP_HOME|RUSTY_V8_.*PATH|CODEX_BWRAP_SOURCE_DIR)$/.test(key) && value && /[\\/]/.test(value) && !path.isAbsolute(value)) return `relative build environment path: ${key}`;
    if (/^(?:RUSTFLAGS|CARGO_ENCODED_RUSTFLAGS|CARGO_BUILD_RUSTFLAGS|CARGO_TARGET_.*_(?:RUSTFLAGS|LINKER|RUNNER))$/.test(key) && value && /[\\/]/.test(value)) return `unreviewed path-sensitive build flags: ${key}`;
  }
  if (!same(ancestorContext(sourceRoot), ancestorContext(destination))) return "effective ancestor Cargo configuration or toolchain differs";
  for (const [name, entry] of Object.entries(source.files)) {
    const lookup = process.platform === "win32" ? name.toLowerCase() : name;
    if (lookup.endsWith("/build.rs") && reviewed[name] !== entry.sha256) return `unreviewed build script: ${name}`;
    if (/^(?:codex-rs\/)?\.cargo\/(?:config|config.toml)$/.test(lookup) && entry.sha256 !== reviewedConfigs[name]) return `unreviewed Cargo configuration: ${name}`;
  }
  return null;
}
function manifestContext(sourceRoot, source, env) {
  // Parse using the installed Python standard library instead of guessing TOML
  // syntax. External path dependencies and custom build entry points fall back.
  const expression = `import json,pathlib,sys,tomllib
root=pathlib.Path(sys.argv[1]).resolve()
reason=None
def inspect(value, parent):
 global reason
 if isinstance(value,dict):
  for key,item in value.items():
   if key=='path' and isinstance(item,str) and (pathlib.Path(item).is_absolute() or not (parent/item).resolve().is_relative_to(root)): reason='external or absolute manifest path input'
   if key in ('members','default-members','exclude') and isinstance(item,list):
    for member in item:
     if isinstance(member,str) and (pathlib.Path(member).is_absolute() or not (parent/member).resolve().is_relative_to(root)): reason='external or absolute workspace member'
   inspect(item,parent)
 elif isinstance(value,list):
  for item in value: inspect(item,parent)
for name in json.loads(sys.stdin.read()):
 file=root/name
 data=tomllib.loads(file.read_text(encoding='utf-8'))
 build=data.get('package',{}).get('build',True)
 if build not in (True,False,'build.rs'): reason='custom build script entry point'
 inspect(data,file.parent)
print(json.dumps(reason))`;
  const result = require("node:child_process").spawnSync(env.AZRAEL_PYTHON || (process.platform === "win32" ? "python" : "python3"), ["-B", "-c", expression, path.toNamespacedPath(sourceRoot)], { env, input: JSON.stringify(Object.keys(source.files).filter(name => /(?:^|\/)Cargo.toml$/.test(name) || /(?:^|\/)rust-toolchain.toml$/.test(name))), windowsHide: true, encoding: "utf8" });
  if (result.error || result.signal || result.status !== 0) return "cannot establish manifest path semantics with installed TOML parser";
  const reason = JSON.parse(result.stdout);
  return typeof reason === "string" ? reason : reason === null ? null : "cannot establish manifest path semantics";
}
// Filled with the exact reviewed flags-only configuration, never a TOML rewrite.
const reviewedConfigs = {
  ".cargo/config.toml": "eb1349431a24f07390c70898c240fba3e52d15c365f7ad95fa16828714dc9282",
  "codex-rs/.cargo/config.toml": "adc1b9fa038d4bca7d7cbae2139f8e22d7a8e9956ec4f723956055350ed07e2b",
};

function prepareStableSource({ sourceRoot, cacheDirectory, target, args, env, assertLease }) {
  const started = performance.now();
  sourceRoot = plain(sourceRoot);
  const destination = plain(path.join(cacheDirectory, "source/engine"));
  const manifest = plain(path.join(cacheDirectory, "source/owned.json"));
  assertLease();
  const source = inventory(sourceRoot, true);
  const reason = supported({ sourceRoot, destination, args, env, source }) || manifestContext(sourceRoot, source, env);
  if (reason) return { diagnostic: { mode: "frozen", reason, sourceRoot, durationMs: performance.now() - started } };
  const originalProvenance = provenance(sourceRoot, target, env);
  if (!same(source, inventory(sourceRoot, true))) throw Error("Selected source changed during full validation");
  let previous, previousManifest;
  if (fs.existsSync(destination) || fs.existsSync(manifest)) {
    previousManifest = inventoryEntry(path.dirname(manifest), path.basename(manifest));
    previous = JSON.parse(fs.readFileSync(manifest, "utf8"));
    if (previous.schema !== 1 || !same(previous.inventory, inventory(destination))) throw Error("Stable source ownership/content changed");
  }
  assertLease();
  fs.mkdirSync(destination, { recursive: true });
  const ownedDirectories = { ...(previous?.inventory.directories || { "": stat(destination, true) }) };
  const parents = name => {
    let rel = "";
    for (const part of ["", ...name.split("/").slice(0, -1)]) {
      rel = part ? (rel ? `${rel}/${part}` : part) : rel;
      const directory = path.join(destination, rel);
      if (ownedDirectories[rel]) {
        if (!same(ownedDirectories[rel], stat(directory, true))) throw Error("Stable source parent identity changed");
      } else {
        fs.mkdirSync(directory); ownedDirectories[rel] = stat(directory, true);
      }
    }
  };
  const counts = { unchanged: 0, added: 0, changed: 0, removed: 0 };
  for (const [name, entry] of Object.entries(previous?.inventory.files || {})) {
    if (source.files[name]) continue;
    parents(name);
    if (!same(entry, inventoryEntry(destination, name))) throw Error("Stable removal identity changed");
    assertLease(); fs.unlinkSync(path.join(destination, name)); counts.removed++;
  }
  for (const [name, entry] of Object.entries(source.files)) {
    const old = previous?.inventory.files[name];
    if (old && old.sha256 === entry.sha256 && old.identity.mode === entry.identity.mode) { counts.unchanged++; continue; }
    assertLease();
    const file = path.join(destination, name);
    parents(name);
    if (old && !same(old, inventoryEntry(destination, name))) throw Error("Stable write identity changed");
    const before = stat(path.join(sourceRoot, name)), bytes = fs.readFileSync(path.join(sourceRoot, name));
    if (!same(before, entry.identity) || !same(before, stat(path.join(sourceRoot, name))) || digest(bytes) !== entry.sha256) throw Error("Selected source changed before copy");
    const fd = fs.openSync(file, old ? "r+" : "wx");
    try {
      const opened = fs.fstatSync(fd, { bigint: true });
      if (old && (String(opened.ino) !== old.identity.ino || String(opened.dev) !== old.identity.dev || opened.nlink !== 1n)) throw Error("Stable opened identity changed");
      fs.writeFileSync(fd, bytes); fs.ftruncateSync(fd, bytes.length);
      fs.fchmodSync(fd, Number(BigInt(entry.identity.mode) & 0o777n));
    } finally { fs.closeSync(fd); }
    counts[old ? "changed" : "added"]++;
  }
  if (!same(source, inventory(sourceRoot, true))) throw Error("Selected source changed during stable copy");
  const copied = inventory(destination);
  if (!same(originalProvenance, provenance(destination, target, env))) throw Error("Copied SOURCE provenance differs");
  const bytes = JSON.stringify({ schema: 1, inventory: copied, originalProvenance });
  // Failed preparation never promotes partial payload as owned reusable source.
  if (previous) {
    if (!same(previousManifest, inventoryEntry(path.dirname(manifest), path.basename(manifest)))) throw Error("Stable ownership manifest changed during preparation");
    fs.writeFileSync(manifest, bytes);
  }
  else fs.writeFileSync(manifest, bytes, { flag: "wx" });
  const manifestEntry = inventoryEntry(path.dirname(manifest), path.basename(manifest));
  const context = ancestorContext(sourceRoot);
  const verify = () => {
    assertLease();
    if (!same(source, inventory(sourceRoot, true)) || !same(copied, inventory(destination)) || !same(manifestEntry, inventoryEntry(path.dirname(manifest), path.basename(manifest)))) throw Error("Cargo source changed during execution");
    if (!same(context, ancestorContext(sourceRoot)) || !same(context, ancestorContext(destination))) throw Error("Cargo effective context changed during execution");
    if (!same(originalProvenance, provenance(sourceRoot, target, env)) || !same(originalProvenance, provenance(destination, target, env))) throw Error("Cargo full source provenance changed during execution");
  };
  verify();
  return { cwd: path.join(destination, "codex-rs"), verify, diagnostic: { mode: "stable", sourceRoot, compilationSourceRoot: destination, sourceSha256: originalProvenance.sourceSha256, target, ...counts, durationMs: performance.now() - started } };
}
function inventoryEntry(root, name) {
  const file = path.join(root, name), identity = stat(file), bytes = fs.readFileSync(file);
  if (!same(identity, stat(file))) throw Error("Source changed while inspecting owned entry");
  return { sha256: digest(bytes), identity };
}
module.exports = { prepareStableSource, inventory, supported, provenance };
