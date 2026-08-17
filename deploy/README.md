# 循医研究服务部署文档（真实拓扑）

## 网络拓扑（2026-08 确认）

```
互联网用户
   ↓ HTTPS（TLS 由 SIAT 网关终止，证书 *.siat.ac.cn）
210.75.252.109  ← SIAT 网关 Nginx（网管管理：DNS、TLS、反向代理）
   ↓ 内网转发
172.20.252.15:8787  ← 本机 Node 服务（0.0.0.0 监听，静态页 + API 一体）
```

关键结论（来自 2026-08-17 现场排查，见 `docs/` 记录）：

1. **本机不需要安装 Nginx**。TLS 终止和公网入口由 SIAT 网关完成，Node 服务同时承担静态资源与 API。
2. 服务以 `DP_XUNYI_TS_HOST=0.0.0.0` 绑定所有网卡，使网关反代可达。
3. 旧 natapp 隧道（`siat-law-rag.natapp1.cc`）已于 2026-08-17 下线（进程已终止）。如需恢复公网测试入口，请勿再依赖 natapp，直接要求网管更新网关配置即可。

## 服务启动

```bash
cd /home/xiemingjie/workspace/EBM_ts
DP_XUNYI_TS_HOST=0.0.0.0 DP_XUNYI_TS_PORT=8787 \
  nohup bash scripts/run-api.sh > data/api-server.log 2>&1 &
```

或使用 systemd 模板（见 `systemd/ebm-api.service`，需按实际路径调整）。

## 停止

```bash
kill <api-server PID>   # 进程本身处理 SIGTERM 优雅退出
```

## 发布前端

```bash
npm run frontend:build
# 前端由 Node 服务直接服务 frontend/dist/，无需拷贝到 /var/www
```

改完前端只需重启进程。

## 健康检查

```bash
bash deploy/scripts/health-check.sh
curl -i https://xunyi.siat.ac.cn/ts-api/api/v1/runtime-config
```

## 环境变量

见 `.env.example` 与 `.env`。生产必需项：

| 变量 | 说明 |
| --- | --- |
| `EBM_INTERNAL_ACCESS_KEY` | 内测注册邀请密钥，非空才启用认证 |
| `DP_XUNYI_TS_HOST` | 生产必须为 `0.0.0.0`（否则网关无法回调） |
| `DP_XUNYI_TS_PORT` | 默认 8787 |
| `EBM_MAX_CONCURRENT_SESSIONS` | Pi 会话并发上限；测试阶段 32，按内存调整 |

## 网关侧变更流程（需要时联系网管）

- 新增/变更公网域名：请网管在网关 Nginx 配置 `server_name` 和 `proxy_pass http://172.20.252.15:8787`。
- 本机 IP 变化（DHCP）：网关转发目标同步更新。