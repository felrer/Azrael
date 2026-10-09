'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function recentChatCheck() {
  const injector = require('./inject-recent-chat-filter.cjs');
  const root = process.env.AZRAEL_PRESERVATION_UI_ROOT || path.resolve(__dirname, '../artifacts/upstream-ui/26.930.61225');
  const source = fs.readFileSync(path.join(root, injector.ASSET), 'utf8');
  const result = injector.injectRecentChatFilter(source, injector.ASSET);
  // Execute the real header setup, including its declarations, so a renamed
  // local cannot silently shadow a query hook used earlier in the same scope.
  const ts = require(process.env.AZRAEL_PRESERVATION_TYPESCRIPT_PATH || require.resolve('typescript', { paths: [path.resolve(__dirname, '../extensions/azrael-ex')] }));
  const ast = ts.createSourceFile(injector.ASSET, result.text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const header = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'Fn');
  const setupEnd = header.body.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(d => d.name.getText(ast) === 'S')).end;
  const setup = result.text.slice(header.body.getStart(ast) + 1, setupEnd);
  const renderContext = { Bn: { c: () => Array(66).fill(Symbol()) }, h: () => ({ pathname: '/' }), Ln: () => {},
    $e: () => false, In: null, fe: () => ({ data: [] }), L: () => ({ data: [] }), Me: null,
    azraelRecentChatTasks: () => ['rendered-header'] };
  assert.deepEqual(Array.from(vm.runInNewContext(`(function(e){${setup};return S})({})`, renderContext)), ['rendered-header']);
  assert.throws(() => vm.runInNewContext(`(function(e){${setup.replace('C=u||Me==null,w;', 'C=u||Me==null,L;')};return S})({})`, renderContext), /before initialization/);
  assert.equal(result.count, 1);
  assert.equal(injector.injectRecentChatFilter(result.text, injector.ASSET).count, 0);
  assert.throws(() => injector.injectRecentChatFilter(source + source, injector.ASSET));
  const local = { kind: 'local', conversation: {} }, cloud = { kind: 'cloud' }, orphan = { kind: 'local' };
  let filter = 'recent';
  const environment = { id: 'selected' };
  // Resolve hook aliases from the actual pinned imports rather than inventing
  // callable mocks for similarly named module initializers.
  const importAliases = new Map(ast.statements.filter(ts.isImportDeclaration).flatMap(node =>
    node.importClause?.namedBindings?.elements?.map(e => [e.propertyName?.text ?? e.name.text, e.name.text]) ?? []));
  assert.equal(importAliases.get('Nat'), 'o');
  assert.equal(importAliases.get('tQ'), 'le');
  assert.match(injector.HELPER, /It\(\);let filter=o\(Pt\)/);
  assert.match(injector.HELPER, /environmentId=o\(Ft\).*environments}=le\(\)/);
  const context = { It: () => {}, Pt: 'filter', Ft: 'environment', o: atom => atom === 'filter' ? filter : 'selected', le: () => ({ data: [environment] }),
    fn: (_tasks, _conversations, selected) => { assert.equal(selected, environment); return [local, cloud, orphan]; },
    gn: { useMemo: action => action() }, yn: row => row.kind === 'cloud' };
  vm.createContext(context);
  vm.runInContext(injector.HELPER, context);
  assert.deepEqual(Array.from(context.azraelRecentChatTasks([], [])), [local, cloud, orphan]);
  filter = 'local'; assert.deepEqual(Array.from(context.azraelRecentChatTasks([], [])), [local]);
  filter = 'cloud'; assert.deepEqual(Array.from(context.azraelRecentChatTasks([], [])), [cloud]);
}
if (process.argv.includes('--recent-chat-check')) { recentChatCheck(); console.log('Recent chat filtering behavior passed'); }
else {
  const { test, after } = require('node:test');
  const gate = require('./feature-preservation.cjs');
  const artifactRoot = path.resolve(__dirname, '../artifacts/logs/feature-preservation');
  fs.mkdirSync(artifactRoot, { recursive: true });
  const ownedFixtureRoots = [];
  after(() => {
    for (const root of ownedFixtureRoots) {
      assert.equal(path.dirname(path.resolve(root)), artifactRoot);
      assert.ok(path.basename(root).startsWith('mock-'));
      fs.rmSync(root, { recursive: true });
    }
  });
  function setup() {
    const root = fs.mkdtempSync(path.join(artifactRoot, 'mock-'));
    ownedFixtureRoots.push(root);
    fs.mkdirSync(path.join(root, 'scripts')); fs.mkdirSync(path.join(root, 'docs')); fs.mkdirSync(path.join(root, 'ui'));
    for (const file of ['scripts/inject-fixture.cjs', 'scripts/check.cjs', 'scripts/engine.cjs', 'docs/contract.md']) fs.writeFileSync(path.join(root, file), 'fixture');
    fs.writeFileSync(path.join(root, 'scripts/inject-provider-model-picker.cjs'), 'module.exports = { PROVIDER_PICKER_ASSET: "picker.js" };');
    fs.writeFileSync(path.join(root, 'ui/package.json'), JSON.stringify({ version: '1.2.3' }));
    fs.writeFileSync(path.join(root, 'ui/picker.js'), 'pristine picker');
    const feature = (id, area, owner, field) => ({ id, area, owners: [owner], contract: 'docs/contract.md', reportFields: field ? [field] : [],
      checks: [{ id: `${id}.check`, executable: 'node', args: ['scripts/check.cjs'], level: area === 'ui' ? 'source' : 'native' }] });
    const manifest = { schema: 1, features: [feature('ui.fixture', 'ui', 'scripts/inject-fixture.cjs', 'fixtureEdits'), feature('engine.fixture', 'engine', 'scripts/engine.cjs')] };
    const config = { projectRoot: root, uiRoot: path.join(root, 'ui'), outputDirectory: path.join(root, 'output'), area: 'ui', manifest,
      transformRules: { 'inject-fixture.cjs': 'fixture-hash' }, identityProvider: async () => ({ candidate: 'original' }),
      execute: async (_executable, _args, options) => { fs.writeFileSync(options.logPath, 'check output'); fs.writeFileSync(options.errorPath, ''); return { exitCode: 0 }; } };
    return { root, manifest, config };
  }
  function reportFor(config, count = 1) {
    const sha = filename => require('node:crypto').createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
    return { assets: [{ fixtureEdits: count }], transformRules: config.transformRules, sourceUi: {
      version: '1.2.3', packageSha256: sha(path.join(config.uiRoot, 'package.json')), webviewSha256: sha(path.join(config.uiRoot, 'picker.js')) } };
  }
  test('inventory rejects missing coverage, duplicate IDs, missing checks and missing references', () => {
    const { root, manifest, config } = setup();
    assert.throws(() => gate.validateManifest(manifest, root, { 'inject-new.cjs': 'new' }), /Unregistered/);
    const duplicate = structuredClone(manifest); duplicate.features.push(duplicate.features[0]);
    assert.throws(() => gate.validateManifest(duplicate, root, config.transformRules), /Duplicate/);
    const noChecks = structuredClone(manifest); noChecks.features[0].checks = [];
    assert.throws(() => gate.validateManifest(noChecks, root, config.transformRules), /Missing checks/);
    const duplicateCheck = structuredClone(manifest); duplicateCheck.features[1].checks[0].id = duplicateCheck.features[0].checks[0].id;
    assert.throws(() => gate.validateManifest(duplicateCheck, root, config.transformRules), /Duplicate/);
    const absent = structuredClone(manifest); absent.features[0].owners = ['scripts/absent.cjs'];
    assert.throws(() => gate.validateManifest(absent, root, config.transformRules));
  });
  test('UI, engine and all select mandatory checks with actual exit codes and deduplicate identical commands', async () => {
    for (const area of ['ui', 'engine', 'all']) {
      const { config } = setup(); config.area = area;
      let commands = 0; const execute = config.execute; config.execute = async (...args) => { commands++; return execute(...args); };
      const receipt = await gate.runPreservation(config);
      assert.equal(receipt.status, 'passed'); assert.equal(receipt.checks.length, area === 'all' ? 2 : 1);
      assert.equal(commands, 1); assert(receipt.checks.every(check => check.exitCode === 0));
      assert(fs.existsSync(receipt.receiptPath));
    }
  });
  test('explicit subset uses manifest order and empty scope executes no behavioral checks', async () => {
    const { config, manifest } = setup(); config.area = 'all';
    const extra = structuredClone(manifest.features[0]); extra.id = 'ui.extra'; extra.checks[0].id = 'ui.extra.check';
    extra.checks[0].args.push('extra'); manifest.features.push(extra);
    let commands = 0; const execute = config.execute;
    config.execute = async (...args) => { commands++; return execute(...args); };
    const scoped = await gate.runPreservation({ ...config, featureIds: ['ui.extra', 'ui.fixture'] });
    assert.equal(scoped.status, 'passed', scoped.error);
    assert.deepEqual(scoped.featureIds, ['ui.fixture', 'ui.extra']);
    assert.equal(scoped.checks.length, 2); assert.equal(commands, 2);
    commands = 0;
    const empty = await gate.runPreservation({ ...config, featureIds: [] });
    assert.equal(empty.status, 'passed', empty.error);
    assert.deepEqual(empty.featureIds, []); assert.deepEqual(empty.checks, []); assert.equal(commands, 0);
    assert.equal((await gate.verifyReceipt({ ...config, featureIds: [], receiptPath: empty.receiptPath })).status, 'passed');
    await assert.rejects(gate.verifyReceipt({ ...config, receiptPath: empty.receiptPath }), /requested passing feature scope/);
    await assert.rejects(gate.verifyReceipt({ ...config, featureIds: ['ui.fixture'], receiptPath: empty.receiptPath }), /requested passing feature scope/);
    await assert.rejects(gate.verifyReceipt({ ...config, featureIds: ['ui.fixture'], receiptPath: scoped.receiptPath }), /requested passing feature scope/);
    await assert.rejects(gate.verifyReceipt({ ...config, receiptPath: scoped.receiptPath }), /requested passing feature scope/);
    for (const featureIds of [null, 'ui.fixture', [null], ['missing'], ['ui.fixture', 'ui.fixture'], ['engine.fixture']]) {
      const invalid = await gate.runPreservation({ ...config, area: 'ui', featureIds });
      assert.equal(invalid.status, 'failed'); assert.match(invalid.error, /featureIds|feature ID/);
    }
    const invalidRegistry = structuredClone(manifest); invalidRegistry.features[1].checks = [];
    const invalid = await gate.runPreservation({ ...config, manifest: invalidRegistry, featureIds: [] });
    assert.equal(invalid.status, 'failed'); assert.match(invalid.error, /Missing checks/);
  });
  test('empty package scope retains full report coverage and rejects differing requested selections', async () => {
    const { config, root, manifest } = setup();
    const extra = structuredClone(manifest.features[0]); extra.id = 'ui.extra'; extra.checks[0].id = 'ui.extra.check';
    extra.reportFields = ['extraEdits']; manifest.features.push(extra);
    const receipt = await gate.runPreservation({ ...config, featureIds: [] });
    const bindConfig = { ...config, featureIds: [], receiptPath: receipt.receiptPath,
      reportPath: path.join(root, 'report.json'), packagePath: path.join(root, 'candidate.vsix') };
    fs.writeFileSync(bindConfig.packagePath, 'package');
    fs.writeFileSync(bindConfig.reportPath, JSON.stringify(reportFor(config)));
    await assert.rejects(gate.bindPackage(bindConfig), /Missing transformation coverage: ui.extra/);
    const report = reportFor(config); report.assets[0].extraEdits = 1;
    fs.writeFileSync(bindConfig.reportPath, JSON.stringify(report));
    await gate.bindPackage(bindConfig); assert.equal((await gate.verifyPackage(bindConfig)).status, 'passed');
    const fullConfig = { ...bindConfig }; delete fullConfig.featureIds;
    await assert.rejects(gate.bindPackage(fullConfig), /requested passing feature scope/);
    await assert.rejects(gate.verifyPackage(fullConfig), /requested passing feature scope/);
    await assert.rejects(gate.verifyPackage({ ...bindConfig, featureIds: ['ui.fixture'] }), /requested passing feature scope/);
    fs.writeFileSync(bindConfig.packagePath, 'package drift');
    await assert.rejects(gate.verifyPackage(bindConfig), /stale/);
  });
  test('failed commands and changed identities produce retained failed receipts', async () => {
    const { config } = setup(); const execute = config.execute;
    config.execute = async (...args) => ({ ...await execute(...args), exitCode: 7 });
    const failed = await gate.runPreservation(config);
    assert.equal(failed.status, 'failed'); assert.equal(failed.checks[0].exitCode, 7);
    config.execute = execute; let generation = 0;
    config.identityProvider = async () => ({ candidate: ++generation });
    const drift = await gate.runPreservation(config);
    assert.equal(drift.status, 'failed'); assert.match(drift.error, /changed/);
  });
  test('bounded source pool deduplicates commands, retains stable records and serial native checks', async () => {
    const { config, manifest } = setup(); config.area = 'all'; config.sourceConcurrency = 3;
    const template = manifest.features[0];
    manifest.features = Array.from({ length: 7 }, (_, index) => ({ ...structuredClone(template), id: `ui.pool-${index}`,
      checks: [{ ...template.checks[0], id: `ui.pool-${index}.check`, args: ['scripts/check.cjs', String(index === 6 ? 0 : index)] }] }));
    for (let index = 0; index < 2; index++) manifest.features.push({ id: `engine.pool-${index}`, area: 'engine', owners: ['scripts/engine.cjs'],
      contract: 'docs/contract.md', reportFields: [], checks: [{ id: `engine.pool-${index}.check`, executable: 'node', args: ['scripts/check.cjs', `native-${index}`], level: 'native' }] });
    let active = 0, maxActive = 0, sourceCalls = 0, nativeCalls = 0;
    config.execute = async (_executable, args, options) => {
      active++; maxActive = Math.max(maxActive, active);
      const native = args[1].startsWith('native');
      if (native) { nativeCalls++; assert.equal(active, 1); } else sourceCalls++;
      await new Promise(resolve => setTimeout(resolve, native ? 2 : 15 - Number(args[1])));
      fs.writeFileSync(options.logPath, `real command result ${args[1]}`); fs.writeFileSync(options.errorPath, '');
      active--; return { exitCode: args[1] === '2' ? 9 : 0 };
    };
    const receipt = await gate.runPreservation(config);
    assert.equal(maxActive, 3); assert.equal(sourceCalls, 6); assert.equal(nativeCalls, 2);
    assert.equal(receipt.status, 'failed'); assert.equal(receipt.checks.length, 9);
    assert.deepEqual(receipt.checks.map(check => check.checkId), manifest.features.flatMap(feature => feature.checks.map(check => check.id)));
    assert.equal(receipt.checks[2].exitCode, 9); assert.equal(receipt.checks[6].exitCode, 0);
    assert.notEqual(receipt.checks[0].logPath, receipt.checks[6].logPath);
    assert.equal(fs.readFileSync(receipt.checks[0].logPath, 'utf8'), fs.readFileSync(receipt.checks[6].logPath, 'utf8'));
    assert.equal(JSON.parse(fs.readFileSync(receipt.receiptPath, 'utf8')).checks.length, 9);
    const invalid = await gate.runPreservation({ ...config, sourceConcurrency: 5 });
    assert.equal(invalid.status, 'failed'); assert.match(invalid.error, /sourceConcurrency/);
  });
  test('source execution supplies the effective default or selected parser path', async () => {
    for (const supplied of [false, true]) {
      const { config, root } = setup();
      if (supplied) config.typeScriptPath = path.join(root, 'selected-typescript.js');
      const execute = config.execute;
      config.execute = async (executable, args, options) => {
        assert.equal(options.env.AZRAEL_PRESERVATION_UI_ROOT, config.uiRoot);
        assert.equal(options.env.AZRAEL_PRESERVATION_TYPESCRIPT_PATH,
          supplied ? config.typeScriptPath : path.join(root, 'extensions/azrael-ex/node_modules/typescript/lib/typescript.js'));
        return execute(executable, args, options);
      };
      const receipt = await gate.runPreservation(config);
      assert.equal(receipt.status, 'passed', receipt.error);
    }
  });
  test('binding verifies full scope and rejects package, report, results and input drift', async () => {
    const { config, root } = setup(); const receipt = await gate.runPreservation(config);
    const bindConfig = { ...config, receiptPath: receipt.receiptPath, reportPath: path.join(root, 'report.json'), packagePath: path.join(root, 'candidate.vsix') };
    fs.writeFileSync(bindConfig.reportPath, JSON.stringify(reportFor(config))); fs.writeFileSync(bindConfig.packagePath, 'package');
    const binding = await gate.bindPackage(bindConfig); assert(fs.existsSync(binding.bindingPath));
    assert.equal((await gate.verifyPackage(bindConfig)).status, 'passed');
    fs.writeFileSync(bindConfig.packagePath, 'changed'); await assert.rejects(gate.verifyPackage(bindConfig), /stale/);
    fs.writeFileSync(bindConfig.packagePath, 'package'); fs.writeFileSync(bindConfig.reportPath, JSON.stringify(reportFor(config, 2)));
    await assert.rejects(gate.verifyPackage(bindConfig), /stale/);
    fs.writeFileSync(bindConfig.reportPath, JSON.stringify(reportFor(config)));
    await assert.rejects(gate.verifyPackage({ ...bindConfig, identityProvider: async () => ({ candidate: 'new' }) }), /identity is stale/);
    fs.writeFileSync(receipt.checks[0].logPath, 'modified results'); await assert.rejects(gate.verifyPackage(bindConfig), /evidence changed/);
  });
  test('missing coverage and engine-only receipt cannot bind UI packages', async () => {
    const { config, root, manifest } = setup();
    assert.throws(() => gate.validateTransformReport(manifest, { assets: [{}] }), /coverage/);
    const receipt = await gate.runPreservation({ ...config, area: 'engine' });
    await assert.rejects(gate.bindPackage({ ...config, receiptPath: receipt.receiptPath, reportPath: path.join(root, 'missing'), packagePath: path.join(root, 'missing') }), /UI passing receipt/);
  });
  test('receipt reuse verifies retained evidence and complete scope without rerunning checks', async () => {
    const { config } = setup(); const receipt = await gate.runPreservation(config);
    const verifyConfig = { ...config, receiptPath: receipt.receiptPath, outputDirectory: undefined,
      execute: async () => { throw Error('Behavior checks must not rerun'); } };
    assert.equal((await gate.verifyReceipt(verifyConfig)).status, 'passed');
    await assert.rejects(gate.verifyReceipt({ ...verifyConfig, identityProvider: async () => ({ candidate: 'changed' }) }), /identity is stale/);
    const original = fs.readFileSync(receipt.receiptPath, 'utf8');
    const missing = JSON.parse(original); missing.checks = []; fs.writeFileSync(receipt.receiptPath, JSON.stringify(missing));
    await assert.rejects(gate.verifyReceipt(verifyConfig), /mandatory checks missing/);
    fs.writeFileSync(receipt.receiptPath, original); fs.writeFileSync(receipt.checks[0].errorPath, 'tampered');
    await assert.rejects(gate.verifyReceipt(verifyConfig), /evidence changed/);
  });
  test('positive counters cannot bind reports for old rules or another pristine UI', async () => {
    const { config, root } = setup(); const receipt = await gate.runPreservation(config);
    const bindConfig = { ...config, outputDirectory: undefined, receiptPath: receipt.receiptPath,
      reportPath: path.join(root, 'report.json'), packagePath: path.join(root, 'candidate.vsix') };
    fs.writeFileSync(bindConfig.packagePath, 'package');
    const report = reportFor(config);
    fs.writeFileSync(bindConfig.reportPath, JSON.stringify({ ...report, transformRules: { 'inject-fixture.cjs': 'old' } }));
    await assert.rejects(gate.bindPackage(bindConfig), /report rules differ/);
    fs.writeFileSync(bindConfig.reportPath, JSON.stringify({ ...report, sourceUi: { ...report.sourceUi, version: 'old' } }));
    await assert.rejects(gate.bindPackage(bindConfig), /pristine UI identity differs/);
    fs.writeFileSync(bindConfig.reportPath, JSON.stringify(report));
    await gate.bindPackage(bindConfig); assert.equal((await gate.verifyPackage(bindConfig)).status, 'passed');
  });
  test('real Git inventory and directory identity compose with explicit mocked engine provenance', async () => {
    const { config, root, manifest } = setup();
    const { spawnSync } = require('node:child_process');
    fs.writeFileSync(path.join(root, '.gitignore'), 'artifacts/\n');
    for (const file of ['feature-preservation.cjs', 'directory-state.cjs', 'deployment-input-snapshot.cjs']) fs.writeFileSync(path.join(root, 'scripts', file), 'static identity fixture');
    fs.writeFileSync(path.join(root, 'scripts/azrael-feature-contracts.json'), JSON.stringify(manifest));
    const typescript = path.join(root, 'typescript.js'); fs.writeFileSync(typescript, 'fixture parser identity');
    const git = spawnSync('git', ['init', '--quiet', root], { encoding: 'utf8', shell: false, windowsHide: true });
    assert.equal(git.status, 0, git.stderr);
    const engineSourceRoot = path.join(root, 'selected-engine-source'), engineDirectory = path.join(root, 'selected-engine-binaries');
    fs.mkdirSync(engineSourceRoot); fs.mkdirSync(engineDirectory);
    fs.writeFileSync(path.join(engineSourceRoot, 'source.rs'), 'selected source'); fs.writeFileSync(path.join(engineDirectory, 'codex.exe'), 'synthetic binary');
    let provenanceCalls = 0, provenanceVersion = 'verified-selected-binary';
    const realConfig = { ...config, area: 'all', outputDirectory: path.join(root, 'artifacts/output'), typeScriptPath: typescript,
      transformRules: { ...config.transformRules, 'content-font-resource:provenance.json': 'resource-content-digest' },
      identityProvider: undefined, engineSourceRoot, engineDirectory, execute: async (_executable, args, options) => {
        const provenance = args[0].endsWith('engine-provenance.py');
        if (provenance) { provenanceCalls++; assert.equal(args[3], engineSourceRoot); assert.equal(args[5], engineDirectory); }
        const stdout = provenance ? JSON.stringify({ source: { sourceSha256: 'verified-selected-source' }, binaries: { 'codex.exe': provenanceVersion } }) : 'passing synthetic source check';
        fs.writeFileSync(options.logPath, stdout); fs.writeFileSync(options.errorPath, ''); return { exitCode: 0, stdout };
      } };
    const receipt = await gate.runPreservation(realConfig);
    assert.equal(receipt.status, 'passed', receipt.error);
    assert.match(receipt.inputs.projectSha256, /^[a-f0-9]{64}$/); assert.match(receipt.inputs.ui.sha256, /^[a-f0-9]{64}$/);
    assert.equal(receipt.inputs.ui.fileCount, 2); assert.equal(receipt.inputs.engine.sourceRoot, engineSourceRoot);
    assert.equal((await gate.verifyReceipt({ ...realConfig, receiptPath: receipt.receiptPath })).status, 'passed');
    provenanceCalls = 0;
    const emptyConfig = { ...realConfig, featureIds: [] };
    const empty = await gate.runPreservation(emptyConfig);
    assert.equal(empty.status, 'passed', empty.error); assert.deepEqual(empty.checks, []);
    assert.equal(provenanceCalls, 2, 'empty scope still checks provenance before and after');
    for (const key of ['manifestSha256', 'projectSha256', 'transformRules', 'ui', 'sourceUi', 'typeScriptSha256', 'engine'])
      assert.deepEqual(empty.inputs[key], receipt.inputs[key], `${key} is still bound`);
    assert.equal((await gate.verifyReceipt({ ...emptyConfig, receiptPath: empty.receiptPath })).status, 'passed');
    provenanceVersion = 'changed-binary';
    await assert.rejects(gate.verifyReceipt({ ...emptyConfig, receiptPath: empty.receiptPath }), /identity is stale/);
    provenanceVersion = 'verified-selected-binary';
    fs.writeFileSync(path.join(config.uiRoot, 'picker.js'), 'candidate drift');
    await assert.rejects(gate.verifyReceipt({ ...emptyConfig, receiptPath: empty.receiptPath }), /identity is stale/);
    await assert.rejects(gate.verifyReceipt({ ...realConfig, receiptPath: receipt.receiptPath }), /identity is stale/);
  });
  test('CLI retains failure and returns nonzero for incomplete manifest', async () => {
    const { root, config } = setup();
    const filename = path.join(root, 'config.json');
    fs.writeFileSync(filename, JSON.stringify({ projectRoot: root, outputDirectory: config.outputDirectory, area: 'ui' }));
    const { spawnSync } = require('node:child_process');
    const result = spawnSync(process.execPath, [path.join(__dirname, 'feature-preservation.cjs'), 'run', '--config', filename], { encoding: 'utf8', shell: false, windowsHide: true });
    assert.equal(result.status, 1);
    const receipt = JSON.parse(result.stdout);
    assert.equal(receipt.status, 'failed'); assert(fs.existsSync(receipt.receiptPath));
  });
}
