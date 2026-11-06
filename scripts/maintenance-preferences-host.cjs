"use strict";
const path = require("node:path");
const { execFile } = require("node:child_process");
const { resolveMaintenanceCommand } = require("./maintenance-owner-config.cjs");
const record = value => !!value && typeof value === "object" && !Array.isArray(value);
function validateWrite(value) {
  if (!record(value) || Object.keys(value).sort().join(",") !== "deletion,expected_revision,groups,locks" ||
      !Number.isSafeInteger(value.expected_revision) || value.expected_revision < 0 ||
      ![value.groups,value.locks,value.deletion].every(v => typeof v === "boolean")) throw Error("Invalid maintenance preference update");
  return value;
}
function validateSnapshot(value) {
  if (!record(value) || value.schema !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 0 ||
      ![value.groups,value.locks,value.deletion,value.effective?.groups,value.effective?.locks,value.effective?.deletion,value.pending].every(v => typeof v === "boolean") ||
      !["enabled","disabled","draining"].includes(value.status)) throw Error("Invalid maintenance preference response");
  return value;
}
function createMaintenancePreferencesHost({codexHome,env = process.env,projectRoot = path.resolve(__dirname,"..")} , dependencies = {}) {
  if (!path.isAbsolute(codexHome) || codexHome.includes("\0")) throw Error("Absolute maintenance state root required");
  const runtimeEnv = {...process.env,...env,AZRAEL_STATE_ROOT:codexHome};
  const resolveCommand = dependencies.resolveCommand ?? resolveMaintenanceCommand;
  const execute = dependencies.execFile ?? execFile;
  const invoke = (command,args,input) => new Promise((resolve,reject) => {
    const child = execute(command.executable,[...command.args,...args],{env:runtimeEnv,encoding:"utf8",windowsHide:true,timeout:15000,maxBuffer:65536},(error,stdout) => {
      if (error) { reject(Error("Maintenance preferences unavailable: " + (error.message || "native command failed"))); return; }
      try { resolve(JSON.parse(stdout)); } catch { reject(Error("Invalid maintenance preferences JSON response")); }
    });
    child.on?.("error",reject);
    child.stdin?.on("error",reject);
    child.stdin?.end(input === undefined ? undefined : JSON.stringify(input));
  });
  return { async request(action,payload) {
    if (!["read","write"].includes(action)) throw Error("Unsupported maintenance preference action");
    if (action === "write") validateWrite(payload);
    else if (payload !== undefined) throw Error("Maintenance preference read does not accept a payload");
    const command = resolveCommand(projectRoot,{env:runtimeEnv});
    const capabilities = await invoke(command,["capabilities"]);
    if (capabilities?.preferences !== true) throw Error("Installed maintenance owner does not support preferences; update Azrael first");
    return validateSnapshot(await invoke(command,["preferences",action],payload));
  }};
}
module.exports = {createMaintenancePreferencesHost,validateWrite,validateSnapshot};
