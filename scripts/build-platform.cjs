"use strict";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const { resolvePlatform, platformIdentity, engineBinaryNames, executableName } = require("./platform-runtime.cjs");
const { hash, copyTree, inventoryTree, freezeProject } = require("./freeze-platform-inputs.cjs");
const UPSTREAM = "9f7397ed1582d95c6c1fcf4ae9951213b3fa2d19";
function assertEngineVersion(declared, reported) {
  if (!/^\d+\.\d+\.\d+(?:[-.][\w.-]+)?$/.test(declared)) throw new Error("Frozen Cargo workspace has no valid engine version");
  const match = /^codex(?:-cli)?\s+(\d+\.\d+\.\d+(?:[-.][\w.-]+)?)\s*$/.exec(reported);
  if (!match || match[1] !== declared) throw new Error(`Built engine version does not match frozen Cargo workspace version ${declared}`);
  return declared;
}
function validateToolIdentity(value, expected, label) {
  let identity;
  try { identity = JSON.parse(value); } catch { throw new Error(`${label} did not report a valid native platform identity`); }
  if (!identity || identity.os !== expected.os || identity.arch !== expected.arch) throw new Error(`${label} platform ${identity?.os}/${identity?.arch} does not match ${expected.os}/${expected.arch}`);
}
function validateExecutableHeader(file, identity) {
  const fd = fs.openSync(file, "r");
  function read(length, offset = 0) {
    const value = Buffer.alloc(length);
    if (fs.readSync(fd, value, 0, length, offset) !== length) throw new Error("Executable header is truncated");
    return value;
  }
  try {
    const head = read(64);
    let matches = false;
    if (identity.os === "linux") matches = head.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) && head[4] === 2 && head[5] === 1 && head[6] === 1 && [0, 3].includes(head[7]) && [2, 3].includes(head.readUInt16LE(16)) && head.readUInt32LE(20) === 1 && head.readUInt16LE(18) === 62 && identity.arch === "x64";
    if (identity.os === "darwin") matches = head.readUInt32LE(0) === 0xfeedfacf && head.readUInt32LE(4) === 0x0100000c && head.readUInt32LE(12) === 2 && identity.arch === "arm64";
    if (identity.os === "win32" && head.readUInt16LE(0) === 0x5a4d) {
      const pe = read(26, head.readUInt32LE(60));
      matches = pe.readUInt32LE(0) === 0x00004550 && pe.readUInt16LE(4) === 0x8664 && pe.readUInt16LE(24) === 0x20b && identity.arch === "x64";
    }
    if (!matches) throw new Error(`Imported executable header does not match native ${identity.os}/${identity.arch}; universal executables require explicit supported inspection`);
  } finally { fs.closeSync(fd); }
}
function parse(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === "--plan") { result.plan = true; continue; }
    if (!/^--(?:project-root|engine-source|ui-root|account-ui-root|code-mode-host|node|bun|npm-cli|rg|output|target-directory|target|host-version)$/.test(key) || !argv[i + 1] || argv[i + 1].startsWith("--")) throw new Error(`Invalid build argument: ${key}`);
    if (result[key.slice(2)] !== undefined) throw new Error(`Duplicate build argument: ${key}`);
    result[key.slice(2)] = argv[++i];
  }
  return result;
}
function validateV8Inputs(options, environment = process.env) {
  if (options["code-mode-host"]) return;
  const overrides = ["RUSTY_V8_ARCHIVE", "RUSTY_V8_MIRROR", "RUSTY_V8_SRC_BINDING_PATH"].filter(key => environment[key]);
  if (overrides.length) throw new Error(`Source-built code-mode host cannot use unselected external V8 inputs: ${overrides.join(", ")}. The current CLI cannot freeze these overrides; unset them or select --code-mode-host with an imported native binary.`);
}
function buildPlan(options, platform = process.platform, arch = process.arch, environment = process.env) {
  const descriptor = resolvePlatform(platform, arch);
  if (options.target && options.target !== descriptor.target) throw new Error(`Native-only build: ${platform}/${arch} cannot build ${options.target}`);
  if (platform === "linux" && process.platform === "linux" && !process.report.getReport().header.glibcVersionRuntime) throw new Error("Linux builds require GNU/glibc; musl is unsupported.");
  validateV8Inputs(options, environment);
  const root = options["project-root"] || path.resolve(__dirname, "..");
  const settings = { ...options, "project-root": root, "engine-source": options["engine-source"] || path.join(root, "engine"), node: options.node || process.execPath };
  for (const key of ["project-root", "engine-source", "ui-root", "node", "bun", "output", "target-directory"]) {
    if (!settings[key] || !path.isAbsolute(settings[key])) throw new Error(`--${key} must be an absolute path`);
  }
  for (const key of ["account-ui-root", "npm-cli", "code-mode-host", "rg"]) if (settings[key] && !path.isAbsolute(settings[key])) throw new Error(`--${key} must be absolute`);
  if (fs.existsSync(settings.output)) throw new Error("--output must be a new path; existing releases cannot be overwritten");
  if (!fs.statSync(settings["target-directory"]).isDirectory()) throw new Error("--target-directory must be an existing selected native Cargo cache");
  return { settings, platform: platformIdentity(descriptor), binaries: engineBinaryNames(descriptor), descriptor, engineReuse: false };
}
function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n"); }
function linuxPtyBuild(platform, input, companion) {
  if (platform.os !== "linux") return null;
  const headers = path.join(input, "node-headers");
  const nodeGyp = path.join(input, "npm/node_modules/node-gyp/bin/node-gyp.js");
  for (const file of [nodeGyp, path.join(headers, "include/node/node.h"), path.join(headers, "include/node/node_version.h")]) {
    if (!fs.existsSync(file)) throw new Error("Linux node-pty requires frozen selected Node headers and npm node-gyp: " + file);
  }
  return { args: [nodeGyp, "rebuild", "--nodedir=" + headers], cwd: path.join(companion, "node_modules/node-pty") };
}
async function build(options) {
  const plan = buildPlan(options), s = plan.settings, root = s["project-root"], identity = plan.platform;
  if (s.plan) return plan;
  const input = s.output + ".inputs";
  const work = s.output + ".work";
  if (fs.existsSync(input) || fs.existsSync(work)) throw new Error("Task input/work path already exists; choose a new output identity");
  const logs = path.join(root, "artifacts/logs/multi-platform/build", path.basename(s.output));
  fs.mkdirSync(logs, { recursive: true });
  let sequence = 0;
  function run(executable, args, cwd, label, env = {}) {
    const log = path.join(logs, `${String(++sequence).padStart(2, "0")}-${label}.log`);
    const fd = fs.openSync(log, "w");
    let result;
    try { result = spawnSync(executable, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", fd, fd], windowsHide: true }); }
    finally { fs.closeSync(fd); }
    if (result.error || result.status !== 0) throw new Error(`${label} failed (${result.status}): ${result.error?.message || log}`);
    return fs.readFileSync(log, "utf8").trim();
  }
  const python = process.platform === "win32" ? "python" : "python3";
  run(python, ["-B", "-c", 'import sys; assert sys.version_info >= (3, 11), "Native producer requires Python 3.11 or newer (tomllib and hashlib.file_digest)"; import tomllib, hashlib; assert callable(hashlib.file_digest); print(sys.version)'], root, "python-prerequisites");
  const provenance = path.join(root, "scripts/engine-provenance.py");
  const originalSnapshot = path.join(logs, "engine-original.json");
  run(python, ["-B", provenance, "snapshot", "--root", s["engine-source"], "--target", identity.target, "--file", originalSnapshot], root, "validate-original-engine");
  const projectReceipt = await freezeProject(root, path.join(input, "project"));
  copyTree(s["engine-source"], path.join(input, "engine"));
  // Git engines need their own Git metadata for the unchanged existing fingerprint contract.
  const gitMetadata = path.join(s["engine-source"], ".git");
  if (!fs.existsSync(path.join(input, "engine/SOURCE.json"))) {
    if (!fs.statSync(gitMetadata).isDirectory()) throw new Error("Git engine snapshots require a standalone Git checkout; imported SOURCE.json is preferred");
    fs.cpSync(gitMetadata, path.join(input, "engine/.git"), { recursive: true });
  }
  copyTree(s["ui-root"], path.join(input, "ui"), []);
  if (s["account-ui-root"]) copyTree(s["account-ui-root"], path.join(input, "account-ui"), []);
  for (const key of ["node", "bun", "code-mode-host", "rg"]) if (s[key]) copyTree(s[key], path.join(input, "tools", key + plan.descriptor.executableSuffix));
  const npmCli = s["npm-cli"] || [path.join(path.dirname(s.node), "node_modules/npm/bin/npm-cli.js"), path.resolve(path.dirname(s.node), "../lib/node_modules/npm/bin/npm-cli.js")].find(fs.existsSync);
  if (!npmCli) throw new Error("Selected Node's npm CLI is missing; provide --npm-cli");
  copyTree(path.resolve(path.dirname(npmCli), ".."), path.join(input, "npm"), []);
  if (identity.os === "linux") {
    const nodeInclude = path.resolve(path.dirname(s.node), "../include/node");
    if (!fs.existsSync(path.join(nodeInclude, "node.h"))) throw new Error("Selected Linux Node distribution must include its native headers");
    copyTree(nodeInclude, path.join(input, "node-headers/include/node"), []);
  }
  const frozenProject = path.join(input, "project"), frozenEngine = path.join(input, "engine"), frozenProvenance = path.join(frozenProject, "scripts/engine-provenance.py");
  const sourceSnapshot = path.join(logs, "engine-frozen.json");
  run(python, ["-B", frozenProvenance, "snapshot", "--root", frozenEngine, "--target", identity.target, "--file", sourceSnapshot], root, "verify-frozen-engine");
  if (fs.readFileSync(originalSnapshot, "utf8") !== fs.readFileSync(sourceSnapshot, "utf8")) throw new Error("Engine changed while freezing source inputs");
  const receipt = inventoryTree(input);
  write(path.join(logs, "immutable-inputs.json"), { schema: 1, platform: identity, inputDirectory: input, project: projectReceipt, ...receipt });
  fs.mkdirSync(work); copyTree(frozenProject, path.join(work, "project"), []); copyTree(frozenEngine, path.join(work, "engine"), []);
  const node = path.join(input, "tools", "node" + plan.descriptor.executableSuffix), bun = path.join(input, "tools", "bun" + plan.descriptor.executableSuffix);
  const nodeVersion = run(node, ["--version"], work, "node-version");
  const identityExpression = 'JSON.stringify({os:process.platform,arch:process.arch})';
  validateToolIdentity(run(node, ["-p", identityExpression], work, "node-platform"), identity, "Selected Node");
  const [major, minor] = nodeVersion.replace(/^v/, "").split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 18)) throw new Error("Native Devin requires Node 22.18 or newer");
  if (run(bun, ["--version"], work, "bun-version") !== "1.4.2") throw new Error("Pinned Bun 1.4.2 is required");
  validateToolIdentity(run(bun, ["--eval", `console.log(${identityExpression})`], work, "bun-platform"), identity, "Selected Bun");
  if (s["code-mode-host"]) validateExecutableHeader(path.join(input, "tools", "code-mode-host" + plan.descriptor.executableSuffix), identity);
  const rust = path.join(work, "engine/codex-rs");
  const cargoArgs = ["build", "--release", "--locked", "--target", identity.target, "--target-dir", s["target-directory"], "-p", "codex-cli", "--bin", "codex", "-p", "codex-app-server-client", "--bin", "azrael-bridge"];
  if (!s["code-mode-host"]) cargoArgs.push("-p", "codex-code-mode-host", "--bin", "codex-code-mode-host");
  run("cargo", cargoArgs, rust, "cargo-engine");
  const compiledSourceSnapshot = path.join(logs, "engine-compiled-source.json");
  run(python, ["-B", frozenProvenance, "snapshot", "--root", path.join(work, "engine"), "--target", identity.target, "--file", compiledSourceSnapshot], work, "verify-compiled-source");
  if (fs.readFileSync(compiledSourceSnapshot, "utf8") !== fs.readFileSync(sourceSnapshot, "utf8")) throw new Error("Compiled engine source differs from frozen inputs");
  fs.mkdirSync(path.join(s.output, "engine"), { recursive: true });
  for (const name of plan.binaries) copyTree(name === plan.binaries[2] && s["code-mode-host"] ? path.join(input, "tools", "code-mode-host" + plan.descriptor.executableSuffix) : path.join(s["target-directory"], identity.target, "release", name), path.join(s.output, "engine", name));
  const recordArgs = ["-B", frozenProvenance, "record", "--root", frozenEngine, "--target", identity.target, "--file", sourceSnapshot, "--engine-dir", path.join(s.output, "engine")];
  if (s["code-mode-host"]) recordArgs.push("--code-mode-host-source", path.join(input, "tools", "code-mode-host" + plan.descriptor.executableSuffix), "--code-mode-host-original", s["code-mode-host"], "--code-mode-host-original-sha256", hash(path.join(input, "tools", "code-mode-host" + plan.descriptor.executableSuffix)));
  else recordArgs.push("--code-mode-host-built");
  run(python, recordArgs, work, "record-engine");
  const declaredVersion = run(python, ["-c", 'import pathlib,sys,tomllib; print(tomllib.loads(pathlib.Path(sys.argv[1]).read_text())["workspace"]["package"]["version"])', path.join(frozenEngine, "codex-rs/Cargo.toml")], work, "declared-engine-version");
  const engineVersion = assertEngineVersion(declaredVersion, run(path.join(s.output, "engine", plan.binaries[0]), ["--version"], work, "built-engine-version"));
  const companion = path.join(work, "project/extensions/azrael-ex");
  const toolEnv = { PATH: path.dirname(node) + path.delimiter + process.env.PATH, npm_node_execpath: node };
  run(node, [path.join(input, "npm/bin/npm-cli.js"), "ci", "--ignore-scripts"], companion, "companion-npm-ci", toolEnv);
  const ptyBuild = linuxPtyBuild(identity, input, companion);
  if (ptyBuild) {
    const header = fs.readFileSync(path.join(input, "node-headers/include/node/node_version.h"), "utf8");
    const headerVersion = ["MAJOR", "MINOR", "PATCH"].map(part => header.match(new RegExp("#define NODE_" + part + "_VERSION\\s+(\\d+)"))?.[1]).join(".");
    if ("v" + headerVersion !== nodeVersion) throw new Error("Frozen Node headers do not match the selected Node version");
    run(node, ptyBuild.args, ptyBuild.cwd, "companion-linux-node-pty", { ...toolEnv, PYTHONDONTWRITEBYTECODE: "1" });
  }
  run(node, [path.join(companion, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.json"], companion, "companion-typescript", toolEnv);
  run(node, [path.join(companion, "scripts/stage-platform-runtime.cjs")], companion, "companion-platform-module", toolEnv);
  copyTree(path.join(companion, "dist"), path.join(s.output, "companion/dist"));
  copyTree(path.join(frozenProject, "providers/devin"), path.join(s.output, "providers/devin"));
  copyTree(node, path.join(s.output, "runtime/node", executableName("node", plan.descriptor)));
  copyTree(path.join(frozenEngine, "codex-rs/models-manager/models.json"), path.join(s.output, "scripts/devin-catalog.json"));
  const provider = path.join(work, "project/providers/opencodex");
  const vendorSha = require(path.join(frozenProject, "scripts/provider-vendor-manifest.cjs")).vendorSourceManifest(path.join(provider, "vendor/src"));
  run(bun, ["install", "--frozen-lockfile", "--production", "--ignore-scripts"], provider, "opencodex-install");
  const providerOut = path.join(s.output, "providers/opencodex"); fs.mkdirSync(providerOut, { recursive: true });
  for (const name of ["helper", "inference"]) run(bun, ["build", path.join(provider, name + ".ts"), "--target=bun", "--external=@napi-rs/keyring", "--outfile=" + path.join(providerOut, name + ".js")], provider, "opencodex-" + name);
  for (const name of fs.readdirSync(provider)) if (/\.(ts|mjs)$/.test(name) || ["package.json", "bun.lock", "LICENSE.opencodex", "UPSTREAM.md", "vendor-source-manifest.json"].includes(name)) copyTree(path.join(provider, name), path.join(providerOut, name));
  const nativeKeyring = { win32: "keyring-win32-x64-msvc", linux: "keyring-linux-x64-gnu", darwin: "keyring-darwin-arm64" }[identity.os];
  for (const name of ["keyring", nativeKeyring]) copyTree(path.join(provider, "node_modules/@napi-rs", name), path.join(providerOut, "node_modules/@napi-rs", name));
  const bunRelative = "providers/opencodex/runtime/" + executableName("bun", plan.descriptor);
  copyTree(bun, path.join(s.output, bunRelative));
  function filesAt(relative) { return Object.fromEntries(inventoryTree(path.join(s.output, relative)).files.map(file => [relative + "/" + file.path, file.sha256])); }
  write(path.join(s.output, "devin-native-build.json"), { schema: 1, platform: identity, mode: "opt-in", model: "devin/swe-2-high", upstreamRevision: UPSTREAM, node: { path: path.join(s.output, "runtime/node", executableName("node", plan.descriptor)), version: nodeVersion, sha256: hash(node), bundled: true }, files: { ...filesAt("providers/devin"), "scripts/devin-catalog.json": hash(path.join(s.output, "scripts/devin-catalog.json")) } });
  write(path.join(s.output, "opencodex-accounts-build.json"), { schema: 2, platform: identity, upstreamRevision: UPSTREAM, vendorSourceManifestSha256: vendorSha, helper: "providers/opencodex/helper.js", inferenceHelper: "providers/opencodex/inference.js", bun: { version: "1.4.2", path: bunRelative, sha256: hash(bun), bundled: true }, files: filesAt("providers/opencodex") });
  fs.mkdirSync(path.join(s.output, "host/out"), { recursive: true });
  for (const name of ["ordinary-runtime.cjs", "platform-runtime.cjs", "azrael-platforms.json", "devin-native-host.cjs", "provider-accounts-host.cjs"]) copyTree(path.join(frozenProject, "scripts", name), path.join(s.output, "host/out", name === "ordinary-runtime.cjs" ? "azrael-runtime.cjs" : name));
  write(path.join(s.output, "host/out/azrael-runtime.json"), { schema: 1, platform: identity, engine: path.join(s.output, "engine", plan.binaries[0]), bridge: path.join(s.output, "engine", plan.binaries[1]), engineVersion, codexHome: path.join(os.homedir(), ".azrael-ex"), devinNative: { releaseDirectory: s.output }, providerAccounts: { releaseDirectory: s.output } });
  const engineProvenance = JSON.parse(fs.readFileSync(path.join(s.output, "engine/azrael-engine-build.json"), "utf8"));
  write(path.join(s.output, "build-info.json"), { platform: identity, engineVersion, sha256: Object.fromEntries(inventoryTree(s.output).files.map(file => [file.path, file.sha256])), engineProvenance, engineIncludesLocalChanges: true, engineSourceRoot: frozenEngine, inputSha256: receipt.sha256 });
  if (inventoryTree(input).sha256 !== receipt.sha256) throw new Error("Frozen build inputs changed during compilation");
  const prepareArgs = [path.join(frozenProject, "scripts/prepare-platform-host.cjs"), "--release", s.output, "--ui-root", path.join(input, "ui"), "--account-ui-root", s["account-ui-root"] ? path.join(input, "account-ui") : companion, "--output", path.join(s.output, "prepared-host"), "--host-version", s["host-version"] || "0.1.0"];
  if (s.rg) prepareArgs.push("--rg", path.join(input, "tools", "rg" + plan.descriptor.executableSuffix));
  run(node, prepareArgs, work, "prepare-host");
  if (inventoryTree(input).sha256 !== receipt.sha256) throw new Error("Frozen build inputs changed during host preparation");
  write(path.join(logs, "result.json"), { exitCode: 0, release: s.output, inputs: input, work, platform: identity, inputSha256: receipt.sha256 });
  return { release: s.output, inputs: input, work, logs, platform: identity };
}
if (require.main === module) build(parse(process.argv.slice(2))).then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { parse, buildPlan, build, validateToolIdentity, validateExecutableHeader, assertEngineVersion, validateV8Inputs, linuxPtyBuild };
