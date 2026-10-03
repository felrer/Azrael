"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function fail(message) { throw new Error(message); }
function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function fileHash(file) { return sha256(fs.readFileSync(file)); }
function quoteToml(value) { return JSON.stringify(String(value)); }
// Reuse Python 3.11+'s TOML parser (already required by the build scripts).
// JSON transport deliberately rejects unsupported date values rather than changing them.
function parseToml(text) {
  const parsed = JSON.parse(run("python", ["-X", "utf8", "-c", "import json,sys,tomllib; json.dump(tomllib.loads(sys.stdin.read()),sys.stdout,ensure_ascii=True,allow_nan=False)"], { input: text }, "TOML parse"));
  function check(value) {
    if (typeof value === "number" && Number.isInteger(value) && !Number.isSafeInteger(value)) fail("TOML integer exceeds JavaScript's exact range; no configuration was changed.");
    if (value && typeof value === "object") Object.values(value).forEach(check);
  }
  check(parsed);
  return parsed;
}
function tomlKey(key) { return /^[A-Za-z0-9_-]+$/.test(key) ? key : quoteToml(key); }
function tomlValue(value) {
  if (typeof value === "string") return quoteToml(value);
  if (typeof value === "boolean") return String(value);
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (Array.isArray(value)) return `[${value.map(tomlValue).join(", ")}]`;
  if (value && typeof value === "object") return `{ ${Object.entries(value).map(([key, item]) => `${tomlKey(key)} = ${tomlValue(item)}`).join(", ")} }`;
  fail("Unsupported TOML value; no configuration was changed.");
}
function stringifyToml(value) {
  const lines = [];
  function table(node, keys) {
    if (keys.length) lines.push("", `[${keys.map(tomlKey).join(".")}]`);
    for (const [key, item] of Object.entries(node)) {
      if (!item || typeof item !== "object" || Array.isArray(item)) lines.push(`${tomlKey(key)} = ${tomlValue(item)}`);
    }
    for (const [key, item] of Object.entries(node)) {
      if (item && typeof item === "object" && !Array.isArray(item)) table(item, [...keys, key]);
    }
  }
  table(value, []);
  return lines.join("\n").trim() + "\n";
}
function regexEscape(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function comparablePath(value) {
  let existing = path.resolve(value);
  const suffix = [];
  while (!fs.existsSync(existing)) {
    if (path.dirname(existing) === existing) fail(`Cannot resolve path: ${value}`);
    suffix.unshift(path.basename(existing));
    existing = path.dirname(existing);
  }
  const resolved = path.join(fs.realpathSync.native(existing), ...suffix);
  const normalized = process.platform === "win32" && resolved.startsWith("\\\\?\\") ? resolved.slice(4) : resolved;
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}
function isWithin(candidate, root) {
  const child = comparablePath(candidate);
  const parent = comparablePath(root);
  return child === parent || child.startsWith(parent + path.sep);
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    if (!name?.startsWith("--") || argv[index + 1] === undefined) fail(`Invalid argument: ${name ?? "<missing>"}`);
    result[name.slice(2)] = argv[index + 1];
  }
  return result;
}

function splitToml(text) {
  const root = [];
  const sections = [];
  let current = root;
  let name = null;
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    const match = line.match(/^\s*\[([^\]]+)]\s*(?:#.*)?$/);
    if (match) {
      name = match[1].trim();
      current = [line];
      sections.push({ name, lines: current });
    } else {
      current.push(line);
    }
  }
  return { root, sections };
}

function selectedConfig(sourceText, destinationText, manifest, replacements, ownedRuntime) {
  const source = parseToml(sourceText);
  const destination = parseToml(destinationText);
  const merged = structuredClone(destination);
  const transform = (input) => {
    if (typeof input === "string") {
      // Some environment values contain JSON objects whose Windows paths are escaped.
      try {
        const embedded = JSON.parse(input);
        if (embedded && typeof embedded === "object") return JSON.stringify(transform(embedded));
      } catch { /* ordinary string */ }
      for (const [from, to] of replacements) input = input.replace(new RegExp(regexEscape(from) + "(?=$|[\\\\/;\"'])", "gi"), () => to);
      return input;
    }
    if (Array.isArray(input)) return input.map(transform);
    if (input && typeof input === "object") return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, transform(value)]));
    return input;
  };
  function get(object, keys) { return keys.reduce((node, key) => node?.[key], object); }
  function set(keys, value) {
    const parent = keys.slice(0, -1).reduce((node, key) => node[key] ??= {}, merged);
    if (value === undefined) delete parent[keys.at(-1)];
    else parent[keys.at(-1)] = transform(value);
  }
  for (const key of manifest.config.rootKeys) set([key], source[key]);
  for (const selector of manifest.config.tables) {
    if (ownedRuntime && selector.startsWith("mcp_servers.node_repl")) continue;
    const keys = selector.replace(/\.\*$/, "").split(".");
    set(keys, get(source, keys));
  }
  for (const [tableName, keys] of Object.entries(manifest.config.tableKeys || {})) {
    for (const key of keys) {
      if (ownedRuntime && tableName === "features" && key === "js_repl") continue;
      const pathKeys = [...tableName.split("."), key];
      const value = get(source, pathKeys);
      if (value === undefined) fail(`Required source config key is missing: ${tableName}.${key}`);
      set(pathKeys, value);
    }
  }
  if (ownedRuntime) {
    merged.features ??= {};
    merged.features.js_repl = true;
    merged.mcp_servers ??= {};
    // Retain explicit timeout and tool policy, never source transport or environment.
    const policy = {};
    for (const key of ["startup_timeout_sec", "tool_timeout_sec", "enabled_tools", "disabled_tools"]) {
      if (source.mcp_servers?.node_repl?.[key] !== undefined) policy[key] = source.mcp_servers.node_repl[key];
    }
    const sourceEnvironment = source.mcp_servers?.node_repl?.env || {};
    const browserEnvironment = Object.fromEntries(Object.entries(sourceEnvironment).filter(([key]) =>
      key.startsWith("BROWSER_USE_") || ["NODE_REPL_INSTRUCTIONS_USE_CASE_BROWSER", "NODE_REPL_INSTRUCTIONS_USE_CASE_CHROME"].includes(key))
      .map(([key, value]) => [key, transform(value)]));
    const services = sourceEnvironment.NODE_REPL_TRUSTED_SERVICES ? JSON.parse(sourceEnvironment.NODE_REPL_TRUSTED_SERVICES) : {};
    if (!services || typeof services !== "object" || Array.isArray(services) || Object.values(services).some((value) => typeof value !== "string")) fail("Invalid source Node REPL trusted services.");
    const retainedServices = transform(Object.fromEntries(Object.entries(services).filter(([name]) => name !== "sky")));
    // Browser dependencies are bundled beside its service; external CU module roots
    // must not participate in resolution of the package-owned Sky runtime.
    const externalModulePaths = (sourceEnvironment.NODE_REPL_NODE_MODULE_DIRS || "").split(";").filter(Boolean).map(transform);
    const trustedPaths = (sourceEnvironment.NODE_REPL_TRUSTED_CODE_PATHS || "").split(";").filter(Boolean).map(transform)
      .filter((directory) => !externalModulePaths.some((external) => comparablePath(directory) === comparablePath(external)));
    merged.mcp_servers.node_repl = {
      ...policy,
      command: path.join(ownedRuntime.directory, "node_repl.exe"),
      env: {
        ...browserEnvironment,
        NODE_REPL_NODE_PATH: path.join(ownedRuntime.directory, "node.exe"),
        NODE_REPL_NODE_MODULE_DIRS: path.join(ownedRuntime.directory, "node_modules"),
        NODE_REPL_TRUSTED_CODE_PATHS: [...new Set([ownedRuntime.directory, ownedRuntime.home, ...trustedPaths])].join(";"),
        NODE_REPL_TRUSTED_SERVICES: JSON.stringify({ ...retainedServices, sky: "@oai/sky/service" }),
        CODEX_CLI_PATH: ownedRuntime.engine,
        CODEX_HOME: ownedRuntime.home,
      },
    };
  }
  for (const key of manifest.config.protectedRootKeys) {
    if (JSON.stringify(destination[key]) !== JSON.stringify(merged[key])) fail(`Protected Azrael config key changed: ${key}`);
  }
  return stringifyToml(merged);
}

function assignment(text, key) {
  function find(node) {
    if (Object.hasOwn(node, key)) return node[key];
    for (const value of Object.values(node)) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const found = find(value);
        if (found !== undefined) return found;
      }
    }
  }
  return find(parseToml(text)) ?? null;
}

function replaceAssignment(text, key, value) {
  const expression = new RegExp(`^(\\s*${regexEscape(key)}\\s*=\\s*).+?$`, "m");
  if (!expression.test(text)) fail(`Required config assignment is missing: ${key}`);
  return text.replace(expression, (_, prefix) => prefix + quoteToml(value));
}

function directoryHash(directory) {
  const records = [];
  function visit(current, relative) {
    const entries = fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      const rel = path.posix.join(relative, entry.name);
      if (entry.isSymbolicLink()) records.push(`L\0${rel}\0${fs.readlinkSync(full)}\n`);
      else if (entry.isDirectory()) visit(full, rel);
      else if (entry.isFile()) records.push(`F\0${rel}\0${fs.statSync(full).size}\0${fileHash(full)}\n`);
    }
  }
  visit(directory, "");
  return sha256(records.join(""));
}

function pathState(target) {
  const stat = fs.lstatSync(target, { throwIfNoEntry: false });
  if (!stat) return { exists: false, sha256: null };
  if (stat.isSymbolicLink()) return { exists: true, kind: "link", sha256: sha256(fs.readlinkSync(target)) };
  return { exists: true, kind: stat.isDirectory() ? "directory" : "file", sha256: stat.isDirectory() ? directoryHash(target) : fileHash(target) };
}

function assertUnchanged(states) {
  for (const [target, before] of states) {
    if (JSON.stringify(pathState(target)) !== JSON.stringify(before)) fail(`Concurrent change detected; retry snapshot: ${target}`);
  }
}

function assertManagedTarget(target, stateRoot) {
  const relative = path.relative(stateRoot, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) fail(`Managed target escapes Azrael state: ${target}`);
  // The target itself may be a skill junction; its parents may not redirect writes.
  if (!isWithin(path.dirname(target), stateRoot)) fail(`Managed target parent escapes Azrael state: ${target}`);
}

function copyDirectory(source, destination) {
  const resolvedSource = fs.realpathSync.native(source);
  function validateLinks(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        const link = fs.readlinkSync(target);
        if (path.isAbsolute(link) || !isWithin(path.resolve(directory, link), resolvedSource)) fail(`Snapshot payload has a nonportable link: ${target}`);
      } else if (entry.isDirectory()) validateLinks(target);
    }
  }
  validateLinks(resolvedSource);
  fs.cpSync(resolvedSource, destination, { recursive: true, force: true, dereference: false, verbatimSymlinks: true });
}

function assertFile(target, label) {
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) fail(`Missing ${label}: ${target}`);
}

function assertDirectory(target, label) {
  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) fail(`Missing ${label}: ${target}`);
}

function instructionBody(text) {
  const body = parseToml(text).developer_instructions;
  if (typeof body !== "string") fail("sol_executor does not define developer_instructions.");
  return body;
}

function generatedRole(sourceText, role) {
  const body = instructionBody(sourceText);
  const header = [
    `name = ${JSON.stringify(role.name)}`,
    `description = ${JSON.stringify(role.description)}`,
    `model = ${JSON.stringify(role.model)}`,
  ];
  if (role.modelReasoningEffort) header.push(`model_reasoning_effort = ${JSON.stringify(role.modelReasoningEffort)}`);
  return [...header, "", `developer_instructions = ${quoteToml(body)}`, ""].join("\n");
}

function run(executable, args, options, label) {
  const result = spawnSync(executable, args, { encoding: "utf8", windowsHide: true, ...options });
  if (result.error || result.status !== 0) {
    const detail = (result.stderr || result.stdout || result.error?.message || "unknown failure").trim();
    fail(`${label} failed (exit ${result.status ?? "spawn"}): ${detail}`);
  }
  return result.stdout.trim();
}

function configSections(text, prefix) {
  return splitToml(text).sections.filter((section) => section.name.startsWith(prefix));
}

function enabledPlugins(configText) {
  return Object.entries(parseToml(configText).plugins || {}).filter(([, value]) => value.enabled === true).map(([name]) => {
    if (!/^[A-Za-z0-9_-]+@[A-Za-z0-9_-]+$/.test(name)) fail(`Unsupported plugin selector: ${name}`);
    return name;
  }).sort();
}

function marketplaceSources(configText) {
  const values = new Map();
  for (const [name, value] of Object.entries(parseToml(configText).marketplaces || {})) {
    if (!/^[A-Za-z0-9_-]+$/.test(name)) fail(`Unsupported marketplace name: ${name}`);
    values.set(name, value.source);
  }
  return values;
}

function localMarketplacePath(home, name) {
  return name === "openai-bundled"
    ? path.join(home, ".tmp", "bundled-marketplaces", name)
    : path.join(home, "azrael", "codex-environment", "marketplaces", name);
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const sourceHome = path.resolve(args["source-home"] || path.join(os.homedir(), ".codex"));
  const stateRoot = path.resolve(args["state-root"] || path.join(os.homedir(), ".azrael-ex"));
  const sharedSkills = path.resolve(args["shared-skills"] || path.join(os.homedir(), ".agents", "skills"));
  const engine = path.resolve(args.engine || fail("--engine is required."));
  const manifestPath = path.resolve(args.manifest || path.join(__dirname, "azrael-codex-environment.json"));
  const computerUseDirectory = args["computer-use-directory"] ? path.resolve(args["computer-use-directory"]) : null;
  const ownedSourceStates = new Map();
  if (computerUseDirectory) {
    for (const target of [computerUseDirectory, ...["manifest.json", "node_repl.exe", "node.exe"].map((name) => path.join(computerUseDirectory, name))]) {
      ownedSourceStates.set(target, pathState(target));
    }
    require("./computer-use-runtime.cjs").verifyRuntime(computerUseDirectory);
    assertUnchanged(ownedSourceStates);
  }
  if (isWithin(stateRoot, sourceHome) || isWithin(sourceHome, stateRoot)) fail("Azrael and ordinary Codex state must not overlap, including filesystem aliases.");
  if (!["apply", "validate"].includes(args.mode || "apply")) fail("--mode must be apply or validate.");
  assertFile(engine, "Azrael engine");
  assertFile(path.join(sourceHome, "config.toml"), "ordinary Codex config");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.schema !== 1) fail("Unsupported Codex environment manifest schema.");
  if (computerUseDirectory && manifest.personalSkills.some((skill) => skill.name === "computer-use")) fail("Computer Use skill has conflicting snapshot ownership.");
  const copyGlobalInstructions = manifest.copyGlobalInstructions !== false;
  for (const name of [...manifest.agentRoles, ...manifest.generatedAgentRoles.map((role) => role.name), ...manifest.personalSkills.map((skill) => skill.name)]) {
    if (!/^[A-Za-z0-9_-]+$/.test(name)) fail(`Invalid managed name: ${name}`);
  }

  const initialSourceConfigState = pathState(path.join(sourceHome, "config.toml"));
  const initialDestinationConfigState = pathState(path.join(stateRoot, "config.toml"));
  const sourceConfig = stringifyToml(parseToml(fs.readFileSync(path.join(sourceHome, "config.toml"), "utf8")));
  const destinationConfig = fs.existsSync(path.join(stateRoot, "config.toml"))
    ? fs.readFileSync(path.join(stateRoot, "config.toml"), "utf8")
    : "";
  const sourceMarketplaces = marketplaceSources(sourceConfig);
  const receiptPath = path.join(stateRoot, "azrael", "codex-environment", "snapshot.json");
  const managedTargets = [
    path.join(stateRoot, "config.toml"),
    ...(copyGlobalInstructions ? [path.join(stateRoot, "AGENTS.md")] : []),
    ...[...manifest.agentRoles, ...manifest.generatedAgentRoles.map((role) => role.name)].map((name) => path.join(stateRoot, "agents", `${name}.toml`)),
    ...manifest.personalSkills.map((skill) => path.join(stateRoot, "skills", skill.name)),
    ...(computerUseDirectory ? [path.join(stateRoot, "skills", "computer-use")] : []),
    ...[...sourceMarketplaces.keys()].map((name) => localMarketplacePath(stateRoot, name)),
    ...enabledPlugins(sourceConfig).map((plugin) => { const [name, marketplace] = plugin.split("@"); return path.join(stateRoot, "plugins", "cache", marketplace, name); }),
    receiptPath,
  ];
  for (const target of managedTargets) assertManagedTarget(target, stateRoot);
  const destinationStates = new Map(managedTargets.map((target) => [target, pathState(target)]));
  destinationStates.set(path.join(stateRoot, "config.toml"), initialDestinationConfigState);
  const sourceStates = new Map([path.join(sourceHome, "config.toml"), manifestPath,
    ...(copyGlobalInstructions ? [path.join(sourceHome, "AGENTS.md")] : []),
    ...manifest.agentRoles.map((name) => path.join(sourceHome, "agents", `${name}.toml`)),
  ].map((target) => [target, pathState(target)]));
  sourceStates.set(path.join(sourceHome, "config.toml"), initialSourceConfigState);
  for (const [target, state] of ownedSourceStates) sourceStates.set(target, state);
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), "azrael-codex-environment-"));
  const stageHome = path.join(stage, "home");
  fs.mkdirSync(stageHome, { recursive: true });
  const sourceHomeVariants = [sourceHome, sourceHome.replaceAll("\\", "/")];
  const finalReplacements = [[sourceHomeVariants[0], stateRoot], [sourceHomeVariants[1], stateRoot.replaceAll("\\", "/")]];
  const stageReplacements = [[sourceHomeVariants[0], stageHome], [sourceHomeVariants[1], stageHome.replaceAll("\\", "/")]];
  const runtimeEvidence = {};
  const warnings = [];
  let backupDirectory = null;
  let commitLock = null;
  try {
    for (const [name, source] of sourceMarketplaces) {
      assertDirectory(source, `marketplace ${name}`);
      sourceStates.set(source, pathState(source));
      runtimeEvidence[`marketplace:${name}`] = { path: source, sha256: directoryHash(source) };
      copyDirectory(source, localMarketplacePath(stageHome, name));
    }

    let stageConfig = selectedConfig(sourceConfig, destinationConfig, manifest, stageReplacements,
      computerUseDirectory ? { directory: computerUseDirectory, home: stageHome, engine } : null);
    let finalConfig = selectedConfig(sourceConfig, destinationConfig, manifest, finalReplacements,
      computerUseDirectory ? { directory: computerUseDirectory, home: stateRoot, engine } : null);
    for (const name of sourceMarketplaces.keys()) {
      const stageMarketplace = localMarketplacePath(stageHome, name);
      const finalMarketplace = localMarketplacePath(stateRoot, name);
      const stageSection = splitToml(stageConfig).sections.find((section) => section.name === `marketplaces.${name}`);
      const finalSection = splitToml(finalConfig).sections.find((section) => section.name === `marketplaces.${name}`);
      stageConfig = stageConfig.replace(stageSection.lines.join("\n"), replaceAssignment(stageSection.lines.join("\n"), "source", stageMarketplace));
      finalConfig = finalConfig.replace(finalSection.lines.join("\n"), replaceAssignment(finalSection.lines.join("\n"), "source", finalMarketplace));
    }
    stageConfig = replaceAssignment(stageConfig, "CODEX_CLI_PATH", engine);
    finalConfig = replaceAssignment(finalConfig, "CODEX_CLI_PATH", engine);
    fs.writeFileSync(path.join(stageHome, "config.toml"), stageConfig, "utf8");

    const agentsDirectory = path.join(stageHome, "agents");
    fs.mkdirSync(agentsDirectory, { recursive: true });
    const roleHashes = {};
    for (const roleName of manifest.agentRoles) {
      const source = path.join(sourceHome, "agents", `${roleName}.toml`);
      assertFile(source, `agent role ${roleName}`);
      const contents = fs.readFileSync(source, "utf8");
      fs.writeFileSync(path.join(agentsDirectory, `${roleName}.toml`), contents, "utf8");
      roleHashes[roleName] = fileHash(source);
    }
    for (const role of manifest.generatedAgentRoles) {
      if (!manifest.agentRoles.includes(role.source)) fail(`Generated role source is not managed: ${role.source}`);
      const solText = fs.readFileSync(path.join(sourceHome, "agents", `${role.source}.toml`), "utf8");
      const contents = generatedRole(solText, role);
      if (instructionBody(contents) !== instructionBody(solText)) fail(`${role.name} developer instructions differ from sol_executor.`);
      fs.writeFileSync(path.join(agentsDirectory, `${role.name}.toml`), contents, "utf8");
      roleHashes[role.name] = sha256(contents);
    }
    const agentsSource = path.join(sourceHome, "AGENTS.md");
    if (copyGlobalInstructions) {
      assertFile(agentsSource, "global AGENTS.md");
      fs.copyFileSync(agentsSource, path.join(stageHome, "AGENTS.md"));
    }

    const skillsDirectory = path.join(stageHome, "skills");
    fs.mkdirSync(skillsDirectory, { recursive: true });
    const skillHashes = {};
    const computerUseFiles = new Map();
    if (computerUseDirectory) {
      const skillDirectory = path.join(skillsDirectory, "computer-use");
      copyDirectory(path.join(computerUseDirectory, "skills", "computer-use"), skillDirectory);
      copyDirectory(path.join(computerUseDirectory, "docs"), path.join(skillDirectory, "docs"));
      const instructions = path.join(skillDirectory, "SKILL.md");
      const visibleDesktopNote = "## Azrael visible desktop requirement\n\n" +
        "Activate the exact selected target window and obtain a fresh observation before capture or input. " +
        "Verify foreground focus before typing and verify that each returned screenshot shows the selected target's content. " +
        "Discard unexpected screenshot content and pause if physical user activity or an unexpected other foreground window is observed. " +
        "Do not repeatedly steal focus. Capture of occluded windows is not an established capability of this integration.\n\n";
      const adaptCaptureClaim = (text) => text.replaceAll("screenshots that work even when windows are occluded", "screenshots subject to the Azrael visible desktop requirement");
      let skillText = adaptCaptureClaim(fs.readFileSync(instructions, "utf8")).replaceAll("../../docs", "./docs");
      const frontmatter = skillText.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)?.[0] || "";
      skillText = frontmatter + "\n" + visibleDesktopNote + skillText.slice(frontmatter.length);
      fs.writeFileSync(instructions, skillText, "utf8");
      for (const name of fs.readdirSync(path.join(skillDirectory, "docs"))) {
        if (!name.endsWith(".md")) continue;
        const target = path.join(skillDirectory, "docs", name);
        const text = adaptCaptureClaim(fs.readFileSync(target, "utf8"));
        fs.writeFileSync(target, (name === "guidance.md" ? visibleDesktopNote : "") + text, "utf8");
      }
      function collect(directory) {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
          const target = path.join(directory, entry.name);
          if (entry.isDirectory()) collect(target);
          else if (entry.isFile()) computerUseFiles.set(path.join(stateRoot, "skills", "computer-use", path.relative(skillDirectory, target)), fs.readFileSync(target));
          else fail(`Computer Use instructions must be regular files: ${target}`);
        }
      }
      collect(skillDirectory);
      skillHashes["computer-use"] = directoryHash(skillDirectory);
      runtimeEvidence.computerUse = { path: computerUseDirectory, sha256: ownedSourceStates.get(computerUseDirectory).sha256,
        manifestSha256: fileHash(path.join(computerUseDirectory, "manifest.json")) };
    }
    for (const skill of manifest.personalSkills) {
      const source = skill.source === "shared" ? path.join(sharedSkills, skill.name) : path.join(sourceHome, "skills", skill.name);
      assertDirectory(source, `personal skill ${skill.name}`);
      sourceStates.set(source, pathState(source));
      const resolved = fs.realpathSync.native(source);
      sourceStates.set(resolved, pathState(resolved));
      if (skill.source === "shared" && !/^[GH]:\\/i.test(resolved)) fail(`Shared skill is not on a configured Google Drive mount: ${source} -> ${resolved}`);
      if (skill.source === "shared") {
        const resolver = path.join(sourceHome, "skills", "google-drive-desktop-files", "scripts", "resolve_google_drive_path.ps1");
        assertFile(resolver, "Google Drive account resolver");
        run("pwsh", ["-NoProfile", "-File", resolver, "-Account", manifest.sharedSkillsAccount, "-InputPath", resolved, "-ExpectedKind", "Directory"], {}, `Drive account verification for ${skill.name}`);
      }
      assertFile(path.join(resolved, "SKILL.md"), `skill instructions ${skill.name}`);
      const skillText = fs.readFileSync(path.join(resolved, "SKILL.md"), "utf8");
      const frontmatter = skillText.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      const hasNonemptyField = (key) => {
        const value = frontmatter?.[1].match(new RegExp(`^${key}:[ \\t]*(.*)$`, "m"))?.[1].trim();
        return value && !/^(?:""|'')[ \\t]*(?:#.*)?$/.test(value);
      };
      if (!hasNonemptyField("description") || !hasNonemptyField("name")) {
        warnings.push(`Source skill ${skill.name} has missing name/description frontmatter; copied unchanged, native availability is not established.`);
      }
      skillHashes[skill.name] = sourceStates.get(resolved).sha256;
      if (skill.source === "shared") fs.symlinkSync(resolved, path.join(skillsDirectory, skill.name), "junction");
      else copyDirectory(resolved, path.join(skillsDirectory, skill.name));
    }

    for (const [label, target] of [
      ["notify", assignment(sourceConfig, "notify")?.[0]],
      ...(computerUseDirectory ? [] : [
        ["node_repl command", assignment(configSections(sourceConfig, "mcp_servers.node_repl")[0].lines.join("\n"), "command")],
        ["node runtime", assignment(configSections(sourceConfig, "mcp_servers.node_repl.env")[0].lines.join("\n"), "NODE_REPL_NODE_PATH")],
      ]),
    ]) {
      assertFile(target, label);
      runtimeEvidence[label] = { path: target, sha256: fileHash(target) };
      sourceStates.set(target, pathState(target));
    }
    runtimeEvidence.engine = { path: engine, sha256: fileHash(engine) };
    sourceStates.set(engine, pathState(engine));

    const env = { ...process.env, CODEX_HOME: stageHome };
    run(engine, ["features", "list"], { env }, "staged strict config load");
    const pluginResults = [];
    for (const plugin of enabledPlugins(sourceConfig)) {
      let result;
      try {
        result = run(engine, ["plugin", "add", plugin, "--json"], { env }, `plugin materialization ${plugin}`);
      } catch (error) {
        const inventory = spawnSync(engine, ["plugin", "list", "--available", "--json"], { env, encoding: "utf8", windowsHide: true });
        fail(`${error.message}; staged marketplace inventory: ${(inventory.stdout || inventory.stderr || "<empty>").trim()}`);
      }
      pluginResults.push({ plugin, result: JSON.parse(result) });
    }
    const stagedNodeEnvironment = configSections(stageConfig, "mcp_servers.node_repl.env")[0]?.lines.join("\n");
    if (!stagedNodeEnvironment) fail("Staged node_repl environment is missing.");
    for (const directory of (assignment(stagedNodeEnvironment, "NODE_REPL_NODE_MODULE_DIRS") || "").split(";").filter(Boolean)) {
      assertDirectory(directory, "node_repl module directory");
    }
    for (const directory of (assignment(stagedNodeEnvironment, "NODE_REPL_TRUSTED_CODE_PATHS") || "").split(";").filter(Boolean)) {
      assertDirectory(directory, "node_repl trusted code path");
    }
    const trustedServices = JSON.parse(assignment(stagedNodeEnvironment, "NODE_REPL_TRUSTED_SERVICES"));
    for (const [service, target] of Object.entries(trustedServices)) {
      if (path.isAbsolute(target)) assertFile(target, `node_repl trusted service ${service}`);
    }
    if (!computerUseDirectory) {
      const nativePipe = assignment(stagedNodeEnvironment, "SKY_CUA_NATIVE_PIPE_DIRECTORY");
      if (!/^\\\\\.\\pipe\\[A-Za-z0-9._-]+$/.test(nativePipe || "")) fail("Invalid native computer-use pipe name.");
      runtimeEvidence.nativeComputerUsePipe = { path: nativePipe, kind: "ephemeral-external-runtime-endpoint" };
    }

    const fingerprint = sha256(JSON.stringify({
      manifest: fileHash(manifestPath), config: sha256(sourceConfig), agents: roleHashes,
      globalInstructions: copyGlobalInstructions ? fileHash(agentsSource) : null, skills: skillHashes, runtimes: runtimeEvidence,
    }));
    const existingReceipt = fs.existsSync(receiptPath) ? JSON.parse(fs.readFileSync(receiptPath, "utf8")) : null;
    const expectedFiles = new Map([
      [path.join(stateRoot, "config.toml"), finalConfig],
      ...(copyGlobalInstructions ? [[path.join(stateRoot, "AGENTS.md"), fs.readFileSync(path.join(stageHome, "AGENTS.md"))]] : []),
      ...fs.readdirSync(agentsDirectory).map((name) => [path.join(stateRoot, "agents", name), fs.readFileSync(path.join(agentsDirectory, name))]),
      ...computerUseFiles,
    ]);
    const mismatchedFiles = [...expectedFiles]
      .filter(([target, contents]) => !fs.existsSync(target) || sha256(fs.readFileSync(target)) !== sha256(contents))
      .map(([target]) => target);
    assertUnchanged(sourceStates);
    assertUnchanged(destinationStates);
    if (args.mode === "validate") {
      process.stdout.write(JSON.stringify({ status: "validated", fingerprint, stateRoot, applied: false, warnings }) + "\n");
      return;
    }
    const artifactsUnchanged = existingReceipt?.managedStates && [...destinationStates].every(([target, state]) =>
      target === receiptPath || JSON.stringify(state) === JSON.stringify(existingReceipt.managedStates[path.relative(stateRoot, target)]));
    if (existingReceipt?.fingerprint === fingerprint && mismatchedFiles.length === 0 && artifactsUnchanged) {
      process.stdout.write(JSON.stringify({ status: "unchanged", receipt: receiptPath, fingerprint, warnings }) + "\n");
      return;
    }

    const lockPath = path.join(stateRoot, "azrael", "codex-environment.lock");
    assertManagedTarget(lockPath, stateRoot);
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    const lockDescriptor = fs.openSync(lockPath, "wx");
    fs.closeSync(lockDescriptor);
    commitLock = lockPath;
    assertUnchanged(sourceStates);
    assertUnchanged(destinationStates);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-") + "-" + crypto.randomBytes(4).toString("hex");
    backupDirectory = path.join(stateRoot, "azrael", "codex-environment-backups", timestamp);
    fs.mkdirSync(backupDirectory, { recursive: true });
    fs.writeFileSync(path.join(backupDirectory, "recovery.json"), JSON.stringify({
      stateRoot, status: "commit-started", targets: managedTargets.map((target) => ({
        target, before: destinationStates.get(target), backup: path.join(backupDirectory, "previous", path.relative(stateRoot, target)),
      })),
    }, null, 2));
    const backups = [];
    try {
      for (const target of managedTargets) {
        assertManagedTarget(target, stateRoot);
        assertUnchanged(new Map([[target, destinationStates.get(target)]]));
        if (!fs.lstatSync(target, { throwIfNoEntry: false })) { backups.push({ target, existed: false }); continue; }
        const relative = path.relative(stateRoot, target);
        const backup = path.join(backupDirectory, "previous", relative);
        fs.mkdirSync(path.dirname(backup), { recursive: true });
        fs.renameSync(target, backup);
        backups.push({ target, existed: true, backup });
      }
      for (const [target, contents] of expectedFiles) {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        const temporary = `${target}.snapshot-${crypto.randomBytes(6).toString("hex")}`;
        fs.writeFileSync(temporary, contents);
        fs.renameSync(temporary, target);
      }
      for (const skill of manifest.personalSkills) {
        const from = path.join(skillsDirectory, skill.name);
        const target = path.join(stateRoot, "skills", skill.name);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        if (skill.source === "shared") fs.symlinkSync(fs.readlinkSync(from), target, "junction");
        else copyDirectory(from, target);
      }
      for (const name of sourceMarketplaces.keys()) {
        const from = localMarketplacePath(stageHome, name);
        if (!fs.existsSync(from)) continue;
        const target = localMarketplacePath(stateRoot, name);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        copyDirectory(from, target);
      }
      for (const plugin of enabledPlugins(sourceConfig)) {
        const [name, marketplace] = plugin.split("@");
        const from = path.join(stageHome, "plugins", "cache", marketplace, name);
        assertDirectory(from, `materialized plugin ${plugin}`);
        const target = path.join(stateRoot, "plugins", "cache", marketplace, name);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        copyDirectory(from, target);
      }
      const receipt = {
        schema: 1, status: "applied", createdAt: new Date().toISOString(), fingerprint, warnings,
        sourceHome, stateRoot, backupDirectory, roleHashes, skillHashes, runtimeEvidence,
        pluginResults, oauthImported: false, protectedConfig: manifest.config.protectedRootKeys,
        mismatchedFilesBeforeApply: mismatchedFiles,
        managedStates: Object.fromEntries(managedTargets.filter((target) => target !== receiptPath).map((target) => [path.relative(stateRoot, target), pathState(target)])),
      };
      fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
      fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + "\n", "utf8");
      run(engine, ["features", "list"], { env: { ...process.env, CODEX_HOME: stateRoot } }, "committed config load");
      process.stdout.write(JSON.stringify({ status: "applied", receipt: receiptPath, backup: backupDirectory, fingerprint, warnings }) + "\n");
    } catch (error) {
      for (const item of backups.reverse()) {
        if (fs.lstatSync(item.target, { throwIfNoEntry: false })) fs.rmSync(item.target, { recursive: true, force: true });
        if (item.existed) {
          fs.mkdirSync(path.dirname(item.target), { recursive: true });
          fs.renameSync(item.backup, item.target);
        }
      }
      throw error;
    }
  } finally {
    if (commitLock) fs.unlinkSync(commitLock);
    if (args["keep-stage"] === "true") process.stderr.write(`Retained staging directory: ${stage}\n`);
    else fs.rmSync(stage, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try { main(); } catch (error) { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; }
}

module.exports = { assertManagedTarget, assertUnchanged, assignment, directoryHash, enabledPlugins, generatedRole, instructionBody, marketplaceSources, parseToml, pathState, replaceAssignment, selectedConfig, splitToml, stringifyToml, assertDirectory, assertFile, copyDirectory, fail, fileHash, isWithin, parseArgs, run, sha256 };
