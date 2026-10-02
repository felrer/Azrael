import { createInterface } from 'node:readline';
createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line);
  if (request.id === undefined) return;
  let result;
  switch (request.method) {
    case 'initialize': result = { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'native-devin-fixture', version: '1' } }; break;
    case 'tools/list': result = { tools: [{ name: 'echo', description: 'Native MCP compatibility fixture.', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } }] }; break;
    case 'tools/call': result = { content: [{ type: 'text', text: request.params.name === 'echo' && request.params.arguments.text === 'probe' ? 'MCP_RESULT_7391' : 'WRONG_MCP_INPUT' }], isError: false }; break;
    case 'ping': result = {}; break;
    default: process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Unsupported fixture method' } }) + '\n'); return;
  }
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\n');
});
