// Request-only projection: search history never adds callable tools. Keep the
// latest schema for identities absent from the current catalog, including Code
// Mode helpers whose definitions cannot be inferred from top-level wire tools.
export const SEARCH_HISTORY_GUIDANCE = 'Use the current tool catalog and Code Mode instructions for calls. Historical schemas do not grant access to a tool.';

export function projectSearchHistory(input, declared, wireName) {
  const latest = new Map();
  function key(spec, namespace) {
    if (!spec || !['function', 'custom'].includes(spec.type) ||
        typeof spec.name !== 'string' || !spec.name || typeof namespace !== 'string' ||
        /[\x00-\x1f\x7f]/.test(spec.name + namespace)) return undefined;
    return wireName(namespace, spec.name, spec.type);
  }
  function visit(specs, namespace, index) {
    for (const spec of specs) {
      if (spec?.type === 'namespace' && !namespace && typeof spec.name === 'string' && Array.isArray(spec.tools)) {
        visit(spec.tools, spec.name, index);
      } else {
        const name = key(spec, namespace);
        if (name) latest.set(name, index);
      }
    }
  }
  for (const [index, item] of input.entries()) {
    if (item?.type === 'tool_search_output' && item.execution === 'client' &&
        item.status === 'completed' && Array.isArray(item.tools)) visit(item.tools, '', index);
  }
  function project(specs, namespace, index) {
    return specs.map(spec => {
      if (spec?.type === 'namespace' && !namespace && typeof spec.name === 'string' && Array.isArray(spec.tools)) {
        return { ...spec, tools: project(spec.tools, spec.name, index) };
      }
      const name = key(spec, namespace);
      if (!name) return spec;
      if (declared.has(name)) return { name };
      if (latest.get(name) !== index) return { type: spec.type, name: spec.name, schema_reference: 'latest_search_result' };
      return spec;
    });
  }
  return (item, index) => item.status === 'completed'
    ? { status: item.status, tools: project(item.tools, '', index), guidance: SEARCH_HISTORY_GUIDANCE }
    : { status: item.status, tools: item.tools };
}
