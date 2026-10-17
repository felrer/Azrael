"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
function samePath(left, right) {
  const canonical = value => {
    let result = fs.realpathSync.native(value).replace(/^\\\\\?\\/, "");
    return process.platform === "win32" ? result.toLowerCase() : result;
  };
  return canonical(left) === canonical(right);
}
function within(candidate, root) {
  const relative = path.relative(fs.realpathSync.native(root), fs.realpathSync.native(candidate));
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}
function command(engine, prefix, args, env, timeout) {
  const result = spawnSync(engine, [...prefix, ...args], { env, encoding: "utf8", windowsHide: true,
    timeout, maxBuffer: 4 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw Error(`Selected engine ${args.join(" ")} failed: ${result.error?.message || result.stderr || result.stdout || result.status}`);
  return result.stdout;
}

// Capability selection happens before validation. A failed native check never
// selects a different executable or falls back to CLI validation.
function engineKind(engine, { env = process.env, prefix = [], timeoutMs = 30_000 } = {}) {
  const help = command(engine, prefix, ["--help"], env, timeoutMs);
  if (/^\s*Commands:\s*$/m.test(help) && /^\s+app-server\b/m.test(help) && /^\s+plugin\b/m.test(help)) return "cli";
  if (/--strict-config\b/.test(help) && /--listen\b/.test(help)) return "app-server";
  throw Error("Selected engine does not advertise a supported app-server or CLI capability");
}

async function withServer(engine, home, options, body) {
  const { JsonLinePeer, captureStderr, waitForExit } = await import("./azrael-rpc-check.mjs");
  const { kind, env = process.env, prefix = [], timeoutMs = 30_000, exitTimeoutMs = 3_000 } = options;
  const isolatedEnv = { ...env, CODEX_HOME: home };
  // This opt-in rendezvous belongs to the running desktop host, never to a
  // short-lived configuration validator (the native test harness removes it too).
  delete isolatedEnv.AZRAEL_EX_MANAGEMENT_SOCKET;
  delete isolatedEnv.AZRAEL_EX_WINDOW_CONTEXT;
  const child = spawn(engine, [...prefix, ...(kind === "cli" ? ["app-server"] : []), "--strict-config", "--listen", "stdio://"], {
    cwd: home, env: isolatedEnv, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
  });
  const peer = new JsonLinePeer(child, "environment engine");
  const stderr = captureStderr(child);
  let bytes = 0, protocolFailure, deadline;
  let rejectFailure;
  const failure = new Promise((_, reject) => { rejectFailure = reject; });
  // Keep the rejection handled during teardown as well as during each request.
  failure.catch(() => {});
  const fail = error => { protocolFailure ||= error; rejectFailure(protocolFailure); };
  child.stdin.on("error", error => fail(error));
  child.stdout.on("data", chunk => {
    bytes += chunk.length;
    if (bytes > 8 * 1024 * 1024) fail(Error("Environment engine response limit exceeded"));
  });
  peer.lines.on("line", line => {
    try {
      const message = JSON.parse(line);
      if (!object(message)) throw Error("Invalid native protocol message");
      if (message.method === "configWarning") throw Error(`Native configWarning: ${JSON.stringify(message.params)}`);
      if (message.method && Object.hasOwn(message, "id")) throw Error(`Unexpected server request: ${message.method}`);
    } catch (error) { fail(error); }
  });
  const request = async (method, params) => {
    if (protocolFailure) throw protocolFailure;
    return Promise.race([peer.request(method, params), failure]);
  };
  let result, error;
  deadline = setTimeout(() => fail(Error("Environment engine overall timeout")), timeoutMs);
  try {
    const initialized = await request("initialize", { clientInfo: { name: "azrael_environment_snapshot", version: "1" }, capabilities: { experimentalApi: true } });
    if (!object(initialized) || typeof initialized.codexHome !== "string" || !samePath(initialized.codexHome, home)) throw Error("Native engine CODEX_HOME identity mismatch");
    peer.notify("initialized");
    result = await body(request);
  } catch (caught) { error = caught; }
  finally {
    clearTimeout(deadline);
    child.stdin.end();
    try {
      const exit = await waitForExit(child, "environment engine", exitTimeoutMs);
      if (exit.code !== 0 || exit.signal) error ||= Error(`Environment engine exited ${exit.code ?? exit.signal}`);
    } catch {
      child.kill();
      try { await waitForExit(child, "terminated environment engine", exitTimeoutMs); }
      catch (caught) { error = Error(`Environment engine cleanup uncertain (pid ${child.pid}): ${caught.message}`); }
      error ||= Error("Environment engine did not exit after stdin closed");
    }
    // exit precedes the final stdout close event; consume all warnings before accepting.
    if (!child.stdout.readableEnded) {
      try {
        await Promise.race([new Promise(resolve => child.stdout.once("end", resolve)),
          new Promise((_, reject) => { const timer = setTimeout(() => reject(Error("Environment engine stdout close timeout")), exitTimeoutMs); timer.unref(); })]);
      } catch (caught) { error ||= caught; }
    }
    peer.close();
  }
  if (protocolFailure) error ||= protocolFailure;
  if (error) throw Error(`${error.message}${stderr() ? `\n${stderr()}` : ""}`);
  return result;
}

async function inspect(engine, home, options, plugins = false) {
  return withServer(engine, home, options, async request => {
    const config = await request("config/read", { includeLayers: true });
    if (!object(config?.config) || !Array.isArray(config.layers)) throw Error("Native config/read returned an invalid typed configuration");
    const expectedFile = path.join(home, "config.toml");
    const userLayers = config.layers.filter(layer => layer.name?.type === "user");
    if (userLayers.length !== 1 || userLayers[0].disabledReason || !samePath(userLayers[0].name.file, expectedFile)) throw Error("Native config/read did not load the expected user configuration layer");
    const features = [], cursors = new Set();
    let cursor;
    do {
      const page = await request("experimentalFeature/list", cursor ? { cursor } : {});
      if (!Array.isArray(page?.data) || page.data.some(feature => typeof feature.name !== "string" || typeof feature.enabled !== "boolean")) throw Error("Invalid native feature inventory");
      features.push(...page.data);
      cursor = page.nextCursor;
      if (cursor != null && (typeof cursor !== "string" || !cursor || cursors.has(cursor))) throw Error("Invalid native feature inventory cursor");
      if (cursor) cursors.add(cursor);
      if (cursors.size > 100) throw Error("Native feature inventory page limit exceeded");
    } while (cursor);
    const inventory = plugins ? await request("plugin/list", { marketplaceKinds: ["local"], forceRefetch: false }) : null;
    if (plugins && (!Array.isArray(inventory?.marketplaces) || !Array.isArray(inventory.marketplaceLoadErrors) || inventory.marketplaceLoadErrors.length)) throw Error(`Native local marketplace inventory failed: ${JSON.stringify(inventory)}`);
    return { features, inventory };
  });
}

function localPlans(home, selectors, marketplaces, inventory, helpers) {
  const plans = [];
  for (const selector of selectors) {
    if (!/^[A-Za-z0-9_-]+@[A-Za-z0-9_-]+$/.test(selector)) throw Error(`Unsupported plugin selector: ${selector}`);
    const [name, marketplace] = selector.split("@");
    if (["openai-curated", "openai-api-curated"].includes(marketplace)) throw Error(`Unsupported curated version materialization: ${selector}`);
    const root = marketplaces.get(marketplace);
    if (!root) throw Error(`Missing configured local marketplace: ${marketplace}`);
    const marketFile = path.join(root, ".agents", "plugins", "marketplace.json");
    const manifest = JSON.parse(fs.readFileSync(marketFile, "utf8"));
    if (manifest.name !== marketplace || !Array.isArray(manifest.plugins)) throw Error(`Marketplace identity mismatch: ${marketplace}`);
    // Native listing filters through MarketplacePolicy.validate_install. An
    // absent/duplicate marketplace cannot prove that installation is permitted.
    const nativeMarkets = inventory.marketplaces.filter(item => item.name === marketplace);
    if (nativeMarkets.length !== 1 || !nativeMarkets[0].path || ![root, marketFile].some(target => samePath(nativeMarkets[0].path, target))) throw Error(`Native marketplace policy/path proof missing: ${marketplace}`);
    const entries = manifest.plugins.filter(item => item.name === name);
    const nativeEntries = nativeMarkets[0].plugins.filter(item => item.name === name && item.id === selector);
    if (entries.length !== 1 || nativeEntries.length !== 1) throw Error(`Plugin identity missing or ambiguous: ${selector}`);
    const entry = entries[0], native = nativeEntries[0];
    if (Object.keys(entry).some(key => !["name", "source", "policy", "category", "interface"].includes(key)) ||
        Object.keys(entry.source || {}).some(key => !["source", "path"].includes(key)) ||
        Object.keys(entry.policy || {}).some(key => !["installation", "authentication"].includes(key))) throw Error(`Unsupported marketplace plugin metadata: ${selector}`);
    if (entry.source?.source !== "local" || native.source?.type !== "local") throw Error(`Unsupported non-local plugin materialization: ${selector}`);
    if (entry.policy?.installation !== "AVAILABLE" || native.installPolicy !== "AVAILABLE" || native.availability !== "AVAILABLE" || native.disabledReason != null || native.enabled !== true) throw Error(`Plugin installation policy/enablement rejected: ${selector}`);
    if (typeof entry.source.path !== "string" || path.isAbsolute(entry.source.path) || path.win32.isAbsolute(entry.source.path)) throw Error(`Unsupported local plugin source path: ${selector}`);
    const source = path.resolve(root, entry.source.path);
    if (!within(source, root) || !samePath(native.source.path, source)) throw Error(`Local plugin source escapes or differs from native identity: ${selector}`);
    const pluginFile = path.join(source, ".codex-plugin", "plugin.json");
    const plugin = JSON.parse(fs.readFileSync(pluginFile, "utf8"));
    const supportedKeys = new Set(["name", "version", "description", "author", "homepage", "repository", "license", "keywords", "skills", "interface", "hooks", "mcpServers", "apps"]);
    if (Object.keys(plugin).some(key => !supportedKeys.has(key)) || fs.existsSync(path.join(source, "commands")) || fs.existsSync(path.join(source, ".claude-plugin")) || fs.existsSync(path.join(source, "plugin.json"))) throw Error(`Unsupported plugin metadata or command migration: ${selector}`);
    if (plugin.name !== name || typeof plugin.version !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(plugin.version) || native.localVersion !== plugin.version) throw Error(`Local plugin manifest/version identity mismatch: ${selector}`);
    const destination = path.join(home, "plugins", "cache", marketplace, name, plugin.version);
    if (fs.existsSync(path.dirname(destination))) throw Error(`Plugin cache destination must be fresh: ${selector}`);
    plans.push({ selector, name, marketplace, source, destination, version: plugin.version, sourceSha256: helpers.directoryHash(source) });
  }
  return plans;
}

async function createEnvironmentEngine(engine, options = {}) {
  const settings = { ...options, kind: engineKind(engine, options) };
  return {
    kind: settings.kind,
    validate: home => inspect(engine, home, settings),
    async materialize(home, selectors, marketplaces, helpers) {
      if (selectors.length === 0) return [];
      if (settings.kind === "cli") {
        return selectors.map(plugin => ({ plugin, result: JSON.parse(command(engine, settings.prefix || [], ["plugin", "add", plugin, "--json"], { ...(settings.env || process.env), CODEX_HOME: home }, settings.timeoutMs || 30_000)) }));
      }
      const before = await inspect(engine, home, settings, true);
      const plans = localPlans(home, selectors, marketplaces, before.inventory, helpers);
      for (const plan of plans) {
        helpers.copyDirectory(plan.source, plan.destination);
        if (helpers.directoryHash(plan.source) !== plan.sourceSha256 || helpers.directoryHash(plan.destination) !== plan.sourceSha256) throw Error(`Local plugin payload changed during materialization: ${plan.selector}`);
      }
      const after = await inspect(engine, home, settings, true);
      for (const plan of plans) {
        const markets = after.inventory.marketplaces.filter(item => item.name === plan.marketplace);
        const entries = markets.flatMap(item => item.plugins || []).filter(item => item.id === plan.selector);
        if (entries.length !== 1 || entries[0].installed !== true || entries[0].enabled !== true || entries[0].localVersion !== plan.version) throw Error(`Native installed plugin proof failed: ${plan.selector}`);
        if (helpers.directoryHash(plan.source) !== plan.sourceSha256 || helpers.directoryHash(plan.destination) !== plan.sourceSha256) throw Error(`Local plugin payload changed after native validation: ${plan.selector}`);
      }
      return plans.map(plan => ({ plugin: plan.selector, result: { mode: "verified-local-copy", version: plan.version, installedPath: plan.destination, sha256: plan.sourceSha256, nativePolicyVerified: true, nativeInstalledVerified: true } }));
    },
  };
}

module.exports = { createEnvironmentEngine, engineKind, inspect, localPlans };
