import type { ExecutionPlan, ProjectRecord, StepResult } from "@/types";
import { loadConfig } from "@/config/config";
import { makeProjectId, makeRunId, nowIso } from "@/lib/ids";
import { validatePlan } from "@/ai/schemas";
import { appendRunLog } from "@/storage/logs";
import { updateProjectStatus, upsertProject } from "@/storage/projects";
import { stepRegistry } from "./stepRegistry";

export async function runProjectPlan(plan: ExecutionPlan) {
  const config = loadConfig();
  const errors = validatePlan(plan, config.domain.allowedRoot);
  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }

  const projectId = makeProjectId(plan.project.group, plan.project.name);
  const runId = makeRunId(projectId);
  const now = nowIso();
  const record: ProjectRecord = {
    id: projectId,
    runId,
    group: plan.project.group,
    name: plan.project.name,
    type: plan.project.type,
    domain: plan.project.domain,
    status: "running",
    resources: plan.resources,
    plan,
    createdAt: now,
    updatedAt: now
  };

  await upsertProject(record);
  await appendRunLog(runId, {
    level: "info",
    step: "run",
    message: `start in ${config.executionMode} mode`
  });

  const results: StepResult[] = [];

  for (const step of plan.steps) {
    const handler = stepRegistry[step.type];
    await appendRunLog(runId, {
      level: "info",
      step: step.type,
      message: step.title
    });

    try {
      const result = await handler(step, {
        plan,
        projectId,
        runId,
        config,
        log: (event) => appendRunLog(runId, event)
      });
      results.push(result);
      await appendRunLog(runId, {
        level: result.status === "success" ? "success" : "warn",
        step: step.type,
        message: result.message,
        data: result.data
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({
        step: step.type,
        status: "failed",
        message
      });
      await appendRunLog(runId, {
        level: "error",
        step: step.type,
        message
      });
      await updateProjectStatus(projectId, "failed");
      return { projectId, runId, status: "failed" as const, results };
    }
  }

  await updateProjectStatus(projectId, "created");
  await appendRunLog(runId, {
    level: "success",
    step: "run",
    message: "completed"
  });

  return { projectId, runId, status: "created" as const, results };
}
