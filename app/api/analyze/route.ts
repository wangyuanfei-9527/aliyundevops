// =============================================================================
// POST /api/analyze — A9 API
// Reads Codeup repository files, sends to AI for project analysis.
// Returns a ProjectProfile describing the tech stack.
// =============================================================================

import { analyzeProject } from "@/src/ai/analyzer";
import { createLLMProvider, type LLMConfig } from "@/src/ai/llmProvider";
import { readAnalysisFiles, listRepoRoot } from "@/src/lib/codeupReader";
import { YunxiaoHttpAdapter, type IYunxiaoAdapter } from "@/src/lib/yunxiao";
import { getDataDir } from "@/src/config/config";
import { getExtendedConfig } from "@/src/config/config";
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

    const config = getExtendedConfig();
    const dataDir = getDataDir();

    // Load project
    const project = getProject(projectId, dataDir);
    if (!project) {
      return notFound(`Project "${projectId}" not found`);
    }

    if (!project.manifest) {
      return badRequest("Project has no resource manifest. Run /api/resources/plan first.");
    }

    updateProjectStatus(projectId, "analyzing", dataDir);

    // Set up Yunxiao adapter
    const yunxiao: IYunxiaoAdapter = new YunxiaoHttpAdapter({
      baseUrl: config.yunxiao.baseUrl,
      organizationId: config.yunxiao.organizationId,
      token: process.env.YUNXIAO_TOKEN ?? "",
    });

    // Read repository files
    const { manifest } = project;
    const [files, rootListing] = await Promise.all([
      readAnalysisFiles(yunxiao, manifest.group, manifest.name),
      listRepoRoot(yunxiao, manifest.group, manifest.name),
    ]);

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

    // Run analysis
    const profile = await analyzeProject(provider, { files, rootListing });

    // Update project
    updateProject(projectId, { profile }, dataDir);
    updateProjectStatus(projectId, "analyzed", dataDir);

    return success({
      projectId,
      profile,
      filesAnalyzed: files.filter((f) => f.exists).length,
      totalFilesChecked: files.length,
    });
  } catch (err) {
    return internalError("Project analysis failed", (err as Error).message);
  }
}
