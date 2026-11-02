"use strict";
const { randomUUID } = require("node:crypto");

class DialogService {
  constructor({ send, onVisibility = () => {} }) {
    this.send = send;
    this.onVisibility = onVisibility;
    this.queue = [];
    this.active = undefined;
    this.disposed = false;
  }
  requestInput(options = {}, token) { return this.request("input", options, undefined, token); }
  requestPick(items, options = {}, token) {
    if (!Array.isArray(items)) return Promise.reject(new TypeError("Quick pick items must be an array"));
    return this.request("pick", options, items, token);
  }
  request(kind, options, items, token) {
    if (this.disposed || token?.isCancellationRequested) return Promise.resolve(undefined);
    return new Promise(resolve => {
      const entry = { id: randomUUID(), kind, options, items, resolve, revision: 0 };
      this.queue.push(entry);
      entry.subscription = token?.onCancellationRequested(() => this.finish(entry, undefined));
      if (token?.isCancellationRequested) this.finish(entry, undefined);
      else this.advance();
    });
  }
  advance() {
    if (this.active || this.disposed) return;
    const next = this.queue.shift();
    if (!next) return;
    this.active = next;
    this.onVisibility(true);
    const options = {};
    for (const key of ["title", "prompt", "placeHolder", "password", "value", "valueSelection", "canPickMany", "matchOnDescription", "matchOnDetail"]) {
      if (next.options[key] !== undefined) options[key] = next.options[key];
    }
    this.send({ type: "dialog", action: "show", id: next.id, kind: next.kind, options,
      ...(next.items ? { items: next.items.map((item, index) => typeof item === "string" ? { index, label: item } : { index, label: item.label, description: item.description, detail: item.detail, picked: !!item.picked, kind: item.kind, alwaysShow: !!item.alwaysShow }) } : {}),
    });
  }
  finish(entry, result) {
    const queued = this.queue.indexOf(entry);
    if (queued >= 0) this.queue.splice(queued, 1);
    const wasActive = this.active === entry;
    if (!wasActive && queued < 0) return;
    entry.revision++;
    entry.subscription?.dispose();
    if (wasActive) {
      this.active = undefined;
      this.send({ type: "dialog", action: "close", id: entry.id });
      if (!this.queue.length || this.disposed) this.onVisibility(false);
    }
    entry.resolve(result);
    this.advance();
  }
  async handle(message) {
    const entry = this.active;
    if (!entry || entry.id !== message?.id) return false;
    if (message.action === "cancel") { this.finish(entry, undefined); return true; }
    if (message.action !== "accept" && message.action !== "change") return false;
    if (entry.kind === "pick") {
      if (message.action !== "accept") return false;
      const indices = message.indices;
      if (!Array.isArray(indices) || indices.some(index => !Number.isInteger(index) || index < 0 || index >= entry.items.length || entry.items[index]?.kind === -1)) return false;
      const selected = [...new Set(indices)].sort((a, b) => a - b);
      if (!entry.options.canPickMany && selected.length !== 1) return false;
      this.finish(entry, entry.options.canPickMany ? selected.map(index => entry.items[index]) : entry.items[selected[0]]);
      return true;
    }
    if (typeof message.value !== "string") return false;
    const revision = ++entry.revision;
    let result;
    try { result = await entry.options.validateInput?.(message.value); }
    catch { result = "입력값을 확인하지 못했습니다. 다시 시도해 주세요."; }
    if (this.active !== entry || revision !== entry.revision) return true;
    const error = typeof result === "string" ? result : result?.message;
    const severity = typeof result === "string" ? 3 : result?.severity ?? 3;
    const blocked = !!error && severity === 3;
    this.send({ type: "dialog", action: "validation", id: entry.id, error: error || "", severity, blocked });
    if (message.action === "accept" && !blocked) this.finish(entry, message.value);
    return true;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const entry of [...this.queue]) this.finish(entry, undefined);
    if (this.active) this.finish(this.active, undefined);
  }
}
module.exports = { DialogService };
