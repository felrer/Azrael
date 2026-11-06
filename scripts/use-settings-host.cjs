'use strict';
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const validClient = id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(id);
const actions = { read: [], update: ['patch','expectedRevision'], addApp: ['list'], removeApp: ['bundleIdentifier','source'], open: [] };
function createSettingsHost({ runtime, vscode, backend, settingsOwner = require('./use-control-settings.cjs').createSettingsOwner(runtime.codexHome), approvals = require('./window-use-approvals.cjs').createOwner(runtime.codexHome), open = () => {} }) {
  let disposed = false;
  const snapshot = () => ({ settings: settingsOwner.getSettings(), approvedApps: approvals.getPersistentAppApprovals().approvedApps });
  const check = () => { if (disposed) throw new Error('Settings host disposed'); };
  // Only the host's current approval record may supply this context. It is not
  // an action accepted by receive(), and no executable crosses the UI bridge.
  async function openApprovalSettings({ list, descriptor, isCurrent }) {
    const fail = (code, message) => require('./window-control-errors.cjs').windowError(code, message, { stage: 'approval', actionExecuted: false });
    if (!['observationBlockedApps', 'controlAllowedApps'].includes(list) || typeof isCurrent !== 'function') throw fail('invalid_request', 'Invalid approval settings context');
    const current = () => { check(); if (!isCurrent()) throw fail('state_changed', 'Approval request changed. Open settings from the current request.'); };
    current();
    const policy = settingsOwner.getSettings();
    const normalize = require('./use-control-settings.cjs').normalizeExecutable;
    const registered = new Set(policy[list]);
    if (list === 'controlAllowedApps') for (const app of approvals.getPersistentAppApprovals?.().approvedApps || []) registered.add(normalize(app.bundleIdentifier));
    const windows = await backend.request('listWindows', {}); current();
    if (!Array.isArray(windows)) throw new Error('Invalid running window list');
    const trusted = new Map(), choices = [];
    for (const window of windows) {
      if (typeof window.hwnd !== 'string' || !Number.isSafeInteger(window.pid) || window.pid <= 0 || typeof window.processCreated !== 'string' || !window.processCreated) continue;
      let key; try { key = normalize(window.executable); } catch { continue; }
      const id = randomUUID(), remove = registered.has(key); trusted.set(id, { app: { ...window }, key, remove });
      choices.push({ id, label: window.title || path.win32.basename(window.executable), description: window.executable, detail: remove ? '등록된 앱 · 선택하면 목록에서 제거합니다.' : '실행 중인 앱 · 저장하면 목록에 추가됩니다.' });
    }
    for (const key of registered) {
      if ([...trusted.values()].some(entry => entry.key === key)) continue;
      const id = randomUUID(); trusted.set(id, { key, remove: true });
      choices.push({ id, label: path.win32.basename(key), description: key, detail: '등록된 앱 · 실행 중이지 않습니다. 선택하면 목록에서 제거합니다.' });
    }
    const target = descriptor?.executable ? normalize(descriptor.executable) : undefined;
    const selected = target ? choices.find(choice => {
      const entry = trusted.get(choice.id), app = entry.app;
      return entry.key === target && (entry.remove || app && ['hwnd','pid','processCreated','packageName','packageFullName','applicationId'].every(key => descriptor[key] === undefined || descriptor[key] === app[key]));
    }) : undefined;
    if (target && !selected) throw fail('state_changed', 'Application window changed. Please select it again.');
    const title = list === 'controlAllowedApps' ? '화이트리스트 설정' : '시큐리티 앱 설정';
    let choice;
    if (typeof vscode.window.createQuickPick === 'function') {
      choice = await new Promise(resolve => {
        const picker = vscode.window.createQuickPick(); let done = false;
        const finish = value => { if (done) return; done = true; accept.dispose(); hide.dispose(); picker.dispose(); resolve(value); };
        picker.title = title; picker.placeholder = '등록된 앱은 제거하고, 실행 중인 새 앱은 추가할 수 있습니다.'; picker.items = choices;
        if (selected) picker.activeItems = [selected];
        const accept = picker.onDidAccept(() => finish(picker.selectedItems[0]));
        const hide = picker.onDidHide(() => finish(undefined));
        picker.show();
      });
    } else choice = await vscode.window.showQuickPick(selected ? [selected, ...choices.filter(item => item !== selected)] : choices, { title });
    current(); if (!choice) return;
    const entry = trusted.get(choice.id); if (!entry) throw fail('invalid_request', 'Application was not enumerated');
    const { app, key, remove } = entry, action = remove ? '제거' : '저장';
    const detail = remove ? key + '\n이 목록의 앱 설정만 제거합니다. 현재 승인 요청은 허용되지 않습니다.' : app.executable + (list === 'observationBlockedApps' ? '\n이 앱의 제어가 차단됩니다. 관찰에는 대화별 승인이 필요합니다.' : '\n개별 앱 제어 승인을 생략합니다. 현재 승인 요청을 허용하지는 않습니다.');
    const answer = await vscode.window.showWarningMessage(title + (remove ? '에서 앱을 제거할까요?' : '에 앱을 저장할까요?'), { modal: true, detail }, action);
    current(); if (answer !== action) return;
    if (remove) {
      if (settingsOwner.getSettings().revision !== policy.revision) throw fail('state_changed', 'Settings revision conflict. Open settings again.');
      try {
        if (list === 'controlAllowedApps') await approvals.removeAppApproval(key, 'control', policy.revision);
        else await settingsOwner.updateSettings({ observationBlockedApps: policy.observationBlockedApps.filter(app => app !== key) }, policy.revision);
      } catch (error) { if (error.code === 'REVISION_CONFLICT') throw fail('state_changed', 'Settings revision conflict. Open settings again.'); throw error; }
      return;
    }
    const fresh = await backend.request('listWindows', {}); current();
    if (!Array.isArray(fresh) || !fresh.some(window => ['hwnd','pid','processCreated','executable','packageName','packageFullName','applicationId'].every(key => window[key] === app[key]))) throw fail('state_changed', 'Application window changed. Please select it again.');
    // Preserve the revision captured before opening UI; concurrent policy edits
    // must be reviewed through a fresh request instead of silently merged.
    try { await settingsOwner.updateSettings({ [list]: [...policy[list], app.executable] }, policy.revision); }
    catch (error) { if (error.code === 'REVISION_CONFLICT') throw fail('state_changed', 'Settings revision conflict. Open settings again.'); throw error; }
  }
  async function receive(webview, request) {
    if (!validClient(request?.clientId) || !validClient(request?.requestId) || typeof webview?.postMessage !== 'function') return;
    let error;
    try {
      check();
      if (!request || request.type !== 'azrael-use-settings' || Array.isArray(request) || !Object.hasOwn(actions, request.action) || Object.keys(request).some(k => !['type','clientId','requestId','action', ...actions[request.action]].includes(k))) throw new Error('Invalid settings request');
      if (request.action === 'update') await settingsOwner.updateSettings(request.patch, request.expectedRevision);
      if (request.action === 'open') await open();
      if (request.action === 'addApp') {
        if (!['observationBlockedApps', 'controlAllowedApps'].includes(request.list)) throw new Error('Invalid application list');
        const windows = await backend.request('listWindows', {}); check();
        if (!Array.isArray(windows)) throw new Error('Invalid running window list');
        const trusted = new Map();
        const choices = windows.filter(w => typeof w.hwnd === 'string' && Number.isSafeInteger(w.pid) && w.pid > 0 && typeof w.processCreated === 'string' && w.processCreated && typeof w.executable === 'string' && (process.platform === 'linux' ? path.isAbsolute(w.executable) : path.win32.isAbsolute(w.executable) && /\.exe$/i.test(w.executable))).map(w => {
          const id = randomUUID(); trusted.set(id, { ...w }); return { id, label: w.title || (process.platform === 'win32' ? path.win32 : path).basename(w.executable), description: w.executable };
        });
        const choice = await vscode.window.showQuickPick(choices, { title: request.list === 'observationBlockedApps' ? '시큐리티 앱 선택' : '화이트리스트 앱 선택' }); check();
        if (choice) {
          const selected = trusted.get(choice.id);
          if (!selected) throw new Error('Application was not enumerated');
          const fresh = await backend.request('listWindows', {}); check();
          if (!Array.isArray(fresh) || !fresh.some(w => ['hwnd','pid','processCreated','executable'].every(k => w[k] === selected[k]))) throw new Error('Application window changed. Please select it again.');
          const policy = settingsOwner.getSettings();
          await settingsOwner.updateSettings({ [request.list]: [...policy[request.list], selected.executable] }, policy.revision);
        }
      }
      if (request.action === 'removeApp') {
        if (!['observationBlockedApps', 'controlAllowedApps'].includes(request.source)) throw new Error('Invalid application list');
        const key = require('./use-control-settings.cjs').normalizeExecutable(request.bundleIdentifier);
        const policy = settingsOwner.getSettings();
        const known = request.source === 'controlAllowedApps' ? snapshot().approvedApps.some(a => a.bundleIdentifier === key) : policy.observationBlockedApps.includes(key);
        if (!known) throw new Error('Unknown application');
        const answer = await vscode.window.showWarningMessage('앱 설정을 제거할까요?', { modal: true, detail: key }, '제거'); check();
        if (answer === '제거') {
          if (request.source === 'controlAllowedApps') await approvals.removeAppApproval(key);
          else { const current = settingsOwner.getSettings(); await settingsOwner.updateSettings({ observationBlockedApps: current.observationBlockedApps.filter(app => app !== key) }, current.revision); }
        }
      }
    } catch (e) { error = e.message || String(e); }
    if (disposed) return;
    let state = {}; try { state = snapshot(); } catch (e) { error ||= e.message || String(e); }
    await webview.postMessage({ type: 'azrael-use-settings-state', clientId: request.clientId, requestId: request.requestId, ...state, ...(error ? { error } : {}) });
  }
  return { receive, openApprovalSettings, dispose() { disposed = true; } };
}
async function unavailable(webview, request) {
  if (validClient(request?.clientId) && validClient(request?.requestId) && typeof webview?.postMessage === 'function') await webview.postMessage({ type: 'azrael-use-settings-state', clientId: request.clientId, requestId: request.requestId, error: 'Window Use settings host is unavailable' });
}
module.exports = { createSettingsHost, unavailable };
