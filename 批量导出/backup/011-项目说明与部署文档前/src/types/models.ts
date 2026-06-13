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
