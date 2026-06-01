import type { RenderProfile } from "../types/models";

export interface PersistedExportSettings {
  renderProfile: RenderProfile;
  outputDirectory: string;
  namingTemplate: string;
}

export const exportSettingsStorageKey = "dv-batch-export:settings";

function sanitizeResolution(value: unknown, fallback: RenderProfile["resolution"]) {
  if (!value || typeof value !== "object") {
    return fallback;
  }

  const record = value as Record<string, unknown>;
  const width = Number(record.width);
  const height = Number(record.height);

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return fallback;
  }

  return { width, height };
}

function sanitizeRenderProfile(value: unknown, fallback: RenderProfile): RenderProfile {
  if (!value || typeof value !== "object") {
    return fallback;
  }

  const record = value as Record<string, unknown>;
  const frameRate = Number(record.frameRate);
  const audioBitDepth = Number(record.audioBitDepth);
  const audioSampleRate = Number(record.audioSampleRate);

  return {
    ...fallback,
    presetName: typeof record.presetName === "string" ? record.presetName : fallback.presetName,
    format: typeof record.format === "string" ? record.format : fallback.format,
    codec: typeof record.codec === "string" ? record.codec : fallback.codec,
    resolution: sanitizeResolution(record.resolution, fallback.resolution),
    frameRate: Number.isFinite(frameRate) && frameRate > 0 ? frameRate : fallback.frameRate,
    exportVideo: typeof record.exportVideo === "boolean" ? record.exportVideo : fallback.exportVideo,
    exportAudio: typeof record.exportAudio === "boolean" ? record.exportAudio : fallback.exportAudio,
    audioCodec: typeof record.audioCodec === "string" ? record.audioCodec : fallback.audioCodec,
    audioBitDepth: Number.isFinite(audioBitDepth) && audioBitDepth > 0 ? audioBitDepth : fallback.audioBitDepth,
    audioSampleRate: Number.isFinite(audioSampleRate) && audioSampleRate > 0 ? audioSampleRate : fallback.audioSampleRate,
    exportAlpha: typeof record.exportAlpha === "boolean" ? record.exportAlpha : fallback.exportAlpha
  };
}

export function loadPersistedExportSettings(
  fallbackProfile: RenderProfile,
  fallbackNamingTemplate: string
): PersistedExportSettings {
  const defaults = {
    renderProfile: fallbackProfile,
    outputDirectory: "",
    namingTemplate: fallbackNamingTemplate
  };

  if (typeof window === "undefined" || !window.localStorage) {
    return defaults;
  }

  try {
    const raw = window.localStorage.getItem(exportSettingsStorageKey);
    if (!raw) {
      return defaults;
    }

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      renderProfile: sanitizeRenderProfile(parsed.renderProfile, fallbackProfile),
      outputDirectory: typeof parsed.outputDirectory === "string" ? parsed.outputDirectory : "",
      namingTemplate: typeof parsed.namingTemplate === "string" ? parsed.namingTemplate : fallbackNamingTemplate
    };
  } catch {
    return defaults;
  }
}

export function savePersistedExportSettings(settings: PersistedExportSettings) {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }

  window.localStorage.setItem(exportSettingsStorageKey, JSON.stringify(settings));
}
