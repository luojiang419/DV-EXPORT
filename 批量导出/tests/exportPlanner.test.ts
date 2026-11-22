import { describe, expect, it } from "vitest";
import { createExportJobPlans } from "../src/core/exportPlanner";

describe("export planner", () => {
  it("creates a plan for every selected timeline", () => {
    const result = createExportJobPlans({
      timelines: [
        { id: "1", name: "A", folderId: "root" },
        { id: "2", name: "B", folderId: "root" }
      ],
      profile: {
        presetName: "",
        format: "mp4",
        codec: "h264",
        resolution: { width: 1920, height: 1080 },
        frameRate: 24,
        exportVideo: true,
        exportAudio: true
      },
      outputDirectory: "D:/Exports",
      namingTemplate: "{timeline}_{index}",
      projectName: "Proj",
      now: new Date("2026-06-01T08:09:10")
    });

    expect(result).toHaveLength(2);
    expect(result[0].outputName).toBe("A_01");
    expect(result[1].outputName).toBe("B_02");
  });
});
