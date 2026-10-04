import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';

const [runtimeArg, stateArg] = process.argv.slice(2);
if (!runtimeArg || !stateArg) throw new Error('pass native runtime manifest and Azrael state home');
const state = realpathSync(stateArg);
if (state.toLowerCase() !== resolve(homedir(), '.azrael-ex').toLowerCase()) throw new Error('state home is not Azrael');
const runtime = JSON.parse(readFileSync(realpathSync(runtimeArg), 'utf8'));
if (runtime.schema !== 2 || !runtime.helpers) throw new Error('invalid native runtime manifest');
const bun = realpathSync(runtime.helpers.providerBun);
const helper = realpathSync(runtime.helpers.providerAccountsHelper);
if (![bun, helper].every(path => existsSync(path) && statSync(path).isFile())) throw new Error('missing provider account helper');

const env = { ...process.env };
for (const key of Object.keys(env)) {
  if (/^(AZRAEL_|OPENCODEX_HOME$)/i.test(key) || /^(OPENAI|CODEX|ANTHROPIC|AZURE_OPENAI)_(?!HOME$)/i.test(key) ||
      /(API[_-]?KEY|AUTH[_-]?TOKEN|ACCESS[_-]?TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(key)) delete env[key];
}
env.CODEX_HOME = state;
env.OPENCODEX_HOME = join(state, 'azrael', 'providers', 'opencodex');
const id = randomBytes(8).toString('hex');
const child = spawn(bun, [helper], { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
let settled = false;
let opened = false;
let stderrBytes = 0;
const finish = (ok, reason) => {
  if (settled) return;
  settled = true;
  clearTimeout(timer);
  process.stdout.write(JSON.stringify({ status: ok ? 'passed' : 'failed', reason, opened, stderrBytes }) + '\n');
  child.stdin.end();
  if (!ok) child.kill();
  process.exitCode = ok ? 0 : 1;
};
const timer = setTimeout(() => finish(false, 'login_timeout'), 10 * 60 * 1000);
child.stderr.on('data', chunk => { stderrBytes += chunk.length; });
child.on('error', () => finish(false, 'helper_launch_failed'));
child.on('exit', code => { if (!settled) finish(false, `helper_exit_${code ?? 'signal'}`); });
lines.on('line', line => {
  let frame;
  try { frame = JSON.parse(line); } catch { finish(false, 'invalid_helper_frame'); return; }
  if (frame.id !== id) return;
  if (frame.type === 'openUrl' && typeof frame.url === 'string') {
    opened = true;
    process.stdout.write(JSON.stringify({ type: 'openUrl', url: frame.url }) + '\n');
    child.stdin.write(JSON.stringify({ id, type: 'answer', value: 'opened' }) + '\n');
  } else if (frame.type === 'prompt') {
    if (frame.password === false) {
      // OAuth instructions need acknowledgement before the helper can report
      // success, even when the localhost callback has already completed.
      child.stdin.write(JSON.stringify({ id, type: 'answer', value: 'opened' }) + '\n');
      process.stdout.write(JSON.stringify({ type: 'instructionsAcknowledged' }) + '\n');
    } else {
      // The browser callback races the optional manual-code prompt. Keep the
      // helper alive so the user can complete the normal localhost redirect.
      process.stdout.write(JSON.stringify({ type: 'manualCodeReady' }) + '\n');
    }
  } else if (frame.type === 'result') {
    finish(true, 'claude_oauth_complete');
  } else if (frame.type === 'error') {
    finish(false, typeof frame.error === 'string' ? frame.error : 'claude_oauth_failed');
  }
});
child.stdin.write(JSON.stringify({ protocol: 1, id, action: 'login', providerId: 'anthropic' }) + '\n');
