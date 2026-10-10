'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { pathToFileURL } = require('node:url');
const { EventEmitter } = require('node:events');
const { transformTransport, TRANSPORT, TRANSPORT_POLICY_MODULES, generateSettingsModule } = require('./inject-sky-control-policy.cjs');
const { createSettingsOwner } = require('./use-control-settings.cjs');
// Pristine Sky 0.7.4 input recorded in artifacts/logs/cua-window-candidate/intermediate-receipt.json.
const pinned = path.join(process.env.LOCALAPPDATA, 'OpenAI/Codex/runtimes/cua_node/b63ee7ee40c23b77/bin');
test('cached managed service and pinned native queue/writer reread policy and fail closed', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'azrael-sky-gate-'));
  const oldHome = process.env.CODEX_HOME, oldRepl = globalThis.nodeRepl;
  t.after(() => { if (oldHome === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = oldHome; globalThis.nodeRepl = oldRepl; if (path.dirname(path.resolve(root)) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('azrael-sky-gate-')) throw new Error('Unsafe fixture cleanup path'); fs.rmSync(root, { recursive: true }); });
  process.env.CODEX_HOME = path.join(root, 'home');
  const settings = createSettingsOwner(process.env.CODEX_HOME);
  const toggle = computerUseEnabled => settings.updateSettings({ computerUseEnabled }, settings.getSettings().revision);
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
    else fs.copyFileSync(path.join(__dirname, path.posix.basename(rel)), path.join(root, rel));
  }
  const source = fs.readFileSync(path.join(pinned, TRANSPORT));
  const transformed = transformTransport(source, '0.7.4');
  assert.deepEqual(transformTransport(transformed.content, '0.7.4'), transformed);
  assert.throws(() => transformTransport(Buffer.concat([source, Buffer.from('tamper')]), '0.7.4'), /Unsupported/);
  assert.throws(() => transformTransport(source, '0.7.5'), /Unsupported/);
  fs.writeFileSync(path.join(root, TRANSPORT), transformed.content);
  // Service fixture keeps a cached client to test the public wrapper without native setup.
  fs.writeFileSync(path.join(packageRoot, 'service.mjs'), 'const client={target:"windows",calls:0};export async function handleRpc(request){return {...request,clientCalls:++client.calls}}');
  fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({ type: 'module', exports: { './service': './service.mjs' } }));
  const service = await import(pathToFileURL(path.join(root, 'sky-controlled-service.mjs')));
  assert.equal((await service.handleRpc({ type: 'setup' })).clientCalls, 1);
  toggle(false);
  await assert.rejects(service.handleRpc({ type: 'execute' }), /disabled/);
  toggle(true);
  assert.equal((await service.handleRpc({ type: 'execute' })).clientCalls, 2);
  const frames = [], socket = new EventEmitter();
  function receive(frame) {
    const body = Buffer.from(JSON.stringify(frame)), bytes = Buffer.alloc(body.length + 4);
    bytes.writeUInt32LE(body.length); body.copy(bytes, 4); socket.emit('data', bytes);
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
  globalThis.nodeRepl = { config: {}, env: { SKY_CUA_NATIVE_PIPE: '1', SKY_CUA_NATIVE_PIPE_DIRECTORY: 'mock' }, nativePipe: { createConnection: () => new Promise(resolve => { connect = resolve; }) } };
  const { WindowsComputerUseClient } = await import(pathToFileURL(path.join(root, TRANSPORT)));
  const client = new WindowsComputerUseClient({ timeoutMs: 500 });
  const queued = client.activate_window({ window: { app: 'fixture', id: 1 } });
  const rejected = assert.rejects(queued, /policy changed/);
  await new Promise(resolve => setImmediate(resolve));
  toggle(false); toggle(true); connect(socket);
  await rejected; assert.equal(frames.length, 0);
  await client.activate_window({ window: { app: 'fixture', id: 1 } });
  assert.equal(frames.length, 1);
  await client.closeTransport();
  let finishApproval;
  globalThis.nodeRepl.createElicitation = () => new Promise(resolve => { finishApproval = resolve; });
  // A new transport captures the elicitation callback while retaining the same mocked socket.
  globalThis.nodeRepl.nativePipe.createConnection = async () => socket;
  const approvalClient = new WindowsComputerUseClient({ timeoutMs: 500 });
  approvalMode = true;
  const approved = approvalClient.activate_window({ window: { app: 'fixture', id: 1 } });
  const approvalRejected = assert.rejects(approved, /policy changed/);
  await new Promise(resolve => setImmediate(resolve));
  toggle(false); toggle(true); finishApproval({ action: 'accept' });
  await approvalRejected;
  assert.equal(frames.at(-1).id, 'approval');
  assert.equal(frames.at(-1).error.code, -32000);
  assert.equal(Object.hasOwn(frames.at(-1), 'result'), false);
  const beforeBlocked = frames.length;
  const stringify = JSON.stringify;
  try {
    JSON.stringify = (...args) => {
      const result = stringify(...args);
      if (args[0]?.method === 'request') { JSON.stringify = stringify; toggle(false); }
      return result;
    };
    await assert.rejects(approvalClient.activate_window({ window: { app: 'fixture', id: 1 } }), /disabled/);
  } finally { JSON.stringify = stringify; }
  assert.equal(frames.length, beforeBlocked, 'policy change during frame serialization blocks the final native write');
  await assert.rejects(approvalClient.activate_window({ window: { app: 'fixture', id: 1 } }), /disabled/);
  assert.equal(frames.length, beforeBlocked);
  const file = path.join(process.env.CODEX_HOME, 'azrael/computer-use/use-settings.json');
  fs.writeFileSync(file, '{broken');
  await assert.rejects(service.handleRpc({ type: 'setup' }), /JSON/);
  await assert.rejects(client.activate_window({ window: { app: 'fixture', id: 1 } }), /JSON/);
  delete process.env.CODEX_HOME;
  await assert.rejects(service.handleRpc({ type: 'setup' }), /explicit CODEX_HOME/);
  await approvalClient.closeTransport();
});
