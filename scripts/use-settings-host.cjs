'use strict';
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const validClient = id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(id);
const actions = { read: [], update: ['patch','expectedRevision'], addApp: [], removeApp: ['bundleIdentifier'], open: [] };
function createSettingsHost({ runtime, vscode, backend, settingsOwner = require('./use-control-settings.cjs').createSettingsOwner(runtime.codexHome), approvals = require('./window-use-approvals.cjs').createOwner(runtime.codexHome), open = () => {} }) {
  let disposed = false;
  const snapshot = () => ({ settings: settingsOwner.getSettings(), approvedApps: approvals.getPersistentAppApprovals().approvedApps });
  const check = () => { if (disposed) throw new Error('Settings host disposed'); };
  async function receive(webview, request) {
    if (!validClient(request?.clientId) || !validClient(request?.requestId) || typeof webview?.postMessage !== 'function') return;
    let error;
    try {
      check();
      if (!request || request.type !== 'azrael-use-settings' || Array.isArray(request) || !Object.hasOwn(actions, request.action) || Object.keys(request).some(k => !['type','clientId','requestId','action', ...actions[request.action]].includes(k))) throw new Error('Invalid settings request');
      if (request.action === 'update') await settingsOwner.updateSettings(request.patch, request.expectedRevision);
      if (request.action === 'open') await open();
      if (request.action === 'addApp') {
        const windows = await backend.request('listWindows', {}); check();
        if (!Array.isArray(windows)) throw new Error('Invalid running window list');
        const trusted = new Map();
        const choices = windows.filter(w => typeof w.hwnd === 'string' && Number.isSafeInteger(w.pid) && w.pid > 0 && typeof w.processCreated === 'string' && w.processCreated && typeof w.executable === 'string' && path.win32.isAbsolute(w.executable) && /\.exe$/i.test(w.executable)).map(w => {
          const id = randomUUID(); trusted.set(id, { ...w }); return { id, label: w.title || path.win32.basename(w.executable), description: w.executable };
        });
        const choice = await vscode.window.showQuickPick(choices, { title: '항상 허용할 실행 중인 앱 선택' }); check();
        if (choice) {
          const selected = trusted.get(choice.id);
          if (!selected) throw new Error('Application was not enumerated');
          const fresh = await backend.request('listWindows', {}); check();
          if (!Array.isArray(fresh) || !fresh.some(w => ['hwnd','pid','processCreated','executable'].every(k => w[k] === selected[k]))) throw new Error('Application window changed. Please select it again.');
          await approvals.addAppApproval(selected.executable, path.win32.basename(selected.executable));
        }
      }
      if (request.action === 'removeApp') {
        const entry = snapshot().approvedApps.find(app => app.bundleIdentifier === request.bundleIdentifier);
        if (!entry) throw new Error('Unknown approved application');
        const answer = await vscode.window.showWarningMessage(`${entry.displayName}의 Window Use 항상 허용을 삭제할까요?`, { modal: true, detail: entry.bundleIdentifier }, '삭제'); check();
        if (answer === '삭제') {
          if (!snapshot().approvedApps.some(app => app.bundleIdentifier === entry.bundleIdentifier)) throw new Error('Approved application changed');
          await approvals.removeAppApproval(entry.bundleIdentifier);
        }
      }
    } catch (e) { error = e.message || String(e); }
    if (disposed) return;
    let state = {}; try { state = snapshot(); } catch (e) { error ||= e.message || String(e); }
    await webview.postMessage({ type: 'azrael-use-settings-state', clientId: request.clientId, requestId: request.requestId, ...state, ...(error ? { error } : {}) });
  }
  return { receive, dispose() { disposed = true; } };
}
async function unavailable(webview, request) {
  if (validClient(request?.clientId) && validClient(request?.requestId) && typeof webview?.postMessage === 'function') await webview.postMessage({ type: 'azrael-use-settings-state', clientId: request.clientId, requestId: request.requestId, error: 'Window Use settings host is unavailable' });
}
module.exports = { createSettingsHost, unavailable };
