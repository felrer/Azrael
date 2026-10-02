// A protocol peer only: native Codex owns dispatch, results, and durable history.
import assert from 'node:assert/strict';
import { appendFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { compileRequest } from '../providers/devin/mapping.mjs';

let raw = '';
for await (const chunk of process.stdin) raw += chunk;
const frames = raw.trim().split('\n').map(JSON.parse);
assert.equal(frames.length, 2);
const request = frames[1];
const credentialFingerprint = createHash('sha256').update(JSON.stringify(frames[0].credential)).digest('hex');
const compiled = compileRequest(request);
const user = request.input.filter(item => item.type === 'message' && item.role === 'user').at(-1);
const task = (user?.content ?? []).map(part => part.text ?? '').join('\n');
const handoff = task.includes('Prepare a plain-text handoff for another provider.');
const marker = task.includes('DEVIN_BOUNDARY_END') ? 'DEVIN_BOUNDARY_END' : 'DEVIN_BOUNDARY_START';
assert(handoff || task.includes(marker), 'missing_devin_boundary_task');
const final = JSON.stringify(request.input).includes(`ROUNDTRIP:${marker}`);
if (process.env.AZRAEL_MANAGED_DEVIN_TRACE) await appendFile(process.env.AZRAEL_MANAGED_DEVIN_TRACE,
  JSON.stringify({ marker, final, handoff, model: request.model, threadId: request.thread_id, credentialFingerprint, input: request.input, messages: compiled.messages }) + '\n');
let seq = 0;
const emit = frame => process.stdout.write(JSON.stringify({ protocol_version: 1, request_id: request.request_id, seq: seq++, ...frame }) + '\n');
const done = item => emit({ type: 'item_done', item });
emit({ type: 'created' });
if (handoff) {
  assert.equal(request.tools.length, 0, 'handoff_must_not_declare_tools');
  const control = process.env.AZRAEL_MANAGED_DEVIN_CONTROL
    ? (await readFile(process.env.AZRAEL_MANAGED_DEVIN_CONTROL, 'utf8')).trim() : '';
  const failure = { quota: 'provider_usage_limit', http: 'provider_http_400', rate: 'provider_rate_limit' }[control];
  if (failure) {
    emit({ type: 'error', code: failure });
    process.exitCode = 1;
  } else {
    const summary = `Plaintext handoff: retain ${[...new Set(JSON.stringify(request.input).match(/ROUNDTRIP:[A-Z0-9_]+/g) ?? [])].join(' ')}.`;
    done({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: summary }] });
  }
} else if (final) {
  done({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: `VERIFIED:${marker}:ROUNDTRIP:${marker}` }] });
} else {
  const tools = request.tools.flatMap(tool => tool.type === 'namespace' ? tool.tools.map(child => ({ ...child, namespace: tool.name })) : [tool]);
  const tool = tools.find(tool => tool.namespace === 'namespace_b' && tool.name === 'echo');
  assert(tool, 'missing_devin_native_dynamic_echo');
  const metadata = { model: request.model, thread: request.thread_id, account: request.credential_scope, signature: 'synthetic-devin-boundary-signature' };
  done({ type: 'reasoning', summary: [{ type: 'summary_text', text: 'Synthetic public Devin reasoning' }], encrypted_content: 'azrael-devin-v1:' + Buffer.from(JSON.stringify(metadata)).toString('base64') });
  done({ type: 'function_call', name: tool.name, namespace: tool.namespace, call_id: `devin_${marker}`, arguments: JSON.stringify({ value: marker }) });
}
if (!process.exitCode) emit({ type: 'completed' });
