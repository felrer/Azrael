"use strict";

// Independent resource repositories. This module never creates repositories or changes visibility.
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const https = require("node:https");
const { packageDigest, verifyPlan, canonicalDigest } = require("./instruction-library.cjs");
const dependency = name => require(require.resolve(name, { paths: [path.join(__dirname, "../extensions/azrael-ex"), __dirname] }));
const semver = dependency("semver"), yazl = dependency("yazl"), yauzl = dependency("yauzl");
const MAX = 64 * 1024 * 1024, FILE_MAX = 8 * 1024 * 1024;
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const bytes = value => Buffer.from(JSON.stringify(value));
const parse = value => { try { return JSON.parse(value.toString("utf8")); } catch { throw new Error("Invalid resource JSON"); } };
const clone = value => JSON.parse(JSON.stringify(value));
function relative(value) {
  if (typeof value !== "string" || !value || value.length > 240 || value.startsWith("/") || /[\\\x00-\x1f<>:"|?*]/.test(value)) throw new Error("Unsafe resource path");
  for (const part of value.split("/")) if (!part || part === "." || part === ".." || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part)) throw new Error("Unsafe resource path");
  return value;
}
function connection(value) {
  if (!value || !/^[\w.-]+\/[\w.-]+$/.test(value.repository) || !["public", "collaborators"].includes(value.sharing)) throw new Error("Invalid resource connection");
  const branch = value.branch || "main";
  if (!branch || branch.includes("..") || /[\s~^:?*\[\\]/.test(branch) || branch.startsWith("/") || branch.endsWith("/") || branch.includes("@{")) throw new Error("Invalid resource branch");
  return { repository: value.repository, branch, sharing: value.sharing, ...(value.token ? { token: value.token } : {}) };
}
function version(value) { if (typeof value !== "string" || !semver.valid(value) || semver.clean(value) !== value) throw new Error("Invalid resource version"); return value; }
function allowedUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.port && url.port !== "443" || !new Set(["api.github.com", "uploads.github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com", "github-releases.githubusercontent.com", "github.com"]).has(url.hostname)) throw new Error("Resource request origin rejected");
  return url;
}
function requestDefault(url, options) {
  return new Promise((resolve, reject) => {
    const req = https.request(allowedUrl(url), options, res => {
      const chunks = []; let size = 0;
      res.on("data", chunk => { size += chunk.length; if (size > MAX) res.destroy(new Error("Resource response size limit")); else chunks.push(chunk); });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on("error", reject);
    });
    const timer = setTimeout(() => req.destroy(new Error("Resource request deadline")), 30000);
    req.once("close", () => clearTimeout(timer)); req.on("error", reject);
    if (options.body) req.write(options.body); req.end();
  });
}
function fileBytes(file) {
  relative(file.path);
  if (typeof file.content !== "string" || !["utf8", "base64"].includes(file.encoding)) throw new Error("Invalid resource file encoding");
  const output = Buffer.from(file.content, file.encoding);
  if (output.length > FILE_MAX || file.encoding === "base64" && output.toString("base64") !== file.content) throw new Error("Invalid resource file bytes");
  return output;
}
function sanitizePackage(pkg, sharing) {
  if (!pkg || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$/.test(pkg.id) || typeof pkg.name !== "string" || !["skill", "agent-role", "context", "task-profile"].includes(pkg.kind) || pkg.sharing === "local" || (sharing === "public" && pkg.sharing !== "public") || !["public", "collaborators"].includes(pkg.sharing) || !/^[a-f0-9]{64}$/.test(pkg.digest) || !Array.isArray(pkg.files)) throw new Error("Invalid or excluded publication package");
  relative(pkg.id);
  const seen = new Set(), prefixes = new Map();
  const files = pkg.files.map(file => {
    const data = fileBytes(file), key = file.path.toLowerCase();
    if (seen.has(key)) throw new Error("Duplicate resource path"); seen.add(key);
    const parts = file.path.split("/");
    for (let i = 1; i <= parts.length; i++) { const prefix = parts.slice(0,i).join("/"), folded = prefix.toLowerCase(); if (prefixes.has(folded) && prefixes.get(folded) !== prefix) throw new Error("Case-colliding resource directory"); prefixes.set(folded,prefix); }
    for (const other of seen) if (other !== key && (other.startsWith(key + "/") || key.startsWith(other + "/"))) throw new Error("Resource file and directory collision");
    return { path: file.path, encoding: file.encoding, content: data.toString(file.encoding) };
  }).sort((a,b) => a.path.localeCompare(b.path, "en"));
  const result = { id: pkg.id, name: pkg.name, kind: pkg.kind, sharing: pkg.sharing, digest: pkg.digest, files };
  if (pkg.version !== undefined) {
    if (!Number.isSafeInteger(pkg.version) || pkg.version < 1) throw new Error("Invalid package revision");
    result.version = pkg.version;
  }
  if (pkg.profile !== undefined) {
    // Only recipe fields belong to remote metadata; local installation/provenance is never copied.
    result.profile = {};
    for (const key of ["model", "provider", "reasoningEffort", "instructions"]) if (pkg.profile[key] !== undefined) {
      if (typeof pkg.profile[key] !== "string") throw new Error("Invalid profile recipe field");
      result.profile[key] = pkg.profile[key];
    }
    if (!result.profile.model) throw new Error("Profile model required");
    if (pkg.profile.harness !== undefined) {
      result.profile.harness = {};
      for (const key of ["promptProfile","toolProfile"]) if (pkg.profile.harness[key] !== undefined) {
        if (typeof pkg.profile.harness[key] !== "string") throw new Error("Invalid profile harness field");
        result.profile.harness[key] = pkg.profile.harness[key];
      }
    }
    result.profile.dependencies = pkg.profile.dependencies;
    if (!Array.isArray(result.profile.dependencies)) throw new Error("Invalid profile dependencies");
    result.profile.dependencies = result.profile.dependencies.map(dep => {
      if (!dep || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$/.test(dep.id) || !/^[a-f0-9]{64}$/.test(dep.digest)) throw new Error("Invalid profile dependency");
      return { id: dep.id, digest: dep.digest, ...(dep.optional ? { optional: true } : {}) };
    });
  }
  if (packageDigest(result) !== result.digest) throw new Error("Package content digest mismatch");
  return result;
}
function validatePackages(packages, sharing, checkDependencies = true) {
  if (!Array.isArray(packages) || packages.length > 1000) throw new Error("Invalid resource packages");
  const sanitized = packages.map(pkg => sanitizePackage(pkg, sharing)), ids = new Map(), spellings = new Map();
  for (const pkg of sanitized) {
    const folded = pkg.id.toLowerCase(), key = `${folded}@${pkg.digest}`;
    if (ids.has(key) || spellings.has(folded) && spellings.get(folded) !== pkg.id) throw new Error("Duplicate resource package");
    ids.set(key,pkg); spellings.set(folded,pkg.id);
  }
  for (const pkg of checkDependencies ? sanitized : []) for (const dep of pkg.profile?.dependencies || []) {
    const found = ids.get(`${dep.id.toLowerCase()}@${dep.digest}`);
    if (!found && dep.optional) continue;
    if (!found || found.id !== dep.id || found.digest !== dep.digest) throw new Error("Missing frozen profile dependency");
    if (pkg.sharing === "public" && found.sharing !== "public") throw new Error("Public profile dependency is not public");
  }
  return sanitized.sort((a,b) => a.id.localeCompare(b.id, "en") || a.digest.localeCompare(b.digest,"en"));
}
function validateHeads(heads,packages) {
  if (!heads || typeof heads !== "object" || Array.isArray(heads)) throw new Error("Invalid resource heads");
  const known = new Set(packages.map(p => `${p.id}@${p.digest}`)), output = Object.create(null);
  for (const id of Object.keys(heads).sort()) { relative(id); if (!known.has(`${id}@${heads[id]}`)) throw new Error("Resource head snapshot missing"); output[id] = heads[id]; }
  return output;
}
function inventory(packages,heads) {
  const files = []; let size = 0;
  if (heads) files.push({path:"index.json",data:bytes({schemaVersion:1,heads:validateHeads(heads,packages)})});
  for (const pkg of packages) {
    const metadata = { ...pkg, files: pkg.files.map(file => ({ path: file.path, encoding: file.encoding, size: fileBytes(file).length, sha256: hash(fileBytes(file)) })) };
    files.push({ path: `packages/${pkg.id}/${pkg.digest}/package.json`, data: bytes(metadata) });
    for (const file of pkg.files) files.push({ path: `packages/${pkg.id}/${pkg.digest}/files/${file.path}`, data: fileBytes(file) });
  }
  for (const file of files) { size += file.data.length; if (file.data.length > FILE_MAX || size > MAX || files.length > 10000) throw new Error("Resource inventory size limit"); }
  return files.sort((a,b) => a.path.localeCompare(b.path, "en"));
}
function archive(files) {
  return new Promise((resolve,reject) => {
    const zip = new yazl.ZipFile(), chunks = []; let size = 0;
    zip.outputStream.on("data", data => { size += data.length; if (size > MAX) zip.outputStream.destroy(new Error("Resource archive size limit")); else chunks.push(data); });
    zip.outputStream.on("error", reject); zip.outputStream.on("end", () => resolve(Buffer.concat(chunks)));
    for (const file of files) zip.addBuffer(file.data, relative(file.path), { mtime: new Date("2000-01-01T00:00:00Z"), mode: 0o100644 }); zip.end();
  });
}
function extract(buffer, expected) {
  return new Promise((resolve,reject) => yauzl.fromBuffer(buffer, { lazyEntries: true }, (error,zip) => {
    if (error) return reject(new Error("Invalid resource archive"));
    const result = new Map(), seen = new Set(); let total = 0;
    const fail = () => { zip.close(); reject(new Error("Resource archive integrity failed")); };
    zip.on("error", fail); zip.on("end", () => result.size === expected.size ? resolve(result) : fail());
    zip.on("entry", entry => {
      let name; try { name = relative(entry.fileName); } catch { return fail(); }
      const record = expected.get(name), mode = (entry.externalFileAttributes >>> 16) & 0xf000;
      if (!record || seen.has(name.toLowerCase()) || mode === 0xa000 || entry.uncompressedSize !== record.size || record.size > FILE_MAX || (total += record.size) > MAX) return fail();
      seen.add(name.toLowerCase());
      zip.openReadStream(entry, (err,stream) => {
        if (err) return fail(); const chunks = []; let size = 0;
        stream.on("error", fail); stream.on("data", data => { size += data.length; if (size > record.size) fail(); else chunks.push(data); });
        stream.on("end", () => { const data = Buffer.concat(chunks); if (data.length !== record.size || hash(data) !== record.sha256) return fail(); result.set(name,data); zip.readEntry(); });
      });
    }); zip.readEntry();
  }));
}
class InstructionPublisher {
  constructor({ stateRoot, request = requestDefault }) {
    if (!stateRoot || !path.isAbsolute(stateRoot)) throw new Error("Absolute publisher state root required");
    this.stateRoot = path.resolve(stateRoot); this.request = request; this.active = new Set();
  }
  async _request(value, c, method = "GET", data, binary = false, redirects = 0) {
    const url = allowedUrl(value), headers = { "User-Agent": "Azrael-resources", Accept: binary ? "application/octet-stream" : "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
    if (c.token && (url.hostname === "api.github.com" || url.hostname === "uploads.github.com" && method === "POST")) headers.Authorization = `Bearer ${c.token}`;
    let body;
    if (data !== undefined) { body = Buffer.isBuffer(data) ? data : bytes(data); headers["Content-Type"] = Buffer.isBuffer(data) ? "application/octet-stream" : "application/json"; }
    let response;
    try { response = await this.request(url.href, { method, headers, ...(body ? { body } : {}) }); }
    catch { throw new Error("Resource transport failed"); }
    if (!response || !Buffer.isBuffer(response.body) || response.body.length > MAX) throw new Error("Invalid resource response");
    if ([301,302,303,307,308].includes(response.status)) {
      if (!binary || method !== "GET" || redirects >= 5 || !response.headers.location) throw new Error("Unexpected resource redirect");
      const next = allowedUrl(new URL(response.headers.location, url).href);
      // Once redirected, authentication can never be reinstated on this request chain.
      return this._request(next.href, { ...c, token: undefined }, "GET", undefined, true, redirects + 1);
    }
    if (response.status < 200 || response.status >= 300) { const error = new Error(`GitHub resource request failed (${response.status})`); error.status = response.status; throw error; }
    return binary ? response.body : response.body.length ? parse(response.body) : null;
  }
  _api(c, route, method, data) { return this._request(`https://api.github.com/repos/${c.repository}${route}`, c, method, data); }
  async checkConnection(value) {
    const c = connection(value), repo = await this._api(c, "");
    if (repo.full_name?.toLowerCase() !== c.repository.toLowerCase() || Boolean(repo.private) !== (c.sharing === "collaborators") || repo.visibility && repo.visibility !== (c.sharing === "public" ? "public" : "private")) throw new Error("Repository visibility or identity mismatch");
    return { repository: c.repository, branch: c.branch, sharing: c.sharing, readable: true, writable: !!(repo.permissions?.push || repo.permissions?.admin) };
  }
  async _releases(c) {
    const releases = [];
    for (let page = 1; page <= 100; page++) { const batch = await this._api(c, `/releases?per_page=100&page=${page}`); if (!Array.isArray(batch)) throw new Error("Invalid release list"); releases.push(...batch); if (batch.length < 100) return releases; }
    throw new Error("Resource release list limit");
  }
  async listReleases(value) {
    const c = connection(value); await this.checkConnection(c);
    return (await this._releases(c)).filter(r => !r.draft && !r.prerelease && /^azrael-resources-v/.test(r.tag_name) && semver.valid(r.tag_name.slice(18))).map(r => ({ version: r.tag_name.slice(18), notes: typeof r.body === "string" ? r.body : "" })).sort((a,b) => semver.rcompare(a.version,b.version));
  }
  async _release(c, v) {
    try { return await this._api(c, `/releases/tags/${encodeURIComponent(`azrael-resources-v${v}`)}`); }
    catch (error) { if (error.status !== 404) throw error; return (await this._releases(c)).find(r => r.tag_name === `azrael-resources-v${v}`) || null; }
  }
  async _asset(c, asset) {
    if (!Number.isSafeInteger(asset?.id) || asset.id <= 0 || !Number.isSafeInteger(asset.size) || asset.size < 0 || asset.size > MAX) throw new Error("Invalid resource release asset");
    return this._request(`https://api.github.com/repos/${c.repository}/releases/assets/${asset.id}`, c, "GET", undefined, true);
  }
  async _accepted(c,j,current) {
    if (current === j.commit) return true;
    if (current === j.base) return false;
    const comparison = await this._api(c,`/compare/${j.commit}...${current}`);
    return ["ahead","identical"].includes(comparison.status) && comparison.merge_base_commit?.sha === j.commit;
  }
  async download(value,v) {
    const c = connection(value); version(v); await this.checkConnection(c); const release = await this._release(c,v);
    if (!release || release.draft || release.prerelease) throw new Error("Published resource release unavailable");
    const manifestName = `azrael-resources-${v}-manifest.json`, archiveName = `azrael-resources-${v}.zip`;
    const manifests = release.assets?.filter(a => a.name === manifestName), archives = release.assets?.filter(a => a.name === archiveName);
    if (manifests?.length !== 1 || archives?.length !== 1) throw new Error("Resource release assets unavailable");
    const manifestBytes = await this._asset(c,manifests[0]); if (manifestBytes.length > 2*1024*1024) throw new Error("Resource manifest size limit");
    const manifest = parse(manifestBytes);
    if (manifest.schemaVersion !== 1 || manifest.repository !== c.repository || manifest.version !== v || manifest.sharing !== c.sharing || !/^[a-f0-9]{40}$/.test(manifest.sourceCommit) || manifest.archive?.name !== archiveName || manifest.archive.size !== archives[0].size || !/^[a-f0-9]{64}$/.test(manifest.archive.sha256) || !Array.isArray(manifest.files) || manifest.files.length > 10000) throw new Error("Invalid resource manifest");
    const expected = new Map(), folded = new Set();
    for (const file of manifest.files) { relative(file.path); if (folded.has(file.path.toLowerCase()) || !Number.isSafeInteger(file.size) || file.size < 0 || file.size > FILE_MAX || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error("Invalid resource file inventory"); expected.set(file.path,file); folded.add(file.path.toLowerCase()); }
    const zip = await this._asset(c,archives[0]); if (zip.length !== manifest.archive.size || hash(zip) !== manifest.archive.sha256) throw new Error("Resource archive integrity failed");
    const extracted = await extract(zip,expected);
    const packages = [];
    if (!Array.isArray(manifest.packages)) throw new Error("Invalid resource package inventory");
    for (const metadata of manifest.packages) {
      relative(metadata.id); const sourceMetadata = extracted.get(`packages/${metadata.id}/${metadata.digest}/package.json`);
      if (!sourceMetadata || !sourceMetadata.equals(bytes(metadata)) || !Array.isArray(metadata.files)) throw new Error("Resource package metadata mismatch");
      packages.push({ ...metadata, files: metadata.files.map(file => { const data = extracted.get(`packages/${metadata.id}/${metadata.digest}/files/${relative(file.path)}`); if (!data || data.length !== file.size || hash(data) !== file.sha256 || !["utf8","base64"].includes(file.encoding)) throw new Error("Resource package file mismatch"); return { path: file.path, encoding: file.encoding, content: data.toString(file.encoding) }; }) });
    }
    const sanitized = validatePackages(packages,c.sharing);
    const heads = validateHeads(manifest.heads,sanitized);
    const reconstructed = inventory(sanitized,heads);
    if (reconstructed.length !== extracted.size || reconstructed.some(f => !extracted.get(f.path)?.equals(f.data))) throw new Error("Unexpected resource archive files");
    return { packages: sanitized.map(pkg => ({...pkg,current:heads[pkg.id] === pkg.digest})), manifest };
  }
  async _source(c,base) {
    const tree = await this._api(c, `/git/trees/${base}?recursive=1`);
    if (tree.truncated || !Array.isArray(tree.tree) || tree.tree.length > 10000) throw new Error("Incomplete resource source tree");
    const files = new Map();
    for (const entry of tree.tree.filter(e => (e.path.startsWith("packages/") || e.path === "index.json") && e.type !== "tree")) {
      relative(entry.path); if (entry.type !== "blob" || entry.mode !== "100644") throw new Error("Unsupported resource source entry");
      const blob = await this._api(c, `/git/blobs/${entry.sha}`); const data = Buffer.from(blob.content.replace(/\s/g,""), "base64");
      if (blob.encoding !== "base64" || data.length !== blob.size || data.length > FILE_MAX) throw new Error("Invalid source blob"); files.set(entry.path,{ data,sha:entry.sha });
    }
    const packages = [];
    for (const [name,entry] of files) if (/^packages\/[^/]+\/[a-f0-9]{64}\/package.json$/.test(name)) {
      const metadata = parse(entry.data); if (name !== `packages/${metadata.id}/${metadata.digest}/package.json` || !Array.isArray(metadata.files)) throw new Error("Invalid source metadata");
      packages.push({ ...metadata, files: metadata.files.map(file => { const data = files.get(`packages/${metadata.id}/${metadata.digest}/files/${relative(file.path)}`)?.data; if (!data || data.length !== file.size || hash(data) !== file.sha256) throw new Error("Source inventory mismatch"); return {path:file.path,encoding:file.encoding,content:data.toString(file.encoding)}; }) });
    }
    const sanitized = validatePackages(packages,c.sharing), index = files.get("index.json");
    const heads = index ? validateHeads(parse(index.data).heads,sanitized) : {};
    const reconstructed = inventory(sanitized,index ? heads : undefined);
    if (reconstructed.length !== files.size || files.size && !index || reconstructed.some(f => !files.get(f.path)?.data.equals(f.data))) throw new Error("Unexpected source files");
    return { packages:sanitized, heads, files };
  }
  async _save(journal) {
    await this._safeState();
    await fs.mkdir(this.stateRoot,{ recursive:true });
    const file = path.join(this.stateRoot,`${journal.operationId}.json`), temporary = `${file}.tmp`;
    for (const candidate of [file,temporary]) { try { if ((await fs.lstat(candidate)).isSymbolicLink()) throw new Error("Unsafe publisher state path"); } catch (e) { if (e.code !== "ENOENT") throw e; } }
    const handle = await fs.open(temporary,"w",0o600);
    try { await handle.writeFile(bytes(journal)); await handle.sync(); } finally { await handle.close(); }
    await fs.rename(temporary,file);
  }
  async _safeState() {
    const root = path.parse(this.stateRoot).root; let current = root;
    for (const part of this.stateRoot.slice(root.length).split(path.sep)) {
      current = path.join(current,part);
      try { if ((await fs.lstat(current)).isSymbolicLink()) throw new Error("Unsafe publisher state path"); } catch (e) { if (e.code !== "ENOENT") throw e; }
    }
  }
  async publish(plan,value,{ version:v }) {
    plan = clone(plan);
    const c = connection(value); version(v);
    if (!plan || plan.schemaVersion !== 1 || plan.sharing !== c.sharing || !/^[a-f0-9]{64}$/.test(plan.digest)) throw new Error("Invalid approved publication plan");
    verifyPlan(plan);
    const selected = validatePackages(clone(plan.packages),c.sharing,false);
    return this._locked(c,async () => {
      for (const name of await fs.readdir(this.stateRoot)) if (/^[a-f0-9-]{36}\.json$/.test(name)) {
        const journalPath = path.join(this.stateRoot,name);
        if ((await fs.lstat(journalPath)).isSymbolicLink()) throw new Error("Unsafe publisher state path");
        const pending = parse(await fs.readFile(journalPath));
        if (pending.repository === c.repository && pending.version === v && pending.phase !== "published") {
          const error = new Error("Resource version has an unfinished publication; recover the original operation"); error.operationId = pending.operationId; error.phase = pending.phase; throw error;
        }
      }
      if (!(await this.checkConnection(c)).writable) throw new Error("Repository write permission required");
      const existing = await this._release(c,v); if (existing) throw new Error("Resource version already exists; recover its original operation");
      try { await this._api(c,`/git/ref/tags/${encodeURIComponent(`azrael-resources-v${v}`)}`); throw new Error("Resource version tag already exists"); } catch (e) { if (e.status !== 404) throw e; }
      const base = (await this._api(c,`/git/ref/heads/${encodeURIComponent(c.branch)}`)).object.sha;
      const source = await this._source(c,base), merged = new Map(source.packages.map(pkg => [`${pkg.id}@${pkg.digest}`,pkg]));
      for (const pkg of selected) {
        const key = `${pkg.id}@${pkg.digest}`, previous = merged.get(key);
        if (previous && !bytes(previous).equals(bytes(pkg))) throw new Error("Immutable resource snapshot content changed");
        merged.set(key,pkg);
      }
      const packages = validatePackages([...merged.values()],c.sharing);
      const heads = {...source.heads};
      for (const id of plan.rootIds || [...new Set(selected.map(p => p.id))]) {
        const candidates = selected.filter(p => p.id === id);
        const target = plan.heads?.[id] || (candidates.length === 1 ? candidates[0].digest : null);
        if (!target || !candidates.some(p => p.digest === target)) throw new Error("Selected current resource head is ambiguous");
        heads[id] = target;
      }
      validateHeads(heads,packages);
      // The original sealed plan is host-only recovery data; it is never serialized into remote assets.
      const approvedPlan = clone(plan);
      const journal = { schemaVersion:1,operationId:crypto.randomUUID(),repository:c.repository,branch:c.branch,sharing:c.sharing,version:v,digest:plan.digest,base,packages,heads,approvedPlan,oldPaths:[...source.files.keys()],phase:"prepared" };
      await this._save(journal); return this._resume(journal,c);
    });
  }
  async _locked(c,action) {
    const key = `${c.repository.toLowerCase()}:${c.branch}`;
    if (this.active.has(key)) throw new Error("Resource publication is busy"); this.active.add(key);
    const lock = path.join(this.stateRoot,`${hash(Buffer.from(key))}.lock`); let handle;
    try {
      await this._safeState(); await fs.mkdir(this.stateRoot,{recursive:true});
      try { handle = await fs.open(lock,"wx",0o600); }
      catch (error) {
        if (error.code !== "EEXIST") throw error;
        if ((await fs.lstat(lock)).isSymbolicLink()) throw new Error("Unsafe publisher lock");
        const owner = parse(await fs.readFile(lock));
        if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0) throw new Error("Invalid publisher lock");
        try { process.kill(owner.pid,0); throw new Error("Resource publication is busy"); }
        catch (e) { if (e.code !== "ESRCH") throw e; }
        await fs.unlink(lock); handle = await fs.open(lock,"wx",0o600);
      }
      await handle.writeFile(bytes({pid:process.pid})); await handle.sync(); return await action();
    }
    finally { this.active.delete(key); if (handle) { await handle.close(); await fs.unlink(lock); } }
  }
  async recover(value,operationId) {
    const c = connection(value); if (!/^[a-f0-9-]{36}$/.test(operationId)) throw new Error("Invalid publication operation");
    return this._locked(c,async () => {
      if (!(await this.checkConnection(c)).writable) throw new Error("Repository write permission required");
      const file = path.join(this.stateRoot,`${operationId}.json`);
      if ((await fs.lstat(file)).isSymbolicLink()) throw new Error("Unsafe publisher state path");
      const j = parse(await fs.readFile(file));
      if (j.operationId !== operationId || j.repository !== c.repository || j.branch !== c.branch || j.sharing !== c.sharing) throw new Error("Publication recovery destination mismatch");
      verifyPlan(j.approvedPlan); j.packages = validatePackages(j.packages,c.sharing); j.heads = validateHeads(j.heads,j.packages); return this._resume(j,c);
    });
  }
  async listOperations() {
    await this._safeState();
    let names; try { names = await fs.readdir(this.stateRoot); } catch (error) { if (error.code === "ENOENT") return []; throw error; }
    const results = [];
    for (const name of names.filter(name => /^[a-f0-9-]{36}\.json$/.test(name)).sort()) {
      const file = path.join(this.stateRoot,name);
      if ((await fs.lstat(file)).isSymbolicLink()) throw new Error("Unsafe publisher state path");
      const j = parse(await fs.readFile(file));
      if (j.operationId !== name.slice(0,-5) || !["prepared","source-committed","published"].includes(j.phase)) throw new Error("Invalid publication journal");
      const c = connection(j); version(j.version);
      results.push({id:j.operationId,phase:j.phase,repository:c.repository,version:j.version,sharing:c.sharing});
    }
    return results;
  }
  async readOperationPlan(operationId) {
    if (!/^[a-f0-9-]{36}$/.test(operationId)) throw new Error("Invalid publication operation");
    await this._safeState(); const file = path.join(this.stateRoot,`${operationId}.json`);
    if ((await fs.lstat(file)).isSymbolicLink()) throw new Error("Unsafe publisher state path");
    const j = parse(await fs.readFile(file));
    if (j.operationId !== operationId || !j.approvedPlan) throw new Error("Invalid publication journal");
    verifyPlan(j.approvedPlan);
    validatePackages(j.approvedPlan.packages,j.sharing,false);
    return clone(j.approvedPlan);
  }
  async readOperationReceipt(operationId) {
    if (!/^[a-f0-9-]{36}$/.test(operationId)) throw new Error("Invalid publication operation");
    await this._safeState(); const file = path.join(this.stateRoot,`${operationId}.json`);
    if ((await fs.lstat(file)).isSymbolicLink()) throw new Error("Unsafe publisher state path");
    const j = parse(await fs.readFile(file));
    if (j.operationId !== operationId || !["prepared","source-committed","published"].includes(j.phase)) throw new Error("Invalid publication journal");
    if (j.phase === "prepared") return null;
    const c = connection(j); version(j.version);
    if (!/^[a-f0-9]{40}$/.test(j.commit) || !/^[a-f0-9]{64}$/.test(j.digest)) throw new Error("Invalid publication receipt");
    return {operationId,id:operationId,phase:j.phase,repository:c.repository,destination:c.repository,sharing:c.sharing,version:j.version,commit:j.commit,digest:j.digest,...(j.releaseId ? {releaseId:j.releaseId} : {})};
  }
  async _resume(j,c) {
    try {
      const files = inventory(j.packages,j.heads);
      if (!j.commit) {
        const current = (await this._api(c,`/git/ref/heads/${encodeURIComponent(c.branch)}`)).object.sha;
        if (current !== j.base) throw new Error("Resource branch changed; publication requires a new comparison");
        const tree = [];
        for (const file of files) { const blob = await this._api(c,"/git/blobs","POST",{ content:file.data.toString("base64"),encoding:"base64" }); tree.push({path:file.path,mode:"100644",type:"blob",sha:blob.sha}); }
        const paths = new Set(files.map(f => f.path)); for (const old of j.oldPaths) if (!paths.has(old)) tree.push({path:old,mode:"100644",type:"blob",sha:null});
        const baseCommit = await this._api(c,`/git/commits/${j.base}`);
        const created = await this._api(c,"/git/trees","POST",{base_tree:baseCommit.tree.sha,tree});
        const commit = await this._api(c,"/git/commits","POST",{message:`Publish instruction resources ${j.version} (${j.operationId})`,tree:created.sha,parents:[j.base]});
        j.commit = commit.sha; await this._save(j);
      }
      if (j.phase === "prepared") {
        const current = (await this._api(c,`/git/ref/heads/${encodeURIComponent(c.branch)}`)).object.sha;
        if (!await this._accepted(c,j,current)) {
          if (current !== j.base) throw new Error("Resource branch changed; publication requires a new comparison");
          await this._api(c,`/git/refs/heads/${encodeURIComponent(c.branch)}`,"PATCH",{sha:j.commit,force:false});
        }
        j.phase = "source-committed"; await this._save(j);
      }
      if (!j.archive) {
        const zip = await archive(files), metadata = files.filter(f => /\/package.json$/.test(f.path)).map(f => parse(f.data));
        j.archive = { name:`azrael-resources-${j.version}.zip`,size:zip.length,sha256:hash(zip),content:zip.toString("base64") };
        j.manifest = {schemaVersion:1,repository:j.repository,version:j.version,sharing:j.sharing,sourceCommit:j.commit,archive:{name:j.archive.name,size:zip.length,sha256:hash(zip)},files:files.map(f => ({path:f.path,size:f.data.length,sha256:hash(f.data)})),packages:metadata,heads:j.heads};
        await this._save(j);
      }
      const storedArchive = Buffer.from(j.archive.content,"base64");
      if (storedArchive.length !== j.archive.size || hash(storedArchive) !== j.archive.sha256 || j.manifest.sourceCommit !== j.commit || j.manifest.repository !== j.repository || j.manifest.version !== j.version || j.manifest.sharing !== j.sharing || canonicalDigest(j.manifest.heads) !== canonicalDigest(j.heads) || canonicalDigest(j.manifest.archive) !== canonicalDigest({name:j.archive.name,size:j.archive.size,sha256:j.archive.sha256}) || canonicalDigest(j.manifest.files) !== canonicalDigest(files.map(f => ({path:f.path,size:f.data.length,sha256:hash(f.data)}))) || canonicalDigest(j.manifest.packages) !== canonicalDigest(files.filter(f => /\/package.json$/.test(f.path)).map(f => parse(f.data)))) throw new Error("Frozen publication integrity mismatch");
      let release = await this._release(c,j.version);
      if (!release) release = await this._api(c,"/releases","POST",{tag_name:`azrael-resources-v${j.version}`,target_commitish:j.commit,name:`Instruction resources ${j.version}`,body:`Resource operation ${j.operationId}; manifest sha256 ${hash(bytes(j.manifest))}`,draft:true,prerelease:false});
      if (release.body !== `Resource operation ${j.operationId}; manifest sha256 ${hash(bytes(j.manifest))}`) throw new Error("Resource version belongs to different frozen content");
      j.releaseId = release.id; await this._save(j);
      const expected = [{name:j.archive.name,data:Buffer.from(j.archive.content,"base64")},{name:`azrael-resources-${j.version}-manifest.json`,data:bytes(j.manifest)}];
      j.assets ||= {};
      for (const asset of expected) {
        const matches = release.assets?.filter(a => a.name === asset.name) || []; if (matches.length > 1) throw new Error("Duplicate resource release asset");
        let remote = matches[0];
        if (!remote) {
          if (!release.draft) throw new Error("Published resource release is incomplete");
          remote = await this._request(`https://uploads.github.com/repos/${c.repository}/releases/${release.id}/assets?name=${encodeURIComponent(asset.name)}`,c,"POST",asset.data);
        }
        const actual = await this._asset(c,remote); if (actual.length !== asset.data.length || hash(actual) !== hash(asset.data)) throw new Error("Uploaded resource asset integrity failed");
        j.assets[asset.name] = {id:remote.id,size:actual.length,sha256:hash(actual)}; await this._save(j);
      }
      if (release.draft) await this._api(c,`/releases/${release.id}`,"PATCH",{draft:false});
      j.phase = "published"; await this._save(j);
      return {repository:j.repository,sharing:j.sharing,version:j.version,commit:j.commit,releaseId:j.releaseId,digest:j.digest,phase:"published",operationId:j.operationId};
    } catch (cause) {
      // A lost PATCH response is ambiguous: inspect the ref before reporting whether source was shared.
      if (j.phase === "prepared" && j.commit) {
        try { if (await this._accepted(c,j,(await this._api(c,`/git/ref/heads/${encodeURIComponent(c.branch)}`)).object.sha)) { j.phase = "source-committed"; await this._save(j); } } catch { /* Journal retains the candidate commit for explicit recovery. */ }
      }
      const error = new Error(j.phase === "prepared" ? "Resource publication interrupted; inspect its operation before retrying" : "Source is already shared; installable release publication failed");
      error.phase = j.phase; error.operationId = j.operationId; error.repository = j.repository; error.version = j.version; error.reason = cause.message; error.status = cause.status;
      error.sharing = j.sharing; error.digest = j.digest;
      if (j.phase !== "prepared") error.commit = j.commit;
      throw error;
    }
  }
}
module.exports = { InstructionPublisher };
