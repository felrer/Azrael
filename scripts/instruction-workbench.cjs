"use strict";

// Standalone development state only. No installation or engine activation occurs here.
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { InstructionLibrary, packageDigest } = require("./instruction-library.cjs");
const { InstructionPublisher } = require("./instruction-publisher.cjs");
const toml = require(require.resolve("smol-toml", { paths: [__dirname, path.join(__dirname, "../extensions/azrael-ex")] }));
const MANIFEST = "AZRAEL-PACKAGE.json";
const DEFAULT_PROFILE = "__azrael_default__";
const BASELINE_PACKAGE = "baseline-package:azrael-environment";
const kinds = new Set(["instruction", "skill", "agent-role", "context", "playbook", "task-profile"]);
const copy = value => JSON.parse(JSON.stringify(value));
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
const frozen = value => { if (value && typeof value === "object") { Object.values(value).forEach(frozen); Object.freeze(value); } return value; };
function text(value, name, max = 1000, empty = false) {
  if (typeof value !== "string" || value.length > max || (!empty && !value.trim())) throw Error(`${name}을 확인하세요.`);
  return value;
}
function relative(value) {
  text(value, "파일 경로", 240);
  if (value.includes("\\") || value.startsWith("/") || value.split("/").some(s => !s || s === "." || s === ".." || /[<>:"|?*\x00-\x1f]/.test(s) || /[. ]$/.test(s) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s))) throw Error("안전하지 않은 파일 경로입니다.");
  return value;
}
function files(input) {
  if (!Array.isArray(input) || input.length > 10000) throw Error("파일 목록을 확인하세요.");
  const seen = new Map(); let total = 0;
  return input.map(f => {
    const p = relative(f.path), lower = p.toLowerCase();
    for (const existing of seen.keys()) if (existing === lower || existing.startsWith(lower + "/") || lower.startsWith(existing + "/")) throw Error("중복 또는 충돌하는 파일 경로입니다.");
    for (const [existing, spelling] of seen) { const a = existing.split("/"), b = lower.split("/"), x = spelling.split("/"), y = p.split("/"); for (let i = 0; i < Math.min(a.length, b.length) && a[i] === b[i]; i++) if (x[i] !== y[i]) throw Error("대소문자가 충돌하는 파일 경로입니다."); }
    seen.set(lower, p);
    if (!["utf8", "base64"].includes(f.encoding) || typeof f.content !== "string") throw Error("파일 인코딩을 확인하세요.");
    const data = Buffer.from(f.content, f.encoding);
    if (f.encoding === "base64" && data.toString("base64") !== f.content) throw Error("잘못된 base64 파일입니다.");
    total += data.length;
    if (data.length > 16 * 1024 * 1024 || total > 128 * 1024 * 1024) throw Error("파일 용량 제한을 초과했습니다.");
    return { path: p, encoding: f.encoding, content: f.content };
  });
}
function imageType(data) {
  if (!data.length || data.length > 2 * 1024 * 1024) throw Error("이미지는 2MiB 이하여야 합니다.");
  if (data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return "png";
  if (data[0] === 255 && data[1] === 216 && data[2] === 255) return "jpeg";
  if (data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP") return "webp";
  throw Error("PNG, JPEG, WebP 이미지만 지원합니다.");
}
function decodeImage(value) {
  const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]*={0,2})$/.exec(value || "");
  if (!m || m[2].length > 2800000) throw Error("이미지 데이터 형식을 확인하세요.");
  const data = Buffer.from(m[2], "base64");
  if (data.toString("base64") !== m[2] || imageType(data) !== m[1]) throw Error("이미지 형식과 내용이 다릅니다.");
  return { path: `assets/image.${m[1]}`, encoding: "base64", content: m[2] };
}
function validatedImage(value) { decodeImage(value); return value; }
function profile(input, componentIds) {
  const result = { id: input.id || crypto.randomUUID(), name: text(input.name, "프로필 이름", 160), componentIds: input.componentIds === undefined ? [...componentIds] : input.componentIds };
  result.allowedRoles = allowedRoles(input.allowedRoles);
  if (input.image) result.image = validatedImage(input.image);
  if (input.model !== undefined) result.model = text(input.model, "명시적인 모델", 200);
  if (input.model === undefined && (input.provider !== undefined || input.providerAccount !== undefined || input.reasoningEffort !== undefined)) throw Error("Provider 설정에는 모델 선택이 필요합니다.");
  text(result.id, "프로필 ID", 160);
  if (!Array.isArray(result.componentIds) || new Set(result.componentIds).size !== result.componentIds.length || result.componentIds.some(id => !componentIds.includes(id))) throw Error("프로필 구성요소가 없거나 중복되었습니다.");
  for (const k of ["provider", "reasoningEffort", "instructions"]) if (input[k] !== undefined) result[k] = text(input[k], k, k === "instructions" ? 1000000 : 200, k === "instructions");
  if (input.providerAccount !== undefined) {
    const account = input.providerAccount;
    if (!account || typeof account !== "object" || Array.isArray(account)) throw Error("Provider 계정을 확인하세요.");
    result.providerAccount = { providerId: text(account.providerId, "Provider ID", 200), accountId: text(account.accountId, "계정 ID", 500) };
  }
  return result;
}
function validateComponents(components) {
  if (!Array.isArray(components) || components.length > 1000) throw Error("구성요소 목록을 확인하세요.");
  const ids = new Set(), skills = new Set();
  for (const c of components) {
    text(c.id, "구성요소 ID", 160); text(c.name, "구성요소 이름", 160);
    if (ids.has(c.id) || !kinds.has(c.kind)) throw Error("구성요소 ID 또는 종류가 잘못되었습니다.");
    ids.add(c.id); files(c.files);
    if (!c.files.length && c.kind !== "task-profile") throw Error("구성요소 파일이 필요합니다.");
    if (c.kind === "skill") {
      const main = c.files.find(f => /(?:^|\/)SKILL\.md$/.test(f.path));
      const body = main?.encoding === "utf8" && /^---\r?\n([\s\S]*?)\r?\n---/.exec(main.content);
      const name = body && /^name:\s*["']?([a-z0-9][a-z0-9_-]{0,63})["']?\s*$/m.exec(body[1]);
      if (!name || !/^description:\s*\S/m.test(body[1])) throw Error("SKILL.md 이름과 설명이 필요합니다.");
      if (skills.has(name[1])) throw Error("중복 스킬 이름입니다.");
      skills.add(name[1]);
    }
    if (c.kind === "agent-role") {
      const roles = c.files.filter(f => f.path.endsWith(".toml"));
      if (roles.length !== 1 || roles[0].encoding !== "utf8") throw Error("역할 TOML 파일 하나가 필요합니다.");
      const role = toml.parse(roles[0].content);
      if (typeof role.developer_instructions !== "string" || !role.developer_instructions.trim() || Object.keys(role).some(k => !["name", "model", "model_reasoning_effort", "developer_instructions", "description"].includes(k))) throw Error("역할 지침 또는 설정을 확인하세요.");
    }
    if (c.kind === "playbook" && !c.files.some(f => /\.md$/i.test(f.path) && f.encoding === "utf8" && f.content.trim())) throw Error("플레이북 Markdown이 필요합니다.");
  }
}
// Pinned composer JSON is validated here without resolving or materializing resources.
const PROFILE_RESOURCE_FIELDS = ["resourceIds", "resourceSelections", "components", "componentIds", "mcpServerIds", "optionalSelection", "diagnostics", "providerAccount", "providerSelection"];
function validateProfileResources(input) {
  const result = {}; let nodes = 0, bytes = 0;
  function bounded(value, depth = 0) {
    if (++nodes > 200000 || depth > 24) throw Error("Profile resource structure exceeds limits");
    if (typeof value === "string") { bytes += Buffer.byteLength(value); if (bytes > 128 * 1024 * 1024 || value.includes("\0")) throw Error("Invalid profile resource data"); }
    else if (Array.isArray(value)) { if (value.length > 10000) throw Error("Profile resource array exceeds limits"); value.forEach(v => bounded(v, depth + 1)); }
    else if (value && typeof value === "object") { if (Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).length > 1000) throw Error("Invalid profile resource object"); for (const [key, v] of Object.entries(value)) { if (["__proto__", "constructor", "prototype"].includes(key)) throw Error("Invalid profile resource key"); bounded(v, depth + 1); } }
    else if (value !== null && typeof value !== "boolean" && !(typeof value === "number" && Number.isFinite(value))) throw Error("Invalid profile resource value");
  }
  for (const key of PROFILE_RESOURCE_FIELDS) if (input[key] !== undefined) { bounded(input[key]); result[key] = copy(input[key]); }
  const ids = (value, name) => { if (!Array.isArray(value) || value.length > 1000 || new Set(value).size !== value.length) throw Error(`Invalid ${name}`); value.forEach(v => { text(v, name, 1000); if (v.includes("\0")) throw Error(`Invalid ${name}`); }); };
  for (const key of ["resourceIds", "componentIds", "mcpServerIds"]) if (result[key] !== undefined) ids(result[key], key);
  if (result.components !== undefined) validateComponents(result.components);
  if (result.componentIds && result.components && result.componentIds.some(id => !result.components.some(c => c.id === id))) throw Error("Missing pinned component");
  if (result.resourceSelections !== undefined) {
    if (!Array.isArray(result.resourceSelections) || result.resourceSelections.length > 1000) throw Error("Invalid resource selections");
    ids(result.resourceSelections.map(r => r?.id), "resource selections");
    for (const r of result.resourceSelections) { text(r.kind, "resource kind", 100); if (r.component) validateComponents([r.component]); if (result.resourceIds && !result.resourceIds.includes(r.id)) throw Error("Unselected pinned resource"); }
  }
  if (result.optionalSelection !== undefined && result.optionalSelection !== "selected-only") throw Error("Invalid optional resource selection");
  if (result.diagnostics !== undefined && (!Array.isArray(result.diagnostics) || result.diagnostics.length > 1000 || result.diagnostics.some(d => !d || typeof d.code !== "string" || typeof d.message !== "string"))) throw Error("Invalid profile diagnostics");
  if (result.providerAccount !== undefined) { const a = result.providerAccount; if (!a || typeof a !== "object" || Array.isArray(a)) throw Error("Invalid provider account"); text(a.providerId, "Provider ID", 200); text(a.accountId, "Account ID", 500); }
  if (result.providerSelection !== undefined) text(result.providerSelection, "Provider selection", 200);
  return result;
}
function allowedRoles(value = ["lead", "root", "subagent"]) {
  if (!Array.isArray(value) || !value.length || value.length > 3 || new Set(value).size !== value.length || value.some(r => !["lead", "root", "subagent"].includes(r))) throw Error("Invalid allowed roles");
  return [...value];
}
function envelope(entry) {
  const main = entry.files.find(f => f.path === MANIFEST);
  if (!main) return null;
  if (main.encoding !== "utf8") throw Error("패키지 manifest 인코딩 오류입니다.");
  const m = JSON.parse(main.content);
  if (m.schemaVersion !== 1 || !Array.isArray(m.components) || !Array.isArray(m.profiles)) throw Error("지원하지 않는 패키지 manifest입니다.");
  text(m.title, "패키지 제목", 200); text(m.description, "패키지 설명", 10000, true);
  const claimed = new Set([MANIFEST]);
  const components = m.components.map(c => ({ ...c, files: (Array.isArray(c.files) ? c.files : (() => { throw Error("구성요소 파일 목록 오류입니다."); })()).map(p => {
    relative(p); if (claimed.has(p)) throw Error("중복 manifest 파일입니다."); claimed.add(p);
    const f = entry.files.find(f => f.path === p); if (!f) throw Error("구성요소 파일이 없습니다."); return copy(f);
  }) }));
  validateComponents(components);
  const profiles = m.profiles.map(p => profile(p, components.map(c => c.id)));
  if (new Set(profiles.map(p => p.id)).size !== profiles.length) throw Error("중복 프로필 ID입니다.");
  let image;
  if (m.image !== undefined) {
    relative(m.image); if (claimed.has(m.image)) throw Error("이미지 경로가 충돌합니다."); claimed.add(m.image);
    const f = entry.files.find(f => f.path === m.image); if (!f) throw Error("이미지 파일이 없습니다.");
    const data = Buffer.from(f.content, f.encoding); image = `data:image/${imageType(data)};base64,${data.toString("base64")}`;
  }
  if (claimed.size !== entry.files.length) throw Error("manifest에 포함되지 않은 파일입니다.");
  return { title: m.title, description: m.description, ...(image ? { image } : {}), components, profiles, ...(m.provenance ? { provenance: m.provenance } : {}) };
}
async function safe(p) {
  p = path.resolve(p); let current = path.parse(p).root;
  for (const part of p.slice(current.length).split(path.sep).filter(Boolean)) {
    try { if ((await fs.readdir(current)).some(n => n !== part && n.toLowerCase() === part.toLowerCase())) throw Error("대소문자 경로 별칭입니다."); } catch (e) { if (e.code !== "ENOENT") throw e; }
    current = path.join(current, part);
    try { if ((await fs.lstat(current)).isSymbolicLink()) throw Error("링크 경로는 허용되지 않습니다."); } catch (e) { if (e.code !== "ENOENT") throw e; }
  }
}
class InstructionWorkbench {
  constructor({ root, installedRoot, baselineRoot, localRoots = [], connections = [], token, request, projects = [], readProfileOptions, readComposerResources, resolveComposerResource, profileRepository }) {
    if (!path.isAbsolute(root || "") || !path.isAbsolute(installedRoot || "")) throw Error("절대 sandbox 경로가 필요합니다.");
    this.root = path.resolve(root); this.installedRoot = path.resolve(installedRoot);
    if (readProfileOptions !== undefined && typeof readProfileOptions !== "function") throw Error("프로필 옵션 조회기를 확인하세요.");
    this.readOptions = readProfileOptions;
    if (profileRepository !== undefined && (typeof profileRepository.snapshotLibrary !== "function" || typeof profileRepository.replaceLibrary !== "function")) throw Error("Invalid profile repository");
    this.profileRepository = profileRepository;
    if (readComposerResources !== undefined && typeof readComposerResources !== "function") throw Error("리소스 조회기를 확인하세요.");
    this.readResources = readComposerResources;
    if (resolveComposerResource !== undefined && typeof resolveComposerResource !== "function") throw Error("리소스 해석기를 확인하세요.");
    this.resolveResource = resolveComposerResource;
    if (baselineRoot !== undefined && !path.isAbsolute(baselineRoot)) throw Error("기본 지침 절대 경로가 필요합니다.");
    this.baselineRoot = baselineRoot && path.resolve(baselineRoot);
    this.library = new InstructionLibrary({ root: path.join(this.root, "library"), installedRoot: this.installedRoot });
    this.publisher = new InstructionPublisher({ stateRoot: path.join(this.root, "publisher"), ...(request ? { request } : {}) });
    this.connections = connections.map(c => ({ ...c, token: c.token || token }));
    if (new Set(this.connections.map(c => c.repository?.toLowerCase())).size !== connections.length) throw Error("중복 저장소 연결입니다.");
    this.setProjects(projects);
    this.locals = localRoots.map(value => {
      const o = typeof value === "string" ? { root: value } : value;
      if (!path.isAbsolute(o.root || "")) throw Error("로컬 라이브러리 절대 경로가 필요합니다.");
      const r = path.resolve(o.root), rel = path.relative(r, this.root), reverse = path.relative(this.root, r);
      if (!rel || (!rel.startsWith(".." + path.sep) && rel !== ".." && !path.isAbsolute(rel)) || (!reverse.startsWith(".." + path.sep) && reverse !== ".." && !path.isAbsolute(reverse))) throw Error("읽기 전용 라이브러리와 sandbox가 겹칩니다.");
      return { id: `local:${hash(r).slice(0, 20)}`, label: o.label || path.basename(r), lib: new InstructionLibrary({ root: r, installedRoot: o.installedRoot || this.installedRoot }) };
    });
    this.pending = null;
    this.operations = Promise.resolve();
  }
  _sources() {
    return [{ id: "local:sandbox", label: "개발 보관함", lib: this.library }, ...this.locals,
      ...this.connections.map(c => ({ id: `github:${c.repository.toLowerCase()}`, label: c.repository, repository: c.repository, connection: c, lib: new InstructionLibrary({ root: path.join(this.root, "downloads", hash(c.repository.toLowerCase()).slice(0, 20)), installedRoot: this.installedRoot }) }))];
  }
  async _state() {
    await safe(this.root);
    let s, migrationSource;
    const destination = path.join(this.root, this.profileRepository ? "workbench-repository-state.json" : "workbench-state.json");
    let raw;
    try { await safe(destination); raw = await fs.readFile(destination, "utf8"); }
    catch (error) {
      if (error.code !== "ENOENT") throw error;
      if (this.profileRepository) {
        const legacyPath = path.join(this.root, "workbench-state.json");
        try { await safe(legacyPath); raw = await fs.readFile(legacyPath, "utf8"); migrationSource = { path: legacyPath, sha256: hash(raw) }; }
        catch (legacyError) { if (legacyError.code !== "ENOENT") throw legacyError; }
      }
    }
    try { if (raw === undefined) throw Object.assign(Error("No workbench state"), { code: "ENOENT" }); s = JSON.parse(raw); if (s.schemaVersion !== 1 || !Number.isSafeInteger(s.revision) || (!Array.isArray(s.profiles) && !(this.profileRepository && s.profileRepositoryMigrated)) || !s.active || !s.index || !Array.isArray(s.remote)) throw Error("Invalid workbench state"); }
    catch (e) { if (e.code !== "ENOENT") throw e; s = { schemaVersion: 1, revision: 0, profiles: [], active: {}, index: {}, remote: [], github: { phase: "idle" } }; }
    if (this.profileRepository) {
      let library = await this.profileRepository.snapshotLibrary();
      const migrationPending = !s.profileRepositoryMigrated;
      let migrationCommitted = false;
      if (!s.profileRepositoryMigrated) {
        const imported = [...library.profiles];
        for (const legacy of s.profiles || []) {
          if (legacy.id === DEFAULT_PROFILE) continue;
          const existing = imported.find(p => p.id === legacy.id);
          if (existing) { if (Object.keys(legacy).some(key => JSON.stringify(legacy[key]) !== JSON.stringify(existing[key]))) throw Error("Legacy profile conflicts with canonical profile: " + legacy.id); }
          else imported.push(copy(legacy));
        }
        if (imported.length !== library.profiles.length) { library = await this.profileRepository.replaceLibrary({ expectedRevision: library.revision, profiles: imported }); migrationCommitted = true; }
        s.profileRepositoryMigrated = { source: migrationSource || { kind: "empty" } };
      }
      s.profiles = copy(library.profiles);
      Object.defineProperty(s, "profileRepositoryState", { value: { revision: library.revision, original: JSON.stringify(s.profiles), migrationPending, migrationCommitted }, enumerable: false });
    }
    return s;
  }
  async _write(s) {
    let canonicalSaved = !!s.profileRepositoryState?.migrationCommitted;
    if (this.profileRepository) {
      const prior = s.profileRepositoryState;
      if (!prior) throw Error("Missing profile repository revision");
      if (JSON.stringify(s.profiles) !== prior.original) {
        const library = await this.profileRepository.replaceLibrary({ expectedRevision: prior.revision, profiles: s.profiles });
        s.profiles = copy(library.profiles); prior.revision = library.revision; prior.original = JSON.stringify(s.profiles); canonicalSaved = true;
      }
    }
    s.revision++; const dest = path.join(this.root, this.profileRepository ? "workbench-repository-state.json" : "workbench-state.json"), temp = dest + "." + crypto.randomUUID() + ".tmp";
    const persisted = { ...s }; if (this.profileRepository) delete persisted.profiles;
    try {
      await safe(dest);
      try { await fs.writeFile(temp, JSON.stringify(persisted)); await fs.rename(temp, dest); } finally { try { await fs.unlink(temp); } catch (e) { if (e.code !== "ENOENT") throw e; } }
      if (s.profileRepositoryState) { s.profileRepositoryState.migrationPending = false; s.profileRepositoryState.migrationCommitted = false; }
    } catch (error) { if (canonicalSaved) throw new Error("Canonical profiles saved, but workbench metadata write failed: " + error.message, { cause: error }); throw error; }
  }
  _locked(fn) {
    // Local callers share a short commit queue; another instance/process still
    // has to acquire the exclusive filesystem lock and cannot bypass its owner.
    const result = this.operations.then(() => this._lockNow(fn));
    this.operations = result.catch(() => {});
    return result;
  }
  async _lockNow(fn) {
    await safe(this.root); await fs.mkdir(this.root, { recursive: true }); await safe(this.root);
    const lock = path.join(this.root, "workbench.lock"); let handle;
    try { handle = await fs.open(lock, "wx"); } catch (e) { if (e.code === "EEXIST") throw Error("다른 창에서 저장 중입니다. 다시 시도하세요."); throw e; }
    try { await handle.writeFile(JSON.stringify({ pid: process.pid })); const state = await this._state(); if (state.profileRepositoryState?.migrationPending) await this._write(state); return await fn(state); }
    finally { await handle.close(); await fs.unlink(lock); }
  }
  _project(id) { if (id !== null && !this.projects.some(p => p.id === id)) throw Error("등록된 프로젝트를 선택하세요."); return id; }
  async _baseline() {
    if (!this.baselineRoot) return [];
    const file = path.join(this.baselineRoot, "azrael-environment.json"); await safe(file);
    const stat = await fs.stat(file); if (!stat.isFile() || stat.size > 2 * 1024 * 1024) throw Error("기본 지침 manifest 용량 오류입니다.");
    const raw = await fs.readFile(file, "utf8"), m = JSON.parse(raw);
    if (m.schemaVersion !== 1 || !Array.isArray(m.components) || m.components.length > 1000) throw Error("기본 지침 manifest 오류입니다.");
    const ids = new Set();
    return m.components.map(c => {
      text(c.id, "구성요소 ID", 160); text(c.title, "구성요소 제목", 200);
      if (ids.has(c.id) || !Array.isArray(c.files) || c.files.length > 10000) throw Error("기본 구성요소 목록 오류입니다."); ids.add(c.id);
      for (const f of c.files) { relative(f.source); relative(f.target); }
      const kind = ({ agent: "agent-role", instructions: "context", config: "context" })[c.kind] || c.kind;
      if (!kinds.has(kind)) throw Error("기본 구성요소 종류 오류입니다.");
      return { key: `baseline:${c.id}`, id: c.id, digest: hash(JSON.stringify({ version: m.instructionVersion, component: c })), title: c.title, description: `${c.kind} · 기본 지침`, source: { kind: "local", label: "Azrael 기본 지침" }, downloaded: true, version: m.instructionVersion, updateAvailable: false, componentKinds: [kind], profileCount: 0, used: false, mapping: c.files, componentKind: kind };
    });
  }
  async _baselineDetail(key, entries) {
    const b = (entries || await this._baseline()).find(b => b.key === key); if (!b) throw Error("기본 지침 구성요소가 없습니다.");
    const inventory = []; let total = 0;
    for (const mapping of b.mapping) {
      const file = path.join(this.baselineRoot, ...relative(mapping.source).split("/")); await safe(file);
      const stat = await fs.stat(file); if (!stat.isFile() || stat.size > 16 * 1024 * 1024 || (total += stat.size) > 128 * 1024 * 1024) throw Error("기본 지침 파일 용량 오류입니다.");
      const data = await fs.readFile(file), body = data.toString("utf8"), utf8 = !data.includes(0) && Buffer.from(body).equals(data);
      inventory.push({ path: mapping.source, encoding: utf8 ? "utf8" : "base64", content: utf8 ? body : data.toString("base64") });
    }
    const { mapping, componentKind, ...summary } = b;
    const components = [{ id: b.id, name: b.title, kind: componentKind, files: files(inventory) }]; validateComponents(components);
    // Detailed snapshots pin actual bytes; the cheap listing digest is only discovery evidence.
    return { ...summary, digest: hash(JSON.stringify(inventory)), components, profiles: [], files: inventory, mappings: copy(mapping) };
  }
  _baselinePackage(entries) {
    return { key: BASELINE_PACKAGE, id: "azrael-environment", title: "Azrael 기본 패키지",
      description: "Azrael 기본 지침, 스킬, 플레이북과 에이전트 역할을 포함합니다.",
      source: { kind: "local", label: "Azrael 기본 지침" }, downloaded: true,
      version: entries[0]?.version || "", digest: hash(JSON.stringify(entries.map(e => e.digest))),
      componentKinds: [...new Set(entries.map(e => e.description.startsWith("instructions ·") ? "instruction" : e.componentKind))],
      componentNames: entries.map(e => e.title), componentCount: entries.length,
      profileCount: 0, updateAvailable: false, used: false };
  }
  async _baselinePackageDetail() {
    const entries = await this._baseline(), components = [], inventory = new Map(), mappings = [];
    for (const entry of entries) {
      const detail = await this._baselineDetail(entry.key, entries);
      for (const component of detail.components) components.push({ ...component, kind: entry.description.startsWith("instructions ·") ? "instruction" : component.kind });
      for (const file of detail.files) inventory.set(file.path, file);
      mappings.push(...detail.mappings);
    }
    validateComponents(components);
    const allFiles = files([...inventory.values()]);
    return { ...this._baselinePackage(entries), digest: hash(JSON.stringify(components)), components, profiles: [], files: allFiles, mappings };
  }
  async _adapt(entry, source, visiting = new Set(), versions = new Map()) {
    if (packageDigest(entry) !== entry.digest || entry.validationErrors?.length) throw Error("패키지 무결성 또는 검증 오류입니다.");
    if (versions.has(entry.id) && versions.get(entry.id) !== entry.digest) throw Error("프로필 의존성의 고정 버전이 충돌합니다.");
    versions.set(entry.id, entry.digest);
    const packaged = envelope(entry); if (packaged) return packaged;
    const key = entry.id + ":" + entry.digest;
    if (visiting.has(key)) throw Error("순환 프로필 의존성입니다.");
    visiting.add(key);
    let components = [], templates = [];
    if (entry.kind === "task-profile") {
      for (const ref of entry.profile.dependencies) {
        let dep; try { dep = await source.lib.readVersion(ref.id, ref.digest); } catch (e) { if (ref.optional && e.message === "Missing dependency version") continue; throw e; }
        const adapted = await this._adapt(dep, source, visiting, versions);
        for (const c of adapted.components) if (!components.some(existing => existing.id === c.id)) components.push(c);
        if (dep.kind === "task-profile") components.push({ id: `${dep.id}:profile`, name: dep.name, kind: "task-profile", files: [{ path: "PROFILE.json", encoding: "utf8", content: JSON.stringify(dep.profile) }] });
      }
      templates = [profile({ ...entry.profile, id: entry.id, name: entry.name }, components.map(c => c.id))];
    } else components = [{ id: entry.id, name: entry.name, kind: entry.kind, files: files(entry.files) }];
    visiting.delete(key); validateComponents(components);
    return { title: entry.name, description: "", components, profiles: templates };
  }
  _summary(entry, source, adapted) {
    return { key: `${source.id}:${entry.id}`, id: entry.id, digest: entry.digest, title: adapted.title, description: adapted.description, ...(adapted.image ? { image: adapted.image } : {}), source: { kind: source.repository ? "github" : "local", label: source.label, ...(source.repository ? { repository: source.repository } : {}) }, downloaded: true, version: entry.version, updateAvailable: false, componentKinds: [...new Set(adapted.components.map(c => c.kind))], componentNames: adapted.components.map(c => c.name), componentCount: adapted.components.length, profileCount: adapted.profiles.length, used: false };
  }
  async _catalog(s) {
    const result = [], errors = []; let changed = false;
    try { if (this.baselineRoot) result.push(this._baselinePackage(await this._baseline())); }
    catch (e) { errors.push({ kind: "local", label: "Azrael 기본 지침", message: e.message }); }
    for (const source of this._sources()) {
      try {
        const registry = await source.lib.getState();
        for (const entry of registry.entries.filter(e => !e.historicalOnly || s.downloads?.[`${source.id}:${e.id}`])) {
          const publication = entry.ownership === "downloaded" && entry.publications?.find(p => p.digest === entry.digest);
          const repository = publication?.destination || publication?.repository;
          const displaySource = repository && !source.repository ? { ...source, id: `github:${repository.toLowerCase()}`, repository, label: repository } : source;
          const key = `${displaySource.id}:${entry.id}`, cached = s.index[key], selectedDigest = s.downloads?.[key] || entry.digest;
          if (!cached || cached.digest !== selectedDigest || !Array.isArray(cached.componentNames)) {
            const full = await source.lib.readVersion(entry.id, selectedDigest);
            s.index[key] = this._summary(full, displaySource, await this._adapt(full, source)); s.origins ||= {}; s.origins[key] = source.id; changed = true;
          }
          const existing = result.findIndex(p => p.key === key);
          if (existing < 0) result.push(copy(s.index[key]));
          else if (source.repository) result[existing] = copy(s.index[key]);
        }
      } catch (e) { errors.push({ kind: source.repository ? "github" : "local", label: source.label, message: e.message }); }
    }
    for (const remote of s.remote) {
      const local = result.find(p => p.key === remote.key);
      if (local) { local.updateAvailable = local.digest !== remote.digest; local.latestVersion = remote.version; }
      else result.push(copy(remote));
    }
    return { packages: result, errors, changed };
  }
  setProjects(projects) {
    if (!Array.isArray(projects)) throw Error("프로젝트 목록을 확인하세요.");
    const next = projects.map(p => ({ id: text(p.id, "프로젝트 ID", 300), name: text(p.name, "프로젝트 이름", 200) }));
    if (new Set(next.map(p => p.id)).size !== next.length) throw Error("중복 프로젝트 ID입니다.");
    this.projects = next;
  }
  async profileOptions() {
    return this.readOptions ? this.readOptions() : { providers: [], models: [], message: "연결된 계정 정보를 읽을 수 없습니다." };
  }
  _defaultProfile() {
    return { id: DEFAULT_PROFILE, name: "기본 프로필", allowedRoles: ["root"], resourceIds: [], diagnostics: [], readOnly: true, isDefault: true, appliedDiffers: false };
  }
  _profileSummary(p, s, projectId) {
    const { components, resourceSelections, ...summary } = p;
    const applied = projectId && s.active[projectId] === p.id ? s.applied?.[projectId] || p : null;
    return copy({ ...summary, resourceIds: p.resourceIds || this._legacySelections(p).map(r => r.id), diagnostics: [...(p.diagnostics || []), ...(applied && !this._rootAllowed(p) ? [this._rootDiagnostic()] : [])], readOnly: !!(p.builtin || p.readOnly),
      appliedDiffers: !!applied && JSON.stringify(applied) !== JSON.stringify(p) });
  }
  _legacySelections(p) {
    return (p.components || []).map(c => ({ id: "pinned:" + hash(p.id + "\0" + c.id), kind: c.kind, name: c.name, available: true, component: copy(c), source: { kind: "profile", label: p.name } }));
  }
  async _templates(catalog) {
    const templates = [];
    for (const pkg of catalog.packages.filter(p => p.downloaded && p.profileCount)) {
      try {
        const detail = await this.detail(pkg.key);
        for (const original of detail.profiles) {
          const components = detail.components.filter(c => original.componentIds.includes(c.id));
          const resourceSelections = components.filter(c => c.kind !== "task-profile").map(c => ({ id: "resource:" + hash(pkg.key + "\0" + c.id), kind: c.kind, name: c.name, available: true, component: copy(c), source: pkg.source }));
          templates.push({ ...copy(original), id: "template:" + hash(pkg.key + "\0" + original.id), isTemplate: true, source: copy(pkg.source), packageKey: pkg.key, packageDigest: pkg.digest, resourceIds: resourceSelections.map(r => r.id), resourceSelections, components: copy(components), diagnostics: [] });
        }
      } catch { /* Catalog/detail reports retain the source failure; no unusable template is offered. */ }
    }
    return templates;
  }
  _personalCopy(p) {
    const result = { ...copy(p), id: crypto.randomUUID(), optionalSelection: "selected-only", mcpServerIds: copy(p.mcpServerIds || []) };
    delete result.isTemplate; delete result.readOnly; delete result.isDefault; delete result.builtin;
    return result;
  }
  async _composerResources(s, catalog) {
    let supplied = { core: { id: "azrael-core", name: "Azrael 핵심 지침", text: "" }, resources: [], errors: [] };
    if (this.readResources) {
      try { supplied = await this.readResources(); }
      catch (e) { supplied.errors = [{ message: e.message }]; }
    }
    const core = { id: text(supplied.core?.id || "azrael-core", "핵심 ID", 300), name: text(supplied.core?.name || "Azrael 핵심 지침", "핵심 이름", 200), text: text(supplied.core?.text || "", "핵심 지침", 1000000, true) };
    const resources = [], errors = [...(supplied.errors || []), ...catalog.errors], seen = new Set();
    for (const r of supplied.resources || []) {
      try {
        const id = text(r.id, "리소스 ID", 1000);
        if (!["mcp", "skill"].includes(r.kind) || seen.has(id)) throw Error("중복 또는 잘못된 리소스입니다.");
        const clean = { id, kind: r.kind, name: text(r.name, "리소스 이름", 200), available: r.available !== false, defaultEnabled: r.defaultEnabled !== false };
        if (typeof r.source === "string") clean.source = r.source;
        if (r.kind === "mcp") clean.serverId = text(r.serverId, "MCP 서버 ID", 300);
        else clean.external = true;
        for (const field of ["description", "digest", "error"]) if (typeof r[field] === "string") clean[field] = r[field];
        seen.add(id); resources.push(clean);
      } catch (e) { errors.push({ message: e.message }); }
    }
    const resourcePackages = [];
    for (const pkg of catalog.packages.filter(p => p.downloaded)) {
      // Catalog grouping must not change existing composer selection identities.
      if (pkg.key === BASELINE_PACKAGE) resourcePackages.push(...await this._baseline());
      else resourcePackages.push(pkg);
    }
    for (const pkg of resourcePackages) {
      try {
        if (pkg.key.startsWith("baseline:")) {
          const id = "resource:" + hash(pkg.key + "\0" + pkg.id);
          const kind = pkg.description?.startsWith("instructions ·") ? "instruction" : pkg.componentKinds[0];
          if (!seen.has(id)) { seen.add(id); resources.push({ id, kind, name: pkg.title, description: pkg.description || "", source: pkg.source, packageKey: pkg.key, componentId: pkg.id, digest: pkg.digest, available: true, baseline: true }); }
          continue;
        }
        const detail = await this.detail(pkg.key);
        for (const c of detail.components.filter(c => c.kind !== "task-profile")) {
          const id = "resource:" + hash(pkg.key + "\0" + c.id);
          const kind = pkg.key.startsWith("baseline:") && detail.description?.startsWith("instructions ·") ? "instruction" : c.kind;
          if (seen.has(id)) continue;
          seen.add(id); resources.push({ id, kind, name: c.name, description: detail.description || "", source: pkg.source, packageKey: pkg.key, digest: hash(JSON.stringify(c)), available: true, component: copy(c) });
        }
      } catch (e) { errors.push({ message: e.message, source: pkg.key }); }
    }
    for (const p of s.profiles.filter(p => !p.resourceIds)) for (const r of this._legacySelections(p)) if (!seen.has(r.id)) { resources.push(r); seen.add(r.id); }
    const defaults = new Map();
    for (const resource of resources) if (["skill", "mcp"].includes(resource.kind) && resource.available !== false && resource.defaultEnabled !== false) {
      const identity = resource.kind + ":" + (resource.serverId || resource.name.toLowerCase());
      if (!defaults.has(identity)) defaults.set(identity, resource.id);
    }
    return { core, resources, errors, defaultResourceIds: [...defaults.values()] };
  }
  async composerResources() {
    return this._locked(async s => {
      const catalog = await this._catalog(s);
      if (catalog.changed) await this._write(s);
      return this._composerResources(s, catalog);
    });
  }
  async _saveProfile(s, payload) {
    if (payload.expectedRepoRevision !== undefined && payload.expectedRepoRevision !== s.profileRepositoryState?.revision) throw Error("Profile repository revision conflict");
    if (payload.expectedRevision !== undefined && payload.expectedRevision !== s.revision) throw Error("개발 보관함 revision 충돌입니다.");
    if (payload.profileId === DEFAULT_PROFILE) throw Error("기본 프로필을 복제한 뒤 편집하세요.");
    const catalog = await this._catalog(s);
    const prior = payload.profileId ? s.profiles.find(p => p.id === payload.profileId) || (await this._templates(catalog)).find(p => p.id === payload.profileId) : null;
    if (prior?.builtin || prior?.readOnly) throw Error("Builtin profiles are read-only; duplicate first");
    if (payload.profileId && !prior) throw Error("프로필이 없습니다.");
    if (!Array.isArray(payload.resourceIds) || payload.resourceIds.length > 1000 || new Set(payload.resourceIds).size !== payload.resourceIds.length) throw Error("리소스 선택을 확인하세요.");
    payload.resourceIds.forEach(id => text(id, "리소스 ID", 1000));
    const available = await this._composerResources(s, catalog);
    const p = { id: prior && !prior.isTemplate ? prior.id : crypto.randomUUID(), name: text(payload.name, "프로필 이름", 160), resourceIds: [...payload.resourceIds], resourceSelections: [], components: [], componentIds: [], mcpServerIds: [], optionalSelection: "selected-only", diagnostics: [] };
    p.allowedRoles = allowedRoles(payload.allowedRoles ?? prior?.allowedRoles);
    if (payload.image) p.image = validatedImage(payload.image);
    for (const id of p.resourceIds) {
      let resource = available.resources.find(r => r.id === id);
      const previous = (prior?.resourceSelections || (prior ? this._legacySelections(prior) : [])).find(r => r.id === id);
      if (resource?.baseline && !resource.component) {
        try {
          const detail = await this.detail(resource.packageKey), component = detail.components.find(c => c.id === resource.componentId);
          if (!component) throw Error("기본 리소스를 찾을 수 없습니다.");
          resource = { ...resource, component: copy(component) };
        } catch (error) { resource = { ...resource, available: false, error: error.message }; }
      }
      if (resource?.external && resource.available && !resource.component) {
        try {
          const resolved = await this.resolveResource?.(id);
          if (resolved?.id !== id || resolved.kind !== resource.kind || !resolved.component || resolved.available === false) throw Error("선택한 리소스를 읽을 수 없습니다.");
          validateComponents([resolved.component]); resource = { ...resource, component: copy(resolved.component) };
        } catch (e) { resource = { ...resource, available: false, error: e.message }; }
      }
      if (!resource || resource.available === false) p.diagnostics.push({ code: "resource-unavailable", message: resource?.error || "선택한 리소스를 사용할 수 없습니다.", resourceId: id });
      const selected = resource?.available !== false && resource ? resource : previous;
      if (!selected) continue;
      const pinned = copy(selected);
      if (pinned.component) {
        pinned.component.id = "selected:" + hash(id); pinned.component.resourceId = id;
        if (pinned.kind === "instruction") { pinned.component.kind = "context"; pinned.component.loading = "persistent"; pinned.component.order = p.resourceIds.indexOf(id); }
        p.components.push(copy(pinned.component)); p.componentIds.push(pinned.component.id);
      }
      if (pinned.kind === "mcp") p.mcpServerIds.push(pinned.serverId);
      p.resourceSelections.push(pinned);
    }
    if (payload.instructions !== undefined) p.instructions = text(payload.instructions, "instructions", 1000000, true);
    for (const field of ["provider", "model", "reasoningEffort"]) if (payload[field] !== undefined) p[field] = text(payload[field], field, 200, true);
    if (!p.model && (payload.model !== undefined || p.provider || p.reasoningEffort)) p.diagnostics.push({ code: "model-required", message: "모델을 선택하세요.", field: "model" });
    if (payload.provider !== undefined && !p.provider) p.diagnostics.push({ code: "provider-required", message: "Provider를 선택하세요.", field: "provider" });
    if (p.model && this.readOptions) {
      try {
        const options = await this.profileOptions(), selected = p.provider ? options.providers.find(v => v.id === p.provider) : null;
        const models = options.models.filter(m => m.model === p.model && (!selected || m.providerIds.includes(selected.id)));
        if (p.provider && !selected) p.diagnostics.push({ code: "provider-unavailable", message: "연결된 Provider 계정을 선택하세요.", field: "provider" });
        if (!models.length) p.diagnostics.push({ code: "model-unavailable", message: "사용 가능한 모델을 선택하세요.", field: "model" });
        if (p.reasoningEffort && !models.some(m => m.supportedReasoningEfforts.some(e => e.reasoningEffort === p.reasoningEffort))) p.diagnostics.push({ code: "reasoning-unavailable", message: "지원되는 Reasoning effort를 선택하세요.", field: "reasoningEffort" });
        if (selected) { p.providerSelection = selected.id; p.provider = selected.modelProvider; if (selected.account) p.providerAccount = copy(selected.account); }
      } catch (e) { p.diagnostics.push({ code: "models-unavailable", message: e.message, field: "model" }); }
    }
    try { validateComponents(p.components); } catch (e) { p.diagnostics.push({ code: "components-invalid", message: e.message }); }
    s.applied ||= {};
    for (const [projectId, id] of Object.entries(s.active)) if (id === p.id) {
      if (!s.applied[projectId] && prior && this._rootAllowed(prior)) s.applied[projectId] = copy(prior);
      if (!p.diagnostics.length && this._rootAllowed(p)) s.applied[projectId] = copy(p);
    }
    if (prior && !prior.isTemplate) s.profiles[s.profiles.indexOf(prior)] = p; else s.profiles.push(p);
    await this._write(s);
    return { profile: this._profileSummary(p, s, payload.projectId), revision: s.revision };
  }
  _rootAllowed(p) { return allowedRoles(p.allowedRoles).includes("root"); }
  _rootDiagnostic() { return { code: "conversation-role-incompatible", message: "일반 대화에는 Root 역할이 허용된 프로필이 필요합니다.", field: "allowedRoles" }; }
  async _conversationDiagnostics(p) { return [...await this._admissionDiagnostics(p), ...(!this._rootAllowed(p) ? [this._rootDiagnostic()] : [])]; }
  async _admissionDiagnostics(p) {
    const diagnostics = copy(p.diagnostics || []);
    if (p.optionalSelection !== "selected-only") return diagnostics;
    const external = (p.resourceSelections || []).filter(r => r.kind === "mcp" || r.external);
    if (external.length) {
      let current;
      try { current = await this.readResources?.(); } catch { /* Unknown availability fails closed. */ }
      for (const selected of external) {
        const live = current?.resources?.find(r => r.id === selected.id && r.kind === selected.kind);
        if (!live || live.available === false) diagnostics.push({ code: "resource-unavailable", message: "선택한 스킬 또는 MCP를 사용할 수 없습니다.", resourceId: selected.id });
      }
    }
    if (p.model && this.readOptions) {
      try {
        const options = await this.profileOptions();
        const provider = p.providerAccount ? options.providers.find(v => v.account?.providerId === p.providerAccount.providerId && v.account?.accountId === p.providerAccount.accountId) : p.providerSelection ? options.providers.find(v => v.id === p.providerSelection) : null;
        if ((p.providerAccount || p.providerSelection) && !provider) diagnostics.push({ code: "provider-unavailable", message: "선택한 Provider 계정을 사용할 수 없습니다.", field: "provider" });
        const models = options.models.filter(m => m.model === p.model && (!provider || m.providerIds.includes(provider.id)));
        if (!models.length || p.reasoningEffort && !models.some(m => m.supportedReasoningEfforts.some(e => e.reasoningEffort === p.reasoningEffort))) diagnostics.push({ code: "model-unavailable", message: "모델 설정을 확인하세요.", field: "model" });
      } catch { diagnostics.push({ code: "models-unavailable", message: "모델 설정을 확인할 수 없습니다.", field: "model" }); }
    }
    return diagnostics;
  }
  async snapshot(projectId = null) {
    this._project(projectId);
    // A cached index means supporting-file payloads are read only on first discovery/change.
    return this._locked(async s => {
      const catalog = await this._catalog(s); if (catalog.changed) await this._write(s);
      const templates = await this._templates(catalog);
      const active = projectId ? s.profiles.find(p => p.id === s.active[projectId]) || this._defaultProfile() : null;
      for (const p of catalog.packages) p.used = !!active && active.packageKey === p.key;
      const profiles = [this._defaultProfile(), ...await Promise.all([...s.profiles, ...templates].map(async p => ({ ...this._profileSummary(p, s, projectId), diagnostics: projectId && s.active[projectId] === p.id ? await this._conversationDiagnostics(p) : await this._admissionDiagnostics(p) })))];
      return { revision: s.revision, ...(s.profileRepositoryState ? { repoRevision: s.profileRepositoryState.revision } : {}), projectId, projects: copy(this.projects), packages: catalog.packages, profiles, active: active ? profiles.find(p => p.id === active.id) : null, github: copy(s.github), legacy: catalog.packages.map(p => ({ key: p.key, name: p.title, kind: p.componentKinds.join(", ") })), sources: [...this._sources().map(p => ({ kind: p.repository ? "github" : "local", label: p.label, ...(p.repository ? { repository: p.repository } : {}) })), ...catalog.errors, ...(s.remoteErrors || [])] };
    });
  }
  _locate(key) {
    text(key, "패키지 키", 1000);
    const source = this._sources().find(s => key.startsWith(s.id + ":"));
    if (!source) throw Error("알 수 없는 패키지 출처입니다.");
    return { source, id: key.slice(source.id.length + 1) };
  }
  async detail(key) {
    if (key === BASELINE_PACKAGE) return this._baselinePackageDetail();
    if (typeof key === "string" && key.startsWith("baseline:")) return this._baselineDetail(key);
    const s = await this._state();
    const remote = s.remote.find(p => p.key === key);
    if (remote && !s.downloads?.[key] && !s.index[key]) {
      const { componentMetadata = [], profileTemplates = [], ...summary } = remote;
      return { ...copy(summary), components: copy(componentMetadata), profiles: copy(profileTemplates), files: [], previewAvailable: false };
    }
    let located;
    const origin = s.origins?.[key];
    if (origin) {
      const source = this._sources().find(p => p.id === origin);
      if (source) located = { source, id: key.slice(key.lastIndexOf(":") + 1) };
    }
    const { source, id } = located || this._locate(key), pinned = s.downloads?.[key];
    const entry = pinned ? await source.lib.readVersion(id, pinned) : await source.lib.read(id), adapted = await this._adapt(entry, source);
    return { ...this._summary(entry, source, adapted), ...(s.index[key] ? copy(s.index[key]) : {}), key, ...adapted, files: copy(entry.files) };
  }
  async _create(payload, provenance) {
    text(payload.title, "패키지 제목", 200); text(payload.description, "패키지 설명", 10000, true);
    if (!Array.isArray(payload.components) || !Array.isArray(payload.profiles || [])) throw Error("구성요소와 프로필 목록을 확인하세요.");
    const all = [], components = payload.components.map((c, i) => {
      const id = c.id || crypto.randomUUID(), inventory = files(c.files).map(f => ({ ...f, path: `components/${i}/${f.path}` }));
      all.push(...inventory); return { id, name: c.name, kind: c.kind, files: inventory };
    });
    validateComponents(components);
    const profiles = (payload.profiles || []).map(p => profile(p, components.map(c => c.id)));
    if (!components.length && !profiles.length) throw Error("구성요소 또는 프로필이 필요합니다.");
    const m = { schemaVersion: 1, title: payload.title, description: payload.description, components: components.map(c => ({ ...c, files: c.files.map(f => f.path) })), profiles, ...(provenance ? { provenance } : {}) };
    if (payload.image) { const img = decodeImage(payload.image); all.push(img); m.image = img.path; }
    all.push({ path: MANIFEST, encoding: "utf8", content: JSON.stringify(m) });
    // Validate the same envelope used for imported resources before committing anything.
    envelope({ files: all });
    const entry = await this.library.create({ name: payload.title, kind: "context", sharing: "local", files: files(all) });
    return { key: `local:sandbox:${entry.id}`, id: entry.id, digest: entry.digest };
  }
  async action(action, payload = {}) {
    if (action === "refresh") {
      if (this.pending) return { accepted: true, coalesced: true };
      await this._locked(async s => { s.github = { ...s.github, phase: "loading" }; await this._write(s); });
      this.pending = this._refresh().finally(() => { this.pending = null; });
      return { accepted: true, coalesced: false };
    }
    if (action === "captureRequest") {
      const projectId = this._project(payload.projectId ?? null);
      return this._locked(async s => {
        const p = projectId ? s.applied?.[projectId] || s.profiles.find(p => p.id === s.active[projectId]) : null;
        if (projectId && s.active[projectId] && !p) throw Error("활성 Root 프로필을 찾을 수 없습니다. 기본 프로필로 자동 전환하지 않습니다.");
        if (p && !this._rootAllowed(p)) throw Error(this._rootDiagnostic().message);
        if (p && (await this._admissionDiagnostics(p)).length) throw Error("적용된 프로필의 리소스를 확인하세요. 기본 프로필로 자동 전환하지 않습니다.");
        return frozen(copy({ revision: s.revision, projectId, profile: p ? (({ components, resourceSelections, ...rest }) => rest)(p) : null, components: p?.components || [] }));
      });
    }
    if (action === "saveProfile") return this._locked(s => this._saveProfile(s, payload));
    if (action === "deleteProfile") return this._locked(async s => {
      if (payload.expectedRepoRevision !== undefined && payload.expectedRepoRevision !== s.profileRepositoryState?.revision) throw Error("Profile repository revision conflict");
      if (payload.expectedRevision !== undefined && payload.expectedRevision !== s.revision) throw Error("개발 보관함 revision 충돌입니다.");
      const p = s.profiles.find(p => p.id === payload.profileId);
      if (!p || p.readOnly || p.builtin || p.isTemplate || p.id === DEFAULT_PROFILE) throw Error("삭제할 수 없는 프로필입니다.");
      s.profiles = s.profiles.filter(item => item.id !== p.id);
      for (const [projectId, id] of Object.entries(s.active)) if (id === p.id) { delete s.active[projectId]; if (s.applied) delete s.applied[projectId]; }
      await this._write(s); return { revision: s.revision };
    });
    if (action === "duplicateProfile") return this._locked(async s => {
      if (payload.expectedRepoRevision !== undefined && payload.expectedRepoRevision !== s.profileRepositoryState?.revision) throw Error("Profile repository revision conflict");
      if (payload.expectedRevision !== undefined && payload.expectedRevision !== s.revision) throw Error("개발 보관함 revision 충돌입니다.");
      if (payload.profileId === DEFAULT_PROFILE) {
        const available = await this._composerResources(s, await this._catalog(s));
        return this._saveProfile(s, { name: "기본 프로필 사본", resourceIds: available.defaultResourceIds, projectId: payload.projectId });
      }
      const original = payload.profileId === DEFAULT_PROFILE ? { name: "기본 프로필", resourceIds: [], resourceSelections: [], components: [], componentIds: [], mcpServerIds: [], optionalSelection: "selected-only", diagnostics: [] } : s.profiles.find(p => p.id === payload.profileId) || (await this._templates(await this._catalog(s))).find(p => p.id === payload.profileId);
      if (!original) throw Error("프로필이 없습니다.");
      const p = { ...this._personalCopy(original), name: original.name + " 사본" };
      s.profiles.push(p); await this._write(s);
      return { profile: this._profileSummary(p, s, payload.projectId), revision: s.revision };
    });
    if (action === "createPackage") return this._locked(async s => { const result = await this._create(payload); await this._write(s); return result; });
    if (action === "importFiles") return this.action("createPackage", { title: payload.name, description: payload.description || "", components: [{ name: payload.name, kind: payload.kind, files: payload.files }], profiles: [] });
    if (action === "derivePackage") {
      if (!Array.isArray(payload.selections) || !payload.selections.length) throw Error("가져올 구성요소를 선택하세요.");
      const components = [], provenance = [];
      for (const selection of payload.selections) {
        const d = await this.detail(selection.key);
        if (!d.downloaded) throw Error("구성요소를 가져오기 전에 패키지를 다운로드하세요.");
        if (!Array.isArray(selection.componentIds) || !selection.componentIds.length || new Set(selection.componentIds).size !== selection.componentIds.length) throw Error("가져올 구성요소를 선택하세요.");
        for (const id of selection.componentIds) {
          const c = d.components.find(c => c.id === id); if (!c) throw Error("가져올 구성요소가 없습니다.");
          // Strip the common component directory; support-file relative paths stay intact.
          const prefix = c.files[0]?.path.match(/^components\/\d+\//)?.[0] || "";
          components.push({ ...c, files: c.files.map(f => ({ ...f, path: prefix && f.path.startsWith(prefix) ? f.path.slice(prefix.length) : f.path })) });
        }
        provenance.push({ key: d.key, digest: d.digest, version: d.version, componentIds: selection.componentIds });
      }
      if (payload.components !== undefined && !Array.isArray(payload.components)) throw Error("새 구성요소 목록을 확인하세요.");
      components.push(...(payload.components || []));
      return this._locked(async s => { const result = await this._create({ ...payload, components }, provenance); await this._write(s); return result; });
    }
    if (action === "download") return this._download(payload.key);
    if (action === "createProfile") {
      let input = { ...payload };
      if (this.readOptions && input.model !== undefined) {
        const options = await this.profileOptions();
        const selected = input.provider ? options.providers.find(p => p.id === input.provider) : null;
        if (input.provider && !selected) throw Error("연결된 Provider 계정을 선택하세요.");
        const models = options.models.filter(m => m.model === input.model && (!selected || m.providerIds.includes(selected.id)));
        if (!models.length) throw Error("사용 가능한 모델을 선택하세요.");
        if (input.reasoningEffort && !models.some(m => m.supportedReasoningEfforts.some(e => e.reasoningEffort === input.reasoningEffort))) throw Error("모델이 지원하는 Reasoning effort를 선택하세요.");
        delete input.providerAccount;
        if (selected) {
          input.provider = selected.modelProvider;
          if (selected.account) input.providerAccount = selected.account;
        } else delete input.provider;
      }
      const detail = payload.packageKey ? await this.detail(payload.packageKey) : null;
      if (detail && !detail.downloaded) throw Error("프로필을 저장하기 전에 패키지를 다운로드하세요.");
      const p = profile(input, detail?.components.map(c => c.id) || []);
      const components = detail ? detail.components.filter(c => p.componentIds.includes(c.id)) : [];
      validateComponents(components);
      const projectId = this._project(payload.projectId ?? null);
      if (payload.equip && !projectId) throw Error("장착할 프로젝트를 선택하세요.");
      return this._locked(async s => {
        if (payload.expectedRepoRevision !== undefined && payload.expectedRepoRevision !== s.profileRepositoryState?.revision) throw Error("Profile repository revision conflict");
        if (payload.expectedRevision !== undefined && payload.expectedRevision !== s.revision) throw Error("개발 보관함 revision 충돌입니다.");
        p.id = crypto.randomUUID(); p.components = copy(components);
        if (detail) { p.packageKey = detail.key; p.packageDigest = detail.digest; }
        if (payload.equip && (await this._conversationDiagnostics(p)).length) throw Error("일반 대화 프로필의 Root 역할과 구성을 확인하세요.");
        s.profiles.push(p); if (payload.equip) { s.active[projectId] = p.id; s.applied ||= {}; s.applied[projectId] = copy(p); }
        await this._write(s); const { components: pinned, ...summary } = p; return { profile: copy(summary), revision: s.revision };
      });
    }
    if (["equip", "unequip"].includes(action)) {
      const projectId = this._project(payload.projectId ?? null); if (!projectId) throw Error("장착할 프로젝트를 선택하세요.");
      return this._locked(async s => {
        if (payload.expectedRepoRevision !== undefined && payload.expectedRepoRevision !== s.profileRepositoryState?.revision) throw Error("Profile repository revision conflict");
        if (payload.expectedRevision !== undefined && payload.expectedRevision !== s.revision) throw Error("개발 보관함 revision 충돌입니다.");
        if (action === "equip" && payload.profileId !== DEFAULT_PROFILE) {
          let p = s.profiles.find(p => p.id === payload.profileId);
          if (!p) { const template = (await this._templates(await this._catalog(s))).find(p => p.id === payload.profileId); if (template) { p = this._personalCopy(template); s.profiles.push(p); } }
          if (!p) throw Error("프로필이 없습니다.");
          if (!this._rootAllowed(p)) throw Error(this._rootDiagnostic().message);
          if ((await this._admissionDiagnostics(p)).length) throw Error("프로필 오류를 해결한 뒤 활성화하세요.");
          s.active[projectId] = p.id; s.applied ||= {}; s.applied[projectId] = copy(p);
        } else { delete s.active[projectId]; if (s.applied) delete s.applied[projectId]; }
        await this._write(s); return { projectId, profileId: s.active[projectId] || null, revision: s.revision };
      });
    }
    throw Error("지원하지 않는 개발 작업입니다.");
  }
  async _remoteFile(source, pkg, descriptor, commit, maximum) {
    if (!/^[a-f0-9]{40}$/.test(commit) || !descriptor || !Number.isSafeInteger(descriptor.size) || descriptor.size < 0 || descriptor.size > maximum || !/^[a-f0-9]{64}$/.test(descriptor.sha256)) throw Error("원격 메타데이터 파일 크기 또는 checksum 오류입니다.");
    const filePath = `packages/${relative(pkg.id)}/${pkg.digest}/files/${relative(descriptor.path)}`;
    const value = await this.publisher._api(source.connection, `/contents/${filePath.split("/").map(encodeURIComponent).join("/")}?ref=${commit}`);
    if (!value || value.type !== "file" || value.encoding !== "base64" || value.size !== descriptor.size || typeof value.content !== "string" || value.content.length > Math.ceil(maximum / 3) * 4 + Math.ceil(maximum / 30)) throw Error("원격 메타데이터 contents 응답 오류입니다.");
    const encoded = value.content.replace(/[\r\n]/g, ""), data = Buffer.from(encoded, "base64");
    if (data.toString("base64") !== encoded || data.length !== descriptor.size || hash(data) !== descriptor.sha256) throw Error("원격 메타데이터 checksum 검증에 실패했습니다.");
    return data;
  }
  async _remoteEnvelope(source, pkg, commit) {
    const descriptor = pkg.files.find(f => f.path === MANIFEST); if (!descriptor) return null;
    const data = await this._remoteFile(source, pkg, descriptor, commit, 2 * 1024 * 1024);
    if (!Buffer.from(data.toString("utf8")).equals(data)) throw Error("원격 manifest UTF-8 오류입니다.");
    const m = JSON.parse(data.toString("utf8"));
    if (m.schemaVersion !== 1 || !Array.isArray(m.components) || m.components.length > 1000 || !Array.isArray(m.profiles) || m.profiles.length > 1000) throw Error("지원하지 않는 원격 패키지 manifest입니다.");
    text(m.title, "패키지 제목", 200); text(m.description, "패키지 설명", 10000, true);
    const claimed = new Set([MANIFEST]), ids = new Set(), skills = new Set();
    const components = m.components.map(c => {
      text(c.id, "구성요소 ID", 160); text(c.name, "구성요소 이름", 160);
      if (ids.has(c.id) || !kinds.has(c.kind) || !Array.isArray(c.files) || !c.files.length && c.kind !== "task-profile") throw Error("원격 구성요소 목록 오류입니다.");
      ids.add(c.id);
      if (c.kind === "skill") { if (skills.has(c.name)) throw Error("중복 스킬 이름입니다."); skills.add(c.name); }
      return { id: c.id, name: c.name, kind: c.kind, files: c.files.map(p => {
        relative(p); const f = pkg.files.find(f => f.path === p);
        if (!f || claimed.has(p)) throw Error("원격 구성요소 파일 참조 오류입니다."); claimed.add(p); return copy(f);
      }) };
    });
    const profiles = m.profiles.map(p => profile(p, [...ids]));
    if (new Set(profiles.map(p => p.id)).size !== profiles.length || !components.length && !profiles.length) throw Error("원격 프로필 목록 오류입니다.");
    let image;
    if (m.image !== undefined) {
      relative(m.image); if (claimed.has(m.image)) throw Error("원격 이미지 경로 충돌입니다.");
      const f = pkg.files.find(f => f.path === m.image); if (!f) throw Error("원격 이미지 inventory 참조 오류입니다."); claimed.add(m.image);
      const imageBytes = await this._remoteFile(source, pkg, f, commit, 2 * 1024 * 1024);
      image = `data:image/${imageType(imageBytes)};base64,${imageBytes.toString("base64")}`;
    }
    if (claimed.size !== pkg.files.length) throw Error("원격 manifest에 포함되지 않은 파일입니다.");
    return { title: m.title, description: m.description, ...(image ? { image } : {}), componentKinds: [...new Set(components.map(c => c.kind))], componentCount: components.length, componentNames: components.map(c => c.name), profileCount: profiles.length, componentMetadata: components, profileTemplates: profiles, metadataVerified: true };
  }
  async _refresh() {
    const records = [], failures = [], succeeded = new Set();
    for (const source of this._sources().filter(s => s.connection)) {
      try {
        const releases = await this.publisher.listReleases(source.connection);
        if (!releases.length) { succeeded.add(source.repository); continue; }
        const version = releases[0].version, described = await this.publisher.describeRelease(source.connection, version);
        const sourceRecords = [];
        for (const p of described.packages.filter(p => p.current)) sourceRecords.push({ key: `${source.id}:${p.id}`, id: p.id, digest: p.digest, title: p.name, description: "", source: { kind: "github", label: source.label, repository: source.repository }, downloaded: false, version, updateAvailable: false, componentKinds: [p.kind], profileCount: p.kind === "task-profile" ? 1 : 0, used: false,
          componentMetadata: [{ id: p.id, name: p.name, kind: p.kind, files: p.files.map(f => ({ ...f })) }],
          profileTemplates: p.profile ? [profile({ ...p.profile, id: p.id, name: p.name }, [])] : [],
          ...await this._remoteEnvelope(source, p, described.manifest.sourceCommit) });
        records.push(...sourceRecords); succeeded.add(source.repository);
      } catch (e) { failures.push({ kind: "github", label: source.label, repository: source.repository, message: e.message }); }
    }
    // Network work never owns the state lock. Merge into the newest local revision.
    try { await this._locked(async s => {
      s.remote = [...s.remote.filter(p => !succeeded.has(p.source.repository)), ...records];
      s.remoteErrors = failures;
      s.github = { phase: failures.length ? "error" : "idle", ...(failures.length ? { message: failures.map(f => `${f.label}: ${f.message}`).join("; ") } : {}), checkedAt: new Date().toISOString() };
      await this._write(s);
    }); } catch (e) { this.refreshError = e; }
  }
  async _download(key) {
    const { source, id } = this._locate(key); if (!source.connection) return { key, downloaded: true };
    const state = await this._state(), remote = state.remote.find(p => p.key === key);
    if (!remote) throw Error("먼저 GitHub 업데이트를 확인하세요.");
    const result = await this.publisher.download(source.connection, remote.version);
    const selected = result.packages.find(p => p.id === id && p.digest === remote.digest && p.current);
    if (!selected) throw Error("선택한 원격 버전을 찾을 수 없습니다.");
    // Verify envelopes before importing a release, including dependencies retained by Publisher.
    for (const p of result.packages) { if (p.files.some(f => f.path === MANIFEST)) envelope(p); }
    // Historical imports preserve old immutable versions and avoid overwriting another selection.
    for (const p of result.packages) await source.lib.importPackage(p, { repository: source.repository, version: remote.version, commit: result.manifest.sourceCommit, current: false });
    await this._locked(async s => { s.downloads ||= {}; s.downloads[key] = selected.digest; await this._catalog(s); await this._write(s); });
    return { key, downloaded: true, digest: selected.digest };
  }
  async close() { if (this.pending) await this.pending; if (this.refreshError) throw this.refreshError; }
}

module.exports = { InstructionWorkbench, validatedImage, validateProfileResources };
