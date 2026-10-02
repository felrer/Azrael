"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const CACHE_SCHEMA = 2;
const sha = (value) => crypto.createHash("sha256").update(value).digest("hex");
const isSha = (value) => typeof value === "string" && /^[a-f\d]{64}$/.test(value);
const COUNT_FIELDS = ["edits", "namespaceEdits", "workspaceThreadListEdits", "recoveryEdits",
  "deferredTurnEdits", "deferredNativeTimingChecks", "compactionProgressEdits", "queueRefreshEdits",
  "queueRefreshNativeChecks", "providerPickerEdits", "paginatedHistoryEdits", "immediateStopEdits", "queuedCompactionEdits", "queueConsumptionEdits",
  "urlSafetyTransportEdits", "imageFileOpenEdits", "fileOpenMenuEdits", "localFileDropEdits"];

function createAssetTransformCache({ cacheDirectory, typescriptSha256, typescriptVersion,
  transformRules, statistics = { hits: 0, misses: 0 }, metrics }) {
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
  const rulesSha256 = sha(JSON.stringify(Object.entries(transformRules).sort(([a], [b]) => a.localeCompare(b))));
  const fingerprint = { schema: CACHE_SCHEMA, rulesSha256, typescriptSha256, typescriptVersion };
  const fingerprintText = JSON.stringify(fingerprint);
  const indexPath = directory && path.join(directory, `noops-${sha(fingerprintText)}.json`);
  function readNoops() {
    if (!indexPath) return new Set();
    try {
      const text = readEntry(indexPath);
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
      fs.renameSync(temporary, filename);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
    });
  }
  const noops = readNoops();
  let dirtyNoops = false;
  if (metrics) {
    metrics.cacheInitialization.elapsedMs += performance.now() - initializationStarted;
    metrics.cacheInitialization.count += 1;
  }
  return {
    run(relativePath, source, transform, sourceContentSha256) {
      if (sourceContentSha256 === undefined) sourceContentSha256 = measure("sourceHash", () => sha(source));
      if (!directory) {
        statistics.misses += 1;
        return transform();
      }
      const lookupStarted = metrics && performance.now();
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
          if (cached) return cached;
        } catch {
          // Missing, truncated, malformed or corrupt entries rerun the pipeline.
        }
      }
      statistics.misses += 1;
      const result = transform();
      if (result.asset === null && result.text === source) {
        noops.add(keyDigest);
        dirtyNoops = true;
      } else if (result.asset) {
        writeAtomic(entryPath, { key, outputSha256: sha(result.text),
          resultSha256: sha(JSON.stringify(result)), result });
      }
      return result;
    },
    flush() {
      return measure("cacheFlush", () => {
      if (!indexPath || !dirtyNoops) return;
      // Merge only a validated index; concurrent writers may lose hints, never results.
      for (const key of readNoops()) noops.add(key);
      const keys = [...noops].sort();
      const payload = { fingerprint, keys };
      writeAtomic(indexPath, { ...payload, payloadSha256: sha(JSON.stringify(payload)) });
      dirtyNoops = false;
      });
    },
  };
}
module.exports = { CACHE_SCHEMA, createAssetTransformCache };
