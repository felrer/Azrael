"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { canonicalDigest: hash, verifyPlan } = require("./instruction-library.cjs");
const copy = value => JSON.parse(JSON.stringify(value));
function freeze(value) { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function seal(value) { return freeze({ ...copy(value), digest: hash(value) }); }
function relative(value) {
  if (typeof value !== "string" || !value || value.length > 240 || value.includes("\\") || value.startsWith("/")) throw Error("Unsafe migration path");
  for (const part of value.split("/")) if (!part || part === "." || part === ".." || /[<>:"|?*\x00-\x1f]/.test(part) || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)) throw Error("Unsafe migration path");
  return value;
}
async function stat(file) { try { return await fs.lstat(file); } catch (e) { if (e.code === "ENOENT") return null; throw e; } }
async function safe(file) {
  let current = path.parse(path.resolve(file)).root;
  for (const segment of path.resolve(file).slice(current.length).split(path.sep).filter(Boolean)) {
    try { if ((await fs.readdir(current)).some(n => n.toLowerCase() === segment.toLowerCase() && n !== segment)) throw Error("Case alias path rejected"); } catch (e) { if (e.code !== "ENOENT") throw e; }
    current = path.join(current, segment);
    if ((await stat(current))?.isSymbolicLink()) throw Error("Linked path rejected");
  }
}
const identity = s => ({ dev: s.dev, ino: s.ino, birthtimeMs: s.birthtimeMs });
const data = f => Buffer.from(f.content, f.encoding === "base64" ? "base64" : "utf8");
function files(value) {
  if (!Array.isArray(value) || value.length > 512) throw Error("Migration inventory file limit");
  const names = new Map(), leaves = new Set(); let total = 0;
  const result = value.map(f => {
    const name = relative(f.path), parts = name.split("/");
    if (parts.length > 13) throw Error("Migration inventory depth limit");
    for (let i = 1; i <= parts.length; i++) {
      const prefix = parts.slice(0, i).join("/"), key = prefix.toLowerCase();
      if (names.has(key) && names.get(key) !== prefix) throw Error("Case-colliding migration paths");
      names.set(key, prefix);
    }
    const key = name.toLowerCase();
    if (leaves.has(key) || [...leaves].some(n => n.startsWith(key + "/") || key.startsWith(n + "/"))) throw Error("Colliding migration files");
    leaves.add(key);
    if (!["utf8", "base64"].includes(f.encoding) || typeof f.content !== "string" || f.encoding === "base64" && data(f).toString("base64") !== f.content) throw Error("Invalid migration encoding");
    const bytes = data(f); total += bytes.length;
    if (bytes.length > 8 * 1024 * 1024 || total > 32 * 1024 * 1024) throw Error("Migration inventory size limit");
    // Normalize representation so comparisons reflect exact bytes.
    return { path: name, encoding: "base64", content: bytes.toString("base64") };
  });
  return result.sort((a,b) => a.path.localeCompare(b.path, "en"));
}
async function inventory(root) {
  await safe(root); if (!(await stat(root))?.isDirectory()) throw Error("Regular package directory required");
  const result = []; let nodes = 0, total = 0;
  async function walk(dir, prefix = "", depth = 0) {
    if (depth > 12) throw Error("Migration inventory depth limit");
    const children = await fs.readdir(dir); const seen = new Set();
    for (const name of children.sort()) {
      if (++nodes > 20000) throw Error("Migration inventory node limit");
      if (seen.has(name.toLowerCase())) throw Error("Case-colliding migration paths"); seen.add(name.toLowerCase());
      const rel = relative(prefix + name), full = path.join(dir, name); await safe(full);
      const before = await fs.lstat(full);
      if (before.isDirectory()) await walk(full, rel + "/", depth + 1);
      else if (before.isFile()) {
        if (before.size > 8 * 1024 * 1024 || (total += before.size) > 32 * 1024 * 1024 || result.length >= 512) throw Error("Migration inventory size limit");
        const handle = await fs.open(full, "r"); let bytes;
        try {
          const opened = await handle.stat();
          if (!opened.isFile() || hash(identity(before)) !== hash(identity(opened)) || before.size !== opened.size) throw Error("Migration inventory changed before reading");
          const buffer = Buffer.alloc(before.size + 1); let length = 0;
          while (length < buffer.length) { const next = await handle.read(buffer, length, buffer.length - length, null); if (!next.bytesRead) break; length += next.bytesRead; }
          bytes = buffer.subarray(0, length);
        } finally { await handle.close(); }
        await safe(full); const after = await fs.lstat(full);
        if (hash(identity(before)) !== hash(identity(after)) || before.size !== after.size || before.mtimeMs !== after.mtimeMs || bytes.length !== after.size) throw Error("Migration inventory changed while reading");
        result.push({ path: rel, encoding: "base64", content: bytes.toString("base64") });
      } else throw Error("Linked or special package contents rejected");
    }
  }
  await walk(root); return files(result);
}
async function read(file) { await safe(file); const s = await stat(file); if (!s) return null; if (!s.isFile() || s.size > 96 * 1024 * 1024) throw Error("Invalid migration control file"); return fs.readFile(file); }
async function atomic(file, value) {
  await safe(file); await fs.mkdir(path.dirname(file), { recursive: true }); await safe(file);
  const temp = file + "." + crypto.randomUUID() + ".tmp";
  await fs.writeFile(temp, JSON.stringify(value), { flag: "wx" });
  try { await fs.rename(temp, file); } finally { if (await stat(temp)) await fs.unlink(temp); }
}

class InstructionMigration {
  constructor({ installedRoot, libraryRoot }) {
    if (![installedRoot, libraryRoot].every(p => typeof p === "string" && path.isAbsolute(p))) throw Error("Absolute migration roots required");
    this.installedRoot = path.resolve(installedRoot); this.libraryRoot = path.resolve(libraryRoot);
    const a = this.installedRoot.toLowerCase(), b = this.libraryRoot.toLowerCase();
    if (a === b || a.startsWith(b + path.sep) || b.startsWith(a + path.sep) || [a,b].some(p => p === path.parse(p).root)) throw Error("Separate protected migration roots required");
  }
  control(name) { return path.join(this.installedRoot, "azrael", "instructions", name); }
  async _link(targetRoot) {
    await safe(path.dirname(targetRoot));
    const leaf = path.basename(targetRoot);
    if ((await fs.readdir(path.dirname(targetRoot))).some(n => n.toLowerCase() === leaf.toLowerCase() && n !== leaf)) throw Error("Case alias link rejected");
    const s = await stat(targetRoot); if (!s?.isSymbolicLink()) throw Error("Only a top-level skill directory link is eligible");
    const text = await fs.readlink(targetRoot), realTarget = await fs.realpath(targetRoot);
    await safe(realTarget); const target = await stat(realTarget);
    if (!target?.isDirectory()) throw Error("Link must target a regular directory");
    const legacyFiles = await inventory(realTarget);
    return { identity: identity(s), text, realTarget, targetIdentity: identity(target), legacyFiles, legacyDigest: hash(legacyFiles) };
  }
  async plan(entry) {
    if (entry?.kind !== "skill" || typeof entry.id !== "string" || !/^[a-f0-9]{64}$/.test(entry.digest || "")) throw Error("Pinned skill resource required");
    const main = relative(entry.installedRelativePath);
    if (!/^skills\/[a-z0-9][a-z0-9_-]{0,63}\/SKILL\.md$/.test(main)) throw Error("Only home top-level skills can migrate");
    const canonicalFiles = files(entry.files);
    if (!canonicalFiles.some(f => f.path === "SKILL.md")) throw Error("Missing canonical SKILL.md");
    const resource = { id: entry.id, digest: entry.digest, kind: "skill", files: canonicalFiles, installedRelativePath: main };
    // The host must re-resolve canonical catalog identity immediately before apply.
    // Catalog sourcePath can be a release root with mappings, not a skill folder.
    const targetRoot = path.join(this.installedRoot, path.posix.dirname(main));
    const result = { schemaVersion: 1, installedRoot: this.installedRoot, libraryRoot: this.libraryRoot, targetRoot, resource, conflicts: [], differences: [], legacyFiles: [], legacyDigest: null, link: null };
    try {
      result.link = await this._link(targetRoot); result.legacyFiles = result.link.legacyFiles; result.legacyDigest = result.link.legacyDigest;
      const old = new Map(result.legacyFiles.map(f => [f.path, f.content])), next = new Map(canonicalFiles.map(f => [f.path, f.content]));
      result.differences = [...new Set([...old.keys(), ...next.keys()])].sort().filter(p => old.get(p) !== next.get(p)).map(p => ({ path: p, action: !next.has(p) ? "remove" : !old.has(p) ? "add" : "replace" }));
      if (await read(this.control("migration-journal.json"))) result.conflicts.push("Interrupted migration requires recovery");
    } catch (e) { result.conflicts.push(e.message); }
    return seal(result);
  }
  _verify(plan) {
    verifyPlan(plan);
    if (plan.schemaVersion !== 1 || plan.installedRoot !== this.installedRoot || plan.libraryRoot !== this.libraryRoot || plan.resource.kind !== "skill" || !/^skills\/[a-z0-9][a-z0-9_-]{0,63}\/SKILL\.md$/.test(plan.resource.installedRelativePath) || plan.targetRoot !== path.join(this.installedRoot, path.posix.dirname(plan.resource.installedRelativePath))) throw Error("Invalid migration plan boundary");
    files(plan.resource.files); files(plan.legacyFiles);
  }
  async _writer(action, recovery = false) {
    const lock = this.control("writer.lock"); await safe(lock); await fs.mkdir(path.dirname(lock), { recursive: true }); await safe(lock);
    if (recovery) {
      const old = await read(lock);
      if (old) {
        const owner = JSON.parse(old);
        if (owner.owner !== "instruction-migration" || owner.libraryRoot !== this.libraryRoot || !Number.isSafeInteger(owner.pid) || owner.pid <= 0) throw Error("Unknown instruction writer lock is protected");
        if (!this.retainedLock?.equals(old)) {
          try { process.kill(owner.pid, 0); throw Error("Instruction writer is still active"); } catch (e) { if (e.code !== "ESRCH") throw e; }
        }
        if (!(await read(lock))?.equals(old)) throw Error("Writer lock changed during recovery");
        await fs.unlink(lock);
      }
    }
    const handle = await fs.open(lock, "wx"); let release = true;
    const lockBytes = Buffer.from(JSON.stringify({ owner: "instruction-migration", libraryRoot: this.libraryRoot, pid: process.pid, nonce: crypto.randomUUID() }));
    try {
      await handle.writeFile(lockBytes);
      for (const file of [this.control("journal.json"), path.join(this.libraryRoot, "journal.json"), path.join(this.libraryRoot, "lock.json")]) if (await read(file)) throw Error("Other instruction recovery or mutation is pending");
      return await action();
    } finally {
      release = !(await read(this.control("migration-journal.json")));
      await handle.close(); if (release) { await fs.unlink(lock); this.retainedLock = null; } else this.retainedLock = lockBytes;
    }
  }
  async apply(plan, { preservedDigest } = {}) {
    this._verify(plan);
    if (plan.conflicts.length) throw Error("Migration plan has conflicts: " + plan.conflicts.join("; "));
    if (plan.differences.length && preservedDigest !== plan.legacyDigest) throw Error("Differing legacy content must first be preserved with its exact inventory digest");
    return this._writer(async () => {
      if (await read(this.control("migration-journal.json"))) throw Error("Interrupted migration requires recovery");
      const fresh = await this.plan({ ...plan.resource, files: plan.resource.files });
      if (fresh.digest !== plan.digest) throw Error("Migration plan is stale; source or link changed");
      const operationId = crypto.randomUUID(), stage = this.control(`migration-${operationId}`);
      const journal = seal({ schemaVersion: 1, operationId, plan, stage, receiptPath: this.control(`migration-receipt-${operationId}.json`) });
      await atomic(this.control("migration-journal.json"), journal);
      try {
        await safe(stage); await fs.mkdir(stage);
        for (const file of plan.resource.files) { const destination = path.join(stage, relative(file.path)); await safe(destination); await fs.mkdir(path.dirname(destination), { recursive: true }); await fs.writeFile(destination, data(file), { flag: "wx" }); }
        if (hash(await inventory(stage)) !== hash(plan.resource.files)) throw Error("Staged canonical bytes differ");
        if (hash(await this._link(plan.targetRoot)) !== hash(plan.link)) throw Error("Link or legacy source changed before replacement");
        await fs.unlink(plan.targetRoot); // Removes the link itself, including Windows junctions.
        await fs.rename(stage, plan.targetRoot);
        if (hash(await inventory(plan.targetRoot)) !== hash(plan.resource.files)) throw Error("Installed migration bytes differ");
        const receipt = await this._receipt(journal, "applied");
        await fs.unlink(this.control("migration-journal.json"));
        return receipt;
      } catch (e) {
        try { await this._rollback(journal); } catch (failure) { throw Error(`${e.message}; migration recovery required: ${failure.message}`, { cause: e }); }
        throw e;
      }
    });
  }
  async _receipt(journal, outcome) {
    const receipt = seal({ schemaVersion: 1, operationId: journal.operationId, outcome, planDigest: journal.plan.digest, targetRoot: journal.plan.targetRoot, resource: { id: journal.plan.resource.id, digest: journal.plan.resource.digest }, originalLink: journal.plan.link, preservedStage: (await stat(journal.stage)) ? journal.stage : null, receiptPath: journal.receiptPath });
    await atomic(journal.receiptPath, receipt); return receipt;
  }
  async _rollback(journal) {
    verifyPlan(journal); this._verify(journal.plan);
    if (journal.schemaVersion !== 1 || !/^[a-f0-9-]{36}$/.test(journal.operationId) || journal.stage !== this.control(`migration-${journal.operationId}`) || journal.receiptPath !== this.control(`migration-receipt-${journal.operationId}.json`)) throw Error("Invalid migration recovery boundary");
    const { plan } = journal; await safe(path.dirname(plan.targetRoot));
    const current = await stat(plan.targetRoot);
    if (current?.isSymbolicLink()) {
      // Legacy files may legitimately change after a failed operation. Never edit them.
      const knownIdentity = [plan.link.identity, journal.restoredLinkIdentity].filter(Boolean).some(expected => hash(identity(current)) === hash(expected));
      if (!knownIdentity || await fs.readlink(plan.targetRoot) !== plan.link.text || await fs.realpath(plan.targetRoot) !== plan.link.realTarget) throw Error("Unknown replacement link is protected");
    } else {
      if (current) {
        if (!current.isDirectory() || hash(await inventory(plan.targetRoot)) !== hash(plan.resource.files) || await stat(journal.stage)) throw Error("Unknown modified migration destination is protected");
        await fs.rename(plan.targetRoot, journal.stage);
      }
      await fs.symlink(plan.link.text, plan.targetRoot, process.platform === "win32" ? "junction" : "dir");
      const restored = await stat(plan.targetRoot);
      if (!restored?.isSymbolicLink() || await fs.readlink(plan.targetRoot) !== plan.link.text || await fs.realpath(plan.targetRoot) !== plan.link.realTarget) throw Error("Restored migration link changed before recording recovery identity");
      // Commit this new identity before fallible receipt/cleanup operations. A crash
      // before this record stays protected rather than adopting an unknown link.
      const { digest: _digest, ...body } = journal;
      journal = seal({ ...body, restoredLinkIdentity: identity(restored) });
      await atomic(this.control("migration-journal.json"), journal);
    }
    const receipt = await this._receipt(journal, "rolled-back");
    await fs.unlink(this.control("migration-journal.json")); return receipt;
  }
  async recover() {
    return this._writer(async () => {
      const value = await read(this.control("migration-journal.json"));
      if (!value) return { recovered: false };
      return { recovered: true, receipt: await this._rollback(JSON.parse(value)) };
    }, true);
  }
}

module.exports = { InstructionMigration };
