// =============================================================================
// POST /api/resources/apply — A9 API
// Executes terraform apply after user confirmation.
// HIGH RISK: requires authorized=true in request body.
// =============================================================================

import { getExtendedConfig, getDataDir } from "@/src/config/config";
import { terraformApply, terraformOutput } from "@/src/terraform/executor";
import { assembleManifest, defaultTerraformConfig } from "@/src/resources/manifest";
import { getProject, updateProject, updateProjectStatus } from "@/src/storage/projects";
import { success, badRequest, forbidden, notFound, internalError, parseJsonBody } from "@/src/lib/apiResponse";

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

    if (authorized !== true) {
      return forbidden(
        "Terraform apply requires explicit authorization. Set authorized=true in the request body.",
      );
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

    const { manifest } = project;
    const tfDefaults = defaultTerraformConfig(
      manifest.group, manifest.name, dataDir, config.terraform.providerVersion,
    );

    const terraformExecConfig = {
      workDir: manifest.terraform.workDir,
      statePath: tfDefaults.statePath,
      providerVersion: config.terraform.providerVersion,
    };

    updateProjectStatus(projectId, "resources_provisioned", dataDir);

    // Execute terraform apply
    const applyResult = await terraformApply(terraformExecConfig, true);

    if (!applyResult.success) {
      updateProjectStatus(projectId, "failed", dataDir);
      return success({
        projectId,
        success: false,
        error: applyResult.error,
      });
    }

    // Get terraform outputs
    const outputResult = await terraformOutput(terraformExecConfig);
    const outputs = outputResult.success ? outputResult.outputs : {};

    // Reassemble manifest with terraform outputs
    const updatedManifest = assembleManifest({
      input: project.input,
      derived: {
        codeGroupPath: manifest.codeGroup.path,
        repositoryPath: manifest.repository.path,
        ossBucketName: manifest.ossBucket?.name ?? "",
        databaseName: manifest.database?.name ?? "",
        acrNamespace: manifest.acrRepository?.namespace ?? "",
        acrRepoName: manifest.acrRepository?.name ?? "",
        dnsSubdomain: manifest.domain.split(".")[0],
        redisDbIndex: manifest.redis?.db ?? -1,
      },
      yunxiao: {
        codeGroup: {
          status: manifest.codeGroup.status === "exists" || manifest.codeGroup.status === "created"
            ? manifest.codeGroup.status
            : "exists",
          path: manifest.codeGroup.path,
        },
        repository: {
          status: manifest.repository.status === "exists" || manifest.repository.status === "created"
            ? manifest.repository.status
            : "exists",
          path: manifest.repository.path,
          url: manifest.repository.url,
        },
      },
      terraform: {
        workDir: manifest.terraform.workDir,
        statePath: tfDefaults.statePath,
        providerVersion: config.terraform.providerVersion,
        outputs: {
          ossBucketName: outputs.oss_bucket ?? undefined,
          databaseName: outputs.database_name ?? undefined,
          databaseInstanceId: outputs.database_instance_id ?? undefined,
          acrInstanceId: outputs.acr_instance_id ?? undefined,
          dnsTarget: outputs.dns_record ?? undefined,
        },
      },
      redis: manifest.redis,
    });

    // Update project
    updateProject(projectId, { manifest: updatedManifest }, dataDir);
    updateProjectStatus(projectId, "resources_provisioned", dataDir);

    return success({
      projectId,
      success: true,
      manifest: updatedManifest,
      terraformOutput: outputResult.success ? outputResult.outputs : null,
    });
  } catch (err) {
    return internalError("Resource apply failed", (err as Error).message);
  }
}
