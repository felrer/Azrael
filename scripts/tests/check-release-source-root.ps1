#requires -Version 7.0
$ErrorActionPreference = 'Stop'
$scripts = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $scripts '..')).Path
$fixture = Join-Path $projectRoot ('artifacts/verification/release-source-root-' + [guid]::NewGuid().ToString('N'))

function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}

function Import-Function([string]$ScriptPath, [string]$FunctionName) {
    $tokens = $null; $parseErrors = $null
    $ast = [Management.Automation.Language.Parser]::ParseFile($ScriptPath, [ref]$tokens, [ref]$parseErrors)
    Assert-True ($parseErrors.Count -eq 0) "PowerShell parse failed: $ScriptPath"
    $definition = @($ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $FunctionName }, $true))
    Assert-True ($definition.Count -eq 1) "Expected one $FunctionName in $ScriptPath"
    Invoke-Expression "function global:$FunctionName $($definition[0].Body.Extent.Text)"
}

try {
    $packageText = Get-Content -LiteralPath (Join-Path $scripts 'package-azrael.ps1') -Raw
    Assert-True ($packageText.Contains('engineSourceRoot = $sourceRoot')) 'Package manifest does not record the verified source root'
    New-Item -ItemType Directory -Path $fixture -Force | Out-Null
    $source = Join-Path $fixture 'source'
    $different = Join-Path $fixture 'different'
    $engine = Join-Path $fixture 'engine'
    foreach ($path in @($source, $different, $engine)) { New-Item -ItemType Directory -Path $path | Out-Null }
    foreach ($path in @($source, $different)) {
        New-Item -ItemType Directory -Path (Join-Path $path 'codex-rs') | Out-Null
        Set-Content -LiteralPath (Join-Path $path 'codex-rs/Cargo.toml') -Value '[workspace]' -Encoding utf8NoBOM
        Set-Content -LiteralPath (Join-Path $path 'tracked.txt') -Value $(if ($path -eq $source) { 'original' } else { 'different' }) -Encoding utf8NoBOM
        & git -C $path init --quiet
        if ($LASTEXITCODE -ne 0) { throw 'git init failed' }
        & git -C $path -c user.name=Fixture -c user.email=fixture@example.invalid add .
        & git -C $path -c user.name=Fixture -c user.email=fixture@example.invalid commit --quiet -m fixture
        if ($LASTEXITCODE -ne 0) { throw 'git fixture commit failed' }
    }
    foreach ($name in @('codex.exe', 'azrael-bridge.exe', 'codex-code-mode-host.exe')) {
        [IO.File]::WriteAllBytes((Join-Path $engine $name), [Text.Encoding]::UTF8.GetBytes($name))
    }
    $provenance = Join-Path $scripts 'engine-provenance.py'
    $snapshot = Join-Path $fixture 'snapshot.json'
    & python -B $provenance snapshot --root $source --file $snapshot | Out-Null
    Assert-True ($LASTEXITCODE -eq 0) 'Source snapshot failed'
    & python -B $provenance record --root $source --file $snapshot --engine-dir $engine --code-mode-host-source (Join-Path $engine 'codex-code-mode-host.exe') | Out-Null
    Assert-True ($LASTEXITCODE -eq 0) 'Engine provenance fixture failed'

    foreach ($scriptName in @('prepare-ordinary-vscode.ps1', 'install-independent-vscode.ps1')) {
        $path = Join-Path $scripts $scriptName
        if ($scriptName -eq 'install-independent-vscode.ps1') { Import-Function $path 'Get-AbsolutePath' }
        Import-Function $path 'Resolve-ReleaseEngineSourceRoot'
        $scriptText = Get-Content -LiteralPath $path -Raw
        Assert-True ($scriptText.Contains('verify --root $sourceRoot --engine-dir')) "$scriptName does not verify the resolved source root"

        $recorded = Resolve-ReleaseEngineSourceRoot -BuildInfo @{ engineSourceRoot = $source }
        Assert-True ($recorded -ieq $source) "$scriptName did not return the recorded source root"
        & python -B $provenance verify --root $recorded --engine-dir $engine | Out-Null
        Assert-True ($LASTEXITCODE -eq 0) "$scriptName recorded-root verification failed"

        foreach ($bad in @((Join-Path $fixture 'missing'), 'relative/source', '', $null)) {
            $rejected = $false
            try { $null = Resolve-ReleaseEngineSourceRoot -BuildInfo @{ engineSourceRoot = $bad } } catch { $rejected = $true }
            Assert-True $rejected "$scriptName accepted invalid recorded source root"
        }
        $wrongRoot = Resolve-ReleaseEngineSourceRoot -BuildInfo @{ engineSourceRoot = $different }
        & python -B $provenance verify --root $wrongRoot --engine-dir $engine 2>$null | Out-Null
        Assert-True ($LASTEXITCODE -ne 0) "$scriptName accepted a different source digest"

        $legacy = Resolve-ReleaseEngineSourceRoot -BuildInfo @{}
        $expectedLegacy = (Resolve-Path -LiteralPath (Join-Path $projectRoot 'upstream/codex')).Path
        Assert-True ($legacy -ieq $expectedLegacy) "$scriptName legacy fallback changed"
    }

    Import-Function (Join-Path $scripts 'prepare-ordinary-vscode.ps1') 'Set-AzraelEngineResolver'
    $old = 'function yI(t,e){let r=mn("cliExecutable");'
    $latest = 'function bM(t,e){let r=Mn("cliExecutable");'
    foreach ($anchor in @($old, $latest)) {
        $patched = Set-AzraelEngineResolver -HostText $anchor
        Assert-True ($patched.Contains('return require("./azrael-runtime.cjs").runtime.engine;')) 'Resolver injection failed'
        Assert-True ($patched.Contains($anchor.Substring(0, $anchor.IndexOf('let r=')))) 'Resolver name changed'
    }
    foreach ($text in @('function unknown(){}', "$old$latest", "$old$old")) {
        $rejected = $false
        try { $null = Set-AzraelEngineResolver -HostText $text } catch { $rejected = $true }
        Assert-True $rejected 'Unknown or ambiguous resolver anchor was accepted'
    }
    'release source root and resolver checks passed'
} finally {
    if (Test-Path -LiteralPath $fixture) { Remove-Item -LiteralPath $fixture -Recurse -Force }
}
