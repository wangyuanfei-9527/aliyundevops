import { readFile, writeFile } from "fs/promises";
import type { ProjectRecord, ProjectStatus } from "@/types";
import { nowIso } from "@/lib/ids";
import { ensureDataDirs, projectsPath } from "./paths";

async function readAll(): Promise<ProjectRecord[]> {
  await ensureDataDirs();
  try {
    const content = await readFile(projectsPath, "utf8");
    return JSON.parse(content) as ProjectRecord[];
  } catch {
    return [];
  }
}

async function writeAll(projects: ProjectRecord[]) {
  await ensureDataDirs();
  await writeFile(projectsPath, JSON.stringify(projects, null, 2), "utf8");
}

export async function listProjects() {
  const projects = await readAll();
  return projects.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getProject(id: string) {
  const projects = await readAll();
  return projects.find((project) => project.id === id) || null;
}

export async function upsertProject(record: ProjectRecord) {
  const projects = await readAll();
  const index = projects.findIndex((project) => project.id === record.id);
  if (index >= 0) {
    projects[index] = { ...record, updatedAt: nowIso() };
  } else {
    projects.push(record);
  }
  await writeAll(projects);
}

export async function updateProjectStatus(id: string, status: ProjectStatus) {
  const projects = await readAll();
  const project = projects.find((item) => item.id === id);
  if (!project) return;
  project.status = status;
  project.updatedAt = nowIso();
  await writeAll(projects);
}
