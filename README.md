# Aliyun DevOps Automation

本地 Web 控制台，用于阿里云测试环境的一键资源准备、AI 部署方案生成和分步执行。

## 核心架构

项目按职责严格分层，每层只做自己的事：

| 层 | 职责 | 技术手段 |
|---|---|---|
| 资源准备 | 校验输入、推导资源、创建云效对象、Terraform 管理 | 确定性规则 + Yunxiao API + Terraform |
| AI 分析 | 读取仓库代码，生成部署方案 | OpenAI-compatible API |
| 执行 Runner | 白名单步骤执行、实时日志、失败停止、单步重试 | 本项目 Runner + 阿里云云助手 |
| 本地状态 | 项目记录、运行日志、Redis db 分配、Terraform state | 本地 JSON / JSONL |

Terraform 负责声明式长期资源（OSS Bucket、RDS Database、ACR EE Repository、DNS Record），云效 API 负责代码组/仓库/流水线，AI 只生成可审核的部署方案，Runner 只执行白名单步骤。

详细设计见 `docs/` 目录。

## 当前状态

项目已完成工程基础设施搭建（A0），包括：

- Next.js + TypeScript 项目骨架
- Vitest 测试框架（unit / integration / fixtures 三级目录）
- ESLint flat config
- 统一验证命令 `pnpm verify`
- API route 占位（全部返回 501）
- 最小首页

业务模块尚未填充，后续将按 `docs/ai-autonomous-implementation-plan.md` 中的里程碑逐步实现。

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
pnpm test:integration  # 集成测试
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
  config/       # 配置加载与发现
  lib/          # 通用工具（命名、模板渲染、云效适配等）
  storage/      # 项目记录、日志、Redis db 分配
  types.ts      # 全局类型定义

templates/
  terraform/    # HCL 模板
  *.hbs, *.yml  # 部署脚本、docker-compose、Nginx、流水线模板

tests/
  unit/         # 单元测试
  integration/  # 集成测试
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

- AI 只生成结构化方案，不直接执行任意 shell。
- Runner 只接受 `src/ai/schemas.ts` 中声明的白名单步骤。
- Terraform 不提供 destroy，不自动删除云资源。
- 不记录密钥、token、AccessKey、密码或完整连接串。
- 所有创建操作默认面向测试环境，不引入生产环境行为。
- 缺少真实配置或凭据时直接失败，不返回模拟成功。

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
