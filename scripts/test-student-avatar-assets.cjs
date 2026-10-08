"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { copyStudentAvatarAssets, validateStudentAvatarAssets } = require("./student-avatar-assets.cjs");

const source = path.resolve(__dirname, "../extensions/azrael-ex/media/student-avatars");
const sha256 = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "azrael-student-assets-test-"));
try {
  // Committed provenance preserves the approved ordered roster and PNG hashes;
  // generation/review artifacts are not required to verify packaged assets.
  const approved = JSON.parse(fs.readFileSync(path.join(source, "provenance.json")));
  const manifest = validateStudentAvatarAssets();
  assert.deepEqual(manifest.students.map(s => s.id), approved.sources.map(s => s.id));
  const copied = copyStudentAvatarAssets(path.join(temporary, "webview"));
  assert.equal(copied, path.join(temporary, "webview", "assets", "azrael-students"));
  assert.deepEqual(fs.readdirSync(copied).sort(), ["manifest.json", "NOTICE.txt", "provenance.json", ...manifest.students.map(s => s.asset)].sort());
  for (const name of ["manifest.json", "NOTICE.txt", "provenance.json"]) {
    assert.deepEqual(fs.readFileSync(path.join(copied, name)), fs.readFileSync(path.join(source, name)), name);
  }
  assert.deepEqual(validateStudentAvatarAssets(copied), manifest);
  for (const student of approved.sources) {
    const filename = `${student.id}.png`;
    const bytes = fs.readFileSync(path.join(source, filename));
    assert.equal(sha256(bytes), student.assetSHA256, filename);
    assert.deepEqual(fs.readFileSync(path.join(copied, filename)), bytes, filename);
  }

  // Exercise malformed manifests and bytes using the copied local fixture.
  const manifestPath = path.join(copied, "manifest.json");
  function invalid(change, pattern) {
    const fixture = structuredClone(manifest);
    change(fixture);
    fs.writeFileSync(manifestPath, JSON.stringify(fixture));
    assert.throws(() => validateStudentAvatarAssets(copied), pattern);
  }
  invalid(m => m.students.pop(), /exactly 100/);
  invalid(m => m.students[1].id = m.students[0].id, /unique/);
  invalid(m => m.students[0].variant = "Swimsuit", /variants/);
  invalid(m => m.students[0].asset = "../outside.png", /basename/);
  invalid(m => m.students[0].assetSHA256 = "0".repeat(64), /SHA256 mismatch/);
  const hashed = structuredClone(manifest);
  hashed.students[0].assetSHA256 = approved.sources[0].assetSHA256;
  fs.writeFileSync(manifestPath, JSON.stringify(hashed));
  assert.equal(validateStudentAvatarAssets(copied).students.length, 100);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  const firstAsset = path.join(copied, manifest.students[0].asset);
  fs.writeFileSync(firstAsset, "not PNG");
  assert.throws(() => validateStudentAvatarAssets(copied), /not a PNG/);
  fs.unlinkSync(firstAsset);
  assert.throws(() => validateStudentAvatarAssets(copied), /ENOENT/);
  const blocked = path.join(temporary, "blocked");
  fs.mkdirSync(path.join(blocked, "assets", "azrael-students", "manifest.json"), { recursive: true });
  assert.throws(() => copyStudentAvatarAssets(blocked), /regular file/);
  assert.equal(fs.readdirSync(path.join(blocked, "assets", "azrael-students")).length, 1);
  assert.throws(() => copyStudentAvatarAssets(""), /destination/);
  console.log("PASS: committed provenance protects 100 approved IDs and PNG hashes; complete byte-identical 103-file copy including manifest, notice and provenance; malformed count, IDs, variants, paths, hashes, PNGs, missing assets and unsafe output fail closed.");
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
