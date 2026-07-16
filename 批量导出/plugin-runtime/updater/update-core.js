"use strict";

const updatePolicies = new Set(["automatic", "manual", "disabled"]);
const updateNetworkModes = new Set(["automaticProxy", "manualProxy", "direct"]);
const proxyProtocols = new Set(["http:", "https:", "socks4:", "socks4a:", "socks5:", "socks5h:"]);
const defaultUpdateSettings = Object.freeze({
  updatePolicy: "automatic",
  updateNetworkMode: "automaticProxy",
  manualProxyUrl: "http://127.0.0.1:7890"
});

function normalizeVersion(value) {
  const normalized = String(value || "").trim().replace(/^v/i, "");
  if (!/^\d+\.\d+\.\d+$/.test(normalized)) {
    throw new Error(`版本号必须是 X.Y.Z 格式，当前值：${value || "空"}`);
  }

  return normalized;
}

function compareVersions(left, right) {
  const leftParts = normalizeVersion(left).split(".").map(Number);
  const rightParts = normalizeVersion(right).split(".").map(Number);

  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] > rightParts[index] ? 1 : -1;
    }
  }

  return 0;
}

function expectedAssetNames(version) {
  const normalized = normalizeVersion(version);
  const stem = `DV-EXPORT-v${normalized}-windows-installer`;
  return {
    archive: `${stem}.zip`,
    checksum: `${stem}.sha256.txt`
  };
}

function normalizeProxyUrl(value) {
  const text = String(value || "").trim();
  if (!text) {
    throw new Error("手动代理地址不能为空。");
  }

  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    throw new Error("手动代理地址格式无效，请填写完整地址，例如 http://127.0.0.1:7890。");
  }

  if (!proxyProtocols.has(parsed.protocol) || !parsed.hostname) {
    throw new Error("手动代理仅支持 HTTP、HTTPS、SOCKS4 或 SOCKS5 地址。");
  }

  return parsed.toString().replace(/\/$/, "");
}

function normalizeUpdateSettings(value) {
  const source = value && typeof value === "object" ? value : {};
  const updatePolicy = updatePolicies.has(source.updatePolicy)
    ? source.updatePolicy
    : defaultUpdateSettings.updatePolicy;
  const updateNetworkMode = updateNetworkModes.has(source.updateNetworkMode)
    ? source.updateNetworkMode
    : defaultUpdateSettings.updateNetworkMode;
  let manualProxyUrl = String(source.manualProxyUrl || defaultUpdateSettings.manualProxyUrl).trim();

  if (updateNetworkMode === "manualProxy") {
    manualProxyUrl = normalizeProxyUrl(manualProxyUrl);
  } else if (!manualProxyUrl) {
    manualProxyUrl = defaultUpdateSettings.manualProxyUrl;
  }

  return { updatePolicy, updateNetworkMode, manualProxyUrl };
}

function requireUniqueAsset(assets, expectedName, role) {
  const matches = assets.filter((asset) => asset && asset.name === expectedName);
  if (matches.length !== 1) {
    throw new Error(
      matches.length === 0
        ? `Release 缺少${role}：${expectedName}`
        : `Release 包含重复${role}：${expectedName}`
    );
  }

  const asset = matches[0];
  if (!Number.isFinite(Number(asset.size)) || Number(asset.size) <= 0) {
    throw new Error(`${role}大小无效：${expectedName}`);
  }

  let downloadUrl;
  try {
    downloadUrl = new URL(String(asset.browser_download_url || ""));
  } catch {
    throw new Error(`${role}下载地址无效：${expectedName}`);
  }

  if (!new Set(["http:", "https:"]).has(downloadUrl.protocol)) {
    throw new Error(`${role}下载地址协议无效：${expectedName}`);
  }

  return asset;
}

function normalizeDigest(value) {
  const match = /^sha256:([a-f0-9]{64})$/i.exec(String(value || "").trim());
  return match ? match[1].toUpperCase() : "";
}

function selectReleaseCandidate(release, currentVersion) {
  if (!release || typeof release !== "object") {
    throw new Error("GitHub Latest Release 响应无效。");
  }

  if (release.draft || release.prerelease) {
    throw new Error("Latest Release 不能是草稿或预发布版本。");
  }

  const version = normalizeVersion(release.tag_name);
  if (compareVersions(version, currentVersion) <= 0) {
    return null;
  }

  const assets = Array.isArray(release.assets) ? release.assets : [];
  const names = expectedAssetNames(version);
  const archive = requireUniqueAsset(assets, names.archive, "Windows 更新包");
  const digest = normalizeDigest(archive.digest);
  const checksum = digest ? null : requireUniqueAsset(assets, names.checksum, "SHA-256 校验文件");

  return {
    version,
    tagName: `v${version}`,
    releaseUrl: String(release.html_url || ""),
    publishedAt: String(release.published_at || ""),
    notes: String(release.body || ""),
    archive: {
      name: names.archive,
      size: Number(archive.size),
      downloadUrl: archive.browser_download_url,
      sha256: digest
    },
    checksum: checksum
      ? {
          name: names.checksum,
          size: Number(checksum.size),
          downloadUrl: checksum.browser_download_url
        }
      : null
  };
}

function parseSha256Text(value, expectedFileName) {
  const lines = String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length !== 1) {
    throw new Error("SHA-256 校验文件必须只包含一条有效记录。");
  }

  const match = /^([a-f0-9]{64})(?:\s+\*?(.+))?$/i.exec(lines[0]);
  if (!match) {
    throw new Error("SHA-256 校验文件格式无效。");
  }

  if (match[2] && match[2].trim() !== expectedFileName) {
    throw new Error(`SHA-256 校验文件指向了错误资产：${match[2].trim()}`);
  }

  return match[1].toUpperCase();
}

function validatePendingMetadata(pending, currentVersion) {
  if (!pending || typeof pending !== "object") {
    throw new Error("待安装更新记录不存在。");
  }

  const version = normalizeVersion(pending.version);
  if (compareVersions(version, currentVersion) <= 0) {
    throw new Error("待安装版本不高于当前版本。");
  }

  const names = expectedAssetNames(version);
  if (pending.assetName !== names.archive) {
    throw new Error("待安装更新包名称与版本契约不一致。");
  }

  if (!/^[A-F0-9]{64}$/i.test(String(pending.sha256 || ""))) {
    throw new Error("待安装更新缺少有效 SHA-256。");
  }

  if (!Number.isFinite(Number(pending.size)) || Number(pending.size) <= 0) {
    throw new Error("待安装更新包大小无效。");
  }

  if (!String(pending.archivePath || "").trim()) {
    throw new Error("待安装更新包路径为空。");
  }

  return {
    ...pending,
    version,
    assetName: names.archive,
    size: Number(pending.size),
    sha256: String(pending.sha256).toUpperCase(),
    archivePath: String(pending.archivePath)
  };
}

module.exports = {
  compareVersions,
  defaultUpdateSettings,
  expectedAssetNames,
  normalizeDigest,
  normalizeProxyUrl,
  normalizeUpdateSettings,
  normalizeVersion,
  parseSha256Text,
  selectReleaseCandidate,
  validatePendingMetadata
};
