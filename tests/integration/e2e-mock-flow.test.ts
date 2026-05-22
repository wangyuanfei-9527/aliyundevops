// =============================================================================
// A11 QA — Mock End-to-End Integration Tests
// Simulates the full workflow: derive → plan → manifest → run steps
// All cloud adapters are mocked; no real infrastructure is touched.
// =============================================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { deriveResources } from "@/src/resources/derive";
import { assembleManifest, defaultTerraformConfig } from "@/src/resources/manifest";
import { createProject, getProject, updateProject, updateProjectStatus } from "@/src/storage/projects";
import { appendRunLog, getRunLogs } from "@/src/storage/logs";
import { runProject, validatePlanStepTypes } from "@/src/runner/runProject";
import { MockEcsAdapter, MockOssAdapter } from "@/src/runner/stepRegistry";
import { MockYunxiaoAdapter } from "@/src/lib/yunxiao";
import type {
  ProjectInput,
  DeployPlan,
  PlanStep,
  ResourceManifest,
  RunLog,
} from "@/src/types";

// =============================================================================
// Helpers
// =============================================================================

function makeBackendInput(): ProjectInput {
  return {
    group: "myapp",
    name: "order-service",
    type: "backend",
    domain: "order-test.tzxys.cn",
    servicePort: 18080,
  };
}

function makeFrontendInput(): ProjectInput {
  return {
    group: "myapp",
    name: "admin-web",
    type: "frontend",
    domain: "admin-test.tzxys.cn",
  };
}

const DERIVE_OPTIONS = {
  allowedRootDomains: ["tzxys.cn", "example.com"],
  acrNamespace: "test",
};

function makeManifest(group: string, name: string, type: "frontend" | "backend"): ResourceManifest {
  const derived = deriveResources(
    { group, name, type, domain: `${name}-test.tzxys.cn` },
    DERIVE_OPTIONS,
  );
  return assembleManifest({
    input: { group, name, type, domain: `${name}-test.tzxys.cn` },
    derived,
    yunxiao: {
      codeGroup: { status: "created", path: group },
      repository: { status: "created", path: `${group}/${name}`, url: `https://codeup.example.com/${group}/${name}.git` },
    },
    terraform: {
      workDir: `/tmp/tf/${group}-${name}`,
      statePath: "terraform.tfstate",
      providerVersion: "1.200.0",
      outputs: {
        ossBucketName: type === "frontend" ? derived.ossBucketName : undefined,
        databaseName: type === "backend" ? derived.databaseName : undefined,
        databaseInstanceId: type === "backend" ? "rm-xxx" : undefined,
        acrInstanceId: type === "backend" ? "cr-xxx" : undefined,
        dnsTarget: type === "frontend" ? "oss-endpoint.aliyuncs.com" : "10.0.0.1",
      },
    },
    redis: {
      instanceId: "r-xxx",
      host: "r-xxx.redis.rds.aliyuncs.com",
      port: 6379,
      db: 5,
      passwordEnv: "REDIS_PASSWORD",
    },
  });
}

function makeBackendSteps(): PlanStep[] {
  return [
    { id: "s1", type: "ensureCodeGroup", name: "Create Code Group" },
    { id: "s2", type: "ensureRepository", name: "Create Repository" },
    { id: "s3", type: "commitDockerfile", name: "Commit Dockerfile" },
    { id: "s4", type: "commitBuildConfig", name: "Commit Build Config" },
    { id: "s5", type: "writeDeployScript", name: "Write Deploy Script" },
    { id: "s6", type: "deployToEcs", name: "Deploy to ECS" },
    { id: "s7", type: "writeNginxConfig", name: "Write Nginx Config" },
    { id: "s8", type: "reloadNginx", name: "Reload Nginx" },
    { id: "s9", type: "createBackendPipeline", name: "Create Backend Pipeline" },
  ];
}

function makeFrontendSteps(): PlanStep[] {
  return [
    { id: "s1", type: "ensureCodeGroup", name: "Create Code Group" },
    { id: "s2", type: "ensureRepository", name: "Create Repository" },
    { id: "s3", type: "commitDockerfile", name: "Commit Dockerfile" },
    { id: "s4", type: "configureOssWebsite", name: "Configure OSS Website" },
    { id: "s5", type: "createFrontendPipeline", name: "Create Frontend Pipeline" },
  ];
}

function makeDeployPlan(manifest: ResourceManifest, steps: PlanStep[]): DeployPlan {
  return {
    profile: {
      language: "node",
      framework: "express",
      buildTool: "npm",
      buildCommand: "npm run build",
      needsDatabase: manifest.type === "backend",
      needsRedis: true,
      servicePort: 3000,
      hasDockerfile: false,
      hasDockerCompose: false,
      reasoning: "test plan",
      warnings: [],
    },
    manifest,
    artifacts: {
      dockerfile: "FROM node:18\nCMD [\"node\", \"server.js\"]",
      buildScript: "#!/bin/bash\nnpm run build",
      deployScript: "#!/bin/bash\nset -e\nnpm start",
      nginxConfig: "server { listen 80; }",
      pipelineYaml: "version: 1.0\nstages:\n  - build",
    },
    env: { variables: { NODE_ENV: "production" }, secretEnvNames: [] },
    ports: { servicePort: 3000 },
    steps,
    reasoning: "automated test plan",
    assumptions: [],
    warnings: [],
    manualSteps: [],
  };
}

// Mock Yunxiao adapter (uses real MockYunxiaoAdapter from yunxiao.ts)
function createMockYunxiao() {
  return new MockYunxiaoAdapter();
}

// =============================================================================
// Integration Tests
// =============================================================================

describe("E2E Mock: Backend project full flow", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-backend-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("derives resources → assembles manifest → runs steps → logs persist", async () => {
    const input = makeBackendInput();

    // Step 1: Derive resources
    const derived = deriveResources(input, DERIVE_OPTIONS);
    expect(derived.codeGroupPath).toBe("myapp");
    expect(derived.repositoryPath).toBe("order-service");
    expect(derived.databaseName).toBe("test_myapp_order_service");
    expect(derived.acrRepoName).toBe("order-service");
    expect(derived.dnsSubdomain).toBe("order-test");
    expect(derived.redisDbIndex).toBe(-1); // not yet allocated

    // Step 2: Assemble manifest
    const manifest = makeManifest(input.group, input.name, input.type);
    expect(manifest.codeGroup.path).toBe("myapp");
    expect(manifest.repository.path).toBe("myapp/order-service");
    expect(manifest.database?.name).toBe("test_myapp_order_service");
    expect(manifest.acrRepository?.name).toBe("order-service");
    expect(manifest.redis?.db).toBe(5);
    expect(manifest.dnsRecord.type).toBe("A");
    expect(manifest.deployPath).toBe("/opt/apps/order-service");
    expect(manifest.nginxConfPath).toBe("/etc/nginx/conf.d/order-service.conf");

    // Step 3: Create project record
    const project = createProject(input, tmpDir);
    expect(project.id).toBe("myapp-order-service");
    expect(project.status).toBe("created");

    // Update with manifest
    const updated = updateProject(project.id, { manifest }, tmpDir);
    expect(updated.manifest).toBeDefined();

    // Step 4: Build deploy plan
    const steps = makeBackendSteps();
    const plan = makeDeployPlan(manifest, steps);

    // Validate step types
    const invalid = validatePlanStepTypes(plan);
    expect(invalid).toEqual([]);

    // Update project with deploy plan
    updateProject(project.id, { deployPlan: plan }, tmpDir);
    updateProjectStatus(project.id, "deploy_planned", tmpDir);

    // Verify project state
    const loaded = getProject(project.id, tmpDir);
    expect(loaded!.status).toBe("deploy_planned");
    expect(loaded!.deployPlan).toBeDefined();
    expect(loaded!.deployPlan!.steps).toHaveLength(9);

    // Step 5: Execute plan with mock adapters
    const ecs = new MockEcsAdapter();
    const oss = new MockOssAdapter();
    const yunxiao = createMockYunxiao();

    const log = await runProject({
      plan,
      yunxiao,
      ecs,
      oss,
      authorized: false,
      dataDir: tmpDir,
    });

    // Verify run result
    expect(log.status).toBe("completed");
    expect(log.steps).toHaveLength(9);
    expect(log.steps.every((s) => s.status === "success")).toBe(true);

    // Verify ECS adapter was called
    const cmdLog = ecs.getCommandLog();
    expect(cmdLog.length).toBeGreaterThan(0);

    // Step 6: Verify logs persisted
    const logs = getRunLogs(project.id, tmpDir);
    expect(logs.length).toBeGreaterThan(0);
    expect(logs[0].status).toBe("completed");

    // Step 7: Update project status to completed
    updateProjectStatus(project.id, "completed", tmpDir);
    const final = getProject(project.id, tmpDir);
    expect(final!.status).toBe("completed");
  });
});

describe("E2E Mock: Frontend project full flow", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-frontend-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("derives frontend resources → assembles manifest → runs steps", async () => {
    const input = makeFrontendInput();

    // Derive
    const derived = deriveResources(input, DERIVE_OPTIONS);
    expect(derived.ossBucketName).toBe("test-myapp-admin-web");
    expect(derived.databaseName).toBe(""); // no DB for frontend
    expect(derived.acrRepoName).toBe(""); // no ACR for frontend
    expect(derived.dnsSubdomain).toBe("admin-test");

    // Manifest
    const manifest = makeManifest(input.group, input.name, input.type);
    expect(manifest.ossBucket?.name).toBe("test-myapp-admin-web");
    expect(manifest.database).toBeUndefined();
    expect(manifest.dnsRecord.type).toBe("CNAME");
    expect(manifest.deployPath).toBeUndefined();
    expect(manifest.nginxConfPath).toBeUndefined();

    // Create project
    const project = createProject(input, tmpDir);
    updateProject(project.id, { manifest }, tmpDir);

    // Plan
    const steps = makeFrontendSteps();
    const plan = makeDeployPlan(manifest, steps);
    expect(validatePlanStepTypes(plan)).toEqual([]);

    // Execute
    const ecs = new MockEcsAdapter();
    const oss = new MockOssAdapter();
    const yunxiao = createMockYunxiao();

    const log = await runProject({
      plan,
      yunxiao,
      ecs,
      oss,
      authorized: false,
      dataDir: tmpDir,
    });

    expect(log.status).toBe("completed");
    expect(log.steps).toHaveLength(5);
    expect(log.steps.every((s) => s.status === "success")).toBe(true);

    // Verify OSS adapter was called for configureOssWebsite
    const configs = oss.getWebsiteConfigs();
    expect(configs.length).toBeGreaterThan(0);

    // Logs persisted
    const logs = getRunLogs(project.id, tmpDir);
    expect(logs).toHaveLength(1);
  });
});

describe("E2E Mock: Step failure stops execution and marks remaining skipped", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-failure-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("stops on step failure and marks remaining as skipped", async () => {
    const input = makeBackendInput();
    const manifest = makeManifest(input.group, input.name, input.type);
    const steps: PlanStep[] = [
      { id: "s1", type: "ensureCodeGroup", name: "Step 1" },
      { id: "s2", type: "healthCheck", name: "Step 2 (will fail)" },
      { id: "s3", type: "deployToEcs", name: "Step 3 (should skip)" },
      { id: "s4", type: "reloadNginx", name: "Step 4 (should skip)" },
    ];
    const plan = makeDeployPlan(manifest, steps);

    const ecs = new MockEcsAdapter();
    // Make healthCheck fail by setting deployToEcs result (healthCheck uses runCommand)
    ecs.setNextCommandResult({ success: false, output: "timeout", exitCode: 1 });

    const oss = new MockOssAdapter();
    const yunxiao = createMockYunxiao();

    const log = await runProject({
      plan,
      yunxiao,
      ecs,
      oss,
      authorized: false,
      dataDir: tmpDir,
    });

    expect(log.status).toBe("failed");
    expect(log.steps[0].status).toBe("success"); // ensureCodeGroup
    expect(log.steps[1].status).toBe("failed"); // healthCheck
    expect(log.steps[2].status).toBe("skipped"); // deployToEcs
    expect(log.steps[3].status).toBe("skipped"); // reloadNginx
    expect(log.steps[1].error).toBeTruthy();
    expect(log.finishedAt).toBeDefined();
  });
});

describe("E2E Mock: Terraform defaults and config", () => {
  it("derives correct terraform paths", () => {
    const tf = defaultTerraformConfig("myapp", "order-service", "/data", "1.200.0");
    expect(tf.workDir).toMatch(/terraform[/\\]myapp-order-service/);
    expect(tf.statePath).toBe("terraform.tfstate");
    expect(tf.providerVersion).toBe("1.200.0");
  });
});

describe("E2E Mock: Log round-trip with multiple runs", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-multi-run-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("persists multiple runs and retrieves them in order", async () => {
    const input = makeBackendInput();
    const manifest = makeManifest(input.group, input.name, input.type);

    // Run 1: simple step that succeeds
    const steps1: PlanStep[] = [
      { id: "s1", type: "ensureCodeGroup", name: "Provision" },
    ];
    const plan1 = makeDeployPlan(manifest, steps1);

    const ecs1 = new MockEcsAdapter();
    const oss = new MockOssAdapter();
    const yunxiao1 = createMockYunxiao();

    const log1 = await runProject({
      plan: plan1, yunxiao: yunxiao1, ecs: ecs1, oss, authorized: false, dataDir: tmpDir,
    });
    expect(log1.status).toBe("completed");

    // Small delay to ensure different timestamps
    await new Promise((r) => setTimeout(r, 10));

    // Run 2: step that fails (deployToEcs uses ecs adapter)
    const steps2: PlanStep[] = [
      { id: "s1", type: "deployToEcs", name: "Deploy" },
    ];
    const plan2 = makeDeployPlan(manifest, steps2);

    const ecs2 = new MockEcsAdapter();
    ecs2.setNextCommandResult({ success: false, exitCode: 1, output: "connection refused" });
    const yunxiao2 = createMockYunxiao();

    const log2 = await runProject({
      plan: plan2, yunxiao: yunxiao2, ecs: ecs2, oss, authorized: false, dataDir: tmpDir,
    });
    expect(log2.status).toBe("failed");

    // Verify both runs persisted
    const logs = getRunLogs("myapp-order-service", tmpDir);
    expect(logs).toHaveLength(2);
    expect(logs[0].status).toBe("completed");
    expect(logs[1].status).toBe("failed");
  });
});

describe("E2E Mock: Step type validation catches injected types", () => {
  it("rejects plan with injected shell exec step", () => {
    const manifest = makeManifest("myapp", "order-service", "backend");
    const plan = makeDeployPlan(manifest, [
      { id: "s1", type: "healthCheck", name: "OK" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { id: "s2", type: "execShell" as any, name: "Malicious" },
    ]);
    const invalid = validatePlanStepTypes(plan);
    expect(invalid).toContain("execShell");
  });
});

describe("E2E Mock: Project storage CRUD", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-crud-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates, reads, updates project through full lifecycle", () => {
    const input = makeBackendInput();

    // Create
    const p1 = createProject(input, tmpDir);
    expect(p1.status).toBe("created");

    // Read
    const p2 = getProject(p1.id, tmpDir);
    expect(p2!.input.name).toBe("order-service");

    // Update with manifest
    const manifest = makeManifest(input.group, input.name, input.type);
    updateProject(p1.id, { manifest }, tmpDir);
    updateProjectStatus(p1.id, "resources_provisioned", tmpDir);

    const p3 = getProject(p1.id, tmpDir);
    expect(p3!.status).toBe("resources_provisioned");
    expect(p3!.manifest!.database?.name).toBe("test_myapp_order_service");

    // Update with profile
    updateProject(p1.id, {
      profile: {
        language: "java",
        framework: "spring-boot",
        buildTool: "maven",
        buildCommand: "mvn package -DskipTests",
        needsDatabase: true,
        needsRedis: true,
        servicePort: 18080,
        hasDockerfile: false,
        hasDockerCompose: false,
        reasoning: "Spring Boot backend",
        warnings: [],
      },
    }, tmpDir);
    updateProjectStatus(p1.id, "analyzed", tmpDir);

    const p4 = getProject(p1.id, tmpDir);
    expect(p4!.profile!.language).toBe("java");
    expect(p4!.profile!.framework).toBe("spring-boot");

    // Reject duplicate creation
    expect(() => createProject(input, tmpDir)).toThrow(/already exists/);
  });
});

describe("E2E Mock: Secrets redacted in persisted logs", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-secrets-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("run log with secrets in step params is sanitized on disk", () => {
    const secretValue = "postgres://admin:S3cretPass@db:5432/production";
    const log: RunLog = {
      id: "run-leak-test",
      projectId: "test-project",
      startedAt: new Date().toISOString(),
      status: "completed",
      steps: [
        {
          id: "s1",
          type: "writeDeployScript",
          name: "Write script",
          params: { dbUrl: secretValue },
          status: "success",
        },
      ],
    };

    appendRunLog(log, tmpDir);

    // Read raw file from disk
    const rawPath = path.join(tmpDir, "logs", "test-project.jsonl");
    const rawContent = fs.readFileSync(rawPath, "utf-8");
    expect(rawContent).not.toContain("S3cretPass");
    expect(rawContent).toContain("***");
  });
});
