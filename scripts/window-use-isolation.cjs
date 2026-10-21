'use strict';
const crypto = require('node:crypto');
const path = require('node:path');
const copy = value => JSON.parse(JSON.stringify(value));
function equal(a, b) { const ordered = v => v && typeof v === 'object' ? Object.keys(v).sort().map(k => [k, ordered(v[k])]) : v; return JSON.stringify(ordered(a)) === JSON.stringify(ordered(b)); }
function text(value, label) { if (typeof value !== 'string' || !value.trim() || value.length > 2048) throw new Error(`Invalid ${label}`); return value; }
function fields(value, allowed) { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new Error('Unsupported isolation request fields'); }
// Only these bounded native failure fields may cross the host boundary. Treat
// diagnostic text as untrusted; preserve machine-readable context independently.
function childDiagnostic(source = {}, operation) {
  source = source || {};
  const detail = source.diagnostic && typeof source.diagnostic === 'object' ? source.diagnostic : source;
  const result = {};
  const identifier = value => typeof value === 'string' && /^[a-z][a-z0-9_.:-]{0,95}$/i.test(value) && !/[a-f0-9]{64}/i.test(value) ? value : undefined;
  const code = identifier(source.code) || identifier(detail.code);
  if (code) result.code = code;
  const hresult = source.hresult ?? detail.hresult;
  if (Number.isInteger(hresult) && hresult >= -2147483648 && hresult <= 4294967295) result.hresult = hresult;
  const cleanup = source.cleanupUnconfirmed ?? detail.cleanupUnconfirmed;
  if (typeof cleanup === 'boolean') result.cleanupUnconfirmed = cleanup;
  const phase = identifier(detail.phase) || identifier(operation);
  const type = identifier(detail.type) || identifier(detail.errorType);
  if (phase) result.phase = phase;
  if (type) result.type = type;
  const message = detail.message ?? source.message;
  if (typeof message === 'string' && message) {
    // Redact the whole message for secret/path/command or serialized payload
    // shapes. This avoids exporting partial quoted values or command arguments.
    const unsafe = message.length > 8192 || /[\x00-\x1f\x7f{}<>`|;$]|[a-z]:[\\/]|\\\\|\/(?:Users|home)\/|~[\\/]|[a-f0-9]{64}|\b(?:bearer\s+|[a-z0-9_-]*(?:password|passwd|token|secret|api[-_]?key|nonce|challenge|pipe)[a-z0-9_-]*\s*[=:])|\.(?:exe|cmd|bat|ps1)\b|\b(?:powershell|pwsh|cmd|bash|sh|node|python|curl)\s+/i.test(message);
    result.message = unsafe ? '[redacted diagnostic message]' : message.slice(0, 512);
  }
  return result;
}
function success(result, operation) {
  if (!result || result.ok !== true) {
    const diagnostic = childDiagnostic(result, operation);
    throw Object.assign(new Error(diagnostic.message || diagnostic.code || `Child ${operation} failed`), {
      code: diagnostic.code || 'child_operation_failed', diagnostic,
      ...(['not_executed', 'unknown'].includes(result?.mutationOutcome) ? { mutationOutcome: result.mutationOutcome } : {}),
      ...(typeof result?.actionExecuted === 'boolean' ? { actionExecuted: result.actionExecuted } : {}),
      ...(typeof result?.inputReleaseConfirmed === 'boolean' ? { inputReleaseConfirmed: result.inputReleaseConfirmed } : {}),
      ...(result?.connectionRecovered === true ? { connectionRecovered: true, recovery: 'observe_again', observationRequired: true } : {}),
      ...(result?.viewerState === 'minimized' ? { viewerState: 'minimized' } : {}),
      ...(result?.requiredUserAction === 'restore_isolated_viewer' ? { requiredUserAction: result.requiredUserAction } : {}),
      ...(diagnostic.hresult !== undefined ? { hresult: diagnostic.hresult } : {}),
      ...(diagnostic.cleanupUnconfirmed !== undefined ? { cleanupUnconfirmed: diagnostic.cleanupUnconfirmed } : {}),
    });
  }
  return result;
}
function geometry(result, identity) {
  if (result.sessionId !== identity.childSessionId || !Number.isSafeInteger(result.width) || !Number.isSafeInteger(result.height) || result.width < 1 || result.height < 1 || result.width > 8192 || result.height > 8192 || result.width * result.height > 16777216) throw new Error('Unverified child capture geometry');
  return { width: result.width, height: result.height };
}
function checkedInput(input, bounds) {
  fields(input, ['kind', 'text', 'scanCode', 'action', 'extended', 'x', 'y', 'button', 'delta']);
  if (input.kind === 'text') {
    fields(input, ['kind', 'text']);
    if (typeof input.text !== 'string' || !input.text.length || input.text.length > 4096 || input.text.includes('\0')) throw new Error('Text requires 1..4096 UTF-16 units without NUL');
    return { kind: 'text', text: input.text };
  }
  if (input.kind === 'key') {
    fields(input, ['kind', 'scanCode', 'action', 'extended']);
    if (!Number.isSafeInteger(input.scanCode) || input.scanCode < 1 || input.scanCode > 127 || !['down', 'up'].includes(input.action) || (input.extended !== undefined && typeof input.extended !== 'boolean')) throw new Error('Invalid bounded key input');
    return { kind: 'key', scanCode: input.scanCode, action: input.action, extended: input.extended === true };
  }
  if (input.kind === 'mouse') {
    fields(input, ['kind', 'x', 'y', 'action', 'button', 'delta']);
    if (![input.x, input.y].every(Number.isSafeInteger) || input.x < 0 || input.y < 0 || input.x >= bounds.width || input.y >= bounds.height || !['move', 'down', 'up', 'wheel'].includes(input.action) || (input.button !== undefined && !['left', 'right', 'middle'].includes(input.button))) throw new Error('Invalid mouse input or capture bounds');
    if (input.action === 'wheel' ? !Number.isSafeInteger(input.delta) || Math.abs(input.delta) > 1200 : input.delta !== undefined) throw new Error('Invalid wheel delta');
    return { kind: 'mouse', x: input.x, y: input.y, action: input.action, button: input.button || 'left', ...(input.action === 'wheel' ? { delta: input.delta } : {}) };
  }
  throw new Error('Unsupported isolated input kind');
}
function admitted(result, identity) {
  const proof = result?.admission;
  return result?.ok === true && result.admissionReady === true && result.available === true && proof?.scope === 'child_platform_fixture'
    && /^[a-f0-9]{64}$/i.test(proof.helperSha256 || '')
    && ['sid', 'profile', 'parentSessionId', 'childSessionId', 'workerPid', 'workerCreated'].every(name => identity[name] !== undefined && proof.identity?.[name] === identity[name])
    && ['connection', 'render', 'keyboard', 'mouse', 'parentIdentity', 'dataProfile'].every(name => proof.gates?.[name]?.passed === true)
    && proof.fixtureClosed?.passed === true;
}

function createIsolationController({ childSession, resources, authorize = async () => false, approveApp = async () => false, resolveExecutable } = {}) {
  if (!childSession || !resources) throw new Error('Child session and resource managers are required');
  let current, owner, generation = 0, queue = Promise.resolve();
  const targets = new Map(), pendingStarts = new Map();
  function serial(action) { const result = queue.then(action); queue = result.catch(() => {}); return result; }
  async function authorized(ownerId, operation, version, parentIdentity) {
    text(ownerId, 'ownerId');
    if (await authorize(ownerId, operation, parentIdentity === undefined ? undefined : copy(parentIdentity)) !== true) throw new Error('Isolation authority required');
    if (generation !== version) throw new Error('Isolation operation stopped');
  }
  function readiness() { return { admissionReady: current?.admitted === true, available: current?.admitted === true, admissionScope: 'child_platform_fixture', applicationCompatibility: 'unverified' }; }
  function owned(ownerId) { if (!current || current.closed || owner !== ownerId) throw new Error('Isolated input lease required'); if (!current.admitted) throw new Error('Child platform admission is incomplete'); }
  function target(ownerId, targetId) { owned(ownerId); const result = targets.get(targetId); if (!result || result.ownerId !== ownerId) throw new Error('Unknown isolated target'); return result; }
  function invalidate() { for (const value of targets.values()) value.observation = null; }
  async function synchronizeConnection(verified, ownerId, version, leaseAlreadyUpdated = false) {
    if (!current || equal(verified.identity, current.identity)) return false;
    if (verified.connectionRecovered !== true || !equal(verified.previousIdentity, current.identity) || verified.inputReleased !== true || !admitted(verified, verified.identity)) throw new Error('Reconnected child identity or admission is unverified');
    await authorized(ownerId, 'start', version);
    if (!leaseAlreadyUpdated) await resources.refreshSessionLease(current.resourceId, current.lease, verified);
    current.identity = copy(verified.identity); current.admission = copy(verified.admission); current.admitted = true;
    current.needsInputValidation = false; targets.clear();
    return true;
  }
  function connectionChanged() { return Object.assign(new Error('Child connection recovered; select the application again and obtain a fresh observation'), { code: 'child_session_reconnected', actionExecuted: false, connectionRecovered: true, observationRequired: true, recovery: 'observe_again' }); }
  async function ensureConnection(ownerId, version, rejectChanged = false) {
    // Legacy in-process test adapters have no transport to reconnect.
    if (typeof childSession.ensureConnected !== 'function') return false;
    const verified = success(await childSession.ensureConnected({ ownerId }), 'connection validation');
    if (!admitted(verified, verified.identity)) throw new Error('Child platform admission is incomplete');
    const changed = await synchronizeConnection(verified, ownerId, version);
    await authorized(ownerId, 'start', version);
    if (changed && rejectChanged) throw connectionChanged();
    return changed;
  }
  async function childRequest(request, operation, version) {
    const result = await childSession.request(request);
    if (result?.connectionRecovered === true) await synchronizeConnection(result.connectionVerification || result, request.ownerId, version);
    return success(result, operation);
  }
  function scopedKeys(value, input) {
    const held = new Set(value.heldKeys);
    if (input.kind !== 'key') return held;
    if ([0x5b, 0x5c].includes(input.scanCode)) throw new Error('Windows keys escape the owned application');
    const token = `${input.extended ? 'E0:' : ''}${input.scanCode}`;
    if (input.action === 'up') { held.delete(token); return held; }
    held.add(token);
    const scans = new Set([...held].map(key => Number(key.split(':').at(-1))));
    const alt = scans.has(56), ctrl = scans.has(29);
    if ((alt && (scans.has(15) || scans.has(1))) || (ctrl && scans.has(1)) || (ctrl && alt && scans.has(83))) throw new Error('Key combination escapes the owned application');
    return held;
  }
  function resourceIdentity(resource) { return resource?.identity || resource; }
  async function observeSession(resource) {
    const identity = resourceIdentity(resource);
    const unknown = { identity, ownershipVerified: false, state: 'unknown', unknownState: true, pendingWork: true };
    const matches = current && equal(identity, current.identity);
    const closedProof = value => equal(value?.identity, identity) && value.state === 'closed' && value.ownershipVerified === true && value.logoffConfirmed === true && value.processesStopped === true
      && ['pendingWork', 'directUser', 'unsavedWork', 'unknownState', 'unrelatedApps', 'pendingUserDecision', 'heldInput'].every(flag => value[flag] === false);
    let result, needsRetirement = false;
    try { result = matches ? await childSession.observe() : unknown; } catch { result = unknown; }
    if (!equal(result?.identity, identity)) result = unknown;
    if ((!matches || result.state === 'unknown' || result.ownershipVerified !== true) && typeof childSession.inspectClosure === 'function') {
      const proof = await childSession.inspectClosure(copy(identity));
      if (closedProof(proof)) { result = proof; needsRetirement = true; }
    }
    if (closedProof(result)) {
      if (needsRetirement && matches && !current.closed && typeof childSession.retireClosed === 'function') {
        const retired = await childSession.retireClosed(copy(identity));
        if (!closedProof(retired)) return unknown;
      }
      if (matches && !current.closed) { generation++; invalidate(); current.closed = true; current.lease = null; owner = null; targets.clear(); }
      return result;
    }
    return { ...result, pendingWork: Boolean(matches && owner) || result.pendingWork !== false };
  }
  async function safeRelease(ownerId) {
    if (!current || owner !== ownerId) return { ok: true, released: false };
    invalidate();
    const released = success(await childSession.release({ ownerId }), 'release');
    if (released.inputReleased !== true) throw new Error('Isolated input release is unconfirmed');
    for (const target of targets.values()) { target.heldKeys.clear(); target.heldMouse.clear(); }
    current.needsInputValidation = false;
    // Past action outcomes belong to the tool result, not a permanent resource state.
    await resources.releaseLease(current.resourceId, current.lease, { state: 'ready' });
    current.lease = null; owner = null;
    return { ...released, released: true, warm: true, loggedOff: false };
  }
  async function closeSession(resource) {
    if (!current || !equal(resourceIdentity(resource), current.identity)) throw new Error('Unknown isolated session identity');
    if (owner || current.lease) throw new Error('Isolated session remains leased');
    const observed = await observeSession(resource);
    for (const flag of ['pendingWork', 'directUser', 'unsavedWork', 'unknownState', 'unrelatedApps', 'pendingUserDecision', 'heldInput']) if (observed[flag] !== false) throw new Error(`Unsafe isolated close: ${flag}`);
    if (observed.ownershipVerified !== true || !['running', 'closed'].includes(observed.state)) throw new Error('Isolated ownership is unverified');
    if (observed.state !== 'closed') success(await childSession.stop({ ownerId: current.lastOwner }), 'normal close');
    const closed = await observeSession(resource);
    if (closed.state !== 'closed' || closed.ownershipVerified !== true || closed.processesStopped !== true || closed.logoffConfirmed !== true) throw new Error('Isolated normal closure is unconfirmed');
    current.closed = true; targets.clear(); return closed;
  }
  return {
    start(request) {
      fields(request, ['ownerId']); const { ownerId } = request, version = generation;
      text(ownerId, 'ownerId'); pendingStarts.set(ownerId, (pendingStarts.get(ownerId) || 0) + 1);
      return serial(async () => {
        await authorized(ownerId, 'start', version);
        if (owner && owner !== ownerId) throw new Error('Isolated session is occupied');
        if (owner === ownerId) { const connectionRecovered = await ensureConnection(ownerId, version); return { ok: true, resourceId: current.resourceId, ...readiness(), reused: true, connectionRecovered }; }
        if (current?.closed) { current = null; targets.clear(); }
        if (current) {
          let lease;
          let acquired;
          if (current.resourceId) {
            const result = await resources.acquireSessionLease(current.resourceId, ownerId, async () => {
              const verified = success(await childSession.acquire({ ownerId }), 'acquire');
              if ((!equal(verified.identity, current.identity) && !(verified.connectionRecovered === true && equal(verified.previousIdentity, current.identity))) || !admitted(verified, verified.identity)) throw new Error('Warm child identity or admission is unverified');
              return verified;
            });
            lease = result.lease; acquired = result.verification;
          }
          else {
            const registered = await resources.registerSession({ id: `child-${crypto.randomUUID()}`, workId: ownerId, runId: `isolation-${crypto.randomUUID()}`, identity: current.identity, ownershipVerified: true });
            current.resourceId = registered.id; lease = registered.lease;
          }
          try { acquired ||= success(await childSession.acquire({ ownerId }), 'acquire'); await synchronizeConnection(acquired, ownerId, version, true); if (acquired.ownershipVerified !== true || !equal(acquired.identity, current.identity) || acquired.inputReleased !== true) throw new Error('Warm child identity or input release is unverified'); }
          catch (error) { await resources.releaseLease(current.resourceId, lease, { state: 'ready' }); throw error; }
          current.admitted = admitted(acquired, current.identity); current.admission = acquired.admission || null;
          current.needsInputValidation = false;
          for (const value of targets.values()) { value.heldKeys.clear(); value.heldMouse.clear(); }
          current.lease = lease; current.lastOwner = ownerId; owner = ownerId;
        } else {
          const description = await childSession.describe();
          const started = await childSession.start({ ownerId });
          if (!started?.identity) success(started, 'start');
          const identity = started.identity, parent = description.environment?.parent;
          if (started.ownershipVerified !== true || !identity || !parent || identity.sid !== parent.sid || identity.profile !== parent.profile || identity.parentSessionId !== parent.sessionId || !Number.isInteger(identity.childSessionId) || identity.childSessionId === parent.sessionId) {
            await childSession.release({ ownerId }); throw new Error('Same-SID existing-profile child proof is unavailable');
          }
          current = { identity: copy(identity), lastOwner: ownerId, closed: false, admitted: admitted(started, identity), admission: started.admission || null }; owner = ownerId;
          try {
            const registered = await resources.registerSession({ id: `child-${crypto.randomUUID()}`, workId: ownerId, runId: `isolation-${crypto.randomUUID()}`, identity, ownershipVerified: true });
            current.resourceId = registered.id; current.lease = registered.lease;
          } catch (error) { await childSession.release({ ownerId }); owner = null; error.cleanupUnconfirmed = true; throw error; }
        }
        if (version !== generation) { await safeRelease(ownerId); throw new Error('Isolation operation stopped'); }
        if (!current.admitted) { await safeRelease(ownerId); return { ok: false, code: 'child_admission_incomplete', resourceId: current.resourceId, ...readiness(), admission: current.admission }; }
        return { ok: true, resourceId: current.resourceId, ...readiness(), admission: current.admission, dataModel: 'same_user_existing_profile' };
      }).finally(() => { const pending = pendingStarts.get(ownerId) - 1; if (pending) pendingStarts.set(ownerId, pending); else pendingStarts.delete(ownerId); });
    },
    launch(request) {
      fields(request, ['ownerId', 'parentIdentity']); const version = generation, parentIdentity = request.parentIdentity ? copy(request.parentIdentity) : null;
      return serial(async () => {
        const { ownerId } = request; await authorized(ownerId, 'launch', version); owned(ownerId);
        await ensureConnection(ownerId, version);
        if ([...targets.values()].some(target => target.heldKeys.size || target.heldMouse.size)) throw new Error('Release held keys or mouse before launching another isolated application');
        if (!parentIdentity || await approveApp(ownerId, parentIdentity) !== true) throw new Error('Existing application approval required');
        if (typeof resolveExecutable !== 'function') throw new Error('Trusted executable resolver is unavailable');
        const executable = await resolveExecutable(parentIdentity);
        if (!executable || !path.isAbsolute(executable.executable || '') || !/^[a-f0-9]{64}$/i.test(executable.sha256 || '')) throw new Error('Pinned existing executable required');
        await authorized(ownerId, 'launch', version, parentIdentity);
        invalidate();
        const result = await childRequest({ ownerId, operation: 'launch', executable: executable.executable, sha256: executable.sha256.toLowerCase() }, 'launch', version);
        if (result.sessionId !== current.identity.childSessionId || !Number.isInteger(result.pid) || result.pid <= 0 || typeof result.created !== 'string' || !result.created || typeof result.hwnd !== 'string' || !/^[1-9][0-9]*$/.test(result.hwnd) || result.executable !== executable.executable) throw new Error('Native launched identity is unverified');
        const targetId = crypto.randomUUID();
        targets.set(targetId, { ownerId, parentIdentity: copy(parentIdentity), native: { pid: result.pid, created: result.created, hwnd: result.hwnd }, observation: null, heldKeys: new Set(), heldMouse: new Set() });
        return { ok: true, targetId, ...readiness() };
      });
    },
    capture(request) {
      fields(request, ['ownerId', 'targetId']); const version = generation;
      return serial(async () => {
        const value = target(request.ownerId, request.targetId);
        await authorized(request.ownerId, 'capture', version, value.parentIdentity);
        await ensureConnection(request.ownerId, version, true);
        invalidate();
        let result;
        try { result = await childRequest({ ownerId: request.ownerId, operation: 'capture', ...value.native }, 'capture', version); }
        catch (error) { current.needsInputValidation = true; throw error; }
        const bounds = geometry(result, current.identity);
        if (typeof result.png !== 'string' || !result.png.length || result.png.length > 12 * 1024 * 1024) throw new Error('Bounded child capture is unavailable');
        if (generation !== version) throw new Error('Isolation operation stopped');
        const observationId = crypto.randomUUID(); value.observation = { id: observationId, ...bounds };
        return { ok: true, targetId: request.targetId, observationId, geometry: bounds, png: result.png, contentVerified: result.contentVerified === true, inputReady: current.needsInputValidation !== true, ...readiness() };
      });
    },
    input(request) {
      fields(request, ['ownerId', 'targetId', 'observationId', 'input']); const version = generation;
      return serial(async () => {
        const value = target(request.ownerId, request.targetId);
        await authorized(request.ownerId, 'input', version, value.parentIdentity);
        await ensureConnection(request.ownerId, version, true);
        const observed = value.observation;
        if (!observed || observed.id !== request.observationId) throw new Error('Stale isolated observation');
        const input = checkedInput(request.input, observed);
        if (current.needsInputValidation) {
          invalidate();
          let verified;
          try {
            verified = success(await childSession.revalidateInput({ ownerId: request.ownerId }), 'input revalidation');
            if (verified.inputReleased !== true || !equal(verified.identity, current.identity)) throw new Error('Isolated input release or identity is unconfirmed');
          } catch (error) { error.actionExecuted = false; error.recovery = 'observe_again'; error.observationRequired = true; throw error; }
          await authorized(request.ownerId, 'input', version, value.parentIdentity);
          current.needsInputValidation = false;
          for (const target of targets.values()) { target.heldKeys.clear(); target.heldMouse.clear(); }
          throw Object.assign(new Error('Input was revalidated; obtain a fresh capture before a new action'), { code: 'child_input_revalidated', actionExecuted: false, inputReleaseConfirmed: true, recovery: 'observe_again', observationRequired: true });
        }
        for (const other of targets.values()) if (other !== value && (other.heldKeys.size || other.heldMouse.size)) throw new Error('Release held keys or mouse before changing isolated application');
        const nextHeld = scopedKeys(value, input); invalidate();
        const nextMouse = new Set(value.heldMouse);
        if (input.kind === 'mouse') { if (input.action === 'down') nextMouse.add(input.button); else if (input.action === 'up') nextMouse.delete(input.button); }
        let fresh;
        try { fresh = await childRequest({ ownerId: request.ownerId, operation: 'capture', ...value.native }, 'geometry check', version); }
        catch (error) { current.needsInputValidation = true; error.actionExecuted = false; error.mutationOutcome = 'not_executed'; throw error; }
        const bounds = geometry(fresh, current.identity);
        if (bounds.width !== observed.width || bounds.height !== observed.height) throw new Error('Stale isolated capture bounds');
        await authorized(request.ownerId, 'input', version, value.parentIdentity);
        try {
          const result = await childRequest({ ownerId: request.ownerId, operation: 'input', ...value.native, ...input }, 'input', version);
          if (result.sessionId !== current.identity.childSessionId || result.delivered !== true) throw new Error('Child input delivery or identity is unconfirmed; outcome unknown');
          value.heldKeys = nextHeld;
          value.heldMouse = nextMouse;
          return { ok: true, targetId: request.targetId, delivered: result.delivered === true, readbackVerified: result.readbackVerified === true, observationInvalidated: true, ...readiness() };
        } catch (error) {
          current.needsInputValidation = error.inputReleaseConfirmed !== true;
          if (!current.needsInputValidation) for (const target of targets.values()) { target.heldKeys.clear(); target.heldMouse.clear(); }
          if (error.actionExecuted !== false || error.mutationOutcome === 'unknown') {
            error.mutationOutcome = 'unknown'; delete error.actionExecuted;
          }
          error.recovery = 'observe_again'; error.observationRequired = true;
          throw error;
        }
      });
    },
    release(ownerId) { text(ownerId, 'ownerId'); if (owner === ownerId || pendingStarts.has(ownerId)) { generation++; invalidate(); } return serial(() => safeRelease(ownerId)); },
    observeSession, closeSession,
  };
}
module.exports = { createIsolationController, childDiagnostic };
