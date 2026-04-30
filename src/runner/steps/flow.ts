import type { PlanStep, StepContext, StepResult } from "@/types";
import { renderTemplate } from "@/lib/templates";
import { callYunxiao } from "@/lib/yunxiao";

async function createPipeline(
  step: PlanStep,
  context: StepContext,
  content: string,
  name: string
): Promise<StepResult> {
  if (context.config.executionMode === "dry-run") {
    return {
      step: step.type,
      status: "success",
      resourceId: name,
      message: `dry-run: would create Yunxiao pipeline ${name}`,
      data: { content }
    };
  }

  const orgId = context.config.yunxiao.organizationId;
  if (!orgId) throw new Error("Missing yunxiao.organizationId in local config.");

  const result = await callYunxiao<number>(
    context.config,
    `/oapi/v1/flow/organizations/${orgId}/pipelines`,
    {
      method: "POST",
      body: JSON.stringify({ name, content })
    }
  );

  return {
    step: step.type,
    status: "success",
    resourceId: String(result),
    message: `pipeline created: ${name}`,
    data: { pipelineId: result }
  };
}

export async function createFrontendPipeline(
  step: PlanStep,
  context: StepContext
): Promise<StepResult> {
  const name = String(step.params.name || `${context.plan.project.name}-test`);
  const content = await renderTemplate("frontend-pipeline.yml", {
    pipelineName: name,
    projectName: context.plan.project.name,
    buildCommand: String(step.params.buildCommand || context.plan.project.buildCommand || ""),
    artifactDir: String(step.params.artifactDir || context.plan.project.artifactDir || "dist"),
    bucket: String(step.params.bucket || context.plan.resources.ossBucket || ""),
    runnerGroup: context.config.flow.runnerGroup,
    container: context.config.flow.container,
    repoUrl: context.plan.resources.repoUrl || "",
    serviceConnectionId: context.config.flow.serviceConnectionId || ""
  });

  return createPipeline(step, context, content, name);
}

export async function createBackendPipeline(
  step: PlanStep,
  context: StepContext
): Promise<StepResult> {
  const name = String(step.params.name || `${context.plan.project.name}-test`);
  const content = await renderTemplate("backend-pipeline.yml", {
    pipelineName: name,
    projectName: context.plan.project.name,
    repository: String(step.params.repository || context.plan.resources.acrRepository || ""),
    deployPath: String(step.params.deployPath || context.plan.resources.deployPath || ""),
    runnerGroup: context.config.flow.runnerGroup,
    container: context.config.flow.container,
    repoUrl: context.plan.resources.repoUrl || "",
    serviceConnectionId: context.config.flow.serviceConnectionId || ""
  });

  return createPipeline(step, context, content, name);
}
