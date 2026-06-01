import { useEffect, useMemo, useState } from "react";
import { createExportJobPlans } from "../core/exportPlanner";
import { loadPersistedExportSettings, savePersistedExportSettings } from "../core/exportSettingsStorage";
import { formatNamingTemplate } from "../core/naming";
import { computeNextSelection } from "../core/timelineSelection";
import { getResolveBridge } from "../plugin/resolveBridge";
import type {
  EnvironmentInfo,
  ExportBatchResponse,
  MediaPoolFolderNode,
  RenderOptionsResponse,
  RenderProfile,
  TimelineEntry
} from "../types/models";
import { ExportSummary } from "../ui/components/ExportSummary";
import { FolderTree } from "../ui/components/FolderTree";
import { RenderSettingsPanel } from "../ui/components/RenderSettingsPanel";
import { StatusBanner } from "../ui/components/StatusBanner";
import { TimelineList } from "../ui/components/TimelineList";

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

function getPrimarySelectedTimelineFrameRate(timelines: TimelineEntry[], selectedTimelineIds: string[]) {
  for (const timeline of timelines) {
    if (selectedTimelineIds.includes(timeline.id) && timeline.frameRate) {
      return timeline.frameRate;
    }
  }

  return null;
}

function syncRenderProfile(
  currentProfile: RenderProfile,
  options: RenderOptionsResponse,
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
  const nextPreset =
    options.presets.find((preset) => preset.id === currentProfile.presetName)?.id ||
    currentProfile.presetName ||
    options.presets[0]?.id ||
    "";

  return {
    ...currentProfile,
    presetName: nextPreset,
    format: nextFormat,
    codec: nextCodec,
    resolution: nextResolution,
    frameRate: nextFrameRate
  };
}

export function App() {
  const bridge = useMemo(() => getResolveBridge(), []);
  const persistedSettings = useMemo(() => loadPersistedExportSettings(emptyProfile, defaultNamingTemplate), []);
  const [environment, setEnvironment] = useState<EnvironmentInfo | null>(null);
  const [folderTree, setFolderTree] = useState<MediaPoolFolderNode | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [timelines, setTimelines] = useState<TimelineEntry[]>([]);
  const [selectedTimelineIds, setSelectedTimelineIds] = useState<string[]>([]);
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(null);
  const [renderOptions, setRenderOptions] = useState<RenderOptionsResponse | null>(null);
  const [renderProfile, setRenderProfile] = useState<RenderProfile>(persistedSettings.renderProfile);
  const [outputDirectory, setOutputDirectory] = useState(persistedSettings.outputDirectory);
  const [namingTemplate, setNamingTemplate] = useState(persistedSettings.namingTemplate);
  const [lastResult, setLastResult] = useState<ExportBatchResponse | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isScanningTimelines, setIsScanningTimelines] = useState(false);
  const [error, setError] = useState("");

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
        setRenderProfile((currentProfile) => syncRenderProfile(currentProfile, options, emptyProfile));
      } catch (bootstrapError) {
        setError(bootstrapError instanceof Error ? bootstrapError.message : "初始化插件失败。");
      }
    }

    void bootstrap();
  }, [bridge, persistedSettings.renderProfile.frameRate]);

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
        setRenderProfile((currentProfile) => syncRenderProfile(currentProfile, nextOptions, emptyProfile));
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
  }, [bridge, renderProfile.codec, renderProfile.format]);

  useEffect(() => {
    const folderId = selectedFolderId;
    if (!folderId) {
      return;
    }
    const currentFolderId: string = folderId;
    let isCancelled = false;

    async function loadTimelines() {
      try {
        setError("");
        setIsScanningTimelines(true);
        await new Promise((resolve) => window.setTimeout(resolve, 16));
        const nextTimelines = await bridge.getFolderTimelines(currentFolderId);
        if (isCancelled) {
          return;
        }
        setTimelines(nextTimelines);
        setSelectedTimelineIds([]);
        setSelectionAnchorId(null);
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
  }, [bridge, selectedFolderId]);

  useEffect(() => {
    savePersistedExportSettings({
      renderProfile,
      outputDirectory,
      namingTemplate
    });
  }, [namingTemplate, outputDirectory, renderProfile]);

  useEffect(() => {
    const selectedTimelineFrameRate = getPrimarySelectedTimelineFrameRate(timelines, selectedTimelineIds);
    if (!selectedTimelineFrameRate) {
      return;
    }

    setRenderOptions((currentOptions) =>
      currentOptions ? ensureFrameRateOption(currentOptions, selectedTimelineFrameRate) : currentOptions
    );
    setRenderProfile((currentProfile) => {
      if (currentProfile.frameRate === selectedTimelineFrameRate) {
        return currentProfile;
      }

      return {
        ...currentProfile,
        frameRate: selectedTimelineFrameRate
      };
    });
  }, [selectedTimelineIds, timelines]);

  const selectedTimelines = timelines.filter((timeline) => selectedTimelineIds.includes(timeline.id));
  const previewName =
    environment && selectedTimelines[0]
      ? formatNamingTemplate(namingTemplate, {
          timeline: selectedTimelines[0].name,
          project: environment.projectName,
          index: 1
        })
      : "";

  async function chooseOutputDirectory() {
    const nextPath = await bridge.chooseOutputDirectory();
    if (nextPath) {
      setOutputDirectory(nextPath);
    }
  }

  async function exportTimelines() {
    if (!environment) {
      return;
    }

    try {
      setIsExporting(true);
      setError("");

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

  const canExport =
    Boolean(environment?.isStudio) &&
    environment !== null &&
    environment.majorVersion >= 19 &&
    selectedTimelines.length > 0 &&
    outputDirectory.length > 0 &&
    renderProfile.format.length > 0 &&
    renderProfile.codec.length > 0 &&
    !isExporting;

  return (
    <div className="shell">
      <header className="hero">
        <div>
          <div className="hero__eyebrow">DaVinci Resolve Workflow Integration</div>
          <h1>达芬奇批量导出</h1>
          <p>按媒体池文件夹定位时间线，批量加入 Render Queue，并沿用统一的导出配置执行渲染。</p>
        </div>
        <div className="hero__meta">
          <div>项目：{environment?.projectName || "未连接"}</div>
          <div>版本：{environment?.versionString || "-"}</div>
          <div>产品：{environment?.productName || "-"}</div>
        </div>
      </header>

      {error ? (
        <StatusBanner tone="danger" title="操作失败" description={error} />
      ) : environment?.isStudio && environment.majorVersion >= 19 ? (
        <StatusBanner
          tone="success"
          title="环境检查通过"
          description="已连接到 Resolve Studio 19+。当前导出模式为追加任务，不会清空用户已有 Render Queue。"
        />
      ) : (
        <StatusBanner
          tone="warning"
          title="环境限制"
          description="该插件仅支持 DaVinci Resolve Studio 19 及以上版本。"
        />
      )}

      <main className="workspace">
        <section className="panel panel--left">
          <div className="panel__header">
            <h2>媒体池结构</h2>
            <span>选择文件夹后，只显示该文件夹内的时间线</span>
          </div>
          <div className="panel__body panel__body--scroll">
            <FolderTree tree={folderTree} selectedFolderId={selectedFolderId} onSelect={setSelectedFolderId} />
          </div>
        </section>

        <section className="panel panel--center">
          <div className="panel__header">
            <h2>时间线列表</h2>
            <span>支持单选、Ctrl/Command 多选、Shift 连选</span>
          </div>
          <div className="panel__body panel__body--scroll">
            <TimelineList
              isLoading={isScanningTimelines}
              timelines={timelines}
              selectedIds={selectedTimelineIds}
              onSelect={(timelineId, modifiers) => {
                const next = computeNextSelection(
                  timelines.map((timeline) => timeline.id),
                  selectedTimelineIds,
                  timelineId,
                  selectionAnchorId,
                  modifiers
                );
                setSelectedTimelineIds(next.selection);
                setSelectionAnchorId(next.anchorId);
              }}
            />
          </div>
        </section>

        <section className="panel panel--right">
          <div className="panel__header">
            <h2>导出设置</h2>
            <span>按 Deliver 核心参数设计，格式/编码器/分辨率/帧率联动</span>
          </div>
          <div className="panel__body panel__body--scroll">
            <RenderSettingsPanel
              options={renderOptions}
              profile={renderProfile}
              namingTemplate={namingTemplate}
              outputDirectory={outputDirectory}
              onProfileChange={setRenderProfile}
              onNamingTemplateChange={setNamingTemplate}
              onOutputDirectoryChange={chooseOutputDirectory}
            />

            <div className="preview-card">
              <div className="preview-card__label">命名预览</div>
              <div className="preview-card__value">{previewName || "选择时间线后显示首个输出名预览"}</div>
            </div>

            <button
              className="action-button action-button--primary"
              disabled={!canExport}
              onClick={exportTimelines}
              type="button"
            >
              {isExporting ? "正在创建批量任务..." : "批量导出所选时间线"}
            </button>
          </div>
        </section>
      </main>

      <section className="panel panel--summary">
        <div className="panel__header">
          <h2>导出结果</h2>
          <span>当前只启动本次创建的任务，不改动用户原有队列</span>
        </div>
        <div className="panel__body panel__body--scroll">
          <ExportSummary result={lastResult} />
        </div>
      </section>
    </div>
  );
}
