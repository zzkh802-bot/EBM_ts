# DP循医 Vue 前端

## 本地开发

先在项目根目录启动带线上鉴权注入的 API 代理：

```bash
DP_PUBLIC_PASSWORD='服务密码' python3 dev_proxy.py
```

再启动 Vite：

```bash
cd frontend
npm install
npm run dev
```

浏览器访问 `http://127.0.0.1:5173/evidence`。Vite 会把 `/health`、`/ebm`、`/archive`、`/literature`、`/evidence`、`/grade` 和 `/qa` 代理到 `127.0.0.1:8000`，Basic Auth 密码不会进入浏览器构建产物。

## 验证与构建

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

构建产物位于 `frontend/dist/`。`dev_proxy.py` 检测到该目录后，会直接提供 Vue 构建及 `/evidence`、`/knowledge`、`/literature` 的 SPA 回退。

## 生产部署

将 `dist/` 复制到 Python 网关运行目录下的以下任一位置：

- `frontend/dist/`
- `dist/`
- 环境变量 `DP_FRONTEND_DIST` 指定的绝对目录

新版 `feishu_bot_server.py` 会在现有 Basic Auth 之后提供 `index.html` 和哈希静态资源，因此 Nginx 仍可将全部请求代理到 `127.0.0.1:8765`，无需把认证凭据写入前端。

发布前保留当前 `web_demo.html` 和服务目录备份；发布后检查：

```bash
curl -u "$DP_PUBLIC_USER:$DP_PUBLIC_PASSWORD" http://127.0.0.1/health
curl -u "$DP_PUBLIC_USER:$DP_PUBLIC_PASSWORD" http://127.0.0.1/evidence
curl -u "$DP_PUBLIC_USER:$DP_PUBLIC_PASSWORD" http://127.0.0.1/assets/<构建后的资源文件>
```

旧单文件版本保留在 `web_demo.legacy.html`，仅用于紧急回退。
