import packageJson from "../../package.json";

export const productVersion = packageJson.version;
export const installerFileName = `DV-EXPORT-v${productVersion}-setup.exe`;
export const installerChecksumFileName = `DV-EXPORT-v${productVersion}-setup.sha256.txt`;
export const installerUrl = `./downloads/${installerFileName}`;
export const installerChecksumUrl = `./downloads/${installerChecksumFileName}`;

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "大小以下载响应为准";
  }

  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(bytes >= 10 * 1024 * 1024 ? 1 : 2)} MB`;
}
