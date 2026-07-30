# 循医研究服务 API

该服务是循医的长任务 HTTP 接口，采用“创建任务 + 轮询 + 取消”模式，适合本地与灰度部署。

启动：

```bash
npm install
npm run api
```

默认监听 `http://127.0.0.1:8787`。可用 `DP_XUNYI_TS_HOST`、`DP_XUNYI_TS_PORT` 和 `DP_XUNYI_TS_CORS_ORIGIN` 配置监听地址、端口和跨域来源。

## 运行配置

`GET /api/v1/runtime-config` 返回前端可选择的服务和模型、默认选项及是否已在服务器配置。响应绝不包含密钥。

- 芯穹：`XINQIONG_API_KEY`；为兼容现有部署，`EBM_PROVIDER=xinqiong` 时也可继续使用 `OPENAI_API_KEY`。
- DeepSeek：`DEEPSEEK_API_KEY`。
- OpenAI：`OPENAI_API_KEY` 与 `EBM_ENABLE_OPENAI=1`。
- Anthropic：`ANTHROPIC_API_KEY` 或 `ANTHROPIC_OAUTH_TOKEN`。

前端只显示已配置的选项。可在创建任务时传入 `provider` 和 `model`；服务器会拒绝未注册或未配置的组合，而不是在执行中才返回不明错误。

Linux 部署可使用 `bash scripts/run-api.sh`。如果模型密钥由网关的环境文件管理，设置 `DP_XUNYI_TS_ENV_FILE=/path/to/.env.public`；如果 Node 安装在用户目录，设置 `DP_XUNYI_TS_NODE_BIN=/path/to/node`。

## 创建任务

`POST /api/v1/agent-runs`

```json
{
  "question": "类风湿关节炎患者甲氨蝶呤疗效不佳后如何升级治疗？",
  "session_id": "可选：上次返回的会话 ID",
  "research_mode": "instant",
  "audience_mode": "clinician",
  "deep_think": false,
  "search_enabled": true,
  "max_iterations": 5,
  "request_timeout_seconds": 300,
  "retrieval_policy": "all",
  "provider": "deepseek",
  "model": "deepseek-v4-flash"
}
```

成功时返回 HTTP 202，包含 `run_id`、`poll_url` 和 `cancel_url`。`max_iterations` 是研究步骤的提示性预算；`request_timeout_seconds` 会中断超时任务。

`retrieval_policy` 默认为 `all`。集成基准可设为 `mcp_only`，此时 Agent 子进程不会注册 PubMed、公共 Web 或本地来源库工具，只保留指南 MCP 与证据/报告工具。

首版不接收文件附件：提交非空 `attachments` 会返回 `422 attachments_not_supported`，避免把前端上传内容静默丢弃。

## 查询与取消

- `GET /api/v1/agent-runs/{run_id}`：返回 `queued`、`running`、`succeeded`、`failed` 或 `cancelled`。
- `POST /api/v1/agent-runs/{run_id}/cancel`：请求中断当前研究任务。
- `GET /health`：检查服务和接口版本。

完成响应中的 `message`、`agent_answer`、`patient_summary`、`agent_trace`、`tools` 和 `session_id` 可被循医前端直接消费。`tools` 按一次调用聚合：运行中、完成或失败会更新同一记录，供界面以一行摘要和可展开详情呈现。
