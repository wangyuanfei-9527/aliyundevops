// =============================================================================
// POST /api/runs — A9 API
// Execute a confirmed DeployPlan. Runs all steps sequentially.
// HIGH RISK: requires authorized=true for terraform apply steps.
// =============================================================================

import { runProject, validatePlanStepTypes } from "@/src/runner/runProject";
import { YunxiaoHttpAdapter } from "@/src/lib/yunxiao";
import { MockEcsAdapter, MockOssAdapter } from "@/src/runner/stepRegistry";
import { getExtendedConfig, getDataDir } from "@/src/config/config";
import { getProject, updateProjectStatus } from "@/src/storage/projects";
import { success, badRequest, notFound, internalError, parseJsonBody } from "@/src/lib/apiResponse";

export async function POST(request: Request) {
  try {
    const body = await parseJsonBody(request);
    if (!body || typeof body !== "object") {
      return badRequest("Request body must be valid JSON");
    }

    const { projectId, authorized } = body as { projectId?: string; authorized?: boolean };

    if (!projectId || typeof projectId !== "string") {
      return badRequest("projectId is required");
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

    // Validate all step types are whitelisted
    const invalidTypes = validatePlanStepTypes(project.deployPlan);
    if (invalidTypes.length > 0) {
      return badRequest(
        `Deploy plan contains invalid step types: ${invalidTypes.join(", ")}`,
      );
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

    // Execute the plan
    const log = await runProject({
      plan: project.deployPlan,
      yunxiao,
      ecs,
      oss,
      authorized: authorized === true,
      dataDir,
    });

    // Update project status based on result
    updateProjectStatus(
      projectId,
      log.status === "completed" ? "completed" : "failed",
      dataDir,
    );

    return success({
      projectId,
      runId: log.id,
      status: log.status,
      steps: log.steps.map((s) => ({
        id: s.id,
        type: s.type,
        name: s.name,
        status: s.status,
        error: s.error,
        startedAt: s.startedAt,
        finishedAt: s.finishedAt,
      })),
      startedAt: log.startedAt,
      finishedAt: log.finishedAt,
    });
  } catch (err) {
    return internalError("Run execution failed", (err as Error).message);
  }
}
