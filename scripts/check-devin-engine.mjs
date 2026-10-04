import { spawn, spawnSync } from 'node:child_process';
import { constants } from 'node:fs';
import {
  access,
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const WAIT_MS = 30_000;
const LIVE_WAIT_MS = 300_000;
const AGENTS_MARKER = 'AZRAEL_DEVIN_AGENTS_CONTEXT_MARKER';
const FIRST_USER_MARKER = 'AZRAEL_DEVIN_FIRST_USER_MARKER';
const SECOND_USER_MARKER = 'AZRAEL_DEVIN_SECOND_USER_MARKER';
const RESPONSE_TEXT = 'mock Devin response';
const ROOT_USER_MARKER = 'AZRAEL_ASTRA_ROOT_USER_MARKER';
const ROOT_INSTRUCTION_MARKER = 'AZRAEL_ASTRA_ROOT_INSTRUCTION_MARKER';
const ROOT_REASONING_MARKER = 'AZRAEL_ASTRA_REASONING_MARKER';
const ROOT_OPAQUE_MARKER = 'AZRAEL_OPAQUE_ENCRYPTED_REASONING_BYTES';
const CHILD_TASK_MARKER = 'AZRAEL_SWE_CHILD_TASK_MARKER';
const SPAWN_CALL_ID = 'azrael-mixed-spawn-call';
const CANCEL_USER_MARKER = 'AZRAEL_DEVIN_PENDING_CANCEL_MARKER';
const PERMISSION_USER_MARKER = 'AZRAEL_DEVIN_PERMISSION_DENIAL_MARKER';
const PERMISSION_ALLOW_USER_MARKER = 'AZRAEL_DEVIN_PERMISSION_ALLOW_MARKER';
const PERMISSION_FORBIDDEN_USER_MARKER = 'AZRAEL_DEVIN_PERMISSION_FORBIDDEN_MARKER';
const PERMISSION_DYNAMIC_USER_MARKER = 'AZRAEL_DEVIN_PERMISSION_DYNAMIC_MARKER';
const PERMISSION_UNKNOWN_KIND_USER_MARKER = 'AZRAEL_DEVIN_PERMISSION_UNKNOWN_KIND_MARKER';
const PERMISSION_MISSING_OPTION_USER_MARKER = 'AZRAEL_DEVIN_PERMISSION_MISSING_OPTION_MARKER';
const PERMISSION_AMBIGUOUS_OPTION_USER_MARKER = 'AZRAEL_DEVIN_PERMISSION_AMBIGUOUS_OPTION_MARKER';
const PERMISSION_MALFORMED_OPTION_USER_MARKER = 'AZRAEL_DEVIN_PERMISSION_MALFORMED_OPTION_MARKER';
const PERMISSION_MISSING_SHELL_USER_MARKER = 'AZRAEL_DEVIN_PERMISSION_MISSING_SHELL_MARKER';
const PERMISSION_UNKNOWN_SHELL_USER_MARKER = 'AZRAEL_DEVIN_PERMISSION_UNKNOWN_SHELL_MARKER';
const PERMISSION_OVERRIDE_USER_MARKER = 'AZRAEL_DEVIN_PERMISSION_OVERRIDE_MARKER';
const PERMISSION_OPAQUE_USER_MARKER = 'AZRAEL_DEVIN_PERMISSION_OPAQUE_MARKER';
const PERMISSION_NON_EXECUTE_USER_MARKER = 'AZRAEL_DEVIN_PERMISSION_NON_EXECUTE_MARKER';
const PERMISSION_CONFLICT_USER_MARKER = 'AZRAEL_DEVIN_PERMISSION_CONFLICT_MARKER';
const PERMISSION_STALE_USER_MARKER = 'AZRAEL_DEVIN_PERMISSION_STALE_MARKER';
const PERMISSION_CROSS_SESSION_USER_MARKER = 'AZRAEL_DEVIN_PERMISSION_CROSS_SESSION_MARKER';
const PERMISSION_INVALID_CALL_ID_MARKER = 'AZRAEL_DEVIN_PERMISSION_INVALID_CALL_ID';
const PERMISSION_INTERACTIVE_ACCEPT_MARKER = 'AZRAEL_DEVIN_PERMISSION_INTERACTIVE_ACCEPT';
const PERMISSION_INTERACTIVE_DECLINE_MARKER = 'AZRAEL_DEVIN_PERMISSION_INTERACTIVE_DECLINE';
const PERMISSION_INTERACTIVE_CANCEL_MARKER = 'AZRAEL_DEVIN_PERMISSION_INTERACTIVE_CANCEL';
const PERMISSION_EOF_MARKER = 'AZRAEL_DEVIN_PERMISSION_EOF';
const TOOL_OBSERVATION_USER_MARKER = 'AZRAEL_DEVIN_TOOL_OBSERVATION_MARKER';
const TOOL_OBSERVATION_FOLLOWUP_MARKER = 'AZRAEL_DEVIN_TOOL_FOLLOWUP_MARKER';
const TOOL_TEXT_PREFIX = 'Before tool. During tool. ';
const TOOL_FAILURE_TEXT = 'Tool execution was rejected: User skipped this tool call';
const SKILL_BODY_MARKER = 'AZRAEL_DEVIN_SKILL_BODY_MARKER';
const SKILL_REFERENCE_MARKER = 'AZRAEL_DEVIN_SKILL_REFERENCE_MARKER';
const DEVIN_VARIANT_COUNT = 105;
const SWITCH_OPENAI_MARKER = 'AZRAEL_SWITCH_TO_ASTRA_MARKER';
const SWITCH_BACK_DEVIN_MARKER = 'AZRAEL_SWITCH_BACK_TO_DEVIN_MARKER';
const SWITCH_OPENAI_RESPONSE = 'mock Astra switch response';
const SYNTHETIC_OPENAI_KEY = 'sk-azrael-devin-engine-fixture';

const arguments_ = process.argv.slice(2);
function optionValue(name) {
  const index = arguments_.indexOf(name);
  if (index < 0 || index + 1 >= arguments_.length) return undefined;
  return arguments_[index + 1];
}
const liveWork = arguments_.includes('--live-work');
const permissionSmoke = arguments_.includes('--permission-smoke');
const engineArgument = optionValue('--engine');
if (!engineArgument) {
  throw new Error(
    'Usage: node scripts/check-devin-engine.mjs --engine <azrael executable> [--live-work [--permission-smoke | --scripted-parent [--child-only]] --devin-executable <path> --state-root <absolute> --fixture-root <new absolute> --log-root <new absolute>]',
  );
}
if (permissionSmoke && !liveWork) {
  throw new Error('--permission-smoke requires --live-work');
}
if (
  !liveWork &&
  (arguments_.length !== 2 || arguments_[0] !== '--engine')
) {
  throw new Error('mock mode accepts only --engine <azrael executable>');
}
const enginePath = resolve(engineArgument);

class RpcError extends Error {
  constructor(method, error) {
    super(`${method} failed: ${JSON.stringify(error)}`);
    this.rpc = error;
  }
}

class JsonLinePeer {
  constructor(child, waitMs = WAIT_MS) {
    this.child = child;
    this.waitMs = waitMs;
    this.nextId = 0;
    this.pending = new Map();
    this.notifications = [];
    this.waiters = [];
    this.serverRequests = [];
    this.serverRequestWaiters = [];
    this.lines = createInterface({ input: child.stdout });
    this.lines.on('line', line => this.#receive(line));
    child.once('error', error => this.#fail(error));
    child.once('exit', (code, signal) => {
      this.#fail(new Error(`engine exited (code ${code}, signal ${signal})`));
    });
  }

  #receive(line) {
    try {
      const message = JSON.parse(line);
      if (
        Object.hasOwn(message, 'id') &&
        message.method === 'item/commandExecution/requestApproval'
      ) {
        const incoming = {
          params: message.params,
          respond: result =>
            this.child.stdin.write(`${JSON.stringify({ id: message.id, result })}\n`),
        };
        const index = this.serverRequestWaiters.findIndex(waiter =>
          waiter.predicate(message.params),
        );
        if (index >= 0) {
          const [waiter] = this.serverRequestWaiters.splice(index, 1);
          clearTimeout(waiter.timer);
          waiter.resolve(incoming);
        } else {
          this.serverRequests.push(incoming);
        }
        return;
      }
      if (Object.hasOwn(message, 'id')) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new RpcError(pending.method, message.error));
        else pending.resolve(message.result);
        return;
      }
      if (typeof message.method !== 'string') return;
      const index = this.waiters.findIndex(
        waiter => waiter.method === message.method && waiter.predicate(message.params),
      );
      if (index >= 0) {
        const [waiter] = this.waiters.splice(index, 1);
        clearTimeout(waiter.timer);
        waiter.resolve(message.params);
      } else {
        this.notifications.push(message);
      }
    } catch (error) {
      this.#fail(new Error(`engine emitted invalid JSON: ${error.message}`));
    }
  }

  #fail(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.waiters.length = 0;
    for (const waiter of this.serverRequestWaiters) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.serverRequestWaiters.length = 0;
  }

  request(method, params) {
    return new Promise((resolvePromise, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, this.waitMs);
      this.pending.set(id, { method, resolve: resolvePromise, reject, timer });
      this.child.stdin.write(`${JSON.stringify({ id, method, params })}\n`, error => {
        if (!error) return;
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  notify(method, params) {
    this.child.stdin.write(`${JSON.stringify({ method, params })}\n`);
  }

  notification(method, predicate = () => true) {
    const index = this.notifications.findIndex(
      item => item.method === method && predicate(item.params),
    );
    if (index >= 0) return Promise.resolve(this.notifications.splice(index, 1)[0].params);
    return new Promise((resolvePromise, reject) => {
      const waiter = { method, predicate, resolve: resolvePromise, reject };
      waiter.timer = setTimeout(() => {
        const index_ = this.waiters.indexOf(waiter);
        if (index_ >= 0) this.waiters.splice(index_, 1);
        reject(new Error(`${method} notification timed out`));
      }, this.waitMs);
      this.waiters.push(waiter);
    });
  }

  takeNotifications(method, predicate = () => true) {
    const selected = [];
    this.notifications = this.notifications.filter(message => {
      if (message.method === method && predicate(message.params)) {
        selected.push(message.params);
        return false;
      }
      return true;
    });
    return selected;
  }

  serverRequest(predicate = () => true) {
    const index = this.serverRequests.findIndex(request => predicate(request.params));
    if (index >= 0) return Promise.resolve(this.serverRequests.splice(index, 1)[0]);
    return new Promise((resolvePromise, reject) => {
      const waiter = { predicate, resolve: resolvePromise, reject };
      waiter.timer = setTimeout(() => {
        const index_ = this.serverRequestWaiters.indexOf(waiter);
        if (index_ >= 0) this.serverRequestWaiters.splice(index_, 1);
        reject(new Error('item/commandExecution/requestApproval server request timed out'));
      }, this.waitMs);
      this.serverRequestWaiters.push(waiter);
    });
  }

  close() {
    this.lines.close();
  }
}

function withTimeout(promise, description, milliseconds = WAIT_MS) {
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error(`${description} timed out`)), milliseconds);
    promise.then(
      value => {
        clearTimeout(timer);
        resolvePromise(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return withTimeout(
    new Promise((resolvePromise, reject) => {
      child.once('exit', (code, signal) => resolvePromise({ code, signal }));
      child.once('error', reject);
    }),
    'engine exit',
  );
}

async function readFixtureEvents(path) {
  try {
    return (await readFile(path, 'utf8'))
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map(line => JSON.parse(line));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function waitForFixtureEvent(path, predicate, description) {
  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline) {
    const event = (await readFixtureEvents(path)).find(predicate);
    if (event) return event;
    await new Promise(resolvePromise => setTimeout(resolvePromise, 25));
  }
  throw new Error(`${description} timed out`);
}

async function waitForFixtureProcessExit(pid) {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) {
    throw new Error('invalid ACP fixture process id');
  }
  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0); // Existence check only; never signal another process.
    } catch (error) {
      if (error.code === 'ESRCH') return;
      throw error;
    }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 25));
  }
  throw new Error(`cancelled ACP fixture process ${pid} did not exit`);
}

async function removeVerifiedWorkRoot(path) {
  const target = resolve(path);
  const temporaryRoot = resolve(tmpdir());
  const childPath = relative(temporaryRoot, target);
  const withinTemporaryRoot =
    childPath !== '' &&
    childPath !== '..' &&
    !childPath.startsWith(`..${sep}`) &&
    !isAbsolute(childPath);
  if (!withinTemporaryRoot || !basename(target).startsWith('azrael-devin-engine-')) {
    throw new Error(`refusing to remove unverified harness directory: ${target}`);
  }
  await rm(target, { recursive: true, force: true });
}

async function expectRpcError(promise, description, messageFragment) {
  let caught;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  if (!(caught instanceof RpcError) || !caught.message.includes(messageFragment)) {
    throw new Error(`${description} did not return the expected RPC error: ${caught}`);
  }
}

function sse(events) {
  return events
    .map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    .join('');
}

function responseCreated(id) {
  return { type: 'response.created', response: { id } };
}

function responseCompleted(id) {
  return {
    type: 'response.completed',
    response: {
      id,
      usage: {
        input_tokens: 0,
        input_tokens_details: null,
        output_tokens: 0,
        output_tokens_details: null,
        total_tokens: 0,
      },
    },
  };
}

async function startResponsesServer() {
  const bodies = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const text = Buffer.concat(chunks).toString('utf8');
    if (!request.url?.endsWith('/responses')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{}');
      return;
    }
    bodies.push(text);
    let events;
    if (text.includes(SWITCH_OPENAI_MARKER)) {
      events = [
        responseCreated('astra-switch-response'),
        {
          type: 'response.output_item.done',
          item: {
            type: 'message',
            role: 'assistant',
            id: 'astra-switch-message',
            content: [{ type: 'output_text', text: SWITCH_OPENAI_RESPONSE }],
          },
        },
        responseCompleted('astra-switch-response'),
      ];
    } else if (text.includes(ROOT_USER_MARKER) && !text.includes(SPAWN_CALL_ID)) {
      const spawnArguments = JSON.stringify({
        message: CHILD_TASK_MARKER,
        task_name: 'swe_child',
        fork_turns: 'all',
        model: 'devin/swe-2-medium',
      });
      events = [
        responseCreated('astra-root-spawn-response'),
        {
          type: 'response.output_item.done',
          item: {
            type: 'reasoning',
            id: 'astra-root-reasoning',
            summary: [{ type: 'summary_text', text: ROOT_REASONING_MARKER }],
            content: [{ type: 'reasoning_text', text: ROOT_REASONING_MARKER }],
            encrypted_content: Buffer.from(ROOT_OPAQUE_MARKER).toString('base64'),
          },
        },
        {
          type: 'response.output_item.done',
          item: {
            type: 'function_call',
            call_id: SPAWN_CALL_ID,
            namespace: 'azrael_agents',
            name: 'spawn_agent',
            arguments: spawnArguments,
          },
        },
        responseCompleted('astra-root-spawn-response'),
      ];
    } else if (text.includes(SPAWN_CALL_ID)) {
      events = [
        responseCreated('astra-root-followup-response'),
        {
          type: 'response.output_item.done',
          item: {
            type: 'message',
            role: 'assistant',
            id: 'astra-root-message',
            content: [{ type: 'output_text', text: 'Astra root completed' }],
          },
        },
        responseCompleted('astra-root-followup-response'),
      ];
    } else {
      response.writeHead(500, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'unexpected mock Responses request' }));
      return;
    }
    response.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
    });
    response.end(sse(events));
  });
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolvePromise);
  });
  const address = server.address();
  return {
    server,
    bodies,
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
  };
}

function closeServer(server) {
  if (!server) return Promise.resolve();
  return new Promise((resolvePromise, reject) => {
    server.close(error => (error ? reject(error) : resolvePromise()));
  });
}

function assertCatalog(models, expectDevin) {
  const native = models.data.filter(model => !model.model.startsWith('devin/'));
  const devin = models.data.filter(model => model.model.startsWith('devin/'));
  if (native.length === 0) throw new Error('native model catalog is empty');
  if (!expectDevin) {
    if (devin.length !== 0) throw new Error('logged-out catalog retained Devin models');
    return native.length;
  }
  if (
    devin.length !== DEVIN_VARIANT_COUNT ||
    !devin.some(
      model =>
        model.model === 'devin/swe-2-medium' &&
        model.displayName === 'SWE-2 Medium (Devin)' &&
        model.supportedReasoningEfforts.length === 0,
    )
  ) {
    throw new Error(`unexpected Devin catalog: ${JSON.stringify(devin)}`);
  }
  if (models.data.some(model => model.model === 'devin/swe')) {
    throw new Error('Devin family alias leaked into the catalog');
  }
  return native.length;
}

function assertPlainCollaborationMessageSchemas(body) {
  const request = JSON.parse(body);
  const incrementalTools = request.input
    ?.filter(item => item.type === 'additional_tools')
    .flatMap(item => item.tools ?? []);
  const namespaces = [...(request.tools ?? []), ...(incrementalTools ?? [])];
  const collaboration = namespaces?.find(
    tool => tool.type === 'namespace' && tool.name === 'azrael_agents',
  );
  if (!collaboration) {
    throw new Error('Astra request omitted the azrael_agents tool namespace');
  }
  for (const name of ['spawn_agent', 'send_message', 'followup_task']) {
    const tool = collaboration.tools?.find(candidate => candidate.name === name);
    const message = tool?.parameters?.properties?.message;
    if (!message || Object.hasOwn(message, 'encrypted')) {
      throw new Error(`${name} message schema was absent or marked encrypted`);
    }
  }
}

async function startTurn(
  peer,
  threadId,
  text,
  additionalInput = [],
  overrides = {},
  expectedText = RESPONSE_TEXT,
) {
  const response = await peer.request('turn/start', {
    threadId,
    input: [{ type: 'text', text, textElements: [] }, ...additionalInput],
    ...overrides,
  });
  const turnId = response?.turn?.id;
  if (typeof turnId !== 'string') throw new Error('turn/start omitted the turn id');
  const completed = await peer.notification(
    'turn/completed',
    params => params?.threadId === threadId && params?.turn?.id === turnId,
  );
  if (completed.turn.status !== 'completed' || completed.turn.error !== null) {
    throw new Error(`Devin turn did not complete: ${JSON.stringify(completed.turn)}`);
  }
  const messages = peer.takeNotifications(
    'item/completed',
    params =>
      params?.threadId === threadId &&
      params?.turnId === turnId &&
      params?.item?.type === 'agentMessage',
  );
  if (!messages.some(params => params.item.text === expectedText)) {
    throw new Error(`Devin response text was not emitted for turn ${turnId}`);
  }
}

async function startDevinThread(peer, cwd) {
  const started = await peer.request('thread/start', {
    model: 'devin/swe-2-medium',
    cwd,
    approvalPolicy: 'never',
    sandbox: 'danger-full-access',
    ephemeral: true,
  });
  if (started.model !== 'devin/swe-2-medium' || started.modelProvider !== 'devin') {
    throw new Error(`standalone thread did not select Devin: ${JSON.stringify(started)}`);
  }
  if (typeof started.thread?.id !== 'string') throw new Error('Devin thread omitted its id');
  return started.thread.id;
}

async function checkPermissionCase(
  peer,
  fixtureLogPath,
  cwd,
  marker,
  caseName,
  expectedOutcome,
) {
  const threadId = await startDevinThread(peer, cwd);
  await startTurn(peer, threadId, marker);
  const result = await waitForFixtureEvent(
    fixtureLogPath,
    event => event.command === 'permission-result' && event.case === caseName,
    `ACP permission case ${caseName}`,
  );
  const expectedExecution = expectedOutcome === 'selected';
  if (
    result.outcome !== expectedOutcome ||
    result.toolExecuted !== expectedExecution ||
    (expectedExecution && result.optionId !== 'allow-once')
  ) {
    throw new Error(`permission case ${caseName} returned an unsafe result: ${JSON.stringify(result)}`);
  }
  const warnings = peer.takeNotifications(
    'warning',
    params => params?.threadId === threadId && params?.message?.includes('Devin tool permission denied'),
  );
  if (expectedOutcome === 'cancelled') {
    if (
      warnings.length !== 1 ||
      !warnings[0].message.includes('No execution was approved by Azrael') ||
      /Remove-Item|Write-Output|Set-Content|C:\/forbidden/.test(warnings[0].message)
    ) {
      throw new Error(`permission case ${caseName} emitted an unsafe warning: ${JSON.stringify(warnings)}`);
    }
  } else if (warnings.length !== 0) {
    throw new Error(`allowed permission case ${caseName} emitted a denial warning`);
  }
}

async function startDevinThreadWithApproval(peer, cwd) {
  const started = await peer.request('thread/start', {
    model: 'devin/swe-2-medium',
    cwd,
      approvalPolicy: 'untrusted',
    sandbox: 'danger-full-access',
    ephemeral: true,
  });
  if (started.model !== 'devin/swe-2-medium' || started.modelProvider !== 'devin') {
    throw new Error(`interactive permission thread did not select Devin: ${JSON.stringify(started)}`);
  }
  if (typeof started.thread?.id !== 'string') {
    throw new Error('interactive permission thread omitted its id');
  }
  return started.thread.id;
}

async function checkInteractivePermissionCase(
  peer,
  fixtureLogPath,
  cwd,
  marker,
  caseName,
  decision,
  expectedOutcome,
) {
  const threadId = await startDevinThreadWithApproval(peer, cwd);
  const turn = startTurn(peer, threadId, marker);
  const approval = await peer.serverRequest(
    params => params?.threadId === threadId && params?.kind === 'command',
  );
  if (
    !['Set-Content value.txt fixture', "'Set-Content value.txt fixture'"].includes(approval.params?.command) ||
    typeof approval.params?.itemId !== 'string'
  ) {
    throw new Error(`unexpected interactive approval request: ${JSON.stringify(approval.params)}`);
  }
  approval.respond({ decision });
  await turn;
  const result = await waitForFixtureEvent(
    fixtureLogPath,
    event => event.command === 'permission-result' && event.case === caseName,
    `interactive ACP permission case ${caseName}`,
  );
  if (
    result.outcome !== expectedOutcome ||
    result.toolExecuted !== (expectedOutcome === 'selected')
  ) {
    throw new Error(`interactive permission case ${caseName} was unsafe: ${JSON.stringify(result)}`);
  }
  const warnings = peer.takeNotifications(
    'warning',
    params => params?.threadId === threadId && params?.message?.includes('Devin tool permission denied'),
  );
  if (
    expectedOutcome === 'cancelled' &&
    (warnings.length !== 1 || /Set-Content|value\.txt/.test(warnings[0].message))
  ) {
    throw new Error(`interactive permission case ${caseName} leaked command text in its warning`);
  }
}

function fixtureScript(source) {
  return `#!/usr/bin/env node\n${source.trim()}\n`;
}

function validateFixtureScript(path) {
  const checked = spawnSync(process.execPath, ['--check', path], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (checked.status !== 0) {
    throw new Error(
      `invalid generated fixture ${basename(path)}: ${(checked.stderr || checked.stdout).trim()}`,
    );
  }
}

async function requireNewAbsoluteDirectory(path, label) {
  if (!path || !isAbsolute(path)) throw new Error(`${label} must be an absolute path`);
  try {
    await access(path);
    throw new Error(`${label} already exists: ${path}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await mkdir(path, { recursive: false });
}

function completedAgentTexts(peer, threadId, turnId) {
  return peer
    .takeNotifications(
      'item/completed',
      params =>
        params?.threadId === threadId &&
        params?.turnId === turnId &&
        params?.item?.type === 'agentMessage',
    )
    .map(params => params.item.text);
}

async function runLiveWork() {
  const scriptedParent = arguments_.includes('--scripted-parent');
  const childOnly = arguments_.includes('--child-only');
  if (childOnly && !scriptedParent) throw new Error('--child-only requires --scripted-parent');
  if (permissionSmoke && (scriptedParent || childOnly)) {
    throw new Error('--permission-smoke cannot be combined with parent/child live-work options');
  }
  const devinExecutable = optionValue('--devin-executable');
  const stateRoot = optionValue('--state-root');
  const fixtureRoot = optionValue('--fixture-root');
  const logRoot = optionValue('--log-root');
  for (const [label, path] of [
    ['engine', enginePath],
    ['Devin executable', devinExecutable],
    ['state root', stateRoot],
  ]) {
    if (!path || !isAbsolute(path)) throw new Error(`${label} must be an absolute path`);
    await access(path, label === 'state root' ? constants.R_OK : constants.X_OK);
  }
  await requireNewAbsoluteDirectory(fixtureRoot, 'fixture root');
  await requireNewAbsoluteDirectory(logRoot, 'log root');
  await writeFile(join(fixtureRoot, 'input.txt'), 'one\n');
  await writeFile(
    join(fixtureRoot, 'check-value.cjs'),
    `const assert = require('node:assert/strict');\nconst fs = require('node:fs');\nassert.equal(fs.readFileSync('value.txt', 'utf8').trim(), process.argv[2]);\n`,
  );

  const liveEnvironment = { ...process.env };
  delete liveEnvironment.AZRAEL_EX_MANAGEMENT_SOCKET;
  delete liveEnvironment.AZRAEL_EX_INSTANCE_ID;
  let livePeer;
  let rootThreadId;
  let parentFixture;
  if (scriptedParent) {
    const { startScriptedParent } = await import('./devin-live-parent-fixture.mjs');
    parentFixture = await startScriptedParent({
      waitForChild: async stage => {
        const marker = stage === 1 ? 'CHILD_EDIT_OK' : 'CHILD_FOLLOWUP_OK';
        const deadline = Date.now() + LIVE_WAIT_MS;
        while (Date.now() < deadline) {
          const childIds = [...new Set(livePeer.notifications
            .filter(event => event.params?.threadId === rootThreadId && event.params?.item?.type === 'subAgentActivity')
            .map(event => event.params.item.agentThreadId).filter(Boolean))];
          if (childIds.length > 1) throw new Error('scripted parent created multiple children');
          if (childIds.length === 1) {
            const history = await livePeer.request('thread/read', { threadId: childIds[0], includeTurns: true });
            const turns = history.thread?.turns ?? [];
            if (turns.some(turn => ['failed', 'interrupted'].includes(turn.status))) {
              throw new Error(`live child failed before stage ${stage}: ${JSON.stringify(turns.map(turn => ({ status: turn.status, error: turn.error })))}`);
            }
            if (turns.some(turn => turn.status === 'completed' &&
                (turn.items ?? []).some(item => item.type === 'agentMessage' && item.text.trimEnd().endsWith(marker)))) return;
          }
          await new Promise(resolvePromise => setTimeout(resolvePromise, 250));
        }
        throw new Error(`live child did not complete stage ${stage}`);
      },
    });
  }
  const liveChild = spawn(
    enginePath,
    [
      '-c',
      'features.code_mode_host=true',
      '-c',
      'features.responses_websockets=false',
      ...(parentFixture ? ['-c', `model_providers.scripted_parent={name="Scripted parent fixture",base_url=${JSON.stringify(parentFixture.baseUrl)},wire_api="responses",requires_openai_auth=false}`] : []),
      'app-server',
      '--analytics-default-enabled',
    ],
    {
      cwd: fixtureRoot,
      env: {
        ...liveEnvironment,
        CODEX_HOME: stateRoot,
        AZRAEL_EX_DEVIN_EXECUTABLE: devinExecutable,
        AZRAEL_EX_PLAINTEXT_AGENTS: '1',
        DEVIN_PERMISSION_MODE: 'auto',
        ...(permissionSmoke ? { RUST_LOG: 'codex_core::devin=info' } : {}),
      },
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  let liveStderr = '';
  let activeTurn;
  liveChild.stderr.on('data', chunk => {
    liveStderr = (liveStderr + chunk).slice(-256 * 1024);
  });
  livePeer = new JsonLinePeer(liveChild, LIVE_WAIT_MS);
  try {
    await livePeer.request('initialize', {
      clientInfo: { name: 'azrael-devin-live-work-checker', version: '1' },
      capabilities: { experimentalApi: true },
    });
    livePeer.notify('initialized');

    let directThreadId;
    let directCompleted;
    let directTools = [];
    const modelSmoke = [];
    if (!childOnly) {
    const directStarted = await livePeer.request('thread/start', {
      model: 'devin/swe-2-high',
      cwd: fixtureRoot,
      approvalPolicy: 'never',
      sandbox: 'danger-full-access',
      ephemeral: false,
      experimentalRawEvents: true,
    });
    directThreadId = directStarted.thread?.id;
    if (
      typeof directThreadId !== 'string' ||
      directStarted.model !== 'devin/swe-2-high' ||
      directStarted.modelProvider !== 'devin'
    ) {
      throw new Error(`live direct thread selected the wrong model: ${JSON.stringify(directStarted)}`);
    }
    const directTurn = await livePeer.request('turn/start', {
      threadId: directThreadId,
      input: [{
        type: 'text',
        text: "Execute exactly `Write-Output 'DIRECT_PERMISSION_OK'` once in the shell. Confirm it succeeded, then reply with the exact final marker DIRECT_DONE.",
        textElements: [],
      }],
    });
    const directTurnId = directTurn.turn?.id;
    if (typeof directTurnId !== 'string') throw new Error('live direct turn omitted its id');
    activeTurn = { threadId: directThreadId, turnId: directTurnId };
    directCompleted = await livePeer.notification(
      'turn/completed',
      params => params?.threadId === directThreadId && params?.turn?.id === directTurnId,
    );
    activeTurn = undefined;
    if (directCompleted.turn.status !== 'completed' || directCompleted.turn.error !== null) {
      throw new Error(`live direct turn failed: ${JSON.stringify(directCompleted.turn)}`);
    }
    const directMessages = completedAgentTexts(livePeer, directThreadId, directTurnId);
    if (!directMessages.some(text => text.trimEnd().endsWith('DIRECT_DONE'))) {
      throw new Error(`live direct turn omitted DIRECT_DONE: ${JSON.stringify(directMessages)}`);
    }
    directTools = livePeer.takeNotifications(
      'item/completed',
      params =>
        params?.threadId === directThreadId &&
        params?.turnId === directTurnId &&
        params?.item?.type === 'dynamicToolCall' &&
        params.item.namespace === 'devin',
    );
    if (
      !directTools.some(
        params =>
          params.item.status === 'completed' &&
          params.item.success === true &&
          params.item.arguments?.exitCode === 0,
      )
    ) {
      throw new Error(`live direct command lacked a successful Devin tool item: ${JSON.stringify(directTools)}`);
    }

    const smokeModels = permissionSmoke
      ? ['devin/@group/swe-2/default/262000']
      : [
          'devin/@group/swe-2/default/262000',
          'devin/claude-opus-5-medium',
          'devin/gpt-5-5-medium',
        ];
    for (const model of smokeModels) {
      const marker = `MODEL_STREAM_OK_${modelSmoke.length}`;
      const started = await livePeer.request('thread/start', {
        model, cwd: fixtureRoot, approvalPolicy: 'never',
        sandbox: 'danger-full-access', ephemeral: false,
      });
      if (started.model !== model || started.modelProvider !== 'devin') {
        throw new Error(`model smoke selected the wrong provider/model: ${model}`);
      }
      const threadId = started.thread.id;
      const turn = await livePeer.request('turn/start', {
        threadId, effort: 'medium',
        input: [{ type: 'text', textElements: [], text:
          `First say you are checking the shell. Then execute exactly Write-Output '${marker}' once using PowerShell. After the tool result, include ${marker} in your final answer. Do not read or edit files.` }],
      });
      const turnId = turn.turn.id;
      activeTurn = { threadId, turnId };
      const completed = await livePeer.notification('turn/completed',
        params => params?.threadId === threadId && params?.turn?.id === turnId);
      activeTurn = undefined;
      const messages = completedAgentTexts(livePeer, threadId, turnId);
      const tools = livePeer.takeNotifications('item/completed', params =>
        params?.threadId === threadId && params?.turnId === turnId &&
        params?.item?.type === 'dynamicToolCall' && params.item.namespace === 'devin');
      if (completed.turn.status !== 'completed' || completed.turn.error ||
          !messages.some(text => text.includes(marker)) ||
          !tools.some(({ item }) => item.status === 'completed' && item.success === true && item.arguments?.exitCode === 0)) {
        throw new Error(`model smoke failed: ${JSON.stringify({ model, status: completed.turn.status, error: completed.turn.error, messages, tools })}`);
      }
      modelSmoke.push({ model, threadId, turnId, status: completed.turn.status, toolCount: tools.length });
      await writeFile(join(logRoot, 'model-smoke.json'), `${JSON.stringify(modelSmoke, null, 2)}\n`);
    }
    }

    let rootCompleted;
    let childThreadId;
    let childHistory;
    let childMessages = [];
    let childExecuteItems = [];
    let rawItems = [];
    if (!permissionSmoke) {
    const rootStarted = await livePeer.request('thread/start', {
      model: 'gpt-6-astra',
      ...(scriptedParent ? { modelProvider: 'scripted_parent' } : {}),
      cwd: fixtureRoot,
      approvalPolicy: 'never',
      sandbox: 'danger-full-access',
      ephemeral: false,
      experimentalRawEvents: true,
    });
    rootThreadId = rootStarted.thread?.id;
    if (
      typeof rootThreadId !== 'string' ||
      rootStarted.model !== 'gpt-6-astra' ||
      rootStarted.modelProvider !== (scriptedParent ? 'scripted_parent' : 'openai')
    ) {
      throw new Error(`live root thread selected the wrong model: ${JSON.stringify(rootStarted)}`);
    }
    const rootPrompt = `Use only azrael_agents collaboration tools for delegation. Do not edit or test fixture files yourself.
1. Spawn exactly one child with task_name "live_swe_work", agent_type "devin_swe2_medium", fork_turns "none", and no model or reasoning_effort override. Its message: "This is approved fixture implementation. In the current fixture directory, read only fixture input.txt, create or update only fixture value.txt to contain exactly one, explicitly use PowerShell execution to run node check-value.cjs one, then reply exactly CHILD_EDIT_OK."
2. Wait until that same child finishes and reports CHILD_EDIT_OK.
3. Use followup_task on that same child. Message: "Continue the approved fixture implementation. Update only fixture value.txt to contain exactly two, explicitly use PowerShell execution to run node check-value.cjs two, then reply exactly CHILD_FOLLOWUP_OK."
4. Wait until that same child finishes and reports CHILD_FOLLOWUP_OK.
Finally reply exactly ROOT_WORK_DONE.`;
    const rootTurn = await livePeer.request('turn/start', {
      threadId: rootThreadId,
      input: [{ type: 'text', text: rootPrompt, textElements: [] }],
    });
    const rootTurnId = rootTurn.turn?.id;
    if (typeof rootTurnId !== 'string') throw new Error('live root turn omitted its id');
    activeTurn = { threadId: rootThreadId, turnId: rootTurnId };
    rootCompleted = await livePeer.notification(
      'turn/completed',
      params => params?.threadId === rootThreadId && params?.turn?.id === rootTurnId,
    );
    activeTurn = undefined;
    if (rootCompleted.turn.status !== 'completed' || rootCompleted.turn.error !== null) {
      throw new Error(`live root turn failed: ${JSON.stringify(rootCompleted.turn)}`);
    }
    const rootMessages = completedAgentTexts(livePeer, rootThreadId, rootTurnId);
    if (!rootMessages.some(text => text.trimEnd().endsWith('ROOT_WORK_DONE'))) {
      throw new Error(`live root turn omitted ROOT_WORK_DONE: ${JSON.stringify(rootMessages)}`);
    }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 500));
    rawItems = livePeer
      .takeNotifications(
        'rawResponseItem/completed',
        params => params?.threadId === rootThreadId && params?.turnId === rootTurnId,
      )
      .map(params => params.item)
      .filter(item => item?.type === 'function_call' || item?.type === 'function_call_output');
    const calls = rawItems.filter(item => item.type === 'function_call');
    const outputs = new Map(
      rawItems.filter(item => item.type === 'function_call_output').map(item => [item.call_id, item]),
    );
    const collaborationCalls = calls.filter(item => item.namespace === 'azrael_agents');
    if (collaborationCalls.length === 0 || collaborationCalls.some(call => !outputs.has(call.call_id))) {
      throw new Error('live root omitted one or more collaboration call/output receipts');
    }
    const parsedCalls = collaborationCalls.map(call => ({
      ...call,
      parsed: JSON.parse(call.arguments),
    }));
    const spawnCalls = parsedCalls.filter(call => call.name === 'spawn_agent');
    const followupCalls = parsedCalls.filter(call => call.name === 'followup_task');
    if (
      spawnCalls.length !== 1 ||
      followupCalls.length !== 1 ||
      spawnCalls[0].parsed.task_name !== 'live_swe_work' ||
      spawnCalls[0].parsed.agent_type !== 'devin_swe2_medium' ||
      spawnCalls[0].parsed.fork_turns !== 'none' ||
      Object.hasOwn(spawnCalls[0].parsed, 'model') ||
      Object.hasOwn(spawnCalls[0].parsed, 'reasoning_effort')
    ) {
      throw new Error(`live root used the wrong collaboration contract: ${JSON.stringify(parsedCalls)}`);
    }
    const spawnOutput = JSON.parse(outputs.get(spawnCalls[0].call_id).output);
    if (
      typeof spawnOutput.task_name !== 'string' ||
      !spawnOutput.task_name.endsWith('/live_swe_work') ||
      ![spawnOutput.task_name, 'live_swe_work'].includes(followupCalls[0].parsed.target)
    ) {
      throw new Error('live follow-up did not target the child returned by spawn_agent');
    }
    const activities = livePeer.takeNotifications(
      'item/completed',
      params =>
        params?.threadId === rootThreadId &&
        params?.turnId === rootTurnId &&
        params?.item?.type === 'subAgentActivity',
    );
    const childThreadIds = [...new Set(activities.map(params => params.item.agentThreadId).filter(Boolean))];
    if (childThreadIds.length !== 1) {
      throw new Error(`live root did not use exactly one child: ${JSON.stringify(activities)}`);
    }
    childThreadId = childThreadIds[0];
    for (const call of [spawnCalls[0], followupCalls[0]]) {
      if (
        !activities.some(
          params => params.item.id === call.call_id && params.item.agentThreadId === childThreadId,
        )
      ) {
        throw new Error(`${call.name} activity was not linked to the single live child`);
      }
    }
    childHistory = await livePeer.request('thread/read', {
      threadId: childThreadId,
      includeTurns: true,
    });
    if (childHistory.thread?.model !== 'devin/swe-2-medium') {
      throw new Error(`live child model was not exact SWE-2 Medium: ${JSON.stringify(childHistory.thread)}`);
    }
    childMessages = (childHistory.thread?.turns ?? [])
      .flatMap(turn => turn.items ?? [])
      .filter(item => item.type === 'agentMessage')
      .map(item => item.text);
    if (
      !childMessages.some(text => text.trimEnd().endsWith('CHILD_EDIT_OK')) ||
      !childMessages.some(text => text.trimEnd().endsWith('CHILD_FOLLOWUP_OK'))
    ) {
      throw new Error(`live child omitted required final messages: ${JSON.stringify(childMessages)}`);
    }
    childExecuteItems = (childHistory.thread?.turns ?? [])
      .flatMap(turn => turn.items ?? [])
      .filter(
        item =>
          item.type === 'dynamicToolCall' &&
          item.namespace === 'devin' &&
          item.status === 'completed' &&
          item.success === true &&
          item.arguments?.kind === 'execute' &&
          item.arguments?.exitCode === 0,
      );
    if (childExecuteItems.length < 2) {
      throw new Error(`live child lacked two successful execute checks: ${JSON.stringify(childExecuteItems)}`);
    }
    if ((await readFile(join(fixtureRoot, 'value.txt'), 'utf8')).trim() !== 'two') {
      throw new Error('live child did not leave value.txt at the follow-up value');
    }
    await writeFile(
      join(logRoot, 'collaboration-receipts.jsonl'),
      `${rawItems.map(item => JSON.stringify(item)).join('\n')}\n`,
    );
    }
    const nativeApprovalRequestCount = livePeer.serverRequests.filter(
      request => request.params?.kind === 'command',
    ).length;
    if (nativeApprovalRequestCount !== 0) {
      throw new Error('full-access automatic permission emitted a native approval request');
    }
    const nativePermissionLogObserved =
      /devin_permission_decided/.test(liveStderr) && /full_access_never/.test(liveStderr);
    if (permissionSmoke && !nativePermissionLogObserved) {
      throw new Error('permission smoke did not observe the full_access_never decision');
    }
    await writeFile(join(logRoot, 'engine.stderr.log'), liveStderr);
    liveChild.stdin.end();
    const exit = await waitForExit(liveChild);
    if (exit.code !== 0) throw new Error(`live engine exited abnormally: ${JSON.stringify(exit)}`);
    livePeer.close();
    await writeFile(
      join(logRoot, 'result.json'),
      `${JSON.stringify({
        status: 'passed',
        parentMode: permissionSmoke
          ? 'skipped-permission-smoke'
          : scriptedParent
            ? 'scripted-responses-fixture'
            : 'live-astra',
        permissionSmoke,
        directChecksPerformed: !childOnly,
        directThreadId,
        rootThreadId,
        childThreadId,
        childModel: childHistory?.thread.model ?? null,
        modelSmoke,
        childMessages,
        directTurnStatus: directCompleted?.turn.status ?? null,
        rootTurnStatus: rootCompleted?.turn.status ?? null,
        directToolCount: directTools.length,
        childExecuteCount: childExecuteItems.length,
        collaborationReceiptCount: rawItems.length,
        nativePermissionLogObserved,
        nativeApprovalRequestCount,
        engineExitCode: exit.code,
      }, null, 2)}\n`,
    );
    console.log(JSON.stringify({
      status: 'passed',
      mode: permissionSmoke ? 'permission-smoke' : 'live-work',
      logRoot,
      fixtureRoot,
    }));
  } catch (error) {
    if (activeTurn) {
      try {
        await livePeer.request('turn/interrupt', activeTurn);
      } catch {
        // The test-owned turn may already have completed while the deadline fired.
      }
    }
    await writeFile(join(logRoot, 'engine.stderr.log'), liveStderr);
    await writeFile(join(logRoot, 'failure.log'), `${error.stack ?? error}\n`);
    throw error;
  } finally {
    if (liveChild.exitCode === null && liveChild.signalCode === null) {
      liveChild.stdin.end();
      try {
        await waitForExit(liveChild);
      } catch {
        liveChild.kill();
      }
    }
    livePeer.close();
    await closeServer(parentFixture?.server);
  }
}

if (liveWork) {
  await runLiveWork();
} else {
const workRoot = await mkdtemp(join(tmpdir(), 'azrael-devin-engine-'));
const stateDirectory = join(workRoot, 'state');
const fixtureDirectory = join(workRoot, 'fixture');
const fixtureStatePath = join(workRoot, 'devin-state.json');
const fixtureLogPath = join(workRoot, 'devin-events.jsonl');
const failurePath = join(workRoot, 'failure.log');
const managedCatalogPath = join(stateDirectory, 'azrael', 'devin', 'catalog.json');
const openAiAuthPath = join(stateDirectory, 'auth.json');
const skillDirectory = join(fixtureDirectory, '.agents', 'skills', 'devin-probe');
const skillPath = join(skillDirectory, 'SKILL.md');
const skillReferencePath = join(skillDirectory, 'references', 'probe.txt');
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const bundledCatalogPath = join(
  scriptDirectory,
  '..',
  'upstream',
  'codex',
  'codex-rs',
  'models-manager',
  'models.json',
);
let child;
let peer;
let stderr = '';
let succeeded = false;
let responses;

try {
  if (!isAbsolute(enginePath)) throw new Error('resolved engine path is not absolute');
  await access(enginePath, constants.X_OK);
  await mkdir(stateDirectory, { recursive: true });
  await mkdir(fixtureDirectory, { recursive: true });
  await mkdir(join(skillDirectory, 'references'), { recursive: true });
  await mkdir(dirname(managedCatalogPath), { recursive: true });
  responses = await startResponsesServer();
  await writeFile(fixtureStatePath, JSON.stringify({ loggedIn: true }));
  const syntheticOpenAiAuth = `${JSON.stringify({
    OPENAI_API_KEY: SYNTHETIC_OPENAI_KEY,
    tokens: null,
    last_refresh: null,
  })}\n`;
  await writeFile(openAiAuthPath, syntheticOpenAiAuth);
  await writeFile(
    join(fixtureDirectory, 'AGENTS.md'),
    `# Devin engine fixture\n\nAlways preserve this instruction marker: ${AGENTS_MARKER}.\n`,
  );
  await writeFile(
    skillPath,
    `---
name: devin-probe
description: Verify exact Devin skill context transfer.
---

Preserve this activated skill body marker: ${SKILL_BODY_MARKER}.
Read the supporting reference at references/probe.txt and preserve its marker ${SKILL_REFERENCE_MARKER}.
`,
  );
  await writeFile(skillReferencePath, `${SKILL_REFERENCE_MARKER}\n`);
  await writeFile(managedCatalogPath, await readFile(bundledCatalogPath));
  await writeFile(
    join(stateDirectory, 'config.toml'),
    `model = "gpt-6-astra"
model_provider = "openai"
approval_policy = "never"
sandbox_mode = "danger-full-access"
model_catalog_json = ${JSON.stringify(managedCatalogPath)}
openai_base_url = ${JSON.stringify(responses.baseUrl)}
cli_auth_credentials_store = "file"

[features]
multi_agent = true
multi_agent_v2 = true
plugins = false
responses_websockets = false
`,
  );

  const sharedPreamble = `
const fs = require('node:fs');
const path = require('node:path');
const root = process.env.AZRAEL_DEVIN_FIXTURE_ROOT;
const statePath = path.join(root, 'devin-state.json');
const logPath = path.join(root, 'devin-events.jsonl');
const state = () => JSON.parse(fs.readFileSync(statePath, 'utf8'));
const log = event => fs.appendFileSync(logPath, JSON.stringify({ ...event, pid: process.pid }) + '\\n');
const present = names => names.filter(name => Object.hasOwn(process.env, name));
`;
  await writeFile(
    join(fixtureDirectory, 'auth'),
    fixtureScript(`${sharedPreamble}
const action = process.argv[2];
const forbidden = present(['WINDSURF_API_KEY']);
log({ command: 'auth', action, forbidden });
if (forbidden.length || !['status', 'logout'].includes(action)) process.exit(21);
if (action === 'logout') {
  fs.writeFileSync(statePath, JSON.stringify({ loggedIn: false }));
  process.stdout.write('Logged out.\\n');
  process.exit(0);
}
if (state().loggedIn) {
  process.stdout.write('Logged in (via Devin).\\nEmail: fixture@devin.invalid\\nPlan: test\\n');
} else {
  process.stdout.write('Not logged in.\\n');
}`),
  );
  await writeFile(
    join(fixtureDirectory, 'models'),
    fixtureScript(`${sharedPreamble}
const forbidden = present(['WINDSURF_API_KEY']);
log({ command: 'models', args: process.argv.slice(2), forbidden });
if (forbidden.length || process.argv.slice(2).join(' ') !== 'list --format json') process.exit(22);
process.stdout.write(JSON.stringify({ families: [{
  family_label: 'SWE', family_uid: 'swe', slug: 'swe', aliases: ['swe'], variants: [
    ...Array.from({ length: ${DEVIN_VARIANT_COUNT - 1} }, (_, index) => ({
      model_uid: 'fixture-' + String(index).padStart(3, '0'),
      label: 'Fixture ' + String(index).padStart(3, '0'),
      max_context_tokens: 200000,
      max_output_tokens: 64000,
    })), {
    model_uid: 'swe-2-medium', label: 'SWE-2 Medium',
    max_context_tokens: 200000, max_output_tokens: 64000,
  }],
}] }));
`),
  );
  await writeFile(
    join(fixtureDirectory, 'acp'),
    fixtureScript(`${sharedPreamble}
const readline = require('node:readline');
const forbidden = present(['WINDSURF_API_KEY', 'DEVIN_MODEL', 'DEVIN_REFUSAL_FALLBACK']);
const modelIndex = process.argv.indexOf('--model');
const model = modelIndex >= 0 ? process.argv[modelIndex + 1] : undefined;
let loaded = false;
let pendingPrompt;
let permissionPrompt;
let permissionCase;
let permissionExpectation;
let permissionOptionId;
log({ command: 'acp', model, forbidden });
if (forbidden.length || model !== 'swe-2-medium') process.exit(23);
const send = message => process.stdout.write(JSON.stringify(message) + '\\n');
readline.createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line);
  log({ command: 'acp-rpc', method: request.method, params: request.params });
  if (!Object.hasOwn(request, 'id')) {
    if (request.method === 'session/cancel') {
      log({ command: 'cancel-received', sessionId: request.params?.sessionId });
    }
    return;
  }
  if (!request.method && request.id === 'fixture-permission') {
    const outcome = request.result?.outcome?.outcome;
    const optionId = request.result?.outcome?.optionId;
    const toolExecuted = outcome === 'selected';
    log({ command: 'permission-result', case: permissionCase, outcome, optionId, toolExecuted });
    if (
      outcome !== permissionExpectation ||
      (permissionExpectation === 'selected' && optionId !== permissionOptionId)
    ) process.exit(24);
    send({ jsonrpc: '2.0', method: 'session/update', params: {
      sessionId: 'fixture-session',
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '${RESPONSE_TEXT}' } },
    } });
    send({ jsonrpc: '2.0', id: permissionPrompt, result: { stopReason: 'end_turn' } });
    return;
  }
  if (request.method === 'initialize') {
    send({ jsonrpc: '2.0', id: request.id, result: {
      protocolVersion: 1,
      agentCapabilities: { loadSession: true },
      authMethods: [{ id: 'devin-browser', name: 'Mock Devin browser login' }],
    } });
  } else if (request.method === 'authenticate') {
    if (request.params?.methodId !== 'devin-browser') process.exit(25);
    fs.writeFileSync(statePath, JSON.stringify({ loggedIn: true }));
    log({ command: 'authenticate', methodId: request.params.methodId });
    send({ jsonrpc: '2.0', id: request.id, result: {} });
  } else if (request.method === 'session/new') {
    send({ jsonrpc: '2.0', id: request.id, result: { sessionId: 'fixture-session' } });
  } else if (request.method === 'session/load') {
    loaded = true;
    send({ jsonrpc: '2.0', id: request.id, result: {} });
  } else if (request.method === 'session/set_config_option') {
    send({ jsonrpc: '2.0', id: request.id, result: {
      configOptions: [{ id: 'model', currentValue: request.params.value }],
    } });
  } else if (request.method === 'session/prompt') {
    const prompt = JSON.stringify(request.params.prompt);
    if (prompt.includes('${ROOT_USER_MARKER}') && !prompt.includes('${CHILD_TASK_MARKER}')) {
      log({ command: 'invalid-child-prompt', reason: 'missing-task-marker' });
      send({ jsonrpc: '2.0', id: request.id, error: {
        code: -32602, message: 'spawned child prompt omitted its NEW_TASK payload',
      } });
    } else if (prompt.includes('${CANCEL_USER_MARKER}')) {
      pendingPrompt = request.id;
      log({ command: 'prompt-pending', id: pendingPrompt });
    } else if (prompt.includes('${PERMISSION_EOF_MARKER}')) {
      send({ jsonrpc: '2.0', method: 'session/update', params: {
        sessionId: request.params.sessionId,
        update: { sessionUpdate: 'tool_call', toolCallId: 'eof-tool', title: 'Pending command',
          kind: 'execute', status: 'in_progress',
          rawInput: { command: 'Set-Content value.txt fixture', shell_flavor: 'powershell' } },
      } });
      send({ jsonrpc: '2.0', id: 'eof-permission', method: 'session/request_permission', params: {
        sessionId: request.params.sessionId, toolCall: { toolCallId: 'eof-tool' },
        options: [{ optionId: 'once', kind: 'allow_once' }],
      } });
      // Stay alive until the checker has observed the native approval request.
      const exitSignal = setInterval(() => {
        if (fs.existsSync(path.join(root, 'exit-acp'))) {
          clearInterval(exitSignal);
          process.exit(17);
        }
      }, 20);
    } else if (
      prompt.includes('${PERMISSION_USER_MARKER}') ||
      prompt.includes('${PERMISSION_ALLOW_USER_MARKER}') ||
      prompt.includes('${PERMISSION_FORBIDDEN_USER_MARKER}') ||
      prompt.includes('${PERMISSION_DYNAMIC_USER_MARKER}') ||
      prompt.includes('${PERMISSION_UNKNOWN_KIND_USER_MARKER}') ||
      prompt.includes('${PERMISSION_MISSING_OPTION_USER_MARKER}') ||
      prompt.includes('${PERMISSION_AMBIGUOUS_OPTION_USER_MARKER}') ||
      prompt.includes('${PERMISSION_MALFORMED_OPTION_USER_MARKER}') ||
      prompt.includes('${PERMISSION_MISSING_SHELL_USER_MARKER}') ||
      prompt.includes('${PERMISSION_UNKNOWN_SHELL_USER_MARKER}') ||
      prompt.includes('${PERMISSION_OVERRIDE_USER_MARKER}') ||
      prompt.includes('${PERMISSION_OPAQUE_USER_MARKER}') ||
      prompt.includes('${PERMISSION_NON_EXECUTE_USER_MARKER}') ||
      prompt.includes('${PERMISSION_CONFLICT_USER_MARKER}') ||
      prompt.includes('${PERMISSION_STALE_USER_MARKER}') ||
      prompt.includes('${PERMISSION_CROSS_SESSION_USER_MARKER}') ||
      prompt.includes('${PERMISSION_INVALID_CALL_ID_MARKER}') ||
      prompt.includes('${PERMISSION_INTERACTIVE_ACCEPT_MARKER}') ||
      prompt.includes('${PERMISSION_INTERACTIVE_DECLINE_MARKER}') ||
      prompt.includes('${PERMISSION_INTERACTIVE_CANCEL_MARKER}')
    ) {
      permissionPrompt = request.id;
      let options = [
        { optionId: 'allow-once', kind: 'allow_once' },
        { optionId: 'allow-session', kind: 'allow_always' },
        { optionId: 'allow-global', kind: 'allow_always' },
        { optionId: 'reject-once', kind: 'reject_once' },
      ];
      let observed = {
        sessionUpdate: 'tool_call', title: 'Run fixture command', kind: 'execute',
        rawInput: { command: "Write-Output 'fixture'", shell_flavor: 'powershell' },
      };
      let requestSessionId = request.params.sessionId;
      permissionExpectation = 'selected';
      permissionOptionId = 'allow-once';
      if (prompt.includes('${PERMISSION_ALLOW_USER_MARKER}')) {
        permissionCase = 'allow-safe-powershell';
      } else if (prompt.includes('${PERMISSION_FORBIDDEN_USER_MARKER}')) {
        permissionCase = 'allow-forbidden-powershell';
        observed = {
          ...observed,
          rawInput: {
            command: 'Remove-Item -Recurse -Force C:/forbidden', shell_flavor: 'powershell',
          },
        };
      } else if (prompt.includes('${PERMISSION_DYNAMIC_USER_MARKER}')) {
        permissionCase = 'allow-dynamic-powershell';
        observed = {
          ...observed,
          rawInput: { command: 'Write-Output $env:PATH', shell_flavor: 'powershell' },
        };
      } else if (prompt.includes('${PERMISSION_UNKNOWN_KIND_USER_MARKER}')) {
        permissionCase = 'allow-unknown-kind';
        observed = { ...observed, kind: 'unknown' };
      } else if (prompt.includes('${PERMISSION_MISSING_OPTION_USER_MARKER}')) {
        permissionCase = 'deny-missing-allow-once';
        permissionExpectation = 'cancelled';
        permissionOptionId = undefined;
        options = [{ optionId: 'allow-always', kind: 'allow_always' }];
      } else if (prompt.includes('${PERMISSION_AMBIGUOUS_OPTION_USER_MARKER}')) {
        permissionCase = 'deny-ambiguous-allow-once';
        permissionExpectation = 'cancelled';
        permissionOptionId = undefined;
        options = [
          { optionId: 'allow-once-a', kind: 'allow_once' },
          { optionId: 'allow-once-b', kind: 'allow_once' },
        ];
      } else if (prompt.includes('${PERMISSION_MALFORMED_OPTION_USER_MARKER}')) {
        permissionCase = 'deny-malformed-allow-once';
        permissionExpectation = 'cancelled';
        permissionOptionId = undefined;
        options = [{ optionId: 7, kind: 'allow_once' }];
      } else if (prompt.includes('${PERMISSION_MISSING_SHELL_USER_MARKER}')) {
        permissionCase = 'allow-missing-shell-flavor';
        observed = { ...observed, rawInput: { command: "Write-Output 'fixture'" } };
      } else if (prompt.includes('${PERMISSION_UNKNOWN_SHELL_USER_MARKER}')) {
        permissionCase = 'allow-unknown-shell-flavor';
        observed = {
          ...observed,
          rawInput: { command: "Write-Output 'fixture'", shell_flavor: 'bash' },
        };
      } else if (prompt.includes('${PERMISSION_OVERRIDE_USER_MARKER}')) {
        permissionCase = 'allow-execution-overrides';
        observed = {
          ...observed,
          rawInput: {
            command: "Write-Output 'fixture'", shell_flavor: 'unknown',
            cwd: 'C:/alternate', workdir: 'C:/work', workingDirectory: 'C:/working',
            shell: 'custom-shell', executable: 'custom.exe',
          },
        };
      } else if (prompt.includes('${PERMISSION_OPAQUE_USER_MARKER}')) {
        permissionCase = 'allow-opaque-command';
        observed = {
          ...observed,
          rawInput: { command: '& $env:OPAQUE_COMMAND', shell_flavor: 'powershell' },
        };
      } else if (prompt.includes('${PERMISSION_NON_EXECUTE_USER_MARKER}')) {
        permissionCase = 'allow-non-execute-tool';
        observed = {
          ...observed,
          kind: 'edit',
          rawInput: { path: 'C:/work/value.txt', patch: 'opaque edit payload' },
        };
      } else if (prompt.includes('${PERMISSION_CONFLICT_USER_MARKER}')) {
        permissionCase = 'deny-conflicting-observation';
        permissionExpectation = 'cancelled';
        permissionOptionId = undefined;
      } else if (prompt.includes('${PERMISSION_STALE_USER_MARKER}')) {
        permissionCase = 'deny-stale-observation';
        permissionExpectation = 'cancelled';
        permissionOptionId = undefined;
      } else if (prompt.includes('${PERMISSION_CROSS_SESSION_USER_MARKER}')) {
        permissionCase = 'deny-cross-session-request';
        permissionExpectation = 'cancelled';
        permissionOptionId = undefined;
        requestSessionId = 'other-session';
      } else if (prompt.includes('${PERMISSION_INVALID_CALL_ID_MARKER}')) {
        permissionCase = 'deny-invalid-call-id';
        permissionExpectation = 'cancelled';
        permissionOptionId = undefined;
      } else if (prompt.includes('${PERMISSION_INTERACTIVE_ACCEPT_MARKER}')) {
        permissionCase = 'interactive-accept';
        permissionExpectation = 'selected';
        permissionOptionId = 'allow-once';
        observed = {
          ...observed,
          rawInput: { command: 'Set-Content value.txt fixture', shell_flavor: 'powershell' },
        };
      } else if (prompt.includes('${PERMISSION_INTERACTIVE_DECLINE_MARKER}')) {
        permissionCase = 'interactive-decline';
        permissionExpectation = 'cancelled';
        permissionOptionId = undefined;
        observed = {
          ...observed,
          rawInput: { command: 'Set-Content value.txt fixture', shell_flavor: 'powershell' },
        };
      } else if (prompt.includes('${PERMISSION_INTERACTIVE_CANCEL_MARKER}')) {
        permissionCase = 'interactive-cancel';
        permissionExpectation = 'cancelled';
        permissionOptionId = undefined;
        observed = {
          ...observed,
          rawInput: { command: 'Set-Content value.txt fixture', shell_flavor: 'powershell' },
        };
      } else {
        permissionCase = 'allow-missing-kind';
        observed = { ...observed };
        delete observed.kind;
      }
      const toolCallId = 'fixture-permission-' + permissionCase;
      observed.toolCallId = toolCallId;
      send({ jsonrpc: '2.0', method: 'session/update', params: {
        sessionId: request.params.sessionId, update: observed,
      } });
      if (permissionCase === 'deny-conflicting-observation') {
        send({ jsonrpc: '2.0', method: 'session/update', params: {
          sessionId: request.params.sessionId,
          update: {
            ...observed,
            rawInput: { command: "Write-Output 'conflict'", shell_flavor: 'powershell' },
          },
        } });
      }
      if (permissionCase === 'deny-stale-observation') {
        send({ jsonrpc: '2.0', method: 'session/update', params: {
          sessionId: request.params.sessionId,
          update: { sessionUpdate: 'tool_call_update', toolCallId, status: 'completed' },
        } });
      }
      send({ jsonrpc: '2.0', id: 'fixture-permission', method: 'session/request_permission', params: {
        sessionId: requestSessionId,
        options,
        toolCall: {
          toolCallId: permissionCase === 'deny-invalid-call-id' ? '' : toolCallId,
          _meta: { source: 'fixture' },
        },
      } });
    } else if (prompt.includes('${TOOL_OBSERVATION_USER_MARKER}')) {
      // A text item stays open while independent tool lifecycle events arrive.
      // The former synthetic progress messages closed that item and caused
      // OutputTextDelta without active item on the next text chunk.
      send({ jsonrpc: '2.0', method: 'session/update', params: {
        sessionId: request.params.sessionId,
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Before tool. ' } },
      } });
      send({ jsonrpc: '2.0', method: 'session/update', params: {
        sessionId: request.params.sessionId,
        update: {
          sessionUpdate: 'tool_call', toolCallId: 'exec:fixture', title: 'Ran ls',
          kind: 'execute', status: 'in_progress', rawInput: { command: 'private fixture command' },
        },
      } });
      send({ jsonrpc: '2.0', method: 'session/update', params: {
        sessionId: request.params.sessionId,
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'During tool. ' } },
      } });
      send({ jsonrpc: '2.0', method: 'session/update', params: {
        sessionId: request.params.sessionId,
        update: {
          sessionUpdate: 'tool_call_update', toolCallId: 'exec:fixture', status: 'failed',
          content: [{ type: 'content', content: { type: 'text', text: '${TOOL_FAILURE_TEXT}' } }],
          _meta: { 'cognition.ai/rejected': true },
        },
      } });
      send({ jsonrpc: '2.0', method: 'session/update', params: {
        sessionId: request.params.sessionId,
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '${RESPONSE_TEXT}' } },
      } });
      send({ jsonrpc: '2.0', id: request.id, result: { stopReason: 'end_turn', loaded } });
    } else {
      send({ jsonrpc: '2.0', method: 'session/update', params: {
        sessionId: request.params.sessionId,
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '${RESPONSE_TEXT}' } },
      } });
      send({ jsonrpc: '2.0', id: request.id, result: { stopReason: 'end_turn', loaded } });
    }
  } else {
    send({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'unsupported fixture method' } });
  }
});
`),
  );
  for (const command of ['auth', 'models', 'acp']) {
    validateFixtureScript(join(fixtureDirectory, command));
  }

  const fixtureEnvironment = { ...process.env };
  delete fixtureEnvironment.OPENAI_API_KEY;
  delete fixtureEnvironment.OPENAI_BASE_URL;
  delete fixtureEnvironment.AZRAEL_EX_MANAGEMENT_SOCKET;
  delete fixtureEnvironment.AZRAEL_EX_INSTANCE_ID;
  child = spawn(
    enginePath,
    [
      '-c',
      'features.code_mode_host=true',
      '-c',
      'features.responses_websockets=false',
      '-c',
      'features.plugins=false',
      'app-server',
      '--analytics-default-enabled',
    ],
    {
      cwd: fixtureDirectory,
      env: {
        ...fixtureEnvironment,
        CODEX_HOME: stateDirectory,
        AZRAEL_EX_DEVIN_EXECUTABLE: process.execPath,
        AZRAEL_EX_PLAINTEXT_AGENTS: '1',
        AZRAEL_DEVIN_FIXTURE_ROOT: workRoot,
        WINDSURF_API_KEY: 'must-be-removed',
        DEVIN_MODEL: 'must-be-removed',
        DEVIN_REFUSAL_FALLBACK: 'must-be-removed',
      },
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  child.stderr.on('data', chunk => {
    stderr = (stderr + chunk).slice(-32_000);
  });
  peer = new JsonLinePeer(child);
  await peer.request('initialize', {
    clientInfo: { name: 'codex_vscode', version: '0.1.0' },
    capabilities: { experimentalApi: true },
  });
  peer.notify('initialized');

  const beforeIdentity = await peer.request('account/read', { refreshToken: false });
  const expectedSyntheticIdentity = {
    account: { type: 'apiKey' },
    requiresOpenaiAuth: true,
  };
  if (
    JSON.stringify(Object.keys(beforeIdentity).sort()) !==
      JSON.stringify(Object.keys(expectedSyntheticIdentity).sort()) ||
    beforeIdentity.requiresOpenaiAuth !== true ||
    JSON.stringify(beforeIdentity.account) !== JSON.stringify(expectedSyntheticIdentity.account)
  ) {
    throw new Error(`unexpected synthetic OpenAI identity: ${JSON.stringify(beforeIdentity)}`);
  }
  const account = await peer.request('azrael/devin', { action: 'status' });
  if (!account.enabled || !account.loggedIn || account.email !== 'fixture@devin.invalid') {
    throw new Error(`unexpected Devin status: ${JSON.stringify(account)}`);
  }

  const started = await peer.request('thread/start', {
    model: 'devin/swe-2-medium',
    cwd: fixtureDirectory,
    approvalPolicy: 'never',
    sandbox: 'danger-full-access',
    ephemeral: true,
  });
  if (
    started.model !== 'devin/swe-2-medium' ||
    started.modelProvider !== 'devin' ||
    !started.instructionSources.some(path => resolve(path) === resolve(fixtureDirectory, 'AGENTS.md'))
  ) {
    throw new Error(
      `cold thread/start did not select Devin with fixture instructions: ${JSON.stringify(started)}`,
    );
  }
  const threadId = started.thread?.id;
  if (typeof threadId !== 'string') throw new Error('cold thread/start omitted the thread id');

  const initialModels = await peer.request('model/list', {
    cursor: null,
    limit: 100,
    includeHidden: false,
  });
  const nativeCount = assertCatalog(initialModels, true);
  if (
    initialModels.nextCursor !== null ||
    initialModels.data.length !== nativeCount + DEVIN_VARIANT_COUNT
  ) {
    throw new Error('simulated pinned UI model/list was paginated or truncated');
  }
  const explicitlyPaged = await peer.request('model/list', {
    cursor: null,
    limit: 1,
    includeHidden: false,
  });
  if (explicitlyPaged.data.length !== 1 || explicitlyPaged.nextCursor === null) {
    throw new Error('explicit model/list limit no longer paginates');
  }

  await expectRpcError(
    peer.request('thread/start', {
      model: 'devin/swe-2-unknown',
      cwd: fixtureDirectory,
      approvalPolicy: 'never',
      sandbox: 'danger-full-access',
      ephemeral: true,
    }),
    'unknown Devin model',
    'unknown Devin model selection',
  );

  await startTurn(peer, threadId, FIRST_USER_MARKER, [
    { type: 'skill', name: 'devin-probe', path: skillPath },
  ]);
  await startTurn(peer, threadId, SECOND_USER_MARKER);

  const events = (await readFile(fixtureLogPath, 'utf8'))
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line));
  const prompts = events.filter(event => event.command === 'acp-rpc' && event.method === 'session/prompt');
  if (prompts.length !== 2) throw new Error(`expected two ACP prompts, got ${prompts.length}`);
  const firstContext = JSON.stringify(prompts[0].params.prompt);
  const secondContext = JSON.stringify(prompts[1].params.prompt);
  if (
    !firstContext.includes(AGENTS_MARKER) ||
    !firstContext.includes(FIRST_USER_MARKER) ||
    !firstContext.includes(SKILL_BODY_MARKER) ||
    !firstContext.includes(SKILL_REFERENCE_MARKER) ||
    !firstContext.includes('references/probe.txt') ||
    !firstContext.includes('devin-probe')
  ) {
    throw new Error('first ACP prompt omitted AGENTS, user, or activated skill context');
  }
  if (!secondContext.includes(SECOND_USER_MARKER)) {
    throw new Error('resumed ACP prompt omitted the second user message');
  }
  if (!events.some(event => event.command === 'acp-rpc' && event.method === 'session/load')) {
    throw new Error('second Devin turn did not load the provider session');
  }
  if (events.some(event => Array.isArray(event.forbidden) && event.forbidden.length > 0)) {
    throw new Error('Devin subprocess inherited a forbidden account/model override');
  }

  const acpPromptsBeforeSwitch = prompts.length;
  await startTurn(
    peer,
    threadId,
    SWITCH_OPENAI_MARKER,
    [],
    { model: 'gpt-6-astra' },
    SWITCH_OPENAI_RESPONSE,
  );
  const afterAstraSwitch = await readFixtureEvents(fixtureLogPath);
  if (
    afterAstraSwitch.filter(
      event => event.command === 'acp-rpc' && event.method === 'session/prompt',
    ).length !== acpPromptsBeforeSwitch
  ) {
    throw new Error('same-thread Astra override incorrectly routed through Devin ACP');
  }
  const beforeSwitchBackEventCount = afterAstraSwitch.length;
  await startTurn(
    peer,
    threadId,
    SWITCH_BACK_DEVIN_MARKER,
    [],
    { model: 'devin/swe-2-medium' },
  );
  const switchBackEvents = (await readFixtureEvents(fixtureLogPath)).slice(
    beforeSwitchBackEventCount,
  );
  const switchBackPrompt = switchBackEvents.find(
    event =>
      event.command === 'acp-rpc' &&
      event.method === 'session/prompt' &&
      JSON.stringify(event.params).includes(SWITCH_BACK_DEVIN_MARKER),
  );
  const switchBackContext = JSON.stringify(switchBackPrompt?.params?.prompt);
  if (
    !switchBackPrompt ||
    !switchBackContext.includes(SWITCH_OPENAI_MARKER) ||
    !switchBackContext.includes(SWITCH_OPENAI_RESPONSE)
  ) {
    throw new Error('switching back to Devin omitted the intervening Astra context');
  }
  if (
    !switchBackEvents.some(
      event =>
        event.command === 'acp-rpc' &&
        (event.method === 'session/load' || event.method === 'session/new'),
    )
  ) {
    throw new Error('switching back to Devin neither resumed nor reconciled a new ACP session');
  }

  const cancelThreadId = await startDevinThread(peer, fixtureDirectory);
  const cancelTurn = await peer.request('turn/start', {
    threadId: cancelThreadId,
    input: [{ type: 'text', text: CANCEL_USER_MARKER, textElements: [] }],
  });
  const cancelTurnId = cancelTurn.turn?.id;
  if (typeof cancelTurnId !== 'string') throw new Error('cancel fixture turn omitted its id');
  await waitForFixtureEvent(
    fixtureLogPath,
    event =>
      event.command === 'acp-rpc' &&
      event.method === 'session/prompt' &&
      JSON.stringify(event.params).includes(CANCEL_USER_MARKER),
    'pending ACP prompt',
  );
  const logoutEventsBeforeActiveRejection = (await readFixtureEvents(fixtureLogPath)).filter(
    event => event.command === 'auth' && event.action === 'logout',
  ).length;
  await expectRpcError(
    peer.request('azrael/devin', { action: 'logout' }),
    'Devin logout during an active turn',
    'active turns',
  );
  const logoutEventsAfterActiveRejection = (await readFixtureEvents(fixtureLogPath)).filter(
    event => event.command === 'auth' && event.action === 'logout',
  ).length;
  if (logoutEventsAfterActiveRejection !== logoutEventsBeforeActiveRejection) {
    throw new Error('active-turn logout rejection invoked the Devin logout command');
  }
  await peer.request('turn/interrupt', { threadId: cancelThreadId, turnId: cancelTurnId });
  const interrupted = await peer.notification(
    'turn/completed',
    params => params?.threadId === cancelThreadId && params?.turn?.id === cancelTurnId,
  );
  if (interrupted.turn.status !== 'interrupted') {
    throw new Error(`Devin turn interruption did not finish cleanly: ${JSON.stringify(interrupted)}`);
  }
  await waitForFixtureEvent(
    fixtureLogPath,
    event => event.command === 'cancel-received',
    'ACP session/cancel notification',
  );

  await checkPermissionCase(
    peer,
    fixtureLogPath,
    fixtureDirectory,
    PERMISSION_USER_MARKER,
    'allow-missing-kind',
    'selected',
  );
  await checkPermissionCase(
    peer,
    fixtureLogPath,
    fixtureDirectory,
    PERMISSION_ALLOW_USER_MARKER,
    'allow-safe-powershell',
    'selected',
  );
  await checkPermissionCase(
    peer,
    fixtureLogPath,
    fixtureDirectory,
    PERMISSION_FORBIDDEN_USER_MARKER,
    'allow-forbidden-powershell',
    'selected',
  );
  await checkPermissionCase(
    peer,
    fixtureLogPath,
    fixtureDirectory,
    PERMISSION_DYNAMIC_USER_MARKER,
    'allow-dynamic-powershell',
    'selected',
  );
  await checkPermissionCase(
    peer,
    fixtureLogPath,
    fixtureDirectory,
    PERMISSION_UNKNOWN_KIND_USER_MARKER,
    'allow-unknown-kind',
    'selected',
  );
  await checkPermissionCase(
    peer,
    fixtureLogPath,
    fixtureDirectory,
    PERMISSION_MISSING_OPTION_USER_MARKER,
    'deny-missing-allow-once',
    'cancelled',
  );
  await checkPermissionCase(
    peer,
    fixtureLogPath,
    fixtureDirectory,
    PERMISSION_AMBIGUOUS_OPTION_USER_MARKER,
    'deny-ambiguous-allow-once',
    'cancelled',
  );
  await checkPermissionCase(
    peer,
    fixtureLogPath,
    fixtureDirectory,
    PERMISSION_MALFORMED_OPTION_USER_MARKER,
    'deny-malformed-allow-once',
    'cancelled',
  );
  await checkPermissionCase(
    peer,
    fixtureLogPath,
    fixtureDirectory,
    PERMISSION_MISSING_SHELL_USER_MARKER,
    'allow-missing-shell-flavor',
    'selected',
  );
  await checkPermissionCase(
    peer,
    fixtureLogPath,
    fixtureDirectory,
    PERMISSION_UNKNOWN_SHELL_USER_MARKER,
    'allow-unknown-shell-flavor',
    'selected',
  );
  await checkPermissionCase(
    peer,
    fixtureLogPath,
    fixtureDirectory,
    PERMISSION_OVERRIDE_USER_MARKER,
    'allow-execution-overrides',
    'selected',
  );
  await checkPermissionCase(
    peer,
    fixtureLogPath,
    fixtureDirectory,
    PERMISSION_OPAQUE_USER_MARKER,
    'allow-opaque-command',
    'selected',
  );
  await checkPermissionCase(
    peer,
    fixtureLogPath,
    fixtureDirectory,
    PERMISSION_NON_EXECUTE_USER_MARKER,
    'allow-non-execute-tool',
    'selected',
  );
  await checkPermissionCase(
    peer,
    fixtureLogPath,
    fixtureDirectory,
    PERMISSION_CONFLICT_USER_MARKER,
    'deny-conflicting-observation',
    'cancelled',
  );
  await checkPermissionCase(
    peer,
    fixtureLogPath,
    fixtureDirectory,
    PERMISSION_STALE_USER_MARKER,
    'deny-stale-observation',
    'cancelled',
  );
  await checkPermissionCase(
    peer,
    fixtureLogPath,
    fixtureDirectory,
    PERMISSION_CROSS_SESSION_USER_MARKER,
    'deny-cross-session-request',
    'cancelled',
  );
  await checkPermissionCase(
    peer,
    fixtureLogPath,
    fixtureDirectory,
    PERMISSION_INVALID_CALL_ID_MARKER,
    'deny-invalid-call-id',
    'cancelled',
  );
  await checkInteractivePermissionCase(
    peer,
    fixtureLogPath,
    fixtureDirectory,
    PERMISSION_INTERACTIVE_ACCEPT_MARKER,
    'interactive-accept',
    'accept',
    'selected',
  );
  await checkInteractivePermissionCase(
    peer,
    fixtureLogPath,
    fixtureDirectory,
    PERMISSION_INTERACTIVE_DECLINE_MARKER,
    'interactive-decline',
    'decline',
    'cancelled',
  );

  const interactiveCancelEventCount = (await readFixtureEvents(fixtureLogPath)).length;
  const interactiveCancelThreadId = await startDevinThreadWithApproval(peer, fixtureDirectory);
  const interactiveCancelTurn = await peer.request('turn/start', {
    threadId: interactiveCancelThreadId,
    input: [{ type: 'text', text: PERMISSION_INTERACTIVE_CANCEL_MARKER, textElements: [] }],
  });
  const interactiveCancelTurnId = interactiveCancelTurn.turn?.id;
  if (typeof interactiveCancelTurnId !== 'string') {
    throw new Error('interactive cancellation turn omitted its id');
  }
  await peer.serverRequest(
    params =>
      params?.threadId === interactiveCancelThreadId &&
      params?.turnId === interactiveCancelTurnId &&
      params?.kind === 'command',
  );
  await peer.request('turn/interrupt', {
    threadId: interactiveCancelThreadId,
    turnId: interactiveCancelTurnId,
  });
  const interactiveCancelled = await peer.notification(
    'turn/completed',
    params =>
      params?.threadId === interactiveCancelThreadId &&
      params?.turn?.id === interactiveCancelTurnId,
  );
  if (interactiveCancelled.turn.status !== 'interrupted') {
    throw new Error(
      `interactive approval cancellation did not interrupt: ${JSON.stringify(interactiveCancelled.turn)}`,
    );
  }
  const interactiveCancelProcess = await waitForFixtureEvent(
    fixtureLogPath,
    (event, index) => index >= interactiveCancelEventCount && event.command === 'acp',
    'interactive ACP fixture process',
  );
  // Native interruption is reported before the detached provider worker exits.
  // ACP cancel has no acknowledgement; require actual teardown, not receipt of
  // a best-effort notification racing process shutdown.
  await waitForFixtureProcessExit(interactiveCancelProcess.pid);
  const interactiveCancelEvents = (await readFixtureEvents(fixtureLogPath)).slice(
    interactiveCancelEventCount,
  );
  if (
    interactiveCancelEvents.some(
      event =>
        event.command === 'permission-result' &&
        event.case === 'interactive-cancel' &&
        event.outcome === 'selected',
    )
  ) {
    throw new Error('cancelled interactive approval became a grant');
  }
  const interactiveCancelWarnings = peer.takeNotifications(
    'warning',
    params =>
      params?.threadId === interactiveCancelThreadId &&
      params?.message?.includes('Devin tool permission denied'),
  );
  if (
    interactiveCancelWarnings.length !== 1 ||
    /Set-Content|value\.txt/.test(interactiveCancelWarnings[0].message)
  ) {
    throw new Error('cancelled interactive approval did not emit one safely redacted warning');
  }

  const eofThreadId = await startDevinThreadWithApproval(peer, fixtureDirectory);
  const eofTurn = await peer.request('turn/start', {
    threadId: eofThreadId,
    input: [{ type: 'text', text: PERMISSION_EOF_MARKER, textElements: [] }],
  });
  await peer.serverRequest(params => params?.threadId === eofThreadId);
  await writeFile(join(workRoot, 'exit-acp'), 'exit');
  const eofDone = await peer.notification('turn/completed',
    params => params?.threadId === eofThreadId && params?.turn?.id === eofTurn.turn.id);
  if (eofDone.turn.status !== 'failed' || !eofDone.turn.error) {
    throw new Error(`ACP exit during approval did not fail the turn: ${JSON.stringify(eofDone.turn)}`);
  }

  const observationThread = await peer.request('thread/start', {
    model: 'devin/swe-2-medium',
    cwd: fixtureDirectory,
    approvalPolicy: 'never',
    sandbox: 'danger-full-access',
    ephemeral: false,
  });
  if (
    observationThread.model !== 'devin/swe-2-medium' ||
    observationThread.modelProvider !== 'devin'
  ) {
    throw new Error(`observation thread did not select Devin: ${JSON.stringify(observationThread)}`);
  }
  const observationThreadId = observationThread.thread?.id;
  if (typeof observationThreadId !== 'string') {
    throw new Error('tool observation fixture thread omitted its id');
  }
  const observationTurn = await peer.request('turn/start', {
    threadId: observationThreadId,
    input: [{ type: 'text', text: TOOL_OBSERVATION_USER_MARKER, textElements: [] }],
  });
  const observationTurnId = observationTurn.turn?.id;
  if (typeof observationTurnId !== 'string') {
    throw new Error('tool observation fixture turn omitted its id');
  }
  const observationStarted = await peer.notification(
    'item/started',
    params =>
      params?.threadId === observationThreadId &&
      params?.turnId === observationTurnId &&
      params?.item?.type === 'dynamicToolCall',
  );
  const observationCompleted = await peer.notification(
    'item/completed',
    params =>
      params?.threadId === observationThreadId &&
      params?.turnId === observationTurnId &&
      params?.item?.type === 'dynamicToolCall',
  );
  const observationDone = await peer.notification(
    'turn/completed',
    params => params?.threadId === observationThreadId && params?.turn?.id === observationTurnId,
  );
  if (observationDone.turn.status !== 'completed' || observationDone.turn.error !== null) {
    throw new Error(`tool observation turn failed: ${JSON.stringify(observationDone.turn)}`);
  }
  const expectedObservationId = `devin:${observationTurnId}:exec:fixture`;
  if (
    observationStarted.item.id !== expectedObservationId ||
    observationStarted.item.namespace !== 'devin' ||
    observationStarted.item.tool !== 'Ran ls' ||
    JSON.stringify(observationStarted.item.arguments) !== JSON.stringify({ kind: 'execute' }) ||
    observationStarted.item.status !== 'inProgress' ||
    observationStarted.item.contentItems !== null ||
    observationStarted.item.success !== null
  ) {
    throw new Error(
      `unexpected started Devin tool observation: ${JSON.stringify(observationStarted.item)}`,
    );
  }
  if (
    observationCompleted.item.id !== expectedObservationId ||
    observationCompleted.item.namespace !== 'devin' ||
    observationCompleted.item.tool !== 'Ran ls' ||
    JSON.stringify(observationCompleted.item.arguments) !== JSON.stringify({ kind: 'execute' }) ||
    observationCompleted.item.status !== 'failed' ||
    observationCompleted.item.success !== false ||
    JSON.stringify(observationCompleted.item.contentItems) !==
      JSON.stringify([{ type: 'inputText', text: TOOL_FAILURE_TEXT }]) ||
    JSON.stringify(observationCompleted.item).includes('private fixture command')
  ) {
    throw new Error(
      `unexpected completed Devin tool observation: ${JSON.stringify(observationCompleted.item)}`,
    );
  }
  const observationMessages = peer.takeNotifications(
    'item/completed',
    params =>
      params?.threadId === observationThreadId &&
      params?.turnId === observationTurnId &&
      params?.item?.type === 'agentMessage',
  );
  if (
    observationMessages.length !== 1 ||
    observationMessages[0].item.text !== TOOL_TEXT_PREFIX + RESPONSE_TEXT ||
    observationMessages.some(params => params.item.text.includes(TOOL_FAILURE_TEXT))
  ) {
    throw new Error(
      `tool observation produced synthetic assistant history: ${JSON.stringify(observationMessages)}`,
    );
  }
  const observationHistory = await peer.request('thread/read', {
    threadId: observationThreadId,
    includeTurns: true,
  });
  const persistedObservation = observationHistory.thread?.turns
    ?.find(turn => turn.id === observationTurnId)
    ?.items?.find(item => item.id === expectedObservationId);
  if (
    persistedObservation?.type !== 'dynamicToolCall' ||
    persistedObservation.namespace !== 'devin' ||
    persistedObservation.tool !== 'Ran ls' ||
    JSON.stringify(persistedObservation.arguments) !== JSON.stringify({ kind: 'execute' }) ||
    persistedObservation.status !== 'failed' ||
    persistedObservation.success !== false ||
    JSON.stringify(persistedObservation.contentItems) !==
      JSON.stringify([{ type: 'inputText', text: TOOL_FAILURE_TEXT }]) ||
    JSON.stringify(persistedObservation).includes('private fixture command')
  ) {
    throw new Error(
      `thread/read omitted the persisted Devin tool observation: ${JSON.stringify(observationHistory)}`,
    );
  }
  const observationEventCount = (await readFixtureEvents(fixtureLogPath)).length;
  await startTurn(peer, observationThreadId, TOOL_OBSERVATION_FOLLOWUP_MARKER);
  const observationFollowupEvents = (await readFixtureEvents(fixtureLogPath)).slice(
    observationEventCount,
  );
  const observationPrompts = observationFollowupEvents.filter(
    event =>
      event.command === 'acp-rpc' &&
      event.method === 'session/prompt' &&
      JSON.stringify(event.params).includes(TOOL_OBSERVATION_FOLLOWUP_MARKER),
  );
  const observationFollowup = JSON.stringify(observationPrompts.at(-1)?.params?.prompt);
  if (
    observationPrompts.length !== 1 ||
    !observationFollowupEvents.some(
      event => event.command === 'acp-rpc' && event.method === 'session/load',
    ) ||
    observationFollowup.includes(TOOL_FAILURE_TEXT) ||
    observationFollowup.includes('private fixture command')
  ) {
    throw new Error('tool observation follow-up injected unsafe synthetic assistant history');
  }

  const rootStarted = await peer.request('thread/start', {
    model: 'gpt-6-astra',
    cwd: fixtureDirectory,
    approvalPolicy: 'never',
    sandbox: 'danger-full-access',
    developerInstructions: ROOT_INSTRUCTION_MARKER,
    ephemeral: false,
  });
  if (rootStarted.model !== 'gpt-6-astra' || rootStarted.modelProvider !== 'openai') {
    throw new Error(`mixed-provider root did not select Astra: ${JSON.stringify(rootStarted)}`);
  }
  const rootThreadId = rootStarted.thread?.id;
  if (typeof rootThreadId !== 'string') throw new Error('Astra root omitted its thread id');
  const rootTurn = await peer.request('turn/start', {
    threadId: rootThreadId,
    input: [{ type: 'text', text: ROOT_USER_MARKER, textElements: [] }],
  });
  const rootTurnId = rootTurn.turn?.id;
  if (typeof rootTurnId !== 'string') throw new Error('Astra root omitted its turn id');
  const spawnItem = await peer.notification(
    'item/completed',
    params =>
      params?.threadId === rootThreadId &&
      params?.turnId === rootTurnId &&
      params?.item?.type === 'subAgentActivity' &&
      params.item.id === SPAWN_CALL_ID &&
      params.item.kind === 'started',
  );
  const childThreadId = spawnItem.item.agentThreadId;
  if (typeof childThreadId !== 'string') {
    throw new Error(`Astra spawn tool omitted its child agent id: ${JSON.stringify(spawnItem)}`);
  }
  const [rootCompleted, childTurnCompleted] = await Promise.all([
    peer.notification(
      'turn/completed',
      params => params?.threadId === rootThreadId && params?.turn?.id === rootTurnId,
    ),
    peer.notification(
      'turn/completed',
      params => params?.threadId === childThreadId,
    ),
  ]);
  if (rootCompleted.turn.status !== 'completed' || rootCompleted.turn.error !== null) {
    throw new Error(`Astra root turn failed: ${JSON.stringify(rootCompleted.turn)}`);
  }
  if (childTurnCompleted.turn.status !== 'completed' || childTurnCompleted.turn.error !== null) {
    throw new Error(`SWE-2 child turn failed: ${JSON.stringify(childTurnCompleted.turn)}`);
  }
  const childCompleted = await peer.notification(
    'item/completed',
    params =>
      params?.threadId === rootThreadId &&
      params?.turnId === rootTurnId &&
      params?.item?.type === 'subAgentActivity' &&
      params.item.kind === 'completed' &&
      params.item.agentThreadId === childThreadId,
  );
  if (childCompleted.item.agentThreadId !== childThreadId) {
    throw new Error(`SWE-2 child completion event was invalid: ${JSON.stringify(childCompleted)}`);
  }
  const rootToolResult = responses.bodies.find(body => {
    if (!body.includes(SPAWN_CALL_ID)) return false;
    const request = JSON.parse(body);
    return request.input?.some(item => {
      if (item.type !== 'function_call_output' || item.call_id !== SPAWN_CALL_ID) return false;
      return JSON.parse(item.output).task_name === '/root/swe_child';
    });
  });
  if (!rootToolResult) {
    throw new Error('Astra follow-up did not receive the canonical spawned task name');
  }
  const mixedRootBodies = [
    ...responses.bodies.filter(
      body => body.includes(ROOT_USER_MARKER) && !body.includes(SPAWN_CALL_ID),
    ),
    rootToolResult,
  ];
  if (
    mixedRootBodies.length !== 2 ||
    !mixedRootBodies[0].includes('gpt-6-astra') ||
    !mixedRootBodies[0].includes(ROOT_USER_MARKER) ||
    !mixedRootBodies[1].includes(ROOT_REASONING_MARKER) ||
    !mixedRootBodies[1].includes(Buffer.from(ROOT_OPAQUE_MARKER).toString('base64'))
  ) {
    throw new Error('mock OpenAI route did not preserve the exact Astra root request pair');
  }
  assertPlainCollaborationMessageSchemas(mixedRootBodies[0]);
  const mixedEvents = (await readFile(fixtureLogPath, 'utf8'))
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line));
  const childPrompt = mixedEvents
    .filter(event => event.command === 'acp-rpc' && event.method === 'session/prompt')
    .map(event => JSON.stringify(event.params.prompt))
    .find(prompt => prompt.includes(CHILD_TASK_MARKER));
  if (!mixedEvents.some(event => event.command === 'acp' && event.model === 'swe-2-medium')) {
    throw new Error('spawned child did not launch the exact SWE-2 Medium ACP model');
  }
  if (
    !childPrompt ||
    !childPrompt.includes(ROOT_USER_MARKER) ||
    !childPrompt.includes(ROOT_INSTRUCTION_MARKER) ||
    !childPrompt.includes(AGENTS_MARKER)
  ) {
    throw new Error('SWE-2 child prompt omitted delegated task, root, user, or AGENTS text');
  }
  if (
    childPrompt.includes(ROOT_OPAQUE_MARKER) ||
    childPrompt.includes(Buffer.from(ROOT_OPAQUE_MARKER).toString('base64'))
  ) {
    throw new Error('SWE-2 child prompt exposed opaque encrypted reasoning bytes');
  }

  const modelsBeforeLogout = events.filter(event => event.command === 'models').length;
  await writeFile(fixtureStatePath, JSON.stringify({ loggedIn: false }));
  const refreshed = await peer.request('azrael/devin', { action: 'refresh' });
  if (refreshed.loggedIn) throw new Error('Devin refresh did not observe logged-out state');
  const loggedOutModels = await peer.request('model/list', {});
  const loggedOutNativeCount = assertCatalog(loggedOutModels, false);
  if (loggedOutNativeCount !== nativeCount) {
    throw new Error('native catalog changed when Devin logged out');
  }

  const finalEvents = (await readFile(fixtureLogPath, 'utf8'))
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line));
  const modelsAfterLogout = finalEvents.filter(event => event.command === 'models').length;
  if (modelsAfterLogout !== modelsBeforeLogout) {
    throw new Error('logged-out refresh invoked models list instead of failing closed at auth status');
  }
  await writeFile(fixtureStatePath, JSON.stringify({ loggedIn: true }));
  const reset = await peer.request('azrael/devin', { action: 'refresh' });
  if (!reset.loggedIn) throw new Error('fixture reset did not restore Devin login state');

  const loggedOut = await peer.request('azrael/devin', { action: 'logout' });
  if (loggedOut.loggedIn) throw new Error('Devin logout RPC did not report logged-out state');
  const modelsAfterManagedLogout = await peer.request('model/list', {
    cursor: null,
    limit: 100,
    includeHidden: false,
  });
  if (assertCatalog(modelsAfterManagedLogout, false) !== nativeCount) {
    throw new Error('managed Devin logout changed the native catalog');
  }

  const loggedIn = await peer.request('azrael/devin', { action: 'login' });
  if (!loggedIn.loggedIn || loggedIn.email !== 'fixture@devin.invalid') {
    throw new Error(`Devin login RPC did not restore fixture account: ${JSON.stringify(loggedIn)}`);
  }
  const modelsAfterManagedLogin = await peer.request('model/list', {
    cursor: null,
    limit: 100,
    includeHidden: false,
  });
  const restoredNativeCount = assertCatalog(modelsAfterManagedLogin, true);
  if (
    restoredNativeCount !== nativeCount ||
    modelsAfterManagedLogin.data.length !== nativeCount + DEVIN_VARIANT_COUNT
  ) {
    throw new Error('managed Devin login did not restore the full merged catalog');
  }
  const accountEvents = await readFixtureEvents(fixtureLogPath);
  if (
    accountEvents.filter(event => event.command === 'auth' && event.action === 'logout').length !== 1 ||
    !accountEvents.some(
      event => event.command === 'authenticate' && event.methodId === 'devin-browser',
    )
  ) {
    throw new Error('Devin account RPCs did not use the isolated logout and browser-login fixtures');
  }
  const afterIdentity = await peer.request('account/read', { refreshToken: false });
  if (
    JSON.stringify(afterIdentity) !== JSON.stringify(beforeIdentity) ||
    (await readFile(openAiAuthPath, 'utf8')) !== syntheticOpenAiAuth
  ) {
    throw new Error('Devin flow touched the isolated OpenAI identity');
  }

  child.stdin.end();
  const exit = await waitForExit(child);
  if (exit.code !== 0) throw new Error(`engine exited abnormally: ${JSON.stringify(exit)}`);
  peer.close();
  succeeded = true;
  console.log(
    JSON.stringify({
      status: 'passed',
      engine: enginePath,
      checks: [
        'cold Devin thread/start refreshes before any UI model/list request',
        'native and exact Devin model catalog merge',
        'simulated pinned codex_vscode model/list limit-100 compatibility',
        'explicit model/list limits retain native pagination',
        'unknown Devin model rejection',
        'Devin ACP route with AGENTS and user context',
        'ACP text response and session/load resume',
        'activated local skill body and reference path transfer',
        'same-thread Devin to Astra to Devin provider routing',
        'switch-back ACP reconciliation includes intervening Astra context',
        'active-turn Devin logout rejection without invoking auth logout',
        'turn/interrupt forwards ACP session/cancel and completes interrupted',
        'full-access never selects unique correlated allow_once across tool kinds, shells, overrides, and opaque commands',
        'malformed or ambiguous options and stale, conflicting, cross-session permissions fail closed',
        'UnlessTrusted approval accept, decline, and turn cancellation remain distinct',
        'Devin tool observations emit safe dynamicToolCall lifecycle and persist in thread/read',
        'titleless rejected tool output is not synthesized into assistant history',
        'Astra root spawn_agent to exact SWE-2 child',
        'child native UUID lifecycle and root canonical task identity',
        'forked root/user/AGENTS/task text with native reasoning exclusion and no encrypted bytes',
        'logged-out fail-closed refresh preserving native models',
        'mocked Devin logout/login removes and restores exact models',
        'synthetic isolated OpenAI API-key identity and auth file remain unchanged',
      ],
      realLogin: false,
      network: false,
      simulatedPinnedUiIdentity: true,
    }),
  );
} catch (error) {
  const rpcSummary = peer?.notifications.slice(-80).map(message => ({
    method: message.method,
    threadId: message.params?.threadId,
    turnId: message.params?.turnId ?? message.params?.turn?.id,
    item: message.params?.item && {
      type: message.params.item.type,
      id: message.params.item.id,
      tool: message.params.item.tool,
      status: message.params.item.status,
      kind: message.params.item.kind,
      receiverThreadIds: message.params.item.receiverThreadIds,
      agentThreadId: message.params.item.agentThreadId,
    },
  }));
  const responsesSummary = responses?.bodies.map(body => ({
    root: body.includes(ROOT_USER_MARKER),
    spawnResult: body.includes(SPAWN_CALL_ID),
    child: body.includes(CHILD_TASK_MARKER),
  }));
  await appendFile(
    failurePath,
    `${error.stack ?? error}\n${stderr}\nRPC summary: ${JSON.stringify(rpcSummary)}\nResponses summary: ${JSON.stringify(responsesSummary)}\nResponses bodies: ${JSON.stringify(responses?.bodies)}\n`,
  );
  console.error(`${error.stack ?? error}\nDiagnostics: ${failurePath}`);
  process.exitCode = 1;
} finally {
  if (child && child.exitCode === null && child.signalCode === null) {
    child.stdin.end();
    try {
      await waitForExit(child);
    } catch {
      child.kill();
    }
  }
  peer?.close();
  await closeServer(responses?.server);
  if (succeeded) await removeVerifiedWorkRoot(workRoot);
}
}
