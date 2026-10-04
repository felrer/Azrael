import { isRecord } from "./protocol";

export const ROOT_RESUME_METHOD = "azrael/rootResume";
export const ROOT_RESUME_UPDATED_METHOD = "azrael/rootResume/updated";

export type RootResumeAction = "list" | "resume" | "cancel";
export type RootResumeState = "preparing" | "waiting" | "claimed" | "resumed" | "cancelled" | "blocked";
export type RootResumeWakeReason = null | "deadline" | "agents_completed" | "user_input" | "manual";
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface RootResumeAgentTask {
  threadId: string;
  agentPath: string;
  turnId: string;
}

export interface RootResumeReservation {
  id: string;
  rootThreadId: string;
  originatingTurnId: string;
  rootTurnId: string;
  callId: string;
  resumeTurnId: string;
  resumeAtMs: number;
  createdAtMs: number;
  updatedAtMs: number;
  revision: number;
  state: RootResumeState;
  agentTasks: RootResumeAgentTask[];
  reason: string;
  wakeReason: RootResumeWakeReason;
  lastError: string | null;
  finalOutputJsonSchema?: JsonValue;
}

export type RootResumeParams =
  | { action: "list" }
  | { action: "resume" | "cancel"; reservationId: string; revision: number };

export interface RootResumeResponse {
  reservations: RootResumeReservation[];
}

const STATES = new Set<RootResumeState>(["preparing", "waiting", "claimed", "resumed", "cancelled", "blocked"]);
const ACTIVE_STATES = new Set<RootResumeState>(["preparing", "waiting", "claimed", "blocked"]);
const WAKE_REASONS = new Set<Exclude<RootResumeWakeReason, null>>(["deadline", "agents_completed", "user_input", "manual"]);
const REQUIRED_RESERVATION_KEYS = new Set([
  "id", "rootThreadId", "originatingTurnId", "rootTurnId", "callId", "resumeTurnId",
  "resumeAtMs", "createdAtMs", "updatedAtMs", "revision", "state", "agentTasks", "reason",
  "wakeReason", "lastError"
]);
const REQUIRED_TASK_KEYS = new Set(["threadId", "agentPath", "turnId"]);

export function parseRootResumeResponse(value: unknown): RootResumeResponse {
  if (!isRecord(value) || !Array.isArray(value.reservations)) {
    throw new Error("Invalid root resume response.");
  }
  return { reservations: value.reservations.map(parseReservation) };
}

export function parseRootResumeMessage(value: unknown): RootResumeParams | undefined {
  if (!isRecord(value) || typeof value.action !== "string") return undefined;
  if (value.action === "list" && Object.keys(value).length === 1) return { action: "list" };
  if ((value.action === "resume" || value.action === "cancel") && Object.keys(value).length === 3 &&
      typeof value.reservationId === "string" && value.reservationId.length > 0 &&
      Number.isSafeInteger(value.revision) && (value.revision as number) >= 0) {
    return { action: value.action, reservationId: value.reservationId, revision: value.revision as number };
  }
  return undefined;
}

export function isActiveRootResumeState(state: RootResumeState): boolean {
  return ACTIVE_STATES.has(state);
}

function parseReservation(value: unknown): RootResumeReservation {
  if (!hasRequiredKeys(value, REQUIRED_RESERVATION_KEYS)) throw new Error("Invalid root resume reservation.");
  const stringKeys = ["id", "rootThreadId", "originatingTurnId", "rootTurnId", "callId", "resumeTurnId", "reason"] as const;
  for (const key of stringKeys) if (typeof value[key] !== "string") throw new Error(`Invalid root resume reservation ${key}.`);
  const numberKeys = ["resumeAtMs", "createdAtMs", "updatedAtMs", "revision"] as const;
  for (const key of numberKeys) if (!Number.isSafeInteger(value[key]) || (value[key] as number) < 0) throw new Error(`Invalid root resume reservation ${key}.`);
  if (typeof value.state !== "string" || !STATES.has(value.state as RootResumeState)) throw new Error("Invalid root resume reservation state.");
  if (!Array.isArray(value.agentTasks)) throw new Error("Invalid root resume reservation agentTasks.");
  const agentTasks = value.agentTasks.map(parseAgentTask);
  if (value.wakeReason !== null && (typeof value.wakeReason !== "string" || !WAKE_REASONS.has(value.wakeReason as Exclude<RootResumeWakeReason, null>))) {
    throw new Error("Invalid root resume reservation wakeReason.");
  }
  if (value.lastError !== null && typeof value.lastError !== "string") throw new Error("Invalid root resume reservation lastError.");
  if ("finalOutputJsonSchema" in value && !isJsonValue(value.finalOutputJsonSchema)) throw new Error("Invalid root resume reservation finalOutputJsonSchema.");
  return { ...value, agentTasks } as RootResumeReservation;
}

function parseAgentTask(value: unknown): RootResumeAgentTask {
  if (!hasRequiredKeys(value, REQUIRED_TASK_KEYS)) throw new Error("Invalid root resume agent task.");
  if (typeof value.threadId !== "string" || typeof value.agentPath !== "string" || typeof value.turnId !== "string") {
    throw new Error("Invalid root resume agent task identity.");
  }
  return { threadId: value.threadId, agentPath: value.agentPath, turnId: value.turnId };
}

function hasRequiredKeys(value: unknown, required: ReadonlySet<string>): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  return [...required].every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isRecord(value) && Object.values(value).every(isJsonValue);
}
