# 达芬奇批量导出插件

这是一个面向 `DaVinci Resolve Studio 19+` 的 Workflow Integration 插件项目，目标是在 Resolve 内按媒体池文件夹批量选择时间线，并用统一导出参数批量加入 Render Queue。

## 推荐阅读顺序

1. [项目说明](./项目说明.md)：项目定位、功能、技术栈、目录结构和核心流程
2. [部署文档](./部署文档.md)：本地构建、安装、发布、验收和回滚
3. [安装说明](./安装说明.md)：简版安装路径和 `WorkflowIntegration.node` 说明
4. [测试清单](./测试清单.md)：自动测试和 Resolve 实机验证项目
5. [版本说明](./版本说明.md)：各版本变更记录
6. [已知限制](./已知限制.md)：当前限制和注意事项
7. [官网与 Web 演示部署](./官网与Web演示部署.md)：在线 Demo 边界、统一构建和服务器部署
8. [自动更新说明](./自动更新说明.md)：更新三态、代理模式、安装事务和 GitHub Release 契约

## 当前实现范围

- 仅支持 Windows 平台安装路径
- 仅支持当前打开工程
- 仅显示所选媒体池文件夹的直接时间线
- 批量导出时不清空现有渲染队列，只追加本次任务
- 导出设置首期覆盖核心字段：预设、格式、编码器、分辨率、帧率、输出目录、命名模板、音视频开关
- 右侧操作面板支持按目标帧率新建可编辑时间线，并可指定新媒体夹名称
- 启动时预读取并缓存时间线信息，降低首次点击文件夹时的等待感
- 设置页支持自动更新、手动更新、禁止更新，以及自动代理、手动代理、直连
- 更新包下载后可立即安装或延期到下次启动，并执行大小与 SHA-256 校验

## 项目目录

- `src/`: React + TypeScript 源码
- `plugin-runtime/`: Resolve Workflow Integration 外壳
- `scripts/`: 构建脚本
- `tests/`: 单测
- `docs/`: 说明文档
- `dist/`: 版本化构建产物
- `backup/`: 本地阶段备份
- `进度快照/`: 每个功能阶段的进度记录

## 常用命令

```powershell
cd G:\data\app\DV-EXPORT\批量导出
npm run typecheck
npm test
npm run test:release
npm run build
npm run build:website
```
