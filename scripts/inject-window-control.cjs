'use strict';
const SETTINGS_ASSET = 'webview/assets/settings-page-94cbae2cfc9d.js';
const HOST_MARKER = '/*azrael-window-control-bridge-v1*/';
const PAGE_MARKER = '/*azrael-window-control-launcher-v1*/';
const HOST_ANCHOR = 'case"open-vscode-command":{';
const HOST_PATCH = 'case"azrael-window-control":{await Ge.commands.executeCommand("azrael.windowControl");break}' + HOST_MARKER + HOST_ANCHOR;
const PAGE_ANCHOR = 'if(ne===`usage`)Ne=(0,$.jsx)(AzraelAccountSettings,{});';
const PAGE_PATCH = PAGE_ANCHOR + 'if(ne===`computer-use`)Ne=(0,$.jsxs)($.Fragment,{children:[Ne,(0,$.jsx)(AzraelWindowControlLauncher,{})]});';
function AzraelWindowControlLauncher() {
  return (0, $.jsxs)('section', { 'data-azrael-window-control': true, className: 'mt-6 flex flex-col gap-2', children: [
    (0, $.jsx)('h3', { className: 'font-medium', children: '선택 창 모드' }),
    (0, $.jsx)('p', { className: 'text-sm text-token-text-secondary', children: '선택한 창의 캡처·백그라운드 제어·최소화 복원·크기 매크로를 관리합니다. 지원되는 접근성 동작만 사용합니다.' }),
    (0, $.jsx)('button', { type: 'button', className: 'self-start rounded-md border px-3 py-2 text-sm', onClick: () => azraelWindowBridge.dispatchMessage('azrael-window-control', {}), children: '선택 창 모드 열기' }),
  ] });
}
function once(text, from, to) {
  if (text.split(from).length !== 2) throw new Error('Pinned selected-window anchor changed: ' + from.slice(0, 60));
  return text.replace(from, to);
}
function injectWindowControl(text, relativePath, ts) {
  if (relativePath === SETTINGS_ASSET) {
    if (text.includes(PAGE_MARKER)) {
      if (text.split(PAGE_MARKER).length !== 2 || !text.includes(PAGE_PATCH) || !text.includes(AzraelWindowControlLauncher.toString())) throw new Error('Invalid selected-window launcher marker');
      return { text, count: 0 };
    }
    return { text: 'import{N0t as azraelWindowBridge}from"./app-initial-4bd9e54bcd58.js";' + once(text, PAGE_ANCHOR, PAGE_PATCH) + '\n' + PAGE_MARKER + '\n' + AzraelWindowControlLauncher.toString(), count: 1 };
  }
  if (relativePath !== 'out/extension.js') return { text, count: 0 };
  if (text.includes(HOST_MARKER)) {
    const hooks = [['require("./window-control-host.cjs").attach(this,', 1], ['require("./window-control-host.cjs").observe(this,', 1], ['require("./window-control-host.cjs").disconnect(this);', 2]];
    if (text.split(HOST_MARKER).length !== 2 || !text.includes(HOST_PATCH) || hooks.some(([hook, count]) => text.split(hook).length !== count + 1)) throw new Error('Invalid selected-window bridge marker');
    return { text, count: 0 };
  }
  const source = ts.createSourceFile(relativePath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const edits = [], counts = { send: 0, observe: 0, disconnect: 0 };
  function visit(node) {
    if (ts.isMethodDeclaration(node) && node.name?.text === 'sendProviderRequest') {
      if (!node.body || node.parameters.length !== 6) throw new Error('Pinned selected-window bridge request signature changed');
      edits.push({ start: node.body.getStart(source) + 1, code: 'try{require("./window-control-host.cjs").attach(this,(...azraelWindowArgs)=>this.sendProviderRequest(...azraelWindowArgs));}catch(azraelWindowError){console.error("Azrael selected-window bridge unavailable");}' });
      counts.send++;
      for (const sibling of node.parent.members) {
        if (sibling.name?.text === 'routeIncomingMessage' && sibling.body && sibling.parameters.length === 2 && ts.isIdentifier(sibling.parameters[0].name)) {
          edits.push({ start: sibling.body.getStart(source) + 1, code: `try{require("./window-control-host.cjs").observe(this,${sibling.parameters[0].name.text});}catch(azraelWindowError){try{require("./window-control-host.cjs").disconnect(this);}catch{}console.error("Azrael selected-window observer failed closed");}` }); counts.observe++;
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
  for (const edit of edits.sort((a, b) => b.start - a.start)) text = text.slice(0, edit.start) + edit.code + text.slice(edit.start);
  text = once(text, HOST_ANCHOR, HOST_PATCH);
  if (ts.createSourceFile(relativePath, text, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS).parseDiagnostics.length) throw new Error('Invalid selected-window bridge transform');
  return { text, count: 4 };
}
module.exports = { injectWindowControl, SETTINGS_ASSET, HOST_MARKER, PAGE_MARKER, HOST_ANCHOR, HOST_PATCH, PAGE_ANCHOR, PAGE_PATCH, AzraelWindowControlLauncher };
