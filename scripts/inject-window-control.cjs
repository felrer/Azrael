'use strict';
const APPROVAL_CLASSIFIER_ASSET = 'webview/assets/app-initial-5120fa5fe295.js';
const CLASSIFIER_MARKER = '/*azrael-window-native-approval-v1*/';
const CLASSIFIER_ANCHOR = 'return t===`computer-use`||t.startsWith(`computer-use-`)';
const CLASSIFIER_PATCH = CLASSIFIER_ANCHOR + '||t===`window-use`' + CLASSIFIER_MARKER;
function injectWindowApprovalClassifier(text, relativePath) {
  if(relativePath!==APPROVAL_CLASSIFIER_ASSET)return {text,count:0};
  const markers=text.split(CLASSIFIER_MARKER).length-1;
  if(markers){if(markers!==1||text.split(CLASSIFIER_PATCH).length-1!==1)throw Error('Invalid Window Use native approval classifier marker');return {text,count:0};}
  if(text.split(CLASSIFIER_ANCHOR).length-1!==1)throw Error('Pinned Window Use native approval classifier changed');
  return {text:text.replace(CLASSIFIER_ANCHOR,CLASSIFIER_PATCH),count:1};
}
const SETTINGS_ASSET = 'webview/assets/computer-use-settings-f7844e8d05eb.js';
const HOST_MARKER = '/*azrael-window-control-bridge-v1*/';
const PAGE_MARKER = '/*azrael-window-control-launcher-v3*/';
const HOST_ANCHOR = 'case"open-vscode-command":{';
const HOST_PATCH = 'case"azrael-window-control":{await Ge.commands.executeCommand("azrael.windowControl");break}' + 'case"azrael-use-settings":{await require("./window-control-host.cjs").settings(e,r);break}' + HOST_MARKER + HOST_ANCHOR;
const PAGE_ANCHOR = '(0,$.jsxs)(Gt,{title:d,subtitle:f,children:[v,y]})';
const PAGE_PATCH = '(0,$.jsxs)(Gt,{title:d,subtitle:f,children:[v,y,(0,$.jsx)(AzraelWindowControlLauncher,{})]})';
function createUseSettingsStore(bridge, clientId, timing = globalThis, createRequestId = () => globalThis.crypto.randomUUID()) {
  let state = { settings: null, approvedApps: [], loading: true, saving: false, error: null };
  let disposed = false, timer, polling, awaiting = false, pendingRequestId, pendingQuiet = false;
  const listeners = new Set();
  const publish = value => { state = value; for (const listener of listeners) listener(); };
  const cancel = () => { if (timer !== undefined) timing.clearTimeout(timer); timer = undefined; };
  const receive = message => {
    if (disposed || !awaiting || message?.clientId !== clientId || message.requestId !== pendingRequestId) return;
    const s = message.settings;
    if (!message.error && (!s || s.schema !== 1 || !Number.isSafeInteger(s.revision) || typeof s.computerUseEnabled !== 'boolean' || typeof s.windowUseAllowAll !== 'boolean' || !Array.isArray(message.approvedApps))) return;
    cancel(); awaiting = false; pendingRequestId = undefined; pendingQuiet = false;
    publish({ settings: s || state.settings, approvedApps: Array.isArray(message.approvedApps) ? message.approvedApps : state.approvedApps, loading: false, saving: false, error: typeof message.error === 'string' ? message.error : null });
  };
  const unsubscribe = bridge.subscribe('azrael-use-settings-state', receive);
  const send = (action, args = {}, quiet = false) => {
    if (disposed || (awaiting && (quiet || !pendingQuiet))) return;
    if (awaiting) cancel();
    const requestId = createRequestId();
    pendingRequestId = requestId; pendingQuiet = quiet; awaiting = true;
    if (!quiet) publish({ ...state, loading: action === 'read', saving: action !== 'read', error: null });
    timer = timing.setTimeout(() => { if (pendingRequestId !== requestId) return; timer = undefined; awaiting = false; pendingRequestId = undefined; pendingQuiet = false; if (!disposed) publish({ ...state, loading: false, saving: false, error: '설정 응답을 받지 못했습니다. 다시 불러와 주세요.' }); }, 10000);
    timer?.unref?.();
    try { bridge.dispatchMessage('azrael-use-settings', { clientId, requestId, action, ...args }); }
    catch (e) { cancel(); awaiting = false; pendingRequestId = undefined; pendingQuiet = false; publish({ ...state, loading: false, saving: false, error: e.message || String(e) }); }
  };
  send('read');
  polling = timing.setInterval(() => { if (!awaiting && !state.error) send('read', {}, true); }, 3000); polling?.unref?.();
  return { getSnapshot: () => state, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    update: patch => { if (!state.settings || state.loading || state.saving) return; send('update', { patch, expectedRevision: state.settings.revision }); },
    addApp: () => send('addApp'), removeApp: bundleIdentifier => send('removeApp', { bundleIdentifier }), open: () => send('open'), retry: () => send('read'),
    dispose: () => { if (disposed) return; disposed = true; pendingRequestId = undefined; pendingQuiet = false; awaiting = false; cancel(); timing.clearInterval(polling); unsubscribe(); listeners.clear(); } };
}
function AzraelWindowControlLauncher() {
  const Q = getAzraelUseReact();
  initAzraelUseCard(); initAzraelUseRow(); initAzraelUseSwitch(); initAzraelUseButton();
  const [store] = Q.useState(() => createUseSettingsStore(azraelWindowBridge, crypto.randomUUID()));
  Q.useEffect(() => () => store.dispose(), [store]);
  const state = Q.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const busy = state.loading || state.saving;
  const button = (label, onClick, props = {}) => (0, $.jsx)(AzraelUseButton, { color: 'secondary', size: 'default', disabled: busy, onClick, ...props, children: label });
  const row = (label, description, control) => (0, $.jsx)(AzraelUseRow, { label, description, control });
  return (0, $.jsxs)('section', { 'data-azrael-window-control': true, className: 'flex flex-col gap-10', 'aria-busy': busy, children: [
    (0, $.jsx)(AzraelUseCard, { children: row('Computer Use', '컴퓨터 제어 도구 사용을 허용합니다.', ariaProps => (0, $.jsx)(AzraelUseSwitch, { ...ariaProps, checked: state.settings?.computerUseEnabled ?? true, disabled: busy || !state.settings, onChange: enabled => store.update({ computerUseEnabled: enabled }) })) }),
    (0, $.jsxs)('section', { className: 'flex flex-col gap-4', 'aria-labelledby': 'azrael-window-use-heading', children: [
      (0, $.jsxs)('div', { className: 'flex flex-col gap-1', children: [
        (0, $.jsx)('h2', { id: 'azrael-window-use-heading', className: 'text-lg font-semibold text-default', children: 'Window Use' }),
        (0, $.jsx)('p', { className: 'text-sm text-secondary', children: '선택한 창을 캡처·제어합니다. Computer Use 설정과 별도로 적용됩니다.' })
      ] }),
      (0, $.jsx)(AzraelUseCard, { children: row('모든 앱 허용', '켜면 Window Use가 모든 앱을 사용할 수 있습니다.', ariaProps => (0, $.jsx)(AzraelUseSwitch, { ...ariaProps, checked: state.settings?.windowUseAllowAll ?? false, disabled: busy || !state.settings, onChange: enabled => store.update({ windowUseAllowAll: enabled }) })) }),
      (0, $.jsxs)(AzraelUseCard, { children: [
        row('항상 허용한 앱', 'Window Use에만 적용되는 앱 목록입니다.', () => button('실행 중인 창에서 추가', store.addApp)),
        ...state.approvedApps.map(app => (0, $.jsx)(AzraelUseRow, { label: app.displayName, description: (0, $.jsx)('span', { className: 'break-all', children: app.bundleIdentifier }), control: () => button('삭제', () => store.removeApp(app.bundleIdentifier), { 'aria-label': `${app.displayName} 허용 삭제` }) }, app.bundleIdentifier)),
        !state.loading && !state.approvedApps.length ? (0, $.jsx)('p', { className: 'px-4 py-3 text-sm text-secondary', children: '항상 허용한 앱이 없습니다.' }) : null
      ] }),
      (0, $.jsx)('div', { className: 'flex', children: button('Window Use 열기', store.open) })
    ] }),
    busy ? (0, $.jsx)('p', { role: 'status', className: 'text-sm text-secondary', children: state.loading ? '설정을 불러오는 중…' : '저장 중…' }) : null,
    state.error ? (0, $.jsxs)('div', { role: 'alert', className: 'flex items-center gap-3 text-sm text-secondary', children: [(0, $.jsx)('span', { children: state.error }), button('다시 불러오기', store.retry)] }) : null
  ] });
}

function once(text, from, to) {
  if (text.split(from).length !== 2) throw new Error('Pinned selected-window anchor changed: ' + from.slice(0, 60));
  return text.replace(from, to);
}
function injectWindowControl(text, relativePath, ts) {
  if (relativePath === SETTINGS_ASSET) {
    if (text.includes(PAGE_MARKER)) {
      if (text.split(PAGE_MARKER).length !== 2 || !text.includes(PAGE_PATCH) || !text.includes(AzraelWindowControlLauncher.toString()) || !text.includes(createUseSettingsStore.toString())) throw new Error('Invalid selected-window launcher marker');
      return { text, count: 0 };
    }
    return { text: 'import{ZOt as getAzraelUseReact}from"./app-initial-efe028fd535e.js";import{A3t as azraelWindowBridge,d3 as AzraelUseCard,f3 as initAzraelUseCard,y3 as AzraelUseRow,x3 as initAzraelUseRow}from"./app-initial-5120fa5fe295.js";import{r4 as AzraelUseSwitch,a4 as initAzraelUseSwitch,Zjt as AzraelUseButton,$jt as initAzraelUseButton}from"./app-initial-532d60c9b397.js";' + once(text, PAGE_ANCHOR, PAGE_PATCH) + '\n' + PAGE_MARKER + '\n' + createUseSettingsStore.toString() + '\n' + AzraelWindowControlLauncher.toString(), count: 1 };
  }
  if (relativePath !== 'out/extension.js') return { text, count: 0 };
  if (text.includes(HOST_MARKER)) {
    const hooks = [['require("./window-control-host.cjs").prepareRequest(', 1], ['require("./window-control-host.cjs").attach(this,', 1], ['require("./window-control-host.cjs").request(this,', 1], ['require("./window-control-host.cjs").beforeResult(this,', 1], ['require("./window-control-host.cjs").observe(this,', 1], ['require("./window-control-host.cjs").disconnect(this);', 2]];
    if (text.split(HOST_MARKER).length !== 2 || !text.includes(HOST_PATCH) || hooks.some(([hook, count]) => text.split(hook).length !== count + 1)) throw new Error('Invalid selected-window bridge marker');
    return { text, count: 0 };
  }
  const source = ts.createSourceFile(relativePath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const edits = [], counts = { send: 0, observe: 0, disconnect: 0 };
  function visit(node) {
    if (ts.isMethodDeclaration(node) && node.name?.text === 'sendProviderRequest') {
      if (!node.body || node.parameters.length !== 6) throw new Error('Pinned selected-window bridge request signature changed');
      if (node.parameters.some(p => !ts.isIdentifier(p.name))) throw new Error('Window Use request parameters changed');
      const parameterNames = node.parameters.slice(0, 4).map(p => p.name.text).join(',');
      const methodName=node.parameters[2].name.text, paramsName=node.parameters[3].name.text;
      edits.push({ start: node.body.getStart(source) + 1, code: `${paramsName}=require("./window-control-host.cjs").prepareRequest(${methodName},${paramsName});try{require("./window-control-host.cjs").attach(this,(...azraelWindowArgs)=>this.sendProviderRequest(...azraelWindowArgs));require("./window-control-host.cjs").request(this,${parameterNames});}catch(azraelWindowError){console.error("Azrael selected-window bridge unavailable");}` });
      counts.send++;
      for (const sibling of node.parent.members) {
        if (sibling.name?.text === 'routeIncomingMessage' && sibling.body && sibling.parameters.length === 2 && ts.isIdentifier(sibling.parameters[0].name)) {
          if (!ts.isIdentifier(sibling.parameters[1].name)) throw new Error('Window Use response context changed');
          const responseName = sibling.parameters[0].name.text, contextName = sibling.parameters[1].name.text;
          // The native line dispatcher reads routeKind and method even when publication is deferred.
          edits.push({ start: sibling.body.getStart(source) + 1, code: `try{if(require("./window-control-host.cjs").beforeResult(this,${responseName},azraelWindowResponse=>this.routeIncomingMessage(azraelWindowResponse,${contextName})))return{routeKind:"response",method:null};require("./window-control-host.cjs").observe(this,${responseName});}catch(azraelWindowError){try{require("./window-control-host.cjs").disconnect(this);}catch{}console.error("Azrael selected-window observer failed closed");}` }); counts.observe++;
        }
        if (sibling.name?.text === 'teardownProcess' && sibling.body && sibling.parameters.length === 0) {
          edits.push({ start: sibling.body.getStart(source) + 1, code: 'try{require("./window-control-host.cjs").disconnect(this);}catch(azraelWindowError){console.error("Azrael selected-window disconnect failed");}' }); counts.disconnect++;
        }
      }
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (Object.values(counts).some(n => n !== 1)) throw new Error('Pinned selected-window bridge changed: ' + JSON.stringify(counts));
  for (const edit of edits.sort((a, S) => S.start - a.start)) text = text.slice(0, edit.start) + edit.code + text.slice(edit.start);
  text = once(text, HOST_ANCHOR, HOST_PATCH);
  if (ts.createSourceFile(relativePath, text, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS).parseDiagnostics.length) throw new Error('Invalid selected-window bridge transform');
  return { text, count: 4 };
}
module.exports = { injectWindowControl, SETTINGS_ASSET, HOST_MARKER, PAGE_MARKER, HOST_ANCHOR, HOST_PATCH, PAGE_ANCHOR, PAGE_PATCH, AzraelWindowControlLauncher, createUseSettingsStore };

Object.assign(module.exports,{injectWindowApprovalClassifier,APPROVAL_CLASSIFIER_ASSET,CLASSIFIER_MARKER,CLASSIFIER_ANCHOR,CLASSIFIER_PATCH});
