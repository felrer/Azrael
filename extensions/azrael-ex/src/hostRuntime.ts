import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { HostRuntime } from "./extension";

interface RuntimeManifest {
  schema: 2;
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
  if (!isRecord(raw) || raw.schema !== 2) throw new Error("Unsupported azrael runtime configuration.");
  for (const key of ["engine", "bridge", "codexHome"] as const) {
    if (!isAbsolutePath(raw[key])) throw new Error(`Invalid azrael ${key} path.`);
  }
  if (typeof raw.engineVersion !== "string" || !isSemver(raw.engineVersion)) {
    throw new Error("Invalid azrael engine version.");
  }
  if (raw.helpers !== undefined && !isRecord(raw.helpers)) throw new Error("Invalid azrael helpers.");
  const config = raw as unknown as RuntimeManifest;
  requireFile(config.engine, "engine");
  requireFile(config.bridge, "bridge");
  for (const key of Object.keys(helperEnv) as Array<keyof typeof helperEnv>) {
    const candidate = config.helpers?.[key];
    if (candidate !== undefined) {
      if (!isAbsolutePath(candidate)) throw new Error(`Invalid azrael ${key} path.`);
      requireFile(candidate, key);
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
  env.CODEX_HOME = config.codexHome;
  env.AZRAEL_EX_MANAGEMENT_SOCKET = socket;
  env.OPENCODEX_HOME = path.join(config.codexHome, "azrael", "providers", "opencodex");
  for (const key of Object.keys(helperEnv) as Array<keyof typeof helperEnv>) {
    const candidate = config.helpers?.[key];
    if (candidate) env[helperEnv[key]] = candidate;
  }
  return { engine: config.engine, bridge: config.bridge, codexHome: config.codexHome, engineVersion: config.engineVersion, socket, env };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
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
