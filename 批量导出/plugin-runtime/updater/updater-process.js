"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const config = require("./update-config");
const { validatePendingMetadata } = require("./update-core");
const { calculateFileSha256 } = require("./update-service");
const { createUpdatePaths } = require("./update-settings");

async function verifyPendingFile(pending) {
  const normalized = validatePendingMetadata(pending, config.currentVersion);
  const stat = fs.statSync(normalized.archivePath);
  if (!stat.isFile() || stat.size !== normalized.size) {
    throw new Error("待安装更新包不存在或大小已变化。");
  }

  const actualSha256 = await calculateFileSha256(normalized.archivePath);
  if (actualSha256 !== normalized.sha256) {
    throw new Error("待安装更新包 SHA-256 已变化。");
  }

  return normalized;
}

function encodeRestartArguments() {
  const json = JSON.stringify(process.argv.slice(1));
  return Buffer.from(json, "utf-8").toString("base64");
}

async function launchUpdaterProcess(pending) {
  const verified = await verifyPendingFile(pending);
  const paths = createUpdatePaths();
  const sessionId = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
  const sessionRoot = path.join(paths.sessions, sessionId);
  const scriptPath = path.join(sessionRoot, "update-session.ps1");
  const resultPath = path.join(sessionRoot, "result.json");
  const logPath = path.join(paths.logs, `update-v${verified.version}-${sessionId}.log`);
  fs.mkdirSync(sessionRoot, { recursive: true });
  fs.mkdirSync(paths.logs, { recursive: true });
  fs.copyFileSync(path.join(__dirname, "update-session.ps1"), scriptPath);

  const args = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    scriptPath,
    "-OldPid",
    String(process.pid),
    "-ArchivePath",
    verified.archivePath,
    "-ExpectedVersion",
    verified.version,
    "-InstallRoot",
    config.installRoot,
    "-RestartExecutable",
    process.execPath,
    "-RestartArgumentsBase64",
    encodeRestartArguments(),
    "-LogPath",
    logPath,
    "-ResultPath",
    resultPath
  ];
  const child = spawn("powershell.exe", args, {
    detached: true,
    windowsHide: true,
    stdio: "ignore"
  });
  await new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  child.unref();

  return { sessionId, resultPath, logPath, pid: child.pid };
}

module.exports = {
  launchUpdaterProcess,
  verifyPendingFile
};
