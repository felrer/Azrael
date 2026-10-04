#requires -Version 7.0

function Get-AzraelExtensionBackupPlan {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$ExtensionsDirectory,
        [Parameter(Mandatory)][AllowEmptyCollection()][hashtable[]]$Registry,
        [Parameter(Mandatory)][string[]]$OwnIds,
        [Parameter(Mandatory)][AllowEmptyCollection()][string[]]$Inventory
    )
    $root = [IO.Path]::GetFullPath($ExtensionsDirectory).TrimEnd('\', '/')
    $selected = [Collections.Generic.List[object]]::new()
    $skipped = [Collections.Generic.List[object]]::new()
    $paths = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $ids = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($entry in $Registry) {
        $id = [string]$entry['identifier']['id']
        if ($id -notin $OwnIds) { continue }
        if (-not $ids.Add($id)) { throw "Duplicate registered Azrael extension: $id" }
        $version = [string]$entry['version']
        if ([string]::IsNullOrWhiteSpace($version)) { throw "Registered Azrael version is missing: $id" }
        $relative = [string]$entry['relativeLocation']
        $location = $entry['location']
        $absolute = if ($location) { [string]$location['fsPath'] } else { '' }
        if ($location -and $location['scheme'] -and $location['scheme'] -ne 'file') { throw "Registered Azrael location is not a file path: $id" }
        if ($relative) {
            if ([IO.Path]::IsPathRooted($relative) -or $relative -in @('.', '..') -or $relative.IndexOfAny([char[]]'\/') -ge 0) {
                throw "Registered Azrael relative path is not a direct directory: $id"
            }
            $source = [IO.Path]::GetFullPath((Join-Path $root $relative))
            if ($absolute -and (-not [IO.Path]::IsPathFullyQualified($absolute) -or
                [IO.Path]::GetFullPath($absolute).TrimEnd('\', '/') -ine $source)) {
                throw "Registered Azrael location paths disagree: $id"
            }
        } elseif ($absolute -and [IO.Path]::IsPathFullyQualified($absolute)) {
            $source = [IO.Path]::GetFullPath($absolute).TrimEnd('\', '/')
        } else { throw "Registered Azrael location is missing: $id" }
        if ([IO.Path]::GetDirectoryName($source) -ine $root -or -not $paths.Add($source)) {
            throw "Registered Azrael path is outside the profile or ambiguous: $id"
        }
        $directory = Get-Item -LiteralPath $source -Force -ErrorAction Stop
        if (-not $directory.PSIsContainer -or ($directory.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw "Registered Azrael path must be a directory without redirection: $id"
        }
        $manifest = Get-Content -LiteralPath (Join-Path $source 'package.json') -Raw -ErrorAction Stop | ConvertFrom-Json -AsHashtable
        if ("$($manifest.publisher).$($manifest.name)" -ine $id -or [string]$manifest.version -cne $version) {
            throw "Registered Azrael manifest ID or version mismatch: $id"
        }
        if (@($Inventory | Where-Object { $_ -ieq "$id@$version" }).Count -ne 1) {
            throw "Registered Azrael does not match installed inventory: $id@$version"
        }
        $selected.Add([ordered]@{ id = $id; version = $version; source = $source; name = $directory.Name })
    }
    foreach ($installed in $Inventory) {
        $parts = $installed -split '@', 2
        if ($parts[0] -in $OwnIds -and @($selected | Where-Object { "$($_.id)@$($_.version)" -ieq $installed }).Count -ne 1) {
            throw "Installed Azrael has no matching registration: $installed"
        }
    }
    foreach ($directory in @(Get-ChildItem -LiteralPath $root -Directory -Force -ErrorAction Stop)) {
        if ($paths.Contains($directory.FullName)) { continue }
        if ($directory.Attributes -band [IO.FileAttributes]::ReparsePoint) {
            if (@($OwnIds | Where-Object { $directory.Name.StartsWith($_ + '-', [StringComparison]::OrdinalIgnoreCase) }).Count) {
                $skipped.Add([ordered]@{ source = $directory.FullName; reason = 'unregistered-redirected-directory' })
            }
            continue
        }
        try {
            $manifest = Get-Content -LiteralPath (Join-Path $directory.FullName 'package.json') -Raw -ErrorAction Stop | ConvertFrom-Json -AsHashtable
            $id = "$($manifest.publisher).$($manifest.name)"
            if ($id -in $OwnIds) { $skipped.Add([ordered]@{ id = $id; source = $directory.FullName; reason = 'not-registered' }) }
        } catch {
            if (@($OwnIds | Where-Object { $directory.Name.StartsWith($_ + '-', [StringComparison]::OrdinalIgnoreCase) }).Count) {
                $skipped.Add([ordered]@{ source = $directory.FullName; reason = 'unregistered-invalid-manifest' })
            }
        }
    }
    [pscustomobject]@{ selected = @($selected.ToArray()); skipped = @($skipped.ToArray()) }
}
