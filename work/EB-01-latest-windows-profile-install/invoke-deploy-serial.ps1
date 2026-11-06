#requires -Version 7.4
param([Parameter(Mandatory)][string]$ConfigPath)
$ErrorActionPreference='Stop'
$config=Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
$sourceConfigPath=[string]$config.serialSourceConfig
$logDirectory=[string]$config.serialSourceLogs
$null=New-Item -ItemType Directory -Path $logDirectory
function Invoke-SourceCommand([string]$Name,[string[]]$Arguments,$Patch) {
    $info=[Diagnostics.ProcessStartInfo]::new((Get-Command node -CommandType Application).Source)
    $info.WorkingDirectory=$config.projectRoot
    $info.UseShellExecute=$false
    $info.CreateNoWindow=$true
    $info.RedirectStandardOutput=$true
    $info.RedirectStandardError=$true
    foreach($entry in $Patch.GetEnumerator()) {
        foreach($key in @($info.Environment.Keys | Where-Object { $_ -ieq $entry.Key })) { $null=$info.Environment.Remove($key) }
        $info.Environment[$entry.Key]=[string]$entry.Value
    }
    foreach($arg in $Arguments) { $info.ArgumentList.Add($arg) }
    $stdout=Join-Path $logDirectory "$Name.stdout.log"
    $stderr=Join-Path $logDirectory "$Name.stderr.log"
    $out=[IO.File]::Open($stdout,[IO.FileMode]::CreateNew)
    $err=[IO.File]::Open($stderr,[IO.FileMode]::CreateNew)
    $started=[DateTime]::UtcNow.ToString('o')
    $process=$null
    try {
        $process=[Diagnostics.Process]::Start($info)
        $outTask=$process.StandardOutput.BaseStream.CopyToAsync($out)
        $errTask=$process.StandardError.BaseStream.CopyToAsync($err)
        while(-not $process.WaitForExit(10000)) {
            $drive=[IO.DriveInfo]::new([IO.Path]::GetPathRoot([string]$config.projectRoot))
            if($drive.AvailableFreeSpace -lt 2000000000) {
                $process.Kill($true)
                $process.WaitForExit()
                throw 'Serial source preflight capacity guard: less than 2GB free; owned process tree stopped.'
            }
        }
        $null=$outTask.GetAwaiter().GetResult()
        $null=$errTask.GetAwaiter().GetResult()
        $exitCode=$process.ExitCode
    } finally {
        $out.Dispose();$err.Dispose()
        if($process) {
            if(-not $process.HasExited) { $process.Kill($true);$process.WaitForExit() }
            $process.Dispose()
        }
    }
    @{name=$Name;startedUtc=$started;completedUtc=[DateTime]::UtcNow.ToString('o');exitCode=$exitCode;stdout=$stdout;stderr=$stderr} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $logDirectory "$Name.execution.json") -Encoding utf8NoBOM
    if($exitCode -ne 0) { throw "$Name failed with exit code $exitCode. See $stderr and $stdout" }
    return $stdout
}
$environmentReport=Invoke-SourceCommand 'environment' @((Join-Path $config.projectRoot 'scripts/pipeline-preflight.cjs'),'--environment',$sourceConfigPath) @{}
$environment=Get-Content -LiteralPath $environmentReport -Raw | ConvertFrom-Json -AsHashtable
$sourcePatch=$environment.environmentPatch
$null=Invoke-SourceCommand 'dependencies' @((Join-Path $config.projectRoot 'scripts/pipeline-preflight.cjs'),$sourceConfigPath) $sourcePatch
$preservationReport=Invoke-SourceCommand 'preservation' @((Join-Path $config.projectRoot 'scripts/feature-preservation.cjs'),'run','--config',$sourceConfigPath) $sourcePatch
$result=Get-Content -LiteralPath $preservationReport -Raw | ConvertFrom-Json
if(-not $result.receiptPath) { throw 'Serial source preflight did not publish its passing receipt.' }
$parameters=@{}
foreach($property in $config.parameters.PSObject.Properties) { $parameters[$property.Name]=$property.Value }
$parameters.SourcePreflightReceipt=[string]$result.receiptPath
& (Join-Path $config.projectRoot 'scripts/deploy-azrael.ps1') @parameters
if($LASTEXITCODE -and $LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
