"use strict";

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const UpdateController = require("./updater/update-controller");

const pluginRoot = __dirname;
let mainWindow = null;
let parentProcessMonitor = null;
let updateController = null;
const ffmpegConversionStrategies = new Set(["ffmpeg-cfr", "ffmpeg-motion"]);
const resolveTimelineAutomationActions = new Set(["copy", "paste"]);

function getPathEnvironmentCandidates(envKeys) {
  return envKeys.map((key) => String(process.env[key] || "").trim()).filter(Boolean);
}

function findExecutableOnPath(executableNames) {
  const pathEntries = String(process.env.PATH || "")
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);

  for (const entry of pathEntries) {
    for (const executableName of executableNames) {
      const candidate = path.join(entry, executableName);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return "";
}

function resolveToolPath(toolName) {
  const envKeys =
    toolName === "ffmpeg"
      ? ["DV_EXPORT_FFMPEG_PATH", "FFMPEG_PATH"]
      : ["DV_EXPORT_FFPROBE_PATH", "FFPROBE_PATH"];
  const executableName = process.platform === "win32" ? `${toolName}.exe` : toolName;
  const candidates = [
    ...envKeys.map((key) => process.env[key]),
    path.join(pluginRoot, "bin", executableName),
    path.join(pluginRoot, executableName)
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return executableName;
}

function resolveAutoHotkeyPath() {
  if (process.platform !== "win32") {
    throw new Error("模拟手动复制粘贴仅支持 Windows。");
  }

  const configuredCandidates = getPathEnvironmentCandidates([
    "DV_EXPORT_AUTOHOTKEY_PATH",
    "AUTOHOTKEY_PATH",
    "AHK_PATH"
  ]);
  const knownCandidates = [
    path.join(pluginRoot, "bin", "AutoHotkey64.exe"),
    path.join(pluginRoot, "bin", "AutoHotkey.exe"),
    "C:\\Program Files\\AutoHotkey\\v2\\AutoHotkey64.exe",
    "C:\\Program Files\\AutoHotkey\\v2\\AutoHotkey.exe",
    "C:\\Program Files\\AutoHotkey\\AutoHotkey64.exe",
    "C:\\Program Files\\AutoHotkey\\AutoHotkey.exe",
    "C:\\Program Files (x86)\\AutoHotkey\\AutoHotkey.exe"
  ];

  for (const candidate of [...configuredCandidates, ...knownCandidates]) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  const pathCandidate = findExecutableOnPath(["AutoHotkey64.exe", "AutoHotkey.exe", "AutoHotkey32.exe"]);
  if (pathCandidate) {
    return pathCandidate;
  }

  const configuredHint =
    configuredCandidates.length > 0
      ? `已检查配置路径：${configuredCandidates.join("；")}。`
      : "未配置 DV_EXPORT_AUTOHOTKEY_PATH。";
  throw new Error(
    `${configuredHint} 未检测到 AutoHotkey v2。请安装 AutoHotkey v2，或将 AutoHotkey64.exe 路径写入 DV_EXPORT_AUTOHOTKEY_PATH。`
  );
}

function appendLimitedText(current, chunk, maxLength = 1024 * 1024) {
  const next = `${current}${chunk}`;
  return next.length > maxLength ? next.slice(next.length - maxLength) : next;
}

function runProcess(command, args, options = {}) {
  const timeoutMs = options.timeoutMs || 0;

  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const child = spawn(command, args, {
      windowsHide: true
    });

    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            if (settled) {
              return;
            }
            settled = true;
            child.kill();
            reject(new Error(`${path.basename(command)} 执行超时。`));
          }, timeoutMs)
        : null;

    child.stdout.on("data", (chunk) => {
      stdout = appendLimitedText(stdout, chunk.toString("utf-8"));
    });

    child.stderr.on("data", (chunk) => {
      stderr = appendLimitedText(stderr, chunk.toString("utf-8"));
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      reject(error);
    });

    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }

      if (code !== 0) {
        const detail = stderr.trim() ? `：${stderr.trim().slice(-4000)}` : "";
        reject(new Error(`${path.basename(command)} 执行失败，退出码 ${code}${detail}`));
        return;
      }

      resolve({ stdout, stderr });
    });
  });
}

function parsePositiveNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : undefined;
}

function parseRationalFrameRate(value) {
  if (!value) {
    return undefined;
  }

  const text = String(value).trim();
  if (text.includes("/")) {
    const [left, right] = text.split("/").map(Number);
    if (Number.isFinite(left) && Number.isFinite(right) && right > 0) {
      const result = left / right;
      return Number.isFinite(result) && result > 0 ? result : undefined;
    }
    return undefined;
  }

  return parsePositiveNumber(text);
}

function formatFrameRateArgument(frameRate) {
  const numericFrameRate = parsePositiveNumber(frameRate);
  if (!numericFrameRate) {
    throw new Error("目标帧率无效。");
  }

  return String(numericFrameRate);
}

function buildFfprobeInfo(filePath, probeResult) {
  const streams = Array.isArray(probeResult.streams) ? probeResult.streams : [];
  const videoStream = streams.find((stream) => stream && stream.codec_type === "video") || {};
  const audioStream = streams.find((stream) => stream && stream.codec_type === "audio") || {};
  const durationSeconds =
    parsePositiveNumber(videoStream.duration) ||
    parsePositiveNumber(audioStream.duration) ||
    parsePositiveNumber(probeResult.format && probeResult.format.duration);

  return {
    filePath,
    outputFrameRate: parseRationalFrameRate(videoStream.avg_frame_rate) || parseRationalFrameRate(videoStream.r_frame_rate),
    durationSeconds,
    hasAudio: Boolean(audioStream.codec_type),
    width: parsePositiveNumber(videoStream.width),
    height: parsePositiveNumber(videoStream.height),
    videoCodec: videoStream.codec_name || undefined,
    audioCodec: audioStream.codec_name || undefined
  };
}

async function probeMediaFile(payload) {
  const filePath = String((payload && payload.filePath) || "").trim();
  if (!filePath) {
    throw new Error("缺少需要探测的媒体文件路径。");
  }

  if (!fs.existsSync(filePath)) {
    throw new Error(`媒体文件不存在：${filePath}`);
  }

  const ffprobePath = resolveToolPath("ffprobe");
  const result = await runProcess(
    ffprobePath,
    ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", filePath],
    { timeoutMs: 60 * 1000 }
  );

  let probeResult = null;
  try {
    probeResult = JSON.parse(result.stdout);
  } catch (error) {
    throw new Error("解析 FFprobe 输出失败。");
  }

  return buildFfprobeInfo(filePath, probeResult || {});
}

function buildFrameRateFilter(strategy, targetFrameRate) {
  const frameRateArgument = formatFrameRateArgument(targetFrameRate);
  if (strategy === "ffmpeg-motion") {
    return `minterpolate=fps=${frameRateArgument}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1`;
  }

  return `fps=${frameRateArgument}`;
}

function buildFfmpegConversionArgs(payload) {
  const inputPath = String((payload && payload.inputPath) || "").trim();
  const outputPath = String((payload && payload.outputPath) || "").trim();
  const strategy = payload && payload.strategy;
  const targetFrameRate = parsePositiveNumber(payload && payload.targetFrameRate);

  if (!inputPath) {
    throw new Error("缺少 FFmpeg 输入文件路径。");
  }

  if (!outputPath) {
    throw new Error("缺少 FFmpeg 输出文件路径。");
  }

  if (!targetFrameRate) {
    throw new Error("缺少有效的目标帧率。");
  }

  if (!ffmpegConversionStrategies.has(strategy)) {
    throw new Error("缺少有效的 FFmpeg 帧率转换策略。");
  }

  if (!fs.existsSync(inputPath)) {
    throw new Error(`FFmpeg 输入文件不存在：${inputPath}`);
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const videoCodec = String((payload && payload.videoCodec) || "libx264").trim();
  const audioCodec = String((payload && payload.audioCodec) || "aac").trim();
  const frameRateArgument = formatFrameRateArgument(targetFrameRate);
  const args = [
    "-hide_banner",
    payload && payload.overwrite === false ? "-n" : "-y",
    "-i",
    inputPath,
    "-map",
    "0:v:0",
    "-map",
    "0:a?",
    "-vf",
    buildFrameRateFilter(strategy, targetFrameRate),
    "-r",
    frameRateArgument,
    "-fps_mode",
    "cfr",
    "-c:v",
    videoCodec
  ];

  if (videoCodec === "libx264" || videoCodec === "libx265") {
    args.push("-preset", "medium", "-crf", "18");
  }

  if (videoCodec !== "copy") {
    args.push("-pix_fmt", "yuv420p");
  }

  if (payload && payload.keepSourceAudio) {
    args.push("-c:a", "copy");
  } else {
    args.push("-c:a", audioCodec);
    if (audioCodec === "aac") {
      args.push("-b:a", "192k");
    }
  }

  args.push(outputPath);

  return {
    inputPath,
    outputPath,
    targetFrameRate,
    strategy,
    args
  };
}

async function convertFrameRateWithFfmpeg(payload) {
  const request = buildFfmpegConversionArgs(payload);
  const ffmpegPath = resolveToolPath("ffmpeg");
  const result = await runProcess(ffmpegPath, request.args);
  const validation = await probeMediaFile({ filePath: request.outputPath });

  return {
    outputPath: request.outputPath,
    targetFrameRate: request.targetFrameRate,
    strategy: request.strategy,
    validation,
    stderr: result.stderr.trim() || undefined
  };
}

async function runResolveTimelineAutomation(payload) {
  const action = String((payload && payload.action) || "").trim();
  const timeoutMs = Math.min(Math.max(Number(payload && payload.timeoutMs) || 8000, 1000), 60000);

  if (!resolveTimelineAutomationActions.has(action)) {
    throw new Error("缺少有效的时间线自动化动作。");
  }

  const scriptPath = path.join(pluginRoot, "automation", "resolve-timeline-copy-paste.ahk");
  if (!fs.existsSync(scriptPath)) {
    throw new Error("缺少 AutoHotkey 时间线复制粘贴脚本。");
  }

  const autoHotkeyPath = resolveAutoHotkeyPath();
  const result = await runProcess(autoHotkeyPath, [scriptPath, action, String(timeoutMs)], {
    timeoutMs: timeoutMs + 5000
  });

  return {
    action,
    stdout: result.stdout.trim() || undefined,
    stderr: result.stderr.trim() || undefined
  };
}

function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();
    return mainWindow;
  }

  mainWindow = new BrowserWindow({
    width: 1520,
    height: 960,
    minWidth: 1280,
    minHeight: 760,
    title: "达芬奇批量导出",
    backgroundColor: "#1b1d21",
    webPreferences: {
      preload: path.join(pluginRoot, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(pluginRoot, "index.html"));
  return mainWindow;
}

function isProcessAlive(processId) {
  if (!processId) {
    return false;
  }

  try {
    process.kill(processId, 0);
    return true;
  } catch {
    return false;
  }
}

function startParentProcessMonitor() {
  if (parentProcessMonitor || !process.ppid) {
    return;
  }

  const parentProcessId = process.ppid;
  parentProcessMonitor = setInterval(() => {
    if (!isProcessAlive(parentProcessId)) {
      app.quit();
    }
  }, 5000);

  if (typeof parentProcessMonitor.unref === "function") {
    parentProcessMonitor.unref();
  }
}

function publishUpdateState(state) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("dv-export:update-state-changed", state);
  }
}

function registerUpdateHandlers() {
  ipcMain.handle("dv-export:update-get-settings", async () => updateController.getSettings());
  ipcMain.handle("dv-export:update-save-settings", async (_event, settings) => {
    return updateController.saveSettings(settings);
  });
  ipcMain.handle("dv-export:update-get-state", async () => updateController.getState());
  ipcMain.handle("dv-export:update-check", async () => updateController.checkForUpdates({ manual: true }));
  ipcMain.handle("dv-export:update-defer", async () => updateController.deferUpdate());
  ipcMain.handle("dv-export:update-install-now", async () => updateController.installUpdateNow());
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    createWindow();
  });

  app.whenReady().then(async () => {
    updateController = new UpdateController({ app, publish: publishUpdateState });
    let deferredUpdateLaunched = false;
    try {
      deferredUpdateLaunched = await updateController.handleDeferredStartup();
    } catch (error) {
      console.error("Deferred update launch failed:", error);
    }
    if (deferredUpdateLaunched) {
      app.quit();
      return;
    }

    registerUpdateHandlers();
    ipcMain.handle("dv-batch-export:select-output-directory", async () => {
      const result = await dialog.showOpenDialog({
        title: "选择导出目录",
        properties: ["openDirectory", "createDirectory"]
      });

      if (result.canceled || result.filePaths.length === 0) {
        return null;
      }

      return result.filePaths[0];
    });

    ipcMain.handle("dv-batch-export:probe-media-file", async (_event, payload) => {
      return probeMediaFile(payload);
    });

    ipcMain.handle("dv-batch-export:convert-frame-rate", async (_event, payload) => {
      return convertFrameRateWithFfmpeg(payload);
    });

    ipcMain.handle("dv-batch-export:run-resolve-timeline-automation", async (_event, payload) => {
      return runResolveTimelineAutomation(payload);
    });

    startParentProcessMonitor();
    createWindow();
    await updateController.initialize();
    void updateController.startAutomaticCheck();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });
}

app.on("window-all-closed", () => {
  app.quit();
});
