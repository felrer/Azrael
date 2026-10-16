import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve, parse } from 'node:path';
import { spawn } from 'node:child_process';
import { readFile, mkdir } from 'node:fs/promises';
import { waitForExit } from './lib/azrael-rpc-check.mjs';
import { parseVersion, checkSocketPath, startSharedProvider, resolveBridgePath, resolveCodeHostPath, codeModeChildSource, validateOwnedDaemonReceipt, startupRemaining, RPC_TIMEOUT_MS, windowAccountStateFile, resumePendingTurn, generatedGitAttributeRepair, validateAccountStateProgress, runCheck, diagnosticRootPids, captureOwnedProcessTree } from './check-shared-engine.mjs';

test('Windows PowerShell process-tree probe handles a JSON PID array and records owned process identity', { skip: process.platform !== 'win32' }, async () => {
  const child = spawn(process.execPath, ['-e', 'process.stdin.resume();process.stdin.on("end",()=>process.exit(0));setTimeout(()=>process.exit(0),20000);'],
    { windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] });
  await new Promise((done, reject) => { child.once('spawn', done); child.once('error', reject); });
  const output = resolve(import.meta.dirname, '..', 'artifacts', 'logs', 'BJ-01-shared-engine');
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

test('native startup consumes one bounded launch budget while ordinary RPC remains shorter', () => {
  assert.equal(startupRemaining(1_000, 1_000), 90_000);
  assert.equal(startupRemaining(1_000, 61_000), 30_000);
  assert.equal(startupRemaining(1_000, 66_000, 70_000), 5_000);
  assert.throws(() => startupRemaining(1_000, 91_000), /startup_deadline_exhausted/);
  assert.equal(RPC_TIMEOUT_MS, 30_000);
});

test('native version parser accepts branded output and refuses arbitrary output', () => {
  assert.equal(parseVersion('azrael-cli 0.162.0\n'), '0.162.0');
  assert.equal(parseVersion('codex-cli 0.162.0\n'), '0.162.0');
  for (const output of ['0.162.0', 'error 0.162.0', 'azrael-cli unknown', 'azrael-cli 0.162.0-extra']) {
    assert.throws(() => parseVersion(output), /unexpected_native_version/);
  }
});
test('Windows socket preflight rejects an overlength native AF_UNIX path', () => {
  const short = resolve(parse(process.cwd()).root, 'bj-home');
  assert(checkSocketPath(short, 'win32').endsWith('app-server-control.sock'));
  assert.throws(() => checkSocketPath(resolve('x'.repeat(110)), 'win32'), /AF_UNIX/);
  assert.throws(() => checkSocketPath('relative-home', 'win32'), /absolute_fixture_home/);
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
  const expected = { home, engineIdentity: 'a'.repeat(64), engineVersion: '0.162.0' };
  const receipt = { engineIdentity: expected.engineIdentity, engineVersion: expected.engineVersion,
    socketPath: checkSocketPath(home), nativeArgv: ['app-server', '--azrael-shared-windows', '--listen', `unix://${checkSocketPath(home)}`] };
  const pid = { pid: 123, processStartTime: '134364988564380375' };
  assert.equal(validateOwnedDaemonReceipt(receipt, pid, expected), 123);
  for (const override of [{ engineIdentity: 'b'.repeat(64) }, { engineVersion: 'other' },
    { socketPath: checkSocketPath(resolve(parse(process.cwd()).root, 'another-home')) }, { nativeArgv: [] }]) {
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
test('loopback code-mode scenario uses native custom exec wire schema', async () => {
  const source = codeModeChildSource(resolve('node.exe'), resolve('owned-child.cjs'));
  const provider = await startSharedProvider({ codeModeSource: source });
  try {
    const result = await fetch(`${provider.baseUrl}/responses`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: [{ role: 'user', content: [{ type: 'input_text', text: 'BJ_MODE:codechild:owned-child' }] }] }) });
    assert.equal(result.status, 200);
    const events = (await result.text()).split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)));
    assert.deepEqual(events[1].item, { type: 'custom_tool_call', call_id: 'bj-owned-child', name: 'exec', input: source });
    assert.equal(provider.errors.length, 0);
  } finally { await provider.close(); }
});
test('loopback provider holds tools, requests a denyable approval, and completes released or explicit turns', async () => {
  const provider = await startSharedProvider();
  const response = async (mode, token, answered = false) => {
    const result = await fetch(`${provider.baseUrl}/responses`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'fixture',
        input: [{ role: 'user', content: [{ type: 'input_text', text: `BJ_MODE:${mode}:${token}` }] },
          ...(answered ? [{ type: 'function_call_output', call_id: `bj-${token}`, output: 'released' }] : [])] }) });
    assert.equal(result.status, 200);
    return (await result.text()).split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)));
  };
  try {
    const held = await response('hold', 'a');
    assert.equal(held[1].item.namespace, 'shared_probe');
    assert.equal(held[1].item.name, 'hold');
    assert.equal(held[1].item.call_id, 'bj-a');
    assert.equal((await response('hold', 'a', true))[1].item.type, 'message');
    const approval = (await response('approval', 'b'))[1].item;
    assert.equal(approval.name, 'exec_command');
    assert.equal(JSON.parse(approval.arguments).sandbox_permissions, 'require_escalated');
    assert.equal((await response('finish', 'c'))[1].item.content[0].text, 'BJ_COMPLETED:c');
    assert.equal(provider.requests.length, 4);
    assert.equal(provider.errors.length, 0);
  } finally { await provider.close(); }
});
