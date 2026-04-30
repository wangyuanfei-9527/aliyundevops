import type { PlanStep, StepContext, StepResult } from "@/types";
import { formatCommand, runCommand } from "@/lib/commands";

export async function ensureDatabase(
  step: PlanStep,
  context: StepContext
): Promise<StepResult> {
  const database = String(step.params.database || context.plan.resources.database);
  const args = [
    "rds",
    "CreateDatabase",
    "--region",
    context.config.aliyun.region,
    "--DBInstanceId",
    context.config.rds.instanceId,
    "--DBName",
    database,
    "--CharacterSetName",
    context.config.rds.defaultCharset
  ];

  if (context.config.executionMode === "dry-run") {
    return {
      step: step.type,
      status: "success",
      resourceId: database,
      message: `dry-run: would run ${formatCommand("aliyun", args)}`
    };
  }

  if (!context.config.rds.instanceId) throw new Error("Missing rds.instanceId in local config.");
  const result = await runCommand("aliyun", args);
  if (result.exitCode !== 0 && !/AlreadyExist|already exists|Database.*exists/i.test(result.stderr)) {
    throw new Error(result.stderr || result.stdout || "CreateDatabase failed");
  }

  return {
    step: step.type,
    status: "success",
    resourceId: database,
    message: `database ensured: ${database}`,
    data: { stdout: result.stdout, stderr: result.stderr }
  };
}
