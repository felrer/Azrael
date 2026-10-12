import { createHash } from 'node:crypto';

// Numeric, bounded evidence only. No request text or credential is retained.
const categories = ['instructions', 'conversation', 'tool_definitions', 'tool_results', 'tool_calls', 'reasoning'];
export function createContextDiagnostics(model, estimate = text => Math.ceil(Buffer.byteLength(text) / 4), method = 'utf8_bytes') {
  let data, supported = true;
  const reset = projection => {
    supported = true;
    data = { schema_version: 1, estimate_method: method, projection,
      model_sha256: createHash('sha256').update(model).digest('hex'),
      components: Object.fromEntries(categories.map(key => [key, { bytes: 0, tokens: 0, count: 0 }])),
      image_count: 0, image_bytes: 0, text_estimate_tokens: 0 };
  };
  const add = (key, value) => {
    if (value === undefined || value === null || value === '') return;
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    const component = data.components[key];
    component.bytes += Buffer.byteLength(text);
    component.tokens += estimate(text, model);
    component.count++;
  };
  const image = value => {
    data.image_count++; supported = false;
    if (typeof value === 'string') data.image_bytes += Buffer.byteLength(value);
  };
  function parts(content, category) {
    if (typeof content === 'string') { add(category, content); return; }
    for (const part of content ?? []) {
      if (typeof part === 'string') add(category, part);
      else if (part.type === 'text' || typeof part.text === 'string') add(category, part.text);
      else if (['image', 'image_url', 'input_image'].includes(part.type)) image(part.source?.data ?? part.base64Data ?? part.imageUrl ?? part.image_url?.url);
      else if (part.type === 'tool_use') add('tool_calls', { name: part.name, input: part.input });
      else if (part.type === 'tool_result') parts(part.content, 'tool_results');
      else if (part.type === 'thinking') add('reasoning', part.thinking);
      else { supported = false; }
    }
  }
  function compiled(input) {
    reset('compiled');
    for (const tool of input.tools ?? []) add('tool_definitions', tool);
    for (const message of input.messages ?? []) {
      const category = message.role === 'system' ? 'instructions' : message.role === 'tool' ? 'tool_results' : 'conversation';
      parts(message.content, category);
      for (const call of message.tool_calls ?? []) add('tool_calls', { name: call.name, arguments: call.arguments });
      add('reasoning', message.thinking);
    }
  }
  function wire(body) {
    reset('wire');
    data.wire_bytes = Buffer.byteLength(typeof body === 'string' ? body : JSON.stringify(body));
    const root = typeof body === 'string' ? JSON.parse(body) : body;
    const input = root.request ?? root;
    if (Array.isArray(input.messages)) {
      parts(input.system, 'instructions');
      for (const tool of input.tools ?? []) add('tool_definitions', tool);
      for (const message of input.messages) {
        parts(message.content, message.role === 'system' ? 'instructions' : message.role === 'tool' ? 'tool_results' : 'conversation');
        for (const call of message.tool_calls ?? []) add('tool_calls', call.function ?? call);
      }
    } else if (Array.isArray(input.contents)) {
      for (const part of input.systemInstruction?.parts ?? []) add('instructions', part.text);
      for (const tool of input.tools ?? []) add('tool_definitions', tool);
      for (const content of input.contents) for (const part of content.parts ?? []) {
        if (part.inlineData || part.fileData) image(part.inlineData?.data ?? part.fileData?.fileUri);
        else if (part.functionCall) add('tool_calls', part.functionCall);
        else if (part.functionResponse) add('tool_results', part.functionResponse.response);
        else if (typeof part.text === 'string') add(part.thought ? 'reasoning' : 'conversation', part.text);
        else supported = false;
      }
    } else supported = false;
  }
  const snapshot = () => {
    if (!data) return undefined;
    data.text_estimate_tokens = Object.values(data.components).reduce((sum, part) => sum + part.tokens, 0);
    return structuredClone(data);
  };
  return { compiled, wire, snapshot,
    budget() {
      const evidence = snapshot();
      return { supported, input_tokens: evidence.text_estimate_tokens, diagnostics: evidence };
    },
    usage(usage) {
      if (!data || !Number.isSafeInteger(usage?.input_tokens) || usage.input_tokens < 0) return;
      data.reported_input_tokens = usage.input_tokens;
      data.reported_input_estimated = usage.estimated === true;
      delete data.residual_tokens;
      if (!data.reported_input_estimated) data.residual_tokens = usage.input_tokens - snapshot().text_estimate_tokens;
    },
  };
}
