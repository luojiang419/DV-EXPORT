"use strict";

const path = require("path");
const fs = require("fs");
const { contextBridge, ipcRenderer } = require("electron");

const pluginId = "com.dvexport.batch-export";
const workflowIntegrationPath = path.join(__dirname, "WorkflowIntegration.node");

let workflowIntegration = null;
let resolve = null;
let initialized = false;
let cachedProjectKey = "";
let cachedFolderMap = new Map();
let cachedTimelineScan = [];
let cachedTimelineFolderIdByTimelineId = new Map();

const renderPollIntervalMs = 1000;
const frameRateConversionRenderTimeoutMs = 6 * 60 * 60 * 1000;
const uiCopyPasteFrameRateConversionStrategy = "resolve-ui-copy-paste";
const defaultFrameRateConversionStrategy = uiCopyPasteFrameRateConversionStrategy;
const frameRateConversionStrategies = new Set([
  "resolve-render",
  "ffmpeg-cfr",
  "ffmpeg-motion",
  uiCopyPasteFrameRateConversionStrategy
]);
const ffmpegFrameRateConversionStrategies = new Set(["ffmpeg-cfr", "ffmpeg-motion"]);

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

function findFormatOption(formats, preferredValue) {
  const matchedId = matchOptionId(formats, preferredValue);
  return formats.find((option) => option.id === matchedId) || null;
}

function getFormatCandidates(formatOption, preferredFormat) {
  return uniqueStrings([preferredFormat, formatOption && formatOption.extension, formatOption && formatOption.id]);
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

function getPositiveTimelineSetting(timeline, keys) {
  for (const key of keys) {
    const value = Number(safeCall(() => timeline.GetSetting && timeline.GetSetting(key), 0));
    if (Number.isFinite(value) && value > 0) {
      return value;
    }
  }

  return undefined;
}

function getTimelineResolution(timeline) {
  const width = getPositiveTimelineSetting(timeline, [
    "timelineResolutionWidth",
    "timelineOutputResolutionWidth"
  ]);
  const height = getPositiveTimelineSetting(timeline, [
    "timelineResolutionHeight",
    "timelineOutputResolutionHeight"
  ]);

  return width && height ? { width, height } : undefined;
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
    timelines.push({
      id: safeCall(() => timeline.GetUniqueId(), ""),
      name: safeCall(() => timeline.GetName(), `时间线-${index}`),
      mediaPoolItemId: mediaPoolItem ? safeCall(() => mediaPoolItem.GetMediaId(), "") : "",
      frameRate: getTimelineFrameRate(timeline),
      resolution: getTimelineResolution(timeline),
      timeline
    });
  }

  return timelines;
}

function buildTimelineFolderIdMap(timelines, folderMap) {
  const timelineFolderIds = new Map();
  const matchedByMediaId = new Map();

  for (const timeline of timelines) {
    if (timeline.mediaPoolItemId) {
      matchedByMediaId.set(timeline.mediaPoolItemId, timeline);
    }
  }

  for (const [folderId, folder] of folderMap.entries()) {
    const clips = normalizeList(safeCall(() => folder.GetClipList(), []));
    const usedTimelineIds = new Set();

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
      if (!timelineFolderIds.has(timelineRecord.id)) {
        timelineFolderIds.set(timelineRecord.id, folderId);
      }
    }
  }

  return timelineFolderIds;
}

function getProjectCacheKey(project) {
  return [
    safeCall(() => project.GetName(), ""),
    safeCall(() => project.GetTimelineCount(), 0),
    safeCall(() => project.GetMediaPool().GetRootFolder().GetUniqueId(), "")
  ].join("::");
}

function ensureProjectCaches(project, forceRefresh = false) {
  const cacheKey = getProjectCacheKey(project);
  if (!forceRefresh && cacheKey === cachedProjectKey) {
    return;
  }

  const folderMap = new Map();
  buildFolderMap(project.GetMediaPool().GetRootFolder(), folderMap);
  const timelineScan = scanProjectTimelines(project);

  cachedProjectKey = cacheKey;
  cachedFolderMap = folderMap;
  cachedTimelineScan = timelineScan;
  cachedTimelineFolderIdByTimelineId = buildTimelineFolderIdMap(timelineScan, folderMap);
}

function prepareTimelineCache(forceRefresh = false) {
  const { project } = getProjectContext();
  ensureProjectCaches(project, forceRefresh);

  return {
    projectKey: cachedProjectKey,
    folderCount: cachedFolderMap.size,
    timelineCount: cachedTimelineScan.length
  };
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
    entries.push(createTimelineEntry(timelineRecord, folderId));
  }

  return entries;
}

function createTimelineEntry(timelineRecord, folderId) {
  return {
    id: timelineRecord.id,
    name: timelineRecord.name,
    folderId,
    mediaPoolItemId: timelineRecord.mediaPoolItemId,
    frameRate: timelineRecord.frameRate,
    resolution: timelineRecord.resolution
  };
}

function listAllTimelines() {
  const { project } = getProjectContext();
  ensureProjectCaches(project);

  const fallbackFolderId = cachedFolderMap.keys().next().value || "";
  return cachedTimelineScan.map((timelineRecord) =>
    createTimelineEntry(timelineRecord, cachedTimelineFolderIdByTimelineId.get(timelineRecord.id) || fallbackFolderId)
  );
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

function getRenderCodecs(project, formatOption, preferredFormat, preferredCodec) {
  const formatCandidates = getFormatCandidates(formatOption, preferredFormat);

  for (const formatCandidate of formatCandidates) {
    const codecs = safeCall(() => project.GetRenderCodecs(formatCandidate), {});
    const options = Object.entries(codecs || {}).map(([left, right]) => chooseOptionPair(left, right, preferredCodec));
    if (options.length > 0) {
      return {
        rawCodecs: codecs || {},
        options,
        resolvedFormat: formatCandidate
      };
    }
  }

  return {
    rawCodecs: {},
    options: [],
    resolvedFormat: formatCandidates[0] || ""
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

function getRenderResolutions(project, formatCandidates, codec, rawCodecs) {
  for (const formatCandidate of uniqueStrings(formatCandidates)) {
    for (const codecCandidate of getCodecCandidates(rawCodecs, codec)) {
      const resolutions = normalizeResolutions(safeCall(() => project.GetRenderResolutions(formatCandidate, codecCandidate), []));
      if (resolutions.length > 0) {
        return resolutions;
      }
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
  const preferredFormat = selection.format || currentFormatAndCodec.format;
  const activeFormatOption = findFormatOption(formats, preferredFormat);
  const codecState = activeFormatOption
    ? getRenderCodecs(project, activeFormatOption, preferredFormat, selection.codec || currentFormatAndCodec.codec)
    : { rawCodecs: {}, options: [], resolvedFormat: "" };
  const codecs = codecState.options;
  const activeCodec = matchOptionId(codecs, selection.codec || currentFormatAndCodec.codec);
  const resolutions = activeFormatOption
    ? getRenderResolutions(
        project,
        getFormatCandidates(activeFormatOption, codecState.resolvedFormat || preferredFormat),
        activeCodec,
        codecState.rawCodecs
      )
    : [];

  return {
    presets: getRenderPresets(project),
    formats,
    codecs,
    resolutions,
    frameRates: getFrameRateOptions(project),
    currentFormat: activeFormatOption ? activeFormatOption.id : "",
    currentCodec: activeCodec
  };
}

function applyRenderFormatAndCodec(project, formats, format, codec) {
  const formatOption = findFormatOption(formats, format);

  for (const formatCandidate of getFormatCandidates(formatOption, format)) {
    const rawCodecs = safeCall(() => project.GetRenderCodecs(formatCandidate), {});
    const codecCandidates = getCodecCandidates(rawCodecs, codec);

    for (const codecCandidate of codecCandidates) {
      const formatSet = safeCall(() => project.SetCurrentRenderFormatAndCodec(formatCandidate, codecCandidate), false);
      if (formatSet) {
        return true;
      }
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

function formatFrameRateForName(frameRate) {
  if (!Number.isFinite(frameRate) || frameRate <= 0) {
    return "";
  }

  return String(frameRate).replace(/\.0+$/, "");
}

function createFrameRateTimelineBaseName(timelineName, targetFrameRate) {
  const frameRateText = formatFrameRateForName(targetFrameRate);
  return frameRateText ? `${timelineName}_${frameRateText}fps` : timelineName;
}

function createFrameRateOutputBaseName(timelineName, targetFrameRate) {
  return createFrameRateTimelineBaseName(timelineName, targetFrameRate);
}

function normalizeFileExtension(extension) {
  return String(extension || "").trim().replace(/^\.+/, "");
}

function createFrameRateOutputFileName(baseName, extension) {
  const normalizedBaseName = String(baseName || "").trim();
  const normalizedExtension = normalizeFileExtension(extension);
  if (!normalizedBaseName) {
    return normalizedExtension ? `output.${normalizedExtension}` : "output";
  }

  return normalizedExtension ? `${normalizedBaseName}.${normalizedExtension}` : normalizedBaseName;
}

function createUniqueTimelineName(baseName, existingNames) {
  const usedNames = new Set(existingNames.map((name) => String(name || "").trim().toLowerCase()).filter(Boolean));
  const normalizedBaseName = String(baseName || "").trim().toLowerCase();

  if (!usedNames.has(normalizedBaseName)) {
    return baseName;
  }

  let index = 2;
  while (usedNames.has(`${baseName}_${String(index).padStart(2, "0")}`.toLowerCase())) {
    index += 1;
  }

  return `${baseName}_${String(index).padStart(2, "0")}`;
}

function normalizeDestinationFolderName(value) {
  return String(value || "").trim();
}

function normalizeOutputDirectory(value) {
  return String(value || "").trim();
}

function normalizeFrameRateConversionStrategy(value) {
  return frameRateConversionStrategies.has(value) ? value : defaultFrameRateConversionStrategy;
}

function areFrameRatesEqual(left, right) {
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(Number(left) - Number(right)) < 0.001;
}

function summarizeFrameRateConversionResults(results) {
  return {
    queued: results.filter((item) => item.status === "queued").length,
    rendering: results.filter((item) => item.status === "rendering").length,
    converted: results.filter((item) => item.status === "converted").length,
    skipped: results.filter((item) => item.status === "skipped").length,
    failed: results.filter((item) => item.status === "failed").length
  };
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

function delay(ms) {
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, ms);
  });
}

function readRenderJobStatus(project, jobId) {
  const status = safeCall(() => project.GetRenderJobStatus && project.GetRenderJobStatus(jobId), null);
  const rawStatus =
    status && typeof status === "object"
      ? status.JobStatus || status.jobStatus || status.Status || status.status || ""
      : status;
  const completionPercentage =
    status && typeof status === "object"
      ? Number(status.CompletionPercentage || status.completionPercentage || status.Completion || 0)
      : 0;

  return {
    rawStatus: String(rawStatus || ""),
    normalizedStatus: normalizeToken(rawStatus),
    completionPercentage: Number.isFinite(completionPercentage) ? completionPercentage : 0
  };
}

function isCompletedRenderStatus(status) {
  return status.includes("complete") || status.includes("done") || status.includes("finish");
}

function isFailedRenderStatus(status) {
  return ["fail", "error", "cancel", "stop", "abort"].some((token) => status.includes(token));
}

function formatRenderJobStatus(statusInfo) {
  const statusText = statusInfo.rawStatus || "未知状态";
  return statusInfo.completionPercentage > 0 ? `${statusText} ${statusInfo.completionPercentage}%` : statusText;
}

async function waitForRenderJobCompletion(project, jobId) {
  const startedAt = Date.now();
  let lastStatus = readRenderJobStatus(project, jobId);
  let observedRendering = false;

  while (Date.now() - startedAt < frameRateConversionRenderTimeoutMs) {
    lastStatus = readRenderJobStatus(project, jobId);

    if (isCompletedRenderStatus(lastStatus.normalizedStatus)) {
      return lastStatus;
    }

    if (isFailedRenderStatus(lastStatus.normalizedStatus)) {
      throw new Error(`Resolve 渲染任务失败：${formatRenderJobStatus(lastStatus)}。`);
    }

    const renderingInProgress = safeCall(() => project.IsRenderingInProgress && project.IsRenderingInProgress(), false);
    observedRendering = observedRendering || renderingInProgress;
    if (!renderingInProgress) {
      if (!observedRendering && Date.now() - startedAt < 3000) {
        await delay(renderPollIntervalMs);
        continue;
      }

      return lastStatus;
    }

    await delay(renderPollIntervalMs);
  }

  throw new Error(`Resolve 渲染任务超时：${formatRenderJobStatus(lastStatus)}。`);
}

function ensureDirectoryExists(directoryPath) {
  fs.mkdirSync(directoryPath, { recursive: true });
}

function getRenderOutputExtension(formats, format) {
  const formatOption = findFormatOption(formats, format);
  return normalizeFileExtension((formatOption && formatOption.extension) || format);
}

function buildMediaOutputPath(outputDirectory, baseName, extension) {
  return path.join(outputDirectory, createFrameRateOutputFileName(baseName, extension));
}

function findRenderedOutputPath(outputDirectory, baseName, extension) {
  const expectedPath = buildMediaOutputPath(outputDirectory, baseName, extension);
  if (fs.existsSync(expectedPath)) {
    return expectedPath;
  }

  const normalizedBaseName = normalizeToken(baseName);
  const normalizedExtension = normalizeToken(normalizeFileExtension(extension));
  const entries = safeCall(() => fs.readdirSync(outputDirectory, { withFileTypes: true }), []);
  const matches = entries
    .filter((entry) => entry && entry.isFile && entry.isFile())
    .map((entry) => entry.name)
    .filter((fileName) => normalizeToken(path.basename(fileName, path.extname(fileName))) === normalizedBaseName);

  const exactExtensionMatch = matches.find(
    (fileName) => normalizeToken(path.extname(fileName).replace(/^\./, "")) === normalizedExtension
  );
  const matchedFileName = exactExtensionMatch || matches[0];
  return matchedFileName ? path.join(outputDirectory, matchedFileName) : expectedPath;
}

async function waitForRenderedOutputPath(outputDirectory, baseName, extension) {
  const startedAt = Date.now();
  let outputPath = findRenderedOutputPath(outputDirectory, baseName, extension);

  while (!fs.existsSync(outputPath) && Date.now() - startedAt < 10 * 1000) {
    await delay(500);
    outputPath = findRenderedOutputPath(outputDirectory, baseName, extension);
  }

  return outputPath;
}

function createUniqueOutputBaseName(baseName, existingBaseNames, outputDirectory, extension) {
  const usedBaseNames = [...existingBaseNames];
  let candidate = createUniqueTimelineName(baseName, usedBaseNames);

  while (fs.existsSync(buildMediaOutputPath(outputDirectory, candidate, extension)) || fs.existsSync(path.join(outputDirectory, candidate))) {
    usedBaseNames.push(candidate);
    candidate = createUniqueTimelineName(baseName, usedBaseNames);
  }

  existingBaseNames.push(candidate);
  return candidate;
}

function buildFrameRateConversionOutputBaseName(payload, projectName, entry, index, targetFrameRate) {
  const sourceBaseName = payload.namingTemplate
    ? renderFileName(payload.namingTemplate, projectName, entry.name, index)
    : sanitizeForWindowsFileName(entry.name);
  const outputBaseName = sanitizeForWindowsFileName(createFrameRateOutputBaseName(sourceBaseName, targetFrameRate));

  return outputBaseName || `timeline_${index}_${formatFrameRateForName(targetFrameRate)}fps`;
}

function buildFrameRateConversionRenderProfile(settings, frameRate) {
  return {
    ...settings,
    frameRate,
    exportVideo: true
  };
}

function validateFrameRateConversionOutput(validation, targetFrameRate) {
  if (!validation || !Number.isFinite(validation.outputFrameRate)) {
    return "FFprobe 未能读取输出视频帧率。";
  }

  if (!areFrameRatesEqual(validation.outputFrameRate, targetFrameRate)) {
    return `输出帧率为 ${validation.outputFrameRate} fps，未达到 ${targetFrameRate} fps。`;
  }

  if (!Number.isFinite(validation.durationSeconds) || validation.durationSeconds <= 0) {
    return "FFprobe 未能读取有效输出时长。";
  }

  return "";
}

async function probeAndValidateFrameRateOutput(outputPath, targetFrameRate) {
  const validation = await ipcRenderer.invoke("dv-batch-export:probe-media-file", { filePath: outputPath });
  const validationReason = validateFrameRateConversionOutput(validation, targetFrameRate);
  if (validationReason) {
    throw new Error(validationReason);
  }

  return validation;
}

function deleteFileQuietly(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return;
  }

  safeCall(() => fs.unlinkSync(filePath), false);
}

function removeEmptyDirectoryQuietly(directoryPath) {
  if (!directoryPath || !fs.existsSync(directoryPath)) {
    return;
  }

  safeCall(() => fs.rmdirSync(directoryPath), false);
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

function getTimelineFrameRate(timeline) {
  const frameRate = Number(safeCall(() => timeline.GetSetting && timeline.GetSetting("timelineFrameRate"), 0));
  return Number.isFinite(frameRate) && frameRate > 0 ? frameRate : undefined;
}

function getAllTimelineNames(project) {
  const count = safeCall(() => project.GetTimelineCount(), 0);
  const names = [];

  for (let index = 1; index <= count; index += 1) {
    const timeline = safeCall(() => project.GetTimelineByIndex(index), null);
    if (timeline) {
      names.push(safeCall(() => timeline.GetName(), ""));
    }
  }

  return names.filter(Boolean);
}

function resolveMediaPoolFolderById(project, folderId) {
  ensureProjectCaches(project);
  return cachedFolderMap.get(folderId) || null;
}

function findDirectSubFolderByName(parentFolder, folderName) {
  const normalizedName = normalizeToken(folderName);
  const subFolders = normalizeList(safeCall(() => parentFolder.GetSubFolderList(), []));
  return subFolders.find((folder) => normalizeToken(safeCall(() => folder.GetName(), "")) === normalizedName) || null;
}

function resolveConversionTargetFolder(project, mediaPool, sourceFolderId, destinationFolderName) {
  const normalizedDestinationName = normalizeDestinationFolderName(destinationFolderName);

  if (!normalizedDestinationName) {
    const sourceFolder = resolveMediaPoolFolderById(project, sourceFolderId);
    if (!sourceFolder) {
      return {
        folder: null,
        reason: "未找到源时间线所在媒体池文件夹。"
      };
    }

    return {
      folder: sourceFolder,
      folderName: safeCall(() => sourceFolder.GetName(), "")
    };
  }

  const rootFolder = safeCall(() => mediaPool.GetRootFolder(), null);
  if (!rootFolder) {
    return {
      folder: null,
      reason: "未找到媒体池根目录。"
    };
  }

  const existingFolder = findDirectSubFolderByName(rootFolder, normalizedDestinationName);
  if (existingFolder) {
    return {
      folder: existingFolder,
      folderName: safeCall(() => existingFolder.GetName(), normalizedDestinationName)
    };
  }

  const createdFolder = safeCall(() => mediaPool.AddSubFolder(rootFolder, normalizedDestinationName), null);
  if (!createdFolder) {
    return {
      folder: null,
      reason: `创建媒体池文件夹失败：${normalizedDestinationName}`
    };
  }

  cachedProjectKey = "";
  return {
    folder: createdFolder,
    folderName: safeCall(() => createdFolder.GetName(), normalizedDestinationName)
  };
}

function mediaPoolItemId(mediaPoolItem) {
  return safeCall(() => mediaPoolItem.GetMediaId(), "") || safeCall(() => mediaPoolItem.GetUniqueId(), "");
}

function folderContainsMediaPoolItem(folder, mediaPoolItem) {
  const targetId = mediaPoolItemId(mediaPoolItem);
  if (!targetId) {
    return false;
  }

  const clips = normalizeList(safeCall(() => folder.GetClipList(), []));
  return clips.some((clip) => mediaPoolItemId(clip) === targetId);
}

function ensureTimelineInFolder(mediaPool, timeline, targetFolder) {
  const mediaPoolItem = safeCall(() => timeline.GetMediaPoolItem && timeline.GetMediaPoolItem(), null);
  if (!mediaPoolItem) {
    return {
      ok: false,
      reason: "新时间线已创建，但无法取得对应的媒体池项目。"
    };
  }

  if (folderContainsMediaPoolItem(targetFolder, mediaPoolItem)) {
    return {
      ok: true
    };
  }

  const moved = safeCall(() => mediaPool.MoveClips([mediaPoolItem], targetFolder), false);
  if (!moved || !folderContainsMediaPoolItem(targetFolder, mediaPoolItem)) {
    return {
      ok: false,
      reason: "新时间线已创建，但移动到目标媒体夹失败。"
    };
  }

  return {
    ok: true
  };
}

function deleteTimelineQuietly(mediaPool, timeline) {
  if (!timeline) {
    return;
  }

  safeCall(() => mediaPool.DeleteTimelines([timeline]), false);
}

function restoreConversionState(project, mediaPool, originalTimeline, originalFolder, originalProjectFrameRate) {
  if (originalProjectFrameRate) {
    safeCall(() => project.SetSetting("timelineFrameRate", String(originalProjectFrameRate)), false);
  }

  if (originalTimeline) {
    safeCall(() => project.SetCurrentTimeline(originalTimeline), false);
  }

  if (originalFolder) {
    safeCall(() => mediaPool.SetCurrentFolder(originalFolder), false);
  }
}

const conversionTrackConfigs = [
  { trackType: "video", mediaType: 1, label: "视频", order: 0 },
  { trackType: "audio", mediaType: 2, label: "音频", order: 1 }
];

function toFiniteFrameNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function getTimelineStartFrame(timeline) {
  return toFiniteFrameNumber(safeCall(() => timeline.GetStartFrame && timeline.GetStartFrame(), null));
}

function mapTimelineFrameForTargetFrameRate(frame, sourceStartFrame, targetStartFrame, sourceFrameRate, targetFrameRate) {
  if (
    !Number.isFinite(frame) ||
    !Number.isFinite(sourceStartFrame) ||
    !Number.isFinite(targetStartFrame) ||
    !Number.isFinite(sourceFrameRate) ||
    !Number.isFinite(targetFrameRate) ||
    Number(sourceFrameRate) <= 0 ||
    Number(targetFrameRate) <= 0
  ) {
    return frame;
  }

  const offset = frame - sourceStartFrame;
  return targetStartFrame + Math.round(offset * (Number(targetFrameRate) / Number(sourceFrameRate)));
}

function getTrackCount(timeline, trackType) {
  const count = Number(safeCall(() => timeline.GetTrackCount(trackType), 0));
  return Number.isFinite(count) && count > 0 ? count : 0;
}

function addUnsupportedCopyItem(state, reason, count = 1) {
  state.count += count;
  if (state.reasons.length < 3) {
    state.reasons.push(reason);
  }
}

function buildClipInfoFromTimelineItem(item, trackConfig, trackIndex) {
  const itemName = safeCall(() => item.GetName(), "未命名片段");
  const mediaPoolItem = safeCall(() => item.GetMediaPoolItem && item.GetMediaPoolItem(), null);
  if (!mediaPoolItem) {
    return {
      clipInfo: null,
      reason: `${trackConfig.label}${trackIndex} 的「${itemName}」无法取得媒体池项目`
    };
  }

  const sourceStartFrame = toFiniteFrameNumber(safeCall(() => item.GetSourceStartFrame(), null));
  const sourceEndFrame = toFiniteFrameNumber(safeCall(() => item.GetSourceEndFrame(), null));
  const recordFrame = toFiniteFrameNumber(safeCall(() => item.GetStart(true), null));
  const recordEndFrame = toFiniteFrameNumber(safeCall(() => item.GetEnd && item.GetEnd(true), null));
  const durationFrameCount = toFiniteFrameNumber(safeCall(() => item.GetDuration && item.GetDuration(true), null));
  if (
    sourceStartFrame === null ||
    sourceEndFrame === null ||
    recordFrame === null ||
    sourceEndFrame < sourceStartFrame
  ) {
    return {
      clipInfo: null,
      reason: `${trackConfig.label}${trackIndex} 的「${itemName}」无法读取源入出点或时间线位置`
    };
  }

  const timelineDurationFrames =
    durationFrameCount !== null && durationFrameCount > 0
      ? durationFrameCount
      : recordEndFrame !== null && recordEndFrame > recordFrame
        ? recordEndFrame - recordFrame
        : null;
  const sourceDurationFrames = sourceEndFrame - sourceStartFrame + 1;
  const appendEndFrame =
    timelineDurationFrames !== null && sourceDurationFrames > timelineDurationFrames
      ? sourceStartFrame + Math.max(timelineDurationFrames - 1, 0)
      : sourceEndFrame;

  return {
    clipInfo: {
      mediaPoolItem,
      startFrame: sourceStartFrame,
      endFrame: appendEndFrame,
      mediaType: trackConfig.mediaType,
      trackIndex,
      recordFrame
    },
    recordFrame,
    recordEndFrame,
    sourceEndFrame,
    timelineDurationFrames,
    sourceDurationFrames,
    clipRangeAdjusted: appendEndFrame !== sourceEndFrame,
    name: itemName
  };
}

function getTimelineItemTrackInfo(item, fallbackTrackType = "", fallbackTrackIndex = 0) {
  const trackInfo = normalizeList(safeCall(() => item.GetTrackTypeAndIndex && item.GetTrackTypeAndIndex(), []));
  const trackType = typeof trackInfo[0] === "string" && trackInfo[0] ? trackInfo[0] : fallbackTrackType;
  const trackIndex = toFiniteFrameNumber(trackInfo[1]);

  return {
    trackType,
    trackIndex: trackIndex !== null && trackIndex > 0 ? trackIndex : fallbackTrackIndex
  };
}

function getTimelineItemKey(item, fallbackTrackType = "", fallbackTrackIndex = 0) {
  const uniqueId = safeCall(() => item.GetUniqueId && item.GetUniqueId(), "");
  if (uniqueId) {
    return `id:${uniqueId}`;
  }

  const mediaPoolItem = safeCall(() => item.GetMediaPoolItem && item.GetMediaPoolItem(), null);
  const mediaId = mediaPoolItem ? mediaPoolItemId(mediaPoolItem) : "";
  const sourceStartFrame = toFiniteFrameNumber(safeCall(() => item.GetSourceStartFrame(), null));
  const sourceEndFrame = toFiniteFrameNumber(safeCall(() => item.GetSourceEndFrame(), null));
  const recordFrame = toFiniteFrameNumber(safeCall(() => item.GetStart(true), null));
  const trackInfo = getTimelineItemTrackInfo(item, fallbackTrackType, fallbackTrackIndex);

  return [
    "fallback",
    mediaId,
    sourceStartFrame,
    sourceEndFrame,
    recordFrame,
    trackInfo.trackType,
    trackInfo.trackIndex
  ].join(":");
}

function getTimelineItemAppendSignature(record) {
  const mediaId = mediaPoolItemId(record.clipInfo.mediaPoolItem);
  if (!mediaId) {
    return "";
  }

  return [mediaId, record.clipInfo.startFrame, record.clipInfo.endFrame, record.recordFrame].join(":");
}

function createAllMediaClipInfo(clipInfo) {
  const { mediaType, ...allMediaClipInfo } = clipInfo;
  return allMediaClipInfo;
}

function getTimelineItemCopySignature(record) {
  const mediaId = mediaPoolItemId(record.clipInfo.mediaPoolItem);
  return [
    mediaId,
    record.clipInfo.startFrame,
    record.clipInfo.endFrame,
    record.recordFrame,
    record.trackType,
    record.trackIndex
  ].join(":");
}

function getTimelineItemMediaCopySignature(record) {
  const mediaId = mediaPoolItemId(record.clipInfo.mediaPoolItem);
  return [mediaId, record.clipInfo.startFrame, record.clipInfo.endFrame, record.trackType].join(":");
}

function createTimelineItemRecord(item, trackConfig, trackIndex) {
  const result = buildClipInfoFromTimelineItem(item, trackConfig, trackIndex);
  if (!result.clipInfo) {
    return {
      record: null,
      reason: result.reason
    };
  }

  const record = {
    item,
    key: getTimelineItemKey(item, trackConfig.trackType, trackIndex),
    clipInfo: result.clipInfo,
    name: result.name,
    recordFrame: result.recordFrame,
    recordEndFrame: result.recordEndFrame,
    sourceEndFrame: result.sourceEndFrame,
    timelineDurationFrames: result.timelineDurationFrames,
    sourceDurationFrames: result.sourceDurationFrames,
    clipRangeAdjusted: result.clipRangeAdjusted,
    trackOrder: trackConfig.order,
    trackIndex,
    trackType: trackConfig.trackType
  };

  return {
    record,
    reason: ""
  };
}

function addRecordToListMap(map, key, record) {
  if (!key) {
    return;
  }

  const records = map.get(key) || [];
  records.push(record);
  map.set(key, records);
}

function uniqueTimelineItemRecords(records) {
  const usedKeys = new Set();
  const uniqueRecords = [];
  for (const record of records) {
    if (!record || usedKeys.has(record.key)) {
      continue;
    }

    usedKeys.add(record.key);
    uniqueRecords.push(record);
  }

  return uniqueRecords;
}

function uniqueTimelineItemRecordsBySignature(records) {
  const usedSignatures = new Set();
  const uniqueRecords = [];
  for (const record of records) {
    const signature = getTimelineItemCopySignature(record);
    if (!signature || usedSignatures.has(signature)) {
      continue;
    }

    usedSignatures.add(signature);
    uniqueRecords.push(record);
  }

  return uniqueRecords;
}

function findLinkedAudioRecords(videoRecord, audioRecordsByKey, audioRecordsBySignature) {
  const linkedAudioRecords = [];
  const linkedItems = normalizeList(safeCall(() => videoRecord.item.GetLinkedItems && videoRecord.item.GetLinkedItems(), []));
  for (const linkedItem of linkedItems) {
    const trackInfo = getTimelineItemTrackInfo(linkedItem);
    const linkedKey = getTimelineItemKey(linkedItem, trackInfo.trackType, trackInfo.trackIndex);
    const audioRecord = audioRecordsByKey.get(linkedKey);
    if (audioRecord) {
      linkedAudioRecords.push(audioRecord);
    }
  }

  if (linkedAudioRecords.length > 0) {
    return uniqueTimelineItemRecords(linkedAudioRecords);
  }

  const appendSignature = getTimelineItemAppendSignature(videoRecord);
  if (!appendSignature) {
    return [];
  }

  return uniqueTimelineItemRecords(audioRecordsBySignature.get(appendSignature) || []);
}

function countTimelineItemsInTrackType(timeline, trackType) {
  let itemCount = 0;
  const trackCount = getTrackCount(timeline, trackType);
  for (let trackIndex = 1; trackIndex <= trackCount; trackIndex += 1) {
    itemCount += normalizeList(safeCall(() => timeline.GetItemListInTrack(trackType, trackIndex), [])).length;
  }

  return itemCount;
}

function collectTimelineClipInfos(sourceTimeline) {
  const collectedRecords = [];
  const audioRecords = [];
  const audioRecordsByKey = new Map();
  const audioRecordsBySignature = new Map();
  const unsupported = {
    count: 0,
    reasons: []
  };

  for (const trackConfig of conversionTrackConfigs) {
    const trackCount = getTrackCount(sourceTimeline, trackConfig.trackType);
    for (let trackIndex = 1; trackIndex <= trackCount; trackIndex += 1) {
      const items = normalizeList(safeCall(() => sourceTimeline.GetItemListInTrack(trackConfig.trackType, trackIndex), []));
      for (const item of items) {
        const result = createTimelineItemRecord(item, trackConfig, trackIndex);
        if (!result.record) {
          addUnsupportedCopyItem(unsupported, result.reason);
          continue;
        }

        collectedRecords.push(result.record);
        if (trackConfig.trackType === "audio") {
          audioRecords.push(result.record);
          audioRecordsByKey.set(result.record.key, result.record);
          addRecordToListMap(audioRecordsBySignature, getTimelineItemAppendSignature(result.record), result.record);
        }
      }
    }
  }

  const subtitleItemCount = countTimelineItemsInTrackType(sourceTimeline, "subtitle");
  if (subtitleItemCount > 0) {
    addUnsupportedCopyItem(
      unsupported,
      "源时间线包含字幕项目，Resolve 脚本 AppendToTimeline 不支持直接复制字幕轨",
      subtitleItemCount
    );
  }

  if (unsupported.count > 0) {
    const suffix = unsupported.count > unsupported.reasons.length ? " 等" : "";
    return {
      clipInfos: [],
      reason: `源时间线包含 ${unsupported.count} 个无法直接复制的项目：${unsupported.reasons.join("；")}${suffix}。为避免生成不完整时间线已停止。`
    };
  }

  if (collectedRecords.length === 0) {
    return {
      clipInfos: [],
      reason: "源时间线没有可通过媒体池直接复制的音视频剪辑。"
    };
  }

  const appendEntries = [];
  const coveredAudioItemKeys = new Set();
  for (const record of collectedRecords) {
    if (record.trackType !== "video") {
      continue;
    }

    const linkedAudioRecords = findLinkedAudioRecords(record, audioRecordsByKey, audioRecordsBySignature).filter(
      (audioRecord) => !coveredAudioItemKeys.has(audioRecord.key)
    );
    if (linkedAudioRecords.length === 0) {
      appendEntries.push({
        clipInfo: record.clipInfo,
        expectedItemCount: 1,
        expectedRecords: [record],
        kind: "video",
        linkedAudioRecords: [],
        primaryRecord: record,
        recordFrame: record.recordFrame,
        trackOrder: record.trackOrder,
        trackIndex: record.trackIndex
      });
      continue;
    }

    for (const audioRecord of linkedAudioRecords) {
      coveredAudioItemKeys.add(audioRecord.key);
    }

    appendEntries.push({
      clipInfo: createAllMediaClipInfo(record.clipInfo),
      expectedItemCount: 1 + linkedAudioRecords.length,
      expectedRecords: [record, ...linkedAudioRecords],
      kind: "video-linked-audio",
      linkedAudioRecords,
      primaryRecord: record,
      recordFrame: record.recordFrame,
      trackOrder: record.trackOrder,
      trackIndex: record.trackIndex
    });
  }

  for (const record of audioRecords) {
    if (coveredAudioItemKeys.has(record.key)) {
      continue;
    }

    appendEntries.push({
      clipInfo: record.clipInfo,
      expectedItemCount: 1,
      expectedRecords: [record],
      kind: "audio",
      linkedAudioRecords: [],
      primaryRecord: record,
      recordFrame: record.recordFrame,
      trackOrder: record.trackOrder,
      trackIndex: record.trackIndex
    });
  }

  appendEntries.sort(
    (left, right) =>
      left.recordFrame - right.recordFrame || left.trackOrder - right.trackOrder || left.trackIndex - right.trackIndex
  );

  return {
    clipInfos: appendEntries.map((item) => item.clipInfo),
    appendEntries,
    expectedRecords: uniqueTimelineItemRecordsBySignature(appendEntries.flatMap((item) => item.expectedRecords)),
    expectedItemCount: appendEntries.reduce((total, item) => total + item.expectedItemCount, 0)
  };
}

function createTargetTimelineRecordMapper(sourceTimeline, targetTimeline, sourceFrameRate, targetFrameRate) {
  const sourceStartFrame = getTimelineStartFrame(sourceTimeline);
  const targetStartFrame = getTimelineStartFrame(targetTimeline);
  const mappedRecordsByKey = new Map();

  return (record) => {
    if (mappedRecordsByKey.has(record.key)) {
      return mappedRecordsByKey.get(record.key);
    }

    const targetRecordFrame = mapTimelineFrameForTargetFrameRate(
      record.recordFrame,
      sourceStartFrame,
      targetStartFrame,
      sourceFrameRate,
      targetFrameRate
    );
    const mappedRecord = {
      ...record,
      clipInfo: {
        ...record.clipInfo,
        recordFrame: targetRecordFrame
      },
      sourceRecordFrame: record.sourceRecordFrame ?? record.recordFrame,
      recordFrame: targetRecordFrame
    };
    mappedRecordsByKey.set(record.key, mappedRecord);
    return mappedRecord;
  };
}

function createTargetTimelineSourceContent(sourceContent, sourceTimeline, targetTimeline, sourceFrameRate, targetFrameRate) {
  const mapRecord = createTargetTimelineRecordMapper(sourceTimeline, targetTimeline, sourceFrameRate, targetFrameRate);
  const appendEntries = (sourceContent.appendEntries || []).map((entry) => {
    const primaryRecord = mapRecord(entry.primaryRecord);
    const linkedAudioRecords = (entry.linkedAudioRecords || []).map(mapRecord);
    const expectedRecords = (entry.expectedRecords || []).map(mapRecord);

    return {
      ...entry,
      clipInfo: entry.kind === "video-linked-audio" ? createAllMediaClipInfo(primaryRecord.clipInfo) : primaryRecord.clipInfo,
      expectedRecords,
      linkedAudioRecords,
      primaryRecord,
      recordFrame: primaryRecord.recordFrame
    };
  });

  return {
    ...sourceContent,
    clipInfos: appendEntries.map((entry) => entry.clipInfo),
    appendEntries,
    expectedRecords: uniqueTimelineItemRecordsBySignature(appendEntries.flatMap((entry) => entry.expectedRecords)),
    expectedItemCount: appendEntries.reduce((total, entry) => total + entry.expectedItemCount, 0)
  };
}

function createEmptyTimelineWithFrameRate(project, mediaPool, targetFolder, targetName, targetFrameRate) {
  safeCall(() => mediaPool.SetCurrentFolder(targetFolder), false);
  const projectFrameRateSet = safeCall(() => project.SetSetting("timelineFrameRate", String(targetFrameRate)), false);
  const createdTimeline = safeCall(() => mediaPool.CreateEmptyTimeline(targetName), null);
  if (!createdTimeline) {
    return {
      timeline: null,
      reason: "创建目标帧率空时间线失败。"
    };
  }

  const customSettingsSet = safeCall(
    () => createdTimeline.SetSetting && createdTimeline.SetSetting("useCustomSettings", "1"),
    false
  );
  const timelineFrameRateSet = safeCall(
    () => createdTimeline.SetSetting && createdTimeline.SetSetting("timelineFrameRate", String(targetFrameRate)),
    false
  );
  const actualFrameRate = getTimelineFrameRate(createdTimeline);
  if (!areFrameRatesEqual(actualFrameRate, targetFrameRate)) {
    const failedSteps = [
      projectFrameRateSet ? "" : "项目默认帧率临时设置失败",
      customSettingsSet ? "" : "时间线自定义设置启用失败",
      timelineFrameRateSet ? "" : "时间线帧率设置失败"
    ].filter(Boolean);
    const failureHint = failedSteps.length > 0 ? `${failedSteps.join("，")}，` : "";
    return {
      timeline: createdTimeline,
      reason: `${failureHint}创建的新时间线帧率为 ${actualFrameRate || "未知"} fps，未达到 ${targetFrameRate} fps。`
    };
  }

  return {
    timeline: createdTimeline
  };
}

function getAppendResultCount(appendResult, expectedCount) {
  if (appendResult === true) {
    return expectedCount;
  }

  return normalizeList(appendResult).length;
}

function addMatchingTimelineTrack(sourceTimeline, targetTimeline, trackType, trackIndex) {
  if (trackType === "audio") {
    const subTrackType = safeCall(
      () => sourceTimeline.GetTrackSubType && sourceTimeline.GetTrackSubType(trackType, trackIndex),
      ""
    );
    if (subTrackType) {
      return safeCall(() => targetTimeline.AddTrack && targetTimeline.AddTrack(trackType, subTrackType), false);
    }
  }

  return safeCall(() => targetTimeline.AddTrack && targetTimeline.AddTrack(trackType), false);
}

function ensureTargetTimelineTracks(sourceTimeline, targetTimeline) {
  for (const trackConfig of conversionTrackConfigs) {
    const requiredTrackCount = getTrackCount(sourceTimeline, trackConfig.trackType);
    let targetTrackCount = getTrackCount(targetTimeline, trackConfig.trackType);

    while (targetTrackCount < requiredTrackCount) {
      const nextTrackIndex = targetTrackCount + 1;
      const added = addMatchingTimelineTrack(
        sourceTimeline,
        targetTimeline,
        trackConfig.trackType,
        nextTrackIndex
      );
      const updatedTrackCount = getTrackCount(targetTimeline, trackConfig.trackType);
      if (!added || updatedTrackCount <= targetTrackCount) {
        return {
          ok: false,
          reason: `目标时间线无法创建${trackConfig.label}${nextTrackIndex}，已创建 ${updatedTrackCount}/${requiredTrackCount} 条${trackConfig.label}轨。`
        };
      }

      targetTrackCount = updatedTrackCount;
    }
  }

  return { ok: true };
}

function countConversionTimelineItems(timeline) {
  return conversionTrackConfigs.reduce(
    (total, trackConfig) => total + countTimelineItemsInTrackType(timeline, trackConfig.trackType),
    0
  );
}

function countUiCopyVerifiableTimelineItems(timeline) {
  return countConversionTimelineItems(timeline) + countTimelineItemsInTrackType(timeline, "subtitle");
}

function collectConversionTimelineRecords(timeline) {
  const records = [];
  for (const trackConfig of conversionTrackConfigs) {
    const trackCount = getTrackCount(timeline, trackConfig.trackType);
    for (let trackIndex = 1; trackIndex <= trackCount; trackIndex += 1) {
      const items = normalizeList(safeCall(() => timeline.GetItemListInTrack(trackConfig.trackType, trackIndex), []));
      for (const item of items) {
        const result = createTimelineItemRecord(item, trackConfig, trackIndex);
        if (result.record) {
          records.push(result.record);
        }
      }
    }
  }

  return records;
}

function buildRecordCountMap(records, signatureFn) {
  const counts = new Map();
  for (const record of records) {
    const signature = signatureFn(record);
    if (!signature) {
      continue;
    }

    counts.set(signature, (counts.get(signature) || 0) + 1);
  }

  return counts;
}

function findMissingTimelineRecords(expectedRecords, actualRecords, signatureFn = getTimelineItemCopySignature) {
  const actualCounts = buildRecordCountMap(actualRecords, signatureFn);
  const missingRecords = [];
  for (const record of expectedRecords) {
    const signature = signatureFn(record);
    const actualCount = actualCounts.get(signature) || 0;
    if (actualCount > 0) {
      actualCounts.set(signature, actualCount - 1);
      continue;
    }

    missingRecords.push(record);
  }

  return missingRecords;
}

function selectSupplementalTimelineRecords(missingRecords, actualRecords, maxCount, trackTypes = null) {
  const limit = Number.isFinite(maxCount) ? Math.max(0, maxCount) : missingRecords.length;
  if (limit <= 0) {
    return [];
  }

  const missingCandidateRecords = uniqueTimelineItemRecordsBySignature(
    missingRecords.filter((record) => !trackTypes || trackTypes.has(record.trackType))
  );
  if (missingCandidateRecords.length === 0) {
    return [];
  }

  const actualMediaCounts = buildRecordCountMap(
    actualRecords.filter((record) => !trackTypes || trackTypes.has(record.trackType)),
    getTimelineItemMediaCopySignature
  );
  const likelyMissing = [];
  const possiblePositionMismatch = [];
  for (const record of missingCandidateRecords) {
    const mediaSignature = getTimelineItemMediaCopySignature(record);
    const actualMediaCount = actualMediaCounts.get(mediaSignature) || 0;
    if (actualMediaCount > 0) {
      actualMediaCounts.set(mediaSignature, actualMediaCount - 1);
      possiblePositionMismatch.push(record);
      continue;
    }

    likelyMissing.push(record);
  }

  return [...likelyMissing, ...possiblePositionMismatch].slice(0, limit);
}

function selectFailedAppendTimelineRecords(appendResult, maxCount, trackTypes = null) {
  const limit = Number.isFinite(maxCount) ? Math.max(0, maxCount) : 0;
  if (!appendResult || limit <= 0) {
    return [];
  }

  const failedRecords = [];
  for (const attempt of appendResult.attempts || []) {
    if (!attempt || attempt.actualAdded >= attempt.expectedItemCount) {
      continue;
    }

    for (const record of attempt.expectedRecords || []) {
      if (!trackTypes || trackTypes.has(record.trackType)) {
        failedRecords.push(record);
      }
    }
  }

  return uniqueTimelineItemRecordsBySignature(failedRecords).slice(0, limit);
}

function summarizeSupplementalRecords(records) {
  const videoCount = records.filter((record) => record.trackType === "video").length;
  const audioCount = records.filter((record) => record.trackType === "audio").length;
  return { videoCount, audioCount };
}

function getTimelineRecordTrackLabel(record) {
  return `${record.trackType === "audio" ? "A" : "V"}${record.trackIndex}`;
}

function formatTimelineRecordForDiagnostic(record) {
  const name = String(record.name || "未命名片段").replace(/[\r\n；]+/g, " ").slice(0, 32);
  const recordFrameText =
    Number.isFinite(record.sourceRecordFrame) && record.sourceRecordFrame !== record.recordFrame
      ? `${record.sourceRecordFrame}->${record.recordFrame}`
      : record.recordFrame;
  return `${getTimelineRecordTrackLabel(record)}「${name}」@${recordFrameText} src:${record.clipInfo.startFrame}-${record.clipInfo.endFrame}`;
}

function formatRecordListForDiagnostic(records, maxCount = 4) {
  if (!records || records.length === 0) {
    return "";
  }

  const visibleRecords = records.slice(0, maxCount).map(formatTimelineRecordForDiagnostic);
  const suffix = records.length > visibleRecords.length ? ` 等 ${records.length} 条` : "";
  return `${visibleRecords.join("，")}${suffix}`;
}

function summarizeTimelineTrackCounts(timeline) {
  const parts = [];
  for (const trackConfig of conversionTrackConfigs) {
    const trackCount = getTrackCount(timeline, trackConfig.trackType);
    const prefix = trackConfig.trackType === "audio" ? "A" : "V";
    for (let trackIndex = 1; trackIndex <= trackCount; trackIndex += 1) {
      const itemCount = normalizeList(safeCall(() => timeline.GetItemListInTrack(trackConfig.trackType, trackIndex), [])).length;
      if (itemCount > 0) {
        parts.push(`${prefix}${trackIndex}=${itemCount}`);
      }
    }
  }

  return parts.length > 0 ? parts.join(", ") : "无音视频项目";
}

function summarizeUiCopyTimelineTrackCounts(timeline) {
  const mediaText = summarizeTimelineTrackCounts(timeline);
  const subtitleCount = countTimelineItemsInTrackType(timeline, "subtitle");
  if (subtitleCount <= 0) {
    return mediaText;
  }

  return mediaText === "无音视频项目" ? `字幕=${subtitleCount}` : `${mediaText}, 字幕=${subtitleCount}`;
}

function summarizeAppendPlan(sourceContent) {
  const appendEntries = sourceContent.appendEntries || [];
  const linkedEntries = appendEntries.filter((entry) => entry.kind === "video-linked-audio");
  const linkedAudioCount = linkedEntries.reduce((total, entry) => total + entry.linkedAudioRecords.length, 0);
  const standaloneAudioCount = appendEntries.filter((entry) => entry.kind === "audio").length;
  const examples = appendEntries
    .slice(0, 3)
    .map((entry) => {
      const kind = entry.kind === "video-linked-audio" ? `视频+音频x${entry.linkedAudioRecords.length}` : entry.kind === "audio" ? "音频" : "视频";
      return `${kind}:${formatTimelineRecordForDiagnostic(entry.primaryRecord)}`;
    })
    .join("，");
  const exampleText = examples ? `；示例 ${examples}${appendEntries.length > 3 ? " 等" : ""}` : "";

  return `计划 ${appendEntries.length} 次/${sourceContent.expectedItemCount || appendEntries.length} 项，linked ${linkedEntries.length} 组/${linkedAudioCount} 条音频，独立音频 ${standaloneAudioCount} 次${exampleText}`;
}

function truncateDiagnosticText(value, maxLength = 700) {
  const text = String(value || "");
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function buildTimelineCopyFailureReason(args) {
  const parts = [
    args.message,
    `源轨：${summarizeTimelineTrackCounts(args.sourceTimeline)}`,
    `目标轨：${summarizeTimelineTrackCounts(args.targetTimeline)}`,
    summarizeAppendPlan(args.sourceContent)
  ];

  const missingText = formatRecordListForDiagnostic(args.missingRecords || []);
  if (missingText) {
    const missingLabel =
      args.failedAppendRecords && args.failedAppendRecords.length > 0 ? "实际未新增" : "疑似缺失";
    parts.push(`${missingLabel}：${missingText}`);
  }

  if (args.supplementalResult && args.supplementalResult.attempted > 0) {
    const supplementalTypes = [
      args.supplementalResult.videoAttempted ? `视频 ${args.supplementalResult.videoAttempted}` : "",
      args.supplementalResult.audioAttempted ? `音频 ${args.supplementalResult.audioAttempted}` : ""
    ].filter(Boolean);
    const typeText = supplementalTypes.length > 0 ? `（${supplementalTypes.join("，")}）` : "";
    const reportedText =
      Number.isFinite(args.supplementalResult.reported) &&
      args.supplementalResult.reported !== args.supplementalResult.appended
        ? `，Resolve 返回 ${args.supplementalResult.reported}`
        : "";
    parts.push(`补追加项目：${args.supplementalResult.appended}/${args.supplementalResult.attempted}${reportedText}${typeText}`);
  }

  return truncateDiagnosticText(parts.filter(Boolean).join("；"));
}

function prepareMediaPoolSelectionForAppend(mediaPool, clipInfos) {
  // Older Resolve builds may no-op AppendToTimeline unless a media-pool clip is selected.
  const firstMediaPoolItem = clipInfos.map((clipInfo) => clipInfo && clipInfo.mediaPoolItem).find(Boolean);
  if (!firstMediaPoolItem) {
    return false;
  }

  return safeCall(() => mediaPool.SetSelectedClip && mediaPool.SetSelectedClip(firstMediaPoolItem), false);
}

function appendTimelineEntriesSequentially(mediaPool, targetTimeline, appendEntries) {
  let appended = 0;
  let reported = 0;
  let expectedItems = 0;
  const attempts = [];
  for (const entry of appendEntries) {
    const clipInfos = [entry.clipInfo];
    const expectedItemCount = entry.expectedItemCount || 1;
    expectedItems += expectedItemCount;
    prepareMediaPoolSelectionForAppend(mediaPool, clipInfos);
    const itemCountBeforeAppend = countConversionTimelineItems(targetTimeline);
    const appendResult = safeCall(() => mediaPool.AppendToTimeline(clipInfos), null);
    const itemCountAfterAppend = countConversionTimelineItems(targetTimeline);
    const reportedCount = getAppendResultCount(appendResult, expectedItemCount);
    const actualAdded = Math.max(itemCountAfterAppend - itemCountBeforeAppend, 0);
    reported += reportedCount;
    appended += actualAdded;
    attempts.push({
      entry,
      expectedItemCount,
      expectedRecords: entry.expectedRecords || [],
      actualAdded,
      reported: reportedCount
    });
  }

  return {
    attempted: appendEntries.length,
    expectedItems,
    appended,
    reported,
    attempts
  };
}

function appendSupplementalTimelineRecords(mediaPool, targetTimeline, records) {
  if (records.length === 0) {
    return {
      attempted: 0,
      appended: 0,
      reported: 0,
      videoAttempted: 0,
      audioAttempted: 0
    };
  }

  let appended = 0;
  let reported = 0;
  for (const record of records) {
    const clipInfos = [record.clipInfo];
    prepareMediaPoolSelectionForAppend(mediaPool, clipInfos);
    const itemCountBeforeAppend = countConversionTimelineItems(targetTimeline);
    const appendResult = safeCall(() => mediaPool.AppendToTimeline(clipInfos), null);
    const itemCountAfterAppend = countConversionTimelineItems(targetTimeline);
    reported += getAppendResultCount(appendResult, 1);
    appended += Math.max(itemCountAfterAppend - itemCountBeforeAppend, 0);
  }

  const { videoCount, audioCount } = summarizeSupplementalRecords(records);

  return {
    attempted: records.length,
    appended,
    reported,
    videoAttempted: videoCount,
    audioAttempted: audioCount
  };
}

function copyTimelineStartTimecode(sourceTimeline, targetTimeline) {
  const startTimecode = safeCall(() => sourceTimeline.GetStartTimecode && sourceTimeline.GetStartTimecode(), "");
  if (startTimecode) {
    safeCall(() => targetTimeline.SetStartTimecode && targetTimeline.SetStartTimecode(startTimecode), false);
  }
}

function copyTrackNames(sourceTimeline, targetTimeline) {
  for (const trackConfig of conversionTrackConfigs) {
    const sourceTrackCount = getTrackCount(sourceTimeline, trackConfig.trackType);
    const targetTrackCount = getTrackCount(targetTimeline, trackConfig.trackType);
    const copyCount = Math.min(sourceTrackCount, targetTrackCount);
    for (let trackIndex = 1; trackIndex <= copyCount; trackIndex += 1) {
      const name = safeCall(() => sourceTimeline.GetTrackName(trackConfig.trackType, trackIndex), "");
      if (name) {
        safeCall(() => targetTimeline.SetTrackName(trackConfig.trackType, trackIndex, name), false);
      }
    }
  }
}

function copyTimelineMarkers(sourceTimeline, targetTimeline) {
  const markers = safeCall(() => sourceTimeline.GetMarkers && sourceTimeline.GetMarkers(), {});
  for (const [frameId, marker] of Object.entries(markers || {})) {
    const frameNumber = toFiniteFrameNumber(frameId);
    if (frameNumber === null || !marker) {
      continue;
    }

    const duration = toFiniteFrameNumber(marker.duration);
    safeCall(
      () =>
        targetTimeline.AddMarker(
          frameNumber,
          marker.color || "Blue",
          marker.name || "",
          marker.note || "",
          duration !== null && duration > 0 ? duration : 1,
          marker.customData || ""
        ),
      false
    );
  }
}

function copyTimelineContentsDirectly(
  project,
  mediaPool,
  sourceTimeline,
  targetFolder,
  targetName,
  sourceFrameRate,
  targetFrameRate
) {
  const sourceContent = collectTimelineClipInfos(sourceTimeline);
  if (sourceContent.reason) {
    return {
      timeline: null,
      reason: sourceContent.reason
    };
  }

  const createResult = createEmptyTimelineWithFrameRate(project, mediaPool, targetFolder, targetName, targetFrameRate);
  if (!createResult.timeline || createResult.reason) {
    return createResult;
  }

  const createdTimeline = createResult.timeline;
  copyTimelineStartTimecode(sourceTimeline, createdTimeline);
  const switched = safeCall(() => project.SetCurrentTimeline(createdTimeline), false);
  if (!switched) {
    return {
      timeline: createdTimeline,
      reason: "切换到目标时间线失败。"
    };
  }

  const trackResult = ensureTargetTimelineTracks(sourceTimeline, createdTimeline);
  if (!trackResult.ok) {
    return {
      timeline: createdTimeline,
      reason: trackResult.reason || "目标时间线轨道创建失败。"
    };
  }

  const targetSourceContent = createTargetTimelineSourceContent(
    sourceContent,
    sourceTimeline,
    createdTimeline,
    sourceFrameRate,
    targetFrameRate
  );
  const itemCountBeforeAppend = countConversionTimelineItems(createdTimeline);
  const appendResult = appendTimelineEntriesSequentially(
    mediaPool,
    createdTimeline,
    targetSourceContent.appendEntries || []
  );
  const expectedItemCount =
    targetSourceContent.expectedItemCount || appendResult.expectedItems || appendResult.attempted;
  const appendedCount = appendResult.appended;
  const appendWarning =
    appendedCount < expectedItemCount
      ? `逐条追加实际新增 ${appendedCount}/${expectedItemCount} 个项目${
          appendResult.reported !== appendedCount ? `，Resolve 返回 ${appendResult.reported}` : ""
        }`
      : "";

  let copiedItemCount = countConversionTimelineItems(createdTimeline) - itemCountBeforeAppend;
  let targetRecords = collectConversionTimelineRecords(createdTimeline);
  let missingRecords = findMissingTimelineRecords(targetSourceContent.expectedRecords || [], targetRecords);
  let supplementalResult = null;
  let failedAppendRecords = [];
  if (copiedItemCount < expectedItemCount) {
    const missingItemCount = expectedItemCount - Math.max(copiedItemCount, 0);
    failedAppendRecords = selectFailedAppendTimelineRecords(appendResult, missingItemCount);
    const missingSupplementalRecords =
      failedAppendRecords.length > 0
        ? failedAppendRecords
        : selectSupplementalTimelineRecords(missingRecords, targetRecords, missingItemCount);

    if (missingSupplementalRecords.length > 0) {
      supplementalResult = appendSupplementalTimelineRecords(mediaPool, createdTimeline, missingSupplementalRecords);
      copiedItemCount = countConversionTimelineItems(createdTimeline) - itemCountBeforeAppend;
      targetRecords = collectConversionTimelineRecords(createdTimeline);
      missingRecords = findMissingTimelineRecords(targetSourceContent.expectedRecords || [], targetRecords);
      if (copiedItemCount < expectedItemCount) {
        const remainingItemCount = expectedItemCount - Math.max(copiedItemCount, 0);
        const remainingFailedRecords = selectFailedAppendTimelineRecords(appendResult, remainingItemCount);
        if (remainingFailedRecords.length > 0) {
          failedAppendRecords = remainingFailedRecords;
        }
      }
    }
  }

  if (copiedItemCount < expectedItemCount) {
    return {
      timeline: createdTimeline,
      reason: buildTimelineCopyFailureReason({
        message: `复制源时间线内容失败：目标时间线实际只有 ${Math.max(copiedItemCount, 0)}/${expectedItemCount} 个音视频项目。${appendWarning ? `（${appendWarning}）` : ""}`,
        sourceTimeline,
        targetTimeline: createdTimeline,
        sourceContent: targetSourceContent,
        missingRecords: failedAppendRecords.length > 0 ? failedAppendRecords : missingRecords,
        failedAppendRecords,
        supplementalResult
      })
    };
  }

  copyTrackNames(sourceTimeline, createdTimeline);
  copyTimelineMarkers(sourceTimeline, createdTimeline);

  const actualFrameRate = getTimelineFrameRate(createdTimeline);
  if (!areFrameRatesEqual(actualFrameRate, targetFrameRate)) {
    return {
      timeline: createdTimeline,
      reason: `新时间线帧率为 ${actualFrameRate || "未知"} fps，未达到 ${targetFrameRate} fps。`
    };
  }

  return {
    timeline: createdTimeline
  };
}

async function runResolveTimelineAutomation(action, timeoutMs = 8000) {
  return ipcRenderer.invoke("dv-batch-export:run-resolve-timeline-automation", {
    action,
    timeoutMs
  });
}

async function copyTimelineContentsWithUiAutomation(
  app,
  project,
  mediaPool,
  sourceTimeline,
  targetFolder,
  targetName,
  targetFrameRate
) {
  const sourceItemCount = countUiCopyVerifiableTimelineItems(sourceTimeline);
  const createResult = createEmptyTimelineWithFrameRate(project, mediaPool, targetFolder, targetName, targetFrameRate);
  if (!createResult.timeline || createResult.reason) {
    return createResult;
  }

  const createdTimeline = createResult.timeline;
  copyTimelineStartTimecode(sourceTimeline, createdTimeline);

  try {
    const switchedToTargetForSetup = safeCall(() => project.SetCurrentTimeline(createdTimeline), false);
    if (!switchedToTargetForSetup) {
      return {
        timeline: createdTimeline,
        reason: "切换到目标时间线失败。"
      };
    }

    const trackResult = ensureTargetTimelineTracks(sourceTimeline, createdTimeline);
    if (!trackResult.ok) {
      return {
        timeline: createdTimeline,
        reason: trackResult.reason || "目标时间线轨道创建失败。"
      };
    }

    const switchedToSource = safeCall(() => project.SetCurrentTimeline(sourceTimeline), false);
    if (!switchedToSource) {
      return {
        timeline: createdTimeline,
        reason: "切换到源时间线失败，无法执行模拟复制。"
      };
    }

    safeCall(() => app.OpenPage("edit"), false);
    await delay(500);
    await runResolveTimelineAutomation("copy", 10000);

    const switchedToTarget = safeCall(() => project.SetCurrentTimeline(createdTimeline), false);
    if (!switchedToTarget) {
      return {
        timeline: createdTimeline,
        reason: "切换到目标时间线失败，无法执行模拟粘贴。"
      };
    }

    safeCall(() => app.OpenPage("edit"), false);
    await delay(500);
    const itemCountBeforePaste = countUiCopyVerifiableTimelineItems(createdTimeline);
    await runResolveTimelineAutomation("paste", 10000);
    await delay(1200);

    const copiedItemCount = countUiCopyVerifiableTimelineItems(createdTimeline) - itemCountBeforePaste;
    if (sourceItemCount > 0 && copiedItemCount < sourceItemCount) {
      return {
        timeline: createdTimeline,
        reason: `模拟手动复制粘贴后目标时间线实际只有 ${Math.max(copiedItemCount, 0)}/${sourceItemCount} 个可校验项目。源轨：${summarizeUiCopyTimelineTrackCounts(sourceTimeline)}；目标轨：${summarizeUiCopyTimelineTrackCounts(createdTimeline)}。请确认 Resolve 主窗口未被遮挡，执行期间不要操作键盘鼠标，并确保 Timeline 面板可接收 Ctrl+A/C/V。`
      };
    }

    copyTrackNames(sourceTimeline, createdTimeline);
    copyTimelineMarkers(sourceTimeline, createdTimeline);

    const actualFrameRate = getTimelineFrameRate(createdTimeline);
    if (!areFrameRatesEqual(actualFrameRate, targetFrameRate)) {
      return {
        timeline: createdTimeline,
        reason: `新时间线帧率为 ${actualFrameRate || "未知"} fps，未达到 ${targetFrameRate} fps。`
      };
    }

    return {
      timeline: createdTimeline
    };
  } catch (error) {
    return {
      timeline: createdTimeline,
      reason: error instanceof Error ? error.message : "模拟手动复制粘贴失败。"
    };
  }
}

function validateFrameRateConversionRenderRequest(payload) {
  const outputDirectory = normalizeOutputDirectory(payload && payload.outputDirectory);
  if (!outputDirectory) {
    throw new Error("帧率转换导出需要先选择输出目录。");
  }

  const settings = payload && payload.settings;
  if (!settings) {
    throw new Error("帧率转换导出需要导出设置，请先在界面接入输出目录和导出参数。");
  }

  if (!settings.format) {
    throw new Error("帧率转换导出缺少导出格式。");
  }

  const width = Number(settings.resolution && settings.resolution.width);
  const height = Number(settings.resolution && settings.resolution.height);
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    throw new Error("帧率转换导出缺少有效分辨率。");
  }

  ensureDirectoryExists(outputDirectory);

  return {
    outputDirectory,
    settings,
    strategy: normalizeFrameRateConversionStrategy(payload && payload.strategy)
  };
}

async function renderTimelineToFrameRateFile(args) {
  const { project, formats, timeline, entry, outputDirectory, outputBaseName, outputExtension, settings } = args;
  const switched = safeCall(() => project.SetCurrentTimeline(timeline), false);
  if (!switched) {
    return {
      ok: false,
      reason: "切换到目标时间线失败。"
    };
  }

  if (settings.presetName) {
    const presetLoaded = safeCall(() => project.LoadRenderPreset(settings.presetName), false);
    if (!presetLoaded) {
      return {
        ok: false,
        reason: `加载预设失败：${settings.presetName}`
      };
    }
  }

  const renderModeSet = safeCall(() => project.SetCurrentRenderMode(1), false);
  if (!renderModeSet) {
    return {
      ok: false,
      reason: "设置单文件渲染模式失败。"
    };
  }

  const formatSet = applyRenderFormatAndCodec(project, formats, settings.format, settings.codec);
  if (!formatSet) {
    return {
      ok: false,
      reason: `设置导出格式/编码器失败：${settings.format}/${settings.codec || "-"}`
    };
  }

  const renderSettings = buildRenderSettings(settings, outputDirectory, outputBaseName);
  const renderSettingResult = applyRenderSettingsWithDiagnostics(project, renderSettings);
  if (!renderSettingResult.ok) {
    return {
      ok: false,
      reason: renderSettingResult.reason
    };
  }

  const jobId = safeCall(() => project.AddRenderJob(), "");
  if (jobId === "" || jobId === null || typeof jobId === "undefined") {
    return {
      ok: false,
      reason: "添加 Render Queue 任务失败。"
    };
  }

  const started = safeCall(() => project.StartRendering([jobId]), false);
  if (!started) {
    return {
      ok: false,
      jobId: String(jobId),
      reason: "任务已加入队列，但启动渲染失败，请到 Deliver 页检查。"
    };
  }

  await waitForRenderJobCompletion(project, jobId);
  const outputPath = await waitForRenderedOutputPath(outputDirectory, outputBaseName, outputExtension);

  return {
    ok: true,
    jobId: String(jobId),
    outputName: path.basename(outputPath),
    outputPath,
    timelineName: entry.name
  };
}

async function convertOneTimelineFrameRateOutput(args) {
  const {
    project,
    formats,
    entry,
    targetFrameRate,
    outputDirectory,
    outputExtension,
    settings,
    strategy,
    existingOutputBaseNames,
    projectName,
    index,
    namingTemplate,
    keepIntermediateFiles
  } = args;
  let sourceFrameRate;
  let activeJobId = "";
  let outputPath = "";
  let intermediatePath = "";
  let intermediateDirectory = "";

  try {
    const sourceTimeline = resolveTimelineById(project, entry.id);
    if (!sourceTimeline) {
      return {
        timelineName: entry.name,
        status: "failed",
        success: false,
        reason: "未在当前工程中定位到源时间线。"
      };
    }

    sourceFrameRate = getTimelineFrameRate(sourceTimeline) || entry.frameRate;
    if (areFrameRatesEqual(sourceFrameRate, targetFrameRate)) {
      return {
        timelineName: entry.name,
        status: "skipped",
        success: true,
        reason: `已是目标帧率 ${targetFrameRate} fps。`,
        sourceFrameRate,
        targetFrameRate,
        strategy
      };
    }

    const requestedBaseName = buildFrameRateConversionOutputBaseName({ namingTemplate }, projectName, entry, index, targetFrameRate);
    const outputBaseName = createUniqueOutputBaseName(requestedBaseName, existingOutputBaseNames, outputDirectory, outputExtension);
    outputPath = buildMediaOutputPath(outputDirectory, outputBaseName, outputExtension);

    if (strategy === "resolve-render") {
      const renderResult = await renderTimelineToFrameRateFile({
        project,
        formats,
        timeline: sourceTimeline,
        entry,
        outputDirectory,
        outputBaseName,
        outputExtension,
        settings: buildFrameRateConversionRenderProfile(settings, targetFrameRate)
      });
      activeJobId = renderResult.jobId || activeJobId;

      if (!renderResult.ok) {
        return {
          timelineName: entry.name,
          status: "failed",
          success: false,
          reason: renderResult.reason,
          sourceFrameRate,
          targetFrameRate,
          strategy,
          jobId: renderResult.jobId
        };
      }

      const validation = await probeAndValidateFrameRateOutput(renderResult.outputPath, targetFrameRate);
      return {
        timelineName: entry.name,
        status: "converted",
        success: true,
        sourceFrameRate,
        targetFrameRate,
        strategy,
        jobId: renderResult.jobId,
        outputName: renderResult.outputName,
        outputPath: renderResult.outputPath,
        validation
      };
    }

    if (!ffmpegFrameRateConversionStrategies.has(strategy)) {
      throw new Error("缺少有效的 FFmpeg 帧率转换策略。");
    }

    intermediateDirectory = path.join(outputDirectory, ".dv-frame-rate-conversion");
    ensureDirectoryExists(intermediateDirectory);

    const intermediateBaseName = sanitizeForWindowsFileName(`${outputBaseName}_source_${Date.now()}_${index}`);
    const sourceRenderFrameRate = sourceFrameRate || settings.frameRate || targetFrameRate;
    const intermediateRenderResult = await renderTimelineToFrameRateFile({
      project,
      formats,
      timeline: sourceTimeline,
      entry,
      outputDirectory: intermediateDirectory,
      outputBaseName: intermediateBaseName,
      outputExtension,
      settings: buildFrameRateConversionRenderProfile(settings, sourceRenderFrameRate)
    });
    activeJobId = intermediateRenderResult.jobId || activeJobId;

    if (!intermediateRenderResult.ok) {
      return {
        timelineName: entry.name,
        status: "failed",
        success: false,
        reason: intermediateRenderResult.reason,
        sourceFrameRate,
        targetFrameRate,
        strategy,
        jobId: intermediateRenderResult.jobId
      };
    }

    intermediatePath = intermediateRenderResult.outputPath;
    await ipcRenderer.invoke("dv-batch-export:probe-media-file", { filePath: intermediatePath });

    const ffmpegResult = await ipcRenderer.invoke("dv-batch-export:convert-frame-rate", {
      inputPath: intermediatePath,
      outputPath,
      targetFrameRate,
      strategy,
      overwrite: false
    });
    const validationReason = validateFrameRateConversionOutput(ffmpegResult.validation, targetFrameRate);
    if (validationReason) {
      throw new Error(validationReason);
    }

    return {
      timelineName: entry.name,
      status: "converted",
      success: true,
      sourceFrameRate,
      targetFrameRate,
      strategy,
      jobId: intermediateRenderResult.jobId,
      outputName: path.basename(ffmpegResult.outputPath),
      outputPath: ffmpegResult.outputPath,
      intermediatePath: keepIntermediateFiles ? intermediatePath : undefined,
      validation: ffmpegResult.validation
    };
  } catch (error) {
    return {
      timelineName: entry.name,
      status: "failed",
      success: false,
      reason: error instanceof Error ? error.message : "导出目标帧率视频失败。",
      sourceFrameRate,
      targetFrameRate,
      strategy,
      jobId: activeJobId || undefined,
      outputPath: outputPath || undefined
    };
  } finally {
    if (!keepIntermediateFiles) {
      deleteFileQuietly(intermediatePath);
      removeEmptyDirectoryQuietly(intermediateDirectory);
    }
  }
}

async function convertOneTimelineFrameRate(args) {
  const {
    app,
    project,
    mediaPool,
    entry,
    targetFrameRate,
    strategy,
    destinationFolderName,
    existingTimelineNames,
    originalTimeline,
    originalFolder,
    originalProjectFrameRate
  } = args;
  let createdTimeline = null;
  let sourceFrameRate;

  try {
    const sourceTimeline = resolveTimelineById(project, entry.id);
    if (!sourceTimeline) {
      return {
        timelineName: entry.name,
        status: "failed",
        success: false,
        reason: "未在当前工程中定位到源时间线。"
      };
    }

    sourceFrameRate = getTimelineFrameRate(sourceTimeline) || entry.frameRate;
    if (areFrameRatesEqual(sourceFrameRate, targetFrameRate)) {
      return {
        timelineName: entry.name,
        status: "skipped",
        success: true,
        reason: `已是目标帧率 ${targetFrameRate} fps。`,
        sourceFrameRate,
        targetFrameRate,
        strategy
      };
    }

    const targetFolderResult = resolveConversionTargetFolder(project, mediaPool, entry.folderId, destinationFolderName);
    if (!targetFolderResult.folder) {
      return {
        timelineName: entry.name,
        status: "failed",
        success: false,
        reason: targetFolderResult.reason || "定位目标媒体夹失败。",
        sourceFrameRate,
        targetFrameRate,
        strategy
      };
    }

    const baseName = createFrameRateTimelineBaseName(entry.name, targetFrameRate);
    const targetName = createUniqueTimelineName(baseName, existingTimelineNames);
    existingTimelineNames.push(targetName);

    safeCall(() => project.SetCurrentTimeline(sourceTimeline), false);
    safeCall(() => mediaPool.SetCurrentFolder(targetFolderResult.folder), false);

    const directCopyResult =
      strategy === uiCopyPasteFrameRateConversionStrategy
        ? await copyTimelineContentsWithUiAutomation(
            app,
            project,
            mediaPool,
            sourceTimeline,
            targetFolderResult.folder,
            targetName,
            targetFrameRate
          )
        : copyTimelineContentsDirectly(
            project,
            mediaPool,
            sourceTimeline,
            targetFolderResult.folder,
            targetName,
            sourceFrameRate,
            targetFrameRate
          );

    if (directCopyResult.timeline && !directCopyResult.reason) {
      createdTimeline = directCopyResult.timeline;
    } else {
      if (directCopyResult.timeline) {
        deleteTimelineQuietly(mediaPool, directCopyResult.timeline);
      }
      return {
        timelineName: entry.name,
        status: "failed",
        success: false,
        reason: directCopyResult.reason || "无法创建目标帧率的新时间线。",
        sourceFrameRate,
        targetFrameRate,
        strategy
      };
    }

    const moveResult = ensureTimelineInFolder(mediaPool, createdTimeline, targetFolderResult.folder);
    if (!moveResult.ok) {
      deleteTimelineQuietly(mediaPool, createdTimeline);
      return {
        timelineName: entry.name,
        status: "failed",
        success: false,
        reason: moveResult.reason,
        sourceFrameRate,
        targetFrameRate,
        strategy
      };
    }

    return {
      timelineName: entry.name,
      status: "converted",
      success: true,
      newTimelineId: safeCall(() => createdTimeline.GetUniqueId(), ""),
      newTimelineName: safeCall(() => createdTimeline.GetName(), targetName),
      targetFolderName: targetFolderResult.folderName,
      sourceFrameRate,
      targetFrameRate,
      strategy
    };
  } catch (error) {
    if (createdTimeline) {
      deleteTimelineQuietly(mediaPool, createdTimeline);
    }

    return {
      timelineName: entry.name,
      status: "failed",
      success: false,
      reason: error instanceof Error ? error.message : "转换时间线帧率失败。",
      sourceFrameRate,
      targetFrameRate,
      strategy
    };
  } finally {
    restoreConversionState(project, mediaPool, originalTimeline, originalFolder, originalProjectFrameRate);
  }
}

async function convertTimelineFrameRates(payload) {
  payload = payload || {};
  const { app, project } = getProjectContext();
  const version = getVersionInfo();
  const mediaPool = project.GetMediaPool();

  if (!version.isStudio || version.majorVersion < 19) {
    throw new Error("该插件仅支持 DaVinci Resolve Studio 19 及以上版本。");
  }

  if (safeCall(() => project.IsRenderingInProgress(), false)) {
    throw new Error("当前已有渲染任务正在执行，请等待完成或手动停止后再转换帧率。");
  }

  const selectedTimelines = Array.isArray(payload.selectedTimelines) ? payload.selectedTimelines : [];
  if (selectedTimelines.length === 0) {
    throw new Error("请至少选择一条时间线。");
  }

  const targetFrameRate = Number(payload.targetFrameRate);
  if (!Number.isFinite(targetFrameRate) || targetFrameRate <= 0) {
    throw new Error("请选择有效的目标帧率。");
  }

  const originalTimeline = safeCall(() => project.GetCurrentTimeline(), null);
  const originalFolder = safeCall(() => mediaPool.GetCurrentFolder(), null);
  const originalProjectFrameRate = safeCall(() => project.GetSetting("timelineFrameRate"), "");
  const destinationFolderName = normalizeDestinationFolderName(payload.destinationFolderName);
  const strategy = normalizeFrameRateConversionStrategy(payload.strategy);
  const existingTimelineNames = getAllTimelineNames(project);
  const results = [];

  try {
    for (let index = 0; index < selectedTimelines.length; index += 1) {
      const entry = selectedTimelines[index];
      results.push(
        await convertOneTimelineFrameRate({
          app,
          project,
          mediaPool,
          entry,
          targetFrameRate,
          strategy,
          destinationFolderName,
          existingTimelineNames,
          originalTimeline,
          originalFolder,
          originalProjectFrameRate
        })
      );
    }
  } finally {
    restoreConversionState(project, mediaPool, originalTimeline, originalFolder, originalProjectFrameRate);
  }

  const summary = summarizeFrameRateConversionResults(results);

  return {
    targetFrameRate,
    ...summary,
    results
  };
}

async function runBatchExport(payload) {
  const { app, project } = getProjectContext();
  const version = getVersionInfo();
  const formats = getRenderFormats(project);

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

  if (!payload.settings || (!payload.settings.exportVideo && !payload.settings.exportAudio)) {
    throw new Error("请至少开启视频或音频导出。");
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

    const formatSet = applyRenderFormatAndCodec(project, formats, payload.settings.format, payload.settings.codec);

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
  async getAllTimelines() {
    return listAllTimelines();
  },
  async prepareTimelineCache(forceRefresh) {
    return prepareTimelineCache(Boolean(forceRefresh));
  },
  async getRenderOptions(selection) {
    return getRenderOptions(selection);
  },
  async chooseOutputDirectory() {
    return ipcRenderer.invoke("dv-batch-export:select-output-directory");
  },
  async probeMediaFile(payload) {
    return ipcRenderer.invoke("dv-batch-export:probe-media-file", payload);
  },
  async convertFrameRateWithFfmpeg(payload) {
    return ipcRenderer.invoke("dv-batch-export:convert-frame-rate", payload);
  },
  async runBatchExport(payload) {
    return runBatchExport(payload);
  },
  async convertTimelineFrameRates(payload) {
    return convertTimelineFrameRates(payload);
  }
};

contextBridge.exposeInMainWorld("resolveBridge", bridge);

const updateBridge = {
  async getSettings() {
    return ipcRenderer.invoke("dv-export:update-get-settings");
  },
  async saveSettings(settings) {
    return ipcRenderer.invoke("dv-export:update-save-settings", settings);
  },
  async getState() {
    return ipcRenderer.invoke("dv-export:update-get-state");
  },
  async checkForUpdates() {
    return ipcRenderer.invoke("dv-export:update-check");
  },
  async deferUpdate() {
    return ipcRenderer.invoke("dv-export:update-defer");
  },
  async installUpdateNow() {
    return ipcRenderer.invoke("dv-export:update-install-now");
  },
  onStateChanged(listener) {
    const handler = (_event, state) => listener(state);
    ipcRenderer.on("dv-export:update-state-changed", handler);
    return () => ipcRenderer.removeListener("dv-export:update-state-changed", handler);
  }
};

contextBridge.exposeInMainWorld("updateBridge", updateBridge);
