[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$HostVsixPath,
    [Parameter(Mandatory)][string]$FixtureRoot,
    [Parameter(Mandatory)][string]$CodePath,
    [Parameter(Mandatory)][string]$EndpointUrl,
    [string]$NodePath = (Get-Command node -ErrorAction Stop).Source,
    [string]$AppName = 'AzraelComputerUseProbe.exe',
    [switch]$SessionOnly,
    [ValidateRange(0,60000)][int]$HoldMs = 0
)
$ErrorActionPreference = 'Stop'
$fixture = [IO.Path]::GetFullPath($FixtureRoot)
$allowed = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../artifacts/verification/computer-use-integration/ui-fixture'))
if (-not $fixture.StartsWith($allowed.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'FixtureRoot must be a NEW child directory of artifacts/verification/computer-use-integration/ui-fixture.' }
if (Test-Path -LiteralPath $fixture) { throw 'FixtureRoot already exists. Choose a new directory; existing fixture data is never overwritten.' }
$vsix = (Resolve-Path -LiteralPath $HostVsixPath).Path
$code = (Resolve-Path -LiteralPath $CodePath).Path
$node = (Resolve-Path -LiteralPath $NodePath).Path
$endpoint = [uri]$EndpointUrl
if ($endpoint.Scheme -cne 'http' -or $endpoint.Host -cne '127.0.0.1' -or $endpoint.UserInfo -or $endpoint.Query -or $endpoint.Fragment) { throw 'EndpointUrl must be a synthetic HTTP endpoint bound to 127.0.0.1.' }
$fixtureScript = Join-Path $PSScriptRoot 'computer-use-ui-fixture.mjs'
$userData = Join-Path $fixture 'user-data'
$extensions = Join-Path $fixture 'extensions'
$state = Join-Path $fixture 'state'
$workspace = Join-Path $fixture 'workspace'
$workspaceFile = Join-Path $fixture 'Azrael Computer Use Acceptance.code-workspace'
foreach ($directory in @($fixture,$userData,$extensions,$state,$workspace,(Join-Path $userData 'User'))) { New-Item -ItemType Directory -Path $directory -Force | Out-Null }
$installLog = Join-Path $fixture 'install.log'
$install = @(& $code --user-data-dir $userData --extensions-dir $extensions --install-extension $vsix --force 2>&1)
$installExit = $LASTEXITCODE
$install | Set-Content -LiteralPath $installLog -Encoding utf8NoBOM
if ($installExit -ne 0) { throw "Fixture-only VSIX installation failed: exit $installExit; $installLog" }
$installed = @(Get-ChildItem -LiteralPath $extensions -Directory | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'package.json') } | Where-Object {
    $package = Get-Content -LiteralPath (Join-Path $_.FullName 'package.json') -Raw | ConvertFrom-Json
    $package.publisher -ceq 'azrael-ex-local' -and $package.name -ceq 'azrael'
})
if ($installed.Count -ne 1) { throw "Expected exactly one Azrael fixture host; found $($installed.Count)" }
$runtimePath = Join-Path $installed[0].FullName 'out/azrael-runtime.json'
$before = Get-Content -LiteralPath $runtimePath -Raw | ConvertFrom-Json -AsHashtable
$beforeHash = (Get-FileHash -LiteralPath $runtimePath -Algorithm SHA256).Hash
$after = [ordered]@{}
foreach ($key in $before.Keys) { $after[$key] = $before[$key] }
$after['codexHome'] = $state
$after | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $runtimePath -Encoding utf8NoBOM
$verified = Get-Content -LiteralPath $runtimePath -Raw | ConvertFrom-Json -AsHashtable
$changed = @($before.Keys | Where-Object { ($before[$_] | ConvertTo-Json -Depth 30 -Compress) -cne ($verified[$_] | ConvertTo-Json -Depth 30 -Compress) })
if ($changed.Count -ne 1 -or $changed[0] -cne 'codexHome' -or $verified.Count -ne $before.Count) { throw 'Fixture runtime override must change codexHome only.' }
$controlFile = Join-Path $fixture 'control.json'
@{ appName = $AppName; displayName = 'Azrael Computer Use Test Fixture'; sessionOnly = [bool]$SessionOnly; holdMs = $HoldMs } | ConvertTo-Json | Set-Content -LiteralPath $controlFile -Encoding utf8NoBOM
@{ OPENAI_API_KEY = 'synthetic-computer-use-fixture-key'; tokens = $null; last_refresh = $null } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $state 'auth.json') -Encoding utf8NoBOM
$jsonString = { param([string]$value) ConvertTo-Json -InputObject $value -Compress }
$mcpLog = Join-Path $fixture 'mcp.jsonl'
$mcpArgs = @($fixtureScript, 'mcp', '--control-file', $controlFile, '--log', $mcpLog) | ForEach-Object { & $jsonString $_ }
$config = @"
model = "computer-use-ui-fixture"
model_provider = "fixture_openai"
cli_auth_credentials_store = "file"
approval_policy = "never"
sandbox_mode = "danger-full-access"
[model_providers.fixture_openai]
name = "Synthetic Computer Use approval fixture"
base_url = $(& $jsonString $EndpointUrl.TrimEnd('/'))
wire_api = "responses"
requires_openai_auth = true
[features]
plugins = false
responses_websockets = false
code_mode = false
[mcp_servers.node_repl]
command = $(& $jsonString $node)
args = [$($mcpArgs -join ', ')]
startup_timeout_sec = 20
tool_timeout_sec = 120
"@
$config | Set-Content -LiteralPath (Join-Path $state 'config.toml') -Encoding utf8NoBOM
@{ 'extensions.autoUpdate' = $false; 'extensions.autoCheckUpdates' = $false; 'update.mode' = 'none'; 'telemetry.telemetryLevel' = 'off'; 'window.title' = 'Azrael Computer Use Acceptance' } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $userData 'User/settings.json') -Encoding utf8NoBOM
@{ folders = @(@{ name = 'Azrael Computer Use Acceptance'; path = $workspace }); settings = @{ 'window.title' = 'Azrael Computer Use Acceptance' } } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $workspaceFile -Encoding utf8NoBOM
'Synthetic Computer Use consent fixture. Open Azrael sidebar and send any fresh prompt to request app consent. No real model, capture, or input occurs. Change control.json between calls for sessionOnly, appName or holdMs.' | Set-Content -LiteralPath (Join-Path $workspace 'README.txt') -Encoding utf8NoBOM
$launchArgs = @('--disable-updates','--user-data-dir',$userData,'--extensions-dir',$extensions,'--new-window','--skip-welcome','--skip-release-notes',$workspaceFile)
$quote = { param([string]$value) "'" + $value.Replace("'", "''") + "'" }
$command = '& ' + (& $quote $code) + ' ' + (($launchArgs | ForEach-Object { & $quote $_ }) -join ' ')
$manifest = [ordered]@{ synthetic = $true; fixtureRoot = $fixture; windowTitle = 'Azrael Computer Use Acceptance'; workspaceFile = $workspaceFile;
    stateRoot = $state; userData = $userData; extensions = $extensions; hostVsix = $vsix; hostVsixSha256 = (Get-FileHash -LiteralPath $vsix -Algorithm SHA256).Hash;
    installedHost = $installed[0].FullName; runtimeConfig = $runtimePath; runtimeConfigBeforeSha256 = $beforeHash; runtimeConfigAfterSha256 = (Get-FileHash -LiteralPath $runtimePath -Algorithm SHA256).Hash;
    runtimeChangedFields = $changed; engineUnchanged = $true; bridgeUnchanged = $true; installExitCode = $installExit; installLog = $installLog;
    controlFile = $controlFile; mcpLog = $mcpLog; endpointUrl = $EndpointUrl; codePath = $code; launchArgs = $launchArgs; launchCommand = $command }
$manifest | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $fixture 'setup.json') -Encoding utf8NoBOM
$command | Set-Content -LiteralPath (Join-Path $fixture 'launch.ps1') -Encoding utf8NoBOM
$manifest | ConvertTo-Json -Depth 10
# Preparation never launches the editor; root owns actual rendered UI acceptance.
