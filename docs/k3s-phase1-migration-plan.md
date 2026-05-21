# 海外 4 节点 K3s 阶段一：迁移流程

## 前置确认

| 服务 | 环境 | 当前 | 阶段一处理 |
|---|---|---|---|
| hsk-nuxt-global | **测试** | S1 Docker, 1 实例 | → K3s 1 副本，最先迁移 |
| HSK-3.0-explorer | **测试** | S1 docker-compose（6 容器） | → K3s StatefulSet + Deployment，紧接着迁移 |
| hsk-news-global-server | **生产** | S4 Docker, 1 实例 | → K3s 2 副本，测试服务稳定后迁移 |
| hsk-global-server | **生产** | S2/S3/S4 Docker, 蓝绿 3 实例 | → **阶段一不动，阶段二再迁** |

**原则：测试先行验证 K3s → 确认稳定 → 再迁生产。**

---

## Day 1：环境准备 + K3s 集群搭建

### 1.1 清理（全程不停机）

- 清理所有节点 `hsk-server-green`（已 Exited 137）
- 所有节点 `docker system prune -a -f`
- 所有节点 `journalctl --vacuum-size=300M`

### 1.2 Server-4 Docker 升级

```
19.03.9 → 26.1.3
升级前从 Nginx upstream 暂时摘除 S4 流量，升级完加回
确认 hsk-news-global-server 和 hsk-global-server-blue 正常
```

### 1.3 K3s 集群安装

| 节点 | 角色 |
|---|---|
| Server-2 | K3s Server #1（init 集群） |
| Server-3 | K3s Server #2（HA） |
| Server-1 | Agent |
| Server-4 | Agent |

### 1.4 集群组件

- Nginx Ingress Controller（DaemonSet，hostPort 30080/30443）
- cert-manager
- ACR 镜像拉取 Secret

### 1.5 验证

- `kubectl get nodes` → 4 节点 Ready
- 部署 nginx 测试 Pod + Service + Ingress → 链路通

---

## Day 2 上午：hsk-nuxt-global（测试，1 副本）

**目的：用最简单的服务验证 K3s 部署→验证→切流→回滚 全流程。**

### 2.1 部署

- ConfigMap + Secret → apply
- Deployment 1 副本 + Service → apply
- Ingress → apply

### 2.2 验证

- `kubectl port-forward svc/hsk-nuxt-global 5010:5010` → 本地 curl 验证
- Ingress 路径验证

### 2.3 切流量

- 改 Server-1 Nginx upstream：`127.0.0.1:5010` → `127.0.0.1:30080`
- `nginx -t && nginx -s reload`

### 2.4 清理旧容器

- 观察 10 分钟无异常 → `docker stop/rm hsk-nuxt-global-test-container`

### 2.5 回滚

- 改回 Nginx upstream 即可，1 分钟内恢复

---

## Day 2 下午：HSK-3.0-explorer（测试，每组件 1 副本）

**目的：验证 K3s 对有状态服务（PostgreSQL）的处理能力。**

### 3.1 迁移前

- 备份：`docker exec hsk-30-explorer-db-1 pg_dump ... > backup.sql`
- 导出 Kong 配置到 ConfigMap

### 3.2 部署

- ConfigMap + Secret → apply
- StatefulSet（PostgreSQL，nodeSelector: server-1，PVC 10Gi）→ apply
- 等 Pod Ready → `kubectl exec` 恢复数据
- rest / auth / kong / frontend 各 1 副本 Deployment → apply
- 各 Service → apply

### 3.3 验证

- `kubectl port-forward` 逐个验证 5 个组件
- 前端能访问 Supabase API

### 3.4 切流量

- 改 Server-1 Nginx `hsk-explorer.conf`：3 个 upstream 指向 K3s Service
- `nginx -t && nginx -s reload`

### 3.5 清理

- `docker compose down` 释放 Server-1 资源

### 3.6 回滚

- 改回 Nginx upstream 或 `docker compose up` 恢复旧栈

---

## Day 2 结束：决策点

> `✅` 两个测试服务在 K3s 上稳定运行，验证结论成立 → **继续 Day 3 迁生产**

> `❌` 出现问题 → 暂停，排查后再决定

---

## Day 3：hsk-news-global-server（生产，2 副本）

### 4.1 迁移前

- 确认生产域名正常：`curl https://hsk-news-global.tzxys.cn/nuxt-app/`
- 备份当前 Nginx upstream 配置

### 4.2 部署

- ConfigMap + Secret → apply
- Deployment 2 副本（podAntiAffinity 分散节点，maxUnavailable: 0）→ apply
- Service → apply
- Ingress（cert-manager 自动签发 SSL）→ apply

### 4.3 验证

- `kubectl port-forward svc/hsk-news-global-server 5010:5010` → curl
- Ingress 完整链路验证

### 4.4 切流量

- 改 Server-1 Nginx `hsk-news-global.tzxys.cn.conf`
- `proxy_pass http://127.0.0.1:5010` → `proxy_pass http://127.0.0.1:30080`
- `nginx -t && nginx -s reload`

### 4.5 观察

- 盯 15 分钟 `kubectl logs`，确认无异常
- `docker stop hsk-news-global-server`（Server-4）

### 4.6 回滚

- 改回 Nginx upstream + 重新 docker start 旧容器

---

## Day 4：收尾

- 全量验证 3 个服务
- 清理残留 Docker 镜像/卷
- 配置本地 kubectl 访问
- 确认 Server-1 磁盘空间改善

---

## 流水线改造

流水线增加海外部署 job：

```
构建镜像 → push ACR
  ↓
kubectl apply k8s/<service>/configmap.yaml   （有变更时）
  ↓
kubectl set image deployment/<service> ...
kubectl rollout status deployment/<service>
```

不再 SSH 到服务器，不再动 Docker 和 Nginx。

---

## 阶段二预告（阶段一稳定 1～2 周后）

把 hsk-global-server 迁入 K3s：

- 当前 3 节点蓝绿 → Deployment 3 副本
- `maxUnavailable: 0, maxSurge: 1` 天然实现零停机滚动
- 蓝绿切换脚本、Nginx upstream 手工管理全部作废
- 一个 `kubectl set image` 搞定发布
