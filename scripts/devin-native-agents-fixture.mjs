// Deterministic native Devin peer. It emits model tool calls but never executes them.
import { appendFile } from 'node:fs/promises';
import { compileRequest } from '../providers/devin/mapping.mjs';

let raw = '';
for await (const chunk of process.stdin) raw += chunk;
const lines = raw.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
const request = lines.find(value => value.type === 'request');
if (!request) throw new Error('missing_request');
// Compile every real engine request through the production provider mapper.
// The deterministic fixture does not contact or execute the vendor provider.
compileRequest({ ...request, credential_scope: 'synthetic-native-agents-fixture-scope' });

let seq = 0;
const emit = frame => process.stdout.write(JSON.stringify({
  protocol_version: 1,
  request_id: request.request_id,
  seq: seq++,
  ...frame,
}) + '\n');
const done = item => emit({ type: 'item_done', item });
const finish = text => {
  done({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] });
  emit({ type: 'completed' });
};

const serialized = JSON.stringify(request);
const inputs = request.input ?? [];
const outputs = inputs.filter(item =>
  item.type === 'function_call_output' || item.type === 'custom_tool_call_output');
const tools = (request.tools ?? []).flatMap(tool => tool.type === 'namespace'
  ? (tool.tools ?? []).map(child => ({ ...child, namespace: tool.name }))
  : [tool]);
const findTool = name => {
  const tool = tools.find(candidate => candidate.name === name);
  if (!tool) throw new Error(`missing_tool_${name}`);
  return tool;
};
const call = (name, callId, args) => {
  const tool = findTool(name);
  done({
    type: 'function_call',
    name: tool.name,
    ...(tool.namespace ? { namespace: tool.namespace } : {}),
    call_id: callId,
    arguments: JSON.stringify(args),
  });
  emit({ type: 'completed' });
};
const outputFor = callId => outputs.find(item => item.call_id === callId);
const isChild = serialized.includes('NATIVE_AGENTS_CHILD_TASK_7391') &&
  !serialized.includes('ROOT_PRIVATE_CONTEXT_MUST_NOT_FORK_7391');
const stage = isChild
  ? !outputFor('child-patch') ? 'child-patch'
    : !outputFor('child-shell') ? 'child-shell' : 'child-finish'
  : !outputFor('root-spawn') ? 'root-spawn'
    : !outputFor('root-wait') ? 'root-wait'
      : !outputFor('root-list') ? 'root-list' : 'root-finish';

if (process.env.AZRAEL_NATIVE_AGENTS_TRACE) {
  await appendFile(process.env.AZRAEL_NATIVE_AGENTS_TRACE, JSON.stringify({
    stage,
    thread_id: request.thread_id,
    model: request.model,
    tool_names: tools.map(tool => `${tool.namespace ? `${tool.namespace}.` : ''}${tool.name}`),
    output_ids: outputs.map(item => item.call_id),
    saw_root_private_marker: serialized.includes('ROOT_PRIVATE_CONTEXT_MUST_NOT_FORK_7391'),
    saw_child_completion: serialized.includes('CHILD_NATIVE_DONE_7391'),
  }) + '\n');
}

emit({ type: 'created' });
if (stage === 'root-spawn') {
  call('spawn_agent', 'root-spawn', {
    task_name: 'native_fixture_child',
    agent_type: 'devin_swe2_medium',
    fork_turns: 'none',
    message: 'NATIVE_AGENTS_CHILD_TASK_7391: create child-native-result.txt with CHILD_PATCH_7391, read it using the native shell tool, then return CHILD_NATIVE_DONE_7391.',
  });
} else if (stage === 'root-wait') {
  const spawnOutput = outputFor('root-spawn');
  if (!spawnOutput || !JSON.stringify(spawnOutput).includes('native_fixture_child')) {
    throw new Error('spawn_result_missing_child');
  }
  call('wait_agent', 'root-wait', { timeout_ms: 60000 });
} else if (stage === 'root-list') {
  call('list_agents', 'root-list', {});
} else if (stage === 'root-finish') {
  const listOutput = JSON.stringify(outputFor('root-list'));
  if (!/native_fixture_child/.test(listOutput) || !/completed/i.test(listOutput)) {
    throw new Error('list_agents_missing_completed_child');
  }
  if (!serialized.includes('CHILD_NATIVE_DONE_7391')) {
    throw new Error('parent_missing_child_completion_message');
  }
  finish('PARENT_NATIVE_AGENTS_DONE_7391');
} else {
  if (serialized.includes('ROOT_PRIVATE_CONTEXT_MUST_NOT_FORK_7391')) {
    throw new Error('fork_none_leaked_parent_context');
  }
  if (stage === 'child-patch') {
    const tool = findTool('apply_patch');
    done({
      type: 'custom_tool_call',
      name: tool.name,
      ...(tool.namespace ? { namespace: tool.namespace } : {}),
      call_id: 'child-patch',
      input: '*** Begin Patch\n*** Add File: child-native-result.txt\n+CHILD_PATCH_7391\n*** End Patch',
    });
    emit({ type: 'completed' });
  } else if (stage === 'child-shell') {
    if (!JSON.stringify(outputFor('child-patch')).includes('Success')) {
      throw new Error('child_patch_result_missing');
    }
    call('exec_command', 'child-shell', {
      cmd: 'Get-Content -LiteralPath child-native-result.txt',
      max_output_tokens: 100,
    });
  } else {
    if (!JSON.stringify(outputFor('child-shell')).includes('CHILD_PATCH_7391')) {
      throw new Error('child_shell_result_missing');
    }
    finish('CHILD_NATIVE_DONE_7391');
  }
}
