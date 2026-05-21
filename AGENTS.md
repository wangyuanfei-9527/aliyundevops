# AGENTS.md

本文件是本仓库所有 AI Coding Agent 的最高项目级协作规范。任何 AI 在本仓库中执行开发、测试、验证、重构、文档更新时，必须先阅读并遵守本文件。

## 1. 项目目标

本项目是一个本地 Web 控制台，用于阿里云测试环境的一键资源准备、AI 部署方案生成和分步执行。

核心边界：

- Terraform 管理阿里云基础设施资源。
- Yunxiao / Codeup / Flow OpenAPI 管理云效相关对象。
- AI 只做仓库分析和部署方案生成，不直接执行任意部署命令。
- Runner 只执行白名单步骤。
- 本地状态只保存项目记录、运行日志、Redis db 分配和 Terraform state 路径。
- 不自动删除云资源。
- 不记录密钥、token、AccessKey、密码或完整连接串。

架构设计详见：

- `docs/devops-automation-v3.md`
- `docs/devops-automation-v3-implementation.md`
- `docs/ai-autonomous-implementation-plan.md`

## 2. 工作模式

本项目采用多 AI 协同开发。每个 AI 只能领取一个明确任务，任务应尽量小、可验证、可回滚。

AI 的职责不是“写完就算完成”，而是：

1. 理解任务边界。
2. 阅读相关设计文档和现有文件。
3. 实现最小必要改动。
4. 自动补充测试或验证脚本。
5. 运行相关检查。
6. 输出结构化交付报告。

人类只审核结果，不负责替 AI 做代码校验。因此 AI 必须提供可重复的验证证据。

## 3. 禁止事项

任何 AI 不得执行以下操作，除非用户在当前对话中明确授权：

- 删除 `.git/`。
- 执行 `git reset --hard`、`git clean -fdx`、强制覆盖未读文件。
- force push、改写提交历史、删除分支。
- 执行 `terraform apply`、`terraform destroy`、`terraform import`。
- 创建、删除或修改真实云资源。
- 向外部系统发送真实消息、邮件或通知。
- 上传仓库文件到第三方服务。
- 输出或记录密钥、token、AccessKey、密码、完整数据库连接串。
- 在 Runner 中加入任意 shell 执行 step。
- 绕过类型检查、测试、schema 校验或安全校验。

## 4. 高风险命令规则

以下命令默认视为高风险：

- `terraform apply`
- `terraform destroy`
- `terraform import`
- `aliyun` 创建、删除、修改类命令
- `ossutil` 删除、覆盖、批量同步类命令
- 调用真实 Yunxiao / Codeup / Flow 创建或修改资源的脚本
- 删除文件、目录、分支或历史的命令

AI 可以编写相关代码，但不能在未授权情况下真实执行这些命令。

允许执行的安全验证：

- 类型检查。
- 单元测试。
- lint。
- 构建。
- schema 校验。
- dry-run。
- `terraform fmt`。
- `terraform validate`，前提是使用测试 fixture 或本地模板，不访问真实云资源。
- `terraform plan` 只有在用户明确授权并确认环境为测试环境时才可执行。

## 5. 分层开发边界

### 5.1 Resources 层

目录：`src/resources/`

职责：

- 输入校验。
- 资源名称推导。
- ResourcePlan / ResourceManifest 组装。
- 调度云效 ensure 和 Terraform plan/apply 的流程编排。

禁止：

- 使用 AI 推导资源名称。
- 直接拼接 shell 命令。
- 记录密钥。

### 5.2 Terraform 层

目录：`src/terraform/`

职责：

- 渲染 Terraform 文件。
- 执行 Terraform 子命令。
- 解析 plan/output。

要求：

- 使用 `spawn` 或等价参数数组方式执行命令，不允许拼接 shell 字符串。
- 必须区分 stdout、stderr、exitCode、timeout。
- 必须过滤敏感输出。
- 不提供 destroy 能力。

### 5.3 AI 层

目录：`src/ai/`

职责：

- 分析仓库文件生成 `ProjectProfile`。
- 生成 `DeployPlan`。
- 定义和校验 schema。

要求：

- 所有模型输出必须经过 schema 校验。
- AI 不能生成非白名单 StepType。
- AI 不能生成“任意 shell 执行”步骤。
- AI 生成的文件必须可预览、可审查、可拒绝。

### 5.4 Runner 层

目录：`src/runner/`

职责：

- 执行部署过程性步骤。
- 写日志。
- 失败停止。
- 支持单步重试。

Runner 允许的 StepType 只能来自白名单，例如：

- `commitDockerfile`
- `commitDockerCompose`
- `commitDeployScript`
- `commitBuildConfig`
- `writeDeployScript`
- `deployToEcs`
- `writeNginxConfig`
- `reloadNginx`
- `configureOssWebsite`
- `healthCheck`
- `createFrontendPipeline`
- `createBackendPipeline`

Runner 不得创建 OSS Bucket、RDS Database、ACR Repository、DNS Record。

### 5.5 Storage 层

目录：`src/storage/`

职责：

- 项目记录。
- 运行日志。
- Redis db 分配。

要求：

- 写文件必须使用原子写策略或临时文件替换策略。
- 并发分配 Redis db 时必须有锁或冲突检测。
- 不保存密钥明文。

## 6. 代码质量要求

所有 TypeScript 代码必须满足：

- 显式类型优先，避免 `any`。
- 对外部输入做 runtime validation。
- 错误信息必须可读，能指导用户修复配置。
- 不吞异常，不返回模拟成功。
- 文件、路径、命令参数必须做安全处理。
- 日志必须脱敏。
- 单个模块职责清晰，不跨层访问。

## 7. 测试要求

每个功能任务必须尽量提供自动化测试。

优先级：

1. 单元测试：纯函数、schema、解析器、资源推导。
2. 集成测试：API handler、Runner 编排、storage。
3. Fixture 测试：Terraform 模板渲染、AI 输出样例校验。
4. E2E 测试：只允许针对本地 mock 或 dry-run 环境。

禁止让测试依赖真实阿里云资源、真实云效资源或真实密钥。

## 8. 验证命令约定

每个 AI 完成任务后，应至少运行与任务相关的检查。

推荐项目级命令：

```bash
pnpm typecheck
pnpm test
pnpm lint
pnpm build
```

如果某些命令尚未建立，AI 应说明原因，并优先在基础设施任务中补齐这些命令。

## 9. 多 AI 协作规则

为避免冲突，每个 AI 必须遵守：

- 领取任务前确认任务编号和文件范围。
- 只修改任务指定范围内的文件。
- 不重构无关模块。
- 不改动其他 AI 正在负责的文件。
- 如发现设计冲突，先记录到任务报告，不擅自扩大改动。
- 公共类型或 schema 的改动必须同步更新相关测试和文档。

建议任务拆分方式：

- Foundation Agent：工程脚手架、package、tsconfig、测试框架。
- Types Agent：核心类型和 schema。
- Resources Agent：资源推导和 manifest。
- Terraform Agent：模板、渲染、执行器、parser。
- Storage Agent：项目记录、日志、Redis 分配。
- AI Agent：analyzer、deployPlanner、prompt、schema validation。
- Runner Agent：step registry、runner、步骤实现。
- API Agent：route handler。
- UI Agent：控制台流程。
- QA Agent：测试、fixtures、安全用例、验证脚本。

## 10. 交付报告格式

每个 AI 完成任务后，必须输出以下报告：

```markdown
## 任务

- 任务编号：
- 任务名称：
- 修改范围：

## 变更摘要

- 

## 文件变更

- `path/to/file`: 说明

## 验证结果

- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm lint`
- [ ] `pnpm build`

未运行的命令及原因：

- 

## 安全检查

- [ ] 未写入密钥或敏感信息
- [ ] 未执行真实云资源变更
- [ ] 未新增任意 shell 执行入口
- [ ] 外部输入已校验
- [ ] 日志已脱敏

## 风险和后续事项

- 
```

## 11. 默认完成标准

任务只有同时满足以下条件才算完成：

- 实现符合 `docs/devops-automation-v3-implementation.md` 的架构边界。
- 相关测试已补充或说明无法补充的合理原因。
- 相关验证命令已运行并通过，或明确记录失败原因。
- 没有引入真实资源变更风险。
- 没有泄露敏感信息。
- 输出了完整交付报告。
