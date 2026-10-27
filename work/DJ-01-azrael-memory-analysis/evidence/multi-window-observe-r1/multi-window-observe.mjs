import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import artifacts from '../../scripts/artifact-run.cjs';
const root = resolve('.m');
const run = artifacts.beginArtifactRun(root, { workId: 'DJ-01', runId: 'multi-window-observe-r1', owner: 'multi-window-memory-observation' });
let succeeded = false;
const children = [];
async function command(executable, args, extraEnv = {}) {
  const child = artifacts.trackArtifactChild(run, spawn(executable, args, {
    env: { ...process.env, ...extraEnv }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
  }));
  let output = '', error = '';
  child.stdout.on('data', b => { output += b; }); child.stderr.on('data', b => { error += b; });
  const code = await new Promise((done, reject) => { child.once('error', reject); child.once('close', done); });
  children.push({ pid: child.pid, exitCode: code, closed: child.artifactClosed });
  if (code !== 0) throw Error('read-only observation command failed');
  return output;
}
try {
  const codeRoot = join(process.env.LOCALAPPDATA, 'Programs/Microsoft VS Code');
  const cliScript = (await readFile(join(codeRoot, 'bin/code.cmd'), 'utf8')).match(/"%~dp0\.\.\\([^"\r\n]+cli\.js)"/)[1];
  const rawStatus = await command(join(codeRoot, 'Code.exe'), [join(codeRoot, cliScript), '--status'], { ELECTRON_RUN_AS_NODE: '1', VSCODE_DEV: '' });
  const section = rawStatus.split('CPU %')[1]?.split('Workspace Stats:')[0]; assert(section);
  const roles = {};
  for (const line of section.split(/\r?\n/)) {
    const m = line.match(/^\s*\d+\s+[\d.]+\s+(\d+)\s+(.+)$/); if (!m) continue;
    const pid = m[1], label = m[2].trim(), window = label.match(/^window \[(\d+)\]/), host = label.match(/^extension-host \[(\d+)\]/);
    if (window) roles[pid] = { role: 'workspace-window', windowId: Number(window[1]) };
    else if (host) roles[pid] = { role: 'extension-host', windowId: Number(host[1]) };
    else if (label === 'window') roles[pid] = { role: 'unnamed-window-renderer' };
  }
  const script = `$ErrorActionPreference='Stop'
$all=@(Get-CimInstance Win32_Process)
$selected=@{};$excluded=@{([string]$env:AZRAEL_MEMORY_PROBE_PID)=$true;([string]$PID)=$true}
do{$changed=$false;foreach($p in $all){if(!$excluded.ContainsKey([string]$p.ProcessId) -and $excluded.ContainsKey([string]$p.ParentProcessId)){$excluded[[string]$p.ProcessId]=$true;$changed=$true}}}while($changed)
foreach($p in $all){if(!$excluded.ContainsKey([string]$p.ProcessId) -and ($p.Name -eq 'Code.exe' -or ($p.Name -eq 'azrael.exe' -and $p.CommandLine -match '--azrael-shared-windows'))){$selected[[string]$p.ProcessId]=$true}}
do{$changed=$false;foreach($p in $all){if(!$excluded.ContainsKey([string]$p.ProcessId) -and !$selected.ContainsKey([string]$p.ProcessId) -and $selected.ContainsKey([string]$p.ParentProcessId)){$selected[[string]$p.ProcessId]=$true;$changed=$true}}}while($changed)
$rows=@(foreach($p in $all){if($selected.ContainsKey([string]$p.ProcessId)){
 $role=if($p.Name -eq 'Code.exe'){'code-other'}elseif($p.Name -eq 'azrael.exe' -and $p.CommandLine -match '--azrael-shared-windows'){'azrael-shared-engine'}elseif($p.Name -eq 'azrael.exe' -and $p.CommandLine -match 'app-server --analytics-default-enabled'){'azrael-connector'}elseif($p.Name -eq 'azrael-bridge.exe'){'azrael-bridge'}else{'other-descendant'}
 [pscustomobject]@{pid=[int]$p.ProcessId;ppid=[int]$p.ParentProcessId;name=$p.Name;creation=$p.CreationDate.ToUniversalTime().ToFileTimeUtc().ToString();role=$role;privateBytes=[double]$p.PrivatePageCount;workingSetBytes=[double]$p.WorkingSetSize}
}})
$os=Get-CimInstance Win32_OperatingSystem
@{atUtc=[DateTime]::UtcNow.ToString('o');freeBytes=[double]$os.FreePhysicalMemory*1024;processes=$rows}|ConvertTo-Json -Depth 5 -Compress`;
  const samples = [];
  for (let i = 0; i < 3; i++) {
    const sample = JSON.parse(await command('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { AZRAEL_MEMORY_PROBE_PID: String(process.pid) }));
    for (const row of sample.processes) if (row.name === 'Code.exe' && roles[row.pid]) Object.assign(row, roles[row.pid]);
    samples.push(sample); if (i < 2) await new Promise(done => setTimeout(done, 10000));
  }
  const categories = [...new Set(samples.flatMap(s => s.processes.map(p => p.role)))].map(role => {
    const values = samples.map(s => s.processes.filter(p => p.role === role));
    const median = field => values.map(rows => rows.reduce((n, p) => n + p[field], 0)).sort((a, b) => a - b)[1];
    return { role, counts: values.map(rows => rows.length), privateMiB: median('privateBytes') / 1048576, workingSetMiB: median('workingSetBytes') / 1048576 };
  });
  const report = { status: 'complete', scope: 'Read-only live observation; no app launch, close, UI input, account or profile writes',
    codeVersion: rawStatus.match(/Version:\s+Code ([^\r\n]+)/)?.[1], samples, categories,
    limitations: ['Not a controlled 1/2/4-window experiment; other work is active', 'All Code processes include other extensions; unnamed renderers are not attributed to Azrael',
      'Window roles are from one CLI status snapshot; process identities and counts retained per sample', 'Private Bytes is commit; summed Working Set double-counts shared pages',
      'Probe and its descendants excluded; no titles, command lines or user content retained', 'Managed isolated GUI stage3 unavailable: child-session-admission'] };
  await writeFile(join(run.reports, 'report.json'), JSON.stringify(report, null, 2));
  await writeFile(join(run.reports, 'result.json'), JSON.stringify({ status: report.status, children }, null, 2));
  console.log(JSON.stringify({ codeVersion: report.codeVersion, categories, reports: run.reports }));
  succeeded = true;
} finally { artifacts.finishArtifactRun(run, { exitCode: succeeded ? 0 : 1, producerStopped: [...run.children].every(c => c.artifactClosed) }); }
