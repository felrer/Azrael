'use strict';
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const { StringDecoder } = require('node:string_decoder');
const { randomUUID, randomBytes, timingSafeEqual } = require('node:crypto');
const { AsyncLocalStorage } = require('node:async_hooks');
const { windowError, errorPayload, fromPayload, expectedError } = require('./window-control-errors.cjs');
const physicalPath = fs.realpathSync.native(__filename);
const runtimeKey = process.platform === 'win32' ? physicalPath.toLowerCase() : physicalPath;
const registry = globalThis[Symbol.for('azrael-ex.window-control-runtimes.v1')] ??= new Map();
if (registry.has(runtimeKey)) module.exports = registry.get(runtimeKey);
else {
const { createBackend } = require('./window-control-backend.cjs');
const { createWindowOwner } = require('./window-control-policy.cjs');
const { commonDirectory } = require('./window-control-occupancy.cjs');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const actualDisabled = meta => { const p = meta?.['codex/sandbox-state-meta']?.permissionProfile; return p && typeof p === 'object' && !Array.isArray(p) && Object.keys(p).length === 1 && p.type === 'disabled'; };
const GUIDE = 'This Window Use conversation controls one exact window through azrael_window. Use list_windows and select_window to find the window required by the user. Check fresh list_windows or status occupancy before selection and each action or macro. Defer control and report the occupying sessions when another session occupies the target or occupancy is unknown. Resume only after fresh occupancy shows no other session. Never use another computer, desktop screenshot, browser, shell, node_repl, or arbitrary code to control windows. Inspect fresh elements before each action. Use run_task_macro for bounded action sequences and verify postconditions. Window-message keys are experimental; delivery is not proof of completion. A paused target requires explicit user resume. Report actual tool errors and supported patterns. Never change account, model, or permissions.';
const escape = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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
function createHost({ runtime, vscode, backend = createBackend(runtime), approvals = require('./window-use-approvals.cjs'), createServer = net.createServer, occupancyDirectory, approvalTimeoutMs = 25000 }) {
  const scope = new AsyncLocalStorage(), bridges = new Map(), threads = new Map(), files = new Map(), selections = new Map(), uiTokens = new Map(), activeUI = new Set(), activeConsents = new Set(), lifecycleRequests = new Map(), cleanupTasks = new Map();
  const nonce = randomBytes(32).toString('hex'), pipe = '\\\\.\\pipe\\azrael-window-' + randomUUID();
  let panel, panelNonce, current, enumerated = new Map(), last, server, listening, disposed = false, queue = Promise.resolve();
  const owner = createWindowOwner({ backend, codexHome: runtime.codexHome, occupancyDirectory: occupancyDirectory || runtime.occupancyDirectory || commonDirectory(), workspaceName: path.win32.basename(runtime.workspacePath || vscode.workspace?.workspaceFolders?.[0]?.uri.fsPath || '') || 'Azrael', approve: async (w, thread) => { const allowed = await consent(w, thread); if (allowed) selections.set(thread, w); return allowed; }, authorize: (w, thread) => {
    const permission = scope.getStore(), t = threads.get(thread); return permission?.threadId === thread && permission.disabled === true && !permission.signal?.aborted && t && (!permission.uiRecord || !permission.uiRecord.cancelled) && (!permission.turnId || t.turnId === permission.turnId) && approvals.hasAppApproval(w.executable, thread);
  } });
  const serial = fn => { const result = queue.then(fn); queue = result.catch(() => {}); return result; };
  function invalidateUI(thread) { for (const consent of activeConsents) if (!thread || consent.thread === thread) consent.controller.abort(); for (const record of activeUI) if (!thread || record.thread === thread) { record.cancelled = true; uiTokens.delete(record.token); } }
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
  const publicState = status => ({ targetId: last?.targetId, state: last?.state, window: last?.window, supportedActions: last?.supportedActions, ...(status ? { status } : {}) });
  function renderFailure(thread) { if (!thread || current !== thread) return; let value; try { value = owner.peek(thread); } catch { /* Preserve the original operation error. */ } render(value || publicState('실행 오류')); }
  function cleanup(thread) {
    if (cleanupTasks.has(thread)) return cleanupTasks.get(thread);
    const task = cleanupThread(thread).finally(() => { if (cleanupTasks.get(thread) === task) cleanupTasks.delete(thread); });
    cleanupTasks.set(thread, task);
    return task;
  }
  async function cleanupThread(thread) {
    const closing = threads.get(thread); if (closing) closing.closed = true;
    invalidateUI(thread); approvals.stop(thread); owner.clear(thread); selections.delete(thread);
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
    if (message.method !== 'call' || !threads.has(message.threadId)) throw windowError('selection_required', 'Unknown selected-window session');
    const t = threads.get(message.threadId);
    await t.ready;
    if (request.signal?.aborted) throw windowError('cancelled', 'Selected-window request cancelled');
    if (disposed || threads.get(message.threadId) !== t || message._meta?.threadId !== message.threadId || !actualDisabled(message._meta)) throw windowError('permission_denied', 'Native permission context denied');
    if (message.tool === 'ui_operation') {
      const args = message.arguments;
      if (Object.hasOwn(message._meta, 'x-codex-turn-metadata') || !args || Object.keys(args).length !== 1 || typeof args.requestToken !== 'string' || !/^[a-f0-9]{64}$/.test(args.requestToken)) throw windowError('permission_denied', 'Invalid UI operation proof');
      const record = uiTokens.get(args.requestToken);
      if (!record || record.thread !== message.threadId || record.t !== t || record.cancelled || current !== record.thread || t.turnId || t.starting) throw windowError('cancelled', 'Unknown or cancelled UI operation token');
      uiTokens.delete(record.token);
      try { record.result = await scope.run({ ...request, threadId: record.thread, disabled: true, uiRecord: record }, record.fn); } catch (error) { record.error = error; renderFailure(record.thread); } finally { record.completed = true; }
      return {};
    }
    let meta = message._meta?.['x-codex-turn-metadata']; if (typeof meta === 'string') { try { meta = JSON.parse(meta); } catch { throw windowError('permission_denied', 'Invalid native metadata'); } }
    if (!meta || meta.thread_id !== message.threadId || typeof meta.turn_id !== 'string' || !t.turnId || meta.turn_id !== t.turnId) throw windowError('permission_denied', 'Native permission context denied');
    return scope.run({ ...request, threadId: message.threadId, disabled: true, turnId: meta.turn_id }, async () => { try { const result = await owner.call(message.threadId, message.tool, message.arguments); if (current === message.threadId) render(result); return result; } catch (error) { renderFailure(message.threadId); throw error; } });
  }
  async function listen() {
    if (listening) return listening;
    server = createServer(socket => {
      const controller = new AbortController(); let disconnected = false;
      const cancel = () => { disconnected = true; controller.abort(); };
      const progress = stage => { if (!disconnected && !socket.destroyed) socket.write?.(JSON.stringify({ progress: { stage } }) + '\n'); };
      let buffer = '', used = false, requestBytes = 0; const decoder = new StringDecoder('utf8'); socket.setTimeout(30000, () => { cancel(); socket.destroy(); }); socket.on('error', cancel); socket.on('close', cancel);
      socket.on('data', data => { if (used) return; const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data); const end = bytes.indexOf(10); const part = end < 0 ? bytes : bytes.subarray(0, end + 1); requestBytes += part.length; if (requestBytes > 65536) { used = true; socket.end(JSON.stringify({ error: errorPayload(windowError('invalid_request', '요청 크기가 Window Use 제한을 초과했습니다.', { stage: 'connection' })) }) + '\n'); return; } buffer += decoder.write(part); const newline = buffer.indexOf('\n'); if (newline < 0) return; used = true;
        progress('queued');
        let message; try { message = JSON.parse(buffer.slice(0, newline)); } catch { socket.end(JSON.stringify({ error: errorPayload(windowError('invalid_request', 'Invalid selected-window request')) }) + '\n'); return; }
        const deliver = async () => { if (disconnected || socket.destroyed) return; let response; try { response = { result: await handlePipe(message, { signal: controller.signal, progress }) }; } catch (e) { response = { error: errorPayload(e) }; } if (disconnected || socket.destroyed) return; const bytes = JSON.stringify(response); socket.end(Buffer.byteLength(bytes) > 32 * 1024 * 1024 ? JSON.stringify({ error: errorPayload(windowError('unclassified', '', { stage: 'running' })) }) + '\n' : bytes + '\n'); };
        void (message?.tool === 'ui_operation' ? deliver() : serial(deliver));
      });
    });
    listening = new Promise((resolve, reject) => { server.once('error', reject); server.listen(pipe, resolve); }); return listening;
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
    const t = { bridge, turnId: undefined, starting: false, turnVersion: 0 };
    threads.set(thread, t);
    t.ready = publish(thread).then(() => { if (disposed || t.closed || threads.get(thread) !== t || bridges.get(bridge.native) !== bridge) throw windowError('cancelled', 'Window Use registration cancelled'); });
    void t.ready.catch(() => {});
    return t;
  }
  async function consent(descriptor, thread = current) {
    const t = threads.get(thread), version = t?.turnVersion, permission = scope.getStore();
    if (!t || permission?.threadId !== thread || permission.disabled !== true) throw windowError('permission_denied', 'Native permission context denied', { stage: 'approval' });
    const id = randomUUID(); const request = { id, method: 'mcpServer/elicitation/request', params: { serverName: 'azrael_window', threadId: thread, _meta: { connector_id: 'window-use', tool_params: { app: descriptor.executable }, tool_params_display: [{ name: 'app', value: descriptor.title }], persist: ['session', 'always'] } } };
    let stored, needsPrompt = false; approvals.receive(request, (_id, result) => { stored = result; }, () => { needsPrompt = true; });
    const denied = result => { if (result?.content?.windowError) throw fromPayload(result.content.windowError); throw windowError('cancelled', 'Application approval cancelled', { stage: 'approval' }); };
    if (stored) { if (stored.action !== 'accept') denied(stored); if (!approvals.hasAppApproval(descriptor.executable, thread)) throw windowError('permission_denied', 'Application authorization revoked', { stage: 'approval' }); return true; }
    if (!needsPrompt) denied();
    const controller = new AbortController(), record = { thread, controller }; activeConsents.add(record);
    const abort = () => controller.abort(); permission.signal?.addEventListener('abort', abort, { once: true });
    let timer, onAbort;
    try {
      if (permission.signal?.aborted || permission.uiRecord?.cancelled || disposed || threads.get(thread) !== t || t.turnVersion !== version) controller.abort();
      if (controller.signal.aborted) throw windowError('cancelled', 'Application approval cancelled', { stage: 'approval' });
      const interrupted = new Promise((_, reject) => {
        onAbort = () => reject(windowError('cancelled', 'Application approval cancelled', { stage: 'approval' }));
        controller.signal.addEventListener('abort', onAbort, { once: true });
        timer = setTimeout(() => reject(windowError('approval_timeout', '승인 응답을 아직 받지 못해 대기 시간이 초과됐습니다.', { stage: 'approval' })), approvalTimeoutMs);
      });
      permission.progress?.('approval');
      const answer = await Promise.race([Promise.resolve().then(() => { if (controller.signal.aborted) throw windowError('cancelled', 'Application approval cancelled', { stage: 'approval' }); return vscode.window.showInformationMessage(`Window Use: ${descriptor.title || descriptor.executable} 앱의 창 제어를 허용할까요?`, { modal: true }, '이 대화에서 허용', '항상 허용', '거부'); }), interrupted]);
      if (controller.signal.aborted || disposed || threads.get(thread) !== t || t.turnVersion !== version || permission.uiRecord?.cancelled || (permission.turnId && t.turnId !== permission.turnId)) throw windowError('cancelled', 'Application approval cancelled', { stage: 'approval' });
      if (answer !== '이 대화에서 허용' && answer !== '항상 허용') throw windowError(answer === '거부' ? 'approval_declined' : 'cancelled', answer === '거부' ? 'Application approval refused' : 'Application approval cancelled', { stage: 'approval' });
      const result = approvals.response(id, { action: 'accept', content: { persist: answer === '항상 허용' ? 'always' : 'session' } });
      if (result?.action !== 'accept') denied(result);
      if (!approvals.hasAppApproval(descriptor.executable, thread)) throw windowError('permission_denied', 'Application authorization revoked', { stage: 'approval' }); return true;
    } catch (error) { approvals.response(id, { action: 'cancel' }); throw error; }
    finally { clearTimeout(timer); if (onAbort) controller.signal.removeEventListener('abort', onAbort); permission.signal?.removeEventListener('abort', abort); activeConsents.delete(record); }
  }
  async function startThread() {
    const bridge = [...bridges.values()][0]; if (!bridge) throw windowError('connection_error', 'Native engine is not connected');
    const result = await bridge.rpc('thread/start', { computerUseMode: 'selectedWindow', config: { 'mcp_servers.azrael_window.enabled': true }, developerInstructions: GUIDE, cwd: runtime.workspacePath || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath });
    if (result?.computerUseMode !== 'selectedWindow' || !UUID.test(result.thread?.id || '')) throw new Error('Engine did not verify selectedWindow mode; update the engine before selecting a window');
    const thread = result.thread.id;
    try { await registerThread(thread, bridge).ready; } catch (e) { await cleanup(thread); throw e; } if (disposed) { await cleanup(thread); throw windowError('cancelled', 'Window host disposed'); } current = thread; render({ state: '창을 선택하거나 요청을 입력해주세요' });
  }
  async function handleUI(message) {
    if (!message || message.nonce !== panelNonce || Object.keys(message).some(k => !['nonce', 'type', ...(message.type === 'send' ? ['text'] : [])].includes(k))) throw windowError('invalid_request', 'Invalid panel message');
    const allowed = ['start', 'select', 'capture', 'pause', 'resume', 'clear', 'send', 'macro', 'action']; if (!allowed.includes(message.type)) throw windowError('unsupported_action', 'Unknown panel operation');
    if (message.type === 'pause') { if (current) { invalidateUI(current); approvals.stop(current); if (last?.targetId) render(owner.stop(current)); const t = threads.get(current); if (t) { t.turnVersion++; t.starting = false; } if (t?.turnId) { const turnId = t.turnId; t.turnId = undefined; await t.bridge.rpc('turn/interrupt', { threadId: current, turnId }); } } return; }
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
        render(await uiScope(async () => { if (!await consent(descriptor)) throw new Error('Application approval refused'); return owner.bind(current, descriptor); })); selections.set(current, descriptor); return;
      }
      if (message.type === 'clear') { if (current) await cleanup(current); return; }
      if (message.type === 'send') {
        if (typeof message.text !== 'string' || !message.text.trim() || message.text.length > 32768 || !current) throw new Error('Create a Window Use conversation and enter a prompt');
        const t = threads.get(current); if (t.turnId || t.starting) throw windowError('state_changed', '현재 실행이 끝난 뒤 메시지를 보내주세요');
        const version = t.turnVersion; t.starting = true; render(publicState('실행 중'));
        try { const result = await t.bridge.rpc('turn/start', { threadId: current, input: [{ type: 'text', text: message.text, text_elements: [] }] }); if (t.turnVersion === version && !t.turnId && result?.turn?.status !== 'completed' && typeof result?.turn?.id === 'string') t.turnId = result.turn.id; } finally { t.starting = false; } return;
      }
      if (message.type === 'resume') { const descriptor = selections.get(current); if (!descriptor) throw windowError('selection_required', '창을 먼저 선택해주세요.'); render(await uiScope(async () => { if (!await consent(descriptor)) throw new Error('Application approval refused'); return owner.resume(current); })); return; }
      if (message.type === 'capture') { render(await uiScope(() => owner.call(current, 'capture', { targetId: last?.targetId }))); return; }
      if (message.type === 'action') {
        const observationId = last?.observationId; const elements = last?.elements || []; const choice = await vscode.window.showQuickPick(elements.flatMap(e => e.patterns.map(pattern => ({ label: `${e.name || e.controlType}: ${pattern}`, element: e.id, pattern }))), { title: '지원되는 UI 자동화 동작 선택' }); if (!choice) return;
        if (!observationId || last?.observationId !== observationId || !last?.elements?.some(e => e.id === choice.element && e.patterns.includes(choice.pattern))) throw new Error('창 상태가 변경되었습니다. 다시 캡처한 뒤 동작을 선택해주세요');
        const tool = { Invoke: 'invoke', Value: 'set_value', Toggle: 'toggle', SelectionItem: 'select', ExpandCollapse: 'expand', Scroll: 'scroll', invoke: 'invoke', setValue: 'set_value', toggle: 'toggle', select: 'select', expand: 'expand', collapse: 'collapse', scroll: 'scroll' }[choice.pattern]; if (!tool) throw new Error('Unsupported action pattern');
        const args = { targetId: last.targetId, observationId: last.observationId, elementId: choice.element };
        if (tool === 'set_value') { const value = await vscode.window.showInputBox({ prompt: '값' }); if (value === undefined) return; args.value = value; }
        if (tool === 'scroll') args.value = { horizontal: 0, vertical: 1 };
        render(await uiScope(() => owner.call(current, tool, args))); return;
      }
      if (message.type === 'macro') {
        const macros = await owner.getMacros(); const operation = await vscode.window.showQuickPick(['만들기', '편집', '삭제', '실행'], { title: '크기 매크로: 창 바깥 크기 DIP, 1~10단계' }); if (!operation) return;
        let entry; if (operation !== '만들기') { entry = await vscode.window.showQuickPick(macros.map(m => ({ label: m.name, ...m }))); if (!entry) return; }
        if (operation === '삭제') return owner.deleteMacro(entry.id);
        if (operation === '실행') { render(await uiScope(() => owner.call(current, 'run_size_macro', { targetId: last?.targetId, macroId: entry.id }))); return; }
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
    web.html = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'nonce-${panelNonce}'; script-src 'nonce-${panelNonce}'"><style nonce="${panelNonce}">body{font:14px sans-serif;padding:16px;color:var(--vscode-foreground)}button{margin:4px}img{max-width:100%}textarea{width:95%;height:80px}pre{white-space:pre-wrap}</style></head><body><h2>Window Use</h2><p>${escape(runtime.windowControl?.acceptanceVerified === true ? '네이티브 런타임을 검증했습니다.' : '실험 기능: 실제 창 캡처와 백그라운드 입력 검증이 아직 완료되지 않았습니다.')}</p><p>선택한 창만 캡처합니다. 다시 시작하면 처음 최소화된 창을 한 번 복원합니다. 다시 최소화하면 제어가 일시 중지됩니다. 크기는 창 바깥쪽 기준 DIP입니다.</p>${['start','select','capture','pause','resume','clear','action','macro'].map(type => `<button data-type="${type}">${({start:'Window Use 전용 대화 시작',select:'창 선택',capture:'캡처',pause:'중지',resume:'다시 시작',clear:'선택 해제',action:'지원되는 동작',macro:'크기 매크로'})[type]}</button>`).join('')}<pre id="status"></pre><img id="image"><pre id="elements"></pre><textarea id="prompt" placeholder="제어할 창과 작업을 설명해주세요"></textarea><button data-type="send">보내기</button><pre id="conversation"></pre><script nonce="${panelNonce}">const api=acquireVsCodeApi();document.querySelectorAll('button').forEach(b=>b.onclick=()=>api.postMessage({nonce:'${panelNonce}',type:b.dataset.type,...(b.dataset.type==='send'?{text:document.getElementById('prompt').value}:{})}));window.addEventListener('message',e=>{const m=e.data;if(m.type==='state'){document.getElementById('status').textContent=JSON.stringify({thread:m.threadId,state:m.value.state,status:m.value.status,window:m.value.window},null,2);document.getElementById('image').src=m.value.image?'data:image/png;base64,'+m.value.image.data:'';document.getElementById('elements').textContent=JSON.stringify(m.value.elements||[],null,2);}if(m.type==='text'||m.type==='error')document.getElementById('conversation').textContent+='\\n'+m.text;});</script></body></html>`;
    web.onDidReceiveMessage(message => { void handleUI(message).catch(e => panel?.webview.postMessage({ type: 'error', text: errorPayload(e).message })); });
    panel.onDidDispose(() => { panel = undefined; panelNonce = undefined; }); render();
  }
  function observe(native, message) {
    const params = message?.params; const thread = params?.threadId || params?.thread?.id;
    if (UUID.test(thread || '') && ['thread/started', 'turn/started'].includes(message?.method) && !threads.has(thread)) {
      const bridge = bridges.get(native); if (bridge && !disposed) registerThread(thread, bridge);
    }
    const t = threads.get(thread); if (!t || t.bridge.native !== native) return;
    if (message.method === 'turn/started') { invalidateUI(thread); t.turnVersion++; t.starting = false; t.turnId = params.turn?.id; }
    if (message.method === 'thread/closed') { invalidateUI(thread); approvals.stop(thread); owner.clear(thread); void serial(() => cleanup(thread)); }
    if (message.method === 'turn/completed') { invalidateUI(thread); t.turnVersion++; t.starting = false; t.turnId = undefined; owner.invalidateObservation(thread); if (current === thread) { render(publicState(params.turn?.status || '완료')); if (params.turn?.error?.message) void panel?.webview.postMessage({ type: 'error', text: params.turn.error.message }); } }
    if (current !== thread) return;
    if (message.method === 'item/agentMessage/delta' && typeof params.delta === 'string') void panel?.webview.postMessage({ type: 'text', text: params.delta });
    if (message.method === 'error') void panel?.webview.postMessage({ type: 'error', text: params.error?.message || params.message || 'Engine error' });
  }
  function request(native, provider, id, method, params) {
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
      ready = registerThread(thread, bridge).ready;
    } catch (error) { ready = Promise.reject(error); }
    void ready.then(() => { if (!disposed && bridges.get(native) === bridge) replay(message); }).catch(async error => {
      if (threads.get(thread)?.bridge === bridge) { try { await cleanup(thread); } catch {} }
      if (!disposed && bridges.get(native) === bridge) replay({ id: message.id, error: errorPayload(error) });
    });
    return true;
  }
  function attach(native, raw) { if (!bridges.has(native)) bridges.set(native, new Bridge(native, raw, () => disconnect(native))); return bridges.get(native); }
  function disconnect(native) { lifecycleRequests.delete(native); const bridge = bridges.get(native); if (!bridge) return; bridge.dispose(); bridges.delete(native); for (const [thread, t] of threads) if (t.bridge === bridge) { invalidateUI(thread); approvals.stop(thread); owner.clear(thread); if (current === thread) render(publicState('엔진 연결 끊김')); void serial(() => cleanup(thread)); } }
  const settingsHost = require('./use-settings-host.cjs').createSettingsHost({ runtime, vscode, backend, approvals, open });
  async function dispose() { if (disposed) return; disposed = true; settingsHost.dispose(); invalidateUI(); owner.dispose(); for (const bridge of bridges.values()) bridge.dispose(); bridges.clear(); lifecycleRequests.clear(); panel?.dispose(); for (const thread of [...threads.keys()]) await cleanup(thread); await Promise.all([...cleanupTasks.values()]); await queue; server?.close(); await backend.dispose(); }
  return { settings: settingsHost.receive, open, attach, request, beforeResult, observe, disconnect, dispose, handlePipe, handleUI, startThread, owner, threads, get panelNonce() { return panelNonce; }, get nonce() { return nonce; } };
}
let active;
function initialize(context, vscode, runtime) { if (active) throw new Error('Window Control already initialized'); active = createHost({ runtime, vscode }); const command = vscode.commands.registerCommand('azrael.windowControl', () => active.open()); let disposal; const disposable = { dispose() { if (disposal) return disposal; command.dispose(); const old = active; active = undefined; disposal = old?.dispose() || Promise.resolve(); return disposal; } }; context.subscriptions.push(disposable); return disposable; }
module.exports = { initialize, settings: (webview, request) => active ? active.settings(webview, request) : require('./use-settings-host.cjs').unavailable(webview, request), attach: (native, raw) => active?.attach(native, raw), request: (native, ...args) => active?.request(native, ...args), beforeResult: (native, message, replay) => active?.beforeResult(native, message, replay), observe: (native, message) => active?.observe(native, message), disconnect: native => active?.disconnect(native), createHost, Bridge };
registry.set(runtimeKey, module.exports);
}
