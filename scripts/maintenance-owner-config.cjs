"use strict";
// The installation receipt pins the standalone owner; callers never build on demand.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

function plainFile(filename) {
  if (!path.isAbsolute(filename) || filename.includes("\0") || filename.split(/[\\/]/).includes("..")) throw Error("Absolute maintenance owner path without traversal required");
  for (let current = path.resolve(filename);;) {
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || (current === path.resolve(filename) ? !stat.isFile() : !stat.isDirectory())) throw Error("Maintenance owner requires a plain file and directory ancestors");
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return path.resolve(filename);
}

function resolveMaintenanceOwner() {
  const override = process.env.AZRAEL_MAINTENANCE_OWNER;
  if (override) return plainFile(override);
  const root = path.resolve(__dirname, "..");
  const receiptPath = path.join(root, "artifacts/maintenance/owner-installation.json");
  plainFile(receiptPath);
  const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
  if (receipt.schema !== 1 || receipt.protocol !== "maintenance-owner-lease-v1" || typeof receipt.executable !== "string" || !/^[a-f0-9]{64}$/.test(receipt.sha256 || "")) throw Error("Verified maintenance owner installation receipt required");
  if (path.isAbsolute(receipt.executable) || receipt.executable.split(/[\\/]/).includes("..")) throw Error("Maintenance owner installation must be contained in the project");
  const executable = plainFile(path.join(root, receipt.executable));
  const actual = crypto.createHash("sha256").update(fs.readFileSync(executable)).digest("hex");
  if (actual !== receipt.sha256) throw Error("Installed maintenance owner identity changed");
  return executable;
}

module.exports = { resolveMaintenanceOwner };
