import type { AppConfig, ExecutionPlan, ProjectInput } from "@/types";
import {
  acrRepositoryFrom,
  bucketNameFrom,
  dbNameFrom,
  defaultBuildCommand,
  normalizeInput
} from "@/lib/names";
import { PLAN_JSON_SCHEMA, validatePlan } from "./schemas";

export async function createExecutionPlan(
  rawInput: ProjectInput,
  config: AppConfig
): Promise<ExecutionPlan> {
  const input = normalizeInput(rawInput);

  if (config.ai.provider === "openai" && process.env.OPENAI_API_KEY) {
    try {
      const aiPlan = await createOpenAiPlan(input, config);
      const errors = validatePlan(aiPlan, config.domain.allowedRoot);
      if (errors.length === 0) return aiPlan;
    } catch {
      return createLocalPlan(input, config, [
        "AI 计划生成失败，已使用本地确定性计划兜底。"
      ]);
    }
  }

  return createLocalPlan(input, config);
}

function createLocalPlan(
  input: ProjectInput,
  config: AppConfig,
  extraWarnings: string[] = []
): ExecutionPlan {
  const codeGroupPath = input.group;
  const repoPath = input.name;
  const buildCommand = input.buildCommand || defaultBuildCommand(input.type);
  const artifactDir = input.artifactDir || "dist";
  const servicePort = input.servicePort || 18080;

  if (input.type === "frontend") {
    const ossBucket = bucketNameFrom(input.group, input.name);
    return {
      project: { ...input, buildCommand, artifactDir },
      resources: {
        codeGroupPath,
        repoPath,
        ossBucket,
        database: null,
        acrRepository: null,
        pipelineId: null,
        deployPath: null,
        nginxConfPath: null
      },
      steps: [
        {
          type: "ensureCodeGroup",
          title: "创建或复用云效代码组",
          params: { path: codeGroupPath, name: codeGroupPath }
        },
        {
          type: "ensureRepository",
          title: "创建或复用云效代码仓库",
          params: { groupPath: codeGroupPath, repoPath }
        },
        {
          type: "ensureOssBucket",
          title: "创建或复用前端 OSS Bucket",
          params: { bucket: ossBucket, endpoint: config.aliyun.ossEndpoint }
        },
        {
          type: "createFrontendPipeline",
          title: "创建前端测试流水线",
          params: {
            name: `${input.name}-test`,
            buildCommand,
            artifactDir,
            bucket: ossBucket
          }
        }
      ],
      warnings: [
        ...extraWarnings,
        "当前执行模式默认 dry-run，不会真实创建云资源。",
        "测试环境本期不接入 CDN，HTTPS 暂不强制处理。"
      ],
      assumptions: [
        "前端构建产物目录默认 dist。",
        "OSS Bucket 名追加短 hash 以降低全局重名概率。"
      ]
    };
  }

  const database = dbNameFrom(input.group, input.name);
  const acrRepository = acrRepositoryFrom(input.group, input.name);
  const deployPath = `${config.ecs.appRoot}/${input.name}`;
  const nginxConfPath = `${config.ecs.nginxConfDir}/${input.name}.conf`;

  return {
    project: { ...input, servicePort },
    resources: {
      codeGroupPath,
      repoPath,
      ossBucket: null,
      database,
      acrRepository,
      pipelineId: null,
      deployPath,
      nginxConfPath
    },
    steps: [
      {
        type: "ensureCodeGroup",
        title: "创建或复用云效代码组",
        params: { path: codeGroupPath, name: codeGroupPath }
      },
      {
        type: "ensureRepository",
        title: "创建或复用云效代码仓库",
        params: { groupPath: codeGroupPath, repoPath }
      },
      {
        type: "ensureDatabase",
        title: "创建或复用测试数据库",
        params: { database }
      },
      {
        type: "ensureAcrRepository",
        title: "创建或复用 ACR 镜像仓库",
        params: { repository: acrRepository }
      },
      {
        type: "writeDeployScript",
        title: "写入测试服务器部署脚本",
        params: { deployPath, servicePort }
      },
      {
        type: "writeNginxConfig",
        title: "写入 Nginx 测试域名配置",
        params: { nginxConfPath, domain: input.domain, servicePort }
      },
      {
        type: "reloadNginx",
        title: "校验并重载 Nginx",
        params: { nginxConfPath }
      },
      {
        type: "createBackendPipeline",
        title: "创建后端测试流水线",
        params: {
          name: `${input.name}-test`,
          repository: acrRepository,
          deployPath,
          servicePort
        }
      }
    ],
    warnings: [...extraWarnings, "当前执行模式默认 dry-run，不会真实创建云资源。"],
    assumptions: [
      "后端服务默认监听容器内同一端口。",
      "测试服务器已安装 Docker、Nginx 和阿里云云助手 Agent。"
    ]
  };
}

async function createOpenAiPlan(input: ProjectInput, config: AppConfig): Promise<ExecutionPlan> {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: config.ai.model,
      instructions:
        "You are generating a safe Aliyun test-environment provisioning plan. Output only valid structured JSON. Do not include arbitrary shell commands. Use only the allowed step types from the schema. Prefer the smallest MVP path.",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: JSON.stringify({
                input,
                constraints: {
                  testOnly: true,
                  noRedisMq: true,
                  noCdn: true,
                  localFileStorage: true,
                  allowedRootDomain: config.domain.allowedRoot,
                  executionMode: config.executionMode
                }
              })
            }
          ]
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "aliyun_test_env_plan",
          strict: true,
          schema: PLAN_JSON_SCHEMA
        }
      }
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI planner failed: ${response.status}`);
  }

  const data = (await response.json()) as { output_text?: string };
  if (!data.output_text) {
    throw new Error("OpenAI planner returned no output_text");
  }
  return JSON.parse(data.output_text) as ExecutionPlan;
}
