'use strict';
// One-off, fixture-owned measurement. Never submits a conversation or modifies user state.
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { spawn, execFile } = require('node:child_process');
const { beginArtifactRun, trackArtifactChild, finishArtifactRun } = require('../../scripts/artifact-run.cjs');
const lifecycle = require('../../scripts/artifact-lifecycle.cjs');
const ROOT = path.resolve(__dirname, '../..');
const CONTROL = path.join(ROOT, '.u');
const SOURCE = path.join(process.env.USERPROFILE, '.vscode/extensions/azrael-ex-local.azrael-2026.0.11');
const arg = name => process.argv.find(x => x.startsWith('--' + name + '='))?.slice(name.length + 3);
const accelerated = process.argv.includes('--accelerated-idle');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const digest = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const json = p => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
const nativePath = value => value.replace(/^\\\\\?\\/, '');
const inside = (parent, child) => { const r = path.relative(parent, child); return !!r && r !== '..' && !r.startsWith('..' + path.sep) && !path.isAbsolute(r); };
async function port() { const s = net.createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const p = s.address().port; await new Promise(r => s.close(r)); return p; }
async function targets(p) { try { return await (await fetch('http://127.0.0.1:' + p + '/json/list', { signal: AbortSignal.timeout(1500) })).json(); } catch { return []; } }
async function until(check, label, ms = 60000) { const end = Date.now() + ms; do { const v = await check(); if (v) return v; await sleep(300); } while (Date.now() < end); throw Error('timeout:' + label); }
async function connect(url) {
  const ws = new WebSocket(url); await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', j, { once: true }); });
  let next = 0; const pending = new Map(), contexts = [];
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.method === 'Runtime.executionContextCreated') contexts.push(m.params.context); const p = pending.get(m.id); if (p) { pending.delete(m.id); clearTimeout(p.timer); m.error ? p.reject(Error(JSON.stringify(m.error))) : p.resolve(m.result); } });
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++next, timer = setTimeout(() => { pending.delete(id); reject(Error('CDP timeout:' + method)); }, 15000); pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params })); });
  await send('Runtime.enable');
  return { send, contexts, async eval(expression, contextId, awaitPromise = true) { const retained = awaitPromise ? `globalThis.__memoryEvaluation=Promise.resolve((0,eval)(${JSON.stringify(expression)}))` : expression; const r = await send('Runtime.evaluate', { expression: retained, contextId, awaitPromise, returnByValue: true }); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; }, close() { ws.close(); for (const p of pending.values()) clearTimeout(p.timer); } };
}
const PS_SAMPLE = `$ErrorActionPreference='Stop'
$all=@(Get-CimInstance Win32_Process)
$wanted=[System.Collections.Generic.HashSet[int]]::new()
foreach($p in $all){if($p.CommandLine -and $p.CommandLine.Contains($env:MEMORY_FIXTURE_HOME)){[void]$wanted.Add([int]$p.ProcessId)}}
if($env:MEMORY_OBSERVED){foreach($known in (ConvertFrom-Json $env:MEMORY_OBSERVED)){foreach($p in $all){if($p.ProcessId -eq $known.pid -and $p.CreationDate.ToUniversalTime().ToString('o') -eq $known.createdUtc){[void]$wanted.Add([int]$p.ProcessId)}}}}
do {$changed=$false;foreach($p in $all){if($wanted.Contains([int]$p.ParentProcessId) -and $wanted.Add([int]$p.ProcessId)){$changed=$true}}}while($changed)
$rows=@(foreach($p in $all){if($wanted.Contains([int]$p.ProcessId) -and $p.ProcessId -ne $PID){
 $role=if($p.CommandLine -match '--azrael-shared-windows'){'engine'}elseif($p.Name -eq 'Code.exe' -and $p.CommandLine -match '--type=renderer'){'renderer'}elseif($p.Name -eq 'Code.exe' -and $p.CommandLine -match '--type=utility'){'utility'}elseif($p.Name -eq 'Code.exe' -and $p.CommandLine -match '--type=gpu'){'gpu'}elseif($p.Name -eq 'Code.exe'){'code-other'}else{$p.Name}
 [pscustomobject]@{pid=$p.ProcessId;ppid=$p.ParentProcessId;role=$role;name=$p.Name;path=$p.ExecutablePath;createdUtc=$p.CreationDate.ToUniversalTime().ToString('o');privateBytes=[double]$p.PrivatePageCount;workingSetBytes=[double]$p.WorkingSetSize;handles=$p.HandleCount;threads=$p.ThreadCount}
}})
$os=Get-CimInstance Win32_OperatingSystem
[pscustomobject]@{atUtc=[datetime]::UtcNow.ToString('o');freeBytes=[double]$os.FreePhysicalMemory*1024;processes=$rows}|ConvertTo-Json -Depth 4 -Compress`;
async function powershell(script, env) { return new Promise((resolve, reject) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, env: { ...process.env, ...env }, maxBuffer: 2 * 1024 * 1024 }, (e, out, err) => e ? reject(Error(err || String(e))) : resolve(JSON.parse(out)))); }
async function main() {
  assert.equal(process.platform, 'win32'); assert(process.argv.includes('--run'));
  const seed = path.resolve(arg('seed-home') || 'MISSING'), ids = (arg('threads') || '').split(',').filter(Boolean);
  const seedReceipt = json(path.join(ROOT, 'work/DJ-01-azrael-memory-analysis/evidence/native-h8-r8/result.json'));
  assert(seedReceipt.seedReady && seedReceipt.producerStopped && path.resolve(seedReceipt.seedHome) === seed && inside(path.join(ROOT, '.m'), seed) && fs.existsSync(path.join(seed, 'state_5.sqlite')), 'own stopped native seed required');
  assert(ids.length >= 3 && ids.every(x => /^[a-f0-9-]{36}$/.test(x)), 'three own seed thread IDs required');
  const attempt = arg('attempt') || ''; assert(/^\d{0,2}$/.test(attempt), 'short fixture attempt suffix required');
  const home = path.join(CONTROL, 'artifacts', (accelerated ? 'e' : 'd') + attempt);
  assert(!fs.existsSync(home), 'fresh state home required');
  assert(Buffer.byteLength(path.join(home, 'app-server-control', '0'.repeat(24) + '.sock')) < 108);
  const run = beginArtifactRun(CONTROL, { workId: 'DJ-01', owner: 'ui-memory-probe', runId: (accelerated ? 'ui-accelerated' : 'ui-default') + (attempt ? '-' + attempt : '') });
  run.record = lifecycle.recordLifecycle(CONTROL, { ...run.record, expected_revision: run.record.revision, members: [...run.record.members, { path: home, role: 'fixture', generated: true, protection_known: true }] });
  fs.mkdirSync(home);
  const report = { status: 'failed', mode: accelerated ? 'accelerated-idle' : 'default', startedUtc: new Date().toISOString(), lifecycleId: run.lifecycleId, runRoot: run.runRoot, home, seed, threadIds: ids, samples: [], stages: [], modifications: ['fixture state home', 'diagnostic globals in copied host', 'synthetic auth responses; no valid credential', 'fixture thread/resume provider binding'], limitations: ['Windows x64 only', 'synthetic history; no live provider or active jobs', 'other host workloads may contend', 'renderer working sets include shared pages; heaps must not be added across contexts'] };
  let child, host, backend, launchLog = '', clients = [], lastProcesses = [], observedPids = new Map();
  const extension = path.join(home, 'extension'), workspace = path.join(home, 'workspace');
  const save = () => fs.writeFileSync(path.join(run.reports, 'result.json'), JSON.stringify(report, null, 2));
  try {
    const sourceRuntime = path.join(SOURCE, 'out/azrael-runtime.json'); report.sourceManifestHash = digest(sourceRuntime);
    fs.cpSync(SOURCE, extension, { recursive: true });
    // The producer has stopped; copy its immutable SQLite WAL alongside each DB.
    for (const name of fs.readdirSync(seed)) if (name === 'sessions' || /^(state_5|thread_history_1)\.sqlite(-wal)?$/.test(name)) fs.cpSync(path.join(seed, name), path.join(home, name), { recursive: true });
    const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync(path.join(home, 'state_5.sqlite'));
    for (const row of db.prepare('SELECT id,rollout_path FROM threads').all()) {
      const rollout = nativePath(row.rollout_path); assert(inside(seed, rollout));
      const copied = path.join(home, path.relative(seed, rollout)), canonical = copied.replace(/\.\d{3}Z-([a-f0-9-]{36}\.jsonl)$/, '-$1');
      assert(new RegExp('^rollout-\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}-' + row.id + '\\.jsonl$').test(path.basename(canonical)), 'canonical own rollout filename required');
      if (canonical !== copied) { assert(inside(home, copied) && inside(home, canonical) && !fs.existsSync(canonical)); fs.renameSync(copied, canonical); }
      db.prepare('UPDATE threads SET rollout_path=? WHERE id=?').run(canonical, row.id);
    }
    report.modifications.push('canonical rollout basenames in copied fixture; source seed unchanged');
    db.close();
    backend = require('node:http').createServer((req, res) => { report.unexpectedNetworkRequests ??= []; report.unexpectedNetworkRequests.push({ method: req.method, path: req.url }); res.writeHead(503, { 'content-type': 'application/json' }); res.end('{"error":"history-only fixture; inference disabled"}'); });
    await new Promise(r => backend.listen(0, '127.0.0.1', r));
    fs.writeFileSync(path.join(home, 'config.toml'), `model = "gpt-5.2"\nmodel_provider = "openai"\ncli_auth_credentials_store = "file"\nproject_doc_max_bytes = 0\napproval_policy = "never"\nsandbox_mode = "read-only"\n[features]\nresponses_websockets = false\n`);
    fs.mkdirSync(workspace); fs.writeFileSync(path.join(workspace, 'AGENTS.md'), '# Isolated synthetic memory fixture\n');
    fs.writeFileSync(path.join(workspace, 'hidden.txt'), 'Owned memory probe: conversation editors hidden.\n');
    const gitEnv = { ...process.env }; for (const k of Object.keys(gitEnv)) if (/^GIT_/i.test(k)) delete gitEnv[k]; gitEnv.GIT_CONFIG_NOSYSTEM = '1'; gitEnv.GIT_CONFIG_GLOBAL = 'NUL';
    const git = trackArtifactChild(run, spawn('git.exe', ['init', '--quiet', '--template=', workspace], { env: gitEnv, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }));
    let gitError = ''; git.stderr.on('data', b=>gitError+=b); report.gitInitExit = await new Promise((resolve,reject)=>{git.once('error',reject);git.once('close',resolve)}); assert.equal(report.gitInitExit, 0, gitError);
    const runtimePath = path.join(extension, 'out/azrael-runtime.json'), runtime = json(runtimePath); runtime.codexHome = home; delete runtime.localHistory;
    // Disable automatic external CLI account probes in this history-only fixture.
    delete runtime.devinExecutable; delete runtime.devinNative;
    report.modifications.push('external Devin CLI probes omitted from fixture');
    fs.writeFileSync(runtimePath, JSON.stringify(runtime, null, 2));
    const entry = path.join(extension, 'out/extension.js'); let src = fs.readFileSync(entry, 'utf8'); report.sourceHostHash = digest(entry);
    const anchor = 'let tt=new hB(Pe,wt);'; assert.equal(src.split(anchor).length - 1, 1);
    src = src.replace(anchor, 'let tt=globalThis.__memoryUri=new hB(Pe,wt);globalThis.__memoryVscode=Mt;globalThis.__memoryProvider=Pe;');
    const request = 'sendProviderRequest(e,r,n,o,i,s){'; assert.equal(src.split(request).length - 1, 1);
    src = src.replace(request, request + `if(n==='turn/start')throw Error('fixture forbids inference');if(n==='account/read'||n==='getAuthStatus'){let result=n==='account/read'?{account:{type:'apiKey'},requiresOpenaiAuth:false}:{authMethod:'apikey',authToken:null,requiresOpenaiAuth:false};queueMicrotask(()=>this.providers.get(e)?.onResult?.({id:r,result}));return}if(n==='thread/resume')o={...o,model:'gpt-5.2',modelProvider:'openai'};`);
    if (accelerated) { const old = 'delay = 60 * 60 * 1000'; assert.equal(src.split(old).length - 1, 1); src = src.replace(old, 'delay = 5000'); report.modifications.push('copied serialized idle-manager default 1h -> 5s; guards unchanged'); }
    fs.writeFileSync(entry, src); report.instrumentedHostHash = digest(entry);
    for (const name of ['profile', 'shared', 'extensions', 'crashes']) fs.mkdirSync(path.join(home, name));
    fs.mkdirSync(path.join(home, 'profile/User'), { recursive: true });
    fs.writeFileSync(path.join(home, 'profile/User/settings.json'), JSON.stringify({ 'workbench.startupEditor': 'none', 'extensions.autoUpdate': false, 'extensions.autoCheckUpdates': false, 'update.mode': 'none', 'telemetry.telemetryLevel': 'off', 'workbench.editor.enablePreview': false, 'git.openRepositoryInParentFolders': 'never', 'git.autoRepositoryDetection': false }));
    report.modifications.push('valid fixture git root; automatic parent-repository discovery disabled');
    const inspector = await port(), renderer = await port(), env = { ...process.env };
    for (const k of Object.keys(env)) if (/^(AZRAEL_|CODEX_|ELECTRON_|VSCODE_|DEVIN_|OPENCODEX_|NODE_OPTIONS$|NODE_COMPILE_CACHE$)|API_KEY|ACCESS_TOKEN|REFRESH_TOKEN|AUTH_TOKEN|CREDENTIAL/i.test(k)) delete env[k];
    env.CODEX_HOME = home; env.TMP = env.TEMP = path.join(home, 'tmp'); fs.mkdirSync(env.TEMP);
    const code = path.join(process.env.LOCALAPPDATA, 'Programs/Microsoft VS Code/Code.exe');
    child = trackArtifactChild(run, spawn(code, ['--new-window', '--disable-extensions', '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust', '--disable-updates', '--user-data-dir=' + path.join(home, 'profile'), '--shared-data-dir=' + path.join(home, 'shared'), '--extensions-dir=' + path.join(home, 'extensions'), '--extensionDevelopmentPath=' + extension, '--inspect-extensions=' + inspector, '--remote-debugging-port=' + renderer, '--crash-reporter-directory=' + path.join(home, 'crashes'), workspace], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }));
    child.stdout.on('data', b => { launchLog += b; }); child.stderr.on('data', b => { launchLog += b; });
    report.launchPid = child.pid; report.ports = { inspector, renderer }; save();
    const target = await until(async () => { if (child.exitCode !== null) throw Error('Code exited:' + child.exitCode + ':' + launchLog.slice(-1500)); return (await targets(inspector)).find(t => t.webSocketDebuggerUrl); }, 'extension inspector');
    host = await connect(target.webSocketDebuggerUrl); await host.send('Runtime.runIfWaitingForDebugger');
    await until(() => host.eval('!!globalThis.__memoryProvider', undefined, false).catch(()=>false), 'Azrael host activation', 90000);
    report.extensionHostPid = await host.eval('process.pid');
    const sample = async stage => {
      const rows = [];
      for (let i = 0; i < 3; i++) { const row = await powershell(PS_SAMPLE, { MEMORY_FIXTURE_HOME: home }); rows.push(row); lastProcesses = row.processes; for (const p of row.processes) observedPids.set(p.pid, p.createdUtc); assert(row.freeBytes >= 2 * 1024 ** 3, 'stop:system free below2GiB'); if (i < 2) await sleep(500); }
      const ui = await host.eval(`({panels:[...__memoryProvider.editorPanels].map(([p,s])=>({visible:p.visible,active:p.active,ready:s.ready,route:s.initialRoute??null,suspended:__memoryProvider.__azraelIdle?.isSuspended(p.webview)??false})),pendingRequests:__memoryProvider.pendingMcpRequests.size})`);
      const sums = role => rows.map(r => r.processes.filter(p => !role || p.role === role).reduce((s, p) => s + p.privateBytes, 0)).sort((a,b) => a-b)[1];
      const record = { stage, atUtc: new Date().toISOString(), ui, privateBytes: sums(), rendererPrivateBytes: sums('renderer'), utilityPrivateBytes: sums('utility'), enginePrivateBytes: sums('engine'), rows };
      report.samples.push(record); save(); console.log(JSON.stringify({ stage, privateMiB: +(record.privateBytes / 1048576).toFixed(1), rendererPrivateMiB: +(record.rendererPrivateBytes / 1048576).toFixed(1), panels: ui.panels.length, suspended: ui.panels.filter(p=>p.suspended).length }));
      assert(record.privateBytes < 3 * 1024 ** 3, 'stop:UI fixture private above3GiB');
    };
    const inspectViews = async () => {
      const found = [];
      for (const target of (await targets(renderer)).filter(t => t.webSocketDebuggerUrl && ['iframe', 'page'].includes(t.type))) {
        let c; try { c = await connect(target.webSocketDebuggerUrl); clients.push(c); await sleep(80); for (const ctx of c.contexts) { try { const v = await c.eval(`({url:location.href,title:document.title,rows:document.querySelectorAll('[data-turn-key]').length,textLength:document.body?.innerText?.length??0,bodyStart:document.body?.innerText?.slice(0,700)??''})`, ctx.id); found.push({ target: target.id, ...v }); } catch {} } } catch {} finally { if (c) { c.close(); clients = clients.filter(x=>x!==c); } }
      }
      return found;
    };
    await sleep(1500); await sample('activated-no-conversation');
    const panelCount = +(arg('panel-count') || '3'); assert([1,2,3].includes(panelCount));
    const opened = accelerated ? [ids.at(-1)] : ids.slice(0, panelCount);
    for (let i = 0; i < opened.length; i++) {
      await host.eval(`__memoryVscode.commands.executeCommand('vscode.openWith',__memoryVscode.Uri.from({scheme:'azrael-session',authority:'route',path:'/local/${opened[i]}'}),'azrael.conversationEditor',{preview:false})`);
      await until(() => host.eval(`[...__memoryProvider.editorPanels.values()].filter(s=>s.ready).length===${i+1}`), 'native panel ready');
      await sleep(1800); let views; await until(async()=>{views=await inspectViews();report.lastViewInspection=views;save();return views.some(v=>v.rows>0);}, 'native history rows rendered', 60000); report.stages.push({ stage: 'open-' + (i+1), views });
      await sample('open-' + (i+1));
    }
    await host.eval(`(async()=>{const d=await __memoryVscode.workspace.openTextDocument(__memoryVscode.Uri.file(${JSON.stringify(path.join(workspace, 'hidden.txt'))}));await __memoryVscode.window.showTextDocument(d,{preview:false})})()`);
    await sleep(1200); await sample('all-hidden-short');
    await sleep(accelerated ? 8000 : 10000); await sample(accelerated ? 'all-hidden-after-5s-policy' : 'all-hidden-after-10s');
    if (accelerated) {
      report.releaseGate = await host.eval(`__memoryVscode.commands.executeCommand('azrael.canReleaseConversationWebview')`);
      await host.eval(`[...__memoryProvider.editorPanels.keys()][0].reveal()`); await sleep(2500); await sample('revealed-after-release'); report.stages.push({ stage: 'restored', views: await inspectViews() });
    } else {
      await host.eval(`{for(const p of [...__memoryProvider.editorPanels.keys()].slice(1))p.dispose()}void 0`);
      await sleep(2000); await sample('closed-extra-panels'); await sleep(10000); await sample('closed-extra-panels-after-10s');
    }
    await host.eval(`{for(const p of [...__memoryProvider.editorPanels.keys()])p.dispose()}void 0`); await sleep(2500); await sample('closed-all');
    report.status = 'passed'; assert.equal(digest(sourceRuntime), report.sourceManifestHash, 'installed runtime changed');
  } catch (error) { report.error = error.stack; process.exitCode = 1; }
  finally {
    if (host) { try { await host.eval(`globalThis.__memoryVscode.commands.executeCommand('workbench.action.closeWindow');void 0`, undefined, false); report.normalCloseSent = true; } catch (e) { report.closeError = String(e); } }
    if (child && !report.normalCloseSent) {
      try { report.fallbackCloseRequests = await powershell(PS_SAMPLE + `\nforeach($row in $rows){if($row.name -eq 'Code.exe' -and $row.role -eq 'code-other'){[void]([System.Diagnostics.Process]::GetProcessById($row.pid).CloseMainWindow())}}`, { MEMORY_FIXTURE_HOME: home }); } catch (e) { report.fallbackCloseError = String(e); }
    }
    for (const c of clients) c.close(); host?.close();
    if (backend) { backend.closeAllConnections(); await new Promise(r => backend.close(r)); }
    let remaining;
    try {
      await until(async () => { remaining = await powershell(PS_SAMPLE, { MEMORY_FIXTURE_HOME: home, MEMORY_OBSERVED: JSON.stringify([...observedPids].map(([pid,createdUtc])=>({pid,createdUtc}))) }); return remaining.processes.length === 0; }, 'owned profile process exit', 35000);
      report.processesStopped = true;
    } catch (e) { report.processesStopped = false; report.cleanupError = String(e); report.remaining = remaining; process.exitCode = 1; }
    if (child) await until(()=>child.artifactClosed, 'Code close event', 5000).catch(e=>{report.childCloseError=String(e);process.exitCode=1;});
    report.observedProcesses = [...observedPids].map(([pid,createdUtc])=>({pid,createdUtc})); report.launchExitCode = child?.exitCode ?? null; report.finishedUtc = new Date().toISOString(); report.exitCode = process.exitCode || 0;
    fs.writeFileSync(path.join(run.logs, 'code-launch.log'), launchLog); save();
    finishArtifactRun(run, { exitCode: report.exitCode, producerStopped: report.processesStopped === true });
    console.log(JSON.stringify({ status: report.status, exitCode: report.exitCode, runRoot: run.runRoot, lifecycleId: run.lifecycleId, processesStopped: report.processesStopped, error: report.error?.split('\n')[0] }));
  }
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
