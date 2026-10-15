#requires -Version 7.4
[CmdletBinding()]
param([string[]]$Case, [switch]$ChangedOnly, [string]$ArtifactProjectRoot = (Split-Path $PSScriptRoot -Parent))
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$project = [IO.Path]::GetFullPath($ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($ArtifactProjectRoot))
$stamp = [guid]::NewGuid().ToString('N')
$runRoot = Join-Path $project "artifacts/tasks/deploy-checks/runs/$stamp"
$fixtures = Join-Path $runRoot 'temporary/fixtures spaces 한글'
$logs = Join-Path $runRoot 'logs'
$reports = Join-Path $runRoot 'reports'
$resultPath = Join-Path $reports 'results.json'
$lifecycleId = "run:deploy-checks:$stamp"
$lifecycleMembers = [ordered]@{run=$runRoot;logs=$logs;reports=$reports;fixture=$fixtures}
$results = [Collections.Generic.List[object]]::new()
$lifecycleRegistered = $false
. (Join-Path $PSScriptRoot 'artifact-lifecycle.ps1')
try {
    if (Test-Path -LiteralPath $runRoot) { throw "Run identity already exists: $stamp" }
    $recordKey = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($lifecycleId))).ToLowerInvariant()
    if (Test-Path -LiteralPath (Join-Path $project "artifacts/maintenance/lifecycles/$recordKey.json")) { throw "Run producer identity already exists: $stamp" }
    $null = Register-ArtifactLifecycle -ProjectRoot $project -Id $lifecycleId -Kind run -Owner 'test-deploy-azrael' -State pending -MembershipComplete $false -Members $lifecycleMembers
    $lifecycleRegistered = $true
    $runParent = Split-Path $runRoot -Parent
    if (-not (Test-Path -LiteralPath $runParent)) { New-Item -ItemType Directory -Path $runParent | Out-Null }
    New-Item -ItemType Directory -Path $runRoot | Out-Null
    New-Item -ItemType Directory -Path $fixtures, $logs, $reports | Out-Null
$uiFeatureIds = @((Get-Content (Join-Path $PSScriptRoot 'azrael-feature-contracts.json') -Raw | ConvertFrom-Json).features | Where-Object area -eq 'ui' | ForEach-Object id)
$changedCases = @('full install', 'module cache install', 'full regression verify only', 'full regression force native', 'selected force native', 'shared module cache install', 'skip environment snapshot install', 'engine-preservation-fail', 'engine-preservation-missing-receipt', 'package-preservation-fail', 'package-preservation-binding', 'package-preservation-receipt', 'engine-preservation-recheck')
$pwsh = (Get-Process -Id $PID).Path
function Assert-True([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Write-Utf8([string]$Path, [string]$Text) { $Text | Set-Content -LiteralPath $Path -Encoding utf8NoBOM }
$nodeStub = @'
const fs = require('node:fs'); const path = require('node:path');
const root = path.dirname(__dirname); const a = path.join(root, 'artifacts');
const scenario = JSON.parse(fs.readFileSync(path.join(a, 'scenario.json')));
fs.writeFileSync(path.join(a, 'test-invocation.json'), JSON.stringify(process.argv.slice(2)));
fs.writeFileSync(path.join(a, 'source-start.json'), JSON.stringify({pid:process.pid, time:Date.now()}));
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
param([string]$ReleaseName,[string]$SourceRoot,[switch]$SkipEngineBuild,[string]$EngineDirectory,[string]$CodeModeHostPath,[string]$CompanionVsixPath,[string]$EngineTargetDirectory,[string]$ModuleCacheProjectRoot,[string]$WindowControlTargetDirectory,[string]$ComputerUseRuntimeDirectory,[string]$ComputerUsePluginDirectory,[switch]$LifecycleParentActive)
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
@{ReleaseName=$ReleaseName;SourceRoot=$SourceRoot;SkipEngineBuild=[bool]$SkipEngineBuild;EngineDirectory=$EngineDirectory;EngineTargetDirectory=$EngineTargetDirectory;ModuleCacheProjectRoot=$ModuleCacheProjectRoot;WindowControlTargetDirectory=$WindowControlTargetDirectory;ComputerUseRuntimeDirectory=$ComputerUseRuntimeDirectory;ComputerUsePluginDirectory=$ComputerUsePluginDirectory} | ConvertTo-Json -Compress | Add-Content (Join-Path $a 'build-invocation.jsonl')
@{pid=$PID;time=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()} | ConvertTo-Json | Set-Content (Join-Path $a 'build-start.json')
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
$buildInfo=@{engineSourceRoot=$SourceRoot}
if($scenario.moduleCache){
 $cachedTool=Join-Path $a 'cache/modules/companion/pinned/companion/node_modules/typescript/lib/typescript.js'
 New-Item -ItemType Directory -Path (Split-Path $cachedTool -Parent) -Force | Out-Null
 'cached typescript' | Set-Content $cachedTool
 $buildInfo.moduleBuild=@{typeScriptPath=$cachedTool}
}
$buildInfo | ConvertTo-Json | Set-Content (Join-Path $a "releases/$ReleaseName/build-info.json")
'pinned typescript' | Set-Content (Join-Path $a "build/$ReleaseName/companion/node_modules/typescript/lib/typescript.js")
@{time=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()} | ConvertTo-Json | Set-Content (Join-Path $a 'build-end.json')
if($scenario.mode -eq 'build-mutation'){'changed' | Set-Content (Join-Path $root 'input.txt')}
'@
$accountControlsStub = @'
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url))); const a = path.join(root, 'artifacts');
const scenario = JSON.parse(fs.readFileSync(path.join(a, 'scenario.json')));
const args = process.argv.slice(2); const [engine, bridge, state, socket, flag] = args;
if (!fs.existsSync(path.join(a, 'build-end.json')) || !fs.existsSync(path.join(a, 'source-end.json')) ||
    !fs.existsSync(path.join(a, 'logs/deploy-chosen/inputs-post-build.json')) || !fs.existsSync(path.join(a, 'prepare-end.json')) || !fs.existsSync(path.join(a, 'native-end.json'))) throw new Error('account gate ordering mismatch');
if (args.length !== 5 || flag !== '--account-controls-only' || fs.existsSync(state) || fs.existsSync(path.dirname(socket))) throw new Error('account gate arguments/freshness mismatch');
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
same(config.engineSourceRoot,path.join(a,'engine source 한글'),'engine source');
fs.mkdirSync(config.outputDirectory,{recursive:true});
const receiptPath=path.join(config.outputDirectory,'receipt.json');
if(args[0]==='run'){
 if(config.checkPhase==='source'){
  if(scenario.mode==='engine-source-preflight-fail'){console.error('causal source preflight failure');process.exit(51);}
  if(fs.existsSync(path.join(a,'build-start.json')))throw Error('source preflight ran after build');
  fs.writeFileSync(receiptPath,JSON.stringify({status:'passed',checkPhase:'source'}));console.log(JSON.stringify({receiptPath}));process.exit(0);
 }
 if(!config.sourceReceiptPath || !fs.existsSync(config.sourceReceiptPath))throw Error('source handoff receipt missing');
 same(config.engineDirectory,path.join(a,'releases/chosen/engine'),'engine directory');
 if(scenario.mode.startsWith('account-') || scenario.mode==='source-fail-after-build'){
  fs.writeFileSync(path.join(a,'native-start.json'),JSON.stringify({pid:process.pid,time:Date.now()}));
  (async()=>{const deadline=Date.now()+10000;while(!fs.existsSync(path.join(a,'prepare-start.json'))){if(Date.now()>deadline)throw Error('prepare did not start');await new Promise(r=>setTimeout(r,20));}
   if(scenario.mode==='account-engine-fail'){console.error('causal engine preservation failure');process.exit(41);}
   if(['account-prepare-fail','source-fail-after-build'].includes(scenario.mode))await new Promise(r=>setTimeout(r,30000));
   else await new Promise(r=>setTimeout(r,250));
   fs.writeFileSync(receiptPath,JSON.stringify({status:'passed'}));fs.writeFileSync(path.join(a,'native-end.json'),JSON.stringify({time:Date.now(),receiptPath}));console.log(JSON.stringify({receiptPath}));
  })().catch(e=>{console.error(e);process.exit(55)});return;
 }
 if(scenario.overlap){
  const started=Date.now();fs.writeFileSync(path.join(a,'native-start.json'),JSON.stringify({pid:process.pid,time:started}));fs.writeFileSync(path.join(a,'native-overlap-start.json'),JSON.stringify({time:started}));
  const poll=setInterval(()=>{
   if(fs.existsSync(path.join(a,'prepare-invocation.json'))){clearInterval(poll);fs.writeFileSync(receiptPath,JSON.stringify({status:'passed'}));fs.writeFileSync(path.join(a,'native-end.json'),JSON.stringify({time:Date.now(),receiptPath}));console.log(JSON.stringify({receiptPath}));}
   else if(Date.now()-started>10000){clearInterval(poll);console.error('preparation did not overlap native check');process.exitCode=54;}
  },25);
  return;
 }
 if(scenario.mode==='engine-preservation-fail'){console.error('causal engine preservation failure');process.exit(41);}
 if(scenario.mode==='engine-preservation-missing-receipt'){console.log('{}');process.exit(0);}
 fs.writeFileSync(receiptPath,JSON.stringify({status:'passed'}));
 console.log(JSON.stringify({receiptPath}));
}else if(args[0]==='verify'){
 same(config.uiRoot,path.join(a,'pristine UI'),'UI root');
 if(!config.receiptPath||!config.reportPath)throw Error('package preservation paths missing');
 if(scenario.mode==='package-preservation-fail'){console.error('causal package preservation failure');process.exit(43);}
 if(!fs.existsSync(config.receiptPath))throw Error('causal package preservation receipt missing');
 if(JSON.parse(fs.readFileSync(config.bindingPath,'utf8')).fixture!==true)throw Error('causal package preservation binding mismatch');
}else if(args[0]==='verify-receipt'){
 if(scenario.mode==='engine-preservation-recheck'){console.error('causal engine preservation recheck failure');process.exit(47);}
 if(!config.receiptPath||!fs.existsSync(config.receiptPath))throw Error('engine preservation receipt missing');
}else throw Error('unexpected preservation command');
'@
$prepareStub = @'
param([string]$ReleaseDirectory,[string]$OutputDirectory,[string]$StateRoot,[string]$SourceCodexHome,[string]$SourceExtensionPath,[string]$TypeScriptPath,[switch]$SkipCodexEnvironmentSnapshot,[switch]$ChangedOnlyTests,[string]$NamespaceCacheProjectRoot)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$a=Join-Path $root 'artifacts'
$scenario=Get-Content (Join-Path $a 'scenario.json') -Raw | ConvertFrom-Json
@{ReleaseDirectory=$ReleaseDirectory;OutputDirectory=$OutputDirectory;TypeScriptPath=$TypeScriptPath;SourceExtensionPath=$SourceExtensionPath;NamespaceCacheProjectRoot=$NamespaceCacheProjectRoot;SkipCodexEnvironmentSnapshot=[bool]$SkipCodexEnvironmentSnapshot;ChangedOnlyTests=[bool]$ChangedOnlyTests;ChangedOnlyTestsBound=$PSBoundParameters.ContainsKey('ChangedOnlyTests')} | ConvertTo-Json | Set-Content (Join-Path $a 'prepare-invocation.json')
@{pid=$PID;time=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()} | ConvertTo-Json | Set-Content (Join-Path $a 'prepare-start.json')
if($scenario.mode -like 'account-*' -or $scenario.mode -eq 'source-fail-after-build'){
 $deadline=[DateTime]::UtcNow.AddSeconds(10)
 while(-not (Test-Path (Join-Path $a 'native-start.json'))){if([DateTime]::UtcNow -gt $deadline){throw 'engine did not start'};Start-Sleep -Milliseconds 20}
 if($scenario.mode -eq 'account-prepare-fail'){[Console]::Error.WriteLine('causal prepare failure');exit 29}
 if($scenario.mode -in @('account-engine-fail','source-fail-after-build')){Start-Sleep -Seconds 30}else{Start-Sleep -Milliseconds 250}
}
if($scenario.mode -eq 'prepare-fail'){[Console]::Error.WriteLine('causal prepare failure');exit 29}
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
'{}' | Set-Content $preservationReceipt
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
param([string]$HostVsixPath,[string]$FixtureRoot,[string]$StateRoot,[switch]$UseFreshState,[string]$TypeScriptPath,[string]$UiSourcePath,[string]$OriginalExtensionPath,[string]$OriginalAudioPath,[string]$CodePath)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$a=Join-Path $root 'artifacts'
$scenario=Get-Content (Join-Path $a 'scenario.json') -Raw | ConvertFrom-Json
if(-not (Test-Path (Join-Path $a 'source-end.json'))){throw 'acceptance started before source tests passed'}
if($scenario.mode -like 'account-*'){
 foreach($marker in @('native-end.json','prepare-end.json','account-passed.json')){if(-not (Test-Path (Join-Path $a $marker))){throw "acceptance prerequisite missing: $marker"}}
}
@{HostVsixPath=$HostVsixPath;FixtureRoot=$FixtureRoot;StateRoot=$StateRoot;UseFreshState=[bool]$UseFreshState;TypeScriptPath=$TypeScriptPath;UiSourcePath=$UiSourcePath;OriginalExtensionPath=$OriginalExtensionPath;OriginalAudioPath=$OriginalAudioPath;CodePath=$CodePath} | ConvertTo-Json | Set-Content (Join-Path $a 'check-invocation.json')
New-Item -ItemType Directory -Path $FixtureRoot | Out-Null
if($scenario.mode -eq 'acceptance-command-fail'){[Console]::Error.WriteLine('causal acceptance failure');exit 31}
if($scenario.mode -eq 'missing-acceptance'){exit 0}
$exitCodes=[ordered]@{initialInventory=0;hostInstall=0;finalInventory=0;namespace=0;standaloneHost=0;host=0}
if($scenario.mode -eq 'failed-stage'){$exitCodes[$scenario.stage]=5}
if($scenario.mode -eq 'missing-stage'){$exitCodes.Remove('host')}
if($scenario.mode -eq 'null-stage'){$exitCodes.host=$null}
$passed=$scenario.mode -ne 'passed-false'
if($scenario.mode -eq 'passed-string'){$passed='True'}
$identity=@{vsix=$HostVsixPath;sha256=(Get-FileHash -LiteralPath $HostVsixPath).Hash;version='1.2.3'}
if($scenario.mode -eq 'acceptance-hash'){$identity.sha256='bad'}
if($scenario.mode -eq 'acceptance-version'){$identity.version='2.0.0'}
if($scenario.mode -eq 'acceptance-path'){$identity.vsix=Join-Path $a 'latest/azrael-host.vsix'}
@{passed=$passed;exitCodes=$exitCodes;hostPackage=$identity;useFreshState=[bool]$UseFreshState} | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $FixtureRoot 'check-result.json')
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
function Invoke-Case([string]$Name, [string]$Mode, [bool]$VerifyOnly = $false, [string]$Stage = '', [bool]$FullBuild = $false, [string]$TargetKind = '', [bool]$SkipSnapshot = $false, [bool]$FullRegression = $false, [bool]$ModuleCache = $false, [bool]$ForceNative = $false, [bool]$SharedModuleOwner = $false) {
    if ($Case -and $Name -notin $Case) { return }
    if ($ChangedOnly -and -not $Case -and $Name -notin $changedCases) { return }
    $root = Join-Path $fixtures $Name
    $scripts = Join-Path $root 'scripts'
    $a = Join-Path $root 'artifacts'
    New-Item -ItemType Directory -Path $scripts, $a | Out-Null
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'deploy-azrael.ps1') -Destination $scripts
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'clean-verification-artifacts.ps1') -Destination $scripts
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'artifact-lifecycle.ps1') -Destination $scripts
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'artifact-lifecycle.cjs') -Destination $scripts
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'deployment-input-snapshot.cjs') -Destination $scripts
    Write-Utf8 (Join-Path $scripts 'test-project.cjs') $nodeStub
    Write-Utf8 (Join-Path $scripts 'feature-preservation.cjs') $preservationStub
    Write-Utf8 (Join-Path $scripts 'pipeline-preflight.cjs') "const fs=require('node:fs'),path=require('node:path');const s=JSON.parse(fs.readFileSync(path.join(path.dirname(__dirname),'artifacts/scenario.json')));if(s.mode==='dependencies-fail'){console.error('causal dependency failure');process.exit(52);}console.log('{}');"
    Write-Utf8 (Join-Path $scripts 'build-azrael.ps1') $buildStub
    Write-Utf8 (Join-Path $scripts 'check-accounts.mjs') $accountControlsStub
    Write-Utf8 (Join-Path $scripts 'prepare-independent-vscode.ps1') $prepareStub
    Write-Utf8 (Join-Path $scripts 'check-independent-vscode.ps1') $checkStub
    Write-Utf8 (Join-Path $scripts 'install-azrael.ps1') $installStub
    Write-Utf8 (Join-Path $root '.gitignore') "artifacts/`n"
    Write-Utf8 (Join-Path $root 'input.txt') 'original'
    & git -c core.longpaths=true -C $root init --quiet
    Assert-True ($LASTEXITCODE -eq 0) 'fixture git init failed'
    & git -c core.longpaths=true -c core.autocrlf=false -C $root add -- .
    Assert-True ($LASTEXITCODE -eq 0) 'fixture git add failed'
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
    }
    @{mode=$Mode;stage=$Stage;uiFeatureIds=$uiFeatureIds;moduleCache=$ModuleCache;overlap=($Name -eq 'parallel prepare');slowSource=($Name -eq 'parallel prepare' -or $Mode -eq 'account-success')} | ConvertTo-Json | Set-Content (Join-Path $a 'scenario.json')
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
    $argsList = @('-NoLogo','-NoProfile','-NonInteractive','-File',(Join-Path $scripts 'deploy-azrael.ps1'),'-ReleaseName','chosen','-SourceRoot',(Join-Path $a 'engine source 한글'),'-UiSourcePath',(Join-Path $a 'pristine UI'),'-OriginalExtensionPath',(Join-Path $a 'original Codex'),'-OriginalAudioPath',(Join-Path $a 'original audio'),'-StateRoot',(Join-Path $a 'install state'),'-SourceCodexHome',(Join-Path $a 'source codex'),'-WorkspacePath',(Join-Path $a 'workspace'),'-ExtensionsDir',(Join-Path $a 'profile extensions'),'-UserDataDir',(Join-Path $a 'user data'),'-CodePath','code fixture.cmd')
    if(-not $FullBuild){$argsList += @('-SkipEngineBuild','-EngineDirectory',(Join-Path $a 'explicit engine'))}
    else{$argsList += @('-CodeModeHostPath',(Join-Path $a 'code mode host.exe'),'-ComputerUseRuntimeDirectory',(Join-Path $a 'official computer runtime'),'-ComputerUsePluginDirectory',(Join-Path $a 'official computer plugin'))}
    $target=if($TargetKind -eq 'relative'){'relative-cache'}else{Join-Path $a 'engine cache 한글'}
    if($TargetKind){$argsList += @('-EngineTargetDirectory',$target)}
    if($VerifyOnly){$argsList += '-VerifyOnly'}
    if($SkipSnapshot){$argsList += '-SkipCodexEnvironmentSnapshot'}
    if($FullRegression){$argsList += '-FullRegression'}
    if($ForceNative){$argsList += '-ForceNativeVerification'}
    $moduleOwner=if($SharedModuleOwner){Join-Path $a 'shared module owner 한글'}else{''}
    $windowTarget=if($SharedModuleOwner){Join-Path $a 'shared window target 한글'}else{''}
    if($SharedModuleOwner){$argsList += @('-ModuleCacheProjectRoot',$moduleOwner,'-WindowControlTargetDirectory',$windowTarget,'-CargoVerificationCacheProjectRoot',$moduleOwner,'-NamespaceCacheProjectRoot',$moduleOwner)}
    if($Mode -like 'account-*' -or $Mode -eq 'source-fail-after-build'){$argsList += '-VerifyAccountControls'}
    foreach($arg in $argsList){$info.ArgumentList.Add($arg)}
    $proc=[Diagnostics.Process]::Start($info)
    $stdout=$proc.StandardOutput.ReadToEndAsync();$stderr=$proc.StandardError.ReadToEndAsync()
    try {
        if(-not $proc.WaitForExit(45000)){$proc.Kill($true);$proc.WaitForExit();throw "case timed out: $Name"}
        $exit=$proc.ExitCode
    } finally {
        Write-Utf8 (Join-Path $logs "$Name.stdout.log") $stdout.GetAwaiter().GetResult()
        Write-Utf8 (Join-Path $logs "$Name.stderr.log") $stderr.GetAwaiter().GetResult()
        $proc.Dispose()
    }
    $metricsPath=Join-Path $a 'logs/deploy-chosen/deployment-metrics.json'
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
    if($Mode -eq 'input-snapshot-fail'){
        Assert-True ($exit -ne 0 -and $metrics.status -ceq 'failed') 'snapshot failure did not abort deploy'
        Assert-True ($metrics.inputChecks.Count -eq 1 -and $metrics.inputChecks[0].phase -ceq 'initial' -and $metrics.inputChecks[0].exitCode -ne 0) 'helper nonzero exit was not propagated'
        foreach($marker in @('source-start.json','build-start.json','prepare-invocation.json','install-invocation.json')){
            Assert-True (-not (Test-Path (Join-Path $a $marker))) "Snapshot failure started work: $marker"
        }
        $results.Add([pscustomobject]@{case=$Name;exitCode=$exit;passed=$true;metrics=$metricsPath})
        return
    }
    if ($Mode -in @('engine-source-preflight-fail','dependencies-fail')) {
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
        $expectedStages='verification-dependencies|engine-source-preflight|source-tests|build|engine-preservation|prepare'
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
        Assert-True ($accountArgs.Count -eq 5 -and $accountArgs[0] -ceq $engine -and $accountArgs[1] -ceq $bridge -and $accountArgs[2] -ceq $state -and $accountArgs[4] -ceq '--account-controls-only') 'account gate did not forward exact release paths/route'
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
    $expectedSourceArgs=@('--test-concurrency','4')
    $expectedSourceArgs+=@(if($FullRegression){'--area';'current';'--area';'standalone'}else{'--changed-only'})
    $expectedSourceArgs+=@('--log-directory',(Join-Path $a 'logs/deploy-chosen/source-tests'))
    Assert-True (($invocation -join '|') -ceq ($expectedSourceArgs -join '|')) 'source argv did not match selected regression scope'
    Assert-True ($metrics.testScope -ceq $(if($FullRegression){'full'}else{'changed'})) 'source test scope metric lost'
    Assert-True ($metrics.forceNativeVerification -is [bool] -and $metrics.forceNativeVerification -eq $ForceNative) 'native verification policy metric lost'
    if($success){
        $preservationCalls=@(Get-Content (Join-Path $a 'preservation-invocation.jsonl') | ForEach-Object { $_ | ConvertFrom-Json })
        Assert-True (($preservationCalls.action -join '|') -ceq 'run|run|verify|verify|verify-receipt') 'successful preservation gate ordering changed'
        foreach($call in @($preservationCalls | Where-Object action -in @('run','verify-receipt'))){
            Assert-True ($call.config.reuseNativeChecks -is [bool] -and $call.config.reuseNativeChecks -eq (-not $ForceNative)) 'native preservation reuse policy lost'
            if($FullRegression){Assert-True ($null -eq $call.config.PSObject.Properties['featureIds']) 'full engine preservation was restricted'}
            else{Assert-True ((@($call.config.featureIds) -join '|') -ceq 'engine.provider-context|engine.recovery|engine.accepted-input') 'changed engine preservation scope lost'}
        }
        $expectedUiIds=if($FullRegression){$uiFeatureIds}else{@()}
        foreach($call in @($preservationCalls | Where-Object action -eq 'verify')){
            Assert-True ($null -ne $call.config.PSObject.Properties['featureIds']) 'package verification feature selection missing'
            Assert-True ((@($call.config.featureIds) -join '|') -ceq (@($expectedUiIds) -join '|')) 'package verification feature scope lost'
        }
        Assert-True (($metrics.inputChecks.phase -join '|') -ceq 'initial|post-build|pre-install') 'whole-project guard phases changed or redundant guard returned'
        foreach($inputCheck in $metrics.inputChecks){
            Assert-True ($inputCheck.exitCode -eq 0 -and $inputCheck.durationMs -ge 0 -and $inputCheck.fileCount -gt 0 -and $inputCheck.bytes -gt 0) 'missing successful content-snapshot metrics'
            Assert-True ($inputCheck.sha256 -ceq $metrics.projectInputSha256 -and (Test-Path -LiteralPath $inputCheck.report)) 'input guard digest/report lost'
        }
        $buildCalls=@(Get-Content (Join-Path $a 'build-invocation.jsonl') | ForEach-Object { $_ | ConvertFrom-Json })
        Assert-True ($buildCalls.Count -eq 1) 'build was invoked more than once'
        Assert-True ($buildCalls[0].SkipEngineBuild -eq (-not $FullBuild)) 'full build/engine reuse selection was lost'
        Assert-True ($buildCalls[0].ModuleCacheProjectRoot -ceq $moduleOwner) 'shared module cache owner was not forwarded exactly'
        Assert-True ($buildCalls[0].WindowControlTargetDirectory -ceq $windowTarget) 'shared Window Control target was not forwarded exactly'
        foreach($call in @($preservationCalls | Where-Object action -in @('run','verify-receipt'))){
            Assert-True ($(if($call.config.PSObject.Properties['cargoVerificationCacheProjectRoot']){$call.config.cargoVerificationCacheProjectRoot}else{''}) -ceq $moduleOwner) 'Cargo evidence storage owner was not forwarded exactly'
        }
        if($TargetKind){Assert-True ($buildCalls[0].EngineTargetDirectory -ceq $target -and $metrics.engineTargetDirectory -ceq $target) 'absolute engine cache was not forwarded and recorded exactly'}
        if($FullBuild){Assert-True ($buildCalls[0].ComputerUseRuntimeDirectory -ceq (Join-Path $a 'official computer runtime') -and $buildCalls[0].ComputerUsePluginDirectory -ceq (Join-Path $a 'official computer plugin')) 'explicit Computer Use inputs were not forwarded exactly'}
        $start=Get-Content (Join-Path $a 'source-start.json') -Raw | ConvertFrom-Json
        $buildStart=Get-Content (Join-Path $a 'build-start.json') -Raw | ConvertFrom-Json
        $end=Get-Content (Join-Path $a 'source-end.json') -Raw | ConvertFrom-Json
        $buildEnd=Get-Content (Join-Path $a 'build-end.json') -Raw | ConvertFrom-Json
        Assert-True ($start.time -lt $buildEnd.time -and $buildStart.time -lt $end.time) 'build and source tests did not truly overlap'
        $prepare=Get-Content (Join-Path $a 'prepare-invocation.json') -Raw | ConvertFrom-Json
        Assert-True ($prepare.NamespaceCacheProjectRoot -ceq $moduleOwner) 'namespace transform cache owner was not forwarded exactly'
        $check=Get-Content (Join-Path $a 'check-invocation.json') -Raw | ConvertFrom-Json
        Assert-True (-not (Test-Path -LiteralPath $check.FixtureRoot)) 'successful verification fixture was not cleaned after child disposal'
        Assert-True ((Test-Path -LiteralPath $metrics.acceptanceResult) -and $metrics.acceptanceResult -match 'verification-evidence') 'archived acceptance reference missing'
        Assert-True ($metrics.verificationCleanup.candidates[0].status -ceq 'deleted') 'successful cleanup report missing'
        $expectedTool=if($ModuleCache){Join-Path $a 'cache/modules/companion/pinned/companion/node_modules/typescript/lib/typescript.js'}else{Join-Path $a 'build/chosen/companion/node_modules/typescript/lib/typescript.js'}
        Assert-True ($prepare.TypeScriptPath -ceq $expectedTool) 'wrong pinned TypeScript'
        Assert-True ($check.TypeScriptPath -ceq $prepare.TypeScriptPath -and $check.UseFreshState -eq $true) 'acceptance did not reuse explicit tools/fresh state'
        Assert-True ($check.HostVsixPath -ceq (Join-Path $prepare.OutputDirectory 'azrael-host.vsix')) 'acceptance used a different package'
        Assert-True ($check.StateRoot -ceq (Join-Path $check.FixtureRoot 'state')) 'fixture state was not isolated'
        Assert-True ($prepare.ChangedOnlyTests -is [bool] -and $prepare.ChangedOnlyTests -eq (-not $FullRegression)) 'prepare changed-only policy lost'
        Assert-True ($prepare.ChangedOnlyTestsBound -eq (-not $FullRegression)) 'full prepare must omit ChangedOnlyTests'
        Assert-True ($prepare.SourceExtensionPath -ceq (Join-Path $a 'pristine UI')) 'prepare UI pin lost'
        Assert-True ($prepare.SkipCodexEnvironmentSnapshot -is [bool] -and $prepare.SkipCodexEnvironmentSnapshot -eq $SkipSnapshot) 'prepare snapshot policy was not forwarded exactly'
        Assert-True ($check.UiSourcePath -ceq $prepare.SourceExtensionPath) 'acceptance UI pin lost'
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
    $results.Add([pscustomobject]@{case=$Name;exitCode=$exit;passed=$true;metrics=$metricsPath})
}
    Invoke-Case 'engine-source-preflight-fail' 'engine-source-preflight-fail'
    Invoke-Case 'dependencies-fail' 'dependencies-fail'
    Invoke-Case 'parallel prepare' 'success' $true
    Invoke-Case 'verify only' 'success' $true
    Invoke-Case 'full install' 'success'
    Invoke-Case 'module cache install' 'success' -ModuleCache $true
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
    foreach($stage in @('initialInventory','hostInstall','finalInventory','namespace','standaloneHost','host')){Invoke-Case "stage-$stage" 'failed-stage' $false $stage}
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
