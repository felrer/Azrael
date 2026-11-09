'use strict';

// Retained to catch concrete parser/security mistakes when editing this small
// Markdown implementation: removing fence/state handling, conflating term
// relations with synonyms, stale selection reads, and following linked inputs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const tool = require('./architecture.cjs');
const detailedSearch = (index, query, options = {}) => tool.search(index, query, { ...options, detail: true });

const managedRoot = process.env.ARCHITECTURE_SEARCH_TEST_ROOT;
const temporaryRoot = managedRoot ? path.resolve(managedRoot) : fs.mkdtempSync(path.join(os.tmpdir(), 'architecture-search-'));
fs.mkdirSync(temporaryRoot, { recursive: true });
let sequence = 0;
const standalone = [];
function fixture(documents = {}, terms = { schema: 1, concepts: [] }, features = []) {
  const root = path.join(temporaryRoot, `fixture-${process.pid}-${sequence++}`);
  fs.mkdirSync(path.join(root, 'docs/architecture/tools'), { recursive: true });
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  for (const [file, text] of Object.entries(documents)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
  fs.writeFileSync(path.join(root, 'docs/architecture/tools/terms.json'), JSON.stringify(terms));
  fs.writeFileSync(path.join(root, 'scripts/azrael-feature-contracts.json'), JSON.stringify({ schema: 1, features }));
  if (!managedRoot) standalone.push(root);
  return root;
}
// Managed fixtures belong to the caller's run owner. Standalone cleanup uses
// ordinary unlink/rmdir and never follows links or retries a failed deletion.
function removeOrdinary(file) {
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || !stat.isDirectory()) return fs.unlinkSync(file);
  for (const name of fs.readdirSync(file)) removeOrdinary(path.join(file, name));
  fs.rmdirSync(file);
}
test.after(() => { if (!managedRoot) { for (const root of standalone) removeOrdinary(root); fs.rmdirSync(temporaryRoot); } });

test('ATX parser ignores fenced headings and keeps direct body/parent positions', () => {
  const document = tool.parseDocument('docs/architecture/a.md', 'Status: `partial`\n# Root\nintro\n```md\n## False\n```\n## Child\nbody\n~~~\n# False too\n~~~\n');
  assert.deepEqual(document.sections.map(item => item.title), ['(preamble)', 'Root', 'Child']);
  const root = document.sections[1], child = document.sections[2];
  assert.equal(root.endLine, 6);
  assert.equal(child.startLine, 8);
  assert.equal(child.parent, root.id);
  assert.deepEqual(root.children.map(item => item.id), [child.id]);
  assert.equal(child.state.value, 'partial');
  assert.equal(child.state.provenance, 'inherited');
  assert.equal(child.state.line, 1);
});

test('Unicode, duplicate headings, explicit anchors and code-key heading slugs', () => {
  const document = tool.parseDocument('docs/architecture/a.md', '# 문서\n<a id="manual-anchor"></a>\n## 설정 `rootResumeWait`\nOne\n## 설정 `rootResumeWait`\nTwo\n## 설정 `rootResumeWait`\nThree');
  assert.equal(document.sections[1].anchor, '문서');
  assert.equal(document.sections[2].anchor, '설정-rootresumewait');
  assert.equal(document.sections[3].anchor, '설정-rootresumewait-1');
  assert.equal(document.sections[4].anchor, '설정-rootresumewait-2');
  assert.equal(document.anchors.get('manual-anchor'), document.sections[2].id);
});

test('declared state remains scoped, inherited provenance is preserved, unknown stays unknown', () => {
  const sections = tool.parseDocument('docs/architecture/a.md', '# Document\nStatus: `partial`\n## Now\n상태: `current`\n### Nested\ntext\n## Later\nStatus: `target`\n## Unspecified\ntext').sections;
  assert.deepEqual(sections.map(item => item.state.value), ['unknown', 'partial', 'current', 'current', 'target', 'partial']);
  assert.equal(sections[3].state.source, sections[2].id);
  assert.equal(sections[3].state.line, 4);
  assert.equal(tool.parseDocument('x.md', '# X\nStatus: `reference`').sections[1].state.value, 'reference');
  assert.equal(tool.parseDocument('x.md', '# X\n- 문서 상태: `reference-candidates`').sections[1].state.value, 'reference');
  assert.equal(tool.parseDocument('x.md', '# X\nStatus: reviewed').sections[1].state.value, 'unknown');
});

test('alias expansion excludes related and legacy words; exact IDs/code keys remain searchable', () => {
  const root = fixture({
    'docs/architecture/a.md': '# Primary\nCanonicalName handles windowUseEnabled.\n',
    'docs/architecture/b.md': '# Other\nRelatedOnly and OldName.\n'
  }, { schema: 1, concepts: [
    { id: 'primary', label: 'CanonicalName', aliases: ['별칭'], legacy: ['OldName'], related: ['other'], features: ['engine.test'] },
    { id: 'other', label: 'RelatedOnly' }
  ] }, [{ id: 'engine.test', contract: 'docs/architecture/a.md', owners: [], checks: [] }]);
  const index = tool.createIndex(root);
  assert.ok(detailedSearch(index, '별칭').items.some(item => item.title === 'Primary'));
  assert.ok(detailedSearch(index, '별칭').items.every(item => item.file !== 'docs/architecture/b.md'));
  assert.deepEqual(detailedSearch(index, '별칭').expansion[0].legacy, ['OldName']);
  assert.ok(detailedSearch(index, 'engine.test').items.some(item => item.title === 'Primary'));
  assert.equal(detailedSearch(index, 'windowUseEnabled').items[0].title, 'Primary');
  assert.equal(detailedSearch(index, 'not-present').total, 0);
  const legacy = detailedSearch(index, 'OLDNAME');
  assert.equal(legacy.expansion[0].matchKind, 'legacy');
  assert.equal(detailedSearch(index, '별칭').expansion[0].matchKind, 'equivalent');
  assert.ok(legacy.items.length > 0);
  assert.ok(legacy.items.every(item => item.file === 'docs/architecture/b.md'));
  assert.ok(legacy.items.every(item => item.featureMatches.length === 0));
});

test('search/read pagination, source bounds and stale expected hashes', () => {
  const file = 'docs/architecture/a.md';
  const root = fixture({ [file]: '# First\nabcdefghij\n## Second\nabcdefghij\n## Third\nabc' });
  let index = tool.createIndex(root);
  const first = detailedSearch(index, 'abc', { limit: 1 });
  assert.equal(first.items.length, 1);
  assert.equal(first.truncated, true);
  assert.equal(detailedSearch(index, 'abc', { limit: 1, offset: 1 }).offset, 1);
  const id = `${file}#first`, original = tool.read(index, id);
  assert.equal(tool.read(index, id, { offset: 2, limit: 4 }).content, 'cdef');
  assert.equal(original.startLine, 2);
  assert.equal(original.endLine, 2);
  assert.equal(original.children[0].id, `${file}#second`);
  assert.throws(() => tool.read(index, id, { limit: 24001 }), { code: 'INVALID_RANGE' });
  fs.writeFileSync(path.join(root, file), '# First\nchanged\n');
  assert.throws(() => tool.verifyObservations(index), { code: 'INPUT_CHANGED' });
  index = tool.createIndex(root);
  assert.throws(() => tool.read(index, id, { sha: original.sha }), { code: 'STALE_SECTION' });
  assert.equal(tool.read(index, id).content, 'changed\n');
  fs.writeFileSync(path.join(root, file), '# First\r\nexact body\r\n## Child\r\nchild\r\n');
  assert.equal(tool.read(tool.createIndex(root), id).content, 'exact body\r\n');
  fs.unlinkSync(path.join(root, file));
  assert.throws(() => tool.verifyObservations(index), { code: 'INPUT_CHANGED' });
  assert.throws(() => tool.read(tool.createIndex(root), id), { code: 'NOT_FOUND' });
});

test('file membership changes invalidate an observation', () => {
  const root = fixture({ 'docs/architecture/a.md': '# A' });
  const index = tool.createIndex(root);
  fs.writeFileSync(path.join(root, 'docs/architecture/new.md'), '# New');
  assert.throws(() => tool.verifyObservations(index), { code: 'INPUT_CHANGED' });
});

// Later metadata/relocation edits can accidentally infer facets from paths,
// drop legacy anchors or strip raw source while cleaning search text.
test('nested map/facets use owning metadata, stable IDs and exact source reads', () => {
  const file = 'docs/architecture/features/arbitrary/ui.md';
  const declaration = '<!-- architecture: {"id":"arch.clock.ui","layers":["ui","host"]} -->';
  const root = fixture({
    'docs/architecture/features/arbitrary/README.md': '# Clock\n<!-- architecture: {"id":"arch.clock.contract","feature":"clock","layers":["ui","host","engine"]} -->\nStatus: `partial`\n## Timing\nclock rules\n',
    [file]: `# Display\r\n${declaration}\r\noriginal body\r\n## Detail\r\nclock display\r\n## Override\r\n<!-- architecture: {"id":"arch.shared.override","feature":null,"layers":["tooling"]} -->\r\nshared policy\r\n`,
    'docs/architecture/shared.md': '# Shared\n<!-- architecture: {"id":"arch.shared","feature":null,"layers":["tooling"]} -->\nshared policy',
    'docs/architecture/legacy.md': '# Legacy\nclock body',
    'docs/architecture/tools/excluded.md': '# Excluded\nclock body'
  });
  const index = tool.createIndex(root);
  assert.equal(index.files.includes('docs/architecture/tools/excluded.md'), false);
  assert.equal(tool.map(index).total, 4);
  const engines = tool.map(index, { feature: ['clock'], layer: ['engine'] });
  assert.deepEqual(engines.items.map(item => item.id), ['arch.clock.contract']);
  const displays = tool.map(index, { feature: ['clock', 'missing'], layer: ['host', 'engine'] });
  assert.deepEqual(displays.items.map(item => item.id).sort(), ['arch.clock.contract', 'arch.clock.ui']);
  assert.deepEqual(Object.keys(displays.items[0]).sort(), ['feature', 'id', 'layers', 'title']);
  assert.equal(tool.map(index, { feature: ['null'] }).items[0].feature, null);
  assert.equal(tool.map(index, { feature: ['unknown'] }).items[0].id, 'docs/architecture/legacy.md#legacy');
  const selected = tool.read(index, 'arch.clock.ui');
  assert.equal(selected.content, `${declaration}\r\noriginal body\r\n`);
  assert.equal(selected.feature, 'clock');
  assert.deepEqual(selected.children.map(item => item.id), ['arch.clock.ui#detail', 'arch.shared.override']);
  assert.equal(tool.read(index, `${file}#display`).id, selected.id);
  assert.equal(tool.read(index, `${file}#detail`).id, 'arch.clock.ui#detail');
  assert.equal(tool.read(index, 'arch.clock.ui#detail').content, 'clock display\r\n');
  assert.equal(tool.read(index, 'arch.shared.override').feature, null);
  assert.equal(tool.search(index, 'original').items[0].id, 'arch.clock.ui');
  assert.deepEqual(Object.keys(tool.search(index, 'original').items[0]).sort(), ['feature', 'id', 'layers', 'title']);
  assert.equal('expansion' in tool.search(index, 'original'), false);
  assert.equal(tool.search(index, 'original', { detail: true }).items[0].excerpt.includes('architecture:'), false);
  assert.equal(tool.search(index, 'layers').total, 0);
  assert.ok(tool.search(index, 'clock', { feature: ['clock'], layer: ['engine'] }).items.every(item => item.layers.includes('engine')));
  assert.equal(tool.search(index, 'policy', { feature: ['null'], layer: ['tooling'] }).total, 2);
  assert.throws(() => tool.read(index, 'docs/architecture/moved-ui.md#display'), { code: 'NOT_FOUND' });
  assert.equal(tool.run(['map', '--feature', 'clock', '--layer', 'host'], root).total, 2);
  assert.equal(tool.run(['search', 'original', '--detail'], root).items[0].sha, selected.sha);
  assert.equal(tool.run(['map', '--limit', '1'], root).truncated, true);
  assert.throws(() => tool.run(['map', '--layer', 'database'], root), { code: 'INVALID_ARGUMENT' });
  assert.throws(() => tool.run(['map', '--detail'], root), { code: 'INVALID_ARGUMENT' });
});

test('metadata diagnostics expose duplicate IDs, invalid types, and feature overrides', () => {
  const root = fixture({
    'docs/architecture/feature/README.md': '# Owner\n<!-- architecture: {"id":"arch.owner","feature":"owner","layers":["engine"]} -->',
    'docs/architecture/feature/other.md': '# Other\n<!-- architecture: {"id":"arch.owner","feature":"other","layers":["ui"]} -->',
    'docs/architecture/bad-feature.md': '# Bad\n<!-- architecture: {"feature":42} -->',
    'docs/architecture/bad-layer.md': '# Bad\n<!-- architecture: {"layers":["database"]} -->',
    'docs/architecture/bad-json.md': '# Bad\n<!-- architecture: nope -->'
  });
  const result = tool.check(tool.createIndex(root), { limit: 100 });
  assert.equal(result.clean, false);
  assert.equal(result.items.filter(item => item.kind === 'invalid-metadata').length, 3);
  assert.ok(result.items.some(item => item.kind === 'duplicate-id' && item.id === 'arch.owner'));
  assert.ok(result.items.some(item => item.kind === 'feature-override' && item.feature === 'other'));
});

test('compact conflict status remains visible through local status overrides without classifying target as conflict', () => {
  const root = fixture({
    'docs/architecture/a.md': '# A\n<!-- architecture: {"id":"arch.a","feature":null,"layers":["engine"],"status":"partial"} -->\n## Disputed\n<!-- architecture: {"status":"conflict","priorStatus":"current","conflict":"b.md#b"} -->\ndisputed claim\n### Nested\nStatus: `current`\ndisputed detail\n## Future\nStatus: `target`\nfuture claim\n',
    'docs/architecture/b.md': '# B\n<!-- architecture: {"id":"arch.b","feature":null,"layers":["tooling"],"status":"conflict","priorStatus":"partial","conflict":"a.md#disputed"} -->\nconflict record\n## Own\n<!-- architecture: {"status":"conflict","priorStatus":"current","conflict":"a.md#future"} -->\nseparate claim'
  });
  const index = tool.createIndex(root);
  const disputed = tool.search(index, 'disputed').items;
  assert.equal(disputed.length, 2);
  assert.ok(disputed.every(item => item.status === 'conflict' && item.priorStatus === 'current' && item.conflict === 'b.md#b'));
  assert.equal(tool.read(index, 'arch.a#future').state.value, 'target');
  assert.equal(tool.read(index, 'arch.a#nested').state.source, 'arch.a#disputed');
  assert.equal(tool.read(index, 'arch.b#own').state.priorStatus, 'current');
  assert.equal(tool.read(index, 'arch.b#own').state.conflict, 'a.md#future');
  assert.equal(tool.read(index, 'arch.a').state.value, 'partial');
  assert.deepEqual(tool.map(index).items.find(item => item.id === 'arch.a').conflicts,
    { total: 2, ids: ['arch.a#disputed', 'arch.a#nested'], truncated: false });
  assert.equal(tool.map(index).items.find(item => item.id === 'arch.b').status, 'conflict');
  assert.ok(tool.check(index, { limit: 100 }).items.some(item => item.kind === 'conflict' && item.source === 'arch.a#disputed'));
});

test('reverse links retain exact/file-only provenance; changed scope adds only one incoming hop including moved references', () => {
  const root = fixture({
    'docs/architecture/feature/a.md': '# A\n<!-- architecture: {"id":"arch.a","feature":"a","layers":["engine"]} -->\n## Exact\nbody',
    'docs/architecture/b.md': '# B\n[File](feature/a.md)\n[Section](feature/a.md#exact)\n[Moved](old-a.md#exact)',
    'docs/architecture/c.md': '# C\n[Next](b.md)',
    'src.js': 'source'
  }, undefined, [{ id: 'engine.a', contract: 'docs/architecture/feature/a.md', owners: ['src.js'] }]);
  const index = tool.createIndex(root);
  const incoming = tool.related(index, 'arch.a', { direction: 'incoming', limit: 100 });
  const fileLink = incoming.items.find(item => item.type === 'link');
  assert.equal(fileLink.kind, 'local');
  assert.equal(fileLink.id, undefined);
  assert.equal(fileLink.source, 'docs/architecture/b.md#b');
  assert.equal(fileLink.sourceFile, 'docs/architecture/b.md');
  assert.equal(fileLink.line, 2);
  assert.equal(incoming.items.some(item => item.type === 'child'), false);
  const exact = tool.related(index, 'arch.a#exact', { direction: 'incoming', limit: 100 });
  assert.equal(exact.items.filter(item => item.type === 'link').length, 1);
  assert.equal(exact.items.find(item => item.type === 'link').kind, 'section');
  assert.equal(exact.items.find(item => item.type === 'link').id, 'arch.a#exact');
  const outgoing = tool.related(index, 'docs/architecture/b.md#b', { direction: 'outgoing', limit: 100 });
  assert.ok(outgoing.items.some(item => item.kind === 'missing-file' && item.href === 'old-a.md#exact'));
  assert.ok(outgoing.items.every(item => item.direction !== 'incoming'));
  const checked = tool.check(index, { changed: ['src.js'], limit: 100 });
  assert.deepEqual(checked.scope.incomingFiles, ['docs/architecture/b.md']);
  assert.deepEqual(checked.scannedFiles, ['docs/architecture/b.md', 'docs/architecture/feature/a.md']);
  assert.equal(checked.scope.incomingHops, 1);
  assert.ok(checked.items.some(item => item.kind === 'missing-file' && item.file === 'docs/architecture/old-a.md'));
  const moved = tool.check(index, { changed: ['docs/architecture/old-a.md'], limit: 100 });
  assert.deepEqual(moved.scannedFiles, ['docs/architecture/b.md']);
  assert.equal(moved.coverage, 'incomplete');
  assert.equal(tool.related(index, 'arch.a', { limit: 1 }).truncated, true);
});

test('related preserves section links and inventory contract, owners/checks with bounded pages', () => {
  const root = fixture({
    'docs/architecture/a.md': '# A\n[Other](b.md#b)\n[Site](https://example.com)\n',
    'docs/architecture/b.md': '# B\ntext', 'src.js': 'source'
  }, { schema: 1, concepts: [{ id: 'primary', label: 'Primary', features: ['engine.test'], related: ['other'] }, { id: 'other', label: 'Other' }] },
  [{ id: 'engine.test', contract: 'docs/architecture/a.md', owners: ['src.js'], checks: [{ id: 'test.check', executable: 'node', args: ['never-run.js'] }] }]);
  const index = tool.createIndex(root);
  const results = tool.related(index, 'docs/architecture/a.md#a', { limit: 100, detail: true });
  assert.ok(results.items.some(item => item.type === 'link' && item.id === 'docs/architecture/b.md#b'));
  assert.ok(results.items.some(item => item.type === 'owner' && item.file === 'src.js'));
  assert.ok(results.items.some(item => item.type === 'check' && item.id === 'test.check'));
  assert.ok(results.items.some(item => item.type === 'related-concept' && item.id === 'other'));
  const feature = tool.related(index, 'engine.test', { limit: 1 });
  assert.equal(feature.truncated, true);
  assert.equal(feature.items[0].type, 'concept');
  assert.ok(tool.related(index, 'primary', { limit: 100 }).items.some(item => item.type === 'contract'));
  // Section navigation must not re-expand unrelated glossary/owner/check bags
  // when later relationship changes add inventory data to the same contract.
  for (const direction of ['incoming', 'outgoing', 'both']) {
    const navigated = tool.run(['related', 'docs/architecture/a.md#a', '--direction', direction, '--limit', '100'], root);
    assert.ok(navigated.items.every(item => ['link', 'parent', 'child'].includes(item.type)));
    assert.ok(navigated.items.every(item => !('aliases' in item) && !('executable' in item)));
    if (direction !== 'both') assert.ok(navigated.items.every(item => item.direction === direction));
  }
  const expanded = tool.run(['related', 'docs/architecture/a.md#a', '--detail', '--limit', '1'], root);
  assert.equal(expanded.truncated, true);
  assert.equal(expanded.items.length, 1);
  assert.ok(tool.run(['related', 'docs/architecture/a.md#a', '--detail', '--limit', '100'], root).items.some(item => item.type === 'check'));
});

test('check diagnoses links/owners/terms, distinguishes findings and scopes changed paths', () => {
  const root = fixture({
    'docs/architecture/a.md': '# A\n[Missing](missing.md)\n[Bad anchor](b.md#absent)\n[Outside](../../../outside)\n[Drive](G:/credentials)\n[External](https://example.com)\n',
    'docs/architecture/b.md': '# B\n[Historical](../../work/missing.md)\n'
  }, { schema: 1, concepts: [{ id: 'term', label: 'Term', features: ['invalid'], related: ['absent'] }] }, [
    { id: 'engine.a', contract: 'docs/architecture/a.md', owners: ['a.js'] },
    { id: 'engine.b', contract: 'docs/architecture/b.md', owners: ['b.js'] }
  ]);
  const index = tool.createIndex(root), result = tool.check(index, { changed: ['a.js'], limit: 100 });
  assert.equal(result.clean, false);
  assert.deepEqual(result.affectedFeatures, ['engine.a']);
  assert.deepEqual(result.scannedFiles, ['docs/architecture/a.md']);
  assert.equal(result.coverage, 'complete');
  assert.deepEqual(result.unmappedChanged, []);
  for (const kind of ['missing-file', 'missing-anchor', 'unsafe', 'missing-owner', 'invalid-term-feature', 'invalid-term-related']) {
    assert.ok(result.items.some(item => item.kind === kind), kind);
  }
  assert.ok(result.references.items.some(item => item.kind === 'external'));
  assert.ok(tool.check(index, { changed: ['b.js'], limit: 100 }).items.some(item => item.kind === 'missing-file' && item.file === 'work/missing.md'));
  const unmapped = tool.check(index, { changed: ['unregistered.js'] });
  assert.deepEqual(unmapped.scannedFiles, []);
  assert.deepEqual(unmapped.affectedFeatures, []);
  assert.deepEqual(unmapped.unmappedChanged, ['unregistered.js']);
  assert.equal(unmapped.coverage, 'incomplete');
  assert.equal(unmapped.clean, false);
  assert.ok(unmapped.items.some(item => item.kind === 'unmapped-change' && item.file === 'unregistered.js'));
  const mixed = tool.check(index, { changed: ['a.js', 'unregistered.js'] });
  assert.deepEqual(mixed.scannedFiles, ['docs/architecture/a.md']);
  assert.equal(mixed.coverage, 'incomplete');
  const cleanRoot = fixture({ 'docs/architecture/a.md': '# A\n[Self](#a)' });
  assert.equal(tool.check(tool.createIndex(cleanRoot)).clean, true);
});

test('safe paths reject traversal, absolute and linked files; deleted changed paths allowed', t => {
  const root = fixture({ 'docs/architecture/a.md': '# A' });
  for (const file of ['../secret', 'docs/../secret', 'G:/credentials', '/etc/passwd', '\\\\server\\share']) {
    assert.throws(() => tool.safePath(root, file, { allowMissing: true }), { code: 'UNSAFE_PATH' });
  }
  assert.doesNotThrow(() => tool.safePath(root, 'deleted.js', { allowMissing: true }));
  const target = fixture({ 'docs/architecture/a.md': '# Other' });
  const link = path.join(root, 'linked');
  if (!managedRoot) { t.skip('Link check requires a managed run owner for junction cleanup'); return; }
  try { fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) { t.skip(`Symlink unavailable: ${error.code}`); return; } throw error; }
  assert.throws(() => tool.safePath(root, 'linked/docs/architecture/a.md'), { code: 'UNSAFE_PATH' });
  assert.throws(() => tool.check(tool.createIndex(root), { changed: ['linked/source.js'] }), { code: 'UNSAFE_PATH' });
  const nestedLink = path.join(root, 'docs/architecture/linked-documents');
  fs.symlinkSync(path.join(target, 'docs/architecture'), nestedLink, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(tool.createIndex(root).files.some(file => file.includes('linked-documents')), false);
  // The managed run owner removes this link through its verified-junction
  // procedure after consuming the fixtures. Keep the target and link protected.
});

test('CLI emits JSON errors/nonzero, no-match success and diagnostic success distinct from clean', () => {
  const root = fixture({ 'docs/architecture/a.md': '# A\n[Missing](missing.md)' });
  const invoke = args => spawnSync(process.execPath, [path.join(__dirname, 'architecture.cjs'), '--root', root, ...args], { encoding: 'utf8' });
  let result = invoke(['search', 'absent']);
  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).total, 0);
  result = invoke(['check']);
  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).clean, false);
  for (const args of [['search', 'a', '--limit', '0'], ['read', '../secret#x'], ['search', 'a', '--sha', 'x'], ['check', '--changed', '../secret'], ['search', 'a', '--unknown', 'x']]) {
    result = invoke(args);
    assert.equal(result.status, 1, args.join(' '));
    assert.ok(JSON.parse(result.stdout).error.code);
  }
  assert.match(tool.run(['--help']).help, /check exit 0/);
});
