import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { JsonLinePeer, captureStderr, waitForExit } from './lib/azrael-rpc-check.mjs';
import { checkSocketPath, parseVersion, removeOwnedFixture as removeReceiptedFixture } from './check-shared-engine.mjs';
import sharedHost from './shared-engine-host.cjs';

// Windows only. Usage: node scripts/check-shared-engine-resources.mjs
// <absolute original codex.exe> <absolute frozen azrael.exe> <fresh absolute artifacts resultdir>
// Shared backend only: --shared-only <absolute frozen azrael.exe> <fresh absolute artifacts resultdir>
// No turns, inference, live credentials, Cargo, or changes to installed state.
const ROOT = resolve(import.meta.dirname, '..');
const sleep = ms => new Promise(done => setTimeout(done, ms));
const CONFIG = 'model_provider = "fixture"\n[features]\nresponses_websockets = false\n[model_providers.fixture]\nname = "resource fixture"\nbase_url = "http://127.0.0.1:9/v1"\nwire_api = "responses"\nrequires_openai_auth = false\n';
export function validateInputs(baseline, candidate, output, { sharedOnly = false } = {}) {
  for (const path of sharedOnly ? [candidate, output] : [baseline, candidate, output]) assert(path && isAbsolute(path), 'absolute_inputs_required');
  if (!sharedOnly) assert.notEqual(resolve(baseline).toLowerCase(), resolve(candidate).toLowerCase(), 'distinct_engines_required');
  const within = relative(join(ROOT, 'artifacts'), resolve(output));
  assert(within && !within.startsWith('..') && !isAbsolute(within), 'results_must_be_under_project_artifacts');
}
export function isolatedEnvironment(home) {
  const env = { ...process.env, CODEX_HOME: home };
  for (const key of Object.keys(env)) if (/^(AZRAEL_EX_|CODEX_|OPENAI_|ANTHROPIC_|GEMINI_|GOOGLE_API_KEY$)/i.test(key)) delete env[key];
  env.CODEX_HOME = home;
  return env;
}
export function summarize(samples) {
  assert(samples.length >= 2, 'repeated_samples_required');
  const fields = ['privateBytes', 'workingSetBytes', 'peakWorkingSetBytes', 'peakPagedBytes', 'cpuMs'];
  for (const sample of samples) {
    assert(sample.processes.length >= 2, 'all_engine_processes_required');
    for (const process of sample.processes) for (const field of fields)
      assert(Number.isFinite(process[field]) && process[field] >= 0, `invalid_resource_metric:${field}`);
  }
  return Object.fromEntries(fields.map(field => {
    const totals = samples.map(sample => sample.processes.reduce((sum, item) => sum + item[field], 0));
    const ordered = [...totals].sort((a, b) => a - b);
    return [field, { min: ordered[0], median: ordered[Math.floor(ordered.length / 2)], max: ordered.at(-1) }];
  }));
}
async function command(exe, args, env, description) {
  const child = spawn(exe, args, { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = ''; child.stdout.on('data', bytes => { stdout += bytes; });
  const stderr = captureStderr(child);
  const exit = await waitForExit(child, description);
  assert.equal(exit.code, 0, `${description}:${stderr()}`);
  return stdout;
}
async function identity(exe, env) {
  const path = await realpath(exe), info = await stat(path);
  assert(info.isFile(), 'engine_file_required');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return { path, sizeBytes: info.size, sha256: hash.digest('hex'),
    version: parseVersion(await command(path, ['--version'], env, 'engine version')) };
}
async function sample(entries) {
  const raw = await command('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '$ErrorActionPreference = "Stop"; $rows = @(); ' +
    'foreach ($entry in (ConvertFrom-Json $env:AZRAEL_RESOURCE_PIDS)) { ' +
    '$p = Get-Process -Id $entry.pid -ErrorAction Stop; $p.Refresh(); ' +
    'if ($p.Path -ine $entry.path) { throw "executable identity mismatch" }; ' +
    '$rows += [pscustomobject]@{pid=$p.Id;role=$entry.role;path=$p.Path;' +
    'startedUtc=$p.StartTime.ToUniversalTime().ToString("o");privateBytes=$p.PrivateMemorySize64;' +
    'workingSetBytes=$p.WorkingSet64;peakWorkingSetBytes=$p.PeakWorkingSet64;' +
    'peakPagedBytes=$p.PeakPagedMemorySize64;cpuMs=$p.TotalProcessorTime.TotalMilliseconds} }; ' +
    'ConvertTo-Json -InputObject $rows -Compress'],
  { ...process.env, AZRAEL_RESOURCE_PIDS: JSON.stringify(entries) }, 'resource sample');
  const processes = JSON.parse(raw);
  assert.equal(processes.length, entries.length);
  return { atUtc: new Date().toISOString(), processes };
}
async function close(child, description) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.stdin.end();
  const exit = await waitForExit(child, description, 30_000);
  assert.equal(exit.code, 0, description);
}
async function until(check, description) {
  const deadline = Date.now() + 55_000;
  while (Date.now() < deadline) { if (await check()) return; await sleep(150); }
  throw new Error(`timeout:${description}`);
}
function alive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}
async function removeOwnedFixture(run, nonce, roots, output, pids) {
  assert.equal(await realpath(run), run, 'fixture_realpath_mismatch');
  const receipt = JSON.parse(await readFile(join(run, 'fixture-owner.json'), 'utf8'));
  assert.equal(receipt.root, run); assert.equal(receipt.nonce, nonce);
  // Separate fresh receipted roots keep generated clone cleanup within the
  // existing helper's exact h/.tmp path contract, without broadening its patterns.
  for (const root of roots) {
    const inside = relative(run, root);
    assert(inside && !inside.startsWith('..') && !isAbsolute(inside), 'nested_fixture_must_be_owned');
    await removeReceiptedFixture(root, nonce, { output, pids });
  }
  await removeReceiptedFixture(run, nonce, { output, pids });
  await assert.rejects(access(run), { code: 'ENOENT' });
}

export async function runResources(baseline, candidate, output, { sharedOnly = false } = {}) {
  assert.equal(process.platform, 'win32', 'Windows_only_fixture');
  validateInputs(baseline, candidate, output, { sharedOnly });
  const nonce = randomBytes(8).toString('hex');
  const run = resolve(tmpdir(), `br-${nonce.slice(0, 8)}`);
  checkSocketPath(join(run, 's', 'h'));
  await Promise.all((sharedOnly ? [candidate] : [baseline, candidate]).map(path => access(path)));
  // Existing result directories and state are never reused.
  await mkdir(output); await mkdir(run);
  await writeFile(join(run, 'fixture-owner.json'), JSON.stringify({ schema: 1, root: run, nonce }));
  const report = { schema: 1, status: 'failed', nonce, fixtureRoot: run, resultDirectory: resolve(output),
    executionMode: sharedOnly ? 'shared-only' : 'comparison', backendCount: sharedOnly ? 1 : undefined,
    platform: process.platform, arch: process.arch, nodeVersion: process.version,
    startedUtc: new Date().toISOString(), workload: 'two idle loaded persistent threads, gpt-5.2/gpt-5.1, two cwd; no turns',
    modelRequests: false, liveAuthentication: false, excluded: 'two identical fixture Node window hosts in each mode; sampler and driver',
    limitations: ['short idle fixture only; no long-session or leak conclusions', 'sequential baseline then shared; OS cache and background load may differ',
      'sum of per-process peaks is not simultaneous peak; peakPagedBytes is Windows peak paged memory, not peak private bytes',
      'reconnect includes spawn, initialize and thread/resume; startup includes thread creation'], modes: [] };
  if (sharedOnly) report.limitations = report.limitations.filter(value =>
    !value.startsWith('sequential baseline') && !value.startsWith('reconnect includes'));
  const children = [], hosts = [], ownedRoots = [];
  report.fixtureOwnerRoots = ownedRoots;
  let daemonPid, sharedHome, failure, cleanupFailure;
  try {
    const env = isolatedEnvironment(join(run, 'version-home'));
    await mkdir(env.CODEX_HOME);
    if (!sharedOnly) report.baseline = await identity(baseline, env);
    report.candidate = await identity(candidate, env);
    for (const mode of sharedOnly ? ['shared'] : ['baseline', 'shared']) {
      const begin = performance.now(), id = mode === 'baseline' ? report.baseline : report.candidate;
      const modeRoot = join(run, mode === 'shared' ? 's' : 'b'); await mkdir(modeRoot);
      const windows = [];
      for (let i = 0; i < 2; i++) {
        const windowRoot = mode === 'shared' ? modeRoot : join(modeRoot, String(i));
        if (mode === 'baseline') await mkdir(windowRoot);
        if (mode === 'baseline' || i === 0) {
          await writeFile(join(windowRoot, 'fixture-owner.json'), JSON.stringify({ schema: 1, root: windowRoot, nonce }));
          ownedRoots.push(windowRoot);
        }
        const cwd = join(windowRoot, `w${i}`), home = join(windowRoot, 'h');
        await mkdir(cwd);
        if (i === 0 || mode === 'baseline') { await mkdir(home); await writeFile(join(home, 'config.toml'), CONFIG); }
        if (mode === 'shared') sharedHome = home;
        const host = spawn(process.execPath, ['-e', 'process.stdin.resume();process.stdin.on("end",()=>process.exit(0));'],
          { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] }); hosts.push(host);
        await new Promise((done, reject) => { host.once('spawn', done); host.once('error', reject); });
        const runtime = { sharedEngine: true, sharedEngineProtocol: 1, engine: id.path, engineSha256: id.sha256, engineVersion: id.version };
        const context = sharedHost.windowContext(runtime, { sessionId: `${nonce}-${i}`, workspacePath: cwd, hostPid: host.pid,
          accountStateFile: join(modeRoot, `account-${i}.json`), accountDefaultFile: null });
        windows.push({ cwd, home, host, context });
      }
      function launch(win) {
        const environment = isolatedEnvironment(win.home);
        if (mode === 'shared') {
          environment.AZRAEL_EX_WINDOW_CONTEXT = JSON.stringify(win.context);
          environment.AZRAEL_EX_ACCOUNT_STATE_FILE = win.context.accountStateFile;
        }
        const child = spawn(id.path, ['-c', 'features.code_mode_host=true', 'app-server', '--analytics-default-enabled'],
          { cwd: win.cwd, env: environment, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
        child.stdin.on('error', () => {});
        const instance = { child, peer: new JsonLinePeer(child, `${mode}-${children.length}`), stderr: captureStderr(child), mode };
        children.push(instance); return instance;
      }
      async function initialize(instance) {
        await instance.peer.request('initialize', { clientInfo: { name: 'azrael-resource-fixture', version: '1.0.0' }, capabilities: { experimentalApi: true } });
        instance.peer.notify('initialized');
      }
      const instances = windows.map(launch);
      await Promise.all(instances.map(initialize));
      const threads = await Promise.all(instances.map(async (instance, i) => {
        const model = i ? 'gpt-5.1' : 'gpt-5.2';
        const result = await instance.peer.request('thread/start', { model, modelProvider: 'fixture', cwd: windows[i].cwd,
          approvalPolicy: 'never', sandbox: 'read-only', ephemeral: false });
        assert.equal(result.model, model); assert.equal(resolve(result.cwd), windows[i].cwd);
        return { id: result.thread.id, model, cwd: windows[i].cwd };
      }));
      const measured = { mode, startupElapsedMs: performance.now() - begin, threads,
        homes: windows.map(win => win.home), excludedHostPids: windows.map(win => win.host.pid), samples: [] };
      report.modes.push(measured);
      const entries = instances.map(instance => ({ pid: instance.child.pid, path: id.path, role: mode === 'shared' ? 'proxy' : 'engine' }));
      if (mode === 'shared') {
        daemonPid = JSON.parse(await readFile(join(sharedHome, 'app-server-daemon', 'daemon.pid'), 'utf8')).pid;
        assert(Number.isInteger(daemonPid) && daemonPid > 0 && alive(daemonPid));
        assert(!entries.some(entry => entry.pid === daemonPid));
        measured.daemonReceipt = JSON.parse(await readFile(join(sharedHome, 'app-server-daemon', 'azrael-selected-engine.json'), 'utf8'));
        assert.equal(measured.daemonReceipt.engineIdentity, id.sha256);
        assert.equal(measured.daemonReceipt.engineVersion, id.version);
        entries.push({ pid: daemonPid, path: id.path, role: 'daemon' });
      }
      await sleep(1000);
      const settleStart = performance.now();
      for (let i = 0; i < 5; i++) {
        const row = await sample(entries); row.elapsedMs = performance.now() - settleStart;
        if (i) assert.deepEqual(row.processes.map(p => [p.pid, p.startedUtc]), measured.samples[0].processes.map(p => [p.pid, p.startedUtc]));
        measured.samples.push(row); if (i < 4) await sleep(400);
      }
      measured.summary = summarize(measured.samples);
      if (mode === 'shared') {
        measured.backendPid = daemonPid; measured.windowCount = windows.length;
        measured.backendSamples = measured.samples.map(row => ({ atUtc: row.atUtc, elapsedMs: row.elapsedMs,
          process: row.processes.find(p => p.role === 'daemon') }));
        measured.proxySamples = measured.samples.map(row => ({ atUtc: row.atUtc, elapsedMs: row.elapsedMs,
          processes: row.processes.filter(p => p.role === 'proxy') }));
      }
      measured.cpuDuringSamplesMs = measured.samples.at(-1).processes.reduce((sum, p, i) =>
        sum + p.cpuMs - measured.samples[0].processes[i].cpuMs, 0);
      measured.sampleIntervalMs = 400; measured.settleBeforeSamplingMs = 1000;
      if (!sharedOnly) {
        // Keep host lease alive while replacing one transport and resuming its same thread.
        await close(instances[0].child, `${mode} first transport`); instances[0].peer.close();
        const reconnectStart = performance.now(), replacement = launch(windows[0]); await initialize(replacement);
        const resumed = await replacement.peer.request('thread/resume', { threadId: threads[0].id });
        assert.equal(resumed.thread.id, threads[0].id);
        measured.reconnectElapsedMs = performance.now() - reconnectStart; measured.reconnectPid = replacement.child.pid;
        if (mode === 'shared') assert.equal(JSON.parse(await readFile(join(sharedHome, 'app-server-daemon', 'daemon.pid'), 'utf8')).pid, daemonPid);
      }
      for (const instance of children.filter(item => item.mode === mode)) { await close(instance.child, `${mode} transport`); instance.peer.close(); }
      for (const win of windows) await close(win.host, `${mode} window host`);
      if (mode === 'shared') await until(() => !alive(daemonPid), 'daemon lease shutdown');
      measured.elapsedMs = performance.now() - begin;
    }
    // Refuse success if executable inputs changed during measurement.
    report.binaryIdentityChecks = [];
    for (const before of [report.baseline, report.candidate].filter(Boolean)) {
      const after = await identity(before.path, env);
      report.binaryIdentityChecks.push({ before, after });
      assert.deepEqual(after, before);
    }
    report.status = 'passed';
  } catch (error) { failure = error; report.error = error.stack; }
  finally {
    try {
      const transportStops = await Promise.allSettled(children.map(async instance => {
        await close(instance.child, 'cleanup transport'); instance.peer.close();
      }));
      const hostStops = await Promise.allSettled(hosts.map(host => close(host, 'cleanup host')));
      if (!daemonPid && sharedHome) {
        try { daemonPid = JSON.parse(await readFile(join(sharedHome, 'app-server-daemon', 'daemon.pid'), 'utf8')).pid; }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      if (daemonPid) { assert(Number.isInteger(daemonPid) && daemonPid > 0); await until(() => !alive(daemonPid), 'cleanup daemon'); }
      const stopFailure = [...transportStops, ...hostStops].find(result => result.status === 'rejected');
      if (stopFailure) throw stopFailure.reason;
      assert(children.every(item => item.child.exitCode !== null || item.child.signalCode !== null));
      assert(hosts.every(host => host.exitCode !== null || host.signalCode !== null));
      const ownedPids = [...children.map(item => item.child.pid), ...hosts.map(host => host.pid), ...(daemonPid ? [daemonPid] : [])];
      await removeOwnedFixture(run, nonce, ownedRoots, output, ownedPids); report.fixtureRemoved = true;
    } catch (error) { cleanupFailure = error; report.cleanupError = error.stack; report.fixtureRemoved = false; report.status = 'failed'; }
    for (let i = 0; i < children.length; i++) await writeFile(join(output, `engine-${i}-stderr.log`), children[i].stderr());
    report.finishedUtc = new Date().toISOString();
    await writeFile(join(output, 'result.json'), JSON.stringify(report, null, 2));
  }
  if (failure || cleanupFailure) throw failure ?? cleanupFailure;
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  assert.equal(process.argv.length, 5, 'usage: baseline.exe candidate.exe results_directory OR --shared-only candidate.exe results_directory');
  const result = process.argv[2] === '--shared-only'
    ? await runResources(undefined, process.argv[3], process.argv[4], { sharedOnly: true })
    : await runResources(...process.argv.slice(2));
  console.log(JSON.stringify({ status: result.status, resultDirectory: result.resultDirectory, fixtureRemoved: result.fixtureRemoved }));
}
