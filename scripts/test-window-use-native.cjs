'use strict';
// Focused native component acceptance, never installed-host or physical-keyboard acceptance.
// Requires root GO, an explicitly isolated test desktop/session and a new artifacts directory.
// After approval: pwsh -File scripts/test-selected-window-native.ps1 -CompileOnly
//   -OutputDirectory <dedicated build directory> -LogDirectory <dedicated compile logs>
// Then: node scripts/test-window-use-native.cjs --go --isolated-desktop --baseline <json>
//   --runtime-directory <verified runtime> --artifacts <new directory> --fixture-executable <fixture exe>
// Set AZRAEL_WINDOW_NATIVE_ISOLATED=1 only in the isolated test session.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { createBackend } = require('./window-control-backend.cjs');
const { verifyRuntime } = require('./window-control-runtime.cjs');
const { protectedCodeIdentities } = require('./test-selected-window-native.cjs');
const project = path.resolve(__dirname, '..');
const identityKeys = ['hwnd','pid','processCreated','executable'];
const normalized = value => String(value).toLowerCase();
const sameIdentity = (a,b) => identityKeys.every(key => normalized(a[key]) === normalized(b[key]));
// Cooperative channel retained from the existing harness: no forced fixture process termination.
class FixtureChannel {
  constructor(executable, token) {
    this.token = token; this.sequence = 0; this.pending = new Map(); this.buffer = ''; this.exited = false;
    this.ready = new Promise((resolve, reject) => { this.readyResolve = resolve; this.readyReject = reject; });
    this.child = spawn(executable, ['--token', token], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', data => {
      this.buffer += data;
      if (this.buffer.length > 1024 * 1024) { this.rejectAll(new Error('Fixture output limit exceeded')); return; }
      let end;
      while ((end = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, end); this.buffer = this.buffer.slice(end + 1);
        let reply; try { reply = JSON.parse(line); } catch { this.rejectAll(new Error('Invalid fixture JSON')); continue; }
        if (reply.ready) { this.identity = reply.identity; this.readyResolve(reply.identity); continue; }
        const waiter = this.pending.get(reply.id); if (!waiter) continue;
        clearTimeout(waiter.timer); this.pending.delete(reply.id);
        if (reply.error) waiter.reject(new Error(reply.error)); else waiter.resolve(reply.result);
      }
    });
    this.child.stderr.on('data', () => {});
    this.child.on('error', error => this.rejectAll(error));
    this.child.on('exit', code => { this.exited = true; this.exitCode = code; this.rejectAll(new Error('Fixture exited')); });
  }
  rejectAll(error) { this.readyReject(error); for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(error); } this.pending.clear(); }
  command(command, fields = {}) {
    if (this.exited) return Promise.reject(new Error('Fixture is not running'));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Fixture cooperative command timeout')); }, 10000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ token: this.token, id, command, ...fields }) + '\n');
    });
  }
  async shutdown() {
    if (this.exited) return;
    await this.command('shutdown');
    const deadline = Date.now() + 5000;
    while (!this.exited && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
    if (!this.exited) throw new Error('Fixture did not exit cooperatively; left running without forced termination');
  }
  leaveRunning() {
    // Do not keep the harness alive solely because an unresponsive owned fixture remains open.
    this.child.unref();
    for (const stream of this.child.stdio) if (stream && typeof stream.unref === 'function') stream.unref();
    this.child.stdin.end();
  }
}
function argumentsOf(argv) {
  const options = {};
  for (let i=0; i<argv.length; i++) {
    const key = argv[i];
    if (key === '--go' || key === '--isolated-desktop') options[key.slice(2)] = true;
    else if (['--baseline','--artifacts','--runtime-directory','--fixture-executable'].includes(key)) {
      assert(argv[i+1] && !argv[i+1].startsWith('--'), 'Missing option value');
      options[key.slice(2)] = path.resolve(argv[++i]);
    } else throw new Error('Unknown harness option: ' + key);
  }
  return options;
}
async function main() {
  const options = argumentsOf(process.argv.slice(2));
  assert(options.go, 'Root GO required: pass --go only after approval');
  assert(options['isolated-desktop'] && process.env.AZRAEL_WINDOW_NATIVE_ISOLATED === '1',
    'Isolated session required: --isolated-desktop and AZRAEL_WINDOW_NATIVE_ISOLATED=1');
  assert.equal(process.platform,'win32');
  for (const key of ['baseline','artifacts','runtime-directory']) assert(options[key], 'Required --'+key);
  assert(!fs.existsSync(options.artifacts), 'Artifacts directory must be new');
  const baseline = JSON.parse(fs.readFileSync(options.baseline,'utf8'));
  assert.equal(baseline.schema,1); assert.equal(baseline.inputDesktop,'Default');
  const protectedBaseline = protectedCodeIdentities(baseline);
  const runtime = verifyRuntime(options['runtime-directory']);
  const fixtureExe = options['fixture-executable'] || path.join(project,'artifacts/build/selected-window-native/SelectedWindowFixture.exe');
  assert(fs.existsSync(fixtureExe),'Compile fixture after approval with test-selected-window-native.ps1 -CompileOnly');
  fs.mkdirSync(options.artifacts,{recursive:true});
  const report = {kind:'window-use-native-component',status:'running',startedAt:new Date().toISOString(),
    installedHostEndToEnd:false,physicalKeyboardAcceptance:false,isolation:'operator asserted isolated session',
    nativeExecutable:runtime.executable,nativeManifestSha256:runtime.manifestSha256,
    fixtureExe,fixtureSha256:crypto.createHash('sha256').update(fs.readFileSync(fixtureExe)).digest('hex'),
    baseline:options.baseline,checks:[],calls:[],screenshots:[],
    remainingManual:['Actual Firefox UIA/key postconditions','Physical typing continues in unrelated foreground window during target acts',
      'Switch unrelated foreground windows during inspect/observe and verify fresh target frames']};
  let fixture,native,selected,clipboardSequence,sequence=0;
  const record = (name,details={}) => report.checks.push({name,outcome:'passed',...details});
  const log = (name,entry) => fs.appendFileSync(path.join(options.artifacts,name),JSON.stringify(entry)+'\n');
  async function desktop(phase) {
    const destination = path.join(options.artifacts,'desktop-'+String(++sequence).padStart(3,'0')+'.json');
    const result = spawnSync('pwsh.exe',['-NoProfile','-File',path.join(__dirname,'window-test-desktop-state.ps1'),'-OutputPath',destination],
      {windowsHide:true,encoding:'utf8',timeout:20000});
    log('desktop-helper.jsonl',{phase,status:result.status,stdout:result.stdout,stderr:result.stderr,error:result.error?.message});
    assert.equal(result.status,0,'Desktop snapshot failed at '+phase);
    const current = JSON.parse(fs.readFileSync(destination,'utf8'));
    assert.equal(current.inputDesktop,'Default');
    assert.equal(normalized(current.foregroundHwnd),normalized(baseline.foregroundHwnd),'Foreground changed at '+phase);
    assert.deepEqual(current.cursor,baseline.cursor,'Cursor changed at '+phase);
    assert.equal(current.lastInputTick,baseline.lastInputTick,'Global/user input detected at '+phase);
    for (const [before,after,keys] of [[protectedBaseline.processes,current.codeProcesses,['pid','processCreated','executable']],
      [protectedBaseline.windows,current.codeWindows,[...identityKeys,'visible','minimized']]]) {
      for (const old of before) assert(after.some(item => keys.every(key => normalized(item[key]) === normalized(old[key]))),'Existing Code identity/window changed');
    }
  }
  async function command(name,fields={}) {
    await desktop('fixture '+name+' before');
    try {
      const result = await fixture.command(name,fields); log('fixture-state.jsonl',{command:name,result});
      if (name !== 'verifyImage') {
        assert.equal(typeof result.clipboardSequence,'number','Updated fixture with clipboard guard required');
        if (clipboardSequence === undefined) clipboardSequence = result.clipboardSequence;
        assert.equal(result.clipboardSequence,clipboardSequence,'Clipboard sequence changed');
      }
      return result;
    } finally { await desktop('fixture '+name+' after'); }
  }
  async function request(method,params={}) {
    await desktop(method+' before');
    if (method !== 'listWindows') assert(selected && sameIdentity(params.window,selected) && sameIdentity(params.window,fixture.identity),'Request escaped owned fixture identity');
    report.calls.push({method,window:params.window && Object.fromEntries(identityKeys.map(key => [key,params.window[key]]))});
    try {
      const result = await native.request(method,params);
      log('native-results.jsonl',{method,result:result.image ? {...result,image:{...result.image,data:'[retained PNG]'}} : result});
      if (method !== 'listWindows') assert(sameIdentity(result.window,selected),'Returned identity changed');
      return result;
    } catch(error) { log('native-results.jsonl',{method,error:error.message}); throw error; }
    finally { await desktop(method+' after'); }
  }
  async function inspect() {
    const result = await request('inspect',{window:selected});
    assert.deepEqual(Object.keys(result).sort(),['elements','elementsTruncated','observationId','window']);
    assert.equal(result.elementsTruncated,false,'Small fixture must return a complete accessibility tree');
    assert.equal(typeof result.observationId,'string'); assert(result.observationId.length > 0);
    assert(Array.isArray(result.elements) && result.elements.length > 0);
    const ids = new Set(result.elements.map(element => element.id)); assert.equal(ids.size,result.elements.length);
    for (const element of result.elements) {
      assert.equal(typeof element.id,'string'); assert.equal(typeof element.automationId,'string');
      assert(element.parentId === null || ids.has(element.parentId),'Parent missing');
      assert.equal(typeof element.enabled,'boolean'); assert.equal(typeof element.isPassword,'boolean');
      if (element.isPassword) assert(!Object.hasOwn(element,'value'),'Password value exposed');
      if (Object.hasOwn(element,'value')) assert.equal(typeof element.value,'string');
      if (Object.hasOwn(element,'selected')) assert.equal(typeof element.selected,'boolean');
      if (Object.hasOwn(element,'toggleState')) assert(['off','on','indeterminate'].includes(element.toggleState));
      if (Object.hasOwn(element,'expandState')) assert(['collapsed','expanded','partial','leaf'].includes(element.expandState));
    }
    return result;
  }
  function element(observation,name,pattern) {
    const result = observation.elements.find(item => item.name === name && item.patterns.includes(pattern));
    assert(result,'Required UIA element/pattern absent: '+name+'/'+pattern); return result;
  }
  async function act(observation,target,action,value) {
    return request('act',{window:selected,observationId:observation.observationId,elementId:target.id,action,...(value !== undefined ? {value} : {})});
  }
  async function capture(label) {
    const result = await request('observe',{window:selected});
    const destination = path.join(options.artifacts,label+'.png');
    fs.writeFileSync(destination,Buffer.from(result.image.data,'base64')); report.screenshots.push(destination);
    const decoded = await command('verifyImage',{path:destination});
    assert.equal(decoded.widthPx,result.widthPx); assert.equal(decoded.heightPx,result.heightPx);
    assert(decoded.canvasPixels > 5000); assert.equal(decoded.coverPixels,0); assert(decoded.tickFromImage >= 0);
    return {result,decoded};
  }
  try {
    await desktop('pre-launch');
    fixture = new FixtureChannel(fixtureExe,crypto.randomUUID());
    fixture.child.stderr.on('data',chunk => fs.appendFileSync(path.join(options.artifacts,'fixture-stderr.log'),chunk));
    const timer = setTimeout(() => fixture.readyReject(new Error('Fixture startup timed out')),10000);
    try { await fixture.ready; } finally { clearTimeout(timer); }
    report.fixtureIdentity = fixture.identity;
    clipboardSequence = fixture.identity.clipboardSequence;
    assert.equal(typeof clipboardSequence,'number','Updated fixture clipboard baseline required');
    assert.equal(fixture.identity.pid,fixture.child.pid);
    assert.equal(normalized(fixture.identity.executable),normalized(fixtureExe)); assert.equal(fixture.identity.minimized,true);
    assert(!baseline.codeProcesses.some(item => item.pid === fixture.identity.pid));
    await command('state');
    native = createBackend({windowControl:runtime},{timeoutMs:15000,spawnChild(executable,args,settings) {
      const child = spawn(executable,args,settings); report.nativePid = child.pid;
      child.stderr.on('data',chunk => fs.appendFileSync(path.join(options.artifacts,'native-stderr.log'),chunk)); return child;
    }});
    selected = (await request('listWindows')).find(item => sameIdentity(item,fixture.identity));
    assert(selected,'Exact fixture not enumerated'); await request('restore',{window:selected});
    const covered = await command('coverAll'); assert.equal(covered.coverVisible,true); assert.equal(covered.coverAll,true);
    const first = await capture('fully-covered-first'); let second;
    for (let attempt=0; attempt<8; attempt++) {
      second = await capture('fully-covered-next-'+attempt);
      if (second.decoded.tickFromImage !== first.decoded.tickFromImage) break;
      await new Promise(resolve => setTimeout(resolve,250));
    }
    assert(BigInt(second.result.frameTimestamp) > BigInt(first.result.frameTimestamp));
    assert.notEqual(second.decoded.tickFromImage,first.decoded.tickFromImage);
    record('fresh full target frames behind covering window',{firstTick:first.decoded.tickFromImage,secondTick:second.decoded.tickFromImage});
    let observation = await inspect();
    assert(observation.elements.some(item => item.isPassword),'Password fixture missing');
    assert.equal(observation.elements.find(item => item.name === 'Fixture Disabled')?.enabled,false);
    record('image-free inspector identity, parents, conditions and password protection');
    await assert.rejects(act(observation,element(observation,'Fixture Disabled','invoke'),'invoke'),/disabled/i);
    observation = await inspect();
    record('disabled UIA element rejects mutation');
    const oldObservation = observation; observation = await inspect(); assert.notEqual(observation.observationId,oldObservation.observationId);
    await assert.rejects(act(oldObservation,element(oldObservation,'Fixture Invoke','invoke'),'invoke'),/observation/i);
    observation = await inspect();
    const beforeInvoke = await command('state'); await act(observation,element(observation,'Fixture Invoke','invoke'),'invoke');
    assert.equal((await command('state')).invokes,beforeInvoke.invokes+1);
    observation = await inspect(); await act(observation,element(observation,'Fixture Value','setValue'),'setValue','native-window-use');
    assert.equal((await command('state')).value,'native-window-use');
    observation = await inspect(); assert.equal(element(observation,'Fixture Value','setValue').value,'native-window-use');
    record('semantic invoke and setValue fixture postconditions');
    const keyCodes = {Return:13,Tab:9,Escape:27,BackSpace:8,Delete:46,Left:37,Right:39,Up:38,Down:40,Home:36,End:35,PageUp:33,PageDown:34,space:32};
    for (const [key,code] of Object.entries(keyCodes)) {
      await command('prepareKeys',{value:'AB'}); observation = await inspect();
      const result = await act(observation,element(observation,'Fixture Keys','pressKey'),'pressKey',key);
      assert.equal(result.delivery,'windowMessage'); assert.equal(result.verified,false); assert.equal(result.experimental,true);
      let after;
      for (let attempt=0; attempt<10; attempt++) {
        after = await command('state'); if (after.keyMessages.some(item => item.message === 0x101 && item.key === code)) break;
        await new Promise(resolve => setTimeout(resolve,30));
      }
      const down = after.keyMessages.findIndex(item => item.message === 0x100 && item.key === code);
      const up = after.keyMessages.findIndex(item => item.message === 0x101 && item.key === code);
      assert(down >= 0 && up > down,'Named key down/up not processed in order: '+key);
      if (key === 'BackSpace') assert.equal(after.keyValue,'A','BackSpace did not edit target text');
      if (key === 'space') assert.equal(after.keyValue,'AB ','space did not edit target text');
      record('named key '+key+' processed',{actualValue:after.keyValue,delivery:result.delivery,physicalKeyboard:false});
    }
    await command('state'); await desktop('pre-shutdown'); await fixture.shutdown(); await desktop('post-shutdown');
    await assert.rejects(request('status',{window:selected}),/identity|exists|match|destroyed|unavailable/i);
    record('closed owned target rejected'); report.status='passed';
  } catch(error) { report.status='failed'; report.error={message:error.message,stack:error.stack}; throw error; }
  finally {
    if (fixture && !fixture.exited) {
      // Token-directed cleanup of our exact spawned fixture even after a desktop guard failure.
      try { await fixture.shutdown(); report.cleanup='cooperative exact fixture shutdown'; }
      catch(error) { report.cleanup=error.message; report.fixtureLeftRunning={pid:fixture.child.pid,identity:fixture.identity}; fixture.leaveRunning(); }
    } else if (fixture) report.cleanup='fixture exited cooperatively';
    if (native) {
      try { await native.dispose(); report.nativeCleanup='exact spawned backend disposed'; }
      catch(error) { report.status='failed'; report.nativeCleanupError=error.message; process.exitCode=1; }
    }
    report.completedAt=new Date().toISOString();
    fs.writeFileSync(path.join(options.artifacts,'window-use-native-results.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify({status:report.status,checks:report.checks.length,results:path.join(options.artifacts,'window-use-native-results.json')}));
  }
}
module.exports = {argumentsOf};
if (require.main === module) main().catch(error => {console.error(error.message);process.exitCode=1;});

