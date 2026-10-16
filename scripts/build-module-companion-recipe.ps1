function Get-BuildCompanionToolInputs {
    $node=(Get-Command node -CommandType Application -ErrorAction Stop).Source
    $npm=(Get-Command npm.cmd -CommandType Application -ErrorAction Stop).Source
    # npm's standard Windows shim invokes this installed CLI tree. Require the
    # actual implementation; a version string or shim alone is insufficient.
    $npmRoot=Join-Path (Split-Path $npm -Parent) 'node_modules/npm'
    if(-not(Test-Path -LiteralPath (Join-Path $npmRoot 'bin/npm-cli.js') -PathType Leaf)){throw 'Cannot establish npm CLI implementation identity.'}
    $runtimeInputs=@($node,$npm)
    $siblingNode=Join-Path (Split-Path $npm -Parent) 'node.exe'
    if(Test-Path -LiteralPath $siblingNode -PathType Leaf){$runtimeInputs+=,$siblingNode}
    @($runtimeInputs | Sort-Object -Unique)+@(Get-BuildModuleFiles $npmRoot $npmRoot | Sort-Object FullName | ForEach-Object FullName)
}
function Invoke-BuildModuleCompanionRecipe {
    $vsixDirectory = $companionCache.Path
    New-Item -ItemType Directory -Path $vsixDirectory -Force | Out-Null
    $CompanionVsixPath = Join-Path $vsixDirectory 'azrael-ex.vsix'
    # A running extension/test host can retain node-pty's native DLL. Build from
    # a fresh source copy so npm ci never removes modules used by that host.
    $companionSource = Join-Path $projectRoot 'extensions/azrael-ex'
    $companionBuild = Join-Path $companionCache.Path 'companion'
    New-Item -ItemType Directory -Path $companionBuild -Force | Out-Null
    Invoke-BuildCommand 'robocopy.exe' @($companionSource, $companionBuild, '/E', '/COPY:DAT', '/DCOPY:DAT', '/R:1', '/W:1', '/XD', 'node_modules', 'dist', 'artifacts', '.git', '/NFL', '/NDL', '/NJH', '/NJS', '/NP') 'companion-stage.log' -MaximumSuccessExitCode 7 -LogDirectory $companionCache.LogDirectory
    $global:LASTEXITCODE = 0
    Complete-BuildStage $buildMetrics $phase
    $phase = Start-BuildStage $buildMetrics 'companion-build'
    Push-Location $companionBuild
    $previousPlatformRuntimeSource = $env:AZRAEL_PLATFORM_RUNTIME_SOURCE
    try {
        Invoke-BuildCommand 'npm.cmd' @('ci') 'npm-ci.log' -LogDirectory $companionCache.LogDirectory
        $env:AZRAEL_PLATFORM_RUNTIME_SOURCE = $PSScriptRoot
        Invoke-BuildCommand 'npm.cmd' @('run', 'package', '--', $CompanionVsixPath) 'companion-package.log' -LogDirectory $companionCache.LogDirectory
    } finally {
        $env:AZRAEL_PLATFORM_RUNTIME_SOURCE = $previousPlatformRuntimeSource
        Pop-Location
    }
    Save-BuildModuleEntry $companionCache @('azrael-ex.vsix','companion/node_modules','companion/dist')
}
