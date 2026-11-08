#requires -Version 7.4
[CmdletBinding()]
param([string[]]$Case, [switch]$ChangedOnly, [string]$ArtifactProjectRoot = (Split-Path $PSScriptRoot -Parent), [string]$RunRoot)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$project = [IO.Path]::GetFullPath($ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($ArtifactProjectRoot))
$stamp = [guid]::NewGuid().ToString('N')
if ($RunRoot) { $runRoot = [IO.Path]::GetFullPath($ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($RunRoot)) }
else { $runRoot = Join-Path $project "artifacts/tasks/deploy-checks/runs/$stamp" }
$fixtures = Join-Path $runRoot 'temporary/fixtures spaces 한글'
$logs = Join-Path $runRoot 'logs'
$reports = Join-Path $runRoot 'reports'
$resultPath = Join-Path $reports 'results.json'
$lifecycleId = "run:deploy-checks:$stamp"
$shortTemporary = Join-Path $project "artifacts/dt/$($stamp.Substring(0,4))"
$lifecycleMembers = [ordered]@{run=$runRoot;logs=$logs;reports=$reports;fixture=$fixtures;shortTemporary=$shortTemporary}
$results = [Collections.Generic.List[object]]::new()
$lifecycleRegistered = $false
. (Join-Path $PSScriptRoot 'artifact-lifecycle.ps1')
try {
    if (Test-Path -LiteralPath $runRoot) { throw "Run identity already exists: $stamp" }
    if (Test-Path -LiteralPath $shortTemporary) { throw "Short temporary identity already exists: $shortTemporary" }
    $recordKey = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($lifecycleId))).ToLowerInvariant()
    if (Test-Path -LiteralPath (Join-Path $project "artifacts/maintenance/lifecycles/$recordKey.json")) { throw "Run producer identity already exists: $stamp" }
    $null = Register-ArtifactLifecycle -ProjectRoot $project -Id $lifecycleId -Kind run -Owner 'test-deploy-azrael' -Generated -ProtectionKnown -State pending -MembershipComplete $false -Members $lifecycleMembers
    $lifecycleRegistered = $true
    if (Test-Path -LiteralPath $shortTemporary) { throw "Short temporary identity already exists: $shortTemporary" }
    $shortTemporaryParent = Split-Path $shortTemporary -Parent
    if (-not (Test-Path -LiteralPath $shortTemporaryParent)) { New-Item -ItemType Directory -Path $shortTemporaryParent | Out-Null }
    New-Item -ItemType Directory -Path $shortTemporary | Out-Null
    $runParent = Split-Path $runRoot -Parent
    if (-not (Test-Path -LiteralPath $runParent)) { New-Item -ItemType Directory -Path $runParent | Out-Null }
    New-Item -ItemType Directory -Path $runRoot | Out-Null
    New-Item -ItemType Directory -Path $fixtures, $logs, $reports | Out-Null
    & node (Join-Path $PSScriptRoot 'test-pipeline-state.cjs') (Join-Path $reports 'pipeline-state-fixture')
    if ($LASTEXITCODE -ne 0) { throw 'Pipeline state behavioral checks failed.' }
$uiFeatureIds = @((Get-Content (Join-Path $PSScriptRoot 'azrael-feature-contracts.json') -Raw | ConvertFrom-Json).features | Where-Object area -eq 'ui' | ForEach-Object id)
$changedCases = @('policy selection', 'full install', 'module cache install', 'exhaustive regression verify only', 'related integration verify only', 'explicit policy verify only', 'full regression verify only', 'full regression force native', 'selected force native', 'shared module cache install', 'skip environment snapshot install', 'engine-preservation-fail', 'engine-preservation-missing-receipt', 'package-preservation-fail', 'package-preservation-binding', 'package-preservation-receipt', 'engine-preservation-recheck')
$pwsh = (Get-Process -Id $PID).Path
$changedCases += @('environment preflight failure', 'registered engine owner selection', 'account socket path', 'fixture path selection', 'short fixture install')
$changedCases += @('deployment capacity guard')
$changedCases += @('vsix entry index')
$changedCases += @('stage environment identity')
$changedCases += @('release packaging parent')
$changedCases += @('runtime staging resume')
$changedCases += @('host copy baseline')
$changedCases += @('source handoff unavailable')
# Execute the preparation policy reader independently of package/build inputs.
$prepareSource = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'prepare-independent-vscode.ps1') -Raw
$policyStart = $prepareSource.IndexOf('$sourceTestPolicy = $null')
$policyEnd = $prepareSource.IndexOf('if (-not $HostVersion)', $policyStart)
$policyReader = [scriptblock]::Create($prepareSource.Substring($policyStart, $policyEnd - $policyStart))
$policyFixture = Join-Path $reports 'preparation-policy.json'
foreach ($invalid in @('{}', '{"changedPaths":"x","exhaustive":false}', '{"changedPaths":[1],"exhaustive":false}', '{"changedPaths":[],"exhaustive":"false"}')) {
    $invalid | Set-Content -LiteralPath $policyFixture -Encoding utf8NoBOM
    $rejected = $false
    try { & { $SourceTestPolicyPath=$policyFixture; $ExhaustiveTests=$false; . $policyReader } } catch { $rejected = $_.Exception.Message -like 'SourceTestPolicyPath requires*' }
    if (-not $rejected) { throw 'Preparation accepted malformed source test policy.' }
}
'{"changedPaths":["scripts/a.cjs"],"exhaustive":false}' | Set-Content -LiteralPath $policyFixture -Encoding utf8NoBOM
& {
    $SourceTestPolicyPath=$policyFixture; $ExhaustiveTests=$true; . $policyReader
    if (-not $sourceTestPolicy.exhaustive -or $sourceTestPolicy.changedPaths[0] -cne 'scripts/a.cjs') { throw 'Preparation exhaustive override lost policy inputs.' }
}
& {
    $SourceTestPolicyPath=''; $ExhaustiveTests=$false; . $policyReader
    if ($null -ne $sourceTestPolicy) { throw 'Manual preparation must retain its default complete test policy.' }
}
Remove-Item -LiteralPath $policyFixture

function Assert-True([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Write-Utf8([string]$Path, [string]$Text) { $Text | Set-Content -LiteralPath $Path -Encoding utf8NoBOM }
$nodeStub = @'
const fs = require('node:fs'); const path = require('node:path');
const root = path.dirname(__dirname); const a = path.join(root, 'artifacts');
const scenario = JSON.parse(fs.readFileSync(path.join(a, 'scenario.json')));
const launchArgs = process.argv.slice(2);
if(launchArgs.length!==4 || launchArgs[0]!=='--args-file' || !path.isAbsolute(launchArgs[1]) || launchArgs[2]!=='--args-sha256') throw Error('Expected exclusive absolute args-file launch');
if(require('node:crypto').createHash('sha256').update(fs.readFileSync(launchArgs[1])).digest('hex')!==launchArgs[3]) throw Error('Argument SHA-256 mismatch');
const logicalArgs = JSON.parse(fs.readFileSync(launchArgs[1], 'utf8'));
if(logicalArgs.includes('--check-fixtures')) {
 fs.writeFileSync(path.join(a,'source-fixtures.json'),JSON.stringify({time:Date.now(),args:logicalArgs}));
 fs.writeFileSync(path.join(a,'source-fixture-environment.json'),JSON.stringify(Object.fromEntries(['AZRAEL_INSTRUCTION_TEST_ROOT','AZRAEL_CATALOG_TEST_ROOT','AZRAEL_MIGRATION_TEST_ROOT'].map(key=>[key,process.env[key]]))));
 process.exit(scenario.mode==='source-fixtures-fail'?29:0);
}
fs.writeFileSync(path.join(a, 'test-launch.json'), JSON.stringify(launchArgs));
fs.writeFileSync(path.join(a, 'test-invocation.json'), JSON.stringify(JSON.parse(fs.readFileSync(launchArgs[1], 'utf8'))));
fs.writeFileSync(path.join(a, 'source-start.json'), JSON.stringify({pid:process.pid, time:Date.now()}));
fs.writeFileSync(path.join(a,'source-execution-environment.json'),JSON.stringify(Object.fromEntries(['AZRAEL_INSTRUCTION_TEST_ROOT','AZRAEL_CATALOG_TEST_ROOT','AZRAEL_MIGRATION_TEST_ROOT'].map(key=>[key,process.env[key]]))));
(async () => {
 const deadline = Date.now()+10000;
 while (!fs.existsSync(path.join(a,'build-start.json'))) {
  if(Date.now()>deadline) throw new Error('build did not overlap source tests');
  await new Promise(r=>setTimeout(r,30));
 }
 if(scenario.mode==='source-fail') {
  while (!fs.existsSync(path.join(a,'owned-grandchild.pid'))) {
   if(Date.now()>deadline) throw new Error('build descendant did not start');
   await new Promise(r=>setTimeout(r,30));
  }
  console.error('causal source failure'); process.exit(23);
 }
 if(scenario.mode==='source-fail-after-build' || scenario.slowSource) {
  for(const marker of ['native-start.json','prepare-start.json']) {
   while(!fs.existsSync(path.join(a,marker))) {
    if(Date.now()>deadline) throw Error('build-ready work waited for source tests: '+marker);
    await new Promise(r=>setTimeout(r,20));
   }
  }
  if(scenario.mode==='source-fail-after-build') {console.error('causal source failure after build');process.exit(23);}
  for(const marker of ['native-end.json','prepare-end.json']) {
   while(!fs.existsSync(path.join(a,marker))) {
    if(Date.now()>deadline) throw Error('build-ready work did not finish: '+marker);
    await new Promise(r=>setTimeout(r,20));
   }
  }
  await new Promise(r=>setTimeout(r,350));
 }
 if(['account-engine-fail','account-prepare-fail'].includes(scenario.mode)) await new Promise(r=>setTimeout(r,30000));
 if(scenario.mode==='build-fail') await new Promise(r=>setTimeout(r,30000));
 else await new Promise(r=>setTimeout(r,250));
 fs.writeFileSync(path.join(a,'source-end.json'), JSON.stringify({time:Date.now()}));
})().catch(e=>{console.error(e);process.exit(9)});
'@
$buildStub = @'
param([string]$ReleaseName,[string]$SourceRoot,[switch]$SkipEngineBuild,[string]$EngineDirectory,[string]$CodeModeHostPath,[string]$CompanionVsixPath,[string]$EngineTargetDirectory,[string]$CargoCacheProjectRoot,[string]$ModuleCacheProjectRoot,[string]$WindowControlTargetDirectory,[string]$VirtualInputRuntimeDirectory,[string]$MultiPointerRuntimeDirectory,[string]$ComputerUseRuntimeDirectory,[string]$ComputerUsePluginDirectory,[switch]$LifecycleParentActive,[switch]$Resume,[string]$PipelineContextPath,[string]$SourceStateHandoffPath,[string]$SourceStateHandoffToken)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$a=Join-Path $root 'artifacts'
$scenario=Get-Content (Join-Path $a 'scenario.json') -Raw | ConvertFrom-Json
if(-not $LifecycleParentActive){throw 'deployment did not retain lifecycle ownership'}
$lifecycle=@(Get-ChildItem -LiteralPath (Join-Path $a 'maintenance/lifecycles') -Filter '*.json' | ForEach-Object {Get-Content -LiteralPath $_.FullName -Raw | ConvertFrom-Json} | Where-Object id -eq "version:$ReleaseName")
if($lifecycle.Count -ne 1 -or $lifecycle[0].state -ne 'pending' -or $lifecycle[0].membership_complete){throw 'version ownership was not pending before build'}
$lifecycle[0] | ConvertTo-Json -Depth 12 | Set-Content (Join-Path $a 'build-lifecycle-start.json')
$runLifecycle=@(Get-ChildItem -LiteralPath (Join-Path $a 'maintenance/lifecycles') -Filter '*.json' | ForEach-Object {Get-Content -LiteralPath $_.FullName -Raw | ConvertFrom-Json} | Where-Object kind -eq 'run')
if(-not $runLifecycle.Count -or @($runLifecycle | Where-Object {$_.state -ne 'pending' -or $_.membership_complete}).Count){throw 'fixture run ownership was not pending before build'}
ConvertTo-Json -InputObject $runLifecycle -Depth 12 | Set-Content (Join-Path $a 'build-fixture-lifecycle-start.json')
@{ReleaseName=$ReleaseName;SourceRoot=$SourceRoot;SkipEngineBuild=[bool]$SkipEngineBuild;EngineDirectory=$EngineDirectory;EngineTargetDirectory=$EngineTargetDirectory;CargoCacheProjectRoot=$CargoCacheProjectRoot;ModuleCacheProjectRoot=$ModuleCacheProjectRoot;WindowControlTargetDirectory=$WindowControlTargetDirectory;VirtualInputRuntimeDirectory=$VirtualInputRuntimeDirectory;MultiPointerRuntimeDirectory=$MultiPointerRuntimeDirectory;ComputerUseRuntimeDirectory=$ComputerUseRuntimeDirectory;ComputerUsePluginDirectory=$ComputerUsePluginDirectory} | ConvertTo-Json -Compress | Add-Content (Join-Path $a 'build-invocation.jsonl')
@{pid=$PID;time=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()} | ConvertTo-Json | Set-Content (Join-Path $a 'build-start.json')
$context=Get-Content -LiteralPath $PipelineContextPath -Raw|ConvertFrom-Json -AsHashtable
$stateRequest=Join-Path $a 'build-state-request.json'
$context.resume=$true;$context.lockHeld=$true;$context.action='start';$context.name='build.engine';$context.options=@{inputs=@{fixture=$true}}
$context|ConvertTo-Json -Depth 15|Set-Content -LiteralPath $stateRequest
& node (Join-Path $PSScriptRoot 'pipeline-state.cjs') $stateRequest|Out-Null
if($LASTEXITCODE -ne 0){throw 'fixture engine checkpoint start failed'}
$context.action='finish';$context.options=@{exitCode=0}
$context|ConvertTo-Json -Depth 15|Set-Content -LiteralPath $stateRequest
& node (Join-Path $PSScriptRoot 'pipeline-state.cjs') $stateRequest|Out-Null
if($LASTEXITCODE -ne 0){throw 'fixture engine checkpoint completion failed'}
$context.name='build.engine-ready';$context.action='start';$context.options=@{inputs=@{processId=$PID};dependencies=@('build.engine')}
$context|ConvertTo-Json -Depth 15|Set-Content -LiteralPath $stateRequest
& node (Join-Path $PSScriptRoot 'pipeline-state.cjs') $stateRequest|Out-Null
$context.action='finish';$context.options=@{exitCode=0;data=@{processId=$PID}}
$context|ConvertTo-Json -Depth 15|Set-Content -LiteralPath $stateRequest
& node (Join-Path $PSScriptRoot 'pipeline-state.cjs') $stateRequest|Out-Null
if($LASTEXITCODE -ne 0){throw 'fixture engine readiness completion failed'}
$deadline=[DateTime]::UtcNow.AddSeconds(10)
while(-not (Test-Path (Join-Path $a 'source-start.json'))) { if([DateTime]::UtcNow -gt $deadline){throw 'source tests did not overlap build'}; Start-Sleep -Milliseconds 30 }
if($scenario.mode -eq 'build-fail'){[Console]::Error.WriteLine('causal build failure');exit 17}
if($scenario.mode -eq 'command-error'){ & nonexistent-deployment-fixture-command; throw 'command should have failed' }
if($scenario.mode -eq 'source-fail'){
 $childInfo=[Diagnostics.ProcessStartInfo]::new((Get-Command node -CommandType Application).Source)
 $childInfo.UseShellExecute=$false
 $childInfo.CreateNoWindow=$true
 $childInfo.ArgumentList.Add('-e')
 $childInfo.ArgumentList.Add('setInterval(() => {}, 1000)')
 $child=[Diagnostics.Process]::Start($childInfo)
 $child.Id | Set-Content (Join-Path $a 'owned-grandchild.pid')
 Start-Sleep -Seconds 30
}
New-Item -ItemType Directory -Path (Join-Path $a "releases/$ReleaseName"),(Join-Path $a "build/$ReleaseName/companion/node_modules/typescript/lib") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $a "releases/$ReleaseName/engine") -Force | Out-Null
'fixture engine' | Set-Content (Join-Path $a "releases/$ReleaseName/engine/azrael.exe")
'fixture bridge' | Set-Content (Join-Path $a "releases/$ReleaseName/engine/azrael-bridge.exe")
New-Item -ItemType Directory -Path (Join-Path $a "releases/$ReleaseName/scripts") | Out-Null
'{"models":[{"slug":"release-catalog","tool_mode":null}]}' | Set-Content (Join-Path $a "releases/$ReleaseName/scripts/devin-catalog.json")
$buildInfo=@{engineSourceRoot=$SourceRoot}
if($scenario.moduleCache){
 $cachedTool=Join-Path $a 'cache/modules/companion/pinned/companion/node_modules/typescript/lib/typescript.js'
 New-Item -ItemType Directory -Path (Split-Path $cachedTool -Parent) -Force | Out-Null
 'cached typescript' | Set-Content $cachedTool
 $buildInfo.moduleBuild=@{typeScriptPath=$cachedTool}
}
$buildInfo | ConvertTo-Json | Set-Content (Join-Path $a "releases/$ReleaseName/build-info.json")
'pinned typescript' | Set-Content (Join-Path $a "build/$ReleaseName/companion/node_modules/typescript/lib/typescript.js")
if(-not $scenario.sourceHandoffUnavailable){
 $statePath=Join-Path $a 'build-source-state.json'
 @{schema=1;entries=@{fixture=@{generation='fixture-generation';metadata=@{inventory='observed'};snapshot=@{sourceSha256='verified'}}}}|ConvertTo-Json -Depth 6|Set-Content $statePath -Encoding utf8NoBOM
 & node (Join-Path $PSScriptRoot 'engine-source-handoff.cjs') publish --handoff $SourceStateHandoffPath --token $SourceStateHandoffToken --release (Join-Path $a "releases/$ReleaseName") --state $statePath --generation fixture-generation|Out-Null
 if($LASTEXITCODE -ne 0){throw 'fixture handoff publish failed'}
}
@{time=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()} | ConvertTo-Json | Set-Content (Join-Path $a 'build-end.json')
if($scenario.mode -eq 'build-mutation'){'changed' | Set-Content (Join-Path $root 'input.txt')}
'@
$accountControlsStub = @'
import { catalog } from './artifact-lifecycle.cjs';
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url))); const a = path.join(root, 'artifacts');
const scenario = JSON.parse(fs.readFileSync(path.join(a, 'scenario.json')));
const args = process.argv.slice(2);
const parentOption = args.indexOf('--parent-lifecycle-id');
if (parentOption !== 7 || args.length !== 9) throw new Error('account parent lifecycle option mismatch');
const parentId = args.splice(parentOption, 2)[1];
const [engine, bridge, state, socket, flag] = args;
const parent = catalog(root).find(record => record.id === parentId);
const inside = (base, candidate) => { const relative = path.relative(base, candidate); return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep)); };
if (parentId !== 'run:account-controls:chosen' || !parent || parent.state !== 'pending' || !parent.members.some(member => inside(member.path, state))) throw new Error('account parent must own planned fixture state');
if (!fs.existsSync(path.join(a, 'build-end.json')) || !fs.existsSync(path.join(a, 'source-end.json')) ||
    !fs.existsSync(path.join(a, 'logs/deploy-chosen/inputs-initial.json')) || !fs.existsSync(path.join(a, 'prepare-end.json')) || !fs.existsSync(path.join(a, 'native-end.json'))) throw new Error('account gate ordering mismatch');
if (args.length !== 7 || flag !== '--account-controls-only' || args[5] !== '--models-catalog' || args[6] !== path.join(a,'releases/chosen/scripts/devin-catalog.json') || !Array.isArray(JSON.parse(fs.readFileSync(args[6])).models) || fs.existsSync(state) || fs.existsSync(path.dirname(socket))) throw new Error('account gate arguments/catalog/freshness mismatch');
const native=JSON.parse(fs.readFileSync(path.join(a,'native-end.json')));
if(JSON.parse(fs.readFileSync(native.receiptPath)).status!=='passed' || !fs.existsSync(path.join(JSON.parse(fs.readFileSync(path.join(a,'prepare-end.json'))).outputDirectory,'independent-prepared.json'))) throw Error('account prerequisite receipt missing');
fs.writeFileSync(path.join(a, 'account-invocation.json'), JSON.stringify(args));
if (scenario.mode === 'account-command-fail') { console.error('causal account controls failure'); process.exit(37); }
fs.mkdirSync(state, {recursive:true});
if (scenario.mode === 'account-missing-report') process.exit(0);
const result = {status:'passed', route:'account-controls', engine, bridge, modelRequests:0, usageCreditConsumeRequests:0};
if (scenario.mode === 'account-status') result.status = 'failed';
if (scenario.mode === 'account-route') result.route = 'other';
if (scenario.mode === 'account-engine') result.engine = path.join(a, 'latest/azrael.exe');
if (scenario.mode === 'account-bridge') result.bridge = path.join(a, 'latest/azrael-bridge.exe');
if (scenario.mode === 'account-model-request') result.modelRequests = 1;
if (scenario.mode === 'account-credit-request') result.usageCreditConsumeRequests = 1;
if (scenario.mode === 'account-string-count') result.modelRequests = '0';
fs.writeFileSync(path.join(state, 'verification.json'), JSON.stringify(result));
if(result.status==='passed' && scenario.mode==='account-success') fs.writeFileSync(path.join(a,'account-passed.json'),JSON.stringify({time:Date.now()}));
'@
$preservationStub = @'
const fs=require('node:fs'),path=require('node:path');
const root=path.dirname(__dirname),a=path.join(root,'artifacts');
const args=process.argv.slice(2),config=JSON.parse(fs.readFileSync(args[args.indexOf('--config')+1],'utf8'));
const scenario=JSON.parse(fs.readFileSync(path.join(a,'scenario.json'),'utf8'));
fs.appendFileSync(path.join(a,'preservation-invocation.jsonl'),JSON.stringify({action:args[0],config})+'\n');
function same(actual,expected,label){if(actual!==expected)throw Error(label+' forwarding mismatch');}
same(config.projectRoot,root,'project root');
same(config.uiRoot,path.join(a,'pristine UI'),'preservation UI root');
same(config.engineSourceRoot,path.join(root,'engine'),'engine source');
fs.mkdirSync(config.outputDirectory,{recursive:true});
const receiptPath=path.join(config.outputDirectory,'receipt.json');
const executionSummary={unit:'invocation-group',kinds:{source:{executed:config.checkPhase==='source'?1:0},native:{executed:config.checkPhase==='source'?0:1}}};
if(args[0]==='run'){
 if(config.checkPhase==='source'){
  if(scenario.mode==='engine-source-preflight-fail'){console.error('causal source preflight failure');process.exit(51);}
  if(fs.existsSync(path.join(a,'build-start.json')))throw Error('source preflight ran after build');
  fs.writeFileSync(receiptPath,JSON.stringify({status:'passed',checkPhase:'source',sourceExecution:{fixture:true},executionSummary}));console.log(JSON.stringify({status:'passed',receiptPath,sourceExecution:{fixture:true}}));process.exit(0);
 }
 if(!config.sourceReceiptPath || !fs.existsSync(config.sourceReceiptPath))throw Error('source handoff receipt missing');
 same(config.engineDirectory,path.join(a,'releases/chosen/engine'),'engine directory');
 if(scenario.mode.startsWith('account-') || scenario.mode==='source-fail-after-build'){
  fs.writeFileSync(path.join(a,'native-start.json'),JSON.stringify({pid:process.pid,time:Date.now()}));
  (async()=>{const deadline=Date.now()+10000;while(!fs.existsSync(path.join(a,'prepare-start.json'))){if(Date.now()>deadline)throw Error('prepare did not start');await new Promise(r=>setTimeout(r,20));}
   if(scenario.mode==='account-engine-fail'){console.error('causal engine preservation failure');process.exit(41);}
   if(['account-prepare-fail','source-fail-after-build'].includes(scenario.mode))await new Promise(r=>setTimeout(r,30000));
   else await new Promise(r=>setTimeout(r,250));
   fs.writeFileSync(receiptPath,JSON.stringify({status:'passed',executionSummary}));fs.writeFileSync(path.join(a,'native-end.json'),JSON.stringify({time:Date.now(),receiptPath}));console.log(JSON.stringify({receiptPath}));
  })().catch(e=>{console.error(e);process.exit(55)});return;
 }
 if(scenario.overlap){
  const started=Date.now();fs.writeFileSync(path.join(a,'native-start.json'),JSON.stringify({pid:process.pid,time:started}));fs.writeFileSync(path.join(a,'native-overlap-start.json'),JSON.stringify({time:started}));
  const poll=setInterval(()=>{
   if(fs.existsSync(path.join(a,'prepare-invocation.json'))){clearInterval(poll);fs.writeFileSync(receiptPath,JSON.stringify({status:'passed',executionSummary}));fs.writeFileSync(path.join(a,'native-end.json'),JSON.stringify({time:Date.now(),receiptPath}));console.log(JSON.stringify({receiptPath}));}
   else if(Date.now()-started>10000){clearInterval(poll);console.error('preparation did not overlap native check');process.exitCode=54;}
  },25);
  return;
 }
 if(scenario.mode==='engine-preservation-fail'){console.error('causal engine preservation failure');process.exit(41);}
 if(scenario.mode==='engine-preservation-missing-receipt'){console.log('{}');process.exit(0);}
 fs.writeFileSync(receiptPath,JSON.stringify({status:'passed',executionSummary}));
 console.log(JSON.stringify({receiptPath}));
}else if(args[0]==='verify'){
 same(config.uiRoot,path.join(a,'pristine UI'),'UI root');
 require('node:assert/strict').deepStrictEqual(config.sourceTestPolicy,JSON.parse(fs.readFileSync(path.join(a,'prepare-invocation.json'),'utf8')).SourceTestPolicy,'package verification must use the exact preparation source-test policy');
 if(!config.receiptPath||!config.reportPath)throw Error('package preservation paths missing');
 if(scenario.mode==='package-preservation-fail'){console.error('causal package preservation failure');process.exit(43);}
 if(!fs.existsSync(config.receiptPath))throw Error('causal package preservation receipt missing');
 if(JSON.parse(fs.readFileSync(config.bindingPath,'utf8')).fixture!==true)throw Error('causal package preservation binding mismatch');
}else if(args[0]==='verify-receipt'){
 if(config.checkPhase==='source'){
  if(scenario.mode==='engine-source-preflight-fail'){console.error('causal source preflight failure');process.exit(51);}
  if(!config.receiptPath||!fs.existsSync(config.receiptPath))throw Error('source handoff receipt missing');
  console.log(JSON.stringify({...JSON.parse(fs.readFileSync(config.receiptPath,'utf8')),receiptPath:config.receiptPath}));process.exit(0);
 }
 if(scenario.mode==='engine-preservation-recheck'){console.error('causal engine preservation recheck failure');process.exit(47);}
 if(!config.receiptPath||!fs.existsSync(config.receiptPath))throw Error('engine preservation receipt missing');
}else throw Error('unexpected preservation command');
'@
$prepareStub = @'
param([string]$ReleaseDirectory,[string]$OutputDirectory,[string]$StateRoot,[string]$SourceCodexHome,[string]$SourceExtensionPath,[string]$TypeScriptPath,[switch]$SkipCodexEnvironmentSnapshot,[switch]$ChangedOnlyTests,[string]$NamespaceCacheProjectRoot,[string]$SourceTestPolicyPath,[switch]$ExhaustiveTests,[string]$SourceStatePath,[string]$SourceGeneration)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$a=Join-Path $root 'artifacts'
$scenario=Get-Content (Join-Path $a 'scenario.json') -Raw | ConvertFrom-Json
if($scenario.sourceHandoffUnavailable){
 if($SourceStatePath -or $SourceGeneration){throw 'unavailable handoff must use full validation'}
}else{
 if($SourceGeneration -cne 'fixture-generation' -or -not (Test-Path -LiteralPath $SourceStatePath)){throw 'prepare source observation forwarding missing'}
 if($SourceStatePath -eq (Join-Path $a 'build-source-state.json')){throw 'prepare must own its source state'}
 $engineConfig=Get-Content -LiteralPath (Join-Path $a 'logs/deploy-chosen/engine-preservation-inputs.json') -Raw|ConvertFrom-Json
 if($engineConfig.sourceStatePath -eq $SourceStatePath -or $engineConfig.sourceGeneration -cne $SourceGeneration){throw 'consumers must have independent state files'}
 if((Get-FileHash -LiteralPath $engineConfig.sourceStatePath).Hash -cne (Get-FileHash -LiteralPath $SourceStatePath).Hash){throw 'consumers did not receive the same observation'}
}
@{SourceTestPolicy=(Get-Content -LiteralPath $SourceTestPolicyPath -Raw | ConvertFrom-Json);ReleaseDirectory=$ReleaseDirectory;OutputDirectory=$OutputDirectory;TypeScriptPath=$TypeScriptPath;SourceExtensionPath=$SourceExtensionPath;NamespaceCacheProjectRoot=$NamespaceCacheProjectRoot;SkipCodexEnvironmentSnapshot=[bool]$SkipCodexEnvironmentSnapshot;ChangedOnlyTests=[bool]$ChangedOnlyTests;ChangedOnlyTestsBound=$PSBoundParameters.ContainsKey('ChangedOnlyTests')} | ConvertTo-Json | Set-Content (Join-Path $a 'prepare-invocation.json')
@{pid=$PID;time=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()} | ConvertTo-Json | Set-Content (Join-Path $a 'prepare-start.json')
if($scenario.mode -like 'account-*' -or $scenario.mode -eq 'source-fail-after-build'){
 $deadline=[DateTime]::UtcNow.AddSeconds(10)
 while(-not (Test-Path (Join-Path $a 'native-start.json'))){if([DateTime]::UtcNow -gt $deadline){throw 'engine did not start'};Start-Sleep -Milliseconds 20}
 if($scenario.mode -eq 'account-prepare-fail'){[Console]::Error.WriteLine('causal prepare failure');exit 29}
 if($scenario.mode -in @('account-engine-fail','source-fail-after-build')){Start-Sleep -Seconds 30}else{Start-Sleep -Milliseconds 250}
}
if($scenario.mode -eq 'prepare-fail'){
 if($scenario.PSObject.Properties['resumeFailure'] -and $scenario.resumeFailure){
  $deadline=[DateTime]::UtcNow.AddSeconds(10)
  while(-not (Test-Path (Join-Path $a 'source-end.json'))){if([DateTime]::UtcNow -gt $deadline){throw 'source did not finish before controlled prepare failure'};Start-Sleep -Milliseconds 20}
 }
 [Console]::Error.WriteLine('causal prepare failure');exit 29
}
New-Item -ItemType Directory -Path $OutputDirectory | Out-Null
$vsix=Join-Path $OutputDirectory 'azrael-host.vsix'
$archive=[IO.Compression.ZipFile]::Open($vsix,[IO.Compression.ZipArchiveMode]::Create)
try {$entry=$archive.CreateEntry('extension/package.json');$writer=[IO.StreamWriter]::new($entry.Open());try {$writer.Write('{"version":"1.2.3"}')}finally{$writer.Dispose()}}finally{$archive.Dispose()}
$hash=(Get-FileHash -LiteralPath $vsix).Hash
$version='1.2.3'
if($scenario.mode -eq 'prepared-hash'){$hash='bad'}
if($scenario.mode -eq 'prepared-version'){$version='9.9.9'}
if($scenario.mode -eq 'wrong-package'){$vsix=Join-Path $a 'latest/azrael-host.vsix'}
$preservationReceipt=Join-Path $OutputDirectory 'preservation-receipt.json'
$preservationReport=Join-Path $OutputDirectory 'preservation-report.json'
'{"status":"passed","executionSummary":{"unit":"invocation-group","kinds":{"source":{"executed":0,"reused":0,"miss":0,"forced":0,"preflightReused":0},"native":{"executed":0,"reused":0,"miss":0,"forced":0,"preflightReused":0},"cargo":{"executed":0,"reused":0,"miss":0,"forced":0,"preflightReused":0}}}}' | Set-Content $preservationReceipt
'{}' | Set-Content $preservationReport
$preservationBinding=Join-Path $OutputDirectory 'preservation-binding.json'
@{fixture=($scenario.mode -ne 'package-preservation-binding')} | ConvertTo-Json | Set-Content $preservationBinding
if($scenario.mode -eq 'package-preservation-receipt'){Remove-Item -LiteralPath $preservationReceipt}
$featureIds=if($ChangedOnlyTests){@()}else{@($scenario.uiFeatureIds)}
@{PreservationFeatureIds=@($featureIds);HostVsix=$vsix;HostSha256=$hash;HostVersion=$version;ReleaseDirectory=$ReleaseDirectory;PreservationReceipt=$preservationReceipt;PreservationReport=$preservationReport;PreservationBinding=$preservationBinding} | ConvertTo-Json | Set-Content (Join-Path $OutputDirectory 'independent-prepared.json')
@{time=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();outputDirectory=$OutputDirectory} | ConvertTo-Json | Set-Content (Join-Path $a 'prepare-end.json')
if($scenario.mode -eq 'prepare-mutation'){'changed' | Set-Content (Join-Path $root 'input.txt')}
'@
$checkStub = @'
param([string]$HostVsixPath,[string]$FixtureRoot,[string]$ParentLifecycleId,[string]$StateRoot,[switch]$UseFreshState,[string]$TypeScriptPath,[string]$UiSourcePath,[string]$OriginalExtensionPath,[string]$OriginalAudioPath,[string]$CodePath,[switch]$VerifyStandalone)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$a=Join-Path $root 'artifacts'
if ($ParentLifecycleId -cnotmatch '^run:verification:chosen(?:-[a-f0-9]{8})?$') { throw 'acceptance parent lifecycle ID mismatch' }
$parentKey=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($ParentLifecycleId))).ToLowerInvariant()
$parent=Get-Content -LiteralPath (Join-Path $a "maintenance/lifecycles/$parentKey.json") -Raw | ConvertFrom-Json
$containsFixture=@($parent.members | Where-Object {
 $relative=[IO.Path]::GetRelativePath($_.path,$FixtureRoot)
 $relative -eq '.' -or (-not [IO.Path]::IsPathRooted($relative) -and $relative -ne '..' -and -not $relative.StartsWith('..'+[IO.Path]::DirectorySeparatorChar))
}).Count -gt 0
if ($parent.id -cne $ParentLifecycleId -or $parent.state -cne 'pending' -or -not $containsFixture) { throw 'acceptance parent must own planned fixture' }
$scenario=Get-Content (Join-Path $a 'scenario.json') -Raw | ConvertFrom-Json
if(-not (Test-Path (Join-Path $a 'source-end.json'))){throw 'acceptance started before source tests passed'}
if($scenario.mode -like 'account-*'){
 foreach($marker in @('native-end.json','prepare-end.json','account-passed.json')){if(-not (Test-Path (Join-Path $a $marker))){throw "acceptance prerequisite missing: $marker"}}
}
@{HostVsixPath=$HostVsixPath;FixtureRoot=$FixtureRoot;ParentLifecycleId=$ParentLifecycleId;StateRoot=$StateRoot;UseFreshState=[bool]$UseFreshState;TypeScriptPath=$TypeScriptPath;UiSourcePath=$UiSourcePath;OriginalExtensionPath=$OriginalExtensionPath;OriginalAudioPath=$OriginalAudioPath;CodePath=$CodePath;VerifyStandalone=[bool]$VerifyStandalone} | ConvertTo-Json | Set-Content (Join-Path $a 'check-invocation.json')
New-Item -ItemType Directory -Path $FixtureRoot | Out-Null
if($scenario.mode -eq 'acceptance-command-fail'){[Console]::Error.WriteLine('causal acceptance failure');exit 31}
if($scenario.mode -eq 'missing-acceptance'){exit 0}
$exitCodes=[ordered]@{initialInventory=0;hostInstall=0;finalInventory=0;host=0}
if($VerifyStandalone){$exitCodes.standaloneHost=0}
if($scenario.mode -eq 'failed-stage'){$exitCodes[$scenario.stage]=5}
if($scenario.mode -eq 'missing-stage'){$exitCodes.Remove('host')}
if($scenario.mode -eq 'null-stage'){$exitCodes.host=$null}
$passed=$scenario.mode -ne 'passed-false'
if($scenario.mode -eq 'passed-string'){$passed='True'}
$identity=@{vsix=$HostVsixPath;sha256=(Get-FileHash -LiteralPath $HostVsixPath).Hash;version='1.2.3'}
if($scenario.mode -eq 'acceptance-hash'){$identity.sha256='bad'}
if($scenario.mode -eq 'acceptance-version'){$identity.version='2.0.0'}
if($scenario.mode -eq 'acceptance-path'){$identity.vsix=Join-Path $a 'latest/azrael-host.vsix'}
@{passed=$passed;exitCodes=$exitCodes;hostPackage=$identity;useFreshState=[bool]$UseFreshState;standaloneVerified=[bool]$VerifyStandalone} | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $FixtureRoot 'check-result.json')
if($scenario.mode -eq 'package-mutation'){'changed' | Add-Content -LiteralPath $HostVsixPath}
if($scenario.mode -eq 'check-mutation'){'changed' | Set-Content (Join-Path $root 'input.txt')}
if($scenario.mode -eq 'check-addition'){'new' | Set-Content (Join-Path $root 'new.txt')}
if($scenario.mode -eq 'check-deletion'){Remove-Item -LiteralPath (Join-Path $root 'input.txt')}
if($scenario.mode -eq 'submodule-mutation'){'changed submodule content' | Set-Content (Join-Path $root 'modules/vendor/input.txt')}
'@
$installStub = @'
param([string]$ReleaseDirectory,[string]$PreparedPackageDirectory,[string]$StateRoot,[string]$SourceCodexHome,[string]$WorkspacePath,[string]$ExtensionsDir,[string]$CodePath,[switch]$NoLaunch,[string]$UserDataDir,[switch]$SkipCodexEnvironmentSnapshot)
$ErrorActionPreference='Stop'
$a=Join-Path (Split-Path $PSScriptRoot -Parent) 'artifacts'
$scenario=Get-Content (Join-Path $a 'scenario.json') -Raw | ConvertFrom-Json
$argsCopy=@{ReleaseDirectory=$ReleaseDirectory;PreparedPackageDirectory=$PreparedPackageDirectory;StateRoot=$StateRoot;SourceCodexHome=$SourceCodexHome;WorkspacePath=$WorkspacePath;ExtensionsDir=$ExtensionsDir;CodePath=$CodePath;NoLaunch=[bool]$NoLaunch;UserDataDir=$UserDataDir;SkipCodexEnvironmentSnapshot=[bool]$SkipCodexEnvironmentSnapshot}
$argsCopy | ConvertTo-Json | Set-Content (Join-Path $a 'install-invocation.json')
if($scenario.mode -eq 'install-fail'){throw 'causal installer failure'}
if($scenario.mode -eq 'install-nonthrow-exit'){$global:LASTEXITCODE=7;return}
if($scenario.mode -eq 'install-no-result'){return}
$prepared=Get-Content (Join-Path $PreparedPackageDirectory 'independent-prepared.json') -Raw | ConvertFrom-Json
$receiptPath=Join-Path $a 'explicit installed receipt.json'
$receipt=@{status='installed-reload-required';hostInstalled=$true;reloadRequired=$true;releaseDirectory=$ReleaseDirectory;packageDirectory=$PreparedPackageDirectory;hostVsix=$prepared.HostVsix;hostVersion=$prepared.HostVersion}
if($scenario.mode -eq 'install-failed-receipt'){$receipt.status='failed'}
if($scenario.mode -eq 'install-wrong-receipt-package'){$receipt.packageDirectory=Join-Path $a 'latest'}
if($scenario.mode -eq 'install-wrong-receipt-version'){$receipt.hostVersion='9.9.9'}
$receipt | ConvertTo-Json | Set-Content -LiteralPath $receiptPath
[pscustomobject]@{Prepared=$true;Installed=$true;ReloadRequired=$true;Receipt=$receiptPath;HostVsix=$prepared.HostVsix;ReleaseDirectory=$ReleaseDirectory;Launched=$false}
'@
function Test-VsixEntryIndex([string]$FixtureRoot, [string]$PreparationPath) {
    $tokens = $null; $parseErrors = $null
    $ast = [Management.Automation.Language.Parser]::ParseFile($PreparationPath, [ref]$tokens, [ref]$parseErrors)
    if ($parseErrors.Count) { throw 'Preparation script syntax failed.' }
    $definition = $ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Assert-IntegratedHostVsixContents'}, $true)
    $quotedScripts = "'" + (Split-Path $PreparationPath -Parent).Replace("'", "''") + "'"
    . ([scriptblock]::Create($definition.Extent.Text.Replace('$PSScriptRoot', $quotedScripts)))
    $release = Join-Path $FixtureRoot 'release'
    New-Item -ItemType Directory -Path (Join-Path $release 'computer-use'), (Join-Path $release 'window-control') | Out-Null
    $bytes = [Text.Encoding]::UTF8.GetBytes('runtime fixture')
    $hash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()
    $runtimeFiles = @('node.exe', 'node_repl.exe' | ForEach-Object {
        [IO.File]::WriteAllBytes((Join-Path $release "computer-use/$_"), $bytes)
        @{path=$_;bytes=$bytes.Length;sha256=$hash}
    })
    @{schema=2;kind='azrael-node-repl';files=$runtimeFiles;packages=@()} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $release 'computer-use/manifest.json') -Encoding utf8NoBOM
    @{files=@(@{path='backend.bin';sha256=$hash});virtualInput=$false;multiPointer=$false} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $release 'window-control/manifest.json') -Encoding utf8NoBOM
    $entries = [Collections.Generic.Dictionary[string, byte[]]]::new([StringComparer]::Ordinal)
    # Populate unrelated required UI/host content from its owning manifest loop.
    foreach ($variable in @('requiredEntry', 'module')) {
        $loop = $definition.Body.Find({param($n) $n -is [Management.Automation.Language.ForEachStatementAst] -and $n.Variable.VariablePath.UserPath -eq $variable}, $true)
        foreach ($literal in $loop.Condition.FindAll({param($n) $n -is [Management.Automation.Language.StringConstantExpressionAst]}, $true)) {
            $name = if ($variable -eq 'module') { "extension/out/$($literal.Value)" } else { $literal.Value }
            $entries[$name] = $bytes
        }
    }
    foreach ($name in @('node.exe', 'node_repl.exe', 'manifest.json')) { $entries["extension/computer-use/$name"] = [IO.File]::ReadAllBytes((Join-Path $release "computer-use/$name")) }
    $entries['extension/window-control/backend.bin'] = $bytes
    $entries['extension/window-control/manifest.json'] = [IO.File]::ReadAllBytes((Join-Path $release 'window-control/manifest.json'))
    $build = [pscustomobject]@{sha256=@{}}
    foreach ($name in $entries.Keys | Where-Object { $_.StartsWith('extension/out/') }) { $build.sha256['host/' + $name.Substring('extension/out/'.Length)] = $hash }
    $build.sha256['window-control/manifest.json'] = (Get-FileHash -LiteralPath (Join-Path $release 'window-control/manifest.json')).Hash
    $scenarios = @('valid', 'missing-computer', 'duplicate-computer', 'case-computer', 'unicode-duplicate-computer', 'hash-computer', 'missing-window', 'duplicate-window', 'hash-window')
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    foreach ($scenario in $scenarios) {
        $vsix = Join-Path $FixtureRoot "$scenario.vsix"
        $zip = [IO.Compression.ZipFile]::Open($vsix, [IO.Compression.ZipArchiveMode]::Create)
        try {
            foreach ($name in $entries.Keys) {
                $computerTarget = $name -ceq 'extension/computer-use/node.exe'
                $windowTarget = $name -ceq 'extension/window-control/backend.bin'
                if (($computerTarget -and $scenario -eq 'missing-computer') -or ($windowTarget -and $scenario -eq 'missing-window')) { continue }
                $target = if ($computerTarget -and $scenario -eq 'case-computer') { 'extension/computer-use/NODE.exe' } else { $name }
                [byte[]]$payload = if (($computerTarget -and $scenario -eq 'hash-computer') -or ($windowTarget -and $scenario -eq 'hash-window')) { [byte[]]@(0) } else { $entries[$name] }
                $stream = $zip.CreateEntry($target).Open()
                try { $stream.Write($payload, 0, $payload.Length) } finally { $stream.Dispose() }
                if (($computerTarget -and $scenario -in @('duplicate-computer', 'unicode-duplicate-computer')) -or ($windowTarget -and $scenario -eq 'duplicate-window')) {
                    $duplicate = if ($scenario -eq 'unicode-duplicate-computer') { "extension/computer-use/no$([char]0x00ad)de.exe" } else { $name }
                    $stream = $zip.CreateEntry($duplicate).Open()
                    try { $stream.Write($entries[$name], 0, $entries[$name].Length) } finally { $stream.Dispose() }
                }
            }
        } finally { $zip.Dispose() }
        $failure = $null
        try { Assert-IntegratedHostVsixContents -VsixPath $vsix } catch { $failure = $_.Exception.Message }
        if ($scenario -eq 'valid') { if ($failure) { throw $failure }; continue }
        $runtime = if ($scenario.EndsWith('window')) { 'Window Control' } else { 'Computer Use' }
        $expected = if ($scenario.StartsWith('hash-')) { "$runtime VSIX hash mismatch:*" } else { "$runtime VSIX entry missing or ambiguous:*" }
        if (-not $failure -or $failure -notlike $expected) { throw "Wrong VSIX validation result for ${scenario}: $failure" }
    }
    [pscustomobject]@{Scenarios=$scenarios.Count;Passed=$scenarios.Count}
}

function Test-HostCopyBaseline([string]$FixtureRoot, [string]$CheckPath, [string]$StateScript = (Join-Path (Split-Path $CheckPath -Parent) 'directory-state.ps1')) {
    $tokens = $null; $parseErrors = $null
    $ast = [Management.Automation.Language.Parser]::ParseFile($CheckPath, [ref]$tokens, [ref]$parseErrors)
    if ($parseErrors.Count) { throw 'Host check script syntax failed.' }
    $assignments = @{}
    foreach ($name in @('sourceBefore', 'fixtureOriginalExpected', 'sourceAfter', 'fixtureOriginalAfter', 'summary')) {
        $assignments[$name] = $ast.Find({param($n) $n -is [Management.Automation.Language.AssignmentStatementAst] -and $n.Left -is [Management.Automation.Language.VariableExpressionAst] -and $n.Left.VariablePath.UserPath -eq $name}, $true)
        if (-not $assignments[$name]) { throw "Host preservation assignment missing: $name" }
    }
    $statements = @($assignments.sourceAfter.Parent.Statements)
    $index = [array]::IndexOf($statements, $assignments.sourceAfter)
    $finalCheck = [scriptblock]::Create(($statements[$index..($index+2)].Extent.Text -join "`n"))
    $summaryTable = $assignments.summary.Right.Find({param($n) $n -is [Management.Automation.Language.HashtableAst]}, $true)
    $reportExpressions = @{}
    foreach ($pair in $summaryTable.KeyValuePairs) { if ($pair.Item1.Value -in @('originalSource', 'originalFixture')) { $reportExpressions[$pair.Item1.Value] = [scriptblock]::Create($pair.Item2.Extent.Text) } }
    . $StateScript
    $reads = [Collections.Generic.List[string]]::new()
    function Get-DirectoryState([string]$Path) { $reads.Add($Path); Get-AzraelDirectoryState -Path $Path }
    $scenarios = @('normal', 'source-change', 'fixture-change', 'fixture-add', 'fixture-delete')
    foreach ($scenario in $scenarios) {
        $reads.Clear()
        $originalSource = Join-Path $FixtureRoot "$scenario/source"
        $originalFixture = Join-Path $FixtureRoot "$scenario/fixture"
        New-Item -ItemType Directory -Path $originalSource, $originalFixture | Out-Null
        foreach ($directory in @($originalSource, $originalFixture)) {
            [IO.File]::WriteAllText((Join-Path $directory 'a.txt'), 'alpha')
            [IO.File]::WriteAllText((Join-Path $directory 'b.txt'), 'beta')
        }
        . ([scriptblock]::Create($assignments.sourceBefore.Extent.Text))
        . ([scriptblock]::Create($assignments.fixtureOriginalExpected.Extent.Text))
        switch ($scenario) {
            'source-change' { [IO.File]::WriteAllText((Join-Path $originalSource 'a.txt'), 'gamma') }
            'fixture-change' { [IO.File]::WriteAllText((Join-Path $originalFixture 'a.txt'), 'gamma') }
            'fixture-add' { [IO.File]::WriteAllText((Join-Path $originalFixture 'extra.txt'), 'x') }
            'fixture-delete' { Remove-Item -LiteralPath (Join-Path $originalFixture 'b.txt') }
        }
        $failure = $null
        try { . $finalCheck } catch { $failure = $_.Exception.Message }
        if ($reads.Count -ne 3 -or @($reads | Where-Object { $_ -ceq $originalSource }).Count -ne 2 -or @($reads | Where-Object { $_ -ceq $originalFixture }).Count -ne 1) { throw 'Host preservation must measure source twice and fixture once.' }
        if ($scenario -ne 'normal') {
            if ($failure -cne 'Original Codex source changed or validation fixture differs from the source snapshot.') { throw "Preservation missed ${scenario}: $failure" }
            continue
        }
        if ($failure) { throw $failure }
        $sourceReport = . $reportExpressions.originalSource
        $fixtureReport = . $reportExpressions.originalFixture
        if (-not $sourceReport.unchanged -or $sourceReport.before.path -cne $originalSource -or $sourceReport.after.sha256 -cne $sourceBefore.sha256) { throw 'Source observation report differs.' }
        if (-not $fixtureReport.matchesSource -or $fixtureReport.expected.path -cne $originalFixture -or $fixtureReport.expected.sha256 -cne $sourceBefore.sha256 -or $fixtureReport.after.sha256 -cne $fixtureReport.expected.sha256 -or $fixtureReport.Contains('before') -or $fixtureReport.Contains('unchanged')) { throw 'Fixture expectations must be distinct from observations.' }
    }
    [pscustomobject]@{Scenarios=$scenarios.Count;Passed=$scenarios.Count;HashCallsPerScenario=3}
}

function Test-StageEnvironmentIdentity {
    param([string]$DeployPath, [string]$BuildPath, [string]$MetricsPath)
    . $MetricsPath
    $deployAst = [Management.Automation.Language.Parser]::ParseFile($DeployPath, [ref]$null, [ref]$null)
    foreach ($name in @('ConvertTo-StageInput', 'Get-StageInputs')) {
        $definition = $deployAst.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name}, $true)
        . ([scriptblock]::Create($definition.Extent.Text))
    }
    $buildAst = [Management.Automation.Language.Parser]::ParseFile($BuildPath, [ref]$null, [ref]$null)
    $buildEnvironmentAssignment = $buildAst.Find({param($node) $node -is [Management.Automation.Language.AssignmentStatementAst] -and $node.Left.Extent.Text -ceq '$buildEnvironment'}, $true)
    $buildHashAssignment = $buildAst.Find({param($node) $node -is [Management.Automation.Language.AssignmentStatementAst] -and $node.Left.Extent.Text -ceq '$engineInputs.environmentSha256'}, $true)
    $projectRoot = Split-Path (Split-Path $DeployPath -Parent) -Parent
    $ReleaseName = 'environment-identity-fixture'
    $pipelineRoot = Join-Path $projectRoot "artifacts/logs/deploy-$ReleaseName"
    $script:toolIdentities = @{}
    $script:inputSnapshot = 'fixed-source'
    $executable = (Get-Process -Id $PID).Path
    $fixtureNames = @{AZRAEL_INSTRUCTION_TEST_ROOT='instructions';AZRAEL_CATALOG_TEST_ROOT='catalog';AZRAEL_MIGRATION_TEST_ROOT='migration';AZRAEL_WORKBENCH_TEST_ROOT='workbench'}
    $observed = @()
    foreach ($attempt in @('', ('attempts/' + ('a' * 32)), ('attempts/' + ('b' * 32)))) {
        $logs = if ($attempt) { Join-Path $pipelineRoot $attempt } else { $pipelineRoot }
        $script:sourceFixtureRoot = if ($attempt -like '*bbbb*') { Get-DeploymentSourceFixtureRoot -PipelineRoot $pipelineRoot -AttemptId ('b' * 32) -RetrySourceTests } else { Join-Path $logs 'source-fixtures' }
        $script:environmentPatch = @{AZRAEL_ENV_IDENTITY_REGRESSION_VALUE='real-one'}
        foreach ($key in $fixtureNames.Keys) { $script:environmentPatch[$key] = Join-Path $script:sourceFixtureRoot $fixtureNames[$key] }
        $stage = Get-StageInputs $executable @('--log-directory', (Join-Path $logs 'stage'))
        $stage.fixtureInput = ConvertTo-StageInput @{deploymentFixtureIdentity=@{pipelineRoot=$pipelineRoot;sourceFixtureRoot=$script:sourceFixtureRoot};instructionRoot=(Join-Path $script:sourceFixtureRoot 'instructions')}
        Assert-True ($stage.fixtureInput.deploymentFixtureIdentity.sourceFixtureRoot -ceq '<attempt-source-fixtures>') 'physical fixture root entered stage input identity'
        Assert-True ($stage.fixtureInput.instructionRoot -ceq (Join-Path '<attempt-source-fixtures>' 'instructions')) 'fixture child path lost its logical identity'
        $sibling = $script:sourceFixtureRoot + '-unowned'
        Assert-True ((ConvertTo-StageInput $sibling) -cne '<attempt-source-fixtures>-unowned') 'unowned sibling was normalized as fixture contents'
        $embedded = 'literal-prefix:' + $script:sourceFixtureRoot
        Assert-True ((ConvertTo-StageInput $embedded) -ceq $embedded) 'embedded path text was rewritten'
        $ambientEnvironment = @{}
        foreach ($entry in [Environment]::GetEnvironmentVariables().GetEnumerator()) { $ambientEnvironment[$entry.Key] = [string]$entry.Value }
        foreach ($entry in $script:environmentPatch.GetEnumerator()) { $ambientEnvironment[$entry.Key] = $entry.Value }
        $buildPipelineContext = @{sourceFixtureRoot=$script:sourceFixtureRoot}
        $engineInputs = @{}
        . ([scriptblock]::Create($buildEnvironmentAssignment.Extent.Text))
        . ([scriptblock]::Create($buildHashAssignment.Extent.Text))
        Assert-True ($engineInputs.environmentSha256 -ceq $stage.environmentSha256) 'deployment and engine build environment identities differ'
        $logicalEnvironment = Get-LogicalBuildEnvironment -Environment $ambientEnvironment -PipelineRoot $pipelineRoot -SourceFixtureRoot $script:sourceFixtureRoot
        $request = @{environment=$ambientEnvironment;ownership=@{pipelineRoot=$pipelineRoot;sourceFixtureRoot=$script:sourceFixtureRoot};projectRoot=$projectRoot} | ConvertTo-Json -Compress -Depth 5
        $nodeCode = 'const fs=require("node:fs"),r=JSON.parse(fs.readFileSync(0,"utf8"));process.stdout.write(JSON.stringify(require(process.argv[1]).logicalBuildEnvironment(r.environment,r.ownership,r.projectRoot)))'
        $jsEnvironment = $request | & node -e $nodeCode (Join-Path (Split-Path $DeployPath -Parent) 'verification-reuse-policy.cjs')
        Assert-True ($LASTEXITCODE -eq 0) 'shared preservation fixture identity failed'
        $jsEnvironment = $jsEnvironment | ConvertFrom-Json -AsHashtable
        foreach ($key in $logicalEnvironment.Keys) { Assert-True ($logicalEnvironment[$key] -ceq $jsEnvironment[$key]) 'PowerShell and preservation logical environment contracts differ' }
        Assert-True ($script:environmentPatch.AZRAEL_CATALOG_TEST_ROOT -ceq (Join-Path $script:sourceFixtureRoot 'catalog')) 'logical identity changed actual execution paths'
        $observed += $stage
    }
    Assert-True (@($observed.environmentSha256 | Select-Object -Unique).Count -eq 1) 'attempt-owned fixture paths changed review identity'
    Assert-True (@($observed | ForEach-Object { $_.fixtureInput | ConvertTo-Json -Compress -Depth 5 } | Select-Object -Unique).Count -eq 1) 'initial, legacy and short retry fixture stage inputs differ'
    Assert-True ($script:sourceFixtureRoot -ceq (Join-Path $pipelineRoot ('sf-' + ('b' * 12)))) 'retry source fixture lost its bounded short attempt identity'
    Assert-True ((Get-DeploymentSourceFixtureRoot -PipelineRoot $pipelineRoot -AttemptId ('c' * 32)) -ceq (Join-Path $pipelineRoot 'source-fixtures')) 'initial source fixture changed'
    Assert-True ((Get-DeploymentSourceFixtureRoot -PipelineRoot $pipelineRoot -AttemptId ('c' * 32) -RetrySourceTests) -cne $script:sourceFixtureRoot) 'distinct retry attempts shared a fixture root'
    $invalidAttemptRejected = $false
    try { Get-DeploymentSourceFixtureRoot -PipelineRoot $pipelineRoot -AttemptId '../outside' -RetrySourceTests | Out-Null } catch { $invalidAttemptRejected = $true }
    Assert-True $invalidAttemptRejected 'invalid attempt identity entered the fixture path'
    Assert-True (($observed[0].arguments -join '|') -ceq ($observed[2].arguments -join '|')) 'attempt log arguments changed logical identity'
    $script:environmentPatch.AZRAEL_ENV_IDENTITY_REGRESSION_VALUE = 'real-two'
    Assert-True ((Get-StageInputs $executable @()).environmentSha256 -cne $observed[0].environmentSha256) 'genuine environment change was hidden'
    $script:environmentPatch.AZRAEL_ENV_IDENTITY_REGRESSION_VALUE = 'real-one'
    $script:environmentPatch.AZRAEL_CATALOG_TEST_ROOT = Join-Path $pipelineRoot 'different-fixtures/catalog'
    Assert-True ((Get-StageInputs $executable @()).environmentSha256 -cne $observed[0].environmentSha256) 'different fixture destination was hidden'
    $rejected = $false
    try { Get-LogicalBuildEnvironment -Environment $ambientEnvironment -PipelineRoot $pipelineRoot -SourceFixtureRoot (Join-Path $pipelineRoot '../outside/source-fixtures') | Out-Null } catch { $rejected = $true }
    Assert-True $rejected 'unowned fixture metadata was accepted'
    return @{attempts=3;sharedBuildIdentity=$true;genuineEnvironmentChange=$true;changedFixtureDestination=$true;unownedMetadataRejected=$true}
}

function Test-ReleasePackagingParent {
    param([string]$Root, [string]$BuildPath)
    $text = Get-Content -LiteralPath $BuildPath -Raw
    $start = $text.IndexOf('$releaseParent = Split-Path $release -Parent')
    $end = $text.IndexOf('Move-Item -LiteralPath $packageStaging -Destination $release', $start)
    $publish = [scriptblock]::Create($text.Substring($start, $end - $start + 'Move-Item -LiteralPath $packageStaging -Destination $release'.Length))
    $packageStaging = Join-Path $Root 'staging'
    $release = Join-Path $Root 'absent/releases/chosen'
    New-Item -ItemType Directory -Path $packageStaging | Out-Null
    [IO.File]::WriteAllText((Join-Path $packageStaging 'package.txt'), 'verified package')
    & $publish
    Assert-True (([IO.File]::ReadAllText((Join-Path $release 'package.txt'))) -ceq 'verified package') 'package was not published under a previously absent release parent'
    Assert-True (-not (Test-Path -LiteralPath $packageStaging)) 'package staging was not moved'
    return @{createdReleaseParent=$true;publishedPackage=$true}
}

function Test-RuntimeStagingResume {
    param([string]$Root, [string]$BuildPath)
    $Root = [IO.Path]::GetFullPath($Root)
    if (Test-Path -LiteralPath $Root) { throw 'Runtime resume fixture requires a new owned root.' }
    New-Item -ItemType Directory -Path $Root | Out-Null
    try {
        $scripts = Split-Path $BuildPath -Parent
        $ast = [Management.Automation.Language.Parser]::ParseFile($BuildPath, [ref]$null, [ref]$null)
        foreach ($name in @('Get-BuildRuntimeSourceIdentity', 'Get-BuildRuntimeOutputs', 'Invoke-BuildRuntimeStaging')) {
            $definition = $ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name}, $true)
            . ([scriptblock]::Create($definition.Extent.Text.Replace('$PSScriptRoot', ("'" + $scripts.Replace("'", "''") + "'"))))
        }
        $pipelineFile = Join-Path $Root 'pipeline.json'
        $buildPipelineContext = @{identity=@{sourceSnapshot='frozen-runtime-fixture'}}
        $buildMetrics = [pscustomobject]@{Stages=[Collections.Generic.List[object]]::new()}
        function Invoke-BuildCommand {
            param($Executable, [string[]]$CommandArguments, [string]$LogName, [switch]$CaptureOutput)
            $errorPath = Join-Path $Root "$LogName.stderr"
            $output = @(& $Executable @CommandArguments 2> $errorPath)
            $exit = $LASTEXITCODE
            $buildMetrics.Stages.Add([pscustomobject]@{Status=$(if ($exit -eq 0) {'completed'} else {'failed'});ExitCode=$exit})
            if ($exit -ne 0) { throw ([IO.File]::ReadAllText($errorPath)) }
            if ($CaptureOutput) { return ($output -join "`n") }
        }
        function Invoke-BuildCheckpoint([string]$Action, [string]$Name, $Options=@{}) {
            $request = Join-Path $Root 'request.json'
            @{file=$pipelineFile;identity=$buildPipelineContext.identity;resume=[bool](Test-Path -LiteralPath $pipelineFile);lockHeld=$true;action=$Action;name=$Name;options=$Options} | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $request -Encoding utf8NoBOM
            $errorPath = Join-Path $Root 'checkpoint.stderr'
            $output = & node (Join-Path $scripts 'pipeline-state.cjs') $request 2> $errorPath
            if ($LASTEXITCODE -ne 0) { throw ([IO.File]::ReadAllText($errorPath)) }
            return ($output | ConvertFrom-Json)
        }
        $null = Invoke-BuildCheckpoint 'start' 'build.package'
        $null = Invoke-BuildCheckpoint 'finish' 'build.package' @{exitCode=0}
        $source = Join-Path $Root 'source'
        New-Item -ItemType Directory -Path $source | Out-Null
        foreach ($name in @('node.exe', 'node_repl.exe')) { [IO.File]::WriteAllText((Join-Path $source $name), $name) }
        $helper = Join-Path $scripts 'computer-use-runtime.cjs'
        $destination = Join-Path $Root 'runtime'
        $calls = [pscustomobject]@{count=0}
        $stage = { $calls.count++; Invoke-BuildCommand 'node' @($helper, 'stage', '--runtime-directory', $source, '--destination', $destination) 'stage.log' }
        foreach ($iteration in 1..2) { Invoke-BuildRuntimeStaging 'build.computer-use-runtime' $helper $destination @{runtime=$source} $stage }
        Assert-True ($calls.count -eq 1) 'resume restaged an already published runtime'
        $snapshot = Invoke-BuildCheckpoint 'snapshot' ''
        Assert-True ($snapshot.stages.'build.computer-use-runtime'[0].outputs.Count -eq 3) 'runtime checkpoint omitted manifest or payload hashes'
        $sourceFile = Join-Path $source 'node.exe'
        [IO.File]::WriteAllText($sourceFile, 'changed source')
        $rejected = $false
        try { Invoke-BuildRuntimeStaging 'build.computer-use-runtime' $helper $destination @{runtime=$source} $stage } catch { $rejected = $_.Exception.Message -like '*model decision*' }
        Assert-True $rejected 'changed runtime source reused prior output silently'
        [IO.File]::WriteAllText($sourceFile, 'node.exe')
        $published = Join-Path $destination 'node.exe'
        [IO.File]::WriteAllText($published, 'corrupt output')
        $rejected = $false
        try { Invoke-BuildRuntimeStaging 'build.computer-use-runtime' $helper $destination @{runtime=$source} $stage } catch { $rejected = $_.Exception.Message -like '*hash mismatch*' }
        Assert-True $rejected 'corrupt runtime payload passed resume'
        [IO.File]::WriteAllText($published, 'node.exe')
        $extra = Join-Path $destination 'extra.txt'
        [IO.File]::WriteAllText($extra, 'unrecorded')
        $rejected = $false
        try { Invoke-BuildRuntimeStaging 'build.computer-use-runtime' $helper $destination @{runtime=$source} $stage } catch { $rejected = $_.Exception.Message -like '*Unrecorded*' }
        Assert-True $rejected 'unrecorded runtime output passed resume'
        Remove-Item -LiteralPath $extra
        $rejected = $false
        try { Invoke-BuildRuntimeStaging 'build.window-control-runtime' $helper $destination @{runtime=$source} $stage } catch { $rejected = $_.Exception.Message -like '*lacks a successful matching staging checkpoint*' }
        Assert-True ($rejected -and $calls.count -eq 1) 'existing runtime without its own checkpoint was adopted or overwritten'
        $failedDestination = Join-Path $Root 'partial'
        $rejected = $false
        try { Invoke-BuildRuntimeStaging 'build.partial-runtime' $helper $failedDestination @{runtime=$source} { New-Item -ItemType Directory -Path $failedDestination | Out-Null; throw 'fixture synchronous failure' } } catch { $rejected = $_.Exception.Message -ceq 'fixture synchronous failure' }
        $snapshot = Invoke-BuildCheckpoint 'snapshot' ''
        Assert-True ($rejected -and $snapshot.stages.'build.partial-runtime'[0].status -ceq 'failed' -and $null -eq $snapshot.stages.'build.partial-runtime'[0].exitCode) 'synchronous failure invented an exit code or reusable success'
        return @{stagingCalls=$calls.count;resumeReused=$true;allOutputsBound=$true;sourceChangeReviewed=$true;corruptAndExtraOutputsRejected=$true;uncheckpointedOutputRejected=$true;partialFailurePreserved=$true}
    } finally {
        # This exact new fixture contains only synchronous test-owned writers.
        Remove-Item -LiteralPath $Root -Recurse
        Assert-True (-not (Test-Path -LiteralPath $Root)) 'runtime resume fixture cleanup incomplete'
    }
}

function Invoke-Case([string]$Name, [string]$Mode, [bool]$VerifyOnly = $false, [string]$Stage = '', [bool]$FullBuild = $false, [string]$TargetKind = '', [bool]$SkipSnapshot = $false, [bool]$FullRegression = $false, [bool]$ModuleCache = $false, [bool]$ForceNative = $false, [bool]$SharedModuleOwner = $false, [bool]$Exhaustive = $false, [string]$PolicyChangedPath = '', [bool]$ReuseSourcePreflight = $false) {
    if ($Case -and $Name -notin $Case) { return }
    if ($ChangedOnly -and -not $Case -and $Name -notin $changedCases) { return }
    if($Exhaustive){$FullRegression=$true}
    $root = Join-Path $fixtures $Name
    $scripts = Join-Path $root 'scripts'
    $a = Join-Path $root 'artifacts'
    New-Item -ItemType Directory -Path $scripts, $a | Out-Null
    if ($Mode -eq 'stage-environment-identity') {
        $details = Test-StageEnvironmentIdentity (Join-Path $PSScriptRoot 'deploy-azrael.ps1') (Join-Path $PSScriptRoot 'build-azrael.ps1') (Join-Path $PSScriptRoot 'build-metrics.ps1')
        $results.Add([pscustomobject]@{case=$Name;exitCode=0;passed=$true;metrics=$null;details=$details});return
    }
    if ($Mode -eq 'release-packaging-parent') {
        $details = Test-ReleasePackagingParent (Join-Path $root 'publish') (Join-Path $PSScriptRoot 'build-azrael.ps1')
        $results.Add([pscustomobject]@{case=$Name;exitCode=0;passed=$true;metrics=$null;details=$details});return
    }
    if ($Mode -eq 'runtime-staging-resume') {
        $details = Test-RuntimeStagingResume (Join-Path $root 'resume') (Join-Path $PSScriptRoot 'build-azrael.ps1')
        $results.Add([pscustomobject]@{case=$Name;exitCode=0;passed=$true;metrics=$null;details=$details});return
    }
    if ($Mode -eq 'host-copy-baseline') {
        $details = Test-HostCopyBaseline (Join-Path $root 'copy-baseline') (Join-Path $PSScriptRoot 'check-independent-vscode.ps1')
        $results.Add([pscustomobject]@{case=$Name;exitCode=0;passed=$true;metrics=$null;details=$details});return
    }
    if ($Mode -eq 'vsix-entry-index') {
        $details = Test-VsixEntryIndex (Join-Path $root 'vsix-index') (Join-Path $PSScriptRoot 'prepare-independent-vscode.ps1')
        $results.Add([pscustomobject]@{case=$Name;exitCode=0;passed=$true;metrics=$null;details=$details});return
    }
    if ($Mode -eq 'deployment-capacity') {
        $deployText = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'deploy-azrael.ps1') -Raw
        $ast = [Management.Automation.Language.Parser]::ParseInput($deployText, [ref]$null, [ref]$null)
        # Load actual functions and exercise behavior without running a deployment.
        & {
            foreach ($functionName in @('Assert-DeploymentCapacity', 'Start-OwnedCommand', 'Wait-OwnedCommands')) {
                $definition = $ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $functionName}, $true)
                # Extracted blocks have no script file; retain the real helper root.
                $quotedScripts = "'" + $PSScriptRoot.Replace("'", "''") + "'"
                . ([scriptblock]::Create($definition.Extent.Text.Replace('$PSScriptRoot', $quotedScripts)))
            }
            $RequiredFreeBytes = 0L
            $project = 'invalid-project-volume'
            Assert-DeploymentCapacity
            $project = $root
            $RequiredFreeBytes = 1L
            Assert-DeploymentCapacity
            $RequiredFreeBytes = [long]::MaxValue
            $rejected = $false
            try { Start-OwnedCommand 'capacity-blocked' 'must-not-launch' @() | Out-Null }
            catch { $rejected = $_.Exception.Message -like 'Deployment capacity guard:*available bytes*RequiredFreeBytes*' }
            Assert-True $rejected 'insufficient physical volume capacity did not block stage launch'

            $probe = [pscustomobject]@{ waiting = $false; rejected = $false; sleeps = 0 }
            $child = [pscustomobject]@{ Completed = $false; Process = [pscustomobject]@{ HasExited = $false } }
            function Assert-DeploymentCapacity {
                if ($probe.waiting) { $probe.rejected = $true; throw 'fixture capacity dropped while waiting' }
            }
            function Start-Sleep {
                param([int]$Milliseconds)
                [Threading.Thread]::Sleep($Milliseconds)
                $probe.waiting = $true
                $probe.sleeps++
                # Bound regressions so this test fails instead of hanging.
                if ($probe.sleeps -ge 40) { $child.Completed = $true }
            }
            $rejected = $false
            try { Wait-OwnedCommands @($child) }
            catch { $rejected = $_.Exception.Message -ceq 'fixture capacity dropped while waiting' }
            Assert-True ($rejected -and $probe.rejected -and -not $child.Completed) 'capacity loss during an active wait did not abort promptly'

            $RequiredFreeBytes = 0L
            $probe.rejected = $false
            $probe.sleeps = 39
            Wait-OwnedCommands @($child)
            Assert-True (-not $probe.rejected -and $child.Completed) 'disabled capacity guard changed waiting behavior'
        }
        $results.Add([pscustomobject]@{case=$Name;exitCode=0;passed=$true;metrics=$null});return
    }
    if ($Mode -eq 'account-socket-path') {
        $deployText = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'deploy-azrael.ps1') -Raw
        $socketStart = $deployText.IndexOf('        $socketPath = Join-Path $accountControlsState')
        $socketEnd = $deployText.IndexOf('        $reportPath =', $socketStart)
        $socketSelector = [scriptblock]::Create($deployText.Substring($socketStart, $socketEnd - $socketStart))
        $savedTemp = $env:TEMP; $savedTmp = $env:TMP
        try {
            # Computation only: match the 71-byte workspace TEMP independently of checkout depth.
            $tempVolume = [IO.Path]::GetPathRoot($project)
            $workspaceTemp = Join-Path $tempVolume ('t' * (71 - [Text.Encoding]::UTF8.GetByteCount($tempVolume)))
            Assert-True ([Text.Encoding]::UTF8.GetByteCount($workspaceTemp) -eq 71) 'socket regression TEMP byte budget changed'
            $env:TEMP = $workspaceTemp; $env:TMP = $workspaceTemp
            $accountControlsState = Join-Path $root ('account-state-' + ('s' * 100))
            Assert-True ([Text.Encoding]::UTF8.GetByteCount((Join-Path $accountControlsState 'socket/a.sock')) -gt 100) 'socket regression did not require fallback'
            Assert-True ([Text.Encoding]::UTF8.GetByteCount((Join-Path $workspaceTemp ('ac-' + ('0' * 32) + '/a.sock'))) -gt 100) 'workspace TEMP regression would accept the old fallback'
            . $socketSelector
            $firstSocket = $socketPath
            . $socketSelector
            $secondSocket = $socketPath
            foreach ($selectedSocket in @($firstSocket, $secondSocket)) {
                Assert-True ([Text.Encoding]::UTF8.GetByteCount($selectedSocket) -le 100) 'workspace TEMP fallback exceeds socket byte limit'
                Assert-True ((Split-Path (Split-Path $selectedSocket -Parent) -Parent) -eq $workspaceTemp) 'socket fallback escaped workspace TEMP'
                Assert-True (-not (Test-Path -LiteralPath (Split-Path $selectedSocket -Parent))) 'socket fallback parent is not fresh'
                Assert-True ((Split-Path $selectedSocket -Parent) -ne (Join-Path $accountControlsState 'socket')) 'socket fallback reused account state parent'
            }
            Assert-True ((Split-Path $firstSocket -Parent) -ne (Split-Path $secondSocket -Parent)) 'socket fallback parents are not distinct'
            $freshnessRejected = $false
            try { & { function Test-Path { param([string]$LiteralPath) return $true }; . $socketSelector } }
            catch { $freshnessRejected = $_.Exception.Message -eq 'Account controls socket directory already exists.' }
            Assert-True $freshnessRejected 'socket fallback accepted an existing parent'
            $env:TEMP = Join-Path $workspaceTemp ('t' * 40); $env:TMP = $env:TEMP
            $lengthRejected = $false
            try { . $socketSelector } catch { $lengthRejected = $_.Exception.Message -eq 'Account controls socket path exceeds the Windows AF_UNIX limit.' }
            Assert-True $lengthRejected 'socket fallback accepted a truly too-long TEMP'
            $results.Add([pscustomobject]@{case=$Name;exitCode=0;passed=$true;metrics=@{workspaceTemp=$workspaceTemp;fallbackBytes=[Text.Encoding]::UTF8.GetByteCount($firstSocket);distinctFreshParents=$true;tooLongTempRejected=$true;existingParentRejected=$true}})
        } finally { $env:TEMP = $savedTemp; $env:TMP = $savedTmp }
        return
    }
    if($Mode -eq 'fixture-path-selection'){
        $deployText = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'deploy-azrael.ps1') -Raw
        $start = $deployText.IndexOf('$fixture = Join-Path $project')
        $end = $deployText.IndexOf('$accountControlsState =', $start)
        Assert-True ($start -ge 0 -and $end -gt $start) 'fixture path selection boundary missing'
        $select = [scriptblock]::Create($deployText.Substring($start, $end - $start))
        $savedProject = $project
        try {
            $project = $root; $run = 'deploy-chosen'; $Resume = $false; $attemptId = '0123456789abcdef0123456789abcdef'
            foreach ($candidate in @('', (Join-Path $a 'v'), (Join-Path $a 'v-other'))) {
                $VerificationFixtureRoot = $candidate
                . $select
                $expected = if ($candidate) {$candidate} else {Join-Path $a 'verification/deploy-chosen'}
                Assert-True ($fixture -ceq $expected) 'fixture selection changed the exact path'
                $expectedState = Join-Path $expected $(if ($candidate) { 's' } else { 'state' })
                Assert-True ($fixtureStateRoot -ceq $expectedState) 'fixture state selection changed its explicit/default route'
            }
            $Resume = $true; $VerificationFixtureRoot = Join-Path $a 'v'
            . $select
            Assert-True ($fixture -ceq $VerificationFixtureRoot) 'resume lengthened the explicit short fixture'
            New-Item -ItemType Directory -Path $fixture | Out-Null
            try {
                $rejected = $false
                try { . $select } catch { $rejected = $_.Exception.Message -like 'Resume requires a fresh explicit*' }
                Assert-True $rejected 'resume accepted an existing explicit fixture'
            } finally { Remove-Item -LiteralPath $VerificationFixtureRoot }
            $VerificationFixtureRoot = ''
            . $select
            Assert-True ($fixture -ceq (Join-Path $a 'verification/deploy-chosen-01234567')) 'default resume fixture lost attempt isolation'
            $Resume = $false
            . (Join-Path $PSScriptRoot 'verification-state.ps1')
            if ($IsWindows) {
                $volume = [IO.Path]::GetPathRoot($savedProject)
                $project = Join-Path $volume ('p' * (61 - [Text.Encoding]::UTF8.GetByteCount($volume)))
                $VerificationFixtureRoot = Join-Path $project 'artifacts/v'
                . $select
                $oldState = Join-Path $fixture 'state'
                Assert-True ([Text.Encoding]::UTF8.GetByteCount($oldState) -eq 79) 'representative old state root must be 79 bytes'
                $oldRejected = $false
                try { Assert-AzraelVerificationStatePath -StateRoot $oldState }
                catch { $oldRejected = $_.Exception.Message -match '109 UTF-8 bytes; maximum is 107' }
                Assert-True $oldRejected 'real Windows state guard accepted the former long child'
                Assert-AzraelVerificationStatePath -StateRoot $fixtureStateRoot
                Assert-True ([Text.Encoding]::UTF8.GetByteCount((Join-Path $fixtureStateRoot 'ipc/aaaaaaaaaaaaaaaaaaaa.sock')) -eq 105) 'short child socket byte budget changed'
                Assert-True (-not (Test-Path $fixture)) 'state guard computation created the representative fixture'
                $project = $root
            }
            $guard = $deployText.IndexOf('Assert-AzraelVerificationStatePath -StateRoot $fixtureStateRoot')
            Assert-True ($guard -ge 0 -and $guard -lt $deployText.IndexOf('$null = Register-ArtifactLifecycle') -and $guard -lt $deployText.IndexOf('New-Item -ItemType Directory')) 'fixture state guard must precede producer registration and directory creation'
            Assert-True ($deployText.Contains("'-StateRoot', `$fixtureStateRoot")) 'acceptance must receive the same centrally selected state root'
            foreach ($candidate in @('relative/v', $a, (Join-Path $root 'engine'), (Join-Path $a 'maintenance'), (Join-Path $a 'build/v'), (Join-Path $a 'v/../maintenance'))) {
                $VerificationFixtureRoot = $candidate; $rejected = $false
                try { . $select } catch { $rejected = $true }
                Assert-True $rejected "unsafe verification fixture accepted: $candidate"
            }
        } finally { $project = $savedProject }
        $results.Add([pscustomobject]@{case=$Name;exitCode=0;passed=$true;metrics=$null});return
    }
    if($Mode -eq 'registered-owner-selection'){
        $deployText=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'deploy-azrael.ps1') -Raw
        $ast=[Management.Automation.Language.Parser]::ParseInput($deployText,[ref]$null,[ref]$null)
        $selector=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Get-FocusedEngineFeatureIds'},$true)
        . ([scriptblock]::Create($selector.Extent.Text))
        @{features=@(
            @{id='engine.oauth';area='engine';owners=@('engine/codex-rs/oauth/src/store_tests.rs')},
            @{id='engine.other';area='engine';owners=@('engine/codex-rs/other/src/lib.rs')},
            @{id='ui.fixture';area='ui';owners=@('engine/codex-rs/unowned.rs')}
        )} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $scripts 'azrael-feature-contracts.json') -Encoding utf8NoBOM
        $savedProject=$project
        try{
            $project=$root;$engine=Join-Path $root 'engine'
            $selected=@(Get-FocusedEngineFeatureIds -PolicyPaths @('engine/codex-rs/oauth/src/store_tests.rs') -EngineSourceRoot $engine)
            Assert-True ('engine.oauth' -cin $selected -and 'engine.other' -cnotin $selected) 'changed registered Rust test owner not selected precisely'
            $docs=@(Get-FocusedEngineFeatureIds -PolicyPaths @('docs/README.md') -EngineSourceRoot $engine)
            Assert-True ($docs.Count -eq 0) 'documentation-only input expanded engine selection'
            foreach($changed in @('engine/codex-rs/unowned.rs','scripts/cargo-verification.cjs')){
                $rejected = $false
                try { Get-FocusedEngineFeatureIds -PolicyPaths @($changed) -EngineSourceRoot $engine | Out-Null }
                catch { $rejected = $_.Exception.Message -match 'Unmapped engine verification scope.*EngineFeatureId' }
                Assert-True $rejected 'unmapped native scope did not require an explicit bundle choice'
                $script:profileUnmappedNativePaths = @()
                $profileSources = @(Get-FocusedEngineFeatureIds -PolicyPaths @($changed, 'engine/codex-rs/oauth/src/store_tests.rs') -EngineSourceRoot $engine -ProfileSelection)
                Assert-True (($profileSources -join '|') -ceq 'engine.oauth') 'profile changed mapped source selection'
                Assert-True (($script:profileUnmappedNativePaths -join '|') -ceq $changed) 'profile lost explicit unmapped native exclusion evidence'
                $explicit = @(Get-FocusedEngineFeatureIds -PolicyPaths @($changed) -EngineSourceRoot $engine -EngineFeatureId @('engine.other') -ExplicitSelection)
                Assert-True (($explicit -join '|') -ceq 'engine.other') 'explicit engine bundle selection lost'
                $empty = @(Get-FocusedEngineFeatureIds -PolicyPaths @($changed) -EngineSourceRoot $engine -EngineFeatureId @() -ExplicitSelection)
                Assert-True ($empty.Count -eq 0) 'explicit empty engine bundle selection lost'
            }
        }finally{$project=$savedProject}
        $results.Add([pscustomobject]@{case=$Name;exitCode=0;passed=$true;metrics=$null});return
    }
    if ($Mode -eq 'policy-selection') {
        $deployText = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'deploy-azrael.ps1') -Raw
        $ast = [Management.Automation.Language.Parser]::ParseInput($deployText, [ref]$null, [ref]$null)
        $selector = $ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Get-FocusedEngineFeatureIds'}, $true)
        . ([scriptblock]::Create($selector.Extent.Text))
        $savedProject = $project
        try {
            $project = $root
            $defaultEngine = Join-Path $root 'engine'
            Write-Utf8 (Join-Path $root 'tracked.txt') 'baseline'
            & git -C $root init --quiet
            Assert-True ($LASTEXITCODE -eq 0) 'policy fixture init failed'
            & git -C $root add -- tracked.txt
            & git -c user.name=Fixture -c user.email=fixture@example.invalid -C $root commit --quiet -m fixture
            Assert-True ($LASTEXITCODE -eq 0) 'policy fixture commit failed'
            Write-Utf8 (Join-Path $root 'tracked.txt') 'changed'
            Write-Utf8 (Join-Path $root 'spaces 한글.txt') 'untracked'
            $readerStart = $deployText.IndexOf('    $policyPaths = @($ChangedPath)')
            $readerEnd = $deployText.IndexOf('    $focusedEngineFeatureIds =', $readerStart)
            $reader = [scriptblock]::Create($deployText.Substring($readerStart, $readerEnd - $readerStart))
            $ChangedPath = @(); $ExhaustiveRegression = $false; $logs = $a
            . $reader
            Assert-True ((@($policyPaths | Sort-Object) -join '|') -ceq 'spaces 한글.txt|tracked.txt') 'git policy paths lost tracked or UTF8 untracked path'
            $argsStart = $deployText.IndexOf('    $sourceTestArgs = @(')
            $argsEnd = $deployText.IndexOf('    $retrySourceTests =', $argsStart)
            $argumentBuilder = [scriptblock]::Create('param([string]$PSScriptRoot)' + "`n" + $deployText.Substring($argsStart, $argsEnd - $argsStart))
            $SourceTestConcurrency = 4; $FullRegression = $false
            . $argumentBuilder (Join-Path $savedProject 'scripts')
            $forwardedPaths = @(for ($index = 0; $index -lt $sourceTestArgs.Count; $index++) {
                if ($sourceTestArgs[$index] -ceq '--changed') { $sourceTestArgs[$index + 1] }
            })
            $policy = Get-Content -LiteralPath $sourceTestPolicyPath -Raw | ConvertFrom-Json
            Assert-True (($forwardedPaths -join '|') -ceq ($policyPaths -join '|')) 'source argv changed the collected UTF8 policy paths'
            Assert-True ((@($policy.changedPaths) -join '|') -ceq ($forwardedPaths -join '|') -and $policy.exhaustive -eq $false) 'policy JSON and source argv disagree'
            $ChangedPath = @('docs\README.md'); $ExhaustiveRegression = $true
            . $reader
            Assert-True (($policyPaths -join '|') -ceq 'docs/README.md') 'explicit policy path normalization failed'
            $policy = Get-Content -LiteralPath $sourceTestPolicyPath -Raw | ConvertFrom-Json
            Assert-True ($policy.exhaustive -eq $true) 'exhaustive policy input lost'
            $FullRegression = $true
            . $argumentBuilder (Join-Path $savedProject 'scripts')
            Assert-True ('--exhaustive' -in $sourceTestArgs -and '--defer-preservation-cache-owner' -in $sourceTestArgs -and '--changed-only' -notin $sourceTestArgs) 'full exhaustive source argv policy lost'
            # Exercise the production serializer with a logical argv that cannot enter Process.Start directly.
            $largePaths = @(0..5501 | ForEach-Object { 'docs/' + $_ + '-' + ('x' * 65) + '.md' })
            $largePaths[0] = 'docs/spaces 한글 "quote" $() & ;.md'
            $largePaths[1] = 'scripts/test-session-links.cjs'
            $padding = 474736 - ($largePaths | Measure-Object -Property Length -Sum).Sum
            $largePaths[2] += 'x' * $padding
            $sourceTestArgs = @((Join-Path $savedProject 'scripts/test-project.cjs'), '--changed-only')
            foreach ($changed in $largePaths) { $sourceTestArgs += @('--changed', $changed) }
            $sourceTestArgs += '--list'
            $transportStart = $deployText.IndexOf("    `$sourceTestArgsPath = Join-Path")
            $transportEnd = $deployText.IndexOf("    `$build =", $transportStart)
            function Start-OwnedCommand { param($Name, $Executable, [string[]]$Arguments) [pscustomobject]@{Executable=$Executable;Arguments=$Arguments} }
            $metrics = [ordered]@{}
            . ([scriptblock]::Create($deployText.Substring($transportStart, $transportEnd - $transportStart)))
            Assert-True ($sourceTests.Arguments.Count -eq 5 -and $sourceTests.Arguments[1] -ceq '--args-file' -and $sourceTests.Arguments[3] -ceq '--args-sha256') 'large logical argv entered process command line'
            $retainedArgs = @(Get-Content -LiteralPath $metrics.sourceTestArguments.path -Raw | ConvertFrom-Json)
            Assert-True (($retainedArgs | ConvertTo-Json -Compress) -ceq (@($sourceTestArgs | Select-Object -Skip 1) | ConvertTo-Json -Compress)) 'retained logical argv changed'
            Assert-True ($metrics.sourceTestArguments.count -eq $retainedArgs.Count -and $metrics.sourceTestArguments.sha256 -ceq (Get-FileHash -LiteralPath $metrics.sourceTestArguments.path).Hash.ToLowerInvariant()) 'argv identity metric changed'
            $launch = [Diagnostics.ProcessStartInfo]::new($sourceTests.Executable)
            $launch.UseShellExecute=$false; $launch.CreateNoWindow=$true; $launch.RedirectStandardOutput=$true; $launch.RedirectStandardError=$true
            foreach ($argument in $sourceTests.Arguments) { $launch.ArgumentList.Add($argument) }
            $child = [Diagnostics.Process]::Start($launch)
            try {
                $out = $child.StandardOutput.ReadToEndAsync(); $err = $child.StandardError.ReadToEndAsync()
                $child.WaitForExit()
                Assert-True ($child.ExitCode -eq 0) "large args-file launch failed: $($err.GetAwaiter().GetResult())"
                $selected = $out.GetAwaiter().GetResult() | ConvertFrom-Json
                Assert-True (($selected.files -join '|') -ceq 'scripts/test-session-links.cjs' -and $selected.changed.Count -eq 5502) 'large argv selected different tests or lost changed paths'
                Assert-True ($selected.argumentIdentity.sha256 -ceq $metrics.sourceTestArguments.sha256) 'runner and deployment argv identity disagree'
            } finally { $child.Dispose() }
            $results.Add([pscustomobject]@{case=$Name;exitCode=0;passed=$true;metrics=$sourceTestPolicyPath})
        } finally { $project = $savedProject }
        return
    }
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'deploy-azrael.ps1') -Destination $scripts
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'committed-build-context.cjs') -Destination $scripts
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'build-metrics.ps1') -Destination $scripts
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'pipeline-state.cjs') -Destination $scripts
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'engine-source-handoff.cjs') -Destination $scripts
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'verification-reuse-policy.cjs') -Destination $scripts
    # This suite launches tiny contract fixtures, not product compilers. Actual
    # admission thresholds and waiting behavior have their direct owner check.
    Write-Utf8 (Join-Path $scripts 'build-resource-admission.cjs') "if(process.argv.length!==3) throw Error('admission stage label missing');"
    # This orchestration fixture starts no native socket. Real Windows UTF-8
    # limits belong to test-verification-state.ps1, not these deep mock roots.
    Write-Utf8 (Join-Path $scripts 'verification-state.ps1') @'
function Assert-AzraelVerificationStatePath {
    param([Parameter(Mandatory)][string]$StateRoot)
    if (-not [IO.Path]::IsPathFullyQualified($StateRoot)) { throw 'Expected absolute verification state.' }
    $StateRoot | Add-Content -LiteralPath (Join-Path $PSScriptRoot '../artifacts/verification-state-paths.txt')
}
'@
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'clean-verification-artifacts.ps1') -Destination $scripts
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'artifact-lifecycle.ps1') -Destination $scripts
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'artifact-lifecycle.cjs') -Destination $scripts
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'artifact-observations.cjs') -Destination $scripts
    $lockOwner = Join-Path $PSScriptRoot 'maintenance-lock-owner.cjs'
    if (Test-Path -LiteralPath $lockOwner) { Copy-Item -LiteralPath $lockOwner -Destination $scripts }
    foreach ($maintenanceCompanion in @('maintenance-lock-worker.cjs', 'maintenance-lock-client.cjs', 'maintenance-owner-config.cjs', 'maintenance-preferences.cjs')) {
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot $maintenanceCompanion) -Destination $scripts
    }
    # The copied lifecycle owner needs the real installed receipt and capability.
    # Keep its binary contained and short enough for Windows child launches.
    $maintenanceBootstrap = @'
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const [sourceRoot,destinationRoot]=process.argv.slice(1);
const config=require(path.join(sourceRoot,'scripts/maintenance-owner-config.cjs'));
const selected=config.resolveMaintenanceCommand(sourceRoot);
if(!selected.args.length&&!process.env.AZRAEL_MAINTENANCE_OWNER){
 const relative='artifacts/maintenance/owner-installation.json';
 const pin=JSON.parse(fs.readFileSync(path.join(sourceRoot,relative),'utf8'));
 const versionRoot=path.dirname(path.dirname(pin.executable));
 const executable=path.join(destinationRoot,'artifacts/m.exe');
 assert.ok(process.platform!=='win32'||executable.length<260,'Fixture executable must fit Windows launch paths');
 const copy=require(path.join(sourceRoot,'scripts/freeze-platform-inputs.cjs')).copyTree;
 assert.equal(fs.existsSync(executable),false,'Fresh fixture executable required');
 copy(path.join(sourceRoot,pin.executable),executable);
 for(const name of [relative,...['performance.json','native-acceptance.json'].map(n=>path.join(versionRoot,'verification',n)).filter(n=>fs.existsSync(path.join(sourceRoot,n)))]){
  assert.equal(fs.existsSync(path.join(destinationRoot,name)),false,'Fresh fixture metadata required');
  copy(path.join(sourceRoot,name),path.join(destinationRoot,name));
 }
 fs.writeFileSync(path.join(destinationRoot,relative),JSON.stringify({...pin,executable:'artifacts/m.exe'},null,2)+'\n');
}
const actual=config.resolveMaintenanceCommand(destinationRoot);
assert.deepEqual(actual.args,selected.args);
assert.equal(actual.maxLockWaitMs,selected.maxLockWaitMs,'Fixture must preserve installed queue capability');
'@
    & node -e $maintenanceBootstrap (Split-Path $PSScriptRoot -Parent) $root
    Assert-True ($LASTEXITCODE -eq 0) 'fixture maintenance bootstrap failed'
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'build-module-cache.ps1') -Destination $scripts
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'deployment-input-snapshot.cjs') -Destination $scripts
    Write-Utf8 (Join-Path $scripts 'test-project.cjs') $nodeStub
    # Model selection only: this orchestration fixture must never probe or run Cargo.
    Write-Utf8 (Join-Path $scripts 'cargo-shared-cache.cjs') @'
const fs=require('node:fs'),path=require('node:path');
const root=path.dirname(__dirname),a=path.join(root,'artifacts'),args=process.argv.slice(2);
if(args.length!==6 || args[0]!=='--project-root' || args[2]!=='--source-root' || args[4]!=='--target') throw Error('Unexpected shared Cargo selection arguments');
const [projectRoot,sourceRoot,target]=[args[1],args[3],args[5]];
if(projectRoot!==root || !path.isAbsolute(sourceRoot) || target!=='x86_64-pc-windows-msvc') throw Error('Shared Cargo selection lost its explicit owner/source/target');
const key='c'.repeat(64),directory=path.join(projectRoot,'artifacts/cache/cargo',key);
const selection={projectRoot,key,identity:{schema:1,platform:'win32',arch:'x64',target},directory,targetDirectory:path.join(directory,'target'),lifecycleId:`shared:cargo-target:${key}`};
fs.appendFileSync(path.join(a,'cargo-selection-invocation.jsonl'),JSON.stringify({projectRoot,sourceRoot,target,selection})+'\n');
// Keep the JSON protocol lossless through the fixture's native PowerShell pipe.
console.log(JSON.stringify(selection).replace(/[^\x00-\x7f]/g,value=>'\\u'+value.charCodeAt(0).toString(16).padStart(4,'0')));
'@
    Write-Utf8 (Join-Path $scripts 'feature-preservation.cjs') $preservationStub
    Write-Utf8 (Join-Path $scripts 'pipeline-preflight.cjs') @'
const fs=require('node:fs'),path=require('node:path');
const root=path.dirname(__dirname),a=path.join(root,'artifacts');
const s=JSON.parse(fs.readFileSync(path.join(a,'scenario.json')));
(async()=>{
 if(process.argv.includes('--environment')){
  if(s.mode==='environment-preflight-fail'){console.error('causal environment preflight failure');process.exitCode=61;return;}
  const config=JSON.parse(fs.readFileSync(process.argv.at(-1),'utf8'));
  fs.mkdirSync(config.temporaryDirectory,{recursive:true});
  if(s.retainTemporaryReference){
   const lifecycle=require('./artifact-lifecycle.cjs');
   const record=lifecycle.catalog(root).find(record=>record.owner==='azrael-deployment-temporary');
   lifecycle.recordLifecycle(root,{...record,references:[{id:'version:other-consumer',reason:'Other active deployment must retain protection',kind:'execution'}]});
  }
  if(!path.isAbsolute(s.shortTemporary) || !fs.statSync(s.shortTemporary).isDirectory()) throw Error('Owned short fixture temporary directory missing');
  console.log(JSON.stringify({environmentPatch:{TEMP:s.shortTemporary,TMP:s.shortTemporary,TMPDIR:s.shortTemporary},required:{python:false,cargo:false}}));return;
 }
 if(s.mode==='dependencies-fail'){console.error('causal dependency failure');process.exitCode=52;return;}
 console.log('{}');
})().catch(error=>{console.error(error);process.exitCode=9;});
'@
    @{features=@(@{id='engine.fixture';area='engine';owners=@('engine/codex-rs/core/src/session/mod.rs')})} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $scripts 'azrael-feature-contracts.json') -Encoding utf8NoBOM
    Write-Utf8 (Join-Path $scripts 'build-azrael.ps1') $buildStub
    Write-Utf8 (Join-Path $scripts 'check-accounts.mjs') $accountControlsStub
    Write-Utf8 (Join-Path $scripts 'prepare-independent-vscode.ps1') $prepareStub
    Write-Utf8 (Join-Path $scripts 'check-independent-vscode.ps1') $checkStub
    Write-Utf8 (Join-Path $scripts 'install-azrael.ps1') $installStub
    Write-Utf8 (Join-Path $root '.gitignore') "artifacts/`ncontrol/`n"
    Write-Utf8 (Join-Path $root 'input.txt') 'original'
    & git -c core.longpaths=true -C $root init --quiet
    Assert-True ($LASTEXITCODE -eq 0) 'fixture git init failed'
    & git -C $root config core.longpaths true
    Assert-True ($LASTEXITCODE -eq 0) 'fixture Git must retain long-path support for deployment child commands'
    & git -c core.longpaths=true -c core.autocrlf=false -C $root add -- .
    Assert-True ($LASTEXITCODE -eq 0) 'fixture git add failed'
    & git -c core.longpaths=true -c user.name=Fixture -c user.email=fixture@example.invalid -C $root commit --quiet -m fixture
    Assert-True ($LASTEXITCODE -eq 0) 'fixture HEAD commit failed'
    New-Item -ItemType Directory -Path (Join-Path $root 'control') | Out-Null
    $receiptScript = 'const fs=require("node:fs"),p=require("node:path"),cp=require("node:child_process"); const root=process.argv[1]; require(process.argv[2]).snapshotProject(root).then(s=>fs.writeFileSync(p.join(root,"control/committed-source.json"),JSON.stringify({schema:1,sourceCommit:cp.execFileSync("git",["-C",root,"rev-parse","HEAD"],{encoding:"utf8"}).trim(),projectSha256:s.sha256}))).catch(e=>{console.error(e);process.exitCode=1});'
    & node -e $receiptScript $root (Join-Path $scripts 'deployment-input-snapshot.cjs')
    Assert-True ($LASTEXITCODE -eq 0) 'fixture committed receipt failed'
    if($Mode -eq 'input-snapshot-fail'){
        Remove-Item -LiteralPath (Join-Path $root 'input.txt')
        New-Item -ItemType Directory -Path (Join-Path $root 'input.txt') | Out-Null
    }
    if($Mode -eq 'submodule-mutation'){
        $vendor=Join-Path $root 'modules/vendor'
        New-Item -ItemType Directory -Path $vendor | Out-Null
        & git -c core.longpaths=true -C $vendor init --quiet
        Write-Utf8 (Join-Path $vendor 'input.txt') 'original nested source'
        & git -c core.longpaths=true -c core.autocrlf=false -C $vendor add -- .
        & git -c core.longpaths=true -c user.name=Fixture -c user.email=fixture@example.invalid -C $vendor commit --quiet -m fixture
        Assert-True ($LASTEXITCODE -eq 0) 'nested fixture commit failed'
        $vendorHead=(& git -c core.longpaths=true -C $vendor rev-parse HEAD).Trim()
        & git -c core.longpaths=true -C $root update-index --add --cacheinfo "160000,$vendorHead,modules/vendor"
        Assert-True ($LASTEXITCODE -eq 0) 'fixture gitlink registration failed'
        & git -c user.name=Fixture -c user.email=fixture@example.invalid -C $root commit --quiet -m gitlink
        Assert-True ($LASTEXITCODE -eq 0) 'fixture gitlink commit failed'
        & node -e $receiptScript $root (Join-Path $scripts 'deployment-input-snapshot.cjs')
        Assert-True ($LASTEXITCODE -eq 0) 'fixture gitlink receipt failed'
    }
    @{sourceHandoffUnavailable=($Name -eq 'source handoff unavailable');mode=$Mode;stage=$Stage;uiFeatureIds=$uiFeatureIds;moduleCache=$ModuleCache;shortTemporary=$shortTemporary;overlap=($Name -eq 'parallel prepare');slowSource=($Name -eq 'parallel prepare' -or $Mode -eq 'account-success');retainTemporaryReference=($Name -eq 'full install');resumeFailure=($Name -eq 'resume after prepare failure')} | ConvertTo-Json | Set-Content (Join-Path $a 'scenario.json')
    # A newer-looking deployment/tool directory must never influence explicit selection.
    New-Item -ItemType Directory -Path (Join-Path $a 'latest'), (Join-Path $a 'build/zz-newest/companion/node_modules/typescript/lib') -Force | Out-Null
    Write-Utf8 (Join-Path $a 'latest/azrael-host.vsix') 'untested latest package'
    Write-Utf8 (Join-Path $a 'latest.json') '{"releaseDirectory":"latest"}'
    Write-Utf8 (Join-Path $a 'build/zz-newest/companion/node_modules/typescript/lib/typescript.js') 'wrong latest typescript'
    $info = [Diagnostics.ProcessStartInfo]::new($pwsh)
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    # The deployment process computes its account socket before launching the
    # mocked command, so it also inherits the registered short temporary owner.
    foreach($temporaryName in @('TEMP','TMP','TMPDIR')){$info.Environment[$temporaryName]=$shortTemporary}
    $argsList = @('-NoLogo','-NoProfile','-NonInteractive','-File',(Join-Path $scripts 'deploy-azrael.ps1'),'-ReleaseName','chosen','-SourceRoot',(Join-Path $root 'engine'),'-UiSourcePath',(Join-Path $a 'pristine UI'),'-OriginalExtensionPath',(Join-Path $a 'original Codex'),'-OriginalAudioPath',(Join-Path $a 'original audio'),'-StateRoot',(Join-Path $a 'install state'),'-SourceCodexHome',(Join-Path $a 'source codex'),'-WorkspacePath',(Join-Path $a 'workspace'),'-ExtensionsDir',(Join-Path $a 'profile extensions'),'-UserDataDir',(Join-Path $a 'user data'),'-CodePath','code fixture.cmd')
    if(-not $FullBuild){$argsList += @('-SkipEngineBuild','-EngineDirectory',(Join-Path $a 'explicit engine'))}
    else{$argsList += @('-CodeModeHostPath',(Join-Path $a 'code mode host.exe'),'-VirtualInputRuntimeDirectory',(Join-Path $a 'official virtual input runtime'),'-MultiPointerRuntimeDirectory',(Join-Path $a 'official multi pointer runtime'),'-ComputerUseRuntimeDirectory',(Join-Path $a 'official computer runtime'),'-ComputerUsePluginDirectory',(Join-Path $a 'official computer plugin'))}
    $target=if($TargetKind -eq 'relative'){'relative-cache'}else{Join-Path $a 'engine cache 한글'}
    if($TargetKind){$argsList += @('-EngineTargetDirectory',$target)}
    if($VerifyOnly){$argsList += '-VerifyOnly'}
    if($SkipSnapshot){$argsList += '-SkipCodexEnvironmentSnapshot'}
    if($Exhaustive){$argsList += '-ExhaustiveRegression'}elseif($FullRegression){$argsList += '-FullRegression'}
    if($PolicyChangedPath){$argsList += @('-ChangedPath',$PolicyChangedPath)}
    if($ForceNative){$argsList += '-ForceNativeVerification'}
    if($ReuseSourcePreflight){
        $priorReceipt=Join-Path $a 'prior-source-receipt.json'
        @{status='passed';checkPhase='source';sourceExecution=@{fixture=$true}} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $priorReceipt -Encoding utf8NoBOM
        $argsList += @('-SourcePreflightReceipt',$priorReceipt)
    }
    # The real shared cache owner must contain its registered execution project.
    $moduleOwner=if($SharedModuleOwner){$fixtures}else{''}
    $windowTarget=if($SharedModuleOwner){Join-Path $a 'shared window target 한글'}else{''}
    if($SharedModuleOwner){$argsList += @('-ModuleCacheProjectRoot',$moduleOwner,'-WindowControlTargetDirectory',$windowTarget,'-CargoVerificationCacheProjectRoot',$moduleOwner,'-NamespaceCacheProjectRoot',$moduleOwner)}
    if($Mode -like 'account-*' -or $Mode -eq 'source-fail-after-build'){$argsList += '-VerifyAccountControls'}
    if($Name -eq 'short fixture install'){$argsList += @('-VerificationFixtureRoot',(Join-Path $a 'v'))}
    foreach($arg in $argsList){$info.ArgumentList.Add($arg)}
    $proc=[Diagnostics.Process]::Start($info)
    $stdout=$proc.StandardOutput.ReadToEndAsync();$stderr=$proc.StandardError.ReadToEndAsync()
    try {
        # Account cases run two real lifecycle cleanup passes after their mocked
        # gates; retain a bounded outer watchdog without changing gate deadlines.
        $caseTimeoutMilliseconds=if($Mode -like 'account-*'){90000}else{45000}
        if(-not $proc.WaitForExit($caseTimeoutMilliseconds)){$proc.Kill($true);$proc.WaitForExit();throw "case timed out: $Name"}
        $exit=$proc.ExitCode
    } finally {
        Write-Utf8 (Join-Path $logs "$Name.stdout.log") $stdout.GetAwaiter().GetResult()
        Write-Utf8 (Join-Path $logs "$Name.stderr.log") $stderr.GetAwaiter().GetResult()
        $proc.Dispose()
    }
    $metricsPath=Join-Path $a 'logs/deploy-chosen/deployment-metrics.json'
    if($Name -eq 'resume after prepare failure'){
        Assert-True ($exit -ne 0) 'Controlled preparation failure unexpectedly passed'
        $statePath=Join-Path $a 'logs/deploy-chosen/pipeline-state.json'
        $first=Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
        Assert-True ($first.stages.build[-1].status -eq 'succeeded' -and $first.stages.'source-tests'[-1].status -eq 'succeeded' -and $first.stages.prepare[-1].exitCode -eq 29) 'Controlled failure did not preserve earlier terminal success'
        $stateHash=(Get-FileHash -LiteralPath $statePath).Hash
        $info.ArgumentList.Add('-Resume')
        $activeLease=[IO.File]::Open((Join-Path (Split-Path $statePath -Parent) 'pipeline.lock'),[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
        try {
            $contender=[Diagnostics.Process]::Start($info)
            $contenderOut=$contender.StandardOutput.ReadToEndAsync();$contenderErr=$contender.StandardError.ReadToEndAsync()
            try {
                if(-not $contender.WaitForExit(15000)){$contender.Kill($true);$contender.WaitForExit();throw 'Exclusive lease refusal timed out'}
                Assert-True ($contender.ExitCode -ne 0) 'Active deployment writer was not blocked'
            } finally {
                Write-Utf8 (Join-Path $logs 'lease.stdout.log') $contenderOut.GetAwaiter().GetResult()
                Write-Utf8 (Join-Path $logs 'lease.stderr.log') $contenderErr.GetAwaiter().GetResult()
                $contender.Dispose()
            }
            Assert-True ((Get-FileHash -LiteralPath $statePath).Hash -eq $stateHash) 'Blocked writer mutated durable pipeline state'
        } finally { $activeLease.Dispose() }
        $scenario=Get-Content (Join-Path $a 'scenario.json') -Raw|ConvertFrom-Json
        $scenario.mode='success'
        # The successful build is reused, so this attempt has no fresh observation handoff.
        $scenario.sourceHandoffUnavailable=$true
        $scenario|ConvertTo-Json|Set-Content (Join-Path $a 'scenario.json')
        $resumed=[Diagnostics.Process]::Start($info)
        $resumeOut=$resumed.StandardOutput.ReadToEndAsync();$resumeErr=$resumed.StandardError.ReadToEndAsync()
        try {
            # Includes native owner cleanup after all mocked product stages finish.
            if(-not $resumed.WaitForExit(120000)){$resumed.Kill($true);$resumed.WaitForExit();throw 'Resumed fixture timed out'}
            $resumeExit=$resumed.ExitCode
        } finally {
            Write-Utf8 (Join-Path $logs 'resume.stdout.log') $resumeOut.GetAwaiter().GetResult()
            Write-Utf8 (Join-Path $logs 'resume.stderr.log') $resumeErr.GetAwaiter().GetResult()
            $resumed.Dispose()
        }
        Assert-True ($resumeExit -eq 0) 'Resumed deployment did not complete; see resume.stderr.log'
        $last=Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
        Assert-True (@($last.stages.build).Count -eq 1 -and @($last.stages.'source-tests').Count -eq 1 -and @($last.stages.'engine-source-preflight').Count -eq 1) 'Resume reran successful source/preflight/build'
        Assert-True (@($last.stages.prepare).Count -eq 2 -and $last.stages.prepare[0].exitCode -eq 29 -and $last.stages.prepare[1].exitCode -eq 0) 'Resume lost the failed prepare exit or failed to rerun it'
        Assert-True ($last.stages.install[-1].exitCode -eq 0) 'Resume did not enter authoritative installer'
        $results.Add([pscustomobject]@{case=$Name;exitCode=$resumeExit;passed=$true;metrics=$statePath})
        return
    }
    if($Mode -eq 'invalid-target'){
        Assert-True ($exit -ne 0) "Invalid engine target unexpectedly accepted in $Name"
        foreach($marker in @('source-start.json','build-start.json','prepare-invocation.json','install-invocation.json')){
            Assert-True (-not (Test-Path (Join-Path $a $marker))) "Invalid target started work: $marker"
        }
        Assert-True ((Get-Content (Join-Path $logs "$Name.stderr.log") -Raw) -match 'EngineTargetDirectory|target directory') 'missing engine target rejection diagnostic'
        $results.Add([pscustomobject]@{case=$Name;exitCode=$exit;passed=$true;metrics=$metricsPath})
        return
    }
    $metrics=Get-Content -LiteralPath $metricsPath -Raw | ConvertFrom-Json
    if($Mode -eq 'environment-preflight-fail'){
        Assert-True ($exit -ne 0 -and $metrics.status -ceq 'failed') 'early prerequisite rejection did not abort deploy'
        foreach($marker in @('source-start.json','build-start.json','native-start.json','prepare-invocation.json','account-invocation.json','check-invocation.json','install-invocation.json')){
            Assert-True (-not (Test-Path -LiteralPath (Join-Path $a $marker))) "early prerequisite rejection started downstream: $marker"
        }
        Assert-True (@($metrics.stages | Where-Object { $_.name -eq 'environment-preflight' -and $_.exitCode -eq 61 }).Count -eq 1) 'actual environment preflight exit lost'
        $results.Add([pscustomobject]@{case=$Name;exitCode=$exit;passed=$true;metrics=$metricsPath});return
    }
    if($Mode -eq 'input-snapshot-fail'){
        Assert-True ($exit -ne 0 -and $metrics.status -ceq 'failed') 'snapshot failure did not abort deploy'
        Assert-True ($metrics.inputChecks.Count -eq 1 -and $metrics.inputChecks[0].phase -ceq 'initial' -and $metrics.inputChecks[0].exitCode -ne 0) 'helper nonzero exit was not propagated'
        foreach($marker in @('source-start.json','build-start.json','prepare-invocation.json','install-invocation.json')){
            Assert-True (-not (Test-Path (Join-Path $a $marker))) "Snapshot failure started work: $marker"
        }
        $results.Add([pscustomobject]@{case=$Name;exitCode=$exit;passed=$true;metrics=$metricsPath})
        return
    }
    if ($Mode -in @('engine-source-preflight-fail','dependencies-fail','source-fixtures-fail')) {
        Assert-True ($exit -ne 0 -and $metrics.status -ceq 'failed') 'preflight failure did not abort deploy'
        foreach($marker in @('source-start.json','build-start.json','prepare-invocation.json','install-invocation.json')) {
            Assert-True (-not (Test-Path (Join-Path $a $marker))) "Preflight failure started work: $marker"
        }
        $results.Add([pscustomobject]@{case=$Name;exitCode=$exit;passed=$true;metrics=$metricsPath})
        return
    }
    if($Mode -in @('account-engine-fail','account-prepare-fail','source-fail-after-build')){
      Assert-True ($exit -ne 0) 'account prerequisite failure accepted'
      $failedName=if($Mode -eq 'source-fail-after-build'){'source-tests'}elseif($Mode -eq 'account-engine-fail'){'engine-preservation'}else{'prepare'}
      $otherName=if($failedName -eq 'prepare'){'engine-preservation'}else{'prepare'}
      $failed=@($metrics.stages | Where-Object name -eq $failedName)[0]
      $other=@($metrics.stages | Where-Object name -eq $otherName)[0]
      Assert-True ($failed.exitCode -eq $(if($failedName -eq 'source-tests'){23}elseif($failedName -eq 'prepare'){29}else{41})) 'prerequisite actual exit lost'
      Assert-True $other.terminated 'other owned prerequisite was not canceled'
      Assert-True ($other.durationMs -lt 20000) 'cancellation waited for slow prerequisite'
      foreach($dependent in @($metrics.stages | Where-Object { $_.name -in @('source-tests','engine-preservation','prepare') -and $_.name -ne $failedName })) {
        Assert-True ($dependent.terminated -and $dependent.durationMs -lt 20000 -and $null -ne $dependent.exitCode) 'owned sibling was not canceled with actual exit'
      }
      foreach($marker in @('source-start.json','native-start.json','prepare-start.json')){ $owned=(Get-Content (Join-Path $a $marker) -Raw | ConvertFrom-Json).pid; Assert-True ($null -eq (Get-Process -Id $owned -ErrorAction SilentlyContinue)) 'owned prerequisite survived' }
      foreach($marker in @('account-invocation.json','check-invocation.json','install-invocation.json')){Assert-True (-not (Test-Path (Join-Path $a $marker))) "failure started downstream: $marker"}
      $results.Add([pscustomobject]@{case=$Name;exitCode=$exit;passed=$true;metrics=$metricsPath});return
    }
    $success=$Mode -in @('success','account-success')
    Assert-True (($exit -eq 0) -eq $success) "Unexpected exit code $exit in $Name; see $logs/$Name.stderr.log"
    $installed=Test-Path -LiteralPath (Join-Path $a 'install-invocation.json')
    Assert-True ($installed -eq ($success -and -not $VerifyOnly -or $Mode -like 'install-*')) "Wrong installation gate in $Name"
    # Semantic reconstruction of the six preservation guards; historical exact cases were unavailable.
    if($Mode -like '*preservation*'){
        Assert-True ($metrics.status -ceq 'failed') 'preservation rejection was not reported as failed'
        $calls=@(Get-Content (Join-Path $a 'preservation-invocation.jsonl') | ForEach-Object { $_ | ConvertFrom-Json })
        $stageNames=@($metrics.stages.name)
        $expectedStages='source-fixtures|environment-preflight|verification-dependencies|engine-source-preflight|source-tests|build|engine-preservation|prepare'
        $expectedActions='run|run'
        $markers=@('check-invocation.json','install-invocation.json')
        if($Mode -like 'package-preservation-*'){
            $expectedActions+='|verify'
            $markers=@('check-invocation.json','install-invocation.json')
            Assert-True ((Get-Content (Join-Path $a 'logs/deploy-chosen/package-preservation.log') -Raw) -match 'causal package preservation') 'package preservation causal diagnostic lost'
        }elseif($Mode -eq 'engine-preservation-recheck'){
            $expectedStages+='|acceptance|engine-preservation-recheck';$expectedActions+='|verify|verify|verify-receipt'
            $markers=@('install-invocation.json')
        }
        Assert-True (($stageNames -join '|') -ceq $expectedStages) "preservation stage ordering changed in $Name"
        Assert-True (($calls.action -join '|') -ceq $expectedActions) "preservation command ordering changed in $Name"
        foreach($marker in $markers){Assert-True (-not (Test-Path (Join-Path $a $marker))) "preservation rejection started downstream work: $marker"}
        if($Mode -in @('engine-preservation-fail','engine-preservation-recheck')){
            $failed=@($metrics.stages | Where-Object name -eq $(if($Mode -eq 'engine-preservation-fail'){'engine-preservation'}else{'engine-preservation-recheck'}))[0]
            Assert-True ($failed.exitCode -eq $(if($Mode -eq 'engine-preservation-fail'){41}else{47})) 'engine preservation actual exit code lost'
            Assert-True ((Get-Content $failed.stderr -Raw) -match 'causal engine preservation') 'engine preservation causal diagnostic lost'
        }elseif($Mode -eq 'engine-preservation-missing-receipt'){
            Assert-True (@($metrics.stages | Where-Object name -eq 'engine-preservation')[0].exitCode -eq 0) 'missing receipt should reject successful command output'
            Assert-True ((Get-Content (Join-Path $logs "$Name.stderr.log") -Raw) -match 'receiptPath') 'missing engine receipt diagnostic lost'
        }
    }
    if($Mode -like 'account-*'){
        $accountArgs=Get-Content (Join-Path $a 'account-invocation.json') -Raw | ConvertFrom-Json
        $engine=Join-Path $a 'releases/chosen/engine/azrael.exe'
        $bridge=Join-Path $a 'releases/chosen/engine/azrael-bridge.exe'
        $state=Join-Path $a 'verification/account-controls-chosen'
        Assert-True ($accountArgs.Count -eq 7 -and $accountArgs[0] -ceq $engine -and $accountArgs[1] -ceq $bridge -and $accountArgs[2] -ceq $state -and $accountArgs[4] -ceq '--account-controls-only' -and $accountArgs[5] -ceq '--models-catalog' -and $accountArgs[6] -ceq (Join-Path $a 'releases/chosen/scripts/devin-catalog.json')) 'account gate did not forward exact release paths/route/catalog'
        Assert-True ([IO.Path]::IsPathFullyQualified($accountArgs[3]) -and [Text.Encoding]::UTF8.GetByteCount($accountArgs[3]) -le 100) 'account socket path is not absolute/short'
        $expectedAccountReport = if ($success) { Join-Path $a 'logs/verification-evidence/account-controls-chosen/verification.json' } else { Join-Path $state 'verification.json' }
        Assert-True ($metrics.accountControls.verification -ceq $expectedAccountReport -and $metrics.accountControls.engine -ceq $engine -and $metrics.accountControls.bridge -ceq $bridge -and $metrics.accountControls.engineSha256 -ceq (Get-FileHash $engine).Hash -and $metrics.accountControls.bridgeSha256 -ceq (Get-FileHash $bridge).Hash) 'account report/binary identity metrics missing'
        if ($success) { Assert-True ((Test-Path -LiteralPath $expectedAccountReport) -and -not (Test-Path -LiteralPath $state)) 'successful account fixture/evidence cleanup failed' }
        $accountRecord=@($metrics.stages | Where-Object name -eq 'account-controls')[0]
        Assert-True ($accountRecord.exitCode -eq $(if($Mode -eq 'account-command-fail'){37}else{0})) 'account command actual exit code lost'
        Assert-True ($metrics.accountControls.status -ceq $(if($success){'passed'}else{'failed'})) 'account gate report status lost'
        if(-not $success){
            foreach($marker in @('check-invocation.json','install-invocation.json')){Assert-True (-not (Test-Path (Join-Path $a $marker))) "Account gate failure started downstream work: $marker"}
        }
    }else{Assert-True (@($metrics.stages | Where-Object name -eq 'account-controls').Count -eq 0) 'account gate ran without opt-in'}
    if($Mode -eq 'account-success'){
      $ns=Get-Content (Join-Path $a 'native-start.json') -Raw | ConvertFrom-Json
      $ne=Get-Content (Join-Path $a 'native-end.json') -Raw | ConvertFrom-Json
      $ps=Get-Content (Join-Path $a 'prepare-start.json') -Raw | ConvertFrom-Json
      $pe=Get-Content (Join-Path $a 'prepare-end.json') -Raw | ConvertFrom-Json
      Assert-True ($ns.time -lt $pe.time -and $ps.time -lt $ne.time) 'account preparation and engine checks did not overlap'
      $account=@($metrics.stages | Where-Object name -eq 'account-controls')[0]
      foreach($prerequisite in @('source-tests','engine-preservation','prepare')){ $record=@($metrics.stages | Where-Object name -eq $prerequisite)[0];Assert-True ($record.exitCode -eq 0 -and [DateTime]$record.completedUtc -le [DateTime]$account.startedUtc) 'account started before owned prerequisites completed' }
    }
    if($Name -eq 'parallel prepare' -or $Mode -eq 'account-success'){
      $sourceEnd=(Get-Content (Join-Path $a 'source-end.json') -Raw | ConvertFrom-Json).time
      foreach($marker in @('native-end.json','prepare-end.json')) {
        Assert-True ((Get-Content (Join-Path $a $marker) -Raw | ConvertFrom-Json).time -lt $sourceEnd) 'build-ready work did not complete while source tests were pending'
      }
      $acceptance=@($metrics.stages | Where-Object name -eq 'acceptance')[0]
      $source=@($metrics.stages | Where-Object name -eq 'source-tests')[0]
      Assert-True ([DateTime]$source.completedUtc -le [DateTime]$acceptance.startedUtc) 'acceptance started before source tests completed'
    }
    if($Mode -like 'install-*'){
        Assert-True ($metrics.status -ceq 'installation-failed' -and $metrics.installation.status -ceq 'failed') 'installation failure was reported as success or a different stage'
        if($Mode -eq 'install-nonthrow-exit'){
            $installRecord=@($metrics.stages | Where-Object name -eq 'install')[0]
            Assert-True ($installRecord.exitCode -eq 7) 'nonthrowing installer exit code was not propagated'
            Assert-True ((Get-Content $installRecord.stderr -Raw) -match 'exit code 7') 'nonthrowing installer exit diagnostic was lost'
        }
    }
    foreach($record in $metrics.stages){Assert-True ($null -ne $record.exitCode) "Missing actual exit code in $Name/$($record.name)";Assert-True (Test-Path -LiteralPath $record.stdout) 'stdout not retained';Assert-True (Test-Path -LiteralPath $record.stderr) 'stderr not retained'}
    $invocation=Get-Content (Join-Path $a 'test-invocation.json') -Raw | ConvertFrom-Json
    $sourceLaunch = @(Get-Content -LiteralPath (Join-Path $a 'test-launch.json') -Raw | ConvertFrom-Json)
    Assert-True ($sourceLaunch.Count -eq 4 -and $sourceLaunch[0] -ceq '--args-file' -and $sourceLaunch[1] -ceq $metrics.sourceTestArguments.path -and $sourceLaunch[2] -ceq '--args-sha256' -and $sourceLaunch[3] -ceq $metrics.sourceTestArguments.sha256) 'source launch lost owned argument file or expected identity'
    Assert-True ($metrics.sourceTestArguments.count -eq $invocation.Count -and $metrics.sourceTestArguments.sha256 -ceq (Get-FileHash -LiteralPath $sourceLaunch[1]).Hash.ToLowerInvariant()) 'source argv metrics lost logical identity'
    $expectedSourceArgs=@('--test-concurrency','4')
    $expectedSourceArgs+=@(if($FullRegression){'--area';'current';'--area';'standalone';'--defer-preservation-cache-owner'}else{'--changed-only'})
    $expectedPolicyPaths=@(if($PolicyChangedPath){$PolicyChangedPath.Replace('\','/')}elseif($Mode -eq 'submodule-mutation'){'modules/vendor'})
    foreach($changed in $expectedPolicyPaths){$expectedSourceArgs+=@('--changed',$changed)}
    if($Exhaustive){$expectedSourceArgs+='--exhaustive'}
    $policy=Get-Content -LiteralPath (Join-Path $a 'logs/deploy-chosen/source-test-policy-inputs.json') -Raw | ConvertFrom-Json
    Assert-True ((@($policy.changedPaths) -join '|') -ceq ($expectedPolicyPaths -join '|') -and $policy.exhaustive -eq $Exhaustive) 'source policy inputs mismatch'
    $expectedSourceArgs+=@('--log-directory',(Join-Path $a 'logs/deploy-chosen/source-tests'))
    $sourceReuseConfigPath=Join-Path $a 'logs/deploy-chosen/engine-source-preflight-inputs.json'
    $expectedSourceArgs+=@('--source-preflight-config',$sourceReuseConfigPath)
    $sourceReuseConfig=Get-Content -LiteralPath $sourceReuseConfigPath -Raw | ConvertFrom-Json
    Assert-True ($sourceReuseConfig.checkPhase -ceq 'source' -and (Test-Path -LiteralPath $sourceReuseConfig.receiptPath -PathType Leaf)) 'source runner did not receive the completed preflight receipt'
    Assert-True (($invocation -join '|') -ceq ($expectedSourceArgs -join '|')) 'source argv did not match selected regression scope'
    Assert-True ($metrics.testScope -ceq $(if($FullRegression){'full'}else{'changed'})) 'source test scope metric lost'
    Assert-True ($metrics.forceNativeVerification -is [bool] -and $metrics.forceNativeVerification -eq $ForceNative) 'native verification policy metric lost'
    Assert-True ($metrics.verificationPolicy.scope -ceq $(if($FullRegression){'full'}else{'changed'}) -and $metrics.verificationPolicy.nativeReuse -eq (-not $ForceNative)) 'scope and reuse policies were conflated'
    $fixtureEnvironment=Get-Content (Join-Path $a 'source-fixture-environment.json') -Raw | ConvertFrom-Json
    $executionEnvironment=Get-Content (Join-Path $a 'source-execution-environment.json') -Raw | ConvertFrom-Json
    foreach($binding in @(@{key='AZRAEL_INSTRUCTION_TEST_ROOT';name='instructions'},@{key='AZRAEL_CATALOG_TEST_ROOT';name='catalog'},@{key='AZRAEL_MIGRATION_TEST_ROOT';name='migration'})) {
        $expectedParent=Join-Path $metrics.sourceFixtureRoot $binding.name
        Assert-True ($fixtureEnvironment.($binding.key) -ceq $expectedParent -and $executionEnvironment.($binding.key) -ceq $expectedParent) 'fixture readiness and execution used different attempt roots'
    }

    if($success){
        $engineReceipt=Get-Content (Join-Path $a 'logs/deploy-chosen/engine-preservation/receipt.json') -Raw | ConvertFrom-Json
        Assert-True ($metrics.verificationResults.enginePreservation.status -ceq $engineReceipt.status -and ($metrics.verificationResults.enginePreservation.summary | ConvertTo-Json -Depth 8 -Compress) -ceq ($engineReceipt.executionSummary | ConvertTo-Json -Depth 8 -Compress)) 'engine receipt summary was not preserved in actual deployment metrics'
        Assert-True ($metrics.verificationResults.packagePreservation.status -ceq 'passed') 'package preservation status metric lost'
        Assert-True ($metrics.verificationResults.packagePreservation.summary.unit -ceq 'invocation-group' -and $metrics.verificationResults.packagePreservation.summary.kinds.source.executed -eq 0) 'package preservation execution summary metric lost'
        $preservationCalls=@(Get-Content (Join-Path $a 'preservation-invocation.jsonl') | ForEach-Object { $_ | ConvertFrom-Json })
        $expectedPreservationActions=if($ReuseSourcePreflight){'verify-receipt|run|verify|verify-receipt'}else{'run|run|verify|verify-receipt'}
        Assert-True (($preservationCalls.action -join '|') -ceq $expectedPreservationActions) 'successful preservation gate ordering changed'
        Assert-True ($metrics.sourcePreflight.disposition -ceq $(if($ReuseSourcePreflight){'reused'}else{'executed'})) 'source preflight reuse disposition lost'
        if($ReuseSourcePreflight){Assert-True ($sourceReuseConfig.receiptPath -ceq $priorReceipt) 'explicit prior receipt handoff lost'}
        foreach($call in @($preservationCalls | Where-Object action -in @('run','verify-receipt'))){
            Assert-True ($call.config.reuseNativeChecks -is [bool] -and $call.config.reuseNativeChecks -eq (-not $ForceNative)) 'native preservation reuse policy lost'
            if($FullRegression){Assert-True ($null -eq $call.config.PSObject.Properties['featureIds']) 'full engine preservation was restricted'}
            else{Assert-True ((@($call.config.featureIds) -join '|') -ceq $(if($PolicyChangedPath -ceq 'engine/codex-rs/core/src/session/mod.rs'){'engine.fixture'}else{''})) 'changed engine preservation scope lost'}
        }
        $expectedUiIds=if($FullRegression){$uiFeatureIds}else{@()}
        foreach($call in @($preservationCalls | Where-Object action -eq 'verify')){
            Assert-True ($null -ne $call.config.PSObject.Properties['featureIds']) 'package verification feature selection missing'
            Assert-True ((@($call.config.featureIds) -join '|') -ceq (@($expectedUiIds) -join '|')) 'package verification feature scope lost'
        }
        Assert-True (($metrics.inputChecks.phase -join '|') -ceq 'initial|pre-install') 'whole-project guard phases changed or redundant guard returned'
        foreach($inputCheck in $metrics.inputChecks){
            Assert-True ($inputCheck.exitCode -eq 0 -and $inputCheck.durationMs -ge 0 -and $inputCheck.fileCount -gt 0 -and $inputCheck.bytes -gt 0) 'missing successful content-snapshot metrics'
            Assert-True ($inputCheck.sha256 -ceq $metrics.projectInputSha256 -and (Test-Path -LiteralPath $inputCheck.report)) 'input guard digest/report lost'
        }
        $buildCalls=@(Get-Content (Join-Path $a 'build-invocation.jsonl') | ForEach-Object { $_ | ConvertFrom-Json })
        Assert-True ($buildCalls.Count -eq 1) 'build was invoked more than once'
        Assert-True ($buildCalls[0].SkipEngineBuild -eq (-not $FullBuild)) 'full build/engine reuse selection was lost'
        if($FullBuild -and -not $TargetKind){
            $cargoSelections=@(Get-Content (Join-Path $a 'cargo-selection-invocation.jsonl') | ForEach-Object { $_ | ConvertFrom-Json })
            Assert-True ($cargoSelections.Count -eq 1) 'shared Cargo selection was not invoked exactly once'
            $cargoSelection=$cargoSelections[0]
            Assert-True ($cargoSelection.projectRoot -ceq $root -and $cargoSelection.sourceRoot -ceq $buildCalls[0].SourceRoot -and $cargoSelection.target -ceq 'x86_64-pc-windows-msvc') 'shared Cargo selection owner/source/target changed'
            Assert-True ($buildCalls[0].CargoCacheProjectRoot -ceq $cargoSelection.selection.projectRoot -and $buildCalls[0].EngineTargetDirectory -ceq $cargoSelection.selection.targetDirectory) 'shared Cargo owner/target were not forwarded to build exactly'
            Assert-True ($metrics.cargoCache.projectRoot -ceq $cargoSelection.selection.projectRoot -and $metrics.cargoCache.targetDirectory -ceq $cargoSelection.selection.targetDirectory) 'shared Cargo owner/target metrics lost selection'
            foreach($call in @($preservationCalls | Where-Object action -in @('run','verify-receipt'))){
                Assert-True ($call.config.cargoCacheProjectRoot -ceq $cargoSelection.selection.projectRoot -and $call.config.cargoTargetDirectory -ceq $cargoSelection.selection.targetDirectory) 'shared Cargo owner/target were not forwarded to preservation exactly'
            }
        }else{
            Assert-True (-not (Test-Path -LiteralPath (Join-Path $a 'cargo-selection-invocation.jsonl'))) 'explicit engine reuse/target unexpectedly selected a shared Cargo cache'
            Assert-True (-not $buildCalls[0].CargoCacheProjectRoot) 'engine reuse/explicit target unexpectedly forwarded a shared Cargo owner'
        }
        $expectedModuleOwner=if($moduleOwner){$moduleOwner}else{$root}
        Assert-True ($buildCalls[0].ModuleCacheProjectRoot -ceq $expectedModuleOwner) 'selected module cache owner was not forwarded exactly'
        Assert-True ($buildCalls[0].WindowControlTargetDirectory -ceq $windowTarget) 'shared Window Control target was not forwarded exactly'
        foreach($call in @($preservationCalls | Where-Object action -in @('run','verify-receipt'))){
            Assert-True ($(if($call.config.PSObject.Properties['cargoVerificationCacheProjectRoot']){$call.config.cargoVerificationCacheProjectRoot}else{''}) -ceq $moduleOwner) 'Cargo evidence storage owner was not forwarded exactly'
        }
        if($TargetKind){Assert-True ($buildCalls[0].EngineTargetDirectory -ceq $target -and $metrics.engineTargetDirectory -ceq $target) 'absolute engine cache was not forwarded and recorded exactly'}
        Assert-True ($buildCalls[0].VirtualInputRuntimeDirectory -ceq $(if($FullBuild){Join-Path $a 'official virtual input runtime'}else{''})) 'explicit virtual input runtime was not forwarded to the mock build exactly'
        Assert-True ($buildCalls[0].MultiPointerRuntimeDirectory -ceq $(if($FullBuild){Join-Path $a 'official multi pointer runtime'}else{''})) 'explicit multi-pointer runtime was not forwarded to the mock build exactly'
        if($FullBuild){Assert-True ($buildCalls[0].ComputerUseRuntimeDirectory -ceq (Join-Path $a 'official computer runtime') -and $buildCalls[0].ComputerUsePluginDirectory -ceq (Join-Path $a 'official computer plugin')) 'explicit Computer Use inputs were not forwarded exactly'}
        $start=Get-Content (Join-Path $a 'source-start.json') -Raw | ConvertFrom-Json
        $buildStart=Get-Content (Join-Path $a 'build-start.json') -Raw | ConvertFrom-Json
        $end=Get-Content (Join-Path $a 'source-end.json') -Raw | ConvertFrom-Json
        $buildEnd=Get-Content (Join-Path $a 'build-end.json') -Raw | ConvertFrom-Json
        Assert-True ($start.time -lt $buildEnd.time -and $buildStart.time -lt $end.time) 'build and source tests did not truly overlap'
        $prepare=Get-Content (Join-Path $a 'prepare-invocation.json') -Raw | ConvertFrom-Json
        Assert-True ($prepare.NamespaceCacheProjectRoot -ceq $moduleOwner) 'namespace transform cache owner was not forwarded exactly'
        $check=Get-Content (Join-Path $a 'check-invocation.json') -Raw | ConvertFrom-Json
        if($Name -eq 'short fixture install') {
            Assert-True (Test-Path -LiteralPath $check.FixtureRoot) 'CLI-selected fixture lost its active command reference protection'
            $afterExit = & (Join-Path $scripts 'clean-verification-artifacts.ps1') -ProjectRoot $root -FixtureRoot $check.FixtureRoot -Apply -ReportPath (Join-Path $a 'logs/short-fixture-after-exit.json')
            Assert-True ($afterExit.candidates[0].status -ceq 'deleted') 'short fixture was not cleaned after its CLI producer exited'
        }
        Assert-True (-not (Test-Path -LiteralPath $check.FixtureRoot)) 'successful verification fixture was not cleaned after child disposal'
        if($Name -eq 'full install'){
            $invalidParentReport=Join-Path $a 'logs/deploy-chosen/invalid-parent-report.json'
            $invalidParent=& (Join-Path $scripts 'clean-verification-artifacts.ps1') -ProjectRoot $root -FixtureRoot $check.FixtureRoot -Apply -ReportPath $invalidParentReport -ReportLifecycleId 'version:wrong-owner'
            Assert-True ($invalidParent.status -eq 'blocked' -and -not(Test-Path -LiteralPath $invalidParentReport)) 'invalid report parent must be rejected before output creation'
        }
        Assert-True ((Test-Path -LiteralPath $metrics.acceptanceResult) -and $metrics.acceptanceResult -match 'verification-evidence') 'archived acceptance reference missing'
        if($Name -eq 'short fixture install') {
            Assert-True ($metrics.verificationCleanup.candidates[0].status -ceq 'retained' -and $metrics.verificationCleanup.candidates[0].reason -match '^Active command path:') 'CLI reference deferral was not recorded truthfully'
        } else { Assert-True ($metrics.verificationCleanup.candidates[0].status -ceq 'deleted') 'successful cleanup report missing' }
        $expectedTool=if($ModuleCache){Join-Path $a 'cache/modules/companion/pinned/companion/node_modules/typescript/lib/typescript.js'}else{Join-Path $a 'build/chosen/companion/node_modules/typescript/lib/typescript.js'}
        Assert-True ($prepare.TypeScriptPath -ceq $expectedTool) 'wrong pinned TypeScript'
        Assert-True (-not $check.TypeScriptPath -and $check.UseFreshState -eq $true) 'acceptance must use fresh state without historical build tools'
        if($Name -eq 'explicit policy verify only'){Assert-True (-not $check.VerifyStandalone) 'unrelated declared changes must not launch standalone host'}
        if($Name -in @('host changes verify only','runtime changes verify only','account source verify only') -or $FullRegression -or $Exhaustive -or -not $PolicyChangedPath){Assert-True ($check.VerifyStandalone) 'host changes, exhaustive or unknown scope require standalone activation'}
        Assert-True ($check.HostVsixPath -ceq (Join-Path $prepare.OutputDirectory 'azrael-host.vsix')) 'acceptance used a different package'
        $expectedFixtureState = Join-Path $check.FixtureRoot $(if ($Name -eq 'short fixture install') { 's' } else { 'state' })
        Assert-True ($check.StateRoot -ceq $expectedFixtureState) 'fixture state was not isolated with the selected short/default child'
        Assert-True ((Get-Content -LiteralPath (Join-Path $a 'verification-state-paths.txt')) -ccontains $check.StateRoot) 'acceptance state differs from the guarded preflight state'
        if($Name -eq 'short fixture install') { Assert-True ($check.FixtureRoot -ceq (Join-Path $a 'v')) 'explicit short fixture was not forwarded' }
        Assert-True ((@($prepare.SourceTestPolicy.changedPaths) -join '|') -ceq ($expectedPolicyPaths -join '|') -and $prepare.SourceTestPolicy.exhaustive -eq $Exhaustive) 'prepare source policy handoff lost'
        Assert-True ($prepare.ChangedOnlyTests -is [bool] -and $prepare.ChangedOnlyTests -eq (-not $FullRegression)) 'prepare changed-only policy lost'
        Assert-True ($prepare.ChangedOnlyTestsBound -eq (-not $FullRegression)) 'full prepare must omit ChangedOnlyTests'
        Assert-True ($prepare.SourceExtensionPath -ceq (Join-Path $a 'pristine UI')) 'prepare UI pin lost'
        Assert-True ($prepare.SkipCodexEnvironmentSnapshot -is [bool] -and $prepare.SkipCodexEnvironmentSnapshot -eq $SkipSnapshot) 'prepare snapshot policy was not forwarded exactly'
        Assert-True ([string]::IsNullOrEmpty($check.UiSourcePath)) 'final acceptance must use the prepared package without the preparation UI source'
        Assert-True ($check.OriginalExtensionPath -ceq (Join-Path $a 'original Codex') -and $check.OriginalAudioPath -ceq (Join-Path $a 'original audio')) 'original extension preservation paths lost'
        if($installed){
            $install=Get-Content (Join-Path $a 'install-invocation.json') -Raw | ConvertFrom-Json
            Assert-True ($install.PreparedPackageDirectory -ceq $prepare.OutputDirectory -and $install.ReleaseDirectory -ceq $prepare.ReleaseDirectory -and $install.NoLaunch -eq $true) 'installer did not receive exact release/package and NoLaunch'
            Assert-True ($install.UserDataDir -ceq (Join-Path $a 'user data')) 'installer profile path lost'
            Assert-True ($install.SkipCodexEnvironmentSnapshot -is [bool] -and $install.SkipCodexEnvironmentSnapshot -eq $SkipSnapshot) 'installer snapshot policy was not forwarded exactly'
            Assert-True (Test-Path -LiteralPath $metrics.installResult) 'installer result not retained'
            Assert-True ($metrics.installation.status -ceq 'verified' -and (Test-Path -LiteralPath $metrics.installation.receipt)) 'successful receipt was not explicitly bound and retained'
        }
    }
    if($Mode -ne 'success' -and $Mode -ne 'account-success' -and (Test-Path -LiteralPath (Join-Path $a 'check-invocation.json'))){
        $failedCheck=Get-Content (Join-Path $a 'check-invocation.json') -Raw | ConvertFrom-Json
        Assert-True (Test-Path -LiteralPath $failedCheck.FixtureRoot) 'failed deployment verification fixture was removed'
    }
    if($Mode -in @('source-fail','build-fail')){
        $failedName=if($Mode -eq 'source-fail'){'source-tests'}else{'build'}
        $expected=if($Mode -eq 'source-fail'){23}else{17}
        $failed=@($metrics.stages | Where-Object name -eq $failedName)[0]
        Assert-True ($failed.exitCode -eq $expected) 'actual failing command exit was lost'
        Assert-True ((Get-Content -LiteralPath $failed.stderr -Raw) -match 'causal') 'causal stderr was not retained'
        $other=@($metrics.stages | Where-Object { $_.name -in @('source-tests','build') -and $_.name -ne $failedName })[0]
        Assert-True $other.terminated 'other owned child was not terminated promptly'
        foreach($marker in @('source-start.json','build-start.json')){
            $pidValue=(Get-Content (Join-Path $a $marker) -Raw | ConvertFrom-Json).pid
            Assert-True ($null -eq (Get-Process -Id $pidValue -ErrorAction SilentlyContinue)) 'owned process survived failure'
        }
        $grandchild=Join-Path $a 'owned-grandchild.pid'
        if(Test-Path $grandchild){Assert-True ($null -eq (Get-Process -Id ([int](Get-Content $grandchild)) -ErrorAction SilentlyContinue)) 'owned descendant survived failure'}
    }
    if($Mode -eq 'command-error'){
        $buildRecord=@($metrics.stages | Where-Object name -eq 'build')[0]
        Assert-True ($buildRecord.exitCode -eq 1) 'command error exit code was not retained'
        Assert-True ((Get-Content $buildRecord.stderr -Raw) -match 'nonexistent-deployment-fixture-command') 'command error diagnostic was lost'
    }
    if($Mode -in @('success','account-success','build-fail')){
        $lifecycleSuccess=$Mode -in @('success','account-success')
        $initialLifecycle=Get-Content -LiteralPath (Join-Path $a 'build-lifecycle-start.json') -Raw | ConvertFrom-Json
        $finalLifecycle=@(Get-ChildItem -LiteralPath (Join-Path $a 'maintenance/lifecycles') -Filter '*.json' | ForEach-Object {Get-Content -LiteralPath $_.FullName -Raw | ConvertFrom-Json} | Where-Object id -eq 'version:chosen')
        Assert-True ($finalLifecycle.Count -eq 1) 'version lifecycle was lost'
        Assert-True (@($initialLifecycle.members | Where-Object { $_.generated -cne $true -or $_.protection_known -cne $true }).Count -eq 0) 'planned version generated ownership or protection knowledge missing'
        Assert-True (@($finalLifecycle[0].members | Where-Object { $_.generated -cne $true -or $_.protection_known -cne $true }).Count -eq 0) 'final version generated ownership or protection knowledge missing'
        $expectedState=if($lifecycleSuccess){'complete'}else{'failed'}
        Assert-True ($finalLifecycle[0].state -eq $expectedState -and $finalLifecycle[0].membership_complete -eq $lifecycleSuccess) 'version lifecycle completion does not match observed deployment'
        Assert-True ($initialLifecycle.members.Count -ge 7 -and $finalLifecycle[0].members.Count -eq $initialLifecycle.members.Count) 'planned version membership was incomplete or lost'
        foreach($member in $initialLifecycle.members){
            Assert-True (@($finalLifecycle[0].members | Where-Object {$_.role -eq $member.role -and $_.path -eq $member.path}).Count -eq 1) "planned lifecycle member lost: $($member.role)"
        }
        $fixtureRuns=@(Get-ChildItem -LiteralPath (Join-Path $a 'maintenance/lifecycles') -Filter '*.json' | ForEach-Object {Get-Content -LiteralPath $_.FullName -Raw | ConvertFrom-Json} | Where-Object id -eq 'run:verification:chosen')
        $initialRuns=@(Get-Content -LiteralPath (Join-Path $a 'build-fixture-lifecycle-start.json') -Raw | ConvertFrom-Json)
        Assert-True ($initialRuns.Count -eq $(if($Mode -eq 'account-success'){2}else{1}) -and @($initialRuns | Where-Object {$_.state -ne 'pending' -or $_.membership_complete}).Count -eq 0) 'fixture run pending membership evidence missing'
        Assert-True (@($finalLifecycle[0].members | Where-Object role -match 'fixture').Count -eq 0) 'ephemeral fixture retained as version payload'
        foreach ($initialRun in $initialRuns) {
            Assert-True (@($initialRun.members | Where-Object { $_.generated -cne $true -or $_.protection_known -cne $true }).Count -eq 0) 'planned fixture generated ownership or protection knowledge missing'
        }
        if($lifecycleSuccess){
            Assert-True ($fixtureRuns.Count -eq 0 -and $metrics.fixtureLifecycle.kind -eq 'run' -and $metrics.fixtureLifecycle.state -eq 'complete' -and $metrics.fixtureLifecycle.membership_complete -and $metrics.fixtureLifecycle.members.Count -eq 1) 'completed fixture run was not finalized independently of version'
        } else {
            Assert-True ($fixtureRuns.Count -eq 1 -and $fixtureRuns[0].state -eq 'failed' -and -not $fixtureRuns[0].membership_complete) 'failed fixture run ownership was lost'
        }
        if($Mode -eq 'account-success'){
            $accountRuns=@(Get-ChildItem -LiteralPath (Join-Path $a 'maintenance/lifecycles') -Filter '*.json' | ForEach-Object {Get-Content -LiteralPath $_.FullName -Raw | ConvertFrom-Json} | Where-Object id -eq 'run:account-controls:chosen')
            Assert-True ($accountRuns.Count -eq 0 -and $metrics.accountLifecycle.state -eq 'complete' -and $metrics.accountLifecycle.membership_complete -and $metrics.accountLifecycle.members.Count -eq 1) 'completed account fixture run was not finalized independently'
        }
    }
    if($Name -eq 'full install'){
        $temporaryRecords=@(Get-ChildItem -LiteralPath (Join-Path $a 'maintenance/lifecycles') -Filter '*.json' | ForEach-Object {Get-Content -LiteralPath $_.FullName -Raw | ConvertFrom-Json} | Where-Object owner -eq 'azrael-deployment-temporary')
        Assert-True ($temporaryRecords.Count -eq 1 -and $temporaryRecords[0].state -ceq 'complete') 'stable temporary lifecycle missing after successful deployment'
        Assert-True (@($temporaryRecords[0].references | Where-Object { $_.id -ceq 'version:chosen' -and $_.kind -ceq 'execution' }).Count -eq 0) 'completed deployment temporary execution reference retained'
        Assert-True (@($temporaryRecords[0].references | Where-Object { $_.id -ceq 'version:other-consumer' -and $_.kind -ceq 'execution' }).Count -eq 1) 'another active temporary consumer reference was released'
        Assert-True ($temporaryRecords[0].members[0].path -ceq (Join-Path $a 't')) 'deployment temporary output used an unstable path'
    }
    $results.Add([pscustomobject]@{case=$Name;exitCode=$exit;passed=$true;metrics=$metricsPath})
}
    Invoke-Case 'vsix entry index' 'vsix-entry-index'
    Invoke-Case 'host copy baseline' 'host-copy-baseline'
    Invoke-Case 'deployment capacity guard' 'deployment-capacity'
    Invoke-Case 'stage environment identity' 'stage-environment-identity'
    Invoke-Case 'release packaging parent' 'release-packaging-parent'
    Invoke-Case 'runtime staging resume' 'runtime-staging-resume'
    Invoke-Case 'environment preflight failure' 'environment-preflight-fail'
    Invoke-Case 'account socket path' 'account-socket-path'
    Invoke-Case 'fixture path selection' 'fixture-path-selection'
    Invoke-Case 'registered engine owner selection' 'registered-owner-selection'
    Invoke-Case 'policy selection' 'policy-selection'
    Invoke-Case 'engine-source-preflight-fail' 'engine-source-preflight-fail'
    Invoke-Case 'source-fixtures-fail' 'source-fixtures-fail'
    Invoke-Case 'dependencies-fail' 'dependencies-fail'
    Invoke-Case 'parallel prepare' 'success' $true
    Invoke-Case 'verify only' 'success' $true
    Invoke-Case 'explicit source receipt reuse' 'success' $true -ReuseSourcePreflight $true
    Invoke-Case 'explicit source receipt rejected' 'engine-source-preflight-fail' $true -ReuseSourcePreflight $true
    # One successful install also verifies that closing it preserves another temporary consumer.
    Invoke-Case 'full install' 'success'
    Invoke-Case 'source handoff unavailable' 'success' $true
    Invoke-Case 'resume after prepare failure' 'prepare-fail'
    Invoke-Case 'short fixture install' 'success'
    Invoke-Case 'module cache install' 'success' -ModuleCache $true
    Invoke-Case 'exhaustive regression verify only' 'success' $true -Exhaustive $true
    Invoke-Case 'related integration verify only' 'success' $true -PolicyChangedPath 'engine/codex-rs/core/src/session/mod.rs'
    Invoke-Case 'explicit policy verify only' 'success' $true -PolicyChangedPath 'docs/README.md'
    Invoke-Case 'host changes verify only' 'success' $true -PolicyChangedPath 'scripts/integrated-azrael-entry.cjs'
    Invoke-Case 'runtime changes verify only' 'success' $true -PolicyChangedPath 'scripts/shared-engine-host.cjs'
    Invoke-Case 'account source verify only' 'success' $true -PolicyChangedPath 'extensions/azrael-ex/src/extension.ts'
    Invoke-Case 'full regression verify only' 'success' $true -FullRegression $true
    Invoke-Case 'full regression force native' 'success' $true -FullRegression $true -ForceNative $true
    Invoke-Case 'selected force native' 'success' $true -ForceNative $true
    Invoke-Case 'shared module cache install' 'success' -ModuleCache $true -SharedModuleOwner $true
    Invoke-Case 'skip environment snapshot install' 'success' -SkipSnapshot $true
    foreach($mode in @('engine-preservation-fail','engine-preservation-missing-receipt','package-preservation-fail','package-preservation-binding','package-preservation-receipt','engine-preservation-recheck')){Invoke-Case $mode $mode}
    Invoke-Case 'full engine build target' 'success' $true '' $true 'absolute'
    Invoke-Case 'relative engine target' 'invalid-target' $true '' $true 'relative'
    Invoke-Case 'skip engine with target' 'invalid-target' $true '' $false 'absolute'
    Invoke-Case 'input snapshot failure' 'input-snapshot-fail'
    Invoke-Case 'source-fail-after-build' 'source-fail-after-build' $false '' $true
    Invoke-Case 'account-engine-fail' 'account-engine-fail' $false '' $true
    Invoke-Case 'account-prepare-fail' 'account-prepare-fail' $false '' $true
    Invoke-Case 'account-success' 'account-success' $false '' $true
    foreach($mode in @('account-command-fail','account-missing-report','account-status','account-route','account-engine','account-bridge','account-model-request','account-credit-request','account-string-count')){Invoke-Case $mode $mode $false '' $true}
    foreach($mode in @('install-nonthrow-exit','install-no-result','install-failed-receipt','install-wrong-receipt-package','install-wrong-receipt-version')){Invoke-Case $mode $mode}
    foreach($mode in @('source-fail','build-fail','command-error','prepare-fail','acceptance-command-fail','install-fail','build-mutation','prepare-mutation','check-mutation','check-addition','check-deletion','submodule-mutation','prepared-hash','prepared-version','wrong-package','missing-acceptance','missing-stage','null-stage','passed-false','passed-string','acceptance-hash','acceptance-version','acceptance-path','package-mutation')){Invoke-Case $mode $mode}
    foreach($stage in @('initialInventory','hostInstall','finalInventory','standaloneHost','host')){Invoke-Case "stage-$stage" 'failed-stage' $false $stage}
    Assert-True ($results.Count -gt 0) 'No regression cases matched Case.'
    $results | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $resultPath -Encoding utf8NoBOM
    $null = Register-ArtifactLifecycle -ProjectRoot $project -Id $lifecycleId -Kind run -Owner 'test-deploy-azrael' -State complete -MembershipComplete $true -Members $lifecycleMembers
    [pscustomobject]@{Passed=$results.Count;Failed=0;Logs=$logs;Fixtures=$fixtures;RunRoot=$runRoot;Reports=$reports;LifecycleId=$lifecycleId;ResultPath=$resultPath}
} catch {
    $failure = $_
    if ($lifecycleRegistered) {
        try {
            $null = Register-ArtifactLifecycle -ProjectRoot $project -Id $lifecycleId -Kind run -Owner 'test-deploy-azrael' -State failed -MembershipComplete $false -Members $lifecycleMembers
        } catch { Write-Warning "Failed to update run lifecycle: $($_.Exception.Message)" }
    }
    if (Test-Path -LiteralPath $reports -PathType Container) {
        try {
            @{passed=$results.Count;error=$failure.Exception.Message;results=@($results.ToArray());runRoot=$runRoot;logs=$logs;fixtures=$fixtures;lifecycleId=$lifecycleId} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $reports 'failure.json') -Encoding utf8NoBOM
        } catch { Write-Warning "Failed to write run failure report: $($_.Exception.Message)" }
    }
    throw $failure
}
