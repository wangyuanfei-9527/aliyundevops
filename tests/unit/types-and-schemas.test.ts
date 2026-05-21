// =============================================================================
// A1 Types & Schema — Unit Tests
// Validates that Zod schemas accept correct data and reject invalid data.
// =============================================================================

import { describe, it, expect } from "vitest";
import { STEP_TYPES } from "@/src/types";
import {
  ProjectInputSchema,
  PlanStepSchema,
  StepTypeSchema,
  validateProjectInput,
  validateProjectProfile,
  validateDeployPlan,
  validateResourceManifest,
} from "@/src/ai/schemas";
import type {
  ProjectInput,
  ProjectProfile,
  PlanStep,
  DeployPlan,
  ResourceManifest,
} from "@/src/types";

// ---------------------------------------------------------------------------
// Fixtures — valid sample data
// ---------------------------------------------------------------------------

const validProjectInput: ProjectInput = {
  group: "my-group",
  name: "my-project",
  type: "backend",
  domain: "api.example.com",
};

const validProjectInputWithPort: ProjectInput = {
  group: "my-group",
  name: "my-project",
  type: "frontend",
  domain: "app.example.com",
  servicePort: 3000,
};

const validProfile: ProjectProfile = {
  language: "node",
  framework: "next",
  frameworkVersion: "15",
  buildTool: "pnpm",
  buildCommand: "pnpm build",
  artifactDir: ".next",
  runtimeCommand: "pnpm start",
  needsDatabase: false,
  needsRedis: false,
  servicePort: 3000,
  hasDockerfile: true,
  hasDockerCompose: false,
  reasoning: "Next.js frontend project",
  warnings: [],
};

const validManifest: ResourceManifest = {
  group: "my-group",
  name: "my-project",
  type: "backend",
  domain: "api.example.com",
  codeGroup: { status: "created", path: "my-group" },
  repository: { status: "created", path: "my-group/my-project", url: "https://codeup.aliyun.com/my-group/my-project.git" },
  terraform: { workDir: "/data/tf/my-group-my-project", statePath: "terraform.tfstate", providerVersion: "1.227.0" },
  ossBucket: { status: "managed", name: "my-project-static" },
  dnsRecord: { status: "managed", domain: "api.example.com", type: "A", target: "10.0.0.1" },
};

const validStep: PlanStep = {
  id: "step-1",
  type: "commitDockerfile",
  name: "Commit Dockerfile",
  description: "Commit the generated Dockerfile to Codeup",
};

function makeValidDeployPlan(overrides?: Partial<DeployPlan>): DeployPlan {
  return {
    profile: validProfile,
    manifest: validManifest,
    artifacts: { dockerfile: "FROM node:20\nCMD pnpm start" },
    env: { variables: { NODE_ENV: "production" }, secretEnvNames: [] },
    ports: { servicePort: 3000 },
    steps: [
      { id: "step-1", type: "commitDockerfile", name: "Commit Dockerfile" },
      { id: "step-2", type: "healthCheck", name: "Health Check" },
    ],
    reasoning: "Standard Next.js deployment",
    assumptions: ["Node.js 20 runtime"],
    warnings: [],
    manualSteps: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// StepType whitelist
// ---------------------------------------------------------------------------

describe("StepType whitelist", () => {
  it("contains exactly 17 step types", () => {
    expect(STEP_TYPES).toHaveLength(17);
  });

  it("includes all expected step types", () => {
    const expected: string[] = [
      "ensureCodeGroup", "ensureRepository",
      "terraformInit", "terraformPlan", "terraformApply",
      "commitDockerfile", "commitDockerCompose", "commitDeployScript", "commitBuildConfig",
      "writeDeployScript", "deployToEcs", "writeNginxConfig", "reloadNginx",
      "configureOssWebsite", "healthCheck",
      "createFrontendPipeline", "createBackendPipeline",
    ];
    expect([...STEP_TYPES].sort()).toEqual(expected.sort());
  });

  it("rejects illegal step type via schema", () => {
    const result = StepTypeSchema.safeParse("runArbitraryShell");
    expect(result.success).toBe(false);
  });

  it("accepts each valid step type", () => {
    for (const st of STEP_TYPES) {
      expect(StepTypeSchema.safeParse(st).success).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// ProjectInputSchema
// ---------------------------------------------------------------------------

describe("ProjectInputSchema", () => {
  it("accepts valid input without servicePort", () => {
    const result = ProjectInputSchema.safeParse(validProjectInput);
    expect(result.success).toBe(true);
  });

  it("accepts valid input with servicePort", () => {
    const result = ProjectInputSchema.safeParse(validProjectInputWithPort);
    expect(result.success).toBe(true);
  });

  it("rejects empty group", () => {
    const result = validateProjectInput({ ...validProjectInput, group: "" });
    expect(result.success).toBe(false);
  });

  it("rejects empty name", () => {
    const result = validateProjectInput({ ...validProjectInput, name: "" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid type", () => {
    const result = validateProjectInput({ ...validProjectInput, type: "fullstack" });
    expect(result.success).toBe(false);
  });

  it("rejects negative servicePort", () => {
    const result = validateProjectInput({ ...validProjectInput, servicePort: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects missing required fields", () => {
    const result = validateProjectInput({});
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ProjectProfileSchema
// ---------------------------------------------------------------------------

describe("ProjectProfileSchema", () => {
  it("accepts valid profile", () => {
    const result = validateProjectProfile(validProfile);
    expect(result.success).toBe(true);
  });

  it("accepts minimal required fields", () => {
    const minimal = {
      language: "java",
      framework: "spring-boot",
      buildTool: "maven",
      buildCommand: "mvn package",
      needsDatabase: true,
      databaseType: "mysql",
      needsRedis: false,
      servicePort: 8080,
      hasDockerfile: false,
      hasDockerCompose: false,
      reasoning: "Spring Boot backend",
      warnings: [],
    };
    const result = validateProjectProfile(minimal);
    expect(result.success).toBe(true);
  });

  it("rejects invalid language", () => {
    const result = validateProjectProfile({ ...validProfile, language: "ruby" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid databaseType", () => {
    const result = validateProjectProfile({ ...validProfile, databaseType: "oracle" });
    expect(result.success).toBe(false);
  });

  it("rejects missing reasoning", () => {
    const result = validateProjectProfile({ ...validProfile, reasoning: "" });
    expect(result.success).toBe(false);
  });

  it("rejects non-array warnings", () => {
    const result = validateProjectProfile({ ...validProfile, warnings: "some warning" });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PlanStepSchema
// ---------------------------------------------------------------------------

describe("PlanStepSchema", () => {
  it("accepts valid step", () => {
    expect(PlanStepSchema.safeParse(validStep).success).toBe(true);
  });

  it("accepts step with optional fields", () => {
    const step = {
      ...validStep,
      description: "Test step",
      params: { path: "/app" },
      status: "success" as const,
      startedAt: "2025-01-01T00:00:00Z",
      finishedAt: "2025-01-01T00:01:00Z",
    };
    expect(PlanStepSchema.safeParse(step).success).toBe(true);
  });

  it("rejects illegal StepType", () => {
    const result = PlanStepSchema.safeParse({ ...validStep, type: "rm rf" });
    expect(result.success).toBe(false);
  });

  it("rejects missing id", () => {
    const result = PlanStepSchema.safeParse({ ...validStep, id: "" });
    expect(result.success).toBe(false);
  });

  it("rejects missing name", () => {
    const result = PlanStepSchema.safeParse({ ...validStep, name: "" });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ResourceManifestSchema
// ---------------------------------------------------------------------------

describe("ResourceManifestSchema", () => {
  it("accepts valid manifest", () => {
    const result = validateResourceManifest(validManifest);
    expect(result.success).toBe(true);
  });

  it("accepts manifest with all optional fields", () => {
    const full = {
      ...validManifest,
      database: { status: "managed" as const, name: "my_project_db", instanceId: "rm-xxx" },
      acrRepository: { status: "managed" as const, instanceId: "cri-xxx", namespace: "my-group", name: "my-project" },
      redis: { instanceId: "r-xxx", host: "r-xxx.redis.rds.aliyuncs.com", port: 6379, db: 0 },
      deployPath: "/data/app/my-project",
      nginxConfPath: "/etc/nginx/conf.d/my-project.conf",
    };
    const result = validateResourceManifest(full);
    expect(result.success).toBe(true);
  });

  it("rejects manifest missing dnsRecord", () => {
    const { dnsRecord: _, ...withoutDns } = validManifest;
    const result = validateResourceManifest(withoutDns);
    expect(result.success).toBe(false);
  });

  it("rejects invalid status value", () => {
    const result = validateResourceManifest({
      ...validManifest,
      codeGroup: { status: "pending", path: "my-group" },
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// DeployPlanSchema
// ---------------------------------------------------------------------------

describe("DeployPlanSchema", () => {
  it("accepts valid deploy plan", () => {
    const result = validateDeployPlan(makeValidDeployPlan());
    expect(result.success).toBe(true);
  });

  it("rejects plan with empty steps", () => {
    const result = validateDeployPlan(makeValidDeployPlan({ steps: [] }));
    expect(result.success).toBe(false);
  });

  it("rejects plan with duplicate step IDs", () => {
    const result = validateDeployPlan(
      makeValidDeployPlan({
        steps: [
          { id: "s1", type: "commitDockerfile", name: "A" },
          { id: "s1", type: "healthCheck", name: "B" },
        ],
      }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects plan with illegal StepType in steps", () => {
    const result = validateDeployPlan(
      makeValidDeployPlan({
        steps: [
          { id: "s1", type: "runShellScript" as never, name: "Bad" },
        ],
      }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects plan missing profile", () => {
    const { profile: _, ...withoutProfile } = makeValidDeployPlan();
    const result = validateDeployPlan(withoutProfile);
    expect(result.success).toBe(false);
  });

  it("rejects plan missing reasoning", () => {
    const result = validateDeployPlan(makeValidDeployPlan({ reasoning: "" }));
    expect(result.success).toBe(false);
  });

  it("rejects plan with non-string secretEnvNames", () => {
    const result = validateDeployPlan(
      makeValidDeployPlan({
        env: { variables: {}, secretEnvNames: [123 as never] },
      }),
    );
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Cross-cutting: type inference alignment
// ---------------------------------------------------------------------------

describe("Type inference alignment", () => {
  it("STEP_TYPES array values match StepType union", () => {
    // This is a compile-time check; at runtime we verify no duplicates
    const values = [...STEP_TYPES];
    expect(new Set(values).size).toBe(values.length);
  });
});
