"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { monitorWebview, recordWebviewLifecycle, injectUiInputPolicy } = require("./optional-diagnostics.cjs");
const { installUiHealth } = require("./ui-health-runtime.cjs");
const secret = "PRIVATE-command-token-path-and-stack";
function fixture(loggerFailure = false) {
  let time = 0, dispose;
  const timers = new Map(), records = [], webview = {};
  const logger = Object.fromEntries(["info", "warn", "error"].map(level => [level, (description, record) => {
    if (loggerFailure) throw Error(secret);
    records.push({ level, description, ...record.safe });
  }]));
  const monitor = monitorWebview(webview, logger, { extensionVersion: "test", role: "sidebar" }, fn => { dispose = fn; }, {
    now: () => time, setInterval: fn => { const id = {}; timers.set(id, fn); return id; }, clearInterval: id => timers.delete(id)
  });
  const send = data => monitor.observe({ type: "log-message", message: "[azrael-ui-health] " + JSON.stringify(data) });
  return { monitor, send, records, webview, timers, dispose: () => dispose(), advance: (ms, tick = true) => { time += ms; if (tick) for (const fn of timers.values()) fn(); } };
}
test("host distinguishes startup, JS/resource/CSP failure, pending drag, signal loss and recovery with one correlation", async () => {
  const f = fixture();
  assert.match(await f.monitor.prepare(async () => "<html><head></head></html>"), /ui-health-diagnostics/);
  f.monitor.start(); f.monitor.phase("renderer_entry_evaluated"); f.monitor.phase("renderer_ready");
  for (const event of ["bootstrap_evaluated", "javascript_error", "resource_load_failed", "csp_violation", "unhandled_rejection", "drag_blocked"])
    f.send({ event, hidden: false, errorKind: "type_error", resourceKind: "script", stack: secret, url: secret, text: secret });
  f.send({ event: "heartbeat", hidden: false, dragging: true, dragAgeMs: 35000 });
  for (let n = 0; n < 4; n++) f.advance(10000);
  const lost = f.records.find(r => r.event === "ui_health.signal_lost");
  assert.equal(lost.rendererExitConfirmed, false); assert.equal(lost.lastPhase, "renderer_ready");
  f.send({ event: "heartbeat", hidden: false, dragging: false });
  f.monitor.startupTimeout();
  for (const suffix of ["html_prepared", "startup_phase", "javascript_error", "resource_load_failed", "csp_violation", "unhandled_rejection", "drag_blocked", "drag_end_unobserved", "signal_lost", "signal_resumed", "startup_timeout"])
    assert.ok(f.records.some(r => r.event === "ui_health." + suffix), suffix);
  assert.equal(new Set(f.records.map(r => r.webviewRef)).size, 1);
  assert.ok(!JSON.stringify(f.records).includes(secret));
  f.dispose(); assert.equal(f.timers.size, 0);
});
test("hidden views, host observer gaps and deliberate idle blanking are distinguished from lost renderer signals", () => {
  const f = fixture(); f.monitor.start();
  f.send({ event: "bootstrap_evaluated", hidden: true }); for (let i = 0; i < 5; i++) f.advance(10000);
  f.send({ event: "visibility_changed", hidden: false }); f.advance(60000);
  assert.ok(f.records.some(r => r.event === "ui_health.host_observer_delayed"));
  assert.ok(!f.records.some(r => r.event === "ui_health.signal_lost"));
  recordWebviewLifecycle(f.webview, "idle_suspended");
  for (let i = 0; i < 5; i++) f.advance(10000);
  for (const event of ["idle_restore_started", "idle_restore_failed", "idle_restored"]) recordWebviewLifecycle(f.webview, event);
  assert.ok(!f.records.some(r => r.event === "ui_health.signal_lost"));
  assert.equal(f.records.find(r => r.event === "ui_health.idle_restore_failed").level, "error"); f.dispose();
});
test("logging failures, rate bounds, malformed input and HTML failure preserve product outcomes without leaking errors", async () => {
  const f = fixture(); const failure = Error(secret);
  await assert.rejects(f.monitor.prepare(() => Promise.reject(failure)), error => error === failure);
  assert.equal(f.records.at(-1).event, "ui_health.html_generation_failed");
  assert.equal(f.monitor.observe({ type: "ready" }), false);
  assert.equal(f.monitor.observe({ type: "log-message", message: "[azrael-ui-health] {" }), true);
  f.send({ event: secret });
  for (let n = 0; n < 100; n++) f.send({ event: "javascript_error", errorKind: secret });
  assert.ok(f.records.length <= 60); f.advance(60000, false); f.send({ event: "unhandled_rejection" });
  assert.ok(f.records.at(-1).droppedCount > 0); assert.ok(!JSON.stringify(f.records).includes(secret)); f.dispose();
  const broken = fixture(true); await broken.monitor.prepare(async () => "<head></head>"); broken.monitor.start(); broken.advance(60000); broken.dispose();
});
function uiFixture(disabled = false) {
  const doc = new EventTarget(); doc.hidden = false; doc.querySelector = () => ({ content: String(!disabled) });
  const view = new EventTarget(); const timers = new Map(), messages = [];
  Object.assign(view, { document: doc, queueMicrotask, setInterval: fn => { timers.set(1, fn); return 1; }, clearInterval: id => timers.delete(id) });
  const dispose = installUiHealth(view, data => messages.push(data));
  const fire = (target, type, data = {}, cancel = false) => {
    const event = new Event(type, { cancelable: true }); for (const [k, v] of Object.entries(data)) Object.defineProperty(event, k, { value: v });
    target.dispatchEvent(event); if (cancel) event.preventDefault();
  };
  return { view, doc, messages, timers, dispose, fire };
}
test("renderer serializes allowlisted evidence, observes cancelled drags and disposes; diagnostic failure never cancels user input", async () => {
  const u = uiFixture();
  u.fire(u.view, "error", { error: { name: "TypeError", stack: secret }, message: secret });
  u.fire(u.view, "error", { target: { tagName: "SCRIPT", src: secret } });
  u.fire(u.view, "unhandledrejection", { reason: Error(secret) }); u.fire(u.doc, "securitypolicyviolation", { blockedURI: secret });
  u.fire(u.view, "dragstart", { target: { closest: () => ({}) } }, true); await Promise.resolve();
  assert.equal(u.messages.at(-1).event, "drag_blocked"); u.timers.get(1)(); assert.equal(u.messages.at(-1).dragging, false);
  u.fire(u.view, "dragstart"); await Promise.resolve(); u.fire(u.view, "drop");
  assert.equal(u.messages.at(-1).event, "drag_terminated");
  assert.ok(!JSON.stringify(u.messages).includes(secret));
  for (let i = 0; i < 40; i++) u.fire(u.view, "error");
  u.timers.get(1)(); assert.equal(u.messages.at(-1).event, "heartbeat"); assert.ok(u.messages.at(-1).droppedCount > 0);
  u.fire(u.view, "pagehide"); assert.equal(u.timers.size, 0); const count = u.messages.length; u.fire(u.view, "error"); assert.equal(u.messages.length, count);
  const disabled = uiFixture(true); assert.equal(disabled.messages.length, 0); assert.equal(disabled.timers.size, 0);
  const failure = uiFixture(); failure.dispose(); assert.doesNotThrow(() => installUiHealth(failure.view, () => { throw Error(secret); })());
});
test("UI health policy can be disabled independently of input diagnostics", () => {
  const old = process.env.AZRAEL_DIAGNOSTICS_UI_HEALTH;
  try { process.env.AZRAEL_DIAGNOSTICS_UI_HEALTH = "off"; assert.match(injectUiInputPolicy("<head></head>"), /ui-health-diagnostics" content="false"/); }
  finally { if (old === undefined) delete process.env.AZRAEL_DIAGNOSTICS_UI_HEALTH; else process.env.AZRAEL_DIAGNOSTICS_UI_HEALTH = old; }
});
