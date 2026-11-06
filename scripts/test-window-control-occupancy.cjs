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
  t.after(() => fs.rmSync(root, { recursive: true }));
  const directory = path.join(root, 'shared');
  const owner = (name, backend = { request: async (method,params) => method === 'listWindows' ? [window] : {...window,...params.window} }) => {
    const value = createWindowOwner({ backend, authorize: async () => true, codexHome: path.join(root, name), occupancyDirectory: directory, workspaceName: name });
    t.after(() => value.dispose()); return value;
  };
  return { root, directory, owner };
}
if (process.argv[2] !== 'occupancy-child') {
test('observational native bindings do not acquire control occupancy', async t => {
  const f=fixture(t),a=f.owner('Workspace A'),b=f.owner('Workspace B');
  await a.bind('same-thread',window);await b.bind('same-thread',window);
  assert.deepEqual((await a.status('same-thread')).occupancy,{status:'available',sessions:[]});
  assert.equal((await b.call('other-thread','list_windows',{})).candidates[0].occupancy.status,'available');
  a.clear('same-thread');assert.equal((await b.status('same-thread')).occupancy.status,'available');
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
  assert.equal(value.status,'available'); assert.deepEqual(value.sessions,[]);
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
