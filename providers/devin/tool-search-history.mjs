// Request-only projection: search history never adds callable tools. Keep the
// latest schema for identities absent from the current catalog, including Code
// Mode helpers whose definitions cannot be inferred from top-level wire tools.
export const SEARCH_HISTORY_GUIDANCE = 'Use the current tool catalog and Code Mode instructions for calls. Historical schemas do not grant access to a tool.';

export const SEARCH_HISTORY_MAX_SCHEMAS = 8;
export const SEARCH_HISTORY_MAX_BYTES = 64 * 1024;

export function projectSearchHistory(input, declared, wireName, currentEligible) {
  const latest = new Map();
  const namespaces = new Map();
  const bytes = value => new TextEncoder().encode(JSON.stringify(value)).byteLength;
  function key(spec, namespace) {
    if (!spec || !['function', 'custom'].includes(spec.type) ||
        typeof spec.name !== 'string' || !spec.name || typeof namespace !== 'string' ||
        /[\x00-\x1f\x7f]/.test(spec.name + namespace)) return undefined;
    return wireName(namespace, spec.name, spec.type);
  }
  function visit(specs, namespace, index, path = '') {
    for (const [offset, spec] of specs.entries()) {
      const location = `${index}:${path}/${offset}`;
      if (spec?.type === 'namespace' && !namespace && typeof spec.name === 'string' && Array.isArray(spec.tools)) {
        const { tools, ...metadata } = spec;
        namespaces.delete(spec.name);
        namespaces.set(spec.name, { location, metadata });
        visit(spec.tools, spec.name, index, `${path}/${offset}`);
      } else {
        const name = key(spec, namespace);
        if (name) {
          latest.delete(name);
          latest.set(name, { location, spec, namespace });
        }
      }
    }
  }
  for (const [index, item] of input.entries()) {
    if (item?.type === 'tool_search_output' && item.execution === 'client' &&
        item.status === 'completed' && Array.isArray(item.tools)) visit(item.tools, '', index);
  }
  const retained = new Set();
  const retainedNamespaces = new Set();
  const declaredNamespaces = new Set([...latest.entries()]
    .filter(([name]) => declared.has(name)).map(([, entry]) => entry.namespace));
  let usedBytes = 0;
  // Select recent distinct identities before applying the aggregate byte cap.
  // This is request presentation only; eligibility never grants execution access.
  const candidates = [...latest.entries()].reverse().filter(([name]) =>
    !declared.has(name) && (!currentEligible || currentEligible.has(name)))
    .slice(0, SEARCH_HISTORY_MAX_SCHEMAS);
  for (const [name, entry] of candidates) {
    const metadata = entry.namespace && !retainedNamespaces.has(entry.namespace)
      ? namespaces.get(entry.namespace)?.metadata : undefined;
    // Include the wrapper's tools field and separators conservatively so the
    // serialized retained definitions themselves also remain below the cap.
    const cost = bytes(entry.spec) + 1 + (metadata ? bytes({ ...metadata, tools: [] }) : 0);
    if (usedBytes + cost > SEARCH_HISTORY_MAX_BYTES) continue;
    usedBytes += cost;
    retained.add(name);
    if (entry.namespace) retainedNamespaces.add(entry.namespace);
  }
  // Declared schemas already live in the catalog, but their namespace metadata
  // can still be useful. Charge it once against the same presentation budget.
  for (const [namespace, entry] of [...namespaces.entries()].reverse()) {
    if (retainedNamespaces.has(namespace)) continue;
    if (!declaredNamespaces.has(namespace)) continue;
    const cost = bytes({ ...entry.metadata, tools: [] });
    if (usedBytes + cost > SEARCH_HISTORY_MAX_BYTES) continue;
    usedBytes += cost;
    retainedNamespaces.add(namespace);
  }
  function project(specs, namespace, index, path = '') {
    return specs.map((spec, offset) => {
      const location = `${index}:${path}/${offset}`;
      if (spec?.type === 'namespace' && !namespace && typeof spec.name === 'string' && Array.isArray(spec.tools)) {
        const tools = project(spec.tools, spec.name, index, `${path}/${offset}`);
        if (retainedNamespaces.has(spec.name) && namespaces.get(spec.name).location === location) {
          return { ...spec, tools };
        }
        return { type: 'namespace', name: spec.name, tools,
          namespace_reference: retainedNamespaces.has(spec.name)
            ? 'latest_search_result' : 'schema_unavailable_search_again' };
      }
      const name = key(spec, namespace);
      if (!name) return spec;
      if (declared.has(name)) return { name };
      if (!retained.has(name)) return { type: spec.type, name: spec.name, schema_reference: 'schema_unavailable_search_again' };
      if (latest.get(name).location !== location) return { type: spec.type, name: spec.name, schema_reference: 'latest_search_result' };
      return spec;
    });
  }
  return (item, index) => item.status === 'completed'
    ? { status: item.status, tools: project(item.tools, '', index), guidance: SEARCH_HISTORY_GUIDANCE }
    : { status: item.status, tools: item.tools };
}
