import { formatNamingTemplate } from "../core/naming";
import type {
  FfmpegFrameRateConversionRequest,
  FrameRateConversionRequest,
  MediaPoolFolderNode,
  RenderOptionsRequest,
  RenderOptionsResponse,
  TimelineEntry
} from "../types/models";
import type { ResolveBridge } from "../types/resolve";

const projectName = "城市节奏_品牌宣传片";

const folderTree: MediaPoolFolderNode = {
  id: "root",
  name: "城市节奏_品牌宣传片",
  children: [
    {
      id: "campaign",
      name: "01_品牌主片",
      children: [
        { id: "campaign-master", name: "主版本", children: [] },
        { id: "campaign-review", name: "审片版本", children: [] }
      ]
    },
    {
      id: "social",
      name: "02_社交媒体",
      children: [
        { id: "social-vertical", name: "竖屏短片", children: [] },
        { id: "social-horizontal", name: "横屏短片", children: [] }
      ]
    },
    { id: "archive", name: "99_历史版本", children: [] }
  ]
};

const initialTimelines: TimelineEntry[] = [
  {
    id: "timeline-master-4k",
    name: "城市节奏_主片_4K",
    folderId: "campaign-master",
    frameRate: 25,
    resolution: { width: 3840, height: 2160 }
  },
  {
    id: "timeline-master-clean",
    name: "城市节奏_主片_无字幕",
    folderId: "campaign-master",
    frameRate: 25,
    resolution: { width: 3840, height: 2160 }
  },
  {
    id: "timeline-review-v8",
    name: "城市节奏_审片_V08",
    folderId: "campaign-review",
    frameRate: 25,
    resolution: { width: 1920, height: 1080 }
  },
  {
    id: "timeline-douyin",
    name: "城市节奏_抖音_15s",
    folderId: "social-vertical",
    frameRate: 30,
    resolution: { width: 1080, height: 1920 }
  },
  {
    id: "timeline-redbook",
    name: "城市节奏_小红书_30s",
    folderId: "social-vertical",
    frameRate: 30,
    resolution: { width: 1080, height: 1920 }
  },
  {
    id: "timeline-bilibili",
    name: "城市节奏_B站_60s",
    folderId: "social-horizontal",
    frameRate: 25,
    resolution: { width: 1920, height: 1080 }
  },
  {
    id: "timeline-archive",
    name: "城市节奏_主片_V05_归档",
    folderId: "archive",
    frameRate: 25,
    resolution: { width: 1920, height: 1080 }
  }
];

const presets = [
  { id: "youtube-4k", label: "YouTube 2160p" },
  { id: "h264-master", label: "H.264 Master" },
  { id: "review-copy", label: "审片小样" }
];

const formats = [
  { id: "mp4", label: "MP4", extension: "mp4" },
  { id: "mov", label: "QuickTime", extension: "mov" },
  { id: "mxf", label: "MXF OP1A", extension: "mxf" }
];

const codecsByFormat: Record<string, RenderOptionsResponse["codecs"]> = {
  mp4: [
    { id: "h264", label: "H.264" },
    { id: "h265", label: "H.265" }
  ],
  mov: [
    { id: "dnxhr-hqx", label: "DNxHR HQX" },
    { id: "h264", label: "H.264" }
  ],
  mxf: [
    { id: "dnxhr-hq", label: "DNxHR HQ" },
    { id: "dnxhr-hqx", label: "DNxHR HQX" }
  ]
};

const resolutions = [
  { width: 1280, height: 720 },
  { width: 1920, height: 1080 },
  { width: 1080, height: 1920 },
  { width: 3840, height: 2160 }
];

const frameRates = [
  { id: "23.976", label: "23.976 fps", value: 23.976 },
  { id: "24", label: "24 fps", value: 24 },
  { id: "25", label: "25 fps", value: 25 },
  { id: "30", label: "30 fps", value: 30 },
  { id: "50", label: "50 fps", value: 50 },
  { id: "60", label: "60 fps", value: 60 }
];

function clone<T>(value: T): T {
  return structuredClone(value);
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
}

function countFolders(node: MediaPoolFolderNode): number {
  return 1 + node.children.reduce((total, child) => total + countFolders(child), 0);
}

function findFolderName(node: MediaPoolFolderNode, folderId: string): string | null {
  if (node.id === folderId) {
    return node.name;
  }

  for (const child of node.children) {
    const name = findFolderName(child, folderId);
    if (name) {
      return name;
    }
  }

  return null;
}

function createRenderOptions(selection: RenderOptionsRequest = {}): RenderOptionsResponse {
  const currentFormat = formats.some((format) => format.id === selection.format) ? selection.format! : "mp4";
  const codecs = codecsByFormat[currentFormat] ?? codecsByFormat.mp4;
  const currentCodec = codecs.some((codec) => codec.id === selection.codec) ? selection.codec! : codecs[0].id;

  return {
    presets: clone(presets),
    formats: clone(formats),
    codecs: clone(codecs),
    resolutions: clone(resolutions),
    frameRates: clone(frameRates),
    currentFormat,
    currentCodec
  };
}

export function createDemoResolveBridge(): ResolveBridge {
  let timelines = clone(initialTimelines);
  let generatedTimelineIndex = 1;

  return {
    async getEnvironment() {
      await wait(140);
      return {
        productName: "DaVinci Resolve Studio",
        versionString: "20.2.3（在线演示）",
        majorVersion: 20,
        isStudio: true,
        projectName,
        pluginId: "com.dvexport.batch-export.demo"
      };
    },

    async getMediaPoolTree() {
      await wait(180);
      return clone(folderTree);
    },

    async getFolderTimelines(folderId) {
      await wait(220);
      return clone(timelines.filter((timeline) => timeline.folderId === folderId));
    },

    async getAllTimelines() {
      await wait(240);
      return clone(timelines);
    },

    async prepareTimelineCache() {
      await wait(320);
      return {
        projectKey: "demo-project",
        folderCount: countFolders(folderTree),
        timelineCount: timelines.length
      };
    },

    async getRenderOptions(selection) {
      await wait(120);
      return createRenderOptions(selection);
    },

    async chooseOutputDirectory() {
      await wait(160);
      return "D:\\DV-EXPORT\\演示输出";
    },

    async runBatchExport(payload) {
      await wait(720);
      const results = payload.selectedTimelines.map((timeline, index) => ({
        timelineName: timeline.name,
        success: true,
        jobId: `DEMO-JOB-${String(index + 1).padStart(3, "0")}`,
        outputName: formatNamingTemplate(payload.namingTemplate, {
          timeline: timeline.name,
          project: projectName,
          index: index + 1,
          now: new Date("2026-07-14T10:30:00")
        })
      }));

      return {
        startedJobs: results.length,
        succeeded: results.length,
        failed: 0,
        results
      };
    },

    async probeMediaFile(payload) {
      await wait(180);
      return {
        filePath: payload.filePath,
        outputFrameRate: 25,
        durationSeconds: 32.48,
        hasAudio: true,
        width: 1920,
        height: 1080,
        videoCodec: "h264",
        audioCodec: "aac"
      };
    },

    async convertFrameRateWithFfmpeg(payload: FfmpegFrameRateConversionRequest) {
      await wait(520);
      return {
        outputPath: payload.outputPath,
        targetFrameRate: payload.targetFrameRate,
        strategy: payload.strategy,
        validation: {
          filePath: payload.outputPath,
          outputFrameRate: payload.targetFrameRate,
          durationSeconds: 32.48,
          hasAudio: true,
          width: 1920,
          height: 1080,
          videoCodec: payload.videoCodec || "h264",
          audioCodec: payload.audioCodec || "aac"
        }
      };
    },

    async convertTimelineFrameRates(payload: FrameRateConversionRequest) {
      await wait(760);
      const results = payload.selectedTimelines.map((timeline) => {
        if (timeline.frameRate && Math.abs(timeline.frameRate - payload.targetFrameRate) < 0.001) {
          return {
            timelineName: timeline.name,
            status: "skipped" as const,
            success: false,
            reason: `原时间线已经是 ${payload.targetFrameRate} fps。`,
            sourceFrameRate: timeline.frameRate,
            targetFrameRate: payload.targetFrameRate,
            strategy: payload.strategy
          };
        }

        const newTimelineName = `${timeline.name}_${payload.targetFrameRate}fps`;
        const newTimelineId = `demo-converted-${generatedTimelineIndex++}`;
        const targetFolderName =
          payload.destinationFolderName?.trim() || findFolderName(folderTree, timeline.folderId) || "演示媒体夹";

        timelines.push({
          ...timeline,
          id: newTimelineId,
          name: newTimelineName,
          frameRate: payload.targetFrameRate
        });

        return {
          timelineName: timeline.name,
          status: "converted" as const,
          success: true,
          sourceFrameRate: timeline.frameRate,
          targetFrameRate: payload.targetFrameRate,
          strategy: payload.strategy,
          newTimelineId,
          newTimelineName,
          targetFolderName
        };
      });

      return {
        targetFrameRate: payload.targetFrameRate,
        converted: results.filter((item) => item.status === "converted").length,
        skipped: results.filter((item) => item.status === "skipped").length,
        failed: 0,
        results
      };
    }
  };
}
