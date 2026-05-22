// =============================================================================
// A5 Storage — Unit Tests
// Tests for project records, run logs, and Redis db allocation.
// Uses temp directories for isolated file system operations.
// =============================================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import type { ProjectRecord, RunLog, PlanStep } from "@/src/types";
import {
  createProject,
  getProject,
  listProjects,
  updateProject,
  updateProjectStatus,
} from "@/src/storage/projects";
import {
  appendRunLog,
  getRunLogs,
  getLatestRunLog,
  updateRunLog,
  createRunLog,
  finalizeRunLog,
} from "@/src/storage/logs";
import {
  collectAllocatedDbs,
  findMinUnoccupied,
  allocateRedisDb,
  isDbAllocated,
  remainingDbSlots,
  type RedisAllocConfig,
} from "@/src/storage/redis";

// ---------------------------------------------------------------------------
// Temp directory fixture
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "storage-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true });
});

const redisConfig: RedisAllocConfig = {
  instanceId: "r-xxx",
  host: "r-xxx.redis.rds.aliyuncs.com",
  port: 6379,
  passwordEnv: "REDIS_PASSWORD",
  dbMin: 1,
  dbMax: 15,
};

// =============================================================================
// projects.ts
// =============================================================================

describe("createProject", () => {
  it("creates a project record and persists it", () => {
    const record = createProject(
      { group: "mall", name: "order-service", type: "backend", domain: "order-test.tzxys.cn" },
      tmpDir,
    );

    expect(record.id).toBe("mall-order-service");
    expect(record.status).toBe("created");
    expect(record.input.group).toBe("mall");

    // Verify file exists
    const filePath = path.join(tmpDir, "projects", "mall-order-service.json");
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it("rejects duplicate project creation", () => {
    createProject(
      { group: "mall", name: "order-service", type: "backend", domain: "order-test.tzxys.cn" },
      tmpDir,
    );
    expect(() =>
      createProject(
        { group: "mall", name: "order-service", type: "backend", domain: "order-test.tzxys.cn" },
        tmpDir,
      ),
    ).toThrow("already exists");
  });
});

describe("getProject", () => {
  it("returns existing project", () => {
    const created = createProject(
      { group: "mall", name: "order-service", type: "backend", domain: "order-test.tzxys.cn" },
      tmpDir,
    );
    const loaded = getProject("mall-order-service", tmpDir);
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe(created.id);
  });

  it("returns null for non-existent project", () => {
    expect(getProject("nonexistent", tmpDir)).toBeNull();
  });
});

describe("listProjects", () => {
  it("returns empty array when no projects", () => {
    expect(listProjects(tmpDir)).toEqual([]);
  });

  it("lists all created projects", () => {
    createProject(
      { group: "mall", name: "order-service", type: "backend", domain: "order-test.tzxys.cn" },
      tmpDir,
    );
    createProject(
      { group: "mall", name: "admin-web", type: "frontend", domain: "admin-test.tzxys.cn" },
      tmpDir,
    );

    const list = listProjects(tmpDir);
    expect(list).toHaveLength(2);
    expect(list.map((p) => p.id).sort()).toEqual(["mall-admin-web", "mall-order-service"]);
  });
});

describe("updateProject", () => {
  it("updates status", () => {
    createProject(
      { group: "mall", name: "order-service", type: "backend", domain: "order-test.tzxys.cn" },
      tmpDir,
    );
    const updated = updateProjectStatus("mall-order-service", "resources_planning", tmpDir);
    expect(updated.status).toBe("resources_planning");
    expect(updated.updatedAt).not.toBe(updated.createdAt);
  });

  it("updates manifest and reads back consistently", () => {
    createProject(
      { group: "mall", name: "order-service", type: "backend", domain: "order-test.tzxys.cn" },
      tmpDir,
    );

    const manifest = {
      group: "mall",
      name: "order-service",
      type: "backend" as const,
      domain: "order-test.tzxys.cn",
      codeGroup: { status: "created" as const, path: "mall" },
      repository: { status: "created" as const, path: "order-service" },
      terraform: { workDir: "/data/tf", statePath: "terraform.tfstate", providerVersion: "1.227.0" },
      dnsRecord: { status: "managed" as const, domain: "order-test.tzxys.cn", type: "A" as const, target: "10.0.0.1" },
    };

    updateProject("mall-order-service", { manifest }, tmpDir);

    const loaded = getProject("mall-order-service", tmpDir);
    expect(loaded!.manifest).toEqual(manifest);
  });

  it("throws for non-existent project", () => {
    expect(() => updateProject("nonexistent", { status: "failed" }, tmpDir)).toThrow("not found");
  });
});

describe("write-read consistency", () => {
  it("create then read returns identical data", () => {
    const created = createProject(
      { group: "test", name: "app", type: "frontend", domain: "app.test.cn", servicePort: 3000 },
      tmpDir,
    );
    const loaded = getProject("test-app", tmpDir);

    expect(loaded).toEqual(created);
  });
});

describe("corrupt JSON error handling", () => {
  it("produces clear error for malformed JSON", () => {
    const dir = path.join(tmpDir, "projects");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "broken.json"), "{ invalid json }}}", "utf-8");

    expect(() => getProject("broken", tmpDir)).toThrow("Failed to parse broken.json");
  });
});

// =============================================================================
// logs.ts
// =============================================================================

describe("appendRunLog", () => {
  it("appends a run log entry", () => {
    const log: RunLog = {
      id: "run-1",
      projectId: "test-app",
      startedAt: new Date().toISOString(),
      status: "running",
      steps: [],
    };

    appendRunLog(log, tmpDir);

    const logs = getRunLogs("test-app", tmpDir);
    expect(logs).toHaveLength(1);
    expect(logs[0].id).toBe("run-1");
  });

  it("appends multiple entries", () => {
    const log1: RunLog = {
      id: "run-1",
      projectId: "test-app",
      startedAt: new Date().toISOString(),
      status: "completed",
      steps: [],
    };
    const log2: RunLog = {
      id: "run-2",
      projectId: "test-app",
      startedAt: new Date().toISOString(),
      status: "running",
      steps: [],
    };

    appendRunLog(log1, tmpDir);
    appendRunLog(log2, tmpDir);

    const logs = getRunLogs("test-app", tmpDir);
    expect(logs).toHaveLength(2);
  });
});

describe("getLatestRunLog", () => {
  it("returns null when no logs exist", () => {
    expect(getLatestRunLog("nonexistent", tmpDir)).toBeNull();
  });

  it("returns the last log entry", () => {
    appendRunLog(
      { id: "run-1", projectId: "test-app", startedAt: "2025-01-01T00:00:00Z", status: "completed", steps: [] },
      tmpDir,
    );
    appendRunLog(
      { id: "run-2", projectId: "test-app", startedAt: "2025-01-02T00:00:00Z", status: "running", steps: [] },
      tmpDir,
    );

    const latest = getLatestRunLog("test-app", tmpDir);
    expect(latest!.id).toBe("run-2");
  });
});

describe("updateRunLog", () => {
  it("replaces existing log by ID", () => {
    appendRunLog(
      { id: "run-1", projectId: "test-app", startedAt: "2025-01-01T00:00:00Z", status: "running", steps: [] },
      tmpDir,
    );

    updateRunLog(
      { id: "run-1", projectId: "test-app", startedAt: "2025-01-01T00:00:00Z", status: "completed", finishedAt: "2025-01-01T00:01:00Z", steps: [] },
      tmpDir,
    );

    const logs = getRunLogs("test-app", tmpDir);
    expect(logs).toHaveLength(1);
    expect(logs[0].status).toBe("completed");
    expect(logs[0].finishedAt).toBe("2025-01-01T00:01:00Z");
  });
});

describe("log sanitization", () => {
  it("redacts sensitive values from step params and errors", () => {
    const log: RunLog = {
      id: "run-1",
      projectId: "test-app",
      startedAt: new Date().toISOString(),
      status: "failed",
      steps: [
        {
          id: "s1",
          type: "healthCheck",
          name: "Check",
          params: { url: "https://api.example.com/token=pt-secret1234567890abc" },
          error: "Connection failed: password=MySecretPassword123!",
        },
      ],
    };

    appendRunLog(log, tmpDir);

    const logs = getRunLogs("test-app", tmpDir);
    expect(logs[0].steps[0].params!.url).not.toContain("pt-secret1234567890abc");
    expect(logs[0].steps[0].error).not.toContain("MySecretPassword123!");
    expect(logs[0].steps[0].error).toContain("***");
  });
});

describe("createRunLog / finalizeRunLog", () => {
  it("creates and finalizes a run log", () => {
    const steps: PlanStep[] = [
      { id: "s1", type: "commitDockerfile", name: "Commit Dockerfile" },
    ];

    const log = createRunLog("test-app", steps);
    expect(log.status).toBe("running");
    expect(log.projectId).toBe("test-app");
    expect(log.steps).toHaveLength(1);

    const finalized = finalizeRunLog(log, "completed");
    expect(finalized.status).toBe("completed");
    expect(finalized.finishedAt).toBeDefined();
  });
});

// =============================================================================
// redis.ts
// =============================================================================

describe("collectAllocatedDbs", () => {
  it("returns empty array when no records have redis", () => {
    const records: ProjectRecord[] = [
      {
        id: "test-1",
        input: { group: "test", name: "1", type: "backend", domain: "test.cn" },
        createdAt: "",
        updatedAt: "",
        status: "created",
      },
    ];
    expect(collectAllocatedDbs(records)).toEqual([]);
  });

  it("collects db numbers from records with redis", () => {
    const records: ProjectRecord[] = [
      {
        id: "test-1",
        input: { group: "test", name: "1", type: "backend", domain: "test.cn" },
        createdAt: "",
        updatedAt: "",
        status: "created",
        manifest: {
          group: "test",
          name: "1",
          type: "backend",
          domain: "test.cn",
          codeGroup: { status: "created", path: "test" },
          repository: { status: "created", path: "1" },
          terraform: { workDir: "/tmp", statePath: "tf.tfstate", providerVersion: "1.0" },
          dnsRecord: { status: "managed", domain: "test.cn", type: "A", target: "1.1.1.1" },
          redis: { instanceId: "r-xxx", host: "r.redis", port: 6379, db: 1 },
        },
      },
      {
        id: "test-2",
        input: { group: "test", name: "2", type: "backend", domain: "test.cn" },
        createdAt: "",
        updatedAt: "",
        status: "created",
        manifest: {
          group: "test",
          name: "2",
          type: "backend",
          domain: "test.cn",
          codeGroup: { status: "created", path: "test" },
          repository: { status: "created", path: "2" },
          terraform: { workDir: "/tmp", statePath: "tf.tfstate", providerVersion: "1.0" },
          dnsRecord: { status: "managed", domain: "test.cn", type: "A", target: "1.1.1.1" },
          redis: { instanceId: "r-xxx", host: "r.redis", port: 6379, db: 3 },
        },
      },
    ];
    expect(collectAllocatedDbs(records).sort()).toEqual([1, 3]);
  });
});

describe("findMinUnoccupied", () => {
  it("returns dbMin when nothing is allocated", () => {
    expect(findMinUnoccupied([], 1, 15)).toBe(1);
  });

  it("skips allocated numbers", () => {
    expect(findMinUnoccupied([1, 2, 3], 1, 15)).toBe(4);
  });

  it("returns null when all are occupied", () => {
    expect(findMinUnoccupied([1, 2, 3], 1, 3)).toBeNull();
  });

  it("handles non-contiguous allocations", () => {
    expect(findMinUnoccupied([1, 3, 5], 1, 10)).toBe(2);
  });
});

describe("allocateRedisDb", () => {
  it("allocates the first available db number", () => {
    const allocation = allocateRedisDb(tmpDir, redisConfig);
    expect(allocation.db).toBe(1); // dbMin
    expect(allocation.instanceId).toBe("r-xxx");
    expect(allocation.host).toBe("r-xxx.redis.rds.aliyuncs.com");
    expect(allocation.port).toBe(6379);
    expect(allocation.passwordEnv).toBe("REDIS_PASSWORD");
  });

  it("allocates sequentially", () => {
    // Create projects with redis db 1 and 2 already allocated
    createProject(
      { group: "test", name: "app1", type: "backend", domain: "app1.test.cn" },
      tmpDir,
    );
    updateProject("test-app1", {
      manifest: {
        group: "test",
        name: "app1",
        type: "backend",
        domain: "app1.test.cn",
        codeGroup: { status: "created", path: "test" },
        repository: { status: "created", path: "app1" },
        terraform: { workDir: "/tmp", statePath: "tf.tfstate", providerVersion: "1.0" },
        dnsRecord: { status: "managed", domain: "app1.test.cn", type: "A", target: "1.1.1.1" },
        redis: { instanceId: "r-xxx", host: "r.redis", port: 6379, db: 1 },
      },
    }, tmpDir);

    createProject(
      { group: "test", name: "app2", type: "backend", domain: "app2.test.cn" },
      tmpDir,
    );
    updateProject("test-app2", {
      manifest: {
        group: "test",
        name: "app2",
        type: "backend",
        domain: "app2.test.cn",
        codeGroup: { status: "created", path: "test" },
        repository: { status: "created", path: "app2" },
        terraform: { workDir: "/tmp", statePath: "tf.tfstate", providerVersion: "1.0" },
        dnsRecord: { status: "managed", domain: "app2.test.cn", type: "A", target: "1.1.1.1" },
        redis: { instanceId: "r-xxx", host: "r.redis", port: 6379, db: 2 },
      },
    }, tmpDir);

    const allocation = allocateRedisDb(tmpDir, redisConfig);
    expect(allocation.db).toBe(3); // 1 and 2 are taken
  });

  it("throws when all db slots are occupied", () => {
    // Small range: only db 1 and 2
    const smallConfig: RedisAllocConfig = { ...redisConfig, dbMin: 1, dbMax: 2 };

    createProject(
      { group: "test", name: "app1", type: "backend", domain: "a.cn" },
      tmpDir,
    );
    updateProject("test-app1", {
      manifest: {
        group: "test", name: "app1", type: "backend", domain: "a.cn",
        codeGroup: { status: "created", path: "test" },
        repository: { status: "created", path: "app1" },
        terraform: { workDir: "/tmp", statePath: "tf.tfstate", providerVersion: "1.0" },
        dnsRecord: { status: "managed", domain: "a.cn", type: "A", target: "1.1.1.1" },
        redis: { instanceId: "r-xxx", host: "r.redis", port: 6379, db: 1 },
      },
    }, tmpDir);

    createProject(
      { group: "test", name: "app2", type: "backend", domain: "b.cn" },
      tmpDir,
    );
    updateProject("test-app2", {
      manifest: {
        group: "test", name: "app2", type: "backend", domain: "b.cn",
        codeGroup: { status: "created", path: "test" },
        repository: { status: "created", path: "app2" },
        terraform: { workDir: "/tmp", statePath: "tf.tfstate", providerVersion: "1.0" },
        dnsRecord: { status: "managed", domain: "b.cn", type: "A", target: "1.1.1.1" },
        redis: { instanceId: "r-xxx", host: "r.redis", port: 6379, db: 2 },
      },
    }, tmpDir);

    expect(() => allocateRedisDb(tmpDir, smallConfig)).toThrow("No available Redis db numbers");
  });
});

describe("isDbAllocated", () => {
  it("returns false when db is not allocated", () => {
    expect(isDbAllocated(5, [])).toBe(false);
  });

  it("returns true when db is allocated", () => {
    const records: ProjectRecord[] = [
      {
        id: "t1",
        input: { group: "t", name: "1", type: "backend", domain: "t.cn" },
        createdAt: "",
        updatedAt: "",
        status: "created",
        manifest: {
          group: "t", name: "1", type: "backend", domain: "t.cn",
          codeGroup: { status: "created", path: "t" },
          repository: { status: "created", path: "1" },
          terraform: { workDir: "/tmp", statePath: "tf.tfstate", providerVersion: "1.0" },
          dnsRecord: { status: "managed", domain: "t.cn", type: "A", target: "1.1.1.1" },
          redis: { instanceId: "r", host: "r.redis", port: 6379, db: 5 },
        },
      },
    ];
    expect(isDbAllocated(5, records)).toBe(true);
    expect(isDbAllocated(6, records)).toBe(false);
  });
});

describe("remainingDbSlots", () => {
  it("returns total slots when empty", () => {
    expect(remainingDbSlots(tmpDir, redisConfig)).toBe(15); // dbMin=1, dbMax=15
  });
});
