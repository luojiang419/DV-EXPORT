# 043 Resolve渲染帧率转换

## 已完成内容

- 已读取最新快照：`042-FFmpeg主进程能力.md`
- 已创建阶段备份：`backup/028-Resolve渲染帧率转换前`
- 已完成模块 3：`plugin-runtime/preload.js` 的帧率转换入口改造
- 新 `convertTimelineFrameRates()` 已从旧的时间线复制路线切换为输出型转换：
  - 校验所选时间线、目标帧率、输出目录、导出设置
  - `resolve-render`：Resolve 直接渲染目标帧率视频文件
  - `ffmpeg-cfr` / `ffmpeg-motion`：Resolve 先渲染临时母版，再由 FFmpeg 输出目标帧率文件
  - 使用 `project.AddRenderJob()`、`project.StartRendering([jobId])`、`project.GetRenderJobStatus(jobId)` 等待渲染完成
  - 渲染后通过 `probeMediaFile()` 校验输出帧率、时长，并返回音频流探测结果
  - FFmpeg 临时母版默认写入 `.dv-frame-rate-conversion`，任务结束后自动清理
- 旧的创建新时间线与 `AppendToTimeline` 复制函数仍保留，但新入口不再调用
- 当前 UI 还未接入 `outputDirectory/settings/strategy`，因此运行时会先返回明确错误；模块 4 再接 UI

## 当前修改模块

- `plugin-runtime/preload.js`
- `backup/028-Resolve渲染帧率转换前`
- `进度快照/043-Resolve渲染帧率转换.md`

## 具体修改的代码前后对比

### `plugin-runtime/preload.js`

修改前入口：

```js
async function convertTimelineFrameRates(payload) {
  const { project } = getProjectContext();
  const mediaPool = project.GetMediaPool();
  const existingTimelineNames = getAllTimelineNames(project);
  const destinationFolderName = normalizeDestinationFolderName(payload.destinationFolderName);

  for (const entry of selectedTimelines) {
    results.push(
      convertOneTimelineFrameRate({
        project,
        mediaPool,
        entry,
        targetFrameRate,
        destinationFolderName,
        existingTimelineNames,
        originalTimeline,
        originalFolder,
        originalProjectFrameRate
      })
    );
  }
}
```

修改后入口：

```js
async function convertTimelineFrameRates(payload) {
  payload = payload || {};
  const { app, project } = getProjectContext();
  const conversionRequest = validateFrameRateConversionRenderRequest(payload);
  const formats = getRenderFormats(project);
  const outputExtension = getRenderOutputExtension(formats, conversionRequest.settings.format);

  safeCall(() => app.OpenPage("deliver"), false);

  for (let index = 0; index < selectedTimelines.length; index += 1) {
    results.push(
      await convertOneTimelineFrameRateOutput({
        project,
        formats,
        entry,
        targetFrameRate,
        outputDirectory: conversionRequest.outputDirectory,
        outputExtension,
        settings: conversionRequest.settings,
        strategy: conversionRequest.strategy,
        existingOutputBaseNames,
        projectName,
        index: index + 1,
        namingTemplate: payload.namingTemplate,
        keepIntermediateFiles: Boolean(payload.keepIntermediateFiles)
      })
    );
  }
}
```

新增渲染等待核心：

```js
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
}
```

新增输出校验核心：

```js
async function probeAndValidateFrameRateOutput(outputPath, targetFrameRate) {
  const validation = await ipcRenderer.invoke("dv-batch-export:probe-media-file", { filePath: outputPath });
  const validationReason = validateFrameRateConversionOutput(validation, targetFrameRate);
  if (validationReason) {
    throw new Error(validationReason);
  }

  return validation;
}
```

## 验证结果

- `node --check plugin-runtime/preload.js` 通过
- `npm run typecheck` 通过
- `npm test` 通过
  - 6 个测试文件
  - 19 条用例

## 待办清单

- 模块 4：改造 `FrameRateConversionPanel` 与 `App.tsx`，接入输出目录、导出设置、转换策略和输出文件结果展示
- 模块 5：更新文档、版本号、构建产物并安装到 Resolve
- Resolve 内实机验证：模块 4 接入 UI 后再用真实时间线测试 `resolve-render`、`ffmpeg-cfr`、`ffmpeg-motion`

## 下一步

继续模块 4：把帧率转换 UI 从“新媒体夹/新时间线”改为“输出目录/转换策略/导出结果”，并把 `outputDirectory/settings/strategy` 传入运行时。
