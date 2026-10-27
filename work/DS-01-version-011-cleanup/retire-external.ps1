$ErrorActionPreference = 'Stop'
$reportRoot = Join-Path $PSScriptRoot 'reports'
$codeCli = Join-Path $env:LOCALAPPDATA 'Programs/Microsoft VS Code/bin/code.cmd'
$entries = @()
foreach ($fixtureRoot in @('C:/Users/felre/av17', 'C:/Users/felre/av18')) {
    $extensions = Join-Path $fixtureRoot 'artifacts/f/extensions'
    $registry = Join-Path $extensions 'extensions.json'
    $before = Get-Content -LiteralPath $registry -Raw -Encoding utf8 | ConvertFrom-Json
    $azrael = @($before | Where-Object { $_.identifier.id -eq 'azrael-ex-local.azrael' })
    if ($azrael.Count -ne 1 -or $azrael[0].version -ne '2026.0.10') { throw "Unexpected registration: $fixtureRoot" }
    $active = @(Get-CimInstance Win32_Process | Where-Object {
        $_.ExecutablePath -like "$fixtureRoot/*" -or
        (($_.Name -match '^(Code|azrael|codex|bun|node)') -and ($_.CommandLine -like "*$fixtureRoot/*" -or $_.CommandLine -like "*$($fixtureRoot.Replace('/', '\'))\*"))
    })
    if ($active.Count) { throw "Active external profile: $fixtureRoot" }
    $label = Split-Path $fixtureRoot -Leaf
    $before | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (Join-Path $reportRoot "$label-registration-before.json") -Encoding utf8
    $output = @(& $codeCli --user-data-dir (Join-Path $fixtureRoot 'artifacts/f/user-data') --extensions-dir $extensions --uninstall-extension azrael-ex-local.azrael 2>&1)
    $exitCode = $LASTEXITCODE
    $output | Set-Content -LiteralPath (Join-Path $reportRoot "$label-uninstall.log") -Encoding utf8
    $after = Get-Content -LiteralPath $registry -Raw -Encoding utf8 | ConvertFrom-Json
    $remaining = @($after | Where-Object { $_.identifier.id -eq 'azrael-ex-local.azrael' })
    $otherBefore = @($before | Where-Object { $_.identifier.id -ne 'azrael-ex-local.azrael' } | ForEach-Object { "$($_.identifier.id):$($_.version):$($_.relativeLocation)" } | Sort-Object)
    $otherAfter = @($after | Where-Object { $_.identifier.id -ne 'azrael-ex-local.azrael' } | ForEach-Object { "$($_.identifier.id):$($_.version):$($_.relativeLocation)" } | Sort-Object)
    $preserved = (($otherBefore -join "`n") -ceq ($otherAfter -join "`n"))
    $entry = [ordered]@{ root=$fixtureRoot; exit_code=$exitCode; azrael_registration_absent=($remaining.Count -eq 0); other_registrations_preserved=$preserved; old_extension_path=(Join-Path $extensions $azrael[0].relativeLocation); old_extension_remaining=(Test-Path -LiteralPath (Join-Path $extensions $azrael[0].relativeLocation)) }
    $entries += $entry
    $entries | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $reportRoot 'external-uninstall-results.json') -Encoding utf8
    if ($exitCode -ne 0 -or $remaining.Count -or -not $preserved) { throw "External uninstall verification failed: $fixtureRoot" }
}
$entries | ConvertTo-Json -Depth 10
