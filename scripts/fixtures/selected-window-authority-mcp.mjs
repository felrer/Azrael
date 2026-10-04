// Synthetic protocol-only server: no desktop APIs, credentials or model calls.
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

export function respond(message, log) {
  if (message.id === undefined) return null;
  const base = { jsonrpc: '2.0', id: message.id };
  let result;
  switch (message.method) {
    case 'initialize':
      result = { protocolVersion: message.params.protocolVersion, capabilities: { tools: {}, experimental: { 'codex/sandbox-state-meta': {} } }, serverInfo: { name: 'synthetic-window-authority', version: '1' } }; break;
    case 'tools/list':
      result = { tools: ['ui_operation', 'echo', 'execute'].map(name => ({ name, description: 'Synthetic authority fixture only', inputSchema: { type: 'object', additionalProperties: true }, ...(name === 'ui_operation' ? { _meta: { ui: { visibility: ['app'] } } } : {}) })) }; break;
    case 'tools/call': {
      const received = { tool: message.params.name, arguments: message.params.arguments, meta: message.params._meta ?? null };
      appendFileSync(log, JSON.stringify(received) + '\n');
      const rejected = received.tool === 'ui_operation' && received.meta?.['codex/sandbox-state-meta']?.permissionProfile?.type !== 'disabled';
      result = { content: [{ type: 'text', text: rejected ? 'Native Disabled permission profile required' : 'synthetic accepted' }], structuredContent: received, isError: rejected };
      break;
    }
    case 'ping': result = {}; break;
    default: return { ...base, error: { code: -32601, message: 'Unsupported synthetic method' } };
  }
  return { ...base, result };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const log = process.argv[2];
  if (!log) throw new Error('Synthetic MCP requires an explicit retained call log');
  createInterface({ input: process.stdin }).on('line', line => {
    const response = respond(JSON.parse(line), log);
    if (response) process.stdout.write(JSON.stringify(response) + '\n');
  });
}
