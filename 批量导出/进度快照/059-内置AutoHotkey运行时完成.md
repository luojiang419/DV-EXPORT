# 059 内置 AutoHotkey 运行时完成

## 已完成内容

- 已按用户要求自动补齐 `模拟手动复制粘贴（实验）` 所需的 AutoHotkey v2 环境
- 已读取官方 AutoHotkey GitHub Release，当前最新为：
  - `v2.0.26`
- 已下载官方 zip：
  - `AutoHotkey_2.0.26.zip`
- 已提取并打包便携运行时：
  - `plugin-runtime/bin/AutoHotkey64.exe`
- 已创建源码阶段备份：
  - `backup/045-AutoHotkey便携运行时打包前`
- 已创建安装阶段备份：
  - `backup/046-安装v0.1.22前已安装插件`
- 已将版本升至：
  - `v0.1.22`
- 已更新文档说明：实验路线优先使用插件内置 AutoHotkey v2，不再要求用户手动安装系统版 AHK
- 已构建插件产物：
  - `dist/v0.1.22/com.dvexport.batch-export`
- 已安装到 Resolve Workflow Integration 插件目录：
  - `C:\ProgramData\Blackmagic Design\DaVinci Resolve\Support\Workflow Integration Plugins\com.dvexport.batch-export`
- 已清理构建与下载临时缓存：
  - `build`
  - `tmp/autohotkey-v2`

## 当前修改模块

- `plugin-runtime/bin/AutoHotkey64.exe`
- `package.json`
- `package-lock.json`
- `docs/版本说明.md`
- `docs/测试清单.md`
- `docs/已知限制.md`
- `docs/项目说明.md`
- `dist/v0.1.22/com.dvexport.batch-export`
- Resolve 已安装插件目录
- `backup/045-AutoHotkey便携运行时打包前`
- `backup/046-安装v0.1.22前已安装插件`

## 具体修改的代码前后对比

### 1. 版本升级

修改前：

```json
"version": "0.1.21"
```

修改后：

```json
"version": "0.1.22"
```

### 2. 内置 AHK 运行时

新增：

```text
plugin-runtime/bin/AutoHotkey64.exe
```

主进程已有检测逻辑会优先检查：

```js
path.join(pluginRoot, "bin", "AutoHotkey64.exe")
```

### 3. 文档说明更新

修改前：

```text
未安装时应显示明确安装或路径配置提示
```

修改后：

```text
应优先使用插件内置 AutoHotkey v2 便携运行时通过 Resolve 主窗口完成复制粘贴
```

## 验证结果

- 内置 `AutoHotkey64.exe` 可运行 AHK v2 脚本；未打开 Resolve 时按预期提示：
  - `未找到 DaVinci Resolve 主窗口`
- `node --check plugin-runtime/main.js` 通过
- `node --check plugin-runtime/preload.js` 通过
- `npm run typecheck` 通过
- `npm test` 通过：
  - 6 个测试文件
  - 20 条用例
- `npm run build` 通过
- `node --check dist/v0.1.22/com.dvexport.batch-export/main.js` 通过
- `node --check dist/v0.1.22/com.dvexport.batch-export/preload.js` 通过
- Resolve 安装目录 `main.js`、`preload.js` 语法检查通过
- `dist/v0.1.22/com.dvexport.batch-export` 包含：
  - `bin/AutoHotkey64.exe`
  - `automation/resolve-timeline-copy-paste.ahk`
- Resolve 安装目录包含：
  - `bin/AutoHotkey64.exe`
  - `automation/resolve-timeline-copy-paste.ahk`
- Resolve 安装目录 `package.json` 版本为 `0.1.22`
- Resolve 安装目录 `manifest.xml` 包含 `0.1.22`
- `build` 与 `tmp/autohotkey-v2` 已清理

## 待办清单

- 重新打开 DaVinci Resolve Studio，确保 Workflow Integration 重新加载 `v0.1.22`
- 选择 `模拟手动复制粘贴（实验）` 复测：
  - `单模特` 场景目标应达到 `12/12`
  - linked audio `32/33` 场景应完整
- 执行实验路线时不要操作键盘鼠标，确保 Resolve 主窗口可被激活

## 下一步

请重启 DaVinci Resolve Studio 并加载插件 v0.1.22。现在无需单独安装 AutoHotkey，插件会优先使用内置 `bin/AutoHotkey64.exe`。
