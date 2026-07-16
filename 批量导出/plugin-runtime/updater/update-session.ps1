#Requires -Version 5.1
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][int]$OldPid,
  [Parameter(Mandatory = $true)][string]$ArchivePath,
  [Parameter(Mandatory = $true)][string]$ExpectedVersion,
  [Parameter(Mandatory = $true)][string]$InstallRoot,
  [Parameter(Mandatory = $true)][string]$RestartExecutable,
  [Parameter(Mandatory = $true)][string]$RestartArgumentsBase64,
  [Parameter(Mandatory = $true)][string]$LogPath,
  [Parameter(Mandatory = $true)][string]$ResultPath
)

$ErrorActionPreference = "Stop"
$SessionRoot = Join-Path -Path ([System.IO.Path]::GetDirectoryName($ResultPath)) -ChildPath "payload"

function Write-UpdateResult([bool]$Success, [string]$Message) {
  $result = @{
    success = $Success
    version = $ExpectedVersion
    message = $Message
    completedAt = [DateTime]::UtcNow.ToString("o")
  }
  $result | ConvertTo-Json | Set-Content -LiteralPath $ResultPath -Encoding UTF8
}

function Start-PluginAgain {
  if (-not (Test-Path -LiteralPath $RestartExecutable)) {
    return
  }

  $argumentJson = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($RestartArgumentsBase64))
  $restartArguments = @((ConvertFrom-Json -InputObject $argumentJson)) | ForEach-Object {
    $value = [string]$_
    if ($value -match '[\s"]') {
      '"' + ($value -replace '"', '\"') + '"'
    } else {
      $value
    }
  }
  Start-Process -FilePath $RestartExecutable -ArgumentList ($restartArguments -join " ") -WindowStyle Hidden | Out-Null
}

New-Item -ItemType Directory -Path ([System.IO.Path]::GetDirectoryName($LogPath)) -Force | Out-Null
Start-Transcript -LiteralPath $LogPath -Append | Out-Null

try {
  if (-not (Test-Path -LiteralPath $ArchivePath)) {
    throw "Update archive does not exist: $ArchivePath"
  }

  $deadline = [DateTime]::UtcNow.AddSeconds(90)
  while (Get-Process -Id $OldPid -ErrorAction SilentlyContinue) {
    if ([DateTime]::UtcNow -ge $deadline) {
      throw "Timed out waiting for the old plugin process $OldPid to exit."
    }
    Start-Sleep -Milliseconds 300
  }

  Remove-Item -LiteralPath $SessionRoot -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Path $SessionRoot -Force | Out-Null
  Expand-Archive -LiteralPath $ArchivePath -DestinationPath $SessionRoot -Force

  $installer = Join-Path -Path $SessionRoot -ChildPath "install-windows.ps1"
  if (-not (Test-Path -LiteralPath $installer)) {
    throw "Update archive is missing install-windows.ps1."
  }

  $installArguments = @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", ('"' + $installer + '"'),
    "-InstallRoot", ('"' + $InstallRoot + '"'),
    "-Force"
  )
  $installProcess = Start-Process -FilePath "powershell.exe" -ArgumentList ($installArguments -join " ") -Wait -PassThru -WindowStyle Hidden
  if ($installProcess.ExitCode -ne 0) {
    throw "Installer exited with code $($installProcess.ExitCode)."
  }

  $installedPackagePath = Join-Path -Path $InstallRoot -ChildPath "com.dvexport.batch-export\package.json"
  if (-not (Test-Path -LiteralPath $installedPackagePath)) {
    throw "Installed package.json was not found."
  }

  $installedPackage = Get-Content -LiteralPath $installedPackagePath -Raw | ConvertFrom-Json
  if ($installedPackage.version -ne $ExpectedVersion) {
    throw "Installed version mismatch. Expected $ExpectedVersion, got $($installedPackage.version)."
  }

  Write-UpdateResult $true "DV-EXPORT $ExpectedVersion installed successfully."
  Start-PluginAgain
  exit 0
} catch {
  Write-UpdateResult $false $_.Exception.Message
  Start-PluginAgain
  exit 1
} finally {
  Remove-Item -LiteralPath $SessionRoot -Recurse -Force -ErrorAction SilentlyContinue
  Stop-Transcript -ErrorAction SilentlyContinue | Out-Null
}
