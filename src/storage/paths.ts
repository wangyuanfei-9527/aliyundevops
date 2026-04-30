import { mkdir } from "fs/promises";
import path from "path";

export const dataDir = path.join(process.cwd(), "data");
export const runsDir = path.join(dataDir, "runs");
export const projectsPath = path.join(dataDir, "projects.json");

export async function ensureDataDirs() {
  await mkdir(runsDir, { recursive: true });
}
