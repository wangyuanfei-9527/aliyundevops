# Aliyun DevOps Automation

本地 Web 控制台，用于阿里云测试环境的一键资源准备、AI 部署方案生成和分步执行。

## 核心架构

项目采用三阶段流水线架构，每阶段职责明确：

```text
┌──────────────────────────────────────────────────────────┐
│ 阶段 1：资源准备                                            │
│ 输入：group + name + type + domain                         │
│ 处理：规则推导 → 云效 ensure → Terraform plan/apply         │
│ 输出：ResourceManifest                                      │
└──────────────────────────┬───────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────┐
│ 阶段 2：AI 部署方案                                         │
│ 输入：仓库代码 + ResourceManifest                           │
│ 处理：AI 读取代码 → ProjectProfile → DeployPlan             │
│ 输出：Dockerfile / deploy.sh / Nginx / Pipeline YAML       │
└──────────────────────────┬───────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────┐
│ 阶段 3：分步执行                                            │
│ 输入：用户确认后的 DeployPlan                                │
│ 处理：白名单步骤执行、实时日志、失败停止、单步重试             │
│ 输出：部署结果、运行日志                                     │
└──────────────────────────────────────────────────────────┘
```

| 层 | 职责 | 技术手段 |
|---|---|---|
| 资源准备 | 校验输入、推导资源、创建云效对象、Terraform 管理 | 确定性规则 + Yunxiao API + Terraform |
| AI 分析 | 读取仓库代码，生成 ProjectProfile 和 DeployPlan | OpenAI-compatible API (结构化 JSON 输出) |
| 执行 Runner | 白名单步骤执行、实时日志、失败停止、单步重试 | 17 种 StepType + ECS 云助手 + OSS 适配 |
| 本地状态 | 项目记录、运行日志、Redis db 分配、Terraform state | 原子写 JSON / JSONL |

Terraform 负责声明式长期资源（OSS Bucket、RDS Database、ACR EE Repository、DNS Record），云效 API 负责代码组/仓库/流水线，AI 只生成可审核的部署方案，Runner 只执行白名单步骤。

详细设计见 `docs/devops-automation-v3.md`。

## 当前状态

项目已完成全部模块实现（A0–A11），包括：

| 模块 | 内容 | 关键文件 |
|---|---|---|
| A0 工程基础 | Next.js + TypeScript 骨架、Vitest、ESLint | `package.json`, `vitest.config.ts` |
| A1 类型与 Schema | 全局类型定义、Zod 校验 schema、17 种 StepType 白名单 | `src/types.ts`, `src/ai/schemas.ts` |
| A2 安全工具 | 日志脱敏（8 条规则）、路径安全、安全命令执行 | `src/lib/redact.ts`, `src/lib/paths.ts`, `src/lib/commands.ts` |
| A3 资源推导 | 确定性资源名推导、ResourceManifest 组装 | `src/resources/derive.ts`, `src/resources/manifest.ts` |
| A4 Terraform | 模板渲染、init/plan/apply 执行、输出解析 | `src/terraform/executor.ts`, `src/terraform/renderer.ts` |
| A5 存储 | 项目 CRUD、运行日志 JSONL、Redis db 分配（原子写） | `src/storage/projects.ts`, `src/storage/logs.ts` |
| A6 云效适配 | IYunxiaoAdapter 接口、HTTP 实现、内存 Mock | `src/lib/yunxiao.ts` |
| A7 AI | LLM Provider、仓库分析器、部署方案生成器 | `src/ai/llmProvider.ts`, `src/ai/analyzer.ts`, `src/ai/planner.ts` |
| A8 Runner | StepRegistry、17 个步骤执行器、runProject 编排 | `src/runner/runProject.ts`, `src/runner/stepRegistry.ts` |
| A9 API | 7 个 POST 路由处理器（derive/plan/apply/analyze/deploy-plan/runs/runs/step） | `app/api/` |
| A10 UI | 向导式控制台（8 步流程）、CSS 设计系统 | `app/page.tsx`, `src/components/ProjectConsole.tsx` |
| A11 QA | 安全回归测试、Mock 端到端集成测试 | `tests/integration/` |

测试覆盖：370+ 测试用例，覆盖单元/集成/安全回归三个层级。

## 安装和启动

```bash
pnpm install
pnpm dev
```

默认访问 http://127.0.0.1:3000

## 验证

```bash
pnpm verify
```

该命令串联执行 lint、typecheck、test、build。

也可单独运行：

```bash
pnpm lint          # ESLint 检查
pnpm typecheck     # TypeScript 类型检查
pnpm test          # 运行全部测试
pnpm test:unit     # 单元测试
pnpm test:integration  # 集成测试（含安全回归 + Mock E2E）
pnpm test:fixtures     # Fixture 测试
pnpm build         # Next.js 生产构建
```

## 项目结构

```text
app/
  layout.tsx, page.tsx, globals.css       # 前端页面
  api/
    resources/derive|plan|apply/route.ts  # 资源准备 API
    analyze/route.ts                      # AI 分析 API
    deploy-plan/route.ts                  # 部署方案 API
    runs/route.ts, runs/step/route.ts     # 执行 API

src/
  resources/    # 资源推导与 ResourceManifest 组装
  terraform/    # Terraform 模板渲染、执行、输出解析
  ai/           # AI 分析器、部署方案生成器、schema 校验
  runner/       # 白名单步骤注册与执行编排
    steps/      # 17 个步骤执行器（codeup/ecs/oss/flow/acr/rds）
  config/       # 配置加载（环境变量 + local.json）
  lib/          # 通用工具（命名、路径安全、日志脱敏、云效适配等）
  storage/      # 项目记录、日志、Redis db 分配
  types.ts      # 全局类型定义（17 种 StepType 白名单）
  components/   # React 组件（ProjectConsole）

templates/
  terraform/    # HCL 模板
  *.hbs, *.yml  # 部署脚本、docker-compose、Nginx、流水线模板

tests/
  unit/         # 单元测试
  integration/  # 集成测试（安全回归 + Mock E2E）
  fixtures/     # Fixture 测试

docs/           # 设计文档
data/           # 运行时数据（gitignore）
```

## 配置

运行配置示例：

```bash
cp src/config/local.example.json src/config/local.json
```

环境变量示例：

```bash
cp .env.dev.example .env.dev
```

密钥不要写入版本库。`src/config/local.json` 已被 `.gitignore` 排除。

## 安全边界

- **白名单步骤**：Runner 只接受 `STEP_TYPES` 中声明的 17 种步骤类型，任意 shell 执行被拒绝。
- **授权门控**：terraform apply 和部署执行需要请求体显式传入 `authorized: true`。
- **日志脱敏**：所有日志写入前经过 8 条正则规则过滤（AccessKey、密码、Token、连接串等）。
- **路径安全**：所有文件路径经过 traversal 检测，文件名经过 sanitize。
- **不删除资源**：Terraform 不提供 destroy，不自动删除云资源。
- **不记录密钥**：不保存 AccessKey、Token、密码或完整数据库连接串。
- **不模拟成功**：缺少真实配置或凭据时直接失败。

## Runner 步骤类型（17 种）

| 阶段 | 步骤类型 |
|---|---|
| 云效资源 | `ensureCodeGroup`, `ensureRepository` |
| Terraform | `terraformInit`, `terraformPlan`, `terraformApply` |
| 代码提交 | `commitDockerfile`, `commitDockerCompose`, `commitDeployScript`, `commitBuildConfig` |
| ECS 部署 | `writeDeployScript`, `deployToEcs`, `writeNginxConfig`, `reloadNginx` |
| OSS / 健康检查 | `configureOssWebsite`, `healthCheck` |
| 流水线 | `createFrontendPipeline`, `createBackendPipeline` |

## 多 AI 协作

本项目采用多 AI 协同开发，协作规范见 `AGENTS.md`。每个 AI 领取独立任务，只修改指定文件范围，完成后必须运行验证并输出交付报告。

## 技术栈

- Next.js 15 (App Router)
- TypeScript (strict)
- Vitest + Testing Library
- ESLint (flat config)
- Terraform + alicloud provider
- 阿里云（RDS、OSS、ACR EE、ECS、DNS）
- 云效（Codeup、Flow）
- OpenAI-compatible API
