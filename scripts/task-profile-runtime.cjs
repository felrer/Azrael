"use strict";
// Host-only immutable resources and one-use native conversation activation.
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { packageDigest, canonicalDigest, verifyPlan } = require("./instruction-library.cjs");
const toml = require(require.resolve("smol-toml", { paths: [__dirname, path.join(__dirname, "../extensions/azrael-ex")] }));
const HASH = /^[a-f0-9]{64}$/;
const NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;
function appendContext(existing, text) {
  if (typeof text !== "string" || !text.trim() || (typeof existing === "string" && existing.includes(text))) return typeof existing === "string" ? existing : "";
  if (typeof existing !== "string" || !existing.trim() || text.includes(existing)) return text;
  return existing + "\n\n" + text;
}
async function safe(file) {
  file = path.resolve(file); let current = path.parse(file).root;
  for (const part of file.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try { if ((await fs.lstat(current)).isSymbolicLink()) throw Error("Task snapshot symlink rejected"); } catch (e) { if (e.code !== "ENOENT") throw e; }
  }
  return file;
}
function relative(name) {
  if (typeof name !== "string" || !name || name.includes("\\") || name.startsWith("/") || name.split("/").some(p => !p || p === "." || p === ".." || /[<>:"|?*\x00-\x1f]/.test(p) || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) throw Error("Task resource path rejected");
  return name;
}
function selectModel(catalog, name, provider, effort) {
  const candidates = catalog.filter(m => (m.model === name || m.id === name) && (provider == null || m.modelProvider === provider));
  if (candidates.length !== 1 || candidates[0].availabilityNux != null) throw Error("Selected task model is unavailable or ambiguous");
  const found = candidates[0];
  if (typeof found.modelProvider !== "string" || !found.modelProvider) throw Error("Task model provider is unavailable");
  if (effort != null && !found.supportedReasoningEfforts?.some(e => e.reasoningEffort === effort)) throw Error("Selected reasoning effort is unsupported");
  return found;
}
function validateHarness(harness) {
  if (harness == null) return {};
  if (typeof harness !== "object" || Array.isArray(harness) || Object.keys(harness).some(k => !["promptProfile", "toolProfile"].includes(k))) throw Error("Invalid task harness binding");
  if (harness.promptProfile != null && !["builtin/azrael-default", "builtin/anthropic", "builtin/claude-lean"].includes(harness.promptProfile)) throw Error("Unknown task prompt profile");
  if (harness.toolProfile != null && harness.toolProfile !== "builtin/azrael-default") throw Error("Unknown task tool profile");
  const binding = {};
  if (harness.promptProfile != null) binding.prompt_profile = harness.promptProfile;
  if (harness.toolProfile != null) binding.tool_profile = harness.toolProfile;
  return binding;
}
function validateProviderAccount(value) {
  if (value == null || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 2 || Object.keys(value).some(key => !["providerId", "accountId"].includes(key)) || ["providerId", "accountId"].some(key => typeof value[key] !== "string" || !value[key].trim() || value[key].trim() !== value[key] || /[\x00-\x1f\x7f]/.test(value[key]))) throw Error("Invalid captured provider account scope");
  return { providerId: value.providerId, accountId: value.accountId };
}
class TaskProfileRuntime {
  constructor({ codexHome, request, now = Date.now, ttlMs = 10 * 60 * 1000 }) {
    if (!path.isAbsolute(codexHome) || typeof request !== "function") throw Error("Task runtime requires a native home and request transport");
    this.root = path.join(codexHome, "azrael", "task-profiles"); this.request = request; this.now = now; this.ttlMs = ttlMs; this.drafts = new Map(); this.pending = new Map(); this.queue = Promise.resolve();
  }
  async catalog() {
    const result = [], seen = new Set(); let cursor = null;
    do { const page = await this.request("model/list", { cursor, limit: 100, includeHidden: true }); if (!Array.isArray(page?.data)) throw Error("Native model discovery is unavailable"); result.push(...page.data); cursor = page.nextCursor ?? null; if (cursor != null && seen.has(cursor)) throw Error("Repeated model discovery cursor"); seen.add(cursor); } while (cursor != null);
    return result;
  }
  async create(value) {
    const snapshot = await this.materialize(value);
    const token = crypto.randomUUID(); this.drafts.set(token, { digest: snapshot.digest, expires: this.now() + this.ttlMs, view: null });
    return { token, model: snapshot.model, profileId: snapshot.profileId };
  }
  async materialize(value) {
    verifyPlan(value);
    if (!HASH.test(value.digest) || !Array.isArray(value.packages) || !Array.isArray(value.instructions)) throw Error("Invalid resolved task snapshot");
    const frozen = JSON.parse(JSON.stringify(value));
    const providerAccount = Object.hasOwn(frozen, "providerAccount") ? validateProviderAccount(frozen.providerAccount) : undefined;
    const catalog = await this.catalog();
    const model = selectModel(catalog, frozen.model, frozen.provider, frozen.reasoningEffort);
    const profile = frozen.packages.find(p => p.id === frozen.profileId && p.kind === "task-profile");
    if (!profile) throw Error("Task profile root is missing");
    const binding = validateHarness(profile.profile?.harness);
    if (frozen.packages.some(p => p.kind === "agent-role") && !["v1", "v2"].includes(model.multiAgentVersion)) throw Error("Task root model does not advertise multi-agent capability");
    const files = {}, config = {}, roles = new Set(), skills = new Set();
    const add = (name, data) => { relative(name); if (Object.keys(files).some(k => k.toLowerCase() === name.toLowerCase())) throw Error("Task resource collision"); files[name] = data.toString("base64"); };
    for (const entry of frozen.packages) {
      if (!HASH.test(entry.digest) || packageDigest(entry) !== entry.digest || entry.validationErrors?.length) throw Error("Task package digest or validation failed");
      if (!Array.isArray(entry.files)) throw Error("Task package files required");
      if (entry.kind === "skill") {
        const main = entry.files.find(f => f.path === "SKILL.md");
        const name = /^---\r?\n[\s\S]*?^name:\s*["']?([a-z0-9][a-z0-9_-]{0,63})["']?\s*$/m.exec(main?.content ?? "")?.[1];
        if (!name || skills.has(name.toLowerCase())) throw Error("Task skill identity collision"); skills.add(name.toLowerCase());
        for (const f of entry.files) add(`skills/${name}/${relative(f.path)}`, Buffer.from(f.content, f.encoding === "base64" ? "base64" : "utf8"));
      } else if (entry.kind === "agent-role") {
        if (!NAME.test(entry.name) || roles.has(entry.name)) throw Error("Task role identity collision"); roles.add(entry.name);
        const role = entry.files.filter(f => f.path.endsWith(".toml")); if (role.length !== 1) throw Error("Task role TOML required");
        const parsed = toml.parse(Buffer.from(role[0].content, role[0].encoding === "base64" ? "base64" : "utf8").toString("utf8"));
        if (Object.keys(parsed).some(k => !["model", "model_reasoning_effort", "developer_instructions", "description"].includes(k))) throw Error("Task role machine configuration rejected");
        if (parsed.model != null) selectModel(catalog, parsed.model, model.modelProvider, parsed.model_reasoning_effort);
        else if (parsed.model_reasoning_effort != null) selectModel(catalog, model.model, model.modelProvider, parsed.model_reasoning_effort);
        for (const f of entry.files) add(`roles/${entry.name}/${relative(f.path)}`, Buffer.from(f.content, f.encoding === "base64" ? "base64" : "utf8"));
        config[`agents.${entry.name}.config_file`] = path.join(this.root, frozen.digest, "roles", entry.name, role[0].path);
        config[`agents.${entry.name}.description`] = entry.roleDisplayName == null ? parsed.description ?? entry.name : [entry.roleDisplayName, parsed.description].filter(Boolean).join(": ");
      } else if (entry.kind === "context") {
        const name = "task-context-" + canonicalDigest({ id: entry.id, digest: entry.digest }).slice(0, 16);
        const links = [];
        for (const f of entry.files) { add(`skills/${name}/references/${relative(f.path)}`, Buffer.from(f.content, f.encoding === "base64" ? "base64" : "utf8")); if (f.path.endsWith(".md") || entry.profileMetadata) links.push(`- [${f.path}](<references/${f.path}>)`); }
        const metadataNotice = entry.profileMetadata ? "Nested profile metadata is read-only reference material. The active profile alone selects runtime model, provider and dependencies.\n\n" : "";
        add(`skills/${name}/SKILL.md`, Buffer.from(`---\nname: ${name}\ndescription: ${JSON.stringify(`Context ${entry.name} selected for this task profile. Read relevant references for this task.`)}\n---\n\n${metadataNotice}Selected context source: ${entry.id}@${entry.digest}\n\n${links.join("\n")}\n`));
      }
    }
    for (const context of frozen.instructions) {
      if (typeof context.text !== "string" || !["persistent", "on-demand"].includes(context.loading)) throw Error("Invalid task context");
      if (context.loading === "on-demand" && !frozen.packages.some(p => p.id === context.id && p.kind === "context")) {
        const name = "task-reference-" + canonicalDigest(context).slice(0, 16);
        add(`skills/${name}/SKILL.md`, Buffer.from(`---\nname: ${name}\ndescription: Reference selected for this task profile. Read when relevant to this task.\n---\n\nRead [reference](reference.md) when relevant.\n`));
        add(`skills/${name}/reference.md`, Buffer.from(context.text));
      }
    }
    if (Object.keys(files).some(f => f.startsWith("skills/"))) config["skills.extra_roots"] = [path.join(this.root, frozen.digest, "skills")];
    if (Object.keys(binding).length) config["harness.models"] = { [model.model]: binding };
    const snapshot = { version: 1, profileId: frozen.profileId, digest: frozen.digest, model: model.model, provider: model.modelProvider, reasoningEffort: frozen.reasoningEffort ?? model.defaultReasoningEffort ?? null, config, context: frozen.instructions.filter(i => i.loading === "persistent").map(i => `[Task profile context: ${i.id}]\n${i.text}`).join("\n\n"), files };
    if (frozen.resourceSelection) snapshot.resourceSelection = frozen.resourceSelection;
    if (frozen.inheritModel) snapshot.inheritModel = true;
    if (frozen.capture?.profile?.allowedRoles) snapshot.allowedRoles = frozen.capture.profile.allowedRoles;
    if (providerAccount !== undefined) snapshot.providerAccount = providerAccount;
    snapshot.integrity = canonicalDigest(snapshot);
    const snapshotFile = path.join(this.root, frozen.digest, "snapshot.json"); await safe(snapshotFile);
    try { const old = JSON.parse(await fs.readFile(snapshotFile, "utf8")); if (canonicalDigest(old) !== canonicalDigest(snapshot)) throw Error("Immutable task snapshot changed"); } catch (e) { if (e.code !== "ENOENT") throw e;
      for (const [name, data] of Object.entries(files)) { const target = path.join(this.root, frozen.digest, name); await safe(target); await fs.mkdir(path.dirname(target), { recursive: true }); await safe(target); const expected = Buffer.from(data, "base64"); try { await fs.writeFile(target, expected, { flag: "wx" }); } catch (err) { if (err.code !== "EEXIST" || !(await fs.readFile(target)).equals(expected)) throw err; } }
      await fs.mkdir(path.dirname(snapshotFile), { recursive: true }); await fs.writeFile(snapshotFile, JSON.stringify(snapshot), { flag: "wx" });
    }
    await this.readSnapshot(frozen.digest);
    return snapshot;
  }
  async createWorkbench(capture, { cwd = null, config = {} } = {}) {
    if (!capture || !Number.isSafeInteger(capture.revision) || capture.revision < 0 || (capture.projectId != null && (typeof capture.projectId !== "string" || !capture.projectId)) || !Array.isArray(capture.components)) throw Error("Invalid workbench capture");
    if (capture.profile == null) return null;
    const frozen = JSON.parse(JSON.stringify(capture)), profile = frozen.profile;
    if (profile.diagnostics?.length) throw Error("Profile has unresolved resource diagnostics");
    if (profile.optionalSelection !== undefined && profile.optionalSelection !== "selected-only") throw Error("Invalid profile resource selection");
    if (typeof profile.id !== "string" || !profile.id || (profile.model != null && (typeof profile.model !== "string" || !profile.model))) throw Error("Invalid captured profile");
    const native = (await this.request("config/read", { cwd, includeLayers: false }))?.config ?? {};
    const model = profile.model ?? config.model ?? native.model ?? (await this.catalog()).find(m => m.isDefault)?.model;
    if (!model) throw Error("Inherited profile model is unavailable");
    const packages = frozen.components.map(component => {
      if (!["skill", "agent-role", "context", "playbook", "task-profile"].includes(component.kind) || !Array.isArray(component.files)) throw Error("Invalid captured component");
      if (typeof component.id !== "string" || !component.id || typeof component.name !== "string") throw Error("Invalid captured component identity");
      // Workbench names are display labels; role keys need portable native identifiers.
      const name = component.kind === "agent-role" ? `workbench_${canonicalDigest({ id: component.id }).slice(0, 20)}` : component.name;
      // Nested profile dependencies are already flattened by the workbench. Their
      // metadata is reference material; only capture.profile owns runtime settings.
      const entry = { id: component.id, kind: component.kind === "task-profile" ? "context" : component.kind, name, sharing: "local", files: component.files, ...(component.kind === "task-profile" ? { profileMetadata: true } : {}), ...(component.kind === "agent-role" ? { roleDisplayName: component.name } : {}) };
      entry.digest = packageDigest(entry); return entry;
    });
    const root = { id: profile.id, kind: "task-profile", name: profile.name, sharing: "local", files: [], profile: { model, ...(profile.harness == null ? {} : { harness: profile.harness }) } };
    root.digest = packageDigest(root); packages.unshift(root);
    const instructions = [];
    if (profile.instructions && !capture.roleProfile) instructions.push({ id: profile.id, text: profile.instructions, loading: "persistent" });
    const ordered = frozen.components.map((component, index) => ({ component, index })).sort((a, b) => (a.component.order ?? a.index) - (b.component.order ?? b.index));
    for (const {component} of ordered) if (["context", "playbook", "instruction"].includes(component.kind)) for (const file of component.files) if (file.encoding === "utf8" && /\.md$/i.test(file.path)) instructions.push({ id: component.id, text: file.content, loading: component.loading === "persistent" ? "persistent" : "on-demand" });
    const plan = { profileId: profile.id, model, ...(profile.provider == null ? {} : { provider: profile.provider }), ...(profile.reasoningEffort == null ? {} : { reasoningEffort: profile.reasoningEffort }), packages, instructions, capture: frozen };
    if (profile.model == null) plan.inheritModel = true;
    if (profile.optionalSelection === "selected-only") {
      const mcpServerIds = profile.mcpServerIds ?? [];
      if (!Array.isArray(mcpServerIds) || mcpServerIds.some(id => typeof id !== "string" || !id || /[\x00-\x1f\x7f]/.test(id)) || new Set(mcpServerIds).size !== mcpServerIds.length) throw Error("Invalid selected MCP servers");
      plan.resourceSelection = { mode: "selected-only", mcpServerIds };
    }
    if (Object.hasOwn(profile, "providerAccount")) plan.providerAccount = validateProviderAccount(profile.providerAccount);
    plan.digest = canonicalDigest(plan);
    for (const entry of packages.filter(p => p.kind === "agent-role")) {
      if (native.features?.multi_agent === false || config["features.multi_agent"] === false) throw Error("Task roles require enabled native multi-agent capability");
      if (native.agents?.[entry.name] != null || Object.keys(config).some(k => k.startsWith(`agents.${entry.name}.`))) throw Error("Task role conflicts with an existing native role");
    }
    const snapshot = await this.materialize(plan);
    return { digest: snapshot.digest, ...(capture.projectId == null ? {} : { projectId: capture.projectId }), revision: capture.revision };
  }
  bind(token, view) { const draft = this.drafts.get(token); if (!draft || draft.view != null || draft.expires < this.now() || view == null) throw Error("Task draft transfer is stale or already bound"); draft.view = view; }
  transfer(token, origin, project) {
    const draft = this.drafts.get(token);
    if (!draft || draft.view !== origin || draft.expires < this.now() || (project != null && (project.type !== "local" || typeof project.projectId !== "string"))) throw Error("Task transfer belongs to another origin or project");
    this.drafts.delete(token); const next = crypto.randomUUID(); this.drafts.set(next, { digest: draft.digest, expires: draft.expires, view: null, project: project ?? null }); return next;
  }
  bootstrap(view) { for (const [token, draft] of this.drafts) if (draft.view === view && !draft.bootstrap && draft.expires >= this.now()) { draft.bootstrap = true; return { token }; } return null; }
  discard(viewOrToken) { for (const [token, draft] of this.drafts) if (token === viewOrToken || draft.view === viewOrToken) this.drafts.delete(token); }
  async readSnapshot(digest) {
    if (!HASH.test(digest)) throw Error("Invalid stored task digest");
    const file = path.join(this.root, digest, "snapshot.json"); await safe(file); const snapshot = JSON.parse(await fs.readFile(file, "utf8"));
    if (snapshot.version !== 1 || snapshot.digest !== digest) throw Error("Task snapshot metadata changed");
    const { integrity, ...body } = snapshot; if (canonicalDigest(body) !== integrity) throw Error("Task snapshot integrity changed");
    for (const [name, data] of Object.entries(snapshot.files)) { const target = path.join(this.root, digest, relative(name)); await safe(target); if (!(await fs.readFile(target)).equals(Buffer.from(data, "base64"))) throw Error("Task snapshot file changed"); }
    return snapshot;
  }
  async registry() { const file = path.join(this.root, "threads.json"); await safe(file); try { const data = JSON.parse(await fs.readFile(file, "utf8")); if (data.version !== 1 || typeof data.threads !== "object") throw Error("Invalid task thread registry"); return data; } catch (e) { if (e.code !== "ENOENT") throw e; return { version: 1, threads: {} }; } }
  async prepare(view, hostId, id, method, params) {
    const marker = params?.__azraelTaskProfileDraft; let digest, savedCwd, firstTurn = false;
    if (marker != null) {
      if (method !== "thread/start" || hostId !== "local" || typeof marker.token !== "string" || Object.keys(marker).some(k => !["token", "project"].includes(k))) throw Error("Invalid task start marker");
      const draft = this.drafts.get(marker.token);
      if (!draft || draft.view !== view || draft.expires < this.now()) throw Error("Task draft belongs to another view or expired");
      if (Object.hasOwn(draft, "project") && JSON.stringify(marker.project ?? null) !== JSON.stringify(draft.project)) throw Error("Task start changed the transferred project");
      digest = draft.digest; this.drafts.delete(marker.token);
    } else if (["thread/resume", "turn/start"].includes(method) && hostId === "local") { const association = (await this.registry()).threads[params.threadId]; if (method === "thread/resume" || association?.firstTurnPending) { digest = association?.digest; savedCwd = association?.cwd; firstTurn = method === "turn/start"; } }
    if (!digest) return params;
    const snapshot = await this.readSnapshot(digest), effective = await this.request("config/read", { cwd: params.cwd ?? savedCwd ?? null, includeLayers: false });
    const nativeConfig = effective?.config ?? {};
    const catalog = await this.catalog();
    const rootModel = selectModel(catalog, snapshot.model, snapshot.provider, snapshot.reasoningEffort);
    if (Object.keys(snapshot.config).some(k => k.startsWith("agents.")) && (!["v1", "v2"].includes(rootModel.multiAgentVersion) || nativeConfig.features?.multi_agent === false || params.config?.["features.multi_agent"] === false)) throw Error("Task roles require enabled native multi-agent capability");
    for (const [, data] of Object.entries(snapshot.files).filter(([name]) => name.startsWith("roles/") && name.endsWith(".toml"))) {
      const role = toml.parse(Buffer.from(data, "base64").toString("utf8"));
      selectModel(catalog, role.model ?? snapshot.model, snapshot.provider, role.model_reasoning_effort);
    }
    if (firstTurn) {
      const result = { ...params, model: snapshot.model, effort: snapshot.reasoningEffort };
      if (params.collaborationMode != null) {
        const settings = { ...params.collaborationMode.settings, model: snapshot.model, reasoning_effort: snapshot.reasoningEffort };
        if (settings.developer_instructions != null) settings.developer_instructions = appendContext(appendContext(nativeConfig.developer_instructions ?? nativeConfig.developerInstructions, settings.developer_instructions), snapshot.context);
        result.collaborationMode = { ...params.collaborationMode, settings };
      }
      this.pending.set(String(id), { digest, threadId: params.threadId, firstTurn: true }); return result;
    }
    for (const key of Object.keys(snapshot.config).filter(k => k.startsWith("agents.") && k.endsWith(".config_file"))) {
      const role = key.slice(7, -12); if (nativeConfig.agents?.[role] != null) throw Error("Task role conflicts with an existing native role");
    }
    const { __azraelTaskProfileDraft: _, ...native } = params;
    const configured = nativeConfig.developer_instructions ?? nativeConfig.developerInstructions;
    const incoming = native.developerInstructions ?? native.config?.developer_instructions;
    const existing = appendContext(configured, incoming);
    const result = { ...native, model: snapshot.model, modelProvider: snapshot.provider, config: { ...(native.config ?? {}), ...snapshot.config } };
    if (snapshot.config["skills.extra_roots"] != null) {
      const roots = [...(nativeConfig.skills?.extra_roots ?? []), ...(native.config?.["skills.extra_roots"] ?? []), ...snapshot.config["skills.extra_roots"]];
      if (roots.some(root => typeof root !== "string" || !path.isAbsolute(root))) throw Error("Invalid effective task skill root");
      const seen = new Set(); result.config["skills.extra_roots"] = roots.filter(root => { const key = process.platform === "win32" ? path.normalize(root).toLowerCase() : path.normalize(root); if (seen.has(key)) return false; seen.add(key); return true; });
    }
    if (snapshot.config["harness.models"] != null) result.config["harness.models"] = { ...(nativeConfig.harness?.models ?? {}), ...(native.config?.["harness.models"] ?? {}), [snapshot.model]: { ...(nativeConfig.harness?.models?.[snapshot.model] ?? {}), ...(native.config?.["harness.models"]?.[snapshot.model] ?? {}), ...snapshot.config["harness.models"][snapshot.model] } };
    const combined = appendContext(existing, snapshot.context); if (combined) result.developerInstructions = combined;
    if (snapshot.reasoningEffort != null) result.config.model_reasoning_effort = snapshot.reasoningEffort;
    if (method === "thread/start") this.pending.set(String(id), { digest, cwd: params.cwd ?? null, firstTurnPending: true });
    return result;
  }
  async finish(response) {
    const association = this.pending.get(String(response.id)); if (!association) return response; this.pending.delete(String(response.id));
    if (response.error || response.result == null || (association.firstTurn ? !response.result?.turn?.id : !response.result?.thread?.id)) return response;
    const threadId = association.firstTurn ? association.threadId : response.result.thread.id;
    const operation = this.queue.then(async () => { const data = await this.registry(); if (association.firstTurn) { if (data.threads[threadId]?.digest === association.digest) data.threads[threadId].firstTurnPending = false; } else data.threads[threadId] = association; const file = path.join(this.root, "threads.json"), temp = file + "." + crypto.randomUUID() + ".tmp"; await safe(file); await fs.writeFile(temp, JSON.stringify(data), { flag: "wx" }); await fs.rename(temp, file); });
    this.queue = operation.catch(() => {}); await operation; return response;
  }
}
module.exports = { TaskProfileRuntime, selectModel, validateHarness, appendContext };
