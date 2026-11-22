"use strict";

const crypto = require("crypto");
const fs = require("fs");
const net = require("net");
const path = require("path");
const { spawn } = require("child_process");
const config = require("./update-config");
const {
  normalizeProxyUrl,
  parseSha256Text,
  selectReleaseCandidate
} = require("./update-core");

const commonCurlArgs = [
  "--fail",
  "--location",
  "--silent",
  "--show-error",
  "--retry",
  "2",
  "--retry-all-errors",
  "--connect-timeout",
  "15",
  "--max-time",
  "600",
  "--header",
  "Accept: application/vnd.github+json",
  "--header",
  "X-GitHub-Api-Version: 2022-11-28",
  "--user-agent",
  "DV-EXPORT-Updater"
];

function findCurlExecutable() {
  const candidates = [
    process.env.DVEXPORT_CURL_PATH,
    process.env.SystemRoot && path.join(process.env.SystemRoot, "System32", "curl.exe"),
    "curl.exe"
  ].filter(Boolean);

  return candidates.find((candidate) => candidate === "curl.exe" || fs.existsSync(candidate)) || "curl.exe";
}

function probeTcpPort(host, port, timeoutMs = 250) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

async function resolveNetworkRoute(settings) {
  if (settings.updateNetworkMode === "direct") {
    return { label: "直连", curlArgs: ["--noproxy", "*"] };
  }

  if (settings.updateNetworkMode === "manualProxy") {
    const proxyUrl = normalizeProxyUrl(settings.manualProxyUrl);
    return { label: `手动代理 ${proxyUrl}`, curlArgs: ["--proxy", proxyUrl] };
  }

  const environmentProxy =
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    process.env.ALL_PROXY ||
    process.env.all_proxy;
  if (environmentProxy) {
    try {
      const proxyUrl = normalizeProxyUrl(environmentProxy);
      return { label: `环境代理 ${proxyUrl}`, curlArgs: ["--proxy", proxyUrl] };
    } catch {
      // Ignore malformed environment proxy values and continue with local probing.
    }
  }

  const localCandidates = [
    { host: "127.0.0.1", port: 7890, protocol: "http" },
    { host: "127.0.0.1", port: 1080, protocol: "socks5h" },
    { host: "127.0.0.1", port: 8080, protocol: "http" }
  ];
  for (const candidate of localCandidates) {
    if (await probeTcpPort(candidate.host, candidate.port)) {
      const proxyUrl = `${candidate.protocol}://${candidate.host}:${candidate.port}`;
      return { label: `自动代理 ${proxyUrl}`, curlArgs: ["--proxy", proxyUrl] };
    }
  }

  return { label: "自动检测后直连", curlArgs: ["--noproxy", "*"] };
}

function runCurl(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(findCurlExecutable(), [...commonCurlArgs, ...args], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = Buffer.alloc(0);
    let stderr = "";
    let settled = false;
    const maxOutputBytes = options.maxOutputBytes || 8 * 1024 * 1024;

    child.stdout.on("data", (chunk) => {
      stdout = Buffer.concat([stdout, chunk]);
      if (!settled && stdout.length > maxOutputBytes) {
        settled = true;
        child.kill();
        reject(new Error("更新服务响应超过安全大小限制。"));
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${chunk.toString("utf-8")}`.slice(-16000);
    });
    child.once("error", (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    child.once("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      if (code !== 0) {
        reject(new Error(`网络请求失败（curl ${code}）：${stderr.trim() || "未知错误"}`));
        return;
      }
      resolve(stdout);
    });
  });
}

async function requestText(url, settings, maxOutputBytes) {
  const route = await resolveNetworkRoute(settings);
  const body = await runCurl([...route.curlArgs, String(url)], { maxOutputBytes });
  return { text: body.toString("utf-8"), route: route.label };
}

function calculateFileSha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const input = fs.createReadStream(filePath);
    input.on("error", reject);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("end", () => resolve(hash.digest("hex").toUpperCase()));
  });
}

async function checkLatestRelease(settings) {
  const response = await requestText(config.latestReleaseApi, settings, 4 * 1024 * 1024);
  let release;
  try {
    release = JSON.parse(response.text);
  } catch {
    throw new Error("GitHub Latest Release 返回了无效 JSON。");
  }

  return {
    candidate: selectReleaseCandidate(release, config.currentVersion),
    route: response.route
  };
}

async function resolveExpectedSha256(candidate, settings) {
  if (candidate.archive.sha256) {
    return candidate.archive.sha256;
  }

  if (!candidate.checksum) {
    throw new Error("Release 未提供 GitHub digest 或 SHA-256 校验文件。");
  }

  const response = await requestText(candidate.checksum.downloadUrl, settings, 1024 * 1024);
  return parseSha256Text(response.text, candidate.archive.name);
}

async function verifyArchive(filePath, expectedSize, expectedSha256) {
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size !== expectedSize) {
    throw new Error(`更新包大小校验失败：期望 ${expectedSize}，实际 ${stat.size}。`);
  }

  const actualSha256 = await calculateFileSha256(filePath);
  if (actualSha256 !== expectedSha256.toUpperCase()) {
    throw new Error(`更新包 SHA-256 校验失败：期望 ${expectedSha256}，实际 ${actualSha256}。`);
  }

  return actualSha256;
}

async function downloadCandidate(candidate, settings, paths, onProgress = () => {}) {
  const expectedSha256 = await resolveExpectedSha256(candidate, settings);
  const versionRoot = path.join(paths.downloads, `v${candidate.version}`);
  const archivePath = path.join(versionRoot, candidate.archive.name);
  const partialPath = `${archivePath}.part`;
  fs.mkdirSync(versionRoot, { recursive: true });

  if (fs.existsSync(archivePath)) {
    try {
      await verifyArchive(archivePath, candidate.archive.size, expectedSha256);
      onProgress(1);
      cleanupOldDownloadDirectories(paths.downloads, versionRoot);
      return { archivePath, expectedSha256, reused: true };
    } catch {
      fs.rmSync(archivePath, { force: true });
    }
  }

  fs.rmSync(partialPath, { force: true });
  const route = await resolveNetworkRoute(settings);
  const progressTimer = setInterval(() => {
    try {
      const downloaded = fs.statSync(partialPath).size;
      onProgress(Math.max(0, Math.min(0.99, downloaded / candidate.archive.size)));
    } catch {
      onProgress(0);
    }
  }, 250);
  if (typeof progressTimer.unref === "function") {
    progressTimer.unref();
  }

  try {
    await runCurl([
      ...route.curlArgs,
      "--output",
      partialPath,
      candidate.archive.downloadUrl
    ], { maxOutputBytes: 1024 * 1024 });
    await verifyArchive(partialPath, candidate.archive.size, expectedSha256);
    fs.rmSync(archivePath, { force: true });
    fs.renameSync(partialPath, archivePath);
    cleanupOldDownloadDirectories(paths.downloads, versionRoot);
    onProgress(1);
    return { archivePath, expectedSha256, reused: false };
  } catch (error) {
    fs.rmSync(partialPath, { force: true });
    throw error;
  } finally {
    clearInterval(progressTimer);
  }
}

function cleanupOldDownloadDirectories(downloadRoot, keepRoot) {
  if (!fs.existsSync(downloadRoot)) {
    return;
  }

  const resolvedDownloadRoot = path.resolve(downloadRoot);
  const resolvedKeepRoot = path.resolve(keepRoot);
  for (const entry of fs.readdirSync(resolvedDownloadRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const candidate = path.resolve(resolvedDownloadRoot, entry.name);
    const isInsideRoot = candidate.startsWith(`${resolvedDownloadRoot}${path.sep}`);
    if (isInsideRoot && candidate !== resolvedKeepRoot) {
      fs.rmSync(candidate, { recursive: true, force: true });
    }
  }
}

module.exports = {
  calculateFileSha256,
  checkLatestRelease,
  cleanupOldDownloadDirectories,
  downloadCandidate,
  probeTcpPort,
  requestText,
  resolveExpectedSha256,
  resolveNetworkRoute,
  verifyArchive
};
