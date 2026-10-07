'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const tasks = require('./window-task-macros.cjs');
const { createRegistry } = require('./window-control-occupancy.cjs');
const ACTIONS = Object.freeze(['invoke', 'setValue', 'toggle', 'select', 'expand', 'collapse', 'scroll']);
const TOOLS = Object.freeze(['list_windows', 'select_window', 'inspect', 'press_key', 'list_task_macros', 'save_task_macro', 'run_task_macro', 'capture', 'status', 'restore_window', 'invoke', 'set_value', 'toggle', 'select', 'expand', 'collapse', 'scroll', 'resize', 'run_size_macro']);
const OVERLAY_LABELS = Object.freeze({ capture: '화면 확인 중', inspect: '화면 요소 확인 중', invoke: '버튼 실행 중', set_value: '입력값 변경 중', toggle: '전환 중', select: '항목 선택 중', expand: '펼치는 중', collapse: '접는 중', scroll: '스크롤 중', press_key: '키 전달 중', wait_for: '결과 대기 중', assert: '결과 확인 중', resize: '창 크기 변경 중', run_size_macro: '창 크기 변경 중', run_task_macro: '매크로 실행 중' });
const { expectedError, windowError } = require('./window-control-errors.cjs');
const fail = message => { throw expectedError(message); };
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
function createWindowOwner({ backend, authorize, approve, onUserStop = () => {}, onOverlayError = () => {}, codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), now = Date.now, occupancyDirectory, workspaceName = 'Azrael' }) {
  if (!backend || typeof backend.request !== 'function' || typeof authorize !== 'function') fail('Backend and authorization required');
  const bindings = new Map(); const candidates = new Map(); const selections = new Map(); const taskStore = tasks.createStore(codexHome); let queue = Promise.resolve(); let disposed = false;
  const userStoppedTargets = new Map();
  workspaceName = path.win32.basename(String(workspaceName).replace(/[\x00-\x1f]/g, '')).slice(0,256) || 'Azrael';
  const occupancy = createRegistry({ directory: occupancyDirectory || path.join(codexHome, 'azrael', 'window-use', 'occupancy'), now, entries: () => [...bindings].map(([sessionId,b]) => ({ sessionId, workspaceName, state: b.running && b.state !== 'paused' ? 'running' : b.state, window: Object.fromEntries(['hwnd','pid','processCreated','executable'].map(k => [k,b.identity[k]])) })) });
  const occupancyOf = (w, thread) => { occupancy.publish(); return occupancy.read(w, thread); };
  const macroPath = path.join(codexHome, 'azrael', 'computer-use', 'window-macros.json');
  const serial = fn => { const result = queue.then(() => { if (disposed) fail('Owner disposed'); return fn(); }); queue = result.catch(() => {}); return result; };
  const get = id => { str(id); const b = bindings.get(id); if (!b) fail('No selected window'); return b; };
  const canRestore = b => !b.userStopped && (b.state !== 'paused' || b.pauseReason === 'minimized');
  const restoreAllowed = b => canRestore(b) && (b.window.minimized || (b.state === 'paused' && b.pauseReason === 'minimized'));
  const view = b => ({ occupancy: occupancyOf(b.identity, b.thread), targetId: b.targetId, state: b.state, ...(b.state === 'paused' ? { pauseReason: b.pauseReason || 'error' } : {}), restoreAllowed: restoreAllowed(b), window: safeWindow(b.window), supportedActions: [...ACTIONS] });
  const pause = (b, reason) => {
    const previous = b.state === 'paused' ? b.pauseReason : undefined;
    b.state = 'paused'; b.observation = null;
    b.pauseReason = b.userStopped ? 'user_stopped' : reason === 'minimized' && previous && previous !== 'minimized' ? previous : reason;
  };
  const minimizedError = (b, cause) => {
    pause(b, 'minimized');
    return windowError('window_minimized', '선택한 창이 최소화되었습니다. restore_window로 복원 가능 여부를 확인해주세요.', { pauseReason: b.pauseReason, restoreAllowed: restoreAllowed(b), ...(cause?.mutationOutcome === 'unknown' ? {} : { actionExecuted: false }), ...(cause ? { cause, nativeCode: cause.nativeCode, mutationOutcome: cause.mutationOutcome } : {}) });
  };
  const hideOverlay = (b, generation) => {
    if (typeof backend.hideOverlay === 'function') return backend.hideOverlay({ targetId: b.targetId, generation }).catch(error => onOverlayError(b.thread, error));
  };
  const stopBinding = (thread, userStopped = false) => {
    cancelSelection(thread);
    const b = bindings.get(thread); if (!b) return { state: 'unbound' };
    const generation = b.generation;
    b.generation++;
    if (userStopped) {
      b.userStopped = true;
      const stopped = userStoppedTargets.get(thread) || [];
      if (!stopped.some(identity => same(identity, b.identity))) stopped.push({ ...b.identity });
      userStoppedTargets.set(thread, stopped);
    }
    pause(b, userStopped ? 'user_stopped' : 'error');
    void hideOverlay(b, generation);
    return view(b);
  };
  const overlaySubscription = backend.onOverlayStop?.(event => {
    if (disposed) return;
    const b = [...bindings.values()].find(binding => binding.running && binding.targetId === event.targetId && binding.generation === event.generation);
    if (!b) return; // A late event cannot stop another run or a newly selected window.
    const value = stopBinding(b.thread, true);
    onUserStop(b.thread, value);
  });
  async function showOverlay(b, thread, generation, tool, prefix = '') {
    if (typeof backend.showOverlay !== 'function') return;
    await guard(b, thread, generation);
    const result = await backend.showOverlay({ window: { ...b.identity }, targetId: b.targetId, generation, label: prefix + (OVERLAY_LABELS[tool] || '창 제어 중') });
    if (result?.visible !== true || typeof result.hotkeyRegistered !== 'boolean') fail('Invalid Window overlay response');
    await guard(b, thread, generation);
  }
  async function guard(b, thread, generation) {
    if (disposed || bindings.get(thread) !== b || b.generation !== generation) fail('Operation cancelled');
    if (!await authorize({ ...b.identity }, thread)) { pause(b, 'error'); b.generation++; occupancy.publish(); fail('Application authorization revoked'); }
    if (disposed || bindings.get(thread) !== b || b.generation !== generation) fail('Operation cancelled');
  }
  async function request(b, thread, generation, method, params = {}) {
    await guard(b, thread, generation);
    let result;
    try { result = await backend.request(method, { ...params, window: { ...b.identity } }); }
    catch (error) {
      const minimized = error.code === 'window_minimized' || error.nativeCode === 'window-minimized';
      const current = !disposed && bindings.get(thread) === b && b.generation === generation;
      const geometryChanged = ['observe','inspect'].includes(method) && error.code === 'state_changed' && error.nativeCode === 'capture-size-changed' && error.mutationOutcome !== 'unknown';
      const resizeRejected = method === 'resize' && error.mutationOutcome !== 'unknown' &&
        ((error.nativeCode === 'not-resizable' && error.code === 'unsupported_action') || (error.nativeCode === 'resize-bounds' && error.code === 'invalid_request'));
      if (['act','resize','restore'].includes(method) && !minimized && !['unsupported_action','state_changed','invalid_request'].includes(error.code)) error.mutationOutcome = 'unknown';
      if (current) {
        b.observation = null;
        if (!geometryChanged && !resizeRejected) { pause(b, minimized ? 'minimized' : 'error'); b.generation++; }
        occupancy.publish();
      }
      if (minimized && current) throw minimizedError(b, error);
      throw error;
    }
    try { await guard(b, thread, generation); } catch (error) { if (['act','resize','restore'].includes(method)) error.mutationOutcome = 'unknown'; throw error; }
    let w; try {w = descriptor(result?.window || result);} catch(e) {pause(b,'error');b.generation++;occupancy.publish();throw e;}
    if (!same(b.identity, w)) { pause(b, 'error'); b.generation++; occupancy.publish(); fail('Selected window identity changed'); }
    if (b.observation && (b.window.widthPx !== w.widthPx || b.window.heightPx !== w.heightPx || b.window.dpi !== w.dpi)) b.observation = null;
    b.window = w;
    if (w.minimized) {
      pause(b, 'minimized');
      if (method !== 'status') throw minimizedError(b);
    }
    occupancy.publish(); return result;
  }
  async function ready(b, thread, generation, allowRestore) {
    await request(b, thread, generation, 'status');
    if (b.window.minimized) {
      if (!allowRestore || b.restoreAttempted) throw minimizedError(b);
      b.restoreAttempted = true;
      await request(b, thread, generation, 'restore');
      if (b.window.minimized) throw minimizedError(b);
    }
    b.state = 'ready'; delete b.pauseReason;
  }
  async function observe(b, thread, generation) {
    const r = await requestObservation(b, thread, generation, 'observe');
    str(r.observationId); str(r.frameTimestamp);
    const frameDimension = value => Number.isInteger(value) && value > 0 && value <= 16384;
    if (r.window.minimized || !frameDimension(r.widthPx) || !frameDimension(r.heightPx) || r.dpi !== b.window.dpi || !Array.isArray(r.elements) || !plain(r.image) || r.image.mimeType !== 'image/png' || typeof r.image.data !== 'string' || !r.image.data.length || !/^[A-Za-z0-9+/]*={0,2}$/.test(r.image.data)) fail('Invalid selected-window observation');
    const elements = elementsOf(r);
    b.observation = { id: r.observationId, generation, ids: new Set(elements.map(e => e.id)) }; b.used = true;
    return { ...view(b), observationId: r.observationId, frameTimestamp: r.frameTimestamp, widthPx: r.widthPx, heightPx: r.heightPx, dpi: r.dpi, elementsTruncated: r.elementsTruncated, elements, image: { mimeType: 'image/png', data: r.image.data } };
  }
  function elementsOf(r) {
    if (!Array.isArray(r.elements)) fail('Invalid elements');
    if (typeof r.elementsTruncated !== 'boolean') fail('Invalid elementsTruncated');
    const elements = r.elements.map(e => {
      str(e.id); if (typeof e.name !== 'string' || typeof e.controlType !== 'string' || !Array.isArray(e.patterns) || e.patterns.some(p => typeof p !== 'string')) fail('Invalid element');
      const out = { id:e.id, name:e.name, controlType:e.controlType, patterns:[...e.patterns] };
      for (const key of ['automationId','parentId','enabled','isPassword','value','selected','toggleState','expandState']) if (Object.hasOwn(e,key)) out[key] = e[key];
      for (const key of ['enabled','isPassword','selected']) if (Object.hasOwn(out,key) && typeof out[key] !== 'boolean') fail('Invalid element property');
      for (const key of ['automationId','value']) if (Object.hasOwn(out,key) && typeof out[key] !== 'string') fail('Invalid element property');
      if (Object.hasOwn(out,'parentId') && out.parentId !== null && typeof out.parentId !== 'string') fail('Invalid element parent');
      if (Object.hasOwn(out,'toggleState') && !['off','on','indeterminate'].includes(out.toggleState)) fail('Invalid toggle state');
      if (Object.hasOwn(out,'expandState') && !['collapsed','expanded','partial','leaf'].includes(out.expandState)) fail('Invalid expand state');
      if (out.isPassword) delete out.value;
      return out;
    });
    if (new Set(elements.map(e => e.id)).size !== elements.length) fail('Duplicate element IDs'); return elements;
  }
  async function inspect(b, thread, generation) {
    const r = await requestObservation(b, thread, generation, 'inspect'); str(r.observationId); const elements = elementsOf(r);
    b.observation = {id:r.observationId,generation,ids:new Set(elements.map(e => e.id))}; b.used = true;
    return {...view(b),observationId:r.observationId,elementsTruncated:r.elementsTruncated,elements};
  }
  async function requestObservation(b, thread, generation, method) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try { return await request(b, thread, generation, method); }
      catch (error) {
        if (error.code !== 'state_changed' || error.nativeCode !== 'capture-size-changed' || error.mutationOutcome === 'unknown' || attempt === 2) throw error;
        // Re-read identity, authority and minimized state before replacing an
        // invalid snapshot. Only read-only observations are ever retried.
        await ready(b, thread, generation, false);
      }
    }
  }
  async function bindInternal(thread, selected) {
    str(thread); const identity = descriptor(selected);
    const generation = 0; const b = {thread,identity,window:identity,targetId:crypto.randomUUID(),state:'selected',generation,used:false,restoreAttempted:false,observation:null,selectedAt:now()};
    const old = bindings.get(thread); if(old) {old.generation++; old.observation = null;} bindings.set(thread,b);
    occupancy.publish();
    try { await request(b,thread,generation,'status'); return view(b); } catch(e) {if(bindings.get(thread) === b) bindings.delete(thread); occupancy.publish(); throw e;}
  }
  function cancelSelection(thread) { selections.set(thread,(selections.get(thread) || 0)+1); candidates.delete(thread); }
  function discovery(thread,tool,args) {
    try {
      str(thread);
      if(tool === 'list_windows' || tool === 'list_task_macros') keys(args,[]);
      if(tool === 'select_window') {keys(args,['candidateId'],['candidateId']);str(args.candidateId);}
      if(tool === 'save_task_macro') {keys(args,['definition'],['definition']);args = {definition:tasks.definition(args.definition,true)};}
    } catch(e) {return Promise.reject(e);}
    const selection = selections.get(thread) || 0;
    return serial(async () => {
      if(tool === 'list_task_macros') return taskStore.read();
      if(tool === 'save_task_macro') return taskStore.save(args.definition);
      if(tool === 'list_windows') {
        candidates.delete(thread); const raw = await backend.request('listWindows',{}); if(!Array.isArray(raw)) fail('Invalid window list');
        if((selections.get(thread) || 0) !== selection) fail('Operation cancelled');
        const entries = new Map(raw.map(w => [crypto.randomUUID(),descriptor(w)])); candidates.set(thread,entries);
        return {candidates:[...entries].map(([candidateId,w]) => ({candidateId,appName:path.win32.basename(w.executable),title:w.title,minimized:w.minimized,occupancy:occupancyOf(w,thread)}))};
      }
      const identity = candidates.get(thread)?.get(args.candidateId); if(!identity) fail('Stale or forged window candidate');
      if ((userStoppedTargets.get(thread) || []).some(stopped => same(stopped, identity))) fail('Selected window paused by the user; explicit resume required');
      const old = bindings.get(thread); if(old) {old.generation++;old.observation = null;}
      const check = () => {if(disposed || (selections.get(thread) || 0) !== selection || candidates.get(thread)?.get(args.candidateId) !== identity) fail('Operation cancelled');};
      check(); const raw = await backend.request('listWindows',{}); check();
      if(!Array.isArray(raw) || !raw.map(descriptor).some(w => same(w,identity))) fail('Window candidate identity changed');
      if(approve) {if(!await approve({...identity},thread)) fail('Application approval declined');check();}
      const current = await backend.request('status',{window:{...identity}});check();
      const fresh = descriptor(current?.window || current); if(!same(fresh,identity)) fail('Window candidate identity changed');
      const result = await bindInternal(thread,fresh); check(); candidates.delete(thread); return result;
    });
  }
  async function locked(fn) {
    await fs.mkdir(path.dirname(macroPath), { recursive: true });
    let lock;
    try { lock = await fs.open(macroPath + '.lock', 'wx'); } catch (e) { if (e.code === 'EEXIST') fail('Macro storage busy'); throw e; }
    try { return await fn(); } finally { await lock.close(); await fs.unlink(macroPath + '.lock'); }
  }
  async function readMacros() {
    try { return await readStoredMacros(); } catch (cause) { throw windowError('unclassified', '', { stage: 'storage', cause }); }
  }
  async function readStoredMacros() {
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
    listWindows: thread => serial(async () => { const result = await backend.request('listWindows', {}); if (!Array.isArray(result)) fail('Invalid window list'); return result.map(w => ({...descriptor(w),occupancy:occupancyOf(w,thread)})); }),
    bind: (thread, selected) => { cancelSelection(thread); const selection = selections.get(thread); return serial(async () => { if (selections.get(thread) !== selection) fail('Operation cancelled'); const result = await bindInternal(thread, selected); userStoppedTargets.set(thread, (userStoppedTargets.get(thread) || []).filter(identity => !same(identity, selected))); return result; }); },
    status: thread => serial(async () => { if (!bindings.has(thread)) return {state:'unbound',supportedActions:[...ACTIONS]}; const b = get(thread); await request(b, thread, b.generation, 'status'); return view(b); }),
    resume: thread => serial(async () => { const b = get(thread); const generation = ++b.generation; b.userStopped = false; b.state = 'selected'; delete b.pauseReason; userStoppedTargets.set(thread, (userStoppedTargets.get(thread) || []).filter(identity => !same(identity, b.identity))); b.observation = null; b.restoreAttempted = false; await ready(b, thread, generation, true); return observe(b, thread, generation); }),
    stop: thread => stopBinding(thread, true),
    clear: thread => { cancelSelection(thread); const b = bindings.get(thread); if (b) { hideOverlay(b, b.generation); b.generation++; } bindings.delete(thread); userStoppedTargets.delete(thread); occupancy.publish(); },
    invalidateObservation: thread => { const b = bindings.get(thread); if (b) { hideOverlay(b, b.generation); b.generation++; b.observation = null; return view(b); } },
    peek: thread => { const b = bindings.get(thread); return b ? view(b) : undefined; },
    dispose: () => { disposed = true; overlaySubscription?.dispose(); for (const b of bindings.values()) { hideOverlay(b, b.generation); b.generation++; } bindings.clear(); userStoppedTargets.clear(); candidates.clear(); selections.clear(); occupancy.dispose(); },
    getMacros: () => serial(() => locked(readMacros)),
    saveMacro: entry => { const checked = macro(entry); return serial(() => locked(async () => { const entries = await readMacros(); const next = entries.filter(m => m.id !== checked.id).concat(checked); if (next.length > 100) fail('Too many macros'); await writeMacros(next); return checked; })); },
    deleteMacro: id => { str(id, 128); return serial(() => locked(async () => { const entries = await readMacros(); await writeMacros(entries.filter(m => m.id !== id)); })); },
    call: (thread, tool, args) => {
      if (!TOOLS.includes(tool)) return Promise.reject(new Error('Unsupported selected-window tool'));
      if (['list_windows','select_window','list_task_macros','save_task_macro'].includes(tool)) return discovery(thread,tool,args);
      if (tool === 'status' && !bindings.has(thread)) { try { keys(args,['targetId']); if(Object.hasOwn(args,'targetId')) fail('Stale or forged target'); } catch(e) {return Promise.reject(e);} return serial(() => ({state:'unbound',supportedActions:[...ACTIONS]})); }
      const action = tool === 'set_value' ? 'setValue' : tool === 'press_key' ? 'pressKey' : tool;
      try {
        const allowed = ['targetId']; const required = tool === 'status' ? [] : ['targetId'];
        if (ACTIONS.includes(action) || action === 'pressKey') { allowed.push('observationId', 'elementId'); required.push('observationId', 'elementId'); if (action === 'setValue' || action === 'scroll') { allowed.push('value'); required.push('value'); } }
        if (action === 'pressKey') {allowed.push('key');required.push('key');}
        if (tool === 'run_task_macro') {allowed.push('definition','macroId','parameters');if(Boolean(args?.definition) === Boolean(args?.macroId)) fail('Provide definition or macroId');if(args?.definition) args = {...args,definition:tasks.definition(args.definition)};if(args?.macroId) str(args.macroId,128);if(args?.parameters !== undefined && !plain(args.parameters)) fail('Invalid task parameters');args = {...args,parameters:{...(args.parameters || {})}};}
        if (tool === 'resize') { allowed.push('widthDip', 'heightDip'); required.push('widthDip', 'heightDip'); }
        if (tool === 'run_size_macro') { allowed.push('macroId'); required.push('macroId'); }
        keys(args, allowed, required); if (Object.hasOwn(args, 'targetId')) str(args.targetId);
        if (ACTIONS.includes(action) || action === 'pressKey') {
          str(args.observationId); str(args.elementId);
          if (action === 'setValue' && (typeof args.value !== 'string' || args.value.length > 32768)) fail('Invalid value');
          if (action === 'scroll') { keys(args.value, ['horizontal', 'vertical'], ['horizontal', 'vertical']); if ([args.value.horizontal, args.value.vertical].some(v => !Number.isInteger(v) || v < -2 || v > 2)) fail('Invalid scroll amount'); }
        }
        if (action === 'pressKey' && !tasks.KEYS.includes(args.key)) fail('Unsupported key');
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
        if (tool === 'restore_window') {
          if (!canRestore(b)) fail('Selected window paused; user resume required');
          await request(b, thread, generation, 'status');
          if (!canRestore(b)) fail('Selected window paused; user resume required');
          b.observation = null;
          let restored = false;
          if (b.window.minimized) {
            const result = await request(b, thread, generation, 'restore');
            if (typeof result?.restored !== 'boolean') {
              pause(b, 'error'); b.generation++; occupancy.publish();
              throw windowError('unclassified', '', { mutationOutcome: 'unknown' });
            }
            restored = result.restored;
          }
          await guard(b, thread, generation);
          if (b.window.minimized) throw minimizedError(b);
          b.state = 'ready'; delete b.pauseReason;
          occupancy.publish();
          return { ...view(b), restored, observationRequired: true };
        }
        if (b.state === 'paused') { if (b.pauseReason === 'minimized') throw minimizedError(b); fail('Selected window paused; user resume required'); }
        b.running = true; occupancy.publish();
        try {
        await showOverlay(b, thread, generation, tool);
        if (tool === 'run_task_macro') {
          const stored = args.definition ? null : await taskStore.read(); const snapshot = args.definition || stored.macros.find(m => m.id === args.macroId);if(!snapshot) fail('Unknown task macro');
          const result = await tasks.run(snapshot,args.parameters,{progress:async ({index,total,action,phase}) => showOverlay(b,thread,generation,phase === 'verifying' ? 'assert' : action,(index+1)+'/'+total+' · '),cancel:() => {if(bindings.get(thread) === b && b.generation === generation) {b.generation++;pause(b,'error');}},guard:() => guard(b,thread,generation),inspect:async() => {await ready(b,thread,generation,false);return inspect(b,thread,generation);},capture:async() => {await ready(b,thread,generation,false);return observe(b,thread,generation);},act:async params => {await ready(b,thread,generation,false);const observation = b.observation;if(!observation || observation.id !== params.observationId || !observation.ids.has(params.elementId)) fail('Fresh selected-window observation required');b.observation = null;await request(b,thread,generation,'act',params);b.used = true;}});
          return {...result,occupancy:occupancyOf(b.identity,thread),...(stored ? {revision:stored.revision,macroId:args.macroId} : {})};
        }
        await ready(b, thread, generation, false);
        if (tool === 'capture') return await observe(b, thread, generation);
        if (tool === 'inspect') return await inspect(b,thread,generation);
        if (ACTIONS.includes(action) || action === 'pressKey') {
          const observation = b.observation;
          if (!observation || observation.generation !== generation || observation.id !== args.observationId || !observation.ids.has(args.elementId)) fail('Fresh selected-window observation required');
          b.observation = null;
          await request(b, thread, generation, 'act', { observationId: args.observationId, elementId: args.elementId, action, ...(action === 'pressKey' ? {value:args.key} : Object.hasOwn(args, 'value') ? { value: args.value } : {}) });
          b.used = true; return { ...view(b), observationRequired: true, ...(action === 'pressKey' ? {delivery:'windowMessage',verified:false} : {}) };
        }
        b.observation = null;
        const steps = tool === 'resize' ? [{ widthDip: args.widthDip, heightDip: args.heightDip }] : await locked(async () => { const entry = (await readMacros()).find(m => m.id === args.macroId); if (!entry) fail('Unknown macro'); return entry.steps; });
        let result;
        for (const step of steps) { await guard(b, thread, generation); await ready(b, thread, generation, false); await request(b, thread, generation, 'resize', step); result = await observe(b, thread, generation); }
        return result;
        }
        finally { await hideOverlay(b, generation); b.running = false; occupancy.publish(); }
      });
    },
  };
}
module.exports = { createWindowOwner, ACTIONS, TOOLS };
