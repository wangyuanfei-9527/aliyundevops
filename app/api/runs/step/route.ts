// =============================================================================
// POST /api/runs/step — A9 API
// Retry a single failed step from a previous run.
// =============================================================================

import { retryStep } from "@/src/runner/runProject";
import { YunxiaoHttpAdapter } from "@/src/lib/yunxiao";
import { MockEcsAdapter, MockOssAdapter } from "@/src/runner/stepRegistry";
import { getExtendedConfig, getDataDir } from "@/src/config/config";
import { getProject, updateProjectStatus } from "@/src/storage/projects";
import { getLatestRunLog } from "@/src/storage/logs";
import { success, badRequest, notFound, internalError, parseJsonBody } from "@/src/lib/apiResponse";

export async function POST(request: Request) {
  try {
    const body = await parseJsonBody(request);
    if (!body || typeof body !== "object") {
      return badRequest("Request body must be valid JSON");
    }

    const { projectId, stepId, authorized } = body as {
      projectId?: string;
      stepId?: string;
      authorized?: boolean;
    };

    if (!projectId || typeof projectId !== "string") {
      return badRequest("projectId is required");
    }

    if (!stepId || typeof stepId !== "string") {
      return badRequest("stepId is required");
    }

    const config = getExtendedConfig();
    const dataDir = getDataDir();

    // Load project
    const project = getProject(projectId, dataDir);
    if (!project) {
      return notFound(`Project "${projectId}" not found`);
    }

    if (!project.deployPlan) {
      return badRequest("Project has no deploy plan. Run /api/deploy-plan first.");
    }

    // Get latest run log
    const log = getLatestRunLog(projectId, dataDir);
    if (!log) {
      return notFound(`No run log found for project "${projectId}"`);
    }

    updateProjectStatus(projectId, "executing", dataDir);

    // Set up adapters
    const yunxiao = new YunxiaoHttpAdapter({
      baseUrl: config.yunxiao.baseUrl,
      organizationId: config.yunxiao.organizationId,
      token: process.env.YUNXIAO_TOKEN ?? "",
    });

    const ecs = new MockEcsAdapter();
    const oss = new MockOssAdapter();

    // Retry the step
    const updatedLog = await retryStep(log, stepId, {
      plan: project.deployPlan,
      yunxiao,
      ecs,
      oss,
      authorized: authorized === true,
      dataDir,
    });

    // Find the retried step
    const retriedStep = updatedLog.steps.find((s) => s.id === stepId);

    return success({
      projectId,
      runId: updatedLog.id,
      step: retriedStep ? {
        id: retriedStep.id,
        type: retriedStep.type,
        name: retriedStep.name,
        status: retriedStep.status,
        error: retriedStep.error,
        startedAt: retriedStep.startedAt,
        finishedAt: retriedStep.finishedAt,
      } : null,
      logStatus: updatedLog.status,
    });
  } catch (err) {
    return internalError("Step retry failed", (err as Error).message);
  }
}
