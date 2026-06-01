"use strict";

const path = require("path");
const { contextBridge, ipcRenderer } = require("electron");

const pluginId = "com.dvexport.batch-export";
const workflowIntegrationPath = path.join(__dirname, "WorkflowIntegration.node");

let workflowIntegration = null;
let resolve = null;
let initialized = false;
let cachedProjectKey = "";
let cachedFolderMap = new Map();
let cachedTimelineScan = [];

function safeCall(fn, fallback = null) {
  try {
    return fn();
  } catch (error) {
    return fallback;
  }
}

function requireWorkflowIntegration() {
  if (!workflowIntegration) {
    workflowIntegration = require(workflowIntegrationPath);
  }

  return workflowIntegration;
}

function initializeResolve() {
  if (initialized && resolve) {
    return resolve;
  }

  const integration = requireWorkflowIntegration();
  const success = integration.Initialize(pluginId);
  if (!success) {
    throw new Error("Workflow Integration 初始化失败，请确认当前为 Resolve Studio 且插件目录包含 WorkflowIntegration.node。");
  }

  resolve = integration.GetResolve();
  initialized = true;
  return resolve;
}

function getProjectContext() {
  const app = initializeResolve();
  const projectManager = app.GetProjectManager();
  const project = projectManager && projectManager.GetCurrentProject ? projectManager.GetCurrentProject() : null;

  if (!project) {
    throw new Error("当前没有打开的工程。");
  }

  return {
    app,
    projectManager,
    project
  };
}

function getVersionInfo() {
  const app = initializeResolve();
  const productName = safeCall(() => app.GetProductName(), "DaVinci Resolve");
  const version = safeCall(() => app.GetVersion(), []);
  const versionString = safeCall(() => app.GetVersionString(), Array.isArray(version) ? version.join(".") : "");
  const majorVersion = Array.isArray(version) && version.length > 0 ? Number(version[0]) : Number.parseInt(String(versionString).split(".")[0] || "0", 10);

  return {
    productName,
    versionString,
    majorVersion,
    isStudio: String(productName).toLowerCase().includes("studio")
  };
}

function normalizeList(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (!value) {
    return [];
  }

  return Object.values(value);
}

function normalizeToken(value) {
  return String(value || "").trim().toLowerCase();
}

function uniqueStrings(values) {
  const output = [];
  const seen = new Set();

  for (const value of values) {
    const next = String(value || "").trim();
    if (!next) {
      continue;
    }

    const normalized = normalizeToken(next);
    if (seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    output.push(next);
  }

  return output;
}

function looksLikeIdentifier(value) {
  return /^[a-z0-9][a-z0-9_.-]*$/i.test(String(value || "").trim());
}

function chooseOptionPair(left, right, preferredValue) {
  const normalizedPreferred = normalizeToken(preferredValue);
  const normalizedLeft = normalizeToken(left);
  const normalizedRight = normalizeToken(right);

  if (normalizedPreferred) {
    if (normalizedLeft === normalizedPreferred) {
      return { id: String(left), label: String(right || left) };
    }

    if (normalizedRight === normalizedPreferred) {
      return { id: String(right), label: String(left || right) };
    }
  }

  if (looksLikeIdentifier(left) && !looksLikeIdentifier(right)) {
    return { id: String(left), label: String(right || left) };
  }

  if (looksLikeIdentifier(right) && !looksLikeIdentifier(left)) {
    return { id: String(right), label: String(left || right) };
  }

  return { id: String(left || right), label: String(right || left || right) };
}

function matchOptionId(options, preferredValue) {
  if (!preferredValue) {
    return options[0] ? options[0].id : "";
  }

  const normalizedPreferred = normalizeToken(preferredValue);
  const exact = options.find((option) => normalizeToken(option.id) === normalizedPreferred);
  if (exact) {
    return exact.id;
  }

  const labelMatch = options.find((option) => normalizeToken(option.label) === normalizedPreferred);
  if (labelMatch) {
    return labelMatch.id;
  }

  const partialMatch = options.find((option) => {
    const optionId = normalizeToken(option.id);
    const optionLabel = normalizeToken(option.label);
    return (
      optionId.includes(normalizedPreferred) ||
      normalizedPreferred.includes(optionId) ||
      optionLabel.includes(normalizedPreferred) ||
      normalizedPreferred.includes(optionLabel)
    );
  });

  return partialMatch ? partialMatch.id : options[0] ? options[0].id : "";
}

function buildFolderTree(folder) {
  return {
    id: safeCall(() => folder.GetUniqueId(), ""),
    name: safeCall(() => folder.GetName(), "未命名文件夹"),
    children: normalizeList(safeCall(() => folder.GetSubFolderList(), [])).map((child) => buildFolderTree(child))
  };
}

function buildFolderMap(folder, map) {
  if (!folder) {
    return;
  }

  map.set(safeCall(() => folder.GetUniqueId(), ""), folder);
  const subFolders = normalizeList(safeCall(() => folder.GetSubFolderList(), []));
  for (const subFolder of subFolders) {
    buildFolderMap(subFolder, map);
  }
}

function getTimelineMediaPoolItem(timeline) {
  const candidate = safeCall(() => timeline.GetMediaPoolItem && timeline.GetMediaPoolItem(), null);
  return candidate || null;
}

function getClipType(clip) {
  const typeFromProperty = safeCall(() => clip.GetClipProperty && clip.GetClipProperty("Type"), "");
  const fallbackType = safeCall(() => clip.GetMetadata && clip.GetMetadata("Type"), "");
  return String(typeFromProperty || fallbackType || "").toLowerCase();
}

function scanProjectTimelines(project) {
  const count = safeCall(() => project.GetTimelineCount(), 0);
  const timelines = [];

  for (let index = 1; index <= count; index += 1) {
    const timeline = safeCall(() => project.GetTimelineByIndex(index), null);
    if (!timeline) {
      continue;
    }

    const mediaPoolItem = getTimelineMediaPoolItem(timeline);
    const frameRate = Number(safeCall(() => timeline.GetSetting && timeline.GetSetting("timelineFrameRate"), 0));
    timelines.push({
      id: safeCall(() => timeline.GetUniqueId(), ""),
      name: safeCall(() => timeline.GetName(), `时间线-${index}`),
      mediaPoolItemId: mediaPoolItem ? safeCall(() => mediaPoolItem.GetMediaId(), "") : "",
      frameRate: Number.isFinite(frameRate) && frameRate > 0 ? frameRate : undefined,
      timeline
    });
  }

  return timelines;
}

function getProjectCacheKey(project) {
  return [
    safeCall(() => project.GetName(), ""),
    safeCall(() => project.GetTimelineCount(), 0),
    safeCall(() => project.GetMediaPool().GetRootFolder().GetUniqueId(), "")
  ].join("::");
}

function ensureProjectCaches(project) {
  const cacheKey = getProjectCacheKey(project);
  if (cacheKey === cachedProjectKey) {
    return;
  }

  const folderMap = new Map();
  buildFolderMap(project.GetMediaPool().GetRootFolder(), folderMap);

  cachedProjectKey = cacheKey;
  cachedFolderMap = folderMap;
  cachedTimelineScan = scanProjectTimelines(project);
}

function listTimelinesInFolder(folderId) {
  const { project } = getProjectContext();
  ensureProjectCaches(project);
  const targetFolder = cachedFolderMap.get(folderId) || null;

  if (!targetFolder) {
    throw new Error("未找到指定的媒体池文件夹。");
  }

  const timelines = cachedTimelineScan;
  const matchedByMediaId = new Map();
  for (const timeline of timelines) {
    if (timeline.mediaPoolItemId) {
      matchedByMediaId.set(timeline.mediaPoolItemId, timeline);
    }
  }

  const clips = normalizeList(safeCall(() => targetFolder.GetClipList(), []));
  const usedTimelineIds = new Set();
  const entries = [];

  for (const clip of clips) {
    const mediaId = safeCall(() => clip.GetMediaId(), "");
    const clipName = safeCall(() => clip.GetName(), "未命名时间线");
    const clipType = getClipType(clip);

    let timelineRecord = matchedByMediaId.get(mediaId) || null;
    if (!timelineRecord && clipType.includes("timeline")) {
      timelineRecord = timelines.find((item) => item.name === clipName && !usedTimelineIds.has(item.id)) || null;
    }

    if (!timelineRecord && !clipType.includes("timeline")) {
      continue;
    }

    if (!timelineRecord) {
      continue;
    }

    usedTimelineIds.add(timelineRecord.id);
    entries.push({
      id: timelineRecord.id,
      name: timelineRecord.name,
      folderId,
      mediaPoolItemId: timelineRecord.mediaPoolItemId,
      frameRate: timelineRecord.frameRate
    });
  }

  return entries;
}

function getRenderPresets(project) {
  return normalizeList(safeCall(() => project.GetRenderPresetList(), [])).map((preset) => {
    if (typeof preset === "string") {
      return {
        id: preset,
        label: preset
      };
    }

    const name = preset && (preset.name || preset.Name || preset.presetName || preset.PresetName);
    return {
      id: name || "unknown",
      label: name || "未知预设"
    };
  });
}

function getRenderFormats(project) {
  const formats = safeCall(() => project.GetRenderFormats(), {});
  return Object.entries(formats || {}).map(([formatId, extension]) => {
    const normalizedExtension = String(extension || "").trim();
    return {
      id: String(formatId),
      label: normalizedExtension ? `${normalizedExtension} (${String(formatId).toUpperCase()})` : String(formatId).toUpperCase(),
      extension: normalizedExtension || String(formatId)
    };
  });
}

function getRenderCodecs(project, format, preferredCodec) {
  const codecs = safeCall(() => project.GetRenderCodecs(format), {});
  return {
    rawCodecs: codecs || {},
    options: Object.entries(codecs || {}).map(([left, right]) => chooseOptionPair(left, right, preferredCodec))
  };
}

function getCodecCandidates(rawCodecs, codec) {
  const candidates = [codec];
  for (const [left, right] of Object.entries(rawCodecs || {})) {
    if (normalizeToken(left) === normalizeToken(codec)) {
      candidates.push(right);
    }
    if (normalizeToken(right) === normalizeToken(codec)) {
      candidates.push(left);
    }
    if (!codec) {
      candidates.push(left, right);
    }
  }

  return uniqueStrings(candidates);
}

function normalizeResolutions(value) {
  return normalizeList(value)
    .map((item) => ({
      width: Number(item.Width || item.width || 0),
      height: Number(item.Height || item.height || 0)
    }))
    .filter((item) => item.width > 0 && item.height > 0);
}

function getRenderResolutions(project, format, codec, rawCodecs) {
  for (const codecCandidate of getCodecCandidates(rawCodecs, codec)) {
    const resolutions = normalizeResolutions(safeCall(() => project.GetRenderResolutions(format, codecCandidate), []));
    if (resolutions.length > 0) {
      return resolutions;
    }
  }

  return [];
}

function getFrameRateOptions(project) {
  const commonRates = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60];
  const timelineRate = Number(safeCall(() => project.GetCurrentTimeline().GetSetting("timelineFrameRate"), 0));
  if (timelineRate && !commonRates.includes(timelineRate)) {
    commonRates.push(timelineRate);
  }

  return commonRates.map((value) => ({
    id: String(value),
    label: `${value} fps`,
    value
  })).sort((left, right) => left.value - right.value);
}

function getRenderOptions(selection = {}) {
  const { project } = getProjectContext();
  const currentFormatAndCodec = safeCall(() => project.GetCurrentRenderFormatAndCodec(), {});
  const formats = getRenderFormats(project);
  const activeFormat = matchOptionId(formats, selection.format || currentFormatAndCodec.format);
  const codecState = activeFormat
    ? getRenderCodecs(project, activeFormat, selection.codec || currentFormatAndCodec.codec)
    : { rawCodecs: {}, options: [] };
  const codecs = codecState.options;
  const activeCodec = matchOptionId(codecs, selection.codec || currentFormatAndCodec.codec);
  const resolutions = activeFormat ? getRenderResolutions(project, activeFormat, activeCodec, codecState.rawCodecs) : [];

  return {
    presets: getRenderPresets(project),
    formats,
    codecs,
    resolutions,
    frameRates: getFrameRateOptions(project),
    currentFormat: activeFormat,
    currentCodec: activeCodec
  };
}

function applyRenderFormatAndCodec(project, format, codec) {
  const codecState = format ? getRenderCodecs(project, format, codec) : { rawCodecs: {}, options: [] };
  const codecCandidates = getCodecCandidates(codecState.rawCodecs, codec);

  for (const codecCandidate of codecCandidates) {
    const formatSet = safeCall(() => project.SetCurrentRenderFormatAndCodec(format, codecCandidate), false);
    if (formatSet) {
      return true;
    }
  }

  return false;
}

function sanitizeForWindowsFileName(value) {
  return String(value)
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
}

function formatDateToken(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

function formatTimeToken(date) {
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${hh}${mm}${ss}`;
}

function renderFileName(template, projectName, timelineName, index) {
  const now = new Date();
  const compiled = String(template || "{timeline}")
    .replaceAll("{timeline}", timelineName)
    .replaceAll("{project}", projectName)
    .replaceAll("{date}", formatDateToken(now))
    .replaceAll("{time}", formatTimeToken(now))
    .replaceAll("{index}", String(index).padStart(2, "0"));

  return sanitizeForWindowsFileName(compiled) || sanitizeForWindowsFileName(timelineName) || `timeline_${index}`;
}

function buildRenderSettings(settings, targetDir, customName) {
  const renderSettings = {
    SelectAllFrames: true,
    TargetDir: targetDir,
    CustomName: customName,
    ExportVideo: settings.exportVideo,
    ExportAudio: settings.exportAudio,
    FormatWidth: settings.resolution.width,
    FormatHeight: settings.resolution.height,
    FrameRate: settings.frameRate
  };

  if (settings.exportAudio && settings.audioCodec) {
    renderSettings.AudioCodec = settings.audioCodec;
  }

  if (settings.exportAudio && Number.isFinite(settings.audioBitDepth)) {
    renderSettings.AudioBitDepth = settings.audioBitDepth;
  }

  if (settings.exportAudio && Number.isFinite(settings.audioSampleRate)) {
    renderSettings.AudioSampleRate = settings.audioSampleRate;
  }

  if (settings.exportAlpha) {
    renderSettings.ExportAlpha = true;
  }

  return renderSettings;
}

function applyRenderSettingsWithDiagnostics(project, renderSettings) {
  const baseSettings = {
    SelectAllFrames: true,
    TargetDir: renderSettings.TargetDir,
    CustomName: renderSettings.CustomName,
    ExportVideo: renderSettings.ExportVideo,
    ExportAudio: renderSettings.ExportAudio
  };

  if (!safeCall(() => project.SetRenderSettings(baseSettings), false)) {
    return {
      ok: false,
      reason: "基础导出设置失败，请检查输出目录和音视频导出开关。"
    };
  }

  let nextSettings = { ...baseSettings };

  if (Number.isFinite(renderSettings.FormatWidth) && Number.isFinite(renderSettings.FormatHeight)) {
    nextSettings = {
      ...nextSettings,
      FormatWidth: renderSettings.FormatWidth,
      FormatHeight: renderSettings.FormatHeight
    };

    if (!safeCall(() => project.SetRenderSettings(nextSettings), false)) {
      return {
        ok: false,
        reason: `当前格式/编码器不接受分辨率 ${renderSettings.FormatWidth}x${renderSettings.FormatHeight}。`
      };
    }
  }

  if (Number.isFinite(renderSettings.FrameRate)) {
    nextSettings = {
      ...nextSettings,
      FrameRate: renderSettings.FrameRate
    };

    if (!safeCall(() => project.SetRenderSettings(nextSettings), false)) {
      return {
        ok: false,
        reason: `当前格式/编码器不接受帧率 ${renderSettings.FrameRate} fps。`
      };
    }
  }

  if (renderSettings.ExportAudio && renderSettings.AudioCodec) {
    nextSettings = {
      ...nextSettings,
      AudioCodec: renderSettings.AudioCodec
    };

    if (!safeCall(() => project.SetRenderSettings(nextSettings), false)) {
      return {
        ok: false,
        reason: `当前格式/编码器不接受音频编码 ${renderSettings.AudioCodec}。`
      };
    }
  }

  if (renderSettings.ExportAudio && Number.isFinite(renderSettings.AudioBitDepth)) {
    nextSettings = {
      ...nextSettings,
      AudioBitDepth: renderSettings.AudioBitDepth
    };

    if (!safeCall(() => project.SetRenderSettings(nextSettings), false)) {
      return {
        ok: false,
        reason: `当前格式/编码器不接受音频位深 ${renderSettings.AudioBitDepth}。`
      };
    }
  }

  if (renderSettings.ExportAudio && Number.isFinite(renderSettings.AudioSampleRate)) {
    nextSettings = {
      ...nextSettings,
      AudioSampleRate: renderSettings.AudioSampleRate
    };

    if (!safeCall(() => project.SetRenderSettings(nextSettings), false)) {
      return {
        ok: false,
        reason: `当前格式/编码器不接受音频采样率 ${renderSettings.AudioSampleRate}。`
      };
    }
  }

  if (renderSettings.ExportAlpha) {
    nextSettings = {
      ...nextSettings,
      ExportAlpha: true
    };

    if (!safeCall(() => project.SetRenderSettings(nextSettings), false)) {
      return {
        ok: false,
        reason: "当前格式/编码器不支持 Alpha 导出。"
      };
    }
  }

  return {
    ok: true
  };
}

function resolveTimelineById(project, timelineId) {
  const count = safeCall(() => project.GetTimelineCount(), 0);
  for (let index = 1; index <= count; index += 1) {
    const timeline = safeCall(() => project.GetTimelineByIndex(index), null);
    if (!timeline) {
      continue;
    }

    if (safeCall(() => timeline.GetUniqueId(), "") === timelineId) {
      return timeline;
    }
  }

  return null;
}

async function runBatchExport(payload) {
  const { app, project } = getProjectContext();
  const version = getVersionInfo();

  if (!version.isStudio || version.majorVersion < 19) {
    throw new Error("该插件仅支持 DaVinci Resolve Studio 19 及以上版本。");
  }

  if (safeCall(() => project.IsRenderingInProgress(), false)) {
    throw new Error("当前已有渲染任务正在执行，请等待完成或手动停止后再批量导出。");
  }

  const selectedTimelines = Array.isArray(payload.selectedTimelines) ? payload.selectedTimelines : [];
  if (selectedTimelines.length === 0) {
    throw new Error("请至少选择一条时间线。");
  }

  if (!payload.outputDirectory) {
    throw new Error("请先选择导出目录。");
  }

  const originalTimeline = safeCall(() => project.GetCurrentTimeline(), null);
  const projectName = safeCall(() => project.GetName(), "UntitledProject");
  const jobIds = [];
  const results = [];

  safeCall(() => app.OpenPage("deliver"), false);

  for (let index = 0; index < selectedTimelines.length; index += 1) {
    const entry = selectedTimelines[index];
    const timeline = resolveTimelineById(project, entry.id);

    if (!timeline) {
      results.push({
        timelineName: entry.name,
        success: false,
        reason: "未在当前工程中定位到时间线对象。"
      });
      continue;
    }

    const switched = safeCall(() => project.SetCurrentTimeline(timeline), false);
    if (!switched) {
      results.push({
        timelineName: entry.name,
        success: false,
        reason: "切换到目标时间线失败。"
      });
      continue;
    }

    if (payload.settings.presetName) {
      const presetLoaded = safeCall(() => project.LoadRenderPreset(payload.settings.presetName), false);
      if (!presetLoaded) {
        results.push({
          timelineName: entry.name,
          success: false,
          reason: `加载预设失败：${payload.settings.presetName}`
        });
        continue;
      }
    }

    const renderModeSet = safeCall(() => project.SetCurrentRenderMode(1), false);
    if (!renderModeSet) {
      results.push({
        timelineName: entry.name,
        success: false,
        reason: "设置单文件渲染模式失败。"
      });
      continue;
    }

    const formatSet = applyRenderFormatAndCodec(project, payload.settings.format, payload.settings.codec);

    if (!formatSet) {
      results.push({
        timelineName: entry.name,
        success: false,
        reason: `设置导出格式/编码器失败：${payload.settings.format}/${payload.settings.codec}`
      });
      continue;
    }

    const fileName = renderFileName(payload.namingTemplate, projectName, entry.name, index + 1);
    const renderSettings = buildRenderSettings(payload.settings, payload.outputDirectory, fileName);
    const renderSettingResult = applyRenderSettingsWithDiagnostics(project, renderSettings);

    if (!renderSettingResult.ok) {
      results.push({
        timelineName: entry.name,
        success: false,
        reason: renderSettingResult.reason
      });
      continue;
    }

    const jobId = safeCall(() => project.AddRenderJob(), "");
    if (!jobId) {
      results.push({
        timelineName: entry.name,
        success: false,
        reason: "添加 Render Queue 任务失败。"
      });
      continue;
    }

    jobIds.push(jobId);
    results.push({
      timelineName: entry.name,
      success: true,
      jobId,
      outputName: fileName
    });
  }

  if (originalTimeline) {
    safeCall(() => project.SetCurrentTimeline(originalTimeline), false);
  }

  if (jobIds.length > 0) {
    const started = safeCall(() => project.StartRendering(jobIds), false);
    if (!started) {
      throw new Error("任务已加入队列，但启动渲染失败，请到 Deliver 页检查。");
    }
  }

  return {
    startedJobs: jobIds.length,
    succeeded: results.filter((item) => item.success).length,
    failed: results.filter((item) => !item.success).length,
    results
  };
}

const bridge = {
  async getEnvironment() {
    const version = getVersionInfo();
    const projectName = safeCall(() => getProjectContext().project.GetName(), "");
    return {
      ...version,
      projectName,
      pluginId
    };
  },
  async getMediaPoolTree() {
    const { project } = getProjectContext();
    const mediaPool = project.GetMediaPool();
    return buildFolderTree(mediaPool.GetRootFolder());
  },
  async getFolderTimelines(folderId) {
    return listTimelinesInFolder(folderId);
  },
  async getRenderOptions(selection) {
    return getRenderOptions(selection);
  },
  async chooseOutputDirectory() {
    return ipcRenderer.invoke("dv-batch-export:select-output-directory");
  },
  async runBatchExport(payload) {
    return runBatchExport(payload);
  }
};

contextBridge.exposeInMainWorld("resolveBridge", bridge);
