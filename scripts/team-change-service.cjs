'use strict';
// Metadata authority only: candidate creation and test execution belong to existing tools.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);
const LIMIT = 2 * 1024 * 1024;
const MAX_OPERATIONS = 1024;
function fail(code) { const error = new Error(code); error.code = code; throw error; }
function plain(value) { return value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
function fields(value, allowed) { if (!plain(value) || Object.keys(value).some(key => !allowed.includes(key))) fail('INVALID_FIELDS'); }
function id(value) { if (typeof value !== 'string' || ['__proto__', 'prototype', 'constructor'].includes(value) || !/^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$/.test(value)) fail('INVALID_ID'); return value; }
function ids(value) { if (!Array.isArray(value) || value.length > 128) fail('INVALID_LIST'); value.forEach(id); if (new Set(value).size !== value.length) fail('DUPLICATE_ID'); return value; }
function boundedText(value) { if (typeof value !== 'string' || !value.length || Buffer.byteLength(value, 'utf8') > 2048 || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) fail('INVALID_TEXT'); return value; }
function scopes(value) { if (!Array.isArray(value) || value.length > 128) fail('INVALID_LIST'); value.forEach(boundedText); if (new Set(value).size !== value.length) fail('DUPLICATE_SCOPE'); return value; }
function canonical(value) { if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'; if (plain(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'; return JSON.stringify(value); }
function dependencies(value) { if (!Array.isArray(value) || value.length > 128) fail('INVALID_DEPENDENCIES'); value.forEach(item => { fields(item, ['changeId', 'revision']); id(item.changeId); if (!Number.isSafeInteger(item.revision) || item.revision < 1) fail('INVALID_REVISION'); }); if (new Set(value.map(x => x.changeId)).size !== value.length) fail('DUPLICATE_DEPENDENCY'); return value; }
function validation(value, candidate) {
  if (!Array.isArray(value) || value.length > 128) fail('INVALID_VALIDATION');
  return value.map(item => {
    fields(item, ['candidateCommit', 'inputId', 'environmentId', 'commandId', 'exitCode', 'logRef', 'scope']);
    for (const key of ['inputId', 'environmentId', 'commandId']) id(item[key]);
    boundedText(item.logRef);
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(item.candidateCommit) || (candidate && item.candidateCommit !== candidate) || !Number.isSafeInteger(item.exitCode)) fail('INVALID_VALIDATION');
    scopes(item.scope); return { ...item, provenance: 'caller_reported' };
  });
}
async function safePath(target, create = false) {
  const absolute = path.resolve(target); const parsed = path.parse(absolute); let cursor = parsed.root;
  for (const part of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    let stat; try { stat = await fs.lstat(cursor); } catch (error) { if (error.code !== 'ENOENT') throw error; if (!create) fail('MISSING_PATH'); try { await fs.mkdir(cursor); } catch (e) { if (e.code !== 'EEXIST') throw e; } stat = await fs.lstat(cursor); }
    if (stat.isSymbolicLink() || !stat.isDirectory()) fail('UNSAFE_PATH');
  }
  return absolute;
}
function createTeamChangeService(options) {
  const { repoRoot, teamId, storageRoot, onTransition, isCoordinator = () => false } = options;
  if (typeof teamId !== 'string' || !teamId.length || Buffer.byteLength(teamId, 'utf8') > 1024 || /[\u0000-\u001f\u007f-\u009f]/u.test(teamId)) fail('INVALID_TEAM_ID');
  const root = path.resolve(repoRoot); const hash = crypto.createHash('sha256').update(teamId).digest('hex');
  const ref = `refs/azrael/teams/${hash}/verified`; let initialized;
  const gitOptions = process.platform === 'win32' ? ['-c', 'core.longpaths=true'] : [];
  async function git(args) { try { return (await exec('git', [...gitOptions, ...args], { cwd: root, windowsHide: true, maxBuffer: LIMIT })).stdout.trim(); } catch (error) { fail('GIT_FAILED'); } }
  async function commit(value) { id(value); return git(['rev-parse', '--verify', '--end-of-options', `${value}^{commit}`]); }
  async function ancestor(base, tip) { try { await exec('git', [...gitOptions, 'merge-base', '--is-ancestor', base, tip], { cwd: root, windowsHide: true }); } catch { fail('CANDIDATE_ANCESTRY'); } }
  async function pinObject(commitId) {
    const objectRef = `refs/azrael/teams/${hash}/objects/${commitId}`;
    try { await git(['update-ref', '--no-deref', objectRef, commitId, '0'.repeat(commitId.length)]); }
    catch { if (await git(['rev-parse', '--verify', '--end-of-options', objectRef]) !== commitId) fail('OBJECT_PIN_CONFLICT'); }
  }
  async function init() {
    await safePath(root);
    const common = await safePath(path.resolve(root, await git(['rev-parse', '--git-common-dir'])));
    const directory = await safePath(storageRoot ? path.join(path.resolve(storageRoot), hash) : path.join(common, 'azrael', 'teams', hash), true);
    return { common, directory, stateFile: path.join(directory, 'state.json'), lockFile: path.join(directory, 'write.lock') };
  }
  function context() { return initialized ||= init().catch(error => { initialized = null; throw error; }); }
  async function load(ctx) {
    await safePath(ctx.directory);
    let handle; try { const stat = await fs.lstat(ctx.stateFile); if (!stat.isFile() || stat.isSymbolicLink()) fail('UNSAFE_STATE'); if (stat.size > LIMIT) fail('STATE_TOO_LARGE'); handle = await fs.open(ctx.stateFile, 'r'); const raw = await handle.readFile('utf8'); if (Buffer.byteLength(raw) > LIMIT) fail('STATE_TOO_LARGE'); let state; try { state = JSON.parse(raw); } catch { fail('CORRUPT_STATE'); }
      if (!plain(state) || state.schema !== 1 || state.teamId !== teamId || state.repository !== ctx.common || !plain(state.tasks) || !plain(state.changes) || !plain(state.operations) || !Array.isArray(state.events) || !Number.isSafeInteger(state.generation) || typeof state.lastVerifiedCommit !== 'string' || Object.keys(state.operations).length > MAX_OPERATIONS || state.events.length > 256) fail('CORRUPT_STATE');
      try {
        function storedValidation(entries) { if (!Array.isArray(entries) || entries.length > 128) fail('CORRUPT_STATE'); for (const entry of entries) { scopes(entry.scope); boundedText(entry.logRef); } }
        for (const [taskId, task] of Object.entries(state.tasks)) { id(taskId); if (!plain(task) || !plain(task.requested) || !plain(task.applied)) fail('CORRUPT_STATE'); scopes(task.scope); ids(task.requiredChecks); dependencies(task.dependencies); for (const version of [task.requested, task.applied]) { id(version.designVersion); id(version.requirementsVersion); } }
        for (const [changeId, change] of Object.entries(state.changes)) { id(changeId); if (!plain(change) || !Object.hasOwn(state.tasks, change.taskId) || !Array.isArray(change.revisions)) fail('CORRUPT_STATE'); change.revisions.forEach((revision, index) => { if (!plain(revision) || revision.revision !== index + 1 || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(revision.resultCommit)) fail('CORRUPT_STATE'); scopes(revision.scope); storedValidation(revision.validation); ids(revision.requiredChecks); dependencies(revision.dependencies); }); }
        for (const [operationId, operation] of Object.entries(state.operations)) { id(operationId); if (!plain(operation) || !/^[a-f0-9]{64}$/.test(operation.fingerprint) || !plain(operation.result)) fail('CORRUPT_STATE'); }
        if (state.reservation && (!plain(state.reservation) || !Object.hasOwn(state.changes, state.reservation.changeId))) fail('CORRUPT_STATE');
        if (state.reservation) storedValidation(state.reservation.validation);
      } catch { fail('CORRUPT_STATE'); }
      return state;
    } catch (error) { if (error.code !== 'ENOENT') throw error; return null; } finally { await handle?.close(); }
  }
  async function save(ctx, state) {
    const raw = JSON.stringify(state); if (Buffer.byteLength(raw) > LIMIT) fail('STATE_TOO_LARGE');
    const temporary = path.join(ctx.directory, `state-${crypto.randomUUID()}.tmp`); let handle;
    try {
      await safePath(ctx.directory);
      handle = await fs.open(temporary, 'wx', 0o600); await handle.writeFile(raw); await handle.sync(); await handle.close(); handle = null; await fs.rename(temporary, ctx.stateFile);
      // Windows does not expose directory fsync through Node; file data is synced above.
      if (process.platform !== 'win32') { const directory = await fs.open(ctx.directory, 'r'); try { await directory.sync(); } finally { await directory.close(); } }
    } finally { await handle?.close(); try { await fs.unlink(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
  }
  async function seed(ctx) {
    const head = await commit('HEAD'); let current;
    try { current = await commit(ref); } catch (error) {
      // Expected-old zero prevents competing service initialization from overwriting a ref.
      try { await git(['update-ref', ref, head, '0'.repeat(head.length)]); current = head; } catch { current = await commit(ref); }
    }
    return { schema: 1, teamId, repository: ctx.common, repoCommonDir: ctx.common, verifiedRef: ref, lastVerifiedCommit: current, generation: 0, tasks: {}, changes: {}, reservation: null, intent: null, operations: {}, events: [] };
  }
  async function reconcile(ctx, state) {
    if (!state.intent) return;
    const observed = await commit(ref); const intent = state.intent;
    if (observed !== intent.candidateCommit && observed !== intent.expectedTeamCommit) fail('REF_DIVERGED');
    if (observed === intent.expectedTeamCommit) await git(['update-ref', ref, intent.candidateCommit, intent.expectedTeamCommit]);
    state.lastVerifiedCommit = intent.candidateCommit;
    state.changes[intent.changeId].integratedRevision = intent.revision;
    state.tasks[state.changes[intent.changeId].taskId].status = 'integrated';
    state.integrationHistory ||= [];
    state.integrationHistory.push({ ...intent, status: 'integrated', acceptedAt: new Date().toISOString() });
    state.reservation = null; state.intent = null;
    state.operations[intent.operationId] = { fingerprint: intent.fingerprint, result: { status: 'integrated', commit: intent.candidateCommit } };
    await save(ctx, state);
  }
  async function read() {
    const ctx = await context(); const state = await load(ctx);
    let writeLock = null;
    try { const lock = await inspectLock(ctx); if (lock) writeLock = { lockId: lock.record.lockId, pid: lock.record.pid, hostname: lock.record.hostname, createdAt: lock.record.createdAt }; }
    catch { writeLock = { status: 'protected', reason: 'LOCK_UNVERIFIABLE' }; }
    return { ...(state ? structuredClone(state) : { teamId, initialized: false }), writeLock };
  }
  async function inspectLock(ctx) {
    let stat; try { stat = await fs.lstat(ctx.lockFile); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) fail('LOCK_UNVERIFIABLE');
    const raw = await fs.readFile(ctx.lockFile, 'utf8'); if (Buffer.byteLength(raw) > 4096) fail('LOCK_UNVERIFIABLE');
    let record; try { record = JSON.parse(raw); } catch { fail('LOCK_UNVERIFIABLE'); }
    if (!plain(record) || !/^[a-f0-9-]{36}$/.test(record.lockId) || !Number.isSafeInteger(record.pid) || record.pid < 1 || typeof record.hostname !== 'string' || record.hostname.length > 255 || /[\u0000-\u001f\u007f]/.test(record.hostname) || typeof record.createdAt !== 'string' || !Number.isFinite(Date.parse(record.createdAt))) fail('LOCK_UNVERIFIABLE');
    return { stat, raw, record };
  }
  async function recoverWriteLock(ctx, actorId, expectedLockId) {
    if (isCoordinator(actorId) !== true) fail('COORDINATOR_REQUIRED'); id(expectedLockId);
    const guardPath = path.join(ctx.directory, 'lock-recovery.lock'); let guard;
    try { guard = await fs.open(guardPath, 'wx', 0o600); } catch (error) { if (error.code === 'EEXIST') fail('LOCK_RECOVERY_BUSY'); throw error; }
    try {
      const lock = await inspectLock(ctx); if (!lock) return { ok: true, status: 'write_lock_absent' };
      if (lock.record.lockId !== expectedLockId) fail('LOCK_ID_MISMATCH');
      if (lock.record.hostname !== os.hostname()) fail('LOCK_FOREIGN_HOST');
      try { process.kill(lock.record.pid, 0); fail('LOCK_OWNER_ALIVE'); } catch (error) { if (error.code !== 'ESRCH') fail(error.code === 'LOCK_OWNER_ALIVE' ? 'LOCK_OWNER_ALIVE' : 'LOCK_OWNER_UNVERIFIABLE'); }
      const current = await inspectLock(ctx);
      if (!current || current.raw !== lock.raw || current.stat.dev !== lock.stat.dev || current.stat.ino !== lock.stat.ino || current.stat.mtimeMs !== lock.stat.mtimeMs || current.stat.ctimeMs !== lock.stat.ctimeMs) fail('LOCK_CHANGED');
      await fs.unlink(ctx.lockFile);
      // Recovery is an explicit filesystem repair, not a journaled Team transition.
      // A repeat observes absence; it never replays an earlier successful removal.
      return { ok: true, status: 'write_lock_recovered' };
    } finally { await guard.close(); await fs.unlink(guardPath); }
  }
  const actionFields = {
    create_task: ['taskId', 'designVersion', 'requirementsVersion', 'scope', 'dependencies', 'assignedSessionId', 'requiredChecks'],
    change_request: ['taskId', 'requirementsVersion', 'designVersion'], acknowledge_change: ['taskId', 'requirementsVersion', 'designVersion'],
    submit: ['taskId', 'changeId', 'baseCommit', 'resultCommit', 'requirementsVersion', 'designVersion', 'dependencies', 'validation'],
    begin_integration: ['changeId', 'revision', 'candidateCommit', 'expectedTeamCommit'],
    finish_integration: ['reservationId', 'generation', 'candidateCommit', 'validation'],
    accept_integration: ['reservationId', 'generation', 'candidateCommit'],
    recover: ['reservationId', 'generation', 'observedCommit', 'resolution'],
    recover_write_lock: ['expectedLockId']
  };
  async function dispatch(request) {
    try { return await dispatchInternal(request); } catch (error) { return { ok: false, error: { code: error.code || 'STORAGE_FAILED' } }; }
  }
  async function dispatchInternal(request) {
    fields(request, ['action', 'operationId', 'actorId', 'args']);
    if (request.action === 'status') { if (request.args && Object.keys(request.args).length) fail('INVALID_FIELDS'); return { ok: true, state: await read() }; }
    if (!Object.hasOwn(actionFields, request.action)) fail('INVALID_ACTION');
    const { action, actorId, operationId } = request; id(actorId); id(operationId);
    const args = request.args; fields(args, actionFields[action]);
    // JSON round-trip removes references to caller-owned mutable objects and rejects unsupported values.
    const a = JSON.parse(JSON.stringify(args));
    const fingerprint = crypto.createHash('sha256').update(canonical({ action, actorId, args: a })).digest('hex');
    const ctx = await context();
    await safePath(ctx.directory);
    if (await safePath(path.resolve(root, await git(['rev-parse', '--git-common-dir']))) !== ctx.common) fail('REPOSITORY_MISMATCH');
    if (action === 'recover_write_lock') return recoverWriteLock(ctx, actorId, a.expectedLockId);
    let lock;
    try { lock = await fs.open(ctx.lockFile, 'wx', 0o600); } catch (error) { if (error.code === 'EEXIST') fail('WRITE_LOCKED'); throw error; }
    try {
      await lock.writeFile(JSON.stringify({ lockId: crypto.randomUUID(), pid: process.pid, hostname: os.hostname(), operationId, actorId, createdAt: new Date().toISOString() })); await lock.sync();
      let s = await load(ctx) || await seed(ctx); await reconcile(ctx, s);
      const prior = s.operations[operationId]; if (prior) { if (prior.fingerprint !== fingerprint) fail('OPERATION_CONFLICT'); return { ok: true, ...prior.result, replayed: true }; }
      if (Object.keys(s.operations).length >= MAX_OPERATIONS) fail('OPERATION_CAPACITY');
      if (await commit(ref) !== s.lastVerifiedCommit) fail('REF_DIVERGED');
      let result; let pendingPins = [];
      function task() { id(a.taskId); const t = s.tasks[a.taskId]; if (!t) fail('TASK_NOT_FOUND'); return t; }
      function authorizeTask(t) { if (isCoordinator(actorId) !== true && (!t.assignedSessionId || t.assignedSessionId !== actorId)) fail('TASK_OWNERSHIP'); }
      function versions(t) { for (const key of ['requirementsVersion', 'designVersion']) { id(a[key]); if (t.requested[key] !== a[key] || t.applied[key] !== a[key]) fail('VERSION_NOT_ACKNOWLEDGED'); } }
      function depsReady(deps) { return deps.every(dep => s.changes[dep.changeId]?.integratedRevision === dep.revision); }
      function reservation() { const r = s.reservation; if (!r || r.reservationId !== a.reservationId || r.generation !== a.generation) fail('RESERVATION_MISMATCH'); if (r.owner !== actorId && action !== 'accept_integration' && !(action === 'recover' && isCoordinator(actorId) === true)) fail('WRONG_OWNER'); return r; }
      if (action === 'create_task') {
        if (isCoordinator(actorId) !== true) fail('COORDINATOR_REQUIRED');
        id(a.taskId); id(a.designVersion); id(a.requirementsVersion); scopes(a.scope); ids(a.requiredChecks); dependencies(a.dependencies); if (a.assignedSessionId !== undefined) id(a.assignedSessionId);
        if (Object.hasOwn(s.tasks, a.taskId)) fail('TASK_EXISTS');
        const version = { designVersion: a.designVersion, requirementsVersion: a.requirementsVersion };
        s.tasks[a.taskId] = { ...a, requested: version, applied: { ...version }, status: depsReady(a.dependencies) ? 'ready' : 'blocked' };
        result = { taskId: a.taskId, status: s.tasks[a.taskId].status };
      } else if (action === 'change_request' || action === 'acknowledge_change') {
        const t = task(); id(a.designVersion); id(a.requirementsVersion);
        if (action === 'change_request') { if (isCoordinator(actorId) !== true) fail('COORDINATOR_REQUIRED'); } else authorizeTask(t);
        if (action === 'change_request') { t.requested = { designVersion: a.designVersion, requirementsVersion: a.requirementsVersion }; t.status = 'change_requested'; }
        else { if (t.requested.designVersion !== a.designVersion || t.requested.requirementsVersion !== a.requirementsVersion) fail('VERSION_MISMATCH'); t.applied = { ...t.requested }; t.status = depsReady(t.dependencies) ? 'ready' : 'blocked'; }
        result = { taskId: a.taskId, status: t.status };
      } else if (action === 'submit') {
        const t = task(); authorizeTask(t); versions(t); id(a.changeId); dependencies(a.dependencies);
        if (canonical(a.dependencies) !== canonical(t.dependencies)) fail('DEPENDENCY_MISMATCH');
        for (const dep of a.dependencies) if (!s.changes[dep.changeId]?.revisions.some(r => r.revision === dep.revision)) fail('DEPENDENCY_NOT_FOUND');
        const baseCommit = await commit(a.baseCommit); const resultCommit = await commit(a.resultCommit);
        try { await ancestor(baseCommit, resultCommit); } catch { fail('BASE_NOT_ANCESTOR'); }
        const evidence = validation(a.validation, resultCommit);
        const change = s.changes[a.changeId] || { taskId: a.taskId, revisions: [] }; if (change.taskId !== a.taskId) fail('CHANGE_TASK_MISMATCH');
        if (change.revisions.some(r => r.resultCommit === resultCommit)) fail('DUPLICATE_REVISION');
        const revision = change.revisions.length + 1;
        change.revisions.push({ revision, baseCommit, resultCommit, requirementsVersion: a.requirementsVersion, designVersion: a.designVersion, dependencies: a.dependencies, scope: t.scope, requiredChecks: t.requiredChecks, validation: evidence, actorId, lastVerifiedCommit: s.lastVerifiedCommit, submittedAt: new Date().toISOString() });
        s.changes[a.changeId] = change; t.status = 'submitted'; result = { changeId: a.changeId, revision, status: 'submitted' };
        pendingPins = [...new Set([baseCommit, resultCommit])];
      } else if (action === 'begin_integration') {
        if (s.reservation) fail('INTEGRATION_BUSY'); id(a.changeId);
        const change = s.changes[a.changeId]; const rev = change?.revisions.find(r => r.revision === a.revision); if (!rev) fail('REVISION_NOT_FOUND');
        const t = s.tasks[change.taskId]; authorizeTask(t); if (t.requested.designVersion !== rev.designVersion || t.requested.requirementsVersion !== rev.requirementsVersion || canonical(t.applied) !== canonical(t.requested)) fail('STALE_REVISION');
        if (change.integratedRevision >= a.revision) fail('ALREADY_INTEGRATED'); if (!depsReady(rev.dependencies)) fail('DEPENDENCY_NOT_INTEGRATED');
        const expected = await commit(a.expectedTeamCommit); if (expected !== s.lastVerifiedCommit) fail('TEAM_COMMIT_MISMATCH');
        const candidate = await commit(a.candidateCommit); await ancestor(expected, candidate); await ancestor(rev.resultCommit, candidate);
        const r = { reservationId: crypto.randomUUID(), generation: ++s.generation, owner: actorId, changeId: a.changeId, revision: a.revision, candidateCommit: candidate, expectedTeamCommit: expected, status: 'integrating', validation: [] };
        s.reservation = r; result = { ...r };
      } else if (action === 'finish_integration') {
        if (s.reservation) authorizeTask(s.tasks[s.changes[s.reservation.changeId].taskId]);
        const r = reservation(); if (a.candidateCommit !== r.candidateCommit) fail('CANDIDATE_MISMATCH'); if (r.status !== 'integrating') fail('INVALID_STAGE');
        r.validation = validation(a.validation, r.candidateCommit); r.status = 'ready_for_review'; result = { reservationId: r.reservationId, generation: r.generation, status: r.status };
      } else if (action === 'accept_integration') {
        if (isCoordinator(actorId) !== true) fail('COORDINATOR_REQUIRED'); const r = reservation();
        if (a.candidateCommit !== r.candidateCommit) fail('CANDIDATE_MISMATCH'); if (r.status !== 'ready_for_review') fail('INVALID_STAGE');
        const change = s.changes[r.changeId]; const revision = change.revisions.find(item => item.revision === r.revision); const t = s.tasks[change.taskId];
        if (t.requested.designVersion !== revision.designVersion || t.requested.requirementsVersion !== revision.requirementsVersion || canonical(t.applied) !== canonical(t.requested)) fail('STALE_REVISION');
        if (!depsReady(revision.dependencies)) fail('DEPENDENCY_NOT_INTEGRATED');
        const checks = revision.requiredChecks;
        if (!checks.every(check => r.validation.some(v => v.exitCode === 0 && v.candidateCommit === r.candidateCommit && v.commandId === check && v.scope.includes(check)))) fail('VALIDATION_INCOMPLETE');
        s.intent = { ...r, operationId, fingerprint }; await save(ctx, s); await reconcile(ctx, s); result = s.operations[operationId].result;
      } else if (action === 'recover') {
        const r = reservation(); const observed = await commit(a.observedCommit); if (observed !== await commit(ref)) fail('OBSERVED_COMMIT_MISMATCH');
        if (!['abort', 'retain'].includes(a.resolution)) fail('INVALID_RESOLUTION');
        if (a.resolution === 'abort') { s.integrationHistory ||= []; s.integrationHistory.push({ ...r, status: 'aborted', observedCommit: observed }); s.reservation = null; } else r.status = 'recovery_required';
        result = { status: a.resolution === 'abort' ? 'aborted' : 'recovery_required', observedCommit: observed };
      }
      const event = { eventId: `${operationId}/${action}`, teamId, operationId, actorId, action, stage: action, phase: action.includes('integration') || action === 'recover' ? 'integration_lock' : 'task', state: action === 'begin_integration' ? 'start' : action === 'accept_integration' || action === 'recover' ? 'end' : 'instant', outcome: result.status || 'reserved', timestamp: new Date().toISOString(), ...(a.taskId ? { taskId: a.taskId } : {}), ...(a.changeId ? { changeId: a.changeId } : {}), ...(result.revision ? { revision: result.revision } : {}) };
      if (event.phase === 'integration_lock') {
        const r = s.reservation || s.integrationHistory?.at(-1);
        if (r) { event.spanId = r.reservationId; event.changeId = r.changeId; event.revision = r.revision; event.taskId = s.changes[r.changeId].taskId; }
        if (action === 'finish_integration' || action === 'recover' && a.resolution === 'retain') event.state = 'instant';
      }
      s.events.push(event); s.events = s.events.slice(-256); s.operations[operationId] = { fingerprint, result };
      if (Buffer.byteLength(JSON.stringify(s)) > LIMIT) fail('STATE_TOO_LARGE');
      // Pin before metadata publication so a reported revision always survives Git GC.
      // A subsequent I/O failure can leave protected orphan refs; no automatic GC is authorized.
      for (const object of pendingPins) await pinObject(object);
      await save(ctx, s);
      let observationError; if (onTransition) { try { await onTransition(structuredClone(event)); } catch { observationError = 'OBSERVATION_FAILED'; } }
      return { ok: true, ...result, ...(observationError ? { observationError } : {}) };
    } finally { await lock.close(); await fs.unlink(ctx.lockFile); }
  }
  return { dispatch, read, getStorageDir: async () => (await context()).directory };
}
module.exports = { createTeamChangeService };
