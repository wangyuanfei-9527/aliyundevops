// =============================================================================
// Core Types — A1 Types & Schema
// Single source of truth for all domain types used across the project.
// =============================================================================

// ---------------------------------------------------------------------------
// StepType — Runner whitelist of allowed deployment step types
// ---------------------------------------------------------------------------
export const STEP_TYPES = [
  // Phase 1: Yunxiao resource provisioning
  "ensureCodeGroup",
  "ensureRepository",
  // Phase 2: Terraform infrastructure
  "terraformInit",
  "terraformPlan",
  "terraformApply",
  // Phase 3: Codeup file commits
  "commitDockerfile",
  "commitDockerCompose",
  "commitDeployScript",
  "commitBuildConfig",
  // Phase 3: ECS / Nginx / OSS / health check
  "writeDeployScript",
  "deployToEcs",
  "writeNginxConfig",
  "reloadNginx",
  "configureOssWebsite",
  "healthCheck",
  // Phase 3: Yunxiao pipelines
  "createFrontendPipeline",
  "createBackendPipeline",
] as const;

export type StepType = (typeof STEP_TYPES)[number];

// ---------------------------------------------------------------------------
// Project type literals
// ---------------------------------------------------------------------------
export type ProjectType = "frontend" | "backend";

// ---------------------------------------------------------------------------
// Resource status literals
// ---------------------------------------------------------------------------
export type ResourceStatus = "exists" | "created" | "managed" | "skipped";

// ---------------------------------------------------------------------------
// DNS record type
// ---------------------------------------------------------------------------
export type DnsRecordType = "A" | "CNAME";

// ---------------------------------------------------------------------------
// ProjectInput — user-provided project definition
// ---------------------------------------------------------------------------
export interface ProjectInput {
  group: string;
  name: string;
  type: ProjectType;
  domain: string;
  servicePort?: number;
}

// ---------------------------------------------------------------------------
// DerivedResources — deterministic resource name derivation output
// ---------------------------------------------------------------------------
export interface DerivedResources {
  codeGroupPath: string;
  repositoryPath: string;
  ossBucketName: string;
  databaseName: string;
  acrNamespace: string;
  acrRepoName: string;
  dnsSubdomain: string;
  redisDbIndex: number;
}

// ---------------------------------------------------------------------------
// TerraformPlanInfo — Terraform execution result metadata
// ---------------------------------------------------------------------------
export interface TerraformPlanInfo {
  workDir: string;
  statePath: string;
  providerVersion: string;
  hasChanges: boolean;
  createCount: number;
  updateCount: number;
  destroyCount: number;
}

// ---------------------------------------------------------------------------
// ResourcePlan — full resource planning result
// ---------------------------------------------------------------------------
export interface ResourcePlan {
  project: ProjectInput;
  derived: DerivedResources;
  terraform: TerraformPlanInfo;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// RedisAllocation — Redis db allocation info
// ---------------------------------------------------------------------------
export interface RedisAllocation {
  instanceId: string;
  host: string;
  port: number;
  db: number;
  passwordEnv?: string;
}

// ---------------------------------------------------------------------------
// ResourceManifest — complete resource state after provisioning
// ---------------------------------------------------------------------------
export interface ResourceManifest {
  group: string;
  name: string;
  type: ProjectType;
  domain: string;
  servicePort?: number;
  codeGroup: { status: ResourceStatus; path: string };
  repository: { status: ResourceStatus; path: string; url?: string };
  terraform: { workDir: string; statePath: string; providerVersion: string };
  ossBucket?: { status: ResourceStatus; name: string };
  database?: { status: ResourceStatus; name: string; instanceId: string };
  acrRepository?: {
    status: ResourceStatus;
    instanceId: string;
    namespace: string;
    name: string;
  };
  dnsRecord: { status: "managed"; domain: string; type: DnsRecordType; target: string };
  redis?: RedisAllocation;
  deployPath?: string;
  nginxConfPath?: string;
}

// ---------------------------------------------------------------------------
// ProjectProfile — AI analysis output describing the project's tech stack
// ---------------------------------------------------------------------------
export interface ProjectProfile {
  language: "node" | "java" | "go" | "python" | "other";
  framework: string;
  frameworkVersion?: string;
  buildTool: string;
  buildCommand: string;
  artifactDir?: string;
  runtimeCommand?: string;
  needsDatabase: boolean;
  databaseType?: "mysql" | "postgresql" | "mongodb";
  needsRedis: boolean;
  servicePort: number;
  hasDockerfile: boolean;
  hasDockerCompose: boolean;
  reasoning: string;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// PlanStep — a single deployment step in a DeployPlan
// ---------------------------------------------------------------------------
export interface PlanStep {
  id: string;
  type: StepType;
  name: string;
  description?: string;
  params?: Record<string, string>;
  status?: StepStatus;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
}

export type StepStatus = "pending" | "running" | "success" | "failed" | "skipped";

// ---------------------------------------------------------------------------
// DeployPlan — AI deployment plan output
// ---------------------------------------------------------------------------
export interface DeployPlan {
  profile: ProjectProfile;
  manifest: ResourceManifest;
  artifacts: {
    dockerfile?: string;
    dockerCompose?: string;
    deployScript?: string;
    nginxConfig?: string;
    pipelineYaml?: string;
    buildScript?: string;
  };
  env: {
    variables: Record<string, string>;
    secretEnvNames: string[];
  };
  ports: {
    servicePort: number;
    hostPort?: number;
  };
  steps: PlanStep[];
  reasoning: string;
  assumptions: string[];
  warnings: string[];
  manualSteps: string[];
}

// ---------------------------------------------------------------------------
// ProjectRecord — persisted project state in storage
// ---------------------------------------------------------------------------
export interface ProjectRecord {
  id: string;
  input: ProjectInput;
  createdAt: string;
  updatedAt: string;
  manifest?: ResourceManifest;
  profile?: ProjectProfile;
  deployPlan?: DeployPlan;
  status: ProjectRecordStatus;
}

export type ProjectRecordStatus =
  | "created"
  | "resources_planning"
  | "resources_provisioned"
  | "analyzing"
  | "analyzed"
  | "deploy_planning"
  | "deploy_planned"
  | "executing"
  | "completed"
  | "failed";

// ---------------------------------------------------------------------------
// RunLog — execution log entry
// ---------------------------------------------------------------------------
export interface RunLog {
  id: string;
  projectId: string;
  startedAt: string;
  finishedAt?: string;
  status: "running" | "completed" | "failed";
  steps: PlanStep[];
}

// ---------------------------------------------------------------------------
// Config — application configuration
// ---------------------------------------------------------------------------
export interface AppConfig {
  aliyun: {
    region: string;
  };
  yunxiao: {
    organizationId: string;
    baseUrl: string;
  };
  terraform: {
    templateDir: string;
    dataDir: string;
    providerVersion: string;
  };
  redis: {
    instanceId: string;
    host: string;
    port: number;
    passwordEnv: string;
    maxDatabases: number;
  };
  defaults: {
    servicePort: number;
    dnsTTL: number;
  };
}
