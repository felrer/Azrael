"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const FLAGS = Object.freeze(["windowUseEnabled", "stage1Enabled", "stage2Enabled", "stage3Enabled", "stage4Enabled", "windowUseAllowAll"]);
const DEFAULTS = Object.freeze({ schema: 2, revision: 0, windowUseEnabled: true, stage1Enabled: true, stage2Enabled: true, stage3Enabled: false, stage4Enabled: true, windowUseAllowAll: false, computerUseGeneration: 0, windowUseGeneration: 0 });
const LEGACY_KEYS = ["schema", "revision", "computerUseEnabled", "windowUseAllowAll", "computerUseGeneration", "windowUseGeneration"];
function validate(state) {
  if (!state || typeof state !== "object" || Array.isArray(state) || Object.keys(state).length !== Object.keys(DEFAULTS).length || Object.keys(state).some(k => !Object.hasOwn(DEFAULTS, k)) || state.schema !== 2 || FLAGS.some(k => typeof state[k] !== "boolean") || [state.revision, state.computerUseGeneration, state.windowUseGeneration].some(n => !Number.isSafeInteger(n) || n < 0)) throw new Error("Invalid use-control settings");
  return state;
}
function migrate(state) {
  if (state?.schema !== 1) return validate(state);
  if (Object.keys(state).length !== LEGACY_KEYS.length || Object.keys(state).some(k => !LEGACY_KEYS.includes(k)) || typeof state.computerUseEnabled !== "boolean" || typeof state.windowUseAllowAll !== "boolean" || [state.revision, state.computerUseGeneration, state.windowUseGeneration].some(n => !Number.isSafeInteger(n) || n < 0)) throw new Error("Invalid use-control settings");
  return validate({ ...DEFAULTS, revision: state.revision, stage4Enabled: state.computerUseEnabled, windowUseAllowAll: state.windowUseAllowAll, computerUseGeneration: state.computerUseGeneration, windowUseGeneration: state.windowUseGeneration });
}
function stageEnabled(settings, stage) {
  if (!Number.isInteger(stage) || stage < 1 || stage > 4) throw new Error("Invalid Window Use stage");
  return settings.windowUseEnabled === true && settings[`stage${stage}Enabled`] === true;
}
function createSettingsOwner(codexHome) {
  const file = path.join(codexHome, "azrael", "computer-use", "use-settings.json");
  function getSettings() {
    let fd;
    try {
      fd = fs.openSync(file, "r");
      if (fs.fstatSync(fd).size > 16384) throw new Error("Use-control settings exceed size limit");
      const bytes = Buffer.alloc(16385), size = fs.readSync(fd, bytes, 0, bytes.length, 0);
      if (size > 16384) throw new Error("Use-control settings exceed size limit");
      return migrate(JSON.parse(bytes.subarray(0, size).toString("utf8")));
    } catch (e) { if (e.code === "ENOENT") return { ...DEFAULTS }; throw e; }
    finally { if (fd !== undefined) fs.closeSync(fd); }
  }
  function updateSettings(patch, expectedRevision) {
    if (!patch || typeof patch !== "object" || Array.isArray(patch) || Object.keys(patch).some(k => !FLAGS.includes(k) || typeof patch[k] !== "boolean")) throw new Error("Invalid use-control settings patch");
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error("Invalid expected settings revision");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const lock = file + ".lock", fd = fs.openSync(lock, "wx", 0o600);
    let temp;
    try {
      const state = getSettings();
      if (state.revision !== expectedRevision) { const error = new Error("Settings revision conflict"); error.code = "REVISION_CONFLICT"; throw error; }
      const changed = FLAGS.filter(flag => Object.hasOwn(patch, flag) && patch[flag] !== state[flag]);
      for (const flag of changed) state[flag] = patch[flag];
      if (changed.length) state.windowUseGeneration++;
      if (changed.some(flag => flag === "windowUseEnabled" || flag === "stage4Enabled")) state.computerUseGeneration++;
      state.revision++; validate(state);
      temp = file + "." + crypto.randomBytes(8).toString("hex") + ".tmp";
      const output = fs.openSync(temp, "wx", 0o600);
      try { fs.writeFileSync(output, JSON.stringify(state) + "\n"); fs.fsyncSync(output); } finally { fs.closeSync(output); }
      fs.renameSync(temp, file); temp = undefined;
      return state;
    } finally { if (temp) fs.unlinkSync(temp); fs.closeSync(fd); fs.unlinkSync(lock); }
  }
  function assertStageEnabled(stage) { if (!stageEnabled(getSettings(), stage)) throw new Error(`Window Use stage ${stage} is disabled`); }
  function assertComputerUseEnabled() { assertStageEnabled(4); }
  return { getSettings, updateSettings, assertComputerUseEnabled, assertStageEnabled };
}
const registry = globalThis[Symbol.for("azrael.use-control.settings-owners.v1")] ??= new Map();
function owner() { const home = require("./azrael-runtime.cjs").runtime.codexHome, key = process.platform === "win32" ? path.resolve(home).toLowerCase() : path.resolve(home); if (!registry.has(key)) registry.set(key, createSettingsOwner(home)); return registry.get(key); }
module.exports = { createSettingsOwner, stageEnabled, assertStageEnabled: stage => owner().assertStageEnabled(stage), getSettings: () => owner().getSettings(), updateSettings: (...args) => owner().updateSettings(...args), assertComputerUseEnabled: () => owner().assertComputerUseEnabled() };
