import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { createBoardServer } from '../server.mjs';
import { digest } from '../shared/context.mjs';
import { validateSketchDocument, selectScene } from '../shared/sketch-model.mjs';

const fixture = resolve('artifacts/verification/board-sketch-tests');
const logs = resolve('artifacts/logs/board-sketch');
await mkdir(fixture, { recursive: true }); await mkdir(logs, { recursive: true });
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const element = (id, type, props = {}) => ({ id, type, x: 100, y: 100, width: 120, height: 80, angle: 0, version: 1, isDeleted: false, ...props });
const doc = state => ({ ...structuredClone(state.document), scene: { ...structuredClone(state.document.scene), elements: [
  element('box', 'rectangle', { customData: { board: { categoryId: 'requirement', note: '입구를 더 넓게' } }, boundElements: [{ id: 'label', type: 'text' }, { id: 'arrow', type: 'arrow' }] }),
  element('label', 'text', { text: '입구', containerId: 'box' }),
  element('arrow', 'arrow', { points: [[0, 0], [150, 100]], startBinding: { elementId: 'box', focus: 0, gap: 0 }, endBinding: { elementId: 'image', focus: 0, gap: 0 } }),
  element('image', 'image', { fileId: 'pixel' }), element('unselected', 'text', { text: '참고 밖의 내용' })
], files: { pixel: { id: 'pixel', dataURL: png, mimeType: 'image/png', created: Date.now() } } } });
async function setup(name) {
  const root = join(fixture, name + '-' + crypto.randomUUID());
  const configPath = join(root, 'config.json');
  const app = await createBoardServer({ board: 'sketch', dataRoot: join(root, 'data'), configPath });
  let state = await (await fetch(app.origin + '/api/state')).json();
  const post = async (path, body, options = {}) => {
    const response = await fetch(app.origin + '/api/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Board-Token': app.token, 'X-Board-Storage': encodeURIComponent(options.root || state.storage.root), ...options.headers }, body: JSON.stringify(body) });
    const result = await response.json(); if (response.ok) state = result;
    return { status: response.status, result };
  };
  return { app, post, root, configPath, get state() { return state; } };
}

test('sketch persists Korean metadata, image and exact geometry across restart', async () => {
  const s = await setup('persistence');
  const document = doc(s.state); document.title = '게임 맵 의견';
  const saved = await s.post('save', { document, expectedRevision: 0 });
  assert.equal(saved.status, 200); assert.equal(s.state.document.revision, 1);
  const source = await readFile(s.state.storage.documentPath, 'utf8');
  await s.app.close();
  const restarted = await createBoardServer({ board: 'sketch', dataRoot: s.state.storage.root });
  try {
    const next = await (await fetch(restarted.origin + '/api/state')).json();
    assert.deepEqual(next.document.scene, document.scene); assert.equal(next.document.title, '게임 맵 의견');
    assert.equal(await readFile(next.storage.documentPath, 'utf8'), source);
  } finally { await restarted.close(); }
});

test('invalid raster, missing references and wrong category reject without overwriting saved document', async () => {
  const s = await setup('validation');
  try {
    await s.post('save', { document: doc(s.state), expectedRevision: 0 });
    const source = await readFile(s.state.storage.documentPath, 'utf8');
    for (const mutate of [d => { d.scene.files.pixel.dataURL = 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='; }, d => { d.scene.elements[0].boundElements[0].id = 'missing'; }, d => { d.scene.elements[0].customData.board.categoryId = 'missing'; }, d => { d.scene.elements[0].type = 'embeddable'; }]) {
      const bad = structuredClone(s.state.document); mutate(bad);
      const response = await s.post('save', { document: bad, expectedRevision: 1 });
      assert.equal(response.status, 400); assert.equal(response.result.code, 'INVALID_SKETCH');
      assert.equal(await readFile(s.state.storage.documentPath, 'utf8'), source);
    }
    assert.throws(() => validateSketchDocument({ ...s.state.document, scene: { ...s.state.document.scene, elements: Array(2001).fill(s.state.document.scene.elements[0]) } }, s.state.definition));
    const recoverable = structuredClone(s.state.document);
    recoverable.scene.elements.push(element('discarded-embed', 'embeddable', { isDeleted: true, link: 'https://example.com' }));
    const recovered = await s.post('save', { document: recoverable, expectedRevision: 1 });
    assert.equal(recovered.status, 200); assert.equal(recovered.result.document.scene.elements.some(e => e.id === 'discarded-embed'), false);
  } finally { await s.app.close(); }
});

test('simultaneous and stale writes preserve winner and backups restore complete scene with increasing revision', async () => {
  const s = await setup('conflict');
  try {
    const first = doc(s.state), second = doc(s.state); second.title = '다른 화면';
    const replies = await Promise.all([s.post('save', { document: first, expectedRevision: 0 }), s.post('save', { document: second, expectedRevision: 0 })]);
    assert.deepEqual(replies.map(r => r.status).sort(), [200, 409]);
    const winner = structuredClone(s.state.document);
    assert.equal((await s.post('backup', { expectedRevision: 1 })).status, 200);
    const backupId = s.state.backups[0].id;
    const changed = structuredClone(s.state.document); changed.scene.elements[0].x += 350; changed.title = '수정';
    assert.equal((await s.post('save', { document: changed, expectedRevision: 1 })).status, 200);
    assert.equal((await s.post('restore', { backupId, expectedRevision: 2 })).status, 200);
    assert.equal(s.state.document.revision, 3); assert.deepEqual(s.state.document.scene, winner.scene);
    assert.ok(s.state.backups.some(b => b.revision === 2));
  } finally { await s.app.close(); }
});

test('selected immutable handoff includes bound text/arrow endpoints/files, PNG and interpretation rules', async () => {
  const s = await setup('handoff');
  try {
    await s.post('save', { document: doc(s.state), expectedRevision: 0 });
    const response = await s.post('export', { expectedRevision: 1, itemIds: ['box'], previewImage: png });
    assert.equal(response.status, 200);
    const folder = dirname(response.result.handoff.jsonPath);
    const resultSource = await readFile(join(folder, 'result.json'), 'utf8');
    const result = JSON.parse(resultSource);
    assert.deepEqual(result.selectedItemIds, ['box']);
    assert.deepEqual(result.includedElementIds, ['box', 'label', 'arrow', 'image']);
    assert.equal(result.document.scene.elements.some(e => e.id === 'unselected'), false);
    assert.equal(result.document.scene.files.pixel.dataURL, png);
    assert.equal(result.sceneSha256, digest(await readFile(join(folder, 'scene.excalidraw'))));
    assert.equal(result.previewSha256, digest(await readFile(join(folder, 'preview.png'))));
    assert.equal(result.rules.sha256, digest(await readFile(join(folder, 'rules.md'))));
    assert.match(await readFile(join(folder, 'result.md'), 'utf8'), /preview.png/);
    const changed = structuredClone(s.state.document); changed.scene.elements[0].customData.board.note = '다음 버전';
    await s.post('save', { document: changed, expectedRevision: 1 });
    assert.equal(await readFile(join(folder, 'result.json'), 'utf8'), resultSource);
    assert.equal((await s.post('export', { expectedRevision: 2, itemIds: ['missing'] })).status, 400);
  } finally { await s.app.close(); }
});

test('selecting frame preserves all contents and selecting image includes only needed image', async () => {
  const s = await setup('selection');
  try {
    const d = doc(s.state);
    d.scene.elements.push(element('frame', 'frame'), element('child', 'rectangle', { frameId: 'frame' }));
    assert.deepEqual(selectScene(d, ['frame']).elements.map(e => e.id), ['frame', 'child']);
    assert.deepEqual(Object.keys(selectScene(d, ['image']).files), ['pixel']);
    assert.deepEqual(selectScene(d, ['unselected']).files, {});
  } finally { await s.app.close(); }
});

test('Korean storage switch reopens scenes without moving originals and rejects stale root', async () => {
  const s = await setup('location');
  try {
    await s.post('save', { document: doc(s.state), expectedRevision: 0 });
    const previousRoot = s.state.storage.root, original = await readFile(s.state.storage.documentPath, 'utf8');
    const newRoot = join(s.root, '새 저장 위치');
    assert.equal((await s.post('storage', { root: newRoot })).status, 200);
    assert.equal(s.state.document.revision, 0);
    assert.equal((await s.post('save', { document: doc(s.state), expectedRevision: 0 }, { root: previousRoot })).status, 409);
    assert.equal((await s.post('save', { document: doc(s.state), expectedRevision: 0 })).status, 200);
    assert.equal((await s.post('storage', { root: previousRoot })).status, 200);
    assert.equal(await readFile(s.state.storage.documentPath, 'utf8'), original);
    const blocking = join(s.root, 'blocking-file'); await writeFile(blocking, 'keep');
    const bad = await s.post('storage', { root: join(blocking, 'child') }); assert.equal(bad.status, 500);
    const current = await (await fetch(s.app.origin + '/api/state')).json(); assert.equal(current.storage.root, previousRoot);
    const log = await readFile(current.storage.logPath, 'utf8'); assert.match(log, /request.failed/); assert.ok(!log.includes('입구를 더 넓게'));
  } finally { await s.app.close(); }
});

test('private sources, cross origin mutation and unauthenticated save remain denied', async () => {
  const s = await setup('boundaries');
  try {
    for (const path of ['/sketch/package.json', '/shared/sketch-context.mjs', '/shared/storage.mjs', '/sketch/app.jsx']) assert.equal((await fetch(s.app.origin + path)).status, 404);
    assert.equal((await s.post('save', { document: doc(s.state), expectedRevision: 0 }, { headers: { Origin: 'https://example.com' } })).status, 403);
    assert.equal((await s.post('save', { document: doc(s.state), expectedRevision: 0 }, { headers: { 'X-Board-Token': 'wrong' } })).status, 403);
    assert.equal(s.state.document.revision, 0);
  } finally { await s.app.close(); }
});
