'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const readline = require('node:readline');
const { TOOLS } = require('./window-control-policy.cjs');
function parseThreadMetadata(meta) {
  const hasHeader = meta && Object.hasOwn(meta, 'x-codex-turn-metadata');
  let value = meta?.['x-codex-turn-metadata'];
  if (hasHeader) {
    if (typeof value === 'string') { try { value = JSON.parse(value); } catch { throw new Error('Trusted Codex turn metadata required'); } }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Trusted Codex turn metadata required');
  }
  const threadId = hasHeader ? value.thread_id : meta?.threadId;
  if (threadId === undefined && !hasHeader) throw new Error('Trusted Codex turn metadata required');
  if (typeof threadId !== 'string' || !/^(?:[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}|[A-Za-z0-9_-]{32,128})$/.test(threadId)) throw new Error('Invalid trusted thread identifier');
  if (meta.threadId !== undefined && meta.threadId !== threadId) throw new Error('Conflicting trusted thread identifier');
  return threadId;
}
function relayMetadata(meta) {
  if (meta === undefined) return {};
  parseThreadMetadata(meta);
  const selected = {};
  if (Object.hasOwn(meta, 'threadId')) selected.threadId = meta.threadId;
  if (Object.hasOwn(meta, 'x-codex-turn-metadata')) {
    const nested = typeof meta['x-codex-turn-metadata'] === 'string' ? JSON.parse(meta['x-codex-turn-metadata']) : meta['x-codex-turn-metadata'];
    const trusted = { thread_id: nested.thread_id };
    for (const key of ['turn_id', 'sandbox_mode']) {
      if (Object.hasOwn(nested, key)) {
        if (typeof nested[key] !== 'string' || !nested[key].length || nested[key].length > 256 || /[\x00-\x1f]/.test(nested[key])) throw new Error('Invalid native turn context');
        trusted[key] = nested[key];
      }
    }
    selected['x-codex-turn-metadata'] = trusted;
  }
  return selected;
}
function toolDefinitions() {
  return TOOLS.map(name => {
    const properties = { targetId: { type: 'string', description: 'Opaque selected target ID from status or capture.' } }; const required = name === 'status' ? [] : ['targetId'];
    if (['invoke', 'set_value', 'toggle', 'select', 'expand', 'collapse', 'scroll'].includes(name)) {
      properties.observationId = { type: 'string' }; properties.elementId = { type: 'string' }; required.push('observationId', 'elementId');
      if (name === 'set_value' || name === 'scroll') { properties.value = name === 'scroll' ? { type: 'object', properties: { horizontal: { type: 'integer', minimum: -2, maximum: 2 }, vertical: { type: 'integer', minimum: -2, maximum: 2 } }, required: ['horizontal', 'vertical'], additionalProperties: false } : { type: 'string', maxLength: 32768 }; required.push('value'); }
    }
    if (name === 'resize') { properties.widthDip = { type: 'number', minimum: 100, maximum: 8192 }; properties.heightDip = { type: 'number', minimum: 100, maximum: 8192 }; required.push('widthDip', 'heightDip'); }
    if (name === 'run_size_macro') { properties.macroId = { type: 'string' }; required.push('macroId'); }
    return { name, description: `Background selected-window ${name}. Requires the user's existing selection and application approval. ${name === 'status' ? 'Call with {} to discover this thread\'s selected target ID and saved macros. ' : ''}UI Automation only; paused windows require user resume. Capture before each element action.`, inputSchema: { type: 'object', properties, required, additionalProperties: false } };
  });
}
function pipeRequest(pipe, message, { connect = net.createConnection, timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const socket = connect(pipe); let buffer = ''; let settled = false;
    const finish = (error, result) => { if (settled) return; settled = true; socket.destroy(); error ? reject(error) : resolve(result); };
    socket.setTimeout(timeoutMs, () => finish(new Error('Selected-window host timed out')));
    socket.on('connect', () => socket.write(JSON.stringify(message) + '\n'));
    socket.on('error', e => finish(e));
    socket.on('end', () => finish(new Error('Selected-window host closed without response')));
    socket.on('data', data => {
      buffer += data.toString('utf8'); if (buffer.length > 32 * 1024 * 1024) return finish(new Error('Host response too large'));
      const newline = buffer.indexOf('\n'); if (newline < 0) return;
      try { const result = JSON.parse(buffer.slice(0, newline)); if (result.error) finish(new Error(typeof result.error === 'string' ? result.error : 'Selected-window operation failed')); else finish(null, result.result); } catch { finish(new Error('Invalid selected-window host response')); }
    });
  });
}
function createRelay({ codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), request = pipeRequest, readFile = fs.readFile } = {}) {
  return async (threadId, tool, args, meta) => {
    // The model cannot choose the session path; only validated native turn metadata can.
    parseThreadMetadata({ 'x-codex-turn-metadata': { thread_id: threadId } });
    const trustedMeta = relayMetadata(meta);
    if (meta !== undefined && parseThreadMetadata(meta) !== threadId) throw new Error('Conflicting trusted thread identifier');
    let session;
    try { const raw = await readFile(path.join(codexHome, 'azrael', 'computer-use', 'window-sessions', threadId + '.json'), 'utf8'); if (raw.length > 16384) throw new Error(); session = JSON.parse(raw); } catch { throw new Error('No selected-window session for this thread'); }
    if (!session || session.schema !== 1 || Object.keys(session).some(k => !['schema', 'pipe', 'nonce'].includes(k)) || typeof session.pipe !== 'string' || !/^\\\\\.\\pipe\\azrael-window-[A-Za-z0-9_-]{16,128}$/.test(session.pipe) || typeof session.nonce !== 'string' || !/^[A-Za-z0-9_-]{32,256}$/.test(session.nonce)) throw new Error('Invalid selected-window session');
    return request(session.pipe, { nonce: session.nonce, threadId, method: 'call', tool, arguments: args, _meta: trustedMeta });
  };
}
function callResult(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Invalid host result');
  const text = {};
  for (const key of ['targetId', 'state', 'window', 'supportedActions', 'observationId', 'frameTimestamp', 'widthPx', 'heightPx', 'dpi', 'elements', 'macros', 'observationRequired']) if (Object.hasOwn(result, key)) text[key] = result[key];
  // Nested values are projected as well, preventing native identity/extra fields leaking.
  if (text.window) text.window = Object.fromEntries(['title', 'widthPx', 'heightPx', 'dpi', 'minimized'].filter(k => Object.hasOwn(text.window, k)).map(k => [k, text.window[k]]));
  if (Array.isArray(text.elements)) text.elements = text.elements.map(e => ({ id: e.id, name: e.name, controlType: e.controlType, patterns: e.patterns }));
  if (Array.isArray(text.macros)) text.macros = text.macros.map(m => ({ id: m.id, name: m.name, steps: m.steps.map(s => ({ widthDip: s.widthDip, heightDip: s.heightDip })) }));
  const content = [{ type: 'text', text: JSON.stringify(text) }];
  if (result.image) { if (result.image.mimeType !== 'image/png' || typeof result.image.data !== 'string') throw new Error('Invalid capture image'); content.push({ type: 'image', mimeType: 'image/png', data: result.image.data }); }
  return { content, isError: false };
}
function createProtocol({ relay = createRelay() } = {}) {
  return async message => {
    const id = message?.id;
    if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') return { jsonrpc: '2.0', id: id ?? null, error: { code: -32600, message: 'Invalid JSON-RPC request' } };
    if (id === undefined) return null;
    let result;
    if (message.method === 'initialize') result = { protocolVersion: message.params?.protocolVersion || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'azrael-selected-window', version: '1.0.0' } };
    else if (message.method === 'ping') result = {};
    else if (message.method === 'tools/list') result = { tools: toolDefinitions() };
    else if (message.method === 'tools/call') {
      try {
        const params = message.params; if (!params || !TOOLS.includes(params.name)) throw new Error('Unsupported selected-window tool');
        const args = params.arguments || {}; const definition = toolDefinitions().find(t => t.name === params.name);
        if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some(k => !Object.hasOwn(definition.inputSchema.properties, k)) || definition.inputSchema.required.some(k => !Object.hasOwn(args, k))) throw new Error('Invalid tool arguments');
        const threadId = parseThreadMetadata(params._meta);
        const trustedMeta = relayMetadata(params._meta);
        result = callResult(await relay(threadId, params.name, args, trustedMeta));
      } catch (e) { result = { content: [{ type: 'text', text: e.message }], isError: true }; }
    } else return { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } };
    return { jsonrpc: '2.0', id, result };
  };
}
async function runProtocol({ input = process.stdin, output = process.stdout, protocol = createProtocol() } = {}) {
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    let response;
    try { response = await protocol(JSON.parse(line)); } catch { response = { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }; }
    if (response) output.write(JSON.stringify(response) + '\n');
  }
}
module.exports = { parseThreadMetadata, relayMetadata, toolDefinitions, pipeRequest, createRelay, callResult, createProtocol, runProtocol };
if (require.main === module) runProtocol().catch(() => { process.exitCode = 1; });
