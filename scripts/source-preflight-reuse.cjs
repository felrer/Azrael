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

// In deployment, the verified engine gate owns these unfiltered node:test
// bundles. This is not permission to reuse arbitrary per-file or native logs.
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
  const candidates = new Set(selection.commands.filter(command => command.name === 'source' &&
    command.executable === process.execPath && path.resolve(command.cwd) === path.resolve(root) &&
    completeTestArgs(command.args)?.slice(1).every(file => command.files.includes(file)))
    .flatMap(command => completeTestArgs(command.args).slice(1)));
  const covered = new Set(), records = [];
  for (const check of receipt.status === 'rerun-required' ? [] : receipt.checks) {
    const declared = manifest.features.find(feature => feature.id === check.featureId)?.checks.find(item => item.id === check.checkId);
    const actualArgs = completeTestArgs(check.args);
    if (!declared || declared.level !== 'source' || declared.executable !== check.executable ||
        !actualArgs || JSON.stringify(completeTestArgs(declared.args)) !== JSON.stringify(actualArgs)) continue;
    const [, ...files] = actualArgs;
    // A filtered/operational command can never establish whole-file coverage.
    if (check.executable !== 'node') continue;
    const selected = files.filter(file => candidates.has(file));
    if (!selected.length) continue;
    selected.forEach(file => covered.add(file));
    records.push({ featureId: check.featureId, checkId: check.checkId, executable: check.executable,
      args: check.args, logPath: check.logPath, logSha256: check.logSha256,
      errorPath: check.errorPath, errorSha256: check.errorSha256, exitCode: check.exitCode,
      ...(receipt.reuseReview?.mode === 'reviewed' ? { reuseReview: receipt.reuseReview } : {}) });
  }
  const commands = selection.commands.flatMap(command => {
    if (command.name !== 'source') return [command];
    const files = command.files.filter(file => !covered.has(file));
    if (!files.length) return [];
    return [{ ...command, files, args: command.args.filter(arg => !covered.has(arg)) }];
  });
  return { validate, environment: gate.checkEnvironment(config), selection: { ...selection, commands,
    sourcePreflight: { receiptPath: receipt.receiptPath, receiptSha256: receiptHash,
      files: [...covered].sort(), checks: records, ...(receipt.reuseReview ? { reuseReview: receipt.reuseReview } : {}),
      reason: 'Verified source preflight' } } };
}

module.exports = { bindSourcePreflight, completeTestArgs };
