// =============================================================================
// Resource Manifest Assembly — A3 Resources
// Assembles ResourceManifest from derived resources, Yunxiao results,
// Terraform outputs, and Redis allocation.
// =============================================================================

import type {
  ProjectInput,
  DerivedResources,
  ResourceManifest,
  ResourcePlan,
  TerraformPlanInfo,
  RedisAllocation,
} from "@/src/types";
import {
  deployPathFrom,
  nginxConfPathFrom,
  terraformWorkDir,
  terraformStateFile,
  dnsRecordTypeForProjectType,
} from "@/src/lib/names";

// ---------------------------------------------------------------------------
// Manifest assembly
// ---------------------------------------------------------------------------

export interface YunxiaoResult {
  codeGroup: { status: "exists" | "created"; path: string };
  repository: { status: "exists" | "created"; path: string; url?: string };
}

export interface ManifestAssemblyInput {
  input: ProjectInput;
  derived: DerivedResources;
  yunxiao: YunxiaoResult;
  terraform: {
    workDir: string;
    statePath: string;
    providerVersion: string;
    outputs?: {
      ossBucketName?: string;
      databaseName?: string;
      databaseInstanceId?: string;
      acrInstanceId?: string;
      dnsTarget?: string;
    };
  };
  redis?: RedisAllocation;
}

/**
 * Assemble a complete ResourceManifest from provisioning results.
 *
 * This function does NOT make any cloud calls — it purely assembles
 * data from the results of provisioning steps (Yunxiao ensure, Terraform apply, etc.).
 */
export function assembleManifest(params: ManifestAssemblyInput): ResourceManifest {
  const { input, derived, yunxiao, terraform, redis } = params;
  const { type, name, domain, servicePort } = input;

  const manifest: ResourceManifest = {
    group: input.group,
    name,
    type,
    domain,
    servicePort,
    codeGroup: yunxiao.codeGroup,
    repository: yunxiao.repository,
    terraform: {
      workDir: terraform.workDir,
      statePath: terraform.statePath,
      providerVersion: terraform.providerVersion,
    },
    dnsRecord: {
      status: "managed",
      domain,
      type: dnsRecordTypeForProjectType(type),
      target: terraform.outputs?.dnsTarget ?? "",
    },
  };

  // Frontend: OSS bucket
  if (type === "frontend" && derived.ossBucketName) {
    manifest.ossBucket = {
      status: "managed",
      name: terraform.outputs?.ossBucketName ?? derived.ossBucketName,
    };
  }

  // Backend: Database, ACR, deploy paths
  if (type === "backend") {
    if (derived.databaseName) {
      manifest.database = {
        status: "managed",
        name: terraform.outputs?.databaseName ?? derived.databaseName,
        instanceId: terraform.outputs?.databaseInstanceId ?? "",
      };
    }

    if (derived.acrRepoName) {
      manifest.acrRepository = {
        status: "managed",
        instanceId: terraform.outputs?.acrInstanceId ?? "",
        namespace: derived.acrNamespace,
        name: derived.acrRepoName,
      };
    }

    manifest.deployPath = deployPathFrom(name);
    manifest.nginxConfPath = nginxConfPathFrom(name);
  }

  // Redis (optional for both types)
  if (redis) {
    manifest.redis = redis;
  }

  return manifest;
}

// ---------------------------------------------------------------------------
// ResourcePlan assembly
// ---------------------------------------------------------------------------

/**
 * Assemble a ResourcePlan from input, derived resources, and Terraform plan result.
 * Used before actual apply — TerraformPlanInfo comes from `terraform plan`.
 */
export function assembleResourcePlan(params: {
  input: ProjectInput;
  derived: DerivedResources;
  terraform: TerraformPlanInfo;
  warnings: string[];
}): ResourcePlan {
  return {
    project: params.input,
    derived: params.derived,
    terraform: params.terraform,
    warnings: params.warnings,
  };
}

// ---------------------------------------------------------------------------
// Terraform defaults helper
// ---------------------------------------------------------------------------

/**
 * Build default Terraform config for a project before plan/apply.
 */
export function defaultTerraformConfig(
  group: string,
  name: string,
  dataDir: string,
  providerVersion: string,
): { workDir: string; statePath: string; providerVersion: string } {
  return {
    workDir: terraformWorkDir(group, name, dataDir),
    statePath: terraformStateFile(),
    providerVersion,
  };
}
