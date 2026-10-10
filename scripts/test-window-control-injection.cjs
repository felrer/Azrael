'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('../extensions/azrael-ex/node_modules/typescript');
const { createRequire } = require('node:module'), os = require('node:os');
const { injectWindowControl, SETTINGS_ASSET, HOST_MARKER, PAGE_MARKER, PAGE_ANCHOR, PAGE_PATCH, AzraelWindowControlLauncher } = require('./inject-window-control.cjs');
const { injectAccountSettings } = require('./inject-account-settings.cjs');
const { injectComputerUseManagement } = require('./inject-computer-use.cjs');
const { injectRecovery } = require('./inject-recovery.cjs');
function configuredRequire(load) { return name => name === './azrael-runtime.cjs' ? { runtime: { windowControl: {} } } : load(name); }

test('core provider request, notification, response and teardown bypass an absent Window Use host', async () => {
  const fixture = 'class Bridge{sendProviderRequest(a,w,c,d,e,f){this.sent=[a,w,c,d,e,f];return d}routeIncomingMessage(a,w){this.deliveries.push([a,w]);return a}teardownProcess(){this.closed=true;return 7}}async function route(r,e){switch(r.type){case"open-vscode-command":{break}}}';
  const prepared = fs.mkdtempSync(path.join(os.tmpdir(), 'azrael-prepared-settings-resolution-'));
  try {
    const preparation = ts.createSourceFile('prepare-platform-host.cjs', fs.readFileSync(path.join(__dirname, 'prepare-platform-host.cjs'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const inventories = new Map();
    function inventory(node) {
      if (ts.isVariableDeclaration(node) && ['modules', 'accountModules'].includes(node.name?.text)) {
        assert.equal(inventories.has(node.name.text), false);
        assert(ts.isArrayLiteralExpression(node.initializer));
        assert(node.initializer.elements.every(element => ts.isStringLiteral(element)));
        inventories.set(node.name.text, node.initializer.elements.map(element => element.text));
      }
      ts.forEachChild(node, inventory);
    }
    inventory(preparation);
    assert.equal(inventories.size, 2);
    for (const [owner, destination] of [['modules', 'out'], ['accountModules', 'account-ui']]) {
      fs.mkdirSync(path.join(prepared, destination));
      for (const filename of inventories.get(owner)) fs.copyFileSync(path.join(__dirname, filename), path.join(prepared, destination, filename));
    }
    const preparedRequire = createRequire(path.join(prepared, 'out', 'extension.js'));
    assert.equal(fs.existsSync(path.join(prepared, 'out', 'use-settings-host.cjs')), false);
    assert.equal(preparedRequire.resolve('../account-ui/use-settings-host.cjs'), path.join(prepared, 'account-ui', 'use-settings-host.cjs'));
  for (const windowControl of [undefined, null]) {
    const loads = [], notices = [], messages = [], context = vm.createContext({
      require(name) {
        loads.push(name);
        if (name === './azrael-runtime.cjs') return { runtime: { windowControl } };
        if (name === '../account-ui/use-settings-host.cjs') return preparedRequire(name);
        throw new Error('Unavailable backend must never be loaded: ' + name);
      },
      je: { commands: { executeCommand() { assert.fail('Desktop command must not run'); } }, window: { async showErrorMessage(value) { notices.push(value); } } },
    });
    vm.runInContext(injectWindowControl(fixture, 'out/extension.js', ts).text + ';bridge=new Bridge;bridge.deliveries=[];', context);
    const params = { core: true }, response = { id: 'p:1', result: {} }, notification = { method: 'thread/status/changed', params: {} }, delivery = { native: true };
    assert.equal(context.bridge.sendProviderRequest('p', '1', 'thread/start', params, false, true), params);
    assert.deepEqual(Array.from(context.bridge.sent), ['p', '1', 'thread/start', params, false, true]);
    assert.equal(context.bridge.routeIncomingMessage(response, delivery), response);
    assert.equal(context.bridge.routeIncomingMessage(notification, delivery), notification);
    assert.equal(context.bridge.deliveries.length, 2);
    assert.equal(context.bridge.deliveries[0][1], delivery);
    assert.equal(context.bridge.teardownProcess(), 7);
    assert.equal(context.bridge.closed, true);
    await context.route({ type: 'azrael-window-control' });
    assert.match(notices[0], /unavailable/);
    await context.route({ type: 'azrael-use-settings', clientId: 'client', requestId: 'request' }, { postMessage: async value => messages.push(value) });
    assert.equal(messages[0].type, 'azrael-use-settings-state');
    assert.match(messages[0].error, /unavailable/);
    assert.equal(loads.filter(name => name === './window-control-host.cjs').length, 0);
  }
  } finally {
    for (const key of Object.keys(require.cache)) if (key.startsWith(prepared + path.sep)) delete require.cache[key];
    fs.rmSync(prepared, { recursive: true });
  }
});

test('injected guards reject tampering and old injection markers', () => {
  const fixture = 'class Bridge{sendProviderRequest(a,w,c,d,e,f){return c}routeIncomingMessage(a,w){return a}teardownProcess(){}}async function route(r){switch(r.type){case"open-vscode-command":{break}}}';
  const result = injectWindowControl(fixture, 'out/extension.js', ts).text;
  assert.throws(() => injectWindowControl(result.replace('if(require("./azrael-runtime.cjs").runtime.windowControl)', 'if(true)'), 'out/extension.js', ts));
  assert.throws(() => injectWindowControl(result.replace(HOST_MARKER, '/*azrael-window-control-bridge-v1*/'), 'out/extension.js', ts), /verified correction/);
});
test('native window bridge hooks compose with recovery and reject pinned-source drift', () => {
  const original = fs.readFileSync(path.join(process.env.AZRAEL_PRESERVATION_UI_ROOT ?? path.join(__dirname, "../artifacts/upstream-ui/26.1007.21434"), "out/extension.js"), 'utf8');
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
  const context = vm.createContext({ require: configuredRequire(name => { assert.equal(name, './window-control-host.cjs'); return { prepareRequest(method,params){return params;},...Object.fromEntries(['attach', 'request', 'observe', 'disconnect'].map(method => [method, (...args) => { calls.push({ method, args }); }])), beforeResult(...args) { calls.push({ method: 'beforeResult', args }); return false; } }; }), je: { commands: { executeCommand: async command => calls.push({ command }) } } });
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
  const original = fs.readFileSync(path.join(process.env.AZRAEL_PRESERVATION_UI_ROOT ?? path.join(__dirname, "../artifacts/upstream-ui/26.1007.21434"), SETTINGS_ASSET), 'utf8');
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
  assert(result.text.includes('nLt as getAzraelUseReact'));
  assert(result.text.includes('const Q = getAzraelUseReact();'));
  assert(result.text.includes('ZIt as AzraelUseButton,$It as initAzraelUseButton'));
  assert(result.text.includes('createUseSettingsStore'));
  assert.equal(ts.createSourceFile('settings.js', result.text, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS).parseDiagnostics.length, 0);
  for (const [asset, aliases] of [['app-initial-97d3534ad35f.js', ['ZOt']], ['app-initial-c014f9ee4429.js', ['A3t','d3','f3','y3','x3']], ['app-initial-7a199c66e670.js', ['r4','a4','Zjt','$jt']]]) {
    const bundle = fs.readFileSync(path.join(process.env.AZRAEL_PRESERVATION_UI_ROOT ?? path.join(__dirname, "../artifacts/upstream-ui/26.1007.21434"), "webview/assets", asset), 'utf8');
    for (const alias of aliases) assert(bundle.includes(' as ' + alias + ',') || bundle.includes(' as ' + alias + '}'), `Missing native export ${alias}`);
  }
});
test('window boundary observer failure clears the selected owner and preserves ordinary native delivery', () => {
  const fixture = 'class Bridge{sendProviderRequest(a,w,c,d,e,f){return c}routeIncomingMessage(a,w){return a}teardownProcess(){return 7}}async function route(r){switch(r.type){case"open-vscode-command":{break}}}';
  const calls = [];
  const result = injectWindowControl(fixture, 'out/extension.js', ts);
  const context = vm.createContext({ console: { error: value => calls.push(value) }, require: configuredRequire(() => ({ prepareRequest(method,params){return params;},attach() {}, request() {}, beforeResult() { return false; }, observe() { throw new Error('simulated boundary failure'); }, disconnect() { calls.push('disconnected'); } })) });
  vm.runInContext(result.text + ';bridge=new Bridge;', context);
  assert.equal(context.bridge.routeIncomingMessage('ordinary notification', {}), 'ordinary notification');
  assert.equal(calls[0], 'disconnected');
  assert.match(calls[1], /failed closed/);
});
test('result publication defers native dispatch once and retains bridge context', () => {
  const fixture = 'class Bridge{sendProviderRequest(a,w,c,d,e,f){return c}routeIncomingMessage(a,w){this.deliveries.push([a,w]);return a}teardownProcess(){return 7}}async function route(r){switch(r.type){case"open-vscode-command":{break}}}';
  const order = []; let replay, deferred = false;
  const response = { id: 'provider:request', result: { thread: { id: '12345678-1234-1234-1234-123456789abc' } } }, deliveryContext = { source: 'native' };
  const context = vm.createContext({ require: configuredRequire(() => ({ prepareRequest(method,params){return params;},attach() {}, request() {}, beforeResult(native, message, callback) { order.push('beforeResult'); if (!deferred) { deferred = true; replay = callback; return true; } return false; }, observe() { order.push('observe'); }, disconnect() {} })) });
  vm.runInContext(injectWindowControl(fixture, 'out/extension.js', ts).text + ';bridge=new Bridge;bridge.deliveries=[];', context);
  assert.deepEqual({ ...context.bridge.routeIncomingMessage(response, deliveryContext) }, { routeKind: 'response', method: null });
  assert.equal(context.bridge.deliveries.length, 0);
  assert.deepEqual(order, ['beforeResult']);
  replay(response);
  assert.equal(context.bridge.deliveries.length, 1);
  assert.equal(context.bridge.deliveries[0][0], response);
  assert.equal(context.bridge.deliveries[0][1], deliveryContext);
  assert.deepEqual(order, ['beforeResult', 'beforeResult', 'observe']);
});

test('deferred lifecycle responses preserve the pinned dispatcher receipt and line queue', async () => {
  const original = fs.readFileSync(path.join(process.env.AZRAEL_PRESERVATION_UI_ROOT ?? path.join(__dirname, "../artifacts/upstream-ui/26.1007.21434"), "out/extension.js"), 'utf8');
  const source = ts.createSourceFile('host.js', original, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const methods = new Map(); let queueSource;
  const names = new Set(['routeIncomingMessage', 'isMcpResponseMessage', 'isMcpRequestMessage', 'isMcpNotificationMessage', 'dispatchParsedMessage', 'drainLineQueue', 'scheduleLineDrain']);
  function visit(node) {
    if (ts.isMethodDeclaration(node) && names.has(node.name?.text)) {
      assert.equal(methods.has(node.name.text), false, `Pinned method must be unique: ${node.name.text}`);
      methods.set(node.name.text, node.getText(source));
    }
    if (ts.isBinaryExpression(node) && node.right.members?.some(member => member.name?.text === 'enqueueMany') && node.right.members?.some(member => member.name?.text === 'getDepth') && ts.isClassExpression(node.right)) queueSource = node.right.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.equal(methods.size, names.size); assert(queueSource, 'Pinned line queue must exist');
  const routerMethods = ['routeIncomingMessage', 'isMcpResponseMessage', 'isMcpRequestMessage', 'isMcpNotificationMessage'].map(name => methods.get(name)).join('\n');
  const fixture = `class Bridge{sendProviderRequest(a,w,c,d,e,f){return c}teardownProcess(){}${routerMethods}}async function route(r){switch(r.type){case"open-vscode-command":{break}}}`;
  const transformed = injectWindowControl(fixture, 'out/extension.js', ts).text;
  for (const lifecycleMethod of ['thread/start', 'thread/resume']) {
    const events = [], receipts = []; let publish, replayed = false;
    const response = { id: 'provider:request', result: { thread: { id: '12345678-1234-1234-1234-123456789abc' } } };
    const notification = { method: 'thread/status/changed', params: { threadId: response.result.thread.id, status: { type: 'idle' } } };
    const deliveryContext = { receivedAtMs: 42 };
    const context = vm.createContext({ setImmediate, Date,
      yO: () => false, bO: () => null, bf: params => params.threadId,
      require: configuredRequire(() => ({ beforeResult(native, message, callback) {
        if (message === response && !replayed) { events.push(`defer:${lifecycleMethod}`); publish = () => { replayed = true; return callback(message); }; return true; }
        return false;
      }, observe(native, message) { events.push(message === response ? 'observe:response' : 'observe:notification'); }, disconnect() { assert.fail('Observer must not fail'); } }))
    });
    vm.runInContext(`${transformed};bridge=new Bridge;LineQueue=${queueSource};class Dispatcher{${['dispatchParsedMessage', 'drainLineQueue', 'scheduleLineDrain'].map(name => methods.get(name)).join('\n')}};dispatcher=Object.create(Dispatcher.prototype);`, context);
    Object.assign(context.bridge, {
      pendingRequests: new Set([response.id]), pendingTurnStartRequestIds: new Set(), pendingPrewarmedThreadStartRequestIds: new Set(),
      providers: new Map([['provider', { onResult(value) { events.push('deliver:response'); assert.equal(value.id, 'request'); }, onRawNotification(value) { events.push('deliver:notification'); assert.equal(value, notification); } }]]),
      requestUserInputAutoResolutionCoordinator: { observeServerNotification() {} }, internalNotificationHandlers: [], ephemeralThreadTimeouts: new Map()
    });
    const queue = new context.LineQueue({ depthThresholds: [], compactionMinConsumedItems: 16 });
    Object.assign(context.dispatcher, { lineQueue: queue, lineDrainHandle: null,
      options: { onMessage(message, bytes, timing) { assert.equal(timing, deliveryContext); return context.bridge.routeIncomingMessage(message); }, drainMaxLinesPerSlice: 16, drainMaxSliceMs: 1000, slowDrainSliceMs: Infinity, drainRemainingLogThreshold: Infinity, queueDepthThresholds: [] },
      trackIncomingLineBytes() {}, maybeLogIncomingLineProcessing(receipt) { receipts.push(receipt); }
    });
    queue.enqueueMany([{ message: response, lineBytes: 100, timing: deliveryContext }, { message: notification, lineBytes: 80, timing: deliveryContext }]);
    // Execute the native scheduled drain: an undefined receipt throws before the next queued item.
    context.dispatcher.scheduleLineDrain();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(queue.getDepth(), 0);
    assert.deepEqual(events, [`defer:${lifecycleMethod}`, 'observe:notification', 'deliver:notification']);
    assert.deepEqual(receipts.map(receipt => [receipt.routeKind, receipt.method]), [['response', null], ['notification', notification.method]]);
    assert.equal(context.bridge.pendingRequests.has(response.id), true, 'Native response publication remains deferred');
    assert.deepEqual({ ...publish() }, { routeKind: 'response', method: null });
    assert.equal(context.bridge.pendingRequests.has(response.id), false);
    assert.deepEqual(events.slice(-2), ['observe:response', 'deliver:response']);
  }
});
const {injectWindowApprovalClassifier,APPROVAL_CLASSIFIER_ASSET,CLASSIFIER_PATCH}=require('./inject-window-control.cjs');
test('Window Use classifier is exact, guarded and tracked by packaging',()=>{
 const original=fs.readFileSync(path.join(process.env.AZRAEL_PRESERVATION_UI_ROOT ?? path.join(__dirname, "../artifacts/upstream-ui/26.1007.21434"), APPROVAL_CLASSIFIER_ASSET),'utf8');
 const result=injectWindowApprovalClassifier(original,APPROVAL_CLASSIFIER_ASSET);assert.equal(result.count,1);assert.equal(injectWindowApprovalClassifier(result.text,APPROVAL_CLASSIFIER_ASSET).count,0);
 assert.throws(()=>injectWindowApprovalClassifier(result.text.replace(CLASSIFIER_PATCH,'tampered /*azrael-window-native-approval-v1*/'),APPROVAL_CLASSIFIER_ASSET));
 const parsed=require('../extensions/azrael-ex/node_modules/typescript').createSourceFile('classifier.js',result.text,99,true,1),owner=parsed.statements.find(node=>require('../extensions/azrael-ex/node_modules/typescript').isFunctionDeclaration(node)&&node.getText(parsed).includes(CLASSIFIER_PATCH));assert(owner);const context=vm.createContext({});vm.runInContext(owner.getText(parsed),context);
 for(const name of ['Computer Use','computer-use-plugin','Window Use'])assert.equal(context[owner.name.text](name),true);
 for(const name of ['window-use-other','browser-use','other'])assert.equal(context[owner.name.text](name),false);
 const transformer=require('./namespace-azrael-host.cjs'),ts=require('../extensions/azrael-ex/node_modules/typescript');const prepared=transformer.transformAsset(original,APPROVAL_CLASSIFIER_ASSET,APPROVAL_CLASSIFIER_ASSET,ts);assert.equal(prepared.asset.windowApprovalClassifierEdits,1);assert(transformer.getAssetTransformRules(APPROVAL_CLASSIFIER_ASSET)['inject-window-control.cjs']);
});
test('selected runtime request preparation precedes registration and actual native send',()=>{
 const fixture='class Bridge{sendProviderRequest(a,w,c,d,e,f){this.sent=d;return d}routeIncomingMessage(a,w){return a}teardownProcess(){}}async function route(r){switch(r.type){case"open-vscode-command":{break}}}';
 const order=[],prepared={selectedRuntime:true};const context=vm.createContext({require:configuredRequire(()=>({prepareRequest(method,params){order.push('prepare');assert.equal(method,'thread/start');assert.deepEqual(params,{original:true});return prepared},attach(){order.push('attach')},request(native,provider,id,method,params){order.push('register');assert.equal(params,prepared)}}))});
 vm.runInContext(injectWindowControl(fixture,'out/extension.js',ts).text+';bridge=new Bridge',context);assert.equal(context.bridge.sendProviderRequest('provider','id','thread/start',{original:true},false,true),prepared);assert.equal(context.bridge.sent,prepared);assert.deepEqual(order,['prepare','attach','register']);
});
