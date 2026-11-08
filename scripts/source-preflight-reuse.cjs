'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const gate = require('./feature-preservation.cjs');
const digest = filename => createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
const physical = filename => {
  const value = fs.realpathSync(filename);
  return process.platform === 'win32' ? value.toLowerCase() : value;
};

// Scheduling changes execution parallelism, but filters and unknown options
// cannot establish that every test in a file ran.
function completeTestArgs(args) {
  if (args[0] !== '--test') return null;
  const files = [];
  let concurrency = false;
  for (const arg of args.slice(1)) {
    if (/^--test-concurrency=(?:[1-9]|1[0-6])$/.test(arg)) {
      if (concurrency || files.length) return null;
      concurrency = true;
    } else if (/^scripts\/[\w./-]+\.(?:cjs|mjs|js)$/.test(arg)) files.push(arg);
    else return null;
  }
  return files.length ? ['--test', ...files] : null;
}

function requestedFiles(selection, root) {
  const candidates = new Map();
  for (const command of selection.commands) {
    if (command.name !== 'source' || command.executable !== process.execPath || path.resolve(command.cwd) !== path.resolve(root)) continue;
    let args = command.args, omitted = [];
    const skip = args.filter(arg => arg.startsWith('--test-skip-pattern='));
    if (skip.length) {
      const policy = selection.testPolicy;
      if (skip.length !== 1 || !policy || !Array.isArray(policy.omitted) ||
          skip[0] !== `--test-skip-pattern=${policy.skipPattern}` ||
          policy.skipPattern !== require('./lifecycle-test-policy.cjs').skipPattern(policy.omitted.filter(item => item.test))) continue;
      omitted = policy.omitted; args = args.filter(arg => arg !== skip[0]);
    }
    const complete = completeTestArgs(args);
    if (!complete || !complete.slice(1).every(file => command.files.includes(file))) continue;
    for (const file of complete.slice(1)) candidates.set(file, omitted.filter(item => item.file === file && item.test).map(item => item.test).sort());
  }
  return candidates;
}
function provenFiles(check, feature, config, root) {
  const declared = feature?.checks.find(item => item.id === check.checkId);
  if (!declared || declared.level !== 'source' || declared.executable !== 'node' || check.executable !== 'node' || check.exitCode !== 0 || check.signal || check.error) return [];
  const direct = completeTestArgs(check.args);
  if (direct && JSON.stringify(completeTestArgs(declared.args)) === JSON.stringify(direct)) return direct.slice(1).map(file => ({ file, omitted: [] }));
  if (declared.args[0] !== 'scripts/check-artifact-lifecycle.cjs' || !['source', 'packaging'].includes(declared.args[2])) return [];
  const expected = require('./source-check-selection.cjs').select([feature], config).features
    .flatMap(feature => feature.checks).find(item => item.id === check.checkId);
  if (!expected || JSON.stringify(expected.args) !== JSON.stringify(check.args)) return [];
  const result = [];
  const stage = declared.args[2];
  for (const [executable, args] of require('./check-artifact-lifecycle.cjs').selectCommands(check.args.slice(1), process.platform, root, config.outputDirectory)) {
    if (executable !== process.execPath) continue;
    const whole = completeTestArgs(args);
    if (whole) { result.push(...whole.slice(1).map(file => ({ file, omitted: [] }))); continue; }
    if (stage !== 'source') continue;
    const policy = require('./lifecycle-test-policy.cjs').planLifecycleTests({ root,
      changedPaths: config.lifecycleChangedPaths ?? config.sourceCheckPaths ?? [], exhaustive: config.fullRegression === true });
    const stripped = completeTestArgs(args.filter(arg => arg === `--test-skip-pattern=${policy.skipPattern}` ? false : true));
    if (policy.skipPattern && stripped?.length === 2 && stripped[1] === require('./lifecycle-test-policy.cjs').FILE)
      result.push({ file: stripped[1], omitted: policy.omitted.map(item => item.test).sort() });
  }
  return result;
}

// Verified direct bundles and known wrapper recipes may cover the requested
// scope. A filtered proof never establishes complete-file coverage.
async function bindSourcePreflight(selection, config, root, verify = gate.verifyReceipt) {
  if (config.area !== 'engine' || config.checkPhase !== 'source' ||
      !path.isAbsolute(config.receiptPath || '') || physical(config.projectRoot) !== physical(root)) {
    throw Error('Source reuse requires a same-project engine source preflight receipt');
  }
  let receiptHash, acceptedAction;
  const validate = async () => {
    const currentHash = digest(config.receiptPath);
    if (receiptHash && currentHash !== receiptHash) throw Error('Source preflight receipt changed');
    receiptHash ??= currentHash;
    // verifyReceipt owns the current input, log and execution-environment
    // checks. Require its environment evidence without measuring it twice.
    const receipt = await verify(config);
    const validated = gate.validatedReceiptReuse(receipt);
    const currentExecution = validated?.sourceExecution ?? await gate.sourceExecutionIdentity(config);
    const canonical = require('./verification-reuse-policy.cjs').canonical;
    if (!receipt.sourceExecution || (validated
      ? JSON.stringify(canonical(receipt.sourceExecution)) !== validated.evidenceSourceExecution
      : JSON.stringify(receipt.sourceExecution) !== JSON.stringify(currentExecution)))
      throw Error('Source reuse requires matching execution environment evidence');
    if (!['passed', 'rerun-required'].includes(receipt.status)) throw Error('Source reuse requires passing evidence');
    const action = receipt.status === 'rerun-required' ? 'rerun' : 'reuse';
    if (acceptedAction && acceptedAction !== action) throw Error('Source preflight reuse decision changed');
    acceptedAction = action;
    return receipt;
  };
  const receipt = await validate();
  const manifest = gate.loadManifest(root);
  const candidates = requestedFiles(selection, root);
  const covered = new Set(), scoped = new Set(), records = [];
  for (const check of receipt.status === 'rerun-required' ? [] : receipt.checks) {
    const proof = provenFiles(check, manifest.features.find(feature => feature.id === check.featureId), config, root);
    const selected = proof.filter(item => candidates.has(item.file) && (!item.omitted.length ||
      JSON.stringify(item.omitted) === JSON.stringify(candidates.get(item.file))));
    if (!selected.length) continue;
    selected.forEach(item => (item.omitted.length ? scoped : covered).add(item.file));
    records.push({ featureId: check.featureId, checkId: check.checkId, executable: check.executable,
      executionScope: selected.some(item => item.omitted.length) ? 'selected-cases' : 'complete-files',
      args: check.args, logPath: check.logPath, logSha256: check.logSha256,
      errorPath: check.errorPath, errorSha256: check.errorSha256, exitCode: check.exitCode,
      ...(receipt.reuseReview?.mode === 'reviewed' ? { reuseReview: receipt.reuseReview } : {}) });
  }
  const commands = selection.commands.flatMap(command => {
    if (command.name !== 'source') return [command];
    const files = command.files.filter(file => !covered.has(file) && !scoped.has(file));
    if (!files.length) return [];
    return [{ ...command, files, args: command.args.filter(arg => !covered.has(arg) && !scoped.has(arg)) }];
  });
  return { validate, environment: gate.checkEnvironment(config), selection: { ...selection, commands,
    sourcePreflight: { receiptPath: receipt.receiptPath, receiptSha256: receiptHash,
      files: [...covered].sort(), checks: records, ...(receipt.reuseReview ? { reuseReview: receipt.reuseReview } : {}),
      selectedCaseFiles: [...scoped].filter(file => !covered.has(file)).sort(),
      reason: 'Verified source preflight' } } };
}

module.exports = { bindSourcePreflight, completeTestArgs };
