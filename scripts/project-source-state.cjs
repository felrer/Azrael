'use strict';
// Optional reuse of the Git input owner's complete content snapshot. Git
// selection is always fresh; observation context is never a semantic input.
const fs = require('node:fs');
const path = require('node:path');
const { snapshotProject, compareSnapshots, inventoryProject } = require('./deployment-input-snapshot.cjs');
const { observe } = require('./engine-source-metadata.cjs');
const { binding, publish, unlinked, hash } = require('./source-observation.cjs');

async function observation(root, context) {
  const { trees } = await inventoryProject(root);
  const selection = trees.map(tree => ({ root: tree.root, paths: tree.entries.map(entry => entry.path) }));
  const paths = selection.flatMap(tree => tree.paths.map(name => path.relative(root, path.resolve(tree.root, name)).replaceAll('\\', '/')));
  // An internal state file must be ignored by every selected Git tree. Never
  // let writing observation state change the source inventory it certifies.
  const state = path.relative(root, context.statePath).replaceAll('\\', '/');
  if (paths.some(name => name === state || state.startsWith(`${name}/`))) throw Error('Selected observation output');
  return hash(JSON.stringify({ selection, metadata: observe(root, [], false, paths) }));
}

async function getProjectSourceState(directory, context) {
  if (!context) return snapshotProject(directory);
  const started = performance.now(), root = path.resolve(directory);
  let key, before;
  try {
    key = hash(JSON.stringify(binding(root, context, ['project-source-state.cjs', 'deployment-input-snapshot.cjs', 'engine-source-metadata.cjs'], true)));
    before = await observation(root, context);
  } catch { return snapshotProject(root); }
  try {
    unlinked(context.statePath);
    const saved = JSON.parse(fs.readFileSync(context.statePath, 'utf8'));
    const snapshot = saved.snapshot;
    if (saved.schema === 1 && saved.binding === key && saved.observation === before &&
        snapshot?.inventory?.[0]?.root === root && Number.isSafeInteger(snapshot.fileCount) && snapshot.fileCount >= 0 &&
        Number.isSafeInteger(snapshot.bytes) && snapshot.bytes >= 0 && saved.snapshotSha256 === hash(JSON.stringify(snapshot))) {
      compareSnapshots(snapshot, snapshot); // The input owner validates recursive inventory digests.
      if (await observation(root, context) === before) {
        try { publish(context.statePath, { ...saved, disposition: 'reused' }); } catch { /* optional cache */ }
        return { ...snapshot, elapsedMs: performance.now() - started };
      }
    }
  } catch { /* Missing, corrupt or uncertain state selects the complete validator. */ }
  const snapshot = await snapshotProject(root);
  try {
    unlinked(root);
    if (await observation(root, context) === before) publish(context.statePath, {
      schema: 1, binding: key, observation: before, snapshot,
      snapshotSha256: hash(JSON.stringify(snapshot)), disposition: 'full',
    });
  } catch { /* A failed observation or publication never authorizes reuse. */ }
  return snapshot;
}

module.exports = { getProjectSourceState };
