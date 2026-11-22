param(
    [string]$HostName = '64.90.17.178',
    [int]$SshPort = 419,
    [string]$UserName = 'root',
    [string]$KeyPath,
    [string]$Domain = 'dv.ee2x.cn',
    [string]$RemoteSiteRoot = '/opt/1panel/www/sites/dv.ee2x.cn',
    [string]$RemoteBackendRoot = '/opt/ee2x/dv_export_support_site',
    [string]$ServiceName = 'dv-export-support-site.service',
    [string]$ActiveNginxConfig = '/opt/1panel/www/conf.d/dv.ee2x.cn.conf',
    [int]$PortStart = 3213,
    [int]$PortEnd = 3299
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectRoot = [System.IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
$siteRoot = Join-Path $projectRoot 'build\website'
$backendRoot = Join-Path $projectRoot 'website-backend'
$remoteScriptSource = Join-Path $PSScriptRoot 'deploy-dv-export-server-remote.sh'
$nginxTemplateSource = Join-Path $PSScriptRoot 'dv.ee2x.cn.conf'
$secretEnvSource = Join-Path $backendRoot '.env'
if ([string]::IsNullOrWhiteSpace($KeyPath)) {
    $keyFolderName = -join ([char]0x516C, [char]0x94A5)
    $KeyPath = Join-Path (Join-Path 'G:\data\app\pond5_clip_manager' $keyFolderName) 'id_ed25519_1panel'
}
$KeyPath = [System.IO.Path]::GetFullPath($KeyPath)
$packageJson = Get-Content -Raw -LiteralPath (Join-Path $projectRoot 'package.json') -Encoding UTF8 | ConvertFrom-Json
$installerName = "DV-EXPORT-v$($packageJson.version)-setup.exe"

$required = @(
    (Join-Path $siteRoot 'index.html'),
    (Join-Path $siteRoot 'sponsors.html'),
    (Join-Path $siteRoot 'sponsors-admin.html'),
    (Join-Path $siteRoot 'demo\index.html'),
    (Join-Path $siteRoot "downloads\$installerName"),
    (Join-Path $backendRoot 'app\main.py'),
    (Join-Path $backendRoot 'requirements.txt'),
    $secretEnvSource,
    $remoteScriptSource,
    $nginxTemplateSource,
    $KeyPath
)
foreach ($path in $required) {
    if (-not (Test-Path -LiteralPath $path)) {
        throw "Required deployment file is missing: $path"
    }
}
if ($PortStart -lt 1024 -or $PortEnd -gt 65535 -or $PortStart -gt $PortEnd) {
    throw "Invalid port range: $PortStart-$PortEnd"
}
$adminToken = Get-Content -LiteralPath $secretEnvSource -Encoding UTF8 |
    Where-Object { $_ -match '^DV_EXPORT_SPONSOR_ADMIN_TOKEN=(.+)$' } |
    Select-Object -First 1
if (-not $adminToken) {
    throw 'website-backend/.env does not contain an admin token'
}

$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$tempRoot = Join-Path $env:TEMP "dv-export-site-deploy-$stamp"
$tempKey = Join-Path $tempRoot 'id_ed25519_1panel'
$siteArchive = Join-Path $tempRoot 'dv-export-site.tar.gz'
$backendArchive = Join-Path $tempRoot 'dv-export-support-backend.tar.gz'
$remotePrefix = "/tmp/dv-export-site-$stamp"
$remoteSiteArchive = "$remotePrefix-site.tar.gz"
$remoteBackendArchive = "$remotePrefix-backend.tar.gz"
$remoteSecretEnv = "$remotePrefix-secret.env"
$remoteScript = "$remotePrefix-deploy.sh"
$remoteNginxTemplate = "$remotePrefix-nginx.conf"

New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
Copy-Item -LiteralPath $KeyPath -Destination $tempKey -Force
icacls $tempKey /inheritance:r | Out-Null
icacls $tempKey /grant:r "$($env:USERNAME):(R)" | Out-Null

$sshArgs = @(
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=15',
    '-o', 'StrictHostKeyChecking=accept-new',
    '-p', "$SshPort",
    '-i', $tempKey,
    "$UserName@$HostName"
)
$scpArgs = @(
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=15',
    '-o', 'StrictHostKeyChecking=accept-new',
    '-P', "$SshPort",
    '-i', $tempKey
)

try {
    & tar.exe -czf $siteArchive -C $siteRoot .
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to create site archive. Exit code: $LASTEXITCODE"
    }

    & tar.exe -czf $backendArchive `
        '--exclude=./.env' `
        '--exclude=./.venv' `
        '--exclude=./.pytest_cache' `
        '--exclude=./db' `
        '--exclude=__pycache__' `
        '--exclude=*.pyc' `
        -C $backendRoot .
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to create backend archive. Exit code: $LASTEXITCODE"
    }

    & scp.exe @scpArgs $siteArchive "$UserName@$HostName`:$remoteSiteArchive"
    if ($LASTEXITCODE -ne 0) { throw "Failed to upload site archive. Exit code: $LASTEXITCODE" }
    & scp.exe @scpArgs $backendArchive "$UserName@$HostName`:$remoteBackendArchive"
    if ($LASTEXITCODE -ne 0) { throw "Failed to upload backend archive. Exit code: $LASTEXITCODE" }
    & scp.exe @scpArgs $secretEnvSource "$UserName@$HostName`:$remoteSecretEnv"
    if ($LASTEXITCODE -ne 0) { throw "Failed to upload the secret environment file. Exit code: $LASTEXITCODE" }
    & scp.exe @scpArgs $remoteScriptSource "$UserName@$HostName`:$remoteScript"
    if ($LASTEXITCODE -ne 0) { throw "Failed to upload the remote deployment script. Exit code: $LASTEXITCODE" }
    & scp.exe @scpArgs $nginxTemplateSource "$UserName@$HostName`:$remoteNginxTemplate"
    if ($LASTEXITCODE -ne 0) { throw "Failed to upload the Nginx template. Exit code: $LASTEXITCODE" }

    $remoteCommand = @(
        'bash',
        $remoteScript,
        $remoteSiteArchive,
        $remoteBackendArchive,
        $remoteSecretEnv,
        $remoteNginxTemplate,
        $RemoteSiteRoot,
        $RemoteBackendRoot,
        $ServiceName,
        $ActiveNginxConfig,
        $Domain,
        "$PortStart",
        "$PortEnd",
        $installerName
    ) -join ' '

    & ssh.exe @sshArgs $remoteCommand
    if ($LASTEXITCODE -ne 0) {
        throw "Remote DV EXPORT deployment failed. Exit code: $LASTEXITCODE"
    }
}
finally {
    if (Test-Path -LiteralPath $tempKey) {
        icacls $tempKey /grant:r "$($env:USERNAME):(F)" | Out-Null
    }
    $resolvedTemp = [System.IO.Path]::GetFullPath($tempRoot)
    $systemTemp = [System.IO.Path]::GetFullPath($env:TEMP)
    if ($resolvedTemp.StartsWith($systemTemp, [System.StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $resolvedTemp)) {
        Remove-Item -LiteralPath $resolvedTemp -Recurse -Force
    }
}

Write-Output "DV EXPORT deployment completed: https://$Domain"
