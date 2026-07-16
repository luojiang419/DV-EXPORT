import type {
  EnvironmentInfo,
  ExportBatchRequest,
  ExportBatchResponse,
  FfmpegFrameRateConversionRequest,
  FfmpegFrameRateConversionResponse,
  FrameRateMediaProbeRequest,
  FrameRateMediaProbeResponse,
  FrameRateConversionRequest,
  FrameRateConversionResponse,
  MediaPoolFolderNode,
  RenderOptionsRequest,
  RenderOptionsResponse,
  TimelineCacheStatus,
  TimelineEntry
} from "./models";

export interface ResolveBridge {
  getEnvironment(): Promise<EnvironmentInfo>;
  getMediaPoolTree(): Promise<MediaPoolFolderNode>;
  getFolderTimelines(folderId: string): Promise<TimelineEntry[]>;
  getAllTimelines(): Promise<TimelineEntry[]>;
  prepareTimelineCache(forceRefresh?: boolean): Promise<TimelineCacheStatus>;
  getRenderOptions(selection?: RenderOptionsRequest): Promise<RenderOptionsResponse>;
  chooseOutputDirectory(): Promise<string | null>;
  runBatchExport(payload: ExportBatchRequest): Promise<ExportBatchResponse>;
  probeMediaFile(payload: FrameRateMediaProbeRequest): Promise<FrameRateMediaProbeResponse>;
  convertFrameRateWithFfmpeg(payload: FfmpegFrameRateConversionRequest): Promise<FfmpegFrameRateConversionResponse>;
  convertTimelineFrameRates(payload: FrameRateConversionRequest): Promise<FrameRateConversionResponse>;
}
