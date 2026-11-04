param([Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference='Stop'
$bootstrapProject=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$bootstrapOutput=[IO.Path]::GetFullPath($OutputDirectory)
$bootstrapAllowed=[IO.Path]::GetFullPath((Join-Path $bootstrapProject 'artifacts/tasks/CF-01-window-use-admin-setup/runs'))
if(-not $bootstrapOutput.StartsWith($bootstrapAllowed+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Fixture must remain in its owned task runs'}
if(Test-Path -LiteralPath $bootstrapOutput){throw 'Use a fresh immutable fixture directory'}
[void][IO.Directory]::CreateDirectory($bootstrapOutput)
$bootstrapReport=[ordered]@{owner='CF-01-window-use-admin-setup';state='running';startedUtc=[DateTime]::UtcNow.ToString('o');productAdmissionVerified=$false;registryWritten=$false;planned=@('ChildSession.cs','test-bootstrap.ps1','windows-child-session.exe','compile.log','self-test.json','fixture.json','journal.json')}
$bootstrapReceipt=Join-Path $bootstrapOutput 'fixture.json'
function Save-BootstrapFixture { $bootstrapReport | ConvertTo-Json -Depth 7 | Set-Content -Encoding UTF8 -LiteralPath $bootstrapReceipt }
Save-BootstrapFixture
$bootstrapJournal=$null
try {
 $bootstrapSource=Join-Path $bootstrapOutput 'ChildSession.cs'
 Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'ChildSession.cs') -Destination $bootstrapSource
 Copy-Item -LiteralPath $PSCommandPath -Destination (Join-Path $bootstrapOutput 'test-bootstrap.ps1')
 $bootstrapReport.sourceSha256=(Get-FileHash -LiteralPath $bootstrapSource -Algorithm SHA256).Hash
 $bootstrapBinary=Join-Path $bootstrapOutput 'windows-child-session.exe'
 $bootstrapCompiler=Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
 & $bootstrapCompiler /nologo /target:exe /platform:x64 /optimize+ "/out:$bootstrapBinary" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll /reference:System.ServiceProcess.dll /reference:Microsoft.CSharp.dll $bootstrapSource *> (Join-Path $bootstrapOutput 'compile.log')
 $bootstrapReport.compileExitCode=$LASTEXITCODE; Save-BootstrapFixture
 if($LASTEXITCODE -ne 0){throw 'C# compilation failed; see compile.log'}
 & $bootstrapBinary --self-test | Set-Content -LiteralPath (Join-Path $bootstrapOutput 'self-test.json') -Encoding UTF8
 $bootstrapReport.selfTestExitCode=$LASTEXITCODE
 if($LASTEXITCODE -ne 0){throw 'Native self-test failed; see self-test.json'}
 $bootstrapAssembly=[Reflection.Assembly]::LoadFile($bootstrapBinary)
 $bootstrapType=$bootstrapAssembly.GetType('ChildSession+BootstrapJournal',$true)
 $bootstrapFlags=[Reflection.BindingFlags]'Static,Instance,Public,NonPublic'
 $bootstrapId=[Guid]::NewGuid().ToString('N')
 $bootstrapRequest=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) ('Azrael\ChildBootstrap\'+$bootstrapId+'.json')
 $bootstrapReport.externalPlannedRequest=$bootstrapRequest; Save-BootstrapFixture
 $bootstrapCommand=$bootstrapType.GetMethod('Command',$bootstrapFlags).Invoke($null,@([string]$bootstrapBinary,[string]$bootstrapId))
 $bootstrapReport.fixtureCommandLength=$bootstrapCommand.Length
 $bootstrapInstalledPath='C:\Users\felre\Desktop\pi-harness-init\artifacts\build\u22c\artifacts\releases\u22c\window-control\child-session\windows-child-session.exe'
 $bootstrapReport.installedLayoutCommandLength=$bootstrapType.GetMethod('Command',$bootstrapFlags).Invoke($null,@([string]$bootstrapInstalledPath,[string]$bootstrapId)).Length
 $bootstrapJournalPath=Join-Path $bootstrapOutput 'journal.json'
 $bootstrapJournal=[Activator]::CreateInstance($bootstrapType,$bootstrapFlags,$null,@([string]$bootstrapJournalPath),$null)
 $bootstrapCreate=$bootstrapType.GetMethod('Create',$bootstrapFlags)
 $bootstrapSecret='a'*64; $bootstrapPipe='azrael-child-'+('b'*64); $bootstrapRunName='Azrael.Child.'+('c'*64)
 $bootstrapCreate.Invoke($bootstrapJournal,@([string]$bootstrapRunName,[string]$bootstrapCommand,[string]$bootstrapPipe,[string]$bootstrapSecret,'bootstrap-fixture',[string]$bootstrapId)) | Out-Null
 $bootstrapOriginal=[IO.File]::ReadAllText($bootstrapRequest)
 if($bootstrapOriginal -cne [IO.File]::ReadAllText($bootstrapJournalPath)){throw 'Request and journal differ'}
 $bootstrapAccess=Get-Acl -LiteralPath $bootstrapRequest
 $bootstrapCurrentSid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
 if(-not $bootstrapAccess.AreAccessRulesProtected -or $bootstrapAccess.GetOwner([Security.Principal.SecurityIdentifier]).Value -cne $bootstrapCurrentSid){throw 'Request permissions were not private'}
 $bootstrapReport.privateRequestVerified=$true
 # A same-session or stale request must fail before entering Worker or connecting to a pipe.
 $bootstrapRejected=$false
 try { $bootstrapType.GetMethod('StartWorker',$bootstrapFlags).Invoke($null,@([string]$bootstrapId)) | Out-Null } catch { $bootstrapRejected=$_.Exception.InnerException.Message -eq 'Bootstrap worker must run in the child session' }
 if(-not $bootstrapRejected){throw 'Same-session bootstrap was not rejected before Worker'}
 $bootstrapReport.sameSessionRejected=$true
 # Changed payload must preserve both files rather than delete unverifiable state.
 [IO.File]::WriteAllText($bootstrapRequest,$bootstrapOriginal+' ',(New-Object Text.UTF8Encoding($false)))
 $bootstrapRestore=$bootstrapType.GetMethod('RestoreCurrent',$bootstrapFlags)
 $bootstrapRejected=$false
 try { $bootstrapRestore.Invoke($bootstrapJournal,@()) | Out-Null } catch { $bootstrapRejected=$_.Exception.InnerException.Message -eq 'Bootstrap launch request changed; preserve journal state' }
 if(-not $bootstrapRejected -or -not (Test-Path -LiteralPath $bootstrapRequest) -or -not (Test-Path -LiteralPath $bootstrapJournalPath)){throw 'Changed request was not preserved'}
 $bootstrapReport.changedRequestPreserved=$true
 [IO.File]::WriteAllText($bootstrapRequest,$bootstrapOriginal,(New-Object Text.UTF8Encoding($false)))
 $bootstrapRestore.Invoke($bootstrapJournal,@()) | Out-Null
 if((Test-Path -LiteralPath $bootstrapRequest) -or (Test-Path -LiteralPath $bootstrapJournalPath)){throw 'Exact request/journal cleanup was not confirmed'}
 $bootstrapReport.exactCleanupVerified=$true
 $bootstrapReport.sourceUnchanged=$bootstrapReport.sourceSha256 -eq (Get-FileHash -LiteralPath (Join-Path $PSScriptRoot 'ChildSession.cs') -Algorithm SHA256).Hash
 if(-not $bootstrapReport.sourceUnchanged){throw 'Source changed during fixture execution'}
 $bootstrapReport.binarySha256=(Get-FileHash -LiteralPath $bootstrapBinary -Algorithm SHA256).Hash
 $bootstrapReport.state='passed'; $bootstrapReport.exitCode=0
} catch {
 $bootstrapReport.state='failed'; $bootstrapReport.error=$_.Exception.Message; $bootstrapReport.exitCode=1
} finally {
 if($bootstrapJournal){$bootstrapJournal.Dispose()}
 $bootstrapReport.completedUtc=[DateTime]::UtcNow.ToString('o'); Save-BootstrapFixture
}
$bootstrapReport | ConvertTo-Json -Depth 7
exit $bootstrapReport.exitCode
