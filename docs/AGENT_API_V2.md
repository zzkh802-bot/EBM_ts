# DP循医 TypeScript Agent API v2

该服务是 `EBM_ts` 的本地/灰度 HTTP 适配层，运行 Pi Agent 并把长任务改为“创建任务 + 轮询 + 取消”。它不替代现有 Python 网关，适合先在独立端口联调。

启动：

```bash
npm install
npm run api
```

默认监听 `http://127.0.0.1:8787`。可用 `DP_XUNYI_TS_HOST`、`DP_XUNYI_TS_PORT` 和 `DP_XUNYI_TS_CORS_ORIGIN` 配置监听地址、端口和跨域来源。

Linux 部署可使用 `bash scripts/run-api.sh`。如果模型密钥由网关的环境文件管理，设置 `DP_XUNYI_TS_ENV_FILE=/path/to/.env.public`；如果 Node 安装在用户目录，设置 `DP_XUNYI_TS_NODE_BIN=/path/to/node`。

## 创建任务

`POST /api/v1/agent-runs`

```json
{
  "question": "类风湿关节炎患者甲氨蝶呤疗效不佳后如何升级治疗？",
  "session_id": "可选：上次返回的 Pi session_id",
  "research_mode": "instant",
  "audience_mode": "clinician",
  "deep_think": false,
  "search_enabled": true,
  "max_iterations": 5,
  "request_timeout_seconds": 300,
  "retrieval_policy": "all"
}
```

成功时返回 HTTP 202，包含 `run_id`、`poll_url` 和 `cancel_url`。`max_iterations` 目前是传给 Agent 的提示性预算，不是 Pi 运行时的强制截断；`request_timeout_seconds` 会强制中断子进程。

`retrieval_policy` 默认为 `all`。集成基准可设为 `mcp_only`，此时 Agent 子进程不会注册 PubMed、公共 Web 或本地来源库工具，只保留指南 MCP 与证据/报告工具。

首版不接收文件附件：提交非空 `attachments` 会返回 `422 attachments_not_supported`，避免把前端上传内容静默丢弃。

## 查询与取消

- `GET /api/v1/agent-runs/{run_id}`：返回 `queued`、`running`、`succeeded`、`failed` 或 `cancelled`。
- `POST /api/v1/agent-runs/{run_id}/cancel`：请求中断 Pi 子进程。
- `GET /health`：检查服务和接口版本。

完成响应中的 `message`、`agent_answer`、`patient_summary`、`agent_trace`、`tools` 和 `session_id` 可被当前 DP循医前端直接消费。
