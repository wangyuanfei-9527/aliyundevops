// =============================================================================
// ECS Step Executors — A8 Runner
// Handles ECS deployment, Nginx configuration, and health checks.
// All operations go through IEcsAdapter — no SSH, no arbitrary shell.
// =============================================================================

import type { StepContext, StepResult } from "@/src/runner/stepRegistry";

// ---------------------------------------------------------------------------
// Phase 3: ECS deployment steps
// ---------------------------------------------------------------------------

/** writeDeployScript — write the deploy script to the ECS deploy path */
export async function writeDeployScript(ctx: StepContext): Promise<StepResult> {
  const content = ctx.plan.artifacts.deployScript;
  if (!content) {
    return { success: false, message: "No deploy script content in deploy plan artifacts" };
  }

  const deployPath = ctx.plan.manifest.deployPath;
  if (!deployPath) {
    return { success: false, message: "No deploy path in resource manifest" };
  }

  const scriptPath = `${deployPath}/deploy.sh`;
  const result = await ctx.adapters.ecs.writeFile(scriptPath, content);

  return {
    success: result.success,
    message: result.success
      ? `Deploy script written to ${scriptPath}`
      : `Failed to write deploy script to ${scriptPath}`,
  };
}

/** deployToEcs — execute the deployment on ECS via cloud assistant */
export async function deployToEcs(ctx: StepContext): Promise<StepResult> {
  const deployPath = ctx.plan.manifest.deployPath;
  if (!deployPath) {
    return { success: false, message: "No deploy path in resource manifest" };
  }

  const hasDockerCompose = ctx.plan.artifacts.dockerCompose != null;
  const command = hasDockerCompose
    ? `cd ${deployPath} && docker-compose pull && docker-compose up -d`
    : `cd ${deployPath} && bash deploy.sh`;

  const result = await ctx.adapters.ecs.runCommand(command);

  return {
    success: result.success,
    message: result.success
      ? `Deployment executed on ECS${result.output ? `: ${result.output}` : ""}`
      : `Deployment failed on ECS${result.output ? `: ${result.output}` : ""}`,
  };
}

/** writeNginxConfig — write Nginx configuration to ECS */
export async function writeNginxConfig(ctx: StepContext): Promise<StepResult> {
  const content = ctx.plan.artifacts.nginxConfig;
  if (!content) {
    return { success: false, message: "No Nginx config content in deploy plan artifacts" };
  }

  const nginxPath = ctx.plan.manifest.nginxConfPath;
  if (!nginxPath) {
    return { success: false, message: "No Nginx config path in resource manifest" };
  }

  const result = await ctx.adapters.ecs.writeFile(nginxPath, content);

  return {
    success: result.success,
    message: result.success
      ? `Nginx config written to ${nginxPath}`
      : `Failed to write Nginx config to ${nginxPath}`,
  };
}

/** reloadNginx — validate and reload Nginx configuration */
export async function reloadNginx(ctx: StepContext): Promise<StepResult> {
  const testResult = await ctx.adapters.ecs.runCommand("nginx -t");
  if (!testResult.success) {
    return {
      success: false,
      message: `Nginx config validation failed: ${testResult.output ?? "unknown error"}`,
    };
  }

  const reloadResult = await ctx.adapters.ecs.runCommand("nginx -s reload");
  return {
    success: reloadResult.success,
    message: reloadResult.success
      ? "Nginx reloaded successfully"
      : `Nginx reload failed: ${reloadResult.output ?? "unknown error"}`,
  };
}

// ---------------------------------------------------------------------------
// Phase 3: Health check
// ---------------------------------------------------------------------------

/** healthCheck — verify the deployment is accessible via HTTP */
export async function healthCheck(ctx: StepContext): Promise<StepResult> {
  const domain = ctx.plan.manifest.domain;
  const port = ctx.plan.ports.servicePort;

  let url: string;
  if (ctx.plan.manifest.type === "frontend") {
    url = `http://${domain}`;
  } else {
    url = port === 80 ? `http://${domain}` : `http://${domain}:${port}`;
  }

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(15_000),
      redirect: "follow",
    });

    if (response.ok) {
      return {
        success: true,
        message: `Health check passed: ${url} returned ${response.status}`,
      };
    }

    return {
      success: false,
      message: `Health check failed: ${url} returned ${response.status}`,
    };
  } catch (err) {
    return {
      success: false,
      message: `Health check failed: ${(err as Error).message}`,
    };
  }
}
