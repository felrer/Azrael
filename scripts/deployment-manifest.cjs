"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { constants } = require("node:buffer");

const INDEX_BYTES = 16 * 1024 * 1024;
const CHUNK_BYTES = 8 * 1024 * 1024;
const FORMAT = "deployment-details-v1";
const digest = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const chunkName = index => "part-" + String(index).padStart(8, "0") + ".bin";
const identity = stat => [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function physical(file) {
  if (typeof file !== "string" || !path.isAbsolute(file) || file.includes("\0") || file.split(/[\\/]/).includes("..")) throw Error("Absolute deployment evidence path without traversal required");
  const absolute = path.resolve(file);
  let current = path.parse(absolute).root;
  const parts = absolute.slice(current.length).split(path.sep).filter(Boolean);
  for (let index = 0; index < parts.length; index++) {
    current = path.join(current, parts[index]);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || (index < parts.length - 1 && !stat.isDirectory())) throw Error("Linked or non-directory deployment evidence path");
  }
  return absolute;
}

function readPlain(file, expectedBytes) {
  physical(file);
  const before = fs.lstatSync(file);
  if (!before.isFile() || before.nlink !== 1 || (expectedBytes !== undefined && before.size !== expectedBytes)) throw Error("Deployment detail file type, link or byte length changed");
  const fd = fs.openSync(file, "r");
  try {
    if (!same(identity(before), identity(fs.fstatSync(fd)))) throw Error("Deployment evidence identity changed while opening");
    const bytes = fs.readFileSync(fd);
    if (!same(identity(before), identity(fs.fstatSync(fd))) || !same(identity(before), identity(fs.lstatSync(physical(file)))) || bytes.length !== before.size) throw Error("Deployment evidence changed while reading");
    return bytes;
  } finally { fs.closeSync(fd); }
}

function serializeDeploymentManifest(manifest) {
  const bytes = Buffer.from(JSON.stringify(manifest) + "\n");
  if (bytes.length > INDEX_BYTES) throw Error(`Deployment manifest evidence exceeds 16 MiB registry bound: ${bytes.length} bytes`);
  return bytes;
}

function destinations(reportPath, allowMissingParents = false) {
  if (typeof reportPath !== "string" || !path.isAbsolute(reportPath) || reportPath.includes("\0") || reportPath.split(/[\\/]/).includes("..")) throw Error("Absolute deployment report path required");
  const report = path.resolve(reportPath), parent = path.dirname(report);
  let existing = parent;
  while (allowMissingParents) {
    try { fs.lstatSync(existing); break; }
    catch (error) { if (error.code !== "ENOENT") throw error; existing = path.dirname(existing); }
  }
  physical(existing);
  if (!fs.lstatSync(existing).isDirectory()) throw Error("Physical deployment reports directory required");
  const directory = path.basename(report) + ".details";
  for (const file of [report, path.join(parent, directory)]) {
    try { fs.lstatSync(file); } catch (error) { if (error.code === "ENOENT") continue; throw error; }
    throw Error("Fresh deployment report and detail destinations required");
  }
  return { report, directory, detailsPath: path.join(parent, directory) };
}

function summary(manifest) {
  return {
    sourceCommit: manifest.sourceCommit ?? null,
    projectSha256: manifest.projectSha256 ?? null,
    projectFileCount: manifest.project?.fileCount ?? null,
    projectBytes: manifest.project?.bytes ?? null,
    immutableSha256: manifest.immutableInventory?.sha256 ?? null,
  };
}

function preflightDeploymentManifest(reportPath, selection) {
  const target = destinations(reportPath, true);
  const selectedFileCount = selection.fileCount;
  const selectedInventoryBytes = Buffer.byteLength(JSON.stringify(selection.inventory));
  if (!Number.isSafeInteger(selectedFileCount) || selectedFileCount < 0) throw Error("Invalid selected deployment file count");
  // The index has fixed-size descriptors, even when the detailed inventory grows.
  // Validate its path/encoding budget before materializing any selected source.
  serializeDeploymentManifest({ schema: 3, storageFormat: FORMAT,
    summary: { sourceCommit: selection.commit, projectSha256: "0".repeat(64), projectFileCount: selectedFileCount, projectBytes: Number.MAX_SAFE_INTEGER, immutableSha256: "0".repeat(64) },
    details: { directory: target.directory, chunkBytes: CHUNK_BYTES, chunkCount: Number.MAX_SAFE_INTEGER, bytes: Number.MAX_SAFE_INTEGER, sha256: "0".repeat(64) } });
  return { selectedFileCount, selectedInventoryBytes, chunkBytes: CHUNK_BYTES };
}

function writeDeploymentManifest(reportPath, manifest) {
  const target = destinations(reportPath);
  if (manifest.schema !== 1) throw Error("New deployment detail writer requires logical schema 1");
  const bytes = Buffer.from(JSON.stringify(manifest) + "\n");
  const index = { schema: 3, storageFormat: FORMAT, summary: summary(manifest),
    details: { directory: target.directory, chunkBytes: CHUNK_BYTES, chunkCount: Math.ceil(bytes.length / CHUNK_BYTES), bytes: bytes.length, sha256: digest(bytes) } };
  const indexBytes = serializeDeploymentManifest(index);
  fs.mkdirSync(target.detailsPath);
  for (let offset = 0, part = 0; offset < bytes.length; offset += CHUNK_BYTES, part++) {
    physical(target.detailsPath);
    fs.writeFileSync(path.join(target.detailsPath, chunkName(part)), bytes.subarray(offset, offset + CHUNK_BYTES), { flag: "wx" });
  }
  // Publish only after all detail files exist. On failure the planned report owner
  // retains the partial directory; no unowned temporary or backup file is created.
  physical(path.dirname(target.report));
  if (!fs.lstatSync(physical(target.detailsPath)).isDirectory()) throw Error("Deployment detail directory changed");
  fs.writeFileSync(target.report, indexBytes, { flag: "wx" });
  readDeploymentManifest(target.report, digest(indexBytes));
  return index;
}

function readDeploymentManifest(reportPath, expectedSha256) {
  const report = physical(reportPath), indexBytes = readPlain(report);
  if (expectedSha256 !== undefined && digest(indexBytes) !== expectedSha256) throw Error("Deployment input manifest changed");
  const index = JSON.parse(indexBytes);
  if (index.schema !== 3) {
    if (![1, 2].includes(index.schema)) throw Error("Unsupported deployment input manifest");
    return index;
  }
  const detail = index.details;
  if (indexBytes.length > INDEX_BYTES || index.storageFormat !== FORMAT || !detail || detail.directory !== path.basename(report) + ".details" || detail.chunkBytes !== CHUNK_BYTES ||
      !Number.isSafeInteger(detail.bytes) || detail.bytes < 1 || detail.bytes > constants.MAX_LENGTH ||
      !Number.isSafeInteger(detail.chunkCount) || detail.chunkCount !== Math.ceil(detail.bytes / CHUNK_BYTES) || !/^[a-f0-9]{64}$/.test(detail.sha256 || "")) throw Error("Invalid deployment detail index");
  const directory = physical(path.join(path.dirname(report), detail.directory));
  const before = fs.lstatSync(directory);
  if (!before.isDirectory()) throw Error("Physical deployment detail directory required");
  const names = fs.readdirSync(directory).sort();
  if (names.length !== detail.chunkCount || names.some((name, index) => name !== chunkName(index))) throw Error("Deployment detail membership changed");
  const chunks = [], hash = crypto.createHash("sha256");
  for (let part = 0; part < detail.chunkCount; part++) {
    const expected = Math.min(CHUNK_BYTES, detail.bytes - part * CHUNK_BYTES);
    const bytes = readPlain(path.join(directory, chunkName(part)), expected);
    hash.update(bytes); chunks.push(bytes);
  }
  if (hash.digest("hex") !== detail.sha256) throw Error("Deployment detail digest changed");
  if (!same(identity(before), identity(fs.lstatSync(physical(directory)))) || !same(names, fs.readdirSync(directory).sort()) || !indexBytes.equals(readPlain(report))) throw Error("Deployment details changed while reading");
  const manifest = JSON.parse(Buffer.concat(chunks, detail.bytes).toString("utf8"));
  if (manifest.schema !== 1 || !same(summary(manifest), index.summary)) throw Error("Deployment detail summary binding changed");
  return manifest;
}

// Wrapper handoffs reference the already owned inventory rather than copying
// the prepared context (and its project/engine inventories) into another file.
function createDeploymentContextReference(reportPath, expectedSha256) {
  if (!/^[a-f0-9]{64}$/.test(expectedSha256 || "")) throw Error("Exact deployment manifest SHA-256 required");
  const manifest = readDeploymentManifest(reportPath, expectedSha256);
  return { schema: 1, storageFormat: "deployment-context-reference-v1", manifestPath: path.resolve(reportPath), manifestSha256: expectedSha256, summary: summary(manifest) };
}
function readDeploymentContextReference(reference) {
  if (reference?.schema !== 1 || reference.storageFormat !== "deployment-context-reference-v1" || !/^[a-f0-9]{64}$/.test(reference.manifestSha256 || "")) throw Error("Invalid deployment context reference");
  const manifest = readDeploymentManifest(reference.manifestPath, reference.manifestSha256);
  if (!same(summary(manifest), reference.summary)) throw Error("Deployment context summary binding changed");
  return { ...manifest, reportPath: path.resolve(reference.manifestPath), manifestSha256: reference.manifestSha256 };
}

module.exports = { serializeDeploymentManifest, preflightDeploymentManifest, writeDeploymentManifest, readDeploymentManifest, createDeploymentContextReference, readDeploymentContextReference };
