import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

export const defaultAccountModelsCatalog = fileURLToPath(
  new URL('../engine/codex-rs/models-manager/models.json', import.meta.url),
);

// Consume this option before positional account-check arguments are inspected.
export async function loadAccountModelsCatalog(arguments_) {
  const indices = arguments_.flatMap((argument, index) => argument === '--models-catalog' ? [index] : []);
  if (indices.length > 1) throw new Error('--models-catalog must not be repeated');
  let path = defaultAccountModelsCatalog;
  if (indices.length) {
    const index = indices[0];
    path = arguments_[index + 1];
    if (!path || path.startsWith('--')) throw new Error('--models-catalog requires an absolute path');
    if (!isAbsolute(path)) throw new Error('--models-catalog requires an absolute path');
    arguments_.splice(index, 2);
  }
  const models = JSON.parse(await readFile(path, 'utf8'));
  if (!models || !Array.isArray(models.models)) throw new Error('Bundled model catalog must contain a models array');
  return { path, models };
}
