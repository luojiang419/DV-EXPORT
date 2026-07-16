# DV EXPORT 官网赞助后端

该服务为官网提供赞助记录提交、公开赞助榜和管理员人工确认，使用 FastAPI + SQLite。

## 接口

- `GET /api/dv-export-support/v1/health`
- `GET /api/dv-export-support/v1/sponsors`
- `POST /api/dv-export-support/v1/claims`
- `GET /api/dv-export-support/v1/claims/{public_id}`
- `GET /api/dv-export-support/v1/admin/claims`
- `POST /api/dv-export-support/v1/admin/claims/{public_id}`

用户提交记录后状态为 `pending`。管理员在 `/sponsors-admin.html` 输入服务器令牌，核实到账后确认，记录才会进入公开赞助榜。

## 本地运行

```powershell
cd G:\data\app\DV-EXPORT\批量导出\website-backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item .env.example .env
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 3013
```

本地测试时，把 `.env` 中 `DV_EXPORT_SPONSOR_ADMIN_TOKEN` 改为私密随机值。

## 安全要求

- 后端只监听 `127.0.0.1:3013`，公网请求必须通过 Nginx 同域代理。
- 管理员令牌只保存在服务器 `.env`，不得写入前端或公开仓库。
- 正式环境把 `DV_EXPORT_SUPPORT_ALLOWED_ORIGINS` 设置为最终 HTTPS 域名。
- SQLite 数据库目录需要持久化备份，部署更新时不得删除。
- 二维码支付没有自动回调，必须在微信或支付宝确认到账后再公开记录。
