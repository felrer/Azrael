"use strict";
// Read-only producer gate. The native maintenance owner remains authoritative.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function readPreferences({ env = process.env } = {}) {
  const root = env.AZRAEL_STATE_ROOT || env.CODEX_HOME || path.join(os.homedir(), ".azrael-ex");
  if (!path.isAbsolute(root) || root.includes("\0") || root.split(/[\\/]/).includes("..")) throw new Error("Absolute maintenance state root required");
  const filename = path.join(root, "maintenance-preferences.json");
  let raw;
  try { raw = fs.readFileSync(filename, "utf8"); }
  catch (error) {
    if (error.code === "ENOENT") return { schema: 1, revision: 0, groups: true, locks: true, deletion: true };
    throw new Error(`Cannot read maintenance preferences: ${filename}`, { cause: error });
  }
  let preferences;
  if (Buffer.byteLength(raw) > 16384) throw new Error(`Maintenance preferences exceed bound: ${filename}`);
  try { preferences = JSON.parse(raw); }
  catch (error) { throw new Error(`Invalid maintenance preferences: ${filename}`, { cause: error }); }
  if (!preferences || Array.isArray(preferences) || Object.keys(preferences).filter(key => key !== "deletion_parallelism").sort().join(",") !== "deletion,groups,locks,revision,schema" || preferences.schema !== 1 ||
      !Number.isSafeInteger(preferences.revision) || preferences.revision < 0 ||
      ["groups", "locks", "deletion"].some(key => typeof preferences[key] !== "boolean") ||
      Object.hasOwn(preferences, "deletion_parallelism") && ![1, 2].includes(preferences.deletion_parallelism)) {
    throw new Error(`Invalid maintenance preferences: ${filename}`);
  }
  const { schema, revision, groups, locks, deletion } = preferences;
  return { schema, revision, groups, locks, deletion };
}

function assertEnabled(kind, { env = process.env } = {}) {
  if (!["groups", "locks", "deletion"].includes(kind)) throw new Error("Unknown maintenance preference gate");
  const preferences = readPreferences({ env });
  if (!preferences.groups || !preferences.locks || (kind === "deletion" && !preferences.deletion)) {
    throw new Error(`Maintenance ${kind} is disabled by maintenance preferences`);
  }
  return preferences;
}

module.exports = { readPreferences, assertEnabled };
