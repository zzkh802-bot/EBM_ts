# 内部标注测试部署

这套配置用于内部标注人员通过公网域名访问内网服务，不是公开产品认证方案。

## 服务端配置

在服务器 `.env` 中设置一个随机的共享访问密钥，不要提交到仓库：

```env
EBM_INTERNAL_ACCESS_KEY=替换为足够长的随机字符串
EBM_ENABLE_ACCOUNT_CONNECTIONS=0
# 关闭后不展示问卷，也不接受反馈写入；默认开启
EBM_FEEDBACK_ENABLED=1
# Pi session 并发上限，默认 8；可按服务器资源逐步提高
# EBM_MAX_CONCURRENT_SESSIONS=8
```

如果前端由不同域名提供，再设置反向代理的精确来源；不要使用 `*`：

```env
DP_XUNYI_TS_CORS_ORIGIN=https://internal.example.com
```

前端和 API 最好由同一个 HTTPS 域名提供。登录后服务端发放 HttpOnly、SameSite Cookie；共享密钥不会进入 URL、前端构建产物或日志。

## 反向代理

公网只暴露 HTTPS 反向代理，Node 服务只监听内网地址，例如 `127.0.0.1:8787`。代理应负责 TLS 和基础请求体/连接超时限制；应用自身仍负责登录、会话归属和任务限流。

## 当前边界

- 注册后生成的 `u-...` 用户 ID 是身份标识，登录使用用户 ID + 密码；显示名称可重复，也不参与隔离。
- 研究 session、任务、报告、证据和 citation 按用户 ID 归属；跨用户访问返回 404。
- 共享来源库仍是全局知识缓存，不应放入用户私密笔记。
- Pi 只接收当前 provider 所需的密钥；不会把整个 `.env` 传给子进程。
- Bash 保留用于内部测试，但安全扩展会拦截常见凭据路径、外部网络命令和高风险破坏命令。它是防误用层，不替代操作系统隔离。
- 用户附件通过独立上传接口保存到用户隔离目录，并在上传时绑定当前前端 session；PDF、DOC/DOCX 和图片会尽量交给 MinerU 解析，原始文件和解析结果归档到对应报告会话。单文件上限 25 MB，单用户原件配额 512 MB；未完成解析的孤儿上传保留 24 小时后在下一次上传时清理。
- 医学图像理解使用独立的 `medical_image_read` 工具调用视觉服务，结果仅作为报告输入的辅助描述，不作为诊断结论。
- 反馈问卷由 `EBM_FEEDBACK_ENABLED` 控制；关闭后前端不展示问卷，已有反馈文件仍保留供分析。

## 会话与轨迹归档

- 新的已登录研究会话目录使用 `data/sessions/<user_id>__<session_id前8位>_<临床问题语义名>/`，例如 `u-7k3m9p2c__019fc823_卒中循证问题/`。
- Pi 原始完整会话仍由 Pi 保存在 `data/pi-sessions/`，文件名保留 Pi 的时间戳和完整 session ID；`data/sessions/.metadata/workspaces/` 与会话 `.metadata/session.json` 保存二者映射及 `user_id`。
- `trace/trajectory.jsonl`、`trace/queries/` 和反馈文件都写入同一用户会话目录。`npm run trace:analyze -- --all --by-user` 可按用户汇总；没有归属字段的历史轨迹显示为 `unknown/pre-auth`，不会猜测用户。
- 问卷字段和轨迹关联方法见 [`docs/internal-beta-feedback.md`](internal-beta-feedback.md)。

## 测试前检查

1. 确认 `.env` 权限为 `600`，并且不在镜像或日志中。
2. 确认 `DP_XUNYI_TS_CORS_ORIGIN` 是测试域名，而不是 `*`。
3. 确认患者端和账户连接保持关闭。
4. 用两个用户名分别登录，验证不能读取对方的研究 session、run 或 citation。
5. 验证 Bash 不能读取 `.env`、`auth.json`、`/proc` 或其他 session 目录。
