'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {validateLogoffInspection,inspectChildLogoff,logoffCurrentChild}=require('./window-child-session.cjs');
const {toolDefinitions,callResult}=require('./window-control-mcp.cjs');
const identity={sid:'S-1-5-21-fixture',profile:'C:/fixture',parentSessionId:2,childSessionId:10,sessionAnchorPid:null,sessionAnchorCreated:null};
const snapshot=(health,ownerPresent)=>({ok:true,present:true,identity,health,ownerPresent,reasons:[],allowed:health==='abnormal'||!ownerPresent});
test('explicit logoff eligibility keeps occupancy separate from failed health verification',()=>{
  for(const health of ['healthy','abnormal'])for(const owner of [false,true])assert.equal(validateLogoffInspection(snapshot(health,owner)).allowed,health==='abnormal'||!owner);
  assert.throws(()=>validateLogoffInspection({...snapshot('healthy',true),allowed:true}),/policy/);
  assert.throws(()=>validateLogoffInspection({...snapshot('healthy',false),identity:{...identity,childSessionId:2}}),/identity/);
  assert.throws(()=>validateLogoffInspection({...snapshot('healthy',false),identity:{...identity,sessionAnchorPid:12}}),/identity/);
  assert.equal(validateLogoffInspection({ok:true,present:false,identity:null,health:'healthy',ownerPresent:false,reasons:[],allowed:false}).present,false);
});
test('logoff inspection is a read-only native mode and observes process exit',async()=>{
  let disconnected=false,waited=false;
  const value=await inspectChildLogoff({path:'unused',sha256:'A'.repeat(64)},{transportFactory:(_helper,mode)=>{
    assert.deepEqual(mode,{mode:'inspectLogoff'});
    return {request:async request=>{assert.deepEqual(request,{helperSha256:'a'.repeat(64)});return snapshot('abnormal',true);},disconnect:()=>{disconnected=true;},waitForExit:async()=>{waited=true;return true;}};
  }});assert.equal(value.allowed,true);assert.equal(disconnected,true);assert.equal(waited,true);
});
test('new tool has no caller-supplied target or abnormal override and returns actual logoff state',()=>{
  const definition=toolDefinitions().find(x=>x.name==='logoff_isolated');
  assert.ok(definition);assert.deepEqual(Object.keys(definition.inputSchema.properties),['reason']);assert.deepEqual(definition.inputSchema.required,['reason']);
  const result=callResult({status:'failed',code:'child_session_occupied',logoffConfirmed:false,actionExecuted:false,mutationOutcome:'not_executed',filesCleanupState:'deferred'});
  assert.equal(result.isError,true);const text=JSON.parse(result.content[0].text);assert.equal(text.logoffConfirmed,false);assert.equal(text.mutationOutcome,'not_executed');
});
test('wrapper keeps current-child and registered paths separate; parses as Windows PowerShell',()=>{
  const wrapper=fs.readFileSync(path.join(__dirname,'request-window-child-logoff.ps1'),'utf8');
  assert.match(wrapper,/if \(\$CurrentChild\)/);assert.match(wrapper,/--logoff-current-child/);assert.match(wrapper,/\$wireValue.approved=\$true/);
  assert.match(wrapper,/Original|Registered|Registered logoff/);assert.doesNotMatch(wrapper,/Remove-Item[^\r\n]*-(?:Force|Recurse)/i);
  if(process.platform==='win32') {
    const source=path.join(__dirname,'request-window-child-logoff.ps1').replace(/'/g,"''");
    const code=`$errors=$null;$tokens=$null;[void][System.Management.Automation.Language.Parser]::ParseFile('${source}',[ref]$tokens,[ref]$errors);if($errors.Count){$errors|ForEach-Object Message;exit 1}`;
    const r=require('node:child_process').spawnSync(path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(code,'utf16le').toString('base64')],{windowsHide:true,encoding:'utf8'});
    assert.equal(r.status,0,r.stdout+r.stderr);
  }
});
test('logoff runner pins the native helper, supplies an inspected identity and never retries a lost result',async()=>{
  // In-memory filesystem stubs exercise argument construction without creating a helper or invoking UAC.
  const originalStat=fs.lstatSync,originalRead=fs.readFileSync;
  const helperPath=path.resolve('fixture-helper.exe'),nodePath=path.resolve('fixture-node.exe');
  const helperBytes=Buffer.from('helper'),nodeBytes=Buffer.from('node');
  const hash=require('node:crypto').createHash('sha256').update(helperBytes).digest('hex');let calls=0;
  fs.lstatSync=file=>file===helperPath?{isFile:()=>true,isSymbolicLink:()=>false}:originalStat(file);
  fs.readFileSync=(file,...args)=>file===helperPath?helperBytes:file===nodePath?nodeBytes:originalRead(file,...args);
  try {
    const options={stateRoot:path.resolve('fixture-state'),nativeHelper:{path:helperPath,sha256:hash},nodePath,scriptPath:path.resolve('request-window-child-logoff.ps1'),identity};
    const result=await logoffCurrentChild(options,{run:async(_exe,args)=>{calls++;assert.ok(args.includes('-CurrentChild'));assert.ok(!args.includes('-ResourceId'));assert.deepEqual(JSON.parse(Buffer.from(args[args.indexOf('-IdentityBase64')+1],'base64').toString()),identity);const error=new Error('timeout');error.killed=true;throw error;}});
    assert.equal(calls,1);assert.equal(result.code,'child_logoff_unknown');assert.equal(result.mutationOutcome,'unknown');
  } finally {fs.lstatSync=originalStat;fs.readFileSync=originalRead;}
});
