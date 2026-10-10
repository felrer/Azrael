import { createHash, randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { HostRuntime } from "./extension";

const { validateRuntimePlatform, requireExecutable, engineBinaryNames } = require("../platform-runtime.cjs");
const nativeHelpers = new Set(["devinExecutable", "nodeExecutable", "providerBun"]);

interface RuntimeManifest {
  schema: 2;
  platform?: HostRuntime["platform"];
  engine: string;
  bridge: string;
  codexHome: string;
  engineVersion: string;
  helpers?: {
    devinExecutable?: string;
    devinNativeHelper?: string;
    nodeExecutable?: string;
    providerAccountsHelper?: string;
    providerInferenceHelper?: string;
    providerBun?: string;
  };
}

const helperEnv = {
  devinExecutable: "AZRAEL_EX_DEVIN_EXECUTABLE",
  devinNativeHelper: "AZRAEL_DEVIN_NATIVE_HELPER",
  nodeExecutable: "AZRAEL_DEVIN_NODE",
  providerAccountsHelper: "AZRAEL_PROVIDER_ACCOUNTS_HELPER",
  providerInferenceHelper: "AZRAEL_PROVIDER_INFERENCE_HELPER",
  providerBun: "AZRAEL_PROVIDER_BUN",
} as const;

// The caller supplies the prepared extension directory, never a manifest outside it.
export function buildHostRuntime(extensionDirectory: string, inheritedEnv: NodeJS.ProcessEnv = process.env): HostRuntime {
  const manifestPath = path.join(extensionDirectory, "azrael-runtime.json");
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    throw new Error("Missing or invalid azrael runtime configuration.");
  }
  if (!isRecord(raw) || (raw.schema !== 2 && raw.schema !== 3)) throw new Error("Unsupported azrael runtime configuration.");
  validateRuntimePlatform(raw.platform);
  if (raw.schema === 3) raw = resolvePortableManifest(raw, extensionDirectory);
  // Both manifest formats converge on the existing absolute runtime contract.
  const resolved = raw as Record<string, unknown>;
  for (const key of ["engine", "bridge", "codexHome"] as const) {
    if (!isAbsolutePath(resolved[key])) throw new Error(`Invalid azrael ${key} path.`);
  }
  if (typeof resolved.engineVersion !== "string" || !isSemver(resolved.engineVersion)) {
    throw new Error("Invalid azrael engine version.");
  }
  if (resolved.helpers !== undefined && !isRecord(resolved.helpers)) throw new Error("Invalid azrael helpers.");
  const config = resolved as unknown as RuntimeManifest;
  requireFile(config.engine, "engine");
  requireFile(config.bridge, "bridge");
  requireExecutable(config.engine);
  requireExecutable(config.bridge);
  for (const key of Object.keys(helperEnv) as Array<keyof typeof helperEnv>) {
    const candidate = config.helpers?.[key];
    if (candidate !== undefined) {
      if (!isAbsolutePath(candidate)) throw new Error(`Invalid azrael ${key} path.`);
      requireFile(candidate, key);
      if (nativeHelpers.has(key)) requireExecutable(candidate);
    }
  }

  const ordinaryHome = canonicalHome(path.join(os.homedir(), ".codex"));
  const stateHome = canonicalHome(config.codexHome);
  if (stateHome === ordinaryHome || stateHome.startsWith(ordinaryHome + path.sep)) {
    throw new Error("azrael requires its own state home.");
  }
  fs.mkdirSync(config.codexHome, { recursive: true });
  // Resolve links after creation as well: a symlink to ordinary Codex state is forbidden.
  const physicalHome = canonicalHome(fs.realpathSync.native(config.codexHome));
  if (physicalHome === ordinaryHome || physicalHome.startsWith(ordinaryHome + path.sep)) {
    throw new Error("azrael requires its own state home.");
  }

  const socket = path.join(os.tmpdir(), `azo-${randomBytes(12).toString("hex")}`, "m.sock");
  const env: NodeJS.ProcessEnv = { ...inheritedEnv };
  for (const key of Object.keys(env)) {
    if (shouldStrip(key)) delete env[key];
  }
  if (process.platform === "win32") {
    const inheritedPath = Object.entries(inheritedEnv).find(([key]) => key.toUpperCase() === "PATH")?.[1];
    for (const key of Object.keys(env)) if (key.toUpperCase() === "PATH") delete env[key];
    if (inheritedPath !== undefined) env.PATH = inheritedPath;
  }
  if (config.helpers?.devinNativeHelper) {
    const temporary = path.join(config.codexHome, "tmp", "devin-native");
    fs.mkdirSync(temporary, { recursive: true });
    env.TMP = temporary;
    env.TEMP = temporary;
    if (process.platform !== "win32") env.TMPDIR = temporary;
  }
  env.CODEX_HOME = config.codexHome;
  env.AZRAEL_EX_MANAGEMENT_SOCKET = socket;
  env.OPENCODEX_HOME = path.join(config.codexHome, "azrael", "providers", "opencodex");
  for (const key of Object.keys(helperEnv) as Array<keyof typeof helperEnv>) {
    const candidate = config.helpers?.[key];
    if (candidate) env[helperEnv[key]] = candidate;
  }
  return { platform: config.platform, engine: config.engine, bridge: config.bridge, codexHome: config.codexHome, engineVersion: config.engineVersion, socket, env };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function resolvePortableManifest(raw: Record<string, unknown>, extensionDirectory: string): Record<string, unknown> {
  if (raw.stateDirectory !== undefined && raw.stateDirectory !== ".azrael-ex") {
    throw new Error("Invalid azrael state directory.");
  }
  if (raw.codexHome !== undefined) throw new Error("Invalid azrael state directory.");
  if (!isRecord(raw.sha256)) throw new Error("Invalid azrael payload hashes.");
  if (raw.helpers !== undefined && !isRecord(raw.helpers)) throw new Error("Invalid azrael helpers.");
  const root = fs.realpathSync.native(extensionDirectory);
  const hashes = raw.sha256;
  const payloads = new Map<string, string>();
  // Verify the complete inventory, including payloads launched by the engine itself.
  for (const [relative, expected] of Object.entries(hashes)) {
    const candidate = resolveBundleFile(root, relative, "payload");
    if (typeof expected !== "string" || !/^[a-f0-9]{64}$/.test(expected)) {
      throw new Error("Invalid azrael payload hash.");
    }
    const actual = createHash("sha256").update(fs.readFileSync(candidate)).digest("hex");
    if (actual !== expected) throw new Error("Azrael payload hash mismatch.");
    if ([...engineBinaryNames(), "code-mode-host.exe"].includes(path.basename(relative))) requireExecutable(candidate);
    payloads.set(relative, candidate);
  }
  function executable(value: unknown, name: string): string {
    const candidate = resolveBundleFile(root, value, name);
    if (typeof value !== "string" || !payloads.has(value)) throw new Error(`Missing azrael ${name} hash.`);
    return candidate;
  }
  const helpers: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw.helpers ?? {})) {
    if (!Object.prototype.hasOwnProperty.call(helperEnv, key)) throw new Error("Invalid azrael helpers.");
    helpers[key] = executable(value, key);
  }
  return {
    schema: 2,
    platform: raw.platform,
    engine: executable(raw.engine, "engine"),
    bridge: executable(raw.bridge, "bridge"),
    engineVersion: raw.engineVersion,
    codexHome: path.join(os.homedir(), ".azrael-ex"),
    helpers,
  };
}

function resolveBundleFile(root: string, value: unknown, name: string): string {
  // Use one portable spelling. Reject Windows aliases even on non-Windows hosts.
  if (typeof value !== "string" || value.length === 0 || value.includes("\\") ||
      value.split("/").some(segment => !segment || segment === "." || segment === ".." ||
        /[<>:"|?*\x00-\x1f]/.test(segment) || /[. ]$/.test(segment) ||
        /^(?:con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(segment) ||
        /~[1-9]\d*(?:\.|$)/.test(segment))) {
    throw new Error(`Invalid azrael ${name} path.`);
  }
  const candidate = path.resolve(root, value);
  requireFile(candidate, name);
  const physical = fs.realpathSync.native(candidate);
  const relative = path.relative(root, physical);
  if (relative === "" || relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) {
    throw new Error(`Invalid azrael ${name} path outside bundle.`);
  }
  return physical;
}

function isAbsolutePath(value: unknown): value is string {
  return typeof value === "string" && path.isAbsolute(value);
}

function isSemver(value: string): boolean {
  return /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(value);
}

function requireFile(candidate: string, name: string): void {
  try {
    if (fs.statSync(candidate).isFile()) return;
  } catch { /* Convert filesystem errors to a path-free diagnostic. */ }
  throw new Error(`Missing azrael ${name} file.`);
}

function canonicalHome(value: string): string {
  const resolved = path.resolve(value);
  let physical = resolved;
  try { physical = fs.realpathSync.native(resolved); } catch { /* The state home may be new. */ }
  return process.platform === "win32" ? physical.toLowerCase() : physical;
}

function shouldStrip(key: string): boolean {
  const name = key.toUpperCase();
  if (name === "CODEX_HOME" || name === "OPENCODEX_HOME" || name.startsWith("AZRAEL_")) return true;
  if (/(?:^|_)API_?(?:KEY|TOKEN)(?:_|$)/.test(name)) return true;
  if (/^(?:OPENAI|CODEX|ANTHROPIC|AZURE_OPENAI)_(?:.*(?:BASE_URL|API_BASE|API_HOST|ENDPOINT|ACCESS_TOKEN|AUTH_TOKEN)|ORGANIZATION|PROJECT|KEY)$/.test(name)) return true;
  return false;
}
