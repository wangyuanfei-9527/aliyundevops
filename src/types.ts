export type ProjectType = "frontend" | "backend";

export type StepType =
  | "ensureCodeGroup"
  | "ensureRepository"
  | "ensureOssBucket"
  | "ensureDatabase"
  | "ensureAcrRepository"
  | "writeDeployScript"
  | "writeNginxConfig"
  | "reloadNginx"
  | "createFrontendPipeline"
  | "createBackendPipeline";

export type ProjectStatus = "planned" | "running" | "created" | "failed";

export interface ProjectInput {
  group: string;
  name: string;
  type: ProjectType;
  domain: string;
  buildCommand?: string;
  artifactDir?: string;
  servicePort?: number;
}

export interface ProjectResources {
  codeGroupPath: string;
  repoPath: string;
  repoUrl?: string;
  ossBucket?: string | null;
  database?: string | null;
  acrRepository?: string | null;
  pipelineId?: string | null;
  deployPath?: string | null;
  nginxConfPath?: string | null;
}

export interface PlanStep {
  type: StepType;
  title: string;
  params: Record<string, unknown>;
}

export interface ExecutionPlan {
  project: ProjectInput;
  resources: ProjectResources;
  steps: PlanStep[];
  warnings: string[];
  assumptions: string[];
}

export interface ProjectRecord {
  id: string;
  runId: string;
  group: string;
  name: string;
  type: ProjectType;
  domain: string;
  status: ProjectStatus;
  resources: ProjectResources;
  plan: ExecutionPlan;
  createdAt: string;
  updatedAt: string;
}

export type LogLevel = "info" | "warn" | "error" | "success";

export interface RunLogEvent {
  time: string;
  level: LogLevel;
  step: string;
  message: string;
  data?: unknown;
}

export interface StepContext {
  plan: ExecutionPlan;
  projectId: string;
  runId: string;
  config: AppConfig;
  log: (event: Omit<RunLogEvent, "time">) => Promise<void>;
}

export interface StepResult {
  step: StepType;
  status: "success" | "failed" | "skipped";
  resourceId?: string;
  message: string;
  data?: unknown;
}

export interface AppConfig {
  executionMode: "dry-run" | "live";
  aliyun: {
    region: string;
    profile?: string;
    ossEndpoint?: string;
  };
  yunxiao: {
    domain: string;
    organizationId: string;
    tokenEnv: string;
  };
  flow: {
    runnerGroup: string;
    container: string;
    serviceConnectionId?: string;
  };
  rds: {
    instanceId: string;
    defaultCharset: string;
  };
  acr: {
    instanceId: string;
    namespace: string;
  };
  ecs: {
    testInstanceId: string;
    appRoot: string;
    nginxConfDir: string;
  };
  domain: {
    allowedRoot: string;
  };
  ai: {
    provider: "openai" | "local";
    model: string;
  };
}
