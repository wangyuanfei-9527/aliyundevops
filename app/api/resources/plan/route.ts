// =============================================================================
// POST /api/resources/plan — A9 API
// Resource provisioning preview: Yunxiao ensure + Terraform plan.
// Does NOT execute terraform apply. Returns plan summary for user review.
// =============================================================================

import { validateInputForDerivation, deriveResources } from "@/src/resources/derive";
import { assembleManifest, defaultTerraformConfig } from "@/src/resources/manifest";
import { validateProjectInput } from "@/src/ai/schemas";
import { getExtendedConfig, getDataDir } from "@/src/config/config";
import { YunxiaoHttpAdapter, type IYunxiaoAdapter } from "@/src/lib/yunxiao";
import { allocateRedisDb, type RedisAllocConfig } from "@/src/storage/redis";
import { renderTerraformFiles } from "@/src/terraform/render";
import { terraformInit, terraformPlan } from "@/src/terraform/executor";
import {
  createProject,
  updateProject,
  updateProjectStatus,
  getProject,
} from "@/src/storage/projects";
import { success, badRequest, internalError, parseJsonBody } from "@/src/lib/apiResponse";

export async function POST(request: Request) {
  try {
    const body = await parseJsonBody(request);
    if (!body) {
      return badRequest("Request body must be valid JSON");
    }

    // Validate input
    const validation = validateProjectInput(body);
    if (!validation.success) {
      const issues = validation.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      return badRequest("Invalid project input", issues);
    }

    const input = validation.data;
    const config = getExtendedConfig();
    const dataDir = getDataDir();
    const projectId = `${input.group}-${input.name}`;

    // Validate for derivation
    let warnings: string[];
    try {
      warnings = validateInputForDerivation(input, {
        allowedRootDomains: config.dns.allowedRootDomains,
        acrNamespace: config.acr.namespace,
      });
    } catch (err) {
      return badRequest((err as Error).message);
    }

    // Create or update project record
    let project = getProject(projectId, dataDir);
    if (!project) {
      project = createProject(input, dataDir);
    }
    project = updateProjectStatus(projectId, "resources_planning", dataDir);

    // Derive resource names
    const derived = deriveResources(input, {
      allowedRootDomains: config.dns.allowedRootDomains,
      acrNamespace: config.acr.namespace,
    });

    // Yunxiao: ensure code group + repository
    const yunxiao: IYunxiaoAdapter = new YunxiaoHttpAdapter({
      baseUrl: config.yunxiao.baseUrl,
      organizationId: config.yunxiao.organizationId,
      token: process.env.YUNXIAO_TOKEN ?? "",
    });

    const codeGroupResult = await yunxiao.ensureCodeGroup(input.group);
    const repositoryResult = await yunxiao.ensureRepository(input.group, input.name);

    // Allocate Redis db if needed
    let redis = project.manifest?.redis;
    if (!redis && input.type === "backend") {
      try {
        const redisConfig: RedisAllocConfig = {
          instanceId: config.redis.instanceId,
          host: config.redis.host,
          port: config.redis.port,
          passwordEnv: config.redis.passwordEnv,
          dbMin: 1,
          dbMax: config.redis.maxDatabases - 1,
        };
        redis = allocateRedisDb(dataDir, redisConfig);
      } catch {
        warnings.push("Redis db allocation skipped: no available slots");
      }
    }

    // Render Terraform files
    const tfConfig = {
      templateDir: config.terraform.templateDir,
      dataDir: config.terraform.dataDir,
      providerVersion: config.terraform.providerVersion,
      region: config.aliyun.region,
      ecsPublicIp: config.ecs.publicIp,
      rdsInstanceId: config.rds.instanceId,
      acrInstanceId: config.acrInstance.id,
      ossEndpoint: config.oss.endpoint,
    };

    const { workDir } = renderTerraformFiles(input, derived, tfConfig);

    // Terraform init + plan
    const terraformExecConfig = {
      workDir,
      statePath: defaultTerraformConfig(input.group, input.name, dataDir, config.terraform.providerVersion).statePath,
      providerVersion: config.terraform.providerVersion,
    };

    await terraformInit(terraformExecConfig);
    const planResult = await terraformPlan(terraformExecConfig);

    if (!planResult.success) {
      updateProjectStatus(projectId, "failed", dataDir);
      return success({
        projectId,
        derived,
        terraformPlan: {
          success: false,
          error: planResult.error,
          planInfo: planResult.planInfo,
        },
        warnings,
      });
    }

    // Build provisional manifest
    const manifest = assembleManifest({
      input,
      derived,
      yunxiao: {
        codeGroup: codeGroupResult,
        repository: repositoryResult,
      },
      terraform: {
        workDir,
        statePath: terraformExecConfig.statePath,
        providerVersion: config.terraform.providerVersion,
      },
      redis,
    });

    // Update project with manifest
    project = updateProject(projectId, { manifest }, dataDir);
    project = updateProjectStatus(projectId, "resources_provisioned", dataDir);

    return success({
      projectId,
      input,
      derived,
      manifest,
      terraformPlan: {
        success: true,
        planInfo: planResult.planInfo,
      },
      warnings,
    });
  } catch (err) {
    return internalError("Resource plan failed", (err as Error).message);
  }
}
