// =============================================================================
// A6 Yunxiao Adapter — Unit Tests
// Tests for mock adapter, interface contract, error handling, and codeupReader.
// =============================================================================

import { describe, it, expect } from "vitest";
import {
  MockYunxiaoAdapter,
  YunxiaoApiError,
} from "@/src/lib/yunxiao";
import {
  readAnalysisFiles,
  readRepoFile,
  ANALYSIS_FILE_PATTERNS,
} from "@/src/lib/codeupReader";

// =============================================================================
// MockYunxiaoAdapter
// =============================================================================

describe("MockYunxiaoAdapter — ensureCodeGroup", () => {
  it("creates a new group", async () => {
    const adapter = new MockYunxiaoAdapter();
    const result = await adapter.ensureCodeGroup("mall");

    expect(result.status).toBe("created");
    expect(result.path).toBe("mall");
    expect(adapter.getGroups()).toContain("mall");
  });

  it("returns exists for existing group", async () => {
    const adapter = new MockYunxiaoAdapter({ groups: ["mall"] });
    const result = await adapter.ensureCodeGroup("mall");

    expect(result.status).toBe("exists");
    expect(result.path).toBe("mall");
  });
});

describe("MockYunxiaoAdapter — ensureRepository", () => {
  it("creates a new repository", async () => {
    const adapter = new MockYunxiaoAdapter();
    const result = await adapter.ensureRepository("mall", "order-service");

    expect(result.status).toBe("created");
    expect(result.path).toBe("mall/order-service");
    expect(result.url).toContain("codeup.aliyun.com");
  });

  it("returns exists for existing repository", async () => {
    const adapter = new MockYunxiaoAdapter({
      repositories: [{ group: "mall", name: "order-service" }],
    });
    const result = await adapter.ensureRepository("mall", "order-service");

    expect(result.status).toBe("exists");
  });

  it("auto-creates group when creating repository", async () => {
    const adapter = new MockYunxiaoAdapter();
    await adapter.ensureRepository("new-group", "new-repo");

    expect(adapter.getGroups()).toContain("new-group");
  });
});

describe("MockYunxiaoAdapter — commitFile and readFile", () => {
  it("commits and reads back a file", async () => {
    const adapter = new MockYunxiaoAdapter();
    await adapter.ensureRepository("mall", "order-service");

    const commitResult = await adapter.commitFile({
      group: "mall",
      repository: "order-service",
      filePath: "Dockerfile",
      content: "FROM node:20\nCMD pnpm start",
      commitMessage: "Add Dockerfile",
    });
    expect(commitResult.success).toBe(true);
    expect(commitResult.commitId).toBeDefined();

    const file = await adapter.readFile("mall", "order-service", "Dockerfile");
    expect(file).not.toBeNull();
    expect(file!.content).toBe("FROM node:20\nCMD pnpm start");
  });

  it("returns null for non-existent file", async () => {
    const adapter = new MockYunxiaoAdapter({
      repositories: [{ group: "mall", name: "order-service" }],
    });
    const file = await adapter.readFile("mall", "order-service", "nonexistent.txt");
    expect(file).toBeNull();
  });

  it("returns null for non-existent repository", async () => {
    const adapter = new MockYunxiaoAdapter();
    const file = await adapter.readFile("no-group", "no-repo", "file.txt");
    expect(file).toBeNull();
  });

  it("auto-creates repo when committing to unknown repo", async () => {
    const adapter = new MockYunxiaoAdapter();
    const result = await adapter.commitFile({
      group: "auto",
      repository: "created",
      filePath: "test.txt",
      content: "hello",
      commitMessage: "test",
    });
    expect(result.success).toBe(true);
    expect(adapter.getRepositoryFiles("auto", "created")?.get("test.txt")).toBe("hello");
  });
});

describe("MockYunxiaoAdapter — createPipeline", () => {
  it("creates a pipeline with auto-incremented ID", async () => {
    const adapter = new MockYunxiaoAdapter();

    const p1 = await adapter.createPipeline({
      name: "frontend-pipeline",
      group: "mall",
      repository: "admin-web",
      yamlContent: "stages: []",
    });
    const p2 = await adapter.createPipeline({
      name: "backend-pipeline",
      group: "mall",
      repository: "order-service",
      yamlContent: "stages: []",
    });

    expect(p1.success).toBe(true);
    expect(p2.success).toBe(true);
    expect(p1.pipelineId).not.toBe(p2.pipelineId);
    expect(adapter.getPipelines()).toHaveLength(2);
  });
});

describe("MockYunxiaoAdapter — listFiles", () => {
  it("lists committed files", async () => {
    const adapter = new MockYunxiaoAdapter();
    await adapter.ensureRepository("mall", "order-service");
    await adapter.commitFile({
      group: "mall",
      repository: "order-service",
      filePath: "Dockerfile",
      content: "FROM node:20",
      commitMessage: "add",
    });
    await adapter.commitFile({
      group: "mall",
      repository: "order-service",
      filePath: "deploy.sh",
      content: "#!/bin/bash",
      commitMessage: "add",
    });

    const files = await adapter.listFiles("mall", "order-service");
    expect(files).toContain("Dockerfile");
    expect(files).toContain("deploy.sh");
    expect(files).toHaveLength(2);
  });

  it("returns empty for non-existent repo", async () => {
    const adapter = new MockYunxiaoAdapter();
    const files = await adapter.listFiles("no", "repo");
    expect(files).toEqual([]);
  });

  it("filters by directory prefix", async () => {
    const adapter = new MockYunxiaoAdapter();
    await adapter.ensureRepository("mall", "order-service");
    await adapter.commitFile({
      group: "mall",
      repository: "order-service",
      filePath: "src/index.ts",
      content: "",
      commitMessage: "add",
    });
    await adapter.commitFile({
      group: "mall",
      repository: "order-service",
      filePath: "config/settings.json",
      content: "{}",
      commitMessage: "add",
    });

    const srcFiles = await adapter.listFiles("mall", "order-service", "src/");
    expect(srcFiles).toEqual(["src/index.ts"]);
  });
});

// =============================================================================
// YunxiaoApiError
// =============================================================================

describe("YunxiaoApiError", () => {
  it("formats error message correctly", () => {
    const err = new YunxiaoApiError(404, "/api/groups/test", "Not found");
    expect(err.message).toContain("404");
    expect(err.message).toContain("/api/groups/test");
    expect(err.message).toContain("Not found");
    expect(err.name).toBe("YunxiaoApiError");
    expect(err.statusCode).toBe(404);
    expect(err.apiPath).toBe("/api/groups/test");
  });
});

// =============================================================================
// codeupReader
// =============================================================================

describe("readAnalysisFiles", () => {
  it("reads analysis files and reports exists/not-found", async () => {
    const adapter = new MockYunxiaoAdapter();
    await adapter.ensureRepository("mall", "order-service");
    await adapter.commitFile({
      group: "mall",
      repository: "order-service",
      filePath: "package.json",
      content: '{"name": "order-service"}',
      commitMessage: "init",
    });
    await adapter.commitFile({
      group: "mall",
      repository: "order-service",
      filePath: "Dockerfile",
      content: "FROM node:20",
      commitMessage: "add dockerfile",
    });

    const files = await readAnalysisFiles(adapter, "mall", "order-service");

    const pkg = files.find((f) => f.path === "package.json");
    expect(pkg?.exists).toBe(true);
    expect(pkg?.content).toBe('{"name": "order-service"}');

    const dockerfile = files.find((f) => f.path === "Dockerfile");
    expect(dockerfile?.exists).toBe(true);

    // Most files should be not found
    const notFound = files.filter((f) => !f.exists);
    expect(notFound.length).toBeGreaterThan(0);
  });

  it("returns all patterns even for empty repo", async () => {
    const adapter = new MockYunxiaoAdapter({
      repositories: [{ group: "test", name: "empty" }],
    });
    const files = await readAnalysisFiles(adapter, "test", "empty");

    expect(files).toHaveLength(ANALYSIS_FILE_PATTERNS.length);
    expect(files.every((f) => !f.exists)).toBe(true);
  });
});

describe("readRepoFile", () => {
  it("returns file content", async () => {
    const adapter = new MockYunxiaoAdapter();
    await adapter.ensureRepository("mall", "order-service");
    await adapter.commitFile({
      group: "mall",
      repository: "order-service",
      filePath: "pom.xml",
      content: "<project></project>",
      commitMessage: "init",
    });

    const content = await readRepoFile(adapter, "mall", "order-service", "pom.xml");
    expect(content).toBe("<project></project>");
  });

  it("returns null for missing file", async () => {
    const adapter = new MockYunxiaoAdapter({
      repositories: [{ group: "mall", name: "order-service" }],
    });
    const content = await readRepoFile(adapter, "mall", "order-service", "build.gradle");
    expect(content).toBeNull();
  });
});

describe("ANALYSIS_FILE_PATTERNS", () => {
  it("includes key project files", () => {
    expect(ANALYSIS_FILE_PATTERNS).toContain("package.json");
    expect(ANALYSIS_FILE_PATTERNS).toContain("pom.xml");
    expect(ANALYSIS_FILE_PATTERNS).toContain("Dockerfile");
    expect(ANALYSIS_FILE_PATTERNS).toContain("docker-compose.yml");
    expect(ANALYSIS_FILE_PATTERNS).toContain("go.mod");
    expect(ANALYSIS_FILE_PATTERNS).toContain("requirements.txt");
  });
});
