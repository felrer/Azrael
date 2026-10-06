"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { getDirectoryState } = require("./directory-state.cjs");

const digest = value => crypto.createHash("sha256").update(value).digest("hex");
const readJson = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
async function fileHash(file) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
function writeJson(file, value) {
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n");
  fs.renameSync(temporary, file);
}
async function inputs(config) {
  const scripts = [
    "preparation-state.cjs", "directory-state.cjs", "prepare-independent-vscode.ps1",
    "prepare-ordinary-vscode.ps1", "prepare-official-ui.ps1", "engine-provenance.py",
    "ordinary-runtime.cjs", "devin-native-host.cjs", "provider-accounts-host.cjs",
    "integrated-azrael-entry.cjs", "sync-shared-environment.cjs", "sync-codex-environment.cjs", "computer-use-runtime.cjs",
    "azrael-recovery.cjs", "recovery-state.cjs", "package-local-host.cjs", "computer-use-approvals.cjs",
    "use-control-settings.cjs", "window-use-approvals.cjs", "use-settings-host.cjs", "sky-control-policy.mjs", "sky-controlled-service.mjs", "inject-sky-control-policy.cjs", "computer-use-branding.cjs", "window-control-runtime.cjs",
    "feature-preservation.cjs", "azrael-feature-contracts.json",
  ];
  const { getTransformRules } = require("./namespace-azrael-host.cjs");
  const hashes = Object.fromEntries(await Promise.all(scripts.map(async name =>
    [name, await fileHash(path.join(__dirname, name))])));
  const build = readJson(path.join(config.release, "build-info.json"));
  const bundle = Object.fromEntries(await Promise.all(Object.keys(build.sha256).sort().map(async name => {
    const actual = await fileHash(path.join(config.release, name));
    if (actual !== build.sha256[name].toLowerCase()) throw new Error(`Release hash mismatch: ${name}`);
    return [name, actual];
  })));
  const toolFiles = ["companion/node_modules/typescript/lib/typescript.js",
    "companion/node_modules/@vscode/vsce/out/package.js",
    "companion/node_modules/@vscode/vsce/out/secretLint.js"];
  const tools = Object.fromEntries(await Promise.all(toolFiles.map(async name =>
    [name, await fileHash(path.join(config.toolDirectory, name))])));
  return { schema: 1, config, scripts: hashes, transformRules: getTransformRules(), tools,
    build: await fileHash(path.join(config.release, "build-info.json")), bundle,
    source: await getDirectoryState(config.source),
    devin: config.devinExecutable ? await fileHash(config.devinExecutable) : null };
}
async function initialize(output, config, resume) {
  const file = path.join(output, "preparation-state.json");
  const current = await inputs(config);
  const inputSha256 = digest(JSON.stringify(current));
  if (resume) {
    const previous = readJson(file);
    if (previous.schema !== 1 || previous.inputSha256 !== inputSha256) {
      throw new Error("Preparation inputs changed. Use a new OutputDirectory.");
    }
    return previous;
  }
  const state = { schema: 1, inputSha256, inputs: current, stages: {} };
  writeJson(file, state);
  return state;
}
function checkpointFile(output) { return path.join(output, "preparation-state.json"); }
async function save(output, stage, data) {
  const file = checkpointFile(output);
  const state = readJson(file);
  const entry = { data };
  if (stage === "namespace") entry.directory = await getDirectoryState(data.prepared.OfficialExtension);
  else if (stage === "complete") {
    entry.hostSha256 = await fileHash(data.HostVsix);
    entry.manifestSha256 = await fileHash(path.join(output, "independent-prepared.json"));
  } else throw new Error("Unknown preparation stage.");
  state.stages[stage] = entry;
  writeJson(file, state);
}
async function load(output, stage) {
  const state = readJson(checkpointFile(output));
  const entry = state.stages[stage];
  if (!entry) return { found: false };
  if (stage === "namespace") {
    const current = await getDirectoryState(entry.data.prepared.OfficialExtension);
    if (current.sha256 !== entry.directory.sha256) throw new Error("Completed namespace stage changed. Use a new OutputDirectory.");
  } else if (stage === "complete") {
    if (await fileHash(entry.data.HostVsix) !== entry.hostSha256 ||
        await fileHash(path.join(output, "independent-prepared.json")) !== entry.manifestSha256) {
      throw new Error("Completed package changed. Use a new OutputDirectory.");
    }
  } else throw new Error("Unknown preparation stage.");
  return { found: true, data: entry.data };
}
module.exports = { initialize, save, load, inputs };
if (require.main === module) {
  const [command, output, argument, extra] = process.argv.slice(2);
  (async () => {
    if (command === "init") await initialize(output, readJson(argument), extra === "true");
    else if (command === "save") await save(output, argument, readJson(extra));
    else if (command === "load") console.log(JSON.stringify(await load(output, argument)));
    else throw new Error("Unknown preparation checkpoint command.");
  })().catch(error => { console.error(error.message); process.exitCode = 1; });
}
