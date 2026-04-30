import type { PlanStep, StepContext, StepResult } from "@/types";
import { callYunxiao } from "@/lib/yunxiao";

export async function ensureCodeGroup(
  step: PlanStep,
  context: StepContext
): Promise<StepResult> {
  const path = String(step.params.path || context.plan.resources.codeGroupPath);

  if (context.config.executionMode === "dry-run") {
    return {
      step: step.type,
      status: "success",
      resourceId: path,
      message: `dry-run: would ensure Codeup group ${path}`
    };
  }

  await context.log({
    level: "warn",
    step: step.type,
    message:
      "live mode: repository creation uses createParentPath=true; explicit group API can be added if your Yunxiao edition requires it"
  });

  return {
    step: step.type,
    status: "success",
    resourceId: path,
    message: `group path ${path} will be ensured by repository creation`
  };
}

export async function ensureRepository(
  step: PlanStep,
  context: StepContext
): Promise<StepResult> {
  const groupPath = String(step.params.groupPath || context.plan.resources.codeGroupPath);
  const repoPath = String(step.params.repoPath || context.plan.resources.repoPath);
  const repoFullPath = `${groupPath}/${repoPath}`;

  if (context.config.executionMode === "dry-run") {
    return {
      step: step.type,
      status: "success",
      resourceId: repoFullPath,
      message: `dry-run: would ensure Codeup repository ${repoFullPath}`
    };
  }

  const orgId = context.config.yunxiao.organizationId;
  if (!orgId) throw new Error("Missing yunxiao.organizationId in local config.");

  const result = await callYunxiao<unknown>(
    context.config,
    `/oapi/v1/codeup/organizations/${orgId}/repositories?createParentPath=true`,
    {
      method: "POST",
      body: JSON.stringify({
        name: repoPath,
        path: repoFullPath,
        description: `${repoPath} test environment repository`,
        visibilityLevel: 0
      })
    }
  );

  return {
    step: step.type,
    status: "success",
    resourceId: repoFullPath,
    message: `repository ensured: ${repoFullPath}`,
    data: result
  };
}
