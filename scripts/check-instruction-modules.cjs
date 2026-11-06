"use strict";

const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { spawnSync } = require("node:child_process");

const instructionModules = Object.freeze([
  "instruction-package.cjs", "instruction-library.cjs",
  "instruction-publisher.cjs", "instruction-catalog.cjs", "instruction-migration.cjs", "task-profile-runtime.cjs",
  "role-profile-store.cjs", "role-profile-defaults.cjs", "role-profile-runtime.cjs",
  "instruction-workbench.cjs", "instruction-workbench-view.cjs", "instruction-workbench-options.cjs", "instruction-workbench-resources.cjs", "instruction-workbench-runtime.cjs",
  "maintenance-preferences-host.cjs", "maintenance-owner-config.cjs", "maintenance-lock-owner.cjs", "maintenance-lock-worker.cjs",
  "provider-accounts-host.cjs", "platform-runtime.cjs", "azrael-platforms.json",
]);

function accountRoot(directory) {
  if (typeof directory !== "string" || !path.isAbsolute(directory)) throw new Error("Absolute account-ui directory required.");
  const root = fs.realpathSync(directory);
  if (!fs.statSync(root).isDirectory()) throw new Error("account-ui must be a directory.");
  return root;
}

function verifyIsolated(directory) {
  const root = accountRoot(directory);
  const resolve = Module._resolveFilename;
  // Check the actual resolved file, including require.resolve calls and every
  // transitive require. Clearing NODE_PATH alone does not block ancestor lookup.
  Module._resolveFilename = function(request, parent, isMain, options) {
    const resolved = Reflect.apply(resolve, this, arguments);
    if (!Module.isBuiltin(resolved)) {
      const relative = path.relative(root, fs.realpathSync(resolved));
      if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) {
        throw new Error(`Packaged instruction dependency escapes account-ui: ${request} -> ${resolved}`);
      }
    }
    return resolved;
  };
  const loaded = instructionModules.map(name => name === "maintenance-lock-worker.cjs" ? null : require(path.join(root, name)));
  // A worker entry requires workerData and cannot execute in the checking thread.
  if (!fs.statSync(path.join(root, "maintenance-lock-worker.cjs")).isFile()) throw new Error("Packaged maintenance lock worker required.");
  // Preserve the constructor smoke checks without writing state or contacting
  // external services. All state paths are inert until a method is called.
  new loaded[1].InstructionLibrary({ root: path.join(root, ".check-library"), installedRoot: path.join(root, ".check-home") });
  new loaded[2].InstructionPublisher({ stateRoot: path.join(root, ".check-operations") });
  const taskRuntime = loaded[instructionModules.indexOf("task-profile-runtime.cjs")];
  new taskRuntime.TaskProfileRuntime({ codexHome: path.join(root, ".check-home"), request: async () => { throw new Error("No network allowed in packaging check"); } });
  const defaults = JSON.parse(fs.readFileSync(path.join(root, "role-profile-defaults.json"), "utf8"));
  const expectedRoles = { "azrael-lead": "lead", "azrael-root": "root", sol_executor: "subagent", luna_explorer: "subagent" };
  for (const [id, role] of Object.entries(expectedRoles)) {
    const profile = defaults.find(p => p.id === id);
    if (!profile || profile.allowedRoles?.length !== 1 || profile.allowedRoles[0] !== role || typeof profile.instructions !== "string" || !profile.instructions.trim()) throw Error("Packaged role-profile default is incomplete: " + id);
  }
  return { modules: instructionModules };
}

function checkInstructionModules(directory) {
  const root = accountRoot(directory);
  // Use a fresh process so caller caches, preloads and NODE_PATH cannot supply
  // dependencies which are absent from the shipped payload.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !["NODE_PATH", "NODE_OPTIONS"].includes(key.toUpperCase())));
  const result = spawnSync(process.execPath, [__filename, "--isolated", root], {
    cwd: root, env, encoding: "utf8", windowsHide: true, timeout: 30000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Packaged instruction module check failed (exit ${result.status}, signal ${result.signal}):\n${result.stderr || result.stdout}`);
  return JSON.parse(result.stdout);
}

module.exports = { checkInstructionModules, instructionModules };
if (require.main === module) {
  try {
    const isolated = process.argv[2] === "--isolated";
    if (process.argv.length !== (isolated ? 4 : 3)) throw new Error("Usage: node check-instruction-modules.cjs <absolute-account-ui-directory>");
    console.log(JSON.stringify(isolated ? verifyIsolated(process.argv[3]) : checkInstructionModules(process.argv[2])));
  } catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  }
}
