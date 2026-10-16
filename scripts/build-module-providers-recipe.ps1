function Get-ProviderAccountsSourceFingerprint {
    $providerRoot = Join-Path $projectRoot 'providers/opencodex'
    $files = @(
        Get-ChildItem -LiteralPath $providerRoot -File | Where-Object Extension -In '.ts', '.mjs'
        Get-Item -LiteralPath (Join-Path $providerRoot 'package.json'), (Join-Path $providerRoot 'bun.lock'), (Join-Path $providerRoot 'LICENSE.opencodex'), (Join-Path $providerRoot 'UPSTREAM.md'), (Join-Path $providerRoot 'vendor-source-manifest.json')
        Get-Item -LiteralPath (Join-Path $PSScriptRoot 'provider-vendor-manifest.cjs'), (Join-Path $PSScriptRoot 'freeze-platform-inputs.cjs')
        Get-Item -LiteralPath (Join-Path $projectRoot 'providers/devin/progress.mjs')
        Get-Item -LiteralPath (Join-Path $projectRoot 'providers/devin/stall-diagnostics.mjs')
        Get-Item -LiteralPath (Join-Path $projectRoot 'providers/devin/diagnostic-policy.mjs')
        Get-Item -LiteralPath (Join-Path $projectRoot 'providers/devin/tool-search-history.mjs')
        Get-Item -LiteralPath (Join-Path $projectRoot 'providers/devin/context-budget.mjs')
        Get-ChildItem -LiteralPath (Join-Path $providerRoot 'vendor/src') -File -Recurse
    ) | Sort-Object FullName
    $inventory = foreach ($file in $files) {
        [ordered]@{
            path = [IO.Path]::GetRelativePath($providerRoot, $file.FullName).Replace('\', '/')
            sha256 = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        }
    }
    $json = $inventory | ConvertTo-Json -Compress
    $bytes = [Text.Encoding]::UTF8.GetBytes($json)
    return [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()
}

function Get-ProviderVendorManifestFingerprint {
    param([string]$LogDirectory)
    $vendorRoot = Join-Path $projectRoot 'providers/opencodex/vendor/src'
    return (Invoke-BuildCommand 'node' @((Join-Path $PSScriptRoot 'provider-vendor-manifest.cjs'), $vendorRoot) 'provider-vendor-manifest.log' -CaptureOutput -LogDirectory $LogDirectory).Trim()
}

function Invoke-BuildModuleProvidersRecipe {
    $phase = Start-BuildStage $buildMetrics 'provider-source-and-runtime-checks'
    $providerSource = Join-Path $projectRoot 'providers/opencodex'
    $bunSource = Join-Path $artifactRoot 'tools/bun-1.4.2/package/bin/bun.exe'
    foreach ($required in @(
        (Join-Path $providerSource 'helper.ts'),
        (Join-Path $providerSource 'inference.ts'),
        (Join-Path $providerSource 'vendor/src'),
        (Join-Path $providerSource 'package.json'),
        (Join-Path $providerSource 'bun.lock'),
        (Join-Path $providerSource 'LICENSE.opencodex'),
        (Join-Path $providerSource 'UPSTREAM.md'),
        (Join-Path $projectRoot 'providers/devin/progress.mjs'),
        (Join-Path $projectRoot 'providers/devin/stall-diagnostics.mjs'),
        (Join-Path $projectRoot 'providers/devin/diagnostic-policy.mjs'),
        (Join-Path $projectRoot 'providers/devin/tool-search-history.mjs'),
        (Join-Path $projectRoot 'providers/devin/context-budget.mjs'),
        $bunSource
    )) {
        if (-not (Test-Path -LiteralPath $required)) { throw "Provider accounts build input is missing: $required" }
    }
    $bunVersion = (Invoke-BuildCommand $bunSource @('--version') 'opencodex-bun-version.log' -CaptureOutput -LogDirectory $providerCache.LogDirectory).Trim()
    if ($bunVersion -cne '1.4.2') {
        throw "Provider accounts requires the pinned Bun 1.4.2 runtime; selected runtime reported '$bunVersion'."
    }
    $bunDownloadManifest = Join-Path $artifactRoot 'tools/bun-1.4.2/download.json'
    if (-not (Test-Path -LiteralPath $bunDownloadManifest -PathType Leaf)) { throw 'Pinned Bun download provenance is missing.' }
    $providerSourceBefore = Get-ProviderAccountsSourceFingerprint
    $vendorSourceManifest = Get-ProviderVendorManifestFingerprint -LogDirectory $providerCache.LogDirectory
    $reviewedVendorManifest = Get-Content -LiteralPath (Join-Path $providerSource 'vendor-source-manifest.json') -Raw | ConvertFrom-Json
    if ($vendorSourceManifest -cne $reviewedVendorManifest.reviewedWindowsManifestSha256) {
        throw 'Provider accounts vendor sources do not match the reviewed patched-source manifest.'
    }
    Complete-BuildStage $buildMetrics $phase
    $phase = Start-BuildStage $buildMetrics 'provider-staging'
    $providerStage = Join-Path $providerCache.Path 'staging/opencodex'
    New-Item -ItemType Directory -Path (Join-Path $providerStage 'vendor') -Force | Out-Null
    $progressStage = Join-Path $providerCache.Path 'staging/devin'
    New-Item -ItemType Directory -Path $progressStage -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $projectRoot 'providers/devin/progress.mjs') -Destination $progressStage
    Copy-Item -LiteralPath (Join-Path $projectRoot 'providers/devin/stall-diagnostics.mjs') -Destination $progressStage
    Copy-Item -LiteralPath (Join-Path $projectRoot 'providers/devin/diagnostic-policy.mjs') -Destination $progressStage
    Copy-Item -LiteralPath (Join-Path $projectRoot 'providers/devin/tool-search-history.mjs') -Destination $progressStage
    Copy-Item -LiteralPath (Join-Path $projectRoot 'providers/devin/context-budget.mjs') -Destination $progressStage
    Get-ChildItem -LiteralPath $providerSource -File | Where-Object Extension -In '.ts', '.mjs' | Copy-Item -Destination $providerStage
    Copy-Item -LiteralPath (Join-Path $providerSource 'package.json'), (Join-Path $providerSource 'bun.lock'), (Join-Path $providerSource 'LICENSE.opencodex'), (Join-Path $providerSource 'UPSTREAM.md'), (Join-Path $providerSource 'vendor-source-manifest.json') -Destination $providerStage
    Copy-Item -LiteralPath (Join-Path $providerSource 'vendor/src') -Destination (Join-Path $providerStage 'vendor/src') -Recurse
    Complete-BuildStage $buildMetrics $phase
    Push-Location $providerStage
    try {
        Invoke-BuildCommand $bunSource @('install', '--frozen-lockfile', '--production') 'opencodex-bun-install.log' -LogDirectory $providerCache.LogDirectory
    } finally { Pop-Location }
    $phase = Start-BuildStage $buildMetrics 'provider-native-dependency-checks'
    $keyring = Join-Path $providerStage 'node_modules/@napi-rs/keyring'
    $keyringNative = Join-Path $providerStage 'node_modules/@napi-rs/keyring-win32-x64-msvc'
    foreach ($required in @($keyring, $keyringNative)) {
        if (-not (Test-Path -LiteralPath $required -PathType Container)) { throw "Provider accounts native dependency is missing: $required" }
    }
    Complete-BuildStage $buildMetrics $phase
    $providerDestination = Join-Path $release 'providers/opencodex'
    New-Item -ItemType Directory -Path (Join-Path $providerDestination 'node_modules/@napi-rs') -Force | Out-Null
    Invoke-BuildCommand $bunSource @('build', (Join-Path $providerStage 'helper.ts'), '--target=bun', '--external=@napi-rs/keyring', ('--outfile=' + (Join-Path $providerDestination 'helper.js'))) 'opencodex-helper-bundle.log' -LogDirectory $providerCache.LogDirectory
    Invoke-BuildCommand $bunSource @('build', (Join-Path $providerStage 'inference.ts'), '--target=bun', '--external=@napi-rs/keyring', ('--outfile=' + (Join-Path $providerDestination 'inference.js'))) 'opencodex-inference-bundle.log' -LogDirectory $providerCache.LogDirectory
    $phase = Start-BuildStage $buildMetrics 'provider-release-copy'
    Get-ChildItem -LiteralPath $providerStage -File | Where-Object Extension -In '.ts', '.mjs' | Copy-Item -Destination $providerDestination
    Copy-Item -LiteralPath (Join-Path $providerStage 'package.json'), (Join-Path $providerStage 'bun.lock'), (Join-Path $providerStage 'LICENSE.opencodex'), (Join-Path $providerStage 'UPSTREAM.md'), (Join-Path $providerStage 'vendor-source-manifest.json') -Destination $providerDestination
    Copy-Item -LiteralPath $keyring -Destination (Join-Path $providerDestination 'node_modules/@napi-rs/keyring') -Recurse
    Copy-Item -LiteralPath $keyringNative -Destination (Join-Path $providerDestination 'node_modules/@napi-rs/keyring-win32-x64-msvc') -Recurse
    $runtimeDirectory = Join-Path $providerDestination 'runtime'
    New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null
    Copy-Item -LiteralPath $bunSource -Destination (Join-Path $runtimeDirectory 'bun.exe')
    Complete-BuildStage $buildMetrics $phase
    $phase = Start-BuildStage $buildMetrics 'provider-source-stability-and-hash-checks'
    if ((Get-ProviderAccountsSourceFingerprint) -cne $providerSourceBefore) {
        throw 'Provider accounts source changed during packaging. Retry with stable sources.'
    }
    $providerFiles = [ordered]@{}
    foreach ($file in Get-ChildItem -LiteralPath $providerDestination -File -Recurse | Sort-Object FullName) {
        $relative = [IO.Path]::GetRelativePath($release, $file.FullName).Replace('\', '/')
        $providerFiles[$relative] = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    }
    $helperRelative = 'providers/opencodex/helper.js'
    $inferenceRelative = 'providers/opencodex/inference.js'
    $bunRelative = 'providers/opencodex/runtime/bun.exe'
    [ordered]@{
        schema = 2
        upstreamRevision = '9f7397ed1582d95c6c1fcf4ae9951213b3fa2d19'
        upstreamSourceTree = 'fbdc3ee52e3ecde4fa5e4a5cf630ccae98a73698'
        vendorSourceManifestSha256 = $vendorSourceManifest
        sourceSha256 = $providerSourceBefore
        helper = $helperRelative
        inferenceHelper = $inferenceRelative
        bun = [ordered]@{
            path = $bunRelative
            version = $bunVersion
            sha256 = $providerFiles[$bunRelative]
            bundled = $true
            npmPackage = '@oven/bun-windows-x64@1.4.2'
            npmIntegrity = 'sha512-+bN6OuVld/9diT/RLSXSW7JE6CvNE3gL9XsAEjULi1nUsXd6DNO6GuA9jNdNb3r8PdJFnYHr5aypNV1Oj3Rd9g=='
            downloadManifestSha256 = (Get-FileHash -LiteralPath $bunDownloadManifest -Algorithm SHA256).Hash.ToLowerInvariant()
        }
        files = $providerFiles
    } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $release 'opencodex-accounts-build.json') -Encoding utf8NoBOM
    Complete-BuildStage $buildMetrics $phase
    $cacheOutput=Join-Path $providerCache.Path 'output'
    New-Item -ItemType Directory (Join-Path $cacheOutput 'providers') -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $release 'providers/opencodex') -Destination (Join-Path $cacheOutput 'providers/opencodex') -Recurse
    Copy-Item -LiteralPath (Join-Path $release 'opencodex-accounts-build.json') -Destination $cacheOutput
    Save-BuildModuleEntry $providerCache @('output')
}
