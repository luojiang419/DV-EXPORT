import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const distRoot = path.join(projectRoot, "dist");
const installerRoot = path.join(distRoot, "installer");
const sourcePackage = JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf-8"));
const pluginFolderName = "com.dvexport.batch-export";

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    stdio: "inherit"
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function normalizeVersion(baseVersion) {
  const normalized = baseVersion.startsWith("v") ? baseVersion.slice(1) : baseVersion;

  if (!/^\d+\.\d+\.\d+$/.test(normalized)) {
    throw new Error(`package.json version 必须是 X.Y.Z 格式，当前值：${baseVersion}`);
  }

  return normalized;
}

function quotePowerShellLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function zipDirectoryContents(sourceRoot, destinationPath) {
  const archiveCommand = [
    `$items = Get-ChildItem -LiteralPath ${quotePowerShellLiteral(sourceRoot)} -Force`,
    `Compress-Archive -LiteralPath $items.FullName -DestinationPath ${quotePowerShellLiteral(destinationPath)} -CompressionLevel Optimal -Force`
  ].join("; ");
  run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", archiveCommand]);
}

function zipSinglePath(sourcePath, destinationPath) {
  const archiveCommand = [
    `Compress-Archive -LiteralPath ${quotePowerShellLiteral(sourcePath)} -DestinationPath ${quotePowerShellLiteral(destinationPath)} -CompressionLevel Optimal -Force`
  ].join("; ");
  run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", archiveCommand]);
}

function writeHashFile(sourcePath, hashPath) {
  const hash = createHash("sha256").update(readFileSync(sourcePath)).digest("hex").toUpperCase();
  writeFileSync(hashPath, `${hash}  ${path.basename(sourcePath)}\n`, "utf-8");
  return hash;
}

function createPowerShellInstaller(version) {
  return [
    "#Requires -Version 5.1",
    "[CmdletBinding()]",
    "param(",
    '  [string]$InstallRoot = $(if ($env:DVEXPORT_INSTALL_ROOT) { $env:DVEXPORT_INSTALL_ROOT } else { "$env:ProgramData\\Blackmagic Design\\DaVinci Resolve\\Support\\Workflow Integration Plugins" }),',
    "  [switch]$Force",
    ")",
    "",
    '$ErrorActionPreference = "Stop"',
    '$PluginId = "com.dvexport.batch-export"',
    `$PluginVersion = "${version}"`,
    "$PayloadExtractRoot = $null",
    "$StagingDir = $null",
    "$BackupDir = $null",
    "$OldTargetMoved = $false",
    "$InstallSucceeded = $false",
    "",
    "function Test-Admin {",
    "  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()",
    "  $principal = New-Object Security.Principal.WindowsPrincipal($identity)",
    "  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)",
    "}",
    "",
    "function Quote-Argument([string]$Value) {",
    "  return '\"' + ($Value -replace '\"', '\\\"') + '\"'",
    "}",
    "",
    "function Resolve-PluginSource {",
    "  $directSource = Join-Path -Path $PSScriptRoot -ChildPath $PluginId",
    "  if (Test-Path -LiteralPath $directSource) {",
    "    return $directSource",
    "  }",
    "",
    "  $payloadZip = Join-Path -Path $PSScriptRoot -ChildPath 'payload.zip'",
    "  if (-not (Test-Path -LiteralPath $payloadZip)) {",
    '    throw "Plugin source folder or payload.zip was not found next to this installer."',
    "  }",
    "",
    "  $script:PayloadExtractRoot = Join-Path -Path $env:TEMP -ChildPath ('DV-EXPORT-payload-' + [Guid]::NewGuid().ToString('N'))",
    "  New-Item -ItemType Directory -Path $script:PayloadExtractRoot -Force | Out-Null",
    "  Expand-Archive -LiteralPath $payloadZip -DestinationPath $script:PayloadExtractRoot -Force",
    "",
    "  $payloadPluginSource = Join-Path -Path $script:PayloadExtractRoot -ChildPath $PluginId",
    "  if (Test-Path -LiteralPath $payloadPluginSource) {",
    "    return $payloadPluginSource",
    "  }",
    "",
    "  if (Test-Path -LiteralPath (Join-Path -Path $script:PayloadExtractRoot -ChildPath 'manifest.xml')) {",
    "    return $script:PayloadExtractRoot",
    "  }",
    "",
    '  throw "payload.zip does not contain a valid Resolve workflow integration plugin."',
    "}",
    "",
    "if (-not (Test-Admin)) {",
    "  Write-Host \"Requesting administrator permission...\"",
    "  $arguments = @(",
    '    "-NoProfile",',
    '    "-ExecutionPolicy",',
    '    "Bypass",',
    '    "-File",',
    "    (Quote-Argument $PSCommandPath),",
    '    "-InstallRoot",',
    "    (Quote-Argument $InstallRoot)",
    "  )",
    "",
    "  if ($Force) {",
    '    $arguments += "-Force"',
    "  }",
    "",
    '  $process = Start-Process -FilePath "powershell.exe" -ArgumentList ($arguments -join " ") -Verb RunAs -Wait -PassThru',
    "  if ($null -eq $process.ExitCode) {",
    "    exit 0",
    "  }",
    "",
    "  exit $process.ExitCode",
    "}",
    "",
    "try {",
    "  $SourceDir = Resolve-PluginSource",
    "  $TargetDir = Join-Path -Path $InstallRoot -ChildPath $PluginId",
    "",
    '  $runningResolve = Get-Process -Name "Resolve" -ErrorAction SilentlyContinue',
    "  if ($runningResolve -and -not $Force) {",
    '    throw "DaVinci Resolve is running. Close Resolve and run this installer again, or pass -Force."',
    "  }",
    "",
    "  New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null",
    "  $installRootFull = [System.IO.Path]::GetFullPath($InstallRoot).TrimEnd('\\')",
    "  $targetDirFull = [System.IO.Path]::GetFullPath($TargetDir)",
    "  $installRootPrefix = $installRootFull + '\\'",
    "  if (-not $targetDirFull.StartsWith($installRootPrefix, [StringComparison]::OrdinalIgnoreCase)) {",
    '    throw "Refusing to install outside the Resolve Workflow Integration Plugins folder."',
    "  }",
    "",
    '  $StagingDir = Join-Path -Path $InstallRoot -ChildPath (".dvexport-staging-{0}-{1}" -f $PluginVersion, [Guid]::NewGuid().ToString("N"))',
    "  New-Item -ItemType Directory -Path $StagingDir -Force | Out-Null",
    "  Get-ChildItem -LiteralPath $SourceDir -Force | ForEach-Object {",
    "    Copy-Item -LiteralPath $_.FullName -Destination $StagingDir -Recurse -Force",
    "  }",
    "",
    '  $requiredFiles = @("manifest.xml", "main.js", "preload.js", "package.json", "WorkflowIntegration.node")',
    "  foreach ($file in $requiredFiles) {",
    "    $filePath = Join-Path -Path $StagingDir -ChildPath $file",
    "    if (-not (Test-Path -LiteralPath $filePath)) {",
    '      throw "Installed plugin is missing required file: $file"',
    "    }",
    "  }",
    "",
    "  $stagedPackagePath = Join-Path -Path $StagingDir -ChildPath 'package.json'",
    "  $stagedPackage = Get-Content -LiteralPath $stagedPackagePath -Raw | ConvertFrom-Json",
    "  if ($stagedPackage.version -ne $PluginVersion) {",
    '    throw "Staged version mismatch. Expected $PluginVersion, got $($stagedPackage.version)."',
    "  }",
    "",
    "  if (Test-Path -LiteralPath $TargetDir) {",
    '    $backupRoot = Join-Path -Path $InstallRoot -ChildPath "backup"',
    '    $backupName = "{0}-{1}" -f $PluginId, (Get-Date -Format "yyyyMMdd-HHmmss")',
    "    $BackupDir = Join-Path -Path $backupRoot -ChildPath $backupName",
    "    New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null",
    "    Move-Item -LiteralPath $TargetDir -Destination $BackupDir",
    "    $OldTargetMoved = $true",
    '    Write-Host "Existing plugin backup: $BackupDir"',
    "  }",
    "",
    "  Move-Item -LiteralPath $StagingDir -Destination $TargetDir",
    "  $StagingDir = $null",
    "  $installedPackagePath = Join-Path -Path $TargetDir -ChildPath 'package.json'",
    "  $installedPackage = Get-Content -LiteralPath $installedPackagePath -Raw | ConvertFrom-Json",
    "  if ($installedPackage.version -ne $PluginVersion) {",
    '    throw "Installed version mismatch. Expected $PluginVersion, got $($installedPackage.version)."',
    "  }",
    "  $InstallSucceeded = $true",
    "",
    '  Write-Host "DV-EXPORT $PluginVersion installed successfully."',
    '  Write-Host "Install path: $TargetDir"',
    '  Write-Host "Restart DaVinci Resolve before opening the plugin."',
    "} catch {",
    "  if (-not $InstallSucceeded -and $OldTargetMoved -and $BackupDir -and (Test-Path -LiteralPath $BackupDir)) {",
    "    if (Test-Path -LiteralPath $TargetDir) {",
    "      Remove-Item -LiteralPath $TargetDir -Recurse -Force -ErrorAction SilentlyContinue",
    "    }",
    "    if (-not (Test-Path -LiteralPath $TargetDir)) {",
    "      Move-Item -LiteralPath $BackupDir -Destination $TargetDir -ErrorAction SilentlyContinue",
    "    }",
    "  }",
    "  throw",
    "} finally {",
    "  if ($StagingDir -and (Test-Path -LiteralPath $StagingDir)) {",
    "    Remove-Item -LiteralPath $StagingDir -Recurse -Force -ErrorAction SilentlyContinue",
    "  }",
    "  if ($PayloadExtractRoot -and (Test-Path -LiteralPath $PayloadExtractRoot)) {",
    "    Remove-Item -LiteralPath $PayloadExtractRoot -Recurse -Force -ErrorAction SilentlyContinue",
    "  }",
    "}"
  ].join("\r\n") + "\r\n";
}

function createBatchInstaller() {
  return [
    "@echo off",
    "setlocal",
    "powershell.exe -NoProfile -ExecutionPolicy Bypass -File \"%~dp0install-windows.ps1\" %*",
    "set EXIT_CODE=%ERRORLEVEL%",
    "echo.",
    "if not \"%EXIT_CODE%\"==\"0\" (",
    "  echo Installation failed. Exit code: %EXIT_CODE%",
    ") else (",
    "  echo Installation finished.",
    ")",
    "echo.",
    "if not \"%DVEXPORT_INSTALLER_NO_PAUSE%\"==\"1\" pause",
    "exit /b %EXIT_CODE%"
  ].join("\r\n") + "\r\n";
}

function createReadme(version, packageName, packageType) {
  const launchStep = packageType === "exe"
    ? `2. 双击 ${packageName}.exe。`
    : "2. 解压本 ZIP 安装包，然后双击 install-windows.bat。";

  return [
    `DV-EXPORT ${version} Windows installation package`,
    "",
    "使用步骤：",
    "",
    "1. 先关闭 DaVinci Resolve Studio。",
    launchStep,
    "3. 如果弹出管理员权限确认，请允许。",
    "4. 安装完成后重新打开 DaVinci Resolve Studio。",
    "",
    "默认安装目录：",
    "C:\\ProgramData\\Blackmagic Design\\DaVinci Resolve\\Support\\Workflow Integration Plugins\\com.dvexport.batch-export",
    "",
    "安装器会自动备份同名旧版本插件到 Resolve 插件目录下的 backup 文件夹。",
    "",
    "高级用法：",
    "powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\\install-windows.ps1",
    "powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\\install-windows.ps1 -Force",
    "",
    `安装包名称：${packageName}`
  ].join("\r\n") + "\r\n";
}

function createIExpressSed(sourceRoot, targetPath, setupName, version) {
  const files = ["install-windows.bat", "install-windows.ps1", "payload.zip", "README.txt"];
  const sourceRootWithSlash = sourceRoot.endsWith("\\") ? sourceRoot : `${sourceRoot}\\`;
  const fileStrings = files.map((file, index) => `FILE${index}="${file}"`).join("\r\n");
  const sourceEntries = files.map((_, index) => `%FILE${index}%=`).join("\r\n");

  return [
    "[Version]",
    "Class=IEXPRESS",
    "SEDVersion=3",
    "[Options]",
    "PackagePurpose=InstallApp",
    "ShowInstallProgramWindow=1",
    "HideExtractAnimation=1",
    "UseLongFileName=1",
    "InsideCompressed=0",
    "CAB_FixedSize=0",
    "CAB_ResvCodeSigning=0",
    "RebootMode=N",
    "InstallPrompt=",
    "DisplayLicense=",
    "FinishMessage=",
    "TargetName=%TargetName%",
    "FriendlyName=%FriendlyName%",
    "AppLaunched=%AppLaunched%",
    "PostInstallCmd=<None>",
    "AdminQuietInstCmd=",
    "UserQuietInstCmd=",
    "SourceFiles=SourceFiles",
    "[Strings]",
    `TargetName=${targetPath}`,
    `FriendlyName=DV-EXPORT ${version} Setup`,
    "AppLaunched=cmd /c install-windows.bat",
    fileStrings,
    "[SourceFiles]",
    `SourceFiles0=${sourceRootWithSlash}`,
    "[SourceFiles0]",
    sourceEntries
  ].join("\r\n") + "\r\n";
}

function buildIExpressExe(setupFilesRoot, setupPath, setupName, version) {
  const iexpressPath = "C:\\Windows\\System32\\iexpress.exe";
  if (!existsSync(iexpressPath)) {
    throw new Error("未找到 iexpress.exe，无法生成 Windows EXE 自安装包。");
  }

  const workRoot = path.join(tmpdir(), `dvexport-iexpress-${process.pid}-${Date.now()}`);
  const workSourceRoot = path.join(workRoot, "source");
  const workTargetPath = path.join(workRoot, `${setupName}.exe`);
  const sedPath = path.join(workRoot, `${setupName}.sed`);

  try {
    mkdirSync(workSourceRoot, { recursive: true });
    cpSync(setupFilesRoot, workSourceRoot, { recursive: true });
    writeFileSync(sedPath, createIExpressSed(workSourceRoot, workTargetPath, setupName, version), "utf-8");
    run(iexpressPath, ["/N", sedPath]);

    if (!existsSync(workTargetPath)) {
      throw new Error(`IExpress 未生成目标 EXE：${workTargetPath}`);
    }

    cpSync(workTargetPath, setupPath);
  } finally {
    rmSync(workRoot, { recursive: true, force: true });
  }
}

const shouldSkipPluginBuild = process.argv.includes("--skip-build");

if (!shouldSkipPluginBuild) {
  run(process.execPath, ["./scripts/build-plugin.mjs"]);
}

const version = normalizeVersion(sourcePackage.version);
const versionTag = `v${version}`;
const pluginDir = path.join(distRoot, versionTag, pluginFolderName);
const workflowNodePath = path.join(pluginDir, "WorkflowIntegration.node");

if (!existsSync(pluginDir)) {
  throw new Error(`未找到插件构建产物：${pluginDir}`);
}

if (!existsSync(workflowNodePath)) {
  throw new Error("安装包要求包含 WorkflowIntegration.node，请先确认本机 Resolve Studio 示例插件文件可被构建脚本找到。");
}

const zipPackageName = `DV-EXPORT-${versionTag}-windows-installer`;
const zipPackageRoot = path.join(installerRoot, zipPackageName);
const zipPackagePluginDir = path.join(zipPackageRoot, pluginFolderName);
const zipPath = path.join(installerRoot, `${zipPackageName}.zip`);
const zipHashPath = path.join(installerRoot, `${zipPackageName}.sha256.txt`);

const setupName = `DV-EXPORT-${versionTag}-setup`;
const setupFilesRoot = path.join(installerRoot, `${setupName}-files`);
const setupPayloadPath = path.join(setupFilesRoot, "payload.zip");
const setupPath = path.join(installerRoot, `${setupName}.exe`);
const setupHashPath = path.join(installerRoot, `${setupName}.sha256.txt`);

rmSync(zipPackageRoot, { recursive: true, force: true });
rmSync(zipPath, { force: true });
rmSync(zipHashPath, { force: true });
rmSync(setupFilesRoot, { recursive: true, force: true });
rmSync(setupPath, { force: true });
rmSync(setupHashPath, { force: true });

mkdirSync(zipPackageRoot, { recursive: true });
cpSync(pluginDir, zipPackagePluginDir, { recursive: true });
writeFileSync(path.join(zipPackageRoot, "install-windows.ps1"), createPowerShellInstaller(version), "utf-8");
writeFileSync(path.join(zipPackageRoot, "install-windows.bat"), createBatchInstaller(), "utf-8");
writeFileSync(path.join(zipPackageRoot, "README.txt"), createReadme(version, zipPackageName, "zip"), "utf-8");
zipDirectoryContents(zipPackageRoot, zipPath);
const zipHash = writeHashFile(zipPath, zipHashPath);

mkdirSync(setupFilesRoot, { recursive: true });
zipSinglePath(pluginDir, setupPayloadPath);
writeFileSync(path.join(setupFilesRoot, "install-windows.ps1"), createPowerShellInstaller(version), "utf-8");
writeFileSync(path.join(setupFilesRoot, "install-windows.bat"), createBatchInstaller(), "utf-8");
writeFileSync(path.join(setupFilesRoot, "README.txt"), createReadme(version, setupName, "exe"), "utf-8");
buildIExpressExe(setupFilesRoot, setupPath, setupName, version);
const setupHash = writeHashFile(setupPath, setupHashPath);

console.log(`ZIP 备用安装包：${zipPath}`);
console.log(`ZIP SHA256：${zipHash}`);
console.log(`EXE 自安装包：${setupPath}`);
console.log(`EXE SHA256：${setupHash}`);
