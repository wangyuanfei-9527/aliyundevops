import type { PlanStep, StepContext, StepResult } from "@/types";
import { formatCommand, runCommand } from "@/lib/commands";

export async function ensureAcrRepository(
  step: PlanStep,
  context: StepContext
): Promise<StepResult> {
  const repository = String(step.params.repository || context.plan.resources.acrRepository);
  const [, repoName] = repository.split("/");
  const args = [
    "cr",
    "CreateRepository",
    "--region",
    context.config.aliyun.region,
    "--InstanceId",
    context.config.acr.instanceId,
    "--RepoNamespaceName",
    context.config.acr.namespace,
    "--RepoName",
    repoName || repository,
    "--RepoType",
    "PRIVATE",
    "--Summary",
    `${repository} test image repository`
  ];

  if (context.config.executionMode === "dry-run") {
    return {
      step: step.type,
      status: "success",
      resourceId: repository,
      message: `dry-run: would run ${formatCommand("aliyun", args)}`
    };
  }

  if (!context.config.acr.instanceId) throw new Error("Missing acr.instanceId in local config.");
  const result = await runCommand("aliyun", args);
  if (result.exitCode !== 0 && !/AlreadyExist|already exists|Repo.*exists/i.test(result.stderr)) {
    throw new Error(result.stderr || result.stdout || "CreateRepository failed");
  }

  return {
    step: step.type,
    status: "success",
    resourceId: repository,
    message: `ACR repository ensured: ${repository}`,
    data: { stdout: result.stdout, stderr: result.stderr }
  };
}
