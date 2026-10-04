"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

function appKey(value) {
  if (typeof value !== "string" || value !== value.trim() || !value || value.length > 512 || /[\x00-\x1f\x7f]/.test(value)) throw new Error("Invalid computer-use app identity");
  return value.toLowerCase();
}
function createOwner(codexHome) {
  const file = path.join(codexHome, "azrael", "computer-use", "app-approvals.json");
  const pending = new Map(), sessions = new Map();
  function read() {
    let state;
    try { state = JSON.parse(fs.readFileSync(file, "utf8")); }
    catch (e) { if (e.code === "ENOENT") return { schema: 1, revocations: {}, apps: [] }; throw e; }
    if (state.schema !== 1 || !state.revocations || typeof state.revocations !== "object" || Array.isArray(state.revocations) || !Array.isArray(state.apps)) throw new Error("Invalid app approval store");
    for (const [key, generation] of Object.entries(state.revocations)) {
      if (appKey(key) !== key || !Number.isSafeInteger(generation) || generation < 0) throw new Error("Invalid app revocation generation");
    }
    const seen = new Set();
    for (const app of state.apps) {
      if (!app || appKey(app.bundleIdentifier) !== app.bundleIdentifier || typeof app.displayName !== "string" || /[\x00-\x1f\x7f]/.test(app.displayName) || seen.has(app.bundleIdentifier)) throw new Error("Invalid app approval entry");
      seen.add(app.bundleIdentifier);
    }
    return state;
  }
  function fresh() {
    try {
      const state = read();
      for (const grants of sessions.values()) for (const [key, grant] of grants) if (grant.generation !== appGeneration(state, key)) grants.delete(key);
      for (const p of pending.values()) if (p.generation !== appGeneration(state, p.key)) p.cancelled = true;
      return state;
    } catch (e) { reset(); throw e; }
  }
  function appGeneration(state, key) { return Object.hasOwn(state.revocations, key) ? state.revocations[key] : 0; }
  function write(change) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const lock = file + ".lock";
    const fd = fs.openSync(lock, "wx");
    let temp;
    try {
      const state = read(); change(state);
      temp = file + "." + crypto.randomBytes(8).toString("hex") + ".tmp";
      const output = fs.openSync(temp, "wx", 0o600);
      try { fs.writeFileSync(output, JSON.stringify(state) + "\n"); fs.fsyncSync(output); } finally { fs.closeSync(output); }
      fs.renameSync(temp, file); temp = undefined;
      return state;
    } finally { if (temp) fs.rmSync(temp, { force: true }); fs.closeSync(fd); fs.unlinkSync(lock); }
  }
  function stop(threadId) {
    sessions.delete(threadId);
    for (const p of pending.values()) if (p.threadId === threadId) p.cancelled = true;
  }
  function reset() { sessions.clear(); for (const p of pending.values()) p.cancelled = true; }
  function outgoing(method, params) {
    if (["turn/interrupt", "thread/unsubscribe"].includes(method)) stop(params?.threadId);
  }
  function notification(method, params) {
    if (method === "thread/closed") stop(params?.threadId);
  }
  function receive(request, send, broadcast) {
    const params = request.params, meta = params?._meta;
    if (request.method !== "mcpServer/elicitation/request" || params?.serverName !== "node_repl" || meta?.connector_id !== "computer-use") return broadcast(request);
    let key, state;
    try {
      if (!((typeof request.id === "string" && request.id.length > 0) || (typeof request.id === "number" && Number.isSafeInteger(request.id)))) throw new Error("Invalid computer-use approval request id");
      key = appKey(meta.tool_params?.app); state = fresh();
    }
    catch { return send(request.id, { action: "cancel" }); }
    const offered = Array.isArray(meta.persist) ? meta.persist.filter(p => p === "session" || p === "always") : [];
    const threadId = typeof params.threadId === "string" && params.threadId ? params.threadId : null;
    if (offered.includes("always") && state.apps.some(a => a.bundleIdentifier === key)) return send(request.id, { action: "accept", content: { source: "computer-use-persisted-state", scope: "global" } });
    if (threadId && offered.includes("session") && sessions.get(threadId)?.has(key)) return send(request.id, { action: "accept", content: { source: "computer-use-session-state", scope: "session" } });
    const display = Array.isArray(meta.tool_params_display) ? meta.tool_params_display.find(p => p.name === "app")?.value : undefined;
    const displayName = typeof display === "string" && display && !/[\x00-\x1f\x7f]/.test(display) ? display : meta.tool_params.app;
    pending.set(JSON.stringify(request.id), { key, threadId, displayName, offered, generation: appGeneration(state, key), cancelled: false });
    return broadcast(request);
  }
  function response(id, result) {
    const p = pending.get(JSON.stringify(id));
    if (!p) return result;
    try { fresh(); } catch { p.cancelled = true; }
    pending.delete(JSON.stringify(id));
    if (p.cancelled) return { action: "cancel" };
    if (result?.action !== "accept") return result;
    const persist = result.content?.persist ?? result._meta?.persist;
    if (!p.offered.includes(persist)) return result;
    try {
      if (persist === "always") write(state => { if (appGeneration(state, p.key) !== p.generation) throw new Error("App approval revoked during request"); state.apps = state.apps.filter(a => a.bundleIdentifier !== p.key); state.apps.push({ bundleIdentifier: p.key, displayName: p.displayName }); });
      if (persist === "session" && p.threadId) { if (!sessions.has(p.threadId)) sessions.set(p.threadId, new Map()); sessions.get(p.threadId).set(p.key, { displayName: p.displayName, generation: p.generation }); }
    } catch { reset(); return { action: "cancel" }; }
    return result;
  }
  function getAppApprovals() {
    const state = fresh(), apps = new Map(state.apps.map(app => [app.bundleIdentifier, app]));
    for (const grants of sessions.values()) for (const [key, grant] of grants) if (!apps.has(key)) apps.set(key, { bundleIdentifier: key, displayName: grant.displayName });
    return { approvedApps: [...apps.values()] };
  }
  function hasAppApproval(app, threadId) {
    const key = appKey(app), state = fresh();
    return state.apps.some(entry => entry.bundleIdentifier === key) || !!sessions.get(threadId)?.has(key);
  }
  function removeAppApproval(app) {
    const key = appKey(app);
    write(state => {
      const next = appGeneration(state, key) + 1;
      if (!Number.isSafeInteger(next)) throw new Error("App revocation generation exhausted");
      state.apps = state.apps.filter(a => a.bundleIdentifier !== key);
      Object.defineProperty(state.revocations, key, { value: next, enumerable: true, writable: true, configurable: true });
    });
    return getAppApprovals();
  }
  return { receive, response, outgoing, notification, stop, reset, getAppApprovals, hasAppApproval, removeAppApproval };
}
// Share consent state when Windows resolves the same module with different casing.
const registry = globalThis[Symbol.for("azrael.computer-use.approval-owners.v1")] ??= new Map();
function owner() {
  const home = require("./azrael-runtime.cjs").runtime.codexHome;
  const key = path.resolve(home).toLowerCase();
  if (!registry.has(key)) registry.set(key, createOwner(home));
  return registry.get(key);
}
module.exports = { appKey, createOwner, receive: (...args) => owner().receive(...args), response: (...args) => owner().response(...args), outgoing: (...args) => owner().outgoing(...args), notification: (...args) => owner().notification(...args), stop: (...args) => owner().stop(...args), reset: () => owner().reset(), getAppApprovals: () => owner().getAppApprovals(), hasAppApproval: (...args) => owner().hasAppApproval(...args), removeAppApproval: app => owner().removeAppApproval(app) };
