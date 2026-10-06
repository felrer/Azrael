#requires -Version 7.4
[CmdletBinding()]
param([string[]]$Case, [switch]$ChangedOnly)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$project = Split-Path $PSScriptRoot -Parent
$stamp = [guid]::NewGuid().ToString('N')
$fixtures = Join-Path $project "artifacts/verification/deployment-pipeline-optimization/runner/$stamp spaces 한글"
$logs = Join-Path $project "artifacts/logs/deployment-optimization/tests-deploy-$stamp"
if ($ChangedOnly) {
    $logs = Join-Path $project "artifacts/logs/session-completion-20261005/finish-changed-mock/$stamp"
    $fixtures = Join-Path $logs "fixtures spaces 한글"
}
$uiFeatureIds = @((Get-Content (Join-Path $PSScriptRoot 'azrael-feature-contracts.json') -Raw | ConvertFrom-Json).features | Where-Object area -eq 'ui' | ForEach-Object id)
$changedCases = @('full install', 'module cache install', 'full regression verify only', 'skip environment snapshot install', 'engine-preservation-fail', 'engine-preservation-missing-receipt', 'package-preservation-fail', 'package-preservation-binding', 'package-preservation-receipt', 'engine-preservation-recheck')
New-Item -ItemType Directory -Path $fixtures, $logs -Force | Out-Null
$pwsh = (Get-Process -Id $PID).Path
$results = [Collections.Generic.List[object]]::new()
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
 if(scenario.mode==='build-fail') await new Promise(r=>setTimeout(r,30000));
 else await new Promise(r=>setTimeout(r,250));
 fs.writeFileSync(path.join(a,'source-end.json'), JSON.stringify({time:Date.now()}));
})().catch(e=>{console.error(e);process.exit(9)});
'@
$buildStub = @'
param([string]$ReleaseName,[string]$SourceRoot,[switch]$SkipEngineBuild,[string]$EngineDirectory,[string]$CodeModeHostPath,[string]$CompanionVsixPath,[string]$EngineTargetDirectory)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$a=Join-Path $root 'artifacts'
$scenario=Get-Content (Join-Path $a 'scenario.json') -Raw | ConvertFrom-Json
@{ReleaseName=$ReleaseName;SourceRoot=$SourceRoot;SkipEngineBuild=[bool]$SkipEngineBuild;EngineDirectory=$EngineDirectory;EngineTargetDirectory=$EngineTargetDirectory} | ConvertTo-Json -Compress | Add-Content (Join-Path $a 'build-invocation.jsonl')
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
'fixture engine' | Set-Content (Join-Path $a "releases/$ReleaseName/engine/codex.exe")
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
    !fs.existsSync(path.join(a, 'logs/deploy-chosen/inputs-post-build.json')) || fs.existsSync(path.join(a, 'prepare-invocation.json'))) throw new Error('account gate ordering mismatch');
if (args.length !== 5 || flag !== '--account-controls-only' || fs.existsSync(state) || fs.existsSync(path.dirname(socket))) throw new Error('account gate arguments/freshness mismatch');
fs.writeFileSync(path.join(a, 'account-invocation.json'), JSON.stringify(args));
if (scenario.mode === 'account-command-fail') { console.error('causal account controls failure'); process.exit(37); }
fs.mkdirSync(state, {recursive:true});
if (scenario.mode === 'account-missing-report') process.exit(0);
const result = {status:'passed', route:'account-controls', engine, bridge, modelRequests:0, usageCreditConsumeRequests:0};
if (scenario.mode === 'account-status') result.status = 'failed';
if (scenario.mode === 'account-route') result.route = 'other';
if (scenario.mode === 'account-engine') result.engine = path.join(a, 'latest/codex.exe');
if (scenario.mode === 'account-bridge') result.bridge = path.join(a, 'latest/azrael-bridge.exe');
if (scenario.mode === 'account-model-request') result.modelRequests = 1;
if (scenario.mode === 'account-credit-request') result.usageCreditConsumeRequests = 1;
if (scenario.mode === 'account-string-count') result.modelRequests = '0';
fs.writeFileSync(path.join(state, 'verification.json'), JSON.stringify(result));
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
 same(config.engineDirectory,path.join(a,'releases/chosen/engine'),'engine directory');
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
param([string]$ReleaseDirectory,[string]$OutputDirectory,[string]$StateRoot,[string]$SourceCodexHome,[string]$SourceExtensionPath,[string]$TypeScriptPath,[switch]$SkipCodexEnvironmentSnapshot,[switch]$ChangedOnlyTests)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$a=Join-Path $root 'artifacts'
$scenario=Get-Content (Join-Path $a 'scenario.json') -Raw | ConvertFrom-Json
@{ReleaseDirectory=$ReleaseDirectory;OutputDirectory=$OutputDirectory;TypeScriptPath=$TypeScriptPath;SourceExtensionPath=$SourceExtensionPath;SkipCodexEnvironmentSnapshot=[bool]$SkipCodexEnvironmentSnapshot;ChangedOnlyTests=[bool]$ChangedOnlyTests;ChangedOnlyTestsBound=$PSBoundParameters.ContainsKey('ChangedOnlyTests')} | ConvertTo-Json | Set-Content (Join-Path $a 'prepare-invocation.json')
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
if($scenario.mode -eq 'prepare-mutation'){'changed' | Set-Content (Join-Path $root 'input.txt')}
'@
$checkStub = @'
param([string]$HostVsixPath,[string]$FixtureRoot,[string]$StateRoot,[switch]$UseFreshState,[string]$TypeScriptPath,[string]$UiSourcePath,[string]$OriginalExtensionPath,[string]$OriginalAudioPath,[string]$CodePath)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$a=Join-Path $root 'artifacts'
$scenario=Get-Content (Join-Path $a 'scenario.json') -Raw | ConvertFrom-Json
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
function Invoke-Case([string]$Name, [string]$Mode, [bool]$VerifyOnly = $false, [string]$Stage = '', [bool]$FullBuild = $false, [string]$TargetKind = '', [bool]$SkipSnapshot = $false, [bool]$FullRegression = $false, [bool]$ModuleCache = $false) {
    if ($Case -and $Name -notin $Case) { return }
    if ($ChangedOnly -and -not $Case -and $Name -notin $changedCases) { return }
    $root = Join-Path $fixtures $Name
    $scripts = Join-Path $root 'scripts'
    $a = Join-Path $root 'artifacts'
    New-Item -ItemType Directory -Path $scripts, $a | Out-Null
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'deploy-azrael.ps1') -Destination $scripts
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'clean-verification-artifacts.ps1') -Destination $scripts
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'deployment-input-snapshot.cjs') -Destination $scripts
    Write-Utf8 (Join-Path $scripts 'test-project.cjs') $nodeStub
    Write-Utf8 (Join-Path $scripts 'feature-preservation.cjs') $preservationStub
    Write-Utf8 (Join-Path $scripts 'build-azrael.ps1') $buildStub
    Write-Utf8 (Join-Path $scripts 'check-accounts.mjs') $accountControlsStub
    Write-Utf8 (Join-Path $scripts 'prepare-independent-vscode.ps1') $prepareStub
    Write-Utf8 (Join-Path $scripts 'check-independent-vscode.ps1') $checkStub
    Write-Utf8 (Join-Path $scripts 'install-azrael.ps1') $installStub
    Write-Utf8 (Join-Path $root '.gitignore') "artifacts/`n"
    Write-Utf8 (Join-Path $root 'input.txt') 'original'
    & git -C $root init --quiet
    Assert-True ($LASTEXITCODE -eq 0) 'fixture git init failed'
    & git -c core.autocrlf=false -C $root add -- .
    Assert-True ($LASTEXITCODE -eq 0) 'fixture git add failed'
    if($Mode -eq 'input-snapshot-fail'){
        Remove-Item -LiteralPath (Join-Path $root 'input.txt')
        New-Item -ItemType Directory -Path (Join-Path $root 'input.txt') | Out-Null
    }
    if($Mode -eq 'submodule-mutation'){
        $vendor=Join-Path $root 'modules/vendor'
        New-Item -ItemType Directory -Path $vendor | Out-Null
        & git -C $vendor init --quiet
        Write-Utf8 (Join-Path $vendor 'input.txt') 'original nested source'
        & git -c core.autocrlf=false -C $vendor add -- .
        & git -c user.name=Fixture -c user.email=fixture@example.invalid -C $vendor commit --quiet -m fixture
        Assert-True ($LASTEXITCODE -eq 0) 'nested fixture commit failed'
        $vendorHead=(& git -C $vendor rev-parse HEAD).Trim()
        & git -C $root update-index --add --cacheinfo "160000,$vendorHead,modules/vendor"
        Assert-True ($LASTEXITCODE -eq 0) 'fixture gitlink registration failed'
    }
    @{mode=$Mode;stage=$Stage;uiFeatureIds=$uiFeatureIds;moduleCache=$ModuleCache} | ConvertTo-Json | Set-Content (Join-Path $a 'scenario.json')
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
    else{$argsList += @('-CodeModeHostPath',(Join-Path $a 'code mode host.exe'))}
    $target=if($TargetKind -eq 'relative'){'relative-cache'}else{Join-Path $a 'engine cache 한글'}
    if($TargetKind){$argsList += @('-EngineTargetDirectory',$target)}
    if($VerifyOnly){$argsList += '-VerifyOnly'}
    if($SkipSnapshot){$argsList += '-SkipCodexEnvironmentSnapshot'}
    if($FullRegression){$argsList += '-FullRegression'}
    if($Mode -like 'account-*'){$argsList += '-VerifyAccountControls'}
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
    $success=$Mode -in @('success','account-success')
    Assert-True (($exit -eq 0) -eq $success) "Unexpected exit code $exit in $Name; see $logs/$Name.stderr.log"
    $installed=Test-Path -LiteralPath (Join-Path $a 'install-invocation.json')
    Assert-True ($installed -eq ($success -and -not $VerifyOnly -or $Mode -like 'install-*')) "Wrong installation gate in $Name"
    # Semantic reconstruction of the six preservation guards; historical exact cases were unavailable.
    if($Mode -like '*preservation*'){
        Assert-True ($metrics.status -ceq 'failed') 'preservation rejection was not reported as failed'
        $calls=@(Get-Content (Join-Path $a 'preservation-invocation.jsonl') | ForEach-Object { $_ | ConvertFrom-Json })
        $stageNames=@($metrics.stages.name)
        $expectedStages='source-tests|build|engine-preservation'
        $expectedActions='run'
        $markers=@('prepare-invocation.json','check-invocation.json','install-invocation.json')
        if($Mode -like 'package-preservation-*'){
            $expectedStages+='|prepare';$expectedActions+='|verify'
            $markers=@('check-invocation.json','install-invocation.json')
            Assert-True ((Get-Content (Join-Path $a 'logs/deploy-chosen/package-preservation.log') -Raw) -match 'causal package preservation') 'package preservation causal diagnostic lost'
        }elseif($Mode -eq 'engine-preservation-recheck'){
            $expectedStages+='|prepare|acceptance|engine-preservation-recheck';$expectedActions+='|verify|verify|verify-receipt'
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
        $engine=Join-Path $a 'releases/chosen/engine/codex.exe'
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
            foreach($marker in @('prepare-invocation.json','check-invocation.json','install-invocation.json')){Assert-True (-not (Test-Path (Join-Path $a $marker))) "Account gate failure started downstream work: $marker"}
        }
    }else{Assert-True (@($metrics.stages | Where-Object name -eq 'account-controls').Count -eq 0) 'account gate ran without opt-in'}
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
    $expectedSourceArgs=@(if($FullRegression){'--area';'current';'--area';'standalone'}else{'--changed-only'})
    $expectedSourceArgs+=@('--log-directory',(Join-Path $a 'logs/deploy-chosen/source-tests'))
    Assert-True (($invocation -join '|') -ceq ($expectedSourceArgs -join '|')) 'source argv did not match selected regression scope'
    Assert-True ($metrics.testScope -ceq $(if($FullRegression){'full'}else{'changed'})) 'source test scope metric lost'
    if($success){
        $preservationCalls=@(Get-Content (Join-Path $a 'preservation-invocation.jsonl') | ForEach-Object { $_ | ConvertFrom-Json })
        Assert-True (($preservationCalls.action -join '|') -ceq 'run|verify|verify|verify-receipt') 'successful preservation gate ordering changed'
        foreach($call in @($preservationCalls | Where-Object action -in @('run','verify-receipt'))){
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
        if($TargetKind){Assert-True ($buildCalls[0].EngineTargetDirectory -ceq $target -and $metrics.engineTargetDirectory -ceq $target) 'absolute engine cache was not forwarded and recorded exactly'}
        $start=Get-Content (Join-Path $a 'source-start.json') -Raw | ConvertFrom-Json
        $buildStart=Get-Content (Join-Path $a 'build-start.json') -Raw | ConvertFrom-Json
        $end=Get-Content (Join-Path $a 'source-end.json') -Raw | ConvertFrom-Json
        $buildEnd=Get-Content (Join-Path $a 'build-end.json') -Raw | ConvertFrom-Json
        Assert-True ($start.time -lt $buildEnd.time -and $buildStart.time -lt $end.time) 'build and source tests did not truly overlap'
        $prepare=Get-Content (Join-Path $a 'prepare-invocation.json') -Raw | ConvertFrom-Json
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
        $other=@($metrics.stages | Where-Object name -ne $failedName)[0]
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
    $results.Add([pscustomobject]@{case=$Name;exitCode=$exit;passed=$true;metrics=$metricsPath})
}
try {
    Invoke-Case 'verify only' 'success' $true
    Invoke-Case 'full install' 'success'
    Invoke-Case 'module cache install' 'success' -ModuleCache $true
    Invoke-Case 'full regression verify only' 'success' $true -FullRegression $true
    Invoke-Case 'skip environment snapshot install' 'success' -SkipSnapshot $true
    foreach($mode in @('engine-preservation-fail','engine-preservation-missing-receipt','package-preservation-fail','package-preservation-binding','package-preservation-receipt','engine-preservation-recheck')){Invoke-Case $mode $mode}
    Invoke-Case 'full engine build target' 'success' $true '' $true 'absolute'
    Invoke-Case 'relative engine target' 'invalid-target' $true '' $true 'relative'
    Invoke-Case 'skip engine with target' 'invalid-target' $true '' $false 'absolute'
    Invoke-Case 'input snapshot failure' 'input-snapshot-fail'
    Invoke-Case 'account-success' 'account-success' $false '' $true
    foreach($mode in @('account-command-fail','account-missing-report','account-status','account-route','account-engine','account-bridge','account-model-request','account-credit-request','account-string-count')){Invoke-Case $mode $mode $false '' $true}
    foreach($mode in @('install-nonthrow-exit','install-no-result','install-failed-receipt','install-wrong-receipt-package','install-wrong-receipt-version')){Invoke-Case $mode $mode}
    foreach($mode in @('source-fail','build-fail','command-error','prepare-fail','acceptance-command-fail','install-fail','build-mutation','prepare-mutation','check-mutation','check-addition','check-deletion','submodule-mutation','prepared-hash','prepared-version','wrong-package','missing-acceptance','missing-stage','null-stage','passed-false','passed-string','acceptance-hash','acceptance-version','acceptance-path','package-mutation')){Invoke-Case $mode $mode}
    foreach($stage in @('initialInventory','hostInstall','finalInventory','namespace','standaloneHost','host')){Invoke-Case "stage-$stage" 'failed-stage' $false $stage}
    Assert-True ($results.Count -gt 0) 'No regression cases matched Case.'
    $results | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $logs 'results.json') -Encoding utf8NoBOM
    [pscustomobject]@{Passed=$results.Count;Failed=0;Logs=$logs;Fixtures=$fixtures}
} catch {
    @{passed=$results.Count;error=$_.Exception.Message;results=@($results.ToArray())} | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $logs 'failure.json') -Encoding utf8NoBOM
    throw
}
