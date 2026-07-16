# 官网、下载、赞助与 Web 演示部署

## 运行模块

本项目包含三个互相隔离的运行模块：

- Resolve 插件：在 DaVinci Resolve Studio 的 Workflow Integration 容器中运行，通过原生 bridge 读取工程并执行真实操作。
- 官网与 Web Demo：静态网站和模拟演示，不访问访客本机文件，不连接真实 Resolve。
- 赞助后端：FastAPI + SQLite 服务，只保存用户自报的赞助记录和管理员确认状态。

## 当前正式环境

```text
官网域名：https://dv.ee2x.cn
静态目录：/opt/1panel/www/sites/dv.ee2x.cn
后端目录：/opt/ee2x/dv_export_support_site
systemd：dv-export-support-site.service
后端监听：127.0.0.1:3213
OpenResty：/opt/1panel/www/conf.d/dv.ee2x.cn.conf
SQLite：/opt/ee2x/dv_export_support_site/db/dv_export_support.sqlite3
```

该站点与 Pond5 官网平级部署。Pond5 使用 `3212`，DV EXPORT 使用 `3213`，两个服务、目录、数据库和 Nginx 配置互相独立。

正式访问入口：

- 官网：`https://dv.ee2x.cn/`
- Web Demo：`https://dv.ee2x.cn/demo/`
- 赞助榜：`https://dv.ee2x.cn/sponsors.html`
- 审核后台：`https://dv.ee2x.cn/sponsors-admin.html`
- 健康检查：`https://dv.ee2x.cn/api/dv-export-support/v1/health`

## Web Demo 范围

在线 Demo 支持媒体池浏览、全局搜索、时间线多选、导出参数、命名预览、模拟批量导出和模拟帧率转换。

在线 Demo 不支持读取真实 Resolve 工程、调用 `WorkflowIntegration.node`、写入文件、调用 FFmpeg / AutoHotkey 或创建真实 Render Job。

正常插件构建仍要求 `window.resolveBridge`。只有 Vite 的 `demo` 构建模式会创建模拟 bridge，生产插件不会在 bridge 缺失时自动降级为演示数据。

## 下载与赞助流程

- 官网所有下载按钮打开统一下载与赞助窗口。
- Windows EXE 安装包和 SHA256 校验文件由当前服务器直接托管。
- 微信与支付宝使用静态赞赏码，不接入支付回调。
- 用户完成赞助后，可自报称呼、金额和支付方式。
- 新记录默认是 `pending`，管理员核实到账后才公开显示。
- 公开赞助榜地址：`/sponsors.html`。
- 管理员确认页面：`/sponsors-admin.html`。
- 公开榜单只按支持时间排列，不按金额排名。

## 构建静态官网

常规检查和构建：

```powershell
cd G:\data\app\DV-EXPORT\批量导出
npm run typecheck
npm run typecheck:website
npm test
npm run test:website-backend
npm run build:website
```

如果刚修改了 `package.json` 版本号，使用以下命令同时生成当前版本安装包和官网：

```powershell
npm run build:website:release
```

`build:website` 会检查当前版本安装包是否存在；缺失时会提示先运行 `npm run build:installer`，避免官网继续提供旧版本。

最终静态产物：

```text
build/website/
├─ index.html
├─ sponsors.html
├─ sponsors-admin.html
├─ og.png
├─ assets/
├─ downloads/
│  ├─ DV-EXPORT-vX.Y.Z-setup.exe
│  └─ DV-EXPORT-vX.Y.Z-setup.sha256.txt
├─ support/
│  ├─ wechat-support.jpg
│  └─ alipay-support.jpg
└─ demo/
   ├─ index.html
   └─ assets/
```

必须上传 `build/website` 中的全部内容并保持目录结构。

## 当前服务器一键部署

正式部署脚本会复用 Pond5 的 SSH 密钥连接方式，自动完成部署包上传、路径校验、旧版本备份、空闲端口选择、systemd 配置、HTTPS 证书签发、OpenResty 检查与证书续期任务配置。

```powershell
cd G:\data\app\DV-EXPORT\批量导出
npm run build:website:release
npm run deploy:website:server
```

部署脚本：

```text
deploy/deploy-dv-export-server.ps1
deploy/deploy-dv-export-server-remote.sh
deploy/dv.ee2x.cn.conf
```

审核令牌从被 Git 忽略的 `website-backend/.env` 读取，上传后写入服务器 `.env`，不会写进官网静态文件或 Nginx 配置。

## 推荐服务器目录

```text
/opt/1panel/www/sites/dv.ee2x.cn  官网静态文件
/opt/ee2x/dv_export_support_site  FastAPI 后端和 SQLite 数据库
```

将 `build/website` 内的内容同步到站点目录，将 `website-backend` 同步到后端目录。正式环境优先使用上面的一键脚本，避免手工覆盖数据库和证书。

## 部署赞助后端

安装运行环境：

```bash
cd /opt/ee2x/dv_export_support_site
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env
```

生成管理员令牌：

```bash
openssl rand -base64 36
```

编辑 `.env`：

```text
DV_EXPORT_SUPPORT_HOST=127.0.0.1
DV_EXPORT_SUPPORT_PORT=3213
DV_EXPORT_SUPPORT_DB_PATH=/opt/ee2x/dv_export_support_site/db/dv_export_support.sqlite3
DV_EXPORT_SPONSOR_ADMIN_TOKEN=生成的私密随机令牌
DV_EXPORT_SUPPORT_ALLOWED_ORIGINS=https://dv.ee2x.cn
```

管理员令牌只保存在服务器和管理员当前浏览器标签页，禁止写入前端源码、公开文档或聊天记录。

将 `website-backend/systemd/dv-export-support.service` 中的 `__WORKDIR__` 和端口替换为正式环境值，复制到：

```text
/etc/systemd/system/dv-export-support-site.service
```

启动并检查：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now dv-export-support-site.service
curl http://127.0.0.1:3213/api/dv-export-support/v1/health
```

## Nginx

完整模板：

```text
deploy/dv.ee2x.cn.conf
```

一键脚本会自动替换域名和探测到的后端端口。模板已包含：

- HTTP 到 HTTPS 跳转。
- `/api/dv-export-support/` 到 `127.0.0.1:3213` 的同域反向代理。
- `/downloads/` 附件下载响应。
- `/support/` 赞赏码静态资源。
- `/demo/` 演示资源缓存。
- `/sponsors-admin.html` 禁止搜索引擎索引。
- HSTS、CSP、Referrer Policy 等基础安全响应头。

后端只监听 `127.0.0.1`，不要直接向公网开放 3213 端口。

证书由 Let's Encrypt 签发。服务器每天 05:29 执行：

```text
/opt/1panel/www/sites/dv.ee2x.cn/renew-cert.sh
```

## 数据备份

赞助记录默认保存在：

```text
/opt/ee2x/dv_export_support_site/db/dv_export_support.sqlite3
```

部署新版本时不得删除该数据库。建议每天备份，至少保留最近 7 天。可以短暂停止服务后复制数据库，或使用 SQLite 在线备份命令。

## 上线验收

- 官网首页和 `/demo/` 正常打开。
- Demo 显示“在线模拟演示”和“安全演示模式”。
- 下载弹窗能下载当前版本 EXE 和 SHA256 文件。
- 两张赞赏码可点击全屏查看，Esc 先关闭二维码预览，再关闭下载弹窗。
- `/api/dv-export-support/v1/health` 经域名访问返回 `ok: true`。
- `/sponsors.html` 能读取公开赞助榜。
- 提交一条测试赞助后，管理员页面能看到待确认记录。
- 管理员确认后，测试记录出现在公开赞助榜。
- 验证结束后按实际需要保留或拒绝测试记录。

## 部署到子目录

官网资源、下载、赞助榜和 Demo 使用相对路径，静态资源可部署到类似 `https://example.com/dv-export/` 的子目录；但赞助 API 默认使用域名根路径 `/api/dv-export-support/`。子目录部署时需要在构建环境设置 `VITE_SPONSOR_API_BASE`，或在 Nginx 继续保留根路径 API 代理。

社交平台通常要求 `og:image` 使用绝对地址。部署前请将 `website/index.html` 中的 `/og.png` 改为最终完整 HTTPS 地址，然后重新构建。

## 是否可以从网页控制真实 Resolve

纯网页不能直接访问用户电脑上的 Resolve 原生 bridge。若未来需要远程控制真实 Resolve，必须额外开发和安装本机服务，并处理身份认证、请求签名、跨域、版本兼容和恶意网页调用风险，不建议与公开官网赞助后端混用。
