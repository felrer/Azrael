"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const LISTS = ["observationBlockedApps", "controlAllowedApps"];
const FLAGS = ["windowUseEnabled", ...LISTS];
const DEFAULTS = Object.freeze({ schema: 3, revision: 0, windowUseEnabled: true, observationBlockedApps: [], controlAllowedApps: [], windowUseGeneration: 0 });
function normalizeExecutable(value) {
  if (typeof value !== "string" || value !== value.trim() || !value || value.length > 512 || /[\x00-\x1f\x7f*?]/.test(value) || !path.win32.isAbsolute(value) || !(/^[a-z]:[\\/]/i.test(value) || /^\\\\[^\\/]+[\\/][^\\/]+[\\/]/.test(value)) || !/\.exe$/i.test(value)) throw new Error("Invalid Window Use executable path");
  return path.win32.normalize(value).toLowerCase();
}
function appList(value) { if (!Array.isArray(value)) throw new Error("Invalid app list"); return [...new Set(value.map(normalizeExecutable))].sort(); }
function validate(state) {
  if (!state || typeof state !== "object" || Array.isArray(state) || Object.keys(state).length !== Object.keys(DEFAULTS).length || Object.keys(state).some(k => !Object.hasOwn(DEFAULTS, k)) || state.schema !== 3 || typeof state.windowUseEnabled !== "boolean" || [state.revision, state.windowUseGeneration].some(n => !Number.isSafeInteger(n) || n < 0)) throw new Error("Invalid use-control settings");
  for (const key of LISTS) if (JSON.stringify(appList(state[key])) !== JSON.stringify(state[key])) throw new Error("Invalid normalized app list");
  return state;
}
function migrate(state) {
  if (![1, 2].includes(state?.schema)) return validate(state);
  const keys = state.schema === 1 ? ["schema","revision","computerUseEnabled","windowUseAllowAll","computerUseGeneration","windowUseGeneration"] : ["schema","revision","windowUseEnabled","stage1Enabled","stage2Enabled","stage3Enabled","stage4Enabled","windowUseAllowAll","computerUseGeneration","windowUseGeneration"];
  if (Object.keys(state).length !== keys.length || Object.keys(state).some(k => !keys.includes(k)) || keys.filter(k => /Enabled$|AllowAll$/.test(k)).some(k => typeof state[k] !== "boolean") || [state.revision,state.computerUseGeneration,state.windowUseGeneration].some(n => !Number.isSafeInteger(n) || n < 0)) throw new Error("Invalid legacy use-control settings");
  // Retired stage/global grants never become per-app authority.
  return validate({ ...DEFAULTS, revision: state.revision, windowUseEnabled: state.schema === 2 ? state.windowUseEnabled : true, observationBlockedApps: [], controlAllowedApps: [], windowUseGeneration: state.windowUseGeneration + 1 });
}
const settingsPath = home => path.join(home, "azrael", "computer-use", "use-settings.json");
function createSettingsOwner(codexHome) {
  const file = settingsPath(codexHome);
  function getSettings() {
    let fd;
    try { fd = fs.openSync(file, "r"); if (fs.fstatSync(fd).size > 16384) throw new Error("Use-control settings exceed size limit"); const bytes = Buffer.alloc(16385), size = fs.readSync(fd,bytes,0,bytes.length,0); if(size > 16384) throw new Error("Use-control settings exceed size limit"); return migrate(JSON.parse(bytes.subarray(0,size).toString("utf8"))); }
    catch(e) { if(e.code === "ENOENT") return { ...DEFAULTS, observationBlockedApps: [], controlAllowedApps: [] }; throw e; }
    finally { if(fd !== undefined) fs.closeSync(fd); }
  }
  function updateSettings(patch, expectedRevision) {
    if(!patch || typeof patch !== "object" || Array.isArray(patch) || Object.keys(patch).some(k => !FLAGS.includes(k))) throw new Error("Invalid use-control settings patch");
    const normalized = {}; for(const [key,value] of Object.entries(patch)) { if (key === "windowUseEnabled") { if(typeof value !== "boolean") throw new Error("Invalid master switch"); normalized[key]=value; } else normalized[key]=appList(value); }
    if(!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error("Invalid expected settings revision");
    fs.mkdirSync(path.dirname(file),{recursive:true}); const lock=file+".lock", fd=fs.openSync(lock,"wx",0o600); let temp;
    try { const state=getSettings(); if(state.revision !== expectedRevision) { const e=new Error("Settings revision conflict"); e.code="REVISION_CONFLICT"; throw e; }
      if(Object.keys(normalized).some(k => JSON.stringify(normalized[k]) !== JSON.stringify(state[k]))) state.windowUseGeneration++;
      Object.assign(state,normalized); state.revision++; validate(state); const payload=JSON.stringify(state)+"\n"; if(Buffer.byteLength(payload)>16384) throw new Error("Use-control settings exceed size limit");
      temp=file+"."+crypto.randomBytes(8).toString("hex")+".tmp"; const output=fs.openSync(temp,"wx",0o600); try { fs.writeFileSync(output,payload); fs.fsyncSync(output); } finally { fs.closeSync(output); } fs.renameSync(temp,file); temp=undefined; return state;
    } finally { if(temp) fs.unlinkSync(temp); fs.closeSync(fd); fs.unlinkSync(lock); }
  }
  function assertEnabled() { if(!getSettings().windowUseEnabled) throw new Error("Window Use is disabled"); }
  return { file, settingsPath:file, getSettings, updateSettings, assertEnabled };
}
const registry=globalThis[Symbol.for("azrael.use-control.settings-owners.v3")] ??= new Map();
function owner(){const home=require("./azrael-runtime.cjs").runtime.codexHome,key=process.platform === "win32" ? path.resolve(home).toLowerCase() : path.resolve(home); if(!registry.has(key))registry.set(key,createSettingsOwner(home));return registry.get(key);}
module.exports={createSettingsOwner,settingsPath,normalizeExecutable,getSettings:()=>owner().getSettings(),updateSettings:(...args)=>owner().updateSettings(...args),assertEnabled:()=>owner().assertEnabled()};
