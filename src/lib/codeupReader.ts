// =============================================================================
// Codeup Repository Reader — A6 Yunxiao
// High-level file reading from Codeup repositories for AI analysis.
// Reads key project files (package.json, pom.xml, Dockerfile, etc.)
// =============================================================================

import type { IYunxiaoAdapter } from "@/src/lib/yunxiao";

// ---------------------------------------------------------------------------
// File patterns to read for project analysis
// ---------------------------------------------------------------------------

/** Key files to look for when analyzing a repository */
export const ANALYSIS_FILE_PATTERNS = [
  "package.json",
  "pom.xml",
  "build.gradle",
  "requirements.txt",
  "go.mod",
  "Dockerfile",
  "docker-compose.yml",
  "docker-compose.yaml",
  "next.config.js",
  "next.config.mjs",
  "next.config.ts",
  "nuxt.config.ts",
  "vite.config.ts",
  "vite.config.js",
  ".env.example",
  "app.json",
  "Procfile",
] as const;

// ---------------------------------------------------------------------------
// Repository reader
// ---------------------------------------------------------------------------

export interface RepoFileInfo {
  path: string;
  exists: boolean;
  content?: string;
}

/**
 * Read key analysis files from a Codeup repository.
 * Uses the Yunxiao adapter to fetch each file, returning
 * both found and not-found results.
 */
export async function readAnalysisFiles(
  adapter: IYunxiaoAdapter,
  group: string,
  repository: string,
  branch?: string,
): Promise<RepoFileInfo[]> {
  const results: RepoFileInfo[] = [];

  for (const filePath of ANALYSIS_FILE_PATTERNS) {
    const file = await adapter.readFile(group, repository, filePath, branch);
    results.push({
      path: filePath,
      exists: file !== null,
      content: file?.content,
    });
  }

  return results;
}

/**
 * Read a single file from a repository.
 * Returns the file content or null if not found.
 */
export async function readRepoFile(
  adapter: IYunxiaoAdapter,
  group: string,
  repository: string,
  filePath: string,
  branch?: string,
): Promise<string | null> {
  const file = await adapter.readFile(group, repository, filePath, branch);
  return file?.content ?? null;
}

/**
 * List all files in a repository root to help AI understand project structure.
 */
export async function listRepoRoot(
  adapter: IYunxiaoAdapter,
  group: string,
  repository: string,
  branch?: string,
): Promise<string[]> {
  return adapter.listFiles(group, repository, "", branch);
}
