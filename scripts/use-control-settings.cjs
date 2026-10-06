"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const DEFAULTS = Object.freeze({ schema: 1, revision: 0, computerUseEnabled: true, windowUseAllowAll: false, computerUseGeneration: 0, windowUseGeneration: 0 });
function validate(state) {
  if (!state || typeof state !== "object" || Array.isArray(state) || Object.keys(state).length !== Object.keys(DEFAULTS).length || Object.keys(state).some(k => !Object.hasOwn(DEFAULTS, k)) || state.schema !== 1 || typeof state.computerUseEnabled !== "boolean" || typeof state.windowUseAllowAll !== "boolean" || [state.revision, state.computerUseGeneration, state.windowUseGeneration].some(n => !Number.isSafeInteger(n) || n < 0)) throw new Error("Invalid use-control settings");
  return state;
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
      return validate(JSON.parse(bytes.subarray(0, size).toString("utf8")));
    } catch (e) { if (e.code === "ENOENT") return { ...DEFAULTS }; throw e; }
    finally { if (fd !== undefined) fs.closeSync(fd); }
  }
  function updateSettings(patch, expectedRevision) {
    if (!patch || typeof patch !== "object" || Array.isArray(patch) || Object.keys(patch).some(k => !["computerUseEnabled", "windowUseAllowAll"].includes(k) || typeof patch[k] !== "boolean")) throw new Error("Invalid use-control settings patch");
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error("Invalid expected settings revision");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const lock = file + ".lock", fd = fs.openSync(lock, "wx", 0o600);
    let temp;
    try {
      const state = getSettings();
      if (state.revision !== expectedRevision) { const error = new Error("Settings revision conflict"); error.code = "REVISION_CONFLICT"; throw error; }
      for (const [flag, generation] of [["computerUseEnabled", "computerUseGeneration"], ["windowUseAllowAll", "windowUseGeneration"]]) if (Object.hasOwn(patch, flag) && patch[flag] !== state[flag]) { state[flag] = patch[flag]; state[generation]++; }
      state.revision++; validate(state);
      temp = file + "." + crypto.randomBytes(8).toString("hex") + ".tmp";
      const output = fs.openSync(temp, "wx", 0o600);
      try { fs.writeFileSync(output, JSON.stringify(state) + "\n"); fs.fsyncSync(output); } finally { fs.closeSync(output); }
      fs.renameSync(temp, file); temp = undefined;
      return state;
    } finally { if (temp) fs.rmSync(temp, { force: true }); fs.closeSync(fd); fs.unlinkSync(lock); }
  }
  function assertComputerUseEnabled() { if (!getSettings().computerUseEnabled) throw new Error("Computer Use is disabled"); }
  return { getSettings, updateSettings, assertComputerUseEnabled };
}
const registry = globalThis[Symbol.for("azrael.use-control.settings-owners.v1")] ??= new Map();
function owner() { const home = require("./azrael-runtime.cjs").runtime.codexHome, key = path.resolve(home).toLowerCase(); if (!registry.has(key)) registry.set(key, createSettingsOwner(home)); return registry.get(key); }
module.exports = { createSettingsOwner, getSettings: () => owner().getSettings(), updateSettings: (...args) => owner().updateSettings(...args), assertComputerUseEnabled: () => owner().assertComputerUseEnabled() };
