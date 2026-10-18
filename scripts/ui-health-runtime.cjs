"use strict";

// Serialized into the bootstrap. Never read text, URLs, command arguments or stacks.
function installUiHealth(view, send) {
  const doc = view.document;
  if (!doc || doc.querySelector('meta[name="azrael-ui-health-diagnostics"]')?.content === "false") return;
  let disposed = false, count = 0, dropped = 0, windowAt = Date.now(), dragging = false, dragAt = 0;
  const listeners = [];
  const emit = (event, fields = {}) => {
    try {
      if (disposed) return;
      if (Date.now() - windowAt >= 60000) { count = 0; windowAt = Date.now(); }
      // Keep periodic liveness available even during an error/selection storm.
      if (event !== "heartbeat" && ++count > 30) { dropped++; return; }
      const result = send({ event, ...fields, droppedCount: dropped }); dropped = 0;
      result?.catch?.(() => { dropped++; });
    } catch { dropped++; }
  };
  const listen = (target, name, fn) => { const safe = e => { try { fn(e); } catch { dropped++; } }; target.addEventListener(name, safe, true); listeners.push(() => target.removeEventListener(name, safe, true)); };
  const state = () => ({ hidden: !!doc.hidden, dragging, dragAgeMs: dragging ? Math.max(0, Date.now() - dragAt) : 0 });
  listen(view, "error", e => {
    if (e.target && e.target !== view) {
      const tag = String(e.target.tagName).toLowerCase();
      if (["script", "link", "img"].includes(tag)) emit("resource_load_failed", { resourceKind: tag });
    } else emit("javascript_error", { errorKind: e.error?.name === "TypeError" ? "type_error" : e.error?.name === "RangeError" ? "range_error" : "other" });
  });
  listen(view, "unhandledrejection", () => emit("unhandled_rejection"));
  listen(doc, "securitypolicyviolation", () => emit("csp_violation"));
  listen(view, "dragstart", e => {
    const commandArea = !!e.target?.closest?.(".azrael-command-execution");
    (view.queueMicrotask ?? (fn => Promise.resolve().then(fn)))(() => {
      if (disposed) return;
      if (e.defaultPrevented) { emit("drag_blocked", { commandArea }); return; }
      dragging = true; dragAt = Date.now(); emit("drag_started", { commandArea });
    });
  });
  for (const name of ["drop", "dragend", "blur"]) listen(view, name, () => { if (dragging) emit("drag_terminated", { terminal: name }); dragging = false; });
  listen(doc, "visibilitychange", () => { if (doc.hidden) dragging = false; emit("visibility_changed", state()); });
  listen(doc, "selectstart", e => {
    if (e.target?.closest?.(".azrael-command-execution")) emit("command_selection_attempt");
  });
  const pulse = () => emit("heartbeat", state());
  emit("bootstrap_evaluated", state());
  const timer = view.setInterval(pulse, 10000);
  listen(view, "pagehide", () => { emit("page_hidden", state()); dispose(); });
  // Existing drag policy cancels propagation, so record attempts before it in bootstrap.
  function dispose() { if (disposed) return; disposed = true; view.clearInterval(timer); for (const remove of listeners) remove(); }
  return dispose;
}

module.exports = { installUiHealth };
