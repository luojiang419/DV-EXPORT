import { describe, expect, it } from "vitest";
import {
  compareVersions,
  expectedAssetNames,
  normalizeProxyUrl,
  normalizeUpdateSettings,
  parseSha256Text,
  selectReleaseCandidate,
  validatePendingMetadata
} from "../plugin-runtime/updater/update-core.js";

const hash = "A".repeat(64);

function release(version = "0.1.27", overrides: Record<string, unknown> = {}) {
  const names = expectedAssetNames(version);
  return {
    tag_name: `v${version}`,
    draft: false,
    prerelease: false,
    html_url: `https://github.com/luojiang419/DV-EXPORT/releases/tag/v${version}`,
    published_at: "2026-07-16T00:00:00Z",
    body: "release notes",
    assets: [
      {
        name: "unrelated.exe",
        size: 50,
        browser_download_url: "https://example.com/unrelated.exe"
      },
      {
        name: names.archive,
        size: 1024,
        digest: `sha256:${hash}`,
        browser_download_url: `https://example.com/${names.archive}`
      }
    ],
    ...overrides
  };
}

describe("update core", () => {
  it("比较三段版本并支持 v 前缀", () => {
    expect(compareVersions("v0.1.27", "0.1.26")).toBe(1);
    expect(compareVersions("0.1.27", "v0.1.27")).toBe(0);
    expect(compareVersions("0.1.9", "0.1.10")).toBe(-1);
    expect(() => compareVersions("0.1", "0.1.0")).toThrow(/X.Y.Z/);
  });

  it("对策略与网络模式使用安全默认值并校验手动代理", () => {
    expect(normalizeUpdateSettings(null)).toEqual({
      updatePolicy: "automatic",
      updateNetworkMode: "automaticProxy",
      manualProxyUrl: "http://127.0.0.1:7890"
    });
    expect(
      normalizeUpdateSettings({
        updatePolicy: "manual",
        updateNetworkMode: "manualProxy",
        manualProxyUrl: "socks5h://127.0.0.1:1080"
      })
    ).toEqual({
      updatePolicy: "manual",
      updateNetworkMode: "manualProxy",
      manualProxyUrl: "socks5h://127.0.0.1:1080"
    });
    expect(() => normalizeProxyUrl("file:///tmp/proxy")).toThrow(/仅支持/);
  });

  it("保留更新策略与网络模式 3×3 九种独立组合", () => {
    const policies = ["automatic", "manual", "disabled"] as const;
    const networkModes = ["automaticProxy", "manualProxy", "direct"] as const;
    const combinations = policies.flatMap((updatePolicy) =>
      networkModes.map((updateNetworkMode) =>
        normalizeUpdateSettings({
          updatePolicy,
          updateNetworkMode,
          manualProxyUrl: "http://127.0.0.1:7890"
        })
      )
    );

    expect(combinations).toHaveLength(9);
    expect(new Set(combinations.map((item) => `${item.updatePolicy}:${item.updateNetworkMode}`)).size).toBe(9);
  });

  it("从多资产 Release 中精确选择唯一更新包", () => {
    const candidate = selectReleaseCandidate(release(), "0.1.26");
    expect(candidate?.archive.name).toBe("DV-EXPORT-v0.1.27-windows-installer.zip");
    expect(candidate?.archive.sha256).toBe(hash);
    expect(candidate?.checksum).toBeNull();
    expect(selectReleaseCandidate(release(), "0.1.27")).toBeNull();
    expect(selectReleaseCandidate(release("0.1.26"), "0.1.27")).toBeNull();
  });

  it("缺少 digest 时要求精确校验文件并拒绝缺失或重复资产", () => {
    const names = expectedAssetNames("0.1.27");
    const withoutDigest = release("0.1.27", {
      assets: [
        {
          name: names.archive,
          size: 1024,
          browser_download_url: `https://example.com/${names.archive}`
        },
        {
          name: names.checksum,
          size: 100,
          browser_download_url: `https://example.com/${names.checksum}`
        }
      ]
    });
    expect(selectReleaseCandidate(withoutDigest, "0.1.26")?.checksum?.name).toBe(names.checksum);

    expect(() =>
      selectReleaseCandidate(release("0.1.27", { assets: [] }), "0.1.26")
    ).toThrow(/缺少Windows 更新包/);

    const duplicated = release();
    duplicated.assets.push({ ...duplicated.assets[1] });
    expect(() => selectReleaseCandidate(duplicated, "0.1.26")).toThrow(/重复Windows 更新包/);
  });

  it("解析校验文件并验证 pending 契约", () => {
    const names = expectedAssetNames("0.1.27");
    expect(parseSha256Text(`${hash}  ${names.archive}\n`, names.archive)).toBe(hash);
    expect(() => parseSha256Text(`${hash}  wrong.zip`, names.archive)).toThrow(/错误资产/);

    const pending = validatePendingMetadata(
      {
        version: "0.1.27",
        assetName: names.archive,
        archivePath: "C:\\Users\\测试 用户\\update.zip",
        size: 1024,
        sha256: hash
      },
      "0.1.26"
    );
    expect(pending.version).toBe("0.1.27");
    expect(() => validatePendingMetadata(pending, "0.1.27")).toThrow(/不高于/);
  });
});
