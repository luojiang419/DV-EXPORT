# 042 FFmpeg主进程能力

## 已完成内容

- 已读取最新快照：`041-帧率转换导出契约.md`
- 已创建阶段备份：
  - `backup/027-FFmpeg主进程能力前`
- 已完成模块 2：主进程侧 FFmpeg/FFprobe 能力
- 在 `plugin-runtime/main.js` 中新增：
  - FFmpeg/FFprobe 可执行文件解析
  - 安全的 `spawn` 子进程执行封装
  - FFprobe JSON 探测与帧率解析
  - `fps` 固定帧率转换参数生成
  - `minterpolate` 运动插帧转换参数生成
  - `dv-batch-export:probe-media-file` IPC
  - `dv-batch-export:convert-frame-rate` IPC
- 在 `plugin-runtime/preload.js` 中新增 bridge 方法：
  - `probeMediaFile(payload)`
  - `convertFrameRateWithFfmpeg(payload)`
- 在 TypeScript 类型中新增：
  - `FrameRateMediaProbeRequest`
  - `FrameRateMediaProbeResponse`
  - `FfmpegFrameRateConversionRequest`
  - `FfmpegFrameRateConversionResponse`

## 当前修改模块

- `plugin-runtime/main.js`
- `plugin-runtime/preload.js`
- `src/types/models.ts`
- `src/types/resolve.ts`
- `backup/027-FFmpeg主进程能力前`
- `进度快照/042-FFmpeg主进程能力.md`

## 具体修改的代码前后对比

### `plugin-runtime/main.js`

修改前：

```js
const path = require("path");
const { app, BrowserWindow, dialog, ipcMain } = require("electron");

const pluginRoot = __dirname;
```

修改后：

```js
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { app, BrowserWindow, dialog, ipcMain } = require("electron");

const pluginRoot = __dirname;
const ffmpegConversionStrategies = new Set(["ffmpeg-cfr", "ffmpeg-motion"]);
```

新增：

```js
ipcMain.handle("dv-batch-export:probe-media-file", async (_event, payload) => {
  return probeMediaFile(payload);
});

ipcMain.handle("dv-batch-export:convert-frame-rate", async (_event, payload) => {
  return convertFrameRateWithFfmpeg(payload);
});
```

核心转换参数：

```js
function buildFrameRateFilter(strategy, targetFrameRate) {
  const frameRateArgument = formatFrameRateArgument(targetFrameRate);
  if (strategy === "ffmpeg-motion") {
    return `minterpolate=fps=${frameRateArgument}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1`;
  }

  return `fps=${frameRateArgument}`;
}
```

### `plugin-runtime/preload.js`

修改前：

```js
async chooseOutputDirectory() {
  return ipcRenderer.invoke("dv-batch-export:select-output-directory");
},
async runBatchExport(payload) {
  return runBatchExport(payload);
},
```

修改后：

```js
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
```

### `src/types/models.ts`

新增：

```ts
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
```

### `src/types/resolve.ts`

新增：

```ts
probeMediaFile(payload: FrameRateMediaProbeRequest): Promise<FrameRateMediaProbeResponse>;
convertFrameRateWithFfmpeg(payload: FfmpegFrameRateConversionRequest): Promise<FfmpegFrameRateConversionResponse>;
```

## 验证结果

- `node --check plugin-runtime/main.js` 通过
- `node --check plugin-runtime/preload.js` 通过
- `npm run typecheck` 通过
- `npm test` 通过
  - 6 个测试文件
  - 19 条用例
- FFmpeg 冒烟测试通过：
  - 生成 1 秒临时视频
  - 用 `fps=30` 转换
  - FFprobe 返回输出帧率 `30/1`
  - 临时目录已清理
- 已确认当前 FFmpeg 构建支持：
  - `fps`
  - `minterpolate`

## 待办清单

- 模块 3：改造 `plugin-runtime/preload.js` 中的 `convertTimelineFrameRates()`，从旧的时间线复制路线切换到“Resolve 渲染 + FFmpeg/FFprobe 校验”
- 模块 4：改造 `FrameRateConversionPanel` UI，加入输出目录、转换策略、输出文件结果
- 模块 5：更新文档、版本号、构建产物并安装到 Resolve

## 下一步

继续模块 3：实现 Resolve 渲染队列与 FFmpeg 后处理的组合流程。开始前读取本快照，并创建下一个阶段备份。
