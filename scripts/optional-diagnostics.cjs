"use strict";
const webviewHealth = new WeakMap();

function parseDiagnosticBoolean(value) {
  if (typeof value !== "string") return undefined;
  switch (value.trim().toLowerCase()) {
    case "1": case "true": case "on": return true;
    case "0": case "false": case "off": return false;
    default: return undefined;
  }
}
function diagnosticsEnabled(category, env = process.env) {
  return parseDiagnosticBoolean(env[`AZRAEL_DIAGNOSTICS_${category}`]) ??
    parseDiagnosticBoolean(env.AZRAEL_DIAGNOSTICS) ?? true;
}
function injectUiInputPolicy(html) {
  const enabled = diagnosticsEnabled("UI_INPUT");
  // A resolved boolean in metadata needs no executable content or CSP change.
  if (!/<head\b[^>]*>/i.test(html)) throw new Error("Pinned UI diagnostics bootstrap head changed.");
  return html.replace(/<head\b[^>]*>/i, tag => tag + `<meta name="azrael-ui-input-diagnostics" content="${enabled}"><meta name="azrael-ui-health-diagnostics" content="${diagnosticsEnabled("UI_HEALTH")}">`);
}

// A silent renderer is unobserved, never a proven process crash. VS Code owns
// the renderer process and its Crashpad/main/renderer logs, outside this API.
function monitorWebview(webview, logger, metadata, onDispose, clock = {}) {
  const now = clock.now ?? Date.now, every = clock.setInterval ?? setInterval, clear = clock.clearInterval ?? clearInterval;
  const webviewRef = require("node:crypto").randomUUID();
  let disposed = false, timer, lastBeat = null, hidden = true, silent = false, dragWarned = false;
  let lastPhase = "html_pending", tickAt = now(), lost = 0, count = 0, windowAt = now();
  const events = new Set(["bootstrap_evaluated", "heartbeat", "javascript_error", "resource_load_failed", "unhandled_rejection", "csp_violation", "drag_started", "drag_blocked", "drag_terminated", "visibility_changed", "page_hidden", "command_selection_attempt"]);
  function log(event, level = "info", fields = {}) {
    try {
      if (disposed || (level === "info" && !diagnosticsEnabled("UI_HEALTH"))) return;
      if (now() - windowAt >= 60000) { count = 0; windowAt = now(); }
      if (++count > 60) { lost++; return; }
      logger[level]("Azrael Webview health", { safe: { event: "ui_health." + event, webviewRef,
        component: "webview", observedAt: new Date(now()).toISOString(), platform: process.platform, arch: process.arch,
        extensionVersion: metadata.extensionVersion, role: ["sidebar", "editor"].includes(metadata.role) ? metadata.role : "other",
        lastPhase, ...fields, droppedCount: lost }, sensitive: {} }); lost = 0;
    } catch { lost++; }
  }
  const bounded = value => Number.isSafeInteger(value) && value >= 0 && value <= 86400000 ? value : undefined;
  function observe(message) {
    if (message?.type !== "log-message" || typeof message.message !== "string" || !message.message.startsWith("[azrael-ui-health] ")) return false;
    if (message.message.length > 1024) return true;
    try {
      const data = JSON.parse(message.message.slice(19));
      if (!data || !events.has(data.event)) return true;
      const fields = {};
      for (const key of ["hidden", "dragging", "commandArea"]) if (typeof data[key] === "boolean") fields[key] = data[key];
      for (const key of ["dragAgeMs", "droppedCount"]) if (bounded(data[key]) !== undefined) fields[key === "droppedCount" ? "rendererDroppedCount" : key] = data[key];
      if (["type_error", "range_error", "other"].includes(data.errorKind)) fields.errorKind = data.errorKind;
      if (["script", "link", "img"].includes(data.resourceKind)) fields.resourceKind = data.resourceKind;
      if (["drop", "dragend", "blur"].includes(data.terminal)) fields.terminal = data.terminal;
      if (["bootstrap_evaluated", "heartbeat", "visibility_changed"].includes(data.event)) {
        lastBeat = now(); hidden = data.hidden !== false;
        if (silent) { log("signal_resumed", "info"); silent = false; }
      }
      if (data.event === "heartbeat") {
        if (fields.rendererDroppedCount > 0) log("telemetry_dropped", "warn", { rendererDroppedCount: fields.rendererDroppedCount });
        if (data.dragging === true && fields.dragAgeMs >= 30000 && !dragWarned) { log("drag_end_unobserved", "warn", fields); dragWarned = true; }
        if (data.dragging === false) dragWarned = false;
      } else {
        if (data.event === "page_hidden") hidden = true;
        if (data.event === "drag_terminated") dragWarned = false;
        log(data.event, ["javascript_error", "resource_load_failed", "unhandled_rejection", "csp_violation"].includes(data.event) ? "error" : "info", fields);
      }
    } catch { /* malformed UI record is withheld, not promoted to a crash */ }
    return true;
  }
  const api = {
    observe,
    async prepare(load) {
      log("html_requested");
      try { const html = injectUiInputPolicy(await load()); lastPhase = "html_assigned"; log("html_prepared"); return html; }
      catch (error) { log("html_generation_failed", "error"); throw error; }
    },
    phase(phase) {
      if (!["renderer_entry_evaluated", "host_services_ready", "renderer_ready"].includes(phase)) return;
      lastPhase = phase; log("startup_phase");
    },
    startupTimeout() { log("startup_timeout", "error", { signalObserved: lastBeat !== null }); },
    lifecycle(event) {
      if (!["idle_suspended", "idle_restore_started", "idle_restore_failed", "idle_restored"].includes(event)) return;
      if (event === "idle_suspended") { hidden = true; lastBeat = null; silent = false; }
      log(event, event === "idle_restore_failed" ? "error" : "info");
    },
    start() {
      if (disposed || timer) return;
      tickAt = now();
      timer = every(() => {
        const gap = now() - tickAt; tickAt = now();
        if (gap > 30000) { log("host_observer_delayed", "warn", { gapMs: Math.min(gap, 86400000) }); lastBeat = lastBeat === null ? null : now(); return; }
        if (lastBeat !== null && !hidden && now() - lastBeat > 30000 && !silent) {
          silent = true; log("signal_lost", "warn", { signalAgeMs: Math.min(now() - lastBeat, 86400000), rendererExitConfirmed: false });
        }
      }, 10000); timer?.unref?.();
    },
    dispose() { if (disposed) return; log("disposed"); disposed = true; clear(timer); webviewHealth.delete(webview); }
  };
  webviewHealth.set(webview, api);
  onDispose(api.dispose);
  return api;
}
function recordWebviewLifecycle(webview, event) { webviewHealth.get(webview)?.lifecycle(event); }
// Content-free host sampling. Do not serialize application state to measure it:
// diagnostic work must not amplify the suspected storage/GC pressure.
function monitorHost(log, activeThreads, clock = {}) {
  const now = clock.now ?? (() => require("node:perf_hooks").performance.now());
  const every = clock.setInterval ?? setInterval, clear = clock.clearInterval ?? clearInterval;
  const host = clock.process ?? process;
  const hash = value => require("node:crypto").createHash("sha256").update(String(value)).digest("hex").slice(0, 16);
  let tickAt = now(), reportAt = tickAt, cpuAt = host.cpuUsage(), disposed = false;
  let completed = 0, failed = 0, maxDurationMs = 0, dropped = 0;
  const pending = new Map(), atoms = new Map();
  let sequence = 0;
  function report(event, delayMs = 0) {
    if (disposed) return;
    try {
      const memory = host.memoryUsage(), time = now(), cpu = host.cpuUsage();
      const threads = activeThreads().filter(value => typeof value === "string");
      log({ event: "host_health." + event, observedAt: new Date().toISOString(),
        platform: host.platform, arch: host.arch, nodeVersion: host.version,
        rssBytes: memory.rss, heapUsedBytes: memory.heapUsed, heapTotalBytes: memory.heapTotal,
        externalBytes: memory.external, arrayBufferBytes: memory.arrayBuffers,
        heapLimitBytes: require("node:v8").getHeapStatistics().heap_size_limit,
        cpuUserMicros: Math.max(0, cpu.user - cpuAt.user), cpuSystemMicros: Math.max(0, cpu.system - cpuAt.system),
        intervalMs: Math.max(0, Math.round(time - reportAt)), observerDelayMs: Math.round(delayMs),
        activeThreadCount: threads.length, threadRefs: [...new Set(threads)].slice(0, 8).map(hash),
        statePending: pending.size, stateCompleted: completed, stateFailed: failed,
        stateOldestMs: Math.round(Math.max(0, ...[...pending.values()].map(start => time - start))),
        stateMaxDurationMs: Math.round(maxDurationMs), atomUpdates: [...atoms].map(([atomRef, count]) => ({ atomRef, count })),
        droppedDiagnostics: dropped, rendererExitConfirmed: false });
      reportAt = time; cpuAt = cpu; completed = failed = maxDurationMs = dropped = 0; atoms.clear();
    } catch { dropped++; }
  }
  report("started");
  const timer = every(() => {
    const time = now(), delay = Math.max(0, time - tickAt - 5000); tickAt = time;
    if (delay >= 2000 || time - reportAt >= 30000) report(delay >= 2000 ? "observer_delayed" : "sample", delay);
  }, 5000);
  timer?.unref?.();
  return {
    async measure(atom, operation) {
      if (disposed) return operation();
      const start = now(), id = ++sequence;
      // Bound diagnostic state independently of the host's actual queue.
      const tracked = pending.size < 128;
      if (tracked) pending.set(id, start); else dropped++;
      try { const ref = hash(atom); if (atoms.has(ref) || atoms.size < 16) atoms.set(ref, (atoms.get(ref) ?? 0) + 1); else dropped++; }
      catch { dropped++; }
      try { return await operation(); }
      catch (error) { failed++; throw error; }
      finally { if (tracked) pending.delete(id); completed++; maxDurationMs = Math.max(maxDurationMs, now() - start); }
    },
    dispose() { if (disposed) return; report("disposed"); disposed = true; clear(timer); pending.clear(); atoms.clear(); }
  };
}
module.exports = { parseDiagnosticBoolean, diagnosticsEnabled, injectUiInputPolicy, monitorWebview, recordWebviewLifecycle, monitorHost };
