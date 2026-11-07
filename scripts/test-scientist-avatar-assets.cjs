"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { copyScientistAvatarAssets, validateScientistAvatarAssets } = require("./scientist-avatar-assets.cjs");
const source = path.resolve(__dirname, "../extensions/azrael-ex/media/scientist-avatars");
const sha256 = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "azrael-scientist-assets-test-"));
try {
  const manifest = validateScientistAvatarAssets();
  const provenance = JSON.parse(fs.readFileSync(path.join(source, "provenance.json"), "utf8"));
  assert.equal(manifest.photos.length, 150);
  assert.deepEqual(provenance.sources.map(p => p.id), manifest.photos.map(p => p.id));
  const copied = copyScientistAvatarAssets(path.join(temporary, "webview"));
  assert.equal(copied, path.join(temporary, "webview", "assets", "azrael-scientists"));
  const names = ["manifest.json", "NOTICE.txt", "provenance.json", ...manifest.photos.map(p => p.asset)];
  assert.deepEqual(fs.readdirSync(copied).sort(), names.sort());
  for (const name of names) assert.deepEqual(fs.readFileSync(path.join(copied, name)), fs.readFileSync(path.join(source, name)));
  assert.deepEqual(validateScientistAvatarAssets(copied), manifest);
  for (const photo of manifest.photos) {
    assert.equal(provenance.sources.find(p => p.id === photo.id).assetSHA256, photo.assetSHA256);
    assert.equal(sha256(fs.readFileSync(path.join(copied, photo.asset))), photo.assetSHA256);
  }
  const manifestPath = path.join(copied, "manifest.json");
  function invalid(change, pattern) {
    const fixture = structuredClone(manifest);
    change(fixture);
    fs.writeFileSync(manifestPath, JSON.stringify(fixture));
    assert.throws(() => validateScientistAvatarAssets(copied), pattern);
  }
  invalid(m => m.schemaVersion = 2, /schemaVersion/);
  invalid(m => m.photos = [], /nonempty/);
  invalid(m => m.photos.push(m.photos[0]), /unique/);
  invalid(m => m.photos[0].asset = "../outside.jpg", /safe JPEG/);
  invalid(m => m.photos[0].id = "scientists:wrong", /match/);
  invalid(m => m.photos[0].nameEn = " ", /identity/);
  invalid(m => m.photos[0].assetSHA256 = "0".repeat(64), /SHA256/);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  const first = path.join(copied, manifest.photos[0].asset);
  fs.writeFileSync(first, "not a JPEG");
  assert.throws(() => validateScientistAvatarAssets(copied), /JPEG/);
  // A structurally valid SOF declares the wrong dimensions: reject before copying.
  fs.writeFileSync(first, Buffer.from([255,216,255,192,0,8,8,0,1,0,1,0,255,217]));
  assert.throws(() => validateScientistAvatarAssets(copied), /256x256/);
  fs.unlinkSync(first);
  assert.throws(() => validateScientistAvatarAssets(copied), /ENOENT/);
  const blocked = path.join(temporary, "blocked");
  fs.mkdirSync(path.join(blocked, "assets", "azrael-scientists", "manifest.json"), { recursive: true });
  assert.throws(() => copyScientistAvatarAssets(blocked), /regular file/);
  assert.deepEqual(fs.readdirSync(path.join(blocked, "assets", "azrael-scientists")), ["manifest.json"]);
  assert.throws(() => copyScientistAvatarAssets(""), /destination/);
  console.log("PASS: 150 approved 256x256 JPEG assets and provenance, byte-identical 153-file packaging; unsafe IDs/paths, duplicate/empty rosters, names, hashes, dimensions, bytes, missing files and blocked outputs rejected.");
} finally {
  assert.ok(temporary.startsWith(path.resolve(os.tmpdir()) + path.sep));
  fs.rmSync(temporary, { recursive: true });
  assert.equal(fs.existsSync(temporary), false);
}
