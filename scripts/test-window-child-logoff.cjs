'use strict';
// Retained Windows-local logoff boundary checks and owned disposable disk fixture.
// Never creates a Windows session or requests UAC.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const {createSessionCleanup,validateIdentity,sameIdentity,parseArgs,safePath} = require('./window-child-session-cleanup.cjs');
async function realResourceIntegration(identity,flags) {
  const root=path.resolve(process.env.WINDOW_USE_LOGOFF_TEST_ROOT || path.resolve(__dirname,'../artifacts/tasks/CF-01-window-use-admin-setup/runs/20261018-logoff-cleanup/temporary/logoff-cli'));
  const ownedRoot=path.resolve(__dirname,'../artifacts/tasks/CF-01-window-use-admin-setup/runs/20261018-logoff-cleanup/temporary');
  const relative=path.relative(ownedRoot,root);
  assert.ok(relative && !relative.startsWith('..'+path.sep) && relative !== '..' && !path.isAbsolute(relative),'Integration fixture must stay below its task-owned temporary root');
  assert.ok(path.isAbsolute(root),'Integration fixture root must be absolute');
  assert.notEqual(path.resolve(root),path.parse(path.resolve(root)).root);
  assert.notEqual(path.resolve(root).toLowerCase(),require('node:os').homedir().toLowerCase());
  try { await fs.lstat(root); throw new Error('Integration fixture already exists; preserve it for lifecycle review: '+root); } catch(error) { if(error.code !== 'ENOENT') throw error; }
  await fs.mkdir(root,{recursive:true});
  await safePath(root,{directory:true});
  const helper=path.join(root,'helper.exe'), verification=path.join(root,'verification.txt');
  const helperBytes=Buffer.from('disposable integration helper; never executed');
  await fs.writeFile(helper,helperBytes,{flag:'wx'});
  await fs.writeFile(verification,'retain independently of registered payload cleanup',{flag:'wx'});
  const directory=path.join(root,'azrael','window-use','resources');
  const {createResourceManager}=require('./window-use-resources.cjs');
  const resources=createResourceManager({directory});
  const session=await resources.registerSession({id:'integration-child',workId:'CF-01',runId:'logoff-cli',identity,ownershipVerified:true});
  await resources.releaseLease(session.id,session.lease);
  const generated=await resources.registerGenerated({id:'integration-payload',workId:'CF-01',runId:'logoff-cli',producer:'logoff-cli-integration',sessionIds:[session.id]});
  await fs.mkdir(generated.path);
  await fs.writeFile(path.join(generated.path,'disposable.txt'),'registered disposable payload',{flag:'wx'});
  await resources.releaseLease(generated.id,generated.lease);
  const cleanup=createSessionCleanup({managerFactory:()=>({inspectClosure:async exact=>{
    assert.deepEqual(exact,identity);
    return {ok:true,identity:exact,state:'closed',ownershipVerified:true,logoffConfirmed:true,processesStopped:true,...flags};
  }})});
  const result=await cleanup.finalize({stateRoot:root,resourceId:session.id,nativeHelperPath:helper,nativeHelperSha256:crypto.createHash('sha256').update(helperBytes).digest('hex'),identity});
  assert.equal(result.logoffConfirmed,true);assert.equal(result.filesCleanupState,'complete');
  assert.deepEqual(result.remainingPaths,[]);
  await assert.rejects(fs.lstat(generated.path),{code:'ENOENT'});
  const status=await resources.inspect();assert.equal(status.resources.length,0);
  const manifest=JSON.parse(await fs.readFile(path.join(directory,'management','resources.json'),'utf8'));
  assert.equal(manifest.records.length,0);
  assert.equal(await fs.readFile(verification,'utf8'),'retain independently of registered payload cleanup');
  // Ordinary deletion of exact owned fixture paths, after product behavior is proved.
  const files=[helper,verification,path.join(directory,'management','owner.json'),path.join(directory,'management','resources.json')];
  const directories=[path.join(directory,'payload'),path.join(directory,'management'),directory,path.dirname(directory),path.dirname(path.dirname(directory)),root];
  for(const file of files) await safePath(file);
  for(const item of directories) await safePath(item,{directory:true});
  if(process.platform === 'win32') {
    const payload=Buffer.from(JSON.stringify({root,paths:[...files,...directories]}),'utf8').toString('base64');
    const script=String.raw`
$ErrorActionPreference='Stop'
$fixture=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('`+payload+String.raw`')) | ConvertFrom-Json
$fixtureRoot=[IO.Path]::GetFullPath($fixture.root).TrimEnd('\')
foreach($fixturePath in $fixture.paths) {
  $resolved=[IO.Path]::GetFullPath($fixturePath)
  if($resolved -ine $fixtureRoot -and -not $resolved.StartsWith($fixtureRoot+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Fixture cleanup escaped its owned root' }
  for($ancestor=$resolved;$ancestor;$ancestor=[IO.Path]::GetDirectoryName($ancestor)) { if((Get-Item -LiteralPath $ancestor).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Fixture path contains a reparse point' } }
  if((Get-Item -LiteralPath $resolved).PSIsContainer -and @(Get-ChildItem -LiteralPath $resolved).Count) { throw 'Unexpected fixture contents; preserve for inspection' }
  Remove-Item -LiteralPath $resolved
  if(Test-Path -LiteralPath $resolved) { throw 'Owned fixture remains after ordinary deletion' }
}
`;
    const powershell=path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
    const removed=require('node:child_process').spawnSync(powershell,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true});
    assert.equal(removed.status,0,removed.stderr||removed.error?.message);
  } else {
    for(const file of files) await fs.unlink(file);
    for(const item of directories) await fs.rmdir(item);
  }
  await assert.rejects(fs.lstat(root),{code:'ENOENT'});
  console.log('real resource integration passed: registered payload and active records removed; external verification preserved before fixture cleanup');
}
async function run() {
  const wrapper = await fs.readFile(path.join(__dirname,'request-window-child-logoff.ps1'),'utf8');
  const nativeTransport = await fs.readFile(path.join(__dirname,'window-child-session.cjs'),'utf8');
  const identity={sid:'S-1-5-21-123',profile:'C:\\Users\\test',parentSessionId:1,childSessionId:7,workerPid:123,workerCreated:'1234',sessionAnchorPid:124,sessionAnchorCreated:'1235'};
  validateIdentity(identity);
  assert.throws(()=>validateIdentity({...identity,childSessionId:1}),/Parent/);
  assert.throws(()=>validateIdentity({...identity,sessionAnchorPid:undefined}),/number/);
  assert.throws(()=>validateIdentity({...identity,nonce:'secret'}),/Exact/);
  assert.equal(sameIdentity(identity,{...identity,workerCreated:'changed'}),false);
  const root=path.resolve(__dirname,'../work/CF-01-window-use-admin-setup/fake-isolated-state');
  const helper=path.join(root,'helper.exe'), helperBytes=Buffer.from('test-only-helper');
  const options={stateRoot:root,resourceId:'child-7',nativeHelperPath:helper,nativeHelperSha256:crypto.createHash('sha256').update(helperBytes).digest('hex'),identity};
  let disconnected=false;
  const flags=Object.fromEntries(['pendingWork','directUser','unsavedWork','unknownState','unrelatedApps','pendingUserDecision','heldInput'].map(k=>[k,false]));
  const nativeManager=require('./window-child-session.cjs').createWindowsChildSessionManager({nativeHelper:{path:helper,sha256:options.nativeHelperSha256},transportFactory:(selected,mode)=>{
    assert.deepEqual(selected,{path:helper,sha256:options.nativeHelperSha256});assert.deepEqual(mode,{mode:'inspectClosure'});
    return {request:async request=>{assert.deepEqual(request,{helperSha256:options.nativeHelperSha256,identity});return {ok:true,identity,state:'closed',ownershipVerified:true,processesStopped:true,logoffConfirmed:true,...flags};},disconnect:()=>{disconnected=true;}};
  }});
  assert.equal((await nativeManager.inspectClosure(identity)).state,'closed');assert.equal(disconnected,true);
  const args=['finalize','--state-root',root,'--resource-id','child-7','--native-helper-path',helper,'--native-helper-sha256',options.nativeHelperSha256,'--request-file',path.join(root,'request.json')];
  assert.equal(parseArgs(args).command,'finalize');
  assert.throws(()=>parseArgs([...args,'--force','yes']),/Unknown/);
  assert.throws(()=>parseArgs([...args,'--resource-id','other']),/duplicate/);
  assert.throws(()=>parseArgs(['inspect',...args.slice(1)]),/Finalize/);
  assert.throws(()=>parseArgs(['inspect','--state-root',root,'--resource-id','../bad','--native-helper-path',helper,'--native-helper-sha256',options.nativeHelperSha256]),/Explicit/);
  const saved={lstat:fs.lstat,stat:fs.stat,readFile:fs.readFile};
  let linkPath;
  const manifestPath=path.join(root,'azrael','window-use','resources','management','resources.json');
  const manifest={schema:1,records:[{id:'child-7',kind:'session',identity}]};
  const mockStat=file=>({isSymbolicLink:()=>file===linkPath,isDirectory:()=>file!==helper&&file!==manifestPath,isFile:()=>file===helper||file===manifestPath,nlink:1,size:100});
  fs.lstat=async file=>mockStat(file); fs.stat=async file=>mockStat(file);
  fs.readFile=async file=>file===helper?helperBytes:JSON.stringify(manifest);
  let proof={identity,state:'running',ownershipVerified:true,logoffConfirmed:false,processesStopped:false,...flags};
  let cleanupCalls=0, configured;
  const cleanup=createSessionCleanup({managerFactory:()=>({inspectClosure:async original=>{assert.deepEqual(original,identity); return proof;}}),resourceFactory:configuration=>{configured=configuration;return {cleanup:async input=>{cleanupCalls++;assert.deepEqual(input.ids,['child-7']);return {results:[{ids:['child-7'],state:'deleted'}]};}};}});
  try {
    const running=await cleanup.finalize(options);
    assert.equal(running.logoffConfirmed,false); assert.equal(cleanupCalls,0);
    proof={...proof,state:'closed',logoffConfirmed:true,processesStopped:true,identity:{...identity,workerPid:999}};
    assert.equal((await cleanup.finalize(options)).logoffConfirmed,false); assert.equal(cleanupCalls,0);
    proof={...proof,identity};
    for (const unsafe of Object.keys(flags)) {
      const safeProof=proof; proof={...proof,[unsafe]:undefined};
      assert.equal((await cleanup.finalize(options)).logoffConfirmed,false); assert.equal(cleanupCalls,0); proof=safeProof;
    }
    const closed=await cleanup.finalize(options);
    assert.equal(closed.filesCleanupState,'complete'); assert.equal(closed.logoffConfirmed,true); assert.equal(cleanupCalls,1);
    assert.equal(Object.hasOwn(configured,'closeSession'),false);
    assert.deepEqual(await configured.inspectSession(identity),proof);
    await cleanup.finalize(options); assert.equal(cleanupCalls,2);
    await assert.rejects(cleanup.finalize({...options,identity:{...identity,sessionAnchorCreated:'changed'}}),/mismatch/);
    await assert.rejects(cleanup.inspect({...options,nativeHelperSha256:'0'.repeat(64)}),/hash mismatch/);
    linkPath=path.join(root,'azrael'); await assert.rejects(cleanup.inspect(options),/Reparse/); linkPath=undefined;
    await assert.rejects(safePath('relative'),/Absolute/);
    const partial=createSessionCleanup({managerFactory:()=>({inspectClosure:async()=>proof}),resourceFactory:()=>({cleanup:async()=>({results:[{ids:['child-7','payload'],state:'failed',remainingPaths:['retained']}]}),inspect:async()=>({resources:[{id:'payload',path:'retained'}]})})});
    const result=await partial.finalize(options); assert.equal(result.logoffConfirmed,true);assert.equal(result.filesCleanupState,'partial');assert.deepEqual(result.remainingPaths,['retained']);
  } finally { Object.assign(fs,saved); }
  // These source guards accompany executable boundary checks; live elevation is a separate gate.
  assert.match(nativeTransport,/mode === 'inspectClosure' \? \['--inspect-closure'\]/);
  assert.match(wrapper,/Arguments='--logoff-child'/);
  assert.match(wrapper,/-Verb RunAs -WindowStyle Hidden -Wait -PassThru/);
  assert.match(wrapper,/Assert-PrivateDirectory \$invocationDirectory/);
  assert.match(wrapper,/CreationTimeUtc.Ticks -ne \$temporary.created/);
  assert.match(wrapper,/Get-FileHash -LiteralPath \$File -Algorithm SHA256/);
  assert.match(wrapper,/if \(\$logoffAdmin\) \{ throw/);
  assert.match(wrapper,/Write-NewJson \$planPath/);
  assert.match(wrapper,/if \(\$producerTerminal\) \{\s*foreach \(\$temporary/);
  assert.match(wrapper,/\$producerTerminal=\$true\s*\$result.helperExitCode=\$receipt.helperExitCode/);
  assert.match(wrapper,/\$cancelException.NativeErrorCode -eq 1223/);
  assert.match(wrapper,/\$producerTerminal -and -not \$temporaryRemaining.Count -and \$result.filesCleanupState -eq 'complete'/);
  assert.match(wrapper,/Assert-Hash \$planPath \$planHash/);
  assert.ok(wrapper.indexOf('Write-NewJson $planPath') < wrapper.indexOf('DirectoryInfo($invocationDirectory)).Create'));
  assert.doesNotMatch(wrapper,/Remove-Item[^\r\n]*-(?:Force|Recurse)|Set-Acl|takeown|icacls/i);
  if (process.platform === 'win32') {
    // Execute the wrapper's actual cleanup block with filesystem commands replaced
    // by in-memory fakes. No elevation, native helper or fixture files are used.
    const start=wrapper.indexOf('$temporaryRemaining=@()');
    const end=wrapper.indexOf('$result.remainingPaths=',start);
    assert.ok(start>0&&end>start);
    const cleanupBlock=wrapper.slice(start,end);
    const harness=String.raw`
$ErrorActionPreference='Stop'
$requestPath='request';$receiptPath='receipt';$invocationDirectory='invocation';$planPath='plan';$logoffRoot='root'
$requestHash='request-hash';$receiptHash='receipt-hash';$planHash='plan-hash'
$requestCreation=42;$receiptCreation=42;$planCreation=42
$removed=New-Object 'Collections.Generic.HashSet[string]'
function Test-Path { param($LiteralPath) return -not $removed.Contains($LiteralPath) }
function Remove-Item { param($LiteralPath) [void]$removed.Add($LiteralPath) }
function Get-Item { param($LiteralPath) return [pscustomobject]@{CreationTimeUtc=[pscustomobject]@{Ticks=42}} }
function Get-ChildItem { param($LiteralPath) return @() }
function Assert-PrivateDirectory { param($Directory) }
function Assert-Hash { param($File,$Hash) if (-not $Hash) { throw 'missing test hash' } }
$result=@{filesCleanupState='complete'}
$producerTerminal=$false
`+cleanupBlock+String.raw`
if ($removed.Count -ne 0 -or $temporaryRemaining.Count -ne 4) { throw 'Unknown producer must retain all invocation files and plan' }
$producerTerminal=$true
`+cleanupBlock+String.raw`
if ($removed.Count -ne 4 -or $temporaryRemaining.Count -ne 0) { throw 'Terminal producer and complete payload must retire exact invocation and plan' }
'wrapper cleanup branch checks passed'
`;
    const powershell=path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
    const result=require('node:child_process').spawnSync(powershell,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(harness,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true});
    assert.equal(result.status,0,result.stderr||result.error?.message); assert.match(result.stdout,/wrapper cleanup branch checks passed/);
  }
  await realResourceIntegration(identity,flags);
  console.log('window child logoff checks passed (no live logoff, UAC or installation)');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
