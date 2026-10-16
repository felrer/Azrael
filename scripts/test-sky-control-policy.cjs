'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { pathToFileURL } = require('node:url');
const { EventEmitter } = require('node:events');
const { AsyncResource } = require('node:async_hooks');
const { transformTransport, TRANSPORT, TRANSPORT_POLICY_MODULES, generateSettingsModule } = require('./inject-sky-control-policy.cjs');
const { createSettingsOwner } = require('./use-control-settings.cjs');
const { createDesktopAuthority } = require('./window-desktop-authority.cjs');
const { createOwner: createAppApprovalOwner } = require('./computer-use-approvals.cjs');
const { TRANSPORT_POLICY_REEXPORT } = require('./computer-use-runtime.cjs');
// Pristine Sky 0.7.4 input recorded in artifacts/logs/cua-window-candidate/intermediate-receipt.json.
const pinned = path.join(process.env.AZRAEL_TEST_COMPUTER_USE_RUNTIME || path.join(process.env.LOCALAPPDATA, 'OpenAI/Codex/runtimes/cua_node/b63ee7ee40c23b77'), 'bin');
test('cached managed service and pinned native queue/writer reread policy and fail closed', async t => {
  const temporary = path.resolve('artifacts/tasks/DU-01-window-use-stages/runs/20261017-desktop-authority-r1/temporary');
  fs.mkdirSync(temporary, { recursive: true });
  const root = fs.mkdtempSync(path.join(temporary, 'sky-gate-'));
  const oldHome = process.env.CODEX_HOME;
  t.after(() => { if (oldHome === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = oldHome; if (path.dirname(path.resolve(root)) !== temporary || !path.basename(root).startsWith('sky-gate-')) throw new Error('Unsafe fixture cleanup path'); fs.rmSync(root, { recursive: true }); });
  process.env.CODEX_HOME = path.join(root, 'home');
  const settings = createSettingsOwner(process.env.CODEX_HOME);
  const desktop = createDesktopAuthority({ directory: path.join(root, 'authority'), codexHome: process.env.CODEX_HOME });
  const appApprovals = createAppApprovalOwner(process.env.CODEX_HOME);
  let turnId = 'turn';
  const identity = () => ({ threadId: 'thread', turnId, policyGeneration: settings.getSettings().windowUseGeneration });
  const grant = () => desktop.grant(identity());
  const runtime = {};
  Object.defineProperty(runtime, 'requestMeta', { get: () => Object.freeze({ 'x-codex-turn-metadata': Object.freeze({ thread_id: 'thread', turn_id: turnId, sandbox_mode: 'danger-full-access', sandbox: 'none' }) }) });
  Object.defineProperty(globalThis, 'nodeRepl', { value: runtime, writable: false, configurable: false });
  const toggle = stage4Enabled => settings.updateSettings({ stage4Enabled }, settings.getSettings().revision);
  for (const name of ['sky-control-policy.mjs', 'sky-controlled-service.mjs', 'use-control-settings.cjs']) fs.copyFileSync(path.join(__dirname, name), path.join(root, name));
  const settingsSource = fs.readFileSync(path.join(__dirname, 'use-control-settings.cjs'));
  const settingsEsm = generateSettingsModule(settingsSource);
  fs.writeFileSync(path.join(root, 'use-control-settings.mjs'), settingsEsm.content);
  assert.throws(() => generateSettingsModule(Buffer.from(settingsSource.toString().replace('function validate(state)', 'function changed(state)'))), /anchor mismatch/);
  const packageRoot = path.join(root, 'node_modules/@oai/sky');
  fs.mkdirSync(packageRoot, { recursive: true });
  fs.copyFileSync(path.join(pinned, 'node_modules/@oai/sky/package.json'), path.join(packageRoot, 'package.json'));
  fs.cpSync(path.join(pinned, 'node_modules/@oai/sky/dist'), path.join(packageRoot, 'dist'), { recursive: true });
  for (const rel of TRANSPORT_POLICY_MODULES) {
    if (rel.endsWith('/use-control-settings.mjs')) fs.writeFileSync(path.join(root, rel), settingsEsm.content);
    else if (rel.endsWith('/sky-control-policy.mjs')) fs.writeFileSync(path.join(root, rel), TRANSPORT_POLICY_REEXPORT);
    else fs.copyFileSync(path.join(__dirname, path.posix.basename(rel)), path.join(root, rel));
  }
  const source = fs.readFileSync(path.join(pinned, TRANSPORT));
  const transformed = transformTransport(source, '0.7.4');
  assert.equal(transformed.transform.version, 4);
  const legacy = transformTransport(source, '0.7.4', 3);
  assert.equal(legacy.transform.version, 3);
  assert.deepEqual(transformTransport(legacy.content, '0.7.4', 3), legacy);
  assert.deepEqual(transformTransport(legacy.content, '0.7.4'), transformed, 'exact legacy v3 input upgrades to the distinct v4 receipt');
  assert.throws(() => transformTransport(Buffer.concat([legacy.content, Buffer.from('tamper')]), '0.7.4'), /Unsupported/);
  assert.throws(() => transformTransport(source, '0.7.4', 5), /Unsupported/);
  assert.deepEqual(transformTransport(transformed.content, '0.7.4'), transformed);
  assert.throws(() => transformTransport(Buffer.concat([source, Buffer.from('tamper')]), '0.7.4'), /Unsupported/);
  assert.throws(() => transformTransport(source, '0.7.5'), /Unsupported/);
  fs.writeFileSync(path.join(root, TRANSPORT), transformed.content);
  // Service fixture keeps a cached client to test the public wrapper without native setup.
  fs.writeFileSync(path.join(packageRoot, 'service.mjs'), 'const client={target:"windows",calls:0};export async function handleRpc(request){return {...request,clientCalls:++client.calls}}');
  fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({ type: 'module', exports: { './service': './service.mjs' } }));
  const service = await import(pathToFileURL(path.join(root, 'sky-controlled-service.mjs')));
  const policy = await import(pathToFileURL(path.join(root, 'sky-control-policy.mjs')));
  const net = require('node:net');
  const pipe = process.platform === 'win32' ? '\\\\.\\pipe\\azrael-window-sky-authority-' + process.pid : path.join(fs.mkdtempSync('/tmp/azw-'), 'w.sock');
  const server = net.createServer(socket => socket.once('data', bytes => {
    const request = JSON.parse(bytes.toString()); assert.equal(request.method, 'desktop_authority');
    try { socket.end(JSON.stringify({ result: desktop.authorize(identity()) }) + '\n'); }
    catch (error) { socket.end(JSON.stringify({ error: { message: error.message } }) + '\n'); }
  }));
  await new Promise(resolve => server.listen(pipe, resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); if (process.platform !== 'win32') fs.rmdirSync(path.dirname(pipe)); });
  const sessions = path.join(process.env.CODEX_HOME, 'azrael/computer-use/window-sessions'); fs.mkdirSync(sessions, { recursive: true });
  fs.writeFileSync(path.join(sessions, 'thread.json'), JSON.stringify({ schema: 1, pipe, nonce: 'a'.repeat(64) }));
  await assert.rejects(service.handleRpc({ type: 'setup' }), /not granted/);
  grant();
  assert.equal((await service.handleRpc({ type: 'setup' })).clientCalls, 1);
  toggle(false);
  await assert.rejects(service.handleRpc({ type: 'execute' }), /disabled/);
  toggle(true);
  grant();
  assert.equal((await service.handleRpc({ type: 'execute' })).clientCalls, 2);
  const frames = [], socket = new EventEmitter(); let connectionContext;
  function receive(frame) {
    const body = Buffer.from(JSON.stringify(frame)), bytes = Buffer.alloc(body.length + 4);
    bytes.writeUInt32LE(body.length); body.copy(bytes, 4);
    if (connectionContext) connectionContext.runInAsyncScope(() => socket.emit('data', bytes));
    else socket.emit('data', bytes);
  }
  let approvalMode = false, pendingRequest;
  socket.end = () => {};
  socket.write = bytes => {
    const frame = JSON.parse(bytes.subarray(4).toString()); frames.push(frame);
    if (frame.method === 'request') queueMicrotask(() => {
      if (approvalMode) { pendingRequest = frame.id; receive({ id: 'approval', method: 'requestComputerUseApproval', params: {} }); }
      else receive({ id: frame.id, jsonrpc: '2.0', result: {} });
    });
    else if (frame.id === 'approval') queueMicrotask(() => receive({ id: pendingRequest, jsonrpc: '2.0', error: frame.error }));
  };
  let connect;
  Object.assign(runtime, { config: {}, env: { SKY_CUA_NATIVE_PIPE: '1', SKY_CUA_NATIVE_PIPE_DIRECTORY: 'mock' }, nativePipe: { createConnection: () => new Promise(resolve => { connect = resolve; }) } });
  const { WindowsComputerUseClient } = await import(pathToFileURL(path.join(root, TRANSPORT)));
  const client = new WindowsComputerUseClient({ timeoutMs: 500 });
  const call = target => policy.withDesktopAuthority(desktop.authorize(identity()), () => target.activate_window({ window: { app: 'fixture', id: 1 } }));
  await assert.rejects(client.activate_window({ window: { app: 'fixture', id: 1 } }), /not granted/);
  const queued = call(client);
  const rejected = assert.rejects(queued, /policy changed/);
  await new Promise(resolve => setImmediate(resolve));
  toggle(false); toggle(true); connect(socket);
  await rejected; assert.equal(frames.length, 0);
  grant();
  await call(client);
  assert.equal(frames.length, 1);
  await client.closeTransport();
  let finishApproval;
  globalThis.nodeRepl.createElicitation = () => new Promise(resolve => { finishApproval = resolve; });
  // A new transport captures the elicitation callback while retaining the same mocked socket.
  globalThis.nodeRepl.nativePipe.createConnection = async () => socket;
  const approvalClient = new WindowsComputerUseClient({ timeoutMs: 500 });
  approvalMode = true;
  const approved = call(approvalClient);
  const approvalRejected = assert.rejects(approved, /policy changed/);
  await new Promise(resolve => setImmediate(resolve));
  toggle(false); toggle(true); finishApproval({ action: 'accept' });
  await approvalRejected;
  assert.equal(frames.at(-1).id, 'approval');
  assert.equal(frames.at(-1).error.code, -32000);
  assert.equal(Object.hasOwn(frames.at(-1), 'result'), false);
  grant();
  approvalMode = false;
  const stringify = JSON.stringify;
  const beforeAdded = frames.length;
  try {
    JSON.stringify = (...args) => {
      const result = stringify(...args);
      if (args[0]?.method === 'request') { JSON.stringify = stringify; appApprovals.addAppApproval('fixture.exe', 'Fixture'); }
      return result;
    };
    await call(approvalClient);
  } finally { JSON.stringify = stringify; }
  assert.equal(frames.length, beforeAdded + 1, 'adding an approval during serialization preserves the current lease');
  const beforeRemoved = frames.length;
  try {
    JSON.stringify = (...args) => {
      const result = stringify(...args);
      if (args[0]?.method === 'request') { JSON.stringify = stringify; appApprovals.removeAppApproval('fixture.exe'); }
      return result;
    };
    await assert.rejects(call(approvalClient), /revoked/);
  } finally { JSON.stringify = stringify; }
  assert.equal(frames.length, beforeRemoved, 'persistent app removal during serialization blocks the final native write');
  grant();
  const beforeBlocked = frames.length;
  try {
    JSON.stringify = (...args) => {
      const result = stringify(...args);
      if (args[0]?.method === 'request') { JSON.stringify = stringify; desktop.revoke('thread'); }
      return result;
    };
    await assert.rejects(call(approvalClient), /ENOENT|revoked|not granted/);
  } finally { JSON.stringify = stringify; }
  assert.equal(frames.length, beforeBlocked, 'task revocation during frame serialization blocks the final native write');
  toggle(false);
  await assert.rejects(approvalClient.activate_window({ window: { app: 'fixture', id: 1 } }), /disabled/);
  assert.equal(frames.length, beforeBlocked);
  await approvalClient.closeTransport();
  toggle(true); grant();
  let finishWarmApproval, holdWarmApproval = false;
  runtime.createElicitation = async () => {
    if (holdWarmApproval) return new Promise(resolve => { finishWarmApproval = resolve; });
    await new Promise(resolve => setImmediate(resolve)); return { action: 'accept' };
  };
  runtime.nativePipe.createConnection = async () => { connectionContext = new AsyncResource('fixture-native-connection'); return socket; };
  const warmClient = new WindowsComputerUseClient({ timeoutMs: 500 });
  approvalMode = false;
  await call(warmClient);
  turnId = 'turn-two'; desktop.revoke('thread'); grant();
  approvalMode = true;
  await call(warmClient);
  assert.equal(frames.at(-1).id, 'approval');
  assert.equal(frames.at(-1).result.action, 'accept', 'new-turn approval reply uses its request authority despite first-turn connection context');
  turnId = 'turn-three'; desktop.revoke('thread'); grant(); holdWarmApproval = true;
  const revokedWarm = call(warmClient), revokedWarmCheck = assert.rejects(revokedWarm, /revoked/);
  while (!finishWarmApproval) await new Promise(resolve => setImmediate(resolve));
  appApprovals.removeAppApproval('fixture.exe'); finishWarmApproval({ action: 'accept' });
  await revokedWarmCheck;
  assert.equal(frames.at(-1).id, 'approval');
  assert.equal(Object.hasOwn(frames.at(-1), 'result'), false, 'restored context cannot refresh a revoked request authority');
  await warmClient.closeTransport(); connectionContext.emitDestroy(); connectionContext = undefined;
  grant(); runtime.createElicitation = undefined;
  const missingApprovalClient = new WindowsComputerUseClient({ timeoutMs: 500 });
  await assert.rejects(call(missingApprovalClient), /approval request authority is unavailable/);
  await missingApprovalClient.closeTransport(); connectionContext.emitDestroy(); connectionContext = undefined;
  const file = path.join(process.env.CODEX_HOME, 'azrael/computer-use/use-settings.json');
  fs.writeFileSync(file, '{broken');
  await assert.rejects(service.handleRpc({ type: 'setup' }), /JSON/);
  await assert.rejects(client.activate_window({ window: { app: 'fixture', id: 1 } }), /JSON/);
  delete process.env.CODEX_HOME;
  await assert.rejects(service.handleRpc({ type: 'setup' }), /explicit CODEX_HOME/);
  await approvalClient.closeTransport();
});
