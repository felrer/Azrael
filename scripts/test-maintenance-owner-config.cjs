"use strict";
// Retained for future installer/argv edits: never lose the prefix or fall back after tampering.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const config = require("./maintenance-owner-config.cjs");

test("installed Azrael selection, strict negotiation and legacy bootstrap", t => {
  const parent = process.env.AZRAEL_LIFECYCLE_FIXTURE_ROOT || path.resolve(__dirname, "../artifacts/verification");
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, "maintenance-config-"));
  const keys = ["AZRAEL_STATE_ROOT", "AZRAEL_MAINTENANCE_INSTALLATION", "AZRAEL_MAINTENANCE_OWNER", "AZRAEL_MAINTENANCE_OWNER_MODE"];
  const before = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  t.after(() => {
    for (const key of keys) if (before[key] === undefined) delete process.env[key]; else process.env[key] = before[key];
    assert.ok(root.startsWith(path.resolve(parent) + path.sep));
    fs.rmSync(root, { recursive: true });
    assert.equal(fs.existsSync(root), false);
  });
  for (const key of keys) delete process.env[key];
  process.env.AZRAEL_STATE_ROOT = path.join(root, "state");
  const binary = path.join(root, "azrael.exe");
  fs.writeFileSync(binary, "pure resolver fixture: never execute");
  const hash = createHash("sha256").update(fs.readFileSync(binary)).digest("hex");
  const legacy = path.join(root, "artifacts/maintenance/owner-installation.json");
  fs.mkdirSync(path.dirname(legacy), { recursive: true });
  fs.writeFileSync(legacy, JSON.stringify({ schema: 1, protocol: "maintenance-owner-lease-v1", executable: "azrael.exe", sha256: hash }));
  assert.deepEqual(config.resolveMaintenanceCommand(root), { executable: binary, args: [] });
  const pointer = config.installationPath();
  fs.mkdirSync(path.dirname(pointer));
  const receipt = {
    schema: 2, product: "Azrael", version: "2026.0.15", protocol: "maintenance-owner-lease-v1", executable: binary, sha256: hash,
    capabilities: { schema: 1, protocol: "maintenance-owner-lease-v1", platform: { os: process.platform, arch: process.arch }, operations: ["inventory", "register", "review", "apply", "recover_lock", "recover_reservation", "recover_refresh_pending", "recover_lifecycle_pending"], storage_formats: ["legacy", "partitioned-v1"] },
    acceptance: { lease: true, register_review_apply: true, target_absent: true, fixture_absent: true }
  };
  const save = value => fs.writeFileSync(pointer, JSON.stringify(value));
  save(receipt);
  assert.deepEqual(config.resolveMaintenanceCommand(root), { executable: binary, args: ["maintenance"] });
  save({ ...receipt, capabilities: { ...receipt.capabilities, max_lock_wait_ms: 600000 } });
  assert.equal(config.resolveMaintenanceCommand(root).maxLockWaitMs, 600000);
  save({ ...receipt, capabilities: { ...receipt.capabilities, max_lock_wait_ms: 600001 } });
  assert.throws(() => config.resolveMaintenanceCommand(root), /lock wait capability/);
  save({ ...receipt, sha256: "0".repeat(64) });
  assert.throws(() => config.resolveMaintenanceCommand(root), /identity changed/);
  save({ ...receipt, capabilities: { ...receipt.capabilities, operations: ["inventory"] } });
  assert.throws(() => config.resolveMaintenanceCommand(root), /capabilities/);
  save({ ...receipt, capabilities: { ...receipt.capabilities, storage_formats: ["unknown"] } });
  assert.throws(() => config.resolveMaintenanceCommand(root), /capabilities/);
  save({ ...receipt, acceptance: { ...receipt.acceptance, lease: false } });
  assert.throws(() => config.resolveMaintenanceCommand(root), /acceptance/);
  save({ ...receipt, capabilities: { ...receipt.capabilities, platform: { os: "unknown", arch: process.arch } } });
  assert.throws(() => config.resolveMaintenanceCommand(root), /capabilities/);
  fs.writeFileSync(pointer, "invalid JSON");
  assert.throws(() => config.resolveMaintenanceCommand(root), SyntaxError);
  process.env.AZRAEL_MAINTENANCE_INSTALLATION = path.join(root, "missing.json");
  assert.throws(() => config.resolveMaintenanceCommand(root), /ENOENT/);
  process.env.AZRAEL_MAINTENANCE_OWNER = binary;
  assert.deepEqual(config.resolveMaintenanceCommand(root), { executable: binary, args: [] });
  process.env.AZRAEL_MAINTENANCE_OWNER_MODE = "azrael-maintenance";
  assert.deepEqual(config.resolveMaintenanceCommand(root), { executable: binary, args: ["maintenance"] });
  process.env.AZRAEL_MAINTENANCE_OWNER_MODE = "invalid";
  assert.throws(() => config.resolveMaintenanceCommand(root), /override mode/);
  for (const key of ["AZRAEL_MAINTENANCE_OWNER", "AZRAEL_MAINTENANCE_OWNER_MODE", "AZRAEL_MAINTENANCE_INSTALLATION"]) delete process.env[key];
  save(receipt);
  const install = path.join(root, "installer-receipt.json");
  fs.writeFileSync(install, JSON.stringify({ installed: false, releaseVersion: receipt.version, runtimeConfig: { engine: binary } }));
  assert.throws(() => config.publishInstallation({ executable: binary, stateRoot: path.dirname(pointer), version: receipt.version, installationReceipt: install }), /Successful exact/);
  assert.deepEqual(JSON.parse(fs.readFileSync(pointer)), receipt);
});
