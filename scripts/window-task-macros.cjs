'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const KEYS = Object.freeze(['Return', 'Tab', 'Escape', 'BackSpace', 'Delete', 'Left', 'Right', 'Up', 'Down', 'Home', 'End', 'PageUp', 'PageDown', 'space']);
const ACTIONS = ['invoke', 'set_value', 'toggle', 'select', 'expand', 'collapse', 'scroll', 'press_key', 'wait_for', 'assert', 'capture'];
const PROPERTIES = ['exists', 'enabled', 'value', 'selected', 'toggleState', 'expandState'];
const BOOLEAN_PROPERTIES = ['exists', 'enabled', 'selected'];
const STORAGE_MAX_BYTES = 1024 * 1024;
const TIMEOUT_ERROR = 'Task time limit exceeded; mutation outcome may be unknown';
const fail = message => { throw new Error(message); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);

function shape(value, allowed, required = []) {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(value, key))) {
    fail('Invalid task definition');
  }
}

function string(value) {
  if (typeof value !== 'string' || !value.length || value.length > 256 || /[\x00-\x1f]/.test(value)) fail('Invalid task string');
}

function selector(value, ancestor = true) {
  shape(value, ancestor ? ['name', 'automationId', 'controlType', 'ancestor'] : ['name', 'automationId', 'controlType']);
  if (!Object.hasOwn(value, 'name') && !Object.hasOwn(value, 'automationId')) fail('Exact name or automationId selector required');
  for (const key of ['name', 'automationId', 'controlType']) {
    if (Object.hasOwn(value, key)) string(value[key]);
  }
  if (value.ancestor) selector(value.ancestor, false);
}

function parameter(value, names) {
  shape(value, ['parameter'], ['parameter']);
  if (!names.includes(value.parameter)) fail('Unknown task parameter');
}

function condition(value, names) {
  shape(value, ['selector', 'property', 'equals'], ['selector', 'property', 'equals']);
  selector(value.selector);
  if (!PROPERTIES.includes(value.property)) fail('Invalid condition property');
  if (object(value.equals)) {
    if (BOOLEAN_PROPERTIES.includes(value.property)) fail('Boolean conditions require literal booleans');
    parameter(value.equals, names);
  } else if (BOOLEAN_PROPERTIES.includes(value.property)) {
    if (typeof value.equals !== 'boolean') fail('Invalid condition value');
  } else if (value.property === 'toggleState') {
    if (!['off', 'on', 'indeterminate'].includes(value.equals)) fail('Invalid toggle state');
  } else if (value.property === 'expandState') {
    if (!['collapsed', 'expanded', 'partial', 'leaf'].includes(value.equals)) fail('Invalid expand state');
  } else if (typeof value.equals !== 'string' || value.equals.length > 32768) {
    fail('Invalid condition value');
  }
}

function definition(input, saved = false) {
  shape(input, ['schema', 'id', 'name', 'parameters', 'steps'], ['schema', 'steps', ...(saved ? ['id', 'name'] : [])]);
  if (input.schema !== 1) fail('Unsupported task schema');
  for (const key of ['id', 'name']) {
    if (Object.hasOwn(input, key)) string(input[key]);
  }
  const names = input.parameters || [];
  if (!Array.isArray(names) || names.length > 32 || new Set(names).size !== names.length) fail('Invalid parameters');
  names.forEach(string);
  if (!Array.isArray(input.steps) || !input.steps.length || input.steps.length > 32) fail('Tasks require 1 to 32 steps');

  for (const step of input.steps) {
    shape(step, ['action', 'selector', 'value', 'key', 'condition', 'postcondition', 'timeoutMs'], ['action']);
    if (!ACTIONS.includes(step.action)) fail('Invalid task action');
    const mutation = !['wait_for', 'assert', 'capture'].includes(step.action);
    if (mutation) selector(step.selector);
    else if (step.selector !== undefined) fail('Unexpected task selector');
    if (['wait_for', 'assert'].includes(step.action)) condition(step.condition, names);
    else if (step.condition !== undefined) fail('Unexpected condition');
    if (step.postcondition !== undefined) condition(step.postcondition, names);

    if (step.action === 'press_key') {
      if (!KEYS.includes(step.key) || !step.postcondition) fail('Key requires supported key and explicit postcondition');
    } else if (step.key !== undefined) fail('Unexpected key');

    if (step.action === 'set_value') {
      if (object(step.value)) parameter(step.value, names);
      else if (typeof step.value !== 'string' || step.value.length > 32768) fail('Invalid task value');
    } else if (step.action === 'scroll') {
      shape(step.value, ['horizontal', 'vertical'], ['horizontal', 'vertical']);
      if ([step.value.horizontal, step.value.vertical].some(value => !Number.isInteger(value) || value < -2 || value > 2)) fail('Invalid scroll value');
    } else if (step.value !== undefined) fail('Unexpected task value');

    if (step.timeoutMs !== undefined && (step.action !== 'wait_for' || !Number.isInteger(step.timeoutMs) || step.timeoutMs < 0 || step.timeoutMs > 10000)) {
      fail('Wait limit is 10000 ms');
    }
  }
  return JSON.parse(JSON.stringify({ ...input, parameters: names }));
}

function matches(element, selected) {
  return ['name', 'automationId', 'controlType'].every(key => !Object.hasOwn(selected, key) || element[key] === selected[key]);
}

function resolve(elements, selected, optional = false) {
  const byId = new Map(elements.map(element => [element.id, element]));
  const found = elements.filter(element => {
    if (!matches(element, selected)) return false;
    if (!selected.ancestor) return true;
    let parentId = element.parentId;
    const seen = new Set();
    while (parentId && !seen.has(parentId)) {
      seen.add(parentId);
      const parent = byId.get(parentId);
      if (!parent) break;
      if (matches(parent, selected.ancestor)) return true;
      parentId = parent.parentId;
    }
    return false;
  });
  if (found.length > 1) fail('Ambiguous task selector');
  if (!found.length && !optional) fail('Task selector missing');
  return found[0];
}

function evaluate(elements, expectedState, values) {
  const element = resolve(elements, expectedState.selector, true);
  if (expectedState.property === 'exists') return Boolean(element) === expectedState.equals;
  if (!element) return false;
  if (!Object.hasOwn(element, expectedState.property)) fail('Condition property unsupported');
  const expected = object(expectedState.equals) ? values[expectedState.equals.parameter] : expectedState.equals;
  return element[expectedState.property] === expected;
}

function createStore(home) {
  const file = path.join(home, 'azrael', 'computer-use', 'window-task-macros.json');

  async function read() {
    let raw;
    try {
      raw = await fs.readFile(file, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return { schema: 1, revision: 0, macros: [] };
      throw error;
    }
    if (Buffer.byteLength(raw, 'utf8') > STORAGE_MAX_BYTES) fail('Task storage corrupt');
    const stored = JSON.parse(raw);
    shape(stored, ['schema', 'revision', 'macros'], ['schema', 'revision', 'macros']);
    if (stored.schema !== 1 || !Number.isSafeInteger(stored.revision) || stored.revision < 0 || !Array.isArray(stored.macros) || stored.macros.length > 100) {
      fail('Task storage corrupt');
    }
    stored.macros = stored.macros.map(entry => definition(entry, true));
    if (new Set(stored.macros.map(entry => entry.id)).size !== stored.macros.length) fail('Task storage corrupt');
    return stored;
  }

  async function save(input) {
    const checked = definition(input, true);
    await fs.mkdir(path.dirname(file), { recursive: true });
    let lock;
    try {
      lock = await fs.open(file + '.lock', 'wx');
    } catch (error) {
      if (error.code === 'EEXIST') fail('Task storage busy');
      throw error;
    }
    const temp = file + '.' + randomUUID() + '.tmp';
    try {
      const stored = await read();
      stored.macros = stored.macros.filter(entry => entry.id !== checked.id).concat(checked);
      if (stored.macros.length > 100) fail('Too many tasks');
      if (stored.revision === Number.MAX_SAFE_INTEGER) fail('Task storage revision exhausted');
      stored.revision++;
      const serialized = JSON.stringify(stored);
      if (Buffer.byteLength(serialized, 'utf8') > STORAGE_MAX_BYTES) fail('Task storage size limit exceeded');
      await fs.writeFile(temp, serialized, { flag: 'wx', mode: 0o600 });
      await fs.rename(temp, file);
      return { revision: stored.revision, definition: checked };
    } finally {
      try {
        await fs.unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; });
      } finally {
        await lock.close();
        await fs.unlink(file + '.lock');
      }
    }
  }
  return { read, save, file };
}

async function run(input, parameters, io) {
  const task = definition(input);
  const values = parameters || {};
  shape(values, task.parameters, task.parameters);
  for (const value of Object.values(values)) {
    if (typeof value !== 'string' || value.length > 32768) fail('Invalid execution parameter');
  }
  const runId = randomUUID();
  const outcomes = [];
  const deadline = Date.now() + 20000;
  let finalObservation;

  async function bounded(operation) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      io.cancel?.();
      fail(TIMEOUT_ERROR);
    }
    let timer;
    try {
      return await Promise.race([
        Promise.resolve().then(operation),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            io.cancel?.();
            reject(new Error(TIMEOUT_ERROR));
          }, remaining);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function check() {
    await bounded(() => io.guard());
  }

  async function inspect() {
    await check();
    const observation = await bounded(() => io.inspect());
    await check();
    if (observation.elementsTruncated !== false) fail('Task requires a complete accessibility observation');
    return observation;
  }

  async function capture() {
    // Clear earlier images before attempting a replacement that may fail.
    finalObservation = undefined;
    const observation = await bounded(() => io.capture());
    await check();
    finalObservation = observation;
  }

  async function waitFor(step) {
    const waitMs = step.action === 'wait_for' ? step.timeoutMs ?? 10000 : 0;
    const until = Math.min(deadline, Date.now() + waitMs);
    for (;;) {
      const observation = await inspect();
      if (evaluate(observation.elements, step.condition, values)) return;
      if (Date.now() >= until) fail('Task condition not met');
      await check();
      await new Promise(resolveWait => setTimeout(resolveWait, Math.min(100, Math.max(1, until - Date.now()))));
      await check();
    }
  }

  async function act(step) {
    const observation = await inspect();
    const element = resolve(observation.elements, step.selector);
    if (element.isPassword) fail('Password control excluded');
    await check();
    // Native failure can follow partial mutation. The earlier frame cannot be final.
    finalObservation = undefined;
    const action = step.action === 'set_value' ? 'setValue' : step.action === 'press_key' ? 'pressKey' : step.action;
    const args = { observationId: observation.observationId, elementId: element.id, action };
    if (step.value !== undefined) {
      args.value = object(step.value) && Object.hasOwn(step.value, 'parameter') ? values[step.value.parameter] : step.value;
    }
    if (step.key) args.value = step.key;
    await bounded(() => io.act(args));
    await check();
  }

  try {
    for (let index = 0; index < task.steps.length; index++) {
      const step = task.steps[index];
      await check();
      try {
        if (step.action === 'capture') await capture();
        else if (step.action === 'wait_for' || step.action === 'assert') await waitFor(step);
        else await act(step);
        if (step.postcondition && !evaluate((await inspect()).elements, step.postcondition, values)) fail('Task postcondition not met');
        outcomes.push({ index, action: step.action, status: 'completed' });
      } catch (error) {
        outcomes.push({ index, action: step.action, status: 'failed' });
        throw error;
      }
    }
    await check();
    if (!finalObservation) await capture();
    await check();
    return { runId, status: 'completed', steps: outcomes, finalObservation };
  } catch (error) {
    // A failure capture is current only if it succeeds under the same guard.
    finalObservation = undefined;
    try {
      await check();
      await capture();
    } catch {}
    const known = [
      'Ambiguous task selector', 'Task selector missing', 'Condition property unsupported',
      'Task condition not met', 'Task postcondition not met', TIMEOUT_ERROR,
      'Task requires a complete accessibility observation',
      'Password control excluded', 'Operation cancelled', 'Application authorization revoked',
    ];
    return {
      runId,
      status: 'failed',
      steps: outcomes,
      error: known.includes(error.message) ? error.message : 'Task operation failed; mutation outcome may be unknown',
      ...(finalObservation ? { finalObservation } : {}),
    };
  }
}
module.exports = { KEYS, definition, resolve, evaluate, createStore, run };
