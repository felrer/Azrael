import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { appendFileSync, writeFileSync } from 'node:fs';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

// Preload only in the isolated check subprocess. Run the real CLI and its real
// JsonLinePeer; substitute the external processes at the transport boundary.
if (process.env.AZRAEL_MANAGEMENT_SMOKE_FIXTURE) {
  const scenario = process.env.AZRAEL_MANAGEMENT_SMOKE_FIXTURE;
  const trace = process.env.AZRAEL_MANAGEMENT_SMOKE_TRACE;
  let config;
  const originalSpawn = childProcess.spawn;
  childProcess.spawn = (executable, args, options) => {
    if (!executable.endsWith('fake-engine') && !executable.endsWith('fake-bridge')) {
      return originalSpawn(executable, args, options);
    }
    const role = executable.endsWith('fake-engine') ? 'engine' : 'bridge';
    assert.equal(options.windowsHide, true);
    assert.deepEqual(options.stdio, ['pipe', 'pipe', 'pipe']);
    if (role === 'engine') {
      assert.deepEqual(args, ['-c', 'features.code_mode_host=true', 'app-server', '--analytics-default-enabled']);
      assert.equal(options.env.CODEX_HOME, options.cwd);
      assert.equal(options.env.AZRAEL_EX_MANAGEMENT_SOCKET, process.argv.at(-1));
    } else {
      assert.deepEqual(args, [process.argv.at(-1)]);
    }
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.exitCode = null;
    child.signalCode = null;
    let buffer = '';
    let initialized = false;
    let notified = false;
    const send = message => child.stdout.write(`${JSON.stringify(message)}\n`);
    child.stdin = new Writable({
      write(chunk, encoding, callback) {
        buffer += chunk.toString();
        let end;
        try {
          while ((end = buffer.indexOf('\n')) >= 0) {
            const message = JSON.parse(buffer.slice(0, end));
            buffer = buffer.slice(end + 1);
            appendFileSync(trace, `${JSON.stringify({ role, ...message })}\n`);
            const { id, method, params } = message;
            if (method === 'initialize') {
              assert.equal(initialized, false);
              assert.equal(params.capabilities.experimentalApi, true);
              initialized = true;
              send({ id, result: { serverInfo: 'fixture' } });
              continue;
            }
            if (method === 'initialized') {
              assert.equal(initialized, true);
              notified = true;
              continue;
            }
            if (role === 'engine') assert.equal(notified, true, 'initialize handshake precedes public requests');
            let result;
            switch (method) {
              case 'account/read':
                assert.deepEqual(params, { refreshToken: false });
                result = { account: scenario === 'logged-in' ? { id: 'unexpected' } : null };
                break;
              case 'thread/list':
                assert.equal(role, 'engine');
                assert.deepEqual(params, { limit: 10 });
                assert.equal(config, undefined, 'fresh thread check precedes config mutation');
                result = scenario === 'nonempty' ? { data: [{ id: 'unexpected' }] }
                  : scenario === 'wrong-shape' ? { data: { length: 0 } }
                    : scenario === 'null-response' ? null : { data: [] };
                break;
              case 'config/value/write':
                assert.equal(role, 'engine');
                assert.deepEqual(params, { keyPath: 'model', value: 'azrael-management-probe', mergeStrategy: 'replace' });
                config = { model: params.value };
                writeFileSync(join(options.cwd, 'config.toml'), `model = "${params.value}"\n`);
                result = {};
                break;
              case 'config/read':
                assert.equal(role, 'bridge');
                assert.deepEqual(params, { includeLayers: true });
                result = { config };
                break;
              case 'account/logout':
                assert.equal(role, 'bridge');
                send({ id, error: { code: -32601, message: 'denied' } });
                continue;
              default:
                throw new Error(`Unexpected fixture request: ${method}`);
            }
            send({ id, result });
          }
          callback();
        } catch (error) {
          callback(error);
        }
      },
      final(callback) {
        callback();
        setImmediate(() => {
          child.exitCode = 0;
          child.stdout.end();
          child.stderr.end();
          appendFileSync(trace, `${JSON.stringify({ role, exitCode: 0 })}\n`);
          child.emit('exit', 0, null);
          child.emit('close', 0, null);
        });
      },
    });
    child.kill = () => { throw new Error('Fixture should exit through stdin EOF'); };
    if (role === 'bridge') {
      setImmediate(() => send({ method: 'azrael/connected', params: { codexHome: options.cwd, serverVersion: 'fixture' } }));
    }
    return child;
  };
  syncBuiltinESMExports();
} else {
  const [outputArgument] = process.argv.slice(2);
  assert.ok(outputArgument && isAbsolute(outputArgument), 'Usage: node scripts/test-check-management.mjs <new absolute output directory>');
  const output = resolve(outputArgument);
  await mkdir(output); // The caller owns this fresh fixture/evidence directory.
  const script = fileURLToPath(new URL('./check-management.mjs', import.meta.url));
  const preload = import.meta.url;
  const results = [];
  for (const scenario of ['empty', 'nonempty', 'wrong-shape', 'null-response', 'logged-in', 'existing-state']) {
    const directory = join(output, scenario);
    await mkdir(directory);
    const state = join(directory, 'state');
    const trace = join(directory, 'transport.jsonl');
    // No socket is created by these mocks. Keep the argument short enough for
    // the real Windows AF_UNIX preflight, independently of the evidence path.
    const socket = join(tmpdir(), `azm-${randomUUID().slice(0, 8)}`, 'm.sock');
    if (scenario === 'existing-state') {
      await mkdir(state);
      await writeFile(join(state, 'sentinel'), 'preserve');
    }
    const run = childProcess.spawnSync(process.execPath, ['--import', preload, script,
      join(directory, 'fake-engine'), join(directory, 'fake-bridge'), state, socket], {
      encoding: 'utf8', windowsHide: true, timeout: 15_000,
      env: { ...process.env, AZRAEL_MANAGEMENT_SMOKE_FIXTURE: scenario, AZRAEL_MANAGEMENT_SMOKE_TRACE: trace },
    });
    await writeFile(join(directory, 'stdout.log'), run.stdout ?? '');
    await writeFile(join(directory, 'stderr.log'), run.stderr ?? '');
    assert.ifError(run.error);
    assert.equal(run.status, scenario === 'empty' ? 0 : 1, `${scenario}: ${run.stderr}`);
    if (scenario === 'existing-state') {
      assert.match(run.stderr, /State directory already exists/);
      assert.equal(await readFile(join(state, 'sentinel'), 'utf8'), 'preserve');
      await assert.rejects(access(trace), { code: 'ENOENT' });
    } else {
      const events = (await readFile(trace, 'utf8')).trim().split('\n').map(JSON.parse);
      const methods = events.filter(event => event.method).map(event => event.method);
      assert.deepEqual(methods.slice(0, 2), ['initialize', 'initialized']);
      assert.equal(events.filter(event => event.exitCode === 0).length, 2, 'both fixture processes exited');
      const threadIndex = methods.indexOf('thread/list');
      if (scenario === 'logged-in') {
        assert.equal(threadIndex, -1);
        assert.match(run.stderr, /Fresh state unexpectedly contains an account/);
      } else {
        assert.ok(threadIndex >= 0, 'fresh thread RPC is required');
        assert.deepEqual(events.filter(event => event.method === 'account/read').slice(0, 2).map(event => event.role).sort(), ['bridge', 'engine']);
        assert.deepEqual(methods.slice(2, threadIndex), ['account/read', 'account/read']);
        assert.equal(events.find(event => event.method === 'thread/list').role, 'engine');
      }
      if (scenario === 'empty') {
        assert.ok(threadIndex < methods.indexOf('config/value/write'));
        const commandResult = JSON.parse(run.stdout);
        const evidence = JSON.parse(await readFile(join(commandResult.runRoot, 'reports', 'verification.json'), 'utf8'));
        assert.equal(evidence.status, 'passed');
        assert.equal(evidence.realLogin, false);
        assert.equal(evidence.modelRequest, false);
        assert.ok(evidence.checks.includes('fresh logged-out empty thread list over stdio before config mutation'));
        assert.equal(methods.at(-1), 'account/read', 'stdio survives bridge EOF');
      } else {
        assert.equal(methods.includes('config/value/write'), false);
        await assert.rejects(access(join(state, 'verification.json')), { code: 'ENOENT' });
        if (scenario === 'nonempty') assert.match(run.stderr, /Fresh state unexpectedly contains threads/);
        if (['wrong-shape', 'null-response'].includes(scenario)) assert.match(run.stderr, /Invalid fresh thread\/list response/);
      }
    }
    results.push({ scenario, exitCode: run.status, outcome: 'passed' });
  }
  const report = { status: 'passed', platform: process.platform, arch: process.arch, transport: 'mock', nativeEngineVerified: false, results };
  await writeFile(join(output, 'results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
