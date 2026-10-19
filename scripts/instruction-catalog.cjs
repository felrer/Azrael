"use strict";

// Local, read-only discovery. Catalog paths and file contents belong to the host.
const fs = require("node:fs/promises");
const nativeFs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { TextDecoder } = require("node:util");
const { packageDigest } = require("./instruction-library.cjs");
const LIMITS = Object.freeze({ entries: 512, nodes: 20000, depth: 12, files: 512, fileBytes: 8 * 1024 * 1024, packageBytes: 32 * 1024 * 1024, totalBytes: 64 * 1024 * 1024 });
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
function relative(value) {
  if (typeof value !== "string" || !value || value.length > 240 || value.includes("\\") || path.posix.isAbsolute(value) || /^[a-z]:/i.test(value)) throw Error("Unsafe relative path");
  if (value.split("/").some(p => !p || p === "." || p === ".." || /[<>:\"|?*\x00-\x1f]/.test(p) || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) throw Error("Unsafe relative path");
  return value;
}
async function safe(target) {
  target = path.resolve(target);
  let current = path.parse(target).root;
  for (const segment of target.slice(current.length).split(path.sep).filter(Boolean)) {
    let count = 0;
    for await (const item of await fs.opendir(current)) {
      if (++count > LIMITS.nodes) throw Error("Source directory size limit reached");
      if (item.name.toLowerCase() === segment.toLowerCase() && item.name !== segment) throw Error("Case alias path rejected");
    }
    current = path.join(current, segment);
    if ((await fs.lstat(current)).isSymbolicLink()) throw Error("Linked paths are not catalog sources");
  }
  return target;
}
function uuid(identity) {
  const bytes = crypto.createHash("sha256").update(identity).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 80; bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString("hex");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
function metadata(text, fallback) {
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] || "";
  const field = key => new RegExp(`^${key}:\\s*(.+)$`, "m").exec(front)?.[1]?.replace(/^(["'])(.*)\1$/, "$2").trim();
  return { name: field("name") || fallback, description: field("description") || /^description\s*=\s*"([^"\r\n]*)"/m.exec(text)?.[1] || "" };
}
async function scanInstalled({ installedRoot, baselineRoot, pluginRoots = [] } = {}) {
  const entries = [], notices = [], identities = new Set();
  const budget = { nodes: 0, bytes: 0 };
  const notice = (sourcePath, error) => { if (notices.length < 256) notices.push({ sourcePath, message: String(error.message || error).slice(0, 500) }); };
  const attempt = async (source, action) => { try { await action(); } catch (error) { notice(source, error); } };
  async function children(dir) {
    await safe(dir);
    const result = [], seen = new Set();
    for await (const item of await fs.opendir(dir)) {
      if (++budget.nodes > LIMITS.nodes) throw Error("Catalog traversal limit reached");
      const key = item.name.toLowerCase();
      if (seen.has(key)) throw Error("Case-colliding source paths");
      seen.add(key); result.push(item);
    }
    return result.sort((a,b) => a.name.localeCompare(b.name, "en"));
  }
  async function read(file) {
    await safe(file);
    const handle = await fs.open(file, nativeFs.constants.O_RDONLY | (nativeFs.constants.O_NOFOLLOW || 0));
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > LIMITS.fileBytes || budget.bytes + stat.size > LIMITS.totalBytes) throw Error("Catalog file or total size limit reached");
      // Read at most the limit even if a source grows after stat.
      const data = Buffer.alloc(Math.min(stat.size + 1, LIMITS.fileBytes + 1));
      let length = 0;
      while (length < data.length) { const value = await handle.read(data, length, data.length - length, null); if (!value.bytesRead) break; length += value.bytesRead; }
      if (length !== stat.size) throw Error("Catalog source changed while reading");
      const after = await handle.stat();
      await safe(file);
      const current = await fs.lstat(file);
      if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || current.ino !== stat.ino || current.dev !== stat.dev) throw Error("Catalog source changed while reading");
      budget.bytes += length; return data.subarray(0, length);
    } finally { await handle.close(); }
  }
  async function inventory(root, mappings) {
    const files = []; let size = 0;
    async function add(file, name) {
      relative(name);
      if (files.length >= LIMITS.files) throw Error("Catalog package file count limit reached");
      const data = await read(file); size += data.length;
      if (size > LIMITS.packageBytes) throw Error("Catalog package size limit reached");
      let content, encoding = "utf8";
      try { content = utf8.decode(data); if (content.includes("\0")) throw Error(); } catch { content = data.toString("base64"); encoding = "base64"; }
      files.push({ path: name, encoding, content });
    }
    async function walk(dir, prefix = "", depth = 0) {
      if (depth > LIMITS.depth) throw Error("Catalog package depth limit reached");
      for (const item of await children(dir)) {
        const name = prefix + item.name, full = path.join(dir, item.name);
        if (item.isSymbolicLink()) throw Error("Linked package contents rejected");
        if (item.isDirectory()) await walk(full, name + "/", depth + 1);
        else if (item.isFile()) await add(full, name);
        else throw Error("Special package files rejected");
      }
    }
    if (mappings) {
      const seen = new Set();
      for (const mapping of mappings) {
        const key = relative(mapping.path).toLowerCase();
        if (seen.has(key)) throw Error("Case-colliding package mappings"); seen.add(key);
        await add(path.join(root, relative(mapping.source)), mapping.path);
      }
    } else await walk(root);
    return files.sort((a,b) => a.path.localeCompare(b.path, "en"));
  }
  async function add({ root, main, kind, sourceKind, sourceLabel, name, versionLabel, mappings, identity }) {
    if (entries.length >= LIMITS.entries) throw Error("Catalog entry limit reached");
    const sourcePath = await safe(root), mainSource = mappings ? mappings.find(f => f.path === main)?.source : main;
    const mainPath = await safe(path.join(root, relative(mainSource)));
    identity = `${sourceKind}:${identity || sourcePath}:${kind}`;
    if (identities.has(identity)) return;
    const files = await inventory(sourcePath, mappings);
    const mainFile = files.find(f => f.path === main);
    if (!mainFile || mainFile.encoding !== "utf8") throw Error("Missing UTF-8 instruction entry point");
    const meta = metadata(mainFile.content, name || path.basename(root));
    const entry = { id: uuid(identity), catalogId: `catalog:${uuid(identity)}`, kind, name: meta.name, displayName: meta.name, description: meta.description, sharing: "local", files, sourceKind, sourceLabel, sourcePath, mainPath, readOnly: true, versionLabel: versionLabel || "Local installation" };
    entry.digest = packageDigest(entry);
    if (sourceKind === "installed") entry.installedDigest = entry.digest;
    entries.push(entry); identities.add(identity);
  }
  async function skills(dir, label) {
    for (const item of await children(dir)) {
      if (item.name === ".system" && item.isDirectory()) { await attempt(path.join(dir, item.name), () => skills(path.join(dir, item.name), "System skills")); continue; }
      if (!item.isDirectory()) { if (item.isSymbolicLink()) notice(path.join(dir,item.name), "Linked skill source skipped"); continue; }
      const root = path.join(dir, item.name);
      await attempt(root, () => add({ root, main: "SKILL.md", kind: "skill", sourceKind: "installed", sourceLabel: label }));
    }
  }
  if (installedRoot) await attempt(installedRoot, async () => {
    const root = path.resolve(installedRoot);
    await attempt(path.join(root, "skills"), () => skills(path.join(root, "skills"), "Installed skills"));
    await attempt(path.join(root, "agents"), async () => {
      for (const item of await children(path.join(root, "agents"))) if (item.isFile() && item.name.endsWith(".toml")) {
        await attempt(path.join(root,"agents",item.name), () => add({ root: path.join(root,"agents"), main: item.name, kind: "agent-role", name: item.name.slice(0,-5), sourceKind: "installed", sourceLabel: "Installed agent roles", identity: path.join(root,"agents",item.name), mappings: [{source:item.name,path:item.name}] }));
      }
    });
    await attempt(path.join(root,"AGENTS.md"), () => add({root, main:"AGENTS.md", kind:"context", name:"Global instructions", sourceKind:"installed", sourceLabel:"Installed global instructions", mappings:[{source:"AGENTS.md",path:"AGENTS.md"}]}));
  });
  if (baselineRoot) await attempt(baselineRoot, async () => {
    const root = path.resolve(baselineRoot), manifest = JSON.parse((await read(path.join(root,"azrael-environment.json"))).toString("utf8"));
    if (!Array.isArray(manifest.components) || manifest.components.length > LIMITS.entries) throw Error("Invalid baseline components");
    for (const component of manifest.components) await attempt(`${root}:${component.id}`, async () => {
      const kind = ({skill:"skill",agent:"agent-role",instructions:"context",context:"context",playbook:"playbook","task-profile":"task-profile"})[component.kind];
      if (!kind) return;
      if (!Array.isArray(component.files) || !component.files.length || component.files.length > LIMITS.files) throw Error("Invalid baseline mappings");
      const mainMapping = component.files.find(f => kind === "skill" ? /(?:^|\/)SKILL\.md$/.test(f.source) : kind === "agent-role" ? /\.toml$/.test(f.source) : /\.md$/i.test(f.source)) || component.files[0];
      const first = relative(mainMapping.source), prefix = kind === "skill" ? path.posix.dirname(first) + "/" : "";
      const mappings = component.files.map(f => ({source:relative(f.source), path:prefix && f.source.startsWith(prefix) ? f.source.slice(prefix.length) : path.posix.basename(f.source)}));
      await add({root, main:mappings.find(f => f.source === first).path, mappings, kind, name:component.title || component.id, sourceKind:"builtin", sourceLabel:"Azrael baseline", versionLabel:manifest.instructionVersion || "Baseline", identity:`${root}:${component.id}`});
    });
  });
  if (!Array.isArray(pluginRoots)) { notice("plugins", "Plugin roots must be an array"); pluginRoots = []; }
  for (const pluginRoot of pluginRoots.slice(0, 64)) await attempt(pluginRoot, async () => {
    const root = path.resolve(pluginRoot);
    async function walk(dir, depth) {
      const items = await children(dir);
      if (items.some(i => i.name === "SKILL.md" && i.isFile())) { await attempt(dir, () => add({root:dir, main:"SKILL.md", kind:"skill", sourceKind:"installed", sourceLabel:`Plugin: ${path.basename(root)}`})); return; }
      if (depth >= LIMITS.depth) return;
      for (const item of items) if (item.isDirectory()) await attempt(path.join(dir,item.name), () => walk(path.join(dir,item.name),depth+1));
      else if (item.isSymbolicLink()) notice(path.join(dir,item.name), "Linked plugin source skipped");
    }
    await walk(root,0);
  });
  return { entries, notices };
}
module.exports = { scanInstalled, LIMITS };
