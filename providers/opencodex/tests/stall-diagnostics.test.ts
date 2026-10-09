import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { infer, observeAnthropic } from '../inference.ts';
import { loadConfig, saveConfig } from '../vendor/src/config.ts';
import { saveCredential } from '../vendor/src/oauth/store.ts';
import { createProgressMonitor } from '../../devin/progress.mjs';
const wire = (value: any) => `event: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`;

test('managed streamed mock tracks ping-only read, partial SSE, declared thinking and clean finish', async () => {
  let time = 0;
  const monitor = createProgressMonitor(() => {}, { transportEnabled: true, now: () => time });
  let controller: ReadableStreamDefaultController<Uint8Array>;
  const response = new Response(new ReadableStream({ start(c) { controller = c; } }, { highWaterMark: 0 }));
  const opaque = { terminal: false };
  const reader = observeAnthropic(response, opaque, bytes => monitor.observe({ kind: 'bytes', bytes }), monitor.transport).body!.getReader();
  const put = async (text: string) => { const pending = reader.read(); controller.enqueue(new TextEncoder().encode(text)); await pending; };
  await put(wire({ type: 'ping' }));
  expect(monitor.snapshot().transport.heartbeat_count).toBe(1);
  expect(monitor.snapshot().event_count).toBe(0);
  await put(wire({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: 'SECRET_THINKING' } }));
  expect(monitor.snapshot().transport.content_block_open).toBe(true);
  expect(monitor.snapshot().transport.content_block_kind).toBe('thinking');
  await put('data: {"type":"content_block_delta"');
  expect(monitor.snapshot().transport.sse_pending_bytes).toBeGreaterThan(0);
  const pending = reader.read(); await new Promise(resolve => setTimeout(resolve, 0)); time = 80;
  expect(monitor.snapshot().transport.read_state).toBe('pending');
  expect(monitor.snapshot().transport.read_wait_ms).toBe(80);
  controller.enqueue(new TextEncoder().encode(',"delta":{"type":"thinking_delta","thinking":"SECRET_DELTA"}}\n\n'));
  await pending;
  await put(wire({ type: 'content_block_stop', index: 0 }));
  await put(wire({ type: 'message_stop' }));
  controller.close(); await reader.read();
  expect(monitor.snapshot().transport.finish_seen).toBe(true);
  expect(monitor.snapshot().transport.content_block_open).toBe(false);
  expect(monitor.snapshot().transport.read_state).toBe('eof');
  expect(JSON.stringify(monitor.snapshot())).not.toContain('SECRET');
  monitor.stop();
});

test('actual inference mock records upstream SSE failure and owns deadline classification without masking HTTP/validation', async () => {
  const root = mkdtempSync(join(tmpdir(), 'azrael-stall-fixture-'));
  const oldHome = process.env.CODEX_HOME, oldProviderHome = process.env.OPENCODEX_HOME;
  let count = 0;
  try {
    process.env.CODEX_HOME = join(root, 'codex');
    process.env.OPENCODEX_HOME = join(process.env.CODEX_HOME, 'azrael', 'providers', 'opencodex');
    mkdirSync(process.env.OPENCODEX_HOME, { recursive: true });
    const config = loadConfig();
    config.providers.anthropic = { adapter: 'anthropic', baseUrl: 'https://api.anthropic.com', authMode: 'oauth', models: ['claude-sonnet-4-6'] };
    saveConfig(config);
    await saveCredential('anthropic', { access: 'SECRET_ACCESS', refresh: 'SECRET_REFRESH', expires: Date.now() + 3600_000, accountId: 'SECRET_ACCOUNT' });
    const request = () => ({ type: 'request', protocol_version: 1, request_id: 'fixture', thread_id: 'stall-thread', turn_id: 'turn-' + count++, provider_id: 'anthropic', model: 'claude-sonnet-4-6', instructions: 'SECRET_PROMPT', input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'SECRET_INPUT' }] }], tools: [], parallel_tool_calls: true });
    for (const transportEnabled of [true, false]) {
      for (const code of [undefined, 'ENOTFOUND']) {
        const monitor = createProgressMonitor(() => {}, { transportEnabled });
        try {
          const error = new TypeError('SECRET_FETCH_URL', { cause: { code, host: 'SECRET_HOST' } });
          await expect(infer(request(), () => {}, (async () => { throw error; }) as typeof fetch, monitor)).rejects.toThrow(code ? 'provider_connection_dns' : 'provider_headers_failed');
          if (transportEnabled) {
            expect(monitor.snapshot().transport.error_stage).toBe('headers');
            expect(monitor.snapshot().transport.connection_error).toBe(code ? 'dns' : undefined);
            expect(JSON.stringify(monitor.snapshot())).not.toContain('SECRET');
          }
        } finally { monitor.stop(); }
      }
      const monitor = createProgressMonitor(() => {}, { transportEnabled });
      try {
        const body = new ReadableStream({ start(controller) { controller.error(new TypeError('SECRET_BODY_URL', { cause: { code: 'ECONNRESET' } })); } });
        await expect(infer(request(), () => {}, (async () => new Response(body)) as typeof fetch, monitor)).rejects.toThrow('provider_connection_reset');
        if (transportEnabled) {
          expect(monitor.snapshot().transport.error_stage).toBe('body_read');
          expect(monitor.snapshot().transport.error_name).toBe('type_error');
          expect(monitor.snapshot().transport.connection_error_code).toBe('ECONNRESET');
        }
      } finally { monitor.stop(); }
    }
    for (const stream of [false, true]) {
      const frames: any[] = [];
      const error = { type: 'usage_limit_reached', message: 'PRIVATE_QUOTA_MESSAGE' };
      const fetcher = (async () => stream ? new Response(wire({ type: 'error', error })) : Response.json({ error }, { status: 400 })) as typeof fetch;
      await expect(infer(request(), frame => frames.push(frame), fetcher)).rejects.toThrow('provider_usage_limit');
      expect(frames.some(frame => frame.type === 'completed' || frame.type === 'item_done')).toBeFalse();
      expect(JSON.stringify(frames)).not.toContain('PRIVATE_QUOTA_MESSAGE');
    }
    const preHeaderFrames: any[] = [];
    let releaseHeaders: (response: Response) => void;
    const preHeaderProgress = createProgressMonitor(frame => preHeaderFrames.push(frame), { transportEnabled: true, intervalMs: 10 });
    const pendingHeaders = infer(request(), frame => preHeaderFrames.push(frame), (async () => await new Promise<Response>(resolve => { releaseHeaders = resolve; })) as typeof fetch, preHeaderProgress);
    try {
      for (let attempt = 0; attempt < 100 && !releaseHeaders!; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
      expect(typeof releaseHeaders!).toBe('function');
      await new Promise(resolve => setTimeout(resolve, 20));
      const frame = preHeaderFrames.find(frame => frame.type === 'progress' && frame.progress.phase === 'headers');
      expect(frame.progress.transport).toBeDefined();
      expect(frame.progress.transport.headers_status).toBeUndefined();
      expect(preHeaderFrames.some(frame => frame.type === 'created')).toBeFalse();
      releaseHeaders!(new Response(null, { status: 401 }));
      await expect(pendingHeaders).rejects.toThrow('provider_http_401');
    } finally { preHeaderProgress.stop(); }
    let stalledSource: ReadableStreamDefaultController<Uint8Array>;
    const stalledProgress = createProgressMonitor(() => {}, { transportEnabled: true });
    const stalledBody = new ReadableStream<Uint8Array>({ start(controller) { stalledSource = controller; } }, { highWaterMark: 0 });
    const stalledInference = infer(request(), () => {}, (async () => new Response(stalledBody)) as typeof fetch, stalledProgress);
    try {
      stalledSource!.enqueue(new TextEncoder().encode(wire({ type: 'message_start', message: { usage: { input_tokens: 1 } } }) + wire({ type: 'ping' })));
      for (let attempt = 0; attempt < 100 && stalledProgress.snapshot().transport.heartbeat_count !== 1; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
      expect(stalledProgress.snapshot().event_count).toBe(0);
      stalledSource!.enqueue(new TextEncoder().encode(wire({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } })));
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(stalledProgress.snapshot().transport.parser_state).toBe('pending');
      expect(stalledProgress.snapshot().transport.read_state).toBe('pending');
      expect(stalledProgress.snapshot().transport.content_block_kind).toBe('thinking');
      expect(stalledProgress.snapshot().event_count).toBe(0);
      expect(stalledProgress.snapshot().transport.last_parser_event).toBe('thinking_delta');
      stalledSource!.enqueue(new TextEncoder().encode(wire({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'SECRET_REAL_REASONING' } })));
      for (let attempt = 0; attempt < 100 && stalledProgress.snapshot().event_count === 0; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
      expect(stalledProgress.snapshot().event_count).toBe(1);
      stalledSource!.enqueue(new TextEncoder().encode(wire({ type: 'content_block_stop', index: 0 }) + wire({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } }) + wire({ type: 'message_stop' })));
      stalledSource!.close(); await stalledInference;
      expect(stalledProgress.snapshot().transport.finish_seen).toBe(true);
    } finally { stalledProgress.stop(); }
    const progress = createProgressMonitor(() => {}, { transportEnabled: true });
    try {
      await expect(infer(request(), () => {}, (async () => new Response(wire({ type: 'error', error: { message: 'SECRET_EXCEPTION', type: 'SECRET_TYPE' } }), { headers: { 'request-id': 'SECRET_ID', server: 'SECRET_SERVER', via: 'SECRET_VIA' } })) as typeof fetch, progress)).rejects.toThrow('provider_failure');
      const evidence = progress.snapshot().transport;
      expect(evidence.error_stage).toBe('sse_decode');
      expect(evidence.last_parser_event).toBe('error');
      expect(evidence.request_id_sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(JSON.stringify(progress.snapshot())).not.toContain('SECRET');
    } finally { progress.stop(); }
    // The signal is already aborted when a positively observed provider error
    // arrives. Timer state must not erase that source, even without diagnostics.
    for (const transportEnabled of [true, false]) {
      const racedDeadline = new AbortController(); racedDeadline.abort();
      const racedProgress = createProgressMonitor(() => {}, { transportEnabled });
      try {
        await expect(infer(request(), () => {}, (async () => new Response(wire({ type: 'error', error: { message: 'SECRET_RACED_SSE_ERROR', type: 'SECRET_RACED_TYPE' } }))) as typeof fetch, racedProgress, { deadlineSignal: racedDeadline.signal })).rejects.toThrow('provider_failure');
        if (transportEnabled) {
          const evidence = racedProgress.snapshot().transport;
          expect(evidence.abort_source).toBe('deadline');
          expect(evidence.error_stage).toBe('sse_decode');
          expect(evidence.last_sse_event).toBe('error');
          expect(evidence.last_parser_event).toBe('error');
          expect(JSON.stringify(evidence)).not.toContain('SECRET');
        }
      } finally { racedProgress.stop(); }
    }
    const bodyDeadline = new AbortController();
    const bodyProgress = createProgressMonitor(() => {}, { transportEnabled: true });
    const bodyAbort = infer(request(), () => {}, (async () => new Response(new ReadableStream({
      start(controller) { bodyDeadline.signal.addEventListener('abort', () => controller.error(new Error('SECRET_BODY_ABORT')), { once: true }); },
    }, { highWaterMark: 0 }))) as typeof fetch, bodyProgress, { deadlineSignal: bodyDeadline.signal });
    try {
      for (let attempt = 0; attempt < 100 && bodyProgress.snapshot().transport.read_state !== 'pending'; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
      expect(bodyProgress.snapshot().transport.read_state).toBe('pending');
      bodyDeadline.abort();
      await expect(bodyAbort).rejects.toThrow('provider_request_deadline');
      expect(bodyProgress.snapshot().transport.error_stage).toBe('body_read');
      expect(bodyProgress.snapshot().transport.abort_source).toBe('deadline');
      expect(JSON.stringify(bodyProgress.snapshot())).not.toContain('SECRET');
    } finally { bodyProgress.stop(); }
    for (const error of [new Error('SECRET_GENERIC'), new DOMException('SECRET_ABORT', 'AbortError'), new DOMException('SECRET_TIMEOUT', 'TimeoutError'), new TypeError('SECRET_DNS_DEADLINE', { cause: { code: 'ENOTFOUND' } })]) {
      const deadline = new AbortController();
      const progress = createProgressMonitor(() => {}, { transportEnabled: true });
      try {
        await expect(infer(request(), () => {}, (async () => { deadline.abort(); throw error; }) as typeof fetch, progress, { deadlineSignal: deadline.signal })).rejects.toThrow('provider_request_deadline');
        expect(progress.snapshot().transport.abort_source).toBe('deadline');
        expect(progress.snapshot().transport.error_stage).toBe('headers');
        expect(JSON.stringify(progress.snapshot())).not.toContain('SECRET');
      } finally { progress.stop(); }
    }
    const deadline = new AbortController();
    await expect(infer(request(), () => {}, (async () => { deadline.abort(); return new Response(null, { status: 401 }); }) as typeof fetch, undefined, { deadlineSignal: deadline.signal })).rejects.toThrow('provider_http_401');
    await expect(infer({ ...request(), instructions: null }, () => {}, (() => { throw new Error('fetch must not run'); }) as typeof fetch, undefined, { deadlineSignal: deadline.signal })).rejects.toThrow('unsupported_provider_output');
  } finally {
    if (oldHome === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = oldHome;
    if (oldProviderHome === undefined) delete process.env.OPENCODEX_HOME; else process.env.OPENCODEX_HOME = oldProviderHome;
    rmSync(root, { recursive: true, force: true });
  }
});


test('Anthropic thinking wait stays durable without transport diagnostics across ping-only silence', async () => {
  let time = 0;
  const monitor = createProgressMonitor(() => {}, { thinkingWaitEnabled: true, now: () => time });
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const response = new Response(new ReadableStream<Uint8Array>({ start(c) { controller = c; } }, { highWaterMark: 0 }));
  const reader = observeAnthropic(response, { terminal: false }, undefined, undefined,
    event => monitor.observe(event)).body!.getReader();
  const put = async (value: any) => {
    const pending = reader.read();
    controller.enqueue(new TextEncoder().encode(wire(value)));
    await pending;
  };
  try {
    await put({ type: 'ping' });
    await put({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } });
    expect(monitor.snapshot().thinking_wait.open).toBe(true);
    for (let i = 1; i <= 4; i++) {
      time = i * 90_000;
      await put({ type: 'ping', content: 'SECRET_PING' });
      expect(monitor.snapshot().thinking_wait).toEqual({ open: true, heartbeat_count: i, heartbeat_idle_ms: 0 });
    }
    expect(monitor.snapshot().event_count).toBe(0);
    expect(monitor.snapshot().last_event).toBe('none');
    expect(monitor.snapshot().transport).toBeUndefined();
    await put({ type: 'content_block_stop', index: 0 });
    await put({ type: 'ping' });
    expect(monitor.snapshot().thinking_wait.open).toBe(false);
    expect(monitor.snapshot().thinking_wait.heartbeat_count).toBe(4);
    await put({ type: 'message_stop' });
    controller.close();
    await reader.read();
    expect(JSON.stringify(monitor.snapshot())).not.toContain('SECRET');
  } finally { monitor.stop(); await reader.cancel(); }
});
