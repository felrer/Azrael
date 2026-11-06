"use strict";
// Verified app installations take precedence; legacy projects keep their pinned owner.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const PROTOCOL = "maintenance-owner-lease-v1";
const REQUIRED_OPERATIONS = ["inventory", "register", "review", "apply", "recover_lock", "recover_reservation", "recover_refresh_pending", "recover_lifecycle_pending"];
const digest = filename => crypto.createHash("sha256").update(fs.readFileSync(filename)).digest("hex");
function waitCapability(value) {
  if (value === undefined) return {};
  if (!Number.isSafeInteger(value) || value < 5000 || value > 600000) throw Error("Invalid maintenance lock wait capability");
  return { maxLockWaitMs: value };
}

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

function installationPath(stateRoot, { env = process.env } = {}) {
  return env.AZRAEL_MAINTENANCE_INSTALLATION || path.join(stateRoot || env.AZRAEL_STATE_ROOT || env.CODEX_HOME || path.join(os.homedir(), ".azrael-ex"), "maintenance-installation.json");
}

function validateCapabilities(value) {
  if (value?.schema !== 1 || value.protocol !== PROTOCOL || value.platform?.os !== process.platform || value.platform?.arch !== process.arch ||
      !Array.isArray(value.operations) || REQUIRED_OPERATIONS.some(operation => !value.operations.includes(operation)) ||
      !Array.isArray(value.storage_formats) || ["legacy", "partitioned-v1"].some(format => !value.storage_formats.includes(format))) throw Error("Incompatible Azrael maintenance capabilities");
  return value;
}

function resolveMaintenanceCommand(projectRoot = path.resolve(__dirname, ".."), { env = process.env } = {}) {
  const override = env.AZRAEL_MAINTENANCE_OWNER;
  if (override) {
    const mode = env.AZRAEL_MAINTENANCE_OWNER_MODE || "standalone";
    if (!["standalone", "azrael-maintenance"].includes(mode)) throw Error("Unknown maintenance owner override mode");
    return { executable: plainFile(override), args: mode === "azrael-maintenance" ? ["maintenance"] : [] };
  }
  if (typeof projectRoot !== "string" || !path.isAbsolute(projectRoot) || projectRoot.includes("\0") || projectRoot.split(/[\\/]/).includes("..")) throw Error("Absolute maintenance owner project root without traversal required");
  const installed = installationPath(undefined, { env });
  // Only absence permits the pre-integration standalone. Invalid app receipts fail closed.
  let present;
  try { fs.lstatSync(installed); present = true; } catch (error) { if (error.code !== "ENOENT") throw error; present = false; }
  if (present || env.AZRAEL_MAINTENANCE_INSTALLATION) {
    const receipt = JSON.parse(fs.readFileSync(plainFile(installed), "utf8"));
    if (receipt.schema !== 2 || receipt.protocol !== PROTOCOL || receipt.product !== "Azrael" ||
        !/^\d+\.\d+\.\d+$/.test(receipt.version || "") || !/^[a-f0-9]{64}$/.test(receipt.sha256 || "")) throw Error("Verified Azrael maintenance installation receipt required");
    validateCapabilities(receipt.capabilities);
    if (!["lease", "register_review_apply", "target_absent", "fixture_absent"].every(key => receipt.acceptance?.[key] === true)) throw Error("Verified Azrael maintenance installation acceptance required");
    const executable = plainFile(receipt.executable);
    if (digest(executable) !== receipt.sha256) throw Error("Installed maintenance owner identity changed");
    return { executable, args: ["maintenance"], ...waitCapability(receipt.capabilities.max_lock_wait_ms) };
  }
  const root = path.resolve(projectRoot);
  const receiptPath = path.join(root, "artifacts/maintenance/owner-installation.json");
  plainFile(receiptPath);
  const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
  if (receipt.schema !== 1 || receipt.protocol !== "maintenance-owner-lease-v1" || typeof receipt.executable !== "string" || !/^[a-f0-9]{64}$/.test(receipt.sha256 || "")) throw Error("Verified maintenance owner installation receipt required");
  if (path.isAbsolute(receipt.executable) || receipt.executable.split(/[\\/]/).includes("..")) throw Error("Maintenance owner installation must be contained in the project");
  const executable = plainFile(path.join(root, receipt.executable));
  const actual = crypto.createHash("sha256").update(fs.readFileSync(executable)).digest("hex");
  if (actual !== receipt.sha256) throw Error("Installed maintenance owner identity changed");
  return { executable, args: [], ...waitCapability(receipt.max_lock_wait_ms) };
}

function resolveMaintenanceOwner(projectRoot) { return resolveMaintenanceCommand(projectRoot).executable; }

function verifyInstalledCommand(executable, installationReceipt) {
  const fixture = path.join(path.dirname(installationReceipt), "maintenance-check-" + crypto.randomUUID());
  fs.mkdirSync(fixture);
  try {
    fs.mkdirSync(path.join(fixture, ".git"));
    fs.mkdirSync(path.join(fixture, "generated"));
    fs.writeFileSync(path.join(fixture, "project-maintenance.json"), JSON.stringify({ schema_version: 1, project_id: "azrael-installation-check", managed_roots: ["generated"], bundles: [] }));
    const target = path.join(fixture, "generated/check");
    fs.writeFileSync(target, "Azrael maintenance installation check");
    function invoke(args, input) {
      const result = spawnSync(executable, ["maintenance", ...args], { input, encoding: "utf8", windowsHide: true, timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
      if (result.error || result.status !== 0 || result.signal) throw Error("Azrael maintenance acceptance failed; fixture retained at " + fixture + ": " + (result.error?.message || result.stderr));
      return result.stdout;
    }
    const lease = invoke(["--lease", path.join(fixture, "catalog.lock"), "--operation", "installation.acceptance", "--wait-ms", "0", "--parent-pid", String(process.pid)], JSON.stringify({ id: 1, operation: "release" }) + "\n").trim().split(/\r?\n/).map(line => JSON.parse(line));
    if (lease.length !== 2 || lease[0].id !== 0 || lease[1].id !== 1 || lease.some(value => value.ok !== true)) throw Error("Azrael installation lease protocol mismatch: " + fixture);
    function request(value) {
      const file = path.join(fixture, "request.json");
      fs.writeFileSync(file, JSON.stringify(value));
      return JSON.parse(invoke(["--project-root", fixture, "--request", file]));
    }
    request({ operation: "register", group: { id: "installation-check", kind: "run", owner: "azrael-installer", membership_complete: true, provenance_ref: "installation-check", members: [{ id: "check", path: "generated/check", kind: "fixture", owner: "azrael-installer", generated: true, protection_known: true, references: [] }] } });
    const review = request({ operation: "review", group_ids: ["installation-check"] });
    if (review.items?.length !== 1 || review.items[0].blockers?.length) throw Error("Azrael installation review blocked: " + fixture);
    const apply = request({ operation: "apply", decisions: [{ id: review.items[0].id, token: review.items[0].token, decision: "delete", reason: "Isolated installation acceptance complete" }] });
    if (apply.results?.length !== 1 || apply.results[0].status !== "deleted" || apply.results[0].remaining !== false || fs.existsSync(target)) throw Error("Azrael installation deletion unconfirmed: " + fixture);
    // The installer owns this fresh isolated metadata; native ownership handled payload deletion.
    fs.rmSync(fixture, { recursive: true });
    if (fs.existsSync(fixture)) throw Error("Azrael installation fixture cleanup incomplete: " + fixture);
    return { lease: true, register_review_apply: true, target_absent: true, fixture_absent: true };
  } catch (error) {
    // Failed/unknown native work may have durable reservations; never force fixture cleanup.
    throw Error(error.message + " (installation check: " + fixture + ")", { cause: error });
  }
}

function publishInstallation({ executable, stateRoot, version, installationReceipt }) {
  executable = plainFile(executable);
  if (!/^\d+\.\d+\.\d+$/.test(version || "") || !path.isAbsolute(stateRoot || "") || stateRoot.includes("\0") || stateRoot.split(/[\\/]/).includes("..")) throw Error("Installation version and absolute state root required");
  const installation = JSON.parse(fs.readFileSync(plainFile(installationReceipt), "utf8"));
  const modern = installation.installed === true && installation.releaseVersion === version && installation.runtimeConfig?.engine === executable;
  const legacy = installation.status === "installed-reload-required" && installation.hostVersion === version && path.join(installation.releaseDirectory || "", "engine/azrael.exe") === executable;
  if (!modern && !legacy) throw Error("Successful exact Azrael installation receipt required");
  // Native acceptance is still required before installers for other platforms adopt this pointer.
  if (process.platform !== "win32" || process.arch !== "x64") throw Error("Azrael maintenance installation requires platform native acceptance");
  const filename = path.join(stateRoot, "maintenance-installation.json");
  const previous = fs.existsSync(filename) ? fs.readFileSync(plainFile(filename)) : null;
  const sha256 = digest(executable);
  const result = spawnSync(executable, ["maintenance", "capabilities"], { encoding: "utf8", windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024 });
  if (result.error || result.status !== 0 || result.signal) throw Error("Azrael maintenance capability query failed: " + (result.error?.message || result.stderr));
  const capabilities = validateCapabilities(JSON.parse(result.stdout));
  if (digest(executable) !== sha256) throw Error("Azrael engine changed during capability query");
  const acceptance = verifyInstalledCommand(executable, installationReceipt);
  if (digest(executable) !== sha256) throw Error("Azrael engine changed during installation acceptance");
  const receipt = { schema: 2, product: "Azrael", version, protocol: PROTOCOL, executable, sha256, capabilities, acceptance, installation_receipt: installationReceipt };
  // Reject existing links before creating a potentially custom state directory.
  for (let current = stateRoot; ; current = path.dirname(current)) {
    try { const entry = fs.lstatSync(current); if (!entry.isDirectory() || entry.isSymbolicLink()) throw Error("Plain Azrael state directory required"); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    if (path.dirname(current) === current) break;
  }
  fs.mkdirSync(stateRoot, { recursive: true });
  const lease = require("./maintenance-lock-owner.cjs").acquire(path.join(stateRoot, "maintenance-installation.lock"), {
    operation: "installation.publish", command: { executable, args: ["maintenance"] }
  });
  const pending = filename + "." + crypto.randomUUID() + ".pending";
  try {
    fs.writeFileSync(pending, JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
    const current = fs.existsSync(filename) ? fs.readFileSync(plainFile(filename)) : null;
    if (previous === null ? current !== null : current === null || !previous.equals(current)) throw Error("Azrael maintenance installation changed concurrently");
    fs.renameSync(pending, filename);
  } finally {
    try { if (fs.existsSync(pending)) fs.unlinkSync(pending); }
    finally { lease.release(); }
  }
  return { receipt: filename, executable, sha256, args: ["maintenance"] };
}

module.exports = { resolveMaintenanceOwner, resolveMaintenanceCommand, installationPath, validateCapabilities, publishInstallation, verifyInstalledCommand };
if (require.main === module) {
  try {
    const [operation, executable, stateRoot, version, installationReceipt] = process.argv.slice(2);
    if (operation !== "publish" || process.argv.length !== 7) throw Error("Usage: maintenance-owner-config.cjs publish ABS_ENGINE ABS_STATE VERSION ABS_INSTALLATION_RECEIPT");
    process.stdout.write(JSON.stringify(publishInstallation({ executable, stateRoot, version, installationReceipt })) + "\n");
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
