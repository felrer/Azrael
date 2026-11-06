"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const toml = require(require.resolve("smol-toml", { paths: [__dirname, path.join(__dirname, "../extensions/azrael-ex")] }));
const { loadDefaultProfiles } = require("./role-profile-defaults.cjs");
const copy = value => JSON.parse(JSON.stringify(value));
const freeze = value => { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const builtinIds = ["azrael-lead", "azrael-root", "sol_executor", "luna_explorer"];
const roles = ["lead", "root", "subagent"];
const MAX_TEAM_BYTES = 4 * 1024 * 1024;
const serialized = value => JSON.stringify(value, null, 2) + "\n";
function teamSize(bytes) {
  if (bytes > MAX_TEAM_BYTES) throw Error("Team configuration exceeds 4 MiB (4194304 UTF-8 bytes maximum)");
}
function string(value, field, max = 200, empty = false) {
  if (typeof value !== "string" || value.length > max || (!empty && !value.trim()) || value.includes("\0")) throw Error(`Invalid ${field}`);
  return value;
}
function id(value) { string(value, "ID", 160); if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value)) throw Error("Invalid ID"); return value; }
function list(value, field) { if (!Array.isArray(value) || value.length > 1000 || new Set(value).size !== value.length) throw Error(`Invalid ${field}`); return value.map(id); }
function profile(value, builtin = false) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Invalid profile");
  const allowedRoles = list(value.allowedRoles ?? roles, "allowed roles");
  if (!allowedRoles.length || allowedRoles.some(role => !roles.includes(role))) throw Error("Invalid allowed roles");
  if (builtin) {
    const role = value.id === "azrael-lead" ? "lead" : value.id === "azrael-root" ? "root" : "subagent";
    if (allowedRoles.length !== 1 || allowedRoles[0] !== role) throw Error(`Invalid builtin role: ${value.id}`);
  }
  const draft = !builtin && Array.isArray(value.diagnostics) && value.diagnostics.length > 0;
  const p = { id: id(value.id), name: string(value.name, "profile name", 160), allowedRoles, ...(value.model === undefined ? {} : { model: string(value.model, "model", 200, draft) }), instructions: string(value.instructions ?? "", "instructions", 1000000, true) };
  Object.assign(p, require("./instruction-workbench.cjs").validateProfileResources(value));
  if (!draft && value.model === undefined && ["provider", "providerAccount", "providerSelection", "reasoningEffort"].some(k => value[k] !== undefined)) throw Error("Model override required for provider or reasoning settings");
  if (value.image) p.image = require("./instruction-workbench.cjs").validatedImage(value.image);
  for (const key of ["provider", "reasoningEffort"]) if (value[key] !== undefined) p[key] = string(value[key], key, 200, draft);
  if (builtin) p.builtin = true;
  return p;
}
async function safe(target) {
  let current = path.parse(target).root;
  for (const part of target.slice(current.length).split(path.sep).filter(Boolean)) {
    if (/[. ]$/.test(part) || /[:<>"|?*\x00-\x1f]/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)) throw Error("Unsafe path alias");
    try { if ((await fs.readdir(current)).some(name => name !== part && name.toLowerCase() === part.toLowerCase())) throw Error("Case path alias"); } catch (error) { if (error.code !== "ENOENT") throw error; }
    current = path.join(current, part);
    try { const stat = await fs.lstat(current); if (stat.isSymbolicLink()) throw Error("Linked storage path"); if (stat.isFile() && stat.nlink > 1) throw Error("Hardlinked storage path"); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}
class RoleProfileStore {
  constructor({ codexHome, models, defaults, materializeProfile }) {
    if (!path.isAbsolute(codexHome || "") || codexHome.split(/[\\/]/).includes("..")) throw Error("Absolute codexHome without traversal required");
    if (typeof models !== "function") throw Error("Native model reader required");
    this.codexHome = path.resolve(codexHome); this.root = path.join(this.codexHome, "azrael", "role-profiles");
    this.file = path.join(this.root, "state.json"); this.models = models; this.defaults = defaults === undefined ? undefined : copy(defaults); this.operations = Promise.resolve();
    this.materializeProfile = materializeProfile;
  }
  _queue(fn) { const result = this.operations.then(() => this._locked(fn)); this.operations = result.catch(() => {}); return result; }
  async _locked(fn) {
    await safe(this.root); await fs.mkdir(this.root, { recursive: true }); await safe(this.root);
    const lock = path.join(this.root, "writer.lock"); await safe(lock);
    let handle;
    try { handle = await fs.open(lock, "wx", 0o600); } catch (error) { if (error.code === "EEXIST") throw Error("Role profiles are locked by another writer"); throw error; }
    try { await handle.writeFile(JSON.stringify({ pid: process.pid })); return await fn(await this._read()); }
    finally { await handle.close(); await fs.unlink(lock); }
  }
  async _read() {
    await safe(this.file);
    let raw;
    try { raw = await fs.readFile(this.file, "utf8"); } catch (error) { if (error.code !== "ENOENT") throw error; return this._initial(); }
    const s = JSON.parse(raw);
    if (s.version !== 1 || !Number.isSafeInteger(s.revision) || s.revision < 0 || !Array.isArray(s.profiles) || !Array.isArray(s.teamPresets)) throw Error("Invalid role profile state");
    s.profiles = s.profiles.map(p => profile(p, builtinIds.includes(p.id)));
    if (new Set(s.profiles.map(p => p.id)).size !== s.profiles.length || builtinIds.some(b => !s.profiles.some(p => p.id === b))) throw Error("Incomplete or duplicate builtin profiles");
    s.teamPresets = s.teamPresets.map(p => this._team(s, p)); s.direct = this._direct(s, s.direct);
    if (new Set(s.teamPresets.map(p => p.id)).size !== s.teamPresets.length) throw Error("Duplicate Team preset IDs");
    const teams = s.teams ?? [];
    if (!Array.isArray(teams) || new Set(teams.map(t => t.id)).size !== teams.length) throw Error("Invalid Team metadata");
    const metadata = teams.map(t => {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(t.id)) throw Error("Invalid Team instance ID");
      return { id: t.id, name: string(t.name, "Team name", 160), ...(t.leadThreadId === undefined ? {} : { leadThreadId: string(t.leadThreadId, "Lead thread ID") }) };
    });
    return { version: 1, revision: s.revision, profiles: s.profiles, teamPresets: s.teamPresets, direct: s.direct, teams: metadata };
  }
  async _initial() {
    const source = this.defaults === undefined ? await loadDefaultProfiles({ codexHome: this.codexHome, models: this.models }) : this.defaults;
    const s = { version: 1, revision: 0, profiles: source.map(p => profile(p, builtinIds.includes(p.id))), teamPresets: [], direct: { rootProfileId: "azrael-root", subagentProfileIds: ["sol_executor", "luna_explorer"] }, teams: [] };
    if (new Set(s.profiles.map(p => p.id)).size !== s.profiles.length || builtinIds.some(b => !s.profiles.some(p => p.id === b))) throw Error("Incomplete or duplicate builtin profiles");
    await this._migrate(s);
    s.teamPresets = [this._team(s, { id: "default", name: "Default Team", leadProfileId: "azrael-lead", rootProfileIds: ["azrael-root"], subagentProfileIds: ["sol_executor", "luna_explorer"] })];
    s.direct = this._direct(s, s.direct); await this._write(s); return s;
  }
  async _migrate(s) {
    const config = path.join(this.codexHome, "config.toml"); await safe(config);
    let raw; try { raw = await fs.readFile(config, "utf8"); } catch (error) { if (error.code === "ENOENT") return; throw error; }
    const agents = toml.parse(raw).agents;
    if (!agents || typeof agents !== "object") return;
    for (const [name, entry] of Object.entries(agents)) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      let source = entry;
      if (entry.config_file !== undefined) {
        const file = path.resolve(this.codexHome, string(entry.config_file, "agent config file", 4096)); await safe(file);
        source = { ...entry, ...toml.parse(await fs.readFile(file, "utf8")) };
      }
      if (source.model === undefined && source.developer_instructions === undefined && source.model_reasoning_effort === undefined) continue;
      const existing = s.profiles.find(p => p.id === name);
      const migrated = profile({ id: name, name, allowedRoles: ["subagent"], model: source.model ?? existing?.model, ...(source.model_provider ? { provider: source.model_provider } : existing?.provider ? { provider: existing.provider } : {}), ...(source.model_reasoning_effort ? { reasoningEffort: source.model_reasoning_effort } : {}), instructions: source.developer_instructions ?? "" });
      if (existing) {
        if (!existing.allowedRoles.includes("subagent") || ["model", "provider", "reasoningEffort", "instructions"].some(k => existing[k] !== migrated[k])) throw Error(`Named agent migration conflicts with builtin profile: ${name}`);
      } else s.profiles.push(migrated);
    }
  }
  async _write(s) {
    return this._writeFile(this.file, s);
  }
  async _writeFile(destination, value) {
    await safe(destination); const temp = destination + "." + crypto.randomUUID() + ".tmp"; let handle;
    try {
      handle = await fs.open(temp, "wx", 0o600); await handle.writeFile(serialized(value)); await handle.sync(); await handle.close(); handle = null;
      await safe(destination); await fs.rename(temp, destination);
    } finally { if (handle) await handle.close(); try { await fs.unlink(temp); } catch (error) { if (error.code !== "ENOENT") throw error; } }
  }
  _use(s, profileId, role) { const p = s.profiles.find(p => p.id === id(profileId)); if (!p || !p.allowedRoles.includes(role)) throw Error(`Missing or role-incompatible ${role} profile: ${profileId}`); return p; }
  _team(s, p) {
    if (!p || typeof p !== "object") throw Error("Invalid Team preset");
    const result = { id: id(p.id), name: string(p.name, "Team preset name", 160), leadProfileId: id(p.leadProfileId), rootProfileIds: list(p.rootProfileIds, "root profiles"), subagentProfileIds: list(p.subagentProfileIds, "subagent profiles") };
    if (p.image) result.image = require("./instruction-workbench.cjs").validatedImage(p.image);
    if (!result.rootProfileIds.length) throw Error("Team requires an allowed root profile");
    this._use(s, result.leadProfileId, "lead"); result.rootProfileIds.forEach(p => this._use(s, p, "root")); result.subagentProfileIds.forEach(p => this._use(s, p, "subagent")); return result;
  }
  _direct(s, d) { if (!d || typeof d !== "object") throw Error("Invalid Direct configuration"); const result = { rootProfileId: id(d.rootProfileId), subagentProfileIds: list(d.subagentProfileIds, "subagent profiles") }; this._use(s, result.rootProfileId, "root"); result.subagentProfileIds.forEach(p => this._use(s, p, "subagent")); return result; }
  async _available(profiles) {
    const rows = await this.models(); if (!Array.isArray(rows)) throw Error("Native model list unavailable");
    for (const p of profiles) {
      if (p.diagnostics?.length) throw Error(`Invalid profile diagnostics: ${p.id}`);
      if (p.model === undefined) continue;
      const matches = rows.filter(row => (row.model || row.id) === p.model && (p.provider === undefined || row.modelProvider === p.provider));
      if (matches.length !== 1) throw Error(`Unavailable or ambiguous model for profile ${p.id}: ${p.model}`);
      const row = matches[0];
      if (p.reasoningEffort !== undefined && !(row.supportedReasoningEfforts || []).some(e => (typeof e === "string" ? e : e.reasoningEffort) === p.reasoningEffort)) throw Error(`Unsupported reasoning effort for profile ${p.id}: ${p.reasoningEffort}`);
      if (p.provider === undefined && typeof row.modelProvider === "string") p.provider = row.modelProvider;
    }
  }
  _teamPath(teamId) { return path.join(this.root, "teams", teamId + ".json"); }
  async _writeTeam(configurationPath, policy) {
    teamSize(Buffer.byteLength(serialized(policy), "utf8"));
    return this._writeFile(configurationPath, policy);
  }
  async _readTeam(metadata) {
    const configurationPath = this._teamPath(metadata.id); await safe(configurationPath);
    teamSize((await fs.stat(configurationPath)).size);
    const bytes = await fs.readFile(configurationPath); teamSize(bytes.length);
    const policy = JSON.parse(bytes.toString("utf8"));
    if (policy.role !== "lead" || policy.configuration_path !== configurationPath || !Array.isArray(policy.profiles)) throw Error("Invalid Team configuration identity");
    const profiles = policy.profiles.map(p => profile({ ...require("./instruction-workbench.cjs").validateProfileResources(p.profile_extension || {}), ...(p.profile_extension?.image ? { image: p.profile_extension.image } : {}), id: p.id, name: p.name, allowedRoles: p.allowed_roles, model: p.model, provider: p.provider, reasoningEffort: p.reasoning_effort, instructions: p.instructions }));
    if (new Set(profiles.map(p => p.id)).size !== profiles.length) throw Error("Duplicate Team profile IDs");
    const config = this._team({ profiles }, { id: metadata.id, name: metadata.name, leadProfileId: policy.profile_id, rootProfileIds: policy.root_profile_ids, subagentProfileIds: policy.subagent_profile_ids });
    return { policy, public: { ...config, ...(metadata.leadThreadId ? { leadThreadId: metadata.leadThreadId } : {}), profiles } };
  }
  async _snapshot(s) {
    const teams = [];
    for (const metadata of s.teams) if (metadata.leadThreadId) teams.push((await this._readTeam(metadata)).public);
    return copy({ ...s, teams });
  }
  snapshot() { return this._queue(s => this._snapshot(s)); }
  snapshotLibrary() { return this._queue(s => copy({ revision: s.revision, profiles: s.profiles })); }
  replaceLibrary({ expectedRevision, profiles }) {
    return this._queue(async s => {
      if (expectedRevision !== s.revision) throw Error("Profile repository revision conflict");
      if (!Array.isArray(profiles) || profiles.length > 10000) throw Error("Invalid profile library");
      const next = profiles.map(p => profile(p, builtinIds.includes(p.id)));
      if (new Set(next.map(p => p.id)).size !== next.length) throw Error("Duplicate profile IDs");
      for (const builtinId of builtinIds) if (JSON.stringify(next.find(p => p.id === builtinId)) !== JSON.stringify(s.profiles.find(p => p.id === builtinId))) throw Error("Builtin profiles are read-only: " + builtinId);
      const candidate = { ...s, profiles: next };
      candidate.teamPresets.forEach(p => this._team(candidate, p)); this._direct(candidate, candidate.direct);
      s.profiles = next; s.revision++; await this._write(s);
      return copy({ revision: s.revision, profiles: s.profiles });
    });
  }
  createTeamConfiguration(capture, commonInstructions) {
    return this._queue(async s => {
      if (capture?.mode !== "team" || !Array.isArray(capture.profiles)) throw Error("Team capture required");
      const profiles = capture.profiles.map(p => profile(p));
      const name = capture.name ?? s.teamPresets.find(p => p.id === capture.presetId)?.name ?? "Team";
      const teamId = crypto.randomUUID(), metadata = { id: teamId, name: string(name, "Team name", 160) };
      if (new Set(profiles.map(p => p.id)).size !== profiles.length) throw Error("Duplicate Team profile IDs");
      this._team({ profiles }, { id: teamId, name, leadProfileId: capture.leadProfileId, rootProfileIds: capture.rootProfileIds, subagentProfileIds: capture.subagentProfileIds });
      await this._available(profiles);
      if (commonInstructions !== undefined && commonInstructions !== null) string(commonInstructions, "common instructions", 1000000, true);
      const configurationPath = this._teamPath(teamId), directory = path.dirname(configurationPath);
      await safe(directory); await fs.mkdir(directory, { recursive: true }); await safe(directory);
      const policy = { ...await require("./role-profile-runtime.cjs").materializePolicy({ ...capture, profiles }, commonInstructions, this.materializeProfile), configuration_path: configurationPath };
      await this._writeTeam(configurationPath, policy);
      try { s.teams.push(metadata); s.revision++; await this._write(s); }
      catch (error) { await fs.unlink(configurationPath); throw error; }
      return copy(policy);
    });
  }
  attachTeamConfiguration(configurationPath, leadThreadId) {
    return this._queue(async s => {
      string(leadThreadId, "Lead thread ID");
      const metadata = s.teams.find(t => this._teamPath(t.id) === configurationPath);
      if (!metadata) throw Error("Unknown Team configuration path");
      if (metadata.leadThreadId && metadata.leadThreadId !== leadThreadId) throw Error("Team configuration already attached to another Lead");
      if (s.teams.some(t => t.id !== metadata.id && t.leadThreadId === leadThreadId)) throw Error("Lead already attached to another Team");
      await this._readTeam(metadata); metadata.leadThreadId = leadThreadId; s.revision++; await this._write(s); return this._snapshot(s);
    });
  }
  // Caller must independently establish that native dispatch never occurred or
  // no thread exists. A lost response or generic native error is insufficient.
  discardTeamConfiguration(configurationPath) {
    return this._queue(async s => {
      const metadata = s.teams.find(t => this._teamPath(t.id) === configurationPath);
      if (!metadata) throw Error("Unknown Team configuration path");
      if (metadata.leadThreadId) throw Error("Attached Team configuration cannot be discarded");
      await safe(configurationPath);
      try { await fs.unlink(configurationPath); } catch (error) { if (error.code !== "ENOENT") throw error; }
      try { await fs.lstat(configurationPath); throw Error("Team configuration remains after deletion"); } catch (error) { if (error.code !== "ENOENT") throw error; }
      s.teams = s.teams.filter(t => t.id !== metadata.id); s.revision++; await this._write(s); return this._snapshot(s);
    });
  }
  action(name, payload = {}) {
    return this._queue(async s => {
      if (name === "saveTeamProfile") {
        const metadata = s.teams.find(t => t.id === payload.teamId && t.leadThreadId);
        if (!metadata) throw Error("Team instance does not exist");
        const team = await this._readTeam(metadata), input = payload.profile;
        const existing = team.public.profiles.find(old => old.id === input?.id);
        const p = profile({ ...require("./instruction-workbench.cjs").validateProfileResources(existing || {}), id: input?.id, name: input?.name, allowedRoles: input?.allowedRoles ?? existing?.allowedRoles, model: input?.model, provider: input?.provider, reasoningEffort: input?.reasoningEffort, instructions: input?.instructions, ...(input?.image ? { image: input.image } : {}) });
        if (!existing || existing.allowedRoles.length !== p.allowedRoles.length || existing.allowedRoles.some(role => !p.allowedRoles.includes(role))) throw Error("Team profile ID and allowed roles are immutable");
        p.allowedRoles = existing.allowedRoles; await this._available([p]);
        const native = await require("./role-profile-runtime.cjs").materializePolicy({ mode: "team", revision: s.revision, profiles: team.public.profiles.map(old => old.id === p.id ? p : old), leadProfileId: team.public.leadProfileId, rootProfileIds: team.public.rootProfileIds, subagentProfileIds: team.public.subagentProfileIds }, undefined, this.materializeProfile);
        team.policy.profiles = native.profiles;
        await this._writeTeam(this._teamPath(metadata.id), team.policy);
      } else if (name === "saveProfile") {
        const input = payload.profile, prior = s.profiles.find(p => p.id === input?.id);
        const { validateProfileResources } = require("./instruction-workbench.cjs");
        // Role-only edits cannot inject composer pins; retain canonical resource data.
        const p = profile({ id: input?.id, name: input?.name, allowedRoles: input?.allowedRoles ?? prior?.allowedRoles, model: input?.model, provider: input?.provider, reasoningEffort: input?.reasoningEffort, instructions: input?.instructions, ...validateProfileResources(prior || {}), ...(input?.image ? { image: input.image } : {}) }); if (builtinIds.includes(p.id)) throw Error("Builtin profiles are read-only; duplicate with a new ID");
        await this._available([p]); const index = s.profiles.findIndex(old => old.id === p.id); if (index < 0) s.profiles.push(p); else s.profiles[index] = p;
        s.teamPresets.forEach(p => this._team(s, p)); this._direct(s, s.direct);
      } else if (name === "deleteProfile") {
        const profileId = id(payload.id); if (builtinIds.includes(profileId)) throw Error("Builtin profiles are read-only");
        if (!s.profiles.some(p => p.id === profileId)) throw Error("Profile does not exist");
        if (s.direct.rootProfileId === profileId || s.direct.subagentProfileIds.includes(profileId) || s.teamPresets.some(p => p.leadProfileId === profileId || [...p.rootProfileIds, ...p.subagentProfileIds].includes(profileId))) throw Error("Profile is referenced by a saved configuration");
        s.profiles = s.profiles.filter(p => p.id !== profileId);
      } else if (name === "saveTeamPreset") {
        const p = this._team(s, payload.preset); await this._available([this._use(s, p.leadProfileId, "lead"), ...p.rootProfileIds.map(id => this._use(s, id, "root")), ...p.subagentProfileIds.map(id => this._use(s, id, "subagent"))]);
        const index = s.teamPresets.findIndex(old => old.id === p.id); if (index < 0) s.teamPresets.push(p); else s.teamPresets[index] = p;
      } else if (name === "deleteTeamPreset") {
        const presetId = id(payload.id); if (!s.teamPresets.some(p => p.id === presetId)) throw Error("Team preset does not exist"); s.teamPresets = s.teamPresets.filter(p => p.id !== presetId);
      } else if (name === "saveDirect") {
        const direct = this._direct(s, payload.direct);
        await this._available([this._use(s, direct.rootProfileId, "root"), ...direct.subagentProfileIds.map(id => this._use(s, id, "subagent"))]);
        s.direct = direct;
      } else throw Error(`Unknown role profile action: ${name}`);
      s.revision++; await this._write(s); return this._snapshot(s);
    });
  }
  capture(mode, presetId) {
    return this._queue(async s => {
      let config;
      if (mode === "team") { const p = s.teamPresets.find(p => p.id === (presetId ?? "default")); if (!p) throw Error("Team preset does not exist"); config = { mode, revision: s.revision, presetId: p.id, leadProfileId: p.leadProfileId, rootProfileIds: [...p.rootProfileIds], subagentProfileIds: [...p.subagentProfileIds] }; }
      else if (mode === "direct") config = { mode, revision: s.revision, rootProfileId: s.direct.rootProfileId, rootProfileIds: [], subagentProfileIds: [...s.direct.subagentProfileIds] };
      else throw Error("Unknown session mode");
      const ids = [...new Set([config.leadProfileId, config.rootProfileId, ...config.rootProfileIds, ...config.subagentProfileIds].filter(Boolean))];
      const profiles = ids.map(id => copy(s.profiles.find(p => p.id === id))); await this._available(profiles);
      return freeze({ ...config, profiles });
    });
  }
}
module.exports = { RoleProfileStore };
