import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { infer } from '../inference.ts';
import * as config from '../vendor/src/config.ts';
import * as store from '../vendor/src/oauth/store.ts';
import { createContextDiagnostics } from '../../devin/context-budget.mjs';
import { createProgressMonitor } from '../../devin/progress.mjs';
import { estimateTokens } from '../vendor/src/lib/token-estimate.ts';

let root = '';
const saved = [process.env.CODEX_HOME, process.env.OPENCODEX_HOME];
afterEach(() => {
  if (root) rmSync(root, { recursive: true }); root = '';
  ['CODEX_HOME', 'OPENCODEX_HOME'].forEach((key, i) => { if (saved[i] === undefined) delete process.env[key]; else process.env[key] = saved[i]; });
});

for (const provider of ['anthropic', 'google-antigravity']) {
  test(`${provider} prepares final request without generation and compares the same actual wire`, async () => {
    root = mkdtempSync(join(tmpdir(), 'azrael-budget-'));
    process.env.CODEX_HOME = join(root, 'codex'); process.env.OPENCODEX_HOME = join(root, 'codex', 'azrael', 'providers', 'opencodex');
    mkdirSync(process.env.OPENCODEX_HOME, { recursive: true });
    const cfg = config.loadConfig();
    cfg.providers = { [provider]: provider === 'anthropic'
      ? { adapter: 'anthropic', baseUrl: 'https://api.anthropic.com', authMode: 'oauth', models: ['claude-sonnet-4-6'] }
      : { adapter: 'google', baseUrl: 'https://daily-cloudcode-pa.googleapis.com', authMode: 'oauth', googleMode: 'cloud-code-assist' } };
    config.saveConfig(cfg);
    await store.saveCredential(provider, { access: 'SECRET-token', refresh: 'SECRET-refresh', expires: Number.MAX_SAFE_INTEGER, accountId: 'fixture', projectId: 'fixture-project' });
    const request = { protocol_version: 1, type: 'request', request_id: 'fixture', thread_id: 'thread', turn_id: 'turn',
      provider_id: provider, model: provider === 'anthropic' ? 'claude-sonnet-4-6' : 'gemini-3.8-flash', instructions: '한글 instructions',
      input: [{ type: 'message', role: 'user', content: 'hello 한글 code {"x":2}' }],
      tools: [{ type: 'function', name: 'lookup', description: 'lookup description', parameters: { type: 'object' } }], parallel_tool_calls: true };
    const original = JSON.stringify(request), prepared: any[] = [];
    await infer(request, frame => prepared.push(frame), (async () => { throw new Error('GENERATION_FORBIDDEN'); }) as typeof fetch, undefined, { prepareOnly: true });
    const result = prepared.find(frame => frame.type === 'input_budget').input_budget;
    expect(result.supported).toBe(true); expect(result.input_tokens).toBeGreaterThan(0);
    const preload = join(root, 'forbid-network.ts');
    writeFileSync(preload, "globalThis.fetch = async () => { throw new Error('NETWORK_FORBIDDEN'); };\n");
    const cliStarted = performance.now();
    const cli = spawnSync(process.execPath, ['--preload', preload, 'inference.ts'], { cwd: import.meta.dir + '/..', env: process.env,
      input: JSON.stringify({ type: 'init', protocol_version: 1, request_id: request.request_id }) + '\n' + JSON.stringify({ ...request, type: 'estimate' }) + '\n',
      encoding: 'utf8', timeout: 15000 });
    expect(cli.status).toBe(0);
    const cliFrames = cli.stdout.trim().split('\n').map(line => JSON.parse(line));
    const final = cliFrames.at(-1);
    expect(final.type).toBe('input_budget'); expect(final.request_id).toBe(request.request_id);
    expect(final.input_budget.input_tokens).toBe(result.input_tokens);
    expect(cli.stdout).not.toContain('SECRET');
    console.log(JSON.stringify({ fixture: provider, estimate_cli_ms: Math.round(performance.now() - cliStarted), input_tokens_estimate: result.input_tokens,
      wire_bytes: result.diagnostics.wire_bytes, native_input_bytes: Buffer.byteLength(JSON.stringify(request)) }));
    const definition = { ...request.tools[0], description: 'schema '.repeat(2000) };
    const discovered = { type: 'namespace', name: 'fixture', tools: [definition] };
    const searched = { ...request, tools: [discovered, { type: 'tool_search', execution: 'client', parameters: { type: 'object' } }], input: [
      ...Array.from({ length: 20 }, (_, i) => [
        { type: 'tool_search_call', execution: 'client', call_id: 'search' + i, arguments: { query: 'lookup' } },
        { type: 'tool_search_output', execution: 'client', call_id: 'search' + i, status: 'completed', tools: [discovered] },
      ]).flat(), ...request.input,
    ] };
    const searchFrames: any[] = [];
    await infer(searched, frame => searchFrames.push(frame), (async () => { throw new Error('GENERATION_FORBIDDEN'); }) as typeof fetch, undefined, { prepareOnly: true });
    expect(searchFrames[0].input_budget.input_tokens).toBeLessThan(estimateTokens(JSON.stringify(searched.input), request.model) / 3);
    const context = createContextDiagnostics(request.model, estimateTokens, 'model_chars');
    const progress = createProgressMonitor(() => {}, { contextDiagnostics: context });
    const frames: any[] = []; let calls = 0;
    try {
      await infer(request, frame => frames.push(frame), (async (_url: any, init: any) => {
        calls++;
        const expected = createContextDiagnostics(request.model, estimateTokens, 'model_chars'); expected.wire(init.body);
        expect(expected.budget().input_tokens).toBe(result.input_tokens);
        expect(expected.snapshot().components).toEqual(result.diagnostics.components);
        if (provider === 'anthropic') return new Response([
          { type: 'message_start', message: { id: 'fixture', role: 'assistant', content: [], usage: { input_tokens: 100, cache_read_input_tokens: 60, cache_creation_input_tokens: 10 } } },
          { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'done' } },
          { type: 'content_block_stop', index: 0 }, { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 3 } }, { type: 'message_stop' },
        ].map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
        return new Response('data: ' + JSON.stringify({ response: { candidates: [{ content: { role: 'model', parts: [{ text: 'done' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 170, cachedContentTokenCount: 60, candidatesTokenCount: 3 } } }) + '\n\n', { headers: { 'content-type': 'text/event-stream' } });
      }) as typeof fetch, progress);
      expect(calls).toBe(1);
      const completed = frames.find(frame => frame.type === 'completed');
      const evidence = progress.snapshot().context_diagnostics;
      expect(evidence.reported_input_tokens).toBe(completed.usage.input_tokens);
      expect(evidence.residual_tokens).toBe(completed.usage.input_tokens - result.input_tokens);
      expect(JSON.stringify(evidence)).not.toContain('SECRET');
      expect(JSON.stringify(request)).toBe(original);
    } finally { progress.stop(); }
  });
}

test('provider model estimates count Korean separately and are not clamped at model capacity', () => {
  const context = createContextDiagnostics('claude-model', estimateTokens, 'model_chars');
  context.compiled({ messages: [{ role: 'user', content: '가'.repeat(10000) }] });
  expect(context.budget().input_tokens).toBe(estimateTokens('가'.repeat(10000), 'claude-model'));
  expect(context.budget().input_tokens).toBeGreaterThan(6000);
});
