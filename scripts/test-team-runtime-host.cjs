'use strict';
// Retained host-boundary regression coverage. Run owner cleans the registered fixtures.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { createTeamRuntimeHost, addTeamTools, isTeamRequest, TOOL, GUIDE } = require('./team-runtime-host.cjs');
const { createTeamChangeService } = require('./team-change-service.cjs');
async function main() {
  const root = path.resolve(__dirname, '../artifacts/tasks/BQ-01/runs/host/temporary', crypto.randomUUID());
  await fs.mkdir(root, { recursive: true });
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
  git('init', '-q'); git('config', 'user.email', 'fixture@example.invalid'); git('config', 'user.name', 'Fixture');
  await fs.writeFile(path.join(root, 'fixture'), 'fixed'); git('add', 'fixture'); git('commit', '-qm', 'fixture');
  const head = git('rev-parse', 'HEAD');
  const leadId = 'lead-uuid'; const childId = 'child-uuid';
  const teamId = 'azrael-team:' + JSON.stringify(['local', leadId]);
  const registry = { version: 1, teams: [{ id: teamId, hostId: 'local', leadId, memberIds: [] }] };
  const threads = new Map([
    [leadId, { id: leadId, cwd: root, parentThreadId: null }],
    [childId, { id: childId, cwd: root, parentThreadId: leadId }],
    ['grandchild', { id: 'grandchild', cwd: root, parentThreadId: childId }],
    ['fork', { id: 'fork', cwd: root, parentThreadId: null, forkedFromId: leadId }],
  ]);
  const warnings = [];
  const hostOptions = { readRegistry: async () => registry, readThread: async id => ({ thread: threads.get(id) }), logger: { warning: (...args) => warnings.push(args) } };
  let host = createTeamRuntimeHost(hostOptions); let sequence = 0;
  function request(threadId, action, args = {}, extra = {}) {
    return { method: 'item/tool/call', params: { namespace: 'team', tool: 'manage_changes', threadId, arguments: { action, operationId: `host-op-${++sequence}`, args, ...extra } } };
  }
  async function ok(threadId, action, args, extra) { const result = await host.call(request(threadId, action, args, extra)); assert.notEqual(result.ok, false, JSON.stringify(result)); return result; }
  async function denied(code, threadId, action, args, extra) {
    let result; try { result = await host.call(request(threadId, action, args, extra)); } catch (error) { assert.equal(error.code, code); return; }
    assert.equal(result.error?.code, code, JSON.stringify(result));
  }
  assert.equal((await host.resolveContext('grandchild')).team.id, teamId);
  assert.equal(await host.resolveContext('fork'), null);
  await denied('NOT_TEAM_MEMBER', 'fork', 'status');
  await denied('INVALID_ARGUMENTS', childId, 'status', {}, { callerId: leadId });
  await denied('INVALID_ARGUMENTS', childId, 'status', {}, { actorId: leadId });
  const task = { taskId: 'task', designVersion: 'd1', requirementsVersion: 'r1', scope: ['core'], requiredChecks: ['test'], dependencies: [], assignedSessionId: childId };
  await denied('COORDINATOR_REQUIRED', childId, 'create_task', task);
  await ok(leadId, 'create_task', task);
  await denied('COORDINATOR_REQUIRED', childId, 'change_request', { taskId: task.taskId, designVersion: 'd2', requirementsVersion: 'r2' });
  const evidence = exitCode => [{ candidateCommit: head, inputId: 'fixed', environmentId: 'windows', commandId: 'test', exitCode, logRef: 'artifact:host-test', scope: ['test'] }];
  const submission = { taskId: task.taskId, changeId: 'change', baseCommit: head, resultCommit: head, designVersion: 'd1', requirementsVersion: 'r1', dependencies: [], validation: evidence(0) };
  await denied('TASK_OWNERSHIP', 'grandchild', 'submit', submission);
  await denied('INVALID_FIELDS', childId, 'submit', { ...submission, actorId: leadId });
  await ok(childId, 'acknowledge_change', { taskId: task.taskId, designVersion: 'd1', requirementsVersion: 'r1' });
  assert.equal((await ok(childId, 'submit', submission)).revision, 1);
  const begin = { changeId: 'change', revision: 1, candidateCommit: head, expectedTeamCommit: head };
  const reservation = await ok(childId, 'begin_integration', begin);
  const reserved = { reservationId: reservation.reservationId, generation: reservation.generation, candidateCommit: head };
  await ok(childId, 'finish_integration', { ...reserved, validation: evidence(1) });
  await denied('COORDINATOR_REQUIRED', childId, 'accept_integration', reserved);
  await denied('VALIDATION_INCOMPLETE', leadId, 'accept_integration', reserved);
  await denied('COORDINATOR_REQUIRED', childId, 'recover', { reservationId: reserved.reservationId, generation: reserved.generation, observedCommit: head, resolution: 'abort' });
  await ok(leadId, 'recover', { reservationId: reserved.reservationId, generation: reserved.generation, observedCommit: head, resolution: 'abort' });
  const retry = await ok(childId, 'begin_integration', begin);
  const retryArgs = { reservationId: retry.reservationId, generation: retry.generation, candidateCommit: head };
  await ok(childId, 'finish_integration', { ...retryArgs, validation: evidence(0) });
  await ok(leadId, 'accept_integration', retryArgs);
  host = createTeamRuntimeHost(hostOptions);
  const status = await ok(leadId, 'status');
  assert.equal(status.state.teamId, teamId); assert.equal(status.state.lastVerifiedCommit, head);
  assert.equal(status.state.changes.change.integratedRevision, 1);
  assert.equal(git('rev-parse', status.state.verifiedRef), head);
  const service = createTeamChangeService({ repoRoot: root, teamId });
  const storageDir = await service.getStorageDir();
  assert.equal(storageDir, path.join(root, '.git', 'azrael', 'teams', crypto.createHash('sha256').update(teamId).digest('hex')));
  assert.equal((await service.read()).changes.change.revisions[0].actorId, childId);
  assert.equal(isTeamRequest({ method: 'item/tool/call', params: { namespace: 'other', tool: 'manage_changes' } }), false);
  assert.equal(isTeamRequest({ method: 'item/tool/call', params: { namespace: 'team', tool: 'other' } }), false);
  await assert.rejects(host.call({ method: 'other', params: {} }), { code: 'UNKNOWN_TOOL' });
  const existing = { name: 'existing', type: 'function', inputSchema: {} };
  const params = { cwd: root, config: { 'features.unrelated': false, choice: 'kept' }, dynamicTools: [existing], developerInstructions: 'existing guidance', untouched: { keep: true } };
  const enhanced = addTeamTools(params);
  assert.deepEqual(enhanced.dynamicTools, [existing, TOOL]);
  assert.deepEqual(enhanced.config, { ...params.config, 'features.multi_agent_v2_dynamic_tools': true });
  assert.equal(enhanced.developerInstructions, 'existing guidance\n\n' + GUIDE);
  assert.deepEqual(params.dynamicTools, [existing]); assert.equal(params.config['features.multi_agent_v2_dynamic_tools'], undefined);
  assert.deepEqual(enhanced.untouched, params.untouched);
  assert.equal(addTeamTools({ dynamicTools: [TOOL] }).dynamicTools.length, 1);
  assert.throws(() => addTeamTools({ dynamicTools: [{ name: 'team', type: 'namespace', tools: [] }] }), { code: 'TOOL_COLLISION' });
  assert.throws(() => addTeamTools({ dynamicTools: 'invalid' }), { code: 'INVALID_TOOLS' });
  const secret = 'DO_NOT_PERSIST_prompt_or_command_body';
  const notify = (method, params) => host.observeNotification({ method, params: { threadId: childId, turnId: 'turn-1', ...params } });
  await notify('thread/tokenUsage/updated', { tokenUsage: { total: { inputTokens: 0, outputTokens: 0 }, text: secret } });
  await notify('turn/started', { turn: { id: 'turn-1', status: 'inProgress', text: secret } });
  await notify('item/started', { item: { id: 'item-1', type: 'commandExecution', status: 'inProgress', command: secret, text: secret } });
  await notify('item/completed', { item: { id: 'item-1', type: 'commandExecution', status: 'completed', exitCode: 0, aggregatedOutput: secret } });
  await notify('thread/tokenUsage/updated', { tokenUsage: { total: { inputTokens: 100, outputTokens: 20 } } });
  await notify('thread/tokenUsage/updated', { tokenUsage: { total: { inputTokens: 150, outputTokens: 30 } } });
  await notify('thread/tokenUsage/updated', { tokenUsage: { total: { inputTokens: 150, outputTokens: 30 } } });
  await notify('turn/completed', { turn: { id: 'turn-1', status: 'completed', text: secret } });
  const observed = await ok(leadId, 'status');
  assert.equal(observed.nativeObservation.complete, true); assert.equal(observed.nativeObservation.droppedEvents, 0);
  assert.equal(observed.observation.health.complete, false);
  assert.equal(observed.observation.health.usageBaselineMissing, 1);
  assert.equal(observed.observation.health.invalidEvents, 0);
  assert.equal(observed.observation.health.writeFailures, 0);
  assert.equal(observed.observation.usage.inputTokens, 150); assert.equal(observed.observation.usage.outputTokens, 30);
  assert.equal(observed.observation.phases.find(phase => phase.phase === 'turn').activeCount, 0);
  assert.equal(observed.observation.phases.find(phase => phase.phase === 'tool').sampleCount, 1);
  async function verifyNoLeak(directory) { for (const entry of await fs.readdir(directory, { withFileTypes: true })) { const target = path.join(directory, entry.name); if (entry.isDirectory()) await verifyNoLeak(target); else assert.equal((await fs.readFile(target, 'utf8')).includes(secret), false, target); } }
  await verifyNoLeak(storageDir);
  // Collector failures must be surfaced without returning raw exception contents.
  const broken = createTeamRuntimeHost({ ...hostOptions, createObserver: () => ({ record: async () => { throw Error(secret); }, summary: async () => ({ health: { complete: false } }) }) });
  await broken.observeNotification({ method: 'turn/started', params: { threadId: childId, turn: { id: 'broken-turn' } } });
  const brokenStatus = await broken.call(request(leadId, 'status'));
  assert.equal(brokenStatus.nativeObservation.complete, false); assert.equal(brokenStatus.nativeObservation.droppedEvents, 1);
  assert.equal(JSON.stringify(warnings).includes(secret), false);
  // Execute the host methods and bundled modules that ship in the transformed
  // native asset, including the direct engine sendResponse path.
  const injector = require('./inject-team-runtime.cjs');
  const pinned = path.resolve(__dirname, '../artifacts/upstream-ui/26.1007.21434', injector.HOST_ASSET);
  const transformed = injector.injectTeamRuntime(await fs.readFile(pinned, 'utf8'), injector.HOST_ASSET).text;
  const helper = transformed.slice(transformed.lastIndexOf(injector.MARKER) + injector.MARKER.length);
  const methods = transformed.slice(transformed.indexOf('async azraelPrepareTeamRequest('), transformed.indexOf('async deliverMcpResponseToOrigin(e){try{e=await this.azraelFinishTeamRequest(e)}'));
  const context = vm.createContext({ require, process, Buffer, structuredClone, console, setTimeout, clearTimeout, URLSearchParams });
  vm.runInContext(helper + `\nglobalThis.NativeHost=class{${methods}}`, context);
  const native = new context.NativeHost();
  native.readPersistedAtomState = async () => ({ [injector.REGISTRY_KEY]: registry });
  native.fetchWrapper = { extensionFetchHandler: { sendInternalAppServerRequest: async (method, params) => {
    assert.equal(method, 'thread/read'); return { thread: threads.get(params.threadId) };
  } } };
  native.logger = hostOptions.logger;
  let resolveNative;
  const delivered = new Promise(resolve => { resolveNative = resolve; });
  native.codexMcpConnection = { sendResponse: (id, result) => resolveNative({ id, result }) };
  assert.equal(native.azraelHandleTeamTool({ method: 'ordinary/request', params: {} }), false);
  const nativeRequest = { ...request(leadId, 'status'), id: 'native-call-id' };
  nativeRequest.params.arguments = JSON.stringify(nativeRequest.params.arguments);
  assert.equal(native.azraelHandleTeamTool(nativeRequest), true);
  const nativeResponse = await delivered;
  assert.equal(nativeResponse.id, 'native-call-id'); assert.equal(nativeResponse.result.success, true);
  assert.equal(JSON.parse(nativeResponse.result.contentItems[0].text).state.teamId, teamId);
  assert(transformed.includes('onRequest:F=>{if(this.azraelHandleTeamTool(F))return;'));
  assert(transformed.includes('onRawNotification:F=>{this.azraelObserveTeamNotification(F);'));
  console.log('PASS native Team ancestry/identity, task ownership, Lead acceptance/ref reopen, failed evidence, tool preservation/collision, native timing/cumulative usage, collector health and text exclusion');
  console.log(`Fixtures: ${root}`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
