'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const ACTIONS = Object.freeze(['invoke', 'setValue', 'toggle', 'select', 'expand', 'collapse', 'scroll']);
const TOOLS = Object.freeze(['capture', 'status', 'invoke', 'set_value', 'toggle', 'select', 'expand', 'collapse', 'scroll', 'resize', 'run_size_macro']);
const fail = message => { throw new Error(message); };
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
function keys(value, allowed, required = []) {
  if (!plain(value) || Object.keys(value).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(value, key))) fail('Invalid arguments');
}
function str(value, max = 256) { if (typeof value !== 'string' || !value.length || value.length > max || /[\x00-\x1f]/.test(value)) fail('Invalid string'); return value; }
function size(value) { if (!Number.isFinite(value) || value < 100 || value > 8192) fail('Size must be between 100 and 8192 DIP'); return value; }
function descriptor(value) {
  if (!plain(value)) fail('Invalid window descriptor');
  str(value.hwnd); if (!Number.isSafeInteger(value.pid) || value.pid <= 0) fail('Invalid window PID');
  str(value.processCreated); str(value.executable, 32768);
  if (typeof value.title !== 'string' || typeof value.minimized !== 'boolean' || !Number.isFinite(value.widthPx) || value.widthPx < 0 || !Number.isFinite(value.heightPx) || value.heightPx < 0 || !Number.isFinite(value.dpi) || value.dpi <= 0) fail('Invalid window descriptor');
  return Object.fromEntries(['hwnd', 'pid', 'processCreated', 'executable', 'title', 'minimized', 'widthPx', 'heightPx', 'dpi'].map(key => [key, value[key]]));
}
function same(a, b) { return ['hwnd', 'pid', 'processCreated', 'executable'].every(key => a[key] === b[key]); }
function safeWindow(w) { return Object.fromEntries(['title', 'widthPx', 'heightPx', 'dpi', 'minimized'].map(key => [key, w[key]])); }
function macro(value) {
  keys(value, ['id', 'name', 'steps'], ['id', 'name', 'steps']); str(value.id, 128); str(value.name, 128);
  if (!Array.isArray(value.steps) || value.steps.length < 1 || value.steps.length > 10) fail('Macros require 1 to 10 steps');
  return { id: value.id, name: value.name, steps: value.steps.map(step => { keys(step, ['widthDip', 'heightDip'], ['widthDip', 'heightDip']); return { widthDip: size(step.widthDip), heightDip: size(step.heightDip) }; }) };
}
function createWindowOwner({ backend, authorize, codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), now = Date.now }) {
  if (!backend || typeof backend.request !== 'function' || typeof authorize !== 'function') fail('Backend and authorization required');
  const bindings = new Map(); let queue = Promise.resolve(); let disposed = false;
  const macroPath = path.join(codexHome, 'azrael', 'computer-use', 'window-macros.json');
  const serial = fn => { const result = queue.then(() => { if (disposed) fail('Owner disposed'); return fn(); }); queue = result.catch(() => {}); return result; };
  const get = id => { str(id); const b = bindings.get(id); if (!b) fail('No selected window'); return b; };
  const view = b => ({ targetId: b.targetId, state: b.state, window: safeWindow(b.window), supportedActions: [...ACTIONS] });
  async function guard(b, thread, generation) {
    if (disposed || bindings.get(thread) !== b || b.generation !== generation) fail('Operation cancelled');
    if (!await authorize({ ...b.identity }, thread)) { b.state = 'paused'; b.observation = null; b.generation++; fail('Application authorization revoked'); }
    if (disposed || bindings.get(thread) !== b || b.generation !== generation) fail('Operation cancelled');
  }
  async function request(b, thread, generation, method, params = {}) {
    await guard(b, thread, generation);
    let result;
    try { result = await backend.request(method, { ...params, window: { ...b.identity } }); }
    catch (error) {
      if (!disposed && bindings.get(thread) === b && b.generation === generation) { b.state = 'paused'; b.observation = null; b.generation++; }
      throw error;
    }
    await guard(b, thread, generation);
    const w = descriptor(result?.window || result);
    if (!same(b.identity, w)) { b.state = 'paused'; b.generation++; b.observation = null; fail('Selected window identity changed'); }
    if (b.observation && (b.window.widthPx !== w.widthPx || b.window.heightPx !== w.heightPx || b.window.dpi !== w.dpi)) b.observation = null;
    b.window = w;
    if (w.minimized && b.used && method === 'status') { b.state = 'paused'; b.observation = null; }
    return result;
  }
  async function ready(b, thread, generation, allowRestore) {
    await request(b, thread, generation, 'status');
    if (b.window.minimized) {
      if (!allowRestore || b.restoreAttempted) { b.state = 'paused'; b.observation = null; fail('Window minimized; user resume required'); }
      b.restoreAttempted = true;
      await request(b, thread, generation, 'restore');
      if (b.window.minimized) { b.state = 'paused'; fail('Window remains minimized; user resume required'); }
    }
    b.state = 'ready';
  }
  async function observe(b, thread, generation) {
    const r = await request(b, thread, generation, 'observe');
    str(r.observationId); str(r.frameTimestamp);
    const frameDimension = value => Number.isInteger(value) && value > 0 && value <= 16384;
    if (r.window.minimized || !frameDimension(r.widthPx) || !frameDimension(r.heightPx) || r.dpi !== b.window.dpi || !Array.isArray(r.elements) || !plain(r.image) || r.image.mimeType !== 'image/png' || typeof r.image.data !== 'string' || !r.image.data.length || !/^[A-Za-z0-9+/]*={0,2}$/.test(r.image.data)) fail('Invalid selected-window observation');
    const elements = r.elements.map(e => { str(e.id); if (typeof e.name !== 'string' || typeof e.controlType !== 'string' || !Array.isArray(e.patterns) || e.patterns.some(p => typeof p !== 'string')) fail('Invalid element'); return { id: e.id, name: e.name, controlType: e.controlType, patterns: [...e.patterns] }; });
    if (new Set(elements.map(e => e.id)).size !== elements.length) fail('Duplicate element IDs');
    b.observation = { id: r.observationId, generation, ids: new Set(elements.map(e => e.id)) }; b.used = true;
    return { ...view(b), observationId: r.observationId, frameTimestamp: r.frameTimestamp, widthPx: r.widthPx, heightPx: r.heightPx, dpi: r.dpi, elements, image: { mimeType: 'image/png', data: r.image.data } };
  }
  async function locked(fn) {
    await fs.mkdir(path.dirname(macroPath), { recursive: true });
    let lock;
    try { lock = await fs.open(macroPath + '.lock', 'wx'); } catch (e) { if (e.code === 'EEXIST') fail('Macro storage busy'); throw e; }
    try { return await fn(); } finally { await lock.close(); await fs.unlink(macroPath + '.lock'); }
  }
  async function readMacros() {
    let raw; try { raw = await fs.readFile(macroPath, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
    if (raw.length > 1024 * 1024) fail('Macro storage corrupt');
    let parsed; try { parsed = JSON.parse(raw); } catch { fail('Macro storage corrupt'); }
    keys(parsed, ['schema', 'macros'], ['schema', 'macros']);
    if (parsed.schema !== 1 || !Array.isArray(parsed.macros) || parsed.macros.length > 100) fail('Macro storage corrupt');
    const entries = parsed.macros.map(macro); if (new Set(entries.map(m => m.id)).size !== entries.length) fail('Macro storage corrupt'); return entries;
  }
  async function writeMacros(macros) {
    const temp = macroPath + '.' + crypto.randomUUID() + '.tmp';
    try { await fs.writeFile(temp, JSON.stringify({ schema: 1, macros }), { flag: 'wx', mode: 0o600 }); await fs.rename(temp, macroPath); } finally { await fs.unlink(temp).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
  }
  return {
    listWindows: () => serial(async () => { const result = await backend.request('listWindows', {}); if (!Array.isArray(result)) fail('Invalid window list'); return result.map(descriptor); }),
    bind: (thread, selected) => serial(async () => {
      str(thread); const identity = descriptor(selected);
      const generation = 0; const b = { identity, window: identity, targetId: crypto.randomUUID(), state: 'selected', generation, used: false, restoreAttempted: false, observation: null, selectedAt: now() };
      const old = bindings.get(thread); if (old) old.generation++;
      bindings.set(thread, b);
      try { await request(b, thread, generation, 'status'); return view(b); } catch (e) { if (bindings.get(thread) === b) bindings.delete(thread); throw e; }
    }),
    status: thread => serial(async () => { const b = get(thread); await request(b, thread, b.generation, 'status'); return view(b); }),
    resume: thread => serial(async () => { const b = get(thread); const generation = ++b.generation; b.observation = null; b.restoreAttempted = false; await ready(b, thread, generation, true); return observe(b, thread, generation); }),
    stop: thread => { const b = get(thread); b.generation++; b.state = 'paused'; b.observation = null; return view(b); },
    clear: thread => { const b = bindings.get(thread); if (b) b.generation++; bindings.delete(thread); },
    invalidateObservation: thread => { const b = bindings.get(thread); if (b) { b.generation++; b.observation = null; return view(b); } },
    peek: thread => { const b = bindings.get(thread); return b ? view(b) : undefined; },
    dispose: () => { disposed = true; for (const b of bindings.values()) b.generation++; bindings.clear(); },
    getMacros: () => serial(() => locked(readMacros)),
    saveMacro: entry => { const checked = macro(entry); return serial(() => locked(async () => { const entries = await readMacros(); const next = entries.filter(m => m.id !== checked.id).concat(checked); if (next.length > 100) fail('Too many macros'); await writeMacros(next); return checked; })); },
    deleteMacro: id => { str(id, 128); return serial(() => locked(async () => { const entries = await readMacros(); await writeMacros(entries.filter(m => m.id !== id)); })); },
    call: (thread, tool, args) => {
      if (!TOOLS.includes(tool)) return Promise.reject(new Error('Unsupported selected-window tool'));
      const action = tool === 'set_value' ? 'setValue' : tool;
      try {
        const allowed = ['targetId']; const required = tool === 'status' ? [] : ['targetId'];
        if (ACTIONS.includes(action)) { allowed.push('observationId', 'elementId'); required.push('observationId', 'elementId'); if (action === 'setValue' || action === 'scroll') { allowed.push('value'); required.push('value'); } }
        if (tool === 'resize') { allowed.push('widthDip', 'heightDip'); required.push('widthDip', 'heightDip'); }
        if (tool === 'run_size_macro') { allowed.push('macroId'); required.push('macroId'); }
        keys(args, allowed, required); if (Object.hasOwn(args, 'targetId')) str(args.targetId);
        if (ACTIONS.includes(action)) {
          str(args.observationId); str(args.elementId);
          if (action === 'setValue' && (typeof args.value !== 'string' || args.value.length > 32768)) fail('Invalid value');
          if (action === 'scroll') { keys(args.value, ['horizontal', 'vertical'], ['horizontal', 'vertical']); if ([args.value.horizontal, args.value.vertical].some(v => !Number.isInteger(v) || v < -2 || v > 2)) fail('Invalid scroll amount'); }
        }
        if (tool === 'resize') { size(args.widthDip); size(args.heightDip); }
        if (tool === 'run_size_macro') str(args.macroId, 128);
        args = { ...args, ...(action === 'scroll' ? { value: { ...args.value } } : {}) };
      } catch (e) { return Promise.reject(e); }
      // Capture the binding generation at submission, so Stop also cancels queued calls.
      let b; try { b = get(thread); } catch (e) { return Promise.reject(e); }
      const generation = b.generation;
      return serial(async () => {
        await guard(b, thread, generation);
        if (Object.hasOwn(args, 'targetId') && args.targetId !== b.targetId) fail('Stale or forged target');
        if (tool === 'status') { await request(b, thread, generation, 'status'); const macros = await locked(readMacros); await guard(b, thread, generation); return { ...view(b), macros }; }
        if (b.state === 'paused') fail('Selected window paused; user resume required');
        await ready(b, thread, generation, !b.used);
        if (tool === 'capture') return observe(b, thread, generation);
        if (ACTIONS.includes(action)) {
          const observation = b.observation;
          if (!observation || observation.generation !== generation || observation.id !== args.observationId || !observation.ids.has(args.elementId)) fail('Fresh selected-window observation required');
          b.observation = null;
          await request(b, thread, generation, 'act', { observationId: args.observationId, elementId: args.elementId, action, ...(Object.hasOwn(args, 'value') ? { value: args.value } : {}) });
          b.used = true; return { ...view(b), observationRequired: true };
        }
        b.observation = null;
        const steps = tool === 'resize' ? [{ widthDip: args.widthDip, heightDip: args.heightDip }] : await locked(async () => { const entry = (await readMacros()).find(m => m.id === args.macroId); if (!entry) fail('Unknown macro'); return entry.steps; });
        let result;
        for (const step of steps) { await guard(b, thread, generation); await ready(b, thread, generation, false); await request(b, thread, generation, 'resize', step); result = await observe(b, thread, generation); }
        return result;
      });
    },
  };
}
module.exports = { createWindowOwner, ACTIONS, TOOLS };
