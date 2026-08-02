# DP循医 Vue 前端

## 本地开发

先在项目根目录启动循医研究服务：

```bash
npm run api
```

再启动 Vite：

```bash
cd frontend
npm install
npm run dev
```

浏览器访问 `http://127.0.0.1:5173/evidence`。Vite 只代理 `/ts-api` 到本机服务（默认 `127.0.0.1:8787`）；研究任务、研究文件和运行配置都通过同一份 API 契约访问。

每个“临床问题”会话在浏览器本机单独保存，并持续复用后端返回的 `session_id`。同一问题的后续追问会沿用既有研究上下文；新建临床问题会创建独立会话。

## 验证与构建

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

构建产物位于 `frontend/dist/`。循医服务可以直接提供 Vue 构建及 SPA 回退。

## 生产部署

将 `dist/` 复制到循医服务的静态目录：

- `frontend/dist/`

循医服务会提供 `index.html` 和哈希静态资源；Nginx 可将应用请求代理到运行该服务的端口。

发布后检查：

```bash
curl http://127.0.0.1:8787/health
curl http://127.0.0.1:8787/evidence
```

旧单文件演示不属于当前 Vue 前端部署流程。
