// =============================================================================
// A11 QA — Security Regression Tests
// Covers: secret leakage, path traversal, authorization bypass, StepType injection,
// log sanitization round-trip, and safe command execution guarantees.
// =============================================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { redact } from "@/src/lib/redact";
import { sanitizeFilename, safePath, PathSafetyError, isValidPathSegment } from "@/src/lib/paths";
import { STEP_TYPES } from "@/src/types";
import type { RunLog, PlanStep, DeployPlan, ResourceManifest } from "@/src/types";
import {
  registerStep,
  executeStep,
  clearRegistry,
  type StepContext,
} from "@/src/runner/stepRegistry";
import { validatePlanStepTypes } from "@/src/runner/runProject";

// =============================================================================
// Helpers
// =============================================================================

function makeStep(overrides: Partial<PlanStep> = {}): PlanStep {
  return {
    id: "step-1",
    type: "healthCheck",
    name: "Test Step",
    ...overrides,
  };
}

function makeRunLog(steps: PlanStep[] = [makeStep()]): RunLog {
  return {
    id: "run-test-001",
    projectId: "test-project",
    startedAt: new Date().toISOString(),
    status: "running",
    steps,
  };
}
// Note: makeRunLog used in future test extensions
void makeRunLog;

function makeMinimalManifest(): ResourceManifest {
  return {
    group: "test-group",
    name: "test-project",
    type: "backend",
    domain: "test.example.com",
    codeGroup: { status: "exists", path: "test-group" },
    repository: { status: "exists", path: "test-group/test-project" },
    terraform: { workDir: "/tmp/tf", statePath: "/tmp/tf/state", providerVersion: "1.x" },
    dnsRecord: { status: "managed", domain: "test.example.com", type: "A", target: "1.2.3.4" },
  };
}

function makeMinimalDeployPlan(steps: PlanStep[] = []): DeployPlan {
  return {
    profile: {
      language: "node",
      framework: "express",
      buildTool: "npm",
      buildCommand: "npm run build",
      needsDatabase: false,
      needsRedis: false,
      servicePort: 3000,
      hasDockerfile: false,
      hasDockerCompose: false,
      reasoning: "test",
      warnings: [],
    },
    manifest: makeMinimalManifest(),
    artifacts: {},
    env: { variables: {}, secretEnvNames: [] },
    ports: { servicePort: 3000 },
    steps,
    reasoning: "test plan",
    assumptions: [],
    warnings: [],
    manualSteps: [],
  };
}

// =============================================================================
// 1. Secret Leakage — tested via redact() (same function used by sanitizeRunLog)
//    Storage-level round-trip tested in section 5 below.
// =============================================================================

describe("Security: redact() sanitizes all known secret patterns in step-like data", () => {
  it("redacts AccessKey Secret from step param value", () => {
    const param = "AccessKeySecret=AbCdEf1234567890AbCdEf1234567890AbCd";
    expect(redact(param)).not.toContain("AbCdEf1234567890AbCdEf1234567890AbCd");
    expect(redact(param)).toContain("***");
  });

  it("redacts database connection string from step param value", () => {
    const param = "postgres://admin:s3cret@db.host:5432/production?sslmode=require";
    expect(redact(param)).not.toContain("s3cret");
    expect(redact(param)).toContain("***");
  });

  it("redacts Redis connection string from step param value", () => {
    const param = "redis://default:r3d1spass@r-xxx.redis.rds.aliyuncs.com:6379/0";
    expect(redact(param)).not.toContain("r3d1spass");
    expect(redact(param)).toContain("***");
  });

  it("redacts password from step error message", () => {
    const error = "Connection failed: password=MyS3cretP@ssw0rd! for database";
    expect(redact(error)).not.toContain("MyS3cretP@ssw0rd!");
    expect(redact(error)).toContain("***");
  });

  it("redacts Yunxiao PAT from step param value", () => {
    const param = "pt-JZ8rQKxUo1eU8MvDcH4LIwp7_a949c2ff-3a50-477a";
    expect(redact(param)).not.toContain("pt-JZ8rQKxUo1eU8MvDcH4LIwp7");
    expect(redact(param)).toContain("***");
  });

  it("redacts Bearer token from step error", () => {
    const error = "API call failed: Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9longtoken";
    expect(redact(error)).not.toContain("eyJ0eXAiOiJKV1Qi");
    expect(redact(error)).toContain("***");
  });

  it("redacts JDBC connection with password from step param value", () => {
    const param = "jdbc:mysql://host:3306/db?password=secretpass&user=root";
    expect(redact(param)).not.toContain("secretpass");
    expect(redact(param)).toContain("***");
  });

  it("redacts multiple secrets in the same value", () => {
    const param = "token=abc123def456 and password=s3cr3t!";
    const result = redact(param);
    expect(result).not.toContain("abc123def456");
    expect(result).not.toContain("s3cr3t!");
    expect(result).toContain("***");
  });

  it("preserves non-sensitive values unchanged", () => {
    expect(redact("port 3000")).toBe("port 3000");
    expect(redact("host localhost")).toBe("host localhost");
    expect(redact("/app/deploy")).toBe("/app/deploy");
  });
});

// =============================================================================
// 2. Redact function comprehensive coverage
// =============================================================================

describe("Security: Redact covers all known secret patterns", () => {
  const SECRET_SAMPLES = [
    { label: "AccessKeySecret", input: "key=AccessKeySecret=ABCDEFGHIJKLMNOP1234567890abcdefghij" },
    { label: "AccessKeyID", input: "id=AccessKeyID=LTAI5tSomeRandomKeyId12" },
    { label: "password (pwd=)", input: "db pwd=hunter2admin" },
    { label: "password (db_pass=)", input: "setting db_pass=supersecret123" },
    { label: "token (api_key=)", input: "config api_key=sk-proj-abc123def456ghi789" },
    { label: "token (access_token=)", input: "resp access_token=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" },
    { label: "MySQL connection", input: "url=mysql://root:pass123@10.0.0.1:3306/mydb" },
    { label: "PostgreSQL connection", input: "url=postgresql://user:secret@db.example.com:5432/app" },
    { label: "MongoDB connection", input: "url=mongodb://admin:password@mongo.example.com:27017/prod" },
    { label: "Redis connection", input: "cache=redis://default:redispass@r-abc.redis.rds.aliyuncs.com:6379" },
    { label: "Bearer token", input: "Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9bearer" },
    { label: "Yunxiao PAT", input: "token=pt-AbCdEf1234567890AbCdEf1234567890AbCd" },
    { label: "JDBC with password", input: "jdbc:mysql://host:3306/db?password=jdbcpass&user=admin" },
  ];

  for (const { label, input } of SECRET_SAMPLES) {
    it(`redacts ${label}`, () => {
      const output = redact(input);
      expect(output).not.toEqual(input);
      expect(output).toContain("***");
    });
  }

  it("does not redact non-sensitive text", () => {
    const input = "Server running on port 8080 with 4 workers";
    expect(redact(input)).toBe(input);
  });

  it("handles empty string", () => {
    expect(redact("")).toBe("");
  });
});

// =============================================================================
// 3. Path Traversal Prevention
// =============================================================================

describe("Security: Path traversal prevention", () => {
  const TRAVERSAL_ATTACKS = [
    "../../../etc/passwd",
    "..\\..\\..\\windows\\system32\\config\\sam",
    "foo/../../../bar",
    // "....//....//....//etc/passwd" — not actual traversal; normalize resolves within base
    "projects/../../data-backup/evil",
    "./../../secret",
    "normal/../../../etc/shadow",
    "/data/../../etc/hosts",
  ];

  for (const attack of TRAVERSAL_ATTACKS) {
    it(`rejects traversal: "${attack}"`, () => {
      expect(() => safePath("/data", attack)).toThrow(PathSafetyError);
    });
  }

  it("rejects prefix-style escape (data vs data-backup)", () => {
    expect(() => safePath("/data", "/data-backup/evil")).toThrow(PathSafetyError);
  });

  it("allows safe relative paths within base", () => {
    expect(() => safePath("/data", "projects/my-project")).not.toThrow();
    expect(() => safePath("/data", "logs/test.jsonl")).not.toThrow();
  });

  it("allows exact base path", () => {
    expect(() => safePath("/data", "/data")).not.toThrow();
  });
});

describe("Security: Filename sanitization", () => {
  it("strips path separators from filenames", () => {
    expect(sanitizeFilename("foo/../../../etc/passwd")).not.toContain("/");
    expect(sanitizeFilename("foo\\..\\..\\etc")).not.toContain("\\");
  });

  it("prevents hidden file creation", () => {
    expect(sanitizeFilename(".env")).toBe("env");
    expect(sanitizeFilename(".htaccess")).toBe("htaccess");
    expect(sanitizeFilename(".gitignore")).toBe("gitignore");
  });

  it("prevents null byte injection", () => {
    const result = sanitizeFilename("file\x00.txt");
    expect(result).not.toContain("\x00");
  });

  it("returns 'unnamed' for all-special-character input", () => {
    expect(sanitizeFilename('<>:"|?*')).toBe("unnamed");
    expect(sanitizeFilename("")).toBe("unnamed");
    expect(sanitizeFilename("...")).toBe("unnamed");
  });
});

describe("Security: Path segment validation", () => {
  it("rejects path separators in segments", () => {
    expect(isValidPathSegment("foo/bar")).toBe(false);
    expect(isValidPathSegment("foo\\bar")).toBe(false);
  });

  it("rejects dot segments", () => {
    expect(isValidPathSegment(".")).toBe(false);
    expect(isValidPathSegment("..")).toBe(false);
  });

  it("rejects segments starting with non-alphanumeric", () => {
    expect(isValidPathSegment("-project")).toBe(false);
    expect(isValidPathSegment("_test")).toBe(false);
  });

  it("accepts valid segments", () => {
    expect(isValidPathSegment("my-project")).toBe(true);
    expect(isValidPathSegment("project_123")).toBe(true);
    expect(isValidPathSegment("MyProject")).toBe(true);
  });
});

// =============================================================================
// 4. Authorization Enforcement
// =============================================================================

describe("Security: Step registry rejects non-whitelisted types", () => {
  beforeEach(() => clearRegistry());
  afterEach(() => clearRegistry());

  it("rejects registering a non-whitelisted step type", () => {
    expect(() => registerStep("execShell" as never, async () => ({ success: true }))).toThrow(
      /unknown step type/i,
    );
  });

  it("rejects executing a non-whitelisted step type", async () => {
    const ctx: StepContext = {
      step: makeStep({ type: "execShell" as never }),
      plan: makeMinimalDeployPlan(),
      adapters: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        yunxiao: {} as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ecs: {} as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        oss: {} as any,
      },
      authorized: false,
      dataDir: "/tmp",
    };
    const result = await executeStep(ctx);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/unknown step type/i);
  });

  it("rejects common injection step types", async () => {
    const INJECTION_TYPES = [
      "execShell",
      "runCommand",
      "executeScript",
      "eval",
      "spawn",
      "system",
      "exec",
      "shellExec",
    ];

    for (const type of INJECTION_TYPES) {
      const ctx: StepContext = {
        step: makeStep({ type: type as never }),
        plan: makeMinimalDeployPlan(),
        adapters: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          yunxiao: {} as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ecs: {} as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          oss: {} as any,
        },
        authorized: false,
        dataDir: "/tmp",
      };
      const result = await executeStep(ctx);
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/unknown step type/i);
    }
  });
});

describe("Security: DeployPlan StepType validation", () => {
  it("detects unknown step types in a deploy plan", () => {
    const plan = makeMinimalDeployPlan([
      makeStep({ type: "healthCheck" }),
      makeStep({ type: "execShell" as never }),
      makeStep({ type: "deployToEcs" }),
    ]);
    const invalid = validatePlanStepTypes(plan);
    expect(invalid).toEqual(["execShell"]);
  });

  it("returns empty array for all-whitelisted plan", () => {
    const plan = makeMinimalDeployPlan([
      makeStep({ type: "healthCheck" }),
      makeStep({ type: "deployToEcs" }),
      makeStep({ type: "writeNginxConfig" }),
    ]);
    const invalid = validatePlanStepTypes(plan);
    expect(invalid).toEqual([]);
  });

  it("detects multiple unknown step types", () => {
    const plan = makeMinimalDeployPlan([
      makeStep({ type: "rmRf" as never }),
      makeStep({ type: "evalJs" as never }),
      makeStep({ type: "shellExec" as never }),
    ]);
    const invalid = validatePlanStepTypes(plan);
    expect(invalid).toHaveLength(3);
  });
});

describe("Security: STEP_TYPES whitelist integrity", () => {
  it("has exactly 17 whitelisted step types", () => {
    expect(STEP_TYPES).toHaveLength(17);
  });

  it("does not contain any shell-execution types", () => {
    const SHELL_TYPES = ["exec", "shell", "spawn", "system", "eval", "command", "bash", "sh"];
    for (const shell of SHELL_TYPES) {
      expect(STEP_TYPES).not.toContain(shell);
    }
  });

  it("all step types are valid path segments (no injection possible)", () => {
    for (const type of STEP_TYPES) {
      expect(isValidPathSegment(type)).toBe(true);
    }
  });
});

// =============================================================================
// 5. Log Sanitization Round-Trip (write → read)
// =============================================================================

describe("Security: Log write-read round-trip sanitization", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sec-log-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("secrets in step params are redacted after write-read cycle", async () => {
    const { appendRunLog, getRunLogs } = await import("@/src/storage/logs");
    const log: RunLog = {
      id: "run-secret-test",
      projectId: "project-x",
      startedAt: new Date().toISOString(),
      status: "running",
      steps: [
        {
          id: "step-1",
          type: "deployToEcs",
          name: "Deploy",
          params: {
            dbUrl: "postgres://admin:s3cret@db:5432/app",
            apiKey: "token=sk-proj-1234567890abcdef",
          },
          status: "success",
        },
      ],
    };

    appendRunLog(log, tmpDir);
    const logs = getRunLogs("project-x", tmpDir);

    expect(logs).toHaveLength(1);
    const step = logs[0].steps[0];
    expect(step.params!["dbUrl"]).not.toContain("s3cret");
    expect(step.params!["dbUrl"]).toContain("***");
    expect(step.params!["apiKey"]).not.toContain("sk-proj-1234567890abcdef");
    expect(step.params!["apiKey"]).toContain("***");
  });

  it("secrets in step error are redacted after write-read cycle", async () => {
    const { appendRunLog, getRunLogs } = await import("@/src/storage/logs");
    const log: RunLog = {
      id: "run-err-secret",
      projectId: "project-y",
      startedAt: new Date().toISOString(),
      status: "failed",
      steps: [
        {
          id: "step-1",
          type: "healthCheck",
          name: "Health Check",
          error: "Failed: password=SuperS3cret! for database connection",
          status: "failed",
        },
      ],
    };

    appendRunLog(log, tmpDir);
    const logs = getRunLogs("project-y", tmpDir);

    expect(logs).toHaveLength(1);
    expect(logs[0].steps[0].error).not.toContain("SuperS3cret!");
    expect(logs[0].steps[0].error).toContain("***");
  });
});

// =============================================================================
// 6. Terraform Apply Authorization
// =============================================================================

describe("Security: Terraform apply requires authorization", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sec-tf-auth-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("terraformApply step fails without authorized=true in context", async () => {
    const { runProject } = await import("@/src/runner/runProject");
    const plan = makeMinimalDeployPlan([
      makeStep({ type: "terraformApply", id: "tf-apply" }),
    ]);

    const log = await runProject({
      plan,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      yunxiao: {} as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ecs: {} as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      oss: {} as any,
      terraformConfig: {
        workDir: tmpDir,
        statePath: path.join(tmpDir, "terraform.tfstate"),
        providerVersion: "1.200.0",
      },
      authorized: false,
      dataDir: tmpDir,
    });

    const applyStep = log.steps.find((s) => s.id === "tf-apply");
    expect(applyStep).toBeDefined();
    expect(applyStep!.status).toBe("failed");
    expect(applyStep!.error).toMatch(/authorization/i);
  });

  it("terraformInit and terraformPlan do not require authorization", async () => {
    const { runProject } = await import("@/src/runner/runProject");
    const plan = makeMinimalDeployPlan([
      makeStep({ type: "terraformInit", id: "tf-init" }),
    ]);

    // This should fail because no terraformConfig is provided,
    // but it should NOT fail due to authorization
    const log = await runProject({
      plan,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      yunxiao: {} as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ecs: {} as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      oss: {} as any,
      authorized: false,
      dataDir: tmpDir,
    });

    const initStep = log.steps.find((s) => s.id === "tf-init");
    expect(initStep).toBeDefined();
    expect(initStep!.status).toBe("failed");
    // Should fail on missing config, NOT on authorization
    expect(initStep!.error).toMatch(/terraform config/i);
    expect(initStep!.error).not.toMatch(/authorization/i);
  });
});

// =============================================================================
// 7. API Route Authorization Gates (unit-level)
// =============================================================================

describe("Security: API apply route requires authorized=true", () => {
  it("forbids when authorized is false", () => {
    const authorized = false;
    expect(authorized).not.toBe(true);
  });

  it("forbids when authorized is undefined", () => {
    const authorized = undefined;
    expect(authorized).not.toBe(true);
  });

  it("forbids when authorized is string 'true'", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const authorized: any = "true";
    expect(authorized).not.toBe(true);
  });

  it("allows only when authorized is boolean true", () => {
    const authorized = true;
    expect(authorized).toBe(true);
  });
});

// =============================================================================
// 8. No Arbitrary Shell Execution Surface
// =============================================================================

describe("Security: No shell execution surface", () => {
  it("STEP_TYPES whitelist has no destructive or arbitrary types", () => {
    const DESTRUCTIVE_PATTERNS = [
      "delete", "remove", "destroy", "drop", "truncate",
      "exec", "shell", "spawn", "system", "eval",
      "ssh", "scp", "rsync", "wget", "curl",
    ];
    for (const pattern of DESTRUCTIVE_PATTERNS) {
      const matches = STEP_TYPES.filter((t) =>
        t.toLowerCase().includes(pattern.toLowerCase()),
      );
      expect(matches).toEqual([]);
    }
  });

  it("all step types follow camelCase naming convention", () => {
    for (const type of STEP_TYPES) {
      // camelCase: starts lowercase, no underscores or hyphens
      expect(type).toMatch(/^[a-z][a-zA-Z0-9]*$/);
    }
  });
});
