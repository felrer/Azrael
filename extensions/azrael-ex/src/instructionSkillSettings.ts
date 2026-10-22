import * as path from "node:path";
import { AppServerTransport, AppServerTransportOptions } from "./appServerTransport";

export interface InstructionSkillState { path: string; enabled: boolean; name: string }

export interface InstructionSkillTransport {
  start(): Promise<unknown>;
  request(method: string, params?: unknown): Promise<unknown>;
  dispose(): void;
}

type TransportFactory = (options: AppServerTransportOptions) => InstructionSkillTransport;

/** Path-scoped native settings, using a separate, lazy local app-server connection. */
export class InstructionSkillSettings {
  private readonly options: AppServerTransportOptions;
  private transport?: InstructionSkillTransport;
  private starting?: Promise<InstructionSkillTransport>;
  private disposed = false;
  private pending: Promise<unknown> = Promise.resolve();

  constructor(
    runtime: { engine: string; codexHome: string; env?: NodeJS.ProcessEnv },
    private readonly cwd: string,
    private readonly createTransport: TransportFactory = (options) => new AppServerTransport(options),
  ) {
    if (![runtime.engine, runtime.codexHome, cwd].every((value) => typeof value === "string" && path.isAbsolute(value))) {
      throw new Error("Native skill settings require absolute engine, CODEX_HOME and cwd paths.");
    }
    const env = { ...(runtime.env ?? process.env) };
    for (const key of Object.keys(env)) {
      const name = key.toUpperCase();
      if (name === "CODEX_HOME" || name === "AZRAEL_EX_MANAGEMENT_SOCKET" ||
          name.startsWith("AZRAEL_REMOTE_") || name.startsWith("CODEX_REMOTE_") ||
          name === "CODEX_INTERNAL_APP_SERVER_REMOTE_CONTROL_DISABLED") delete env[key];
    }
    env.CODEX_HOME = runtime.codexHome;
    env.CODEX_INTERNAL_APP_SERVER_REMOTE_CONTROL_DISABLED = "1";
    this.options = {
      executable: runtime.engine, cwd, env,
      clientInfo: { name: "azrael-instruction-settings", version: "0.1.0" },
    };
  }

  list(): Promise<InstructionSkillState[]> {
    return this.enqueue(() => this.readList());
  }

  set(skillPath: string, enabled: boolean): Promise<boolean> {
    return this.enqueue(async () => {
      await this.write(skillPath, enabled);
      const skills = await this.readList();
      const effective = skills.find((skill) => identity(skill.path) === identity(skillPath));
      if (!effective) throw new Error("Native skill write completed but the path is absent from effective skills/list state.");
      return effective.enabled;
    });
  }

  /** Prepare a path rule before installation makes a new skill discoverable. */
  setForInstallation(skillPath: string, enabled: boolean): Promise<void> {
    return this.enqueue(async () => {
      const acknowledged = await this.write(skillPath, enabled);
      const skills = await this.readList();
      const effective = skills.find((skill) => identity(skill.path) === identity(skillPath));
      if ((effective?.enabled ?? acknowledged) !== enabled) {
        throw new Error("Native skill installation setting did not take effect.");
      }
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.transport?.dispose();
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(() => {
      if (this.disposed) throw new Error("Native skill settings are disposed.");
      return operation();
    });
    this.pending = result.catch(() => undefined);
    return result;
  }

  private async connection(): Promise<InstructionSkillTransport> {
    if (this.disposed) throw new Error("Native skill settings are disposed.");
    if (!this.starting) {
      const transport = this.createTransport(this.options);
      this.transport = transport;
      this.starting = transport.start().then(() => {
        if (this.disposed) throw new Error("Native skill settings are disposed.");
        return transport;
      }).catch((error: unknown) => {
        if (!this.disposed) transport.dispose();
        this.transport = undefined;
        this.starting = undefined;
        throw error;
      });
    }
    return this.starting;
  }

  private async write(skillPath: string, enabled: boolean): Promise<boolean> {
    validateSkillPath(skillPath);
    if (typeof enabled !== "boolean") throw new Error("Native skill enabled state must be a boolean.");
    const transport = await this.connection();
    const response = await transport.request("skills/config/write", { path: skillPath, enabled });
    if (!isRecord(response) || typeof response.effectiveEnabled !== "boolean") {
      throw new Error("Invalid native skills/config/write response; write outcome is uncertain.");
    }
    return response.effectiveEnabled;
  }

  private async readList(): Promise<InstructionSkillState[]> {
    const transport = await this.connection();
    const response = await transport.request("skills/list", { cwds: [this.cwd], forceReload: true });
    if (!isRecord(response) || !Array.isArray(response.data) || response.data.length !== 1) {
      throw new Error("Invalid native skills/list response.");
    }
    const entry: unknown = response.data[0];
    if (!isRecord(entry) || typeof entry.cwd !== "string" || !path.isAbsolute(entry.cwd) ||
        identity(entry.cwd) !== identity(this.cwd) || !Array.isArray(entry.skills) || !Array.isArray(entry.errors)) {
      throw new Error("Invalid native skills/list workspace response.");
    }
    if (entry.errors.length) throw new Error("Native skills/list reported skill loading errors; effective state is incomplete.");
    const seen = new Set<string>();
    return entry.skills.map((value: unknown) => {
      if (!isRecord(value) || typeof value.name !== "string" || !value.name.trim() || typeof value.enabled !== "boolean") {
        throw new Error("Invalid native skills/list skill state.");
      }
      validateSkillPath(value.path);
      const key = identity(value.path);
      if (seen.has(key)) throw new Error("Native skills/list returned duplicate skill paths.");
      seen.add(key);
      return { path: value.path, enabled: value.enabled, name: value.name };
    });
  }
}

function validateSkillPath(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.includes("\0") || !path.isAbsolute(value) || path.basename(value) !== "SKILL.md") {
    throw new Error("Native skill settings require an absolute SKILL.md path.");
  }
}

function identity(value: string): string {
  const normalized = path.normalize(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
