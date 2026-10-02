#requires -Version 7.0
[CmdletBinding()]
param([string]$OutputDirectory = (Join-Path $PSScriptRoot '../artifacts/logs/backup-selection'))
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$output = [IO.Path]::GetFullPath($OutputDirectory)
$fixture = Join-Path $output ('fixture-' + [guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($fixture) | Out-Null
$results = [Collections.Generic.List[object]]::new()
function Assert-True($Value, [string]$Message) { if (-not $Value) { throw $Message } }
function Test-Case([string]$Name, [scriptblock]$Body) {
    try { & $Body; $results.Add(@{ name = $Name; passed = $true }); "PASS: $Name" }
    catch { $results.Add(@{ name = $Name; passed = $false; error = $_.Exception.Message }); "FAIL: ${Name}: $($_.Exception.Message)" }
}
function Assert-Rejected([scriptblock]$Body, [string]$Pattern = '.') {
    $caught = $null
    try { & $Body | Out-Null } catch { $caught = $_.Exception.Message }
    Assert-True ($null -ne $caught) 'Expected rejection, but operation succeeded.'
    Assert-True ($caught -match $Pattern) "Unexpected rejection: $caught"
}
function New-Extension([string]$Directory, [string]$Id, [string]$Version) {
    [IO.Directory]::CreateDirectory($Directory) | Out-Null
    $parts = $Id.Split('.')
    @{ publisher = $parts[0]; name = $parts[1]; version = $Version } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $Directory 'package.json')
    [IO.File]::WriteAllText((Join-Path $Directory 'payload.txt'), "$Id@$Version")
}
function New-Registration([string]$Id, [string]$Version, [string]$Name) {
    @{ identifier = @{ id = $Id }; version = $Version; relativeLocation = $Name }
}
function Clone-Registration($Entry) { $Entry | ConvertTo-Json -Depth 20 | ConvertFrom-Json -AsHashtable }
. (Join-Path $PSScriptRoot 'extension-backup-plan.ps1')
. (Join-Path $PSScriptRoot 'directory-state.ps1')
$installerPath = Join-Path $PSScriptRoot 'install-independent-vscode.ps1'
$tokens = $null; $parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($installerPath, [ref]$tokens, [ref]$parseErrors)
Assert-True ($parseErrors.Count -eq 0) 'Installer syntax errors.'
foreach ($name in @('Get-FileState', 'Get-DirectoryState', 'ConvertTo-ComparableJson', 'ConvertTo-RegistryComparableJson', 'Write-Receipt')) {
    $definition = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }.GetNewClosure(), $true)
    Assert-True ($null -ne $definition) "Missing production function: $name"
    . ([scriptblock]::Create($definition.Extent.Text))
}
$hostId = 'azrael-ex-local.azrael'; $companionId = 'azrael-ex-local.azrael-ex'
$ownIds = @($hostId, $companionId)
$extensions = Join-Path $fixture 'extensions'
[IO.Directory]::CreateDirectory($extensions) | Out-Null
$hostName = "$hostId-1.0.0"; $companionName = "$companionId-0.9.0"
$hostPath = Join-Path $extensions $hostName; $companionPath = Join-Path $extensions $companionName
New-Extension $hostPath $hostId '1.0.0'; New-Extension $companionPath $companionId '0.9.0'
$stalePath = Join-Path $extensions "$hostId-0.8.0"
New-Extension $stalePath $hostId '0.8.0'
$invalidStale = Join-Path $extensions "$hostId-broken"
[IO.Directory]::CreateDirectory($invalidStale) | Out-Null
[IO.File]::WriteAllText((Join-Path $invalidStale 'package.json'), '{broken')
$originalPath = Join-Path $extensions 'openai.chatgpt-1.0.0'
New-Extension $originalPath 'openai.chatgpt' '1.0.0'
$externalPath = Join-Path $fixture 'external-host'; New-Extension $externalPath $hostId '1.0.0'
$settingsPath = Join-Path $fixture 'settings.json'; [IO.File]::WriteAllText($settingsPath, '{"editor.fontSize":14}')
$hostEntry = New-Registration $hostId '1.0.0' $hostName
$companionEntry = New-Registration $companionId '0.9.0' $companionName
$registryBefore = @($hostEntry, $companionEntry, (New-Registration 'openai.chatgpt' '1.0.0' 'openai.chatgpt-1.0.0'))
$beforeInventory = @("$hostId@1.0.0", "$companionId@0.9.0", 'openai.chatgpt@1.0.0')
function Get-Plan($Registry = $registryBefore, $Inventory = $beforeInventory, $Root = $extensions) {
    Get-AzraelExtensionBackupPlan -ExtensionsDirectory $Root -Registry $Registry -OwnIds $ownIds -Inventory $Inventory
}
Test-Case 'registered host and legacy companion selected; stale folders skipped' {
    $plan = Get-Plan
    Assert-True ($plan.selected.Count -eq 2 -and $plan.skipped.Count -eq 2) 'Unexpected selected/skipped counts.'
    Assert-True (@($plan.selected.id | Sort-Object) -join ',' -eq (@($ownIds | Sort-Object) -join ',')) 'Wrong selected IDs.'
}
Test-Case 'fresh empty Azrael accepted' {
    $empty = Join-Path $fixture 'fresh'; [IO.Directory]::CreateDirectory($empty) | Out-Null
    $plan = Get-Plan -Registry @() -Inventory @() -Root $empty
    Assert-True ($plan.selected.Count -eq 0 -and $plan.skipped.Count -eq 0) 'Fresh plan was not empty.'
}
foreach ($case in @(
    @{ name = 'missing version'; change = { param($e) $e.Remove('version') | Out-Null } },
    @{ name = 'missing location'; change = { param($e) $e.Remove('relativeLocation') | Out-Null } },
    @{ name = 'missing directory'; change = { param($e) $e.relativeLocation = 'absent' } },
    @{ name = 'traversal'; change = { param($e) $e.relativeLocation = '../external' } },
    @{ name = 'nested path'; change = { param($e) $e.relativeLocation = 'nested/host' } },
    @{ name = 'absolute relative path'; change = { param($e) $e.relativeLocation = $hostPath } },
    @{ name = 'external absolute location'; change = { param($e) $e.Remove('relativeLocation') | Out-Null; $e.location = @{ fsPath = $externalPath; scheme = 'file' } } },
    @{ name = 'non-file scheme'; change = { param($e) $e.location = @{ fsPath = $hostPath; scheme = 'https' } } },
    @{ name = 'mismatched fsPath'; change = { param($e) $e.location = @{ fsPath = $companionPath; scheme = 'file' } } },
    @{ name = 'relative fsPath'; change = { param($e) $e.location = @{ fsPath = $hostName; scheme = 'file' } } },
    @{ name = 'manifest version mismatch'; change = { param($e) $e.version = '2.0.0' } },
    @{ name = 'manifest ID mismatch'; change = { param($e) $e.relativeLocation = $companionName } },
    @{ name = 'malformed location object'; change = { param($e) $e.location = 'invalid' } }
)) {
    Test-Case ("reject " + $case.name) {
        $entry = Clone-Registration $hostEntry; & $case.change $entry
        Assert-Rejected { Get-Plan -Registry @($entry, $companionEntry) }
    }
}
Test-Case 'reject duplicate registrations' { Assert-Rejected { Get-Plan -Registry @($hostEntry, $hostEntry, $companionEntry) } 'Duplicate' }
Test-Case 'reject duplicate source paths across own registrations' {
    $entry = Clone-Registration $companionEntry; $entry.relativeLocation = $hostName
    Assert-Rejected { Get-Plan -Registry @($hostEntry, $entry) } 'ambiguous'
}
Test-Case 'reject missing inventory registration' { Assert-Rejected { Get-Plan -Registry @($companionEntry) } 'no matching registration' }
Test-Case 'reject absent inventory entry' { Assert-Rejected { Get-Plan -Inventory @("$companionId@0.9.0") } 'inventory' }
Test-Case 'reject duplicate inventory entry' { Assert-Rejected { Get-Plan -Inventory ($beforeInventory + "$hostId@1.0.0") } 'inventory' }
Test-Case 'reject inventory version discrepancy' { Assert-Rejected { Get-Plan -Inventory @("$hostId@2.0.0", "$companionId@0.9.0") } 'inventory' }
Test-Case 'reject malformed registered manifest' {
    $entry = Clone-Registration $hostEntry; $entry.relativeLocation = [IO.Path]::GetFileName($invalidStale)
    Assert-Rejected { Get-Plan -Registry @($entry, $companionEntry) }
}
Test-Case 'reject missing registered manifest' {
    $bare = Join-Path $extensions 'registered-without-manifest'; [IO.Directory]::CreateDirectory($bare) | Out-Null
    $entry = Clone-Registration $hostEntry; $entry.relativeLocation = 'registered-without-manifest'
    Assert-Rejected { Get-Plan -Registry @($entry, $companionEntry) }
}
Test-Case 'matching absolute file location accepted' {
    $entry = Clone-Registration $hostEntry; $entry.Remove('relativeLocation') | Out-Null
    $entry.location = @{ fsPath = $hostPath; scheme = 'file' }
    Assert-True ((Get-Plan -Registry @($entry, $companionEntry)).selected.Count -eq 2) 'Valid absolute registration rejected.'
}
Test-Case 'reject redirected registered directory; unregistered redirected folder skipped' {
    $link = Join-Path $extensions "$hostId-junction"
    New-Item -ItemType Junction -Path $link -Target $hostPath | Out-Null
    $entry = Clone-Registration $hostEntry; $entry.relativeLocation = [IO.Path]::GetFileName($link)
    Assert-Rejected { Get-Plan -Registry @($entry, $companionEntry) } 'redirection'
    Assert-True (@((Get-Plan).skipped | Where-Object reason -eq 'unregistered-redirected-directory').Count -eq 1) 'Unregistered junction was not skipped.'
}
# Execute the installer AST statements verbatim from registry recheck through
# the first CLI exit-code check. Function extraction avoids user-profile setup.
$tryAst = $ast.Find({ param($n) $n -is [Management.Automation.Language.TryStatementAst] -and $n.Body.Extent.Text.Contains('$currentRegistryText =') }, $true)
$statements = @($tryAst.Body.Statements)
$start = -1; $end = -1
for ($i = 0; $i -lt $statements.Count; $i++) {
    if ($statements[$i].Extent.Text.StartsWith('$currentRegistryText =')) { $start = $i }
    if ($statements[$i].Extent.Text.Contains('Host VSIX installation failed with exit code')) { $end = $i; break }
}
Assert-True ($start -ge 0 -and $end -gt $start) 'Could not locate production backup/install prefix.'
$backupBlock = [scriptblock]::Create(($statements[$start..$end].Extent.Text -join "`n"))
$sentinel = Join-Path $fixture 'mock-code.ps1'
@'
param([Parameter(ValueFromRemainingArguments)][string[]]$Arguments)
if ($Arguments -notcontains '--install-extension') { throw 'Unexpected mock CLI operation.' }
$receipt = Get-Content -LiteralPath $env:AZRAEL_BACKUP_TEST_RECEIPT -Raw | ConvertFrom-Json
if (-not (Test-Path -LiteralPath $receipt.registryBackup -PathType Leaf)) { throw 'Registry backup was not completed before installation.' }
if ($receipt.previousOwnExtensionDirectories.Count -ne 0 -or $receipt.extensionBackupSelection.policy -ne 'none') { throw 'Extension directory backup policy is incorrect.' }
[IO.File]::WriteAllText($env:AZRAEL_BACKUP_TEST_SENTINEL, 'install-extension')
$global:LASTEXITCODE = 0
'@ | Set-Content -LiteralPath $sentinel
$registryPath = Join-Path $extensions 'extensions.json'
ConvertTo-Json -InputObject $registryBefore -Depth 30 | Set-Content -LiteralPath $registryPath
$registryBeforeText = Get-Content -LiteralPath $registryPath -Raw
$extensionBackupPlan = Get-Plan
$selectionAst = $ast.Find({ param($n) $n -is [Management.Automation.Language.HashtableAst] -and $n.Extent.Text.StartsWith("@{ policy = 'none'; registered =") }, $true)
Assert-True ($null -ne $selectionAst) 'Missing production no-directory-backup receipt policy.'
$selectionBlock = [scriptblock]::Create($selectionAst.Extent.Text)
$staleBefore = Get-AzraelDirectoryState $stalePath; $invalidBefore = Get-AzraelDirectoryState $invalidStale
$script:directoryHashMetrics = @()
$originalBefore = Get-DirectoryState $originalPath; $settingsBefore = Get-FileState $settingsPath
function Invoke-BackupPrefix([string]$Name, [switch]$FailCopy, [switch]$RegistryDrift, [switch]$ManifestDrift) {
    $deploymentDirectory = Join-Path $fixture $Name; [IO.Directory]::CreateDirectory($deploymentDirectory) | Out-Null
    $receiptPath = Join-Path $deploymentDirectory 'receipt.json'
    $receipt = [ordered]@{ previousOwnExtensionDirectories = @(); extensionBackupSelection = (. $selectionBlock); registryBackup = $null; hostVsix = 'fixture.vsix'; performance = $null }
    $prepared = [pscustomobject]@{ DevinExecutable = $null }
    $resolvedCodePath = $sentinel; $codeArguments = @()
    $script:directoryHashMetrics = @(); $script:installationTimer = [Diagnostics.Stopwatch]::StartNew()
    $marker = Join-Path $deploymentDirectory 'install-called.txt'
    $priorSentinel = $env:AZRAEL_BACKUP_TEST_SENTINEL; $priorReceipt = $env:AZRAEL_BACKUP_TEST_RECEIPT
    $env:AZRAEL_BACKUP_TEST_SENTINEL = $marker
    $env:AZRAEL_BACKUP_TEST_RECEIPT = $receiptPath
    $copySources = [Collections.Generic.List[string]]::new()
    $hostManifestPath = Join-Path $hostPath 'package.json'
    $hostManifestText = Get-Content -LiteralPath $hostManifestPath -Raw
    function Get-DirectoryState { param($Path) throw "Unexpected directory hash: $Path" }
    function Get-AzraelDirectoryState { param($Path) throw "Unexpected directory hash: $Path" }
    function Copy-DirectoryBackup { param($Source, $Destination) throw "Unexpected directory backup: $Source" }
    function Copy-Item {
        param($LiteralPath, $Destination)
        Assert-True ($LiteralPath -eq $registryPath) "Unexpected backup source: $LiteralPath"
        $copySources.Add($LiteralPath)
        if ($FailCopy) { throw 'injected-registry-copy-failure' }
        Microsoft.PowerShell.Management\Copy-Item -LiteralPath $LiteralPath -Destination $Destination
    }
    try {
        if ($RegistryDrift -or $ManifestDrift) {
            if ($RegistryDrift) {
                [IO.File]::WriteAllText($registryPath, $registryBeforeText + ' ')
                Assert-Rejected { . $backupBlock } 'registry changed before installation'
            } else {
                [IO.File]::WriteAllText($hostManifestPath, '{"publisher":"azrael-ex-local","name":"azrael","version":"changed"}')
                Assert-Rejected { . $backupBlock } 'manifest ID or version mismatch'
            }
            Assert-True (-not (Test-Path -LiteralPath $marker)) 'Installation ran after failed pre-install recheck.'
        } elseif ($FailCopy) {
            Assert-Rejected { . $backupBlock } 'injected-registry-copy-failure'
            Assert-True (-not (Test-Path -LiteralPath $marker)) 'Installation ran after registry backup failure.'
        } else {
            . $backupBlock
            Assert-True (Test-Path -LiteralPath $marker) 'Install sentinel did not run.'
            $saved = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
            Assert-True ($saved.previousOwnExtensionDirectories.Count -eq 0) 'Directory backups were recorded.'
            Assert-True ($saved.extensionBackupSelection.policy -eq 'none' -and $saved.extensionBackupSelection.reason -eq 'extension-directory-backups-disabled') 'Wrong backup policy.'
            Assert-True ($saved.extensionBackupSelection.registered.Count -eq 2) 'Registered selection missing from receipt.'
            Assert-True ($saved.extensionBackupSelection.skipped.Count -eq $extensionBackupPlan.skipped.Count) 'Skipped selection missing from receipt.'
            Assert-True ((Get-FileHash $saved.registryBackup).Hash -ceq (Get-FileHash $registryPath).Hash) 'Registry backup differs from source.'
        }
        $expectedCopies = if ($RegistryDrift -or $ManifestDrift) { 0 } else { 1 }
        Assert-True ($copySources.Count -eq $expectedCopies) 'Unexpected registry copy attempt count.'
        Assert-True (-not (Test-Path -LiteralPath (Join-Path $deploymentDirectory 'previous-own-extensions'))) 'Directory backup root was created.'
    } finally {
        if ($RegistryDrift) { [IO.File]::WriteAllText($registryPath, $registryBeforeText) }
        if ($ManifestDrift) { [IO.File]::WriteAllText($hostManifestPath, $hostManifestText) }
        $env:AZRAEL_BACKUP_TEST_SENTINEL = $priorSentinel; $env:AZRAEL_BACKUP_TEST_RECEIPT = $priorReceipt
    }
}
Test-Case 'production registry backup failure prevents install-extension' { Invoke-BackupPrefix 'registry-copy-failure' -FailCopy }
Test-Case 'production registry backup precedes install; no extension directory copy or hash' { Invoke-BackupPrefix 'registry-copy-success' }
Test-Case 'production registry drift recheck prevents install and backup' { Invoke-BackupPrefix 'registry-drift' -RegistryDrift }
Test-Case 'production registered-manifest recheck prevents install and backup' { Invoke-BackupPrefix 'manifest-drift' -ManifestDrift }
Test-Case 'production directory-backup function and receipt writes removed' {
    Assert-True ($null -eq $ast.Find({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Copy-DirectoryBackup' }, $true)) 'Product directory-copy function remains.'
    Assert-True (-not $ast.Extent.Text.Contains('$receipt.previousOwnExtensionDirectories +=')) 'Product still records directory backups.'
    Assert-True ($ast.Extent.Text.Contains('previousOwnExtensionDirectories = @()')) 'Empty compatibility receipt field missing.'
}
Test-Case 'stale folders, original files and settings remain unchanged' {
    foreach ($pair in @(@($stalePath, $staleBefore), @($invalidStale, $invalidBefore), @($originalPath, $originalBefore))) {
        Assert-True ((Get-AzraelDirectoryState $pair[0]).sha256 -ceq $pair[1].sha256) "Changed fixture: $($pair[0])"
    }
    Assert-True ((Get-FileState $settingsPath).sha256 -ceq $settingsBefore.sha256) 'Settings changed.'
}
function Get-ProductionGuard([string]$Message) {
    $guard = $ast.Find({ param($n) $n -is [Management.Automation.Language.IfStatementAst] -and $n.Extent.Text.Contains("throw '$Message'") }.GetNewClosure(), $true)
    Assert-True ($null -ne $guard) "Missing guard: $Message"
    [scriptblock]::Create($guard.Extent.Text)
}
Test-Case 'production original-file guard accepts unchanged and rejects mutation' {
    $guard = Get-ProductionGuard 'Original Codex extension files changed during installation.'
    $originalAfter = Get-DirectoryState $originalPath; . $guard
    $originalAfter.sha256 = 'changed'; Assert-Rejected { . $guard } 'Original Codex extension files changed'
}
Test-Case 'production settings guard accepts unchanged and rejects mutation' {
    $guard = Get-ProductionGuard 'VS Code settings changed during installation.'
    $settingsAfter = Get-FileState $settingsPath; . $guard
    $settingsAfter.sha256 = 'changed'; Assert-Rejected { . $guard } 'VS Code settings changed'
}
Test-Case 'production unrelated inventory guard accepts unchanged and rejects mutation' {
    $guard = Get-ProductionGuard 'An unrelated extension inventory entry changed during installation.'
    $unrelatedBefore = @('openai.chatgpt@1.0.0'); $unrelatedAfter = @('openai.chatgpt@1.0.0'); . $guard
    $unrelatedAfter = @('openai.chatgpt@2.0.0'); Assert-Rejected { . $guard } 'unrelated extension inventory'
}
Test-Case 'production original registry guard accepts unchanged and rejects mutation' {
    $guard = Get-ProductionGuard 'Original Codex registry object changed during installation.'
    $registry = @($registryBefore | ForEach-Object { Clone-Registration $_ })
    $officialRegistryCanonicalBefore = ConvertTo-RegistryComparableJson @($registry | Where-Object { $_.identifier.id -eq 'openai.chatgpt' })
    . $guard
    $registry[2].version = '2.0.0'; Assert-Rejected { . $guard } 'Original Codex registry object changed'
}
Test-Case 'production unrelated registry guard accepts unchanged and rejects mutation' {
    $guard = Get-ProductionGuard 'An unrelated extension registry object changed during installation.'
    $registry = @($registryBefore | ForEach-Object { Clone-Registration $_ })
    $unrelatedRegistryCanonicalBefore = ConvertTo-RegistryComparableJson @($registry | Where-Object { $_.identifier.id -notin @($hostId, $companionId) } | Sort-Object { $_.identifier.id })
    . $guard
    $registry[2].version = '2.0.0'; Assert-Rejected { . $guard } 'unrelated extension registry object changed'
}
$summary = [ordered]@{ passed = @($results | Where-Object passed).Count; failed = @($results | Where-Object { -not $_.passed }).Count; fixture = $fixture; results = $results.ToArray() }
$summary | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (Join-Path $output 'results.json')
"RESULT: $($summary.passed) passed, $($summary.failed) failed; fixtures: $fixture"
if ($summary.failed) { exit 1 }
