param([Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference='Stop'
$reconnectProject=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$reconnectOutput=[IO.Path]::GetFullPath($OutputDirectory)
$reconnectAllowed=[IO.Path]::GetFullPath((Join-Path $reconnectProject 'artifacts/tasks/CF-01-window-use-admin-setup/runs'))
if(-not $reconnectOutput.StartsWith($reconnectAllowed+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Fixture must remain in its owned task runs'}
if(Test-Path -LiteralPath $reconnectOutput){throw 'Use a fresh immutable fixture directory'}
[void][IO.Directory]::CreateDirectory($reconnectOutput)
$reconnectReport=[ordered]@{owner='CF-01-window-use-admin-setup';state='running';startedUtc=[DateTime]::UtcNow.ToString('o');platform='win32-x64';liveSessionVerified=$false;planned=@('ChildSession.cs','test-reconnect.ps1','windows-child-session.exe','compile.log','self-test.json','fixture.json')}
$reconnectReceipt=Join-Path $reconnectOutput 'fixture.json'
function Save-ReconnectFixture { $reconnectReport | ConvertTo-Json -Depth 7 | Set-Content -Encoding UTF8 -LiteralPath $reconnectReceipt }
Save-ReconnectFixture
try {
 $reconnectSource=Join-Path $reconnectOutput 'ChildSession.cs'
 Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'ChildSession.cs') -Destination $reconnectSource
 Copy-Item -LiteralPath $PSCommandPath -Destination (Join-Path $reconnectOutput 'test-reconnect.ps1')
 $reconnectReport.sourceSha256=(Get-FileHash -LiteralPath $reconnectSource -Algorithm SHA256).Hash
 $reconnectBinary=Join-Path $reconnectOutput 'windows-child-session.exe'
 $reconnectCompiler=Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
 $reconnectReport.compilerPath=$reconnectCompiler
 $reconnectReport.compilerSha256=(Get-FileHash -LiteralPath $reconnectCompiler -Algorithm SHA256).Hash
 Save-ReconnectFixture
 & $reconnectCompiler /nologo /target:exe /platform:x64 /optimize+ "/out:$reconnectBinary" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll /reference:System.ServiceProcess.dll /reference:Microsoft.CSharp.dll $reconnectSource *> (Join-Path $reconnectOutput 'compile.log')
 $reconnectReport.compileExitCode=$LASTEXITCODE; Save-ReconnectFixture
 if($LASTEXITCODE -ne 0){throw 'C# compilation failed; see compile.log'}
 & $reconnectBinary --self-test | Set-Content -LiteralPath (Join-Path $reconnectOutput 'self-test.json') -Encoding UTF8
 $reconnectReport.selfTestExitCode=$LASTEXITCODE
 if($LASTEXITCODE -ne 0){throw 'Native self-test failed; see self-test.json'}
 $reconnectResult=Get-Content -LiteralPath (Join-Path $reconnectOutput 'self-test.json') -Raw | ConvertFrom-Json
 if(-not $reconnectResult.ok -or $reconnectResult.reconnectFixtureChecks -ne 25 -or $reconnectResult.connected -or $reconnectResult.configurationWritten){throw 'Unexpected native self-test result'}
 $reconnectReport.sourceUnchanged=$reconnectReport.sourceSha256 -eq (Get-FileHash -LiteralPath (Join-Path $PSScriptRoot 'ChildSession.cs') -Algorithm SHA256).Hash -and $reconnectReport.sourceSha256 -eq (Get-FileHash -LiteralPath $reconnectSource -Algorithm SHA256).Hash
 if(-not $reconnectReport.sourceUnchanged){throw 'Source changed during fixture execution'}
 $reconnectReport.binarySha256=(Get-FileHash -LiteralPath $reconnectBinary -Algorithm SHA256).Hash
 $reconnectReport.state='passed'; $reconnectReport.exitCode=0
} catch {
 $reconnectReport.state='failed'; $reconnectReport.error=$_.Exception.Message; $reconnectReport.exitCode=1
} finally {
 $reconnectReport.completedUtc=[DateTime]::UtcNow.ToString('o'); Save-ReconnectFixture
}
$reconnectReport | ConvertTo-Json -Depth 7
exit $reconnectReport.exitCode
