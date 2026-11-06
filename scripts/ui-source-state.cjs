'use strict';

// Optional, attempt-local observation reuse. The directory content identity and
// the full validator remain owned by directory-state.cjs.
const fs = require('node:fs');
const { getDirectoryState } = require('./directory-state.cjs');
const { observe } = require('./engine-source-metadata.cjs');
const { binding: observationBinding, publish, unlinked, hash } = require('./source-observation.cjs');

function binding(root, context) {
  return observationBinding(root, context, ['ui-source-state.cjs', 'directory-state.cjs', 'engine-source-metadata.cjs']);
}

async function getUiSourceState(root, context) {
  if (!context) return getDirectoryState(root);
  let selected, before;
  try { selected = binding(root, context); before = observe(root, [], true); }
  catch { return getDirectoryState(root); }
  const key = hash(JSON.stringify(selected));
  try {
    const saved = JSON.parse(fs.readFileSync(context.statePath, 'utf8'));
    const state = saved.directory;
    if (saved.schema === 1 && saved.binding === key && saved.inventory === before.inventory &&
        state?.path === root && /^[a-f0-9]{64}$/.test(state.sha256) &&
        Number.isSafeInteger(state.fileCount) && state.fileCount >= 0 && Number.isSafeInteger(state.bytes) && state.bytes >= 0 &&
        saved.directorySha256 === hash(JSON.stringify({ directory: state, sharedDirectory: saved.sharedDirectory }))) {
      // Shared files can be edited through another path. Hash their contents on
      // every use rather than trusting their observation alone. Reuse the same
      // validator/ordering contract for this explicitly selected subset.
      const sharedDirectory = before.sharedPaths.length ? await getDirectoryState(root, before.sharedPaths) : null;
      const after = observe(root, [], true);
      if (JSON.stringify(sharedDirectory) === JSON.stringify(saved.sharedDirectory) && after.inventory === before.inventory) {
        // Diagnostics stay outside the semantic source identity/checkpoint.
        try { publish(context.statePath, { ...saved, disposition: 'reused' }); } catch { /* optional cache */ }
        return state;
      }
    }
  } catch { /* Missing/corrupt observations select the complete validator. */ }
  const directory = await getDirectoryState(root);
  try {
    unlinked(root);
    const sharedDirectory = before.sharedPaths.length ? await getDirectoryState(root, before.sharedPaths) : null;
    const after = observe(root, [], true);
    if (after.inventory === before.inventory) publish(context.statePath, {
      schema: 1, binding: key, inventory: after.inventory, directory,
      sharedDirectory, directorySha256: hash(JSON.stringify({ directory, sharedDirectory })), disposition: 'full',
    });
  } catch { /* Uncertain metadata or unwritable state cannot grant reuse. */ }
  return directory;
}

module.exports = { getUiSourceState };
