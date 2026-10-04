#requires -Version 7.0
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'window-test-desktop-state.ps1') -DefinitionsOnly
function New-Overlay { @{visible=$true;minimized=$false;className='Chrome_WidgetWin_1';ownerHwnd='0x0';style=-1778384896L;extendedStyle=136314920L;popup=$true;toolWindow=$false} }
function Assert-Protected($Window,[bool]$Expected,[string]$Label) {
    if ((Test-AzraelProtectedWindow -Window $Window) -ne $Expected) { throw "Classifier mismatch: $Label" }
}
$count=0
Assert-Protected (New-Overlay) $false 'exact positive dictionary';$count++
Assert-Protected ([pscustomobject](New-Overlay)) $false 'exact positive object';$count++
foreach($subset in 0..6) {
    $window=New-Overlay;$window.extendedStyle=0L
    if($subset -band 1){$window.extendedStyle=$window.extendedStyle -bor 0x08000000L}
    if($subset -band 2){$window.extendedStyle=$window.extendedStyle -bor 8L}
    if($subset -band 4){$window.extendedStyle=$window.extendedStyle -bor 32L}
    Assert-Protected $window $true "partial flags subset $subset";$count++
}
foreach($key in @('className','ownerHwnd','style','extendedStyle','popup','toolWindow')) {
    $window=New-Overlay;$window.Remove($key)
    Assert-Protected $window $true "missing metadata $key";$count++
}
foreach($case in @('unknown-class','owned','tool','ordinary','malformed-style','malformed-exstyle','popup-style-disagrees','visible-minimized')) {
    $window=New-Overlay
    switch($case) {
        unknown-class {$window.className='Unknown'}
        owned {$window.ownerHwnd='0x1'}
        tool {$window.toolWindow=$true}
        ordinary {$window.popup=$false}
        malformed-style {$window.style='invalid'}
        malformed-exstyle {$window.extendedStyle='invalid'}
        popup-style-disagrees {$window.style=0L}
        visible-minimized {$window.className='Unknown';$window.minimized=$true}
    }
    Assert-Protected $window $true $case;$count++
}
$hidden=New-Overlay;$hidden.visible=$false
Assert-Protected $hidden $false 'hidden recorded but unprotected';$count++
"Protected-window classifier: $count cases passed; no GUI executed."
