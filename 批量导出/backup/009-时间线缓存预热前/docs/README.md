# 达芬奇批量导出插件

这是一个面向 `DaVinci Resolve Studio 19+` 的 Workflow Integration 插件项目，目标是在 Resolve 内按媒体池文件夹批量选择时间线，并用统一导出参数批量加入 Render Queue。

## 当前实现范围

- 仅支持 Windows 平台安装路径
- 仅支持当前打开工程
- 仅显示所选媒体池文件夹的直接时间线
- 批量导出时不清空现有渲染队列，只追加本次任务
- 导出设置首期覆盖核心字段：预设、格式、编码器、分辨率、帧率、输出目录、命名模板、音视频开关

## 目录

- `src/`: React + TypeScript 源码
- `plugin-runtime/`: Resolve Workflow Integration 外壳
- `scripts/`: 构建脚本
- `tests/`: 单测
- `docs/`: 说明文档
- `dist/`: 版本化构建产物
- `backup/`: 本地阶段备份
- `进度快照/`: 每个功能阶段的进度记录
