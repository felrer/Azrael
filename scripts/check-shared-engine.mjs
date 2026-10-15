import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { mkdir, readFile, writeFile, access, appendFile } from 'node:fs/promises';
import { isAbsolute, join, resolve, relative, dirname, extname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { JsonLinePeer, captureStderr, waitForExit } from './lib/azrael-rpc-check.mjs';

// Native prerequisite acceptance; --extended adds synthetic loopback turns.
// Usage: node scripts/check-shared-engine.mjs <frozen absolute azrael executable>
//        <new absolute result directory> [--fixture-root <new absolute directory>] [--extended]
//        [--bridge <absolute matching azrael-bridge executable>]
//        [--code-mode-child] (requires --extended and matching sibling code-mode host)
//        [--account-rejoin-state] (requires --extended; read-only real-bridge account continuity)
const ROOT = resolve(import.meta.dirname, '..');
export const RPC_TIMEOUT_MS = 30_000;
const WINDOW_STARTUP_MS = 90_000;
const BRIDGE_STARTUP_MS = 70_000; // Native bridge outer startup is 65s; allow 5s scheduling grace.
export function startupRemaining(startedAt, now = Date.now(), budget = WINDOW_STARTUP_MS) {
  const remaining = budget - (now - startedAt);
  assert(remaining > 0, 'native_fixture_startup_deadline_exhausted');
  return remaining;
}
const digest = value => createHash('sha256').update(value).digest('hex');
const sleep = milliseconds => new Promise(done => setTimeout(done, milliseconds));
export function codeModeChildSource(node, script) {
  assert(isAbsolute(node) && isAbsolute(script), 'absolute_owned_child_paths_required');
  const quote = value => `'${value.replaceAll("'", "''")}'`;
  const command = `& ${quote(node)} ${quote(script)}`;
  return '// @exec: {"yield_time_ms":60000}\n' +
    `const child = await tools.exec_command(${JSON.stringify({ cmd: command, login: false, yield_time_ms: 30000, max_output_tokens: 100 })});\n` +
    'if (!child.session_id) throw new Error("owned child must remain running");\n' +
    'while (true) await tools.write_stdin({session_id:child.session_id,chars:"",yield_time_ms:1000,max_output_tokens:100});';
}
export async function startSharedProvider({ codeModeSource } = {}) {
  const requests = [], errors = [];
  const server = createServer(async (req, res) => {
    try {
      assert.equal(req.method, 'POST'); assert.equal(req.url, '/v1/responses');
      let raw = '';
      for await (const chunk of req) { raw += chunk; assert(raw.length < 4_000_000); }
      const body = JSON.parse(raw);
      const users = (body.input ?? []).filter(item => item.role === 'user');
      const marker = JSON.stringify(users.at(-1)).match(/BJ_MODE:(hold|approval|finish|codechild):([a-z0-9-]+)/);
      assert(marker, 'shared_fixture_user_mode_required');
      const [, mode, token] = marker;
      const callId = `bj-${token}`;
      const answered = body.input.some(item => ['function_call_output', 'custom_tool_call_output'].includes(item.type) && item.call_id === callId);
      requests.push({ mode, token, answered, model: body.model, at: Date.now() });
      const id = `bj-response-${requests.length}`;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const send = value => res.write(`event: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`);
      send({ type: 'response.created', response: { id } });
      let item;
      if (mode === 'finish' || answered) item = { id: `${id}-message`, type: 'message', role: 'assistant',
        content: [{ type: 'output_text', text: `BJ_COMPLETED:${token}` }] };
      else if (mode === 'hold') item = { type: 'function_call', call_id: callId,
        namespace: 'shared_probe', name: 'hold', arguments: '{}' };
      else if (mode === 'codechild') {
        assert(codeModeSource, 'owned_code_mode_source_required');
        item = { type: 'custom_tool_call', call_id: callId, name: 'exec', input: codeModeSource };
      }
      else item = { type: 'function_call', call_id: callId, name: 'exec_command',
        arguments: JSON.stringify({ cmd: "Write-Output 'BJ_APPROVAL_NEVER_EXECUTED'", login: false,
          sandbox_permissions: 'require_escalated', justification: 'Isolated shared-engine approval fixture; deny this command.' }) };
      send({ type: 'response.output_item.done', item });
      send({ type: 'response.completed', response: { id, usage: { input_tokens: 12, output_tokens: 8, total_tokens: 20 } } });
      res.end();
    } catch (error) { errors.push(error.stack); res.writeHead(500); res.end('fixture rejected request'); }
  });
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  return { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, requests, errors,
    async close() { server.closeAllConnections(); await new Promise((done, reject) => server.close(error => error ? reject(error) : done())); } };
}
// Reuse normal RPC parsing, with disjoint string client IDs and an additional
// listener for native server requests (the common peer intentionally ignores those).
class SharedPeer extends JsonLinePeer {
  constructor(child, name) {
    super(child, name); this.serverRequests = []; this.observed = [];
    this.requestLines = createInterface({ input: child.stdout });
    this.requestLines.on('line', line => {
      try { const message = JSON.parse(line); this.observed.push(message);
        if (message.method && Object.hasOwn(message, 'id')) this.serverRequests.push(message);
      } catch { /* The common peer reports invalid JSON. */ }
    });
    child.stdin.on('error', () => {}); // Pending requests receive write callback errors.
  }
  request(method, params, timeoutMs = RPC_TIMEOUT_MS) {
    return new Promise((done, reject) => {
      const id = `${this.name}-client-${++this.nextId}`;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`timeout:${method}:${timeoutMs}ms`)); }, timeoutMs);
      this.pending.set(id, { method, timer, resolve: done, reject });
      this.child.stdin.write(JSON.stringify({ id, method, params }) + '\n', error => {
        if (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
      });
    });
  }
  async event(method, threadId, serverRequest = false) {
    const messages = serverRequest ? this.serverRequests : this.notifications;
    let found;
    await until(() => {
      const index = messages.findIndex(message => message.method === method && message.params?.threadId === threadId);
      if (index < 0) return false;
      found = messages.splice(index, 1)[0]; return true;
    }, `${method}:${threadId}`);
    return found;
  }
  respond(id, result) { this.child.stdin.write(JSON.stringify({ id, result }) + '\n'); }
  close() { this.requestLines.close(); super.close(); }
}
export function parseVersion(output) {
  const match = output.trim().match(/^(?:azrael|codex)(?:-cli)?\s+(\d+\.\d+\.\d+)(?:\s|$)/);
  assert(match, `unexpected_native_version:${output.trim()}`);
  return match[1];
}
export function checkSocketPath(home, platform = process.platform) {
  assert(isAbsolute(home), 'absolute_fixture_home_required');
  const socket = join(home, 'app-server-control', 'app-server-control.sock');
  if (platform === 'win32') assert(Buffer.byteLength(socket) < 108,
    `Windows AF_UNIX path requires a shorter explicit isolated fixture root: ${socket}`);
  return socket;
}
export function resolveBridgePath(engine, explicit) {
  assert(isAbsolute(engine), 'absolute_frozen_engine_required');
  if (explicit !== undefined) assert(explicit && isAbsolute(explicit), 'absolute_matching_bridge_required');
  return resolve(explicit ?? join(dirname(engine), `azrael-bridge${extname(engine) === '.exe' ? '.exe' : ''}`));
}
export function windowAccountStateFile(run, workspace, owner) {
  assert(isAbsolute(run), 'absolute_fixture_root_required');
  assert(/^[a-z0-9-]+$/.test(workspace), 'fixture_workspace_name_required');
  assert(/^[0-9a-f]{64}$/.test(owner), 'fixture_window_owner_required');
  return join(run, workspace, 'window', owner, 'azrael-account-state.json');
}
export async function resumePendingTurn(peer, threadId, turnId) {
  const resumed = await peer.request('thread/resume', { threadId });
  assert.equal(resumed.thread.id, threadId, 'reload_resume_must_preserve_original_thread');
  const state = await peer.request('thread/read', { threadId, includeTurns: true });
  assert(state.thread.turns.some(turn => turn.id === turnId && turn.status === 'inProgress'),
    'reload_resume_must_preserve_original_pending_turn');
}
export function validateAccountStateProgress(previous, current) {
  for (const state of [previous, current]) {
    assert(state && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(state.instanceId),
      'native_account_engine_uuid_required');
    assert(Number.isSafeInteger(state.revision) && state.revision >= 0, 'native_account_revision_required');
  }
  assert.equal(current.instanceId, previous.instanceId, 'account_rejoin_must_preserve_engine_uuid');
  assert(current.revision > previous.revision, 'account_rejoin_global_revision_must_increase');
}
async function accountListState(peer) {
  const result = await peer.request('azrael/account', { action: 'list' });
  return { instanceId: result.state.instanceId, revision: result.state.revision };
}
export function resolveCodeHostPath(engine) {
  const suffix = extname(engine) === '.exe' ? '.exe' : '';
  return join(dirname(engine), `${basename(engine, suffix) === 'azrael' ? 'azrael' : 'codex'}-code-mode-host${suffix}`);
}
export function validateOwnedDaemonReceipt(receipt, pidRecord, { home, engineIdentity, engineVersion }) {
  assert.equal(receipt.engineIdentity, engineIdentity, 'fixture_daemon_engine_hash_mismatch');
  assert.equal(receipt.engineVersion, engineVersion, 'fixture_daemon_version_mismatch');
  assert.equal(resolve(receipt.socketPath), resolve(checkSocketPath(home)), 'fixture_daemon_socket_owner_mismatch');
  assert(Array.isArray(receipt.nativeArgv) && receipt.nativeArgv.includes('--azrael-shared-windows'), 'fixture_shared_daemon_argv_required');
  assert(receipt.nativeArgv.includes(`unix://${receipt.socketPath}`), 'fixture_daemon_listen_endpoint_mismatch');
  assert(Number.isInteger(pidRecord.pid) && pidRecord.pid > 0 && pidRecord.pid <= 0xffffffff, 'fixture_daemon_pid_required');
  assert(/^\d+$/.test(pidRecord.processStartTime), 'fixture_daemon_start_identity_required');
  return pidRecord.pid;
}
async function validateLiveDaemonProcess(pidRecord, engine) {
  if (!live(pidRecord.pid)) return false;
  const probe = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '$ErrorActionPreference="Stop"; $ownedProcess=Get-Process -Id ([int]$env:AZRAEL_CHECK_BACKEND_PID) -ErrorAction SilentlyContinue; ' +
    'if ($null -eq $ownedProcess) { "null" } else { @{pid=$ownedProcess.Id;path=$ownedProcess.Path;' +
    'start=$ownedProcess.StartTime.ToUniversalTime().ToFileTimeUtc().ToString()} | ConvertTo-Json -Compress }'],
  { env: { ...process.env, AZRAEL_CHECK_BACKEND_PID: String(pidRecord.pid) }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', error = '';
  probe.stdout.on('data', chunk => { output += chunk; }); probe.stderr.on('data', chunk => { error += chunk; });
  assert.equal((await waitForExit(probe, 'fixture backend process identity')).code, 0, error);
  const observedProcess = JSON.parse(output);
  if (observedProcess === null) return false;
  assert.equal(observedProcess.pid, pidRecord.pid);
  assert.equal(resolve(observedProcess.path).toLowerCase(), resolve(engine).toLowerCase(), 'fixture_backend_executable_mismatch');
  assert.equal(observedProcess.start, pidRecord.processStartTime, 'fixture_backend_start_time_mismatch');
  return true;
}
async function codeHostProcesses(daemonPid, hostPath) {
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '$items = @(Get-CimInstance Win32_Process -Filter ("ParentProcessId=" + $env:AZRAEL_CHECK_DAEMON_PID) -ErrorAction Stop | ' +
    'Where-Object { $_.ExecutablePath -eq $env:AZRAEL_CHECK_CODE_HOST } | ' +
    'Select-Object ProcessId,ParentProcessId,ExecutablePath); ConvertTo-Json -InputObject $items -Compress'],
  { env: { ...process.env, AZRAEL_CHECK_DAEMON_PID: String(daemonPid), AZRAEL_CHECK_CODE_HOST: hostPath },
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', error = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { error += chunk; });
  assert.equal((await waitForExit(child, 'owned code-host process snapshot')).code, 0, error);
  const processes = JSON.parse(output);
  assert(Array.isArray(processes) && processes.length > 0, 'daemon_owned_matching_code_mode_host_required');
  for (const process of processes) {
    assert.equal(process.ParentProcessId, daemonPid);
    assert.equal(resolve(process.ExecutablePath).toLowerCase(), resolve(hostPath).toLowerCase());
  }
  return processes;
}
export function diagnosticRootPids(pids) {
  const selected = [...new Set(pids.filter(value => value !== undefined && value !== null))];
  assert(selected.length > 0 && selected.length <= 16, 'bounded_diagnostic_process_roots_required');
  assert(selected.every(pid => Number.isInteger(pid) && pid > 0 && pid <= 0xffffffff), 'diagnostic_process_roots_must_be_native_pids');
  return selected;
}
export async function captureOwnedProcessTree(output, phase, pids) {
  const roots = diagnosticRootPids(pids);
  const probe = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `
$ErrorActionPreference='Stop'
$roots=$env:AZRAEL_TREE_ROOTS | ConvertFrom-Json
$seen=[System.Collections.Generic.HashSet[uint32]]::new()
$rows=[System.Collections.Generic.List[object]]::new()
$filter=($roots | ForEach-Object { 'ProcessId='+[uint32]$_ }) -join ' OR '
$frontier=@(Get-CimInstance Win32_Process -Filter $filter)
for ($depth=0; $frontier.Count -gt 0 -and $depth -lt 12; $depth++) {
  $next=[System.Collections.Generic.List[uint32]]::new()
  foreach ($process in $frontier) {
    if ($seen.Add([uint32]$process.ProcessId)) {
      $rows.Add(@{pid=[uint32]$process.ProcessId;parentPid=[uint32]$process.ParentProcessId;startUtc=$process.CreationDate.ToUniversalTime().ToString('o');path=$process.ExecutablePath;commandLine=$process.CommandLine})
      $next.Add([uint32]$process.ProcessId)
      if ($rows.Count -gt 256) { throw 'owned diagnostic process tree exceeded bounded size' }
    }
  }
  if ($next.Count -eq 0) { $frontier=@(); break }
  $filter=($next | ForEach-Object { 'ParentProcessId='+$_ }) -join ' OR '
  $frontier=@(Get-CimInstance Win32_Process -Filter $filter)
}
if ($frontier.Count -gt 0) { throw 'owned diagnostic process tree exceeded bounded depth' }
@{schema=1;observedUtc=[DateTime]::UtcNow.ToString('o');rootPids=@($roots | ForEach-Object { [uint32]$_ });processes=@($rows.ToArray())} | ConvertTo-Json -Depth 6 -Compress
`], { env: { ...process.env, AZRAEL_TREE_ROOTS: JSON.stringify(roots) }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let value = '', error = '';
  probe.stdout.on('data', chunk => { value += chunk; }); probe.stderr.on('data', chunk => { error += chunk; });
  const ended = await waitForExit(probe, 'owned process tree diagnostic', 15_000);
  assert.equal(ended.code, 0, error);
  const snapshot = JSON.parse(value);
  await writeFile(join(output, `process-tree-${phase}.json`), JSON.stringify(snapshot, null, 2));
  return { phase, rootPids: roots, processCount: snapshot.processes.length };
}
async function hashFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
function live(pid) {
  try { process.kill(pid, 0); return true; } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}
async function until(check, description, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await sleep(100);
  }
  throw new Error(`timeout:${description}`);
}
async function closeInput(child, name) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.stdin.end();
  await waitForExit(child, name, 30_000);
}
const GENERATED_GIT_OBJECT = '^h/\\.tmp/(?:plugins|plugins-clone-[a-zA-Z0-9_-]+)/\\.git/objects/(?:pack/pack-[0-9a-f]{40,64}\\.(?:idx|pack|rev)|[0-9a-f]{2}/[0-9a-f]{38,62})$';
const GENERATED_GIT_DIRECTORY = '^h/\\.tmp/(?:plugins|plugins-clone-[a-zA-Z0-9_-]+)/\\.git$';
export function generatedGitAttributeRepair(root, file, attributes) {
  const inside = relative(root, file).replaceAll('\\', '/');
  assert(inside && !inside.startsWith('../') && !isAbsolute(inside), 'generated_object_must_be_inside_owned_fixture');
  assert(Number.isInteger(attributes) && attributes >= 0 && !(attributes & 4), 'system_attribute_repair_forbidden');
  if (new RegExp(GENERATED_GIT_DIRECTORY).test(inside)) {
    assert((attributes & 16) && (attributes & 2), 'generated_git_directory_hidden_cause_required');
    return attributes & ~2; // Only Hidden is authorized for the clone's .git directory.
  }
  assert(new RegExp(GENERATED_GIT_OBJECT).test(inside) && !(attributes & 16), 'attribute_repair_requires_generated_git_object');
  assert(attributes & 3, 'readonly_or_hidden_cause_required');
  return attributes & ~3;
}
export async function removeOwnedFixture(path, nonce, { output, pids = [] } = {}) {
  const ownership = JSON.parse(await readFile(join(path, 'fixture-owner.json'), 'utf8'));
  assert.equal(ownership.nonce, nonce);
  assert.equal(ownership.root, path);
  // Project Windows cleanup rule: one PowerShell session, literal native deletion,
  // no force option, and verify the absolute owned target before recursive removal.
  assert.equal(process.platform, 'win32', 'non_windows_fixture_cleanup_requires_owner_procedure');
  for (const pid of pids) assert(Number.isInteger(pid) && pid > 0 && !live(pid), 'owned_fixture_process_still_alive');
  const command = `
$ErrorActionPreference = 'Stop'
$target = [System.IO.Path]::GetFullPath($env:AZRAEL_FIXTURE_DELETE)
if ($target -ne $env:AZRAEL_FIXTURE_DELETE) { throw 'fixture path mismatch' }
$owner = Get-Content -LiteralPath (Join-Path $target 'fixture-owner.json') -Raw | ConvertFrom-Json
if ($owner.nonce -ne $env:AZRAEL_FIXTURE_NONCE -or $owner.root -ne $target) { throw 'fixture owner mismatch' }
$ownedPids = @($env:AZRAEL_FIXTURE_PIDS | ConvertFrom-Json)
function Assert-OwnedBoundary {
  foreach ($ownedPid in $ownedPids) {
    if (Get-Process -Id $ownedPid -ErrorAction SilentlyContinue) { throw 'owned fixture process still alive' }
  }
  $parent = [System.IO.DirectoryInfo]$target
  while ($null -ne $parent) {
    if ($parent.Attributes -band [System.IO.FileAttributes]::ReparsePoint) { throw 'fixture ancestor is a reparse point' }
    $parent = $parent.Parent
  }
  $pending = [System.Collections.Generic.Stack[System.IO.DirectoryInfo]]::new()
  $pending.Push([System.IO.DirectoryInfo]$target)
  while ($pending.Count -gt 0) {
    foreach ($entry in $pending.Pop().GetFileSystemInfos()) {
      if (-not $entry.FullName.StartsWith($target + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'fixture entry escapes owner root' }
      if ($entry.Attributes -band [System.IO.FileAttributes]::ReparsePoint) { throw 'fixture contains a reparse point' }
      if ($entry -is [System.IO.DirectoryInfo]) { $pending.Push($entry) }
    }
  }
}
for ($attempt = 0; $attempt -lt 128; $attempt++) {
  Assert-OwnedBoundary
  try {
    Remove-Item -LiteralPath $target -Recurse -ErrorAction Stop
    if (Test-Path -LiteralPath $target) { throw 'fixture removal incomplete' }
    @{action='ordinary-delete';root=$target;removed=$true} | ConvertTo-Json -Compress
    exit 0
  } catch {
    $cause = $_
    $failed = $cause.TargetObject
    if ($failed -is [System.IO.FileSystemInfo]) { $failed = $failed.FullName }
    if (-not [System.IO.Path]::IsPathRooted([string]$failed)) { throw $cause }
    $failed = [System.IO.Path]::GetFullPath([string]$failed)
    if (-not $failed.StartsWith($target + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) { throw $cause }
    $inside = $failed.Substring($target.Length + 1).Replace('\\','/')
    $isGitDirectory = $inside -match $env:AZRAEL_FIXTURE_GIT_DIRECTORY_PATTERN
    if (-not $isGitDirectory -and $inside -notmatch $env:AZRAEL_FIXTURE_GIT_PATTERN) { throw $cause }
    Assert-OwnedBoundary
    if ($cause.TargetObject -is [System.IO.FileSystemInfo]) { $item = $cause.TargetObject; $item.Refresh() }
    else { $item = Get-Item -LiteralPath $failed -ErrorAction Stop }
    $before = [int]$item.Attributes
    if ($before -band 4) { throw $cause }
    if ($isGitDirectory) {
      if (-not ($before -band 16) -or -not ($before -band 2)) { throw $cause }
      $after = $before -band (-bnot 2)
    } else {
      if (($before -band 16) -or -not ($before -band 3)) { throw $cause }
      $after = $before -band (-bnot 3)
    }
    $item.Attributes = [System.IO.FileAttributes]$after
    $item.Refresh()
    if ([int]$item.Attributes -ne $after) { throw 'attribute repair verification failed' }
    @{action='generated-git-attribute-repair';path=$failed;before=$before;after=$after;cause=$cause.FullyQualifiedErrorId} | ConvertTo-Json -Compress
  }
}
throw 'bounded generated-object cleanup exhausted'
`;
  const cleanup = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command],
  { env: { ...process.env, AZRAEL_FIXTURE_DELETE: path, AZRAEL_FIXTURE_NONCE: nonce,
    AZRAEL_FIXTURE_PIDS: JSON.stringify(pids), AZRAEL_FIXTURE_GIT_PATTERN: GENERATED_GIT_OBJECT,
    AZRAEL_FIXTURE_GIT_DIRECTORY_PATTERN: GENERATED_GIT_DIRECTORY },
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let diagnostic = '', changes = '';
  cleanup.stderr.on('data', chunk => { diagnostic += chunk; });
  cleanup.stdout.on('data', chunk => { changes += chunk; });
  const exit = await waitForExit(cleanup, 'owned fixture cleanup');
  if (output) await appendFile(join(output, 'fixture-cleanup.log'),
    JSON.stringify({ action: 'cleanup-attempt', root: path, nonce, checkedPids: pids, exitCode: exit.code }) + '\n' + changes + diagnostic);
  assert.equal(exit.code, 0, diagnostic);
  assert(changes.includes('"removed":true'), 'owned_fixture_absence_verification_missing');
}
export async function runCheck(engine, output, { fixtureRoot, extended = false, bridge, codeModeChild = false, accountRejoinState = false } = {}) {
  assert.equal(process.platform, 'win32', 'this_fixture_currently_verifies_Windows_only');
  assert(engine && isAbsolute(engine), 'absolute_frozen_engine_required');
  assert(output && isAbsolute(output), 'absolute_new_results_directory_required');
  engine = resolve(engine); output = resolve(output);
  bridge = resolveBridgePath(engine, bridge);
  assert(!codeModeChild || extended, 'code_mode_child_requires_extended');
  assert(!accountRejoinState || extended, 'account_rejoin_state_requires_extended');
  const codeHost = codeModeChild ? resolveCodeHostPath(engine) : null;
  const outputWithin = relative(join(ROOT, 'artifacts'), output);
  assert(outputWithin && !outputWithin.startsWith('..') && !isAbsolute(outputWithin),
    'result_directory_must_be_under_project_artifacts');
  const nonce = randomBytes(8).toString('hex');
  const run = resolve(fixtureRoot ?? (process.platform === 'win32'
    ? join(tmpdir(), `bj-${nonce.slice(0, 8)}`)
    : join(ROOT, 'artifacts', 'verification', `BJ-01-${nonce}`)));
  const home = join(run, 'h');
  checkSocketPath(home);
  await access(engine);
  await access(bridge); // Require the matching bundle's real management bridge.
  if (codeHost) await access(codeHost);
  await mkdir(output); // Refuse reused results and fixture state.
  await mkdir(run);
  await writeFile(join(run, 'fixture-owner.json'), JSON.stringify({ schema: 1, root: run, nonce }));
  const report = { schema: 1, status: 'failed', scope: 'native shared-engine prerequisite acceptance',
    engine, bridge, platform: process.platform, arch: process.arch, fixtureRoot: run, checks: [],
    modelRequest: extended, realCredentialMutation: false,
    untested: ['running-turn preservation', 'generic approval replay and cross-window response denial',
      'managed account selection',
      'manual resume marker clearing by explicit turn', 'queue/reservation restart suppression',
      'owned exec child and code-mode host final-close exit', 'read-only account state identity and revision across rejoin'] };
  const proxies = [], hosts = [];
  let provider;
  let daemonPid, failure, cleanupFailure;
  const record = (name, details = {}) => report.checks.push({ name, ...details });
  const json = async path => JSON.parse(await readFile(path, 'utf8'));
  const pidFile = join(home, 'app-server-daemon', 'daemon.pid');
  const receiptFile = join(home, 'app-server-daemon', 'azrael-selected-engine.json');
  async function preserveBackendEvidence(phase) {
    const dir = join(home, 'app-server-daemon');
    const saved = {};
    for (const name of ['daemon.pid', 'azrael-selected-engine.json', 'daemon.stderr.log']) {
      try {
        const bytes = await readFile(join(dir, name));
        await writeFile(join(output, `backend-${phase}-${name}`), name.endsWith('.log') ? bytes.subarray(-128_000) : bytes);
        if (name.endsWith('.json') || name === 'daemon.pid') saved[name] = bytes.toString('utf8');
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    if (phase === 'before-cleanup') {
      for (const name of ['daemon.stderr.log', 'daemon.stderr.log.previous']) {
        try { await writeFile(join(output, `backend-full-${name}`), await readFile(join(dir, name))); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
    }
    if (!saved['daemon.pid'] && !saved['azrael-selected-engine.json']) return null;
    assert(saved['daemon.pid'] && saved['azrael-selected-engine.json'], 'partial_native_backend_receipts_preserved_refusing_delete');
    const pidRecord = JSON.parse(saved['daemon.pid']), receipt = JSON.parse(saved['azrael-selected-engine.json']);
    const pid = validateOwnedDaemonReceipt(receipt, pidRecord, { home, ...report });
    const alive = await validateLiveDaemonProcess(pidRecord, engine);
    report.nativeBackendEvidence ??= [];
    report.nativeBackendEvidence.push({ phase, pid, alive, processStartTime: pidRecord.processStartTime, receipt });
    return { pid, alive };
  }
  async function daemon() {
    const pidRecord = await json(pidFile);
    assert(Number.isInteger(pidRecord.pid) && pidRecord.pid > 0, 'native_pid_record_required');
    assert(live(pidRecord.pid), 'native_daemon_not_alive');
    const receipt = await json(receiptFile);
    assert.equal(receipt.engineIdentity, report.engineIdentity);
    assert.equal(receipt.engineVersion, report.engineVersion);
    return { pid: pidRecord.pid, receipt };
  }
  async function window(workspace, owner = randomBytes(32).toString('hex')) {
    const host = spawn(process.execPath, ['-e', 'process.stdin.resume();process.stdin.on("end",()=>process.exit(0));'],
      { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
    hosts.push(host);
    await new Promise((done, reject) => { host.once('spawn', done); host.once('error', reject); });
    const cwd = join(run, workspace);
    await mkdir(cwd, { recursive: true });
    return { host, cwd, context: { schema: 1, role: 'window', ownerId: owner,
      workspaceId: digest(workspace), hostPid: host.pid,
      accountStateFile: windowAccountStateFile(run, workspace, owner), accountDefaultFile: null,
      engineVersion: report.engineVersion, engineIdentity: report.engineIdentity } };
  }
  function scopedEnvironment(win, override = {}) {
    const environment = { ...process.env, CODEX_HOME: home,
      AZRAEL_EX_WINDOW_CONTEXT: JSON.stringify({ ...win.context, ...override }),
      AZRAEL_EX_ACCOUNT_STATE_FILE: win.context.accountStateFile };
    delete environment.AZRAEL_EX_ACCOUNT_DEFAULT_FILE;
    delete environment.AZRAEL_EX_MANAGEMENT_SOCKET;
    return environment;
  }
  function launch(win, override = {}) {
    const startedAt = Date.now();
    const child = spawn(engine, ['-c', 'features.code_mode_host=true', 'app-server', '--analytics-default-enabled'],
      { cwd: win.cwd, env: scopedEnvironment(win, override), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const stderr = captureStderr(child, 128_000);
    const peer = new SharedPeer(child, `proxy-${proxies.length}`);
    const instance = { child, peer, stderr, startedAt }; proxies.push(instance);
    return instance;
  }
  async function launchBridge(win, socketPath) {
    assert.equal(resolve(socketPath), resolve(checkSocketPath(home)), 'bridge_socket_must_be_owned_fixture_endpoint');
    const startedAt = Date.now();
    const child = spawn(bridge, [socketPath], { cwd: win.cwd, env: scopedEnvironment(win),
      windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const peer = new SharedPeer(child, `bridge-${proxies.length}`);
    const instance = { child, peer, stderr: captureStderr(child, 128_000), startedAt };
    proxies.push(instance);
    let connected;
    await until(() => {
      const index = peer.notifications.findIndex(message => message.method === 'azrael/connected');
      if (index < 0) {
        assert(child.exitCode === null && child.signalCode === null, 'management_bridge_exited_during_startup');
        return false;
      }
      connected = peer.notifications.splice(index, 1)[0].params;
      return true;
    }, 'real management bridge startup readiness', startupRemaining(startedAt, Date.now(), BRIDGE_STARTUP_MS));
    assert.equal(resolve(connected.codexHome), home);
    assert.equal(connected.serverVersion, report.engineVersion);
    return instance;
  }
  async function initialize(instance) {
    const result = await instance.peer.request('initialize', {
      clientInfo: { name: 'azrael-shared-native-check', version: '1.0.0' },
      capabilities: { experimentalApi: true } }, startupRemaining(instance.startedAt));
    instance.peer.notify('initialized');
    return result;
  }
  try {
    await mkdir(home);
    let source;
    if (codeModeChild) {
      const script = join(run, 'owned-code-child.cjs');
      const receipt = join(run, 'owned-code-child.json');
      await writeFile(script, `const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(receipt)},JSON.stringify({nonce:${JSON.stringify(nonce)},pid:process.pid,ppid:process.ppid}),{flag:'wx'});setTimeout(()=>process.exit(0),120000);setInterval(()=>{},1000);`);
      source = codeModeChildSource(process.execPath, script);
      report.codeHost = codeHost; report.codeHostIdentity = await hashFile(codeHost);
    }
    if (extended) provider = await startSharedProvider({ codeModeSource: source });
    await writeFile(join(home, 'config.toml'),
      `model_provider = "fixture"\n[features]\nresponses_websockets = false\n[model_providers.fixture]\nname = "isolated loopback fixture"\nbase_url = "${provider?.baseUrl ?? 'http://127.0.0.1:9/v1'}"\nwire_api = "responses"\nrequires_openai_auth = false\n`);
    const version = spawn(engine, ['--version'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let versionText = '';
    version.stdout.on('data', chunk => { versionText += chunk; });
    const versionExit = await waitForExit(version, 'native version');
    assert.equal(versionExit.code, 0);
    report.engineVersion = parseVersion(versionText);
    assert.equal(report.engineVersion, '0.162.0');
    report.engineIdentity = await hashFile(engine);
    report.bridgeIdentity = await hashFile(bridge);
    record('native_version_and_binary_identity', { version: report.engineVersion });
    const [a, b] = await Promise.all([window('a'), window('b')]);
    const pa = launch(a), pb = launch(b);
    await Promise.all([initialize(pa), initialize(pb)]);
    const initial = await daemon(); daemonPid = initial.pid;
    assert.notEqual(daemonPid, pa.child.pid); assert.notEqual(daemonPid, pb.child.pid);
    report.enginePid = daemonPid; report.daemonReceipt = initial.receipt;
    record('concurrent_proxy_initialize_single_detached_engine', { enginePid: daemonPid, proxyPids: [pa.child.pid, pb.child.pid] });
    const companion = launch(a, { role: 'companion' });
    await initialize(companion);
    assert.equal((await daemon()).pid, daemonPid);
    record('native_companion_registers_and_initializes_on_same_engine_and_window_context', { proxyPid: companion.child.pid });
    const managementBridge = await launchBridge(a, initial.receipt.socketPath);
    const managementBridges = [managementBridge];
    const [bridgeConfig, windowConfig] = await Promise.all([
      managementBridge.peer.request('config/read', { includeLayers: false }),
      pa.peer.request('config/read', { includeLayers: false }),
    ]);
    assert.deepEqual(bridgeConfig.config, windowConfig.config, 'bridge must use its registered window context');
    const bridgeAccount = await managementBridge.peer.request('account/read', { refreshToken: false });
    assert.equal(bridgeAccount.account, null, 'new bridge fixture unexpectedly contains credentials');
    const reservations = await managementBridge.peer.request('azrael/rootResume', { action: 'list' });
    assert(Array.isArray(reservations.reservations));
    await assert.rejects(managementBridge.peer.request('thread/start', { cwd: a.cwd }), /not allowed by the azrael bridge/);
    assert.equal((await daemon()).pid, daemonPid);
    record('real_management_bridge_registers_as_companion_allowed_rpc_matches_window_and_rejects_thread_mutation',
      { bridgePid: managementBridge.child.pid, enginePid: daemonPid });
    if (accountRejoinState) {
      const initialA = await accountListState(managementBridge.peer);
      const bridgeB = await launchBridge(b, initial.receipt.socketPath);
      managementBridges.push(bridgeB);
      const windowB = await accountListState(bridgeB.peer);
      validateAccountStateProgress(initialA, windowB);
      report.accountStateContinuity = { initialA, windowB };
      record('real_bridges_for_distinct_window_contexts_share_engine_uuid_and_increasing_account_revision');
    }
    const starts = await Promise.all([[pa, a, 'gpt-5.2'], [pb, b, 'gpt-5.1']].map(async ([proxy, win, model]) => {
      const result = await proxy.peer.request('thread/start', { model, modelProvider: 'fixture', cwd: win.cwd,
        approvalPolicy: extended ? 'on-request' : 'never', sandbox: 'read-only', ephemeral: false,
        ...(extended ? { dynamicTools: [{ type: 'namespace', name: 'shared_probe', description: 'Isolated shared-engine fixture',
          tools: [{ type: 'function', name: 'hold', description: 'Wait for fixture release', inputSchema: { type: 'object', properties: {} } }] }] } : {}) });
      assert.equal(result.model, model); assert.equal(resolve(result.cwd), win.cwd);
      return result.thread.id;
    }));
    const [threadA, threadB] = starts; assert.notEqual(threadA, threadB);
    report.threadIds = starts;
    record('independent_thread_models_and_workspaces');
    await assert.rejects(pb.peer.request('thread/resume', { threadId: threadA }), /another window/);
    record('other_workspace_cannot_resume_owned_thread');
    for (const override of [{ engineVersion: '0.0.0' }, { engineIdentity: '0'.repeat(64) }]) {
      const wrong = launch(b, override);
      const ended = await waitForExit(wrong.child, 'mismatched proxy', startupRemaining(wrong.startedAt));
      assert.notEqual(ended.code, 0);
      assert.equal((await daemon()).pid, daemonPid);
    }
    record('version_and_hash_mismatch_refuse_without_second_engine');
    const startTurn = async (proxy, threadId, mode, token) => proxy.peer.request('turn/start', {
      threadId, input: [{ type: 'text', text: `BJ_MODE:${mode}:${token}`, text_elements: [] }] });
    let heldTurn;
    if (extended) {
      heldTurn = await startTurn(pa, threadA, 'hold', 'survive');
      await pa.peer.event('item/tool/call', threadA, true);
      assert.equal(provider.requests.filter(request => request.token === 'survive').length, 1);
      record('actual_loopback_turn_held_by_pending_dynamic_tool');
    }
    await closeInput(pa.child, 'reload proxy A');
    assert(live(a.host.pid)); assert.equal((await daemon()).pid, daemonPid);
    const reloadA = launch(a); await initialize(reloadA);
    await reloadA.peer.request('thread/resume', { threadId: threadA });
    if (extended) await reloadA.peer.event('item/tool/call', threadA, true);
    assert.equal((await daemon()).pid, daemonPid);
    record('proxy_reload_while_window_host_alive_retains_engine_and_ownership');
    await Promise.all([
      closeInput(a.host, 'window host A death'),
      closeInput(reloadA.child, 'closed window A UI proxy disconnect'),
    ]);
    await sleep(1500); // Native host lease polling runs once per second.
    assert.equal((await daemon()).pid, daemonPid);
    await assert.rejects(pb.peer.request('thread/resume', { threadId: threadA }), /another window/);
    const rejoined = await window('a'); const newA = launch(rejoined); await initialize(newA);
    let rejoinedBridge;
    if (accountRejoinState) {
      rejoinedBridge = await launchBridge(rejoined, initial.receipt.socketPath);
      managementBridges.push(rejoinedBridge);
      const beforeRebind = await accountListState(rejoinedBridge.peer);
      validateAccountStateProgress(report.accountStateContinuity.windowB, beforeRebind);
      report.accountStateContinuity.beforeRebind = beforeRebind;
    }
    await newA.peer.request('thread/resume', { threadId: threadA });
    if (accountRejoinState) {
      const afterRebind = await accountListState(rejoinedBridge.peer);
      validateAccountStateProgress(report.accountStateContinuity.beforeRebind, afterRebind);
      report.accountStateContinuity.afterRebind = afterRebind;
      record('new_owner_real_bridge_pins_engine_uuid_and_revision_advances_after_retained_thread_context_rebind');
    }
    const loaded = await newA.peer.request('thread/loaded/list', {});
    assert(loaded.data.includes(threadA), 'rejoined_thread_not_loaded');
    record('new_host_same_workspace_rejoins_original_thread_without_turn_submission');
    if (extended) {
      const held = await newA.peer.event('item/tool/call', threadA, true);
      assert(!pb.peer.observed.some(message => message.method === 'item/tool/call' && message.params?.threadId === threadA));
      pb.peer.respond(held.id, { success: true, contentItems: [{ type: 'inputText', text: 'WRONG_WINDOW' }] });
      await sleep(500);
      assert.equal(provider.requests.filter(request => request.token === 'survive').length, 1);
      const turnState = await newA.peer.request('thread/read', { threadId: threadA, includeTurns: true });
      assert(turnState.thread.turns.some(turn => turn.id === heldTurn.turn.id && turn.status === 'inProgress'));
      newA.peer.respond(held.id, { success: true, contentItems: [{ type: 'inputText', text: 'BJ_HOLD_RELEASED' }] });
      const completed = await newA.peer.event('turn/completed', threadA);
      assert.equal(completed.params.turn.id, heldTurn.turn.id);
      assert.equal(completed.params.turn.status, 'completed');
      record('active_turn_survives_host_death_rejoin_replays_pending_tool_other_window_cannot_answer');
      const approvalTurn = await startTurn(newA, threadA, 'approval', 'approval');
      const approval = await newA.peer.event('item/commandExecution/requestApproval', threadA, true);
      assert(!pb.peer.observed.some(message => message.method === approval.method && message.params?.threadId === threadA));
      pb.peer.respond(approval.id, { decision: 'decline' });
      await sleep(500);
      assert.equal(provider.requests.filter(request => request.token === 'approval').length, 1);
      await closeInput(newA.child, 'approval pending proxy reload');
      const approvalReload = launch(rejoined); await initialize(approvalReload);
      await resumePendingTurn(approvalReload.peer, threadA, approvalTurn.turn.id);
      const replay = await approvalReload.peer.event(approval.method, threadA, true);
      assert.equal(replay.id, approval.id);
      assert.equal(provider.requests.filter(request => request.token === 'approval').length, 1,
        'approval subscriber reattach must not submit duplicate inference');
      approvalReload.peer.respond(replay.id, { decision: 'decline' });
      const ended = await approvalReload.peer.event('turn/completed', threadA);
      assert.equal(ended.params.turn.id, approvalTurn.turn.id);
      assert.equal(ended.params.turn.status, 'completed');
      record('native_command_approval_isolated_replayed_and_denied_only_by_owner');
      const finalTurn = await startTurn(approvalReload, threadA, 'hold', 'lastclose');
      await approvalReload.peer.event('item/tool/call', threadA, true);
      report.finalInterruptedTurnId = finalTurn.turn.id;
      const queued = await approvalReload.peer.request('thread/queue/add', { threadId: threadA,
        clientUserMessageId: 'bj-queued-lastclose', input: [{ type: 'text', text: 'BJ_MODE:finish:queued', text_elements: [] }] });
      report.queuedSubmissionId = queued.queuedSubmission.id;
      // Last close will interrupt the native pending tool/turn; do not respond.
      if (codeModeChild) {
        const codeThread = await pb.peer.request('thread/start', { model: 'gpt-5.2', modelProvider: 'fixture', cwd: b.cwd,
          approvalPolicy: 'never', sandbox: 'danger-full-access', ephemeral: false,
          config: { 'features.code_mode': true } });
        const codeTurn = await startTurn(pb, codeThread.thread.id, 'codechild', 'owned-child');
        const receiptPath = join(run, 'owned-code-child.json');
        await until(async () => {
          try { await access(receiptPath); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
        }, 'native code-mode owned child PID receipt');
        report.ownedExecChild = await json(receiptPath);
        assert.equal(report.ownedExecChild.nonce, nonce);
        assert(Number.isInteger(report.ownedExecChild.pid) && report.ownedExecChild.pid > 0);
        assert(Number.isInteger(report.ownedExecChild.ppid) && report.ownedExecChild.ppid > 0);
        assert(live(report.ownedExecChild.pid));
        report.ownedCodeHosts = await codeHostProcesses(daemonPid, codeHost);
        try {
          report.processTreeDiagnostics = [await captureOwnedProcessTree(output, 'child-started',
            [daemonPid, report.ownedExecChild.pid, report.ownedExecChild.ppid, ...report.ownedCodeHosts.map(process => process.ProcessId)])];
        } catch (error) { report.childProcessTreeDiagnosticError = error.stack; }
        report.codeModeThreadId = codeThread.thread.id; report.codeModeTurnId = codeTurn.turn.id;
        record('actual_code_mode_exec_spawns_nonce_owned_bounded_child_and_matching_daemon_owned_host',
          { childPid: report.ownedExecChild.pid, codeHostPids: report.ownedCodeHosts.map(process => process.ProcessId) });
      }
    }
    assert.equal(companion.child.exitCode, null, 'companion exited before final-window test');
    assert.equal(companion.child.signalCode, null);
    assert.equal(companion.child.stdin.writableEnded, false, 'companion transport was closed before final-window test');
    for (const bridge of managementBridges) {
      assert.equal(bridge.child.exitCode, null, 'real management bridge exited before final-window test');
      assert.equal(bridge.child.signalCode, null);
      assert.equal(bridge.child.stdin.writableEnded, false, 'real bridge transport was closed before final-window test');
    }
    await Promise.all([closeInput(b.host, 'window host B death'), closeInput(rejoined.host, 'last window host death')]);
    try { await until(() => !live(daemonPid) && (!codeModeChild ||
      (!live(report.ownedExecChild.pid) && report.ownedCodeHosts.every(process => !live(process.ProcessId)))),
    'daemon and owned child processes exit after last window host', 50_000); }
    catch (error) {
      if (codeModeChild && report.ownedExecChild) {
        try {
          report.processTreeDiagnostics ??= [];
          report.processTreeDiagnostics.push(await captureOwnedProcessTree(output, 'final-close-failed',
            [daemonPid, report.ownedExecChild.pid, report.ownedExecChild.ppid, ...report.ownedCodeHosts.map(process => process.ProcessId)]));
        } catch (diagnosticError) { report.finalCloseProcessTreeDiagnosticError = diagnosticError.stack; }
      }
      throw error;
    }
    if (codeModeChild) {
      record('last_host_close_stops_actual_owned_exec_child_and_all_recorded_code_mode_hosts');
    }
    record('open_native_companion_does_not_keep_engine_alive_after_last_actual_window_host_exits');
    record('open_real_management_bridge_does_not_count_as_window_or_keep_engine_alive');
    const marker = await json(join(home, 'azrael', 'runtime', 'manual-resume.json'));
    assert.equal(marker.schema, 1);
    assert(marker.threads.includes(threadA)); assert(marker.threads.includes(threadB));
    record('last_window_host_shutdown_marks_loaded_threads_for_manual_resume');
    const restarted = await window('a'); const restart = launch(restarted); await initialize(restart);
    const newDaemon = await daemon(); daemonPid = newDaemon.pid;
    assert.notEqual(newDaemon.pid, report.enginePid);
    const afterRestart = await restart.peer.request('thread/loaded/list', {});
    assert.equal(afterRestart.data.length, 0);
    const restartMarker = await json(join(home, 'azrael', 'runtime', 'manual-resume.json'));
    assert(restartMarker.threads.includes(threadA));
    record('restart_keeps_manual_marker_and_does_not_autoload_threads');
    if (extended) {
      const before = provider.requests.length;
      await sleep(1000);
      assert.equal(provider.requests.length, before, 'restart unexpectedly submitted inference');
      await restart.peer.request('thread/resume', { threadId: threadA });
      const restored = await restart.peer.request('thread/read', { threadId: threadA, includeTurns: true });
      assert(restored.thread.turns.some(turn => turn.id === report.finalInterruptedTurnId && turn.status === 'interrupted'));
      const queued = await restart.peer.request('thread/queue/list', { threadId: threadA });
      assert(queued.data.some(item => item.id === report.queuedSubmissionId), 'queued work missing after final-close restart');
      await sleep(500);
      assert.equal(provider.requests.length, before, 'resume unexpectedly submitted inference');
      // Remove the preserved queue item so explicit user input has one intentional
      // turn, keeping queue release behavior separate from this startup gate.
      await restart.peer.request('thread/queue/delete', { threadId: threadA, queuedSubmissionId: report.queuedSubmissionId });
      record('populated_queue_survives_shutdown_without_automatic_start_on_restart_or_attach');
      const explicit = await startTurn(restart, threadA, 'finish', 'manual');
      const finished = await restart.peer.event('turn/completed', threadA);
      assert.equal(finished.params.turn.id, explicit.turn.id);
      assert.equal(finished.params.turn.status, 'completed');
      const cleared = await json(join(home, 'azrael', 'runtime', 'manual-resume.json'));
      assert(!cleared.threads.includes(threadA));
      assert.equal(provider.errors.length, 0);
      record('last_close_interrupt_restart_and_attach_do_not_infer_explicit_user_turn_clears_manual_marker');
      report.untested = ['managed account selection',
        'populated root-resume reservation restart suppression'];
      if (!codeModeChild) report.untested.push('owned exec child and code-mode host final-close exit');
      if (!accountRejoinState) report.untested.push('read-only account state identity and revision across rejoin');
    }
    report.status = 'passed';
  } catch (error) { failure = error; report.error = error.stack; }
  finally {
    try {
      let before, beforeEvidenceError;
      try { before = await preserveBackendEvidence('before-cleanup'); } catch (error) {
        beforeEvidenceError = error;
        report.beforeCleanupEvidenceError = error.stack;
      }
      if (!daemonPid && before) daemonPid = before.pid;
      await Promise.all([
        ...hosts.map((host, i) => closeInput(host, `cleanup fixture host ${i}`)),
        ...proxies.map((proxy, i) => closeInput(proxy.child, `cleanup proxy ${i}`)),
      ]);
      const after = await preserveBackendEvidence('after-clients-close');
      if (!after && beforeEvidenceError) throw beforeEvidenceError;
      if (after) daemonPid = after.pid;
      if (daemonPid) await until(() => !live(daemonPid), 'cleanup validated daemon exit', 50_000);
      await preserveBackendEvidence('after-daemon-exit');
      if (report.ownedExecChild) await until(() => !live(report.ownedExecChild.pid), 'cleanup owned exec child exit', 10_000);
      if (report.ownedCodeHosts) await until(() => report.ownedCodeHosts.every(process => !live(process.ProcessId)), 'cleanup owned code-mode host exit', 10_000);
      await removeOwnedFixture(run, nonce, { output, pids: [...new Set([daemonPid,
        report.ownedExecChild?.pid, ...(report.ownedCodeHosts ?? []).map(process => process.ProcessId)].filter(Boolean))] });
      report.fixtureRemoved = true;
    } catch (error) {
      cleanupFailure = error; report.cleanupError = error.stack; report.fixtureRemoved = false;
      report.status = 'failed';
    }
    if (provider) {
      try { await provider.close(); } catch (error) {
        cleanupFailure ??= error; report.providerCleanupError = error.stack; report.status = 'failed';
      }
    }
    for (const [i, proxy] of proxies.entries()) {
      proxy.peer.close();
      await writeFile(join(output, `proxy-${i}.stderr.log`), proxy.stderr());
      await writeFile(join(output, `proxy-${i}.rpc.jsonl`), proxy.peer.observed.map(message => JSON.stringify({
        id: message.id, method: message.method, error: message.error,
        threadId: message.params?.threadId, turn: message.params?.turn && {
          id: message.params.turn.id, status: message.params.turn.status, error: message.params.turn.error },
      })).join('\n'));
    }
    if (provider) await writeFile(join(output, 'provider-requests.json'), JSON.stringify({ requests: provider.requests, errors: provider.errors }, null, 2));
    await writeFile(join(output, 'verification.json'), JSON.stringify(report, null, 2));
  }
  if (failure || cleanupFailure) throw new AggregateError([failure, cleanupFailure].filter(Boolean), 'shared-engine native check failed');
  return report;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const index = process.argv.indexOf('--fixture-root');
  const bridgeIndex = process.argv.indexOf('--bridge');
  const report = await runCheck(process.argv[2], process.argv[3], { fixtureRoot: index < 0 ? undefined : process.argv[index + 1],
    extended: process.argv.includes('--extended'), bridge: bridgeIndex < 0 ? undefined : process.argv[bridgeIndex + 1],
    codeModeChild: process.argv.includes('--code-mode-child'), accountRejoinState: process.argv.includes('--account-rejoin-state') });
  console.log(JSON.stringify(report));
}
