"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const SOURCE_ROOT = path.resolve(__dirname, "../extensions/azrael-ex/media/scientist-avatars");

function jpegDimensions(bytes) {
  if (bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216 || bytes.at(-2) !== 255 || bytes.at(-1) !== 217) {
    throw Error("Scientist avatar must be a JPEG.");
  }
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset++] !== 255) break;
    while (bytes[offset] === 255) offset++;
    const marker = bytes[offset++];
    if (marker === 218 || marker === 217) break;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) break;
    if ([192, 193, 194].includes(marker) && length >= 8) {
      return { width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3) };
    }
    offset += length;
  }
  throw Error("Scientist avatar has no valid JPEG dimensions.");
}

function readScientistAvatarAssets(sourceRoot = SOURCE_ROOT, includeNotices = false) {
  const root = fs.realpathSync(sourceRoot);
  function readFile(name) {
    const filename = path.join(root, name), stat = fs.lstatSync(filename);
    if (!stat.isFile() || stat.isSymbolicLink() || fs.realpathSync(filename) !== filename) {
      throw Error(`Scientist avatar must be a regular local file: ${name}`);
    }
    return fs.readFileSync(filename);
  }
  const manifestBytes = readFile("manifest.json"), manifest = JSON.parse(manifestBytes.toString("utf8"));
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.photos) || !manifest.photos.length) {
    throw Error("Scientist manifest requires schemaVersion 1 and a nonempty photo roster.");
  }
  const ids = new Set(), assets = [];
  for (const photo of manifest.photos) {
    if (typeof photo.asset !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*\.jpg$/.test(photo.asset)
        || photo.id !== `scientists:${photo.asset.slice(0, -4)}` || ids.has(photo.id)) {
      throw Error("Scientist avatar IDs and safe JPEG basenames must be unique and match.");
    }
    ids.add(photo.id);
    if (["nameKo", "nameEn", "school"].some(key => typeof photo[key] !== "string" || !photo[key].trim())) {
      throw Error(`Scientist avatar identity is incomplete: ${photo.id}`);
    }
    const bytes = readFile(photo.asset), size = jpegDimensions(bytes);
    if (size.width !== 256 || size.height !== 256) throw Error(`Scientist avatar must be 256x256: ${photo.asset}`);
    if (!/^[a-f0-9]{64}$/.test(photo.assetSHA256 ?? "")
        || crypto.createHash("sha256").update(bytes).digest("hex") !== photo.assetSHA256) {
      throw Error(`Scientist avatar SHA256 mismatch: ${photo.asset}`);
    }
    assets.push({ name: photo.asset, bytes });
  }
  if (includeNotices) for (const name of ["NOTICE.txt", "provenance.json"]) assets.push({ name, bytes: readFile(name) });
  return { manifest, manifestBytes, assets };
}

function validateScientistAvatarAssets(sourceRoot = SOURCE_ROOT) {
  return readScientistAvatarAssets(sourceRoot).manifest;
}

function copyScientistAvatarAssets(destination) {
  const { manifestBytes, assets } = readScientistAvatarAssets(SOURCE_ROOT, true);
  if (typeof destination !== "string" || !destination.trim()) throw Error("A local webview destination is required.");
  const output = path.resolve(destination, "assets", "azrael-scientists");
  let ancestor = output;
  while (true) {
    if (fs.existsSync(ancestor) && (fs.lstatSync(ancestor).isSymbolicLink() || !fs.lstatSync(ancestor).isDirectory())) {
      throw Error(`Scientist avatar output cannot traverse a link or non-directory: ${ancestor}`);
    }
    const parent = path.dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
  for (const name of ["manifest.json", ...assets.map(asset => asset.name)]) {
    const filename = path.join(output, name);
    if (fs.existsSync(filename) && (!fs.lstatSync(filename).isFile() || fs.lstatSync(filename).isSymbolicLink())) {
      throw Error(`Scientist avatar output must be a regular file: ${filename}`);
    }
  }
  fs.mkdirSync(output, { recursive: true });
  for (const asset of assets) fs.writeFileSync(path.join(output, asset.name), asset.bytes);
  fs.writeFileSync(path.join(output, "manifest.json"), manifestBytes);
  return output;
}

module.exports = { copyScientistAvatarAssets, validateScientistAvatarAssets };
