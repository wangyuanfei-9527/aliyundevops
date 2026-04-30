import type { ExecutionPlan, ProjectInput, StepType } from "@/types";
import { normalizeInput } from "@/lib/names";

export const ALLOWED_STEP_TYPES: StepType[] = [
  "ensureCodeGroup",
  "ensureRepository",
  "ensureOssBucket",
  "ensureDatabase",
  "ensureAcrRepository",
  "writeDeployScript",
  "writeNginxConfig",
  "reloadNginx",
  "createFrontendPipeline",
  "createBackendPipeline"
];

export const PLAN_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["project", "resources", "steps", "warnings", "assumptions"],
  properties: {
    project: {
      type: "object",
      additionalProperties: false,
      required: ["group", "name", "type", "domain"],
      properties: {
        group: { type: "string" },
        name: { type: "string" },
        type: { enum: ["frontend", "backend"] },
        domain: { type: "string" },
        buildCommand: { type: "string" },
        artifactDir: { type: "string" },
        servicePort: { type: "number" }
      }
    },
    resources: {
      type: "object",
      additionalProperties: false,
      required: ["codeGroupPath", "repoPath"],
      properties: {
        codeGroupPath: { type: "string" },
        repoPath: { type: "string" },
        repoUrl: { type: ["string", "null"] },
        ossBucket: { type: ["string", "null"] },
        database: { type: ["string", "null"] },
        acrRepository: { type: ["string", "null"] },
        pipelineId: { type: ["string", "null"] },
        deployPath: { type: ["string", "null"] },
        nginxConfPath: { type: ["string", "null"] }
      }
    },
    steps: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "title", "params"],
        properties: {
          type: { enum: ALLOWED_STEP_TYPES },
          title: { type: "string" },
          params: { type: "object" }
        }
      }
    },
    warnings: { type: "array", items: { type: "string" } },
    assumptions: { type: "array", items: { type: "string" } }
  }
};

export function validateProjectInput(raw: ProjectInput, allowedRoot: string) {
  const input = normalizeInput(raw);
  const errors: string[] = [];

  if (!input.group) errors.push("项目分组不能为空，且必须能转换为小写字母/数字/短横线。");
  if (!input.name) errors.push("项目名不能为空，且必须能转换为小写字母/数字/短横线。");
  if (input.type !== "frontend" && input.type !== "backend") {
    errors.push("项目类型必须是 frontend 或 backend。");
  }
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(input.domain)) {
    errors.push("测试域名格式不正确。");
  }
  if (allowedRoot && !input.domain.endsWith(`.${allowedRoot}`) && input.domain !== allowedRoot) {
    errors.push(`测试域名必须属于 ${allowedRoot}。`);
  }
  if (input.servicePort && (input.servicePort < 1 || input.servicePort > 65535)) {
    errors.push("服务端口必须在 1 到 65535 之间。");
  }

  return { input, errors };
}

export function validatePlan(plan: ExecutionPlan, allowedRoot: string) {
  const errors: string[] = [];
  const { errors: inputErrors } = validateProjectInput(plan.project, allowedRoot);
  errors.push(...inputErrors);

  if (!plan.resources.codeGroupPath) errors.push("计划缺少代码组路径。");
  if (!plan.resources.repoPath) errors.push("计划缺少仓库路径。");

  for (const step of plan.steps) {
    if (!ALLOWED_STEP_TYPES.includes(step.type)) {
      errors.push(`不允许的执行步骤：${step.type}`);
    }
    const paramsAsText = JSON.stringify(step.params);
    if (/rm\s+-rf|Invoke-Expression|powershell|cmd\.exe|curl\s+.*\|\s*sh/i.test(paramsAsText)) {
      errors.push(`步骤 ${step.type} 包含危险命令片段。`);
    }
  }

  return errors;
}
