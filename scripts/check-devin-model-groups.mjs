import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';

const [engineArgument, stateArgument, devinArgument] = process.argv.slice(2);
if (!engineArgument || !stateArgument || !devinArgument || !isAbsolute(stateArgument)) {
  throw new Error('Usage: node scripts/check-devin-model-groups.mjs <engine> <prepared absolute state root> <devin executable>');
}
const engine = resolve(engineArgument);
const stateRoot = resolve(stateArgument);
const devinExecutable = resolve(devinArgument);
const childEnvironment = { ...process.env, CODEX_HOME: stateRoot, AZRAEL_EX_DEVIN_EXECUTABLE: devinExecutable };
for (const key of ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'AZRAEL_EX_MANAGEMENT_SOCKET', 'AZRAEL_EX_INSTANCE_ID']) delete childEnvironment[key];
const child = spawn(engine, ['-c', 'features.code_mode_host=true', '-c', 'features.plugins=false', 'app-server', '--analytics-default-enabled'], {
  cwd: stateRoot,
  env: childEnvironment,
  windowsHide: true,
  stdio: ['pipe', 'pipe', 'pipe'],
});
let nextId = 0;
let stderr = '';
const pending = new Map();
child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-16_000); });
const lines = createInterface({ input: child.stdout });
lines.on('line', line => {
  try {
    const message = JSON.parse(line);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(JSON.stringify(message.error)));
    else request.resolve(message.result);
  } catch (error) { failPending(error); }
});
function failPending(error) {
  for (const request of pending.values()) { clearTimeout(request.timer); request.reject(error); }
  pending.clear();
}
child.on('error', failPending);
child.on('exit', code => failPending(new Error(`Engine exited ${code}: ${stderr}`)));
function request(method, params) {
  const id = ++nextId;
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out: ${stderr}`)); }, 45_000);
    pending.set(id, { resolve: resolvePromise, reject, timer });
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
  });
}

try {
  await request('initialize', { clientInfo: { name: 'codex_vscode', version: '0.1.0' }, capabilities: { experimentalApi: true } });
  child.stdin.write(`${JSON.stringify({ method: 'initialized' })}\n`);
  const models = await request('model/list', { cursor: null, limit: 100, includeHidden: false });
  if (!models || !Array.isArray(models.data)) throw new Error('model/list returned no data array');
  const visibleDevin = models.data.filter(model => typeof model.model === 'string' && model.model.startsWith('devin/'));
  if (visibleDevin.length === 0) throw new Error('model/list exposed no visible Devin models');
  const swe2 = visibleDevin.find(model => model.model.startsWith('devin/@group/swe-2/'));
  if (!swe2) throw new Error('visible grouped SWE-2 model is missing');
  const opus = visibleDevin.find(model => model.model.startsWith('devin/@group/claude-opus-5/default/'));
  const opusFast = visibleDevin.find(model => model.model.startsWith('devin/@group/claude-opus-5/Fast/'));
  if (!opus || !opusFast) throw new Error('Claude Opus 5 ordinary/Fast groups are missing');
  function effortNames(model) {
    return (model.supportedReasoningEfforts || []).map(option => option.reasoningEffort ?? option.effort);
  }
  const sweEfforts = effortNames(swe2);
  const opusEfforts = effortNames(opus);
  const opusFastEfforts = effortNames(opusFast);
  for (const expected of ['medium', 'high', 'max']) {
    if (!sweEfforts.includes(expected)) throw new Error(`grouped SWE-2 omitted ${expected} effort: ${JSON.stringify(sweEfforts)}`);
  }
  for (const expected of ['low', 'medium', 'high', 'xhigh', 'max']) {
    if (!opusEfforts.includes(expected) || !opusFastEfforts.includes(expected)) throw new Error(`Claude Opus 5 ordinary/Fast groups omitted ${expected}`);
  }
  const hiddenKnownAliases = [
    'devin/swe-2-medium', 'devin/swe-2-high', 'devin/swe-2-max',
    ...['low', 'medium', 'high', 'xhigh', 'max'].flatMap(effort => [`devin/claude-opus-5-${effort}`, `devin/claude-opus-5-${effort}-fast`]),
  ];
  for (const alias of hiddenKnownAliases) {
    if (models.data.some(model => model.model === alias)) throw new Error(`hidden exact alias appeared in visible model/list: ${alias}`);
  }
  const result = {
    passed: true,
    engine,
    stateRoot,
    nativeModelCount: models.data.length - visibleDevin.length,
    visibleDevinModelCount: visibleDevin.length,
    visibleDevinGroupCount: visibleDevin.filter(model => model.model.startsWith('devin/@group/')).length,
    visibleUngroupedCount: visibleDevin.filter(model => !model.model.startsWith('devin/@group/')).length,
    swe2: { model: swe2.model, displayName: swe2.displayName, defaultReasoningEffort: swe2.defaultReasoningEffort, supportedReasoningEfforts: sweEfforts },
    opus: { model: opus.model, displayName: opus.displayName, supportedReasoningEfforts: opusEfforts },
    opusFast: { model: opusFast.model, displayName: opusFast.displayName, supportedReasoningEfforts: opusFastEfforts },
    knownExactAliasesVisible: false,
    loginPerformed: false,
    modelRequestPerformed: false,
  };
  await writeFile(join(stateRoot, 'devin-model-groups.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(result));
} catch (error) {
  await writeFile(join(stateRoot, 'failure.log'), `${error instanceof Error ? error.stack : String(error)}\n${stderr}`, 'utf8');
  throw error;
} finally {
  lines.close();
  child.stdin.end();
  const killTimer = setTimeout(() => child.kill(), 3000);
  killTimer.unref();
}
