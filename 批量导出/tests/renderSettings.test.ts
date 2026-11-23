import { describe, expect, it } from "vitest";
import { buildResolveRenderSettings } from "../src/core/renderSettings";

describe("render settings", () => {
  it("builds resolve render settings from profile", () => {
    const result = buildResolveRenderSettings(
      {
        presetName: "H264 Master",
        format: "mp4",
        codec: "h264",
        resolution: { width: 3840, height: 2160 },
        frameRate: 25,
        exportVideo: true,
        exportAudio: false
      },
      "D:/Exports",
      "Episode01"
    );

    expect(result).toEqual({
      SelectAllFrames: true,
      TargetDir: "D:/Exports",
      CustomName: "Episode01",
      ExportVideo: true,
      ExportAudio: false,
      FormatWidth: 3840,
      FormatHeight: 2160,
      FrameRate: 25
    });
  });

  it("omits unsupported optional settings until they are explicitly set", () => {
    const result = buildResolveRenderSettings(
      {
        presetName: "",
        format: "mov",
        codec: "dnxhr",
        resolution: { width: 1920, height: 1080 },
        frameRate: 24,
        exportVideo: true,
        exportAudio: true,
        audioCodec: "aac",
        audioBitDepth: 24,
        audioSampleRate: 48000,
        exportAlpha: true
      },
      "D:/Exports",
      "Episode02"
    );

    expect(result).toEqual({
      SelectAllFrames: true,
      TargetDir: "D:/Exports",
      CustomName: "Episode02",
      ExportVideo: true,
      ExportAudio: true,
      FormatWidth: 1920,
      FormatHeight: 1080,
      FrameRate: 24,
      AudioCodec: "aac",
      AudioBitDepth: 24,
      AudioSampleRate: 48000,
      ExportAlpha: true
    });
  });
});
