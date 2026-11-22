import type { FrameRateConversionResultItem, FrameRateConversionStrategy, RenderProfile } from "../types/models";

export interface FrameRateConversionSummary {
  queued: number;
  rendering: number;
  converted: number;
  skipped: number;
  failed: number;
}

export const defaultFrameRateConversionStrategy: FrameRateConversionStrategy = "resolve-ui-copy-paste";

export function formatFrameRateForName(frameRate: number): string {
  if (!Number.isFinite(frameRate) || frameRate <= 0) {
    return "";
  }

  return String(frameRate).replace(/\.0+$/, "");
}

export function createFrameRateTimelineBaseName(timelineName: string, targetFrameRate: number): string {
  return createFrameRateOutputBaseName(timelineName, targetFrameRate);
}

export function createFrameRateOutputBaseName(timelineName: string, targetFrameRate: number): string {
  const frameRateText = formatFrameRateForName(targetFrameRate);
  return frameRateText ? `${timelineName}_${frameRateText}fps` : timelineName;
}

export function createUniqueTimelineName(baseName: string, existingNames: string[]): string {
  const usedNames = new Set(existingNames.map((name) => name.trim().toLowerCase()).filter(Boolean));
  if (!usedNames.has(baseName.trim().toLowerCase())) {
    return baseName;
  }

  let index = 2;
  while (usedNames.has(`${baseName}_${String(index).padStart(2, "0")}`.toLowerCase())) {
    index += 1;
  }

  return `${baseName}_${String(index).padStart(2, "0")}`;
}

export function normalizeDestinationFolderName(value: string | undefined): string {
  return String(value || "").trim();
}

export function normalizeFrameRateConversionStrategy(value: unknown): FrameRateConversionStrategy {
  return value === "ffmpeg-cfr" ||
    value === "ffmpeg-motion" ||
    value === "resolve-render" ||
    value === "resolve-ui-copy-paste"
    ? value
    : defaultFrameRateConversionStrategy;
}

export function normalizeOutputDirectory(value: string | undefined): string {
  return String(value || "").trim();
}

export function createFrameRateOutputFileName(baseName: string, extension: string): string {
  const normalizedBaseName = String(baseName || "").trim();
  const normalizedExtension = String(extension || "").trim().replace(/^\.+/, "");
  if (!normalizedBaseName) {
    return normalizedExtension ? `output.${normalizedExtension}` : "output";
  }

  return normalizedExtension ? `${normalizedBaseName}.${normalizedExtension}` : normalizedBaseName;
}

export function areFrameRatesEqual(left: number | undefined, right: number): boolean {
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(Number(left) - right) < 0.001;
}

export function mapTimelineFrameForTargetFrameRate(args: {
  frame: number;
  sourceStartFrame: number;
  targetStartFrame: number;
  sourceFrameRate: number | undefined;
  targetFrameRate: number;
}): number {
  const { frame, sourceStartFrame, targetStartFrame, sourceFrameRate, targetFrameRate } = args;
  if (
    !Number.isFinite(frame) ||
    !Number.isFinite(sourceStartFrame) ||
    !Number.isFinite(targetStartFrame) ||
    !Number.isFinite(sourceFrameRate) ||
    !Number.isFinite(targetFrameRate) ||
    Number(sourceFrameRate) <= 0 ||
    targetFrameRate <= 0
  ) {
    return frame;
  }

  const offset = frame - sourceStartFrame;
  return targetStartFrame + Math.round(offset * (targetFrameRate / Number(sourceFrameRate)));
}

export function buildFrameRateConversionRenderProfile(profile: RenderProfile, targetFrameRate: number): RenderProfile {
  return {
    ...profile,
    frameRate: targetFrameRate,
    exportVideo: true
  };
}

export function summarizeFrameRateConversionResults(
  results: FrameRateConversionResultItem[]
): FrameRateConversionSummary {
  return {
    queued: results.filter((item) => item.status === "queued").length,
    rendering: results.filter((item) => item.status === "rendering").length,
    converted: results.filter((item) => item.status === "converted").length,
    skipped: results.filter((item) => item.status === "skipped").length,
    failed: results.filter((item) => item.status === "failed").length
  };
}
