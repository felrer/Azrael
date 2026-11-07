'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function readCommittedBuildContext(root) {
  root = fs.realpathSync(root);
  const directory = path.join(root, 'control'), file = path.join(directory, 'committed-source.json');
  if (!fs.existsSync(file)) throw Error('Prepare a commit-bound deployment workspace before building; live working files are not build inputs.');
  if (fs.lstatSync(directory).isSymbolicLink() || fs.lstatSync(file).isSymbolicLink() || !fs.statSync(file).isFile()) throw Error('Committed build context must be a regular owned file');
  const receipt = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (receipt.schema !== 1 || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(receipt.sourceCommit || '') || !/^[a-f0-9]{64}$/.test(receipt.projectSha256 || '')) throw Error('Invalid committed build context');
  const result = spawnSync('git', ['-c', 'core.longpaths=true', '-C', root, 'rev-parse', '--verify', 'HEAD'], { encoding: 'utf8', windowsHide: true });
  if (result.error || result.status !== 0 || result.stdout.trim() !== receipt.sourceCommit) throw Error('Workspace HEAD differs from the selected build commit');
  return { sourceCommit: receipt.sourceCommit, projectSha256: receipt.projectSha256 };
}
if (require.main === module) {
  try { console.log(JSON.stringify(readCommittedBuildContext(process.argv[2]))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { readCommittedBuildContext };
