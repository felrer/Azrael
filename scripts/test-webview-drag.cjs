"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { patchWorkbenchDragRecovery, MARKER } = require("./patch-vscode-webview-drag.cjs");
const { injectLocalFileDrop, DROP_ASSET } = require("./inject-local-file-drop.cjs");

const source = 'var Monitor=class extends E{constructor(o,e){super();let t=()=>{e()?.windowDidDragStart()},i=()=>{e()?.windowDidDragEnd()};this._register(G(o,ie.DRAG_START,()=>{t()})),this._register(G(o,ie.DRAG_END,i)),this._register(G(o,ie.MOUSE_MOVE,n=>{n.buttons===0&&i()})),this._register(G(o,ie.DRAG,n=>{n.shiftKey?i():t()})),this._register(G(o,ie.DRAG_OVER,n=>{n.shiftKey?i():t()}))}};';
class Events {
  constructor() { this.listeners = new Map(); this.hidden = false; }
  addEventListener(name, fn) { const set = this.listeners.get(name) ?? new Set(); set.add(fn); this.listeners.set(name, set); }
  removeEventListener(name, fn) { this.listeners.get(name)?.delete(fn); }
  emit(name, fields = {}) { for (const fn of [...this.listeners.get(name) ?? []]) fn(fields); }
}
function monitor(patched) {
  const view = new Events(); view.document = new Events();
  const states = [{ pointer: "auto" }, { pointer: "auto" }];
  const ctx = { E: class { constructor() { this.disposables = []; } _register(d) { this.disposables.push(d); } dispose() { for (const d of this.disposables) d.dispose(); } }, G: (t, n, f) => { t.addEventListener(n, f); return { dispose: () => t.removeEventListener(n, f) }; }, ie: { DRAG_START: "dragstart", DRAG_END: "dragend", MOUSE_MOVE: "mousemove", DRAG: "drag", DRAG_OVER: "dragover" } };
  vm.createContext(ctx); vm.runInContext(patched ? patchWorkbenchDragRecovery(source).text : source, ctx);
  const instances = states.map(s => new ctx.Monitor(view, () => ({ windowDidDragStart() { s.pointer = "none"; }, windowDidDragEnd() { s.pointer = "auto"; } })));
  return { view, states, instances };
}
test("host drop restores every registered view without filtering transfer format", () => {
  for (const patched of [false, true]) {
    const { view, states } = monitor(patched);
    view.emit("dragover", { shiftKey: false }); assert.ok(states.every(s => s.pointer === "none"));
    view.emit("drop"); assert.ok(states.every(s => s.pointer === (patched ? "auto" : "none")));
  }
});
test("host cancellation and disposal recover, while visible state and active drag stay intact", () => {
  for (const end of ["dragend", "blur", "hidden", "dispose"]) {
    const { view, states, instances } = monitor(true); view.emit("dragover");
    view.document.emit("visibilitychange"); assert.ok(states.every(s => s.pointer === "none"));
    if (end === "hidden") { view.document.hidden = true; view.document.emit("visibilitychange"); }
    else if (end === "dispose") instances.forEach(m => m.dispose());
    else view.emit(end);
    assert.ok(states.every(s => s.pointer === "auto"));
  }
  const { view, states } = monitor(true); view.emit("dragover"); view.emit("dragover", { shiftKey: true }); assert.ok(states.every(s => s.pointer === "auto"));
});
test("host transform is idempotent and rejects unknown, ambiguous and damaged inputs", () => {
  const patched = patchWorkbenchDragRecovery(source).text;
  assert.equal(patchWorkbenchDragRecovery(patched).changed, false);
  assert.throws(() => patchWorkbenchDragRecovery("unknown"), /Unsupported/);
  assert.throws(() => patchWorkbenchDragRecovery(source + source), /Unsupported/);
  assert.throws(() => patchWorkbenchDragRecovery(patched.replace('"drop"', '"oops"')), /Damaged/);
  assert.throws(() => patchWorkbenchDragRecovery(MARKER), /Damaged/);
});
function composer() {
  const asset = fs.readFileSync(path.join(__dirname, "../artifacts/upstream-ui/26.1007.21434", DROP_ASSET), "utf8");
  const patched = injectLocalFileDrop(asset, DROP_ASSET).text;
  const start = patched.indexOf("function SFi(e){"), end = patched.indexOf("var CFi,v7;", start);
  const view = new Events(); view.document = new Events(); const target = new Events(), cleanups = [], ref = { current: 0 }, state = { active: false, shift: false }, files = [];
  const ctx = { window: view, CFi: { c: n => Array(n).fill(Symbol()) }, v7: { useState: () => [null, () => {}], useEffectEvent: f => f, useEffect: f => cleanups.push(f()) }, kPe: t => t?.recognized === true, Sl: () => false, pei: () => false, Bme: t => ({ files: t?.files ?? [], imageFiles: [], otherFiles: t?.files ?? [] }), azraelHasLocalFileTransfer: () => false, azraelDropLocalFileReferences: () => false, HTMLElement: class {} };
  vm.createContext(ctx);
  const { installWebviewDragCancellation } = require("./webview-drag-lifecycle.cjs");
  vm.runInContext(installWebviewDragCancellation.toString() + patched.slice(start, end), ctx);
  const api = ctx.SFi({ dragCounterRef: ref, dropTargetPortalTarget: target, isDragActive: false, setIsDragActive: v => state.active = v, setShowShiftOverlay: v => state.shift = v, addFiles: f => files.push(f) });
  const event = (type, recognized = true) => ({ type, target: {}, dataTransfer: { recognized }, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} });
  return { api, event, state, ref, view, target, cleanups, files };
}
test("composer nested exits balance even if transfer types are unavailable", () => {
  const c = composer(); c.api.handleDragEnter(c.event("dragenter")); c.api.handleDragEnter(c.event("dragenter"));
  c.api.handleDragLeave(c.event("dragleave", false)); assert.equal(c.state.active, true); assert.equal(c.ref.current, 1);
  c.api.handleDragLeave(c.event("dragleave", false)); assert.equal(c.state.active, false); assert.equal(c.ref.current, 0);
});
test("composer cancellation and portal replacement clear flags and remove listeners", () => {
  for (const end of ["drop", "dragend", "blur", "hidden", "portal"]) {
    const c = composer(); c.api.handleDragEnter(c.event("dragenter"));
    if (end === "portal") c.cleanups[0]();
    else if (end === "hidden") { c.view.document.hidden = true; c.view.document.emit("visibilitychange"); }
    else c.view.emit(end);
    assert.equal(c.state.active, false); assert.equal(c.state.shift, false); assert.equal(c.ref.current, 0);
    c.cleanups.forEach(fn => fn?.()); assert.equal([...c.view.listeners.values()].flatMap(s => [...s]).length, 0);
  }
});
test("composer file drop and Shift drag remain functional", () => {
  const c = composer(); const enter = c.event("dragenter"); enter.shiftKey = true;
  c.api.handleDragEnter(enter); assert.equal(c.state.active, true); assert.equal(c.state.shift, false);
  const drop = c.event("drop"); drop.dataTransfer.files = [{ name: "fixture.txt" }];
  c.api.handleDrop(drop); assert.equal(c.files.length, 1); assert.equal(c.state.active, false); assert.equal(drop.defaultPrevented, true);
});
