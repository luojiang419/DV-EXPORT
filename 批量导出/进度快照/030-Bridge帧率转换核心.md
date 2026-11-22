# 030 Bridge 帧率转换核心

## 已完成内容

- 在 `plugin-runtime/preload.js` 新增 `convertTimelineFrameRates(payload)` Bridge 方法
- 新增运行时命名、重名、帧率比较、结果汇总辅助逻辑
- 新增目标媒体夹解析：
  - 不填写目标媒体夹：使用源时间线所在媒体夹
  - 填写目标媒体夹：在媒体池根目录复用或创建同名文件夹
- 新增精确复制候选路径：
  - 优先 `DuplicateTimeline(targetName)` 后验证目标帧率
  - 失败后用 DRT 导出/导入，并在导入前临时设置项目默认 `timelineFrameRate`
- 新增安全恢复：
  - 每条转换结束后恢复项目原始 `timelineFrameRate`
  - 恢复原当前时间线
  - 恢复原媒体池当前文件夹
- 新增临时 DRT 文件清理
- 转换成功后强制刷新时间线缓存
- 已执行验证：
  - `node --check plugin-runtime/preload.js`
  - `npm run typecheck`

## 当前修改模块

- `plugin-runtime/preload.js`
- `进度快照/030-Bridge帧率转换核心.md`

## 具体修改的代码前后对比

### Bridge 出口

修改前：

```js
async runBatchExport(payload) {
  return runBatchExport(payload);
}
```

修改后：

```js
async runBatchExport(payload) {
  return runBatchExport(payload);
},
async convertTimelineFrameRates(payload) {
  return convertTimelineFrameRates(payload);
}
```

### 转换核心

修改前：

```text
没有帧率转换运行时方法。
```

修改后：

```js
function convertOneTimelineFrameRate(args) {
  try {
    const sourceTimeline = resolveTimelineById(project, entry.id);
    const duplicateResult = tryDuplicateTimelineWithFrameRate(sourceTimeline, targetName, targetFrameRate);
    if (!createdTimeline) {
      const drtResult = tryImportTimelineFromDrt(app, project, mediaPool, sourceTimeline, targetFolder, targetName, targetFrameRate);
    }
    const moveResult = ensureTimelineInFolder(mediaPool, createdTimeline, targetFolder);
    return { status: "converted", success: true };
  } finally {
    restoreConversionState(project, mediaPool, originalTimeline, originalFolder, originalProjectFrameRate);
  }
}
```

### 状态恢复

修改前：

```text
没有转换前后状态保存与恢复。
```

修改后：

```js
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
```

## 待办清单

- 接入右侧 `导出设置` / `帧率转换` 标签页
- 在 UI 中展示转换状态、目标帧率、目标媒体夹名称和逐条结果
- 转换完成后刷新媒体池树与当前文件夹时间线列表
- 版本升级到 `0.1.13` 并构建安装包
- 补充最终备份 README 对比

## 下一步

实现右侧操作面板标签页和转换结果面板，并调用 `bridge.convertTimelineFrameRates`。

## 验收结果

- `node --check plugin-runtime/preload.js` 通过
- `npm run typecheck` 通过

