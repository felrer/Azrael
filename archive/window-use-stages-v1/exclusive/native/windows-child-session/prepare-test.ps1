param([Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$destination = [IO.Path]::GetFullPath($OutputDirectory)
$artifactRoot = [IO.Path]::GetFullPath((Join-Path $root 'artifacts/tasks/DU-01-window-use-stages/runs/20261017-child-r1'))
if (!$destination.StartsWith($artifactRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Test preparation must remain inside the assigned child-session run' }
if (Test-Path -LiteralPath $destination) { throw 'Preparation destination already exists; use a new immutable attempt' }
[void][IO.Directory]::CreateDirectory($destination)
$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$source = Join-Path $PSScriptRoot 'ChildSession.cs'
$frozen = Join-Path $destination 'ChildSession.cs'
$binary = Join-Path $destination 'windows-child-session.exe'
$log = Join-Path $destination 'compile.log'
@{
 owner='DU-01-window-use-stages/child-session'; purpose='native compile and pure self-test only'
 planned=@($frozen,$binary,$log,(Join-Path $destination 'self-test.json'),(Join-Path $destination 'receipt.json'))
 source=$source; sourceSha256=(Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
 compiler=$compiler; command='csc /target:exe /platform:x64; --self-test (no connect or configuration writes)'
} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $destination 'producer.json') -Encoding UTF8
Copy-Item -LiteralPath $source -Destination $frozen
& $compiler /nologo /target:exe /platform:x64 /optimize+ "/out:$binary" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll /reference:System.ServiceProcess.dll /reference:Microsoft.CSharp.dll $frozen *> $log
$compileExit = $LASTEXITCODE
$selfExit = $null
if ($compileExit -eq 0) {
 & $binary --self-test | Set-Content -LiteralPath (Join-Path $destination 'self-test.json') -Encoding UTF8
 $selfExit = $LASTEXITCODE
}
@{ compileExit=$compileExit; selfTestExit=$selfExit; sourceUnchanged=((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -eq (Get-FileHash -LiteralPath $frozen -Algorithm SHA256).Hash); binarySha256=$(if(Test-Path -LiteralPath $binary){(Get-FileHash -LiteralPath $binary -Algorithm SHA256).Hash}); productAdmissionVerified=$false } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $destination 'receipt.json') -Encoding UTF8
if ($compileExit -ne 0) { Get-Content -LiteralPath $log; exit $compileExit }
if ($selfExit -ne 0) { exit $selfExit }
Get-Content -LiteralPath (Join-Path $destination 'receipt.json')
