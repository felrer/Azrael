"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const SOURCE_ROOT = path.resolve(__dirname, "../extensions/azrael-ex/media/student-avatars");
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function readStudentAvatarAssets(sourceRoot = SOURCE_ROOT, includeNotices = false) {
  const root = fs.realpathSync(sourceRoot);
  function readFile(name) {
    const filename = path.join(root, name);
    const stat = fs.lstatSync(filename);
    if (!stat.isFile() || stat.isSymbolicLink() || fs.realpathSync(filename) !== filename) {
      throw new Error(`Student avatar must be a regular local file: ${name}`);
    }
    return fs.readFileSync(filename);
  }
  const manifestBytes = readFile("manifest.json");
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.students) || manifest.students.length !== 100) {
    throw new Error("Student avatar manifest requires schemaVersion 1 and exactly 100 students.");
  }
  const ids = new Set();
  const assets = [];
  for (const student of manifest.students) {
    if (!Number.isSafeInteger(student.id) || student.id <= 0 || ids.has(student.id)) {
      throw new Error("Student avatar IDs must be unique positive integers.");
    }
    ids.add(student.id);
    if (["nameKo", "nameEn", "school"].some(key => typeof student[key] !== "string" || !student[key].trim())) {
      throw new Error(`Student avatar identity is incomplete: ${student.id}`);
    }
    if (student.variant != null || (student.baseName != null && student.baseName !== student.nameEn)) {
      throw new Error(`Student avatar variants are forbidden: ${student.id}`);
    }
    if (student.asset !== `${student.id}.png`) {
      throw new Error(`Student avatar asset must be its ID basename: ${student.id}`);
    }
    const bytes = readFile(student.asset);
    if (bytes.length < 8 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
      throw new Error(`Student avatar is not a PNG: ${student.asset}`);
    }
    if (student.assetSHA256 != null && (!/^[a-f0-9]{64}$/i.test(student.assetSHA256) ||
        crypto.createHash("sha256").update(bytes).digest("hex") !== student.assetSHA256.toLowerCase())) {
      throw new Error(`Student avatar SHA256 mismatch: ${student.asset}`);
    }
    assets.push({ name: student.asset, bytes });
  }
  if (includeNotices) {
    for (const name of ["NOTICE.txt", "provenance.json"]) assets.push({ name, bytes: readFile(name) });
  }
  return { manifest, manifestBytes, assets };
}

function validateStudentAvatarAssets(sourceRoot = SOURCE_ROOT) {
  return readStudentAvatarAssets(sourceRoot).manifest;
}

// destination is the local webview root. Validate every input before writing.
function copyStudentAvatarAssets(destination) {
  const { manifestBytes, assets } = readStudentAvatarAssets(SOURCE_ROOT, true);
  if (typeof destination !== "string" || !destination.trim()) throw new Error("A local webview destination is required.");
  const output = path.resolve(destination, "assets", "azrael-students");
  let ancestor = output;
  while (true) {
    if (fs.existsSync(ancestor) && (fs.lstatSync(ancestor).isSymbolicLink() || !fs.lstatSync(ancestor).isDirectory())) {
      throw new Error(`Student avatar output cannot traverse a link or non-directory: ${ancestor}`);
    }
    const parent = path.dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
  for (const name of ["manifest.json", ...assets.map(asset => asset.name)]) {
    const filename = path.join(output, name);
    if (fs.existsSync(filename) && (!fs.lstatSync(filename).isFile() || fs.lstatSync(filename).isSymbolicLink())) {
      throw new Error(`Student avatar output must be a regular file: ${filename}`);
    }
  }
  fs.mkdirSync(output, { recursive: true });
  for (const asset of assets) fs.writeFileSync(path.join(output, asset.name), asset.bytes);
  fs.writeFileSync(path.join(output, "manifest.json"), manifestBytes);
  return output;
}

module.exports = { copyStudentAvatarAssets, validateStudentAvatarAssets };
