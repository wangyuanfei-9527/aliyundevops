import { createHash } from "crypto";

export function nowIso() {
  return new Date().toISOString();
}

export function shortHash(input: string, length = 8) {
  return createHash("sha256").update(input).digest("hex").slice(0, length);
}

export function makeProjectId(group: string, name: string) {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `${date}-${group}-${name}`;
}

export function makeRunId(projectId: string) {
  return `${projectId}-${Date.now()}`;
}
