# AI 全自动开发、测试、验证实施计划

本文档用于指导多个 AI Coding Agent 协同向当前空项目架构中填充代码。目标是让 AI 尽可能自动完成开发、测试和验证，人类只负责阶段性审核结果。

## 1. 总体原则

### 1.1 先建验证系统，再写业务代码

本项目涉及云资源、Terraform、云效 API、AI 生成部署方案和 Runner 执行。为了保证安全，开发顺序必须是：

```text
工程基础设施 -> 类型与 schema -> 安全工具 -> mock/fixture -> 业务模块 -> API/UI -> 真实集成开关
```

禁止一开始就接真实云资源。

### 1.2 所有真实副作用默认关闭

默认开发环境只允许：

- 读写本地 fixture。
- 运行单元测试。
- 运行本地 mock API。
- 渲染 Terraform 文件。
- 执行不触达云资源的校验。

默认不允许：

- `terraform apply`。
- 修改真实阿里云资源。
- 修改真实云效资源。
- 执行真实 ECS 云助手命令。
- 向真实 OSS/RDS/ACR 写入。

### 1.3 每个阶段必须可验证

每个 Agent 的输出必须包含：

- 改了什么。
- 为什么这样改。
- 运行了什么验证。
- 验证结果是什么。
- 还有什么风险。

没有验证证据的任务不进入下一阶段。

## 2. 自动化开发流水线设计

建议建立以下本地命令作为 AI 的统一验证入口。

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:unit
pnpm test:integration
pnpm test:fixtures
pnpm build
pnpm verify
```

其中：

- `pnpm verify` 应串联 lint、typecheck、test、build。
- `test:fixtures` 用于验证 Terraform 模板、AI 输出样例、Runner step 白名单。
- 所有测试默认不访问真实云资源。

后续可增加：

```bash
pnpm security:scan
pnpm test:e2e
pnpm terraform:fmt
pnpm terraform:validate-fixtures
```

## 3. 环境分级

### 3.1 local-safe 默认环境

用途：AI 日常开发和验证。

特征：

- 不需要真实密钥。
- 不访问真实云资源。
- 所有外部 API 使用 mock adapter。
- Terraform 只渲染到临时目录或 fixture 目录。
- Runner 使用 fake executor。

### 3.2 local-dry-run 环境

用途：人工授权后的本地 dry-run。

特征：

- 可以读取真实配置。
- 可以执行只读发现。
- 可以执行 Terraform fmt/validate。
- 不允许 apply。

### 3.3 test-live 环境

用途：人工审核通过后的真实测试环境验证。

特征：

- 必须由人类明确授权。
- 只能使用测试账号、测试域名、测试实例。
- 每次真实变更前必须输出将要执行的动作。
- 所有创建动作必须可追踪、有日志、有资源命名保护。

AI 默认不得进入该环境。

## 4. 安全闸门

### 4.1 代码级闸门

必须实现：

- StepType 白名单校验。
- schema runtime validation。
- 命令参数数组执行，禁止 shell 字符串拼接。
- 日志脱敏。
- 路径穿越防护。
- Terraform destroy 缺省不可用。
- apply/import 必须显式授权。

### 4.2 流程级闸门

以下动作必须有用户确认：

- 真实 Terraform plan。
- Terraform apply。
- Terraform import。
- 调云效创建仓库/流水线。
- 提交文件到真实 Codeup。
- 执行 ECS 云助手命令。
- 配置 OSS website。
- 创建或修改 DNS。

### 4.3 测试级闸门

必须有自动测试覆盖：

- 输入校验。
- 资源命名规则。
- 域名根域校验。
- Redis db 分配冲突。
- Terraform plan output parser。
- AI 输出 schema 校验。
- Runner 遇到失败停止。
- 日志脱敏。
- 命令执行超时。

## 5. 多 Agent 任务分工

### A0 Foundation Agent：工程基础

文件范围：

- `package.json`
- `pnpm-lock.yaml`
- `tsconfig.json`
- `vitest.config.ts`
- `eslint.config.*`
- `app/` 最小 Next.js 启动文件，如需要
- `src/` 测试辅助目录，如需要

目标：

- 建立 TypeScript / Next.js / Vitest / ESLint 基础。
- 建立 `pnpm verify`。
- 建立测试目录和 fixture 约定。

验证：

- `pnpm install`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `pnpm verify`

注意：

- 不写业务代码。
- 不接云资源。

### A1 Types & Schema Agent：核心类型和校验

文件范围：

- `src/types.ts`
- `src/ai/schemas.ts`
- `src/**/__tests__/*` 或 `tests/unit/*`

目标：

- 定义 `ProjectInput`、`ResourcePlan`、`ResourceManifest`、`ProjectProfile`、`DeployPlan`、`PlanStep`、`StepType`。
- 使用 zod 或等价工具实现 runtime schema。
- 建立 StepType 白名单。

验证：

- schema 正例/反例测试。
- StepType 非法值拒绝测试。

### A2 Security Utilities Agent：安全基础工具

文件范围：

- `src/lib/commands.ts`
- `src/lib/paths.ts`，如需要
- `src/lib/redact.ts`，如需要
- 测试文件

目标：

- 实现安全命令执行 wrapper。
- 实现日志脱敏。
- 实现路径安全工具。
- 实现 timeout、exitCode、stdout、stderr 捕获。

验证：

- 参数数组执行测试。
- timeout 测试。
- 脱敏测试。
- 路径穿越拒绝测试。

### A3 Resource Agent：资源推导和 Manifest

文件范围：

- `src/resources/derive.ts`
- `src/resources/manifest.ts`
- `src/lib/names.ts`
- 测试文件

目标：

- 实现确定性资源命名。
- 校验 group/name/domain/type/servicePort。
- 生成 `DerivedResources`。
- 生成或合成 `ResourceManifest`。

验证：

- 前端资源推导测试。
- 后端资源推导测试。
- 域名不属于 allowed root 时失败。
- 非法名称失败。

### A4 Terraform Agent：Terraform 模板和执行器

文件范围：

- `templates/terraform/*`
- `src/terraform/render.ts`
- `src/terraform/executor.ts`
- `src/terraform/parser.ts`
- `src/lib/renderTemplate.ts`
- 测试文件和 fixtures

目标：

- 完成 Terraform 模板。
- 实现模板渲染。
- 实现 `init`、`plan`、`apply`、`output` wrapper，但 apply 需要授权参数。
- 实现 plan summary parser。
- 不实现 destroy。

验证：

- 模板渲染 snapshot。
- parser 正例/反例。
- apply 未授权时报错。
- 不存在 destroy API。

### A5 Storage Agent：本地状态

文件范围：

- `src/storage/projects.ts`
- `src/storage/logs.ts`
- `src/storage/redisAllocations.ts`
- 测试文件

目标：

- 实现项目记录读写。
- 实现 JSONL 日志追加。
- 实现 Redis db 分配。
- 实现原子写或锁。

验证：

- 写读一致性。
- 并发分配不重复。
- 日志脱敏。
- 损坏 JSON 的错误提示。

### A6 Yunxiao / Codeup Adapter Agent：云效适配器

文件范围：

- `src/lib/yunxiao.ts`
- `src/lib/codeupReader.ts`
- 测试文件

目标：

- 实现接口抽象和 mock adapter。
- 真实 adapter 只封装请求，不在测试中访问外部服务。
- 支持读取仓库关键文件。
- 支持 ensure group/repository 的接口定义。

验证：

- mock adapter 测试。
- 错误响应解析测试。
- token 不出现在日志中。

### A7 AI Agent：仓库分析与部署方案生成

文件范围：

- `src/ai/analyzer.ts`
- `src/ai/deployPlanner.ts`
- `src/ai/schemas.ts`
- prompt fixture / 测试文件

目标：

- 实现 analyzer 输入组装。
- 实现 deploy planner 输入组装。
- 接模型输出后必须 schema 校验。
- 为模型输出提供 deterministic fixture 测试。

验证：

- AI fixture 输出通过 schema。
- 非法 StepType 被拒绝。
- secret 不能出现在 generated env variables 明文中。

### A8 Runner Agent：部署执行器

文件范围：

- `src/runner/runProject.ts`
- `src/runner/stepRegistry.ts`
- `src/runner/steps/*`
- 测试文件

目标：

- 实现 Runner 编排。
- 实现 step registry。
- 实现 fake executor 下的步骤。
- 真实执行代码必须被 adapter 和授权开关隔离。

验证：

- 成功顺序执行。
- 失败停止。
- 单步重试。
- 未知 step 拒绝。
- 不允许任意 shell step。

### A9 API Agent：HTTP API

文件范围：

- `app/api/resources/*/route.ts`
- `app/api/analyze/route.ts`
- `app/api/deploy-plan/route.ts`
- `app/api/runs/route.ts`
- `app/api/runs/step/route.ts`
- 测试文件

目标：

- API handler 调用各层 service。
- 输入输出都经过 schema 校验。
- 错误响应结构统一。
- 默认使用 local-safe 行为。

验证：

- handler 单元测试。
- 非法输入 400。
- 未授权真实动作 403。

### A10 UI Agent：Web Console

文件范围：

- `app/page.tsx`
- `app/layout.tsx`
- `app/globals.css`
- `src/components/*`
- 测试文件

目标：

- 实现向导式 UI：填写项目信息、资源推导、Terraform plan、apply、AI 分析、部署方案、执行、日志。
- 所有真实动作前显示确认。
- 展示 plan、manifest、DeployPlan、日志。

验证：

- 组件测试。
- Playwright 本地 mock E2E。
- 不依赖真实云资源。

### A11 QA Agent：端到端验证与安全审计

文件范围：

- `tests/**`
- `fixtures/**`
- `scripts/**`
- 文档中的验证清单

目标：

- 建立综合测试矩阵。
- 建立安全回归用例。
- 建立 mock E2E。
- 建立发布前 checklist。

验证：

- `pnpm verify`
- mock E2E 通过。
- 安全用例通过。

## 6. 推荐实施顺序

```text
Phase 0: AGENTS.md + 实施计划
Phase 1: A0 Foundation
Phase 2: A1 Types & Schema + A2 Security Utilities
Phase 3: A3 Resource + A5 Storage
Phase 4: A4 Terraform
Phase 5: A6 Yunxiao/Codeup Adapter
Phase 6: A7 AI
Phase 7: A8 Runner
Phase 8: A9 API
Phase 9: A10 UI
Phase 10: A11 QA hardening
```

并行建议：

- A1 和 A2 可并行。
- A3 和 A5 可并行，但都依赖 A1。
- A4 依赖 A1、A2、A3。
- A6 可在 A1 后并行。
- A7 依赖 A1、A6。
- A8 依赖 A1、A2、A5。
- A9 依赖各 service 基本完成。
- A10 依赖 A9 的 API contract。
- A11 持续参与，但最终阶段集中收口。

## 7. 任务包模板

给每个 AI 分发任务时，建议使用以下模板：

```markdown
# 任务编号

A?

# 任务名称


# 必读文档

- AGENTS.md
- docs/devops-automation-v3-implementation.md
- docs/ai-autonomous-implementation-plan.md

# 文件范围

允许修改：

- 

禁止修改：

- 

# 目标


# 验收标准

- 

# 必须运行的验证

- 

# 安全限制

- 不访问真实云资源。
- 不执行 terraform apply/destroy/import。
- 不记录密钥。
- 不新增任意 shell 执行入口。
```

## 8. AI 自检清单

每个 AI 在提交前必须自检：

- [ ] 是否读过 `AGENTS.md`？
- [ ] 是否只修改了允许范围内的文件？
- [ ] 是否补充了测试？
- [ ] 是否运行了指定验证？
- [ ] 是否没有真实云资源副作用？
- [ ] 是否没有密钥泄露？
- [ ] 是否没有绕过 schema 校验？
- [ ] 是否没有任意 shell 执行入口？
- [ ] 是否输出了交付报告？

## 9. 人类审核方式

人类审核不逐行替 AI 查错，而是看以下结果：

1. 任务范围是否清晰。
2. 文件变更是否越界。
3. 验证命令是否真实运行。
4. 自动化测试是否覆盖风险点。
5. 安全检查是否通过。
6. 是否有未说明的真实副作用。
7. 多 Agent 之间是否产生接口冲突。

## 10. 第一批任务建议

建议从以下三个任务开始：

### A0-1 工程基础设施

目标：建立 package、TypeScript、Vitest、ESLint、基础 Next.js 构建和 `pnpm verify`。

这是所有后续 AI 的基础，必须最先完成。

### A1-1 核心类型与 schema

目标：定义项目核心类型和 zod schema，锁定跨模块 contract。

A0 完成后立刻执行。

### A2-1 安全工具

目标：实现命令执行、脱敏、路径安全工具，为 Terraform、Runner、日志提供安全底座。

A0 完成后可与 A1 并行。

第一批不要做 UI、不要接真实云效、不要接真实 Terraform apply。
