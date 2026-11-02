'use strict';
// An optional, hash-bound stage-2 provider. No input is sent during construction.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomUUID, createHash } = require('node:crypto');
const { StringDecoder } = require('node:string_decoder');
const { windowError } = require('./window-control-errors.cjs');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const FILES = ['azrael-virtual-input.exe', 'azrael-virtual-input-hook.dll', 'THIRD_PARTY_NOTICES.md'];
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
function checked(directory, name) {
  const root=path.resolve(directory);let cursor=path.parse(root).root;
  for(const part of root.slice(cursor.length).split(path.sep).filter(Boolean)) {cursor=path.join(cursor,part);if(!fs.lstatSync(cursor).isDirectory() || fs.lstatSync(cursor).isSymbolicLink())throw new Error('Linked virtual input runtime directory');}
  if(!['manifest.json',...FILES].includes(name))throw new Error('Unexpected virtual input file');
  const file=path.join(root,name), stat=fs.lstatSync(file);
  if(!stat.isFile() || stat.isSymbolicLink())throw new Error('Virtual input runtime file is not regular');
  return file;
}
function fields(value, allowed, required = []) {
  if (!plain(value) || Object.keys(value).some(k => !allowed.includes(k)) || required.some(k => !Object.hasOwn(value, k))) throw windowError('invalid_request', 'Invalid virtual input fields');
}
function validateInput(input) {
  if (!plain(input)) throw windowError('invalid_request', 'Expected virtual input');
  const int = (v, a, b) => Number.isSafeInteger(v) && v >= a && v <= b;
  if (input.kind === 'mouse') {
    fields(input, ['kind','action','x','y','button','delta'], ['kind','action']);
    if (!['move','down','up','wheel'].includes(input.action) ||
        (input.action === 'move' && (!int(input.x, 0, 16383) || !int(input.y, 0, 16383))) ||
        ((input.x === undefined) !== (input.y === undefined)) ||
        (input.x !== undefined && (!int(input.x,0,16383) || !int(input.y,0,16383))) ||
        (['down','up'].includes(input.action) && !['left','right','middle'].includes(input.button)) ||
        (!['down','up'].includes(input.action) && input.button !== undefined) ||
        (input.action === 'wheel' && (!int(input.delta,-1200,1200) || input.delta === 0)) ||
        (input.action !== 'wheel' && input.delta !== undefined)) throw windowError('invalid_request', 'Invalid virtual mouse input');
  } else if (input.kind === 'key') {
    fields(input, ['kind','virtualKey','action'], ['kind','virtualKey','action']);
    if (!int(input.virtualKey, 1, 255) || [0x5b,0x5c].includes(input.virtualKey) || !['down','up'].includes(input.action)) throw windowError('invalid_request', 'Unsupported virtual key');
  } else if (input.kind === 'text') {
    fields(input, ['kind','text'], ['kind','text']);
    if (typeof input.text !== 'string' || input.text.length < 1 || input.text.length > 2047 || /[\u0000\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/u.test(input.text)) throw windowError('invalid_request', 'Invalid virtual Unicode text');
  } else throw windowError('invalid_request', 'Unknown virtual input kind');
  return { ...input };
}
function verifyVirtualRuntime(directory) {
  const bytes = fs.readFileSync(checked(directory, 'manifest.json'));
  const m = JSON.parse(bytes);
  if (m.schema !== 1 || m.kind !== 'azrael-virtual-input' || m.platform !== 'win32' || m.arch !== 'x64' || !digest(m.sourceSha256) || !Array.isArray(m.files)) throw new Error('Invalid virtual input runtime manifest');
  const seen = new Set();
  for (const f of m.files) {
    if (!FILES.includes(f.path) || seen.has(f.path) || !digest(f.sha256) || !Number.isSafeInteger(f.bytes) || f.bytes < 1) throw new Error('Invalid virtual input runtime file');
    const payload = fs.readFileSync(checked(directory, f.path));
    if (payload.length !== f.bytes || sha(payload) !== f.sha256) throw new Error('Virtual input runtime hash mismatch: ' + f.path);
    seen.add(f.path);
  }
  if (FILES.some(f => !seen.has(f)) || fs.readdirSync(directory).some(f => f !== 'manifest.json' && !seen.has(f))) throw new Error('Incomplete or unrecorded virtual input runtime');
  return { directory:path.resolve(directory), executable:checked(directory, FILES[0]), manifestSha256:sha(bytes), sourceSha256:m.sourceSha256 };
}
function identity(w) {
  const out = Object.fromEntries(['hwnd','pid','processCreated','executable'].map(k => [k,w?.[k]]));
  if (!/^[a-f0-9]{1,16}$/i.test(out.hwnd || '') || !/^[a-f0-9]{1,16}$/i.test(out.processCreated || '') ||
      BigInt('0x'+out.hwnd) === 0n || BigInt('0x'+out.processCreated) === 0n || !Number.isSafeInteger(out.pid) || out.pid < 1 || typeof out.executable !== 'string' || !path.win32.isAbsolute(out.executable)) throw windowError('invalid_request', 'Invalid virtual input target identity');
  return out;
}
const same = (a,b) => a.pid === b.pid && ['hwnd','processCreated','executable'].every(k => a[k].toLowerCase() === b[k].toLowerCase());
function createVirtualInputProvider(declaration, { spawnChild = spawn, verify = verifyVirtualRuntime, platform = process.platform, arch = process.arch, timeoutMs = 8000, closeMs = 6000 } = {}) {
  const sessions = new Map(); let disposed = false;
  function launch(window) {
    if (platform !== 'win32' || arch !== 'x64') throw windowError('unsupported_action', 'Virtual input requires Windows x64');
    if (!declaration?.directory || !digest(declaration.manifestSha256)) throw windowError('unsupported_action', 'Virtual input runtime is not prepared');
    const runtime = verify(declaration.directory);
    if (runtime.manifestSha256 !== declaration.manifestSha256) throw windowError('connection_error', 'Virtual input runtime declaration changed');
    const child = spawnChild(runtime.executable, [], { windowsHide:true, stdio:['pipe','pipe','pipe'] });
    const s = { child, window, pending:new Map(), retired:false, closed:false, buffer:'', decoder:new StringDecoder('utf8') };
    s.closedPromise = new Promise(resolve => { s.resolveClosed = resolve; });
    const fail = error => { for (const p of s.pending.values()) { clearTimeout(p.timer); p.reject(windowError(error.code || 'connection_error', error.message, { mutationOutcome:'unknown' })); } s.pending.clear(); };
    child.stdout.on('data', data => {
      s.buffer += s.decoder.write(data);
      if (Buffer.byteLength(s.buffer,'utf8') > 1024*1024) { s.retired = true; fail(new Error('Virtual input response too large')); child.stdin.end(); return; }
      let n;
      while ((n=s.buffer.indexOf('\n')) >= 0) {
        const line=s.buffer.slice(0,n);s.buffer=s.buffer.slice(n+1);
        let r; try {r=JSON.parse(line);} catch {s.retired=true;fail(new Error('Invalid virtual input response'));child.stdin.end();return;}
        const p=plain(r) ? s.pending.get(r.id) : undefined;
        if (!p || Object.hasOwn(r,'result') === Object.hasOwn(r,'error')) {s.retired=true;fail(new Error('Uncorrelated virtual input response'));child.stdin.end();return;}
        clearTimeout(p.timer);s.pending.delete(r.id);
        if (r.error) p.reject(windowError('unsupported_action', String(r.error.message || 'Virtual input rejected'), {nativeCode:r.error.code, ...(r.error.mutationOutcome === 'unknown' ? {mutationOutcome:'unknown'} : {actionExecuted:false})}));
        else p.resolve(r.result);
      }
    });
    // Native stderr is not user document content; keep it drained and bounded by the producer.
    child.stderr.on('data', () => {});
    child.stdin.on('error', error => {s.retired=true;fail(error);});
    child.on('error', error => {s.retired=true;fail(error);});
    child.on('close', (code,signal) => {s.retired=true;s.closed=true;s.exitCode=code;s.signal=signal;fail(new Error('Virtual input broker closed'));s.resolveClosed({exitCode:code,signal});});
    return s;
  }
  function request(s, method, params = {}) {
    if (s.retired || s.closed) return Promise.reject(windowError('cancelled','Virtual input session is retiring'));
    const id=randomUUID();
    return new Promise((resolve,reject) => {
      const timer=setTimeout(() => {s.pending.delete(id);s.retired=true;reject(windowError('timeout','Virtual input outcome is unknown',{mutationOutcome:'unknown'}));s.child.stdin.end();},timeoutMs);
      s.pending.set(id,{resolve,reject,timer});
      s.child.stdin.write(JSON.stringify({id,method,params})+'\n', error => {if(error){const p=s.pending.get(id);if(p){clearTimeout(timer);s.pending.delete(id);s.retired=true;reject(windowError('connection_error','Virtual input write failed',{mutationOutcome:'unknown'}));s.child.stdin.end();}}});
    });
  }
  async function release(thread) {
    const s=sessions.get(thread);if(!s)return {detached:true};
    s.retired=true;s.child.stdin.end();
    let timer;
    const result=await Promise.race([s.closedPromise,new Promise(resolve=>{timer=setTimeout(()=>resolve(null),closeMs);})]);clearTimeout(timer);
    if (!result || result.exitCode !== 0 || result.signal) throw windowError('connection_error','Virtual input detach or broker exit is unverified',{mutationOutcome:'unknown'});
    if (sessions.get(thread)===s)sessions.delete(thread);
    return {detached:true};
  }
  return {
    async input(thread, window, input, guard = async()=>{}) {
      if(disposed)throw windowError('cancelled','Virtual input provider disposed');
      const target=identity(window), packet=validateInput(input);await guard();
      let s=sessions.get(thread);
      if (s && !same(s.window,target)) {await release(thread);s=undefined;}
      try {
        if (!s) {s=launch(target);sessions.set(thread,s);await request(s,'attach',{window:target});await guard();}
        if (s.retired)throw windowError('cancelled','Virtual input session requires verified cleanup');
        await guard();
        const result=await request(s,'input',packet);await guard();return {...result,delivery:'virtualInput',verified:false};
      } catch(error){if(s){s.retired=true;void release(thread).catch(()=>{});}throw error;}
    },
    release,
    async dispose() {disposed=true;const results=await Promise.allSettled([...sessions.keys()].map(release));const failed=results.find(r=>r.status==='rejected');if(failed)throw failed.reason;},
  };
}
module.exports = { validateInput, identity, verifyVirtualRuntime, createVirtualInputProvider };
