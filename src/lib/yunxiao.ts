// =============================================================================
// Yunxiao / Codeup / Flow Adapter — A6 Yunxiao
// Interface abstraction for Yunxiao OpenAPI operations.
// Real adapter wraps HTTP requests; mock adapter for testing.
// Token never appears in logs (handled by redact layer).
// =============================================================================

import { redact } from "@/src/lib/redact";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface YunxiaoConfig {
  baseUrl: string;
  organizationId: string;
  token: string;
}

export interface EnsureResult {
  status: "exists" | "created";
  path: string;
}

export interface EnsureRepositoryResult extends EnsureResult {
  url?: string;
}

export interface RepositoryFile {
  path: string;
  content: string;
  encoding?: "utf-8" | "base64";
}

export interface CommitFileParams {
  group: string;
  repository: string;
  filePath: string;
  content: string;
  commitMessage: string;
  branch?: string;
}

export interface CreatePipelineParams {
  name: string;
  group: string;
  repository: string;
  yamlContent: string;
  branch?: string;
}

// ---------------------------------------------------------------------------
// Adapter interface — abstracts all Yunxiao operations
// ---------------------------------------------------------------------------

export interface IYunxiaoAdapter {
  /** Check if a code group exists, create if not */
  ensureCodeGroup(group: string): Promise<EnsureResult>;

  /** Check if a repository exists under a group, create if not */
  ensureRepository(group: string, name: string): Promise<EnsureRepositoryResult>;

  /** Read a file from a repository */
  readFile(group: string, repository: string, filePath: string, branch?: string): Promise<RepositoryFile | null>;

  /** Commit a file to a repository */
  commitFile(params: CommitFileParams): Promise<{ success: boolean; commitId?: string }>;

  /** Create a Flow pipeline */
  createPipeline(params: CreatePipelineParams): Promise<{ success: boolean; pipelineId?: string }>;

  /** List files in a repository directory */
  listFiles(group: string, repository: string, dirPath?: string, branch?: string): Promise<string[]>;
}

// ---------------------------------------------------------------------------
// Custom error
// ---------------------------------------------------------------------------

export class YunxiaoApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly apiPath: string,
    message: string,
  ) {
    super(`Yunxiao API error (${statusCode}) on ${apiPath}: ${message}`);
    this.name = "YunxiaoApiError";
  }
}

// ---------------------------------------------------------------------------
// HTTP helper — internal to real adapter
// ---------------------------------------------------------------------------

async function yunxiaoRequest(
  config: YunxiaoConfig,
  method: "GET" | "POST" | "PUT",
  apiPath: string,
  body?: unknown,
): Promise<{ status: number; data: unknown }> {
  const url = `${config.baseUrl}${apiPath}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${config.token}`,
  };

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  let data: unknown;
  const text = await response.text();
  try {
    data = JSON.parse(text);
  } catch {
    data = { rawText: redact(text) };
  }

  if (!response.ok) {
    const errorDetail =
      typeof data === "object" && data !== null && "error_message" in data
        ? String((data as Record<string, unknown>).error_message)
        : response.statusText;

    throw new YunxiaoApiError(response.status, apiPath, redact(errorDetail));
  }

  return { status: response.status, data };
}

// ---------------------------------------------------------------------------
// Real adapter — wraps HTTP calls to Yunxiao OpenAPI
// ---------------------------------------------------------------------------

export class YunxiaoHttpAdapter implements IYunxiaoAdapter {
  constructor(private readonly config: YunxiaoConfig) {}

  async ensureCodeGroup(group: string): Promise<EnsureResult> {
    const orgId = this.config.organizationId;

    try {
      const result = await yunxiaoRequest(
        this.config,
        "GET",
        `/oapi/v1/codeup/organizations/${orgId}/groups/${encodeURIComponent(group)}`,
      );
      const data = result.data as Record<string, unknown>;
      return { status: "exists", path: String(data.path ?? group) };
    } catch (err) {
      if (err instanceof YunxiaoApiError && err.statusCode === 404) {
        const result = await yunxiaoRequest(
          this.config,
          "POST",
          `/oapi/v1/codeup/organizations/${orgId}/groups`,
          { name: group, path: group },
        );
        const data = result.data as Record<string, unknown>;
        return { status: "created", path: String(data.path ?? group) };
      }
      throw err;
    }
  }

  async ensureRepository(group: string, name: string): Promise<EnsureRepositoryResult> {
    const orgId = this.config.organizationId;

    try {
      const result = await yunxiaoRequest(
        this.config,
        "GET",
        `/oapi/v1/codeup/organizations/${orgId}/repositories/${encodeURIComponent(group)}/${encodeURIComponent(name)}`,
      );
      const data = result.data as Record<string, unknown>;
      return {
        status: "exists",
        path: String(data.path ?? `${group}/${name}`),
        url: data.httpUrl != null ? String(data.httpUrl) : undefined,
      };
    } catch (err) {
      if (err instanceof YunxiaoApiError && err.statusCode === 404) {
        const result = await yunxiaoRequest(
          this.config,
          "POST",
          `/oapi/v1/codeup/organizations/${orgId}/repositories`,
          { name, path: name, groupName: group, groupPath: group, visibilityLevel: 0 },
        );
        const data = result.data as Record<string, unknown>;
        return {
          status: "created",
          path: String(data.path ?? `${group}/${name}`),
          url: data.httpUrl != null ? String(data.httpUrl) : undefined,
        };
      }
      throw err;
    }
  }

  async readFile(
    group: string,
    repository: string,
    filePath: string,
    branch?: string,
  ): Promise<RepositoryFile | null> {
    const orgId = this.config.organizationId;
    const ref = branch ?? "master";

    try {
      const result = await yunxiaoRequest(
        this.config,
        "GET",
        `/oapi/v1/codeup/organizations/${orgId}/repositories/${encodeURIComponent(group)}/${encodeURIComponent(repository)}/files?ref=${encodeURIComponent(ref)}&path=${encodeURIComponent(filePath)}`,
      );
      const data = result.data as Record<string, unknown>;
      const encoding = String(data.encoding ?? "utf-8");

      let content: string;
      if (encoding === "base64" && typeof data.content === "string") {
        content = Buffer.from(data.content, "base64").toString("utf-8");
      } else {
        content = String(data.content ?? "");
      }

      return { path: filePath, content, encoding: "utf-8" };
    } catch (err) {
      if (err instanceof YunxiaoApiError && err.statusCode === 404) {
        return null;
      }
      throw err;
    }
  }

  async commitFile(params: CommitFileParams): Promise<{ success: boolean; commitId?: string }> {
    const orgId = this.config.organizationId;
    const { group, repository, filePath, content, commitMessage, branch } = params;
    const ref = branch ?? "master";

    const result = await yunxiaoRequest(
      this.config,
      "POST",
      `/oapi/v1/codeup/organizations/${orgId}/repositories/${encodeURIComponent(group)}/${encodeURIComponent(repository)}/files/commit`,
      { branch: ref, commitMessage, files: [{ filePath, content, encoding: "utf-8" }] },
    );

    const data = result.data as Record<string, unknown>;
    return { success: true, commitId: data.commitId != null ? String(data.commitId) : undefined };
  }

  async createPipeline(params: CreatePipelineParams): Promise<{ success: boolean; pipelineId?: string }> {
    const orgId = this.config.organizationId;
    const { name, yamlContent, branch } = params;

    const result = await yunxiaoRequest(
      this.config,
      "POST",
      `/oapi/v1/flow/organizations/${orgId}/pipelines`,
      { name, yamlContent, branch: branch ?? "master" },
    );

    const data = result.data as Record<string, unknown>;
    return { success: true, pipelineId: data.pipelineId != null ? String(data.pipelineId) : undefined };
  }

  async listFiles(
    group: string,
    repository: string,
    dirPath?: string,
    branch?: string,
  ): Promise<string[]> {
    const orgId = this.config.organizationId;
    const ref = branch ?? "master";
    const dir = dirPath ?? "";

    try {
      const result = await yunxiaoRequest(
        this.config,
        "GET",
        `/oapi/v1/codeup/organizations/${orgId}/repositories/${encodeURIComponent(group)}/${encodeURIComponent(repository)}/trees?ref=${encodeURIComponent(ref)}&path=${encodeURIComponent(dir)}`,
      );
      const data = result.data as Array<Record<string, unknown>>;
      if (!Array.isArray(data)) return [];

      return data
        .filter((item) => item.type === "blob")
        .map((item) => String(item.path ?? item.name ?? ""))
        .filter(Boolean);
    } catch (err) {
      if (err instanceof YunxiaoApiError && err.statusCode === 404) {
        return [];
      }
      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// Mock adapter — in-memory implementation for testing
// ---------------------------------------------------------------------------

export class MockYunxiaoAdapter implements IYunxiaoAdapter {
  private groups = new Set<string>();
  private repositories = new Map<string, { path: string; files: Map<string, string> }>();
  private pipelines: Array<{ name: string; pipelineId: string }> = [];
  private nextPipelineId = 1;

  constructor(preexisting?: { groups?: string[]; repositories?: Array<{ group: string; name: string }> }) {
    if (preexisting?.groups) {
      for (const g of preexisting.groups) this.groups.add(g);
    }
    if (preexisting?.repositories) {
      for (const r of preexisting.repositories) {
        this.repositories.set(`${r.group}/${r.name}`, { path: `${r.group}/${r.name}`, files: new Map() });
      }
    }
  }

  async ensureCodeGroup(group: string): Promise<EnsureResult> {
    if (this.groups.has(group)) {
      return { status: "exists", path: group };
    }
    this.groups.add(group);
    return { status: "created", path: group };
  }

  async ensureRepository(group: string, name: string): Promise<EnsureRepositoryResult> {
    const key = `${group}/${name}`;
    if (this.repositories.has(key)) {
      return { status: "exists", path: key };
    }
    if (!this.groups.has(group)) this.groups.add(group);
    this.repositories.set(key, { path: key, files: new Map() });
    return { status: "created", path: key, url: `https://codeup.aliyun.com/${key}.git` };
  }

  async readFile(group: string, repository: string, filePath: string): Promise<RepositoryFile | null> {
    const key = `${group}/${repository}`;
    const repo = this.repositories.get(key);
    if (!repo) return null;
    const content = repo.files.get(filePath);
    if (content === undefined) return null;
    return { path: filePath, content, encoding: "utf-8" };
  }

  async commitFile(params: CommitFileParams): Promise<{ success: boolean; commitId?: string }> {
    const key = `${params.group}/${params.repository}`;
    let repo = this.repositories.get(key);
    if (!repo) {
      await this.ensureRepository(params.group, params.repository);
      repo = this.repositories.get(key)!;
    }
    repo.files.set(params.filePath, params.content);
    return { success: true, commitId: `mock-commit-${Date.now()}` };
  }

  async createPipeline(params: CreatePipelineParams): Promise<{ success: boolean; pipelineId?: string }> {
    const pipelineId = `pipeline-${this.nextPipelineId++}`;
    this.pipelines.push({ name: params.name, pipelineId });
    return { success: true, pipelineId };
  }

  async listFiles(group: string, repository: string, dirPath?: string): Promise<string[]> {
    const key = `${group}/${repository}`;
    const repo = this.repositories.get(key);
    if (!repo) return [];
    const prefix = dirPath ?? "";
    return Array.from(repo.files.keys()).filter((f) => f.startsWith(prefix));
  }

  // --- Test helpers: access internal state ---

  getGroups(): string[] {
    return [...this.groups];
  }

  getRepositoryFiles(group: string, name: string): Map<string, string> | undefined {
    return this.repositories.get(`${group}/${name}`)?.files;
  }

  getPipelines(): Array<{ name: string; pipelineId: string }> {
    return [...this.pipelines];
  }
}
