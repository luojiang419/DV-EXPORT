import { useEffect, useMemo, useRef, useState } from "react";
import { createExportJobPlans } from "../core/exportPlanner";
import { loadPersistedExportSettings, savePersistedExportSettings } from "../core/exportSettingsStorage";
import { formatNamingTemplate } from "../core/naming";
import { computeNextSelection } from "../core/timelineSelection";
import { getResolveBridge } from "../plugin/resolveBridge";
import { getUpdateBridge } from "../plugin/updateBridge";
import type {
  EnvironmentInfo,
  ExportBatchResponse,
  FrameRateConversionResponse,
  FrameRateConversionStrategy,
  MediaPoolFolderNode,
  RenderOptionsResponse,
  RenderProfile,
  TimelineEntry
} from "../types/models";
import type { UpdateSettings, UpdateState } from "../types/update";
import { ExportSummary } from "../ui/components/ExportSummary";
import { FrameRateConversionPanel } from "../ui/components/FrameRateConversionPanel";
import { FolderTree } from "../ui/components/FolderTree";
import { RenderSettingsPanel } from "../ui/components/RenderSettingsPanel";
import { StatusBanner } from "../ui/components/StatusBanner";
import { TimelineList } from "../ui/components/TimelineList";
import { UpdatePrompt } from "../ui/components/UpdatePrompt";
import { UpdateSettingsModal } from "../ui/components/UpdateSettingsModal";

const emptyProfile: RenderProfile = {
  presetName: "",
  format: "",
  codec: "",
  resolution: {
    width: 1920,
    height: 1080
  },
  frameRate: 24,
  exportVideo: true,
  exportAudio: true
};
const defaultNamingTemplate = "{timeline}_{date}_{index}";
const isDemoMode = import.meta.env.MODE === "demo";
const defaultUpdateSettings: UpdateSettings = {
  updatePolicy: "automatic",
  updateNetworkMode: "automaticProxy",
  manualProxyUrl: "http://127.0.0.1:7890"
};

function sameResolution(left: RenderProfile["resolution"], right: RenderProfile["resolution"]) {
  return left.width === right.width && left.height === right.height;
}

function ensureFrameRateOption(options: RenderOptionsResponse, frameRate?: number | null): RenderOptionsResponse {
  if (!frameRate || options.frameRates.some((item) => item.value === frameRate)) {
    return options;
  }

  return {
    ...options,
    frameRates: [...options.frameRates, { id: String(frameRate), label: `${frameRate} fps`, value: frameRate }].sort(
      (left, right) => left.value - right.value
    )
  };
}

export function ensureResolutionOption(
  options: RenderOptionsResponse,
  resolution?: RenderProfile["resolution"] | null
): RenderOptionsResponse {
  if (!resolution || options.resolutions.some((item) => sameResolution(item, resolution))) {
    return options;
  }

  return {
    ...options,
    resolutions: [...options.resolutions, resolution].sort(
      (left, right) => left.width * left.height - right.width * right.height || left.width - right.width
    )
  };
}

export function ensureTimelineRenderOptions(
  options: RenderOptionsResponse,
  timeline: TimelineEntry
): RenderOptionsResponse {
  return ensureFrameRateOption(ensureResolutionOption(options, timeline.resolution), timeline.frameRate);
}

export function getPrimarySelectedTimeline(timelines: TimelineEntry[], selectedTimelineIds: string[]) {
  for (const timeline of timelines) {
    if (selectedTimelineIds.includes(timeline.id)) {
      return timeline;
    }
  }

  return null;
}

function createFrameRateInputValue(frameRate: number | null | undefined): string {
  return Number.isFinite(frameRate) && Number(frameRate) > 0 ? String(frameRate) : "";
}

function parseFrameRateInput(value: string): number {
  const frameRate = Number(value);
  return Number.isFinite(frameRate) && frameRate > 0 ? frameRate : Number.NaN;
}

function formatFrameRate(frameRate: number): string {
  return `${frameRate} fps`;
}

function getSelectedTimelineSourceFrameRateLabel(selectedTimelines: TimelineEntry[]): string {
  if (selectedTimelines.length === 0) {
    return "未选择";
  }

  const knownFrameRates = selectedTimelines
    .map((timeline) => timeline.frameRate)
    .filter((frameRate): frameRate is number => Number.isFinite(frameRate) && Number(frameRate) > 0);

  if (knownFrameRates.length === 0) {
    return "未知帧率";
  }

  const uniqueFrameRates: number[] = [];
  for (const frameRate of knownFrameRates) {
    if (!uniqueFrameRates.some((knownFrameRate) => Math.abs(knownFrameRate - frameRate) < 0.001)) {
      uniqueFrameRates.push(frameRate);
    }
  }

  if (uniqueFrameRates.length === 1) {
    const suffix = knownFrameRates.length === selectedTimelines.length ? "" : " / 部分未知";
    return `${formatFrameRate(uniqueFrameRates[0])}${suffix}`;
  }

  return "多种帧率";
}

function folderTreeContainsId(tree: MediaPoolFolderNode | null, folderId: string | null): folderId is string {
  if (!tree || !folderId) {
    return false;
  }

  if (tree.id === folderId) {
    return true;
  }

  return tree.children.some((child) => folderTreeContainsId(child, folderId));
}

function syncRenderProfile(
  currentProfile: RenderProfile,
  options: RenderOptionsResponse,
  hasManualPresetSelection: boolean,
  fallbackProfile: RenderProfile
): RenderProfile {
  const nextFormat = options.currentFormat || options.formats[0]?.id || currentProfile.format || fallbackProfile.format;
  const nextCodec = options.currentCodec || options.codecs[0]?.id || currentProfile.codec || fallbackProfile.codec;
  const nextResolution =
    options.resolutions.find((resolution) => sameResolution(resolution, currentProfile.resolution)) ||
    options.resolutions[0] ||
    currentProfile.resolution ||
    fallbackProfile.resolution;
  const nextFrameRate =
    options.frameRates.find((frameRate) => frameRate.value === currentProfile.frameRate)?.value ||
    currentProfile.frameRate ||
    fallbackProfile.frameRate ||
    options.frameRates[0]?.value;
  const nextPreset = hasManualPresetSelection
    ? options.presets.find((preset) => preset.id === currentProfile.presetName)?.id || ""
    : "";

  return {
    ...currentProfile,
    presetName: nextPreset,
    format: nextFormat,
    codec: nextCodec,
    resolution: nextResolution,
    frameRate: nextFrameRate
  };
}

function getExportDisabledReason(args: {
  environment: EnvironmentInfo | null;
  selectedTimelines: TimelineEntry[];
  outputDirectory: string;
  renderProfile: RenderProfile;
  isPreparingTimelineCache: boolean;
  isScanningTimelines: boolean;
  isExporting: boolean;
  isConvertingFrameRate: boolean;
}) {
  if (args.isExporting) {
    return "正在创建并启动导出任务。";
  }

  if (args.isConvertingFrameRate) {
    return "正在转换时间线帧率。";
  }

  if (!args.environment) {
    return "正在连接 Resolve 工程。";
  }

  if (!args.environment.isStudio || args.environment.majorVersion < 19) {
    return "需要 DaVinci Resolve Studio 19 或更高版本。";
  }

  if (args.isPreparingTimelineCache) {
    return "正在读取项目时间线缓存。";
  }

  if (args.isScanningTimelines) {
    return "正在读取时间线列表。";
  }

  if (args.selectedTimelines.length === 0) {
    return "请选择至少一条时间线。";
  }

  if (!args.outputDirectory) {
    return "请选择导出目录。";
  }

  if (!args.renderProfile.format) {
    return "请选择导出格式。";
  }

  if (!args.renderProfile.codec) {
    return "请选择编码器。";
  }

  if (!args.renderProfile.exportVideo && !args.renderProfile.exportAudio) {
    return "请至少开启视频或音频导出。";
  }

  return "";
}

function getFrameRateConversionDisabledReason(args: {
  environment: EnvironmentInfo | null;
  selectedTimelines: TimelineEntry[];
  targetFrameRate: number;
  isPreparingTimelineCache: boolean;
  isScanningTimelines: boolean;
  isExporting: boolean;
  isConvertingFrameRate: boolean;
}) {
  if (args.isConvertingFrameRate) {
    return "正在转换时间线帧率。";
  }

  if (args.isExporting) {
    return "正在批量导出，请等待导出任务创建完成。";
  }

  if (!args.environment) {
    return "正在连接 Resolve 工程。";
  }

  if (!args.environment.isStudio || args.environment.majorVersion < 19) {
    return "需要 DaVinci Resolve Studio 19 或更高版本。";
  }

  if (args.isPreparingTimelineCache) {
    return "正在读取项目时间线缓存。";
  }

  if (args.isScanningTimelines) {
    return "正在读取时间线列表。";
  }

  if (args.selectedTimelines.length === 0) {
    return "请选择至少一条时间线。";
  }

  if (!Number.isFinite(args.targetFrameRate) || args.targetFrameRate <= 0) {
    return "请选择有效的目标帧率。";
  }

  return "";
}

export function App() {
  const bridge = useMemo(() => getResolveBridge(), []);
  const updateBridge = useMemo(() => getUpdateBridge(), []);
  const persistedSettings = useMemo(() => loadPersistedExportSettings(emptyProfile, defaultNamingTemplate), []);
  const [hasManualPresetSelection, setHasManualPresetSelection] = useState(persistedSettings.hasManualPresetSelection);
  const [showAllTimelines, setShowAllTimelines] = useState(
    isDemoMode ? true : persistedSettings.showAllTimelines
  );
  const [environment, setEnvironment] = useState<EnvironmentInfo | null>(null);
  const [folderTree, setFolderTree] = useState<MediaPoolFolderNode | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [timelines, setTimelines] = useState<TimelineEntry[]>([]);
  const [timelineSearchQuery, setTimelineSearchQuery] = useState("");
  const [allTimelinesForSearch, setAllTimelinesForSearch] = useState<TimelineEntry[] | null>(null);
  const [selectedTimelineIds, setSelectedTimelineIds] = useState<string[]>([]);
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(null);
  const [renderOptions, setRenderOptions] = useState<RenderOptionsResponse | null>(null);
  const [renderProfile, setRenderProfile] = useState<RenderProfile>(persistedSettings.renderProfile);
  const [outputDirectory, setOutputDirectory] = useState(
    isDemoMode ? persistedSettings.outputDirectory || "D:\\DV-EXPORT\\演示输出" : persistedSettings.outputDirectory
  );
  const [namingTemplate, setNamingTemplate] = useState(persistedSettings.namingTemplate);
  const [lastResult, setLastResult] = useState<ExportBatchResponse | null>(null);
  const [activeRightTab, setActiveRightTab] = useState<"export" | "conversion">("export");
  const [conversionTargetFrameRateInput, setConversionTargetFrameRateInput] = useState(
    createFrameRateInputValue(persistedSettings.renderProfile.frameRate)
  );
  const [conversionFolderName, setConversionFolderName] = useState("");
  const [conversionStrategy, setConversionStrategy] = useState<FrameRateConversionStrategy>("resolve-ui-copy-paste");
  const [lastConversionResult, setLastConversionResult] = useState<FrameRateConversionResponse | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isConvertingFrameRate, setIsConvertingFrameRate] = useState(false);
  const [isPreparingTimelineCache, setIsPreparingTimelineCache] = useState(true);
  const [isScanningTimelines, setIsScanningTimelines] = useState(false);
  const [isLoadingTimelineSearchScope, setIsLoadingTimelineSearchScope] = useState(false);
  const [error, setError] = useState("");
  const [updateSettings, setUpdateSettings] = useState<UpdateSettings>(defaultUpdateSettings);
  const [updateState, setUpdateState] = useState<UpdateState | null>(null);
  const [isUpdateSettingsOpen, setIsUpdateSettingsOpen] = useState(false);
  const [isUpdateActionBusy, setIsUpdateActionBusy] = useState(false);
  const allTimelineCacheRef = useRef<TimelineEntry[] | null>(null);
  const allTimelineRequestRef = useRef<Promise<TimelineEntry[]> | null>(null);
  const folderTimelineCacheRef = useRef<Record<string, TimelineEntry[]>>({});
  const timelineCacheVersionRef = useRef(0);
  const timelineSearchLoadFailedRef = useRef(false);

  useEffect(() => {
    if (!updateBridge) {
      return;
    }

    let isCancelled = false;
    const unsubscribe = updateBridge.onStateChanged((nextState) => {
      if (!isCancelled) {
        setUpdateState(nextState);
      }
    });

    void Promise.all([updateBridge.getSettings(), updateBridge.getState()])
      .then(([settings, state]) => {
        if (!isCancelled) {
          setUpdateSettings(settings);
          setUpdateState(state);
        }
      })
      .catch((updateError) => {
        if (!isCancelled) {
          setUpdateState({
            currentVersion: "-",
            status: "error",
            message: updateError instanceof Error ? updateError.message : "更新服务初始化失败。",
            progress: 0
          });
        }
      });

    return () => {
      isCancelled = true;
      unsubscribe();
    };
  }, [updateBridge]);

  function commitTimelineView(nextTimelines: TimelineEntry[], options: { resetSelection?: boolean } = {}) {
    const availableTimelineIds = new Set(nextTimelines.map((timeline) => timeline.id));
    setTimelines(nextTimelines);

    if (options.resetSelection) {
      setSelectedTimelineIds([]);
      setSelectionAnchorId(null);
      return;
    }

    setSelectedTimelineIds((currentIds) => currentIds.filter((timelineId) => availableTimelineIds.has(timelineId)));
    setSelectionAnchorId((currentAnchorId) =>
      currentAnchorId && availableTimelineIds.has(currentAnchorId) ? currentAnchorId : null
    );
  }

  function clearTimelineViewCaches() {
    timelineCacheVersionRef.current += 1;
    allTimelineCacheRef.current = null;
    allTimelineRequestRef.current = null;
    setAllTimelinesForSearch(null);
    folderTimelineCacheRef.current = {};
    timelineSearchLoadFailedRef.current = false;
  }

  function loadAllTimelines() {
    if (allTimelineCacheRef.current !== null) {
      setAllTimelinesForSearch(allTimelineCacheRef.current);
      return Promise.resolve(allTimelineCacheRef.current);
    }

    if (allTimelineRequestRef.current) {
      return allTimelineRequestRef.current;
    }

    const cacheVersion = timelineCacheVersionRef.current;
    const request = bridge
      .getAllTimelines()
      .then((nextTimelines) => {
        if (cacheVersion === timelineCacheVersionRef.current) {
          allTimelineCacheRef.current = nextTimelines;
          setAllTimelinesForSearch(nextTimelines);
        }
        return nextTimelines;
      })
      .finally(() => {
        if (cacheVersion === timelineCacheVersionRef.current) {
          allTimelineRequestRef.current = null;
        }
      });
    allTimelineRequestRef.current = request;
    return request;
  }

  function loadFolderTimelines(folderId: string) {
    const cachedTimelines = folderTimelineCacheRef.current[folderId];
    if (cachedTimelines) {
      return Promise.resolve(cachedTimelines);
    }

    const cacheVersion = timelineCacheVersionRef.current;
    return bridge.getFolderTimelines(folderId).then((nextTimelines) => {
      if (cacheVersion === timelineCacheVersionRef.current) {
        folderTimelineCacheRef.current[folderId] = nextTimelines;
      }
      return nextTimelines;
    });
  }

  useEffect(() => {
    let isCancelled = false;

    async function prepareTimelineCache() {
      try {
        setIsPreparingTimelineCache(true);
        await new Promise((resolve) => window.setTimeout(resolve, 16));
        await bridge.prepareTimelineCache();
        void loadAllTimelines().catch(() => undefined);
      } catch (cacheError) {
        if (!isCancelled) {
          setError(cacheError instanceof Error ? cacheError.message : "读取时间线信息失败。");
        }
      } finally {
        if (!isCancelled) {
          setIsPreparingTimelineCache(false);
        }
      }
    }

    void prepareTimelineCache();

    return () => {
      isCancelled = true;
    };
  }, [bridge]);

  useEffect(() => {
    async function bootstrap() {
      try {
        const [env, tree, options] = await Promise.all([
          bridge.getEnvironment(),
          bridge.getMediaPoolTree(),
          bridge.getRenderOptions()
        ]);
        setEnvironment(env);
        setFolderTree(tree);
        setRenderOptions(ensureFrameRateOption(options, persistedSettings.renderProfile.frameRate));
        setRenderProfile((currentProfile) =>
          syncRenderProfile(currentProfile, options, hasManualPresetSelection, emptyProfile)
        );
      } catch (bootstrapError) {
        setError(bootstrapError instanceof Error ? bootstrapError.message : "初始化插件失败。");
      }
    }

    void bootstrap();
  }, [bridge, hasManualPresetSelection, persistedSettings.renderProfile.frameRate]);

  useEffect(() => {
    const format = renderProfile.format;
    if (!format) {
      return;
    }

    let isCancelled = false;

    async function loadDependentRenderOptions() {
      try {
        const nextOptions = await bridge.getRenderOptions({
          format: renderProfile.format,
          codec: renderProfile.codec
        });
        if (isCancelled) {
          return;
        }
        setRenderOptions(ensureFrameRateOption(nextOptions, renderProfile.frameRate));
        setRenderProfile((currentProfile) =>
          syncRenderProfile(currentProfile, nextOptions, hasManualPresetSelection, emptyProfile)
        );
      } catch (optionsError) {
        if (!isCancelled) {
          setError(optionsError instanceof Error ? optionsError.message : "读取导出设置失败。");
        }
      }
    }

    void loadDependentRenderOptions();

    return () => {
      isCancelled = true;
    };
  }, [bridge, hasManualPresetSelection, renderProfile.codec, renderProfile.format]);

  useEffect(() => {
    let isCancelled = false;

    async function loadTimelines() {
      const currentFolderId = selectedFolderId;
      const cachedAllTimelines = allTimelineCacheRef.current;
      const cacheVersion = timelineCacheVersionRef.current;

      if (showAllTimelines && cachedAllTimelines !== null) {
        commitTimelineView(cachedAllTimelines);
        setIsScanningTimelines(false);
        return;
      }

      if (!showAllTimelines && !currentFolderId) {
        commitTimelineView([]);
        setIsScanningTimelines(false);
        return;
      }

      const cachedFolderTimelines = currentFolderId ? folderTimelineCacheRef.current[currentFolderId] : null;
      if (!showAllTimelines && cachedFolderTimelines) {
        commitTimelineView(cachedFolderTimelines);
        setIsScanningTimelines(false);
        return;
      }

      try {
        setError("");
        setIsScanningTimelines(true);
        const nextTimelines = showAllTimelines
          ? await loadAllTimelines()
          : currentFolderId
            ? await loadFolderTimelines(currentFolderId)
            : [];
        if (isCancelled || cacheVersion !== timelineCacheVersionRef.current) {
          return;
        }
        commitTimelineView(nextTimelines);
      } catch (timelineError) {
        if (!isCancelled) {
          setError(timelineError instanceof Error ? timelineError.message : "读取时间线列表失败。");
        }
      } finally {
        if (!isCancelled) {
          setIsScanningTimelines(false);
        }
      }
    }

    void loadTimelines();

    return () => {
      isCancelled = true;
    };
  }, [bridge, selectedFolderId, showAllTimelines]);

  useEffect(() => {
    savePersistedExportSettings({
      hasManualPresetSelection,
      showAllTimelines,
      renderProfile,
      outputDirectory,
      namingTemplate
    });
  }, [hasManualPresetSelection, namingTemplate, outputDirectory, renderProfile, showAllTimelines]);

  const normalizedTimelineSearchQuery = timelineSearchQuery.trim().toLocaleLowerCase();
  const isTimelineSearchActive = normalizedTimelineSearchQuery.length > 0;
  const timelineSearchSource = isTimelineSearchActive ? allTimelinesForSearch ?? [] : timelines;
  const visibleTimelines = useMemo(() => {
    if (!isTimelineSearchActive) {
      return timelines;
    }

    return timelineSearchSource.filter((timeline) =>
      timeline.name.toLocaleLowerCase().includes(normalizedTimelineSearchQuery)
    );
  }, [isTimelineSearchActive, normalizedTimelineSearchQuery, timelineSearchSource, timelines]);
  const selectedTimelineSource = useMemo(() => {
    const entriesByTimelineId = new Map<string, TimelineEntry>();
    for (const timeline of timelines) {
      entriesByTimelineId.set(timeline.id, timeline);
    }

    for (const timeline of allTimelinesForSearch ?? []) {
      entriesByTimelineId.set(timeline.id, timeline);
    }

    return Array.from(entriesByTimelineId.values());
  }, [allTimelinesForSearch, timelines]);
  const selectedTimelines = selectedTimelineSource.filter((timeline) => selectedTimelineIds.includes(timeline.id));

  useEffect(() => {
    const selectedTimeline = getPrimarySelectedTimeline(selectedTimelineSource, selectedTimelineIds);
    if (!selectedTimeline) {
      return;
    }

    setRenderOptions((currentOptions) =>
      currentOptions ? ensureTimelineRenderOptions(currentOptions, selectedTimeline) : currentOptions
    );
    setRenderProfile((currentProfile) => {
      const nextFrameRate = selectedTimeline.frameRate || currentProfile.frameRate;
      const nextResolution = selectedTimeline.resolution || currentProfile.resolution;
      if (currentProfile.frameRate === nextFrameRate && sameResolution(currentProfile.resolution, nextResolution)) {
        return currentProfile;
      }

      return {
        ...currentProfile,
        resolution: nextResolution,
        frameRate: nextFrameRate
      };
    });
  }, [selectedTimelineIds, selectedTimelineSource]);

  useEffect(() => {
    if (!isTimelineSearchActive || allTimelinesForSearch !== null || timelineSearchLoadFailedRef.current) {
      return;
    }

    let isCancelled = false;

    async function loadTimelineSearchScope() {
      try {
        setIsLoadingTimelineSearchScope(true);
        const nextTimelines = await loadAllTimelines();
        if (!isCancelled) {
          setAllTimelinesForSearch(nextTimelines);
        }
      } catch (searchScopeError) {
        if (!isCancelled) {
          timelineSearchLoadFailedRef.current = true;
          setError(searchScopeError instanceof Error ? searchScopeError.message : "读取全部时间线搜索范围失败。");
        }
      } finally {
        if (!isCancelled) {
          setIsLoadingTimelineSearchScope(false);
        }
      }
    }

    void loadTimelineSearchScope();

    return () => {
      isCancelled = true;
    };
  }, [allTimelinesForSearch, isTimelineSearchActive, normalizedTimelineSearchQuery]);

  const selectedTimelineSourceFrameRateLabel = getSelectedTimelineSourceFrameRateLabel(selectedTimelines);
  const conversionTargetFrameRate = parseFrameRateInput(conversionTargetFrameRateInput);
  const previewName =
    environment && selectedTimelines[0]
      ? formatNamingTemplate(namingTemplate, {
          timeline: selectedTimelines[0].name,
          project: environment.projectName,
          index: 1
        })
      : "";
  const exportDisabledReason = getExportDisabledReason({
    environment,
    selectedTimelines,
    outputDirectory,
    renderProfile,
    isPreparingTimelineCache,
    isScanningTimelines: isScanningTimelines || isLoadingTimelineSearchScope,
    isExporting,
    isConvertingFrameRate
  });
  const frameRateConversionDisabledReason = getFrameRateConversionDisabledReason({
    environment,
    selectedTimelines,
    targetFrameRate: conversionTargetFrameRate,
    isPreparingTimelineCache,
    isScanningTimelines: isScanningTimelines || isLoadingTimelineSearchScope,
    isExporting,
    isConvertingFrameRate
  });

  async function chooseOutputDirectory() {
    const nextPath = await bridge.chooseOutputDirectory();
    if (nextPath) {
      setOutputDirectory(nextPath);
    }
  }

  async function refreshProjectData() {
    const folderId = selectedFolderId;
    const shouldShowAllTimelines = showAllTimelines;

    try {
      setError("");
      setIsPreparingTimelineCache(true);
      clearTimelineViewCaches();
      await bridge.prepareTimelineCache(true);
      const nextTree = await bridge.getMediaPoolTree();
      setFolderTree(nextTree);

      if (shouldShowAllTimelines) {
        if (!folderTreeContainsId(nextTree, folderId)) {
          setSelectedFolderId(null);
        }
        setIsScanningTimelines(true);
        const nextTimelines = await loadAllTimelines();
        commitTimelineView(nextTimelines);
        return;
      }

      if (!folderTreeContainsId(nextTree, folderId)) {
        setSelectedFolderId(null);
        commitTimelineView([]);
        return;
      }

      setIsScanningTimelines(true);
      const nextTimelines = await loadFolderTimelines(folderId);
      commitTimelineView(nextTimelines);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "刷新媒体池和时间线缓存失败。");
    } finally {
      setIsPreparingTimelineCache(false);
      setIsScanningTimelines(false);
    }
  }

  async function exportTimelines() {
    if (!environment || exportDisabledReason) {
      return;
    }

    try {
      setIsExporting(true);
      setError("");
      setLastResult(null);

      createExportJobPlans({
        timelines: selectedTimelines,
        profile: renderProfile,
        outputDirectory,
        namingTemplate,
        projectName: environment.projectName
      });

      const result = await bridge.runBatchExport({
        selectedTimelines,
        outputDirectory,
        namingTemplate,
        settings: renderProfile
      });
      setLastResult(result);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "批量导出失败。");
    } finally {
      setIsExporting(false);
    }
  }

  async function convertSelectedTimelineFrameRates() {
    if (!environment || frameRateConversionDisabledReason) {
      return;
    }

    try {
      setIsConvertingFrameRate(true);
      setError("");
      setLastConversionResult(null);

      const result = await bridge.convertTimelineFrameRates({
        selectedTimelines,
        targetFrameRate: conversionTargetFrameRate,
        strategy: conversionStrategy,
        destinationFolderName: conversionFolderName
      });
      setLastConversionResult(result);
      if (result.converted > 0) {
        await refreshProjectData();
      }
    } catch (conversionError) {
      setError(conversionError instanceof Error ? conversionError.message : "转换时间线帧率失败。");
    } finally {
      setIsConvertingFrameRate(false);
    }
  }

  async function deferReadyUpdate() {
    if (!updateBridge) {
      return;
    }

    try {
      setIsUpdateActionBusy(true);
      setUpdateState(await updateBridge.deferUpdate());
    } catch (updateError) {
      setUpdateState((current) => ({
        currentVersion: current?.currentVersion || "-",
        status: "error",
        message: updateError instanceof Error ? updateError.message : "延期更新失败。",
        progress: 0
      }));
    } finally {
      setIsUpdateActionBusy(false);
    }
  }

  async function installReadyUpdate() {
    if (!updateBridge) {
      return;
    }

    try {
      setIsUpdateActionBusy(true);
      await updateBridge.installUpdateNow();
    } catch (updateError) {
      setUpdateState((current) => ({
        currentVersion: current?.currentVersion || "-",
        status: "error",
        message: updateError instanceof Error ? updateError.message : "启动更新器失败。",
        progress: 0
      }));
      setIsUpdateActionBusy(false);
    }
  }

  const fixedActionDisabledReason =
    activeRightTab === "export" ? exportDisabledReason : frameRateConversionDisabledReason;
  const fixedActionLabel =
    activeRightTab === "export"
      ? isExporting
        ? "正在导出..."
        : "导出时间线"
      : isConvertingFrameRate
        ? "正在转换..."
        : "创建新时间线";
  const fixedActionTitle =
    activeRightTab === "export" ? "开始批量导出所选时间线" : "创建所选时间线的目标帧率可编辑副本";
  const fixedActionHandler = activeRightTab === "export" ? exportTimelines : convertSelectedTimelineFrameRates;
  const mediaPoolDescription = showAllTimelines
    ? "显示当前工程中的全部时间线"
    : "选择文件夹后，只显示该文件夹内的时间线";
  const timelineListDescription = isPreparingTimelineCache
    ? "正在读取时间线信息并建立缓存"
    : isTimelineSearchActive
      ? "正在全部时间线中搜索，支持单选、Ctrl/Command 多选、Shift 连选"
      : showAllTimelines
        ? "当前显示工程中的全部时间线，支持单选、Ctrl/Command 多选、Shift 连选"
        : "支持单选、Ctrl/Command 多选、Shift 连选";
  const hasTimelineSearchSource = Boolean(allTimelinesForSearch?.length);
  const isTimelineListLoading =
    isPreparingTimelineCache ||
    isScanningTimelines ||
    isLoadingTimelineSearchScope ||
    (isTimelineSearchActive && allTimelinesForSearch === null && !timelineSearchLoadFailedRef.current);
  const timelineEmptyMessage =
    isTimelineSearchActive
      ? hasTimelineSearchSource
        ? "没有匹配的时间线。"
        : "当前工程内没有可识别的时间线。"
      : showAllTimelines
        ? "当前工程内没有可识别的时间线。"
        : "当前文件夹内没有可识别的时间线。";

  function handleTimelineSelect(timelineId: string, modifiers: { ctrlKey: boolean; shiftKey: boolean }) {
    const next = computeNextSelection(
      visibleTimelines.map((timeline) => timeline.id),
      selectedTimelineIds,
      timelineId,
      selectionAnchorId,
      modifiers
    );
    setSelectedTimelineIds(next.selection);
    setSelectionAnchorId(next.anchorId);
  }

  return (
    <div className="shell">
      <header className="hero">
        <div>
          <div className="hero__eyebrow">
            DaVinci Resolve Workflow Integration
            {isDemoMode ? <span className="hero__demo-badge">在线模拟演示</span> : null}
          </div>
          <h1>达芬奇批量导出</h1>
          <p>按媒体池文件夹定位时间线，批量加入 Render Queue，并沿用统一的导出配置执行渲染。</p>
        </div>
        <div className="hero__meta">
          <div>项目：{environment?.projectName || "未连接"}</div>
          <div>版本：{environment?.versionString || "-"}</div>
          <div>产品：{environment?.productName || "-"}</div>
          {updateBridge ? (
            <button className="hero__settings" onClick={() => setIsUpdateSettingsOpen(true)} type="button">
              更新设置
              {updateState?.status === "ready" && !updateState.isDeferred ? <span className="hero__settings-badge" /> : null}
            </button>
          ) : null}
        </div>
      </header>

      {isDemoMode ? (
        <StatusBanner
          tone="neutral"
          title="安全演示模式"
          description="这里使用模拟工程数据。你可以自由选择时间线、调整导出参数并点击操作按钮；不会访问本机文件，也不会真正启动渲染。"
        />
      ) : null}

      {error ? (
        <StatusBanner tone="danger" title="操作失败" description={error} />
      ) : environment && (!environment.isStudio || environment.majorVersion < 19) ? (
        <StatusBanner
          tone="warning"
          title="环境限制"
          description="该插件仅支持 DaVinci Resolve Studio 19 及以上版本。"
        />
      ) : null}

      <main className="workspace">
        <section className="panel panel--left">
          <div className="panel__header panel__header--with-action">
            <div className="panel__header-content">
              <h2>媒体池结构</h2>
              <span>{mediaPoolDescription}</span>
            </div>
            <div className="panel__header-actions">
              <button
                className="action-button action-button--ghost action-button--compact"
                disabled={isPreparingTimelineCache || isScanningTimelines || isExporting || isConvertingFrameRate}
                onClick={refreshProjectData}
                title="重新读取媒体池目录和时间线缓存"
                type="button"
              >
                {isPreparingTimelineCache ? "刷新中" : "刷新"}
              </button>
              <button
                aria-checked={showAllTimelines}
                className={`switch-button ${showAllTimelines ? "is-active" : ""}`}
                disabled={isPreparingTimelineCache || isScanningTimelines || isExporting || isConvertingFrameRate}
                onClick={() => setShowAllTimelines((current) => !current)}
                role="switch"
                title={showAllTimelines ? "关闭后显示媒体池文件夹结构" : "打开后直接显示全部时间线"}
                type="button"
              >
                <span className="switch-button__track">
                  <span className="switch-button__thumb" />
                </span>
                <span className="switch-button__label">显示时间线</span>
              </button>
            </div>
          </div>
          <div className="panel__body panel__body--scroll">
            {showAllTimelines ? (
              <TimelineList
                emptyMessage={timelineEmptyMessage}
                isLoading={isTimelineListLoading}
                timelines={visibleTimelines}
                selectedIds={selectedTimelineIds}
                onSelect={handleTimelineSelect}
              />
            ) : (
              <FolderTree tree={folderTree} selectedFolderId={selectedFolderId} onSelect={setSelectedFolderId} />
            )}
          </div>
        </section>

        <section className="panel panel--center">
          <div className="panel__header panel__header--timeline">
            <div className="panel__header-content">
              <h2>时间线列表</h2>
              <span>{timelineListDescription}</span>
            </div>
            <input
              aria-label="搜索时间线"
              className="timeline-search"
              onChange={(event) => {
                timelineSearchLoadFailedRef.current = false;
                setTimelineSearchQuery(event.target.value);
              }}
              placeholder="搜索时间线"
              type="search"
              value={timelineSearchQuery}
            />
          </div>
          <div className="panel__body panel__body--scroll">
            <TimelineList
              emptyMessage={timelineEmptyMessage}
              isLoading={isTimelineListLoading}
              timelines={visibleTimelines}
              selectedIds={selectedTimelineIds}
              onSelect={handleTimelineSelect}
            />
          </div>
        </section>

        <section className="panel panel--right">
          <div className="panel__header panel__header--tabs">
            <div>
              <h2>操作面板</h2>
              <span>
                {activeRightTab === "export"
                  ? "按 Deliver 核心参数设计，格式/编码器/分辨率/帧率联动"
                  : "读取原帧率并设置新时间线帧率"}
              </span>
            </div>
            <div className="tab-switcher" role="tablist" aria-label="操作面板标签">
              <button
                className={`tab-switcher__button ${activeRightTab === "export" ? "is-active" : ""}`}
                onClick={() => setActiveRightTab("export")}
                role="tab"
                type="button"
              >
                导出设置
              </button>
              <button
                className={`tab-switcher__button ${activeRightTab === "conversion" ? "is-active" : ""}`}
                onClick={() => setActiveRightTab("conversion")}
                role="tab"
                type="button"
              >
                帧率转换
              </button>
            </div>
          </div>
          <div className="panel__body panel__body--scroll">
            {activeRightTab === "export" ? (
              <>
                <RenderSettingsPanel
                  options={renderOptions}
                  profile={renderProfile}
                  namingTemplate={namingTemplate}
                  outputDirectory={outputDirectory}
                  onPresetChange={(nextPresetName) => {
                    setHasManualPresetSelection(Boolean(nextPresetName));
                    setRenderProfile((currentProfile) => ({
                      ...currentProfile,
                      presetName: nextPresetName
                    }));
                  }}
                  onProfileChange={setRenderProfile}
                  onNamingTemplateChange={setNamingTemplate}
                  onOutputDirectoryChange={chooseOutputDirectory}
                />

                <div className="preview-card">
                  <div className="preview-card__label">命名预览</div>
                  <div className="preview-card__value">{previewName || "选择时间线后显示首个输出名预览"}</div>
                </div>
              </>
            ) : (
              <FrameRateConversionPanel
                selectedTimelines={selectedTimelines}
                sourceFrameRateLabel={selectedTimelineSourceFrameRateLabel}
                targetFrameRateInput={conversionTargetFrameRateInput}
                frameRateOptions={renderOptions?.frameRates ?? []}
                destinationFolderName={conversionFolderName}
                conversionStrategy={conversionStrategy}
                result={lastConversionResult}
                onTargetFrameRateChange={setConversionTargetFrameRateInput}
                onDestinationFolderNameChange={setConversionFolderName}
                onConversionStrategyChange={setConversionStrategy}
              />
            )}
          </div>
        </section>
      </main>

      <div className="fixed-export-action">
        <div className="fixed-export-action__summary">
          <ExportSummary
            result={lastResult}
            isExporting={isExporting}
            statusMessage={fixedActionDisabledReason || "当前只启动本次创建的任务，不改动用户原有队列。"}
          />
        </div>
        <button
          className="action-button action-button--primary fixed-export-action__button"
          disabled={Boolean(fixedActionDisabledReason)}
          onClick={fixedActionHandler}
          title={fixedActionDisabledReason || fixedActionTitle}
          type="button"
        >
          {fixedActionLabel}
        </button>
      </div>

      {updateBridge ? (
        <UpdateSettingsModal
          bridge={updateBridge}
          isOpen={isUpdateSettingsOpen}
          settings={updateSettings}
          state={updateState}
          onClose={() => setIsUpdateSettingsOpen(false)}
          onSettingsChanged={setUpdateSettings}
          onStateChanged={setUpdateState}
        />
      ) : null}

      {updateState?.status === "ready" &&
      updateState.pending &&
      !updateState.isDeferred &&
      !isUpdateSettingsOpen &&
      updateSettings.updatePolicy !== "disabled" ? (
        <UpdatePrompt
          isBusy={isUpdateActionBusy}
          state={updateState}
          onDefer={() => void deferReadyUpdate()}
          onInstallNow={() => void installReadyUpdate()}
        />
      ) : null}
    </div>
  );
}
