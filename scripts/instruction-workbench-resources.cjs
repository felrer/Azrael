"use strict";
// Read-only metadata. Never start MCP servers or return their configuration/credentials.
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const toml = require(require.resolve("smol-toml", { paths: [__dirname, path.join(__dirname, "../extensions/azrael-ex")] }));
const core = Object.freeze({ id: "azrael-core", name: "Azrael 기본 지침", text: "You are Azrael, the coding assistant in the user's shared workspace." });
const requiredMcp = new Set(["node_repl", "azrael_window"]);
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
async function checkedFile(filename, maximum = 2 * 1024 * 1024) {
  let current = path.parse(filename).root;
  for (const part of filename.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if ((await fs.lstat(current)).isSymbolicLink()) throw Error("Linked resource path");
  }
  const stat = await fs.stat(filename);
  if (!stat.isFile() || stat.size > maximum) throw Error("Resource file size or type");
  const bytes = await fs.readFile(filename);
  if (bytes.length > maximum) throw Error("Resource file size");
  return bytes;
}
function skillMetadata(bytes, directory) {
  const body = bytes.toString("utf8");
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(body)?.[1] || "";
  const value = key => {
    const raw = new RegExp("^" + key + ":\\s*(.+)$", "m").exec(front)?.[1]?.trim();
    if (!raw) return "";
    return raw.replace(/^(["'])(.*)\1$/, "$2").slice(0, 2000);
  };
  const name = value("name");
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(name)) throw Error("Invalid skill identity");
  return { id: "host:skill:" + hash(directory).slice(0, 24), kind: "skill", name, description: value("description"), source: "Azrael 설치 스킬", available: true, external: true };
}
async function installedSkills(home) {
  const root = path.join(home, "skills"), result = [];
  async function visit(directory, system = false) {
    let entries;
    try { entries = await fs.readdir(directory, { withFileTypes: true }); }
    catch (error) { if (error.code === "ENOENT") return; throw error; }
    if (entries.length > 5000) throw Error("Skill inventory limit");
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const folder = path.join(directory, entry.name);
      if (entry.name === ".system" && !system) { await visit(folder, true); continue; }
      if (entry.name.startsWith(".")) continue;
      try { result.push({ ...skillMetadata(await checkedFile(path.join(folder, "SKILL.md")), folder), directory: folder }); }
      catch (error) { if (error.code !== "ENOENT") result.push({ id: "host:skill:" + hash(folder).slice(0, 24), kind: "skill", name: entry.name, source: "Azrael 설치 스킬", available: false, error: "스킬 정보를 읽을 수 없습니다.", external: true }); }
    }
  }
  await visit(root);
  return result;
}
async function readComposerResources({ codexHome }) {
  if (!path.isAbsolute(codexHome || "")) throw Error("Azrael resource home required");
  const resources = [], errors = [];
  try { for (const { directory, ...metadata } of await installedSkills(codexHome)) resources.push(metadata); }
  catch { errors.push({ message: "설치된 스킬 목록을 읽을 수 없습니다." }); }
  try {
    const config = toml.parse((await checkedFile(path.join(codexHome, "config.toml"))).toString("utf8"));
    const skillRules = Array.isArray(config.skills?.config) ? config.skills.config : [];
    for (const resource of resources.filter(r => r.kind === "skill")) resource.defaultEnabled = !skillRules.some(rule => {
      if (rule?.enabled !== false) return false;
      if (rule.name === resource.name) return true;
      if (typeof rule.path !== "string" || !path.isAbsolute(rule.path)) return false;
      const directory = path.basename(rule.path).toLowerCase() === "skill.md" ? path.dirname(rule.path) : rule.path;
      return resource.id === "host:skill:" + hash(directory).slice(0, 24);
    });
    const servers = config.mcp_servers || {};
    for (const [name, server] of Object.entries(servers)) {
      if (requiredMcp.has(name) || !/^[a-zA-Z0-9_-]{1,200}$/.test(name) || !server || typeof server !== "object") continue;
      const configured = typeof server.command === "string" && !!server.command || typeof server.url === "string" && !!server.url;
      resources.push({ id: "host:mcp:" + name, kind: "mcp", name, serverId: name, source: "Azrael MCP 설정", available: !!configured, defaultEnabled: server.enabled !== false,
        description: "등록된 MCP 연결 · 실제 연결 상태는 실행 시 확인", ...(configured ? {} : { error: "MCP 연결 설정이 올바르지 않습니다." }) });
    }
  } catch (error) { if (error.code !== "ENOENT") errors.push({ message: "MCP 설정 목록을 읽을 수 없습니다." }); }
  return { core: { ...core }, resources, errors };
}
async function resolveComposerResource(id, { codexHome }) {
  const metadata = (await installedSkills(codexHome)).find(row => row.id === id);
  if (!metadata?.directory || !metadata.available) throw Error("선택한 스킬을 읽을 수 없습니다.");
  const files = []; let bytes = 0;
  async function walk(directory, prefix = "") {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if ([".git", "node_modules", "__pycache__"].includes(entry.name)) continue;
      const absolute = path.join(directory, entry.name), relative = prefix + entry.name;
      if (entry.isSymbolicLink()) throw Error("스킬에 링크된 파일은 포함할 수 없습니다.");
      if (entry.isDirectory()) await walk(absolute, relative + "/");
      else {
        const data = await checkedFile(absolute, 8 * 1024 * 1024);
        bytes += data.length;
        if (files.length >= 5000 || bytes > 32 * 1024 * 1024) throw Error("스킬 자료 크기 제한을 초과했습니다.");
        const utf8 = data.toString("utf8"), isText = !data.includes(0) && Buffer.from(utf8).equals(data);
        files.push({ path: relative, encoding: isText ? "utf8" : "base64", content: isText ? utf8 : data.toString("base64") });
      }
    }
  }
  await walk(metadata.directory);
  const { directory, ...safe } = metadata;
  return { ...safe, digest: hash(JSON.stringify(files)), component: { id: metadata.id, name: metadata.name, kind: "skill", files } };
}
module.exports = { readComposerResources, resolveComposerResource };
