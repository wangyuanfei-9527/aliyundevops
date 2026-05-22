// =============================================================================
// Codeup Step Executors — A8 Runner
// Handles Yunxiao provisioning and file commit steps.
// All operations go through IYunxiaoAdapter — no direct API calls.
// =============================================================================

import type { StepContext, StepResult } from "@/src/runner/stepRegistry";

// ---------------------------------------------------------------------------
// Phase 1: Yunxiao resource provisioning
// ---------------------------------------------------------------------------

/** ensureCodeGroup — create the Codeup group if it doesn't exist */
export async function ensureCodeGroup(ctx: StepContext): Promise<StepResult> {
  const { manifest } = ctx.plan;
  const result = await ctx.adapters.yunxiao.ensureCodeGroup(manifest.group);

  return {
    success: true,
    message: `Code group "${manifest.group}" ${result.status}: ${result.path}`,
  };
}

/** ensureRepository — create the Codeup repository if it doesn't exist */
export async function ensureRepository(ctx: StepContext): Promise<StepResult> {
  const { manifest } = ctx.plan;
  const result = await ctx.adapters.yunxiao.ensureRepository(manifest.group, manifest.name);

  return {
    success: true,
    message: `Repository "${manifest.group}/${manifest.name}" ${result.status}: ${result.path}`,
  };
}

// ---------------------------------------------------------------------------
// Phase 3: File commits to Codeup
// ---------------------------------------------------------------------------

/** commitDockerfile — commit the AI-generated Dockerfile to the repository */
export async function commitDockerfile(ctx: StepContext): Promise<StepResult> {
  const content = ctx.plan.artifacts.dockerfile;
  if (!content) {
    return { success: false, message: "No Dockerfile content in deploy plan artifacts" };
  }

  const { manifest } = ctx.plan;
  const result = await ctx.adapters.yunxiao.commitFile({
    group: manifest.group,
    repository: manifest.name,
    filePath: "Dockerfile",
    content,
    commitMessage: `chore: add Dockerfile for ${manifest.name}`,
  });

  return {
    success: result.success,
    message: result.success
      ? `Dockerfile committed (commitId: ${result.commitId ?? "unknown"})`
      : "Failed to commit Dockerfile",
  };
}

/** commitDockerCompose — commit the AI-generated docker-compose.yml */
export async function commitDockerCompose(ctx: StepContext): Promise<StepResult> {
  const content = ctx.plan.artifacts.dockerCompose;
  if (!content) {
    return { success: false, message: "No docker-compose content in deploy plan artifacts" };
  }

  const { manifest } = ctx.plan;
  const result = await ctx.adapters.yunxiao.commitFile({
    group: manifest.group,
    repository: manifest.name,
    filePath: "docker-compose.yml",
    content,
    commitMessage: `chore: add docker-compose.yml for ${manifest.name}`,
  });

  return {
    success: result.success,
    message: result.success
      ? `docker-compose.yml committed (commitId: ${result.commitId ?? "unknown"})`
      : "Failed to commit docker-compose.yml",
  };
}

/** commitDeployScript — commit the AI-generated deploy script */
export async function commitDeployScript(ctx: StepContext): Promise<StepResult> {
  const content = ctx.plan.artifacts.deployScript;
  if (!content) {
    return { success: false, message: "No deploy script content in deploy plan artifacts" };
  }

  const { manifest } = ctx.plan;
  const result = await ctx.adapters.yunxiao.commitFile({
    group: manifest.group,
    repository: manifest.name,
    filePath: "deploy.sh",
    content,
    commitMessage: `chore: add deploy.sh for ${manifest.name}`,
  });

  return {
    success: result.success,
    message: result.success
      ? `deploy.sh committed (commitId: ${result.commitId ?? "unknown"})`
      : "Failed to commit deploy.sh",
  };
}

/** commitBuildConfig — commit the AI-generated build configuration */
export async function commitBuildConfig(ctx: StepContext): Promise<StepResult> {
  const content = ctx.plan.artifacts.buildScript;
  if (!content) {
    return { success: false, message: "No build script content in deploy plan artifacts" };
  }

  const { manifest } = ctx.plan;
  const result = await ctx.adapters.yunxiao.commitFile({
    group: manifest.group,
    repository: manifest.name,
    filePath: "build.sh",
    content,
    commitMessage: `chore: add build.sh for ${manifest.name}`,
  });

  return {
    success: result.success,
    message: result.success
      ? `build.sh committed (commitId: ${result.commitId ?? "unknown"})`
      : "Failed to commit build.sh",
  };
}
