import { describe, expect, it } from "vitest";
import { ensureTimelineRenderOptions, getPrimarySelectedTimeline } from "../src/app/App";
import type { RenderOptionsResponse, TimelineEntry } from "../src/types/models";

const baseOptions: RenderOptionsResponse = {
  presets: [],
  formats: [{ id: "mp4", label: "MP4", extension: "mp4" }],
  codecs: [{ id: "h264", label: "H.264" }],
  resolutions: [{ width: 1920, height: 1080 }],
  frameRates: [{ id: "24", label: "24 fps", value: 24 }],
  currentFormat: "mp4",
  currentCodec: "h264"
};

describe("timeline render settings sync", () => {
  it("adds selected timeline resolution and frame rate to render options", () => {
    const result = ensureTimelineRenderOptions(baseOptions, {
      id: "timeline-1",
      name: "Timeline 1",
      folderId: "folder-1",
      frameRate: 25,
      resolution: { width: 3840, height: 2160 }
    });

    expect(result.frameRates).toContainEqual({ id: "25", label: "25 fps", value: 25 });
    expect(result.resolutions).toContainEqual({ width: 3840, height: 2160 });
  });

  it("uses the first selected timeline in list order as the settings source", () => {
    const timelines: TimelineEntry[] = [
      { id: "a", name: "A", folderId: "folder-1", frameRate: 24 },
      { id: "b", name: "B", folderId: "folder-1", frameRate: 50 }
    ];

    expect(getPrimarySelectedTimeline(timelines, ["b", "a"])?.id).toBe("a");
  });
});
