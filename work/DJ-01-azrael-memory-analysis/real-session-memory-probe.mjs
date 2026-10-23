// One-off Windows x64 experiment. Explicit --run and client --expose-gc required.
// Copied real paginated histories only: no turns, inference, tool replay or installation.
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, appendFileSync } from 'node:fs';
import { mkdir, readFile, writeFile, appendFile, readdir, access } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { createInterface } from 'node:readline';
import { DatabaseSync } from 'node:sqlite';
import { waitForExit } from '../../scripts/lib/azrael-rpc-check.mjs';
import { parseVersion, checkSocketPath, validateOwnedDaemonReceipt, SHARED_CHECK_STARTUP_ARGS } from '../../scripts/check-shared-engine.mjs';
import { isolatedEnvironment } from '../../scripts/check-shared-engine-resources.mjs';
import sharedHost from '../../scripts/shared-engine-host.cjs';
import artifacts from '../../scripts/artifact-run.cjs';
import lifecycle from '../../scripts/artifact-lifecycle.cjs';
import { createRealHistorySnapshot } from './real-history-snapshot.mjs';

const ROOT = resolve(import.meta.dirname, '../..'), FIXTURE_ROOT = join(ROOT, '.m');
const RELEASE = join(ROOT, 'artifacts/build/b13/artifacts/releases/w11aa');
const ENGINE = join(RELEASE, 'engine/azrael.exe');
const SOURCE_HOME = 'C:/Users/felre/.azrael-ex', RECOMMENDED = '01a1334d-6a69-7821-a164-da04f3cfa71f';
const continuation = process.argv.includes('--continue-B') ? 'B-cumulative-paged' : process.argv.includes('--continue-C') ? 'C-cumulative-full' : null;
const freshMatrix = process.argv.includes('--matrix');
const GIB = 1024 ** 3, LIMITS = { nativePrivateBytes: 4 * GIB, freeBytes: 3 * GIB, driverRssBytes: 2 * GIB };
const sleep = ms => new Promise(done => setTimeout(done, ms));
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const hash = async path => { const h = createHash('sha256'); for await (const c of createReadStream(path)) h.update(c); return h.digest('hex'); };
const inside = (parent, child) => { const plain = child.startsWith('\\\\?\\') ? child.slice(4) : child; const r = relative(parent, resolve(plain)); return r === '' || (!r.startsWith('..') && !isAbsolute(r)); };
const safeMethod = value => /^[a-zA-Z0-9_/-]{1,100}$/.test(value ?? '') ? value : 'other';
const increment = (counts, key) => counts[key] = (counts[key] ?? 0) + 1;
const safeError = error => ({ name: safeMethod(error?.name), code: typeof error?.code === 'number' ? error.code : safeMethod(error?.code ?? 'probe_failure'), ...(error?.snapshotAssertion ? { snapshotAssertion: error.snapshotAssertion.slice(0, 300) } : {}) });
async function until(check, label, timeout = 30000) {
  const end = Date.now() + timeout;
  do { if (await check()) return; await sleep(250); } while (Date.now() < end);
  const error = Error(label); error.code = label; throw error;
}
function fixtureEnvironment(home, temporary, cwd) {
  const env = isolatedEnvironment(home);
  for (const key of Object.keys(env)) if (/TOKEN|SECRET|PASSWORD|CREDENTIAL|API.?KEY|AUTH|PROVIDER|DEVIN|COGNITION|OPENAI|ANTHROPIC|GEMINI|GOOGLE|AZURE|AWS|BEDROCK|VERTEX|DEEPSEEK|MISTRAL|GROQ|TOGETHER|FIREWORKS|OPENROUTER|OLLAMA|HUGGING|HF_|GIT_/i.test(key)) delete env[key];
  Object.assign(env, { CODEX_HOME: home, HOME: home, USERPROFILE: home, APPDATA: join(home, 'AppData/Roaming'),
    LOCALAPPDATA: join(home, 'AppData/Local'), TMP: temporary, TEMP: temporary, TMPDIR: temporary,
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(home, 'empty.gitconfig'), GIT_CONFIG_SYSTEM: join(home, 'empty.gitconfig'),
    GIT_CEILING_DIRECTORIES: cwd, GIT_DISCOVERY_ACROSS_FILESYSTEM: '0', GIT_TERMINAL_PROMPT: '0' });
  return env;
}

// JsonLinePeer wire semantics with a 180s timeout. Notifications are counted and
// discarded in the same callback; every unsolicited server request is denied.
class MetadataPeer {
  constructor(child, counts, errorSink) {
    this.child = child; this.counts = counts; this.nextId = 0; this.pending = new Map();
    this.lines = createInterface({ input: child.stdout });
    this.lines.on('line', line => {
      let message;
      try { message = JSON.parse(line); } catch { this.fail('invalid_json'); return; }
      if (typeof message.method === 'string') {
        const method = safeMethod(message.method);
        if (Object.hasOwn(message, 'id')) {
          increment(counts.deniedServerRequests, method);
          child.stdin.write(JSON.stringify({ id: message.id, error: { code: -32601, message: 'Measurement denies server requests' } }) + '\n');
          this.fail('server_request_denied');
        } else increment(counts.notifications, method);
        return;
      }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id); clearTimeout(pending.timer);
      if (message.error) { errorSink?.(message.error); const error = Error('rpc_failed'); error.code = message.error.code; pending.reject(error); }
      else pending.resolve(message.result);
    });
    child.once('error', () => this.fail('child_error')); child.once('exit', () => this.fail('child_exit'));
  }
  fail(code) { for (const p of this.pending.values()) { clearTimeout(p.timer); const e = Error(code); e.code = code; p.reject(e); } this.pending.clear(); }
  request(method, params) {
    assert(['initialize', 'config/read', 'account/read', 'thread/loaded/list', 'thread/resume', 'thread/read', 'thread/turns/list', 'thread/items/list', 'thread/unsubscribe'].includes(method), 'rpc_allowlist');
    increment(this.counts.requests, method); const start = Date.now();
    return new Promise((resolveRequest, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => { this.pending.delete(id); const e = Error('rpc_timeout'); e.code = 'rpc_timeout'; reject(e); }, 180000);
      this.pending.set(id, { timer, reject, resolve: result => { increment(this.counts.successes, method); this.counts.elapsedMs[method] = (this.counts.elapsedMs[method] ?? 0) + Date.now() - start; resolveRequest(result); } });
      this.child.stdin.write(JSON.stringify({ id, method, params }) + '\n', error => { if (error) this.fail('stdin_error'); });
    }).catch(error => { increment(this.counts.failures, method); throw error; });
  }
  initialized() { this.child.stdin.write('{"method":"initialized"}\n'); }
  close() { this.fail('peer_closed'); this.lines.close(); }
}

// Roots must match PID, executable and generation. Previously seen descendants
// remain tracked after reparenting. Command lines are never emitted.
const CIM_BODY = `$all=@(Get-CimInstance Win32_Process)
$selected=@{}
foreach($p in $all){
 $key=[string]$p.ProcessId;$creation=$p.CreationDate.ToUniversalTime().ToFileTimeUtc().ToString()
 foreach($r in $roots){if($p.ProcessId -eq $r.pid -and $p.ExecutablePath -ieq $r.path){$rootProcess=Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue;if($rootProcess -and (!$r.creation -or $rootProcess.StartTime.ToUniversalTime().ToFileTimeUtc().ToString() -eq $r.creation)){$selected[$key]=$p}}}
 if($known.ContainsKey($key) -and $known[$key] -eq $creation){$selected[$key]=$p}
}
do{$changed=$false;foreach($p in $all){if(!$selected.ContainsKey([string]$p.ProcessId) -and $selected.ContainsKey([string]$p.ParentProcessId)){$selected[[string]$p.ProcessId]=$p;$changed=$true}}}while($changed)
$rows=@(foreach($p in $selected.Values){
 $exact=Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue;if(!$exact){continue}
 if($exact.Path -ine $p.ExecutablePath){throw 'snapshot generation changed'}
 $known[[string]$p.ProcessId]=$p.CreationDate.ToUniversalTime().ToFileTimeUtc().ToString()
 [pscustomobject]@{pid=[int]$p.ProcessId;ppid=[int]$p.ParentProcessId;path=$p.ExecutablePath;creation=$known[[string]$p.ProcessId];preciseCreation=$exact.StartTime.ToUniversalTime().ToFileTimeUtc().ToString();privateBytes=[double]$p.PrivatePageCount;workingSetBytes=[double]$p.WorkingSetSize;threads=[int]$p.ThreadCount;handles=[int]$p.HandleCount;cpuMs=([double]$p.KernelModeTime+[double]$p.UserModeTime)/10000}
})
$os=Get-CimInstance Win32_OperatingSystem
$free=[double]$os.FreePhysicalMemory*1024`;
const SNAPSHOT = `$ErrorActionPreference='Stop'
$roots=ConvertFrom-Json $env:AZRAEL_PROBE_ROOTS
$known=@{};foreach($k in (ConvertFrom-Json $env:AZRAEL_PROBE_IDENTITIES)){$known[[string]$k.pid]=$k.creation}
${CIM_BODY}
@{processes=$rows;freeBytes=$free}|ConvertTo-Json -Depth 5 -Compress`;
const CONTINUOUS = `$ErrorActionPreference='Stop'
$roots=ConvertFrom-Json $env:AZRAEL_PROBE_ROOTS
$known=@{}
$writer=[System.IO.StreamWriter]::new($env:AZRAEL_PROBE_OUTPUT,$false,[System.Text.UTF8Encoding]::new($false))
try {while(!(Test-Path -LiteralPath $env:AZRAEL_PROBE_STOP)) {
 $begin=[DateTime]::UtcNow
 ${CIM_BODY}
 $private=0.0;$working=0.0;foreach($p in $rows){$private+=$p.privateBytes;$working+=$p.workingSetBytes}
 $driver=Get-Process -Id ([int]$env:AZRAEL_PROBE_DRIVER) -ErrorAction Stop
 if($driver.StartTime.ToUniversalTime().ToFileTimeUtc().ToString() -ne $env:AZRAEL_PROBE_DRIVER_CREATION){throw 'driver generation changed'}
 $crossed=($private -gt 4294967296 -or $free -lt 3221225472 -or $driver.WorkingSet64 -gt 2147483648)
 $row=@{atUtc=$begin.ToString('o');elapsedMs=([DateTime]::UtcNow-$begin).TotalMilliseconds;privateBytes=$private;workingSetBytes=$working;freeBytes=$free;driverRssBytes=$driver.WorkingSet64;driverPrivateBytes=$driver.PrivateMemorySize64;processCount=$rows.Count;guardCrossed=$crossed}
 $writer.WriteLine(($row|ConvertTo-Json -Compress));$writer.Flush()
 if($crossed -and !(Test-Path -LiteralPath $env:AZRAEL_PROBE_GUARD)){[System.IO.File]::WriteAllText($env:AZRAEL_PROBE_GUARD,($row|ConvertTo-Json -Compress))}
 Start-Sleep -Milliseconds 250
}} finally {$writer.Dispose()}`;

function summarizeThread(result) {
  const turns = result.thread?.turns ?? [], byItemType = {}; let itemCount = 0, itemBytes = 0;
  for (const turn of turns) for (const item of turn.items ?? []) { itemCount++; itemBytes += Buffer.byteLength(JSON.stringify(item)); increment(byItemType, safeMethod(item.type)); }
  return { responseBytes: Buffer.byteLength(JSON.stringify(result)), turnCount: turns.length, itemCount, itemBytes, byItemType };
}
async function projectionCounts(home, threads) {
  const databases = [];
  try {
    for (const name of await readdir(home)) if (/\.sqlite$/.test(name)) {
      const db = new DatabaseSync(join(home, name), { readOnly: true });
      databases.push({ db, tables: new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name)) });
    }
    const state = databases.find(d => d.tables.has('threads'))?.db;
    const history = databases.find(d => d.tables.has('thread_turns') && d.tables.has('thread_items'))?.db;
    assert(state && history, 'owned_projection_databases_required');
    return threads.map(thread => {
      const row = state.prepare('SELECT history_mode, rollout_path FROM threads WHERE id=?').get(thread.id);
      assert(row && row.history_mode === 'paginated', 'copied_paginated_history_required');
      assert(inside(home, row.rollout_path), 'state_rollout_path_must_remain_owned');
      return { id: thread.id, historyMode: row.history_mode,
        projection: history.prepare('SELECT * FROM thread_history_projection_state WHERE thread_id=?').get(thread.id),
        turnCount: history.prepare('SELECT count(*) AS n FROM thread_turns WHERE thread_id=?').get(thread.id).n,
        itemCount: history.prepare('SELECT count(*) AS n FROM thread_items WHERE thread_id=?').get(thread.id).n };
    });
  } finally { for (const { db } of databases) db.close(); }
}

async function main() {
  assert.deepEqual(process.argv.slice(2), freshMatrix ? ['--run', '--matrix'] : continuation ? ['--run', continuation === 'B-cumulative-paged' ? '--continue-B' : '--continue-C'] : ['--run'], 'explicit_run_selection_required');
  assert.equal(process.platform, 'win32'); assert.equal(process.arch, 'x64'); assert(typeof global.gc === 'function', 'launch_driver_with_expose_gc');
  const info = await json(join(RELEASE, 'build-info.json')), identities = {};
  for (const name of ['azrael.exe', 'azrael-bridge.exe', 'azrael-code-mode-host.exe']) {
    identities[name] = await hash(join(RELEASE, 'engine', name)); assert.equal(identities[name], info.engineProvenance.binaries[name].toLowerCase(), 'immutable_engine_hash');
  }
  const control = await json(join(FIXTURE_ROOT, 'project-maintenance.json'));
  assert.equal(control.project_id, 'azrael-memory-fixture-short'); assert(control.managed_roots.includes('artifacts'));
  const home = join(FIXTURE_ROOT, freshMatrix ? 'artifacts/p16' : 'artifacts/p12');
  const runId = freshMatrix ? 'real-history-r16' : continuation === 'B-cumulative-paged' ? 'real-history-r14' : continuation ? 'real-history-r15' : 'real-history-r12';
  if (continuation) {
    const prior = await json(join(FIXTURE_ROOT, 'artifacts/tasks/DJ-01/runs/real-history-r12/reports/report.json'));
    assert.equal(prior.producerStopped, true, 'snapshot_owner_stopped');
    assert.equal(prior.home, home, 'continued_snapshot_identity');
  }
  const run = artifacts.beginArtifactRun(FIXTURE_ROOT, { workId: 'DJ-01', runId, owner: 'real-session-memory-probe', references: continuation ? [{ id: 'run:DJ-01:real-history-r12', reason: 'Reuse stopped real-history snapshot for remaining isolated comparison', kind: 'execution' }] : [] });
  if (!continuation) run.record = lifecycle.recordLifecycle(FIXTURE_ROOT, { ...run.record, members: [...run.record.members,
    { path: home, role: 'profile', generated: true, protection_known: true }], expected_revision: run.record.revision });
  run.producerStopped = false;
  const cwd = join(run.runRoot, 'workspace');
  const report = { schema: 1, lifecycleId: run.lifecycleId, startedUtc: new Date().toISOString(), status: 'running', home, cwd,
    platform: process.platform, arch: process.arch, release: RELEASE, identities,
    driverSha256: await hash(import.meta.filename), snapshotHelperSha256: await hash(join(import.meta.dirname, 'real-history-snapshot.mjs')),
    limits: LIMITS, modes: [], childOutcomes: [],
    scope: 'Copied real paginated history; resume/read/unsubscribe only; no inference or tool replay',
    limitations: ['Windows x64 only; no leak conclusion from one experiment', 'Polling cannot measure every transient peak',
      'Continuous interval is CIM execution time plus 250ms; per-observation elapsedMs is retained',
      'Native cap excludes driver and sampler; driver RSS has its own cap', 'Cases B/C reuse the profile after A; native resume may append owned rollouts',
      'Local primary UI uses excludeTurns when paginated history and tail hydration are enabled; current runtime flag value is not established',
      'Reading every item page is an aggressive API comparison; this does not establish that the UI eagerly reads the complete transcript',
      'Full reads are explicit compatibility/stress cases, not an assertion of the default UI behavior',
      'Count differences are reported exactly; no legacy conversion or fabrication', 'No RPC/error/stderr bodies are retained in reports; native private logs remain inside the owned profile'] };
  const persist = async () => writeFile(join(run.reports, 'report.json'), JSON.stringify(report, null, 2));
  const modes = []; let stage = 'prepare', failure;
  const tracked = (child, kind) => { artifacts.trackArtifactChild(run, child); child.once('close', (exitCode, signal) => report.childOutcomes.push({ kind, pid: child.pid ?? null, exitCode, signal, closed: true })); return child; };
  const command = async (exe, argv, env, label) => {
    const child = tracked(spawn(exe, argv, { env, cwd: run.temporary, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }), label);
    let output = ''; child.stdout.on('data', data => { output += data; }); child.stderr.on('data', () => {});
    const outcome = await waitForExit(child, label, 30000); await until(() => child.artifactClosed, 'command_close'); assert.equal(outcome.code, 0, label); return output;
  };
  const env = fixtureEnvironment(home, run.temporary, cwd);
  const observe = async mode => {
    const roots = mode.backend ? [{ pid: mode.backend.pid, path: ENGINE, creation: mode.backend.processStartTime }] : [];
    for (const p of mode.proxies) if (!p.child.artifactClosed) roots.push({ pid: p.child.pid, path: ENGINE, creation: mode.connectorGenerations.get(p.child.pid) });
    const sample = JSON.parse(await command('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', SNAPSHOT], {
      ...env, AZRAEL_PROBE_IDENTITIES: JSON.stringify([...mode.seen.values()]), AZRAEL_PROBE_ROOTS: JSON.stringify(roots) }, 'CIM_sample'));
    sample.atUtc = new Date().toISOString();
    for (const p of sample.processes) {
      mode.seen.set(`${p.pid}:${p.creation}`, { pid: p.pid, creation: p.creation });
      if (mode.backend?.pid === p.pid) { assert.equal(p.preciseCreation, mode.backend.processStartTime, 'backend_generation'); p.role = 'backend'; }
      else if (mode.proxies.some(proxy => proxy.child.pid === p.pid)) { p.role = 'connector'; mode.connectorGenerations.set(p.pid, p.preciseCreation); }
      else p.role = 'descendant';
    }
    return sample;
  };
  const closeChild = async child => { if (!child.artifactClosed) { child.stdin?.end(); await waitForExit(child, 'owned_input_close', 30000); await until(() => child.artifactClosed, 'owned_close_event'); } };
  const closeOwners = async mode => {
    const errors = [];
    for (const proxy of mode.proxies) { try { await closeChild(proxy.child); } catch (e) { errors.push(safeError(e)); } proxy.peer.close(); }
    for (const host of mode.hosts) try { await closeChild(host); } catch (e) { errors.push(safeError(e)); }
    if (errors.length) { mode.result.ownerCloseErrors = errors; throw Error('owner_close_failed'); }
  };
  const loadBackend = async mode => {
    const directory = join(home, 'app-server-daemon/engines', mode.endpoint.instanceId);
    const record = await json(join(directory, 'azrael.pid')), receipt = await json(join(directory, 'azrael-selected-engine.json'));
    validateOwnedDaemonReceipt(receipt, record, { endpoint: mode.endpoint, engineIdentity: identities['azrael.exe'], engineVersion: report.engineVersion });
    mode.backend = record; mode.result.backend = { pid: record.pid, processStartTime: record.processStartTime, engineIdentity: identities['azrael.exe'] }; await observe(mode);
  };
  const stopSampler = async mode => {
    if (mode.sampler) {
      mode.samplerStopping = true; clearInterval(mode.guardTimer); await writeFile(mode.stopFile, 'stop');
      mode.result.samplerExit = await waitForExit(mode.sampler, 'sampler_stop', 30000); await until(() => mode.sampler.artifactClosed, 'sampler_close');
      assert.equal(mode.result.samplerExit.code, 0, 'continuous_sampler_exit');
    }
  };
  const stopMode = async mode => {
    const errors = [];
    if (mode.endpoint && !mode.backend && mode.proxies.length) try { await loadBackend(mode); } catch (e) { errors.push(safeError(e)); }
    try { await closeOwners(mode); } catch (e) { errors.push(safeError(e)); }
    if (mode.stderrFlush) try { await mode.stderrFlush; } catch (e) { errors.push(safeError(e)); }
    if (mode.guardClosing) try { await mode.guardClosing; } catch (e) { errors.push(safeError(e)); }
    if (mode.backend) {
      try { await until(async () => { const sample = await observe(mode); mode.result.finalSample = sample; return sample.processes.length === 0; }, 'owned_tree_stop'); mode.stopped = true; }
      catch (e) { errors.push(safeError(e)); }
    } else mode.stopped = mode.proxies.length === 0 && mode.hosts.every(child => child.artifactClosed);
    try { await stopSampler(mode); } catch (e) { errors.push(safeError(e)); }
    mode.result.stopped = Boolean(mode.stopped); mode.result.observedIdentities = [...mode.seen.values()];
    if (errors.length) { mode.result.stopErrors = errors; throw Error('stop_unconfirmed'); }
  };
  const checkGuard = mode => {
    if (mode.guardCrossed) { const e = Error('resource_guard'); e.code = 'resource_guard'; throw e; }
    if (Object.keys(mode.counts.deniedServerRequests).length) throw Error('server_request_denied');
    if (mode.sampler?.artifactClosed) throw Error('continuous_sampler_unexpected_exit');
  };
  const checkpoint = async (mode, label, extra = {}) => {
    global.gc(); // Measurement client only; never force engine collection.
    checkGuard(mode); const loaded = await mode.peer.request('thread/loaded/list', {}), samples = [];
    for (let i = 0; i < 3; i++) {
      const sample = await observe(mode), driver = process.memoryUsage();
      const numeric = { atUtc: sample.atUtc, freeBytes: sample.freeBytes, privateBytes: sample.processes.reduce((n, p) => n + p.privateBytes, 0),
        workingSetBytes: sample.processes.reduce((n, p) => n + p.workingSetBytes, 0), processCount: sample.processes.length, driverRssBytes: driver.rss, driverHeapUsedBytes: driver.heapUsed };
      samples.push(numeric); await appendFile(join(run.reports, 'samples.jsonl'), JSON.stringify({ mode: mode.name, label, ...numeric }) + '\n');
      if (numeric.freeBytes < LIMITS.freeBytes || numeric.privateBytes > LIMITS.nativePrivateBytes || driver.rss > LIMITS.driverRssBytes) { mode.guardCrossed = true; throw Error('resource_guard'); }
      if (i < 2) await sleep(500);
    }
    const median = field => samples.map(s => s[field]).sort((a, b) => a - b)[1];
    mode.result.checkpoints.push({ label, loadedCount: loaded.data.length, ...extra, samples, medianPrivateBytes: median('privateBytes'), medianWorkingSetBytes: median('workingSetBytes'), medianDriverRssBytes: median('driverRssBytes') });
    await persist(); checkGuard(mode); console.log(JSON.stringify({ checkpoint: `${mode.name}:${label}`, loadedCount: loaded.data.length }));
  };
  const startSampler = async mode => {
    const sample = await observe(mode);
    const driverCreation = (await command('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${process.pid}).StartTime.ToUniversalTime().ToFileTimeUtc().ToString()`], env, 'driver_identity')).trim();
    mode.stopFile = join(run.temporary, `${mode.name}-sampler.stop`);
    const guardFile = join(run.reports, `${mode.name}-guard.json`), output = join(run.reports, `${mode.name}-continuous.jsonl`);
    mode.result.continuousSamples = output;
    const roots = sample.processes.filter(p => p.role === 'backend' || p.role === 'connector').map(p => ({ pid: p.pid, path: p.path, creation: p.preciseCreation }));
    mode.sampler = tracked(spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', CONTINUOUS], { cwd: run.temporary,
      env: { ...env, AZRAEL_PROBE_ROOTS: JSON.stringify(roots), AZRAEL_PROBE_OUTPUT: output, AZRAEL_PROBE_STOP: mode.stopFile, AZRAEL_PROBE_GUARD: guardFile,
        AZRAEL_PROBE_DRIVER: String(process.pid), AZRAEL_PROBE_DRIVER_CREATION: driverCreation }, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] }), `${mode.name}-sampler`);
    mode.sampler.stderr.on('data', data => { mode.result.samplerStderrBytes = (mode.result.samplerStderrBytes ?? 0) + data.length; });
    const abortOwned = code => {
      mode.guardCrossed = true;
      for (const p of mode.proxies) p.peer.fail(code);
      mode.guardClosing ??= closeOwners(mode); mode.guardClosing.catch(() => {});
    };
    mode.sampler.once('error', () => { mode.result.samplerFailed = true; abortOwned('sampler_error'); });
    mode.sampler.once('exit', () => { if (!mode.samplerStopping) { mode.result.samplerFailed = true; abortOwned('sampler_unexpected_exit'); } });
    let checking = false;
    mode.guardTimer = setInterval(async () => {
      if (checking || mode.guardCrossed) return; checking = true;
      try { await access(guardFile); mode.result.resourceGuard = await json(guardFile); abortOwned('resource_guard');
      } catch (error) { if (error.code !== 'ENOENT') { mode.result.guardMonitorError = safeError(error); abortOwned('guard_monitor_error'); } }
      finally { checking = false; }
    }, 250);
    await until(async () => { try { await access(output); return true; } catch { assert(!mode.sampler.artifactClosed, 'sampler_start'); return false; } }, 'sampler_ready');
  };
  try {
    if (!continuation) { await mkdir(home); await writeFile(join(home, 'empty.gitconfig'), '', { flag: 'wx' }); }
    await mkdir(cwd);
    const template = join(run.temporary, 'git-template'); await mkdir(template);
    await command('git', ['init', '--quiet', '--template=' + template, cwd], env, 'own_git_boundary'); stage = 'snapshot';
    const snapshot = continuation ? await json(join(FIXTURE_ROOT, 'artifacts/tasks/DJ-01/runs/real-history-r12/reports/snapshot-manifest.json')) : await createRealHistorySnapshot({ sourceHome: SOURCE_HOME, home, cwd, recommendedId: RECOMMENDED, maxThreads: 6 });
    const threads = snapshot.threads; assert.equal(threads.length, 6, 'six_snapshot_threads_required'); assert.equal(threads[0].id, RECOMMENDED, 'recommended_first');
    report.snapshot = { threads: threads.map(({ id, rolloutPath, rolloutBytes, turnCount, itemCount, itemBytes, byItemType, projection, copy, rollout }) => ({ id, rolloutPath, rolloutBytes, turnCount, itemCount, itemBytes, byItemType, projection, copy, rollout })),
      sourcePolicy: snapshot.sourcePolicy, alterations: snapshot.alterations, aggregate: snapshot.aggregate };
    await writeFile(join(run.reports, 'snapshot-manifest.json'), JSON.stringify(report.snapshot, null, 2));
    report.initialProjection = await projectionCounts(home, threads);
    if (!continuation) for (let i = 0; i < threads.length; i++) { assert.equal(report.initialProjection[i].turnCount, threads[i].turnCount, 'snapshot_turn_count'); assert.equal(report.initialProjection[i].itemCount, threads[i].itemCount, 'snapshot_item_count'); }
    if (!continuation) await writeFile(join(home, 'config.toml'), 'model_provider = "openai"\nproject_doc_max_bytes = 0\n[features]\nresponses_websockets = false\n[mcp_servers]\n', { flag: 'wx' });
    report.engineVersion = parseVersion(await command(ENGINE, ['--version'], env, 'version')); await persist();
    for (const name of freshMatrix ? ['D-fresh-matrix'] : continuation ? [continuation] : ['A-recommended', 'B-cumulative-paged', 'C-cumulative-full']) {
      stage = name;
      const result = { name, status: 'running', checkpoints: [], reads: [], pagedReads: [], resumed: [], stderrBytes: 0 };
      const counts = { requests: {}, successes: {}, failures: {}, elapsedMs: {}, notifications: {}, deniedServerRequests: {} };
      result.rpc = counts; report.modes.push(result);
      const mode = { name, result, counts, hosts: [], proxies: [], seen: new Map(), connectorGenerations: new Map(), stopped: false }; modes.push(mode);
      const runtime = { engine: ENGINE, engineSha256: identities['azrael.exe'], engineVersion: report.engineVersion, sharedEngine: true, sharedEngineProtocol: 2, env };
      mode.endpoint = await sharedHost.resolveEngineEndpoint(runtime, { execFile: (exe, _args, options, cb) => tracked(execFile(exe, [...SHARED_CHECK_STARTUP_ARGS, '--azrael-engine-endpoint'], { ...options, cwd }, cb), `${name}-endpoint`) });
      checkSocketPath(mode.endpoint.socketPath);
      for (let i = 0; i < 2; i++) {
        const host = tracked(spawn(process.execPath, ['-e', 'process.stdin.resume();process.stdin.on("end",()=>process.exit(0))'], { cwd, env, windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] }), `${name}-host-${i}`);
        mode.hosts.push(host); await new Promise((done, reject) => { host.once('spawn', done); host.once('error', reject); });
        const context = sharedHost.windowContext(runtime, { sessionId: randomUUID(), workspacePath: cwd, hostPid: host.pid, accountStateFile: join(home, `${runId}-${name}-account-${i}.json`), accountDefaultFile: null });
        const child = tracked(spawn(ENGINE, SHARED_CHECK_STARTUP_ARGS, { cwd, env: { ...env, AZRAEL_EX_WINDOW_CONTEXT: JSON.stringify(context), AZRAEL_EX_ACCOUNT_STATE_FILE: context.accountStateFile }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }), `${name}-connector-${i}`);
        child.stdin.on('error', () => {}); child.stderr.on('data', data => {
          result.stderrBytes += data.length;
          // Private diagnostic remains in the owned profile and is deleted with it.
          mode.stderrFlush = (mode.stderrFlush ?? Promise.resolve()).then(() => appendFile(join(home, `${runId}-${name}-connector-${i}.stderr`), data));
        });
        const peer = new MetadataPeer(child, counts, error => appendFileSync(join(home, `${runId}-rpc-errors.private.jsonl`), JSON.stringify(error) + '\n')); mode.proxies.push({ child, peer });
        await peer.request('initialize', { clientInfo: { name: 'real-history-memory-probe', version: '1.0.0' }, capabilities: { experimentalApi: true } }); peer.initialized();
      }
      mode.peer = mode.proxies[0].peer; await loadBackend(mode); await startSampler(mode);
      {
        const config = await mode.peer.request('config/read', { includeLayers: false });
        assert.equal(config.config.project_doc_max_bytes, 0); assert.equal(config.config.model_provider, 'openai'); assert.equal(Object.keys(config.config.mcp_servers ?? {}).length, 0, 'no_MCP_servers');
        assert.equal((await mode.peer.request('account/read', { refreshToken: false })).account, null, 'no_account');
      }
      result.isolationVerified = true; result.beforeProjection = await projectionCounts(home, threads); await checkpoint(mode, 'baseline');
      const resume = async thread => {
        stage = `${name}:resume:${thread.id}`;
        checkGuard(mode);
        const resumed = await mode.peer.request('thread/resume', { threadId: thread.id, cwd, modelProvider: 'openai', model: 'gpt-5.2', approvalPolicy: 'never', sandbox: 'read-only', excludeTurns: true });
        assert.equal(resumed.thread.id, thread.id); assert.equal(resumed.thread.turns.length, 0, 'excludeTurns');
        if (resumed.thread.path) assert(inside(home, resumed.thread.path), 'resume_rollout_owned'); result.resumed.push(thread.id);
      };
      const fullRead = async (thread, label) => {
        stage = `${name}:full-read:${thread.id}:${label}`;
        checkGuard(mode); const started = Date.now();
        const summary = summarizeThread(await mode.peer.request('thread/read', { threadId: thread.id, includeTurns: true }));
        const evidence = { id: thread.id, label, kind: 'compatibility-stress', ...summary, comparison: { turnDelta: summary.turnCount - thread.turnCount, itemDelta: summary.itemCount - thread.itemCount }, elapsedMs: Date.now() - started };
        result.reads.push(evidence); return evidence;
      };
      const pagedRead = async (thread, label) => {
        stage = `${name}:paged-read:${thread.id}:${label}`;
        const evidence = { id: thread.id, label, pageCount: 0, itemCount: 0, responseBytes: 0 }, started = Date.now(); let cursor;
        do {
          checkGuard(mode);
          const page = await mode.peer.request('thread/items/list', { threadId: thread.id, ...(cursor ? { cursor } : {}), limit: 100, sortDirection: 'desc' });
          assert(page.data.length <= 100, 'item_page_limit'); evidence.pageCount++; evidence.itemCount += page.data.length; evidence.responseBytes += Buffer.byteLength(JSON.stringify(page));
          const next = page.nextCursor; assert(!next || next !== cursor, 'pagination_must_advance'); cursor = next;
          if (evidence.pageCount % 25 === 0) global.gc();
        } while (cursor);
        evidence.itemDelta = evidence.itemCount - thread.itemCount; evidence.elapsedMs = Date.now() - started; result.pagedReads.push(evidence); return evidence;
      };
      const selected = name === 'A-recommended' ? threads.slice(0, 1) : threads;
      if (name === 'A-recommended') {
        await resume(selected[0]); await checkpoint(mode, 'excludeTurns-resume-1');
        {
          const metadata = await mode.peer.request('thread/read', { threadId: selected[0].id, includeTurns: false }); assert.equal(metadata.thread.turns.length, 0, 'metadata_only');
          const page = await mode.peer.request('thread/turns/list', { threadId: selected[0].id, limit: 1, sortDirection: 'desc', itemsView: 'notLoaded' });
          result.firstPage = { responseBytes: Buffer.byteLength(JSON.stringify(page)), turnCount: page.data.length, hasNextCursor: Boolean(page.nextCursor) };
        }
        await checkpoint(mode, 'latest-turn-page-1');
        await pagedRead(selected[0], 'thread-items-all-desc-100'); await checkpoint(mode, 'paged-all-items');
        for (let i = 1; i <= 3; i++) { const summary = await fullRead(selected[0], `full-read-${i}`); await checkpoint(mode, `full-read-${i}`, { read: summary }); }
        result.plateauDeltas = result.checkpoints.filter(c => /^full-read-/.test(c.label)).map((c, i, all) => ({ label: c.label, privateDeltaFromFirst: c.medianPrivateBytes - all[0].medianPrivateBytes, driverRssDeltaFromFirst: c.medianDriverRssBytes - all[0].medianDriverRssBytes }));
      } else {
        let count = 0;
        for (const target of [1, 2, 4, 6]) {
          const previous = count;
          while (count < target) await resume(selected[count++]); await checkpoint(mode, `excludeTurns-resume-${target}`);
          if (name === 'B-cumulative-paged' || name === 'D-fresh-matrix') {
            for (const thread of selected.slice(previous, target)) await pagedRead(thread, `cumulative-${target}`);
            await checkpoint(mode, `paged-items-${target}`);
          } else {
            for (const thread of selected.slice(previous, target)) await fullRead(thread, `cumulative-${target}`);
            await checkpoint(mode, `full-read-${target}`);
          }
        }
        if (name === 'D-fresh-matrix') {
          for (let i = 0; i < selected.length; i++) {
            const summary = await fullRead(selected[i], `six-loaded-full-read-${i + 1}`);
            await checkpoint(mode, `six-loaded-full-read-${i + 1}`, { read: summary });
          }
        }
      }
      result.afterProjection = await projectionCounts(home, threads);
      stage = `${name}:unsubscribe`;
      for (const thread of selected) { const response = await mode.peer.request('thread/unsubscribe', { threadId: thread.id }); (result.unsubscribed ??= []).push({ id: thread.id, status: safeMethod(response.status) }); }
      const unsubscribedAt = Date.now();
      while (Date.now() - unsubscribedAt < 90000) { checkGuard(mode); await sleep(Math.max(1, Math.min(500, 90000 - (Date.now() - unsubscribedAt)))); }
      await checkpoint(mode, 'unsubscribed-90s', { elapsedSinceUnsubscribeMs: Date.now() - unsubscribedAt, ownersAlive: mode.hosts.every(child => !child.artifactClosed) });
      result.loadedZeroAfter90s = result.checkpoints.at(-1).loadedCount === 0; await stopMode(mode); result.status = 'complete'; await persist();
    }
    report.status = 'complete';
  } catch (error) { failure = error; report.status = 'failed'; report.failure = { stage, ...safeError(error) }; }
  finally {
    for (const mode of modes) if (!mode.stopped || mode.sampler && !mode.sampler.artifactClosed) try { await stopMode(mode); } catch (error) { failure ??= error; (report.cleanupErrors ??= []).push(safeError(error)); }
    report.producerStopped = modes.every(mode => mode.stopped) && [...run.children].every(child => child.artifactClosed); report.endedUtc = new Date().toISOString();
    if (!report.producerStopped) { report.status = 'failed'; failure ??= Error('producer_stop_unconfirmed'); }
    for (const mode of modes) if (mode.result.status !== 'complete') mode.result.status = 'failed';
    run.producerStopped = report.producerStopped; await persist();
    await writeFile(join(run.reports, 'result.json'), JSON.stringify({ lifecycleId: run.lifecycleId, status: report.status, producerStopped: report.producerStopped, startedUtc: report.startedUtc, endedUtc: report.endedUtc, report: join(run.reports, 'report.json') }, null, 2));
    artifacts.finishArtifactRun(run, { exitCode: report.status === 'complete' ? 0 : 1, producerStopped: run.producerStopped });
    console.log(JSON.stringify({ status: report.status, producerStopped: report.producerStopped, reports: run.reports, lifecycleId: run.lifecycleId }));
  }
  if (failure) { const error = Error('real_history_probe_failed'); error.code = 'real_history_probe_failed'; throw error; }
}
main().catch(error => { console.error(JSON.stringify({ status: 'failed', ...safeError(error) })); process.exitCode = 1; });
