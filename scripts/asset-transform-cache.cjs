"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const CACHE_SCHEMA = 3;
const sha = (value) => crypto.createHash("sha256").update(value).digest("hex");
const isSha = (value) => typeof value === "string" && /^[a-f\d]{64}$/.test(value);
const COUNT_FIELDS = ["edits", "namespaceEdits", "workspaceThreadListEdits", "recoveryEdits",
  "deferredTurnEdits", "deferredNativeTimingChecks", "compactionProgressEdits", "queueRefreshEdits",
  "queueRefreshNativeChecks", "providerPickerEdits", "maxReasoningEdits", "recentChatFilterEdits", "paginatedHistoryEdits", "immediateStopEdits", "queuedCompactionEdits", "queueConsumptionEdits", "uiInputDiagnosticsEdits", "accountSwitchQueueEdits",
  "urlSafetyTransportEdits", "imageFileOpenEdits", "missingImageEdits", "fileOpenMenuEdits", "localFileDropEdits", "composerDraftEdits", "providerContextEdits", "uiCleanupEdits", "imageSketchEdits", "petsCleanupEdits", "contentFontEdits"];

function createAssetTransformCache({ cacheDirectory, typescriptSha256, typescriptVersion,
  transformRules, getAssetTransformRules = () => transformRules, pruneUnused = false, retentionScope, statistics = { hits: 0, misses: 0 }, metrics }) {
  if (retentionScope !== undefined && (typeof retentionScope !== "string" || retentionScope.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(retentionScope))) {
    throw new Error("Invalid asset cache retention scope.");
  }
  const initializationStarted = performance.now();
  function measure(stage, action) {
    if (!metrics) return action();
    const started = performance.now();
    try { return action(); } finally {
      metrics[stage].elapsedMs += performance.now() - started;
      metrics[stage].count += 1;
    }
  }
  function readEntry(filename) {
    return measure("cacheRead", () => {
      const text = fs.readFileSync(filename, "utf8");
      if (metrics) metrics.cacheRead.bytes += Buffer.byteLength(text);
      return text;
    });
  }
  let directory;
  if (cacheDirectory) {
    if (!isSha(typescriptSha256)) throw new Error("Asset caching requires the exact TypeScript module SHA-256.");
    directory = path.resolve(cacheDirectory);
    const artifacts = path.resolve(__dirname, "../artifacts");
    const within = (root, target) => {
      const relative = path.relative(root, target);
      return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
    };
    if (!within(artifacts, directory)) throw new Error("Asset transform cache must be under artifacts.");
    let existingParent = directory;
    while (!fs.existsSync(existingParent)) existingParent = path.dirname(existingParent);
    const realArtifacts = fs.existsSync(artifacts) ? fs.realpathSync(artifacts) : artifacts;
    const resolvedDirectory = path.resolve(fs.realpathSync(existingParent), path.relative(existingParent, directory));
    if (!within(realArtifacts, resolvedDirectory)) throw new Error("Asset transform cache resolves outside artifacts.");
    fs.mkdirSync(directory, { recursive: true });
    if (!within(fs.realpathSync(artifacts), fs.realpathSync(directory))) {
      throw new Error("Asset transform cache resolves outside artifacts.");
    }
  }
  // Rule hashes belong to each asset key. Keeping them out of this fingerprint
  // preserves unrelated no-op hints when a path-scoped rule changes.
  const fingerprint = { schema: CACHE_SCHEMA, typescriptSha256, typescriptVersion };
  const fingerprintText = JSON.stringify(fingerprint);
  const legacyIndexPath = directory && path.join(directory, `noops-${sha(fingerprintText)}.json`);
  const indexPath = directory && (retentionScope ? path.join(directory, `scope-${retentionScope}.json`) : legacyIndexPath);
  function scopeRecords(strict = false) {
    const records = new Map();
    if (!directory) return records;
    for (const name of fs.readdirSync(directory)) {
      const match = /^scope-([a-z0-9]+(?:-[a-z0-9]+)*)\.json$/.exec(name);
      if (!match) continue;
      try {
        const filename = path.join(directory, name);
        if (!fs.lstatSync(filename).isFile()) throw new Error("Scope index must be a regular file.");
        const entry = JSON.parse(readEntry(filename));
        const payload = { fingerprint: entry.fingerprint, scope: entry.scope, keys: entry.keys, entries: entry.entries };
        if (entry.scope !== match[1] || !Array.isArray(entry.keys) || !entry.keys.every(isSha) ||
            !Array.isArray(entry.entries) || !entry.entries.every(isSha) ||
            !isSha(entry.payloadSha256) || entry.payloadSha256 !== sha(JSON.stringify(payload))) {
          throw new Error("Invalid scope index.");
        }
        records.set(entry.scope, entry);
      } catch (error) {
        if (strict) throw new Error(`Asset cache scope ${name}: ${error.message}`);
      }
    }
    return records;
  }
  function readNoops() {
    if (!indexPath) return new Set();
    try {
      const text = readEntry(legacyIndexPath);
      return measure("cacheValidation", () => {
      const index = JSON.parse(text);
      if (JSON.stringify(index.fingerprint) !== fingerprintText || !Array.isArray(index.keys) ||
          !index.keys.every(isSha) || !isSha(index.payloadSha256) ||
          index.payloadSha256 !== sha(JSON.stringify({ fingerprint: index.fingerprint, keys: index.keys }))) {
        return new Set();
      }
      return new Set(index.keys);
      });
    } catch {
      return new Set();
    }
  }
  function writeAtomic(filename, entry) {
    return measure("cacheWrite", () => {
    const temporary = `${filename}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      const text = JSON.stringify(entry);
      fs.writeFileSync(temporary, text);
      if (metrics) metrics.cacheWrite.bytes += Buffer.byteLength(text);
      const delays = [25, 50, 100, 200, 400];
      for (let attempt = 0; ; attempt++) {
        try { fs.renameSync(temporary, filename); break; }
        catch (error) {
          if (process.platform !== 'win32' || !['EPERM', 'EBUSY'].includes(error.code) || attempt === delays.length) throw error;
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delays[attempt]);
        }
      }
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
    });
  }
  const noops = readNoops();
  if (retentionScope) for (const entry of scopeRecords().values()) {
    if (JSON.stringify(entry.fingerprint) === fingerprintText) for (const key of entry.keys) noops.add(key);
  }
  const usedNoops = new Set(), usedEntries = new Set();
  const cleanup = { removed: 0, deferred: [] };
  function mutate(action) {
    // Serialize publishers and collectors. An uncertain/abandoned writer keeps
    // existing evidence intact and bypasses cache publication.
    const lock = path.join(directory, '.writer');
    let acquired = false;
    try {
      for (let cursor = directory; cursor; cursor = path.dirname(cursor)) {
        if (fs.lstatSync(cursor).isSymbolicLink()) throw Error(`Linked cache path: ${cursor}`);
        if (path.dirname(cursor) === cursor) break;
      }
      fs.mkdirSync(lock); acquired = true;
      action();
      return true;
    } catch (error) {
      cleanup.deferred.push(error.code === 'EEXIST' ? 'active or abandoned cache writer' : error.message);
      return false;
    } finally {
      if (acquired) try { fs.rmdirSync(lock); } catch (error) { cleanup.deferred.push(error.message); }
    }
  }
  let entriesByPath;
  function loadEntries() {
    if (!entriesByPath) {
      entriesByPath = new Map();
      for (const name of fs.readdirSync(directory)) {
        const match = /^([a-f0-9]{64})\.json$/.exec(name);
        if (!match) continue;
        try {
          const filename = path.join(directory, name);
          if (!fs.lstatSync(filename).isFile()) continue;
          const entry = JSON.parse(fs.readFileSync(filename, 'utf8'));
          if (typeof entry.key?.relativePath !== 'string' || sha(JSON.stringify(entry.key)) !== match[1]) continue;
          const names = entriesByPath.get(entry.key.relativePath) || new Set();
          names.add(name); entriesByPath.set(entry.key.relativePath, names);
        } catch (error) { cleanup.deferred.push(`${name}: ${error.message}`); }
      }
    }
  }
  function pruneReplaced(relativePath, currentDigest) {
    // Scoped collectors retire only their previously published membership.
    // An older unscoped caller must not discard another platform's payload.
    if (retentionScope || scopeRecords(true).size) return;
    loadEntries();
    const names = entriesByPath.get(relativePath) || new Set();
    for (const name of names) {
      const match = /^([a-f0-9]{64})\.json$/.exec(name);
      if (!match || match[1] === currentDigest) continue;
      const filename = path.join(directory, name);
      try {
        if (!fs.lstatSync(filename).isFile()) continue;
        const entry = JSON.parse(fs.readFileSync(filename, 'utf8'));
        if (entry.key?.relativePath !== relativePath || sha(JSON.stringify(entry.key)) !== match[1]) continue;
        fs.unlinkSync(filename); names.delete(name); cleanup.removed++;
      } catch (error) { cleanup.deferred.push(`${name}: ${error.message}`); }
    }
    if (fs.existsSync(path.join(directory, `${currentDigest}.json`))) names.add(`${currentDigest}.json`);
    entriesByPath.set(relativePath, names);
  }
  let dirtyNoops = false, failed = false;
  if (metrics) {
    metrics.cacheInitialization.elapsedMs += performance.now() - initializationStarted;
    metrics.cacheInitialization.count += 1;
  }
  return {
    cleanup,
    run(relativePath, source, transform, sourceContentSha256) {
      if (sourceContentSha256 === undefined) sourceContentSha256 = measure("sourceHash", () => sha(source));
      if (!directory) {
        statistics.misses += 1;
        return transform();
      }
      const lookupStarted = metrics && performance.now();
      const rulesSha256 = sha(JSON.stringify(Object.entries(getAssetTransformRules(relativePath, transformRules))
        .sort(([a], [b]) => a.localeCompare(b))));
      const key = { schema: CACHE_SCHEMA, sourceSha256: sourceContentSha256, relativePath,
        rulesSha256, typescriptSha256, typescriptVersion };
      const keyText = JSON.stringify(key);
      const keyDigest = sha(keyText);
      const noopHit = noops.has(keyDigest);
      const entryPath = path.join(directory, `${keyDigest}.json`);
      const entryExists = !noopHit && fs.existsSync(entryPath);
      if (metrics) {
        metrics.cacheLookup.elapsedMs += performance.now() - lookupStarted;
        metrics.cacheLookup.count += 1;
      }
      if (noopHit) {
        usedNoops.add(keyDigest);
        statistics.hits += 1;
        return { text: source, asset: null };
      }
      if (entryExists) {
        try {
          const text = readEntry(entryPath);
          const cached = measure("cacheValidation", () => {
          const entry = JSON.parse(text);
          const result = entry.result;
          const asset = result?.asset;
          let outputSha256;
          const validAsset = asset && asset.path === relativePath &&
            asset.sourceSha256 === sha(source) && asset.sha256 === (outputSha256 = sha(result.text)) &&
            COUNT_FIELDS.every((field) => Number.isSafeInteger(asset[field]) && asset[field] >= 0);
          if (JSON.stringify(entry.key) === keyText && typeof result?.text === "string" && validAsset &&
              isSha(entry.outputSha256) && entry.outputSha256 === outputSha256 &&
              isSha(entry.resultSha256) && entry.resultSha256 === sha(JSON.stringify(result))) {
            statistics.hits += 1;
            return result;
          }
          });
          if (cached) { usedEntries.add(keyDigest); return cached; }
        } catch {
          // Missing, truncated, malformed or corrupt entries rerun the pipeline.
        }
      }
      statistics.misses += 1;
      let result;
      try { result = transform(); } catch (error) { failed = true; throw error; }
      if (result.asset === null && result.text === source) {
        noops.add(keyDigest);
        usedNoops.add(keyDigest);
        dirtyNoops = true;
        if (pruneUnused && !retentionScope) loadEntries();
        // Most assets are no-ops. Persist early only when replacing a stored
        // transformed asset; ordinary hints are batched by flush.
        if (pruneUnused && !retentionScope && entriesByPath.get(relativePath)?.size && !mutate(() => {
          for (const key of readNoops()) noops.add(key);
          const payload = { fingerprint, keys: [...noops].sort() };
          writeAtomic(indexPath, { ...payload, payloadSha256: sha(JSON.stringify(payload)) });
          pruneReplaced(relativePath, keyDigest);
        })) failed = true;
      } else if (result.asset) {
        try {
          if (!mutate(() => {
            writeAtomic(entryPath, { key, outputSha256: sha(result.text),
              resultSha256: sha(JSON.stringify(result)), result });
            usedEntries.add(keyDigest);
            if (pruneUnused) pruneReplaced(relativePath, keyDigest);
          })) failed = true;
        } catch (error) { failed = true; throw error; }
      }
      return result;
    },
    flush() {
      return measure("cacheFlush", () => {
      if (!indexPath || failed || (!retentionScope && !pruneUnused && !dirtyNoops)) return;
      mutate(() => {
      const scopes = scopeRecords(true);
      if (retentionScope) {
        const previous = scopes.get(retentionScope);
        const keys = [...usedNoops].sort(), entries = [...usedEntries].sort();
        const retained = new Set(entries);
        for (const [scope, entry] of scopes) if (scope !== retentionScope) {
          for (const key of entry.entries) retained.add(key);
        }
        const retired = pruneUnused ? (previous?.entries || []).filter(key => !retained.has(key)) : [];
        // Publish ownership of pending removals too. A failed unlink or interrupted
        // collector can then retry without orphaning its previous payloads.
        const pending = { fingerprint, scope: retentionScope, keys,
          entries: [...new Set([...entries, ...(pruneUnused ? retired : previous?.entries || [])])].sort() };
        writeAtomic(indexPath, { ...pending, payloadSha256: sha(JSON.stringify(pending)) });
        dirtyNoops = false;
        if (retired.length) {
          for (const key of retired) {
            const filename = path.join(directory, `${key}.json`);
            if (fs.existsSync(filename) && fs.lstatSync(filename).isFile()) {
              fs.unlinkSync(filename); cleanup.removed++;
            } else if (fs.existsSync(filename)) {
              throw new Error(`Retired asset cache entry is not a regular file: ${filename}`);
            }
          }
          const payload = { fingerprint, scope: retentionScope, keys, entries };
          writeAtomic(indexPath, { ...payload, payloadSha256: sha(JSON.stringify(payload)) });
        }
        return;
      }
      // Completed pruning owns its visited set; ordinary writers merge valid hints.
      if (!pruneUnused) for (const key of readNoops()) noops.add(key);
      const keys = [...(pruneUnused ? usedNoops : noops)].sort();
      const payload = { fingerprint, keys };
      writeAtomic(indexPath, { ...payload, payloadSha256: sha(JSON.stringify(payload)) });
      dirtyNoops = false;
      // Commit the current index before deleting obsolete cache files. Never follow
      // links or remove unknown names, temporary files or directories.
      if (pruneUnused) {
        const retained = new Set([...scopes.values()].flatMap(entry => entry.entries));
        for (const name of fs.readdirSync(directory)) {
          const entry = /^([a-f0-9]{64})\.json$/.exec(name);
          const oldIndex = /^noops-[a-f0-9]{64}\.json$/.test(name);
          if (!(entry || oldIndex) || (entry && (usedEntries.has(entry[1]) || retained.has(entry[1]))) ||
              path.join(directory, name) === indexPath) continue;
          const filename = path.join(directory, name);
          if (fs.lstatSync(filename).isFile()) { fs.unlinkSync(filename); cleanup.removed++; }
        }
      }
      });
      });
    },
  };
}
module.exports = { CACHE_SCHEMA, createAssetTransformCache };
