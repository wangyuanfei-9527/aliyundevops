import type { PlanStep, StepContext, StepResult } from "@/types";
import { formatCommand, runCommand } from "@/lib/commands";

export async function ensureOssBucket(
  step: PlanStep,
  context: StepContext
): Promise<StepResult> {
  const bucket = String(step.params.bucket || context.plan.resources.ossBucket);
  const endpoint = String(step.params.endpoint || context.config.aliyun.ossEndpoint || "");
  const args = ["mb", `oss://${bucket}`];
  if (endpoint) args.push("-e", endpoint);

  if (context.config.executionMode === "dry-run") {
    return {
      step: step.type,
      status: "success",
      resourceId: bucket,
      message: `dry-run: would run ${formatCommand("ossutil", args)}`
    };
  }

  const result = await runCommand("ossutil", args);
  if (result.exitCode !== 0 && !/BucketAlreadyExists|already exists/i.test(result.stderr)) {
    throw new Error(result.stderr || result.stdout || "ossutil mb failed");
  }

  return {
    step: step.type,
    status: "success",
    resourceId: bucket,
    message: `OSS bucket ensured: ${bucket}`,
    data: { stdout: result.stdout, stderr: result.stderr }
  };
}
