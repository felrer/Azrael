"use strict";

// Serialized into the pinned host: owns only renderer lifetime, never a thread.
function createWebviewIdleManager(host, clock = globalThis, delay = 60 * 60 * 1000) {
  const records = new Map();
  const deferredActions = new Set(["navigate-to-route", "new-chat", "add-context-file", "implement-todo", "mcp-request-delivery"]);
  let sequence = 0;
  const blank = '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\';"></head><body></body></html>';
  function cancel(r) { if (r.timer != null) clock.clearTimeout(r.timer); r.timer = null; }
  function arm(r, wait) {
    cancel(r);
    if (r.disposed || r.view.visible || r.suspended) return;
    r.timer = clock.setTimeout(() => { r.timer = null; release(r).catch(error => host.error(error)); }, wait);
    r.timer?.unref?.();
  }
  function eligible(r, epoch) { return !r.disposed && !r.view.visible && !r.suspended && r.epoch === epoch && clock.Date.now() - r.hiddenAt >= delay; }
  async function release(r) {
    const epoch = r.epoch;
    if (!eligible(r, epoch) || r.request) return;
    try {
      const snapshot = await new Promise(resolve => {
        const id = ++sequence;
        const timeout = clock.setTimeout(() => { r.request = null; resolve(null); }, 5000);
        r.request = { id, finish(value) { clock.clearTimeout(timeout); r.request = null; resolve(value); } };
        host.send(r.webview, { type: "azrael-webview-idle-capture", id });
      });
      if (!eligible(r, epoch) || !snapshot?.canSuspend) return;
      const flags = (await host.preferences())["azrael-session-flags"] ?? {};
      if (!eligible(r, epoch)) return;
      r.protected = flags[JSON.stringify([snapshot.hostId ?? "local", snapshot.conversationId])] === true;
      if (r.protected) return;
      // Capture only composer/view state; history comes from the native host again.
      r.snapshot = snapshot;
      r.suspended = true;
      host.suspended(r.webview, snapshot);
      r.webview.html = blank;
    } finally {
      if (!r.suspended && !r.protected && eligible(r, epoch)) arm(r, 60000);
    }
  }
  async function restore(r) {
    const epoch = r.epoch;
    try {
      const html = await host.content(r.webview, r.snapshot);
      if (r.disposed || r.epoch !== epoch) return;
      r.suspended = false;
      r.restoring = true;
      r.webview.html = html;
    } catch (error) { host.error(error); }
  }
  function visibility(r) {
    if (r.visible === r.view.visible) return;
    r.visible = r.view.visible;
    ++r.epoch;
    cancel(r);
    r.request?.finish(null);
    if (r.view.visible) {
      r.hiddenAt = null;
      if (r.suspended) void restore(r);
    } else {
      r.hiddenAt = clock.Date.now();
      arm(r, delay);
    }
  }
  return {
    attach(view, webview) {
      if (records.has(webview)) return;
      const r = { view, webview, epoch: 0, hiddenAt: null, suspended: false, disposed: false, snapshot: null };
      records.set(webview, r);
      const change = view.onDidChangeViewState ?? view.onDidChangeVisibility;
      r.change = change.call(view, () => visibility(r));
      r.close = view.onDidDispose(() => { r.disposed = true; ++r.epoch; cancel(r); r.request?.finish(null); r.change.dispose(); r.close.dispose(); records.delete(webview); });
      visibility(r);
    },
    receive(webview, message) {
      if (message?.type !== "azrael-webview-idle-snapshot") return false;
      const r = records.get(webview);
      if (r?.request?.id === message.id) r.request.finish(message.snapshot);
      return true;
    },
    isSuspended(webview) { return records.get(webview)?.suspended === true; },
    holdOutgoing(webview, message) {
      const r = records.get(webview);
      if (!r || !r.suspended && !r.restoring) return false;
      if (deferredActions.has(message.type)) {
        (r.messages ??= []).push(message);
        return true;
      }
      return r.suspended;
    },
    ready(webview) {
      const r = records.get(webview);
      if (!r || r.suspended) return;
      r.restoring = false;
      const messages = r.messages ?? [];
      r.messages = [];
      for (const message of messages) host.send(webview, message);
    },
    preferencesChanged() {
      for (const r of records.values()) if (!r.view.visible && r.hiddenAt != null) {
        r.protected = false;
        arm(r, Math.max(0, delay - (clock.Date.now() - r.hiddenAt)));
      }
    },
    snapshot(webview) { return records.get(webview)?.snapshot; },
    dispose() { for (const r of records.values()) { r.disposed = true; cancel(r); r.request?.finish(null); r.change.dispose(); r.close.dispose(); } records.clear(); },
  };
}

module.exports = { createWebviewIdleManager };
