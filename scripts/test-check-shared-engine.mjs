import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve, parse } from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, mkdir } from 'node:fs/promises';
import { waitForExit } from './lib/azrael-rpc-check.mjs';
import { checkSocketPath, queryEngineEndpoint, supportsPluginStartupTestHook, SHARED_CHECK_STARTUP_ARGS, sharedCheckStartupArgs, CODE_MODE_SMOKE_SOURCE, validateCodeModeSmokeOutput, startSharedProvider, resolveBridgePath, resolveCodeHostPath, codeModeChildSource, validateOwnedDaemonReceipt, windowAccountStateFile, resumePendingTurn, generatedGitAttributeRepair, validateAccountStateProgress, runCheck, diagnosticRootPids, captureOwnedProcessTree } from './check-shared-engine.mjs';

test('Windows PowerShell process-tree probe handles a JSON PID array and records owned process identity', { skip: process.platform !== 'win32' }, async () => {
  const child = spawn(process.execPath, ['-e', 'process.stdin.resume();process.stdin.on("end",()=>process.exit(0));setTimeout(()=>process.exit(0),20000);'],
    { windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] });
  await new Promise((done, reject) => { child.once('spawn', done); child.once('error', reject); });
  const output = resolve(process.env.AZRAEL_SHARED_ENGINE_SOURCE_OUTPUT ??
    resolve(import.meta.dirname, '..', 'artifacts', 'logs', 'BJ-01-shared-engine'));
  try {
    await mkdir(output, { recursive: true });
    const summary = await captureOwnedProcessTree(output, 'source-guard', [child.pid, 0xffffffff]);
    assert(summary.processCount >= 1);
    const snapshot = JSON.parse(await readFile(resolve(output, 'process-tree-source-guard.json'), 'utf8'));
    assert.deepEqual(snapshot.rootPids, [child.pid, 0xffffffff]);
    const observedPids = new Set(snapshot.processes.map(process => process.pid));
    assert(snapshot.processes.every(process => process.pid === child.pid || observedPids.has(process.parentPid)));
    const observed = snapshot.processes.find(process => process.pid === child.pid);
    assert(observed);
    assert.equal(observed.parentPid, process.pid);
    assert.equal(resolve(observed.path).toLowerCase(), resolve(process.execPath).toLowerCase());
    assert(Number.isFinite(Date.parse(observed.startUtc)));
  } finally {
    child.stdin.end();
    await waitForExit(child, 'process-tree source guard child', 5000);
  }
});

test('process tree diagnostics accept only bounded unique explicit native PIDs', () => {
  assert.deepEqual(diagnosticRootPids([100, 101, 100, undefined, 102]), [100, 101, 102]);
  assert.throws(() => diagnosticRootPids([]), /bounded_diagnostic/);
  assert.throws(() => diagnosticRootPids([0]), /native_pids/);
  assert.throws(() => diagnosticRootPids(['100 OR ProcessId>0']), /native_pids/);
  assert.throws(() => diagnosticRootPids(Array.from({ length: 17 }, (_, index) => index + 1)), /bounded_diagnostic/);
});

test('account continuity mode rejects missing extended flag before executable or state access', { skip: process.platform !== 'win32' }, async () => {
  await assert.rejects(runCheck(resolve('unused-engine.exe'), resolve('artifacts', 'verification', 'unused-account-flag-test'),
    { accountRejoinState: true }), /account_rejoin_state_requires_extended/);
  await assert.rejects(runCheck(resolve('unused-engine.exe'), resolve('artifacts', 'verification', 'unused-code-mode-test'),
    { codeModeCompatibilityOnly: true }), /code_mode_compatibility_requires_extended_and_host/);
});

test('account rejoin requires one engine UUID and increasing revisions across distinct contexts', () => {
  const instanceId = '10000000-0000-4000-8000-000000000001';
  const initial = { instanceId, revision: 1 }, before = { instanceId, revision: 7 }, after = { instanceId, revision: 8 };
  validateAccountStateProgress(initial, before);
  validateAccountStateProgress(before, after);
  assert.throws(() => validateAccountStateProgress(before, { instanceId, revision: 7 }), /revision_must_increase/);
  assert.throws(() => validateAccountStateProgress(before, { instanceId, revision: 6 }), /revision_must_increase/);
  assert.throws(() => validateAccountStateProgress(before, { ...after, instanceId: '20000000-0000-4000-8000-000000000002' }), /preserve_engine_uuid/);
  assert.throws(() => validateAccountStateProgress(before, { instanceId: 'runtime-local', revision: 8 }), /engine_uuid/);
});

test('cleanup attribute repair admits owned generated Git objects and preserves unrelated flags', () => {
  const root = resolve('owned-fixture');
  const object = resolve(root, 'h', '.tmp', 'plugins-clone-ab12', '.git', 'objects', 'pack', `pack-${'a'.repeat(40)}.idx`);
  assert.equal(generatedGitAttributeRepair(root, object, 33), 32);
  assert.equal(generatedGitAttributeRepair(root, object, 35), 32);
  const plugins = resolve(root, 'h', '.tmp', 'plugins', '.git');
  assert.equal(generatedGitAttributeRepair(root, resolve(plugins, 'objects', 'pack', `pack-${'b'.repeat(40)}.idx`), 33), 32);
  assert.equal(generatedGitAttributeRepair(root, resolve(plugins, 'objects', 'ab', 'c'.repeat(38)), 33), 32);
  assert.equal(generatedGitAttributeRepair(root, plugins, 18), 16);
  assert.throws(() => generatedGitAttributeRepair(root, resolve(root, 'h', '.tmp', 'plugins-extra', '.git', 'objects', 'ab', 'c'.repeat(38)), 33), /generated_git_object/);
  assert.throws(() => generatedGitAttributeRepair(root, resolve(plugins, 'config'), 33), /generated_git_object/);
  assert.throws(() => generatedGitAttributeRepair(root, object, 37), /system_attribute/);
  assert.throws(() => generatedGitAttributeRepair(root, object, 32), /cause_required/);
  assert.throws(() => generatedGitAttributeRepair(root, resolve(root, 'h', 'config.toml'), 33), /generated_git_object/);
  assert.throws(() => generatedGitAttributeRepair(root, resolve('outside', 'pack.idx'), 33), /inside_owned_fixture/);
  assert.throws(() => generatedGitAttributeRepair(root, resolve(root, 'h', '.tmp', 'plugins-clone-ab12', '.git', 'config'), 33), /generated_git_object/);
  const directory = resolve(root, 'h', '.tmp', 'plugins-clone-ab12', '.git');
  assert.equal(generatedGitAttributeRepair(root, directory, 18), 16);
  assert.equal(generatedGitAttributeRepair(root, directory, 19), 17, 'directory ReadOnly flag must remain untouched');
  assert.throws(() => generatedGitAttributeRepair(root, directory, 16), /hidden_cause/);
  assert.throws(() => generatedGitAttributeRepair(root, directory, 22), /system_attribute/);
  assert.throws(() => generatedGitAttributeRepair(root, resolve(root, 'h', '.tmp', 'other-generated-directory'), 18), /generated_git_object/);
});

test('approval reload subscribes with resume and verifies the original pending turn without starting another', async () => {
  const calls = [];
  const peer = { async request(method, params) {
    calls.push({ method, params });
    return method === 'thread/resume' ? { thread: { id: 'thread-a' } }
      : { thread: { turns: [{ id: 'turn-a', status: 'inProgress' }] } };
  } };
  await resumePendingTurn(peer, 'thread-a', 'turn-a');
  assert.deepEqual(calls, [
    { method: 'thread/resume', params: { threadId: 'thread-a' } },
    { method: 'thread/read', params: { threadId: 'thread-a', includeTurns: true } },
  ]);
  await assert.rejects(resumePendingTurn(peer, 'thread-a', 'replaced-turn'), /original_pending_turn/);
});

test('new owners of one workspace get separate session selections and owner reload preserves its file', () => {
  const run = resolve('owned-fixture'), original = 'a'.repeat(64), rejoined = 'b'.repeat(64);
  const originalFile = windowAccountStateFile(run, 'a', original);
  const rejoinedFile = windowAccountStateFile(run, 'a', rejoined);
  assert.notEqual(originalFile, rejoinedFile);
  assert.equal(windowAccountStateFile(run, 'a', original), originalFile);
  assert.equal(originalFile, resolve(run, 'a', 'window', original, 'azrael-account-state.json'));
  assert.throws(() => windowAccountStateFile(run, '../outside', original), /workspace_name/);
  assert.throws(() => windowAccountStateFile(run, 'a', '../outside'), /window_owner/);
});

test('Windows socket preflight rejects an overlength native AF_UNIX path', () => {
  const short = resolve(parse(process.cwd()).root, 'bj-home', 'selected-instance.sock');
  assert.equal(checkSocketPath(short, 'win32'), short);
  assert.throws(() => checkSocketPath(resolve('x'.repeat(110)), 'win32'), /AF_UNIX/);
  assert.throws(() => checkSocketPath('relative.sock', 'win32'), /absolute_native_socket/);
});

test('checker queries the selected binary with exactly its launch startup identity and validates native descriptor', async () => {
  const home = resolve(parse(process.cwd()).root, 'bj-home');
  const identity = createHash('sha256').update(await readFile(process.execPath)).digest('hex');
  const descriptor = { schema: 2, instanceId: 'a'.repeat(64), socketPath: resolve(home, 'app-server-control', 'selected.sock'),
    engineVersion: '0.162.0', engineIdentity: identity, storageAdmission: 'compatible' };
  let calls = 0;
  function discover(value = descriptor) {
    return queryEngineEndpoint(process.execPath, home, identity, descriptor.engineVersion, {
      execFile(engine, argv, options, callback) {
        calls++;
        assert.equal(engine, process.execPath);
        assert.deepEqual(argv, [...SHARED_CHECK_STARTUP_ARGS, '--azrael-engine-endpoint']);
        assert(SHARED_CHECK_STARTUP_ARGS.includes('--disable-plugin-startup-tasks-for-tests'));
        assert.equal(options.env.CODEX_HOME, home);
        assert.equal(options.env.AZRAEL_EX_WINDOW_CONTEXT, undefined);
        assert.equal(options.env.AZRAEL_EX_MANAGEMENT_SOCKET, undefined);
        callback(null, JSON.stringify(value), '');
      },
    });
  }
  assert.deepEqual(await discover(), descriptor);
  await assert.rejects(discover({ ...descriptor, schema: 1 }), /descriptor/);
  await assert.rejects(discover({ ...descriptor, socketPath: resolve(parse(process.cwd()).root, 'outside-owned-home.sock') }), /inside_owned_fixture_home/);
  assert.equal(calls, 3);
});
test('real bridge selects the engine bundle sibling and requires an absolute explicit override', () => {
  const engine = resolve('frozen-bundle', 'azrael.exe');
  assert.equal(resolveBridgePath(engine), resolve('frozen-bundle', 'azrael-bridge.exe'));
  assert.equal(resolveBridgePath(resolve('frozen-bundle', 'azrael')), resolve('frozen-bundle', 'azrael-bridge'));
  const override = resolve('other-frozen-bundle', 'azrael-bridge.exe');
  assert.equal(resolveBridgePath(engine, override), override);
  assert.throws(() => resolveBridgePath(engine, 'relative-bridge.exe'), /absolute_matching_bridge/);
  assert.throws(() => resolveBridgePath('relative-engine.exe'), /absolute_frozen_engine/);
});
test('early-startup cleanup accepts only matching scoped daemon receipts and a PID start identity', () => {
  const home = resolve(parse(process.cwd()).root, 'bj-home');
  const endpoint = { schema: 2, instanceId: 'b'.repeat(64), socketPath: resolve(home, 'app-server-control', 'selected.sock') };
  const expected = { endpoint, engineIdentity: 'a'.repeat(64), engineVersion: '0.162.0' };
  const receipt = { ...endpoint, engineIdentity: expected.engineIdentity, engineVersion: expected.engineVersion,
    nativeArgv: ['app-server', '--azrael-shared-windows', '--azrael-engine-instance', endpoint.instanceId, '--listen', `unix://${endpoint.socketPath}`] };
  const pid = { pid: 123, processStartTime: '134364988564380375' };
  assert.equal(validateOwnedDaemonReceipt(receipt, pid, expected), 123);
  for (const override of [{ engineIdentity: 'b'.repeat(64) }, { engineVersion: 'other' },
    { schema: 1 }, { instanceId: 'c'.repeat(64) }, { socketPath: resolve(home, 'another.sock') }, { nativeArgv: [] },
    { nativeArgv: ['app-server', '--azrael-shared-windows', '--listen', `unix://${endpoint.socketPath}`] }]) {
    assert.throws(() => validateOwnedDaemonReceipt({ ...receipt, ...override }, pid, expected));
  }
  assert.throws(() => validateOwnedDaemonReceipt(receipt, { ...pid, pid: -1 }, expected));
  assert.throws(() => validateOwnedDaemonReceipt(receipt, { ...pid, processStartTime: undefined }, expected));
});
test('owned code-mode fixture resolves branded host and quotes literal PowerShell child paths', () => {
  assert.equal(resolveCodeHostPath(resolve('bundle', 'azrael.exe')), resolve('bundle', 'azrael-code-mode-host.exe'));
  assert.equal(resolveCodeHostPath(resolve('bundle', 'codex.exe')), resolve('bundle', 'codex-code-mode-host.exe'));
  const source = codeModeChildSource(resolve("node's folder", 'node.exe'), resolve("fixture's folder", 'child.cjs'));
  assert(source.includes("node''s folder"));
  assert(source.includes("fixture''s folder"));
  assert(source.startsWith('// @exec: {"yield_time_ms":60000}'));
  assert.throws(() => codeModeChildSource('relative.exe', resolve('child.cjs')), /absolute_owned_child/);
});
test('code-mode compatibility requires decoded terminal text and native delegate result', async () => {
  const provider = await startSharedProvider();
  const request = async output => {
    const input = [{role:'user',content:[{type:'input_text',text:'BJ_MODE:codesmoke:ipc-smoke'}]}];
    if (output !== undefined) input.push({type:'custom_tool_call_output',call_id:'bj-ipc-smoke',output});
    const result = await fetch(provider.baseUrl+'/responses',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({input})});
    return {status:result.status,body:await result.text()};
  };
  try {
    const first = await request();
    assert.equal(first.status,200);
    const item=first.body.split('\n').filter(line=>line.startsWith('data: ')).map(line=>JSON.parse(line.slice(6)))[1].item;
    assert.deepEqual(item,{type:'custom_tool_call',call_id:'bj-ipc-smoke',name:'exec',input:CODE_MODE_SMOKE_SOURCE});
    const ok = await request('Script completed\nIPC_TEXT_OK\nIPC_COMPLETE_OK');
    assert.equal(ok.status,200); assert(ok.body.includes('BJ_COMPLETED:ipc-smoke'));
    for(const output of ['failed to decode code-mode IPC frame: unknown field result_buffered_for_ns','Script completed',
      'IPC_TEXT_OK\nScript running with cell ID 1', 'Error executing text("IPC_TEXT_OK"); text("IPC_COMPLETE_OK")']) {
      assert.equal((await request(output)).status,500);
    }
    assert.equal(provider.errors.length,4);
  } finally {await provider.close();}
});

test('code-mode smoke accepts text content arrays and propagates delegate execution failures', async () => {
  validateCodeModeSmokeOutput([{type:'input_text',text:'IPC_TEXT_OK'},{type:'input_text',text:'IPC_COMPLETE_OK'}]);
  assert.throws(()=>validateCodeModeSmokeOutput(null),/completed_text_and_delegate/);
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
  const source=CODE_MODE_SMOKE_SOURCE.slice(CODE_MODE_SMOKE_SOURCE.indexOf('\n')+1);
  const execute=new AsyncFunction('tools','text',source);
  const seen=[];
  await execute({exec_command:async()=>({exit_code:0,output:'IPC_DELEGATE_OK'})},text=>seen.push(text));
  assert.deepEqual(seen,['IPC_TEXT_OK','IPC_COMPLETE_OK']);
  for(const result of [{exit_code:1,output:'IPC_DELEGATE_OK'},{exit_code:0,output:'wrong output'}]) {
    await assert.rejects(execute({exec_command:async()=>result},()=>{}),/delegate did not complete/);
  }
});


test('native release startup omits only the explicitly unsupported debug-only hook', async () => {
  assert.equal(sharedCheckStartupArgs(), SHARED_CHECK_STARTUP_ARGS);
  const probe = async (error, stderr) => supportsPluginStartupTestHook(process.execPath, {
    execFile(executable, args, options, callback) {
      assert.equal(executable, process.execPath);
      assert.deepEqual(args, ['app-server', '--disable-plugin-startup-tasks-for-tests', '--version']);
      assert.equal(options.timeout, 10000);
      callback(error, '', stderr);
    },
  });
  assert.equal(await probe(null, ''), true);
  const unsupported = Object.assign(new Error('unsupported option'), { code: 2 });
  assert.equal(await probe(unsupported, "error: unexpected argument '--disable-plugin-startup-tasks-for-tests' found\n"), false);
  assert.deepEqual(sharedCheckStartupArgs(true), SHARED_CHECK_STARTUP_ARGS.filter(arg => arg !== '--disable-plugin-startup-tasks-for-tests'));
  await assert.rejects(probe(Object.assign(new Error('missing engine'), { code: 'ENOENT' }), ''), /missing engine/);
  await assert.rejects(probe(Object.assign(new Error('timeout'), { code: 2, killed: true }), "error: unexpected argument '--disable-plugin-startup-tasks-for-tests' found\n"), /timeout/);
  await assert.rejects(probe(Object.assign(new Error('different invalid option'), { code: 2 }), "error: unexpected argument '--other' found\n"), /different invalid option/);
});
