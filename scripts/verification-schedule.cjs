'use strict';

// This order is the existing Cargo locality preference. It never combines
// commands: a shared-command group is the smallest schedulable unit.
function localityOrder(groups) {
  const batches = new Map(), remaining = [];
  for (const group of groups) {
    const labels = group.entries.map(entry => entry.check.cargoScheduleGroup);
    const label = labels[0];
    if (!label || labels.some(value => value !== label)) { remaining.push(group); continue; }
    if (!batches.has(label)) batches.set(label, []);
    batches.get(label).push(group);
  }
  return [...batches.values()].flat().concat(remaining);
}

function planVerificationSchedule(groups, { priorities = {}, dependencies = {}, estimatedDurationMs = {} } = {}) {
  const owners = new Map();
  const nodes = groups.map((group, originalIndex) => {
    const checkIds = [...new Set([group.check.id, ...group.entries.map(entry => entry.check.id)])];
    const node = { group, originalIndex, checkIds, prerequisites: new Set() };
    for (const id of checkIds) {
      if (typeof id !== 'string' || !id || owners.has(id)) throw Error(`Duplicate or invalid verification check ID: ${id}`);
      owners.set(id, node);
    }
    return node;
  });
  for (const [name, values] of Object.entries({ priorities, dependencies, estimatedDurationMs })) {
    if (!values || typeof values !== 'object' || Array.isArray(values)) throw Error(`Invalid verification ${name}`);
    for (const id of Object.keys(values)) {
      if (!owners.has(id)) throw Error(`Unknown verification check ID in ${name}: ${id}`);
      if (name === 'dependencies') {
        if (!Array.isArray(values[id]) || values[id].some(dep => !owners.has(dep))) throw Error(`Unknown or invalid verification dependency: ${id}`);
      } else if (!Number.isFinite(values[id]) || (name === 'estimatedDurationMs' && values[id] < 0)) {
        throw Error(`Invalid verification ${name}: ${id}`);
      }
    }
  }
  const prerequisitesFor = id => Object.hasOwn(dependencies, id) ? dependencies[id] : [];
  // Reject cycles in the declared graph even when its IDs share one command.
  const visiting = new Set(), visited = new Set();
  function visit(id) {
    if (visiting.has(id)) throw Error(`Verification dependency cycle: ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dep of prerequisitesFor(id)) visit(dep);
    visiting.delete(id); visited.add(id);
  }
  for (const id of owners.keys()) visit(id);
  const ranks = new Map(localityOrder(groups).map((group, index) => [group, index]));
  for (const node of nodes) {
    const explicitPriorities = node.checkIds.filter(id => Object.hasOwn(priorities, id)).map(id => priorities[id]);
    node.priority = explicitPriorities.length ? Math.max(...explicitPriorities) : 0;
    const estimates = node.checkIds.filter(id => Object.hasOwn(estimatedDurationMs, id)).map(id => estimatedDurationMs[id]);
    node.duration = estimates.length ? Math.max(...estimates) : Infinity;
    for (const id of node.checkIds) for (const dep of prerequisitesFor(id)) {
      const owner = owners.get(dep);
      if (owner !== node) node.prerequisites.add(owner);
    }
  }
  const pending = new Set(nodes), completed = new Set(), ordered = [], steps = [];
  while (pending.size) {
    const ready = [...pending].filter(node => [...node.prerequisites].every(dep => completed.has(dep)));
    ready.sort((a, b) => b.priority - a.priority || a.duration - b.duration || ranks.get(a.group) - ranks.get(b.group));
    const selected = ready[0];
    if (!selected) throw Error('Verification dependency cycle between shared-command groups');
    pending.delete(selected); completed.add(selected); ordered.push(selected.group);
    steps.push({ checkIds: [...selected.checkIds], originalIndex: selected.originalIndex,
      priority: selected.priority, estimatedDurationMs: Number.isFinite(selected.duration) ? selected.duration : null,
      dependencies: [...new Set(selected.checkIds.flatMap(prerequisitesFor))],
      reason: 'dependencies satisfied; priority descending, estimated duration ascending, stable Cargo locality order' });
  }
  return { groups: ordered, steps };
}

function scheduleVerificationGroups(groups, options) { return planVerificationSchedule(groups, options).groups; }

module.exports = { scheduleVerificationGroups, planVerificationSchedule };
