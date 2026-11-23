import { describe, expect, it } from "vitest";
import {
  areFrameRatesEqual,
  buildFrameRateConversionRenderProfile,
  createFrameRateOutputBaseName,
  createFrameRateOutputFileName,
  createFrameRateTimelineBaseName,
  createUniqueTimelineName,
  mapTimelineFrameForTargetFrameRate,
  normalizeFrameRateConversionStrategy,
  normalizeDestinationFolderName,
  normalizeOutputDirectory,
  summarizeFrameRateConversionResults
} from "../src/core/timelineFrameRateConversion";

describe("timeline frame rate conversion", () => {
  it("creates frame rate suffix names", () => {
    expect(createFrameRateTimelineBaseName("Scene A", 50)).toBe("Scene A_50fps");
    expect(createFrameRateTimelineBaseName("Scene A", 23.976)).toBe("Scene A_23.976fps");
  });

  it("creates output names for exported conversions", () => {
    expect(createFrameRateOutputBaseName("Scene A", 60)).toBe("Scene A_60fps");
    expect(createFrameRateOutputFileName("Scene A_60fps", ".mp4")).toBe("Scene A_60fps.mp4");
    expect(createFrameRateOutputFileName("", "mov")).toBe("output.mov");
  });

  it("adds an incrementing suffix for duplicate target names", () => {
    const result = createUniqueTimelineName("Scene A_50fps", ["Scene A_50fps", "Scene A_50fps_02"]);

    expect(result).toBe("Scene A_50fps_03");
  });

  it("compares frame rates with a small tolerance", () => {
    expect(areFrameRatesEqual(50, 50)).toBe(true);
    expect(areFrameRatesEqual(49.9995, 50)).toBe(true);
    expect(areFrameRatesEqual(25, 50)).toBe(false);
  });

  it("maps source timeline record frames to the target timeline frame rate", () => {
    expect(
      mapTimelineFrameForTargetFrameRate({
        frame: 108151,
        sourceStartFrame: 108000,
        targetStartFrame: 216000,
        sourceFrameRate: 30,
        targetFrameRate: 60
      })
    ).toBe(216302);
    expect(
      mapTimelineFrameForTargetFrameRate({
        frame: 108151,
        sourceStartFrame: 108000,
        targetStartFrame: 108000,
        sourceFrameRate: 30,
        targetFrameRate: 30
      })
    ).toBe(108151);
  });

  it("normalizes optional destination and output paths", () => {
    expect(normalizeDestinationFolderName("  新帧率时间线  ")).toBe("新帧率时间线");
    expect(normalizeDestinationFolderName(undefined)).toBe("");
    expect(normalizeOutputDirectory("  D:/Exports  ")).toBe("D:/Exports");
    expect(normalizeOutputDirectory(undefined)).toBe("");
  });

  it("normalizes conversion strategies", () => {
    expect(normalizeFrameRateConversionStrategy("ffmpeg-cfr")).toBe("ffmpeg-cfr");
    expect(normalizeFrameRateConversionStrategy("ffmpeg-motion")).toBe("ffmpeg-motion");
    expect(normalizeFrameRateConversionStrategy("resolve-ui-copy-paste")).toBe("resolve-ui-copy-paste");
    expect(normalizeFrameRateConversionStrategy("unknown")).toBe("resolve-ui-copy-paste");
  });

  it("builds a render profile for target frame rate output", () => {
    const result = buildFrameRateConversionRenderProfile(
      {
        presetName: "",
        format: "mp4",
        codec: "h264",
        resolution: { width: 1920, height: 1080 },
        frameRate: 24,
        exportVideo: false,
        exportAudio: true
      },
      60
    );

    expect(result).toEqual({
      presetName: "",
      format: "mp4",
      codec: "h264",
      resolution: { width: 1920, height: 1080 },
      frameRate: 60,
      exportVideo: true,
      exportAudio: true
    });
  });

  it("summarizes converted, skipped, and failed results", () => {
    const result = summarizeFrameRateConversionResults([
      { timelineName: "Queued", status: "queued", success: true },
      { timelineName: "Rendering", status: "rendering", success: true },
      { timelineName: "A", status: "converted", success: true },
      { timelineName: "B", status: "skipped", success: true },
      { timelineName: "C", status: "failed", success: false }
    ]);

    expect(result).toEqual({ queued: 1, rendering: 1, converted: 1, skipped: 1, failed: 1 });
  });
});
