# DevOps Automation v3 技术落地方案

## 1. 目标定位

本项目重建为一个本地 Web 控制台，用于阿里云测试环境的一键准备、部署方案生成和分步执行。

核心原则：

- 基础设施资源由 Terraform 管理。
- 云效相关对象由 Yunxiao / Codeup / Flow OpenAPI 管理。
- AI 只负责仓库分析和部署方案生成，不直接执行。
- Runner 只执行白名单过程性步骤。
- 本地状态负责项目记录、运行日志、Redis db 分配和 Terraform state 路径。
- 不提供模拟成功路径，不自动删除云资源，不引入生产环境行为。

## 2. 分层架构

```text
Web Console / API
        |
        v
Resource Preparation 资源准备
        |
        v
AI Analysis & Deploy Planning
        |
        v
Execution Runner
        |
        v
Storage / Logs / Terraform State
```

### 2.1 资源准备层

职责：

- 校验用户输入。
- 根据确定性规则推导资源名称。
- 创建或复用云效代码组、代码仓库。
- 分配 Redis db 编号。
- 渲染 Terraform 工作目录。
- 执行 `terraform init`、`terraform plan`、`terraform apply`。
- 输出 `ResourceManifest`。

不使用 AI。

### 2.2 Terraform 层

Terraform 负责长期存在、声明式、Provider 支持的基础资源：

- OSS Bucket。
- OSS Bucket ACL / Website 配置，具体位置可按 MVP 决定。
- RDS Database。
- ACR EE Repository。
- DNS 解析记录。

Terraform 不负责：

- 云效代码组。
- 云效代码仓库。
- 云效流水线。
- 仓库文件提交。
- ECS 文件写入。
- Docker 容器启动。
- Nginx reload。
- 健康检查。
- Redis db 编号分配。

### 2.3 AI 层

AI 分两段：

1. Analyzer：读取仓库关键文件，输出 `ProjectProfile`。
2. Deploy Planner：基于 `ResourceManifest` 和 `ProjectProfile` 输出 `DeployPlan`。

AI 输出必须结构化、可校验、可预览。AI 不允许直接生成可执行自由 shell step。

### 2.4 Runner 层

Runner 只执行部署过程性动作：

- 提交 Dockerfile / docker-compose / deploy.sh / 构建配置到 Codeup。
- 写入 ECS 部署脚本。
- 部署到 ECS。
- 写入 Nginx 配置。
- reload Nginx。
- 配置 OSS 静态网站。
- 健康检查。
- 创建云效流水线。

Runner 必须：

- 使用白名单 StepType。
- 记录实时日志。
- 失败即停止。
- 支持单步重试。
- 不创建 Terraform 应管理的基础资源。

### 2.5 状态层

本地状态负责：

- 项目记录。
- 执行日志。
- Redis db 分配。
- Terraform state 路径。

安全要求：

- 不记录 token、AccessKey、密码或完整环境变量。
- `data/terraform`、`terraform.tfstate`、`terraform.tfvars` 必须被 git ignore。
- MVP 不实现 destroy。

## 3. 核心数据模型

### 3.1 ProjectInput

```ts
interface ProjectInput {
  group: string;
  name: string;
  type: "frontend" | "backend";
  domain: string;
  servicePort?: number;
}
```

### 3.2 ResourcePlan

```ts
interface ResourcePlan {
  project: ProjectInput;
  derived: DerivedResources;
  terraform: TerraformPlanInfo;
  warnings: string[];
}
```

`ResourcePlan` 来源于确定性资源推导，不使用 AI。

### 3.3 ResourceManifest

```ts
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
    status: "managed" | "skipped";
    name: string;
  };

  database?: {
    status: "managed" | "skipped";
    name: string;
    instanceId: string;
  };

  acrRepository?: {
    status: "managed" | "skipped";
    instanceId: string;
    namespace: string;
    name: string;
  };

  dnsRecord: {
    status: "managed";
    domain: string;
    type: "A" | "CNAME";
    target: string;
  };

  redis?: RedisAllocation;

  deployPath?: string;
  nginxConfPath?: string;
}
```

### 3.4 ProjectProfile

```ts
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

### 3.5 DeployPlan

```ts
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

  steps: PlanStep[];

  reasoning: string;
  assumptions: string[];
  warnings: string[];
  manualSteps: string[];
}
```

## 4. API 设计

### 4.1 `POST /api/resources/derive`

只做确定性资源推导，不访问云，不创建资源。

### 4.2 `POST /api/resources/plan`

执行资源准备预览：

1. 校验输入。
2. ensure 云效代码组。
3. ensure 云效仓库。
4. 分配 Redis db，如果需要。
5. 渲染 Terraform。
6. `terraform init`。
7. `terraform plan`。
8. 返回 plan 输出和摘要。

不执行 apply。

### 4.3 `POST /api/resources/apply`

用户确认后执行：

1. `terraform apply`。
2. `terraform output`。
3. 生成 `ResourceManifest`。
4. 写入项目记录。

### 4.4 `POST /api/analyze`

读取 Codeup 仓库关键文件，AI 生成 `ProjectProfile`。

### 4.5 `POST /api/deploy-plan`

基于 `ResourceManifest` 和 `ProjectProfile` 生成 `DeployPlan`。

### 4.6 `POST /api/runs`

执行用户确认后的完整部署步骤列表。

### 4.7 `POST /api/runs/step`

执行单个部署步骤，用于失败重试。

## 5. 目标目录结构

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
  resources/
    derive.ts
    prepare.ts
    manifest.ts

  terraform/
    render.ts
    executor.ts
    parser.ts

  ai/
    analyzer.ts
    deployPlanner.ts
    schemas.ts

  runner/
    runProject.ts
    stepRegistry.ts
    steps/
      codeup.ts
      ecs.ts
      oss.ts
      flow.ts
      healthCheck.ts

  config/
    config.ts
    discovery.ts
    local.example.json

  lib/
    names.ts
    renderTemplate.ts
    yunxiao.ts
    codeupReader.ts
    commands.ts

  storage/
    projects.ts
    logs.ts
    redisAllocations.ts

  types.ts

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

## 6. 建设里程碑

### Milestone 1：基础设施层

- 新增配置结构。
- 新增 Terraform 模板。
- 新增资源推导模块。
- 新增 Terraform 渲染与执行模块。
- 新增 Redis db 分配。
- 新增 resources API。
- UI 展示 Terraform plan/apply。

### Milestone 2：Runner 重塑

- Runner 输入迁移为 `DeployPlan`。
- 新增 Codeup 文件提交步骤。
- 新增 ECS 部署步骤。
- 新增 OSS 网站配置步骤。
- 新增健康检查步骤。
- 旧资源创建 step 仅作为 legacy 兼容，v3 新流程不再使用。

### Milestone 3：AI 分析与部署方案

- 新增 Codeup 仓库读取。
- 新增 `ProjectProfile` / `DeployPlan` schema。
- 新增 AI Analyzer。
- 新增 AI Deploy Planner。
- API 输出必须经过 schema 校验。

### Milestone 4：Web Console 向导化

页面流程改为：

1. 填写项目信息。
2. 资源推导。
3. Terraform Plan。
4. Apply 资源。
5. AI 分析仓库。
6. 生成部署方案。
7. 用户确认文件和步骤。
8. 执行部署。
9. 查看结果和日志。

## 7. 最终边界

```text
Terraform：
  只管阿里云基础设施资源。

Yunxiao OpenAPI：
  管代码组、仓库、流水线、仓库文件。

AI：
  管分析和生成方案，不直接执行。

Runner：
  管部署执行、日志、重试、ECS 文件写入、Nginx reload、健康检查。

本地状态：
  管项目记录、运行日志、Redis db 分配、Terraform state 路径。
```
