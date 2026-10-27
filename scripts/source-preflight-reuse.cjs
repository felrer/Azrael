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

// In deployment, the verified engine gate owns these unfiltered node:test
// bundles. This is not permission to reuse arbitrary per-file or native logs.
async function bindSourcePreflight(selection, config, root, verify = gate.verifyReceipt) {
  if (config.area !== 'engine' || config.checkPhase !== 'source' ||
      !path.isAbsolute(config.receiptPath || '') || physical(config.projectRoot) !== physical(root)) {
    throw Error('Source reuse requires a same-project engine source preflight receipt');
  }
  let receiptHash;
  const validate = async () => {
    const currentHash = digest(config.receiptPath);
    if (receiptHash && currentHash !== receiptHash) throw Error('Source preflight receipt changed');
    receiptHash ??= currentHash;
    // verifyReceipt owns the current input, log and execution-environment
    // checks. Require its environment evidence without measuring it twice.
    const receipt = await verify(config);
    if (!receipt.sourceExecution || (verify !== gate.verifyReceipt &&
        JSON.stringify(receipt.sourceExecution) !== JSON.stringify(await gate.sourceExecutionIdentity(config))))
      throw Error('Source reuse requires matching execution environment evidence');
    return receipt;
  };
  const receipt = await validate();
  const manifest = gate.loadManifest(root);
  const candidates = new Set(selection.commands.filter(command => command.name === 'source' &&
    command.executable === process.execPath && path.resolve(command.cwd) === path.resolve(root) &&
    command.args[0] === '--test' && command.args.every(arg =>
      /^--test-(?:concurrency|skip-pattern)=/.test(arg) || arg === '--test' || command.files.includes(arg)))
    .flatMap(command => command.files));
  const covered = new Set(), records = [];
  for (const check of receipt.checks) {
    const declared = manifest.features.find(feature => feature.id === check.featureId)?.checks.find(item => item.id === check.checkId);
    if (!declared || declared.level !== 'source' || declared.executable !== check.executable ||
        JSON.stringify(declared.args) !== JSON.stringify(check.args)) continue;
    const [flag, ...files] = check.args;
    // A filtered/operational command can never establish whole-file coverage.
    if (check.executable !== 'node' || flag !== '--test' || !files.length ||
        !files.every(file => /^scripts\/[\w./-]+\.(?:cjs|mjs|js)$/.test(file) && candidates.has(file))) continue;
    files.forEach(file => covered.add(file));
    records.push({ featureId: check.featureId, checkId: check.checkId, executable: check.executable,
      args: check.args, logPath: check.logPath, logSha256: check.logSha256,
      errorPath: check.errorPath, errorSha256: check.errorSha256, exitCode: check.exitCode });
  }
  const commands = selection.commands.flatMap(command => {
    if (command.name !== 'source') return [command];
    const files = command.files.filter(file => !covered.has(file));
    if (!files.length) return [];
    return [{ ...command, files, args: command.args.filter(arg => !covered.has(arg)) }];
  });
  return { validate, environment: gate.checkEnvironment(config), selection: { ...selection, commands,
    sourcePreflight: { receiptPath: receipt.receiptPath, receiptSha256: receiptHash,
      files: [...covered].sort(), checks: records,
      reason: 'Passing engine gate owns complete unfiltered node:test bundles; identity and logs revalidated before and after source execution' } } };
}

module.exports = { bindSourcePreflight };
