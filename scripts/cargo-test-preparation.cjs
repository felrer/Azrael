"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { compilationSignature, physicalPath } = require("./cargo-target-owner.cjs");

// This records preparation, never passing test results. Cargo still validates
// freshness, discovers tests and executes every requested filter.
function preparationContext(spec, options = {}) {
  const directory = options.directory;
  const mode = options.mode || "auto";
  const report = { schema: 1, recommendation: "prepare-recommended", action: "prepare", mode };
  if (!directory || !path.isAbsolute(directory) || !options.sourceIdentity || !options.runtimeIdentity) {
    return { report: { ...report, recommendation: "reuse-caution", reason: "Reuse needs an owned preparation directory and measured frozen source/runtime identities" } };
  }
  if (!["auto", "fresh", "advice"].includes(mode)) {
    return { report: { ...report, recommendation: "reuse-caution", reason: "Unknown preparation mode; using the normal Cargo path" } };
  }
  const env = { ...spec.env };
  for (const key of Object.keys(env)) if (key.startsWith("AZRAEL_CARGO_PREPARATION_")) delete env[key];
  const key = createHash("sha256").update(JSON.stringify({ schema: 1,
    sourceRoot: spec.selectedSourceRoot, sourceIdentity: options.sourceIdentity, runtimeIdentity: options.runtimeIdentity,
    compilation: compilationSignature({ ...spec, env }) })).digest("hex");
  const filename = path.join(directory, `${key}.json`);
  let previous, reason = "No matching completed preparation";
  try {
    previous = JSON.parse(fs.readFileSync(filename, "utf8"));
    if (previous.schema !== 1 || previous.key !== key || previous.typeCheckExitCode !== 0 || previous.selectionExitCode !== 0) {
      previous = undefined; reason = "Preparation evidence is incomplete; prepare again";
    } else if (!fs.existsSync(spec.env.CARGO_TARGET_DIR)) {
      previous = undefined; reason = "Prepared Cargo target is absent; prepare again";
    }
  } catch (error) {
    if (error.code !== "ENOENT") reason = `Preparation evidence is unavailable: ${error.message}`;
  }
  Object.assign(report, { key, reason: previous ? "Frozen inputs and compilation settings match; Cargo will still check freshness and run this filter" : reason,
    recommendation: previous ? "reuse-recommended" : "prepare-recommended", action: previous && mode === "auto" ? "reuse" : "prepare",
    ...(previous ? { previousPreparationMs: previous.preparationMs, preparedUtc: previous.preparedUtc } : {}) });
  if (mode === "fresh") report.reason = "Fresh preparation requested";
  if (mode === "advice") report.action = "advice-only";
  return { report, filename, skipTypeCheck: report.action === "reuse",
    invalidate() { if (mode !== "advice" && fs.existsSync(filename)) fs.unlinkSync(filename); }, save(phases) {
    if (mode === "advice") return;
    const typeCheck = phases.find(phase => phase.phase === "typeCheck");
    const selection = phases.find(phase => phase.phase === "selection");
    if (typeCheck?.exitCode !== 0 || typeCheck.signal || selection?.exitCode !== 0 || selection.signal || !selection.selectedTests) return;
    fs.mkdirSync(directory, { recursive: true });
    const receipt = { schema: 1, key, sourceIdentity: options.sourceIdentity, runtimeIdentity: options.runtimeIdentity,
      targetDirectory: physicalPath(spec.env.CARGO_TARGET_DIR), preparedUtc: new Date().toISOString(),
      typeCheckExitCode: 0, selectionExitCode: 0, preparationMs: typeCheck.durationMs + selection.durationMs };
    const temporary = `${filename}.${randomUUID()}.tmp`;
    try { fs.writeFileSync(temporary, JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" }); fs.renameSync(temporary, filename); }
    finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  } };
}

module.exports = { preparationContext };
