import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createBoardServer } from '../server.mjs';
import { BoardError } from '../shared/model.mjs';
import { createDesignDocument, validateDesignDocument, DESIGN_LIMITS } from '../shared/design-model.mjs';
import { digest } from '../shared/context.mjs';

if (!process.env.DESIGN_RUN_ROOT) throw Error('Set DESIGN_RUN_ROOT to an isolated verification run directory.');
const fixture = resolve(process.env.DESIGN_RUN_ROOT, 'temporary/design-unit');
const definitionSource = await readFile(new URL('../design/board.json', import.meta.url), 'utf8');
const definition = JSON.parse(definitionSource);
const seed = () => createDesignDocument(definition);

async function setup(t, name, board = 'design') {
  const root = join(fixture, name, '자료'), configPath = join(fixture, name, 'settings.json');
  const app = await createBoardServer({ board, dataRoot: root, configPath });
  let closed = false;
  const close = async () => { if (!closed) { closed = true; await app.close(); } };
  t.after(close);
  const get = async () => (await fetch(app.origin + '/api/state')).json();
  const post = async (action, body, headers = {}) => {
    const response = await fetch(app.origin + '/api/' + action, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Board-Token': app.token,
        'X-Board-Storage': encodeURIComponent((await get()).storage.root), ...headers }, body: JSON.stringify(body)
    });
    return { status: response.status, body: await response.json() };
  };
  return { app, root, configPath, close, get, post };
}

function customize(doc) {
  doc.title = '한국어 디자인 비교';
  doc.devices.push({ id: 'custom-phone', name: '사용자 지정 휴대폰', width: 412, height: 915,
    safeArea: { top: 48, right: 8, bottom: 32, left: 8 } });
  doc.states.push({ id: 'review', name: '검토 중' });
  doc.backgrounds.push({ id: 'paper', name: '종이 배경', color: '#ece8da' });
  Object.assign(doc.items[0], { title: '첫 번째 시안', description: '크기와 상태를 비교합니다.',
    html: '<main><p>안녕하세요</p><svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg></main>',
    css: '[data-preview-state="review"] p{color:#334455}@media(max-width:450px){p{font-size:18px}}', note: '검토 메모: 여백 유지' });
  doc.sample = { width: 240, height: 160 };
  doc.settings = { deviceId: 'custom-phone', stateId: 'review', zoom: '50', background: '#ece8da',
    showSafeArea: true, selectedId: doc.items[0].id };
  return doc;
}

test('design schema rejects invalid identities, references, dimensions and source budgets', () => {
  assert.deepEqual(validateDesignDocument(customize(seed()), definition), customize(seed()));
  const cases = [
    ['duplicate item', d => d.items[1].id = d.items[0].id],
    ['unsafe identity', d => d.devices[0].id = '__proto__'],
    ['missing device', d => d.settings.deviceId = 'missing'],
    ['missing state', d => d.settings.stateId = 'missing'],
    ['missing selection', d => d.settings.selectedId = 'missing'],
    ['fractional width', d => d.devices[0].width = 390.5],
    ['small device', d => d.devices[0].height = 119],
    ['oversize device', d => d.devices[0].width = 4097],
    ['negative inset', d => d.devices[0].safeArea.left = -1],
    ['insets consume screen', d => { d.devices[0].width = 120; d.devices[0].safeArea.left = 60; d.devices[0].safeArea.right = 60; }],
    ['small sample', d => d.sample.width = 31],
    ['oversize sample', d => d.sample.height = 1025],
    ['invalid color', d => d.settings.background = 'red'],
    ['invalid zoom', d => d.settings.zoom = '200'],
    ['invalid toggle', d => d.settings.showSafeArea = 'true'],
    ['empty designs', d => d.items = []],
    ['source limit', d => d.items[0].html = 'x'.repeat(DESIGN_LIMITS.source + 1)],
    ['CSS limit', d => d.items[0].css = 'x'.repeat(DESIGN_LIMITS.source + 1)],
    ['collection limit', d => d.states = Array.from({ length: DESIGN_LIMITS.states + 1 }, (_, i) => ({ id: `s${i}`, name: '상태' }))],
    ['UTF-8 document budget', d => {
      d.items = Array.from({ length: 6 }, (_, i) => ({ ...d.items[0], id: `large${i}`,
        html: '한'.repeat(DESIGN_LIMITS.source), css: '글'.repeat(DESIGN_LIMITS.source) }));
      d.settings.selectedId = d.items[0].id;
    }]
  ];
  for (const [label, change] of cases) {
    const doc = seed(); change(doc);
    assert.throws(() => validateDesignDocument(doc, definition), BoardError, label);
  }
});

test('Korean custom presets, state CSS and preview settings survive save and server restart', async t => {
  const h = await setup(t, 'restart');
  const saved = await h.post('save', { document: customize((await h.get()).document), expectedRevision: 0 });
  assert.equal(saved.status, 200); assert.equal(saved.body.document.revision, 1);
  await h.close();
  const restarted = await createBoardServer({ board: 'design', dataRoot: h.root, configPath: h.configPath });
  t.after(() => restarted.close());
  const state = await (await fetch(restarted.origin + '/api/state')).json();
  assert.deepEqual(state.document, saved.body.document);
  assert.equal(state.storage.root, h.root);
  assert.ok((await readFile(join(h.root, 'document.json'), 'utf8')).includes('검토 메모'));
  assert.ok(!(await readFile(join(h.root, 'board.log'), 'utf8')).includes('검토 메모'));
});

test('stale, malformed and unauthorized writes preserve persisted document bytes', async t => {
  const h = await setup(t, 'denied');
  const saved = await h.post('save', { document: (await h.get()).document, expectedRevision: 0 });
  assert.equal(saved.status, 200);
  const bytes = await readFile(join(h.root, 'document.json'), 'utf8');
  assert.equal((await h.post('save', { document: saved.body.document, expectedRevision: 0 })).status, 409);
  const invalid = structuredClone(saved.body.document); invalid.settings.selectedId = 'missing';
  assert.equal((await h.post('save', { document: invalid, expectedRevision: 1 })).status, 400);
  const body = { document: saved.body.document, expectedRevision: 1 };
  assert.equal((await h.post('save', body, { 'X-Board-Token': 'invalid' })).status, 403);
  assert.equal((await h.post('save', body, { Origin: 'https://example.com' })).status, 403);
  assert.equal(await readFile(join(h.root, 'document.json'), 'utf8'), bytes);
});

test('static allowlist keeps private codecs unavailable and CSP frames scoped to the design board', async t => {
  const h = await setup(t, 'routes');
  const response = await fetch(h.app.origin + '/'); assert.equal(response.status, 200);
  assert.match(response.headers.get('content-security-policy'), /(?:^|;)\s*frame-src 'self' about:\s*(?:;|$)/);
  for (const path of ['/shared/design-context.mjs', '/shared/storage.mjs', '/api/unknown']) {
    assert.equal((await fetch(h.app.origin + path)).status, 404, path);
  }
  for (const path of ['/shared/design-model.mjs', '/shared/preview-document.mjs', '/shared/modules/device-preview.mjs',
    '/shared/modules/design-gallery.mjs', '/shared/modules/design-preview.css']) {
    assert.equal((await fetch(h.app.origin + path)).status, 200, path);
  }
  for (const board of ['prototype', 'catalog']) {
    const other = await setup(t, `csp-${board}`, board);
    const response = await fetch(other.app.origin + '/'); assert.equal(response.status, 200);
    assert.match(response.headers.get('content-security-policy'), /(?:^|;)\s*frame-src 'none'\s*(?:;|$)/, board);
  }
});

test('backup restore recovers custom source and settings under a new revision', async t => {
  const h = await setup(t, 'restore');
  const first = await h.post('save', { document: customize((await h.get()).document), expectedRevision: 0 });
  assert.equal(first.status, 200);
  const changed = structuredClone(first.body.document);
  changed.items[0].html = '<p>変更後</p>'; changed.devices[0].width = 1440; changed.settings.zoom = '100';
  const second = await h.post('save', { document: changed, expectedRevision: 1 });
  assert.equal(second.status, 200); assert.ok(second.body.backups.length);
  const restored = await h.post('restore', { backupId: second.body.backups[0].id, expectedRevision: 2 });
  assert.equal(restored.status, 200); assert.equal(restored.body.document.revision, 3);
  for (const key of ['items', 'devices', 'states', 'backgrounds', 'sample', 'settings']) {
    assert.deepEqual(restored.body.document[key], first.body.document[key], key);
  }
});

test('selected handoff freezes source, rules and hashes with a valid selectedId', async t => {
  const h = await setup(t, 'handoff');
  const saved = await h.post('save', { document: customize((await h.get()).document), expectedRevision: 0 });
  assert.equal(saved.status, 200);
  const sourceBytes = await readFile(join(h.root, 'document.json'), 'utf8');
  const selected = saved.body.document.items[1].id;
  const handed = await h.post('export', { expectedRevision: 1, itemIds: [selected] });
  assert.equal(handed.status, 200);
  const path = handed.body.handoff.jsonPath, bytes = await readFile(path, 'utf8'), snapshot = JSON.parse(bytes);
  assert.deepEqual(snapshot.selectedItemIds, [selected]);
  assert.deepEqual(snapshot.document.items, [saved.body.document.items[1]]);
  assert.equal(snapshot.document.settings.selectedId, selected);
  assert.deepEqual(validateDesignDocument(snapshot.document, definition), snapshot.document);
  assert.equal(snapshot.sourceDocumentSha256, digest(sourceBytes));
  assert.equal(snapshot.definitionSha256, digest(definitionSource));
  assert.equal(snapshot.rules.sha256, digest(snapshot.rules.content));
  assert.equal(snapshot.rules.content, await readFile(new URL('../design/rules.md', import.meta.url), 'utf8'));
  assert.equal(snapshot.sourceRevision, 1);
  const changed = structuredClone(saved.body.document); changed.items[1].html = '<p>새 내용</p>';
  assert.equal((await h.post('save', { document: changed, expectedRevision: 1 })).status, 200);
  assert.equal(await readFile(path, 'utf8'), bytes);
  for (const itemIds of [[], ['missing'], [selected, selected]]) {
    assert.equal((await h.post('export', { expectedRevision: 2, itemIds })).status, 400);
  }
});
