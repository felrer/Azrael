"use strict";

const { randomUUID } = require("node:crypto");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseSessionLink(input, { allowLegacy = false } = {}) {
  if (typeof input !== "string" || input.trim() !== input || /[\s\\]/u.test(input)) throw new Error("Invalid session link.");
  let url;
  try { url = new URL(input); } catch { throw new Error("Invalid session link."); }
  if (url.protocol !== "azrael:" && !(allowLegacy && url.protocol === "codex:")) throw new Error("Use an azrael://threads/<UUID> session link. Old Codex links require explicit migration.");
  if (url.host !== "threads" || url.username || url.password || url.port || url.hash) throw new Error("Only local Azrael session links without credentials, ports or fragments are supported.");
  const id = url.pathname.slice(1);
  if (!UUID.test(id) || url.pathname !== `/${id}`) throw new Error("A session link must contain exactly one thread UUID; extra paths are unsupported.");
  if (!/^(?:azrael|codex):\/\/threads\/[0-9a-f-]+(?:\?|$)/iu.test(input)) throw new Error("Session links must use the literal local UUID path.");
  const keys = new Set();
  for (const [key, value] of url.searchParams) {
    if (keys.has(key)) throw new Error(`Duplicate session link query: ${key}`);
    keys.add(key);
    if (key === "hostId" && value === "local") continue;
    if (key === "view" && value === "review") continue;
    if (key === "diffFilter" && ["branch", "last-turn"].includes(value)) continue;
    if (key === "path" && value.length > 0) continue;
    throw new Error(`Unsupported local session link query: ${key}`);
  }
  if ((keys.has("path") || keys.has("diffFilter")) && url.searchParams.get("view") !== "review") throw new Error("Review path and diffFilter require view=review.");
  return { id, canonicalUrl: `azrael://threads/${id}${url.search}`, vscodeUrl: `vscode://azrael-ex-local.azrael/local/${id}${url.search}` };
}

// Uses the already running Azrael app-server connection, never the original
// Codex process or filesystem. A successful native read proves local ownership.
function registerMigrationCommand(vscode, connection) {
  const provider = "azrael-session-link-migration";
  const pending = new Map();
  const providerRegistration = connection.registerProvider(provider, {
    onResult(message) {
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(new Error(message.error.message || "Azrael thread read failed."));
      else request.resolve(message.result);
    },
  });
  function readThread(id) {
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        connection.abandonRequest(provider, requestId);
        reject(new Error("Azrael thread verification timed out."));
      }, 10000);
      pending.set(requestId, { resolve, reject, timer });
      try { connection.sendRequest(provider, requestId, "thread/read", { threadId: id, includeTurns: false }); }
      catch (error) { clearTimeout(timer); pending.delete(requestId); reject(error); }
    });
  }
  const command = vscode.commands.registerCommand("azrael.migrateSessionLink", async (input) => {
    const value = input ?? await vscode.window.showInputBox({ prompt: "Paste the old codex://threads/<UUID> link belonging to Azrael", ignoreFocusOut: true });
    if (value === undefined) return;
    try {
      const parsed = parseSessionLink(value, { allowLegacy: true });
      const result = await readThread(parsed.id);
      if (result?.thread?.id?.toLowerCase() !== parsed.id.toLowerCase()) throw new Error("The thread was not found in Azrael. No link was copied.");
      await vscode.env.clipboard.writeText(parsed.canonicalUrl);
      await vscode.window.showInformationMessage("Azrael session link copied.");
      return parsed.canonicalUrl;
    } catch (error) {
      await vscode.window.showErrorMessage(`Cannot migrate session link: ${error.message}`);
      throw error;
    }
  });
  return { dispose() {
    command.dispose();
    providerRegistration.dispose();
    for (const [requestId, request] of pending) {
      clearTimeout(request.timer);
      connection.abandonRequest(provider, requestId);
      request.reject(new Error("Azrael session link migration disposed."));
    }
    pending.clear();
  } };
}

module.exports = { UUID, parseSessionLink, registerMigrationCommand };
if (require.main === module) {
  try {
    if (process.argv.length !== 3) throw new Error("Usage: session-links.cjs <azrael-session-url>");
    process.stdout.write(`${JSON.stringify(parseSessionLink(process.argv[2]))}\n`);
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
