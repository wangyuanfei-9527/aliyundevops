# Aliyun Test Env Automation

本地自用的阿里云测试环境自动化工具。

## 当前能力

- 新建测试项目表单。
- 生成结构化执行计划。
- 白名单步骤校验。
- 本地 JSON 项目记录和 JSONL 执行日志。
- 前端测试项目 dry-run 闭环：Codeup 组、仓库、OSS Bucket、云效流水线。
- 后端测试项目 dry-run 闭环：Codeup 组、仓库、RDS 数据库、ACR 仓库、ECS 部署脚本、Nginx 配置、云效流水线。

## 启动

```bash
pnpm install
pnpm dev
```

默认访问：

```text
http://127.0.0.1:3000
```

## 配置

复制配置示例：

```bash
cp src/config/local.example.json src/config/local.json
```

填入云效组织、RDS、ACR、ECS 等测试环境信息。密钥不要写入配置文件，使用环境变量：

```bash
YUNXIAO_TOKEN=your-token
OPENAI_API_KEY=your-openai-key
```

## 执行模式

默认是 `dry-run`，不会真实创建云资源。

确认配置完整后，再切换：

```bash
EXECUTION_MODE=live pnpm dev
```

## AI Planner

如果设置了 `OPENAI_API_KEY`，会优先调用 OpenAI Responses API 生成结构化计划；失败时自动回退到本地确定性计划。

AI 不直接执行命令。系统只执行固定白名单步骤。

## 验证

```bash
pnpm typecheck
pnpm build
```
