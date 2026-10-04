import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";

export function handleSessionRoutes(ctx: ManagementContext): Response | null {
  if (ctx.url.pathname !== "/api/session/logout" || ctx.req.method !== "POST") return null;
  if (ctx.principal !== "gui-session") {
    return jsonResponse({ error: "GUI session required" }, 403, ctx.req, ctx.config);
  }
  if (!ctx.sessionControl?.revokeCurrent(ctx.req)) {
    return jsonResponse({ error: "GUI session not found" }, 401, ctx.req, ctx.config);
  }
  return jsonResponse({ ok: true }, 200, ctx.req, ctx.config);
}
