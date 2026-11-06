'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const tasks = require('./window-task-macros.cjs');
const { createRegistry, createLeaseCoordinator } = require('./window-control-occupancy.cjs');
const ACTIONS = Object.freeze(['invoke', 'setValue', 'toggle', 'select', 'expand', 'collapse', 'scroll']);
const TOOLS = Object.freeze(['context', 'capture_desktop', 'desktop_input', 'release_desktop_input', 'list_windows', 'inspect', 'press_key', 'list_task_macros', 'save_task_macro', 'run_task_macro', 'capture', 'switched_input', 'release_switched_input', 'status', 'restore_window', 'invoke', 'set_value', 'toggle', 'select', 'expand', 'collapse', 'scroll', 'resize', 'run_size_macro']);
const OVERLAY_LABELS = Object.freeze({ capture: '화면 확인 중', inspect: '화면 요소 확인 중', invoke: '버튼 실행 중', set_value: '입력값 변경 중', toggle: '전환 중', select: '항목 선택 중', expand: '펼치는 중', collapse: '접는 중', scroll: '스크롤 중', press_key: '키 전달 중', wait_for: '결과 대기 중', assert: '결과 확인 중', resize: '창 크기 변경 중', run_size_macro: '창 크기 변경 중', run_task_macro: '매크로 실행 중' });
const OBSERVATION_FAILURES = new Set(['stale-element', 'stale-observation', 'unknown-element', 'uia-value-limit',
  'capture-size-changed', 'capture-timeout', 'provider-timeout', 'backend-timeout', 'native-error',
  'capture-device', 'capture-format', 'capture-encode', 'capture-clock', 'capture-size',
  'capture-unsupported', 'protected-target', 'unobservable-target']);
const INPUT_REJECTIONS = new Set(['stale-observation', 'unknown-element', 'stale-element',
  'unsupported-action', 'unsupported-key', 'disabled-element', 'readonly-element']);
const { expectedError, windowError } = require('./window-control-errors.cjs');
const fail = message => { throw expectedError(message); };
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
function keys(value, allowed, required = []) {
  if (!plain(value) || Object.keys(value).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(value, key))) fail('Invalid arguments');
}
function str(value, max = 256) { if (typeof value !== 'string' || !value.length || value.length > max || /[\x00-\x1f]/.test(value)) fail('Invalid string'); return value; }
function size(value) { if (!Number.isFinite(value) || value < 100 || value > 8192) fail('Size must be between 100 and 8192 DIP'); return value; }
function validateInspect(args) {
  const mode = args.mode || 'summary';
  if(!['summary','find','read','changes'].includes(mode)) fail('Invalid inspection mode');
  if(args.limit !== undefined && (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 100)) fail('Invalid inspection limit');
  if(args.query !== undefined) {
    keys(args.query,['name','automationId','controlType']);
    for(const key of ['automationId','controlType']) if(args.query[key] !== undefined) str(args.query[key],512);
    if(args.query.name !== undefined) {keys(args.query.name,['equals','contains']);if(Object.keys(args.query.name).length !== 1) fail('Specify one name condition');for(const v of Object.values(args.query.name)) str(v,512);}
  }
  if(args.scope !== undefined) {keys(args.scope,['containerId'],['containerId']);str(args.scope.containerId);}
  for(const key of ['observationId','elementId','baseObservationId']) if(args[key] !== undefined) str(args[key]);
  if(mode === 'find' && (!plain(args.query) || !Object.keys(args.query).length)) fail('Find requires a query');
  if(mode === 'read' && (!args.observationId || !args.elementId)) fail('Read requires observation and element IDs');
  if(args.fields !== undefined && (!Array.isArray(args.fields) || args.fields.length > 12 || args.fields.some(k => !['name','controlType','automationId','patterns','enabled','isPassword','value','selected','toggleState','expandState','text'].includes(k)))) fail('Invalid read fields');
  if(args.textRange !== undefined) {keys(args.textRange,['start','length'],['start','length']);if(!Number.isSafeInteger(args.textRange.start) || args.textRange.start < 0 || !Number.isInteger(args.textRange.length) || args.textRange.length < 1 || args.textRange.length > 4096) fail('Invalid text range');}
  if(mode !== 'read' && ['fields','textRange','elementId'].some(k => Object.hasOwn(args,k))) fail('Read fields require read mode');
  if(mode === 'changes' && !args.baseObservationId) fail('Changes requires a base observation');
}
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
function createWindowOwner({ backend, authorize, approve, requestPermission, context, desktopCapture, desktopInput, resolveDesktopWindow, releaseDesktopInput, visualizeAction, observationAllowed, virtualInput, switchedInput, onUserStop = () => {}, onOverlayError = () => {}, codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), now = Date.now, occupancyDirectory, workspacePath, workspaceName = 'Azrael', isCancelled = () => false, leaseWaitMs = 30000 }) {
  if (!backend || typeof backend.request !== 'function' || typeof authorize !== 'function') fail('Backend and authorization required');
  const scopedBindings = new Map(); const bindings = new Map(); const candidates = new Map(); const selections = new Map(); const taskStore = tasks.createStore(codexHome, workspacePath); let queue = Promise.resolve(); let disposed = false;
  const userStoppedTargets = new Map();
  const allBindings = () => [...new Set([...bindings.values(),...scopedBindings.values()])];
  const hasBinding = (thread,b) => b.thread===thread && (bindings.get(thread)===b || scopedBindings.get(b.targetId)===b);
  const leases = createLeaseCoordinator({directory:path.join(occupancyDirectory || path.join(codexHome,'azrael','window-use','occupancy'),'claims'),now,workspaceName});
  const activeLeases = new Map(), sessionCleanups = new Map();
  async function withLease(thread,identity,control,check,fn) {
    const deadline=Date.now()+leaseWaitMs;
    let lease;
    while(!lease) {
      check();
      try {lease=leases.begin(identity,thread,control);} catch(error) {
        if(error.code!=='window_busy'||Date.now()>=deadline||((activeLeases.get(thread)||0)>0||leases.hasOther(identity,thread)))throw error;
        await new Promise(resolve=>setTimeout(resolve,50));
      }
    }
    if(control)activeLeases.set(thread,(activeLeases.get(thread)||0)+1);
    let finishAction;
    try {if(control){while(!finishAction){check();try{finishAction=leases.beginAction();}catch(error){if(Date.now()>=deadline)throw error;await new Promise(resolve=>setTimeout(resolve,50));}}}check();return await fn(lease);} finally {try{finishAction?.();}finally {try{lease.complete();}finally{if(control)activeLeases.set(thread,activeLeases.get(thread)-1);}}}
  }
  const checkCancelled = thread => {if(disposed||isCancelled(thread))fail('Operation cancelled');};
  const desktops = new Map(), desktopReleases = new Set();
  const desktopState = thread => { str(thread); if(!desktops.has(thread))desktops.set(thread,{generation:0,observation:null,stopped:false});return desktops.get(thread); };
  const invalidateDesktop = (thread,stopped=false) => { const d=desktopState(thread);d.generation++;d.observation=null;d.stopped ||= stopped;return d; };
  const releaseDesktopQuietly = (thread,refreshIdle=false) => { let pins=[],pinError;try{if(releaseDesktopInput||refreshIdle)pins=leases.pinSession(thread,refreshIdle);}catch(error){pinError=error;}const pending=Promise.resolve().then(()=>{if(pinError)throw pinError;return releaseDesktopInput?.(thread);}).then(result=>{for(const pin of pins)pin.complete();return result;});desktopReleases.add(pending);void pending.then(()=>desktopReleases.delete(pending),error=>{desktopReleases.delete(pending);onOverlayError(thread,error);});return pending; };
  const virtualReleases = new Map();
  function releaseVirtual(thread) {
    if (!virtualInput && !switchedInput) return Promise.resolve({detached:true});
    let pins;try{pins=leases.pinSession(thread);}catch(error){return Promise.reject(error);}
    const previous = virtualReleases.get(thread);
    const pending = (previous ? previous.catch(() => {}) : Promise.resolve()).then(async () => {const results=await Promise.allSettled([virtualInput?.release(thread),switchedInput?.release(thread)]);const failed=results.find(r=>r.status==='rejected');if(failed)throw failed.reason;for(const pin of pins)pin.complete();return {detached:true};});
    virtualReleases.set(thread,pending);
    void pending.then(() => {if(virtualReleases.get(thread)===pending) virtualReleases.delete(thread);}, error => onOverlayError(thread,error));
    return pending;
  }
  const releaseQuietly = thread => {void releaseVirtual(thread).catch(() => {});};
  workspaceName = (process.platform === 'win32' ? path.win32 : path).basename(String(workspaceName).replace(/[\x00-\x1f]/g, '')).slice(0,256) || 'Azrael';
  const occupancy = createRegistry({ directory: occupancyDirectory || path.join(codexHome, 'azrael', 'window-use', 'occupancy'), now, entries: () => allBindings().map(b => ({ sessionId:b.thread, workspaceName, state: b.running && b.state !== 'paused' ? 'running' : b.state, window: Object.fromEntries(['hwnd','pid','processCreated','executable'].map(k => [k,b.identity[k]])) })) });
  const occupancyOf = (w, thread) => leases.read(w,thread);
  const macroPath = path.join(codexHome, 'azrael', 'computer-use', 'window-macros.json');
  const serial = fn => { const result = queue.then(() => { if (disposed) fail('Owner disposed'); return fn(); }); queue = result.catch(() => {}); return result; };
  const get = id => { str(id); const b = bindings.get(id); if (!b) fail('No selected window'); return b; };
  const canRestore = b => !b.userStopped && (b.state !== 'paused' || b.pauseReason === 'minimized');
  const restoreAllowed = b => canRestore(b) && (b.window.minimized || (b.state === 'paused' && b.pauseReason === 'minimized'));
  const mayExposeTitle = (identity,thread) => { try { return !observationAllowed || observationAllowed(identity,thread) === true; } catch { return false; } };
  const view = b => ({ occupancy: occupancyOf(b.identity, b.thread), targetId: b.targetId, windowId: b.targetId, state: b.state, ...(b.state === 'paused' ? { pauseReason: b.pauseReason || 'error' } : {}), ...(b.state === 'ready' && !b.observation ? { observationRequired: true } : {}), restoreAllowed: restoreAllowed(b), window: {...safeWindow(b.window),...(!mayExposeTitle(b.identity,b.thread)?{title:''}:{})}, supportedActions: [...ACTIONS] });
  const pause = (b, reason) => {
    const previous = b.state === 'paused' ? b.pauseReason : undefined;
    b.state = 'paused'; b.observation = null; releaseQuietly(b.thread);
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
    invalidateDesktop(thread,userStopped);releaseDesktopQuietly(thread);
    cancelSelection(thread);
    const targets=allBindings().filter(b=>b.thread===thread); const b=bindings.get(thread)||targets[0]; if(!b){void releaseOwnedSession(thread).catch(error=>onOverlayError(thread,error));return {state:'unbound'};} for(const other of targets){if(other===b)continue;other.generation++;if(userStopped){other.userStopped=true;const stopped=userStoppedTargets.get(thread)||[];if(!stopped.some(w=>same(w,other.identity)))stopped.push({...other.identity});userStoppedTargets.set(thread,stopped);}pause(other,userStopped?'user_stopped':'error');}
    const generation = b.generation;
    b.generation++;
    if (userStopped) {
      b.userStopped = true;
      const stopped = userStoppedTargets.get(thread) || [];
      if (!stopped.some(identity => same(identity, b.identity))) stopped.push({ ...b.identity });
      userStoppedTargets.set(thread, stopped);
    }
    pause(b, userStopped ? 'user_stopped' : 'error');
    releaseQuietly(thread);
    void hideOverlay(b, generation);
    void releaseOwnedSession(thread).catch(error=>onOverlayError(thread,error));
    return view(b);
  };
  function releaseOwnedSession(thread) {
    let pins;try{pins=leases.pinSession(thread);}catch(error){return Promise.reject(error);}
    const pending=Promise.all([sessionCleanups.get(thread),virtualReleases.get(thread),...desktopReleases]).then(()=>{for(const pin of pins)pin.complete();leases.releaseSession(thread);});
    sessionCleanups.set(thread,pending);
    return pending;
  }
  const overlaySubscription = backend.onOverlayStop?.(event => {
    if (disposed) return;
    const b = allBindings().find(binding => binding.running && binding.targetId === event.targetId && binding.generation === event.generation);
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
    if (disposed || isCancelled(thread) || !hasBinding(thread,b) || b.generation !== generation) fail('Operation cancelled');
    if (!await authorize({ ...b.identity }, thread, { permission: b.operationPermission || 'observation', operation: b.operation || 'status' })) { pause(b, 'error'); b.generation++; releaseQuietly(thread); occupancy.publish(); throw windowError('permission_denied','Window Use authorization required or revoked'); }
    if (disposed || !hasBinding(thread,b) || b.generation !== generation) fail('Operation cancelled');
  }
  async function request(b, thread, generation, method, params = {}) {
    await guard(b, thread, generation);
    if(['act','resize','restore'].includes(method) && !await authorize({...b.identity},thread,{permission:'control',operation:method})) fail('Application authorization revoked');
    let result;
    try { result = await backend.request(method, { ...params, window: { ...b.identity } }); }
    catch (error) {
      const minimized = error.code === 'window_minimized' || error.nativeCode === 'window-minimized';
      const current = !disposed && hasBinding(thread,b) && b.generation === generation;
      const geometryChanged = ['observe','inspect'].includes(method) && error.code === 'state_changed' && error.nativeCode === 'capture-size-changed' && error.mutationOutcome !== 'unknown';
      const observationFailed = ['observe','inspect','status'].includes(method) && error.mutationOutcome !== 'unknown' &&
        (OBSERVATION_FAILURES.has(error.nativeCode) || (!error.nativeCode && ['timeout','connection_error'].includes(error.code))) &&
        !['cancelled','permission_denied'].includes(error.code);
      const inputRejected = method === 'act' && INPUT_REJECTIONS.has(error.nativeCode) && error.mutationOutcome !== 'unknown' &&
        !['cancelled','permission_denied'].includes(error.code);
      const resizeRejected = method === 'resize' && error.mutationOutcome !== 'unknown' &&
        ((error.nativeCode === 'not-resizable' && error.code === 'unsupported_action') || (error.nativeCode === 'resize-bounds' && error.code === 'invalid_request'));
      if (['act','resize','restore'].includes(method) && !minimized && !inputRejected && !['unsupported_action','state_changed','invalid_request'].includes(error.code)) error.mutationOutcome = 'unknown';
      if (current) {
        b.observation = null;
        if (!minimized && !b.userStopped && b.state !== 'paused' && (observationFailed || inputRejected || resizeRejected)) {
          // No input is replayed. The next observation revalidates identity and
          // authority in ready(); a late failure must not clear Stop/revocation.
          await guard(b, thread, generation);
          b.state = 'ready'; delete b.pauseReason;
          error.recovery = 'observe_again'; error.observationRequired = true; error.actionExecuted = false;
        } else if (!geometryChanged && !resizeRejected) { pause(b, minimized ? 'minimized' : 'error'); b.generation++; }
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
    b.observation = { lease:b.requestLease || leases.observation(b.identity,thread), id: r.observationId, kind:'image', generation, ids: new Set(elements.map(e => e.id)) }; b.used = true;
    return { ...view(b), observationId: r.observationId, frameTimestamp: r.frameTimestamp, widthPx: r.widthPx, heightPx: r.heightPx, dpi: r.dpi, elementsTruncated: r.elementsTruncated, elements, image: { mimeType: 'image/png', data: r.image.data } };
  }
  function elementsOf(r) {
    if (!Array.isArray(r.elements)) fail('Invalid elements');
    if (typeof r.elementsTruncated !== 'boolean') fail('Invalid elementsTruncated');
    const elements = r.elements.map(e => {
      str(e.id); if (typeof e.name !== 'string' || typeof e.controlType !== 'string' || (e.patterns !== undefined && (!Array.isArray(e.patterns) || e.patterns.some(p => typeof p !== 'string')))) fail('Invalid element');
      const out = { id:e.id, name:e.name, controlType:e.controlType, ...(e.patterns ? {patterns:[...e.patterns]} : {}) };
      for (const key of ['automationId','parentId','enabled','isPassword','value','valueTruncated','text','textRange','selected','toggleState','expandState']) if (Object.hasOwn(e,key)) out[key] = e[key];
      for (const key of ['enabled','isPassword','selected']) if (Object.hasOwn(out,key) && typeof out[key] !== 'boolean') fail('Invalid element property');
      for (const key of ['automationId','value']) if (Object.hasOwn(out,key) && typeof out[key] !== 'string') fail('Invalid element property');
      if (Object.hasOwn(out,'parentId') && out.parentId !== null && typeof out.parentId !== 'string') fail('Invalid element parent');
      if (Object.hasOwn(out,'toggleState') && !['off','on','indeterminate'].includes(out.toggleState)) fail('Invalid toggle state');
      if (Object.hasOwn(out,'expandState') && !['collapsed','expanded','partial','leaf'].includes(out.expandState)) fail('Invalid expand state');
      if (out.isPassword) {delete out.value;delete out.text;}
      return out;
    });
    if (new Set(elements.map(e => e.id)).size !== elements.length) fail('Duplicate element IDs'); return elements;
  }
  async function inspect(b, thread, generation, options = {}) {
    const r = await requestObservation(b, thread, generation, 'inspect', options); str(r.observationId); const elements = elementsOf(r);
    b.observation = {lease:b.requestLease || leases.observation(b.identity,thread),id:r.observationId,generation,ids:new Set(elements.map(e => e.id))}; b.used = true;
    const metadata = {};
    for (const key of ['retrieval','changes']) if(Object.hasOwn(r,key)) metadata[key] = r[key];
    return {...view(b),observationId:r.observationId,elementsTruncated:r.elementsTruncated,elements,...metadata};
  }
  async function requestObservation(b, thread, generation, method, options = {}) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try { return await request(b, thread, generation, method, options); }
      catch (error) {
        if (error.code !== 'state_changed' || error.nativeCode !== 'capture-size-changed' || error.mutationOutcome === 'unknown' || attempt === 2) throw error;
        // Re-read identity, authority and minimized state before replacing an
        // invalid snapshot. Only read-only observations are ever retried.
        await ready(b, thread, generation, false);
      }
    }
  }
  async function bindInternal(thread, selected, windowId, manual = true) {
    str(thread); const identity = descriptor(selected);
    const previousDefault=bindings.get(thread), previous=allBindings().find(b=>b.thread===thread&&same(b.identity,identity));if(previous){previous.generation++;previous.observation=null;scopedBindings.delete(previous.targetId);windowId ||= previous.targetId;}
    const generation = previous?.generation || 0; const b = {thread,identity,window:identity,targetId:windowId || crypto.randomUUID(),state:'selected',generation,used:false,restoreAttempted:false,observation:null,selectedAt:now()};
    if(manual) bindings.set(thread,b); scopedBindings.set(b.targetId,b);if(!candidates.has(thread))candidates.set(thread,new Map());candidates.get(thread).set(b.targetId,identity);
    occupancy.publish();
    try { await request(b,thread,generation,'status'); return view(b); } catch(e) {if(bindings.get(thread)===b){if(previousDefault)bindings.set(thread,previousDefault);else bindings.delete(thread);}scopedBindings.delete(b.targetId);if(previous)scopedBindings.set(previous.targetId,previous);occupancy.publish();throw e;}
  }
  function cancelSelection(thread) { selections.set(thread,(selections.get(thread) || 0)+1); }
  function discovery(thread,tool,args) {
    try {
      str(thread);
      if(tool === 'list_windows' || tool === 'list_task_macros') keys(args,[]);
      if(tool === 'save_task_macro') {keys(args,['definition'],['definition']);args = {definition:tasks.definition(args.definition,true)};}
    } catch(e) {return Promise.reject(e);}
    const selection = selections.get(thread) || 0;
    return serial(async () => {
      if(context && !await authorize(null,thread,{permission:'observation',operation:tool})) throw windowError('permission_denied','Window Use observation is disabled or unavailable');
      if(tool === 'list_task_macros') return taskStore.read();
      if(tool === 'save_task_macro') return taskStore.save(args.definition);
      if(tool === 'list_windows') {
        const previous=candidates.get(thread); const raw = await backend.request('listWindows',{}); if(!Array.isArray(raw)) fail('Invalid window list');
        if((selections.get(thread) || 0) !== selection) fail('Operation cancelled');
        const entries = new Map(raw.map(w => {w=descriptor(w);const existing=[...(previous || [])].find(([,old])=>same(old,w)) || allBindings().filter(b=>b.thread===thread&&same(b.identity,w)).map(b=>[b.targetId,b.identity])[0];return [existing?.[0] || crypto.randomUUID(),w];})); candidates.set(thread,entries);for(const b of allBindings().filter(b=>b.thread===thread&&!entries.has(b.targetId))){b.generation++;b.observation=null;scopedBindings.delete(b.targetId);if(bindings.get(thread)===b)bindings.delete(thread);}
        return {candidates:[...entries].map(([windowId,w]) => ({windowId,appName:(process.platform === 'win32' ? path.win32 : path).basename(w.executable),title:observationAllowed&&!observationAllowed(w,thread)?'':w.title,minimized:w.minimized,occupancy:occupancyOf(w,thread)}))};
      }

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
    // Trusted manual UI entry; never exposed as an MCP tool.
    requestPermission: (thread,args) => serial(async()=>{
      keys(args,['permission','targetId','reason','switchedInput'],['permission','reason']);
      if(!['observation','control','desktop'].includes(args.permission))fail('Invalid Window Use permission');
      str(args.reason,1024);if(args.targetId!==undefined)str(args.targetId);
      if(args.switchedInput!==undefined&&(typeof args.switchedInput!=='boolean'||args.permission!=='control'))fail('Invalid input permission');
      if(args.permission==='desktop'&&(args.targetId!==undefined||args.switchedInput!==undefined))fail('Desktop approval is conversation-scoped');
      const b=bindings.get(thread);if(args.targetId!==undefined&&args.targetId!==b?.targetId)fail('Stale or forged target');
      if(b?.userStopped||desktopState(thread).stopped)fail('User stop requires explicit resume');
      if(!requestPermission)fail('Permission requests are unavailable');
      if(args.permission!=='desktop'&&!b)fail('Select a target first');
      const result=await requestPermission(thread,args,b?{...b.identity}:undefined);
      if(b&&bindings.get(thread)===b&&result.authorized===true){b.observation=null;await releaseVirtual(thread);}
      return result;
    }),
    listWindows: thread => serial(async () => { if(context && !await authorize(null,thread,{permission:'observation',operation:'list_windows'})) throw windowError('permission_denied','Window Use observation is disabled or unavailable'); const result = await backend.request('listWindows', {}); if (!Array.isArray(result)) fail('Invalid window list'); return result.map(w => ({...descriptor(w),...(observationAllowed&&!observationAllowed(w,thread)?{title:''}:{}),occupancy:occupancyOf(w,thread)})); }),
    bind: (thread, selected) => { cancelSelection(thread); const selection = selections.get(thread); return serial(async () => { if (selections.get(thread) !== selection) fail('Operation cancelled'); if(approve) await approve({...descriptor(selected)},thread,{permission:'observation'}); if(selections.get(thread)!==selection) fail('Operation cancelled'); const result = await bindInternal(thread, selected); userStoppedTargets.set(thread, (userStoppedTargets.get(thread) || []).filter(identity => !same(identity, selected))); return result; }); },
    status: thread => serial(async () => { if (!bindings.has(thread)) return {state:'unbound',supportedActions:[...ACTIONS]}; const b = get(thread); await request(b, thread, b.generation, 'status'); return view(b); }),
    resume: thread => {const run=()=>serial(async () => { const d=invalidateDesktop(thread);d.stopped=false;if(!bindings.has(thread))return {state:'unbound',desktopObservationRequired:true};const b = get(thread); const generation = ++b.generation; b.userStopped = false; b.state = 'selected'; delete b.pauseReason; userStoppedTargets.set(thread, (userStoppedTargets.get(thread) || []).filter(identity => !same(identity, b.identity))); b.observation = null; b.restoreAttempted = false; if(requestPermission) {const result=await requestPermission(thread,{permission:'control',targetId:b.targetId,reason:'사용자가 창 제어를 다시 시작했습니다.'},{...b.identity});if(result.authorized!==true) fail('Application authorization revoked');} b.operationPermission='control';await ready(b, thread, generation, true); return observe(b, thread, generation); });const b=bindings.get(thread);return Promise.resolve(sessionCleanups.get(thread)).then(()=>b?withLease(thread,b.identity,true,()=>checkCancelled(thread),run):run()); },
    inspectForTask: thread => serial(async () => {const b=get(thread);b.operationPermission='control';b.operation='inspect';await ready(b,thread,b.generation,false);return inspect(b,thread,b.generation,{mode:'task'});}),
    stop: thread => stopBinding(thread, true),
    clear: thread => { cancelSelection(thread);candidates.delete(thread); invalidateDesktop(thread);releaseDesktopQuietly(thread);desktops.delete(thread);releaseQuietly(thread); const b = bindings.get(thread); if (b) { hideOverlay(b, b.generation); b.generation++; } bindings.delete(thread); for(const b of allBindings().filter(b=>b.thread===thread)){b.generation++;b.observation=null;scopedBindings.delete(b.targetId);} userStoppedTargets.delete(thread); occupancy.publish(); },
    invalidateObservation: thread => { invalidateDesktop(thread);releaseDesktopQuietly(thread);releaseQuietly(thread); const b = bindings.get(thread); if (b) { hideOverlay(b, b.generation); b.generation++; b.observation = null; } for(const b of allBindings().filter(b=>b.thread===thread)){b.generation++;b.observation=null;} return b?view(b):undefined; },
    peek: (thread,windowId) => { const b = windowId===undefined?bindings.get(thread):scopedBindings.get(windowId); return b?.thread===thread ? view(b) : undefined; },
    dispose: () => { disposed = true; const closingThreads=new Set([...desktops.keys(),...allBindings().map(b=>b.thread),...sessionCleanups.keys()]);for(const thread of desktops.keys()) {invalidateDesktop(thread,true);releaseDesktopQuietly(thread);}desktops.clear();overlaySubscription?.dispose(); for (const b of allBindings()) { releaseQuietly(b.thread); hideOverlay(b, b.generation); b.generation++; } const closing=Promise.all([...closingThreads].map(releaseOwnedSession));bindings.clear(); scopedBindings.clear(); userStoppedTargets.clear(); candidates.clear(); selections.clear(); occupancy.dispose(); return closing.then(()=>{leases.dispose();return Promise.all([...virtualReleases.values(),...desktopReleases]);}); },
    withWindowLease: (thread,identity,fn) => withLease(thread,identity,true,()=>{checkCancelled(thread);if(desktopState(thread).stopped)fail('User stop requires explicit resume');},()=>fn()),
    getMacros: () => serial(() => locked(readMacros)),
    saveMacro: entry => { const checked = macro(entry); return serial(() => locked(async () => { const entries = await readMacros(); const next = entries.filter(m => m.id !== checked.id).concat(checked); if (next.length > 100) fail('Too many macros'); await writeMacros(next); return checked; })); },
    deleteMacro: id => { str(id, 128); return serial(() => locked(async () => { const entries = await readMacros(); await writeMacros(entries.filter(m => m.id !== id)); })); },
    call: (thread, tool, args) => {
      if (!TOOLS.includes(tool)) return Promise.reject(new Error('Unsupported selected-window tool'));
      if (tool === 'context') { try { keys(args, ['guideVersion']); if(args.guideVersion !== undefined) str(args.guideVersion); } catch(e) { return Promise.reject(e); } return serial(() => context ? context(thread, args) : {executionContext:'parent-window'}); }
      if (tool === 'capture_desktop') {
        try {keys(args,[]);} catch(error) {return Promise.reject(error);}
        const d=desktopState(thread),generation=d.generation;
        return serial(async()=>{if(!desktopCapture) throw windowError('unsupported_action','Desktop observation is unavailable');const result=await desktopCapture(thread,args);if(disposed||desktopState(thread)!==d||d.generation!==generation)fail('Operation cancelled');const id=crypto.randomBytes(24).toString('hex');d.observation={id,originX:result.originX,originY:result.originY,widthPx:result.widthPx,heightPx:result.heightPx};return {...result,observationId:id};});
      }
      if(tool==='release_desktop_input') {
        try{keys(args,[]);}catch(error){return Promise.reject(error);}
        invalidateDesktop(thread);
        return serial(async()=>{await releaseDesktopQuietly(thread,true);return {detached:true,observationRequired:true};});
      }
      if(tool==='desktop_input') {
        try {keys(args,['observationId','input'],['observationId','input']);str(args.observationId);args={...args,input:require('./window-switched-input.cjs').validateDesktopInput(args.input)};}catch(error){return Promise.reject(error);}
        const d=desktopState(thread),generation=d.generation;
        const run=expectedWindow=>serial(async()=>{
          if(!desktopInput)throw windowError('unsupported_action','Desktop input is unavailable');
          const check=async(requestApproval=false)=>{if(disposed||desktopState(thread)!==d||d.generation!==generation)fail('Operation cancelled');if(d.stopped)fail('User stop requires explicit resume');if(!await authorize(null,thread,{permission:'desktop',operation:'desktop_input',...(requestApproval?{requestApproval:true,input:args.input}:{})}))throw windowError('permission_denied','Desktop control approval required');if(disposed||d.generation!==generation)fail('Operation cancelled');};
          try{await check(true);}catch(error){if(error?.observationRequired===true)d.observation=null;throw error;}const observation=d.observation;
          if(!observation||observation.id!==args.observationId)throw windowError('state_changed','Fresh desktop image capture required',{observationRequired:true,actionExecuted:false,recovery:'observe_again'});
          const inside=(x,y)=>Number.isSafeInteger(x)&&Number.isSafeInteger(y)&&x>=observation.originX&&y>=observation.originY&&x<observation.originX+observation.widthPx&&y<observation.originY+observation.heightPx;
          if(!inside(args.input.x,args.input.y)||(args.input.action==='drag'&&!inside(args.input.fromX,args.input.fromY)))fail('Screen coordinates are outside the desktop observation');
          d.observation=null;
          const result=await desktopInput(thread,args.input,{...observation},check,expectedWindow);await check();
          return {delivery:'desktopInput',verified:false,observationRequired:true,inputResult:result};
        });
        if(!resolveDesktopWindow)return Promise.reject(windowError('unsupported_action','Desktop target resolution is unavailable',{actionExecuted:false}));
        return Promise.resolve().then(()=>resolveDesktopWindow(thread,args.input)).then(expectedWindow=>{if(!expectedWindow)fail('Desktop target resolution failed');return withLease(thread,expectedWindow,true,()=>{checkCancelled(thread);if(d.stopped)fail('User stop requires explicit resume');if(d.generation!==generation)fail('Operation cancelled');},()=>run(expectedWindow));});
      }
      if (tool === 'release_virtual_input' || tool === 'release_switched_input') {
        try {keys(args,['windowId'],['windowId']);str(args.windowId);} catch(error) {return Promise.reject(error);}
        const b=scopedBindings.get(args.windowId);if(!b || b.thread!==thread)return Promise.reject(expectedError('Stale or forged target'));return withLease(thread,b.identity,false,()=>checkCancelled(thread),()=>serial(async()=>{b.generation++;b.observation=null;await releaseVirtual(thread);const {targetId,...result}=view(b);return {...result,detached:true};}));
      }
      if (['list_windows','list_task_macros','save_task_macro'].includes(tool)) return discovery(thread,tool,args);
      const action = tool === 'set_value' ? 'setValue' : tool === 'press_key' ? 'pressKey' : tool;
      try {
        const allowed = ['windowId']; const required = ['windowId'];
        if(tool === 'virtual_input') {allowed.push('observationId','input');required.push('observationId','input');str(args.observationId);if(!virtualInput) throw windowError('unsupported_action','Virtual input runtime is unavailable');args={...args,input:require('./window-virtual-input.cjs').validateInput(args.input)};}
        if(tool === 'switched_input') {allowed.push('observationId','input');required.push('observationId','input');str(args.observationId);if(!switchedInput)throw windowError('unsupported_action','Switched input runtime is unavailable');args={...args,input:require('./window-switched-input.cjs').validateInput(args.input)};}
        if(tool === 'inspect') { allowed.push('mode','query','scope','limit','observationId','elementId','fields','textRange','baseObservationId'); validateInspect(args); }
        if (ACTIONS.includes(action) || action === 'pressKey') { allowed.push('observationId', 'elementId'); required.push('observationId', 'elementId'); if (action === 'setValue' || action === 'scroll') { allowed.push('value'); required.push('value'); } }
        if (action === 'pressKey') {allowed.push('key');required.push('key');}
        if (tool === 'run_task_macro') {allowed.push('definition','macroId','parameters');if(Boolean(args?.definition) === Boolean(args?.macroId)) fail('Provide definition or macroId');if(args?.definition) args = {...args,definition:tasks.definition(args.definition)};if(args?.macroId) str(args.macroId,128);if(args?.parameters !== undefined && !plain(args.parameters)) fail('Invalid task parameters');args = {...args,parameters:{...(args.parameters || {})}};}
        if (tool === 'resize') { allowed.push('widthDip', 'heightDip'); required.push('widthDip', 'heightDip'); }
        if (tool === 'run_size_macro') { allowed.push('macroId'); required.push('macroId'); }
        keys(args, allowed, required); if (Object.hasOwn(args, 'windowId')) str(args.windowId);
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
      let b; try { str(args.windowId); const identity=candidates.get(thread)?.get(args.windowId); b=scopedBindings.get(args.windowId); if(!identity || (b && b.thread!==thread))fail('Stale or forged window ID'); if(!b){const stopped=(userStoppedTargets.get(thread)||[]).some(w=>same(w,identity));b={thread,identity,window:identity,targetId:args.windowId,state:stopped?'paused':'selected',userStopped:stopped,pauseReason:stopped?'user_stopped':undefined,generation:0,observation:null};scopedBindings.set(args.windowId,b);} } catch (e) { return Promise.reject(e); }
      const generation = b.generation;
      const control=!['capture','inspect','status'].includes(tool);
      return withLease(thread,b.identity,control,()=>{checkCancelled(thread);if(!hasBinding(thread,b)||b.generation!==generation)fail('Operation cancelled');if(b.userStopped&&control)fail('User stop requires explicit resume');},lease=>serial(async () => {
        b.requestLease={epoch:lease.epoch,usable:lease.usable};
        if(control && b.observation && (!b.observation.lease?.usable || b.observation.lease.epoch!==lease.epoch))b.observation=null;
        b.operation = tool; b.operationPermission = ['capture','inspect','status'].includes(tool) ? 'observation' : 'control';
        if (Object.hasOwn(args, 'windowId') && args.windowId !== b.targetId) fail('Stale or forged target');
        if (disposed || !hasBinding(thread,b) || b.generation !== generation) fail('Operation cancelled');
        if (b.userStopped && b.operationPermission === 'control') fail('User stop requires explicit resume');
        if (approve) await approve({...b.identity},thread,{permission:b.operationPermission,switchedInput:tool==='switched_input'});
        await guard(b, thread, generation);
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
        if (b.state === 'paused') { if(b.userStopped)fail('User stop requires explicit resume'); if (b.pauseReason === 'minimized') throw minimizedError(b); fail('Selected window paused; user resume required'); }
        b.running = true; occupancy.publish();
        try {
        if(b.operationPermission === 'control') {
          try {await showOverlay(b, thread, generation, tool);}
          catch(error) {if(tool==='virtual_input'||tool==='switched_input') {b.generation++;pause(b,'error');await releaseVirtual(thread);}throw error;}
        }
        if (tool === 'run_task_macro') {
          const stored = args.definition ? null : await taskStore.read(); const snapshot = args.definition || stored.macros.find(m => m.id === args.macroId);if(!snapshot) fail('Unknown task macro');
          const result = await tasks.run(snapshot,args.parameters,{progress:async ({index,total,action,phase}) => showOverlay(b,thread,generation,phase === 'verifying' ? 'assert' : action,(index+1)+'/'+total+' · '),cancel:() => {if(hasBinding(thread,b) && b.generation === generation) {b.generation++;pause(b,'error');}},guard:() => guard(b,thread,generation),inspect:async() => {await ready(b,thread,generation,false);return inspect(b,thread,generation,{mode:'task'});},capture:async() => {await ready(b,thread,generation,false);return observe(b,thread,generation);},act:async params => {await ready(b,thread,generation,false);const observation = b.observation;if(!observation || observation.id !== params.observationId || !observation.ids.has(params.elementId)) fail('Fresh selected-window observation required');const finishVisual=await visualizeAction?.(thread,{...b.identity},params,params.action,()=>guard(b,thread,generation));b.observation = null;try{await request(b,thread,generation,'act',params);b.used = true;}finally{try{await finishVisual?.();}catch(error){onOverlayError(thread,error);}}}});
          return {...result,occupancy:occupancyOf(b.identity,thread),...(stored ? {revision:stored.revision,macroId:args.macroId} : {})};
        }
        await ready(b, thread, generation, false);
        if (tool === 'capture') return await observe(b, thread, generation);
        if (tool === 'inspect') { const {windowId,...options}=args; return await inspect(b,thread,generation,options); }
        if (tool === 'virtual_input' || tool === 'switched_input') {
          const observation=b.observation;
          if(!observation || observation.kind!=='image' || observation.generation!==generation || observation.id!==args.observationId) throw windowError('state_changed','Fresh image capture required');
          if(virtualReleases.has(thread)) await virtualReleases.get(thread);
          const check=async()=>{await guard(b,thread,generation);await request(b,thread,generation,'status');if(b.state==='paused') fail('Selected window paused');};
          b.observation=null;
          try {
            await check();
            const result=await (tool==='switched_input'?switchedInput:virtualInput).input(thread,{...b.identity},args.input,check);
            await check();b.used=true;
            return {...view(b),delivery:tool==='switched_input'?'switchedInput':'virtualInput',verified:false,observationRequired:true,...(tool==='switched_input'?{inputResult:result}:{}),...(typeof result?.delivered==='boolean'?{delivered:result.delivered}:{})};
          } catch(error) {if(bindings.get(thread)===b) {b.generation++;pause(b,'error');}await releaseVirtual(thread);throw error;}
        }
        if (ACTIONS.includes(action) || action === 'pressKey') {
          const observation = b.observation;
          if (!observation || observation.generation !== generation || observation.id !== args.observationId || !observation.ids.has(args.elementId)) fail('Fresh selected-window observation required');
          const finishVisual=await visualizeAction?.(thread,{...b.identity},args,tool,()=>guard(b,thread,generation));
          b.observation = null;
          try {await request(b, thread, generation, 'act', { observationId: args.observationId, elementId: args.elementId, action, ...(action === 'pressKey' ? {value:args.key} : Object.hasOwn(args, 'value') ? { value: args.value } : {}) });}
          finally {try{await finishVisual?.();}catch(error){onOverlayError(thread,error);}}
          b.used = true; return { ...view(b), observationRequired: true, ...(action === 'pressKey' ? {delivery:'windowMessage',verified:false} : {}) };
        }
        b.observation = null;
        const steps = tool === 'resize' ? [{ widthDip: args.widthDip, heightDip: args.heightDip }] : await locked(async () => { const entry = (await readMacros()).find(m => m.id === args.macroId); if (!entry) fail('Unknown macro'); return entry.steps; });
        let result;
        for (const step of steps) { await guard(b, thread, generation); await ready(b, thread, generation, false); await request(b, thread, generation, 'resize', step); result = await observe(b, thread, generation); }
        return result;
        }
        finally { await hideOverlay(b, generation); b.running = false; b.requestLease=null; occupancy.publish(); }
      })).then(result=>{if(!plain(result))return result;const {targetId,...publicResult}=result;return publicResult;});
    },
  };
}
module.exports = { createWindowOwner, ACTIONS, TOOLS };
