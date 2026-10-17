'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { getDirectoryState } = require('./directory-state.cjs');
const { snapshotProject } = require('./deployment-input-snapshot.cjs');
const verificationCache = require('./verification-result-cache.cjs');
const nativeCache = require('./native-verification-cache.cjs');
const cargoCache = require('./cargo-verification-cache.cjs');
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const fileHash = async filename => hash(await fs.promises.readFile(filename));
const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const same = (a, b) => canonical(a) === canonical(b);
const readJson = filename => JSON.parse(fs.readFileSync(filename, 'utf8').replace(/^\uFEFF/, ''));
const manifestName = 'scripts/azrael-feature-contracts.json';

function loadManifest(projectRoot) { return readJson(path.join(projectRoot, manifestName)); }
function reference(root, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || relative.includes('\\')) throw Error(`Invalid repository reference: ${relative}`);
  const resolved = path.resolve(root, relative), inside = path.relative(root, resolved);
  if (inside.startsWith('..') || path.isAbsolute(inside) || !fs.statSync(resolved).isFile()) throw Error(`Missing or escaping reference: ${relative}`);
  const realInside = path.relative(fs.realpathSync(root), fs.realpathSync(resolved));
  if (realInside.startsWith('..') || path.isAbsolute(realInside)) throw Error(`Reference resolves outside repository: ${relative}`);
  return resolved;
}
function checkSources(check) { return check.args.filter(arg => /\.(?:cjs|mjs|js|py)$/.test(arg) && !arg.includes('{')); }
// Scheduling hints never change commands, filters, compilation identity or reuse.
// Only independent wrappers consuming the selected source may opt in. Keep all
// other native checks in their original relative order.
const schedulableCargoWrappers = new Set(['scripts/check-api-context.cjs',
  'scripts/check-model-harness-profiles.cjs', 'scripts/check-task-work-time-native.cjs',
  'scripts/check-response-tps-native.cjs', 'scripts/check-capacity-recovery.cjs']);
function validateCargoSchedule(feature, check) {
  if (!Object.hasOwn(check, 'cargoScheduleGroup')) return;
  if (feature.area !== 'engine' || check.level !== 'native' || check.executable !== 'node' ||
      typeof check.cargoScheduleGroup !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(check.cargoScheduleGroup) ||
      !schedulableCargoWrappers.has(check.args[0]) ||
      check.args.length !== (check.args[0] === 'scripts/check-capacity-recovery.cjs' ? 2 : 3) ||
      check.args[1] !== '{engineSourceRoot}' || (check.args.length === 3 && /[{}]/.test(check.args[2]))) {
    throw Error(`Invalid Cargo scheduling hint: ${check.id}`);
  }
}
function scheduleNativeGroups(groups) {
  const batches = new Map(), remaining = [];
  for (const group of groups) {
    for (const entry of group.entries) validateCargoSchedule(entry.feature, entry.check);
    const labels = group.entries.map(entry => entry.check.cargoScheduleGroup);
    const label = labels[0];
    if (!label || labels.some(value => value !== label)) { remaining.push(group); continue; }
    if (!batches.has(label)) batches.set(label, []);
    batches.get(label).push(group);
  }
  return [...batches.values()].flat().concat(remaining);
}
function sourceTestPolicy(config) {
  if (config.sourceTestPolicy === undefined) return null;
  const policy = config.sourceTestPolicy;
  if (!policy || typeof policy !== 'object' || Array.isArray(policy) ||
      !same(Object.keys(policy).sort(), ['changedPaths', 'exhaustive']) ||
      typeof policy.exhaustive !== 'boolean' || !Array.isArray(policy.changedPaths) ||
      policy.changedPaths.some(file => typeof file !== 'string' || !file || file.includes('\0') ||
        path.isAbsolute(file) || /^[A-Za-z]:[\\/]/.test(file) || file.replace(/\\/g, '/').split('/').includes('..'))) {
    throw Error('Invalid source test policy');
  }
  return { changedPaths: [...new Set(policy.changedPaths.map(file => file.replace(/\\/g, '/').replace(/^\.\//, '')))].sort(), exhaustive: policy.exhaustive };
}
function sourceTestCommand(config, check, args) {
  const policy = sourceTestPolicy(config);
  if (!policy || check.level !== 'source' || check.executable !== 'node' || !args.includes('--test')) return { args, omitted: [] };
  const plan = require('./source-test-policy.cjs').planSourceTests({ files: checkSources(check), ...policy });
  if (plan.files.length !== checkSources(check).length) throw Error('A registered preservation check cannot be deferred as a whole');
  if (!plan.skipPattern) return { args, omitted: [] };
  const selected = [...args];
  selected.splice(selected.indexOf('--test') + 1, 0, `--test-skip-pattern=${plan.skipPattern}`);
  return { args: selected, omitted: plan.omitted };
}
function validateManifest(manifest, projectRoot, transformRules = {}) {
  if (manifest.schema !== 1 || !Array.isArray(manifest.features) || !manifest.features.length) throw Error('Invalid feature manifest schema');
  const ids = new Set(), checks = new Set(), covered = new Set();
  for (const feature of manifest.features) {
    if (!/^[a-z][a-z0-9.-]*$/.test(feature.id) || ids.has(feature.id)) throw Error(`Duplicate or invalid feature ID: ${feature.id}`);
    ids.add(feature.id);
    if (!['ui', 'engine'].includes(feature.area) || !Array.isArray(feature.owners) || !feature.owners.length || new Set(feature.owners).size !== feature.owners.length) throw Error(`Invalid owners/area: ${feature.id}`);
    feature.owners.forEach(owner => { reference(projectRoot, owner); if (feature.area === 'ui') covered.add(path.basename(owner)); });
    reference(projectRoot, feature.contract);
    if (!Array.isArray(feature.checks) || !feature.checks.length || !Array.isArray(feature.reportFields) || (feature.area === 'ui' && !feature.reportFields.length)) throw Error(`Missing checks/report fields: ${feature.id}`);
    if (new Set(feature.reportFields).size !== feature.reportFields.length || feature.reportFields.some(field => !/^[a-zA-Z][a-zA-Z0-9]*$/.test(field))) throw Error(`Invalid report fields: ${feature.id}`);
    for (const check of feature.checks) {
      if (!/^[a-z][a-z0-9.-]*$/.test(check.id) || checks.has(check.id)) throw Error(`Duplicate or invalid check ID: ${check.id}`);
      checks.add(check.id);
      if (!['node', 'python'].includes(check.executable) || !['source', 'native'].includes(check.level) || !Array.isArray(check.args) || !check.args.length || check.args.some(arg => typeof arg !== 'string' || arg.includes('\0') || arg === '--live')) throw Error(`Invalid check command: ${check.id}`);
      if (feature.area === 'ui' && check.level !== 'source') throw Error(`UI check must be source: ${check.id}`);
      validateCargoSchedule(feature, check);
      const sources = checkSources(check);
      if (!sources.length) throw Error(`Missing executable check source: ${check.id}`);
      sources.forEach(source => reference(projectRoot, source));
      if (Object.hasOwn(check, 'cacheInputs')) {
        const inputs = check.cacheInputs;
        if (feature.area !== 'ui' || check.level !== 'source' || !inputs || typeof inputs !== 'object' || Array.isArray(inputs) ||
            !same(Object.keys(inputs).sort(), ['files', 'schema']) || ![1, 2].includes(inputs.schema) || !Array.isArray(inputs.files) || !inputs.files.length ||
            new Set(inputs.files).size !== inputs.files.length || check.args.some(arg => arg.includes('{fixture}'))) throw Error(`Invalid source cache inputs: ${check.id}`);
        inputs.files.forEach(source => reference(projectRoot, source));
      }
      if (Object.hasOwn(check, 'nativeCacheInputs')) nativeCache.validateInputs(feature, check, source => reference(projectRoot, source));
      for (const arg of check.args) for (const match of arg.matchAll(/\{([^}]+)\}/g)) {
        if (!['projectRoot', 'uiRoot', 'engineSourceRoot', 'engineDirectory', 'engine', 'fixture'].includes(match[1])) throw Error(`Unknown placeholder: ${match[1]}`);
      }
    }
  }
  for (const key of Object.keys(transformRules).filter(key => /^inject-.*\.cjs$/.test(key))) if (!covered.has(key)) throw Error(`Unregistered UI injector: ${key}`);
  return manifest;
}
function validateTransformReport(manifest, report) {
  if (!Array.isArray(report.assets)) throw Error('Transformation report assets missing');
  for (const feature of manifest.features.filter(feature => feature.area === 'ui')) for (const field of feature.reportFields) {
    const values = report.assets.map(asset => asset[field] ?? 0);
    if (values.some(value => !Number.isFinite(value) || value < 0) || values.reduce((total, value) => total + value, 0) <= 0) throw Error(`Missing transformation coverage: ${feature.id}/${field}`);
  }
  return true;
}
async function execute(executable, args, options) {
  return new Promise(resolve => {
    const stdout = fs.createWriteStream(options.logPath), stderr = fs.createWriteStream(options.errorPath);
    let output = '', errorOutput = '';
    const child = spawn(executable === 'node' ? process.execPath : 'python', args, { cwd: options.cwd, env: options.env, shell: false, windowsHide: true });
    child.stdout.on('data', chunk => { stdout.write(chunk); output += chunk; });
    child.stderr.on('data', chunk => { stderr.write(chunk); errorOutput += chunk; });
    let spawnError;
    child.on('error', error => { spawnError = error.message; stderr.write(error.message); });
    child.on('close', (code, signal) => {
      stdout.end(() => stderr.end(() => resolve({ exitCode: code, signal, error: spawnError, stdout: output, stderr: errorOutput })));
    });
  });
}
function selected(manifest, area, config) {
  if (!['ui', 'engine', 'all'].includes(area)) throw Error('Explicit area ui, engine or all required');
  const features = manifest.features.filter(feature => area === 'all' || feature.area === area);
  for (const required of area === 'all' ? ['ui', 'engine'] : [area]) if (!features.some(feature => feature.area === required)) throw Error(`Missing mandatory area: ${required}`);
  if (!Object.hasOwn(config, 'featureIds')) return features;
  const ids = config.featureIds;
  if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string') || new Set(ids).size !== ids.length) throw Error('featureIds must be an array of unique feature IDs');
  for (const id of ids) if (!features.some(feature => feature.id === id)) throw Error(`Unknown or wrong-area feature ID: ${id}`);
  return features.filter(feature => ids.includes(feature.id));
}
function rulesFor(config) { return config.transformRules ?? require(path.join(config.projectRoot, 'scripts/namespace-azrael-host.cjs')).getTransformRules(); }
async function sourceUiIdentity(config) {
  const { PROVIDER_PICKER_ASSET } = require(path.join(config.projectRoot, 'scripts/inject-provider-model-picker.cjs'));
  if (typeof PROVIDER_PICKER_ASSET !== 'string') throw Error('Provider picker asset contract missing');
  return { version: readJson(path.join(config.uiRoot, 'package.json')).version,
    packageSha256: await fileHash(path.join(config.uiRoot, 'package.json')),
    webviewSha256: await fileHash(path.join(config.uiRoot, PROVIDER_PICKER_ASSET)) };
}
async function identity(config, manifest, rules, features, execution = execute) {
  if (config.identityProvider) return config.identityProvider(config, manifest, rules, features);
  const references = new Set([manifestName, 'scripts/feature-preservation.cjs', 'scripts/directory-state.cjs', 'scripts/deployment-input-snapshot.cjs']);
  const testPolicy = sourceTestPolicy(config);
  if (testPolicy) references.add('scripts/source-test-policy.cjs');
  features.forEach(feature => { feature.owners.forEach(owner => references.add(owner)); references.add(feature.contract); feature.checks.forEach(check => checkSources(check).forEach(source => references.add(source))); });
  // Resource entries bind their content digest through transformRules; they are not script filenames.
  for (const key of Object.keys(rules).filter(key => !key.includes(':') && /\.(?:cjs|json)$/.test(key))) references.add(`scripts/${key}`);
  const input = { manifestSha256: hash(canonical(manifest)), projectSha256: (await snapshotProject(config.projectRoot)).sha256,
    registered: await getDirectoryState(path.resolve(config.projectRoot), [...references].sort()), transformRules: rules };
  if (testPolicy) input.sourceTestPolicy = testPolicy;
  if (['ui', 'all'].includes(config.area)) {
    if (!config.uiRoot || !path.isAbsolute(config.uiRoot)) throw Error('Explicit absolute uiRoot required');
    input.ui = await getDirectoryState(config.uiRoot);
    input.sourceUi = await sourceUiIdentity(config);
    const typescript = config.typeScriptPath || path.join(config.projectRoot, 'extensions/azrael-ex/node_modules/typescript/lib/typescript.js');
    input.typeScriptSha256 = await fileHash(typescript);
  }
  if (['engine', 'all'].includes(config.area)) {
    if (!config.engineSourceRoot || !path.isAbsolute(config.engineSourceRoot)) throw Error('Explicit absolute engine source root required');
    input.engineSource = { root: config.engineSourceRoot, sha256: (await snapshotProject(config.engineSourceRoot)).sha256 };
    input.executionEnvironment = hash(canonical(checkEnvironment(config)));
    input.checkRuntime = await require('./pipeline-preflight.cjs').identity(config, features);
    if (config.checkPhase === 'source') return input;
    if (![config.engineSourceRoot, config.engineDirectory].every(value => value && path.isAbsolute(value))) throw Error('Explicit absolute engine source and binary roots required');
    const suffix = crypto.randomUUID();
    const result = await execution('python', [path.join(config.projectRoot, 'scripts/engine-provenance.py'), 'verify', '--root', config.engineSourceRoot, '--engine-dir', config.engineDirectory],
      { cwd: config.projectRoot, env: process.env, logPath: path.join(config.outputDirectory, `provenance-${suffix}.log`), errorPath: path.join(config.outputDirectory, `provenance-${suffix}.stderr.log`) });
    if (result.exitCode !== 0) throw Error(`Engine provenance failed: ${result.stderr || result.error || result.exitCode}`);
    input.engine = { sourceRoot: config.engineSourceRoot, directory: config.engineDirectory, provenance: JSON.parse(result.stdout) };
  }
  return input;
}
function phaseChecks(feature, phase) {
  return feature.checks.filter(check => phase !== 'source' || check.level === 'source');
}
function sourceInputs(inputs) { const { engine, ...source } = inputs; return source; }
function expectedReceipt(manifest, features, receipt) {
  if (receipt.schema !== 1 || receipt.status !== 'passed' || !same(receipt.featureIds, features.map(feature => feature.id))) throw Error('Receipt missing requested passing feature scope');
  const required = features.flatMap(feature => phaseChecks(feature, receipt.checkPhase).map(check => ({ featureId: feature.id, checkId: check.id, area: feature.area })));
  if (!Array.isArray(receipt.checks) || receipt.checks.length !== required.length) throw Error('Receipt mandatory checks missing');
  for (const check of required) {
    const entries = receipt.checks.filter(entry => entry.featureId === check.featureId && entry.checkId === check.checkId && entry.area === check.area);
    if (entries.length !== 1 || entries[0].exitCode !== 0) throw Error(`Receipt mandatory check failed: ${check.checkId}`);
  }
}
async function verifyLogs(receipt) {
  for (const check of receipt.checks) {
    if (!check.logPath || !check.errorPath || await fileHash(check.logPath) !== check.logSha256 || await fileHash(check.errorPath) !== check.errorSha256) throw Error(`Check evidence changed: ${check.checkId}`);
  }
}
function checkEnvironment(config) {
  return { ...process.env, ...(config.cargoTargetDirectory ? { CARGO_TARGET_DIR: config.cargoTargetDirectory } : {}), AZRAEL_PRESERVATION_UI_ROOT: config.uiRoot ?? '',
    AZRAEL_PRESERVATION_TYPESCRIPT_PATH: config.typeScriptPath || path.join(config.projectRoot, 'extensions/azrael-ex/node_modules/typescript/lib/typescript.js') };
}
async function sourceCacheRuntime(config, bindProjectTypeScript = false) {
  const typescriptPath = path.resolve(checkEnvironment(config).AZRAEL_PRESERVATION_TYPESCRIPT_PATH);
  const typescriptRoot = path.dirname(path.dirname(typescriptPath));
  const pkg = readJson(path.join(typescriptRoot, 'package.json'));
  if (pkg.name !== 'typescript' || typeof pkg.version !== 'string') throw Error('Source cache requires the actual TypeScript runtime');
  const typescript = { entry: typescriptPath, version: pkg.version, state: await getDirectoryState(typescriptRoot) };
  let projectTypeScript;
  if (bindProjectTypeScript) {
    const entry = require.resolve('typescript', { paths: [path.resolve(config.projectRoot, 'extensions/azrael-ex')] });
    const root = path.dirname(path.dirname(entry));
    const packagePath = path.join(root, 'package.json');
    const actualPackage = readJson(packagePath);
    if (actualPackage.name !== 'typescript' || typeof actualPackage.version !== 'string' || !actualPackage.version ||
        typeof actualPackage.main !== 'string' || path.resolve(root, actualPackage.main) !== path.resolve(entry)) {
      throw Error('Source cache requires a certain actual project TypeScript runtime');
    }
    projectTypeScript = { entry, name: actualPackage.name, version: actualPackage.version, packagePath,
      packageSha256: await fileHash(packagePath),
      state: path.resolve(entry) === typescriptPath ? typescript.state : await getDirectoryState(root) };
  }
  return { node: { executable: process.execPath, sha256: await fileHash(process.execPath), version: process.version,
    platform: process.platform, arch: process.arch }, typescript,
    ...(bindProjectTypeScript ? { projectTypeScript } : {}),
    ...(process.env.AZRAEL_PINNED_HOST_ROOT && path.resolve(process.env.AZRAEL_PINNED_HOST_ROOT) !== path.resolve(config.uiRoot)
      ? { pinnedHostOverride: await getDirectoryState(process.env.AZRAEL_PINNED_HOST_ROOT) } : {}),
    environmentSha256: hash(canonical(checkEnvironment(config))) };
}
async function sourceCacheKey(config, group, inputs, runtime) {
  const files = new Set(['scripts/feature-preservation.cjs', 'scripts/verification-result-cache.cjs', 'scripts/directory-state.cjs']);
  for (const { feature, check } of group.entries) {
    feature.owners.forEach(file => files.add(file)); files.add(feature.contract);
    checkSources(check).forEach(file => files.add(file)); check.cacheInputs.files.forEach(file => files.add(file));
  }
  const declared = group.entries.map(({ feature, check }) => ({ featureId: feature.id, owners: feature.owners,
    contract: feature.contract, reportFields: feature.reportFields, check }));
  return hash(canonical({ schema: verificationCache.CACHE_SCHEMA, declared, executable: group.check.executable, args: group.args,
    projectRoot: path.resolve(config.projectRoot), files: await getDirectoryState(config.projectRoot, [...files].sort()),
    ui: inputs.ui, runtime,
    ...(group.entries.some(({ check }) => check.cacheInputs.schema === 2) ? { sourceInputs: sourceInputs(inputs) } : {}) }));
}
async function runPreservation(config) {
  const runStarted = performance.now();
  const receipt = { schema: 1, status: 'running', area: config.area, checkPhase: config.checkPhase ?? 'all', startedUtc: new Date().toISOString(), featureIds: [], checks: [], skipped: [] };
  config = { ...config, checkPhase: receipt.checkPhase };
  if (!['source', 'all'].includes(config.checkPhase)) throw Error('checkPhase must be source or all');
  const execution = config.execute ?? execute;
  if (!config.outputDirectory || !path.isAbsolute(config.outputDirectory)) throw Error('Absolute outputDirectory required');
  await fs.promises.mkdir(config.outputDirectory, { recursive: true });
  const runDirectory = await fs.promises.mkdtemp(path.join(config.outputDirectory, 'preservation-'));
  const receiptPath = path.join(runDirectory, 'receipt.json');
  const cacheHandles = [];
  let activeCacheCheckIds, activeNativeCheckIds, nativeRuntime, cargoRuntime, cargoGroups = [], activeCargoCheckIds, manifest, rules, features, sourceCacheBindsProjectTypeScript = false;
  const cacheSummary = kind => kind === 'native' ? receipt.nativeCache : kind === 'cargo' ? receipt.cargoCache : receipt.cache;
  const publishPassingCaches = async (verifyIdentity = true, failedRun = false) => {
    if (!cacheHandles.some(entry => !failedRun || entry.kind === 'cargo')) return;
    const started = performance.now();
    if (verifyIdentity && !same(receipt.inputs, await identity(config, manifest, rulesFor(config), features, execution))) throw Error('Inputs changed during verification');
    const finalRuntime = cacheHandles.some(entry => entry.kind === 'source') ? await sourceCacheRuntime(config, sourceCacheBindsProjectTypeScript) : null;
    const finalNativeRuntime = nativeRuntime ? await nativeCache.runtime(config, checkEnvironment(config)) : null;
    const finalCargoRuntime = cargoRuntime ? await cargoCache.runtime(config, checkEnvironment(config)) : null;
    for (const entry of cacheHandles) {
      const finalKey = entry.kind === 'native' ? await nativeCache.key(config, entry.group, finalNativeRuntime) : entry.kind === 'cargo' ? await cargoCache.key(config, entry.group, receipt.inputs, finalCargoRuntime) : await sourceCacheKey(config, entry.group, receipt.inputs, finalRuntime);
      if (entry.key !== finalKey) throw Error(`${entry.kind} cache inputs changed during verification`);
    }
    receipt.timings.cacheInputMs += performance.now() - started;
    for (const entry of cacheHandles) if (!entry.handle.hit && entry.record?.exitCode === 0 && (!failedRun || entry.kind === 'cargo')) {
      const summary = cacheSummary(entry.kind);
      const published = await entry.handle.publish(entry.record);
      if (!published.published) summary.deferred.push({ checkId: entry.group.check.id, reason: published.reason });
    }
  };
  let checkpoint = Promise.resolve();
  const persist = () => {
    const contents = JSON.stringify(receipt, null, 2) + '\n';
    checkpoint = checkpoint.then(async () => {
      const temporary = `${receiptPath}.tmp`;
      await fs.promises.writeFile(temporary, contents);
      await fs.promises.rename(temporary, receiptPath);
    });
    return checkpoint;
  };
  await persist();
  try {
    const concurrency = config.sourceConcurrency ?? 4;
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) throw Error('sourceConcurrency must be an integer from 1 to 4');
    if (config.reuseSourceChecks !== undefined && typeof config.reuseSourceChecks !== 'boolean') throw Error('reuseSourceChecks must be boolean');
    if (config.reuseNativeChecks !== undefined && typeof config.reuseNativeChecks !== 'boolean') throw Error('reuseNativeChecks must be boolean');
    const testPolicy = sourceTestPolicy(config);
    if (testPolicy) receipt.testPolicy = { ...testPolicy, omitted: [] };
    manifest = config.manifest ?? loadManifest(config.projectRoot); rules = rulesFor(config);
    validateManifest(manifest, config.projectRoot, rules);
    features = selected(manifest, config.area, config);
    receipt.featureIds = features.map(feature => feature.id);
    receipt.notApplicableFeatureIds = manifest.features.filter(feature =>
      (config.area === 'all' || feature.area === config.area) && !receipt.featureIds.includes(feature.id)).map(feature => feature.id);
    receipt.timings = { identityBeforeMs: 0, identityAfterMs: 0, checkExecutionMs: 0, cacheLookupMs: 0, cacheInputMs: 0 };
    let identityStarted = performance.now();
    receipt.inputs = await identity(config, manifest, rules, features, execution);
    receipt.timings.identityBeforeMs = performance.now() - identityStarted;
    if (config.expectedInputs && !same(config.expectedInputs, receipt.inputs)) throw Error('Expected input identity differs');
    await persist();
    let sourceReceipt;
    if (config.sourceReceiptPath) {
      if (config.checkPhase !== 'all') throw Error('Source evidence can only be handed to a complete run');
      sourceReceipt = readJson(config.sourceReceiptPath);
      if (sourceReceipt.checkPhase !== 'source' || sourceReceipt.area !== config.area) throw Error('Invalid source preflight receipt');
      expectedReceipt(manifest, features, sourceReceipt); await verifyLogs(sourceReceipt);
      if (!same(sourceInputs(sourceReceipt.inputs), sourceInputs(receipt.inputs))) throw Error('Source preflight input identity is stale');
    }
    const shared = new Map(), records = [];
    await fs.promises.mkdir(path.join(config.projectRoot, 'artifacts', 'verification'), { recursive: true });
    for (const feature of features) for (const check of phaseChecks(feature, config.checkPhase)) {
      const fixture = path.join(config.projectRoot, 'artifacts', 'verification', `preservation-${crypto.randomUUID()}`);
      const variables = { ...config, engine: config.engineDirectory && path.join(config.engineDirectory, 'azrael.exe'), fixture };
      const resolvedArgs = check.args.map(arg => arg.replace(/\{([^}]+)\}/g, (_, key) => {
        if (!variables[key]) throw Error(`Missing placeholder value: ${key}`);
        return variables[key];
      }));
      const selection = sourceTestCommand(config, check, resolvedArgs);
      const args = selection.args;
      if (receipt.testPolicy) receipt.testPolicy.omitted.push(...selection.omitted.map(item => ({ checkId: check.id, ...item })));
      // Existing fixture tests must select this candidate; a pinned fallback is safe only behind the supplied environment contract.
      if (feature.area === 'ui') for (const source of checkSources(check)) {
        const text = fs.readFileSync(path.join(config.projectRoot, source), 'utf8');
        const pinned = text.match(/artifacts[\\/]upstream-ui[\\/]([\w.-]+)/);
        if (pinned && !text.includes('AZRAEL_PRESERVATION_UI_ROOT') && path.resolve(config.uiRoot) !== path.resolve(config.projectRoot, 'artifacts/upstream-ui', pinned[1])) throw Error(`Check uses another UI candidate: ${source}`);
      }
      const key = canonical([check.executable, args]);
      let group = shared.get(key);
      if (!group) { group = { check, args, native: false, entries: [] }; shared.set(key, group); }
      group.native ||= check.level === 'native';
      group.entries.push({ feature, check, index: records.length });
      records.push(undefined);
    }
    const cacheRoot = path.join(config.projectRoot, 'artifacts', 'cache', 'verification-results');
    const eligibleGroups = [...shared.values()].filter(group => !group.native && config.reuseSourceChecks !== false &&
      group.entries.every(({ feature, check }) => feature.area === 'ui' && check.level === 'source' && check.cacheInputs));
    sourceCacheBindsProjectTypeScript = eligibleGroups.some(group => group.entries.some(({ check }) => check.cacheInputs.schema === 2));
    const nativeGroups = [...shared.values()].filter(group => group.native &&
      group.entries.every(({ feature, check }) => feature.area === 'engine' && check.level === 'native' && check.nativeCacheInputs));
    cargoGroups = [...shared.values()].filter(group => cargoCache.isEligible(group));
    let cacheRuntime;
    receipt.cargoCache = { schema: cargoCache.CACHE_SCHEMA, executed: 0, reused: 0, eligible: cargoGroups.length, deferred: [] };
    if (cargoGroups.length) {
      const started = performance.now();
      try { cargoRuntime = await cargoCache.runtime(config, checkEnvironment(config)); }
      catch (error) { receipt.cargoCache.disabledReason = error.message; }
      receipt.timings.cacheInputMs += performance.now() - started;
      activeCargoCheckIds = manifest.features.flatMap(feature => feature.checks.filter(check => cargoCache.isEligible({ native: check.level === 'native', entries: [{ feature, check }], check })).map(check => check.id));
      for (const method of ['pruneObsoleteVersions', 'pruneRemovedChecks']) {
        const result = await cargoCache[method]({ ...cargoCache.options(config), checkIds: activeCargoCheckIds });
        receipt.cargoCache.deferred.push(...(result?.deferred || []));
      }
    }
    receipt.cache = { schema: verificationCache.CACHE_SCHEMA, executed: 0, reused: 0, eligible: eligibleGroups.length, deferred: [] };
    receipt.nativeCache = { schema: nativeCache.CACHE_SCHEMA, executed: 0, reused: 0, eligible: nativeGroups.length, deferred: [] };
    if (nativeGroups.length) {
      const started = performance.now();
      try { nativeRuntime = await nativeCache.runtime(config, checkEnvironment(config)); }
      catch (error) { receipt.nativeCache.disabledReason = error.message; }
      receipt.timings.cacheInputMs += performance.now() - started;
    }
    if (config.reuseNativeChecks !== false) {
      activeNativeCheckIds = manifest.features.flatMap(feature => feature.checks.filter(check => check.nativeCacheInputs).map(check => check.id));
      for (const method of ['pruneObsoleteVersions', 'pruneRemovedChecks']) {
        try { const result = await nativeCache[method]({ ...nativeCache.options(config), checkIds: activeNativeCheckIds });
          receipt.nativeCache.deferred.push(...(result?.deferred || [])); }
        catch (error) { receipt.nativeCache.deferred.push({ operation: method, reason: error.message }); }
      }
    }
    if (eligibleGroups.length) {
      const started = performance.now();
      try { cacheRuntime = await sourceCacheRuntime(config, sourceCacheBindsProjectTypeScript); }
      catch (error) { receipt.cache.disabledReason = error.message; }
      receipt.timings.cacheInputMs += performance.now() - started;
    }
    if (config.reuseSourceChecks !== false) {
      const options = { projectRoot: config.projectRoot, cacheRoot };
      activeCacheCheckIds = manifest.features.flatMap(feature => feature.checks.filter(check => feature.area === 'ui' && check.level === 'source' && check.cacheInputs).map(check => check.id));
      for (const method of ['pruneObsoleteVersions', 'pruneRemovedChecks']) {
        try { const result = await verificationCache[method]({ ...options,
          checkIds: activeCacheCheckIds });
          receipt.cache.deferred.push(...(result?.deferred || [])); }
        catch (error) { receipt.cache.deferred.push({ operation: method, reason: error.message }); }
      }
    }
    const runGroup = async group => {
        const { check, args } = group;
        const logPath = path.join(runDirectory, `${check.id}.log`), errorPath = path.join(runDirectory, `${check.id}.stderr.log`);
        let handle, key, kind;
        const startedUtc = new Date().toISOString();
        if (sourceReceipt && !group.native) {
          for (const entry of group.entries) {
            const previous = sourceReceipt.checks.find(old => old.checkId === entry.check.id && old.featureId === entry.feature.id);
            if (!previous || !same(previous.args, args) || previous.executable !== check.executable) throw Error('Source check command differs');
            const logPath = path.join(runDirectory, `${entry.check.id}.log`), errorPath = path.join(runDirectory, `${entry.check.id}.stderr.log`);
            await fs.promises.copyFile(previous.logPath, logPath); await fs.promises.copyFile(previous.errorPath, errorPath);
            records[entry.index] = { ...previous, logPath, errorPath, reused: true, executionStatus: 'reused', executionReason: 'passing source preflight with unchanged inputs', durationMs: 0, startedUtc, completedUtc: new Date().toISOString() };
          }
          receipt.checks = records.filter(Boolean); receipt.cache.reused++; await persist(); return;
        }
        const lookupStarted = performance.now();
        if (cacheRuntime && eligibleGroups.includes(group)) {
          try { key = await sourceCacheKey(config, group, receipt.inputs, cacheRuntime);
            handle = await verificationCache.begin({ projectRoot: config.projectRoot, cacheRoot, checkId: check.id, key, runDirectory });
            kind = 'source'; cacheHandles.push({ handle, group, key, kind }); receipt.cache.deferred.push(...(handle.deferred || [])); }
          catch (error) { receipt.cache.deferred.push({ checkId: check.id, reason: error.message }); }
        }
        if (nativeRuntime && nativeGroups.includes(group)) {
          try { key = await nativeCache.key(config, group, nativeRuntime);
            handle = await nativeCache.begin({ ...nativeCache.options(config), checkId: check.id, key, runDirectory,
              force: config.reuseNativeChecks === false });
            kind = 'native'; cacheHandles.push({ handle, group, key, kind }); receipt.nativeCache.deferred.push(...(handle.deferred || [])); }
          catch (error) { receipt.nativeCache.deferred.push({ checkId: check.id, reason: error.message }); }
        }
        if (cargoRuntime && cargoGroups.includes(group)) {
          key = await cargoCache.key(config, group, receipt.inputs, cargoRuntime);
          handle = await cargoCache.begin({ ...cargoCache.options(config), checkId: check.id, key, runDirectory, force: config.reuseNativeChecks === false });
          kind = 'cargo'; cacheHandles.push({ handle, group, key, kind }); receipt.cargoCache.deferred.push(...(handle.deferred || []));
        }
        receipt.timings.cacheLookupMs += performance.now() - lookupStarted;
        const reused = Boolean(handle?.hit);
        const started = performance.now();
        const result = { ...(handle?.hit || await execution(check.executable, args, { cwd: config.projectRoot,
          env: checkEnvironment(config), logPath, errorPath })), logPath, errorPath };
        if (handle) cacheHandles.find(entry => entry.handle === handle).record = result;
        receipt.cache[reused ? 'reused' : 'executed']++;
        if (group.native) (kind === 'cargo' ? receipt.cargoCache : receipt.nativeCache)[reused ? 'reused' : 'executed']++;
        if (!reused) receipt.timings.checkExecutionMs += performance.now() - started;
        result.logSha256 = await fileHash(logPath); result.errorSha256 = await fileHash(errorPath);
        const { stdout, stderr, ...record } = result;
        for (const entry of group.entries) {
          const ownLog = path.join(runDirectory, `${entry.check.id}.log`), ownError = path.join(runDirectory, `${entry.check.id}.stderr.log`);
          if (ownLog !== logPath) { await fs.promises.copyFile(logPath, ownLog); await fs.promises.copyFile(errorPath, ownError); }
          records[entry.index] = { featureId: entry.feature.id, checkId: entry.check.id, area: entry.feature.area,
            level: entry.check.level, executable: entry.check.executable, args, ...record, reused,
            executionStatus: reused ? 'reused' : 'executed',
            executionReason: reused ? 'unchanged declared inputs and passing evidence' : handle?.reason ||
              (group.native && config.reuseNativeChecks === false ? 'native reuse disabled' : 'no reusable passing evidence'),
            ...(key ? { cacheKey: key } : {}), durationMs: performance.now() - started, startedUtc, completedUtc: new Date().toISOString(), logPath: ownLog, errorPath: ownError };
        }
        receipt.checks = records.filter(Boolean);
        await persist();
        if (result.exitCode !== 0 || result.signal != null || result.error) throw Error(`Receipt mandatory check failed: ${check.id} (exit ${result.exitCode})`);
    };
    const sourceGroups = [...shared.values()].filter(group => !group.native);
    let cursor = 0, executionError;
    await Promise.all(Array.from({ length: Math.min(concurrency, sourceGroups.length) }, async () => {
      while (!executionError && cursor < sourceGroups.length) {
        const group = sourceGroups[cursor++];
        try { await runGroup(group); } catch (error) { executionError ??= error; }
      }
    }));
    if (executionError) throw executionError;
    const nativeSchedule = scheduleNativeGroups([...shared.values()].filter(group => group.native));
    receipt.nativeExecutionOrder = nativeSchedule.flatMap(group => group.entries.map(entry => entry.check.id));
    for (const group of nativeSchedule) await runGroup(group);
    identityStarted = performance.now();
    if (!same(receipt.inputs, await identity(config, manifest, rulesFor(config), features, execution))) throw Error('Inputs changed during verification');
    receipt.timings.identityAfterMs = performance.now() - identityStarted;
    receipt.status = 'passed';
    expectedReceipt(manifest, features, receipt);
    await publishPassingCaches(false);
  } catch (error) {
    receipt.status = 'failed'; receipt.error = error.message;
    // A failed overall run may retain independent passing check evidence, never a passing receipt.
    try { if (receipt.inputs) await publishPassingCaches(true, true); }
    catch (cacheError) { receipt.cachePublicationError = cacheError.message; }
  }
  finally {
    for (const entry of cacheHandles) {
      const summary = cacheSummary(entry.kind);
      await entry.handle.close().catch(error => summary?.deferred.push({ checkId: entry.group.check.id, reason: error.message }));
      for (const reason of entry.handle.deferred || []) if (!summary.deferred.includes(reason)) summary.deferred.push(reason);
    }
    if (activeCacheCheckIds) {
      try { const cleanup = await verificationCache.pruneRemovedChecks({ projectRoot: config.projectRoot,
        checkIds: activeCacheCheckIds }); receipt.cache.deferred.push(...cleanup.deferred); }
      catch (error) { receipt.cache.deferred.push({ operation: 'final removed-check cleanup', reason: error.message }); }
    }
    if (activeCargoCheckIds) {
      try { const cleanup = await cargoCache.pruneRemovedChecks({ ...cargoCache.options(config), checkIds: activeCargoCheckIds }); receipt.cargoCache.deferred.push(...cleanup.deferred); }
      catch (error) { receipt.cargoCache.deferred.push({ operation: 'final removed-check cleanup', reason: error.message }); }
    }
    if (activeNativeCheckIds) {
      try { const cleanup = await nativeCache.pruneRemovedChecks({ ...nativeCache.options(config), checkIds: activeNativeCheckIds });
        receipt.nativeCache.deferred.push(...cleanup.deferred); }
      catch (error) { receipt.nativeCache.deferred.push({ operation: 'final removed-check cleanup', reason: error.message }); }
    }
  }
  receipt.completedUtc = new Date().toISOString();
  if (receipt.status === 'failed') {
    const done = new Set(receipt.checks.map(check => check.checkId));
    receipt.skipped = features ? features.flatMap(feature => phaseChecks(feature, config.checkPhase).filter(check => !done.has(check.id)).map(check => ({ checkId: check.id, reason: 'blocked by failed prerequisite' }))) : [];
  }
  if (receipt.timings) receipt.timings.totalMs = performance.now() - runStarted;
  await persist();
  return { ...receipt, receiptPath };
}
async function verifyReceipt(config) {
  config = { ...config, outputDirectory: config.outputDirectory ?? path.dirname(path.resolve(config.receiptPath)) };
  const manifest = config.manifest ?? loadManifest(config.projectRoot), rules = rulesFor(config);
  validateManifest(manifest, config.projectRoot, rules);
  const receipt = readJson(config.receiptPath);
  if ((config.checkPhase ?? 'all') !== (receipt.checkPhase ?? 'all')) throw Error('Receipt check phase differs');
  if (config.area && config.area !== receipt.area) throw Error('Receipt selected area differs');
  config.area = config.area ?? receipt.area;
  const features = selected(manifest, config.area, config);
  expectedReceipt(manifest, features, receipt);
  await verifyLogs(receipt);
  await fs.promises.mkdir(config.outputDirectory, { recursive: true });
  const inputs = await identity(config, manifest, rules, features, config.execute ?? execute);
  if (!same(receipt.inputs, inputs) || (config.expectedInputs && !same(config.expectedInputs, inputs))) throw Error('Preservation receipt input identity is stale');
  return { ...receipt, receiptPath: path.resolve(config.receiptPath) };
}
async function packageState(config) {
  const rawReceipt = readJson(config.receiptPath);
  if (!['ui', 'all'].includes(rawReceipt.area)) throw Error('UI passing receipt required for package binding');
  const receipt = await verifyReceipt(config);
  const manifest = config.manifest ?? loadManifest(config.projectRoot), report = readJson(config.reportPath);
  validateTransformReport(manifest, report);
  if (!same(report.transformRules, rulesFor(config))) throw Error('Transformation report rules differ from verified inputs');
  if (!same(report.sourceUi, await sourceUiIdentity(config))) throw Error('Transformation report pristine UI identity differs');
  return { schema: 1, receiptPath: path.resolve(config.receiptPath), reportPath: path.resolve(config.reportPath), packagePath: path.resolve(config.packagePath),
    receiptSha256: await fileHash(config.receiptPath), reportSha256: await fileHash(config.reportPath), packageSha256: await fileHash(config.packagePath), inputs: receipt.inputs };
}
async function bindPackage(config) {
  const binding = await packageState(config);
  const bindingPath = config.bindingPath ?? `${config.packagePath}.preservation.json`;
  await fs.promises.writeFile(bindingPath, JSON.stringify(binding, null, 2) + '\n');
  return { ...binding, bindingPath };
}
async function verifyPackage(config) {
  const bindingPath = config.bindingPath ?? `${config.packagePath}.preservation.json`;
  const binding = readJson(bindingPath), current = await packageState(config);
  if (!same(binding, current)) throw Error('Package preservation binding is stale');
  return { ...binding, bindingPath, status: 'passed' };
}
module.exports = { loadManifest, validateManifest, validateTransformReport, runPreservation, bindPackage, verifyPackage, verifyReceipt, scheduleNativeGroups };
if (require.main === module) (async () => {
  const [action, flag, filename, ...extra] = process.argv.slice(2);
  if (!['run', 'bind', 'verify', 'verify-receipt'].includes(action) || flag !== '--config' || !filename || extra.length) throw Error('Usage: feature-preservation.cjs run|bind|verify|verify-receipt --config <JSON>');
  const config = readJson(filename);
  if (config.execute || config.identityProvider || config.manifest || config.transformRules) throw Error('Test injection is unavailable in CLI configuration');
  const result = await ({ run: runPreservation, bind: bindPackage, verify: verifyPackage, 'verify-receipt': verifyReceipt })[action](config);
  process.stdout.write(JSON.stringify(result) + '\n');
  if (result.status === 'failed') process.exitCode = 1;
})().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
