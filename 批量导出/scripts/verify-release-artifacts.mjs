import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { normalizeSemver } from "./release-version.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const versionIndex = process.argv.indexOf("--version");
const version = normalizeSemver(versionIndex >= 0 ? process.argv[versionIndex + 1] : "");
const installerRoot = path.join(projectRoot, "dist", "installer");
const stem = `DV-EXPORT-v${version}`;
const artifacts = {
  archive: path.join(installerRoot, `${stem}-windows-installer.zip`),
  archiveHash: path.join(installerRoot, `${stem}-windows-installer.sha256.txt`),
  setup: path.join(installerRoot, `${stem}-setup.exe`),
  setupHash: path.join(installerRoot, `${stem}-setup.sha256.txt`)
};

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex").toUpperCase();
}

function verifyHashFile(filePath, hashPath) {
  const expectedLine = `${sha256(filePath)}  ${path.basename(filePath)}`;
  const actualLine = readFileSync(hashPath, "utf-8").trim();
  if (actualLine !== expectedLine) {
    throw new Error(`Hash file mismatch for ${path.basename(filePath)}`);
  }
  return expectedLine.slice(0, 64);
}

function windowsPowerShellEnv(extra = {}) {
  const environment = { ...process.env, ...extra };
  for (const key of Object.keys(environment)) {
    if (key.toUpperCase() === "PSMODULEPATH") {
      delete environment[key];
    }
  }
  return environment;
}

for (const artifactPath of Object.values(artifacts)) {
  if (!existsSync(artifactPath) || statSync(artifactPath).size <= 0) {
    throw new Error(`Missing or empty release artifact: ${artifactPath}`);
  }
}

if (statSync(artifacts.archive).size < 100 * 1024 || statSync(artifacts.setup).size < 100 * 1024) {
  throw new Error("Release package is unexpectedly small.");
}

const archiveSha256 = verifyHashFile(artifacts.archive, artifacts.archiveHash);
const setupSha256 = verifyHashFile(artifacts.setup, artifacts.setupHash);
const extractRoot = mkdtempSync(path.join(tmpdir(), "dvexport-verify-"));

try {
  const expand = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      "Expand-Archive -LiteralPath $env:DV_EXPORT_ARCHIVE -DestinationPath $env:DV_EXPORT_EXTRACT_ROOT -Force"
    ],
    {
      encoding: "utf-8",
      env: windowsPowerShellEnv({
        DV_EXPORT_ARCHIVE: artifacts.archive,
        DV_EXPORT_EXTRACT_ROOT: extractRoot
      })
    }
  );
  if (expand.status !== 0) {
    throw new Error(`Unable to expand release archive: ${expand.stderr}`);
  }

  const pluginRoot = path.join(extractRoot, "com.dvexport.batch-export");
  const requiredPaths = [
    path.join(extractRoot, "install-windows.ps1"),
    path.join(pluginRoot, "package.json"),
    path.join(pluginRoot, "main.js"),
    path.join(pluginRoot, "preload.js"),
    path.join(pluginRoot, "WorkflowIntegration.node"),
    path.join(pluginRoot, "updater", "update-core.js"),
    path.join(pluginRoot, "updater", "update-session.ps1")
  ];
  for (const requiredPath of requiredPaths) {
    if (!existsSync(requiredPath)) {
      throw new Error(`Archive is missing required path: ${requiredPath}`);
    }
  }

  const installedPackage = JSON.parse(readFileSync(path.join(pluginRoot, "package.json"), "utf-8"));
  if (installedPackage.version !== version) {
    throw new Error(`Archive version mismatch: expected ${version}, got ${installedPackage.version}`);
  }

  const signature = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      "(Get-AuthenticodeSignature -LiteralPath $env:DV_EXPORT_SIGNATURE_FILE).Status.ToString()"
    ],
    {
      encoding: "utf-8",
      env: windowsPowerShellEnv({
        DV_EXPORT_SIGNATURE_FILE: path.join(pluginRoot, "WorkflowIntegration.node")
      })
    }
  );
  if (signature.status !== 0 || signature.stdout.trim() !== "Valid") {
    throw new Error(`WorkflowIntegration.node signature verification failed: ${signature.stdout} ${signature.stderr}`);
  }

  const setupSignature = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-Command", "(Get-AuthenticodeSignature -LiteralPath $env:DV_EXPORT_SIGNATURE_FILE).Status.ToString()"],
    {
      encoding: "utf-8",
      env: windowsPowerShellEnv({
        DV_EXPORT_SIGNATURE_FILE: artifacts.setup
      })
    }
  ).stdout.trim();

  console.log(
    JSON.stringify(
      {
        version,
        archive: path.basename(artifacts.archive),
        archiveBytes: statSync(artifacts.archive).size,
        archiveSha256,
        setup: path.basename(artifacts.setup),
        setupBytes: statSync(artifacts.setup).size,
        setupSha256,
        workflowNodeSignature: "Valid",
        setupSignature: setupSignature || "Unknown"
      },
      null,
      2
    )
  );
} finally {
  rmSync(extractRoot, { recursive: true, force: true });
}
