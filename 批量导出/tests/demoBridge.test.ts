import { afterEach, describe, expect, it, vi } from "vitest";
import { createDemoResolveBridge } from "../src/demo/demoBridge";

afterEach(() => {
  vi.useRealTimers();
});

describe("createDemoResolveBridge", () => {
  it("提供可交互的模拟工程和导出结果", async () => {
    vi.useFakeTimers();
    const bridge = createDemoResolveBridge();
    const initialization = Promise.all([
      bridge.getEnvironment(),
      bridge.getMediaPoolTree(),
      bridge.getAllTimelines(),
      bridge.getRenderOptions({ format: "mp4", codec: "h265" })
    ]);

    await vi.runAllTimersAsync();
    const [environment, folderTree, timelines, options] = await initialization;

    expect(environment.isStudio).toBe(true);
    expect(environment.versionString).toContain("在线演示");
    expect(folderTree.children.length).toBeGreaterThan(0);
    expect(timelines.length).toBeGreaterThanOrEqual(6);
    expect(options.currentFormat).toBe("mp4");
    expect(options.currentCodec).toBe("h265");

    const exportRequest = bridge.runBatchExport({
      selectedTimelines: timelines.slice(0, 2),
      outputDirectory: "D:\\DV-EXPORT\\演示输出",
      namingTemplate: "{timeline}_{index}",
      settings: {
        presetName: "",
        format: "mp4",
        codec: "h265",
        resolution: { width: 3840, height: 2160 },
        frameRate: 25,
        exportVideo: true,
        exportAudio: true
      }
    });

    await vi.runAllTimersAsync();
    const result = await exportRequest;

    expect(result.startedJobs).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.results[0].jobId).toBe("DEMO-JOB-001");
    expect(result.results[0].outputName).toContain("_01");
  });

  it("模拟创建新帧率时间线并刷新时间线列表", async () => {
    vi.useFakeTimers();
    const bridge = createDemoResolveBridge();
    const timelineRequest = bridge.getAllTimelines();
    await vi.runAllTimersAsync();
    const timelines = await timelineRequest;
    const sourceTimeline = timelines.find((timeline) => timeline.frameRate === 25)!;

    const conversionRequest = bridge.convertTimelineFrameRates({
      selectedTimelines: [sourceTimeline],
      targetFrameRate: 30,
      strategy: "resolve-ui-copy-paste",
      destinationFolderName: "30fps 交付"
    });
    await vi.runAllTimersAsync();
    const conversion = await conversionRequest;

    expect(conversion.converted).toBe(1);
    expect(conversion.results[0].newTimelineName).toContain("30fps");
    expect(conversion.results[0].targetFolderName).toBe("30fps 交付");

    const refreshedRequest = bridge.getAllTimelines();
    await vi.runAllTimersAsync();
    const refreshedTimelines = await refreshedRequest;
    expect(refreshedTimelines).toHaveLength(timelines.length + 1);
  });
});
