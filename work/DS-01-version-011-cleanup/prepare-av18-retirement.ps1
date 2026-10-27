$ErrorActionPreference = 'Stop'
$root = 'C:/Users/felre/av18'
$reportRoot = Join-Path $PSScriptRoot 'reports'
$priorPath = Join-Path (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path 'artifacts/maintenance/session6-cleanup-20261018/result.json'
$prior = Get-Content -LiteralPath $priorPath -Raw -Encoding utf8 | ConvertFrom-Json
if (-not $prior.testProcessTreeEnded -or -not $prior.sessionLogoff.verification.childAbsent) { throw 'Original fixture tree termination evidence is incomplete' }
$allProcesses = @(Get-CimInstance Win32_Process)
$matching = @($allProcesses | Where-Object {
    $_.ExecutablePath -match '^C:[\\/]Users[\\/]felre[\\/]av18[\\/]' -or
    (($_.Name -match '^(Code|azrael|codex|bun|node|WindowUseAppFixture)') -and
      ($_.CommandLine -match 'C:[\\/]Users[\\/]felre[\\/]av18[\\/]' -or
       $_.ExecutablePath -match '[\\/]pi-harness-init[\\/]artifacts[\\/]build[\\/]u(18|19|20|21|22)'))
})
if ($matching.Count) { throw 'External fixture or linked old runtime is still active' }
$registry = Get-Content "$root/artifacts/f/extensions/extensions.json" -Raw -Encoding utf8 | ConvertFrom-Json
if (@($registry | Where-Object {$_.identifier.id -eq 'azrael-ex-local.azrael'}).Count) { throw 'External registration reappeared' }
Copy-Item -LiteralPath $priorPath -Destination (Join-Path $reportRoot 'av18-original-tree-terminal.json')
Copy-Item -LiteralPath "$root/artifacts/f/check-result.json" -Destination (Join-Path $reportRoot 'av18-host-check-preserved.json')
$evidence = [ordered]@{
    schema=1; root=$root; owner='CF-01-window-use-admin-setup'; id='run:window-use-u18-isolated';
    user_authorized_full_fixture_retirement=$true; original_lifecycle_state='pending'; original_outcome='unknown';
    original_state_preserved=$true; verified_at_utc=[DateTime]::UtcNow.ToString('o');
    historical_fixture_tree_ended=$prior.testProcessTreeEnded; historical_child_session_absent=$prior.sessionLogoff.verification.childAbsent;
    original_tree_terminal_evidence='av18-original-tree-terminal.json'; current_owned_process_matches=$matching.Count;
    process_scope='All current CIM executable and command-line identities for av18, fixture Code/helpers and linked u18-u22 runtime images; historical full tree termination receipt preserved';
    current_external_registration_absent=$true; generation_basis='owner.json explicitly planned absent isolated fixture artifacts/f; exact host six-stage check-result.json';
    references=@(); members=@('C:/Users/felre/av18/artifacts/f')
}
$evidence | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $reportRoot 'av18-retirement-evidence.json') -Encoding utf8
Copy-Item -LiteralPath (Join-Path $reportRoot 'av18-retirement-evidence.json') -Destination "$root/artifacts/maintenance/retirement-evidence-ds01.json"
$evidence | ConvertTo-Json -Depth 10
