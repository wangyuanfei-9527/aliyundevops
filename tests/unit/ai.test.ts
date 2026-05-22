// =============================================================================
// A7 AI — Unit Tests
// Tests for LLM provider, analyzer, and deploy planner.
// Uses MockLLMProvider — no real API calls.
// =============================================================================

import { describe, it, expect } from "vitest";
import { MockLLMProvider, OpenAIProvider, createLLMProvider } from "@/src/ai/llmProvider";
import { buildAnalyzerPrompt, analyzeProject } from "@/src/ai/analyzer";
import { buildPlannerPrompt, generateDeployPlan } from "@/src/ai/planner";
import type { RepoFileInfo } from "@/src/lib/codeupReader";
import type { ProjectProfile, ResourceManifest } from "@/src/types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const sampleFiles: RepoFileInfo[] = [
  { path: "package.json", exists: true, content: '{"name":"order-service","dependencies":{"express":"^4.18"}}' },
  { path: "Dockerfile", exists: true, content: "FROM node:20\nCMD pnpm start" },
  { path: "pom.xml", exists: false },
  { path: "go.mod", exists: false },
];

const rootListing = ["package.json", "Dockerfile", "src/", ".gitignore"];

const sampleProfile: ProjectProfile = {
  language: "node",
  framework: "Express",
  buildTool: "pnpm",
  buildCommand: "pnpm build",
  needsDatabase: true,
  databaseType: "mysql",
  needsRedis: true,
  servicePort: 18080,
  hasDockerfile: true,
  hasDockerCompose: false,
  reasoning: "Node.js Express backend with MySQL",
  warnings: [],
};

const sampleManifest: ResourceManifest = {
  group: "mall",
  name: "order-service",
  type: "backend",
  domain: "order-test.tzxys.cn",
  codeGroup: { status: "created", path: "mall" },
  repository: { status: "created", path: "order-service", url: "https://codeup.aliyun.com/mall/order-service.git" },
  terraform: { workDir: "/data/tf/mall-order-service", statePath: "terraform.tfstate", providerVersion: "1.227.0" },
  database: { status: "managed", name: "test_mall_order_service", instanceId: "rm-xxx" },
  acrRepository: { status: "managed", instanceId: "cri-xxx", namespace: "test", name: "order-service" },
  dnsRecord: { status: "managed", domain: "order-test.tzxys.cn", type: "A", target: "10.0.0.1" },
  redis: { instanceId: "r-xxx", host: "r.redis.rds.aliyuncs.com", port: 6379, db: 1, passwordEnv: "REDIS_PASSWORD" },
  deployPath: "/opt/apps/order-service",
  nginxConfPath: "/etc/nginx/conf.d/order-service.conf",
};

// =============================================================================
// LLM Provider
// =============================================================================

describe("MockLLMProvider", () => {
  it("returns configured content", async () => {
    const provider = new MockLLMProvider('{"test": true}');
    const response = await provider.complete([]);
    expect(response.content).toBe('{"test": true}');
    expect(response.model).toBe("mock");
  });

  it("is always configured", () => {
    const provider = new MockLLMProvider("");
    expect(provider.isConfigured()).toBe(true);
  });
});

describe("OpenAIProvider", () => {
  it("is not configured without API key", () => {
    const provider = new OpenAIProvider({});
    expect(provider.isConfigured()).toBe(false);
  });

  it("is configured with API key", () => {
    const provider = new OpenAIProvider({ apiKey: "sk-test" });
    expect(provider.isConfigured()).toBe(true);
  });

  it("throws on complete without API key", async () => {
    const provider = new OpenAIProvider({});
    await expect(provider.complete([])).rejects.toThrow("not configured");
  });
});

describe("createLLMProvider", () => {
  it("returns OpenAIProvider when apiKey is set", () => {
    const provider = createLLMProvider({ apiKey: "sk-test" });
    expect(provider.isConfigured()).toBe(true);
  });

  it("returns unconfigured provider when apiKey is missing", () => {
    const provider = createLLMProvider({});
    expect(provider.isConfigured()).toBe(false);
  });
});

// =============================================================================
// Analyzer
// =============================================================================

describe("buildAnalyzerPrompt", () => {
  it("includes file contents for existing files", () => {
    const prompt = buildAnalyzerPrompt(sampleFiles, rootListing);

    expect(prompt).toContain("package.json");
    expect(prompt).toContain('"order-service"');
    expect(prompt).toContain("Dockerfile");
    expect(prompt).toContain("FROM node:20");
    expect(prompt).toContain("Root Directory Files");
    expect(prompt).toContain("Found 2 of 4 key files");
  });

  it("handles empty files", () => {
    const prompt = buildAnalyzerPrompt([], []);
    expect(prompt).toContain("Found 0 of 0");
    expect(prompt).toContain("empty or unavailable");
  });
});

describe("analyzeProject", () => {
  it("returns valid ProjectProfile from mock LLM", async () => {
    const profileJson = JSON.stringify(sampleProfile);
    const provider = new MockLLMProvider(profileJson);

    const result = await analyzeProject(provider, {
      files: sampleFiles,
      rootListing,
    });

    expect(result.language).toBe("node");
    expect(result.framework).toBe("Express");
    expect(result.needsDatabase).toBe(true);
    expect(result.databaseType).toBe("mysql");
    expect(result.needsRedis).toBe(true);
    expect(result.servicePort).toBe(18080);
  });

  it("retries on invalid JSON output", async () => {
    let callCount = 0;
    const validJson = JSON.stringify(sampleProfile);

    // First call returns invalid JSON, second returns valid
    const provider = new class extends MockLLMProvider {
      async complete() {
        callCount++;
        if (callCount === 1) return { content: "not json", model: "mock" };
        return { content: validJson, model: "mock" };
      }
    }("");

    const result = await analyzeProject(provider, { files: sampleFiles, rootListing });
    expect(result.language).toBe("node");
    expect(callCount).toBe(2);
  });

  it("throws after 2 failed attempts", async () => {
    const provider = new MockLLMProvider("not valid json at all");
    await expect(
      analyzeProject(provider, { files: sampleFiles, rootListing }),
    ).rejects.toThrow("failed after 2 attempts");
  });

  it("retries on schema validation failure", async () => {
    let callCount = 0;
    const validJson = JSON.stringify(sampleProfile);
    const invalidJson = JSON.stringify({ language: "ruby", framework: "Rails" });

    const provider = new class extends MockLLMProvider {
      async complete() {
        callCount++;
        if (callCount === 1) return { content: invalidJson, model: "mock" };
        return { content: validJson, model: "mock" };
      }
    }("");

    const result = await analyzeProject(provider, { files: sampleFiles, rootListing });
    expect(result.language).toBe("node");
    expect(callCount).toBe(2);
  });

  it("handles JSON wrapped in markdown code fences", async () => {
    const fenced = "```json\n" + JSON.stringify(sampleProfile) + "\n```";
    const provider = new MockLLMProvider(fenced);

    const result = await analyzeProject(provider, { files: sampleFiles, rootListing });
    expect(result.language).toBe("node");
  });
});

// =============================================================================
// DeployPlanner
// =============================================================================

describe("buildPlannerPrompt", () => {
  it("includes profile and manifest data", () => {
    const prompt = buildPlannerPrompt({ profile: sampleProfile, manifest: sampleManifest });

    expect(prompt).toContain("Project Profile");
    expect(prompt).toContain("Express");
    expect(prompt).toContain("Provisioned Resources");
    expect(prompt).toContain("test_mall_order_service");
    expect(prompt).toContain("whitelisted StepType");
  });
});

describe("generateDeployPlan", () => {
  const validPlan = {
    profile: sampleProfile,
    manifest: sampleManifest,
    artifacts: {
      dockerfile: "FROM node:20\nWORKDIR /app\nCOPY . .\nCMD pnpm start",
    },
    env: {
      variables: { NODE_ENV: "production" },
      secretEnvNames: ["REDIS_PASSWORD", "DB_PASSWORD"],
    },
    ports: { servicePort: 18080 },
    steps: [
      { id: "s1", type: "commitDockerfile", name: "Commit Dockerfile" },
      { id: "s2", type: "deployToEcs", name: "Deploy to ECS" },
      { id: "s3", type: "writeNginxConfig", name: "Write Nginx config" },
      { id: "s4", type: "healthCheck", name: "Health check" },
    ],
    reasoning: "Standard Node.js backend deployment",
    assumptions: ["Node.js 20 available on ECS"],
    warnings: [],
    manualSteps: [],
  };

  it("returns valid DeployPlan from mock LLM", async () => {
    const planJson = JSON.stringify(validPlan);
    const provider = new MockLLMProvider(planJson);

    const result = await generateDeployPlan(provider, {
      profile: sampleProfile,
      manifest: sampleManifest,
    });

    expect(result.steps).toHaveLength(4);
    expect(result.steps[0].type).toBe("commitDockerfile");
    expect(result.env.secretEnvNames).toContain("REDIS_PASSWORD");
    expect(result.env.secretEnvNames).toContain("DB_PASSWORD");
    expect(result.env.variables).not.toHaveProperty("REDIS_PASSWORD");
  });

  it("rejects plan with illegal StepType", async () => {
    const invalidPlan = {
      ...validPlan,
      steps: [{ id: "s1", type: "runArbitraryShell", name: "Evil" }],
    };
    const provider = new MockLLMProvider(JSON.stringify(invalidPlan));

    await expect(
      generateDeployPlan(provider, { profile: sampleProfile, manifest: sampleManifest }),
    ).rejects.toThrow("failed after 2 attempts");
  });

  it("rejects plan with duplicate step IDs", async () => {
    const invalidPlan = {
      ...validPlan,
      steps: [
        { id: "s1", type: "commitDockerfile", name: "A" },
        { id: "s1", type: "healthCheck", name: "B" },
      ],
    };
    const provider = new MockLLMProvider(JSON.stringify(invalidPlan));

    await expect(
      generateDeployPlan(provider, { profile: sampleProfile, manifest: sampleManifest }),
    ).rejects.toThrow("failed after 2 attempts");
  });

  it("rejects plan with empty steps", async () => {
    const invalidPlan = { ...validPlan, steps: [] };
    const provider = new MockLLMProvider(JSON.stringify(invalidPlan));

    await expect(
      generateDeployPlan(provider, { profile: sampleProfile, manifest: sampleManifest }),
    ).rejects.toThrow("failed after 2 attempts");
  });

  it("throws after 2 failed attempts", async () => {
    const provider = new MockLLMProvider("not json");
    await expect(
      generateDeployPlan(provider, { profile: sampleProfile, manifest: sampleManifest }),
    ).rejects.toThrow("failed after 2 attempts");
  });

  it("handles JSON wrapped in code fences", async () => {
    const fenced = "```\n" + JSON.stringify(validPlan) + "\n```";
    const provider = new MockLLMProvider(fenced);

    const result = await generateDeployPlan(provider, {
      profile: sampleProfile,
      manifest: sampleManifest,
    });
    expect(result.steps.length).toBeGreaterThan(0);
  });
});
