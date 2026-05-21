# 测试环境 DevOps 自动化方案（v2）

## 1. 项目定位

**AI 驱动的测试环境一键部署工具。**

用户只需提供项目基本信息（分组、名称、类型、域名），系统自动完成：
- 基础设施资源检测与创建
- AI 分析代码仓库，生成构建和部署方案
- 按方案分步执行部署

核心价值：**将开发团队没人管的构建、部署、CI/CD 配置工作交给 AI 自动完成。**

## 2. 三阶段架构

```
┌─────────────────────────────────────────────────────┐
│  阶段 1: 资源准备                                      │
│  输入: group + name + type + domain (+ servicePort)   │
│  处理: 推导资源清单 → 探测已有资源 → 自动补齐缺失资源     │
│  产出: ResourceManifest（全部资源就位）                  │
│  AI 参与: 无（纯规则 + 阿里云/云效 API）                 │
└──────────────────────┬──────────────────────────────┘
                       │ 资源清单 + 仓库地址
                       ▼
┌─────────────────────────────────────────────────────┐
│  阶段 2: AI 部署方案                                    │
│  输入: 仓库代码内容 + 资源清单 + 本地配置                  │
│  处理: AI 读代码 → 项目画像 → 生成部署方案                │
│  产出: DeployPlan（Dockerfile + 构建脚本 + 部署配置）    │
│  AI 参与: 核心阶段                                      │
└──────────────────────┬──────────────────────────────┘
                       │ 用户确认后的方案
                       ▼
┌─────────────────────────────────────────────────────┐
│  阶段 3: 分步执行                                      │
│  输入: DeployPlan → 转为执行步骤列表                     │
│  处理: 逐步骤执行，实时日志，失败可重试单步                 │
│  产出: 执行结果 + 日志                                   │
│  AI 参与: 无（纯执行）                                   │
└─────────────────────────────────────────────────────┘
```

## 3. 阶段 1：资源准备

### 3.1 用户输入

用户只需填写以下信息：

| 字段 | 必填 | 说明 | 示例 |
|---|---|---|---|
| group | 是 | 项目分组 | `mall` |
| name | 是 | 项目名 | `order-service` |
| type | 是 | `frontend` / `backend` | `backend` |
| domain | 是 | 测试域名 | `order-test.tzxys.cn` |
| servicePort | 后端必填 | 容器服务端口，默认 `18080` | `18080` |

前端项目额外推导：`buildCommand`（默认 `pnpm install && pnpm build`）、`artifactDir`（默认 `dist`）。

### 3.2 自动推导规则

根据用户输入和本地配置，自动推导出完整资源清单。不需要 AI，纯规则。

| 资源 | 推导规则 | 前端 | 后端 |
|---|---|---|---|
| 云效代码组 | `{group}` | ✅ | ✅ |
| 云效代码仓库 | `{group}/{name}` | ✅ | ✅ |
| OSS Bucket | `bucketNameFrom(group, name)` | ✅ | - |
| RDS 数据库 | `dbNameFrom(group, name)` | - | ✅ |
| ACR 镜像仓库 | `acrRepositoryFrom(group, name)` | - | ✅ |
| Redis | 共用实例，自动分配 db 编号 | 可选 | 可选 |
| ECS 部署目录 | `{appRoot}/{name}` | - | ✅ |
| Nginx 配置 | `{nginxConfDir}/{name}.conf` | - | ✅ |
| DNS 解析 | `{domain}` → ECS 公网 IP | ✅ (→ OSS) | ✅ (→ ECS) |
| SSL 证书 | `*.{allowedRoot}` 通配符证书（共用） | ✅ | ✅ |

### 3.3 资源探测

推导完成后，逐项探测每项资源是否已存在：

| 资源 | 探测方式 |
|---|---|
| 代码组 | 云效 `GET /oapi/v1/codeup/organizations/namespaces/{path}` |
| 代码仓库 | 云效 `GET /oapi/v1/codeup/organizations/repositories/{path}` |
| OSS Bucket | `ossutil ls oss://{bucket}` |
| RDS 数据库 | `aliyun rds DescribeDatabases --DBInstanceId {id} --DBName {name}` |
| ACR 仓库 | `aliyun cr GetRepository --RepoNamespace {ns} --RepoName {name}` |
| Redis db | `aliyun r-kvstore DescribeInstanceAttribute` 获取连接信息 + ping 检测 |
| ECS 部署目录 | 云助手 `ls -d {deployPath}` |
| Nginx 配置 | 云助手 `test -f {nginxConfPath}` |
| DNS 解析 | `aliyun alidns DescribeDomainRecords --DomainName {root} --RR {sub}` |

### 3.4 资源状态展示

探测完成后，在 UI 上展示资源状态清单：

```
┌───────────────────────┬──────────┬─────────────────────────┐
│ 资源                   │ 状态      │ 详情                     │
├───────────────────────┼──────────┼─────────────────────────┤
│ 代码组 mall/           │ ✅ 已存在 │ 复用                     │
│ 代码仓库 mall/order    │ ✅ 已存在 │ 复用                     │
│ 数据库 db_mall_order   │ ❌ 不存在 │ 将创建                   │
│ ACR 仓库 mall/order    │ ❌ 不存在 │ 将创建                   │
│ Redis db=5             │ ✅ 可分配 │ 共用实例 r-xxxxx         │
│ DNS 解析               │ ❌ 不存在 │ 将指向 47.xxx.xxx.xxx    │
│ Nginx 配置             │ ❌ 不存在 │ 将写入                   │
│ ECS 部署目录           │ ❌ 不存在 │ 将创建                   │
│ SSL 证书               │ ✅ 共用   │ *.tzxys.cn 通配符        │
└───────────────────────┴──────────┴─────────────────────────┘
```

用户确认后，系统自动创建所有缺失资源。

### 3.5 新增步骤

在已有步骤基础上，新增以下 StepType：

#### `ensureDnsRecord`

- 调用 `aliyun alidns AddDomainRecord`
- 将测试域名指向 ECS 公网 IP（后端）或 OSS 外网域名（前端）
- 参数：`domain`、`type`（A/CNAME）、`value`（目标 IP 或域名）
- 幂等：已存在相同记录视为成功

#### `ensureRedisDb`

- 校验 Redis 实例连接可用性
- 自动分配 db 编号（查询已有项目记录，取最小未占用编号）
- 返回连接信息：`host`、`port`、`db`
- 参数：`db`（编号）
- 不创建 Redis 实例，仅分配 db 编号并返回连接信息

### 3.6 白名单步骤（阶段 1 完整清单）

```
ensureCodeGroup       — 创建或复用云效代码组
ensureRepository      — 创建或复用云效代码仓库
ensureOssBucket       — 创建或复用 OSS Bucket（前端）
ensureDatabase        — 创建或复用 RDS 数据库（后端）
ensureAcrRepository   — 创建或复用 ACR 镜像仓库（后端）
ensureRedisDb         — 分配 Redis db 编号，返回连接信息（可选）
ensureDnsRecord       — 配置 DNS 解析（新增）
writeDeployScript     — 写入 ECS 部署脚本（后端）
writeNginxConfig      — 写入 Nginx 配置（后端）
reloadNginx           — 校验并重载 Nginx（后端）
```

### 3.7 产出

阶段 1 完成后，输出 `ResourceManifest`：

```typescript
interface ResourceManifest {
  // 基础信息
  group: string;
  name: string;
  type: "frontend" | "backend";
  domain: string;
  servicePort?: number;

  // 资源状态
  codeGroup:     { status: "exists" | "created"; path: string };
  repository:    { status: "exists" | "created"; path: string; url?: string };
  ossBucket?:    { status: "exists" | "created" | "skipped"; name: string };
  database?:     { status: "exists" | "created" | "skipped"; name: string };
  acrRepository?:{ status: "exists" | "created" | "skipped"; name: string };
  redis?:        { status: "available" | "skipped"; host: string; port: number; db: number };
  dnsRecord:     { status: "exists" | "created"; domain: string; target: string };
  deployPath?:   { status: "exists" | "created" | "skipped"; path: string };
  nginxConf?:    { status: "exists" | "created" | "skipped"; path: string };
}
```

## 4. 阶段 2：AI 部署方案

### 4.1 概述

阶段 1 完成后，仓库地址已确定。系统通过云效 API 读取仓库关键文件，交给 AI 分析，生成完整部署方案。

**这是本项目的核心差异化能力。**

### 4.2 仓库分析

#### 读取内容

通过云效 Codeup API 读取以下文件（按优先级尝试）：

| 文件 | 用途 |
|---|---|
| `package.json` | Node.js 项目识别 |
| `pom.xml` / `build.gradle` | Java 项目识别 |
| `go.mod` | Go 项目识别 |
| `requirements.txt` / `pyproject.toml` | Python 项目识别 |
| `Dockerfile` | 已有容器化配置 |
| `docker-compose.yml` | 已有编排配置 |
| `Makefile` | 构建命令线索 |
| 目录结构（一级） | 项目结构识别 |

#### AI 输出：项目画像

```typescript
interface ProjectProfile {
  // 语言和框架
  language: "node" | "java" | "go" | "python" | "other";
  framework: string;            // spring-boot, next, vue, react, gin, etc.
  frameworkVersion?: string;

  // 构建信息
  buildTool: string;            // pnpm, npm, maven, gradle, go-build, etc.
  buildCommand: string;         // AI 推断的完整构建命令
  artifactDir: string;          // AI 推断的产物目录
  runtimeCommand: string;       // AI 推断的启动命令

  // 运行依赖
  needsDatabase: boolean;
  databaseType?: "mysql" | "postgresql" | "mongodb";
  needsRedis: boolean;
  servicePort: number;          // AI 推断的服务端口

  // 已有配置
  hasDockerfile: boolean;
  hasDockerCompose: boolean;
  existingDockerfileContent?: string;

  // 推理过程（可审计）
  reasoning: string;            // AI 如何得出这些结论
}
```

### 4.3 方案生成

基于项目画像 + 阶段 1 的资源清单，AI 生成完整部署方案。

#### AI 输出：部署方案

```typescript
interface DeployPlan {
  // 关联的项目画像
  profile: ProjectProfile;

  // AI 生成的文件内容
  artifacts: {
    dockerfile?: string;          // 如果项目没有 Dockerfile
    dockerCompose?: string;       // docker-compose.yml
    buildScript?: string;         // 构建脚本（如需要）
    deployScript?: string;        // ECS 上的部署脚本
    nginxConfig?: string;         // Nginx 反代配置
    pipelineYaml?: string;        // 云效流水线 YAML
  };

  // 端口规划
  ports: {
    servicePort: number;          // 容器内端口
    hostPort: number;             // ECS 上映射的端口
  };

  // 审计信息
  reasoning: string;              // AI 的方案设计理由
  assumptions: string[];          // AI 做了哪些假设
  warnings: string[];             // 风险提示
  manualSteps: string[];          // 需要人工确认或处理的步骤
}
```

### 4.4 用户审核

AI 生成的方案在 UI 上逐文件展示，用户可以：
- 查看每个文件的内容和 AI 的推理说明
- 编辑任何文件内容
- 确认或拒绝方案
- 拒绝后可修改输入参数重新生成

### 4.5 AI 调用方式

复用现有 `src/ai/planner.ts` 的 OpenAI 兼容调用模式：
- 支持 `OPENAI_BASE_URL` 配置不同供应商
- 支持 `OPENAI_API_MODE` 的 `auto` / `responses` / `chat_completions` 三种模式
- 使用 structured output（JSON Schema）约束 AI 输出格式

### 4.6 兜底策略

当 AI 不可用（未配置 API Key 或调用失败）时：
- 项目画像由用户手动填写（表单展开更多字段）
- 部署文件使用仓库模板渲染（现有 `templates/` 目录）
- 在 UI 上明确标注"AI 不可用，使用模板兜底"

## 5. 阶段 3：分步执行

### 5.1 执行步骤生成

阶段 2 的 `DeployPlan` 转为执行步骤列表。步骤是动态的，取决于项目类型和 AI 方案。

#### 后端项目典型步骤

```
1. commitDockerfile      — AI 生成的 Dockerfile 提交到仓库
2. commitDockerCompose   — AI 生成的 docker-compose.yml 提交到仓库
3. commitDeployScript    — AI 生成的部署脚本提交到仓库
4. deployToEcs           — 在 ECS 上拉取镜像、启动容器
5. configureNginx        — 写入 Nginx 反代配置
6. reloadNginx           — 校验并重载 Nginx
7. healthCheck           — 检查服务是否正常响应
8. createPipeline        — 创建云效流水线（可选）
```

#### 前端项目典型步骤

```
1. commitBuildConfig     — AI 生成的构建配置提交到仓库
2. configureOssWebsite   — 配置 OSS 静态网站托管
3. configureDns          — DNS 解析指向 OSS
4. healthCheck           — 检查页面是否可访问
5. createPipeline        — 创建云效流水线（可选）
```

### 5.2 新增步骤类型

| StepType | 说明 | 调用方式 |
|---|---|---|
| `commitDockerfile` | 将 Dockerfile 提交到云效仓库 | 云效 `POST /repositories/{path}/files` |
| `commitDockerCompose` | 将 docker-compose.yml 提交到仓库 | 同上 |
| `commitDeployScript` | 将部署脚本提交到仓库 | 同上 |
| `commitBuildConfig` | 将构建配置提交到仓库 | 同上 |
| `deployToEcs` | 在 ECS 上执行部署 | 云助手 `RunCommand` |
| `configureNginx` | 写入 Nginx 配置并重载 | 云助手 `RunCommand` |
| `configureOssWebsite` | 配置 OSS 静态网站 | `ossutil` |
| `configureDns` | 配置 DNS 解析 | `aliyun alidns` |
| `healthCheck` | HTTP 健康检查 | 本地 `fetch` |
| `createPipeline` | 创建云效流水线 | 云效 Flow API |

### 5.3 执行模式

- **单步执行**：用户可以选择任意步骤单独执行，失败可重试
- **批量执行**：确认方案后一键执行全部步骤
- **实时日志**：每个步骤的执行日志实时展示
- **失败处理**：某步失败后停止后续步骤，已执行步骤不回滚

## 6. 类型定义

### 6.1 新增类型

```typescript
// 资源探测结果
interface ProbedResource {
  key: string;
  label: string;
  status: "exists" | "missing" | "error";
  resourceId?: string;
  message?: string;
}

// 资源推导清单
interface DerivedResource {
  key: string;
  label: string;
  stepType: StepType;
  params: Record<string, unknown>;
  required: boolean;
}

// Redis 连接信息
interface RedisAllocation {
  host: string;
  port: number;
  db: number;
  password?: string;  // 来自配置，不记录到日志
}
```

### 6.2 类型变更

`StepType` 新增：

```typescript
| "ensureDnsRecord"
| "ensureRedisDb"
| "commitDockerfile"
| "commitDockerCompose"
| "commitDeployScript"
| "commitBuildConfig"
| "deployToEcs"
| "configureNginx"
| "configureOssWebsite"
| "configureDns"
| "healthCheck"
```

`AppConfig` 新增：

```typescript
interface AppConfig {
  // ... 现有字段

  // 新增
  redis: {
    instanceId: string;        // 共用 Redis 实例 ID
    host: string;
    port: number;
    passwordEnv?: string;      // 密码环境变量名
  };

  dns: {
    domainName: string;        // 根域名，如 tzxys.cn
    ecsPublicIp: string;       // ECS 公网 IP（后端 DNS 解析目标）
  };

  ssl: {
    certPath: string;          // 通配符证书在 ECS 上的路径
    keyPath: string;           // 通配符私钥路径
  };
}
```

## 7. API 设计

### 7.1 阶段 1 API

#### `POST /api/resources/derive`

根据用户输入推导资源清单。

请求：
```json
{
  "group": "mall",
  "name": "order-service",
  "type": "backend",
  "domain": "order-test.tzxys.cn",
  "servicePort": 18080
}
```

响应：
```json
{
  "resources": [
    { "key": "codeGroup", "label": "云效代码组", "stepType": "ensureCodeGroup", "params": { "path": "mall" }, "required": true },
    { "key": "repository", "label": "云效代码仓库", "stepType": "ensureRepository", "params": { "groupPath": "mall", "repoPath": "order-service" }, "required": true },
    { "key": "database", "label": "RDS 数据库", "stepType": "ensureDatabase", "params": { "database": "db_mall_order_service" }, "required": true },
    { "key": "acrRepository", "label": "ACR 镜像仓库", "stepType": "ensureAcrRepository", "params": { "repository": "mall/order-service" }, "required": true },
    { "key": "redis", "label": "Redis", "stepType": "ensureRedisDb", "params": { "db": 5 }, "required": false },
    { "key": "dnsRecord", "label": "DNS 解析", "stepType": "ensureDnsRecord", "params": { "domain": "order-test.tzxys.cn", "type": "A", "value": "47.xxx.xxx.xxx" }, "required": true },
    { "key": "deployPath", "label": "ECS 部署目录", "stepType": "writeDeployScript", "params": { "deployPath": "/opt/apps/order-service", "servicePort": 18080 }, "required": true },
    { "key": "nginxConf", "label": "Nginx 配置", "stepType": "writeNginxConfig", "params": { "nginxConfPath": "/etc/nginx/conf.d/order-service.conf", "domain": "order-test.tzxys.cn", "servicePort": 18080 }, "required": true }
  ]
}
```

#### `POST /api/resources/probe`

探测资源清单中每项的存在状态。

请求：推导出的资源列表。

响应：
```json
{
  "results": [
    { "key": "codeGroup", "status": "exists", "message": "代码组已存在" },
    { "key": "repository", "status": "exists", "message": "仓库已存在" },
    { "key": "database", "status": "missing", "message": "数据库不存在" },
    { "key": "dnsRecord", "status": "missing", "message": "DNS 记录不存在" }
  ]
}
```

#### `POST /api/resources/provision`

批量创建缺失资源。

请求：资源清单（可指定只创建缺失项）。

响应：每项资源的创建结果。

### 7.2 阶段 2 API

#### `POST /api/analyze`

读取仓库代码，AI 生成项目画像。

请求：
```json
{
  "group": "mall",
  "name": "order-service",
  "repoPath": "mall/order-service"
}
```

响应：
```json
{
  "profile": {
    "language": "java",
    "framework": "spring-boot",
    "buildTool": "maven",
    "buildCommand": "mvn clean package -DskipTests",
    "artifactDir": "target",
    "runtimeCommand": "java -jar target/*.jar",
    "needsDatabase": true,
    "databaseType": "mysql",
    "needsRedis": true,
    "servicePort": 8080,
    "hasDockerfile": false,
    "hasDockerCompose": false,
    "reasoning": "发现 pom.xml，Spring Boot 项目..."
  }
}
```

#### `POST /api/deploy-plan`

基于项目画像和资源清单，AI 生成部署方案。

请求：
```json
{
  "profile": { "..." : "..." },
  "manifest": { "..." : "..." }
}
```

响应：完整的 `DeployPlan`，包含所有生成的文件内容。

### 7.3 阶段 3 API

#### `POST /api/runs`

执行完整方案（保持现有接口，步骤列表从方案动态生成）。

#### `POST /api/runs/step`

执行单个步骤（保持现有接口）。

## 8. 本地配置扩展

`src/config/local.json` 新增字段：

```json
{
  "redis": {
    "instanceId": "r-xxxxx",
    "host": "r-xxxxx.redis.rds.aliyuncs.com",
    "port": 6379,
    "passwordEnv": "REDIS_PASSWORD"
  },
  "dns": {
    "domainName": "tzxys.cn",
    "ecsPublicIp": "47.xxx.xxx.xxx"
  },
  "ssl": {
    "certPath": "/etc/nginx/ssl/tzxys.cn.crt",
    "keyPath": "/etc/nginx/ssl/tzxys.cn.key"
  }
}
```

`.env.dev` 新增：

```bash
REDIS_PASSWORD=your-redis-password
```

## 9. UI 流程

### 9.1 整体流程

```
页面 1: 项目表单
  输入: group / name / type / domain / servicePort
  按钮: "下一步：检测资源"

页面 2: 资源状态
  展示: 推导出的资源清单 + 每项探测状态
  按钮: "一键补齐缺失资源" / "跳过，已有资源足够"
  操作: 批量创建缺失资源，实时显示进度

页面 3: AI 部署方案
  展示: 项目画像 + AI 生成的每个文件
  操作: 用户可编辑任何文件内容
  按钮: "确认方案" / "重新生成"

页面 4: 执行
  展示: 动态生成的步骤列表
  操作: 单步执行 / 全部执行
  展示: 实时执行日志
```

### 9.2 与现有 UI 的关系

现有 `ProjectConsole.tsx` 的表单和计划展示改造为多步流程。核心组件可复用：
- `PlanPreview` → 改造为步骤执行面板
- `ConfigDiscovery` → 改造为资源状态面板
- 项目列表 → 保持不变

## 10. 实施计划

### 10.1 Phase 1：完善资源准备（阶段 1）

目标：用户填最少信息，系统自动推导 + 探测 + 创建全部基础设施资源。

任务清单：

| # | 任务 | 涉及文件 |
|---|---|---|
| 1 | 新增 `ensureDnsRecord` 步骤 | `types.ts`, `schemas.ts`, `stepRegistry.ts`, 新增 `src/runner/steps/dns.ts` |
| 2 | 新增 `ensureRedisDb` 步骤 | `types.ts`, `schemas.ts`, `stepRegistry.ts`, 新增 `src/runner/steps/redis.ts` |
| 3 | 配置扩展：redis / dns / ssl | `config.ts`, `local.example.json` |
| 4 | 资源推导函数 | 新增 `src/ai/resourceDeriver.ts` |
| 5 | 资源探测函数 | 新增 `src/runner/probeResources.ts` |
| 6 | API 路由 | 新增 `app/api/resources/derive/route.ts`, `probe/route.ts`, `provision/route.ts` |
| 7 | UI 改造：资源状态面板 | `ProjectConsole.tsx` |

### 10.2 Phase 2：AI 部署方案（阶段 2）

目标：AI 读仓库代码，生成项目画像和完整部署方案。

任务清单：

| # | 任务 | 涉及文件 |
|---|---|---|
| 1 | 仓库文件读取 | 新增 `src/lib/codeupReader.ts` |
| 2 | 项目画像 Schema | `types.ts`, `schemas.ts` |
| 3 | AI 分析 prompt | 新增 `src/ai/analyzer.ts` |
| 4 | 部署方案生成 | 新增 `src/ai/deployPlanner.ts` |
| 5 | API 路由 | 新增 `app/api/analyze/route.ts`, `app/api/deploy-plan/route.ts` |
| 6 | UI：方案展示和编辑 | `ProjectConsole.tsx` 新增方案面板 |

### 10.3 Phase 3：动态执行（阶段 3）

目标：基于 AI 方案动态生成执行步骤，支持文件提交和部署。

任务清单：

| # | 任务 | 涉及文件 |
|---|---|---|
| 1 | 文件提交步骤 | 新增 `src/runner/steps/codeupCommit.ts` |
| 2 | 部署执行步骤 | 改造 `ecs.ts`, 新增 `healthCheck` |
| 3 | OSS 网站配置 | 新增 `src/runner/steps/ossWebsite.ts` |
| 4 | 步骤动态生成 | 新增 `src/ai/stepGenerator.ts` |
| 5 | UI：多步执行流程 | `ProjectConsole.tsx` 改造 |

### 10.4 优先级

**先做 Phase 1。** 原因：
- 现有步骤已基本覆盖，补上 DNS 和 Redis 即可闭环
- Phase 2 依赖 Phase 1 的产出（至少需要仓库地址）
- Phase 1 做完后可以独立使用：用户一键完成基础设施准备
- Phase 2 的 AI 能力可以先做简单版（只读 `package.json` / `pom.xml`），再逐步增强

## 11. 安全约束（不变）

- AI 只生成文件内容和结构化方案，不直接执行命令
- 执行器只接受白名单中的 StepType
- 部署脚本和 Nginx 配置优先使用模板渲染，AI 生成的内容需用户确认
- 不自动删除云资源
- 不记录密钥、token、AccessKey、密码
- 缺少配置或凭据时直接失败，不返回模拟成功
- 域名必须属于配置的根域
- SSL 使用共用通配符证书，不自动申请单独证书
