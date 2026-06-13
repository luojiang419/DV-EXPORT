import type {
  EnvironmentInfo,
  ExportBatchRequest,
  ExportBatchResponse,
  MediaPoolFolderNode,
  RenderOptionsRequest,
  RenderOptionsResponse,
  TimelineEntry
} from "./models";

export interface ResolveBridge {
  getEnvironment(): Promise<EnvironmentInfo>;
  getMediaPoolTree(): Promise<MediaPoolFolderNode>;
  getFolderTimelines(folderId: string): Promise<TimelineEntry[]>;
  getRenderOptions(selection?: RenderOptionsRequest): Promise<RenderOptionsResponse>;
  chooseOutputDirectory(): Promise<string | null>;
  runBatchExport(payload: ExportBatchRequest): Promise<ExportBatchResponse>;
}
