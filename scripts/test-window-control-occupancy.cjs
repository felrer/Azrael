'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fork } = require('node:child_process');
const { once } = require('node:events');
const { createWindowOwner } = require('./window-control-policy.cjs');
const { createRegistry, publicOccupancy, commonDirectory } = require('./window-control-occupancy.cjs');
const window = { hwnd: '101', pid: 4, processCreated: '123', executable: 'C:\\Apps\\test.exe', title: 'Same title', minimized: false, widthPx: 800, heightPx: 600, dpi: 96 };
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'window-occupancy-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const directory = path.join(root, 'shared');
  const owner = (name, backend = { request: async (method,params) => method === 'listWindows' ? [window] : {...window,...params.window} }) => {
    const value = createWindowOwner({ backend, authorize: async () => true, codexHome: path.join(root, name), occupancyDirectory: directory, workspaceName: name });
    t.after(() => value.dispose()); return value;
  };
  return { root, directory, owner };
}
if (process.argv[2] !== 'occupancy-child') {
test('different code homes share exact identity occupancy; same session and other threads differ', async t => {
  const f = fixture(t), a = f.owner('Workspace A'), b = f.owner('Workspace B');
  assert.equal((await b.call('b', 'list_windows', {})).candidates[0].occupancy.status, 'available');
  await a.bind('a', window);
  let value = (await b.call('b', 'list_windows', {})).candidates[0].occupancy;
  assert.equal(value.status, 'occupied'); assert.deepEqual(value.sessions.map(s => [s.sessionId,s.workspaceName,s.state,s.isCurrentSession]), [['a','Workspace A','selected',false]]);
  assert.equal((await a.status('a')).occupancy.status, 'available');
  assert.equal((await a.listWindows('other-thread'))[0].occupancy.status, 'occupied');
  // Advisory information does not reject another binding.
  await b.bind('b', window); assert.equal((await a.status('a')).occupancy.status, 'occupied');
  assert.deepEqual((await a.status('a')).occupancy.sessions.map(s => s.isCurrentSession).sort(), [false,true]);
  b.clear('b'); assert.equal((await a.status('a')).occupancy.status, 'available');
  for (const changed of [{hwnd:'102'}, {pid:5}, {processCreated:'124'}, {executable:'C:\\Apps\\other.exe'}]) {
    await b.bind('b', {...window,...changed}); assert.equal((await a.status('a')).occupancy.status, 'available');
  }
  await b.bind('b', window); b.dispose(); assert.equal((await a.status('a')).occupancy.status, 'available');
  a.clear('a'); assert.equal(fs.readdirSync(f.directory).filter(f => f.endsWith('.json')).length, 0);
});
test('the same session id in another host remains an occupying other session', async t => {
  const f = fixture(t), a = f.owner('Workspace A'), b = f.owner('Workspace B');
  await a.bind('same-thread',window); await b.bind('same-thread',window);
  for (const [owner,name] of [[a,'Workspace A'],[b,'Workspace B']]) {
    const value = (await owner.status('same-thread')).occupancy;
    assert.equal(value.status,'occupied');
    assert.equal(value.sessions.length,2);
    assert.deepEqual(value.sessions.filter(s=>s.isCurrentSession).map(s=>s.workspaceName),[name]);
    assert.equal(value.sessions.filter(s=>!s.isCurrentSession).length,1);
    assert.ok(value.sessions.every(s=>s.sessionId==='same-thread'));
  }
  b.dispose(); assert.equal((await a.status('same-thread')).occupancy.status,'available');
});
test('running and paused bindings persist; clearing or disposal cancels pending publication', async t => {
  const f = fixture(t); let release, fail = false;
  const a = f.owner('A', { request: async method => {
    if (method === 'inspect') { await new Promise(resolve => { release = resolve; }); if (fail) throw new Error('Native failure'); return {window,observationId:'o',elementsTruncated:false,elements:[]}; }
    return method === 'listWindows' ? [window] : window;
  } }), b = f.owner('B');
  let bound = await a.bind('a',window), pending = a.call('a','inspect',{targetId:bound.targetId});
  while (!release) await new Promise(resolve => setImmediate(resolve));
  assert.equal((await b.listWindows('b'))[0].occupancy.sessions[0].state,'running');
  release(); await pending;
  assert.equal((await b.listWindows('b'))[0].occupancy.sessions[0].state,'ready');
  a.stop('a'); assert.equal((await b.listWindows('b'))[0].occupancy.sessions[0].state,'paused');
  bound = await a.bind('a',window); release = undefined; fail = true;
  pending = a.call('a','inspect',{targetId:bound.targetId});
  while (!release) await new Promise(resolve => setImmediate(resolve)); release(); await assert.rejects(pending,/Native failure/);
  assert.equal((await b.listWindows('b'))[0].occupancy.sessions[0].state,'paused');
  bound = await a.bind('a',window); release = undefined; fail = false;
  pending = a.call('a','inspect',{targetId:bound.targetId});
  while (!release) await new Promise(resolve => setImmediate(resolve));
  const queuedBind = a.bind('a',window); a.clear('a'); release();
  await assert.rejects(pending,/cancelled/); await assert.rejects(queuedBind,/cancelled/);
  assert.equal((await b.listWindows('b'))[0].occupancy.status,'available');
  bound = await a.bind('a',window); release = undefined; pending = a.call('a','inspect',{targetId:bound.targetId});
  while (!release) await new Promise(resolve => setImmediate(resolve)); a.dispose(); release(); await assert.rejects(pending,/cancelled/);
  assert.equal((await b.listWindows('b'))[0].occupancy.status,'available');
});
test('bounded records ignore expiry, dead hosts and temp files; corruption or read failure is unknown', t => {
  const f = fixture(t); let clock = 1000;
  const a = createRegistry({directory:f.directory,now:()=>clock,entries:()=>[{sessionId:'a',workspaceName:'A',state:'paused',window}]});
  const b = createRegistry({directory:f.directory,now:()=>clock,entries:()=>[]});
  t.after(()=>{a.dispose();b.dispose();});
  assert.equal(b.read(window,'b').status,'occupied'); clock = 31001; assert.equal(b.read(window,'b').status,'available');
  a.publish(); const dead = createRegistry({directory:f.directory,now:()=>clock,alive:()=>false,entries:()=>[]}); t.after(()=>dead.dispose());
  assert.equal(dead.read(window,'b').status,'available');
  fs.writeFileSync(path.join(f.directory,'ignored.tmp'),'malformed'); assert.equal(b.read(window,'b').status,'occupied');
  const corrupt = path.join(f.directory,'11111111-1111-1111-1111-111111111111.json'); fs.writeFileSync(corrupt,'{');
  assert.equal(b.read(window,'b').status,'unknown'); fs.unlinkSync(corrupt);
  fs.writeFileSync(corrupt,'x'.repeat(262145)); assert.equal(b.read(window,'b').status,'unknown'); fs.unlinkSync(corrupt);
  const read = fs.opendirSync; try { fs.opendirSync = () => { throw Object.assign(new Error('denied'),{code:'EACCES'}); }; assert.equal(b.read(window,'b').status,'unknown'); } finally { fs.opendirSync = read; }
  assert.equal(commonDirectory(),path.join(os.homedir(),'.azrael-ex','window-use','occupancy'));
  assert.throws(()=>publicOccupancy({status:'occupied',sessions:[]}),/Invalid/);
  assert.throws(()=>publicOccupancy({status:'unknown',sessions:[{sessionId:'s',workspaceName:'C:/secret',state:'ready',isCurrentSession:false,updatedAt:1}]}),/Invalid/);
});
test('a separate host process is visible across code homes and its exited record is ignored', async t => {
  const f = fixture(t), b = f.owner('Parent');
  const child = fork(__filename, ['occupancy-child',f.directory,path.join(f.root,'Child')], {stdio:['ignore','ignore','pipe','ipc']});
  t.after(()=>{if(child.exitCode === null) child.kill();});
  const [message] = await once(child,'message'); assert.equal(message,'selected');
  const value = (await b.listWindows('parent'))[0].occupancy;
  assert.equal(value.status,'occupied'); assert.equal(value.sessions[0].sessionId,'child'); assert.equal(value.sessions[0].workspaceName,'Child');
  const exited = once(child,'exit'); child.send('exit'); await exited;
  assert.equal(fs.readdirSync(f.directory).filter(f=>f.endsWith('.json')).length,1); // abandoned record remains owned by child
  assert.equal((await b.listWindows('parent'))[0].occupancy.status,'available');
});
test('heartbeat refreshes retained selection and disposal stops future publication', async t => {
  const f = fixture(t); let state = 'selected';
  const a = createRegistry({directory:f.directory,heartbeatMs:10,entries:()=>[{sessionId:'a',workspaceName:'A',state,window}]});
  const b = createRegistry({directory:f.directory,entries:()=>[]}); t.after(()=>{a.dispose();b.dispose();});
  state = 'paused'; await new Promise(resolve=>setTimeout(resolve,35));
  assert.equal(b.read(window,'b').sessions[0].state,'paused');
  a.dispose(); await new Promise(resolve=>setTimeout(resolve,35));
  assert.equal(b.read(window,'b').status,'available');
  assert.equal(fs.readdirSync(f.directory).filter(f=>f.endsWith('.json')).length,0);
});
}
if (process.argv[2] === 'occupancy-child') {
  const owner = createWindowOwner({backend:{request:async()=>window},authorize:async()=>true,codexHome:process.argv[4],occupancyDirectory:process.argv[3],workspaceName:'Child'});
  owner.bind('child',window).then(()=>process.send('selected'));
  process.on('message',()=>process.exit(0));
}
