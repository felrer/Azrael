// Bounded real-model transport/tool round-trip. It executes no provider tool;
// a synthetic result checks call correlation before native engine acceptance.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const root = resolve(import.meta.dirname, '..');
const output = resolve(process.argv[2] ?? join(root, 'artifacts/verification/devin-native-20260915/helper-live.json'));
const credentialFile = process.platform === 'win32' ? join(process.env.APPDATA, 'devin/credentials.toml') :
  join(process.env.XDG_DATA_HOME || join(homedir(), '.local/share'), 'devin/credentials.toml');
const raw = await readFile(credentialFile, 'utf8');
if (Buffer.byteLength(raw) > 65536) throw new Error('credential_size');
const credential = {
  api_key: raw.match(/^\s*windsurf_api_key\s*=\s*"([^"]+)"/m)?.[1],
  api_server_url: raw.match(/^\s*api_server_url\s*=\s*"([^"]+)"/m)?.[1],
};
if (!credential.api_key || !credential.api_server_url) throw new Error('credential_incomplete');
const thread = randomUUID();
const tools = [{ type: 'namespace', name: 'compatibility', tools: [{ type: 'function', name: 'echo', description: 'Call once with text HELPER_CHECK to verify tool transport.', parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false } }] }];
const history = [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Call compatibility.echo with text HELPER_CHECK. Do not answer until the tool result is returned. Then repeat the exact returned result string in your final answer.' }] }];
const model = process.argv[3] ?? 'swe-2-high';
async function turn(input) {
  const requestId = randomUUID();
  const request = { type: 'request', protocol_version: 1, request_id: requestId, thread_id: thread, turn_id: randomUUID(), model, instructions: 'Use the declared tools. Tool aliases are the wire names; descriptions identify their original names.', input, tools, parallel_tool_calls: false };
  const child = spawn(process.execPath, [join(root, 'providers/devin/helper.mjs')], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const timer = setTimeout(() => child.kill(), 180_000);
  let data = '';
  child.stdout.on('data', chunk => { data += chunk; if (data.length > 16 * 1024 * 1024) child.kill(); });
  child.stderr.resume();
  child.stdin.end(JSON.stringify({ type: 'init', protocol_version: 1, request_id: requestId, credential }) + '\n' + JSON.stringify(request) + '\n');
  child.stdin.on('error', () => {});
  const exitCode = await new Promise((res, rej) => { child.once('error', rej); child.once('close', res); });
  clearTimeout(timer);
  const events = data.trim().split('\n').filter(Boolean).map(JSON.parse);
  const error = events.find(event => event.type === 'error');
  if (exitCode !== 0 || error || events.at(-1)?.type !== 'completed') throw new Error(error?.code ?? `helper_exit_${exitCode}`);
  return events;
}
const result = { model, started_at: new Date().toISOString(), status: 'failed', scope: 'real Devin helper tool generation/result replay; no native tool execution' };
try {
  const first = await turn(history);
  const items = first.filter(event => event.type === 'item_done').map(event => event.item);
  const call = items.find(item => item.type === 'function_call');
  if (!call || call.name !== 'echo' || call.namespace !== 'compatibility' || JSON.parse(call.arguments).text !== 'HELPER_CHECK') throw new Error('wrong_tool_call');
  const second = await turn([...history, ...items, { type: 'function_call_output', call_id: call.call_id, output: 'NATIVE_RESULT_7391' }]);
  const text = second.filter(event => event.type === 'item_done' && event.item.type === 'message').flatMap(event => event.item.content).map(part => part.text).join('');
  if (!text.includes('NATIVE_RESULT_7391')) throw new Error('tool_result_not_used');
  Object.assign(result, { status: 'passed', calls: 2, tool_roundtrip: true, result_used: true });
} catch (error) { result.error_code = error.message; process.exitCode = 1; }
await mkdir(resolve(output, '..'), { recursive: true });
await writeFile(output, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
