// =============================================================================
// Flow Pipeline Step Executors — A8 Runner
// Handles Yunxiao Flow pipeline creation for frontend and backend projects.
// All operations go through IYunxiaoAdapter — no direct API calls.
// =============================================================================

import type { StepContext, StepResult } from "@/src/runner/stepRegistry";

// ---------------------------------------------------------------------------
// Phase 3: Pipeline creation
// ---------------------------------------------------------------------------

/** createBackendPipeline — create a Yunxiao Flow pipeline for backend deployment */
export async function createBackendPipeline(ctx: StepContext): Promise<StepResult> {
  const yamlContent = ctx.plan.artifacts.pipelineYaml;
  if (!yamlContent) {
    return { success: false, message: "No pipeline YAML in deploy plan artifacts" };
  }

  const { manifest } = ctx.plan;
  const pipelineName = `${manifest.group}-${manifest.name}-backend`;

  const result = await ctx.adapters.yunxiao.createPipeline({
    name: pipelineName,
    group: manifest.group,
    repository: manifest.name,
    yamlContent,
  });

  return {
    success: result.success,
    message: result.success
      ? `Backend pipeline created: ${pipelineName} (pipelineId: ${result.pipelineId ?? "unknown"})`
      : `Failed to create backend pipeline: ${pipelineName}`,
  };
}

/** createFrontendPipeline — create a Yunxiao Flow pipeline for frontend deployment */
export async function createFrontendPipeline(ctx: StepContext): Promise<StepResult> {
  const yamlContent = ctx.plan.artifacts.pipelineYaml;
  if (!yamlContent) {
    return { success: false, message: "No pipeline YAML in deploy plan artifacts" };
  }

  const { manifest } = ctx.plan;
  const pipelineName = `${manifest.group}-${manifest.name}-frontend`;

  const result = await ctx.adapters.yunxiao.createPipeline({
    name: pipelineName,
    group: manifest.group,
    repository: manifest.name,
    yamlContent,
  });

  return {
    success: result.success,
    message: result.success
      ? `Frontend pipeline created: ${pipelineName} (pipelineId: ${result.pipelineId ?? "unknown"})`
      : `Failed to create frontend pipeline: ${pipelineName}`,
  };
}
