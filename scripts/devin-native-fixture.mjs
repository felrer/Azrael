// Deterministic model peer. It never executes a tool: only the engine may do so.
import { access, writeFile } from 'node:fs/promises';
import { compileRequest } from '../providers/devin/mapping.mjs';
let raw = '';
for await (const chunk of process.stdin) raw += chunk;
const [, request] = raw.trim().split('\n').map(JSON.parse);
// Validate the actual native registry/history through the production mapper.
compileRequest(request);
let seq = 0;
const emit = frame => process.stdout.write(JSON.stringify({ protocol_version: 1, request_id: request.request_id, seq: seq++, ...frame }) + '\n');
const user = request.input.filter(item => item.type === 'message' && item.role === 'user').at(-1);
const task = (user?.content ?? []).map(part => part.text ?? '').join('\n');
const mode = task.includes('WORKSPACE') ? 'workspace' : task.includes('MCP') ? 'mcp' : task.includes('DYNAMIC') ? 'dynamic' : task.includes('RESUME') ? 'resume' : task.includes('READONLY') ? 'readonly' : task.includes('APPROVAL') ? 'approval' : task.includes('CANCEL') ? 'cancel' : task.includes('BAD_EOF') ? 'eof' : 'write';
const specs = request.tools.flatMap(tool => tool.type === 'namespace' ? tool.tools.map(child => ({ ...child, namespace: tool.name })) : [tool]);
const selected = name => {
  const tool = specs.find(tool => tool.name === name);
  if (!tool) throw new Error('missing_native_tool_' + name);
  return { name: tool.name, ...(tool.namespace ? { namespace: tool.namespace } : {}) };
};
const done = item => emit({ type: 'item_done', item });
const toolCall = (name, callId, payload) => {
  if (specs.some(tool => tool.name === name)) {
    done(name === 'apply_patch' ? { type: 'custom_tool_call', ...selected(name), call_id: callId, input: payload } :
      { type: 'function_call', ...selected(name), call_id: callId, arguments: JSON.stringify(payload) });
  } else {
    const code = `const result = await tools.${name}(${JSON.stringify(payload)}); text(result);`;
    done({ type: 'custom_tool_call', ...selected('exec'), call_id: callId, input: code });
  }
};
const finish = text => { done({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }); emit({ type: 'completed' }); };
const outputs = request.input.filter(item => item.type === 'function_call_output' || item.type === 'custom_tool_call_output');
emit({ type: 'created' });
emit({ type: 'progress', progress: { phase: 'stream', elapsed_ms: 10,
  network_idle_ms: 1, event_idle_ms: 2, bytes_received: 128,
  event_count: 1, last_event: 'tool_call_args' } });
if (process.env.AZRAEL_NATIVE_FIXTURE_TRACE) await writeFile(process.env.AZRAEL_NATIVE_FIXTURE_TRACE, JSON.stringify({ tools: specs.map(tool => [tool.namespace, tool.name, tool.type]), mode, outputCount: outputs.length }));
if (request.tools.length === 0) {
  finish('COMPACTION_SUMMARY: The user created native-result.txt containing NATIVE_PATCH_7391 and read it through the native shell. Preserve this result and continue normally.');
} else if (mode === 'workspace') {
  if (outputs.length) finish('WORKSPACE_POLICY_RESULT_RECORDED');
  else {
    const path = task.includes('OUTSIDE') ? '../workspace-outside.txt' : 'workspace-inside.txt';
    toolCall('apply_patch', 'workspace-patch', `*** Begin Patch\n*** Add File: ${path}\n+WORKSPACE_CHECK\n*** End Patch`);
    emit({ type: 'completed' });
  }
} else if (mode === 'mcp') {
  const output = outputs.find(item => item.call_id === 'mcp-call');
  if (output) {
    if (!JSON.stringify(output).includes('MCP_RESULT_7391')) throw new Error('wrong_mcp_result');
    finish('MCP_VERIFIED');
  } else {
    const tool = specs.find(tool => `${tool.namespace}.${tool.name}`.includes('native_probe') && tool.name.includes('echo'));
    if (!tool) throw new Error('missing_mcp_tool');
    done({ type: 'function_call', name: tool.name, ...(tool.namespace ? { namespace: tool.namespace } : {}), call_id: 'mcp-call', arguments: '{"text":"probe"}' });
    emit({ type: 'completed' });
  }
} else if (mode === 'dynamic') {
  const output = outputs.find(item => item.call_id === 'dynamic-call');
  if (output) {
    if (!JSON.stringify(output).includes('namespace_b_result')) throw new Error('wrong_namespace_result');
    finish('DYNAMIC_NAMESPACE_VERIFIED');
  } else {
    const tool = specs.find(tool => tool.namespace === 'namespace_b' && tool.name === 'echo');
    if (!tool) throw new Error('missing_dynamic_namespace');
    done({ type: 'function_call', name: tool.name, namespace: tool.namespace, call_id: 'dynamic-call', arguments: '{"value":"chosen_b"}' });
    emit({ type: 'completed' });
  }
} else if (mode === 'resume') {
  if (!outputs.some(item => item.call_id === 'native-patch') || !outputs.some(item => item.call_id === 'native-shell')) throw new Error('resume_missing_results');
  finish('RESUME_PRESERVED_NATIVE_RESULTS');
} else if (mode === 'cancel') {
  setTimeout(() => finish('SHOULD_NOT_FINISH'), 120_000);
} else if (mode === 'eof') {
  toolCall('apply_patch', 'bad-eof', '*** Begin Patch\n*** Add File: bad-eof.txt\n+must-not-exist\n*** End Patch');
} else if (mode === 'approval') {
  if (outputs.length) finish('APPROVAL_RESULT_RECORDED');
  else {
    toolCall('exec_command', 'approval-exec', { cmd: "Set-Content -LiteralPath approved-result.txt -Value APPROVED", sandbox_permissions: 'require_escalated', justification: 'Native fixture approval check', max_output_tokens: 100 });
    emit({ type: 'completed' });
  }
} else if (mode === 'write') {
  if (!outputs.some(item => item.call_id === 'native-patch')) {
    if (process.env.AZRAEL_NATIVE_CATALOG_BARRIER) {
      const barrier = process.env.AZRAEL_NATIVE_CATALOG_BARRIER;
      await writeFile(`${barrier}.ready`, 'ready');
      const deadline = Date.now() + 30_000;
      while (!(await access(barrier).then(() => true).catch(() => false))) {
        if (Date.now() > deadline) throw new Error('catalog_refresh_barrier_timeout');
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
    toolCall('apply_patch', 'native-patch', '*** Begin Patch\n*** Add File: native-result.txt\n+NATIVE_PATCH_7391\n*** End Patch');
    emit({ type: 'completed' });
  } else if (!outputs.some(item => item.call_id === 'native-shell')) {
    toolCall('exec_command', 'native-shell', { cmd: "Get-Content -LiteralPath native-result.txt", max_output_tokens: 100 });
    emit({ type: 'completed' });
  } else {
    if (!JSON.stringify(outputs).includes('NATIVE_PATCH_7391')) throw new Error('shell_result_not_returned');
    finish('NATIVE_TOOLS_VERIFIED');
  }
} else {
  if (outputs.length) finish('POLICY_RESULT_RECORDED');
  else {
    toolCall('apply_patch', 'policy-patch', '*** Begin Patch\n*** Add File: denied-result.txt\n+must-not-exist\n*** End Patch');
    emit({ type: 'completed' });
  }
}
