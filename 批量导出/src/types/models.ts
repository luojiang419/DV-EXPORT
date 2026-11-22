export interface MediaPoolFolderNode {
  id: string;
  name: string;
  children: MediaPoolFolderNode[];
}

export interface TimelineEntry {
  id: string;
  name: string;
  folderId: string;
  mediaPoolItemId?: string;
  frameRate?: number;
  resolution?: ResolutionOption;
}

export interface TimelineCacheStatus {
  projectKey: string;
  folderCount: number;
  timelineCount: number;
}

export interface RenderPresetOption {
  id: string;
  label: string;
}

export interface RenderFormatOption {
  id: string;
  label: string;
  extension: string;
}

export interface RenderCodecOption {
  id: string;
  label: string;
}

export interface ResolutionOption {
  width: number;
  height: number;
}

export interface FrameRateOption {
  id: string;
  label: string;
  value: number;
}

export interface RenderOptionsResponse {
  presets: RenderPresetOption[];
  formats: RenderFormatOption[];
  codecs: RenderCodecOption[];
  resolutions: ResolutionOption[];
  frameRates: FrameRateOption[];
  currentFormat: string;
  currentCodec: string;
}

export interface RenderOptionsRequest {
  format?: string;
  codec?: string;
}

export interface EnvironmentInfo {
  productName: string;
  versionString: string;
  majorVersion: number;
  isStudio: boolean;
  projectName: string;
  pluginId: string;
}

export interface RenderProfile {
  presetName: string;
  format: string;
  codec: string;
  resolution: ResolutionOption;
  frameRate: number;
  exportVideo: boolean;
  exportAudio: boolean;
  audioCodec?: string;
  audioBitDepth?: number;
  audioSampleRate?: number;
  exportAlpha?: boolean;
}

export type FrameRateConversionStrategy = "resolve-render" | "ffmpeg-cfr" | "ffmpeg-motion" | "resolve-ui-copy-paste";

export interface ExportBatchRequest {
  selectedTimelines: TimelineEntry[];
  outputDirectory: string;
  namingTemplate: string;
  settings: RenderProfile;
}

export interface ExportBatchResultItem {
  timelineName: string;
  success: boolean;
  reason?: string;
  jobId?: string;
  outputName?: string;
}

export interface ExportBatchResponse {
  startedJobs: number;
  succeeded: number;
  failed: number;
  results: ExportBatchResultItem[];
}

export interface FrameRateConversionRequest {
  selectedTimelines: TimelineEntry[];
  targetFrameRate: number;
  outputDirectory?: string;
  namingTemplate?: string;
  settings?: RenderProfile;
  strategy?: FrameRateConversionStrategy;
  keepIntermediateFiles?: boolean;
  destinationFolderName?: string;
}

export type FrameRateConversionStatus = "queued" | "rendering" | "converted" | "skipped" | "failed";

export interface FrameRateConversionValidation {
  outputFrameRate?: number;
  durationSeconds?: number;
  hasAudio?: boolean;
}

export interface FrameRateMediaProbeRequest {
  filePath: string;
}

export interface FrameRateMediaProbeResponse extends FrameRateConversionValidation {
  filePath: string;
  width?: number;
  height?: number;
  videoCodec?: string;
  audioCodec?: string;
}

export interface FfmpegFrameRateConversionRequest {
  inputPath: string;
  outputPath: string;
  targetFrameRate: number;
  strategy: Extract<FrameRateConversionStrategy, "ffmpeg-cfr" | "ffmpeg-motion">;
  overwrite?: boolean;
  videoCodec?: string;
  audioCodec?: string;
  keepSourceAudio?: boolean;
}

export interface FfmpegFrameRateConversionResponse {
  outputPath: string;
  targetFrameRate: number;
  strategy: Extract<FrameRateConversionStrategy, "ffmpeg-cfr" | "ffmpeg-motion">;
  validation: FrameRateMediaProbeResponse;
  stderr?: string;
}

export interface FrameRateConversionResultItem {
  timelineName: string;
  status: FrameRateConversionStatus;
  success: boolean;
  reason?: string;
  sourceFrameRate?: number;
  targetFrameRate?: number;
  strategy?: FrameRateConversionStrategy;
  jobId?: string;
  outputName?: string;
  outputPath?: string;
  intermediatePath?: string;
  validation?: FrameRateConversionValidation;
  newTimelineId?: string;
  newTimelineName?: string;
  targetFolderName?: string;
}

export interface FrameRateConversionResponse {
  targetFrameRate: number;
  queued?: number;
  rendering?: number;
  converted: number;
  skipped: number;
  failed: number;
  results: FrameRateConversionResultItem[];
}
