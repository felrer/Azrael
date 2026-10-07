'use strict';
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createBackend } = require('./window-control-backend.cjs');
async function main() {
  let launched = 0, options, child, replyResult = { windows: [] }; const nativeRequests = [];
  const declaration = { executable: 'C:/verified/helper.exe', manifestSha256: 'hash' };
  const runtime = { windowControl: declaration, env: { AZRAEL_EX_MANAGEMENT_SOCKET: 'secret', SKY_SESSION: 'old' } };
  const spawnChild = (_exe, _args, opts) => {
    launched++; options = opts; child = new EventEmitter(); child.exitCode = null; child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    child.stdin = { write(line) { const request = JSON.parse(line); nativeRequests.push(request); const bytes = Buffer.from(JSON.stringify({ id: request.id, result: replyResult }) + '\n'); queueMicrotask(() => { for (let i = 0; i < bytes.length; i++) child.stdout.emit('data', bytes.subarray(i, i + 1)); }); }, end(line) { assert.equal(JSON.parse(line).method, 'shutdown'); child.exitCode = 0; queueMicrotask(() => child.emit('exit', 0)); } };
    child.kill = () => { throw new Error('Mock successful shutdown must not kill'); }; return child;
  };
  const backend = createBackend(runtime, { spawnChild, verify: () => declaration });
  assert.equal(launched, 0); assert.deepEqual(await backend.request('listWindows', {}), []); await backend.request('status', {}); assert.equal(launched, 1);
  const window = { hwnd: '1a', pid: 12, processCreated: '1b', executable: 'C:/프로그램/한글앱.exe', title: '한글 창 제목', minimized: false, widthPx: 800, heightPx: 600, dpi: 96 };
  replyResult = { windows: [window] }; assert.deepEqual(await backend.request('listWindows', {}), [window]); assert.deepEqual(nativeRequests.at(-1).params, {});
  for (const malformed of [null, [], { windows: {} }, { windows: [], extra: true }, {}]) { replyResult = malformed; await assert.rejects(backend.request('listWindows', {}), /listWindows result envelope/); }
  for (const [method, extra, response] of [
    ['status', {}, { window, state: 'normal', foregroundHwnd: '2a', cursorVisible: true }], ['restore', {}, { window, restored: true }], ['resize', { widthDip: 800, heightDip: 600 }, { window, widthPx: 800, heightPx: 600, widthDip: 800, heightDip: 600 }],
    ['act', { observationId: 'observation-1', elementId: 'element-1', action: 'setValue', value: '한글 값' }, { window, acted: true, requiresObservation: true }],
  ]) { const params = { window, ...extra }; replyResult = response; assert.deepEqual(await backend.request(method, params), response); assert.equal(nativeRequests.at(-1).method, method); assert.deepEqual(nativeRequests.at(-1).params, params); }
  replyResult = { window: { executable: 'C:/프로그램/한글앱.exe', title: '한글 창 제목' }, elementsTruncated: false, elements: [{ name: '입력 영역' }] }; assert.deepEqual(await backend.request('observe', {}), replyResult);
  assert.equal(options.windowsHide, true); assert.equal(options.env.AZRAEL_EX_MANAGEMENT_SOCKET, undefined); assert.equal(options.env.SKY_SESSION, undefined);
  await assert.rejects(backend.request('shell', {}), /Unsupported/); await backend.dispose(); await assert.rejects(backend.request('status', {}), /disposed/);
  let invalidSpawn = false; const invalid = createBackend(runtime, { spawnChild() { invalidSpawn = true; }, verify: () => ({ ...declaration, manifestSha256: 'wrong' }) });
  await assert.rejects(invalid.request('listWindows', {}), /declaration mismatch/); assert.equal(invalidSpawn, false); await invalid.dispose();
  let killed = 0; let timeoutChild;
  const stalled = createBackend(runtime, { verify: () => declaration, timeoutMs: 10, shutdownMs: 10, spawnChild() { timeoutChild = new EventEmitter(); timeoutChild.exitCode = null; timeoutChild.stdout = new EventEmitter(); timeoutChild.stderr = new EventEmitter(); timeoutChild.stdin = { write() {}, end() {} }; timeoutChild.kill = () => { killed++; timeoutChild.exitCode = 1; timeoutChild.emit('exit', 1); }; return timeoutChild; } });
  await assert.rejects(stalled.request('status', {}), /timed out/); await new Promise(r => setTimeout(r, 30)); assert.equal(killed, 1);
  await errorChecks(runtime, declaration);
  await recoveryChecks(runtime, declaration);
  console.log('Window backend: envelope, UTF8, manifest, lifecycle, native error classification, exit metadata and mutation uncertainty checks passed');
}
async function errorChecks(runtime, declaration) {
  const fixture = (respond, extra = {}) => {
    let child;
    const backend = createBackend(runtime, { verify: () => declaration, shutdownMs: 5, ...extra, spawnChild() {
      child = new EventEmitter(); child.exitCode = null; child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
      child.stdin = new EventEmitter();
      child.stdin.write = line => { const request = JSON.parse(line); queueMicrotask(() => respond(child, request)); };
      child.stdin.end = () => { child.exitCode = 0; queueMicrotask(() => child.emit('exit', 0, null)); };
      child.kill = () => { child.exitCode = 1; child.emit('exit', 1, null); };
      return child;
    } });
    return backend;
  };
  for (const [nativeCode, code, uncertain] of [
    ['unsupported-action', 'unsupported_action', false], ['unsupported-key', 'unsupported_action', false],
    ['disabled-element', 'unsupported_action', false], ['readonly-element', 'unsupported_action', false],
    ['unknown-element', 'state_changed', false], ['stale-element', 'state_changed', false],
    ['stale-observation', 'state_changed', false], ['stale-target', 'state_changed', false],
    ['capture-timeout', 'timeout', true], ['provider-timeout', 'timeout', true],
    ['uncertain-delivery', 'connection_error', true], ['native-error', 'unclassified', true],
    ['new-provider-code', 'unclassified', true],
    ['unobservable-target', 'unclassified', true],
  ]) {
    const backend = fixture((child, request) => child.stdout.emit('data', Buffer.from(JSON.stringify({ id: request.id, error: { code: nativeCode, message: 'private window content' } }) + '\n')));
    await assert.rejects(backend.request('act', {}), error => {
      assert.equal(error.code, code); assert.equal(error.nativeCode, nativeCode); assert.equal(error.stage, 'native');
      assert.equal(error.mutationOutcome, uncertain ? 'unknown' : undefined); assert.ok(!error.message.includes('private'));
      assert.equal(error.actionExecuted, uncertain ? undefined : false);
      if (code === 'unclassified') assert.equal(error.message, '미분류된 오류'); return true;
    });
    await backend.dispose();
  }
  for (const method of ['observe', 'inspect', 'act']) {
    for (const mutationOutcome of [undefined, 'unknown']) {
      const backend = fixture((child, request) => child.stdout.emit('data', Buffer.from(JSON.stringify({ id: request.id, error: {
        code: 'window-minimized', message: 'private window content', restoreAllowed: true,
        ...(mutationOutcome ? { mutationOutcome } : {}),
      } }) + '\n')));
      await assert.rejects(backend.request(method, {}), error => {
        assert.equal(error.code, 'window_minimized'); assert.equal(error.nativeCode, 'window-minimized');
        assert.equal(error.message, '선택한 창이 최소화되었습니다.'); assert.ok(!error.message.includes('private'));
        assert.equal(error.pauseReason, 'minimized'); assert.equal(error.actionExecuted, mutationOutcome === 'unknown' ? undefined : false);
        assert.equal(Object.hasOwn(error, 'actionExecuted'), mutationOutcome !== 'unknown');
        assert.equal(error.restoreAllowed, undefined); assert.equal(error.mutationOutcome, mutationOutcome);
        assert.equal(Object.hasOwn(error, 'mutationOutcome'), mutationOutcome === 'unknown'); return true;
      });
      await backend.dispose();
    }
  }
  for (const [nativeCode, code] of [['not-resizable', 'unsupported_action'], ['resize-bounds', 'invalid_request']]) {
    for (const mutationOutcome of [undefined, 'unknown']) {
      const backend = fixture((child, request) => {
        assert.equal(request.method, 'resize');
        assert.equal(request.params.widthDip, 900);
        child.stdout.emit('data', Buffer.from(JSON.stringify({ id: request.id, error: { code: nativeCode, message: 'private resize detail', ...(mutationOutcome ? { mutationOutcome } : {}) } }) + '\n'));
      });
      await assert.rejects(backend.request('resize', { widthDip: 900, heightDip: 700 }), error => {
        assert.equal(error.code, code); assert.equal(error.nativeCode, nativeCode); assert.equal(error.stage, 'native');
        assert.equal(error.mutationOutcome, mutationOutcome); assert.equal(Object.hasOwn(error, 'mutationOutcome'), mutationOutcome === 'unknown');
        assert.ok(!error.message.includes('private')); return true;
      });
      await backend.dispose();
    }
  }
  for (const method of ['observe', 'inspect']) {
    for (const mutationOutcome of [undefined, 'unknown']) {
      const backend = fixture((child, request) => child.stdout.emit('data', Buffer.from(JSON.stringify({ id: request.id, error: { code: 'capture-size-changed', ...(mutationOutcome ? { mutationOutcome } : {}) } }) + '\n')));
      await assert.rejects(backend.request(method, {}), error => {
        assert.equal(error.code, 'state_changed'); assert.equal(error.nativeCode, 'capture-size-changed');
        assert.equal(error.mutationOutcome, mutationOutcome); assert.equal(error.stage, 'native'); return true;
      });
      await backend.dispose();
    }
  }
  for (const [exitCode, signal] of [[17, null], [null, 'SIGTERM']]) {
    const backend = fixture(child => { child.exitCode = exitCode; child.emit('exit', exitCode, signal); });
    await assert.rejects(backend.request('resize', {}), error => {
      assert.equal(error.code, 'connection_error'); assert.equal(error.stage, 'native'); assert.equal(error.exitCode, exitCode);
      assert.equal(error.signal, signal); assert.equal(error.mutationOutcome, 'unknown'); return true;
    }); await backend.dispose();
  }
  for (const mutation of ['act', 'resize', 'restore']) {
    const backend = fixture(() => {}, { timeoutMs: 5 });
    await assert.rejects(backend.request(mutation, {}), error => error.code === 'timeout' && error.stage === 'native' && error.mutationOutcome === 'unknown');
    await backend.dispose();
  }
  for (const reply of [
    { id: null, error: { code: 'request-too-large', message: 'private parse content' } },
    { error: { code: 'invalid-request', message: 'private parse content' } },
    { id: null, error: { code: 'window-minimized', message: 'private minimized detail', restoreAllowed: true } },
  ]) {
    const backend = fixture(child => child.stdout.emit('data', Buffer.from(JSON.stringify(reply) + '\n')));
    await assert.rejects(backend.request('restore', {}), error => error.code === 'unclassified' && error.stage === 'native' && error.nativeCode === reply.error.code && error.mutationOutcome === 'unknown' && error.pauseReason === undefined && error.restoreAllowed === undefined && error.actionExecuted === undefined);
    await backend.dispose();
  }
  const postMutation = fixture((child, request) => child.stdout.emit('data', Buffer.from(JSON.stringify({ id: request.id, error: { code: 'stale-target', mutationOutcome: 'unknown' } }) + '\n')));
  await assert.rejects(postMutation.request('act', {}), error => error.code === 'state_changed' && error.mutationOutcome === 'unknown'); await postMutation.dispose();
  for (const response of ['malformed-json\n', 'null\n']) {
    const backend = fixture(child => child.stdout.emit('data', Buffer.from(response)));
    await assert.rejects(backend.request('act', {}), error => error.code === 'connection_error' && error.stage === 'native' && error.mutationOutcome === 'unknown'); await backend.dispose();
  }
  const failedWrite = fixture(child => child.stdin.emit('error', new Error('private transport detail')));
  await assert.rejects(failedWrite.request('act', {}), error => error.code === 'connection_error' && error.stage === 'native' && error.mutationOutcome === 'unknown' && !error.message.includes('private')); await failedWrite.dispose();
  for (const stream of ['stdout', 'stderr']) {
    const failedRead = fixture(child => child[stream].emit('error', new Error('private stream detail')));
    await assert.rejects(failedRead.request('restore', {}), error => error.code === 'connection_error' && error.stage === 'native' && error.mutationOutcome === 'unknown' && !error.message.includes('private')); await failedRead.dispose();
  }
  for (const nativeCode of ['disabled-element', 'readonly-element', 'stale-observation', 'unknown-element', 'stale-element', 'unsupported-action', 'unsupported-key']) {
    const backend = fixture((child, request) => child.stdout.emit('data', Buffer.from(JSON.stringify({ id: request.id, error: { code: nativeCode, mutationOutcome: 'unknown' } }) + '\n')));
    await assert.rejects(backend.request('act', {}), error => error.mutationOutcome === 'unknown' && !Object.hasOwn(error, 'actionExecuted'));
    await backend.dispose();
  }
  for (const [nativeCode, code] of [['unobservable-target', 'state_changed'], ['uia-value-limit', 'unsupported_action'], ['capture-unsupported', 'unsupported_action'], ['protected-target', 'unsupported_action'], ...['capture-device', 'capture-format', 'capture-encode', 'capture-clock', 'capture-size'].map(code => [code, 'state_changed']), ['native-error', 'unclassified']]) {
    const backend = fixture((child, request) => child.stdout.emit('data', Buffer.from(JSON.stringify({ id: request.id, error: { code: nativeCode, message: 'private observation detail' } }) + '\n')));
    await assert.rejects(backend.request('observe', {}), error => error.code === code && error.nativeCode === nativeCode && error.mutationOutcome === undefined && !error.message.includes('private'));
    await backend.dispose();
  }
}
async function recoveryChecks(runtime, declaration) {
  for (const failure of ['timeout', 'malformed', 'stdout', 'stdin', 'exit', 'cancelled']) {
    const helpers = [], sent = [], killed = [];
    const backend = createBackend(runtime, { verify: () => declaration, timeoutMs: 20, shutdownMs: 10, spawnChild() {
      const helper = new EventEmitter(); helper.exitCode = null; helper.stdout = new EventEmitter(); helper.stderr = new EventEmitter(); helper.stdin = new EventEmitter();
      const generation = helpers.length; helpers.push(helper);
      helper.stdin.write = line => { const request = JSON.parse(line); sent.push({ generation, request }); queueMicrotask(() => {
        if (generation) helper.stdout.emit('data', Buffer.from(JSON.stringify({ id: request.id, result: { generation } }) + '\n'));
        else if (failure === 'malformed') helper.stdout.emit('data', Buffer.from('private malformed reply\n'));
        else if (failure === 'stdout' || failure === 'stdin') helper[failure].emit('error', new Error('private connection detail'));
        else if (failure === 'exit') { helper.exitCode = 17; helper.emit('exit', 17, null); }
        else if (failure === 'cancelled') helper.stdout.emit('data', Buffer.from(JSON.stringify({ id: request.id, error: { code: 'operation-cancelled' } }) + '\n'));
      }); };
      helper.stdin.end = () => { if (generation) { helper.exitCode = 0; queueMicrotask(() => helper.emit('exit', 0)); } };
      helper.kill = () => { killed.push(generation); helper.exitCode = 1; helper.emit('exit', 1); };
      return helper;
    } });
    const initial = assert.rejects(backend.request('observe', {}), error => error.code === (failure === 'timeout' ? 'timeout' : failure === 'cancelled' ? 'cancelled' : 'connection_error') && error.mutationOutcome === undefined);
    if (failure === 'timeout') await Promise.all([initial, assert.rejects(backend.request('act', {}), error => error.code === 'timeout' && error.mutationOutcome === 'unknown')]);
    else if (failure === 'cancelled') await Promise.all([initial, assert.rejects(backend.request('status', {}), error => error.code === 'cancelled')]);
    else await initial;
    const next = Promise.all([backend.request('inspect', {}), backend.request('status', {})]);
    const old = helpers[0];
    old.stdout.emit('data', Buffer.from(JSON.stringify({ id: sent[0].request.id, result: { generation: 'late' } }) + '\n'));
    old.stdout.emit('error', new Error('late private error'));
    assert.deepEqual(await next, [{ generation: 1 }, { generation: 1 }]);
    assert.equal(helpers.length, 2); assert.equal(sent.filter(entry => entry.generation === 0).length, ['timeout', 'cancelled'].includes(failure) ? 2 : 1);
    assert.equal(sent.filter(entry => entry.request.method === 'act').length, failure === 'timeout' ? 1 : 0);
    await backend.dispose(); assert.deepEqual(killed, failure === 'exit' ? [] : [0]);
    await assert.rejects(backend.request('observe', {}), error => error.code === 'cancelled');
  }
  // Explicit disposal during failed-helper shutdown remains terminal for waiters.
  let launched = 0;
  const backend = createBackend(runtime, { verify: () => declaration, timeoutMs: 5, shutdownMs: 10, spawnChild() {
    launched++; const helper = new EventEmitter(); helper.exitCode = null; helper.stdout = new EventEmitter(); helper.stderr = new EventEmitter();
    helper.stdin = { write() {}, end() {} }; helper.kill = () => { helper.exitCode = 1; helper.emit('exit', 1); }; return helper;
  } });
  await assert.rejects(backend.request('status', {}), error => error.code === 'timeout');
  const waiting = backend.request('observe', {});
  const rejected = assert.rejects(waiting, error => error.code === 'cancelled');
  await Promise.all([backend.dispose(), backend.dispose(), rejected]); assert.equal(launched, 1);
  // A delayed exit after kill must finish before spawning a replacement.
  let old, signalKill; const killRequested = new Promise(resolve => { signalKill = resolve; }); let starts = 0;
  const delayed = createBackend(runtime, { verify: () => declaration, timeoutMs: 5, shutdownMs: 5, spawnChild() {
    const helper = new EventEmitter(); helper.exitCode = null; helper.stdout = new EventEmitter(); helper.stderr = new EventEmitter(); const generation = starts++;
    helper.stdin = { write(line) { const request = JSON.parse(line); if (generation) queueMicrotask(() => helper.stdout.emit('data', Buffer.from(JSON.stringify({ id: request.id, result: 'fresh' }) + '\n'))); }, end() { if (generation) { helper.exitCode = 0; helper.emit('exit', 0); } } };
    helper.kill = () => { signalKill(); return true; }; if (!generation) old = helper; return helper;
  } });
  await assert.rejects(delayed.request('inspect', {}), error => error.code === 'timeout');
  const fresh = delayed.request('observe', {}); await killRequested; assert.equal(starts, 1);
  old.exitCode = 1; old.emit('exit', 1); assert.equal(await fresh, 'fresh'); assert.equal(starts, 2); await delayed.dispose();
  for (const failure of ['never-exits', 'throwing-kill', 'spawn-error']) {
    let previous, starts = 0, kills = 0;
    const recovering = createBackend(runtime, { verify: () => declaration, timeoutMs: 5, shutdownMs: 5, spawnChild() {
      const helper = new EventEmitter(); helper.exitCode = null; helper.stdout = new EventEmitter(); helper.stderr = new EventEmitter(); const generation = starts++;
      helper.stdin = { write(line) { const request = JSON.parse(line); if (generation) queueMicrotask(() => helper.stdout.emit('data', Buffer.from(JSON.stringify({ id: request.id, result: 'fresh' }) + '\n'))); }, end() { if (generation) { helper.exitCode = 0; helper.emit('exit', 0); } } };
      helper.kill = () => { kills++; if (failure === 'throwing-kill') throw new Error('private kill failure'); return true; };
      if (!generation) { previous = helper; if (failure === 'spawn-error') queueMicrotask(() => helper.emit('error', new Error('private spawn failure'))); }
      return helper;
    } });
    await assert.rejects(recovering.request('status', {}), error => error.code === (failure === 'spawn-error' ? 'connection_error' : 'timeout'));
    await assert.rejects(recovering.request('observe', {}), error => error.code === 'connection_error' && !error.message.includes('private'));
    await assert.rejects(recovering.request('inspect', {}), error => error.code === 'connection_error');
    assert.equal(starts, 1); assert.equal(kills, failure === 'spawn-error' ? 0 : 1);
    if (failure === 'spawn-error') previous.emit('close');
    else { previous.exitCode = 1; previous.emit('exit', 1); }
    assert.equal(await recovering.request('observe', {}), 'fresh'); assert.equal(starts, 2); await recovering.dispose();
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
