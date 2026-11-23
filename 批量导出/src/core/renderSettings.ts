import type { RenderProfile } from "../types/models";

export interface ResolveRenderSettings {
  SelectAllFrames: true;
  TargetDir: string;
  CustomName: string;
  ExportVideo: boolean;
  ExportAudio: boolean;
  FormatWidth: number;
  FormatHeight: number;
  FrameRate: number;
  AudioCodec?: string;
  AudioBitDepth?: number;
  AudioSampleRate?: number;
  ExportAlpha?: boolean;
}

export function buildResolveRenderSettings(
  profile: RenderProfile,
  targetDir: string,
  customName: string
): ResolveRenderSettings {
  const renderSettings: ResolveRenderSettings = {
    SelectAllFrames: true,
    TargetDir: targetDir,
    CustomName: customName,
    ExportVideo: profile.exportVideo,
    ExportAudio: profile.exportAudio,
    FormatWidth: profile.resolution.width,
    FormatHeight: profile.resolution.height,
    FrameRate: profile.frameRate
  };

  if (profile.exportAudio && profile.audioCodec) {
    renderSettings.AudioCodec = profile.audioCodec;
  }

  if (profile.exportAudio && typeof profile.audioBitDepth === "number") {
    renderSettings.AudioBitDepth = profile.audioBitDepth;
  }

  if (profile.exportAudio && typeof profile.audioSampleRate === "number") {
    renderSettings.AudioSampleRate = profile.audioSampleRate;
  }

  if (profile.exportAlpha) {
    renderSettings.ExportAlpha = true;
  }

  return renderSettings;
}
