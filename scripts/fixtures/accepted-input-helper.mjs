// Synthetic native provider: no credentials are read and no network is used.
import { appendFileSync } from 'node:fs';
import { compileRequest } from '../../providers/devin/mapping.mjs';

if (!process.env.AZRAEL_ACCEPTED_INPUT_TRACE) throw new Error('missing isolated trace path');
let raw = '';
for await (const chunk of process.stdin) raw += chunk;
const frames = raw.trim().split('\n').map(JSON.parse);
const request = frames[1];
if (request.type === 'capabilities') {
  process.stdout.write(JSON.stringify({ protocol_version: 1, request_id: request.request_id,
    seq: 0, type: 'capabilities', image_model_ids: [] }) + '\n');
} else {
compileRequest(request);
appendFileSync(process.env.AZRAEL_ACCEPTED_INPUT_TRACE, JSON.stringify({
  pid: process.pid, at: new Date().toISOString(), request_id: request.request_id,
}) + '\n');
let seq = 0;
const emit = frame => process.stdout.write(JSON.stringify({
  protocol_version: 1, request_id: request.request_id, seq: seq++, ...frame,
}) + '\n');
const done = item => emit({ type: 'item_done', item });
emit({ type: 'created' });
const output = request.input.find(item => item.type === 'function_call_output' && item.call_id === 'accepted-input-hold');
if (output) {
  if (!JSON.stringify(output).includes('accepted-input-released')) throw new Error('wrong dynamic tool result');
  done({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'ACCEPTED_INPUT_CONSUMED' }] });
} else {
  const tools = request.tools.flatMap(tool => tool.type === 'namespace'
    ? tool.tools.map(child => ({ ...child, namespace: tool.name })) : [tool]);
  const hold = tools.find(tool => tool.namespace === 'accepted_input_probe' && tool.name === 'hold');
  if (!hold) throw new Error('missing isolated dynamic hold tool');
  done({ type: 'function_call', name: hold.name, namespace: hold.namespace,
    call_id: 'accepted-input-hold', arguments: '{}' });
}
emit({ type: 'completed' });
}
