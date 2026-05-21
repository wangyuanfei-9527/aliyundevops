# 测试环境自动化本地控制台方案

## 目标

本项目做一个本地可视化后台，用于创建和管理阿里云测试环境。用户在页面输入项目分组、项目名、项目类型、测试域名等信息后，系统生成结构化执行计划；用户确认后，后端按白名单步骤直接调用阿里云 CLI / 云效 OpenAPI 完成测试环境初始化。

本期只覆盖测试环境，不覆盖生产环境。

## 产品边界

### 要做

- 本地 Web 控制台。
- 创建云效 Codeup 代码组。
- 创建云效空白代码仓库。
- 支持选择是否自动创建云效代码组/仓库；关闭后仅检查并复用已有资源。
- 支持配置发现：用户提供云效 token 和本机阿里云账号后，系统只读发现组织、Region、RDS/ACR/ECS 候选配置。
- 前端项目创建 OSS Bucket。
- 前端项目创建测试流水线：构建并上传静态产物到 OSS。
- 后端项目创建数据库。
- 后端项目创建 ACR 镜像仓库。
- 后端项目在测试 ECS 写入部署脚本。
- 后端项目在测试 ECS 写入 Nginx 配置。
- 后端项目创建测试流水线：构建镜像、推送 ACR、触发测试 ECS 拉取并部署。
- 所有项目和执行记录保存到本地文件。
- 默认使用本地固定流程生成结构化执行计划，可选使用 OpenAI 兼容模型。

### 不做

- 不做生产环境。
- 不引入 Redis、MQ、外部数据库。
- 测试环境暂时不接入 CDN。
- 不做复杂权限系统。
- 不做多人协作。
- 不做完整资源回收平台。
- 不把 CLI 作为当前产品入口。
- 不把 MCP 协议耦合进本仓库。

CLI/MCP 如果未来需要，应作为外部适配器调用本地 HTTP API 或共享核心模块，不改变本项目“本地后台优先”的主线。

## 总体架构

```mermaid
flowchart LR
  UI["本地 Web 控制台"] --> API["Next.js API Routes"]
  API --> Planner["计划生成器"]
  Planner --> Validator["计划校验器"]
  Validator --> Runner["白名单步骤执行器"]
  Runner --> Yunxiao["云效 OpenAPI"]
  Runner --> Aliyun["阿里云 CLI / OpenAPI"]
  Runner --> ECS["ECS 云助手"]
  API --> Storage["本地 JSON 文件"]
  Runner --> Storage
```

核心原则：

- 页面是唯一当前产品入口。
- 大模型负责分析和生成结构化计划，不直接执行命令。
- 后端只执行白名单步骤，避免大模型生成任意危险操作。
- 每一步都写日志，失败后可以从日志判断卡在哪一步。
- 资源创建尽量做成幂等：已存在则复用，不重复创建。

## 技术选型

推荐使用一个最小单体应用：

- 主入口：Next.js + React 本地控制台。
- 后端：Next.js API Routes，复用 `src/ai`、`src/runner`、`src/storage`。
- 存储：本地 JSON 文件。
- 云资源调用：优先使用阿里云 CLI 和云效 OpenAPI。
- AI 调用：封装为 `planner`，输出固定 JSON schema；支持可配置 `OPENAI_BASE_URL`。
- 执行模型：同步真实执行步骤并写入日志，暂不引入队列；缺少配置或凭据时直接失败。

建议目录：

```text
aliyun-devops-tool/
  app/
    page.tsx
    api/
      plans/route.ts
      runs/route.ts
      projects/route.ts
    projects/
      [id]/
        page.tsx
  src/
    ai/
      planner.ts
      schemas.ts
    config/
      local.example.json
      local.json
    runner/
      runProject.ts
      steps/
        codeup.ts
        rds.ts
        oss.ts
        acr.ts
        flow.ts
        ecs.ts
    storage/
      projects.ts
      logs.ts
  data/
    projects.json
    runs/
  templates/
    frontend-pipeline.yml
    backend-pipeline.yml
    deploy.sh.hbs
    nginx.conf.hbs
```

## 页面设计

### 新建项目页

字段：

- 项目分组：例如 `mall`
- 项目名：例如 `order-web`
- 项目类型：`frontend` 或 `backend`
- 测试域名：例如 `order-test.example.com`
- 构建命令：可选，前端默认 `pnpm install && pnpm build`
- 构建产物目录：可选，前端默认 `dist`
- 后端服务端口：可选，默认 `18080`
- 自动创建云效代码组/仓库：默认开启；关闭后只检查已有资源，缺失时停止并提示。
- 使用 AI 生成计划：默认关闭；开启后才调用 `.env.dev` 中配置的模型。
- 发现配置：只读探测云效组织和本机阿里云账号下的资源候选。

按钮：

- 生成计划
- 执行计划

### 执行计划区域

展示：

- 将创建的代码组路径。
- 将创建的仓库路径。
- 将创建的数据库名。
- 将创建的 OSS Bucket。
- 将创建的 ACR 仓库。
- 将写入的部署路径。
- 将写入的 Nginx 配置路径。
- 将创建的云效流水线名称。
- 步骤列表和风险提示。

### 项目详情页

展示：

- 项目基本信息。
- 仓库地址。
- 流水线 ID。
- OSS Bucket。
- 数据库名。
- ACR 镜像地址。
- 测试域名。
- 执行日志。

## AI 使用方式

AI 不直接操作云资源。AI 的输入是用户表单和本地配置，输出是结构化执行计划。

本地 `.env.dev` 支持：

```bash
OPENAI_API_KEY=your-key
OPENAI_MODEL=gpt-5.4
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_API_MODE=auto
YUNXIAO_TOKEN=your-token
YUNXIAO_DOMAIN=https://openapi-rdc.aliyuncs.com
YUNXIAO_ORGANIZATION_ID=your-org-id
YUNXIAO_AUTO_CREATE_CODEUP=true
```

`OPENAI_BASE_URL` 必须可配置，以支持不同厂商的 OpenAI 兼容网关。`OPENAI_API_MODE` 默认 `auto`，可显式设为 `responses` 或 `chat_completions`。系统默认使用本地确定性计划；页面开启“使用 AI 生成计划”且配置 `OPENAI_API_KEY` 时才调用模型。

云效 Codeup 步骤按“ensure”语义执行：先检查代码组/仓库是否存在；存在则复用；不存在且 `YUNXIAO_AUTO_CREATE_CODEUP` 或页面开关为开启时，调用云效创建空白资源；不存在且开关关闭时，步骤失败并提示用户开启自动创建或手动创建。

`YUNXIAO_DOMAIN` 使用云效 OpenAPI 接入点，不能使用云效控制台页面地址。标准版一般是 `https://openapi-rdc.aliyuncs.com`。

仓库创建接口携带 `createParentPath=true`，可在创建仓库时自动补父级代码组；如果当前云效版本不支持无组织 ID 的代码组接口，代码组步骤会跳过并交给仓库步骤处理。

示例输出：

```json
{
  "project": {
    "group": "mall",
    "name": "order-web",
    "type": "frontend",
    "domain": "order-test.example.com",
    "autoCreateCodeup": true
  },
  "resources": {
    "codeGroupPath": "mall",
    "repoPath": "order-web",
    "ossBucket": "test-mall-order-web",
    "database": null,
    "acrRepository": null
  },
  "steps": [
    {
      "type": "ensureCodeGroup",
      "title": "创建或复用云效代码组",
      "params": {
        "path": "mall",
        "name": "mall",
        "autoCreate": true
      }
    },
    {
      "type": "ensureRepository",
      "title": "创建或复用云效代码仓库",
      "params": {
        "groupPath": "mall",
        "repoPath": "order-web",
        "autoCreate": true
      }
    },
    {
      "type": "ensureOssBucket",
      "title": "创建或复用前端 OSS Bucket",
      "params": {
        "bucket": "test-mall-order-web"
      }
    },
    {
      "type": "createFrontendPipeline",
      "title": "创建前端测试流水线",
      "params": {
        "name": "order-web-test",
        "buildCommand": "pnpm install && pnpm build",
        "artifactDir": "dist"
      }
    }
  ],
  "warnings": [],
  "assumptions": []
}
```

执行前必须校验：

- `steps[].type` 必须属于白名单。
- 项目名、Bucket 名、数据库名、仓库路径必须符合命名规则。
- 域名必须属于允许的根域。
- 不能包含任意 shell 命令步骤。
- 部署脚本和 Nginx 配置只能由模板渲染，AI 只能给参数和建议。

## 白名单步骤

第一期允许的步骤：

- `ensureCodeGroup`
- `ensureRepository`
- `ensureOssBucket`
- `ensureDatabase`
- `ensureAcrRepository`
- `writeDeployScript`
- `writeNginxConfig`
- `reloadNginx`
- `createFrontendPipeline`
- `createBackendPipeline`

后续新增步骤必须先加入 schema 和执行器，不能让 AI 自由发明步骤。

## 前端项目流程

输入示例：

```json
{
  "group": "mall",
  "name": "order-web",
  "type": "frontend",
  "domain": "order-test.example.com",
  "buildCommand": "pnpm install && pnpm build",
  "artifactDir": "dist"
}
```

执行流程：

1. 校验输入。
2. 生成执行计划。
3. 校验执行计划。
4. 创建或复用 Codeup 代码组。
5. 创建或复用 Codeup 仓库。
6. 创建或复用 OSS Bucket。
7. 创建云效测试流水线：
   - 拉取代码。
   - 执行构建命令。
   - 上传构建产物到 OSS。
8. 保存项目记录和执行日志。

说明：

- 测试环境暂时不使用 CDN。
- HTTPS 暂不强制处理，避免拖慢 MVP。
- 如果必须使用自定义域名访问 OSS，需要再补 DNS CNAME 和 OSS 域名绑定能力。

## 后端项目流程

输入示例：

```json
{
  "group": "mall",
  "name": "order-api",
  "type": "backend",
  "domain": "order-api-test.example.com",
  "servicePort": 18080
}
```

执行流程：

1. 校验输入。
2. 生成执行计划。
3. 校验执行计划。
4. 创建或复用 Codeup 代码组。
5. 创建或复用 Codeup 仓库。
6. 在指定 RDS 实例创建或复用数据库。
7. 创建或复用 ACR 镜像仓库。
8. 通过 ECS 云助手在测试服务器创建应用目录：

```text
/opt/apps/order-api/
  deploy.sh
  docker-compose.yml
```

9. 写入 Nginx 配置：

```text
/etc/nginx/conf.d/order-api.conf
```

10. 执行 `nginx -t`。
11. `nginx -t` 成功后执行 `systemctl reload nginx`。
12. 创建云效测试流水线：
    - 拉取代码。
    - Docker build。
    - Push 到 ACR。
    - 通过 ECS 云助手执行 `/opt/apps/order-api/deploy.sh`。
13. 保存项目记录和执行日志。

## 本地配置

使用 `src/config/local.json` 保存非密钥运行配置，使用 `.env.dev` 保存本地密钥和模型供应商配置。

示例：

```json
{
  "aliyun": {
    "region": "cn-hangzhou",
    "profile": "default"
  },
  "yunxiao": {
    "domain": "https://openapi-rdc.aliyuncs.com",
    "organizationId": "your-org-id",
    "tokenEnv": "YUNXIAO_TOKEN"
  },
  "rds": {
    "instanceId": "your-rds-instance-id",
    "defaultCharset": "utf8mb4"
  },
  "acr": {
    "instanceId": "your-acr-instance-id",
    "namespace": "test"
  },
  "ecs": {
    "testInstanceId": "your-test-ecs-instance-id",
    "appRoot": "/opt/apps",
    "nginxConfDir": "/etc/nginx/conf.d"
  },
  "domain": {
    "allowedRoot": "example.com"
  },
  "ai": {
    "model": "gpt-5.4",
    "baseUrl": "https://api.openai.com/v1",
    "apiMode": "auto"
  }
}
```

敏感信息不要写入仓库：

- 阿里云 AccessKey。
- 云效个人访问令牌。
- 数据库账号密码。
- ACR 登录密码。
- 模型 API Key。

这些值优先从环境变量读取。

## 本地数据结构

`data/projects.json`：

```json
[
  {
    "id": "20260429-mall-order-web",
    "group": "mall",
    "name": "order-web",
    "type": "frontend",
    "domain": "order-test.example.com",
    "status": "created",
    "resources": {
      "repoUrl": "https://codeup.aliyun.com/example/order-web.git",
      "ossBucket": "test-mall-order-web",
      "pipelineId": "12345"
    },
    "createdAt": "2026-04-29T15:30:00+08:00",
    "updatedAt": "2026-04-29T15:35:00+08:00"
  }
]
```

`data/runs/{runId}.jsonl`：

```jsonl
{"time":"2026-04-29T15:31:00+08:00","level":"info","step":"ensureCodeGroup","message":"start"}
{"time":"2026-04-29T15:31:02+08:00","level":"info","step":"ensureCodeGroup","message":"group exists, reuse"}
{"time":"2026-04-29T15:31:03+08:00","level":"info","step":"ensureRepository","message":"created repository"}
```

## 命名规则

- 代码组：`{group}`
- 仓库：`{projectName}`
- 前端 OSS Bucket：`test-{group}-{projectName}-{hash}`
- 数据库：`test_{group}_{projectName}`，将 `-` 转换为 `_`
- ACR 仓库：`{group}/{projectName}`
- 流水线：`{projectName}-test`
- ECS 应用目录：`/opt/apps/{projectName}`
- Nginx 配置：`/etc/nginx/conf.d/{projectName}.conf`

命名限制：

- 项目名只允许小写字母、数字、短横线。
- 数据库名只允许小写字母、数字、下划线。
- Bucket 名必须全局唯一，必要时追加短 hash。
- 域名必须属于配置中的根域。

## 错误处理

每个步骤返回统一结果：

```json
{
  "step": "ensureRepository",
  "status": "success",
  "resourceId": "12345",
  "message": "repository created"
}
```

失败结果：

```json
{
  "step": "ensureRepository",
  "status": "failed",
  "message": "token has no repository write permission"
}
```

失败后策略：

- 默认停止后续步骤。
- 已创建资源先不自动删除，避免误删。
- 后续通过幂等逻辑重跑。
- 页面展示失败步骤和原始错误摘要。

## MVP 实现顺序

### 第一阶段：前端项目闭环

目标：输入前端项目信息后，可以创建仓库、OSS Bucket 和前端测试流水线。

任务：

1. 搭建 Next.js 本地控制台。
2. 实现本地配置读取。
3. 实现本地 JSON 存储。
4. 实现新建项目表单。
5. 实现计划生成和 schema 校验。
6. 实现 Codeup 代码组和仓库步骤。
7. 实现 OSS Bucket 步骤。
8. 实现前端流水线 YAML 生成和创建。
9. 实现执行日志页面。

### 第二阶段：后端项目闭环

目标：输入后端项目信息后，可以创建仓库、数据库、ACR 仓库、测试服务器部署脚本、Nginx 配置和后端流水线。

任务：

1. 实现 RDS 数据库步骤。
2. 实现 ACR 仓库步骤。
3. 实现 ECS 云助手执行步骤。
4. 实现部署脚本模板。
5. 实现 Nginx 配置模板。
6. 实现后端流水线 YAML 生成和创建。
7. 增加 `nginx -t` 校验和 reload。

### 第三阶段：可用性增强

目标：减少失败成本，提高日常使用效率。

任务：

1. 增加资源存在性检查。
2. 增加失败重试。
3. 增加项目详情页。
4. 增加执行计划 diff。
5. 增加导入已有项目。
6. 增加配置检查页。

## 验收标准

前端项目 MVP 验收：

- 可以通过页面输入项目信息。
- 可以生成可读的执行计划。
- 可以创建或复用云效代码组。
- 可以创建云效仓库。
- 可以创建 OSS Bucket。
- 可以创建云效前端测试流水线。
- 可以在本地文件看到项目记录和执行日志。

后端项目 MVP 验收：

- 可以创建或复用云效代码组。
- 可以创建云效仓库。
- 可以创建数据库。
- 可以创建 ACR 仓库。
- 可以在测试 ECS 写入部署脚本。
- 可以在测试 ECS 写入 Nginx 配置。
- 可以通过 `nginx -t` 后 reload。
- 可以创建云效后端测试流水线。
- 可以在本地文件看到项目记录和执行日志。

## 重要约束

- 不允许 AI 直接输出任意命令并执行。
- 不允许页面传入任意 shell 并执行。
- 不允许自动删除云资源。
- 不允许将密钥写入本地项目记录。
- 不允许跳过执行日志。
- 不允许生产环境逻辑混入本期 MVP。
- 不允许把 MCP 或 CLI 适配逻辑提前塞进主应用。

## 后续可能扩展

- 支持生产环境审批。
- 支持 CDN 和 HTTPS。
- 支持更多技术栈模板。
- 支持资源回收。
- 支持接入 Terraform 或 ROS。
- 支持多人使用和登录权限。
- 支持任务后台执行和通知。
- 通过外部适配器接入 CLI 或 MCP。
