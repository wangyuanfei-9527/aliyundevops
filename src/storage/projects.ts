// =============================================================================
// Project Record Storage — A5 Storage
// CRUD operations for ProjectRecord with atomic write strategy.
// Each project is stored as a separate JSON file in data/projects/.
// =============================================================================

import fs from "fs";
import path from "path";
import type { ProjectRecord, ProjectRecordStatus } from "@/src/types";
import { safeDataPath } from "@/src/lib/paths";

// ---------------------------------------------------------------------------
// File layout
// ---------------------------------------------------------------------------

const PROJECTS_DIR = "projects";

function projectFilePath(id: string, dataDir: string): string {
  return safeDataPath(`${PROJECTS_DIR}/${id}.json`, dataDir);
}

function projectsDir(dataDir: string): string {
  return safeDataPath(PROJECTS_DIR, dataDir);
}

// ---------------------------------------------------------------------------
// Atomic write — temp file + rename
// ---------------------------------------------------------------------------

function atomicWriteJSON(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });

  const tmpPath = filePath + ".tmp";
  const content = JSON.stringify(data, null, 2);

  fs.writeFileSync(tmpPath, content, "utf-8");
  fs.renameSync(tmpPath, filePath);
}

// ---------------------------------------------------------------------------
// Safe JSON read with error handling
// ---------------------------------------------------------------------------

function readJSONFile<T>(filePath: string): T | null {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    const basename = path.basename(filePath);
    throw new Error(
      `Failed to parse ${basename}: ${(err as Error).message}. The file may be corrupted.`,
    );
  }
}

// ---------------------------------------------------------------------------
// CRUD operations
// ---------------------------------------------------------------------------

/**
 * Create a new project record.
 * Generates a unique ID and writes to data/projects/{id}.json.
 */
export function createProject(
  input: { group: string; name: string; type: "frontend" | "backend"; domain: string; servicePort?: number },
  dataDir: string,
): ProjectRecord {
  const id = `${input.group}-${input.name}`;
  const now = new Date().toISOString();

  const record: ProjectRecord = {
    id,
    input,
    createdAt: now,
    updatedAt: now,
    status: "created",
  };

  const filePath = projectFilePath(id, dataDir);
  if (fs.existsSync(filePath)) {
    throw new Error(`Project "${id}" already exists`);
  }

  atomicWriteJSON(filePath, record);
  return record;
}

/**
 * Get a project record by ID.
 * Returns null if not found.
 */
export function getProject(id: string, dataDir: string): ProjectRecord | null {
  const filePath = projectFilePath(id, dataDir);
  return readJSONFile<ProjectRecord>(filePath);
}

/**
 * List all project records.
 */
export function listProjects(dataDir: string): ProjectRecord[] {
  const dir = projectsDir(dataDir);

  if (!fs.existsSync(dir)) {
    return [];
  }

  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  const records: ProjectRecord[] = [];

  for (const file of files) {
    const filePath = path.join(dir, file);
    const record = readJSONFile<ProjectRecord>(filePath);
    if (record) {
      records.push(record);
    }
  }

  return records;
}

/**
 * Update a project record.
 * Applies partial updates and writes atomically.
 */
export function updateProject(
  id: string,
  updates: Partial<Pick<ProjectRecord, "manifest" | "profile" | "deployPlan" | "status">>,
  dataDir: string,
): ProjectRecord {
  const filePath = projectFilePath(id, dataDir);
  const existing = readJSONFile<ProjectRecord>(filePath);

  if (!existing) {
    throw new Error(`Project "${id}" not found`);
  }

  const updated: ProjectRecord = {
    ...existing,
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  atomicWriteJSON(filePath, updated);
  return updated;
}

/**
 * Update project status.
 */
export function updateProjectStatus(
  id: string,
  status: ProjectRecordStatus,
  dataDir: string,
): ProjectRecord {
  return updateProject(id, { status }, dataDir);
}
