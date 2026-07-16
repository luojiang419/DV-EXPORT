#Requires -Version 5.1
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$SessionScript = Join-Path $ProjectRoot "plugin-runtime\updater\update-session.ps1"
$TestRoot = Join-Path $env:TEMP ("DV-EXPORT-update-session-test-中文 空格-" + [Guid]::NewGuid().ToString("N"))

function New-TestArchive([string]$Root, [bool]$ShouldSucceed) {
  $source = Join-Path $Root "source"
  $archive = Join-Path $Root "update.zip"
  New-Item -ItemType Directory -Path $source -Force | Out-Null
  $exitCode = if ($ShouldSucceed) { 0 } else { 37 }
  $installer = @"
param([string]`$InstallRoot, [switch]`$Force)
if ($exitCode -ne 0) { exit $exitCode }
`$target = Join-Path `$InstallRoot 'com.dvexport.batch-export'
New-Item -ItemType Directory -Path `$target -Force | Out-Null
'{"version":"0.1.28"}' | Set-Content -LiteralPath (Join-Path `$target 'package.json') -Encoding UTF8
exit 0
"@
  Set-Content -LiteralPath (Join-Path $source "install-windows.ps1") -Value $installer -Encoding UTF8
  Compress-Archive -LiteralPath (Join-Path $source "install-windows.ps1") -DestinationPath $archive -Force
  return $archive
}

function Invoke-TestSession([string]$CaseName, [bool]$ShouldSucceed) {
  $caseRoot = Join-Path $TestRoot $CaseName
  $installRoot = Join-Path $caseRoot "Resolve 插件目录"
  $sessionRoot = Join-Path $caseRoot "session"
  $logPath = Join-Path $caseRoot "logs\update.log"
  $resultPath = Join-Path $sessionRoot "result.json"
  New-Item -ItemType Directory -Path $sessionRoot -Force | Out-Null
  $archive = New-TestArchive $caseRoot $ShouldSucceed
  $restartArguments = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("[]"))

  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $SessionScript `
    -OldPid 2147483647 `
    -ArchivePath $archive `
    -ExpectedVersion "0.1.28" `
    -InstallRoot $installRoot `
    -RestartExecutable (Join-Path $caseRoot "does-not-exist.exe") `
    -RestartArgumentsBase64 $restartArguments `
    -LogPath $logPath `
    -ResultPath $resultPath
  $actualExitCode = $LASTEXITCODE
  $result = Get-Content -LiteralPath $resultPath -Raw | ConvertFrom-Json

  if ($ShouldSucceed) {
    if ($actualExitCode -ne 0 -or -not $result.success) {
      throw "Successful update session failed: exit=$actualExitCode result=$($result | ConvertTo-Json -Compress)"
    }
    $installed = Get-Content -LiteralPath (Join-Path $installRoot "com.dvexport.batch-export\package.json") -Raw | ConvertFrom-Json
    if ($installed.version -ne "0.1.28") {
      throw "Installed version mismatch in integration test."
    }
  } else {
    if ($actualExitCode -eq 0 -or $result.success) {
      throw "Failing update session unexpectedly succeeded."
    }
    if ($result.message -notmatch "37") {
      throw "Failing update session did not preserve the installer exit code."
    }
  }
}

try {
  New-Item -ItemType Directory -Path $TestRoot -Force | Out-Null
  Invoke-TestSession "success case" $true
  Invoke-TestSession "failure case" $false
  Write-Host "update-session integration test passed"
} finally {
  $resolvedTemp = [System.IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') + '\'
  $resolvedTestRoot = [System.IO.Path]::GetFullPath($TestRoot)
  if ($resolvedTestRoot.StartsWith($resolvedTemp, [StringComparison]::OrdinalIgnoreCase)) {
    Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}
