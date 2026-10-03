"use strict";

// Consumer-side instruction acquisition and transactional installation. No Git or Python.
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const https = require("node:https");
const { execFile } = require("node:child_process");
function dependency(name) {
  try { return require(name); } catch (error) {
    if (error.code !== "MODULE_NOT_FOUND") throw error;
    return require(require.resolve(name, { paths: [path.join(__dirname, "../extensions/azrael-ex")] }));
  }
}
const yauzl = dependency("yauzl");
const semver = dependency("semver");
const toml = dependency("smol-toml");
const LIMITS = Object.freeze({ manifest: 2 * 1024 * 1024, documents: 16 * 1024 * 1024, archive: 64 * 1024 * 1024, file: 8 * 1024 * 1024, total: 128 * 1024 * 1024, entries: 10000, redirects: 5, timeout: 30000 });
const KEYS = new Set(["enabled", "default_subagent_model", "default_subagent_reasoning_effort", "max_concurrent_threads_per_session"]);
const digest = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const json = bytes => JSON.parse(bytes.toString("utf8"));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const clone = value => JSON.parse(JSON.stringify(value));
function version(value) { if (typeof value !== "string" || !semver.valid(value) || semver.clean(value) !== value) throw new Error("Invalid instruction version"); return value; }
function relative(value) {
  if (typeof value !== "string" || !value || value.length > 240 || value.includes("\\") || value.includes("\0") || value.startsWith("/") || /^[A-Za-z]:/.test(value)) throw new Error("Unsafe package path");
  for (const part of value.split("/")) {
    if (!part || part === "." || part === ".." || /[<>:"|?*~\x00-\x1f]/.test(part) || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part)) throw new Error(`Unsafe package path: ${value}`);
  }
  return value;
}
async function safe(absolute) {
  absolute = path.resolve(absolute);
  const root = path.parse(absolute).root;
  let current = root;
  for (const segment of absolute.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try { if ((await fs.lstat(current)).isSymbolicLink()) throw new Error(`Symlink path rejected: ${current}`); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  return absolute;
}
async function read(file, limit = LIMITS.file) { await safe(file); try { const s = await fs.stat(file); if (!s.isFile() || s.size > limit) throw new Error(`Invalid target file: ${file}`); return await fs.readFile(file); } catch (e) { if (e.code === "ENOENT") return null; throw e; } }
async function write(file, bytes) { await safe(file); await fs.mkdir(path.dirname(file), { recursive: true }); await safe(file); await fs.writeFile(file, bytes); }
async function remove(file) { await safe(file); await fs.rm(file, { force: true }); }
async function atomic(file, bytes) {
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  await write(temp, bytes);
  try { await safe(file); await fs.rename(temp, file); } finally { await remove(temp); }
}
function allowedUrl(value) {
  const url = new URL(value);
  const hosts = new Set(["api.github.com", "github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com", "github-releases.githubusercontent.com"]);
  if (url.protocol !== "https:" || url.port && url.port !== "443" || url.username || url.password || !hosts.has(url.hostname)) throw new Error("Instruction request host rejected");
  return url;
}
function requestBytes(value, options = {}, redirects = 0) {
  return new Promise((resolve, reject) => {
    const url = allowedUrl(value);
    const req = https.get(url, { headers: { "User-Agent": "Azrael-instructions", Accept: "application/vnd.github+json" }, signal: options.signal }, res => {
      if ([301,302,303,307,308].includes(res.statusCode)) {
        res.resume();
        if (redirects >= LIMITS.redirects || !res.headers.location) return reject(new Error("Instruction redirect limit"));
        try { resolve(requestBytes(new URL(res.headers.location, url).href, options, redirects + 1)); } catch(e) { reject(e); }
        return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`GitHub request failed (${res.statusCode})`)); return; }
      const chunks = []; let size = 0;
      res.on("data", chunk => { size += chunk.length; if (size > options.maxBytes) { res.destroy(new Error("Instruction download size limit")); return; } chunks.push(chunk); options.onProgress?.({ received: size, total: Number(res.headers["content-length"]) || undefined }); });
      res.on("error", reject); res.on("end", () => resolve(Buffer.concat(chunks)));
    });
    const deadline=setTimeout(() => req.destroy(new Error("Instruction request deadline exceeded")),LIMITS.timeout);
    req.once("close",()=>clearTimeout(deadline));
    req.setTimeout(LIMITS.timeout, () => req.destroy(new Error("Instruction request timeout")));
    req.on("error", reject);
  });
}
function checkAsset(asset, max, expectedName) {
  if (!asset || asset.name !== expectedName || !Number.isSafeInteger(asset.size) || asset.size < 0 || asset.size > max || !/^[a-f0-9]{64}$/.test(asset.sha256)) throw new Error("Invalid instruction asset descriptor");
}
function allowedTarget(scope,target,configKeys) {
  relative(target);
  return scope === "workspace" ? /^docs\/playbooks\/.+/.test(target) : scope === "home" && (target === "AGENTS.md" || /^agents\/[^/]+\.toml$/.test(target) || /^skills\/[^/]+\/.+/.test(target) || target === "config.toml" && configKeys?.length && configKeys.every(k=>KEYS.has(k)));
}
function normalizedRoot(root) { return typeof root==="string" && path.isAbsolute(root) && path.resolve(root)===root; }
function receiptRoot(target,receipt,homeRoot) {
  if (!normalizedRoot(target) || !receipt || !["home","workspace"].includes(receipt.scope) || !allowedTarget(receipt.scope,receipt.relative,receipt.config ? Object.keys(receipt.values || {}) : undefined)) throw new Error("Invalid managed target receipt");
  if (!!receipt.config!==(receipt.scope==="home" && receipt.relative==="config.toml"))throw new Error("Invalid managed configuration receipt scope");
  if(!receipt.config && (!/^[a-f0-9]{64}$/.test(receipt.sha256 || "") || !(receipt.original===null || typeof receipt.original==="string" && receipt.original.length<=Math.ceil(LIMITS.file/3)*4 && receipt.original.length%4===0 && /^[A-Za-z0-9+/]*={0,2}$/.test(receipt.original))))throw new Error("Invalid managed file receipt");
  if(receipt.componentId!==undefined)componentIds([receipt.componentId]);
  if(receipt.appliedVersion!==undefined)version(receipt.appliedVersion);
  if(receipt.repository!==undefined && !/^[\w.-]+\/[\w.-]+$/.test(receipt.repository))throw new Error("Invalid managed receipt repository");
  let root=receipt.scope==="home" ? homeRoot : receipt.root;
  if (receipt.scope==="workspace" && root===undefined) { root=target; for(const _ of receipt.relative.split("/")) root=path.dirname(root); }
  if (!normalizedRoot(root) || path.join(root,receipt.relative)!==target) throw new Error("Invalid managed target receipt root");
  return root;
}
function componentIds(ids) { if (!Array.isArray(ids) || ids.some(id=>typeof id!=="string" || !/^[a-zA-Z0-9._-]+$/.test(id)) || new Set(ids).size!==ids.length) throw new Error("Invalid component selection receipt"); return ids; }
function validateManifest(m, repository, requested) {
  if (!m || m.schemaVersion !== 1 || version(m.instructionVersion) !== requested || m.repository !== repository || !semver.valid(m.minimumAppVersion) || typeof m.sourceCommit !== "string" || !/^[a-f0-9]{40,64}$/i.test(m.sourceCommit) || !/^[a-f0-9]{64}$/.test(m.sourceContentSha256)) throw new Error("Invalid instruction manifest identity");
  checkAsset(m.archive, LIMITS.archive, `azrael-instructions-${requested}.zip`);
  checkAsset(m.documentsAsset, LIMITS.documents, `azrael-instructions-${requested}-documents.json`);
  if (!Array.isArray(m.files) || !m.files.length || m.files.length > LIMITS.entries || !Array.isArray(m.components) || !Array.isArray(m.documents)) throw new Error("Invalid instruction manifest lists");
  const paths = new Set(); let total = 0;
  for (const file of m.files) { relative(file.path); const key = file.path.toLowerCase(); if (paths.has(key) || !Number.isSafeInteger(file.size) || file.size < 0 || file.size > LIMITS.file || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error("Invalid or duplicate manifest file"); paths.add(key); total += file.size; }
  const nodes=new Map();
  for (const file of m.files) { const parts=file.path.split("/"); for (let i=1;i<=parts.length;i++) { const name=parts.slice(0,i).join("/"), key=name.toLowerCase(), type=i===parts.length ? "file" : "directory"; const prior=nodes.get(key); if (prior && (prior.name!==name || prior.type!==type)) throw new Error("Case alias or file-directory collision in manifest"); nodes.set(key,{name,type}); } }
  const canonical=m.files.map(f=>({path:f.path,sha256:f.sha256,size:f.size})).sort((a,b)=>a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  if (digest(Buffer.from(JSON.stringify(canonical))) !== m.sourceContentSha256) throw new Error("Instruction source content digest mismatch");
  if (total > LIMITS.total || !m.files.some(f => f.path === "azrael-environment.json")) throw new Error("Invalid instruction file tree");
  const ids = new Set();
  for (const c of m.components) {
    if (!c || typeof c.id !== "string" || !/^[a-zA-Z0-9._-]+$/.test(c.id) || ids.has(c.id) || typeof c.title !== "string" || typeof c.kind !== "string" || typeof c.default !== "boolean" || !["home", "workspace"].includes(c.scope) || !Array.isArray(c.files)) throw new Error("Invalid instruction component");
    ids.add(c.id);
    if (c.configKeys && (!Array.isArray(c.configKeys) || c.scope !== "home" || c.configKeys.some(k => !KEYS.has(k)) || new Set(c.configKeys).size !== c.configKeys.length)) throw new Error("Invalid managed config keys");
    for (const f of c.files) {
      relative(f.source); relative(f.target);
      if (!m.files.some(entry => entry.path === f.source)) throw new Error("Component source absent from manifest");
      if (!allowedTarget(c.scope,f.target,c.configKeys) || f.target === "config.toml" && f.source !== "config.example.toml") throw new Error("Instruction target outside approved scope");
    }
  }
  for (const d of m.documents) if (!d || !m.files.some(f => f.path === d.path) || typeof d.title !== "string" || typeof d.kind !== "string") throw new Error("Invalid document record");
  return m;
}
async function extract(bytes, manifest, destination) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(bytes, { lazyEntries: true, decodeStrings: true, strictFileNames: true, validateEntrySizes: true }, (error, zip) => {
      if (error) return reject(error);
      const seen = new Set(); let total = 0; let count = 0; let finished = false;
      const fail = e => { if (!finished) { finished = true; zip.close(); reject(e); } };
      zip.on("error", fail);
      zip.on("entry", entry => {
        (async () => {
          if (++count > LIMITS.entries) throw new Error("Archive entry limit");
          const directory = entry.fileName.endsWith("/"); const name = relative(directory ? entry.fileName.slice(0,-1) : entry.fileName);
          const key = name.toLowerCase(); if (seen.has(key)) throw new Error("Duplicate archive path"); seen.add(key);
          const type = (entry.externalFileAttributes >>> 16) & 0xf000;
          if (type && type !== (directory ? 0x4000 : 0x8000)) throw new Error("Archive symlink or special file rejected");
          if (directory) { if (!manifest.files.some(f => f.path.startsWith(`${name}/`))) throw new Error("Unexpected archive directory"); zip.readEntry(); return; }
          const expected = manifest.files.find(f => f.path === name);
          if (!expected || entry.uncompressedSize !== expected.size || entry.uncompressedSize > LIMITS.file) throw new Error("Unexpected archive file or size");
          total += entry.uncompressedSize; if (total > LIMITS.total) throw new Error("Archive total size limit");
          const stream = await new Promise((yes,no) => zip.openReadStream(entry, (e,s) => e ? no(e) : yes(s)));
          const chunks=[]; let length=0;
          for await (const chunk of stream) { length += chunk.length; if (length > expected.size) throw new Error("Archive expanded size mismatch"); chunks.push(chunk); }
          const data=Buffer.concat(chunks); if (data.length !== expected.size || digest(data) !== expected.sha256) throw new Error("Archive checksum mismatch");
          await write(path.join(destination, name), data); zip.readEntry();
        })().catch(fail);
      });
      zip.on("end", () => { if (!finished) { finished = true; if (manifest.files.some(f => !seen.has(f.path.toLowerCase()))) reject(new Error("Archive missing files")); else resolve(); } });
      zip.readEntry();
    });
  });
}

class InstructionStore {
  constructor({ stateRoot, appVersion, repository = "felrer/Azrael", engine, workspaceRoot, request } = {}) {
    if (!stateRoot || !path.isAbsolute(stateRoot) || !semver.valid(appVersion) || !/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error("Invalid instruction store options");
    this.homeRoot = path.resolve(stateRoot); this.stateRoot = path.join(this.homeRoot,"azrael","instructions"); this.workspaceRoot = workspaceRoot && path.resolve(workspaceRoot); this.appVersion = appVersion; this.repository = repository; this.engine = engine; this.request = request || requestBytes; this.busy = false;
  }
  file(name) { return path.join(this.stateRoot, name); }
  cache(v) { return this.file(`versions/${version(v)}`); }
  async fetch(url, maxBytes, options = {}) { allowedUrl(url); if (options.signal?.aborted) throw new Error("Instruction download cancelled"); const response = await this.request(url, { ...options, maxBytes }); if (options.signal?.aborted) throw new Error("Instruction download cancelled"); const bytes = Buffer.isBuffer(response) ? response : response?.body; if (!Buffer.isBuffer(bytes) || bytes.length > maxBytes) throw new Error("Instruction response size or type invalid"); return bytes; }
  async state() {
    const bytes=await read(this.file("state.json"),LIMITS.total * 2);
    const state=bytes ? json(bytes) : { schemaVersion:1, repository:this.repository, appliedVersion:null, pinnedVersion:null, selectedComponentIds:[], managed:{} };
    if (state.schemaVersion !== 1 || !/^[\w.-]+\/[\w.-]+$/.test(state.repository)) throw new Error("Invalid instruction state repository");
    const appliedRepository=state.appliedRepository || (state.appliedVersion ? state.repository : null);
    if (!state.managed || typeof state.managed!=="object" || Array.isArray(state.managed)) throw new Error("Invalid managed receipt map");
    const roots=new Map(); const targetKeys=new Set();
    for(const [target,receipt] of Object.entries(state.managed)) { const key=target.toLowerCase(); if(targetKeys.has(key))throw new Error("Duplicate managed receipt target");targetKeys.add(key);const root=receiptRoot(target,receipt,this.homeRoot);if(receipt.scope==="workspace") { if(!roots.has(root))roots.set(root,[]);roots.get(root).push(receipt); } }
    let oldComponents=[];
    if (state.homeComponentIds===undefined || [...roots.keys()].some(root=>!state.workspaceSelections?.[root])) {
      if (state.appliedVersion) { const bytes=await read(path.join(this.cache(state.appliedVersion),"manifest.json"),LIMITS.manifest); if(bytes) oldComponents=validateManifest(json(bytes),appliedRepository,state.appliedVersion).components; }
    }
    const previousIds=componentIds(state.selectedComponentIds || []);
    const homeComponentIds=componentIds(state.homeComponentIds ?? previousIds.filter(id=>oldComponents.some(c=>c.id===id && c.scope==="home")));
    if(state.workspaceSelections!==undefined && (!state.workspaceSelections || typeof state.workspaceSelections!=="object" || Array.isArray(state.workspaceSelections)))throw new Error("Invalid workspace selection receipts");
    const workspaceSelections={...(state.workspaceSelections || {})};
    for(const [root,selection] of Object.entries(workspaceSelections)) { if(!normalizedRoot(root) || !selection || !/^[\w.-]+\/[\w.-]+$/.test(selection.repository))throw new Error("Invalid workspace selection receipt");componentIds(selection.selectedComponentIds);if(selection.appliedVersion!==null)version(selection.appliedVersion); }
    for(const [root,receipts] of roots) if(!workspaceSelections[root]) { const inferred=receipts.map(r=>r.componentId).filter(Boolean);const versions=[...new Set(receipts.map(r=>r.appliedVersion).filter(Boolean))],repositories=[...new Set(receipts.map(r=>r.repository).filter(Boolean))];if(versions.length>1 || repositories.length>1)throw new Error("Inconsistent workspace receipts");workspaceSelections[root]={selectedComponentIds:componentIds(inferred.length ? [...new Set(inferred)] : previousIds.filter(id=>oldComponents.some(c=>c.id===id && c.scope==="workspace"))),appliedVersion:versions[0] || state.appliedVersion,repository:repositories[0] || appliedRepository || state.repository}; }
    const activeIds=[...new Set([...homeComponentIds,...(this.workspaceRoot ? workspaceSelections[this.workspaceRoot]?.selectedComponentIds || [] : [])])];
    const selectedComponentIds=[...previousIds.filter(id=>activeIds.includes(id)),...activeIds.filter(id=>!previousIds.includes(id))];
    return {...state,homeComponentIds,workspaceSelections,selectedComponentIds,appliedRepository,pinnedRepository:state.pinnedRepository || (state.pinnedVersion ? state.repository : null)};
  }
  async getState() {
    const state=await this.state(); const downloadedVersions=[];
    await safe(this.file("versions"));
    let names=[]; try { names=await fs.readdir(this.file("versions")); } catch(e) { if (e.code !== "ENOENT") throw e; }
    for (const name of names) if (semver.valid(name)) { try { await this.cached(name); downloadedVersions.push(name); } catch { /* Incomplete or foreign caches are never advertised. */ } }
    downloadedVersions.sort(semver.rcompare);
    return { ...state, repository:this.repository, installedRepository:state.appliedRepository,currentWorkspaceVersion:this.workspaceRoot ? state.workspaceSelections[this.workspaceRoot]?.appliedVersion || null : null,retainedWorkspaceVersions:Object.entries(state.workspaceSelections).filter(([root,s])=>root!==this.workspaceRoot && s.selectedComponentIds.length).map(([root,s])=>({root,version:s.appliedVersion,repository:s.repository})), downloadedVersions, recoveryRequired:!!(await read(this.file("journal.json"),LIMITS.total * 4)) };
  }
  async releases() {
    const records=[];
    for (let page=1; page<=5; page++) {
      const list=json(await this.fetch(`https://api.github.com/repos/${this.repository}/releases?per_page=100&page=${page}`, LIMITS.manifest));
      if (!Array.isArray(list)) throw new Error("Invalid GitHub release response");
      records.push(...list.filter(r => !r.draft && /^instructions-v/.test(r.tag_name || "") && semver.valid(r.tag_name.slice(14))));
      if (list.length < 100) break;
    }
    return records;
  }
  async release(v) {
    version(v);
    const r=json(await this.fetch(`https://api.github.com/repos/${this.repository}/releases/tags/instructions-v${v}`, LIMITS.manifest));
    if (r.draft || r.tag_name !== `instructions-v${v}` || !Array.isArray(r.assets)) throw new Error("Invalid instruction release");
    return r;
  }
  asset(release, name) { const matches=release.assets.filter(a => a.name === name); if (matches.length !== 1 || !matches[0].browser_download_url) throw new Error(`Missing or ambiguous release asset: ${name}`); allowedUrl(matches[0].browser_download_url); return matches[0].browser_download_url; }
  async remoteManifest(v, release) { return validateManifest(json(await this.fetch(this.asset(release, `azrael-instructions-${v}-manifest.json`), LIMITS.manifest)), this.repository, v); }
  compatible(m) { return semver.gte(this.appVersion, m.minimumAppVersion); }
  async listReleases() {
    const output=[];
    for (const r of await this.releases()) { const v=r.tag_name.slice(14); const manifest=await this.remoteManifest(v,r); output.push({version:v,compatible:this.compatible(manifest),prerelease:!!r.prerelease || !!semver.prerelease(v),notes:typeof r.body === "string" ? r.body : "",manifest}); }
    return output.sort((a,b) => semver.rcompare(a.version,b.version));
  }
  async cached(v) {
    const bytes=await read(path.join(this.cache(v), "manifest.json")); if (!bytes) throw new Error("Instruction version is not downloaded");
    return validateManifest(json(bytes),this.repository,v);
  }
  async getManifest(v) {
    try { return await this.cached(v); } catch(e) { if (e.message !== "Instruction version is not downloaded") throw e; }
    return this.remoteManifest(v,await this.release(v));
  }
  documents(bytes,m) {
    if (bytes.length !== m.documentsAsset.size || digest(bytes) !== m.documentsAsset.sha256) throw new Error("Document asset checksum mismatch");
    const data=json(bytes); const records=Array.isArray(data) ? data : data.documents || Object.entries(data).map(([path,text]) => ({path,text}));
    if (!Array.isArray(records) || records.length !== m.documents.length || new Set(records.map(r => r.path)).size !== records.length) throw new Error("Document asset records mismatch");
    return m.documents.map(d => { const r=records.find(r => r.path === d.path); const f=m.files.find(f => f.path === d.path); if (!r || typeof r.text !== "string" || Buffer.byteLength(r.text) !== f.size || digest(Buffer.from(r.text)) !== f.sha256) throw new Error("Document content mismatch"); return {...d,text:r.text}; });
  }
  async getDocuments(v, options = {}) {
    const m=options.cachedOnly ? await this.cached(v) : await this.getManifest(v); const cached=await read(path.join(this.cache(v), "documents.json"),LIMITS.documents);
    if(options.cachedOnly && !cached)throw new Error("Missing cached documents");
    return this.documents(cached || await this.fetch(this.asset(await this.release(v),m.documentsAsset.name),LIMITS.documents),m);
  }
  async locked(action, recovery = false) {
    if (this.busy) throw new Error("Instruction operation already in progress"); this.busy=true;
    let lock;
    try {
      await safe(this.stateRoot); await fs.mkdir(this.stateRoot,{recursive:true}); await safe(this.file("writer.lock"));
      try { lock=await fs.open(this.file("writer.lock"),"wx"); } catch(e) { if (e.code === "EEXIST") throw new Error("Instruction writer lock exists; inspect recovery data before clearing it"); throw e; }
      await lock.writeFile(JSON.stringify({pid:process.pid,createdAt:new Date().toISOString()}));
      if (!recovery && await read(this.file("journal.json"),LIMITS.total * 4)) throw new Error("Instruction recovery required before mutation");
      return await action();
    } finally { if (lock) { await lock.close(); await remove(this.file("writer.lock")); } this.busy=false; }
  }
  async download(v, options = {}) {
    version(v);
    return this.locked(async () => {
      const r=await this.release(v), m=await this.remoteManifest(v,r);
      if (!this.compatible(m)) throw new Error("Instruction version is incompatible with this app");
      const existing=await read(path.join(this.cache(v),"manifest.json"));
      if (existing) { if (!same(json(existing),m)) throw new Error("Immutable version cache identity conflict"); await this.verifyCache(v,m); return this.getState(); }
      const stage=this.file(`staging-${crypto.randomUUID()}`);
      try {
        const docs=await this.fetch(this.asset(r,m.documentsAsset.name),LIMITS.documents,options); this.documents(docs,m);
        const archive=await this.fetch(this.asset(r,m.archive.name),LIMITS.archive,options);
        if (archive.length !== m.archive.size || digest(archive) !== m.archive.sha256) throw new Error("Archive asset checksum mismatch");
        if (options.signal?.aborted) throw new Error("Instruction download cancelled");
        await extract(archive,m,path.join(stage,"package"));
        const internal=json(await read(path.join(stage,"package/azrael-environment.json")));
        for (const key of ["schemaVersion","instructionVersion","minimumAppVersion","components"]) if (!same(internal[key],m[key])) throw new Error("Internal instruction manifest mismatch");
        await write(path.join(stage,"manifest.json"),Buffer.from(JSON.stringify(m))); await write(path.join(stage,"documents.json"),docs);
        if (options.signal?.aborted) throw new Error("Instruction download cancelled");
        await safe(this.cache(v)); await fs.mkdir(path.dirname(this.cache(v)),{recursive:true}); await fs.rename(stage,this.cache(v));
      } finally { await safe(stage); await fs.rm(stage,{recursive:true,force:true}); }
      return this.getState();
    });
  }
  async verifyCache(v,m) {
    const dir=path.join(this.cache(v),"package"); const found=[];
    async function walk(folder,prefix="") { await safe(folder); for (const entry of await fs.readdir(folder,{withFileTypes:true})) { const name=prefix+entry.name; relative(name); if (entry.isDirectory()) { if (!m.files.some(f=>f.path.startsWith(`${name}/`))) throw new Error("Unexpected cached package directory"); await walk(path.join(folder,entry.name),`${name}/`); } else if (entry.isFile()) { if (!m.files.some(f=>f.path===name) || found.length >= LIMITS.entries) throw new Error("Cached package tree mismatch"); found.push(name); } else throw new Error("Unsafe cached package entry"); } }
    await walk(dir);
    if (found.length !== m.files.length || found.some(n => !m.files.some(f => f.path === n))) throw new Error("Cached package tree mismatch");
    for (const f of m.files) { const bytes=await read(path.join(dir,f.path)); if (!bytes || bytes.length !== f.size || digest(bytes) !== f.sha256) throw new Error("Cached package checksum mismatch"); }
    const docs=await read(path.join(this.cache(v),"documents.json"),LIMITS.documents); if (!docs) throw new Error("Missing cached documents"); this.documents(docs,m);
  }
  target(scope,target) { relative(target); const root=scope === "home" ? this.homeRoot : this.workspaceRoot; if (!root) throw new Error("Workspace component requires an open workspace"); return path.join(root,target); }
  async plan(v, ids) {
    const manifest=await this.cached(v); if (!this.compatible(manifest)) throw new Error("Instruction version is incompatible with this app"); await this.verifyCache(v,manifest);
    const state=await this.state();
    const selected=ids === undefined ? manifest.components.filter(c => c.default && (c.scope==="home" || this.workspaceRoot)).map(c => c.id) : ids;
    if (!Array.isArray(selected) || new Set(selected).size !== selected.length || selected.some(id => !manifest.components.some(c => c.id === id))) throw new Error("Unknown instruction components");
    const components=manifest.components.filter(c => selected.includes(c.id)); const desired=new Map(); const conflicts=[]; const diffs=[]; const snapshots={}; const nextManaged={};
    for (const c of components) for (const file of c.files) {
      const target=this.target(c.scope,file.target); const key=target.toLowerCase(); const bytes=await read(path.join(this.cache(v),"package",file.source));
      if (desired.has(key)) throw new Error("Selected instruction components have overlapping targets");
      desired.set(key,{target,bytes,component:c,config:file.target === "config.toml"});
    }
    const prior={};
    // Foreign workspace receipts are checked lexically and preserved without touching their paths.
    for (const [target,receipt] of Object.entries(state.managed)) {
      const root=receiptRoot(target,receipt,this.homeRoot);
      if(receipt.scope==="workspace" && root!==this.workspaceRoot) { if(desired.has(target.toLowerCase()))throw new Error("Instruction target belongs to a retained workspace");nextManaged[target]=receipt; }
      else prior[target]=receipt;
    }
    const targets=new Set([...desired.values()].map(x=>x.target).concat(Object.keys(prior)));
    for (const target of targets) {
      const proposal=desired.get(target.toLowerCase()); const old=prior[target]; const current=await read(target); snapshots[target]=current;
      const config=proposal?.config || old?.config;
      let after=proposal?.bytes || null; let receipt;
      if (config) {
        const document=current ? toml.parse(current.toString("utf8")) : {}; const agents=document.agents || {};
        if (typeof agents !== "object" || Array.isArray(agents)) throw new Error("Invalid existing agents table");
        const values=proposal ? toml.parse(proposal.bytes.toString("utf8")).agents || {} : {};
        const keys=proposal?.component.configKeys || []; const oldKeys=Object.keys(old?.values || {});
        for (const k of new Set([...keys,...oldKeys])) {
          if (!KEYS.has(k)) throw new Error("Invalid managed configuration receipt");
          const existed=Object.prototype.hasOwnProperty.call(agents,k); const baseline=old?.values?.[k];
          if (oldKeys.includes(k) ? !same(agents[k],baseline) : existed && !same(agents[k],values[k])) conflicts.push({target,reason:`Locally edited or unmanaged agents.${k}`,current:current?.toString("utf8"),proposed:proposal?.bytes.toString("utf8")});
          if (keys.includes(k)) { if (!Object.prototype.hasOwnProperty.call(values,k)) throw new Error(`Config source missing agents.${k}`); agents[k]=values[k]; }
          else { if (old.originalValues?.[k]?.present) agents[k]=old.originalValues[k].value; else delete agents[k]; }
        }
        document.agents=agents; after=current || proposal ? Buffer.from(toml.stringify(document)) : null;
        if (proposal) { const originalValues={}; for (const k of keys) originalValues[k]=old?.originalValues?.[k] || {present:!!current && Object.prototype.hasOwnProperty.call((toml.parse(current.toString("utf8")).agents || {}),k),value:current ? (toml.parse(current.toString("utf8")).agents || {})[k] : undefined}; receipt={config:true,values:Object.fromEntries(keys.map(k=>[k,values[k]])),originalValues}; }
      } else {
        if (old ? !current || digest(current) !== old.sha256 : current !== null && (!after || !current.equals(after))) conflicts.push({target,reason:old ? "Managed instruction file has local changes" : "Unmanaged instruction target exists",current:current?.toString("utf8"),proposed:after?.toString("utf8")});
        if (!proposal) after=old?.original === null ? null : Buffer.from(old.original,"base64");
        if (proposal) receipt={sha256:digest(after),original:old ? old.original : current?.toString("base64") ?? null};
      }
      if (proposal) nextManaged[target]={...receipt,scope:proposal.component.scope,relative:path.relative(proposal.component.scope === "home" ? this.homeRoot : this.workspaceRoot,target).split(path.sep).join("/"),componentId:proposal.component.id,...(proposal.component.scope==="workspace" ? {root:this.workspaceRoot,appliedVersion:v,repository:this.repository} : {})};
      if (!((current === null && after === null) || current && after && current.equals(after))) diffs.push({target,before:current?.toString("utf8"),after:after?.toString("utf8"),operation:after === null ? "delete" : current === null ? "create" : "update",bytes:after});
    }
    return {manifest,state,conflicts,diffs,components:components.map(c=>c.id),snapshots,nextManaged};
  }
  publicPlan(p) { return {conflicts:p.conflicts,diffs:p.diffs.map(({bytes,...d})=>d),components:p.components}; }
  async planApply(v,ids) { return this.publicPlan(await this.plan(v,ids)); }
  async validate(stage) {
    const args={codexHome:stage,configPath:path.join(stage,"config.toml")};
    if (typeof this.engine === "function") { if (await this.engine(args) === false) throw new Error("Native instruction configuration validation failed"); }
    else if (this.engine && typeof this.engine.validateConfig === "function") { if (await this.engine.validateConfig(args) === false) throw new Error("Native instruction configuration validation failed"); }
    else if (typeof this.engine === "string") await new Promise((resolve,reject)=>execFile(this.engine,["features","list"],{env:{...process.env,CODEX_HOME:stage},timeout:LIMITS.timeout,maxBuffer:1024*1024},(error)=>error ? reject(new Error(`Native instruction configuration validation failed: ${error.message}`)) : resolve()));
    else throw new Error("Native engine required to validate instruction configuration");
  }
  async apply(v,ids) { return this.locked(()=>this.applyLocked(v,ids)); }
  async applyLocked(v,ids) {
      const p=await this.plan(v,ids);
      if (p.state.pinnedVersion && p.state.pinnedRepository===this.repository && p.state.pinnedVersion!==v) throw new Error(`Instruction version ${p.state.pinnedVersion} is pinned; unpin before applying another version`);
      if (p.conflicts.length) { const error=new Error("Instruction application has local conflicts"); error.conflicts=p.conflicts; throw error; }
      const stage=this.file(`apply-${crypto.randomUUID()}`); const originalState=await read(this.file("state.json"),LIMITS.total * 2); let journalWritten=false;
      try {
        const configTarget=path.join(this.homeRoot,"config.toml"); const config=p.diffs.find(d=>d.target===configTarget)?.bytes ?? await read(configTarget);
        if (!Object.prototype.hasOwnProperty.call(p.snapshots,configTarget)) p.snapshots[configTarget]=config;
        await write(path.join(stage,"config.toml"),config || Buffer.from(""));
        // Engine discovery may read agent files, so validate the complete staged agent subset.
        for (const [target,receipt] of Object.entries(p.nextManaged)) if (receipt.scope === "home" && receipt.relative.startsWith("agents/")) { const data=p.diffs.find(d=>d.target===target)?.bytes || await read(target); await write(path.join(stage,receipt.relative),data); }
        await this.validate(stage);
        await this.verifyCache(v,p.manifest);
        if (!same(await this.state(),p.state)) throw new Error("Instruction state changed concurrently");
        if (!same(await read(this.file("state.json"),LIMITS.total * 2),originalState)) throw new Error("Instruction state changed concurrently");
        for (const [target,before] of Object.entries(p.snapshots)) { const now=await read(target); if (!(now === null && before === null || now && before && now.equals(before))) throw new Error(`Instruction target changed concurrently: ${target}`); }
        for (const d of p.diffs) if (d.bytes !== null) await write(path.join(stage,"outputs",String(p.diffs.indexOf(d))),d.bytes);
        const workspaceSelections={...p.state.workspaceSelections};
        if(this.workspaceRoot) { const selectedComponentIds=p.manifest.components.filter(c=>c.scope==="workspace" && p.components.includes(c.id)).map(c=>c.id);workspaceSelections[this.workspaceRoot]={selectedComponentIds,appliedVersion:selectedComponentIds.length ? v : null,repository:this.repository}; }
        const state={...p.state,repository:this.repository,appliedRepository:this.repository,appliedVersion:v,selectedComponentIds:p.components,homeComponentIds:p.manifest.components.filter(c=>c.scope==="home" && p.components.includes(c.id)).map(c=>c.id),workspaceSelections,managed:p.nextManaged};
        const stateBytes=Buffer.from(JSON.stringify(state,null,2));
        const journal={schemaVersion:1,repository:this.repository,state:originalState?.toString("base64") ?? null,afterState:stateBytes.toString("base64"),targets:p.diffs.map(d=>({target:d.target,before:p.snapshots[d.target]?.toString("base64") ?? null,after:d.bytes?.toString("base64") ?? null}))};
        await atomic(this.file("journal.json"),Buffer.from(JSON.stringify(journal))); journalWritten=true;
        for (const d of p.diffs) { const now=await read(d.target), before=p.snapshots[d.target]; if (!(now===null && before===null || now && before && now.equals(before))) throw new Error(`Instruction target changed concurrently: ${d.target}`); await safe(d.target); if (d.bytes === null) await remove(d.target); else await atomic(d.target,d.bytes); }
        if (!same(await read(this.file("state.json"),LIMITS.total * 2),originalState)) throw new Error("Instruction state changed concurrently");
        await atomic(this.file("state.json"),stateBytes);
        await remove(this.file("journal.json")); journalWritten=false;
      } catch(error) {
        if (journalWritten) { try { await this.restoreJournal(); } catch(restoreError) { error.message += `; recovery required: ${restoreError.message}`; } }
        throw error;
      } finally { await safe(stage); await fs.rm(stage,{recursive:true,force:true}); }
      return this.getState();
  }
  async pin(v) { return this.locked(async()=>{ if (v !== null) { const m=await this.getManifest(version(v)); if (!this.compatible(m)) throw new Error("Instruction version is incompatible with this app"); } const state=await this.state(); state.repository=this.repository;state.pinnedVersion=v;state.pinnedRepository=v===null ? null : this.repository; await atomic(this.file("state.json"),Buffer.from(JSON.stringify(state,null,2))); return this.getState(); }); }
  async rollback(v) { return this.locked(async()=> { const m=await this.cached(version(v)); const state=await this.state(); return this.applyLocked(v,state.appliedVersion ? state.selectedComponentIds?.filter(id=>m.components.some(c=>c.id===id)) : undefined); }); }
  async restoreJournal() {
    const bytes=await read(this.file("journal.json"),LIMITS.total * 4); if (!bytes) return;
    const journal=json(bytes);
    if (journal.schemaVersion !== 1 || !/^[\w.-]+\/[\w.-]+$/.test(journal.repository) || !Array.isArray(journal.targets)) throw new Error("Invalid instruction recovery journal");
    const currentState=await read(this.file("state.json"),LIMITS.total * 2);
    const priorState=journal.state===null ? null : Buffer.from(journal.state,"base64");
    const afterState=journal.afterState ? Buffer.from(journal.afterState,"base64") : null;
    if (!(currentState===null && priorState===null || currentState && (priorState && currentState.equals(priorState) || afterState && currentState.equals(afterState)))) throw new Error("Recovery state has newer local edits");
    // A interrupted commit must not clobber edits made since it stopped.
    for (const item of journal.targets) {
      if (!path.isAbsolute(item.target)) throw new Error("Invalid journal target");
      const approved=[[this.homeRoot,"home"],[this.workspaceRoot,"workspace"]].filter(([root])=>!!root).some(([root,scope])=>{
        if (!item.target.startsWith(root+path.sep)) return false;
        const rel=path.relative(root,item.target).split(path.sep).join("/");
        return allowedTarget(scope,rel,scope==="home" ? [...KEYS] : undefined);
      });
      if (!approved) throw new Error("Recovery target outside approved managed scope");
      const current=await read(item.target); const before=item.before===null ? null : Buffer.from(item.before,"base64"); const after=item.after===null ? null : Buffer.from(item.after,"base64");
      if (!(current===null && (before===null || after===null) || current && (before && current.equals(before) || after && current.equals(after)))) throw new Error(`Recovery target has newer local edits: ${item.target}`);
    }
    for (const item of [...journal.targets].reverse()) { if (item.before===null) await remove(item.target); else await atomic(item.target,Buffer.from(item.before,"base64")); }
    if (journal.state===null) await remove(this.file("state.json")); else await atomic(this.file("state.json"),Buffer.from(journal.state,"base64"));
    await remove(this.file("journal.json"));
  }
  async recover() { return this.locked(async()=>{ await this.restoreJournal(); return this.getState(); },true); }
}
module.exports={InstructionStore,LIMITS};
