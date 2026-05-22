// =============================================================================
// Runner Tests — A8 Runner
// Tests for step registry, step executors, and runProject orchestrator.
// =============================================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  registerStep,
  getStepExecutor,
  executeStep,
  getRegisteredStepTypes,
  isStepRegistered,
  clearRegistry,
  MockEcsAdapter,
  MockOssAdapter,
  type StepContext,
} from "@/src/runner/stepRegistry";
import { runProject, retryStep, validatePlanStepTypes, registerAllSteps } from "@/src/runner/runProject";
import type { DeployPlan, ResourceManifest, ProjectProfile } from "@/src/types";
import { MockYunxiaoAdapter } from "@/src/lib/yunxiao";
import fs from "fs";
import path from "path";
import os from "os";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeManifest(overrides?: Partial<ResourceManifest>): ResourceManifest {
  return {
    group: "test-group",
    name: "test-project",
    type: "backend",
    domain: "api.test.example.com",
    servicePort: 8080,
    codeGroup: { status: "exists", path: "test-group" },
    repository: { status: "exists", path: "test-group/test-project" },
    terraform: { workDir: "/tmp/tf", statePath: "terraform.tfstate", providerVersion: "1.209.0" },
    database: { status: "created", name: "test_db", instanceId: "rm-xxx" },
    acrRepository: { status: "created", instanceId: "cr-xxx", namespace: "test", name: "test-project" },
    dnsRecord: { status: "managed", domain: "api.test.example.com", type: "A", target: "1.2.3.4" },
    redis: { instanceId: "r-xxx", host: "redis.test", port: 6379, db: 1 },
    deployPath: "/opt/apps/test-project",
    nginxConfPath: "/etc/nginx/conf.d/test-project.conf",
    ...overrides,
  };
}

function makeProfile(): ProjectProfile {
  return {
    language: "java",
    framework: "Spring Boot",
    buildTool: "maven",
    buildCommand: "mvn package -DskipTests",
    artifactDir: "target",
    needsDatabase: true,
    databaseType: "mysql",
    needsRedis: true,
    servicePort: 8080,
    hasDockerfile: true,
    hasDockerCompose: false,
    reasoning: "test",
    warnings: [],
  };
}

function makeDeployPlan(overrides?: Partial<DeployPlan>): DeployPlan {
  return {
    profile: makeProfile(),
    manifest: makeManifest(),
    artifacts: {
      dockerfile: "FROM openjdk:17\nCOPY target/app.jar /app.jar",
      deployScript: "#!/bin/bash\njava -jar /app.jar",
      nginxConfig: "server { listen 80; }",
      pipelineYaml: "version: 1.0\nstages: []",
    },
    env: { variables: {}, secretEnvNames: [] },
    ports: { servicePort: 8080 },
    steps: [
      { id: "s1", type: "ensureCodeGroup", name: "Ensure code group" },
      { id: "s2", type: "ensureRepository", name: "Ensure repository" },
      { id: "s3", type: "commitDockerfile", name: "Commit Dockerfile" },
      { id: "s4", type: "writeNginxConfig", name: "Write Nginx config" },
    ],
    reasoning: "test plan",
    assumptions: [],
    warnings: [],
    manualSteps: [],
    ...overrides,
  };
}

function makeStepContext(overrides?: Partial<StepContext>): StepContext {
  return {
    step: { id: "s1", type: "ensureCodeGroup", name: "Test step" },
    plan: makeDeployPlan(),
    adapters: {
      yunxiao: new MockYunxiaoAdapter(),
      ecs: new MockEcsAdapter(),
      oss: new MockOssAdapter(),
    },
    authorized: false,
    dataDir: os.tmpdir(),
    ...overrides,
  };
}

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "runner-test-"));
  return dir;
}

// ---------------------------------------------------------------------------
// Step Registry
// ---------------------------------------------------------------------------

describe("Step Registry", () => {
  beforeEach(() => {
    clearRegistry();
  });

  it("should register and retrieve a step executor", () => {
    const executor = async () => ({ success: true, message: "ok" });
    registerStep("ensureCodeGroup", executor);

    expect(getStepExecutor("ensureCodeGroup")).toBe(executor);
  });

  it("should reject registering unknown step types", () => {
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      registerStep("arbitraryShellExec" as any, async () => ({ success: true }));
    }).toThrow(/unknown step type/);
  });

  it("should list registered step types", () => {
    registerStep("ensureCodeGroup", async () => ({ success: true }));
    registerStep("ensureRepository", async () => ({ success: true }));

    const types = getRegisteredStepTypes();
    expect(types).toContain("ensureCodeGroup");
    expect(types).toContain("ensureRepository");
    expect(types).toHaveLength(2);
  });

  it("should check if a step is registered", () => {
    expect(isStepRegistered("ensureCodeGroup")).toBe(false);
    registerStep("ensureCodeGroup", async () => ({ success: true }));
    expect(isStepRegistered("ensureCodeGroup")).toBe(true);
  });

  it("should execute a registered step", async () => {
    registerStep("ensureCodeGroup", async () => ({
      success: true,
      message: "group created",
    }));

    const ctx = makeStepContext();
    const result = await executeStep(ctx);
    expect(result.success).toBe(true);
    expect(result.message).toBe("group created");
  });

  it("should reject unknown step types at execution time", async () => {
    const ctx = makeStepContext({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      step: { id: "x", type: "arbitraryShellExec" as any, name: "bad" },
    });
    const result = await executeStep(ctx);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/Rejected unknown step type/);
  });

  it("should return failure for unregistered step types", async () => {
    const ctx = makeStepContext({
      step: { id: "x", type: "healthCheck", name: "not registered yet" },
    });
    const result = await executeStep(ctx);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/No executor registered/);
  });

  it("should clear all registrations", () => {
    registerStep("ensureCodeGroup", async () => ({ success: true }));
    registerStep("ensureRepository", async () => ({ success: true }));
    clearRegistry();
    expect(getRegisteredStepTypes()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// registerAllSteps
// ---------------------------------------------------------------------------

describe("registerAllSteps", () => {
  beforeEach(() => {
    clearRegistry();
  });

  it("should register all 17 step types", () => {
    registerAllSteps();
    const types = getRegisteredStepTypes();
    expect(types).toHaveLength(17);
  });

  it("should register every STEP_TYPE", () => {
    registerAllSteps();
    const STEP_TYPES = [
      "ensureCodeGroup", "ensureRepository",
      "terraformInit", "terraformPlan", "terraformApply",
      "commitDockerfile", "commitDockerCompose", "commitDeployScript", "commitBuildConfig",
      "writeDeployScript", "deployToEcs", "writeNginxConfig", "reloadNginx",
      "configureOssWebsite", "healthCheck",
      "createFrontendPipeline", "createBackendPipeline",
    ];
    for (const type of STEP_TYPES) {
      expect(isStepRegistered(type)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Codeup step executors
// ---------------------------------------------------------------------------

describe("Codeup step executors", () => {
  let yunxiao: MockYunxiaoAdapter;

  beforeEach(() => {
    clearRegistry();
    yunxiao = new MockYunxiaoAdapter();
  });

  it("ensureCodeGroup should succeed", async () => {
    registerAllSteps();
    const ctx = makeStepContext({
      adapters: { yunxiao, ecs: new MockEcsAdapter(), oss: new MockOssAdapter() },
    });
    const result = await executeStep(ctx);
    expect(result.success).toBe(true);
    expect(result.message).toMatch(/Code group/);
  });

  it("ensureRepository should succeed", async () => {
    registerAllSteps();
    const ctx = makeStepContext({
      step: { id: "s2", type: "ensureRepository", name: "Ensure repository" },
      adapters: { yunxiao, ecs: new MockEcsAdapter(), oss: new MockOssAdapter() },
    });
    const result = await executeStep(ctx);
    expect(result.success).toBe(true);
    expect(result.message).toMatch(/Repository/);
  });

  it("commitDockerfile should fail without artifact", async () => {
    registerAllSteps();
    const plan = makeDeployPlan({ artifacts: {} });
    const ctx = makeStepContext({
      step: { id: "s3", type: "commitDockerfile", name: "Commit Dockerfile" },
      plan,
      adapters: { yunxiao, ecs: new MockEcsAdapter(), oss: new MockOssAdapter() },
    });
    const result = await executeStep(ctx);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/No Dockerfile content/);
  });

  it("commitDockerfile should commit when artifact exists", async () => {
    registerAllSteps();
    const ctx = makeStepContext({
      step: { id: "s3", type: "commitDockerfile", name: "Commit Dockerfile" },
      adapters: { yunxiao, ecs: new MockEcsAdapter(), oss: new MockOssAdapter() },
    });
    const result = await executeStep(ctx);
    expect(result.success).toBe(true);
    expect(result.message).toMatch(/Dockerfile committed/);
  });

  it("commitBuildConfig should fail without buildScript artifact", async () => {
    registerAllSteps();
    const plan = makeDeployPlan({ artifacts: { buildScript: undefined } });
    const ctx = makeStepContext({
      step: { id: "s5", type: "commitBuildConfig", name: "Build config" },
      plan,
      adapters: { yunxiao, ecs: new MockEcsAdapter(), oss: new MockOssAdapter() },
    });
    const result = await executeStep(ctx);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/No build script content/);
  });
});

// ---------------------------------------------------------------------------
// ECS step executors
// ---------------------------------------------------------------------------

describe("ECS step executors", () => {
  let ecs: MockEcsAdapter;

  beforeEach(() => {
    clearRegistry();
    registerAllSteps();
    ecs = new MockEcsAdapter();
  });

  it("writeDeployScript should fail without deploy path", async () => {
    const plan = makeDeployPlan({
      manifest: makeManifest({ deployPath: undefined }),
    });
    const ctx = makeStepContext({
      step: { id: "ws", type: "writeDeployScript", name: "Write deploy script" },
      plan,
      adapters: { yunxiao: new MockYunxiaoAdapter(), ecs, oss: new MockOssAdapter() },
    });
    const result = await executeStep(ctx);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/No deploy path/);
  });

  it("writeDeployScript should write file to ECS", async () => {
    const ctx = makeStepContext({
      step: { id: "ws", type: "writeDeployScript", name: "Write deploy script" },
      adapters: { yunxiao: new MockYunxiaoAdapter(), ecs, oss: new MockOssAdapter() },
    });
    const result = await executeStep(ctx);
    expect(result.success).toBe(true);

    const files = ecs.getWrittenFiles();
    expect(files.has("/opt/apps/test-project/deploy.sh")).toBe(true);
  });

  it("deployToEcs should fail without deploy path", async () => {
    const plan = makeDeployPlan({
      manifest: makeManifest({ deployPath: undefined }),
    });
    const ctx = makeStepContext({
      step: { id: "d", type: "deployToEcs", name: "Deploy" },
      plan,
      adapters: { yunxiao: new MockYunxiaoAdapter(), ecs, oss: new MockOssAdapter() },
    });
    const result = await executeStep(ctx);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/No deploy path/);
  });

  it("deployToEcs should run command on ECS", async () => {
    const ctx = makeStepContext({
      step: { id: "d", type: "deployToEcs", name: "Deploy" },
      adapters: { yunxiao: new MockYunxiaoAdapter(), ecs, oss: new MockOssAdapter() },
    });
    const result = await executeStep(ctx);
    expect(result.success).toBe(true);

    const commands = ecs.getCommandLog();
    expect(commands).toHaveLength(1);
    expect(commands[0].command).toMatch(/bash deploy\.sh/);
  });

  it("writeNginxConfig should write file to ECS", async () => {
    const ctx = makeStepContext({
      step: { id: "n", type: "writeNginxConfig", name: "Nginx config" },
      adapters: { yunxiao: new MockYunxiaoAdapter(), ecs, oss: new MockOssAdapter() },
    });
    const result = await executeStep(ctx);
    expect(result.success).toBe(true);

    const files = ecs.getWrittenFiles();
    expect(files.has("/etc/nginx/conf.d/test-project.conf")).toBe(true);
    expect(files.get("/etc/nginx/conf.d/test-project.conf")).toContain("server");
  });

  it("writeNginxConfig should fail without artifact", async () => {
    const plan = makeDeployPlan({ artifacts: { nginxConfig: undefined } });
    const ctx = makeStepContext({
      step: { id: "n", type: "writeNginxConfig", name: "Nginx config" },
      plan,
      adapters: { yunxiao: new MockYunxiaoAdapter(), ecs, oss: new MockOssAdapter() },
    });
    const result = await executeStep(ctx);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/No Nginx config content/);
  });

  it("reloadNginx should validate and reload", async () => {
    const ctx = makeStepContext({
      step: { id: "r", type: "reloadNginx", name: "Reload Nginx" },
      adapters: { yunxiao: new MockYunxiaoAdapter(), ecs, oss: new MockOssAdapter() },
    });
    const result = await executeStep(ctx);
    expect(result.success).toBe(true);

    const commands = ecs.getCommandLog();
    expect(commands).toHaveLength(2);
    expect(commands[0].command).toBe("nginx -t");
    expect(commands[1].command).toBe("nginx -s reload");
  });

  it("reloadNginx should fail if validation fails", async () => {
    ecs.setNextCommandResult({ success: false, output: "syntax error" });
    const ctx = makeStepContext({
      step: { id: "r", type: "reloadNginx", name: "Reload Nginx" },
      adapters: { yunxiao: new MockYunxiaoAdapter(), ecs, oss: new MockOssAdapter() },
    });
    const result = await executeStep(ctx);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/validation failed/);
  });
});

// ---------------------------------------------------------------------------
// OSS step executors
// ---------------------------------------------------------------------------

describe("OSS step executors", () => {
  let oss: MockOssAdapter;

  beforeEach(() => {
    clearRegistry();
    registerAllSteps();
    oss = new MockOssAdapter();
  });

  it("configureOssWebsite should fail without OSS bucket", async () => {
    const plan = makeDeployPlan({
      manifest: makeManifest({ ossBucket: undefined }),
    });
    const ctx = makeStepContext({
      step: { id: "o", type: "configureOssWebsite", name: "OSS website" },
      plan,
      adapters: { yunxiao: new MockYunxiaoAdapter(), ecs: new MockEcsAdapter(), oss },
    });
    const result = await executeStep(ctx);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/No OSS bucket/);
  });

  it("configureOssWebsite should configure website hosting", async () => {
    const plan = makeDeployPlan({
      manifest: makeManifest({
        ossBucket: { status: "created", name: "test-bucket" },
      }),
    });
    const ctx = makeStepContext({
      step: { id: "o", type: "configureOssWebsite", name: "OSS website" },
      plan,
      adapters: { yunxiao: new MockYunxiaoAdapter(), ecs: new MockEcsAdapter(), oss },
    });
    const result = await executeStep(ctx);
    expect(result.success).toBe(true);

    const configs = oss.getWebsiteConfigs();
    expect(configs).toHaveLength(1);
    expect(configs[0].bucket).toBe("test-bucket");
  });

  it("configureOssWebsite should use params for pages", async () => {
    const plan = makeDeployPlan({
      manifest: makeManifest({
        ossBucket: { status: "created", name: "test-bucket" },
      }),
    });
    const ctx = makeStepContext({
      step: {
        id: "o",
        type: "configureOssWebsite",
        name: "OSS website",
        params: { indexPage: "home.html", errorPage: "404.html" },
      },
      plan,
      adapters: { yunxiao: new MockYunxiaoAdapter(), ecs: new MockEcsAdapter(), oss },
    });
    const result = await executeStep(ctx);
    expect(result.success).toBe(true);

    const configs = oss.getWebsiteConfigs();
    expect(configs[0].indexPage).toBe("home.html");
    expect(configs[0].errorPage).toBe("404.html");
  });
});

// ---------------------------------------------------------------------------
// Flow step executors
// ---------------------------------------------------------------------------

describe("Flow step executors", () => {
  let yunxiao: MockYunxiaoAdapter;

  beforeEach(() => {
    clearRegistry();
    registerAllSteps();
    yunxiao = new MockYunxiaoAdapter();
  });

  it("createBackendPipeline should fail without pipelineYaml", async () => {
    const plan = makeDeployPlan({ artifacts: { pipelineYaml: undefined } });
    const ctx = makeStepContext({
      step: { id: "bp", type: "createBackendPipeline", name: "Backend pipeline" },
      plan,
      adapters: { yunxiao, ecs: new MockEcsAdapter(), oss: new MockOssAdapter() },
    });
    const result = await executeStep(ctx);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/No pipeline YAML/);
  });

  it("createBackendPipeline should create pipeline", async () => {
    const ctx = makeStepContext({
      step: { id: "bp", type: "createBackendPipeline", name: "Backend pipeline" },
      adapters: { yunxiao, ecs: new MockEcsAdapter(), oss: new MockOssAdapter() },
    });
    const result = await executeStep(ctx);
    expect(result.success).toBe(true);

    const pipelines = yunxiao.getPipelines();
    expect(pipelines).toHaveLength(1);
    expect(pipelines[0].name).toContain("backend");
  });

  it("createFrontendPipeline should create pipeline", async () => {
    const ctx = makeStepContext({
      step: { id: "fp", type: "createFrontendPipeline", name: "Frontend pipeline" },
      adapters: { yunxiao, ecs: new MockEcsAdapter(), oss: new MockOssAdapter() },
    });
    const result = await executeStep(ctx);
    expect(result.success).toBe(true);

    const pipelines = yunxiao.getPipelines();
    expect(pipelines).toHaveLength(1);
    expect(pipelines[0].name).toContain("frontend");
  });
});

// ---------------------------------------------------------------------------
// runProject orchestrator
// ---------------------------------------------------------------------------

describe("runProject orchestrator", () => {
  let dataDir: string;

  beforeEach(() => {
    clearRegistry();
    dataDir = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("should execute all steps sequentially on success", async () => {
    const plan = makeDeployPlan();
    const log = await runProject({
      plan,
      yunxiao: new MockYunxiaoAdapter(),
      ecs: new MockEcsAdapter(),
      oss: new MockOssAdapter(),
      dataDir,
    });

    expect(log.status).toBe("completed");
    expect(log.steps).toHaveLength(4);
    for (const step of log.steps) {
      expect(step.status).toBe("success");
      expect(step.startedAt).toBeDefined();
      expect(step.finishedAt).toBeDefined();
    }
    expect(log.finishedAt).toBeDefined();
  });

  it("should stop on first failure and skip remaining", async () => {
    const ecs = new MockEcsAdapter();
    // writeNginxConfig step will fail because ecs.writeFile returns failure
    ecs.setNextWriteResult({ success: false });

    const plan = makeDeployPlan({
      steps: [
        { id: "s1", type: "ensureCodeGroup", name: "Step 1" },
        { id: "s2", type: "ensureRepository", name: "Step 2" },
        { id: "s3", type: "commitDockerfile", name: "Step 3" },
        { id: "s4", type: "writeNginxConfig", name: "Step 4 - will fail" },
        { id: "s5", type: "reloadNginx", name: "Step 5 - should be skipped" },
      ],
    });

    const log = await runProject({
      plan,
      yunxiao: new MockYunxiaoAdapter(),
      ecs,
      oss: new MockOssAdapter(),
      dataDir,
    });

    expect(log.status).toBe("failed");
    // First 3 steps succeed (yunxiao + codeup), step 4 fails
    expect(log.steps[0].status).toBe("success");
    expect(log.steps[1].status).toBe("success");
    expect(log.steps[2].status).toBe("success");
    expect(log.steps[3].status).toBe("failed");
    expect(log.steps[4].status).toBe("skipped");
    expect(log.finishedAt).toBeDefined();
  });

  it("should write logs to storage", async () => {
    const plan = makeDeployPlan();
    const log = await runProject({
      plan,
      yunxiao: new MockYunxiaoAdapter(),
      ecs: new MockEcsAdapter(),
      oss: new MockOssAdapter(),
      dataDir,
    });

    // Check log file exists
    const logFile = path.join(dataDir, "logs", `${log.projectId}.jsonl`);
    expect(fs.existsSync(logFile)).toBe(true);

    const content = fs.readFileSync(logFile, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(1);

    const lastEntry = JSON.parse(lines[lines.length - 1]);
    expect(lastEntry.status).toBe("completed");
  });

  it("should handle empty steps array", async () => {
    const plan = makeDeployPlan({ steps: [] });
    const log = await runProject({
      plan,
      yunxiao: new MockYunxiaoAdapter(),
      ecs: new MockEcsAdapter(),
      oss: new MockOssAdapter(),
      dataDir,
    });

    expect(log.status).toBe("completed");
    expect(log.steps).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// retryStep
// ---------------------------------------------------------------------------

describe("retryStep", () => {
  let dataDir: string;

  beforeEach(() => {
    clearRegistry();
    dataDir = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("should retry a failed step and succeed", async () => {
    const ecs = new MockEcsAdapter();
    // First run: writeNginxConfig will fail
    ecs.setNextWriteResult({ success: false });

    const plan = makeDeployPlan({
      steps: [
        { id: "s1", type: "ensureCodeGroup", name: "Step 1" },
        { id: "s2", type: "writeNginxConfig", name: "Step 2 - fails first" },
      ],
    });

    // Run — step 2 fails
    const log = await runProject({
      plan,
      yunxiao: new MockYunxiaoAdapter(),
      ecs,
      oss: new MockOssAdapter(),
      dataDir,
    });

    expect(log.status).toBe("failed");
    expect(log.steps[1].status).toBe("failed");

    // Retry — now it succeeds
    const updatedLog = await retryStep(log, "s2", {
      plan,
      yunxiao: new MockYunxiaoAdapter(),
      ecs: new MockEcsAdapter(), // fresh adapter — default success
      oss: new MockOssAdapter(),
      dataDir,
    });

    expect(updatedLog.steps[1].status).toBe("success");
  });

  it("should throw for non-existent step ID", async () => {
    const plan = makeDeployPlan({ steps: [
      { id: "s1", type: "ensureCodeGroup", name: "Step 1" },
    ] });
    const log = await runProject({
      plan,
      yunxiao: new MockYunxiaoAdapter(),
      ecs: new MockEcsAdapter(),
      oss: new MockOssAdapter(),
      dataDir,
    });

    await expect(
      retryStep(log, "nonexistent", {
        plan,
        yunxiao: new MockYunxiaoAdapter(),
        ecs: new MockEcsAdapter(),
        oss: new MockOssAdapter(),
        dataDir,
      }),
    ).rejects.toThrow(/not found/);
  });

  it("should throw when retrying a non-failed step", async () => {
    const plan = makeDeployPlan({ steps: [
      { id: "s1", type: "ensureCodeGroup", name: "Step 1" },
    ] });
    const log = await runProject({
      plan,
      yunxiao: new MockYunxiaoAdapter(),
      ecs: new MockEcsAdapter(),
      oss: new MockOssAdapter(),
      dataDir,
    });

    await expect(
      retryStep(log, "s1", {
        plan,
        yunxiao: new MockYunxiaoAdapter(),
        ecs: new MockEcsAdapter(),
        oss: new MockOssAdapter(),
        dataDir,
      }),
    ).rejects.toThrow(/not in failed state/);
  });
});

// ---------------------------------------------------------------------------
// validatePlanStepTypes
// ---------------------------------------------------------------------------

describe("validatePlanStepTypes", () => {
  it("should return empty array for valid plan", () => {
    const plan = makeDeployPlan();
    const invalid = validatePlanStepTypes(plan);
    expect(invalid).toHaveLength(0);
  });

  it("should return invalid step types", () => {
    const plan = makeDeployPlan({
      steps: [
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { id: "s1", type: "ensureCodeGroup" as any, name: "ok" },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { id: "s2", type: "arbitraryShellExec" as any, name: "bad" },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { id: "s3", type: "rmRf" as any, name: "worse" },
      ],
    });
    const invalid = validatePlanStepTypes(plan);
    expect(invalid).toHaveLength(2);
    expect(invalid).toContain("arbitraryShellExec");
    expect(invalid).toContain("rmRf");
  });
});

// ---------------------------------------------------------------------------
// RDS / ACR helpers
// ---------------------------------------------------------------------------

describe("RDS / ACR helpers", () => {
  it("hasDatabase should return true when database exists", async () => {
    const { hasDatabase } = await import("@/src/runner/steps/rds");
    const manifest = makeManifest();
    expect(hasDatabase(manifest)).toBe(true);
  });

  it("hasDatabase should return false when no database", async () => {
    const { hasDatabase } = await import("@/src/runner/steps/rds");
    const manifest = makeManifest({ database: undefined });
    expect(hasDatabase(manifest)).toBe(false);
  });

  it("getDatabaseName should return the database name", async () => {
    const { getDatabaseName } = await import("@/src/runner/steps/rds");
    const manifest = makeManifest();
    expect(getDatabaseName(manifest)).toBe("test_db");
  });

  it("getDatabaseName should return null when no database", async () => {
    const { getDatabaseName } = await import("@/src/runner/steps/rds");
    const manifest = makeManifest({ database: undefined });
    expect(getDatabaseName(manifest)).toBeNull();
  });

  it("getImageTag should return full image tag", async () => {
    const { getImageTag } = await import("@/src/runner/steps/acr");
    const manifest = makeManifest();
    expect(getImageTag(manifest)).toBe("test/test-project:latest");
  });

  it("getImageTag should return null when no ACR", async () => {
    const { getImageTag } = await import("@/src/runner/steps/acr");
    const manifest = makeManifest({ acrRepository: undefined });
    expect(getImageTag(manifest)).toBeNull();
  });

  it("getImageTag should use custom tag", async () => {
    const { getImageTag } = await import("@/src/runner/steps/acr");
    const manifest = makeManifest();
    expect(getImageTag(manifest, "v1.2.3")).toBe("test/test-project:v1.2.3");
  });
});

// ---------------------------------------------------------------------------
// Mock adapters
// ---------------------------------------------------------------------------

describe("Mock adapters", () => {
  it("MockEcsAdapter should track commands and files", async () => {
    const ecs = new MockEcsAdapter();
    await ecs.runCommand("ls");
    await ecs.runCommand("pwd");
    await ecs.writeFile("/tmp/test.txt", "hello");

    expect(ecs.getCommandLog()).toHaveLength(2);
    expect(ecs.getWrittenFiles().get("/tmp/test.txt")).toBe("hello");
  });

  it("MockEcsAdapter should respect setNextCommandResult", async () => {
    const ecs = new MockEcsAdapter();
    ecs.setNextCommandResult({ success: false, output: "error" });
    const result = await ecs.runCommand("bad-command");
    expect(result.success).toBe(false);
    expect(result.output).toBe("error");

    // Reset to default
    const result2 = await ecs.runCommand("ok-command");
    expect(result2.success).toBe(true);
  });

  it("MockOssAdapter should track website configs", async () => {
    const oss = new MockOssAdapter();
    await oss.configureWebsite("bucket1", "index.html", "error.html");
    await oss.configureWebsite("bucket2", "home.html", "404.html");

    const configs = oss.getWebsiteConfigs();
    expect(configs).toHaveLength(2);
    expect(configs[0].bucket).toBe("bucket1");
    expect(configs[1].indexPage).toBe("home.html");
  });

  it("MockOssAdapter should respect setNextResult", async () => {
    const oss = new MockOssAdapter();
    oss.setNextResult({ success: false });
    const result = await oss.configureWebsite("bucket", "index.html", "error.html");
    expect(result.success).toBe(false);
  });
});
