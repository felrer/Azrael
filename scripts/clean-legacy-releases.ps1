#requires -Version 7.4
[CmdletBinding()]
param(
    [string]$ProjectRoot = (Join-Path $PSScriptRoot '..'),
    [string[]]$ProtectedPaths = @(),
    [string]$ExtensionsDirectory = (Join-Path $env:USERPROFILE '.vscode/extensions'),
    [switch]$Apply,
    [string]$ReportPath
)
$ErrorActionPreference = 'Stop'

function ConvertTo-LegacyPath([string]$Path) {
    $Path = $Path.Replace('/', '\').Replace('\\?\UNC\', '\\').Replace('\\?\', '')
    if (-not [IO.Path]::IsPathFullyQualified($Path)) { throw "Absolute path required: $Path" }
    [IO.Path]::GetFullPath($Path).TrimEnd('\')
}
function Test-LegacyWithin([string]$Path, [string]$Parent) {
    $Path -ieq $Parent -or $Path.StartsWith($Parent + '\', [StringComparison]::OrdinalIgnoreCase)
}
function Assert-LegacyUnlinked([string]$Path, [switch]$Recursive) {
    for ($cursor = $Path; $cursor; $cursor = [IO.Path]::GetDirectoryName($cursor)) {
        if (Test-Path -LiteralPath $cursor) {
            if ((Get-Item -LiteralPath $cursor -Force -ErrorAction Stop).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Linked path or ancestor: $cursor" }
        }
    }
    if ($Recursive) {
        # Inspect every directory and child without repeating the root's full
        # ancestor chain for every directory in a packaged dependency tree.
        $pending = [Collections.Generic.Queue[string]]::new()
        $pending.Enqueue($Path)
        while ($pending.Count) {
            $directory = $pending.Dequeue()
            if ((Get-Item -LiteralPath $directory -Force -ErrorAction Stop).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Nested link: $directory" }
            foreach ($child in Get-ChildItem -LiteralPath $directory -Force -ErrorAction Stop) {
                if ($child.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Nested link: $($child.FullName)" }
                if ($child.PSIsContainer) { $pending.Enqueue($child.FullName) }
            }
        }
    }
}
function Read-LegacyJson([string]$Path) {
    Assert-LegacyUnlinked $Path
    $data = Get-Content -LiteralPath $Path -Raw -ErrorAction Stop | ConvertFrom-Json -AsHashtable -NoEnumerate -ErrorAction Stop
    return ,$data
}
function Get-LegacyAbsoluteReferences($Value) {
    if ($Value -is [string]) {
        if ([IO.Path]::IsPathFullyQualified($Value)) { ConvertTo-LegacyPath $Value }
    } elseif ($Value -is [System.Collections.IDictionary]) {
        foreach ($v in $Value.Values) { Get-LegacyAbsoluteReferences $v }
    } elseif ($Value -is [System.Collections.IEnumerable]) {
        foreach ($v in $Value) { Get-LegacyAbsoluteReferences $v }
    }
}
function Get-LegacyProcesses { @(Get-CimInstance Win32_Process -ErrorAction Stop) }
function Get-LegacyProcessReason([string]$Path, $Processes) {
    foreach ($proc in $Processes) {
        if ($proc.ExecutablePath -and (Test-LegacyWithin (ConvertTo-LegacyPath $proc.ExecutablePath) $Path)) { return "Active executable: $($proc.ProcessId)" }
        if ($proc.CommandLine) {
            $command = $proc.CommandLine.Replace('/', '\').Replace('\\?\UNC\', '\\').Replace('\\?\', '')
            if ($command.IndexOf($Path, [StringComparison]::OrdinalIgnoreCase) -ge 0) { return "Active command path: $($proc.ProcessId)" }
        }
    }
}
function Expand-LegacyShortcutEnvironment([string]$Value) {
    $expanded = [Environment]::ExpandEnvironmentVariables($Value)
    if ($Value -ieq '%HOMEDRIVE%%HOMEPATH%' -and $expanded -match '%[^%]+%') {
        $profile = [Environment]::GetFolderPath('UserProfile')
        if (-not $profile -or -not (Test-Path -LiteralPath $profile -PathType Container)) { throw 'UserProfile fallback cannot be verified.' }
        $expanded = ConvertTo-LegacyPath $profile
    }
    if ($expanded -match '%[^%]+%') { throw "Unresolved shortcut environment variable: $Value" }
    $expanded
}
function Get-LegacyShortcutPaths($Shortcut, [string]$Workspace) {
    if ($Shortcut.TargetPath) { ConvertTo-LegacyPath (Expand-LegacyShortcutEnvironment $Shortcut.TargetPath) }
    if ($Shortcut.WorkingDirectory) {
        $working = ConvertTo-LegacyPath (Expand-LegacyShortcutEnvironment $Shortcut.WorkingDirectory)
        $workspacePath = ConvertTo-LegacyPath $Workspace
        foreach ($artifactRoot in @('artifacts/releases', 'artifacts/vsix')) {
            if (Test-LegacyWithin $working (Join-Path $workspacePath $artifactRoot)) { $working; break }
        }
    }
    if ($Shortcut.Arguments) { [pscustomobject]@{ command = Expand-LegacyShortcutEnvironment ([string]$Shortcut.Arguments) } }
}
function Get-LegacyShortcutFiles([string]$Root, [bool]$Recursive) {
    $rootPath = ConvertTo-LegacyPath $Root
    Assert-LegacyUnlinked $rootPath
    $pending = [Collections.Generic.Queue[string]]::new()
    $pending.Enqueue($rootPath)
    $regularDirectories = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $aliases = @()
    $files = @()
    while ($pending.Count) {
        $directory = $pending.Dequeue()
        Assert-LegacyUnlinked $directory
        [void]$regularDirectories.Add($directory)
        foreach ($child in Get-ChildItem -LiteralPath $directory -Force -ErrorAction Stop) {
            if ($child.Attributes -band [IO.FileAttributes]::ReparsePoint) {
                # Desktop subdirectories are outside the shortcut discovery scope.
                if (-not $Recursive -and $child.PSIsContainer) { continue }
                if (-not $child.PSIsContainer -or $child.LinkType -cne 'Junction') { throw "Unknown shortcut-tree link: $($child.FullName)" }
                $targets = @($child.Target)
                if ($targets.Count -ne 1 -or -not $targets[0]) { throw "Uncertain shortcut alias: $($child.FullName)" }
                $target = ConvertTo-LegacyPath $targets[0]
                if ($target -ieq $rootPath -or -not (Test-LegacyWithin $target $rootPath)) { throw "External shortcut alias: $($child.FullName)" }
                $aliases += @{ path = $child.FullName; target = $target }
                continue
            }
            if ($child.PSIsContainer) {
                if ($Recursive) { $pending.Enqueue($child.FullName) }
            } elseif ($child.Extension -ieq '.lnk') { $files += $child }
        }
    }
    foreach ($alias in $aliases) {
        # Only a duplicate alias of an independently visited regular directory is
        # safe. Never traverse the junction itself, even for a localized alias.
        if (-not $regularDirectories.Contains($alias.target)) { throw "Shortcut alias lacks independently inspected target: $($alias.path)" }
        Assert-LegacyUnlinked $alias.target
    }
    $files
}
function Get-LegacyShortcutReferences {
    $shell = New-Object -ComObject WScript.Shell -ErrorAction Stop
    try {
        $roots = @(@{path=[Environment]::GetFolderPath('Desktop');recursive=$false}, @{path=[Environment]::GetFolderPath('CommonDesktopDirectory');recursive=$false}, @{path=[Environment]::GetFolderPath('StartMenu');recursive=$true}, @{path=[Environment]::GetFolderPath('CommonStartMenu');recursive=$true})
        foreach ($entry in $roots) {
            $root = $entry.path
            if (-not $root) { throw 'Shortcut directory inspection unavailable.' }
            if (-not (Test-Path -LiteralPath $root)) { continue }
            foreach ($file in Get-LegacyShortcutFiles $root $entry.recursive) {
                Assert-LegacyUnlinked $file.FullName
                $shortcut = $shell.CreateShortcut($file.FullName)
                Get-LegacyShortcutPaths $shortcut $ProjectRoot
            }
        }
    } finally { if ($shell) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($shell) } }
}
function Get-LegacyInstalledReferences([string]$Directory) {
    $directoryPath = ConvertTo-LegacyPath $Directory
    $registry = Read-LegacyJson (Join-Path $directoryPath 'extensions.json')
    if ($registry -isnot [array]) { throw 'Installed extension registry is not an array.' }
    foreach ($extension in $registry) {
        if (-not $extension.identifier.id) { throw 'Installed extension registry contains an uncertain identity.' }
        if ($extension.identifier.id -notin @('azrael-ex-local.azrael', 'azrael-ex-local.azrael-ex')) { continue }
        $location = $extension.location.fsPath
        if (-not $location) { $location = $extension.location.path; if ($location -match '^/[A-Za-z]:/') { $location = $location.Substring(1) } }
        if (-not $location -and $extension.relativeLocation) { $location = Join-Path $directoryPath $extension.relativeLocation }
        $location = ConvertTo-LegacyPath $location
        $location
        $runtime = Read-LegacyJson (Join-Path $location 'out/azrael-runtime.json')
        $references = @(Get-LegacyAbsoluteReferences $runtime)
        if ($runtime -isnot [System.Collections.IDictionary] -or -not $references.Count) { throw 'Installed extension runtime references are uncertain.' }
        $references
    }
}
function Get-LegacyOwnership([string]$Path, [string]$Kind) {
    if ($Kind -eq 'release') {
        $receipt = Join-Path $Path 'build-info.json'
        $data = Read-LegacyJson $receipt
        if ($data.product -cne 'azrael-ex' -or -not $data.packageVersion -or -not $data.sha256) { throw 'Unknown release ownership.' }
        return @{ kind = $Kind; receipt = $receipt; receiptSha256 = (Get-FileHash -LiteralPath $receipt -Algorithm SHA256).Hash; product = $data.product; version = $data.packageVersion; binaryHashes = $data.sha256 }
    }
    $files = @(Get-ChildItem -LiteralPath $Path -File -Force -ErrorAction Stop)
    if (-not $files.Count -or @($files | Where-Object Extension -ine '.vsix').Count -or @(Get-ChildItem -LiteralPath $Path -Directory -Force).Count) { throw 'Unknown VSIX directory ownership.' }
    $packages = @()
    foreach ($file in $files) {
        $zip = [IO.Compression.ZipFile]::OpenRead($file.FullName)
        try {
            $entry = $zip.GetEntry('extension/package.json')
            if (-not $entry -or $entry.Length -gt 2MB) { throw 'Missing compact VSIX identity.' }
            $reader = [IO.StreamReader]::new($entry.Open())
            try { $manifest = $reader.ReadToEnd() | ConvertFrom-Json -AsHashtable } finally { $reader.Dispose() }
            if ($manifest.publisher -cne 'azrael-ex-local' -or $manifest.name -cnotin @('azrael', 'azrael-ex') -or -not $manifest.version) { throw 'Unknown VSIX publisher/package.' }
            $packages += @{ file = $file.Name; version = $manifest.version; sha256 = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash }
        } finally { $zip.Dispose() }
    }
    @{ kind = $Kind; packages = $packages }
}
function Invoke-LegacyReleaseCleanup {
    $report = [ordered]@{ schema = 1; generatedAt = [DateTime]::UtcNow.ToString('o'); apply = [bool]$Apply; status = 'preview'; projectRoot = $null; protectedPaths = @(); candidates = @(); errors = @() }
    try {
        $project = ConvertTo-LegacyPath $ProjectRoot
        $report.projectRoot = $project
        Assert-LegacyUnlinked $project
        $logs = Join-Path $project 'artifacts/logs/legacy-release-cleanup'
        Assert-LegacyUnlinked $logs
        if (-not $ReportPath) { $ReportPath = Join-Path $logs ('cleanup-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfff') + '-' + [guid]::NewGuid().ToString('N') + '.json') }
        $ReportPath = ConvertTo-LegacyPath $ReportPath
        if (-not (Test-LegacyWithin $ReportPath $logs)) { throw 'ReportPath must be within artifacts/logs/legacy-release-cleanup.' }
        Assert-LegacyUnlinked $ReportPath
        $protected = @($ProtectedPaths | ForEach-Object { ConvertTo-LegacyPath $_ })
        $latest = Join-Path $project 'artifacts/latest.json'
        if (Test-Path -LiteralPath $latest) {
            $selection = Read-LegacyJson $latest
            if (-not $selection.releaseDirectory) { throw 'Latest release selection is invalid.' }
            $protected += @(Get-LegacyAbsoluteReferences $selection)
        }
        $deployments = Join-Path $project 'artifacts/deployments'
        Assert-LegacyUnlinked $deployments
        $installed = @()
        if (Test-Path -LiteralPath $deployments) {
            foreach ($dir in Get-ChildItem -LiteralPath $deployments -Directory -Force -ErrorAction Stop) {
                Assert-LegacyUnlinked $dir.FullName
                $receipt = Join-Path $dir.FullName 'deployment.json'
                if (-not (Test-Path -LiteralPath $receipt)) { continue }
                $data = Read-LegacyJson $receipt
                if ($data.hostInstalled -eq $true) {
                    if ($data.status -cne 'installed-reload-required' -or -not $data.releaseDirectory -or -not $data.generatedAt) { throw "Uncertain installed deployment: $receipt" }
                    $installed += @{ data = $data; release = ConvertTo-LegacyPath $data.releaseDirectory; time = [DateTimeOffset]::Parse($data.generatedAt) }
                }
            }
        }
        $seen = @()
        foreach ($item in @($installed | Sort-Object time -Descending)) {
            if ($item.release -in $seen) { continue }
            $seen += $item.release
            # Do not protect generic workspace/state roots; only package/runtime references.
            foreach ($key in @($item.data.Keys | Where-Object { $_ -match '(?i)release|package|host|companion|vsix|sourceExtensionPath' })) {
                if ($item.data[$key]) { $protected += @(Get-LegacyAbsoluteReferences $item.data[$key]) }
            }
            if ($seen.Count -eq 2) { break }
        }
        $protected += @(Get-LegacyInstalledReferences $ExtensionsDirectory)
        # Packaging stages share their immediate release name. Preserve those inputs
        # whenever a selected/installed release is protected, even after VSIX copying.
        $releaseRoot = Join-Path $project 'artifacts/releases'
        foreach ($reference in @($protected)) {
            if (Test-LegacyWithin $reference $releaseRoot) {
                $relative = $reference.Substring($releaseRoot.Length).TrimStart('\')
                if ($relative) { $protected += Join-Path (Join-Path $project 'artifacts/vsix') ($relative.Split('\')[0]) }
            }
        }
        $shortcuts = @(Get-LegacyShortcutReferences)
        $protected += @($shortcuts | Where-Object { $_ -is [string] })
        $report.protectedPaths = @($protected | Select-Object -Unique)
        $processes = @(Get-LegacyProcesses)
        foreach ($kind in @('release','vsix')) {
            $root = Join-Path $project $(if ($kind -eq 'release') { 'artifacts/releases' } else { 'artifacts/vsix' })
            Assert-LegacyUnlinked $root
            if (-not (Test-Path -LiteralPath $root)) { continue }
            foreach ($dir in Get-ChildItem -LiteralPath $root -Directory -Force -ErrorAction Stop) {
                $target = ConvertTo-LegacyPath $dir.FullName
                $row = [ordered]@{ path = $target; kind = $kind; status = 'preserved'; reason = $null; identity = $null; absent = $false }
                $report.candidates += $row
                try {
                    if ([IO.Path]::GetDirectoryName($target) -ine $root -or -not (Test-LegacyWithin $target $root)) { throw 'Candidate containment failed.' }
                    Assert-LegacyUnlinked $target
                    foreach ($reference in $protected) {
                        if ((Test-LegacyWithin $target $reference) -or (Test-LegacyWithin $reference $target)) { throw "Protected reference: $reference" }
                    }
                    foreach ($shortcut in $shortcuts) {
                        if ($shortcut -isnot [string] -and $shortcut.command.Replace('/', '\').IndexOf($target, [StringComparison]::OrdinalIgnoreCase) -ge 0) { throw 'Shortcut argument reference.' }
                    }
                    $reason = Get-LegacyProcessReason $target $processes
                    if ($reason) { throw $reason }
                    Assert-LegacyUnlinked $target -Recursive
                    $row.identity = Get-LegacyOwnership $target $kind
                    $row.status = 'selected'
                    if ($Apply) {
                        Assert-LegacyUnlinked $target -Recursive
                        # Save compact identities before deletion. No binaries or user data copied.
                        New-Item -ItemType Directory -Path $logs -Force | Out-Null
                        $report | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $ReportPath -Encoding utf8NoBOM
                        $reason = Get-LegacyProcessReason $target @(Get-LegacyProcesses)
                        if ($reason) { throw $reason }
                        Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction Stop
                        $row.absent = -not (Test-Path -LiteralPath $target -ErrorAction Stop)
                        if (-not $row.absent) { throw 'Deletion returned but candidate still exists.' }
                        $row.status = 'deleted'
                    }
                } catch { $row.status = 'preserved'; $row.reason = $_.Exception.Message }
            }
        }
        if ($Apply) { $report.status = 'applied' }
    } catch { $report.status = 'blocked'; $report.errors += $_.Exception.Message }
    if ($report.projectRoot -and $ReportPath -and $report.status -ne 'blocked') {
        Assert-LegacyUnlinked $ReportPath
        New-Item -ItemType Directory -Path (Split-Path $ReportPath -Parent) -Force | Out-Null
        $report | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $ReportPath -Encoding utf8NoBOM
    }
    [pscustomobject]$report
}
if ($MyInvocation.InvocationName -ne '.') { Invoke-LegacyReleaseCleanup }
