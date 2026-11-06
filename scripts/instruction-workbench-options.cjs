"use strict";

// Read-only account metadata and previously observed model catalogs. This module
// never opens credential stores, starts a daemon, refreshes models or runs inference.
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { readBundle } = require("./provider-accounts-host.cjs");
const { canonicalPath } = require("./platform-runtime.cjs");
const repository = path.resolve(__dirname, "..");
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const record = value => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value, limit = 4096) => typeof value === "string" && value.length > 0 && value.length <= limit && !/[\x00-\x1f]/.test(value);
const scope = (providerId, accountId) => "account-" + crypto.createHash("sha256").update(JSON.stringify([providerId, accountId])).digest("hex");
const loaded = new Map();

function existingModule(relative) {
  // Existing validators remain their owners. Compile the small trusted source
  // modules in memory, using the project's installed TypeScript, without dist output.
  const allowed = new Set(["extensions/azrael-ex/src/providerAccountService.ts", "extensions/azrael-ex/src/protocol.ts", "extensions/azrael-ex/src/optionalDiagnostics.ts", "providers/opencodex/reasoning.ts"]);
  if (!allowed.has(relative)) throw Error("Unapproved metadata validator");
  if (loaded.has(relative)) return loaded.get(relative);
  const file = path.join(repository, relative), ts = require(require.resolve("typescript", { paths: [path.join(repository, "extensions/azrael-ex")] }));
  const code = ts.transpileModule(fsSync.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} }; loaded.set(relative, module.exports);
  const localRequire = name => name.startsWith(".")
    ? existingModule(path.relative(repository, path.resolve(path.dirname(file), name + ".ts")).split(path.sep).join("/"))
    : require(name);
  new Function("module", "exports", "require", "__filename", "__dirname", code)(module, module.exports, localRequire, file, path.dirname(file));
  loaded.set(relative, module.exports); return module.exports;
}

async function safeFile(file, maximum) {
  if (!path.isAbsolute(file || "")) throw Error("Invalid metadata path");
  let current = path.parse(file).root;
  for (const part of file.slice(current.length).split(path.sep).filter(Boolean)) {
    if (part === "." || part === "..") throw Error("Invalid metadata path");
    current = path.join(current, part);
    if ((await fs.lstat(current)).isSymbolicLink()) throw Error("Linked metadata path");
  }
  const stat = await fs.stat(file);
  if (!stat.isFile() || stat.size > maximum) throw Error("Invalid metadata size");
  const data = await fs.readFile(file); if (data.length > maximum) throw Error("Invalid metadata size");
  return JSON.parse(data.toString("utf8"));
}
async function exists(file) { try { await fs.lstat(file); return true; } catch (e) { if (e.code === "ENOENT") return false; throw e; } }

async function nativeAccounts(home, options, env) {
  // Match azrael_state.rs selection precedence. Selection is metadata, not proof
  // of a token's current validity; retirement/reauth markers remain authoritative.
  const configured = options.accountStateFile ?? env.AZRAEL_EX_ACCOUNT_STATE_FILE;
  const defaultFile = options.accountDefaultFile ?? env.AZRAEL_EX_ACCOUNT_DEFAULT_FILE;
  let selected = null;
  const selectionPath = configured && await exists(configured) ? configured
    : defaultFile && await exists(defaultFile) ? defaultFile : path.join(home, "azrael/account-state.json");
  try {
    const selection = await safeFile(selectionPath, 65536);
    if (!record(selection) || !own(selection, "selectedProfileId") || selection.selectedProfileId !== null && !/^[a-f0-9]{32}$/.test(selection.selectedProfileId) || selection.requiresRecovery !== undefined && typeof selection.requiresRecovery !== "boolean") throw Error("Invalid account selection");
    // Recovery blocks use of the selected account, not read-only discovery of
    // other connected accounts. Never choose a replacement account here.
    selected = selection.requiresRecovery === true ? null : selection.selectedProfileId;
  } catch (e) { if (e.code !== "ENOENT") throw e; }
  const root = options.openaiProfilesRoot || path.join(home, "azrael/accounts");
  let entries; try { entries = await fs.readdir(root, { withFileTypes: true }); } catch (e) { if (e.code === "ENOENT") return []; throw e; }
  if (entries.length > 2000) throw Error("Account metadata limit");
  const accounts = [];
  for (const item of entries) {
    if (!item.isDirectory() || !/^[a-f0-9]{32}$/.test(item.name)) continue;
    const directory = path.join(root, item.name);
    if (await exists(path.join(directory, "removed.v1")) || await exists(path.join(directory, "reauth.v1"))) continue;
    let metadata; try { metadata = await safeFile(path.join(directory, "profile.json"), 65536); } catch (e) { if (e.code === "ENOENT") continue; throw e; }
    const fields = ["id", "email", "workspaceAccountId", "userId", "planType", "autoSwitchAllowed"];
    if (!record(metadata) || Object.keys(metadata).some(k => !fields.includes(k)) || metadata.id !== item.name || !text(metadata.workspaceAccountId) || !text(metadata.userId) || metadata.email !== null && !text(metadata.email) || metadata.planType !== null && !text(metadata.planType) || metadata.autoSwitchAllowed !== undefined && typeof metadata.autoSwitchAllowed !== "boolean") throw Error("Invalid profile metadata");
    accounts.push({ id: metadata.id, label: metadata.email || "OpenAI 계정", selected: selected === metadata.id });
  }
  return accounts;
}

async function providerBundle(options, env) {
  let directory = options.providerReleaseDirectory;
  if (!directory && env.AZRAEL_PROVIDER_ACCOUNTS_HELPER) {
    directory = path.dirname(env.AZRAEL_PROVIDER_ACCOUNTS_HELPER);
    for (let i = 0; i < 10; i++) {
      if (await exists(path.join(directory, "opencodex-accounts-build.json"))) break;
      const parent = path.dirname(directory); if (parent === directory || i === 9) return null; directory = parent;
    }
  }
  if (!directory) return null;
  const bundle = readBundle(directory, true);
  for (const [configured, actual] of [[env.AZRAEL_PROVIDER_ACCOUNTS_HELPER, bundle.helper], [env.AZRAEL_PROVIDER_BUN, bundle.bun]]) {
    if (configured && canonicalPath(await fs.realpath(configured)) !== canonicalPath(actual)) throw Error("Provider runtime identity mismatch");
  }
  return bundle;
}

async function helperList(bundle, home, env, timeoutMs) {
  // Same request/framing contract as ProviderAccountService.request("list").
  // Every path, including a failed request, waits for child close before returning.
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    let child, output = "", bytes = 0, value, failure, received = false;
    const stop = error => { failure ||= error; if (child && child.exitCode === null && child.signalCode === null) { child.stdin.destroy(); child.kill(); } };
    const timer = setTimeout(() => stop(Error("Account metadata timeout")), timeoutMs);
    try {
      child = spawn(bundle.bun, [bundle.helper], { env: { ...env, CODEX_HOME: home, OPENCODEX_HOME: path.join(home, "azrael/providers/opencodex"), AZRAEL_PROVIDER_INFERENCE_HELPER: bundle.inferenceHelper || "", AZRAEL_PROVIDER_BUN: bundle.bun }, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
      child.stderr.resume(); // Raw upstream diagnostics never leave the host.
      child.on("error", () => { failure ||= Error("Account metadata helper unavailable"); });
      child.stdin.on("error", () => { if (!received) stop(Error("Account metadata input closed")); });
      child.stdout.on("data", chunk => {
        bytes += chunk.length; if (bytes > 2 * 1024 * 1024) return stop(Error("Account metadata response limit"));
        output += chunk.toString("utf8");
        let end;
        while ((end = output.indexOf("\n")) >= 0) {
          const line = output.slice(0, end); output = output.slice(end + 1);
          try {
            const frame = JSON.parse(line);
            if (received || frame.id !== id || frame.type !== "result") return stop(Error("Invalid account metadata response"));
            received = true; value = frame.value; child.stdin.end();
          } catch { return stop(Error("Invalid account metadata response")); }
        }
      });
      child.once("close", (code, signal) => {
        clearTimeout(timer);
        if (failure || !received || code !== 0 || signal) reject(failure || Error("Account metadata helper failed"));
        else resolve(value);
      });
      child.stdin.write(JSON.stringify({ protocol: 1, id, action: "list" }) + "\n");
    } catch { clearTimeout(timer); if (child) stop(Error("Account metadata helper unavailable")); else reject(Error("Account metadata helper unavailable")); }
  });
}

function nativeEfforts(entry) {
  const source = entry.supported_reasoning_levels;
  if (!Array.isArray(source) || source.length > 32) throw Error("Invalid cached reasoning metadata");
  const seen = new Set();
  const efforts = source.map(row => {
    if (!record(row) || !text(row.effort, 80) || seen.has(row.effort) || typeof row.description !== "string" || row.description.length > 2000) throw Error("Invalid cached reasoning metadata");
    seen.add(row.effort); return { reasoningEffort: row.effort, description: row.description };
  });
  const chosen = entry.default_reasoning_level;
  if (chosen != null && !seen.has(chosen)) throw Error("Invalid cached default effort");
  return { supportedReasoningEfforts: efforts, defaultReasoningEffort: chosen ?? null };
}
function managedEfforts(entry) {
  if (entry.reasoning === undefined) return { supportedReasoningEfforts: [], defaultReasoningEffort: null };
  const { validateCatalogReasoning, OPENROUTER_EFFORTS } = existingModule("providers/opencodex/reasoning.ts");
  if (!validateCatalogReasoning(entry.reasoning) || entry.reasoning.supported_efforts.some((e, i, all) => i > 0 && OPENROUTER_EFFORTS.indexOf(all[i - 1]) >= OPENROUTER_EFFORTS.indexOf(e))) throw Error("Invalid cached managed reasoning metadata");
  return { supportedReasoningEfforts: entry.reasoning.supported_efforts.map(e => ({ reasoningEffort: e, description: "" })), defaultReasoningEffort: entry.reasoning.default_effort ?? null };
}

async function readProfileOptions(options = {}) {
  if (options.parseProviderSnapshot !== undefined && typeof options.parseProviderSnapshot !== "function") throw Error("Invalid provider metadata parser");
  const env = options.env || process.env, home = options.codexHome || env.CODEX_HOME;
  const empty = { providers: [], models: [], cached: true };
  if (!path.isAbsolute(home || "")) return { ...empty, message: "Azrael 계정 저장소를 확인할 수 없습니다." };
  const ordinary = canonicalPath(path.join(os.homedir(), ".codex"));
  try {
    const physical = canonicalPath(await fs.realpath(home));
    if (physical === ordinary || physical.startsWith(ordinary + path.sep)) return { ...empty, message: "Azrael 전용 계정 저장소가 필요합니다." };
  } catch { return { ...empty, message: "Azrael 계정 저장소를 확인할 수 없습니다." }; }
  const providers = [], models = [], messages = [];
  try {
    const accounts = options.openaiAccounts ? await options.openaiAccounts() : await nativeAccounts(home, options, env);
    if (!Array.isArray(accounts) || accounts.length > 2000) throw Error("Invalid account metadata");
    for (const account of accounts) {
      if (!record(account) || !/^[a-f0-9]{32}$/.test(account.id) || !text(account.label, 300) || account.needsReauth || account.removed) continue;
      providers.push({ id: scope("openai", account.id), label: `OpenAI · ${account.label}`, modelProvider: "openai", selected: account.selected === true, account: { providerId: "openai", accountId: account.id } });
    }
  } catch { messages.push("OpenAI 계정 메타데이터를 읽지 못했습니다."); }
  try {
    const bundle = options.providerAccounts ? null : await providerBundle(options, env);
    const raw = options.providerAccounts ? await options.providerAccounts() : bundle ? await helperList(bundle, home, env, Math.min(Math.max(options.timeoutMs || 30000, 1000), 60000)) : null;
    if (raw) {
      const parseProviderSnapshot = options.parseProviderSnapshot || existingModule("extensions/azrael-ex/src/providerAccountService.ts").parseProviderSnapshot;
      for (const provider of parseProviderSnapshot(raw).providers) for (const account of provider.accounts) {
        if (account.needsReauth) continue;
        providers.push({ id: scope(provider.id, account.id), label: `${provider.label} · ${account.label}`, modelProvider: provider.id === "devin" ? "devin" : "azrael-managed", selected: account.selected === true && provider.inferenceConnected === true, account: { providerId: provider.id, accountId: account.id } });
      }
    } else messages.push("관리형 연결 계정 메타데이터를 사용할 수 없습니다.");
  } catch { messages.push("관리형 연결 계정 메타데이터를 읽지 못했습니다."); }
  // Native model choices come from the live host catalog. In a packaged host,
  // account parsing is supplied by its compiled service, without repository TS.
  if (options.metadataOnly === true) {
    const seen = new Set();
    return { providers: providers.filter(p => { if (seen.has(p.id)) return false; seen.add(p.id); return true; }), models: [], cached: false,
      ...(messages.length ? { message: messages.join(" ") } : {}) };
  }
  const nativeProviderIds = providers.filter(p => p.modelProvider === "openai").map(p => p.id);
  if (nativeProviderIds.length) try {
    const cache = await safeFile(options.nativeModelsPath || path.join(home, "models_cache.json"), 8 * 1024 * 1024);
    // Stock/bundled models.json is deliberately ineligible: it has no authenticated
    // observation identity/timestamp. Neither identity nor ETag is returned to UI.
    if (!record(cache) || !text(cache.identity, 2000) || !text(cache.client_version, 100) || !Number.isFinite(Date.parse(cache.fetched_at)) || Date.parse(cache.fetched_at) <= 0 || Date.parse(cache.fetched_at) > Date.now() + 60000 || !Array.isArray(cache.models) || cache.models.length > 10000) throw Error("No authenticated cached model observation");
    const rows = cache.models.map(entry => {
      if (!record(entry) || !text(entry.slug, 300) || !text(entry.display_name, 300)) throw Error("Invalid cached model");
      return { id: entry.slug, model: entry.slug, displayName: entry.display_name, providerIds: [...nativeProviderIds], ...nativeEfforts(entry) };
    });
    models.push(...rows);
  } catch { messages.push("OpenAI 모델 캐시가 없거나 읽을 수 없습니다."); }
  const managedProviderIds = new Map();
  for (const p of providers.filter(p => p.modelProvider === "azrael-managed")) {
    if (!managedProviderIds.has(p.account.providerId)) managedProviderIds.set(p.account.providerId, []);
    managedProviderIds.get(p.account.providerId).push(p.id);
  }
  if (managedProviderIds.size) try {
    const cache = await safeFile(options.managedModelsPath || path.join(home, "azrael/providers/models.json"), 1024 * 1024);
    if (!record(cache) || !Array.isArray(cache.models) || cache.models.length > 10000 || !Array.isArray(cache.provider_statuses) || cache.provider_statuses.length > 512) throw Error("Invalid managed model cache");
    const status = new Map();
    for (const row of cache.provider_statuses) {
      if (!record(row) || !text(row.provider_id, 100) || status.has(row.provider_id) || !["ready", "stale", "empty", "error"].includes(row.state) || !Number.isFinite(row.observed_at) || row.observed_at <= 0 || row.observed_at > Date.now() + 60000) throw Error("Invalid cached provider status");
      status.set(row.provider_id, row.state);
    }
    const rows = [];
    for (const entry of cache.models) {
      const providerIds = managedProviderIds.get(entry.provider_id); if (!providerIds || !["ready", "stale"].includes(status.get(entry.provider_id))) continue;
      if (!record(entry) || !text(entry.provider_id, 100) || !text(entry.model_id, 256) || !text(entry.display_name, 300)) throw Error("Invalid managed cached model");
      const model = `managed/${entry.provider_id}/${entry.model_id}`;
      rows.push({ id: model, model, displayName: entry.display_name, providerIds: [...providerIds], ...managedEfforts(entry) });
    }
    models.push(...rows);
  } catch { messages.push("관리형 모델 캐시가 없거나 읽을 수 없습니다."); }
  if (providers.some(p => p.modelProvider === "devin")) messages.push("Devin 모델 캐시 연결은 제공되지 않습니다.");
  const seenProviders = new Set(), seenModels = new Set();
  return { providers: providers.filter(p => { if (seenProviders.has(p.id)) return false; seenProviders.add(p.id); return true; }), models: models.filter(m => { if (seenModels.has(m.model)) return false; seenModels.add(m.model); return true; }), cached: true,
    message: ["Azrael 모델 캐시", ...messages, ...(!providers.length ? ["연결된 계정이 없습니다."] : []), ...(!models.length ? ["사용할 모델 캐시가 없습니다."] : [])].join(" ") };
}

module.exports = { readProfileOptions };
