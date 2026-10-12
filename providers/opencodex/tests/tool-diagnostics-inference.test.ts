import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { infer } from '../inference.ts';
import { loadConfig, saveConfig } from '../vendor/src/config.ts';
import { saveCredential } from '../vendor/src/oauth/store.ts';
import { createToolDiagnostics } from '../tool-diagnostics.mjs';
import { createProgressMonitor } from '../../devin/progress.mjs';

const wire = (value: any) => `event: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`;
test('actual Anthropic adapter exposes safe raw/parser mapping evidence and ping-only argument stall', async () => {
  const root = mkdtempSync(join(tmpdir(), 'azrael-tool-diagnostics-'));
  const oldHome = process.env.CODEX_HOME, oldOcx = process.env.OPENCODEX_HOME;
  let turn = 0;
  try {
    process.env.CODEX_HOME = join(root, 'codex');
    process.env.OPENCODEX_HOME = join(process.env.CODEX_HOME, 'azrael/providers/opencodex');
    mkdirSync(process.env.OPENCODEX_HOME, { recursive: true });
    const config = loadConfig();
    config.providers.anthropic = { adapter: 'anthropic', baseUrl: 'https://api.anthropic.com', authMode: 'oauth', models: ['claude-sonnet-4-6'] };
    saveConfig(config);
    await saveCredential('anthropic', { access: 'SECRET_ACCESS', refresh: 'SECRET_REFRESH', expires: Date.now() + 3600000, accountId: 'SECRET_ACCOUNT' });
    const request = () => ({ protocol_version: 1, type: 'request', request_id: 'fixture', provider_id: 'anthropic',
      thread_id: 'tools-thread', turn_id: 'turn-' + turn++, model: 'claude-sonnet-4-6', instructions: 'SECRET_PROMPT',
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'SECRET_INPUT' }] }],
      tools: [{ type: 'function', name: 'SECRET_TOOL', description: 'SECRET_DESCRIPTION', parameters: { type: 'object' } }], parallel_tool_calls: true });
    for (const mode of ['declared', 'original', 'unknown']) {
      const toolDiagnostics = createToolDiagnostics({ wirePrefix: 'custom_' });
      const monitor = createProgressMonitor(() => {}, { transportEnabled: true, toolDiagnostics });
      const frames: any[] = [];
      const fetcher = (async (_url: any, init: any) => {
        const name = mode === 'original' ? 'custom_SECRET_TOOL' : mode === 'unknown' ? 'custom_UNKNOWN_TOOL' : JSON.parse(init.body).tools[0].name;
        const args = '{"value":"SECRET_ARGUMENT"}';
        return new Response([
          { type: 'message_start', message: { usage: { input_tokens: 2 } } },
          { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', name, id: 'SECRET_CALL_ID', input: {} } },
          { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: args } },
          { type: 'content_block_stop', index: 0 },
          { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 2 } },
          { type: 'message_stop' },
        ].map(wire).join(''));
      }) as typeof fetch;
      try {
        const execution = infer(request(), frame => frames.push(frame), fetcher, monitor);
        if (mode === 'unknown') await expect(execution).rejects.toThrow('undeclared_tool');
        else await execution;
        const evidence = monitor.snapshot().tool_diagnostics;
        expect(evidence.catalog_tool_count).toBe(1);
        expect(evidence.raw_parser_name_equal).toBe(true);
        expect(evidence.sse_args_delta_count).toBe(1);
        expect(evidence.args_bytes).toBe(evidence.sse_args_bytes);
        expect(evidence.mapping_result).toBe(mode === 'unknown' ? 'undeclared' : 'validated');
        if (mode === 'original') expect(evidence.name_match).toBe('current_original');
        expect(JSON.stringify(monitor.snapshot())).not.toContain('SECRET');
        expect(frames.some(frame => frame.item?.type === 'function_call')).toBe(mode !== 'unknown');
      } finally { monitor.stop(); }
    }
    let time = 0;
    const diagnostics = createToolDiagnostics({ now: () => time, wirePrefix: 'custom_' });
    const monitor = createProgressMonitor(() => {}, { now: () => time, transportEnabled: true, toolDiagnostics: diagnostics });
    let source: ReadableStreamDefaultController<Uint8Array>;
    const fetcher = (async (_url: any, init: any) => {
      const name = JSON.parse(init.body).tools[0].name;
      return new Response(new ReadableStream({ start(controller) {
        source = controller;
        controller.enqueue(new TextEncoder().encode([
          { type: 'message_start', message: { usage: { input_tokens: 1 } } },
          { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', name, id: 'SECRET_STALLED_ID', input: {} } },
          { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '' } },
        ].map(wire).join('')));
      } }, { highWaterMark: 0 }));
    }) as typeof fetch;
    const execution = infer(request(), () => {}, fetcher, monitor);
    try {
      for (let i = 0; i < 100 && !monitor.snapshot().tool_diagnostics.call_open; i++) await new Promise(resolve => setTimeout(resolve, 10));
      expect(monitor.snapshot().tool_diagnostics.call_open).toBe(true);
      time = 97000; source!.enqueue(new TextEncoder().encode(wire({ type: 'ping' })));
      for (let i = 0; i < 100 && monitor.snapshot().transport.heartbeat_count !== 1; i++) await new Promise(resolve => setTimeout(resolve, 10));
      const evidence = monitor.snapshot();
      expect(evidence.tool_diagnostics.args_bytes).toBe(0);
      expect(evidence.tool_diagnostics.sse_args_bytes).toBe(0);
      expect(evidence.tool_diagnostics.args_idle_ms).toBe(97000);
      expect(evidence.tool_diagnostics.sse_args_empty_delta_count).toBe(1);
      expect(evidence.event_count).toBe(1); expect(evidence.event_idle_ms).toBe(97000);
      expect(evidence.transport.content_block_kind).toBe('tool_use');
      expect(JSON.stringify(evidence)).not.toContain('SECRET');
      source!.enqueue(new TextEncoder().encode(wire({ type: 'error', error: { type: 'invalid_request_error', message: 'SECRET_ERROR' } })));
      await expect(execution).rejects.toThrow('provider_failure');
    } finally { monitor.stop(); try { source!?.close(); } catch { /* Adapter cancellation already closed the source. */ } }
  } finally {
    if (oldHome === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = oldHome;
    if (oldOcx === undefined) delete process.env.OPENCODEX_HOME; else process.env.OPENCODEX_HOME = oldOcx;
    rmSync(root, { recursive: true });
  }
});
