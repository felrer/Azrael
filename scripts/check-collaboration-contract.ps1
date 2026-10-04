param(
    [Parameter(Mandatory = $true)][string]$EnginePath,
    [Parameter(Mandatory = $true)][string]$DevinExecutable,
    [Parameter(Mandatory = $true)][string]$StateRoot,
    [Parameter(Mandatory = $true)][string]$FixtureRoot,
    [Parameter(Mandatory = $true)][string]$LogRoot,
    [switch]$AllowUnrestrictedDevin
)

$ErrorActionPreference = 'Stop'
$engine = (Resolve-Path -LiteralPath $EnginePath).Path
$devin = (Resolve-Path -LiteralPath $DevinExecutable).Path
$state = (Resolve-Path -LiteralPath $StateRoot).Path
$fixture = [IO.Path]::GetFullPath($FixtureRoot)
$logs = [IO.Path]::GetFullPath($LogRoot)
New-Item -ItemType Directory -Force -Path $fixture, $logs | Out-Null
if (-not $AllowUnrestrictedDevin) {
    throw 'Live Devin probes require the explicit -AllowUnrestrictedDevin opt-in.'
}

function Invoke-Probe {
    param(
        [string]$Name,
        [string]$Model,
        [string]$Prompt,
        [string[]]$Config = @(),
        [switch]$Unrestricted
    )
    $stdout = Join-Path $logs "$Name.stdout.jsonl"
    $stderr = Join-Path $logs "$Name.stderr.txt"
    $arguments = @('exec', '--ephemeral', '--json', '--color', 'never')
    if ($Unrestricted) { $arguments += '--dangerously-bypass-approvals-and-sandbox' }
    else { $arguments += @('--sandbox', 'read-only') }
    $arguments += @('-C', $fixture, '--skip-git-repo-check', '-m', $Model)
    foreach ($entry in $Config) { $arguments += @('-c', $entry) }
    $arguments += $Prompt
    & $engine @arguments 1> $stdout 2> $stderr
    $exitCode = $LASTEXITCODE
    Set-Content -LiteralPath (Join-Path $logs "$Name.exitcode.txt") -Value $exitCode
    $events = @(Get-Content -LiteralPath $stdout | ForEach-Object {
        try { $_ | ConvertFrom-Json } catch { }
    })
    [pscustomobject]@{
        name = $Name
        model = $Model
        exitCode = $exitCode
        messages = @($events | Where-Object { $_.type -eq 'item.completed' -and $_.item.type -eq 'agent_message' } | ForEach-Object { $_.item.text })
        calls = @($events | Where-Object { $_.type -eq 'item.completed' -and $_.item.type -eq 'collab_tool_call' } | ForEach-Object {
            [pscustomobject]@{
                tool = $_.item.tool
                status = $_.item.status
                receiverCount = @($_.item.receiver_thread_ids).Count
                agentMessages = @($_.item.agents_states.psobject.Properties.Value.message | Where-Object { $_ })
            }
        })
        hasReservedSchemaError = [bool](@($events | Where-Object { $_.type -eq 'error' } | ForEach-Object { $_.message }) -match 'reserved.*configured schema')
    }
}

function Invoke-AppServerLifecycleProbe {
    $helper = Join-Path $fixture 'check-collaboration-app-server.mjs'
    $stdout = Join-Path $logs 'app-server-lifecycle.stdout.json'
    $stderr = Join-Path $logs 'app-server-lifecycle.stderr.txt'
    @'
import { spawn } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const [engine, cwd, eventLog] = process.argv.slice(2);
const WAIT_MS = 180_000;
const child = spawn(engine, ['app-server'], {
  cwd,
  env: process.env,
  windowsHide: true,
  stdio: ['pipe', 'pipe', 'pipe'],
});
let stderr = '';
child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-64_000); });
const pending = new Map();
const queued = [];
const waiters = [];
const recorded = [];
let nextId = 0;
const recordable = new Set(['item/completed', 'rawResponseItem/completed', 'turn/completed', 'error']);
function receive(line) {
  const message = JSON.parse(line);
  if (Object.hasOwn(message, 'id')) {
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(`${request.method}: ${JSON.stringify(message.error)}`));
    else request.resolve(message.result);
    return;
  }
  if (typeof message.method !== 'string') return;
  if (recordable.has(message.method)) {
    recorded.push(message);
    appendFileSync(eventLog, `${JSON.stringify(message)}\n`);
  }
  const index = waiters.findIndex(waiter => waiter.method === message.method && waiter.predicate(message.params));
  if (index >= 0) {
    const [waiter] = waiters.splice(index, 1);
    clearTimeout(waiter.timer);
    waiter.resolve(message.params);
  } else queued.push(message);
}
createInterface({ input: child.stdout }).on('line', receive);
function request(method, params) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, WAIT_MS);
    pending.set(id, { method, resolve, reject, timer });
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
  });
}
function notify(method, params) { child.stdin.write(`${JSON.stringify({ method, params })}\n`); }
function notification(method, predicate = () => true) {
  const index = queued.findIndex(item => item.method === method && predicate(item.params));
  if (index >= 0) return Promise.resolve(queued.splice(index, 1)[0].params);
  return new Promise((resolve, reject) => {
    const waiter = { method, predicate, resolve, reject };
    waiter.timer = setTimeout(() => {
      const index = waiters.indexOf(waiter);
      if (index >= 0) waiters.splice(index, 1);
      reject(new Error(`${method} notification timed out`));
    }, WAIT_MS);
    waiters.push(waiter);
  });
}
try {
  writeFileSync(eventLog, '');
  await request('initialize', { clientInfo: { name: 'collaboration-contract-checker', version: '1' }, capabilities: { experimentalApi: true } });
  notify('initialized');
  const started = await request('thread/start', {
    model: 'gpt-6-astra', cwd, approvalPolicy: 'never', sandbox: 'danger-full-access', ephemeral: true,
    experimentalRawEvents: true,
  });
  const threadId = started.thread?.id;
  if (typeof threadId !== 'string') throw new Error('thread/start omitted root id');
  const prompt = `Use only azrael_agents collaboration tools. Complete every receipt before the final marker.
1. spawn_agent task_name "live_swe_child", agent_type "devin_swe2_medium", fork_turns "none", message "Reply exactly CHILD_READY." Wait for CHILD_READY. followup_task that child with "Reply exactly FOLLOWUP_READY." Wait for FOLLOWUP_READY.
2. spawn_agent task_name "native_message_child", agent_type "sol_executor", fork_turns "none", message "Reply exactly NATIVE_INITIAL_READY." Wait for NATIVE_INITIAL_READY. send_message NATIVE_PING to the now-idle child, then followup_task it with "Process queued NATIVE_PING and reply exactly NATIVE_ACK." Wait for NATIVE_ACK.
3. spawn_agent task_name "native_interrupt_child", agent_type "luna_explorer", fork_turns "none", message "Wait for further parent instructions and do not finish early." Immediately interrupt_agent that child.
Do not pass model or reasoning_effort. Finally reply exactly APP_SERVER_ROOT_DONE.`;
  const turn = await request('turn/start', { threadId, input: [{ type: 'text', text: prompt, textElements: [] }] });
  const turnId = turn.turn?.id;
  if (typeof turnId !== 'string') throw new Error('turn/start omitted turn id');
  const completed = await notification('turn/completed', params => params?.threadId === threadId && params?.turn?.id === turnId);
  if (completed.turn.status !== 'completed' || completed.turn.error !== null) throw new Error(`root turn failed: ${JSON.stringify(completed.turn)}`);
  await new Promise(resolve => setTimeout(resolve, 500));
  const errors = recorded.filter(event => event.method === 'error');
  if (errors.some(event => /reserved.*configured schema/i.test(JSON.stringify(event.params)))) {
    throw new Error('reserved configured schema error was emitted');
  }
  const raw = recorded.filter(event =>
    event.method === 'rawResponseItem/completed' &&
    event.params?.threadId === threadId && event.params?.turnId === turnId
  ).map(event => event.params.item);
  const calls = raw.filter(item => item.type === 'function_call');
  const outputs = new Map(raw.filter(item => item.type === 'function_call_output').map(item => [item.call_id, item]));
  const requiredCounts = { spawn_agent: 3, followup_task: 2, send_message: 1, interrupt_agent: 1 };
  for (const [name, expected] of Object.entries(requiredCounts)) {
    const selected = calls.filter(item => item.name === name && item.namespace === 'azrael_agents');
    if (selected.length !== expected) throw new Error(`${name} call count differed: ${selected.length}`);
    if (selected.some(item => !outputs.has(item.call_id))) throw new Error(`${name} omitted a matching tool output`);
  }
  const parsedCalls = calls.map(item => ({ ...item, parsed: JSON.parse(item.arguments) }));
  if (parsedCalls.some(item => Object.hasOwn(item.parsed, 'model') || Object.hasOwn(item.parsed, 'reasoning_effort'))) {
    throw new Error('host-default lifecycle unexpectedly supplied model or reasoning_effort');
  }
  const exactCall = (name, predicate) => {
    const selected = parsedCalls.filter(item => item.name === name && predicate(item.parsed));
    if (selected.length !== 1) throw new Error(`${name} exact argument match count differed: ${selected.length}`);
    return selected[0];
  };
  const sweSpawn = exactCall('spawn_agent', args => args.task_name === 'live_swe_child' && args.agent_type === 'devin_swe2_medium' && args.fork_turns === 'none' && args.message === 'Reply exactly CHILD_READY.');
  const sweFollowup = exactCall('followup_task', args => args.target === 'live_swe_child' && args.message === 'Reply exactly FOLLOWUP_READY.');
  const nativeSpawn = exactCall('spawn_agent', args => args.task_name === 'native_message_child' && args.agent_type === 'sol_executor' && args.fork_turns === 'none' && args.message === 'Reply exactly NATIVE_INITIAL_READY.');
  const nativeSend = exactCall('send_message', args => args.target === 'native_message_child' && args.message === 'NATIVE_PING');
  const nativeFollowup = exactCall('followup_task', args => args.target === 'native_message_child' && args.message === 'Process queued NATIVE_PING and reply exactly NATIVE_ACK.');
  const interruptSpawn = exactCall('spawn_agent', args => args.task_name === 'native_interrupt_child' && args.agent_type === 'luna_explorer' && args.fork_turns === 'none');
  const interrupt = exactCall('interrupt_agent', args => args.target === 'native_interrupt_child');
  for (const spawnCall of [sweSpawn, nativeSpawn, interruptSpawn]) {
    const output = JSON.parse(outputs.get(spawnCall.call_id).output);
    if (typeof output.task_name !== 'string' || !output.task_name.endsWith(`/${spawnCall.parsed.task_name}`)) {
      throw new Error(`${spawnCall.parsed.task_name} spawn output omitted canonical task name`);
    }
  }
  const typed = recorded.filter(event => event.method === 'item/completed').map(event => event.params);
  const activities = typed.filter(params => params.threadId === threadId && params.turnId === turnId && params.item?.type === 'subAgentActivity');
  const activity = (call, kind) => {
    const selected = activities.filter(params => params.item.id === call.call_id && params.item.kind === kind);
    if (selected.length !== 1) throw new Error(`${call.name} ${kind} activity count differed: ${selected.length}`);
    return selected[0].item;
  };
  const sweChild = activity(sweSpawn, 'started').agentThreadId;
  activity(sweFollowup, 'interacted');
  const nativeChild = activity(nativeSpawn, 'started').agentThreadId;
  activity(nativeSend, 'interacted');
  activity(nativeFollowup, 'interacted');
  const interruptChild = activity(interruptSpawn, 'started').agentThreadId;
  const interrupted = activity(interrupt, 'interrupted');
  if (interrupted.agentThreadId !== interruptChild) throw new Error('interrupt targeted a different child');
  const interruptOutput = JSON.parse(outputs.get(interrupt.call_id).output);
  if (interruptOutput.previous_status !== 'running') throw new Error(`interrupt was not exercised while active: ${outputs.get(interrupt.call_id).output}`);
  const childMessages = typed.filter(params => params.item?.type === 'agentMessage');
  for (const [childId, marker] of [[sweChild, 'CHILD_READY'], [sweChild, 'FOLLOWUP_READY'], [nativeChild, 'NATIVE_INITIAL_READY'], [nativeChild, 'NATIVE_ACK']]) {
    if (!childMessages.some(params => params.threadId === childId && params.item.text === marker)) throw new Error(`child marker missing: ${marker}`);
  }
  if (!childMessages.some(params => params.threadId === threadId && params.turnId === turnId && params.item.text === 'APP_SERVER_ROOT_DONE')) {
    throw new Error('app-server root marker missing');
  }
  process.stdout.write(JSON.stringify({
    threadId, turnId, status: completed.turn.status,
    completedCalls: Object.fromEntries(Object.keys(requiredCounts).map(name => [name, calls.filter(item => item.name === name && outputs.has(item.call_id)).length])),
    childMarkers: ['CHILD_READY', 'FOLLOWUP_READY', 'NATIVE_INITIAL_READY', 'NATIVE_ACK'],
    interruptPreviousStatus: interruptOutput.previous_status,
  }));
} catch (error) {
  process.stderr.write(`${error.stack ?? error}\n${stderr}`);
  process.exitCode = 1;
} finally {
  child.stdin.end();
  setTimeout(() => child.kill(), 1_000).unref();
}
'@ | Set-Content -LiteralPath $helper -Encoding utf8NoBOM
    & node $helper $engine $fixture (Join-Path $logs 'app-server-lifecycle.events.jsonl') 1> $stdout 2> $stderr
    $exitCode = $LASTEXITCODE
    Set-Content -LiteralPath (Join-Path $logs 'app-server-lifecycle.exitcode.txt') -Value $exitCode
    if ($exitCode -ne 0) { throw 'App-server lifecycle probe failed.' }
}

$previousHome = $env:CODEX_HOME
$previousDevin = $env:AZRAEL_EX_DEVIN_EXECUTABLE
$previousPlaintext = $env:AZRAEL_EX_PLAINTEXT_AGENTS
try {
    $env:CODEX_HOME = $state
    $env:AZRAEL_EX_DEVIN_EXECUTABLE = $devin
    $env:AZRAEL_EX_PLAINTEXT_AGENTS = '1'
    $results = @()
    foreach ($probe in @(
        @{ Name = 'astra-opt-in'; Model = 'gpt-6-astra'; Marker = 'ASTRA_OK' },
        @{ Name = 'sol-smoke'; Model = 'gpt-5.6-sol'; Marker = 'SOL_OK' },
        @{ Name = 'terra-smoke'; Model = 'gpt-5.6-terra'; Marker = 'TERRA_OK' },
        @{ Name = 'luna-smoke'; Model = 'gpt-5.6-luna'; Marker = 'LUNA_OK' }
    )) {
        $results += Invoke-Probe -Name $probe.Name -Model $probe.Model -Prompt "LIVE read-only smoke. Reply exactly $($probe.Marker). Do not call tools."
    }
    $results += Invoke-Probe -Name 'devin-direct-smoke' -Model 'devin/swe-2-high' -Unrestricted -Prompt 'LIVE read-only content smoke under the unrestricted native execution prerequisite. Reply exactly DEVIN_DIRECT_OK. Do not call tools or access files.'
    $results += Invoke-Probe -Name 'astra-explicit-native' -Model 'gpt-6-astra' -Prompt 'LIVE native schema smoke. Reply exactly NATIVE_SCHEMA_OK. Do not call tools.' -Config @('features.multi_agent=true', 'features.multi_agent_v2={enabled=true,tool_namespace="collaboration"}')
    $results += Invoke-Probe -Name 'astra-swe-lifecycle' -Model 'gpt-6-astra' -Unrestricted -Prompt @'
Mandatory live tool exercise: do not print ROOT_DONE unless every requested tool receipt succeeded. Use azrael_agents.spawn_agent exactly once with task_name "live_swe_child", agent_type "devin_swe2_medium", fork_turns "none", and message "Reply exactly CHILD_READY." Do not pass model or reasoning_effort because the exact role owns them. Wait until that child completes and returns CHILD_READY. Then use azrael_agents.followup_task exactly once on the same child with message "Reply exactly FOLLOWUP_READY." Wait until it completes and returns FOLLOWUP_READY. Finally reply exactly ROOT_DONE. Do not use any other tool.
'@
    $results += Invoke-Probe -Name 'astra-native-message-lifecycle' -Model 'gpt-6-astra' -Prompt @'
Mandatory live tool exercise: do not print ROOT_NATIVE_MESSAGE_DONE unless every requested tool receipt succeeded. Use azrael_agents.spawn_agent exactly once with task_name "native_message_child", agent_type "sol_executor", fork_turns "none", and message "Reply exactly NATIVE_INITIAL_READY." Wait until that child completes and returns NATIVE_INITIAL_READY. Use azrael_agents.send_message exactly once to queue NATIVE_PING to that now-idle child. Then use azrael_agents.followup_task exactly once on the same child with message "Process the queued NATIVE_PING and reply exactly NATIVE_ACK." Wait until the child returns NATIVE_ACK. Finally reply exactly ROOT_NATIVE_MESSAGE_DONE. Do not use any other tool.
'@
    $results += Invoke-Probe -Name 'astra-native-interrupt-lifecycle' -Model 'gpt-6-astra' -Prompt @'
Mandatory live tool exercise: do not print ROOT_NATIVE_INTERRUPT_DONE unless every requested tool receipt succeeded. Use azrael_agents.spawn_agent exactly once with task_name "native_interrupt_child", agent_type "luna_explorer", fork_turns "none", and message "Wait for further parent instructions and do not finish early." Immediately use azrael_agents.interrupt_agent exactly once on that child. Finally reply exactly ROOT_NATIVE_INTERRUPT_DONE. Do not use any other tool.
'@
    Invoke-AppServerLifecycleProbe
    $summary = [pscustomobject]@{ engine = $engine; engineSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $engine).Hash; results = $results }
    $summary | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $logs 'summary.json') -Encoding utf8NoBOM

    foreach ($result in $results) {
        if ($result.exitCode -ne 0 -or $result.hasReservedSchemaError) { throw "Probe $($result.name) failed." }
    }
    foreach ($expected in @(
        @{ Name = 'astra-opt-in'; Marker = 'ASTRA_OK' },
        @{ Name = 'sol-smoke'; Marker = 'SOL_OK' },
        @{ Name = 'terra-smoke'; Marker = 'TERRA_OK' },
        @{ Name = 'luna-smoke'; Marker = 'LUNA_OK' },
        @{ Name = 'devin-direct-smoke'; Marker = 'DEVIN_DIRECT_OK' },
        @{ Name = 'astra-explicit-native'; Marker = 'NATIVE_SCHEMA_OK' }
    )) {
        $result = $results | Where-Object name -eq $expected.Name
        if ($result.messages -notcontains $expected.Marker) { throw "$($expected.Name) omitted marker $($expected.Marker)." }
    }
    $swe = $results | Where-Object name -eq 'astra-swe-lifecycle'
    if ($swe.messages -notcontains 'ROOT_DONE') { throw 'SWE lifecycle root marker missing.' }
    $nativeMessage = $results | Where-Object name -eq 'astra-native-message-lifecycle'
    if ($nativeMessage.messages -notcontains 'ROOT_NATIVE_MESSAGE_DONE') { throw 'Native message lifecycle root marker missing.' }
    $nativeInterrupt = $results | Where-Object name -eq 'astra-native-interrupt-lifecycle'
    if ($nativeInterrupt.messages -notcontains 'ROOT_NATIVE_INTERRUPT_DONE') { throw 'Native interrupt root marker missing.' }
    $summary
} finally {
    $env:CODEX_HOME = $previousHome
    $env:AZRAEL_EX_DEVIN_EXECUTABLE = $previousDevin
    $env:AZRAEL_EX_PLAINTEXT_AGENTS = $previousPlaintext
}
