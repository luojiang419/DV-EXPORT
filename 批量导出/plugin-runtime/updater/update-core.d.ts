export type UpdatePolicy = "automatic" | "manual" | "disabled";
export type UpdateNetworkMode = "automaticProxy" | "manualProxy" | "direct";

export interface UpdateSettings {
  updatePolicy: UpdatePolicy;
  updateNetworkMode: UpdateNetworkMode;
  manualProxyUrl: string;
}

export interface ReleaseCandidate {
  version: string;
  tagName: string;
  releaseUrl: string;
  publishedAt: string;
  notes: string;
  archive: { name: string; size: number; downloadUrl: string; sha256: string };
  checksum: { name: string; size: number; downloadUrl: string } | null;
}

export const defaultUpdateSettings: Readonly<UpdateSettings>;
export function normalizeVersion(value: unknown): string;
export function compareVersions(left: string, right: string): -1 | 0 | 1;
export function expectedAssetNames(version: string): { archive: string; checksum: string };
export function normalizeProxyUrl(value: unknown): string;
export function normalizeUpdateSettings(value: unknown): UpdateSettings;
export function normalizeDigest(value: unknown): string;
export function selectReleaseCandidate(release: unknown, currentVersion: string): ReleaseCandidate | null;
export function parseSha256Text(value: unknown, expectedFileName: string): string;
export function validatePendingMetadata<T extends Record<string, unknown>>(pending: T, currentVersion: string): T & {
  version: string;
  assetName: string;
  size: number;
  sha256: string;
  archivePath: string;
};
