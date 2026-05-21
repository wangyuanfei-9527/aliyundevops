# 测试环境 DevOps 自动化方案（v3）

## 1. 项目定位

**AI 驱动的测试环境一键部署工具，Terraform 负责基础设施资源，云效和部署流程由本项目编排。**

用户只需提供最少项目信息，系统完成：

1. 推导测试环境资源清单
2. 使用 Terraform 创建和维护阿里云基础设施资源
3. 使用云效 OpenAPI 创建或复用代码组、代码仓库、流水线
4. 使用 AI 读取仓库代码并生成部署方案
5. 使用本项目 Runner 按白名单步骤执行部署、写配置、健康检查

核心价值：

> **把开发团队未标准化的构建、部署、CI/CD 配置工作交给 AI 和自动化流程处理；把成熟的阿里云基础资源管理交给 Terraform。**

---

## 2. v3 核心结论

v3 不是把所有操作都交给 Terraform，而是明确分层：

| 层 | 负责内容 | 工具 |
|---|---|---|
| 基础设施资源层 | RDS 数据库、OSS Bucket、ACR EE 仓库、DNS 解析 | Terraform + `terraform-provider-alicloud` |
| 云效层 | 代码组、代码仓库、流水线创建、仓库文件提交 | Yunxiao / Codeup / Flow OpenAPI |
| AI 层 | 读取代码、识别项目、生成 Dockerfile / docker-compose / deploy.sh / pipeline YAML | OpenAI-compatible API |
| 执行层 | ECS 部署、Nginx 写入、Nginx reload、健康检查、单步重试 | 本项目 Runner + 阿里云云助手 |
| 状态层 | 项目记录、运行日志、Redis db 分配、Terraform state | 本地 JSON/JSONL + `data/terraform` |

### 2.1 Terraform 负责什么

Terraform 只负责**声明式、长期存在、Provider 已支持的阿里云基础资源**：

- OSS Bucket
- OSS Bucket ACL / Website 配置
- RDS Database
- ACR EE Repository
- Alidns Record

### 2.2 Terraform 不负责什么

Terraform 不负责这些过程性或 Provider 未覆盖的能力：

- 云效代码组
- 云效代码仓库
- 云效流水线
- 仓库文件提交
- 触发构建或部署
- ECS 上写部署脚本
- ECS 上写 Nginx 配置
- Docker 容器启动
- 健康检查
- Redis db 编号分配

原因：

1. Terraform Provider 不一定支持云效 Codeup / Flow 资源。
2. 提交文件、执行部署、健康检查是过程性动作，不适合放进 Terraform state。
3. 当前项目已有 Runner 和云助手执行链路，更适合支持实时日志、失败停止、单步重试。

---

## 3. 三阶段架构

```text
┌─────────────────────────────────────────────────────────────┐
│ 阶段 1：资源准备                                               │
│ 输入：group + name + type + domain (+ servicePort)            │
│ 处理：规则推导 → 云效资源 ensure → Terraform plan/apply        │
│ 输出：ResourceManifest                                         │
│ AI：不参与                                                     │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 阶段 2：AI 部署方案                                             │
│ 输入：仓库代码 + ResourceManifest + 本地配置                    │
│ 处理：AI 读取代码 → ProjectProfile → DeployPlan                │
│ 输出：Dockerfile / docker-compose / deploy.sh / Nginx / YAML   │
│ AI：核心参与                                                   │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 阶段 3：分步执行                                                │
│ 输入：用户确认后的 DeployPlan                                   │
│ 处理：白名单步骤执行、实时日志、失败可重试                       │
│ 输出：部署结果、访问地址、运行日志                               │
│ AI：不直接执行                                                  │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. 阶段 1：资源准备

### 4.1 用户输入

用户只填写最少信息：

| 字段 | 必填 | 说明 | 示例 |
|---|---|---|---|
| `group` | 是 | 项目分组 | `mall` |
| `name` | 是 | 项目名 | `order-service` |
| `type` | 是 | `frontend` / `backend` | `backend` |
| `domain` | 是 | 测试域名 | `order-test.tzxys.cn` |
| `servicePort` | 后端必填 | 容器服务端口，默认 `18080` | `18080` |

### 4.2 资源推导

根据输入和本地配置推导资源，不使用 AI。

| 资源 | 推导规则 | 前端 | 后端 | 管理方式 |
|---|---|---:|---:|---|
| 云效代码组 | `{group}` | ✅ | ✅ | Yunxiao OpenAPI |
| 云效代码仓库 | `{group}/{name}` | ✅ | ✅ | Yunxiao OpenAPI |
| OSS Bucket | `bucketNameFrom(group, name)` | ✅ | - | Terraform |
| RDS 数据库 | `dbNameFrom(group, name)` | - | ✅ | Terraform |
| ACR EE 仓库 | `acrRepositoryFrom(group, name)` | - | ✅ | Terraform |
| DNS 解析 | `domain` | ✅ | ✅ | Terraform |
| Redis db 编号 | 从本地项目记录分配 | 可选 | 可选 | 本项目状态管理 |
| ECS 部署目录 | `{appRoot}/{name}` | - | ✅ | Runner + 云助手 |
| Nginx 配置 | `{nginxConfDir}/{name}.conf` | - | ✅ | Runner + 云助手 |
| SSL 证书 | 共用通配符证书 | ✅ | ✅ | 本地配置引用 |

### 4.3 阶段 1 执行顺序

```text
1. 校验输入和域名归属
2. 推导资源名称
3. ensureCodeGroup：创建或复用云效代码组
4. ensureRepository：创建或复用云效代码仓库
5. allocateRedisDb：如项目需要 Redis，则分配 db 编号
6. renderTerraform：生成 Terraform 工作目录和 HCL 文件
7. terraform init
8. terraform plan：展示变更给用户确认
9. terraform apply：创建基础设施资源
10. terraform output：生成 ResourceManifest
```

### 4.4 Terraform 工作目录

每个项目一个独立 Terraform 工作目录，避免 state 互相影响。

```text
data/
  terraform/
    {group}/
      {name}/
        main.tf
        variables.tf
        terraform.tfvars
        resources.tf
        outputs.tf
        terraform.tfstate
        terraform.tfstate.backup
```

要求：

- `data/terraform/` 必须加入 `.gitignore`
- 不提交 `terraform.tfstate`
- 不提交 `terraform.tfvars`
- 每个项目独立 state
- MVP 不实现 `terraform destroy`

---

## 5. Terraform 模板设计

### 5.1 Provider 和变量

`templates/terraform/main.tf.hbs`

```hcl
terraform {
  required_providers {
    alicloud = {
      source  = "aliyun/alicloud"
      version = "~> 1.278"
    }
  }
}

provider "alicloud" {
  region = var.region
}
```

`templates/terraform/variables.tf.hbs`

```hcl
variable "region" { type = string }
variable "project_key" { type = string }
variable "root_domain" { type = string }
variable "dns_rr" { type = string }
variable "ecs_public_ip" { type = string }
variable "oss_endpoint" { type = string }

variable "rds_instance_id" {
  type    = string
  default = ""
}

variable "rds_character_set" {
  type    = string
  default = "utf8mb4"
}

variable "database_name" {
  type    = string
  default = ""
}

variable "acr_instance_id" {
  type    = string
  default = ""
}

variable "acr_namespace" {
  type    = string
  default = ""
}

variable "acr_repo_name" {
  type    = string
  default = ""
}

variable "oss_bucket" {
  type    = string
  default = ""
}
```

### 5.2 后端资源模板

`templates/terraform/resources-backend.tf.hbs`

> 资源名和参数名已按 `terraform-provider-alicloud` 实际 schema 校对。

```hcl
resource "alicloud_db_database" "main" {
  instance_id    = var.rds_instance_id
  data_base_name = var.database_name
  character_set  = var.rds_character_set
  description    = "test database for ${var.project_key}"
}

resource "alicloud_cr_ee_repo" "main" {
  instance_id = var.acr_instance_id
  namespace   = var.acr_namespace
  name        = var.acr_repo_name
  repo_type   = "PRIVATE"
  summary     = "${var.project_key} test image repository"
  detail      = "Auto-created for test environment"
}

resource "alicloud_alidns_record" "main" {
  domain_name = var.root_domain
  rr          = var.dns_rr
  type        = "A"
  value       = var.ecs_public_ip
  ttl         = 600
}
```

### 5.3 前端资源模板

`templates/terraform/resources-frontend.tf.hbs`

```hcl
resource "alicloud_oss_bucket" "main" {
  bucket = var.oss_bucket
}

resource "alicloud_oss_bucket_acl" "main" {
  bucket = alicloud_oss_bucket.main.bucket
  acl    = "public-read"
}

resource "alicloud_alidns_record" "main" {
  domain_name = var.root_domain
  rr          = var.dns_rr
  type        = "CNAME"
  value       = "${var.oss_bucket}.${var.oss_endpoint}"
  ttl         = 600
}
```

说明：

- 不在 `alicloud_oss_bucket` 中直接配置 `acl`，因为该字段已 deprecated。
- OSS 静态网站托管可由 Terraform 或 Phase 3 的 `configureOssWebsite` 实现。MVP 建议先放在 Phase 3，便于和 AI 生成的产物目录、首页文件保持一致。

### 5.4 Outputs

`templates/terraform/outputs.tf.hbs`

```hcl
output "dns_record" {
  value = "${var.dns_rr}.${var.root_domain}"
}

output "database_name" {
  value = var.database_name
}

output "acr_repo_name" {
  value = var.acr_repo_name
}

output "oss_bucket" {
  value = var.oss_bucket
}
```

---

## 6. Redis db 分配策略

Redis 使用共用实例，不创建独立 Redis 实例，不通过 Terraform 管理 db 编号。

原因：

- Redis db0/db1/db2 是客户端连接时选择的逻辑库。
- 阿里云没有针对 Redis db 编号的资源 API。
- `terraform-provider-alicloud` 也没有 Redis database-level resource。

分配规则：

```text
1. 读取 data/projects/*.json
2. 收集已使用的 redis.db 编号
3. 从配置允许范围内选择最小未占用编号
4. 写入 ResourceManifest 和 ProjectRecord
```

类型：

```typescript
interface RedisAllocation {
  instanceId: string;
  host: string;
  port: number;
  db: number;
  passwordEnv?: string;
}
```

安全要求：

- 不记录 Redis 密码明文
- 只记录 `passwordEnv`
- Redis 连接测试只能输出成功/失败，不输出完整连接串

---

## 7. 阶段 1 产出：ResourceManifest

```typescript
interface ResourceManifest {
  group: string;
  name: string;
  type: "frontend" | "backend";
  domain: string;
  servicePort?: number;

  codeGroup: {
    status: "exists" | "created";
    path: string;
  };

  repository: {
    status: "exists" | "created";
    path: string;
    url?: string;
  };

  terraform: {
    workDir: string;
    statePath: string;
    providerVersion: string;
  };

  ossBucket?: {
    status: "exists" | "created" | "managed" | "skipped";
    name: string;
  };

  database?: {
    status: "exists" | "created" | "managed" | "skipped";
    name: string;
    instanceId: string;
  };

  acrRepository?: {
    status: "exists" | "created" | "managed" | "skipped";
    instanceId: string;
    namespace: string;
    name: string;
  };

  dnsRecord: {
    status: "exists" | "created" | "managed";
    domain: string;
    type: "A" | "CNAME";
    target: string;
  };

  redis?: RedisAllocation;

  deployPath?: string;
  nginxConfPath?: string;
}
```

说明：

- `managed` 表示资源已进入 Terraform state，由 Terraform 管理。
- 资源是否是首次创建，可从 `terraform plan` / `terraform apply` 输出解析。
- 对于已存在但未进入 state 的资源，MVP 不自动 import，先提示用户处理。

---

## 8. 阶段 2：AI 部署方案

### 8.1 仓库读取

通过 Codeup API 读取关键文件：

| 文件 | 用途 |
|---|---|
| `package.json` | Node.js / 前端项目识别 |
| `pnpm-lock.yaml` / `package-lock.json` / `yarn.lock` | 包管理器判断 |
| `pom.xml` / `build.gradle` | Java 项目识别 |
| `go.mod` | Go 项目识别 |
| `requirements.txt` / `pyproject.toml` | Python 项目识别 |
| `Dockerfile` | 复用或修正已有容器配置 |
| `docker-compose.yml` | 识别已有服务编排 |
| `Makefile` | 构建命令线索 |
| 一级目录结构 | 判断项目形态 |

### 8.2 ProjectProfile

```typescript
interface ProjectProfile {
  language: "node" | "java" | "go" | "python" | "other";
  framework: string;
  frameworkVersion?: string;

  buildTool: string;
  buildCommand: string;
  artifactDir?: string;
  runtimeCommand?: string;

  needsDatabase: boolean;
  databaseType?: "mysql" | "postgresql" | "mongodb";
  needsRedis: boolean;

  servicePort: number;

  hasDockerfile: boolean;
  hasDockerCompose: boolean;

  reasoning: string;
  warnings: string[];
}
```

### 8.3 DeployPlan

```typescript
interface DeployPlan {
  profile: ProjectProfile;
  manifest: ResourceManifest;

  artifacts: {
    dockerfile?: string;
    dockerCompose?: string;
    deployScript?: string;
    nginxConfig?: string;
    pipelineYaml?: string;
    buildScript?: string;
  };

  env: {
    variables: Record<string, string>;
    secretEnvNames: string[];
  };

  ports: {
    servicePort: number;
    hostPort?: number;
  };

  reasoning: string;
  assumptions: string[];
  warnings: string[];
  manualSteps: string[];
}
```

### 8.4 AI 安全边界

- AI 只生成结构化方案和文件内容。
- AI 不直接执行命令。
- AI 不生成任意 shell StepType。
- 用户必须确认生成内容后才允许执行。
- Runner 只执行白名单步骤。

---

## 9. 阶段 3：分步执行

### 9.1 后端典型步骤

```text
1. commitDockerfile       — 提交 Dockerfile 到 Codeup
2. commitDockerCompose    — 提交 docker-compose.yml 到 Codeup
3. commitDeployScript     — 提交 deploy.sh 到 Codeup
4. writeDeployScript      — 通过云助手写入 ECS 部署脚本
5. deployToEcs            — 通过云助手拉镜像、启动容器
6. writeNginxConfig       — 通过云助手写入 Nginx 配置
7. reloadNginx            — 校验并重载 Nginx
8. healthCheck            — 本地 HTTP 健康检查
9. createBackendPipeline  — 创建云效流水线
```

### 9.2 前端典型步骤

```text
1. commitBuildConfig       — 提交 AI 生成的构建配置
2. configureOssWebsite     — 配置 OSS 静态网站托管
3. createFrontendPipeline  — 创建云效前端流水线
4. healthCheck             — 检查域名是否可访问
```

### 9.3 StepType 白名单

```typescript
export type StepType =
  // Phase 1: 云效资源
  | "ensureCodeGroup"
  | "ensureRepository"

  // Phase 1: Terraform 基础设施
  | "terraformInit"
  | "terraformPlan"
  | "terraformApply"

  // Phase 3: Codeup 文件提交
  | "commitDockerfile"
  | "commitDockerCompose"
  | "commitDeployScript"
  | "commitBuildConfig"

  // Phase 3: ECS / Nginx / OSS / 健康检查
  | "writeDeployScript"
  | "deployToEcs"
  | "writeNginxConfig"
  | "reloadNginx"
  | "configureOssWebsite"
  | "healthCheck"

  // Phase 3: 云效流水线
  | "createFrontendPipeline"
  | "createBackendPipeline";
```

说明：

- v2 中已有的 `ensureOssBucket`、`ensureDatabase`、`ensureAcrRepository` 可以保留一段时间作为兼容步骤，但 v3 新流程不再使用。
- DNS 不再新增 `ensureDnsRecord` 步骤，改为 Terraform 管理。
- Redis 不新增 Terraform 步骤，由本地状态分配。

---

## 10. API 设计

### 10.1 `POST /api/resources/derive`

根据用户输入推导资源清单和 Terraform 变量。

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
  "project": {
    "group": "mall",
    "name": "order-service",
    "type": "backend",
    "domain": "order-test.tzxys.cn",
    "servicePort": 18080
  },
  "resources": {
    "codeGroupPath": "mall",
    "repoPath": "order-service",
    "databaseName": "test_mall_order_service",
    "acrRepoName": "order-service",
    "dnsRR": "order-test",
    "rootDomain": "tzxys.cn",
    "deployPath": "/opt/apps/order-service",
    "nginxConfPath": "/etc/nginx/conf.d/order-service.conf"
  }
}
```

### 10.2 `POST /api/resources/plan`

渲染 Terraform 文件并执行 `terraform plan`。

响应：

```json
{
  "workDir": "data/terraform/mall/order-service",
  "summary": {
    "toAdd": 3,
    "toChange": 0,
    "toDestroy": 0
  },
  "planOutput": "Terraform will perform the following actions..."
}
```

### 10.3 `POST /api/resources/apply`

执行 `terraform apply`，并返回 `ResourceManifest`。

响应：

```json
{
  "status": "success",
  "manifest": {
    "group": "mall",
    "name": "order-service",
    "type": "backend",
    "domain": "order-test.tzxys.cn",
    "terraform": {
      "workDir": "data/terraform/mall/order-service",
      "statePath": "data/terraform/mall/order-service/terraform.tfstate",
      "providerVersion": "~> 1.278"
    },
    "database": {
      "status": "managed",
      "name": "test_mall_order_service",
      "instanceId": "rm-xxxxx"
    },
    "acrRepository": {
      "status": "managed",
      "instanceId": "cri-xxxxx",
      "namespace": "test",
      "name": "order-service"
    },
    "dnsRecord": {
      "status": "managed",
      "domain": "order-test.tzxys.cn",
      "type": "A",
      "target": "47.xxx.xxx.xxx"
    }
  }
}
```

### 10.4 `POST /api/analyze`

读取仓库代码，AI 生成 ProjectProfile。

### 10.5 `POST /api/deploy-plan`

基于 ProjectProfile 和 ResourceManifest 生成 DeployPlan。

### 10.6 `POST /api/runs`

执行用户确认后的完整步骤列表。

### 10.7 `POST /api/runs/step`

执行单个步骤，支持失败重试。

---

## 11. 本地配置

`src/config/local.example.json` 新增：

```json
{
  "terraform": {
    "workDir": "data/terraform",
    "executable": "terraform",
    "timeoutSeconds": 600,
    "providerVersion": "~> 1.278"
  },
  "redis": {
    "instanceId": "r-xxxxx",
    "host": "r-xxxxx.redis.rds.aliyuncs.com",
    "port": 6379,
    "passwordEnv": "REDIS_PASSWORD",
    "dbMin": 1,
    "dbMax": 15
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
TERRAFORM_EXECUTABLE=terraform
REDIS_PASSWORD=your-redis-password
```

---

## 12. 目录结构

```text
app/
  api/
    resources/
      derive/route.ts
      plan/route.ts
      apply/route.ts
    analyze/route.ts
    deploy-plan/route.ts
    runs/route.ts
    runs/step/route.ts

src/
  ai/
    analyzer.ts
    deployPlanner.ts
    stepGenerator.ts
    schemas.ts

  config/
    config.ts
    discovery.ts
    local.example.json

  lib/
    names.ts
    renderTemplate.ts
    terraform.ts
    codeupReader.ts
    yunxiao.ts

  runner/
    runProject.ts
    stepRegistry.ts
    steps/
      terraform.ts
      codeup.ts
      ecs.ts
      oss.ts
      flow.ts
      healthCheck.ts

  storage/
    projects.ts
    logs.ts
    redisAllocations.ts

templates/
  terraform/
    main.tf.hbs
    variables.tf.hbs
    resources-backend.tf.hbs
    resources-frontend.tf.hbs
    outputs.tf.hbs
  deploy.sh.hbs
  docker-compose.yml.hbs
  nginx.conf.hbs
  frontend-pipeline.yml
  backend-pipeline.yml

data/
  terraform/       # ignored
  projects/        # ignored unless sanitized fixtures
  logs/            # ignored
```

---

## 13. Terraform state 与 import 策略

### 13.1 MVP state 策略

- 使用本地 state。
- 每个项目独立目录。
- 不实现 destroy。
- 不自动删除任何云资源。
- `terraform apply` 前必须展示 plan。

### 13.2 已存在资源处理

如果资源已存在但不在当前 state 中，Terraform 可能报 AlreadyExists 或冲突。MVP 策略：

1. plan/apply 报错时把错误展示给用户。
2. 提示用户选择：
   - 使用已有资源并执行 import
   - 修改资源名重新创建
   - 手工处理后重试
3. 第一版不自动 import，避免错误导入非测试资源。

### 13.3 后续 import 功能

后续可新增：

```text
POST /api/resources/import
```

用于显式导入已有资源：

```bash
terraform import alicloud_db_database.main <import-id>
terraform import alicloud_cr_ee_repo.main <import-id>
terraform import alicloud_alidns_record.main <record-id>
```

import id 格式必须从 provider 文档或实际测试中确认，不在 MVP 中硬编码。

---

## 14. 安全约束

1. 不提供 `terraform destroy`。
2. 不自动删除云资源。
3. 不提交 `data/terraform`、`terraform.tfstate`、`terraform.tfvars`。
4. AI 不直接执行命令。
5. Runner 只执行白名单 StepType。
6. ECS 操作走云助手，不使用 SSH `remote-exec`。
7. 域名必须属于配置的根域。
8. Redis 密码、云效 token、AccessKey 不写入日志。
9. Terraform 输出需要过滤敏感字段。
10. 所有创建操作默认面向测试环境，不引入生产环境行为。

---

## 15. 实施计划

### 15.1 Phase 1：Terraform 基础设施接入

| # | 任务 | 文件 | 优先级 |
|---|---|---|---|
| 1 | 扩展配置：terraform / redis / dns / ssl | `src/types.ts`, `src/config/config.ts`, `src/config/local.example.json` | P0 |
| 2 | 新增 Terraform 模板 | `templates/terraform/*.hbs` | P0 |
| 3 | 新增 Terraform 渲染与执行工具 | `src/lib/terraform.ts` | P0 |
| 4 | 新增资源推导模块 | `src/ai/resourceDeriver.ts` 或 `src/lib/resourceDeriver.ts` | P0 |
| 5 | 新增 Redis db 分配 | `src/storage/redisAllocations.ts` | P1 |
| 6 | 新增 `terraformPlan` / `terraformApply` 步骤 | `src/runner/steps/terraform.ts` | P0 |
| 7 | 更新 StepType 和 schema | `src/types.ts`, `src/ai/schemas.ts` | P0 |
| 8 | 新增资源 API | `app/api/resources/derive`, `plan`, `apply` | P1 |
| 9 | UI 展示 Terraform plan/apply | `src/components/ProjectConsole.tsx` | P1 |

验证：

```bash
terraform version
terraform init
terraform validate
terraform plan
terraform apply
pnpm typecheck
pnpm build
```

### 15.2 Phase 2：AI 部署方案

| # | 任务 | 文件 | 优先级 |
|---|---|---|---|
| 1 | Codeup 仓库文件读取 | `src/lib/codeupReader.ts` | P0 |
| 2 | ProjectProfile / DeployPlan schema | `src/types.ts`, `src/ai/schemas.ts` | P0 |
| 3 | AI analyzer | `src/ai/analyzer.ts` | P0 |
| 4 | AI deploy planner | `src/ai/deployPlanner.ts` | P0 |
| 5 | API | `app/api/analyze`, `app/api/deploy-plan` | P1 |
| 6 | UI 展示和编辑方案 | `ProjectConsole.tsx` | P1 |

### 15.3 Phase 3：执行和部署

| # | 任务 | 文件 | 优先级 |
|---|---|---|---|
| 1 | Codeup 文件提交步骤 | `src/runner/steps/codeup.ts` | P0 |
| 2 | ECS 部署步骤 | `src/runner/steps/ecs.ts` | P0 |
| 3 | OSS 网站配置 | `src/runner/steps/oss.ts` | P1 |
| 4 | 健康检查 | `src/runner/steps/healthCheck.ts` | P1 |
| 5 | 动态步骤生成 | `src/ai/stepGenerator.ts` | P1 |
| 6 | 执行 UI 改造 | `ProjectConsole.tsx` | P1 |

---

## 16. 风险和缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| Terraform 未安装 | Phase 1 无法执行 | 配置发现中检测 `terraform version`，给出安装提示 |
| Provider schema 变化 | HCL 失效 | 固定 provider version，模板按实际 schema 校对 |
| 已有资源不在 state | apply 失败 | MVP 明确提示，后续提供 import |
| state 泄露 | 敏感信息泄露 | `data/terraform` gitignore，日志过滤 |
| 错误操作生产资源 | 高风险 | 域名根域校验、测试配置、无 destroy |
| AI 生成不安全脚本 | 执行风险 | 用户审核 + 白名单步骤 + 危险片段校验 |
| ECS 操作失败 | 部署中断 | 保留单步重试和实时日志 |

---

## 17. v3 最终边界

v3 的最终边界如下：

```text
Terraform：
  只管阿里云基础设施资源。

Yunxiao OpenAPI：
  管代码组、仓库、流水线、仓库文件。

AI：
  管分析和生成方案，不直接执行。

Runner：
  管执行、日志、重试、ECS 文件写入、Nginx reload、健康检查。

本地状态：
  管项目记录、运行日志、Redis db 分配、Terraform state 路径。
```

这使 v3 同时获得：

1. Terraform 的成熟资源管理能力
2. 云效 API 的 DevOps 平台集成能力
3. AI 的部署方案生成能力
4. Runner 的安全执行和可观测能力

---

**文档版本**：v3.0  
**更新日期**：2026-05-14  
**状态**：待评审
