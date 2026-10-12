import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createBoardServer } from '../server.mjs';
import { createDocument, createItem, validateDefinition, validateDocument } from '../shared/model.mjs';
import { digest, json } from '../shared/context.mjs';

const root = resolve('artifacts/verification/board-prototype-tests');
await mkdir(root, { recursive: true });
const fixture = await mkdtemp(join(root, 'run-'));
const definition = validateDefinition(JSON.parse(await readFile(new URL('../prototype/board.json', import.meta.url), 'utf8')));

test('model preserves stable IDs and rejects invalid field/category/coordinate data', () => {
  const document = createDocument(definition), item = createItem(definition);
  document.items.push(item);
  item.title = '바뀐 이름'; document.categories[0].name = '분류 이름 변경';
  assert.equal(validateDocument(document, definition).items[0].id, item.id);
  for (const change of [
    d => d.items[0].values.count = -1,
    d => d.items[0].values.priority = 'unknown',
    d => d.items[0].categoryId = 'missing',
    d => d.items[0].position.x = Infinity,
    d => d.items.push(structuredClone(d.items[0])),
    d => d.items[0].values.unlisted = 'ignored?',
    d => d.items[0].specifiedFields.push('unlisted'),
    d => d.map.unit = 'geo'
  ]) { const invalid = structuredClone(document); change(invalid); assert.throws(() => validateDocument(invalid, definition)); }
});

test('real HTTP/filesystem flow: save, reload, backup, conflict, restore, handoff and storage isolation', async t => {
  const originalRoot = join(fixture, 'original'), configPath = join(fixture, 'settings.json');
  let app = await createBoardServer({ dataRoot: originalRoot, configPath });
  const get = async path => { const response = await fetch(app.origin + path); return { status: response.status, body: await response.json() }; };
  const post = async (path, body, overrides = {}) => {
    const response = await fetch(app.origin + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Board-Token': app.token, 'X-Board-Storage': encodeURIComponent(app.storage.root), ...overrides }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  try {
    let state = (await get('/api/state')).body;
    const first = createItem(definition), second = createItem(definition);
    first.title = '한글 입력 저장'; first.note = 'DO_NOT_LOG_USER_NOTE'; first.position = { x: 123, y: 87 };
    second.title = '선택하지 않은 자료'; second.categoryId = state.document.categories[1].id;
    state.document.items.push(first, second);
    await t.test('invalid save does not create a document', async () => {
      const bad = structuredClone(state.document); bad.items[0].values.count = -1;
      assert.equal((await post('/api/save', { document: bad, expectedRevision: 0 })).status, 400);
      await assert.rejects(stat(join(originalRoot, 'document.json')), { code: 'ENOENT' });
    });
    await t.test('save Korean values and persist across server restart', async () => {
      const saved = await post('/api/save', { document: state.document, expectedRevision: 0 });
      assert.equal(saved.status, 200); state = saved.body; assert.equal(state.document.revision, 1);
      await app.close(); app = await createBoardServer({ dataRoot: originalRoot, configPath });
      const reload = (await get('/api/state')).body;
      assert.equal(reload.document.items[0].title, first.title); assert.deepEqual(reload.document.items[0].position, first.position);
    });
    await t.test('save automatically backs up previous state; stale and simultaneous writers are refused', async () => {
      state.document.items[0].note = '두 번째 저장';
      state.document.categories[0].name = '수정한 분류';
      state = (await post('/api/save', { document: state.document, expectedRevision: 1 })).body;
      assert.equal(state.document.revision, 2); assert.ok(state.backups.some(backup => backup.revision === 1));
      assert.equal((await post('/api/save', { document: state.document, expectedRevision: 1 })).status, 409);
      const racing = await Promise.all([post('/api/save', { document: state.document, expectedRevision: 2 }), post('/api/save', { document: state.document, expectedRevision: 2 })]);
      assert.deepEqual(racing.map(result => result.status).sort(), [200, 409]); state = (await get('/api/state')).body;
    });
    await t.test('restore preserves current data as backup and increments revision', async () => {
      const old = state.backups.find(backup => backup.revision === 1), previous = state.document.revision;
      const restored = await post('/api/restore', { backupId: old.id, expectedRevision: previous });
      assert.equal(restored.status, 200); state = restored.body;
      assert.equal(state.document.revision, previous + 1); assert.equal(state.document.items[0].note, first.note);
      assert.ok(state.backups.some(backup => backup.revision === previous));
    });
    await t.test('immutable handoff includes only selected items and exact definitions/rules', async () => {
      const exported = await post('/api/export', { expectedRevision: state.document.revision, itemIds: [first.id] });
      assert.equal(exported.status, 200);
      const snapshot = JSON.parse(await readFile(exported.body.handoff.jsonPath, 'utf8'));
      assert.deepEqual(snapshot.selectedItemIds, [first.id]); assert.equal(snapshot.document.items.length, 1);
      assert.equal(snapshot.sourceRevision, state.document.revision);
      assert.equal(snapshot.sourceDocumentSha256, digest(await readFile(state.storage.documentPath, 'utf8')));
      const folder = resolve(exported.body.handoff.jsonPath, '..');
      assert.equal(snapshot.definitionSha256, digest(await readFile(join(folder, 'board.json'), 'utf8')));
      assert.equal(snapshot.rules.sha256, digest(await readFile(join(folder, 'rules.md'), 'utf8')));
      const fixedBytes = await readFile(exported.body.handoff.jsonPath, 'utf8');
      state.document.items[0].title = '이후 편집';
      state = (await post('/api/save', { document: state.document, expectedRevision: state.document.revision })).body;
      assert.equal(await readFile(exported.body.handoff.jsonPath, 'utf8'), fixedBytes);
      assert.ok(exported.body.preview.includes(first.note)); assert.ok(!exported.body.preview.includes(second.title));
      assert.equal((await post('/api/export', { expectedRevision: state.document.revision, itemIds: [] })).status, 400);
    });
    await t.test('manual backup; corrupt restore preserves original and logs a causal code without note text', async () => {
      const backup = await post('/api/backup', { expectedRevision: state.document.revision });
      assert.equal(backup.status, 200); state = backup.body;
      const key = state.backups[0].id, backupPath = join(state.storage.backupDirectory, key + '.json');
      const record = JSON.parse(await readFile(backupPath, 'utf8')); record.document.items[0].title = '변조';
      await writeFile(backupPath, json(record));
      const before = await readFile(state.storage.documentPath, 'utf8');
      const result = await post('/api/restore', { backupId: key, expectedRevision: state.document.revision });
      assert.equal(result.status, 422); assert.equal(result.body.code, 'CORRUPT_BACKUP');
      assert.equal(await readFile(state.storage.documentPath, 'utf8'), before);
      const log = await readFile(state.storage.logPath, 'utf8');
      assert.ok(log.includes(result.body.requestId)); assert.ok(log.includes('CORRUPT_BACKUP')); assert.ok(!log.includes(first.note));
    });
    await t.test('origin/token/path boundaries and corrupt document refusal', async () => {
      assert.equal((await post('/api/backup', { expectedRevision: state.document.revision }, { 'X-Board-Token': 'invalid' })).status, 403);
      assert.equal((await post('/api/backup', { expectedRevision: state.document.revision }, { Origin: 'https://example.invalid' })).status, 403);
      assert.equal((await post('/api/restore', { backupId: '../document', expectedRevision: state.document.revision })).status, 400);
      assert.equal((await fetch(app.origin + '/shared/storage.mjs')).status, 404);
      assert.equal((await fetch(app.origin + '/server.mjs')).status, 404);
      const before = await readFile(state.storage.documentPath, 'utf8');
      await writeFile(state.storage.documentPath, '{invalid');
      assert.equal((await get('/api/state')).status, 422); assert.equal(await readFile(state.storage.documentPath, 'utf8'), '{invalid');
      await writeFile(state.storage.documentPath, before);
    });
    await t.test('invalid storage switch leaves old root; valid switch persists and rejects old tab writes', async () => {
      const corruptRoot = join(fixture, 'corrupt'); await mkdir(corruptRoot); await writeFile(join(corruptRoot, 'document.json'), '{invalid');
      assert.equal((await post('/api/storage', { root: corruptRoot })).status, 422); assert.equal(app.storage.root, originalRoot);
      assert.equal((await post('/api/storage', { root: 'relative/path' })).status, 400);
      const nextRoot = join(fixture, '한글 저장 폴더');
      const moved = await post('/api/storage', { root: nextRoot }); assert.equal(moved.status, 200);
      assert.equal(moved.body.document.revision, 0); assert.equal(moved.body.document.items.length, 0);
      assert.equal(JSON.parse(await readFile(configPath, 'utf8')).root, nextRoot);
      const stale = await post('/api/save', { document: createDocument(definition), expectedRevision: 0 }, { 'X-Board-Storage': encodeURIComponent(originalRoot) });
      assert.equal(stale.status, 409); assert.equal(stale.body.code, 'STORAGE_CHANGED');
      assert.ok((await stat(join(originalRoot, 'document.json'))).isFile());
      await app.close(); app = await createBoardServer({ configPath }); assert.equal(app.storage.root, nextRoot);
      assert.equal((await post('/api/save', { document: createDocument(definition), expectedRevision: 0 })).status, 200);
    });
    await t.test('filesystem failure refuses save instead of reporting success', async () => {
      assert.equal((await post('/api/storage', { root: join(fixture, 'filesystem-refusal') })).status, 200);
      await mkdir(join(app.storage.root, 'document.json'));
      const result = await post('/api/save', { document: createDocument(definition), expectedRevision: 0 });
      assert.equal(result.status, 409); assert.equal(result.body.code, 'UNSAFE_PATH');
    });
  } finally { await app.close(); }
});
