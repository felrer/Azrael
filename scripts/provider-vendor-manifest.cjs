"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { inventoryTree } = require("./freeze-platform-inputs.cjs");
const REVIEWED_WINDOWS_SHA256 = "d0600827099c6d2a14cadb2ac13804761ec53c7f69ffe7dd7feaca2c895b86d8";
const CANONICAL_SHA256 = "7d80d0d42b49d8c4e22cb4ef21087f037134882e6e93ad2799359004be1a9b0f";
function canonicalRecords(entries) {
  const seen = new Set();
  return entries.map(entry => {
    if (!entry || typeof entry.path !== "string" || !/^[a-f0-9]{64}$/.test(entry.sha256) ||
        path.posix.isAbsolute(entry.path) || /[\\\x00\r\n:]/.test(entry.path) ||
        entry.path.split("/").some(part => !part || part === "." || part === "..") || seen.has(entry.path)) throw new Error("Invalid provider vendor manifest entry");
    seen.add(entry.path);
    return { path: entry.path, sha256: entry.sha256 };
  }).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0).map(entry => `${entry.path}\0${entry.sha256}\n`).join("");
}
function validateVendorEntries(entries, manifest) {
  const expected = canonicalRecords(manifest.files);
  const digest = crypto.createHash("sha256").update(expected).digest("hex");
  if (manifest.schema !== 1 || manifest.reviewedWindowsManifestSha256 !== REVIEWED_WINDOWS_SHA256 || manifest.canonicalSha256 !== CANONICAL_SHA256 || digest !== CANONICAL_SHA256) throw new Error("Provider vendor manifest differs from reviewed canonical identity");
  if (canonicalRecords(entries) !== expected) throw new Error("Provider vendor sources differ from reviewed patched-source manifest");
  return REVIEWED_WINDOWS_SHA256;
}
function vendorSourceManifest(root, manifestFile = path.resolve(root, "../../vendor-source-manifest.json")) {
  const inventory = inventoryTree(root);
  if (inventory.links.length || inventory.files.some(entry => entry.kind !== "file")) throw new Error("Reviewed provider vendor source must contain only regular files");
  return validateVendorEntries(inventory.files, JSON.parse(fs.readFileSync(manifestFile, "utf8")));
}
if (require.main === module) {
  try { console.log(vendorSourceManifest(process.argv[2], process.argv[3])); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { canonicalRecords, validateVendorEntries, vendorSourceManifest };
