# 内部标注测试部署

这套配置用于内部标注人员通过公网域名访问内网服务，不是公开产品认证方案。

## 服务端配置

在服务器 `.env` 中设置一个随机的共享访问密钥，不要提交到仓库：

```env
EBM_INTERNAL_ACCESS_KEY=替换为足够长的随机字符串
EBM_ENABLE_PATIENT_INTAKE=0
EBM_ENABLE_ACCOUNT_CONNECTIONS=0
```

如果前端由不同域名提供，再设置反向代理的精确来源；不要使用 `*`：

```env
DP_XUNYI_TS_CORS_ORIGIN=https://internal.example.com
```

前端和 API 最好由同一个 HTTPS 域名提供。登录后服务端发放 HttpOnly、SameSite Cookie；共享密钥不会进入 URL、前端构建产物或日志。

## 反向代理

公网只暴露 HTTPS 反向代理，Node 服务只监听内网地址，例如 `127.0.0.1:8787`。代理应负责 TLS 和基础请求体/连接超时限制；应用自身仍负责登录、会话归属和任务限流。

## 当前边界

- 用户名用于区分标注人员，但共享密钥意味着用户名本身不是强身份认证。
- 研究 session、任务、报告、证据和 citation 按用户名归属；跨用户访问返回 404。
- 共享来源库仍是全局知识缓存，不应放入用户私密笔记。
- Pi 只接收当前 provider 所需的密钥；不会把整个 `.env` 传给子进程。
- Bash 保留用于内部测试，但安全扩展会拦截常见凭据路径、外部网络命令和高风险破坏命令。它是防误用层，不替代操作系统隔离。

## 测试前检查

1. 确认 `.env` 权限为 `600`，并且不在镜像或日志中。
2. 确认 `DP_XUNYI_TS_CORS_ORIGIN` 是测试域名，而不是 `*`。
3. 确认患者端和账户连接保持关闭。
4. 用两个用户名分别登录，验证不能读取对方的研究 session、run 或 citation。
5. 验证 Bash 不能读取 `.env`、`auth.json`、`/proc` 或其他 session 目录。
