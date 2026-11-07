'use strict';
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const { StringDecoder } = require('node:string_decoder');
const { randomUUID, randomBytes, timingSafeEqual } = require('node:crypto');
const os = require('node:os');
const { AsyncLocalStorage } = require('node:async_hooks');
const { CODES, windowError, errorPayload, fromPayload, expectedError } = require('./window-control-errors.cjs');
const physicalPath = fs.realpathSync.native(__filename);
const runtimeKey = process.platform === 'win32' ? physicalPath.toLowerCase() : physicalPath;
const registry = globalThis[Symbol.for('azrael-ex.window-control-runtimes.v1')] ??= new Map();
if (registry.has(runtimeKey)) module.exports = registry.get(runtimeKey);
else {
const { createBackend } = require('./window-control-backend.cjs');
const { createWindowOwner } = require('./window-control-policy.cjs');
const { commonDirectory } = require('./window-control-occupancy.cjs');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const CONSENT_PREFIX = 'azrael-window-consent-';
let approvalOwnerResolver = async ({threadId}) => threadId;
function setApprovalOwnerResolver(resolver) {
  if (typeof resolver !== 'function') throw new TypeError('Approval owner resolver must be a function');
  approvalOwnerResolver = resolver;
}
const actualDisabled = meta => { const p = meta?.['codex/sandbox-state-meta']?.permissionProfile; return p && typeof p === 'object' && !Array.isArray(p) && Object.keys(p).length === 1 && p.type === 'disabled'; };
const GUIDE = 'Use azrael_window context to distinguish selected-window UI Automation from whole-screen coordinate control. Individual requests specify windowId from list_windows, use fresh app elements and app permission. Control automatically leases each exact window; the lease expires only after 30 seconds without an owner request completing, never during a request. Other agents wait within a bound; window_busy means no input was sent. Refresh observations after reacquisition. Tools automatically wait for missing app or desktop approval and continue after acceptance and revalidation. Whole-screen control requires a fresh capture_desktop observationId and desktop_input screen coordinates; drag supplies fromX/fromY and endpoint x/y. Desktop permission is conversation-only and includes individual control under the same restrictions. Security Apps cannot be controlled regardless of app or desktop grants and stay masked in desktop captures. Observation can be approved separately. Follow exact identities, live hit checks, occupancy, Stop and native limits. User mouse gestures queue rather than cancel collaboration. Recover foreground/occlusion within the native bound; never replay partial or unknown input. Release input when finished. Never bypass tools, elevate or clear user Stop. Dedicated selectedWindow conversations retain their immutable native tool ceiling.';
const escape = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const absolute = value => typeof value === 'string' && value.length > 0 && (path.isAbsolute(value) || path.win32.isAbsolute(value));
function runtimeNodeExecutable(runtime) {
  return runtime.nodeExecutable || (absolute(runtime.computerUse?.directory) ? path.join(runtime.computerUse.directory,process.platform==='win32'?'node.exe':'node') : undefined);
}
class Bridge {
  constructor(native, raw, fatal = () => this.dispose()) {
    this.native = native; this.raw = raw; this.provider = 'azrael-window-' + randomUUID(); this.pending = new Map();
    this.registration = native.registerProvider(this.provider, {
      onResult: m => { const p = this.pending.get(m.id); if (!p) return; this.pending.delete(m.id); clearTimeout(p.timer); m.error ? p.reject(expectedError(m.error.message || 'Engine request failed')) : p.resolve(m.result); },
      onRequestDelivery: fatal, onFatalError: fatal,
    });
  }
  rpc(method, params) { return new Promise((resolve, reject) => {
    const id = randomUUID(); const timer = setTimeout(() => { this.pending.delete(id); reject(windowError('timeout', 'Engine request timed out')); }, 30000);
    this.pending.set(id, { resolve, reject, timer });
    try { this.raw(this.provider, id, method, params, false, true); } catch (e) { clearTimeout(timer); this.pending.delete(id); reject(e); }
  }); }
  dispose() { for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(windowError('connection_error', 'Engine disconnected')); } this.pending.clear(); this.registration?.dispose(); }
}
function createHost({ runtime, vscode, backend = createBackend(runtime), approvals = require('./window-use-approvals.cjs'), createServer = net.createServer, occupancyDirectory, approvalTimeoutMs = 30000, virtualInput, switchedInput, readApprovalOwner = query => approvalOwnerResolver(query) }) {
  const settingsOwner = require('./use-control-settings.cjs').createSettingsOwner(runtime.codexHome);
  const controlGrants = new Map(), desktopEpochs = new Map(), hostInstance = randomUUID();
  const scope = new AsyncLocalStorage(), bridges = new Map(), threads = new Map(), files = new Map(), selections = new Map(), uiTokens = new Map(), activeUI = new Set(), activeConsents = new Set(), lifecycleRequests = new Map(), cleanupTasks = new Map(), approvalUIs = new Map(), pendingConsents = new Map();
  const ephemeralThreads = new WeakMap();
  const durableApprovals = require('./window-use-async-approvals.cjs').createLedger({ directory:path.join(runtime.codexHome,'azrael','window-use','approval-owner'),rpc:(thread,method,params)=>{const t=threads.get(thread);if(!t)throw windowError('connection_error','승인 요청의 엔진 연결이 없습니다.');return t.bridge.rpc(method,params);} });
  const approvalReceipts = new Map(), approvalTasks = new Set();
  const trackApproval = task => { approvalTasks.add(task); void task.finally(()=>approvalTasks.delete(task)).catch(()=>{}); return task; };
  const socketDirectory = process.platform === 'win32' ? undefined : fs.mkdtempSync(path.join(os.tmpdir(), 'azw-'));
  if (socketDirectory) fs.chmodSync(socketDirectory, 0o700);
  const nonce = randomBytes(32).toString('hex'), pipe = socketDirectory ? path.join(socketDirectory, 'w.sock') : '\\\\.\\pipe\\azrael-window-' + randomUUID();
  let panel, panelNonce, current, enumerated = new Map(), last, server, listening, disposed = false, queue = Promise.resolve();
  const approvalNavigation = new Map(), notificationTasks = new Set();
  function consentIsPending(record) {
    const t = threads.get(record.thread);
    return !disposed && pendingConsents.get(record.id) === record && !record.controller.signal.aborted &&
      t === record.t && (record.deferred || t.turnVersion === record.version && (!record.turnId || t.turnId === record.turnId) && !record.uiRecord?.cancelled);
  }
  const notificationSubscription = backend.onApprovalNotificationActivated?.(event => {
    const record = pendingConsents.get(CONSENT_PREFIX + event.requestId);
    if (!record || !consentIsPending(record)) return;
    void Promise.resolve().then(async () => {
      await vscode.commands?.executeCommand('workbench.action.focusWindow');
      if (!consentIsPending(record)) return;
      if (record.route === 'panel') {
        if (panel && panelNonce === record.panelNonce && current === record.thread) panel.reveal(undefined, false);
      } else {
        const displayThread = await readApprovalOwner({threadId:record.thread,hostId:'local'});
        if (displayThread && consentIsPending(record)) await approvalNavigation.get(record.native)?.(displayThread, () => consentIsPending(record));
      }
    }).catch(() => {});
  });
  function hideConsentNotification(record) {
    return Promise.resolve().then(() => backend.hideApprovalNotification?.({ requestId: record.id.slice(CONSENT_PREFIX.length) })).catch(() => {});
  }
  function trackNotification(task) {
    notificationTasks.add(task); void task.finally(() => notificationTasks.delete(task)); return task;
  }
  function notifyConsent(record, appTitle) {
    if (!backend.showApprovalNotification || record.notificationTask || !consentIsPending(record)) return;
    record.notificationTask = trackNotification(Promise.resolve().then(() => {
      if (!consentIsPending(record)) return;
      return backend.showApprovalNotification({ requestId: record.id.slice(CONSENT_PREFIX.length), appTitle, timeoutMs: 50000 });
    }).catch(() => {}).then(() => {
      // Remove a Show that completed after the approval ended.
      if (!consentIsPending(record)) return hideConsentNotification(record);
    }));
  }
  function dismissConsentNotification(record) {
    if (record.notificationTask) trackNotification(record.notificationTask.then(() => hideConsentNotification(record)));
  }
  function guide(knownVersion) {
    const version='window-use-4:'+(runtime.windowControl?.manifestSha256||'source');
    if(knownVersion===version)return {guideVersion:version};
    const directory=runtime.windowControl?.directory;
    if(!directory)return {guideVersion:version,guide:GUIDE};
    const file=path.join(directory,'docs','window-use','common.md'),stat=fs.lstatSync(file);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>65536)throw expectedError('Invalid Window Use guidance');
    return {guideVersion:version,guide:fs.readFileSync(file,'utf8')};
  }
  const processIdentity=w=>Object.fromEntries(['pid','processCreated','executable'].map(key=>[key,w[key]]));
  const sameProcess=(a,b)=>!!a&&!!b&&['pid','processCreated','executable'].every(key=>a[key]===b[key]);
  const sameTarget=(a,b)=>!!a&&!!b&&['hwnd','pid','processCreated','executable'].every(key=>a[key]===b[key]);
  function permissionContext(thread) {
    const permission=scope.getStore(),t=threads.get(thread),state=settingsOwner.getSettings();
    if(disposed||!state.windowUseEnabled||!t||permission?.threadId!==thread||permission.disabled!==true||permission.signal?.aborted||permission.uiRecord?.cancelled||permission.turnId&&permission.turnId!==t.turnId||permission.policyGeneration!==undefined&&permission.policyGeneration!==state.windowUseGeneration)throw windowError('permission_denied','Native Window Use permission context denied');
    return {permission,t,state};
  }
  async function contextFor(thread,args={}) {
    const state=settingsOwner.getSettings(),grant=controlGrants.get(thread);
    const desktopControl=tDesktopAllowed(thread);
    return {enabled:state.windowUseEnabled,permissions:{observation:'default-allow',control:'default-ask',desktopControl:'default-ask',desktopControlGranted:desktopControl},capabilities:{windowObservation:!!runtime.windowControl,desktopCapture:!!runtime.windowControl,windowUIAControl:!!runtime.windowControl,desktopControl:threads.get(thread)?.mode!=='selectedWindow'&&!!switchedInput?.desktopInput},inputBackends:{switchedInput:!!switchedInput,switchedInputGranted:grant?.policyGeneration===state.windowUseGeneration&&grant.switchedInput===true,desktopControlGranted:desktopControl},...guide(args.guideVersion)};
  }
  function tDesktopAllowed(thread) { return threads.get(thread)?.mode!=='selectedWindow'&&approvals.hasDesktopApproval?.(thread)===true; }
  function assertControlAllowed(identity) {
    if(settingsOwner.getSettings().observationBlockedApps.includes(require('./use-control-settings.cjs').normalizeExecutable(identity?.executable)))throw windowError('security_app_blocked','Security App control is blocked',{actionExecuted:false});
  }
  async function approveDesktop(thread) {
    const {t,state}=permissionContext(thread),version=t.turnVersion,epoch=desktopEpochs.get(thread);
    if(t.mode==='selectedWindow'||!switchedInput?.desktopInput)throw windowError('permission_denied','Desktop control is outside this conversation capability');
    await consent({},thread,{permission:'desktop'});
    permissionContext(thread);
    if(threads.get(thread)!==t||t.turnVersion!==version||desktopEpochs.get(thread)!==epoch||settingsOwner.getSettings().windowUseGeneration!==state.windowUseGeneration)throw windowError('cancelled','Desktop authorization changed');
    return tDesktopAllowed(thread);
  }
  async function approveApp(identity,thread,operation={permission:'control'}) {
    const {t,state}=permissionContext(thread),version=t.turnVersion,permission=operation.permission??'control';
    if(!['observation','control'].includes(permission))throw windowError('invalid_request','Invalid app permission');
    if(operation.switchedInput===true&&(permission!=='control'||t.mode==='selectedWindow'||!switchedInput))throw windowError('permission_denied','Switched input is outside this conversation capability');
    if(permission==='control')assertControlAllowed(identity);
    const inherited=permission==='control'&&tDesktopAllowed(thread);
    const allowed=await consent(identity,thread,{...operation,permission});
    permissionContext(thread);
    if(threads.get(thread)!==t||t.turnVersion!==version||state.windowUseGeneration!==settingsOwner.getSettings().windowUseGeneration)throw windowError('cancelled','App authorization changed');
    if(allowed&&permission==='control'){
      const previous=controlGrants.get(thread),reuse=previous?.policyGeneration===state.windowUseGeneration&&sameProcess(previous.processScope,identity);
      const useSwitched=operation.switchedInput===true||operation.switchedInput===undefined&&reuse&&previous.switchedInput===true;
      if(inherited&&!tDesktopAllowed(thread))throw windowError('permission_denied','Desktop authorization revoked');
      controlGrants.set(thread,{identity,processScope:processIdentity(identity),source:inherited?'desktop':'app',switchedInput:useSwitched,policyGeneration:state.windowUseGeneration,appRevocationFingerprint:appRevocationFingerprint()});selections.set(thread,identity);
    }
    return allowed;
  }
  async function requestPermission(thread,args,identity) {
    permissionContext(thread);
    if(args.permission==='desktop') {
      await approveDesktop(thread);
      return {authorized:tDesktopAllowed(thread),permission:'desktop',...await contextFor(thread)};
    }
    if(!identity)throw windowError('selection_required','Select an app before requesting permission');
    const authorized=await approveApp(identity,thread,args);
    permissionContext(thread);
    return {authorized,permission:args.permission,...await contextFor(thread)};
  }
  async function desktopCapture(thread,args={}) {
    const {t,state}=permissionContext(thread),version=t.turnVersion;
    const result=await backend.request('captureDesktop',{blockedApps:state.observationBlockedApps});
    permissionContext(thread);
    if(threads.get(thread)!==t||t.turnVersion!==version||settingsOwner.getSettings().windowUseGeneration!==state.windowUseGeneration)throw windowError('cancelled','Desktop observation policy changed');
    if(!result||result.redacted!==true||!Number.isSafeInteger(result.originX)||!Number.isSafeInteger(result.originY)||!Number.isSafeInteger(result.maskedWindowCount)||result.maskedWindowCount<0||!Number.isSafeInteger(result.widthPx)||result.widthPx<=0||result.widthPx>16384||!Number.isSafeInteger(result.heightPx)||result.heightPx<=0||result.heightPx>16384||result.image?.mimeType!=='image/png'||typeof result.image.data!=='string'||!result.image.data.length||!/^[A-Za-z0-9+/]*={0,2}$/.test(result.image.data))throw windowError('connection_error','Invalid desktop observation');
    return result;
  }
  async function resolveDesktopWindow(thread,input) {
    permissionContext(thread);
    const point=input?.action==='drag'?{x:input.fromX,y:input.fromY}:{x:input?.x,y:input?.y};
    if(!Number.isSafeInteger(point.x)||!Number.isSafeInteger(point.y))throw windowError('invalid_request','Desktop input requires explicit screen coordinates');
    const result=await backend.request('windowAtPoint',point);
    permissionContext(thread);
    if(!result?.window?.executable)throw windowError('state_changed','No desktop input target');
    assertControlAllowed(result.window);
    return result.window;
  }
  async function desktopInput(thread,input,observation,guard,expectedWindow) {
    const {t,state}=permissionContext(thread),version=t.turnVersion,desktopEpoch=desktopEpochs.get(thread);
    if(t.mode==='selectedWindow'||!switchedInput?.desktopInput||!tDesktopAllowed(thread))throw windowError('permission_denied','Desktop control approval required');
    if(!Number.isSafeInteger(input?.x)||!Number.isSafeInteger(input?.y))throw windowError('invalid_request','Desktop input requires explicit screen coordinates');
    const point=input.action==='drag'?{x:input.fromX,y:input.fromY}:{x:input.x,y:input.y};
    if(!Number.isSafeInteger(point.x)||!Number.isSafeInteger(point.y))throw windowError('invalid_request','Desktop drag requires explicit start coordinates');
    const check=async()=>{permissionContext(thread);if(threads.get(thread)!==t||t.turnVersion!==version||desktopEpochs.get(thread)!==desktopEpoch||settingsOwner.getSettings().windowUseGeneration!==state.windowUseGeneration||!tDesktopAllowed(thread))throw windowError('permission_denied','Desktop authorization changed');await guard();};
    await check();
    const {window}=await backend.request('windowAtPoint',point);
    if(!window?.executable)throw windowError('state_changed','No desktop input target');
    if(expectedWindow&&!sameTarget(expectedWindow,window))throw windowError('state_changed','Desktop input target changed while awaiting occupancy',{observationRequired:true,actionExecuted:false,recovery:'observe_again'});
    assertControlAllowed(window);
    const authorize=async()=>{await check();assertControlAllowed(window);if(!approvals.hasDesktopAppApproval(window.executable,thread))throw windowError('permission_denied','Desktop app authorization revoked');const actual=await backend.request('windowAtPoint',point);if(!sameTarget(window,actual?.window))throw windowError('state_changed','Desktop input target changed');assertControlAllowed(actual.window);await check();};
    await authorize();
    try {return await switchedInput.desktopInput(thread,window,input,authorize);}
    catch(error) {
      if(['stopped','user_stopped'].includes(error?.nativeCode)||['stopped','user_stopped'].includes(error?.code)) {
        invalidateUI(thread);approvals.stop(thread);owner.stop(thread);
      }
      throw error;
    }
  }
  async function visualizeAction(thread,window,args,tool,guard) {
    if(!switchedInput?.visualize)return;
    await guard();permissionContext(thread);
    const point=await backend.request('actionPoint',{window,observationId:args.observationId,...(args.elementId?{elementId:args.elementId}:{})});
    await guard();permissionContext(thread);
    await switchedInput.visualize(thread,window,{...point,phase:'active',click:tool==='invoke'},guard);
    await guard();
    return async()=>{await switchedInput.visualize(thread,window,{...point,phase:'idle'},guard);};
  }
  if(!switchedInput && runtime.windowControl?.multiPointer) {
    const verified=require('./window-control-runtime.cjs').verifyRuntime(runtime.windowControl.directory);
    if(verified.manifestSha256!==runtime.windowControl.manifestSha256 || !verified.multiPointer || ['directory','manifestSha256','modulePath'].some(key=>verified.multiPointer[key]!==runtime.windowControl.multiPointer[key]))throw windowError('permission_denied','Switched input runtime declaration mismatch');
    switchedInput=require('./window-switched-input.cjs').createSwitchedInputProvider(verified.multiPointer,{stateDirectory:path.join(runtime.codexHome,'azrael','window-use','switched-input')});
  }
  const owner = createWindowOwner({ backend, virtualInput, switchedInput, requestPermission, context:contextFor, desktopCapture, desktopInput, resolveDesktopWindow, isCancelled:thread=>{const p=scope.getStore();return disposed||!threads.has(thread)||p?.signal?.aborted===true||p?.uiRecord?.cancelled===true;}, releaseDesktopInput:thread=>switchedInput?.release?.(thread), visualizeAction, observationAllowed:(identity,thread)=>approvals.hasAppApproval(identity.executable,thread,'observation'), codexHome: runtime.codexHome, workspacePath: vscode.workspace?.workspaceFile?.fsPath || runtime.workspacePath || vscode.workspace?.workspaceFolders?.[0]?.uri.fsPath, occupancyDirectory: occupancyDirectory || runtime.occupancyDirectory || commonDirectory(), workspaceName: (process.platform === 'win32' ? path.win32 : path).basename(runtime.workspacePath || vscode.workspace?.workspaceFolders?.[0]?.uri.fsPath || '') || 'Azrael',
    onUserStop: (thread, value) => {
      invalidateUI(thread); approvals.stop(thread);
      if (current === thread) render({ ...value, status: '이 창의 제어를 중지했습니다. 이미 전달한 동작은 적용됐을 수 있습니다.' });
    },
    onOverlayError: (thread, error) => {
      if (disposed) return;
      if (current === thread && panel) void panel.webview.postMessage({ type: 'error', text: errorPayload(error).message });
      else void vscode.window.showWarningMessage?.('Window Use 오버레이 연결이 끊겼습니다. 창 제어 상태를 확인해주세요.');
    },
    approve:approveApp,authorize:async(w,thread,operation={permission:'control'})=>{
      try{
        const {t,state}=permissionContext(thread),grant=controlGrants.get(thread);
        if(operation.permission==='desktop') {
          if(operation.requestApproval!==true)return t.mode!=='selectedWindow'&&!!switchedInput?.desktopInput&&tDesktopAllowed(thread);
          if(t.mode==='selectedWindow'||!switchedInput?.desktopInput)return false;
          const input=operation.input,point=input?.action==='drag'?{x:input.fromX,y:input.fromY}:{x:input?.x,y:input?.y};
          if(!Number.isSafeInteger(point.x)||!Number.isSafeInteger(point.y))throw windowError('invalid_request','Desktop input requires explicit screen coordinates');
          const initial=await backend.request('windowAtPoint',point);
          if(!initial?.window?.executable)throw windowError('state_changed','No desktop input target');
          assertControlAllowed(initial.window);
          const hadApproval=tDesktopAllowed(thread);
          if(!await approveDesktop(thread))return false;
          const actual=await backend.request('windowAtPoint',point);
          if(!sameTarget(initial.window,actual?.window))throw windowError('state_changed','Desktop input target changed');
          assertControlAllowed(actual.window);permissionContext(thread);
          if(!hadApproval)throw windowError('state_changed','Capture the desktop again after approval',{observationRequired:true,actionExecuted:false,recovery:'observe_again'});
          return tDesktopAllowed(thread);
        }
        if(operation.permission==='observation')return !w || approvals.hasAppApproval(w.executable,thread,'observation');
        assertControlAllowed(w);
        if(grant?.source==='desktop'&&(!tDesktopAllowed(thread)||!approvals.hasDesktopAppApproval(w.executable,thread)))return false;
        if(['virtual_input','release_virtual_input'].includes(operation.operation)&&(t.mode==='selectedWindow'||!virtualInput))return false;
        if(['switched_input','release_switched_input'].includes(operation.operation)&&(t.mode==='selectedWindow'||!switchedInput||!grant?.switchedInput))return false;
        return grant?.policyGeneration===state.windowUseGeneration&&(['switched_input','release_switched_input','virtual_input','release_virtual_input'].includes(operation.operation)?sameProcess(grant.processScope,w):sameTarget(grant.identity,w))&&approvals.hasAppApproval(w.executable,thread,'control');
      }catch(error){if(['security_app_blocked','approval_denied','approval_timeout','cancelled','invalid_request','state_changed'].includes(error?.code))throw error;return false;}
    }
  });
  const serial = fn => { const result = queue.then(fn); queue = result.catch(() => {}); return result; };
  function invalidateUI(thread,{preserveApprovals=false}={}) {
    if(!preserveApprovals)for(const id of thread?[thread]:threads.keys())desktopEpochs.set(id,randomUUID());
    if(thread) owner.invalidateObservation(thread);else for(const id of threads.keys()) owner.invalidateObservation(id);
    if(thread) controlGrants.delete(thread);else controlGrants.clear();
    for (const consent of activeConsents) if ((!thread || consent.thread === thread) && !(preserveApprovals && consent.deferred)) consent.controller.abort();
    if(!preserveApprovals&&!disposed) for(const id of thread?[thread]:threads.keys()) {
      approvalReceipts.delete(id);
      void trackApproval(durableApprovals.withdraw(id,undefined,'host-invalidated')).catch(()=>{});
    }
    for (const record of activeUI) if (!thread || record.thread === thread) { record.cancelled = true; uiTokens.delete(record.token); }
  }
  const uiScope = async fn => {
    const thread = current, t = threads.get(thread); let record;
    try {
      if (disposed || !t || t.turnId || t.starting) throw windowError('state_changed', '현재 실행이 끝난 뒤 창을 제어해주세요');
      const token = randomBytes(32).toString('hex'); record = { token, thread, t, fn, completed: false, cancelled: false }; uiTokens.set(token, record); activeUI.add(record);
      await t.bridge.rpc('mcpServer/tool/call', { threadId: thread, server: 'azrael_window', tool: 'ui_operation', arguments: { requestToken: token } });
      if (record.cancelled || disposed || current !== thread || threads.get(thread) !== t || t.turnId || t.starting) throw windowError('cancelled', 'Selected-window UI operation cancelled');
      if (!record.completed) throw windowError('permission_denied', 'Native permission proof was not delivered');
      if (record.error) throw record.error;
      return record.result;
    } catch (error) { renderFailure(thread); throw error; } finally { if (record) { record.cancelled = true; uiTokens.delete(record.token); activeUI.delete(record); } }
  };
  const render = value => { if (value) last = value; if (panel) void panel.webview.postMessage({ type: 'state', value: last || {}, threadId: current, macros: undefined }); };
  const publicState = status => ({ targetId: last?.targetId, windowId: last?.windowId, state: last?.state, window: last?.window, supportedActions: last?.supportedActions, pauseReason: last?.pauseReason, restoreAllowed: last?.restoreAllowed, ...(status ? { status } : {}) });
  function renderFailure(thread,windowId) { if (!thread || current !== thread) return; let value; try { value = owner.peek(thread,windowId); } catch { /* Preserve the original operation error. */ } render(value || publicState('실행 오류')); }
  function cleanup(thread,options) {
    if (cleanupTasks.has(thread)) return cleanupTasks.get(thread);
    const task = cleanupThread(thread,options).finally(() => { if (cleanupTasks.get(thread) === task) cleanupTasks.delete(thread); });
    cleanupTasks.set(thread, task);
    return task;
  }
  async function cleanupThread(thread,options) {
    const closing = threads.get(thread); if (closing) closing.closed = true;
    desktopEpochs.set(thread,randomUUID());
    invalidateUI(thread,options); approvals.stop(thread); owner.clear(thread); selections.delete(thread);
    if (closing?.ready) { try { await closing.ready; } catch {} }
    if (closing && threads.get(thread) !== closing) return;
    threads.delete(thread); const file = files.get(thread); files.delete(thread);
    if (file) { try { const stored = JSON.parse(await fsp.readFile(file, 'utf8')); if (stored.nonce === nonce) await fsp.unlink(file); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
    if (current === thread) { current = undefined; last = undefined; render(); }
  }
  async function handlePipe(message, request = {}) {
    if (request.signal?.aborted) throw windowError('cancelled', 'Selected-window request cancelled');
    request.progress?.('running');
    if (!message || Object.keys(message).some(k => !['nonce', 'threadId', 'method', 'tool', 'arguments', '_meta'].includes(k)) || typeof message.nonce !== 'string' || !/^[a-f0-9]{64}$/.test(message.nonce) || !timingSafeEqual(Buffer.from(message.nonce), Buffer.from(nonce))) throw windowError('permission_denied', 'Invalid selected-window authentication');
    if (message.method!=='call' || !threads.has(message.threadId)) throw windowError('selection_required', 'Unknown selected-window session');
    const t = threads.get(message.threadId);
    await t.ready;
    if (request.signal?.aborted) throw windowError('cancelled', 'Selected-window request cancelled');
    if (disposed || threads.get(message.threadId) !== t || message._meta?.threadId !== message.threadId || !actualDisabled(message._meta)) throw windowError('permission_denied', 'Native permission context denied');
    if(['virtual_input','release_virtual_input'].includes(message.tool) && (t.mode==='selectedWindow' || !virtualInput)) throw windowError('permission_denied','Virtual input is outside this conversation capability');
    if(['switched_input','release_switched_input'].includes(message.tool) && (t.mode==='selectedWindow' || !switchedInput))throw windowError('permission_denied','Switched input is outside this conversation capability');
    if (message.tool === 'ui_operation') {
      const args = message.arguments;
      if (Object.hasOwn(message._meta, 'x-codex-turn-metadata') || !args || Object.keys(args).length !== 1 || typeof args.requestToken !== 'string' || !/^[a-f0-9]{64}$/.test(args.requestToken)) throw windowError('permission_denied', 'Invalid UI operation proof');
      const record = uiTokens.get(args.requestToken);
      if (!record || record.thread !== message.threadId || record.t !== t || record.cancelled || current !== record.thread || t.turnId || t.starting) throw windowError('cancelled', 'Unknown or cancelled UI operation token');
      uiTokens.delete(record.token);
      try { record.result = await scope.run({ ...request, threadId: record.thread, disabled: true, policyGeneration:settingsOwner.getSettings().windowUseGeneration, uiRecord: record }, record.fn); } catch (error) { record.error = error; renderFailure(record.thread); } finally { record.completed = true; }
      return {};
    }
    let meta = message._meta?.['x-codex-turn-metadata']; if (typeof meta === 'string') { try { meta = JSON.parse(meta); } catch { throw windowError('permission_denied', 'Invalid native metadata'); } }
    if (!meta || meta.thread_id !== message.threadId || typeof meta.turn_id !== 'string' || !t.turnId || meta.turn_id !== t.turnId) throw windowError('permission_denied', 'Native permission context denied');
    return scope.run({ ...request, threadId: message.threadId, disabled: true, policyGeneration:settingsOwner.getSettings().windowUseGeneration, turnId: meta.turn_id }, async () => { try { const result = await owner.call(message.threadId, message.tool, message.arguments); if (current === message.threadId) render(result); return result; } catch (error) { renderFailure(message.threadId,message.arguments?.windowId); throw error; } });
  }
  async function listen() {
    if (listening) return listening;
    server = createServer(socket => {
      const controller = new AbortController(); let disconnected = false, activeTimeoutMs = 65000;
      const cancel = () => { disconnected = true; controller.abort(); };
      const progress = stage => { if (!disconnected && !socket.destroyed) { if(stage==='approval') socket.setTimeout(approvalTimeoutMs+10000);else if(stage==='running') socket.setTimeout(activeTimeoutMs); socket.write?.(JSON.stringify({ progress: { stage } }) + '\n'); } };
      let buffer = '', used = false, requestBytes = 0; const decoder = new StringDecoder('utf8'); socket.setTimeout(65000, () => { cancel(); socket.destroy(); }); socket.on('error', cancel); socket.on('close', cancel);
      socket.on('data', data => { if (used) return; const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data); const end = bytes.indexOf(10); const part = end < 0 ? bytes : bytes.subarray(0, end + 1); requestBytes += part.length; if (requestBytes > 65536) { used = true; socket.end(JSON.stringify({ error: errorPayload(windowError('invalid_request', '요청 크기가 Window Use 제한을 초과했습니다.', { stage: 'connection' })) }) + '\n'); return; } buffer += decoder.write(part); const newline = buffer.indexOf('\n'); if (newline < 0) return; used = true;
        progress('queued');
        let message; try { message = JSON.parse(buffer.slice(0, newline)); } catch { socket.end(JSON.stringify({ error: errorPayload(windowError('invalid_request', 'Invalid selected-window request')) }) + '\n'); return; }
        const deliver = async () => { if (disconnected || socket.destroyed) return; let response; try { response = { result: await handlePipe(message, { signal: controller.signal, progress }) }; } catch (e) { response = { error: errorPayload(e) }; } if (disconnected || socket.destroyed) return; const bytes = JSON.stringify(response); socket.end(Buffer.byteLength(bytes) > 32 * 1024 * 1024 ? JSON.stringify({ error: errorPayload(windowError('unclassified', '', { stage: 'running' })) }) + '\n' : bytes + '\n'); };
        // Policy serializes actual input. A lease waiter must not block the host
        // queue that lets the incumbent finish or refresh its own window.
        void deliver();
      });
    });
    listening = new Promise((resolve, reject) => { server.once('error', reject); server.listen(pipe, () => { if (socketDirectory) fs.chmodSync(pipe, 0o600); resolve(); }); }); return listening;
  }
  async function publish(thread) {
    if (!UUID.test(thread)) throw new Error('Invalid selected-window thread UUID'); await listen();
    const directory = path.join(runtime.codexHome, 'azrael', 'computer-use', 'window-sessions'); await fsp.mkdir(directory, { recursive: true });
    const file = path.join(directory, thread + '.json'); await fsp.writeFile(file, JSON.stringify({ schema: 1, pipe, nonce }), { flag: 'wx', mode: 0o600 }); files.set(thread, file);
  }
  function registerThread(thread, bridge) {
    if (disposed || !UUID.test(thread) || bridges.get(bridge.native) !== bridge) throw new Error('Invalid Window Use thread owner');
    const existing = threads.get(thread);
    if (existing) { if (existing.bridge !== bridge || existing.closed) throw new Error('Window Use thread belongs to another engine or is closing'); return existing; }
    const t = { bridge, turnId: undefined, starting: false, turnVersion: 0, mode:undefined };
    threads.set(thread, t);
    t.ready = publish(thread).then(()=>restoreApprovals(thread)).then(() => { if (disposed || t.closed || threads.get(thread) !== t || bridges.get(bridge.native) !== bridge) throw windowError('cancelled', 'Window Use registration cancelled'); });
    void t.ready.catch(() => {});
    return t;
  }
  function appRevocationFingerprint() {
    const file=path.join(runtime.codexHome,'azrael','window-use','app-approvals.json');
    let state;try{const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1048576)throw Error('Invalid app approval store');state=JSON.parse(fs.readFileSync(file,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;state={schema:1,revocations:{},apps:[]};}
    if(state.schema!==1||!state.revocations||typeof state.revocations!=='object'||Array.isArray(state.revocations)||!Array.isArray(state.apps))throw Error('Invalid app approval store');
    return JSON.stringify(Object.keys(state.revocations).sort().map(key=>{const value=state.revocations[key];if(!Number.isSafeInteger(value)||value<0)throw Error('Invalid app revocation');return [key,value];}));
  }
  function approvalBinding(thread,descriptor,operation={permission:'control'}) {
    const desktop=operation.permission==='desktop',sessionBound=desktop;
    return {threadId:thread,permission:operation.permission,kind:desktop?'desktop':'app',descriptor:desktop?{}:{hwnd:descriptor.hwnd,pid:descriptor.pid,processCreated:descriptor.processCreated,executable:descriptor.executable,packageName:descriptor.packageName,packageFullName:descriptor.packageFullName,applicationId:descriptor.applicationId},policyGeneration:settingsOwner.getSettings().windowUseGeneration,appRevocationFingerprint:appRevocationFingerprint(),runtime:{codexHome:path.resolve(runtime.codexHome),manifestSha256:runtime.windowControl?.manifestSha256??null,directory:runtime.windowControl?.directory??null,mode:threads.get(thread)?.mode??null,...(sessionBound?{hostInstance,desktopEpoch:desktopEpochs.get(thread)??null}: {})}};
  }
  function currentApprovalKey(record) {
    if(!['app','desktop'].includes(record.binding.kind)||!['observation','control','desktop'].includes(record.binding.permission))return undefined;
    return durableApprovals.scopeKey(approvalBinding(record.thread,record.binding.descriptor,{permission:record.binding.permission}));
  }
  async function publishConsent(record,value) {
    const displayThread = await readApprovalOwner({threadId:record.thread,hostId:'local'});
    if (!displayThread) throw windowError('connection_error','Approval display owner is unavailable',{stage:'approval',approvalState:'pending',userResponded:false,actionExecuted:false});
    const publisher=approvalUIs.get(record.native);
    if(displayThread===record.thread&&record.route==='panel'&&panel&&panelNonce===record.panelNonce&&current===record.thread) return panel.webview.postMessage(value.type==='mcp-request'?{type:'approval',request:value.request}:value);
    if(!publisher) throw windowError('connection_error','Window Use approval UI is not connected',{stage:'approval',approvalState:'cancelled',userResponded:false,actionExecuted:false});
    record.route='ordinary'; return publisher(value);
  }
  function finishConsent(record,state) {
    if(record.finished)return;
    record.finished=true;
    clearTimeout(record.timer); pendingConsents.delete(record.id); activeConsents.delete(record); dismissConsentNotification(record);
    if(record.deferred)approvals.response(record.id,{action:'cancel'});
    if(disposed)return;
    void Promise.resolve().then(()=>publishConsent(record,record.route==='panel'?{type:'approval-resolved',requestId:record.id,threadId:record.thread,approvalState:state}:{type:'mcp-notification',hostId:'local',notification:{method:'serverRequest/resolved',params:{threadId:record.thread,requestId:record.id}}})).catch(()=>{});
  }
  function adoptApproval(saved,t,{deferred=true,uiRecord,turnId,version}={}) {
    const request=saved.payload.request,binding=saved.payload.binding;
    const record={id:saved.requestId,scopeKey:saved.scopeKey,binding,request,thread:binding.threadId,native:t.bridge.native,t,version:version??t.turnVersion,turnId,uiRecord,controller:new AbortController(),route:panel&&current===binding.threadId?'panel':'ordinary',panelNonce,offered:request.params._meta.persist,policyGeneration:binding.policyGeneration,deferred};
    record.controller.signal.addEventListener('abort',()=>{
      record.waiter?.reject(windowError('cancelled','Application approval cancelled',{stage:'approval',approvalState:'cancelled',userResponded:false,actionExecuted:false}));
      finishConsent(record,record.terminalState??'cancelled');
      if(!disposed&&!record.preserveOnAbort) void trackApproval(durableApprovals.withdraw(record.thread,record.id,'approval-cancelled')).catch(()=>{});
    },{once:true});
    pendingConsents.set(record.id,record);activeConsents.add(record);return record;
  }
  async function restoreApprovals(thread) {
    const t=threads.get(thread);if(!t||disposed)return;
    if(t.approvalRestore)return t.approvalRestore;
    const task=restoreApprovalRecords(thread);
    t.approvalRestore=task;
    try {return await task;} finally {if(t.approvalRestore===task)t.approvalRestore=undefined;}
  }
  async function restoreApprovalRecords(thread) {
    const t=threads.get(thread);if(!t||disposed)return;
    const saved=await durableApprovals.list(thread),receipts=new Map();approvalReceipts.set(thread,receipts);
    for(const item of saved) {
      if((item.state==='declined'||item.state==='cancelled')&&!pendingConsents.has(item.requestId))continue;
      const record=pendingConsents.get(item.requestId)??adoptApproval(item,t);
      let valid=false;try{valid=!record.controller.signal.aborted&&currentApprovalKey(record)===item.scopeKey&&settingsOwner.getSettings().windowUseEnabled;}catch{}
      if(!valid) {await durableApprovals.withdraw(thread,item.requestId,'approval-scope-changed');record.controller.abort();continue;}
      if(item.state==='accepted') {receipts.set(item.scopeKey,item);if(!record.waiter)finishConsent(record,'accepted');continue;}
      if(item.state!=='pending') {if(!record.waiter)finishConsent(record,item.state);continue;}
      if(!record.waiter) {
        await durableApprovals.defer(thread,item.requestId,item.scopeKey);record.deferred=true;
        if(approvalUIs.has(record.native)||panel&&current===thread) {await publishConsent(record,{type:'mcp-request',hostId:'local',request:record.request});notifyConsent(record,record.request.params._meta.tool_params_display.find(x=>x.name==='app')?.value??'Window Use');}
      }
    }
  }
  function registerApprovalUI(native, publish, navigate) {
    if (typeof navigate === 'function' && !disposed) approvalNavigation.set(native, navigate); else approvalNavigation.delete(native);
    const previous = approvalUIs.get(native);
    if (previous === publish) return;
    if (typeof publish === 'function' && !disposed) approvalUIs.set(native, publish); else approvalUIs.delete(native);
    if(typeof publish==='function') for(const [thread,t] of threads)if(t.bridge.native===native)void trackApproval(restoreApprovals(thread)).catch(()=>{});
  }
  function respondApproval(native, id, result) {
    if (typeof id !== 'string' || !id.startsWith(CONSENT_PREFIX)) return false;
    const record = pendingConsents.get(id);
    // Local IDs never reach the engine, including retired IDs and wrong owners.
    if (!record || record.native !== native) return true;
    const t = threads.get(record.thread);
    if (disposed || record.controller.signal.aborted || t !== record.t || t?.closed || !record.deferred&&(t.turnVersion !== record.version || record.turnId&&t.turnId!==record.turnId || record.uiRecord?.cancelled)) { record.controller.abort(); return true; }
    if(result?.action==='settings') {
      const list=result.content?.list;
      if(!['controlAllowedApps','observationBlockedApps'].includes(list)||record.resolving)return true;
      const isCurrent=()=>consentIsPending(record)&&currentApprovalKey(record)===record.scopeKey&&settingsOwner.getSettings().windowUseEnabled;
      try {if(isCurrent())void Promise.resolve(settingsHost.openApprovalSettings({list,descriptor:record.binding.kind==='app'?record.binding.descriptor:undefined,isCurrent})).catch(error=>vscode.window.showErrorMessage?.(errorPayload(error).message));}catch{}
      return true;
    }
    if (!result || !['accept', 'decline', 'cancel'].includes(result.action) || (result.action === 'accept' && !record.offered.includes(result.content?.persist ?? result._meta?.persist))) return true;
    if(record.resolving)return true;
    record.resolving=true;
    void trackApproval((async()=>{
      if(currentApprovalKey(record)!==record.scopeKey||!settingsOwner.getSettings().windowUseEnabled) {record.controller.abort();return;}
      const resumeRequested=record.deferred;
      let saved=await durableApprovals.resolve(record.thread,id,record.scopeKey,result,resumeRequested);
      if(record.controller.signal.aborted||disposed||currentApprovalKey(record)!==record.scopeKey) {record.controller.abort();return;}
      if(record.deferred&&!resumeRequested) saved=await durableApprovals.resolve(record.thread,id,record.scopeKey,result,true);
      if(saved.state==='accepted') {let receipts=approvalReceipts.get(record.thread);if(!receipts)approvalReceipts.set(record.thread,receipts=new Map());receipts.set(record.scopeKey,saved);}
      if(record.deferred)finishConsent(record,saved.state);else record.waiter?.resolve(result);
    })()).catch(error=>{record.resolving=false;record.waiter?.reject(windowError('connection_error','승인 응답 저장을 확인하지 못했습니다. 작업은 실행되지 않았습니다.',{stage:'approval',approvalState:'cancelled',userResponded:true,actionExecuted:false,cause:error}));if(record.deferred&&!disposed)void trackApproval(restoreApprovals(record.thread)).catch(()=>{});});
    return true;
  }
  async function consent(descriptor, thread = current, operation={permission:'control'}) {
    const t = threads.get(thread), version = t?.turnVersion, permission = scope.getStore();
    if (!t || permission?.threadId !== thread || permission.disabled !== true) throw windowError('permission_denied', 'Native permission context denied', { stage: 'approval' });
    const appPermission=operation.permission??'control',offered=appPermission==='control'?['session','always']:['session'];
    if(appPermission==='control')assertControlAllowed(descriptor);
    const hasApproval=()=>appPermission==='desktop'?tDesktopAllowed(thread):approvals.hasAppApproval(descriptor.executable,thread,appPermission);
    if(appPermission==='desktop'&&t.mode==='selectedWindow')throw windowError('permission_denied','Desktop control is outside this conversation capability');
    if(hasApproval())return true;
    const appTitle=String(appPermission==='desktop'?'Desktop':descriptor.title||descriptor.executable).replace(/[\x00-\x1f\x7f]/g,' ').slice(0,512);
    let id = CONSENT_PREFIX + randomUUID(); let request = { id, method: 'mcpServer/elicitation/request', params: { serverName: 'azrael_window', threadId: thread, mode: 'form', message: 'Window Use: 선택한 앱의 창을 캡처하고 제어하도록 허용할까요?', requestedSchema: { type: 'object', properties: {} }, _meta: { connector_id: 'window-use', connector_name: 'Window Use', codex_approval_kind: 'mcp_tool_call', tool_params: { app: descriptor?.executable, permission:appPermission }, tool_params_display: [{ name: 'app', display_name: 'App', value: appTitle }], persist: offered } } };
    request.params.message=appPermission==='observation'?'Window Use: 이 앱의 창 내용을 관찰하도록 허용할까요?':'Window Use: 이 앱의 창을 제어하도록 허용할까요?';
    if(appPermission==='desktop')request.params.message='Window Use: 이 대화에서 전체 화면 제어를 허용할까요?';
    if(operation.switchedInput===true) {
      request.params.message='이 앱의 창에 공유 전경 입력과 마우스 협업을 허용합니다. 모델이 대상 창을 전경으로 올릴 수 있습니다. 실제 키보드 입력은 통과시키고 모델 입력을 중지합니다.';
      request.params._meta.tool_params.switchedInput=true;
      request.params._meta.tool_params_display.push({name:'process',display_name:'프로세스',value:'PID '+descriptor.pid+' · 생성 '+descriptor.processCreated+' · '+descriptor.executable});
    }
    let stored,needsPrompt=false;approvals.receive(request,(_id,result)=>{stored=result;},()=>{needsPrompt=true;});
    const denied = result => { if (result?.content?.windowError) throw fromPayload(result.content.windowError); throw windowError('cancelled', 'Application approval cancelled', { stage: 'approval' }); };
    if (stored) { if (stored.action !== 'accept') denied(stored); if (!hasApproval()) throw windowError('permission_denied', 'Application authorization revoked', { stage: 'approval' }); return true; }
    if (!needsPrompt) denied();
    Object.assign(request.params._meta,{window_use_async_approval:true,window_use_approval_state:'pending'});
    const binding=approvalBinding(thread,descriptor,{permission:appPermission}),key=durableApprovals.scopeKey(binding);
    await restoreApprovals(thread);
    const receipt=approvalReceipts.get(thread)?.get(key);
    if(receipt?.state==='accepted') {
      {const answer={action:'accept',content:{persist:receipt.persistence}};if(approvals.response(id,answer)?.action!=='accept'||!hasApproval())denied();}
      return true;
    }
    const existing=[...pendingConsents.values()].find(item=>item.thread===thread&&item.scopeKey===key);
    if(existing?.waitPromise) {
      approvals.response(id,{action:'cancel'});
      await existing.waitPromise;
      permissionContext(thread);
      if(!hasApproval())throw windowError('permission_denied','Application authorization revoked');
      return true;
    }
    if(existing) {
      approvals.response(id,{action:'cancel'});
      id=existing.id;request=existing.request;
      approvals.receive(request,()=>{},()=>{});
      Object.assign(existing,{deferred:false,uiRecord:permission.uiRecord,turnId:permission.turnId,version});
    }
    let saved;
    try {if(!existing)saved=await durableApprovals.request(thread,request,binding);}catch(error){approvals.response(id,{action:'cancel'});throw windowError('connection_error','승인 요청을 안전하게 저장하지 못했습니다. 작업은 실행되지 않았습니다.',{actionExecuted:false,cause:error});}
    const record=existing??adoptApproval(saved,t,{deferred:false,uiRecord:permission.uiRecord,turnId:permission.turnId,version}),controller=record.controller;
    const abort = () => controller.abort(); permission.signal?.addEventListener('abort', abort, { once: true });
    let terminalState = 'cancelled';
    const details = (approvalState, userResponded = false) => ({ stage: 'approval', approvalState, userResponded, actionExecuted: false });
    try {
      if (permission.signal?.aborted || permission.uiRecord?.cancelled || disposed || threads.get(thread) !== t || t.turnVersion !== version) controller.abort();
      if (controller.signal.aborted) throw windowError('cancelled', 'Application approval cancelled', details('cancelled'));
      permission.progress?.('approval');
      const response = new Promise((resolve,reject) => {record.waiter={resolve,reject};});
      record.waitPromise=response;
      void response.catch(()=>{});
      let delivered;
      try {delivered=await publishConsent(record,{type:'mcp-request',hostId:'local',request});}
      catch(error) {throw windowError('connection_error','Window Use approval UI is not connected',{...details('cancelled'),cause:error});}
      if(delivered===false)throw windowError('connection_error','Window Use approval UI is not connected',details('cancelled'));
      if(controller.signal.aborted)throw windowError('cancelled','Application approval cancelled',details('cancelled'));
      notifyConsent(record,appTitle);
      record.timer=setTimeout(()=>record.waiter?.reject(windowError('approval_timeout','Application approval timed out',details('expired'))),approvalTimeoutMs);
      const answer = await response;
      if(settingsOwner.getSettings().windowUseGeneration!==record.policyGeneration) throw windowError('permission_denied','Application authorization revoked');
      if (controller.signal.aborted || disposed || threads.get(thread) !== t || t.turnVersion !== version || permission.uiRecord?.cancelled || (permission.turnId && t.turnId !== permission.turnId)) throw windowError('cancelled', 'Application approval cancelled', details('cancelled'));
      if (answer.action !== 'accept') throw windowError(answer.action === 'decline' ? 'approval_denied' : 'cancelled', answer.action === 'decline' ? 'Application approval refused' : 'Application approval cancelled', details(answer.action === 'decline' ? 'declined' : 'cancelled', true));
      const result = approvals.response(id, answer);
      if (result?.action !== 'accept') denied(result);
      if (!hasApproval()) throw windowError('permission_denied', 'Application authorization revoked', { stage: 'approval' }); terminalState = 'accepted'; return true;
    } catch (error) { terminalState = error.approvalState || 'cancelled';record.terminalState=terminalState;if(error.code!=='permission_pending'&&!record.deferred)record.controller.abort();if(!record.deferred) approvals.response(id, { action: 'cancel' }); throw error; }
    finally { permission.progress?.('running');permission.signal?.removeEventListener('abort',abort);record.waiter=undefined;if(!record.deferred)finishConsent(record,terminalState); }
  }
  function prepareRequest(method, params) {
    if (!['thread/start', 'thread/resume'].includes(method) || runtime.windowControl === undefined) return params;
    const nodeExecutable = runtimeNodeExecutable(runtime);
    if (!absolute(nodeExecutable) || !absolute(runtime.windowControl?.mcpScript) || !absolute(runtime.codexHome)) throw windowError('connection_error', 'Window Use runtime binding is incomplete', { stage: 'connection' });
    return { ...params, config: { ...params?.config,
      'mcp_servers.azrael_window.command': nodeExecutable,
      'mcp_servers.azrael_window.tool_timeout_sec': 600,
      'mcp_servers.azrael_window.args': [runtime.windowControl.mcpScript],
      'mcp_servers.azrael_window.env.CODEX_HOME': runtime.codexHome,
    } };
  }
  async function startThread() {
    const bridge = [...bridges.values()][0]; if (!bridge) throw windowError('connection_error', 'Native engine is not connected');
    const result = await bridge.rpc('thread/start', prepareRequest('thread/start', { computerUseMode: 'selectedWindow', config: { 'mcp_servers.azrael_window.enabled': true }, developerInstructions: GUIDE, cwd: runtime.workspacePath || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath }));
    if (result?.computerUseMode !== 'selectedWindow' || !UUID.test(result.thread?.id || '')) throw new Error('Engine did not verify selectedWindow mode; update the engine before selecting a window');
    const thread = result.thread.id;
    try { const registered=registerThread(thread, bridge);registered.mode='selectedWindow';await registered.ready; } catch (e) { await cleanup(thread); throw e; } if (disposed) { await cleanup(thread); throw windowError('cancelled', 'Window host disposed'); } current = thread; render({ state: '창을 선택하거나 요청을 입력해주세요' });
  }
  async function handleUI(message) {
    if (message?.type === 'approval-response') {
      if (message.nonce !== panelNonce || message.threadId !== current || Object.keys(message).some(k => !['nonce', 'type', 'threadId', 'requestId', 'result'].includes(k))) throw windowError('invalid_request', 'Invalid panel approval response');
      const record = pendingConsents.get(message.requestId);
      if (record?.route === 'panel' && record.panelNonce === panelNonce && record.thread === current) respondApproval(record.native, message.requestId, message.result);
      return;
    }
    if (!message || message.nonce !== panelNonce || Object.keys(message).some(k => !['nonce', 'type', ...(message.type === 'send' ? ['text'] : [])].includes(k))) throw windowError('invalid_request', 'Invalid panel message');
    const allowed = ['start', 'select', 'capture', 'pause', 'resume', 'clear', 'send', 'macro', 'action']; if (!allowed.includes(message.type)) throw windowError('unsupported_action', 'Unknown panel operation');
    if (message.type === 'pause') { if (current) { invalidateUI(current); approvals.stop(current); render(owner.stop(current)); const t = threads.get(current); if (t) { t.turnVersion++; t.starting = false; } if (t?.turnId) { const turnId = t.turnId; t.turnId = undefined; await t.bridge.rpc('turn/interrupt', { threadId: current, turnId }); } } return; }
    if (message.type === 'clear' && current) { invalidateUI(current); approvals.stop(current); owner.clear(current); last = undefined; render(); }
    if (message.type === 'send' && (threads.get(current)?.turnId || threads.get(current)?.starting)) throw windowError('state_changed', '현재 실행이 끝난 뒤 메시지를 보내주세요');
    return serial(async () => {
      if (disposed) throw windowError('cancelled', 'Window host disposed');
      if (message.type === 'start') { if (current) throw new Error('Clear the current selection before creating another conversation'); return startThread(); }
      if (message.type === 'select') {
        if (!current) throw new Error('Create a selected-window conversation first');
        const windows = await uiScope(() => owner.listWindows(current)); enumerated = new Map(windows.map(w => [randomUUID(), w]));
        const choice = await vscode.window.showQuickPick([...enumerated].map(([id, w]) => ({ label: w.title || '(untitled)', description: w.executable, detail: w.occupancy.status === 'unknown' ? '점유 상태 확인 불가' : w.occupancy.sessions.filter(s => !s.isCurrentSession).map(s => `${s.workspaceName} · 대화 ${s.sessionId} · ${{selected:'선택됨',ready:'준비',paused:'일시정지',running:'실행 중'}[s.state]}`).join(', ') || '사용 가능', id })), { title: '제어할 창 하나 선택' });
        if (!choice) return; const descriptor = enumerated.get(choice.id); if (!descriptor) throw new Error('Window selection was not enumerated');
        render(await uiScope(() => owner.bind(current, descriptor))); selections.set(current, descriptor); return;
      }
      if (message.type === 'clear') { if (current) await cleanup(current); return; }
      if (message.type === 'send') {
        if (typeof message.text !== 'string' || !message.text.trim() || message.text.length > 32768 || !current) throw new Error('Create a Window Use conversation and enter a prompt');
        const t = threads.get(current); if (t.turnId || t.starting) throw windowError('state_changed', '현재 실행이 끝난 뒤 메시지를 보내주세요');
        const version = t.turnVersion; t.starting = true; render(publicState('실행 중'));
        try { const result = await t.bridge.rpc('turn/start', { threadId: current, input: [{ type: 'text', text: message.text, text_elements: [] }] }); if (t.turnVersion === version && !t.turnId && result?.turn?.status !== 'completed' && typeof result?.turn?.id === 'string') t.turnId = result.turn.id; } finally { t.starting = false; } return;
      }
      if (message.type === 'resume') { const descriptor = selections.get(current); if (!descriptor) throw windowError('selection_required', '창을 먼저 선택해주세요.'); render(await uiScope(() => owner.resume(current))); return; }
      if (message.type === 'capture') { render(await uiScope(() => owner.call(current, 'capture', { windowId: last?.windowId || last?.targetId }))); return; }
      if (message.type === 'action') {
        render(await uiScope(async () => {await owner.requestPermission(current,{permission:'control',targetId:last?.targetId,reason:'사용자가 선택한 창의 동작 실행을 요청했습니다.'});return owner.inspectForTask(current);}));
        const observationId = last?.observationId; const elements = last?.elements || []; const choice = await vscode.window.showQuickPick(elements.flatMap(e => (e.patterns || []).map(pattern => ({ label: `${e.name || e.controlType}: ${pattern}`, element: e.id, pattern }))), { title: '지원되는 UI 자동화 동작 선택' }); if (!choice) return;
        if (!observationId || last?.observationId !== observationId || !last?.elements?.some(e => e.id === choice.element && e.patterns.includes(choice.pattern))) throw new Error('창 상태가 변경되었습니다. 다시 캡처한 뒤 동작을 선택해주세요');
        const tool = { Invoke: 'invoke', Value: 'set_value', Toggle: 'toggle', SelectionItem: 'select', ExpandCollapse: 'expand', Scroll: 'scroll', invoke: 'invoke', setValue: 'set_value', toggle: 'toggle', select: 'select', expand: 'expand', collapse: 'collapse', scroll: 'scroll' }[choice.pattern]; if (!tool) throw new Error('Unsupported action pattern');
        const args = { windowId: last.windowId || last.targetId, observationId: last.observationId, elementId: choice.element };
        if (tool === 'set_value') { const value = await vscode.window.showInputBox({ prompt: '값' }); if (value === undefined) return; args.value = value; }
        if (tool === 'scroll') args.value = { horizontal: 0, vertical: 1 };
        render(await uiScope(() => owner.call(current, tool, args))); return;
      }
      if (message.type === 'macro') {
        const macros = await owner.getMacros(); const operation = await vscode.window.showQuickPick(['만들기', '편집', '삭제', '실행'], { title: '크기 매크로: 창 바깥 크기 DIP, 1~10단계' }); if (!operation) return;
        let entry; if (operation !== '만들기') { entry = await vscode.window.showQuickPick(macros.map(m => ({ label: m.name, ...m }))); if (!entry) return; }
        if (operation === '삭제') return owner.deleteMacro(entry.id);
        if (operation === '실행') { render(await uiScope(async () => {await owner.requestPermission(current,{permission:'control',targetId:last?.targetId,reason:'사용자가 창 크기 매크로 실행을 요청했습니다.'});return owner.call(current, 'run_size_macro', { windowId: last?.windowId || last?.targetId, macroId: entry.id });})); return; }
        const name = await vscode.window.showInputBox({ prompt: '매크로 이름', value: entry?.name }); if (!name) return;
        const sizes = await vscode.window.showInputBox({ prompt: '창 바깥 크기를 DIP로 1~10개 입력하세요. 예: 800x600,1024x768', value: entry?.steps.map(s => `${s.widthDip}x${s.heightDip}`).join(',') }); if (!sizes) return;
        const steps = sizes.split(',').map(s => { const match = /^\s*(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)\s*$/.exec(s); if (!match) throw new Error('Invalid DIP size'); return { widthDip: Number(match[1]), heightDip: Number(match[2]) }; }); await owner.saveMacro({ id: entry?.id || randomUUID(), name, steps });
      }
    });
  }
  function open() {
    if (panel) { panel.reveal(); return; } panelNonce = randomBytes(32).toString('hex');
    panel = vscode.window.createWebviewPanel('azraelWindowControl', 'Azrael Window Use', vscode.ViewColumn.One, { enableScripts: true, retainContextWhenHidden: true });
    const web = panel.webview;
    const panelHTML = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'nonce-${panelNonce}'; script-src 'nonce-${panelNonce}'"><style nonce="${panelNonce}">body{font:14px sans-serif;padding:16px;color:var(--vscode-foreground)}button{margin:4px}img{max-width:100%}textarea{width:95%;height:80px}pre{white-space:pre-wrap}</style></head><body><h2>Window Use</h2><p>${escape(runtime.windowControl?.acceptanceVerified === true ? '네이티브 런타임을 검증했습니다.' : '실험 기능: 실제 창 캡처와 백그라운드 입력 검증이 아직 완료되지 않았습니다.')}</p><p>선택한 창만 캡처합니다. 최소화하면 제어가 일시 중지되며 모델이 선택한 창을 복원할 수 있습니다. ${escape(process.platform === 'linux' ? '중지 버튼으로 멈추면 사용자가 다시 시작해야 합니다. 크기는 창 내용 영역 기준 DIP입니다.' : '중지 버튼이나 Ctrl+Alt+Shift+F12로 멈추면 사용자가 다시 시작해야 합니다. 크기는 창 바깥쪽 기준 DIP입니다.')}</p>${['start','select','capture','pause','resume','clear','action','macro'].map(type => `<button data-type="${type}">${({start:'Window Use 전용 대화 시작',select:'창 선택',capture:'캡처',pause:'중지',resume:'다시 시작',clear:'선택 해제',action:'지원되는 동작',macro:'크기 매크로'})[type]}</button>`).join('')}<pre id="status"></pre><img id="image"><pre id="elements"></pre><textarea id="prompt" placeholder="제어할 창과 작업을 설명해주세요"></textarea><button data-type="send">보내기</button><pre id="conversation"></pre><script nonce="${panelNonce}">const api=acquireVsCodeApi();document.querySelectorAll('button').forEach(b=>b.onclick=()=>api.postMessage({nonce:'${panelNonce}',type:b.dataset.type,...(b.dataset.type==='send'?{text:document.getElementById('prompt').value}:{})}));window.addEventListener('message',e=>{const m=e.data;if(m.type==='state'){document.getElementById('status').textContent=JSON.stringify({thread:m.threadId,state:m.value.state,status:m.value.status,window:m.value.window,pauseReason:m.value.pauseReason,restoreAllowed:m.value.restoreAllowed},null,2);document.getElementById('image').src=m.value.image?'data:image/png;base64,'+m.value.image.data:'';document.getElementById('elements').textContent=JSON.stringify(m.value.elements||[],null,2);}if(m.type==='text'||m.type==='error')document.getElementById('conversation').textContent+='\\n'+m.text;});</script></body></html>`;
    web.html = panelHTML.replace("document.querySelectorAll('button')", "document.querySelectorAll('button[data-type]')")
      .replace('</style>', `#approval{margin:20px 0;padding:20px;border:1px solid var(--vscode-widget-border,var(--vscode-panel-border,#888));border-radius:12px;background:var(--vscode-editorWidget-background,var(--vscode-editor-background));font-family:var(--vscode-font-family,system-ui,sans-serif);line-height:1.5}#approval[hidden]{display:none}#approval h3{font-size:16px;font-weight:600;margin:0 0 8px}#approval p{margin:8px 0}#approval-app{overflow-wrap:anywhere;font-weight:600}#approval-message,#approval-details{overflow-wrap:anywhere;white-space:pre-wrap}#approval-details dt{font-weight:600}#approval-details dd{margin:0 0 8px}#approval button[hidden]{display:none}#approval-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}#approval button{margin:0;padding:8px 12px;border:1px solid var(--vscode-button-border,transparent);border-radius:8px;font:inherit;color:var(--vscode-button-secondaryForeground,var(--vscode-foreground));background:var(--vscode-button-secondaryBackground,var(--vscode-editor-background));cursor:pointer}#approval button[data-approval="session"]{color:var(--vscode-button-foreground);background:var(--vscode-button-background)}#approval button:hover:enabled{background:var(--vscode-button-secondaryHoverBackground,var(--vscode-list-hoverBackground))}#approval button[data-approval="session"]:hover:enabled{background:var(--vscode-button-hoverBackground)}#approval button:focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:2px}#approval button:disabled{opacity:.55;cursor:default}#approval-state{color:var(--vscode-descriptionForeground,var(--vscode-foreground))}</style>`)
      .replace('<pre id="status">', `<section id="approval" role="region" aria-labelledby="approval-heading" hidden><h3 id="approval-heading">Window Use 승인</h3><p id="approval-app"></p><p id="approval-message"></p><dl id="approval-details"></dl><p id="approval-state" role="status" aria-live="polite"></p><div id="approval-actions"><button data-approval="session">이 대화에서 허용</button><button data-approval="always">항상 허용</button><button data-approval="decline">거부</button><button data-approval="cancel">취소</button></div></section><pre id="status">`)
      .replace('</body>', `<script nonce="${panelNonce}">let approvalRequest;const approvalBox=document.getElementById('approval'),approvalButtons=[...document.querySelectorAll('[data-approval]')],approvalState=document.getElementById('approval-state');approvalButtons.forEach(button=>button.onclick=()=>{if(!approvalRequest||button.disabled||button.hidden)return;const offered=approvalRequest.params._meta.persist||[];if(['session','always'].includes(button.dataset.approval)&&!offered.includes(button.dataset.approval))return;approvalButtons.forEach(b=>b.disabled=true);approvalState.textContent='응답을 처리하고 있습니다.';const choice=button.dataset.approval;api.postMessage({nonce:'${panelNonce}',type:'approval-response',requestId:approvalRequest.id,threadId:approvalRequest.params.threadId,result:{action:choice==='session'||choice==='always'?'accept':choice,...(choice==='session'||choice==='always'?{content:{persist:choice}}:{})}})});window.addEventListener('message',event=>{const message=event.data;if(message.type==='approval'){approvalRequest=message.request;approvalBox.hidden=false;const params=approvalRequest.params,meta=params._meta,fields=Array.isArray(meta.tool_params_display)?meta.tool_params_display:[];document.getElementById('approval-app').textContent=fields.find(f=>f.name==='app')?.value||meta.tool_params?.app||'';document.getElementById('approval-message').textContent=params.message||'이 앱의 선택한 창을 캡처하고 제어하도록 허용할까요?';const details=document.getElementById('approval-details');details.replaceChildren();for(const field of fields.filter(f=>f.name!=='app')){const term=document.createElement('dt'),value=document.createElement('dd');term.textContent=field.display_name||field.name;value.textContent=field.value;details.append(term,value)}for(const button of approvalButtons){const choice=button.dataset.approval;button.hidden=['session','always'].includes(choice)&&(!(meta.persist||[]).includes(choice));if(choice==='session')button.textContent='이 대화에서 허용';}approvalState.textContent='승인 응답을 기다리고 있습니다. 아직 창 제어는 실행되지 않았습니다.';approvalButtons.forEach(b=>b.disabled=false)}if(message.type==='approval-resolved'&&approvalRequest?.id===message.requestId&&approvalRequest.params.threadId===message.threadId){approvalButtons.forEach(b=>b.disabled=true);approvalState.textContent=({expired:'승인 응답을 받지 못해 대기 시간이 초과됐습니다. 창 제어는 실행되지 않았습니다. 다시 요청해주세요.',cancelled:'승인 요청이 취소됐습니다. 창 제어는 실행되지 않았습니다.',declined:'앱 제어를 거부했습니다. 창 제어는 실행되지 않았습니다.',accepted:'앱 제어를 허용했습니다.'})[message.approvalState]||'승인 요청이 종료됐습니다.';approvalRequest=undefined}});</script></body>`);
    web.onDidReceiveMessage(message => { void handleUI(message).catch(e => panel?.webview.postMessage({ type: 'error', text: errorPayload(e).message })); });
    panel.onDidDispose(() => { for (const record of activeConsents) if (record.route === 'panel' && record.panelNonce === panelNonce) {if(!record.deferred)record.controller.abort();else record.panelNonce=undefined;} panel = undefined; panelNonce = undefined; }); render(); if(current)void trackApproval(restoreApprovals(current)).catch(()=>{});
  }
  // Hidden metadata threads have no durable approval ledger or Window Use rendezvous.
  // Remember the native identity so later turn notifications cannot register them.
  function rememberEphemeralThread(native, thread) {
    if (thread?.ephemeral !== true || !UUID.test(thread.id || '') || !bridges.has(native)) return false;
    let ids = ephemeralThreads.get(native);
    if (!ids) { ids = new Set(); ephemeralThreads.set(native, ids); }
    ids.add(thread.id);
    return true;
  }
  function observe(native, message) {
    const params = message?.params; const thread = params?.threadId || params?.thread?.id;
    if (message?.method === 'thread/started') rememberEphemeralThread(native, params?.thread);
    const hidden = ephemeralThreads.get(native);
    if (hidden?.has(thread)) {
      if (['thread/closed','thread/archived','thread/deleted','thread/ended'].includes(message.method)) hidden.delete(thread);
      return;
    }
    if (UUID.test(thread || '') && ['thread/started', 'turn/started'].includes(message?.method) && !threads.has(thread)) {
      const bridge = bridges.get(native); if (bridge && !disposed) registerThread(thread, bridge);
    }
    const t = threads.get(thread); if (!t || t.bridge.native !== native) return;
    if (message.method === 'turn/started') { invalidateUI(thread,{preserveApprovals:true}); t.turnVersion++; t.starting = false; t.turnId = params.turn?.id; }
    if (['thread/closed','thread/archived','thread/deleted','thread/ended'].includes(message.method)) { invalidateUI(thread); approvals.stop(thread); owner.clear(thread); void serial(() => cleanup(thread)); }
    if (message.method === 'turn/completed') { invalidateUI(thread,{preserveApprovals:true}); t.turnVersion++; t.starting = false; t.turnId = undefined; owner.invalidateObservation(thread); if (current === thread) { render(publicState(params.turn?.status || '완료')); if (params.turn?.error?.message) void panel?.webview.postMessage({ type: 'error', text: params.turn.error.message }); } }
    if (current !== thread) return;
    if (message.method === 'item/agentMessage/delta' && typeof params.delta === 'string') void panel?.webview.postMessage({ type: 'text', text: params.delta });
    if (message.method === 'error') void panel?.webview.postMessage({ type: 'error', text: params.error?.message || params.message || 'Engine error' });
  }
  function request(native, provider, id, method, params) {
    if(method==='turn/interrupt') {const t=threads.get(params?.threadId);if(t?.bridge.native===native && (!params.turnId || params.turnId===t.turnId)) {invalidateUI(params.threadId);approvals.stop(params.threadId);owner.stop(params.threadId);t.turnVersion++;}}
    const bridge = bridges.get(native);
    if (!bridge || provider === bridge.provider || !['thread/start', 'thread/resume'].includes(method)) return;
    if (typeof provider !== 'string' || typeof id !== 'string' || provider.length > 256 || id.length > 256) return;
    const requests = lifecycleRequests.get(native) || new Map(); lifecycleRequests.set(native, requests);
    for (const [key, record] of requests) if (Date.now() - record.created > 60000) requests.delete(key);
    if (requests.size >= 256) throw new Error('Too many Window Use lifecycle requests');
    requests.set(provider + ':' + id, { method, expectedThread: method === 'thread/resume' ? params?.threadId : undefined, created: Date.now() });
  }
  function beforeResult(native, message, replay) {
    const requests = lifecycleRequests.get(native), record = requests?.get(message?.id);
    if (!record) return false;
    requests.delete(message.id);
    if (message.error) return false;
    const thread = message.result?.thread?.id, bridge = bridges.get(native);
    let ready;
    try {
      if (!UUID.test(thread || '') || (record.expectedThread && record.expectedThread !== thread)) throw new Error('Invalid Window Use lifecycle response');
      if (rememberEphemeralThread(native, message.result.thread)) return false;
      const registered=registerThread(thread, bridge);registered.mode=message.result?.computerUseMode;ready = registered.ready;
    } catch (error) { ready = Promise.reject(error); }
    void ready.then(() => { if (!disposed && bridges.get(native) === bridge) replay(message); }).catch(async error => {
      if (threads.get(thread)?.bridge === bridge) { try { await cleanup(thread); } catch {} }
      if (!disposed && bridges.get(native) === bridge) replay({ id: message.id, error: errorPayload(error) });
    });
    return true;
  }
  function attach(native, raw) { if (!bridges.has(native)) bridges.set(native, new Bridge(native, raw, () => disconnect(native))); return bridges.get(native); }
  function disconnect(native) { lifecycleRequests.delete(native); ephemeralThreads.delete(native); approvalUIs.delete(native); approvalNavigation.delete(native); const bridge = bridges.get(native); if (!bridge) return;
    for(const record of activeConsents)if(record.native===native){record.preserveOnAbort=true;record.controller.abort();}
    bridge.dispose(); bridges.delete(native); for (const [thread, t] of threads) if (t.bridge === bridge) { invalidateUI(thread,{preserveApprovals:true}); approvals.stop(thread); owner.clear(thread); if (current === thread) render(publicState('엔진 연결 끊김')); void serial(() => cleanup(thread,{preserveApprovals:true})); } }
  const policyFile=path.join(runtime.codexHome,'azrael','computer-use','use-settings.json');
  const policyListener=()=>{for(const record of activeConsents){let generation;try{generation=settingsOwner.getSettings().windowUseGeneration;}catch{}if(generation!==record.policyGeneration)record.controller.abort();}for(const [thread,grant] of controlGrants) {let currentGeneration;try{currentGeneration=settingsOwner.getSettings().windowUseGeneration;}catch{}if(currentGeneration!==grant.policyGeneration){invalidateUI(thread);owner.invalidateObservation(thread);approvals.stop(thread);}}};
  fs.watchFile(policyFile,{persistent:false,interval:250},policyListener);
  const approvalWatches=['window-use'].map(connector=>{
    const file=path.join(runtime.codexHome,'azrael',connector,'app-approvals.json');
    const listener=()=>{let fingerprint;try{fingerprint=appRevocationFingerprint();}catch{}for(const record of activeConsents)if(fingerprint===undefined||record.binding.appRevocationFingerprint!==fingerprint)record.controller.abort();for(const [thread,grant]of controlGrants)if(fingerprint===undefined||grant.appRevocationFingerprint!==fingerprint){invalidateUI(thread);approvals.stop(thread);}};
    fs.watchFile(file,{persistent:false,interval:250},listener);return {file,listener};
  });

  const settingsHost = require('./use-settings-host.cjs').createSettingsHost({ runtime, vscode, backend, approvals, open });
  async function dispose() { if (disposed) return; disposed = true; await Promise.allSettled([...activeConsents].map(record=>durableApprovals.defer(record.thread,record.id,record.scopeKey))); await Promise.allSettled([...approvalTasks]); fs.unwatchFile(policyFile,policyListener);for(const watch of approvalWatches)fs.unwatchFile(watch.file,watch.listener); notificationSubscription?.dispose(); settingsHost.dispose(); invalidateUI(); await owner.dispose(); await virtualInput?.dispose(); await switchedInput?.dispose(); for (const bridge of bridges.values()) bridge.dispose(); bridges.clear(); lifecycleRequests.clear(); approvalUIs.clear(); panel?.dispose(); for (const thread of [...threads.keys()]) await cleanup(thread); await Promise.all([...cleanupTasks.values()]); await queue; if(server?.listening===true) await new Promise(resolve=>server.close(resolve));else server?.close(); await Promise.all([...notificationTasks]); await backend.dispose(); if (socketDirectory) {try{await fsp.unlink(pipe);}catch(error){if(error.code!=='ENOENT')throw error;}await fsp.rmdir(socketDirectory);} }
  return { settings: settingsHost.receive, open, attach, prepareRequest, registerApprovalUI, respondApproval, request, beforeResult, observe, disconnect, dispose, handlePipe, handleUI, startThread, owner, threads, get panelNonce() { return panelNonce; }, get nonce() { return nonce; } };
}
let active;
function initialize(context, vscode, runtime) { if (active) throw new Error('Window Control already initialized'); active = createHost({ runtime, vscode }); const command = vscode.commands.registerCommand('azrael.windowControl', () => active.open()); let disposal; const disposable = { dispose() { if (disposal) return disposal; command.dispose(); const old = active; active = undefined; disposal = old?.dispose() || Promise.resolve(); return disposal; } }; context.subscriptions.push(disposable); return disposable; }
module.exports = { initialize, settings: (webview, request) => active ? active.settings(webview, request) : require('./use-settings-host.cjs').unavailable(webview, request), attach: (native, raw) => active?.attach(native, raw), prepareRequest: (method, params) => active ? active.prepareRequest(method, params) : params, registerApprovalUI: (native, publish, navigate) => active?.registerApprovalUI(native, publish, navigate), respondApproval: (native, id, result) => active ? active.respondApproval(native, id, result) : typeof id === 'string' && id.startsWith(CONSENT_PREFIX), request: (native, ...args) => active?.request(native, ...args), beforeResult: (native, message, replay) => active?.beforeResult(native, message, replay), observe: (native, message) => active?.observe(native, message), disconnect: native => active?.disconnect(native), createHost, Bridge };
module.exports.setApprovalOwnerResolver = setApprovalOwnerResolver;
registry.set(runtimeKey, module.exports);
}
