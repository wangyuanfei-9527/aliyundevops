// =============================================================================
// POST /api/deploy-plan — A9 API
// Generates a DeployPlan from the project's profile + manifest via AI.
// =============================================================================

import { generateDeployPlan } from "@/src/ai/planner";
import { createLLMProvider, type LLMConfig } from "@/src/ai/llmProvider";
import { getDataDir } from "@/src/config/config";
import { getProject, updateProject, updateProjectStatus } from "@/src/storage/projects";
import { success, badRequest, notFound, internalError, parseJsonBody } from "@/src/lib/apiResponse";

export async function POST(request: Request) {
  try {
    const body = await parseJsonBody(request);
    if (!body || typeof body !== "object") {
      return badRequest("Request body must be valid JSON");
    }

    const { projectId } = body as { projectId?: string };
    if (!projectId || typeof projectId !== "string") {
      return badRequest("projectId is required");
    }

    const dataDir = getDataDir();

    // Load project
    const project = getProject(projectId, dataDir);
    if (!project) {
      return notFound(`Project "${projectId}" not found`);
    }

    if (!project.manifest) {
      return badRequest("Project has no resource manifest. Run /api/resources/plan first.");
    }

    if (!project.profile) {
      return badRequest("Project has no profile. Run /api/analyze first.");
    }

    updateProjectStatus(projectId, "deploy_planning", dataDir);

    // Set up LLM provider
    const llmConfig: LLMConfig = {
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_MODEL,
      baseUrl: process.env.OPENAI_BASE_URL,
      apiMode: process.env.OPENAI_API_MODE,
    };
    const provider = createLLMProvider(llmConfig);

    if (!provider.isConfigured()) {
      return internalError("LLM provider is not configured. Set OPENAI_API_KEY environment variable.");
    }

    // Generate deploy plan
    const deployPlan = await generateDeployPlan(provider, {
      profile: project.profile,
      manifest: project.manifest,
    });

    // Update project
    updateProject(projectId, { deployPlan }, dataDir);
    updateProjectStatus(projectId, "deploy_planned", dataDir);

    return success({
      projectId,
      deployPlan,
      stepCount: deployPlan.steps.length,
      stepTypes: deployPlan.steps.map((s) => s.type),
    });
  } catch (err) {
    return internalError("Deploy plan generation failed", (err as Error).message);
  }
}
