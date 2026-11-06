'use strict';
// Occupancy publication is advisory; createLeaseCoordinator separately arbitrates control.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const STATES = ['selected', 'ready', 'paused', 'running'];
const text = (v, max = 256) => typeof v === 'string' && v.length > 0 && v.length <= max && !/[\x00-\x1f]/.test(v);
const identity = w => w && text(w.hwnd) && Number.isSafeInteger(w.pid) && w.pid > 0 && text(w.processCreated) && text(w.executable, 32768);
const same = (a, b) => ['hwnd', 'pid', 'processCreated', 'executable'].every(k => a[k] === b[k]);
function publicOccupancy(value) {
  if (!value || !['available', 'occupied', 'unknown'].includes(value.status) || !Array.isArray(value.sessions) || value.sessions.length > 256) throw new Error('Invalid occupancy');
  const sessions = value.sessions.map(s => {
    if (!s || !text(s.sessionId) || !text(s.workspaceName) || /[\\/]/.test(s.workspaceName) || !STATES.includes(s.state) || typeof s.isCurrentSession !== 'boolean' || !Number.isSafeInteger(s.updatedAt) || s.updatedAt < 0) throw new Error('Invalid occupancy session');
    return Object.fromEntries(['sessionId', 'workspaceName', 'state', 'isCurrentSession', 'updatedAt'].map(k => [k, s[k]]));
  });
  if (value.status !== 'unknown' && value.status !== (sessions.some(s => !s.isCurrentSession) ? 'occupied' : 'available')) throw new Error('Invalid occupancy status');
  return { status: value.status, sessions };
}
const commonDirectory = () => path.join(os.homedir(), '.azrael-ex', 'window-use', 'occupancy');
function createRegistry({ directory, entries, now = Date.now, ttlMs = 30000, heartbeatMs = 5000, alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } } }) {
  const hostId = randomUUID(), filename = path.join(directory, hostId + '.json');
  let disposed = false, failed = false;
  function publish() {
    if (disposed) return;
    const temp = filename + '.' + randomUUID() + '.tmp';
    try {
      const sessions = entries();
      if (sessions.length > 256) throw new Error('Occupancy session limit');
      fs.mkdirSync(directory, { recursive: true });
      if (!sessions.length) { try { fs.unlinkSync(filename); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
      else {
        fs.writeFileSync(temp, JSON.stringify({ schema: 1, hostId, pid: process.pid, updatedAt: now(), sessions }), { flag: 'wx', mode: 0o600 });
        fs.renameSync(temp, filename);
      }
      failed = false;
    } catch { failed = true; }
    finally { try { fs.unlinkSync(temp); } catch {} }
  }
  function read(window, currentSession) {
    const sessions = []; let unknown = failed;
    try {
      const files = [], listing = fs.opendirSync(directory);
      try {
        let entry, scanned = 0;
        while ((entry = listing.readSync())) {
          if (++scanned > 1024) throw new Error('Occupancy directory limit');
          if (/^[a-f0-9-]{36}\.json$/.test(entry.name)) files.push(entry.name);
          if (files.length > 256) throw new Error('Occupancy record limit');
        }
      } finally { listing.closeSync(); }
      for (const file of files) {
        let fd;
        try {
          fd = fs.openSync(path.join(directory, file), 'r');
          if (!fs.fstatSync(fd).isFile()) throw new Error('Invalid record');
          const buffer = Buffer.alloc(262145), count = fs.readSync(fd, buffer, 0, buffer.length, 0);
          if (count > 262144) throw new Error('Record limit');
          const r = JSON.parse(buffer.subarray(0, count).toString('utf8'));
          if (r.schema !== 1 || r.hostId + '.json' !== file || !Number.isSafeInteger(r.pid) || r.pid <= 0 || !Number.isSafeInteger(r.updatedAt) || r.updatedAt < 0 || r.updatedAt > now() + 5000 || !Array.isArray(r.sessions) || r.sessions.length > 256) throw new Error('Invalid record');
          if (now() - r.updatedAt > ttlMs || !alive(r.pid)) continue;
          for (const s of r.sessions) {
            if (!identity(s.window)) throw new Error('Invalid identity');
            const projected = publicOccupancy({ status: 'unknown', sessions: [{ ...s, isCurrentSession: r.hostId === hostId && s.sessionId === currentSession, updatedAt: r.updatedAt }] }).sessions[0];
            if (same(window, s.window)) { if (sessions.length >= 256) throw new Error('Occupancy session limit'); sessions.push(projected); }
          }
        } catch (e) { if (e.code !== 'ENOENT') unknown = true; }
        finally { if (fd !== undefined) fs.closeSync(fd); }
      }
    } catch { unknown = true; }
    return { status: unknown ? 'unknown' : sessions.some(s => !s.isCurrentSession) ? 'occupied' : 'available', sessions };
  }
  publish();
  const timer = setInterval(publish, heartbeatMs); timer.unref();
  return { publish, read, dispose() { if (disposed) return; disposed = true; clearInterval(timer); try { fs.unlinkSync(filename); } catch {} } };
}
module.exports = { createRegistry, publicOccupancy, commonDirectory };

// mkdir is the cross-process atomic arbitration primitive. An occupied/uncertain
// mutex is never stolen. Busy records cannot expire, even after host failure.
function createLeaseCoordinator({directory, now = Date.now, idleMs = 30000, workspaceName = 'Azrael'}) {
  const owner = randomUUID(), held = new Map(), releasing = new Set(), known = new Map();
  const key = w => require('node:crypto').createHash('sha256').update(JSON.stringify(['hwnd','pid','processCreated','executable'].map(k=>w[k]))).digest('hex');
  function transaction(w, fn) {
    if(!identity(w))throw new Error('Invalid claim identity');
    fs.mkdirSync(directory,{recursive:true});
    if(!fs.lstatSync(directory).isDirectory()||fs.lstatSync(directory).isSymbolicLink())throw new Error('Invalid claim directory');
    if(!known.has(key(w))&&known.size>=1024)throw new Error('Window claim limit');
    known.set(key(w),w);
    const base=path.join(directory,key(w)), mutex=base+'.lock', record=base+'.json';
    fs.mkdirSync(mutex);
    try {
      let state;
      try {const stat=fs.lstatSync(record);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>262144)throw new Error('Invalid lease record');state=JSON.parse(fs.readFileSync(record,'utf8'));} catch(e) {if(e.code!=='ENOENT')throw e;state={epoch:randomUUID(),owner:null,session:null,busy:[],lastCompletedAt:0};}
      if(!text(state.epoch)||!(state.owner===null||text(state.owner))||!(state.session===null||text(state.session))||!Array.isArray(state.busy)||state.busy.length>256||state.busy.some(t=>!text(t))||!Number.isSafeInteger(state.lastCompletedAt)||state.lastCompletedAt<0)throw new Error('Invalid lease record');
      if(state.owner && !state.busy.length && now()-state.lastCompletedAt>=idleMs) state={epoch:randomUUID(),owner:null,session:null,busy:[],lastCompletedAt:0};
      const result=fn(state);
      // The mutex guards readers too, so an interrupted write fails closed.
      if(state.retired&&!state.owner&&!state.busy.length){try{fs.unlinkSync(record);}catch(e){if(e.code!=='ENOENT')throw e;}}else fs.writeFileSync(record,JSON.stringify(state),{mode:0o600});
      return result;
    } finally {fs.rmdirSync(mutex);}
  }
  const busy = () => require('./window-control-errors.cjs').windowError('window_busy','Window control is busy or unavailable',{actionExecuted:false});
  return {
    dispose() {for(const {session} of held.values())this.releaseSession(session);for(const w of known.values()){try{transaction(w,s=>{if(!s.owner&&!s.busy.length)s.retired=true;});}catch{}}},
    beginAction() {try{fs.mkdirSync(directory,{recursive:true});if(!fs.lstatSync(directory).isDirectory()||fs.lstatSync(directory).isSymbolicLink())throw new Error('Invalid claim directory');const mutex=path.join(directory,'physical-input.lock');fs.mkdirSync(mutex);let closed=false;return ()=>{if(!closed){fs.rmdirSync(mutex);closed=true;}};}catch{throw busy();}},
    read(w,session) {try{return transaction(w,s=>({status:s.owner&&!(s.owner===owner&&s.session===session)?'occupied':'available',sessions:s.owner?[{sessionId:s.session,workspaceName:text(s.workspaceName)?s.workspaceName:'Azrael',state:s.busy.length?'running':'ready',isCurrentSession:s.owner===owner&&s.session===session,updatedAt:s.lastCompletedAt}]:[]}));}catch{return {status:'unknown',sessions:[]};}},
    hasOther(w,session) {for(const [id,item] of held){if(item.session===session && id!==key(w)){try{if(transaction(item.window,s=>s.owner===owner&&s.session===session))return true;}catch{return true;}}}return false;},
    observation(w,session) {try{return transaction(w,s=>({epoch:s.epoch,usable:!s.owner||(s.owner===owner&&s.session===session)}));}catch{return {epoch:null,usable:false};}},
    begin(w,session,control,refreshIdle = true) {
      try{return transaction(w,s=>{
        const mine=s.owner===owner&&s.session===session;
        if(control&&s.owner&&!mine)throw busy();
        if(control&&!s.owner){s.owner=owner;s.session=session;s.workspaceName=workspaceName;releasing.delete(session);} if(control)held.set(key(w),{window:w,session});
        const token=randomUUID(), pinned=mine||control;
        if(pinned){if(s.busy.length>=256)throw busy();s.busy.push(token);}
        return {epoch:s.epoch,usable:!s.owner||mine||control,complete(){if(!pinned)return;transaction(w,current=>{if(current.epoch!==s.epoch||current.owner!==owner||current.session!==session)throw new Error('Lease identity changed');current.busy=current.busy.filter(t=>t!==token);if(refreshIdle)current.lastCompletedAt=now();if(!current.busy.length&&releasing.has(session)){current.owner=null;current.session=null;current.epoch=randomUUID();current.retired=true;}});}};
      });}catch(error){if(error.code==='window_busy')throw error;throw busy();}
    },
    pinSession(session,refreshIdle = false) {return [...held.values()].filter(item=>item.session===session).map(item=>this.begin(item.window,session,false,refreshIdle));},
    releaseSession(session) {releasing.add(session);for(const item of held.values())if(item.session===session)this.release(item.window,session);},
    release(w,session) {return transaction(w,s=>{if(s.owner===owner&&s.session===session&&!s.busy.length){s.owner=null;s.session=null;s.epoch=randomUUID();s.retired=true;}});},
  };
}
module.exports.createLeaseCoordinator = createLeaseCoordinator;
