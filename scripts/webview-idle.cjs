"use strict";

// Read the existing native manager, including work owned outside the current route.
// Unknown/loading state is never evidence that the renderer is dispensable.
function isWebviewWorkIdle(manager, conversationId) {
  try {
    if (!manager || typeof conversationId !== "string" || !conversationId) return false;
    if (manager.hasPendingConversationResume() !== false) return false;
    if (manager.requestClient.getPendingRequestCount({ method: "thread/start", retainResponse: true }) !== 0) return false;
    const queue = manager.turnCoordinator.readState();
    if (!queue || typeof queue !== "object" || Array.isArray(queue) || Object.values(queue).some(messages => !Array.isArray(messages) || messages.length !== 0)) return false;
    const current = manager.getConversation(conversationId);
    if (!current || current.resumeState !== "resumed") return false;
    const conversations = manager.getCachedConversations();
    if (!Array.isArray(conversations) || !conversations.includes(current)) return false;
    const summaries = manager.getThreadSummaries();
    if (!Array.isArray(summaries) || summaries.some(c => c.threadRuntimeStatus?.type === "active")) return false;
    for (const conversation of conversations) {
      if (!conversation || !["idle", "notLoaded"].includes(conversation.threadRuntimeStatus?.type)) return false;
      if (!["resumed", "needs_resume"].includes(conversation.resumeState)) return false;
      const messages = manager.turnCoordinator.readMessages(conversation.id);
      if (!Array.isArray(messages) || messages.length !== 0 || !Array.isArray(conversation.requests) || conversation.requests.length !== 0) return false;
      if (conversation.externalRequests?.some(request => request.completedAtMs == null) ||
          conversation.unconfirmedTurnSubmissions?.some(submission => submission.terminal !== true) ||
          conversation.threadGoal?.status === "active") return false;
      const state = manager.stateReaders.getListState(conversation);
      if (!state || state.isConversationInProgress !== false || state.isResponseInProgress !== false ||
          ![null, "completed", "interrupted", "failed"].includes(state.latestTurnStatus)) return false;
    }
    return true;
  } catch { return false; }
}

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
    if (r.checking) { arm(r, 60000); return; }
    r.checking = true;
    try {
      // Resolve engine reservations before asking the live renderer for its final state.
      if (await host.canRelease(r.webview) !== true) { r.hiddenAt = clock.Date.now(); arm(r, delay); return; }
      if (!eligible(r, epoch)) return;
      const flags = (await host.preferences())["azrael-session-flags"] ?? {};
      if (!eligible(r, epoch)) return;
      const snapshot = await new Promise(resolve => {
        const id = ++sequence;
        const timeout = clock.setTimeout(() => { r.request = null; resolve(null); }, 5000);
        r.request = { id, finish(value) { clock.clearTimeout(timeout); r.request = null; resolve(value); } };
        host.send(r.webview, { type: "azrael-webview-idle-capture", id });
      });
      if (!eligible(r, epoch)) return;
      if (snapshot?.canSuspend !== true) { r.hiddenAt = clock.Date.now(); arm(r, delay); return; }
      r.protected = flags[JSON.stringify([snapshot.hostId ?? "local", snapshot.conversationId])] === true;
      if (r.protected) return;
      if (host.hasPendingRequests(r.webview) !== false) { r.hiddenAt = clock.Date.now(); arm(r, delay); return; }
      // Capture only composer/view state; history comes from the native host again.
      r.snapshot = snapshot;
      r.suspended = true;
      host.suspended(r.webview, snapshot);
      r.webview.html = blank;
    } catch (error) {
      host.error(error);
      if (!r.disposed && !r.view.visible && r.epoch === epoch) { r.hiddenAt = clock.Date.now(); arm(r, delay); }
    } finally {
      r.checking = false;
      if (!r.suspended && !r.protected && !r.disposed && !r.view.visible && r.timer == null)
        arm(r, Math.max(60000, delay - (clock.Date.now() - r.hiddenAt)));
    }
  }
  async function restore(r) {
    if (r.restorePending) return;
    r.restorePending = true;
    const epoch = r.epoch;
    try {
      const html = await host.content(r.webview, r.snapshot);
      if (r.disposed || r.epoch !== epoch) return;
      r.suspended = false;
      r.restoring = true;
      r.webview.html = html;
    } catch (error) { host.error(error); }
    finally {
      r.restorePending = false;
      if (!r.disposed && r.suspended && r.view.visible && r.epoch !== epoch) void restore(r);
    }
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
        if (r.suspended) void restore(r);
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
      if (!r.view.visible) { r.hiddenAt = clock.Date.now(); arm(r, delay); }
    },
    preferencesChanged() {
      for (const r of records.values()) if (!r.view.visible && r.hiddenAt != null) {
        if (r.checking) ++r.epoch;
        r.request?.finish(null);
        r.protected = false;
        arm(r, Math.max(0, delay - (clock.Date.now() - r.hiddenAt)));
      }
    },
    snapshot(webview) { return records.get(webview)?.snapshot; },
    dispose() { for (const r of records.values()) { r.disposed = true; cancel(r); r.request?.finish(null); r.change.dispose(); r.close.dispose(); } records.clear(); },
  };
}

module.exports = { createWebviewIdleManager, isWebviewWorkIdle };
