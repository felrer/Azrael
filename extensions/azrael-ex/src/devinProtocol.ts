export type DevinAction = "status" | "login" | "loginCancel" | "logout" | "refresh";
export interface DevinStatus { enabled: boolean; loggedIn: boolean; email: string | null; plan: string | null }

export function parseDevinStatus(value: unknown): DevinStatus {
  if (!value || typeof value !== "object") throw new Error("Invalid Devin account response.");
  const record = value as Record<string, unknown>;
  if (typeof record.enabled !== "boolean" || typeof record.loggedIn !== "boolean"
    || !(record.email === null || typeof record.email === "string")
    || !(record.plan === null || typeof record.plan === "string")) throw new Error("Invalid Devin account response.");
  return { enabled: record.enabled, loggedIn: record.loggedIn, email: record.email, plan: record.plan };
}
