"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { getDirectoryState } = require("./directory-state.cjs");
const { getUiSourceState } = require("./ui-source-state.cjs");

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
async function inputs(config, uiSourceObservation) {
  const scripts = [
    "persisted-atoms.cjs",
    "preparation-state.cjs", "module-cache-consumers.cjs", "directory-state.cjs", "ui-source-state.cjs", "project-source-state.cjs", "source-observation.cjs", "engine-source-metadata.cjs", "prepare-independent-vscode.ps1", "azrael-app-release.json",
    "prepare-ordinary-vscode.ps1", "prepare-official-ui.ps1", "engine-provenance.py",
    "ordinary-runtime.cjs", "shared-engine-host.cjs", "devin-native-host.cjs", "provider-accounts-host.cjs",
    "integrated-azrael-entry.cjs", "sync-shared-environment.cjs", "sync-codex-environment.cjs", "computer-use-runtime.cjs",
    "azrael-recovery.cjs", "recovery-state.cjs", "optional-diagnostics.cjs", "package-local-host.cjs",
    "use-control-settings.cjs", "window-use-approvals.cjs", "use-settings-host.cjs", "window-control-runtime.cjs",
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
    "companion/node_modules/@vscode/vsce/out/secretLint.js",
    "companion/package-lock.json",
    "companion/node_modules/azrael-yazl/package.json",
    "companion/node_modules/azrael-yazl/index.js",
    "companion/node_modules/azrael-yazl/node_modules/buffer-crc32/package.json",
    "companion/node_modules/azrael-yazl/node_modules/buffer-crc32/index.js"];
  const tools = Object.fromEntries(await Promise.all(toolFiles.map(async name =>
    [name, await fileHash(path.join(config.toolDirectory, name))])));
  return { schema: 1, config, scripts: hashes, transformRules: getTransformRules(), tools,
    build: await fileHash(path.join(config.release, "build-info.json")), bundle,
    source: await getUiSourceState(config.source, uiSourceObservation),
    devin: config.devinExecutable ? await fileHash(config.devinExecutable) : null };
}
async function initialize(output, config, resume, uiSourceObservation) {
  const file = path.join(output, "preparation-state.json");
  const current = await inputs(config, uiSourceObservation);
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
async function releaseTools(output, projectRoot, { cacheInvalidation } = {}) {
  const checkpoint = checkpointFile(output);
  const state = readJson(checkpoint);
  const completed = await load(output, "complete");
  if (!completed.found) throw new Error("Completed package required before releasing preparation tools.");
  const config = state.inputs.config;
  if (path.resolve(completed.data.ReleaseDirectory) !== path.resolve(config.release)) throw new Error("Prepared release identity changed.");
  const key = path.basename(config.toolDirectory);
  if (!/^[a-f0-9]{64}$/.test(key)) return { released: 0 };
  const lifecycle = require("./artifact-lifecycle.cjs");
  const id = `version:${path.basename(config.release)}`;
  const record = lifecycle.catalog(projectRoot).find(record => record.id === id);
  if (!record) return { released: 0 };
  if (record.owner !== "azrael-release" || record.kind !== "version" ||
      record.members.filter(member => member.role === "release").length !== 1 ||
      !record.members.some(member => member.role === "release" && path.resolve(member.path) === path.resolve(config.release))) {
    throw new Error("Exact prepared release lifecycle owner required.");
  }
  const build = readJson(path.join(config.release, "build-info.json"));
  const consumers = require("./module-cache-consumers.cjs");
  const legacyInvalidation = cacheInvalidation && build.moduleBuild?.cacheOwner === undefined;
  const cacheOwner = legacyInvalidation ? consumers.legacyToolOwner(projectRoot, config, cacheInvalidation) :
    build.moduleBuild?.cacheOwner ?? path.resolve(projectRoot);
  if (typeof cacheOwner !== "string" || !path.isAbsolute(cacheOwner) ||
      cacheInvalidation && path.resolve(config.toolDirectory) !== path.join(path.resolve(cacheOwner), "artifacts/cache/modules/companion", key)) throw new Error("Invalid module cache owner or tool path.");
  const invalidation = consumers.toolInvalidation(projectRoot, output, { ...config, cacheOwner }, id, cacheInvalidation);
  if (!invalidation && (record.state === "failed" || record.producer && record.producer.outcome !== "success")) {
    throw new Error("Failed or unresolved release retains preparation tools.");
  }
  const references = record.references.filter(reference => reference.id === `run:module-cache:companion:${key}` &&
    reference.reason === "companion-tool" && reference.kind === "dependency" &&
    reference.member_paths === undefined && reference.target_revision === undefined && reference.target_version === undefined);
  const proxyRequired = legacyInvalidation ? consumers.hasConsumer(cacheOwner, projectRoot, id, "companion", key) : build.moduleBuild?.cacheOwner !== undefined;
  if (references.length) lifecycle.releaseReferences(projectRoot, id, {
    owner: record.owner, expected_revision: record.revision,
    reference_ids: references.map(reference => digest(JSON.stringify([reference.id, reference.reason, reference.kind]))),
    reason: invalidation?.reason || "Verified package is complete; preparation tools can be recreated for subsequent checks.",
    evidence_ref: checkpoint, evidence_sha256: digest(fs.readFileSync(checkpoint)),
  });
  if (proxyRequired) {
    if (typeof cacheOwner !== "string" || !path.isAbsolute(cacheOwner)) throw new Error("Invalid module cache owner.");
    require("./module-cache-consumers.cjs").release(cacheOwner, projectRoot, id, "companion", key,
      checkpoint, digest(fs.readFileSync(checkpoint)), cacheInvalidation);
  }
  return { released: references.length, ...(legacyInvalidation ? { legacySourceOnly: !proxyRequired, cacheOwner,
    authority: { evidence_ref: invalidation.evidence_ref, evidence_sha256: invalidation.evidence_sha256 } } : {}) };
}
module.exports = { initialize, save, load, inputs, releaseTools };
if (require.main === module) {
  const [command, output, argument, extra, statePath, generation] = process.argv.slice(2);
  (async () => {
    if (command === "init") await initialize(output, readJson(argument), extra === "true", statePath && generation ? { statePath, generation } : undefined);
    else if (command === "save") await save(output, argument, readJson(extra));
    else if (command === "load") console.log(JSON.stringify(await load(output, argument)));
    else if (command === "release-tools") console.log(JSON.stringify(await releaseTools(output, argument, extra ? readJson(extra) : undefined)));
    else throw new Error("Unknown preparation checkpoint command.");
  })().catch(error => { console.error(error.message); process.exitCode = 1; });
}
