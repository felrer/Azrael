import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, isAbsolute, join } from 'node:path';
import { createInterface } from 'node:readline';

// Use a NEW disposable directory. This check writes config but never logs in or
// submits model requests. It exercises the same stdio transport as the IDE.
const [engine, directory] = process.argv.slice(2);
if (!engine || !directory || !isAbsolute(directory)) {
  throw new Error('Usage: node scripts/check-engine.mjs <engine> <new absolute check directory>');
}
await mkdir(directory); // Refuse to overwrite an existing state directory.
const child = spawn(resolve(engine), ['-c', 'features.code_mode_host=true', 'app-server', '--analytics-default-enabled'], {
  cwd: directory,
  env: { ...process.env, CODEX_HOME: directory },
  windowsHide: true,
  stdio: ['pipe', 'pipe', 'pipe'],
});
let id = 0;
const pending = new Map();
let stderr = '';
child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-16000); });
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
  } catch (error) {
    failPending(error);
  }
});
function failPending(error) {
  for (const request of pending.values()) {
    clearTimeout(request.timer);
    request.reject(error);
  }
  pending.clear();
}
child.on('error', failPending);
child.on('exit', code => failPending(new Error(`Engine exited ${code}`)));
function request(method, params) {
  return new Promise((resolve, reject) => {
    const requestId = ++id;
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error(`${method} timed out`));
    }, 30000);
    pending.set(requestId, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ id: requestId, method, params }) + '\n');
  });
}
try {
  await request('initialize', { clientInfo: { name: 'azrael-ex-check', version: '0.1.0' }, capabilities: { experimentalApi: true } });
  child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
  const account = await request('account/read', { refreshToken: false });
  if (account.account !== null) throw new Error('Fresh state unexpectedly contains an account');
  await request('config/value/write', { keyPath: 'model', value: 'azrael-storage-probe', mergeStrategy: 'replace' });
  const config = await request('config/read', { includeLayers: true });
  const diskConfig = await readFile(join(directory, 'config.toml'), 'utf8');
  if (config.config.model !== 'azrael-storage-probe' || !diskConfig.includes('azrael-storage-probe')) {
    throw new Error('Engine config read/write does not agree with dedicated state root');
  }
  const threads = await request('thread/list', { limit: 10 });
  if (threads.data.length !== 0) throw new Error('Fresh state unexpectedly contains threads');
  const result = { status: 'passed', engine: resolve(engine), stateRoot: directory, checks: ['stdio initialize', 'isolated logged-out identity', 'native config write/read/path', 'isolated empty thread list'], realLogin: false, modelRequest: false };
  await writeFile(join(directory, 'verification.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} catch (error) {
  await writeFile(join(directory, 'failure.log'), `${error.stack}\n${stderr}`);
  throw error;
} finally {
  lines.close();
  child.stdin.end();
  const killTimer = setTimeout(() => child.kill(), 3000);
  killTimer.unref();
}
