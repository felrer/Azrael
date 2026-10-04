// Synthetic protocol boundary only. The real engine owns the turn and tools.
import assert from 'node:assert/strict';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';

const home = process.env.AZRAEL_AUTO_SWITCH_FIXTURE;
assert(home, 'isolated fixture home required');
const trace = event => appendFileSync(join(home, 'helper.jsonl'), JSON.stringify({ at: Date.now(), pid: process.pid, ...event }) + '\n');
if (process.argv.includes('--catalog')) {
  process.stdout.write(JSON.stringify({ models: [{ provider_id: 'anthropic', model_id: 'fixture-auto-switch', display_name: 'Synthetic recovery acceptance', context_window: 200000, input_modalities: ['text'] }], provider_statuses: [{ provider_id: 'anthropic', state: 'ready', model_count: 1, observed_at: 1 }] }) + '\n');
} else {
  const lines = createInterface({ input: process.stdin });
  const iterator = lines[Symbol.asyncIterator]();
  const first = JSON.parse((await iterator.next()).value);
  const control = JSON.parse(readFileSync(join(home, 'control.json'), 'utf8'));
  if (first.action) {
    assert.equal(first.protocol, 1);
    assert.equal(first.action, 'recoverAccount');
    assert.equal(first.providerId, 'anthropic');
    assert(Array.isArray(first.excludedAccountIds));
    trace({ kind: 'recovery', scenario: control.scenario, request: first, account: control.account });
    if (control.scenario === 'cancel') {
      // Cancellation must kill this peer; never send a candidate after interrupt.
      // RPC input is intentionally closed after the one request. Keep an active
      // timer rather than using stdin EOF as cancellation evidence.
      await new Promise(resolve => setTimeout(resolve, 120000));
    } else {
      const candidate = ['account-a', 'account-b', 'account-c'].find(id => id !== control.account && !first.excludedAccountIds.includes(id));
      const value = control.scenario === 'no-candidate' || !candidate ? null : { exhaustedAccountId: control.account, accountId: candidate };
      if (value) writeFileSync(join(home, 'control.json'), JSON.stringify({ ...control, account: candidate }));
      process.stdout.write(JSON.stringify({ id: first.id, type: 'result', value }) + '\n');
    }
  } else {
    const request = JSON.parse((await iterator.next()).value);
    assert.equal(first.type, 'init');
    assert.equal(first.protocol_version, 1);
    assert.equal(first.request_id, request.request_id);
    trace({ kind: 'inference', scenario: control.scenario, account: control.account, request });
    let seq = 0;
    const emit = frame => process.stdout.write(JSON.stringify({ protocol_version: 1, request_id: request.request_id, seq: seq++, ...frame }) + '\n');
    const done = item => emit({ type: 'item_done', item });
    emit({ type: 'created' });
    const output = request.input.find(item => item.type === 'function_call_output' && item.call_id === 'effect-once');
    if (!output) {
      assert.equal(control.account, 'account-a', 'new account must receive the completed effect');
      const metadata = { provider: request.provider_id, model: request.model, thread: request.thread_id, turn: request.turn_id, account: request.credential_scope, signature: 'PRIVATE_SIGNATURE_SENTINEL', calls: [], reasoning_details: [{ text: 'PRIVATE_OPAQUE_SENTINEL' }] };
      done({ type: 'reasoning', summary: [{ type: 'summary_text', text: 'PRIVATE_REASONING_SENTINEL' }], encrypted_content: 'azrael-managed-v1:' + Buffer.from(JSON.stringify(metadata)).toString('base64') });
      done({ type: 'function_call', namespace: 'effect_probe', name: 'increment', call_id: 'effect-once', arguments: '{}' });
      emit({ type: 'completed' });
    } else if (control.account === 'account-a' || control.scenario === 'exhaust-all') {
      const code = { http: 'provider_http_400', rate: 'provider_rate_limit', quota: 'provider_quota_exceeded', 'not-included': 'provider_usage_not_included' }[control.scenario] ?? 'provider_usage_limit';
      emit({ type: 'error', code });
      process.exitCode = 1;
    } else {
      assert(JSON.stringify(output).includes('EFFECT_RESULT_EXACT_1'), 'exact completed tool output required');
      const replay = JSON.stringify(request.input);
      for (const secret of ['PRIVATE_REASONING_SENTINEL', 'PRIVATE_SIGNATURE_SENTINEL', 'PRIVATE_OPAQUE_SENTINEL', 'encrypted_content']) assert(!replay.includes(secret), `private replay leaked:${secret}`);
      done({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'RECOVERED:EFFECT_RESULT_EXACT_1' }] });
      emit({ type: 'completed' });
    }
  }
  lines.close();
}
