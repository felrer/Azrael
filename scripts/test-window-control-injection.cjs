'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('../extensions/azrael-ex/node_modules/typescript');
const { injectWindowControl, SETTINGS_ASSET, HOST_MARKER, PAGE_MARKER, PAGE_ANCHOR, PAGE_PATCH, AzraelWindowControlLauncher } = require('./inject-window-control.cjs');
const { injectAccountSettings } = require('./inject-account-settings.cjs');
const { injectComputerUseManagement } = require('./inject-computer-use.cjs');
const { injectRecovery } = require('./inject-recovery.cjs');
test('native window bridge hooks compose with recovery and reject pinned-source drift', () => {
  const original = fs.readFileSync(path.join(__dirname, '../artifacts/upstream-ui/26.930.61225/out/extension.js'), 'utf8');
  const account = injectAccountSettings(original, 'out/extension.js');
  const recovery = injectRecovery(account.text, 'out/extension.js', ts);
  const result = injectWindowControl(recovery.text, 'out/extension.js', ts);
  assert.equal(result.count, 4);
  assert.equal(injectWindowControl(result.text, 'out/extension.js', ts).count, 0);
  assert.equal(ts.createSourceFile('host.js', result.text, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS).parseDiagnostics.length, 0);
  assert.throws(() => injectWindowControl(result.text.replace('require("./window-control-host.cjs").observe(this,', 'tampered('), 'out/extension.js', ts));
  assert.throws(() => injectWindowControl(original + HOST_MARKER, 'out/extension.js', ts));
  assert.throws(() => injectWindowControl(original.replaceAll('sendProviderRequest(', 'changedProviderRequest('), 'out/extension.js', ts));
});
test('injected bridge calls preserve native request and lifecycle behavior', async () => {
  const fixture = 'class Bridge{sendProviderRequest(a,w,c,d,e,f){return c}routeIncomingMessage(a,w){return a}teardownProcess(){return 7}}async function route(r){switch(r.type){case"open-vscode-command":{break}}}';
  const calls = [], result = injectWindowControl(fixture, 'out/extension.js', ts);
  const context = vm.createContext({ require: name => { assert.equal(name, './window-control-host.cjs'); return { prepareRequest(method,params){return params;},...Object.fromEntries(['attach', 'request', 'observe', 'disconnect'].map(method => [method, (...args) => { calls.push({ method, args }); }])), beforeResult(...args) { calls.push({ method: 'beforeResult', args }); return false; } }; }, Ge: { commands: { executeCommand: async command => calls.push({ command }) } } });
  vm.runInContext(result.text + ';bridge=new Bridge;', context);
  assert.equal(context.bridge.sendProviderRequest('p', 'id', 'thread/start', {}, false, true), 'thread/start');
  assert.equal(calls[0].method, 'attach');
  assert.equal(calls[0].args[1]('p', 'id', 'turn/start', {}, false, true), 'turn/start');
  assert.equal(context.bridge.routeIncomingMessage('message', 'context'), 'message');
  assert.equal(context.bridge.teardownProcess(), 7);
  await context.route({ type: 'azrael-window-control' });
  assert.equal(calls.at(-1).command, 'azrael.windowControl');
});
test('Computer Use settings launcher is scoped, idempotent and dispatches the owned UI command', () => {
  const original = fs.readFileSync(path.join(__dirname, '../artifacts/upstream-ui/26.930.61225', SETTINGS_ASSET), 'utf8');
  const management = injectComputerUseManagement(original, SETTINGS_ASSET);
  assert.equal(management.count, 1);
  assert(management.text.includes(PAGE_ANCHOR));
  const result = injectWindowControl(management.text, SETTINGS_ASSET, ts);
  assert.equal(result.count, 1);
  assert.deepEqual(injectWindowControl(result.text, SETTINGS_ASSET, ts), { text: result.text, count: 0 });
  assert.equal(result.text.split(PAGE_PATCH).length - 1, 1, 'launcher mounts once within the native settings-page children');
  assert.equal(result.text.includes(PAGE_ANCHOR), false);
  assert(result.text.replace(PAGE_PATCH, PAGE_ANCHOR).includes(management.text), 'native page content is preserved around the launcher mount');
  assert.throws(() => injectWindowControl(result.text.replace(AzraelWindowControlLauncher.toString(), 'tampered'), SETTINGS_ASSET, ts));
  assert.throws(() => injectWindowControl(result.text.replace(PAGE_PATCH, PAGE_ANCHOR), SETTINGS_ASSET, ts));
  assert.throws(() => injectWindowControl(management.text + PAGE_MARKER, SETTINGS_ASSET, ts));
  for (const source of [management.text.replace(PAGE_ANCHOR, 'changed-page'), management.text + PAGE_ANCHOR]) {
    assert.throws(() => injectWindowControl(source, SETTINGS_ASSET, ts), /Pinned selected-window anchor changed/);
  }
  assert.equal(injectWindowControl(original, 'unrelated.js', ts).count, 0);
  assert(result.text.includes('ZOt as getAzraelUseReact'));
  assert(result.text.includes('const Q = getAzraelUseReact();'));
  assert(result.text.includes('Zjt as AzraelUseButton,$jt as initAzraelUseButton'));
  assert(result.text.includes('createUseSettingsStore'));
  assert.equal(ts.createSourceFile('settings.js', result.text, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS).parseDiagnostics.length, 0);
  for (const [asset, aliases] of [['app-initial-efe028fd535e.js', ['ZOt']], ['app-initial-5120fa5fe295.js', ['A3t','d3','f3','y3','x3']], ['app-initial-532d60c9b397.js', ['r4','a4','Zjt','$jt']]]) {
    const bundle = fs.readFileSync(path.join(__dirname, '../artifacts/upstream-ui/26.930.61225/webview/assets', asset), 'utf8');
    for (const alias of aliases) assert(bundle.includes(' as ' + alias + ',') || bundle.includes(' as ' + alias + '}'), `Missing native export ${alias}`);
  }
});
test('window boundary observer failure clears the selected owner and preserves ordinary native delivery', () => {
  const fixture = 'class Bridge{sendProviderRequest(a,w,c,d,e,f){return c}routeIncomingMessage(a,w){return a}teardownProcess(){return 7}}async function route(r){switch(r.type){case"open-vscode-command":{break}}}';
  const calls = [];
  const result = injectWindowControl(fixture, 'out/extension.js', ts);
  const context = vm.createContext({ console: { error: value => calls.push(value) }, require: () => ({ prepareRequest(method,params){return params;},attach() {}, request() {}, beforeResult() { return false; }, observe() { throw new Error('simulated boundary failure'); }, disconnect() { calls.push('disconnected'); } }) });
  vm.runInContext(result.text + ';bridge=new Bridge;', context);
  assert.equal(context.bridge.routeIncomingMessage('ordinary notification', {}), 'ordinary notification');
  assert.equal(calls[0], 'disconnected');
  assert.match(calls[1], /failed closed/);
});
test('result publication defers native dispatch once and retains bridge context', () => {
  const fixture = 'class Bridge{sendProviderRequest(a,w,c,d,e,f){return c}routeIncomingMessage(a,w){this.deliveries.push([a,w]);return a}teardownProcess(){return 7}}async function route(r){switch(r.type){case"open-vscode-command":{break}}}';
  const order = []; let replay, deferred = false;
  const response = { id: 'provider:request', result: { thread: { id: '12345678-1234-1234-1234-123456789abc' } } }, deliveryContext = { source: 'native' };
  const context = vm.createContext({ require: () => ({ prepareRequest(method,params){return params;},attach() {}, request() {}, beforeResult(native, message, callback) { order.push('beforeResult'); if (!deferred) { deferred = true; replay = callback; return true; } return false; }, observe() { order.push('observe'); }, disconnect() {} }) });
  vm.runInContext(injectWindowControl(fixture, 'out/extension.js', ts).text + ';bridge=new Bridge;bridge.deliveries=[];', context);
  assert.equal(context.bridge.routeIncomingMessage(response, deliveryContext), undefined);
  assert.equal(context.bridge.deliveries.length, 0);
  assert.deepEqual(order, ['beforeResult']);
  replay(response);
  assert.equal(context.bridge.deliveries.length, 1);
  assert.equal(context.bridge.deliveries[0][0], response);
  assert.equal(context.bridge.deliveries[0][1], deliveryContext);
  assert.deepEqual(order, ['beforeResult', 'beforeResult', 'observe']);
});
const {injectWindowApprovalClassifier,APPROVAL_CLASSIFIER_ASSET,CLASSIFIER_PATCH}=require('./inject-window-control.cjs');
test('Window Use classifier is exact, guarded and tracked by packaging',()=>{
 const original=fs.readFileSync(path.join(__dirname,'../artifacts/upstream-ui/26.930.61225',APPROVAL_CLASSIFIER_ASSET),'utf8');
 const result=injectWindowApprovalClassifier(original,APPROVAL_CLASSIFIER_ASSET);assert.equal(result.count,1);assert.equal(injectWindowApprovalClassifier(result.text,APPROVAL_CLASSIFIER_ASSET).count,0);
 assert.throws(()=>injectWindowApprovalClassifier(result.text.replace(CLASSIFIER_PATCH,'tampered /*azrael-window-native-approval-v1*/'),APPROVAL_CLASSIFIER_ASSET));
 const start=result.text.indexOf('function Z_t('),end=result.text.indexOf('function Q_t(',start);const context=vm.createContext({});vm.runInContext(result.text.slice(start,end),context);
 for(const name of ['Computer Use','computer-use-plugin','Window Use'])assert.equal(context.Z_t(name),true);
 for(const name of ['window-use-other','browser-use','other'])assert.equal(context.Z_t(name),false);
 const transformer=require('./namespace-azrael-host.cjs'),ts=require('../extensions/azrael-ex/node_modules/typescript');const prepared=transformer.transformAsset(original,APPROVAL_CLASSIFIER_ASSET,APPROVAL_CLASSIFIER_ASSET,ts);assert.equal(prepared.asset.windowApprovalClassifierEdits,1);assert(transformer.getAssetTransformRules(APPROVAL_CLASSIFIER_ASSET)['inject-window-control.cjs']);
});
test('selected runtime request preparation precedes registration and actual native send',()=>{
 const fixture='class Bridge{sendProviderRequest(a,w,c,d,e,f){this.sent=d;return d}routeIncomingMessage(a,w){return a}teardownProcess(){}}async function route(r){switch(r.type){case"open-vscode-command":{break}}}';
 const order=[],prepared={selectedRuntime:true};const context=vm.createContext({require:()=>({prepareRequest(method,params){order.push('prepare');assert.equal(method,'thread/start');assert.deepEqual(params,{original:true});return prepared},attach(){order.push('attach')},request(native,provider,id,method,params){order.push('register');assert.equal(params,prepared)}})});
 vm.runInContext(injectWindowControl(fixture,'out/extension.js',ts).text+';bridge=new Bridge',context);assert.equal(context.bridge.sendProviderRequest('provider','id','thread/start',{original:true},false,true),prepared);assert.equal(context.bridge.sent,prepared);assert.deepEqual(order,['prepare','attach','register']);
});
