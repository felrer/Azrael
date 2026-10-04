import assert from 'node:assert/strict';
import { createServer } from 'node:http';

export const thoughtSignature = 'c3ludGhldGljLWdvb2dsZS10aG91Z2h0';
export const echoIdentity = 'MANAGED_NATIVE_FIXTURE_NAMESPACE_B_ECHO';

// Only implements provider wire responses; inference and native history conversion
// remain in the actual managed helper and engine.
export async function startFixture() {
  const requests = [], errors = [];
  const controls = { compact: false, delay: false, handoffDelay: false, handoffQuota: false, catalogRequests: 0 };
  let handoffResolve;
  const handoffStarted = new Promise(resolve => { handoffResolve = resolve; });
  let delayedResolve;
  const delayedStarted = new Promise(resolve => { delayedResolve = resolve; });
  const server = createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/openrouter/api/v1/models') {
        controls.catalogRequests++;
        const ids = ['fixture/model-with-slash', ...Array.from({ length: 150 }, (_, i) => `fixture/catalog-${i}`)];
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ data: ids.map(id => ({ id, name: id, context_length: 32768,
          architecture: { input_modalities: ['text'], output_modalities: ['text'] }, supported_parameters: ['tools'] })) }));
        return;
      }
      assert.equal(req.method, 'POST');
      let raw = '';
      for await (const chunk of req) {
        raw += chunk;
        assert(raw.length < 4_000_000, 'fixture_request_too_large');
      }
      const body = JSON.parse(raw);
      const provider = req.url.split('/')[1];
      const handoff = raw.includes('Prepare a plain-text handoff for another provider.');
      const handoffSummary = `Plaintext handoff: retain ${[...new Set(raw.match(/ROUNDTRIP:[A-Z0-9_]+/g) ?? [])].join(' ')}. Continue the user's task.`;
      if (handoff && controls.handoffQuota) {
        controls.handoffQuota = false;
        requests.push({ provider, handoff, quota: true, body });
        if (provider === 'openai') {
          res.writeHead(200, { 'content-type': 'text/event-stream' });
          res.end(`event: response.failed\ndata: ${JSON.stringify({ type: 'response.failed', response: { id: 'quota_handoff', error: { code: 'insufficient_quota', message: 'synthetic quota exhausted' } } })}\n\n`);
          return;
        }
        res.writeHead(429, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'synthetic quota exhausted', code: 'insufficient_quota' } }));
        return;
      }
      if (provider === 'openai') {
        const marker = raw.includes('OPENAI_BOUNDARY_END') ? 'OPENAI_BOUNDARY_END' : 'OPENAI_BOUNDARY_START';
        const final = raw.includes(`ROUNDTRIP:${marker}`);
        requests.push({ provider, path: req.url, marker, final, handoff, body });
        assert(req.url.endsWith('/responses'), 'native_openai_responses_path');
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        const send = value => res.write(`event: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`);
        const id = `openai_${requests.length}`;
        send({ type: 'response.created', response: { id } });
        if (final && !handoff && marker === 'OPENAI_BOUNDARY_START') {
          send({ type: 'response.output_item.done', item: { type: 'compaction', id: `${id}_checkpoint`, encrypted_content: 'synthetic-native-opaque-checkpoint' } });
        }
        send({ type: 'response.output_item.done', item: final || handoff
          ? { id: `${id}_message`, type: 'message', role: 'assistant', content: [{ type: 'output_text', text: handoff ? handoffSummary : `VERIFIED:${marker}:ROUNDTRIP:${marker}` }] }
          : { type: 'function_call', call_id: `${id}_call`, namespace: 'namespace_b', name: 'echo', arguments: JSON.stringify({ value: marker }) } });
        send({ type: 'response.completed', response: { id, usage: { input_tokens: 12, output_tokens: 8, total_tokens: 20 } } });
        res.end(); return;
      }
      assert(['google', 'xai', 'openrouter', 'anthropic'].includes(provider));
      if (provider === 'anthropic') {
        assert.equal(req.url, '/anthropic/v1/messages', 'claude_official_messages_path');
        assert.equal(req.headers.authorization, 'Bearer synthetic-managed-anthropic-oauth-access', 'claude_oauth_bearer');
        assert(!req.headers['x-api-key'], 'claude_no_api_key_header');
      }
      const markers = [...raw.matchAll(/NATIVE_MANAGED_TURN_(\d+)/g)].map(match => Number(match[1]));
      assert(markers.length, 'missing_user_marker');
      const sequence = Math.max(...markers);
      const marker = `NATIVE_MANAGED_TURN_${sequence}`;
      const result = `ROUNDTRIP:${marker}`;
      const final = raw.includes(result);
      const compact = controls.compact || handoff; controls.compact = false;
      requests.push({ provider, path: req.url, sequence, final, compact, handoff, body });
      const declarations = provider === 'google'
        ? (body.tools ?? []).flatMap(tool => tool.functionDeclarations ?? [])
        : provider === 'anthropic' ? (body.tools ?? [])
        : (body.tools ?? []).map(tool => tool.function).filter(Boolean);
      const alias = declarations.find(tool => tool.description?.includes(echoIdentity))?.name
        ?? declarations.find(tool => tool.name?.includes('namespace_b') && tool.name.includes('echo'))?.name;
      if (!compact) assert(alias, `missing_declared_namespaced_echo:${JSON.stringify(declarations.map(tool => tool.name))}`);
      if (provider === 'anthropic' && final && !handoff) {
        const blocks = (body.messages ?? []).flatMap(message => Array.isArray(message.content) ? message.content : []);
        assert(blocks.some(block => block.type === 'tool_use' && block.input?.value === marker), 'claude_replays_tool_use');
        assert(blocks.some(block => block.type === 'tool_result' && JSON.stringify(block).includes(result)), 'claude_replays_tool_result');
      }
      if (provider === 'google') {
        for (const content of body.contents ?? []) for (const part of content.parts ?? []) {
          if (final && !handoff && part.functionCall && (part.functionCall.id === `call_${sequence}` || part.functionCall.args?.value === marker)) {
            assert.equal(part.thoughtSignature, thoughtSignature, 'google_current_turn_signature_replay');
          }
        }
      }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      const send = value => res.write(`data: ${JSON.stringify(value)}\n\n`);
      if (handoff && controls.handoffDelay) {
        controls.handoffDelay = false;
        assert.equal(provider, 'xai');
        send({ id: 'partial_handoff', object: 'chat.completion.chunk', created: 1, model: body.model,
          choices: [{ index: 0, delta: { role: 'assistant', content: 'UNFINISHED_HANDOFF_MUST_NOT_PERSIST' }, finish_reason: null }] });
        handoffResolve();
        const timer = setTimeout(() => res.destroy(), 30_000);
        res.once('close', () => clearTimeout(timer));
        return;
      }
      if (controls.delay) {
        controls.delay = false;
        assert.equal(provider, 'xai', 'cancellation_fixture_uses_chat_wire');
        send({ id: 'delayed_partial', object: 'chat.completion.chunk', created: 1, model: body.model,
          choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'cancel_partial', type: 'function', function: { name: alias, arguments: '{"value":' } }] }, finish_reason: null }] });
        delayedResolve();
        const timer = setTimeout(() => res.destroy(), 30_000);
        res.once('close', () => clearTimeout(timer));
        return;
      }
      const summary = handoff ? handoffSummary : compact ? `COMPACTION_SUMMARY: Preserve these exact observed public tool results: ${[...new Set(raw.match(/ROUNDTRIP:[A-Z0-9_]+/g) ?? [])].join(' ')}. Continue normally.` : null;
      const answer = `VERIFIED:${marker}:${result}` + (raw.includes('RETAIN_EARLIER_RESULT') && raw.includes('ROUNDTRIP:NATIVE_MANAGED_TURN_1') ? ':RECALLED:ROUNDTRIP:NATIVE_MANAGED_TURN_1' : '');
      if (provider === 'anthropic') {
        const id = `msg_fixture_${sequence}_${requests.length}`;
        const event = value => res.write(`event: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`);
        event({ type: 'message_start', message: { id, type: 'message', role: 'assistant', model: body.model, content: [], usage: { input_tokens: 12, output_tokens: 0 } } });
        if (final || compact) {
          event({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
          event({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: summary ?? answer } });
          event({ type: 'content_block_stop', index: 0 });
        } else {
          event({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: `toolu_${sequence}`, name: alias, input: {} } });
          event({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify({ value: marker }) } });
          event({ type: 'content_block_stop', index: 0 });
        }
        event({ type: 'message_delta', delta: { stop_reason: final || compact ? 'end_turn' : 'tool_use' }, usage: { output_tokens: 8 } });
        event({ type: 'message_stop' });
      } else if (provider === 'google') {
        send({ candidates: [{ index: 0, content: { role: 'model', parts: final || compact
          ? [{ text: summary ?? answer }]
          : [{ functionCall: { name: alias, args: { value: marker }, id: `call_${sequence}` }, thoughtSignature }] }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 8, totalTokenCount: 20 } });
      } else {
        const chunk = (delta, finish_reason = null) => ({ id: `fixture_${sequence}`, object: 'chat.completion.chunk', created: 1,
          model: body.model, choices: [{ index: 0, delta, finish_reason }] });
        send(chunk({ role: 'assistant', ...(final || compact ? { content: summary ?? answer } : {
          tool_calls: [{ index: 0, id: `call_${sequence}`, type: 'function', function: { name: alias, arguments: JSON.stringify({ value: marker }) } }],
        }) }));
        send(chunk({}, final || compact ? 'stop' : 'tool_calls'));
        res.write('data: [DONE]\n\n');
      }
      res.end();
    } catch (error) {
      errors.push(error.message);
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: error.message } }));
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { baseUrl: `http://127.0.0.1:${server.address().port}`, requests, errors, controls, delayedStarted, handoffStarted,
    close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }) };
}
