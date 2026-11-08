"use strict";

const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const FILE = 'scripts/test-artifact-lifecycle.cjs';
const CORE = new Set([
  'real native producer reservations protect ordinary readers and admit only their private observer',
  'scoped references pin exact members and immutable bindings with independent stable identities',
  'new actual ownership boundaries are exclusive while exact historical ownership updates and dependency sharing survive',
  'failed producer retains its whole pending identity and append-only membership',
  'build producer records all planned members before first output creation fails',
  'selection expands all sibling outputs and native projection keeps disjoint roots',
  'shared member protection, report destinations and active consumers protect whole groups',
  'native projection protects dependencies from inbound consumers without protecting consumers from outbound dependencies',
  'native projection marks logs and reports for evidence-last deletion ordering',
  'source, management, traversal and linked paths cannot become lifecycle ownership',
  'finalization removes only own registry after every recorded member is actually absent',
  'known failure releases execution references while persistent and untyped references require explicit release',
  'unknown terminal outcome remains protected; closure cannot promote legacy ownership flags',
  'closure and release reject stale revisions, unverifiable stops and invalid evidence before mutation',
  'catalog lock serializes mutations, and reference registration preserves external and planned targets',
]);
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const skipPattern = omitted => omitted.length ? `^(?:${omitted.map(item => escape(item.test)).join('|')})$` : '';

function caseNames(root) {
  // Parse declarations without importing tests or executing fixture setup.
  const ts = require(require.resolve('typescript', { paths: [path.join(ROOT, 'extensions/azrael-ex')] }));
  const filename = path.join(root, FILE);
  const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true);
  return source.statements.filter(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'test' &&
    node.expression.arguments.length > 0 && ts.isStringLiteralLike(node.expression.arguments[0])).map(node => node.expression.arguments[0].text);
}
function family(name) {
  if (/^(physical custody |completed physical custody )/.test(name)) return 'relocation';
  if (/^(custody |frozen legacy custody |legacy custody )/.test(name)) return 'custody';
  if (/^(observation |overlapping historical custodians |resolved observation )/.test(name)) return 'observations';
  if (/^cleanup recovery /.test(name)) return 'recovery';
  if (/^(explicit retirement |CLI retirement )/.test(name)) return 'retirement';
  if (/^(CLI cache |shared producer generation )/.test(name)) return 'cache';
  if (/^(catalog snapshots |catalog pass |native projection declares )/.test(name)) return 'catalog';
  if (/^(Windows lifecycle |PowerShell deletion |legacy candidates )/.test(name)) return 'windows';
  if (/^durable cleanup reservations /.test(name)) return 'reservations';
  return null; // A new/unclassified case remains selected.
}
function planLifecycleTests({ changedPaths = [], root = ROOT, exhaustive = false } = {}) {
  if (!Array.isArray(changedPaths) || changedPaths.some(file => typeof file !== 'string' || !file ||
      path.isAbsolute(file) || /^[A-Za-z]:[\\/]/.test(file) || file.replace(/\\/g, '/').split('/').includes('..')))
    throw Error('Invalid lifecycle changed paths');
  const changed = changedPaths.map(file => file.replace(/\\/g, '/').replace(/^\.\//, ''));
  const names = caseNames(root);
  for (const name of CORE) if (!names.includes(name)) throw Error(`Missing core lifecycle case: ${name}`);
  const all = exhaustive || changed.some(file => [FILE, 'scripts/lifecycle-test-policy.cjs',
    'scripts/source-test-policy.cjs', 'scripts/source-check-selection.cjs', 'scripts/source-preflight-reuse.cjs',
    'scripts/check-artifact-lifecycle.cjs', 'scripts/artifact-lifecycle.cjs',
    'scripts/directory-state.cjs', 'package.json', 'package-lock.json'].includes(file) ||
    /^scripts\/maintenance-(?:lock-|owner-)/.test(file) || /^engine\/codex-rs\/project-maintenance\//.test(file));
  const affected = new Set();
  for (const file of changed) {
    if (/artifact-observations/.test(file)) for (const value of ['observations', 'custody', 'relocation']) affected.add(value);
    if (/artifact-lifecycle\.ps1$|(?:test-)?clean-.*\.ps1$/.test(file))
      for (const value of ['windows', 'reservations', 'retirement']) affected.add(value);
    if (/deployment-control-retirement|cleanup-recovery/.test(file))
      for (const value of ['retirement', 'recovery']) affected.add(value);
    if (/module-cache|window-control-cache/.test(file)) for (const value of ['cache', 'retirement', 'windows']) affected.add(value);
  }
  const omitted = names.filter(name => !all && !CORE.has(name) && family(name) && !affected.has(family(name)))
    .map(test => ({ file: FILE, test, reason: 'Unrelated lifecycle scope' }));
  const excluded = new Set(omitted.map(item => item.test));
  return { selected: names.filter(name => !excluded.has(name)), omitted, skipPattern: skipPattern(omitted) };
}

module.exports = { FILE, CORE, planLifecycleTests, skipPattern };
