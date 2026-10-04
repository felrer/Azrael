param([switch]$CompileOnly)
$ErrorActionPreference = 'Stop'
if (-not $CompileOnly) { throw 'This wrapper only prepares the harness. Actual execution requires root GO and the documented Node --go interface.' }
$projectRoot = Split-Path -Parent $PSScriptRoot
$outputDirectory = Join-Path $projectRoot 'artifacts/build/selected-window-native'
$logDirectory = Join-Path $projectRoot 'artifacts/logs/selected-window-native'
New-Item -ItemType Directory -Force -Path $outputDirectory,$logDirectory | Out-Null
$compiler = 'C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) { throw 'Installed .NET Framework C# compiler is unavailable.' }
$source = Join-Path $PSScriptRoot 'fixtures/selected-window-native/Fixture.cs'
$executable = Join-Path $outputDirectory 'SelectedWindowFixture.exe'
$logPath = Join-Path $logDirectory 'fixture-compile.log'
& $compiler /nologo /target:exe /optimize+ /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll "/out:$executable" $source *> $logPath
$compileExit = $LASTEXITCODE
if ($compileExit -ne 0) { Get-Content -LiteralPath $logPath -Tail 40; throw "Fixture compile failed (exit $compileExit)." }
& node --check (Join-Path $PSScriptRoot 'test-selected-window-native.cjs') *> (Join-Path $logDirectory 'harness-syntax.log')
$syntaxExit = $LASTEXITCODE
if ($syntaxExit -ne 0) { throw "Harness syntax failed (exit $syntaxExit)." }
Write-Output "Compile-only readiness: fixture exit $compileExit; harness syntax exit $syntaxExit; no GUI or native desktop operation executed."
Write-Output $executable
