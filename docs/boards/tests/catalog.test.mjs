import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createBoardServer } from '../server.mjs';
import { BoardError } from '../shared/model.mjs';
import { createCatalogDocument, validateCatalogDocument, applyCatalogAction } from '../shared/catalog-model.mjs';
import { filterCards } from '../shared/modules/card-browser.mjs';
import { digest } from '../shared/context.mjs';
if (!process.env.CATALOG_RUN_ROOT) throw Error('Use catalog-verify.mjs unit to isolate generated state.');
const fixture = resolve(process.env.CATALOG_RUN_ROOT, 'temporary/catalog-unit');
const definition = JSON.parse(await readFile(new URL('../catalog/board.json', import.meta.url), 'utf8'));
const seed = () => createCatalogDocument(definition);
async function setup(name) {
  const root = join(fixture, name, '자료'), configPath = join(fixture, name, 'settings.json');
  const app = await createBoardServer({ board: 'catalog', dataRoot: root, configPath });
  const get = async () => (await fetch(app.origin + '/api/state')).json();
  const post = async (action, body, options = {}) => {
    const response = await fetch(app.origin + '/api/' + action, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Board-Token': app.token, 'X-Board-Storage': encodeURIComponent((await get()).storage.root), ...options }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  return { app, get, post, root, configPath };
}

test('folder/list edits retain stable identity, original draft and item data', () => {
  const original = seed();
  let doc = applyCatalogAction(original, { type: 'folder.update', id: 'environment', name: '환경 자료', collapsed: true });
  assert.equal(doc.folders[0].id, original.folders[0].id);
  assert.equal(original.folders[0].name, '환경');
  doc = applyCatalogAction(doc, { type: 'folder.delete', id: 'environment' });
  assert.equal(doc.lists.find(list => list.id === 'city').folderId, null);
  doc = applyCatalogAction(doc, { type: 'list.delete', id: 'city' });
  assert.equal(doc.items.length, original.items.length);
  assert.equal(doc.items[0].listId, null);
  doc = applyCatalogAction(doc, { type: 'item.assign', ids: ['demo-01','demo-02'], listId: 'review' });
  assert.ok(doc.items.slice(0,2).every(item => item.listId === 'review'));
  doc = applyCatalogAction(doc, { type: 'list.move', id: 'review', direction: -1 });
  assert.equal(doc.items[0].title, original.items[0].title);
});

test('targeted drag moves reorder folders/lists and reparent atomically without changing cards', () => {
  const original=seed();
  let doc=applyCatalogAction(original,{type:'folder.move',id:'workbench',beforeId:'environment'});
  assert.deepEqual(doc.folders.map(f=>f.id),['workbench','environment']);
  doc=applyCatalogAction(doc,{type:'folder.move',id:'workbench',beforeId:null});
  assert.deepEqual(doc.folders.map(f=>f.id),original.folders.map(f=>f.id));
  doc=applyCatalogAction(doc,{type:'list.move',id:'forest',folderId:'environment',beforeId:'city'});
  assert.deepEqual(doc.lists.filter(l=>l.folderId==='environment').map(l=>l.id),['forest','city']);
  doc=applyCatalogAction(doc,{type:'list.move',id:'city',folderId:'workbench',beforeId:'review'});
  assert.deepEqual(doc.lists.filter(l=>l.folderId==='workbench').map(l=>l.id),['city','review']);
  doc=applyCatalogAction(doc,{type:'list.move',id:'city',folderId:null,beforeId:null});
  assert.equal(doc.lists.filter(l=>l.folderId===null).at(-1).id,'city');
  assert.deepEqual(doc.items,original.items);
  assert.equal(original.lists.find(l=>l.id==='city').folderId,'environment');
  for(const action of [
    {type:'folder.move',id:'environment',beforeId:'missing'},
    {type:'list.move',id:'city',folderId:'missing',beforeId:null},
    {type:'list.move',id:'city',folderId:'workbench',beforeId:'forest'}
  ])assert.throws(()=>applyCatalogAction(original,action),BoardError);
});

test('shared validation rejects dangling IDs, duplicate identities, invalid fields and limits', () => {
  for (const change of [
    doc => doc.lists[0].folderId = 'missing', doc => doc.items[0].listId = 'missing',
    doc => doc.items[0].id = doc.lists[0].id, doc => doc.lists[0].id = 'all',
    doc => doc.items[0].kind = 'embed', doc => doc.items[0].status = 'unknown',
    doc => doc.items[0].tags = ['same','same'], doc => doc.items[0].note = 'x'.repeat(5001),
    doc => doc.folders = Array.from({length:51}, (_,i)=>({id:'f'+i,name:'폴더',collapsed:false})),
    doc => doc.revision = 0.1
  ]) { const doc = seed(); change(doc); assert.throws(()=>validateCatalogDocument(doc,definition), BoardError); }
  assert.throws(()=>applyCatalogAction(seed(),{type:'item.assign',ids:['missing'],listId:null}),BoardError);
  assert.throws(()=>applyCatalogAction(seed(),{type:'item.update',id:'demo-01',changes:{id:'replaced'}}),BoardError);
});

test('card filters combine query, kind, state and list without mutating inputs', () => {
  const doc = seed(), before = structuredClone(doc.items);
  assert.deepEqual(filterCards(doc.items,{query:'DEMO-01',kind:'building',status:'approved',scope:'city'}).map(item=>item.id),['demo-01']);
  assert.equal(filterCards(doc.items,{query:'나무',kind:'building',status:'all',scope:'all'}).length,0);
  assert.equal(filterCards(doc.items,{query:'나무',kind:'prop',status:'all',scope:'forest'}).length,2);
  assert.equal(filterCards(doc.items,{query:'',kind:'all',status:'all',scope:'unassigned'}).length,3);
  assert.deepEqual(doc.items,before);
});

test('catalog persists Korean edits, relationships and all fields across actual restart', async t => {
  const h = await setup('restart'); t.after(()=>h.app.close());
  const doc = applyCatalogAction((await h.get()).document,{type:'item.update',id:'demo-01',changes:{title:'수정한 건물',note:'한글 메모',tags:['벽돌','한글']}});
  const saved = await h.post('save',{document:doc,expectedRevision:0}); assert.equal(saved.status,200); assert.equal(saved.body.document.revision,1);
  const restarted = await createBoardServer({board:'catalog',dataRoot:h.root,configPath:h.configPath});t.after(()=>restarted.close());
  assert.deepEqual((await (await fetch(restarted.origin+'/api/state')).json()).document,saved.body.document);
  assert.ok((await readFile(join(h.root,'document.json'),'utf8')).includes('한글 메모'));
  assert.ok(!(await readFile(join(h.root,'board.log'),'utf8')).includes('한글 메모'));
});

test('invalid and stale writes leave file bytes intact; private routes remain denied', async t => {
  const h = await setup('conflict');t.after(()=>h.app.close());
  const doc = (await h.get()).document;assert.equal((await h.post('save',{document:doc,expectedRevision:0})).status,200);
  const bytes = await readFile(join(h.root,'document.json'),'utf8');
  assert.equal((await h.post('save',{document:doc,expectedRevision:0})).status,409);
  const bad = (await h.get()).document;bad.items[0].listId='missing';
  assert.equal((await h.post('save',{document:bad,expectedRevision:1})).status,400);
  assert.equal(await readFile(join(h.root,'document.json'),'utf8'),bytes);
  assert.equal((await h.post('save',{document:doc,expectedRevision:1},{'X-Board-Token':'invalid'})).status,403);
  assert.equal((await h.post('save',{document:doc,expectedRevision:1},{Origin:'https://example.com'})).status,403);
  for(const path of ['/shared/storage.mjs','/shared/catalog-context.mjs','/api/unknown'])assert.equal((await fetch(h.app.origin+path)).status,404);
  for(const path of ['/shared/catalog-model.mjs','/shared/modules/card-browser.mjs','/shared/modules/folder-list.mjs','/shared/modules/catalog-widgets.css'])assert.equal((await fetch(h.app.origin+path)).status,200);
});

test('backup restores folder/list/item content using a new saved revision', async t => {
  const h = await setup('backup');t.after(()=>h.app.close());
  const first = await h.post('save',{document:(await h.get()).document,expectedRevision:0});
  const doc = applyCatalogAction(first.body.document,{type:'list.delete',id:'city'});
  const second = await h.post('save',{document:doc,expectedRevision:1});
  const restored = await h.post('restore',{backupId:second.body.backups[0].id,expectedRevision:2});
  assert.equal(restored.status,200);assert.equal(restored.body.document.revision,3);
  assert.deepEqual(restored.body.document.items,first.body.document.items);
  assert.deepEqual(restored.body.document.lists,first.body.document.lists);
});

test('handoff freezes selected cards, parent lists/folders and interpretation rules', async t => {
  const h = await setup('handoff');t.after(()=>h.app.close());
  const first = await h.post('save',{document:(await h.get()).document,expectedRevision:0});
  const handed = await h.post('export',{expectedRevision:1,itemIds:['demo-01']});assert.equal(handed.status,200);
  const path = handed.body.handoff.jsonPath, bytes = await readFile(path,'utf8'), snapshot=JSON.parse(bytes);
  assert.deepEqual(snapshot.document.items.map(item=>item.id),['demo-01']);
  assert.deepEqual(snapshot.document.lists.map(list=>list.id),['city']);
  assert.deepEqual(snapshot.document.folders.map(folder=>folder.id),['environment']);
  assert.equal(snapshot.rules.sha256,digest(snapshot.rules.content));assert.ok(snapshot.rules.content.includes('더미'));
  const changed=applyCatalogAction(first.body.document,{type:'item.delete',ids:['demo-01']});
  assert.equal((await h.post('save',{document:changed,expectedRevision:1})).status,200);
  assert.equal(await readFile(path,'utf8'),bytes);
  assert.equal((await h.post('export',{expectedRevision:2,itemIds:['missing']})).status,400);
});

test('storage switching preserves prior saved data and rejects unavailable destination', async t => {
  const h = await setup('storage');t.after(()=>h.app.close());
  const first=await h.post('save',{document:(await h.get()).document,expectedRevision:0});
  const impossible=join(fixture,'storage','file-destination');await writeFile(impossible,'file');
  assert.equal((await h.post('storage',{root:impossible})).status,500);assert.equal((await h.get()).storage.root,h.root);
  const switched=await h.post('storage',{root:join(fixture,'새 위치')});assert.equal(switched.status,200);assert.equal(switched.body.document.revision,0);
  assert.deepEqual(JSON.parse(await readFile(join(h.root,'document.json'),'utf8')),first.body.document);
});
