"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  assertDirectory, assertFile, assertManagedTarget, assertUnchanged, copyDirectory,
  fail, fileHash, generatedRole, instructionBody, isWithin, parseArgs, pathState,
  run, selectedConfig, sha256,
} = require("./sync-codex-environment.cjs");

function loadManifest(file) {
  const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  if (manifest.schema !== 1) fail("Unsupported shared environment manifest schema.");
  manifest.agentRoles ??= [];
  manifest.generatedAgentRoles ??= [];
  manifest.skills ??= [];
  manifest.playbooksDir ??= "playbooks";
  for (const field of ["agentRoles", "generatedAgentRoles", "skills"]) {
    if (!Array.isArray(manifest[field])) fail(`Manifest ${field} must be an array.`);
  }
  const roles = [...manifest.agentRoles, ...manifest.generatedAgentRoles.map((role) => role.name)];
  for (const name of [...roles, ...manifest.skills]) {
    if (typeof name !== "string" || !/^[A-Za-z0-9_-]+$/.test(name)) fail(`Invalid managed name: ${name}`);
  }
  if (new Set(roles).size !== roles.length || new Set(manifest.skills).size !== manifest.skills.length) {
    fail("Duplicate managed names in shared environment manifest.");
  }
  for (const role of manifest.generatedAgentRoles) {
    if (!manifest.agentRoles.includes(role.source)) fail(`Generated role source is not managed: ${role.source}`);
  }
  return manifest;
}

function updateCheckout(repo, ref, checkout) {
  const git = (args) => run("git", args, { cwd: checkout }, `git ${args.join(" ")}`);
  if (!fs.existsSync(checkout)) {
    fs.mkdirSync(checkout, { recursive: true });
    git(["init"]);
    git(["remote", "add", "origin", repo]);
  } else {
    if (git(["rev-parse", "--is-inside-work-tree"]) !== "true") fail("Checkout must be a git work tree.");
    // Do not reset a parent repository when handed an ordinary subdirectory.
    if (fs.realpathSync(git(["rev-parse", "--show-toplevel"])) !== fs.realpathSync(checkout)) {
      fail("Checkout must be the git work tree root.");
    }
    if (git(["remote", "get-url", "origin"]) !== repo) fail("Checkout origin does not match --repo.");
  }
  if (git(["status", "--porcelain"])) fail("Managed checkout has local changes; refusing to overwrite them.");
  git(["fetch", "origin", ref]);
  git(["reset", "--hard", "FETCH_HEAD"]);
}

function defaultCheckEngine(engine, home) {
  run(engine, ["features", "list"], { env: { ...process.env, CODEX_HOME: home } }, "shared environment config load");
}

function main(argv = process.argv.slice(2), { checkEngine = defaultCheckEngine } = {}) {
  const args = parseArgs(argv);
  const repo = args.repo || fail("--repo is required.");
  const ref = args.ref || "main";
  const checkout = path.resolve(args.checkout || fail("--checkout is required."));
  const stateRoot = path.resolve(args["state-root"] || path.join(os.homedir(), ".azrael-ex"));
  const engine = path.resolve(args.engine || fail("--engine is required."));
  const mode = args.mode || "apply";
  if (!["apply", "validate"].includes(mode)) fail("--mode must be apply or validate.");
  if (isWithin(checkout, stateRoot) || isWithin(stateRoot, checkout)) fail("Checkout and Azrael state must not overlap.");
  const sourceHome = path.resolve(checkout, args["source-dir"] || "environment");
  if (sourceHome === checkout || !isWithin(sourceHome, checkout)) fail("--source-dir must be inside the checkout.");
  updateCheckout(repo, ref, checkout);
  if (!isWithin(sourceHome, checkout)) fail("Source directory escapes the checkout.");
  const manifestPath = path.join(checkout, "azrael-environment.json");
  const manifestState = pathState(manifestPath);
  const manifest = loadManifest(manifestPath);
  const receiptPath = path.join(stateRoot, "azrael", "shared-environment", "snapshot.json");
  const roles = [...manifest.agentRoles, ...manifest.generatedAgentRoles.map((role) => role.name)];
  const targets = [
    path.join(stateRoot, "config.toml"), path.join(stateRoot, "AGENTS.md"),
    ...roles.map((name) => path.join(stateRoot, "agents", `${name}.toml`)),
    ...manifest.skills.map((name) => path.join(stateRoot, "skills", name)), receiptPath,
  ];
  targets.forEach((target) => assertManagedTarget(target, stateRoot));
  const destinationStates = new Map(targets.map((target) => [target, pathState(target)]));
  const sourceStates = new Map([manifestPath, path.join(sourceHome, "config.toml"), path.join(sourceHome, "AGENTS.md"),
    ...manifest.agentRoles.map((name) => path.join(sourceHome, "agents", `${name}.toml`)),
    ...manifest.skills.map((name) => path.join(sourceHome, "skills", name)),
  ].map((target) => [target, pathState(target)]));
  sourceStates.set(manifestPath, manifestState);
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), "azrael-shared-environment-"));
  const stageHome = path.join(stage, "home");
  const warnings = [];
  const roleHashes = {};
  const skillHashes = {};
  let backupDirectory = null;
  let commitLock = null;
  const output = (status, fingerprint) => {
    const result = { status, fingerprint, receipt: receiptPath, backup: backupDirectory, warnings };
    process.stdout.write(JSON.stringify(result) + "\n");
    return result;
  };
  try {
    fs.mkdirSync(path.join(stageHome, "agents"), { recursive: true });
    fs.mkdirSync(path.join(stageHome, "skills"), { recursive: true });
    assertFile(path.join(sourceHome, "config.toml"), "shared config");
    const destinationConfig = fs.existsSync(path.join(stateRoot, "config.toml"))
      ? fs.readFileSync(path.join(stateRoot, "config.toml"), "utf8") : "";
    fs.writeFileSync(path.join(stageHome, "config.toml"), selectedConfig(
      fs.readFileSync(path.join(sourceHome, "config.toml"), "utf8"), destinationConfig, manifest, []));
    assertFile(path.join(sourceHome, "AGENTS.md"), "global AGENTS.md");
    fs.copyFileSync(path.join(sourceHome, "AGENTS.md"), path.join(stageHome, "AGENTS.md"));
    for (const name of manifest.agentRoles) {
      const source = path.join(sourceHome, "agents", `${name}.toml`);
      assertFile(source, `agent role ${name}`);
      fs.copyFileSync(source, path.join(stageHome, "agents", `${name}.toml`));
      roleHashes[name] = fileHash(path.join(stageHome, "agents", `${name}.toml`));
    }
    for (const role of manifest.generatedAgentRoles) {
      const source = fs.readFileSync(path.join(stageHome, "agents", `${role.source}.toml`), "utf8");
      const contents = generatedRole(source, role);
      if (instructionBody(contents) !== instructionBody(source)) fail(`${role.name} developer instructions differ from ${role.source}.`);
      fs.writeFileSync(path.join(stageHome, "agents", `${role.name}.toml`), contents);
      roleHashes[role.name] = sha256(contents);
    }
    for (const name of manifest.skills) {
      const source = path.join(sourceHome, "skills", name);
      assertDirectory(source, `skill ${name}`);
      const resolved = fs.realpathSync.native(source);
      sourceStates.set(resolved, pathState(resolved));
      assertFile(path.join(source, "SKILL.md"), `skill instructions ${name}`);
      const text = fs.readFileSync(path.join(source, "SKILL.md"), "utf8");
      const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      const hasNonemptyField = (key) => {
        const value = frontmatter?.[1].match(new RegExp(`^${key}:[ \\t]*(.*)$`, "m"))?.[1].trim();
        return value && !/^(?:""|'')[ \t]*(?:#.*)?$/.test(value);
      };
      if (!hasNonemptyField("name") || !hasNonemptyField("description")) {
        warnings.push(`Source skill ${name} has missing name/description frontmatter; copied unchanged, native availability is not established.`);
      }
      copyDirectory(source, path.join(stageHome, "skills", name));
      skillHashes[name] = pathState(path.join(stageHome, "skills", name)).sha256;
    }
    const staged = new Map(targets.filter((target) => target !== receiptPath)
      .map((target) => [target, path.join(stageHome, path.relative(stateRoot, target))]));
    const expectedStates = Object.fromEntries([...staged].map(([target, source]) => [path.relative(stateRoot, target), pathState(source)]));
    const fingerprint = sha256(JSON.stringify({ repo, ref, manifest: manifestState.sha256, managedStates: expectedStates }));
    checkEngine(engine, stageHome);
    assertUnchanged(sourceStates);
    assertUnchanged(destinationStates);
    if (mode === "validate") return output("validated", fingerprint);
    const existingReceipt = fs.existsSync(receiptPath) ? JSON.parse(fs.readFileSync(receiptPath, "utf8")) : null;
    const artifactsUnchanged = [...staged].every(([target]) => {
      const state = destinationStates.get(target);
      const relative = path.relative(stateRoot, target);
      return JSON.stringify(state) === JSON.stringify(expectedStates[relative])
        && JSON.stringify(state) === JSON.stringify(existingReceipt?.managedStates?.[relative]);
    });
    if (existingReceipt?.fingerprint === fingerprint && artifactsUnchanged) return output("unchanged", fingerprint);
    const lockPath = path.join(stateRoot, "azrael", "shared-environment.lock");
    assertManagedTarget(lockPath, stateRoot);
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.closeSync(fs.openSync(lockPath, "wx"));
    commitLock = lockPath;
    assertUnchanged(sourceStates);
    assertUnchanged(destinationStates);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-") + "-" + crypto.randomBytes(4).toString("hex");
    backupDirectory = path.join(stateRoot, "azrael", "shared-environment-backups", timestamp);
    assertManagedTarget(path.join(backupDirectory, "recovery.json"), stateRoot);
    fs.mkdirSync(backupDirectory, { recursive: true });
    fs.writeFileSync(path.join(backupDirectory, "recovery.json"), JSON.stringify({
      stateRoot, status: "commit-started", targets: targets.map((target) => ({
        target, before: destinationStates.get(target), backup: path.join(backupDirectory, "previous", path.relative(stateRoot, target)),
      })),
    }, null, 2));
    const backups = [];
    const temporaryFiles = [];
    const writeFile = (target, contents) => {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const temporary = `${target}.snapshot-${crypto.randomBytes(6).toString("hex")}`;
      temporaryFiles.push(temporary);
      fs.writeFileSync(temporary, contents);
      fs.renameSync(temporary, target);
    };
    try {
      for (const target of targets) {
        assertManagedTarget(target, stateRoot);
        assertUnchanged(new Map([[target, destinationStates.get(target)]]));
        if (!fs.lstatSync(target, { throwIfNoEntry: false })) { backups.push({ target, existed: false }); continue; }
        const backup = path.join(backupDirectory, "previous", path.relative(stateRoot, target));
        fs.mkdirSync(path.dirname(backup), { recursive: true });
        fs.renameSync(target, backup);
        backups.push({ target, existed: true, backup });
      }
      for (const [target, source] of staged) {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        if (fs.statSync(source).isDirectory()) copyDirectory(source, target);
        else writeFile(target, fs.readFileSync(source));
      }
      writeFile(receiptPath, JSON.stringify({
        schema: 1, status: "applied", createdAt: new Date().toISOString(), fingerprint, warnings,
        repo, ref, checkout, stateRoot, backupDirectory, roleHashes, skillHashes,
        managedStates: Object.fromEntries([...staged].map(([target]) => [path.relative(stateRoot, target), pathState(target)])),
      }, null, 2) + "\n");
      checkEngine(engine, stateRoot);
      return output("applied", fingerprint);
    } catch (error) {
      for (const item of backups.reverse()) {
        if (fs.lstatSync(item.target, { throwIfNoEntry: false })) fs.rmSync(item.target, { recursive: true, force: true });
        if (item.existed) {
          fs.mkdirSync(path.dirname(item.target), { recursive: true });
          fs.renameSync(item.backup, item.target);
        }
      }
      throw error;
    } finally {
      for (const temporary of temporaryFiles) fs.rmSync(temporary, { force: true });
    }
  } finally {
    if (commitLock) fs.unlinkSync(commitLock);
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try { main(); } catch (error) { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; }
}

module.exports = { main, loadManifest, updateCheckout };
