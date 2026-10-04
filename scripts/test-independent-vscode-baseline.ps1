#requires -Version 7.0
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'window-test-desktop-state.ps1') -DefinitionsOnly
$tokens = $null; $parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'check-independent-vscode.ps1'), [ref]$tokens, [ref]$parseErrors)
if ($parseErrors) { throw ($parseErrors | Out-String) }
$function = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Set-PreparedDesktopBaseline' }, $true)
Invoke-Expression $function.Extent.Text
$DesktopBaselinePath = 'original.json'
function New-Snapshot {
    @{ inputDesktop = 'Default'; cursor = @{visible=$true}; foregroundHwnd='0x1'; codeWindows=@(@{hwnd='0x1';pid=1;processCreated='identity';executable='Code.exe';visible=$true;minimized=$false;className='Chrome_WidgetWin_0';ownerHwnd='0x2';style='0x80000000';extendedStyle='0x00000080';toolWindow=$true;popup=$true}) }
}
$baselineRefreshBeforeCli = $null
$desktopBaseline = New-Snapshot
$next = New-Snapshot
$next.codeWindows[0].minimized = $true
$next.foregroundHwnd = '0x2'
Set-PreparedDesktopBaseline -Snapshot $next -SnapshotPath 'prepared.json'
if (-not $baselineRefreshBeforeCli.applied -or -not $desktopBaseline.codeWindows[0].minimized -or $desktopPrevious.foregroundHwnd -cne '0x2') { throw 'Confirmed preparation state not adopted.' }
foreach ($case in @('cursor','desktop','hwnd','pid','creation','executable','visible')) {
    $desktopBaseline = New-Snapshot
    $bad = New-Snapshot
    switch ($case) {
        cursor { $bad.cursor.visible = $false }
        desktop { $bad.inputDesktop = 'Other' }
        hwnd { $bad.codeWindows[0].hwnd = '0x2' }
        pid { $bad.codeWindows[0].pid = 2 }
        creation { $bad.codeWindows[0].processCreated = 'other' }
        executable { $bad.codeWindows[0].executable = 'other' }
        visible { $bad.codeWindows[0].visible = $false }
    }
    $rejected = $false
    try { Set-PreparedDesktopBaseline -Snapshot $bad -SnapshotPath 'bad.json' } catch { $rejected = $true }
    if (-not $rejected) { throw "Invalid baseline accepted: $case" }
}
'Prepared CLI baseline: confirmed state adopted; seven unsafe identity/cursor cases rejected. No GUI executed.'
$runtimeFunction = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Assert-FixtureRuntimePaths' }, $true)
Invoke-Expression $runtimeFunction.Extent.Text
$runtimeRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../artifacts/mock-runtime'))
$config = @{engine=(Join-Path $runtimeRoot 'engine.exe');bridge=(Join-Path $runtimeRoot 'bridge.exe');windowControl=@{directory=(Join-Path $runtimeRoot 'control');executable=(Join-Path $runtimeRoot 'control/helper.exe');mcpScript=(Join-Path $runtimeRoot 'control/mcp.cjs')}}
$missing = $null
function Test-Path { param($LiteralPath,$PathType) return $LiteralPath -cne $script:missing }
Assert-FixtureRuntimePaths -Config $config
foreach ($path in @($config.engine,$config.bridge,$config.windowControl.directory,$config.windowControl.executable,$config.windowControl.mcpScript)) {
    $missing = $path
    $rejected = $false
    try { Assert-FixtureRuntimePaths -Config $config } catch { $rejected=$true }
    if (-not $rejected) { throw "Missing runtime path accepted: $path" }
}
'Runtime preflight: complete paths accepted; five missing-path cases rejected. No files or GUI created.'
