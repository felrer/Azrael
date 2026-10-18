param([Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$destination = [IO.Path]::GetFullPath($OutputDirectory)
$ownedRoot = [IO.Path]::GetFullPath((Join-Path $root 'artifacts/tasks/DU-01-window-use-stages/runs/20261017-product-fix-r1/native-check'))
if (!$destination.StartsWith($ownedRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Checks must remain within the assigned native-check run' }
if (Test-Path -LiteralPath $destination) { throw 'Use a fresh immutable check directory' }
[void][IO.Directory]::CreateDirectory($destination)
$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$source = Join-Path $PSScriptRoot 'ChildSession.cs'
$frozen = Join-Path $destination 'ChildSession.cs'
$binary = Join-Path $destination 'windows-child-session.exe'
$compileLog = Join-Path $destination 'compile.log'
$selfLog = Join-Path $destination 'self-test.json'
$receipt = Join-Path $destination 'receipt.json'
$producer = Join-Path $destination 'producer.json'
$frozenCheck = Join-Path $destination 'test-machine-setup.ps1'
$frozenProbe = Join-Path $destination 'probe.ps1'
$probeSource = Join-Path $destination 'probe-native.cs'
$probeBinary = Join-Path $destination 'probe-native.dll'
$probeLog = Join-Path $destination 'probe-compile.log'
@{
 owner='DU-01-window-use-stages/native-machine-setup'; purpose='Windows x64 compile and pure self-test; no UAC, service writes or child-session connection'
 planned=@($frozen,$frozenCheck,$frozenProbe,$probeSource,$probeBinary,$probeLog,$binary,$compileLog,$selfLog,$receipt,$producer)
 source=$source; sourceSha256=(Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
 compiler=$compiler; references=@('System.Windows.Forms.dll','System.Drawing.dll','System.Web.Extensions.dll','Microsoft.CSharp.dll','System.ServiceProcess.dll')
} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $producer -Encoding UTF8
Copy-Item -LiteralPath $source -Destination $frozen
Copy-Item -LiteralPath $PSCommandPath -Destination $frozenCheck
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'probe.ps1') -Destination $frozenProbe
$parseTokens = $null; $parseErrors = $null
[void][Management.Automation.Language.Parser]::ParseFile($frozenProbe,[ref]$parseTokens,[ref]$parseErrors)
if ($parseErrors.Count -ne 0) { throw ($parseErrors | Out-String) }
$probeText = [IO.File]::ReadAllText($frozenProbe)
$probeMatch = [regex]::Match($probeText, '(?s)\$nativeSource = @''\r?\n(.*?)\r?\n''@')
if (!$probeMatch.Success) { throw 'Probe native source block missing' }
[IO.File]::WriteAllText($probeSource,$probeMatch.Groups[1].Value,[Text.UTF8Encoding]::new($false))
& $compiler /nologo /target:library /platform:x64 "/out:$probeBinary" $probeSource *> $probeLog
$probeExit = $LASTEXITCODE
& $compiler /nologo /target:exe /platform:x64 /optimize+ "/out:$binary" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll /reference:Microsoft.CSharp.dll /reference:System.ServiceProcess.dll $frozen *> $compileLog
$compileExit = $LASTEXITCODE
$selfExit = $null
if ($compileExit -eq 0) {
 & $binary --self-test | Set-Content -LiteralPath $selfLog -Encoding UTF8
 $selfExit = $LASTEXITCODE
}
$unchanged = ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -eq (Get-FileHash -LiteralPath $frozen -Algorithm SHA256).Hash)
@{ compileExit=$compileExit; selfTestExit=$selfExit; probeCompileExit=$probeExit; probeSyntaxPassed=($parseErrors.Count -eq 0); sourceUnchanged=$unchanged; binarySha256=$(if(Test-Path -LiteralPath $binary){(Get-FileHash -LiteralPath $binary -Algorithm SHA256).Hash}); liveSetupVerified=$false } | ConvertTo-Json | Set-Content -LiteralPath $receipt -Encoding UTF8
if ($probeExit -ne 0) { Get-Content -LiteralPath $probeLog; exit $probeExit }
if ($compileExit -ne 0) { Get-Content -LiteralPath $compileLog; exit $compileExit }
if ($selfExit -ne 0) { Get-Content -LiteralPath $selfLog; exit $selfExit }
if (!$unchanged) { throw 'Selected source changed during verification' }
Get-Content -LiteralPath $receipt
