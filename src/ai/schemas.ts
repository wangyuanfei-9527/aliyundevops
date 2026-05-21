// =============================================================================
// Zod Runtime Schemas — A1 Types & Schema
// Runtime validation schemas for AI outputs and API inputs.
// These mirror the TypeScript types in src/types.ts for runtime safety.
// =============================================================================

import { z } from "zod";
import { STEP_TYPES } from "@/src/types";

// ---------------------------------------------------------------------------
// Primitive literal schemas
// ---------------------------------------------------------------------------
export const StepTypeSchema = z.enum(STEP_TYPES);

export const ProjectTypeSchema = z.enum(["frontend", "backend"]);

export const ResourceStatusSchema = z.enum(["exists", "created", "managed", "skipped"]);

export const DnsRecordTypeSchema = z.enum(["A", "CNAME"]);

// ---------------------------------------------------------------------------
// ProjectInput — API input validation
// ---------------------------------------------------------------------------
export const ProjectInputSchema = z.object({
  group: z.string().min(1, "group is required"),
  name: z.string().min(1, "name is required"),
  type: ProjectTypeSchema,
  domain: z.string().min(1, "domain is required"),
  servicePort: z.number().int().positive().optional(),
});

// ---------------------------------------------------------------------------
// ProjectProfile — AI analyzer output validation
// ---------------------------------------------------------------------------
export const ProjectProfileSchema = z.object({
  language: z.enum(["node", "java", "go", "python", "other"]),
  framework: z.string().min(1),
  frameworkVersion: z.string().optional(),
  buildTool: z.string().min(1),
  buildCommand: z.string().min(1),
  artifactDir: z.string().optional(),
  runtimeCommand: z.string().optional(),
  needsDatabase: z.boolean(),
  databaseType: z.enum(["mysql", "postgresql", "mongodb"]).optional(),
  needsRedis: z.boolean(),
  servicePort: z.number().int().positive(),
  hasDockerfile: z.boolean(),
  hasDockerCompose: z.boolean(),
  reasoning: z.string().min(1),
  warnings: z.array(z.string()),
});

// ---------------------------------------------------------------------------
// PlanStep — deployment step validation
// ---------------------------------------------------------------------------
export const PlanStepSchema = z.object({
  id: z.string().min(1),
  type: StepTypeSchema,
  name: z.string().min(1),
  description: z.string().optional(),
  params: z.record(z.string(), z.string()).optional(),
  status: z.enum(["pending", "running", "success", "failed", "skipped"]).optional(),
  error: z.string().optional(),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
});

// ---------------------------------------------------------------------------
// ResourceManifest — resource state validation
// ---------------------------------------------------------------------------
export const ResourceManifestSchema = z.object({
  group: z.string().min(1),
  name: z.string().min(1),
  type: ProjectTypeSchema,
  domain: z.string().min(1),
  servicePort: z.number().int().positive().optional(),
  codeGroup: z.object({
    status: ResourceStatusSchema,
    path: z.string().min(1),
  }),
  repository: z.object({
    status: ResourceStatusSchema,
    path: z.string().min(1),
    url: z.string().optional(),
  }),
  terraform: z.object({
    workDir: z.string().min(1),
    statePath: z.string().min(1),
    providerVersion: z.string().min(1),
  }),
  ossBucket: z
    .object({
      status: ResourceStatusSchema,
      name: z.string().min(1),
    })
    .optional(),
  database: z
    .object({
      status: ResourceStatusSchema,
      name: z.string().min(1),
      instanceId: z.string().min(1),
    })
    .optional(),
  acrRepository: z
    .object({
      status: ResourceStatusSchema,
      instanceId: z.string().min(1),
      namespace: z.string().min(1),
      name: z.string().min(1),
    })
    .optional(),
  dnsRecord: z.object({
    status: z.literal("managed"),
    domain: z.string().min(1),
    type: DnsRecordTypeSchema,
    target: z.string().min(1),
  }),
  redis: z
    .object({
      instanceId: z.string().min(1),
      host: z.string().min(1),
      port: z.number().int().positive(),
      db: z.number().int().nonnegative(),
      passwordEnv: z.string().optional(),
    })
    .optional(),
  deployPath: z.string().optional(),
  nginxConfPath: z.string().optional(),
});

// ---------------------------------------------------------------------------
// DeployPlan — AI deployment plan output validation
// ---------------------------------------------------------------------------
export const DeployPlanSchema = z
  .object({
    profile: ProjectProfileSchema,
    manifest: ResourceManifestSchema,
    artifacts: z.object({
      dockerfile: z.string().optional(),
      dockerCompose: z.string().optional(),
      deployScript: z.string().optional(),
      nginxConfig: z.string().optional(),
      pipelineYaml: z.string().optional(),
      buildScript: z.string().optional(),
    }),
    env: z.object({
      variables: z.record(z.string(), z.string()),
      secretEnvNames: z.array(z.string()),
    }),
    ports: z.object({
      servicePort: z.number().int().positive(),
      hostPort: z.number().int().positive().optional(),
    }),
    steps: z
      .array(PlanStepSchema)
      .min(1, "DeployPlan must have at least one step")
      .refine(
        (steps) => {
          const ids = steps.map((s) => s.id);
          return new Set(ids).size === ids.length;
        },
        { message: "Step IDs must be unique within a DeployPlan" },
      ),
    reasoning: z.string().min(1),
    assumptions: z.array(z.string()),
    warnings: z.array(z.string()),
    manualSteps: z.array(z.string()),
  })
  .refine(
    (plan) => {
      // Ensure no step uses a type outside the whitelist
      // (redundant with StepTypeSchema but provides a second layer)
      return plan.steps.every((s) => (STEP_TYPES as readonly string[]).includes(s.type));
    },
    { message: "DeployPlan contains steps with illegal StepType" },
  );

// ---------------------------------------------------------------------------
// Helper: validate with descriptive error
// ---------------------------------------------------------------------------
export function validateProjectInput(data: unknown) {
  return ProjectInputSchema.safeParse(data);
}

export function validateProjectProfile(data: unknown) {
  return ProjectProfileSchema.safeParse(data);
}

export function validateDeployPlan(data: unknown) {
  return DeployPlanSchema.safeParse(data);
}

export function validateResourceManifest(data: unknown) {
  return ResourceManifestSchema.safeParse(data);
}
