# 073 - DV 官网正式部署到 dv.ee2x.cn

时间：2026-07-14

## 任务目标

参考 `G:\data\app\pond5_clip_manager\tools-web` 的正式部署方式，将 DV EXPORT 官网、Web Demo、安装包和赞助后端部署到同一台 1Panel/OpenResty 服务器；使用同级独立目录和不冲突的后端端口，正式域名为 `dv.ee2x.cn`。

## 已完成内容

1. 已读取 Pond5 的本地/远程部署脚本、Nginx 配置和最新部署快照。
2. 已通过 SSH 只读审计服务器目录、监听端口、OpenResty、Certbot、磁盘和 Pond5 服务状态。
3. 已确认 `dv.ee2x.cn` 的真实 A 记录指向 `64.90.17.178`。
4. 已创建本地部署前备份：`backup/066-DV官网服务器部署前`。
5. 已新增 DV EXPORT 专用本地部署脚本、远端部署脚本和 Nginx 模板。
6. 已重新执行完整 release 构建，生成当前 v0.1.26 安装包和官网产物。
7. 已把官网、Web Demo、二维码、安装包和赞助后端上传到服务器。
8. 已自动选择 `3213`，与 Pond5 的 `3212` 并行且互不占用。
9. 已创建并启用 `dv-export-support-site.service`。
10. 已为 `dv.ee2x.cn` 签发独立 Let's Encrypt 证书并加载 HTTPS 配置。
11. 已创建每日证书续期任务。
12. 已完成公网下载、赞助提交、管理员鉴权、记录拒绝和公开榜隔离验收。
13. 已回归验证 Pond5 首页、Demo 和赞助 API，均保持正常。

## 正式环境

```text
正式官网：https://dv.ee2x.cn/
Web Demo：https://dv.ee2x.cn/demo/
赞助榜：https://dv.ee2x.cn/sponsors.html
审核后台：https://dv.ee2x.cn/sponsors-admin.html
健康检查：https://dv.ee2x.cn/api/dv-export-support/v1/health

服务器：64.90.17.178:419
SSH 用户：root
登录方式：密钥
本地密钥：G:\data\app\pond5_clip_manager\公钥\id_ed25519_1panel

静态目录：/opt/1panel/www/sites/dv.ee2x.cn
后端目录：/opt/ee2x/dv_export_support_site
数据库：/opt/ee2x/dv_export_support_site/db/dv_export_support.sqlite3
服务：dv-export-support-site.service
监听：127.0.0.1:3213
Nginx：/opt/1panel/www/conf.d/dv.ee2x.cn.conf
```

审核令牌已按用户要求写入本地和服务器受保护的 `.env`，没有写入静态官网、Nginx 配置或公开部署文档。

## 部署目录并行关系

```text
/opt/1panel/www/sites/
├─ pd.ee2x.cn        Pond5 官网
└─ dv.ee2x.cn        DV EXPORT 官网

/opt/ee2x/
├─ pond5_support_site          Pond5 后端，127.0.0.1:3212
└─ dv_export_support_site      DV EXPORT 后端，127.0.0.1:3213
```

## 新增/修改模块

```text
deploy/dv.ee2x.cn.conf
deploy/deploy-dv-export-server.ps1
deploy/deploy-dv-export-server-remote.sh
docs/官网与Web演示部署.md
package.json
backup/066-DV官网服务器部署前/修改对比.md
```

## 代码前后对比

修改前：

```text
通用目录：/opt/dv-export/site、/opt/dv-export/support
固定示例端口：3013
手工上传、手工替换 Nginx 和 systemd
没有自动证书签发、回滚和远端临时文件清理
```

修改后：

```text
1Panel 同级目录：/opt/1panel/www/sites/dv.ee2x.cn
独立后端目录：/opt/ee2x/dv_export_support_site
自动扫描端口：3213-3299，当前选择 3213
部署前验证路径、文件、磁盘和端口
已有版本自动备份
OpenResty 配置失败自动恢复
自动签发证书、安装续期脚本和 cron
本地/远端临时包和临时密钥自动清理
```

一键更新命令：

```powershell
cd G:\data\app\DV-EXPORT\批量导出
npm run build:website:release
npm run deploy:website:server
```

## 部署过程修复

第一次调用尚未上传文件时，Windows PowerShell 5 因无 BOM 中文脚本编码发生解析错误。部署脚本随后改为纯 ASCII，并用 Unicode 码点构造中文密钥目录名；Windows PowerShell 和 Bash 语法检查通过后重新执行，服务器未留下第一次失败产生的文件。

## 验证结果

### 本地构建

- `npm run typecheck`：通过。
- `npm run typecheck:website`：通过。
- `npm test`：8 个测试文件、24 项测试全部通过。
- `npm run test:website-backend`：4 项测试全部通过。
- `npm run build:website:release`：通过。

### 公网网站

```text
HTTP -> HTTPS：301
首页：200
赞助榜：200
审核后台：200
Web Demo：200
健康检查：200
HSTS：存在
CSP：存在
```

### 安装包

```text
文件：DV-EXPORT-v0.1.26-setup.exe
大小：1,036,288 字节
公网 SHA256：77A2F293BC27A871434BA7B7CC16572C8E365331C9A5B0E9940D9E97C5473031
公网与本地哈希：一致
```

### 赞助流程

```text
提交测试记录：201
初始状态：pending
当前审核令牌：200
无令牌：401
旧本地令牌：401
拒绝测试记录：200 / rejected
拒绝记录未出现在公开榜：通过
```

### 服务器

```text
dv-export-support-site.service：active
127.0.0.1:3213：独立监听
OpenResty 配置检查：通过
证书 SAN：dv.ee2x.cn
证书有效期：2026-07-14 至 2026-10-12
续期任务：每天 05:29
SQLite 数据库：存在
远端部署临时文件：0
```

### 既有 Pond5 回归

```text
pond5-support-site.service：active
127.0.0.1:3212：保持监听
https://pd.ee2x.cn/：200
https://pd.ee2x.cn/demo/：200
Pond5 赞助 API：200
```

## 备份与回滚

- 本地部署前备份：`backup/066-DV官网服务器部署前`。
- 本次是首次正式部署，远端此前没有 DV EXPORT 站点，因此没有旧线上版本可备份。
- 后续再次运行部署脚本时，会先创建带时间戳的站点和后端完整备份；Nginx 检查失败会恢复旧配置。

## 待办清单

- [ ] 建议后续把当前短审核令牌换成长随机令牌。
- [ ] 建议配置 SQLite 每日备份并至少保留 7 天。
- [ ] 可在真实赞助发生时完成一次小额到账、人工确认和公开展示验收。

## 下一步

当前部署任务已完成。后续更新官网或插件版本时，先执行完整 release 构建，再运行 `npm run deploy:website:server`；脚本会复用当前端口和数据库，并自动创建回滚备份。
