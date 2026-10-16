'use strict';

const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const fs = require('node:fs');
const crypto = require('node:crypto');
const readline = require('node:readline');
const { promisify } = require('node:util');
const runFile = promisify(execFile);
const probePath = path.join(__dirname, '..', 'native', 'windows-child-session', 'probe.ps1');

// These are implementation/admission gates, never inferred from interface availability.
const missingAdapters = Object.freeze([
  'trusted_native_helper_not_configured',
]);

async function probeWindowsChildSession(options = {}) {
  const platform = options.platform || process.platform;
  if (platform !== 'win32') return { schemaVersion: 1, platform, readOnly: true, supported: false, errors: [] };
  try {
    // Absolute system PowerShell, no shell interpolation, no UAC or configuration changes.
    const windowsRoot = process.env.SystemRoot || 'C:\\Windows';
    const scriptPath = options.probePath || probePath;
    if (!path.isAbsolute(scriptPath)) throw new Error('Trusted absolute prerequisite probe path required');
    const result = await runFile(path.join(windowsRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
      { windowsHide: true, timeout: 20000, maxBuffer: 128 * 1024, encoding: 'utf8' });
    const value = JSON.parse(result.stdout.replace(/^\uFEFF/, '').trim());
    if (value.schemaVersion !== 1 || value.platform !== 'win32' || value.readOnly !== true) throw new Error('Invalid child-session probe response');
    return value;
  } catch (error) {
    return { schemaVersion: 1, platform, readOnly: true, errors: [{ operation: 'nativeProbe', code: error.code || null,
      message: error.message, stderr: String(error.stderr || '').slice(0, 4096) }] };
  }
}

function describeChildSession(environment, { enabled = false } = {}) {
  const prerequisites = [];
  const add = (code, detail) => prerequisites.push({ code, detail });
  if (environment?.platform !== 'win32') add('unsupported_platform', 'Windows child sessions require Windows.');
  else {
    if (!environment.parent?.sid || !Number.isInteger(environment.parent.sessionId) || !environment.parent.profile)
      add('parent_identity_unavailable', 'Current SID, profile and Windows session identity are required.');
    if (!environment.childSessions?.enabledQuerySucceeded)
      add('child_enablement_query_failed', environment.childSessions?.enabledError ?? null);
    else if (environment.childSessions.enabled !== true)
      add('child_sessions_not_enabled', 'Machine setup is required; app approval does not authorize enabling it.');
    if (!environment.childSessions?.idQuerySucceeded && environment.childSessions?.idError !== 1168)
      add('child_identity_query_failed', environment.childSessions?.idError ?? null);
    else if (environment.childSessions.childSessionId != null)
      add('existing_child_not_owned', 'An existing child session cannot be adopted or logged off from this probe.');
    if (environment.service?.status !== 'Running') add('termservice_not_running', environment.service?.status || 'unknown');
    if (environment.activeX?.activated !== true) add('activex_unavailable', environment.activeX?.error || null);
    for (const name of ['extendedSettings', 'inputSink', 'scanCodeInput']) {
      if (environment.activeX?.interfaces?.[name]?.available !== true)
        add('activex_interface_unavailable', { name, hresult: environment.activeX?.interfaces?.[name]?.hresult ?? null });
    }
    for (const error of environment.errors || []) add('probe_error', error);
  }
  return {
    schemaVersion: 1, backend: 'windows-child-session', enabled: enabled === true,
    state: enabled !== true ? 'disabled' : prerequisites.length ? 'prerequisite_required' : 'backend_incomplete',
    available: false, admissionReady: false, parentFallback: false,
    environment, prerequisites, missingAdapters: [...missingAdapters],
    capabilities: { prerequisiteInspection: true, connection: false, sameSidWorker: false,
      appLaunch: false, capture: false, isolatedInput: false, sessionCleanup: false },
    // Same-account files/settings are shared; authentication and concurrent app behavior remain app-specific gates.
    dataModel: 'same_user_existing_profile',
    requiredVerification: ['connection', 'same_sid_and_profile', 'app_launch_identity', 'render_content', 'isolated_input_readback', 'saved_data_compatibility', 'safe_cleanup'],
  };
}

function createNativeTransport(helper, { reconcileBootstrap = false } = {}) {
  if (!helper || !path.isAbsolute(helper.path) || !/^[a-f0-9]{64}$/i.test(helper.sha256 || '')) throw new Error('Pinned trusted native helper is required');
  const stat = fs.lstatSync(helper.path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Native helper must be a regular executable');
  const actual = crypto.createHash('sha256').update(fs.readFileSync(helper.path)).digest('hex');
  if (actual !== helper.sha256.toLowerCase()) throw new Error('Native helper hash mismatch');
  const child = spawn(helper.path, reconcileBootstrap ? ['--reconcile-bootstrap'] : [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const lines = readline.createInterface({ input: child.stdout });
  let pending, terminal, diagnostic = '';
  child.stderr.on('data', value => { diagnostic = (diagnostic + value).slice(-4096); });
  function fail(error) { terminal = error; if (pending) { clearTimeout(pending.timer); pending.reject(error); pending = null; } }
  child.on('error', fail);
  child.stdin.on('error', fail);
  child.stdout.on('error', fail);
  child.on('exit', (code, signal) => fail(new Error(`Native child helper exited (${code ?? signal}): ${diagnostic}`)));
  lines.on('line', line => {
    if (line.length > 16 * 1024 * 1024) return fail(new Error('Native child response exceeded bounded payload'));
    if (!pending) return fail(new Error('Unexpected native child response'));
    const request = pending; pending = null; clearTimeout(request.timer);
    try { request.resolve(JSON.parse(line)); } catch (error) { fail(error); request.reject(error); }
  });
  return {
    request(value, timeoutMs = 15000) {
      if (terminal) return Promise.reject(terminal);
      if (pending) return Promise.reject(new Error('Native child request already running'));
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          child.stdin.end(); fail(new Error('Native child response timed out; session cleanup is unconfirmed'));
        }, timeoutMs);
        pending = { resolve, reject, timer };
        child.stdin.write(`${JSON.stringify(value)}\n`, error => { if (error) fail(error); });
      });
    },
    disconnect() { child.stdin.end(); },
    get healthy() { return !terminal; },
  };
}

const admissionIdentityKeys = ['sid', 'profile', 'parentSessionId', 'childSessionId', 'workerPid', 'workerCreated'];
const admissionGateNames = ['connection', 'render', 'keyboard', 'mouse', 'parentIdentity', 'dataProfile'];
function passedChildAdmission(proof, identity, helper) {
  return Boolean(proof && identity && helper && proof.scope === 'child_platform_fixture'
    && typeof helper.sha256 === 'string' && /^[a-f0-9]{64}$/i.test(helper.sha256)
    && typeof proof.helperSha256 === 'string' && proof.helperSha256.toLowerCase() === helper.sha256.toLowerCase()
    && admissionIdentityKeys.every(key => proof.identity?.[key] === identity[key])
    && admissionGateNames.every(key => proof.gates?.[key]?.passed === true) && proof.fixtureClosed?.passed === true);
}

function createWindowsChildSessionManager({ enabled = false, probe = probeWindowsChildSession,
  nativeHelper, bootstrapJournalPath, authorize = async () => false, transportFactory = createNativeTransport } = {}) {
  let transport, identity, inputOwner, inFlight = false, uncertain = false, lastClosure, lastReconciliation, admission, admissionAccepted = false;
  const isEnabled = () => typeof enabled === 'function' ? enabled() === true : enabled === true;
  const admitted = () => admissionAccepted && isEnabled() && !uncertain && transport?.healthy !== false && passedChildAdmission(admission, identity, nativeHelper);
  async function describe() {
    const value = describeChildSession(await probe(), { enabled: isEnabled() });
    value.nativeHelperConfigured = Boolean(nativeHelper);
    value.identity = identity || null; value.inputOwner = inputOwner || null; value.cleanupUnconfirmed = uncertain;
    value.lastClosed = lastClosure || null;
    value.bootstrapReconciliation = lastReconciliation || null;
    value.bootstrapJournalConfigured = Boolean(bootstrapJournalPath && path.isAbsolute(bootstrapJournalPath));
    if (nativeHelper) {
      value.missingAdapters = [];
      value.requiredVerification = ['connection', 'same_sid_and_profile', 'app_launch_identity', 'render_content', 'isolated_input_readback', 'saved_data_compatibility', 'safe_cleanup'];
      if (value.state === 'backend_incomplete') value.state = 'unverified';
    }
    if (transport?.healthy === false) uncertain = true;
    if (identity) {
      const observed = value.environment;
      value.prerequisites = value.prerequisites.filter(item => item.code !== 'existing_child_not_owned'
        || observed.childSessions?.childSessionId !== identity.childSessionId);
      const sameParent = observed.parent?.sessionId === identity.parentSessionId && observed.parent?.sid === identity.sid && observed.parent?.profile === identity.profile;
      if (!sameParent || !observed.childSessions?.idQuerySucceeded || observed.childSessions.childSessionId !== identity.childSessionId) uncertain = true;
      if (value.prerequisites.length) uncertain = true;
      value.state = admitted() && !value.prerequisites.length ? 'admitted' : 'connected_unverified';
      value.available = value.admissionReady = value.state === 'admitted';
      value.capabilities = { ...value.capabilities, connection: !uncertain, sameSidWorker: !uncertain, appLaunch: value.available,
        capture: value.available, isolatedInput: value.available, sessionCleanup: !uncertain };
    }
    value.admission = admission || null;
    value.cleanupUnconfirmed = uncertain;
    value.ownershipVerified = Boolean(identity && !uncertain);
    value.applicationCompatibility = 'unverified';
    return value;
  }
  function owner(request) {
    if (!request || typeof request.ownerId !== 'string' || !request.ownerId.trim()) throw new Error('Trusted task owner identity is required');
    if (inputOwner && request.ownerId !== inputOwner) throw new Error('Child session input is occupied by another task');
  }
  async function exclusive(action) {
    if (inFlight) return { ok: false, code: 'child_session_occupied' };
    inFlight = true;
    try { return await action(); } finally { inFlight = false; }
  }
  async function reconcileBootstrap() {
    if (!nativeHelper) return lastReconciliation = { ok: false, code: 'child_session_backend_incomplete' };
    if (!bootstrapJournalPath || !path.isAbsolute(bootstrapJournalPath)) return lastReconciliation = { ok: false, code: 'child_bootstrap_journal_required' };
    let channel;
    try {
      channel = transportFactory(nativeHelper, { reconcileBootstrap: true });
      lastReconciliation = await channel.request({ helperSha256: nativeHelper.sha256.toLowerCase(), bootstrapJournalPath });
      return lastReconciliation;
    } catch (error) {
      lastReconciliation = { ok: false, state: 'bootstrap_reconciliation_deferred', reason: error.message };
      return lastReconciliation;
    } finally { if (channel) channel.disconnect(); }
  }
  return {
    describe,
    status: describe,
    async reconcileBootstrap() { return exclusive(reconcileBootstrap); },
    async start(request = {}) { return exclusive(async () => {
      const status = await describe();
      const blockers = status.prerequisites.filter(item => !(item.code === 'child_identity_query_failed' && item.detail === 1168));
      if (status.state === 'disabled' || blockers.length || !nativeHelper || uncertain) return {
        ok: false, code: status.state === 'disabled' ? 'stage3_disabled' : uncertain ? 'child_cleanup_unconfirmed'
          : blockers.length ? 'child_session_prerequisites' : 'child_session_backend_incomplete',
        message: 'No child session was created. See prerequisite and verification gates.', ...status,
      };
      owner(request);
      if (identity) return { ok: false, code: 'child_session_already_owned', identity };
      if (await authorize('start', request) !== true) return { ok: false, code: 'child_session_authority_required' };
      const reconciliation = await reconcileBootstrap();
      if (!reconciliation.ok) return { ok: false, code: reconciliation.code || 'child_bootstrap_reconciliation_required', reconciliation };
      try {
        transport = transportFactory(nativeHelper);
        const result = await transport.request({ operation: 'start', helperSha256: nativeHelper.sha256.toLowerCase(), bootstrapJournalPath, ownerId: request.ownerId }, 55000);
        const peer = result.identity, parent = status.environment.parent;
        if (!peer && result.ok !== true) { uncertain = true; return { ...result, admissionReady: false, available: false, cleanupUnconfirmed: true }; }
        if (result.ownershipVerified !== true || !peer || peer.parentSessionId !== parent.sessionId || peer.childSessionId === parent.sessionId
          || !Number.isInteger(peer.childSessionId) || peer.sid !== parent.sid || peer.profile !== parent.profile
          || !Number.isInteger(peer.workerPid) || peer.workerPid <= 0 || typeof peer.workerCreated !== 'string' || !peer.workerCreated) {
          uncertain = true; return { ok: false, code: 'child_session_identity_mismatch' };
        }
        identity = { ...peer }; inputOwner = request.ownerId; uncertain = result.cleanupUnconfirmed === true;
        admission = result.admission ? JSON.parse(JSON.stringify(result.admission)) : null;
        admissionAccepted = result.ok === true && passedChildAdmission(admission, identity, nativeHelper);
        const ready = result.ok === true && admitted();
        return { ...result, ok: ready, code: ready ? undefined : 'child_session_admission_failed',
          ownershipVerified: true, admissionReady: ready, available: ready, admission,
          applicationCompatibility: 'unverified', requiredVerification: status.requiredVerification };
      } catch (error) { uncertain = true; return { ok: false, code: 'child_transport_failed', message: error.message, cleanupUnconfirmed: true }; }
    }); },
    async request(request = {}) { return exclusive(async () => {
      owner(request);
      if (!identity || uncertain) return { ok: false, code: 'child_session_not_connected' };
      if (request.ownerId !== inputOwner) return { ok: false, code: 'child_input_lease_required' };
      if (!isEnabled() && request.operation !== 'releaseInput') return { ok: false, code: 'stage3_disabled' };
      if (!['launch', 'capture', 'input', 'releaseInput'].includes(request.operation)) return { ok: false, code: 'child_operation_unsupported' };
      if (request.operation !== 'releaseInput' && !admitted()) return { ok: false, code: 'child_session_admission_required' };
      if (await authorize(request.operation, request, identity) !== true) return { ok: false, code: 'child_session_authority_required' };
      try { return await transport.request(request); }
      catch (error) { uncertain = true; return { ok: false, code: 'child_transport_failed', message: error.message, cleanupUnconfirmed: true }; }
    }); },
    async stop(request = {}) { return exclusive(async () => {
      owner(request);
      if (!identity || uncertain) return { ok: false, code: uncertain ? 'child_cleanup_unconfirmed' : 'child_session_not_owned' };
      if (await authorize('stop', request, identity) !== true) return { ok: false, code: 'child_session_authority_required' };
      try {
        const result = await transport.request({ operation: 'stop' }, 30000);
        if (result.ok && ['stopped', 'closed'].includes(result.state)) { lastClosure = { ...result, identity }; identity = null; admission = null; inputOwner = null; transport.disconnect(); transport = null; }
        return result;
      } catch (error) { uncertain = true; return { ok: false, code: 'child_cleanup_unconfirmed', message: error.message }; }
    }); },
    async observe() {
      if (inFlight) return { ownershipVerified: false, pendingWork: true, state: identity ? 'running' : 'unknown', identity: identity || null };
      if (!identity) return lastClosure || { ownershipVerified: false, state: 'absent', pendingWork: false, bootstrapReconciliation: lastReconciliation || null };
      return exclusive(async () => {
        if (uncertain) return { ownershipVerified: false, state: 'unknown', unknownState: true, identity };
        try { const result = await transport.request({ operation: 'status' }); return { ...result, pendingWork: Boolean(inputOwner) || result.pendingWork === true, identity }; }
        catch (error) { uncertain = true; return { ownershipVerified: false, state: 'unknown', unknownState: true, identity, error: error.message }; }
      });
    },
    async release(request = {}) { return exclusive(async () => {
      owner(request);
      if (!identity || uncertain) return { ok: false, code: 'child_session_not_connected' };
      try {
        const result = await transport.request({ operation: 'releaseInput' });
        if (result.ok) inputOwner = null;
        return result;
      } catch (error) { uncertain = true; return { ok: false, code: 'child_transport_failed', message: error.message, cleanupUnconfirmed: true }; }
    }); },
    async acquire(request = {}) { return exclusive(async () => {
      owner(request);
      if (!identity || uncertain) return { ok: false, code: 'child_session_not_connected' };
      if (!isEnabled()) return { ok: false, code: 'stage3_disabled' };
      if (await authorize('acquire', request, identity) !== true) return { ok: false, code: 'child_session_authority_required' };
      try {
        const result = await transport.request({ operation: 'status' });
        if (!result.ok || result.sessionId !== identity.childSessionId || result.ownershipVerified !== true) {
          uncertain = true; return { ok: false, code: 'child_session_identity_mismatch' };
        }
        inputOwner = request.ownerId;
        return { ok: true, ownershipVerified: true, identity, inputOwner, admissionReady: admitted(), available: admitted(), admission };
      } catch (error) { uncertain = true; return { ok: false, code: 'child_transport_failed', message: error.message, cleanupUnconfirmed: true }; }
    }); },
  };
}

module.exports = { probeWindowsChildSession, describeChildSession, createWindowsChildSessionManager, createNativeTransport };
if (require.main === module) {
  createWindowsChildSessionManager({ enabled: process.argv.includes('--enabled') }).describe()
    .then(value => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`))
    .catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
