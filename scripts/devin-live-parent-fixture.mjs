import { createServer } from 'node:http';

const MAX_REQUEST_BYTES = 1024 * 1024;
const SPAWN_CALL_ID = 'scripted-parent-spawn-call';
const FOLLOWUP_CALL_ID = 'scripted-parent-followup-call';

const SPAWN_ARGUMENTS = {
  task_name: 'live_swe_work',
  agent_type: 'devin_swe2_medium',
  fork_turns: 'none',
  message:
    'This is approved fixture implementation. In the current fixture directory, read only fixture input.txt, create or update only fixture value.txt to contain exactly one, explicitly use PowerShell execution to run node check-value.cjs one, then reply exactly CHILD_EDIT_OK.',
};

const FOLLOWUP_MESSAGE =
  'Continue the approved fixture implementation. Update only fixture value.txt to contain exactly two, explicitly use PowerShell execution to run node check-value.cjs two, then reply exactly CHILD_FOLLOWUP_OK.';

function sse(events) {
  return events
    .map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    .join('');
}

function responseCreated(id) {
  return { type: 'response.created', response: { id } };
}

function responseCompleted(id) {
  return {
    type: 'response.completed',
    response: {
      id,
      usage: {
        input_tokens: 0,
        input_tokens_details: null,
        output_tokens: 0,
        output_tokens_details: null,
        total_tokens: 0,
      },
    },
  };
}

function functionCallEvents(responseId, callId, name, arguments_) {
  return [
    responseCreated(responseId),
    {
      type: 'response.output_item.done',
      item: {
        type: 'function_call',
        call_id: callId,
        namespace: 'azrael_agents',
        name,
        arguments: JSON.stringify(arguments_),
      },
    },
    responseCompleted(responseId),
  ];
}

function assistantEvents(responseId, messageId, text) {
  return [
    responseCreated(responseId),
    {
      type: 'response.output_item.done',
      item: {
        type: 'message',
        role: 'assistant',
        id: messageId,
        content: [{ type: 'output_text', text }],
      },
    },
    responseCompleted(responseId),
  ];
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  let exceeded = false;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_REQUEST_BYTES) {
      exceeded = true;
      continue;
    }
    chunks.push(chunk);
  }
  if (exceeded) {
    throw new Error(`Responses request exceeded ${MAX_REQUEST_BYTES} bytes`);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error('Responses request body was not valid JSON');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('Responses request body must be a JSON object');
  }
  return body;
}

function inputItems(body) {
  if (!Array.isArray(body.input)) {
    throw new Error('Responses request omitted the input array');
  }
  return body.input;
}

function parseOutput(item, label) {
  if (typeof item.output !== 'string') {
    throw new Error(`${label} function_call_output omitted its string output`);
  }
  try {
    return JSON.parse(item.output);
  } catch {
    throw new Error(`${label} function_call_output was not valid JSON`);
  }
}

function assertNoReportedError(body, items) {
  if (body.error != null) {
    throw new Error(`Responses request reported an error: ${JSON.stringify(body.error)}`);
  }
  for (const item of items) {
    if (item?.type === 'function_call_output' && item.error != null) {
      throw new Error(
        `function_call_output ${String(item.call_id)} reported an error: ${JSON.stringify(item.error)}`,
      );
    }
  }
}

function assertExpectedToolHistory(items, stage) {
  const allowedCalls = new Map([
    [SPAWN_CALL_ID, 'spawn_agent'],
    [FOLLOWUP_CALL_ID, 'followup_task'],
  ]);
  for (const item of items) {
    if (item?.type === 'function_call') {
      const expectedName = allowedCalls.get(item.call_id);
      if (item.namespace !== 'azrael_agents' || item.name !== expectedName) {
        throw new Error(
          `request ${stage} contained an unexpected function_call: ${String(item.namespace)}.${String(item.name)} (${String(item.call_id)})`,
        );
      }
    } else if (item?.type === 'function_call_output' && !allowedCalls.has(item.call_id)) {
      throw new Error(
        `request ${stage} contained an unexpected function_call_output: ${String(item.call_id)}`,
      );
    }
  }
}

function matchingOutput(items, callId, label) {
  const matches = items.filter(
    item => item?.type === 'function_call_output' && item.call_id === callId,
  );
  if (matches.length !== 1) {
    throw new Error(`request must include exactly one ${label} function_call_output`);
  }
  return matches[0];
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function sendJsonError(response, error) {
  if (response.headersSent) {
    response.end();
    return;
  }
  response.writeHead(500, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ error: errorMessage(error) }));
}

export async function startScriptedParent({ waitForChild } = {}) {
  if (typeof waitForChild !== 'function') {
    throw new TypeError('startScriptedParent requires a waitForChild callback');
  }

  const bodies = [];
  let successfulResponses = 0;
  let requestInProgress = false;
  let spawnedTaskName;

  const server = createServer((request, response) => {
    void (async () => {
      if (!request.url?.endsWith('/responses')) {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end('{}');
        return;
      }
      if (requestInProgress) {
        throw new Error('concurrent Responses requests are not supported by this fixture');
      }
      if (successfulResponses >= 3) {
        throw new Error('scripted parent received more than three Responses requests');
      }

      requestInProgress = true;
      try {
        const body = await readJsonBody(request);
        bodies.push(body);
        const items = inputItems(body);
        const stage = successfulResponses + 1;
        assertNoReportedError(body, items);
        assertExpectedToolHistory(items, stage);

        let events;
        if (stage === 1) {
          if (items.some(item => item?.type === 'function_call_output')) {
            throw new Error('first Responses request unexpectedly contained a function_call_output');
          }
          events = functionCallEvents(
            'scripted-parent-spawn-response',
            SPAWN_CALL_ID,
            'spawn_agent',
            SPAWN_ARGUMENTS,
          );
        } else if (stage === 2) {
          const spawnOutputItem = matchingOutput(items, SPAWN_CALL_ID, 'spawn_agent');
          const spawnOutput = parseOutput(spawnOutputItem, 'spawn_agent');
          if (
            !spawnOutput ||
            typeof spawnOutput !== 'object' ||
            typeof spawnOutput.task_name !== 'string' ||
            !spawnOutput.task_name.endsWith('/live_swe_work')
          ) {
            throw new Error('spawn_agent output omitted the canonical /live_swe_work task name');
          }
          spawnedTaskName = spawnOutput.task_name;
          await waitForChild(1);
          events = functionCallEvents(
            'scripted-parent-followup-response',
            FOLLOWUP_CALL_ID,
            'followup_task',
            { target: spawnedTaskName, message: FOLLOWUP_MESSAGE },
          );
        } else {
          matchingOutput(items, FOLLOWUP_CALL_ID, 'followup_task');
          await waitForChild(2);
          events = assistantEvents(
            'scripted-parent-final-response',
            'scripted-parent-final-message',
            'ROOT_WORK_DONE',
          );
        }

        successfulResponses += 1;
        response.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
        });
        response.end(sse(events));
      } finally {
        requestInProgress = false;
      }
    })().catch(error => sendJsonError(response, error));
  });

  await new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolvePromise);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    await new Promise(resolvePromise => server.close(resolvePromise));
    throw new Error('scripted parent server did not bind a TCP address');
  }
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    bodies,
  };
}
