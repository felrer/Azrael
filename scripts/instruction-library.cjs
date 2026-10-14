"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { promisify } = require("node:util");
const execFile = promisify(require("node:child_process").execFile);
const toml = require(require.resolve("smol-toml", { paths: [__dirname, path.join(__dirname, "../extensions/azrael-ex")] }));
const KINDS = new Set(["skill", "agent-role", "context", "task-profile"]);
const SHARING = new Set(["public", "collaborators", "local"]);
const sha = value => crypto.createHash("sha256").update(value).digest("hex");
const clone = value => JSON.parse(JSON.stringify(value));
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  return JSON.stringify(value);
}
const hash = value => sha(canonical(value));
function freeze(value) { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function relative(value) {
  if (typeof value !== "string" || !value || value.length > 240 || value.includes("\\") || value.startsWith("/") || /^[a-z]:/i.test(value)) throw new Error("Unsafe package path");
  for (const part of value.split("/")) if (!part || part === "." || part === ".." || /[<>:"|?*\x00-\x1f]/.test(part) || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)) throw new Error(`Unsafe package path: ${value}`);
  return value;
}
function identity(id) { if (typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid package identity"); return id; }
function digest(value) { if (!/^[a-f0-9]{64}$/.test(value || "")) throw new Error("Invalid pinned digest"); return value; }
async function safe(target) {
  target = path.resolve(target); let current = path.parse(target).root;
  for (const segment of target.slice(current.length).split(path.sep).filter(Boolean)) {
    try { const names = await fs.readdir(current); if (names.some(n => n.toLowerCase() === segment.toLowerCase() && n !== segment)) throw new Error("Case alias path rejected"); } catch(e) { if (e.code !== "ENOENT") throw e; }
    current = path.join(current, segment);
    try { if ((await fs.lstat(current)).isSymbolicLink()) throw new Error("Symlink path rejected"); } catch(e) { if (e.code !== "ENOENT") throw e; }
  }
  return target;
}
async function bytes(file) { await safe(file); try { const stat = await fs.stat(file); if (!stat.isFile() || stat.size > 16 * 1024 * 1024) throw new Error("Invalid or oversized file"); return await fs.readFile(file); } catch(e) { if (e.code === "ENOENT") return null; throw e; } }
async function unlink(file) { await safe(file); try { await fs.unlink(file); } catch(e) { if (e.code !== "ENOENT") throw e; } }
async function write(file, value) { await safe(file); await fs.mkdir(path.dirname(file), { recursive: true }); await safe(file); await fs.writeFile(file, value); }
async function atomic(file, value) {
  const temp = `${file}.${crypto.randomUUID()}.tmp`; await write(temp, value);
  try { await safe(file); await fs.rename(temp, file); } finally { await unlink(temp); }
}
function content(file) { return Buffer.from(file.content, file.encoding === "base64" ? "base64" : "utf8"); }
function inventory(files) {
  if (!Array.isArray(files) || files.length > 10000) throw new Error("Invalid file inventory");
  const seen = new Set(), spellings = new Map(); let size = 0;
  return files.map(file => {
    const name = relative(file.path); const key = name.toLowerCase();
    if (seen.has(key)) throw new Error("Case-colliding package files"); seen.add(key);
    const parts = name.split("/");
    for (let i = 1; i <= parts.length; i++) { const prefix = parts.slice(0, i).join("/"), lower = prefix.toLowerCase(); if (spellings.has(lower) && spellings.get(lower) !== prefix) throw new Error("Case-colliding package paths"); spellings.set(lower, prefix); }
    for (const other of seen) if (other !== key && (other.startsWith(key + "/") || key.startsWith(other + "/"))) throw new Error("File and directory collision");
    if (!["utf8", "base64"].includes(file.encoding) || typeof file.content !== "string") throw new Error("Invalid file encoding");
    if (file.encoding === "base64" && Buffer.from(file.content, "base64").toString("base64") !== file.content) throw new Error("Invalid base64 content");
    const data = content(file); size += data.length; if (data.length > 16 * 1024 * 1024 || size > 128 * 1024 * 1024) throw new Error("Package size limit");
    return { path: name, encoding: file.encoding, content: file.content };
  }).sort((a,b) => a.path.localeCompare(b.path, "en"));
}
function frontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match) throw new Error("SKILL.md requires frontmatter");
  const result = {}; for (const line of match[1].split(/\r?\n/)) { const item = /^(name|description):\s*(.+)$/.exec(line); if (item) result[item[1]] = item[2].replace(/^(["'])(.*)\1$/, "$2"); }
  if (!result.name || !result.description) throw new Error("Skill name and description required"); return result;
}
function engineName(entry) {
  let name = entry.name;
  if (entry.kind === "skill") name = frontmatter(content(entry.files.find(f => f.path === "SKILL.md")).toString("utf8")).name;
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(name)) throw new Error("Invalid installation name"); return name;
}
function validation(entry) {
  const errors = [];
  try {
    if (entry.kind === "skill") { if (!entry.files.some(f => f.path === "SKILL.md")) throw new Error("Missing SKILL.md"); engineName(entry); }
    if (entry.kind === "agent-role") {
      engineName(entry); const role = entry.files.find(f => f.path.endsWith(".toml")); if (!role || entry.files.filter(f => f.path.endsWith(".toml")).length !== 1) throw new Error("One role TOML required");
      const parsed = toml.parse(content(role).toString("utf8")); if (typeof parsed.developer_instructions !== "string" || !parsed.developer_instructions.trim()) throw new Error("Role developer_instructions required");
      if (Object.keys(parsed).some(k => !["model", "model_reasoning_effort", "developer_instructions", "description"].includes(k))) throw new Error("Role contains machine configuration");
    }
    if (entry.kind === "context" && !entry.files.length) throw new Error("Context content required");
    if (entry.kind === "task-profile") {
      const p = entry.profile; if (!p || typeof p.model !== "string" || !p.model.trim() || !Array.isArray(p.dependencies)) throw new Error("Profile model and pinned dependencies required");
      for (const ref of p.dependencies) { identity(ref.id); digest(ref.digest); if (ref.optional !== undefined && typeof ref.optional !== "boolean") throw new Error("Invalid optional dependency"); }
      if (p.instructions !== undefined && typeof p.instructions !== "string") throw new Error("Invalid profile instructions");
      if (Object.keys(p).some(k => !["model", "provider", "reasoningEffort", "dependencies", "instructions", "harness"].includes(k))) throw new Error("Private or unknown profile bindings rejected");
    }
  } catch(e) { errors.push(e.message); }
  return errors;
}
function packageData(entry) { const data = { name: entry.name, kind: entry.kind, sharing: entry.sharing, files: entry.files }; if (entry.profile !== undefined) data.profile = entry.profile; return data; }
function makeEntry(input, id, version) {
  if (!KINDS.has(input.kind) || !SHARING.has(input.sharing) || typeof input.name !== "string" || !input.name.trim()) throw new Error("Invalid package metadata");
  const entry = { id, version, name: input.name, kind: input.kind, sharing: input.sharing, files: inventory(input.files || []) };
  if (input.profile !== undefined) entry.profile = clone(input.profile);
  entry.digest = hash(packageData(entry)); entry.validationErrors = validation(entry); return entry;
}
function metadata(entry) { const { files, ...meta } = entry; return meta; }
function sealed(value) { const result = clone(value); result.digest = hash(value); return freeze(result); }
function verifyPlan(plan) { const { digest: expected, ...body } = plan; if (hash(body) !== expected) throw new Error("Plan identity mismatch"); }

class InstructionLibrary {
  constructor({ root, installedRoot, appVersion = "0.4.0" } = {}) {
    if (!root || !installedRoot || !path.isAbsolute(root) || !path.isAbsolute(installedRoot)) throw new Error("Absolute library and installed roots required");
    this.root = path.resolve(root); this.installedRoot = path.resolve(installedRoot); this.appVersion = appVersion;
    const a = this.root.toLowerCase(), b = this.installedRoot.toLowerCase();
    if (a === b || a.startsWith(b + path.sep) || b.startsWith(a + path.sep) || this.root === path.parse(this.root).root || this.installedRoot === path.parse(this.installedRoot).root) throw new Error("Protected roots must be separate");
  }
  file(name) { return path.join(this.root, relative(name)); }
  async _state() {
    await safe(this.root); await safe(this.installedRoot);
    await this._protect();
    const data = await bytes(this.file("registry.json")); const state = data ? JSON.parse(data) : { schemaVersion: 1, revision: 0, entries: [], managed: {} };
    if (state.schemaVersion !== 1 || !Number.isSafeInteger(state.revision) || !Array.isArray(state.entries) || !state.managed) throw new Error("Invalid library registry"); return state;
  }
  async _protect() {
    if ([this.root, this.installedRoot].some(p => p.split(path.sep).some(part => part.toLowerCase() === ".git"))) throw new Error("Git metadata root protected");
    let candidate = this.root;
    while (true) {
      let repository = false;
      try { await fs.lstat(path.join(candidate, ".git")); repository = true; } catch(e) { if (e.code !== "ENOENT") throw e; }
      if (repository) {
        const { stdout } = await execFile("git", ["-C", candidate, "ls-files", "--", path.relative(candidate, this.root) || "."], { windowsHide: true, maxBuffer: 1024 * 1024 });
        if (stdout.trim()) throw new Error("Tracked library roots are protected");
        const prospective = ["registry.json", "packages/protection-check.json"].map(name => path.relative(candidate, path.join(this.root, name)).split(path.sep).join("/"));
        let ignored;
        try { ignored = (await execFile("git", ["-c", "core.quotePath=false", "-C", candidate, "check-ignore", "--", ...prospective], { windowsHide: true })).stdout.trim().split(/\r?\n/); }
        catch(e) { if (e.code === 1) throw new Error("Library storage must be Git-ignored before use"); throw e; }
        if (!prospective.every(file => ignored.includes(file))) throw new Error("Library storage must be Git-ignored before use"); return;
      }
      const parent = path.dirname(candidate); if (parent === candidate) return; candidate = parent;
    }
  }
  async _lock(action, recovery = false) {
    await safe(this.root); await this._protect(); await fs.mkdir(this.root, { recursive: true }); const lock = this.file("lock.json");
    let handle; try { handle = await fs.open(lock, "wx"); } catch(e) { if (e.code === "EEXIST") throw new Error("Library is locked; recover interrupted operation first"); throw e; }
    try { await handle.writeFile(JSON.stringify({ pid: process.pid })); if (!recovery && await bytes(this.file("journal.json"))) throw new Error("Interrupted apply requires recovery"); return await action(); } finally { await handle.close(); await unlink(lock); }
  }
  writerFile(name) { return path.join(this.installedRoot, "azrael", "instructions", name); }
  async recoveryState() {
    const shared = await bytes(this.writerFile("writer.lock")); let sharedWriterOwned = false;
    if (shared) { try { const value = JSON.parse(shared); sharedWriterOwned = value.owner === "instruction-library" && value.libraryRoot === this.root; } catch { /* Unknown writer locks remain protected. */ } }
    return { recoveryRequired: !!(await bytes(this.file("journal.json")) || await bytes(this.file("lock.json")) || sharedWriterOwned), sharedWriterOwned };
  }
  async _writer(action, recovery = false) {
    const lockFile = this.writerFile("writer.lock"); await safe(lockFile); await fs.mkdir(path.dirname(lockFile), { recursive: true });
    if (recovery) {
      const data = await bytes(lockFile);
      if (data) {
        let value; try { value = JSON.parse(data); } catch { throw new Error("Unknown instruction writer lock is protected"); }
        if (value.owner !== "instruction-library" || value.libraryRoot !== this.root) throw new Error("Another instruction writer lock is protected");
        if (!Number.isSafeInteger(value.pid) || value.pid <= 0) throw new Error("Invalid personal instruction writer lock");
        try { process.kill(value.pid, 0); throw new Error("Instruction writer is still active"); } catch(e) { if (e.code !== "ESRCH") throw e; }
        const current = await bytes(lockFile); if (!current || !current.equals(data)) throw new Error("Instruction writer lock changed during recovery"); await unlink(lockFile);
      }
    }
    let handle;
    try { handle = await fs.open(lockFile, "wx"); } catch(e) { if (e.code === "EEXIST") throw new Error("Instruction writer lock exists; inspect recovery data before applying"); throw e; }
    try {
      await handle.writeFile(JSON.stringify({ pid: process.pid, owner: "instruction-library", libraryRoot: this.root, createdAt: new Date().toISOString() }));
      if (await bytes(this.writerFile("journal.json"))) throw new Error("Baseline instruction recovery required before personal installation mutation");
      return await action();
    } finally { await handle.close(); await unlink(lockFile); }
  }
  async _commit(state) { state.revision++; await atomic(this.file("registry.json"), JSON.stringify(state, null, 2)); }
  async _version(id, pinned) {
    identity(id); digest(pinned); const data = await bytes(this.file(`packages/${id}/${pinned}.json`)); if (!data) throw new Error("Missing dependency version");
    const entry = JSON.parse(data); if (entry.id !== id || entry.digest !== pinned || hash(packageData(entry)) !== pinned) throw new Error("Package version integrity mismatch"); return entry;
  }
  async getState() { const s = await this._state(); return { schemaVersion: 1, revision: s.revision, entries: clone(s.entries) }; }
  async list() { return (await this.getState()).entries; }
  async read(id) { const s = await this._state(); const meta = s.entries.find(e => e.id === identity(id)); if (!meta) throw new Error("Unknown package"); return { ...await this._version(id, meta.digest), ...clone(meta) }; }
  async create(input) {
    return this._lock(async () => {
      const state = await this._state(); const entry = makeEntry({ ...input, sharing: input.sharing || "collaborators" }, crypto.randomUUID(), 1);
      await atomic(this.file(`packages/${entry.id}/${entry.digest}.json`), JSON.stringify(entry));
      state.entries.push({ ...metadata(entry), installedDigest: null, publications: [] }); await this._commit(state); return { ...entry, ...state.entries.at(-1) };
    });
  }
  async save(id, changes, expectedRevision) {
    return this._lock(async () => {
      const state = await this._state(); if (state.revision !== expectedRevision) throw new Error("Library revision conflict");
      const index = state.entries.findIndex(e => e.id === identity(id)); if (index < 0) throw new Error("Unknown package"); const old = state.entries[index];
      if (Object.keys(changes).some(k => !["name", "kind", "sharing", "files", "profile"].includes(k))) throw new Error("Immutable package field");
      const supplied = Object.fromEntries(Object.entries(changes).filter(([,v]) => v !== undefined));
      const entry = makeEntry({ ...await this._version(id, old.digest), ...supplied }, id, old.version + 1);
      if (entry.digest === old.digest) return { ...await this._version(id, old.digest), ...old };
      const versionPath = this.file(`packages/${id}/${entry.digest}.json`);
      if (!await bytes(versionPath)) await atomic(versionPath, JSON.stringify(entry));
      state.entries[index] = { ...old, ...metadata(entry), historicalOnly: false }; await this._commit(state); return { ...entry, ...state.entries[index] };
    });
  }
  async importPackage(input, provenance) {
    identity(input.id); digest(input.digest);
    if (!Number.isSafeInteger(input.version) || input.version < 1 || !provenance || !/^[\w.-]+\/[\w.-]+$/.test(provenance.repository || "") || typeof provenance.version !== "string" || typeof provenance.commit !== "string") throw new Error("Invalid remote package provenance");
    const entry = makeEntry(input, input.id, input.version);
    if (entry.digest !== input.digest || entry.validationErrors.length) throw new Error("Remote package integrity or validation mismatch");
    return this._lock(async () => {
      const state = await this._state(); let meta = state.entries.find(e => e.id === entry.id);
      const isCurrent = provenance.current !== false;
      if (isCurrent && meta && meta.digest !== entry.digest && !meta.historicalOnly) throw new Error("Remote package conflicts with local version; explicit review required");
      const publication = { destination: provenance.repository, version: provenance.version, commit: provenance.commit, digest: entry.digest, sharing: entry.sharing };
      const location = this.file(`packages/${entry.id}/${entry.digest}.json`);
      if (!await bytes(location)) await atomic(location, JSON.stringify(entry)); else await this._version(entry.id, entry.digest);
      if (!meta) { meta = { ...metadata(entry), installedDigest: null, publications: [], historicalOnly: !isCurrent }; state.entries.push(meta); }
      else if (isCurrent && meta.historicalOnly) Object.assign(meta, metadata(entry), { historicalOnly: false });
      if (meta.publications.some(p => p.digest === entry.digest && p.destination !== provenance.repository)) throw new Error("Remote package source conflict");
      if (!meta.publications.some(p => canonical(p) === canonical(publication))) meta.publications.push(publication);
      await this._commit(state); return { ...entry, installedDigest: meta.installedDigest, publications: clone(meta.publications) };
    });
  }
  async importPath(source, options = {}) {
    source = await safe(source); const stat = await fs.lstat(source); const files = [];
    const walk = async (directory, prefix = "") => {
      for (const name of (await fs.readdir(directory)).sort()) {
        const target = path.join(directory, name), rel = relative(prefix + name); const s = await fs.lstat(target);
        if (s.isSymbolicLink()) throw new Error("Symlink import rejected");
        if (s.isDirectory()) await walk(target, rel + "/"); else if (s.isFile()) await add(target, rel); else throw new Error("Special file import rejected");
      }
    };
    const add = async (target, rel) => { const data = await bytes(target); const text = data.toString("utf8"); const utf = Buffer.from(text).equals(data) && !data.includes(0); files.push({ path: rel, encoding: utf ? "utf8" : "base64", content: utf ? text : data.toString("base64") }); };
    if (stat.isDirectory()) await walk(source); else if (stat.isFile()) await add(source, path.basename(source)); else throw new Error("Invalid import source");
    const kind = options.kind || (files.some(f => f.path === "SKILL.md") ? "skill" : files.length === 1 && files[0].path.endsWith(".toml") ? "agent-role" : "context");
    return this.create({ ...options, kind, name: options.name || path.basename(source).replace(/\.toml$/, ""), files });
  }
  async _closure(ids, state, sharing) {
    const found = new Map(), visiting = new Set(), versions = new Map();
    const visit = async (id, pinned, optional = false) => {
      identity(id); const current = state.entries.find(e => e.id === id);
      if (!current) { if (optional) return; throw new Error("Missing required dependency"); }
      if (sharing && (current.sharing === "local" || sharing === "public" && current.sharing !== "public")) throw new Error("Dependency sharing mismatch");
      const d = pinned || current.digest; digest(d);
      if (visiting.has(id)) throw new Error("Dependency cycle");
      if (!sharing && versions.has(id) && versions.get(id) !== d) throw new Error("Dependency version mismatch");
      const key = id + ":" + d; if (found.has(key)) return;
      let entry; try { entry = await this._version(id, d); } catch(e) { if (optional && e.message === "Missing dependency version") return; throw e; }
      if (entry.validationErrors.length || validation(entry).length) throw new Error("Invalid package: " + id);
      if (sharing && entry.sharing !== sharing) throw new Error("Package sharing mismatch");
      visiting.add(id); versions.set(id, d);
      for (const ref of entry.profile?.dependencies || []) await visit(ref.id, ref.digest, ref.optional);
      visiting.delete(id); found.set(key, entry);
    };
    if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length) throw new Error("Explicit unique package selection required");
    for (const id of ids) await visit(id); return [...found.values()];
  }
  async resolveProfile(id, overrides = {}) {
    if (Object.keys(overrides).some(k => !["model", "provider", "reasoningEffort"].includes(k))) throw new Error("Invalid profile override");
    const state = await this._state(), entry = await this.read(id); if (entry.kind !== "task-profile") throw new Error("Task profile required");
    const packages = await this._closure([id], state); const effective = { ...entry.profile, ...overrides }; if (typeof effective.model !== "string" || !effective.model.trim()) throw new Error("Explicit model selection required");
    const instructions = [];
    for (const p of packages) {
      if (p.kind === "task-profile" && p.profile.instructions) instructions.push({ id: p.id, text: p.profile.instructions, loading: "persistent" });
      if (p.kind === "context") for (const f of p.files.filter(f => f.encoding === "utf8" && /\.md$/.test(f.path))) instructions.push({ id: p.id, text: f.content, loading: "on-demand" });
    }
    const result = { profileId: id, model: effective.model, packages, instructions }; for (const k of ["provider", "reasoningEffort"]) if (effective[k] !== undefined) result[k] = effective[k];
    return sealed(result);
  }
  async planPublish(ids, sharing) {
    if (!["public", "collaborators"].includes(sharing)) throw new Error("Local packages cannot be published"); const state = await this._state();
    const packages = await this._closure(ids, state, sharing);
    for (const entry of packages) {
      if (entry.files.some(f => /(^|\/)(?:\.env(?:\..*)?|credentials(?:\..*)?|config\.toml|auth\.json|registry\.json)$/i.test(f.path))) throw new Error("Private configuration excluded from publication");
      const privateContent = /(?:[a-z]:\\\\|\/(?:Users|home)\/|sk-[a-zA-Z0-9]{20,}|gh[pousr]_[a-zA-Z0-9]{20,})/;
      if ([canonical(packageData(entry)), ...entry.files.map(f => canonical(content(f).toString("utf8")))].some(value => privateContent.test(value))) throw new Error("Private paths or credentials excluded from publication");
    }
    const heads = Object.fromEntries(ids.map(id => [id, state.entries.find(e => e.id === id).digest]));
    return sealed({ schemaVersion: 1, revision: state.revision, sharing, rootIds: [...ids], heads, packages });
  }
  async recordPublication(plan, receipt) {
    verifyPlan(plan); if (!receipt || typeof receipt.destination !== "string" || !receipt.destination || typeof receipt.version !== "string" || typeof receipt.commit !== "string") throw new Error("Publication receipt requires destination, version and commit");
    return this._lock(async () => {
      const state = await this._state(); let changed = false;
      for (const p of plan.packages) {
        await this._version(p.id, p.digest); const e = state.entries.find(e => e.id === p.id); if (!e) throw new Error("Unknown published package");
        const publication = { destination: receipt.destination, version: receipt.version, commit: receipt.commit, digest: p.digest, sharing: plan.sharing, planDigest: plan.digest };
        if (!e.publications.some(r => canonical(r) === canonical(publication))) { e.publications.push(publication); changed = true; }
      }
      if (changed) await this._commit(state); return this.getState();
    });
  }
  _targets(entry) {
    if (entry.kind === "skill") return entry.files.map(f => ({ relative: `skills/${engineName(entry)}/${f.path}`, data: content(f) }));
    if (entry.kind === "agent-role") {
      const name = engineName(entry); return entry.files.map(f => ({ relative: f.path.endsWith(".toml") ? `agents/${name}.toml` : `agents/${name}/${f.path}`, data: content(f) }));
    }
    return [];
  }
  async planApply(ids) {
    const state = await this._state(), entries = await this._closure(ids, state), conflicts = [], diffs = [], adoptions = [], releases = [], targets = new Map(); const selected = new Set(entries.map(e => e.id));
    for (const entry of entries) for (const target of this._targets(entry)) {
      const key = target.relative.toLowerCase(); if (targets.has(key)) conflicts.push(`Duplicate destination ownership: ${target.relative}`); targets.set(key, { ...target, id: entry.id });
    }
    for (const [rel, managed] of Object.entries(state.managed)) if (selected.has(managed.id) && !targets.has(rel.toLowerCase())) {
      let original = null;
      if (managed.original !== undefined && managed.original !== null) {
        original = Buffer.from(managed.original, "base64"); if (original.toString("base64") !== managed.original || sha(original) !== managed.originalDigest) throw new Error("Managed original integrity mismatch");
      }
      targets.set(rel.toLowerCase(), { relative: rel, data: original, id: managed.id }); releases.push(rel);
    }
    for (const target of targets.values()) {
      const old = await bytes(path.join(this.installedRoot, relative(target.relative))), managed = state.managed[target.relative];
      if (managed && managed.id !== target.id) conflicts.push(`Destination owned by another package: ${target.relative}`);
      const next = target.data ? sha(target.data) : null;
      if (managed ? (old ? sha(old) : null) !== managed.sha256 : old !== null && sha(old) !== next) conflicts.push(`External or unmanaged destination: ${target.relative}`);
      if (!managed && old !== null && sha(old) === next) adoptions.push({ path: target.relative, id: target.id, digest: next, original: old.toString("base64") });
      if ((old ? sha(old) : null) !== next) diffs.push({ path: target.relative, id: target.id, beforeDigest: old ? sha(old) : null, afterDigest: next, encoding: "base64", beforeContent: old ? old.toString("base64") : null, content: target.data ? target.data.toString("base64") : null });
    }
    return sealed({ schemaVersion: 1, revision: state.revision, rootIds: [...ids], entries, conflicts, diffs, adoptions, releases });
  }
  async apply(plan) {
    verifyPlan(plan); if (plan.conflicts.length) throw new Error("Apply has destination conflicts");
    return this._lock(() => this._writer(async () => {
      const state = await this._state(); if (state.revision !== plan.revision) throw new Error("Library revision conflict");
      const fresh = await this.planApply(plan.rootIds); if (fresh.digest !== plan.digest) throw new Error("Apply preview changed or external edit detected");
      const journal = { schemaVersion: 1, state: clone(state), diffs: [], adoptions: clone(plan.adoptions), releases: clone(plan.releases) };
      for (const diff of plan.diffs) { const old = await bytes(path.join(this.installedRoot, relative(diff.path))); journal.diffs.push({ ...diff, beforeContent: old ? old.toString("base64") : null }); }
      await atomic(this.file("journal.json"), JSON.stringify(journal));
      try {
        for (const adoption of plan.adoptions) {
          const current = await bytes(path.join(this.installedRoot, relative(adoption.path)));
          if (!current || sha(current) !== adoption.digest || current.toString("base64") !== adoption.original) throw new Error("External edit during adoption");
          state.managed[adoption.path] = { id: adoption.id, sha256: adoption.digest, original: adoption.original, originalDigest: adoption.digest };
        }
        for (const diff of plan.diffs) {
          const target = path.join(this.installedRoot, relative(diff.path)); const old = await bytes(target);
          if ((old ? sha(old) : null) !== diff.beforeDigest) throw new Error("External edit during apply");
          if (diff.content === null) { await unlink(target); delete state.managed[diff.path]; }
          else {
            const previous = state.managed[diff.path]; await atomic(target, Buffer.from(diff.content, "base64"));
            state.managed[diff.path] = { id: diff.id, sha256: diff.afterDigest, original: previous?.original ?? null, originalDigest: previous?.originalDigest ?? null };
          }
        }
        for (const target of plan.releases) delete state.managed[target];
        for (const entry of plan.entries) { const meta = state.entries.find(e => e.id === entry.id); meta.installedDigest = entry.digest; }
        await this._commit(state); await unlink(this.file("journal.json")); return { digest: plan.digest, revision: state.revision, applied: plan.entries.map(e => ({ id: e.id, digest: e.digest })) };
      } catch(e) { await this._rollback(journal); throw e; }
    }));
  }
  async _rollback(journal) {
    if (journal.schemaVersion !== 1 || journal.state?.schemaVersion !== 1 || !Number.isSafeInteger(journal.state.revision) || !Array.isArray(journal.state.entries) || !Array.isArray(journal.diffs)) throw new Error("Invalid recovery journal");
    for (const diff of journal.diffs) {
      relative(diff.path);
      if (!/^(?:skills\/[^/]+\/.+|agents\/[^/]+\.toml|agents\/[^/]+\/.+)$/.test(diff.path)) throw new Error("Recovery target scope rejected");
      for (const [field, expected] of [["beforeContent", "beforeDigest"], ["content", "afterDigest"]]) {
        if (diff[field] === null) { if (diff[expected] !== null) throw new Error("Recovery backup integrity mismatch"); }
        else if (typeof diff[field] !== "string" || Buffer.from(diff[field], "base64").toString("base64") !== diff[field] || sha(Buffer.from(diff[field], "base64")) !== diff[expected]) throw new Error("Recovery backup integrity mismatch");
      }
    }
    for (const diff of [...journal.diffs].reverse()) {
      const target = path.join(this.installedRoot, relative(diff.path)), current = await bytes(target), currentHash = current ? sha(current) : null;
      if (currentHash === diff.beforeDigest) continue;
      if (currentHash !== diff.afterDigest) throw new Error("Recovery blocked by external edit");
      if (diff.beforeContent === null) await unlink(target); else await atomic(target, Buffer.from(diff.beforeContent, "base64"));
    }
    await atomic(this.file("registry.json"), JSON.stringify(journal.state)); await unlink(this.file("journal.json"));
  }
  async recover() {
    const lock = await bytes(this.file("lock.json"));
    if (lock) { const pid = JSON.parse(lock).pid; if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error("Invalid recovery lock"); try { process.kill(pid, 0); throw new Error("Library operation still active"); } catch(e) { if (e.code !== "ESRCH") throw e; } await unlink(this.file("lock.json")); }
    return this._lock(() => this._writer(async () => { const data = await bytes(this.file("journal.json")); if (!data) return { recovered: false }; await this._rollback(JSON.parse(data)); return { recovered: true }; }, true), true);
  }
}
module.exports = { InstructionLibrary, packageDigest: entry => hash(packageData(entry)), verifyPlan, canonicalDigest: hash };
