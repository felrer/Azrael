// One-off Windows x64 experiment. No build, install, user profile, or fixture deletion.
// --run: no-turn matrices. --history/--history-large: offline replay.
// --retention: delayed unload. Fresh outputs are required for every selection.
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { JsonLinePeer, waitForExit } from '../../scripts/lib/azrael-rpc-check.mjs';
import { parseVersion, checkSocketPath, validateOwnedDaemonReceipt, SHARED_CHECK_STARTUP_ARGS } from '../../scripts/check-shared-engine.mjs';
import { isolatedEnvironment } from '../../scripts/check-shared-engine-resources.mjs';
import sharedHost from '../../scripts/shared-engine-host.cjs';
import artifacts from '../../scripts/artifact-run.cjs';
import lifecycle from '../../scripts/artifact-lifecycle.cjs';

const ROOT = resolve(import.meta.dirname, '../..');
const FIXTURE_ROOT = join(ROOT, '.m');
const RELEASE = join(ROOT, 'artifacts/build/b13/artifacts/releases/w11aa');
const ENGINE = join(RELEASE, 'engine/azrael.exe');
const CODEHOST = join(RELEASE, 'engine/azrael-code-mode-host.exe');
const MCPNODE = join(RELEASE, 'computer-use/node.exe');
const REPL = join(RELEASE, 'computer-use/node_repl.exe');
const MCPSCRIPT = join(RELEASE, 'window-control/window-control-mcp.cjs');
const sleep = ms => new Promise(done => setTimeout(done, ms));
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const hash = async path => { const h = createHash('sha256'); for await (const c of createReadStream(path)) h.update(c); return h.digest('hex'); };
const samePath = (a, b) => typeof a === 'string' && resolve(a).toLowerCase() === resolve(b).toLowerCase();
const psQuote = value => `'${value.replaceAll("'", "''")}'`;
async function until(check, label, timeout = 30000) {
  const end = Date.now() + timeout;
  do { if (await check()) return; await sleep(250); } while (Date.now() < end);
  throw Error(`timeout:${label}`);
}

// A single CIM process snapshot per observation; command lines never leave PowerShell.
const SNAPSHOT = `$ErrorActionPreference='Stop'
$all=@(Get-CimInstance Win32_Process)
$known=ConvertFrom-Json $env:AZRAEL_PROBE_IDENTITIES
$roots=ConvertFrom-Json $env:AZRAEL_PROBE_ROOTS
$selected=@{}
foreach($p in $all){foreach($r in $roots){if($p.ProcessId -eq $r.pid -and $p.ExecutablePath -ieq $r.path){$selected[[string]$p.ProcessId]=$p}};foreach($k in $known){if($p.ProcessId -eq $k.pid -and $p.CreationDate.ToUniversalTime().ToFileTimeUtc().ToString() -eq $k.creation){$selected[[string]$p.ProcessId]=$p}}}
do{$changed=$false;foreach($p in $all){if(!$selected.ContainsKey([string]$p.ProcessId) -and $selected.ContainsKey([string]$p.ParentProcessId)){$selected[[string]$p.ProcessId]=$p;$changed=$true}}}while($changed)
$rows=@(foreach($p in $selected.Values){$exact=Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue;if(!$exact){continue};if($exact.Path -ine $p.ExecutablePath){throw 'process identity changed during snapshot'};$role='descendant';if($p.ExecutablePath -ieq $env:AZRAEL_PROBE_ENGINE){$role='engine'};if($p.ExecutablePath -ieq $env:AZRAEL_PROBE_CODEHOST){$role='codehost'};if($p.ExecutablePath -ieq $env:AZRAEL_PROBE_REPL -and $p.CommandLine.Trim() -match '(?:node_repl.exe"?)$'){$role='mcp-node-repl'};if($p.ExecutablePath -ieq $env:AZRAEL_PROBE_MCPNODE -and $p.CommandLine.Contains($env:AZRAEL_PROBE_MCPSCRIPT)){$role='mcp-window-control'};[pscustomobject]@{pid=[int]$p.ProcessId;ppid=[int]$p.ParentProcessId;path=$p.ExecutablePath;creation=$p.CreationDate.ToUniversalTime().ToFileTimeUtc().ToString();preciseCreation=$exact.StartTime.ToUniversalTime().ToFileTimeUtc().ToString();role=$role;privateBytes=[double]$p.PrivatePageCount;workingSetBytes=[double]$p.WorkingSetSize;threads=[int]$p.ThreadCount;handles=[int]$p.HandleCount;cpuMs=([double]$p.KernelModeTime+[double]$p.UserModeTime)/10000}})
$os=Get-CimInstance Win32_OperatingSystem
@{processes=$rows;freeBytes=([double]$os.FreePhysicalMemory*1024)}|ConvertTo-Json -Depth 5 -Compress`;

async function main() {
  const args = process.argv.slice(2);
  assert(args.length === 1 && ['--run', '--history', '--history-large', '--retention'].includes(args[0]), 'Explicit experiment selection required');
  const historyLargeOnly = args[0] === '--history-large';
  const historyOnly = args[0] === '--history' || historyLargeOnly;
  const retentionOnly = args[0] === '--retention';
  assert.equal(process.platform, 'win32'); assert.equal(process.arch, 'x64');
  const info = await json(join(RELEASE, 'build-info.json'));
  const identities = {};
  for (const name of ['azrael.exe', 'azrael-bridge.exe', 'azrael-code-mode-host.exe']) {
    const actual = await hash(join(RELEASE, 'engine', name));
    assert.equal(actual, info.engineProvenance.binaries[name].toLowerCase(), `immutable hash:${name}`);
    identities[name] = actual;
  }
  // This independent fixture project owns only its generated subtree. Its
  // catalog does not read, modify, or wait on the primary workspace catalog.
  const control = await json(join(FIXTURE_ROOT, 'project-maintenance.json'));
  assert.equal(control.project_id, 'azrael-memory-fixture-short', 'parent-prepared fixture control root required');
  let run;
  const report = { schema: 1, fixtureRoot: FIXTURE_ROOT, lifecycleIds: [], startedUtc: new Date().toISOString(), release: RELEASE,
    frozenSource: join(ROOT, 'artifacts/build/b13/engine'), identities, platform: process.platform, arch: process.arch,
    scope: historyOnly ? 'Offline authored history load/read/subscriber-removal; no inference or live turns'
      : retentionOnly ? 'One MCP pair root across the default60s delayed-unload threshold' : 'No-turn root/MCP matrices',
    status: 'running', modes: [], limitations: ['One-off synthetic measurement; no leak conclusion', 'Root event queue sizes unknown: no exposed metric',
      'No real MCP tool calls, capture, OS input, external provider, or credentials', 'Slow-consumer scenario not selected',
      'Unsubscribe removes subscription; idle runtime unload is delayed (native default60s); 30s observations precede that default',
      'History replay is authored native JSONL, not inference-generated or transient streaming memory',
      'CIM snapshots are observations, not continuous peak measurements; driver/sampler/mock host overhead excluded from test private limit'] };
  let failure;
  const modes = [];
  report.childOutcomes = [];
  const tracked = (child, kind, ownedRun = run) => {
    artifacts.trackArtifactChild(ownedRun, child);
    child.once('close', (exitCode, signal) => report.childOutcomes.push({ lifecycleId: ownedRun.lifecycleId, kind, pid: child.pid ?? null, exitCode, signal, closed: true }));
    return child;
  };
  const command = async (exe, args, env, label, cwd = run.temporary, ownedRun = run) => {
    const c = tracked(spawn(exe, args, { env, cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }), label, ownedRun);
    let out = '', err = ''; c.stdout.on('data', b => out += b); c.stderr.on('data', b => err += b);
    const exit = await waitForExit(c, label, 30000); await until(() => c.artifactClosed, `${label}:close`);
    assert.equal(exit.code, 0, `${label}:${err}`); return out;
  };
  const observe = async mode => {
    const roots = mode.backend ? [{ pid: mode.backend.pid, path: ENGINE }] : [];
    for (const p of mode.proxies) if (!p.child.artifactClosed) roots.push({ pid: p.child.pid, path: ENGINE });
    const env = { ...isolatedEnvironment(mode.home), AZRAEL_PROBE_IDENTITIES: JSON.stringify([...mode.seen.values()]),
      AZRAEL_PROBE_ROOTS: JSON.stringify(roots), AZRAEL_PROBE_ENGINE: ENGINE, AZRAEL_PROBE_CODEHOST: CODEHOST,
      AZRAEL_PROBE_MCPNODE: MCPNODE, AZRAEL_PROBE_REPL: REPL, AZRAEL_PROBE_MCPSCRIPT: MCPSCRIPT };
    const sample = JSON.parse(await command('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', SNAPSHOT], env, 'CIM sample', mode.run.temporary, mode.run));
    sample.atUtc = new Date().toISOString();
    for (const p of sample.processes) {
      mode.seen.set(`${p.pid}:${p.creation}`, { pid: p.pid, creation: p.creation });
      if (mode.backend?.pid === p.pid) {
        assert(samePath(p.path, ENGINE)); assert.equal(p.preciseCreation, mode.backend.processStartTime, 'backend generation identity'); p.role = 'backend';
      } else if (mode.proxies.some(proxy => proxy.child.pid === p.pid)) p.role = 'connector';
    }
    return sample;
  };
  const checkpoint = async (mode, label, extra = {}) => {
    const start = Date.now(), samples = [];
    const loaded = await mode.peer.request('thread/loaded/list', {});
    for (let i = 0; i < 3; i++) {
      const sample = await observe(mode); samples.push(sample);
      await appendFile(join(mode.run.reports, 'samples.jsonl'), JSON.stringify({ mode: mode.name, label, ...sample }) + '\n');
      const privateBytes = sample.processes.reduce((sum, p) => sum + p.privateBytes, 0);
      if (sample.freeBytes < 2 * 1024 ** 3 || privateBytes > 2 * 1024 ** 3) throw Error(`resource_growth_stop:${mode.name}:${label}`);
      if (i < 2) await sleep(500);
    }
    mode.result.checkpoints.push({ label, loadedCount: loaded.data.length, elapsedMs: Date.now() - start, ...extra,
      samples: samples.map(s => ({ atUtc: s.atUtc, freeBytes: s.freeBytes, privateBytes: s.processes.reduce((n, p) => n + p.privateBytes, 0),
        processCount: s.processes.length, mcpCount: s.processes.filter(p => p.role.startsWith('mcp-')).length })) });
    await writeFile(join(mode.run.reports, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ checkpoint: `${mode.name}:${label}`, loaded: loaded.data.length }));
  };
  const closeChild = async c => {
    if (!c.artifactClosed) { c.stdin?.end(); await waitForExit(c, 'owned input close', 30000); await until(() => c.artifactClosed, 'owned close event'); }
  };
  const stopMode = async mode => {
    const errors = [];
    for (const p of mode.proxies) { try { await closeChild(p.child); p.peer.close(); } catch (e) { errors.push(String(e)); } }
    for (const host of mode.hosts) { try { await closeChild(host); } catch (e) { errors.push(String(e)); } }
    // Recover receipts on startup failures too; never infer stop from a missing parent alone.
    if (mode.endpoint && !mode.backend && mode.proxies.length > 0) {
      try { await loadBackend(mode); } catch (e) { errors.push(`backend identity unavailable:${e}`); }
    }
    if (mode.backend) {
      try {
        await until(async () => { const s = await observe(mode); mode.result.finalSample = s; return s.processes.length === 0; }, 'backend and observed descendant exit');
        mode.stopped = true;
      } catch (e) { errors.push(String(e)); }
    } else mode.stopped = mode.proxies.length === 0;
    mode.result.stopped = mode.stopped;
    mode.result.children = [...mode.proxies.map(p => p.child), ...mode.hosts].map(c => ({ pid: c.pid, exitCode: c.exitCode, signal: c.signalCode, closed: c.artifactClosed }));
    if (errors.length) { mode.result.cleanupErrors = errors; throw Error(errors.join(';')); }
  };
  const loadBackend = async mode => {
    const dir = join(mode.home, 'app-server-daemon/engines', mode.endpoint.instanceId);
    const record = await json(join(dir, 'azrael.pid')), receipt = await json(join(dir, 'azrael-selected-engine.json'));
    validateOwnedDaemonReceipt(receipt, record, { endpoint: mode.endpoint, engineIdentity: identities['azrael.exe'], engineVersion: report.engineVersion });
    mode.backend = record; mode.result.backend = { ...record, receipt };
    await observe(mode);
  };
  try {
    const cases = historyLargeOnly ? [{ name: 'history', homeName: 'g64', runId: 'native-h64-r10', historyTurns: 64 }]
      : historyOnly ? [1, 2, 4, 8].map(historyTurns => ({ name: 'history', homeName: `c8${historyTurns}`, runId: `native-h${historyTurns}-r8`, historyTurns }))
      : retentionOnly ? [{ name: 'mcp-pair', homeName: 'f9', runId: 'native-retention-r9' }]
      : ['no-mcp', 'mcp-pair'].map((name, index) => ({ name, homeName: `${'ab'[index]}7`, runId: `native-${'ab'[index]}-r7` }));
    for (const experiment of cases) {
      const { name, historyTurns } = experiment, home = join(FIXTURE_ROOT, 'artifacts', experiment.homeName);
      assert(control.managed_roots.includes('artifacts'), 'parent must prepare managed artifact root');
      run = artifacts.beginArtifactRun(FIXTURE_ROOT, { workId: 'DJ-01', runId: experiment.runId, owner: 'native-memory-probe', references: [] });
      run.record = lifecycle.recordLifecycle(FIXTURE_ROOT, { ...run.record, members: [...run.record.members,
        { path: home, role: 'profile', generated: true, protection_known: true }], expected_revision: run.record.revision });
      run.producerStopped = false; report.lifecycleIds.push(run.lifecycleId);
      const cwd = join(run.runRoot, 'workspace');
      const result = { name, historyTurns, lifecycleId: run.lifecycleId, reports: run.reports, status: 'running', home, cwd, startedUtc: new Date().toISOString(), checkpoints: [] };
      const mode = { name, run, home, cwd, hosts: [], proxies: [], seen: new Map(), result, threads: [] };
      modes.push(mode); report.modes.push(result);
      await mkdir(home); await mkdir(cwd);
      assert.equal(await command('git', ['init', '--quiet', cwd], isolatedEnvironment(home), 'own project boundary'), '');
      let config = `model_provider = "openai"\nproject_doc_max_bytes = 0\n[features]\nresponses_websockets = false\n`;
      if (name === 'mcp-pair') config += `\n[mcp_servers.window_probe]\ncommand = ${JSON.stringify(MCPNODE)}\nargs = [${JSON.stringify(MCPSCRIPT)}]\nstartup_timeout_sec = 30\n[mcp_servers.repl_probe]\ncommand = ${JSON.stringify(REPL)}\nargs = []\nstartup_timeout_sec = 30\n`;
      await writeFile(join(home, 'config.toml'), config, { flag: 'wx' });
      const env = isolatedEnvironment(home);
      env.TMP = run.temporary; env.TEMP = run.temporary;
      if (!report.engineVersion) report.engineVersion = parseVersion(await command(ENGINE, ['--version'], env, 'version'));
      const runtime = { engine: ENGINE, engineSha256: identities['azrael.exe'], engineVersion: report.engineVersion, sharedEngine: true, sharedEngineProtocol: 2, env };
      mode.endpoint = await sharedHost.resolveEngineEndpoint(runtime, { execFile: (exe, _args, options, cb) => tracked(execFile(exe,
        [...SHARED_CHECK_STARTUP_ARGS, '--azrael-engine-endpoint'], { ...options, cwd }, cb), 'endpoint-discovery') });
      checkSocketPath(mode.endpoint.socketPath);
      for (let w = 0; w < 2; w++) {
        const host = tracked(spawn(process.execPath, ['-e', 'process.stdin.resume();process.stdin.on("end",()=>process.exit(0))'], { cwd, env, windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] }), `mock-host-${w}`);
        mode.hosts.push(host); host.stderr.pipe(createWriteStream(join(run.logs, `${name}-host-${w}.stderr.log`)));
        await new Promise((done, reject) => { host.once('spawn', done); host.once('error', reject); });
        const context = sharedHost.windowContext(runtime, { sessionId: randomUUID(), workspacePath: cwd, hostPid: host.pid, accountStateFile: join(home, `account-${w}.json`), accountDefaultFile: null });
        const child = tracked(spawn(ENGINE, SHARED_CHECK_STARTUP_ARGS, { cwd, env: { ...env, AZRAEL_EX_WINDOW_CONTEXT: JSON.stringify(context), AZRAEL_EX_ACCOUNT_STATE_FILE: context.accountStateFile }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }), `connector-${w}`);
        child.stdin.on('error', () => {}); child.stderr.pipe(createWriteStream(join(run.logs, `${name}-connector-${w}.stderr.log`)));
        const peer = new JsonLinePeer(child, `${name}-${w}`); mode.proxies.push({ child, peer });
        await peer.request('initialize', { clientInfo: { name: 'memory-probe', version: '1.0.0' }, capabilities: { experimentalApi: true } }); peer.notify('initialized');
      }
      mode.peer = mode.proxies[0].peer;
      await loadBackend(mode); await sleep(1000);
      const configRead = await mode.peer.request('config/read', { includeLayers: false });
      assert.equal(configRead.config.project_doc_max_bytes, 0, 'instruction discovery isolation');
      assert.equal((await mode.peer.request('account/read', { refreshToken: false })).account, null, 'isolated account');
      result.isolationVerified = true;
      await checkpoint(mode, 'roots-0');
      const startThread = async () => {
        const t = await mode.peer.request('thread/start', { cwd, model: 'gpt-5.2', modelProvider: 'openai', approvalPolicy: 'never', sandbox: 'read-only', ephemeral: false });
        mode.threads.push(t.thread.id);
        if (name === 'mcp-pair') {
          let statuses;
          await until(async () => { statuses = await mode.peer.request('mcpServerStatus/list', { threadId: t.thread.id }); return ['window_probe', 'repl_probe'].every(n => statuses.data.some(s => s.name === n && s.runtimeStatus === 'connected')); }, 'actual MCP pair ready');
          result.lastMcpStatus = statuses.data.map(s => ({ name: s.name, runtimeStatus: s.runtimeStatus, toolCount: Object.keys(s.tools ?? {}).length }));
        }
        return t.thread.id;
      };
      if (name === 'no-mcp') {
        const smokeId = await startThread();
        await checkpoint(mode, 'smoke-root-1');
        const unsubscribed = await mode.peer.request('thread/unsubscribe', { threadId: smokeId });
        await sleep(1000);
        await checkpoint(mode, 'smoke-unsubscribed', { unsubscribeStatus: unsubscribed.status,
          interpretation: 'Subscriber removal does not promise runtime unloading; root remains part of total root count' });
      }
      if (name !== 'history') {
        for (const count of retentionOnly ? [1] : name === 'mcp-pair' ? [1, 5, 10] : [1, 5, 10, 20]) {
          const started = Date.now(); while (mode.threads.length < count) await startThread();
          await checkpoint(mode, `roots-${count}`, { creationElapsedMs: Date.now() - started });
        }
      } else {
        const importReplay = async (turns, bytesPerTurn, kind) => {
          const id = randomUUID(), rows = [], epoch = Math.floor(Date.now() / 1000) - turns * 10;
          const push = (type, payload, second) => rows.push({ timestamp: new Date(second * 1000).toISOString(), ordinal: rows.length, type, payload });
          push('session_meta', { id, session_id: id, timestamp: new Date(epoch * 1000).toISOString(), cwd,
            originator: 'memory-fixture', cli_version: report.engineVersion, source: 'vscode', model_provider: 'openai',
            base_instructions: { text: 'Synthetic offline history; no inference requests.' }, history_mode: 'legacy' }, epoch);
          for (let i = 0; i < turns; i++) {
            const start = epoch + i * 10, turn = randomUUID(), prefix = `Synthetic offline user request ${i + 1}. `;
            const text = prefix + 'x'.repeat(bytesPerTurn - Buffer.byteLength(prefix)), answer = `Synthetic offline answer ${i + 1}.`;
            push('event_msg', { type: 'task_started', turn_id: turn, root_turn_id: turn, started_at: start, model_context_window: 272000 }, start);
            push('response_item', { type: 'message', id: null, role: 'user', content: [{ type: 'input_text', text }] }, start + 1);
            push('event_msg', { type: 'user_message', message: text, images: [], local_images: [], text_elements: [] }, start + 1);
            push('response_item', { type: 'message', id: null, role: 'assistant', content: [{ type: 'output_text', text: answer }] }, start + 2);
            push('event_msg', { type: 'agent_message', message: answer, phase: 'final_answer', memory_citation: null }, start + 2);
            push('event_msg', { type: 'task_complete', turn_id: turn, root_turn_id: turn, started_at: start, completed_at: start + 3,
              duration_ms: 3000, last_agent_message: answer }, start + 3);
          }
          const directory = join(home, 'sessions', ...new Date(epoch * 1000).toISOString().slice(0, 10).split('-'));
          await mkdir(directory, { recursive: true });
          // Native RolloutFileName::parse requires exactly19 timestamp chars,
          // then '-' and the UUID; milliseconds/'Z' invalidate ID-based resume.
          const rollout = join(directory, `rollout-${new Date(epoch * 1000).toISOString().slice(0, 19).replaceAll(':', '-')}-${id}.jsonl`);
          const data = rows.map(row => JSON.stringify(row)).join('\n') + '\n';
          await writeFile(rollout, data, { flag: 'wx' });
          const started = Date.now();
          const resumed = await mode.peer.request('thread/resume', { threadId: id, path: rollout, cwd, model: 'gpt-5.2',
            modelProvider: 'openai', approvalPolicy: 'never', sandbox: 'read-only' });
          assert.equal(resumed.thread.id, id); mode.threads.push(id);
          const read = await mode.peer.request('thread/read', { threadId: id, includeTurns: true });
          assert.equal(read.thread.turns.length, turns, 'authored replay turn count');
          assert(read.thread.turns.every(t => t.status === 'completed'), 'authored replay completed status');
          mode.peer.notifications.length = 0;
          return { id, kind, rollout, completedTurns: turns, userPayloadBytes: turns * bytesPerTurn,
            authoredFileBytes: Buffer.byteLength(data), readResponseBytes: Buffer.byteLength(JSON.stringify(read)), loadReadElapsedMs: Date.now() - started };
        };
        const large = await importReplay(historyTurns, 128 * 1024, 'large-history');
        result.history = large;
        await checkpoint(mode, `authored-turns-${historyTurns}`, large);
        if (historyTurns === 8) {
          const seedThreads = [];
          for (let i = 0; i < 3; i++) seedThreads.push(await importReplay(1, 256, 'small'));
          seedThreads.push(large);
          report.seedHome = home; report.seedThreads = seedThreads; result.seedThreads = seedThreads;
          await checkpoint(mode, 'seed-four-completed', { seedThreadIds: seedThreads.map(t => t.id) });
        }
      }
      const metadataStatus = async threadId => {
        try { const state = await mode.peer.request('thread/read', { threadId, includeTurns: false }); return { threadId, status: state.thread.status }; }
        catch (error) { return { threadId, error: String(error) }; }
      };
      if (retentionOnly) result.beforeUnsubscribeStatus = await metadataStatus(mode.threads[0]);
      result.unsubscribeResponses = [];
      for (const threadId of mode.threads) result.unsubscribeResponses.push({ threadId,
        ...await mode.peer.request('thread/unsubscribe', { threadId }) });
      const unsubscribeAt = Date.now();
      await sleep(30000);
      await checkpoint(mode, 'all-unsubscribed-after-30s', { elapsedSinceUnsubscribeMs: Date.now() - unsubscribeAt,
        interpretation: 'Before native default60s idle/no-subscriber unload delay' });
      if (retentionOnly) {
        result.after30sStatus = await metadataStatus(mode.threads[0]);
        await sleep(Math.max(0, unsubscribeAt + 90000 - Date.now()));
        result.after90sStatus = await metadataStatus(mode.threads[0]);
        await checkpoint(mode, 'all-unsubscribed-after-90s', { elapsedSinceUnsubscribeMs: Date.now() - unsubscribeAt,
          ownersAlive: mode.hosts.every(host => !host.artifactClosed), nativeDefaultUnloadDelaySeconds: 60 });
        const last = result.checkpoints.at(-1);
        result.delayedUnloadObserved = last.loadedCount === 0 && last.samples.every(sample => sample.mcpCount === 0);
      }
      await closeChild(mode.proxies[1].child); mode.proxies[1].peer.close(); await closeChild(mode.hosts[1]);
      await checkpoint(mode, 'second-owner-closed');
      await stopMode(mode); result.endedUtc = new Date().toISOString(); result.status = 'complete';
      console.log(JSON.stringify({ mode: name, stopped: mode.stopped }));
    }
    report.status = 'complete';
  } catch (e) { failure = e; report.status = 'failed'; report.error = e.stack; }
  finally {
    for (const mode of modes) if (!mode.stopped) { try { await stopMode(mode); } catch (e) { failure ??= e; (report.cleanupErrors ??= []).push(String(e)); } }
    report.producerStopped = modes.every(m => m.stopped && [...m.run.children].every(c => c.artifactClosed));
    report.endedUtc = new Date().toISOString();
    if (!report.producerStopped) { report.status = 'failed'; failure ??= Error('owned producer termination unconfirmed'); }
    for (const mode of modes) {
      const ownedRun = mode.run;
      mode.result.observedIdentities = [...mode.seen.values()];
      ownedRun.producerStopped = Boolean(mode.stopped && [...ownedRun.children].every(c => c.artifactClosed));
      if (mode.result.status !== 'complete') mode.result.status = 'failed';
      await writeFile(join(ownedRun.reports, 'report.json'), JSON.stringify(report, null, 2));
      await writeFile(join(ownedRun.reports, 'result.json'), JSON.stringify({ lifecycleId: ownedRun.lifecycleId, lifecycleIds: report.lifecycleIds,
        status: report.status, caseStatus: mode.result.status, producerStopped: report.producerStopped, startedUtc: report.startedUtc, endedUtc: report.endedUtc,
        seedHome: report.seedHome ?? null, threadIds: (report.seedThreads ?? []).map(t => t.id), seedThreads: report.seedThreads ?? [],
        seedReady: Boolean(report.seedHome && report.seedThreads?.length === 4 && modes.find(m => m.result.seedThreads)?.stopped),
        report: join(ownedRun.reports, 'report.json') }, null, 2));
      artifacts.finishArtifactRun(ownedRun, { exitCode: mode.result.status === 'complete' ? 0 : 1, producerStopped: ownedRun.producerStopped });
    }
    console.log(JSON.stringify({ status: report.status, producerStopped: report.producerStopped, reports: modes.map(m => m.run.reports), lifecycleIds: report.lifecycleIds }));
  }
  if (failure) throw failure;
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
